/**
 * WP-2.8 — TC-PERF-003: 过滤查询走索引（EXPLAIN QUERY PLAN 无全表扫描）.
 *
 * TEST_MATRIX §3.7 TC-PERF-003: 「按 event_type/run/task/workstream 过滤走
 * 索引（EXPLAIN QUERY PLAN 无全表扫描）」.
 *
 * 方法: 对真实 research.sqlite（1k 事件 — 计划与规模无关）用测试侧 raw
 * 连接执行 `EXPLAIN QUERY PLAN`，逐条检查 SQLite 给出的计划:
 *   - SEARCH … USING (COVERING) INDEX … → 走索引（通过）;
 *   - SCAN history_event（无 USING INDEX）→ 全表扫描.
 *
 * 现 schema（WP-2.1, DOMAIN_SCHEMA §15）实际索引:
 *   - idx_history_event_ws_occurred_seq  (owner_workstream_id, occurred_at, event_seq)
 *   - idx_history_event_type_occurred    (event_type, occurred_at)
 *   - idx_history_event_recorded         (recorded_at)
 *   - UNIQUE(owner_workstream_id, event_seq)（隐式索引, listRange 面）
 *
 * 现状断言（任务书口径: 缺索引不自行实现 — store 是 WP-2.1 产权）:
 *   - event_type 过滤        → SEARCH USING INDEX idx_history_event_type_occurred ✓
 *   - workstream 过滤        → SEARCH USING INDEX（ws 复合索引/UNIQUE 索引）✓
 *   - listRange 查询形态     → SEARCH USING INDEX（同上）✓
 *   - task 过滤 (payload LIKE '%task_id%')  → 全表 SCAN — 缺口（GAP, 待分诊）
 *   - run  过滤 (payload LIKE '%run_id%')   → 全表 SCAN — 缺口（GAP, 待分诊）
 * run/task 的过滤面在 V1 schema 里没有列（run_id/task_id 只在 payload JSON
 * 里）；缺口与建议索引 DDL 记录在 WP-2.8 报告（遗留问题），本测试按现状
 * 断言并标注 GAP，等待编排者分诊后翻转。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { generatePerfDataset } from './generator.js'
import { buildPerfStore, dbPath, makePerfTempDir, PERF_ENABLED, type BuiltStore } from './harness.js'

const COUNT = 1_000

interface PlanRow {
  id: number
  parent: number
  notused: number
  detail: string
}

function explainPlan(db: DatabaseSync, sql: string): string[] {
  return (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as unknown as PlanRow[]).map((r) => r.detail)
}

interface PlanVerdict {
  /** A detail line is a plain `SCAN <table>` with no index (full table scan). */
  readonly fullScan: boolean
  /** Any detail line uses an index (SEARCH USING [COVERING] INDEX). */
  readonly usesIndex: boolean
}

function classify(details: readonly string[]): PlanVerdict {
  let fullScan = false
  let usesIndex = false
  for (const d of details) {
    const scan = /\bSCAN\b/i.test(d)
    const index = /USING (COVERING )?INDEX/i.test(d)
    if (index) usesIndex = true
    if (scan && !index) fullScan = true
  }
  return { fullScan, usesIndex }
}

describe.runIf(PERF_ENABLED)('TC-PERF-003: filter queries on index coverage (EXPLAIN QUERY PLAN)', () => {
  let built: BuiltStore
  let dir: string
  let db: DatabaseSync

  beforeAll(() => {
    dir = makePerfTempDir('wp28-tc003-')
    const ds = generatePerfDataset({ count: COUNT, seed: 0x5eed })
    built = buildPerfStore(dir, ds.events, ds.workstreams)
    // Test-side raw connection (harness-only, cf. tests/history-replay/helpers.ts rawDb).
    db = new DatabaseSync(built.store.path)
  })

  afterAll(() => {
    db?.close()
    built?.store.close()
  })

  it('schema index inventory matches WP-2.1 V1 (three declared indexes + UNIQUE)', () => {
    const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name").all() as Array<{ name: string }>
    const names = rows.map((r) => r.name)
    console.log(`[TC-PERF-003] indexes on history_event schema: ${names.join(', ')}`)
    expect(names).toEqual(
      expect.arrayContaining([
        'idx_history_event_ws_occurred_seq',
        'idx_history_event_type_occurred',
        'idx_history_event_recorded',
      ]),
    )
  })

  it('event_type filter: SEARCH USING INDEX (no full table scan)', () => {
    const details = explainPlan(
      db,
      "SELECT event_id FROM history_event WHERE event_type = 'FACT_RECORDED'",
    )
    console.log(`[TC-PERF-003] event_type plan: ${details.join(' | ')}`)
    const v = classify(details)
    expect(v.usesIndex).toBe(true)
    expect(v.fullScan).toBe(false)
  })

  it('workstream (owner_workstream_id) filter: SEARCH USING INDEX (no full table scan)', () => {
    const details = explainPlan(
      db,
      "SELECT event_id FROM history_event WHERE owner_workstream_id = 'WS-1'",
    )
    console.log(`[TC-PERF-003] workstream plan: ${details.join(' | ')}`)
    const v = classify(details)
    expect(v.usesIndex).toBe(true)
    expect(v.fullScan).toBe(false)
  })

  it('listRange query shape (ws + seq range + ORDER BY seq): SEARCH USING INDEX', () => {
    const details = explainPlan(
      db,
      "SELECT * FROM history_event WHERE owner_workstream_id = 'WS-1' AND event_seq >= 100 AND event_seq <= 200 ORDER BY event_seq",
    )
    console.log(`[TC-PERF-003] listRange plan: ${details.join(' | ')}`)
    const v = classify(details)
    expect(v.usesIndex).toBe(true)
    expect(v.fullScan).toBe(false)
  })

  it('GAP (triage pending): task_id filter full-table SCANs — no index on payload (see WP-2.8 report)', () => {
    const details = explainPlan(
      db,
      `SELECT event_id FROM history_event WHERE payload LIKE '%\\"task_id\\":\\"T-37\\"%'`,
    )
    console.log(`[TC-PERF-003] task filter plan (GAP — expect full scan until WP-2.1 adds an index): ${details.join(' | ')}`)
    const v = classify(details)
    // CURRENT-STATE assertion (pinned; flips when the index lands):
    expect(v.fullScan).toBe(true)
    expect(v.usesIndex).toBe(false)
  })

  it('GAP (triage pending): run_id filter full-table SCANs — no index on payload (see WP-2.8 report)', () => {
    const details = explainPlan(
      db,
      `SELECT event_id FROM history_event WHERE payload LIKE '%\\"run_id\\":\\"R-41\\"%'`,
    )
    console.log(`[TC-PERF-003] run filter plan (GAP — expect full scan until WP-2.1 adds an index): ${details.join(' | ')}`)
    const v = classify(details)
    // CURRENT-STATE assertion (pinned; flips when the index lands):
    expect(v.fullScan).toBe(true)
    expect(v.usesIndex).toBe(false)
  })
})
