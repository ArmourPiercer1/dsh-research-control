/**
 * WP-5.1 — intervention 表生命周期 SQL（纯数据, 零 I/O）。
 *
 * 表 DDL / 行映射 / INSERT / 查询 SQL 的**单一来源在 WP-3.5**
 * `service/flooding/schema.ts`（本模块原样复用, 不复制 — 决策见报告
 * 「实现要点 1」: 复用既有表, 不迁移新模块、不建第二张表）。本文件只
 * 交付 WP-5.1 新增的唯一 SQL: 状态缓存列的条件 UPDATE。
 *
 * 冻结触发器语义（flooding DDL `intervention_no_content_update`）:
 * 创建后**只有** status/closed_at/resolution_note 三个状态缓存列可
 * UPDATE（§13 迁移的合法行侧面 — 仅用户, INV-PERM-4）。本 SQL 恰好只
 * 触这三列; 任何内容列写入会被存储层 trigger ABORT（任何连接生效,
 * 双保险）。
 *
 * 乐观并发门 `AND status = ?`（同 WP-4.1a 原线面 / planfork 条件 UPDATE
 * 模式）: 迁移前读到的状态与写时不一致 ⇒ 0 行 ⇒ service 大声失败
 * （IV_CONCURRENT_STATE）, 不猜。
 */

import { INTERVENTION_TABLE } from '../flooding/index.js'

/**
 * 状态缓存列条件 UPDATE（INV-PERM-4 用户面唯一行侧写; DDL 触发器放行的
 * 三列 = 本 SQL 的 SET 列表, 逐字对齐）。
 * 参数序: (status, closed_at, resolution_note, id, expectedStatus)。
 */
export const SQL_UPDATE_INTERVENTION_STATE =
  `UPDATE ${INTERVENTION_TABLE} SET status = ?, closed_at = ?, resolution_note = ? WHERE id = ? AND status = ?`
