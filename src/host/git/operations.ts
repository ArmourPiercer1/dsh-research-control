/**
 * WP-1.2 — Git wrapper: the named W1–W13 operations.
 *
 * Each exported function corresponds to exactly one row of the frozen
 * whitelist (GIT_INTEGRATION §3) with strongly-typed inputs/outputs. No
 * other git subcommand is reachable from this layer (INV-GIT-7).
 *
 * This layer does NO domain logic (ARCHITECTURE §2.2): no .research/ content
 * is parsed or schema-validated, no ManagementAction is written — checkpoint
 * service policy is WP-1.5.
 */
import { existsSync, statSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { GitCommandError, GitInputError, GitScopeViolationError } from './errors.js'
import { runGit } from './runner.js'
import { LOG_FORMAT_ARG, RESEARCH_PATHSPEC, RESEARCH_STATE_EXCLUDE_SPEC } from './whitelist.js'
import type {
  DiffEntry,
  FileLogEntry,
  GitHead,
  GitOptions,
  GitStatus,
  RepoDetection,
  StatusEntry,
} from './types.js'

/** §5: commit message 格式 for the only write-history operation (W10). */
export const CHECKPOINT_MESSAGE_PREFIX = 'research: '

const OID_RE = /^[0-9a-f]{40}$/

function withC(root: string, argv: readonly string[]): string[] {
  return ['-C', root, ...argv]
}

function assertRepoRelativePath(p: string, op: string): string {
  if (typeof p !== 'string' || p.length === 0) {
    throw new GitInputError(`${op}: path must be a non-empty string`)
  }
  if (p === '..' || p.startsWith('../') || p.startsWith('/') || p.includes('\0')) {
    // §3 说明: W7/W8 的 <path> 必须是相对 repo 根的路径 (.research/…);
    // workspace root ≠ repo root 时前缀换算由插件负责。
    throw new GitInputError(
      `${op}: path must be repo-root-relative (GIT_INTEGRATION §3 说明), got: ${p}`,
    )
  }
  return p
}

function assertOid(oid: string, op: string): string {
  if (typeof oid !== 'string' || !OID_RE.test(oid)) {
    throw new GitInputError(`${op}: expected a full 40-hex commit OID, got: ${String(oid)}`)
  }
  return oid
}

function commandFailed(
  root: string,
  argv: readonly string[],
  res: { exitCode: number; stdout: string; stderr: string },
): never {
  // §9「repo 损坏（git 自身报错）→ 原样展示 git 错误；插件不尝试修复」
  throw new GitCommandError(withC(root, argv), res.exitCode, res.stdout, res.stderr)
}

// ─────────────────────────── W1 仓库检测 ───────────────────────────

/** W1 (§2): `git -C <candidate> rev-parse --show-toplevel`. exit≠0 → 不是 Git repo. */
export async function detectRepo(candidateRoot: string, opts?: GitOptions): Promise<RepoDetection> {
  const argv = ['rev-parse', '--show-toplevel']
  const res = await runGit(candidateRoot, argv, opts)
  if (res.exitCode !== 0) return { ok: false, reason: 'not-a-repo' }
  return { ok: true, repoRoot: res.stdout.trim() }
}

// ─────────────────────────── W2 git dir 定位 ───────────────────────────

/** W2 (§5.1 前置): `git rev-parse --git-dir`, returned absolute (resolved against root). */
export async function resolveGitDir(root: string, opts?: GitOptions): Promise<string> {
  const argv = ['rev-parse', '--git-dir']
  const res = await runGit(root, argv, opts)
  if (res.exitCode !== 0) commandFailed(root, argv, res)
  const raw = res.stdout.trim()
  return isAbsolute(raw) ? raw : join(root, raw)
}

// ─────────────────────────── W3 blob OID 计算 ───────────────────────────

/**
 * W3 (§7): `git hash-object -- <path>` — 对 working copy 内容计算 Git blob
 * OID，无需 commit → stale 检测不依赖用户 commit 频率 (PLAN_FORK_SPEC §3/§5).
 */
export async function hashObject(root: string, filePath: string, opts?: GitOptions): Promise<string> {
  const p = assertRepoRelativePath(filePath, 'hashObject')
  const argv = ['hash-object', '--', p]
  const res = await runGit(root, argv, opts)
  if (res.exitCode !== 0) commandFailed(root, argv, res)
  return res.stdout.trim()
}

// ─────────────────────────── W4 工作区状态 ───────────────────────────

export interface StatusCallOptions extends GitOptions {
  /**
   * Include the `# branch.*` header (default true — §9 detached-HEAD 检测
   * uses `branch.head (detached)`).
   */
  includeBranch?: boolean
}

/** W4 (§8 audit / checkpoint 前置): `git status --porcelain=v2 [--branch]`. */
export async function status(root: string, opts?: StatusCallOptions): Promise<GitStatus> {
  const argv: string[] = ['status', '--porcelain=v2']
  if (opts?.includeBranch ?? true) argv.push('--branch')
  const res = await runGit(root, argv, opts)
  if (res.exitCode !== 0) commandFailed(root, argv, res)
  const { head, entries } = parsePorcelainV2(res.stdout)
  return { head, entries, raw: res.stdout, truncated: res.truncated }
}

/**
 * Parse `git status --porcelain=v2 [--branch]`.
 *
 * Line grammar (git-status(1), verified against git 2.53 output):
 *   1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
 *   2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>\t<origPath>
 *   u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <hI> <path>
 *   ? <path>
 * Forward-compatible: the path is always the LAST token (quoted paths
 * contain no raw spaces), rename lines carry a tab between path/origPath;
 * unknown lines (`# …` comments, `header …` extensions) are skipped — raw
 * is kept verbatim in the result.
 */
export function parsePorcelainV2(raw: string): { head?: GitHead; entries: StatusEntry[] } {
  let head: GitHead | undefined
  // `# branch.oid` can precede `# branch.head` (detached case) — order
  // independent attachment.
  let branchOid: string | undefined
  const entries: StatusEntry[] = []
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue
    if (line.startsWith('# branch.oid ')) {
      const v = line.slice('# branch.oid '.length)
      if (/^[0-9a-f]{40}$/.test(v)) {
        branchOid = v
        if (head?.kind === 'detached') head.oid = v
      }
    } else if (line.startsWith('# branch.head ')) {
      const v = line.slice('# branch.head '.length)
      head = v === '(detached)' ? { kind: 'detached', oid: branchOid } : { kind: 'branch', name: v }
    } else if (line.startsWith('# branch.upstream ')) {
      if (head?.kind === 'branch') head.upstream = line.slice('# branch.upstream '.length)
    } else if (line.startsWith('# branch.ab ')) {
      const m = /^\+(-?\d+) -(-?\d+)$/.exec(line.slice('# branch.ab '.length))
      if (m && head?.kind === 'branch') {
        head.ahead = Number(m[1])
        head.behind = Number(m[2])
      }
    } else if (line.startsWith('1 ') || line.startsWith('u ')) {
      const parts = line.slice(2).split(' ')
      const xy = parts[0] ?? ''
      entries.push({
        kind: line.startsWith('u ') ? 'unmerged' : 'tracked',
        x: xy.slice(0, 1),
        y: xy.slice(1, 2),
        path: unquotePath(parts[parts.length - 1] ?? ''),
      })
    } else if (line.startsWith('2 ')) {
      const parts = line.slice(2).split(' ')
      const xy = parts[0] ?? ''
      const last = parts[parts.length - 1] ?? ''
      const sep = last.indexOf('\t')
      const [path, origPath] = sep >= 0 ? [last.slice(0, sep), last.slice(sep + 1)] : [last, '']
      entries.push({
        kind: 'renamed',
        x: xy.slice(0, 1),
        y: xy.slice(1, 2),
        path: unquotePath(path),
        origPath: unquotePath(origPath),
      })
    } else if (line.startsWith('? ')) {
      entries.push({ kind: 'untracked', x: '', y: '', path: unquotePath(line.slice(2)) })
    }
    // anything else: header/comment line — skip, raw preserved.
  }
  return { head, entries }
}

/** Unquote a C-quoted path from git output (core.quotePath). */
export function unquotePath(p: string): string {
  if (p.length < 2 || !p.startsWith('"') || !p.endsWith('"')) return p
  const inner = p.slice(1, -1)
  let out = ''
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]!
    if (c !== '\\') {
      out += c
      continue
    }
    const n = inner[++i]
    if (n === undefined) {
      out += c
      break
    }
    if (n === 't') out += '\t'
    else if (n === 'n') out += '\n'
    else if (n === 'r') out += '\r'
    else if (n === '"' || n === '\\') out += n
    else if (n >= '0' && n <= '7') {
      let digits = n
      while (digits.length < 3 && inner[i + 1] >= '0' && inner[i + 1] <= '7') digits += inner[++i]!
      out += String.fromCharCode(parseInt(digits, 8))
    } else out += n
  }
  return out
}

// ─────────────────────────── W5 变更清单 ───────────────────────────

/** W5 (§8 audit): `git diff --name-status [<baseline>]` (baseline: 40-hex OID). */
export async function diffNameStatus(
  root: string,
  baseline?: string,
  opts?: GitOptions,
): Promise<DiffEntry[]> {
  const argv: string[] = ['diff', '--name-status']
  if (baseline !== undefined) argv.push(assertOid(baseline, 'diffNameStatus'))
  const res = await runGit(root, argv, opts)
  if (res.exitCode !== 0) commandFailed(root, argv, res)
  const out: DiffEntry[] = []
  for (const line of res.stdout.split('\n')) {
    if (line.length === 0) continue
    const parts = line.split('\t')
    if (parts.length >= 3 && /^[RC]/.test(parts[0]!)) {
      out.push({ status: parts[0]!, oldPath: unquotePath(parts[1]!), path: unquotePath(parts[2]!) })
    } else if (parts.length === 2) {
      out.push({ status: parts[0]!, path: unquotePath(parts[1]!) })
    }
  }
  return out
}

// ─────────────────────────── W6 文件历史 ───────────────────────────

export interface LogCallOptions extends GitOptions {
  /** Max entries (`-n <count>`; §9 分页读取 for large listings). */
  maxCount?: number
  /** Skip the newest N entries (`--skip <n>`; §9 分页读取). */
  skip?: number
}

/** W6 (§6 查看): `git log --format=%H%x1f%aI%x1f%s [--] <path>` (建议格式串, §3 说明). */
export async function logFile(
  root: string,
  filePath: string,
  opts?: LogCallOptions,
): Promise<FileLogEntry[]> {
  const p = assertRepoRelativePath(filePath, 'logFile')
  const argv: string[] = ['log', LOG_FORMAT_ARG]
  if (opts?.maxCount !== undefined) {
    if (!Number.isInteger(opts.maxCount) || opts.maxCount < 0) {
      throw new GitInputError('logFile: maxCount must be a non-negative integer')
    }
    argv.push('-n', String(opts.maxCount))
  }
  if (opts?.skip !== undefined) {
    if (!Number.isInteger(opts.skip) || opts.skip < 0) {
      throw new GitInputError('logFile: skip must be a non-negative integer')
    }
    argv.push('--skip', String(opts.skip))
  }
  argv.push('--', p)
  const res = await runGit(root, argv, opts)
  if (res.exitCode !== 0) commandFailed(root, argv, res)
  const out: FileLogEntry[] = []
  for (const line of res.stdout.split('\n')) {
    if (line.length === 0) continue
    const parts = line.split('\x1f')
    if (parts.length < 2) continue
    out.push({ oid: parts[0]!, authorDate: parts[1]!, subject: parts.slice(2).join('\x1f') })
  }
  return out
}

// ─────────────────────────── W7 历史版本内容 ───────────────────────────

/** W7 (§6 查看): `git show <commit>:<path>` (path 相对 repo 根, §3 说明). */
export async function showFile(
  root: string,
  commit: string,
  filePath: string,
  opts?: GitOptions,
): Promise<string> {
  const c = assertOid(commit, 'showFile')
  const p = assertRepoRelativePath(filePath, 'showFile')
  const argv = ['show', `${c}:${p}`]
  const res = await runGit(root, argv, opts)
  if (res.exitCode !== 0) commandFailed(root, argv, res)
  // .research/ 声明式文件是文本; 返回逐字节 UTF-8 解码内容。
  return res.stdout
}

// ─────────────────────────── W8 恢复文件 ───────────────────────────

/**
 * W8 (§6, **用户**显式触发): `git restore --source=<commit> -- <path>`.
 *
 * 边界: 仅 `.research/**` (§6「.research/ 目录外的路径不允许通过本插件
 * restore」) — 越界抛 GitScopeViolationError, 在到达 transport 之前拒绝。
 * 恢复产生新的 working copy 状态, 不修改旧 commit、不产生新 commit
 * (INV-GIT-5; 提交与否由用户随后决定).
 */
export async function restoreFile(
  root: string,
  commit: string,
  filePath: string,
  opts?: GitOptions,
): Promise<void> {
  if (!filePath.startsWith(RESEARCH_PATHSPEC)) {
    throw new GitScopeViolationError(filePath)
  }
  const c = assertOid(commit, 'restoreFile')
  const p = assertRepoRelativePath(filePath, 'restoreFile')
  const argv = ['restore', `--source=${c}`, '--', p]
  const res = await runGit(root, argv, opts)
  if (res.exitCode !== 0) commandFailed(root, argv, res)
}

// ─────────────────────────── W9 暂存 ───────────────────────────

/**
 * W9 (checkpoint 第一步, **用户**): `git add -- .research/
 * ':(exclude).research/state/'` — pathspec 由白名单固定, 其他 pathspec
 * 不可达 (INV-GIT-3 路径隔离). V2 (design §3.3): 排除项 = state/ 状态区
 * (独立模式库目录, checkpoint 提交白名单之外, 永不入 commit).
 */
export async function stageResearch(root: string, opts?: GitOptions): Promise<void> {
  const argv = ['add', '--', RESEARCH_PATHSPEC, RESEARCH_STATE_EXCLUDE_SPEC]
  const res = await runGit(root, argv, opts)
  if (res.exitCode !== 0) commandFailed(root, argv, res)
}

// ─────────────────────────── W10 检查点提交 ───────────────────────────

/**
 * W10 (checkpoint 第二步, **用户**): `git commit -m <msg> -- .research/
 * ':(exclude).research/state/'` — pathspec 限定提交范围 (§5). 实测语义
 * (§5.2, 2026-08-21, TC-GIT-002 固化): 无关 staged 变更未进入 commit 且
 * 事后仍保持 staged. V2 (design §3.3): 排除项与 W9 一致 — state/ 状态区
 * 永不入 commit (提交白名单之外的子目录).
 *
 * 提交者身份使用用户自己的 git config — 本层不覆盖 author/committer (§5).
 *
 * @param message must start with `research: ` (§5 commit message 格式).
 */
export async function commitResearch(root: string, message: string, opts?: GitOptions): Promise<void> {
  if (typeof message !== 'string' || message.length === 0 || message.includes('\0')) {
    throw new GitInputError('commitResearch: commit message must be a non-empty string')
  }
  if (!message.startsWith(CHECKPOINT_MESSAGE_PREFIX)) {
    throw new GitInputError(
      `commitResearch: commit message must start with ${JSON.stringify(CHECKPOINT_MESSAGE_PREFIX)} (GIT_INTEGRATION §5), got: ${JSON.stringify(message.slice(0, 40))}`,
    )
  }
  const argv = ['commit', '-m', message, '--', RESEARCH_PATHSPEC, RESEARCH_STATE_EXCLUDE_SPEC]
  const res = await runGit(root, argv, opts)
  if (res.exitCode !== 0) commandFailed(root, argv, res)
}

// ─────────────────────────── W11 取提交 OID ───────────────────────────

/** W11 (checkpoint 第三步, **用户**): `git rev-parse HEAD` → 记录 commit OID. */
export async function revParseHead(root: string, opts?: GitOptions): Promise<string> {
  const argv = ['rev-parse', 'HEAD']
  const res = await runGit(root, argv, opts)
  if (res.exitCode !== 0) commandFailed(root, argv, res)
  return res.stdout.trim()
}

// ─────────────────────────── W12 显式初始化 ───────────────────────────

/**
 * W12 (§2, **用户**确认对话框): `git init` — 非 repo 目录的用户显式选择。
 * 自动路径永不调用本函数 (INV-GIT-1; TC-GIT-017 静态+行为断言)。
 *
 * The target directory must already exist — this wrapper never creates user
 * directories.
 */
export async function initRepo(targetDir: string, opts?: GitOptions): Promise<string> {
  if (typeof targetDir !== 'string' || targetDir.length === 0) {
    throw new GitInputError('initRepo: target directory must be a non-empty path')
  }
  if (!existsSync(targetDir) || !statSync(targetDir).isDirectory()) {
    throw new GitInputError(
      `initRepo: directory does not exist: ${targetDir} (git init is never used to create directories)`,
    )
  }
  const argv = ['init']
  const res = await runGit(targetDir, argv, opts)
  if (res.exitCode !== 0) commandFailed(targetDir, argv, res)
  return targetDir
}

// ─────────────────────────── W13 枚举 tracked 文件 ───────────────────────────

/** W13 (§8 audit, Phase 6): `git ls-files -- <pathspec>` — strict tracked 路径集. */
export async function lsFiles(root: string, pathspec: string, opts?: GitOptions): Promise<string[]> {
  const p = assertRepoRelativePath(pathspec, 'lsFiles')
  const argv = ['ls-files', '--', p]
  const res = await runGit(root, argv, opts)
  if (res.exitCode !== 0) commandFailed(root, argv, res)
  return res.stdout
    .split('\n')
    .filter((l) => l.length > 0)
    .map(unquotePath)
}
