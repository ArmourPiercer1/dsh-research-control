/**
 * WP-2.8 — TC-PERF-001: 10k 事件 semantic replay < 1s + 分页查询 p95 < 200ms.
 *
 * TEST_MATRIX §3.7 TC-PERF-001: 「10k 事件 semantic replay: 全量语义回放
 * < 1s（本地 SQLite）；分页查询 p95 < 200ms」.
 *
 * 被测路径（WP-2.1 store 读面 + WP-2.3 replay/query，本 WP 不修改 src）:
 *  - 全量 semantic replay = `collectAllEvents(store, workstreams, 'semantic')`
 *    （per-WS `listRange` 全量读 + 确定性 semantic 全序合并 — catalog §2
 *    「默认 UI History 时间线」的完整数据面）;
 *  - 分页查询 = `queryEvents(store, ws, { order: 'semantic', afterSeq, limit })`
 *    循环走页协议（seq-cursor, O(window) — query.ts 头注释），对每一页计时,
 *    取 p95.
 *
 * 数据集: 确定性 10k 合法事件（generator.ts — 每事件过完整 validateEvent；
 * 混合类型分布 + late registration 形态）.
 *
 * 稳定性口径（任务书）: 绝对值断言放宽 — CI 上放宽 3x（1s→3s / 200ms→600ms），
 * 本地严格；实测数字全部 console 输出供报告引用.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  collectAllEvents,
  queryEvents,
} from '../../src/host/history/replay/index.js'
import { generatePerfDataset, type PerfDataset } from './generator.js'
import {
  buildPerfStore,
  fmtTiming,
  makePerfTempDir,
  measure,
  onceMs,
  percentile,
  PERF_ENABLED,
  PERF_RELAX,
  type BuiltStore,
} from './harness.js'

const COUNT = 10_000
const PAGE_LIMIT = 1_000

describe.runIf(PERF_ENABLED)('TC-PERF-001: 10k semantic replay < 1s + pagination p95 < 200ms', () => {
  let ds: PerfDataset
  let built: BuiltStore
  let dir: string

  beforeAll(() => {
    dir = makePerfTempDir('wp28-tc001-')
    ds = generatePerfDataset({ count: COUNT, seed: 0x5eed })
    built = buildPerfStore(dir, ds.events, ds.workstreams)
    // The mix covers ALL 11 types of the six families — pins the generator
    // against a silently unreachable type (weight-sum bug class).
    const required = [
      'RUN_STARTED',
      'RUN_FINISHED',
      'TASK_EXECUTION_CHANGED',
      'TASK_VALIDATION_CHANGED',
      'CLAIM_RECORDED',
      'CLAIM_RETRACTED',
      'FACT_RECORDED',
      'ARTIFACT_REGISTERED',
      'ARTIFACT_MARKED_MISSING',
      'RELATION_ADDED',
      'RELATION_REMOVED',
    ]
    for (const t of required) {
      expect(ds.byType[t], `event type ${t} missing from the realized distribution`).toBeGreaterThan(0)
    }
    const dist = Object.entries(ds.byType)
      .map(([t, n]) => `${t}=${n}`)
      .join(' ')
    console.log(
      `[TC-PERF-001] dataset: ${COUNT} events (all passed validateEvent), ` +
        `late=${ds.lateCount}, workstreams=${ds.workstreams.join(',')}, ` +
        `append ${built.appendMs.toFixed(0)} ms (batch ${built.batchSize}), dist: ${dist}`,
    )
  })

  afterAll(() => {
    built?.store.close()
  })

  it('full semantic replay over 10k events < 1s (CI: relaxed ×3)', () => {
    const limitMs = 1_000 * PERF_RELAX
    // Warm run inside measure: cold-cache spike lands on run 1, median is robust.
    const t = measure(() => collectAllEvents(built.store, built.workstreams, 'semantic'))

    // The replay returns the ENTIRE log, in semantic order.
    const events = collectAllEvents(built.store, built.workstreams, 'semantic')
    expect(events.length).toBe(COUNT)
    // Semantic ordering: occurredAt non-decreasing (late events interleaved at
    // their TIME positions, catalog §2 — the dataset carries late registrations).
    for (let i = 1; i < events.length; i++) {
      expect(events[i]!.occurredAt).toBeGreaterThanOrEqual(events[i - 1]!.occurredAt)
    }
    // Every event is a valid record (envelope fields intact after the DB round-trip).
    expect(events[0]).toMatchObject({
      ownerWorkstreamId: expect.stringMatching(/^WS-/),
      schemaVersion: 1,
    })

    expect(t.medianMs).toBeLessThan(limitMs)
    console.log(
      `[TC-PERF-001] semantic replay 10k: ${fmtTiming(t)} ` +
        `(pass line ${limitMs} ms${PERF_RELAX > 1 ? ' — CI relaxed ×3' : ''}; strict target 1000 ms)`,
    )
  })

  it('pagination loop: every page < 200ms, p95 < 200ms (CI: relaxed ×3)', () => {
    const limitMs = 200 * PERF_RELAX
    const pageMs: number[] = []
    const pageSizes: number[] = []
    let total = 0
    let pages = 0
    for (const ws of built.workstreams) {
      let afterSeq = 0
      for (;;) {
        const t0 = performance.now()
        const page = queryEvents(built.store, ws, {
          order: 'semantic',
          afterSeq,
          limit: PAGE_LIMIT,
        })
        const ms = performance.now() - t0
        pageMs.push(ms)
        pageSizes.push(page.events.length)
        total += page.events.length
        pages++
        if (page.exhausted) break
        // Protocol invariants (query.ts header): a non-exhausted page always
        // carries its next cursor, and the window is capped at limit rows.
        const next = page.nextAfterSeq
        if (next === null) throw new Error('pagination protocol violated: non-exhausted page without nextAfterSeq')
        expect(next).toBeGreaterThan(afterSeq)
        expect(page.events.length).toBeLessThanOrEqual(PAGE_LIMIT)
        afterSeq = next
      }
    }

    // The pages PARTITION the log: exact total, 5 workstreams × 2000 events,
    // 2 FULL pages each (2000 = 2 × 1000). The protocol (query.ts header)
    // detects exhaustion by DENSITY — after the last full page it takes one
    // SHORT (empty) probe page per workstream, so: 10 full + 5 probe = 15.
    expect(total).toBe(COUNT)
    expect(pages).toBe(15)
    expect(pageSizes.filter((n) => n === PAGE_LIMIT)).toHaveLength(10)
    expect(pageSizes.filter((n) => n === 0)).toHaveLength(5)
    expect(Math.max(...pageSizes)).toBeLessThanOrEqual(PAGE_LIMIT)

    const p95 = percentile(pageMs, 95)
    const dataPageMs = pageMs.filter((_, idx) => pageSizes[idx]! > 0)
    const p95Data = percentile(dataPageMs, 95)
    expect(Math.max(...pageMs)).toBeLessThanOrEqual(limitMs)
    expect(p95).toBeLessThan(limitMs)
    console.log(
      `[TC-PERF-001] pagination ${pages} pages (10 data × ${PAGE_LIMIT} rows + 5 empty probes): ` +
        `p95(all) ${p95.toFixed(1)} ms, p95(data) ${p95Data.toFixed(1)} ms, ` +
        `max ${Math.max(...pageMs).toFixed(1)} ms ` +
        `(pass line ${limitMs} ms${PERF_RELAX > 1 ? ' — CI relaxed ×3' : ''}; strict target 200 ms)`,
    )
  })
})
