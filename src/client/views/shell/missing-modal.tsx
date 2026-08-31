/**
 * V2-T4.3 — MISSING four-action modal (design §4 MISSING 处置 四选一弹窗 /
 * §12 rows 5, 6, 8, 9).
 *
 * The shell renders this modal on the FIRST ready render whose plane state
 * carries at least one LIVE missing entry — the pinned client-visible rule
 * (host contract, src/host/dsh-adapter/host/plane-mutation-services.ts +
 * plane-read-services.ts):
 *  - the wire entry is `PlaneMissingDto { projectId, displayName, wsPath,
 *    deferred }` (strict); the entry's `deferred` is the 「推后处理」
 *    runtime flag of THIS backend run (in-memory, never persisted — design
 *    §14: a process restart restores the reminder);
 *  - `ackMissingReminder` is a pure runtime-memory write on the host: the
 *    id lands in the live `PlaneState.deferredReminders` and the read port
 *    projects `deferred: deferredReminders.has(id)` immediately — the entry
 *    does NOT drop from `missing`, its `deferred` flag flips to `true`
 *    WITHOUT a rescan; the flag SURVIVES a rescan (the mutation service
 *    re-seeds every fresh plane state) and the backend run;
 *  - therefore the modal lists ONLY `deferred === false` entries: after a
 *    successful 推后 + re-fetch the entry is filtered out and the second
 *    render in the same runtime does NOT re-pop (the dedup gate). Entries
 *    that are still live after a re-fetch (the user acted on a different
 *    entry) stay listed — 挂起，等待用户处置, per entry.
 *
 * The four actions per entry (design §4 table; wire args pinned to the
 * strict §12 schemas):
 *  - 恢复      → `rescan({})` — re-probe: the tree may have come back;
 *  - 重初始化  → `bindProject({ wsPath, scaffold: true })` — scaffold a
 *    fresh tree at the registered path. NOTE: the wire `BindProjectArgs`
 *    carries NO projectId field — design §4's 「沿用同一 projectId」 is
 *    host-side identity semantics (the entry at the path keeps its id);
 *    the client sends exactly what the wire allows (path + scaffold);
 *  - 移除登记  → `unbindProject({ wsPath })` — 归档口径: the registry entry
 *    goes `archived` (NEVER deleted); the wire takes the registered path,
 *    not the project id;
 *  - 推后      → `ackMissingReminder({ projectId })` — the runtime dedup
 *    flag set (no reminder again this backend run).
 *
 * Every action: fire the RPC; on SUCCESS the modal closes and the shell
 * re-fetches the plane state (the underlying branch re-renders over the
 * fresh state); on ERROR the message shows in the modal (role=alert) and
 * the modal STAYS open (the entry is still 挂起). While one action is in
 * flight every button is disabled (the host serializes plane mutations on
 * one FIFO mutex anyway — a second concurrent action would only race the
 * first for that queue).
 *
 * Layering (INV-PERM-5): pure props/React — no @deepseek-ai import. The
 * four RPC faces arrive as PLAIN promises (resolve the strict wire result,
 * reject on any failure — the view never sees a `RemoteResult`).
 */

import { useState, type ReactElement } from 'react'

import type {
  AckMissingReminderArgs,
  AckMissingReminderResult,
  BindProjectArgs,
  BindProjectResult,
  PlaneMissingDto,
  RescanArgs,
  RescanResult,
  UnbindProjectArgs,
  UnbindProjectResult,
} from '../../../shared/rpc-contracts.js'
import styles from './shell.module.css'
import { t } from '../../i18n/copy.js'

/** Props of the MISSING 四选一 modal (see the module header). */
export interface MissingModalProps {
  /** The LIVE missing entries (`deferred === false` — the shell filters). */
  readonly entries: readonly PlaneMissingDto[]
  /** 恢复 — re-run discovery & reconciliation (the tree may have come back). */
  readonly rescan: (args: RescanArgs) => Promise<RescanResult>
  /** 重初始化 — scaffold a fresh tree at the registered path (same face as the T4.2 接入 flow). */
  readonly bindProject: (args: BindProjectArgs) => Promise<BindProjectResult>
  /** 移除登记 — archive the registry entry (归档口径, never deleted). */
  readonly unbindProject: (args: UnbindProjectArgs) => Promise<UnbindProjectResult>
  /** 推后 — the runtime dedup flag set (no reminder again this backend run). */
  readonly ackMissingReminder: (args: AckMissingReminderArgs) => Promise<AckMissingReminderResult>
  /**
   * The success tail: the shell closes the modal AND re-fetches the plane
   * state (one callback — the two effects are atomic for the view).
   */
  readonly onResolved: () => void
}

/** The four 处置 kinds (the button → RPC map of the module header). */
type ActionKind = 'rescan' | 'rebind' | 'unbind' | 'ack'

/** The user-visible error text of a rejected face (string or Error). */
function errorText(err: unknown): string {
  if (typeof err === 'string') return err
  if (err instanceof Error) return err.message
  return String(err)
}

export function MissingModal(props: MissingModalProps): ReactElement {
  // One in-flight action at a time (module header: the host mutex + the
  // user's choice are sequentialized in the UI as well).
  const [busy, setBusy] = useState(false)
  // The last failed action's message (the modal stays open on error).
  const [error, setError] = useState<string | null>(null)

  async function handleAction(kind: ActionKind, entry: PlaneMissingDto): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      switch (kind) {
        case 'rescan':
          // The §12 row 8 request is the strict empty object.
          await props.rescan({})
          break
        case 'rebind':
          // 重初始化 at the registered path (module header: the wire has no
          // projectId — the path + `scaffold: true` are the full contract).
          await props.bindProject({ wsPath: entry.wsPath, scaffold: true })
          break
        case 'unbind':
          // 移除登记 (归档口径): the wire takes the workspace path.
          await props.unbindProject({ wsPath: entry.wsPath })
          break
        case 'ack':
          // 推后: the runtime dedup flag (the entry stays in `missing`
          // with `deferred: true` — the next fetch filters it out).
          await props.ackMissingReminder({ projectId: entry.projectId })
          break
      }
      // Success: the shell closes the modal and re-fetches the plane state.
      props.onResolved()
      return
    } catch (err) {
      // The entry is still 挂起 — show the fault and keep the modal open.
      setError(errorText(err))
    } finally {
      // No-op when onResolved unmounted the modal mid-flight (React 18).
      setBusy(false)
    }
  }

  return (
    // .missingModal carries the local --rc-* token block (module header —
    // the overlay is a SIBLING of the branch's .shell div, so the tokens
    // do not inherit; shell.module.css scopes both roots the same way).
    <div className={`${styles.dialogOverlay} ${styles.missingModal}`}>
      <div className={styles.dialogPanel} role="dialog" aria-modal="true" aria-label={t('missing.title')} data-missing-modal="open">
        <h2 className={styles.dialogTitle}>{t('missing.heading')}</h2>
        <p className={styles.dialogCopy}>{t('missing.body')}</p>
        {props.entries.map((entry) => (
          <div key={entry.projectId} className={styles.missingEntry}>
            <p className={styles.missingName}>{entry.displayName}</p>
            <p className={styles.missingMeta}>
              <code>{entry.projectId}</code>{t('missing.pathLabel')} <code>{entry.wsPath}</code>
            </p>
            <div className={styles.missingActions}>
              <button
                type="button"
                className={styles.missingAction}
                disabled={busy}
                onClick={() => {
                  void handleAction('rescan', entry)
                }}
              >
                {t('missing.restore')}
              </button>
              <button
                type="button"
                className={styles.missingAction}
                disabled={busy}
                onClick={() => {
                  void handleAction('rebind', entry)
                }}
              >
                {t('missing.reinit')}
              </button>
              <button
                type="button"
                className={styles.missingAction}
                disabled={busy}
                onClick={() => {
                  void handleAction('unbind', entry)
                }}
              >
                {t('missing.remove')}
              </button>
              <button
                type="button"
                className={styles.missingAction}
                disabled={busy}
                onClick={() => {
                  void handleAction('ack', entry)
                }}
              >
                {t('missing.defer')}
              </button>
            </div>
          </div>
        ))}
        {error !== null && (
          <p className={styles.missingError} role="alert">
            {t('missing.failed', { error })}
          </p>
        )}
      </div>
    </div>
  )
}
