// V2-UI-0.4 UI-7 (D2) — registerArtifact (ARTIFACT_REGISTERED) +
// markArtifactMissing (ARTIFACT_MARKED_MISSING, D §13.2): BY REFERENCE
// (D §13.6 — the file is never copied), the frozen 7-type pin, the
// supersedes/related-task preconditions, and the V1 one-way state
// machine (REGISTERED → MISSING, ADJ-10).

import { describe, expect, it } from 'vitest'
import { makeService, readSemanticRow, countEvents, findEvent } from './harness.js'
import { expectCarrierCode, countDerivedKind } from './helpers.js'

const SEVEN = ['DATASET', 'FIGURE', 'MODEL', 'CODE', 'REPORT', 'NOTE', 'OTHER'] as const

describe('registerArtifact (D §13.2 / §13.6 BY REFERENCE)', () => {
  it('registers an artifact: A-1 / H-1, REGISTERED, uri stored verbatim (no copy)', () => {
    const h = makeService()
    try {
      const res = h.service.registerArtifact({
        workstreamId: 'WS-1',
        type: 'MODEL',
        title: 'baseline checkpoint',
        uri: 'file:///data/checkpoints/baseline.pt',
        contentHash: 'sha256:abc',
        relatedTaskId: 'T-1',
      })
      expect(res.artifactId).toBe('A-1')
      expect(res.workstreamId).toBe('WS-1')
      expect(res.type).toBe('MODEL')
      expect(res.title).toBe('baseline checkpoint')
      expect(res.uri).toBe('file:///data/checkpoints/baseline.pt')
      expect(res.status).toBe('REGISTERED')
      expect(res.eventId).toBe('H-1')

      const row = readSemanticRow(h.store, h.projectId)!.artifacts.get('A-1')
      expect(row !== undefined).toBe(true)
      expect(row!.workstream_id).toBe('WS-1')
      expect(row!.type).toBe('MODEL')
      expect(row!.uri).toBe('file:///data/checkpoints/baseline.pt')
      expect(row!.content_hash).toBe('sha256:abc')
      expect(row!.related_task).toBe('T-1')
      expect(row!.status).toBe('REGISTERED')
      // The derived ArtifactRow carries NO created_by column (frozen
      // shape) — the actor lives on the EVENT envelope, not the row.
      expect(typeof row!.recorded_at).toBe('number')

      const ev = findEvent(h.store, 'H-1')!
      expect(ev.eventType).toBe('ARTIFACT_REGISTERED')
      expect(ev.payload).toMatchObject({
        artifact_id: 'A-1',
        type: 'MODEL',
        title: 'baseline checkpoint',
        uri: 'file:///data/checkpoints/baseline.pt',
        content_hash: 'sha256:abc',
        related_task: 'T-1',
      })
      expect(ev.actor).toEqual({ kind: 'USER' })
      expect(countDerivedKind(h.store, 'management_action')).toBe(0)
    } finally {
      h.close()
    }
  })

  it('all 7 frozen artifact types are accepted (type pin)', () => {
    const h = makeService()
    try {
      SEVEN.forEach((type, i) => {
        const res = h.service.registerArtifact({
          workstreamId: 'WS-1',
          type,
          title: `t-${i}`,
          uri: `file:///data/${i}`,
        })
        expect(res.type).toBe(type)
        expect(res.status).toBe('REGISTERED')
      })
      const state = readSemanticRow(h.store, h.projectId)!
      expect([...state.artifacts.values()].map((a) => a.type)).toEqual(SEVEN)
    } finally {
      h.close()
    }
  })

  it('empty title / empty uri ⇒ INVALID_PAYLOAD, NO event row', () => {
    const h = makeService()
    try {
      expectCarrierCode(
        () => h.service.registerArtifact({ workstreamId: 'WS-1', type: 'NOTE', title: '', uri: 'file:///x' }),
        'INVALID_PAYLOAD',
      )
      expectCarrierCode(
        () => h.service.registerArtifact({ workstreamId: 'WS-1', type: 'NOTE', title: 'x', uri: '' }),
        'INVALID_PAYLOAD',
      )
      expect(countEvents(h.store, 'WS-1')).toBe(0)
    } finally {
      h.close()
    }
  })

  it('supersedes must name an EXISTING artifact (catalog §5.4)', () => {
    const h = makeService()
    try {
      expectCarrierCode(
        () => h.service.registerArtifact({ workstreamId: 'WS-1', type: 'NOTE', title: 'x', uri: 'file:///x', supersedes: 'A-9' }),
        'OBJECT_NOT_FOUND',
      )
      // The failed write burned A-1 + H-1 (reserve happens BEFORE the
      // pre-check; the release leaves a legal gap — §1.1 monotonic).
      const first = h.service.registerArtifact({ workstreamId: 'WS-1', type: 'NOTE', title: 'v1', uri: 'file:///v1' })
      expect(first.artifactId).toBe('A-2')
      const second = h.service.registerArtifact({
        workstreamId: 'WS-1',
        type: 'NOTE',
        title: 'v2',
        uri: 'file:///v2',
        supersedes: first.artifactId,
      })
      expect(second.artifactId).toBe('A-3')
      const row = readSemanticRow(h.store, h.projectId)!.artifacts.get(second.artifactId)
      expect(row!.supersedes).toBe(first.artifactId)
    } finally {
      h.close()
    }
  })

  it('related_task must be a T-id of the SAME workstream (catalog §5.4)', () => {
    const h = makeService()
    try {
      // T-5 belongs to WS-2; registering it under WS-1 is an owner mismatch.
      expectCarrierCode(
        () => h.service.registerArtifact({ workstreamId: 'WS-1', type: 'NOTE', title: 'x', uri: 'file:///x', relatedTaskId: 'T-5' }),
        'OWNER_MISMATCH',
      )
      // A well-formed T-id that no workstream owns is not found.
      expectCarrierCode(
        () => h.service.registerArtifact({ workstreamId: 'WS-1', type: 'NOTE', title: 'x', uri: 'file:///x', relatedTaskId: 'T-9' }),
        'OBJECT_NOT_FOUND',
      )
      expect(countEvents(h.store, 'WS-1')).toBe(0)
    } finally {
      h.close()
    }
  })
})

describe('markArtifactMissing (D §13.2; V1 one-way ADJ-10)', () => {
  it('marks a REGISTERED artifact MISSING (+ reason)', () => {
    const h = makeService()
    try {
      const a = h.service.registerArtifact({ workstreamId: 'WS-1', type: 'MODEL', title: 't', uri: 'file:///x' })
      const res = h.service.markArtifactMissing({ artifactId: a.artifactId, reason: 'disk full' })
      expect(res.artifactId).toBe('A-1')
      expect(res.status).toBe('MISSING')
      expect(res.eventId).toBe('H-2')

      const row = readSemanticRow(h.store, h.projectId)!.artifacts.get('A-1')
      expect(row!.status).toBe('MISSING')
      const ev = findEvent(h.store, 'H-2')!
      expect(ev.eventType).toBe('ARTIFACT_MARKED_MISSING')
      expect(ev.payload).toMatchObject({ artifact_id: 'A-1', reason: 'disk full' })
    } finally {
      h.close()
    }
  })

  it('marking a missing artifact ⇒ OBJECT_NOT_FOUND, NO event row', () => {
    const h = makeService()
    try {
      expectCarrierCode(() => h.service.markArtifactMissing({ artifactId: 'A-9' }), 'OBJECT_NOT_FOUND')
      expect(countEvents(h.store, 'WS-1')).toBe(0)
    } finally {
      h.close()
    }
  })

  it('marking an already-MISSING artifact ⇒ WRONG_STATE (one-way, ADJ-10)', () => {
    const h = makeService()
    try {
      const a = h.service.registerArtifact({ workstreamId: 'WS-1', type: 'NOTE', title: 't', uri: 'file:///x' })
      h.service.markArtifactMissing({ artifactId: a.artifactId })
      expectCarrierCode(() => h.service.markArtifactMissing({ artifactId: a.artifactId }), 'WRONG_STATE')
      expect(countEvents(h.store, 'WS-1')).toBe(2) // unchanged
    } finally {
      h.close()
    }
  })
})
