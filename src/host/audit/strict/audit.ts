/**
 * WP-6.1 — strict git audit (GIT_INTEGRATION §8 第一层, 计划书 §22.1).
 *
 * 对**注册 workspace** 执行严格跟踪层审计, 编排 = W1 → W4 → W5 → W13,
 * 全部经 git wrapper 白名单 (INV-GIT-7 运行时护栏仍逐次生效):
 *
 *   W1 `detectRepo`     仓库检测 (§2; 非 repo → NotARepoAuditError, 拒绝 audit)
 *   W4 `status`         --porcelain=v2 --branch: tracked 修改分类 (X/Y 语义:
 *                       staged vs worktree vs unmerged) + untracked 新文件清单
 *                       (按 `.research/` 内外分列) + 分支头 (detached/空仓)
 *   W5 `diffNameStatus` 变更摘要: 缺省 = index ↔ worktree (未暂存);
 *                       给定 baseline (40-hex) = 基线 ↔ worktree
 *   W13 `lsFiles`       权威 tracked 集枚举: `.research/` (一致性 missing 面)
 *                       + policy `strict_tracked.paths` (逐 pathspec,
 *                       已做 workspace→repo root 前缀换算, §3 说明) —
 *                       「判定 strict tracked 路径集内的删除/缺失」(§3 表 W13 行)
 *
 * 只读边界 (目标 3, 类型面证明见 tests/audit-strict/read-only.test.ts):
 *   - 唯一 git 能力来源 = src/host/git 公开面; 只用 W1/W4/W5/W13 四个自动
 *     触发只读操作 — W6–W12 (含全部写能力) 在本模块不可达;
 *   - 零 node:fs / node:child_process import — 无任何文件 I/O;
 *   - git 层错误 (GitCommandError 等) 原样透传 (§9「原样展示 git 错误」)。
 *
 * 与 §5.1 冲突检测**正交** (目标 4): §5.1 门禁是 checkpoint 前置
 * (save 流程步骤 1, 写历史保护); audit 是纯读操作, 不受 merge/rebase/
 * cherry-pick 进行中状态阻塞 (GIT_INTEGRATION §9 读操作行) — 冲突态下的
 * unmerged 条目照常分类入报告。本 WP 不做 checkpoint, 不产生 ManagementAction。
 *
 * 边界 (§8): 报告只回答「工作区发生了哪些插件尚未登记的变化」, 不推断
 * 科研含义; discovery zones 扫描 (第二层, fs 面) 归 WP-6.2, reconciliation
 * 三档 (§22.3) 归 WP-6.3 — 两者消费本报告的 `newFiles.outsideResearch` 与
 * `strictTracked`/`trackedChanges` 输入面。
 */
import { relative, resolve, sep } from 'node:path'
import {
  diffNameStatus,
  detectRepo,
  lsFiles,
  RESEARCH_PATHSPEC,
  status,
  type DiffEntry,
  type StatusEntry,
} from '../../git/index.js'
import { AuditInputError, NotARepoAuditError } from './errors.js'
import type {
  AuditPolicy,
  AuditReport,
  ResearchConsistency,
  StrictAuditOptions,
  StrictTrackedChange,
  StrictTrackedReport,
} from './types.js'

/** 全量 40-hex commit OID (W5 baseline 形状; 短 OID/refs 拒绝 — 白名单同口径). */
const FULL_OID_RE = /^[0-9a-f]{40}$/

function byPath(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function sortPaths(list: string[]): string[] {
  return [...list].sort(byPath)
}

function sortDiff(list: DiffEntry[]): DiffEntry[] {
  return [...list].sort((a, b) => byPath(a.path, b.path))
}

/** POSIX 化 (分隔符归一; 测试环境 = Linux, 跨平台安全). */
function toPosix(p: string): string {
  return p.split(sep).join('/')
}

/** workspace.root 记法归一 (去尾随 `/`; `.`/`./`/`./a/` → `a`; 仅用于比对, 不改 pathspec 语义). */
function normRoot(p: string): string {
  const t = toPosix(p).replace(/\/+$/, '')
  return t === '' || t === '.' ? '.' : t
}

/**
 * workspace root 相对 repo root 的路径 (POSIX; 相同 = `.`)。
 * W1 保证 workspace root 在 repo 内; 越出 = 输入矛盾, fail loud。
 */
function workspaceRelPath(repoRoot: string, workspaceRootAbs: string): string {
  const rel = relative(toPosix(repoRoot), toPosix(workspaceRootAbs))
  if (rel === '') return '.'
  if (rel === '..' || rel.startsWith('../')) {
    throw new AuditInputError(
      `runStrictAudit: workspace root ${workspaceRootAbs} is outside the detected repo root ${repoRoot} (GIT_INTEGRATION §2)`,
    )
  }
  return toPosix(rel)
}

/**
 * policy pathspec (workspace-root-relative) → repo-root-relative 前缀换算
 * (GIT_INTEGRATION §3 说明「若 workspace root ≠ repo root, 插件负责前缀
 * 换算」)。pathspec 字面保留 (glob / 尾随 `/` 语义归 git)。
 */
function joinPathspec(wsRel: string, p: string): string {
  const b = p.startsWith('./') ? p.slice(2) : p
  if (wsRel === '.') return b === '' || b === '.' ? '.' : b
  if (b === '' || b === '.') return wsRel
  const a = wsRel.replace(/\/+$/, '')
  const trailing = p.endsWith('/') ? '/' : ''
  const core = b.replace(/\/+$/, '')
  return `${a}/${core}${trailing}`
}

/** `.research/` 域判定 (路径恰为目录记法或其内). */
function inResearch(p: string): boolean {
  return p === RESEARCH_PATHSPEC || p.startsWith(RESEARCH_PATHSPEC)
}

const GLOB_CHARS_RE = /[*?\[]/

/**
 * 判定路径是否落在声明的 pathspec 内 (git-glob(7) 语义子集, 与 git 对同一
 * pathspec 的 ls-files 解释一致):
 *  - 字面目录 (尾随 `/`, 无 glob 字符): 该目录或其下任意路径;
 *  - 字面文件 (无 glob 字符): 全等;
 *  - glob: `*` = 不含 `/` 的任意串, `**` = 含 `/` 的任意串, `?` = 单个非 `/`
 *    字符, `[...]` 字符类透传; 尾随 `/` = 目录前缀语义。
 */
function pathspecMatches(path: string, spec: string): boolean {
  const dirForm = spec.endsWith('/')
  const core = dirForm ? spec.slice(0, -1) : spec
  if (core.length === 0) return false
  if (!GLOB_CHARS_RE.test(core)) {
    return dirForm ? path === core || path.startsWith(`${core}/`) : path === core
  }
  let re = ''
  for (let i = 0; i < core.length; i++) {
    const c = core[i]!
    if (c === '*') {
      if (core[i + 1] === '*') {
        re += '.*'
        i++
      } else re += '[^/]*'
    } else if (c === '?') re += '[^/]'
    else if (c === '[') {
      const close = core.indexOf(']', i + 1)
      if (close < 0) re += '\\['
      else {
        re += core.slice(i, close + 1)
        i = close
      }
    } else re += c.replace(/[.*+^${}()|\\]/g, '\\$&')
  }
  const m = new RegExp(`^${re}$`).exec(path)
  if (m === null) return false
  if (!dirForm) return true
  const dir = m[0]!
  return path === dir || path.startsWith(`${dir}/`)
}

/** W4 条目分类: tracked 变更清单 + untracked 新文件 (git 记法原样, 目录含 `/`). */
function classifyStatus(entries: StatusEntry[]): {
  changes: Omit<StrictTrackedChange, 'diffStatus'>[]
  untracked: string[]
} {
  const changes: Omit<StrictTrackedChange, 'diffStatus'>[] = []
  const untracked: string[] = []
  for (const e of entries) {
    if (e.kind === 'untracked') {
      untracked.push(e.path)
      continue
    }
    const change: Omit<StrictTrackedChange, 'diffStatus'> = {
      path: e.path,
      kind: e.kind,
      x: e.x,
      y: e.y,
      staged: e.x !== '.',
      worktreeModified: e.y !== '.',
      stagedForDeletion: e.x === 'D',
      deletedInWorktree: e.y === 'D',
    }
    if (e.kind === 'renamed') change.origPath = e.origPath
    changes.push(change)
  }
  return {
    changes: changes.sort((a, b) => byPath(a.path, b.path)),
    untracked: sortPaths(untracked),
  }
}

/**
 * strict git audit (目标 2) — 对注册 workspace 执行 W4/W5/W13 只读审计,
 * 输出结构化 {@link AuditReport}。
 *
 * @throws AuditInputError      workspaceRoot/baseline 形状非法 (spawn 之前).
 * @throws NotARepoAuditError   目录不是 Git repo (W1, §2).
 * @throws (git 层错误原样)     GitCommandError / GitTimeoutError / GitMissingError /
 *                             GitInputError (W13 pathspec 越界等, §9 原样展示)。
 */
export async function runStrictAudit(opts: StrictAuditOptions): Promise<AuditReport> {
  // ── 1. 输入校验 (先于任何 I/O) ──
  if (typeof opts.workspaceRoot !== 'string' || opts.workspaceRoot.length === 0) {
    throw new AuditInputError('runStrictAudit: workspaceRoot must be a non-empty path')
  }
  if (opts.baseline !== undefined && (typeof opts.baseline !== 'string' || !FULL_OID_RE.test(opts.baseline))) {
    throw new AuditInputError(
      `runStrictAudit: baseline must be a full 40-hex commit OID (W5 白名单形状), got: ${String(opts.baseline).slice(0, 40)}`,
    )
  }
  const policy: AuditPolicy | undefined = opts.policy

  // ── 2. W1 仓库检测 (§2) ──
  const det = await detectRepo(opts.workspaceRoot, opts.gitOptions)
  if (!det.ok) throw new NotARepoAuditError(opts.workspaceRoot)
  const repoRoot = det.repoRoot

  // ── 3. workspace→repo root 前缀 (policy pathspec 换算, §3 说明) ──
  const wsRel = workspaceRelPath(repoRoot, resolve(opts.workspaceRoot))

  // ── 4. W4 工作区状态 (--porcelain=v2 --branch) ──
  const st = await status(repoRoot, { ...opts.gitOptions, includeBranch: true })
  const { changes, untracked } = classifyStatus(st.entries)

  // ── 5. W5 变更摘要 (缺省 = 未暂存 index↔worktree; baseline = 基线↔worktree) ──
  const diffSummary = sortDiff(await diffNameStatus(repoRoot, opts.baseline, opts.gitOptions))
  const diffStatusByPath = new Map<string, string>()
  for (const e of diffSummary) {
    if (!diffStatusByPath.has(e.path)) diffStatusByPath.set(e.path, e.status)
    if (e.oldPath !== undefined && !diffStatusByPath.has(e.oldPath)) diffStatusByPath.set(e.oldPath, e.status)
  }
  const trackedChanges: StrictTrackedChange[] = changes.map((c) => ({
    ...c,
    diffStatus: diffStatusByPath.get(c.path) ?? (c.origPath !== undefined ? diffStatusByPath.get(c.origPath) : undefined),
  }))

  // ── 6. W13 权威 tracked 集枚举 ──
  // 6a. `.research/` — 一致性 missing 面 (§3 表 W13 行: 判定路径集内删除/缺失)
  const researchTracked = await lsFiles(repoRoot, RESEARCH_PATHSPEC, opts.gitOptions)
  // 6b. policy strict_tracked.paths — 逐 pathspec (前缀换算后)
  const strictPaths = policy?.strictTrackedPaths ?? []
  const pathspecs = strictPaths.map((p) => joinPathspec(wsRel, p))
  const strictTrackedSet = new Set<string>()
  for (const ps of pathspecs) {
    for (const p of await lsFiles(repoRoot, ps, opts.gitOptions)) strictTrackedSet.add(p)
  }

  // ── 7. 投影: .research/ 一致性 + strict tracked 层 ──
  // 删除/缺失判定 (并集去重, 两词各有独立权威源 — 单靠 W13 index 视图会漏
  // 暂存删除, 单靠 W4 会漏 pathspec 圈定):
  //   词 A: W13 基线集内且 W4 报 D (工作树删除 — 文件仍在 index);
  //   词 B: W4 D 条目但已离开基线 (暂存删除 — git rm 后离开 index; git 权威:
  //         D 状态只可能出自 tracked 文件) — 圈定用声明 pathspec 的 git-glob 匹配。
  const w4Deleted = changes.filter((c) => c.stagedForDeletion || c.deletedInWorktree)
  const w4DeletedPaths = new Set(w4Deleted.map((c) => c.path))
  const researchTrackedSet = new Set(researchTracked)
  const changedPaths = new Set(
    changes.filter((c) => c.staged || c.worktreeModified).map((c) => c.path),
  )

  const research: ResearchConsistency = {
    trackedModified: sortPaths(changes.filter((c) => inResearch(c.path) && (c.staged || c.worktreeModified)).map((c) => c.path)),
    untracked: untracked.filter((p) => inResearch(p)),
    missing: sortPaths([
      ...researchTracked.filter((p) => w4DeletedPaths.has(p)),
      ...w4Deleted.filter((c) => inResearch(c.path) && !researchTrackedSet.has(c.path)).map((c) => c.path),
    ]),
    consistent: false, // 下方回填
  }
  research.consistent = research.trackedModified.length === 0 && research.untracked.length === 0 && research.missing.length === 0

  const strictTrackedList = sortPaths([...strictTrackedSet])
  const strictTracked: StrictTrackedReport = {
    pathspecs,
    tracked: strictTrackedList,
    modified: strictTrackedList.filter((p) => changedPaths.has(p)),
    deleted: sortPaths([
      ...strictTrackedList.filter((p) => w4DeletedPaths.has(p)),
      ...w4Deleted
        .filter((c) => !strictTrackedSet.has(c.path))
        .filter((c) => pathspecs.some((ps) => pathspecMatches(c.path, ps)))
        .map((c) => c.path),
    ]),
  }

  // ── 8. 警告面 (不阻断 — 读操作正常, §9) ──
  const warnings: AuditReport['warnings'] = []
  if (st.head?.kind === 'detached') {
    warnings.push({
      code: 'AUDIT_DETACHED_HEAD',
      message:
        `audit executed on detached HEAD${st.head.oid ? ` (${st.head.oid})` : ''} — read-only audit unaffected ` +
        '(GIT_INTEGRATION §9); checkpoint would warn before committing (§5)',
    })
  } else if (st.head?.kind === 'branch' && /^# branch\.oid \(initial\)\s*$/m.test(st.raw)) {
    warnings.push({
      code: 'AUDIT_EMPTY_REPO',
      message: 'repository has no commits yet — W5 baseline mode unavailable; report reflects index/working tree state',
    })
  }
  if (st.truncated) {
    warnings.push({
      code: 'AUDIT_TRUNCATED',
      message: 'W4 status output exceeded maxOutputBytes — trackedChanges/newFiles may be incomplete (raise gitOptions.maxOutputBytes)',
    })
  }
  if (policy !== undefined && normRoot(policy.workspaceRoot) !== wsRel) {
    warnings.push({
      code: 'AUDIT_POLICY_MISMATCH',
      message: `workspace.yaml workspace.root=${JSON.stringify(policy.workspaceRoot)} but the registered workspace root is ` +
        `${JSON.stringify(wsRel)} relative to the repo root — pathspec conversion used the actual location (GIT_INTEGRATION §2)`,
    })
  }

  return {
    head: st.head ?? null,
    ...(opts.baseline !== undefined ? { baseline: opts.baseline } : {}),
    trackedChanges,
    diffSummary,
    newFiles: {
      outsideResearch: untracked.filter((p) => !inResearch(p)),
      insideResearch: untracked.filter((p) => inResearch(p)),
    },
    research,
    strictTracked,
    warnings,
  }
}
