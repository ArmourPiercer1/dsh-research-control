/**
 * WP-3.6 (RR-011 (d)) — the host service dependency graph:
 * `store → registry → tree → run/DS tables → allocator → runbinding +
 * sessionlink → planfork → stale → flooding → tools`, with per-step
 * loud failures (structured `HostWiringError` codes) and ONE complete
 * disposer (`close()`).
 *
 * Coverage (the task's (d), real sqlite + temp git repo):
 *   1. STARTUP — the full graph instantiates over a temp git repo +
 *      the real `.research` tree + the real frozen schemas: every
 *      member present, the 11 agent tools with the frozen names, the
 *      startup reconciliation reports, a live append works.
 *   2. THE TOOL FACE END-TO-END — `research_plan_fork_create` through
 *      the composed deps (the SYNC tool port): a valid agent call
 *      creates a PF whose base blob OIDs EQUAL real `git hash-object`
 *      of the closure files (the W3-equivalence of the content-hash
 *      capturer — pinned here end-to-end); the built-in gates fire
 *      (USER actor → TOOL_ACTOR_FORBIDDEN; AGENT without run →
 *      TOOL_RUN_REQUIRED; bad args → TOOL_INPUT).
 *   3. THE ASYNC PRODUCTION FLOW — `wiring.createPlanFork` (the stale
 *      service, REAL git W3/W11): the record carries
 *      `base_git_commit` = the repo HEAD (the sync tool path omits it
 *      by design — content addressing needs no HEAD).
 *   4. PER-STEP FAIL LOUD — WIRING_INPUT (bad project id / missing
 *      tree), WIRING_REGISTRY (unusable history schema dir),
 *      WIRING_TREE (a broken project.yaml), WIRING_PLANFORK (the
 *      plan-fork schema deleted), WIRING_FLOODING (the attention
 *      schema deleted) — each a structured HostWiringError, and the
 *      partial resources are unwound (no leaked open store).
 *   5. THE DISPOSER — `close()` is idempotent, closes the store
 *      connection (further appends throw), and releases the file
 *      (a fresh raw connection opens cleanly).
 */

import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { isToolError } from '../../src/host/tools/index.js'
import {
  createHostWiring,
  HostWiringError,
  type HostWiring,
} from '../../src/host/service/wiring/index.js'
import {
  gitBlobOidOfResearch,
  gitHead,
  initGitRepo,
  makeFakeLauncherAdapter,
  makeTempDir,
  makeWiring,
  rawDb,
  USER,
  WR_SCHEMA_ROOT,
  writeResearchTree,
  type WiringBundle,
} from './helpers.js'
import { FakeSessionAdapter } from '../runbinding/helpers.js'

/** The frozen 11 agent tool names (the WP-3.3 face). */
const TOOL_NAMES = [
  'research_fact_record',
  'research_claim_record',
  'research_artifact_register',
  'research_intervention_create',
  'research_next_action_create',
  'research_plan_fork_create',
  'research_run_checkpoint',
  'research_context_get',
  'research_plan_get',
  'research_history_query',
  'research_contract_read',
] as const

/** The §4 params both creation flows share (a real MILESTONE trigger
 *  ref from the fixture tree). */
function pfParams(runId: string) {
  return {
    workstreamId: 'WS-1',
    forkAnchor: 'T-1',
    mergeAnchor: 'T-1',
    proposedItems: [
      { action: 'NEW' as const, kind: 'TASK' as const, spec: { title: '候选方案 C（结构光）', goal: '用结构光相机做第三方案对比', acceptance_criteria: ['实测重投影误差 <2px'] } },
    ],
    triggerRefs: [{ kind: 'MILESTONE' as const, id: 'M-1' }],
    reason: '第三候选方案需要进入计划区间',
    necessity: '两方案误差收敛性不足，结构光是文献推荐路径',
    createdByRun: runId,
  }
}

describe('(d) the host service dependency graph (store → … → tools)', () => {
  it('STARTUP: the full graph instantiates (real sqlite + temp git repo + real schemas)', () => {
    const bundle = makeWiring()
    const { wiring } = bundle
    try {
      // Every graph member is present and usable:
      expect(wiring.store.path).toContain('research.sqlite')
      expect(wiring.registry.isUsable).toBe(true)
      expect(wiring.allocator).toBeDefined()
      expect(wiring.runBinding).toBeDefined()
      expect(wiring.sessionLink).toBeDefined()
      expect(wiring.planForks).toBeDefined()
      expect(wiring.stale).toBeDefined()
      expect(wiring.flooding).toBeDefined()
      expect(wiring.interventions).toBeDefined()
      expect(wiring.semantics).toBeDefined()

      // The 11 agent tools, frozen names:
      expect(wiring.tools).toHaveLength(11)
      expect(wiring.tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort())

      // Startup reconciliation ran (clean tree + empty log):
      expect(wiring.startup.lifecycle.changed).toBe(0)
      expect(wiring.startup.runs.ok).toBe(true)
      expect(wiring.startup.semantics.report.ok).toBe(true)

      // A live append through the wrapped store works (the graph is
      // functional, not just constructed):
      const r = wiring.runBinding.registerRun({ workstreamId: 'WS-1' }, USER)
      expect(r.run.status).toBe('RUNNING')
    } finally {
      wiring.close()
    }
  })

  it('TOOL FACE E2E: research_plan_fork_create creates a PF with base OIDs == real git hash-object', async () => {
    const bundle = makeWiring()
    const { wiring, repoRoot } = bundle
    try {
      // The run (a PLANNED workstream's first event — the flip happens
      // here; the PF creation then sees the REALIZED state).
      const r = wiring.runBinding.registerRun({ workstreamId: 'WS-1' }, USER)

      const tool = wiring.tools.find((t) => t.name === 'research_plan_fork_create')!
      const args = {
        workstream_id: 'WS-1',
        fork_anchor: 'T-1',
        merge_anchor: 'T-1',
        proposed_items: [
          {
            action: 'NEW',
            kind: 'TASK',
            spec: {
              title: '候选方案 C（结构光）',
              goal: '用结构光相机做第三方案对比',
              acceptance_criteria: ['实测重投影误差 <2px'],
            },
          },
        ],
        trigger_refs: [{ kind: 'MILESTONE', id: 'M-1' }],
        reason: '第三候选方案需要进入计划区间',
        necessity: '两方案误差收敛性不足，结构光是文献推荐路径',
      }

      const value = await tool.execute(args, {
        signal: new AbortController().signal,
        actor: { kind: 'AGENT', session_id: 'sess-tool', run_id: r.run.id },
      })
      expect((value as { status: string }).status).toBe('created')
      const pf = (value as { plan_fork: { id: string; status: string; workstream_id: string } }).plan_fork
      expect(pf.status).toBe('OPEN')
      expect(pf.workstream_id).toBe('WS-1')

      // The record is in the PF/MA store (second connection):
      const record = wiring.planForks.getPlanFork(pf.id)
      expect(record).not.toBeNull()
      expect(record!.base_plan_objects.length).toBeGreaterThan(0)
      // The sync tool path omits base_git_commit (content addressing
      // needs no HEAD — informational only per §3.2):
      expect(record!.base_git_commit).toBeUndefined()

      // W3-EQUIVALENCE (end-to-end): every base blob OID equals the real
      // `git hash-object` of the closure file at that path:
      for (const obj of record!.base_plan_objects) {
        expect(gitBlobOidOfResearch(repoRoot, '.research', obj.path)).toBe(obj.git_blob_oid)
      }
      // And the record's paths are the expected closure (plan + items):
      const paths = record!.base_plan_objects.map((o) => o.path).sort()
      expect(paths).toContain('topics/TPC-1/workstreams/WS-1/plan.yaml')
    } finally {
      wiring.close()
    }
  })

  it('TOOL GATES: USER actor forbidden; AGENT without run required to fail; bad args → TOOL_INPUT', async () => {
    const bundle = makeWiring()
    const { wiring } = bundle
    try {
      const r = wiring.runBinding.registerRun({ workstreamId: 'WS-1' }, USER)
      const tool = wiring.tools.find((t) => t.name === 'research_plan_fork_create')!
      const args = {
        workstream_id: 'WS-1',
        fork_anchor: 'T-1',
        merge_anchor: 'T-1',
        proposed_items: [{ action: 'NEW', kind: 'TASK', spec: { title: 't', goal: 'g' } }],
        trigger_refs: [{ kind: 'MILESTONE', id: 'M-1' }],
        reason: 'r',
        necessity: 'n',
      }

      // ① USER actor: the agent tool surface is AGENT-only (matrix §6).
      await expect(
        tool.execute(args, { signal: new AbortController().signal, actor: { kind: 'USER', user_id: 'u-x' } }),
      ).rejects.toSatisfy((e: unknown) => isToolError(e) && e.code === 'TOOL_ACTOR_FORBIDDEN')

      // ② AGENT without a run: the write set is run-attributed (INV-PERM-1).
      await expect(
        tool.execute(args, { signal: new AbortController().signal, actor: { kind: 'AGENT', session_id: 'sess-x' } }),
      ).rejects.toSatisfy((e: unknown) => isToolError(e) && e.code === 'TOOL_RUN_REQUIRED')

      // ③ Malformed args (missing necessity): the tool's own input gate.
      await expect(
        tool.execute(
          { ...args, necessity: '' },
          { signal: new AbortController().signal, actor: { kind: 'AGENT', session_id: 'sess-x', run_id: r.run.id } },
        ),
      ).rejects.toSatisfy((e: unknown) => isToolError(e) && e.code === 'TOOL_INPUT')

      // ④ A valid run id that does NOT exist: the service chain refuses
      //    (step 8 formal-run existence) as TOOL_SERVICE:
      await expect(
        tool.execute(args, { signal: new AbortController().signal, actor: { kind: 'AGENT', session_id: 'sess-x', run_id: 'R-404' } }),
      ).rejects.toSatisfy((e: unknown) => isToolError(e) && e.code === 'TOOL_SERVICE')
      void r
    } finally {
      wiring.close()
    }
  })

  it('ASYNC FLOW: wiring.createPlanFork (the stale service, real git W3/W11) carries base_git_commit = HEAD', async () => {
    const bundle = makeWiring()
    const { wiring, repoRoot } = bundle
    try {
      const r = wiring.runBinding.registerRun({ workstreamId: 'WS-1' }, USER)
      const record = await wiring.createPlanFork(pfParams(r.run.id))
      expect(record.id).toMatch(/^PF-/)
      expect(record.status).toBe('OPEN')
      expect(record.created_by_run).toBe(r.run.id)
      // W11: the real HEAD at creation time (the sync path omits it):
      expect(record.base_git_commit).toBe(gitHead(repoRoot))
      // W3: real git closure OIDs:
      for (const obj of record.base_plan_objects) {
        expect(gitBlobOidOfResearch(repoRoot, '.research', obj.path)).toBe(obj.git_blob_oid)
      }
    } finally {
      wiring.close()
    }
  })
})

describe('(d) per-step loud failures (structured codes, partial unwind)', () => {
  /** A bare createHostWiring call over a temp repo (a valid tree is
   *  always present unless `tree` patches it — the failure variants break
   *  exactly ONE axis at a time). */
  function attempt(over: {
    repoRoot: string
    dataDir: string
    schemaRoot?: string
    projectId?: string
    tree?: Record<string, string | null>
    git?: boolean
  }): HostWiring {
    const repoRoot = over.repoRoot
    writeResearchTree(repoRoot, over.tree ?? {})
    if (over.git !== false) initGitRepo(repoRoot)
    return createHostWiring({
      repoRoot,
      schemaRoot: over.schemaRoot ?? WR_SCHEMA_ROOT,
      projectId: over.projectId ?? 'PRJ-1',
      dataDir: over.dataDir,
      adapter: new FakeSessionAdapter(),
      launcherAdapter: makeFakeLauncherAdapter(),
      workspaceRoots: [repoRoot],
    })
  }

  it('WIRING_INPUT: a malformed project id is refused before any I/O', () => {
    const repoRoot = makeTempDir('wp36-in-')
    expect(() => attempt({ repoRoot, dataDir: makeTempDir('wp36-ind-'), projectId: 'BOGUS-1' })).toThrow(HostWiringError)
    expect(() => attempt({ repoRoot, dataDir: makeTempDir('wp36-ind-'), projectId: 'BOGUS-1' })).toThrow(/projectId/)
  })

  it('Windows absolute repoRoot passes input validation (cross-platform — the DSH host hands native paths)', () => {
    // The Windows failure mode (the user's `repoRoot must be an absolute
    // path (got "D:\Projects\AIUED")`): the POSIX-only `startsWith('/')`
    // check rejected the native workspace path at rescan / re-init time.
    // Step-0 validation must ACCEPT the path shape; on this (POSIX) bench
    // the run then fails LATER on the genuinely missing tree (the literal
    // `D:\Projects\AIUED` directory does not exist here — the missing-tree
    // check reuses the WIRING_INPUT code, so only the MESSAGE is the
    // regression guard) — it must NEVER fail with the path complaint.
    const winRoot = 'D:\\Projects\\AIUED'
    let caught: unknown
    try {
      createHostWiring({
        repoRoot: winRoot,
        schemaRoot: WR_SCHEMA_ROOT,
        projectId: 'PRJ-1',
        dataDir: makeTempDir('wp36-win-'),
        adapter: new FakeSessionAdapter(),
        launcherAdapter: makeFakeLauncherAdapter(),
        workspaceRoots: [winRoot],
      })
    } catch (e) {
      caught = e
    }
    if (caught !== undefined) {
      expect(caught).toBeInstanceOf(HostWiringError)
      expect(String((caught as Error).message)).not.toContain('must be an absolute path')
    }
  })

  it('WIRING_INPUT: a workspace without a .research tree is refused', () => {
    const repoRoot = makeTempDir('wp36-notree-')
    mkdirSync(repoRoot, { recursive: true })
    initGitRepo(repoRoot)
    expect(() =>
      createHostWiring({
        repoRoot,
        schemaRoot: WR_SCHEMA_ROOT,
        projectId: 'PRJ-1',
        dataDir: makeTempDir('wp36-notreed-'),
        adapter: new FakeSessionAdapter(),
        launcherAdapter: makeFakeLauncherAdapter(),
        workspaceRoots: [repoRoot],
      }),
    ).toThrow(/\.research/)
  })

  it('WIRING_REGISTRY: an unusable history schema dir fails startup (registry unusable ⇒ no validated append)', () => {
    const schemaRoot = makeTempDir('wp36-schema-')
    cpSync(WR_SCHEMA_ROOT, schemaRoot, { recursive: true })
    rmSync(join(schemaRoot, 'history', 'history-events.schema.json'))
    const repoRoot = makeTempDir('wp36-reg-')
    expect(() => attempt({ repoRoot, dataDir: makeTempDir('wp36-regd-'), schemaRoot })).toThrow(HostWiringError)
    expect(() => attempt({ repoRoot, dataDir: makeTempDir('wp36-regd-'), schemaRoot })).toThrow(/registry/i)
  })

  it('WIRING_TREE: a broken project.yaml fails startup (services never run against a broken 真源)', () => {
    const repoRoot = makeTempDir('wp36-tree-')
    expect(() =>
      attempt({
        repoRoot,
        dataDir: makeTempDir('wp36-treed-'),
        tree: { 'project.yaml': 'id: PRJ-1\nimportance: not-a-number\n' },
      }),
    ).toThrow(HostWiringError)
    expect(() =>
      attempt({
        repoRoot,
        dataDir: makeTempDir('wp36-treed-'),
        tree: { 'project.yaml': 'id: PRJ-1\nimportance: not-a-number\n' },
      }),
    ).toThrow(/tree|load/i)
  })

  it('WIRING_PLANFORK: the plan-fork schema deleted → startup fails before any PF can be shape-checked', () => {
    const schemaRoot = makeTempDir('wp36-pfschema-')
    cpSync(WR_SCHEMA_ROOT, schemaRoot, { recursive: true })
    rmSync(join(schemaRoot, 'operational', 'plan-fork.schema.json'))
    const repoRoot = makeTempDir('wp36-pf-')
    const err = (() => {
      try {
        attempt({ repoRoot, dataDir: makeTempDir('wp36-pfd-'), schemaRoot })
        return null
      } catch (e) {
        return e
      }
    })()
    expect(err).toBeInstanceOf(HostWiringError)
    expect((err as HostWiringError).code).toBe('WIRING_PLANFORK')
  })

  it('WIRING_FLOODING: the attention schema deleted → startup fails', () => {
    const schemaRoot = makeTempDir('wp36-ivschema-')
    cpSync(WR_SCHEMA_ROOT, schemaRoot, { recursive: true })
    rmSync(join(schemaRoot, 'operational', 'attention.schema.json'))
    const repoRoot = makeTempDir('wp36-iv-')
    const err = (() => {
      try {
        attempt({ repoRoot, dataDir: makeTempDir('wp36-ivd-'), schemaRoot })
        return null
      } catch (e) {
        return e
      }
    })()
    expect(err).toBeInstanceOf(HostWiringError)
    expect((err as HostWiringError).code).toBe('WIRING_FLOODING')
  })
})

describe('(d) the disposer (one close for the whole graph)', () => {
  it('close() is idempotent, closes the store connection, and releases the file', () => {
    const bundle = makeWiring()
    const { wiring, dataDir } = bundle
    wiring.runBinding.registerRun({ workstreamId: 'WS-1' }, USER)

    wiring.close()
    expect(() => wiring.close()).not.toThrow() // idempotent

    // The store connection is closed (further appends throw):
    expect(() =>
      wiring.store.appendEvents([
        {
          eventId: 'H-AFTER-CLOSE',
          ownerWorkstreamId: 'WS-1',
          eventType: 'FACT_RECORDED',
          schemaVersion: 1,
          occurredAt: 1755850000000,
          actor: { kind: 'USER', user_id: 'u-1' },
          payload: { fact_id: 'F-X', statement: 'x' },
        },
      ]),
    ).toThrow()

    // The WAL file is released (a fresh raw connection opens cleanly):
    const db = rawDb(dataDir)
    try {
      const rows = db.prepare('SELECT COUNT(*) AS n FROM history_event').get() as { n: number }
      expect(rows.n).toBe(1)
    } finally {
      db.close()
    }
  })

  it('a failed init leaks nothing: the store file left behind by the unwound attempt is openable', () => {
    const repoRoot = makeTempDir('wp36-leak-')
    const dataDir = makeTempDir('wp36-leakd-')
    writeResearchTree(repoRoot, { 'project.yaml': 'id: PRJ-1\nimportance: not-a-number\n' })
    initGitRepo(repoRoot)
    expect(() =>
      createHostWiring({
        repoRoot,
        schemaRoot: WR_SCHEMA_ROOT,
        projectId: 'PRJ-1',
        dataDir,
        adapter: new FakeSessionAdapter(),
        launcherAdapter: makeFakeLauncherAdapter(),
        workspaceRoots: [repoRoot],
      }),
    ).toThrow(HostWiringError)
    // The unwound store connection left the file usable:
    const db = rawDb(dataDir)
    try {
      expect(existsSync(join(dataDir, 'research.sqlite'))).toBe(true)
      db.prepare('SELECT user_version FROM pragma_user_version').get()
    } finally {
      db.close()
    }
  })
})
