/**
 * WP-3.6 (RR-011 (d)) — read the Project id from `.research/project.yaml`
 * BEFORE the wiring exists (chicken-and-egg: the data dir is keyed by
 * the project id — V2-T2.4, design §3.3: MANAGED
 * `<hub>/<hubDir>/projects/<projectId>/`, STANDALONE
 * `<ws>/<treeDir>/state/` — so the dsh-adapter needs the id before it
 * can name the directory the wiring's store opens).
 *
 * This is a MINIMAL reader — one file, one key (`id`, the frozen
 * `project.schema.json` top-level key, path-id checked by the full loader
 * which runs later in the wiring and fails loud on any other problem). It
 * deliberately does NOT run the full `loadResearchTree`: the tree load is
 * the wiring's own step (with its full error surface), and a tree that
 * fails to load must fail the WIRING, not the id probe.
 *
 * No DSH imports (INV-PERM-5).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseDocument, YAMLMap } from 'yaml'

import { HostWiringError } from './types.js'

/**
 * @param researchRoot - the ABSOLUTE `.research` directory.
 * @returns the `PRJ-<n>` id from `project.yaml`.
 * @throws {HostWiringError} `WIRING_INPUT` when the file is missing,
 *  unparseable, not a mapping, or carries no usable `id` string.
 */
export function readProjectId(researchRoot: string): string {
  const absPath = join(researchRoot, 'project.yaml')
  let text: string
  try {
    text = readFileSync(absPath, 'utf8')
  } catch (cause) {
    throw new HostWiringError(
      'WIRING_INPUT',
      `cannot read ${absPath}: ${cause instanceof Error ? cause.message : String(cause)} — ` +
        'a research workspace without a project.yaml has no Project scope (the data dir is keyed by it)',
    )
  }
  const doc = parseDocument(text)
  if (doc.errors.length > 0) {
    throw new HostWiringError(
      'WIRING_INPUT',
      `${absPath} is not parseable YAML: ${doc.errors.map((e) => e.message).join('; ')}`,
    )
  }
  if (doc.contents === null || !(doc.contents instanceof YAMLMap)) {
    throw new HostWiringError('WIRING_INPUT', `${absPath} is not a YAML mapping`)
  }
  const id: unknown = doc.contents.get('id')
  if (typeof id !== 'string' || id.length === 0) {
    throw new HostWiringError(
      'WIRING_INPUT',
      `${absPath} carries no usable "id" (got ${JSON.stringify(id ?? null)}) — the Project scope is the data-dir key (DSH_ADAPTER §9)`,
    )
  }
  return id
}

/**
 * V2-T3.2a — read the Project `title` from the SAME `project.yaml` with a
 * LENIENT verdict (the discovery probe's display-name need: a STANDALONE
 * plane project has no registry entry, so its wire `displayName` is the
 * tree's `title` — design §12 `PlaneProjectDto`).
 *
 * Unlike {@link readProjectId} this NEVER throws: a tree whose title is
 * missing/unusable already fails loud in the full tree load (the wiring's
 * own step — `title` is a required minLength-1 field of the frozen
 * project schema), so the probe only needs an honest `null` fallback for
 * the degenerate case (unreadable file / absent key / non-string).
 */
export function readProjectTitle(researchRoot: string): string | null {
  const absPath = join(researchRoot, 'project.yaml')
  let text: string
  try {
    text = readFileSync(absPath, 'utf8')
  } catch {
    return null
  }
  try {
    const doc = parseDocument(text)
    if (doc.errors.length > 0 || doc.contents === null || !(doc.contents instanceof YAMLMap)) {
      return null
    }
    const title: unknown = doc.contents.get('title')
    return typeof title === 'string' && title.length > 0 ? title : null
  } catch {
    return null
  }
}
