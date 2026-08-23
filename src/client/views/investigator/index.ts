/**
 * WP-7.3 — transient investigator 视图公共面（唯一 import 点）。
 *
 * 装配面:
 *  - `InvestigatorViewContainer` — 容器（宿主 slot 接线点; `store` prop 传
 *    `createAnalysisSliceStore(...)` 工厂结果 — src/client/stores/
 *    analysis-slice.ts, 本 WP 独立新切片文件; `sessionId` prop =
 *    launcher 的会话指针 `InvestigatorLaunchResult.sessionId`）;
 *  - 纯展示组件（`InvestigatorTransientPanel` / `SaveAnalysisRecordDialog` /
 *    `TransientSliceStatusNote`）与纯投影（investigator-model）— 测试直用。
 */

export {
  InvestigatorTransientPanel,
  SaveAnalysisRecordDialog,
  TransientSliceStatusNote,
  type InvestigatorTransientPanelProps,
  type SaveAnalysisRecordDialogProps,
} from './transient-view.js'
export {
  OBJECT_KINDS,
  RUN_STATUS_LABEL,
  SOURCE_REF_KIND_LABEL,
  TYPED_REF_ID_PATTERN,
  RUN_ID_PATTERN,
  buildSavePayload,
  canConfirmSave,
  formatAnalysisTime,
  initialSaveFieldValues,
  selectSavedRecordRows,
  selectTransientRows,
  type SaveDialogFieldValues,
  type SavedRecordRow,
  type TransientPanelRows,
} from './investigator-model.js'
export { InvestigatorViewContainer, type InvestigatorViewContainerProps } from './investigator-container.js'
export { useAnalysisSlice } from './use-analysis-slice.js'
