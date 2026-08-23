/**
 * WP-6.3 — reconciliation 错误面（稳定机器码 + fail-loud）。
 *
 * 口径同 WP-6.1 `AuditError` / WP-6.2 `DiscoveryScannerError`: 稳定
 * 码 + 精确指名失败项; 本层全部错误都是**前置校验**类（输入/选择/
 * actor 面）— 本层无 I/O, 不存在执行期失败路径（结构性只读, 见
 * read-only.test.ts AST 证明）。
 */
import type { ReconcileErrorCode } from './types.js'

export class ReconcileError extends Error {
  readonly code: ReconcileErrorCode
  constructor(init: { code: ReconcileErrorCode; message: string; cause?: unknown }) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause })
    this.name = 'ReconcileError'
    this.code = init.code
  }
}

export function isReconcileError(error: unknown): error is ReconcileError {
  return error instanceof ReconcileError
}
