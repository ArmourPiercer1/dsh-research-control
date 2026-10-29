/**
 * 派生投影（读面）：游标 + 基线 + 缺口检测（#44 §7.4、§9.3；Q42）。
 *
 * 三条被本文件强制区分的状态：**滞后**（可以继续用，但要标注）、**缺口**（必须全量重建）、
 * **不可判定**（不得当作空结果）。索引永远不是业务视图的真源（§9.1）。
 */
import { Refusal, type CommitSequence, type ObjectKindLabel, type ObjectOid } from '../contracts/index.ts';
import type { Kernel } from './kernel.ts';

export interface ProjectionStatus { readonly watermark: CommitSequence; readonly head: CommitSequence; readonly lag: number; readonly gap: boolean }

export class Projection {
  /** 冷启动用权威快照重建，Journal 只做增量——Journal 单独不足以充当历史（§7.4）。 */
  private index = new Map<string, Set<ObjectOid>>();

  constructor(private readonly k: Kernel, readonly name: string) {
    this.k.port.tx((raw) => {
      raw.run(`insert into projection_state(name, seq, baseline, rebuilt_at) values(?,?,?,?)
               on conflict(name) do nothing`, this.name, 0, 0, Date.now());
    });
    this.rebuildFrom('snapshot');
  }

  private row() {
    return this.k.port.read((raw) => raw.get<{ seq: number; baseline: number }>(
      `select seq, baseline from projection_state where name=?`, this.name,
    )!);
  }

  private gapAt(baseline: number, head: number): boolean {
    return this.k.port.read((raw) => {
      const epochs = raw.all<{ seq: number }>(
        `select seq from ledger where seq > ? and seq <= ? order by seq`, baseline, head,
      );
      return epochs.some((e) => !raw.get(`select 1 as x from journal where tx_epoch=?`, e.seq));
    });
  }

  status(): ProjectionStatus {
    const { seq, baseline } = this.row();
    const head = this.k.head;
    return { watermark: seq as CommitSequence, head: head as CommitSequence, lag: head - seq, gap: this.gapAt(baseline, head) };
  }

  /** 快照重建（从权威记录）或 Journal 单独重放（用来**证明**后者不够）。 */
  rebuildFrom(source: 'snapshot' | 'journal-only' | null): { applied: number } {
    this.index = new Map();
    if (source === 'journal-only') {
      const n = this.k.port.read((raw) => {
        // 机制级事件行 oid 为 NULL（不指任何对象），必须跳过而不是当成对象去查
        const rows = raw.all<{ oid: string | null; ns: string }>(`select oid, ns from journal order by seq`);
        for (const r of rows) if (r.oid !== null) this.add(r.oid as ObjectOid);
        return rows.length;
      });
      this.setCursor(this.k.head, 0);            // 基线不动 ⇒ 缺口仍然可见
      return { applied: n };
    }
    const n = this.k.port.read((raw) => raw.all<{ oid: string }>(`select oid from object_directory`).length);
    this.k.port.read((raw) => {
      for (const d of raw.all<{ oid: string; kind: string }>(`select oid, kind from object_directory`)) {
        this.bucket(`${d.kind}|${this.name}`).add(d.oid as ObjectOid);
      }
    });
    const head = this.k.head;
    this.setCursor(head, head);                   // 快照之后重新起基线
    return { applied: n };
  }

  private setCursor(seq: number, baseline: number): void {
    this.k.port.tx((raw) => raw.run(`update projection_state set seq=?, baseline=?, rebuilt_at=? where name=?`, seq, baseline, Date.now(), this.name));
  }
  private bucket(key: string): Set<ObjectOid> {
    const b = this.index.get(key) ?? new Set<ObjectOid>();
    this.index.set(key, b); return b;
  }
  private add(oid: ObjectOid): void {
    this.k.port.read((raw) => {
      const d = raw.get<{ kind: string }>(`select kind from object_directory where oid=?`, oid);
      if (d) this.bucket(`${d.kind}|${this.name}`).add(oid);
    });
  }

  /** 增量续跑：缺口未消除前拒绝，避免把半截历史当成完整历史。 */
  catchUp(): { applied: number; watermark: CommitSequence } {
    const { seq } = this.row();
    const head = this.k.head;
    if (this.gapAt(this.row().baseline, head)) throw new Refusal('FULL_REBUILD_REQUIRED', { projection: this.name, from: seq, to: head });
    const applied = this.k.port.read((raw) => {
      const rows = raw.all<{ oid: string | null; tx_epoch: number }>(`select oid, tx_epoch from journal where tx_epoch > ? order by tx_epoch`, seq);
      for (const r of rows) if (r.oid !== null) this.add(r.oid as ObjectOid);
      return rows.length;
    });
    this.setCursor(head, this.row().baseline);
    return { applied, watermark: head };
  }

  /** 索引查询必须自带新鲜度，绝不冒充权威（§9.1、Q42）。 */
  indexQuery(kind: ObjectKindLabel): { status: 'FRESH' | 'STALE'; oids: readonly ObjectOid[] } {
    const s = this.status();
    const oids = [...(this.index.get(`${kind}|${this.name}`) ?? [])];
    return { status: s.lag > 0 || s.gap ? 'STALE' : 'FRESH', oids };
  }
}
