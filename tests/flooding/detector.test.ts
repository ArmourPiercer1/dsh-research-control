/**
 * WP-3.5 — flooding 检测器全形态（PLAN_FORK_SPEC §8 规则逐字; 纯函数）。
 *
 * 覆盖（任务「窗口计数全形态」）:
 *   - 阈值边界（默认 5: 5 不触发 / 6 触发 — 严格大于; 自定义阈值 2 / 1）;
 *   - 窗口滑动（OPEN 集合随状态迁移滑动: STALE/SELECTED/DISMISSED 滑出,
 *     新创建滑入; 任意状态输入只计 OPEN 子集）;
 *   - 跨 WS 独立（A-15 per-WS 口径: 混合输入大声失败; 两 WS 互不计数）;
 *   - 结构化证据逐字段（窗口/计数/阈值/规则/as_of/open_pf_ids 稳定顺序）;
 *   - 重复抑制判据（hasOpenAutoFloodingIntervention ⇒ suppressed）;
 *   - 输入面守卫（坏 WS/坏阈值/坏 asOf/重复 id/坏 status — FLOODING_INPUT）。
 */

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_FLOODING_THRESHOLD,
  FLOODING_RULE,
  detectPlanForkFlooding,
  type FloodingDetectionParams,
} from '../../src/host/service/flooding/index.js'
import { T_CREATE, openRecord } from '../planfork/fixtures.js'
import { throwsFlooding } from './fixtures.js'

const AS_OF = T_CREATE + 5000

/** n 个 OPEN PF（id 递增, created_at 递增 — WS-1）。 */
function openPfs(n: number, ws = 'WS-1', idPrefix = 'PF'): Parameters<typeof detectPlanForkFlooding>[0] {
  const forks = []
  for (let i = 1; i <= n; i++) {
    forks.push(openRecord({ id: `${idPrefix}-${i}`, workstream_id: ws, created_at: T_CREATE + i }))
  }
  return { workstreamId: ws, planForks: forks, asOf: AS_OF }
}

describe('detectPlanForkFlooding — §8 规则阈值边界', () => {
  it('默认阈值 = §8 原文 5', () => {
    expect(DEFAULT_FLOODING_THRESHOLD).toBe(5)
    expect(FLOODING_RULE).toBe('count(status == OPEN, per workstream) > threshold')
  })

  it('count == threshold（5 OPEN, 默认阈值）不触发 — 严格大于', () => {
    const v = detectPlanForkFlooding(openPfs(5))
    expect(v.triggered).toBe(false)
    expect(v.suppressed).toBe(false)
    expect(v.reason).toBe('COUNT_AT_OR_BELOW_THRESHOLD')
    expect(v.evidence.count).toBe(5)
    expect(v.evidence.threshold).toBe(5)
  })

  it('count == threshold + 1（6 OPEN, 默认阈值）触发', () => {
    const v = detectPlanForkFlooding(openPfs(6))
    expect(v.triggered).toBe(true)
    expect(v.suppressed).toBe(false)
    expect(v.reason).toBeUndefined()
    expect(v.evidence.count).toBe(6)
    expect(v.evidence.threshold).toBe(5)
  })

  it('0 OPEN 不触发（count 0 ≤ threshold）', () => {
    const v = detectPlanForkFlooding(openPfs(0))
    expect(v.triggered).toBe(false)
    expect(v.evidence.count).toBe(0)
    expect(v.evidence.window.open_pf_ids).toEqual([])
  })

  it('policy 自定义阈值 2: 2 不触发 / 3 触发（§9 flooding.threshold 可调）', () => {
    expect(detectPlanForkFlooding({ ...openPfs(2), threshold: 2 }).triggered).toBe(false)
    expect(detectPlanForkFlooding({ ...openPfs(3), threshold: 2 }).triggered).toBe(true)
    expect(detectPlanForkFlooding({ ...openPfs(3), threshold: 2 }).evidence.threshold).toBe(2)
  })

  it('policy 自定义阈值 1: 1 不触发 / 2 触发', () => {
    expect(detectPlanForkFlooding({ ...openPfs(1), threshold: 1 }).triggered).toBe(false)
    expect(detectPlanForkFlooding({ ...openPfs(2), threshold: 1 }).triggered).toBe(true)
  })

  it('坏阈值拒（0 / 负数 / 非整数 / 非数字 — 冻结 policy schema: integer ≥ 1）', () => {
    for (const bad of [0, -1, 1.5, Number.NaN, '5']) {
      throwsFlooding(() => detectPlanForkFlooding({ ...openPfs(1), threshold: bad as number }), 'FLOODING_INPUT', /threshold/)
    }
  })
})

describe('detectPlanForkFlooding — 窗口滑动（OPEN 状态集）', () => {
  it('混合状态输入只计 OPEN 子集（STALE/SELECTED/DISMISSED 滑出窗口）', () => {
    const forks = [
      openRecord({ id: 'PF-1', created_at: T_CREATE + 1 }),
      openRecord({ id: 'PF-2', created_at: T_CREATE + 2, status: 'STALE', stale_reason: 'x' }),
      openRecord({ id: 'PF-3', created_at: T_CREATE + 3, status: 'SELECTED', selected_at: T_CREATE + 4, selected_by: { kind: 'USER' } }),
      openRecord({ id: 'PF-4', created_at: T_CREATE + 5, status: 'DISMISSED', dismissed_at: T_CREATE + 6 }),
      openRecord({ id: 'PF-5', created_at: T_CREATE + 7 }),
    ]
    const v = detectPlanForkFlooding({ workstreamId: 'WS-1', planForks: forks, asOf: AS_OF })
    expect(v.evidence.count).toBe(2)
    expect(v.evidence.window.open_pf_ids).toEqual(['PF-1', 'PF-5'])
    expect(v.evidence.window.kind).toBe('OPEN_STATE')
    expect(v.triggered).toBe(false)
  })

  it('窗口随迁移滑动: 6 OPEN 触发后, 3 个滑出 OPEN ⇒ 不再超阈', () => {
    const six = openPfs(6)
    const first = detectPlanForkFlooding(six)
    expect(first.triggered).toBe(true)
    // §10 迁移后（OPEN→STALE/SELECTED/DISMISSED）的下一观察: 3 个滑出。
    const slid = {
      ...six,
      planForks: six.planForks.map((pf) =>
        pf.id === 'PF-1'
          ? { ...pf, status: 'STALE' as const, stale_reason: 'superseded' }
          : pf.id === 'PF-2'
            ? { ...pf, status: 'SELECTED' as const, selected_at: AS_OF, selected_by: { kind: 'USER' as const } }
            : pf.id === 'PF-3'
              ? { ...pf, status: 'DISMISSED' as const, dismissed_at: AS_OF }
              : pf,
      ),
    }
    const second = detectPlanForkFlooding(slid)
    expect(second.triggered).toBe(false)
    expect(second.evidence.count).toBe(3)
    expect(second.evidence.window.open_pf_ids).toEqual(['PF-4', 'PF-5', 'PF-6'])
  })

  it('新创建滑入: 6 滑出 3 后新增 3 ⇒ 又触发（窗口 = 当前 OPEN 集合, 无时间衰减）', () => {
    const six = openPfs(6)
    const slid = {
      ...six,
      planForks: six.planForks.map((pf) =>
        pf.id === 'PF-1' ? { ...pf, status: 'STALE' as const, stale_reason: 'x' } : pf.id === 'PF-2' ? { ...pf, status: 'STALE' as const, stale_reason: 'x' } : pf.id === 'PF-3' ? { ...pf, status: 'STALE' as const, stale_reason: 'x' } : pf,
      ),
    }
    // 3 滑出后仅 3 OPEN（未超阈）— 新增 3 ⇒ 6 > 5 又触发。
    const below = detectPlanForkFlooding(slid)
    expect(below.triggered).toBe(false)
    expect(below.evidence.count).toBe(3)
    const withNew = {
      ...slid,
      planForks: [
        ...slid.planForks,
        openRecord({ id: 'PF-7', created_at: AS_OF - 30 }),
        openRecord({ id: 'PF-8', created_at: AS_OF - 20 }),
        openRecord({ id: 'PF-9', created_at: AS_OF - 10 }),
      ],
    }
    const v = detectPlanForkFlooding(withNew)
    expect(v.triggered).toBe(true)
    expect(v.evidence.count).toBe(6)
    expect(v.evidence.window.open_pf_ids).toEqual(['PF-4', 'PF-5', 'PF-6', 'PF-7', 'PF-8', 'PF-9'])
  })
})

describe('detectPlanForkFlooding — 跨 WS 独立（A-15 per-WS 口径, 用户确认）', () => {
  it('输入混入他 WS 记录 ⇒ FLOODING_INPUT（不静默过滤 — 口径的结构性保证）', () => {
    const forks = [...openPfs(4).planForks, openRecord({ id: 'PF-9', workstream_id: 'WS-2' })]
    throwsFlooding(
      () => detectPlanForkFlooding({ workstreamId: 'WS-1', planForks: forks, asOf: AS_OF }),
      'FLOODING_INPUT',
      /PF-9.*WS-2[^\n]*PER WORKSTREAM/,
    )
  })

  it('WS-1 超阈与 WS-2 计数互不影响（各自独立判定）', () => {
    const ws1Over = detectPlanForkFlooding(openPfs(6, 'WS-1'))
    const ws2Under = detectPlanForkFlooding(openPfs(3, 'WS-2', 'PF'))
    expect(ws1Over.triggered).toBe(true)
    expect(ws1Over.evidence.workstream_id).toBe('WS-1')
    expect(ws2Under.triggered).toBe(false)
    expect(ws2Under.evidence.workstream_id).toBe('WS-2')
    expect(ws2Under.evidence.count).toBe(3)
  })

  it('WS-2 超阈独立触发（WS-1 无论什么状态）', () => {
    const ws1Quiet = detectPlanForkFlooding(openPfs(1, 'WS-1'))
    const ws2Over = detectPlanForkFlooding(openPfs(7, 'WS-2', 'PF'))
    expect(ws1Quiet.triggered).toBe(false)
    expect(ws2Over.triggered).toBe(true)
    expect(ws2Over.evidence.window.open_pf_ids).toHaveLength(7)
  })
})

describe('detectPlanForkFlooding — 结构化证据（窗口/计数/阈值）', () => {
  it('证据逐字段: workstream_id/window{kind,as_of,open_pf_ids}/count/threshold/rule', () => {
    const v = detectPlanForkFlooding(openPfs(6))
    expect(v.evidence).toEqual({
      workstream_id: 'WS-1',
      window: {
        kind: 'OPEN_STATE',
        as_of: AS_OF,
        open_pf_ids: ['PF-1', 'PF-2', 'PF-3', 'PF-4', 'PF-5', 'PF-6'],
      },
      count: 6,
      threshold: 5,
      rule: FLOODING_RULE,
    })
  })

  it('open_pf_ids 稳定顺序 = created_at ASC, id ASC（乱序输入亦稳定）', () => {
    const forks = [
      openRecord({ id: 'PF-3', created_at: T_CREATE + 30 }),
      openRecord({ id: 'PF-1', created_at: T_CREATE + 10 }),
      openRecord({ id: 'PF-2', created_at: T_CREATE + 20 }),
    ]
    const v = detectPlanForkFlooding({ workstreamId: 'WS-1', planForks: forks, asOf: AS_OF })
    expect(v.evidence.window.open_pf_ids).toEqual(['PF-1', 'PF-2', 'PF-3'])
    // 同 created_at ⇒ id 字典序。
    const sameTs = [
      openRecord({ id: 'PF-2', created_at: T_CREATE + 10 }),
      openRecord({ id: 'PF-1', created_at: T_CREATE + 10 }),
    ]
    const v2 = detectPlanForkFlooding({ workstreamId: 'WS-1', planForks: sameTs, asOf: AS_OF })
    expect(v2.evidence.window.open_pf_ids).toEqual(['PF-1', 'PF-2'])
  })
})

describe('detectPlanForkFlooding — 重复抑制判据（§8 规则后半句）', () => {
  it('超阈 + 该 WS 已有 OPEN AUTO_FLOODING ⇒ suppressed（reason 指名）', () => {
    const v = detectPlanForkFlooding({ ...openPfs(6), hasOpenAutoFloodingIntervention: true })
    expect(v.triggered).toBe(true)
    expect(v.suppressed).toBe(true)
    expect(v.reason).toBe('OPEN_AUTO_FLOODING_EXISTS')
  })

  it('超阈 + 无既有 OPEN AUTO_FLOODING（false / undefined）⇒ 不抑制', () => {
    expect(detectPlanForkFlooding({ ...openPfs(6), hasOpenAutoFloodingIntervention: false }).suppressed).toBe(false)
    expect(detectPlanForkFlooding({ ...openPfs(6) }).suppressed).toBe(false)
  })

  it('未超阈时探针值不影响 triggered（false）', () => {
    const v = detectPlanForkFlooding({ ...openPfs(2), hasOpenAutoFloodingIntervention: true })
    expect(v.triggered).toBe(false)
    expect(v.reason).toBe('COUNT_AT_OR_BELOW_THRESHOLD')
  })
})

describe('detectPlanForkFlooding — 输入面守卫（FLOODING_INPUT 精确指名）', () => {
  const base = openPfs(1)

  it('空 / 坏 WS id', () => {
    throwsFlooding(() => detectPlanForkFlooding({ ...base, workstreamId: '' }), 'FLOODING_INPUT', /non-empty/)
    for (const bad of ['ws-1', 'WS-0', 'WS-1x', 'WS-1 ']) {
      throwsFlooding(() => detectPlanForkFlooding({ ...base, workstreamId: bad }), 'FLOODING_INPUT', /WS id|well-formed/)
    }
  })

  it('坏 asOf（负数 / 非整数 / 非数字）', () => {
    for (const bad of [-1, 1.5, Number.NaN, 'now']) {
      throwsFlooding(() => detectPlanForkFlooding({ ...base, asOf: bad as number }), 'FLOODING_INPUT', /asOf/)
    }
  })

  it('planForks 非数组 / null 元素 / 空 id / 重复 id / 坏 status / 坏 created_at', () => {
    throwsFlooding(() => detectPlanForkFlooding({ ...base, planForks: null as never }), 'FLOODING_INPUT', /planForks/)
    throwsFlooding(() => detectPlanForkFlooding({ workstreamId: 'WS-1', planForks: [null as never], asOf: AS_OF }), 'FLOODING_INPUT', /planForks\[0\]/)
    throwsFlooding(
      () => detectPlanForkFlooding({ workstreamId: 'WS-1', planForks: [openRecord({ id: '' })], asOf: AS_OF }),
      'FLOODING_INPUT',
      /\.id/,
    )
    throwsFlooding(
      () => detectPlanForkFlooding({ workstreamId: 'WS-1', planForks: [openRecord({ id: 'PF-1' }), openRecord({ id: 'PF-1' })], asOf: AS_OF }),
      'FLOODING_INPUT',
      /duplicate/,
    )
    throwsFlooding(
      () => detectPlanForkFlooding({ workstreamId: 'WS-1', planForks: [{ ...openRecord({ id: 'PF-1' }), status: 'BOGUS' }] as never[], asOf: AS_OF }),
      'FLOODING_INPUT',
      /status/,
    )
    throwsFlooding(
      () => detectPlanForkFlooding({ workstreamId: 'WS-1', planForks: [openRecord({ id: 'PF-1', created_at: -5 })], asOf: AS_OF }),
      'FLOODING_INPUT',
      /created_at/,
    )
  })
})
