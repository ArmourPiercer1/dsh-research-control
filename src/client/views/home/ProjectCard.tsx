/**
 * Project card (WP-4.2, §27.1 「Project cards」).
 *
 * Pure props, zero store/DSH imports (the two-layer rule): the container
 * (HomeDashboard.tsx) is the only file of the home view that touches the
 * research store; this component receives the frozen `project` sub-object
 * of `DashboardSnapshot` as plain data.
 *
 * Nullable fields: `description` / `targetDate` are ordinary data nulls
 * (not PHASE placeholders) — rendered only when present, so a null never
 * shows up as an empty label.
 *
 * Entry (WP-4.7, G4 S1): when `onOpen` is provided, the WHOLE card is the
 * click target for the §27.2 Project Page (a stretched hit button covers
 * the card — valid HTML, the visible copy stays in the card's own DOM).
 * Without `onOpen` the card renders exactly as before (static).
 */
import type { ReactElement } from 'react'

import type { DashboardSnapshot } from '../../../shared/rpc-contracts.js'

import styles from './home.module.css'

/** The project sub-object of `DashboardSnapshot` (derived, not redeclared). */
export type DashboardProject = DashboardSnapshot['project']

/** Attention mode → Chinese product copy (DSH_ADAPTER §6: 产品文案中文). */
const ATTENTION_MODE_LABEL: Record<DashboardProject['attentionMode'], string> = {
  FOCUS: '聚焦',
  NORMAL: '常规',
  BACKGROUND: '后台',
}

export interface ProjectCardProps {
  readonly project: DashboardProject
  /** Entry to the §27.2 Project Page (absent = static card, no entry). */
  readonly onOpen?: () => void
}

/** Format an epoch-ms date as `YYYY-MM-DD` (local time, TZ-stable shape). */
export function formatEpochDate(ms: number): string {
  const d = new Date(ms)
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

/**
 * Render the single project card (V1: one project per host).
 * @param props - project data + optional project-page entry.
 * @returns the card element.
 */
export function ProjectCard({ project, onOpen }: ProjectCardProps): ReactElement {
  return (
    <section className={styles.projectCard}>
      <h2 className={styles.projectTitle}>{project.title}</h2>
      {project.description !== null && <p className={styles.projectDesc}>{project.description}</p>}
      <ul className={styles.metaList}>
        <li className={styles.metaItem}>编号：{project.id}</li>
        <li className={styles.metaItem}>重要度：{project.importance}</li>
        <li className={styles.metaItem}>注意力：{ATTENTION_MODE_LABEL[project.attentionMode]}</li>
        {project.targetDate !== null && (
          <li className={styles.metaItem}>目标日期：{formatEpochDate(project.targetDate)}</li>
        )}
      </ul>
      {onOpen !== undefined && (
        <button
          type="button"
          className={styles.projectCardHit}
          data-project-card
          onClick={onOpen}
          aria-label={`打开项目 ${project.id} 页面`}
        >
          <span className={styles.projectOpenLabel}>打开 →</span>
        </button>
      )}
    </section>
  )
}
