/**
 * WP-5.4 — `src/client/views/attention` — public surface.
 *
 * 两层纪律（WP-4.x 视图约定）:
 *   - `AttentionView`（容器）— 唯一 store 接触文件（主 store + 本 WP 切片
 *     store 的绑定都在这）;
 *   - `AttentionListView`（展示）— 纯 props, 零 store/DSH import。
 * cockpit 座位接线（跨 WP 集成 — 编排者统一接）import 本目录的容器。
 */

export { AttentionListView, formatDurationLabel, type AttentionListViewProps, type AttentionViewStatus } from './AttentionListView.js'
export { AttentionView, type AttentionViewProps } from './AttentionView.js'
