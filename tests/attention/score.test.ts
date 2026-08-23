/**
 * WP-5.4 — TC-DOM-031（TEST_MATRIX §3.1 L135）: Attention Manager 评分器。
 *
 * 矩阵原文口径: 「只排序不隐藏（OPEN/PENDING 恒在）；耗时特征不改变
 * 重要度主导排序；human override 持久化」— 第三子句是算法第 4 步
 * （human override, 后续 WP）, 本基线交付前两子句 + 确定性/稳定性:
 *
 *  - INV-ATTN-1（T 级）: 输出 = 输入全集的排序（双射）; OPEN/PENDING
 *    Intervention 恒在; 零分项（视距外 ScheduledEvent）恒在; 无 filter
 *    路径可断言;
 *  - INV-ATTN-2（R 级, 评分器约束）: 含/不含 `estimatedDurationMs` 的
 *    输入产出**同序同分** — 短耗时项（1 分钟事件）不得压过更高重要度项
 *    （PENDING Intervention）;
 *  - 确定性: 同输入 → 同输出（逐项全等）;
 *  - 排序稳定性: 输入乱序 → 同一输出序（全序 tie-break: score →
 *    类型档 → createdAt → id）;
 *  - 权重集中声明: 分数可由 `ATTENTION_WEIGHTS` 常量逐条复原; 计划书
 *    §20 零权重占位特征（含 `estimatedDuration`）恒 0。
 */
import { describe, expect, it } from 'vitest'

import {
  ATTENTION_WEIGHTS,
  rankAttention,
  scheduledUrgency,
  scoreAttentionItem,
  type AttentionItem,
  type AttentionItemBase,
} from '../../src/host/service/attention/scorer.js'
import {
  makeBlocker,
  makeContext,
  makeEvent,
  makeFullSet,
  makeIntervention,
  makeNextAction,
  T_NOW,
} from './fixtures.js'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/** 逐 (kind, id) 的签名 — 全集双射断言用。 */
function signature(items: readonly AttentionItemBase[]): string[] {
  return items.map((i) => `${i.kind}:${i.id}`).sort()
}

describe('TC-DOM-031 / INV-ATTN-1: 只排序、不隐藏', () => {
  it('输出 = 输入全集（双射）: 6 项进 6 项出, 无增删', () => {
    const input = makeFullSet()
    const ranking = rankAttention(input, makeContext())
    expect(ranking.items).toHaveLength(input.length)
    expect(signature(ranking.items)).toEqual(signature(input))
    // rank 是 1..n 的置换（无并列、无跳号）
    expect(ranking.items.map((i) => i.rank).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('OPEN/PENDING Intervention 恒在（且 CLOSED 终态由组装契约排除, 不评分器隐藏）', () => {
    const input: AttentionItem[] = [
      makeIntervention({ id: 'IV-9', status: 'OPEN' }),
      makeIntervention({ id: 'IV-10', status: 'PENDING' }),
      makeEvent({ id: 'SEV-9', at: T_NOW + 30 * DAY, awarenessState: 'ASSESSED' }),
    ]
    const ranking = rankAttention(input, makeContext())
    const ivIds = ranking.items.filter((i) => i.kind === 'INTERVENTION').map((i) => i.id).sort()
    expect(ivIds).toEqual(['IV-10', 'IV-9'])
    // 远未来事件分数可为 0（ASSESSED 无 gap ⇒ 精确 0）但恒在:
    const far = ranking.items.find((i) => i.id === 'SEV-9')
    expect(far).toBeDefined()
    expect(far!.score).toBe(0)
  })

  it('空候选 ⇒ 空排序（良定义, 不伪造数据）', () => {
    const ranking = rankAttention([], makeContext())
    expect(ranking.items).toEqual([])
    expect(ranking.generatedAt).toBe(T_NOW)
  })
})

describe('TC-DOM-031 / INV-ATTN-2 (R 级): 预计耗时零权重', () => {
  it('含/不含 estimatedDurationMs 的输入 ⇒ 同序同分', () => {
    const plain = makeFullSet()
    const withDuration = plain.map((item) => ({
      ...item,
      estimatedDurationMs: item.kind === 'SCHEDULED_EVENT' ? 60 * 1000 : 30 * 60 * 1000, // 全部标成「短耗时」
    }))
    const a = rankAttention(plain, makeContext())
    const b = rankAttention(withDuration, makeContext())
    // 顺序逐位相同:
    expect(b.items.map((i) => `${i.kind}:${i.id}`)).toEqual(a.items.map((i) => `${i.kind}:${i.id}`))
    // 分数逐项相同:
    expect(b.items.map((i) => i.score)).toEqual(a.items.map((i) => i.score))
  })

  it('短耗时陷阱: 序与分皆由权重表决定, 耗时字段零贡献（去掉耗时 ⇒ 同序同分）', () => {
    // 陷阱构造: 事件 1 分钟后（近度 ≈ 0.994, 分数 ≈ 89.5 + gap 10）,
    // PENDING IV（75 + gap 10 = 85）; 若「耗时」进权重, 事件的 1 分钟
    // 耗时会进一步拉开（或 IV 的 24 小时耗时会压低它）—— 口径断言:
    // 分数可被权重表逐条复原（耗时字段零贡献）, 且去掉耗时字段 ⇒ 同序同分。
    const pending = makeIntervention({ id: 'IV-1', status: 'PENDING', estimatedDurationMs: 24 * 60 * 60 * 1000 }) // 标签「24 小时」
    const shortEvent = makeEvent({ id: 'SEV-1', at: T_NOW + 60 * 60 * 1000, estimatedDurationMs: 60 * 1000 }) // 标签「1 分钟」
    const ranking = rankAttention([pending, shortEvent], makeContext())
    const byId = new Map(ranking.items.map((i) => [i.id, i]))
    expect(byId.get('SEV-1')!.score).toBe(
      ATTENTION_WEIGHTS.scheduledEvent * scheduledUrgency(T_NOW + 60 * 60 * 1000, T_NOW) + ATTENTION_WEIGHTS.awarenessGap,
    )
    expect(byId.get('IV-1')!.score).toBe(ATTENTION_WEIGHTS.interventionPending + ATTENTION_WEIGHTS.awarenessGap)
    // 去掉耗时字段重算 ⇒ 同序同分（R 级: 耗时零权重）:
    const noDur = rankAttention(
      [makeIntervention({ id: 'IV-1', status: 'PENDING' }), makeEvent({ id: 'SEV-1', at: T_NOW + 60 * 60 * 1000 })],
      makeContext(),
    )
    expect(noDur.items.map((i) => i.id)).toEqual(ranking.items.map((i) => i.id))
    expect(noDur.items.map((i) => i.score)).toEqual(ranking.items.map((i) => i.score))
  })

  it('权重表 estimatedDuration 恒 0（集中声明的 R 级表达）', () => {
    expect(ATTENTION_WEIGHTS.estimatedDuration).toBe(0)
    // 注入权重也不能让耗时生效: 评分函数根本不读该字段 ——
    // 用一个「假设有人给了耗时权重」的表, 输出仍不变:
    const rogue = { ...ATTENTION_WEIGHTS, estimatedDuration: 1000 }
    const input: AttentionItem[] = [
      makeIntervention({ id: 'IV-1', status: 'PENDING', estimatedDurationMs: 24 * 60 * 60 * 1000 }),
      makeEvent({ id: 'SEV-1', at: T_NOW + 60 * 1000, estimatedDurationMs: 60 * 1000 }),
    ]
    const a = rankAttention(input, makeContext())
    const b = rankAttention(input, makeContext(), rogue)
    expect(b.items.map((i) => `${i.id}:${i.score}`)).toEqual(a.items.map((i) => `${i.id}:${i.score}`))
  })
})

describe('确定性 + 排序稳定性（TC-DOM-031 口径: 确定性/排序稳定）', () => {
  it('同输入 → 同输出（逐项全等, 含 score/reasons/rank）', () => {
    const input = makeFullSet()
    const a = rankAttention(input, makeContext())
    const b = rankAttention(input, makeContext())
    expect(b).toEqual(a)
  })

  it('输入乱序 → 同一输出序（全序 tie-break）', () => {
    const input = makeFullSet()
    const reversed = [...input].reverse()
    const shuffled = [input[4]!, input[0]!, input[5]!, input[2]!, input[1]!, input[3]!]
    const a = rankAttention(input, makeContext())
    expect(rankAttention(reversed, makeContext()).items.map((i) => i.id)).toEqual(a.items.map((i) => i.id))
    expect(rankAttention(shuffled, makeContext()).items.map((i) => i.id)).toEqual(a.items.map((i) => i.id))
  })

  it('tie-break 次序: score 降序 → 类型档（IV<BLK<SEV<NA）→ createdAt 升 → id 升', () => {
    // 自定义权重表强制全同分（隔离比较器 — rankAttention 第三参数面）:
    const flat = {
      ...ATTENTION_WEIGHTS,
      interventionOpen: 100,
      interventionPending: 100,
      blocker: 100,
      scheduledEvent: 100,
      nextAction: 100,
      awarenessGap: 0,
    }
    const iv2 = makeIntervention({ id: 'IV-2', status: 'PENDING' }) // createdAt = T_NOW − 2h
    const iv1 = makeIntervention({ id: 'IV-1', status: 'PENDING', createdAt: T_NOW - 3 * HOUR }) // 更旧
    const blk = makeBlocker({ id: 'BLK-1' }) // T_NOW − 3h
    const sev = makeEvent({ id: 'SEV-1', at: T_NOW }) // 到期 ⇒ urgency 恰 1 ⇒ 恰 100 分
    const na = makeNextAction({ id: 'NA-1' }) // T_NOW − 1h
    const ranking = rankAttention([na, blk, sev, iv1, iv2], makeContext(), flat)
    // 全 100 分: 类型档 IV(0) 先 — IV 内部 createdAt 升序（IV-1 更旧在前）;
    // 然后 BLK(1) → SEV(2) → NA(3):
    expect(ranking.items.map((i) => i.id)).toEqual(['IV-1', 'IV-2', 'BLK-1', 'SEV-1', 'NA-1'])
    // id 决胜: 同分同档同时间 ⇒ id 升序:
    const same: AttentionItem[] = [
      makeNextAction({ id: 'NA-2' }),
      makeNextAction({ id: 'NA-1' }),
    ]
    expect(rankAttention(same, makeContext(), flat).items.map((i) => i.id)).toEqual(['NA-1', 'NA-2'])
  })
})

describe('权重集中声明 + 可解释（分数可由 ATTENTION_WEIGHTS 复原）', () => {
  it('每类基线分 = 权重常量 + awareness gap（逐条复原）', () => {
    const W = ATTENTION_WEIGHTS
    const items: AttentionItem[] = [
      makeIntervention({ id: 'IV-1', status: 'OPEN', awarenessState: 'ASSESSED' }),
      makeIntervention({ id: 'IV-2', status: 'PENDING', awarenessState: 'ASSESSED' }),
      makeBlocker({ id: 'BLK-1', awarenessState: 'ASSESSED' }),
      makeEvent({ id: 'SEV-1', at: T_NOW - 1000, awarenessState: 'ASSESSED' }), // 已到期 ⇒ urgency 1
      makeEvent({ id: 'SEV-2', at: T_NOW + W.scheduledEventHorizonMs, awarenessState: 'ASSESSED' }), // 恰在视距 ⇒ 0
      makeNextAction({ id: 'NA-1', awarenessState: 'ASSESSED' }),
    ]
    const ranking = rankAttention(items, makeContext())
    const score = (id: string): number => ranking.items.find((i) => i.id === id)!.score
    expect(score('IV-1')).toBe(W.interventionOpen)
    expect(score('IV-2')).toBe(W.interventionPending)
    expect(score('BLK-1')).toBe(W.blocker)
    expect(score('SEV-1')).toBe(W.scheduledEvent)
    expect(score('SEV-2')).toBe(0)
    expect(score('NA-1')).toBe(W.nextAction)
    // UNSEEN（含无记录）加 gap:
    const gap = rankAttention(
      [
        makeIntervention({ id: 'IV-1', status: 'OPEN' }),
        makeIntervention({ id: 'IV-3', status: 'OPEN', awarenessState: 'UNSEEN' }),
        makeIntervention({ id: 'IV-4', status: 'OPEN', awarenessState: 'ASSESSED' }),
      ],
      makeContext(),
    ).items
    const g = (id: string): number => gap.find((i) => i.id === id)!.score
    expect(g('IV-1')).toBe(W.interventionOpen + W.awarenessGap) // 无记录 = 默认 UNSEEN
    expect(g('IV-3')).toBe(W.interventionOpen + W.awarenessGap)
    expect(g('IV-4')).toBe(W.interventionOpen)
  })

  it('零权重占位特征恒 0（计划书 §20 清单其余成员 — baseline 第 2 步口径）', () => {
    const W = ATTENTION_WEIGHTS
    expect(W.projectImportanceScale).toBe(0)
    expect(W.attentionModeFocus).toBe(0)
    expect(W.attentionModeNormal).toBe(0)
    expect(W.attentionModeBackground).toBe(0)
    expect(W.dependencyFanout).toBe(0)
    expect(W.reportingUrgency).toBe(0)
    expect(W.contextSwitchingCost).toBe(0)
    expect(W.estimatedDuration).toBe(0)
  })

  it('context 特征差异不改变 baseline 排序（零权重 ⇒ host/client 一致性前提）', () => {
    const input = makeFullSet()
    const a = rankAttention(input, { now: T_NOW, projectImportance: 0, attentionMode: 'BACKGROUND' })
    const b = rankAttention(input, { now: T_NOW, projectImportance: 9, attentionMode: 'FOCUS' })
    expect(b.items.map((i) => `${i.id}:${i.score}`)).toEqual(a.items.map((i) => `${i.id}:${i.score}`))
  })

  it('每行 reasons 非空且覆盖计分项（why-now, 计划书 §20）', () => {
    const ranking = rankAttention(makeFullSet(), makeContext())
    for (const item of ranking.items) {
      expect(item.reasons.length, `reasons of ${item.id}`).toBeGreaterThan(0)
    }
    const iv = ranking.items.find((i) => i.id === 'IV-1')!
    expect(iv.reasons.join(' ')).toContain('OPEN')
    expect(iv.reasons.join(' ')).toContain('AUTO_FLOODING')
    expect(iv.reasons.join(' ')).toContain('UNSEEN')
    const far = ranking.items.find((i) => i.id === 'SEV-2')!
    expect(far.reasons.join(' ')).toContain('视距外')
  })
})

describe('ScheduledEvent 时间近度（计划书 §20: deadline 特征）', () => {
  it('单调性: 越近分越高; 到期封顶 1; 视距外 0（无负分）', () => {
    const W = ATTENTION_WEIGHTS
    const near = scheduledUrgency(T_NOW + 1 * 60 * 60 * 1000, T_NOW)
    const mid = scheduledUrgency(T_NOW + 3 * DAY, T_NOW)
    const far = scheduledUrgency(T_NOW + 6.9 * DAY, T_NOW)
    const atHorizon = scheduledUrgency(T_NOW + W.scheduledEventHorizonMs, T_NOW)
    const beyond = scheduledUrgency(T_NOW + 30 * DAY, T_NOW)
    const overdue = scheduledUrgency(T_NOW - DAY, T_NOW)
    const due = scheduledUrgency(T_NOW, T_NOW)
    expect(overdue).toBe(1)
    expect(due).toBe(1)
    expect(near).toBeGreaterThan(mid)
    expect(mid).toBeGreaterThan(far)
    expect(atHorizon).toBe(0)
    expect(beyond).toBe(0)
    // 全非负:
    for (const u of [overdue, due, near, mid, far, atHorizon, beyond]) expect(u).toBeGreaterThanOrEqual(0)
  })

  it('scoreAttentionItem 与 rankAttention 对同一项给出一致分量', () => {
    const item = makeEvent({ at: T_NOW + 3 * DAY })
    const ctx = makeContext()
    const direct = scoreAttentionItem(item, ctx)
    const viaRank = rankAttention([item], ctx).items[0]!
    expect(viaRank.score).toBe(direct.score)
    expect(viaRank.reasons).toEqual(direct.reasons)
  })
})
