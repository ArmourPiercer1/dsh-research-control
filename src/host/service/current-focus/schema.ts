/**
 * UI0 (R-01) — `current_focus` 表: DDL + 行↔记录映射 + SQL（纯数据, 零 I/O）。
 *
 * 表（冻结语义, 逐字 — 三列, 无第四列）:
 *   - `current_focus` — PK `workstream_id`（Workstream 级单值指针; 每个
 *     Workstream 至多一行 — 单值约束由 PK 钉死）; `plan_item_id` = 该
 *     Workstream **当前 canonical Plan** 中的一个 Task/Gate/Milestone
 *     item id（成员校验在 service 边界 — 本表不 join、不 CHECK 第二
 *     真源）; `updated_at` = epoch ms（A-3 时间边界）。
 *
 * **不建第二套 truth**: 标题 / item kind / project id / execution state /
 * validation state / user note / revision history 一律**不入表** — 它们
 * 各有自己的真源（plan.yaml + 声明式定义文件 / Run / validation 模块 /
 * 用户注记面）, 读取时从真源取。本表只存指针三列。
 *
 * DatabaseSync 封装模式（同 WP-3.1 planfork / WP-3.5 intervention /
 * WP-5.2 actions 先例）:
 *   1. DB 文件 open/初始化归 WP-2.1 `openDatabase`（wiring 装配 — 后续
 *      集成任务; 本任务不接 wiring）;
 *   2. 本模块 DDL 在连接上以幂等 `IF NOT EXISTS` 应用
 *     （`CurrentFocusStore` 构造时经注入 `PlanForkDb.exec` — 驱动是
 *      注入的 I/O, 零 sqlite import, ARCHITECTURE §2.2）;
 *   3. 多连接 WAL 共存, 写经文件锁串行化（busy_timeout 同 store 默认）。
 *
 * 行形状（唯一映射）= `CurrentFocusRecord`（types.ts）: 列名 snake_case
 * ↔ 记录键 camelCase, 逐列校验（corrupt 行 ⇒ CF_STORE — 不猜、不修）。
 *
 * 写入面: 只有 UPSERT（set = 不存在则创建 / 已存在则覆盖）+ DELETE
 * （clear = 用户显式清除 / revalidate 发现目标被移出 canonical Plan
 * 时的自动清除）。无状态机、无事件、无触发器 — 指针是 operational
 * 偏好缓存, 不是 identity 行（§15 通则 / INV-HIST-7 的 no-delete 约束
 * 不适用: 清除是产品语义本身）。
 */

import { CurrentFocusError, type CurrentFocusRecord } from './types.js'

export const CURRENT_FOCUS_TABLE = 'current_focus'

const DDL = `
CREATE TABLE IF NOT EXISTS ${CURRENT_FOCUS_TABLE} (
  workstream_id TEXT PRIMARY KEY,
  plan_item_id  TEXT NOT NULL,
  updated_at    INTEGER NOT NULL
);
`

/** Full DDL (idempotent — re-applied on every store open, 同 planfork /
 *  flooding / actions 先例). */
export function currentFocusDdl(): string {
  return DDL
}

/** Tables this module's DDL declares (EXPECTED-tables 诊断面). */
export const CURRENT_FOCUS_TABLES = [CURRENT_FOCUS_TABLE] as const

/* ------------------------------------------------------------------ *
 * SQL statements（参数化; 驱动经 PlanForkDb 端口）
 * ------------------------------------------------------------------ */

/** Get — 按 workstream_id 查单行（PK 查找; 无行 ⇒ undefined）。 */
export const SQL_GET_CURRENT_FOCUS = `
SELECT workstream_id, plan_item_id, updated_at
FROM ${CURRENT_FOCUS_TABLE}
WHERE workstream_id = ?
`

/**
 * Set / Replace — UPSERT: 不存在则创建, 已存在则覆盖为新目标
 * （`ON CONFLICT(workstream_id) DO UPDATE` — 同 WP-2.9 attention
 * upsert 先例; 单语句原子, PK 冲突即覆盖, 无中间态）。
 */
export const SQL_UPSERT_CURRENT_FOCUS = `
INSERT INTO ${CURRENT_FOCUS_TABLE} (workstream_id, plan_item_id, updated_at)
VALUES (?, ?, ?)
ON CONFLICT(workstream_id) DO UPDATE SET
  plan_item_id = excluded.plan_item_id,
  updated_at   = excluded.updated_at
`

/** Clear — 按 workstream_id 删除（返回受影响行数: 1 = 删了, 0 = 无行）。 */
export const SQL_DELETE_CURRENT_FOCUS = `
DELETE FROM ${CURRENT_FOCUS_TABLE}
WHERE workstream_id = ?
`

/* ------------------------------------------------------------------ *
 * Row ↔ record mapping（逐列校验 — corrupt 行大声, 不猜）
 * ------------------------------------------------------------------ */

/**
 * Map one `current_focus` row to a `CurrentFocusRecord` (column order =
 * DDL). A corrupt row (non-string id / non-integer stamp) is a hard
 * CF_STORE failure — the row is user data the module wrote itself;
 * nothing here repairs it.
 */
export function rowToCurrentFocus(row: Record<string, unknown>): CurrentFocusRecord {
  const workstreamId = row.workstream_id
  if (typeof workstreamId !== 'string' || workstreamId.length === 0) {
    throw new CurrentFocusError({
      code: 'CF_STORE',
      message: `current_focus.workstream_id: expected a non-empty string (got ${JSON.stringify(workstreamId)})`,
    })
  }
  const planItemId = row.plan_item_id
  if (typeof planItemId !== 'string' || planItemId.length === 0) {
    throw new CurrentFocusError({
      code: 'CF_STORE',
      message: `current_focus.plan_item_id: expected a non-empty string (got ${JSON.stringify(planItemId)})`,
    })
  }
  const updatedAt = row.updated_at
  if (typeof updatedAt !== 'number' || !Number.isInteger(updatedAt)) {
    throw new CurrentFocusError({
      code: 'CF_STORE',
      message: `current_focus.updated_at: expected an integer epoch-ms stamp (got ${JSON.stringify(updatedAt)})`,
    })
  }
  return { workstreamId, planItemId, updatedAt }
}
