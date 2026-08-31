/**
 * Current Execution zone (WP-4.3 §27.4 middle column; UI-4 D4 extends it
 * to the full eight-group projection, ADJ-10 order).
 *
 * PURE display component: every fact arrives via props (the container
 * passes the `getWorkstream` `current` projection and the
 * `getWorkstreamCurrent` aggregate faces verbatim; no ctx, no hooks, no
 * DSH).
 *
 * Group order (ADJ-10 — Runs is LAST):
 *  1. Current Objective   — the ACTIVE objectives linked to the WS
 *     (priority-sorted by the host; the header shows the first, the zone
 *     lists all);
 *  2. Current Focus       — the current-focus pointer's plan item
 *     (the `currentFocus` slice face, resolved against the plan by the
 *     container);
 *  3. Active Tasks        — tasks whose execution is ACTIVE/PAUSED (live
 *     Run ids joined from the sibling runs list, §27.4 「live Run」);
 *  4. Pending Validation  — tasks whose validation is PENDING/UNDER_
 *     REVIEW (「待 review 的 Gate/Task validation」— the same Task
 *     identity may appear in both lists; that is a projection of one
 *     identity, not a duplicate object);
 *  5. Blockers            — `[Explicit]` rows (clearable) + `[Derived]`
 *     rows (READ-ONLY: no Clear, the primary action links the true
 *     cause; B §15.5 — a derived blocker is never persisted as explicit);
 *  6. Next Actions        — the PROPOSED NAs naming this WS:
 *     `Promote to Task` / `Dismiss` (B §15.6); the promote receipt
 *     (the host-confirmed new Task id) renders under the group;
 *  7. Interventions       — read-only cards: title / status / source /
 *     related WS / detail (B §15.7; CLOSED renders 「Closed」 — never
 *     「Solved」);
 *  8. Runs                — every Run with its last checkpoint
 *     (heartbeat) — RUNNING rows are the 「live Run」 of §27.4.
 *
 * Copy discipline (ADJ-9): every product string passes through `t()`.
 * Domain enum VALUES (execution/validation/run status, blocker/NA/IV
 * status, origin, scope, priority) render their canonical English form
 * directly (D §25) and have no copy keys.
 *
 * `data-*` hooks: the e2e/face-test selectors (data-execution /
 * data-validation / data-run-status carried over from WP-4.3;
 * data-objective-id / data-focus-id / data-blocker-id +
 * data-blocker-source / data-na-id / data-iv-id + data-iv-status /
 * data-promote-receipt added by UI-4).
 */

import type { ReactElement } from 'react'
import type {
  BlockerDto,
  CurrentTaskDto,
  DerivedBlockerDto,
  InterventionFullDto,
  NextActionDto,
  ObjectiveFullDto,
  RunDto,
} from '../../../shared/rpc-contracts.js'
import { t } from '../../i18n/copy.js'
import styles from './workstream.module.css'

/** The current-focus pointer as the zone renders it (the container
 *  resolves the plan title against `future.plan.orderedItems`). */
export interface CurrentFocusView {
  /** The focused canonical plan member id. */
  readonly planItemId: string
  /** The plan title of the focused item (null when the plan does not
   *  contain the id — the row falls back to the raw id). */
  readonly title: string | null
}

export interface CurrentZoneProps {
  /** The DTO's `current.tasks` (all tasks, folded execution/validation). */
  readonly tasks: readonly CurrentTaskDto[]
  /** The DTO's `current.runs`. */
  readonly runs: readonly RunDto[]
  /** The `getWorkstreamCurrent` ACTIVE objectives linked to the WS. */
  readonly objectives: readonly ObjectiveFullDto[]
  /** The `currentFocus` slice face (null = no pointer). */
  readonly focus: CurrentFocusView | null
  /** The `getWorkstreamCurrent` explicit blockers (all states). */
  readonly explicitBlockers: readonly BlockerDto[]
  /** The `getWorkstreamCurrent` derived blockers (read-only). */
  readonly derivedBlockers: readonly DerivedBlockerDto[]
  /** The `getWorkstreamCurrent` PROPOSED next actions. */
  readonly nextActions: readonly NextActionDto[]
  /** The `getWorkstreamCurrent` interventions (all states). */
  readonly interventions: readonly InterventionFullDto[]
  /** The last successful promote's host-confirmed Task id (B §15.6
   *  receipt: the new Task is shown explicitly); null = none yet. */
  readonly promotedTaskId: string | null
  /** Clears an explicit blocker (`store.clearBlocker`). */
  readonly onClearBlocker: (blockerId: string) => void
  /** Promotes a PROPOSED next action to a plan Task
   *  (`store.promoteNextAction`). */
  readonly onPromoteNextAction: (nextActionId: string) => void
  /** Dismisses a PROPOSED next action (`store.dismissNextAction`). */
  readonly onDismissNextAction: (nextActionId: string) => void
  /** UI-9 D4 (ADJ-11): the project read-only surface — the container
   *  (WorkstreamView) reads `useProjectReadonly` and passes the pair
   *  down: this zone is hook-free by the view-test purity contract
   *  (tests/views-workstream/harness.ts — a hook-bearing component
   *  thrown through that harness is the intended failure mode).
   *  Defaults = the writable surface. */
  readonly readonly?: boolean
  /** The composed read-only reason text (the disabled controls'
   *  tooltip); null = none. */
  readonly reasonText?: string | null
}

/** B §15.7: the CLOSED intervention renders 「Closed」 (never 「Solved」);
 *  the other states render their canonical enum form (D §25). */
const IV_STATUS_LABEL: Record<InterventionFullDto['status'], string> = {
  OPEN: 'OPEN',
  PENDING: 'PENDING',
  CLOSED: 'Closed',
}

/** Deterministic epoch rendering (ISO — locale-independent, SSR-stable). */
function formatEpoch(epochMs: number): string {
  return new Date(epochMs).toISOString()
}

/** One objective row (statement + canonical scope/priority badges). */
function ObjectiveRow({ objective }: { objective: ObjectiveFullDto }): ReactElement {
  return (
    <li className={styles.taskRow} data-objective-id={objective.id}>
      <span className={styles.taskTitle}>{objective.statement}</span>
      <span className={styles.badge} data-objective-scope={objective.scope}>
        {objective.scope}
      </span>
      <span className={styles.badge} data-objective-priority={objective.priority}>
        {objective.priority}
      </span>
    </li>
  )
}

/** The Current Focus group's single row (the focused plan item). */
function FocusRow({ focus }: { focus: CurrentFocusView }): ReactElement {
  return (
    <li className={styles.taskRow} data-focus-id={focus.planItemId}>
      <span className={styles.taskTitle}>{focus.title ?? focus.planItemId}</span>
      <span className={styles.focusMarker}>{t('ws.current.focusMarker')}</span>
    </li>
  )
}

/** One task row in the active list (execution facet). */
function ActiveTaskRow({ task }: { task: CurrentTaskDto }): ReactElement {
  return (
    <li className={styles.taskRow} data-execution={task.execution}>
      <span className={styles.taskId}>{task.id}</span>
      <span className={styles.taskTitle}>{task.title}</span>
      <span className={styles.badge} data-execution={task.execution}>
        {task.execution}
      </span>
      <span className={styles.badge} data-validation={task.validation}>
        {t('ws.current.validation')}: {task.validation}
      </span>
      {task.liveRunIds.length > 0 && (
        <span className={styles.liveRuns}>
          {t('ws.current.liveRuns')}: {task.liveRunIds.join(t('run.idSep'))}
        </span>
      )}
      {task.acceptanceCriteria.length > 0 && (
        <ul className={styles.criterionList}>
          {task.acceptanceCriteria.map(criterion => (
            <li key={criterion}>{criterion}</li>
          ))}
        </ul>
      )}
    </li>
  )
}

/** One row in the pending-review list (validation facet). */
function PendingValidationRow({ task }: { task: CurrentTaskDto }): ReactElement {
  return (
    <li className={styles.taskRow}>
      <span className={styles.taskId}>{task.id}</span>
      <span className={styles.taskTitle}>{task.title}</span>
      <span className={styles.badge} data-validation={task.validation}>
        {task.validation}
      </span>
    </li>
  )
}

/** One explicit blocker row (clearable while ACTIVE). */
function ExplicitBlockerRow({
  blocker,
  onClearBlocker,
  readonly: readOnly = false,
  reasonText = null,
}: {
  blocker: BlockerDto
  onClearBlocker: (blockerId: string) => void
  /** UI-9 D4 (ADJ-11): the read-only surface pair (props down — the
   *  zone is hook-free by the view-test purity contract). */
  readonly?: boolean
  reasonText?: string | null
}): ReactElement {
  // UI-9 D4 (ADJ-11): the read-only surface — clear disables with the
  // composed reason as tooltip (browse stays available).
  const roTitle = reasonText ?? undefined
  return (
    <li className={styles.taskRow} data-blocker-id={blocker.id} data-blocker-source="explicit">
      <span className={styles.badge}>{t('ws.current.blockerExplicit')}</span>
      <span className={styles.taskTitle}>{blocker.statement}</span>
      <span className={styles.badge} data-blocker-status={blocker.status}>
        {blocker.status}
      </span>
      <span className={styles.blockerSource}>
        {t('ws.current.blockerSource')}: {blocker.source}
      </span>
      {blocker.status === 'ACTIVE' && (
        <button
          type="button"
          className={styles.moveButton}
          aria-label={t('ws.current.clearBlockerAria', { id: blocker.id })}
          disabled={readOnly}
          title={readOnly ? roTitle : undefined}
          onClick={() => onClearBlocker(blocker.id)}
        >
          {t('ws.current.clearBlocker')}
        </button>
      )}
    </li>
  )
}

/** One derived blocker row (READ-ONLY — no Clear; the primary action
 *  links the true cause, B §15.5 / ADJ-4). */
function DerivedBlockerRow({ blocker }: { blocker: DerivedBlockerDto }): ReactElement {
  return (
    <li
      className={styles.taskRow}
      data-blocker-id={blocker.id}
      data-blocker-source={blocker.source.toLowerCase()}
    >
      <span className={styles.badge}>{t('ws.current.blockerDerived')}</span>
      <span className={styles.taskTitle}>{blocker.statement}</span>
      <span
        className={styles.derivedAction}
        data-derived-action-kind={blocker.primaryAction.targetKind}
        data-derived-action-id={blocker.primaryAction.targetId}
      >
        {blocker.primaryAction.label}
      </span>
    </li>
  )
}

/** One PROPOSED next-action row (B §15.6 entry: Promote / Dismiss). */
function NextActionRow({
  nextAction,
  onPromoteNextAction,
  onDismissNextAction,
  readonly: readOnly = false,
  reasonText = null,
}: {
  nextAction: NextActionDto
  onPromoteNextAction: (nextActionId: string) => void
  onDismissNextAction: (nextActionId: string) => void
  /** UI-9 D4 (ADJ-11): the read-only surface pair (props down — the
   *  zone is hook-free by the view-test purity contract). */
  readonly?: boolean
  reasonText?: string | null
}): ReactElement {
  // UI-9 D4 (ADJ-11): the read-only surface (promote/dismiss disable).
  const roTitle = reasonText ?? undefined
  return (
    <li className={styles.taskRow} data-na-id={nextAction.id}>
      <span className={styles.taskTitle}>{nextAction.statement}</span>
      {nextAction.rationale !== null && (
        <span className={styles.naRationale}>
          {t('ws.current.rationale')}: {nextAction.rationale}
        </span>
      )}
      <button
        type="button"
        className={styles.moveButton}
        aria-label={t('ws.current.promoteToTaskAria', { id: nextAction.id })}
        disabled={readOnly}
        title={readOnly ? roTitle : undefined}
        onClick={() => onPromoteNextAction(nextAction.id)}
      >
        {t('ws.current.promoteToTask')}
      </button>
      <button
        type="button"
        className={styles.moveButton}
        aria-label={t('ws.current.dismissAria', { id: nextAction.id })}
        disabled={readOnly}
        title={readOnly ? roTitle : undefined}
        onClick={() => onDismissNextAction(nextAction.id)}
      >
        {t('ws.current.dismiss')}
      </button>
    </li>
  )
}

/** One intervention card (B §15.7 — read-only in v1: title / status /
 *  source / related WS / detail; state transitions live in the
 *  attention view). */
function InterventionRow({ intervention }: { intervention: InterventionFullDto }): ReactElement {
  return (
    <li className={styles.taskRow} data-iv-id={intervention.id} data-iv-status={intervention.status}>
      <span className={styles.taskTitle}>{intervention.title}</span>
      <span className={styles.badge} data-iv-status={intervention.status}>
        {IV_STATUS_LABEL[intervention.status]}
      </span>
      <span className={styles.ivMeta}>
        {t('ws.current.ivSource')}: {intervention.origin}
      </span>
      <span className={styles.ivMeta}>
        {t('ws.current.ivWorkstreams')}: {intervention.workstreamIds.join(', ')}
      </span>
      {intervention.detail !== null && <span className={styles.ivDetail}>{intervention.detail}</span>}
      {intervention.status === 'CLOSED' && intervention.resolutionNote !== null && (
        <span className={styles.ivDetail}>{intervention.resolutionNote}</span>
      )}
    </li>
  )
}

/** One run row (checkpoint = last heartbeat, §27.4). */
function RunRow({ run }: { run: RunDto }): ReactElement {
  return (
    <li className={styles.taskRow} data-run-id={run.id}>
      <span className={styles.taskId}>{run.id}</span>
      <span className={styles.badge} data-run-status={run.status}>
        {run.status}
      </span>
      {run.taskId !== null && (
        <span className={styles.runTask}>
          {t('ws.current.task')}: {run.taskId}
        </span>
      )}
      {run.intent !== null && (
        <span className={styles.runIntent}>
          {t('ws.current.intent')}: {run.intent}
        </span>
      )}
      {run.lastCheckpointAt !== null ? (
        <span className={styles.runCheckpoint}>
          {t('ws.current.lastCheckpoint')}: {formatEpoch(run.lastCheckpointAt)}
          {run.lastCheckpointNote !== null ? ` (${run.lastCheckpointNote})` : ''}
        </span>
      ) : (
        <span className={styles.runCheckpoint}>
          {t('ws.current.lastCheckpoint')}: {t('ws.current.noCheckpoint')}
        </span>
      )}
    </li>
  )
}

/**
 * Render the Current Execution zone (the eight ADJ-10 groups).
 * @param props - zone data (see `CurrentZoneProps`).
 * @returns the zone panel element.
 */
export function CurrentZone({
  tasks,
  runs,
  objectives,
  focus,
  explicitBlockers,
  derivedBlockers,
  nextActions,
  interventions,
  promotedTaskId,
  onClearBlocker,
  onPromoteNextAction,
  onDismissNextAction,
  readonly: readOnly = false,
  reasonText = null,
}: CurrentZoneProps): ReactElement {
  const activeTasks = tasks.filter(task => task.execution === 'ACTIVE' || task.execution === 'PAUSED')
  const pendingValidations = tasks.filter(
    task => task.validation === 'PENDING' || task.validation === 'UNDER_REVIEW',
  )
  const noBlockers = explicitBlockers.length === 0 && derivedBlockers.length === 0
  // UI-9 D4 (B §33.2): the zone is EMPTY only when all eight ADJ-10 groups are
  // empty — then the frozen zone-head line renders and the groups are skipped.
  // Partial empties keep rendering the per-group empty lines below.
  const zoneEmpty =
    objectives.length === 0 &&
    focus === null &&
    activeTasks.length === 0 &&
    pendingValidations.length === 0 &&
    noBlockers &&
    nextActions.length === 0 &&
    interventions.length === 0 &&
    runs.length === 0

  return (
    <section className={styles.zone} aria-label={t('ws.current.title')}>
      <h2 className={styles.zoneTitle}>{t('ws.current.title')}</h2>

      {zoneEmpty ? (
        <p className={styles.empty} data-current-empty>
          {t('ws.current.empty')}
        </p>
      ) : (
        <>
      <h3 className={styles.sectionTitle}>{t('ws.current.objectives')}</h3>
      {objectives.length === 0 ? (
        <p className={styles.empty}>{t('ws.current.emptyObjectives')}</p>
      ) : (
        <ul className={styles.list}>
          {objectives.map(objective => (
            <ObjectiveRow key={objective.id} objective={objective} />
          ))}
        </ul>
      )}

      <h3 className={styles.sectionTitle}>{t('ws.current.focus')}</h3>
      {focus === null ? (
        <p className={styles.empty}>{t('ws.current.emptyFocus')}</p>
      ) : (
        <ul className={styles.list}>
          <FocusRow focus={focus} />
        </ul>
      )}

      <h3 className={styles.sectionTitle}>{t('ws.current.activeTasks')}</h3>
      {activeTasks.length === 0 ? (
        <p className={styles.empty}>{t('ws.current.emptyActiveTasks')}</p>
      ) : (
        <ul className={styles.list}>
          {activeTasks.map(task => (
            <ActiveTaskRow key={task.id} task={task} />
          ))}
        </ul>
      )}

      <h3 className={styles.sectionTitle}>{t('ws.current.pendingValidation')}</h3>
      {pendingValidations.length === 0 ? (
        <p className={styles.empty}>{t('ws.current.emptyPendingValidation')}</p>
      ) : (
        <ul className={styles.list}>
          {pendingValidations.map(task => (
            <PendingValidationRow key={task.id} task={task} />
          ))}
        </ul>
      )}

      <h3 className={styles.sectionTitle}>{t('ws.current.blockers')}</h3>
      {noBlockers ? (
        <p className={styles.empty}>{t('ws.current.emptyBlockers')}</p>
      ) : (
        <ul className={styles.list}>
          {explicitBlockers.map(blocker => (
            <ExplicitBlockerRow
              key={blocker.id}
              blocker={blocker}
              onClearBlocker={onClearBlocker}
              readonly={readOnly}
              reasonText={reasonText}
            />
          ))}
          {derivedBlockers.map(blocker => (
            <DerivedBlockerRow key={blocker.id} blocker={blocker} />
          ))}
        </ul>
      )}

      <h3 className={styles.sectionTitle}>{t('ws.current.nextActions')}</h3>
      {nextActions.length === 0 ? (
        <p className={styles.empty}>{t('ws.current.emptyNextActions')}</p>
      ) : (
        <ul className={styles.list}>
          {nextActions.map(nextAction => (
            <NextActionRow
              key={nextAction.id}
              nextAction={nextAction}
              onPromoteNextAction={onPromoteNextAction}
              onDismissNextAction={onDismissNextAction}
              readonly={readOnly}
              reasonText={reasonText}
            />
          ))}
        </ul>
      )}
      {promotedTaskId !== null && (
        <p className={styles.promoteReceipt} data-promote-receipt={promotedTaskId}>
          {t('ws.current.promotedReceipt')}: {promotedTaskId}
        </p>
      )}

      <h3 className={styles.sectionTitle}>{t('ws.current.interventions')}</h3>
      {interventions.length === 0 ? (
        <p className={styles.empty}>{t('ws.current.emptyInterventions')}</p>
      ) : (
        <ul className={styles.list}>
          {interventions.map(intervention => (
            <InterventionRow key={intervention.id} intervention={intervention} />
          ))}
        </ul>
      )}

      <h3 className={styles.sectionTitle}>{t('ws.current.runs')}</h3>
      {runs.length === 0 ? (
        <p className={styles.empty}>{t('ws.current.emptyRuns')}</p>
      ) : (
        <ul className={styles.list}>
          {runs.map(run => (
            <RunRow key={run.id} run={run} />
          ))}
        </ul>
      )}
        </>
      )}
    </section>
  )
}
