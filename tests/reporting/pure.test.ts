/**
 * WP-5.3 — 纯语义 + 冻结 schema 同构 (无 I/O):
 *  - §13 RPT 状态机: 25 格真值表逐格钉死 (与 DOMAIN_SCHEMA §13 原文
 *    逐字对照) + 自环拒绝;
 *  - V1 schedule 语义 (schedule.ts): 窗口过滤边界 / 排序键 / 提醒点;
 *  - 冻结 reporting.schema.json 同构: service 产出的记录逐条过 ajv
 *    2020-12 校验器 ($defs/Interaction | ReportingItem | ScheduledEvent,
 *    additionalProperties:false) — 行投影 = 冻结形状 (WP-3.1 同口径)。
 */

import Ajv2020 from 'ajv/dist/2020.js'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  RPT_LEGAL_TRANSITIONS,
  RPT_STATUSES,
  checkRptTransition,
  eventActiveInWindow,
  isRptTransitionLegal,
  reminderPoint,
  scheduleSortKey,
  type RptStatus,
  type SevSchedule,
} from '../../src/host/service/reporting/index.js'

const HERE = dirname(fileURLToPath(import.meta.url))

/* ==================================================================== *
 * §13 状态机 25 格真值表 (冻结表逐字)
 * ==================================================================== */

/** DOMAIN_SCHEMA §13 ReportingItem 行, 逐字钉死 (独立于实现再声明一次). */
const FROZEN_TABLE: Readonly<Record<RptStatus, readonly RptStatus[]>> = {
  OPEN: ['MATERIAL_READY'],
  MATERIAL_READY: ['READY_TO_REPORT', 'OPEN'],
  READY_TO_REPORT: ['REPORTED', 'MATERIAL_READY'],
  REPORTED: ['FOLLOW_UP_REQUIRED'],
  FOLLOW_UP_REQUIRED: ['READY_TO_REPORT'],
}

describe('§13 RPT 状态机 — 25 格真值表', () => {
  it('the implementation table is the frozen §13 table, cell for cell', () => {
    for (const from of RPT_STATUSES) {
      expect([...RPT_LEGAL_TRANSITIONS[from]].sort()).toEqual([...FROZEN_TABLE[from]].sort())
    }
  })

  it('every (from, to) cell agrees with the frozen table', () => {
    for (const from of RPT_STATUSES) {
      for (const to of RPT_STATUSES) {
        expect(isRptTransitionLegal(from, to), `${from} → ${to}`).toBe(FROZEN_TABLE[from].includes(to))
      }
    }
  })

  it('self-loops are rejected (表外 — 与 intervention §13 guard 同纪律)', () => {
    for (const status of RPT_STATUSES) {
      expect(() => checkRptTransition('RPT-1', status, status)).toThrow(/self-loops/)
    }
  })
})

/* ==================================================================== *
 * V1 schedule 语义 (无锚点 RECURRING = 活跃跨度)
 * ==================================================================== */

const DAY = 86_400_000
const T0 = Date.parse('2026-08-22T09:00:00Z')

describe('V1 时间窗过滤 (ONCE / RECURRING 活跃跨度)', () => {
  it('ONCE: 两端闭 — at == from / at == to 命中, 边界外排除', () => {
    const s: SevSchedule = { kind: 'ONCE', at: T0 + 5 * DAY }
    expect(eventActiveInWindow(s, { from: T0 + 5 * DAY, to: T0 + 10 * DAY })).toBe(true) // at == from
    expect(eventActiveInWindow(s, { from: T0, to: T0 + 5 * DAY })).toBe(true) // at == to
    expect(eventActiveInWindow(s, { from: T0 + 5 * DAY + 1, to: T0 + 10 * DAY })).toBe(false)
    expect(eventActiveInWindow(s, { from: T0 + 10 * DAY })).toBe(false)
  })

  it('ONCE: to 缺省 = +∞ (未来事件命中, 过去事件排除)', () => {
    const future: SevSchedule = { kind: 'ONCE', at: T0 + DAY }
    const past: SevSchedule = { kind: 'ONCE', at: T0 - DAY }
    expect(eventActiveInWindow(future, { from: T0 })).toBe(true)
    expect(eventActiveInWindow(past, { from: T0 })).toBe(false)
  })

  it('RECURRING: until ∈ [from, +∞) 命中; until < from 排除; 无 until 恒命中 (活跃跨度 (−∞, until])', () => {
    expect(eventActiveInWindow({ kind: 'RECURRING', freq: 'WEEKLY', until: T0 }, { from: T0 })).toBe(true) // until == from
    expect(eventActiveInWindow({ kind: 'RECURRING', freq: 'WEEKLY', until: T0 + DAY }, { from: T0, to: T0 + 10 * DAY })).toBe(true)
    expect(eventActiveInWindow({ kind: 'RECURRING', freq: 'WEEKLY', until: T0 - 1 }, { from: T0 })).toBe(false)
    expect(eventActiveInWindow({ kind: 'RECURRING', freq: 'MONTHLY' }, { from: T0, to: T0 + DAY })).toBe(true)
  })
})

describe('时间轴排序键 (ONCE → at; RECURRING → until/尾部)', () => {
  it('orders ONCE by at, RECURRING by until, open-ended last', () => {
    const keys: ReadonlyArray<{ label: string; schedule: SevSchedule }> = [
      { label: 'open', schedule: { kind: 'RECURRING', freq: 'DAILY' } },
      { label: 'once-late', schedule: { kind: 'ONCE', at: T0 + 10 * DAY } },
      { label: 'rec-until', schedule: { kind: 'RECURRING', freq: 'WEEKLY', until: T0 + 5 * DAY } },
      { label: 'once-early', schedule: { kind: 'ONCE', at: T0 + DAY } },
    ]
    const sorted = [...keys].sort((a, b) => scheduleSortKey(a.schedule) - scheduleSortKey(b.schedule)).map((k) => k.label)
    expect(sorted).toEqual(['once-early', 'rec-until', 'once-late', 'open'])
  })
})

describe('提醒点 (展示用 — 无推送)', () => {
  it('ONCE + lead → at − lead; 负值 → null; RECURRING → null; 无 lead → null', () => {
    const once: SevSchedule = { kind: 'ONCE', at: T0 + DAY }
    expect(reminderPoint(once, 3_600_000)).toBe(T0 + DAY - 3_600_000)
    expect(reminderPoint(once, T0 + 2 * DAY)).toBeNull() // at − lead < 0 (lead 超过发生点 ⇒ 负提醒点不展示)
    expect(reminderPoint(once, undefined)).toBeNull()
    expect(reminderPoint(once, -1)).toBeNull()
    expect(reminderPoint({ kind: 'RECURRING', freq: 'WEEKLY' }, 3_600_000)).toBeNull()
  })
})

/* ==================================================================== *
 * 冻结 reporting.schema.json 同构 (ajv 2020-12)
 * ==================================================================== */

/** 读入冻结 schema (WR 根 schema/operational + common — SI-001 布局). */
function loadFrozenValidators() {
  const schemaRoot = resolve(HERE, '..', '..', '..')
  const reporting = JSON.parse(readFileSync(join(schemaRoot, 'schema', 'operational', 'reporting.schema.json'), 'utf8'))
  const common = JSON.parse(readFileSync(join(schemaRoot, 'schema', 'common.schema.json'), 'utf8'))
  const ajv = new Ajv2020({ allErrors: true, strict: false })
  ajv.addSchema(common, common.$id)
  ajv.addSchema(reporting, reporting.$id)
  const mk = (def: string) => {
    const v = ajv.getSchema(`${reporting.$id}#/$defs/${def}`)
    if (v === undefined || v === null) throw new Error(`validator missing for $defs/${def}`)
    return v
  }
  return { interaction: mk('Interaction'), reportingItem: mk('ReportingItem'), scheduledEvent: mk('ScheduledEvent') }
}

describe('service 记录 ↔ 冻结 reporting.schema.json 同构', () => {
  it('full-shape records validate (additionalProperties:false 逐字段)', () => {
    const { interaction, reportingItem, scheduledEvent } = loadFrozenValidators()
    const iv = {
      id: 'INT-1',
      kind: 'MEETING',
      title: '周会',
      occurred_at: T0,
      participants: ['张三'],
      notes: '纪要',
      related_workstreams: ['WS-1'],
    }
    expect(interaction(iv)).toBe(true)
    const rpt = {
      id: 'RPT-1',
      audience: '导师',
      statement: '进展',
      material_refs: [{ kind: 'ARTIFACT', id: 'A-1' }],
      status: 'OPEN',
      occasion_ref: 'SEV-1',
      created_at: T0,
      reported_at: T0 + DAY,
    }
    expect(reportingItem(rpt)).toBe(true)
    expect(scheduledEvent({ id: 'SEV-1', title: '组会', schedule: { kind: 'ONCE', at: T0 }, reminder_lead_ms: 60_000 })).toBe(true)
    expect(
      scheduledEvent({ id: 'SEV-2', title: '月度', schedule: { kind: 'RECURRING', freq: 'WEEKLY', interval: 2, until: T0 + DAY } }),
    ).toBe(true)
  })

  it('off-shape records are rejected (多余属性 / 坏 enum / 坏 id 前缀)', () => {
    const { interaction, reportingItem, scheduledEvent } = loadFrozenValidators()
    expect(interaction({ id: 'INT-1', kind: 'MEETING', title: 'x', occurred_at: T0, created_at: T0 })).toBe(false) // 多余属性
    expect(interaction({ id: 'INT-1', kind: 'HACKED', title: 'x', occurred_at: T0 })).toBe(false)
    expect(interaction({ id: 'IN-1', kind: 'MEETING', title: 'x', occurred_at: T0 })).toBe(false) // IN ≠ INT (前缀含义陷阱)
    expect(reportingItem({ id: 'RPT-1', audience: 'a', statement: 's', status: 'BROKEN', created_at: T0 })).toBe(false)
    expect(reportingItem({ id: 'RPT-1', audience: 'a', statement: 's', status: 'OPEN', created_at: -1 })).toBe(false)
    expect(scheduledEvent({ id: 'SEV-1', title: 'x', schedule: { kind: 'RECURRING', freq: 'HOURLY' } })).toBe(false)
    expect(scheduledEvent({ id: 'SEV-1', title: 'x', schedule: { kind: 'ONCE' } })).toBe(false) // 缺 at
    expect(
      scheduledEvent({ id: 'SEV-1', title: 'x', schedule: { kind: 'ONCE', at: T0 }, related_refs: [{ kind: 'TASK', id: 'T-1' }] }),
    ).toBe(false) // kind 不在 RPT/IV/TPC 冻结集
  })

  it('the schedule oneOf discriminates (ONCE 带 at / RECURRING 带 freq — 互斥形状)', () => {
    const { scheduledEvent } = loadFrozenValidators()
    expect(scheduledEvent({ id: 'SEV-1', title: 'x', schedule: { kind: 'ONCE', at: T0, freq: 'DAILY' } })).toBe(false) // ONCE 多余 freq
    expect(scheduledEvent({ id: 'SEV-1', title: 'x', schedule: { kind: 'RECURRING', freq: 'DAILY', at: T0 } })).toBe(false) // RECURRING 多余 at
  })
})
