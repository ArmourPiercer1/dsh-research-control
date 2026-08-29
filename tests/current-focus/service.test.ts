/**
 * UI0 (R-01) — CurrentFocusService 语义审计（真实临时文件 DB + 真实
 * adaptDatabaseSync face + fake canonical provider 模拟 plan mutation;
 * 确定性单调时钟 — store 与 service 共享）。
 *
 * 覆盖（任务 §6 条目 9–16）:
 *   9.  set 合法 canonical 目标成功（写后行 = 完整 record + 注入时钟戳）;
 *   10. set 非 canonical 目标 → CF_NOT_CANONICAL（message 含
 *       workstreamId + planItemId + 「not in the canonical plan」）,
 *       且 store 中无该行写入（拒绝先于落库）;
 *   11. set/get/clear/revalidate 输入形状非法（空串 / 纯空白 / 非字符串）
 *       → CF_INPUT;
 *   12. replace: 先 set A（canonical）, 再 set B（canonical）→ get 为 B;
 *   13. revalidate 三态: absent（无记录）/ retained（目标仍在, 且行不
 *       被重写 — updatedAt 不变）/ cleared（fake provider 移除目标后 →
 *       cleared 且 get undefined）;
 *   14. canonical provider 抛错时 set 原样透传该错误（同一实例, 不被
 *       包装成 CF_*）;
 *   15. 无副作用: harness DB 先手工建 `history_event` 表 → set/clear/
 *       revalidate 全流程后 history_event 行数不变（0）+ sqlite_master
 *       检查该连接创建的表集合 = 只有 current_focus（store 只 touch
 *       自己的表）;
 *   16. 单值约束: 同 workstream 连续 set 多次后, 表内该 workstream 只有
 *       1 行（直接查表行数）;
 *   + 构造器门（store / provider 缺失 ⇒ CF_INPUT）。
 */

import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import {
  CURRENT_FOCUS_TABLE,
  CurrentFocusError,
  CurrentFocusService,
  isCurrentFocusError,
  type CurrentFocusStore,
} from '../../src/host/service/current-focus/index.js'
import {
  makeCurrentFocusHarness,
  type CurrentFocusHarness,
} from './harness.js'

function harness(canonical: readonly string[] = []): CurrentFocusHarness {
  return makeCurrentFocusHarness(canonical)
}

function expectCfCode(fn: () => unknown, code: string, msgPart?: string): void {
  try {
    fn()
  } catch (cause) {
    expect(cause).toBeInstanceOf(CurrentFocusError)
    expect((cause as CurrentFocusError).code).toBe(code)
    if (msgPart !== undefined) expect((cause as Error).message).toContain(msgPart)
    return
  }
  expect.unreachable(`expected CurrentFocusError(code=${code}) but nothing was thrown`)
}

describe('CurrentFocusService（USER 语义面 + canonical 成员门）', () => {
  it('9. set 合法 canonical 目标成功（写后行 = 完整 record + 注入时钟戳）', () => {
    const h = harness(['T-1', 'G-1', 'M-1'])
    try {
      const expectedStamp = h.clock.value()
      const record = h.service.set('WS-1', 'T-1')
      expect(record).toEqual({ workstreamId: 'WS-1', planItemId: 'T-1', updatedAt: expectedStamp })
      expect(h.service.get('WS-1')).toEqual({ workstreamId: 'WS-1', planItemId: 'T-1', updatedAt: expectedStamp })
    } finally {
      h.close()
    }
  })

  it('10. set 非 canonical 目标 → CF_NOT_CANONICAL, 且 store 中无该行写入', () => {
    const h = harness(['T-1', 'G-1'])
    try {
      try {
        h.service.set('WS-1', 'T-99')
        expect.unreachable('a non-canonical target must be rejected')
      } catch (cause) {
        expect(cause).toBeInstanceOf(CurrentFocusError)
        const error = cause as CurrentFocusError
        expect(error.code).toBe('CF_NOT_CANONICAL')
        expect(error.message).toContain('WS-1')
        expect(error.message).toContain('T-99')
        expect(error.message).toContain('not in the canonical plan')
      }
      expect(h.store.get('WS-1')).toBeUndefined() // 拒绝先于落库 — 无行
    } finally {
      h.close()
    }
  })

  it('11. 输入形状非法（空串 / 纯空白 / 非字符串）→ CF_INPUT', () => {
    const h = harness(['T-1'])
    try {
      expectCfCode(() => h.service.set('', 'T-1'), 'CF_INPUT', 'workstreamId')
      expectCfCode(() => h.service.set('   ', 'T-1'), 'CF_INPUT', 'workstreamId')
      expectCfCode(() => h.service.set('WS-1', ''), 'CF_INPUT', 'planItemId')
      expectCfCode(() => h.service.set('WS-1', '  '), 'CF_INPUT', 'planItemId')
      expectCfCode(() => h.service.set(42 as unknown as string, 'T-1'), 'CF_INPUT', 'workstreamId')
      expectCfCode(() => h.service.get(''), 'CF_INPUT', 'workstreamId')
      expectCfCode(() => h.service.clear('  '), 'CF_INPUT', 'workstreamId')
      expectCfCode(() => h.service.revalidate(''), 'CF_INPUT', 'workstreamId')
      // 形状拒绝先于 canonical 咨询 — 无行落库。
      expect(h.store.get('WS-1')).toBeUndefined()
    } finally {
      h.close()
    }
  })

  it('12. replace: 先 set A（canonical）, 再 set B（canonical）→ get 为 B', () => {
    const h = harness(['T-1', 'T-2', 'M-1'])
    try {
      const sA = h.clock.value()
      h.service.set('WS-1', 'T-1')
      const sB = h.clock.value()
      expect(sB).toBeGreaterThan(sA)
      const record = h.service.set('WS-1', 'T-2')
      expect(record).toEqual({ workstreamId: 'WS-1', planItemId: 'T-2', updatedAt: sB })
      expect(h.service.get('WS-1')).toEqual({ workstreamId: 'WS-1', planItemId: 'T-2', updatedAt: sB })
      expect(h.store.get('WS-1')?.planItemId).toBe('T-2')
    } finally {
      h.close()
    }
  })

  it('13. revalidate 三态: absent / retained（行不被重写）/ cleared', () => {
    const h = harness(['T-1', 'G-1'])
    try {
      // absent — 无记录可校验。
      expect(h.service.revalidate('WS-1')).toEqual({ outcome: 'absent' })

      // retained — 目标仍在 canonical; 行不被重写（updatedAt 原样）。
      const s1 = h.clock.value()
      h.service.set('WS-1', 'T-1')
      expect(h.service.revalidate('WS-1')).toEqual({ outcome: 'retained' })
      expect(h.store.get('WS-1')).toEqual({ workstreamId: 'WS-1', planItemId: 'T-1', updatedAt: s1 })

      // cleared — fake provider 把目标移出 canonical Plan ⇒ 自动清除。
      h.plan.remove('T-1')
      expect(h.service.revalidate('WS-1')).toEqual({ outcome: 'cleared' })
      expect(h.store.get('WS-1')).toBeUndefined()

      // 再校验回到 absent（已无记录）。
      expect(h.service.revalidate('WS-1')).toEqual({ outcome: 'absent' })
    } finally {
      h.close()
    }
  })

  it('14. canonical provider 抛错时 set 原样透传（同一实例, 不被包装成 CF_*）', () => {
    const h = harness(['T-1'])
    try {
      const boom = new Error('plan loader exploded (simulated plan-side failure)')
      h.plan.failNext(boom)
      try {
        h.service.set('WS-1', 'T-1')
        expect.unreachable('the provider failure must surface')
      } catch (cause) {
        expect(cause).toBe(boom) // 原样透传 — 同一错误实例
        expect(isCurrentFocusError(cause)).toBe(false)
      }
      expect(h.store.get('WS-1')).toBeUndefined() // 透传前未落库
    } finally {
      h.close()
    }
  })

  it('15. 无副作用: history_event 行数不变（0）+ store 只 touch current_focus', () => {
    const h = harness(['T-1', 'G-1'])
    try {
      // 先手工建 history_event（若 store 越界写事件, 行数会涨 — 可观测）。
      h.raw.exec('CREATE TABLE IF NOT EXISTS history_event (id INTEGER PRIMARY KEY, payload TEXT)')
      const countRows = (): number =>
        Number((h.raw.prepare('SELECT COUNT(*) AS n FROM history_event').get() as { n: number }).n)

      // 全流程: set → replace → revalidate(retained) → 移出 →
      // revalidate(cleared) → clear（no-op）→ get。
      h.service.set('WS-1', 'T-1')
      h.service.set('WS-1', 'G-1')
      expect(h.service.revalidate('WS-1')).toEqual({ outcome: 'retained' })
      h.plan.remove('G-1')
      expect(h.service.revalidate('WS-1')).toEqual({ outcome: 'cleared' })
      expect(h.service.clear('WS-1')).toBe(false)
      expect(h.service.get('WS-1')).toBeUndefined()

      expect(countRows()).toBe(0) // 事件表零行 — 本模块不产生/不追加事件

      // 该连接创建的表集合 = 只有 current_focus（除本测试手工建的
      // history_event 与 sqlite 内部表）— store 只 touch 自己的表。
      const raw2 = new DatabaseSync(h.dbPath)
      try {
        const rows = raw2
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
          .all()
        expect(rows.map((r) => r.name).sort()).toEqual([CURRENT_FOCUS_TABLE, 'history_event'].sort())
      } finally {
        raw2.close()
      }
    } finally {
      h.close()
    }
  })

  it('16. 单值约束: 同 workstream 连续 set 多次后表内只有 1 行', () => {
    const h = harness(['T-1', 'T-2', 'T-3'])
    try {
      h.service.set('WS-1', 'T-1')
      h.service.set('WS-1', 'T-2')
      h.service.set('WS-1', 'T-3')
      const n = Number(
        (h.raw.prepare('SELECT COUNT(*) AS n FROM current_focus WHERE workstream_id = ?').get('WS-1') as { n: number }).n,
      )
      expect(n).toBe(1)
      expect(h.store.get('WS-1')?.planItemId).toBe('T-3')
    } finally {
      h.close()
    }
  })

  it('构造器门: store / canonicalPlanItemIds 缺失 ⇒ CF_INPUT', () => {
    const h = harness(['T-1'])
    try {
      expectCfCode(
        () =>
          new CurrentFocusService({
            store: undefined as unknown as CurrentFocusStore,
            canonicalPlanItemIds: h.plan.provider,
          }),
        'CF_INPUT',
        'store',
      )
      expectCfCode(
        () => new CurrentFocusService({ store: h.store, canonicalPlanItemIds: undefined as unknown as () => readonly string[] }),
        'CF_INPUT',
        'canonicalPlanItemIds',
      )
    } finally {
      h.close()
    }
  })

  it('clear USER 面: 有指针 → true; 无指针 → false（no-op, 非错误）', () => {
    const h = harness(['T-1'])
    try {
      expect(h.service.clear('WS-1')).toBe(false)
      h.service.set('WS-1', 'T-1')
      expect(h.service.clear('WS-1')).toBe(true)
      expect(h.service.get('WS-1')).toBeUndefined()
    } finally {
      h.close()
    }
  })

  it('DB 丢失退化: 全新空库上 get 返回 undefined（不报错 — 语义即无）', () => {
    const h = harness(['T-1'])
    try {
      expect(h.service.get('WS-1')).toBeUndefined()
      expect(h.service.revalidate('WS-1')).toEqual({ outcome: 'absent' })
    } finally {
      h.close()
    }
  })
})
