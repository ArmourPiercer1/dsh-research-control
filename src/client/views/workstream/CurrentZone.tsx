/**
 * Current Execution zone (WP-4.3, §27.4 middle-left column).
 *
 * PURE display component: every fact arrives via props (the container
 * passes the `getWorkstream` `current` projection verbatim — the store
 * snapshot is the only data source; no ctx, no hooks, no DSH).
 *
 * Zone rule (ARCHITECTURE §3.1 / INV-TZ-2 — the host DTO carries the
 * FOLDED state of every task, the Current zone projects it):
 *  - active list: tasks whose execution is ACTIVE/PAUSED (live Run ids
 *    joined from the sibling runs list, §27.4 「live Run」);
 *  - pending-review list: tasks whose validation is PENDING/UNDER_REVIEW
 *    (「待 review 的 Gate/Task validation」— the same Task identity may
 *    appear in both lists; that is a projection of one identity, not a
 *    duplicate object);
 *  - runs: every Run with its last checkpoint (heartbeat) — RUNNING rows
 *    are the 「live Run」 of §27.4.
 */

import type { ReactElement } from 'react'
import type { CurrentTaskDto, RunDto } from '../../../shared/rpc-contracts.js'
import styles from './workstream.module.css'

export interface CurrentZoneProps {
  /** The DTO's `current.tasks` (all tasks, folded execution/validation). */
  readonly tasks: readonly CurrentTaskDto[]
  /** The DTO's `current.runs`. */
  readonly runs: readonly RunDto[]
}

/** 产品文案（中文）— execution states of a task. */
const EXECUTION_LABEL: Record<CurrentTaskDto['execution'], string> = {
  PLANNED: '规划中',
  ACTIVE: '进行中',
  PAUSED: '已暂停',
  EXECUTED: '已完成',
  CANCELLED: '已取消',
}

/** 产品文案（中文）— task validation states. */
const VALIDATION_LABEL: Record<CurrentTaskDto['validation'], string> = {
  NOT_REQUIRED: '无需验证',
  PENDING: '待验证',
  UNDER_REVIEW: '审查中',
  PASSED: '已通过',
  FAILED: '未通过',
}

/** 产品文案（中文）— run states. */
const RUN_STATUS_LABEL: Record<RunDto['status'], string> = {
  RUNNING: '运行中',
  FINISHED: '已结束',
  FAILED: '失败',
  CANCELLED: '已取消',
}

/** Deterministic epoch rendering (ISO — locale-independent, SSR-stable). */
function formatEpoch(epochMs: number): string {
  return new Date(epochMs).toISOString()
}

/** One task row in the active list. */
function ActiveTaskRow({ task }: { task: CurrentTaskDto }): ReactElement {
  return (
    <li className={styles.taskRow}>
      <span className={styles.taskId}>{task.id}</span>
      <span className={styles.taskTitle}>{task.title}</span>
      <span className={styles.badge} data-execution={task.execution}>
        {EXECUTION_LABEL[task.execution]}
      </span>
      <span className={styles.badge} data-validation={task.validation}>
        校验：{VALIDATION_LABEL[task.validation]}
      </span>
      {task.liveRunIds.length > 0 && (
        <span className={styles.liveRuns}>实时 Run：{task.liveRunIds.join('、')}</span>
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
        {VALIDATION_LABEL[task.validation]}
      </span>
    </li>
  )
}

/** One run row (checkpoint = last heartbeat, §27.4). */
function RunRow({ run }: { run: RunDto }): ReactElement {
  return (
    <li className={styles.taskRow}>
      <span className={styles.taskId}>{run.id}</span>
      <span className={styles.badge} data-run-status={run.status}>
        {RUN_STATUS_LABEL[run.status]}
      </span>
      {run.taskId !== null && <span className={styles.runTask}>任务：{run.taskId}</span>}
      {run.intent !== null && <span className={styles.runIntent}>意图：{run.intent}</span>}
      {run.lastCheckpointAt !== null && (
        <span className={styles.runCheckpoint}>
          最近检查点：{formatEpoch(run.lastCheckpointAt)}
          {run.lastCheckpointNote !== null ? `（${run.lastCheckpointNote}）` : ''}
        </span>
      )}
      {run.lastCheckpointAt === null && <span className={styles.runCheckpoint}>最近检查点：暂无</span>}
    </li>
  )
}

/**
 * Render the Current Execution zone.
 * @param props - zone data (see `CurrentZoneProps`).
 * @returns the zone panel element.
 */
export function CurrentZone({ tasks, runs }: CurrentZoneProps): ReactElement {
  const activeTasks = tasks.filter(task => task.execution === 'ACTIVE' || task.execution === 'PAUSED')
  const pendingValidations = tasks.filter(
    task => task.validation === 'PENDING' || task.validation === 'UNDER_REVIEW',
  )
  return (
    <section className={styles.zone} aria-label="当前执行">
      <h2 className={styles.zoneTitle}>当前执行</h2>

      <h3 className={styles.sectionTitle}>活动任务</h3>
      {activeTasks.length === 0 ? (
        <p className={styles.empty}>无活动任务</p>
      ) : (
        <ul className={styles.list}>
          {activeTasks.map(task => (
            <ActiveTaskRow key={task.id} task={task} />
          ))}
        </ul>
      )}

      <h3 className={styles.sectionTitle}>待 review 校验</h3>
      {pendingValidations.length === 0 ? (
        <p className={styles.empty}>无待 review 校验</p>
      ) : (
        <ul className={styles.list}>
          {pendingValidations.map(task => (
            <PendingValidationRow key={task.id} task={task} />
          ))}
        </ul>
      )}

      <h3 className={styles.sectionTitle}>Run</h3>
      {runs.length === 0 ? (
        <p className={styles.empty}>暂无 Run</p>
      ) : (
        <ul className={styles.list}>
          {runs.map(run => (
            <RunRow key={run.id} run={run} />
          ))}
        </ul>
      )}
    </section>
  )
}
