/**
 * WP-5.5 — `src/client/views/brief` — public surface.
 *
 * 两层纪律（WP-4.x 视图约定, 同 attention/intervention 包）:
 *   - `BriefView`（容器）— 包内唯一 store 接触文件（主 store 的
 *     dashboard/project 节点 + 本 WP brief 切片 store 的绑定都在这;
 *     ref 跳转渠道也在这 — WP-4.6 模式）;
 *   - `BriefPanelView`（展示）— 纯 props, 零 store/DSH import
 *     （本地 UI 状态: L2/L3 展开态 + 无）。
 * cockpit 座位接线（跨 WP 集成 — 编排者统一接）import 本目录的容器。
 */

export { BriefPanelView, refLabel, BRIEF_PLANE_COUNT, type BriefPanelStatus, type BriefPanelViewProps } from './brief-panel'
export { BriefView, type BriefViewProps } from './BriefView'
