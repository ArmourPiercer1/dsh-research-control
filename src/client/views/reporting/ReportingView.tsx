/**
 * Reporting section — the 沟通与日程 (DOMAIN_SCHEMA §10) top-level
 * CONTAINER (WP-5.3).
 *
 * Composes the three §10 objects as three sections:
 *   - Interaction 记录流 (InteractionStreamView — 生产 registerInteraction
 *     RPC 挂点, USER 语义);
 *   - ReportingItem 周报/清单 (ReportingListView — 本地草稿 + §13 迁移);
 *   - ScheduledEvent 日程时间轴 (ScheduledEventTimeline — V1 时间窗过滤,
 *     不接外部 Calendar)。
 *
 * Store discipline (WP-4.1b / DSH_ADAPTER §6): ONE
 * `createReportingWorkspace()` factory result per mount (useMemo — never
 * module-level); the main `ResearchStore` handle arrives BY PROPS (the
 * slot wiring passes it through the slot `store` option, same as every
 * other Phase 4/5 view container). Components never see ctx.
 *
 * 挂载说明: 本视图目录自包含（容器/展示分层 + CSS Modules + 中文文案）;
 * cockpit 座位接线归后续 WP（cockpit 文件不在本 WP 授权面）— 导出面
 * 即 `ReportingView`（props: { store }）。
 */

import { useMemo, type ReactElement } from 'react'
import type { ResearchStore } from '../../stores/index.js'
import { createReportingWorkspace } from '../../stores/reporting-slices.js'
import { InteractionStreamView } from './InteractionStreamView.js'
import { ReportingListView } from './ReportingListView.js'
import { ScheduledEventTimeline } from './ScheduledEventTimeline.js'
import styles from './reporting.module.css'

export interface ReportingViewProps {
  /** The main research store (the registerInteraction mutation face). */
  readonly store: ResearchStore
  /** Injectable clock（默认 Date.now）。 */
  readonly now?: () => number
}

/** The 沟通与日程 section (§10: Interaction / ReportingItem /
 *  ScheduledEvent). */
export function ReportingView(props: ReportingViewProps): ReactElement {
  const { store } = props
  const now = props.now ?? Date.now
  // One factory result per mount — the handle never lives at module
  // level (DSH_ADAPTER §6; WP-4.1b engine discipline).
  const workspace = useMemo(() => createReportingWorkspace({ now }), [now])

  return (
    <div className={styles.root} data-reporting-section="root">
      <header className={styles.rootHeader}>
        <h2 className={styles.rootTitle}>沟通与日程</h2>
        <span className={styles.scopeNote}>
          Interaction / ReportingItem / ScheduledEvent（DOMAIN_SCHEMA §10）
        </span>
      </header>
      <InteractionStreamView workspace={workspace} store={store} now={now} />
      <ReportingListView workspace={workspace} now={now} />
      <ScheduledEventTimeline workspace={workspace} now={now} />
    </div>
  )
}
