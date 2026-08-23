/**
 * WP-2.8 / WP-8.2 — TC-PERF-001: 10k 事件 semantic replay < 1s + 分页查询
 * p95 < 200ms.
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
 * WP-8.2 口径补强（任务书: p95 统计正确性 + 种子固定 + 全 20 型 + 多 WS）:
 *  - 数据集 = WP-8.2 v2 全谱合成集（generator.ts）: 10k 事件位 + RUNS_STARTED
 *    §5.2 fan-out 行，全 20 事件类型分布 + 8 workstream 非均匀加权 +
 *    USER/AGENT/PLUGIN 发射者混合；
 *  - 全 20 型存在性断言（逐型 > 0 — pin 权重和/回退池的静默归零缺陷类）；
 *  - 种子固定 = 同种子两次独立生成逐字节一致（deep-equal 全量事件行）；
 *  - p95 口径 = 线性插值百分位（harness.percentile, R-7 型）对**全部页**
 *    （数据页 + 短页 + 空探测页）计时样本 — p95 的统计口径在样本集上正确，
 *    空探测页是协议的真实成本（query.ts 密度式耗尽检测），不被排除；
 *  - 分页结构断言按数据集**动态**计算（per-WS 行数 → 期望满页/短页/探测页
 *    多重集），不再硬编码 5-WS 均匀分布的 15 页。
 *
 * 稳定性口径（WP-2.8 起）: 绝对值断言 CI 放宽 3x（1s→3s / 200ms→600ms），
 * 本地严格；实测数字全部 console 输出供报告引用.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  collectAllEvents,
  queryEvents,
} from '../../src/host/history/replay/index.js'
import {
  ALL_EVENT_TYPES,
  generatePerfDataset,
  type PerfDataset,
} from './generator.js'
import {
  buildPerfStore,
  envFingerprint,
  fmtTiming,
  makePerfTempDir,
  measure,
  percentile,
  PERF_ENABLED,
  PERF_RELAX,
  type BuiltStore,
} from './harness.js'

const COUNT = 10_000
const PAGE_LIMIT = 1_000

/** Expected pagination structure for one WS with `n` rows at `limit` (query.ts
 *  density protocol): full pages + one short page, plus one EMPTY probe page
 *  only when the log length is an exact multiple of the page size. */
function expectedPages(n: number, limit: number): { full: number; short: number; probe: number } {
  if (n === 0) return { full: 0, short: 0, probe: 1 }
  const full = Math.floor(n / limit)
  const rem = n % limit
  return { full, short: rem !== 0 ? 1 : 0, probe: rem === 0 ? 1 : 0 }
}

describe.runIf(PERF_ENABLED)('TC-PERF-001: 10k semantic replay < 1s + pagination p95 < 200ms', () => {
  let ds: PerfDataset
  let built: BuiltStore
  let dir: string

  beforeAll(() => {
    console.log(`[TC-PERF-001] machine: ${envFingerprint()} (seed 0x5eed, strict local lines${PERF_RELAX > 1 ? ' — CI relaxed ×3' : ''})`)
    dir = makePerfTempDir('wp82-tc001-')
    ds = generatePerfDataset({ count: COUNT, seed: 0x5eed })
    // 种子固定 (task: 种子固定): an independent second generation from the
    // same seed must be byte-identical (deterministic PRNG + fixed mix +
    // fixed WS patterns/forced positions/late rule).
    const dsAgain = generatePerfDataset({ count: COUNT, seed: 0x5eed })
    expect(dsAgain.events).toEqual(ds.events)
    expect(dsAgain.byType).toEqual(ds.byType)
    expect(dsAgain.lateCount).toBe(ds.lateCount)
    built = buildPerfStore(dir, ds.events, ds.workstreams)
    // Full-spectrum coverage (WP-8.2: 全 20 事件类型分布): every catalog
    // type realized > 0 — pins the generator against a silently unreachable
    // type (weight-sum bug class) and the §5.2 fan-out accounting.
    for (const t of ALL_EVENT_TYPES) {
      expect(ds.byType[t], `event type ${t} missing from the realized distribution`).toBeGreaterThan(0)
    }
    expect(Object.keys(ds.byType)).toHaveLength(ALL_EVENT_TYPES.length)
    const dist = Object.entries(ds.byType)
      .map(([t, n]) => `${t}=${n}`)
      .join(' ')
    console.log(
      `[TC-PERF-001] dataset: ${ds.slots} slots → ${ds.events.length} rows (all passed validateEvent; ` +
        `late=${ds.lateCount} rows), workstreams=${ds.workstreams.join(',')} ` +
        `(${Object.entries(ds.byWs).map(([w, n]) => `${w}=${n}`).join(' ')}), ` +
        `append ${built.appendMs.toFixed(0)} ms (batch ${built.batchSize})`,
    )
    console.log(`[TC-PERF-001] dist: ${dist}`)
  })

  afterAll(() => {
    built?.store.close()
  })

  it('full semantic replay over the 10k full-spectrum set < 1s (CI: relaxed ×3)', () => {
    const limitMs = 1_000 * PERF_RELAX
    // Warm run inside measure: cold-cache spike lands on run 1, median is robust.
    const t = measure(() => collectAllEvents(built.store, built.workstreams, 'semantic'))

    // The replay returns the ENTIRE log (slots + fan-out rows), in semantic order.
    const events = collectAllEvents(built.store, built.workstreams, 'semantic')
    expect(events.length).toBe(ds.events.length)
    expect(events.length).toBeGreaterThanOrEqual(COUNT)
    // Semantic ordering: occurredAt non-decreasing across the merged 8-WS log.
    // Late registrations (occurredAt −2h) must interleave at their TIME
    // positions (catalog §2) — any audit-order leak would break monotonicity.
    for (let i = 1; i < events.length; i++) {
      expect(events[i]!.occurredAt).toBeGreaterThanOrEqual(events[i - 1]!.occurredAt)
    }
    // Every event is a valid record (envelope fields intact after the DB round-trip).
    expect(events[0]).toMatchObject({
      ownerWorkstreamId: expect.stringMatching(/^WS-/),
      schemaVersion: 1,
    })
    // The 8-WS log is actually merged (not silently one WS): every owner present.
    const owners = new Set(events.map((e) => e.ownerWorkstreamId))
    expect([...owners].sort()).toEqual([...ds.workstreams].sort())

    expect(t.medianMs).toBeLessThan(limitMs)
    console.log(
      `[TC-PERF-001] semantic replay ${ds.events.length} rows: ${fmtTiming(t)} ` +
        `(pass line ${limitMs} ms${PERF_RELAX > 1 ? ' — CI relaxed ×3' : ''}; strict target 1000 ms)`,
    )
  })

  it('pagination loop: every page ≤ 200ms, p95(all pages) < 200ms (CI: relaxed ×3)', () => {
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

    // The pages PARTITION the log: exact total, and the per-WS page
    // structure (full / short / empty-probe counts) matches the density
    // protocol for this dataset's actual per-WS row counts (WP-8.2:
    // dynamic — the v1 hard-coded 15-page shape assumed 5 uniform WS).
    expect(total).toBe(ds.events.length)
    let expFull = 0
    let expShort = 0
    let expProbe = 0
    for (const ws of ds.workstreams) {
      const n = ds.byWs[ws] ?? 0
      const exp = expectedPages(n, PAGE_LIMIT)
      expFull += exp.full
      expShort += exp.short
      expProbe += exp.probe
    }
    expect(pageSizes.filter((n) => n === PAGE_LIMIT).length).toBe(expFull)
    expect(pageSizes.filter((n) => n > 0 && n < PAGE_LIMIT).length).toBe(expShort)
    expect(pageSizes.filter((n) => n === 0).length).toBe(expProbe)
    expect(pages).toBe(expFull + expShort + expProbe)
    expect(Math.max(...pageSizes)).toBeLessThanOrEqual(PAGE_LIMIT)

    // p95 over ALL page timings (data + short + probe — the probe is real
    // protocol cost, cf. WP-2.8 遗留问题 2): linear-interpolated percentile
    // (harness.percentile, R-7). Plus p95(data-only) for the report.
    const p95 = percentile(pageMs, 95)
    const dataPageMs = pageMs.filter((_, idx) => pageSizes[idx]! > 0)
    const p95Data = percentile(dataPageMs, 95)
    expect(Math.max(...pageMs)).toBeLessThanOrEqual(limitMs)
    expect(p95).toBeLessThan(limitMs)
    console.log(
      `[TC-PERF-001] pagination ${pages} pages (${expFull} full × ${PAGE_LIMIT} + ${expShort} short + ${expProbe} empty probes): ` +
        `p95(all) ${p95.toFixed(1)} ms, p95(data) ${p95Data.toFixed(1)} ms, ` +
        `max ${Math.max(...pageMs).toFixed(1)} ms ` +
        `(pass line ${limitMs} ms${PERF_RELAX > 1 ? ' — CI relaxed ×3' : ''}; strict target 200 ms)`,
    )
  })
})
