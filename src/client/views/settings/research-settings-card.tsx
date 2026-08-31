/**
 * V2-T6.1 — the DSH 设置 plugin card, the PURE-PROPS view half (design
 * §7.5 / Q4).
 *
 * INV-PERM-5 clean: this file (and the whole `views/settings/` directory)
 * is DSH-free — no @deepseek-ai imports, no channels, no scope. The
 * adapter half (`dsh-adapter/settings-card.tsx`) hands the card the
 * inject face below — plain data + callbacks (client/AGENTS.md rule 7) —
 * and the slot runtime spreads the face members onto the component as
 * props (the keyed slot `settings.plugin.item`'s owner share is empty,
 * so the face IS the props).
 *
 * ## What the card does (frozen §7.5)
 *
 * Two editable directory names — 项目数据目录名 (default `.research`)
 * and 管理中心目录名 (default `.research-control`) — with the shared
 * pure validator (`src/shared/research-settings.ts`, the host's frozen
 * rule: single path segment, leading dot allowed, no "/", no "."/"..")
 * rendered as inline Chinese errors. Saving runs the adapter's
 * two-phase transaction (write settings → rescan → verify discovery →
 * roll back on loss) and the card renders its outcome:
 *
 *  - `saved` — a brief 已保存 line (auto-clears);
 *  - `missing` — the warning **请先在磁盘上重命名文件夹，再保存** with
 *    the loss report, and BOTH fields reverted to their pre-save values
 *    (the adapter rolled the writes back before resolving; the card
 *    additionally resets its drafts so the UI ends on the old values
 *    even before the recovery read folds back);
 *  - `rescan-error` / `write-error` — the adapter's fault line; the old
 *    values stay visible; no 已保存.
 *
 * Invalid input is blocked BEFORE any write: the save button is
 * disabled and the click is a no-op (the adapter is never called).
 *
 * State: `useSyncExternalStore` on the face's stable-reference
 * snapshot (the only store binding in this file — the card is small
 * enough that a separate binding module is ceremony, not discipline).
 * Draft reseed follows the standard dirty-ref pattern: user edits and
 * resets mark the draft dirty; the next scope snapshot re-seeds it
 * unless dirty.
 */

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type ReactElement,
} from 'react'
import {
  MAX_DIR_NAME_LENGTH,
  classifyDirNameViolation,
  type ResearchSettingsSaveOutcome,
  type ResearchSettingsSection,
} from '../../../shared/research-settings.js'
import { t } from '../../i18n/copy.js'
import styles from './research-settings-card.module.css'

/* ------------------------------------------------------------------ *
 * The inject face (the slot runtime spreads its members onto the
 * component as props)
 * ------------------------------------------------------------------ */

/**
 * The card's display snapshot — the scope snapshot narrowed to what the
 * card renders. `values` is `undefined` until the section is accepted
 * (the adapter normalizes per-field types with the composition defaults
 * as belt-and-braces over the schema).
 */
export interface ResearchSettingsCardSnapshot {
  /** `loading` until the first accepted section; `ready` while one stands; `unavailable` when the namespace is not served to this client. */
  readonly status: 'loading' | 'ready' | 'unavailable'
  /** The current committed directory names (`undefined` before the first acceptance). */
  readonly values: ResearchSettingsSection | undefined
  /** Whether the settings document accepts writes (memory mode never does). */
  readonly writable: boolean
}

/**
 * The face the adapter injects (client/AGENTS.md rule 7 — plain data and
 * callbacks only). The view never sees a settings scope, a
 * `RemoteResult`, or a channel shape: `save` runs the WHOLE §7.5
 * two-phase transaction in the adapter world and resolves the outcome
 * this file renders.
 */
export interface ResearchSettingsCardFace {
  /** The current snapshot (stable reference until the next change — `useSyncExternalStore` getter). */
  readonly getSnapshot: () => ResearchSettingsCardSnapshot
  /** Subscribe to snapshot changes; returns the disposer. */
  readonly subscribe: (listener: () => void) => () => void
  /** The composition defaults (the reset-to-default affordance). */
  readonly defaults: ResearchSettingsSection
  /** Run the §7.5 two-phase save; resolves the rendered outcome (never rejects for a business fault). */
  readonly save: (next: ResearchSettingsSection) => Promise<ResearchSettingsSaveOutcome>
}

/** The slot runtime spreads the face onto the component — the face IS the props. */
export type ResearchSettingsCardProps = ResearchSettingsCardFace

/* ------------------------------------------------------------------ *
 * i18n over the shared validator (the host warns English; the card
 * renders the Chinese inline error)
 * ------------------------------------------------------------------ */

/** Map one candidate to its Chinese inline error (`null` when valid). */
function dirNameErrorText(value: string): string | null {
  const code = classifyDirNameViolation(value)
  if (code === null) return null
  switch (code) {
    case 'empty':
      return t('settingsCard.dirEmpty')
    case 'too-long':
      return t('settingsCard.dirTooLong', { max: String(MAX_DIR_NAME_LENGTH) })
    case 'slash':
      return t('settingsCard.dirSlash')
    case 'dot':
      return t('settingsCard.dirDot')
  }
}

/* ------------------------------------------------------------------ *
 * The card
 * ------------------------------------------------------------------ */

/** The save-outcome the card renders (adapter outcomes, narrowed). */
type CardNotice =
  | { readonly kind: 'saved' }
  | {
      readonly kind: 'missing'
      readonly hubLost: boolean
      readonly hubPath: string | null
      readonly lostTreePaths: string[]
    }
  | { readonly kind: 'fault'; readonly message: string }

/** 已保存 auto-clear delay (the brief success line, §7.5). */
const SAVED_CLEAR_MS = 2500

export function ResearchSettingsCard(props: ResearchSettingsCardProps): ReactElement {
  const snapshot = useSyncExternalStore(props.subscribe, props.getSnapshot, props.getSnapshot)

  const [drafts, setDrafts] = useState<ResearchSettingsSection>({
    projectTreeDir: props.defaults.projectTreeDir,
    hubDir: props.defaults.hubDir,
  })
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<CardNotice | null>(null)

  /** True while the user's draft differs from the last committed section (resets on reseed/save completion). */
  const dirtyRef = useRef(false)
  /** The last committed section (the rollback display target). */
  const committedRef = useRef<ResearchSettingsSection | null>(null)
  /** True while the two-phase transaction runs (freezes reseeding). */
  const savingRef = useRef(false)

  // Draft reseed: a scope snapshot change re-seeds the draft unless the
  // user is mid-edit and the transaction is not running.
  useEffect(() => {
    if (savingRef.current) return
    if (snapshot.status === 'ready' && snapshot.values !== undefined) {
      committedRef.current = snapshot.values
      if (!dirtyRef.current) {
        setDrafts({
          projectTreeDir: snapshot.values.projectTreeDir,
          hubDir: snapshot.values.hubDir,
        })
      }
    }
  }, [snapshot])

  // The brief 已保存 line clears on its own.
  useEffect(() => {
    if (notice?.kind !== 'saved') return
    const timer = setTimeout(() => setNotice(null), SAVED_CLEAR_MS)
    return () => clearTimeout(timer)
  }, [notice])

  const editable =
    snapshot.status === 'ready' && snapshot.writable && !saving

  // Inline validation (rendered per field; blocks save when non-null).
  const treeError = snapshot.status === 'ready' ? dirNameErrorText(drafts.projectTreeDir) : null
  const hubError = snapshot.status === 'ready' ? dirNameErrorText(drafts.hubDir) : null
  const invalid = treeError !== null || hubError !== null
  const saveDisabled = !editable || invalid

  function setDraftField(field: keyof ResearchSettingsSection, event: ChangeEvent<HTMLInputElement>): void {
    dirtyRef.current = true
    setDrafts((prev) => ({ ...prev, [field]: event.target.value }))
  }

  /** The reset-to-default affordance (per field). */
  function resetField(field: keyof ResearchSettingsSection): void {
    dirtyRef.current = true
    setDrafts((prev) => ({ ...prev, [field]: props.defaults[field] }))
  }

  /**
   * The save click — invalid input is blocked BEFORE any write (the
   * adapter is never called); otherwise the §7.5 two-phase transaction
   * runs in the adapter world and the outcome is rendered.
   */
  async function handleSave(): Promise<void> {
    if (savingRef.current || saveDisabled) return
    const next: ResearchSettingsSection = {
      projectTreeDir: drafts.projectTreeDir,
      hubDir: drafts.hubDir,
    }
    if (dirNameErrorText(next.projectTreeDir) !== null || dirNameErrorText(next.hubDir) !== null) return
    if (snapshot.status !== 'ready' || snapshot.values === undefined) return
    const preSave: ResearchSettingsSection = committedRef.current ?? snapshot.values

    savingRef.current = true
    setSaving(true)
    setNotice(null)
    try {
      const outcome: ResearchSettingsSaveOutcome = await props.save(next)
      if (outcome.status === 'saved') {
        committedRef.current = next
        dirtyRef.current = false
        setDrafts(next)
        setNotice({ kind: 'saved' })
      } else if (outcome.status === 'missing') {
        // The adapter rolled both writes back before resolving; the card
        // additionally resets its drafts so the UI ENDS on the old values
        // (even before the recovery read folds back).
        committedRef.current = preSave
        dirtyRef.current = false
        setDrafts({ ...preSave })
        setNotice({
          kind: 'missing',
          hubLost: outcome.hubLost,
          hubPath: outcome.hubPath,
          lostTreePaths: outcome.lostTreePaths,
        })
      } else {
        // rescan-error | write-error: the fault line; the old values stay
        // visible; no 已保存 (the no-silent-success rule).
        committedRef.current = preSave
        dirtyRef.current = false
        setDrafts({ ...preSave })
        setNotice({ kind: 'fault', message: outcome.message })
      }
    } catch (err) {
      // Contract violation guard (the face promises outcomes, not
      // rejections): keep the old values, surface the fault.
      committedRef.current = preSave
      dirtyRef.current = false
      setDrafts({ ...preSave })
      setNotice({
        kind: 'fault',
        message: err instanceof Error ? err.message : String(err),
      })
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  return (
    <section className={styles.card} data-testid="settings-card" aria-label={t('settingsCard.title')}>
      <h3 className={styles.title} data-testid="settings-card-title">
        {t('settingsCard.title')}
      </h3>

      {snapshot.status === 'loading' && (
        <p className={styles.notice} data-testid="settings-card-loading">
          {t('settingsCard.loading')}
        </p>
      )}

      {snapshot.status === 'unavailable' && (
        <p className={styles.notice} data-testid="settings-card-unavailable">
          {t('settingsCard.unavailable')}
        </p>
      )}

      {snapshot.status === 'ready' && (
        <div className={styles.body}>
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="rc-settings-tree-dir">
              {t('settingsCard.treeDirLabel')}
            </label>
            <div className={styles.fieldRow}>
              <input
                id="rc-settings-tree-dir"
                className={styles.input}
                type="text"
                value={drafts.projectTreeDir}
                onChange={(e) => setDraftField('projectTreeDir', e)}
                disabled={!editable}
                aria-invalid={treeError !== null}
                aria-describedby={treeError !== null ? 'rc-settings-tree-dir-error' : undefined}
                data-testid="settings-card-tree-dir"
              />
              <button
                type="button"
                className={styles.resetButton}
                onClick={() => resetField('projectTreeDir')}
                disabled={!editable}
                data-testid="settings-card-tree-dir-reset"
              >
                {t('settingsCard.reset')}
              </button>
            </div>
            <p className={styles.hint}>{t('settingsCard.treeDirHint')}</p>
            {treeError !== null && (
              <p
                className={styles.fieldError}
                id="rc-settings-tree-dir-error"
                aria-live="polite"
                data-testid="settings-card-tree-dir-error"
              >
                {treeError}
              </p>
            )}
          </div>

          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="rc-settings-hub-dir">
              {t('settingsCard.hubDirLabel')}
            </label>
            <div className={styles.fieldRow}>
              <input
                id="rc-settings-hub-dir"
                className={styles.input}
                type="text"
                value={drafts.hubDir}
                onChange={(e) => setDraftField('hubDir', e)}
                disabled={!editable}
                aria-invalid={hubError !== null}
                aria-describedby={hubError !== null ? 'rc-settings-hub-dir-error' : undefined}
                data-testid="settings-card-hub-dir"
              />
              <button
                type="button"
                className={styles.resetButton}
                onClick={() => resetField('hubDir')}
                disabled={!editable}
                data-testid="settings-card-hub-dir-reset"
              >
                {t('settingsCard.reset')}
              </button>
            </div>
            <p className={styles.hint}>{t('settingsCard.hubDirHint')}</p>
            {hubError !== null && (
              <p
                className={styles.fieldError}
                id="rc-settings-hub-dir-error"
                aria-live="polite"
                data-testid="settings-card-hub-dir-error"
              >
                {hubError}
              </p>
            )}
          </div>

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.saveButton}
              onClick={() => void handleSave()}
              disabled={saveDisabled}
              aria-busy={saving}
              data-testid="settings-card-save"
            >
              {saving ? t('common.saving') : t('common.save')}
            </button>
          </div>

          {notice !== null && notice.kind === 'saved' && (
            <p className={styles.savedLine} role="status" data-testid="settings-card-saved">
              {t('settingsCard.saved')}
            </p>
          )}

          {notice !== null && notice.kind === 'missing' && (
            <div className={styles.missingBanner} role="alert" data-testid="settings-card-warning">
              <p className={styles.missingHeadline}>{t('settingsCard.missingHeadline')}</p>
              {notice.hubLost && (
                <p className={styles.missingLine}>
                  {t('settingsCard.hubLost', { path: notice.hubPath ?? t('settingsCard.unknownPath') })}
                </p>
              )}
              {notice.lostTreePaths.map((path) => (
                <p className={styles.missingLine} key={path}>
                  {t('settingsCard.treeLost', { path })}
                </p>
              ))}
              <p className={styles.missingNote}>{t('settingsCard.missingNote')}</p>
            </div>
          )}

          {notice !== null && notice.kind === 'fault' && (
            <p className={styles.faultLine} role="alert" data-testid="settings-card-fault">
              {notice.message}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
