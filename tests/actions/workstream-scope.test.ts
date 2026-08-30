/**
 * UI-4 (D §10, D1) — `ActionsService.listBlockersForWorkstream` 薄方法
 * （ADJ-5 — EXPLICIT blocker 作用域 = WS 自身 ∪ 该 WS 的 Tasks/Runs）。
 *
 * 断言面（real sqlite harness, 无 mock）:
 *  - 命中面: affects 指向 WS 自身 / 成员 Task / 成员 Run（runExists 缝注入）;
 *  - 落选面: 外 WS / 外 Run / 多 ref 中无一命中;
 *  - any-ref 语义: 一个 ref 命中即整行返回（affects 含外 WS 不拖累命中）;
 *  - 状态不在此方法过滤（CLEARED 行仍在列表 — 状态面归 wire DTO, ADJ-5
 *    作用域仅 affects 命中）;
 *  - 顺序 = store 面（created_at ASC, id ASC — 单调时钟下即创建序）。
 */

import { describe, expect, it } from 'vitest'

import type { BlockerRecord } from '../../src/host/service/actions/index.js'
import { USER_ACTOR, openActionsHarness } from './harness.js'

function ids(rows: readonly BlockerRecord[]): string[] {
  return rows.map((b) => b.id)
}

describe('listBlockersForWorkstream（ADJ-5 作用域）', () => {
  it('空库 ⇒ []', () => {
    const h = openActionsHarness()
    try {
      expect(h.service.listBlockersForWorkstream('WS-1', new Set())).toEqual([])
    } finally {
      h.close()
    }
  })

  it('命中面 / 落选面: WS 自身 + 成员 Task + 成员 Run 入, 外 WS / 外 Run 出', () => {
    const h = openActionsHarness()
    try {
      h.runs.add('R-1') // WS-1 成员 Run（§16.3 run 缝注入）
      h.runs.add('R-2') // WS-2 的 Run（存在但非成员）
      h.service.createBlocker({ statement: '缺一组姿态', affects: [{ kind: 'WORKSTREAM', id: 'WS-1' }], source: 'UI 手工登记' }, USER_ACTOR)
      h.service.createBlocker({ statement: '任务卡住', affects: [{ kind: 'TASK', id: 'T-1' }], source: 'agent 上报' }, USER_ACTOR)
      h.service.createBlocker({ statement: 'Run 挂死', affects: [{ kind: 'RUN', id: 'R-1' }], source: 'watchdog' }, USER_ACTOR)
      h.service.createBlocker({ statement: '外 WS 的事', affects: [{ kind: 'WORKSTREAM', id: 'WS-2' }], source: 'UI' }, USER_ACTOR)
      h.service.createBlocker({ statement: '外 Run 的事', affects: [{ kind: 'RUN', id: 'R-2' }], source: 'UI' }, USER_ACTOR)

      const memberIds = new Set(['T-1', 'T-2', 'T-3', 'T-4', 'R-1'])
      const rows = h.service.listBlockersForWorkstream('WS-1', memberIds)
      expect(ids(rows)).toEqual(['BLK-1', 'BLK-2', 'BLK-3'])
      // 状态面原样（本方法不过滤状态）:
      expect(rows.every((b) => b.status === 'ACTIVE')).toBe(true)
    } finally {
      h.close()
    }
  })

  it('any-ref 语义: affects 含成员 + 外 WS 的混合行 ⇒ 整行命中', () => {
    const h = openActionsHarness()
    try {
      h.service.createBlocker(
        {
          statement: '跨 WS 依赖',
          affects: [
            { kind: 'WORKSTREAM', id: 'WS-2' },
            { kind: 'WORKSTREAM', id: 'WS-1' },
          ],
          source: 'UI',
        },
        USER_ACTOR,
      )
      expect(ids(h.service.listBlockersForWorkstream('WS-1', new Set()))).toEqual(['BLK-1'])
      // 反向: 只命中 WS-2 视角时同样在（对称面）:
      expect(ids(h.service.listBlockersForWorkstream('WS-2', new Set()))).toEqual(['BLK-1'])
      // 无 ref 命中的第三视角:
      expect(h.service.listBlockersForWorkstream('WS-3', new Set())).toEqual([])
    } finally {
      h.close()
    }
  })

  it('CLEARED 行仍在作用域列表（状态过滤不属本方法 — wire 面携带 status）', () => {
    const h = openActionsHarness()
    try {
      const b = h.service.createBlocker({ statement: '暂阻', affects: [{ kind: 'WORKSTREAM', id: 'WS-1' }], source: 'UI' }, USER_ACTOR)
      h.service.clearBlocker(b.id, USER_ACTOR)
      const rows = h.service.listBlockersForWorkstream('WS-1', new Set())
      expect(ids(rows)).toEqual(['BLK-1'])
      expect(rows[0]!.status).toBe('CLEARED')
      expect(rows[0]!.cleared_at).toBeTypeOf('number')
    } finally {
      h.close()
    }
  })
})
