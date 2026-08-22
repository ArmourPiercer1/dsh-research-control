/**
 * WP-1.7 — TC-DB-001 (G1 必过集): 「写入中途 kill -> 文件为旧版或新版，绝无半写」
 * — the PLAN write paths, verified on a REAL filesystem with kill -9 injected
 * at every step of the `PlanFileWriter` atomic protocol (tmp+rename, the
 * documented real-fs contract of plan/types.ts):
 *
 *   1. `plan.yaml` — every mutation funnels through `savePlan` (one
 *      writeAtomic; operation under test: `moveItem`);
 *   2. G/T/M definition files — `createItem` (one writeAtomic, a NEW file:
 *      「old version」 = absent);
 *   3. `addItem` — the TWO-WRITE sequence (definition file FIRST, then
 *      plan.yaml; the safe partial order per plan-store.ts): a crash BETWEEN
 *      the two writes must still leave a LEGAL tree (the unlisted definition
 *      is retained per INV-PLAN-9).
 *
 * Per kill point the asserts are:
 *   1. every touched target is byte-for-byte the COMPLETE old version or the
 *      COMPLETE new version — never a half-write, never an empty file;
 *   2. the tmp state on the real disk matches the fault point
 *      (absent / partial bytes / full new version);
 *   3. NO other file in the tree changed (no collateral half-write);
 *   4. restart (fresh PlanStore + fresh real-fs ports over the SAME real
 *      disk): loadPlan is clean and consistent with the target's version;
 *   5. the next operation tolerates a residual tmp (deterministic tmp name —
 *      overwritten by the next write, then renamed away);
 *   6. a kill after a SUCCESSFUL rename leaves the NEW version, reloadable
 *      (the success path has no cleanup step — the swap is the last step).
 */
import { join } from 'node:path'

import { beforeAll, describe, expect, it } from 'vitest'

import { APPENDIX_A_PLAN_YAML } from '../loader/fixtures.js'
import { taskDoc } from '../plan/fixtures.js'
import type { ResearchFileReader } from '../../src/host/domain/loader/index.js'
import { PlanStore, type PlanFileWriter } from '../../src/host/domain/plan/index.js'
import {
  CrashPlanWriter,
  makeScratchTree,
  PLAN_TMP_SUFFIX,
  ProcessKilledError,
  RealFsPlanWriter,
  RealFsReader,
  probeFile,
  walkFiles,
  type KillPoint,
  type ScratchTree,
} from './crash-fs.js'

const PLAN_REL = 'topics/TPC-1/workstreams/WS-1/plan.yaml'
const T5_REL = 'topics/TPC-1/workstreams/WS-1/items/tasks/T-5.yaml'
const BASE_ITEMS = ['G-1', 'T-1', 'T-2', 'T-3', 'M-1', 'T-4', 'G-2'] as const
const MOVED_ITEMS = ['T-1', 'G-1', 'T-2', 'T-3', 'M-1', 'T-4', 'G-2'] as const

function planStore(reader: ResearchFileReader, writer: PlanFileWriter, t: ScratchTree): PlanStore {
  return new PlanStore({
    reader,
    writer,
    researchRoot: t.researchRoot,
    schemaDir: t.schemaDir,
    topicId: 'TPC-1',
    wsId: 'WS-1',
  })
}

/** Fresh "restarted process" ports (plain real fs, no injection). */
function freshPlanStore(t: ScratchTree): PlanStore {
  return planStore(new RealFsReader(), new RealFsPlanWriter(), t)
}

function goldenFor(t: ScratchTree, op: (store: PlanStore) => void, rel: string): string {
  op(planStore(new RealFsReader(), new RealFsPlanWriter(), t))
  return probeFile(join(t.researchRoot, rel)).content
}

const POINTS: ReadonlyArray<{ point: KillPoint; label: string; target: 'old' | 'new'; tmp: 'absent' | 'partial' | 'full' }> = [
  { point: 'before-tmp-write', label: 'tmp 写前', target: 'old', tmp: 'absent' },
  { point: 'mid-tmp-write', label: 'tmp 写中（部分字节后 kill）', target: 'old', tmp: 'partial' },
  { point: 'before-rename', label: 'tmp 写后 rename 前', target: 'old', tmp: 'full' },
  { point: 'after-rename', label: 'rename 后（成功路径，无清理步骤）', target: 'new', tmp: 'absent' },
  { point: 'cleanup', label: 'rename 失败后清理前', target: 'old', tmp: 'full' },
]

/** Run one store operation under the kill, return the (wrapped) thrown error. */
function runKilled(op: (store: PlanStore) => void, t: ScratchTree, point: KillPoint, writeNumber = 1): { thrown: unknown; writer: CrashPlanWriter } {
  const writer = new CrashPlanWriter({ killAt: point, writeNumber })
  let thrown: unknown = null
  try {
    op(planStore(new RealFsReader(), writer, t))
  } catch (error) {
    thrown = error
  }
  return { thrown, writer }
}

describe('TC-DB-001 plan.yaml — kill -9 at every writeAtomic step (real fs)', () => {
  let golden: string // complete NEW plan.yaml bytes (moveItem golden)

  beforeAll(() => {
    const t = makeScratchTree()
    try {
      golden = goldenFor(t, (s) => s.moveItem('T-1', 0), PLAN_REL)
    } finally {
      t.cleanup()
    }
  })

  for (const { point, label, target, tmp } of POINTS) {
    it(`kill at ${label}: plan.yaml 恒为完整旧版/完整新版，绝无半写，重启可 load`, () => {
      const t = makeScratchTree()
      try {
        const { thrown, writer } = runKilled((s) => s.moveItem('T-1', 0), t, point)
        // The dying process surfaces the failure as a WRITE error (kill -9:
        // no cleanup, no state change beyond what already hit the disk).
        expect(thrown).toBeInstanceOf(Error)
        expect((thrown as Error).message).toContain('process killed (kill -9 simulation)')
        expect(writer.isDead).toBe(true)

        const targetAbs = join(t.researchRoot, PLAN_REL)
        const tmpAbs = targetAbs + PLAN_TMP_SUFFIX
        const tState = probeFile(targetAbs)
        const tmpState = probeFile(tmpAbs)

        // 1) the target is byte-for-byte the complete old or new version
        const expectedContent = target === 'new' ? golden : APPENDIX_A_PLAN_YAML
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
        assertTreeUntouched(t, [PLAN_REL, `${PLAN_REL}${PLAN_TMP_SUFFIX}`])

        // 4) restart: a fresh process over the same real disk loads cleanly
        const store2 = freshPlanStore(t)
        if (target === 'new') {
          // 6) kill after a successful rename: NEW version, reloadable
          expect(store2.loadPlan().items).toEqual([...MOVED_ITEMS])
          expect(store2.loadPlan().errors).toEqual([])
        } else {
          expect(store2.loadPlan().items).toEqual([...BASE_ITEMS])
          expect(store2.loadPlan().errors).toEqual([])
          // 5) the NEXT operation tolerates the residual tmp (deterministic
          //    tmp name is overwritten + renamed away) and completes the write
          store2.moveItem('T-1', 0)
          expect(probeFile(targetAbs).content).toBe(golden)
          expect(probeFile(tmpAbs).exists).toBe(false)
          expect(freshPlanStore(t).loadPlan().items).toEqual([...MOVED_ITEMS])
        }
      } finally {
        t.cleanup()
      }
    })
  }
})

describe('TC-DB-001 G/T/M definition file — kill -9 at every writeAtomic step (real fs, NEW file)', () => {
  let golden: string // complete NEW definition file bytes (T-5)

  beforeAll(() => {
    const t = makeScratchTree()
    try {
      golden = goldenFor(t, (s) => s.createItem('task', taskDoc({ id: 'T-5' })), T5_REL)
    } finally {
      t.cleanup()
    }
  })

  for (const { point, label, target, tmp } of POINTS) {
    it(`kill at ${label}: 新定义文件 恒为「完整新版或不存在」，绝无半写/空文件`, () => {
      const t = makeScratchTree()
      try {
        const { thrown, writer } = runKilled((s) => s.createItem('task', taskDoc({ id: 'T-5' })), t, point)
        expect(thrown).toBeInstanceOf(Error)
        expect((thrown as Error).message).toContain('process killed (kill -9 simulation)')
        expect(writer.isDead).toBe(true)

        const targetAbs = join(t.researchRoot, T5_REL)
        const tmpAbs = targetAbs + PLAN_TMP_SUFFIX
        const tState = probeFile(targetAbs)
        const tmpState = probeFile(tmpAbs)

        // 1) creation target: the 「old version」 is ABSENT — the file is
        //    either absent or the complete new version (never partial/empty)
        if (target === 'new') {
          expect(tState.exists).toBe(true)
          expect(tState.content).toBe(golden)
          // reloadable by a fresh process
          const doc = freshPlanStore(t).readItem('task', 'T-5')
          expect(doc.id).toBe('T-5')
        } else {
          expect(tState.exists).toBe(false) // NO partial/empty file at the target
        }

        // 2) the tmp state matches the fault point (real disk)
        if (tmp === 'absent') {
          expect(tmpState.exists).toBe(false)
        } else if (tmp === 'partial') {
          const full = Buffer.byteLength(golden, 'utf8')
          expect(tmpState.exists).toBe(true)
          expect(tmpState.size).toBeGreaterThan(0)
          expect(tmpState.size).toBeLessThan(full)
        } else {
          expect(tmpState.exists).toBe(true)
          expect(tmpState.content).toBe(golden)
        }

        // 3) nothing else in the tree changed (no collateral half-write)
        assertTreeUntouched(t, [T5_REL, `${T5_REL}${PLAN_TMP_SUFFIX}`])

        // 4) restart: plan.yaml load stays clean (the new def is unlisted —
        //    a legal state, INV-PLAN-9)
        const store2 = freshPlanStore(t)
        expect(store2.loadPlan().items).toEqual([...BASE_ITEMS])
        expect(store2.loadPlan().errors).toEqual([])
        if (target === 'new') {
          // the rename consumed the tmp — nothing residual to tolerate; the
          // completed file is already reloadable (asserted above)
          expect(probeFile(tmpAbs).exists).toBe(false)
        } else {
          // 5) the NEXT createItem tolerates the residual tmp (deterministic
          //    tmp name is overwritten + renamed away) and completes
          store2.createItem('task', taskDoc({ id: 'T-5' }))
          expect(probeFile(targetAbs).content).toBe(golden)
          expect(probeFile(tmpAbs).exists).toBe(false)
          expect(freshPlanStore(t).readItem('task', 'T-5').id).toBe('T-5')
        }
      } finally {
        t.cleanup()
      }
    })
  }
})

describe('TC-DB-001 addItem — the TWO-WRITE sequence (def file, then plan.yaml; crash BETWEEN writes)', () => {
  let goldenDef: string // complete NEW definition file bytes (T-5)
  let goldenPlan: string // complete NEW plan.yaml bytes (T-5 appended at tail)

  beforeAll(() => {
    const t = makeScratchTree()
    try {
      goldenDef = goldenFor(t, (s) => s.addItem('task', taskDoc({ id: 'T-5' })), T5_REL)
      goldenPlan = probeFile(join(t.researchRoot, PLAN_REL)).content
    } finally {
      t.cleanup()
    }
  })

  for (const { point, label, target, tmp } of POINTS) {
    it(`kill at ${label} (第 2 次写): 两文件各自 恒为完整旧版/完整新版，中间态合法`, () => {
      const t = makeScratchTree()
      try {
        const { thrown, writer } = runKilled((s) => s.addItem('task', taskDoc({ id: 'T-5' })), t, point, 2)
        expect(thrown).toBeInstanceOf(Error)
        expect((thrown as Error).message).toContain('process killed (kill -9 simulation)')
        expect(writer.isDead).toBe(true)

        const defAbs = join(t.researchRoot, T5_REL)
        const planAbs = join(t.researchRoot, PLAN_REL)
        const planTmpAbs = planAbs + PLAN_TMP_SUFFIX

        // write 1 (the definition file) COMPLETED before the kill on write 2:
        // it is always the complete NEW version
        const defState = probeFile(defAbs)
        expect(defState.exists).toBe(true)
        expect(defState.content).toBe(goldenDef)
        expect(probeFile(defAbs + PLAN_TMP_SUFFIX).exists).toBe(false)

        // write 2 (plan.yaml): complete old or complete new version
        const planState = probeFile(planAbs)
        const planTmpState = probeFile(planTmpAbs)
        const expectedPlan = target === 'new' ? goldenPlan : APPENDIX_A_PLAN_YAML
        expect(planState.exists).toBe(true)
        expect(planState.content).toBe(expectedPlan)
        expect(planState.size).toBe(Buffer.byteLength(expectedPlan, 'utf8'))

        if (tmp === 'absent') {
          expect(planTmpState.exists).toBe(false)
        } else if (tmp === 'partial') {
          expect(planTmpState.exists).toBe(true)
          expect(planTmpState.size).toBeGreaterThan(0)
          expect(planTmpState.size).toBeLessThan(Buffer.byteLength(goldenPlan, 'utf8'))
        } else {
          expect(planTmpState.exists).toBe(true)
          expect(planTmpState.content).toBe(goldenPlan)
        }

        // 3) nothing else in the tree changed (no collateral half-write)
        assertTreeUntouched(t, [T5_REL, `${T5_REL}${PLAN_TMP_SUFFIX}`, PLAN_REL, `${PLAN_REL}${PLAN_TMP_SUFFIX}`])

        // 4) restart: the INTERMEDIATE state is LEGAL in every case —
        //    loadPlan is clean: the definition is present and (old plan)
        //    unlisted — retained per INV-PLAN-9, exactly the 「safe partial
        //    order」 documented in plan-store.ts addItem.
        const store2 = freshPlanStore(t)
        const loaded = store2.loadPlan()
        expect(loaded.errors).toEqual([])
        if (target === 'new') {
          expect(loaded.items).toEqual([...BASE_ITEMS, 'T-5']) // 6) NEW plan, reloadable
        } else {
          expect(loaded.items).toEqual([...BASE_ITEMS])
          // 5) recovery: list the surviving definition (residual plan tmp
          //    tolerated — deterministic tmp name overwritten + renamed away)
          store2.insertItemAt('T-5', BASE_ITEMS.length)
          expect(probeFile(planAbs).content).toBe(goldenPlan)
          expect(probeFile(planTmpAbs).exists).toBe(false)
          expect(freshPlanStore(t).loadPlan().items).toEqual([...BASE_ITEMS, 'T-5'])
        }
      } finally {
        t.cleanup()
      }
    })
  }
})

describe('kill -9 semantics of the plan crash double (post-mortem I/O)', () => {
  it('after the kill, every subsequent writeAtomic throws ProcessKilledError (no cleanup, no state change)', () => {
    const t = makeScratchTree()
    try {
      const writer = new CrashPlanWriter({ killAt: 'mid-tmp-write' })
      const targetAbs = join(t.researchRoot, PLAN_REL)
      const before = probeFile(targetAbs)
      let thrown: unknown = null
      try {
        planStore(new RealFsReader(), writer, t).moveItem('T-1', 0)
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(Error)
      expect((thrown as Error).message).toContain('process killed (kill -9 simulation)')
      expect(writer.isDead).toBe(true)
      // post-mortem: the dying process cannot do ANY further I/O
      expect(() => writer.writeAtomic(targetAbs, 'x')).toThrow(ProcessKilledError)
      expect(() => writer.writeAtomic(targetAbs + PLAN_TMP_SUFFIX, 'x')).toThrow(ProcessKilledError)
      // …and the on-disk state froze exactly where the kill landed
      expect(probeFile(targetAbs).content).toBe(before.content)
    } finally {
      t.cleanup()
    }
  })
})

/** Assert every seeded file is byte-identical and no unexpected file appeared (except the exempted ones). */
function assertTreeUntouched(t: ScratchTree, exempt: string[]): void {
  const now = walkFiles(t.researchRoot)
  for (const [rel, content] of Object.entries(t.seeded)) {
    if (exempt.includes(rel)) continue
    expect(now[rel], `unexpected change at ${rel}`).toBe(content)
  }
  expect(Object.keys(now).filter((rel) => !(rel in t.seeded) && !exempt.includes(rel))).toEqual([])
}
