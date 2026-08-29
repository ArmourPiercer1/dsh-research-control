/**
 * UI0 (R-01) — CurrentFocusStore 面审计（真实临时文件 DatabaseSync +
 * 生产 adaptDatabaseSync face; 零 mock 驱动 — 同 tests/wiring 纪律）。
 *
 * 覆盖（任务 §6 条目 1–8）:
 *   1. fresh DB: 构造后 get 返回 undefined（表就位, 无行）;
 *   2. set 创建 → get 返回完整 record（含注入的 updatedAt — 确定性时钟）;
 *   3. set 替换（同 workstream 新目标）→ get 为新目标、updatedAt 更新;
 *   4. 两个 workstream 互不干扰（各自单值）;
 *   5. clear 有行 → true、无行 → false; clear 后 get undefined;
 *   6. restart 持久化: 关闭 DatabaseSync → 重新 open 同一文件 → 构造新
 *      store → get 仍返回原记录;
 *   7. 文件级迁移（managed/standalone 模拟）: .sqlite 文件复制到另一
 *      临时目录 → 新 open → 数据完整（storage-locations 迁移后可读性）;
 *   8. 关闭句柄守卫: db face 走 adaptDatabaseSync 路径 — 关闭后调用
 *      应得到 HostWiringError code WIRING_CLOSED（expectClosed 写法同
 *      tests/wiring/db-adapter.test.ts）+ store 层的 CF_STORE 包装
 *      （cause 保留, 结构化 message 穿透）;
 *   + 构造器 db face 函数检查（缺 exec/run ⇒ CF_INPUT — 同
 *     InterventionLifecycleStore 第 53–69 行模式）。
 */

import { cpSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import type { PlanForkDb } from '../../src/host/domain/planfork/index.js'
import {
  CurrentFocusError,
  CurrentFocusStore,
  CURRENT_FOCUS_TABLE,
  SQL_GET_CURRENT_FOCUS,
} from '../../src/host/service/current-focus/index.js'
import { HostWiringError } from '../../src/host/service/wiring/types.js'
import {
  makeCurrentFocusHarness,
  makeTempDir,
  reopenStore,
  type CurrentFocusHarness,
} from './harness.js'

function harness(canonical: readonly string[] = []): CurrentFocusHarness {
  return makeCurrentFocusHarness(canonical)
}

/** Assert `fn` throws the structured `WIRING_CLOSED` for `op`（and NOT
 *  the raw driver text）— 同 tests/wiring/db-adapter.test.ts 写法。 */
function expectClosed(fn: () => unknown, op: string): void {
  try {
    fn()
  } catch (cause) {
    expect(cause).toBeInstanceOf(HostWiringError)
    const error = cause as HostWiringError
    expect(error.code).toBe('WIRING_CLOSED')
    expect(error.message).toContain(`closed before ${op}`)
    expect(error.message).not.toContain('database is not open')
    return
  }
  expect.unreachable(`a closed-handle ${op} must throw WIRING_CLOSED`)
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

describe('CurrentFocusStore（真实临时文件 DB）', () => {
  it('1. fresh DB: 构造后 get 返回 undefined（幂等 DDL 已建表, 无行）', () => {
    const h = harness()
    try {
      expect(h.store.get('WS-1')).toBeUndefined()
      // 构造时 DDL 已幂等应用 — 表存在（第二连接可见）。
      const raw2 = new DatabaseSync(h.dbPath)
      try {
        const row = raw2.prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ?').get('table', CURRENT_FOCUS_TABLE)
        expect(row).toEqual({ name: CURRENT_FOCUS_TABLE })
      } finally {
        raw2.close()
      }
    } finally {
      h.close()
    }
  })

  it('2. set 创建 → get 返回完整 record（含注入的 updatedAt）', () => {
    const h = harness()
    try {
      const expectedStamp = h.clock.value()
      const written = h.store.set('WS-1', 'T-1')
      expect(written).toEqual({ workstreamId: 'WS-1', planItemId: 'T-1', updatedAt: expectedStamp })
      expect(h.store.get('WS-1')).toEqual({ workstreamId: 'WS-1', planItemId: 'T-1', updatedAt: expectedStamp })
    } finally {
      h.close()
    }
  })

  it('3. set 替换（同 workstream 新目标）→ get 为新目标、updatedAt 更新', () => {
    const h = harness()
    try {
      const s1 = h.clock.value()
      h.store.set('WS-1', 'T-1')
      const s2 = h.clock.value()
      expect(s2).toBeGreaterThan(s1)
      const written = h.store.set('WS-1', 'M-1')
      expect(written).toEqual({ workstreamId: 'WS-1', planItemId: 'M-1', updatedAt: s2 })
      expect(h.store.get('WS-1')).toEqual({ workstreamId: 'WS-1', planItemId: 'M-1', updatedAt: s2 })
    } finally {
      h.close()
    }
  })

  it('4. 两个 workstream 互不干扰（各自单值）', () => {
    const h = harness()
    try {
      const a1 = h.clock.value()
      h.store.set('WS-1', 'T-1')
      const b1 = h.clock.value()
      h.store.set('WS-2', 'G-1')
      expect(h.store.get('WS-1')).toEqual({ workstreamId: 'WS-1', planItemId: 'T-1', updatedAt: a1 })
      expect(h.store.get('WS-2')).toEqual({ workstreamId: 'WS-2', planItemId: 'G-1', updatedAt: b1 })
      // 覆盖 WS-1 不影响 WS-2。
      const a2 = h.clock.value()
      h.store.set('WS-1', 'T-2')
      expect(h.store.get('WS-1')).toEqual({ workstreamId: 'WS-1', planItemId: 'T-2', updatedAt: a2 })
      expect(h.store.get('WS-2')).toEqual({ workstreamId: 'WS-2', planItemId: 'G-1', updatedAt: b1 })
      // 清除 WS-2 不影响 WS-1。
      expect(h.store.clear('WS-2')).toBe(true)
      expect(h.store.get('WS-2')).toBeUndefined()
      expect(h.store.get('WS-1')).toEqual({ workstreamId: 'WS-1', planItemId: 'T-2', updatedAt: a2 })
    } finally {
      h.close()
    }
  })

  it('5. clear 有行 → true、无行 → false; clear 后 get undefined', () => {
    const h = harness()
    try {
      expect(h.store.clear('WS-9')).toBe(false)
      h.store.set('WS-1', 'T-1')
      expect(h.store.clear('WS-1')).toBe(true)
      expect(h.store.get('WS-1')).toBeUndefined()
      expect(h.store.clear('WS-1')).toBe(false)
    } finally {
      h.close()
    }
  })

  it('6. restart 持久化: 关闭 → 重新 open 同一文件 → 新 store → 原记录仍在', () => {
    const h = harness()
    try {
      const s1 = h.clock.value()
      h.store.set('WS-1', 'T-3')
      h.store.set('WS-2', 'G-2')
      h.close() // 关闭 DatabaseSync（模拟进程退出）

      const reopened = reopenStore(h.dbPath, h.clock)
      try {
        expect(reopened.store.get('WS-1')).toEqual({ workstreamId: 'WS-1', planItemId: 'T-3', updatedAt: s1 })
        expect(reopened.store.get('WS-2')?.planItemId).toBe('G-2')
      } finally {
        reopened.raw.close()
      }
    } finally {
      h.close() // idempotent — already closed above
    }
  })

  it('7. 文件级迁移（managed/standalone 模拟）: 复制 .sqlite 到另一目录 → 数据完整', () => {
    const h = harness()
    const dest = makeTempDir('rc-current-focus-migrate-')
    try {
      const s1 = h.clock.value()
      h.store.set('WS-1', 'T-1')
      h.close() // 关闭后文件自包含（DELETE journal）— 迁移前提

      cpSync(h.dbPath, `${dest}/research.sqlite`)
      const { raw, store } = reopenStore(`${dest}/research.sqlite`, h.clock)
      try {
        expect(store.get('WS-1')).toEqual({ workstreamId: 'WS-1', planItemId: 'T-1', updatedAt: s1 })
        // 迁移后的文件可继续写（不只是只读可读）。
        const s2 = h.clock.value()
        const written = store.set('WS-1', 'T-9')
        expect(written.planItemId).toBe('T-9')
        expect(written.updatedAt).toBe(s2)
      } finally {
        raw.close()
      }
    } finally {
      h.close() // idempotent
    }
  })

  it('8. 关闭句柄守卫: db face（adaptDatabaseSync 路径）关闭后 → WIRING_CLOSED', () => {
    const h = harness()
    try {
      h.store.set('WS-1', 'T-1')
      h.raw.close() // 模拟 wiring 重初始化/拆除后陈旧引用

      // face 层（生产适配器守卫）: 全部 5 个操作结构化 WIRING_CLOSED。
      expectClosed(() => h.db.exec('SELECT 1'), 'exec')
      expectClosed(() => h.db.run('INSERT INTO current_focus VALUES (?, ?, ?)', 'WS-9', 'T-9', 1), 'run')
      expectClosed(() => h.db.get(SQL_GET_CURRENT_FOCUS, 'WS-1'), 'get')
      expectClosed(() => h.db.all(`SELECT * FROM ${CURRENT_FOCUS_TABLE}`), 'all')
      // transaction 的守卫操作名 = 'BEGIN IMMEDIATE'（适配器先于 BEGIN 检查 isOpen）。
      expectClosed(() => h.db.transaction(() => h.db.get(SQL_GET_CURRENT_FOCUS, 'WS-1')), 'BEGIN IMMEDIATE')

      // store 层: 包 CF_STORE, cause = WIRING_CLOSED（message 穿透 —
      // 用户仍看到 WHY + remedy, 不被本层吞掉）。
      try {
        h.store.get('WS-1')
        expect.unreachable('a closed-handle store.get must throw')
      } catch (cause) {
        expect(cause).toBeInstanceOf(CurrentFocusError)
        const error = cause as CurrentFocusError
        expect(error.code).toBe('CF_STORE')
        expect(error.cause).toBeInstanceOf(HostWiringError)
        expect((error.cause as HostWiringError).code).toBe('WIRING_CLOSED')
        expect(error.message).toContain('closed before get')
      }
    } finally {
      h.close() // idempotent
    }
  })

  it('构造器: db face 缺函数 ⇒ CF_INPUT（同 InterventionLifecycleStore 检查模式）', () => {
    const h = harness()
    try {
      expectCfCode(() => new CurrentFocusStore({ db: undefined as unknown as PlanForkDb }), 'CF_INPUT', 'operational-DB face')
      expectCfCode(() => new CurrentFocusStore({ db: {} as unknown as PlanForkDb }), 'CF_INPUT', 'operational-DB face')
      // 部分 face（有 exec 无 run）也拒绝。
      const partial = { exec: (sql: string) => h.raw.exec(sql) }
      expectCfCode(() => new CurrentFocusStore({ db: partial as unknown as PlanForkDb }), 'CF_INPUT', 'operational-DB face')
    } finally {
      h.close()
    }
  })

  it('边界: 空 / 纯空白 / 非字符串 id ⇒ CF_INPUT（set/get/clear）', () => {
    const h = harness()
    try {
      expectCfCode(() => h.store.set('', 'T-1'), 'CF_INPUT', 'workstreamId')
      expectCfCode(() => h.store.set('   ', 'T-1'), 'CF_INPUT', 'workstreamId')
      expectCfCode(() => h.store.set('WS-1', ''), 'CF_INPUT', 'planItemId')
      expectCfCode(() => h.store.get(''), 'CF_INPUT', 'workstreamId')
      expectCfCode(() => h.store.clear('  '), 'CF_INPUT', 'workstreamId')
      expectCfCode(() => h.store.set(42 as unknown as string, 'T-1'), 'CF_INPUT', 'workstreamId')
    } finally {
      h.close()
    }
  })
})
