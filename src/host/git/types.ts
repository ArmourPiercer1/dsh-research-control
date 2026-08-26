/**
 * WP-1.2 — Git wrapper: strongly-typed inputs/outputs.
 *
 * Frozen contract: GIT_INTEGRATION.md (Frozen V1) — §1 安全铁律, §3 操作白名单
 * (W1–W13), §5 Save Research Checkpoint 流程, §9 错误分类与处理.
 *
 * Every public function in this layer corresponds to exactly one whitelist row
 * (see index.ts); there is deliberately no generic argv pass-through
 * (INV-GIT-6 argv 数组 API + INV-GIT-7 白名单外不可达).
 */

/** Per-call execution guards (GIT_INTEGRATION §1 rule 9, §9). */
export interface GitOptions {
  /**
   * Kill the command after this many milliseconds (超时即 kill 并按错误处理;
   * §1.9 默认 10s, 可配). No automatic retry of write operations (§9).
   * Default: {@link DEFAULT_GIT_TIMEOUT_MS}.
   */
  timeoutMs?: number
  /**
   * Byte cap on captured stdout and stderr (each stream capped separately);
   * bytes beyond the cap are dropped and the result is marked `truncated`
   * (截断+标记; §1.9 / §9「输出超大」).
   * Default: {@link DEFAULT_GIT_MAX_OUTPUT_BYTES} — 1 MiB. Implementation
   * choice: the frozen doc fixes no number; §9 steers large listings to
   * pagination (`logFile` maxCount/skip) instead of larger caps.
   */
  maxOutputBytes?: number
  /**
   * Explicit path to the git executable. Default: resolved from the current
   * PATH on every call (no cache — PATH changes are observed); resolution
   * failure throws GitMissingError (响亮报错; §2 / §9「git 可执行缺失」).
   */
  gitExecutable?: string
  /**
   * V2 T3.2b (design §3.1 Q4): the configured research-tree directory name
   * (the settings plane's `treeDir`, default `.research`). When present,
   * the W8/W9/W10 pathspecs of THIS call are generated from it (the
   * whitelist constructor is parameterized — whitelist.ts
   * `buildResearchTreeScope`); absent → the frozen V1 default shapes,
   * byte-identical. The production checkpoint/restore/diff face passes the
   * plane's configured name; every pre-V2 caller (and the tests/git suite)
   * omits it.
   */
  treeDir?: string
}

/** GIT_INTEGRATION §1 rule 9: 「所有 Git 调用带超时（默认 10s，可配）」. */
export const DEFAULT_GIT_TIMEOUT_MS = 10_000
/** 1 MiB — see GitOptions.maxOutputBytes. */
export const DEFAULT_GIT_MAX_OUTPUT_BYTES = 1_048_576

/** Raw transport-level result of one whitelisted git invocation. */
export interface GitRunResult {
  exitCode: number
  /** stdout, UTF-8 decoded, truncated at maxOutputBytes. */
  stdout: string
  /** stderr, UTF-8 decoded, truncated at maxOutputBytes (independent counter). */
  stderr: string
  /** true once either stream exceeded the cap (截断+标记). */
  truncated: boolean
}

/** W4 — one entry of `git status --porcelain=v2`. */
export interface StatusEntry {
  kind: 'tracked' | 'renamed' | 'untracked' | 'unmerged'
  /**
   * Index status character (X). v2 语法: unchanged 用 `.` 而非空格表示
   * (git-status(1)): `.M` = 未暂存修改, `M.` = 已暂存, `MM` = 两侧均改.
   */
  x: string
  /** Worktree status character (Y) (同样 `.` = unchanged). */
  y: string
  /** Repo-root-relative path. */
  path: string
  /** Rename/copy source (kind 'renamed' only). */
  origPath?: string
}

/** Parsed `# branch.*` header of `git status --porcelain=v2 --branch`. */
export type GitHead =
  | {
      kind: 'branch'
      name: string
      upstream?: string
      ahead?: number
      behind?: number
    }
  | {
      kind: 'detached'
      oid?: string
    }

/** W4 — parsed `git status --porcelain=v2 [--branch]`. */
export interface GitStatus {
  /** Present only when the branch header was requested (includeBranch). */
  head?: GitHead
  entries: StatusEntry[]
  /** Verbatim porcelain output (as captured, subject to the byte cap). */
  raw: string
  /** Output exceeded maxOutputBytes (截断+标记). */
  truncated: boolean
}

/** W5 — one line of `git diff --name-status`. */
export interface DiffEntry {
  /** Status token as printed: M / A / D / T / R100 / C75 … */
  status: string
  path: string
  /** Rename/copy source. */
  oldPath?: string
}

/** W6 — one line of `git log --format=%H%x1f%aI%x1f%s` (建议格式串, §3 说明). */
export interface FileLogEntry {
  oid: string
  authorDate: string
  subject: string
}

/** §5.1 — the five 「仓库处于进行中操作」 marker files/dirs. */
export interface ConflictFlags {
  /** <gitdir>/MERGE_HEAD — merge 进行中. */
  mergeHead: boolean
  /** <gitdir>/CHERRY_PICK_HEAD — cherry-pick 进行中. */
  cherryPickHead: boolean
  /** <gitdir>/REVERT_HEAD — revert 进行中. */
  revertHead: boolean
  /** <gitdir>/rebase-apply/ — rebase (apply) 进行中. */
  rebaseApply: boolean
  /** <gitdir>/rebase-merge/ — rebase (merge) 进行中. */
  rebaseMerge: boolean
}

/** §5.1 — repository conflict state (checked before every checkpoint). */
export interface ConflictState {
  /** Absolute path of the git dir (W2, resolved against root). */
  gitDir: string
  flags: ConflictFlags
  /** true if any flag is set → 仓库处于进行中操作 (INV-GIT-4, 拒绝 checkpoint). */
  inProgress: boolean
}

/** W1 — repository detection result (§2). */
export type RepoDetection =
  | { ok: true; repoRoot: string }
  | { ok: false; reason: 'not-a-repo' }

/** §5 — result of the checkpoint flow's git half (steps 1–5). */
export interface CheckpointResult {
  /** false only when the flow short-circuited at step 2. */
  committed: boolean
  /** true when nothing under .research/** needed committing (成功空操作, §5 步骤 2). */
  shortCircuited: boolean
  /** commit OID recorded per step 5 (rev-parse HEAD); null when not committed. */
  commitOid: string | null
  /** 明确警告 (§5: detached HEAD 允许但警告). */
  warnings: string[]
}
