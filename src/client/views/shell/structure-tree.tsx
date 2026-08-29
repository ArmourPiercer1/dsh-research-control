/**
 * V2-UI-0.4 UI-3 — the Project structure tree (B §1.5 / §7.2 / §8.1-8.4).
 *
 * The left rail of the Project Console:
 *  - expanded form (B §8.1): `Project Name` → click → Project Overview;
 *    each Topic row is an expand/collapse control (B §8.1: "Topic 主要
 *    用于展开 / 收起"); under an expanded topic, the Workstream rows →
 *    click → Workstream Workspace (the SAME console `setPage` navigation
 *    functions the pages use — judgment #12: there is no second nav
 *    system);
 *  - collapsed form (B §8.2): a narrow rail keeping the reopen
 *    affordance + the current project marker (the spec's minimal
 *    second form); the collapse is USER-CONTROLLED (no auto-collapse —
 *    disclosed deviation, the B §8.2 purpose is the user's choice);
 *  - current-item highlight (B §8.3 / judgment #12): derived from the
 *    console's stack top — the WS row of the current ws/history page is
 *    highlighted (and its owning topic is auto-expanded so the
 *    highlight is visible); the highlight does NOT depend on the
 *    breadcrumb;
 *  - create entries (B §8.4): the tree-top `+ Topic` and the per-topic
 *    `+` (the Topic-section instances of the same shared dialogs live in
 *    ProjectPage — multiple entries are explicitly allowed).
 *
 * Data: the `project` slice supplies the Topic card list (title +
 *  workstreamCount); each EXPANDED topic lazily issues
 *  `store.loadTopic` (plan §24 — nothing fetches before expansion; the
 *  in-flight dedupe makes StrictMode + breadcrumb double-issues a no-op).
 *
 * The dialogs are the shared `topic-dialogs.tsx` components (this tree
 * owns the tree-side instances; the ProjectPage owns the Overview-side
 * instances). Mutations route with the explicit projectId (§12.1).
 */
import { useEffect, useState, useSyncExternalStore, type ReactElement } from 'react'

import type { ResearchStore } from '../../stores'
import { t } from '../../i18n/copy.js'
import type { ConsolePage } from './project-console.js'
import { CreateTopicDialog, CreateWorkstreamDialog } from '../project/topic-dialogs.js'
import styles from '../drilldown/cockpit.module.css'

export interface StructureTreeProps {
  /** The research store handle (the console's single factory result). */
  readonly store: ResearchStore
  /** The console's stack top (the highlight source — judgment #12). */
  readonly page: ConsolePage
  /** The SAME navigation functions the console's pages use (the tree
   *  is a shortcut, not a second nav system). */
  readonly onOpenProject: () => void
  readonly onOpenWorkstream: (workstreamId: string, topicId: string) => void
}

export function StructureTree({
  store,
  page,
  onOpenProject,
  onOpenWorkstream,
}: StructureTreeProps): ReactElement {
  const projectSlice = useSyncExternalStore(
    store.subscribe,
    () => store.getState().project,
  )
  const topicsMap = useSyncExternalStore(
    store.subscribe,
    () => store.getState().topics,
  )

  const [collapsed, setCollapsed] = useState(false)
  const [openTopics, setOpenTopics] = useState<ReadonlySet<string>>(new Set())
  const [createTopicOpen, setCreateTopicOpen] = useState(false)
  const [createWsTopicId, setCreateWsTopicId] = useState<string | null>(null)

  // The page depth the highlight cares about: the current topic id
  // (topic / ws / history pages all carry or own one) and the current
  // workstream id (ws / history pages).
  const currentTopicId =
    page.kind === 'topic' || page.kind === 'ws' || page.kind === 'history' ? page.topicId : null
  const currentWorkstreamId =
    page.kind === 'ws' || page.kind === 'history' ? page.workstreamId : null

  // B §8.3 / judgment #12: the current WS highlight must be VISIBLE —
  // auto-expand its owning topic (the user can still collapse it again;
  // the effect only ever opens, never closes).
  useEffect(() => {
    if (currentTopicId === null) return
    setOpenTopics((prev) => (prev.has(currentTopicId) ? prev : new Set(prev).add(currentTopicId)))
  }, [currentTopicId])

  // Lazy topic loads: one per EXPANDED topic (plan §24 — the tree
  // fetches nothing before expansion). The store's in-flight dedupe
  // makes double-issues (StrictMode, breadcrumb) a no-op.
  const swallowSliceRecordedFault = (_err: unknown): undefined => undefined
  useEffect(() => {
    if (projectSlice.data === null) return
    for (const topic of projectSlice.data.topics) {
      if (!openTopics.has(topic.id)) continue
      const slice = topicsMap.get(topic.id)
      if (slice === undefined || slice.status === 'idle') {
        void store.loadTopic(topic.id).catch(swallowSliceRecordedFault)
      }
    }
    // `openTopics` (state) + `topicsMap` (the store commit) drive the
    // re-checks; the fire-and-forget closure is stable over `store`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, projectSlice.data, openTopics, topicsMap])

  const project = projectSlice.data?.project
  const projectCurrent = page.kind === 'project'

  function toggleTopic(topicId: string): void {
    setOpenTopics((prev) => {
      const next = new Set(prev)
      if (next.has(topicId)) next.delete(topicId)
      else next.add(topicId)
      return next
    })
  }

  const createWsTopic =
    createWsTopicId !== null
      ? projectSlice.data?.topics.find((topic) => topic.id === createWsTopicId)
      : undefined

  /* -- collapsed form (B §8.2 minimal second form: marker + reopen) -- */
  if (collapsed) {
    return (
      <div className={styles.treeCollapsed} data-structure-tree-collapsed>
        <span className={styles.treeProjectMarker} data-tree-project-marker>
          {project !== undefined ? project.id : '…'}
        </span>
        <button
          type="button"
          className={styles.treeReopen}
          aria-label={t('tree.reopen')}
          onClick={() => setCollapsed(false)}
          data-tree-reopen
        >
          {'⟨'}
        </button>
      </div>
    )
  }

  return (
    <nav className={styles.tree} data-structure-tree aria-label={t('tree.rail')}>
      <div className={styles.treeHead}>
        <span className={styles.treeTitle}>{t('tree.rail')}</span>
        <span className={styles.treeHeadActions}>
          <button
            type="button"
            className={styles.treeHeadButton}
            aria-label={t('tree.addTopic')}
            title={t('tree.addTopic')}
            onClick={() => setCreateTopicOpen(true)}
            data-tree-create-topic
          >
            {t('tree.addTopic')}
          </button>
          <button
            type="button"
            className={styles.treeHeadButton}
            aria-label={t('tree.collapse')}
            title={t('tree.collapse')}
            onClick={() => setCollapsed(true)}
            data-tree-collapse
          >
            {'⟩'}
          </button>
        </span>
      </div>

      {projectSlice.data === null ? (
        projectSlice.status === 'error' ? (
          <p className={styles.treeError} role="alert" data-structure-tree-error>
            {projectSlice.error ?? '…'}
          </p>
        ) : (
          <p className={styles.treeLoading} role="status" data-structure-tree-loading>
            加载中…
          </p>
        )
      ) : (
        <ul className={styles.treeList}>
          <li className={styles.treeItem}>
            <button
              type="button"
              className={styles.treeProject}
              aria-current={projectCurrent ? 'true' : undefined}
              data-tree-current={projectCurrent ? 'true' : 'false'}
              onClick={onOpenProject}
              data-tree-project
            >
              <span aria-hidden="true">▼</span> {projectSlice.data.project.title}
            </button>
          </li>
          {projectSlice.data.topics.map((topic) => {
            const open = openTopics.has(topic.id)
            const topicSlice = topicsMap.get(topic.id)
            const topicCurrent = page.kind === 'topic' && page.topicId === topic.id
            return (
              <li key={topic.id} className={styles.treeItem} data-tree-topic-item>
                <div className={styles.treeTopicRow}>
                  <button
                    type="button"
                    className={styles.treeTopic}
                    aria-expanded={open}
                    aria-current={topicCurrent ? 'true' : undefined}
                    data-tree-current={topicCurrent ? 'true' : 'false'}
                    onClick={() => toggleTopic(topic.id)}
                    data-tree-topic
                    data-topic-id={topic.id}
                  >
                    <span aria-hidden="true">{open ? '▼' : '▶'}</span> {topic.title}
                  </button>
                  <button
                    type="button"
                    className={styles.treeAddWs}
                    aria-label={t('tree.addWorkstream')}
                    title={t('tree.addWorkstream')}
                    onClick={() => setCreateWsTopicId(topic.id)}
                    data-tree-create-workstream
                    data-topic-id={topic.id}
                  >
                    {'+'}
                  </button>
                </div>
                {open && (
                  <ul className={styles.treeWsList}>
                    {topicSlice === undefined ||
                    topicSlice.status === 'idle' ||
                    topicSlice.status === 'loading' ? (
                      <li className={styles.treeLoading} role="status" data-tree-topic-loading>
                        加载中…
                      </li>
                    ) : topicSlice.data === null ? (
                      <li className={styles.treeError} role="alert" data-tree-topic-error>
                        加载失败
                      </li>
                    ) : (
                      topicSlice.data.workstreams.map((ws) => {
                        const wsCurrent = currentWorkstreamId !== null && ws.id === currentWorkstreamId
                        return (
                          <li key={ws.id} className={styles.treeItem}>
                            <button
                              type="button"
                              className={styles.treeWs}
                              aria-current={wsCurrent ? 'true' : undefined}
                              data-tree-current={wsCurrent ? 'true' : 'false'}
                              onClick={() => onOpenWorkstream(ws.id, topic.id)}
                              data-tree-ws
                              data-ws-id={ws.id}
                            >
                              {ws.title}
                            </button>
                          </li>
                        )
                      })
                    )}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {/* The tree-side dialog instances (the shared components — the
          Overview-side instances live in ProjectPage). */}
      {createTopicOpen && project !== undefined && (
        <CreateTopicDialog
          onSave={(args) => store.createTopic({ ...args, projectId: project.id })}
          onClosed={() => setCreateTopicOpen(false)}
        />
      )}
      {createWsTopic !== undefined && project !== undefined && (
        <CreateWorkstreamDialog
          topicTitle={createWsTopic.title}
          onSave={(args) => store.createWorkstream({ ...args, topicId: createWsTopic.id, projectId: project.id })}
          onClosed={() => setCreateWsTopicId(null)}
        />
      )}
    </nav>
  )
}
