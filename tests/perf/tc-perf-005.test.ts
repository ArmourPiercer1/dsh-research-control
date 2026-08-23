/**
 * WP-2.8 / WP-8.2 — TC-PERF-005: 无 O(n²) — 1k vs 10k 全量 replay 耗时比值
 * < 15x（线性容差）.
 *
 * TEST_MATRIX §3.7 TC-PERF-005: 「无 O(n²): 1k vs 10k 规模耗时比值 < 15x
 * （线性容差）」.
 *
 * 方法: 1k 数据集（10k 确定性流的前缀行）与 10k 数据集各灌一个 store，对
 * **全量 replay**（`collectAllEvents` — 与 TC-PERF-001/002 同路径, per-WS
 * 全量读 + 全序合并）计时. 通过统计量 = **成对交替中位**（WP-8.2 稳定性
 * 处理, 见下）, 比值断言为主 — 任务书：CI 抖动容忍, 中位数抑制冷缓存/
 * 单跑尖峰.
 *
 * WP-8.2 稳定性处理（RR-014④: 「TC-PERF-005 余量薄 — 机器敏感」, G2 r2
 * 实测 8.05x–11.93x / 线 15x）— 任务书二选一, **两者皆做**:
 *  1. **多轮中位 → 成对交替中位**（更稳的多轮中位）: 朴素设计（先整块测
 *     1k, 再整块测 10k, 取中位之比）在本机 3 次套件运行实测 7.85x /
 *     11.72x / 14.56x — 全部过线但最坏贴线 3%。噪声源 = 1k 侧分母贴近
 *     ~2.5ms 计时底噪（2.3–3.7ms 带）+ 两侧整块测量间的慢系统漂移（CPU
 *     频率/热/WSL2 调度/后台负载）+ JIT 预热顺序偏置。成对交替设计
 *     （每轮 (1k, 10k) 背靠背连测, 近同系统态 ⇒ 共享漂移在成对比值中
 *     抵消; 1 对预热除外; 11 轮取成对比值的中位 — 奇数轮 = 真单样本）
 *     消除上述三项: 通过统计量 = **11 个成对比值的中位数**。
 *  2. **比值断言容差论证**（成本模型 — 为什么 15x 是结构上安全的线）:
 *     本路径实测成本 = per-WS `listRange`（O(N) 读）+ 跨 WS **全量排序**
 *     （`collectAllEvents` = flatMap + `semanticOrder`/`auditOrder` 全排序
 *     — O(N·log N)）。设 t(N) = 8a + b·N + c·N·log₂N, N₁ = 1k 侧行数
 *     （≈1012）, 则
 *       ratio = t(10N₁)/t(N₁) = (8a + 10bN₁ + 13.32·cN₁log₂N₁) / (8a + bN₁ + cN₁log₂N₁)
 *             = (α + 10 + 13.32β) / (α + 1 + β),  α = 8a/(bN₁), β = cN₁log₂N₁/(bN₁)
 *     对一切 α,β ≥ 0 有 ratio < 13.32（纯 N·log N 上界；读主导时 →10，
 *     固定开销主导时 →1；13.32(α+1+β) − (α+10+13.32β) = 12.32α + 3.32 > 0）。
 *     15x 通过线 = 线性/N·log N 类**最坏上界 13.32x** 之上留 ≈12.7%
 *     机器噪声余量，距 O(n²) 的 ≈100x 有 6.7x 鸿沟（缺陷捕获侧）— 线在
 *     (13.32, 100) 区间内贴线性类上界，正是「线性容差」的划界（WP-2.8 的
 *     ≤10x 论证漏算了排序项，WP-8.2 修正为 13.32x）。**任何线性类实现
 *     的成对比值结构性 < 13.32x < 15x — 通过不靠抖动运气**; 实测中位
 *     ~11-12x 恰落在 [10, 13.32] 的读/排序混合带内。
 *
 * 补强: audit 序全量 replay 同线断言（第二条完整数据面 — 双时序的 audit
 * 全排序是另一条 O(N log N) 组件，同须线性）.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { collectAllEvents } from '../../src/host/history/replay/index.js'
import { generatePerfDataset, type PerfDataset } from './generator.js'
import {
  buildPerfStore,
  fmtPaired,
  makePerfTempDir,
  pairedRatio,
  PERF_ENABLED,
  type BuiltStore,
} from './harness.js'

const COUNT_10K = 10_000
const COUNT_1K = 1_000
/** Linear-tolerance pass line (task: 比值 < 15x). */
const MAX_RATIO = 15
/** WP-8.2 stability: 11 PAIRED rounds (odd — median = a true sample). */
const ROUNDS = 11

/** Total rows across all 8 workstreams (a full pass must return exactly this). */
function totalRows(store: BuiltStore['store'], ws: readonly string[]): number {
  return ws.reduce((sum, w) => sum + store.listRange(w, 1).length, 0)
}

describe.runIf(PERF_ENABLED)('TC-PERF-005: full replay scales linearly (1k vs 10k paired ratio < 15x)', () => {
  let ds10k: PerfDataset
  let small: BuiltStore
  let big: BuiltStore
  let dirs: string[]
  let smallTotal = 0
  let bigTotal = 0

  beforeAll(() => {
    dirs = [makePerfTempDir('wp82-tc005-small-'), makePerfTempDir('wp82-tc005-big-')]
    ds10k = generatePerfDataset({ count: COUNT_10K, seed: 0x5eed })
    const ds1k = generatePerfDataset({ count: COUNT_1K, seed: 0x5eed })
    expect(ds1k.events).toEqual(ds10k.events.slice(0, ds1k.events.length))
    small = buildPerfStore(dirs[0]!, ds1k.events, ds1k.workstreams)
    big = buildPerfStore(dirs[1]!, ds10k.events, ds10k.workstreams)
    smallTotal = totalRows(small.store, ds1k.workstreams)
    bigTotal = totalRows(big.store, ds10k.workstreams)
  })

  afterAll(() => {
    small?.store.close()
    big?.store.close()
  })

  it(`full semantic replay: median-of-${ROUNDS} PAIRED ratio (10k / 1k) < 15x`, () => {
    const p = pairedRatio(
      () => collectAllEvents(small.store, ds10k.workstreams, 'semantic'),
      () => collectAllEvents(big.store, ds10k.workstreams, 'semantic'),
      ROUNDS,
    )
    // Sanity: a full pass returns exactly the whole log on both sides (the
    // ratio is only meaningful when both did a full pass).
    expect(collectAllEvents(small.store, ds10k.workstreams, 'semantic').length).toBe(smallTotal)
    expect(collectAllEvents(big.store, ds10k.workstreams, 'semantic').length).toBe(bigTotal)
    expect(p.ratio).toBeLessThan(MAX_RATIO)
    console.log(
      `[TC-PERF-005] full semantic replay (${ROUNDS} paired rounds; ${smallTotal} vs ${bigTotal} rows): ` +
        `${fmtPaired(p)} | pass < ${MAX_RATIO}x — linear, not quadratic ` +
        `(structural N·log N bound 13.32x < 15x)`,
    )
  })

  it(`full audit replay: median-of-${ROUNDS} PAIRED ratio (10k / 1k) < 15x (second full data face)`, () => {
    const p = pairedRatio(
      () => collectAllEvents(small.store, ds10k.workstreams, 'audit'),
      () => collectAllEvents(big.store, ds10k.workstreams, 'audit'),
      ROUNDS,
    )
    expect(p.ratio).toBeLessThan(MAX_RATIO)
    console.log(
      `[TC-PERF-005] full audit replay (${ROUNDS} paired rounds): ${fmtPaired(p)} | ` +
        `pass < ${MAX_RATIO}x — the audit merge-sort face is linear too`,
    )
  })
})
