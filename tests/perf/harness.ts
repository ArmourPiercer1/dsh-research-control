/**
 * WP-2.8 — TC-PERF-001..005 shared harness (test infra): run gate, temp-dir
 * discipline, store building (batched append), timing helpers.
 *
 * RUN GATE (task: 独立标记，避免常规套件变慢): the perf suite is collected
 * by the default `vitest run` (include matches tests/perf/*.test.ts) but
 * every perf describe is `describe.runIf(PERF_ENABLED)` — without the env
 * flag the whole suite skips in milliseconds (no dataset, no SQLite, no
 * timing work), so the regular 1114-case suite keeps its runtime. The
 * dedicated runner is `tests/perf/vitest.perf.config.ts`, which sets
 * `DSH_RUN_PERF=1` for its workers:
 *
 *   npx vitest run --config tests/perf/vitest.perf.config.ts
 *
 * STABILITY POLICY (task: 计时断言的稳定性 / CI 抖动容忍): ratio assertions
 * are the PRIMARY pass criteria (TC-PERF-004/005). Absolute assertions
 * (TC-PERF-001/002: < 1s replay, < 200ms p95 page) carry a CI relaxation
 * factor: `PERF_RELAX = 3` when the CI env var is set, else 1 — i.e. on CI
 * the pass lines are 3× looser (3s / 600ms), locally strict (1s / 200ms).
 * Every test logs its measured numbers (console) for the WP-2.8 report.
 * Median-of-N timing (N=5) is used for the ratio comparisons to suppress
 * single-run jitter.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { cpus, platform, release, tmpdir, totalmem } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { afterAll } from 'vitest'

import {
  openDatabase,
  type HistoryEventInput,
  type ResearchStore,
} from '../../src/host/persistence/store/index.js'

/** Perf-suite run gate (see file header). */
export const PERF_ENABLED = process.env.DSH_RUN_PERF === '1'
/** True in a CI environment (jitter-tolerance switch). */
export const PERF_CI =
  process.env.CI !== undefined && process.env.CI !== '' && process.env.CI !== '0'
/** Absolute-assertion relaxation on CI (task: 绝对值断言放宽 3x). */
export const PERF_RELAX = PERF_CI ? 3 : 1

/** Temp roots tracked for afterAll cleanup (WP-2.1/2.3 discipline). */
const roots: string[] = []

/** Fresh temp directory (tracked for afterAll cleanup). */
export function makePerfTempDir(prefix = 'wp28-perf-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

/** The conventional DB file name inside a project data dir. */
export function dbPath(dir: string): string {
  return join(dir, 'research.sqlite')
}

/** Append batch size (rows per appendEvents call = one write transaction). */
export const PERF_BATCH = 250

export interface BuiltStore {
  readonly store: ResearchStore
  readonly events: readonly HistoryEventInput[]
  readonly workstreams: readonly string[]
  /** Wall time of the whole batched append (setup, informational). */
  readonly appendMs: number
  readonly batchSize: number
}

/**
 * Open a FRESH research.sqlite in a temp dir and append `events` in
 * `PERF_BATCH`-sized transactions (no validation hook — the generator
 * already passed every event through full `validateEvent`; store-level
 * shape checking would only tax setup, not the measured paths).
 */
export function buildPerfStore(
  dir: string,
  events: readonly HistoryEventInput[],
  workstreams: readonly string[],
): BuiltStore {
  let clock = Date.parse('2026-09-01T12:00:00Z')
  const store = openDatabase(dbPath(dir), { now: () => (clock += 1_000) })
  const t0 = performance.now()
  for (let i = 0; i < events.length; i += PERF_BATCH) {
    store.appendEvents(events.slice(i, i + PERF_BATCH))
  }
  const appendMs = performance.now() - t0
  return { store, events, workstreams, appendMs, batchSize: PERF_BATCH }
}

export interface Timing {
  /** Median wall time in ms (the jitter-robust figure). */
  readonly medianMs: number
  readonly minMs: number
  readonly maxMs: number
  readonly runs: readonly number[]
}

/** Median of a numeric list (input not mutated). */
export function median(values: readonly number[]): number {
  const v = [...values].sort((a, b) => a - b)
  const mid = Math.floor(v.length / 2)
  return v.length % 2 === 0 ? (v[mid - 1]! + v[mid]!) / 2 : v[mid]!
}

/** Linear-interpolated percentile (p in [0,100]) of a numeric list. */
export function percentile(values: readonly number[], p: number): number {
  const v = [...values].sort((a, b) => a - b)
  if (v.length === 0) return NaN
  const idx = (p / 100) * (v.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return v[lo]!
  return v[lo]! + (v[hi]! - v[lo]!) * (idx - lo)
}

/**
 * Time `fn` `runs` times; return median/min/max in ms. The FIRST run pays
 * cold-cache costs (page cache, JIT) — the median over ≥3 runs suppresses
 * that spike, which is why ratio assertions use medians (task: 比值断言为主).
 */
export function measure(fn: () => unknown, runs = 5): Timing {
  if (!Number.isInteger(runs) || runs < 1) {
    throw new Error(`measure: runs must be a positive integer (got ${String(runs)})`)
  }
  const all: number[] = []
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now()
    fn()
    all.push(performance.now() - t0)
  }
  return {
    medianMs: median(all),
    minMs: Math.min(...all),
    maxMs: Math.max(...all),
    runs: all,
  }
}

/** One-shot high-resolution timing in ms (for single-run assertions). */
export function onceMs(fn: () => unknown): number {
  const t0 = performance.now()
  fn()
  return performance.now() - t0
}

export interface PairedRatio {
  /** Median of the SMALL-side per-round times (ms). */
  readonly smallMs: number
  /** Median of the BIG-side per-round times (ms). */
  readonly bigMs: number
  /** The pass statistic: median of the PAIRED per-round ratios. */
  readonly ratio: number
  /** Ratio of the two medians (informational — sensitive to denominator noise). */
  readonly ratioOfMedians: number
  readonly smallRuns: readonly number[]
  readonly bigRuns: readonly number[]
  readonly pairedRuns: readonly number[]
}

/**
 * Interleaved PAIRED ratio measurement (WP-8.2, TC-PERF-005 stability —
 * RR-014④「余量薄 — 机器敏感」). The naive design (block-measure 1k, then
 * block-measure 10k, ratio of medians) lets slow system drift (CPU
 * frequency scaling, thermal, background load, WSL2 scheduler) and JIT
 * warm-up ORDER bias the 1k-side denominator (which sits near the ~2.5ms
 * timer floor) and inflate the ratio — observed suite-run-to-run band
 * 7.85x–14.56x on the same machine/code, all under the 15x line but with
 * a 3% worst-case margin. The paired design measures (small, big)
 * back-to-back in each of `rounds` rounds — near-identical system state
 * per pair, so shared drift cancels in the paired ratio — with 1 warm-up
 * pair (cold cache/JIT) excluded from the statistics. Pass statistic =
 * the MEDIAN of the paired ratios (odd `rounds` ⇒ a true single sample).
 */
export function pairedRatio(
  small: () => unknown,
  big: () => unknown,
  rounds: number,
): PairedRatio {
  if (!Number.isInteger(rounds) || rounds < 3) {
    throw new Error(`pairedRatio: rounds must be an integer >= 3 (got ${String(rounds)})`)
  }
  small() // warm-up (cold cache/JIT — excluded)
  big()
  const smallRuns: number[] = []
  const bigRuns: number[] = []
  const pairedRuns: number[] = []
  for (let r = 0; r < rounds; r++) {
    const s = onceMs(small)
    const b = onceMs(big)
    smallRuns.push(s)
    bigRuns.push(b)
    pairedRuns.push(b / s)
  }
  const smallMs = median(smallRuns)
  const bigMs = median(bigRuns)
  return {
    smallMs,
    bigMs,
    ratio: median(pairedRuns),
    ratioOfMedians: bigMs / smallMs,
    smallRuns,
    bigRuns,
    pairedRuns,
  }
}

/** Human-readable paired-ratio line for the console (report material). */
export function fmtPaired(p: PairedRatio): string {
  const band = (runs: readonly number[]): string =>
    `${Math.min(...runs).toFixed(2)}–${Math.max(...runs).toFixed(2)}`
  return (
    `small median ${p.smallMs.toFixed(1)} ms | big median ${p.bigMs.toFixed(1)} ms | ` +
    `paired median ${p.ratio.toFixed(2)}x (band ${band(p.pairedRuns)}x; ratio-of-medians ${p.ratioOfMedians.toFixed(2)}x)`
  )
}

/** Human-readable timing line for the console (report material). */
export function fmtTiming(t: Timing): string {
  return `median ${t.medianMs.toFixed(1)} ms (min ${t.minMs.toFixed(1)} / max ${t.maxMs.toFixed(1)} over ${t.runs.length} runs)`
}

/**
 * Machine-environment fingerprint for the profile report (WP-8.2 task:
 * 机器环境说明). Logged once by TC-PERF-001's beforeAll; every absolute
 * number in the report is relative to this machine (ratio assertions are
 * machine-invariant, absolute ones carry the CI relaxation).
 */
export function envFingerprint(): string {
  const c = cpus()
  const model = c[0]?.model?.replace(/\s+/g, ' ').trim() ?? 'unknown cpu'
  return (
    `node ${process.version} / ${platform()}-${process.arch} (kernel ${String(release())})` +
    ` / ${c.length} cpus (${model})` +
    ` / ${Math.round(totalmem() / 1024 / 1024)} MB RAM`
  )
}
