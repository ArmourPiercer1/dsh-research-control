/**
 * WP-1.2 — the frozen W1–W13 operation whitelist (GIT_INTEGRATION §3),
 * encoded as the single source of truth for argv validation.
 *
 * 「白名单外命令不可达」 is enforced at two layers:
 *  1. 类型面: index.ts exports only the named operations below — there is no
 *     generic run/exec/spawn export (statically asserted by
 *     tests/git/inv-git-static.test.ts);
 *  2. 运行时: runner.ts calls {@link assertWhitelisted} before every spawn and
 *     throws GitWhitelistViolationError for any argv that does not match one
 *     of these exact shapes (INV-GIT-7).
 *
 * argv shapes are relative to the repo root; the transport layer prepends
 * `-C <root>` (工作目录强制 -C root, never `cwd:`).
 */
import { GitWhitelistViolationError } from './errors.js'

/** W9/W10 pathspec and W8 restore scope (INV-GIT-3 / §6). */
export const RESEARCH_PATHSPEC = '.research/'

/** W6 log 格式串 — 冻结建议 (§3 说明): OID、作者时间、标题, 单元分隔符 \x1f. */
export const LOG_FORMAT_ARG = '--format=%H%x1f%aI%x1f%s'

/**
 * Full 40-hex commit OID. Short OIDs and refs (HEAD, main, HEAD~1) are
 * deliberately rejected: the whitelist is exact, and every commit value the
 * plugin passes (W7/W8) comes from W11 (`rev-parse HEAD`, full OID).
 */
const OID_RE = /^[0-9a-f]{40}$/
const DIGITS_RE = /^[0-9]+$/

/**
 * Repo-root-relative path argument (W3/W6/W8/W13): non-empty, not absolute,
 * not a `..` escape, no NUL, not option-like. The `--` separator in each
 * argv shape is the second line of defense against option smuggling.
 */
function isPathArg(p: string): boolean {
  return (
    p.length > 0 &&
    p !== '..' &&
    !p.startsWith('../') &&
    !p.startsWith('/') &&
    !p.startsWith('-') &&
    !p.includes('\0')
  )
}

/** W8 scope: restore 仅 .research/** (§6「.research/ 目录外的路径不允许通过本插件 restore」). */
function isUnderResearch(p: string): boolean {
  return p === RESEARCH_PATHSPEC || p.startsWith(RESEARCH_PATHSPEC)
}

export interface WhitelistRow {
  /** W1 … W13 (GIT_INTEGRATION §3 表). */
  id: string
  /** 用途 (§3 表「用途」列). */
  operation: string
  /** 触发 (§3 表「触发」列: 自动 / 用户). */
  trigger: 'auto' | 'user'
  /** Representative argv (相对 repo 根, 不含 -C; 占位符用 <…>). */
  argv: string[]
  /** Exact-shape matcher — the only runtime gate before spawn. */
  match: (argv: readonly string[]) => boolean
}

const is = (a: readonly string[], i: number, v: string): boolean => a[i] === v

export const WHITELIST_ROWS: readonly WhitelistRow[] = [
  {
    id: 'W1',
    operation: '仓库检测',
    trigger: 'auto',
    argv: ['rev-parse', '--show-toplevel'],
    match: (a) => a.length === 2 && is(a, 0, 'rev-parse') && is(a, 1, '--show-toplevel'),
  },
  {
    id: 'W2',
    operation: 'git dir 定位',
    trigger: 'auto',
    argv: ['rev-parse', '--git-dir'],
    match: (a) => a.length === 2 && is(a, 0, 'rev-parse') && is(a, 1, '--git-dir'),
  },
  {
    id: 'W3',
    operation: 'blob OID 计算',
    trigger: 'auto',
    argv: ['hash-object', '--', '<path>'],
    match: (a) => a.length === 3 && is(a, 0, 'hash-object') && is(a, 1, '--') && isPathArg(a[2]!),
  },
  {
    id: 'W4',
    operation: '工作区状态',
    trigger: 'auto',
    argv: ['status', '--porcelain=v2', '[--branch]'],
    match: (a) =>
      is(a, 0, 'status') &&
      is(a, 1, '--porcelain=v2') &&
      (a.length === 2 || (a.length === 3 && is(a, 2, '--branch'))),
  },
  {
    id: 'W5',
    operation: '变更清单',
    trigger: 'auto',
    argv: ['diff', '--name-status', '[<baseline-oid>]'],
    match: (a) =>
      is(a, 0, 'diff') &&
      is(a, 1, '--name-status') &&
      (a.length === 2 || (a.length === 3 && OID_RE.test(a[2]!))),
  },
  {
    id: 'W6',
    operation: '文件历史',
    trigger: 'user',
    argv: ['log', LOG_FORMAT_ARG, '[-n <count>]', '[--skip <n>]', '--', '<path>'],
    match: (a) => {
      if (!is(a, 0, 'log') || !is(a, 1, LOG_FORMAT_ARG)) return false
      let i = 2
      if (is(a, i, '-n')) {
        if (!DIGITS_RE.test(a[i + 1] ?? '')) return false
        i += 2
      }
      if (is(a, i, '--skip')) {
        if (!DIGITS_RE.test(a[i + 1] ?? '')) return false
        i += 2
      }
      return is(a, i, '--') && i + 2 === a.length && isPathArg(a[i + 1]!)
    },
  },
  {
    id: 'W7',
    operation: '历史版本内容',
    trigger: 'user',
    argv: ['show', '<commit-oid>:<path>'],
    match: (a) => {
      if (a.length !== 2 || !is(a, 0, 'show')) return false
      const ref = a[1]!
      const i = ref.indexOf(':')
      return i > 0 && OID_RE.test(ref.slice(0, i)) && isPathArg(ref.slice(i + 1))
    },
  },
  {
    id: 'W8',
    operation: '恢复文件',
    trigger: 'user',
    argv: ['restore', '--source=<commit-oid>', '--', '.research/<path>'],
    match: (a) =>
      a.length === 4 &&
      is(a, 0, 'restore') &&
      typeof a[1] === 'string' &&
      a[1]!.startsWith('--source=') &&
      OID_RE.test(a[1]!.slice('--source='.length)) &&
      is(a, 2, '--') &&
      isPathArg(a[3]!) &&
      isUnderResearch(a[3]!),
  },
  {
    id: 'W9',
    operation: '暂存',
    trigger: 'user',
    argv: ['add', '--', RESEARCH_PATHSPEC],
    match: (a) => a.length === 3 && is(a, 0, 'add') && is(a, 1, '--') && is(a, 2, RESEARCH_PATHSPEC),
  },
  {
    id: 'W10',
    operation: '检查点提交',
    trigger: 'user',
    argv: ['commit', '-m', '<research: summary>', '--', RESEARCH_PATHSPEC],
    match: (a) =>
      a.length === 5 &&
      is(a, 0, 'commit') &&
      is(a, 1, '-m') &&
      typeof a[2] === 'string' &&
      a[2]!.length > 0 &&
      !a[2]!.includes('\0') &&
      is(a, 3, '--') &&
      is(a, 4, RESEARCH_PATHSPEC),
  },
  {
    id: 'W11',
    operation: '取提交 OID',
    trigger: 'user',
    argv: ['rev-parse', 'HEAD'],
    match: (a) => a.length === 2 && is(a, 0, 'rev-parse') && is(a, 1, 'HEAD'),
  },
  {
    id: 'W12',
    operation: '显式初始化',
    trigger: 'user',
    argv: ['init'],
    match: (a) => a.length === 1 && is(a, 0, 'init'),
  },
  {
    id: 'W13',
    operation: '枚举 tracked 文件',
    trigger: 'auto',
    argv: ['ls-files', '--', '<pathspec>'],
    match: (a) => a.length === 3 && is(a, 0, 'ls-files') && is(a, 1, '--') && isPathArg(a[2]!),
  },
]

/**
 * 运行时护栏 (INV-GIT-7): argv must match exactly one whitelist row;
 * anything else throws GitWhitelistViolationError before a process is
 * spawned. Returns the matched row for observability.
 */
export function assertWhitelisted(argv: readonly string[]): WhitelistRow {
  for (const row of WHITELIST_ROWS) {
    if (row.match(argv)) return row
  }
  throw new GitWhitelistViolationError([...argv])
}
