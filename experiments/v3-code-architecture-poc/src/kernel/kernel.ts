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
      raw.run(`update capability_route set enabled=?, changed_seq=? where capability=?`, enabled ? 1 : 0, seq, cap);
      raw.run(
        `insert into ledger(seq, space, event_type, actor, payload_json, described_at, recorded_at) values(?,?,?,?,?,?,?)`,
        seq, this.space, enabled ? 'capability-enabled' : 'capability-disabled', by.actorId,
        JSON.stringify({ capability: cap }), null, Date.now(),
      );
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
  eventsFor(oid: ObjectOid, eventType: string, cutoff: CommitSequence): readonly { seq: CommitSequence; payload: unknown }[] {
    return this.#port.read((raw) => raw.all<{ seq: number; payload_json: string }>(
      `select seq, payload_json from ledger where object_id=? and event_type=? and seq <= ? order by seq`,
      oid, eventType, cutoff,
    ).map((r) => ({ seq: r.seq as CommitSequence, payload: JSON.parse(r.payload_json) as unknown })));
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
    return new NamespaceWriterImpl(this, capability, RAW_OF_UOW.get(tx as UnitOfWorkImpl)!);
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

  get head(): CommitSequence {
    return this.#port.read((r) => r.get<{ value: number }>(`select value from meta where key='ledger_seq'`)!.value) as CommitSequence;
  }

  /**
   * 唯一写入口：先授权、后解析（#44 §5.1「权限校验先于对象解析」/ RD-26）。
   * `requires` 让不同业务动作各自声明授权轴——路由移交用 `capability-admin` 而不是
   * 蹭 `space-write`（PR #42 SP-09：空间写权与业务授权是两件事）。
   */
  uow<T>(principal: VerifiedPrincipal, fn: (tx: UnitOfWork) => T, requires: AuthorityResource = 'space-write'): T {
    if (!this.activated) throw new Refusal('CAPABILITY_INACTIVE', { stage: 'activate' });
    if (!this.auth.can(principal.actorId, requires, this.space)) {
      throw new Refusal(requires === 'space-write' ? 'NO_SPACE_WRITE' : 'AUTHORITY_REQUIRED', {
        space: this.space, required: requires,
      });
    }
    return this.#port.tx((raw) => {
      const tx = new UnitOfWorkImpl(this, principal, raw);
      const out = fn(tx);
      tx.checkRequiredRefs();
      return out;
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
   */
  eventsOf(oid: ObjectOid, eventType: string, cutoff: CommitSequence): readonly { seq: CommitSequence; payload: unknown }[];
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
  write(a: { ns: string; oid: ObjectOid; revision: number; payload: unknown; eventType: string }): void {
    if (a.ns !== this.ns) {
      throw new Refusal('NAMESPACE_ESCAPE', { attempted: a.ns, own: this.ns, capability: this.#cap, oid: a.oid });
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

  readLatest(oid: ObjectOid) {
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

class UnitOfWorkImpl implements UnitOfWork {
  // D-16：同 NamespaceWriterImpl。`readonly raw` 连 TS 层面的 private 都不是，
  // 却靠接口不声明来"隐藏"——类型面藏得住，运行时藏不住。
  readonly #k: Kernel;
  readonly #raw: RawTx;
  readonly principal: VerifiedPrincipal;
  constructor(k: Kernel, principal: VerifiedPrincipal, raw: RawTx) {
    this.#k = k; this.principal = principal; this.#raw = raw;
    RAW_OF_UOW.set(this, raw);
  }


  createObject(a: { kind: ObjectKindLabel; payload: unknown }): ObjectOid {
    const owner = this.#k.registry.ownerOfKind(a.kind);
    if (!owner) throw new Refusal('CAPABILITY_INACTIVE', { kind: a.kind });
    const idn = this.#raw.get<{ value: number }>(`select value from meta where key='id_counter'`)!.value + 1;
    this.#raw.run(`update meta set value = ? where key='id_counter'`, idn);
    const oid = asOid(`OBJ-${this.#k.space}-${idn}`);
    const seq = this.#k.nextLedgerSeq(this.#raw);
    this.#raw.run(
      `insert into object_directory(oid, space, kind, owner_capability, ns, created_seq) values(?,?,?,?,?,?)`,
      oid, this.#k.space, a.kind, owner.capability, owner.storageNamespace, seq,
    );
    this.#raw.run(
      `insert into domain_state(ns, oid, revision, payload_json, recorded_seq, contract_version) values(?,?,?,?,?,?)`,
      owner.storageNamespace, oid, 1, JSON.stringify(a.payload), seq, owner.contractVersion,
    );
    // 登记序属机制事实（"何时被系统记录"），不是领域事件解释（#44 §7.1）。
    this.#raw.run(
      `insert into ledger(seq, space, event_type, actor, object_id, revision, payload_json, described_at, recorded_at)
       values(?,?,?,?,?,?,?,?,?)`,
      seq, this.#k.space, 'object-registered', this.principal.actorId, oid, 1, '{}', null, Date.now(),
    );
    this.#raw.run(
      `insert into journal(tx_epoch, ns, oid, op) values(?,?,?,?)`, seq, owner.storageNamespace, oid, 'state-upsert',
    );
    return oid;
  }

  revise(oid: ObjectOid, a: { payload: unknown; expectedRevision?: number }): number {
    const dir = this.#raw.get<{ kind: string; owner_capability: string; ns: string }>(
      `select kind, owner_capability, ns from object_directory where oid=?`, oid,
    );
    if (!dir) throw new Refusal('NOT_FOUND_IN_SPACE', { oid });
    const ns = routeNs(this.#k.registry, dir);
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
    if (a.objectId !== undefined && !this.#raw.get(`select oid from object_directory where oid=?`, a.objectId)) {
      throw new Refusal('NOT_FOUND_IN_SPACE', { oid: a.objectId });
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
    this.#raw.run(
      `insert into ref_edge(from_oid, from_rev, to_oid, to_rev, to_record, role, required) values(?,?,?,?,?,?,?)`,
      a.from.oid, a.from.revision,
      a.to.kind === 'record-ref' ? null : a.to.oid,
      a.to.kind === 'revision-ref' ? a.to.revision : null,
      a.to.kind === 'record-ref' ? a.to.recordId : null,
      a.role, a.required ? 1 : 0,
    );
  }

  recordReport(a: Omit<CheckReportRecord, 'reportId' | 'recordedAt'>): { reportId: string; recordedAt: CommitSequence; seq: CommitSequence } {
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
    // 二次核对（SP-09）：即使有人绕过 Kernel.transferRoute 直接触达本方法，没有 capability-admin 也写不动路由。
    this.#k.assertAuthority(this.principal, 'capability-admin');
    const cur = this.#raw.get<{ plugin_id: string; ns: string; contract_version: string }>(
      `select plugin_id, ns, contract_version from capability_route where capability=?`, cap,
    );
    if (!cur) throw new Refusal('CAPABILITY_INACTIVE', { capability: cap });
    const seq = this.#k.nextLedgerSeq(this.#raw);
    this.#raw.run(
      `update capability_route set plugin_id=?, ns=?, contract_version=?, changed_seq=? where capability=?`,
      toPlugin, ns, contractVersion ?? cur.contract_version, seq, cap,
    );
    this.#raw.run(
      `insert into ledger(seq, space, event_type, actor, payload_json, described_at, recorded_at) values(?,?,?,?,?,?,?)`,
      seq, this.#k.space, 'capability-transferred', this.principal.actorId,
      JSON.stringify({ capability: cap, from: cur.plugin_id, to: toPlugin, fromNs: cur.ns, toNs: ns }), null, Date.now(),
    );
    this.#k.journalEpoch(this.#raw, seq, 'capability-transferred');
  }

  /** 硬业务完整性引用：事务内确实存在，否则整体回滚（#44 §7.3 / RF-02）。 */
  checkRequiredRefs(): void {
    const rows = this.#raw.all<{
      from_oid: string; from_rev: number; role: string;
      to_oid: string | null; to_rev: number | null; to_record: string | null;
    }>(
      `select from_oid, from_rev, role, to_oid, to_rev, to_record from ref_edge where required=1`,
    );
    for (const r of rows) {
      // 源端同样要成立：一条 from 修订不存在的必需边，本身就是不存在的历史在主张约束力。
      if (!this.#raw.get(`select 1 as x from domain_state where oid=? and revision=?`, r.from_oid, r.from_rev)) {
        throw new Refusal('REQUIRED_REF_MISSING', { from: r.from_oid, revision: r.from_rev, level: 'source' });
      }
      if (r.to_oid !== null) {
        if (!this.#raw.get(`select oid from object_directory where oid=?`, r.to_oid)) {
          throw new Refusal('REQUIRED_REF_MISSING', { from: r.from_oid, role: r.role, to: r.to_oid });
        }
        // S-4：硬引用不得指向**浮动目标**。object-ref 不带修订 ⇒ to_rev 为 NULL ⇒
        // 目标一被修订，这条边就静默改指新修订：无重校验、无事件，而"事务内确实存在"这一
        // 提交期判据本身会随时间改变。硬引用必须钉死到 revision-ref / record-ref。
        //
        // 位置刻意：放在"目标 oid 是否存在"**之后**，既有判据与错误码一律不变
        // （幽灵 object-ref 仍先报 REQUIRED_REF_MISSING），新码只覆盖此前无人拦截的那一种形状。
        if (r.to_rev === null) {
          throw new Refusal('HARD_REF_NOT_PINNED', {
            from: r.from_oid, role: r.role, to: r.to_oid,
            reason: 'required 引用必须钉死到 revision-ref 或 record-ref；object-ref 目标会随修订漂移',
          });
        }
        // 精确引用要验到修订级：只验 oid 会让"指向不存在的修订"静默提交（RD-05 的精确性在此）。
        if (r.to_rev !== null
          && !this.#raw.get(`select 1 as x from domain_state where oid=? and revision=?`, r.to_oid, r.to_rev)) {
          throw new Refusal('REQUIRED_REF_MISSING', {
            from: r.from_oid, role: r.role, to: r.to_oid, revision: r.to_rev, level: 'revision',
          });
        }
      } else if (r.to_record !== null) {
        if (!this.#raw.get(`select record_id from records where record_id=?`, r.to_record)) {
          throw new Refusal('REQUIRED_REF_MISSING', { from: r.from_oid, role: r.role, to: r.to_record });
        }
      }
    }
  }
}
