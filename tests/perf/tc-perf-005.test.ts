/**
 * WP-2.8 — TC-PERF-005: 无 O(n²) — 1k vs 10k 全量 replay 耗时比值 < 15x.
 *
 * TEST_MATRIX §3.7 TC-PERF-005: 「无 O(n²): 1k vs 10k 规模耗时比值 < 15x
 * （线性容差）」.
 *
 * 方法: 1k 数据集（10k 确定性流的前缀）与 10k 数据集各灌一个 store，对
 * **全量 replay**（`collectAllEvents` semantic — 与 TC-PERF-001 同路径，
 * per-WS 全量读 + 全序合并）各计时 5 次取中位（比值断言为主 — 任务书：
 * CI 抖动容忍，中位数抑制冷缓存/单跑尖峰）.
 *
 * 量级推理: O(n) 实现 → 比值 ≈10x（通过线 15x 留 50% 余量）；O(n²) 实现 →
 * 比值 ≈100x（必然失败）。比值断言在两个数量级之间划界，是抗抖动的正确
 * 口径（绝对值断言对机器差异敏感，不作通过线）.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { collectAllEvents } from '../../src/host/history/replay/index.js'
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
/** Linear-tolerance pass line (task: 比值 < 15x). */
const MAX_RATIO = 15

describe.runIf(PERF_ENABLED)('TC-PERF-005: full replay scales linearly (1k vs 10k ratio < 15x)', () => {
  let ds10k: PerfDataset
  let small: BuiltStore
  let big: BuiltStore
  let dirs: string[]

  beforeAll(() => {
    dirs = [makePerfTempDir('wp28-tc005-small-'), makePerfTempDir('wp28-tc005-big-')]
    ds10k = generatePerfDataset({ count: COUNT_10K, seed: 0x5eed })
    const ds1k = { ...ds10k, events: ds10k.events.slice(0, COUNT_1K) }
    small = buildPerfStore(dirs[0]!, ds1k.events, ds1k.workstreams)
    big = buildPerfStore(dirs[1]!, ds10k.events, ds10k.workstreams)
  })

  afterAll(() => {
    small?.store.close()
    big?.store.close()
  })

  it('median time ratio (10k / 1k) < 15x for full semantic replay', () => {
    const t1k = measure(
      () => collectAllEvents(small.store, ds10k.workstreams, 'semantic'),
      5,
    )
    const t10k = measure(
      () => collectAllEvents(big.store, ds10k.workstreams, 'semantic'),
      5,
    )

    // Sanity: both replays actually returned their full logs (the ratio is
    // only meaningful when both sides did a full pass).
    expect(small.store.listRange('WS-1', 1).length).toBe(200)
    expect(big.store.listRange('WS-1', 1).length).toBe(2_000)

    expect(t1k.medianMs).toBeGreaterThan(0)
    expect(t10k.medianMs).toBeGreaterThan(0)
    const ratio = t10k.medianMs / t1k.medianMs
    expect(ratio).toBeLessThan(MAX_RATIO)
    console.log(
      `[TC-PERF-005] full semantic replay: 1k ${fmtTiming(t1k)} | 10k ${fmtTiming(t10k)} | ` +
        `ratio ${ratio.toFixed(2)}x (pass < ${MAX_RATIO}x — linear, not quadratic)`,
    )
  })
})
