/**
 * WP-1.2 — Git wrapper: error taxonomy.
 *
 * Maps GIT_INTEGRATION §9 错误分类 to typed errors so the service layer
 * (WP-1.5) can fail loud without string-matching git output.
 */
import type { ConflictFlags } from './types.js'

export class GitError extends Error {
  readonly code: string
  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = new.target.name
    this.code = code
  }
}

/** Git executable missing / spawn ENOENT (§2, §9「Git 可执行缺失」). */
export class GitMissingError extends GitError {
  constructor(message: string, options?: ErrorOptions) {
    super('GIT_MISSING', message, options)
  }
}

/** 命令超时 (默认 10s) — kill 后按错误处理, 不重试自动写操作 (§1.9, §9). */
export class GitTimeoutError extends GitError {
  readonly command: string[]
  readonly timeoutMs: number
  constructor(command: string[], timeoutMs: number) {
    super('GIT_TIMEOUT', `Git 操作超时 (${timeoutMs}ms): git ${command.join(' ')}`)
    this.command = command
    this.timeoutMs = timeoutMs
  }
}

/** Non-zero exit outside a specific known class — git 自身报错, 原样展示 (§9「repo 损坏」). */
export class GitCommandError extends GitError {
  readonly command: string[]
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
  constructor(command: string[], exitCode: number, stdout: string, stderr: string) {
    super('GIT_COMMAND', `git ${command.join(' ')} exited ${exitCode}${stderr.trim() ? `: ${stderr.trim()}` : ''}`)
    this.command = command
    this.exitCode = exitCode
    this.stdout = stdout
    this.stderr = stderr
  }
}

/** 白名单外命令 (INV-GIT-7 运行时面) — 不可达. */
export class GitWhitelistViolationError extends GitError {
  readonly attempted: string[]
  constructor(attempted: string[]) {
    super('GIT_WHITELIST', `git command not in W1–W13 whitelist (INV-GIT-7): git ${attempted.join(' ')}`)
    this.attempted = attempted
  }
}

/** merge/rebase/cherry-pick 进行中 (INV-GIT-4 fail loud). */
export class GitConflictStateError extends GitError {
  readonly flags: ConflictFlags
  constructor(flags: ConflictFlags, detail: string) {
    super('GIT_CONFLICT', `repository is in a conflict/in-progress state — ${detail} (INV-GIT-4)`)
    this.flags = flags
  }
}

/** 路径越出 .research/** 边界 (INV-GIT-3, §6 restore 仅 .research/**). */
export class GitScopeViolationError extends GitError {
  constructor(path: string) {
    super('GIT_SCOPE', `path escapes the .research/ scope (INV-GIT-3): ${path}`)
  }
}

/** Invalid caller input (bad OID shape, pathspec not under .research/…). */
export class GitInputError extends GitError {
  constructor(message: string) {
    super('GIT_INPUT', message)
  }
}
