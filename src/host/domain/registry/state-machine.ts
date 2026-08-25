/**
 * V2-T2.3 — registry entry state machine: PURE immutable updates
 * (design §3.2 条目状态机, the registry half of §4/§7.4/§8 flows).
 *
 * Design references:
 *  - §4 MISSING 处置「移除登记」: the entry turns `archived` (NOT
 *    deleted — the hub's event database is kept, §9 库生命周期) →
 *    `archiveEntry`;
 *  - §7.4「恢复登记」/ §8 恢复流程: the entry turns back `active` and
 *    `archivedAt` is cleared; the I/O half (renaming the tree directory
 *    back, re-attaching the hub database, re-validation → MANAGED) is
 *    T2.2/T3.x's work — this module owns the registry file state only;
 *  - §8 接入（有中枢）: `upsertEntry` (bindProject appends a new active
 *    entry; re-binding an existing id replaces the entry).
 *
 * Contract:
 *  - every function returns a NEW deep-frozen `RegistryFile`; the input
 *    is NEVER mutated (immutability is the load-bearing discipline —
 *    T2.2 may hold the pre-update file as its reconciliation baseline).
 *    The result is always a fresh deep-frozen structure: sibling
 *    entries are deep-equal copies (NOT the input's object references);
 *  - unknown ids fail loud ({@link RegistryMutationError} `ENTRY_NOT_FOUND`);
 *    same-state no-ops are REJECTED, never silently tolerated (repo
 *    discipline — cf. the WP-1.4 topology state machine: a no-op is not
 *    in the transition table);
 *  - inputs are re-validated against the frozen §3.2 contract at the
 *    boundary (`upsertEntry` validates the whole entry; `archiveEntry`
 *    validates the timestamp) — a corrupted in-memory file fails loud
 *    instead of being persisted.
 */

import {
  assertEntryTimestampConsistency,
  describeZodIssues,
  RegistryEntrySchema,
} from './schemas.js'
import { freezeRegistryFile, RegistryMutationError, type RegistryEntry, type RegistryFile } from './types.js'

/**
 * 解绑归档 (§4「移除登记」): `active` → `archived`, stamping
 * `archivedAt` with `ts`.
 *
 * @param file - the current registry file (never mutated).
 * @param id - the entry id (must exist; well-formedness follows from
 *  existence — a registry never contains malformed ids).
 * @param ts - the archive moment, epoch ms, non-negative integer.
 * @returns a new registry file with the entry archived.
 * @throws {RegistryMutationError} `INVALID_TIMESTAMP` (bad `ts`),
 *  `ENTRY_NOT_FOUND` (unknown id), `ALREADY_ARCHIVED` (same-state no-op).
 */
export function archiveEntry(file: RegistryFile, id: string, ts: number): RegistryFile {
  if (!isNonNegativeInteger(ts)) {
    throw new RegistryMutationError(
      'INVALID_TIMESTAMP',
      `archiveEntry: ts must be a non-negative integer epoch-ms value (got ${JSON.stringify(ts)})`,
      { entryId: id },
    )
  }
  const entry = findEntry(file, id)
  if (entry.status === 'archived') {
    throw new RegistryMutationError(
      'ALREADY_ARCHIVED',
      `entry ${JSON.stringify(id)} is already archived (archivedAt=${String(entry.archivedAt)}) — ` +
        'archiving is a one-way transition until restoreEntry',
      { entryId: id },
    )
  }
  return withEntry(file, id, { ...entry, status: 'archived', archivedAt: ts })
}

/**
 * 恢复登记 (§7.4/§8): `archived` → `active`, clearing `archivedAt` to
 * `null` (the §3.2 invariant: an active entry carries no archive stamp).
 *
 * @returns a new registry file with the entry restored.
 * @throws {RegistryMutationError} `ENTRY_NOT_FOUND` (unknown id),
 *  `NOT_ARCHIVED` (the entry is already active — nothing to restore).
 */
export function restoreEntry(file: RegistryFile, id: string): RegistryFile {
  const entry = findEntry(file, id)
  if (entry.status === 'active') {
    throw new RegistryMutationError(
      'NOT_ARCHIVED',
      `entry ${JSON.stringify(id)} is already active — there is nothing to restore`,
      { entryId: id },
    )
  }
  return withEntry(file, id, { ...entry, status: 'active', archivedAt: null })
}

/**
 * 登记/更新 (§8 接入): insert a new entry (appended at the end) or
 * replace the entry with the same id IN PLACE (registry order is the
 * user's declaration order — upsert never reorders; other entries keep
 * their positions, deep-equal copies in the fresh frozen result).
 *
 * @param entry - the entry to register; fully validated against the
 *  frozen §3.2 contract (shape + id pattern + absolute path + status
 *  enum + timestamps + the status↔archivedAt cross-rule) before it is
 *  admitted — a malformed entry can never enter the file.
 * @returns a new registry file with the entry upserted.
 * @throws {RegistryMutationError} `INVALID_ENTRY` (contract violation —
 *  the message names the violating field(s)).
 */
export function upsertEntry(file: RegistryFile, entry: RegistryEntry): RegistryFile {
  const checked = assertValidEntry(entry)
  const projects = [...file.projects]
  const idx = projects.findIndex((e) => e.id === checked.id)
  if (idx === -1) {
    projects.push(checked)
  } else {
    projects[idx] = checked
  }
  return freezeRegistryFile({ version: file.version, projects })
}

/**
 * Locate an entry by id.
 *
 * @throws {RegistryMutationError} `ENTRY_NOT_FOUND` — the registry has
 *  no entry with that id.
 */
export function findEntry(file: RegistryFile, id: string): RegistryEntry {
  const entry = file.projects.find((e) => e.id === id)
  if (entry === undefined) {
    throw new RegistryMutationError(
      'ENTRY_NOT_FOUND',
      `registry has no entry with id ${JSON.stringify(id)} (known ids: ${
        file.projects.length > 0 ? file.projects.map((e) => e.id).join(', ') : '— registry is empty'
      })`,
      { entryId: id },
    )
  }
  return entry
}

/* ------------------------------------------------------------------ *
 * Internals
 * ------------------------------------------------------------------ */

/** Replace the entry with id `id` (whose existence the caller checked). */
function withEntry(file: RegistryFile, id: string, replacement: RegistryEntry): RegistryFile {
  return freezeRegistryFile({
    version: file.version,
    projects: file.projects.map((e) => (e.id === id ? replacement : e)),
  })
}

/**
 * Full boundary validation of one entry candidate (the frozen §3.2
 * contract): strict schema + the status↔archivedAt cross-rule. Returns
 * a frozen copy of the validated entry.
 */
function assertValidEntry(entry: unknown): RegistryEntry {
  const result = RegistryEntrySchema.safeParse(entry)
  if (!result.success) {
    const rawId = (entry as { id?: unknown } | null | undefined)?.id
    const id = typeof rawId === 'string' ? rawId : undefined
    throw new RegistryMutationError(
      'INVALID_ENTRY',
      `entry ${JSON.stringify(id ?? '<unknown>')} is not a valid registry entry: ${describeZodIssues(result.error.issues)}`,
      { entryId: id },
    )
  }
  const problem = assertEntryTimestampConsistency(result.data)
  if (problem !== null) {
    throw new RegistryMutationError('INVALID_ENTRY', `entry ${JSON.stringify(result.data.id)}: ${problem}`, {
      entryId: result.data.id,
    })
  }
  return Object.freeze({ ...result.data })
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0
}
