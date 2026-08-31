/**
 * UI-7 (D3 / ADJ-2) — the canonical semantic write protocol.
 *
 * The single reserve→precheck→append→commit pipeline every semantic write
 * goes through (BRIEF §3 verbatim):
 *
 *   1. RESERVE the object id (if the write creates a new semantic object)
 *      + the HISTORY_EVENT id (the shared `IdAllocator` — the sequence is
 *      burned on reserve, §1.1 monotonic), then BUILD the payload from
 *      the reserved ids (the payload's `*_id` field carries the object
 *      id);
 *   2. run the optional SERVICE-LEVEL PRE-CHECK (ADJ-3: the UX-layer
 *      structured error, thrown against the derived state read OUTSIDE
 *      the tx). A pre-check failure releases ALL reservations (the id
 *      gaps are legal — §1.1 单调, never reused) and writes NO event row
 *      (test-pinned: pre-validation failure ⇒ zero `history_event` rows);
 *   3. `appendEvents` with the COMPOSED REGISTRY VALIDATE HOOK (ADJ-4:
 *      `options.validate` MUST be the registry `validateEvent` hook — an
 *      invalid batch never reaches the fold seam). Inside the same tx,
 *      the RR-011(b) store seam then applies the semantic incremental
 *      fold EXACTLY ONCE, AFTER the registry hook — the service MUST NOT
 *      compose the fold itself (a second fold would re-apply the event
 *      onto the already-updated state and the reducer would reject it
 *      OBJECT_ALREADY_EXISTS — the t70 live failure);
 *   4. commit both reservations; release on ANY append failure. A
 *      commit failure after a successful append is LOUD (the event is in
 *      the log, the id reservation is unconfirmed — manual
 *      reconciliation; never swallowed).
 *
 * DISCIPLINE (ADJ-4, pinned by unit test): the `validate` option passed
 * to `appendEvents` must be the registry validate hook
 * (`makeValidateHook(registry, buildContext)`) — composing anything
 * weaker (or nothing) lets an invalid batch reach the fold, where the
 * reducer's throw is no longer a structured registry rejection.
 *
 * The UI-5 dependency service DELEGATES to this primitive (ADJ-2: 行为零
 * 变化, 纯结构归位) — its `#addDependencyImpl` / `#removeDependencyImpl`
 * bodies are this pipeline with their own spec (RELATION object kind /
 * HISTORY_EVENT-only, the §5.5 fold pre-check, the dependency ctx
 * builder); the dependency suite all-green is the regression gate.
 */

import type {
  ActorRefJson,
  AppendEventsOptions,
  HistoryEventInput,
  HistoryEventRecord,
  TxScope,
} from '../../persistence/store/types.js'
import type { IdKind, Reservation } from '../../../shared/ids/index.js'

/** The composed registry validate hook (ADJ-4). */
export type SemanticValidateHook = (events: readonly HistoryEventRecord[], tx: TxScope) => void

export interface CanonicalSemanticAppendResult {
  /** The reserved (and committed) object id (`undefined` for
   *  HISTORY_EVENT-only writes). */
  readonly objectId?: string
  /** The reserved (and committed) history-event id. */
  readonly eventId: string
  /** The live reservations (committed on success; released on failure —
   *  exposed for test observability of the reservation lifecycle). */
  readonly reservations: readonly Reservation[]
}

/** The reserved ids handed to `buildPayload` / `precheck` (the payload's
 *  `*_id` field carries the reserved object id; the pre-check validates
 *  the candidate event built from the same ids). */
export interface CanonicalAppendIds {
  /** `undefined` for HISTORY_EVENT-only writes. */
  readonly objectId?: string
  readonly eventId: string
}

/** The canonical append spec (one semantic write). */
export interface CanonicalSemanticAppendSpec {
  /** The object kind reserved with the write (`FACT` / `CLAIM` /
   *  `ARTIFACT` / `RELATION`). `undefined` = a HISTORY_EVENT-only write
   *  (no new semantic object: retract / missing / remove). */
  readonly objectKind?: IdKind
  /** The frozen event type name (one of the seven semantic events). */
  readonly eventType: string
  /** The owner workstream (the event's `ownerWorkstreamId`). */
  readonly ownerWorkstreamId: string
  /** The `occurredAt` clock value (epoch ms, resolved by the caller). */
  readonly occurredAt: number
  /** The actor envelope (the store's opaque JSON carrier —
   *  `{kind:'USER'}` for the management face; the domain's narrower
   *  `ActorRefDoc` is assignable). */
  readonly actor: ActorRefJson
  /** Build the frozen snake_case payload (the CATALOG §5.3–5.5 shape)
   *  from the reserved ids — run AFTER the reservations, BEFORE the
   *  pre-check. */
  readonly buildPayload: (ids: CanonicalAppendIds) => Record<string, unknown>
  /** The COMPOSED REGISTRY VALIDATE HOOK (ADJ-4 — see module header). */
  readonly validate: SemanticValidateHook
  /** Optional service-level pre-check (ADJ-3): run AFTER the
   *  reservations (with the reserved ids), BEFORE the append; a throw
   *  releases everything and writes no event row. */
  readonly precheck?: (ids: CanonicalAppendIds) => void
  /** Label for the commit-failure reconciliation error. */
  readonly label: string
}

/** The minimal allocator face the pipeline drives. */
export interface CanonicalAllocatorPort {
  reserve(kind: IdKind, projectId: string): Reservation
  commit(reservation: Reservation): void
  release(reservation: Reservation): void
}

/** The minimal store face the pipeline drives. */
export interface CanonicalStorePort {
  appendEvents(
    events: readonly HistoryEventInput[],
    options?: AppendEventsOptions,
  ): unknown
}

/**
 * Run the canonical semantic append (module header for the pipeline).
 *
 * @throws the pre-check / registry / fold error UNTOUCHED (reservations
 *   released) — the caller's error mapper owns the carrier; a commit
 *   failure after a successful append throws the loud manual-
 *   reconciliation error.
 */
export function canonicalSemanticAppend(
  deps: { readonly allocator: CanonicalAllocatorPort; readonly store: CanonicalStorePort; readonly projectId: string },
  spec: CanonicalSemanticAppendSpec,
): CanonicalSemanticAppendResult {
  const { allocator, store, projectId } = deps
  const reservations: Reservation[] = []
  if (spec.objectKind !== undefined) {
    reservations.push(allocator.reserve(spec.objectKind, projectId))
  }
  reservations.push(allocator.reserve('HISTORY_EVENT', projectId))
  const objectRes = spec.objectKind !== undefined ? reservations[0] : undefined
  const eventRes = reservations[reservations.length - 1]

  const releaseAll = (): void => {
    for (const res of reservations) {
      try {
        allocator.release(res)
      } catch {
        /* 释放失败不掩盖主失败 — 号已烧（§1.1 单调, gap 合法） */
      }
    }
  }

  const ids: CanonicalAppendIds = {
    objectId: objectRes?.id,
    eventId: eventRes.id,
  }
  const payload = spec.buildPayload(ids)

  const event: HistoryEventInput = {
    eventId: eventRes.id,
    ownerWorkstreamId: spec.ownerWorkstreamId,
    eventType: spec.eventType,
    schemaVersion: 1,
    occurredAt: spec.occurredAt,
    actor: spec.actor,
    payload,
  }

  try {
    spec.precheck?.(ids)
  } catch (e) {
    releaseAll()
    throw e
  }

  try {
    store.appendEvents([event], { validate: spec.validate })
  } catch (e) {
    releaseAll()
    throw e
  }

  try {
    if (objectRes !== undefined) {
      allocator.commit(objectRes)
    }
    allocator.commit(eventRes)
  } catch (e) {
    const objectPart = objectRes !== undefined ? ` / object ${objectRes.id}` : ''
    throw new Error(
      `${spec.label}: ${spec.eventType} ${eventRes.id} was appended to ${spec.ownerWorkstreamId} but the allocator commit failed${objectPart} — the event is in the log, the id reservation is unconfirmed (manual reconciliation): ${e instanceof Error ? e.message : String(e)}`,
      { cause: e },
    )
  }

  return {
    objectId: objectRes?.id,
    eventId: eventRes.id,
    reservations,
  }
}
