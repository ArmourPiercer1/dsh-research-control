/**
 * WP-3.2 — the §5 stale-detection algorithm, PURE branches (no git, no fs):
 *
 *   `stale(PF) ⇔ currentClosure(WS) ≠ PF.base_plan_objects`  # (path, oid) 集合不相等
 *
 * 全分支钉死: 相等（含顺序无关）/ added / removed / oid_changed / missing
 * (base+current / current-only) / 多差异顺序 (current 序 → base 序) / 重复
 * 路径 (集合语义 first-wins) / 空集合两端 + `formatStaleReason` 首个差异
 * 原文口径 (path + old/new oid) + `closurePathsLenient` 宽松闭包推导 +
 * `mapWithConcurrency` 池语义 (max-in-flight / 顺序 / 错误传播).
 */
import { describe, expect, it } from 'vitest'
import {
  closurePathsLenient,
  compareClosureBases,
  formatStaleReason,
  mapWithConcurrency,
  type CurrentClosureEntry,
} from '../../src/host/service/stale/index.js'
import type { ClosureDiffEntry } from '../../src/host/service/stale/index.js'
import type { BasePlanObject } from '../../src/host/domain/planfork/index.js'

const P = 'topics/TPC-1/workstreams/WS-1'
const plan = `${P}/plan.yaml`
const t1 = `${P}/items/tasks/T-1.yaml`
const t2 = `${P}/items/tasks/T-2.yaml`
const t3 = `${P}/items/tasks/T-3.yaml`
const m1 = `${P}/items/milestones/M-1.yaml`

const oid = (c: string): string => c.repeat(40)

const base = (paths: Array<[string, string]>): BasePlanObject[] => paths.map(([path, git_blob_oid]) => ({ path, git_blob_oid }))
const cur = (entries: Array<[string, string | null]>): CurrentClosureEntry[] => entries.map(([path, o]) => ({ path, oid: o }))

describe('compareClosureBases — §5 集合比较全分支', () => {
  it('equal sets ⇒ no diff (not stale)', () => {
    const b = base([[plan, oid('a')], [t1, oid('b')], [t2, oid('c')]])
    expect(compareClosureBases(b, cur([[plan, oid('a')], [t1, oid('b')], [t2, oid('c')]]))).toEqual([])
  })

  it('set semantics: element ORDER is irrelevant (a reorder is NOT a path-set change)', () => {
    const b = base([[plan, oid('a')], [t1, oid('b')], [t2, oid('c')]])
    const reordered = cur([[t2, oid('c')], [plan, oid('a')], [t1, oid('b')]])
    expect(compareClosureBases(b, reordered)).toEqual([])
  })

  it('single oid_changed ⇒ one entry with both OIDs', () => {
    const b = base([[plan, oid('a')], [t1, oid('b')], [t2, oid('c')]])
    const c = cur([[plan, oid('a')], [t1, oid('B')], [t2, oid('c')]])
    expect(compareClosureBases(b, c)).toEqual([
      { path: t1, kind: 'oid_changed', base_oid: oid('b'), current_oid: oid('B') },
    ])
  })

  it('added path (current-only, on disk) ⇒ kind added, base_oid null', () => {
    const b = base([[plan, oid('a')], [t1, oid('b')]])
    const c = cur([[plan, oid('a')], [t1, oid('b')], [t2, oid('new')]])
    expect(compareClosureBases(b, c)).toEqual([
      { path: t2, kind: 'added', base_oid: null, current_oid: oid('new') },
    ])
  })

  it('removed path (base-only) ⇒ kind removed, current_oid null', () => {
    const b = base([[plan, oid('a')], [t1, oid('b')], [t2, oid('c')]])
    const c = cur([[plan, oid('a')], [t1, oid('b')]])
    expect(compareClosureBases(b, c)).toEqual([
      { path: t2, kind: 'removed', base_oid: oid('c'), current_oid: null },
    ])
  })

  it('missing file in both sets (on-disk check failed) ⇒ kind missing, base_oid set, current_oid null', () => {
    const b = base([[plan, oid('a')], [t2, oid('c')]])
    const c = cur([[plan, oid('a')], [t2, null]])
    expect(compareClosureBases(b, c)).toEqual([
      { path: t2, kind: 'missing', base_oid: oid('c'), current_oid: null },
    ])
  })

  it('missing file in current set only (planned but never written) ⇒ kind missing, both null', () => {
    const b = base([[plan, oid('a')]])
    const c = cur([[plan, oid('a')], [t3, null]])
    expect(compareClosureBases(b, c)).toEqual([
      { path: t3, kind: 'missing', base_oid: null, current_oid: null },
    ])
  })

  it('combined differences ⇒ deterministic order: current-set order first, then base-set order for removed', () => {
    // base: plan, t1, t2, t3 ; current: plan(changed), t1(unchanged), t2(missing), t4(added) ; t3 removed
    const b = base([[plan, oid('p0')], [t1, oid('b')], [t2, oid('c')], [t3, oid('d')]])
    const c = cur([
      [plan, oid('p1')],
      [t1, oid('b')],
      [t2, null],
      [`${P}/items/tasks/T-4.yaml`, oid('n')],
    ])
    expect(compareClosureBases(b, c)).toEqual([
      { path: plan, kind: 'oid_changed', base_oid: oid('p0'), current_oid: oid('p1') },
      { path: t2, kind: 'missing', base_oid: oid('c'), current_oid: null },
      { path: `${P}/items/tasks/T-4.yaml`, kind: 'added', base_oid: null, current_oid: oid('n') },
      { path: t3, kind: 'removed', base_oid: oid('d'), current_oid: null },
    ])
  })

  it('empty base vs non-empty current ⇒ everything added; non-empty base vs empty current ⇒ everything removed', () => {
    const b = base([[plan, oid('a')], [t1, oid('b')]])
    expect(compareClosureBases(b, cur([]))).toEqual([
      { path: plan, kind: 'removed', base_oid: oid('a'), current_oid: null },
      { path: t1, kind: 'removed', base_oid: oid('b'), current_oid: null },
    ])
    expect(compareClosureBases([], cur([[plan, oid('a')], [t1, null]]))).toEqual([
      { path: plan, kind: 'added', base_oid: null, current_oid: oid('a') },
      { path: t1, kind: 'missing', base_oid: null, current_oid: null },
    ])
  })

  it('both empty ⇒ equal (no diff)', () => {
    expect(compareClosureBases([], cur([]))).toEqual([])
  })

  it('duplicate paths on either side are set elements (first occurrence wins)', () => {
    const b = base([[plan, oid('a')], [t1, oid('b')], [t1, oid('X')]]) // base duplicate: first wins
    const c = cur([[plan, oid('a')], [t1, oid('b')], [t1, oid('b')]]) // current duplicate: consistent
    expect(compareClosureBases(b, c)).toEqual([])
    const c2 = cur([[plan, oid('a')], [t1, oid('Y')], [t1, oid('b')]]) // current duplicate, first (Y) differs
    expect(compareClosureBases(b, c2)).toEqual([
      { path: t1, kind: 'oid_changed', base_oid: oid('b'), current_oid: oid('Y') },
    ])
  })
})

describe('formatStaleReason — §5 首个差异 (path + old/new oid)', () => {
  it('oid_changed triple', () => {
    const diff: ClosureDiffEntry[] = [
      { path: t2, kind: 'oid_changed', base_oid: oid('old'), current_oid: oid('new') },
    ]
    expect(formatStaleReason(diff)).toBe(`path=${t2}; base_oid=${oid('old')}; current_oid=${oid('new')}`)
  })

  it('added / removed / missing sentinels (absent / missing)', () => {
    expect(
      formatStaleReason([{ path: t3, kind: 'added', base_oid: null, current_oid: oid('n') }]),
    ).toBe(`path=${t3}; base_oid=absent; current_oid=${oid('n')}`)
    expect(
      formatStaleReason([{ path: t2, kind: 'removed', base_oid: oid('c'), current_oid: null }]),
    ).toBe(`path=${t2}; base_oid=${oid('c')}; current_oid=absent`)
    expect(
      formatStaleReason([{ path: t2, kind: 'missing', base_oid: oid('c'), current_oid: null }]),
    ).toBe(`path=${t2}; base_oid=${oid('c')}; current_oid=missing`)
    expect(
      formatStaleReason([{ path: t3, kind: 'missing', base_oid: null, current_oid: null }]),
    ).toBe(`path=${t3}; base_oid=absent; current_oid=missing`)
  })

  it('takes the FIRST diff (the stable-order head)', () => {
    const diff: ClosureDiffEntry[] = [
      { path: plan, kind: 'oid_changed', base_oid: oid('a'), current_oid: oid('b') },
      { path: t2, kind: 'missing', base_oid: oid('c'), current_oid: null },
    ]
    expect(formatStaleReason(diff)).toContain(`path=${plan}`)
    expect(formatStaleReason(diff)).not.toContain(`path=${t2}`)
  })

  it('throws on an empty diff (no stale reason exists)', () => {
    expect(() => formatStaleReason([])).toThrowError(/diff is empty/)
  })
})

describe('closurePathsLenient — §3.1 closure 的宽松推导 (stale 重检面)', () => {
  it('well-formed canonical order ⇒ plan.yaml first + definition files in order (deduplicated)', () => {
    expect(closurePathsLenient(P, ['G-1', 'T-1', 'T-1', 'M-1'])).toEqual([
      `${P}/plan.yaml`,
      `${P}/items/gates/G-1.yaml`,
      `${P}/items/tasks/T-1.yaml`,
      `${P}/items/milestones/M-1.yaml`,
    ])
  })

  it('empty ordered_items ⇒ plan.yaml only', () => {
    expect(closurePathsLenient(P, [])).toEqual([`${P}/plan.yaml`])
  })

  it('malformed / non-T-G-M elements are skipped (the plan is already inconsistent)', () => {
    expect(closurePathsLenient(P, ['T-1', 'garbage', 'OBJ-1', 'x-9', 'G-2'])).toEqual([
      `${P}/plan.yaml`,
      `${P}/items/tasks/T-1.yaml`,
      `${P}/items/gates/G-2.yaml`,
    ])
  })

  it('trailing slash on wsDir is normalized', () => {
    expect(closurePathsLenient(`${P}/`, ['T-1'])).toEqual([`${P}/plan.yaml`, `${P}/items/tasks/T-1.yaml`])
  })
})

describe('mapWithConcurrency — 有界并发池语义 (batch 的编排层落地)', () => {
  it('preserves input order', async () => {
    const out = await mapWithConcurrency(['a', 'b', 'c', 'd'], 3, async (x) => x.toUpperCase())
    expect(out).toEqual(['A', 'B', 'C', 'D'])
  })

  it('never exceeds the in-flight limit (max concurrency)', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const items = Array.from({ length: 50 }, (_, i) => i)
    await mapWithConcurrency(items, 7, async (i) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, 1 + (i % 3)))
      inFlight--
    })
    expect(maxInFlight).toBeLessThanOrEqual(7)
    expect(maxInFlight).toBeGreaterThan(1) // actually parallel
  })

  it('handles empty input and limit > length', async () => {
    expect(await mapWithConcurrency([], 4, async (x: number) => x)).toEqual([])
    expect(await mapWithConcurrency([1, 2], 10, async (x) => x * 2)).toEqual([2, 4])
  })

  it('propagates the first failure (fail-fast), result promise rejects', async () => {
    const p = mapWithConcurrency([1, 2, 3], 2, async (x) => {
      if (x === 2) throw new Error('boom-2')
      return x
    })
    await expect(p).rejects.toThrowError('boom-2')
  })

  it('limit 1 = strictly serial', async () => {
    let inFlight = 0
    let maxInFlight = 0
    await mapWithConcurrency([1, 2, 3, 4], 1, async (x) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, 1))
      inFlight--
      return x
    })
    expect(maxInFlight).toBe(1)
  })
})
