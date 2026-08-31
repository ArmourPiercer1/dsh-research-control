/**
 * UI-9 D3 — the single error-state mapping table (B §33.3 / BRIEF D3).
 *
 * One table, every code of the RECON §4.2 nine-group vocabulary (re-anchored
 * at BASE; all codes verified present in `rpc-contracts` / the host):
 *
 *   code -> { group, whatFailedKey, scopeKey?, dataChanged, retryable }
 *
 * - DECODING (NOTE-4): the single string entry is
 *   `extractResearchErrorCarrier` — this module never re-matches a message
 *   string. `resolveErrorStateCode` reads the STRUCTURED carrier the store
 *   already parsed (`ResearchRpcError.code` — a typed field, not a matcher)
 *   and otherwise falls back to the string decoder.
 * - [RETRY] rule: user-initiated re-send of the failed call only (no
 *   automatic retry, ever); offered iff `retryable`. Reads/refreshes are
 *   always retryable; write failures pre-application (dataChanged =
 *   'none') are retryable; 'partial'/'unknown' => NO retry, and the
 *   data-changed line carries the 「数据可能已变更」 wording.
 * - GROUP 8 (partial project creation) keeps the frozen fail-loud
 *   semantics: the LP_* carrier detail is rendered VERBATIM (the mapping
 *   is wording-level only) and no retry is offered.
 * - GROUPS 2/3 (wiring reinitialized / read-only) are driven by the ADJ-11
 *   `integrity` field (host-internal machine codes, D4); the mapping
 *   entries exist here so the four-field rendering is uniform when the
 *   D4 banner surfaces them.
 */

import { extractResearchErrorCarrier } from '../util/error-carrier.js'
import type { CopyKey } from './copy.js'

/** The three B §33.3 data-changed states. */
export type ErrorDataChanged = 'none' | 'partial' | 'unknown'

/**
 * The nine RECON §4.2 error groups — the `data-error-state` attribute
 * values. `'unknown'` is the unmapped-code fallback (not one of the nine).
 */
export type ErrorStateGroup =
  | 'project-unavailable' // group 1 — plane/project state reads
  | 'wiring-reinitialized' // group 2 — ADJ-11 integrity field (host code)
  | 'read-only' // group 3 — ADJ-11 integrity field (host codes)
  | 'git' // group 4 — the Git family
  | 'invalid-relation' // group 5 — relation validation (wired at BASE, UI-5)
  | 'lifecycle' // group 6 — lifecycle/state transitions
  | 'stale' // group 7 — stale canonical targets
  | 'partial-creation' // group 8 — LP_* fail-loud (detail verbatim)
  | 'bind-conflict' // group 9 — atomic pre-application bind checks
  | 'unknown' // fallback — an unmapped code (detail always preserved)

/** One row of the mapping table. */
export interface ErrorStateMapping {
  readonly group: ErrorStateGroup
  /** `error.whatFailed.*` — the "what failed" line. */
  readonly whatFailedKey: CopyKey
  /** `error.scope.*` — the "affected scope" line (omitted when null). */
  readonly scopeKey: CopyKey | null
  readonly dataChanged: ErrorDataChanged
  readonly retryable: boolean
}

function m(
  group: ErrorStateGroup,
  whatFailedKey: CopyKey,
  scopeKey: CopyKey | null,
  dataChanged: ErrorDataChanged,
  retryable: boolean,
): ErrorStateMapping {
  return { group, whatFailedKey, scopeKey, dataChanged, retryable }
}

/**
 * The full table (48 codes: the RECON §4.2 nine-group vocabulary + the
 * three PLANE-family codes RECON left ungrouped, assigned
 * PLANE_ARCHIVED_DIR_MISSING -> group 1, PLANE_TREE_EXISTS /
 * PLANE_NOT_MISSING -> group 9 + the ADJ-11 host-internal codes).
 *
 * dataChanged / retryable by group:
 *  - g1 reads: 'none' + retryable (retry = re-fetch state;
 *    PLANE_SESSION_UNKNOWN doubles as the L-5 cold-start transient);
 *  - g2: 'unknown' + retryable (the re-initialization already happened —
 *    re-fetching is safe); g3: 'unknown' + NOT retryable (session-scoped
 *    state, not transient);
 *  - g4: GIT_TIMEOUT 'unknown' + NOT retryable (a re-send would just
 *    time out again with the side effects unknown); the rest 'none' +
 *    retryable; g5/g6/g7: 'none' + retryable (pre-application
 *    validation — nothing was written);
 *  - g8: 'partial' + NOT retryable (fail-loud frozen semantics);
 *  - g9: 'none' + retryable (atomic pre-application checks).
 */
export const ERROR_STATE_MAP: Readonly<Record<string, ErrorStateMapping>> = {
  /* -- group 1: project unavailable (reads; retry = re-fetch state) -- */
  PLANE_NOT_MANAGED: m('project-unavailable', 'error.whatFailed.projectUnavailable', 'error.scope.project', 'none', true),
  PLANE_SESSION_UNKNOWN: m('project-unavailable', 'error.whatFailed.projectUnavailable', 'error.scope.project', 'none', true),
  PLANE_NOT_ARCHIVED: m('project-unavailable', 'error.whatFailed.projectUnavailable', 'error.scope.project', 'none', true),
  PLANE_ARCHIVED_DIR_MISSING: m('project-unavailable', 'error.whatFailed.projectUnavailable', 'error.scope.project', 'none', true),
  HIER_TREE_BROKEN: m('project-unavailable', 'error.whatFailed.projectUnavailable', 'error.scope.project', 'none', true),
  /* -- group 2: wiring reinitialized (ADJ-11; host-internal code) -- */
  WIRING_REINITIALIZED: m('wiring-reinitialized', 'error.whatFailed.wiringReinitialized', 'error.scope.researchPlane', 'unknown', true),
  /* -- group 3: read-only (ADJ-11; host check codes) -- */
  TREE_PARTIAL: m('read-only', 'error.whatFailed.readOnly', 'error.scope.readOnlyProject', 'unknown', false),
  CONSISTENCY_MISMATCH: m('read-only', 'error.whatFailed.readOnly', 'error.scope.readOnlyProject', 'unknown', false),
  GIT_REPO_ERROR: m('read-only', 'error.whatFailed.readOnly', 'error.scope.readOnlyProject', 'unknown', false),
  /* -- group 4: the Git family -- */
  GIT_CONFLICT: m('git', 'error.whatFailed.gitOperation', 'error.scope.gitCheckpoint', 'none', true),
  GIT_SCOPE: m('git', 'error.whatFailed.gitOperation', 'error.scope.gitCheckpoint', 'none', true),
  GIT_TIMEOUT: m('git', 'error.whatFailed.gitOperation', 'error.scope.gitCheckpoint', 'unknown', false),
  GIT_WHITELIST: m('git', 'error.whatFailed.gitOperation', 'error.scope.gitCheckpoint', 'none', true),
  GIT_MISSING: m('git', 'error.whatFailed.gitOperation', 'error.scope.gitCheckpoint', 'none', true),
  GIT_ONLY: m('git', 'error.whatFailed.gitOperation', 'error.scope.gitCheckpoint', 'none', true),
  /* -- group 5: invalid relation (wired at BASE — UI-5) -- */
  OBJECT_ALREADY_EXISTS: m('invalid-relation', 'error.whatFailed.invalidRelation', 'error.scope.planRelation', 'none', true),
  OBJECT_NOT_FOUND: m('invalid-relation', 'error.whatFailed.invalidRelation', 'error.scope.planRelation', 'none', true),
  OWNER_MISMATCH: m('invalid-relation', 'error.whatFailed.invalidRelation', 'error.scope.planRelation', 'none', true),
  CROSS_FIELD: m('invalid-relation', 'error.whatFailed.invalidRelation', 'error.scope.planRelation', 'none', true),
  RELATION_DUPLICATE: m('invalid-relation', 'error.whatFailed.invalidRelation', 'error.scope.planRelation', 'none', true),
  RELATION_REVERSE_DUPLICATE: m('invalid-relation', 'error.whatFailed.invalidRelation', 'error.scope.planRelation', 'none', true),
  WRONG_STATE: m('invalid-relation', 'error.whatFailed.invalidRelation', 'error.scope.planRelation', 'none', true),
  /* -- group 6: lifecycle / state transitions -- */
  IV_ILLEGAL_TRANSITION: m('lifecycle', 'error.whatFailed.invalidTransition', 'error.scope.workstreamAction', 'none', true),
  IV_ACTOR_FORBIDDEN: m('lifecycle', 'error.whatFailed.invalidTransition', 'error.scope.workstreamAction', 'none', true),
  IV_CONCURRENT_STATE: m('lifecycle', 'error.whatFailed.invalidTransition', 'error.scope.workstreamAction', 'none', true),
  IV_NOT_FOUND: m('lifecycle', 'error.whatFailed.invalidTransition', 'error.scope.workstreamAction', 'none', true),
  NA_WRONG_STATE: m('lifecycle', 'error.whatFailed.invalidTransition', 'error.scope.workstreamAction', 'none', true),
  BLK_WRONG_STATE: m('lifecycle', 'error.whatFailed.invalidTransition', 'error.scope.workstreamAction', 'none', true),
  OBJ_WRONG_STATE: m('lifecycle', 'error.whatFailed.invalidTransition', 'error.scope.workstreamAction', 'none', true),
  /* -- group 7: stale canonical targets -- */
  STALE_GIT: m('stale', 'error.whatFailed.staleTarget', 'error.scope.canonicalTarget', 'none', true),
  STALE_CAPTURE: m('stale', 'error.whatFailed.staleTarget', 'error.scope.canonicalTarget', 'none', true),
  /* -- group 8: partial project creation (fail-loud — LP_* verbatim) -- */
  LP_INPUT: m('partial-creation', 'error.whatFailed.partialCreation', 'error.scope.projectScaffold', 'partial', false),
  LP_DIR_EXISTS: m('partial-creation', 'error.whatFailed.partialCreation', 'error.scope.projectScaffold', 'partial', false),
  LP_GIT_INIT: m('partial-creation', 'error.whatFailed.partialCreation', 'error.scope.projectScaffold', 'partial', false),
  LP_MKDIR: m('partial-creation', 'error.whatFailed.partialCreation', 'error.scope.projectScaffold', 'partial', false),
  LP_METADATA: m('partial-creation', 'error.whatFailed.partialCreation', 'error.scope.projectScaffold', 'partial', false),
  LP_PARENT_INVALID: m('partial-creation', 'error.whatFailed.partialCreation', 'error.scope.projectScaffold', 'partial', false),
  LP_REGISTER: m('partial-creation', 'error.whatFailed.partialCreation', 'error.scope.projectScaffold', 'partial', false),
  LP_SCAFFOLD: m('partial-creation', 'error.whatFailed.partialCreation', 'error.scope.projectScaffold', 'partial', false),
  /* -- group 9: workspace bind conflicts (atomic pre-application) -- */
  PLANE_ALREADY_MANAGED: m('bind-conflict', 'error.whatFailed.bindConflict', 'error.scope.workspaceBinding', 'none', true),
  PLANE_HUB_WORKSPACE: m('bind-conflict', 'error.whatFailed.bindConflict', 'error.scope.workspaceBinding', 'none', true),
  PLANE_HUB_EXISTS: m('bind-conflict', 'error.whatFailed.bindConflict', 'error.scope.workspaceBinding', 'none', true),
  PLANE_HUB_MARKER_EXISTS: m('bind-conflict', 'error.whatFailed.bindConflict', 'error.scope.workspaceBinding', 'none', true),
  PLANE_TARGET_NAME_TAKEN: m('bind-conflict', 'error.whatFailed.bindConflict', 'error.scope.workspaceBinding', 'none', true),
  PLANE_NOT_REGISTERED_WORKSPACE: m('bind-conflict', 'error.whatFailed.bindConflict', 'error.scope.workspaceBinding', 'none', true),
  PLANE_TREE_MISSING: m('bind-conflict', 'error.whatFailed.bindConflict', 'error.scope.workspaceBinding', 'none', true),
  PLANE_TREE_EXISTS: m('bind-conflict', 'error.whatFailed.bindConflict', 'error.scope.workspaceBinding', 'none', true),
  PLANE_NOT_MISSING: m('bind-conflict', 'error.whatFailed.bindConflict', 'error.scope.workspaceBinding', 'none', true),
}

/** The unmapped-code fallback: wording generic, detail never lost. */
export const UNKNOWN_ERROR_STATE: ErrorStateMapping = m('unknown', 'error.whatFailed.unknown', null, 'unknown', false)

/** `error.dataChanged.*` — the "whether data changed" line per state. */
export const DATA_CHANGED_KEYS: Readonly<Record<ErrorDataChanged, CopyKey>> = {
  none: 'error.dataChanged.none',
  partial: 'error.dataChanged.partial',
  unknown: 'error.dataChanged.unknown',
}

/** A decoded failure: the code (null = undecodable) + the detail line. */
export interface ResolvedErrorState {
  readonly code: string | null
  /** Always non-empty information — the raw message when undecoded. */
  readonly detail: string
}

/**
 * Resolve a rejected value (or stored fault) to `{ code, detail }`.
 *
 * Resolution order: (1) the single string decoder
 * `extractResearchErrorCarrier` (NOTE-4 — no second matcher exists);
 * (2) the structured carrier the store already parsed (`Error.code` —
 * a typed field read, not a match); (3) undecodable -> the raw message
 * as the detail (information is never dropped).
 */
export function resolveErrorStateCode(input: unknown): ResolvedErrorState {
  const raw = typeof input === 'string' ? input : input instanceof Error ? input.message : String(input)
  const carrier = extractResearchErrorCarrier(raw)
  if (carrier !== null) {
    return { code: carrier.code, detail: carrier.detail }
  }
  if (input instanceof Error && typeof (input as unknown as { code?: unknown }).code === 'string') {
    return { code: (input as unknown as { code: string }).code, detail: raw }
  }
  return { code: null, detail: raw }
}

/** Look up a code in the table; unmapped/absent codes get the fallback. */
export function lookupErrorState(code: string | null): ErrorStateMapping {
  if (code !== null) {
    const hit = ERROR_STATE_MAP[code]
    if (hit !== undefined) return hit
  }
  return UNKNOWN_ERROR_STATE
}
