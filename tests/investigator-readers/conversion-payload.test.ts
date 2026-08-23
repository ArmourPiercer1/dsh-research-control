/**
 * WP-7.2（RR-018③）— 转换载荷组装（客户端纯函数面）:
 * `buildConversionPayload` 的 datetime-local 字段面（宿主
 * INTERACTION.occurredAt = epoch ms number — 载荷经 Date.parse 转
 * number; 非法值大声抛错, 不静默丢弃）+ 既有面回归（kind 打头 /
 * workstreamIds 逗号拆 / 空值丢弃 / 字符串 trim）。
 */

import { describe, expect, it } from 'vitest'

import { INBOX_CONVERSION_FIELD_MODELS, buildConversionPayload } from '../../src/client/views/inbox/inbox-model.js'

describe('RR-018③ buildConversionPayload — datetime-local 时间面', () => {
  it('INTERACTION.occurredAt: datetime-local 字符串 ⇒ epoch ms number', () => {
    const value = '2026-08-22T09:30'
    const payload = buildConversionPayload('INTERACTION', {
      interactionKind: 'MEETING',
      title: 'calibration',
      occurredAt: value,
    })
    expect(payload.kind).toBe('INTERACTION')
    expect(payload.interactionKind).toBe('MEETING')
    expect(payload.title).toBe('calibration')
    expect(payload.occurredAt).toBe(Date.parse(value))
    expect(typeof payload.occurredAt).toBe('number')
  })

  it('datetime-local 带秒/时区形态均可解析（控件值形态不钉死）', () => {
    for (const value of ['2026-08-22T09:30:00', '2026-08-22T09:30:00.000Z']) {
      const payload = buildConversionPayload('INTERACTION', {
        interactionKind: 'MEETING',
        title: 't',
        occurredAt: value,
      })
      expect(typeof payload.occurredAt).toBe('number')
      expect(Number.isFinite(payload.occurredAt as number)).toBe(true)
    }
  })

  it('非法时间值 ⇒ 大声抛错（不静默, 不落字符串）', () => {
    expect(() =>
      buildConversionPayload('INTERACTION', {
        interactionKind: 'MEETING',
        title: 't',
        occurredAt: 'not-a-datetime',
      }),
    ).toThrowError(/occurredAt.*not a valid datetime/)
  })

  it('空 occurredAt 丢弃（对话框必填门在展示层 — 函数只组装）', () => {
    const payload = buildConversionPayload('INTERACTION', { interactionKind: 'MEETING', title: 't', occurredAt: '' })
    expect(payload).toEqual({ kind: 'INTERACTION', interactionKind: 'MEETING', title: 't' })
  })

  it('字段模型: INTERACTION 含 occurredAt（datetime-local 类型标注）', () => {
    const occurredAt = INBOX_CONVERSION_FIELD_MODELS.INTERACTION.find((m) => m.name === 'occurredAt')!
    expect(occurredAt.required).toBe(true)
    expect(occurredAt.type).toBe('datetime-local')
  })

  it('回归: kind 打头 / workstreamIds 逗号拆 / 空值丢弃 / trim', () => {
    expect(buildConversionPayload('INTERVENTION', { title: '  R  ', workstreamIds: ' WS-1 , ,WS-2 ', detail: '' })).toEqual({
      kind: 'INTERVENTION',
      title: 'R',
      workstreamIds: ['WS-1', 'WS-2'],
    })
    expect(buildConversionPayload('TASK', { workstreamId: ' WS-1 ', title: ' 做A ' })).toEqual({
      kind: 'TASK',
      workstreamId: 'WS-1',
      title: '做A',
    })
    expect(buildConversionPayload('NEXT_ACTION', {})).toEqual({ kind: 'NEXT_ACTION' })
  })
})
