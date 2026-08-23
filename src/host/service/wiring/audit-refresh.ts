/**
 * WP-7.2（RR-018①）— audit 生产触发: 审计链刷新段（wiring 的 refresh 段）。
 *
 * RR-018① 原文缺口: 「审计链无端到端测试与生产触发（audit 服务未挂
 * [Service.init] 刷新循环）」。本模块交付该生产触发面:
 *
 * ```text
 * run()
 *  1. fresh 树加载（workspace.yaml policy 面 — 文件即真值; 树坏 =
 *     默认 policy + 大声 warn — 刷新不阻塞, 查询主路径自己 loud）
 *  2. runStrictAudit（WP-6.1: W1/W4/W5/W13 只读 git 面）
 *  3. DiscoveryScanner.scan（WP-6.2: fs 只读扫描 + 快照增量差分 —
 *     operational KV 基线; 失败不毁基线, 其既有纪律）
 *  4. feedUntracked（W4 untracked → discovery 归一化 feed 通道）
 *  5. classifyDiscrepancies（WP-6.3: strict + discovery 差分 + 声明态
 *     → 结构化 Discrepancy 清单 — 全机械规则, §22.2 边界）
 *  6. 机械路由（§22.3 三档的机械半边 — 不触达用户显式档位面
 *     `reconcileDiscrepancies`, 那是用户 actor 面, INV-PERM-4）:
 *     - AUTO_RECONCILE / PROPOSE_RECONCILIATION ⇒ Inbox 机械入口
 *       `captureMechanical`（条目 = `toInboxEntry` 草稿, WP-6.3 缝）;
 *     - ESCALATE ⇒ 单批 `escalateMechanical`（capture-first + 高影响
 *       机械判定 ⇒ Intervention 联动 — WP-6.4 面; 证据 = 机械事实
 *       聚合, 零语义判断）。
 *  7. 去重基线（operational KV `audit-refresh:reported-v1` — 指纹集合:
 *     已报告且未变的 finding 不重复落条目; 消失的 finding 从基线移除,
 *     复发重新报告 — 同 WP-6.2 快照增量差分纪律; 失败不标记, 下轮重试）。
 * ```
 *
 * 触发策略（任务书「失败 loud 不阻塞查询主路径, 报告注明策略」）:
 *  - **查询路径触发**: 生产挂点 = `getDashboard`（RR-018② 聚合段）—
 *    客户端 dashboard 刷新循环即生产触发循环（每次刷新一次 audit
 *    链; 与 WP-4.6 懒检测先例同一形态 — 查询路径上的幂等机械面）;
 *  - **无独立定时器**: 间隔调参需要 config 面（插件 Config 无 audit
 *    间隔字段, 硬编码间隔 = 不该存在的调参 — 红线纪律）; 去重基线 +
 *    discovery 快照保证稳态下每次刷新的**写入**为零（只有 git 只读
 *    开销, 与 stale 懒检测同级）;
 *  - **失败 loud 不阻塞**: 任何一步失败 = `AuditRefreshError`（稳定
 *    机器码）上抛; 调用方（getDashboard）catch + logger.error 大声
 *    记录后**继续查询投影**（audit 链失败 ≠ 数据面失败 — 查询主
 *    路径返回的是它自己的投影, 不因旁路机械面 abort）。
 *
 * 层边界（ARCHITECTURE §2.2）: wiring（组合根）— 本模块只做组合与
 * 路由; 全部事实/规则归 audit 三层（strict/discovery/reconcile）与
 * inbox 服务; 零 DSH import（INV-PERM-5）; 唯一写路径 = inbox 机械
 * 入口 + 两个 operational KV（discovery 快照 — scanner 既有 + 本模块
 * 去重基线 — meta 簿记面, 非一等 identity 行, 允许覆写/清理）。
 */

import { resolve } from 'node:path'

import {
  DiscoveryScanner,
  feedUntracked,
  untrackedRefsFromPaths,
  policyFromWorkspaceDoc,
  type DiscoveryScanReport,
} from '../../audit/discovery/index.js'
import {
  classifyDiscrepancies,
  toInboxEntry,
  type DeclaredState,
  type Discrepancy,
  type DiscrepancyCategory,
  type DiscrepancyReport,
} from '../../audit/reconcile/index.js'
import {
  DEFAULT_AUDIT_POLICY,
  runStrictAudit,
  normalizeWorkspacePolicy,
  type AuditReport,
  type AuditPolicy,
} from '../../audit/strict/index.js'
import {
  loadResearchTree,
  type ResearchFileReader,
  type WorkspaceDoc,
} from '../../domain/loader/index.js'
import type { SemanticState } from '../../domain/semantics/index.js'
import type { MetaStore } from '../../persistence/meta/index.js'
import type { TypedRef } from '../../history/registry/index.js'
import {
  InboxError,
  type InboxService,
  type MechanicalActorRef,
  type MechanicalInboxSource,
} from '../inbox/index.js'

/** 去重基线的 operational KV 键（meta 簿记面 — 非一等 identity 行）。 */
export const AUDIT_REFRESH_REPORTED_KEY = 'audit-refresh:reported-v1'
const DEDUPE_VERSION = 1

/** 机械 actor（PLUGIN — 审计链的机械入口, §11 非 USER 闭集）。 */
export const AUDIT_REFRESH_ACTOR: MechanicalActorRef = { kind: 'PLUGIN', label: 'audit-refresh' }

/** 刷新段的结构化失败码（稳定 — 调用方/测试分支用）。 */
export type AuditRefreshErrorCode =
  /** 输入/组合畸形（缺 repoRoot / meta / inbox — 精确指名）。 */
  | 'ARF_INPUT'
  /** strict audit 面失败（非 repo / git 命令 / policy 归一化, cause 保留）。 */
  | 'ARF_AUDIT'
  /** discovery 面失败（fs 扫描 / 快照 / policy, cause 保留）。 */
  | 'ARF_DISCOVERY'
  /** 分类面失败（declared 态读取 / classify 异常, cause 保留）。 */
  | 'ARF_CLASSIFY'
  /** Inbox 机械入口失败（capture/escalate 异常, cause 保留）。 */
  | 'ARF_INBOX'
  /** 去重基线 KV 损坏（fail loud, 绝不静默重置 — 同 DISC_SNAPSHOT_CORRUPT 纪律）。 */
  | 'ARF_STATE'

export class AuditRefreshError extends Error {
  readonly code: AuditRefreshErrorCode
  constructor(code: AuditRefreshErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'AuditRefreshError'
    this.code = code
  }
}

export function isAuditRefreshError(error: unknown): error is AuditRefreshError {
  return error instanceof AuditRefreshError
}

/** 刷新结果（结构化报告 — 调用方/测试分支用; 零自由文本）。 */
export interface AuditRefreshResult {
  readonly audit: {
    readonly trackedChangeCount: number
    readonly newFilesOutsideResearch: number
    readonly newFilesInsideResearch: number
    readonly researchConsistent: boolean
    readonly strictTrackedModified: number
    readonly strictTrackedDeleted: number
    readonly warningCount: number
  }
  readonly discovery: {
    readonly firstScan: boolean
    readonly addedCount: number
    readonly removedCount: number
    readonly candidateCount: number
  }
  readonly discrepancyCount: number
  readonly byCategory: Readonly<Record<DiscrepancyCategory, number>>
  /** 本轮新捕获的条目（成功者; 失败在 `captureFailures`）。 */
  readonly captured: readonly { readonly key: string; readonly inboxItemId: string; readonly source: MechanicalInboxSource }[]
  /** ESCALATE 批（单批; 无 ESCALATE = null）。 */
  readonly escalated: {
    readonly inboxItemId: string
    readonly interventionId: string | null
    readonly highImpact: boolean
    readonly reasons: readonly string[]
  } | null
  /** 去重基线命中（已报告且未变 — 零写入）。 */
  readonly skippedDedupe: number
  /** zone 基线内（首扫基线 / 差分无新 — 不是事件, 零写入）。 */
  readonly skippedBaseline: number
  /** 机械入口失败（未标记基线 — 下轮重试; 大声）。 */
  readonly captureFailures: readonly { readonly key: string; readonly code: string; readonly message: string }[]
}

export interface AuditRefreshLogger {
  readonly warn: (step: string, message: string) => void
  readonly error: (step: string, message: string) => void
}

export interface AuditRefreshOptions {
  /** Git repo 根（绝对路径 — W1 检测 + 全部 git 调用 `-C` 根）。 */
  readonly repoRoot: string
  /** `.research/` 根（绝对路径 — 树加载面）。 */
  readonly researchRoot: string
  /** 文件 reader（树加载 — 同 wiring 的 FsReader 缝）。 */
  readonly reader: ResearchFileReader
  /** 冻结 `schema/declarative` 目录（树加载的 schema 面）。 */
  readonly declarativeDir: string
  /** operational KV（discovery 快照基线 + 去重基线 — per-project meta）。 */
  readonly meta: MetaStore
  /** 语义注册表读取面（declared 态的 artifacts 表 — fresh derived 行）。 */
  readonly readSemanticState: () => SemanticState
  /** Inbox 服务（机械入口 — 生产组装见 create.ts）。 */
  readonly inbox: InboxService
  /** 时钟（缺省 `Date.now`）。 */
  readonly now?: () => number
  readonly logger?: AuditRefreshLogger
  /** 机械 actor（缺省 {@link AUDIT_REFRESH_ACTOR}）。 */
  readonly actor?: MechanicalActorRef
}

export interface AuditRefreshRunner {
  readonly run: () => Promise<AuditRefreshResult>
}

/** 构造 audit 刷新运行器（组合根注入 — create.ts 持有, getDashboard 触发）。 */
export function createAuditRefreshRunner(options: AuditRefreshOptions): AuditRefreshRunner {
  if (typeof options.repoRoot !== 'string' || options.repoRoot.length === 0) {
    throw new AuditRefreshError('ARF_INPUT', 'createAuditRefreshRunner: repoRoot is required')
  }
  if (options.meta === null || typeof options.meta !== 'object' || typeof options.meta.get !== 'function') {
    throw new AuditRefreshError('ARF_INPUT', 'createAuditRefreshRunner: the operational meta KV face is required')
  }
  if (options.inbox === null || typeof options.inbox !== 'object' || typeof options.inbox.captureMechanical !== 'function') {
    throw new AuditRefreshError('ARF_INPUT', 'createAuditRefreshRunner: the InboxService mechanical entry is required')
  }
  const now = options.now ?? Date.now
  const actor = options.actor ?? AUDIT_REFRESH_ACTOR

  return { run: () => runRefresh(options, now, actor) }
}

/* ------------------------------------------------------------------ *
 * 刷新主体
 * ------------------------------------------------------------------ */

async function runRefresh(options: AuditRefreshOptions, now: () => number, actor: MechanicalActorRef): Promise<AuditRefreshResult> {
  const { repoRoot, meta, inbox, logger } = options

  // 1. fresh 树加载（policy 面; 树坏 = 默认 policy + 大声 warn — 刷新
  //    不阻塞, 查询主路径对坏树自己 loud）。
  let workspaceDoc: WorkspaceDoc | null = null
  try {
    const load = loadResearchTree(options.reader, options.researchRoot, options.declarativeDir)
    workspaceDoc = load.tree.workspace
  } catch (cause) {
    logger?.warn('audit-refresh.tree', `tree load failed — defaulting to the engineering audit policy: ${messageOf(cause)}`)
  }

  // 2. policy 归一化（strict + discovery 两正常化面 — 同源 doc）。
  let strictPolicy: AuditPolicy | null
  let discoveryPolicy: ReturnType<typeof policyFromWorkspaceDoc>
  try {
    strictPolicy = workspaceDoc === null ? null : normalizeWorkspacePolicy(workspaceDoc)
  } catch (cause) {
    throw new AuditRefreshError('ARF_AUDIT', `audit-refresh: workspace.yaml policy normalization failed: ${messageOf(cause)}`, { cause })
  }
  try {
    discoveryPolicy = policyFromWorkspaceDoc(workspaceDoc)
  } catch (cause) {
    throw new AuditRefreshError('ARF_DISCOVERY', `audit-refresh: discovery policy normalization failed: ${messageOf(cause)}`, { cause })
  }

  // 3. strict audit（W1/W4/W5/W13 只读 git 面）。
  let report: AuditReport
  try {
    report = await runStrictAudit({
      workspaceRoot: repoRoot,
      ...(strictPolicy !== null ? { policy: strictPolicy } : {}),
    })
  } catch (cause) {
    throw new AuditRefreshError('ARF_AUDIT', `audit-refresh: strict audit failed: ${messageOf(cause)}`, { cause })
  }

  // 4. discovery fs 扫描（快照增量差分; 失败不毁基线 — scanner 纪律）。
  const effectivePolicy = strictPolicy ?? DEFAULT_AUDIT_POLICY
  const wsRoot = effectivePolicy.workspaceRoot === '.' ? repoRoot : resolve(repoRoot, effectivePolicy.workspaceRoot)
  const scanner = new DiscoveryScanner(meta, now)
  let scan: DiscoveryScanReport
  try {
    scan = scanner.scan({ workspaceRoot: wsRoot, policy: discoveryPolicy })
  } catch (cause) {
    throw new AuditRefreshError('ARF_DISCOVERY', `audit-refresh: discovery scan failed: ${messageOf(cause)}`, { cause })
  }

  // 5. W4 untracked feed 通道（纯 — W4 事实已在 strict 报告里）。
  const feed = feedUntracked(discoveryPolicy, untrackedRefsFromPaths(report.newFiles.outsideResearch))

  // 6. 声明态（语义注册表 fresh 读取 + 归一化 policy）→ 机械分类。
  let classified: DiscrepancyReport
  try {
    const declared: DeclaredState = { artifacts: options.readSemanticState().artifacts, policy: effectivePolicy }
    classified = classifyDiscrepancies({ audit: report, discovery: scan, untrackedFeed: feed, declared })
  } catch (cause) {
    throw new AuditRefreshError('ARF_CLASSIFY', `audit-refresh: discrepancy classification failed: ${messageOf(cause)}`, { cause })
  }

  // 7. 去重基线（operational KV — 指纹集合; 损坏 fail loud, 不静默重置）。
  const reported = readDedupeSet(meta, AUDIT_REFRESH_REPORTED_KEY)

  // 8. 机械路由（三档机械半边 — 见模块头; 失败不标记基线 = 下轮重试）。
  const captured: { readonly key: string; readonly inboxItemId: string; readonly source: MechanicalInboxSource }[] = []
  const captureFailures: { readonly key: string; readonly code: string; readonly message: string }[] = []
  let skippedDedupe = 0
  let skippedBaseline = 0
  const escalateBatch: Discrepancy[] = []
  const currentFps = new Set<string>()
  const persistSet = new Set<string>()

  for (const d of classified.discrepancies) {
    const fp = fingerprint(d)
    currentFps.add(fp)
    if (d.category === 'UNREGISTERED_WORKSPACE_CHANGE' && d.subkind === 'zone' && !d.isNew) {
      // 首扫基线 / 差分无新 — 不是事件（WP-6.2 口径）; 零写入。
      skippedBaseline += 1
      if (reported.has(fp)) persistSet.add(fp)
      continue
    }
    if (reported.has(fp)) {
      // 已报告且未变 — 零写入（稳态刷新的零 inbox 副作用由此保证）。
      skippedDedupe += 1
      persistSet.add(fp)
      continue
    }
    if (d.recommendedTier === 'ESCALATE') {
      escalateBatch.push(d)
      continue
    }
    const draft = toInboxEntry(d, d.recommendedTier, now())
    try {
      const res = inbox.captureMechanical(
        { source: draft.source, payload: draft.payload, raw: draft.raw, contextRefs: draft.contextRefs },
        actor,
      )
      captured.push({ key: fp, inboxItemId: res.item.id, source: draft.source })
      persistSet.add(fp)
    } catch (cause) {
      const code = inboxErrorCode(cause)
      captureFailures.push({ key: fp, code, message: messageOf(cause) })
      logger?.error('audit-refresh.capture', `[${code}] ${messageOf(cause)}`)
    }
  }

  let escalated: AuditRefreshResult['escalated'] = null
  if (escalateBatch.length > 0) {
    const evidence = escalationEvidence(escalateBatch)
    try {
      const res = inbox.escalateMechanical({ source: 'UNCLASSIFIED_AUDIT_FINDING', evidence }, actor)
      escalated = {
        inboxItemId: res.item.id,
        interventionId: res.intervention === null ? null : res.intervention.id,
        highImpact: res.assessment.highImpact,
        reasons: [...res.assessment.reasons],
      }
      for (const d of escalateBatch) persistSet.add(fingerprint(d))
    } catch (cause) {
      // capture-first 语义: 条目可能已捕获（IN_ESCALATION）— 未标记
      // 基线 ⇒ 下轮重试; 大声指明残差。
      const code = inboxErrorCode(cause)
      captureFailures.push({ key: `ESCALATE-BATCH(${escalateBatch.length})`, code, message: messageOf(cause) })
      logger?.error('audit-refresh.escalate', `[${code}] ${messageOf(cause)}`)
    }
  }

  // 9. 去重基线持久化（本轮全集 = 存续旧指纹 ∪ 新成功指纹; 消失的
  //    finding 被移除, 复发重新报告）。
  try {
    meta.set(AUDIT_REFRESH_REPORTED_KEY, JSON.stringify({ version: DEDUPE_VERSION, entries: [...persistSet].sort() }))
  } catch (cause) {
    throw new AuditRefreshError('ARF_STATE', `audit-refresh: the dedupe baseline persist failed: ${messageOf(cause)}`, { cause })
  }

  return {
    audit: {
      trackedChangeCount: report.trackedChanges.length,
      newFilesOutsideResearch: report.newFiles.outsideResearch.length,
      newFilesInsideResearch: report.newFiles.insideResearch.length,
      researchConsistent: report.research.consistent,
      strictTrackedModified: report.strictTracked.modified.length,
      strictTrackedDeleted: report.strictTracked.deleted.length,
      warningCount: report.warnings.length,
    },
    discovery: {
      firstScan: scan.diff.firstScan,
      addedCount: scan.diff.added.length,
      removedCount: scan.diff.removed.length,
      candidateCount: scan.candidates.length,
    },
    discrepancyCount: classified.discrepancies.length,
    byCategory: { ...classified.byCategory },
    captured,
    escalated,
    skippedDedupe,
    skippedBaseline,
    captureFailures,
  }
}

/* ------------------------------------------------------------------ *
 * 机械构造器（纯 — 零语义判断, 冻结映射）
 * ------------------------------------------------------------------ */

/** 一条 finding 的稳定指纹（去重基线键 — 含全部机械事实字段）。 */
export function fingerprint(d: Discrepancy): string {
  switch (d.category) {
    case 'TRACKED_UNDECLARED':
      return JSON.stringify(['T', d.subkind, d.path, d.x, d.y, d.origPath ?? null, d.inStrictTracked])
    case 'UNREGISTERED_WORKSPACE_CHANGE':
      return JSON.stringify(['U', d.subkind, d.path, d.zone, d.suggestedType])
    case 'DECLARED_MISSING':
      return JSON.stringify(['M', d.subkind, d.path, d.signal, d.artifactId ?? null])
    case 'RESEARCH_UNCHECKPOINTED':
      return JSON.stringify(['R', d.subkind, d.path])
    case 'ARTIFACT_RECOVERABLE':
      return JSON.stringify(['A', d.path, d.artifactId])
  }
}

/** ESCALATE 批的升级证据（机械事实聚合 — 零语义判断, §22.3 损失面）。 */
function escalationEvidence(batch: readonly Discrepancy[]): {
  readonly summary: string
  readonly workstreamIds?: string[]
  readonly strictTrackedPaths?: string[]
  readonly deletedPaths?: string[]
  readonly affectedPathCount: number
  readonly contextRefs?: TypedRef[]
} {
  const strictTrackedPaths: string[] = []
  const deletedPaths: string[] = []
  const workstreamIds = new Set<string>()
  const contextRefs: TypedRef[] = []
  const seenRefs = new Set<string>()
  const categories = new Set<string>()

  const addRefs = (refs: readonly TypedRef[]): void => {
    for (const ref of refs) {
      const k = `${ref.kind}:${ref.id}`
      if (!seenRefs.has(k)) {
        seenRefs.add(k)
        contextRefs.push(ref)
      }
    }
  }

  for (const d of batch) {
    categories.add(d.category)
    if (d.category === 'TRACKED_UNDECLARED') {
      if (d.inStrictTracked) strictTrackedPaths.push(d.path)
      if (d.subkind === 'deleted') deletedPaths.push(d.path)
    } else if (d.category === 'DECLARED_MISSING') {
      // 声明物缺席 = 损失面（§22.3「高影响/未知/损失」）。
      deletedPaths.push(d.path)
      if (d.subkind === 'strict-tracked') strictTrackedPaths.push(d.path)
      if (d.workstreamId !== undefined) workstreamIds.add(d.workstreamId)
      addRefs(toInboxEntry(d, 'ESCALATE', 0).contextRefs)
    } else if (d.category === 'UNREGISTERED_WORKSPACE_CHANGE') {
      addRefs(toInboxEntry(d, 'ESCALATE', 0).contextRefs)
    } else if (d.category === 'RESEARCH_UNCHECKPOINTED' || d.category === 'ARTIFACT_RECOVERABLE') {
      addRefs(toInboxEntry(d, 'ESCALATE', 0).contextRefs)
    }
  }

  const summary =
    `audit ESCALATE batch: ${batch.length} high-impact discrepancy(ies) — ` +
    [...categories].sort().join(', ')
  return {
    summary,
    ...(workstreamIds.size > 0 ? { workstreamIds: [...workstreamIds].sort() } : {}),
    ...(strictTrackedPaths.length > 0 ? { strictTrackedPaths: [...new Set(strictTrackedPaths)].sort() } : {}),
    ...(deletedPaths.length > 0 ? { deletedPaths: [...new Set(deletedPaths)].sort() } : {}),
    affectedPathCount: batch.length,
    ...(contextRefs.length > 0 ? { contextRefs: contextRefs.sort((a, b) => (a.kind + a.id < b.kind + b.id ? -1 : 1)) } : {}),
  }
}

/* ------------------------------------------------------------------ *
 * 去重基线 KV（strict codec — 损坏 fail loud, 绝不静默重置）
 * ------------------------------------------------------------------ */

function readDedupeSet(meta: MetaStore, key: string): Set<string> {
  const raw = meta.get(key)
  if (raw === null) return new Set()
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (cause) {
    throw new AuditRefreshError('ARF_STATE', `audit-refresh: the dedupe baseline at ${JSON.stringify(key)} is not valid JSON (corrupt — never silently reset): ${messageOf(cause)}`, { cause })
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AuditRefreshError('ARF_STATE', `audit-refresh: the dedupe baseline at ${JSON.stringify(key)} is not an object (corrupt)`)
  }
  const doc = parsed as { version?: unknown; entries?: unknown }
  if (doc.version !== DEDUPE_VERSION) {
    throw new AuditRefreshError(
      'ARF_STATE',
      `audit-refresh: the dedupe baseline at ${JSON.stringify(key)} has version ${JSON.stringify(doc.version)} (expected ${DEDUPE_VERSION} — corrupt/foreign)`,
    )
  }
  if (!Array.isArray(doc.entries) || doc.entries.some((e) => typeof e !== 'string')) {
    throw new AuditRefreshError('ARF_STATE', `audit-refresh: the dedupe baseline at ${JSON.stringify(key)} has a malformed entries array (corrupt)`)
  }
  return new Set(doc.entries as string[])
}

function inboxErrorCode(cause: unknown): string {
  if (cause instanceof InboxError) return cause.code
  if (cause instanceof AuditRefreshError) return cause.code
  return 'ARF_INBOX'
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
