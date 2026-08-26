/**
 * WP-1.2 — the frozen W1–W13 operation whitelist (GIT_INTEGRATION §3),
 * encoded as the single source of truth for argv validation.
 *
 * 「白名单外命令不可达」 is enforced at two layers:
 *  1. 类型面: index.ts exports only the named operations below — there is no
 *     generic run/exec/spawn export (statically asserted by
 *     tests/git/inv-git-static.test.ts);
 *  2. 运行时: runner.ts calls the scope-bound `assertWhitelisted` before
 *     every spawn and throws GitWhitelistViolationError for any argv that
 *     does not match one of these exact shapes (INV-GIT-7).
 *
 * argv shapes are relative to the repo root; the transport layer prepends
 * `-C <root>` (工作目录强制 -C root, never `cwd:`).
 *
 * V2 (design §3.1 Q4: the tree directory name is CONFIGURABLE through the
 * DSH settings plane, 「发现逻辑只认配置后的名字」) — the W9/W10 commit
 * pathspecs (and the W8 restore scope) are NO LONGER a hardcoded `.research`
 * literal: the WHITELIST CONSTRUCTOR is parameterized over the tree
 * directory name ({@link buildResearchTreeScope} / {@link
 * buildWhitelistRows}), and every git call carries the configured name
 * through {@link GitOptions.treeDir} (absent = the frozen default
 * `.research`). At the default the argv is BYTE-IDENTICAL to the V1
 * frozen shapes (tests/git pin that: zero changes pass), and the
 * checkpoint flow under a renamed tree commits exactly the renamed
 * directory (tests/git/t32-git-scope.test.ts).
 */
import { GitInputError, GitWhitelistViolationError } from './errors.js'

/** The frozen DEFAULT tree directory name (the V1 literal, the settings
 *  domain's own default — T2.1 `DEFAULT_PROJECT_TREE_DIR`). */
export const DEFAULT_TREE_DIR = '.research'

/** W6 log 格式串 — 冻结建议 (§3 说明): OID、作者时间、标题, 单元分隔符 \x1f.
 *  声明必须先于模块级 {@link DEFAULT_RESEARCH_TREE_SCOPE} 求值(W6 行在
 *  导入期构造时引用它)。 */
export const LOG_FORMAT_ARG = '--format=%H%x1f%aI%x1f%s'

/**
 * V2 (design §3.3): the STANDALONE state sub-directory — the runtime
 * database area (`<treeDir>/state/research.sqlite`). 状态区，不入声明树
 * 语义: it is OUTSIDE the checkpoint commit scope (the W9/W10 pathspec
 * excludes it explicitly, see {@link ResearchTreeScope.stateExcludeSpec}).
 */
const RESEARCH_STATE_EXCLUDE_SUFFIX = ':(exclude)'

/**
 * The research-tree SCOPE of one git call plane: the directory name and
 * every pathspec derived from it (the W9/W10 commit pathspecs, the W8
 * restore scope predicate, the commit-scope predicate) + the whitelist
 * ROWS built for that name + the scope-bound argv validator.
 *
 * The frozen default scope ({@link DEFAULT_RESEARCH_TREE_SCOPE}) is the
 * V1 `.research` face, byte-identical; a production plane built over a
 * renamed tree (T2.1 settings → the dsh-adapter's `getResearchDirNames`)
 * carries its own scope through {@link GitOptions.treeDir}.
 */
export interface ResearchTreeScope {
  /** The configured tree directory name (a bare segment). */
  readonly treeDir: string
  /** The W9/W10 commit pathspec: `<treeDir>/`. */
  readonly pathspec: string
  /** The state sub-directory pathspec: `<treeDir>/state/`. */
  readonly statePathspec: string
  /** The W9/W10 exclude token: `:(exclude)<treeDir>/state/`. */
  readonly stateExcludeSpec: string
  /** The W1–W13 rows built for this scope (W8/W9/W10 name-aware). */
  readonly rows: readonly WhitelistRow[]
  /** The scope-bound runtime gate (INV-GIT-7): throws GitWhitelistViolationError. */
  assertWhitelisted(argv: readonly string[]): WhitelistRow
  /** Whether a repo-root-relative path is inside the COMMIT scope. */
  isWithinCommitScope(p: string): boolean
  /** Whether a repo-root-relative path is under the tree (W8 restore scope). */
  isUnderResearch(p: string): boolean
}

/**
 * The commit-scope predicate over one scope: under `<treeDir>/` and NOT
 * under the state/ sub-directory ({@link ResearchTreeScope.statePathspec}).
 *
 * The unbind-rename'd ARCHIVED tree (`<treeDir>.archived-<timestamp>/`,
 * design §7.4 解绑) is out of scope by construction: the commit pathspec
 * is the exact directory prefix `<treeDir>/`, not a name glob — git's
 * pathspec `<treeDir>/` matches only paths beneath that directory, never
 * a sibling entry that merely shares the name prefix. This predicate
 * mirrors that rule for the checkpoint's status filtering (「无可提交内容」
 * short-circuit) and the service-layer changedFiles/leftover checks, so
 * the whole commit flow sees exactly what W9/W10 will stage/commit.
 */
export function isWithinCommitScopeFor(scope: ResearchTreeScope, p: string): boolean {
  if (typeof p !== 'string') return false
  if (!p.startsWith(scope.pathspec)) return false
  if (p.startsWith(scope.statePathspec)) return false
  return true
}

/**
 * Build the W1–W13 whitelist rows for ONE tree directory name — the
 * parameterized constructor (V2 T3.2b: the W9/W10 pathspecs + the W8
 * restore scope are generated from `treeDir`; the other 10 rows are
 * name-independent and byte-identical across scopes).
 *
 * @throws {GitInputError} when `treeDir` is not a bare directory name.
 */
export function buildWhitelistRows(treeDir: string): readonly WhitelistRow[] {
  assertTreeDir(treeDir)
  const pathspec = `${treeDir}/`
  const statePathspec = `${treeDir}/state/`
  const stateExcludeSpec = `${RESEARCH_STATE_EXCLUDE_SUFFIX}${statePathspec}`
  const isUnderResearch = (p: string): boolean => p === pathspec || p.startsWith(pathspec)
  return [
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
      argv: ['restore', '--source=<commit-oid>', '--', `${treeDir}/<path>`],
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
      // V2 (design §3.3): the state/ sub-directory is excluded from the
      // commit scope (the runtime database area, never declarative content);
      // T3.2b: the pathspecs are generated from the configured tree name.
      argv: ['add', '--', pathspec, stateExcludeSpec],
      match: (a) =>
        a.length === 4 &&
        is(a, 0, 'add') &&
        is(a, 1, '--') &&
        is(a, 2, pathspec) &&
        is(a, 3, stateExcludeSpec),
    },
    {
      id: 'W10',
      operation: '检查点提交',
      trigger: 'user',
      // V2 (design §3.3): same state/ exclusion — a pathspec-limited commit
      // must commit exactly what W9 staged, no more (no state/), no less.
      argv: ['commit', '-m', '<research: summary>', '--', pathspec, stateExcludeSpec],
      match: (a) =>
        a.length === 6 &&
        is(a, 0, 'commit') &&
        is(a, 1, '-m') &&
        typeof a[2] === 'string' &&
        a[2]!.length > 0 &&
        !a[2]!.includes('\0') &&
        is(a, 3, '--') &&
        is(a, 4, pathspec) &&
        is(a, 5, stateExcludeSpec),
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
}

/**
 * Build the full research-tree scope for one tree directory name (module
 * doc): the derived pathspecs + the rows + the bound predicates/validator.
 *
 * @throws {GitInputError} when `treeDir` is not a bare directory name
 *  (a settings value that survived T2.1's validation must never reach
 *  this boundary malformed — fail loud anyway).
 */
export function buildResearchTreeScope(treeDir: string): ResearchTreeScope {
  const rows = buildWhitelistRows(treeDir)
  const pathspec = `${treeDir}/`
  const statePathspec = `${treeDir}/state/`
  const stateExcludeSpec = `${RESEARCH_STATE_EXCLUDE_SUFFIX}${statePathspec}`
  return {
    treeDir,
    pathspec,
    statePathspec,
    stateExcludeSpec,
    rows,
    assertWhitelisted: (argv: readonly string[]): WhitelistRow => {
      for (const row of rows) {
        if (row.match(argv)) return row
      }
      throw new GitWhitelistViolationError([...argv])
    },
    isWithinCommitScope: (p: string) => {
      if (typeof p !== 'string') return false
      if (!p.startsWith(pathspec)) return false
      if (p.startsWith(statePathspec)) return false
      return true
    },
    isUnderResearch: (p: string) => p === pathspec || p.startsWith(pathspec),
  }
}

/* ------------------------------------------------------------------ *
 * The frozen DEFAULT scope (the V1 `.research` face — every pre-V2
 * consumer and every existing git test keeps using it verbatim)
 * ------------------------------------------------------------------ */

/** The V1 default research-tree scope (`.research`), byte-identical argv. */
export const DEFAULT_RESEARCH_TREE_SCOPE: ResearchTreeScope = buildResearchTreeScope(DEFAULT_TREE_DIR)

/**
 * Resolve the scope of one git call from its options: an explicit
 * `opts.treeDir` (the production plane's configured name — T3.2b) builds
 * that scope; absent → the frozen default.
 */
export function scopeFor(opts: { treeDir?: string } | null | undefined): ResearchTreeScope {
  const treeDir = opts?.treeDir
  if (treeDir === undefined || treeDir === null) return DEFAULT_RESEARCH_TREE_SCOPE
  return buildResearchTreeScope(treeDir)
}

/**
 * W9/W10 pathspec and W8 restore scope (INV-GIT-3 / §6) — the DEFAULT
 * scope's pathspec (the frozen V1 constant; the parameterized face is
 * {@link buildResearchTreeScope}).
 */
export const RESEARCH_PATHSPEC = DEFAULT_RESEARCH_TREE_SCOPE.pathspec

/** The default scope's state sub-directory pathspec (see module doc). */
export const RESEARCH_STATE_PATHSPEC = DEFAULT_RESEARCH_TREE_SCOPE.statePathspec

/** The default scope's W9/W10 exclude token (see module doc). */
export const RESEARCH_STATE_EXCLUDE_SPEC = DEFAULT_RESEARCH_TREE_SCOPE.stateExcludeSpec

/**
 * The DEFAULT scope's W1–W13 rows (the frozen V1 table — pre-V2 consumers
 * and the tests/git suite read it verbatim; the parameterized constructor
 * is {@link buildWhitelistRows}).
 */
export const WHITELIST_ROWS: readonly WhitelistRow[] = DEFAULT_RESEARCH_TREE_SCOPE.rows

/**
 * Whether a repo-root-relative path is inside the DEFAULT scope's commit
 * scope (the V1 predicate — the parameterized face is
 * {@link isWithinCommitScopeFor}).
 */
export function isWithinCommitScope(p: string): boolean {
  return DEFAULT_RESEARCH_TREE_SCOPE.isWithinCommitScope(p)
}

/**
 * 运行时护栏 (INV-GIT-7) — DEFAULT scope: argv must match exactly one
 * frozen row; anything else throws GitWhitelistViolationError before a
 * process is spawned. Returns the matched row for observability. (The
 * runner itself validates through the CALL's scope — `scopeFor(opts)`.)
 */
export function assertWhitelisted(argv: readonly string[]): WhitelistRow {
  return DEFAULT_RESEARCH_TREE_SCOPE.assertWhitelisted(argv)
}

/* ------------------------------------------------------------------ *
 * Shared row-shape helpers
 * ------------------------------------------------------------------ */

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

const is = (a: readonly string[], i: number, v: string): boolean => a[i] === v

/**
 * Validate a tree directory name (the settings `treeDir` rule, the git
 * layer's own boundary — T2.1's `validateDirName` already guards the
 * settings write; this re-checks at the argv-generation boundary so a
 * malformed value can never shape a pathspec, fail loud).
 */
function assertTreeDir(treeDir: string): void {
  if (
    typeof treeDir !== 'string' ||
    treeDir.length === 0 ||
    treeDir === '.' ||
    treeDir === '..' ||
    treeDir.includes('/')
  ) {
    throw new GitInputError(
      `the research tree directory name must be a bare segment (got ${JSON.stringify(treeDir ?? null)}) — ` +
        'a malformed name must never shape the W8/W9/W10 pathspecs (GIT_INTEGRATION §3)',
    )
  }
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
