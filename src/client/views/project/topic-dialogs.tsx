/**
 * V2-UI-0.4 UI-3 — the Topic/Workstream create + edit dialogs (B §8.4 /
 * §9.1).
 *
 * Controlled presentational components (the UI-2 ProjectMetadataDialog
 * shape): the OWNER (the ProjectPage container for the Project-Overview
 * Topic-section instances; the ProjectConsole for the structure-tree
 * instances) holds the open-state and hands down a store-mutation
 * closure (`onSave`) plus the close callback. The component renders a
 * FRESH field state on every mount (the owner remounts on open — no
 * stale prefill across opens).
 *
 * NOTE-4: a failed mutation rejects with the gateway-folded message; the
 * machine-matchable carrier (`[research-control] <CODE>: <detail>`) is
 * decoded HERE through the single client decode point
 * (`extractResearchErrorCarrier`) — the view never branches on
 * `error.code`.
 *
 * Wire semantics: create args are strict (title required 1–200; optional
 * description / summary omitted when empty — the frozen schemas keep the
 * field ABSENT from the written YAML, never empty). Edit is an RMW merge:
 * only the CHANGED fields are sent (the host keeps the rest); importance
 * has no null arm, so clearing it is a no-op the dialog discards (same
 * disclosed limitation as the project metadata dialog's targetDate).
 */
import { useId, useState, type ReactElement } from 'react'
import { t } from '../../i18n/copy.js'
import { extractResearchErrorCarrier } from '../../util/error-carrier.js'
import type {
  CreateTopicArgs,
  CreateWorkstreamArgs,
  UpdateTopicArgs,
} from '../../../shared/rpc-contracts.js'
import dialogStyles from '../shell/shell.module.css'

/** The create-topic args the dialog fills (the OWNER applies the routing
 *  `projectId` — §12.1). */
export type CreateTopicDialogArgs = Omit<CreateTopicArgs, 'projectId'>
/** The create-workstream args the dialog fills (the owner applies
 *  `topicId` + the routing `projectId`). */
export type CreateWorkstreamDialogArgs = Omit<CreateWorkstreamArgs, 'topicId' | 'projectId'>
/** The edit-topic args the dialog fills (the owner applies `topicId` +
 *  the routing `projectId`; only the changed fields are present — the
 *  host RMW merge keeps the rest). */
export type TopicEditDialogArgs = Omit<UpdateTopicArgs, 'topicId' | 'projectId'>

/** The shared error-line rendering (carrier-decoded detail). */
function FaultLine({ error }: { readonly error: string | null }): ReactElement | null {
  return error === null ? null : (
    <p className={dialogStyles.missingError} role="alert">
      {error}
    </p>
  )
}

/* -------------------------------------------------------------------- *
 * CreateTopic
 * -------------------------------------------------------------------- */

export interface CreateTopicDialogProps {
  /** The store mutation (`store.createTopic` with routing pre-applied).
   *  Resolves on OK, rejects on any failure. */
  readonly onSave: (args: CreateTopicDialogArgs) => Promise<unknown>
  readonly onClosed: () => void
}

export function CreateTopicDialog(props: CreateTopicDialogProps): ReactElement {
  const { onSave, onClosed } = props
  const id = useId()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = title.trim() !== ''

  const confirm = async (): Promise<void> => {
    if (busy || !canSubmit) return
    setBusy(true)
    setError(null)
    try {
      await onSave({
        title: title.trim(),
        ...(description.trim() !== '' ? { description: description.trim() } : {}),
      })
      onClosed()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const carrier = extractResearchErrorCarrier(message)
      setError(carrier !== null ? carrier.detail : message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={dialogStyles.dialogOverlay}
      role="dialog"
      aria-modal="true"
      aria-label={t('dialog.createTopic')}
      data-create-topic-dialog
    >
      <div className={dialogStyles.dialogPanel}>
        <h3 className={dialogStyles.dialogTitle}>{t('dialog.createTopic')}</h3>
        <label className={dialogStyles.dialogField} htmlFor={`${id}-title`}>
          {t('dialog.fieldTitle')}
        </label>
        <input
          id={`${id}-title`}
          className={dialogStyles.dialogInput}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          data-create-topic-title
        />
        <label className={dialogStyles.dialogField} htmlFor={`${id}-description`}>
          {t('dialog.fieldDescription')}
        </label>
        <textarea
          id={`${id}-description`}
          className={dialogStyles.dialogInput}
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          data-create-topic-description
        />
        <FaultLine error={error} />
        <div className={dialogStyles.dialogActions}>
          <button
            type="button"
            className={dialogStyles.dialogCancel}
            onClick={onClosed}
            disabled={busy}
            data-create-topic-cancel
          >
            {t('dialog.cancel')}
          </button>
          <button
            type="button"
            className={dialogStyles.dialogConfirm}
            onClick={() => void confirm()}
            disabled={busy || !canSubmit}
            data-create-topic-confirm
          >
            {busy ? '…' : t('dialog.createTopic')}
          </button>
        </div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------- *
 * CreateWorkstream
 * -------------------------------------------------------------------- */

export interface CreateWorkstreamDialogProps {
  /** The store mutation (`store.createWorkstream` with the topic +
   *  routing pre-applied). Resolves on OK, rejects on any failure. */
  readonly onSave: (args: CreateWorkstreamDialogArgs) => Promise<unknown>
  readonly onClosed: () => void
  /** The owning topic's title (context line; omitted → not rendered). */
  readonly topicTitle?: string
}

export function CreateWorkstreamDialog(props: CreateWorkstreamDialogProps): ReactElement {
  const { onSave, onClosed, topicTitle } = props
  const id = useId()
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = title.trim() !== ''

  const confirm = async (): Promise<void> => {
    if (busy || !canSubmit) return
    setBusy(true)
    setError(null)
    try {
      await onSave({
        title: title.trim(),
        ...(summary.trim() !== '' ? { summary: summary.trim() } : {}),
      })
      onClosed()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const carrier = extractResearchErrorCarrier(message)
      setError(carrier !== null ? carrier.detail : message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={dialogStyles.dialogOverlay}
      role="dialog"
      aria-modal="true"
      aria-label={t('dialog.createWorkstream')}
      data-create-workstream-dialog
    >
      <div className={dialogStyles.dialogPanel}>
        <h3 className={dialogStyles.dialogTitle}>{t('dialog.createWorkstream')}</h3>
        {topicTitle !== undefined && (
          <p className={dialogStyles.dialogCopy} data-create-workstream-topic>
            {topicTitle}
          </p>
        )}
        <label className={dialogStyles.dialogField} htmlFor={`${id}-title`}>
          {t('dialog.fieldTitle')}
        </label>
        <input
          id={`${id}-title`}
          className={dialogStyles.dialogInput}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          data-create-workstream-title
        />
        <label className={dialogStyles.dialogField} htmlFor={`${id}-summary`}>
          {t('dialog.fieldSummary')}
        </label>
        <textarea
          id={`${id}-summary`}
          className={dialogStyles.dialogInput}
          rows={3}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          data-create-workstream-summary
        />
        <FaultLine error={error} />
        <div className={dialogStyles.dialogActions}>
          <button
            type="button"
            className={dialogStyles.dialogCancel}
            onClick={onClosed}
            disabled={busy}
            data-create-workstream-cancel
          >
            {t('dialog.cancel')}
          </button>
          <button
            type="button"
            className={dialogStyles.dialogConfirm}
            onClick={() => void confirm()}
            disabled={busy || !canSubmit}
            data-create-workstream-confirm
          >
            {busy ? '…' : t('dialog.createWorkstream')}
          </button>
        </div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------- *
 * TopicEdit
 * -------------------------------------------------------------------- */

/** The dialog's prefill projection (the TopicSnapshot.topic slice it
 *  needs — nulls mean the field is absent on the wire). */
export interface TopicEditInitial {
  readonly title: string
  readonly description: string | null
  readonly importance: number | null
  readonly attentionMode: 'FOCUS' | 'NORMAL' | 'BACKGROUND' | null
}

export interface TopicEditDialogProps {
  readonly initial: TopicEditInitial
  /** The store mutation (`store.updateTopic` with the topic + routing
   *  pre-applied). Resolves on OK, rejects on any failure. */
  readonly onSave: (args: TopicEditDialogArgs) => Promise<unknown>
  readonly onClosed: () => void
}

export function TopicEditDialog(props: TopicEditDialogProps): ReactElement {
  const { initial, onSave, onClosed } = props
  const id = useId()
  const [title, setTitle] = useState(initial.title)
  const [description, setDescription] = useState(initial.description ?? '')
  const [importance, setImportance] = useState(initial.importance === null ? '' : String(initial.importance))
  const [attentionMode, setAttentionMode] = useState<'FOCUS' | 'NORMAL' | 'BACKGROUND'>(
    initial.attentionMode ?? 'NORMAL',
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // A field is "changed" when it differs from the prefill; the changed
  // fields are the ONLY ones sent (the host RMW merge keeps the rest).
  const titleChanged = title.trim() !== '' && title.trim() !== initial.title
  const descriptionChanged = description !== (initial.description ?? '')
  const importanceChanged = importance !== (initial.importance === null ? '' : String(initial.importance))
  // attentionMode null-prefills as NORMAL in the control; "changed" only
  // against a NON-null prefill (a null → NORMAL selection is a no-op the
  // dialog discards — same RMW limitation as importance clearing).
  const attentionChanged =
    initial.attentionMode !== null && attentionMode !== initial.attentionMode

  const confirm = async (): Promise<void> => {
    if (busy) return
    const args: TopicEditDialogArgs = {
      ...(titleChanged ? { title: title.trim() } : {}),
      ...(descriptionChanged ? { description } : {}),
      ...(importanceChanged && importance !== '' ? { importance: Number(importance) } : {}),
      ...(attentionChanged ? { attentionMode } : {}),
    }
    setBusy(true)
    setError(null)
    try {
      await onSave(args)
      onClosed()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const carrier = extractResearchErrorCarrier(message)
      setError(carrier !== null ? carrier.detail : message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={dialogStyles.dialogOverlay}
      role="dialog"
      aria-modal="true"
      aria-label={t('dialog.editTopic')}
      data-edit-topic-dialog
    >
      <div className={dialogStyles.dialogPanel}>
        <h3 className={dialogStyles.dialogTitle}>{t('dialog.editTopic')}</h3>
        <label className={dialogStyles.dialogField} htmlFor={`${id}-title`}>
          {t('dialog.fieldTitle')}
        </label>
        <input
          id={`${id}-title`}
          className={dialogStyles.dialogInput}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          data-edit-topic-title
        />
        <label className={dialogStyles.dialogField} htmlFor={`${id}-description`}>
          {t('dialog.fieldDescription')}
        </label>
        <textarea
          id={`${id}-description`}
          className={dialogStyles.dialogInput}
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          data-edit-topic-description
        />
        <label className={dialogStyles.dialogField} htmlFor={`${id}-importance`}>
          {t('dialog.fieldImportance')}
        </label>
        <input
          id={`${id}-importance`}
          className={dialogStyles.dialogInput}
          type="number"
          min={0}
          value={importance}
          onChange={(e) => setImportance(e.target.value)}
          data-edit-topic-importance
        />
        <label className={dialogStyles.dialogField} htmlFor={`${id}-attention`}>
          {t('dialog.fieldAttention')}
        </label>
        <select
          id={`${id}-attention`}
          className={dialogStyles.dialogInput}
          value={attentionMode}
          onChange={(e) => setAttentionMode(e.target.value as 'FOCUS' | 'NORMAL' | 'BACKGROUND')}
          data-edit-topic-attention
        >
          <option value="FOCUS">FOCUS</option>
          <option value="NORMAL">NORMAL</option>
          <option value="BACKGROUND">BACKGROUND</option>
        </select>
        <FaultLine error={error} />
        <div className={dialogStyles.dialogActions}>
          <button
            type="button"
            className={dialogStyles.dialogCancel}
            onClick={onClosed}
            disabled={busy}
            data-edit-topic-cancel
          >
            {t('dialog.cancel')}
          </button>
          <button
            type="button"
            className={dialogStyles.dialogConfirm}
            onClick={() => void confirm()}
            disabled={busy}
            data-edit-topic-confirm
          >
            {busy ? '…' : t('dialog.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
