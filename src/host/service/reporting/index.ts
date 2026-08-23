/**
 * WP-5.3 — reporting layer public face (Interaction / ReportingItem /
 * ScheduledEvent — DOMAIN_SCHEMA §10).
 *
 * One import for the service, its DDL/tables, the §13 state machine, the
 * V1 schedule semantics, and the frozen record/vocabulary types.
 */

export {
  INTERACTION_TABLE,
  REPORTING_ITEM_TABLE,
  SCHEDULED_EVENT_TABLE,
  REPORTING_TABLES,
  reportingDdl,
} from './schema.js'
export {
  RPT_LEGAL_TRANSITIONS,
  checkRptTransition,
  isRptTransitionLegal,
} from './state-machine.js'
export {
  eventActiveInWindow,
  reminderPoint,
  scheduleSortKey,
  type ScheduleWindow,
} from './schedule.js'
export {
  ReportingService,
  type CreateReportingItemParams,
  type CreateScheduledEventParams,
  type InteractionListFilter,
  type RegisterInteractionOutcome,
  type RegisterInteractionParams,
  type ReportingItemListFilter,
  type ReportingServiceOptions,
} from './service.js'
export {
  INTERACTION_KINDS,
  RPT_STATUSES,
  SEV_FREQS,
  SEV_RELATED_REF_KINDS,
  ReportingError,
  isInteractionKind,
  isRptStatus,
  isSevFreq,
  isSevRelatedRefKind,
  type InteractionKind,
  type InteractionRecord,
  type OnceSchedule,
  type RecurringSchedule,
  type ReportingDb,
  type ReportingErrorCode,
  type ReportingItemRecord,
  type RptStatus,
  type ScheduledEventRecord,
  type SevFreq,
  type SevRelatedRefKind,
  type SevSchedule,
  type SqlParam,
  type TypedRefJson,
} from './types.js'
