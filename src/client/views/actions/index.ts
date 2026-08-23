/**
 * WP-5.2 — 注意力三对象视图公共面（唯一 import 点）。
 *
 * 装配面:
 *  - `ActionsViewContainer` — 容器（宿主 slot 接线点; `store` prop 传
 *    `createActionsSlicesStore(...)` 工厂结果 — src/client/stores/
 *    actions-slices.ts, 本 WP 独立新切片文件）;
 *  - 纯展示组件（`BlockerSection` / `ObjectiveProgress` /
 *    `NextActionsSection`）与纯投影（actions-model）— 测试直用。
 */

export {
  NA_STATUS_LABEL,
  BLK_STATUS_LABEL,
  OBJ_STATUS_LABEL,
  SliceStatusNote,
  type BlockerSectionProps,
  type NextActionsSectionProps,
  type ObjectiveProgressProps,
  BlockerSection,
  NextActionsSection,
  ObjectiveProgress,
} from './actions-view.js'
export {
  countObjectives,
  groupNextActionsByObjective,
  objectiveProgressRows,
  splitBlockers,
  type BlockerSections,
  type NextActionGroup,
  type ObjectiveCounts,
  type ObjectiveProgressRow,
} from './actions-model.js'
export { ActionsViewContainer, type ActionsViewContainerProps } from './actions-container.js'
export { useActionsSlices } from './use-actions-slices.js'
