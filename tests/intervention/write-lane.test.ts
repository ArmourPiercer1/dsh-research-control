/**
 * G4 (attention write lane) — the intervention creation pipeline against a
 * FILLED validation context (BASELINE_PLAN §2b: the real gap was never the
 * frozen event checks — tests/intervention/service.test.ts already pins the
 * registry's AGENT run / existence behavior — it is the VALIDATION CONTEXT
 * the service sees: production wiring must supply the real run/semantic/
 * tree maps, and the §16 规则 2 write-time reference check must cover
 * source_refs, not only the workstream_ids).
 *
 * Pins here (service level, real registry + real store):
 *  - source_refs typedRef existence over the INJECTED maps (FACT/CLAIM/
 *    ARTIFACT/TASK/RUN/WORKSTREAM — the registry's workstream-local set),
 *    fired BEFORE any reservation (zero row, zero event, zero queue entry);
 *  - a kind the V1 snapshot does not model (registry: 「non-WS-local kinds
 *    are not modeled in the V1 snapshot」, e.g. PLAN_FORK) keeps the frozen
 *    shape-only treatment — no invented stricter policy;
 *  - the no-event lane (无 WS 关联不发事件, TC-DOM-023): with maps injected
 *    the §16 pre-check still guards; with no map for a kind the historical
 *    shape-only behavior stands (and with a WS association the frozen
 *    registry still rejects loudly — pinned);
 *  - the USER lane is UNCHANGED (GUI/inbox regression);
 *  - multiWS queue semantics unchanged (owner = first WS).
 */

import { afterAll, describe, expect, it } from 'vitest'

import type { ArtifactSnapshot, ClaimSnapshot, FactSnapshot, TaskSnapshot } from '../../src/host/history/registry/index.js'
import { makeInterventionHarness, throwsIntervention, type InterventionHarness } from './fixtures.js'

const harnesses: InterventionHarness[] = []

function harness(): InterventionHarness {
  const h = makeInterventionHarness()
  harnesses.push(h)
  return h
}

afterAll(() => {
  for (const h of harnesses) h.close()
})

const AGENT = { kind: 'AGENT', run_id: 'R-1', label: 'agent' } as const

describe('G4 source_refs typedRef existence over the injected validation context', () => {
  it('an existing FACT (facts map injected) creates the intervention and rides the frozen event payload', () => {
    const h = harness()
    Object.assign(h.external, { facts: new Map<string, FactSnapshot>([['F-1', { workstreamId: 'WS-1' }]]) })

    const result = h.service.createMechanicalIntervention(
      {
        title: 'FACT 证据与计划假设冲突，需人工判断',
        trigger: 'AGENT_REPORT_REQUIRES_HUMAN',
        workstream_ids: ['WS-1'],
        source_refs: [{ kind: 'FACT', id: 'F-1' }],
      },
      AGENT,
    )
    expect(result.eventId).not.toBeNull()
    expect(result.intervention.source_refs).toEqual([{ kind: 'FACT', id: 'F-1' }])
    const ev = h.dbPair.store.listRange('WS-1', 1)[0]!
    expect(ev.eventType).toBe('INTERVENTION_CREATED')
    // the anchored WORKSTREAM ref stays first (owner derivation), the record refs follow
    const refs = (ev.payload as { source_refs: { kind: string; id: string }[] }).source_refs
    expect(refs.some((r) => r.kind === 'FACT' && r.id === 'F-1')).toBe(true)
    expect(h.service.listOpen().map((r) => r.id)).toContain(result.intervention.id)
  })

  it('a FACT absent from the injected facts map ⇒ IV_INPUT pre-check — zero row, zero event (with WS)', () => {
    const h = harness()
    Object.assign(h.external, { facts: new Map<string, FactSnapshot>([['F-1', { workstreamId: 'WS-1' }]]) })

    throwsIntervention(
      () =>
        h.service.createMechanicalIntervention(
          {
            title: 't',
            trigger: 'AGENT_REPORT_REQUIRES_HUMAN',
            workstream_ids: ['WS-1'],
            source_refs: [{ kind: 'FACT', id: 'F-404' }],
          },
          AGENT,
        ),
      'IV_INPUT',
      /FACT "F-404"/,
    )
    expect(h.lifecycle.listInterventions()).toHaveLength(0)
    expect(h.dbPair.store.listRange('WS-1', 1)).toHaveLength(0)
  })

  it('the no-event lane is guarded too: absent FACT + NO workstream association ⇒ still IV_INPUT (§16 规则 2)', () => {
    const h = harness()
    Object.assign(h.external, { facts: new Map<string, FactSnapshot>([['F-1', { workstreamId: 'WS-1' }]]) })

    throwsIntervention(
      () =>
        h.service.createMechanicalIntervention(
          {
            title: 't',
            trigger: 'AGENT_REPORT_REQUIRES_HUMAN',
            source_refs: [{ kind: 'FACT', id: 'F-404' }],
          },
          AGENT,
        ),
      'IV_INPUT',
      /FACT "F-404"/,
    )
    expect(h.lifecycle.listInterventions()).toHaveLength(0)
  })

  it('RUN / CLAIM / ARTIFACT / TASK refs hit their injected maps (success + rejection)', () => {
    const h = harness()
    Object.assign(h.external, {
      claims: new Map<string, ClaimSnapshot>([['C-1', { workstreamId: 'WS-1', status: 'ACTIVE' }]]),
      artifacts: new Map<string, ArtifactSnapshot>([['A-1', { workstreamId: 'WS-1', status: 'REGISTERED' }]]),
      tasks: new Map<string, TaskSnapshot>([
        ['T-1', { workstreamId: 'WS-1', execution: 'PLANNED', validation: 'NOT_REQUIRED', acceptanceCriteria: [] }],
      ]),
    })
    // runs map is already present in the harness (R-1/R-2)
    const ok = h.service.createMechanicalIntervention(
      {
        title: '多类型 source refs',
        trigger: 'AGENT_REPORT_REQUIRES_HUMAN',
        workstream_ids: ['WS-1'],
        source_refs: [
          { kind: 'RUN', id: 'R-1' },
          { kind: 'CLAIM', id: 'C-1' },
          { kind: 'ARTIFACT', id: 'A-1' },
          { kind: 'TASK', id: 'T-1' },
        ],
      },
      AGENT,
    )
    expect(ok.intervention.source_refs).toHaveLength(4)

    throwsIntervention(
      () =>
        h.service.createMechanicalIntervention(
          {
            title: 't',
            trigger: 'AGENT_REPORT_REQUIRES_HUMAN',
            source_refs: [{ kind: 'RUN', id: 'R-99' }],
          },
          AGENT,
        ),
      'IV_INPUT',
      /RUN "R-99"/,
    )
  })

  it('a WORKSTREAM ref hits the existing workstreams map (§16 规则 2 same source)', () => {
    const h = harness()
    throwsIntervention(
      () =>
        h.service.createMechanicalIntervention(
          {
            title: 't',
            trigger: 'AGENT_REPORT_REQUIRES_HUMAN',
            source_refs: [{ kind: 'WORKSTREAM', id: 'WS-9' }],
          },
          AGENT,
        ),
      'IV_INPUT',
      /WORKSTREAM "WS-9"/,
    )
  })
})

describe('G4 the frozen V1 boundary: kinds the snapshot does not model keep shape-only treatment', () => {
  it('PLAN_FORK (non-WS-local) is NOT existence-checked — no invented stricter policy (matches the registry)', () => {
    const h = harness()
    const result = h.service.createMechanicalIntervention(
      {
        title: 'PF flooding 复核',
        trigger: 'AGENT_REPORT_REQUIRES_HUMAN',
        workstream_ids: ['WS-1'],
        source_refs: [{ kind: 'PLAN_FORK', id: 'PF-999' }],
      },
      AGENT,
    )
    expect(result.intervention.source_refs).toEqual([{ kind: 'PLAN_FORK', id: 'PF-999' }])
  })

  it('with NO map injected for a workstream-local kind the historical behavior stands: shape-only when no event is emitted', () => {
    const h = harness()
    // facts NOT injected — the pre-check cannot verify what the context does not model…
    const result = h.service.createMechanicalIntervention(
      {
        title: 't',
        trigger: 'AGENT_REPORT_REQUIRES_HUMAN',
        source_refs: [{ kind: 'FACT', id: 'F-404' }],
      },
      AGENT,
    )
    expect(result.eventId).toBeNull()
    // …and with a WS association the FROZEN registry still rejects loudly (IV_EVENT, existing behavior)
    const h2 = harness()
    throwsIntervention(
      () =>
        h2.service.createMechanicalIntervention(
          {
            title: 't',
            trigger: 'AGENT_REPORT_REQUIRES_HUMAN',
            workstream_ids: ['WS-1'],
            source_refs: [{ kind: 'FACT', id: 'F-404' }],
          },
          AGENT,
        ),
      'IV_EVENT',
      /does not exist/,
    )
    expect(h2.lifecycle.listInterventions()).toHaveLength(0)
  })
})

describe('G4 lanes that must NOT change (regression)', () => {
  it('USER creation (GUI/inbox lane) is unchanged — incl. source_refs it carries today', () => {
    const h = harness()
    const res = h.service.createUserIntervention(
      {
        title: '人工登记',
        workstream_ids: ['WS-1'],
        source_refs: [
          { kind: 'WORKSTREAM', id: 'WS-1' },
          { kind: 'INBOX_ITEM', id: 'IB-1' }, // non-WS-local: shape-only (unchanged)
        ],
      },
      { kind: 'USER', user_id: 'u-1' },
    )
    expect(res.intervention.origin).toBe('USER')
    expect(res.intervention.created_by).toEqual({ kind: 'USER', user_id: 'u-1' })
    expect(res.eventId).not.toBeNull()
  })

  it('multiWS semantics unchanged: owner = first WS, both ids on the row, one event', () => {
    const h = harness()
    const result = h.service.createMechanicalIntervention(
      {
        title: '跨 WS 冲突需人工判断',
        trigger: 'AGENT_REPORT_REQUIRES_HUMAN',
        workstream_ids: ['WS-2', 'WS-1'],
        // a RUN owned by WS-1 referenced on a WS-2-owned intervention: the existing contract checks
        // EXISTENCE for source_refs (registry checkTypedRefs), NOT same-WS — do not invent a rule.
        source_refs: [{ kind: 'RUN', id: 'R-1' }],
      },
      AGENT,
    )
    expect(h.dbPair.store.listRange('WS-2', 1)).toHaveLength(1)
    expect(h.dbPair.store.listRange('WS-1', 1)).toHaveLength(0)
    expect(result.intervention.workstream_ids).toEqual(['WS-2', 'WS-1'])
  })

  it('the AGENT event-path run existence stays with the frozen registry (IV_EVENT, no second gate)', () => {
    const h = harness()
    throwsIntervention(
      () =>
        h.service.createMechanicalIntervention(
          { title: 't', trigger: 'AGENT_REPORT_REQUIRES_HUMAN', workstream_ids: ['WS-1'] },
          { kind: 'AGENT', run_id: 'R-99' } as const,
        ),
      'IV_EVENT',
      /R-99/,
    )
    expect(h.lifecycle.listInterventions()).toHaveLength(0)
  })
})
