/**
 * Client store model (WP-4.1b) — slice state types, slice-key
 * canonicalization, the observable state shape, and the RPC error carrier.
 *
 * Type derivation (task brief:「类型从共享 contracts 派生 — 无手写重复」):
 * every DTO below is IMPORTED from `src/shared/rpc-contracts.ts` — the
 * single frozen contract source (WP-4.1a). That module pairs each DTO
 * interface with its strict zod schema (the runtime twin the gateway
 * decodes with); the interfaces are the nominal type face the
 * `researchRpc` facade resolves to (mount.ts signatures), which is what
 * the slices store. This file declares ZERO wire types of its own.
 * (Deriving via `z.infer` instead was considered: the codec-inferred
 * arrays are mutable while the facade result types carry `readonly`
 * arrays, so a facade value is not assignable into a `z.infer` slot —
 * the shared interfaces are the only assignment-safe derived face.)
 *
 * Slice identity: the store caches one entry per (slice, key) pair:
 *  - `dashboard` / `project` — singleton keys (V1: one project per host);
 *  - `topics:<topicId>` / `workstreams:<workstreamId>` — id keys;
 *  - `history:<canonicalQuery>` — the `queryHistory` window (args
 *    canonicalized so re-issuing the same window hits the cache);
 *  - `gitHistory:<canonicalQuery>` — the `getGitHistory` window;
 *  - `currentFocus:<workstreamId>` — the R-01 current-focus pointer
 *    (UI-0.4; the frozen WorkstreamSnapshot cannot carry it, see the
 *    state field below).
 *
 * The GLOBAL slice key (used by the invalidate registry) is
 * `<slice>:<local key>`; `parseSliceKey` is its exact inverse.
 */

import type {
  DashboardSnapshot,
  DismissPlanForkArgs,
  DismissPlanForkResult,
  GetCurrentFocusResult,
  GetGitHistoryArgs,
  GetGitHistoryResult,
  GetTopicArgs,
  GetWorkstreamArgs,
  ProjectSnapshot,
  QueryHistoryArgs,
  QueryHistoryResult,
  ReorderPlanArgs,
  ReorderPlanResult,
  RegisterInteractionArgs,
  RegisterInteractionResult,
  RestoreDeclarativeFileArgs,
  RestoreDeclarativeFileResult,
  SaveResearchCheckpointArgs,
  SaveResearchCheckpointResult,
  SelectPlanForkArgs,
  SelectPlanForkResult,
  TopicSnapshot,
  UpdateInterventionStateArgs,
  UpdateInterventionStateResult,
  WorkstreamSnapshot,
} from '../../shared/rpc-contracts.js'

// Re-export the contract types so store consumers (Phase 4 views, tests)
// address ONE module for the store face and its data types. No redeclaration.
export type {
  DashboardSnapshot,
  DismissPlanForkArgs,
  DismissPlanForkResult,
  GetCurrentFocusResult,
  GetGitHistoryArgs,
  GetGitHistoryResult,
  GetTopicArgs,
  GetWorkstreamArgs,
  ProjectSnapshot,
  QueryHistoryArgs,
  QueryHistoryResult,
  ReorderPlanArgs,
  ReorderPlanResult,
  RegisterInteractionArgs,
  RegisterInteractionResult,
  RestoreDeclarativeFileArgs,
  RestoreDeclarativeFileResult,
  SaveResearchCheckpointArgs,
  SaveResearchCheckpointResult,
  SelectPlanForkArgs,
  SelectPlanForkResult,
  TopicSnapshot,
  UpdateInterventionStateArgs,
  UpdateInterventionStateResult,
  WorkstreamSnapshot,
}

/* -------------------------------------------------------------------- *
 * Slice state machine
 * -------------------------------------------------------------------- */

/**
 * The slice state machine (task brief: loading/ready/error, snapshot
 * cache). `idle` marks「从未请求」— lazy loading per ARCHITECTURE §8
 * (workstream 图按 Topic 懒加载; history 按窗口分页): an idle slice is
 * fetched on first `load*` call only.
 */
export type SliceStatus = 'idle' | 'loading' | 'ready' | 'error'

/**
 * One cached query slice.
 *
 * Stale-while-revalidate: a refetch of a slice that already carries data
 * keeps `data` visible while `status` is `'loading'`; on failure the
 * last good data is KEPT and `status` becomes `'error'` (the view can
 * render the stale page plus an error banner). A first-load failure
 * leaves `data: null`.
 */
export interface SliceState<T> {
  readonly status: SliceStatus
  /** The last good payload (`null` until the first successful load). */
  readonly data: T | null
  /** The last failure message (set when `status === 'error'`). */
  readonly error: string | null
  /** Epoch ms of the last successful load (`null` before that). */
  readonly updatedAt: number | null
}

/** The initial (idle) slice state. */
export function idleSlice<T>(): SliceState<T> {
  return { status: 'idle', data: null, error: null, updatedAt: null }
}

/* -------------------------------------------------------------------- *
 * Observable state shape
 * -------------------------------------------------------------------- */

/**
 * The research store snapshot (the `createResearchStore` state).
 *
 * Immutability discipline for `useSyncExternalStore` (engine §1): every
 * mutation replaces exactly the changed node — a changed slice entry
 * gets a new object, its parent `Map` a new reference, and the top-level
 * object a new reference — while every UNCHANGED entry keeps its
 * reference (a Phase 4 selector reading `state.topics.get(id)` with
 * Object.is equality therefore re-renders only when that entry changed).
 */
export interface ResearchStoreState {
  readonly dashboard: SliceState<DashboardSnapshot>
  readonly project: SliceState<ProjectSnapshot>
  /** Keyed by `topicId`. */
  readonly topics: ReadonlyMap<string, SliceState<TopicSnapshot>>
  /** Keyed by `workstreamId`. */
  readonly workstreams: ReadonlyMap<string, SliceState<WorkstreamSnapshot>>
  /** Keyed by the canonical `queryHistory` window (see `historyKey`). */
  readonly history: ReadonlyMap<string, SliceState<QueryHistoryResult>>
  /** Keyed by the canonical `getGitHistory` window (see `gitHistoryKey`). */
  readonly gitHistory: ReadonlyMap<string, SliceState<GetGitHistoryResult>>
  /**
   * Keyed by `workstreamId` (UI-0.4, R-01). The current-focus pointer:
   * the frozen `WorkstreamSnapshot` cannot carry it (rpc-contracts
   * §getCurrentFocus note), so the pointer lives in its OWN slice family
   * instead of riding the workstream slice.
   */
  readonly currentFocus: ReadonlyMap<string, SliceState<GetCurrentFocusResult>>
}

/** The initial store snapshot: all slices idle, all maps empty. */
export function initialResearchStoreState(): ResearchStoreState {
  return {
    dashboard: idleSlice<DashboardSnapshot>(),
    project: idleSlice<ProjectSnapshot>(),
    topics: new Map(),
    workstreams: new Map(),
    history: new Map(),
    gitHistory: new Map(),
    currentFocus: new Map(),
  }
}

/* -------------------------------------------------------------------- *
 * RPC result carrier
 * -------------------------------------------------------------------- */

/**
 * One RPC failure as the store surfaces it — structural mirror of the
 * protocol `RemoteFailure` (dsh-typert-protocol `lib/types/types.d.ts:39-43`,
 * field-for-field). The store layer is business territory (INV-PERM-5: no
 * `@deepseek-ai/*` import); the REAL protocol type is attached at the
 * facade boundary (mount.ts), whose `RemoteResult<T>` return is
 * assignable into `RpcResult<T>` below by construction (same fields,
 * same modifiers) — the tsc structural check at that boundary keeps the
 * mirror honest (the rpc-contracts.ts mirror precedent).
 */
export interface RpcFailure {
  readonly code: string
  readonly message: string
  readonly details: object
}

/** Structural mirror of the protocol `RemoteResult` (types.d.ts:51-57). */
export type RpcResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: RpcFailure }

/* -------------------------------------------------------------------- *
 * Slice keys
 * -------------------------------------------------------------------- */

/** The slice names (the global-key prefixes; also the state field names). */
export type SliceName =
  | 'dashboard'
  | 'project'
  | 'topics'
  | 'workstreams'
  | 'history'
  | 'gitHistory'
  | 'currentFocus'

export const SLICE_NAMES: readonly SliceName[] = [
  'dashboard',
  'project',
  'topics',
  'workstreams',
  'history',
  'gitHistory',
  'currentFocus',
]

/**
 * The global slice key: `<slice>:<local key>`. Singleton slices use the
 * bare name (`'dashboard'`, `'project'`); the parameterized slices carry
 * their local key after the colon.
 */
export type SliceKey =
  | 'dashboard'
  | 'project'
  | `topics:${string}`
  | `workstreams:${string}`
  | `history:${string}`
  | `gitHistory:${string}`
  | `currentFocus:${string}`

/** Compose a global slice key. */
export function sliceKey(slice: SliceName, localKey: string): SliceKey {
  return (slice === 'dashboard' || slice === 'project' ? slice : `${slice}:${localKey}`) as SliceKey
}

/**
 * Parse a global slice key back into (slice, local key). Throws on a
 * malformed key (the keys this store mints are the only valid input;
 * a parse failure is a programming error, not data).
 */
export function parseSliceKey(key: SliceKey): { readonly slice: SliceName; readonly key: string } {
  if (key === 'dashboard' || key === 'project') return { slice: key, key }
  const idx = key.indexOf(':')
  if (idx <= 0) throw new Error(`research store: malformed slice key "${key}"`)
  const slice = key.slice(0, idx)
  if (!(SLICE_NAMES as readonly string[]).includes(slice)) {
    throw new Error(`research store: unknown slice "${slice}" in key "${key}"`)
  }
  return { slice: slice as SliceName, key: key.slice(idx + 1) }
}

/**
 * Canonical `queryHistory` window key. Optional args are folded to their
 * wire defaults (order `'semantic'`, `afterSeq` 0, no `beforeSeq`, no
 * `limit`) so semantically identical args hit the same cache entry.
 */
export function historyKey(args: QueryHistoryArgs): string {
  return [
    args.workstreamId,
    `order=${args.order ?? 'semantic'}`,
    `after=${args.afterSeq ?? 0}`,
    `before=${args.beforeSeq ?? ''}`,
    `limit=${args.limit ?? ''}`,
  ].join('|')
}

/**
 * Canonical `getGitHistory` window key (all four args optional; absent =
 * the host default — the whole `.research/**` tree, no baseline/skip).
 */
export function gitHistoryKey(args: GetGitHistoryArgs): string {
  return [
    `path=${args.path ?? ''}`,
    `baseline=${args.baseline ?? ''}`,
    `max=${args.maxCount ?? ''}`,
    `skip=${args.skip ?? ''}`,
  ].join('|')
}

/* -------------------------------------------------------------------- *
 * RPC failure carrier
 * -------------------------------------------------------------------- */

/**
 * One failed RPC as the store surfaces it to views. Carries the frozen
 * carrier fields (protocol `RemoteFailure`: `code` open string — the
 * closed code union belongs to the carrier package — plus `message` and
 * `details`); assembly faults (a not-yet-mounted facade) reject with a
 * plain `Error` instead and stay distinguishable by `instanceof`.
 */
export class ResearchRpcError extends Error {
  readonly code: string
  readonly details: object

  constructor(code: string, message: string, details: object) {
    super(message)
    this.name = 'ResearchRpcError'
    this.code = code
    this.details = details
  }
}
