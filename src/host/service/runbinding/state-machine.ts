/**
 * WP-2.4 — state machines for the two runbinding objects (frozen §13).
 *
 *  - Run: `RUNNING → FINISHED | FAILED | CANCELLED` (terminal) — the
 *    frozen table already lives in the WP-2.2 registry
 *    (`LEGAL_TRANSITIONS.run`, DOMAIN_SCHEMA §13 L549); this module
 *    REUSES that single source for run-legality queries (no local copy —
 *    drift is impossible) and wraps it in the service-facing check.
 *  - DiscoveredSession: `PENDING → BOUND | DETACHED | IGNORED`
 *    (terminal; after DETACH/IGNORE the same session is never
 *    re-discovered — §13 L554 / TC-DSH-003). The DS machine has no
 *    HistoryEvent (the DS row is an operational record, not a History
 *    object), so the frozen §13 row is coded here; the state-machine
 *    test pins the FULL 4×4 matrix against the §13 literal.
 *
 * Pure logic, zero I/O (layer: service-local domain logic; the service
 * is the only layer that writes, and these helpers write nothing).
 */

import { isLegalTransition, legalTargets } from '../../history/registry/index.js'
import type { RunStatus } from '../../history/registry/index.js'
import type { DsState } from './types.js'
import { RunBindingError } from './types.js'

/* ------------------------------------------------------------------ *
 * Run (§13 L549) — reuses the registry's frozen table
 * ------------------------------------------------------------------ */

/** The frozen legal targets of a run status (terminal ⇒ `[]`). */
export function legalRunTargets(status: RunStatus): readonly RunStatus[] {
  return legalTargets('run', status) as readonly RunStatus[]
}

/** True iff `from → to` is in the frozen §13 run row. */
export function isLegalRunTransition(from: RunStatus, to: RunStatus): boolean {
  return isLegalTransition('run', from, to)
}

/**
 * The service-side guard for the three end operations: the current
 * status must be RUNNING and the target must be its frozen legal
 * terminal. Throws `RB_RUN_NOT_RUNNING` (service taxonomy) — the registry
 * re-checks the implicit-from state at event validation (defense in depth).
 */
export function assertRunCanBeEnded(current: RunStatus, target: Exclude<RunStatus, 'RUNNING'>): void {
  if (current !== 'RUNNING') {
    throw new RunBindingError(
      'RB_RUN_NOT_RUNNING',
      `run is ${current}; only a RUNNING run can move to ${target} (DOMAIN_SCHEMA §13 L549: RUNNING → FINISHED|FAILED|CANCELLED, terminal)`,
    )
  }
  if (!isLegalRunTransition('RUNNING', target)) {
    throw new RunBindingError(
      'RB_RUN_NOT_RUNNING',
      `RUNNING → ${target} is not a legal §13 run transition (legal: ${legalRunTargets('RUNNING').join('|')})`,
    )
  }
}

/* ------------------------------------------------------------------ *
 * DiscoveredSession (§13 L554) — frozen row, coded here
 * ------------------------------------------------------------------ */

/** The frozen §13 L554 DS row: PENDING → BOUND | DETACHED | IGNORED (terminal). */
export const DS_TRANSITIONS: Readonly<Record<DsState, readonly DsState[]>> = {
  PENDING: ['BOUND', 'DETACHED', 'IGNORED'],
  BOUND: [],
  DETACHED: [],
  IGNORED: [],
}

/** True iff `from → to` is in the frozen §13 DS row. */
export function isLegalDsTransition(from: DsState, to: DsState): boolean {
  return DS_TRANSITIONS[from].includes(to)
}

/** The frozen legal targets of a DS state (terminal ⇒ `[]`). */
export function legalDsTargets(state: DsState): readonly DsState[] {
  return DS_TRANSITIONS[state]
}

/**
 * The service-side guard for BIND/DETACH/IGNORE: the row must be PENDING
 * (all three frozen targets leave PENDING; every other state is
 * terminal — §13 L554, TC-DSH-003). Throws `RB_DS_NOT_PENDING`.
 */
export function assertDsCanMove(current: DsState, target: Exclude<DsState, 'PENDING'>): void {
  if (!isLegalDsTransition(current, target)) {
    throw new RunBindingError(
      'RB_DS_NOT_PENDING',
      `DiscoveredSession is ${current}; only PENDING can move to ${target} ` +
        `(DOMAIN_SCHEMA §13 L554: PENDING → BOUND|DETACHED|IGNORED, terminal — no re-discovery after DETACH/IGNORE)`,
    )
  }
}
