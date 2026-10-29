/**
 * **合成领域策略（测试专用）**：Raw Intake / Domain Admission / 校验编排 / 派生业务视图。
 *
 * ⚠️ 本文件的判据是**合成占位规则**，只为回答"机制层能否承载这类判据"，
 * **不构成** PR #42 任何科研语义政策的实现，也不得被引用为其证据。
 * 唯一逐字对齐契约的是**归约顺序**（RPT-02/RD-38：FAIL 优先于 INDETERMINATE），
 * 因为"机制能否表达这条规则"本身就是被验证对象。
 */
import type { Kernel, UnitOfWork } from '../kernel/kernel.ts';
import { VALIDATOR_ID, synthClaimChecker, type SynthInput } from './test-validation.ts';
import type { Authorizer } from '../kernel/kernel.ts';
import { Refusal, type CommitSequence, type Finding, type ObjectKindLabel, type ObjectOid, type AnyRef, type Coverage } from '../contracts/index.ts';

export const SYNTH_NOTE = '本模块为**测试专用**的合成策略，仅验证机制承载能力，不代表科研语义政策。';

// 合成**接纳**判据＝"能否解析成最小合法载荷"；它和"结构检查是否通过"是两件事，
// 后者由 test-validation 的 SYNTH_MISSING_REQUIRED 负责。能解析但不合格的对象必须可保存。
const PARSEABLE = (text: string): boolean => text.trim().length > 0 && !text.includes('残缺');

export class IntakeService {
  constructor(private readonly kernel: Kernel) {}

  /** 原始材料登记：解析失败也要留下来源（IC-H3 / #44 §7.2）。不产生对象（ID-08）。 */
  intake(tx: UnitOfWork, a: { recordId: string; text: string; sourceRef: string; unparseable?: boolean }): CommitSequence {
    return tx.appendLedger({
      eventType: 'synth:raw-intake',
      recordId: a.recordId,
      payload: { text: a.text, sourceRef: a.sourceRef, parseState: a.unparseable ? 'UNPARSEABLE' : 'PARSEABLE' },
    });
  }

  /** 领域接纳判定：不接纳时**只拒绝**，绝不触碰已登记的原始输入（#44 §7.2）。 */
  tryAdmit(tx: UnitOfWork, a: { recordId: string; kind: ObjectKindLabel; text: string }): { oid: ObjectOid } | { refused: string } {
    if (!PARSEABLE(a.text)) return { refused: 'synth:not-admissible' };
    return { oid: this.admit(tx, a) };
  }

  admit(tx: UnitOfWork, a: { recordId: string; kind: ObjectKindLabel; text: string }): ObjectOid {
    if (!PARSEABLE(a.text)) throw new Refusal('synth:not-admissible', { recordId: a.recordId });
    const oid = tx.createObject({ kind: a.kind, payload: { text: a.text, fromRecord: a.recordId } });
    tx.linkRef({
      from: { kind: 'revision-ref', oid, revision: 1 },
      to: { kind: 'record-ref', recordId: a.recordId },
      role: 'synth:derived-from', required: false,
    });
    return oid;
  }

  /** 对象化路径（RF-06）：记录本身不能当端点，承载记录的个体可以。 */
  objectifyRecord(tx: UnitOfWork, a: { recordId: string }): ObjectOid {
    const oid = tx.createObject({ kind: 'test.subject', payload: { carrier: 'H-RECORD', recordId: a.recordId } });
    tx.linkRef({
      from: { kind: 'revision-ref', oid, revision: 1 },
      to: { kind: 'record-ref', recordId: a.recordId },
      role: 'synth:derived-from', required: true,
    });
    return oid;
  }
}

/** 归约顺序镜像 RPT-02/RD-38：FAIL 优先，其次 INDETERMINATE，否则达成。 */
export function synthReduce(findings: readonly { outcome: string }[], coverage: Coverage): string {
  if (findings.some((f) => f.outcome === 'FAIL')) return 'NOT_ACHIEVED';
  if (findings.some((f) => f.outcome === 'INDETERMINATE')) return 'INDETERMINATE';
  return coverage === 'CHECK_UNAVAILABLE' ? 'INDETERMINATE' : 'ACHIEVED';
}

export interface RunResult {
  readonly reportId: string;
  readonly verdict: string;
  readonly findings: readonly { code: string; outcome: string; severity: string; path?: string }[];
  readonly declaredGaps: readonly string[];
  readonly coverage: Coverage;
  readonly recordedAt: CommitSequence;
}

/** 校验编排：校验器可离线；不可用 ⇒ INDETERMINATE，且**绝不**改写既有报告。 */
export class ValidationService {
  private offline = new Set<string>();
  constructor(private readonly kernel: Kernel) {}

  withValidatorOffline(validatorId: string, fn: () => void): void {
    this.offline.add(validatorId);
    try { fn(); } finally { this.offline.delete(validatorId); }
  }

  run(oid: ObjectOid, revision: number, env: SynthInput, ruleVersion = 'v1'): RunResult {
    const snap = this.kernel.readRevision({ kind: 'revision-ref', oid, revision });
    if (!snap) throw new Refusal('NOT_FOUND_IN_SPACE', { oid, revision });
    let findings: readonly Finding[] = [];
    let declaredGaps: readonly string[] = [];
    let coverage: Coverage = 'COMPLETE';
    if (this.offline.has(VALIDATOR_ID)) {
      // 校验器不可用：不产出任何确定性判定，也不把"没法检"说成"不合格"
      coverage = 'CHECK_UNAVAILABLE';
    } else {
      const out = synthClaimChecker(ruleVersion).check({
        target: { kind: 'revision-ref', oid, revision }, payload: snap.payload, declaredGaps: [], environment: env as unknown as Record<string, never>,
      });
      findings = out.findings.filter((f) => f.outcome !== 'PASS');
      declaredGaps = out.declaredGaps;
      coverage = out.coverage;
    }
    const verdict = synthReduce(findings, coverage);
    const tx0 = this.kernel;
    const res = tx0.uow({ actorId: env.actor, verified: true }, (tx) => tx.recordReport({
      target: { kind: 'revision-ref', oid, revision },
      validatorId: VALIDATOR_ID, ruleVersion, schemaVersion: 'synth-1',
      environment: 'synth-env', executedAt: Date.now(), guaranteeScope: 'SYNTH-STRUCTURAL-ONLY',
      verdict, findings, declaredGaps,
    }));
    return { reportId: res.reportId, verdict, findings, declaredGaps, coverage, recordedAt: res.seq };
  }

  /** 端点资格判据（RF-05/RF-06）：这条规则住在**领域**，不在 Kernel。 */
  checkEndpoint(_oid: ObjectOid, _revision: number, ref: AnyRef): { accepted: boolean; code?: string } {
    if (ref.kind === 'record-ref') return { accepted: false, code: 'SYNTH_RECORD_NOT_ENDPOINT' };
    return { accepted: true };
  }
}

/**
 * 派生业务视图（合成版的"接纳投影"）：从已提交记录**回源计算**，不是对象上的可变字段（PR-A4）。
 * 未获业务授权的声明完整保存但标注 AUTHORITY_UNVERIFIED，且不参与投影（PR-A1）。
 */
export class FactStandingService {
  constructor(private readonly kernel: Kernel, private readonly authority?: Authorizer) {}

  declare(tx: UnitOfWork, a: { oid: ObjectOid; revision: number; stance: 'ACCEPTED' | 'WITHDRAWN' }): CommitSequence {
    const authorized = this.authority?.can(tx.principal.actorId, 'domain-admission', this.kernel.space) ?? false;
    return tx.appendLedger({
      eventType: 'synth:fact-designation',
      objectId: a.oid, revision: a.revision,
      payload: { stance: a.stance, by: tx.principal.actorId, note: authorized ? 'AUTHORIZED' : 'AUTHORITY_UNVERIFIED' },
    });
  }

  standingAt(oid: ObjectOid, cutoff: CommitSequence): { state: 'ADOPTED' | 'NOT_ADOPTED'; watermark: CommitSequence } {
    return this.kernel.port.read((raw) => {
      const rows = raw.all<{ payload_json: string }>(
        `select payload_json from ledger where object_id=? and event_type='synth:fact-designation' and seq <= ? order by seq`,
        oid, cutoff,
      );
      let state: 'ADOPTED' | 'NOT_ADOPTED' = 'NOT_ADOPTED';
      for (const r of rows) {
        const p = JSON.parse(r.payload_json) as { stance: string; note: string };
        if (p.note !== 'AUTHORIZED') continue;          // 未生效声明不参与投影（PR-A1）
        state = p.stance === 'ACCEPTED' ? 'ADOPTED' : 'NOT_ADOPTED';
      }
      return { state, watermark: cutoff };
    });
  }
}
