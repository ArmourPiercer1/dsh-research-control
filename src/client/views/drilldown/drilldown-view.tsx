/**
 * WP-4.6 — drill-down display (PURE props, zero store/DSH imports).
 *
 * The §26 drill-down surface (plan 「Claim/Artifact → Run → DSH Session」,
 * TC-E2E-012/013, Gate P4: ≤3 interactions from the dashboard):
 *  - Claim / Artifact cards (rebuilt display layer — see drilldown-model)
 *    with their status + the producing-run pointer;
 *  - ONE selected card ⇒ the linked Run panel (the owning Run(s) via
 *    `created_by_run` / `PRODUCED_BY`) with the run row's session pointer;
 *  - the DSH Session is host-owned (本插件无宿主会话 UI 权限): it renders
 *    as the external-jump affordance 「在宿主会话列表中打开」 and hands
 *    `sessionId` to `onOpenSession` — the CONTAINER (cockpit.tsx) owns the
 *    DSH session-open channel or its placeholder (task brief item: 「用回调
 *    props 交容器」).
 *
 * Interaction budget (2-3 击): 卡 (1) → Run 行 (2) → 会话跳转 (3).
 */

import type { ReactElement } from 'react'

import type { DrilldownClaim, DrilldownArtifact, DrilldownModel, DrilldownRun } from './drilldown-model.js'
import { linkedRunsFor } from './drilldown-model.js'
import styles from './cockpit.module.css'

export type DrilldownSelection =
  | { readonly kind: 'claim'; readonly id: string }
  | { readonly kind: 'artifact'; readonly id: string }
  | null

export interface DrilldownViewProps {
  /** The display model (the container builds it from queryHistory + runs). */
  readonly model: DrilldownModel
  /** The selected card (null = nothing selected — the run panel is empty). */
  readonly selection: DrilldownSelection
  /** Card click (interaction 1 of the chain) — the container's local state. */
  readonly onSelect: (selection: DrilldownSelection) => void
  /** The container's session-open channel (placeholder semantics allowed). */
  readonly onOpenSession: (sessionId: string, runId: string) => void
  /** The current user-visible clock formatter (epoch ms → display text). */
  readonly formatTime: (epochMs: number) => string
}

/** The run-link kind → product copy (data path the user can verify). */
const LINK_KIND_LABEL: Record<DrilldownRun['linkKinds'][number], string> = {
  CREATED_BY_RUN: 'created_by_run 事件指针',
  PRODUCED_BY_RELATION: 'PRODUCED_BY 关系',
}

/** One Claim card (card click = interaction 1 of the chain). */
function ClaimCard({
  claim,
  selected,
  onSelect,
}: {
  claim: DrilldownClaim
  selected: boolean
  onSelect: () => void
}): ReactElement {
  return (
    <button
      type="button"
      className={selected ? styles.cardSelected : styles.card}
      data-claim-id={claim.id}
      data-claim-status={claim.status}
      onClick={onSelect}
    >
      <span className={styles.cardHead}>
        <span className={styles.cardId}>{claim.id}</span>
        <span className={styles.statusBadge} data-claim-status={claim.status}>
          {claim.status === 'ACTIVE' ? '有效' : '已撤回'}
        </span>
      </span>
      <p className={styles.cardStatement}>{claim.statement}</p>
      <p className={styles.cardMeta}>
        来源 Run：{claim.createdByRun ?? '用户登记'}
        {claim.relationIds.length > 0 && <span> · 关系 {claim.relationIds.length} 条</span>}
      </p>
    </button>
  )
}

/** One Artifact card. */
function ArtifactCard({
  artifact,
  selected,
  onSelect,
}: {
  artifact: DrilldownArtifact
  selected: boolean
  onSelect: () => void
}): ReactElement {
  return (
    <button
      type="button"
      className={selected ? styles.cardSelected : styles.card}
      data-artifact-id={artifact.id}
      data-artifact-status={artifact.status}
      onClick={onSelect}
    >
      <span className={styles.cardHead}>
        <span className={styles.cardId}>{artifact.id}</span>
        <span className={styles.typeBadge}>{artifact.type}</span>
        <span className={styles.statusBadge} data-artifact-status={artifact.status}>
          {artifact.status === 'REGISTERED' ? '已注册' : '缺失'}
        </span>
      </span>
      <p className={styles.cardStatement}>{artifact.title}</p>
      <p className={styles.cardMeta}>
        {artifact.uri}
        {artifact.relatedTask !== null && <span> · 任务 {artifact.relatedTask}</span>}
        {artifact.producedByRunIds.length > 0 && (
          <span> · PRODUCED_BY {artifact.producedByRunIds.join('、')}</span>
        )}
      </p>
    </button>
  )
}

/** One linked Run row (interaction 2 = the session jump below it). */
function RunRow({
  run,
  formatTime,
  onOpenSession,
}: {
  run: DrilldownRun
  formatTime: (epochMs: number) => string
  onOpenSession: (sessionId: string, runId: string) => void
}): ReactElement {
  return (
    <li className={styles.runRow} data-run-id={run.id} data-run-status={run.status}>
      <span className={styles.runHead}>
        <span className={styles.cardId}>{run.id}</span>
        <span className={styles.statusBadge} data-run-status={run.status}>
          {run.status}
        </span>
        <span className={styles.linkKinds}>{run.linkKinds.map((k) => LINK_KIND_LABEL[k]).join(' / ')}</span>
      </span>
      <p className={styles.runMeta}>
        {run.taskId !== null && <span>任务 {run.taskId} · </span>}
        {run.intent !== null && <span>意图「{run.intent}」 · </span>}
        开始 {run.startedAt > 0 ? formatTime(run.startedAt) : '—'}
        {run.endedAt !== null && <span> · 结束 {formatTime(run.endedAt)}</span>}
        {run.evidenceEventIds.length > 0 && (
          <span> · 事件指针 {run.evidenceEventIds.length} 条</span>
        )}
      </p>
      {run.dshSessionId !== null ? (
        <button
          type="button"
          className={styles.sessionLink}
          data-session-id={run.dshSessionId}
          data-run-id={run.id}
          title="在宿主会话列表中打开（外部跳转 — 本插件无宿主会话 UI 权限）"
          onClick={() => onOpenSession(run.dshSessionId!, run.id)}
        >
          会话 {run.dshSessionId} — 在宿主会话列表中打开 ↗
        </button>
      ) : (
        <p className={styles.sessionAbsent}>无 DSH 会话指针（非 DSH 会话发起）</p>
      )}
    </li>
  )
}

/**
 * Render the drill-down surface for one workstream.
 * @param props - model, selection, session-open callback, time formatter.
 * @returns the view element (cards grid + linked-run panel).
 */
export function DrilldownView({ model, selection, onSelect, onOpenSession, formatTime }: DrilldownViewProps): ReactElement {
  const selectedClaim: DrilldownClaim | null =
    selection !== null && selection.kind === 'claim'
      ? model.claims.find((c) => c.id === selection.id) ?? null
      : null
  const selectedArtifact: DrilldownArtifact | null =
    selection !== null && selection.kind === 'artifact'
      ? model.artifacts.find((a) => a.id === selection.id) ?? null
      : null

  const linkedRuns: DrilldownRun[] = linkedRunsFor(
    selectedClaim !== null ? selectedClaim : selectedArtifact,
    model,
  )

  return (
    <section className={styles.drilldown} aria-label="Claim/Artifact drill-down">
      <h2 className={styles.sectionTitle}>Claim / Artifact drill-down</h2>

      <div className={styles.cardGrid}>
        <div>
          <h3 className={styles.groupTitle}>Claims（{model.claims.length}）</h3>
          {model.claims.length === 0 ? (
            <p className={styles.empty}>本 Run 窗口无 Claim 事件（CLAIM_RECORDED）</p>
          ) : (
            model.claims.map((claim) => (
              <ClaimCard
                key={claim.id}
                claim={claim}
                selected={selection !== null && selection.kind === 'claim' && selection.id === claim.id}
                onSelect={() => onSelect({ kind: 'claim', id: claim.id })}
              />
            ))
          )}
        </div>
        <div>
          <h3 className={styles.groupTitle}>Artifacts（{model.artifacts.length}）</h3>
          {model.artifacts.length === 0 ? (
            <p className={styles.empty}>本 Run 窗口无 Artifact 事件（ARTIFACT_REGISTERED）</p>
          ) : (
            model.artifacts.map((artifact) => (
              <ArtifactCard
                key={artifact.id}
                artifact={artifact}
                selected={
                  selection !== null && selection.kind === 'artifact' && selection.id === artifact.id
                }
                onSelect={() => onSelect({ kind: 'artifact', id: artifact.id })}
              />
            ))
          )}
        </div>
      </div>

      <h3 className={styles.groupTitle}>
        所属 Run{selection === null ? '（选择上方卡片查看）' : ''}
      </h3>
      {selection === null ? (
        <p className={styles.empty}>未选择对象 — 点击 Claim/Artifact 卡片（第 1 击）</p>
      ) : linkedRuns.length === 0 ? (
        <p className={styles.empty}>
          该对象无 Run 指针（created_by_run 为空且无 PRODUCED_BY 关系 — 用户手工登记）
        </p>
      ) : (
        <ul className={styles.runList}>
          {linkedRuns.map((run) => (
            <RunRow key={run.id} run={run} formatTime={formatTime} onOpenSession={onOpenSession} />
          ))}
        </ul>
      )}
    </section>
  )
}
