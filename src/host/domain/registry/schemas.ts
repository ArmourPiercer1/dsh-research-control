/**
 * V2-T2.3 — strict zod schemas for `registry.yaml` (design §3.2 校验纪律:
 * 「schema 严格校验；畸形即 fail-loud」).
 *
 * Discipline (same as src/shared/rpc-contracts.ts — the repo's zod
 * precedent): every object schema is `.strict()`, so an unknown key is
 * rejected at the boundary and never silently ignored. The frozen §3.2
 * contract, item by item:
 *  - the document is EXACTLY `{ version, projects }` — no extra top-level
 *    keys;
 *  - each entry is EXACTLY `{ id, path, displayName, status, boundAt,
 *    archivedAt }` — no extra entry keys;
 *  - `id` matches `^PRJ-[1-9][0-9]*$` (DOMAIN_SCHEMA §1.1 row 1 — PRJ /
 *    PROJECT, identical to the frozen `common.schema.json#/$defs/idProject`
 *    pattern), with a safe-integer sequence (the shared/ids parser's
 *    strictness: `PRJ-99999999999999999999` is not a parseable research id
 *    and could therefore never match a target tree's project.yaml);
 *  - `path` is an absolute path (POSIX `/…`, Windows drive root, or UNC
 *    root — see ABSOLUTE_PATH_PATTERN);
 *  - `status` is the closed enum `active | archived`;
 *  - `boundAt` / `archivedAt` are non-negative integers (epoch ms);
 *  - the status↔archivedAt cross-rule (archived ⇒ archivedAt set; active ⇒
 *    archivedAt null) is enforced by {@link assertEntryTimestampConsistency}
 *    at BOTH the parse boundary (with source-line attribution) and the
 *    mutation/serialize boundary — it is kept OUT of the zod schema because
 *    the parse layer needs the violation's line number, which a schema
 *    refinement cannot carry.
 *
 * The inferred shapes are structurally identical to the documented
 * interfaces in `types.ts` (`RegistryFile` / `RegistryEntry` — the hand-
 * written twins keep the per-field JSDoc next to the contract).
 */

import { z } from 'zod'

/**
 * Frozen PRJ id pattern (DOMAIN_SCHEMA §1.1 row 1; the task contract:
 * `PRJ-[1-9][0-9]*`). Exported so the contract is inspectable/pinnable
 * from tests and the T3.1 RPC contract layer.
 */
export const PROJECT_ID_PATTERN = /^PRJ-[1-9][0-9]*$/

/**
 * Absolute-path predicate: POSIX root (`/…`), a Windows drive root
 * (`C:\…` / `C:/…`), or a UNC root (leading backslash —
 * `\server\share`). Relative paths, bare names, and empty strings are
 * rejected. Deliberately regex-based (the domain layer may not import
 * node builtins, ARCHITECTURE §2.2 rule 1).
 */
export const ABSOLUTE_PATH_PATTERN = /^(?:[A-Za-z]:[\\/]|\\|\/)/

/** Epoch-ms time carrier: non-negative integer (frozen §3.2 example: `boundAt: 1770000000000`). */
const epochMs = z.number().int().nonnegative()

/** Strict entry schema (frozen §3.2 field table, nothing else). */
export const RegistryEntrySchema = z
  .object({
    id: z
      .string()
      .regex(PROJECT_ID_PATTERN, 'id must match ^PRJ-[1-9][0-9]*$ (DOMAIN_SCHEMA §1.1, PRJ)')
      .refine(
        (id) => Number.isSafeInteger(Number(id.slice(4))),
        'id sequence must be a safe integer',
      ),
    path: z.string().regex(
      ABSOLUTE_PATH_PATTERN,
      'path must be an absolute path (POSIX "/…", Windows drive "C:\\…", or UNC "\\\…")',
    ),
    displayName: z.string(),
    status: z.enum(['active', 'archived']),
    boundAt: epochMs,
    archivedAt: epochMs.nullable(),
  })
  .strict()

/** Strict document schema: exactly `{ version: 1, projects: [...] }`. */
export const RegistryFileSchema = z
  .object({
    version: z.literal(1),
    projects: z.array(RegistryEntrySchema),
  })
  .strict()

/* ------------------------------------------------------------------ *
 * Cross-field rule + error-message helpers (shared by parse / state
 * machine / serialize — single source for the rule text)
 * ------------------------------------------------------------------ */

/**
 * The status↔archivedAt cross-rule (frozen §3.2 comment 「archived 时
 * 填」 + the active ⇒ null inverse). Returns a human-readable violation
 * description, or `null` when the entry is consistent.
 */
export function assertEntryTimestampConsistency(entry: {
  status: 'active' | 'archived'
  archivedAt: number | null
}): string | null {
  if (entry.status === 'archived' && entry.archivedAt === null) {
    return 'an archived entry must carry an archivedAt epoch-ms timestamp'
  }
  if (entry.status === 'active' && entry.archivedAt !== null) {
    return 'an active entry must have archivedAt null (got an epoch-ms value)'
  }
  return null
}

/**
 * Render one JSON-pointer-style location for a zod issue path
 * (`['projects', 0, 'id']` → `'/projects/0/id'`; the empty path →
 * `'(document root)'`).
 */
export function formatZodPointer(path: readonly PropertyKey[]): string {
  if (path.length === 0) return '(document root)'
  return `/${path.map((seg) => String(seg)).join('/')}`
}

/**
 * Compact one-line digest of zod issues (for thrown error messages —
 * every violation with its location, `;`-joined, deterministic order =
 * the schema's evaluation order).
 */
export function describeZodIssues(
  issues: readonly { readonly path: readonly PropertyKey[]; readonly message: string }[],
): string {
  return issues
    .map((issue) => (issue.path.length === 0 ? issue.message : `${formatZodPointer(issue.path)}: ${issue.message}`))
    .join('; ')
}
