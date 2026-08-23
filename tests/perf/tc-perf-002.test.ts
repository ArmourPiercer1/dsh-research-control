/**
 * WP-2.8 / WP-8.2 — TC-PERF-002: 10k 事件 audit replay 同量级 (< 1s) +
 * derived_state 重建（catalog §6 L279）覆盖 + 热点计时.
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
 *
 * WP-8.2 补强（任务书: derived_state 满）: 在**生产重建路径**
 * `rebuildDerivedState`（WP-2.3: audit 序 collectAllEvents + foldEvents +
 * derived_state 独立写事务）上以 catalog §6 全表 reducer
 * (tests/perf/derived-reducer.ts) 重放 10k 流，断言：
 *  - 「derived_state 满」= 重建后**每个**派生缓存 object kind（catalog §6
 *    表: RUN/TASK/GATE/MILESTONE/FACT/CLAIM/ARTIFACT/RELATION/INTERVENTION/
 *    TOPOLOGY_EDGE/WORKSTREAM）都有派生行 — 数据集覆盖 §6 全表；
 *  - 表往返一致（`readDerivedState` 读回 = 重建结果，canonical JSON 等价）；
 *  - fold 热点计时（apply:false，3 次中位）与写事务计时（apply:true，单次）
 *    分开记录 — 热点分析入 profile 报告（诚实标注: fold 中 flat-Map 逐事件
 *    复制是**测试侧 reducer 自身成本**；生产增量路径是 appendEvents ④ 的
 *    O(1) 派生补丁，不走全量 fold）。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { auditOrder } from '../../src/host/history/registry/index.js'
import { collectAllEvents } from '../../src/host/history/replay/index.js'
import { rebuildDerivedState, readDerivedState } from '../../src/host/history/replay/rebuild.js'
import { canonicalJson } from '../../src/host/history/replay/state-map.js'
import { catalogSection6Reducer, DERIVED_OBJECT_KINDS } from './derived-reducer.js'
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

describe.runIf(PERF_ENABLED)('TC-PERF-002: 10k audit replay < 1s (same magnitude as semantic) + derived_state full', () => {
  let ds: PerfDataset
  let built: BuiltStore
  let dir: string

  beforeAll(() => {
    dir = makePerfTempDir('wp82-tc002-')
    ds = generatePerfDataset({ count: COUNT, seed: 0x5eed })
    built = buildPerfStore(dir, ds.events, ds.workstreams)
  })

  afterAll(() => {
    built?.store.close()
  })

  it('full audit-order replay over the 10k full-spectrum set < 1s (CI: relaxed ×3)', () => {
    const limitMs = 1_000 * PERF_RELAX
    const t = measure(() => collectAllEvents(built.store, built.workstreams, 'audit'))
    expect(t.medianMs).toBeLessThan(limitMs)
    console.log(
      `[TC-PERF-002] audit replay ${ds.events.length} rows: ${fmtTiming(t)} ` +
        `(pass line ${limitMs} ms${PERF_RELAX > 1 ? ' — CI relaxed ×3' : ''}; strict target 1000 ms)`,
    )
  })

  it('audit replay returns the full log in the canonical audit total order, deterministically', () => {
    const once = collectAllEvents(built.store, built.workstreams, 'audit')
    expect(once.length).toBe(ds.events.length)

    // Order check: the result must EQUAL an independent re-sort of the same
    // records through the WP-2.2 auditOrder total order (eventSeq, owner, id).
    const reference = auditOrder(once).map((e) => e.eventId)
    expect(once.map((e) => e.eventId)).toEqual(reference)

    // Late registrations stay at their REGISTRATION positions (audit order),
    // not their time positions — the dual-timeline contract. The late ROW set
    // (WP-8.2: fan-out rows of a late slot are late too) comes from the
    // generator's own accounting, not a re-derived slot rule.
    const lateInOrder = once.filter((e) => ds.lateEventIds.has(e.eventId)).map((e) => e.eventId)
    expect(lateInOrder.length).toBe(ds.lateEventIds.size)
    expect(lateInOrder.length).toBeGreaterThan(0)

    // Determinism: a second full replay is byte-identical (same event id
    // sequence — TC-HIST-005 replay idempotency at the query surface).
    const twice = collectAllEvents(built.store, built.workstreams, 'audit')
    expect(twice.map((e) => e.eventId)).toEqual(once.map((e) => e.eventId))
  })

  it('derived_state rebuild (catalog §6, audit order) is FULL for all derived kinds + table round-trips', () => {
    // Hotspot ① — the FOLD (apply:false = pure in-memory rebuild, no write
    // transaction): median of 3 (the fold dominates rebuild cost; the write
    // is measured separately below). NOTE for the report: the per-event flat
    // Map copy is the TEST-SIDE §6 reducer's own cost (structural-sharing
    // production reducers, e.g. the WP-2.5 semantic reducer, avoid it).
    const tFold = measure(
      () => rebuildDerivedState(built.store, built.workstreams, catalogSection6Reducer, { apply: false }),
      3,
    )

    // The operational rebuild (apply:true — the derived_state table is
    // replaced wholesale in one independent transaction, WP-2.3 contract).
    const tWrite0 = performance.now()
    const result = rebuildDerivedState(built.store, built.workstreams, catalogSection6Reducer)
    const tWrite = performance.now() - tWrite0
    const { states, eventCount, replacedRows, applied } = result
    expect(applied).toBe(true)
    expect(eventCount).toBe(ds.events.length)

    // 「derived_state 满」(WP-8.2): EVERY catalog §6 derived-cache kind has
    // at least one rebuilt row — the 10k full-spectrum dataset exercises the
    // complete §6 table (run lifecycle incl. batch/failed/cancelled, task
    // execution/validation/AC, gate re-evaluation, terminal milestones,
    // semantic tags, artifacts, relations, interventions, topology realizes).
    const kinds = new Set<string>()
    for (const key of states.keys()) kinds.add(key.slice(0, key.indexOf(':')))
    for (const kind of DERIVED_OBJECT_KINDS) {
      expect(kinds.has(kind), `derived kind ${kind} missing from the rebuilt derived_state`).toBe(true)
    }
    console.log(
      `[TC-PERF-002] derived_state rebuild: ${states.size} rows across kinds ` +
        `[${[...kinds].sort().join(', ')}] (eventCount=${eventCount}, replacedRows=${replacedRows})`,
    )

    // Table round-trip: the live derived_state table (read via a readOnly
    // connection) must equal the rebuilt map — canonical-JSON equality per
    // row (key order inside a document does not count, state-map contract).
    const live = readDerivedState(built.store)
    expect(live.size).toBe(states.size)
    expect(replacedRows).toBe(states.size)
    for (const [key, value] of states) {
      expect(canonicalJson(live.get(key)), `derived_state[${key}] round-trip`).toBe(canonicalJson(value))
    }

    console.log(
      `[TC-PERF-002] rebuild hotspots: fold ${fmtTiming(tFold)} | write-tx once ${tWrite.toFixed(1)} ms ` +
        `(fold = test-side §6 reducer copy cost; production incremental path = O(1) appendEvents ④ patches)`,
    )
  })
})
