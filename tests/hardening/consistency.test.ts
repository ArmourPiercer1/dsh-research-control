/**
 * WP-8.1 — check 4: the dual-真源 consistency SPOT check (ARCHITECTURE
 * §4). Read-only detection of file/History divergence (the RR-010
 * crash-window residue forms) + the project-scope cross-check; every
 * finding is classed (recoverable → the wiring's loud reconciliation;
 * project-id mismatch → unrecoverable, the plugin must not guess which
 * side to rewrite).
 *
 * Real store (a REAL research.sqlite) + a focused tree object (the check
 * reads only tree.project + the workstream lifecycles; the orchestrator
 * tests feed it the REAL loader's tree end-to-end).
 */
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { checkDualTruthConsistency, DEFAULT_CONSISTENCY_SAMPLE } from '../../src/host/persistence/hardening/index.js'
import { openDatabase } from '../../src/host/persistence/store/index.js'
import type { ProjectDoc, ResearchTree, WorkstreamDoc } from '../../src/host/domain/loader/index.js'
import { makeDataDir, makeTestClock } from './helpers.js'

function ws(lifecycle: 'PLANNED' | 'REALIZED' | 'DROPPED', id: string): WorkstreamDoc {
  return { lifecycle } as unknown as WorkstreamDoc
}

function makeTree(options: {
  readonly projectId?: string | null
  readonly workstreams?: [string, 'PLANNED' | 'REALIZED' | 'DROPPED'][]
} = {}): ResearchTree {
  const { projectId = 'PRJ-1', workstreams = [['WS-1', 'PLANNED'], ['WS-2', 'PLANNED'], ['WS-3', 'PLANNED']] } = options
  return {
    schemaVersion: 1,
    project: projectId === null ? null : ({ id: projectId } as unknown as ProjectDoc),
    objectives: [],
    workspace: null,
    policy: null,
    topics: [
      {
        id: 'TPC-1',
        path: 'topics/TPC-1',
        doc: null,
        topology: null,
        workstreams: workstreams.map(([id, lifecycle]) => ({
          id,
          topicId: 'TPC-1',
          path: `topics/TPC-1/workstreams/${id}`,
          doc: ws(lifecycle, id),
          plan: null,
          tasks: [],
          gates: [],
          milestones: [],
        })),
      },
    ],
    mergeContracts: [],
  }
}

function freshDb(): { dbPath: string; store: ReturnType<typeof openDatabase> } {
  const dataDir = makeDataDir()
  const dbPath = join(dataDir, 'research.sqlite')
  const store = openDatabase(dbPath, { now: makeTestClock() })
  return { dbPath, store }
}

describe('checkDualTruthConsistency — consistent forms (pass)', () => {
  it('all PLANNED files + an empty History: consistent, project scope matches', () => {
    const { store } = freshDb()
    try {
      const r = checkDualTruthConsistency({ store, tree: makeTree(), projectId: 'PRJ-1' })
      expect(r.status).toBe('pass')
      expect(r.findings).toEqual([])
      expect(r.checked).toEqual(['WS-1', 'WS-2', 'WS-3'])
      expect(r.projectIdChecked).toBe(true)
      expect(r.message).toContain('project scope matches')
      expect(r.guidance).toEqual([])
    } finally {
      store.close()
    }
  })

  it('a REALIZED file WITH events: consistent (the realized state agrees)', () => {
    const { store } = freshDb()
    try {
      store.appendEvents([
        {
          eventId: 'H-1',
          ownerWorkstreamId: 'WS-1',
          eventType: 'WS_REALIZED',
          schemaVersion: 1,
          occurredAt: 1_700_000_000_000,
          actor: { kind: 'PLUGIN' },
          payload: { workstream_id: 'WS-1' },
        },
      ])
      const r = checkDualTruthConsistency({ store, tree: makeTree({ workstreams: [['WS-1', 'REALIZED']] }), projectId: 'PRJ-1' })
      expect(r.status).toBe('pass')
      expect(r.findings).toEqual([])
    } finally {
      store.close()
    }
  })

  it('a DROPPED workstream is skipped in BOTH directions (with and without events)', () => {
    const { store } = freshDb()
    try {
      store.appendEvents([
        {
          eventId: 'H-1',
          ownerWorkstreamId: 'WS-2',
          eventType: 'RUN_STARTED',
          schemaVersion: 1,
          occurredAt: 1_700_000_000_000,
          actor: { kind: 'USER' },
          payload: { run_id: 'R-1' },
        },
      ])
      const r = checkDualTruthConsistency({
        store,
        tree: makeTree({ workstreams: [['WS-1', 'PLANNED'], ['WS-2', 'DROPPED'], ['WS-3', 'PLANNED']] }),
        projectId: 'PRJ-1',
      })
      // WS-2 has events but is DROPPED → consistent (the declarative 真源 stands)
      expect(r.status).toBe('pass')
      expect(r.findings).toEqual([])
      expect(r.checked).toContain('WS-2')
    } finally {
      store.close()
    }
  })

  it('a workstream whose file was rejected (doc: null) is NOT probed (the tree check owns it)', () => {
    const { store } = freshDb()
    try {
      const tree = makeTree()
      tree.topics[0]!.workstreams[0]!.doc = null // broken file: the tree check reports it
      const r = checkDualTruthConsistency({ store, tree, projectId: 'PRJ-1' })
      expect(r.checked).toEqual(['WS-2', 'WS-3'])
      expect(r.status).toBe('pass')
    } finally {
      store.close()
    }
  })
})

describe('checkDualTruthConsistency — divergence forms (recoverable, loud)', () => {
  it('file-leads: file REALIZED, no events (RR-010 crash residue) → recoverable finding', () => {
    const { store } = freshDb()
    try {
      const r = checkDualTruthConsistency({
        store,
        tree: makeTree({ workstreams: [['WS-1', 'REALIZED']] }),
        projectId: 'PRJ-1',
      })
      expect(r.status).toBe('recoverable')
      expect(r.findings).toHaveLength(1)
      expect(r.findings[0]!.kind).toBe('file-leads')
      expect(r.findings[0]!.workstreamId).toBe('WS-1')
      expect(r.findings[0]!.message).toContain('RR-010')
      // loud guidance naming the mechanism (the wiring's reconciliation)
      expect(r.guidance.length).toBeGreaterThanOrEqual(2)
      expect(r.guidance.join('\n')).toContain('reconciliation')
    } finally {
      store.close()
    }
  })

  it('file-trails: file PLANNED, History non-empty (the flip half lost) → recoverable finding', () => {
    const { store } = freshDb()
    try {
      store.appendEvents([
        {
          eventId: 'H-1',
          ownerWorkstreamId: 'WS-3',
          eventType: 'RUN_STARTED',
          schemaVersion: 1,
          occurredAt: 1_700_000_000_000,
          actor: { kind: 'USER' },
          payload: { run_id: 'R-1' },
        },
      ])
      const r = checkDualTruthConsistency({ store, tree: makeTree(), projectId: 'PRJ-1' })
      expect(r.status).toBe('recoverable')
      expect(r.findings).toHaveLength(1)
      expect(r.findings[0]!.kind).toBe('file-trails')
      expect(r.findings[0]!.workstreamId).toBe('WS-3')
    } finally {
      store.close()
    }
  })

  it('both directions at once: two findings, both named', () => {
    const { store } = freshDb()
    try {
      store.appendEvents([
        {
          eventId: 'H-1',
          ownerWorkstreamId: 'WS-2',
          eventType: 'RUN_STARTED',
          schemaVersion: 1,
          occurredAt: 1_700_000_000_000,
          actor: { kind: 'USER' },
          payload: { run_id: 'R-1' },
        },
      ])
      const r = checkDualTruthConsistency({
        store,
        tree: makeTree({ workstreams: [['WS-1', 'REALIZED'], ['WS-2', 'PLANNED'], ['WS-3', 'PLANNED']] }),
        projectId: 'PRJ-1',
      })
      expect(r.status).toBe('recoverable')
      const kinds = r.findings.map((f) => f.kind).sort()
      expect(kinds).toEqual(['file-leads', 'file-trails'])
    } finally {
      store.close()
    }
  })
})

describe('checkDualTruthConsistency — the project-scope cross-check (unrecoverable)', () => {
  it('a project-id mismatch: unrecoverable, no guessing which side to rewrite', () => {
    const { store } = freshDb()
    try {
      const r = checkDualTruthConsistency({ store, tree: makeTree(), projectId: 'PRJ-9' })
      expect(r.status).toBe('unrecoverable')
      expect(r.findings.some((f) => f.kind === 'project-id-mismatch')).toBe(true)
      const all = r.guidance.join('\n')
      expect(all).toContain('PRJ-9')
      expect(all).toContain('must not guess which side to rewrite')
      expect(all).toContain('git restore')
    } finally {
      store.close()
    }
  })

  it('a missing project doc: the scope check is skipped (projectIdChecked false), not guessed', () => {
    const { store } = freshDb()
    try {
      const r = checkDualTruthConsistency({ store, tree: makeTree({ projectId: null }), projectId: 'PRJ-1' })
      expect(r.projectIdChecked).toBe(false)
      expect(r.status).toBe('pass') // nothing else diverges
      expect(r.message).toContain('scope check not applicable')
    } finally {
      store.close()
    }
  })
})

describe('checkDualTruthConsistency — the sample bound + probe failure', () => {
  it('maxSample bounds the probe (checked says exactly what was probed)', () => {
    const { store } = freshDb()
    try {
      // a divergence on WS-3 that the sample of 1 will NOT see
      store.appendEvents([
        {
          eventId: 'H-1',
          ownerWorkstreamId: 'WS-3',
          eventType: 'RUN_STARTED',
          schemaVersion: 1,
          occurredAt: 1_700_000_000_000,
          actor: { kind: 'USER' },
          payload: { run_id: 'R-1' },
        },
      ])
      const r = checkDualTruthConsistency({ store, tree: makeTree(), projectId: 'PRJ-1', maxSample: 1 })
      expect(r.checked).toEqual(['WS-1'])
      expect(r.findings).toEqual([]) // the WS-3 divergence is outside the sample
      expect(DEFAULT_CONSISTENCY_SAMPLE).toBe(16)
    } finally {
      store.close()
    }
  })

  it('an unparseable row (a store error on read) → unrecoverable, loud (not silent)', () => {
    const { dbPath, store } = freshDb()
    try {
      // A raw INSERT bypasses the store's strict-JSON gate (INSERT is
      // allowed — the triggers block UPDATE/DELETE only): a row whose
      // actor JSON is garbage → getEvent's parse fails with STORE_CORRUPT.
      const raw = new DatabaseSync(dbPath)
      raw.exec(
        "INSERT INTO history_event (event_id, owner_workstream_id, event_seq, event_type, schema_version, occurred_at, recorded_at, actor, source, payload) " +
          "VALUES ('H-RAW', 'WS-1', 1, 'RUN_STARTED', 1, 1700000000000, 1700000000000, '{not json', NULL, '{}')",
      )
      raw.close()
      const r = checkDualTruthConsistency({ store, tree: makeTree(), projectId: 'PRJ-1' })
      expect(r.status).toBe('unrecoverable')
      expect(r.checked).toEqual(['WS-1'])
      expect(r.message).toContain('STORE_CORRUPT')
      expect(r.guidance.join('\n')).toContain('TC-DB-002')
    } finally {
      store.close()
    }
  })
})
