/**
 * WP-6.3 — 下游接缝构造器（任务书目标 4）: Inbox 草稿（WP-6.4 消费）+
 * Intervention 请求草稿（WP-5.1 消费）+ 声明提案（既有显式登记流消费）。
 *
 * 全部纯函数, 零 I/O, 零持久化 — 本层只**构造** WP-6.4/5.1 的输入:
 *  - `toInboxEntry` — §11 Research Inbox 条目草稿（字段 1:1 子集;
 *    `id` 归 WP-6.4 共享分配器, `converted_to` 归用户显式确认 —
 *    §11/§28「需显式确认或明确 policy」; `state` 恒 `CAPTURED` 入口态,
 *    §13 状态机 — 本层永不产生 CONVERTED/DISMISSED 用户终态）;
 *  - `toInterventionRequest` — §9.2 Intervention 创建请求（字段逐位
 *    对齐 WP-5.1 `createMechanicalIntervention` 参数 + actor — tests
 *    钉; 本层不写 `intervention` 表、不发 INTERVENTION_CREATED 事件
 *    — 那是 WP-5.1 的 store/registry 面, 层方向不可达, §2.2）;
 *  - `proposalFor` — PROPOSE 档的声明提案（module doc tiers.ts 冻结
 *    映射; 「引导用户补声明」的机器面 — 材料全机械, 登记动作归
 *    用户/Agent 既有权限面, §6 矩阵 + §7.3「显式注册」）。
 *
 * 机械边界: `payload`/`title`/`detail` 文本是**字段值的机械拼装**
 * （`key=value` 对, 确定性, 无自由语义推断）— 展示层可读, 但构造
 * 规则本身是冻结的; 类型信号唯一来源 = WP-6.2 `combineTypeSignal`
 * 冻结表（本文件 import 值 — 同层 audit/discovery, 零第二套表）。
 */

import type { ArtifactType } from '../../domain/loader/index.js'
import { combineTypeSignal } from '../discovery/classify.js'
import type {
  DeclarationProposal,
  Discrepancy,
  InboxContextRef,
  InboxEntryDraft,
  InterventionRequest,
  ReconciliationTier,
} from './types.js'
import { AUDIT_HIGH_IMPACT_TRIGGER, CATEGORY_INBOX_SOURCE } from './types.js'

/* ------------------------------------------------------------------ *
 * 机械文本拼装（确定性; 无自由语义）
 * ------------------------------------------------------------------ */

/** `key=value` 对拼装（值原样; 空值对省略; 布尔小写）。 */
function kv(pairs: ReadonlyArray<readonly [string, string | number | boolean | null | undefined]>): string {
  return pairs
    .filter((pair): pair is readonly [string, string | number | boolean] => pair[1] !== null && pair[1] !== undefined)
    .map(([k, v]) => `${k}=${v === true ? 'true' : v === false ? 'false' : v}`)
    .join(' ')
}

/** 各变体的 artifact 关联字段（机械提取 — 无 = undefined）。 */
function artifactIdOf(d: Discrepancy): string | undefined {
  if (d.category === 'ARTIFACT_RECOVERABLE') return d.artifactId
  if (d.category === 'DECLARED_MISSING') return d.artifactId
  if (d.category === 'TRACKED_UNDECLARED') return d.matchedArtifactId
  return undefined
}

/** 每条 Discrepancy 的机械文本摘要（Inbox `payload` 面 — §11「文本/
 *  摘要」; 全字段值拼装, 零推断）。 */
function payloadOf(d: Discrepancy, tier: ReconciliationTier): string {
  const base: string[] = [
    kv([
      ['finding', `${d.category}/${d.subkind}`],
      ['path', d.path],
      ['artifact', artifactIdOf(d)],
      ['tier', tier],
      ['reason', d.tierReason],
    ]),
  ]
  if (d.category === 'TRACKED_UNDECLARED') {
    base.push(kv([['x', d.x], ['y', d.y], ['inStrictTracked', d.inStrictTracked]]))
  } else if (d.category === 'UNREGISTERED_WORKSPACE_CHANGE') {
    base.push(
      kv([
        ['source', d.subkind],
        ['zone', d.zone],
        ['suggestedType', d.suggestedType],
        ['sizeBytes', d.sizeBytes],
        ['isNew', d.isNew],
      ]),
    )
  } else if (d.category === 'DECLARED_MISSING') {
    base.push(kv([['signal', d.signal]]))
  }
  return base.join(' ')
}

/* ------------------------------------------------------------------ *
 * Inbox 草稿（WP-6.4 接缝）
 * ------------------------------------------------------------------ */

/** `context_refs` 机械构造（封闭 {ARTIFACT, WORKSTREAM}; 字段齐备才
 *  发 — 无 artifact 关联 = 空集, 不虚构引用）。 */
function contextRefsOf(d: Discrepancy): InboxContextRef[] {
  const refs: InboxContextRef[] = []
  const artifactId = d.category === 'ARTIFACT_RECOVERABLE' ? d.artifactId
    : d.category === 'DECLARED_MISSING' && d.artifactId !== undefined ? d.artifactId
      : d.category === 'TRACKED_UNDECLARED' ? d.matchedArtifactId
        : undefined
  if (artifactId !== undefined) refs.push({ kind: 'ARTIFACT', id: artifactId })
  const wsId =
    d.category === 'ARTIFACT_RECOVERABLE' ? d.workstreamId
      : d.category === 'DECLARED_MISSING' ? d.workstreamId
        : undefined
  if (wsId !== undefined) refs.push({ kind: 'WORKSTREAM', id: wsId })
  return refs
}

/**
 * Inbox 条目草稿构造（任务书目标 4「输出可入 Inbox 的条目构造器」）。
 * 纯函数: 零分配器、零存储 — `id` 由 WP-6.4 落库时经共享 IdAllocator
 * 分配（§1.1 IN 族）; 其余 §11 字段 1:1。
 *
 * `source` 冻结映射（`CATEGORY_INBOX_SOURCE` — GIT_INTEGRATION §8
 * 「发现未注册产物 -> Inbox（UNREGISTERED_WORKSPACE_CHANGE）」逐字;
 * 其余类别 = `UNCLASSIFIED_AUDIT_FINDING`, §1.4/§28 同名来源）;
 * `raw` = 结构化 Discrepancy（§11「原始数据（如 audit finding 细节）」
 * 的机器形态 — WP-6.4 落库时 JSON 序列化, 本层不预序列化）;
 * `createdAt` = 注入 `now`（确定性）。
 */
export function toInboxEntry(d: Discrepancy, tier: ReconciliationTier, now: number): InboxEntryDraft {
  return {
    source: CATEGORY_INBOX_SOURCE[d.category],
    payload: payloadOf(d, tier),
    raw: d,
    contextRefs: contextRefsOf(d),
    state: 'CAPTURED',
    createdAt: now,
  }
}

/* ------------------------------------------------------------------ *
 * Intervention 请求（WP-5.1 接缝）
 * ------------------------------------------------------------------ */

/**
 * ESCALATE 档的 Intervention 请求草稿（§22.3 逐字「ESCALATE：高影响/
 * 未知/损失 → Intervention」; §16.3/ARCHITECTURE 脚注 ¹ 机械触发
 * 「audit 高影响 unresolved discrepancy」）。
 *
 * 字段逐位对齐 WP-5.1 `createMechanicalIntervention(params, actor)`
 * （tests 钉 1:1）:
 *  - `title`/`detail` → `InterventionCreateParams.title/detail`;
 *  - `sourceRefs` → `source_refs`（`TypedRef` 结构镜像, kind 子集
 *    {ARTIFACT, WORKSTREAM} ⊆ `ObjectKind`）;
 *  - `workstreamIds` → `workstream_ids`（catalog §5.7 owner 推导面:
 *    第一个关联 WS; 空 = 不发 INTERVENTION_CREATED 事件, 仅入
 *    operational 队列 — WP-5.1 执行口径）;
 *  - `trigger`/`origin`/`actor` → WP-5.1 由 `trigger` 冻结推导
 *    （`MECHANICAL_TRIGGER_ORIGIN` / `MECHANICAL_TRIGGER_ACTOR_KIND`）—
 *    本层同值透出供消费方**交叉断言**（漂移即测试红）, 不替代其推导。
 *
 * 纯函数: 本层不写 `intervention` 表、不发事件（WP-5.1 面, 层方向
 * 不可达 — 「不动 History 事件」的结构性半边）。
 */
export function toInterventionRequest(d: Discrepancy): InterventionRequest {
  const title = `[audit] ${d.category}: ${d.path}`
  const detailParts: string[] = []
  detailParts.push(
    `category=${d.category} subkind=${d.subkind} path=${d.path} tier_reason=${d.tierReason}`,
  )
  if (d.category === 'DECLARED_MISSING') {
    detailParts.push(`signal=${d.signal}`)
  }
  if (d.category === 'TRACKED_UNDECLARED') {
    detailParts.push(`x=${d.x} y=${d.y} inStrictTracked=${d.inStrictTracked}`)
  }
  if (d.category === 'UNREGISTERED_WORKSPACE_CHANGE') {
    detailParts.push(
      `source=${d.subkind} zone=${d.zone ?? 'null'} suggested_type=${d.suggestedType} is_new=${d.isNew}`,
    )
  }
  if (d.category === 'RESEARCH_UNCHECKPOINTED') {
    detailParts.push(`checkpoint_gap=${d.subkind}`)
  }
  if (d.category === 'ARTIFACT_RECOVERABLE') {
    detailParts.push(`artifact=${d.artifactId} status=MISSING file_present=true`)
  }
  const sourceRefs: InboxContextRef[] = []
  const workstreamIds: string[] = []
  if (d.category === 'ARTIFACT_RECOVERABLE') {
    sourceRefs.push({ kind: 'ARTIFACT', id: d.artifactId })
    sourceRefs.push({ kind: 'WORKSTREAM', id: d.workstreamId })
    workstreamIds.push(d.workstreamId)
  } else if (d.category === 'DECLARED_MISSING' && d.artifactId !== undefined) {
    sourceRefs.push({ kind: 'ARTIFACT', id: d.artifactId })
    if (d.workstreamId !== undefined) {
      sourceRefs.push({ kind: 'WORKSTREAM', id: d.workstreamId })
      workstreamIds.push(d.workstreamId)
    }
  } else if (d.category === 'TRACKED_UNDECLARED' && d.matchedArtifactId !== undefined) {
    sourceRefs.push({ kind: 'ARTIFACT', id: d.matchedArtifactId })
  }
  return {
    title,
    detail: detailParts.join('; '),
    sourceRefs,
    workstreamIds,
    trigger: AUDIT_HIGH_IMPACT_TRIGGER,
    origin: 'AUTO_AUDIT',
    actor: { kind: 'PLUGIN' },
  }
}

/* ------------------------------------------------------------------ *
 * 声明提案（PROPOSE 档 — 「引导用户补声明」）
 * ------------------------------------------------------------------ */

/** 路径的 basename（机械; 空段防御）。 */
function basenameOf(p: string): string {
  const i = p.lastIndexOf('/')
  return i < 0 ? p : p.slice(i + 1)
}

/**
 * PROPOSE 档的声明提案（冻结映射, module doc tiers.ts; 纯机械材料,
 * 指向既有显式登记流 — 本层不执行登记）:
 *
 *  - UNREGISTERED_WORKSPACE_CHANGE → `ARTIFACT_REGISTER`
 *    （`suggestedType` = 候选机械猜测原样透出; 用户确认时可改）;
 *  - TRACKED_UNDECLARED + `matchedArtifactId` → `ARTIFACT_CHANGE_CONFIRM`
 *    （「可能匹配但需确认」— 变更触及已注册 artifact, 确认面）;
 *  - TRACKED_UNDECLARED 无匹配 → `ARTIFACT_REGISTER`
 *    （`suggestedType` = WP-6.2 冻结表对路径 basename 的机械信号 —
 *    双失配 = OTHER; 永不 null）;
 *  - RESEARCH_UNCHECKPOINTED → `CHECKPOINT`（引导 checkpoint — §6
 *    矩阵仅用户; 声明态变化的登记方式 §14/§22.4）;
 *  - DECLARED_MISSING / ARTIFACT_RECOVERABLE → `null`（无机械可提声明:
 *    缺失的补救是恢复/重声明, 找回的状态恢复是用户操作 — 均超出
 *    「补声明」的机械面, 仅 Inbox 留痕）。
 *
 * `tier` 参数收窄调用点（只有 PROPOSE 档调用; 类型面即边界）。
 */
export function proposalFor(d: Discrepancy, tier: 'PROPOSE_RECONCILIATION'): DeclarationProposal | null {
  if (tier !== 'PROPOSE_RECONCILIATION') return null
  switch (d.category) {
    case 'UNREGISTERED_WORKSPACE_CHANGE':
      return {
        kind: 'ARTIFACT_REGISTER',
        path: d.path,
        suggestedType: d.suggestedType,
        zone: d.zone,
        zoneArtifactTypes: d.zoneArtifactTypes,
        matchedArtifactId: null,
      }
    case 'TRACKED_UNDECLARED':
      if (d.matchedArtifactId !== undefined) {
        return { kind: 'ARTIFACT_CHANGE_CONFIRM', path: d.path, artifactId: d.matchedArtifactId, subkind: d.subkind }
      }
      return {
        kind: 'ARTIFACT_REGISTER',
        path: d.path,
        suggestedType: combineTypeSignal(basenameOf(d.path)).suggestedType,
        zone: null,
        zoneArtifactTypes: [],
        matchedArtifactId: null,
      }
    case 'RESEARCH_UNCHECKPOINTED':
      return { kind: 'CHECKPOINT', paths: [d.path] }
    case 'DECLARED_MISSING':
    case 'ARTIFACT_RECOVERABLE':
      return null
  }
}

/** 类型面出口（ArtifactType 经 proposal 的 suggestedType 传递 — 显式
 *  re-export 供消费方单一 import 点）。 */
export type { ArtifactType }
