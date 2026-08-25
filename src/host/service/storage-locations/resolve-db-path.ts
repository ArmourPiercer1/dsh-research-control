/**
 * V2-T2.4 — the §3.3 database layout resolver (design §3.3 「数据库布局」).
 *
 * ```
 * MANAGED    → <hub>/<hubDir>/projects/<projectId>/research.sqlite
 * STANDALONE → <ws>/<treeDir>/state/research.sqlite
 * ```
 *
 * PURE: the directory names arrive parameterized (the dsh-adapter caller
 * resolves them through T2.1's `getResearchDirNames` — this layer never
 * touches settings), and the plane facts (kind / hub path / workspace
 * path / project id) arrive from the T2.2 discovery state. The result is
 * consumed by the wiring as the `dataDir` of `createHostWiring` (the
 * directory carrying `research.sqlite`).
 */

import { dirname, join } from 'node:path'

import {
  DB_FILE_NAME,
  MANAGED_PROJECTS_DIR,
  STANDALONE_STATE_DIR,
  StorageLocationsError,
  type DbPlacementInput,
  type DbPlacementKind,
} from './types.js'

/** Require a non-empty string input (fail loud — the TC-DSH-008 style). */
function requireNonEmpty(value: string | null | undefined, what: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new StorageLocationsError(
      'INVALID_INPUT',
      `the storage-locations input ${what} must be a non-empty path (got ${JSON.stringify(value ?? null)})`,
    )
  }
  return value
}

/**
 * Resolve the DATABASE FILE path of one active plane project (design
 * §3.3):
 *
 *  - MANAGED    → `join(hubPath, hubDir, 'projects', projectId,
 *    'research.sqlite')` — one db per project under the management hub
 *    (append-only / WAL / monotonic SCHEMA_VERSION, the unchanged
 *    persistence discipline — §3.3);
 *  - STANDALONE → `join(wsPath, treeDir, 'state', 'research.sqlite')` —
 *    the same db, located in the project's own `state/` area (「库在项目
 *    自身；state/ 为状态区，不入声明树语义」— and outside the checkpoint
 *    commit scope, §3.3).
 *
 * @param input - the placement facts (see {@link DbPlacementInput}).
 * @returns the absolute database file path.
 * @throws {StorageLocationsError} `INVALID_INPUT` on an empty/unknown
 *  input; `MANAGED_WITHOUT_HUB` when a MANAGED project carries no hub
 *  path (a discovery invariant break — fail loud, never guess a
 *  location).
 */
export function resolveDbPath(input: DbPlacementInput): string {
  const kind: DbPlacementKind = input.kind
  if (kind !== 'MANAGED' && kind !== 'STANDALONE') {
    throw new StorageLocationsError(
      'INVALID_INPUT',
      `the storage-locations input kind must be MANAGED or STANDALONE (got ${JSON.stringify(kind)})`,
    )
  }
  const projectId = requireNonEmpty(input.projectId, 'projectId')
  const wsPath = requireNonEmpty(input.wsPath, 'wsPath')
  const hubDir = requireNonEmpty(input.hubDir, 'hubDir')
  const treeDir = requireNonEmpty(input.treeDir, 'treeDir')
  if (kind === 'MANAGED') {
    // A MANAGED project by definition sits under a hub — a missing hub path
    // is a discovery invariant break (T2.2 fails loud before wiring): the
    // storage layer names that break with its OWN code (never a silent
    // fallback, never an INVALID_INPUT blur).
    if (
      input.hubPath === null ||
      input.hubPath === undefined ||
      typeof input.hubPath !== 'string' ||
      input.hubPath.length === 0
    ) {
      throw new StorageLocationsError(
        'MANAGED_WITHOUT_HUB',
        `a MANAGED project's database lives under the hub (<hubPath>/<hubDir>/projects/<id>/, ` +
          `design §3.3), but the hub path is missing (got ${JSON.stringify(input.hubPath ?? null)}) ` +
          '— a discovery invariant break (T2.2 refuses a MANAGED plane without its hub)',
      )
    }
    return join(input.hubPath, hubDir, MANAGED_PROJECTS_DIR, projectId, DB_FILE_NAME)
  }
  return join(wsPath, treeDir, STANDALONE_STATE_DIR, DB_FILE_NAME)
}

/**
 * Resolve the DATABASE DIRECTORY of one active plane project — the
 * `dataDir` the wiring passes to `createHostWiring` (the store opens
 * `<dataDir>/research.sqlite`). The dsh-adapter side pre-creates the dir
 * with the owner-only 0o700 mode (DSH_ADAPTER §9 — the store enforces the
 * mode only on dirs IT creates, so the pre-creator must set it; the db
 * FILE itself is created 0o600 by the store).
 *
 * @see resolveDbPath — same inputs, same fail-loud points.
 */
export function resolveDbDir(input: DbPlacementInput): string {
  return dirname(resolveDbPath(input))
}
