/**
 * WP-7.2 — context readers: shared type face (the read-only surface).
 *
 * 计划书 §26.1（Read-only Investigator Agent — 可读清单, 原文为准）:
 * plugin state / ResearchHistory / DSH Session / Git history/diff /
 * workspace files / Artifact refs. 本 WP 交付其中五类**只读上下文
 * 读取器**的类型面（readers 清单, 任务书口径）:
 *
 *   1. plugin 状态快照   — `plugin-state.ts`（声明式树 + 事件史折叠的
 *      Current 投影 + run 表 + Intervention + 语义注册表计数）;
 *   2. session 查询      — `session-query.ts`（经 sessionlink 指针面:
 *      DSH live session × 指针行 × run 表 — INV-DB-2 指针是唯一绑定）;
 *   3. git diff         — `git-diff.ts`（经 audit strict 面:
 *      `runStrictAudit` W1/W4/W5/W13 结构化报告原样透出）;
 *   4. git log          — `git-log.ts`（经 git 白名单 W6 只读面:
 *      声明式树路径的文件历史, 与 audit 同纪律 — 唯一 git 面 + 只读）;
 *   5. artifact refs    — `artifact-refs.ts`（经语义注册表: 冻结
 *      derived_state 语义行 §7.3「外部资源 registry, 不复制内容」）。
 *
 * 只读边界（类型面 — 同 WP-6.1 audit / WP-6.3 reconcile 纪律）:
 *  - 本包公开面**不存在任何写方法**: 全部读者输出 readonly 结构, 读者
 *    类只有 `read(scope)`; 唯一的可变状态是调用方注入的 face（树读取 /
 *    指针读取 / 语义行读取 — 全部是读操作）;
 *  - 零 DSH import（INV-PERM-5）; 读者经注入的窄 face 与
 *    audit/git/domain/history 层对话（ARCHITECTURE §2.2: service →
 *    domain/history/persistence/git/workspace/audit 允许方向）;
 *  - 结构化输出（任务书主线目标 1）: 每类 reader 输出一个冻结形状的
 *    readonly 快照（`*Snapshot`）, 供 `investigationContext`（context.ts
 *    组装器）聚合 — 不携带自由文本, 不携带第二套类型表。
 *
 * 失败面: 读者抛结构化 `ReaderError`（稳定机器码 — 调用方可分支）;
 * 组装器（context.ts）把每类失败捕获为**结构化失败段**
 * （`ReaderSection.ok === false`）— 单类读取失败不吞掉其余四类,
 * 失败在输出里大声显形（绝不静默省略 — 同 WP-6.4 fail-loud 纪律）。
 */

import type { AuditReport } from '../../../audit/strict/index.js'

/* ------------------------------------------------------------------ *
 * 错误面（稳定机器码 — 组装器/测试分支用）
 * ------------------------------------------------------------------ */

export type ReaderErrorCode =
  /** 输入/范围畸形（scope 双指 / 未知 topic|workstream — 精确指名）。 */
  | 'RD_INPUT'
  /** plugin 状态面读取失败（树加载 / 折叠 / 查询面异常, cause 保留）。 */
  | 'RD_STATE'
  /** session 查询面读取失败（指针面 / run 表 / adapter 异常）。 */
  | 'RD_SESSION'
  /** git diff 读取失败（audit strict 面: 非 repo / git 错误, cause 保留）。 */
  | 'RD_GIT_DIFF'
  /** git log 读取失败（git W6 面异常, cause 保留）。 */
  | 'RD_GIT_LOG'
  /** artifact refs 读取失败（语义行读取 / 解码异常, cause 保留）。 */
  | 'RD_ARTIFACT'

/** 读者结构化错误（never a raw driver exception 上抛的裸形态）。 */
export class ReaderError extends Error {
  readonly code: ReaderErrorCode

  constructor(code: ReaderErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ReaderError'
    this.code = code
  }
}

export function isReaderError(error: unknown): error is ReaderError {
  return error instanceof ReaderError
}

/* ------------------------------------------------------------------ *
 * 范围（topic | workstream | project-wide — 至多一个）
 * ------------------------------------------------------------------ */

/**
 * 调查上下文范围: `workstreamId` 或 `topicId`（至多一个 — 双指是
 * RD_INPUT; 双缺 = project-wide 全集）。
 */
export interface InvestigationScope {
  readonly topicId?: string
  readonly workstreamId?: string
}

/** 冻结的 scope 校验（全部读者共用 — 单一来源）。 */
export function assertInvestigationScope(scope: InvestigationScope): void {
  if (scope === null || typeof scope !== 'object') {
    throw new ReaderError('RD_INPUT', 'assertInvestigationScope: scope must be an object ({} = project-wide)')
  }
  if (scope.topicId !== undefined && scope.workstreamId !== undefined) {
    throw new ReaderError(
      'RD_INPUT',
      `assertInvestigationScope: topic ${JSON.stringify(scope.topicId)} and workstream ${JSON.stringify(scope.workstreamId)} are mutually exclusive (at most one scope axis)`,
    )
  }
  if (scope.topicId !== undefined && (typeof scope.topicId !== 'string' || scope.topicId.length === 0)) {
    throw new ReaderError('RD_INPUT', 'assertInvestigationScope: topicId must be a non-empty string when present')
  }
  if (scope.workstreamId !== undefined && (typeof scope.workstreamId !== 'string' || scope.workstreamId.length === 0)) {
    throw new ReaderError('RD_INPUT', 'assertInvestigationScope: workstreamId must be a non-empty string when present')
  }
}

/* ------------------------------------------------------------------ *
 * 组装器段（成功/失败 判别联合 — 单类失败大声显形, 不吞其余）
 * ------------------------------------------------------------------ */

/** 一类的失败投影（机器码 + 消息 — 原样大声, 不降级）。 */
export interface ReaderFailure {
  readonly code: string
  readonly message: string
}

/** 组装器的一段: 成功带数据, 失败带结构化错误（二选一 — 类型面封闭）。 */
export type ReaderSection<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: ReaderFailure }

/* ------------------------------------------------------------------ *
 * 1. plugin 状态快照（§26.1「plugin state」— 控制面自身状态）
 * ------------------------------------------------------------------ */

/** 折叠后的 Current 区任务投影（声明式定义 ⊕ WS 事件史, 同 rpc getWorkstream 口径）。 */
export interface PluginStateTask {
  readonly id: string
  readonly title: string
  readonly execution: 'PLANNED' | 'ACTIVE' | 'PAUSED' | 'EXECUTED' | 'CANCELLED'
  readonly validation: 'NOT_REQUIRED' | 'PENDING' | 'UNDER_REVIEW' | 'PASSED' | 'FAILED'
}

/** 一个 workstream 的插件状态投影（声明式 lifecycle + 折叠任务 + 计数）。 */
export interface PluginStateWorkstream {
  readonly id: string
  readonly topicId: string
  readonly title: string
  readonly lifecycle: 'PLANNED' | 'REALIZED' | 'DROPPED'
  readonly tasks: readonly PluginStateTask[]
  readonly openPlanForks: number
  readonly runningRuns: number
}

/** run 表投影（§6.1 字段面 — 只读透出, 不复制 session 内容, INV-DB-2）。 */
export interface PluginStateRun {
  readonly id: string
  readonly workstreamId: string
  readonly taskId: string | null
  readonly status: string
  readonly intent: string | null
  readonly startedAt: number
  readonly endedAt: number | null
}

/** Intervention 投影（§9.2 记录面 — GUI 分组口径）。 */
export interface PluginStateIntervention {
  readonly id: string
  readonly title: string
  readonly detail: string | null
  readonly status: 'OPEN' | 'PENDING' | 'CLOSED'
  readonly workstreamIds: readonly string[]
  readonly createdAt: number
}

/** 语义注册表计数面（§5.3–5.5 冻结事件族的 derived 态 — 计数, 非行）。 */
export interface PluginStateSemanticCounts {
  readonly claims: number
  readonly activeClaims: number
  readonly retractedClaims: number
  readonly facts: number
  readonly artifacts: number
  readonly missingArtifacts: number
}

/**
 * plugin 状态快照（§26.1 第一可读项的结构化输出）: 声明式真源（树）+
 * 事件史折叠（Current 区）+ run 表 + Intervention + 语义计数。
 */
export interface PluginStateSnapshot {
  readonly project: {
    readonly id: string
    readonly title: string
    readonly description: string | null
    readonly importance: number
    readonly attentionMode: string
    readonly targetDate: number | null
  } | null
  readonly topics: readonly { readonly id: string; readonly title: string; readonly workstreamIds: readonly string[] }[]
  readonly workstreams: readonly PluginStateWorkstream[]
  readonly runs: readonly PluginStateRun[]
  readonly interventions: {
    readonly open: readonly PluginStateIntervention[]
    readonly pending: readonly PluginStateIntervention[]
  }
  readonly semantic: PluginStateSemanticCounts
}

/* ------------------------------------------------------------------ *
 * 2. session 查询快照（§26.1「DSH Session」— 经 sessionlink 指针面）
 * ------------------------------------------------------------------ */

/** 指针行投影（sessionlink `SessionPointer` — INV-DB-2 绑定事实, 无内容）。 */
export interface SessionPointerProjection {
  readonly workstreamId: string
  readonly taskId: string | null
  readonly intent: string | null
  readonly lastSeq: number
  readonly runId: string | null
  readonly runStartedAt: number | null
}

/** 一个 live session 的查询投影（DSH 摘要 × 指针行 × run 行）。 */
export interface SessionQueryEntry {
  readonly sessionId: string
  readonly cwd: string | null
  readonly title: string | null
  readonly running: boolean
  readonly createdAt: number
  readonly origin: 'subagent' | null
  /** sessionlink 指针面: 未绑定 = `null`（诚实边界, 不虚构绑定）。 */
  readonly pointer: SessionPointerProjection | null
  /** 该 session 的 run 行（dsh_session_id 关联; 无 = `null`）。 */
  readonly run: {
    readonly id: string
    readonly workstreamId: string
    readonly status: string
    readonly startedAt: number
    readonly endedAt: number | null
  } | null
}

/** session 查询快照（范围 = 绑定 workstream / topic 的 WS 集合）。 */
export interface SessionQuerySnapshot {
  readonly sessions: readonly SessionQueryEntry[]
}

/* ------------------------------------------------------------------ *
 * 3. git diff 快照（§26.1「Git history/diff」— 经 audit strict 面）
 * ------------------------------------------------------------------ */

/**
 * git diff 读取器输出 = audit strict 面 `AuditReport` 原样（W1/W4/W5/W13
 * 结构化事实 — 不重投影、不加语义; 「只回答工作区发生了哪些插件尚未
 * 登记的变化」, 计划书 §22.2 边界）。
 */
export type GitDiffSnapshot = AuditReport

/* ------------------------------------------------------------------ *
 * 4. git log 快照（§26.1「Git history/diff」— 经 git W6 只读面）
 * ------------------------------------------------------------------ */

/** 一条文件历史（W6 冻结格式串: OID / 作者时间 / 标题）。 */
export interface GitLogEntryProjection {
  readonly oid: string
  readonly authorDate: string
  readonly subject: string
}

/**
 * git log 读取器输出: 声明式树路径（范围换算: ws →
 * `.research/topics/<t>/workstreams/<w>`; topic → `.research/topics/<t>`;
 * project → `.research`）的提交历史（`maxCount` 截断 — 分页读 §9 口径）。
 */
export interface GitLogSnapshot {
  readonly path: string
  readonly headOid: string | null
  readonly entries: readonly GitLogEntryProjection[]
  readonly maxCount: number
}

/* ------------------------------------------------------------------ *
 * 5. artifact refs 快照（§26.1「Artifact refs」— 经语义注册表）
 * ------------------------------------------------------------------ */

/** 一个注册 artifact 的引用投影（§7.3「registry, 不复制内容」）。 */
export interface ArtifactRefProjection {
  readonly id: string
  readonly workstreamId: string
  readonly type: string
  readonly title: string
  readonly uri: string
  readonly status: 'REGISTERED' | 'MISSING'
  readonly relatedTask: string | null
  readonly recordedAt: number
}

/** artifact refs 读取器输出（范围过滤后的注册表投影 — 全状态保留）。 */
export interface ArtifactRefsSnapshot {
  readonly count: number
  readonly artifacts: readonly ArtifactRefProjection[]
}

/* ------------------------------------------------------------------ *
 * 组装器聚合（主线目标 2: investigationContext 输出）
 * ------------------------------------------------------------------ */

/**
 * 调查上下文聚合（`investigationContext(topicOrWs)` 输出）: 五类 reader
 * 段 + 范围回显 + 生成时间。默认 transient（计划书 §26.2 — 仅用户明确
 * 保存或被正式引用时落 AnalysisRecord, 归 WP-7.3; 本聚合不落盘）。
 */
export interface InvestigationContext {
  readonly generatedAt: number
  readonly scope: InvestigationScope
  readonly pluginState: ReaderSection<PluginStateSnapshot>
  readonly sessions: ReaderSection<SessionQuerySnapshot>
  readonly gitDiff: ReaderSection<GitDiffSnapshot>
  readonly gitLog: ReaderSection<GitLogSnapshot>
  readonly artifactRefs: ReaderSection<ArtifactRefsSnapshot>
}
