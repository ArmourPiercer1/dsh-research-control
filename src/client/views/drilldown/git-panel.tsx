/**
 * WP-4.6 — checkpoint / Git restore panel (container).
 *
 * TC-E2E-010 「merge contract 从 Git 历史恢复到 working copy」: the
 * user-visible restore flow —
 *   1. the panel lists the merge-contract files of the page's topic
 *      (`getTopic` `mergeContracts` — the badges' full path form) and,
 *      per file, its Git version list (`getGitHistory {path, maxCount}` —
 *      W6, newest first);
 *   2. the verdict slice (`getGitHistory {path, baseline: newestOid}`)
 *      shows the working copy vs the newest commit (`pathContent
 *      .sameAsBaseline` — the single-file content verdict);
 *   3. 「恢复到该版本」per version row → `restoreDeclarativeFile`
 *      (W6/W7/W8 + post-restore validation — the service rewrites the
 *      working copy from the commit); the WP-4.1b invalidate registry
 *      refetches the cached `gitHistory:*` windows, so the verdict flips
 *      to 「与基线一致」 in the GUI (the host also re-validates the tree —
 *      `validationOk` surfaces in the result note).
 *
 * The panel is the GUI seat of the `restoreDeclarativeFile` RPC (the 13
 * frozen face) — no second versioning system is introduced (AC-13): Git
 * is the only source of file history.
 */

import { useMemo, useState, type ReactElement } from 'react'

import type { GetGitHistoryResult, TopicSnapshot } from '../../../shared/rpc-contracts.js'
import type { ResearchStore, SliceState, WorkstreamSnapshot } from '../../stores/index.js'
import { useGitHistorySlice, useTopicSlice, useWsSlice } from './binding-hooks.js'
import styles from './cockpit.module.css'

/**
 * The DTO `path` is `.research`-ROOT-relative (loader `contractRelPaths`,
 * e.g. `merges/TE-2/contract.md`); the git services (`getGitHistory` /
 * `restoreDeclarativeFile`) take REPO-ROOT-relative paths scoped to
 * `.research/**` (GIT_INTEGRATION §3 / `assertResearchPath`). The mapping
 * is the panel's only path translation — the displayed path is the
 * repo-root-relative form (the git vocabulary the user sees in the W6/W8
 * results).
 */
function toRepoPath(path: string): string {
  return path.startsWith('.research/') ? path : `.research/${path}`
}

/** One merge-contract file: versions + verdict + restore buttons. */
function ContractFilePanel({ store, path }: { store: ResearchStore; path: string }): ReactElement {
  const repoPath = useMemo(() => toRepoPath(path), [path])
  const baseArgs = useMemo(() => ({ path: repoPath, maxCount: 10 }), [repoPath])
  const base: SliceState<GetGitHistoryResult> = useGitHistorySlice(store, baseArgs)

  const newestOid = base.data?.versions[0]?.oid
  // Unconditional second hook: before the first window lands the verdict
  // args carry no baseline (the host returns `pathContent: null`); once
  // the newest version is known the same hook reads the verdict window.
  const verdictArgs = useMemo(
    () => (newestOid !== undefined ? { path: repoPath, baseline: newestOid, maxCount: 1 } : { path: repoPath, maxCount: 1 }),
    [repoPath, newestOid],
  )
  const verdict: SliceState<GetGitHistoryResult> = useGitHistorySlice(store, verdictArgs)

  const [busy, setBusy] = useState(false)
  const [fault, setFault] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<string | null>(null)

  const sameAsBaseline = verdict.data?.pathContent?.sameAsBaseline ?? null

  function handleRestore(commitOid: string): void {
    if (busy) return
    setFault(null)
    setLastResult(null)
    setBusy(true)
    void store
      .restoreDeclarativeFile({ commitOid, path: repoPath })
      .then((result) => {
        const problems = result.validationErrors.map((e) => e.summary).join('；')
        setLastResult(
          `已恢复 ${repoPath}（源 ${commitOid.slice(0, 8)}）— 树校验${
            result.validationOk ? '通过' : '未通过：' + problems
          }${result.warnings.length > 0 ? ` · 警告：${result.warnings.join('；')}` : ''}`,
        )
        setBusy(false)
      })
      .catch((err: unknown) => {
        setBusy(false)
        setFault(err instanceof Error ? err.message : String(err))
      })
  }

  return (
    <div className={styles.contractPanel} data-contract-path={repoPath}>
      <p className={styles.contractPath}>{repoPath}</p>
      <p className={styles.contractVerdict} data-contract-same={repoPath} data-same={String(sameAsBaseline)}>
        {sameAsBaseline === null
          ? '基线判定加载中…'
          : sameAsBaseline
            ? '工作副本与最新提交一致'
            : '工作副本与最新提交不一致（可恢复）'}
      </p>
      {lastResult !== null && (
        <p className={styles.restoreResult} role="status" data-role="restore-result">
          {lastResult}
        </p>
      )}
      {fault !== null && (
        <p className={styles.faultNote} role="alert">
          {fault}
        </p>
      )}
      {base.data === null ? (
        <p className={styles.empty}>版本列表加载中…</p>
      ) : base.data.versions.length === 0 ? (
        <p className={styles.empty}>该文件无 Git 版本</p>
      ) : (
        <ul className={styles.versionList}>
          {base.data.versions.map((v) => (
            <li key={v.oid} className={styles.versionRow} data-version-oid={v.oid}>
              <span className={styles.versionOid}>{v.oid.slice(0, 8)}</span>
              <span className={styles.versionSubject}>{v.subject}</span>
              <span className={styles.versionDate}>{v.authorDate}</span>
              <button
                type="button"
                className={styles.restoreButton}
                data-restore-path={repoPath}
                data-restore-oid={v.oid}
                disabled={busy}
                onClick={() => handleRestore(v.oid)}
              >
                恢复到该版本
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export interface GitPanelProps {
  readonly store: ResearchStore
  readonly workstreamId: string
}

/**
 * Render the checkpoint/Git panel for one workstream page.
 * @param props - the store handle + the page workstream.
 * @returns the panel element (per-contract version + restore faces).
 */
export function GitPanel({ store, workstreamId }: GitPanelProps): ReactElement {
  const ws: SliceState<WorkstreamSnapshot> = useWsSlice(store, workstreamId)
  const topicId = ws.data?.workstream.topicId
  // The '' sentinel keeps the hook unconditional without a fake request
  // until the workstream slice (and hence the topic id) has landed.
  const topic: SliceState<TopicSnapshot> = useTopicSlice(store, topicId ?? '')

  if (topicId === undefined) {
    return (
      <section className={styles.gitPanel} aria-label="Checkpoint / Git">
        <h2 className={styles.sectionTitle}>Checkpoint / Git（merge contract 恢复）</h2>
        <p className={styles.empty}>加载中…</p>
      </section>
    )
  }

  const contracts = topic.data?.mergeContracts ?? []

  return (
    <section className={styles.gitPanel} aria-label="Checkpoint / Git">
      <h2 className={styles.sectionTitle}>Checkpoint / Git（merge contract 恢复）</h2>
      {contracts.length === 0 ? (
        <p className={styles.empty}>
          {topic.data === null ? '加载中…' : '该主题无 merge contract 文件'}
        </p>
      ) : (
        contracts.map((mc) => <ContractFilePanel key={mc.path} store={store} path={mc.path} />)
      )}
    </section>
  )
}
