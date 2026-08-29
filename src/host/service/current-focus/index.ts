/**
 * UI0 (R-01) — `src/host/service/current-focus` — public surface。
 *
 * Current Focus（Workstream 级、USER 拥有、单值 operational 指针, 指向
 * 该 Workstream 当前 canonical Plan 中的一个 Task/Gate/Milestone）:
 *
 *   - 持久化: `current_focus` 三列表（PK workstream_id — 单值; 不建第二
 *     套 truth: 无 title/kind/project/state/note/revision 列）;
 *   - 存储面: `CurrentFocusStore`（get / set(UPSERT) / clear — 行侧机械
 *     动作; 复用 WP-3.1 `PlanForkDb` 结构端口, 不新造端口）;
 *   - 业务面: `CurrentFocusService`（USER 语义 set/clear/get + Plan
 *     mutation 后 `revalidate` — canonical 成员门 + 自动清除;
 *     execution/validation/Run/Blocker/Objective 变化不触碰本指针, 亦无
 *     钩子）;
 *   - **本任务不做**（后续集成任务范围）: RPC 注册 / UI 面 / wiring 装配
 *     （canonical provider 的生产接法 = PlanStore.loadPlan()）。
 *
 * 分层定位（ARCHITECTURE §2.2）: host service 层 — 零 DSH import
 * （INV-PERM-5）、零 sqlite import（驱动是注入的 I/O）。
 */

// Type surface (records / revalidate outcome / error taxonomy)。
export {
  CurrentFocusError,
  isCurrentFocusError,
  type CurrentFocusErrorCode,
  type CurrentFocusRecord,
  type CurrentFocusRevalidateOutcome,
} from './types.js'

// DDL + 行↔记录映射 + 参数化 SQL（DDL 单一来源）。
export {
  currentFocusDdl,
  CURRENT_FOCUS_TABLE,
  CURRENT_FOCUS_TABLES,
  rowToCurrentFocus,
  SQL_DELETE_CURRENT_FOCUS,
  SQL_GET_CURRENT_FOCUS,
  SQL_UPSERT_CURRENT_FOCUS,
} from './schema.js'

// 存储面（get / set(UPSERT) / clear; 幂等 DDL 构造时应用）。
export { CurrentFocusStore, type CurrentFocusStoreOptions } from './store.js'

// USER 业务面（set / clear / get / revalidate — canonical 成员门）。
export {
  CurrentFocusService,
  type CanonicalPlanItemIdsProvider,
  type CurrentFocusServiceOptions,
} from './service.js'
