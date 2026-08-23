/**
 * WP-5.1 — `src/client/views/intervention` — 公共面。
 *
 * Intervention 分组视图（任务目标 3/4）: 来源分组（机械触发 / 用户创建）
 * × 状态徽标 + 用户状态迁移操作面（§13 冻结迁移表; INV-PERM-4 用户面;
 * INV-ATTN-1 全量渲染）。
 *
 *   - `InterventionGroupsView` — 容器（唯一 store 绑定层, binding-hooks;
 *     mutation 走 store.updateInterventionState, 失效/refetch 复用
 *     WP-4.1b 注册表规则）;
 *   - `InterventionGroupsList` — 展示层（纯 props）;
 *   - `useInterventionGroups` — 绑定 hook（本包唯一 uSES 面）;
 *   - 切片投影（derive/group 纯函数）在 `stores/intervention-slices.ts`
 *     （store 层独立新文件 — 多 WP 并行纪律）。
 */

export { InterventionGroupsView, type InterventionGroupsViewProps } from './InterventionGroupsView.js'
export { InterventionGroupsList, type InterventionGroupsListProps } from './InterventionGroupsList.js'
export { useInterventionGroups, type InterventionGroupsBinding } from './binding-hooks.js'
