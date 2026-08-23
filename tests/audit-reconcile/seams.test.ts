/**
 * WP-6.3 — 接缝测试（任务书目标 4「与 Inbox（WP-6.4）接缝」+ 不改写
 * 历史的结构性断言 + 冻结面对齐）.
 *
 * 覆盖:
 *  - InboxEntryDraft §11 字段面（source 冻结 2 值子集映射 / state 恒
 *    CAPTURED / payload 机械确定性 / raw = 结构化 finding / contextRefs
 *    封闭 {ARTIFACT, WORKSTREAM} / createdAt = 注入 now）;
 *  - InterventionRequest ↔ WP-5.1 `createMechanicalIntervention` 参数
 *    字段 1:1（tsc 形状证明 + 值交叉断言: trigger ∈ WP-3.5 冻结闭集,
 *    origin/actor.kind = WP-5.1 `MECHANICAL_TRIGGER_*` 映射同值）;
 *  - `.research/` 前缀本地镜像 === git 白名单 `RESEARCH_PATHSPEC`;
 *  - 不改写历史断言（动作产物封闭 4 形态; ESCALATE 只请求**新建**
 *    Intervention — §13 终态面不触达; 无 update/delete/rewrite 形态
 *    存在于类型面）;
 *  - `InboxContextRef` 可当 `TypedRef` 用（kind ⊆ `ObjectKind`）.
 */
import { describe, expect, it } from 'vitest'

import {
  CATEGORY_INBOX_SOURCE,
  RESEARCH_TREE_PREFIX,
  classifyDiscrepancies,
  reconcileDiscrepancies,
  toInboxEntry,
  toInterventionRequest,
  type Discrepancy,
  type InboxContextRef,
} from '../../src/host/audit/reconcile/index.js'
import { RESEARCH_PATHSPEC } from '../../src/host/git/index.js'
import { MECHANICAL_TRIGGER_KINDS } from '../../src/host/service/flooding/index.js'
import {
  MECHANICAL_TRIGGER_ACTOR_KIND,
  MECHANICAL_TRIGGER_ORIGIN,
  type MechanicalActorRef,
  type MechanicalInterventionCreateParams,
} from '../../src/host/service/intervention/index.js'
import type { ObjectKind, TypedRef } from '../../src/host/history/registry/index.js'
import { ofCategory, scenarioA } from './helpers.js'

const NOW = 987_654_321
const report = classifyDiscrepancies(scenarioA())
const byCategory = (cat: Discrepancy['category']): Discrepancy[] =>
  report.discrepancies.filter((d) => d.category === cat)

describe('Inbox 接缝（WP-6.4 消费 — §11 字段 1:1 子集）', () => {
  it('source 冻结映射: 未注册 workspace 变化 = 同名来源; 其余 = UNCLASSIFIED_AUDIT_FINDING', () => {
    expect(CATEGORY_INBOX_SOURCE).toEqual({
      UNREGISTERED_WORKSPACE_CHANGE: 'UNREGISTERED_WORKSPACE_CHANGE',
      TRACKED_UNDECLARED: 'UNCLASSIFIED_AUDIT_FINDING',
      DECLARED_MISSING: 'UNCLASSIFIED_AUDIT_FINDING',
      RESEARCH_UNCHECKPOINTED: 'UNCLASSIFIED_AUDIT_FINDING',
      ARTIFACT_RECOVERABLE: 'UNCLASSIFIED_AUDIT_FINDING',
    })
  })

  it('逐类别草稿字段钉（source/state/raw/createdAt/payload 非空 + 机械内容）', () => {
    const all = report.discrepancies
    expect(all.length).toBe(14)
    for (const d of all) {
      const draft = toInboxEntry(d, d.recommendedTier, NOW)
      expect(draft.source).toBe(CATEGORY_INBOX_SOURCE[d.category])
      expect(draft.state).toBe('CAPTURED')
      expect(draft.raw).toBe(d) // 结构化 finding 原引用（零预序列化）
      expect(draft.createdAt).toBe(NOW)
      expect(typeof draft.payload).toBe('string')
      expect(draft.payload.length).toBeGreaterThan(0)
      expect(draft.payload).toContain(`finding=${d.category}/${d.subkind}`)
      expect(draft.payload).toContain(`path=${d.path}`)
      expect(draft.payload).toContain(`tier=${d.recommendedTier}`)
      expect(draft.payload).toContain(`reason=${d.tierReason}`)
    }
  })

  it('payload 确定性: 同 (d, tier, now) 同文本; 改 tier 改文本', () => {
    const d = byCategory('DECLARED_MISSING')[0]!
    const a = toInboxEntry(d, 'ESCALATE', NOW)
    const b = toInboxEntry(d, 'ESCALATE', NOW)
    const c = toInboxEntry(d, 'AUTO_RECONCILE', NOW)
    expect(a.payload).toBe(b.payload)
    expect(a.payload).not.toBe(c.payload)
    expect(a.raw).toBe(b.raw)
  })

  it('contextRefs 封闭 {ARTIFACT, WORKSTREAM} 且按类别机械构造', () => {
    for (const d of byCategory('ARTIFACT_RECOVERABLE')) {
      expect(toInboxEntry(d, 'AUTO_RECONCILE', NOW).contextRefs).toEqual([
        { kind: 'ARTIFACT', id: 'A-5' },
        { kind: 'WORKSTREAM', id: 'WS-2' },
      ])
    }
    const missingArt = byCategory('DECLARED_MISSING').filter((d) => d.subkind === 'artifact')
    for (const d of missingArt) {
      const dd = ofCategory(d, 'DECLARED_MISSING')
      expect(toInboxEntry(d, 'ESCALATE', NOW).contextRefs).toEqual([
        { kind: 'ARTIFACT', id: dd.artifactId! },
        { kind: 'WORKSTREAM', id: 'WS-1' },
      ])
    }
    // 无 artifact 关联的类别 → 空集（不虚构引用）
    for (const d of [...byCategory('TRACKED_UNDECLARED'), ...byCategory('RESEARCH_UNCHECKPOINTED'), ...byCategory('UNREGISTERED_WORKSPACE_CHANGE')]) {
      expect(toInboxEntry(d, 'AUTO_RECONCILE', NOW).contextRefs).toEqual([])
    }
  })

  it('InboxContextRef 可当 TypedRef 用（kind ⊆ ObjectKind — 结构兼容）', () => {
    const refs: InboxContextRef[] = [{ kind: 'ARTIFACT', id: 'A-1' }, { kind: 'WORKSTREAM', id: 'WS-1' }]
    const asTyped: TypedRef[] = refs // tsc 形状证明: {kind,id} 与 TypedRef 兼容
    const kinds: ObjectKind[] = asTyped.map((r) => r.kind)
    expect(kinds).toEqual(['ARTIFACT', 'WORKSTREAM'])
  })
})

describe('Intervention 接缝（WP-5.1 `createMechanicalIntervention` 1:1）', () => {
  it('请求字段 1:1 对齐（tsc 形状证明: params 直转 + actor 直转）', () => {
    const d = byCategory('DECLARED_MISSING').find((x) => x.subkind === 'artifact' && x.artifactId === 'A-2')!
    const req = toInterventionRequest(d)
    // WP-5.1 参数面直转（字段名 snake_case 映射 — 消费方 1:1 无转换损耗）:
    const params: MechanicalInterventionCreateParams = {
      title: req.title,
      detail: req.detail,
      workstream_ids: req.workstreamIds,
      source_refs: req.sourceRefs,
      trigger: req.trigger,
    }
    const actor: MechanicalActorRef = req.actor
    expect(params.trigger).toBe('AUDIT_HIGH_IMPACT_DISCREPANCY')
    expect(params.workstream_ids).toEqual(['WS-1'])
    expect(params.source_refs).toEqual([{ kind: 'ARTIFACT', id: 'A-2' }, { kind: 'WORKSTREAM', id: 'WS-1' }])
    expect(actor.kind).toBe('PLUGIN')
    expect(params.title).toBe('[audit] DECLARED_MISSING: results/old.csv')
  })

  it('trigger ∈ WP-3.5 冻结闭集 + origin/actor = WP-5.1 冻结映射同值（交叉断言）', () => {
    for (const d of report.discrepancies) {
      const req = toInterventionRequest(d)
      expect(MECHANICAL_TRIGGER_KINDS).toContain(req.trigger)
      expect(req.origin).toBe(MECHANICAL_TRIGGER_ORIGIN[req.trigger])
      expect(req.actor.kind).toBe(MECHANICAL_TRIGGER_ACTOR_KIND[req.trigger])
      expect(req.origin).toBe('AUTO_AUDIT')
      expect(req.actor.kind).toBe('PLUGIN')
    }
  })

  it('ESCALATE 只请求**新建** Intervention — 无已有对象引用/状态迁移形态（§13 不改写）', () => {
    for (const d of report.discrepancies) {
      const req = toInterventionRequest(d)
      // 请求面不含任何已有 Intervention id / 状态迁移字段:
      expect(req).not.toHaveProperty('interventionId')
      expect(req).not.toHaveProperty('status')
      expect(req).not.toHaveProperty('update')
      expect(req).not.toHaveProperty('delete')
      // sourceRefs 只指触发对象（artifact/WS）— 不指 INTERVENTION kind:
      for (const r of req.sourceRefs) {
        expect(['ARTIFACT', 'WORKSTREAM']).toContain(r.kind)
      }
    }
  })
})

describe('不改写历史 — 结构性断言（任务书测试项）', () => {
  it('动作产物封闭 4 形态（类型面即闭集 — 无 update/delete/rewrite 形态）', () => {
    const decisions = report.discrepancies.map((d, i) => ({
      refId: d.id,
      choice: (['AUTO_RECONCILE', 'PROPOSE_RECONCILIATION', 'ESCALATE', 'IGNORE'] as const)[i % 4]!,
    }))
    const out = reconcileDiscrepancies(report, decisions, { kind: 'USER' }, { now: () => NOW })
    const kinds = new Set<string>()
    for (const a of out.byRef.values()) kinds.add(a.kind)
    expect([...kinds].sort()).toEqual(['ESCALATE_INTERVENTION', 'IGNORED', 'INBOX_CAPTURE', 'PROPOSE_DECLARATION'])
    // 全部 Inbox 草稿 = CAPTURED 入口态（§13 状态机入口 — 非用户终态）:
    for (const e of out.inboxDrafts) expect(e.state).toBe('CAPTURED')
    // 声明提案 = 指向既有显式登记流的新建引导（非改写）:
    for (const p of out.proposals) {
      expect(['ARTIFACT_REGISTER', 'ARTIFACT_CHANGE_CONFIRM', 'CHECKPOINT']).toContain(p.kind)
    }
  })

  it('reconcile 全批次执行后: 输入报告逐字段不变（纯函数 — 无 I/O 通道可改）', () => {
    const decisions = report.discrepancies.map((d) => ({ refId: d.id, choice: 'AUTO_RECONCILE' as const }))
    const before = JSON.stringify(report)
    const out = reconcileDiscrepancies(report, decisions, { kind: 'USER' }, { now: () => NOW })
    expect(JSON.stringify(report)).toBe(before)
    expect(out.inboxDrafts.length).toBe(report.discrepancies.length)
  })
})

describe('冻结常量对齐', () => {
  it('`.research/` 前缀本地镜像 === git 白名单 RESEARCH_PATHSPEC（同值钉）', () => {
    expect(RESEARCH_TREE_PREFIX).toBe(RESEARCH_PATHSPEC)
    expect(RESEARCH_TREE_PREFIX).toBe('.research/')
  })
})
