/**
 * WP-6.4 — 高影响升级机械判定纯函数测试（escalation.ts; 计划书 §22.3
 * 「ESCALATE: 高影响/未知/损失 → Intervention」判定半边的机械面 —
 * 三规则: 关键路径 / 损失 / 批量影响; 零自由度、零语义判断, 确定性
 * 钉死）。
 */

import { describe, expect, it } from 'vitest'

import {
  assessEscalation,
  buildEscalationDetail,
  DEFAULT_ESCALATION_BATCH_THRESHOLD,
  escalationInterventionTitle,
} from '../../src/host/service/inbox/index.js'

describe('assessEscalation（机械判定 — 纯, 确定性）', () => {
  it('零信号 = 非高影响（空 reasons）', () => {
    expect(assessEscalation({ summary: 's' })).toEqual({ highImpact: false, reasons: [] })
    expect(assessEscalation({ summary: 's', strictTrackedPaths: [], deletedPaths: [], affectedPathCount: 0 })).toEqual({
      highImpact: false,
      reasons: [],
    })
  })

  it('关键路径: strictTrackedPaths 非空 ⇒ STRICT_TRACKED_CHANGE（1 条即触发）', () => {
    expect(assessEscalation({ summary: 's', strictTrackedPaths: ['src/core/train.py'] })).toEqual({
      highImpact: true,
      reasons: ['STRICT_TRACKED_CHANGE'],
    })
  })

  it('损失: deletedPaths 非空 ⇒ DELETION', () => {
    expect(assessEscalation({ summary: 's', deletedPaths: ['results/final.csv'] })).toEqual({
      highImpact: true,
      reasons: ['DELETION'],
    })
  })

  it('批量影响: affectedPathCount ≥ threshold（默认 5 — 边界钉 4/5/100）', () => {
    expect(DEFAULT_ESCALATION_BATCH_THRESHOLD).toBe(5)
    expect(assessEscalation({ summary: 's', affectedPathCount: 4 }).highImpact).toBe(false)
    expect(assessEscalation({ summary: 's', affectedPathCount: 5 }).reasons).toEqual(['BATCH_IMPACT'])
    expect(assessEscalation({ summary: 's', affectedPathCount: 100 }).reasons).toEqual(['BATCH_IMPACT'])
    expect(assessEscalation({ summary: 's' }).highImpact).toBe(false) // 缺省 = 0
  })

  it('threshold 注入面（≥1 校验 — 0/负数/非整数大声 RangeError）', () => {
    expect(assessEscalation({ summary: 's', affectedPathCount: 2 }, { batchThreshold: 2 }).highImpact).toBe(true)
    expect(assessEscalation({ summary: 's', affectedPathCount: 1 }, { batchThreshold: 1 }).highImpact).toBe(true)
    expect(() => assessEscalation({ summary: 's' }, { batchThreshold: 0 })).toThrow(RangeError)
    expect(() => assessEscalation({ summary: 's' }, { batchThreshold: -1 })).toThrow(RangeError)
    expect(() => assessEscalation({ summary: 's' }, { batchThreshold: 1.5 })).toThrow(RangeError)
  })

  it('多规则 OR + 冻结理由序（STRICT_TRACKED_CHANGE, DELETION, BATCH_IMPACT — 不短路）', () => {
    const assessment = assessEscalation({
      summary: 's',
      strictTrackedPaths: ['a'],
      deletedPaths: ['b'],
      affectedPathCount: 9,
    })
    expect(assessment.highImpact).toBe(true)
    expect(assessment.reasons).toEqual(['STRICT_TRACKED_CHANGE', 'DELETION', 'BATCH_IMPACT'])
  })

  it('确定性: 同输入同输出（重复调用逐字段同形）', () => {
    const evidence = { summary: 's', strictTrackedPaths: ['a'], deletedPaths: ['b'], affectedPathCount: 9 }
    expect(assessEscalation(evidence)).toEqual(assessEscalation(evidence))
  })
})

describe('buildEscalationDetail（机械证据摘要 — 确定性格式）', () => {
  it('全信号摘要含三规则事实 + 阈值 + WS（零语义词）', () => {
    const evidence = {
      summary: 's',
      workstreamIds: ['WS-1', 'WS-2'],
      strictTrackedPaths: ['src/a.py', 'src/b.py'],
      deletedPaths: ['c.csv'],
      affectedPathCount: 7,
    }
    const assessment = assessEscalation(evidence, { batchThreshold: 3 })
    const detail = buildEscalationDetail(evidence, assessment, 3)
    expect(detail).toBe(
      'escalation (plan §22.3): highImpact=true; ' +
        'reasons=[STRICT_TRACKED_CHANGE, DELETION, BATCH_IMPACT]; ' +
        'strict_tracked=2 [src/a.py, src/b.py]; ' +
        'deleted=1 [c.csv]; ' +
        'affected_paths=7; ' +
        'batch_threshold=3; ' +
        'workstreams=[WS-1, WS-2]',
    )
  })

  it('零信号摘要（highImpact=false — reasons 段省略）', () => {
    const evidence = { summary: 's', affectedPathCount: 1 }
    const detail = buildEscalationDetail(evidence, assessEscalation(evidence), 5)
    expect(detail).toBe('escalation (plan §22.3): highImpact=false; affected_paths=1; batch_threshold=5')
  })
})

describe('escalationInterventionTitle（机械标题派生）', () => {
  it('有 WS 关联 = 首 WS id 逐字嵌入 [WS-<n>]（多 WS 只取第一个 — 事件 owner 口径）', () => {
    expect(escalationInterventionTitle(['WS-3'])).toBe('High-impact research discrepancy [WS-3]')
    expect(escalationInterventionTitle(['WS-3', 'WS-9'])).toBe('High-impact research discrepancy [WS-3]')
  })

  it('无 WS 关联 = 无后缀', () => {
    expect(escalationInterventionTitle(undefined)).toBe('High-impact research discrepancy')
    expect(escalationInterventionTitle([])).toBe('High-impact research discrepancy')
  })
})
