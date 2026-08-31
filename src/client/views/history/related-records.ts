/**
 * UI-7 (B §26 — Records 上下文入口) — the PURE projections behind the
 * context entry:
 *  - `semanticRecordRef`: which record (if any) a history event is about —
 *    the seven D §13 semantic event types (FACT/CLAIM/ARTIFACT rows are
 *    keyed directly; RELATION rows carry a ref when an endpoint is a
 *    record kind — the SOURCE first, the event's primary endpoint);
 *  - `relatedRecordCount`: how many derived records relate to that ref —
 *    the client-side mirror of the host `queryRecords` `relatedObject`
 *    match (an ACTIVE edge either direction, or a `references` entry in
 *    the bare-id or `KIND:ID` form). Display-only input for the B §26
 *    「Related Records (n)」 badge; the AUTHORITY stays the host query.
 *
 * ZERO store / RPC knowledge: `HistoryTimelineView` (the container)
 * passes the wire event row + the workstream's derived-records slice
 * data; the EventRow stays a pure props component.
 *
 * No DSH imports (INV-PERM-5).
 */

import type {
  HistoryEventDto,
  SemanticEndpointRef,
  SemanticRecordDto,
} from '../../../shared/rpc-contracts.js'

/** The three record kinds (semantic objects with a record row). */
type RecordKind = 'FACT' | 'CLAIM' | 'ARTIFACT'

/** Non-relation semantic event → the payload key carrying the record id. */
const EVENT_RECORD_KEY: Readonly<Record<string, { kind: RecordKind; key: string }>> = {
  FACT_RECORDED: { kind: 'FACT', key: 'fact_id' },
  CLAIM_RECORDED: { kind: 'CLAIM', key: 'claim_id' },
  CLAIM_RETRACTED: { kind: 'CLAIM', key: 'claim_id' },
  ARTIFACT_REGISTERED: { kind: 'ARTIFACT', key: 'artifact_id' },
  ARTIFACT_MARKED_MISSING: { kind: 'ARTIFACT', key: 'artifact_id' },
}

/** One `{kind, id}` payload endpoint (structural narrowing of `unknown`). */
interface PayloadRef {
  readonly kind: string
  readonly id: string
}

function isPayloadRef(v: unknown): v is PayloadRef {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as PayloadRef).kind === 'string' &&
    (v as PayloadRef).kind !== '' &&
    typeof (v as PayloadRef).id === 'string' &&
    (v as PayloadRef).id !== ''
  )
}

/**
 * The record a history event is about (B §26 context entry). `null` =
 * the event has no record context (non-semantic event, or a relation
 * whose endpoints are all non-record kinds — e.g. TASK↔TASK).
 * @param event - one wire history row (frozen envelope, decoded payload).
 * @returns the primary record ref, or `null`.
 */
export function semanticRecordRef(event: HistoryEventDto): SemanticEndpointRef | null {
  const mapped = EVENT_RECORD_KEY[event.eventType]
  if (mapped !== undefined) {
    const id = event.payload[mapped.key]
    return typeof id === 'string' && id !== '' ? { kind: mapped.kind, id } : null
  }
  if (event.eventType === 'RELATION_ADDED' || event.eventType === 'RELATION_REMOVED') {
    const source = event.payload['source']
    const target = event.payload['target']
    for (const endpoint of [source, target]) {
      if (isPayloadRef(endpoint)) {
        // The wire kind is the frozen endpoint-kind union; only the record
        // kinds have a row (the host is the authority — the ref lands as a
        // `relatedObject` filter the query applies).
        if (endpoint.kind === 'FACT' || endpoint.kind === 'CLAIM' || endpoint.kind === 'ARTIFACT') {
          return { kind: endpoint.kind, id: endpoint.id }
        }
      }
    }
  }
  return null
}

/**
 * Count the records related to `ref` — the exact client mirror of the
 * host `matchesRelated` (query.ts): an ACTIVE relation edge touching the
 * record whose OTHER endpoint is `ref`, or a `references` entry equal to
 * the bare id or the `KIND:ID` serialization.
 * @param records - the workstream's derived record DTOs (the full set).
 * @param ref - the record the context entry points at.
 * @returns the related record count (0 = no badge, B §26 「可以显示」).
 */
export function relatedRecordCount(
  records: readonly SemanticRecordDto[],
  ref: SemanticEndpointRef,
): number {
  const qualified = `${ref.kind}:${ref.id}`
  return records.filter(
    r =>
      r.relations.some(e => e.other.kind === ref.kind && e.other.id === ref.id) ||
      r.references.some(s => s === ref.id || s === qualified),
  ).length
}
