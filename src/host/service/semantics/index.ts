/**
 * UI-7 (D1–D3) — public surface of the seven-write semantic records
 * service (the D §13 Records management face; the ADJ-2 canonical
 * semantic write protocol lives here).
 *
 * Boundary: host service layer — the SEMANTIC DOMAIN is untouched (the
 * service composes the domain's pure pre-validation + the frozen registry
 * hook + the RR-011(b) store fold seam; it never re-implements a rule).
 */

export { SemanticRecordsService } from './service.js'
export { mapSemanticsError } from './errors.js'
export { canonicalSemanticAppend, type CanonicalAppendIds, type CanonicalSemanticAppendResult, type CanonicalSemanticAppendSpec, type SemanticValidateHook } from './protocol.js'
export { querySemanticRecords, QUERY_DEFAULT_LIMIT, QUERY_MAX_LIMIT } from './query.js'
export type {
  AddRelationArgs,
  AddRelationResult,
  MarkArtifactMissingArgs,
  MarkArtifactMissingResult,
  RecordClaimArgs,
  RecordClaimResult,
  RecordFactArgs,
  RecordFactResult,
  RegisterArtifactArgs,
  RegisterArtifactResult,
  RetractClaimArgs,
  RetractClaimResult,
  RemoveRelationArgs,
  RemoveRelationResult,
  QueryRecordsArgs,
  QueryRecordsResult,
  SemanticEndpointRef,
  SemanticIdAllocator,
  SemanticPlanIndex,
  SemanticRecordsServiceOptions,
  SemanticRecordsStorePort,
  SemanticWorkstreamIndex,
} from './types.js'
