/**
 * Phase placeholder (WP-4.2, §27.1 Home/Portfolio Dashboard).
 *
 * `DashboardSnapshot` carries four PHASE 5/6 placeholder fields
 * (`scheduledEvents` / `reportingItems` / `inboxCount` / `attention` —
 * frozen `null` until WP-5.3/WP-5.4/WP-6.x land the real data). The
 * dashboard section for such a field is SHOWN, never hidden: an explicit
 * 「待 <phase>」 marker reserves the place so the user sees the missing
 * capability instead of a silent absence (the DTO comment forbids a
 * fabricated empty list masquerading as data — and a hidden section
 * masquerading as a non-requirement is the same sin at the UI level).
 */
import type { ReactElement } from 'react'

import styles from './home.module.css'

export interface PhasePlaceholderProps {
  /** Section title (Chinese product copy, e.g. 「计划事件」). */
  readonly title: string
  /** The phase the data lands in (e.g. 'Phase 5'); rendered as 「待 Phase 5」. */
  readonly phase: string
}

/**
 * Render one reserved dashboard section with its placeholder text.
 * @param props - section title + landing phase.
 * @returns the placeholder section element.
 */
export function PhasePlaceholder({ title, phase }: PhasePlaceholderProps): ReactElement {
  return (
    <section className={styles.phase}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      <p className={styles.phaseText}>待 {phase}</p>
    </section>
  )
}
