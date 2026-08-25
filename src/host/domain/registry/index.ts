/**
 * V2-T2.3 — public surface of the registry domain module
 * (`registry.yaml`: parse/serialize + entry state machine + the
 * dual-source reconciliation projection; design §3.2/§4/§12.1).
 *
 * Usage (T2.2 wiring / the T3.1+ RPC registry operation family):
 * ```ts
 * const file = parseRegistry(readFileSync(join(hubDir, 'registry.yaml'), 'utf8'))
 * const updated = archiveEntry(file, 'PRJ-1', Date.now())
 * writeAtomic(join(hubDir, 'registry.yaml'), serializeRegistry(updated))
 * const { managed, missing, standalone } = validateAgainstTrees(file, discoveredPaths)
 * ```
 * The kernel is pure (ARCHITECTURE §2.2 rule 1): no I/O, no DSH
 * imports (INV-PERM-5), no node builtins, no git — file reads/writes,
 * atomic-protocol, and all plane-state bookkeeping belong to the
 * service/wiring layer that CALLS this module.
 */

export { parseRegistry } from './parse.js'
export { REGISTRY_HEADER, serializeRegistry } from './serialize.js'
export { archiveEntry, findEntry, restoreEntry, upsertEntry } from './state-machine.js'
export { validateAgainstTrees } from './reconcile.js'
export {
  ABSOLUTE_PATH_PATTERN,
  assertEntryTimestampConsistency,
  describeZodIssues,
  formatZodPointer,
  PROJECT_ID_PATTERN,
  RegistryEntrySchema,
  RegistryFileSchema,
} from './schemas.js'
export {
  freezeRegistryFile,
  RegistryFormatError,
  RegistryMutationError,
  type RegistryEntry,
  type RegistryEntryStatus,
  type RegistryFile,
  type RegistryFormatCode,
  type RegistryMutationCode,
  type RegistryReconciliation,
} from './types.js'
