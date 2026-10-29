/**
 * ReadContext 读路径（#44 §5.1、T-05/RD-32/IC-H6）。
 *
 * 关键纪律：**先按知识截点过滤可见性，再按对象时间过滤**，两步顺序不得交换或合并。
 * Kernel 只执行谓词，不解释"对象时间"的科研含义——它不知道 describedAt 指的是装置、
 * 模型还是实验；把含义写进 payload 是领域的事（#44 §5.3 停线）。
 */
import { Refusal, type CommitSequence, type ObjectOid, type ReadContextSpec } from '../contracts/index.ts';
import type { Kernel } from './kernel.ts';

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
  if (spec.space !== k.space) throw new Refusal('CROSS_SPACE_REFUSED', { requested: spec.space, owned: k.space });
  // 一个 Kernel 只服务一个空间：让 SP-1 的 Kernel 去解析 SP-2 是上下文错误，不是数据查询。
  if (spec.space !== k.space) throw new Refusal('CROSS_SPACE_REFUSED', { requested: spec.space, owned: k.space });

  const head = k.head;
  const defaulted = spec.recordedAsOf === undefined;
  const cutoff = (spec.recordedAsOf ?? head) as CommitSequence;
  const described = spec.describedAtOrDuring?.at ?? null;
  const during = spec.describedAtOrDuring?.during ?? null;

  return k.port.read((raw) => {
    // 第一步：可见性（知识截点）。这一层永远先跑，且与对象时间无关。
    const visible = raw.all<{ oid: string; revision: number; payload_json: string; recorded_seq: number }>(
      `select oid, revision, payload_json, recorded_seq from domain_state where recorded_seq <= ? order by recorded_seq, oid`,
      cutoff,
    );
    // 第二步：对象时间。仅在可见集合上施加。
    const rows = visible
      .map((r) => ({ oid: r.oid as ObjectOid, revision: r.revision, payload: JSON.parse(r.payload_json) as Record<string, unknown>, recordedSeq: r.recorded_seq as CommitSequence }))
      .filter((r) => {
        const t = r.payload.describedAt;
        if (described !== null) return t === described;
        if (during) return typeof t === 'number' && t >= during[0] && t <= during[1];
        return true;
      });
    const truncated = page !== undefined && rows.length > page.limit;
    return {
      rows: truncated ? rows.slice(0, page.limit) : rows,
      echo: {
        usedRecordedAsOf: cutoff, usedDescribedAt: described, recordedAsOfWasDefaulted: defaulted,
        mode: spec.mode, truncated, moreRows: truncated,
      },
    };
  });
}
