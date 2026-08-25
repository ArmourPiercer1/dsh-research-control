/**
 * V2-T2.3 — deterministic serialization of `registry.yaml`.
 *
 * Guarantees (same philosophy as WP-1.3 plan/serialize.ts — byte-stable
 * output for identical data, pinned by tests):
 *
 *  - FIXED KEY ORDER: `version` → `projects` at the top level; per entry
 *    `id` → `path` → `displayName` → `status` → `boundAt` → `archivedAt`
 *    (the frozen §3.2 example order). The ENTRY LIST ORDER is preserved
 *    exactly as given — registry order is the user's declaration order,
 *    and the serializer never reorders entries (no sort, no dedup);
 *  - the `yaml` library with PINNED options (insertion-order maps,
 *    `lineWidth: 0` no line-folding, plain style with library-controlled
 *    quoting — deterministic per value: special characters in
 *    `path`/`displayName` are quoted exactly when YAML requires it);
 *  - one fixed header comment (the design §3.2 self-description line —
 *    product-facing text, stable across versions of the plugin);
 *  - ROUND-TRIP: `parseRegistry(serializeRegistry(f))` deep-equals `f`,
 *    and `serializeRegistry` of any valid input normalizes to this
 *    canonical form (hand-written comments/ordering are canonicalized —
 *    the file is co-maintained, but the plugin's writes are canonical).
 *
 * Input is validated against the frozen §3.2 contract before writing
 * (defensive — a hand-built in-memory file that skips the parser must
 * still fail loud here rather than produce a malformed registry).
 */

import { stringify } from 'yaml'

import {
  assertEntryTimestampConsistency,
  describeZodIssues,
  RegistryEntrySchema,
} from './schemas.js'
import { RegistryMutationError, type RegistryEntry, type RegistryFile } from './types.js'

/**
 * Fixed file header — the design §3.2 example's self-description line
 * (verbatim; product copy is Chinese per repo discipline).
 */
export const REGISTRY_HEADER =
  '# registry.yaml —— 研究管理中枢的项目登记册（声明真源，人工/插件共同维护）\n'

/** Pinned `yaml` options (frozen for byte-stability; see module doc). */
const YAML_OPTIONS = { lineWidth: 0 } as const

/**
 * Serialize a registry file to its canonical `registry.yaml` text.
 *
 * @param file - a valid registry file (validated here against the
 *  frozen §3.2 contract — version literal + every entry shape + the
 *  status↔archivedAt cross-rule).
 * @returns the complete file text (header comment included), with a
 *  single trailing newline.
 * @throws {RegistryMutationError} `INVALID_ENTRY` — the in-memory file
 *  violates the frozen contract (never emits a malformed registry).
 */
export function serializeRegistry(file: RegistryFile): string {
  if (file.version !== 1) {
    throw new RegistryMutationError(
      'INVALID_ENTRY',
      `registry file version must be 1 (got ${JSON.stringify(file.version)})`,
    )
  }
  file.projects.forEach((entry, i) => assertCarrierEntry(entry, `projects[${i}]`))

  // Canonical carrier: keys in the frozen field-table order (the
  // insertion order IS the serialization order — no library sorting).
  const carrier: Record<string, unknown> = {
    version: file.version,
    projects: file.projects.map((e) => ({
      id: e.id,
      path: e.path,
      displayName: e.displayName,
      status: e.status,
      boundAt: e.boundAt,
      archivedAt: e.archivedAt,
    })),
  }
  return REGISTRY_HEADER + stringify(carrier, YAML_OPTIONS)
}

/** Validate one in-memory entry against the frozen contract (fail loud). */
function assertCarrierEntry(entry: RegistryEntry, label: string): void {
  const result = RegistryEntrySchema.safeParse(entry)
  if (!result.success) {
    throw new RegistryMutationError(
      'INVALID_ENTRY',
      `${label} is not a valid registry entry: ${describeZodIssues(result.error.issues)}`,
      { entryId: typeof (entry as { id?: unknown }).id === 'string' ? (entry as { id: string }).id : undefined },
    )
  }
  const problem = assertEntryTimestampConsistency(result.data)
  if (problem !== null) {
    throw new RegistryMutationError('INVALID_ENTRY', `${label} (${result.data.id}): ${problem}`, {
      entryId: result.data.id,
    })
  }
}
