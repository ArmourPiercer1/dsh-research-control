/**
 * ConfirmDialog (WP-4.5) — the pure-props confirmation surface for the
 * PlanFork user entries (RR-015③: button → mutation face + confirmation
 * dialog). Display component: no store, no ctx, no data hooks — the
 * container owns the pending-action state and the async mutation call.
 *
 * SELECT carries an explicit IRREVERSIBILITY statement (PLAN_FORK_SPEC §6:
 * SELECT materializes NEW items, REWRITES the canonical `plan.yaml`, and
 * chain-stales every other OPEN proposal of the workstream — §6.5;
 * nothing in the flow un-selects). DISMISS is a status-only change (§7:
 * append-only record, no deletion) and confirms more lightly. The copy is
 * product text (Chinese); the component itself is shape-agnostic.
 */

import type { ReactElement } from 'react'
import { CONFIRM_DIALOG_STYLES as styles, ensureGraphStyles } from './graph-styles.js'

export interface ConfirmDialogProps {
  /** Dialog heading (user-visible). */
  readonly title: string
  /** The body text (user-visible; may carry the irreversibility warning). */
  readonly message: string
  /** Confirm button label (e.g. 「选择此方案」). */
  readonly confirmLabel: string
  /** Cancel button label (defaults to 「取消」). */
  readonly cancelLabel?: string
  /** Marks a destructive/irreversible action (accent styling + data attr). */
  readonly danger?: boolean
  readonly onConfirm: () => void
  readonly onCancel: () => void
}

/**
 * Render the confirmation dialog (an `aria-modal` overlay).
 * @param props - dialog props.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel = '取消',
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps): ReactElement {
  // Idempotent stylesheet injection (the dialog may render standalone —
  // e.g. in a seat that hosts only the confirm surface).
  ensureGraphStyles()
  return (
    <div className={styles.overlay} role="presentation" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={danger ? `${styles.dialog} ${styles.dialogDanger}` : styles.dialog}
        data-danger={danger ? 'true' : 'false'}
        onClick={event => event.stopPropagation()}
      >
        <h3 className={styles.title}>{title}</h3>
        <p className={styles.message}>{message}</p>
        <div className={styles.actions}>
          <button type="button" className={styles.cancelBtn} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={danger ? `${styles.confirmBtn} ${styles.confirmBtnDanger}` : styles.confirmBtn}
            data-danger={danger ? 'true' : 'false'}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
