/**
 * WP-7.2（RR-018③）— Inbox 转换按钮接通（宿主侧生产执行器）:
 * 真实 wiring 的 `wiring.inbox.convert`（转换确认对话框的载荷经
 * InboxService 落到**真实 WP-5 service** — 用户显式语义保持）:
 *  - INTERVENTION ⇒ WP-5.1 InterventionService.createUserIntervention
 *    （USER origin; source_refs 带 INBOX_ITEM provenance）;
 *  - NEXT_ACTION ⇒ WP-5.2 ActionsService.createNextAction;
 *  - INTERACTION ⇒ WP-5.3 ReportingService.registerInteraction
 *    （occurredAt = number — 客户端 datetime-local 面经 Date.parse）;
 *  - REPORTING_ITEM ⇒ WP-5.3 createReportingItem;
 *  - CLAIM / FACT / TASK ⇒ 大声 IN_TARGET_NOT_WIRED（V1 边界 — 条目
 *    保持 CAPTURED）;
 *  - 成功 ⇒ 条目 CONVERTED（终态, converted_to 已写）+ INBOX_CONVERTED
 *    账本行（MA 面, rawDb 直查）;
 *  - 执行器失败（目标校验拒绝）⇒ IN_CONVERT_TARGET, 条目保持 CAPTURED;
 *  - dismiss ⇒ DISMISSED 终态。
 */

import { describe, expect, it } from 'vitest'

import { InboxError, USER_ACTOR } from '../../src/host/service/inbox/index.js'
import { makeWiring, rawDb, T0, type WiringBundle } from '../wiring/helpers.js'

function captureItem(b: WiringBundle, i: number): string {
  const res = b.wiring.inbox.captureHuman({ payload: `human note ${i} — convert me` }, USER_ACTOR)
  return res.item.id
}

describe('RR-018③ 生产转换执行器（真实 wiring.inbox.convert）', () => {
  it('INTERVENTION ⇒ 真实 IV（USER origin + INBOX_ITEM provenance）+ CONVERTED + MA 账本', () => {
    const b = makeWiring()
    const id = captureItem(b, 1)
    const before = b.wiring.interventions.listInterventions().length
    const res = b.wiring.inbox.convert(
      {
        inboxItemId: id,
        targetKind: 'INTERVENTION',
        fields: { kind: 'INTERVENTION', title: 'review this', detail: 'from inbox', workstreamIds: ['WS-1'] },
      },
      USER_ACTOR,
    )
    expect(res.convertedTo).toMatchObject({ kind: 'INTERVENTION' })
    expect(res.managementActionId).toMatch(/^MA-[1-9]/)

    const ivs = b.wiring.interventions.listInterventions()
    expect(ivs).toHaveLength(before + 1)
    const iv = ivs[ivs.length - 1]!
    expect(iv.id).toBe(res.convertedTo.id)
    expect(iv.origin).toBe('USER')
    expect(iv.status).toBe('OPEN')
    expect(iv.title).toBe('review this')
    expect(iv.workstream_ids).toEqual(['WS-1'])
    // provenance: INBOX_ITEM ref 在 source_refs 内。
    expect(iv.source_refs.some((r) => r.kind === 'INBOX_ITEM' && r.id === id)).toBe(true)

    // 条目终态 + converted_to。
    const item = b.wiring.inbox.listItems({ state: 'CONVERTED' }).find((x) => x.id === id)!
    expect(item.state).toBe('CONVERTED')
    expect(item.converted_to).toMatchObject({ kind: 'INTERVENTION', id: res.convertedTo.id })

    // INBOX_CONVERTED 账本行（management_action — 共享文件, 双连接可见）。
    const db = rawDb(b.dataDir)
    try {
      const row = db.prepare('SELECT * FROM management_action WHERE id = ?').get(res.managementActionId!) as
        | { id: string; action_kind: string; detail: string }
        | undefined
      expect(row?.action_kind).toBe('INBOX_CONVERTED')
      expect(row?.detail).toContain(id)
    } finally {
      db.close()
    }
  })

  it('NEXT_ACTION ⇒ 真实 NextAction 行（convertedTo id 可回查）', () => {
    const b = makeWiring()
    const id = captureItem(b, 2)
    const res = b.wiring.inbox.convert(
      {
        inboxItemId: id,
        targetKind: 'NEXT_ACTION',
        fields: { kind: 'NEXT_ACTION', statement: 'run the probe', rationale: 'from inbox', workstreamId: 'WS-1' },
      },
      USER_ACTOR,
    )
    expect(res.convertedTo).toMatchObject({ kind: 'NEXT_ACTION' })
    expect(res.convertedTo.id).toMatch(/^NA-[1-9]/)

    // NextAction 行真实存在（next_actions 表 — 共享文件可见）。
    const db = rawDb(b.dataDir)
    try {
      const row = db.prepare('SELECT * FROM next_action WHERE id = ?').get(res.convertedTo.id) as
        | { id: string; statement: string; workstream_id: string | null }
        | undefined
      expect(row?.statement).toBe('run the probe')
      expect(row?.workstream_id).toBe('WS-1')
    } finally {
      db.close()
    }
    expect(b.wiring.inbox.listItems({ state: 'CONVERTED' }).some((x) => x.id === id)).toBe(true)
  })

  it('INTERACTION ⇒ 真实 Interaction 行（occurredAt number 面）', () => {
    const b = makeWiring()
    const id = captureItem(b, 3)
    const occurredAt = T0 + 12_345
    const res = b.wiring.inbox.convert(
      {
        inboxItemId: id,
        targetKind: 'INTERACTION',
        fields: {
          kind: 'INTERACTION',
          interactionKind: 'MEETING',
          occurredAt,
          title: 'calibration sync',
          participants: ['alice', 'bob'],
          notes: 'from inbox',
        },
      },
      USER_ACTOR,
    )
    expect(res.convertedTo).toMatchObject({ kind: 'INTERACTION' })
    expect(res.convertedTo.id).toMatch(/^INT-[1-9]/)
    const db = rawDb(b.dataDir)
    try {
      const row = db.prepare('SELECT * FROM interaction WHERE id = ?').get(res.convertedTo.id) as
        | { id: string; title: string; occurred_at: number }
        | undefined
      expect(row?.title).toBe('calibration sync')
      expect(row?.occurred_at).toBe(occurredAt)
    } finally {
      db.close()
    }
  })

  it('REPORTING_ITEM ⇒ 真实 ReportingItem 行', () => {
    const b = makeWiring()
    const id = captureItem(b, 4)
    const res = b.wiring.inbox.convert(
      {
        inboxItemId: id,
        targetKind: 'REPORTING_ITEM',
        fields: { kind: 'REPORTING_ITEM', audience: 'supervisor', statement: 'weekly progress' },
      },
      USER_ACTOR,
    )
    expect(res.convertedTo).toMatchObject({ kind: 'REPORTING_ITEM' })
    expect(res.convertedTo.id).toMatch(/^RPT-[1-9]/)
    const db = rawDb(b.dataDir)
    try {
      const row = db.prepare('SELECT * FROM reporting_item WHERE id = ?').get(res.convertedTo.id) as
        | { id: string; statement: string }
        | undefined
      expect(row?.statement).toBe('weekly progress')
    } finally {
      db.close()
    }
  })

  it('CLAIM / FACT / TASK ⇒ 大声失败（执行器点名 kind + V1 边界）, 条目保持 CAPTURED', () => {
    // 服务契约: 执行器已接线时, 执行器内失败统一包装为 IN_CONVERT_TARGET
    // （IN_TARGET_NOT_WIRED 专属「组合未接执行器」）— 失败信息点名 kind 与
    // V1 边界（零语义判断, 条目可重试）, 无任何正式对象产生。
    const b = makeWiring()
    const id = captureItem(b, 5)
    const attempts: Array<{ targetKind: 'CLAIM' | 'FACT' | 'TASK'; fields: Record<string, unknown> }> = [
      { targetKind: 'CLAIM', fields: { kind: 'CLAIM', workstreamId: 'WS-1', statement: 's' } },
      { targetKind: 'FACT', fields: { kind: 'FACT', workstreamId: 'WS-1', statement: 's' } },
      { targetKind: 'TASK', fields: { kind: 'TASK', workstreamId: 'WS-1', title: 't' } },
    ]
    for (const a of attempts) {
      try {
        b.wiring.inbox.convert({ inboxItemId: id, targetKind: a.targetKind, fields: a.fields as never }, USER_ACTOR)
        expect.unreachable(`${a.targetKind} must throw`)
      } catch (e) {
        expect(e instanceof InboxError).toBe(true)
        expect((e as InboxError).code).toBe('IN_CONVERT_TARGET')
        expect((e as InboxError).message).toContain(a.targetKind)
        expect((e as InboxError).message).toContain('not wired')
        expect((e as InboxError).message).toContain('V1 boundary')
      }
    }
    // 三次失败 ⇒ 零写入: 条目保持 CAPTURED, 无任何正式对象。
    expect(b.wiring.inbox.listItems({ state: 'CAPTURED' }).some((x) => x.id === id)).toBe(true)
    expect(b.wiring.inbox.listItems({ state: 'CONVERTED' })).toHaveLength(0)
    expect(b.wiring.interventions.listInterventions()).toHaveLength(0)
  })

  it('执行器失败（目标拒绝: INTERVENTION 关联未知 WS）⇒ IN_CONVERT_TARGET, 条目保持 CAPTURED', () => {
    const b = makeWiring()
    const id = captureItem(b, 6)
    try {
      b.wiring.inbox.convert(
        {
          inboxItemId: id,
          targetKind: 'INTERVENTION',
          fields: { kind: 'INTERVENTION', title: 't', workstreamIds: ['WS-999'] },
        },
        USER_ACTOR,
      )
      expect.unreachable('must throw')
    } catch (e) {
      expect(e instanceof InboxError).toBe(true)
      expect((e as InboxError).code).toBe('IN_CONVERT_TARGET')
      expect((e as InboxError).message).toContain(id)
    }
    // 条目保持 CAPTURED（可重试）; 无 IV 产生。
    expect(b.wiring.inbox.listItems({ state: 'CAPTURED' }).some((x) => x.id === id)).toBe(true)
    expect(b.wiring.interventions.listInterventions()).toHaveLength(0)
  })

  it('fields.kind 与 targetKind 不配对 ⇒ IN_INPUT（运行面再断言）', () => {
    const b = makeWiring()
    const id = captureItem(b, 7)
    try {
      b.wiring.inbox.convert(
        { inboxItemId: id, targetKind: 'FACT', fields: { kind: 'CLAIM', workstreamId: 'WS-1', statement: 's' } },
        USER_ACTOR,
      )
      expect.unreachable('must throw')
    } catch (e) {
      expect((e as InboxError).code).toBe('IN_INPUT')
    }
  })

  it('CONVERTED 终态不可重转（§13 状态机门）; dismiss ⇒ DISMISSED', () => {
    const b = makeWiring()
    const id1 = captureItem(b, 8)
    b.wiring.inbox.convert(
      { inboxItemId: id1, targetKind: 'NEXT_ACTION', fields: { kind: 'NEXT_ACTION', statement: 's1' } },
      USER_ACTOR,
    )
    try {
      b.wiring.inbox.convert(
        { inboxItemId: id1, targetKind: 'NEXT_ACTION', fields: { kind: 'NEXT_ACTION', statement: 's2' } },
        USER_ACTOR,
      )
      expect.unreachable('terminal state must reject')
    } catch (e) {
      expect((e as InboxError).code).toBe('IN_ILLEGAL_TRANSITION')
    }
    const id2 = captureItem(b, 9)
    const dis = b.wiring.inbox.dismiss(id2, USER_ACTOR)
    expect(dis).toMatchObject({ inboxItemId: id2, stateFrom: 'CAPTURED', stateTo: 'DISMISSED' })
    expect(b.wiring.inbox.listItems({ state: 'DISMISSED' }).some((x) => x.id === id2)).toBe(true)
  })
})
