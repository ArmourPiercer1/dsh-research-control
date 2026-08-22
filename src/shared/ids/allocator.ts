/**
 * Per-project ID allocation — DOMAIN_SCHEMA.md §1.1 规则 2 (L49): 「分配由
 * 插件执行（Project 内单调递增计数器，持久化于 operational DB `meta` 表）」
 * and the registry 唯一性范围 column (Project 内 vs 插件安装内全局).
 *
 * Pure logic, zero I/O (WP-1.6 boundary): the allocator depends ONLY on the
 * structural `IdCounterPort` below — it never touches the meta table, the
 * MetaStore, or any DSH/I/O package. The host-side `MetaStore`
 * (`src/host/persistence/meta`) satisfies this port structurally (verified
 * by tests), and the WP-2.1 sqlite backend must satisfy the SAME port with
 * a genuinely atomic `bumpCounter` — that is the reserved seam.
 *
 * ## reserve / commit / release semantics
 *
 * §1.1 mandates a monotonic counter and forbids reusing issued ids
 * (规则 1 ID 不可变; 规则 3 不得复用/篡改已有 ID) but does NOT define a
 * reserve/commit/release protocol. The semantics implemented here are the
 * simplest ones consistent with those two frozen rules (decision recorded in
 * the WP-1.6 report):
 *
 *   - `reserve(kind, projectId)` — atomically bump the counter for
 *     (uniqueness scope, kind, projectId) and hand out the next sequence.
 *     The sequence is BURNED the moment it is reserved: the counter never
 *     moves back.
 *   - `commit(reservation)` — mark the reserved id live (in use).
 *   - `release(reservation)` — abandon the reservation. The sequence is NOT
 *     returned to the counter (monotonicity + no-reuse), so a RELEASED id
 *     leaves a permanent GAP and can never be handed out again.
 *
 * Uniqueness therefore holds by construction: two `reserve` calls for the
 * same (scope, kind, projectId) always yield distinct sequences because the
 * counter strictly increases. A crash between `reserve` and `commit` burns
 * that sequence (gap) but can never cause a duplicate — consistent with
 * §1.1.
 *
 * commit/release are EXACTLY-ONCE and INSTANCE-BOUND: only the allocator
 * that reserved an id may commit or release it, and only once (the
 * reservation object is the token; a foreign instance's attempt throws).
 * The pending set is per-instance in-memory bookkeeping; the persisted
 * counter is the single source of truth for uniqueness.
 */

import { entryForKind } from './registry.js'
import { makeId } from './construct.js'
import { parseId } from './parse.js'
import type { IdKind } from './types.js'

/**
 * Minimal structural counter port the allocator consumes. Deliberately
 * decoupled from the host `MetaStore`: the shared face stays I/O-free, and
 * this port is the reserved contract the WP-2.1 sqlite backend must meet
 * (with a real atomic `bumpCounter`).
 */
export interface IdCounterPort {
  /**
   * Atomically increase the integer counter stored at `key` by `delta`
   * (default 1) and return the NEW value. A counter that is unset starts at
   * 0, so the first bump yields `delta`.
   */
  bumpCounter(key: string, delta?: number): number
  /** Read the current counter value at `key` (0 when unset). Non-mutating. */
  getCounter(key: string): number
}

/** Lifecycle of a reserved id. */
export type ReservationState = 'reserved' | 'committed' | 'released'

/** One reserved (not yet necessarily live) id. */
export interface Reservation {
  /** The concrete id, e.g. `T-17`. */
  readonly id: string
  /** The kind that was allocated. */
  readonly kind: IdKind
  /** The project id for PROJECT-scoped kinds; `null` for GLOBAL kinds. */
  readonly projectId: string | null
  /** The sequence number that was burned from the counter. */
  readonly sequence: number
  /** Mutable lifecycle state, driven by commit/release. */
  state: ReservationState
}

/** Key namespace for id counters inside the meta table (see module doc). */
export const COUNTER_KEY_PREFIX = 'id-counter'
/** Sentinel scope-part for kinds whose uniqueness scope is 插件安装内全局. */
export const GLOBAL_SCOPE_KEY = 'GLOBAL'

/**
 * Compute the meta-table key for the counter of `kind` within `projectId`.
 *
 *   - GLOBAL scope (Project):  `id-counter:GLOBAL:PROJECT`  (projectId ignored)
 *   - PROJECT scope (others):  `id-counter:<projectId>:<kind>`
 *
 * The GLOBAL key carries no project component because §1.1 makes Project
 * unique across the whole plugin installation, not within a single project.
 */
export function counterKey(kind: IdKind, projectId: string): string {
  const entry = entryForKind(kind)
  const scopePart = entry.scope === 'GLOBAL' ? GLOBAL_SCOPE_KEY : projectId
  return `${COUNTER_KEY_PREFIX}:${scopePart}:${kind}`
}

/** Reservation bookkeeping key: counter slot (counterKey + sequence). */
function slotOf(counterKeyStr: string, sequence: number): string {
  return `${counterKeyStr}:${sequence}`
}

/**
 * The allocator. Inject the counter backend (an `IdCounterPort`); the same
 * instance is safe to interleave in a single thread (each reserve performs a
 * full read-modify-write through the port).
 */
export class IdAllocator {
  private readonly counters: IdCounterPort
  /**
   * Pending reservations, keyed by counter SLOT (counterKey:sequence) —
   * deliberately NOT by id string: the same id string may legitimately
   * exist in different projects (uniqueness scope = project, §1.1), so
   * `T-1` in PRJ-1 and `T-1` in PRJ-2 are distinct reservations.
   */
  private readonly pending = new Map<string, Reservation>()

  constructor(counters: IdCounterPort) {
    this.counters = counters
  }

  /**
   * Reserve the next id for `kind` (uniqueness scoped per the frozen
   * registry). Burns the sequence immediately; the returned reservation is
   * in state `reserved` and must be `commit`-ed or `release`-d.
   *
   * @throws on a malformed projectId for PROJECT-scoped kinds, or when the
   *   counter backend reports a non-integer value (corruption).
   */
  reserve(kind: IdKind, projectId: string): Reservation {
    const entry = entryForKind(kind)
    if (entry.scope === 'PROJECT') {
      assertValidProjectId(projectId)
    }
    const key = counterKey(kind, projectId)
    const sequence = this.counters.bumpCounter(key, 1)
    const id = makeId(kind, sequence)
    const reservation: Reservation = {
      id,
      kind,
      projectId: entry.scope === 'GLOBAL' ? null : projectId,
      sequence,
      state: 'reserved',
    }
    const slot = slotOf(key, sequence)
    if (this.pending.has(slot)) {
      // Cannot happen for a correct monotonic counter; guard the invariant.
      throw new Error(`allocator invariant violated: slot ${slot} already reserved`)
    }
    this.pending.set(slot, reservation)
    return reservation
  }

  /**
   * Mark a reserved id live (in use). Exactly once, and only for a
   * reservation created by THIS allocator instance.
   * @throws when the reservation is unknown to this instance or already
   *   committed/released.
   */
  commit(reservation: Reservation): void {
    this.transition(reservation, 'committed')
  }

  /**
   * Abandon a reservation. The sequence is burned (no reuse, monotonic),
   * leaving a permanent gap in the sequence. Exactly once, and only for a
   * reservation created by THIS allocator instance.
   * @throws when the reservation is unknown to this instance or already
   *   committed/released.
   */
  release(reservation: Reservation): void {
    this.transition(reservation, 'released')
  }

  /** Read the current counter for (kind, projectId) without bumping. */
  peek(kind: IdKind, projectId: string): number {
    if (entryForKind(kind).scope === 'PROJECT') {
      assertValidProjectId(projectId)
    }
    return this.counters.getCounter(counterKey(kind, projectId))
  }

  private slotFor(reservation: Reservation): string {
    // `projectId ?? ''` is safe: for GLOBAL kinds counterKey ignores the
    // project argument; for PROJECT kinds the field is always set.
    return slotOf(counterKey(reservation.kind, reservation.projectId ?? ''), reservation.sequence)
  }

  private transition(reservation: Reservation, next: ReservationState): void {
    const tracked = this.pending.get(this.slotFor(reservation))
    if (tracked !== reservation) {
      throw new Error(
        `reservation ${reservation.id} was not created by this allocator instance; ` +
          `commit/release only the reservations you reserved`,
      )
    }
    if (reservation.state !== 'reserved') {
      throw new Error(
        `reservation ${reservation.id} is already ${reservation.state}; commit/release exactly once`,
      )
    }
    reservation.state = next
  }
}

/**
 * PROJECT-scoped kinds require the counter key to name a real project:
 * `projectId` must be a well-formed `PRJ` id (fail loud at the allocation
 * boundary rather than burning counter space under a garbage key).
 */
function assertValidProjectId(projectId: string): void {
  const parsed = parseId(projectId)
  if (parsed === null || parsed.kind !== 'PROJECT') {
    throw new Error(
      `invalid projectId ${JSON.stringify(projectId)} — PROJECT-scoped kinds require a well-formed PRJ id (DOMAIN_SCHEMA §1.1)`,
    )
  }
}
