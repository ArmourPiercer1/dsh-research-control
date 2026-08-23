/**
 * TopologyGraphContainer (WP-4.5) — the CONTAINER layer of the
 * TopologyGraph view (one container per view, DSH_ADAPTER §6 two-layer
 * discipline).
 *
 * Same contract as PlanGraphContainer: the store handle arrives as a PROP,
 * `useStoreSnapshotSelected` binds the topic slice (one subscription), the
 * lazy `loadTopic` fires on mount (ARCHITECTURE §8), and the derived graph
 * (`topologyToGraph`) is passed as a pure prop to `TopologyGraphView`.
 * Read-only view: no mutation entries on this seat.
 */

import { useCallback, useEffect, useMemo, type ReactElement } from 'react'
import {
  idleSlice,
  type ResearchStore,
  type ResearchStoreState,
  type SliceState,
  type TopicSnapshot,
} from '../stores/index.js'
import { topologyToGraph } from './topology-model.js'
import { TopologyGraphView } from './TopologyGraphView.js'
import { useStoreSnapshotSelected } from './store-binding.js'
import { TOPOLOGY_GRAPH_STYLES as styles, ensureGraphStyles } from './graph-styles.js'

/** Reference-stable idle sentinel (a value — NOT a store handle). */
const IDLE_TOPIC = idleSlice<TopicSnapshot>()

export interface TopologyGraphContainerProps {
  /** The research store (factory result — the container's only store face). */
  readonly store: ResearchStore
  /** The topic whose Workstream topology graph is rendered. */
  readonly topicId: string
}

/**
 * Container: store slice → derived topology graph → TopologyGraphView.
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

  if (slice.data === null) {
    if (slice.status === 'error') {
      return (
        <div className={styles.root} data-role="topology-graph">
          <div className={styles.errorBanner}>加载失败：{slice.error}</div>
        </div>
      )
    }
    return (
      <div className={styles.root} data-role="topology-graph">
        <div className={styles.loading}>加载中…</div>
      </div>
    )
  }

  return (
    <div className={styles.root} data-role="topology-graph">
      {slice.status === 'error' && (
        <div className={styles.errorBanner}>刷新失败：{slice.error}（显示上一次数据）</div>
      )}
      {graph !== null && <TopologyGraphView graph={graph} />}
    </div>
  )
}
