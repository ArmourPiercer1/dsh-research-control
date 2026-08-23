/**
 * WP-8.6 (G8 round-2 C1 — defect 1 regression) — the startup integrity
 * handle lifecycle: 「a failed startup leaks nothing」.
 *
 * G8 round-2 (inv-attacker b1, independently reproduced by
 * host-integrator) proved the invariant FALSE for one form: the
 * check-1 DB handle (opened by `checkDatabase`) was NOT closed when the
 * consistency check took its tree-fatal SKIP branch (`runConsistencyCheck`
 * returned `skipped()` before the close) — with a healthy DB and a fatal
 * `.research` tree, each failed init leaked the sqlite/-wal/-shm fd
 * trio, in BOTH the production gate (`startup-integrity.ts`, step 0.5)
 * and the frozen orchestrator (`startup.ts`). The fix wraps the whole
 * `runConsistencyCheck` body in the close-finally (both sides).
 *
 * This file is the regression port of the review battery
 * `WR/.g8r2-inv-attack-fixtures/b1-gate-leak.attack.test.ts` (2 controls +
 * 2 leak attacks), hardened: the fd scan matches the workspace's FULL db
 * path (not just the basename) so a concurrent workspace's
 * research.sqlite can never fake a hit. Detection = /proc/self/fd: after
 * the fatal path the handle count for the workspace DB must be ZERO.
 */
import { readdirSync, readlinkSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { runStartupIntegrityGate } from '../../src/host/service/wiring/startup-integrity.js'
import { HostWiringError } from '../../src/host/service/wiring/types.js'
import {
  assertStartup,
  runStartupIntegrityChecks,
} from '../../src/host/persistence/hardening/index.js'
import {
  deleteFileUnder,
  FsReader,
  initializeValidDb,
  makeCollectingLogger,
  makeWorkspace,
  type HardeningWorkspace,
  DECLARATIVE_SCHEMA_DIR,
} from './helpers.js'

/** Every open fd of THIS process whose target is the workspace DB file
 *  family (research.sqlite + -wal + -shm) — matched by FULL path so an
 *  unrelated workspace's same-named file cannot fake a hit. */
function openFdsFor(ws: HardeningWorkspace): string[] {
  const hits: string[] = []
  for (const fd of readdirSync('/proc/self/fd')) {
    try {
      const target = readlinkSync(join('/proc/self/fd', fd))
      if (target.startsWith(ws.dbPath)) hits.push(`${fd} -> ${target}`)
    } catch {
      /* fd vanished mid-scan */
    }
  }
  return hits
}

function gateInput(ws: HardeningWorkspace) {
  return {
    dbPath: ws.dbPath,
    repoRoot: ws.repoRoot,
    researchRoot: ws.researchRoot,
    schemaDir: DECLARATIVE_SCHEMA_DIR,
    projectId: 'PRJ-1',
    researchDir: '.research',
    reader: new FsReader(),
    logger: makeCollectingLogger(),
  }
}

describe('G8 r2 C1 — the check-1 handle is closed on EVERY path (leak regression)', () => {
  it('CONTROL: healthy workspace — gate outcome ok and the check-1 handle is closed (0 fds left)', () => {
    const ws = makeWorkspace()
    initializeValidDb(ws.dbPath)
    const gate = runStartupIntegrityGate(gateInput(ws))
    expect(gate.outcome).toBe('ok')
    expect(openFdsFor(ws), 'LEAK: healthy gate left the db fds open').toEqual([])
  })

  it('CONTROL: degraded (file-leads residue) — consistency RUNS and closes the handle (0 fds left)', () => {
    const ws = makeWorkspace({
      treePatch: {
        'topics/TPC-1/workstreams/WS-1/workstream.yaml':
          'id: WS-1\ntopic_id: TPC-1\ntitle: probe\ncreated_at: 2026-08-21T09:10:00Z\nlifecycle: REALIZED\n',
      },
    })
    initializeValidDb(ws.dbPath) // valid db, EMPTY history → file-leads
    const gate = runStartupIntegrityGate(gateInput(ws))
    expect(gate.outcome).toBe('degraded')
    expect(gate.consistency.status).toBe('recoverable')
    expect(openFdsFor(ws), 'LEAK: degraded gate left the db fds open').toEqual([])
  })

  it('ATTACK 1 (production gate, step 0.5): DB pass + tree FATAL → WIRING_INTEGRITY thrown — the check-1 handle count is back to zero', () => {
    const ws = makeWorkspace()
    initializeValidDb(ws.dbPath)
    deleteFileUnder(ws.researchRoot, 'project.yaml') // the fatal tree form
    let threw: unknown = null
    try {
      runStartupIntegrityGate(gateInput(ws))
    } catch (e) {
      threw = e
    }
    expect(threw).toBeInstanceOf(HostWiringError)
    expect((threw as HostWiringError).code).toBe('WIRING_INTEGRITY')
    // THE REGRESSION PROBE: the documented 「the gate's own check-1 handle
    // is closed in a finally, ALWAYS」 — any sqlite/-wal/-shm fd of this
    // workspace still open here means the fatal path leaked it.
    expect(openFdsFor(ws), 'LEAK: gate threw WIRING_INTEGRITY but left the check-1 fds open').toEqual([])
  })

  it('ATTACK 2 (frozen orchestrator): same form — the fatal report leaves the handle count at zero', async () => {
    const ws = makeWorkspace()
    initializeValidDb(ws.dbPath)
    deleteFileUnder(ws.researchRoot, 'project.yaml')
    const report = await runStartupIntegrityChecks(gateInput(ws))
    expect(report.outcome).toBe('fatal')
    expect(report.consistency.status).toBe('skipped')
    expect(() => assertStartup(report)).toThrow()
    expect(openFdsFor(ws), 'LEAK: orchestrator fatal but left the check-1 fds open').toEqual([])
  })

  it('repeated failed inits do not accumulate (the same tree-fatal form 3×: still 0 fds)', () => {
    // The production exposure form: an operator retries enable against a
    // broken tree (same process, same data dir) — fd growth across retries
    // was the round-2 impact statement; the closed invariant means the
    // count stays at zero no matter how often the gate fails.
    const ws = makeWorkspace()
    initializeValidDb(ws.dbPath)
    deleteFileUnder(ws.researchRoot, 'project.yaml')
    for (let i = 0; i < 3; i++) {
      expect(() => runStartupIntegrityGate(gateInput(ws))).toThrow(HostWiringError)
    }
    expect(openFdsFor(ws), 'LEAK: repeated fatal inits accumulated db fds').toEqual([])
  })
})
