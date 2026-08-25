/**
 * WP-1.5 — Save Research Checkpoint 服务 (GIT_INTEGRATION §5, 唯一写历史操作).
 *
 * 编排 = §5 原文顺序, 一步一结构化日志 (logger 注入):
 *
 *   save.start            入口 (显式用户动作; INV-GIT-2 唯一触发面)
 *   save.repo-detected    W1 仓库检测; 非 repo → NotARepoError (§2)
 *   save.conflict-check   §5.1 冲突状态检测前置; 进行中 → GitConflictStateError
 *                         (结构化拒绝, INV-GIT-4 fail loud)
 *   save.status           W4 status --porcelain=v2 --branch:
 *                         汇总提交面内待提交变更 → changedFiles
 *                         (V2-T2.4: 提交面 = .research/** 减去 state/ 状态区,
 *                         design §3.3 — 与 W9/W10 pathspec 同一口径);
 *                         detached HEAD → 明确警告 (§5 允许但警告);
 *                         无变更 → save.no-op 成功短路 (§5 步骤 2, 无空 commit)
 *   save.stage            W9 git add -- .research/ ':(exclude).research/state/'
 *                         (只暂存 .research 路径, 排除 state/ 状态区)
 *   save.commit           W10 git commit -m "research: <摘要>" -- .research/
 *                         ':(exclude).research/state/'
 *                         (pathspec 限定提交范围; 步骤 2→4 竞态按 no-op 语义)
 *   save.rev-parse        W11 git rev-parse HEAD → commit OID
 *   save.staged-check     service 层断言: 无关 staged 不被吞且保持 staged
 *                         (§5.2 实测固化行为; TC-GIT-002) → 违例 fail loud
 *   save.done             返回 {commitOid, changedFiles, …}
 *
 * 边界 (WP-1.5):
 *  - 不自动 commit: 本函数只由用户显式动作调用 (GUI「Save Research Checkpoint」);
 *    无定时器/事件/后台路径可达 (类型面 + tests/checkpoint/explicit-trigger.test.ts)。
 *  - 不碰 domain/plan/topology 内部: 不解析/校验 .research/ 内容, 不写
 *    ManagementAction (步骤 6 属 history/management 层, 本 WP 只交付 git 编排
 *    + 结构化结果供上层落 ManagementAction(CHECKPOINT_SAVED, …))。
 *  - 提交者身份用用户自己的 git config, 不覆盖 author/committer (§5)。
 *
 * 与 git 层组合原语 saveCheckpoint 的关系: git 层版本是「git 半边」纯编排
 * (供 TC-GIT-* 固化实测行为); 本 service 版本编排**同一组 W 原语**但追加
 * service 层职责 (每步日志、无关 staged 断言、非 repo 结构化拒绝、
 * changedFiles 汇总)。两者共用 W1–W13 原语, 无第二套 git 调用面。
 */
import {
  CHECKPOINT_MESSAGE_PREFIX,
  commitResearch,
  detectConflictState,
  detectRepo,
  GitCommandError,
  GitConflictStateError,
  GitInputError,
  revParseHead,
  RESEARCH_PATHSPEC,
  RESEARCH_STATE_EXCLUDE_SPEC,
  isWithinCommitScope,
  stageResearch,
  status,
  type GitStatus,
} from '../../git/index.js'
import { NotARepoError, StagedPreservationError } from './errors.js'
import type { StructuredLogger } from './logger.js'
import type { SaveCheckpointOptions, SaveCheckpointResult } from './types.js'

/**
 * 提交面判定 (repo-root-relative): `.research/**` 减去 `state/` 状态区
 * (V2-T2.4, design §3.3 — state/ 在 checkpoint 提交白名单之外: 独立模式
 * 的库目录是运行态数据, 永不入 commit). 与 W9/W10 pathspec 的提交范围
 * 一致, changedFiles / leftover 检查 / 「无关 staged」断言全部用同一口径.
 */
function isResearchPath(p: string): boolean {
  return isWithinCommitScope(p)
}

/** 人类可读的 status 条目描述 (断言快照用). */
function describeEntry(e: { kind: string; x: string; y: string; path: string; origPath?: string }): string {
  return `${e.kind} ${e.x}${e.y} ${e.path}${e.origPath ? ` (from ${e.origPath})` : ''}`
}

/**
 * service 层断言 (§5.2 实测固化, TC-GIT-002): checkpoint 不得吞掉或改动
 * 用户 `.research/**` 之外的 staged 条目 —— 它们必须**事后仍保持 staged**。
 *
 * 比较口径: checkpoint 前每个「无关且已 staged (x≠.)」的条目, checkpoint 后
 * 必须仍存在且 index 状态码 (x) 不变。被吞 (变 clean x=.) 或消失 → 违例。
 * 未 staged 的无关条目 (仅工作区脏 x=.) 不参与断言 (它们本就不在 commit 面,
 * §5.2 只固化 staged 行为)。
 *
 * 纯函数 (供单测直接驱动违例路径); 不抛 git, 只抛 service 断言错误。
 */
export function assertUnrelatedStagedPreserved(before: GitStatus, after: GitStatus): void {
  const foreignStagedBefore = before.entries
    .filter((e) => !isResearchPath(e.path))
    .filter((e) => e.x !== '.')
    .map((e) => ({ kind: e.kind, x: e.x, y: e.y, path: e.path }))
  const afterByPath = new Map(
    after.entries.filter((e) => !isResearchPath(e.path)).map((e) => [e.path, e] as const),
  )
  const violations: string[] = []
  for (const b of foreignStagedBefore) {
    const a = afterByPath.get(b.path)
    if (a === undefined) {
      violations.push(`${b.path} (was staged ${b.x}${b.y}) disappeared after checkpoint`)
    } else if (a.x !== b.x) {
      violations.push(`${b.path} staged state changed ${b.x}${b.y} → ${a.x}${a.y} (swallowed or unstaged)`)
    }
  }
  if (violations.length > 0) {
    throw new StagedPreservationError(
      foreignStagedBefore.map((e) => describeEntry(e)),
      violations,
    )
  }
}

/**
 * Save Research Checkpoint (用户显式触发; §5 全流程).
 *
 * @returns committed=false 且 commitOid=null = 无可提交内容 (成功空操作, §5 步骤 2)。
 * @throws NotARepoError          非 Git repo (§2, W1).
 * @throws GitConflictStateError  merge/rebase/cherry-pick/revert 进行中 (§5.1, INV-GIT-4).
 * @throws GitInputError          summary 非法 (§5 message 格式).
 * @throws StagedPreservationError 无关 staged 被破坏 (service 断言, §5.2).
 * @throws GitCommandError        repo 损坏等 git 自身报错 (§9 原样透传, 不修复).
 */
export async function saveResearchCheckpoint(root: string, opts: SaveCheckpointOptions): Promise<SaveCheckpointResult> {
  const logger = opts.logger

  // ── 输入校验 (先于任何 I/O): §5 commit message 格式 research: <摘要> ──
  if (typeof opts.summary !== 'string' || opts.summary.length === 0) {
    logger.error('save.input', { reason: 'empty-summary' })
    throw new GitInputError(
      'saveResearchCheckpoint: summary must be a non-empty string (message 格式: research: <摘要>, GIT_INTEGRATION §5)',
    )
  }
  logger.info('save.start', { root, summary: opts.summary })

  // ── 仓库检测 (W1, §2): 非 repo 结构化拒绝 ──
  const det = await detectRepo(root, opts)
  if (!det.ok) {
    logger.error('save.repo-detected', { root, ok: false, reason: det.reason })
    throw new NotARepoError(root)
  }
  logger.info('save.repo-detected', { root, repoRoot: det.repoRoot })

  // ── §5 步骤 1: 冲突状态检测 (每次 checkpoint 前必须执行, §5.1) ──
  const conflict = await detectConflictState(root, opts)
  if (conflict.inProgress) {
    logger.error('save.conflict-check', { gitDir: conflict.gitDir, flags: conflict.flags })
    // 复用 git 层结构化错误 (携带 flags; INV-GIT-4 fail loud)。
    // 双保险: 即便此处漏检, W10 pathspec commit 也会被 git 自身拒绝 (exit 128)。
    const { GitConflictStateError } = await import('../../git/index.js')
    const active: string[] = []
    if (conflict.flags.mergeHead) active.push('MERGE_HEAD (merge in progress)')
    if (conflict.flags.cherryPickHead) active.push('CHERRY_PICK_HEAD (cherry-pick in progress)')
    if (conflict.flags.revertHead) active.push('REVERT_HEAD (revert in progress)')
    if (conflict.flags.rebaseApply) active.push('rebase-apply/ (rebase in progress)')
    if (conflict.flags.rebaseMerge) active.push('rebase-merge/ (rebase in progress)')
    throw new GitConflictStateError(conflict.flags, active.join(', '))
  }
  logger.info('save.conflict-check', { gitDir: conflict.gitDir, inProgress: false })

  // ── §5 步骤 2: W4 status: 汇总 .research/** 待提交变更; 无变更 → 成功短路 ──
  const st = await status(root, { ...opts, includeBranch: true })
  const warnings: string[] = []
  if (st.head?.kind === 'detached') {
    warnings.push(
      'detached HEAD: checkpoint commit will land on a detached HEAD and may be lost (GIT_INTEGRATION §5)',
    )
  }
  const researchEntries = st.entries.filter((e) => isResearchPath(e.path))
  const changedFiles = [...new Set(researchEntries.map((e) => e.path))].sort()
  logger.info('save.status', {
    changedFiles,
    head: st.head ?? null,
    truncated: st.truncated,
  })
  if (researchEntries.length === 0) {
    // §5 步骤 2: 「无可提交内容」(成功, 不报错) — 无空 commit (TC-GIT-014)
    logger.info('save.no-op', { reason: 'no .research/** changes' })
    return { committed: false, commitOid: null, changedFiles: [], warnings }
  }

  // ── §5 步骤 3: W9 只暂存 .research 路径 (V2: 排除 state/ 状态区) ──
  await stageResearch(root, opts)
  logger.info('save.stage', { pathspec: RESEARCH_PATHSPEC, exclude: RESEARCH_STATE_EXCLUDE_SPEC })

  // ── §5 步骤 4: W10 pathspec 限定提交 (不含用户其他 staged changes, §5.2) ──
  const message = `${CHECKPOINT_MESSAGE_PREFIX}${opts.summary}`
  try {
    await commitResearch(root, message, opts)
  } catch (e) {
    // §5.2 实测: 步骤 2→4 之间变更消失的竞态 → pathspec commit exit 1
    // ("no changes added to commit"); V2 (T2.4, design §3.3): state/ 目录
    // 存在时 (独立模式) 同一竞态的消息是 "nothing added to commit but
    // untracked files present" (untracked = 被排除的 state/ 文件); 均按
    // 同一 no-op 语义处理 (成功空操作)。
    if (
      e instanceof GitCommandError &&
      e.exitCode === 1 &&
      /no changes added to commit|nothing added to commit|nothing to commit/i.test(
        `${e.stdout}\n${e.stderr}`,
      )
    ) {
      logger.warn('save.no-op', { reason: 'changes vanished between status and commit (§5.2 race)' })
      return { committed: false, commitOid: null, changedFiles: [], warnings }
    }
    logger.error('save.commit', { error: e instanceof Error ? e.message : String(e) })
    throw e
  }
  logger.info('save.commit', { message })

  // ── §5 步骤 5: W11 记录 commit OID ──
  const commitOid = await revParseHead(root, opts)
  logger.info('save.rev-parse', { commitOid })

  // ── service 层断言: 无关 staged 不被吞且保持 staged (§5.2, TC-GIT-002) ──
  const stAfter = await status(root, { ...opts, includeBranch: true })
  assertUnrelatedStagedPreserved(st, stAfter)
  const leftover = stAfter.entries.filter((e) => isResearchPath(e.path))
  if (leftover.length > 0) {
    // 异常: .research/** 在 add 之后又出现新变更 (并发写入)。不 unstage 任何
    // 内容 (INV: 从不 unstage), 只明确警告交用户处理。
    const w = `unexpected .research/** entries remain after commit: ${leftover.map((e) => e.path).join(', ')}`
    warnings.push(w)
    logger.warn('save.staged-check', { leftover: leftover.map((e) => e.path) })
  } else {
    logger.info('save.staged-check', { unrelatedStagedPreserved: true, researchClean: true })
  }

  // §5 步骤 6 (ManagementAction(CHECKPOINT_SAVED, git_commit_oid, git_blob_oids))
  // 属 history/management 层 — 本 WP 交付 commitOid + changedFiles 供上层落账。
  logger.info('save.done', { commitOid, changedFiles })
  return { committed: true, commitOid, changedFiles, warnings, message }
}
