/**
 * UI0 (R-01) — tests/current-focus/ harness:
 *
 *   1. REAL 临时文件 `DatabaseSync`（node:sqlite;
 *      `mkdtempSync(join(tmpdir(), 'rc-current-focus-'))` +
 *      `join(dir, 'research.sqlite')` — tests/wiring 真实工件纪律,
 *      零 mock 驱动）;
 *   2. db face = 生产适配器 `adaptDatabaseSync`
 *      （src/host/service/wiring/db-adapter.ts — 含 WIRING_CLOSED
 *      closed-handle 守卫; store 收到的就是这个 face）;
 *   3. fake canonical provider = 可变 id 数组（模拟 plan mutation:
 *      目标留在 / 移出 canonical Plan）+ 一次性故障注入;
 *   4. 时钟 = 确定性单调（T0 + n·1000ms — 同 tests/actions 纪律;
 *      store 与 service 共享同一时钟 — service 的写后戳一致性守门
 *      预期单一时钟; 每次 service.set 恰好消耗 1 tick, 即 store 的戳）;
 *   5. 每个 harness 一个 tmp 目录（afterAll 递归清扫 — tests/wiring
 *      同款纪律; 测试内临时文件用 try/finally 或 harness.close 清理）。
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll } from 'vitest'

import type { PlanForkDb } from '../../src/host/domain/planfork/index.js'
import {
  CurrentFocusService,
  CurrentFocusStore,
  type CanonicalPlanItemIdsProvider,
} from '../../src/host/service/current-focus/index.js'
import { adaptDatabaseSync } from '../../src/host/service/wiring/db-adapter.js'

export const T0 = Date.parse('2026-08-23T10:00:00Z')

/* ------------------------------------------------------------------ *
 * Temp plumbing（tracked roots, afterAll sweep — 同 tests/wiring）
 * ------------------------------------------------------------------ */

const roots: string[] = []

export function makeTempDir(prefix = 'rc-current-focus-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

/* ------------------------------------------------------------------ *
 * Deterministic monotonic clock（T0 + n·1000ms; 同 tests/actions）
 * ------------------------------------------------------------------ */

/** `value()` = the next stamp WITHOUT consuming it (tests peek it);
 *  `tick()` = consume one stamp (the store's write-time sample). */
export function makeClock(): { value: () => number; tick: () => number } {
  let n = 0
  return {
    value: () => T0 + n * 1000,
    tick: () => T0 + n++ * 1000,
  }
}

/* ------------------------------------------------------------------ *
 * Fake canonical-plan provider（可变数组模拟 plan mutation）
 * ------------------------------------------------------------------ */

export interface FakeCanonicalPlan {
  readonly provider: CanonicalPlanItemIdsProvider
  /** 当前 canonical 成员（测试断言用只读视图）。 */
  readonly ids: () => readonly string[]
  /** 整体替换 canonical 成员（plan mutation 模拟）。 */
  setIds(ids: readonly string[]): void
  /** 从 canonical Plan 移除一个目标（「目标已被移出」模拟）。 */
  remove(id: string): void
  /** 加回一个目标（「目标回到 canonical」模拟 — retained 路径）。 */
  add(id: string): void
  /** 下一次调用抛该错误（一次性 — 消费后复位）。 */
  failNext(error: Error): void
}

export function makeFakeCanonicalPlan(ids: readonly string[] = []): FakeCanonicalPlan {
  let current: string[] = [...ids]
  let failWith: Error | null = null
  const provider: CanonicalPlanItemIdsProvider = (workstreamId: string): readonly string[] => {
    if (failWith !== null) {
      const e = failWith
      failWith = null
      throw e
    }
    void workstreamId
    return current
  }
  return {
    provider,
    ids: () => current,
    setIds: (next: readonly string[]) => {
      current = [...next]
    },
    remove: (id: string) => {
      current = current.filter((x) => x !== id)
    },
    add: (id: string) => {
      if (!current.includes(id)) current = [...current, id]
    },
    failNext: (error: Error) => {
      failWith = error
    },
  }
}

/* ------------------------------------------------------------------ *
 * The harness
 * ------------------------------------------------------------------ */

export interface CurrentFocusHarness {
  readonly dir: string
  readonly dbPath: string
  /** Raw node:sqlite handle（reopen / migrate / closed-guard 负例用）。 */
  readonly raw: DatabaseSync
  /** db face = adaptDatabaseSync(raw)（生产适配器 — WIRING_CLOSED 守卫）。 */
  readonly db: PlanForkDb
  readonly store: CurrentFocusStore
  readonly service: CurrentFocusService
  readonly plan: FakeCanonicalPlan
  readonly clock: { value: () => number; tick: () => number }
  close(): void
}

/**
 * Build one harness: fresh tmp dir + real `research.sqlite` + production
 * adapter face + real store/service over a deterministic clock.
 *
 * `canonical` = the initial canonical-plan member ids of the fake
 * provider（tests mutate it via `plan` to simulate Plan mutations）。
 */
export function makeCurrentFocusHarness(canonical: readonly string[] = []): CurrentFocusHarness {
  const dir = makeTempDir()
  const dbPath = join(dir, 'research.sqlite')
  const raw = new DatabaseSync(dbPath)
  raw.exec('PRAGMA busy_timeout = 5000')

  const db = adaptDatabaseSync(raw)
  const clock = makeClock()
  const now = clock.tick
  const plan = makeFakeCanonicalPlan(canonical)

  const store = new CurrentFocusStore({ db, now })
  const service = new CurrentFocusService({ store, canonicalPlanItemIds: plan.provider, now })

  return {
    dir,
    dbPath,
    raw,
    db,
    store,
    service,
    plan,
    clock,
    close: () => {
      try {
        raw.close()
      } catch {
        /* already closed by the test under audit */
      }
    },
  }
}

/** Re-open the SAME file（restart 持久化 / 第二连接测试）: fresh raw
 *  handle + fresh store over a fresh adapter face。 */
export function reopenStore(dbPath: string, clock: { value: () => number; tick: () => number }): {
  raw: DatabaseSync
  db: PlanForkDb
  store: CurrentFocusStore
} {
  const raw = new DatabaseSync(dbPath)
  raw.exec('PRAGMA busy_timeout = 5000')
  const db = adaptDatabaseSync(raw)
  const store = new CurrentFocusStore({ db, now: clock.tick })
  return { raw, db, store }
}
