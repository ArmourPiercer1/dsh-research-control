/**
 * WP-6.4 — inbox 视图模型（纯投影 — 零 I/O 面）:
 *
 *  - 冻结面标签映射（InboxSource 7 值 / 类别二分 / InboxState 3 值 —
 *    DOMAIN_SCHEMA §1.4/§13; 未知值原样透出, 不猜）;
 *  - §28 转换动作集 7 kind（封闭序 + 每 kind 字段模型 — 与宿主
 *    InboxConversionTargetFields 判别联合逐字段对齐）;
 *  - 升级条目标记（raw.escalation — 宿主 escalateMechanical 写入;
 *    形状异常 = 无标记 — 展示层不猜）;
 *  - 行投影（badge 集合 + 120 字符预览 + 稳定顺序保持）;
 *  - 转换载荷组装（必填校验面 + workstreamIds 逗号拆 + 空值丢弃）。
 */

import { describe, expect, it } from 'vitest'

import type { InboxItemDto } from '../../src/client/stores/inbox-slice.js'
import {
  buildConversionPayload,
  escalationMarkerOf,
  escalationReasonText,
  formatInboxTime,
  INBOX_CATEGORY_LABEL,
  INBOX_CONVERSION_FIELD_MODELS,
  INBOX_CONVERSION_KIND_LABEL,
  INBOX_CONVERSION_KINDS,
  INBOX_ESCALATION_REASON_LABEL,
  INBOX_SOURCE_CATEGORY,
  INBOX_SOURCE_LABEL,
  INBOX_STATE_LABEL,
  selectInboxRows,
} from '../../src/client/views/inbox/inbox-model.js'

const item = (overrides: Partial<InboxItemDto> = {}): InboxItemDto => ({
  id: 'IN-1',
  source: 'HUMAN_QUICK_CAPTURE',
  payload: 'p',
  raw: null,
  contextRefs: [],
  state: 'CAPTURED',
  convertedTo: null,
  createdAt: 1_700_000_000_000,
  ...overrides,
})

describe('冻结面标签映射', () => {
  it('InboxSource 7 值全覆盖（§1.4 逐字）', () => {
    const sources = [
      'HUMAN_QUICK_CAPTURE',
      'UNCLASSIFIED_AUDIT_FINDING',
      'IMPORTED_MEETING_NOTE',
      'UNREGISTERED_WORKSPACE_CHANGE',
      'AGENT_UNSTRUCTURED_REPORT',
      'EXTERNAL_NOTE',
      'DISCOVERED_SESSION',
    ]
    expect(Object.keys(INBOX_SOURCE_LABEL).sort()).toEqual([...sources].sort())
    expect(Object.keys(INBOX_SOURCE_CATEGORY).sort()).toEqual([...sources].sort())
    for (const s of sources) expect(INBOX_SOURCE_LABEL[s].length).toBeGreaterThan(0)
  })

  it('类别二分（用户面 1 值 / 机械面 6 值 — §11 捕获面）', () => {
    expect(INBOX_SOURCE_CATEGORY.HUMAN_QUICK_CAPTURE).toBe('HUMAN')
    const mechanical = Object.entries(INBOX_SOURCE_CATEGORY).filter(([, c]) => c === 'MECHANICAL')
    expect(mechanical).toHaveLength(6)
    expect(INBOX_CATEGORY_LABEL).toEqual({ HUMAN: '用户', MECHANICAL: '机械' })
  })

  it('InboxState 3 值全覆盖（§13）', () => {
    expect(Object.keys(INBOX_STATE_LABEL).sort()).toEqual(['CAPTURED', 'CONVERTED', 'DISMISSED'])
    expect(INBOX_STATE_LABEL).toEqual({ CAPTURED: '已捕获', CONVERTED: '已转换', DISMISSED: '已忽略' })
  })

  it('未知来源原样透出（不猜 — 冻结面外的防御）', () => {
    const rows = selectInboxRows([item({ source: 'FUTURE_SOURCE' })])
    expect(rows[0].sourceLabel).toBe('FUTURE_SOURCE')
    expect(rows[0].category).toBe('MECHANICAL') // 未知来源 = 机械面兜底（保守）
  })
})

describe('§28 转换动作集（7 kind 封闭）', () => {
  it('7 kind 封闭序（与 §28 动作集逐字）', () => {
    expect(INBOX_CONVERSION_KINDS).toEqual(['TASK', 'NEXT_ACTION', 'INTERVENTION', 'CLAIM', 'FACT', 'REPORTING_ITEM', 'INTERACTION'])
    expect(Object.keys(INBOX_CONVERSION_KIND_LABEL).sort()).toEqual([...INBOX_CONVERSION_KINDS].sort())
  })

  it('每 kind 字段模型（宿主判别联合逐字段对齐 — 必填面钉死）', () => {
    // TASK（workstreamId + title 必填）
    expect(INBOX_CONVERSION_FIELD_MODELS.TASK.map((m) => `${m.name}:${m.required}`)).toEqual([
      'workstreamId:true',
      'title:true',
    ])
    // NEXT_ACTION（statement 必填; rationale/workstreamId 可选）
    expect(INBOX_CONVERSION_FIELD_MODELS.NEXT_ACTION.map((m) => `${m.name}:${m.required}`)).toEqual([
      'statement:true',
      'rationale:false',
      'workstreamId:false',
    ])
    // INTERVENTION（title 必填; detail/workstreamIds 可选）
    expect(INBOX_CONVERSION_FIELD_MODELS.INTERVENTION.map((m) => `${m.name}:${m.required}`)).toEqual([
      'title:true',
      'detail:false',
      'workstreamIds:false',
    ])
    // CLAIM / FACT（workstreamId + statement 必填）
    expect(INBOX_CONVERSION_FIELD_MODELS.CLAIM.map((m) => `${m.name}:${m.required}`)).toEqual([
      'workstreamId:true',
      'statement:true',
    ])
    expect(INBOX_CONVERSION_FIELD_MODELS.FACT.map((m) => `${m.name}:${m.required}`)).toEqual([
      'workstreamId:true',
      'statement:true',
    ])
    // REPORTING_ITEM（audience + statement 必填）
    expect(INBOX_CONVERSION_FIELD_MODELS.REPORTING_ITEM.map((m) => `${m.name}:${m.required}`)).toEqual([
      'audience:true',
      'statement:true',
    ])
    // INTERACTION（interactionKind + title 必填; notes 可选）
    expect(INBOX_CONVERSION_FIELD_MODELS.INTERACTION.map((m) => `${m.name}:${m.required}`)).toEqual([
      'interactionKind:true',
      'title:true',
      'notes:false',
    ])
  })
})

describe('升级条目标记（raw.escalation — 宿主机械判定）', () => {
  it('高影响标记（highImpact=true + reasons）', () => {
    expect(
      escalationMarkerOf({ escalation: { highImpact: true, reasons: ['STRICT_TRACKED_CHANGE', 'DELETION'] } }),
    ).toEqual({ highImpact: true, reasons: ['STRICT_TRACKED_CHANGE', 'DELETION'] })
  })

  it('非高影响标记（highImpact=false — 零联动痕迹也落 raw）', () => {
    expect(escalationMarkerOf({ escalation: { highImpact: false, reasons: [] } })).toEqual({ highImpact: false, reasons: [] })
  })

  it('无标记面: raw=null / 无 escalation 键 / 形状异常 ⇒ null（展示层不猜）', () => {
    expect(escalationMarkerOf(null)).toBeNull()
    expect(escalationMarkerOf({})).toBeNull()
    expect(escalationMarkerOf({ escalation: null })).toBeNull()
    expect(escalationMarkerOf({ escalation: 'nope' })).toBeNull()
    expect(escalationMarkerOf({ escalation: { highImpact: 'yes', reasons: [] } })).toBeNull()
    expect(escalationMarkerOf({ escalation: { highImpact: true, reasons: 'nope' } })).toBeNull()
  })

  it('reasons 过滤非字符串元素（防御 — 冻结 3 值外的值原样透出）', () => {
    expect(escalationMarkerOf({ escalation: { highImpact: true, reasons: ['DELETION', 42, 'BATCH_IMPACT'] } })).toEqual({
      highImpact: true,
      reasons: ['DELETION', 'BATCH_IMPACT'],
    })
  })

  it('理由中文标签（冻结 3 值; 未知值原样）', () => {
    expect(INBOX_ESCALATION_REASON_LABEL).toEqual({
      STRICT_TRACKED_CHANGE: '关键路径',
      DELETION: '损失',
      BATCH_IMPACT: '批量影响',
    })
    expect(
      escalationReasonText(escalationMarkerOf({ escalation: { highImpact: true, reasons: ['DELETION', 'BATCH_IMPACT'] } })),
    ).toBe('损失、批量影响')
  })

  it('reasonText: 无标记 / 非高影响 / 空 reasons ⇒ null（列表不打 ⚠）', () => {
    expect(escalationReasonText(null)).toBeNull()
    expect(escalationReasonText({ highImpact: false, reasons: [] })).toBeNull()
    expect(escalationReasonText({ highImpact: true, reasons: [] })).toBeNull()
  })
})

describe('行投影（selectInboxRows）', () => {
  it('badge 集合 + 预览 + 稳定顺序保持', () => {
    const rows = selectInboxRows([
      item({ id: 'IN-3', state: 'DISMISSED', source: 'AGENT_UNSTRUCTURED_REPORT' }),
      item({ id: 'IN-1', payload: 'x'.repeat(150) }),
      item({
        id: 'IN-2',
        state: 'CONVERTED',
        convertedTo: { kind: 'INTERVENTION', id: 'IV-1' },
        raw: { escalation: { highImpact: true, reasons: ['DELETION'] } },
      }),
    ])
    expect(rows.map((r) => r.item.id)).toEqual(['IN-3', 'IN-1', 'IN-2']) // 顺序保持
    expect(rows[0]).toMatchObject({ sourceLabel: 'Agent 非结构化报告', category: 'MECHANICAL', stateLabel: '已忽略', escalation: null })
    expect(rows[1].preview).toBe(`${'x'.repeat(120)}…`)
    expect(rows[1].preview).toHaveLength(121)
    expect(rows[2].stateLabel).toBe('已转换')
    expect(rows[2].escalation).toEqual({ highImpact: true, reasons: ['DELETION'] })
  })

  it('短 payload 不截断', () => {
    const rows = selectInboxRows([item({ payload: '短' })])
    expect(rows[0].preview).toBe('短')
  })
})

describe('formatInboxTime（本地时区确定性）', () => {
  it('epoch ms → YYYY-MM-DD HH:mm:ss（注入固定时刻 — 零 now 依赖）', () => {
    // 1_700_000_000_000 = 2023-11-14T22:13:20.000Z（本地时区偏移由环境定 —
    // 断言格式骨架 + 位数, 不钉具体时区值 — e2e 同口径）。
    const text = formatInboxTime(1_700_000_000_000)
    expect(text).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  })
})

describe('buildConversionPayload（对话框提交面）', () => {
  it('kind 打头 + 必填值入载荷（空选值丢弃）', () => {
    expect(buildConversionPayload('INTERVENTION', { title: '  Review  ', detail: '' })).toEqual({
      kind: 'INTERVENTION',
      title: 'Review',
    })
  })

  it('workstreamIds 逗号拆（空白过滤）', () => {
    expect(buildConversionPayload('INTERVENTION', { title: 't', workstreamIds: ' WS-1 , ,WS-2 ' })).toEqual({
      kind: 'INTERVENTION',
      title: 't',
      workstreamIds: ['WS-1', 'WS-2'],
    })
  })

  it('非 workstreamIds 字段原样字符串（含 trim）', () => {
    expect(buildConversionPayload('TASK', { workstreamId: ' WS-1 ', title: ' 做A ' })).toEqual({
      kind: 'TASK',
      workstreamId: 'WS-1',
      title: '做A',
    })
  })

  it('全空选值 = 仅 {kind}（对话框必填门在展示层 — 本函数只组装）', () => {
    expect(buildConversionPayload('CLAIM', {})).toEqual({ kind: 'CLAIM' })
  })
})
