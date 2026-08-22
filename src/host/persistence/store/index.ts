/**
 * src/host/persistence/store — public surface (WP-2.1).
 *
 *   - store.ts       — `openDatabase(path, options?)` (node:sqlite
 *                      DatabaseSync wrapper: owner-only 0o700/0o600, WAL,
 *                      `user_version` gate, quick_check corruption probe)
 *                      + the append-only `ResearchStore` handle
 *   - types.ts       — event input/record, derived-state patch, hook +
 *                      TxScope seams, the `ResearchStore` interface
 *   - schema.ts      — V1 DDL (history_event / derived_state / meta) +
 *                      constants (`DB_USER_VERSION`, permission bits)
 *   - sqlite-meta.ts — `SqliteMetaStore`: the WP-1.6 reserved `MetaStore`
 *                      sqlite backend (single-statement `bumpCounter`)
 *   - errors.ts      — `StoreError` taxonomy (STORE_*)
 *
 * NOT part of this surface (deliberately absent — INV-HIST-1 / WP boundary):
 *   - any update/delete/rewrite method on the event log (type surface) —
 *     the storage triggers reject raw UPDATE/DELETE as well;
 *   - replay / query projections (WP-2.3);
 *   - event validation logic (WP-2.2 injects it through the `validate`
 *     hook);
 *   - the `createMetaStore({backend:'sqlite'})` factory wiring in
 *     src/host/persistence/meta (that file belongs to WP-1.6; a later
 *     service WP connects `SqliteMetaStore` to it — the surface this class
 *     implements is the reserved one, verified in tests).
 */

export { openDatabase, type OpenDatabaseOptions } from './store.js'
export { classifyForbiddenWrite, installStoreConnectionGuard } from './connection-guard.js'
export {
  DB_FILE_NAME,
  DB_USER_VERSION,
  DIR_MODE,
  FILE_MODE,
  EXPECTED_TABLES,
  schemaDdl,
} from './schema.js'
export {
  StoreClosedError,
  StoreConflictError,
  StoreCorruptError,
  StoreError,
  StoreForbiddenSqlError,
  StoreInputError,
  StoreOpenError,
  StoreSchemaStaleError,
  StoreSqlError,
  StoreVersionError,
  type StoreErrorCode,
} from './errors.js'
export { SqliteMetaStore, type MetaDbPort } from './sqlite-meta.js'
export type {
  ActorRefJson,
  AppendEventsOptions,
  AppendResult,
  DerivedStatePatch,
  HistoryEventInput,
  HistoryEventRecord,
  RealizeContext,
  RealizeHooks,
  ResearchStore,
  SourceRefJson,
  TxScope,
} from './types.js'
// The WP-1.6 reserved interface this module's SqliteMetaStore implements —
// re-exported so consumers can name both types from one place.
export type { MetaStore } from '../meta/index.js'
