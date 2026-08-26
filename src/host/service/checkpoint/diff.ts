/**
 * WP-1.5 — 历史查看 / diff 服务 (GIT_INTEGRATION §6 查看, W6 + W5 + W7).
 *
 * 编排, 一步一结构化日志 (logger 注入):
 *
 *   diff.start          入口 (显式用户动作 — 查看操作)
 *   diff.input          输入校验: path 限 `.research/**` (GitScopeViolationError);
 *                       baseline 必须全量 40-hex OID (GIT_INPUT)
 *   diff.repo-detected  W1 仓库检测; 非 repo → NotARepoError (§2)
 *   diff.log            W6 版本列表 (新→旧; 冻结格式串; §9 分页 maxCount/skip):
 *                       给定 path → 该文件历史; 缺省 → 整个 .research/** 历史
 *   diff.file-diff      W5 文件级差异摘要: `git diff --name-status <baseline>`
 *                       = 基线版本 ↔ 当前 working tree (canonical current state, §9),
 *                       范围限定 `.research/**` (INV-GIT-3; 无关变更剔除并计数)
 *   diff.content-compare W7 单文件两版本内容判定: showFile(baseline, path) 与
 *                       working copy 逐字节比较 (path + baseline 同时给出时);
 *                       基线不含该路径 / 目标为目录 → null (记录原因)
 *   diff.done           返回 {versions, fileDiff?, baseline?, pathContent?}
 *
 * 白名单边界说明 (INV-GIT-7): W5 冻结形状是**单基线** (`diff --name-status
 * [<baseline>]`) — 「两版本差异」面 = (历史版本, 当前 working copy); 两
 * commit 间直接 diff 不在 W1–W13 内, 类型面不可达。单文件两版本内容判定
 * 由 W7 (pathContent) 补足 — 这是白名单内可达的全部两版本比较能力。
 *
 * 边界 (WP-1.5): 纯查看 — 零写入 (不 stage / 不 commit / 不 restore);
 * 不碰 domain/plan/topology 内部 (working copy 内容经 node:fs 只读比较,
 * 不经 loader 校验 — 查看面不判科研含义, §8 audit 边界同精神)。
 */
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  detectRepo,
  diffNameStatus,
  GitInputError,
  GitScopeViolationError,
  logFile,
  scopeFor,
  showFile,
  type ResearchTreeScope,
} from '../../git/index.js'
import { NotARepoError } from './errors.js'
import { FsResearchReader } from './fs-reader.js'
import type { StructuredLogger } from './logger.js'
import {
  FULL_OID_RE,
  type DiffHistoryOptions,
  type DiffHistoryResult,
} from './types.js'

/** 检查顺序与 restore 一致 (scope 先, 形状后): 越界 → GIT_SCOPE; 形状非法 → GIT_INPUT.
 *  V2 T3.2b: the scope is the CALL's tree (opts.treeDir; default `.research`). */
function assertResearchPath(scope: ResearchTreeScope, p: string): string {
  if (typeof p !== 'string' || !p.startsWith(scope.pathspec)) {
    throw new GitScopeViolationError(String(p))
  }
  if (p === '..' || p.startsWith('../') || p.startsWith('/') || p.includes('\0')) {
    throw new GitInputError(`diffHistory: path must be repo-root-relative (GIT_INTEGRATION §3 说明), got: ${p}`)
  }
  return p
}

/**
 * 历史查看 + 文件级差异摘要 (§6 查看流程; 显式用户动作触发).
 *
 * @throws GitScopeViolationError path 越出 .research/** (spawn 之前).
 * @throws GitInputError          baseline OID 形状非法 (spawn 之前).
 * @throws NotARepoError          非 Git repo (§2, W1).
 * @throws GitCommandError        git 自身报错 (§9 原样透传, 不修复).
 */
export async function diffHistory(root: string, opts: DiffHistoryOptions): Promise<DiffHistoryResult> {
  const logger = opts.logger
  const scope = scopeFor(opts)

  // ── 输入校验 (先于任何 I/O) ──
  const path = opts.path === undefined ? undefined : assertResearchPath(scope, opts.path)
  if (opts.baseline !== undefined && (typeof opts.baseline !== 'string' || !FULL_OID_RE.test(opts.baseline))) {
    logger.error('diff.input', { reason: 'bad-baseline', baseline: String(opts.baseline) })
    throw new GitInputError(
      `diffHistory: baseline must be a full 40-hex commit OID, got: ${String(opts.baseline).slice(0, 40)}`,
    )
  }
  logger.info('diff.start', { root, path: path ?? null, baseline: opts.baseline ?? null })

  // ── 仓库检测 (W1, §2) ──
  const det = await detectRepo(root, opts)
  if (!det.ok) {
    logger.error('diff.repo-detected', { root, ok: false, reason: det.reason })
    throw new NotARepoError(root)
  }
  logger.info('diff.repo-detected', { root, repoRoot: det.repoRoot })

  // ── W6 版本列表 (新→旧; 分页 §9) ──
  const target = path ?? scope.treeDir
  const versions = await logFile(root, target, {
    ...opts,
    maxCount: opts.maxCount,
    skip: opts.skip,
  })
  logger.info('diff.log', { target, count: versions.length })

  const result: DiffHistoryResult = { versions }

  // ── W5 文件级差异摘要: 基线版本 ↔ 当前 working tree, 限 .research/** ──
  if (opts.baseline !== undefined) {
    const all = await diffNameStatus(root, opts.baseline, opts)
    const inScope = all.filter((e) => e.path.startsWith(scope.pathspec))
    result.fileDiff = inScope
    result.baseline = opts.baseline
    logger.info('diff.file-diff', {
      baseline: opts.baseline,
      entries: inScope.length,
      outOfScopeDropped: all.length - inScope.length,
    })
  }

  // ── W7 单文件两版本内容判定 (path + baseline 同时给出时) ──
  if (path !== undefined && opts.baseline !== undefined) {
    const researchRoot = join(root, scope.treeDir)
    const reader = new FsResearchReader(researchRoot)
    const relInResearch = path.slice(scope.pathspec.length)
    const abs = join(researchRoot, relInResearch)
    if (existsSync(abs) && statSync(abs).isDirectory()) {
      result.pathContent = null
      logger.info('diff.content-compare', { path, baseline: opts.baseline, skipped: 'directory target' })
    } else {
      let baselineContent: string | null
      try {
        baselineContent = await showFile(root, opts.baseline, path, opts)
      } catch {
        baselineContent = null // 基线 commit 不含该路径 (如该版本时尚未创建)
      }
      if (baselineContent === null) {
        result.pathContent = null
        logger.info('diff.content-compare', { path, baseline: opts.baseline, missingInBaseline: true })
      } else {
        const current = reader.readFile(abs)
        const sameAsBaseline = current === baselineContent
        result.pathContent = { path, sameAsBaseline }
        logger.info('diff.content-compare', { path, baseline: opts.baseline, sameAsBaseline })
      }
    }
  }

  logger.info('diff.done', { versions: versions.length, hasFileDiff: result.fileDiff !== undefined })
  return result
}
