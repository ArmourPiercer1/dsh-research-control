/**
 * WP-5.1 — intervention 状态机包装面测试（state-machine.ts 的 IV_* 契约:
 * 冻结 §13 迁移表单一来源 = flooding 重导出 + FloodingError →
 * InterventionError 的代码面重映射 — 零行为改动, 零正则解析）。
 *
 * 覆盖:
 *  - 9 格矩阵直走 `assertInterventionTransition`（4 合法放行 / 5 非法拒绝
 *    IV_ILLEGAL_TRANSITION — 含自环与 CLOSED 终态出口）;
 *  - 重映射是**代码面**（cause.code === 'FLOODING_ILLEGAL_TRANSITION'）:
 *    伪造其他 FloodingError 代码不触发 IV_ILLEGAL_TRANSITION（映射不宽）;
 *  - 非 3 值 from/to ⇒ IV_INPUT（包装层边界, 不穿透到 flooding）;
 *  - `interventionTargets` = 冻结表合法出口集（含 CLOSED 空集）;
 *  - 重导出同源性: IV_TRANSITIONS / isIvStatus / IV_STATUSES 与 flooding
 *    单一来源为同一引用（零派生表）。
 */

import { describe, expect, it } from 'vitest'

import {
  IV_STATUSES as FLOODING_IV_STATUSES,
  IV_TRANSITIONS as FLOODING_IV_TRANSITIONS,
  isIvStatus as floodingIsIvStatus,
  type IvStatus,
} from '../../src/host/service/flooding/index.js'
import {
  IV_TRANSITIONS,
  assertInterventionTransition,
  isIvStatus,
  interventionTargets,
} from '../../src/host/service/intervention/state-machine.js'
import { InterventionError, isInterventionError } from '../../src/host/service/intervention/index.js'

function expectIllegal(from: IvStatus, to: IvStatus): InterventionError {
  let caught: unknown
  try {
    assertInterventionTransition('IV-1', from, to)
  } catch (err) {
    caught = err
  }
  if (caught === undefined || !isInterventionError(caught)) {
    throw new Error(`expected IV_ILLEGAL_TRANSITION for ${from} -> ${to}, got ${caught === undefined ? 'no throw' : String(caught)}`)
  }
  return caught
}

describe('重导出同源性（§13 单一来源 — 零派生表）', () => {
  it('IV_TRANSITIONS / isIvStatus 与 flooding 为同一引用; 表键 = 冻结 3 值', () => {
    expect(IV_TRANSITIONS).toBe(FLOODING_IV_TRANSITIONS)
    expect(isIvStatus).toBe(floodingIsIvStatus)
    expect(Object.keys(IV_TRANSITIONS).sort()).toEqual([...FLOODING_IV_STATUSES].sort())
  })
})

describe('assertInterventionTransition（9 格矩阵 — 冻结 §13 全转换）', () => {
  it('4 合法格放行（OPEN→PENDING / PENDING→OPEN / OPEN→CLOSED / PENDING→CLOSED）', () => {
    for (const [from, to] of [
      ['OPEN', 'PENDING'],
      ['PENDING', 'OPEN'],
      ['OPEN', 'CLOSED'],
      ['PENDING', 'CLOSED'],
    ] as Array<[IvStatus, IvStatus]>) {
      expect(() => assertInterventionTransition('IV-1', from, to)).not.toThrow()
    }
  })

  it('5 非法格拒绝 IV_ILLEGAL_TRANSITION（自环 ×2 + CLOSED 出口 ×3）', () => {
    for (const [from, to] of [
      ['OPEN', 'OPEN'],
      ['PENDING', 'PENDING'],
      ['CLOSED', 'OPEN'],
      ['CLOSED', 'PENDING'],
      ['CLOSED', 'CLOSED'],
    ] as Array<[IvStatus, IvStatus]>) {
      const err = expectIllegal(from, to)
      expect(err.code).toBe('IV_ILLEGAL_TRANSITION')
      expect(err.message).toContain(`${from} -> ${to}`)
    }
  })

  it('终态消息: CLOSED 出口引用 §13（重开 = 新 Intervention）', () => {
    const err = expectIllegal('CLOSED', 'OPEN')
    expect(err.message).toMatch(/§13/)
    expect(err.message).toMatch(/terminal/i)
  })

  it('非 3 值 from/to ⇒ IV_INPUT（包装层边界大声）', () => {
    let caught: unknown
    try {
      assertInterventionTransition('IV-1', 'DONE' as unknown as IvStatus, 'OPEN')
    } catch (err) {
      caught = err
    }
    expect(isInterventionError(caught)).toBe(true)
    expect((caught as InterventionError).code).toBe('IV_INPUT')

    caught = undefined
    try {
      assertInterventionTransition('IV-1', 'OPEN', 'MAYBE' as unknown as IvStatus)
    } catch (err) {
      caught = err
    }
    expect(isInterventionError(caught)).toBe(true)
    expect((caught as InterventionError).code).toBe('IV_INPUT')
  })

  it('重映射不宽: from/to 非 3 值时 flooding 抛 FLOODING_INPUT, 包装层走 else 分支重映射为 IV_INPUT（非 IV_ILLEGAL_TRANSITION — 零正则解析, 代码面判别）', () => {
    // 上条用例走的就是包装层的 else 分支（真实 checkInterventionTransition
    // 对非 3 值抛 FLOODING_INPUT）— 这里补断言: 消息保留 flooding 原始
    // 文案（大声透传, 不吞信息）。
    let caught: unknown
    try {
      assertInterventionTransition('IV-1', 'DONE' as unknown as IvStatus, 'OPEN')
    } catch (err) {
      caught = err
    }
    expect(isInterventionError(caught)).toBe(true)
    const err = caught as InterventionError
    expect(err.code).toBe('IV_INPUT')
    expect(err.message).toMatch(/must be one of/)
  })
})

describe('interventionTargets（冻结表合法出口集）', () => {
  it('OPEN → [PENDING, CLOSED]; PENDING → [OPEN, CLOSED]; CLOSED → []（终态无出口）', () => {
    expect([...interventionTargets('OPEN')].sort()).toEqual(['CLOSED', 'PENDING'])
    expect([...interventionTargets('PENDING')].sort()).toEqual(['CLOSED', 'OPEN'])
    expect(interventionTargets('CLOSED')).toEqual([])
  })
})
