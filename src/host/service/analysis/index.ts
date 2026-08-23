/**
 * src/host/service/analysis — 公共面（唯一 import 点, WP-7.3）。
 *
 * AnalysisRecord 显式保存 + transient 结果读取面
 * （DOMAIN_SCHEMA §12.2 / 计划书 §26.2 / INV-PERM-3）:
 *
 *  - `AnalysisRecordService` — **用户显式**保存（`saveAsAnalysisRecord` —
 *    `UserActorRef` 类型面 + `assertUserActor` 运行面双面门, 非 USER 零
 *    写入）+ 查询面（`getAnalysisRecord` / `listAnalysisRecords` — 无隐藏
 *    过滤器）;
 *  - `AnalysisStore` — `analysis_record` 行面（insert + 查询; 无 delete —
 *    INV-HIST-7 / 无 update — 快照不可变; 整行过真实冻结
 *    provenance.schema.json $defs/AnalysisRecord 形状网）;
 *  - `AnalysisTransientReader` — transient 读取面（**零写入的类型面**:
 *    输入端口全读成员 + 类面唯一公开方法 `read` — 计划书 §26.2「默认
 *    transient」的 GUI 数据面; 数据来源 = launcher 会话指针 → sessionlink
 *    读取面 + live session 摘要 + run 关联面）;
 *  - 冻结形状网装载（`loadAnalysisSchemas` — 真实冻结
 *    schema/operational/provenance.schema.json）;
 *  - DDL 面（`analysisRecordDdl` — 第二连接幂等应用, 同 WP-3.5/WP-6.4 模式）。
 *
 * 层边界（ARCHITECTURE §2.2）: service — 唯一写 operational DB 的层（仅
 * 一个写入口, 用户门）; 本包零 DSH import（INV-PERM-5, check-imports
 * 可证）。生产组装（哪个连接 + sessionlink/DshSessionAdapter/run 表哪些
 * 真实端口 + GUI 接线）归编排/接线 WP — 本包 API 面完整自洽（同 WP-6.4
 * 交付口径, 见 WP-7.3 报告「偏离与豁免」）。
 */

export { AnalysisRecordService } from './service.js'
export { AnalysisStore, type AnalysisStoreOptions } from './store.js'
export { AnalysisTransientReader } from './transient.js'
export { loadAnalysisSchemas } from './schemas.js'
export {
  analysisRecordDdl,
  analysisRecordToParams,
  rowToAnalysisRecord,
  ANALYSIS_RECORD_TABLE,
  ANALYSIS_TABLES,
  SQL_INSERT_ANALYSIS_RECORD,
  SQL_LIST_ANALYSIS_RECORDS,
  SQL_SELECT_ANALYSIS_RECORD_BY_ID,
} from './schema.js'
export {
  AN_ID_PATTERN,
  RUN_ID_PATTERN,
  TYPED_REF_ID_PATTERN,
  AnalysisError,
  USER_ACTOR,
  isAnalysisError,
  type AnalysisErrorCode,
  type AnalysisListFilter,
  type AnalysisRecordRecord,
  type AnalysisSchemaError,
  type AnalysisShapeCheck,
  type AnalysisServiceOptions,
  type AnalysisSchemas,
  type AnalysisTransientReaderInput,
  type AnalysisTransientSnapshot,
  type SaveAnalysisRecordParams,
  type SaveAnalysisRecordResult,
  type TransientRunRow,
  type UserActorRef,
} from './types.js'
