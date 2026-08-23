/**
 * WP-5.1 — InterventionLifecycleStore 面审计（真实 research.sqlite +
 * 真实冻结 attention schema 形状网 + WP-3.5 DDL 单一来源）。
 *
 * 覆盖:
 *  - DDL 幂等应用（第二连接构造后表 + 索引 + 触发器就位 — 任何连接生效）;
 *  - 存储层触发器双面: 任何连接 raw DELETE ⇒ ABORT（INV-HIST-7）; 内容列
 *    UPDATE ⇒ ABORT（创建后 8 内容列不可变）; 状态缓存三列 UPDATE 放行
 *    （§13 迁移唯一合法行侧面, 仅用户 — actor 门在 service 层）;
 *  - `updateState` 条件 UPDATE: 1 行（expected 匹配）/ 0 行（不匹配）;
 *  - 边界参数（坏 id / 坏 status / 坏 closed_at / 坏 note）⇒ IV_INPUT;
 *  - **无 delete 方法**（API 面即权限面 — 原型键审计, 同 WP-3.5 纪律）;
 *  - 查询委托 + 稳定顺序 + insert 形状网穿透（真实冻结 schema）。
 */

import { describe, expect, it } from 'vitest'

import {
  INTERVENTION_TABLE,
  type InterventionRecord,
} from '../../src/host/service/flooding/index.js'
import {
  InterventionError,
  InterventionLifecycleStore,
  isInterventionError,
} from '../../src/host/service/intervention/index.js'
import { makeInterventionHarness, throwsIntervention, type InterventionHarness } from './fixtures.js'

const harnesses: InterventionHarness[] = []
function harness(): InterventionHarness {
  const h = makeInterventionHarness()
  harnesses.push(h)
  return h
}

function seedRecord(h: InterventionHarness, over: Partial<InterventionRecord> = {}): InterventionRecord {
  const record: InterventionRecord = {
    id: 'IV-77',
    title: 'store 面审计行',
    origin: 'USER',
    workstream_ids: ['WS-1'],
    source_refs: [],
    status: 'OPEN',
    created_by: { kind: 'USER', label: 'researcher' },
    created_at: 1_700_000_000_123,
    ...over,
  }
  h.lifecycle.insertIntervention(record)
  return record
}

describe('DDL + 存储层触发器（WP-3.5 单一来源, 任何连接生效）', () => {
  it('第二连接构造后: 表 + 状态索引 + 双触发器就位', () => {
    const h = harness()
    const objects = h.raw
      .prepare(`SELECT type, name FROM sqlite_master WHERE tbl_name = ? AND type IN ('table', 'index', 'trigger') ORDER BY type, name`)
      .all(INTERVENTION_TABLE) as { type: string; name: string }[]
    const names = objects.map((o) => `${o.type}:${o.name}`)
    expect(names).toContain('table:intervention')
    expect(names).toContain('index:idx_intervention_status')
    expect(names).toContain('trigger:intervention_no_delete')
    expect(names).toContain('trigger:intervention_no_content_update')
    // 幂等: 再构造一个 lifecycle store（同连接 DDL 重放）不炸。
    expect(() => new InterventionLifecycleStore({ db: h.dbPair.db, interventions: h.interventions })).not.toThrow()
  })

  it('任何连接 raw DELETE ⇒ ABORT（INV-HIST-7 — 一等 identity 不 hard delete）', () => {
    const h = harness()
    seedRecord(h)
    expect(() => h.raw.prepare(`DELETE FROM ${INTERVENTION_TABLE} WHERE id = 'IV-77'`).run()).toThrow(/never deleted/)
    expect(h.lifecycle.getIntervention('IV-77')).not.toBeNull()
  })

  it('内容列 UPDATE ⇒ ABORT（8 内容列创建后不可变 — 逐列探针）', () => {
    const h = harness()
    seedRecord(h)
    for (const col of ['title', 'detail', 'origin', 'workstream_ids', 'source_refs', 'created_by', 'created_at', 'id']) {
      expect(
        () =>
          h.raw
            .prepare(col === 'id' ? `UPDATE ${INTERVENTION_TABLE} SET id = 'IV-78' WHERE id = 'IV-77'` : `UPDATE ${INTERVENTION_TABLE} SET ${col} = 'x' WHERE id = 'IV-77'`)
            .run(),
        `content column ${col} must be immutable`,
      ).toThrow(/content is immutable/)
    }
  })

  it('状态缓存三列 UPDATE 放行（§13 迁移唯一合法行侧面）', () => {
    const h = harness()
    seedRecord(h)
    h.raw.prepare(`UPDATE ${INTERVENTION_TABLE} SET status = 'PENDING', closed_at = NULL, resolution_note = NULL WHERE id = 'IV-77'`).run()
    expect(h.lifecycle.getIntervention('IV-77')!.status).toBe('PENDING')
  })
})

describe('updateState（状态缓存列条件 UPDATE — 乐观并发门）', () => {
  it('expected 匹配 ⇒ 1 行; 状态/时间戳/备注逐字段落库', () => {
    const h = harness()
    seedRecord(h)
    const affected = h.lifecycle.updateState('IV-77', 'CLOSED', 1_700_000_000_999, '已处置', 'OPEN')
    expect(affected).toBe(1)
    const row = h.lifecycle.getIntervention('IV-77')!
    expect(row.status).toBe('CLOSED')
    expect(row.closed_at).toBe(1_700_000_000_999)
    expect(row.resolution_note).toBe('已处置')
  })

  it('expected 不匹配 ⇒ 0 行（行不变 — 并发迁移大声判别的行侧半边）', () => {
    const h = harness()
    seedRecord(h)
    h.raw.prepare(`UPDATE ${INTERVENTION_TABLE} SET status = 'PENDING' WHERE id = 'IV-77'`).run()
    const affected = h.lifecycle.updateState('IV-77', 'CLOSED', null, null, 'OPEN')
    expect(affected).toBe(0)
    expect(h.lifecycle.getIntervention('IV-77')!.status).toBe('PENDING')
    expect(h.lifecycle.getIntervention('IV-77')!.closed_at).toBeUndefined()
  })

  it('离开 CLOSED 语义: closed_at 置 NULL（状态缓存列随迁移收敛）', () => {
    const h = harness()
    seedRecord(h, { status: 'CLOSED', closed_at: 1_700_000_000_500, resolution_note: 'n' })
    const affected = h.lifecycle.updateState('IV-77', 'PENDING', null, null, 'CLOSED')
    expect(affected).toBe(1)
    const row = h.lifecycle.getIntervention('IV-77')!
    expect(row.status).toBe('PENDING')
    expect(row.closed_at).toBeUndefined()
    expect(row.resolution_note).toBeUndefined()
  })

  it('边界参数: 坏 id 模式 / 坏 status / 坏 expected / 坏 closed_at / 坏 note ⇒ IV_INPUT', () => {
    const h = harness()
    seedRecord(h)
    throwsIntervention(() => h.lifecycle.updateState('IV-0', 'PENDING', null, null, 'OPEN'), 'IV_INPUT', /well-formed IV id/)
    throwsIntervention(() => h.lifecycle.updateState('IV-77', 'DONE' as never, null, null, 'OPEN'), 'IV_INPUT', /must be one of/)
    throwsIntervention(() => h.lifecycle.updateState('IV-77', 'PENDING', null, null, 'MAYBE' as never), 'IV_INPUT', /must be one of/)
    throwsIntervention(() => h.lifecycle.updateState('IV-77', 'CLOSED', -1, null, 'OPEN'), 'IV_INPUT', /closedAt/)
    throwsIntervention(() => h.lifecycle.updateState('IV-77', 'CLOSED', null, 42 as never, 'OPEN'), 'IV_INPUT', /resolutionNote/)
    // 行未动。
    expect(h.lifecycle.getIntervention('IV-77')!.status).toBe('OPEN')
  })
})

describe('API 面即权限面 + 查询委托', () => {
  it('原型无 delete / 内容更新方法（无 delete — INV-HIST-7; 迁移仅状态缓存面）', () => {
    const h = harness()
    const proto = Object.getPrototypeOf(h.lifecycle)
    const methods = Object.getOwnPropertyNames(proto).filter((n) => n !== 'constructor' && typeof (proto as unknown as Record<string, unknown>)[n] === 'function')
    expect(methods).toEqual(expect.arrayContaining(['insertIntervention', 'updateState', 'getIntervention', 'listInterventions', 'close']))
    // 无任何 delete 面 / 内容 UPDATE 面（模糊名扫描 — 同 WP-3.5 原型键审计）。
    for (const m of methods) {
      expect(/delete|remove|drop|content|rewrite/i.test(m)).toBe(false)
    }
  })

  it('insert 走真实冻结形状网: 多出一键 ⇒ IV_INPUT（additionalProperties:false）', () => {
    const h = harness()
    const bad = {
      id: 'IV-78',
      title: 't',
      origin: 'USER',
      workstream_ids: ['WS-1'],
      source_refs: [],
      status: 'OPEN',
      created_by: { kind: 'USER', label: 'researcher' },
      created_at: 1_700_000_000_123,
      unexpected_key: 'x',
    } as unknown as InterventionRecord
    const err = throwsIntervention(() => h.lifecycle.insertIntervention(bad), 'IV_INPUT')
    expect(err.message).toMatch(/frozen attention schema/)
  })

  it('查询委托 + 稳定顺序（created_at ASC, id ASC）+ 全缺省 = 全量', () => {
    const h = harness()
    seedRecord(h)
    seedRecord(h, { id: 'IV-78', title: 'b', created_at: 1_700_000_000_456, status: 'PENDING' })
    seedRecord(h, { id: 'IV-79', title: 'c', created_at: 1_700_000_000_456 }) // 同 created_at ⇒ id ASC 决胜
    expect(h.lifecycle.listInterventions().map((r) => r.id)).toEqual(['IV-77', 'IV-78', 'IV-79'])
    expect(h.lifecycle.listInterventions({ status: 'PENDING' }).map((r) => r.id)).toEqual(['IV-78'])
    expect(h.lifecycle.listInterventions({ status: 'OPEN' }).map((r) => r.id)).toEqual(['IV-77', 'IV-79'])
    expect(h.lifecycle.getIntervention('IV-79')!.title).toBe('c')
    expect(h.lifecycle.getIntervention('IV-404')).toBeNull()
  })

  it('close 后所有面大声拒（IV_STORE）', () => {
    const h = harness()
    h.lifecycle.close()
    throwsIntervention(() => h.lifecycle.getIntervention('IV-77'), 'IV_STORE', /closed/)
    throwsIntervention(() => h.lifecycle.updateState('IV-77', 'PENDING', null, null, 'OPEN'), 'IV_STORE', /closed/)
    expect(() => h.lifecycle.close()).not.toThrow() // 幂等
  })

  it('构造器边界: 坏 db 面 / 坏 interventions 面 ⇒ IV_INPUT', () => {
    const h = harness()
    expect(() => new InterventionLifecycleStore({ db: {} as never, interventions: h.interventions })).toThrow(InterventionError)
    expect(() => new InterventionLifecycleStore({ db: h.dbPair.db, interventions: {} as never })).toThrow(InterventionError)
  })

  it('isInterventionError 类型守卫', () => {
    expect(isInterventionError(new InterventionError({ code: 'IV_INPUT', message: 'x' }))).toBe(true)
    expect(isInterventionError(new Error('x'))).toBe(false)
  })
})
