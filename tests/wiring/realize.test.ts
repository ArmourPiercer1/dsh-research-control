/**
 * WP-3.6 (RR-011 (a) / RR-010 / TC-DOM-033) — the declarative half of the
 * workstream realization: the `workstream.yaml` PLANNED→REALIZED flip and
 * its RR-010 crash-window compensation, wired into the store write
 * transaction.
 *
 * Coverage (the task's (a)):
 *   1. the flip ITSELF — a PLANNED workstream's first RUN_* event flips
 *      `workstream.yaml` to `lifecycle: REALIZED` in the same transaction
 *      as the event (TC-DOM-033 声明式半边): file REALIZED + the
 *      `workstream` derived row REALIZED + the live external-state
 *      snapshot REALIZED, atomically; a second event never re-flips;
 *      sibling workstreams are untouched.
 *   2. RR-010 COMPENSATION — when the append fails after the flip, the
 *      pre-flip file content is restored byte-exact (file and DB agree
 *      again): pinned at the realizer state-machine level
 *      (`onWorkstreamRealized` → `settleAppend('failed')`) and at the
 *      wrapper level (`withRealizeCompensation` settles the realizer on
 *      the append outcome), plus the end-to-end batch-rejection path
 *      (the flip detects file/DB divergence → the whole batch is rejected
 *      and nothing is written anywhere).
 *   3. CRASH CONSISTENCY — the two divergences a crash in the flip→commit
 *      window (or a manual tampering) can leave are detected and
 *      CONVERGED at startup by the lifecycle reconciliation (the
 *      file follows History, never the other way round):
 *        - file REALIZED, no events in the log  → file rolled back to
 *          PLANNED (the flip's rename happened, the commit never did);
 *        - file PLANNED, events present         → file flipped forward to
 *          REALIZED (the compensation ran, or a hand edit reverted it).
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseDocument, YAMLMap } from 'yaml'
import { describe, expect, it } from 'vitest'

import { readDerivedState } from '../../src/host/history/replay/index.js'
import { openDatabase } from '../../src/host/persistence/store/index.js'
import {
  createHostWiring,
  flipWorkstreamYamlToRealized,
  withRealizeCompensation,
  WorkstreamRealizer,
  workstreamYamlRelPath,
  type FileCompensation,
} from '../../src/host/service/wiring/index.js'
import {
  makeTempDir,
  makeWiring,
  USER,
  WR_SCHEMA_ROOT,
  writeResearchTree,
  initGitRepo,
  type WiringBundle,
} from './helpers.js'

const WS1_YAML = 'topics/TPC-1/workstreams/WS-1/workstream.yaml'

/** Parse one workstream.yaml; `lifecycle` absent → PLANNED (loader rule). */
function lifecycleOf(absPath: string): string {
  const doc = parseDocument(readFileSync(absPath, 'utf8'))
  if (doc.errors.length > 0 || !(doc.contents instanceof YAMLMap)) {
    throw new Error(`not a well-formed mapping: ${absPath}`)
  }
  const v = doc.contents.get('lifecycle')
  return v === undefined || v === null ? 'PLANNED' : String(v)
}

describe('(a) TC-DOM-033 declarative half: the workstream.yaml flip', () => {
  it('the first event of a PLANNED workstream flips the file + derived row + live snapshot, atomically; no re-flip; siblings untouched', () => {
    const { wiring, researchRoot } = makeWiring()
    const ws1Yaml = join(researchRoot, workstreamYamlRelPath('TPC-1', 'WS-1'))
    try {
      // Precondition: WS-1 is PLANNED (the fixture file has no lifecycle
      // key — the loader default), and startup found no divergence.
      expect(lifecycleOf(ws1Yaml)).toBe('PLANNED')
      expect(wiring.startup.lifecycle.changed).toBe(0)
      expect(wiring.startup.lifecycle.findings.every((f) => f.action === 'none')).toBe(true)

      // The first RUN_* event of WS-1 — the realize hook fires in the
      // store write transaction (service half + file half together).
      const result = wiring.runBinding.registerRun({ workstreamId: 'WS-1', taskId: 'T-1' }, USER)
      expect(result.event.eventType).toBe('RUN_STARTED')
      expect(result.run.status).toBe('RUNNING')

      // ① the file is REALIZED (and only the flip changed it — the
      //    remaining document is the original byte content with the key
      //    set/added by the YAML doc, re-serialized).
      expect(lifecycleOf(ws1Yaml)).toBe('REALIZED')

      // ② the workstream-lifecycle derived row (the service half) is
      //    REALIZED in the SAME commit (same transaction — both halves or
      //    neither).
      const derived = readDerivedState(wiring.store)
      const wsRow = derived.get('workstream:WS-1')
      expect(wsRow).toBeDefined()
      expect((wsRow as { lifecycle: string }).lifecycle).toBe('REALIZED')

      // ③ the live external-state snapshot agrees (the runbinding seam
      //    reads it per operation — a later operation must not try to
      //    re-realize a workstream that is already realized).
      expect(wiring.externalState().workstreams.get('WS-1')!.lifecycle).toBe('REALIZED')

      // ④ a second event of the same workstream does NOT re-flip (the
      //    file content is byte-stable).
      const before = readFileSync(ws1Yaml, 'utf8')
      wiring.runBinding.recordCheckpoint(result.run.id, { note: 'still running' }, USER)
      expect(readFileSync(ws1Yaml, 'utf8')).toBe(before)

      // ⑤ sibling workstreams are untouched by WS-1's realization.
      for (const ws of ['WS-2', 'WS-3']) {
        const sibling = join(researchRoot, workstreamYamlRelPath('TPC-1', ws))
        expect(lifecycleOf(sibling)).toBe('PLANNED')
      }
    } finally {
      wiring.close()
    }
  })

  it('a second PLANNED workstream realized later flips its own file only', () => {
    const { wiring, researchRoot } = makeWiring()
    try {
      const ws1 = join(researchRoot, workstreamYamlRelPath('TPC-1', 'WS-1'))
      const ws2 = join(researchRoot, workstreamYamlRelPath('TPC-1', 'WS-2'))
      wiring.runBinding.registerRun({ workstreamId: 'WS-1' }, USER)
      expect(lifecycleOf(ws1)).toBe('REALIZED')
      expect(lifecycleOf(ws2)).toBe('PLANNED')

      // WS-2's FIRST event realizes WS-2 (not WS-1 — already realized).
      const r2 = wiring.runBinding.registerRun({ workstreamId: 'WS-2' }, USER)
      expect(r2.run.workstream_id).toBe('WS-2')
      expect(lifecycleOf(ws2)).toBe('REALIZED')
      expect(lifecycleOf(ws1)).toBe('REALIZED')
      expect(readDerivedState(wiring.store).get('workstream:WS-2')).toBeDefined()
    } finally {
      wiring.close()
    }
  })
})

describe('(a) RR-010 compensation: the flip is rolled back when the append fails', () => {
  it('realizer state machine: onWorkstreamRealized → settleAppend(failed) restores the pre-flip bytes exactly', () => {
    const repoRoot = makeTempDir('wp36-comp-')
    const researchRoot = writeResearchTree(repoRoot)
    const realizer = new WorkstreamRealizer({
      researchRoot,
      workstreams: new Map([
        ['WS-1', { topicId: 'TPC-1' }],
        ['WS-2', { topicId: 'TPC-1' }],
      ]),
    })
    const ws1 = join(researchRoot, workstreamYamlRelPath('TPC-1', 'WS-1'))
    const original = readFileSync(ws1, 'utf8')

    // Arm: the flip runs and the compensation is pending.
    realizer.onWorkstreamRealized('WS-1')
    expect(realizer.pendingWorkstreamId).toBe('WS-1')
    expect(lifecycleOf(ws1)).toBe('REALIZED')
    expect(readFileSync(ws1, 'utf8')).not.toBe(original)

    // Settle FAILED: the pre-flip bytes come back (byte-exact, atomic
    // restore — a torn file is never observable).
    realizer.settleAppend('failed')
    expect(realizer.pendingWorkstreamId).toBeNull()
    expect(readFileSync(ws1, 'utf8')).toBe(original)
    expect(lifecycleOf(ws1)).toBe('PLANNED')
  })

  it('realizer state machine: settleAppend(committed) disarms — the flip is permanent', () => {
    const repoRoot = makeTempDir('wp36-comp2-')
    const researchRoot = writeResearchTree(repoRoot)
    const realizer = new WorkstreamRealizer({
      researchRoot,
      workstreams: new Map([['WS-1', { topicId: 'TPC-1' }]]),
    })
    const ws1 = join(researchRoot, workstreamYamlRelPath('TPC-1', 'WS-1'))
    realizer.onWorkstreamRealized('WS-1')
    realizer.settleAppend('committed')
    expect(realizer.pendingWorkstreamId).toBeNull()
    expect(lifecycleOf(ws1)).toBe('REALIZED')
    // A later failed append must NOT undo a committed flip.
    realizer.settleAppend('failed') // no pending — no-op, no throw
    expect(lifecycleOf(ws1)).toBe('REALIZED')
  })

  it('flipWorkstreamYamlToRealized returns a compensation that restores (and is idempotently safe to drop)', () => {
    const repoRoot = makeTempDir('wp36-flip-')
    const researchRoot = writeResearchTree(repoRoot)
    const ws1 = join(researchRoot, workstreamYamlRelPath('TPC-1', 'WS-1'))
    const original = readFileSync(ws1, 'utf8')
    const compensate: FileCompensation = flipWorkstreamYamlToRealized({
      researchRoot,
      topicId: 'TPC-1',
      workstreamId: 'WS-1',
    })
    expect(lifecycleOf(ws1)).toBe('REALIZED')
    compensate()
    expect(readFileSync(ws1, 'utf8')).toBe(original)
  })

  it('flip of an already-REALIZED file throws WIRING_REALIZE (file/DB divergence — the batch must be rejected, not guessed)', () => {
    const repoRoot = makeTempDir('wp36-flip2-')
    const researchRoot = writeResearchTree(repoRoot, {
      [WS1_YAML]: `id: WS-1\ntopic_id: TPC-1\ntitle: 主标定管线\nlifecycle: REALIZED\ncreated_at: 2026-08-21T09:10:00Z\n`,
    })
    const ws1 = join(researchRoot, workstreamYamlRelPath('TPC-1', 'WS-1'))
    expect(lifecycleOf(ws1)).toBe('REALIZED')
    expect(() =>
      flipWorkstreamYamlToRealized({ researchRoot, topicId: 'TPC-1', workstreamId: 'WS-1' }),
    ).toThrow(/file lifecycle is REALIZED, expected PLANNED/)
  })

  it('end-to-end batch rejection: a divergent file stops the FIRST-event append — no event, no derived row, snapshot unchanged, file unchanged', () => {
    // The live snapshot says WS-1 is PLANNED (fresh tree load) but the
    // file on disk already says REALIZED with NO events in the log —
    // exactly the crash residue a hand edit (or an interrupted recovery)
    // can leave. The startup lifecycle reconcile would converge this —
    // so for the RAW batch-rejection path we patch the file AFTER
    // startup (the snapshot stays PLANNED, the file diverges).
    const bundle = makeWiring()
    const { wiring, researchRoot, dataDir } = bundle
    const ws1 = join(researchRoot, workstreamYamlRelPath('TPC-1', 'WS-1'))
    const original = readFileSync(ws1, 'utf8')
    try {
      writeFileSync(ws1, original.replace('id: WS-1', 'lifecycle: REALIZED\nid: WS-1'), 'utf8')
      expect(lifecycleOf(ws1)).toBe('REALIZED')
      expect(wiring.externalState().workstreams.get('WS-1')!.lifecycle).toBe('PLANNED')

      // The first WS-1 event must now fail (the flip detects the
      // divergence) — and the WHOLE batch is rejected:
      expect(() =>
        wiring.runBinding.registerRun({ workstreamId: 'WS-1', taskId: 'T-1' }, USER),
      ).toThrow(/file lifecycle is REALIZED, expected PLANNED/)

      // No event persisted, no derived row written, the live snapshot is
      // untouched, and the file is exactly as the operator left it.
      expect(wiring.runBinding.listRuns()).toEqual([])
      expect(readDerivedState(wiring.store).get('workstream:WS-1')).toBeUndefined()
      expect(wiring.externalState().workstreams.get('WS-1')!.lifecycle).toBe('PLANNED')
      expect(readFileSync(ws1, 'utf8')).toBe(
        original.replace('id: WS-1', 'lifecycle: REALIZED\nid: WS-1'),
      )
      void dataDir
    } finally {
      wiring.close()
    }
  })

  it('withRealizeCompensation settles the realizer on the append outcome (committed → disarm; failed → restore)', () => {
    const repoRoot = makeTempDir('wp36-wrap-')
    const researchRoot = writeResearchTree(repoRoot)
    initGitRepo(repoRoot)
    const dataDir = join(makeTempDir('wp36-wrapdata-'))
    const store = openDatabase(join(dataDir, 'research.sqlite'))
    const realizer = new WorkstreamRealizer({
      researchRoot,
      workstreams: new Map([['WS-1', { topicId: 'TPC-1' }]]),
    })
    const ws1 = join(researchRoot, workstreamYamlRelPath('TPC-1', 'WS-1'))
    const original = readFileSync(ws1, 'utf8')
    const wrapped = withRealizeCompensation(store, realizer)

    try {
      // A failing append with NO flip armed: settleAppend(failed) is a
      // no-op (the file is untouched, the error propagates unchanged).
      expect(() =>
        wrapped.appendEvents([
          {
            eventId: 'H-1',
            ownerWorkstreamId: 'WS-1',
            eventType: 'FACT_RECORDED',
            schemaVersion: 1,
            occurredAt: 1755850000000,
            actor: { kind: 'USER', user_id: 'u-1' },
            payload: { fact_id: 'F-1', statement: 's' },
          },
          // A second event with the SAME eventId: the store refuses the
          // duplicate (PK) AFTER seq assignment — the batch rolls back.
          {
            eventId: 'H-1',
            ownerWorkstreamId: 'WS-1',
            eventType: 'FACT_RECORDED',
            schemaVersion: 1,
            occurredAt: 1755850001000,
            actor: { kind: 'USER', user_id: 'u-1' },
            payload: { fact_id: 'F-2', statement: 's' },
          },
        ]),
      ).toThrow()
      expect(readFileSync(ws1, 'utf8')).toBe(original)

      // The flip arms inside a (service-shaped) validate/realize pair the
      // way the RunBindingService composes them: the wrapper settles on
      // the outcome. Simulate the committed half:
      realizer.onWorkstreamRealized('WS-1')
      wrapped.appendEvents([
        {
          eventId: 'H-2',
          ownerWorkstreamId: 'WS-1',
          eventType: 'FACT_RECORDED',
          schemaVersion: 1,
          occurredAt: 1755850002000,
          actor: { kind: 'USER', user_id: 'u-1' },
          payload: { fact_id: 'F-3', statement: 's' },
        },
      ])
      expect(realizer.pendingWorkstreamId).toBeNull()
      expect(lifecycleOf(ws1)).toBe('REALIZED')
    } finally {
      store.close()
    }
    void WR_SCHEMA_ROOT
  })
})

describe('(a) crash consistency: startup detects and converges file/DB divergence', () => {
  it('file REALIZED with NO events in the log → the startup reconcile rolls the file back to PLANNED', () => {
    // Simulate the RR-010 crash window: the flip's rename committed to
    // disk, the store's COMMIT never happened (the log is empty).
    const bundle = makeWiring()
    const { wiring, researchRoot, dataDir } = bundle
    const ws1 = join(researchRoot, workstreamYamlRelPath('TPC-1', 'WS-1'))
    const original = readFileSync(ws1, 'utf8')
    // The first wiring (clean) is closed; the file is then left
    // REALIZED with an empty log (the crash residue).
    wiring.close()
    writeFileSync(ws1, original.replace('id: WS-1', 'lifecycle: REALIZED\nid: WS-1'), 'utf8')

    // A FRESH wiring over the SAME data dir + repo: the startup
    // lifecycle reconcile must detect the divergence and converge the
    // FILE toward History (no events ⇒ not realized).
    const fresh = createWiringOver(bundle)
    try {
      expect(fresh.startup.lifecycle.changed).toBe(1)
      const finding = fresh.startup.lifecycle.findings.find((f) => f.workstreamId === 'WS-1')
      expect(finding).toBeDefined()
      expect(finding!.action).toBe('file-rolled-back-to-planned')
      expect(finding!.hasEvents).toBe(false)
      expect(lifecycleOf(ws1)).toBe('PLANNED')
      // The live snapshot agrees with the converged file.
      expect(fresh.externalState().workstreams.get('WS-1')!.lifecycle).toBe('PLANNED')
    } finally {
      fresh.close()
    }
    void dataDir
    void original
  })

  it('file PLANNED with events in the log → the startup reconcile flips the file FORWARD to REALIZED', () => {
    // Realize WS-1 through the normal path (file + DB agree: REALIZED),
    // then simulate the reverse residue: the file is reverted to PLANNED
    // (a hand edit, or a compensation that ran after the commit).
    const bundle = makeWiring()
    const { wiring, researchRoot, dataDir } = bundle
    const ws1 = join(researchRoot, workstreamYamlRelPath('TPC-1', 'WS-1'))
    const before = readFileSync(ws1, 'utf8')
    wiring.runBinding.registerRun({ workstreamId: 'WS-1' }, USER)
    expect(lifecycleOf(ws1)).toBe('REALIZED')
    wiring.close()
    writeFileSync(ws1, before.replace('lifecycle: REALIZED', 'lifecycle: PLANNED'), 'utf8')
    expect(lifecycleOf(ws1)).toBe('PLANNED')

    const fresh = createWiringOver(bundle)
    try {
      expect(fresh.startup.lifecycle.changed).toBe(1)
      const finding = fresh.startup.lifecycle.findings.find((f) => f.workstreamId === 'WS-1')
      expect(finding).toBeDefined()
      expect(finding!.action).toBe('file-flipped-to-realized')
      expect(finding!.hasEvents).toBe(true)
      expect(lifecycleOf(ws1)).toBe('REALIZED')
      expect(fresh.externalState().workstreams.get('WS-1')!.lifecycle).toBe('REALIZED')
      // The RUN_STARTED event is still there (History is untouched — the
      // converge direction is file-toward-DB only).
      expect(fresh.runBinding.listRuns().length).toBe(1)
    } finally {
      fresh.close()
    }
    void dataDir
  })

  it('convergence rewrites keep the YAML block form and every comment (minimal edit: only lifecycle changes — G8 r2 defect 2 regression)', () => {
    // The crash-window convergence must not re-shape the human-maintained
    // declarative 真源: a comment-rich workstream.yaml comes out of BOTH
    // convergence directions still a YAML block document (NOT a single-
    // line JSON dump — the `YAMLMap.toString()` form the WP-3.6 bug
    // produced), with every comment and every untouched field intact
    // (git diff stays readable; the flip path's doc.toString() standard).
    const commentRich = (lifecycleLine: string) =>
      `# WS-1 — 主标定管线 (human note: keep this comment)\nid: WS-1\ntopic_id: TPC-1\ntitle: 主标定管线\n# lifecycle: the ONLY field the startup reconcile may rewrite\n${lifecycleLine}created_at: 2026-08-21T09:10:00Z\n`

    // ---- direction 1: file REALIZED, no events → rolled back to PLANNED ----
    const bundleA = makeWiring()
    const wsA = join(bundleA.researchRoot, workstreamYamlRelPath('TPC-1', 'WS-1'))
    bundleA.wiring.close()
    writeFileSync(wsA, commentRich('lifecycle: REALIZED\n'), 'utf8')
    const freshA = createWiringOver(bundleA)
    try {
      expect(freshA.startup.lifecycle.findings.find((f) => f.workstreamId === 'WS-1')!.action).toBe('file-rolled-back-to-planned')
      const outA = readFileSync(wsA, 'utf8')
      // block form — not a single-line JSON dump (defect 2's exact form)
      expect(outA.split('\n').length).toBeGreaterThan(3)
      expect(outA).not.toMatch(/^\{/)
      // every comment survives the rewrite
      expect(outA).toContain('# WS-1 — 主标定管线 (human note: keep this comment)')
      expect(outA).toContain('# lifecycle: the ONLY field the startup reconcile may rewrite')
      // the lifecycle field IS converged; the untouched fields are intact
      expect(lifecycleOf(wsA)).toBe('PLANNED')
      expect(outA).toContain('id: WS-1')
      expect(outA).toContain('topic_id: TPC-1')
      expect(outA).toContain('title: 主标定管线')
      expect(outA).toContain('created_at: 2026-08-21T09:10:00Z')
      // and the rewritten document re-parses to the same fields
      const parsedA = parseDocument(outA)
      expect(parsedA.errors).toEqual([])
      expect(parsedA.contents).toBeInstanceOf(YAMLMap)
      expect(String((parsedA.contents as YAMLMap).get('id'))).toBe('WS-1')
    } finally {
      freshA.close()
    }

    // ---- direction 2: file PLANNED, events present → flipped to REALIZED ----
    const bundleB = makeWiring()
    const wsB = join(bundleB.researchRoot, workstreamYamlRelPath('TPC-1', 'WS-1'))
    bundleB.wiring.runBinding.registerRun({ workstreamId: 'WS-1' }, USER) // events in History
    bundleB.wiring.close()
    writeFileSync(wsB, commentRich('lifecycle: PLANNED\n'), 'utf8')
    const freshB = createWiringOver(bundleB)
    try {
      expect(freshB.startup.lifecycle.findings.find((f) => f.workstreamId === 'WS-1')!.action).toBe('file-flipped-to-realized')
      const outB = readFileSync(wsB, 'utf8')
      expect(outB.split('\n').length).toBeGreaterThan(3)
      expect(outB).not.toMatch(/^\{/)
      expect(outB).toContain('# WS-1 — 主标定管线 (human note: keep this comment)')
      expect(outB).toContain('# lifecycle: the ONLY field the startup reconcile may rewrite')
      expect(lifecycleOf(wsB)).toBe('REALIZED')
      expect(outB).toContain('id: WS-1')
      expect(outB).toContain('topic_id: TPC-1')
      expect(outB).toContain('title: 主标定管线')
      expect(outB).toContain('created_at: 2026-08-21T09:10:00Z')
    } finally {
      freshB.close()
    }
  })

  it('an unreadable/illegal workstream.yaml fails startup loud (never guessed)', () => {
    const bundle = makeWiring()
    const { researchRoot } = bundle
    const ws1 = join(researchRoot, workstreamYamlRelPath('TPC-1', 'WS-1'))
    const original = readFileSync(ws1, 'utf8')
    bundle.wiring.close()
    writeFileSync(ws1, 'this is: [not: a: mapping', 'utf8')
    try {
      expect(() => createWiringOver(bundle)).toThrow()
    } finally {
      writeFileSync(ws1, original, 'utf8')
    }
  })
})

/* ------------------------------------------------------------------ *
 * Re-open a wiring over the bundle's existing repo + data dir (the
 * crash-recovery shape: same files, a fresh process)
 * ------------------------------------------------------------------ */

function createWiringOver(bundle: WiringBundle) {
  return createHostWiring({
    repoRoot: bundle.repoRoot,
    schemaRoot: WR_SCHEMA_ROOT,
    projectId: 'PRJ-1',
    dataDir: bundle.dataDir,
    adapter: bundle.adapter,
    launcherAdapter: bundle.launcherAdapter,
    workspaceRoots: [bundle.repoRoot],
    now: () => Date.now(),
  })
}
