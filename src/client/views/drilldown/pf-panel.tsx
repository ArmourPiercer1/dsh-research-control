/**
 * WP-4.6 — PlanFork management panel (container).
 *
 * The cockpit-owned seat for the user-side PF operations + their RESULT
 * visibility:
 *  - the unresolved PF list (OPEN/STALE) with status badges, the
 *    creation reason AND the `staleReason` (TC-E2E-008 「旧 PF 显示 STALE
 *    及原因」 — the query-path stale pre-check (WP-4.6 host half) is what
 *    marks them STALE on the next `getWorkstream`);
 *  - SELECT / DISMISS user entries (TC-E2E-007): SELECT materializes the
 *    proposal into the canonical plan, chain-stales the other OPEN PFs
 *    (§6.5) and returns the §6.7 `checkpointHint` — this panel RENDERS
 *    the hint (「checkpoint 提示出现」) as an explicit, optional,
 *    NEVER-automatic note (INV-GIT-2);
 *  - the store's invalidate registry refetches the workstream slice after
 *    each mutation — the panel re-derives from the fresh snapshot (the
 *    selected PF leaves the list, the others flip to STALE with the
 *    `superseded by PF-<id> selection` reason).
 *
 * The graph overlay itself (the distinct PF visual style) is the WP-4.5
 * `PlanGraphContainer` mounted beside this panel on the workstream page.
 */

import { useState, type ReactElement } from 'react'

import type { PlanForkDto, SelectPlanForkResult } from '../../../shared/rpc-contracts.js'
import type { ResearchStore, SliceState, WorkstreamSnapshot } from '../../stores/index.js'
import { useWsSlice } from './binding-hooks.js'
import { t } from '../../i18n/copy.js'
import styles from './cockpit.module.css'

const PF_STATUS_LABEL: Record<PlanForkDto['status'], string> = {
  OPEN: t('status.pending'),
  STALE: t('status.stale'),
}

/** One PF row with its user actions. */
function PfRow({
  pf,
  busy,
  onSelect,
  onDismiss,
}: {
  pf: PlanForkDto
  busy: boolean
  onSelect: () => void
  onDismiss: () => void
}): ReactElement {
  return (
    <li className={styles.pfRow} data-pf={pf.id} data-pf-status={pf.status}>
      <span className={styles.pfHead}>
        <span className={styles.cardId}>{pf.id}</span>
        <span className={styles.statusBadge} data-pf-status={pf.status}>
          {PF_STATUS_LABEL[pf.status]}
        </span>
        <span className={styles.pfMeta}>
          {t('pf.summary', { count: String(pf.proposedItemCount), fork: pf.forkAnchor, merge: pf.mergeAnchor, origin: pf.createdByRun })}
        </span>
      </span>
      <p className={styles.pfReason}>{pf.reason}</p>
      {pf.staleReason !== null && (
        <p className={styles.staleReason} data-pf-stale-reason={pf.id}>
          {t('pf.staleReason', { reason: pf.staleReason })}
        </p>
      )}
      {/*
       * ADJ-3 (UI-9 D2, PlanFork 主入口): 隐操作、留展示 — the select/dismiss
       * operation controls are HIDDEN (`hidden` attribute: invisible,
       * unfocusable, unclickable in real browsers) while the code and DOM
       * nodes remain (hide-not-delete). The read-only pending/stale
       * visibility above is kept, and the PlanGraph overlay stays a
       * read-only visualization. Re-arming = removing the two attributes.
       */}
      <p className={styles.pfControls}>
        {pf.status === 'OPEN' && (
          <button
            type="button"
            hidden
            className={styles.pfButtonSelect}
            data-pf-action="select"
            data-pf-id={pf.id}
            disabled={busy}
            onClick={onSelect}
          >
            {t('pf.select')}
          </button>
        )}
        <button
          type="button"
          hidden
          className={styles.pfButtonDismiss}
          data-pf-action="dismiss"
          data-pf-id={pf.id}
          disabled={busy}
          onClick={onDismiss}
        >
          {t('pf.ignore')}
        </button>
      </p>
    </li>
  )
}

export interface PfPanelProps {
  readonly store: ResearchStore
  readonly workstreamId: string
}

/**
 * Render the PlanFork management panel for one workstream.
 * @param props - the store handle + the page workstream.
 * @returns the panel element.
 */
export function PfPanel({ store, workstreamId }: PfPanelProps): ReactElement {
  const slice: SliceState<WorkstreamSnapshot> = useWsSlice(store, workstreamId)
  const [busy, setBusy] = useState(false)
  const [fault, setFault] = useState<string | null>(null)
  const [checkpointHint, setCheckpointHint] = useState<string | null>(null)

  function handleSelect(pfId: string): void {
    if (busy) return
    setFault(null)
    setBusy(true)
    void store
      .selectPlanFork({ planForkId: pfId })
      .then((result: SelectPlanForkResult) => {
        setCheckpointHint(result.checkpointHint)
        setBusy(false)
      })
      .catch((err: unknown) => {
        setBusy(false)
        setFault(err instanceof Error ? err.message : String(err))
      })
  }

  function handleDismiss(pfId: string): void {
    if (busy) return
    setFault(null)
    setBusy(true)
    void store
      .dismissPlanFork({ planForkId: pfId })
      .then(
        () => {
          setBusy(false)
        },
        (err: unknown) => {
          setBusy(false)
          setFault(err instanceof Error ? err.message : String(err))
        },
      )
  }

  const forks = slice.data?.future.planForks ?? []

  return (
    <section className={styles.pfPanel} aria-label={t('pf.manageTitle')}>
      <h2 className={styles.sectionTitle}>{t('pf.manageCount', { n: String(slice.data?.future.unresolvedPlanForkCount ?? 0) })}</h2>
      {checkpointHint !== null && (
        <p className={styles.checkpointHint} role="status" data-role="checkpoint-hint">
          {checkpointHint}
        </p>
      )}
      {fault !== null && (
        <p className={styles.faultNote} role="alert">
          {fault}
        </p>
      )}
      {forks.length === 0 ? (
        <p className={styles.empty}>{slice.data === null ? t('common.loading') : t('pf.noOpen')}</p>
      ) : (
        <ul className={styles.pfList}>
          {forks.map((pf) => (
            <PfRow
              key={pf.id}
              pf={pf}
              busy={busy}
              onSelect={() => handleSelect(pf.id)}
              onDismiss={() => handleDismiss(pf.id)}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
