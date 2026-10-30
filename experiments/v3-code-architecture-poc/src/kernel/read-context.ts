/**
 * ReadContext 读路径（#44 §5.1、T-05/RD-32/IC-H6）。
 *
 * 关键纪律：**先按知识截点过滤可见性，再按对象时间过滤**，两步顺序不得交换或合并。
 * Kernel 只执行谓词，不解释"对象时间"的科研含义——它不知道 describedAt 指的是装置、
 * 模型还是实验；把含义写进 payload 是领域的事（#44 §5.3 停线）。
 */
import { Refusal, type CommitSequence, type ObjectOid, type ReadContextSpec } from '../contracts/index.ts';
import { KERNEL_PORT } from './internal.ts';
import { assertContractVersion, capabilityOfNs, routeNs, type Kernel } from './kernel.ts';

export interface ReadRow { readonly oid: ObjectOid; readonly revision: number; readonly payload: Record<string, unknown>; readonly recordedSeq: CommitSequence }
export interface ReadResult {
  readonly rows: readonly ReadRow[];
  /** T-05：任何结果都要回显它实际使用的两个时间与是否采用了默认截点。 */
  readonly echo: {
    readonly usedRecordedAsOf: CommitSequence;
    readonly usedDescribedAt: number | null;
    readonly recordedAsOfWasDefaulted: boolean;
    readonly mode: string;
    /** 截断必须显式声明：空/短结果不得被读成"没有更多"（C12、CS-24、IC-P5）。 */
    readonly truncated: boolean;
    readonly moreRows: boolean;
    /**
     * 空结果的第二种成因必须与"没有对象"分开（F-24 残余，C12/T-05）。
     * 只给**数量**不给 oid：调用方需要知道"这个空是被禁用态遮出来的"，
     * 但列出被遮对象会把隐藏内容本身泄露出去。
     */
    readonly hiddenByInactiveCapability: number;
    /**
     * S-2：时间谓词命中零行时，"区间内确实没有"与"对象时间根本不叫这个键"
     * 是两件事。形状检查（可见行里有没有顶层数字 `describedAt`）能区分二者，
     * 且只看形状不解释含义 ⇒ 仍是机制判定，不是科研语义。
     */
    readonly timeFieldMissing: boolean;
    /**
     * 第三种空：行的**写入方不被当前读者保证** ⇒ 剔除并计数（同上，只给数量不给身份）。
     * D-24 读侧（G5-A 包 6，CONTRACTS.md §16.3）语义加宽，三种成因归同一计数器：
     * 契约版本偏差（F-27）/ 路由 ns 漂移（F-03 形状）/ 归属不符——他 ns 的行以他人 oid
     * 出现（快照面按属主 ns 判定本就看不到，扫描面对齐）。同一信息面、同一处置面，
     * echo 键集保持不变（冻结裁决附件钉着它）。
     */
    readonly hiddenByContractSkew: number;
  };
}

const REQUIRED_FIELDS = ['space', 'principal', 'mode', 'consistency'] as const;

export function readAsOf(k: Kernel, spec: ReadContextSpec, page?: { readonly limit: number }): ReadResult {
  if (!spec || typeof spec !== 'object') {
    throw new Refusal('CONTEXT_INCOMPLETE', { missing: [...REQUIRED_FIELDS] });
  }
  const missing = REQUIRED_FIELDS.filter((f) => (spec as unknown as Record<string, unknown>)[f] === undefined);
  if (missing.length > 0) throw new Refusal('CONTEXT_INCOMPLETE', { missing });
  // 完整性先判（缺字段是调用方错误），再判跨空间：否则缺 space 的请求会得到 CROSS_SPACE_REFUSED，
  // 把"你没填全"误报成"你不该看这里"。顺序本身就是契约。
  // 一个 Kernel 只服务一个空间：让 SP-1 的 Kernel 去解析 SP-2 是上下文错误，不是数据查询。
  if (spec.space !== k.space) throw new Refusal('CROSS_SPACE_REFUSED', { requested: spec.space, owned: k.space });

  const head = k.head;
  const defaulted = spec.recordedAsOf === undefined;
  const cutoff = (spec.recordedAsOf ?? head) as CommitSequence;
  const described = spec.describedAtOrDuring?.at ?? null;
  const during = spec.describedAtOrDuring?.during ?? null;

  return k[KERNEL_PORT].read((raw) => {
    // 每条状态行都要过**与快照读面同一条** routeNs 判据（F-03 的声明是"读写共用一条判据"，
    // 而此前只有快照面真的在用它）。两种分歧在这里的形态不同，且都必须与快照面同形：
    //  · 能力未启用/未装配 ⇒ 快照面报 CAPABILITY_INACTIVE；扫描面没有"这个对象"可报，
    //    于是把该行剔除——留着就是"禁用期双时间面还在端出对象"（F-24）。
    // D-24 读侧（G5-A 包 6，CONTRACTS.md §16.3）补两条：
    //  · **归属判定共用**：扫描查询带上行 `ns`，行 ns 必须等于该对象的有效归属 ns
    //    （= `routeNs` 的返回值，与快照面 `where ns=?` 用的是同一个函数的同一个输出）。
    //    他人 ns 冒名行、合法 Facet 挂载行在快照面本就不可见，扫描面从此对齐——
    //    「同一对象同一时刻两个答案」终结。归属不符 ⇒ 剔除并计数。
    //  · 命名空间漂移（dir.ns ≠ 生效路由 ns）⇒ 快照面对该对象报 SCHEMA_INCOMPATIBLE；
    //    扫描面**计数不上抛**（旧行为整页炸死：一个漂移对象毒掉每一个历史截点页，
    //    §14.5 扫描面分界原则——空页正是最禁止被误读成「没有」的形态）。
    // 计数归 `hiddenByContractSkew`：其语义加宽为「写入方不被当前读者保证」（版本偏差 /
    // 路由 ns 漂移 / 归属不符），同一信息面（知数量不给身份）、同一处置面，echo 键集不动。
    const dirs = new Map(raw.all<{ oid: string; owner_capability: string; ns: string }>(
      `select oid, owner_capability, ns from object_directory`,
    ).map((d) => [d.oid, d] as const));
    let hiddenByInactive = 0;
    let hiddenBySkew = 0;
    const serveable = (r: { oid: string; ns: string }): boolean => {
      const dir = dirs.get(r.oid);
      if (!dir) throw new Refusal('CONTEXT_INCOMPLETE', { oid: r.oid, reason: 'domain_state 有行但 Directory 无登记' });
      let ns: string;
      try { ns = routeNs(k.registry, dir); }
      catch (e) {
        if (e instanceof Refusal && e.code === 'CAPABILITY_INACTIVE') { hiddenByInactive += 1; return false; }
        if (e instanceof Refusal && e.code === 'SCHEMA_INCOMPATIBLE') { hiddenBySkew += 1; return false; }
        throw e;
      }
      if (r.ns !== ns) { hiddenBySkew += 1; return false; }
      return true;
    };
    // 第一步：可见性（知识截点）。这一层永远先跑，且与对象时间无关。
    const visible = raw.all<{ oid: string; ns: string; revision: number; payload_json: string; recorded_seq: number; contract_version: string }>(
      `select oid, ns, revision, payload_json, recorded_seq, contract_version from domain_state where recorded_seq <= ? order by recorded_seq, oid`,
      cutoff,
    ).filter(serveable);
    // F-EV-R2：双时间读面也过行级版本判据（与 readRevision 同一个函数）。
    // 失败形态按读面性质分（§14.5）：扫描面剔除 + 计入回显，剔除必须可归因，不得静默。
    const keep: typeof visible = [];
    for (const r of visible) {
      // 归属已由上面**同一条** routeNs 判据确立（r.ns === 有效归属 ns）；这里沿用该结论，
      // 不再第二次调用 routeNs——共用一条判据的含义包括「只判一次」。
      const cap = capabilityOfNs(k.registry, r.ns);
      if (!cap) { keep.push(r); continue; }
      try {
        assertContractVersion(cap, k.registry.capability(cap)?.contractVersion ?? '', r.contract_version);
        keep.push(r);
      } catch (e) {
        if (e instanceof Refusal && e.code === 'SCHEMA_INCOMPATIBLE') { hiddenBySkew += 1; continue; }
        throw e;
      }
    }
    // 第二步：对象时间。仅在可见集合上施加。
    const rows = visible
      .map((r) => ({ oid: r.oid as ObjectOid, revision: r.revision, payload: JSON.parse(r.payload_json) as Record<string, unknown>, recordedSeq: r.recorded_seq as CommitSequence }))
      .filter((r) => keep.some((r2) => r2.oid === r.oid && r2.revision === r.revision))
      .filter((r) => {
        const t = r.payload.describedAt;
        if (described !== null) return t === described;
        if (during) return typeof t === 'number' && t >= during[0] && t <= during[1];
        return true;
      });
    // S-2：只有在"有可见行、但没有任何一行带顶层数字 describedAt"时才声明形状缺失；
    // 可见集本身为空时不适用（那时空结果的成因是截点，不是键名）。
    const timePredicateActive = described !== null || during !== null;
    const timeFieldMissing = timePredicateActive && rows.length === 0
      && visible.length > 0
      && !visible.some((r) => typeof (JSON.parse(r.payload_json) as Record<string, unknown>).describedAt === 'number');
    const truncated = page !== undefined && rows.length > page.limit;
    return {
      rows: truncated ? rows.slice(0, page.limit) : rows,
      echo: {
        usedRecordedAsOf: cutoff, usedDescribedAt: described, recordedAsOfWasDefaulted: defaulted,
        mode: spec.mode, truncated, moreRows: truncated,
        hiddenByInactiveCapability: hiddenByInactive, hiddenByContractSkew: hiddenBySkew, timeFieldMissing,
      },
    };
  });
}
