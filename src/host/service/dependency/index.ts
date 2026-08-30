/**
 * UI-5 (D2) — the dependency service module (host).
 *
 * Public face: the service (addDependency / removeDependency), the pure
 * ADJ-7 projection (`projectDependencyEdges`), the error mapper, and the
 * port/arg/result types. The semantics domain and the event registry are
 * CONSUMED, never modified.
 */

export { DependencyService } from './service.js'
export { projectDependencyEdges, type DependencyEdge, type DependencyEdgeEvent, type DependencyEdgesInput } from './projection.js'
export { mapDependencyError } from './errors.js'
export {
  DEPENDENCY_ENDPOINT_KINDS,
  type AddDependencyArgs,
  type AddDependencyResult,
  type DependencyEndpointKind,
  type DependencyEndpointRef,
  type DependencyIdAllocator,
  type DependencyPlanIndex,
  type DependencyServiceOptions,
  type DependencyStorePort,
  type DependencyWorkstreamIndex,
  type RemoveDependencyArgs,
  type RemoveDependencyResult,
} from './types.js'
