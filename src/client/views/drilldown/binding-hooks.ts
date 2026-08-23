/**
 * WP-4.6 — cockpit binding hooks (the ONE store-binding layer of the
 * drilldown package).
 *
 * Two-layer discipline (WP-4.3 precedent, DSH_ADAPTER §6/§11): `useSync-
 * ExternalStore` lives ONLY here — the cockpit-owned container components
 * (InterventionBoard / PfPanel / GitPanel / TopicPage / the drill-down
 * section) pull their slices through these hooks and pass plain data down.
 * No second subscription is built: the store face is structurally
 * `HostObservable<T>` and every hook binds the SAME store instance the
 * cockpit creates (one factory result per tab mount, never module-level).
 */

import { useCallback, useEffect, useSyncExternalStore } from 'react'

import type {
  DashboardSnapshot,
  GetGitHistoryArgs,
  GetGitHistoryResult,
  QueryHistoryArgs,
  QueryHistoryResult,
  TopicSnapshot,
  WorkstreamSnapshot,
} from '../../../shared/rpc-contracts.js'
import {
  gitHistoryKey,
  historyKey,
  idleSlice,
  type ResearchStore,
  type SliceState,
} from '../../stores/index.js'

/** Bind the singleton dashboard slice (lazy first load on mount). */
export function useDashboardSlice(store: ResearchStore): SliceState<DashboardSnapshot> {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  useEffect(() => {
    void store.loadDashboard().catch(() => {
      /* transport faults surface in the slice (stale-while-revalidate) */
    })
  }, [store])
  return state.dashboard
}

/**
 * Bind one topic slice (lazy first load on mount). An EMPTY id is a
 * sentinel (the caller does not know the topic yet) — no slice, no
 * request; the hook returns the idle placeholder.
 */
export function useTopicSlice(store: ResearchStore, topicId: string): SliceState<TopicSnapshot> {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const slice = topicId !== '' ? state.topics.get(topicId) : undefined
  useEffect(() => {
    if (topicId === '') return
    if (slice === undefined || slice.status === 'idle') {
      void store.loadTopic(topicId).catch(() => {
        /* transport faults surface in the slice */
      })
    }
  }, [store, topicId, slice])
  return slice ?? idleSlice<TopicSnapshot>()
}

/** Bind one workstream slice (lazy first load on mount). */
export function useWsSlice(store: ResearchStore, workstreamId: string): SliceState<WorkstreamSnapshot> {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const slice = state.workstreams.get(workstreamId)
  useEffect(() => {
    if (slice === undefined || slice.status === 'idle') {
      void store.loadWorkstream(workstreamId).catch(() => {
        /* transport faults surface in the slice */
      })
    }
  }, [store, workstreamId, slice])
  return slice ?? idleSlice<WorkstreamSnapshot>()
}

/**
 * Bind one `queryHistory` WINDOW slice with its own lazy load. The
 * drill-down section requests the FULL owner-WS log window (large limit —
 * V1 scale §29: 10^4 events is directly replayable).
 */
export function useHistorySlice(store: ResearchStore, args: QueryHistoryArgs): SliceState<QueryHistoryResult> {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const key = historyKey(args)
  const slice = state.history.get(key)
  const load = useCallback(() => {
    void store.loadHistory(args).catch(() => {
      /* transport faults surface in the slice */
    })
  }, [store, args])
  useEffect(() => {
    if (slice === undefined || slice.status === 'idle') load()
  }, [store, key, slice, load])
  return slice ?? idleSlice<QueryHistoryResult>()
}

/**
 * Bind one `getGitHistory` window slice with its own lazy load (the
 * checkpoint panel's contract-version list).
 */
export function useGitHistorySlice(store: ResearchStore, args: GetGitHistoryArgs): SliceState<GetGitHistoryResult> {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const key = gitHistoryKey(args)
  const slice = state.gitHistory.get(key)
  useEffect(() => {
    if (slice === undefined || slice.status === 'idle') {
      void store.loadGitHistory(args).catch(() => {
        /* transport faults surface in the slice */
      })
    }
  }, [store, key, slice, args])
  return slice ?? idleSlice<GetGitHistoryResult>()
}
