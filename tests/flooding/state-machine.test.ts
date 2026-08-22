/**
 * WP-3.5 — Intervention 状态机（DOMAIN_SCHEMA §13 冻结表 3×3 全矩阵 +
 * checkInterventionTransition 消息纪律）。
 *
 * §13 原文: `OPEN ↔ PENDING`; `OPEN | PENDING → CLOSED`（终态; 重开 = 新
 * Intervention）; 仅用户。
 */

import { describe, expect, it } from 'vitest'

import {
  FloodingError,
  IV_STATUSES,
  IV_TRANSITIONS,
  checkInterventionTransition,
  isIvStatus,
  isLegalInterventionTransition,
  legalInterventionTargets,
  type IvStatus,
} from '../../src/host/service/flooding/index.js'
import { throwsFlooding } from './fixtures.js'

describe('§13 冻结表', () => {
  it('3 状态全集 + 表逐字', () => {
    expect([...IV_STATUSES]).toEqual(['OPEN', 'PENDING', 'CLOSED'])
    expect(IV_TRANSITIONS).toEqual({
      OPEN: ['PENDING', 'CLOSED'],
      PENDING: ['OPEN', 'CLOSED'],
      CLOSED: [],
    })
  })
})

describe('3×3 全矩阵（9 对穷举）', () => {
  const all = ['OPEN', 'PENDING', 'CLOSED'] as const
  it('4 合法: OPEN→PENDING, OPEN→CLOSED, PENDING→OPEN, PENDING→CLOSED', () => {
    const legal: [IvStatus, IvStatus][] = [
      ['OPEN', 'PENDING'],
      ['OPEN', 'CLOSED'],
      ['PENDING', 'OPEN'],
      ['PENDING', 'CLOSED'],
    ]
    for (const [from, to] of legal) {
      expect(isLegalInterventionTransition(from, to)).toBe(true)
      expect(() => checkInterventionTransition('IV-1', from, to)).not.toThrow()
    }
  })

  it('5 非法: 3 自环 + CLOSED 三出口（终态）', () => {
    const illegal: [IvStatus, IvStatus][] = [
      ['OPEN', 'OPEN'],
      ['PENDING', 'PENDING'],
      ['CLOSED', 'CLOSED'],
      ['CLOSED', 'OPEN'],
      ['CLOSED', 'PENDING'],
    ]
    for (const [from, to] of illegal) {
      expect(isLegalInterventionTransition(from, to)).toBe(false)
    }
    // 全矩阵核对: 合法集恰为上述 4 对。
    let count = 0
    for (const from of all) {
      for (const to of all) {
        if (isLegalInterventionTransition(from, to)) count++
      }
    }
    expect(count).toBe(4)
  })

  it('legalInterventionTargets: OPEN=[PENDING,CLOSED] / PENDING=[OPEN,CLOSED] / CLOSED=[]', () => {
    expect([...legalInterventionTargets('OPEN')]).toEqual(['PENDING', 'CLOSED'])
    expect([...legalInterventionTargets('PENDING')]).toEqual(['OPEN', 'CLOSED'])
    expect([...legalInterventionTargets('CLOSED')]).toEqual([])
  })
})

describe('checkInterventionTransition — 消息纪律（终态点名 + 重开语义）', () => {
  it('CLOSED 出口非法: 消息点名终态 + 「重开 = 新 Intervention」', () => {
    throwsFlooding(
      () => checkInterventionTransition('IV-9', 'CLOSED', 'OPEN'),
      'FLOODING_ILLEGAL_TRANSITION',
      /IV-9.*CLOSED -> OPEN.*terminal.*重开 = 新 Intervention/,
    )
  })

  it('非终态非法迁移: 消息列合法集', () => {
    throwsFlooding(
      () => checkInterventionTransition('IV-3', 'OPEN', 'OPEN'),
      'FLOODING_ILLEGAL_TRANSITION',
      /legal targets from OPEN: \[PENDING, CLOSED\]/,
    )
  })

  it('坏 from / 坏 to ⇒ FLOODING_INPUT（表外状态大声失败）', () => {
    throwsFlooding(() => checkInterventionTransition('IV-1', 'BOGUS' as never, 'OPEN'), 'FLOODING_INPUT', /from must be/)
    throwsFlooding(() => checkInterventionTransition('IV-1', 'OPEN', 'BOGUS' as never), 'FLOODING_INPUT', /to must be/)
  })
})

describe('isIvStatus 守卫', () => {
  it('3 真值 + 假值', () => {
    expect(isIvStatus('OPEN')).toBe(true)
    expect(isIvStatus('PENDING')).toBe(true)
    expect(isIvStatus('CLOSED')).toBe(true)
    expect(isIvStatus('RESOLVED')).toBe(false)
    expect(isIvStatus('open')).toBe(false)
    expect(isIvStatus('')).toBe(false)
    expect(isIvStatus(5)).toBe(false)
    expect(isIvStatus(null)).toBe(false)
  })
})

describe('FloodingError（本文件构造面）', () => {
  it('非法迁移错误携带 code（调用方可分类）', () => {
    try {
      checkInterventionTransition('IV-1', 'CLOSED', 'PENDING')
      expect.unreachable('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(FloodingError)
      expect((e as FloodingError).code).toBe('FLOODING_ILLEGAL_TRANSITION')
    }
  })
})
