/**
 * Mechanism Kernel（#44 §5）。**业务无知是本文件的机器可验属性**：
 * `tests/arch-independence.test.ts` 扫描本目录源码，出现科研领域词汇即判红。
 *
 * Kernel 只做四件事：Capability 注册与激活、Object Directory、History Ledger 登记序、
 * 单空间 Unit-of-Work（含 Change Journal）。它不知道五类对象、不知道 S-L1、不知道
 * FactStanding、不知道 WITHHELD（#44 §5.3）。
 */
import {
  Refusal,
  asOid,
  MECHANISM_RESOURCES,
  type AuthorityEvidence,
  type AuthorityResource,
  type AnyRef,
  type CapabilityId,
  type CheckReportRecord,
  type CommitSequence,
  type ObjectKindLabel,
  type ObjectOid,
  type PluginManifest,
  type RawTx,
  type RevisionRef,
  type SpaceId,
  type StoragePort,
  type VerifiedPrincipal,
} from '../contracts/index.ts';
import { KERNEL_PORT } from './internal.ts';

// ---------------------------------------------------------------- Capability 注册

export interface ActivatedCapability {
  readonly capability: CapabilityId;
  readonly pluginId: string;
  readonly contractVersion: string;
  readonly storageNamespace: string;
}

export interface Authorizer {
  can(actorId: string, resource: string, space: SpaceId): boolean;
}

/**
 * 单空间的激活视图：同一时刻同一 Capability 只有一个权威写入者（#44 §6.1 / Q44），
 * 领域事件权威至多一个（#44 §7.1「历史双写」）。
 */
export class CapabilityRegistry {
  private readonly caps = new Map<CapabilityId, ActivatedCapability>();
  private readonly kindOwner = new Map<ObjectKindLabel, CapabilityId>();
  /**
   * D-20（包 2，CONTRACTS.md §16.2）：正式事件类型 → { 归属能力, 授权轴 }。登记判据与 `kindOwner` 同族；
   * 归属账本按**能力 id** 记，不随路由移交/停用消失——拥有者被停用时正式事件在两个通道上都
   * 写不动（包 3/D-25 起为现状：`appendAuthoritativeEvent` 有激活核对）。
   * `axis`（包 3，N1）是**授权取证来源的索引**：权威入口落笔前用它对已验证主体核对，
   * 证据写入 ledger 见证列——Kernel 对 eventType 与 axis 都只当不透明字符串（业务无知不变）。
   */
  private readonly formalEvents = new Map<string, { capability: CapabilityId; axis: string }>();
  private readonly requires = new Map<string, readonly { capability: CapabilityId; contractVersion: string; required?: boolean }[]>();
  private eventAuthority: { pluginId: string; mode: string } | null = null;
  private readonly manifests = new Map<string, PluginManifest>();
  readonly degraded: { plugin: string; optionalCapability: string }[] = [];

  register(m: PluginManifest): void {
    this.manifests.set(m.pluginId, m);
    for (const p of m.provides) {
      if (this.caps.has(p.capability)) {
        throw new Refusal('AMBIGUOUS_AUTHORITY', { capability: p.capability, plugin: m.pluginId });
      }
      this.caps.set(p.capability, {
        capability: p.capability,
        pluginId: m.pluginId,
        contractVersion: p.contractVersion,
        storageNamespace: m.storageNamespace,
      });
    }
    if (m.eventAuthority && m.eventAuthority !== 'none') {
      if (this.eventAuthority) {
        throw new Refusal('AMBIGUOUS_AUTHORITY', {
          axis: 'event-authority',
          first: this.eventAuthority.pluginId,
          second: m.pluginId,
        });
      }
      this.eventAuthority = { pluginId: m.pluginId, mode: m.eventAuthority };
    }
    for (const k of m.ownsKinds ?? []) {
      if (this.kindOwner.has(k.kind)) {
        throw new Refusal('AMBIGUOUS_AUTHORITY', { kind: k.kind, plugin: m.pluginId });
      }
      if (!this.caps.has(k.capability)) {
        throw new Refusal('CAPABILITY_INACTIVE', { kind: k.kind, capability: k.capability });
      }
      this.kindOwner.set(k.kind, k.capability);
    }
    // D-20（包 2）+ 包 3（N1）：正式事件类型登记（CONTRACTS.md §16.2）。判据与 ownsKinds 同族且**按序**：
    // 一个事件类型只能有一个权威签发者；归属指向未激活能力即装配失败；
    // **缺授权轴 ⇒ ACTIVATION_IMPOSSIBLE**——没有授权轴的正式事件永远产生不了授权证据，
    // 宁可装配不成立，也不留一个"写得进、证不了"的通道（fail-closed，勿"优化"成默认放行）。
    for (const e of m.ownsEventTypes ?? []) {
      if (this.formalEvents.has(e.eventType)) {
        throw new Refusal('AMBIGUOUS_AUTHORITY', { axis: 'event-type', eventType: e.eventType, plugin: m.pluginId });
      }
      if (!this.caps.has(e.capability)) {
        throw new Refusal('CAPABILITY_INACTIVE', { eventType: e.eventType, capability: e.capability });
      }
      if (typeof e.requiresAuthority !== 'string' || e.requiresAuthority === '') {
        throw new Refusal('ACTIVATION_IMPOSSIBLE', {
          eventType: e.eventType, capability: e.capability,
          reason: '正式事件类型未声明 requiresAuthority：没有授权轴就无法产生机制授权证据',
        });
      }
      // D-26（包 4，席位 G3-A A1-1/A1-3）：轴值判据。恶意清单把 requiresAuthority 声明成机制自身
      // 权限轴（space-write / capability-admin）时，只有写权的主体经正当通道即得 authorized:true
      // 见证——把「写权」当「业务授权」，SP-09 禁止的混同。**Kernel 业务无知如何守住**：判据只对
      // 「机制资源联合」做**排除**（MECHANISM_RESOURCES = 机制自己执行的资源名，是机制的自我陈述，
      // 不含任何科研词汇），要求登记轴名不等于其中任何一根 ⇒ 业务授权轴必须是机制联合之外的字面量。
      // Kernel 仍不硬编码任何业务轴名（domain-admission 一类不得出现在本文件），取证时照旧把 axis
      // 当不透明字符串 principalCan。同码 ACTIVATION_IMPOSSIBLE（装配期拒，零签发面）。
      if ((MECHANISM_RESOURCES as readonly string[]).includes(e.requiresAuthority)) {
        throw new Refusal('ACTIVATION_IMPOSSIBLE', {
          eventType: e.eventType, capability: e.capability, axis: e.requiresAuthority,
          reason: 'requiresAuthority 不得是机制自身权限轴（space-write/capability-admin）：写权≠业务授权（SP-09），业务授权轴必须是机制资源联合之外的字面量',
        });
      }
      this.formalEvents.set(e.eventType, { capability: e.capability, axis: e.requiresAuthority });
    }
    this.requires.set(m.pluginId, m.requires);
  }

  /** 必需代码依赖环检测：对象引用图可有环，**必需依赖图**不能（#44 §4.4、§6.3）。 */
  activate(): void {
    const provider = (cap: CapabilityId) => this.caps.get(cap)?.pluginId;
    const state = new Map<string, 'visiting' | 'done'>();
    const walk = (id: string, path: readonly string[]): void => {
      const s = state.get(id);
      if (s === 'done') return;
      if (s === 'visiting') {
        throw new Refusal('ACTIVATION_IMPOSSIBLE', { cycle: [...path, id].join(' -> ') });
      }
      state.set(id, 'visiting');
      for (const r of this.requires.get(id) ?? []) {
        // 只有**必需**依赖进入"必需依赖图"：可选依赖缺失是降级装配，不是装配失败；
        // 可选依赖参与环检测会把"两条独立路线彼此可选"误判为不可装配。
        if (r.required === false) {
          if (provider(r.capability) === undefined) this.degraded.push({ plugin: id, optionalCapability: r.capability });
          continue;
        }
        const to = provider(r.capability);
        if (to === undefined) {
          throw new Refusal('ACTIVATION_IMPOSSIBLE', { plugin: id, missingCapability: r.capability });
        }
        if (to !== id) walk(to, [...path, id]);
      }
      state.set(id, 'done');
    };
    for (const id of this.requires.keys()) walk(id, []);
  }

  allManifests(): readonly PluginManifest[] { return [...this.manifests.values()]; }
  /** 生效路由的只读快照：判据要读实际生效的是谁，不是清单声明了谁。 */
  routes(): readonly ActivatedCapability[] { return [...this.caps.values()]; }
  setRoute(cap: CapabilityId, route: ActivatedCapability): void { this.caps.set(cap, route); }
  dropRoute(cap: CapabilityId): void { this.caps.delete(cap); }
  ownerOfKind(kind: ObjectKindLabel): ActivatedCapability | undefined {
    const cap = this.kindOwner.get(kind);
    return cap ? this.caps.get(cap) : undefined;
  }
  /** D-20（包 2）：正式事件类型的归属能力；未登记返回 undefined（= 普通事件，走通用台账通道）。 */
  formalEventOwner(eventType: string): CapabilityId | undefined { return this.formalEvents.get(eventType)?.capability; }
  /**
   * D-20（包 3，N1，CONTRACTS.md §16.2 判据 ③）：正式事件类型登记的**授权轴**（不透明字符串）。
   * 权威入口用它对已验证主体取证；注册期已拒绝缺轴登记，运行期取不到 = 账本被机制外手段变更，
   * 调用方必须 fail-closed 拒写。
   */
  formalEventAuthority(eventType: string): string | undefined { return this.formalEvents.get(eventType)?.axis; }
  capability(cap: CapabilityId): ActivatedCapability | undefined { return this.caps.get(cap); }
  get eventAuthorityMode(): { pluginId: string; mode: string } | null { return this.eventAuthority; }
  /** 所有权移交：只改 Capability→Plugin 的实现映射，不改 ObjectID/Revision（#44 §11）。 */
  reassignCapability(cap: CapabilityId, toPlugin: PluginManifest): void {
    const existing = this.caps.get(cap);
    if (!existing) throw new Refusal('CAPABILITY_INACTIVE', { capability: cap });
    if (!toPlugin.provides.some((p) => p.capability === cap)) {
      throw new Refusal('SCHEMA_INCOMPATIBLE', { capability: cap, plugin: toPlugin.pluginId });
    }
    this.caps.set(cap, {
      capability: cap,
      pluginId: toPlugin.pluginId,
      contractVersion: toPlugin.provides.find((p) => p.capability === cap)!.contractVersion,
      storageNamespace: toPlugin.storageNamespace,
    });
  }
}

/**
 * Capability→实现映射漂移时 fail-loud：换包未迁移不得静默变空（#44 §11）。
 * 读写路径共用这一条判据，避免出现"写得进读不出"的两套实现。
 */
/** 命名空间 → 能力（写侧落契约版本时用；反向映射的唯一来源是路由表）。 */
export function capabilityOfNs(registry: CapabilityRegistry, ns: string): CapabilityId | undefined {
  for (const c of registry.routes()) if (c.storageNamespace === ns) return c.capability;
  return undefined;
}

/**
 * 读面的契约版本判据：行上记录的版本与当前生效版本不同 ⇒ fail-loud。
 * 与 routeNs 并列，是第二条"读写共用"的判据；缺它就是把旧形状 payload 静默交给新读者。
 */
/**
 * 读面的契约版本判据。`recorded === ''`（无标记）**不是**"放过"的理由：
 * 没有标记意味着无法判定这行的形状由谁保证，把它交给当前读者正是 F-27 要消灭的静默错答。
 * 因此未标记与不匹配同样拒绝，迁移器必须显式盖章（PoC 尚未提供 domain_state 回填器，见 READINESS D-6）。
 */
export function assertContractVersion(capability: CapabilityId, effective: string, recorded: string): void {
  if (recorded === '' || recorded !== effective) {
    throw new Refusal('SCHEMA_INCOMPATIBLE', {
      capability, recordedContractVersion: recorded, effectiveContractVersion: effective,
      reason: '该行由不同契约版本的实现写入，形状不由当前读者保证',
    });
  }
}

export function routeNs(registry: CapabilityRegistry, dir: { owner_capability: string; ns: string }): string {
  const cap = registry.capability(dir.owner_capability);
  if (!cap) throw new Refusal('CAPABILITY_INACTIVE', { capability: dir.owner_capability });
  if (cap.storageNamespace !== dir.ns) {
    throw new Refusal('SCHEMA_INCOMPATIBLE', {
      capability: dir.owner_capability, recorded: dir.ns, declared: cap.storageNamespace,
    });
  }
  return dir.ns;
}

// ---------------------------------------------------------------- Unit-of-Work

export interface ObjectSnapshot {
  readonly oid: ObjectOid;
  readonly kind: ObjectKindLabel;
  readonly revision: number;
  readonly payload: Record<string, unknown>;
  readonly recordedSeq: CommitSequence;
}

export interface UnitOfWork {
  createObject(a: { readonly kind: ObjectKindLabel; readonly payload: unknown }): ObjectOid;
  revise(oid: ObjectOid, a: { readonly payload: unknown; readonly expectedRevision?: number }): number;
  appendLedger(a: {
    readonly eventType: string;
    readonly payload: unknown;
    readonly objectId?: ObjectOid;
    readonly revision?: number;
    readonly recordId?: string;
    readonly describedAt?: number;
    /** 缺省 true：本事件即该记录标识的首次声明；引用既有记录时须显式传 false。 */
    readonly declaresRecord?: boolean;
  }): CommitSequence;
  linkRef(a: { readonly from: RevisionRef; readonly to: AnyRef; readonly role: string; readonly required?: boolean }): void;
  /**
   * 登记成功后回三个字段：报告号 + 该报告在 H 中的位置。
   * `recordedAt` 与 `seq` 是**同一个值的两个名字**（前者沿用它写下的那条记录的字段名，
   * 后者是机制侧历史名，既有调用方在用）。一个值两个名字是已知瑕疵，实施期应二选一；
   * 这里保留别名而不是静默改名——上一轮改名直接打断了 4 个已在用的调用方。
   * 二者必须恒等，由 tests/p1-storage-tx.test.ts 断言。
   */
  recordReport(a: Omit<CheckReportRecord, 'reportId' | 'recordedAt'>): { reportId: string; recordedAt: CommitSequence; seq: CommitSequence };
  readLatest(oid: ObjectOid): ObjectSnapshot | undefined;
  /**
   * 声明一条 Raw Record（ID-08：记录有自身标识）。**声明**与**引用**在机制上是两件事：
   * 只有本方法会建立 record_id，重复声明 ⇒ `RECORD_ALREADY_DECLARED`。
   */
  declareRecord(a: { readonly recordId: string; readonly eventType: string; readonly payload: unknown }): CommitSequence;
  /** 本事务的已验证主体；领域策略据此判定业务授权（与写权分轴，SP-09）。 */
  readonly principal: VerifiedPrincipal;
}

export class Kernel {
  readonly registry = new CapabilityRegistry();
  private activated = false;

  // D-7：句柄不再是公开属性。兄弟模块经 `KERNEL_PORT` symbol 取用（见 internal.ts 的代价说明）。
  readonly #port: StoragePort;
  /** 跨命名空间读事件载荷的授权集（默认空 ⇒ 默认拒绝）。键是 capability，非 principal。 */
  readonly #crossEventRead = new Set<CapabilityId>();
  readonly space: SpaceId;
  private readonly auth: Authorizer;
  get [KERNEL_PORT](): StoragePort { return this.#port; }
  constructor(space: SpaceId, port: StoragePort, auth: Authorizer) {
    this.space = space; this.#port = port; this.auth = auth;
  }

  /**
   * 激活：先做代码依赖检查，再用**空间内持久路由**覆盖内存视图（Q44：换实现/移交是
   * 空间状态，不是代码状态）。清单里没写但路由里有的实现照样生效。
   */
  activate(): void {
    this.registry.activate();
    this.#port.read((raw) => {
      for (const r of raw.all<{ capability: string; plugin_id: string; ns: string; contract_version: string; enabled: number }>(
        `select capability, plugin_id, ns, contract_version, enabled from capability_route`,
      )) {
        if (r.enabled === 0) this.registry.dropRoute(r.capability as CapabilityId);
        else this.registry.setRoute(r.capability as CapabilityId, {
          capability: r.capability, pluginId: r.plugin_id, contractVersion: r.contract_version, storageNamespace: r.ns,
        });
      }
    });
    // 首次见到且尚无路由记录的能力 → 登记路由（此后以实现映射为准）
    this.#port.tx((raw) => {
      for (const m of this.registry.allManifests()) {
        for (const p of m.provides) {
          const exists = raw.get(`select capability from capability_route where capability=?`, p.capability);
          if (!exists) {
            raw.run(
              `insert into capability_route(capability, plugin_id, ns, contract_version) values(?,?,?,?)`,
              p.capability, m.pluginId, m.storageNamespace, p.contractVersion,
            );
          }
        }
      }
    });
    // 命名空间是**数据所有权键**：`capabilityOfNs` 靠它反查"这行是谁写的"。
    // 两个能力共用一个 ns 时归属只剩 Map 迭代顺序说了算——写侧会落到另一个能力的契约版本上，
    // 于是读侧的版本判定形同虚设。这不是可以容忍的配置，装配即拒绝（R3-C）。
    const nsOwner = new Map<string, CapabilityId>();
    for (const r of this.registry.routes()) {
      const prior = nsOwner.get(r.storageNamespace);
      if (prior !== undefined && prior !== r.capability) {
        throw new Refusal('ACTIVATION_IMPOSSIBLE', {
          reason: '两个能力声明了同一个存储命名空间，写入归属不可判定',
          storageNamespace: r.storageNamespace, capabilities: [prior, r.capability],
        });
      }
      nsOwner.set(r.storageNamespace, r.capability);
    }

    // 装配期的两条契约版本判定（F-26 / F-27）。放在覆盖之后，判的是**生效路由**而非清单意图。
    for (const m of this.registry.allManifests()) {
      for (const r of m.requires) {
        const eff = this.registry.capability(r.capability);
        if (!eff) continue;                       // 能力缺失由 registry.activate() 的既有检查负责
        if (r.contractVersion !== undefined && eff.contractVersion !== r.contractVersion) {
          throw new Refusal('ACTIVATION_IMPOSSIBLE', {
            plugin: m.pluginId, capability: r.capability, reason: 'requires 声明的契约版本与生效 provider 不符',
            required: r.contractVersion, effective: eff.contractVersion,
          });
        }
      }
      for (const p of m.provides) {
        const eff = this.registry.capability(p.capability);
        // 只在"持久路由的所有者就是本清单"时比对：换所有者是移交（transferRoute）的职责，不由这里判。
        if (eff && eff.pluginId === m.pluginId && eff.contractVersion !== p.contractVersion) {
          throw new Refusal('ACTIVATION_IMPOSSIBLE', {
            capability: p.capability, owner: m.pluginId,
            reason: '同一实现换了契约版本：先迁移数据，再显式移交路由，不允许静默改版本',
            persistedContractVersion: eff.contractVersion, declaredContractVersion: p.contractVersion,
          });
        }
      }
    }
    this.activated = true;
  }

  /** 读一条精确引用（RD-05）。路由漂移时 fail-loud。 */
  readRevision(ref: RevisionRef): ObjectSnapshot | undefined {
    return this.#port.read((raw) => {
      const dir = raw.get<{ kind: string; owner_capability: string; ns: string }>(
        `select kind, owner_capability, ns from object_directory where oid=?`, ref.oid,
      );
      if (!dir) return undefined;
      const ns = routeNs(this.registry, dir);
      const row = raw.get<{ revision: number; payload_json: string; recorded_seq: number; contract_version: string }>(
        `select revision, payload_json, recorded_seq, contract_version from domain_state where ns=? and oid=? and revision=?`,
        ns, ref.oid, ref.revision,
      );
      if (!row) return undefined;
      // 第二条读写共用判据（F-27）：这一行是谁写的版本，必须与当前生效版本一致才交出去。
      assertContractVersion(dir.owner_capability, this.registry.capability(dir.owner_capability)!.contractVersion, row.contract_version);
      return { oid: ref.oid, kind: dir.kind, revision: row.revision, payload: JSON.parse(row.payload_json), recordedSeq: row.recorded_seq as CommitSequence };
    });
  }

  /** 所有权移交 / 能力停用：数据库内原子改路由 + 留审计登记；**提交成功后**才改内存视图。 */
  transferRoute(cap: CapabilityId, to: PluginManifest, by: VerifiedPrincipal): void {
    const target = to.provides.find((p) => p.capability === cap);
    if (!target) throw new Refusal('ACTIVATION_IMPOSSIBLE', { capability: cap, targetPlugin: to.pluginId });
    this.uow(by, (tx) => {
      (tx as UnitOfWorkImpl).reassignRouteInternal(cap, to.pluginId, to.storageNamespace, target.contractVersion);
    // 移交是运维权威轴，不是空间写权：只凭 space-write 就能把能力路由改到攻击者命名空间。
    }, 'capability-admin');
    this.registry.setRoute(cap, {
      capability: cap, pluginId: to.pluginId, storageNamespace: to.storageNamespace,
      contractVersion: target.contractVersion,
    });
  }
  setRouteEnabled(cap: CapabilityId, enabled: boolean, by: VerifiedPrincipal): void {
    this.uow(by, (held) => {
      const tx = held as UnitOfWorkImpl;
      const raw = RAW_OF_UOW.get(tx)!;
      const seq = this.nextLedgerSeq(raw);
      // 包 5（D-27）写序纪律：**先写审计、后改路由**——`route_change_guarded` 是 BEFORE 触发器，
      // 逐语句核对同事务里已存在的 ledger 审计行（seq=new.changed_seq、类型与方向相符）；
      // 顺序反过来会让正当启停也撞 `ROUTE_AUDIT_REQUIRED`。审计随附是判据，不是注释（CONTRACTS.md §16.2）。
      raw.run(
        `insert into ledger(seq, space, event_type, actor, payload_json, described_at, recorded_at) values(?,?,?,?,?,?,?)`,
        seq, this.space, enabled ? 'capability-enabled' : 'capability-disabled', by.actorId,
        JSON.stringify({ capability: cap }), null, Date.now(),
      );
      raw.run(`update capability_route set enabled=?, changed_seq=? where capability=?`, enabled ? 1 : 0, seq, cap);
      this.journalEpoch(raw, seq, enabled ? 'capability-enabled' : 'capability-disabled');
    // 装卸同样是运维权威轴（SP-09），不得只凭 space-write。
    }, 'capability-admin');
    if (!enabled) { this.registry.dropRoute(cap); return; }
    // 再启用与 activate 用**同一条**权威判据：持久路由行本身（F-01：所有者是空间状态，
    // 不是装配期输入）。此前这条路径从"已加载的清单"重建路由 ⇒ 内存所有者与 DB 所有者背离，
    // ledger 里没有任何移交登记，重启后却"悄悄换人"。
    // 语义与启动一致：持久行指向的实现哪怕没在本次清单里，也照样以持久行为准（数据就写在那里），
    // 而不是退回清单——退回清单才是不动声色的权限转移。
    const row = this.#port.read((raw) => raw.get<{ plugin_id: string; ns: string; contract_version: string }>(
      `select plugin_id, ns, contract_version from capability_route where capability=? and enabled=1`, cap,
    ));
    if (!row) throw new Refusal('ACTIVATION_IMPOSSIBLE', { capability: cap, reason: '持久路由缺失或仍未启用' });
    this.registry.setRoute(cap, {
      capability: cap, pluginId: row.plugin_id, contractVersion: row.contract_version, storageNamespace: row.ns,
    });
  }

  /**
   * 对外解析一个引用（SP-02/SP-07）。**本 Kernel 只看得到本空间**，因此它从不区分
   * "目标不存在""目标在别的空间""目标尚未提交"——三者都是同一个中性形态 `OPAQUE`。
   * 报告语汇的映射是呈现层职责（RPT-09、SP-10），不进 Kernel。
   */
  resolvePresented(ref: AnyRef): { state: 'PRESENT' | 'OPAQUE' } {
    const found = ref.kind === 'object-ref' ? this.readSnapshot(ref.oid) !== undefined
      : ref.kind === 'revision-ref' ? this.readRevision(ref) !== undefined
        // S-3：身份的正源是 `records`（声明即身份），不是 ledger 的 record_id 列——
        // 后者只在"目标恰为记录"时被写，用它判定会把**本空间已提交的报告**误判成 OPAQUE。
        // 保留 ledger 分支只为兼容"身份在 records 之前"的历史形态。
        : this.#port.read((raw) => raw.get(
          `select 1 as x from records where record_id=?
           union all select 1 from ledger where record_id=? limit 1`, ref.recordId, ref.recordId) !== undefined);
    // Kernel 只看得到本空间，因此**从不**区分"不存在 / 在别的空间 / 尚未提交"。
    // 报告侧词汇（UNVERIFIABLE_REFERENCE 等）由呈现层映射，Kernel 只用中性机制形态。
    return { state: found ? 'PRESENT' : 'OPAQUE' };
  }

  /**
   * 反向依赖：只**定位候选**，不判定影响是否成立（IC-R7、C06、C09）。
   * 返回形态本身否认"影响已证明"，并且不声称发现未登记的隐含依赖。
   */
  impactCandidates(oid: ObjectOid, revision: number): {
    readonly candidates: readonly { oid: ObjectOid; revision: number; role: string }[];
    readonly claim: 'CANDIDATES_ONLY';
    readonly undeclaredDepsClaimed: false;
  } {
    const candidates = this.#port.read((raw) => raw.all<{ from_oid: string; from_rev: number; role: string }>(
      `select from_oid, from_rev, role from ref_edge where to_oid=? and to_rev=?`, oid, revision,
    ).map((r) => ({ oid: r.from_oid as ObjectOid, revision: r.from_rev, role: r.role })));
    return { candidates, claim: 'CANDIDATES_ONLY', undeclaredDepsClaimed: false };
  }

  /** 插件面入口：只交出 UnitOfWork；插件不再拿得到任意 SQL 句柄（#44 §4.2、§6.2、SP-10）。 */
  /**
   * 装配根交给插件的**窄面**：只包含"我自己这个能力"的命名空间读写，闭包捕获所需方法而不是
   * 交出 Kernel。插件拿到 Kernel 就等于拿到 transferRoute/activate/setRouteEnabled 等运维权威面，
   * 即便每次调用仍有授权核对（F-11），也不该让"能触达"成为默认形态。
   */
  /**
   * 按对象 + 事件类型 + 登记截点取回事件载荷（**机制级原语**：Kernel 把 eventType 当不透明字符串，
   * 判读 payload 是领域的事）。存在的理由：领域需要"这个对象到某水位被声明成什么"这类查询，
   * 若让它自己去碰 `port`/`raw`，就等于把全库读写交出去，命名空间隔离只在句柄层生效、在这里失效。
   */
  /**
   * D-20（包 2，CONTRACTS.md §16.2）：行内**多一个 `actor`** = ledger 里机制记下的登记者主体。
   * 加它的理由：领域投影要认"签发方"，而载荷里的 `by`/`issuer` 都只是调用方自己写的字符串，
   * 谁都可以在 `appendLedger` 时随手编一个。真正不可伪造的签发主体只有这一处——写 ledger 行时
   * 由机制从**已验证主体**落账的那一列。不新增成员、只加宽一行，窄面的封闭集判据不受影响。
   * D-20（包 3，N1）：行内**再多一个 `authority`** = ledger `authority_basis` 的机制授权见证
   * （`AuthorityEvidence | null`；null=无见证行）。这是投影判定授权结论的**唯一**可采信来源，
   * 与 E-01 泄露面第三次加宽同条目登记。解析防御：见证列内容不合形状 ⇒ 判 `authorized:false`
   * （fail-closed），绝不回退成 null 让行滑进"历史自称"分支。
   */
  eventsFor(oid: ObjectOid, eventType: string, cutoff: CommitSequence): readonly {
    seq: CommitSequence; actor: string | null; authority: AuthorityEvidence | null; payload: unknown;
  }[] {
    return this.#port.read((raw) => raw.all<{
      seq: number; actor: string | null; authority_basis: string | null; payload_json: string;
    }>(
      `select seq, actor, authority_basis, payload_json from ledger where object_id=? and event_type=? and seq <= ? order by seq`,
      oid, eventType, cutoff,
    ).map((r) => ({
      seq: r.seq as CommitSequence, actor: r.actor, authority: parseAuthorityBasis(r.authority_basis),
      payload: JSON.parse(r.payload_json) as unknown,
    })));
  }

  /** 对象归属能力（目录表是一次主键查询）；对象不存在返回 undefined 而非抛错，避免额外的存在性 oracle。 */
  ownerCapabilityOf(oid: ObjectOid): CapabilityId | undefined {
    const row = this.#port.read((raw) =>
      raw.get<{ owner_capability: string }>(`select owner_capability from object_directory where oid=?`, oid));
    return row ? (row.owner_capability as CapabilityId) : undefined;
  }

  /**
   * 装配根授权：允许某能力跨命名空间读事件**载荷**。走 `capability-admin` 这条既有运维权威轴
   * （与 activate / setRouteEnabled 同一资源）——**不新增 AuthorityResource 枚举值**，
   * 那属于 PR #42/#44 的封闭集，未经裁定不得扩。
   */
  grantCrossEventRead(capability: CapabilityId, by: VerifiedPrincipal): void {
    this.assertAuthority(by, 'capability-admin');
    this.#crossEventRead.add(capability);
  }
  revokeCrossEventRead(capability: CapabilityId, by: VerifiedPrincipal): void {
    this.assertAuthority(by, 'capability-admin');
    this.#crossEventRead.delete(capability);
  }

  faceFor(capability: CapabilityId): PluginFace {
    const writerFor = (tx: UnitOfWork): NamespaceWriter => this.namespacedWriter(capability, tx);
    const readOwn = (oid: ObjectOid) => this.readNamespaced(capability, oid);
    // E-01（外部复核提出）：跨领域读历史是 H 系统的真实需求，但**不该由任何领域插件
    // 无条件取得他能力的原始事件载荷**。默认拒绝，与 R3-A 封 revisionOf 同一先例；
    // 需要跨读的由装配根经 grantCrossEventRead 显式授权。
    // 已知耦合（登记为 P2，指向 D-12）：拒绝本身泄露"该 oid 存在且属他人"，
    // 与可预测 oid 叠加即成存在性 oracle。G1 需在"拒读"与"一律返回空"之间裁定。
    const eventsOf = (oid: ObjectOid, eventType: string, cutoff: CommitSequence) => {
      if (!this.#crossEventRead.has(capability)) {
        const owner = this.ownerCapabilityOf(oid);
        if (owner !== undefined && owner !== capability) {
          throw new Refusal('NAMESPACE_ESCAPE', {
            capability, oid, owner,
            reason: '窄面默认不得跨命名空间读事件载荷；请由装配根授权或取好再交入',
          });
        }
      }
      return this.eventsFor(oid, eventType, cutoff);
    };
    // R3-A：按任意 oid 读修订走的是对外解析路径，不限命名空间 ⇒ 交进面里等于越界口子。
    // 恒拒绝，且拒绝码与写侧越界同名（NAMESPACE_ESCAPE），便于呈现层合并处理。
    const revisionOf = (ref: RevisionRef): never => {
      throw new Refusal('NAMESPACE_ESCAPE', {
        capability, oid: ref.oid,
        reason: '窄面不得按任意 oid 跨命名空间读；请由装配根取好再交入',
      });
    };
    return { capability, space: this.space, writerFor, readOwn, eventsOf, revisionOf };
  }

  namespacedWriter(capability: CapabilityId, tx: UnitOfWork): NamespaceWriter {
    const impl = tx as UnitOfWorkImpl;
    const raw = RAW_OF_UOW.get(impl);
    // D-23 ①（迟到写形态）：`writerFor(旧句柄)` 也必须被拒——窄端口一旦允许在已终结的
    // 事务上**事后建立**，写入口的失效检查就会晚一步；在这里判，端口根本造不出来。
    if (!raw) throw new Refusal('CAPABILITY_INACTIVE', { capability, reason: 'tx 不是本 Kernel 交出的事务句柄' });
    if (CLOSED_TX.has(raw)) {
      throw new Refusal('TX_CLOSED', { capability, reason: '事务已终结（提交或回滚），不得在其上建立写端口' });
    }
    const w = new NamespaceWriterImpl(this, capability, raw);
    // D-19：写侧端口要复用 UnitOfWork 的同一套登记/台账逻辑，但必须钉住本能力作用域。
    // 映射放**模块级 WeakMap**——存成实例字段等于把通用事务句柄重新交给插件（`.constructor` 的教训）。
    WRITER_UOW.set(w, impl);
    return w;
  }

  /** 机制内部的只读命名空间读取（不经插件句柄）。 */
  readNamespaced(capability: CapabilityId, oid: ObjectOid): { revision: number; payload: Record<string, unknown> } | undefined {
    if (!this.registry.capability(capability)) throw new Refusal('CAPABILITY_INACTIVE', { capability });
    return this.#port.read((raw) => new NamespaceWriterImpl(this, capability, raw).readLatest(oid));
  }

  /**
   * 事务内的**二次**授权核对：入口检查过了还不够，因为机制内部方法在类型系统之外仍可能
   * 被强转触达。权威核对必须贴着写点，否则"移除接口方法"只是把门从牌匾上摘掉。
   */
  assertAuthority(principal: VerifiedPrincipal, resource: AuthorityResource): void {
    if (!this.auth.can(principal.actorId, resource, this.space)) {
      throw new Refusal('AUTHORITY_REQUIRED', { actor: principal.actorId, required: resource, space: this.space });
    }
  }

  /**
   * 授权**取证**的唯一只读入口（包 3，N1；CONTRACTS.md §16.2 判据 ③）。
   * 与 `assertAuthority` 读**同一本** authority 账本——只是不抛错，返回机制侧证据的布尔结论。
   * 存在理由：正式事件通道需要「未授权也照常落库、但见证记 authorized:false」（PR-A1），
   * 抛错形态承载不了这个语义。**不得**为领域另开第二套权限查询路径或第二本账——领域侧的
   * `Authorizer` 探针与本方法是同一 closure 的两个出口（world.ts 装配点可见）。
   */
  principalCan(principal: VerifiedPrincipal, resource: AuthorityResource): boolean {
    return this.auth.can(principal.actorId, resource, this.space);
  }

  get head(): CommitSequence {
    return this.#port.read((r) => r.get<{ value: number }>(`select value from meta where key='ledger_seq'`)!.value) as CommitSequence;
  }

  /**
   * 存量 required 边的完整性巡检（D-23 ②，CONTRACTS.md §16.1）——**打开期 / 迁移 / 审计路径**。
   *
   * 提交期判据已改为只验本事务新增边（增量，见 `UnitOfWorkImpl.checkRequiredRefs`），
   * 存量损坏项由本方法承接：全表巡检、**返回清单而非抛首错**，交运维逐条处置。
   * 适用面：装配根 / 运维（打开时、迁移前后、或按需调用）。它**不在插件可见面**——
   * `PluginFace` 不引用它，Kernel 本身也不交给插件；插件能触达的只有窄面。
   * 它不做的事：不改数据、不阻塞任何事务——一条存量损坏边不得永久阻塞整个空间
   * （席位 G1-A 的 A-12/B-⑦：全表重扫 = append-only 删不掉的空间级写阻塞）。
   */
  auditRequiredIntegrity(): {
    readonly checked: number;
    readonly violations: readonly RequiredEdgeViolation[];
  } {
    return this.#port.read((raw) => {
      const rows = raw.all<{
        from_oid: string; from_rev: number; role: string;
        to_oid: string | null; to_rev: number | null; to_record: string | null;
      }>(
        `select from_oid, from_rev, role, to_oid, to_rev, to_record from ref_edge where required=1`,
      );
      const violations: RequiredEdgeViolation[] = [];
      for (const r of rows) {
        const bad = evaluateRequiredEdge(raw, {
          from: r.from_oid as ObjectOid, fromRev: r.from_rev, role: r.role,
          toOid: r.to_oid as ObjectOid | null, toRev: r.to_rev, toRecord: r.to_record,
        });
        if (bad) violations.push(bad);
      }
      return { checked: rows.length, violations };
    });
  }

  /**
   * 唯一写入口：先授权、后解析（#44 §5.1「权限校验先于对象解析」/ RD-26）。
   * `requires` 让不同业务动作各自声明授权轴——路由移交用 `capability-admin` 而不是
   * 蹭 `space-write`（PR #42 SP-09：空间写权与业务授权是两件事）。
   */
  /** 领域侧取一条**能力作用域内**的事务：与 uow() 同权限，但写面收窄到本能力拥有的对象。 */
  uowFor<T>(capability: CapabilityId, principal: VerifiedPrincipal, fn: (tx: UnitOfWork) => T,
            requires: AuthorityResource = 'space-write'): T {
    return this.uow(principal, fn, requires, capability);
  }

  /**
   * D-19（外部复审，2026-10-30）：`scope` 决定这条事务能否触碰**其它能力拥有**的对象。
   * - `'assembly'`（缺省）：装配根 / Application Use-case 层，可协调跨领域事务（Q40 的原子提交要靠它）。
   * - `CapabilityId`：领域插件路径，**只能**改本能力拥有的对象；越界即 `CAPABILITY_SCOPE_ESCAPE`。
   * 缺省仍是 assembly 是有意的：把"跨领域"留给装配根显式选择，而不是让领域侧默认拿到全权事务。
   */
  uow<T>(principal: VerifiedPrincipal, fn: (tx: UnitOfWork) => T, requires: AuthorityResource = 'space-write',
         scope: CapabilityId | 'assembly' = 'assembly'): T {
    if (!this.activated) throw new Refusal('CAPABILITY_INACTIVE', { stage: 'activate' });
    if (!this.auth.can(principal.actorId, requires, this.space)) {
      throw new Refusal(requires === 'space-write' ? 'NO_SPACE_WRITE' : 'AUTHORITY_REQUIRED', {
        space: this.space, required: requires,
      });
    }
    return this.#port.tx((raw) => {
      const tx = new UnitOfWorkImpl(this, principal, raw, scope);
      // D-23 ①：回调一离开（无论正常返回还是抛出）就把**底层句柄**记入终结账。
      // 提交失败（如 SQLITE_BUSY）与回滚同形：句柄死亡，被扣住的任何派生写入口不得
      // 再以 autocommit 落库。放在 finally 而不是提交成功之后，是为了连"提交期抛错"
      // 也覆盖——那条路径上事务同样已终结。
      try {
        const out = fn(tx);
        tx.checkRequiredRefs();
        return out;
      } finally {
        CLOSED_TX.add(raw);
        TX_REQUIRED_EDGES.delete(raw);
      }
    });
  }

  /** 只读快照（无权限语义；带可见性/截点的读取见 ReadContext，#44 §5.1）。 */
  readSnapshot(oid: ObjectOid): ObjectSnapshot | undefined {
    return this.#port.read((raw) => new UnitOfWorkImpl(this, { actorId: '-', verified: true }, raw).readLatest(oid));
  }

  /**
   * 机制级事件的 journal epoch（路由变更、报告登记这类不属任何命名空间的状态变更也要可续跑）。
   * `oid` 必须留 NULL：`journal.oid` 是对象标识列，往里塞 `cap:xxx` 这类合成值等于污染该列的取值域，
   * 让任何按 oid  join 的读面拿到假对象。ns 用空间名标记"机制级"，op 说明是哪类事件。
   */
  journalEpoch(raw: RawTx, seq: CommitSequence, op: string): void {
    raw.run(`insert into journal(tx_epoch, ns, oid, op) values(?,?,null,?)`, seq, this.space, op);
  }

  nextLedgerSeq(raw: RawTx): CommitSequence {
    const cur = raw.get<{ value: number }>(`select value from meta where key='ledger_seq'`)!.value;
    const next = cur + 1;
    raw.run(`update meta set value = ? where key='ledger_seq'`, next);
    return next as CommitSequence;
  }
}

/** 插件私有状态的唯一写入口；跨命名空间写入一律拒绝。 */
export interface NamespaceWriter {
  readonly ns: string;
  write(a: { readonly ns: string; readonly oid: ObjectOid; readonly revision: number; readonly payload: unknown; readonly eventType: string }): void;
  readLatest(oid: ObjectOid): { readonly revision: number; readonly payload: Record<string, unknown> } | undefined;
  /**
   * D-19（外部复审，2026-10-30）：领域侧的**权威数据写入口**。与 `UnitOfWork.createObject/revise/linkRef`
   * 的区别只有一个但很关键——这三个方法带调用方能力，归属不符即 `CAPABILITY_SCOPE_ESCAPE`；
   * 通用事务面属装配根 / Application Use-case 层（跨领域原子提交要用它，Q40）。
   * 没有它们，"领域数据只能经所属领域权威接口修改"（Q12）就只是文档上的话。
   */
  createOwned(a: { readonly kind: ObjectKindLabel; readonly payload: unknown }): ObjectOid;
  reviseOwned(oid: ObjectOid, a: { readonly payload: unknown; readonly expectedRevision?: number }): number;
  linkOwned(a: { readonly from: RevisionRef; readonly to: AnyRef; readonly role: string; readonly required?: boolean }): void;
  /**
   * D-20（外部复审第四轮，包 2，CONTRACTS.md §16.2）：**正式事件类型的唯一写入入口**，
   * 归该事件类型的归属能力（`PluginManifest.ownsEventTypes` 登记）。与 `appendLedger` 的分工：
   * 通用通道写普通事件（受归属判据约束），本入口写正式事件（受**事件类型归属**判据约束——
   * 正式事件本就关于他人对象，例如记录域对对象模型的对象声明采纳，两根轴不可混同）。
   * 判据先于写入、零残留：① eventType 已登记且登记在本端口能力名下 ⇒ 否则 `EVENT_AUTHORITY_REQUIRED`；
   * ② objectId 存在 ⇒ 否则 `NOT_FOUND_IN_SPACE`；③ revision 在对象归属 ns 真实存在 ⇒ 否则同码。
   * ledger 行的 `actor` 由**机制**从本事务已验证主体写下：签发主体是机制事实，不是载荷字段。
   */
  appendAuthoritativeEvent(a: {
    readonly eventType: string; readonly objectId: ObjectOid; readonly revision: number;
    readonly payload: unknown; readonly describedAt?: number;
  }): CommitSequence;
}
/** 插件可见的窄面（装配根用 Kernel.faceFor 造；类型面即边界，`src/domains/**` 不得出现 Kernel）。 */
export interface PluginFace {
  readonly capability: CapabilityId;
  /** 本 Kernel 所属空间标识（领域做授权判据要用，不含任何科研语义）。 */
  readonly space: SpaceId;
  writerFor(tx: UnitOfWork): NamespaceWriter;
  readOwn(oid: ObjectOid): { revision: number; payload: Record<string, unknown> } | undefined;
  /** 按对象 + 事件类型 + 截点取事件；eventType 对机制是不透明字符串。 */
  /**
   * 作用域：**默认限本能力拥有的对象**。跨命名空间读需装配根 `grantCrossEventRead`，
   * 否则 `NAMESPACE_ESCAPE`（E-01；先例见下方 `revisionOf` 的恒拒绝）。
   * D-20（包 2，CONTRACTS.md §16.2）：行加宽一个 `actor`——机制 ledger 记下的登记者主体。
   * 领域判定"签发方"只许拿它对照，载荷里的自述字符串不算身份（这同时把 E-01 的已知泄露面
   * 加宽一项，如实登记在 §16.2）。
   * D-20（包 3，N1）：行再加宽一个 `authority`——机制授权见证（`null`=无见证行）。带见证的行，
   * 授权结论只许拿它对照，载荷 `authorization` 仅为意图声明（E-01 泄露面第三次加宽，同处登记）。
   */
  eventsOf(oid: ObjectOid, eventType: string, cutoff: CommitSequence): readonly {
    seq: CommitSequence; actor: string | null; authority: AuthorityEvidence | null; payload: unknown;
  }[];
  /**
   * 恒拒绝的占位：窄面**曾经**提供按任意 oid 读修订，实测任何领域都能借此把别的能力的
   * 对象读走（R3-A）。跨命名空间的读属于装配边界，由宿主替插件取好再交进来。
   * 这里保留符号而不移除，是为了让"这个口子已经封死"成为可被攻击测试持续验证的事实；
   * 实施期应连同调用点一起删除。
   */
  revisionOf(ref: RevisionRef): never;
}


class NamespaceWriterImpl implements NamespaceWriter {
  // D-17：`private readonly` 参数属性只活在编译期，运行时是**自有实例字段**——
  // 插件经 faceFor().writerFor(tx) 就能拿到 k（全量 Kernel）与 raw（裸 SQL 句柄）。
  // 必须用 `#` 私有字段让属性在运行时**根本不存在**（`obj['#k']` 求值为 undefined，不报错）。
  readonly #k: Kernel;
  readonly #raw: RawTx;
  // P2-2（席位 A）：TS `private` 只是编译期，运行时是自有字段——
  // `Object.getOwnPropertyNames(writer)` 得到 ['cap']，`JSON.stringify` 会把 capability id 泄露出去。
  readonly #cap: CapabilityId;
  constructor(k: Kernel, cap: CapabilityId, raw: RawTx) { this.#k = k; this.#cap = cap; this.#raw = raw; }
  get ns(): string {
    const c = this.#k.registry.capability(this.#cap);
    if (!c) throw new Refusal('CAPABILITY_INACTIVE', { capability: this.#cap });
    return c.storageNamespace;
  }
  /** D-23 ① 入口守卫：底层事务已终结 ⇒ 本端口的所有读写一律 `TX_CLOSED`，且拒绝先于任何写。 */
  #assertLive(): void {
    if (CLOSED_TX.has(this.#raw)) {
      throw new Refusal('TX_CLOSED', {
        capability: this.#cap, space: this.#k.space,
        reason: '句柄所属事务已提交或回滚——迟到的写入不得经 SQLite autocommit 直接落库',
      });
    }
  }
  write(a: { ns: string; oid: ObjectOid; revision: number; payload: unknown; eventType: string }): void {
    this.#assertLive();
    if (a.ns !== this.ns) {
      throw new Refusal('NAMESPACE_ESCAPE', { attempted: a.ns, own: this.ns, capability: this.#cap, oid: a.oid });
    }
    // D-20 ①（包 2，CONTRACTS.md §16.2）：`write()` 顺手登记的台账行不得冒充正式事件类型——
    // 扩展状态行的登记事件与领域正式声明在 H 里必须是不同通道，否则本入口就是 appendLedger
    // 拒绝后的第二条后门。
    if (this.#k.registry.formalEventOwner(a.eventType) !== undefined) {
      throw new Refusal('EVENT_AUTHORITY_REQUIRED', {
        eventType: a.eventType, capability: this.#cap, channel: 'NamespaceWriter.write',
        reason: 'write() 的登记式台账行不是正式事件的写入通道；请经本能力命令 Port 的 appendAuthoritativeEvent',
      });
    }
    // D-24 ①（外部复审第四轮，席位 G1-A A-1/A-3）：状态行必须挂在**存在**的对象上。
    // 不在 `object_directory` 的 oid 是幽灵对象——没有任何对象拥有它，也没有任何合法的
    // 扩展挂载能指向它，照落即成"无主状态行 + 注入他人事件流的素材"。
    // 合法 Facet 挂载（oid 在目录、行落自己 ns）**不受影响**（Q45 正例护栏钉住）。
    // 注意本条只封"无歧义的一半"：区分"合法挂载"与"伪造他人对象状态行"需要扩展挂载登记，
    // PoC 机制层没有该机制——完整修法属 G1 存储契约，不得用"oid 主能力==写入能力"一刀切代替。
    if (!this.#raw.get(`select oid from object_directory where oid=?`, a.oid)) {
      throw new Refusal('NOT_FOUND_IN_SPACE', {
        oid: a.oid, ns: a.ns,
        reason: 'oid 不在 object_directory——幽灵对象不得有状态行，也不得有派生 ledger/journal 痕迹',
      });
    }
    const seq = this.#k.nextLedgerSeq(this.#raw);
    this.#raw.run(
      `insert into domain_state(ns, oid, revision, payload_json, recorded_seq, contract_version) values(?,?,?,?,?,?)`,
      a.ns, a.oid, a.revision, JSON.stringify(a.payload), seq,
      (() => { const c = capabilityOfNs(this.#k.registry, a.ns); return c ? this.#k.registry.capability(c)?.contractVersion ?? '' : ''; })(),
    );
    // 扩展记录的变更同样进 H（#44 §6.2：Facet 需要自己的 H 追溯）
    this.#raw.run(
      `insert into ledger(seq, space, event_type, actor, object_id, revision, payload_json, described_at, recorded_at)
       values(?,?,?,?,?,?,?,null,?)`,
      seq, this.#k.space, a.eventType, 'system:capability', a.oid, a.revision, '{}', Date.now(),
    );
    this.#raw.run(`insert into journal(tx_epoch, ns, oid, op) values(?,?,?,?)`, seq, a.ns, a.oid, 'extension-upsert');
  }
  /** 本命名空间**生效路由**上的契约版本（装配后的真实值，不是清单意图）。 */
  private effectiveContractVersion(): { cap: CapabilityId; version: string } {
    const cap = capabilityOfNs(this.#k.registry, this.ns) ?? this.#cap;
    return { cap, version: this.#k.registry.capability(cap)?.contractVersion ?? '' };
  }

  /** D-19：归属受检的权威写入口。实现复用 UnitOfWork 的同一套登记/台账逻辑，
   *  只是把作用域钉成本能力的 `#cap`——**不另写一份**，否则就成了第二个权威。 */
  createOwned(a: { kind: ObjectKindLabel; payload: unknown }): ObjectOid {
    return this.#scoped().createObject(a);
  }
  reviseOwned(oid: ObjectOid, a: { payload: unknown; expectedRevision?: number }): number {
    return this.#scoped().revise(oid, a);
  }
  linkOwned(a: { from: RevisionRef; to: AnyRef; role: string; required?: boolean }): void {
    this.#scoped().linkRef(a);
  }
  #scoped(): UnitOfWork {
    const outer = WRITER_UOW.get(this);
    if (!outer) throw new Refusal('CAPABILITY_INACTIVE', { capability: this.#cap });
    // **必须复用外层事务的同一个 RawTx**（而不是"优化"成独立句柄或按实例记账），两个理由：
    //  ① D-23 ①：终结账 `CLOSED_TX` 按事务本体判——瞬时实例必须与外层同生同死，
    //     否则"提交后 writer 上再建一个 scoped 实例"就是新的迟到写入口；
    //  ② D-23 ②：`linkOwned` 走的正是这条路径——它新增的 required 边经 `linkRef` 按
    //     **底层句柄**（外层事务）归账。若瞬时实例自带句柄或按实例记账，这些边会从
    //     提交期增量验证里静默漏掉（最容易漏的旁路，勿"重构"掉）。
    return new UnitOfWorkImpl(this.#k, outer.principal, RAW_OF_UOW.get(outer)!, this.#cap);
  }

  /**
   * D-20（包 2，CONTRACTS.md §16.2）：正式事件类型的**唯一写入入口**。
   * 包 3（N1/D-25）补齐第三层——授权取证与激活核对，判据编号与执行顺序见 §16.2：
   *
   * 为什么不复用 `#scoped().appendLedger()`：那条通道的第一道判据就是"正式事件不得从这里写"
   * （通道判据在实现层同样生效，本入口若借道就是自我拒绝）；且正式事件的归属轴是**事件类型**
   * 而非对象归属——记录域对对象模型的对象声明采纳是既定用途，对象归属检查会把合法路径一并杀掉。
   * ① 归属核对：eventType 必须登记在**本端口能力**名下；
   * ② 激活核对（D-25）：本端口能力已被运维停用时，这里与 `write()` 同判 `CAPABILITY_INACTIVE`——
   *    修前这里零核对，"停用即写不动"只覆盖了一半通道；
   * ③ 授权取证（N1，D-20 第三层）：向**机制可信**的授权来源（`registry.formalEventAuthority` 给出
   *    登记轴，`Kernel.principalCan` 读与 `assertAuthority` 同一本 authority 账本）对外层事务的
   *    已验证主体取证，证据写入 ledger 见证列 `authority_basis`。取证结论为 false **不拒写**
   *    （PR-A1：未授权声明完整保存），但带 `authorized:false` 见证的行永不被投影计入（§16.2 见证优先闸）；
   *    取不到证（轴缺失=账本被机制外变更）才 fail-closed 拒写。载荷的 `authorization` 字段自此只是
   *    意图声明——授权结论是机制事实，与"签发主体是机制事实"（actor 列）同一条原则的两半。
   * ④⑤ 对象与修订必须真实存在（修订判据与 D-24 ② 同源，按归属 ns 归因）。
   */
  appendAuthoritativeEvent(a: {
    eventType: string; objectId: ObjectOid; revision: number; payload: unknown; describedAt?: number;
  }): CommitSequence {
    this.#assertLive();
    const owner = this.#k.registry.formalEventOwner(a.eventType);
    if (owner === undefined || owner !== this.#cap) {
      throw new Refusal('EVENT_AUTHORITY_REQUIRED', {
        eventType: a.eventType, capability: this.#cap, owner: owner ?? null, channel: 'appendAuthoritativeEvent',
        reason: owner === undefined
          ? '该事件类型未登记为正式事件：没有权威签发者，机制不代它落账'
          : '该正式事件类型不归本端口能力所有——命令 Port 只能签发自己登记的事件',
      });
    }
    // D-25（包 3）：激活核对。判据与 `write()`/`readLatest()` 的 CAPABILITY_INACTIVE **同源**
    // （registry 激活视图）；修前这里零核对 ⇒ 停用拥有者后权威通道仍可签发正式事件（席位 G2-A C5）。
    if (!this.#k.registry.capability(this.#cap)) {
      throw new Refusal('CAPABILITY_INACTIVE', { capability: this.#cap, channel: 'appendAuthoritativeEvent' });
    }
    const host = WRITER_UOW.get(this);
    if (!host) throw new Refusal('CAPABILITY_INACTIVE', { capability: this.#cap });
    // N1（包 3）③：授权取证**先于对象解析**（#44 §5.1「权限校验先于对象解析」的同类排布；
    // 也让"轴缺失"这种装配性故障先于业务性错误冒头）。
    const axis = this.#k.registry.formalEventAuthority(a.eventType);
    if (axis === undefined) {
      // 注册期已拒绝缺轴登记；走到这里 = 账本被机制外手段变更 ⇒ fail-closed，绝不默认放行。
      throw new Refusal('AUTHORITY_REQUIRED', {
        eventType: a.eventType, capability: this.#cap,
        reason: '正式事件类型没有登记授权轴，机制无法取证——宁可拒写也不签发无证据的授权结论',
      });
    }
    const evidence: AuthorityEvidence = {
      axis, capability: this.#cap, authorized: this.#k.principalCan(host.principal, axis),
    };
    if (!this.#raw.get(`select oid from object_directory where oid=?`, a.objectId)) {
      throw new Refusal('NOT_FOUND_IN_SPACE', { oid: a.objectId });
    }
    if (!revisionExistsInOwnerNs(this.#raw, a.objectId, a.revision)) {
      throw new Refusal('NOT_FOUND_IN_SPACE', { oid: a.objectId, revision: a.revision, level: 'revision' });
    }
    const seq = this.#k.nextLedgerSeq(this.#raw);
    this.#raw.run(
      `insert into ledger(seq, space, event_type, actor, authority_basis, object_id, revision, payload_json, described_at, recorded_at)
       values(?,?,?,?,?,?,?,?,?,?)`,
      seq, this.#k.space, a.eventType, host.principal.actorId, JSON.stringify(evidence),
      a.objectId, a.revision,
      JSON.stringify(a.payload), a.describedAt ?? null, Date.now(),
    );
    return seq;
  }

  readLatest(oid: ObjectOid) {
    this.#assertLive();
    const row = this.#raw.get<{ revision: number; payload_json: string; contract_version: string }>(
      `select revision, payload_json, contract_version from domain_state where ns=? and oid=? order by revision desc limit 1`,
      this.ns, oid,
    );
    if (!row) return undefined;
    // F-EV-R2：行级版本判据必须装在**每一个**读面上。只装在一个面 = 半门：
    // 同一行数据在三个读面上给出两个答案，而调用方无从知道自己走的是哪一条。
    const eff = this.effectiveContractVersion();
    assertContractVersion(eff.cap, eff.version, row.contract_version);
    return { revision: row.revision, payload: JSON.parse(row.payload_json) };
  }
}

/**
 * 事务句柄的**对象图外**存储（席位 A 发现的 P1 的修法）。
 *
 * 原先写成静态方法回读，我以为"类未导出"就挡住了外部回读。**错了**：插件拿到的 `tx`
 * 满足 `tx.constructor === 实现类`，经 `.constructor` 就能拿到类引用与它上面的静态方法，
 * `private` 与未导出都拦不住。换 WeakMap 后，句柄既不是实例属性、也不是原型成员、
 * 也不是类的静态成员：**对象图上不存在任何名字能指向它**，只有本模块内的这个闭包能取到。
 */
const RAW_OF_UOW = new WeakMap<UnitOfWorkImpl, RawTx>();
/** D-19：writer → 其宿主事务。模块级同 RAW_OF_UOW 的理由——句柄不进插件可见对象的对象图。 */
const WRITER_UOW = new WeakMap<NamespaceWriterImpl, UnitOfWorkImpl>();

/**
 * D-23 ①（外部复审第四轮，2026-10-30）：**事务终结记账**（CONTRACTS.md §16.1）。
 *
 * 记账的键是 `StoragePort.tx` 交出的 `RawTx` 句柄——即**事务本体**，不是任何包装实例。
 * 这是"下沉"的落点所在：`UnitOfWorkImpl` 与 `NamespaceWriterImpl` 共享同一个底层句柄
 * （`writerFor`/`#scoped` 都从 `RAW_OF_UOW` 取），所以失效位若放在任何一个实例上，
 * 另一个写入口就照样能写（席位 G1-A 的原始反对）。`Kernel.uow` 的回调返回（无论提交
 * 还是回滚）即把该句柄记入本 `WeakSet`；此后**所有**由它派生的写入口一律 `TX_CLOSED`，
 * 包括事后用旧句柄 `writerFor` 新造的端口。
 * D-17/P2-2 的同一条教训：不用实例上的 TS `private`/参数属性——运行时可枚举，等于没藏。
 * 模块级 `WeakSet` 不在任何对象的对象图上，且随句柄回收自动失效。
 */
const CLOSED_TX = new WeakSet<RawTx>();

/** 本事务经 `linkRef` 新增的一条 required 边（D-23 ② 提交期增量验证的输入）。 */
interface RequiredEdgeRow {
  readonly from: ObjectOid; readonly fromRev: number; readonly role: string;
  readonly toOid: ObjectOid | null; readonly toRev: number | null; readonly toRecord: string | null;
}
/**
 * 本事务新增的 required 边，按**底层句柄**归账：同一事务上可能有多个包装实例
 * （外层 `UnitOfWorkImpl` + `#scoped()` 造的瞬时 scoped 实例 + writer 派生实例），
 * 增量判据必须看到它们全部——这也是不能按实例记账的第二个理由。
 */
const TX_REQUIRED_EDGES = new WeakMap<RawTx, RequiredEdgeRow[]>();

/** 单条 required 边的完整性判定结果（提交期增量验证与存量审计共用，**不另写第二套判据**）。 */
type RequiredEdgeViolation = { readonly code: 'REQUIRED_REF_MISSING' | 'HARD_REF_NOT_PINNED'; readonly detail: Record<string, unknown> };

/**
 * 机制授权见证列的解析（包 3，N1；CONTRACTS.md §16.2 判据 ③ 与读面加宽）。
 * `null` = 无见证（非权威通道行 / 机制生效前的历史行）——投影可据此走"历史按当时判据"分支。
 * **列值不合形状 ⇒ 返回"未授权见证"而不是 null**：坏掉的见证若退化成 null，行就会滑进
 * 历史自称分支被旧判据计入——fail-closed 要求坏见证只能往"不计入"的方向坍缩。
 */
function parseAuthorityBasis(col: string | null): AuthorityEvidence | null {
  if (col === null) return null;
  const malformed: AuthorityEvidence = { axis: '(malformed)', capability: '(malformed)', authorized: false };
  try {
    const v = JSON.parse(col) as { axis?: unknown; capability?: unknown; authorized?: unknown };
    if (typeof v.axis !== 'string' || v.axis === ''
      || typeof v.capability !== 'string' || v.capability === ''
      || typeof v.authorized !== 'boolean') return malformed;
    return { axis: v.axis, capability: v.capability, authorized: v.authorized };
  } catch {
    return malformed;
  }
}

/**
 * 修订级存在判据（D-24 ②）：必须按**归属命名空间**归因——join `object_directory` 后，
 * "目标对象在其归属 ns 里确有该修订"才算成立（RD-05 的精确性语义）。不带归属判据时，
 * 任何能力在自己 ns 里伪造一行 `oid@revN` 就能冒充"该对象存在第 N 修订"（席位 G1-A A-2）。
 */
function revisionExistsInOwnerNs(raw: RawTx, oid: ObjectOid, revision: number): boolean {  return raw.get(
    `select 1 as x from domain_state ds
       join object_directory d on d.oid = ds.oid and d.ns = ds.ns
      where ds.oid=? and ds.revision=?`, oid, revision,
  ) !== undefined;
}

/**
 * 逐条判定一个 required 边（判据与旧 `checkRequiredRefs` 逐句一致：源端修订存在 →
 * 目标 oid 在目录 → 硬引用必须钉死修订/记录 → 修订级存在）。变化只有两处：
 * 输入从"全表扫描"变为调用方给出的边集（D-23 ②），修订判据按归属 ns 归因（D-24 ②）。
 * 返回 `undefined` = 该边成立；否则返回应当抛出的拒绝（形态保持不变）。
 */
function evaluateRequiredEdge(raw: RawTx, r: RequiredEdgeRow): RequiredEdgeViolation | undefined {
  // 源端同样要成立：一条 from 修订不存在的必需边，本身就是不存在的历史在主张约束力。
  if (!revisionExistsInOwnerNs(raw, r.from, r.fromRev)) {
    return { code: 'REQUIRED_REF_MISSING', detail: { from: r.from, revision: r.fromRev, level: 'source' } };
  }
  if (r.toOid !== null) {
    if (!raw.get(`select oid from object_directory where oid=?`, r.toOid)) {
      return { code: 'REQUIRED_REF_MISSING', detail: { from: r.from, role: r.role, to: r.toOid } };
    }
    // S-4：硬引用不得指向**浮动目标**。object-ref 不带修订 ⇒ to_rev 为 NULL ⇒
    // 目标一被修订，这条边就静默改指新修订：无重校验、无事件，而"事务内确实存在"这一
    // 提交期判据本身会随时间改变。硬引用必须钉死到 revision-ref / record-ref。
    //
    // 位置刻意：放在"目标 oid 是否存在"**之后**，既有判据与错误码一律不变
    // （幽灵 object-ref 仍先报 REQUIRED_REF_MISSING），新码只覆盖此前无人拦截的那一种形状。
    if (r.toRev === null) {
      return { code: 'HARD_REF_NOT_PINNED', detail: {
        from: r.from, role: r.role, to: r.toOid,
        reason: 'required 引用必须钉死到 revision-ref 或 record-ref；object-ref 目标会随修订漂移',
      } };
    }
    // 精确引用要验到修订级：只验 oid 会让"指向不存在的修订"静默提交（RD-05 的精确性在此）。
    if (!revisionExistsInOwnerNs(raw, r.toOid, r.toRev)) {
      return { code: 'REQUIRED_REF_MISSING', detail: {
        from: r.from, role: r.role, to: r.toOid, revision: r.toRev, level: 'revision',
      } };
    }
  } else if (r.toRecord !== null) {
    if (!raw.get(`select record_id from records where record_id=?`, r.toRecord)) {
      return { code: 'REQUIRED_REF_MISSING', detail: { from: r.from, role: r.role, to: r.toRecord } };
    }
  }
  return undefined;
}

class UnitOfWorkImpl implements UnitOfWork {
  // D-16：同 NamespaceWriterImpl。`readonly raw` 连 TS 层面的 private 都不是，
  // 却靠接口不声明来"隐藏"——类型面藏得住，运行时藏不住。
  readonly #k: Kernel;
  readonly #raw: RawTx;
  readonly principal: VerifiedPrincipal;
  readonly #scope: CapabilityId | 'assembly';
  constructor(k: Kernel, principal: VerifiedPrincipal, raw: RawTx, scope: CapabilityId | 'assembly' = 'assembly') {
    this.#k = k; this.principal = principal; this.#raw = raw; this.#scope = scope;
    RAW_OF_UOW.set(this, raw);
  }

  /**
   * D-19 的运行时执行点。缺了它，`UnitOfWork` 的通用写面（createObject/revise/linkRef）
   * 就是**绕过领域权威的入口**：任何拿到全权事务的代码都能改任意领域对象，违背 Q12。
   * 判据只用机制事实（object_directory.owner_capability / registry.ownerOfKind），
   * 不引入任何科研语义。
   */
  #assertScope(owner: CapabilityId, what: string, oid?: ObjectOid): void {
    if (this.#scope === 'assembly' || owner === this.#scope) return;
    throw new Refusal('CAPABILITY_SCOPE_ESCAPE', { action: what, scope: this.#scope, owner, oid });
  }

  /**
   * D-23 ① 入口守卫：本句柄的底层事务已终结 ⇒ 一律 `TX_CLOSED`，拒绝先于任何读写。
   * 判据读模块级 `CLOSED_TX`（键 = 事务本体），不读本实例——同一事务上的**所有**包装
   * 实例（含事后 `writerFor` 造出的端口、`#scoped()` 造的瞬时实例）必须同生同死。
   */
  #assertLive(): void {
    if (CLOSED_TX.has(this.#raw)) {
      throw new Refusal('TX_CLOSED', {
        scope: this.#scope, space: this.#k.space, actor: this.principal.actorId,
        reason: '句柄所属事务已提交或回滚——迟到的写入不得经 SQLite autocommit 直接落库',
      });
    }
  }

  createObject(a: { kind: ObjectKindLabel; payload: unknown }): ObjectOid {
    this.#assertLive();
    const owner = this.#k.registry.ownerOfKind(a.kind);
    if (!owner) throw new Refusal('CAPABILITY_INACTIVE', { kind: a.kind });
    this.#assertScope(owner.capability, 'createObject');
    const idn = this.#raw.get<{ value: number }>(`select value from meta where key='id_counter'`)!.value + 1;
    this.#raw.run(`update meta set value = ? where key='id_counter'`, idn);
    const oid = asOid(`OBJ-${this.#k.space}-${idn}`);
    const seq = this.#k.nextLedgerSeq(this.#raw);
    // 登记序属机制事实（"何时被系统记录"），不是领域事件解释（#44 §7.1）。
    // 包 5（D-28）写序纪律：**先写出生账、后落身份行**——`directory_birth_audited` 是 BEFORE
    // 触发器，在账本非空的空间里核对 seq=created_seq 的 `object-registered` 行必须先于目录插入存在。
    this.#raw.run(
      `insert into ledger(seq, space, event_type, actor, object_id, revision, payload_json, described_at, recorded_at)
       values(?,?,?,?,?,?,?,?,?)`,
      seq, this.#k.space, 'object-registered', this.principal.actorId, oid, 1, '{}', null, Date.now(),
    );
    this.#raw.run(
      `insert into object_directory(oid, space, kind, owner_capability, ns, created_seq) values(?,?,?,?,?,?)`,
      oid, this.#k.space, a.kind, owner.capability, owner.storageNamespace, seq,
    );
    this.#raw.run(
      `insert into domain_state(ns, oid, revision, payload_json, recorded_seq, contract_version) values(?,?,?,?,?,?)`,
      owner.storageNamespace, oid, 1, JSON.stringify(a.payload), seq, owner.contractVersion,
    );
    this.#raw.run(
      `insert into journal(tx_epoch, ns, oid, op) values(?,?,?,?)`, seq, owner.storageNamespace, oid, 'state-upsert',
    );
    return oid;
  }

  revise(oid: ObjectOid, a: { payload: unknown; expectedRevision?: number }): number {
    this.#assertLive();
    const dir = this.#raw.get<{ kind: string; owner_capability: string; ns: string }>(
      `select kind, owner_capability, ns from object_directory where oid=?`, oid,
    );
    if (!dir) throw new Refusal('NOT_FOUND_IN_SPACE', { oid });
    const ns = routeNs(this.#k.registry, dir);
    this.#assertScope(dir.owner_capability as CapabilityId, 'revise', oid);
    const cur = this.#raw.get<{ m: number | null }>(
      `select max(revision) m from domain_state where ns=? and oid=?`, ns, oid,
    )!.m ?? 0;
    if (a.expectedRevision !== undefined && a.expectedRevision !== cur) {
      throw new Refusal('REQUIRED_REF_MISSING', { oid, expected: a.expectedRevision, actual: cur });
    }
    const next = cur + 1;
    const seq = this.#k.nextLedgerSeq(this.#raw);
    this.#raw.run(
      // F-EV-R2 根因：`revise` 此前**不盖契约版本戳**，于是 revision≥2 的行的 contract_version
      // 全是默认空串。配合"空标记=不可判定=拒绝"的读侧纪律（R3-B），这意味着
      // 修订过的对象在快照面根本不可读；而漏装判据的面又会把它静默端出去。
      // 写侧必须每次都盖戳，否则读侧任何判据都建立在"行里碰巧有标记"上。
      `insert into domain_state(ns, oid, revision, payload_json, recorded_seq, contract_version) values(?,?,?,?,?,?)`,
      ns, oid, next, JSON.stringify(a.payload), seq,
      (() => { const c = capabilityOfNs(this.#k.registry, ns); return c ? this.#k.registry.capability(c)?.contractVersion ?? '' : ''; })(),
    );
    this.#raw.run(
      `insert into ledger(seq, space, event_type, actor, object_id, revision, payload_json, described_at, recorded_at)
       values(?,?,?,?,?,?,?,?,?)`,
      seq, this.#k.space, 'object-revised', this.principal.actorId, oid, next, '{}', null, Date.now(),
    );
    this.#raw.run(`insert into journal(tx_epoch, ns, oid, op) values(?,?,?,?)`, seq, ns, oid, 'state-upsert');
    return next;
  }

  appendLedger(a: {
    eventType: string; payload: unknown; objectId?: ObjectOid; revision?: number;
    recordId?: string; describedAt?: number; declaresRecord?: boolean;
  }): CommitSequence {
    this.#assertLive();
    // D-20 ①（外部复审第四轮，包 2，CONTRACTS.md §16.2）**通道判据**：已登记的正式事件类型
    // 不得经通用台账写入——**一切作用域，含 assembly**。唯一入口是归属能力窄面的
    // `appendAuthoritativeEvent`（= 所属领域的授权命令 Port 背后的机制通道）。
    // 这是机制拒绝，不是约定：判据在实现的最内层写点，词法扫描网再严也不在这里做豁免。
    if (this.#k.registry.formalEventOwner(a.eventType) !== undefined) {
      throw new Refusal('EVENT_AUTHORITY_REQUIRED', {
        eventType: a.eventType, scope: this.#scope, channel: 'appendLedger',
        reason: '该事件类型已登记为正式事件：通用 appendLedger 不是它的写入通道，'
          + '必须经归属能力的授权命令 Port（机制面 = NamespaceWriter.appendAuthoritativeEvent）',
      });
    }
    if (a.objectId !== undefined) {
      const dir = this.#raw.get<{ owner_capability: string }>(
        `select owner_capability from object_directory where oid=?`, a.objectId);
      if (!dir) throw new Refusal('NOT_FOUND_IN_SPACE', { oid: a.objectId });
      // D-20 ②（外部复审第四轮，包 2）**归属判据**：scoped 事务里对他人对象记事件，走与
      // `revise` 同一条 `#assertScope(owner)`——读侧 E-01 的写侧对称门（席位 G1-A A-6 的入口）。
      // assembly 作用域保留跨领域台账：那是协调权（Q40），与 §16 两层写面的既有分工一致。
      this.#assertScope(dir.owner_capability as CapabilityId, 'appendLedger', a.objectId);
    }
    const seq = this.#k.nextLedgerSeq(this.#raw);
    if (a.recordId !== undefined) {
      // ID-08：记录有自身标识 ⇒ "首次声明"必须是唯一事件。让同一 record_id 对应多条历史行，
      // 会把精确记录引用变成歧义引用（读哪一条？），也让不可变声明可以被静默改写。
      const declaring = a.declaresRecord ?? true;
      if (declaring) {
        try {
          this.#raw.run(`insert into records(record_id, declared_seq, payload_json) values(?,?,?)`,
            a.recordId, seq, JSON.stringify(a.payload));
        } catch {
          throw new Refusal('RECORD_ALREADY_DECLARED', { recordId: a.recordId });
        }
      } else if (!this.#raw.get(`select 1 as x from records where record_id=?`, a.recordId)) {
        throw new Refusal('RECORD_UNDECLARED', { recordId: a.recordId });
      }
    }
    this.#raw.run(
      `insert into ledger(seq, space, event_type, actor, object_id, revision, record_id, payload_json, described_at, recorded_at)
       values(?,?,?,?,?,?,?,?,?,?)`,
      seq, this.#k.space, a.eventType, this.principal.actorId, a.objectId ?? null, a.revision ?? null,
      a.recordId ?? null, JSON.stringify(a.payload), a.describedAt ?? null, Date.now(),
    );
    return seq;
  }

  declareRecord(a: { recordId: string; eventType: string; payload: unknown }): CommitSequence {
    return this.appendLedger({ eventType: a.eventType, payload: a.payload, recordId: a.recordId, declaresRecord: true });
  }

  linkRef(a: { from: RevisionRef; to: AnyRef; role: string; required?: boolean }): void {
    this.#assertLive();
    // D-19：引用发起方必须在本作用域内。`from.oid` 可能是记录/非目录实体，
    // 不在 object_directory 里就没有归属可判——那种情形交由领域自己的必填引用完整性把关
    // （checkRequiredRefs），此处不臆造归属。（评审要求：负例测试见 tests/capability-scope.test.ts）
    const src = this.#raw.get<{ owner_capability: string }>(
      `select owner_capability from object_directory where oid=?`, a.from.oid);
    if (src) this.#assertScope(src.owner_capability as CapabilityId, 'linkRef', a.from.oid);
    this.#raw.run(
      `insert into ref_edge(from_oid, from_rev, to_oid, to_rev, to_record, role, required) values(?,?,?,?,?,?,?)`,
      a.from.oid, a.from.revision,
      a.to.kind === 'record-ref' ? null : a.to.oid,
      a.to.kind === 'revision-ref' ? a.to.revision : null,
      a.to.kind === 'record-ref' ? a.to.recordId : null,
      a.role, a.required ? 1 : 0,
    );
    // D-23 ②：本事务新增的 required 边**按底层句柄归账**，提交期只验这份清单。
    // 记在 WeakMap（而非实例数组）上，是因为同一事务上经 `writer.linkOwned` 的边由
    // `#scoped()` 的瞬时实例写入——按实例记账会漏掉它们（这正是"两个写入口"的教训）。
    if (a.required) {
      const row: RequiredEdgeRow = {
        from: a.from.oid, fromRev: a.from.revision, role: a.role,
        toOid: a.to.kind === 'record-ref' ? null : a.to.oid,
        toRev: a.to.kind === 'revision-ref' ? a.to.revision : null,
        toRecord: a.to.kind === 'record-ref' ? a.to.recordId : null,
      };
      const own = TX_REQUIRED_EDGES.get(this.#raw);
      if (own) own.push(row); else TX_REQUIRED_EDGES.set(this.#raw, [row]);
    }
  }

  recordReport(a: Omit<CheckReportRecord, 'reportId' | 'recordedAt'>): { reportId: string; recordedAt: CommitSequence; seq: CommitSequence } {
    this.#assertLive();
    const seq = this.#k.nextLedgerSeq(this.#raw);
    // 报告本身就是历史事件：与 check_report 同一事务写 ledger 行 + journal epoch。
    // 缺了它 ⇒ (a) 历史真源分裂成"报告表 + 登记表"两处，recorded_as_of 截点看不见报告；
    //         (b) 该 seq 在 ledger 里凭空消失，下一次成功提交会把它当成缺口。
    const isRev = a.target.kind === 'revision-ref';
    this.#raw.run(
      `insert into ledger(seq, space, event_type, actor, object_id, revision, record_id, payload_json, described_at, recorded_at)
       values(?,?,?,?,?,?,?,?,?,?)`,
      seq, this.#k.space, 'check-report-recorded', this.principal.actorId,
      isRev ? a.target.oid : null, isRev ? a.target.revision : null,
      isRev ? null : (a.target as { recordId: string }).recordId,
      JSON.stringify({ validatorId: a.validatorId, ruleVersion: a.ruleVersion, verdict: a.verdict }),
      null, Date.now(),
    );
    this.#raw.run(`insert into journal(tx_epoch, ns, oid, op) values(?,?,?,?)`,
      seq, this.#k.space, isRev ? a.target.oid : (a.target as { recordId: string }).recordId, 'check-report');
    const reportId = `RPT-${seq}`;
    // S-3：报告自身必须有身份。此前 ledger 行的 record_id 只在"目标是记录"时被占用成
    // **目标** id，报告自己既无 records 行也无身份 ⇒ 本空间已提交报告对外恒 OPAQUE、
    // required 的 record-ref 指向报告恒 REQUIRED_REF_MISSING——ID-08"报告可被引用"在机制层不可达。
    // 身份登记是机制事实（谁在何 seq 声明了什么），不含科研语义判定。
    try {
      this.#raw.run(`insert into records(record_id, declared_seq, payload_json) values(?,?,?)`,
        reportId, seq, JSON.stringify({ validatorId: a.validatorId, ruleVersion: a.ruleVersion, verdict: a.verdict }));
    } catch {
      throw new Refusal('RECORD_ALREADY_DECLARED', { recordId: reportId });
    }
    this.#raw.run(
      `insert into check_report(report_id, target_kind, target_oid, target_rev, target_record, validator_id,
        rule_version, schema_version, environment, executed_at, guarantee_scope, verdict, findings_json,
        declared_gaps_json, recorded_seq) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      reportId, a.target.kind,
      a.target.kind === 'record-ref' ? null : a.target.oid,
      a.target.kind === 'revision-ref' ? a.target.revision : null,
      a.target.kind === 'record-ref' ? a.target.recordId : null,
      a.validatorId, a.ruleVersion, a.schemaVersion, a.environment, a.executedAt, a.guaranteeScope,
      a.verdict, JSON.stringify(a.findings), JSON.stringify(a.declaredGaps), seq,
    );
    return { reportId, recordedAt: seq, seq };
  }

  readLatest(oid: ObjectOid): ObjectSnapshot | undefined {
    this.#assertLive();
    const dir = this.#raw.get<{ kind: string; owner_capability: string; ns: string }>(
      `select kind, owner_capability, ns from object_directory where oid=?`, oid,
    );
    if (!dir) return undefined;
    const ns = routeNs(this.#k.registry, dir);
    const row = this.#raw.get<{ revision: number; payload_json: string; recorded_seq: number; contract_version: string }>(
      `select revision, payload_json, recorded_seq, contract_version from domain_state where ns=? and oid=? order by revision desc limit 1`,
      ns, oid,
    );
    if (!row) return undefined;
    // F-EV-R2：与 readRevision 共用同一条判据函数，不搞第二套。
    {
      const cap = capabilityOfNs(this.#k.registry, ns);
      if (cap) assertContractVersion(cap, this.#k.registry.capability(cap)?.contractVersion ?? '', row.contract_version);
    }
    return {
      oid, kind: dir.kind, revision: row.revision,
      payload: JSON.parse(row.payload_json), recordedSeq: row.recorded_seq as CommitSequence,
    };
  }

  /** 仅机制内部可达（接口上没有此方法）；权威校验在 Kernel.transferRoute。 */
  reassignRouteInternal(cap: CapabilityId, toPlugin: string, ns: string, contractVersion?: string): void {
    this.#assertLive();
    // 二次核对（SP-09）：即使有人绕过 Kernel.transferRoute 直接触达本方法，没有 capability-admin 也写不动路由。
    this.#k.assertAuthority(this.principal, 'capability-admin');
    const cur = this.#raw.get<{ plugin_id: string; ns: string; contract_version: string }>(
      `select plugin_id, ns, contract_version from capability_route where capability=?`, cap,
    );
    if (!cur) throw new Refusal('CAPABILITY_INACTIVE', { capability: cap });
    const seq = this.#k.nextLedgerSeq(this.#raw);
    // 包 5（D-27）写序纪律：先写 `capability-transferred` 审计、后改路由行（同 setRouteEnabled，
    // `route_change_guarded` 逐语句核对已存在的审计行；三元组变更必须配 transferred 事件）。
    this.#raw.run(
      `insert into ledger(seq, space, event_type, actor, payload_json, described_at, recorded_at) values(?,?,?,?,?,?,?)`,
      seq, this.#k.space, 'capability-transferred', this.principal.actorId,
      JSON.stringify({ capability: cap, from: cur.plugin_id, to: toPlugin, fromNs: cur.ns, toNs: ns }), null, Date.now(),
    );
    this.#raw.run(
      `update capability_route set plugin_id=?, ns=?, contract_version=?, changed_seq=? where capability=?`,
      toPlugin, ns, contractVersion ?? cur.contract_version, seq, cap,
    );
    this.#k.journalEpoch(this.#raw, seq, 'capability-transferred');
  }

  /**
   * 硬业务完整性引用：事务内确实存在，否则整体回滚（#44 §7.3 / RF-02）。
   *
   * D-23 ②（外部复审第四轮）：**只验本事务新增的 required 边**——"事务内确实存在"从定义上
   * 只对事务自己的写入成立。旧实现在提交前对**全表** `required=1` 重扫，后果是一条存量损坏边
   * （旧句柄迟到写、历史缺陷、迁移残留都算）永久拒绝此后**任何人**的**任何**提交；
   * `ref_edge` 是 append-only（触发器删不掉），重开库仍阻塞 ⇒ 空间级不可自愈写阻塞
   * （席位 G1-A A-12/B-⑦）。存量完整性改由 `Kernel.auditRequiredIntegrity()` 承接
   * （打开期/迁移/审计路径，装配根/运维面，见 CONTRACTS.md §16.1）。
   * 逐条判据本身不变（含 S-4 钉死与 D-24 ② 的归属 ns 归因），见 `evaluateRequiredEdge`。
   */
  checkRequiredRefs(): void {
    for (const e of TX_REQUIRED_EDGES.get(this.#raw) ?? []) {
      const bad = evaluateRequiredEdge(this.#raw, e);
      if (bad) throw new Refusal(bad.code, bad.detail);
    }
  }
}
