/**
 * WP-1.2 — Git wrapper: Save Research Checkpoint 流程 (§5) 的 **git 半边**.
 *
 * 纯命令编排 (§5 步骤 1–5), 不实现 service 策略 — 步骤 6 (写
 * ManagementAction(CHECKPOINT_SAVED, …))、无可提交内容的用户文案与触发
 * 判定 (GUI 按钮) 属于 WP-1.5 service 层。本函数是**唯一写历史**的编排
 * (INV-GIT-2: 默认不静默 commit; checkpoint 仅用户显式触发)。
 *
 * 流程 (照录 §5; V2-T2.4: 提交面 = .research/** 减去 state/ 状态区,
 * design §3.3 — state/ 为独立模式库目录, 在 checkpoint 提交白名单之外):
 *   1. 冲突状态检测 (§5.1); 检测到 → 拒绝并提示用户先自行解决 (INV-GIT-4)
 *   2. git status --porcelain=v2: 汇总提交面内 (.research/**, 不含 state/)
 *      的待提交变更; 无变更 → 直接返回「无可提交内容」(成功, 不报错)
 *   3. git add -- .research/ ':(exclude).research/state/'              (W9)
 *   4. git commit -m "research: <摘要>" -- .research/
 *      ':(exclude).research/state/'                                   (W10)
 *   5. git rev-parse HEAD → 记录 commit OID            (W11)
 *   (6. [WP-1.5] 写 ManagementAction(CHECKPOINT_SAVED, git_commit_oid, git_blob_oids))
 *
 * 规则 (§5):
 *   - commit message 格式 `research: <摘要>`;
 *   - 提交者身份使用用户自己的 git config, 本层不覆盖 author/committer;
 *   - **不包含**用户其他 staged changes, **不修改**用户其他 staged 状态
 *     (pathspec commit 实测行为, §5.2, TC-GIT-002 固化为回归);
 *   - detached HEAD: 允许但给出明确警告 (warnings);
 *   - 步骤 3–4 中断 (进程被杀等) 最坏结果: .research/ 变更停留在 staged
 *     状态, 用户可自行 `git restore --staged` 或再次 checkpoint (不会损坏仓库)。
 *
 * §5.2 实测行为 (2026-08-21) 固化:
 *   「.research/ 无变更时执行 pathspec commit → 失败 exit 1 ("no changes
 *   added to commit") -> 流程步骤 2 前置短路, 视为成功空操作」— 正常路径由
 *   步骤 2 前置短路覆盖; 步骤 2→4 之间变更消失的竞态按同一语义处理 (下方
 *   catch), 保持「成功空操作」而非报错。
 */
import { GitCommandError, GitInputError } from './errors.js'
import { assertNoConflictState, detectConflictState } from './conflict.js'
import { commitResearch, revParseHead, stageResearch, status } from './operations.js'
import { isWithinCommitScope } from './whitelist.js'
import type { CheckpointResult, GitOptions } from './types.js'

/**
 * Save Research Checkpoint 的 git 半边 (§5 步骤 1–5)。
 *
 * @param root workspace root (建议 = repo root; `.research/` pathspec 相对
 *   repo 根 — workspace root ≠ repo root 的前缀换算由 WP-1.5 service 层负责)。
 * @param summary commit message 摘要; 最终 message 为 `research: <summary>`。
 *
 * @returns committed=false 表示步骤 2 短路「无可提交内容」(成功, 不报错)。
 * @throws GitConflictStateError merge/rebase/cherry-pick/revert 进行中
 *   (INV-GIT-4 fail loud; §5.1 双保险的「检测」半边 — 即便漏检, git 自身
 *   也会拒绝 pathspec commit, exit 128)。
 * @throws GitCommandError repo 损坏等 git 自身报错 (§9: 原样展示, 不修复)。
 */
export async function saveCheckpoint(
  root: string,
  summary: string,
  opts?: GitOptions,
): Promise<CheckpointResult> {
  if (typeof summary !== 'string' || summary.length === 0) {
    throw new GitInputError('summary must be a non-empty string (message 格式: research: <摘要>, §5)')
  }
  const warnings: string[] = []

  // ── 步骤 1: 冲突状态检测 (每次 checkpoint 前必须执行, §5.1) ──
  const conflict = await detectConflictState(root, opts)
  assertNoConflictState(conflict)

  // ── 步骤 2: 汇总 .research/** 待提交变更; 无变更 → 成功短路 ──
  const st = await status(root, { ...opts, includeBranch: true })
  if (st.head?.kind === 'detached') {
    // §5: detached HEAD 状态: 允许但给出明确警告 (提交会落在游离 HEAD 上, 可能被丢弃)
    warnings.push(
      'detached HEAD: checkpoint commit will land on a detached HEAD and may be lost (GIT_INTEGRATION §5)',
    )
  }
  // V2 (design §3.3): commit scope = .research/** minus the state/ sub-directory
  // (the runtime database area is outside the checkpoint commit whitelist) —
  // the same scope W9/W10's pathspec stages/commits, so a state/-only change
  // short-circuits here as 「无可提交内容」 instead of staging nothing.
  const researchEntries = st.entries.filter((e) => isWithinCommitScope(e.path))
  if (researchEntries.length === 0) {
    // 「无可提交内容」(成功, 不报错)
    return { committed: false, shortCircuited: true, commitOid: null, warnings }
  }

  // ── 步骤 3: git add -- .research/ (只暂存 .research 路径) ──
  await stageResearch(root, opts)

  // ── 步骤 4: pathspec 限定提交 (不含用户其他 staged changes, §5.2 实测) ──
  try {
    await commitResearch(root, `research: ${summary}`, opts)
  } catch (e) {
    // §5.2 实测: .research/ 无变更时 pathspec commit → exit 1 "no changes
    // added to commit" (消息在 stdout)。V2 补充 (T2.4, design §3.3): state/
    // 目录存在时 (独立模式) 同一竞态的消息是 "nothing added to commit but
    // untracked files present" (untracked = 被排除的 state/ 文件) — 同一
    // no-op 语义。步骤 2 前置短路是主路径; 这里覆盖步骤 2→4 之间的竞态
    // (变更恰好消失), 按同一语义视为成功空操作。
    if (
      e instanceof GitCommandError &&
      e.exitCode === 1 &&
      /no changes added to commit|nothing added to commit|nothing to commit/i.test(
        `${e.stdout}\n${e.stderr}`,
      )
    ) {
      return { committed: false, shortCircuited: true, commitOid: null, warnings }
    }
    throw e
  }

  // ── 步骤 5: git rev-parse HEAD → 记录 commit OID ──
  const commitOid = await revParseHead(root, opts)

  // 步骤 6 (ManagementAction(CHECKPOINT_SAVED)) 是 WP-1.5 service 半边, 此处不实现。
  return { committed: true, shortCircuited: false, commitOid, warnings }
}
