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
  }): CommitSequence;
  linkRef(a: { readonly from: RevisionRef; readonly to: AnyRef; readonly role: string; readonly required?: boolean }): void;
  recordReport(a: Omit<CheckReportRecord, 'reportId' | 'recordedAt'>): { reportId: string; seq: CommitSequence };
  readLatest(oid: ObjectOid): ObjectSnapshot | undefined;
  reassignCapabilityRoute(cap: CapabilityId, toPlugin: string, ns: string, contractVersion?: string): void;
  readonly raw: RawTx;
  /** 本事务的已验证主体；领域策略据此判定业务授权（与写权分轴，SP-09）。 */
  readonly principal: VerifiedPrincipal;
}

export class Kernel {
  readonly registry = new CapabilityRegistry();
  private activated = false;

  constructor(readonly space: SpaceId, readonly port: StoragePort, private readonly auth: Authorizer) {}

  /**
   * 激活：先做代码依赖检查，再用**空间内持久路由**覆盖内存视图（Q44：换实现/移交是
   * 空间状态，不是代码状态）。清单里没写但路由里有的实现照样生效。
   */
  activate(): void {
    this.registry.activate();
    this.port.read((raw) => {
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
    this.port.tx((raw) => {
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
    this.activated = true;
  }

  /** 读一条精确引用（RD-05）。路由漂移时 fail-loud。 */
  readRevision(ref: RevisionRef): ObjectSnapshot | undefined {
    return this.port.read((raw) => {
      const dir = raw.get<{ kind: string; owner_capability: string; ns: string }>(
        `select kind, owner_capability, ns from object_directory where oid=?`, ref.oid,
      );
      if (!dir) return undefined;
      const ns = routeNs(this.registry, dir);
      const row = raw.get<{ revision: number; payload_json: string; recorded_seq: number }>(
        `select revision, payload_json, recorded_seq from domain_state where ns=? and oid=? and revision=?`,
        ns, ref.oid, ref.revision,
      );
      if (!row) return undefined;
      return { oid: ref.oid, kind: dir.kind, revision: row.revision, payload: JSON.parse(row.payload_json), recordedSeq: row.recorded_seq as CommitSequence };
    });
  }

  /** 所有权移交 / 能力停用：数据库内原子改路由 + 留审计登记；**提交成功后**才改内存视图。 */
  transferRoute(cap: CapabilityId, to: PluginManifest, by: VerifiedPrincipal): void {
    this.uow(by, (tx) => {
      tx.reassignCapabilityRoute(cap, to.pluginId, to.storageNamespace, to.provides.find((p) => p.capability === cap)!.contractVersion);
    });
    this.registry.setRoute(cap, {
      capability: cap, pluginId: to.pluginId, storageNamespace: to.storageNamespace,
      contractVersion: to.provides.find((p) => p.capability === cap)!.contractVersion,
    });
  }
  setRouteEnabled(cap: CapabilityId, enabled: boolean, by: VerifiedPrincipal): void {
    this.uow(by, (tx) => {
      const seq = this.nextLedgerSeq(tx.raw);
      tx.raw.run(`update capability_route set enabled=?, changed_seq=? where capability=?`, enabled ? 1 : 0, seq, cap);
      tx.raw.run(
        `insert into ledger(seq, space, event_type, actor, payload_json, described_at, recorded_at) values(?,?,?,?,?,?,?)`,
        seq, this.space, enabled ? 'capability-enabled' : 'capability-disabled', by.actorId,
        JSON.stringify({ capability: cap }), null, Date.now(),
      );
    });
    if (enabled) {
      for (const m of this.registry.allManifests()) {
        const p = m.provides.find((x) => x.capability === cap);
        if (p) this.registry.setRoute(cap, { capability: cap, pluginId: m.pluginId, contractVersion: p.contractVersion, storageNamespace: m.storageNamespace });
      }
    } else this.registry.dropRoute(cap);
  }

  /**
   * 对外解析一个引用（SP-02/SP-07）。**本 Kernel 只看得到本空间**，因此它从不区分
   * "目标不存在""目标在别的空间""目标尚未提交"——三者都是同一个中性形态 `OPAQUE`。
   * 报告语汇的映射是呈现层职责（RPT-09、SP-10），不进 Kernel。
   */
  resolvePresented(ref: AnyRef): { state: 'PRESENT' | 'OPAQUE' } {
    const found = ref.kind === 'object-ref' ? this.readSnapshot(ref.oid) !== undefined
      : ref.kind === 'revision-ref' ? this.readRevision(ref) !== undefined
        : this.port.read((raw) => raw.get(`select 1 as x from ledger where record_id=?`, ref.recordId) !== undefined);
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
    const candidates = this.port.read((raw) => raw.all<{ from_oid: string; from_rev: number; role: string }>(
      `select from_oid, from_rev, role from ref_edge where to_oid=? and to_rev=?`, oid, revision,
    ).map((r) => ({ oid: r.from_oid as ObjectOid, revision: r.from_rev, role: r.role })));
    return { candidates, claim: 'CANDIDATES_ONLY', undeclaredDepsClaimed: false };
  }

  /** 命名空间写入器：插件只能写自己那一份持久状态（#44 §4.2、§6.2）。 */
  namespacedWriter(capability: CapabilityId, raw: RawTx): NamespaceWriter {
    return new NamespaceWriterImpl(this, capability, raw);
  }

  get head(): CommitSequence {
    return this.port.read((r) => r.get<{ value: number }>(`select value from meta where key='ledger_seq'`)!.value) as CommitSequence;
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
    return this.port.tx((raw) => {
      const tx = new UnitOfWorkImpl(this, principal, raw);
      const out = fn(tx);
      tx.checkRequiredRefs();
      return out;
    });
  }

  /** 只读快照（无权限语义；带可见性/截点的读取见 ReadContext，#44 §5.1）。 */
  readSnapshot(oid: ObjectOid): ObjectSnapshot | undefined {
    return this.port.read((raw) => new UnitOfWorkImpl(this, { actorId: '-', verified: true }, raw).readLatest(oid));
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

class NamespaceWriterImpl implements NamespaceWriter {
  constructor(private readonly k: Kernel, private readonly cap: CapabilityId, private readonly raw: RawTx) {}
  get ns(): string {
    const c = this.k.registry.capability(this.cap);
    if (!c) throw new Refusal('CAPABILITY_INACTIVE', { capability: this.cap });
    return c.storageNamespace;
  }
  write(a: { ns: string; oid: ObjectOid; revision: number; payload: unknown; eventType: string }): void {
    if (a.ns !== this.ns) {
      throw new Refusal('NAMESPACE_ESCAPE', { attempted: a.ns, own: this.ns, capability: this.cap, oid: a.oid });
    }
    const seq = this.k.nextLedgerSeq(this.raw);
    this.raw.run(
      `insert into domain_state(ns, oid, revision, payload_json, recorded_seq) values(?,?,?,?,?)`,
      a.ns, a.oid, a.revision, JSON.stringify(a.payload), seq,
    );
    // 扩展记录的变更同样进 H（#44 §6.2：Facet 需要自己的 H 追溯）
    this.raw.run(
      `insert into ledger(seq, space, event_type, actor, object_id, revision, payload_json, described_at, recorded_at)
       values(?,?,?,?,?,?,?,null,?)`,
      seq, this.k.space, a.eventType, 'system:capability', a.oid, a.revision, '{}', Date.now(),
    );
    this.raw.run(`insert into journal(tx_epoch, ns, oid, op) values(?,?,?,?)`, seq, a.ns, a.oid, 'extension-upsert');
  }
  readLatest(oid: ObjectOid) {
    const row = this.raw.get<{ revision: number; payload_json: string }>(
      `select revision, payload_json from domain_state where ns=? and oid=? order by revision desc limit 1`,
      this.ns, oid,
    );
    return row ? { revision: row.revision, payload: JSON.parse(row.payload_json) } : undefined;
  }
}

class UnitOfWorkImpl implements UnitOfWork {
  constructor(
    private readonly k: Kernel,
    readonly principal: VerifiedPrincipal,
    readonly raw: RawTx,
  ) {}

  createObject(a: { kind: ObjectKindLabel; payload: unknown }): ObjectOid {
    const owner = this.k.registry.ownerOfKind(a.kind);
    if (!owner) throw new Refusal('CAPABILITY_INACTIVE', { kind: a.kind });
    const idn = this.raw.get<{ value: number }>(`select value from meta where key='id_counter'`)!.value + 1;
    this.raw.run(`update meta set value = ? where key='id_counter'`, idn);
    const oid = asOid(`OBJ-${this.k.space}-${idn}`);
    const seq = this.k.nextLedgerSeq(this.raw);
    this.raw.run(
      `insert into object_directory(oid, space, kind, owner_capability, ns, created_seq) values(?,?,?,?,?,?)`,
      oid, this.k.space, a.kind, owner.capability, owner.storageNamespace, seq,
    );
    this.raw.run(
      `insert into domain_state(ns, oid, revision, payload_json, recorded_seq) values(?,?,?,?,?)`,
      owner.storageNamespace, oid, 1, JSON.stringify(a.payload), seq,
    );
    // 登记序属机制事实（"何时被系统记录"），不是领域事件解释（#44 §7.1）。
    this.raw.run(
      `insert into ledger(seq, space, event_type, actor, object_id, revision, payload_json, described_at, recorded_at)
       values(?,?,?,?,?,?,?,?,?)`,
      seq, this.k.space, 'object-registered', this.principal.actorId, oid, 1, '{}', null, Date.now(),
    );
    this.raw.run(
      `insert into journal(tx_epoch, ns, oid, op) values(?,?,?,?)`, seq, owner.storageNamespace, oid, 'state-upsert',
    );
    return oid;
  }

  revise(oid: ObjectOid, a: { payload: unknown; expectedRevision?: number }): number {
    const dir = this.raw.get<{ kind: string; owner_capability: string; ns: string }>(
      `select kind, owner_capability, ns from object_directory where oid=?`, oid,
    );
    if (!dir) throw new Refusal('NOT_FOUND_IN_SPACE', { oid });
    const ns = routeNs(this.k.registry, dir);
    const cur = this.raw.get<{ m: number | null }>(
      `select max(revision) m from domain_state where ns=? and oid=?`, ns, oid,
    )!.m ?? 0;
    if (a.expectedRevision !== undefined && a.expectedRevision !== cur) {
      throw new Refusal('REQUIRED_REF_MISSING', { oid, expected: a.expectedRevision, actual: cur });
    }
    const next = cur + 1;
    const seq = this.k.nextLedgerSeq(this.raw);
    this.raw.run(
      `insert into domain_state(ns, oid, revision, payload_json, recorded_seq) values(?,?,?,?,?)`,
      ns, oid, next, JSON.stringify(a.payload), seq,
    );
    this.raw.run(
      `insert into ledger(seq, space, event_type, actor, object_id, revision, payload_json, described_at, recorded_at)
       values(?,?,?,?,?,?,?,?,?)`,
      seq, this.k.space, 'object-revised', this.principal.actorId, oid, next, '{}', null, Date.now(),
    );
    this.raw.run(`insert into journal(tx_epoch, ns, oid, op) values(?,?,?,?)`, seq, ns, oid, 'state-upsert');
    return next;
  }

  appendLedger(a: {
    eventType: string; payload: unknown; objectId?: ObjectOid; revision?: number;
    recordId?: string; describedAt?: number;
  }): CommitSequence {
    if (a.objectId !== undefined && !this.raw.get(`select oid from object_directory where oid=?`, a.objectId)) {
      throw new Refusal('NOT_FOUND_IN_SPACE', { oid: a.objectId });
    }
    const seq = this.k.nextLedgerSeq(this.raw);
    this.raw.run(
      `insert into ledger(seq, space, event_type, actor, object_id, revision, record_id, payload_json, described_at, recorded_at)
       values(?,?,?,?,?,?,?,?,?,?)`,
      seq, this.k.space, a.eventType, this.principal.actorId, a.objectId ?? null, a.revision ?? null,
      a.recordId ?? null, JSON.stringify(a.payload), a.describedAt ?? null, Date.now(),
    );
    return seq;
  }

  linkRef(a: { from: RevisionRef; to: AnyRef; role: string; required?: boolean }): void {
    this.raw.run(
      `insert into ref_edge(from_oid, from_rev, to_oid, to_rev, to_record, role, required) values(?,?,?,?,?,?,?)`,
      a.from.oid, a.from.revision,
      a.to.kind === 'record-ref' ? null : a.to.oid,
      a.to.kind === 'revision-ref' ? a.to.revision : null,
      a.to.kind === 'record-ref' ? a.to.recordId : null,
      a.role, a.required ? 1 : 0,
    );
  }

  recordReport(a: Omit<CheckReportRecord, 'reportId' | 'recordedAt'>): { reportId: string; seq: CommitSequence } {
    const seq = this.k.nextLedgerSeq(this.raw);
    const reportId = `RPT-${seq}`;
    this.raw.run(
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
    return { reportId, seq };
  }

  readLatest(oid: ObjectOid): ObjectSnapshot | undefined {
    const dir = this.raw.get<{ kind: string; owner_capability: string; ns: string }>(
      `select kind, owner_capability, ns from object_directory where oid=?`, oid,
    );
    if (!dir) return undefined;
    const ns = routeNs(this.k.registry, dir);
    const row = this.raw.get<{ revision: number; payload_json: string; recorded_seq: number }>(
      `select revision, payload_json, recorded_seq from domain_state where ns=? and oid=? order by revision desc limit 1`,
      ns, oid,
    );
    if (!row) return undefined;
    return {
      oid, kind: dir.kind, revision: row.revision,
      payload: JSON.parse(row.payload_json), recordedSeq: row.recorded_seq as CommitSequence,
    };
  }

  reassignCapabilityRoute(cap: CapabilityId, toPlugin: string, ns: string, contractVersion?: string): void {
    const cur = this.raw.get<{ plugin_id: string; ns: string; contract_version: string }>(
      `select plugin_id, ns, contract_version from capability_route where capability=?`, cap,
    );
    if (!cur) throw new Refusal('CAPABILITY_INACTIVE', { capability: cap });
    const seq = this.k.nextLedgerSeq(this.raw);
    this.raw.run(
      `update capability_route set plugin_id=?, ns=?, contract_version=?, changed_seq=? where capability=?`,
      toPlugin, ns, contractVersion ?? cur.contract_version, seq, cap,
    );
    this.raw.run(
      `insert into ledger(seq, space, event_type, actor, payload_json, described_at, recorded_at) values(?,?,?,?,?,?,?)`,
      seq, this.k.space, 'capability-transferred', this.principal.actorId,
      JSON.stringify({ capability: cap, from: cur.plugin_id, to: toPlugin, fromNs: cur.ns, toNs: ns }), null, Date.now(),
    );
  }

  /** 硬业务完整性引用：事务内确实存在，否则整体回滚（#44 §7.3 / RF-02）。 */
  checkRequiredRefs(): void {
    const rows = this.raw.all<{ from_oid: string; role: string; to_oid: string | null; to_record: string | null }>(
      `select from_oid, role, to_oid, to_record from ref_edge where required=1`,
    );
    for (const r of rows) {
      if (r.to_oid !== null) {
        if (!this.raw.get(`select oid from object_directory where oid=?`, r.to_oid)) {
          throw new Refusal('REQUIRED_REF_MISSING', { from: r.from_oid, role: r.role, to: r.to_oid });
        }
      } else if (r.to_record !== null) {
        if (!this.raw.get(`select record_id from ledger where record_id=?`, r.to_record)) {
          throw new Refusal('REQUIRED_REF_MISSING', { from: r.from_oid, role: r.role, to: r.to_record });
        }
      }
    }
  }
}
