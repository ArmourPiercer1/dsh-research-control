/**
 * WP-2.8 — TC-PERF-004: 时间窗口分页 O(window) 而非 O(total).
 *
 * TEST_MATRIX §3.7 TC-PERF-004: 「分页: 时间窗口分页 O(window) 而非
 * O(total)」. 任务书口径: 「取全量中连续窗口，页大小 k，断言耗时与 k 相关
 * 而非总量 — 用 1k vs 10k 上同窗口对比，比值 < 10x 容差」.
 *
 * 设计: 同一数据集族（10k 确定性流；1k = 其前缀）灌入两个 store。在两个
 * store 上查询**同样大小 k=100 的连续窗口**（per-WS seq 轴上的一段 = 该
 * 流近单调时间线上的连续时间窗口；late 事件回拨 2h 仍在窗口邻域内，不影响
 * 量级）— 走 WP-2.3 分页协议的原生页形态（`afterSeq` + `limit` = 页大小 k,
 * 窗口 `(afterSeq, afterSeq+k]`）:
 *   - 1k store : WS-1 共 200 事件,  窗口 seq 51..150  (中段, 100 行);
 *   - 10k store: WS-1 共 2000 事件, 窗口 seq 951..1050 (中段, 100 行).
 * 若分页是 O(window)，同窗口耗时 ≈ 相等（实测比值应 ~1-2x）；若是
 * O(total)（先全扫再过滤），10k 侧应 ≈10x。断言比值 < 10（任务书容差）.
 *
 * 对照（只记录不断言）: 全量 listRange（O(total) 面）两侧比值 ≈10x —
 * 证明窗口查询与全量扫描在量级上可区分.
 *
 * 测量: 每侧 5 次取中位（harness.measure — 首跑冷缓存尖峰被中位抑制）.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { queryEvents } from '../../src/host/history/replay/index.js'
import { generatePerfDataset, type PerfDataset } from './generator.js'
import {
  buildPerfStore,
  fmtTiming,
  makePerfTempDir,
  measure,
  PERF_ENABLED,
  type BuiltStore,
} from './harness.js'

const COUNT_10K = 10_000
const COUNT_1K = 1_000
const WS = 'WS-1'
/** Window size in rows (页大小 k). */
const K = 100

describe.runIf(PERF_ENABLED)('TC-PERF-004: time-window pagination is O(window), not O(total)', () => {
  let ds10k: PerfDataset
  let small: BuiltStore
  let big: BuiltStore
  let dirs: string[]

  beforeAll(() => {
    dirs = [makePerfTempDir('wp28-tc004-small-'), makePerfTempDir('wp28-tc004-big-')]
    ds10k = generatePerfDataset({ count: COUNT_10K, seed: 0x5eed })
    // 1k = the PREFIX of the 10k stream (valid in its own right).
    const ds1k = { ...ds10k, events: ds10k.events.slice(0, COUNT_1K) }
    small = buildPerfStore(dirs[0]!, ds1k.events, ds1k.workstreams)
    big = buildPerfStore(dirs[1]!, ds10k.events, ds10k.workstreams)
  })

  afterAll(() => {
    small?.store.close()
    big?.store.close()
  })

  it('same window k=100: time(10k db) / time(1k db) < 10 (median of 5)', () => {
    // Both windows are contiguous seq spans of exactly K rows, mid-log —
    // the native pagination page shape: `limit` = page size k, window
    // `(afterSeq, afterSeq+k]` (query.ts: beforeSeq-less limit window).
    //   1k  (WS-1 has 200 events):  (50, 150]   → 51..150
    //   10k (WS-1 has 2000 events): (950, 1050] → 951..1050
    const window1k = measure(() =>
      queryEvents(small.store, WS, { order: 'semantic', afterSeq: 50, limit: K }),
    )
    const window10k = measure(() =>
      queryEvents(big.store, WS, { order: 'semantic', afterSeq: 950, limit: K }),
    )

    // Window contents are correct in both stores (the right K seqs, no more,
    // no less — the window is fully consumed, query.ts protocol).
    const page1k = queryEvents(small.store, WS, { order: 'semantic', afterSeq: 50, limit: K })
    const page10k = queryEvents(big.store, WS, { order: 'semantic', afterSeq: 950, limit: K })
    expect(page1k.events.length).toBe(K)
    expect(page10k.events.length).toBe(K)
    expect(page1k.exhausted).toBe(false)
    expect(page10k.exhausted).toBe(false)
    const seqs1k = page1k.events.map((e) => e.eventSeq).sort((a, b) => a - b)
    const seqs10k = page10k.events.map((e) => e.eventSeq).sort((a, b) => a - b)
    expect(seqs1k).toEqual(Array.from({ length: K }, (_, i) => 51 + i))
    expect(seqs10k).toEqual(Array.from({ length: K }, (_, i) => 951 + i))

    expect(window1k.medianMs).toBeGreaterThan(0)
    expect(window10k.medianMs).toBeGreaterThan(0)
    const ratio = window10k.medianMs / window1k.medianMs
    expect(ratio).toBeLessThan(10)
    console.log(
      `[TC-PERF-004] window k=${K} (same window, 1k vs 10k total): ` +
        `1k db ${fmtTiming(window1k)} | 10k db ${fmtTiming(window10k)} | ` +
        `ratio ${ratio.toFixed(2)}x (pass < 10x — O(window), not O(total))`,
    )
  })

  it('control: full listRange scales ~linearly with total (informational)', () => {
    const full1k = measure(() => small.store.listRange(WS, 1))
    const full10k = measure(() => big.store.listRange(WS, 1))
    const ratio = full10k.medianMs / full1k.medianMs
    expect(full10k.medianMs).toBeGreaterThan(0)
    console.log(
      `[TC-PERF-004] control O(total): full WS-1 scan 1k ${fmtTiming(full1k)} | ` +
        `10k ${fmtTiming(full10k)} | ratio ${ratio.toFixed(2)}x ` +
        `(≈10x expected for a full scan — contrast with the window ratio above)`,
    )
  })
})
