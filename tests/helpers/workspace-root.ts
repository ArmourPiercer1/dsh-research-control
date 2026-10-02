/**
 * G0 — the ONE test-side workspace-root resolver (docs/G0_REPRODUCIBLE_TEST_ROOT.md).
 *
 * Before G0 every suite hardcoded `WR_ROOT = resolve/join(HERE, '..', '..', '..')`
 * (three levels up from `tests/<suite>/` = the PARENT of the plugin repo), which
 * made the whole suite pass only in the canonical dev layout where the research
 * workspace root (the SI-001 canonical source of `schema/` + the 8 root docs)
 * physically sits above the checkout. A standalone checkout (fresh clone, CI,
 * git-install) has nothing there → `SCHEMA_UNAVAILABLE` / ENOENT → the wiring
 * integrity gate throws `WIRING_INTEGRITY` (docs/BASELINE_PROGRESS.md §2).
 *
 * The G0 contract:
 *  - DEFAULT = the plugin repo root itself. Tests consume the COMMITTED
 *    in-package snapshot `<repo>/schema/` — by SI-001 that is a content-identical
 *    mirror of the canonical workspace-root originals (`snapshot-release.mjs`
 *    sha256-asserts per file at build time), so test semantics are unchanged in
 *    the canonical layout while a bare checkout becomes self-sufficient.
 *  - EXPLICIT OVERRIDE = `DSH_RESEARCH_WORKSPACE_ROOT` (a workspace root
 *    DIRECTORY containing `schema/`), for pointing the suite at the canonical
 *    originals on purpose. Nothing is auto-discovered: the default never walks
 *    upward, so a stray parent directory can never silently change what the
 *    suite reads.
 *  - SCOPE = tests ONLY. This resolver deliberately does NOT read production's
 *    `DSH_RESEARCH_SCHEMA_ROOT` and must not be imported from `src/`: the host
 *    service resolves its own schema root (`#resolveSchemaRoot`, env-first +
 *    bounded upward probe) — a separate, untouched contract. The canonical →
 *    package snapshot sync direction also stays untouched
 *    (`snapshot-release.mjs` SOURCE_ROOT default = repo parent, explicit
 *    `DSH_SNAPSHOT_SOURCE_ROOT`).
 */
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Plugin repo root (this file lives at `tests/helpers/`). */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** The frozen-surface anchor: a workspace root counts as usable only with it. */
const hasFrozenSchema = (root: string): boolean => existsSync(join(root, 'schema', 'common.schema.json'))

/**
 * Resolve the workspace root the test suites read `schema/` from.
 *
 * Default: the plugin repo root (in-package frozen snapshot).
 * Override: `DSH_RESEARCH_WORKSPACE_ROOT` — resolved against the cwd when
 * relative; missing anchor = fail loud with both knobs printed (never a
 * confusing ENOENT from deep inside a fixture loader).
 */
export function resolveTestWorkspaceRoot(): string {
  const override = process.env['DSH_RESEARCH_WORKSPACE_ROOT']
  if (typeof override === 'string' && override.length > 0) {
    const root = resolve(override)
    if (!hasFrozenSchema(root)) {
      throw new Error(
        `DSH_RESEARCH_WORKSPACE_ROOT=${root} is not a research workspace root ` +
          '(needs schema/common.schema.json) — unset it to fall back to the in-repo snapshot',
      )
    }
    return root
  }
  if (!hasFrozenSchema(REPO_ROOT)) {
    throw new Error(
      `the in-repo frozen snapshot is unusable: ${join(REPO_ROOT, 'schema', 'common.schema.json')} ` +
        `is missing (broken checkout?) — or set ${'DSH_RESEARCH_WORKSPACE_ROOT'} to a research workspace root`,
    )
  }
  return REPO_ROOT
}
