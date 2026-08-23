/**
 * WP-7.2 — reader 2/5: session 查询（计划书 §26.1 可读清单「DSH Session」—
 * 经 sessionlink 指针面）。
 *
 * 读什么（只读 — 类型面）:
 *  - DSH live session 摘要（`listSessions` face — WP-0.4 `DshSessionAdapter`
 *    端口面, DSH_ADAPTER §7 映射; 只读列出, 不进 session 内容 —
 *    `querySession` 历史面不在本 reader 范围, 历史读取归 session.history
 *    RPC 面 / WP-7.3 呈现）;
 *  - sessionlink 指针行（`pointerOf` face — INV-DB-2「session_id → Run
 *    绑定 + 事件指针, 无 raw log」的唯一绑定真值 — 经
 *    `SessionLinkService.pointerOf` 直读 meta 行）;
 *  - run 行（`runs` face — `dsh_session_id` 关联, §6.1 记录面）。
 *
 * 范围语义: workstream scope = 指针行 `workstreamId` 命中的 session
 * （绑定语义 — 指针是 sessionlink 的权威绑定, 不用 cwd 猜）; topic scope
 * = 该 topic WS 集合的指针命中; project scope = 全部 live session
 * （含未绑定者 — `pointer: null` 诚实透出, 不虚构绑定）。
 *
 * 只读边界: 本类只有 `read(scope)`; 零写方法; 零 DSH import（经注入的
 * 端口 face — `DshSessionAdapter` 是插件自有 shared 接口, 实现在
 * dsh-adapter, 本层不见 ctx）。
 */

import type { SessionSummary } from '../../../../shared/host-adapter-ports.js'
import {
  assertInvestigationScope,
  ReaderError,
  type InvestigationScope,
  type SessionPointerProjection,
  type SessionQueryEntry,
  type SessionQuerySnapshot,
} from './types.js'

/** sessionlink 指针面行形状（`SessionPointer` 只读投影 — 结构镜像）。 */
export interface SessionPointerRow {
  readonly workstreamId: string
  readonly taskId?: string
  readonly intent?: string
  readonly lastSeq: number
  readonly runId: string | null
  readonly runStartedAt: number | null
}

/** run 表 face 行形状（`dsh_session_id` 关联所需的最小面）。 */
export interface SessionQueryRunRow {
  readonly id: string
  readonly workstreamId: string
  readonly status: string
  readonly startedAt: number
  readonly endedAt: number | null
}

/**
 * reader 2 输入面（窄 face — 生产组装见 `from-wiring.ts`; 测试注入 stub）。
 * 全部成员都是只读操作。
 */
export interface SessionQueryReaderInput {
  /** DSH live session 摘要列表（`DshSessionAdapter.listSessions` 端口面）。 */
  readonly listSessions: () => readonly SessionSummary[]
  /** sessionlink 指针面（`SessionLinkService.pointerOf` — 未绑定 = null）。 */
  readonly pointerOf: (sessionId: string) => SessionPointerRow | null
  /** run 表查询面（`dshSessionId` 过滤 — 每 session 至多一条 run）。 */
  readonly runs: (filter: { readonly dshSessionId: string }) => readonly SessionQueryRunRow[]
  /** topic → WS id 集合（未知 topic = `null` ⇒ RD_INPUT 大声）。 */
  readonly topicWorkstreams: (topicId: string) => string[] | null
}

export class SessionQueryReader {
  constructor(readonly input: SessionQueryReaderInput) {
    if (input === null || typeof input !== 'object' || typeof input.listSessions !== 'function') {
      throw new ReaderError('RD_INPUT', 'SessionQueryReader: input.listSessions (a DSH session list face) is required')
    }
  }

  /** 读取 session 查询快照（范围见模块头）。失败 = `ReaderError`（RD_SESSION/RD_INPUT）。 */
  read(scope: InvestigationScope): SessionQuerySnapshot {
    assertInvestigationScope(scope)

    // 范围 → 允许的指针 workstream 集合（null = 不限）。
    let allowedWs: ReadonlySet<string> | null = null
    if (scope.workstreamId !== undefined) {
      allowedWs = new Set([scope.workstreamId])
    } else if (scope.topicId !== undefined) {
      const wsIds = safeFace('topicWorkstreams', this.input.topicWorkstreams, scope.topicId)
      if (wsIds === null) {
        throw new ReaderError('RD_INPUT', `sessions: topic ${scope.topicId} does not exist in the declarative tree`)
      }
      allowedWs = new Set(wsIds)
    }

    let sessions: readonly SessionSummary[]
    try {
      sessions = this.input.listSessions()
    } catch (cause) {
      throw new ReaderError('RD_SESSION', `sessions: the session list face failed: ${causeMessage(cause)}`, { cause })
    }

    const entries: SessionQueryEntry[] = []
    for (const s of sessions) {
      const pointer = safeFace('pointerOf', this.input.pointerOf, s.id)
      if (allowedWs !== null) {
        // 绑定语义: 指针未命中范围 ⇒ 该 session 不在本范围内。
        if (pointer === null || !allowedWs.has(pointer.workstreamId)) continue
      }
      let run: SessionQueryEntry['run'] = null
      try {
        const rows = this.input.runs({ dshSessionId: s.id })
        if (rows.length > 0) {
          const r = rows[0]!
          run = {
            id: r.id,
            workstreamId: r.workstreamId,
            status: r.status,
            startedAt: r.startedAt,
            endedAt: r.endedAt,
          }
        }
      } catch (cause) {
        throw new ReaderError('RD_SESSION', `sessions: the run table face failed for session ${s.id}: ${causeMessage(cause)}`, { cause })
      }
      entries.push(projectEntry(s, pointer, run))
    }

    return { sessions: entries }
  }
}

function projectEntry(s: SessionSummary, pointer: SessionPointerRow | null, run: SessionQueryEntry['run']): SessionQueryEntry {
  const pointerProjection: SessionPointerProjection | null =
    pointer === null
      ? null
      : {
          workstreamId: pointer.workstreamId,
          taskId: pointer.taskId ?? null,
          intent: pointer.intent ?? null,
          lastSeq: pointer.lastSeq,
          runId: pointer.runId,
          runStartedAt: pointer.runStartedAt,
        }
  return {
    sessionId: s.id,
    cwd: s.cwd ?? null,
    title: s.title ?? null,
    running: s.running,
    createdAt: s.createdAt,
    origin: s.origin ?? null,
    pointer: pointerProjection,
    run,
  }
}

function safeFace<TArgs extends unknown[], TResult>(
  name: string,
  face: (...args: TArgs) => TResult,
  ...args: TArgs
): TResult {
  try {
    return (face as (...a: unknown[]) => TResult)(...args)
  } catch (cause) {
    throw new ReaderError('RD_SESSION', `sessions: the ${name} face failed: ${causeMessage(cause)}`, { cause })
  }
}

function causeMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
