/**
 * WP-6.2 — snapshot codec (operational KV) + incremental diff
 * (snapshot.ts). 钉: 首扫语义（firstScan）/ 路径级集合差分（新增/消失,
 * 不含内容 — Git 拥有文件版本）/ 解码 fail-loud（损坏基线不静默重置）/
 * 确定性（输入无序 → 输出有序）.
 */

import { describe, expect, it } from 'vitest'

import {
  buildSnapshot,
  decodeSnapshot,
  DiscoverySnapshotError,
  diffSnapshots,
  encodeSnapshot,
  SNAPSHOT_KEY,
  SNAPSHOT_VERSION,
} from '../../src/host/audit/discovery/index.js'
import type { DiscoverySnapshot } from '../../src/host/audit/discovery/index.js'

const T0 = 1_700_000_000_000

describe('snapshot codec (KV document)', () => {
  it('SNAPSHOT_KEY is the single operational-KV key (stable constant)', () => {
    expect(SNAPSHOT_KEY).toBe('discovery.scan-snapshot.v1')
    expect(SNAPSHOT_VERSION).toBe(1)
  })

  it('encode → decode round-trips (paths normalized to sorted)', () => {
    const s = buildSnapshot(['b/x', 'a/y', 'a/y'], T0)
    expect(s.paths).toEqual(['a/y', 'b/x'])
    const decoded = decodeSnapshot(encodeSnapshot(s))
    expect(decoded).toEqual(s)
  })

  it('encoding is canonical (same snapshot → same bytes, order-independent input)', () => {
    const a = encodeSnapshot(buildSnapshot(['a', 'b', 'c'], T0))
    const b = encodeSnapshot(buildSnapshot(['c', 'a', 'b'], T0))
    expect(a).toBe(b)
    expect(a).toBe(JSON.stringify({ v: 1, capturedAt: T0, paths: ['a', 'b', 'c'] }))
  })

  it('decode rejects every corruption shape (fail loud — never silently reset)', () => {
    const bad = [
      'not json',
      'null',
      '[]',
      '"str"',
      JSON.stringify({ v: 2, capturedAt: T0, paths: [] }),
      JSON.stringify({ v: 1, capturedAt: T0 }),
      JSON.stringify({ v: 1, capturedAt: T0, paths: 'nope' }),
      JSON.stringify({ v: 1, capturedAt: T0, paths: [1] }),
      JSON.stringify({ v: 1, capturedAt: T0, paths: [''] }),
      JSON.stringify({ v: 1, capturedAt: T0, paths: ['/abs'] }),
      JSON.stringify({ v: 1, capturedAt: T0, paths: ['a/../b'] }),
      JSON.stringify({ v: 1, capturedAt: T0, paths: ['a', 'a'] }),
      JSON.stringify({ v: 1, capturedAt: 1.5, paths: [] }),
      JSON.stringify({ v: 1, capturedAt: -1, paths: [] }),
      JSON.stringify({ v: 1, capturedAt: Number.MAX_SAFE_INTEGER + 1, paths: [] }),
    ]
    for (const raw of bad) {
      expect(() => decodeSnapshot(raw), `raw=${raw}`).toThrow(DiscoverySnapshotError)
    }
  })

  it('decode re-sorts a hand-edited (unsorted) stored order', () => {
    const decoded = decodeSnapshot(JSON.stringify({ v: 1, capturedAt: T0, paths: ['z', 'a', 'm'] }))
    expect(decoded.paths).toEqual(['a', 'm', 'z'])
  })

  it('error carries the stable code', () => {
    try {
      decodeSnapshot('nope')
      expect.unreachable()
    } catch (e) {
      expect((e as DiscoverySnapshotError).code).toBe('DISC_SNAPSHOT_CORRUPT')
    }
  })
})

describe('diffSnapshots (新增/消失 — path-level set difference)', () => {
  const prev: DiscoverySnapshot = { v: 1, capturedAt: T0, paths: ['a', 'b', 'c'] }

  it('first scan: prev=null → everything added, nothing removed, firstScan=true', () => {
    const d = diffSnapshots(null, ['x', 'y'])
    expect(d).toEqual({ firstScan: true, added: ['x', 'y'], removed: [], unchanged: [] })
  })

  it('first scan with an empty current set', () => {
    const d = diffSnapshots(null, [])
    expect(d).toEqual({ firstScan: true, added: [], removed: [], unchanged: [] })
  })

  it('steady state: no change → all unchanged', () => {
    const d = diffSnapshots(prev, ['b', 'a', 'c'])
    expect(d).toEqual({ firstScan: false, added: [], removed: [], unchanged: ['a', 'b', 'c'] })
  })

  it('additions + removals together (order-independent inputs)', () => {
    const d = diffSnapshots(prev, ['c', 'z', 'z', 'a', 'new1', 'new2'])
    expect(d).toEqual({
      firstScan: false,
      added: ['new1', 'new2', 'z'],
      removed: ['b'],
      unchanged: ['a', 'c'],
    })
  })

  it('total wipe: current empty → everything removed', () => {
    const d = diffSnapshots(prev, [])
    expect(d).toEqual({ firstScan: false, added: [], removed: ['a', 'b', 'c'], unchanged: [] })
  })

  it('duplicate current paths collapse (set semantics)', () => {
    const d = diffSnapshots(prev, ['a', 'a', 'a'])
    expect(d.unchanged).toEqual(['a'])
    expect(d.added).toEqual([])
  })

  it('output is always sorted (deterministic regardless of input order)', () => {
    const d1 = diffSnapshots(prev, ['c', 'a', 'b'])
    const d2 = diffSnapshots(prev, ['b', 'c', 'a'])
    expect(d1).toEqual(d2)
    for (const list of [d1.added, d1.removed, d1.unchanged]) {
      expect(list).toEqual([...list].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)))
    }
  })
})
