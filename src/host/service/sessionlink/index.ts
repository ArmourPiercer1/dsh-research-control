/**
 * src/host/service/sessionlink — public surface (WP-2.6).
 *
 * DSH session → ResearchHistory wiring (DSH_ADAPTER §7 / TC-DSH-004 /
 * CATALOG §5.1 / INV-DB-2):
 *
 *   - `mapSessionWindow`  — the PURE mapping constructor: one session event
 *     window → the RUN_STARTED/RUN_FINISHED events to append (or null);
 *   - `SessionLinkService` — the service: subscribes the WP-0.4 session
 *     adapter port, keeps the INV-DB-2 pointer rows (meta KV), validates
 *     through the WP-2.2 registry, appends through the WP-2.1 store (RUN
 *     derived-state rows in the same transaction);
 *   - pointer codec + types + error model;
 *   - rider 1 (G1 triage): `sweepStaleTmp` — startup sweep of stale
 *     `.dshrc-tmp` crash residue under a `.research/` tree;
 *   - rider 3 (RR-008): the `minDshVersion` fail-loud host-version guard
 *     (pure comparator + installed-package version source).
 */

export {
  ACTOR_LABEL,
  SessionLinkService,
  type SessionLinkServiceOptions,
  type WireBinding,
  type WireResult,
} from './service.js'
export { mapSessionWindow, DISPOSED_CLOSE_SUMMARY, LATE_CLOSE_SUMMARY } from './map.js'
export { decodePointer, encodePointer } from './pointer.js'
export {
  buildValidationContext,
  readRunStateDoc,
  type WorkstreamContextSource,
} from './context.js'
export {
  isRunStateDoc,
  pointerKey,
  SessionLinkError,
  isSessionLinkError,
  type RunEventDraft,
  type RunStateDoc,
  type SessionLinkErrorCode,
  type SessionPointer,
  type SessionWindowEvent,
  type SessionWindowInput,
  type SessionWindowMapping,
} from './types.js'
export { sweepStaleTmp, type SweptEntry, type SweepLogger } from './tmp-sweep.js'
export {
  assertMinDshVersion,
  compareDshVersions,
  createPackageVersionSource,
  DshVersionError,
  DSH_VERSION_PACKAGE,
  parseDshVersion,
  type DshVersionSource,
} from './version-guard.js'
