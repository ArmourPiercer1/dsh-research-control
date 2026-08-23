/**
 * WP-7.3 — `AnalysisTransientReader`: transient 结果读取面（任务目标 1 —
 * 计划书 §26.2「默认 transient」的 GUI 数据面）。
 *
 * ## 数据来源链（任务书逐字: 「launcher 的会话指针 → sessionlink 读取面」）
 *
 * `InvestigatorLaunchResult.sessionId`（WP-7.1 launcher 的会话指针 —
 * transient 宿主引用, 不虚构持久化）→ `read(sessionId)` → 三个注入的
 * **只读**端口（`AnalysisTransientReaderInput`）:
 *
 *   1. `pointerOf(sessionId)` — sessionlink 指针行（WP-2.6
 *      `SessionLinkService.pointerOf` — meta KV 直读; INV-DB-2「只存
 *      session_id、Run 绑定、事件指针、摘要」的唯一持久绑定面; 未绑定 =
 *      null 诚实透出 — investigator 会话通常不绑定 formal workstream,
 *      它是一次性只读调查; 不用 cwd 猜, 同 WP-7.2 绑定语义口径）;
 *   2. `listSessions()` — DSH live session 摘要（WP-0.4
 *      `DshSessionAdapter.listSessions` 端口面 — 只读列出, **不进 session
 *      内容** — INV-DB-2 不复制 raw log; investigator 的中间输出文本在
 *      DSH session 内, 由 DSH GUI 呈现; 本面只呈现指针/摘要/运行状态 —
 *      这正是 transient 的语义: 不落任何 operational 表）;
 *   3. `runs({dshSessionId})` — run 表 `dsh_session_id` 关联（§6.1 记录面;
 *      每 session 至多一条 formal run）。
 *
 * ## 零写入的类型面断言（INV-PERM-3 — 任务测试项「transient 零写入」）
 *
 *  - `AnalysisTransientReaderInput` 的成员集合**全是读操作** — 接口上
 *    不存在任何 run/exec/insert/set/update 成员: 写能力在该面上**无法
 *    表达**（同 WP-7.1 请求闭集纪律的读面对偶: 不是「拒绝写」, 而是「写
 *    不存在」）;
 *  - 本类只有 `read` 一个公开方法 — 原型面零写方法（tests/analysis/
 *    transient.test.ts 钉死 `Object.getOwnPropertyNames(prototype)` 面）;
 *  - 行为面: `read` 的全部 I/O 都是经上述三个只读端口的 SELECT 语义 —
 *    测试以真实 sqlite + 写计数探针钉死「transient 路径零写入」
 *    （`analysis_record` 行数不变 + 驱动 write 调用计数零）。
 *
 * 只读边界: 零 DSH import（经注入的端口 face — `SessionSummary` 是插件
 * 自有 shared 接口, 实现在 dsh-adapter, 本层不见 ctx, INV-PERM-5）。
 */

import {
  AnalysisError,
  type AnalysisTransientReaderInput,
  type AnalysisTransientSnapshot,
  type TransientRunRow,
} from './types.js'

/**
 * transient 读取面（构造注入三个只读端口; `read` 是唯一公开方法）。
 *
 * @throws {AnalysisError} `AN_INPUT` — 端口缺位（构造）/ sessionId 畸形;
 *   `AN_STORE` — 只读端口调用失败（cause 保留）。
 */
export class AnalysisTransientReader {
  readonly #input: AnalysisTransientReaderInput

  constructor(input: AnalysisTransientReaderInput) {
    if (
      input === null ||
      typeof input !== 'object' ||
      typeof input.pointerOf !== 'function' ||
      typeof input.listSessions !== 'function' ||
      typeof input.runs !== 'function'
    ) {
      throw new AnalysisError({
        code: 'AN_INPUT',
        message: 'AnalysisTransientReader: input must carry the three READ faces (pointerOf / listSessions / runs) — the transient face has no write members by construction (INV-PERM-3 零写入类型面)',
      })
    }
    this.#input = input
  }

  /**
   * 读取一个 investigator 会话的 transient 快照（全读 — 零写入）。
   *
   * 诚实透出（不虚构）: `session = null`（live 列表无此 id — 已 dispose）/
   * `pointer = null`（未绑定 workstream）/ `run = null`（无 formal run）—
   * 三个 null 各自独立, 展示层逐字段渲染缺席态。
   */
  read(sessionId: string): AnalysisTransientSnapshot {
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      throw new AnalysisError({
        code: 'AN_INPUT',
        message: `read: sessionId must be a non-empty string (the launcher session pointer — InvestigatorLaunchResult.sessionId; got ${JSON.stringify(String(sessionId))})`,
      })
    }

    // 1. sessionlink 指针行（读取面真值 — 未绑定 = null）。
    let pointer: AnalysisTransientSnapshot['pointer']
    try {
      pointer = this.#input.pointerOf(sessionId)
    } catch (cause) {
      throw this.#wrap('pointerOf', cause)
    }
    if (pointer !== null && (pointer === undefined || typeof pointer !== 'object')) {
      throw new AnalysisError({
        code: 'AN_STORE',
        message: `read: pointerOf(${sessionId}) returned a non-pointer value (expected SessionPointer or null; got ${JSON.stringify(pointer)}) — port contract violation, loud`,
      })
    }

    // 2. live session 摘要（只读列出 — 缺席 = null 诚实透出）。
    let session: AnalysisTransientSnapshot['session'] = null
    try {
      const sessions = this.#input.listSessions()
      for (const s of sessions) {
        if (s !== null && typeof s === 'object' && s.id === sessionId) {
          session = s
          break
        }
      }
    } catch (cause) {
      throw this.#wrap('listSessions', cause)
    }

    // 3. run 行（dsh_session_id 关联 — 每 session 至多一条; 取首条）。
    let run: TransientRunRow | null = null
    try {
      const rows = this.#input.runs({ dshSessionId: sessionId })
      if (rows.length > 0) run = rows[0]!
    } catch (cause) {
      throw this.#wrap('runs', cause)
    }

    return { sessionId, session, pointer, run }
  }

  #wrap(face: string, cause: unknown): AnalysisError {
    if (cause instanceof AnalysisError) return cause
    const msg = cause instanceof Error ? cause.message : String(cause)
    return new AnalysisError({ code: 'AN_STORE', message: `transient read: the ${face} face failed: ${msg}`, cause })
  }
}
