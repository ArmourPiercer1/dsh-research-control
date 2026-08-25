/**
 * V2-T2.4 — public surface of the storage-locations module (design
 * §3.3 数据库布局 + §9 数据生命周期).
 *
 * Usage (the dsh-adapter's `#initResearchPlane`):
 * ```ts
 * const dataDir = resolveDbDir({
 *   kind: project.kind,
 *   projectId: project.projectId,
 *   hubPath: plane.hub?.path ?? null,
 *   wsPath: project.wsPath,
 *   hubDir: dirNames.hubDir,
 *   treeDir: dirNames.treeDir,
 * })
 * mkdirSync(dataDir, { recursive: true })          // §3.3 库目录自动创建
 * // …createHostWiring({ dataDir, … })
 * const hint = hintOldDbHome(resolveDshHome(), nodeFsStorageIo())
 * if (hint !== null) console.warn(hint)            // §3.3 旧库一次性提示
 * ```
 * and (the T3.x `bindProject` 收编 flow, design §9 推论 1):
 * ```ts
 * migrateDb(join(ws, treeDir, 'state', 'research.sqlite'),
 *           join(hub, hubDir, 'projects', id, 'research.sqlite'),
 *           nodeFsStorageIo(), logger)
 * ```
 *
 * The core is PURE (no DSH imports — INV-PERM-5; no settings reads — the
 * directory names arrive parameterized from T2.1's `getResearchDirNames`;
 * every disk fact arrives through the injected `StorageLocationsFs`).
 */

export { nodeFsStorageIo } from './fs-io.js'
export { findOldDbHomeProjectDirs, hintOldDbHome } from './old-home.js'
export { migrateDb } from './migrate.js'
export { resolveDbDir, resolveDbPath } from './resolve-db-path.js'
export {
  DB_FILE_NAME,
  MANAGED_PROJECTS_DIR,
  OLD_DB_HOME_SEGMENT,
  SILENT_LOGGER,
  SQLITE_HEADER_MAGIC,
  STANDALONE_STATE_DIR,
  MigrationConflict,
  StorageLocationsError,
  type DbPlacementInput,
  type DbPlacementKind,
  type StorageLocationsErrorCode,
  type StorageLocationsFs,
  type StorageLocationsLogger,
} from './types.js'
