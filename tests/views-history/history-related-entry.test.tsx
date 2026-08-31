/**
 * UI-7 (B §26 — Records 上下文入口) — the History timeline's Related
 * Records entry (jsdom + testing-library, same data path as the WP-4.4
 * suite: `createResearchStore` over the controllable fixture facade).
 *
 * The context entry is OPT-IN via the container's `onShowRelated` prop:
 *  - wired: the container LAZY-LOADS the workstream's derived-records
 *    slice (one bare `queryRecords` — the same slice the Records face
 *    uses) and each record-bearing event row gains a 「Related Records
 *    (n)」 button (the count is the client mirror of the host's
 *    `relatedObject` match); the button fires the callback with the
 *    row's record ref (the console deep-links the Records tab);
 *  - absent: ZERO records RPC (the legacy face is untouched — the
 *    fixture's `queryRecords` stays a loud `notUsed`).
 *
 * `afterEach(cleanup)` is explicit (the repo's vitest config has no
 * `globals: true`).
 */

// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HistoryTimelineView } from '../../src/client/views/history/index.js'
import type { ResearchStore } from '../../src/client/stores/index.js'
import type { SemanticEndpointRef, SemanticRecordDto } from '../../src/shared/rpc-contracts.js'
import { makeEvent, makeHistoryFacade, storeOver, T0, type HistoryFacade } from './fixtures.js'

/* -- the scenario: one fact, one edge into it, one non-semantic event -- */

const LOG = [
  makeEvent({
    eventId: 'H-1',
    eventType: 'FACT_RECORDED',
    schemaVersion: 1,
    occurredAt: T0,
    recordedAt: T0 + 1_000,
    eventSeq: 1,
    payload: { fact_id: 'F-1', statement: 'Alpha: model converged at epoch 12', references: ['T-1'] },
  }),
  makeEvent({
    eventId: 'H-2',
    eventType: 'RELATION_ADDED',
    schemaVersion: 1,
    occurredAt: T0 + 2_000,
    recordedAt: T0 + 3_000,
    eventSeq: 2,
    payload: {
      relation_id: 'REL-1',
      source: { kind: 'CLAIM', id: 'C-1' },
      relation_type: 'SUPPORTED_BY',
      target: { kind: 'FACT', id: 'F-1' },
    },
  }),
  makeEvent({
    eventId: 'H-3',
    eventType: 'RUN_STARTED',
    schemaVersion: 1,
    occurredAt: T0 + 4_000,
    recordedAt: T0 + 5_000,
    eventSeq: 3,
    payload: { run_id: 'R-1' },
  }),
]

/** The derived records: F-1 (referenced by T-1, edge-in from C-1) and
 *  C-1 (the edge-out). Nothing else. */
const RECORDS: SemanticRecordDto[] = [
  {
    id: 'F-1',
    type: 'FACT',
    workstreamId: 'WS-1',
    statement: 'Alpha: model converged at epoch 12',
    status: 'ACTIVE',
    recordedAt: T0,
    references: ['T-1'],
    relations: [
      { relationId: 'REL-1', relationType: 'SUPPORTED_BY', direction: 'in', other: { kind: 'CLAIM', id: 'C-1' } },
    ],
  },
  {
    id: 'C-1',
    type: 'CLAIM',
    workstreamId: 'WS-1',
    statement: 'Alpha is better than beta',
    status: 'ACTIVE',
    recordedAt: T0 + 2_000,
    references: [],
    relations: [
      { relationId: 'REL-1', relationType: 'SUPPORTED_BY', direction: 'out', other: { kind: 'FACT', id: 'F-1' } },
    ],
  },
]

/** The Related Records button of one event row (or null). */
function relatedButton(container: HTMLElement, eventId: string): HTMLButtonElement | null {
  const row = Array.from(container.querySelectorAll('li')).find(li =>
    (li.textContent ?? '').includes(`· ${eventId}`),
  )
  if (row === undefined) throw new Error(`row for ${eventId} not found`)
  return row.querySelector<HTMLButtonElement>('[data-event-related]')
}

describe('HistoryTimelineView — the B §26 Related Records context entry', () => {
  let facade: HistoryFacade
  let store: ResearchStore

  beforeEach(() => {
    facade = makeHistoryFacade(LOG, RECORDS)
    store = storeOver(facade.rpc)
  })
  afterEach(cleanup)

  it('wired: lazy-loads the records slice ONCE (bare) and renders the badge with the mirrored count', async () => {
    const onShowRelated = vi.fn((ref: SemanticEndpointRef) => {
      void ref
    })
    const { container } = render(<HistoryTimelineView store={store} workstreamId="WS-1" onShowRelated={onShowRelated} />)

    await screen.findByText(/· H-3/)
    // The FACT_RECORDED row gets the entry: one record relates to F-1
    // (C-1 via the ACTIVE edge; the reference is on T-1, not F-1).
    const factButton = relatedButton(container, 'H-1')
    expect(factButton).not.toBeNull()
    expect(factButton!.dataset.relatedRef).toBe('FACT:F-1')
    expect(factButton!.textContent).toBe('Related Records (1)')
    // The RELATION row resolves to its SOURCE (the record kind first).
    const relButton = relatedButton(container, 'H-2')
    expect(relButton).not.toBeNull()
    expect(relButton!.dataset.relatedRef).toBe('CLAIM:C-1')
    expect(relButton!.textContent).toBe('Related Records (1)')
    // The non-semantic row never shows the entry.
    expect(relatedButton(container, 'H-3')).toBeNull()
    // ONE bare lazy load — the same slice the Records face reads.
    expect(facade.recordCalls).toEqual([{ workstreamId: 'WS-1' }])
  })

  it('wired: clicking the entry fires the callback with THAT row’s record ref', async () => {
    const onShowRelated = vi.fn()
    const { container } = render(<HistoryTimelineView store={store} workstreamId="WS-1" onShowRelated={onShowRelated} />)

    // Both badges share the label 「Related Records (1)」 — address the
    // rows by their event id (the dataset carries the exact ref).
    await waitFor(() => expect(relatedButton(container, 'H-1')).not.toBeNull())

    fireEvent.click(relatedButton(container, 'H-1')!)
    expect(onShowRelated).toHaveBeenCalledTimes(1)
    expect(onShowRelated).toHaveBeenCalledWith({ kind: 'FACT', id: 'F-1' })

    // The second badge (the relation row → CLAIM:C-1) fires its own ref.
    fireEvent.click(relatedButton(container, 'H-2')!)
    expect(onShowRelated).toHaveBeenCalledTimes(2)
    expect(onShowRelated).toHaveBeenLastCalledWith({ kind: 'CLAIM', id: 'C-1' })
  })

  it('absent: ZERO records RPC and no entry (the legacy face is untouched)', async () => {
    const { container } = render(<HistoryTimelineView store={store} workstreamId="WS-1" />)

    await screen.findByText(/· H-3/)
    expect(facade.recordCalls).toHaveLength(0)
    expect(container.querySelector('[data-event-related]')).toBeNull()
  })

  it('wired: a record NOTHING relates to gets no badge (count 0 stays hidden)', async () => {
    facade = makeHistoryFacade(LOG, [
      {
        id: 'F-1',
        type: 'FACT',
        workstreamId: 'WS-1',
        statement: 'isolated fact',
        status: 'ACTIVE',
        recordedAt: T0,
        references: [],
        relations: [],
      },
    ])
    store = storeOver(facade.rpc)

    const { container } = render(<HistoryTimelineView store={store} workstreamId="WS-1" onShowRelated={vi.fn()} />)

    await screen.findByText(/· H-3/)
    expect(facade.recordCalls).toEqual([{ workstreamId: 'WS-1' }])
    expect(relatedButton(container, 'H-1')).toBeNull()
    expect(relatedButton(container, 'H-2')).toBeNull()
  })
})
