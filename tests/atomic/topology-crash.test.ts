/**
 * WP-1.7 — TC-DB-001 (G1 必过集): 「写入中途 kill -> 文件为旧版或新版，绝无半写」
 * — the TOPOLOGY write path (`topics/<t>/topology.yaml` via WP-1.4
 * `atomicWrite`: `<path>.dshrc-tmp` full write → rename → best-effort unlink
 * on a failed rename), verified on a REAL filesystem with kill -9 injected at
 * every protocol step. The merge-contract path (`merges/<TE>/contract.md`)
 * shares the same `atomicWrite` and is covered with the same matrix.
 *
 * Per kill point the asserts are:
 *   1. the target file is byte-for-byte the COMPLETE old version or the
 *      COMPLETE new version — never a half-write, never an empty file;
 *   2. the tmp file's on-disk state matches the fault point (absent /
 *      partial bytes / full new version);
 *   3. NO other file in the tree changed (no collateral half-write);
 *   4. restart (fresh store + fresh real-fs io over the SAME real disk):
 *      load is clean and consistent with the target's version;
 *   5. the next operation tolerates a residual tmp (deterministic tmp name —
 *      overwritten by the next write, then renamed away);
 *   6. a kill after a SUCCESSFUL rename leaves the NEW version, reloadable
 *      (the success path has no cleanup step — the swap is the last step).
 *
 * Real-fs rationale: tmp+rename POSIX semantics (rename durability, partial
 * bytes observable on disk) cannot be verified with an in-memory fake — see
 * tests/topology/atomic-write.test.ts for the in-memory protocol-level suite.
 */
import { join } from 'node:path'

import { beforeAll, describe, expect, it } from 'vitest'

import {
  CONTRACT_MD,
  TOPOLOGY_YAML,
} from '../loader/fixtures.js'
import {
  MergeContractStore,
  TMP_FILE_SUFFIX,
  TopologyStore,
  TopologyStoreError,
  type TopologyFileIo,
} from '../../src/host/domain/topology/index.js'
import {
  CrashTopologyIo,
  makeScratchTree,
  ProcessKilledError,
  RealFsTopologyIo,
  probeFile,
  walkFiles,
  type KillPoint,
  type ScratchTree,
} from './crash-fs.js'

const WORKSTREAMS = ['WS-1', 'WS-2', 'WS-3'] as const
const TOPIC_REL = 'topics/TPC-1/topology.yaml'
const CONTRACT_REL = 'merges/TE-2/contract.md'
const NEW_CONTRACT = `${CONTRACT_MD}\n- 追加条款（崩溃测试新版）: 期望产物新增 docs/crash-note.md\n`

function topoStore(io: TopologyFileIo, t: ScratchTree): TopologyStore {
  return new TopologyStore({ io, researchRoot: t.researchRoot, schemaDir: t.schemaDir, topicId: 'TPC-1', workstreams: WORKSTREAMS })
}

function contractStore(io: TopologyFileIo, t: ScratchTree): MergeContractStore {
  return new MergeContractStore({ io, researchRoot: t.researchRoot, edgeIds: ['TE-1', 'TE-2'] })
}

/** The complete NEW topology bytes: the same operation run cleanly on a sibling scratch tree (deterministic serialization). */
function goldenTopology(): string {
  const t = makeScratchTree()
  try {
    topoStore(new RealFsTopologyIo(), t).addEdge({ id: 'TE-3', operation: 'FORK', inputs: ['WS-1'], outputs: ['WS-2'] })
    return probeFile(join(t.researchRoot, TOPIC_REL)).content
  } finally {
    t.cleanup()
  }
}

/** The kill matrix: fault point → expected target version / tmp state. */
const POINTS: ReadonlyArray<{ point: KillPoint; label: string; target: 'old' | 'new'; tmp: 'absent' | 'partial' | 'full' }> = [
  { point: 'before-tmp-write', label: 'tmp 写前', target: 'old', tmp: 'absent' },
  { point: 'mid-tmp-write', label: 'tmp 写中（部分字节后 kill）', target: 'old', tmp: 'partial' },
  { point: 'before-rename', label: 'tmp 写后 rename 前', target: 'old', tmp: 'full' },
  { point: 'after-rename', label: 'rename 后（成功路径，无清理步骤）', target: 'new', tmp: 'absent' },
  { point: 'cleanup', label: 'rename 失败后清理前', target: 'old', tmp: 'full' },
]

const OLD_EDGE_IDS = ['TE-1', 'TE-2']
const NEW_EDGE_IDS = ['TE-1', 'TE-2', 'TE-3']

describe('TC-DB-001 topology.yaml — kill -9 at every atomicWrite step (real fs)', () => {
  let golden: string

  beforeAll(() => {
    golden = goldenTopology()
  })

  for (const { point, label, target, tmp } of POINTS) {
    it(`kill at ${label}: 目标恒为完整旧版/完整新版，绝无半写，重启可 load`, () => {
      const t = makeScratchTree()
      try {
        const io = new CrashTopologyIo({ killAt: point })
        let thrown: unknown = null
        try {
          topoStore(io, t).addEdge({ id: 'TE-3', operation: 'FORK', inputs: ['WS-1'], outputs: ['WS-2'] })
        } catch (error) {
          thrown = error
        }
        // The dying process surfaces the failure as a WRITE error (kill -9:
        // no cleanup, no state change beyond what already hit the disk).
        expect(thrown).toBeInstanceOf(TopologyStoreError)
        expect((thrown as TopologyStoreError).code).toBe('WRITE')
        expect(io.isDead).toBe(true)

        const targetAbs = join(t.researchRoot, TOPIC_REL)
        const tmpAbs = targetAbs + TMP_FILE_SUFFIX
        const tState = probeFile(targetAbs)
        const tmpState = probeFile(tmpAbs)

        // 1) the target is byte-for-byte the complete old or new version
        const expectedContent = target === 'new' ? golden : TOPOLOGY_YAML
        expect(tState.exists).toBe(true)
        expect(tState.content).toBe(expectedContent)
        expect(tState.size).toBe(Buffer.byteLength(expectedContent, 'utf8'))

        // 2) the tmp state matches the fault point (real disk)
        if (tmp === 'absent') {
          expect(tmpState.exists).toBe(false)
        } else if (tmp === 'partial') {
          const full = Buffer.byteLength(golden, 'utf8')
          expect(tmpState.exists).toBe(true)
          expect(tmpState.size).toBeGreaterThan(0)
          expect(tmpState.size).toBeLessThan(full) // PARTIAL — a half-written tmp, target untouched
        } else {
          expect(tmpState.exists).toBe(true)
          expect(tmpState.content).toBe(golden) // the complete new version sits in the tmp only
        }

        // 3) nothing else in the tree changed (no collateral half-write)
        const now = walkFiles(t.researchRoot)
        for (const [rel, content] of Object.entries(t.seeded)) {
          if (rel === TOPIC_REL) continue
          expect(now[rel], `unexpected change at ${rel}`).toBe(content)
        }
        expect(
          Object.keys(now).filter((rel) => !(rel in t.seeded) && rel !== TOPIC_REL && rel !== `${TOPIC_REL}${TMP_FILE_SUFFIX}`),
        ).toEqual([])

        // 4) restart: a fresh process over the same real disk loads cleanly
        const store2 = topoStore(new RealFsTopologyIo(), t)
        if (target === 'new') {
          // 6) kill after a successful rename: NEW version, reloadable
          expect(store2.load().topology.edges.map((e) => e.id)).toEqual(NEW_EDGE_IDS)
          expect(probeFile(targetAbs).content).toBe(golden)
          expect(probeFile(tmpAbs).exists).toBe(false)
        } else {
          expect(store2.load().topology.edges.map((e) => e.id)).toEqual(OLD_EDGE_IDS)
          // 5) the NEXT operation tolerates the residual tmp (deterministic
          //    tmp name is overwritten + renamed away) and completes the write
          store2.addEdge({ id: 'TE-3', operation: 'FORK', inputs: ['WS-1'], outputs: ['WS-2'] })
          expect(probeFile(targetAbs).content).toBe(golden)
          expect(probeFile(tmpAbs).exists).toBe(false)
          expect(topoStore(new RealFsTopologyIo(), t).load().topology.edges.map((e) => e.id)).toEqual(NEW_EDGE_IDS)
        }
      } finally {
        t.cleanup()
      }
    })
  }
})

describe('TC-DB-001 merges/<TE>/contract.md — same atomicWrite protocol (real fs)', () => {
  for (const { point, label, target, tmp } of POINTS) {
    it(`kill at ${label}: contract 恒为完整旧版/完整新版，绝无半写`, () => {
      const t = makeScratchTree()
      try {
        const io = new CrashTopologyIo({ killAt: point })
        let thrown: unknown = null
        try {
          contractStore(io, t).writeContract('TE-2', NEW_CONTRACT)
        } catch (error) {
          thrown = error
        }
        expect(thrown).toBeInstanceOf(TopologyStoreError)
        expect((thrown as TopologyStoreError).code).toBe('WRITE')
        expect(io.isDead).toBe(true)

        const targetAbs = join(t.researchRoot, CONTRACT_REL)
        const tmpAbs = targetAbs + TMP_FILE_SUFFIX
        const tState = probeFile(targetAbs)
        const tmpState = probeFile(tmpAbs)

        const expectedContent = target === 'new' ? NEW_CONTRACT : CONTRACT_MD
        expect(tState.exists).toBe(true)
        expect(tState.content).toBe(expectedContent)

        if (tmp === 'absent') {
          expect(tmpState.exists).toBe(false)
        } else if (tmp === 'partial') {
          expect(tmpState.exists).toBe(true)
          expect(tmpState.size).toBeGreaterThan(0)
          expect(tmpState.size).toBeLessThan(Buffer.byteLength(NEW_CONTRACT, 'utf8'))
        } else {
          expect(tmpState.exists).toBe(true)
          expect(tmpState.content).toBe(NEW_CONTRACT)
        }

        // restart: load/read clean + residual tmp tolerated by the next write
        const store2 = contractStore(new RealFsTopologyIo(), t)
        expect(store2.readContract('TE-2')).toBe(expectedContent)
        if (target === 'old') {
          store2.writeContract('TE-2', NEW_CONTRACT)
          expect(probeFile(targetAbs).content).toBe(NEW_CONTRACT)
          expect(probeFile(tmpAbs).exists).toBe(false)
        }
      } finally {
        t.cleanup()
      }
    })
  }
})

describe('kill -9 semantics of the crash double (post-mortem I/O)', () => {
  it('after the kill, EVERY subsequent call on the same io throws ProcessKilledError (no cleanup, no state change)', () => {
    const t = makeScratchTree()
    try {
      const io = new CrashTopologyIo({ killAt: 'mid-tmp-write' })
      const targetAbs = join(t.researchRoot, TOPIC_REL)
      const before = probeFile(targetAbs)
      let thrown: unknown = null
      try {
        topoStore(io, t).addEdge({ id: 'TE-3', operation: 'FORK', inputs: ['WS-1'], outputs: ['WS-2'] })
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(TopologyStoreError)
      expect((thrown as TopologyStoreError).code).toBe('WRITE')
      expect(io.isDead).toBe(true)
      // post-mortem: the dying process cannot do ANY further I/O
      expect(() => io.readFile(targetAbs)).toThrow(ProcessKilledError)
      expect(() => io.writeFile(targetAbs, 'x')).toThrow(ProcessKilledError)
      expect(() => io.rename(targetAbs, targetAbs)).toThrow(ProcessKilledError)
      expect(() => io.unlink(targetAbs)).toThrow(ProcessKilledError)
      // …and the on-disk state froze exactly where the kill landed
      expect(probeFile(targetAbs).content).toBe(before.content)
    } finally {
      t.cleanup()
    }
  })
})
