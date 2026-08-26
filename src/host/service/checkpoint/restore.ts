/**
 * WP-1.5 — Restore 服务 (GIT_INTEGRATION §6, W6 定位 + W7 预取 + W8 恢复).
 *
 * 编排 = §6 原文顺序, 一步一结构化日志 (logger 注入):
 *
 *   restore.start          入口 (显式用户动作; INV-GIT-5 唯一触发面)
 *   restore.input          输入校验: 全量 40-hex OID + 路径限 `.research/**`
 *                          (§6「.research/ 目录外的路径不允许通过本插件 restore」
 *                          → GitScopeViolationError / GIT_INPUT, spawn 之前拒绝)
 *   restore.repo-detected  W1 仓库检测; 非 repo → NotARepoError (§2)
 *   restore.log-locate     W6 log 定位: commit 必须在该文件的历史中, 否则
 *                          RestoreNotInHistoryError (精确: 附该路径实际版本列表)
 *   restore.show           W7 show 预取历史内容 (兼验证该 commit 含此路径 —
 *                          删除性 commit 在 log 中但路径已不存在 → git 报错);
 *                          失败 → RestoreFailedError (精确 cause + 工作副本评估)
 *   restore.restore        W8 restore --source=<commit> -- <path> (仅动 working
 *                          tree, 不带 --staged 之外的破坏性参数, §3 说明);
 *                          失败 → RestoreFailedError (工作副本完整性复检)
 *   restore.verify-content 恢复落盘校验: working copy 与历史版本逐字节一致
 *                          (目录恢复跳过逐字节比较, 仅记录)
 *   restore.validate       恢复后 loader 校验 (§6「恢复后触发该文件的 schema 校验」):
 *                          非法内容不静默 — validation.ok=false + 精确错误 +
 *                          警告, **保留文件原状供用户处理, 不静默回滚**
 *   restore.done           返回 {path, commitOid, validation, warnings}
 *
 * 边界 (WP-1.5):
 *  - restore 恢复文件内容, 不越权改内存态: 本函数只经 W8 改 working tree,
 *    恢复后读盘校验 (FsResearchReader 只读), 不缓存/不更新任何 in-memory 树。
 *  - 不修改旧 commit、不产生新 commit (INV-GIT-5; 提交与否由用户随后决定)。
 *  - TC-GIT-005 语义: 恢复失败**精确报错** (cause 保留 git 原始 stderr) 且
 *    **工作副本不被破坏到不可检态** (RestoreFailedError 携带
 *    workingCopyIntact + workingCopyLoaderErrors — loader 仍可运行并精确定位)。
 *  - 不碰 domain/plan/topology 内部: loader 只经其公开面 loadResearchTree
 *    (注入 reader + schemaDir), 本层不 import 其内部模块。
 */
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  detectRepo,
  GitInputError,
  GitScopeViolationError,
  logFile,
  restoreFile,
  scopeFor,
  showFile,
  type ResearchTreeScope,
} from '../../git/index.js'
import { loadResearchTree, type ResearchLoadError } from '../../domain/loader/index.js'
import {
  NotARepoError,
  RestoreFailedError,
  RestoreNotInHistoryError,
  RestoreVerifyError,
} from './errors.js'
import { FsResearchReader } from './fs-reader.js'
import type { StructuredLogger } from './logger.js'
import { FULL_OID_RE, type RestoreOptions, type RestoreResult } from './types.js'

/**
 * §6 边界: 仅 `<treeDir>/**` (default `.research/**`) 可经本插件 restore
 * (repo-root-relative). 检查顺序与 git 层 restoreFile 一致 (scope 先,
 * 形状后): 越界 (含 `..` 逃逸 / 绝对路径) → GIT_SCOPE; 树内但形状非法
 * (NUL 等) → GIT_INPUT. V2 T3.2b: the scope is the CALL's tree
 * (opts.treeDir; default `.research`).
 */
function assertResearchPath(scope: ResearchTreeScope, p: string, op: string): string {
  if (typeof p !== 'string' || !p.startsWith(scope.pathspec)) {
    throw new GitScopeViolationError(String(p))
  }
  if (p === '..' || p.startsWith('../') || p.startsWith('/') || p.includes('\0')) {
    throw new GitInputError(`${op}: path must be repo-root-relative (GIT_INTEGRATION §3 说明), got: ${p}`)
  }
  return p
}

/** 失败路径的工作副本评估: loader 仍可运行并精确定位 = 「可检态」证明. */
function workingCopyLoaderErrors(reader: FsResearchReader, researchRoot: string, schemaDir: string): ResearchLoadError[] {
  return loadResearchTree(reader, researchRoot, schemaDir).errors
}

/**
 * Restore 一个 `.research/**` 文件 (或子目录) 到指定历史版本 (用户显式触发; §6).
 *
 * @throws GitInputError              OID 形状非法 / 路径非法 (spawn 之前).
 * @throws GitScopeViolationError     路径越出 .research/** (§6 边界).
 * @throws NotARepoError              非 Git repo (§2, W1).
 * @throws RestoreNotInHistoryError   commit 不在该文件历史中 (W6 定位失败).
 * @throws RestoreFailedError         W7/W8 git 层失败 (精确 cause + 工作副本评估).
 * @throws RestoreVerifyError         落盘后内容与历史版本不一致 (git 层异常, fail loud).
 * @throws GitCommandError            其它 git 自身报错 (§9 原样透传, 不修复).
 */
export async function restoreResearchFile(
  root: string,
  commitOid: string,
  filePath: string,
  opts: RestoreOptions,
): Promise<RestoreResult> {
  const logger = opts.logger
  const scope = scopeFor(opts)

  // ── 输入校验 (先于任何 I/O) ──
  if (typeof commitOid !== 'string' || !FULL_OID_RE.test(commitOid)) {
    logger.error('restore.input', { reason: 'bad-oid', commitOid: String(commitOid) })
    throw new GitInputError(
      `restoreResearchFile: expected a full 40-hex commit OID, got: ${String(commitOid).slice(0, 40)}`,
    )
  }
  const path = assertResearchPath(scope, filePath, 'restoreResearchFile')
  logger.info('restore.start', { root, commitOid, path })

  // ── 仓库检测 (W1, §2) ──
  const det = await detectRepo(root, opts)
  if (!det.ok) {
    logger.error('restore.repo-detected', { root, ok: false, reason: det.reason })
    throw new NotARepoError(root)
  }
  logger.info('restore.repo-detected', { root, repoRoot: det.repoRoot })

  const researchRoot = join(root, scope.treeDir)
  const reader = new FsResearchReader(researchRoot)
  const relInResearch = path.slice(scope.pathspec.length)
  const abs = join(researchRoot, relInResearch)

  // ── W6 log 定位: commit 必须在该文件的历史中 (§6 查看流程第一步) ──
  const versions = await logFile(root, path, opts)
  const knownOids = versions.map((v) => v.oid)
  if (!knownOids.includes(commitOid)) {
    logger.error('restore.log-locate', { commitOid, path, knownCount: knownOids.length })
    throw new RestoreNotInHistoryError(commitOid, path, knownOids.slice(0, 20))
  }
  logger.info('restore.log-locate', { commitOid, path, knownCount: knownOids.length })

  // ── W7 show 预取历史内容 (兼验证该 commit 含此路径; 恢复前记录 working 状态) ──
  const before = reader.readFile(abs)
  let expected: string
  try {
    expected = await showFile(root, commitOid, path, opts)
  } catch (e) {
    const intact = reader.readFile(abs) === before
    const loaderErrors = workingCopyLoaderErrors(reader, researchRoot, opts.schemaDir)
    logger.error('restore.show', {
      commitOid,
      path,
      error: e instanceof Error ? e.message : String(e),
      workingCopyIntact: intact,
    })
    throw new RestoreFailedError({
      commitOid,
      path,
      cause: e,
      workingCopyIntact: intact,
      workingCopyLoaderErrors: loaderErrors,
    })
  }
  logger.info('restore.show', { commitOid, path, bytes: expected.length, workingBefore: before === null ? 'absent' : `${before.length} bytes` })

  // ── W8 restore --source=<commit> -- <path> (仅 working tree, §3 说明) ──
  try {
    await restoreFile(root, commitOid, path, opts)
  } catch (e) {
    // TC-GIT-005: 精确报错 + 工作副本不被破坏到不可检态 —
    // 重读 working copy 与恢复前比较 (git 失败不写半成品), 并跑 loader 证明可检。
    const after = reader.readFile(abs)
    const intact = after === before
    const loaderErrors = workingCopyLoaderErrors(reader, researchRoot, opts.schemaDir)
    logger.error('restore.restore', {
      commitOid,
      path,
      error: e instanceof Error ? e.message : String(e),
      workingCopyIntact: intact,
    })
    throw new RestoreFailedError({
      commitOid,
      path,
      cause: e,
      workingCopyIntact: intact,
      workingCopyLoaderErrors: loaderErrors,
    })
  }
  logger.info('restore.restore', { commitOid, path })

  // ── 恢复落盘校验: working copy 与历史版本逐字节一致 ──
  if (existsSync(abs) && statSync(abs).isDirectory()) {
    logger.info('restore.verify-content', { path, note: 'directory restore — per-file byte check skipped' })
  } else {
    const actual = reader.readFile(abs)
    if (actual !== expected) {
      logger.error('restore.verify-content', {
        path,
        commitOid,
        expectedBytes: expected.length,
        actualBytes: actual === null ? -1 : actual.length,
      })
      throw new RestoreVerifyError(commitOid, path, expected.length, actual === null ? -1 : actual.length)
    }
    logger.info('restore.verify-content', { path, commitOid, bytes: expected.length })
  }

  // ── 恢复后 loader 校验 (§6): 非法内容不静默, 保留文件原状, 不静默回滚 ──
  const loaded = loadResearchTree(reader, researchRoot, opts.schemaDir)
  const fileErrors = loaded.errors.filter((e) => e.file === relInResearch || e.file.startsWith(`${relInResearch}/`))
  const warnings: string[] = []
  if (fileErrors.length > 0) {
    warnings.push(
      `restored ${path} @ ${commitOid.slice(0, 12)} fails loader validation (${fileErrors.length} error(s)) — ` +
        `file kept as-is for user handling, no silent rollback (GIT_INTEGRATION §6)`,
    )
    logger.warn('restore.validate', {
      path,
      commitOid,
      errors: fileErrors.map((e) => `[${e.code}] ${e.file} ${e.path ?? ''} ${e.message}`),
    })
  } else {
    logger.info('restore.validate', { path, commitOid, ok: true, treeErrorsElsewhere: loaded.errors.length })
  }

  logger.info('restore.done', { path, commitOid, validationOk: fileErrors.length === 0 })
  return {
    path,
    commitOid,
    validation: { ok: fileErrors.length === 0, errors: fileErrors },
    warnings,
  }
}

// GitCommandError 透传说明: W7/W8 之外 (W1/W6) 的 git 失败按 §9 原样抛
// GitCommandError — 本函数不捕获不包装 (不丢失 git 精确信息, 插件不尝试修复)。
