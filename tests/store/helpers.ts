/**
 * WP-2.1 test infrastructure: real-sqlite temp directories + event
 * fixtures.
 *
 * Every test opens a REAL research.sqlite in a throwaway directory
 * (mkdtemp under os.tmpdir) — node:sqlite semantics (WAL, locks,
 * permissions, crash recovery) are only observable on real files. All
 * temp roots are removed in afterAll.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll } from 'vitest'

import type { ActorRefJson, HistoryEventInput, SourceRefJson } from '../../src/host/persistence/store/index.js'

const roots: string[] = []

/** Fresh temp directory (tracked for afterAll cleanup). */
export function makeTempDir(prefix = 'wp21-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

/** The conventional DB file name inside a project data dir. */
export function dbPath(dir: string): string {
  return join(dir, 'research.sqlite')
}

afterAll(() => {
  for (const r of roots) {
    rmSync(r, { recursive: true, force: true })
  }
})

/** Event fixture spec (all fields optional; deterministic defaults). */
export interface EventSpec {
  eventId?: string
  ownerWorkstreamId?: string
  eventType?: string
  schemaVersion?: number
  occurredAt?: number
  actor?: ActorRefJson
  source?: SourceRefJson | null
  payload?: Record<string, unknown>
}

let seq = 0

/**
 * A valid HistoryEventInput. `eventId` defaults to a unique `H-<n>` so a
 * suite can append many events without thinking; pass explicit ids when
 * asserting on a specific one.
 */
export function makeEvent(spec: EventSpec = {}): HistoryEventInput {
  seq += 1
  const base: HistoryEventInput = {
    eventId: spec.eventId ?? `H-${seq}`,
    ownerWorkstreamId: spec.ownerWorkstreamId ?? 'WS-1',
    eventType: spec.eventType ?? 'RUN_STARTED',
    schemaVersion: spec.schemaVersion ?? 1,
    occurredAt: spec.occurredAt ?? 1_700_000_000_000,
    actor: spec.actor ?? { kind: 'USER' },
    payload: spec.payload ?? { run_id: 'R-1' },
  }
  return spec.source === undefined ? base : { ...base, source: spec.source }
}
