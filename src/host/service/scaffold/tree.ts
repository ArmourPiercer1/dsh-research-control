/**
 * V2-T3.2b — the minimal `.research/` tree scaffold (design §8 接入:
 * 「无则脚手架最小 `<treeDir>/` 树」; §13 fs 操作面「最小树脚手架（复用
 * factory 形状）」).
 *
 * ## What this module is
 *
 * The one producer of a brand-new research tree: when `bindProject`
 * (the settings plane, design §8 接入（有中枢）/（无中枢）) targets a
 * workspace that carries NO `<treeDir>/` and the caller requested the
 * scaffold, this module writes the SMALLEST tree the frozen declarative
 * loader accepts:
 *
 * ```
 * <treeDir>/
 *   schema-version        "1"            (required — V1 loader)
 *   project.yaml          id + title + created_at (required trio — the
 *                        frozen project.schema.json; importance /
 *                        attention_mode / current_objective_refs keep
 *                        their §14.1 loader defaults)
 * ```
 *
 * The file SHAPE mirrors the canonical tree constants inlined by the
 * e2e factory (e2e/factory/factory.ts — READ-ONLY reference, never
 * imported from src): same `schema-version` carrier, same
 * `project.yaml` key style (snake_case frozen keys, ISO-8601 UTC
 * `created_at`), and `title` = the registry display name the 接入 dialog
 * collected (the factory's `title: 机器人视觉定位系统` precedent — the
 * display name IS the project title in the plugin's own trees).
 *
 * The scaffold NEVER clobbers: an existing `<treeDir>` (any kind) is
 * rejected (`SCAFFOLD_TREE_EXISTS`) — 「scaffold 幂等拒绝」. The
 * `bindProject` flow decides the branch (tree present → use it directly,
 * else scaffold when requested), so this module's own rejection is the
 * inner guard against any future call path that would overwrite a live
 * tree.
 *
 * ## Project id allocation (the ids allocator precedent)
 *
 * `projectId` is caller-supplied when known (a re-init flow may pin the
 * id). Omitted → ALLOCATED through the plugin's own {@link IdAllocator}
 * (`src/shared/ids/allocator.ts`, §1.1 规则 1–3): the Project id is
 * GLOBAL-scoped (`id-counter:GLOBAL:PROJECT`) and may never be reused,
 * so the counter is seeded with the MAXIMUM sequence already issued in
 * this installation — `knownProjectIds` (registry entries, live trees —
 * the caller's plane facts) — and the allocator burns the next sequence
 * (reserve + commit). A released/never-issued sequence can never be
 * handed out again (the allocator's monotonicity, not this module's).
 *
 * ## Layer rules
 *
 * Service layer (ARCHITECTURE.md §2.2): node:fs builtins are allowed
 * (the loader-pattern consumer writes the tree it declares), but there
 * are NO DSH imports (INV-PERM-5), NO settings reads (the directory name
 * arrives parameterized from T2.1's `getResearchDirNames` — never a
 * hardcoded literal), and NO git. The YAML text is built with the same
 * pinned `yaml` options as the registry serializer (byte-stable quoting
 * for arbitrary display names).
 */

import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { stringify } from 'yaml'

import { IdAllocator, type IdCounterPort, counterKey, parseId } from '../../../shared/ids/index.js'

/* ------------------------------------------------------------------ *
 * Frozen tree constants (the e2e factory shape, lifted into src —
 * e2e/factory/factory.ts stays the read-only reference, never imported)
 * ------------------------------------------------------------------ */

/** The `schema-version` file name (the loader's required root marker). */
export const SCHEMA_VERSION_FILE = 'schema-version'

/** The V1 schema version value (the frozen V1 loader expects exactly `1`). */
export const SCHEMA_VERSION_VALUE = '1'

/** The `project.yaml` file name (the loader's required root object). */
export const PROJECT_YAML_FILE = 'project.yaml'

/** The scaffolded tree's file inventory, in write order (the result's
 *  `files` list — the 最小树 shape, frozen by tests). */
export const SCAFFOLD_FILES: readonly string[] = [SCHEMA_VERSION_FILE, PROJECT_YAML_FILE]

/** The frozen project.schema.json `title` cap (maxLength 200). */
const PROJECT_TITLE_MAX_LENGTH = 200

/* ------------------------------------------------------------------ *
 * Errors
 * ------------------------------------------------------------------ */

/** The closed scaffold error-code vocabulary. */
export type ScaffoldErrorCode =
  /** The `<treeDir>` location already exists (any kind) — no clobbering, ever. */
  | 'SCAFFOLD_TREE_EXISTS'
  /** A bad input (non-absolute `wsPath`, non-directory `wsPath`, a `treeDir`
   *  that is not a bare directory name, an empty display name, a title over
   *  the frozen 200-char cap). */
  | 'SCAFFOLD_INPUT'
  /** A malformed explicit `projectId`, or a `knownProjectIds` seed entry that
   *  is not a well-formed PROJECT id (garbage seed = caller bug, fail loud). */
  | 'SCAFFOLD_ID'

/** A structured scaffold failure (self-contained message). */
export class ScaffoldError extends Error {
  readonly code: ScaffoldErrorCode

  constructor(code: ScaffoldErrorCode, message: string) {
    super(message)
    this.name = 'ScaffoldError'
    this.code = code
  }
}

/* ------------------------------------------------------------------ *
 * Inputs / outputs
 * ------------------------------------------------------------------ */

/** The scaffold inputs (all parameterized — see module doc). */
export interface ScaffoldTreeInput {
  /** The project workspace root (absolute path, an existing directory). */
  readonly wsPath: string
  /** The configured tree directory name (T2.1 `treeDir`; a bare segment). */
  readonly treeDir: string
  /** The project display name collected by the 接入 dialog — becomes the
   *  `project.yaml` `title` (frozen minLength-1 / maxLength-200). */
  readonly displayName: string
  /** Explicit project id (`PRJ-<n>`); omitted → allocated by the ids
   *  allocator from {@link knownProjectIds}. */
  readonly projectId?: string
  /** Project ids already issued in this installation (registry entries —
   *  active AND archived — plus live tree ids): the allocator's no-reuse
   *  seed (the next sequence is always greater than every known one). */
  readonly knownProjectIds?: readonly string[]
  /** Clock (default `Date.now`) — stamps the `created_at` carrier. */
  readonly now?: () => number
}

/** The scaffold result. */
export interface ScaffoldTreeResult {
  /** The absolute tree directory that was created. */
  readonly treePath: string
  /** The project id the tree carries (`project.yaml` `id`). */
  readonly projectId: string
  /** The files written, relative to the tree root (write order). */
  readonly files: readonly string[]
}

/* ------------------------------------------------------------------ *
 * Pure text builders (the factory shape as canonical YAML)
 * ------------------------------------------------------------------ */

/**
 * Build the `project.yaml` text of a scaffolded tree (the frozen
 * project.schema.json required trio `id` / `title` / `created_at` — the
 * factory PROJECT_YAML shape with the optional fields left to their
 * §14.1 loader defaults). Pinned `yaml` options (insertion-order keys,
 * `lineWidth: 0`) — the same determinism discipline as the registry
 * serializer; arbitrary display names are quoted exactly when YAML
 * requires it.
 */
export function projectYamlText(projectId: string, title: string, createdAtIso: string): string {
  const doc = {
    id: projectId,
    title,
    created_at: createdAtIso,
  }
  return stringify(doc, { lineWidth: 0 })
}

/**
 * The `created_at` carrier (DOMAIN_SCHEMA §1.2 ISO-8601 UTC, second
 * precision — the factory's `2026-08-21T09:00:00Z` style; the frozen
 * `date-time` format accepts both, second precision is the canonical
 * plugin-written form).
 */
export function isoTimestampUtc(epochMs: number): string {
  return new Date(epochMs).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/**
 * Allocate the next Project id from `knownProjectIds` through the ids
 * allocator (module doc「Project id allocation」): the GLOBAL
 * `id-counter:GLOBAL:PROJECT` counter seeded with the max known
 * sequence, one `reserve` + `commit`, the no-reuse guarantee by
 * monotonicity.
 *
 * @throws {ScaffoldError} `SCAFFOLD_ID` when a seed entry is not a
 *  well-formed PROJECT id.
 */
export function allocateProjectId(knownProjectIds: readonly string[]): string {
  let maxSequence = 0
  for (const id of knownProjectIds) {
    const parsed = parseId(id)
    if (parsed === null || parsed.kind !== 'PROJECT') {
      throw new ScaffoldError(
        'SCAFFOLD_ID',
        `a known project id is not a well-formed PROJECT id: ${JSON.stringify(id)} — the ` +
          'allocator seed must carry only registry/tree ids (DOMAIN_SCHEMA §1.1)',
      )
    }
    maxSequence = Math.max(maxSequence, parsed.sequence)
  }
  const key = counterKey('PROJECT', '')
  let value = maxSequence
  const port: IdCounterPort = {
    bumpCounter: (k, delta = 1) => {
      if (k !== key) {
        throw new ScaffoldError(
          'SCAFFOLD_ID',
          `the project-id counter port was asked for a foreign key: ${JSON.stringify(k)}`,
        )
      }
      value += delta
      return value
    },
    getCounter: (k) => {
      if (k !== key) {
        throw new ScaffoldError(
          'SCAFFOLD_ID',
          `the project-id counter port was asked for a foreign key: ${JSON.stringify(k)}`,
        )
      }
      return value
    },
  }
  // PROJECT is GLOBAL-scoped: the projectId argument is ignored by
  // counterKey — a neutral placeholder is passed.
  const allocator = new IdAllocator(port)
  const reservation = allocator.reserve('PROJECT', 'PRJ-0')
  allocator.commit(reservation)
  return reservation.id
}

/* ------------------------------------------------------------------ *
 * The scaffold itself
 * ------------------------------------------------------------------ */

/**
 * Write the minimal research tree into `wsPath` (module doc). Creates
 * `<wsPath>/<treeDir>/` with exactly {@link SCAFFOLD_FILES}; refuses to
 * touch anything when the tree location already exists (the clobber
 * guard, `SCAFFOLD_TREE_EXISTS`).
 *
 * @throws {ScaffoldError} — see {@link ScaffoldErrorCode}.
 */
export function scaffoldResearchTree(input: ScaffoldTreeInput): ScaffoldTreeResult {
  // ── input validation (fail loud BEFORE any write) ──
  if (typeof input.wsPath !== 'string' || input.wsPath.length === 0 || !isAbsolute(input.wsPath)) {
    throw new ScaffoldError(
      'SCAFFOLD_INPUT',
      `wsPath must be an absolute path (got ${JSON.stringify(input.wsPath ?? null)})`,
    )
  }
  if (
    typeof input.treeDir !== 'string' ||
    input.treeDir.length === 0 ||
    input.treeDir === '.' ||
    input.treeDir === '..' ||
    input.treeDir.includes('/')
  ) {
    throw new ScaffoldError(
      'SCAFFOLD_INPUT',
      `treeDir must be a bare directory name (got ${JSON.stringify(input.treeDir ?? null)})`,
    )
  }
  const title = input.displayName
  if (typeof title !== 'string' || title.length === 0) {
    throw new ScaffoldError(
      'SCAFFOLD_INPUT',
      `displayName must be a non-empty string (got ${JSON.stringify(title ?? null)})`,
    )
  }
  if (title.length > PROJECT_TITLE_MAX_LENGTH) {
    throw new ScaffoldError(
      'SCAFFOLD_INPUT',
      `displayName is ${String(title.length)} chars — the frozen project schema caps the ` +
        `title at ${String(PROJECT_TITLE_MAX_LENGTH)} (project.schema.json maxLength)`,
    )
  }
  if (!existsSync(input.wsPath) || !statSync(input.wsPath).isDirectory()) {
    throw new ScaffoldError(
      'SCAFFOLD_INPUT',
      `wsPath is not an existing directory: ${input.wsPath}`,
    )
  }

  // ── the clobber guard (idempotent rejection — the tree location is taken) ──
  const treePath = join(input.wsPath, input.treeDir)
  if (existsSync(treePath)) {
    throw new ScaffoldError(
      'SCAFFOLD_TREE_EXISTS',
      `a research tree already exists at ${treePath} — the scaffold never clobbers an ` +
        'existing tree (use the existing tree instead)',
    )
  }

  // ── the project id (explicit + validated, or allocated) ──
  let projectId: string
  if (input.projectId !== undefined) {
    const parsed = parseId(input.projectId)
    if (parsed === null || parsed.kind !== 'PROJECT') {
      throw new ScaffoldError(
        'SCAFFOLD_ID',
        `the explicit projectId is not a well-formed PROJECT id: ${JSON.stringify(input.projectId)}`,
      )
    }
    projectId = input.projectId
  } else {
    projectId = allocateProjectId(input.knownProjectIds ?? [])
  }

  // ── write the tree (the two files, in SCAFFOLD_FILES order) ──
  const now = input.now ?? Date.now
  mkdirSync(treePath, { recursive: true })
  writeFileSync(join(treePath, SCHEMA_VERSION_FILE), SCHEMA_VERSION_VALUE + '\n', 'utf8')
  writeFileSync(
    join(treePath, PROJECT_YAML_FILE),
    projectYamlText(projectId, title, isoTimestampUtc(now())),
    'utf8',
  )
  return { treePath, projectId, files: [...SCAFFOLD_FILES] }
}
