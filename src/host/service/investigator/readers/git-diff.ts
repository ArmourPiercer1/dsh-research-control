/**
 * WP-7.2 — reader 3/5: git diff（计划书 §26.1 可读清单「Git history/diff」
 * 的 diff 半边 — 经 audit strict 面）。
 *
 * 读什么（只读 — 类型面）: 注册 workspace 的 strict git audit 结构化
 * 报告（`runStrictAudit` — W1 仓库检测 / W4 status 分类 / W5 diff 摘要 /
 * W13 ls-files 枚举, GIT_INTEGRATION §8 第一层; 全部经 git wrapper
 * 白名单的**自动触发只读操作** — 该面自己的只读边界见 WP-6.1:
 * 零 fs / 零 spawn / 与 §5.1 冲突检测正交）。
 *
 * 本 reader 是**纯门面**: 不做二次投影、不加语义、不改报告（输出 =
 * `AuditReport` 原样, 类型面 `GitDiffSnapshot` 即其别名）— audit 层是
 * git 事实的单一真源, 第二套投影 = 漂移面（同 WP-6.3 消费口径）。
 *
 * 范围语义: audit 是 workspace 级事实（报告路径一律 repo-root-relative）—
 * 读者接受 scope 参数但**不**按 scope 过滤报告（workspace 外无 git 事实;
 * 调用方按 `path` 前缀自行取子集 — 组装器文档注明）。
 *
 * 只读边界: 本类只有 `read(scope)`; 唯一 git 能力来源 = audit 层（其唯一
 * git 面 = src/host/git 白名单 W1/W4/W5/W13）。失败 = `ReaderError`
 * （RD_GIT_DIFF — 非 repo / git 命令错误原样大声, cause 保留）。
 */

import {
  NotARepoAuditError,
  type AuditPolicy,
  type StrictAuditOptions,
} from '../../../audit/strict/index.js'
import { runStrictAudit } from '../../../audit/strict/index.js'
import type { GitOptions } from '../../../git/index.js'
import {
  assertInvestigationScope,
  ReaderError,
  type InvestigationScope,
  type GitDiffSnapshot,
} from './types.js'

/**
 * reader 3 输入面（窄 face — 生产组装见 `from-wiring.ts`; 测试注入 stub）。
 * 全部成员都是只读操作。
 */
export interface GitDiffReaderInput {
  /** 注册 workspace 根（绝对路径 = 建议 repo root, GIT_INTEGRATION §2）。 */
  readonly workspaceRoot: string
  /**
   * 归一化 policy 面（`normalizeWorkspacePolicy` 输出; 无 workspace.yaml
   * = `null` ⇒ audit 全工程默认）。fresh 读取 — 文件即真值。
   */
  readonly policy: () => AuditPolicy | null
  /** git wrapper 护栏（缺省 = git 层默认 超时/输出上限）。 */
  readonly gitOptions?: GitOptions
}

export class GitDiffReader {
  constructor(readonly input: GitDiffReaderInput) {
    if (input === null || typeof input !== 'object' || typeof input.policy !== 'function') {
      throw new ReaderError('RD_INPUT', 'GitDiffReader: input.policy (a normalized-policy face) is required')
    }
    if (typeof input.workspaceRoot !== 'string' || input.workspaceRoot.length === 0) {
      throw new ReaderError('RD_INPUT', 'GitDiffReader: input.workspaceRoot must be a non-empty absolute path')
    }
  }

  /** 读取 workspace 的 strict git audit 报告（只读）。失败 = `ReaderError`（RD_GIT_DIFF）。 */
  async read(_scope: InvestigationScope): Promise<GitDiffSnapshot> {
    assertInvestigationScope(_scope)
    let policy: AuditPolicy | null
    try {
      policy = this.input.policy()
    } catch (cause) {
      throw new ReaderError('RD_GIT_DIFF', `gitDiff: the policy face failed: ${causeMessage(cause)}`, { cause })
    }
    const options: StrictAuditOptions = {
      workspaceRoot: this.input.workspaceRoot,
      ...(policy !== null ? { policy } : {}),
      ...(this.input.gitOptions !== undefined ? { gitOptions: this.input.gitOptions } : {}),
    }
    try {
      return await runStrictAudit(options)
    } catch (cause) {
      if (cause instanceof NotARepoAuditError) {
        throw new ReaderError('RD_GIT_DIFF', `gitDiff: ${cause.message}`, { cause })
      }
      throw new ReaderError('RD_GIT_DIFF', `gitDiff: strict audit failed: ${causeMessage(cause)}`, { cause })
    }
  }
}

function causeMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
