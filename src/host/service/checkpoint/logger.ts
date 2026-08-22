/**
 * WP-1.5 — checkpoint/restore/diff 服务: 结构化日志注入面.
 *
 * 任务书「显式触发面」要求: 全部方法一步一结构化日志, logger 注入。
 * 接口刻意最小 (level + event + 结构化字段): service 层不绑定任何具体
 * 日志后端 (host adapter / GUI 各自接线); 不提供默认实现 — 缺 logger
 * 是编译期错误, 从类型面排除「无观测的隐式调用」。
 *
 * 事件命名约定: `<op>.<step>` (op ∈ save/restore/diff), 每步恰好一条
 * info (成功路径) 或 error (该步拒绝/失败), 关键分叉另有 warn —
 * 精确序列由 tests/checkpoint/explicit-trigger.test.ts 行为面锁定。
 */
export type LogLevel = 'info' | 'warn' | 'error'

export interface StructuredLogger {
  info(event: string, fields?: Readonly<Record<string, unknown>>): void
  warn(event: string, fields?: Readonly<Record<string, unknown>>): void
  error(event: string, fields?: Readonly<Record<string, unknown>>): void
}
