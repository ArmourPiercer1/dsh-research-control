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
/**
 * 冻结契约版本（EA-6.1 锚文件 `contracts/event-registry/EVENT-CONTRACT-LEDGER.json` 的
 * `interpretationRuleSetVersion` 取值）。放在 contracts 是因为**三个使用者**都要它：
 * Kernel 的机制信封、迁移器的补写行、审计复算的冻结版本集——任何一处手抄字面量都会在
 * 版本推进时静默掉队（迁移行会先变成"复算不一致"）。
 */
export const MECHANISM_FROZEN_VERSION = 'g1/fa3b892';

export type MechanismResource = 'space-write' | 'capability-admin' | 'facet-mount';
export type AuthorityResource = MechanismResource | (string & {});
/**
 * `MechanismResource` 的**运行时投影**（D-26，包 4，CONTRACTS.md §16.2）：类型联合在 JS 里不存在，
 * 而注册判据要在运行时回答「这根轴是不是机制自己的权限轴」——本数组是机制资源自述的唯一运行时正源。
 * **这不是业务知识回流**：里面只有机制自身执行的资源名（写权/管理权/Facet 挂载权）；业务授权轴
 * 仍是 Kernel 不解释的不透明字符串。`facet-mount` 的加入依据 = G1 契约 FM-7 / I-2（Facet 挂载
 * 是与写权分轴的机制权限；挂载者不得借"有写权"代替"可挂载"）。新增机制资源时类型与本数组必须同步——漏一条由下方编译期穷尽检查变红。
 */
export const MECHANISM_RESOURCES = ['space-write', 'capability-admin', 'facet-mount'] as const;
// 穷尽检查（真判据，对**数组元素类型**做 Exclude）：本数组漏掉 `MechanismResource` 联合的
// 任一成员 ⇒ 下一行编译红（运行时排除判据不得落后于类型联合——D-26 的判据强度取决于清单完整）。
type _MechanismResourcesCover = Exclude<MechanismResource, typeof MECHANISM_RESOURCES[number]> extends never
  ? true : { COMPILE_ERROR: 'MECHANISM_RESOURCES 未覆盖 MechanismResource 全联合' };
export const _MECHANISM_RESOURCES_COVER: _MechanismResourcesCover = true;

export interface ScopedCapabilities {
  can(resource: AuthorityResource): boolean;
}

/**
 * 机制授权见证（包 3，N1；CONTRACTS.md §16.2 入口判据 ③）：
 * `appendAuthoritativeEvent` 落笔前按事件类型登记的 `requiresAuthority` 轴、对本事务已验证主体
 * 向机制可信授权来源取证后写进 ledger 的证据封套。**只有机制能写**：任何写入口的入参都不含
 * 能填这一列的字段。`null` = 该行无见证（非权威通道行，或机制生效前写入的历史行）。
 * 派生投影对带见证的行，授权结论只认本结构的 `authorized`，不认载荷里的任何自称。
 * 本文件业务无知：`axis`/`capability` 是不透明字符串，Kernel 不解释（arch 扫描继续覆盖本面）。
 */
export interface AuthorityEvidence {
  readonly axis: AuthorityResource;
  readonly capability: CapabilityId;
  readonly authorized: boolean;
}

/**
 * EA-4.2 的授权上下文（`ledger.authority_basis` 的正式内容，**九字段封闭**）。
 *
 * 与 `AuthorityEvidence` 的关系：后者是包 3 的三字段旧形，历史行里仍然存在，读面必须照旧可解释
 * （EA-5.2）。新写入一律写本结构——`actor` 入信封是 F-G6A-2 的修法转正（EA-4.4），
 * `ctxId/txSeq/issuedAtMs` 把「同一授权上下文、同一取证点、同一事务」做成**可核事实**而不是声明。
 * 列仍是 JSON 文本列 ⇒ 加字段不动 DDL、不推 `SCHEMA_VERSION`。
 */
export interface AuthorizationContext {
  readonly ctxId: string;
  readonly actor: string;
  readonly capability: CapabilityId;
  readonly axis: AuthorityResource;
  readonly authorized: boolean;
  readonly ruleSetVersion: string;
  readonly contractVersion: string;
  readonly issuedAtMs: number;
  readonly txSeq: number;
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
  // S-4：形状拒绝。硬引用指向浮动目标（object-ref 无修订）时，提交期判据本身会随时间改变。
  // 与 REQUIRED_REF_MISSING 分开，因为二者对调用方是不同的修法：补修订 vs 补存在性。
  | 'HARD_REF_NOT_PINNED'
  | 'SCHEMA_INCOMPATIBLE'     // 空间内插件存储 Schema/解释器不兼容
  | 'CONTEXT_INCOMPLETE'      // ReadContext 缺必需字段（T-01：未声明截点的查询视为未定义）
  | 'CROSS_SPACE_REFUSED'     // 用一个空间的 Kernel 解析另一个空间（SP-04）
  | 'SCHEMA_UPGRADE_REQUIRED' // 既有库模式版本/表集/触发器集不匹配，需显式迁移
  | 'RECORD_ALREADY_DECLARED' // 记录标识已被声明（ID-08：标识唯一）
  | 'RECORD_UNDECLARED'       // 引用了从未声明的记录标识
  | 'RAW_SQL_REFUSED'        // 领域句柄试图执行 DDL/PRAGMA/ATTACH
  | 'TX_CONTENTION'           // 写锁竞争（可重试）；驱动错误码只保留在 detail 里作证据
  // D-23（外部复审第四轮，2026-10-30）：**终结判据是底层事务本体**（`StoragePort.tx` 交出的句柄），
  // 不是任何包装实例——`Kernel.uow/uowFor` 回调一离开（提交、回滚、提交期抛错三形同判终结）即终结。
  // 终结后凡由该句柄派生的**读写一律拒绝**（`UnitOfWork` 与 `NamespaceWriter` 的全部读写方法，
  // 含只读 `readLatest`，也含事后经 `writerFor(旧句柄)` 构造的端口——后者直接拒绝建端口）。
  // 不可重试：调用方必须另起事务重做。语义与适用面全文见 CONTRACTS.md §16.1——
  // 这是插件可见面变化（`Refusal.code` 会到达插件代码）。
  | 'TX_CLOSED'
  | 'FULL_REBUILD_REQUIRED'   // Journal 缺口越过后不得增量续跑（#44 §7.4）
  | 'ACTIVATION_IMPOSSIBLE'   // 必需能力缺席或必需代码依赖成环，无法装配（#44 §6.3）
  | 'READ_CUTOFF_UNSAFE'      // 读取截点无法满足一致性要求
  | 'AUTHORITY_REQUIRED'       // 缺该业务动作所需的授权轴（与写权分轴，SP-09）
  | 'NAMESPACE_ESCAPE'        // 插件写非自己的持久命名空间（#44 §4.2、§6.2 禁止复制核心权威）
  | 'CAPABILITY_SCOPE_ESCAPE' // D-19：能力作用域事务试图改/引用其它能力拥有的对象（Q12 领域权威边界）
  // D-20（外部复审第四轮，包 2）：**通道**判据——「本通道没有资格写这个事件类型」。
  // 已登记的正式事件类型（PluginManifest.ownsEventTypes）不得经通用 appendLedger/declareRecord
  // 或 write() 的登记式台账行写入（一切作用域，含 assembly）；唯一入口是归属能力窄面的
  // appendAuthoritativeEvent。反向：appendAuthoritativeEvent 收到未登记类型也是此码（没有权威
  // 签发者）。与 AUTHORITY_REQUIRED（缺授权轴）、CAPABILITY_SCOPE_ESCAPE（改他人对象）分属三回事。
  // 语义与适用面全文见 CONTRACTS.md §16.2——插件可见面变化（拒绝码会到达插件代码）。
  | 'EVENT_AUTHORITY_REQUIRED'
  // D-31（外部复审第五席 G5-A，包 6，CONTRACTS.md §16.3）：移交通道**不携 ns**——移交的原语义
  // 只是改 Capability→Plugin 映射，携 ns 会永久毒化既有对象的全部读面（一次合法 capability-admin
  // 操作 = 全库双时间读面死亡）。入口判据：清单声明的 storageNamespace 与当前生效路由 ns 不同
  // 即拒，判据在开事务/落账/改路由之前，零半成品。ns 迁移另立显式通道（机制没有，不拿移交凑数）。
  | 'TRANSFER_NS_DRIFT'
  // D-21（G5-A，包 6，CONTRACTS.md §16.3）：保留前缀 id 收归机制计数器——`RPT-` 是机制报告
  // 身份 namespace，任何显式声明通道携带保留前缀即拒（引用已存在的 RPT-* 不受影响）。
  // 否则任何 space-write 主体可滚动预占 ⇒ 合法报告提交持续撞 RECORD_ALREADY_DECLARED。
  | 'RECORD_ID_RESERVED'
  // N9 残余（G5-A，包 6，CONTRACTS.md §16.3）：`meta.ledger_seq` 水位落后于 ledger 历史时，
  // 下一次机制发号撞 `UNIQUE constraint failed: ledger.seq`。此前该**裸驱动文本**越过 Storage
  // Port 边界（违例已登记）；现由 translate() 包装为本码——需修复、不可重试，驱动文本仅存
  // detail 作证据。打开路径另有 `max(ledger.seq) ≤ 水位` 判据；本码覆盖会话内落后的窗口。
  | 'LEDGER_SEQ_CONFLICT'
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

/**
 * EA-3.1 归属账条目（唯一所有权）。`PluginManifest.ownsEventTypes` 就是这本账，
 * **不另立第二本「域名账」**（C.5-2）。
 *
 * 装配期判据（EA-3.2 五序 + OA-1..OA-4）由 `CapabilityRegistry.register()` 执行；
 * 本类型只表达形状。`truthSource` / `interpretationRuleSetVersion` / `contractVersion` 是
 * 「读者钉版本」与「唯一真源」两条判据的承载位（C-03 / C-12），缺一即装配红。
 */
export interface EventOwnershipEntry {
  /** 不透明字符串；Kernel 不解释业务语义（#44 §5.2 业务无知）。 */
  readonly eventType: string;
  /** 唯一 owner（单 Space 同一时刻唯一权威写者，Q44）。 */
  readonly capability: CapabilityId;
  /** 业务授权轴（不透明串）；缺失即 `ACTIVATION_IMPOSSIBLE`（EA-3.2 ③）。 */
  readonly requiresAuthority: AuthorityResource;
  /** C-03 唯一真源字段：领域事件不得「领域表一份、Ledger 另一份」。 */
  readonly truthSource: 'ledger-payload' | 'ledger-referenced-store';
  /** 读者钉的解释规则版本（C-12 SCR-74 同族）。 */
  readonly interpretationRuleSetVersion: string;
  /** 该事件类型的解释契约版本（C-12 SCR-03 同族）。 */
  readonly contractVersion: string;
  /**
   * EA-3.4：新增领域名的 owner 批准记录（必填）。领域名走 owner 清单登记，与机制名分轨；
   * 缺批准 = 没有"谁批准了这个名字"的可核事实，装配期必须拒（不给"先登记后补批准"留窗口）。
   */
  readonly approval: { readonly approvedBy: string; readonly approvedOn: string; readonly anchor: string };
  /** 退役标记：只标不删，历史行读面不变（EA-5）；退役名不可再新写。 */
  readonly retired?: boolean;
}

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
  /**
   * D-20（外部复审第四轮，包 2；CONTRACTS.md §16.2）：把自己拥有的事件类型登记为**正式事件类型**——
   * 领域据以执行接纳/授权类判定、派生业务投影直接相信它的事件。登记后：
   * · 通用 `appendLedger`/`declareRecord` 与 `write()` 的登记式台账行一律不得写它（一切作用域，含 assembly）；
   * · 唯一写入入口 = 归属能力窄面的 `NamespaceWriter.appendAuthoritativeEvent`。
   * Kernel 把 eventType 与 axis 当不透明字符串（业务无知不变）。登记判据与 `ownsKinds` 同族且**按序**：
   * 重复登记 ⇒ `AMBIGUOUS_AUTHORITY`，指向未激活能力 ⇒ `CAPABILITY_INACTIVE`，
   * **缺 `requiresAuthority` ⇒ `ACTIVATION_IMPOSSIBLE`**（包 3，N1：正式事件没有授权轴就永远
   * 无法产生授权证据，装配不可成立，fail-closed）。
   * **`requiresAuthority`（包 3）**＝该事件类型签发所须经核对的业务授权轴（不透明字符串）：
   * 权威入口落笔前用它对已验证主体取证，证据写入 ledger 见证列（`AuthorityEvidence`）——
   * 授权结论自此是机制事实，不再采信载荷自称（CONTRACTS.md §16.2 判据 ③ 与投影信任模型第 3 条）。
   */
  readonly ownsEventTypes?: readonly EventOwnershipEntry[];
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

// ---------------------------------------------------------------------------
// 领域命令 Port（DC-* / R-9）：**一个业务动作一个方法**，命令判别式是字面量。
//
// 为什么不是通用 `run(name, payload)`：判别式写成字面量后，命令名册在类型层就是封闭的；
// 通用入口会把「哪个领域能写什么」重新变回运行期字符串比较，等于把授权面交还给调用方。
//
// 记录域 Raw Intake（DC-11 容错通道）：`unparseable` 是**载荷字段**，不是闸门——
// 解析失败是数据事实，不是拒绝理由；把它做成闸门会让「无法解析的原文」永远进不了账，
// 恰恰违背原始记录必须先落地的目的。
// ---------------------------------------------------------------------------

/** 命令 Port 的统一回执（DC-7）：机制在**入口内**签发登记序，调用方不得自行编造。 */
export interface CommandReceipt {
  readonly oid: ObjectOid;
  readonly revision: number;
  /** 该权威事件行的号（CS-2.5）。不返回信封对象——回执不是授权证据。 */
  readonly witnessSeq: CommitSequence;
}

/**
 * 机制内部签发点的入参（`Kernel.declareRawIntake`）。字段集与 `DeclareRawIntakeCommand` 一致，
 * 但**不含** `command` 判别式：判别式属于应用层命令路由，机制只认数据。
 */
export interface RawIntakeEnvelope {
  readonly recordId: string;
  readonly text: string;
  readonly sourceRef: string;
  /** 载荷字段：原文是否可解析。缺省视为可解析；`true` 不构成拒绝理由（DC-11）。 */
  readonly unparseable?: boolean;
}

/**
 * Raw Intake 的回执（R-9 接口一致性澄清）：**没有** `oid` / `revision`。
 * 原始记录不是对象面事实，伪造一个 ObjectID 会把"记录已登记"说成"对象已存在"，
 * 后续任何以 oid 为前提的读面都会拿到一个查不到的对象。回执只说两件事：登记了哪条记录、
 * 机制在入口内签发的登记序是多少。
 */
export interface RawIntakeReceipt {
  readonly recordId: string;
  readonly witnessSeq: CommitSequence;
}

export interface DeclareRawIntakeCommand {
  readonly command: 'test.records:declareRawIntake';
  readonly recordId: string;
  readonly text: string;
  readonly sourceRef: string;
  /** 载荷字段：原文是否可解析。缺省视为可解析；`true` 不构成拒绝理由（DC-11）。 */
  readonly unparseable?: boolean;
}

/**
 * 拥有者导出、装配根注入。记录域的原始入口**只有这一个方法**（唯一入口）。
 *
 * 注意它**不接收 `tx`**（R-9 接口一致性澄清）：原始记录的身份、原文、来源与机制事件
 * 必须由机制在**同一个**事务里登记，事务边界属于机制而不是调用方。若把 `tx` 透给领域，
 * 领域就能在"记录已登记但事件未落账"的中间态里做别的事——那正是要排除的形态。
 */
export interface RawIntakeCommandPort {
  declare(cmd: DeclareRawIntakeCommand): RawIntakeReceipt;
}
