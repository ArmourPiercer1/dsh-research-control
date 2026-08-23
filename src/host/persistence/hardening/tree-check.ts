/**
 * WP-8.1 — hardening: check 2, the `.research/` load classification.
 *
 * The WP-1.1 loader already implements the ARCHITECTURE §10 row for
 * broken files: each broken file is REJECTED with a precisely located
 * error (file + field, TC-DOM-027) and the rest load — this module
 * classifies the AGGREGATED error list into the startup semantics:
 *
 *   FATAL (unrecoverable — startup refuses, fail loud):
 *     - a root-level error (`file: ''` — the research root is missing or
 *       unreadable): there is no 真源 at all;
 *     - `MISSING_REQUIRED` on `project.yaml` (Project is the root object,
 *       DOMAIN_SCHEMA §2.1 — without it nothing is addressable) or on
 *       `schema-version` (the contract version is pinned);
 *     - `SCHEMA_VERSION` — the contract version is unsupported (V1
 *       loader expects 1): a version MISMATCH of the frozen contract is
 *       not a per-file breakage;
 *     - `SCHEMA_LOAD` / `SCHEMA_UNAVAILABLE` — the FROZEN schema set
 *       (the plugin's own contract files) is broken: a plugin-side fault,
 *       no document can be verified → refuse (and say so).
 *
 *   DEGRADED (recoverable — the readonly usable surface + loud warning):
 *     - every other per-file error (PARSE / SCHEMA / PATH_RULE /
 *       PATH_ID_MISMATCH / UNKNOWN_ENTRY / DANGLING_REF / DUPLICATE_ID /
 *       READ / MISSING_REQUIRED on a non-root required file): the broken
 *       file stays rejected (its node `doc: null`), the rest load —
 *       exactly the §10 row「拒绝加载该文件并报错定位（文件+字段），不猜测
 *       修复；其余文件正常加载」. Startup may proceed on the READONLY
 *       usable surface (the orchestrator narrows it): the write surface
 *       is refused because it must not commit or mutate a partially
 *       broken 真源, and no broken file is ever auto-repaired.
 *
 * The decision (documented for the wiring adoption — see the WP-8.1
 * report): the CURRENT wiring fails startup on ANY load error
 * (WIRING_TREE); adopting this classifier lets it serve the readonly
 * surface for partial breakage instead, which is the §10 row's literal
 * semantics. The classifier itself is wiring-agnostic.
 */

import type { LoadResult, ResearchLoadError } from '../../domain/loader/index.js'
import type { TreeCheckResult } from './types.js'

/** The per-file errors that make the WHOLE tree unusable (see header). */
function isFatalLoadError(e: ResearchLoadError): boolean {
  if (e.file === '') return true // root-level: missing/unreadable research root
  if (e.code === 'SCHEMA_LOAD') return true // frozen contract files broken (plugin-side fault)
  if (e.code === 'SCHEMA_VERSION') return true // unsupported contract version
  if (e.code === 'SCHEMA_UNAVAILABLE') return true // validator unusable (SCHEMA_LOAD sibling)
  if (e.code === 'MISSING_REQUIRED' && (e.file === 'project.yaml' || e.file === 'schema-version')) return true
  return false
}

/** Locate one error for messages: `file` + optional `path` (the field). */
function located(e: ResearchLoadError): string {
  const file = e.file === '' ? '<research root>' : e.file
  return e.path ? `${file}${e.path}` : file
}

/**
 * Classify a loader result into the startup semantics (see module header).
 * Pure: no I/O, no store — the orchestrator passes the `LoadResult`.
 */
export function classifyTreeLoad(load: LoadResult): TreeCheckResult {
  if (load.errors.length === 0) {
    return {
      status: 'pass',
      usable: true,
      load,
      fatalErrors: [],
      degradedErrors: [],
      guidance: [],
    }
  }

  const fatalErrors: ResearchLoadError[] = []
  const degradedErrors: ResearchLoadError[] = []
  for (const e of load.errors) {
    if (isFatalLoadError(e)) fatalErrors.push(e)
    else degradedErrors.push(e)
  }

  // ---- FATAL: the tree cannot serve as a 真源 at all -----------------
  if (fatalErrors.length > 0) {
    const guidance = [
      'the .research declarative 真源 cannot be loaded at all — refusing to start against it (fail loud, no guess-repair):',
      ...fatalErrors.map((e) => `  [${e.code}] ${located(e)}: ${e.message}`),
      ...fatalRemedy(fatalErrors),
    ]
    return {
      status: 'unrecoverable',
      usable: false,
      load,
      fatalErrors,
      degradedErrors,
      guidance,
    }
  }

  // ---- DEGRADED: partial breakage (the §10 row) ----------------------
  return {
    status: 'recoverable',
    usable: true,
    load,
    fatalErrors: [],
    degradedErrors,
    guidance: [
      `the .research tree loaded with ${degradedErrors.length} broken file(s) — the broken file(s) are REJECTED with precise location and the rest loaded normally (ARCHITECTURE §10; no guess-repair):`,
      ...degradedErrors.map((e) => `  [${e.code}] ${located(e)}: ${e.message}`),
      'the plugin serves the READONLY usable surface until the broken file(s) are fixed by the USER (fix the file in place, or `git restore --source=<commit> -- <path>` for a committed-good version) — the write surface (checkpoint / plan mutations / event appends over the broken 真源) is refused',
    ],
  }
}

/** The user-facing remedy per fatal-error shape (never a generic shrug). */
function fatalRemedy(errors: readonly ResearchLoadError[]): string[] {
  const remedy: string[] = []
  const has = (pred: (e: ResearchLoadError) => boolean): boolean => errors.some(pred)
  if (has((e) => e.file === '' && e.code === 'MISSING_REQUIRED')) {
    remedy.push('remedy: the workspace carries no .research tree — open a workspace that does, or create one (the plugin never creates research content silently)')
  } else if (has((e) => e.file === '' && e.code === 'READ')) {
    remedy.push('remedy: the .research root is unreadable (I/O failure) — check permissions/path, then restart')
  }
  if (has((e) => e.code === 'MISSING_REQUIRED' && e.file === 'project.yaml')) {
    remedy.push('remedy: .research/project.yaml is missing (the root object) — restore it from Git history (`git restore --source=<commit> -- .research/project.yaml`) or recreate it')
  }
  if (has((e) => e.code === 'MISSING_REQUIRED' && e.file === 'schema-version')) {
    remedy.push('remedy: .research/schema-version is missing — restore it (V1 = a single line "1")')
  }
  if (has((e) => e.code === 'SCHEMA_VERSION')) {
    remedy.push('remedy: the .research/schema-version value is unsupported by this build — restore the V1 value (a single line "1") or update the plugin to a build that supports the contract')
  }
  if (has((e) => e.code === 'SCHEMA_LOAD' || e.code === 'SCHEMA_UNAVAILABLE')) {
    remedy.push('remedy: the FROZEN schema set this build ships is incomplete or unreadable — that is a broken plugin installation, not user data: reinstall the plugin and restart')
  }
  if (remedy.length === 0) {
    remedy.push('remedy: restore the affected file(s) from Git history or recreate them, then restart')
  }
  return remedy
}
