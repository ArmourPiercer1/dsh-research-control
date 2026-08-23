/**
 * WP-5.5 — brief 包公共面（唯一 import 点 — 跨模块符号纪律, 同各 service
 * 包 index.ts 口径）。
 *
 * 三层:
 *  - 投影引擎（`project.ts` — 纯函数: `projectBrief` + `validateBriefRefs`
 *    INV-ATTN-3 机器可查校验面）;
 *  - 映射层（`mapping.ts` — 纯函数: 生产记录/wire DTO → 引擎入参 +
 *    WP-5.4 注意力端口的生产映射）;
 *  - 服务面（`service.ts` — `buildBrief()` 组装 + `BriefService` 薄封装;
 *    零持久化 — Brief 是 projection, 非 source of truth）。
 */

export { projectBrief, validateBriefRefs, BRIEF_RECENT_CAP, BRIEF_IN_FLIGHT_CAP, BRIEF_L1_REF_CAP, BRIEF_SEV_HORIZON_MS } from './project.js'
export {
  BRIEF_OBJECT_KINDS,
  BRIEF_POINT_CATEGORIES,
  BRIEF_DATA_PLANES,
  type BriefAffectsRef,
  type BriefBaseRow,
  type BriefDataPlaneId,
  type BriefFuturePlan,
  type BriefFuturePlanItem,
  type BriefHistoryEvent,
  type BriefInputs,
  type BriefInteraction,
  type BriefIntervention,
  type BriefNextAction,
  type BriefObjectKind,
  type BriefObjective,
  type BriefPoint,
  type BriefPointCategory,
  type BriefRef,
  type BriefReportingItem,
  type BriefScheduledEvent,
  type LivingBrief,
} from './types.js'
export {
  BriefMappingError,
  blockerRecordToAttentionItem,
  blockerToBrief,
  briefInterventionsFromDashboard,
  historyEventToBrief,
  interactionToBrief,
  interventionDtoToBrief,
  interventionRecordToAttentionItem,
  interventionToBrief,
  nextActionRecordToAttentionItem,
  nextActionToBrief,
  objectiveDocToBrief,
  objectiveDtoToBrief,
  reportingItemToBrief,
  scheduledEventRecordToAttentionItem,
  scheduledEventToBrief,
} from './mapping.js'
export { BriefService, BriefServiceError, buildBrief, type BriefServiceOptions, type BriefSourcePorts } from './service.js'
