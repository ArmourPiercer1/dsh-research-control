/**
 * WP-6.1 — strict git audit: 错误分类.
 *
 * 分工 (与 src/host/git 错误分类的关系, 同 WP-1.5 checkpoint/errors.ts 口径):
 *  - git 层错误 (GitError 家族, 已结构化: 白名单/超时/命令失败/输入/越界)
 *    **原样透传** — 本层不重新包装, 不丢失 git 精确信息
 *    (GIT_INTEGRATION §9「repo 损坏 → 原样展示 git 错误; 插件不尝试修复」);
 *  - 本层只新增 **audit 层自身不变量** 的错误 (非 repo 目录、baseline 形状、
 *    policy 形状), 一律继承 {@link AuditError}。
 *
 * 只读边界: audit 从不执行写操作, 因此不存在 checkpoint 侧的
 * StagedPreservation/Restore 一类「写后校验」错误 — 错误面只有**前置输入
 * 校验**与**git 透传**两类 (结构上无写失败路径, 见 read-only 静态测试)。
 */

/** audit 层服务错误基类。code = 稳定机器码 (`AUDIT_*`), 不解析 message 文本。 */
export class AuditError extends Error {
  readonly code: string
  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = new.target.name
    this.code = code
  }
}

/** 目录不是 Git repo (W1 检测失败; GIT_INTEGRATION §2 — 未注册 workspace 拒绝 audit). */
export class NotARepoAuditError extends AuditError {
  readonly root: string
  constructor(root: string) {
    super('AUDIT_NOT_A_REPO', `directory is not a Git repository (GIT_INTEGRATION §2): ${root}`)
    this.root = root
  }
}

/** 输入形状非法 (baseline 非 40-hex OID、workspaceRoot 空路径等) — spawn 之前拒绝. */
export class AuditInputError extends AuditError {
  constructor(message: string) {
    super('AUDIT_INPUT', message)
  }
}

/** workspace policy 形状非法 (§14.1 归一化防御面 — 正常经 loader 校验的文档不应触达). */
export class AuditPolicyError extends AuditError {
  constructor(message: string) {
    super('AUDIT_POLICY', message)
  }
}
