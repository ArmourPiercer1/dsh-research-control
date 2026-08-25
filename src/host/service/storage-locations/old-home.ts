/**
 * V2-T2.4 — the V1 `$DSH_HOME` legacy database detection (design §3.3).
 *
 * The V1 layout kept every project database under
 * `$DSH_HOME/research-control/<projectId>/` (DSH_ADAPTER §9:
 * `dshHomePath('research-control', <projectId>)`). V2 retires it (design
 * §3.3 「DSH_HOME 下的旧库路径退役」): the databases live with their
 * projects — `<hubDir>/projects/<id>/` (managed) or `<treeDir>/state/`
 * (standalone).
 *
 * Startup behavior (design §3.3 + §14): when the legacy layout is
 * present, the plugin logs a ONE-TIME migration SUGGESTION and does NOT
 * touch the data — 「启动期若发现，日志提示一次性搬运建议，不自动搬
 * （避免跨盘隐式大动作）」. {@link hintOldDbHome} is that probe: it
 * lists the legacy per-project dirs and returns the single startup warn
 * line (or `null` when there is nothing to say). The dsh-adapter side
 * resolves the DSH home (`resolveDshHome`, the one `@deepseek-ai/dsh-
 * home-paths` read — the INV-PERM-5 exempt zone) and passes it here with
 * the node:fs-backed probe.
 */

import { join } from 'node:path'

import { OLD_DB_HOME_SEGMENT, type StorageLocationsFs } from './types.js'

/**
 * List the V1 legacy per-project database dirs under
 * `$DSH_HOME/research-control/` (sorted by directory name).
 *
 * A subdirectory counts when it EXISTS AS A DIRECTORY — the V1 wiring
 * created `<dataDir>` (owner-only) the moment it first opened the db, so
 * a dir present = a project database lived (or lives) there; empty
 * residue is reported too (the operator decides what it is).
 *
 * @param dshHome - the resolved DSH home root (absolute).
 * @param fs - the injected filesystem face.
 * @returns the legacy `<projectId>` directory names (empty = no legacy layout).
 */
export function findOldDbHomeProjectDirs(
  dshHome: string,
  fs: StorageLocationsFs,
): readonly string[] {
  if (typeof dshHome !== 'string' || dshHome.length === 0) return []
  const root = join(dshHome, OLD_DB_HOME_SEGMENT)
  if (!fs.isDirectory(root)) return []
  const names = fs.readdir(root)
  const dirs = names.filter(
    (name) => name.length > 0 && name !== '.' && name !== '..' && fs.isDirectory(join(root, name)),
  )
  return [...dirs].sort()
}

/**
 * The one-time startup migration SUGGESTION for a surviving V1 legacy
 * database layout (design §3.3 — 日志提示一次性搬运建议，不自动搬).
 *
 * @param dshHome - the resolved DSH home root (absolute).
 * @param fs - the injected filesystem face.
 * @returns the single warn line (self-contained — it rides verbatim into
 *  the startup log), or `null` when no legacy layout is present.
 */
export function hintOldDbHome(dshHome: string, fs: StorageLocationsFs): string | null {
  const ids = findOldDbHomeProjectDirs(dshHome, fs)
  if (ids.length === 0) return null
  const root = join(dshHome, OLD_DB_HOME_SEGMENT)
  return (
    `[research-control] V1 legacy database layout found under $DSH_HOME: ` +
    `${ids.map((id) => join(root, id)).join(', ')} — in V2 the project databases live with their ` +
    'projects (managed: <hubDir>/projects/<projectId>/research.sqlite; standalone: ' +
    '<treeDir>/state/research.sqlite, design §3.3); move the legacy databases manually if they ' +
    'are still needed — the plugin does not migrate them automatically (design §14)'
  )
}
