/**
 * WP-4.6 — Intervention queue board (container).
 *
 * TC-E2E-011: `OPEN / PENDING / CLOSED` — ONLY the user changes an
 * Intervention's state (DOMAIN_SCHEMA §9.2 / INV-PM-…「Intervention 状态
 * 只允许用户显式修改」; the Agent tool surface has NO state-mutation tool
 * — `RESEARCH_TOOL_NAMES` is the frozen 11, unit-pinned in tests/tools).
 * This board is the user-side GUI: per-item controls call the
 * `updateInterventionState` mutation (the store refetches the dashboard
 * slice per the WP-4.1b invalidate registry — the OPEN/PENDING groups are
 * re-read from the host, never locally patched).
 *
 * Transition face (frozen §13 machine): OPEN → PENDING | CLOSED;
 * PENDING → OPEN | CLOSED; CLOSED is terminal (no controls rendered).
 * `resolutionNote` is required by the user on CLOSE (「关闭时用户填写」).
 *
 * Data: the dashboard slice (the SAME OPEN/PENDING groups the Home
 * dashboard renders — INV-ATTN-1 keeps them complete; this board adds the
 * state controls without hiding anything).
 */

import { useState, type ReactElement } from 'react'

import type { DashboardSnapshot, InterventionDto } from '../../../shared/rpc-contracts.js'
import type { ResearchStore, SliceState } from '../../stores/index.js'
import { useDashboardSlice } from './binding-hooks.js'
import styles from './cockpit.module.css'

/** Origin → product copy (shared wording with the home section). */
const ORIGIN_LABEL: Record<InterventionDto['origin'], string> = {
  USER: '用户',
  AGENT_REPORT: 'Agent 报告',
  AUTO_FLOODING: '自动洪泛检测',
  AUTO_AUDIT: '自动审计',
}

/** One intervention row with its user-only state controls. */
function InterventionRow({
  item,
  busy,
  onTransition,
  onNote,
  note,
  onOpenWorkstream,
}: {
  item: InterventionDto
  busy: boolean
  onTransition: (status: 'OPEN' | 'PENDING' | 'CLOSED') => void
  onNote: (note: string) => void
  note: string
  onOpenWorkstream: (workstreamId: string) => void
}): ReactElement {
  return (
    <li className={styles.ivRow} data-iv-id={item.id} data-iv-status={item.status}>
      <p className={styles.ivTitle}>{item.title}</p>
      <p className={styles.ivMeta}>
        {item.id} · 来源：{ORIGIN_LABEL[item.origin]} · 状态：{item.status}
      </p>
      <p className={styles.ivWsChips}>
        {item.workstreamIds.map((wsId) => (
          <button
            key={wsId}
            type="button"
            className={styles.wsChip}
            data-iv-ws={wsId}
            onClick={() => onOpenWorkstream(wsId)}
            title="打开所属 Workstream"
          >
            {wsId}
          </button>
        ))}
      </p>
      {item.status !== 'CLOSED' && (
        <p className={styles.ivControls}>
          <input
            className={styles.ivNote}
            data-iv-note={item.id}
            value={note}
            placeholder="关闭备注（CLOSED 时必填）"
            onChange={(e) => onNote(e.target.value)}
          />
          {item.status === 'OPEN' && (
            <button
              type="button"
              className={styles.ivButton}
              data-iv-action="pending"
              data-iv-id={item.id}
              disabled={busy}
              onClick={() => onTransition('PENDING')}
            >
              待处理
            </button>
          )}
          {item.status === 'PENDING' && (
            <button
              type="button"
              className={styles.ivButton}
              data-iv-action="reopen"
              data-iv-id={item.id}
              disabled={busy}
              onClick={() => onTransition('OPEN')}
            >
              重新打开
            </button>
          )}
          <button
            type="button"
            className={styles.ivButtonClose}
            data-iv-action="close"
            data-iv-id={item.id}
            disabled={busy}
            onClick={() => onTransition('CLOSED')}
          >
            关闭
          </button>
        </p>
      )}
    </li>
  )
}

export interface InterventionBoardProps {
  readonly store: ResearchStore
  /** Drill into an intervention's workstream (Gate P4 path, TC-E2E-013:
   *  this chip is interaction 1 of the ≤3-click session chain). */
  readonly onOpenWorkstream?: (workstreamId: string) => void
}

/**
 * Render the Intervention queue with the user-only state controls.
 * @param props - the store handle (the board pulls the dashboard slice).
 * @returns the board element.
 */
export function InterventionBoard({ store, onOpenWorkstream }: InterventionBoardProps): ReactElement {
  const slice: SliceState<DashboardSnapshot> = useDashboardSlice(store)
  const [notes, setNotes] = useState<ReadonlyMap<string, string>>(new Map())
  const [busy, setBusy] = useState(false)
  const [fault, setFault] = useState<string | null>(null)

  function handleTransition(item: InterventionDto, status: 'OPEN' | 'PENDING' | 'CLOSED'): void {
    if (busy) return
    if (status === 'CLOSED' && (notes.get(item.id) ?? '').trim() === '') {
      setFault(`${item.id}：关闭需要填写备注（「关闭时用户填写」）`)
      return
    }
    setFault(null)
    setBusy(true)
    void store
      .updateInterventionState({
        interventionId: item.id,
        status,
        ...(status === 'CLOSED' ? { resolutionNote: notes.get(item.id)!.trim() } : {}),
      })
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

  const items = [
    ...(slice.data?.openInterventions ?? []),
    ...(slice.data?.pendingInterventions ?? []),
  ]

  return (
    <section className={styles.ivBoard} aria-label="Intervention 队列（用户状态操作）">
      <h2 className={styles.sectionTitle}>Intervention 队列（仅用户可改状态）</h2>
      {fault !== null && (
        <p className={styles.faultNote} role="alert">
          {fault}
        </p>
      )}
      {items.length === 0 ? (
        <p className={styles.empty}>
          {slice.data === null ? '加载中…' : '当前无 OPEN / PENDING Intervention'}
        </p>
      ) : (
        <ul className={styles.ivList}>
          {items.map((item) => (
            <InterventionRow
              key={item.id}
              item={item}
              busy={busy}
              note={notes.get(item.id) ?? ''}
              onNote={(value) => setNotes((prev) => new Map(prev).set(item.id, value))}
              onTransition={(status) => handleTransition(item, status)}
              onOpenWorkstream={(wsId) => {
                onOpenWorkstream?.(wsId)
              }}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
