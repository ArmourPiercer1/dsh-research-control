/**
 * TopologyGraphContainer (WP-4.5, extended UI-6 D4) — the CONTAINER layer
 * of the TopologyGraph view (one container per view, DSH_ADAPTER §6
 * two-layer discipline).
 *
 * Same contract as PlanGraphContainer: the store handle arrives as a PROP,
 * `useStoreSnapshotSelected` binds the topic slice (one subscription), the
 * lazy `loadTopic` fires on mount (ARCHITECTURE §8), and the derived graph
 * (`topologyToGraph`) is passed as a pure prop to `TopologyGraphView`.
 *
 * UI-6 D4: this seat is the Topic page's topology zone — the single
 * first-version mutation entry (ADJ-6 / B §21.1 entry one). The mutation
 * face resolves HERE: the view's callbacks are store-backed wrappers
 * (the mutation idiom `okValue → refetchKeys(INVALIDATE_REGISTRY)` lives
 * in the store methods, D4⑧ — no optimistic updates), `topicId` is bound
 * here (the frozen Args), and failures REJECT so the view can surface the
 * error inside its dialog (the slice refetch on success re-derives the
 * graph — no manual state sync).
 */

import { useCallback, useEffect, useMemo, type ReactElement } from 'react'
import {
  idleSlice,
  type ResearchStore,
  type ResearchStoreState,
  type SliceState,
  type TopicSnapshot,
} from '../stores/index.js'
import type { WorkstreamCardDto } from '../../shared/rpc-contracts.js'
import { topologyToGraph } from './topology-model.js'
import { TopologyGraphView } from './TopologyGraphView.js'
import { useStoreSnapshotSelected } from './store-binding.js'
import { TOPOLOGY_GRAPH_STYLES as styles, ensureGraphStyles } from './graph-styles.js'
import { t } from '../i18n/copy.js'

/** Reference-stable idle sentinel (a value — NOT a store handle). */
const IDLE_TOPIC = idleSlice<TopicSnapshot>()

export interface TopologyGraphContainerProps {
  /** The research store (factory result — the container's only store face). */
  readonly store: ResearchStore
  /** The topic whose Workstream topology graph is rendered. */
  readonly topicId: string
}

/**
 * Container: store slice → derived topology graph → TopologyGraphView +
 * the store-backed mutation face (UI-6 D4).
 */
export function TopologyGraphContainer({ store, topicId }: TopologyGraphContainerProps): ReactElement {
  const slice: SliceState<TopicSnapshot> = useStoreSnapshotSelected(
    store,
    useCallback(
      (state: ResearchStoreState) => state.topics.get(topicId) ?? IDLE_TOPIC,
      [topicId],
    ),
  )

  // Lazy load on mount (the store dedupes in-flight fetches per slice key);
  // the combined stylesheets are injected idempotently at the same time
  // (the banner/loading states render before the view's own effect can run).
  useEffect(() => {
    ensureGraphStyles()
    void store.loadTopic(topicId).catch(() => {
      // Transport faults reject; the slice carries the error (banner below).
    })
  }, [store, topicId])

  const graph = useMemo(() => (slice.data ? topologyToGraph(slice.data) : null), [slice.data])

  // UI-6 D4: the mutation face — store-backed callbacks. `topicId` is
  // bound here (the frozen Args); the store methods carry the
  // okValue → INVALIDATE_REGISTRY → refetchKeys idiom (D4⑧ — no
  // optimistic updates); a rejection propagates to the view's dialog
  // error line.
  const onCreateFork = useCallback(
    async (input: {
      readonly parentWorkstreamId: string
      readonly children: readonly { readonly title: string; readonly note?: string }[]
    }): Promise<void> => {
      await store.createWorkstreamFork({
        topicId,
        parentWorkstreamId: input.parentWorkstreamId,
        children: input.children.map(child =>
          child.note !== undefined ? { title: child.title, note: child.note } : { title: child.title },
        ),
      })
    },
    [store, topicId],
  )

  const onCreateMerge = useCallback(
    async (input: {
      readonly inputWorkstreamIds: string[]
      readonly outputWorkstreamId: string
      readonly note?: string
    }): Promise<string | undefined> => {
      const result = await store.createPlannedMerge({
        topicId,
        inputWorkstreamIds: input.inputWorkstreamIds,
        outputWorkstreamId: input.outputWorkstreamId,
        ...(input.note !== undefined ? { note: input.note } : {}),
      })
      // The NEW edge id — the view opens the contract editor on it
      // (B §22 "Create / Edit later").
      return result.edgeId
    },
    [store, topicId],
  )

  const onDropEdge = useCallback(
    async (edgeId: string): Promise<void> => {
      await store.dropTopologyEdge({ edgeId })
    },
    [store],
  )

  const loadContract = useCallback(
    async (edgeId: string): Promise<{ readonly content: string | null; readonly path: string }> => {
      const result = await store.getMergeContract({ edgeId })
      return { content: result.content, path: result.path }
    },
    [store],
  )

  const onSaveContract = useCallback(
    async (edgeId: string, content: string): Promise<void> => {
      await store.saveMergeContract({ edgeId, content })
    },
    [store],
  )

  const workstreams: readonly WorkstreamCardDto[] | undefined = slice.data?.workstreams

  if (slice.data === null) {
    if (slice.status === 'error') {
      return (
        <div className={styles.root}>
          <div className={styles.errorBanner}>{t('common.loadFailedDetail', { detail: slice.error ?? '' })}</div>
        </div>
      )
    }
    return (
      <div className={styles.root}>
        <div className={styles.loading}>{t('common.loading')}</div>
      </div>
    )
  }

  return (
    <div className={styles.root}>
      {slice.status === 'error' && (
        <div className={styles.errorBanner}>{t('common.refreshFailedShowLast', { detail: slice.error ?? '' })}</div>
      )}
      {graph !== null && (
        <TopologyGraphView
          graph={graph}
          workstreams={workstreams}
          onCreateFork={onCreateFork}
          onCreateMerge={onCreateMerge}
          onDropEdge={onDropEdge}
          loadContract={loadContract}
          onSaveContract={onSaveContract}
        />
      )}
    </div>
  )
}
