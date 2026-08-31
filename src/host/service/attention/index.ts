/**
 * WP-5.4 — `src/host/service/attention` — public surface.
 *
 *   - scorer.ts  — 纯 baseline 评分器（零 import; host 与 client store
 *     切片共用的算法单一真源 — INV-ATTN-1/2 的 T/R 级校验对象）;
 *   - types.ts   — awareness 冻结形状 + actor/DB/端口类型 + 错误载体;
 *   - schema.ts  — `awareness` 表 V1 DDL（PK + no-delete/no-content-update
 *     trigger）+ 行映射;
 *   - store.ts   — `AwarenessStore`（状态缓存表 upsert/get/list; 无 delete）;
 *   - service.ts — `AttentionService`（awareness 用户门 + `getAttentionRanking`
 *     组装面）+ `openAttentionDatabase`（双连接打开面, 宿主接线用）;
 *   - unified.ts — UI-8（D §14）统一 Needs-Attention 收集/组装/query 纯核心
 *     （5-kind 合并 + 单一 rankAttention 全序 + missing-NA 合成; ADJ-4 双路
 *     共享的无 I/O 模块 — 生产 sources 在 dsh-adapter 宿主侧注入）。
 */

export {
  AWARENESS_KINDS,
  AWARENESS_STATES,
  ATTENTION_ITEM_KINDS,
  ATTENTION_WEIGHTS,
  rankAttention,
  scheduledUrgency,
  scoreAttentionItem,
  type AttentionBlockerItem,
  type AttentionContext,
  type AttentionItem,
  type AttentionItemKind,
  type AttentionInterventionItem,
  type AttentionNextActionItem,
  type AttentionRankedItem,
  type AttentionRanking,
  type AttentionScheduledEventItem,
  type AttentionWeights,
  type AwarenessKind,
  type AwarenessState,
} from './scorer.js'

export {
  AWARENESS_KIND_VALUES,
  AWARENESS_STATE_VALUES,
  AWARENESS_TABLE,
  ATTENTION_TABLES,
  awarenessDdl,
  awarenessToParams,
  rowToAwareness,
  SQL_LIST_AWARENESS,
  SQL_SELECT_AWARENESS,
  SQL_UPSERT_AWARENESS,
} from './schema.js'

export {
  AWARENESS_KINDS as AWARENESS_KINDS_VALUES,
  AWARENESS_STATES as AWARENESS_STATE_NAMES,
  AttentionError,
  isAttentionError,
  type ActiveInterventionRecord,
  type AttentionActor,
  type AttentionDb,
  type AttentionErrorCode,
  type AttentionSourcePorts,
  type AwarenessObjectRef,
  type AwarenessRecord,
} from './types.js'

export { AwarenessStore, type AwarenessStoreOptions } from './store.js'

export {
  AttentionService,
  interventionToAttentionItem,
  openAttentionDatabase,
  type AttentionDatabase,
  type AttentionServiceOptions,
} from './service.js'

export {
  MISSING_NA_TITLE,
  assembleProjectAttention,
  assembleUnified,
  collectProjectAttention,
  filterAndPage,
  queryCollections,
  queryUnifiedAttention,
  unifiedAttentionContext,
  type AttentionEventView,
  type AttentionItemDtoPartial,
  type AttentionWorkstreamNode,
  type ProjectAttentionCollection,
  type ProjectAttentionSources,
  type ScoreableCandidate,
  type TerminalCandidate,
} from './unified.js'
