/**
 * OPEN / PENDING intervention group (WP-4.2, §27.1 「OPEN Interventions」
 * 「PENDING Interventions」).
 *
 * INV-ATTN-1 (ARCHITECTURE invariant table): OPEN/PENDING Interventions are
 * ALWAYS shown in complete form — every item of the frozen group is
 * rendered, never truncated, collapsed, or hidden. The Attention Manager
 * may only REORDER the presentation; it never hides (the `attention`
 * field is still a Phase 5 placeholder anyway — see PhasePlaceholder).
 *
 * Pure props, zero store/DSH imports. Workstream links: each intervention
 * carries its related workstream ids (DOMAIN_SCHEMA §9.2); the chips are
 * the drill-down entries into the workstream view and the per-workstream
 * History timeline (the intervention's History events are owned by its
 * first related workstream — the 「历史」 button opens that window).
 */
import type { ReactElement } from 'react'

import type { InterventionDto } from '../../../shared/rpc-contracts.js'

import { formatEpochDate } from './ProjectCard'
import styles from './home.module.css'

/** The two always-complete dashboard groups (CLOSED is not a dashboard group). */
export type InterventionGroupKind = 'OPEN' | 'PENDING'

const GROUP_TITLE: Record<InterventionGroupKind, string> = {
  OPEN: 'OPEN 干预',
  PENDING: 'PENDING 干预',
}

/** Intervention origin → Chinese product copy (DOMAIN_SCHEMA §9.2). */
const ORIGIN_LABEL: Record<InterventionDto['origin'], string> = {
  USER: '用户',
  AGENT_REPORT: 'Agent 报告',
  AUTO_FLOODING: '自动洪泛检测',
  AUTO_AUDIT: '自动审计',
}

export interface InterventionSectionProps {
  readonly kind: InterventionGroupKind
  /** The frozen group; rendered COMPLETELY (INV-ATTN-1). */
  readonly items: readonly InterventionDto[]
  /** Drill-down: open the workstream view for one workstream id. */
  readonly onOpenWorkstream: (workstreamId: string) => void
  /** Drill-down: open the History timeline of the intervention's first workstream. */
  readonly onOpenHistory: (workstreamId: string) => void
}

/**
 * Render one intervention group: every item in full (INV-ATTN-1), each
 * with origin/created meta and its workstream drill-down chips.
 * @param props - group kind, items, navigation callbacks.
 * @returns the section element.
 */
export function InterventionSection({
  kind,
  items,
  onOpenWorkstream,
  onOpenHistory,
}: InterventionSectionProps): ReactElement {
  return (
    <section className={styles.interventions}>
      <h3 className={styles.sectionTitle}>{GROUP_TITLE[kind]}</h3>
      {items.length === 0 ? (
        <p className={styles.empty}>暂无</p>
      ) : (
        <ul className={styles.interventionList}>
          {items.map(item => (
            <li key={item.id} className={styles.intervention}>
              <p className={styles.interventionTitle}>{item.title}</p>
              <p className={styles.interventionMeta}>
                {item.id} · 来源：{ORIGIN_LABEL[item.origin]} · {formatEpochDate(item.createdAt)}
              </p>
              <p className={styles.chips}>
                {item.workstreamIds.map(workstreamId => (
                  <button
                    key={workstreamId}
                    type="button"
                    className={styles.chip}
                    onClick={() => onOpenWorkstream(workstreamId)}
                  >
                    {workstreamId}
                  </button>
                ))}
                {item.workstreamIds.length > 0 && (
                  <button
                    type="button"
                    className={styles.chip}
                    onClick={() => onOpenHistory(item.workstreamIds[0])}
                  >
                    历史
                  </button>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
