/**
 * V2-T5.3 — 调查员页重定位（调查管理 + 分析记录 — design §7.3, A 案,
 * 重心搬家).
 *
 * The T5.3 page is a REPOSITIONING of the V1 investigator machinery, not
 * new channels (plan P5 T5.3): the data face is the SAME V1-accepted
 * analysis channel (plugin-owned host commands over the DSH built-in
 * `commands/execute` gateway — zero new RPCs, `analysis-channel.ts`);
 * the 保存对话框 is the V1 `SaveAnalysisRecordDialog` UNCHANGED (the
 * 「仅用户显式保存」 discipline — INV-PERM-3 — stays intact).
 *
 * What moves (design §7.3 全量):
 *  - 只读引导条: a RESIDENT single line at the top of the page (never
 *    dismissed, never hidden) — the Q10 pure-guide landing point. The
 *    HUB role carries the §7.3 portfolio/neutral framing (中枢工作区
 *    会话是只读观察位); the project roles (MANAGED/STANDALONE) carry the
 *    project-scoped variant (the page is 调查管理 + 分析记录, NOT a
 *    transcript viewer — the full transcript is the host session UI's
 *    job, §7.3 页面身份).
 *  - 绑定来源行: the bound investigator session + the intervention that
 *    launched it (a REVERSE LINK back to 重要事件) + 解绑. The binding is
 *    CLIENT-OWNED UI state lifted in the shell (the V1 cockpit kept the
 *    launched session in per-mount state too — same semantics, new home);
 *    there is NO new wire for it (plan: no new wire schemas).
 *  - 瞬态面板收缩: the V1 full transient panel becomes a STATUS BAR —
 *    run status (运行中/已完成/失败/已取消, the §1.4 RunStatus 词表) +
 *    已产出 N 条分析 (the bound session's saved-record count, host is
 *    the truth) + the 转录指引 (the copy steering the user to the
 *    explicit save) + the 保存为 AnalysisRecord entry. No transcript
 *    re-rendering (§7.3: 不再重造转录视图).
 *  - 记录列表: every saved record carries its PROVENANCE CHAIN
 *    (record ← sourceRef ← investigator session — the §7.3 chain; the
 *    intervention link is clickable back to 重要事件, the session link
 *    re-binds the page to that session) + the 对象类型过滤段 (the
 *    V1 `OBJECT_KINDS` 词表; the segments = ALL + the kinds PRESENT in
 *    the list, so the page never renders dead filters).
 *
 * Layering: pure props/React view (views/** discipline — no
 * @deepseek-ai imports, no store knowledge; the three analysis faces
 * arrive as plain business promises through the shell's injected face —
 * resolve the DTO, reject on ANY failure; this page's fault lines
 * respond). The V1 pure projections (RUN_STATUS_LABEL /
 * selectSavedRecordRows / the save-dialog helpers) are REUSED from
 * `../investigator/investigator-model.js` — one source for the 词表 and
 * the payload gates.
 */

import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'

import type {
  AnalysisRecordDto,
  AnalysisTypedRef,
  InvestigatorTransientDto,
  SaveAnalysisRecordArgs,
} from '../../shared/analysis-command.js'
import {
  initialSaveFieldValues,
  OBJECT_KINDS,
  RUN_STATUS_LABEL,
  SOURCE_REF_KIND_LABEL,
  selectSavedRecordRows,
  type SaveDialogFieldValues,
} from '../investigator/investigator-model.js'
import { SaveAnalysisRecordDialog } from '../investigator/transient-view.js'
import styles from './investigator-page.module.css'

/**
 * The client-owned investigator binding (the V1 cockpit's per-mount
 * `investigatorSession` state, repositioned as shell-lifted state):
 * the launched session + the intervention that launched it. NOT a wire
 * shape — plain UI state (the page never persists it, the host never
 * sees it).
 */
export interface InvestigatorBinding {
  /** The launched investigator session id (transient read target + the
   *  save dialog's `dshSessionId` prefill). */
  readonly sessionId: string
  /** The launching intervention id (the 绑定来源行 reverse link target);
   *  null when the binding has no intervention origin. */
  readonly interventionId: string | null
  /** The launching intervention's title (display only; null = id only). */
  readonly interventionTitle: string | null
}

/**
 * Props of the 调查员 page body (all three console roles).
 *
 * @param props - `role` selects the 只读引导条 framing (HUB = the §7.3
 *  portfolio/neutral copy; MANAGED/STANDALONE = the project-scoped
 *  variant); `binding` + the three binding callbacks are shell-lifted
 *  state (解绑 clears it, the 反链 jumps to 重要事件, a record-chain
 *  session link re-binds it); the three analysis faces are plain
 *  business promises (the V1 channel, resolve the DTO / reject on ANY
 *  failure — the page's fault lines respond, no `RemoteResult` here).
 */
export interface InvestigatorPageProps {
  readonly role: 'HUB' | 'MANAGED' | 'STANDALONE'
  readonly binding: InvestigatorBinding | null
  /** 解绑 — clears the shell-lifted binding (no RPC; client state). */
  readonly onUnbind: () => void
  /** 反链 (绑定来源行 + the record-chain intervention link) → 重要事件. */
  readonly onOpenIntervention: (interventionId: string) => void
  /** A record-chain session link — re-bind the page to that session
   *  (the record's sourceRef rides along as the new binding origin when
   *  it is an intervention; the title is unknown on this path — id only). */
  readonly onBindSession: (sessionId: string, sourceRef?: AnalysisTypedRef) => void
  /** The transient snapshot read (the V1 channel — resolve the DTO,
   *  reject on ANY failure). */
  readonly readTransient: (targetSessionId: string) => Promise<InvestigatorTransientDto>
  /** The saved-record list (host truth — resolve the DTO list, reject on
   *  ANY failure). */
  readonly loadRecords: () => Promise<readonly AnalysisRecordDto[]>
  /** The user-explicit save (INV-PERM-3 — the dialog's 确认 is the ONLY
   *  entry; resolve the saved DTO, reject on ANY failure). */
  readonly saveRecord: (args: SaveAnalysisRecordArgs) => Promise<AnalysisRecordDto>
}

/** The 只读引导条 copy (design §7.3 — resident single line). The HUB
 *  role carries the §7.3 portfolio/neutral framing verbatim; the project
 *  roles carry the 页面身份 framing (调查管理 + 分析记录 — not a
 *  transcript viewer). */
function guideCopy(role: InvestigatorPageProps['role']): string {
  return role === 'HUB'
    ? '中枢工作区的会话是只读观察位。深度调查请用「一键调查」启动专职调查会话（入口在「重要事件」的「待处理」事件卡片上）。'
    : '调查员页只做调查管理 + 分析记录沉淀（完整转录由宿主会话界面承载）。深度调查请用「一键调查」启动专职调查会话（入口在「重要事件」的「待处理」事件卡片上）。'
}

/** The status-bar run label for a transient snapshot (the §1.4 词表;
 *  null faces stay HONEST — 缺席透出, no invented status). */
function statusLabel(data: InvestigatorTransientDto): string {
  if (data.session === null) return '会话已不在 live 列表（可能已 dispose）'
  if (data.run !== null) return RUN_STATUS_LABEL[data.run.status] ?? data.run.status
  return data.session.running ? '会话运行中' : '会话空闲'
}

/** The CSS dot class for a status label (status colors via STATE tokens
 *  — the T1.2 gate: the dot is decorative, the LABEL text carries the
 *  meaning on the label-primary band). */
function statusDotClass(label: string): string {
  if (label === '运行中' || label === '会话运行中') return styles.dotRunning
  if (label === '已完成') return styles.dotFinished
  if (label === '失败') return styles.dotFailed
  return styles.dotIdle
}

/** One saved record's row projection (the V1 pure projection + the
 *  provenance-chain pieces it does not carry). */
interface RecordRow {
  readonly record: AnalysisRecordDto
  readonly preview: string
  readonly timeText: string
  /** The chain's sourceRef piece (kind label + id). */
  readonly sourceRefLabel: string
  readonly sourceRefIsIntervention: boolean
  /** The chain's session piece (null = 缺席, honest text). */
  readonly sessionId: string | null
}

function projectRecordRows(records: readonly AnalysisRecordDto[]): readonly RecordRow[] {
  return selectSavedRecordRows(records).map((row) => ({
    record: row.record,
    preview: row.preview,
    timeText: row.timeText,
    sourceRefLabel: row.sourceRefLabel,
    sourceRefIsIntervention: row.record.sourceRef.kind === 'INTERVENTION',
    sessionId: row.record.dshSessionId,
  }))
}

/** The 对象类型过滤段 segments (design §7.3: `OBJECT_KINDS` 已有) —
 *  ALL + the kinds PRESENT in the list, ordered by the frozen 词表. */
function filterSegments(rows: readonly RecordRow[]): readonly string[] {
  const present = new Set(rows.map((r) => r.record.sourceRef.kind))
  const ordered = OBJECT_KINDS.filter((k) => present.has(k))
  return ['ALL', ...ordered]
}

export function InvestigatorPage(props: InvestigatorPageProps): ReactElement {
  // ── saved records (host truth — the list face) ──────────────────
  const [recordsPhase, setRecordsPhase] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [records, setRecords] = useState<readonly AnalysisRecordDto[]>([])
  const [recordsFault, setRecordsFault] = useState<string | null>(null)
  const [kindFilter, setKindFilter] = useState<string | null>(null)

  // ── transient snapshot (the bound session — the status bar face) ──
  const [transientPhase, setTransientPhase] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle')
  const [transient, setTransient] = useState<InvestigatorTransientDto | null>(null)
  const [transientFault, setTransientFault] = useState<string | null>(null)

  // ── save dialog (the V1 显式保存 flow, UNCHANGED) ────────────────
  const [dialogOpen, setDialogOpen] = useState(false)
  const [fieldValues, setFieldValues] = useState<SaveDialogFieldValues | null>(null)
  const [saveBusy, setSaveBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [lastSaved, setLastSaved] = useState<AnalysisRecordDto | null>(null)

  // The faces are read through refs (the T4.x shell discipline — a
  // re-render with a fresh binding never leaks a stale closure into an
  // effect) and deduped per in-flight slot (StrictMode's double effect
  // reuses the first in-flight fetch).
  const loadRecordsRef = useRef(props.loadRecords)
  loadRecordsRef.current = props.loadRecords
  const readTransientRef = useRef(props.readTransient)
  readTransientRef.current = props.readTransient

  const recordsInflight = useRef<Promise<readonly AnalysisRecordDto[]> | null>(null)

  const runRecordsFetch = useCallback((initial: boolean): void => {
    if (recordsInflight.current !== null) return
    if (initial) setRecordsPhase('loading')
    else setRecordsFault(null)
    const pending = loadRecordsRef.current()
    recordsInflight.current = pending
    void pending
      .then((result) => {
        if (recordsInflight.current !== pending) return
        setRecords(result)
        setRecordsPhase('ready')
      })
      .catch((err: unknown) => {
        if (recordsInflight.current !== pending) return
        const message = err instanceof Error ? err.message : String(err)
        if (initial) {
          setRecordsPhase('failed')
          setRecordsFault(message)
        } else {
          // Stale data stays (the fault line is the response).
          setRecordsFault(message)
        }
      })
      .finally(() => {
        if (recordsInflight.current === pending) recordsInflight.current = null
      })
  }, [])

  useEffect(() => {
    if (recordsInflight.current === null) {
      runRecordsFetch(true)
    }
    // One records fetch per mount — the ref-deduped runRecordsFetch is stable.
  }, [runRecordsFetch])

  // The bound session's transient snapshot — re-read when the binding
  // moves (launch / re-bind / unbind). No binding = no read (idle — the
  // status bar is the 绑定来源行's honest 未绑定 face, not a fake null
  // snapshot).
  const boundSessionId = props.binding?.sessionId ?? null
  const transientInflight = useRef<Promise<InvestigatorTransientDto> | null>(null)

  useEffect(() => {
    if (boundSessionId === null) {
      setTransientPhase('idle')
      setTransient(null)
      setTransientFault(null)
      return
    }
    setTransientPhase('loading')
    setTransient(null)
    setTransientFault(null)
    const pending = readTransientRef.current(boundSessionId)
    transientInflight.current = pending
    void pending
      .then((result) => {
        if (transientInflight.current !== pending) return
        setTransient(result)
        setTransientPhase('ready')
      })
      .catch((err: unknown) => {
        if (transientInflight.current !== pending) return
        setTransientFault(err instanceof Error ? err.message : String(err))
        setTransientPhase('failed')
      })
      .finally(() => {
        if (transientInflight.current === pending) transientInflight.current = null
      })
  }, [boundSessionId])

  // ── save flow (the dialog's 确认 → the host 用户门) ──────────────
  const openDialog = (): void => {
    // Prefill from the CURRENT binding + transient snapshot (the V1
    // container's open-time re-prefill discipline — the run row may have
    // just loaded).
    const binding = props.binding
    setFieldValues(
      initialSaveFieldValues({
        sessionId: binding?.sessionId ?? '',
        sourceRef: binding !== null && binding.interventionId !== null
          ? { kind: 'INTERVENTION', id: binding.interventionId }
          : undefined,
        run: transient?.run ?? null,
      }),
    )
    setSaveError(null)
    setDialogOpen(true)
  }

  const cancelDialog = (): void => {
    setDialogOpen(false)
    setSaveError(null)
  }

  const runSave = (args: SaveAnalysisRecordArgs): void => {
    setSaveBusy(true)
    setSaveError(null)
    void props
      .saveRecord(args)
      .then((saved) => {
        // Success: dialog closes + 成功 chip + the host-truth RE-FETCH
        // (no local patch — the record appears via the re-read list).
        setLastSaved(saved)
        setDialogOpen(false)
        runRecordsFetch(false)
      })
      .catch((err: unknown) => {
        // The dialog STAYS open with the fault (the user can fix the
        // fields and re-submit — the host wrote nothing on failure).
        setSaveError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        setSaveBusy(false)
      })
  }

  // ── projections ─────────────────────────────────────────────────
  const rows = projectRecordRows(records)
  const segments = filterSegments(rows)
  const visibleRows = kindFilter === null ? rows : rows.filter((r) => r.record.sourceRef.kind === kindFilter)
  const producedCount = boundSessionId === null ? 0 : records.filter((r) => r.dshSessionId === boundSessionId).length
  const label = transient !== null ? statusLabel(transient) : null

  return (
    <div className={styles.page} data-investigator-page data-role={props.role}>
      {/* 只读引导条 (design §7.3 — 常驻, never dismissed): the Q10
          pure-guide landing point. Host 提示色 (state-business tokens);
          the copy carries meaning → label-primary band (T1.2 gate). */}
      <div className={styles.guideBar} role="note" data-investigator-guide data-guide-role={props.role}>
        <span className={styles.guideIcon} aria-hidden="true">
          ℹ
        </span>
        <span className={styles.guideText}>{guideCopy(props.role)}</span>
      </div>

      {/* 绑定来源行 (design §7.3): the bound session + the launching
          intervention (反链 → 重要事件) + 解绑. */}
      {props.binding !== null ? (
        <div className={styles.bindingRow} data-investigator-binding={props.binding.sessionId}>
          <span className={styles.bindingLabel}>绑定会话:</span>
          <span className={styles.bindingSession} data-binding-session={props.binding.sessionId}>
            {props.binding.sessionId}
          </span>
          {props.binding.interventionId !== null ? (
            <button
              type="button"
              className={styles.bindingLink}
              data-binding-intervention={props.binding.interventionId}
              onClick={() => props.onOpenIntervention(props.binding?.interventionId ?? '')}
            >
              （来自 {props.binding.interventionId}
              {props.binding.interventionTitle !== null ? ` ${props.binding.interventionTitle}` : ''}）
            </button>
          ) : null}
          <button
            type="button"
            className={styles.unbindButton}
            data-binding-unbind
            onClick={props.onUnbind}
          >
            解绑
          </button>
        </div>
      ) : (
        <p className={styles.unboundLine} data-investigator-unbound>
          未绑定调查会话 — 在「重要事件」对一张「待处理」事件卡片使用「一键调查」启动专职调查会话（没有待处理事件时入口不出现）。
        </p>
      )}

      {/* 瞬态面板收缩 (design §7.3): the STATUS BAR — run status +
          已产出 N 条分析 + 转录指引 + the explicit-save entry. Rendered
          ONLY while bound (unbound = the honest line above; no fake
          status row). */}
      {props.binding !== null ? (
        <div className={styles.statusBar} data-investigator-status>
          {transientPhase === 'loading' ? (
            <span className={styles.statusPending}>调查会话状态加载中…</span>
          ) : transientPhase === 'failed' ? (
            <span className={styles.faultLine} role="alert">
              调查会话状态读取失败: {transientFault}
            </span>
          ) : label !== null ? (
            <>
              <span className={`${styles.statusDot} ${statusDotClass(label)}`} aria-hidden="true" />
              <span className={styles.statusLabel} data-status-label={label}>
                {label}
              </span>
              {recordsPhase === 'ready' ? (
                <span className={styles.producedChip} data-produced-count={producedCount}>
                  已产出 {producedCount} 条分析
                </span>
              ) : null}
              <span className={styles.transcriptHint}>完整转录由宿主会话界面承载 — 结论沉淀用下方显式保存。</span>
              <button
                type="button"
                className={styles.saveButton}
                data-investigator-save
                onClick={openDialog}
              >
                保存为 AnalysisRecord
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {/* 保存成功 chip (the V1 container chip, repositioned). */}
      {lastSaved !== null ? (
        <p className={styles.savedChip} role="status" data-saved-chip={lastSaved.id}>
          已保存 <span className={styles.itemId}>{lastSaved.id}</span>（保存后不可变 — 修正 = 新记录）
        </p>
      ) : null}

      {/* 记录列表 (design §7.3): 溯源链 per record + 对象类型过滤段. */}
      <section className={styles.recordsSection} data-records aria-label="已保存分析记录">
        <header className={styles.recordsHead}>
          <h2 className={styles.recordsTitle}>
            已保存记录（{rows.length}）
          </h2>
          {segments.length > 1 ? (
            <div className={styles.filterSegments} role="group" aria-label="按对象类型过滤">
              {segments.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className={kindFilter === kind || (kindFilter === null && kind === 'ALL') ? styles.filterActive : styles.filterItem}
                  data-record-filter={kind}
                  onClick={() => setKindFilter(kind === 'ALL' ? null : kind)}
                >
                  {kind === 'ALL' ? '全部' : (SOURCE_REF_KIND_LABEL[kind] ?? kind)}
                </button>
              ))}
            </div>
          ) : null}
        </header>

        {recordsPhase === 'loading' ? (
          <p className={styles.statusLine} role="status">
            已保存记录加载中…
          </p>
        ) : recordsPhase === 'failed' ? (
          <p className={styles.faultLine} role="alert">
            分析数据面不可用: {recordsFault}
          </p>
        ) : rows.length === 0 ? (
          <p className={styles.statusLine}>暂无已保存的分析记录（investigator 分析需用户显式保存才落盘）。</p>
        ) : visibleRows.length === 0 ? (
          <p className={styles.statusLine}>该对象类型下暂无记录。</p>
        ) : (
          <ul className={styles.recordList}>
            {visibleRows.map((row) => (
              <li key={row.record.id} className={styles.recordItem} data-record-id={row.record.id}>
                <span className={styles.recordId}>{row.record.id}</span>
                <span className={styles.recordPreview} title={row.record.content}>
                  {row.preview}
                </span>
                <span className={styles.provenanceChain} data-provenance-chain>
                  {/* record ← sourceRef (the intervention link is the 反链
                      to 重要事件; other kinds render as labeled text —
                      the chain piece is still present, honestly). */}
                  {row.sourceRefIsIntervention ? (
                    <button
                      type="button"
                      className={styles.chainLink}
                      data-record-iv={row.record.sourceRef.id}
                      onClick={() => props.onOpenIntervention(row.record.sourceRef.id)}
                    >
                      ← {row.record.sourceRef.id}
                    </button>
                  ) : (
                    <span className={styles.chainText}>
                      ← {row.sourceRefLabel} {row.record.sourceRef.id}
                    </span>
                  )}
                  {/* record ← investigator session (the re-bind link). */}
                  {row.sessionId !== null ? (
                    <button
                      type="button"
                      className={styles.chainLink}
                      data-record-session={row.sessionId}
                      onClick={() => props.onBindSession(row.sessionId ?? '', row.record.sourceRef)}
                    >
                      ← {row.sessionId}
                    </button>
                  ) : (
                    <span className={styles.chainText}>← （无会话指针）</span>
                  )}
                  <span className={styles.recordTime}>{row.timeText}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 保存对话框 (design §7.3: 原样保留 — the V1 dialog component,
          the 「仅用户显式保存」 discipline unchanged). */}
      {dialogOpen && fieldValues !== null ? (
        <SaveAnalysisRecordDialog
          sessionId={props.binding?.sessionId ?? ''}
          fieldValues={fieldValues}
          busy={saveBusy}
          error={saveError}
          onFieldChange={(name, value) => setFieldValues((prev) => (prev === null ? prev : { ...prev, [name]: value }))}
          onConfirm={(args) => runSave(args)}
          onCancel={cancelDialog}
        />
      ) : null}
    </div>
  )
}
