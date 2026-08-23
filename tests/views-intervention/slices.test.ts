/**
 * WP-5.1 — intervention-slices 纯投影测试（store 层独立新文件; 零 React
 * 依赖 — node 环境直跑）。
 *
 * 覆盖:
 *  - 分组口径: 冻结 4 origin → 机械触发 / 用户创建 二分（§6 脚注 ¹ 三类
 *    机械触发 = MECHANICAL; USER = USER_CREATED）;
 *  - INV-ATTN-1（无隐藏过滤器）: 输出 = 输入全量（多重集相等 + 计数逐字）,
 *    多组配置扫描;
 *  - 组序固定 [MECHANICAL, USER_CREATED]（空组也在）+ 组内输入序保持
 *    （OPEN 组在前、PENDING 组在后）;
 *  - 未知 origin 大声失败（不静默归组）;
 *  - deriveInterventionGroups: 未就绪切片 = 空分组（两组在位, total 0）;
 *  - 展示/host 双端同构 pin: MECHANICAL_ORIGINS 值集 = host 侧
 *    MECHANICAL_TRIGGER_ORIGIN 的值集（INV-ATTN-5 闭集的展示侧投影）。
 */

import { describe, expect, it } from 'vitest'

import {
  MECHANICAL_ORIGINS,
  USER_CREATED_ORIGINS,
  classifyOrigin,
  deriveInterventionGroups,
  groupInterventionsByOrigin,
} from '../../src/client/stores/intervention-slices.js'
import { MECHANICAL_TRIGGER_ORIGIN } from '../../src/host/service/intervention/index.js'
import { idleSlice } from '../../src/client/stores/index.js'
import type { DashboardSnapshot, InterventionDto } from '../../src/shared/rpc-contracts.js'

const T = 1_700_000_000_000

function item(id: string, origin: InterventionDto['origin'], status: InterventionDto['status']): InterventionDto {
  return { id, title: `title-${id}`, origin, status, workstreamIds: ['WS-1'], createdAt: T + Number(id.replace(/\D/g, '')) }
}

const ALL_ORIGINS: InterventionDto['origin'][] = ['USER', 'AGENT_REPORT', 'AUTO_FLOODING', 'AUTO_AUDIT']

describe('分组口径（GroupBy 机械触发 / 用户创建）', () => {
  it('冻结 4 origin 全量二分: 三机械 + 一用户创建（分类映射逐字）', () => {
    expect(classifyOrigin('USER')).toBe('USER_CREATED')
    expect(classifyOrigin('AGENT_REPORT')).toBe('MECHANICAL')
    expect(classifyOrigin('AUTO_FLOODING')).toBe('MECHANICAL')
    expect(classifyOrigin('AUTO_AUDIT')).toBe('MECHANICAL')
    expect([...MECHANICAL_ORIGINS].sort()).toEqual(['AGENT_REPORT', 'AUTO_AUDIT', 'AUTO_FLOODING'])
    expect([...USER_CREATED_ORIGINS]).toEqual(['USER'])
    // 完整划分: 两组值集互斥且并 = 冻结 4 值。
    const union = [...MECHANICAL_ORIGINS, ...USER_CREATED_ORIGINS].sort()
    expect(union).toEqual([...ALL_ORIGINS].sort())
  })

  it('未知 origin 大声失败（冻结枚举外的值 = 线面破损, 不静默归组）', () => {
    expect(() => classifyOrigin('CLAIM_CONFLICT' as unknown as InterventionDto['origin'])).toThrow(/not a member of the frozen origin enum/)
  })

  it('双端同构 pin: 展示侧 MECHANICAL 值集 = host 侧 INV-ATTN-5 闭集的 origin 值集', () => {
    const hostMechanical = Object.values(MECHANICAL_TRIGGER_ORIGIN).sort()
    expect([...MECHANICAL_ORIGINS].sort()).toEqual(hostMechanical)
  })
})

describe('INV-ATTN-1 投影（无隐藏过滤器）', () => {
  const configs: Array<{ open: InterventionDto[]; pending: InterventionDto[]; label: string }> = [
    { open: [], pending: [], label: '全空' },
    { open: [item('IV-1', 'USER', 'OPEN')], pending: [], label: '单用户 OPEN' },
    { open: [item('IV-1', 'AUTO_FLOODING', 'OPEN'), item('IV-2', 'USER', 'OPEN'), item('IV-3', 'AUTO_AUDIT', 'OPEN')], pending: [item('IV-4', 'AGENT_REPORT', 'PENDING')], label: '混合 4 origin' },
    { open: [item('IV-1', 'AUTO_FLOODING', 'OPEN'), item('IV-2', 'AUTO_AUDIT', 'OPEN')], pending: [item('IV-3', 'AUTO_FLOODING', 'PENDING'), item('IV-4', 'AGENT_REPORT', 'PENDING')], label: '纯机械' },
    { open: [item('IV-1', 'USER', 'OPEN'), item('IV-2', 'USER', 'OPEN')], pending: [item('IV-3', 'USER', 'PENDING')], label: '纯用户创建' },
  ]

  for (const { open, pending, label } of configs) {
    it(`配置「${label}」: 输出 = 输入全量（多重集相等）+ 计数逐字 + 组序/组内序`, () => {
      const g = groupInterventionsByOrigin(open, pending)
      // 组序固定（空组也在）。
      expect(g.groups.map((x) => x.source)).toEqual(['MECHANICAL', 'USER_CREATED'])
      // 计数逐字（无隐藏过滤器）。
      expect(g.total).toBe(open.length + pending.length)
      expect(g.groups[0]!.items.length + g.groups[1]!.items.length).toBe(open.length + pending.length)
      // 多重集相等: 每个输入项恰好出现一次（id 级）。
      const outIds = g.groups.flatMap((x) => x.items.map((i) => i.id)).sort()
      const inIds = [...open, ...pending].map((i) => i.id).sort()
      expect(outIds).toEqual(inIds)
      // 组内顺序 = 输入序（OPEN 在前、PENDING 在后）。
      expect(g.groups[0]!.items.map((i) => i.id)).toEqual(
        [...open, ...pending].filter((i) => classifyOrigin(i.origin) === 'MECHANICAL').map((i) => i.id),
      )
      expect(g.groups[1]!.items.map((i) => i.id)).toEqual(
        [...open, ...pending].filter((i) => classifyOrigin(i.origin) === 'USER_CREATED').map((i) => i.id),
      )
    })
  }

  it('CLOSED 项（若经线面到达）同样全量收纳 — 投影不按状态过滤', () => {
    const closed = item('IV-9', 'USER', 'CLOSED')
    const g = groupInterventionsByOrigin([], [closed])
    expect(g.total).toBe(1)
    expect(g.groups[1]!.items.map((i) => i.id)).toEqual(['IV-9'])
  })
})

describe('deriveInterventionGroups（slice → 分组投影）', () => {
  function snapshot(open: InterventionDto[], pending: InterventionDto[]): DashboardSnapshot {
    return {
      project: { id: 'PRJ-1', title: 'Project One', description: null, importance: 3, attentionMode: 'NORMAL', targetDate: null },
      topics: [],
      openInterventions: open,
      pendingInterventions: pending,
      scheduledEvents: null,
      reportingItems: null,
      inboxCount: 0,
      attention: null,
    }
  }

  it('未就绪切片（data=null）= 空分组（两组在位, total 0 — 非 undefined）', () => {
    const g = deriveInterventionGroups(idleSlice<DashboardSnapshot>())
    expect(g.groups.map((x) => x.source)).toEqual(['MECHANICAL', 'USER_CREATED'])
    expect(g.total).toBe(0)
    expect(g.groups[0]!.items).toEqual([])
    expect(g.groups[1]!.items).toEqual([])
  })

  it('就绪切片 = 与纯函数同果（dashboard 两组全量投影）', () => {
    const open = [item('IV-1', 'AUTO_FLOODING', 'OPEN')]
    const pending = [item('IV-2', 'USER', 'PENDING'), item('IV-3', 'AGENT_REPORT', 'PENDING')]
    const slice = { status: 'ready' as const, data: snapshot(open, pending), error: null, updatedAt: T }
    const g = deriveInterventionGroups(slice)
    expect(g).toEqual(groupInterventionsByOrigin(open, pending))
  })
})
