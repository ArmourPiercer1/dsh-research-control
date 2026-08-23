/**
 * WP-4.6 — TC-E2E data factory (the e2e test-data seed).
 *
 * Runs on Node (bundled to `e2e/factory-dist/factory.cjs` by the tsdown
 * `factory` entry — see tsdown.config.ts) BEFORE the smoke server starts
 * (scripts/e2e-run.sh invokes it): it writes the canonical `.research/`
 * tree into the smoke workspace (the repo root), git-commits it, opens the
 * REAL host wiring over it (`createHostWiring` — the production service
 * graph, fake session adapter, isolated data dir), and seeds the control
 * plane through the PRODUCTION mutation paths:
 *
 *   runs      R-1 (WS-1/T-1, DSH session pointer, FINISHED) and
 *             R-2 (WS-1/T-2, no session pointer, RUNNING) via
 *             `runBinding.registerRun/finishRun`;
 *   events    the semantic trail (TASK_EXECUTION_CHANGED T-1
 *             PLANNED→ACTIVE→EXECUTED, T-2 PLANNED→ACTIVE; CLAIM_RECORDED
 *             C-1/C-2; ARTIFACT_REGISTERED A-1; RELATION_ADDED REL-1
 *             SUPPORTED_BY, REL-2 PRODUCED_BY) via the wrapped
 *             `store.appendEvents` with the production validate hook —
 *             the same path the agent tools use;
 *   flooding  6 × `createPlanFork` (createdByRun R-1, trigger M-1) —
 *             the §8 flooding hook fires after the 6th OPEN PF and
 *             creates the AUTO_FLOODING intervention (TC-E2E-009);
 *   contract  the merge contract TE-2 is committed, then the WORKING COPY
 *             is drifted (uncommitted) — TC-E2E-010 restores it from Git.
 *
 * Idempotency: the script refuses to run over an existing `research.sqlite`
 * (a re-run means the seed would double-append — the operator must reset
 * the smoke home first). The `.research` tree is rewritten from scratch.
 *
 * Usage: node e2e/factory-dist/factory.cjs --repo <ws> --home <dsh-home> \
 *          --schema-root <WR/schema>
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

import { createHostWiring } from '../../src/host/service/wiring/create.js'
import { makeValidateHook, buildObjectContext } from '../../src/host/service/runbinding/index.js'
import type { Reservation } from '../../src/shared/ids/index.js'
import type { DshSessionAdapter } from '../../src/shared/host-adapter-ports.js'
import type {
  ArtifactSnapshot,
  ClaimSnapshot,
  ObjectKind,
  RelationSnapshot,
  RelationType,
  TaskExecution,
  TypedRef,
} from '../../src/host/history/registry/types.js'

/* -------------------------------------------------------------------- *
 * CLI
 * -------------------------------------------------------------------- */

function parseArgs(argv: readonly string[]): { repo: string; home: string; schemaRoot: string } {
  const out: { repo?: string; home?: string; schemaRoot?: string } = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === undefined) continue
    const next = argv[i + 1]
    if (a === '--repo') {
      out.repo = next
      i++
    } else if (a === '--home') {
      out.home = next
      i++
    } else if (a === '--schema-root') {
      out.schemaRoot = next
      i++
    } else {
      throw new Error(`unknown arg: ${a} (usage: --repo <ws> --home <dsh-home> --schema-root <schema>)`)
    }
  }
  const abs = (v: string | undefined, name: string): string => {
    if (v === undefined || !isAbsolute(v)) throw new Error(`${name} must be an absolute path (got ${JSON.stringify(v)})`)
    return resolve(v)
  }
  return { repo: abs(out.repo, '--repo'), home: abs(out.home, '--home'), schemaRoot: abs(out.schemaRoot, '--schema-root') }
}

/* -------------------------------------------------------------------- *
 * The canonical `.research/` tree (tests/loader fixtures, inlined — the
 * factory must not import test code into the shipped bundle).
 * -------------------------------------------------------------------- */

const T = 1_755_000_000_000

const PROJECT_YAML = `id: PRJ-1
title: 机器人视觉定位系统
description: 多传感器融合的亚像素级视觉定位
importance: 4
attention_mode: FOCUS
current_objective_refs: [OBJ-1]
created_at: 2026-08-21T09:00:00Z
`

const WORKSPACE_YAML = `workspace:
  root: .                # 相对 Git repo root
  git_required: true     # INV-GIT-1
audit:
  strict_tracked:        # 计划书 §22.1 第一层
    paths: []            # 关键代码 / Task deliverables / merge 相关文件 glob
  discovery_zones:       # 第二层：发现未注册 Artifact / workspace change
    - path: results/
      artifact_types: [DATASET, FIGURE]   # 可选：该 zone 期望的 ArtifactType（发现分类提示）
    - path: docs/
  ignored:               # 第三层
    - cache/
    - build/
    - tmp/
`

const OBJECTIVES_YAML = `objectives:
  - id: OBJ-1
    scope: TOPIC
    topic_id: TPC-1
    statement: 完成亚像素级视觉定位原型
    success_criteria:
      - 重投影误差 <2px
    status: ACTIVE
    priority: P1
    linked_refs:
      - { kind: WORKSTREAM, id: WS-1 }
      - { kind: GATE, id: G-1 }
    created_at: 2026-08-21T09:00:00Z
`

const TOPIC_YAML = `id: TPC-1
project_id: PRJ-1
title: 标定与配准
objective_refs: [OBJ-1]
created_at: 2026-08-21T09:05:00Z
`

const TOPOLOGY_YAML = `topology:
  topic_id: TPC-1
  edges:
    - id: TE-1
      topic_id: TPC-1
      operation: FORK
      lifecycle: PLANNED
      inputs: [WS-1]
      outputs: [WS-2]
      note: 分支出独立标定管线
    - id: TE-2
      topic_id: TPC-1
      operation: MERGE
      lifecycle: PLANNED
      inputs: [WS-1, WS-2]
      outputs: [WS-3]
`

const WS1_YAML = `id: WS-1
topic_id: TPC-1
title: 主标定管线
created_at: 2026-08-21T09:10:00Z
`

const WS2_YAML = `id: WS-2
topic_id: TPC-1
title: 独立标定管线
origin_topology_edge_ref: TE-1
created_at: 2026-08-21T09:12:00Z
`

const WS3_YAML = `id: WS-3
topic_id: TPC-1
title: 合并后管线
origin_topology_edge_ref: TE-2
created_at: 2026-08-21T09:14:00Z
`

const PLAN_YAML = `workstream: WS-1
ordered_items: [G-1, T-1, T-2, T-3, M-1, T-4, G-2]
`

const G1_YAML = `id: G-1
workstream_id: WS-1
title: 数据就绪评审
criteria: 标定数据集完整、标注规范且可复现
created_by: { kind: USER, label: researcher }
created_at: 2026-08-21T09:35:00Z
`

const T1_YAML = `id: T-1
workstream_id: WS-1
title: 标定数据采集方案对比
goal: 确定 EURA 相机阵列的标定数据采集方案，误差目标 <2px 重投影误差
deliverables:
  - docs/calibration-plan.md
acceptance_criteria:
  - 三种候选方案均有实测重投影误差数据
created_by: { kind: USER, label: researcher }
created_at: 2026-08-21T09:30:00Z
`

const T2_YAML = `id: T-2
workstream_id: WS-1
title: 候选方案 A 实现
goal: 实现基于棋盘格的标定采集与求解
created_by: { kind: USER, label: researcher }
created_at: 2026-08-21T09:36:00Z
`

const T3_YAML = `id: T-3
workstream_id: WS-1
title: 候选方案 B 实现
goal: 实现基于 ARUKO 标记的标定采集与求解
created_by: { kind: USER, label: researcher }
created_at: 2026-08-21T09:37:00Z
`

const T4_YAML = `id: T-4
workstream_id: WS-1
title: 三方案误差对比
goal: 在统一测试集上对比三方案重投影误差
created_by: { kind: USER, label: researcher }
created_at: 2026-08-21T09:38:00Z
`

const M1_YAML = `id: M-1
workstream_id: WS-1
title: 标定管线 v1 冻结
statement: 重投影误差 <2px 的标定管线代码冻结并进入合并评审
created_by: { kind: USER, label: researcher }
created_at: 2026-08-21T09:39:00Z
`

const G2_YAML = `id: G-2
workstream_id: WS-1
title: 合并评审
criteria: 三方案对比数据完整且 M-1 已达成
created_by: { kind: USER, label: researcher }
created_at: 2026-08-21T09:40:00Z
`

const CONTRACT_MD = `# Merge Contract TE-2

- 接口: 标定结果统一输出 CalibrationResult (JSON schema v1)
- 坐标系: 相机系，右手系
- benchmark protocol: 统一 5 组标定板位姿
- 期望产物: docs/merge-contract-verification.md
`

const POLICY_YAML = `enabled: true
anchors:
  allow_boundary_sentinels: true   # 允许 __START__ / __END__
  required_item_types: []          # 空 = 任意 item 可作 anchor；可设 [GATE]
flooding:
  threshold: 5                     # 每 workstream unresolved OPEN PF 数上限
triggers:
  require_at_least_one: true
  allowed_kinds: [CLAIM, FACT, ARTIFACT, MILESTONE, OBJECTIVE]
`

const TREE: Record<string, string> = {
  'schema-version': '1\n',
  'project.yaml': PROJECT_YAML,
  'workspace.yaml': WORKSPACE_YAML,
  'objectives.yaml': OBJECTIVES_YAML,
  'topics/TPC-1/topic.yaml': TOPIC_YAML,
  'topics/TPC-1/topology.yaml': TOPOLOGY_YAML,
  'topics/TPC-1/workstreams/WS-1/workstream.yaml': WS1_YAML,
  'topics/TPC-1/workstreams/WS-1/plan.yaml': PLAN_YAML,
  'topics/TPC-1/workstreams/WS-1/items/gates/G-1.yaml': G1_YAML,
  'topics/TPC-1/workstreams/WS-1/items/tasks/T-1.yaml': T1_YAML,
  'topics/TPC-1/workstreams/WS-1/items/tasks/T-2.yaml': T2_YAML,
  'topics/TPC-1/workstreams/WS-1/items/tasks/T-3.yaml': T3_YAML,
  'topics/TPC-1/workstreams/WS-1/items/tasks/T-4.yaml': T4_YAML,
  'topics/TPC-1/workstreams/WS-1/items/milestones/M-1.yaml': M1_YAML,
  'topics/TPC-1/workstreams/WS-1/items/gates/G-2.yaml': G2_YAML,
  'topics/TPC-1/workstreams/WS-2/workstream.yaml': WS2_YAML,
  'topics/TPC-1/workstreams/WS-3/workstream.yaml': WS3_YAML,
  'merges/TE-2/contract.md': CONTRACT_MD,
  'policies/agent-plan-fork.yaml': POLICY_YAML,
}

/* -------------------------------------------------------------------- *
 * Steps
 * -------------------------------------------------------------------- */

function writeTree(researchRoot: string): void {
  rmSync(researchRoot, { recursive: true, force: true })
  for (const [rel, content] of Object.entries(TREE)) {
    const p = join(researchRoot, rel)
    mkdirSync(join(p, '..'), { recursive: true })
    writeFileSync(p, content)
  }
}

function git(args: string[], cwd: string): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' })
}

function ensureGitRepo(repo: string): void {
  if (!existsSync(join(repo, '.git'))) {
    git(['init', '-b', 'main'], repo)
  }
  git(['config', 'user.email', 'e2e-factory@research.local'], repo)
  git(['config', 'user.name', 'e2e factory'], repo)
}

/** The fake session adapter port (WP-0.4): no live DSH sessions here —
 *  the seed is pointer-only (INV-DB-2); the workspace's registered
 *  session ids are read from workspace.json for the RUN_STARTED pointer. */
function makeFakeAdapter(): DshSessionAdapter {
  return {
    listSessions: () => [],
    onSessionEvent: () => () => undefined,
    observeSessionLifecycle: () => () => undefined,
    querySession: async () => {
      throw new Error('factory adapter: querySession is not used by the seed')
    },
  }
}

/** Read the first registered session id of the workspace (the RUN_STARTED
 *  pointer of R-1 — 「在宿主会话列表中打开」 then targets a REAL session). */
function firstRegisteredSession(home: string, repo: string): string | null {
  const p = join(home, 'storages', 'workspace.json')
  if (!existsSync(p)) return null
  const raw = JSON.parse(readFileSync(p, 'utf8')) as {
    tables?: { workspaces?: Record<string, { path?: string; sessionIds?: string[] }> }
  }
  for (const ws of Object.values(raw.tables?.workspaces ?? {})) {
    if (ws.path !== repo) continue
    const ids = ws.sessionIds ?? []
    if (ids.length > 0) return ids[0] ?? null
  }
  return null
}

interface SeedSummary {
  readonly researchRoot: string
  readonly dataDir: string
  readonly runs: string[]
  readonly events: string[]
  readonly planForks: string[]
  readonly floodingIntervention: string | null
  readonly contractPath: string
  readonly drifted: boolean
}

async function main(): Promise<void> {
  const { repo, home, schemaRoot } = parseArgs(process.argv.slice(2))
  const researchRoot = join(repo, '.research')
  const dataDir = join(home, 'research-control', 'PRJ-1')

  // Refuse to double-seed (the sqlite is append-only history).
  if (existsSync(join(dataDir, 'research.sqlite'))) {
    throw new Error(
      `${join(dataDir, 'research.sqlite')} already exists — the factory seeds exactly once ` +
        '(reset the smoke home data dir to re-run)',
    )
  }

  // 1) the canonical tree + git baseline.
  writeTree(researchRoot)
  ensureGitRepo(repo)
  git(['add', '.research'], repo)
  git(['commit', '-m', 'seed: .research tree (e2e factory)'], repo)

  // 2) the production host wiring over the seed.
  mkdirSync(dataDir, { recursive: true })
  const wiring = createHostWiring({
    repoRoot: repo,
    schemaRoot,
    projectId: 'PRJ-1',
    dataDir,
    adapter: makeFakeAdapter(),
    workspaceRoots: [repo],
  })

  const summary: SeedSummary = {
    researchRoot,
    dataDir,
    runs: [],
    events: [],
    planForks: [],
    floodingIntervention: null,
    contractPath: '.research/merges/TE-2/contract.md',
    drifted: false,
  }

  try {
    const sessionForR1 = firstRegisteredSession(home, repo)

    // The factory's semantic-object ledger: the frozen registry validates
    // referenced objects against the event context, and the production
    // `buildObjectContext` (runbinding) carries EMPTY semantic maps (no
    // production V1 path appends claim/artifact/relation events — the
    // agent tools are stubs) plus a task map that stays at the declarative
    // baseline (`liveTasks` is snapshot-once — V1 has no task-transition
    // appender). The factory tracks the objects/state it appends and feeds
    // them to the context builder, so each append validates against the
    // state the previous appends created (INV-HIST-5 semantics).
    const claims = new Map<string, ClaimSnapshot>()
    const artifacts = new Map<string, ArtifactSnapshot>()
    const relations = new Map<string, RelationSnapshot>()
    const taskExec = new Map<string, string>()
    const validate = makeValidateHook(
      wiring.registry,
      () => {
        const base = buildObjectContext(wiring.tables, wiring.externalState())
        const tasks = new Map(base.tasks)
        for (const [id, execution] of taskExec) {
          const t = tasks.get(id)
          if (t !== undefined) tasks.set(id, { ...t, execution: execution as TaskExecution })
        }
        return {
          ...base,
          tasks,
          claims: new Map(claims),
          artifacts: new Map(artifacts),
          relations: new Map(relations),
        }
      },
    )

    const trackSemantic = (eventType: string, payload: Record<string, unknown>): void => {
      if (eventType === 'CLAIM_RECORDED') {
        claims.set(String(payload.claim_id), { workstreamId: 'WS-1', status: 'ACTIVE' })
      } else if (eventType === 'CLAIM_RETRACTED') {
        const c = claims.get(String(payload.claim_id))
        if (c !== undefined) claims.set(String(payload.claim_id), { ...c, status: 'RETRACTED' })
      } else if (eventType === 'ARTIFACT_REGISTERED') {
        artifacts.set(String(payload.artifact_id), { workstreamId: 'WS-1', status: 'REGISTERED' })
      } else if (eventType === 'ARTIFACT_MARKED_MISSING') {
        const a = artifacts.get(String(payload.artifact_id))
        if (a !== undefined) artifacts.set(String(payload.artifact_id), { ...a, status: 'MISSING' })
      } else if (eventType === 'RELATION_ADDED') {
        const src = payload.source as { kind: unknown; id: unknown }
        const tgt = payload.target as { kind: unknown; id: unknown }
        relations.set(String(payload.relation_id), {
          status: 'ACTIVE',
          source: { kind: String(src.kind) as ObjectKind, id: String(src.id) } satisfies TypedRef,
          relationType: String(payload.relation_type) as RelationType,
          target: { kind: String(tgt.kind) as ObjectKind, id: String(tgt.id) } satisfies TypedRef,
        })
      } else if (eventType === 'TASK_EXECUTION_CHANGED') {
        taskExec.set(String(payload.task_id), String(payload.to))
      }
    }

    // 3) runs: R-1 (finished, DSH session pointer) + R-2 (running, no
    //    pointer — the drill-down 「无 DSH 会话指针」 face).
    const r1 = wiring.runBinding.registerRun(
      {
        workstreamId: 'WS-1',
        taskId: 'T-1',
        ...(sessionForR1 !== null ? { dshSessionId: sessionForR1 } : {}),
        intent: '调研标定数据采集方案',
      },
      { kind: 'USER', ...(sessionForR1 !== null ? { session_id: sessionForR1 } : {}) },
    )
    summary.runs.push(r1.run.id)

    // 4) the R-1 semantic trail (one batch — one transaction). The
    //    allocator reservations are committed after the append (the
    //    caller-owned protocol — the id is burned at reserve, live at
    //    commit; a failed append must release, not commit).
    //    Emitter rules (frozen registry, §3.6/§4 E column): task state
    //    transitions are USER-only (人类判断动作) — the run attribution
    //    rides the actor's `run_id` (the drill-down event trail reads it
    //    from any actor kind).
    const mkEvent = (
      actorKind: 'USER' | 'AGENT',
      eventType: string,
      occurredAt: number,
      payload: Record<string, unknown>,
      runId: string,
    ): { event: { eventId: string; ownerWorkstreamId: string; eventType: string; schemaVersion: number; occurredAt: number; actor: { kind: 'USER' | 'AGENT'; run_id: string }; source: null; payload: Record<string, unknown> }; reservation: Reservation } => {
      const reservation = wiring.allocator.reserve('HISTORY_EVENT', 'PRJ-1')
      return {
        event: {
          eventId: reservation.id,
          ownerWorkstreamId: 'WS-1',
          eventType,
          schemaVersion: 1,
          occurredAt,
          actor: { kind: actorKind, run_id: runId },
          source: null,
          payload,
        },
        reservation,
      }
    }
    const r1Batch = [
      mkEvent('USER', 'TASK_EXECUTION_CHANGED', T + 10_000, { task_id: 'T-1', from: 'PLANNED', to: 'ACTIVE', reason: 'R-1 开始执行' }, r1.run.id),
      mkEvent('AGENT', 'CLAIM_RECORDED', T + 20_000, { claim_id: 'C-1', statement: '棋盘格方案的实测重投影误差最低', created_by_run: r1.run.id }, r1.run.id),
      mkEvent('AGENT', 'ARTIFACT_REGISTERED', T + 30_000, { artifact_id: 'A-1', type: 'REPORT', title: '标定方案对比报告', uri: 'file:///docs/calibration-plan.md', created_by_run: r1.run.id, related_task: 'T-1' }, r1.run.id),
      mkEvent('AGENT', 'RELATION_ADDED', T + 40_000, { relation_id: 'REL-1', source: { kind: 'CLAIM', id: 'C-1' }, relation_type: 'SUPPORTED_BY', target: { kind: 'ARTIFACT', id: 'A-1' } }, r1.run.id),
      mkEvent('AGENT', 'RELATION_ADDED', T + 50_000, { relation_id: 'REL-2', source: { kind: 'ARTIFACT', id: 'A-1' }, relation_type: 'PRODUCED_BY', target: { kind: 'RUN', id: r1.run.id } }, r1.run.id),
      mkEvent('USER', 'TASK_EXECUTION_CHANGED', T + 60_000, { task_id: 'T-1', from: 'ACTIVE', to: 'EXECUTED', reason: 'R-1 完成' }, r1.run.id),
    ]
    // ONE APPEND PER EVENT (not one batch): the frozen registry validates
    // each event against the object context of its OWN append — an object
    // created by an EARLIER event of the same batch is not yet visible to
    // a later event's validation (the semantic fold lands per append).
    // The relations therefore ride separate appends after their
    // referents exist.
    for (const part of r1Batch) {
      const result = wiring.store.appendEvents([part.event], { validate })
      const appended = result.events[0]!
      summary.events.push(`${appended.eventId}:${appended.eventType}`)
      trackSemantic(appended.eventType, appended.payload)
      wiring.allocator.commit(part.reservation)
    }

    const r1Done = wiring.runBinding.finishRun(r1.run.id, { outcomeSummary: '方案对比完成' })
    void r1Done

    // 5) R-2 (running, no session pointer) + its trail.
    const r2 = wiring.runBinding.registerRun(
      { workstreamId: 'WS-1', taskId: 'T-2', intent: '实现候选方案 A' },
      { kind: 'USER' },
    )
    summary.runs.push(r2.run.id)
    const r2Batch = [
      mkEvent('USER', 'TASK_EXECUTION_CHANGED', T + 70_000, { task_id: 'T-2', from: 'PLANNED', to: 'ACTIVE', reason: 'R-2 开始执行' }, r2.run.id),
      mkEvent('AGENT', 'CLAIM_RECORDED', T + 80_000, { claim_id: 'C-2', statement: 'ARUKO 标记在低光环境下更稳定', created_by_run: r2.run.id }, r2.run.id),
    ]
    for (const part of r2Batch) {
      const result = wiring.store.appendEvents([part.event], { validate })
      const appended = result.events[0]!
      summary.events.push(`${appended.eventId}:${appended.eventType}`)
      trackSemantic(appended.eventType, appended.payload)
      wiring.allocator.commit(part.reservation)
    }

    // 6) 6 plan forks → the §8 flooding hook fires after the 6th (the
    //    AUTO_FLOODING intervention — TC-E2E-009 seed).
    for (let i = 1; i <= 6; i++) {
      const pf = await wiring.createPlanFork({
        workstreamId: 'WS-1',
        forkAnchor: 'T-1',
        mergeAnchor: 'T-2',
        proposedItems: [
          {
            action: 'NEW',
            kind: 'TASK',
            spec: { title: `PF-${i} 提案任务`, goal: `第 ${i} 条备选验证路径（洪泛种子）` },
          },
        ],
        triggerRefs: [{ kind: 'MILESTONE', id: 'M-1' }],
        reason: `e2e 洪泛种子 PF-${i}：备选验证路径`,
        necessity: `需要第 ${i} 条备选路径以验证未决 PlanFork 的展示与裁决`,
        createdByRun: r1.run.id,
      })
      summary.planForks.push(pf.id)
    }
    const ivs = wiring.interventions.listInterventions({ origin: 'AUTO_FLOODING' })
    const flooding = ivs.find((iv) => iv.origin === 'AUTO_FLOODING')
    summary.floodingIntervention = flooding?.id ?? null

    // 7) drift the merge contract working copy (uncommitted) — the
    //    TC-E2E-010 restore target (the committed baseline is the seed).
    const contract = join(researchRoot, 'merges', 'TE-2', 'contract.md')
    writeFileSync(contract, `${readFileSync(contract, 'utf8')}<!-- e2e drift: working copy modified (TC-E2E-010 restore target) -->\n`)
    summary.drifted = true
  } finally {
    wiring.close()
  }

  console.log(JSON.stringify(summary, null, 2))
}

main().catch((err: unknown) => {
  console.error(`e2e factory failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`)
  process.exit(1)
})
