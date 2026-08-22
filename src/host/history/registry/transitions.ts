/**
 * WP-2.2 — the §13 legal transition tables (DOMAIN_SCHEMA.md §13 「状态机定义」)
 * as consumed by the typed event registry.
 *
 * The §13 table is the frozen source of legal (from, to) pairs. It is wider
 * than the event catalog: management operations (e.g. milestone/edge DROPPED,
 * artifact MISSING→REGISTERED 「找回经用户操作恢复」) and derived states
 * (gate READY_FOR_REVIEW) live in the table but have NO HistoryEvent of their
 * own in the §4 catalog — the registry only consults the table for the pairs
 * its events declare (see EventTransition in types.ts), so table rows without
 * an event are inert here by construction.
 *
 * `acSnapshot` (ACCEPTANCE_CRITERIA_CHANGED) has no state machine: it is a
 * text-snapshot change whose only transition rule is `from` = current derived
 * snapshot (INV-HIST-5) — it is deliberately NOT a key of LEGAL_TRANSITIONS.
 *
 * Pure data + pure lookups (zero I/O).
 */

import type { StateMachine } from './types.js'

/** The machines that have a §13 table (`acSnapshot` excluded). */
export type TabledMachine = Exclude<StateMachine, 'acSnapshot'>

/**
 * The frozen §13 legal-transition table, keyed (machine → from → legal tos).
 * Terminal states map to `[]`.
 */
export const LEGAL_TRANSITIONS: Readonly<Record<TabledMachine, Readonly<Record<string, readonly string[]>>>> = {
  // Task execution (§13 L542): EXECUTED/CANCELLED terminal.
  taskExecution: {
    PLANNED: ['ACTIVE', 'EXECUTED', 'CANCELLED'],
    ACTIVE: ['PAUSED', 'EXECUTED', 'CANCELLED'],
    PAUSED: ['ACTIVE', 'EXECUTED', 'CANCELLED'],
    EXECUTED: [],
    CANCELLED: [],
  },
  // Task validation (§13 L543): re-validation loops back to PENDING.
  taskValidation: {
    NOT_REQUIRED: ['PENDING'],
    PENDING: ['UNDER_REVIEW', 'NOT_REQUIRED'],
    UNDER_REVIEW: ['PASSED', 'FAILED'],
    PASSED: ['PENDING'],
    FAILED: ['PENDING'],
  },
  // Run (§13 L547): RUNNING → FINISHED|FAILED|CANCELLED (terminal).
  run: {
    RUNNING: ['FINISHED', 'FAILED', 'CANCELLED'],
    FINISHED: [],
    FAILED: [],
    CANCELLED: [],
  },
  // Claim (§13 L556): ACTIVE → RETRACTED (terminal).
  claim: {
    ACTIVE: ['RETRACTED'],
    RETRACTED: [],
  },
  // Artifact (§13 L557): REGISTERED ↔ MISSING (MISSING 经事件标记; 找回经用户操作).
  artifact: {
    REGISTERED: ['MISSING'],
    MISSING: ['REGISTERED'],
  },
  // Milestone (§13 L546): PLANNED → ACHIEVED (event) / DROPPED (management).
  milestone: {
    PLANNED: ['ACHIEVED', 'DROPPED'],
    ACHIEVED: [],
    DROPPED: [],
  },
  // Gate (§13 L545): evaluation is repeatable; the stored states are
  // PLANNED (no evaluation yet) and the three results. READY_FOR_REVIEW is
  // derived and never stored.
  gate: {
    PLANNED: ['PASSED', 'FAILED', 'WAIVED'],
    PASSED: ['PASSED', 'FAILED', 'WAIVED'],
    FAILED: ['PASSED', 'FAILED', 'WAIVED'],
    WAIVED: ['PASSED', 'FAILED', 'WAIVED'],
  },
  // Relation (§8 derived status): REMOVED via RELATION_REMOVED (new event, INV-HIST-7).
  relation: {
    ACTIVE: ['REMOVED'],
    REMOVED: [],
  },
  // TopologyEdge (§13 L548): PLANNED → REALIZED via the realize events;
  // DROPPED is user-only management.
  topologyEdge: {
    PLANNED: ['REALIZED', 'DROPPED'],
    REALIZED: ['DROPPED'],
    DROPPED: [],
  },
}

/** The legal target states of `from` on `machine` (`[]` = terminal). */
export function legalTargets(machine: TabledMachine, from: string): readonly string[] {
  return LEGAL_TRANSITIONS[machine][from] ?? []
}

/** True iff `from -> to` appears in the §13 table for `machine` (INV-TASK-1). */
export function isLegalTransition(machine: TabledMachine, from: string, to: string): boolean {
  return legalTargets(machine, from).includes(to)
}
