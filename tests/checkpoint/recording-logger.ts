/**
 * WP-1.5 测试基建 — 记录式 `StructuredLogger` (真实调用捕获每步日志).
 *
 * 「一步一结构化日志」的行为面验证工具: 测试断言**完整事件序列**
 * (顺序 + 级别), 从而锁定每个公开方法的显式步骤路径。
 */
import type { LogLevel, StructuredLogger } from '../../src/host/service/checkpoint/index.js'

export interface LogRecord {
  level: LogLevel
  event: string
  fields?: Readonly<Record<string, unknown>>
}

export class RecordingLogger implements StructuredLogger {
  readonly records: LogRecord[] = []

  info(event: string, fields?: Readonly<Record<string, unknown>>): void {
    this.records.push({ level: 'info', event, fields })
  }
  warn(event: string, fields?: Readonly<Record<string, unknown>>): void {
    this.records.push({ level: 'warn', event, fields })
  }
  error(event: string, fields?: Readonly<Record<string, unknown>>): void {
    this.records.push({ level: 'error', event, fields })
  }

  /** 全部事件名 (按发生顺序). */
  events(): string[] {
    return this.records.map((r) => r.event)
  }

  recordsOf(event: string): LogRecord[] {
    return this.records.filter((r) => r.event === event)
  }
}
