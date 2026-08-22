/**
 * src/host/history/replay — public surface (WP-2.3).
 *
 *   - query.ts    — dual-order (semantic / audit) event queries with
 *                   seq-cursor pagination (catalog §2; TC-HIST-002/004/009
 *                   query halves; TC-PERF-004 O(window) semantics)
 *   - replay.ts   — `foldEvents`: the generic pure replay engine
 *                   (reducer injected; TC-HIST-005 idempotency)
 *   - rebuild.ts  — `rebuildDerivedState` (full audit-order replay →
 *                   wholesale `derived_state` replace in ONE independent
 *                   transaction; TC-HIST-006 / TC-DB-002 派生列重建) +
 *                   `readDerivedState` + `compareDerivedStates` (the
 *                   rebuild-vs-incremental consistency framework)
 *   - wrapper.ts  — `runWrapper`: the per-Run readability projection
 *                   (catalog §3.7 / INV-HIST-8 / TC-HIST-007 wrapper half)
 *   - state-map.ts— derived-state key format + strict-JSON + canonical JSON
 *   - errors.ts   — `ReplayError` taxonomy (REPLAY_*)
 *
 * Boundary (WP-2.3): replay produces NO new events — the type surface has
 * no event-write path (`QueryStore` / `RebuildStore` are structural
 * `Pick`s of `ResearchStore` WITHOUT `appendEvents`), the only write this
 * module performs is the derived-state replace (one independent
 * transaction on `derived_state` only; the event table is additionally
 * trigger-protected at storage level, WP-2.1). No registry-external
 * history internals are imported (only `../registry` orderings + store
 * types). No DSH imports (INV-PERM-5); zero new dependencies
 * (`node:sqlite` is the Node builtin the store already uses).
 */

export { ReplayError, ReplayApplyError, ReplayInputError, ReplayStateError, type ReplayErrorCode } from './errors.js'
export {
  assertStrictJson,
  canonicalJson,
  parseStateKey,
  stateKey,
  type DerivedStateMap,
} from './state-map.js'
export {
  collectAllEvents,
  queryEvents,
  type QueryEventsOptions,
  type QueryPage,
  type QueryStore,
  type RebuildStore,
  type ReplayOrder,
} from './query.js'
export { foldEvents, type Reducer } from './replay.js'
export {
  compareDerivedStates,
  readDerivedState,
  rebuildDerivedState,
  type ConsistencyDiffEntry,
  type ConsistencyReport,
  type DerivedStateReducer,
  type RebuildOptions,
  type RebuildResult,
} from './rebuild.js'
export { runWrapper, type RunEndEventType, type RunWrapperEntry } from './wrapper.js'
