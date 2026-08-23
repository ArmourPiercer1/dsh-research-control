/**
 * WP-6.4 — Research Inbox 视图公共面（唯一 import 点）。
 *
 * 装配面:
 *  - `InboxViewContainer` — 容器（宿主 slot 接线点; `store` prop 传
 *    `createInboxSliceStore(...)` 工厂结果 — src/client/stores/
 *    inbox-slice.ts, 本 WP 独立新切片文件）;
 *  - 纯展示组件（`InboxListView` / `InboxItemDetail` /
 *    `InboxConversionDialog`）与纯投影（inbox-model）— 测试直用。
 */

export {
  InboxConversionDialog,
  InboxItemDetail,
  InboxListView,
  InboxSliceStatusNote,
  type InboxConversionDialogProps,
  type InboxItemDetailProps,
  type InboxListViewProps,
} from './inbox-view.js'
export {
  buildConversionPayload,
  escalationMarkerOf,
  escalationReasonText,
  formatInboxTime,
  INBOX_CATEGORY_LABEL,
  INBOX_CONVERSION_FIELD_MODELS,
  INBOX_CONVERSION_KIND_LABEL,
  INBOX_CONVERSION_KINDS,
  INBOX_ESCALATION_REASON_LABEL,
  INBOX_SOURCE_CATEGORY,
  INBOX_SOURCE_LABEL,
  INBOX_STATE_LABEL,
  selectInboxRows,
  type InboxConversionFieldModel,
  type InboxEscalationMarker,
  type InboxRow,
} from './inbox-model.js'
export { InboxViewContainer, type InboxViewContainerProps } from './inbox-container.js'
export { useInboxSlice } from './use-inbox-slice.js'
