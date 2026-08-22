/**
 * WP-2.8 — TC-PERF-003: 过滤查询走索引（EXPLAIN QUERY PLAN 无全表扫描）.
 * WP-2.9 — run/task 过滤缺口修复后翻转：四类过滤全部 SEARCH USING INDEX.
 *
 * TEST_MATRIX §3.7 TC-PERF-003: 「按 event_type/run/task/workstream 过滤走
 * 索引（EXPLAIN QUERY PLAN 无全表扫描）」.
 *
 * 方法: 对真实 research.sqlite（1k 事件 — 计划与规模无关）用测试侧 raw
 * 连接执行 `EXPLAIN QUERY PLAN`，逐条检查 SQLite 给出的计划:
 *   - SEARCH … USING (COVERING) INDEX … → 走索引（通过）;
 *   - SCAN history_event（无 USING INDEX）→ 全表扫描.
 *
 * 现 schema（WP-2.1 V1 + WP-2.9 索引面）实际索引:
 *   - idx_history_event_ws_occurred_seq      (owner_workstream_id, occurred_at, event_seq)
 *   - idx_history_event_type_occurred        (event_type, occurred_at)
 *   - idx_history_event_recorded             (recorded_at)
 *   - idx_history_event_payload_run_occurred (payload_run_id, occurred_at)   ← WP-2.9
 *   - idx_history_event_payload_task_occurred (payload_task_id, occurred_at) ← WP-2.9
 *   - UNIQUE(owner_workstream_id, event_seq)（隐式索引, listRange 面）
 *
 * 过滤断言（四类 + listRange 形态，全部无全表扫描）:
 *   - event_type 过滤        → SEARCH USING INDEX idx_history_event_type_occurred
 *   - workstream 过滤        → SEARCH USING INDEX（ws 复合索引/UNIQUE 索引）
 *   - listRange 查询形态     → SEARCH USING INDEX（UNIQUE 隐式索引）
 *   - task 过滤              → SEARCH USING INDEX idx_history_event_payload_task_occurred
 *   - run  过滤              → SEARCH USING INDEX idx_history_event_payload_run_occurred
 *
 * WP-2.9 翻转说明（WP-2.8 遗留问题 1 已分诊落地）: run/task 过滤面由
 * `payload LIKE '%…id…%'`（全表 SCAN，WP-2.8 按现状 pin GAP）改为对生成列
 * `payload_task_id` / `payload_run_id` 的等值过滤 — 两列是 SQLite VIRTUAL
 * 生成列（json_extract(payload, '$.task_id' / '$.run_id')），即「事件直接
 * 主体」语义（catalog §5 中 run_id/task_id 为 RUN_* / TASK_* 事件的顶层
 * payload 字段）；等值语义同时收窄了 LIKE 的任意文本匹配（嵌套
 * runs[].run_id 等不再命中 — 那是主体语义之外的引用面）。索引落地后
 * 本文件从「pin SCAN」翻转为「断言 USING INDEX」（WP-2.8 测试注释口径）。
 */
import { DatabaseSync } from 'node:sqlite'
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

  it('schema index inventory matches V1 (three WP-2.1 indexes + two WP-2.9 filter indexes, no others)', () => {
    const rows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'history_event' " +
          "AND name NOT LIKE 'sqlite_autoindex_%' ORDER BY name",
      )
      .all() as Array<{ name: string }>
    const names = rows.map((r) => r.name)
    console.log(`[TC-PERF-003] named indexes on history_event: ${names.join(', ')}`)
    expect(names).toEqual([
      'idx_history_event_payload_run_occurred',
      'idx_history_event_payload_task_occurred',
      'idx_history_event_recorded',
      'idx_history_event_type_occurred',
      'idx_history_event_ws_occurred_seq',
    ])
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

  it('task_id filter (generated column payload_task_id): SEARCH USING INDEX (was GAP SCAN pre-WP-2.9)', () => {
    const details = explainPlan(
      db,
      "SELECT event_id FROM history_event WHERE payload_task_id = 'T-37'",
    )
    console.log(`[TC-PERF-003] task filter plan: ${details.join(' | ')}`)
    const v = classify(details)
    expect(v.usesIndex).toBe(true)
    expect(v.fullScan).toBe(false)
    // Pin the INTENDED index (not just any index): the WP-2.9 task filter index.
    expect(details.join(' | ')).toContain('idx_history_event_payload_task_occurred')
  })

  it('run_id filter (generated column payload_run_id): SEARCH USING INDEX (was GAP SCAN pre-WP-2.9)', () => {
    const details = explainPlan(
      db,
      "SELECT event_id FROM history_event WHERE payload_run_id = 'R-41'",
    )
    console.log(`[TC-PERF-003] run filter plan: ${details.join(' | ')}`)
    const v = classify(details)
    expect(v.usesIndex).toBe(true)
    expect(v.fullScan).toBe(false)
    // Pin the INTENDED index (not just any index): the WP-2.9 run filter index.
    expect(details.join(' | ')).toContain('idx_history_event_payload_run_occurred')
  })
})
