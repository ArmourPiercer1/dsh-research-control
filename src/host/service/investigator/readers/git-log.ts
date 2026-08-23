/**
 * WP-7.2 — reader 4/5: git log（计划书 §26.1 可读清单「Git history/diff」
 * 的 log 半边 — 经 git 白名单 W6 只读面, 与 audit strict 同一 git 纪律:
 * 唯一 git 面 + 白名单内只读操作 + 原样展示 git 错误, GIT_INTEGRATION §3）。
 *
 * 读什么（只读 — 类型面）: 声明式树路径的文件历史（W6 `logFile`:
 * `git log --format=%H%x1f%aI%x1f%s -- <path>`, §3 冻结建议格式串）+
 * 当前 HEAD OID（W 面 `revParseHead`）。内容历史由 Git 负责（§22.3
 * 「插件不实现自己的文件历史系统」）— 本 reader 只透出 git 事实,
 * 不做 checkpoint 语义（checkpoint 版本面归 §5 getGitHistory RPC）。
 *
 * 范围 → 路径换算（调用方 face 提供, 本 reader 不持树）:
 *  - workstream scope → `.research/topics/<t>/workstreams/<w>`;
 *  - topic scope      → `.research/topics/<t>`;
 *  - project scope    → `.research`（整棵声明式树）。
 * 换算责任在 face（它持有 fresh 树 — 文件即真值）; 换算失败（未知
 * topic/ws）= RD_INPUT 大声（face 抛 ReaderError 原样透传, 其他错误
 * 包 RD_GIT_LOG）。
 *
 * 只读边界: 本类只有 `read(scope)`; 唯一 git 能力来源 = src/host/git
 * 公开面 W6/rev-parse（白名单内只读 — 与 audit strict 同款纪律）。
 */

import { logFile, revParseHead, type GitOptions } from '../../../git/index.js'
import {
  assertInvestigationScope,
  ReaderError,
  type GitLogSnapshot,
  type InvestigationScope,
} from './types.js'

/** 默认历史窗口（§9 分页读取口径 — 调用方可注入更大值）。 */
export const DEFAULT_LOG_MAX_COUNT = 20

/**
 * reader 4 输入面（窄 face — 生产组装见 `from-wiring.ts`; 测试注入 stub）。
 * 全部成员都是只读操作。
 */
export interface GitLogReaderInput {
  /** Git repo 根（绝对路径 — W6 调用 `-C` 根, 路径参数 repo-root-relative）。 */
  readonly repoRoot: string
  /**
   * 范围 → 日志路径换算（repo-root-relative pathspec; 语义见模块头）。
   * 未知 scope id 必须抛 `ReaderError`（RD_INPUT — 原样透传, 不包第二层）。
   */
  readonly resolveLogPath: (scope: InvestigationScope) => string
  /** 历史窗口（缺省 {@link DEFAULT_LOG_MAX_COUNT}）。 */
  readonly maxCount?: number
  /** git wrapper 护栏（缺省 = git 层默认）。 */
  readonly gitOptions?: GitOptions
}

export class GitLogReader {
  readonly #maxCount: number

  constructor(readonly input: GitLogReaderInput) {
    if (input === null || typeof input !== 'object' || typeof input.resolveLogPath !== 'function') {
      throw new ReaderError('RD_INPUT', 'GitLogReader: input.resolveLogPath (a scope→path face) is required')
    }
    if (typeof input.repoRoot !== 'string' || input.repoRoot.length === 0) {
      throw new ReaderError('RD_INPUT', 'GitLogReader: input.repoRoot must be a non-empty absolute path')
    }
    const maxCount = input.maxCount ?? DEFAULT_LOG_MAX_COUNT
    if (!Number.isSafeInteger(maxCount) || maxCount < 0) {
      throw new ReaderError('RD_INPUT', `GitLogReader: input.maxCount must be a non-negative safe integer (got ${String(maxCount)})`)
    }
    this.#maxCount = maxCount
  }

  /** 读取声明式树路径的 git 历史（只读）。失败 = `ReaderError`（RD_GIT_LOG/RD_INPUT）。 */
  async read(scope: InvestigationScope): Promise<GitLogSnapshot> {
    assertInvestigationScope(scope)
    const path = this.input.resolveLogPath(scope)
    if (typeof path !== 'string' || path.length === 0) {
      throw new ReaderError('RD_INPUT', 'gitLog: the resolveLogPath face must return a non-empty pathspec')
    }
    try {
      const [entries, head] = await Promise.all([
        logFile(this.input.repoRoot, path, {
          maxCount: this.#maxCount,
          ...(this.input.gitOptions !== undefined ? { gitOptions: this.input.gitOptions } : {}),
        }),
        revParseHead(this.input.repoRoot, this.input.gitOptions).catch((cause: unknown) => {
          // 空仓（尚无提交）合法 — log 空列表; HEAD 不可解析 = null 诚实透出。
          if (cause instanceof Error && /not a git repository|no commits yet|unknown revision/i.test(cause.message)) {
            return null
          }
          throw new ReaderError('RD_GIT_LOG', `gitLog: HEAD resolution failed: ${causeMessage(cause)}`, { cause })
        }),
      ])
      return {
        path,
        headOid: head,
        entries,
        maxCount: this.#maxCount,
      }
    } catch (cause) {
      if (cause instanceof ReaderError) throw cause
      throw new ReaderError('RD_GIT_LOG', `gitLog: the git log face failed: ${causeMessage(cause)}`, { cause })
    }
  }
}

function causeMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
