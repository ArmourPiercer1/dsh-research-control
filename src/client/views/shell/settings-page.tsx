/**
 * V2-T5.4 — the 设置 page (design §7.4 四段式管理面), rendered as the 4th
 * first-level entry body inside the console frame (HUB / MANAGED /
 * STANDALONE only — UNREGISTERED / NO_CWD sessions never reach the frame:
 * their face is the 引导卡, which stays the ONLY entry for them).
 *
 * The four sections (design §7.4):
 *  - ① 当前状态: this workspace's role / the hub path / the registry
 *    overview (counts over the FULL book — ACTIVE + ARCHIVED).
 *  - ② 操作 (per-role 显隐, the §7.4 状态表): [重扫并连接] always; HUB →
 *    the 设为中枢 state line (本工作区已是研究管理中枢 — no RPC, the hub
 *    exists by definition) + [接入] on an EMPTY hub (the SAME
 *    displayName flow as the 引导卡 — the host refuses the hub-workspace
 *    bind with a clear error, so the button fails loud instead of forging
 *    a registration, the T5.1 empty-hub card's pinned behavior);
 *    MANAGED → [解除绑定] (the confirm dialog states the 三件事 — the
 *    entry 转归档（不删）, `<treeDir>/` renamed `<treeDir>.archived-<ts>`,
 *    the 事件库 stays at the hub; the confirm button reads 解除绑定
 *    verbatim); STANDALONE → [接入研究管理系统] when a hub exists
 *    (the tree is present — the host registers it and migrates the
 *    standalone db into the hub, design §8 接入（有中枢）) or [设为中枢]
 *    when the plane has NO hub (the §7.4 ② line 「设为中枢(无中枢时)」 +
 *    the §5 状态表 无中枢 row: the confirm creates the `<hubDir>/` marker
 *    + the EMPTY registry; the workspace's own tree stays a STANDALONE
 *    project — its db never moves, it is not auto-registered — and the
 *    session role flips to HUB on the re-fetch).
 *  - ③ 项目登记册 (HUB only — the project-workspace sessions see the
 *    收窄版 ①②④): the FULL registry book (design §7.4 ③, the V2-T5.4
 *    wire `registry` segment — ACTIVE + ARCHIVED, declaration order),
 *    every row carrying id / displayName / path / 登记日期 (boundAt) /
 *    the derived status; the standing relief channel for the MISSING
 *    弹窗 (弹窗是急救, 这里是
 *    日常): 正常 → [重验] (rescan); ⚠树缺失 → [恢复指引] (the inline
 *    restore guide — no RPC) + [移除登记] (the SAME unbindProject face
 *    the T4.3 modal uses — the host's guard decides and a refusal
 *    surfaces as the fault line, consistent with T4.3); 已归档 →
 *    [恢复登记] (restoreProject — the host re-activates the entry,
 *    renames `<treeDir>.archived-<ts>` BACK, and re-validates: the
 *    plugin 代劳 the rename, symmetric with the unbind).
 *  - ④ 数据位置 (只读透明化, all three console roles): the registry.yaml
 *    path (HUB) + every event-store path, derived CLIENT-SIDE from the
 *    plane state per the §3.3 layout rule (a mirror of the host's
 *    resolveDbPath — no new wire field): MANAGED/ARCHIVED/MISSING →
 *    `<hub>/<hubDir>/projects/<id>/research.sqlite` (the db never leaves
 *    the hub); STANDALONE → `<wsPath>/<treeDir>/state/research.sqlite`.
 *
 * The page is PURE props/React (INV-PERM-5): the plane state arrives as a
 * prop (the shell's own fetch — the single source of truth), every
 * mutation face is a plain business promise (resolves the strict wire
 * result, rejects on any failure — the view never sees a `RemoteResult`),
 * and `onApplied` is the post-mutation shell re-fetch (the shell decides
 * the nav behavior: the HUB book actions keep the 设置 entry active, the
 * project-role flips leave the console). One action in flight at a time
 * (the 处理中… busy state, the 引导卡 pattern); a rejection shows the
 * SECTION-SCOPED fault line (② faults in ②, ③ book faults in ③ — the
 * 引导卡/弹窗 house pattern: the error shows next to the action) and
 * leaves all state intact (no partial update, no local patch — the next
 * action re-issues cleanly).
 *
 * Global preferences (the two directory names) are NOT on this page —
 * they live on the DSH 设置 plugin card (design §7.5, 分工不重叠).
 */

import { useState } from 'react'
import type { ReactElement } from 'react'
import type {
  BindProjectArgs,
  BindProjectResult,
  GetResearchPlaneStateResult,
  RescanArgs,
  RescanResult,
  RegistryEntryDto,
  RestoreProjectArgs,
  RestoreProjectResult,
  SetHubArgs,
  SetHubResult,
  UnbindProjectArgs,
  UnbindProjectResult,
} from '../../../shared/rpc-contracts.js'
import { formatEpochDate } from './hub-overview.js'
import styles from './settings-page.module.css'

export interface SettingsPageProps {
  /** The console role (the §5 branch that rendered this page). */
  readonly role: 'HUB' | 'MANAGED' | 'STANDALONE'
  /** The session cwd (the 受管/独立 project wsPath; the hub path for HUB). */
  readonly cwd: string | null
  /** The shell's plane state (the single source of truth — re-fetched by
   *  the shell after every successful mutation via `onApplied`). */
  readonly plane: GetResearchPlaneStateResult
  /** 重扫并连接 / [重验] — re-run discovery + reconciliation (§12 row 8). */
  readonly rescan: (args: RescanArgs) => Promise<RescanResult>
  /** [接入] / [接入研究管理系统] — register the workspace (§12 row 5). */
  readonly bindProject: (args: BindProjectArgs) => Promise<BindProjectResult>
  /** [设为中枢] (STANDALONE + no hub only) — create the hub here (§12 row 4). */
  readonly setHub: (args: SetHubArgs) => Promise<SetHubResult>
  /** [解除绑定] / [移除登记] — archive the entry (§12 row 6). */
  readonly unbindProject: (args: UnbindProjectArgs) => Promise<UnbindProjectResult>
  /** [恢复登记] — revive an archived entry (§12 row 7). */
  readonly restoreProject: (args: RestoreProjectArgs) => Promise<RestoreProjectResult>
  /** Fired after every SUCCESSFUL mutation (the shell's plane re-fetch). */
  readonly onApplied: () => void
}

/** The §7.4 ③ row status (derived — the book row's action set). */
type BookRowStatus = 'normal' | 'missing' | 'archived'

interface BookRow {
  readonly entry: RegistryEntryDto
  readonly status: BookRowStatus
}

/** The ③ row derivation: archived wins; an active entry riding the
 *  MISSING set is 树缺失; the rest is 正常. */
function deriveBookRows(
  registry: readonly RegistryEntryDto[],
  missing: readonly { readonly projectId: string }[],
): BookRow[] {
  const missingIds = new Set(missing.map((m) => m.projectId))
  return registry.map((entry) => ({
    entry,
    status: entry.status === 'archived' ? 'archived' : missingIds.has(entry.id) ? 'missing' : 'normal',
  }))
}

/** The §3.3 db layout (client mirror of the host resolveDbPath). */
function managedDbPath(hubPath: string, hubDir: string, projectId: string): string {
  return `${hubPath}/${hubDir}/projects/${projectId}/research.sqlite`
}

function standaloneDbPath(wsPath: string, treeDir: string): string {
  return `${wsPath}/${treeDir}/state/research.sqlite`
}

/** The 接入 dialog's prefilled display name: the cwd's folder name. */
function folderNameOf(wsPath: string | null): string {
  if (wsPath === null) return ''
  const segments = wsPath.split(/[\\/]/).filter((s) => s.length > 0)
  return segments[segments.length - 1] ?? ''
}

const ROLE_LABEL: Record<SettingsPageProps['role'], string> = {
  HUB: '中枢',
  MANAGED: '受管项目',
  STANDALONE: '独立项目',
}

/** The ③ status chip copy (design §7.4 ③ — 正常 / ⚠树缺失 / 已归档). */
const STATUS_LABEL: Record<BookRowStatus, string> = {
  normal: '正常',
  missing: '⚠树缺失',
  archived: '已归档',
}

export function SettingsPage(props: SettingsPageProps): ReactElement {
  const { role, cwd, plane, onApplied } = props
  const [busy, setBusy] = useState(false)
  // The fault line is SECTION-SCOPED (the 引导卡/弹窗 house pattern: the
  // error shows NEXT TO the action that produced it): ② actions fault in
  // ②, ③ book actions fault in ③.
  const [error, setError] = useState<{ source: 'actions' | 'book'; message: string } | null>(null)
  // The 接入 flow's displayName dialog: the HUB empty-hub [接入] and the
  // STANDALONE [接入研究管理系统] share it (the 引导卡 flow repositioned).
  const [bindDialog, setBindDialog] = useState(false)
  const [displayName, setDisplayName] = useState('')
  // The MANAGED 解除绑定 confirm dialog (the 三件事 copy, design §7.4).
  const [unbindDialog, setUnbindDialog] = useState(false)
  // The STANDALONE+no-hub 设为中枢 confirm dialog (the 引导卡 setHub flow
  // repositioned — the §5 状态表 无中枢 row, the marker + empty registry).
  const [setHubDialog, setSetHubDialog] = useState(false)
  // The ③ missing row's 恢复指引 expansion (the entry id, no RPC).
  const [guideOpenId, setGuideOpenId] = useState<string | null>(null)

  const { hub, dirNames } = plane
  const rows = deriveBookRows(plane.registry, plane.missing)
  const emptyHub = role === 'HUB' && plane.projects.length === 0

  /** The mutation wrapper: one in flight, rejection → the source section's
   *  fault line (the 引导卡 house pattern — the error shows next to the
   *  action, all state stays intact, the next action is clean). */
  const runMutation = async (fn: () => Promise<unknown>, source: 'actions' | 'book'): Promise<boolean> => {
    if (busy) return false
    setBusy(true)
    setError(null)
    try {
      await fn()
      return true
    } catch (err) {
      setError({ source, message: err instanceof Error ? err.message : String(err) })
      return false
    } finally {
      setBusy(false)
    }
  }

  /** [重扫并连接] / [重验] — rescan + shell re-fetch (the book re-renders
   *  fresh). The ③ [重验] shares the rescan face but faults in ③. */
  const onRescan = (): void => {
    void runMutation(
      async () => {
        await props.rescan({})
        onApplied()
      },
      'actions',
    )
  }

  const onBookRescan = (): void => {
    void runMutation(
      async () => {
        await props.rescan({})
        onApplied()
      },
      'book',
    )
  }

  /** The 接入 flow entry (the displayName dialog — the 引导卡 flow). */
  const openBindDialog = (): void => {
    setError(null)
    setDisplayName(folderNameOf(cwd))
    setBindDialog(true)
  }

  /** The 接入 confirm: the host registers the workspace. The HUB empty-hub
   *  case carries scaffold:true (the 引导卡 shape — the host's rejection
   *  ladder refuses the hub-workspace bind BEFORE the tree rung, so the
   *  loud error is the point, the T5.1 empty-hub card's pinned behavior);
   *  the STANDALONE case omits it (the tree IS present — the host probes
   *  it, design §8 接入（有中枢）). The dialog closes on BOTH outcomes
   *  (the 引导卡 pattern): success → the re-fetch re-renders the page;
   *  failure → the ② fault line answers. */
  const confirmBind = async (): Promise<void> => {
    if (cwd === null || displayName.trim() === '' || busy) return
    await runMutation(
      async () => {
        await props.bindProject(
          role === 'HUB'
            ? { wsPath: cwd, displayName: displayName.trim(), scaffold: true }
            : { wsPath: cwd, displayName: displayName.trim() },
        )
        onApplied()
      },
      'actions',
    )
    setBindDialog(false)
  }

  /** The 解除绑定 confirm dialog entry (the 三件事 confirm, MANAGED only). */
  const openUnbindDialog = (): void => {
    setError(null)
    setUnbindDialog(true)
  }

  /** The 解除绑定 confirm: archive the entry + rename the tree away. The
   *  dialog closes on BOTH outcomes (the 引导卡 pattern): success → the
   *  re-fetch flips the branch (the work goes back to 未登记态); failure →
   *  the ② fault line answers. */
  const confirmUnbind = async (): Promise<void> => {
    if (cwd === null || busy) return
    await runMutation(
      async () => {
        await props.unbindProject({ wsPath: cwd })
        onApplied()
      },
      'actions',
    )
    setUnbindDialog(false)
  }

  /** The 设为中枢 confirm dialog entry (STANDALONE + no hub only — the
   *  §5 状态表 无中枢 row; the host's rungs decide, a refusal surfaces
   *  on the ② fault line). */
  const openSetHubDialog = (): void => {
    setError(null)
    setSetHubDialog(true)
  }

  /** The 设为中枢 confirm: the host creates `<hubDir>/` + the EMPTY
   *  registry. On success the re-fetch flips the session role to HUB
   *  (the plain refresh — the shell resets the nav, the role flip is the
   *  documented rule; the workspace's own tree stays STANDALONE with its
   *  db in `<treeDir>/state/`, the §3.1 物理形状). */
  const confirmSetHub = async (): Promise<void> => {
    if (cwd === null || busy) return
    await runMutation(
      async () => {
        await props.setHub({ wsPath: cwd })
        onApplied()
      },
      'actions',
    )
    setSetHubDialog(false)
  }

  /** The ③ [移除登记] — the SAME unbindProject face the T4.3 modal uses
   *  (the entry's registered path; the host's guard decides — a refusal
   *  surfaces as the ③ fault line, consistent with T4.3). */
  const onRemoveEntry = (entry: RegistryEntryDto): void => {
    void runMutation(
      async () => {
        await props.unbindProject({ wsPath: entry.path })
        onApplied()
      },
      'book',
    )
  }

  /** The ③ [恢复登记] — the host re-activates + renames back + re-validates
   *  (the 代劳 rename, symmetric with the unbind). */
  const onRestoreEntry = (entry: RegistryEntryDto): void => {
    void runMutation(
      async () => {
        await props.restoreProject({ projectId: entry.id })
        onApplied()
      },
      'book',
    )
  }

  /** The ① 登记概况 counts (over the FULL book — ACTIVE + ARCHIVED). */
  const overview = (() => {
    const total = rows.length
    const archived = rows.filter((r) => r.status === 'archived').length
    const missing = rows.filter((r) => r.status === 'missing').length
    const normal = total - archived - missing
    return `共 ${total} 条 · 正常 ${normal} · 树缺失 ${missing} · 已归档 ${archived}`
  })()

  /** The own project id (the MANAGED/STANDALONE ④ row) — the shell already
   *  guarantees the cwd matches a plane project; a missing match is a state
   *  fault (fail-loud, the shell's null-cwd rule). */
  const ownProject =
    role === 'HUB' ? undefined : cwd === null ? undefined : plane.projects.find((p) => p.wsPath === cwd)

  /** The ④ rows (the §3.3 layout, client-derived — read-only 透明化). */
  const locationRows: { readonly label: string; readonly path: string }[] = []
  if (role === 'HUB' && hub !== null) {
    locationRows.push({ label: '中枢注册表', path: `${hub.path}/${dirNames.hubDir}/registry.yaml` })
    for (const entry of plane.registry) {
      // Managed / missing / archived: the db never leaves the hub (§3.3 —
      // the 库留中枢 of the 解除绑定 三件事; the missing entry's db stays
      // at the hub while its tree is 挂起).
      locationRows.push({
        label: `${entry.id} ${entry.displayName}`,
        path: managedDbPath(hub.path, dirNames.hubDir, entry.id),
      })
    }
    for (const project of plane.projects) {
      if (project.kind !== 'STANDALONE') continue
      locationRows.push({
        label: `${project.projectId} ${project.displayName}`,
        path: standaloneDbPath(project.wsPath, dirNames.treeDir),
      })
    }
  } else if (role === 'MANAGED') {
    if (hub !== null && ownProject !== undefined) {
      locationRows.push({
        label: `${ownProject.projectId} ${ownProject.displayName}`,
        path: managedDbPath(hub.path, dirNames.hubDir, ownProject.projectId),
      })
    }
  } else if (role === 'STANDALONE' && cwd !== null && ownProject !== undefined) {
    locationRows.push({
      label: `${ownProject.projectId} ${ownProject.displayName}`,
      path: standaloneDbPath(cwd, dirNames.treeDir),
    })
  }

  const stateFault =
    role !== 'HUB' && (cwd === null || ownProject === undefined)
      ? '研究平面状态异常：当前项目未解析'
      : null

  return (
    <div className={styles.settings} data-settings-page data-settings-role={role}>
      {/* ① 当前状态 (design §7.4): 角色 / 中枢路径 / 登记概况. */}
      <section className={styles.section} data-settings-section="status" aria-label="当前状态">
        <h2 className={styles.sectionTitle}>① 当前状态</h2>
        <dl className={styles.stateList}>
          <div className={styles.stateRow}>
            <dt className={styles.stateLabel}>本工作区角色</dt>
            <dd className={styles.stateValue}>{ROLE_LABEL[role]}</dd>
          </div>
          <div className={styles.stateRow}>
            <dt className={styles.stateLabel}>中枢</dt>
            <dd className={styles.stateValue}>
              {hub !== null ? <code className={styles.pathValue}>{hub.path}</code> : '（无管理中枢）'}
            </dd>
          </div>
          <div className={styles.stateRow}>
            <dt className={styles.stateLabel}>登记概况</dt>
            <dd className={styles.stateValue}>{overview}</dd>
          </div>
        </dl>
      </section>

      {/* ② 操作 (design §7.4 — the per-role 显隐 状态表). */}
      <section className={styles.section} data-settings-section="actions" aria-label="操作">
        <h2 className={styles.sectionTitle}>② 操作</h2>
        <div className={styles.actionList}>
          {role === 'HUB' && (
            <p className={styles.stateNote}>本工作区已是研究管理中枢（设为中枢已满足）。</p>
          )}
          {role === 'STANDALONE' && hub === null && (
            <button type="button" className={styles.actionButton} onClick={openSetHubDialog} disabled={busy}>
              {busy ? '处理中…' : '设为中枢'}
            </button>
          )}
          {stateFault !== null && (
            <p className={styles.faultLine} role="alert">
              {stateFault}
            </p>
          )}
          <button type="button" className={styles.actionButton} onClick={onRescan} disabled={busy}>
            {busy ? '处理中…' : '重扫并连接'}
          </button>
          {emptyHub && (
            <button type="button" className={styles.actionButton} onClick={openBindDialog} disabled={busy}>
              {busy ? '处理中…' : '接入'}
            </button>
          )}
          {role === 'MANAGED' && (
            <button
              type="button"
              className={`${styles.actionButton} ${styles.actionDanger}`}
              onClick={openUnbindDialog}
              disabled={busy}
            >
              {busy ? '处理中…' : '解除绑定'}
            </button>
          )}
          {role === 'STANDALONE' && hub !== null && (
            <button type="button" className={styles.actionButton} onClick={openBindDialog} disabled={busy}>
              {busy ? '处理中…' : '接入研究管理系统'}
            </button>
          )}
          {error !== null && error.source === 'actions' && (
            <p className={styles.faultLine} role="alert">
              {error.message}
            </p>
          )}
        </div>
      </section>

      {/* ③ 项目登记册 (HUB only — design §7.4 ③; the project-workspace
          sessions see the 收窄版 ①②④ without this section). */}
      {role === 'HUB' && (
        <section className={styles.section} data-settings-section="book" aria-label="项目登记册">
          <h2 className={styles.sectionTitle}>③ 项目登记册</h2>
          {plane.registry.length === 0 ? (
            <p className={styles.stateNote}>登记册为空（尚无登记项目）。</p>
          ) : (
            <ul className={styles.bookList}>
              {rows.map(({ entry, status }) => (
                <li
                  key={entry.id}
                  className={styles.bookRow}
                  data-book-row
                  data-book-id={entry.id}
                  data-book-status={status}
                >
                  <span className={styles.bookId}>{entry.id}</span>
                  <span className={styles.bookName}>{entry.displayName}</span>
                  <code className={styles.bookPath}>{entry.path}</code>
                  <span className={`${styles.statusChip} ${styles[`status_${status}`]}`}>{STATUS_LABEL[status]}</span>
                  <span className={styles.bookMeta}>
                    登记于 {formatEpochDate(entry.boundAt)}
                    {status === 'archived' && entry.archivedAt !== null && <> · 归档于 {formatEpochDate(entry.archivedAt)}</>}
                  </span>
                  <span className={styles.bookActions}>
                    {status === 'normal' && (
                      <button
                        type="button"
                        className={styles.bookAction}
                        onClick={onBookRescan}
                        disabled={busy}
                        data-book-action="rescan"
                      >
                        {busy ? '处理中…' : '重验'}
                      </button>
                    )}
                    {status === 'missing' && (
                      <>
                        <button
                          type="button"
                          className={styles.bookAction}
                          onClick={() => setGuideOpenId(guideOpenId === entry.id ? null : entry.id)}
                          disabled={busy}
                          data-book-action="guide"
                        >
                          恢复指引
                        </button>
                        <button
                          type="button"
                          className={`${styles.bookAction} ${styles.bookActionDanger}`}
                          onClick={() => onRemoveEntry(entry)}
                          disabled={busy}
                          data-book-action="remove"
                        >
                          {busy ? '处理中…' : '移除登记'}
                        </button>
                      </>
                    )}
                    {status === 'archived' && (
                      <button
                        type="button"
                        className={styles.bookAction}
                        onClick={() => onRestoreEntry(entry)}
                        disabled={busy}
                        data-book-action="restore"
                      >
                        {busy ? '处理中…' : '恢复登记'}
                      </button>
                    )}
                  </span>
                  {status === 'missing' && guideOpenId === entry.id && (
                    <p className={styles.guideText} data-book-guide>
                      恢复指引：将研究树目录放回 <code>{entry.path}/{dirNames.treeDir}</code> 后点「重验」
                      （或「移除登记」放弃该项目，再重新接入）。
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
          {error !== null && error.source === 'book' && (
            <p className={styles.faultLine} role="alert">
              {error.message}
            </p>
          )}
        </section>
      )}

      {/* ④ 数据位置 (design §7.4 ④ — 只读透明化; the §3.3 layout derived
          client-side, a mirror of the host's resolveDbPath). */}
      <section className={styles.section} data-settings-section="locations" aria-label="数据位置">
        <h2 className={styles.sectionTitle}>④ 数据位置</h2>
        {locationRows.length === 0 ? (
          <p className={styles.stateNote}>无可展示的数据位置。</p>
        ) : (
          <ul className={styles.locationList}>
            {locationRows.map((row) => (
              <li key={row.path} className={styles.locationRow} data-location-row>
                <span className={styles.locationLabel}>{row.label}</span>
                <code className={styles.locationPath}>{row.path}</code>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* The 接入 dialog (the 引导卡 displayName flow repositioned — the
          SAME copy + flow; the HUB empty-hub case fails loud on confirm:
          the host refuses the hub-workspace bind before any write, the
          T5.1 empty-hub card's pinned behavior). */}
      {bindDialog && (
        <div
          className={styles.dialogOverlay}
          role="dialog"
          aria-modal="true"
          aria-label={role === 'HUB' ? '接入' : '接入研究管理系统'}
        >
          <div className={styles.dialogPanel}>
            <h3 className={styles.dialogTitle}>{role === 'HUB' ? '接入' : '接入研究管理系统'}</h3>
            {role === 'HUB' ? (
              // The HUB empty-hub case (the 引导卡 copy — the confirm fails
              // loud on the host's hub-workspace refusal, the T5.1 pin).
              <p className={styles.dialogCopy}>将以该显示名登记本工作区为研究项目。</p>
            ) : (
              // STANDALONE (the tree IS present — the host probes it and
              // migrates the standalone db into the hub, design §8 接入（有中枢）).
              <p className={styles.dialogCopy}>
                本工作区已有 <code>{dirNames.treeDir}/</code> 研究树。确认后将登记为中枢的 active
                项目，既有独立事件库迁入中枢（<code>{dirNames.treeDir}/state/</code> →
                中枢项目库）。
              </p>
            )}
            <label className={styles.dialogField} htmlFor="settings-display-name">
              项目显示名
            </label>
            <input
              id="settings-display-name"
              className={styles.dialogInput}
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
            <div className={styles.dialogActions}>
              <button type="button" className={styles.dialogCancel} onClick={() => setBindDialog(false)}>
                取消
              </button>
              <button
                type="button"
                className={styles.dialogConfirm}
                disabled={busy || displayName.trim() === ''}
                onClick={() => void confirmBind()}
              >
                {busy ? '处理中…' : role === 'HUB' ? '接入' : '接入研究管理系统'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* The 解除绑定 confirm dialog (design §7.4: 明写三件事; the confirm
          button reads 解除绑定 verbatim). */}
      {unbindDialog && (
        <div className={styles.dialogOverlay} role="dialog" aria-modal="true" aria-label="解除绑定">
          <div className={styles.dialogPanel}>
            <h3 className={styles.dialogTitle}>解除绑定</h3>
            <p className={styles.dialogCopy}>确认解除绑定后，将发生以下三件事：</p>
            <ol className={styles.dialogThreeItems}>
              <li className={styles.dialogThreeItem}>
                登记册条目转归档（不删除——日后可在「中枢 设置 → 项目登记册」点「恢复登记」还原）。
              </li>
              <li className={styles.dialogThreeItem}>
                研究树目录 <code>{dirNames.treeDir}/</code> 改名为{' '}
                <code>{dirNames.treeDir}.archived-〈时间戳〉/</code>（留在本工作区内）。
              </li>
              <li className={styles.dialogThreeItem}>事件库保留在中枢（不移动、不删除，历史完整保留）。</li>
            </ol>
            <div className={styles.dialogActions}>
              <button type="button" className={styles.dialogCancel} onClick={() => setUnbindDialog(false)}>
                取消
              </button>
              <button
                type="button"
                className={styles.dialogConfirm}
                disabled={busy}
                onClick={() => void confirmUnbind()}
              >
                {busy ? '处理中…' : '解除绑定'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* The 设为中枢 confirm dialog (STANDALONE + no hub — the 引导卡
          setHub flow repositioned, the §5 状态表 无中枢 row: marker +
          EMPTY registry; the own tree stays STANDALONE, the db never
          moves — the §3.1 物理形状, stated so the user is not surprised). */}
      {setHubDialog && (
        <div className={styles.dialogOverlay} role="dialog" aria-modal="true" aria-label="设为研究管理中枢">
          <div className={styles.dialogPanel}>
            <h3 className={styles.dialogTitle}>设为研究管理中枢</h3>
            <p className={styles.dialogCopy}>
              将在本工作区创建 <code>{dirNames.hubDir}/</code> 标记目录与空的{' '}
              <code>registry.yaml</code>，此后本工作区即全局研究管理中枢。
            </p>
            <p className={styles.dialogCopy}>
              本工作区已有的 <code>{dirNames.treeDir}/</code> 研究树保持独立模式：其事件库仍在{' '}
              <code>{dirNames.treeDir}/state/</code> 下（不迁移、不删除），登记项目时再选择接入。
            </p>
            <div className={styles.dialogActions}>
              <button type="button" className={styles.dialogCancel} onClick={() => setSetHubDialog(false)}>
                取消
              </button>
              <button
                type="button"
                className={styles.dialogConfirm}
                disabled={busy}
                onClick={() => void confirmSetHub()}
              >
                {busy ? '处理中…' : '设为中枢'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
