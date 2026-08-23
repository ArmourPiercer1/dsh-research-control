/**
 * WP-7.2 — readers 生产组装（`createWiringReaders`）: HostWiring →
 * 五类 reader 窄 face 的生产映射（主线目标 1/2 的接线面）。
 *
 * 组装纪律（同 wiring 组合根口径）:
 *  - **fresh 读取**: 树加载面每次调用 fresh `loadResearchTree`（文件即
 *    真值, §8 低频 unary 面 — 同 rpc 查询面口径）; 语义行 fresh
 *    `readDerivedState`（derived_state 是重建缓存 — 每次重读, 不缓存）;
 *  - **单一真源复用**: task 折叠 = rpc `getWorkstream` 同一投影口径
 *    （`foldEvents` over `store.listRange` — TASK_EXECUTION_CHANGED /
 *    TASK_VALIDATION_CHANGED, 冻结词汇表护栏）; 语义行 = wiring
 *    `readSemanticState` 同一单源（`semantics:<project>` derived 行 +
 *    `jsonToSemanticState` 严格解码）;
 *  - **零新 I/O 通道**: 全部 face 落在既有只读面上（树 / meta KV /
 *    run 表 / 指针行 / git 白名单 / derived 行）— 本模块不引入第二
 *    套数据通道, 零 DSH import（INV-PERM-5; 树 reader = checkpoint
 *    层既有 fs reader 复用）。
 *
 * 依赖的 HostWiring 面（WP-7.2 扩展, 见 create.ts）: `schemaRoot` /
 * `sessionAdapter`（session 查询面）/ `inbox` / `auditRefresh`（RR-018
 * 骑手段 — 读者本身不消费后两者, 同族面聚合在 wiring 上便于消费方
 * （investigator 启动面 WP-7.1）一次拿到）。
 */

import { join } from 'node:path'

import {
  loadResearchTree,
  type ResearchTree,
} from '../../../domain/loader/index.js'
import type { SemanticState } from '../../../domain/semantics/index.js'
import { foldEvents } from '../../../history/replay/index.js'
import { readDerivedState } from '../../../history/replay/index.js'
import { FsResearchReader } from '../../checkpoint/index.js'
import {
  normalizeWorkspacePolicy,
  type AuditPolicy,
} from '../../../audit/strict/index.js'
import type { GitOptions } from '../../../git/index.js'
import type { HostWiring } from '../../wiring/index.js'
import {
  jsonToSemanticState,
  semanticStateKey,
} from '../../wiring/semantics.js'

import { ArtifactRefsReader } from './artifact-refs.js'
import { GitDiffReader } from './git-diff.js'
import { GitLogReader, DEFAULT_LOG_MAX_COUNT } from './git-log.js'
import { PluginStateReader } from './plugin-state.js'
import { SessionQueryReader } from './session-query.js'
import type { InvestigationReaders } from './context.js'
import type {
  InvestigationScope,
  PluginStateSemanticCounts,
  PluginStateTask,
} from './types.js'
import type { PluginStateInterventionRow, PluginStateRunRow } from './plugin-state.js'
import { initialSemanticState } from '../../../domain/semantics/index.js'

/** readers 生产组装的可注入项（git 护栏 / 历史窗口 — 缺省 = 层默认）。 */
export interface WiringReadersOptions {
  readonly gitOptions?: GitOptions
  readonly logMaxCount?: number
}

const TASK_EXECUTIONS = new Set(['PLANNED', 'ACTIVE', 'PAUSED', 'EXECUTED', 'CANCELLED'])
const TASK_VALIDATIONS = new Set(['NOT_REQUIRED', 'PENDING', 'UNDER_REVIEW', 'PASSED', 'FAILED'])

/**
 * 生产组装: `HostWiring` → 五类 reader（`investigationContext` 的输入面）。
 * 读者在调用时 fresh 读取（无构造期 I/O — 组装本身零副作用）。
 */
export function createWiringReaders(wiring: HostWiring, options: WiringReadersOptions = {}): InvestigationReaders {
  const reader = new FsResearchReader(wiring.researchRoot)
  const declarativeDir = join(wiring.schemaRoot, 'declarative')
  const loadTree = (): ResearchTree => {
    const load = loadResearchTree(reader, wiring.researchRoot, declarativeDir)
    if (load.errors.length > 0) {
      // 树坏 = 大声（结构化）— 读者段降级为失败段, 组装器不吞。
      throw new Error(
        `the .research tree failed to load: ` + load.errors.map((e) => `[${e.code}] ${e.file || '<root>'}: ${e.message}`).join('; '),
      )
    }
    return load.tree
  }

  const semanticKey = semanticStateKey(wiring.projectId)
  const readSemanticState = (): SemanticState => {
    const derived = readDerivedState(wiring.store)
    const raw = derived.get(semanticKey)
    return raw === undefined ? initialSemanticState() : jsonToSemanticState(raw, semanticKey)
  }

  const pluginState = new PluginStateReader({
    readTree: loadTree,
    taskStates: (workstreamId) => foldTaskStates(wiring, workstreamId),
    runs: (filter) =>
      wiring.tables
        .listRuns(filter === undefined ? {} : { workstreamId: filter.workstreamId })
        .map(
          (r): PluginStateRunRow => ({
            id: r.id,
            workstreamId: r.workstream_id,
            taskId: r.task_id ?? null,
            status: r.status,
            intent: r.intent ?? null,
            startedAt: r.started_at,
            endedAt: r.ended_at ?? null,
          }),
        ),
    interventions: (): readonly PluginStateInterventionRow[] =>
      wiring.interventions.listInterventions().map((iv) => ({
        id: iv.id,
        title: iv.title,
        detail: iv.detail ?? null,
        status: iv.status,
        workstreamIds: [...iv.workstream_ids],
        createdAt: iv.created_at,
      })),
    openPlanForkCount: (wsId) => wiring.planForks.countOpen(wsId),
    semanticCounts: (): PluginStateSemanticCounts => semanticCountsOf(readSemanticState()),
  })

  const sessions = new SessionQueryReader({
    listSessions: () => wiring.sessionAdapter.listSessions(),
    pointerOf: (sessionId) => {
      const p = wiring.sessionLink.pointerOf(sessionId)
      return p === null ? null : { ...p }
    },
    runs: (filter) =>
      wiring.tables
        .listRuns({ dshSessionId: filter.dshSessionId })
        .map((r) => ({
          id: r.id,
          workstreamId: r.workstream_id,
          status: r.status,
          startedAt: r.started_at,
          endedAt: r.ended_at ?? null,
        })),
    topicWorkstreams: (topicId) => topicWorkstreamsOf(loadTree, topicId),
  })

  const gitDiff = new GitDiffReader({
    workspaceRoot: wiring.repoRoot,
    policy: (): AuditPolicy | null => {
      const tree = loadTree()
      return tree.workspace === null ? null : normalizeWorkspacePolicy(tree.workspace)
    },
    ...(options.gitOptions !== undefined ? { gitOptions: options.gitOptions } : {}),
  })

  const gitLog = new GitLogReader({
    repoRoot: wiring.repoRoot,
    resolveLogPath: (scope: InvestigationScope): string => {
      const tree = loadTree()
      if (scope.workstreamId !== undefined) {
        const topic = tree.topics.find((t) => t.workstreams.some((w) => w.id === scope.workstreamId))
        if (topic === undefined) {
          throw new GitLogScopeError(`workstream ${scope.workstreamId} does not exist in the declarative tree`)
        }
        return `.research/topics/${topic.id}/workstreams/${scope.workstreamId}`
      }
      if (scope.topicId !== undefined) {
        const topic = tree.topics.find((t) => t.id === scope.topicId)
        if (topic === undefined) {
          throw new GitLogScopeError(`topic ${scope.topicId} does not exist in the declarative tree`)
        }
        return `.research/topics/${topic.id}`
      }
      return '.research'
    },
    ...(options.logMaxCount !== undefined ? { maxCount: options.logMaxCount } : {}),
    ...(options.gitOptions !== undefined ? { gitOptions: options.gitOptions } : {}),
  })

  const artifactRefs = new ArtifactRefsReader({
    readArtifacts: () => readSemanticState().artifacts,
    workstreamsInScope: (scope) => {
      if (scope.workstreamId !== undefined) return [scope.workstreamId]
      if (scope.topicId !== undefined) {
        const ws = topicWorkstreamsOf(loadTree, scope.topicId)
        return ws
      }
      return undefined
    },
  })

  return { pluginState, sessions, gitDiff, gitLog, artifactRefs }
}

/* ------------------------------------------------------------------ *
 * face 实现（纯组合 — 无新 I/O 通道）
 * ------------------------------------------------------------------ */

/** Current 区折叠（rpc `getWorkstream` 同一投影口径 — 单一真源）。 */
function foldTaskStates(
  wiring: HostWiring,
  workstreamId: string,
): { get(taskId: string): { execution: PluginStateTask['execution']; validation: PluginStateTask['validation'] } | undefined } {
  const events = wiring.store.listRange(workstreamId, 1)
  type State = { execution: PluginStateTask['execution']; validation: PluginStateTask['validation'] }
  const folded = foldEvents(events, (state: Map<string, State>, ev) => {
    if (ev.eventType === 'TASK_EXECUTION_CHANGED') {
      const p = ev.payload as { task_id?: unknown; to?: unknown }
      if (typeof p.task_id === 'string' && typeof p.to === 'string' && TASK_EXECUTIONS.has(p.to) && state.has(p.task_id)) {
        const cur = state.get(p.task_id)!
        state.set(p.task_id, { ...cur, execution: p.to as State['execution'] })
      }
    } else if (ev.eventType === 'TASK_VALIDATION_CHANGED') {
      const p = ev.payload as { task_id?: unknown; to?: unknown }
      if (typeof p.task_id === 'string' && typeof p.to === 'string' && TASK_VALIDATIONS.has(p.to) && state.has(p.task_id)) {
        const cur = state.get(p.task_id)!
        state.set(p.task_id, { ...cur, validation: p.to as State['validation'] })
      }
    }
    return state
  }, new Map<string, State>())
  return folded
}

/** topic → WS id 集合（未知 topic = `null` — 各 reader 映射 RD_INPUT）。 */
function topicWorkstreamsOf(loadTree: () => ResearchTree, topicId: string): string[] | null {
  const tree = loadTree()
  const topic = tree.topics.find((t) => t.id === topicId)
  if (topic === undefined) return null
  return topic.workstreams.map((w) => w.id)
}

function semanticCountsOf(state: SemanticState): PluginStateSemanticCounts {
  let activeClaims = 0
  let retractedClaims = 0
  for (const c of state.claims.values()) {
    if (c.status === 'ACTIVE') activeClaims += 1
    else retractedClaims += 1
  }
  let missingArtifacts = 0
  for (const a of state.artifacts.values()) {
    if (a.status === 'MISSING') missingArtifacts += 1
  }
  return {
    claims: state.claims.size,
    activeClaims,
    retractedClaims,
    facts: state.facts.size,
    artifacts: state.artifacts.size,
    missingArtifacts,
  }
}

/** 内部: 范围换算失败（组装器捕获为 RD_INPUT 段 — code 面由读者透传）。 */
class GitLogScopeError extends Error {
  readonly code = 'RD_INPUT'
}

export { DEFAULT_LOG_MAX_COUNT }
