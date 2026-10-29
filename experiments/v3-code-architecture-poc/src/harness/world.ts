/**
 * 测试世界装配（对应 #44 §4 `product/` 组合根）。**一个 ResearchSpace = 一个 SQLite 文件**
 * （#44 §7），因此跨空间隔离在物理上就是两个不同的 DB，不存在共享连接池。
 */
import { SqlitePort } from '../storage-sqlite/sqlite-port.ts';
import { Kernel, type Authorizer, type ObjectSnapshot, type UnitOfWork } from '../kernel/kernel.ts';
import { TEST_OBJECT_MODEL } from '../domains/test-object-model.ts';
import { asSpaceId, type ObjectOid, type PluginManifest, type VerifiedPrincipal } from '../contracts/index.ts';

export interface WorldOptions {
  readonly file: string;
  readonly space: string;
  /** 授权表：actor → 资源列表。**默认为空**——没有显式授权就没有写权（#44 §7.2 / PR-A1）。 */
  readonly grants?: Readonly<Record<string, readonly string[]>>;
  readonly plugins?: readonly PluginManifest[];
}

/** 装配根主体：只为"装配期授权"存在，不参与任何业务事务。 */
const ASSEMBLY_ROOT = 'assembly-root';
/**
 * 跨命名空间事件读的授权表（E-01）。**默认不放行**——能出现在这里的就是被审过的需求，
 * 每条必须写清"谁跨读、读谁的事件、为什么"。
 */
const CROSS_EVENT_READ: readonly { capability: string; reason: string }[] = [
  {
    capability: 'cap.test.records',
    reason: 'synth:fact-designation 事件登记在被声明对象的命名空间下，而该对象归对象模型能力所有'
      + '（test-records.ts 的 factDesignationsAt 需要它）',
  },
];

export class World {
  private grants: Map<string, Set<string>>;
  private constructor(readonly opts: WorldOptions, readonly port: SqlitePort, readonly kernel: Kernel) {
    this.grants = new Map(Object.entries(opts.grants ?? {}).map(([a, r]) => [a, new Set(r)]));
  }

  static open(opts: WorldOptions): World {
    const port = new SqlitePort({ file: opts.file });
    const holder: { w?: World } = {};
    const auth: Authorizer = {
      can: (actor, resource) => holder.w!.grantsFor(actor).has(resource),
    };
    const kernel = new Kernel(asSpaceId(opts.space), port, auth);
    for (const p of opts.plugins ?? [TEST_OBJECT_MODEL]) kernel.registry.register(p);
    const w = new World(opts, port, kernel);
    holder.w = w;
    kernel.activate();
    // E-01：跨命名空间读事件载荷的**唯一合法来源是装配根**。这里是一张显式表而非默认放开，
    // 为的是让它可 grep、可审查：生产形态应改成 manifest 声明 + 宿主核对，PoC 先落在装配点。
    // 新增条目必须带理由——"为什么这个能力需要读别人命名空间的事件"。
    w.grant(ASSEMBLY_ROOT, 'capability-admin');
    for (const g of CROSS_EVENT_READ) {
      kernel.grantCrossEventRead(g.capability, { actorId: ASSEMBLY_ROOT, verified: true });
    }
    return w;
  }

  grantsFor(actor: string): Set<string> { return this.grants.get(actor) ?? new Set(); }
  grant(actor: string, ...resources: readonly string[]): void {
    const s = this.grants.get(actor) ?? new Set<string>();
    for (const r of resources) s.add(r);
    this.grants.set(actor, s);
  }
  revoke(actor: string, resource: string): void { this.grants.get(actor)?.delete(resource); }

  uow<T>(principal: VerifiedPrincipal, fn: (tx: UnitOfWork) => T): T { return this.kernel.uow(principal, fn); }
  get raw() { return this.port.raw; }
  ledgerHead() { return this.kernel.head; }
  readObject(oid: ObjectOid): ObjectSnapshot | undefined { return this.kernel.readSnapshot(oid); }
  readRevision(ref: import('../contracts/index.ts').RevisionRef): ObjectSnapshot | undefined { return this.kernel.readRevision(ref); }
  /** 所有权移交：路由在事务里原子改，提交后才反映到内存视图（#44 §11）。 */
  transferCapability(cap: import('../contracts/index.ts').CapabilityId, to: PluginManifest, by: VerifiedPrincipal): void { this.kernel.transferRoute(cap, to, by); }
  unloadCapability(cap: import('../contracts/index.ts').CapabilityId, by: VerifiedPrincipal): void { this.kernel.setRouteEnabled(cap, false, by); }
  loadCapability(cap: import('../contracts/index.ts').CapabilityId, by: VerifiedPrincipal): void { this.kernel.setRouteEnabled(cap, true, by); }
  /** 同一 DB 文件上的第二条真实连接（隔离/并发攻击用）。 */
  /** 读一条未对象化的 H 记录（ID-08：记录有标识但不是对象）。 */
  readRecord(recordId: string): { seq: number; payload: Record<string, unknown> } | undefined {
    return this.port.read((raw) => {
      const r = raw.get<{ seq: number; payload_json: string }>(
        `select declared_seq as seq, payload_json from records where record_id=?`, recordId,
      );
      return r ? { seq: r.seq, payload: JSON.parse(r.payload_json) } : undefined;
    });
  }
  /** 领域服务读取授权用的只读探针（业务授权轴，独立于 space-write，SP-09）。 */
  get authority(): Authorizer { return { can: (actor, resource) => this.grantsFor(actor).has(resource) }; }
  openSecondConnection(): SqlitePort { return this.port.openSecond(); }
  restart(): World { this.close(); return World.open(this.opts); }
  close(): void { this.port.close(); }
}

export const openWorld = (opts: WorldOptions): World => World.open(opts);
export const PRINCIPAL = (actorId: string): VerifiedPrincipal => ({ actorId, verified: true });
