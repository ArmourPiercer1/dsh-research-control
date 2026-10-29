/**
 * **合成领域策略（测试专用）**：Raw Intake / Domain Admission / 校验编排 / 派生业务视图。
 *
 * ⚠️ 本文件的判据是**合成占位规则**，只为回答"机制层能否承载这类判据"，
 * **不构成** PR #42 任何科研语义政策的实现，也不得被引用为其证据。
 * 唯一逐字对齐契约的是**归约顺序**（RPT-02/RD-38：FAIL 优先于 INDETERMINATE），
 * 因为"机制能否表达这条规则"本身就是被验证对象。
 */
import type { PluginFace, UnitOfWork } from '../kernel/kernel.ts';
import type { PluginManifest } from '../contracts/index.ts';
import { VALIDATOR_ID, synthClaimChecker, type SynthInput } from './test-validation.ts';
import type { Authorizer } from '../kernel/kernel.ts';
import { Refusal, type CommitSequence, type ObjectKindLabel, type ObjectOid, type AnyRef } from '../contracts/index.ts';
import type { Coverage, Finding } from './validation-contract.ts';

export const CAP_RECORDS = 'cap.test.records';

/** 记录侧能力的独立清单：让"领域只拿窄面"这条门禁能被真实装配检验，而不是借用别的能力。 */
export const TEST_RECORDS: PluginManifest = {
  pluginId: 'test.records', codeVersion: '0.0.1',
  provides: [{ capability: CAP_RECORDS, contractVersion: 'v1' }],
  requires: [], storageNamespace: 'dom_test_records', eventAuthority: 'none',
};

export const SYNTH_NOTE = '本模块为**测试专用**的合成策略，仅验证机制承载能力，不代表科研语义政策。';

// 合成**接纳**判据＝"能否解析成最小合法载荷"；它和"结构检查是否通过"是两件事，
// 后者由 test-validation 的 SYNTH_MISSING_REQUIRED 负责。能解析但不合格的对象必须可保存。
const PARSEABLE = (text: string): boolean => text.trim().length > 0 && !text.includes('残缺');

export class IntakeService {
  /** 窄面 + 宿主提供的事务执行器：领域不自造身份、不自开事务（F-23）。 */
  constructor(private readonly face: PluginFace, private readonly runIn: <R>(fn: (tx: UnitOfWork) => R) => R) {}

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
/**
 * 归约只消费 findings（RPT-02：FAIL > INDETERMINATE > 达成）。
 * coverage 参数**保留但不参与判定**：它独立呈现（RPT-03），一旦参与 verdict，
 * "没法检"就会伪装成判定结果。校验器不可用必须落成一条 INDETERMINATE finding。
 */
export function synthReduce(findings: readonly { outcome: string }[], _coverage?: Coverage): string {
  if (findings.some((f) => f.outcome === 'FAIL')) return 'NOT_ACHIEVED';
  if (findings.some((f) => f.outcome === 'INDETERMINATE')) return 'INDETERMINATE';
  return 'ACHIEVED';
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
  /** 事务执行器由装配根提供，主体由宿主核验；领域只写数据字段（F-23）。 */
  /**
   * `hostSnapshot` 由装配根提供：跨命名空间要读的对象由**宿主**替它取好交进来，
   * 而不是让领域拿一个能按任意 oid 读的句柄（R3-A：窄面一旦带上 revisionOf，
   * 任何领域都能把别的能力的对象读走）。
   */
  constructor(
    private readonly face: PluginFace,
    private readonly runIn: <R>(fn: (tx: UnitOfWork) => R) => R,
    private readonly hostSnapshot: (ref: { kind: 'revision-ref'; oid: ObjectOid; revision: number }) =>
      { revision: number; payload: Record<string, unknown> } | undefined,
    /** 可选：装配根提供的边角色视图。缺省空数组 ⇒ 双正源规则不触发（不假装检过）。 */
    private readonly hostEdges: (oid: ObjectOid) => readonly string[] = () => [],
  ) {}

  withValidatorOffline(validatorId: string, fn: () => void): void {
    this.offline.add(validatorId);
    try { fn(); } finally { this.offline.delete(validatorId); }
  }

  run(oid: ObjectOid, revision: number, env: SynthInput, ruleVersion = 'v1'): RunResult {
    const snap = this.hostSnapshot({ kind: 'revision-ref', oid, revision });
    if (!snap) throw new Refusal('NOT_FOUND_IN_SPACE', { oid, revision });
    let findings: readonly Finding[] = [];
    let declaredGaps: readonly string[] = [];
    let coverage: Coverage = 'COMPLETE';
    if (this.offline.has(VALIDATOR_ID)) {
      // RPT-02：校验器不可用 ⇒ 一条 INDETERMINATE finding，reason=CHECKER_UNAVAILABLE；
      // 不是 coverage 的第四个值，也不让"没法检"被读成"不合格"或被读成"达成"。
      findings = [{ code: 'CHECKER_UNAVAILABLE', outcome: 'INDETERMINATE', severity: 'NOTE' }];
      coverage = 'INCOMPLETE_DUE_TO_VISIBILITY';
    } else {
      const out = synthClaimChecker(ruleVersion).check({
        target: { kind: 'revision-ref', oid, revision }, payload: snap.payload, declaredGaps: [],
        environment: env, registeredEdges: this.hostEdges(oid),
      });
      findings = out.findings.filter((f) => f.outcome !== 'PASS');
      declaredGaps = out.declaredGaps;
      coverage = out.coverage;
    }
    const verdict = synthReduce(findings, coverage);
    // 报告行的**授权主体**只能是宿主核验后交出的 principal（这里是装配根提供的 runIn）；
    // env.actor 只是报告载荷里的数据字段，写进 payload 不等于获得身份（F-23）。
    const res = this.runIn((tx) => tx.recordReport({
      target: { kind: 'revision-ref', oid, revision },
      validatorId: VALIDATOR_ID, ruleVersion, schemaVersion: 'synth-1',
      environment: 'synth-env', executedAt: Date.now(), guaranteeScope: 'SYNTH-STRUCTURAL-ONLY',
      verdict, findings, declaredGaps,
    }));
    return { reportId: res.reportId, verdict, findings, declaredGaps, coverage, recordedAt: res.recordedAt };
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
  /** 只接窄面：领域持有 Kernel 或 port 就等于命名空间隔离对它失效（门禁会红，F-23）。 */
  constructor(private readonly face: PluginFace, private readonly authority?: Authorizer) {}

  declare(tx: UnitOfWork, a: { oid: ObjectOid; revision: number; stance: 'ACCEPTED' | 'WITHDRAWN' }): CommitSequence {
    const authorized = this.authority?.can(tx.principal.actorId, 'domain-admission', this.face.space) ?? false;
    return tx.appendLedger({
      eventType: 'synth:fact-designation',
      objectId: a.oid, revision: a.revision,
      payload: { stance: a.stance, by: tx.principal.actorId, note: authorized ? 'AUTHORIZED' : 'AUTHORITY_UNVERIFIED' },
    });
  }

  standingAt(oid: ObjectOid, cutoff: CommitSequence): { state: 'ADOPTED' | 'NOT_ADOPTED'; watermark: CommitSequence } {
    // 只经机制原语取事件，不碰 port/raw：否则命名空间隔离对这个领域就是纸面上的（F-23）。
    const rows = this.face.eventsOf(oid, 'synth:fact-designation', cutoff);
    {
      let state: 'ADOPTED' | 'NOT_ADOPTED' = 'NOT_ADOPTED';
      for (const r of rows) {
        const p = r.payload as { stance: string; note: string };
        if (p.note !== 'AUTHORIZED') continue;          // 未生效声明不参与投影（PR-A1）
        state = p.stance === 'ACCEPTED' ? 'ADOPTED' : 'NOT_ADOPTED';
      }
      return { state, watermark: cutoff };
    }
  }
}
