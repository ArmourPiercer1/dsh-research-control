/**
 * WP-1.5 — checkpoint/restore/diff 服务: 错误分类.
 *
 * 分工 (与 src/host/git 错误分类的关系):
 *  - git 层错误 (GitError 家族, 已结构化: 白名单/超时/命令失败/冲突态/
 *    越界/输入) **原样透传** — 本层不重新包装, 不丢失 git 精确信息
 *    (§9「repo 损坏 → 原样展示 git 错误; 插件不尝试修复」);
 *  - 本层只新增 **service 层自身不变量** 的错误 (非 repo 目录、staged
 *    保护断言、restore 定位/失败/校验), 一律继承 {@link CheckpointServiceError}。
 *
 * 显式触发面: 这些错误只在显式调用的同步执行路径上抛出 — 无任何后台
 * 路径可以产生它们 (类型面 + 静态断言, tests/checkpoint/explicit-trigger.test.ts)。
 */
import type { ResearchLoadError } from '../../domain/loader/index.js'

export class CheckpointServiceError extends Error {
  /** 稳定机器码 (`CP_*`), GUI/RPC 按 code 分派, 不解析 message 文本. */
  readonly code: string
  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = new.target.name
    this.code = code
  }
}

/** 目录不是 Git repo (W1 检测失败; GIT_INTEGRATION §2 拒绝 managed mode). */
export class NotARepoError extends CheckpointServiceError {
  readonly root: string
  constructor(root: string) {
    super('CP_NOT_A_REPO', `directory is not a Git repository (GIT_INTEGRATION §2): ${root}`)
    this.root = root
  }
}

/**
 * 无关 staged 条目在 checkpoint 后被改变 (GIT_INTEGRATION §5.2 实测固化
 * 行为的 service 层断言, TC-GIT-002): 未进入 commit **且** 事后仍保持
 * staged — 任一被破坏即 fail loud。
 */
export class StagedPreservationError extends CheckpointServiceError {
  /** checkpoint 前无关条目快照 (人类可读). */
  readonly expected: string[]
  /** checkpoint 后无关条目快照 (人类可读). */
  readonly actual: string[]
  constructor(expected: string[], actual: string[]) {
    super(
      'CP_STAGED_NOT_PRESERVED',
      `checkpoint altered unrelated staged entries (GIT_INTEGRATION §5.2: 无关 staged 不被吞且保持 staged) — ` +
        `before=[${expected.join(' | ')}] after=[${actual.join(' | ')}]`,
    )
    this.expected = expected
    this.actual = actual
  }
}

/**
 * restore 定位失败 (W6 文件历史中无该 commit — 该版本从未触碰过该路径,
 * §6「log 定位」)。`knownVersionOids` = 该路径实际存在的版本 (截断展示)。
 */
export class RestoreNotInHistoryError extends CheckpointServiceError {
  readonly commitOid: string
  readonly path: string
  readonly knownVersionOids: string[]
  constructor(commitOid: string, path: string, knownVersionOids: string[]) {
    super(
      'CP_RESTORE_NOT_IN_HISTORY',
      `commit ${commitOid} is not in the history of ${path} — nothing to restore from (W6 log 定位, §6)`,
    )
    this.commitOid = commitOid
    this.path = path
    this.knownVersionOids = knownVersionOids
  }
}

/**
 * restore 在 git 层失败 (W7 show / W8 restore 的 git 自身报错)。
 * TC-GIT-005 语义: **精确报错** (cause 携带 git 原始 stderr) 且
 * **工作副本不被破坏到不可检态** — `workingCopyIntact` (失败后重读
 * working copy 与失败前一致) + `workingCopyLoaderErrors` (恢复后
 * loader 仍可运行并精确定位, 即「可检」的证明)。
 */
export class RestoreFailedError extends CheckpointServiceError {
  readonly commitOid: string
  readonly path: string
  /** git 层错误 (GitCommandError 等, 原样保留; §9 原样展示). */
  readonly cause: unknown
  /** true = 失败后重读 working copy, 与失败前逐字节一致 (未被破坏). */
  readonly workingCopyIntact: boolean
  /** 失败后对整个 working copy 的 loader 校验 (可检态证明; 精确错误列表). */
  readonly workingCopyLoaderErrors: ResearchLoadError[]
  constructor(fields: {
    commitOid: string
    path: string
    cause: unknown
    workingCopyIntact: boolean
    workingCopyLoaderErrors: ResearchLoadError[]
  }) {
    super(
      'CP_RESTORE_FAILED',
      `restore of ${fields.path} from ${fields.commitOid} failed: ${describeCause(fields.cause)} — ` +
        `working copy ${fields.workingCopyIntact ? 'intact (未被失败的恢复破坏)' : 'MODIFIED — 需立即检查'}; ` +
        `loader reported ${fields.workingCopyLoaderErrors.length} error(s)`,
      { cause: fields.cause instanceof Error ? fields.cause : undefined },
    )
    this.commitOid = fields.commitOid
    this.path = fields.path
    this.cause = fields.cause
    this.workingCopyIntact = fields.workingCopyIntact
    this.workingCopyLoaderErrors = fields.workingCopyLoaderErrors
  }
}

/**
 * 恢复落盘校验失败 (W8 声称成功但 working copy 与历史版本逐字节不一致 —
 * git 层异常, 按 fail loud 处理; 正常情况下不可达)。
 */
export class RestoreVerifyError extends CheckpointServiceError {
  readonly commitOid: string
  readonly path: string
  readonly expectedBytes: number
  readonly actualBytes: number
  constructor(commitOid: string, path: string, expectedBytes: number, actualBytes: number) {
    super(
      'CP_RESTORE_VERIFY',
      `post-restore content mismatch for ${path} @ ${commitOid}: expected ${expectedBytes} bytes from history, working copy has ${actualBytes}`,
    )
    this.commitOid = commitOid
    this.path = path
    this.expectedBytes = expectedBytes
    this.actualBytes = actualBytes
  }
}

function describeCause(cause: unknown): string {
  if (cause instanceof Error) {
    // GitCommandError 的 message 已含 exit code + stderr 首行 (§9 原样展示面)
    return cause.message
  }
  return String(cause)
}
