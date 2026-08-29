/**
 * §27.2 Project Page CONTAINER (WP-4.7, G4 S1) — the ONE store-touching
 * file of the project view (the two-layer rule, WP-4.2 precedent).
 *
 * DSH_ADAPTER §6 hard rules (client side, same contract as
 * HomeDashboard.tsx):
 *  - components never see the DSH ctx — the store HANDLE arrives as a
 *    plain prop (`store`), handed over by the cockpit (the 研究 tab root
 *    creates ONE `createResearchStore()` factory result per tab mount);
 *    navigation callbacks arrive as inject-face props;
 *  - no direct `useSyncExternalStore` in a display component — the store
 *    binding lives HERE and only here; the bound slice is passed down to
 *    the pure props `ProjectPageView` as plain data.
 *
 * Data path (ARCHITECTURE §8 — no self-built streaming):
 *  1. mount: the `project` slice is lazy (`idle` until first request) —
 *     the container issues `store.loadProject()`; the store's in-flight
 *     dedupe makes a StrictMode double-run issue exactly one fetch;
 *  2. `useSyncExternalStore` on the store face (structurally the host
 *     `HostObservable` getSnapshot/subscribe — no second subscription):
 *     a slice commit re-renders the container, which re-maps props;
 *  3. a first-load fault is swallowed (fire-and-forget) — the store has
 *     already recorded it in the slice (markError BEFORE the re-throw),
 *     and the slice state IS this view's rendering source; the home
 *     刷新 button drives `store.refresh()`, which refetches the project
 *     slice among the non-idle ones (the 刷新失败 banner comes from the
 *     slice's stale-while-revalidate error state).
 *
 * V2-UI-0.4 UI-3 (B §7.2 / §8.4 / §9.1): the container additionally
 *  - maps the store's `topics` slices onto the view's Topic-section
 *    faces; a section's FIRST EXPAND issues the lazy `store.loadTopic`
 *    (collapse is view-local and fetches nothing — plan §24 perf
 *    discipline, zero fetches on initial render);
 *  - drives the Topic `[Edit]` / `[+ Workstream]` / `+ Topic` dialogs
 *    (the Overview-side instances of the shared `topic-dialogs.tsx`
 *    components — the structure tree owns its own instances in
 *    ProjectConsole); mutations route with the explicit projectId
 *    (§12.1 — the page already renders one routed project);
 *  - drives the Recent History section (judgment #9): on FIRST expand it
 *    settles the topic slices (lazy `loadTopic` for the not-yet-loaded
 *    ones, plan order), collects up to 20 workstreams (the
 *    `showing first 20 workstreams` note when more), issues one
 *    `queryHistory({workstreamId, limit: 200})` window per workstream,
 *    takes the last 3 events of each window, and merges them
 *    occurredAt-desc. The converging effect re-runs on every store
 *    commit and is a no-op once settled (loadQuery in-flight dedupe
 *    makes double-issues safe).
 */
import { useEffect, useState, useSyncExternalStore, type ReactElement } from 'react'

import { historyKey, type ResearchStore } from '../../stores'

import { ProjectPageView, type RecentHistoryEntry } from './ProjectPageView'
import { CreateTopicDialog, CreateWorkstreamDialog, TopicEditDialog } from './topic-dialogs'

/** The Recent History window contract (judgment #9, frozen for tests):
 *  at most this many workstreams contribute, and the last this many
 *  events of each 200-row window. */
const RECENT_HISTORY_WS_CAP = 20
const RECENT_HISTORY_EVENTS_PER_WS = 3
/** The per-WS window: the same `limit: 200` window the WS page's
 *  timeline uses (one cache entry per window — the store's
 *  `historyKey` canonical key). */
const RECENT_HISTORY_WINDOW_LIMIT = 200

export interface ProjectPageProps {
  /** The research store handle (factory result — never a module-level handle). */
  readonly store: ResearchStore
  /** Drill-down: topic view (the cockpit's page navigation). */
  readonly onOpenTopic: (topicId: string) => void
  /** Back to the home dashboard. V2-T5.1 root-mode (project as overview
   * root, e.g. MANAGED/STANDALONE 总览) omits it — no back affordance. */
  readonly onBack?: () => void
}

/**
 * The §27.2 Project Page entry component: binds the store's `project`
 * slice (plus the UI-3 topic sections + recent-history faces) to the
 * pure props `ProjectPageView`.
 * @param props - store handle + navigation callbacks.
 * @returns the project page element.
 */
export function ProjectPage({ store, onOpenTopic, onBack }: ProjectPageProps): ReactElement {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const slice = snapshot.project

  // The action is fire-and-forget and its rejection is INTENTIONALLY
  // swallowed (same contract as HomeDashboard.tsx: the slice carries the
  // failure; the promise rejection would only be an unhandled-rejection
  // artifact, not a rendering source).
  const swallowSliceRecordedFault = (_err: unknown): undefined => undefined

  useEffect(() => {
    if (slice.status === 'idle') void store.loadProject().catch(swallowSliceRecordedFault)
  }, [store, slice.status])

  /* -- UI-3: Topic section dialog state (the Overview-side instances;
     the structure-tree instances live in ProjectConsole) -- */
  const [createTopicOpen, setCreateTopicOpen] = useState(false)
  const [addWsTopicId, setAddWsTopicId] = useState<string | null>(null)
  const [editTopicId, setEditTopicId] = useState<string | null>(null)

  /* -- UI-3: Recent History (judgment #9) -- */
  const [recentHistoryExpanded, setRecentHistoryExpanded] = useState(false)
  const [recentHistoryEntries, setRecentHistoryEntries] = useState<RecentHistoryEntry[] | null>(null)
  const [recentHistoryTruncated, setRecentHistoryTruncated] = useState(false)

  useEffect(() => {
    if (!recentHistoryExpanded) return
    const snap = store.getSnapshot()
    const project = snap.project.data
    if (project === null) return

    // Phase 1 — settle the topic slices (lazy loadTopic in plan order;
    // loadQuery's in-flight dedupe makes re-issues a no-op).
    const toLoadTopics: string[] = []
    let anyTopicLoading = false
    for (const topic of project.topics) {
      const topicSlice = snap.topics.get(topic.id)
      if (topicSlice === undefined || topicSlice.status === 'idle') toLoadTopics.push(topic.id)
      else if (topicSlice.status === 'loading') anyTopicLoading = true
    }
    if (toLoadTopics.length > 0) {
      for (const topicId of toLoadTopics) void store.loadTopic(topicId).catch(swallowSliceRecordedFault)
      return
    }
    if (anyTopicLoading) return

    // Phase 2 — collect workstreams in plan order (only topics whose
    // slice actually carried data contribute; a failed topic section is
    // already visible with its own error face when expanded). Cap the
    // contributors at RECENT_HISTORY_WS_CAP.
    const windows: { readonly wsId: string; readonly topicId: string; readonly wsTitle: string }[] = []
    let totalUsable = 0
    for (const topic of project.topics) {
      const topicSlice = snap.topics.get(topic.id)
      if (topicSlice === undefined || topicSlice.data === null) continue
      for (const ws of topicSlice.data.workstreams) {
        totalUsable += 1
        if (windows.length < RECENT_HISTORY_WS_CAP) windows.push({ wsId: ws.id, topicId: topic.id, wsTitle: ws.title })
      }
    }
    if (windows.length === 0) {
      setRecentHistoryEntries([])
      setRecentHistoryTruncated(false)
      return
    }

    // Phase 3 — settle the per-WS history windows (one `limit: 200`
    // window per WS — the same window key the WS page timeline uses).
    const windowKey = (wsId: string): string =>
      historyKey({ workstreamId: wsId, limit: RECENT_HISTORY_WINDOW_LIMIT })
    const toLoadWindows: string[] = []
    let anyWindowLoading = false
    for (const w of windows) {
      const historySlice = snap.history.get(windowKey(w.wsId))
      if (historySlice === undefined || historySlice.status === 'idle') toLoadWindows.push(w.wsId)
      else if (historySlice.status === 'loading') anyWindowLoading = true
    }
    if (toLoadWindows.length > 0) {
      for (const wsId of toLoadWindows)
        void store
          .loadHistory({ workstreamId: wsId, limit: RECENT_HISTORY_WINDOW_LIMIT })
          .catch(swallowSliceRecordedFault)
      return
    }
    if (anyWindowLoading) return

    // Phase 4 — merged, settled: last-N of each window, occurredAt-desc.
    const merged: RecentHistoryEntry[] = []
    for (const w of windows) {
      const historySlice = snap.history.get(windowKey(w.wsId))
      if (historySlice === undefined || historySlice.data === null) continue
      const tail = [...historySlice.data.events]
        .sort((a, b) => a.occurredAt - b.occurredAt)
        .slice(-RECENT_HISTORY_EVENTS_PER_WS)
      for (const event of tail) {
        merged.push({ event, workstreamId: w.wsId, workstreamTitle: w.wsTitle, topicId: w.topicId })
      }
    }
    merged.sort((a, b) => b.event.occurredAt - a.event.occurredAt)
    setRecentHistoryEntries(merged)
    setRecentHistoryTruncated(totalUsable > RECENT_HISTORY_WS_CAP)
    // `swallowSliceRecordedFault` is intentionally excluded from the deps
    // (it is a stable fire-and-forget closure over `store`; the effect
    // already re-runs on every relevant commit via `snapshot`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, snapshot, recentHistoryExpanded])

  // The view's Topic-section faces (the store's topics slices mapped to
  // plain structural data — the view never sees the store model).
  const topicSections = new Map(
    [...snapshot.topics.entries()].map(([topicId, s]) => [
      topicId,
      { status: s.status, data: s.data, error: s.error },
    ]),
  )

  const projectId = slice.data?.project.id

  const editTopicSlice = editTopicId !== null ? snapshot.topics.get(editTopicId) : undefined
  const editTopicCard =
    slice.data !== null && editTopicId !== null
      ? slice.data.topics.find((topic) => topic.id === editTopicId)
      : undefined
  const addWsCard =
    slice.data !== null && addWsTopicId !== null
      ? slice.data.topics.find((topic) => topic.id === addWsTopicId)
      : undefined

  return (
    <>
      <ProjectPageView
        data={slice.data}
        status={slice.status}
        error={slice.error}
        onRetry={() => {
          void store.loadProject().catch(swallowSliceRecordedFault)
        }}
        onOpenTopic={onOpenTopic}
        onBack={onBack}
        topicSections={topicSections}
        onExpandTopic={(topicId) => {
          void store.loadTopic(topicId).catch(swallowSliceRecordedFault)
        }}
        onRetryTopic={(topicId) => {
          void store.loadTopic(topicId).catch(swallowSliceRecordedFault)
        }}
        onEditTopic={(topicId) => setEditTopicId(topicId)}
        onAddWorkstream={(topicId) => setAddWsTopicId(topicId)}
        onCreateTopic={() => setCreateTopicOpen(true)}
        onExpandRecentHistory={() => setRecentHistoryExpanded(true)}
        recentHistory={{
          entries: recentHistoryEntries,
          loading: recentHistoryExpanded && recentHistoryEntries === null,
          truncated: recentHistoryTruncated,
        }}
      />

      {/* UI-3 — the Overview-side Topic dialogs (the shared components;
          fresh field state on every open — the owner remounts). */}
      {createTopicOpen && (
        <CreateTopicDialog
          onSave={(args) => store.createTopic({ ...args, ...(projectId !== undefined ? { projectId } : {}) })}
          onClosed={() => setCreateTopicOpen(false)}
        />
      )}
      {addWsCard !== undefined && projectId !== undefined && (
        <CreateWorkstreamDialog
          topicTitle={addWsCard.title}
          onSave={(args) =>
            store.createWorkstream({ ...args, topicId: addWsCard.id, projectId })
          }
          onClosed={() => setAddWsTopicId(null)}
        />
      )}
      {editTopicId !== null && editTopicSlice !== undefined && editTopicSlice.data !== null && editTopicCard !== undefined && (
        <TopicEditDialog
          initial={{
            title: editTopicSlice.data.topic.title,
            description: editTopicSlice.data.topic.description,
            importance: editTopicSlice.data.topic.importance,
            attentionMode: editTopicSlice.data.topic.attentionMode,
          }}
          onSave={(args) => store.updateTopic({ ...args, topicId: editTopicId, ...(projectId !== undefined ? { projectId } : {}) })}
          onClosed={() => setEditTopicId(null)}
        />
      )}
    </>
  )
}
