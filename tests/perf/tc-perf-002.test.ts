/**
 * WP-2.8 — TC-PERF-002: 10k 事件 audit replay 同量级 (< 1s).
 *
 * TEST_MATRIX §3.7 TC-PERF-002: 「10k 事件 audit replay: 同量级」 — audit
 * (registration) 全量回放与 semantic 全量回放同量级 (catalog §2 双时序的
 * 两条完整数据面; §6 L279 的 derived_state 重建正是按 audit 顺序全量重放).
 *
 * 被测路径: `collectAllEvents(store, workstreams, 'audit')` — per-WS
 * `listRange` 全量读 + 确定性 audit 全序合并 (eventSeq, owner, id —
 * WP-2.2 `auditOrder`; late-registered events 留在登记尾部, TC-HIST-002).
 *
 * 断言: 中位耗时 < 1s (CI 放宽 3x); 全量返回; 结果 = 独立重算的
 * `auditOrder` 全序（顺序正确性，不靠「快」代替「对」）; 两次调用字节一致
 * （确定性, TC-HIST-005 同量级口径）.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { auditOrder } from '../../src/host/history/registry/index.js'
import { collectAllEvents } from '../../src/host/history/replay/index.js'
import { generatePerfDataset, type PerfDataset } from './generator.js'
import {
  buildPerfStore,
  fmtTiming,
  makePerfTempDir,
  measure,
  PERF_ENABLED,
  PERF_RELAX,
  type BuiltStore,
} from './harness.js'

const COUNT = 10_000

describe.runIf(PERF_ENABLED)('TC-PERF-002: 10k audit replay < 1s (same magnitude as semantic)', () => {
  let ds: PerfDataset
  let built: BuiltStore
  let dir: string

  beforeAll(() => {
    dir = makePerfTempDir('wp28-tc002-')
    ds = generatePerfDataset({ count: COUNT, seed: 0x5eed })
    built = buildPerfStore(dir, ds.events, ds.workstreams)
  })

  afterAll(() => {
    built?.store.close()
  })

  it('full audit-order replay over 10k events < 1s (CI: relaxed ×3)', () => {
    const limitMs = 1_000 * PERF_RELAX
    const t = measure(() => collectAllEvents(built.store, built.workstreams, 'audit'))
    expect(t.medianMs).toBeLessThan(limitMs)
    console.log(
      `[TC-PERF-002] audit replay 10k: ${fmtTiming(t)} ` +
        `(pass line ${limitMs} ms${PERF_RELAX > 1 ? ' — CI relaxed ×3' : ''}; strict target 1000 ms)`,
    )
  })

  it('audit replay returns the full log in the canonical audit total order, deterministically', () => {
    const once = collectAllEvents(built.store, built.workstreams, 'audit')
    expect(once.length).toBe(COUNT)

    // Order check: the result must EQUAL an independent re-sort of the same
    // records through the WP-2.2 auditOrder total order (eventSeq, owner, id).
    const reference = auditOrder(once).map((e) => e.eventId)
    expect(once.map((e) => e.eventId)).toEqual(reference)

    // Late registrations stay at their REGISTRATION positions (audit tail
    // per workstream), not their time positions — the dual-timeline contract.
    const lateIds = new Set(
      ds.events
        .map((e, i) => (i % 53 === 11 ? e.eventId : null))
        .filter((id): id is string => id !== null),
    )
    const lateInOrder = once.filter((e) => lateIds.has(e.eventId)).map((e) => e.eventId)
    expect(lateInOrder.length).toBe(ds.lateCount)

    // Determinism: a second full replay is byte-identical (same event id
    // sequence — TC-HIST-005 replay idempotency at the query surface).
    const twice = collectAllEvents(built.store, built.workstreams, 'audit')
    expect(twice.map((e) => e.eventId)).toEqual(once.map((e) => e.eventId))
  })
})
