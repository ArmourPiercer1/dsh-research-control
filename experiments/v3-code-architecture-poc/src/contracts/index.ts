/**
 * 薄跨域协议（对应 PR #44 §4 `packages/contracts/`）。
 *
 * **本文件是 Kernel 与领域之间唯一允许共享的类型来源**，因此必须保持业务无知：
 * 出现 `Proposition` / `Association` / `FactStanding` / `S-L1` / `WITHHELD` 等科研词汇
 * 即被 `tests/arch-independence.test.ts` 的源码扫描判红（#44 §5.3、§14.1「中心膨胀」）。
 *
 * 引用标注：`#44 §x.y` = V3_CODE_ARCHITECTURE_DRAFT 章节；`RD-/ID-/SP-/RF-/T-/…` = PR #42 规则号。
 */

// ---------------------------------------------------------------- 身份与引用

/** 不透明空间句柄。#44 §5.1：任何业务读写都有明确 SpaceContext；Kernel 不解释空间语义。 */
export type SpaceId = string & { readonly __brand: 'SpaceId' };
export const asSpaceId = (s: string): SpaceId => s as SpaceId;

/** 对象类别：Kernel 只当**受注册约束的标签**，不解释五类语义（#44 §5.2 / RD-01）。 */
export type ObjectKindLabel = string;

/** ObjectID：全局唯一、永不复用；创建即固定 kind 与 space（RD-01、ID-01）。 */
export type ObjectOid = string & { readonly __brand: 'ObjectOid' };
export const asOid = (s: string): ObjectOid => s as ObjectOid;

/** 导航用引用（“跟随当前”）。**不得**用于正式科研陈述（#44 §8.1 / RD-05）。 */
export interface ObjectRef {
  readonly kind: 'object-ref';
  readonly oid: ObjectOid;
}
/** 精确引用：正式声明、论证输入/结论、评价、接纳与检查目标必须用它（RD-05）。 */
export interface RevisionRef {
  readonly kind: 'revision-ref';
  readonly oid: ObjectOid;
  readonly revision: number;
}
/** 记录引用：H 侧记录的精确引用（原始材料、检查报告等非正式对象的目标）。 */
export interface RecordRef {
  readonly kind: 'record-ref';
  readonly recordId: string;
}
export type AnyRef = ObjectRef | RevisionRef | RecordRef;

/** H 登记序（知识截点的度量单位；不是物理时间，#44 §7.1 / T-05）。 */
export type CommitSequence = number & { readonly __brand: 'CommitSequence' };

// ---------------------------------------------------------------- 主体与授权

export interface VerifiedPrincipal {
  readonly actorId: string;
  /** 由 Adapter 注入并已被宿主核验；Kernel 不自行认证（#44 §10）。 */
  readonly verified: true;
}

/**
 * 授权资源的两条**独立**轴，Kernel 必须分开判断（#44 §7.2/§12 / PR-A1、RD-27）：
 * - `space-write`：本空间写权（无则任何写入一律拒绝）
 * - `domain-admission`：科研接纳授权（有前者无后者 ⇒ 允许“未生效声明”，不得改变派生业务视图）
 * 字符串只是 Port 的键名；**含义与判定规则由领域声明**，Kernel 不理解。
 */
/**
 * Kernel **自己执行**的授权资源。业务授权轴（例如某域的"接纳资格"）由领域插件自定义字符串，
 * Kernel 只按名字问授权层——写权与业务授权分轴（SP-09），因此这里不得预置任何领域资源名。
 */
export type MechanismResource = 'space-write' | 'capability-admin';
export type AuthorityResource = MechanismResource | (string & {});

export interface ScopedCapabilities {
  can(resource: AuthorityResource): boolean;
}

// ---------------------------------------------------------------- 拒绝码

/**
 * 拒绝码封闭集。**新增码必须同时新增“不得泄漏跨空间存在性”的负例**（#44 §5.2 / RD-26、RD-34）。
 * `NOT_FOUND_IN_SPACE` 是“不存在”与“不可见”刻意合并后的唯一对外码。
 */
export type RefusalCode =
  | 'NO_SPACE_WRITE'          // 无本空间写权 → 完全拒绝
  | 'NOT_FOUND_IN_SPACE'      // 该空间内解析不到（含不可见；二者必须同形）
  | 'KIND_FROZEN'             // 试图改变已固定的 kind
  | 'SPACE_FROZEN'            // 试图改变已固定的 space
  | 'ID_TAKEN'                // ObjectID 已存在
  | 'CAPABILITY_INACTIVE'     // 所有者能力未在该空间激活
  | 'AMBIGUOUS_AUTHORITY'     // 同一权威被两个声明者声明
  | 'REQUIRED_REF_MISSING'    // 硬业务完整性引用在事务内确实不存在
  | 'SCHEMA_INCOMPATIBLE'     // 空间内插件存储 Schema/解释器不兼容
  | 'CONTEXT_INCOMPLETE'      // ReadContext 缺必需字段（T-01：未声明截点的查询视为未定义）
  | 'CROSS_SPACE_REFUSED'     // 用一个空间的 Kernel 解析另一个空间（SP-04）
  | 'SCHEMA_UPGRADE_REQUIRED' // 既有库模式版本/表集/触发器集不匹配，需显式迁移
  | 'RECORD_ALREADY_DECLARED' // 记录标识已被声明（ID-08：标识唯一）
  | 'RECORD_UNDECLARED'       // 引用了从未声明的记录标识
  | 'RAW_SQL_REFUSED'        // 领域句柄试图执行 DDL/PRAGMA/ATTACH
  | 'TX_CONTENTION'           // 写锁竞争（可重试）；驱动错误码只保留在 detail 里作证据
  | 'FULL_REBUILD_REQUIRED'   // Journal 缺口越过后不得增量续跑（#44 §7.4）
  | 'ACTIVATION_IMPOSSIBLE'   // 必需能力缺席或必需代码依赖成环，无法装配（#44 §6.3）
  | 'READ_CUTOFF_UNSAFE'      // 读取截点无法满足一致性要求
  | 'AUTHORITY_REQUIRED'       // 缺该业务动作所需的授权轴（与写权分轴，SP-09）
  | 'NAMESPACE_ESCAPE'        // 插件写非自己的持久命名空间（#44 §4.2、§6.2 禁止复制核心权威）
  | 'PROJECTION_UNAVAILABLE'; // 投影落后/缺口且调用方要求一致完整

/** 领域扩展拒绝码：强制前缀，避免与 Kernel 封闭集混淆或被误当成机制语义。 */
/** 领域扩展码必须带命名空间前缀（含冒号），既不与 Kernel 封闭集混淆，也不把某个域的
 * 前缀写进机制契约本身。 */
export type DomainRefusalCode = `${string}:${string}`;
export type AnyRefusalCode = RefusalCode | DomainRefusalCode;

export class Refusal extends Error {
  constructor(readonly code: AnyRefusalCode, readonly detail?: Record<string, unknown>) {
    super(code);
    this.name = 'Refusal';
  }
}

// ---------------------------------------------------------------- 读取上下文

export type ReadMode = 'current-snapshot' | 'as-recorded' | 'derived';
/** 对象所描述的时间条件；与登记知识截点**相互独立**（#44 §5.1 / T-05、RD-32）。 */
export type TimePredicate = { readonly at?: number; readonly during?: readonly [number, number] };

export interface ReadContextSpec {
  readonly space: SpaceId;
  readonly principal: VerifiedPrincipal;
  readonly mode: ReadMode;
  readonly recordedAsOf?: CommitSequence;
  readonly describedAtOrDuring?: TimePredicate;
  readonly consistency: 'required' | 'stale-ok';
}

/** 读取完整性报告：派生读面必须带水位，不得冒充权威最新（#44 §9.3 / Q42）。 */
export interface CoverageReport {
  readonly source: 'authoritative' | 'projection';
  readonly watermark: CommitSequence | null;
  readonly complete: boolean;
  readonly truncated: boolean;
  readonly missingRange?: string;
  readonly status?: 'OK' | 'STALE' | 'FULL_REBUILD_REQUIRED' | 'UNAVAILABLE' | 'INDETERMINATE';
}

// ---------------------------------------------------------------- 存储 Port

/** Kernel 唯一允许的写入口。#44 §7.3：单 Space 原子 Unit-of-Work。 */
export interface StoragePort {
  /** 同步事务：fn 抛错即整体回滚。实现必须是真实 DB 事务，不得用内存数组假装。 */
  tx<T>(fn: (raw: RawTx) => T): T;
  /** 只读事务/查询（不占写锁）。 */
  read<T>(fn: (raw: RawTx) => T): T;
  close(): void;
}
export interface RawTx {
  run(sql: string, ...params: readonly unknown[]): void;
  all<T = Record<string, unknown>>(sql: string, ...params: readonly unknown[]): T[];
  get<T = Record<string, unknown>>(sql: string, ...params: readonly unknown[]): T | undefined;
}

// ---------------------------------------------------------------- 能力与清单

/** 逻辑能力标识：稳定，不随源码重构或包拆分改变（#44 §6.1 / Q44）。 */
export type CapabilityId = string;
export type PluginId = string;

export interface PluginManifest {
  readonly pluginId: PluginId;
  /** 实现代码版本（与下面三者分属不同版本轴，#44 §11）。 */
  readonly codeVersion: string;
  readonly provides: readonly { readonly capability: CapabilityId; readonly contractVersion: string }[];
  readonly requires: readonly {
    readonly capability: CapabilityId;
    readonly contractVersion: string;
    /** 缺省视为必需。必需依赖缺失/成环 ⇒ 不可装配；可选依赖缺失 ⇒ 降级装配。 */
    readonly required?: boolean;
  }[];
  /** 该插件独占的持久命名空间（表前缀），避免跨插件私有 schema 互碰。 */
  readonly storageNamespace: string;
  /** 领域事件权威声明；每空间至多一个非 `none`（#44 §7.1「历史双写」）。 */
  readonly eventAuthority?: 'none' | 'ledger-payload' | 'ledger-ref';
  /** 该插件拥有的对象类别标签 → 拥有它的 Capability（Directory 路由用，#44 §5.2）。 */
  readonly ownsKinds?: readonly { readonly kind: ObjectKindLabel; readonly capability: CapabilityId }[];
}

// ---------------------------------------------------------------- 校验贡献

/** 校验贡献：规则/版本由领域拥有；Kernel 只登记与调用（#44 §9.2 / Q39）。 */
// 校验词汇（逐项判定、覆盖度、Finding）不在本文件：那是检查报告的语义，属领域校验能力的契约
// （见 domains/validation-contract.ts）。Kernel 只见不透明报告载荷（#44 §9.2）。
export interface CheckReportRecord {
  readonly reportId: string;
  readonly target: RevisionRef | RecordRef;
  readonly validatorId: string;
  readonly ruleVersion: string;
  readonly schemaVersion: string;
  readonly environment: string;
  readonly executedAt: number;
  readonly guaranteeScope: string;
  /** 对 Kernel 不透明：机制层不解释 verdict/findings 的科研含义（#44 §9.2、RPT-04）。 */
  readonly verdict: string;
  readonly findings: readonly unknown[];
  readonly declaredGaps: readonly string[];
  readonly recordedAt: CommitSequence;
}
