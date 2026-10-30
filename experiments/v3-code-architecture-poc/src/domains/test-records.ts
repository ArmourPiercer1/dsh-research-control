/**
 * **合成领域策略（测试专用）**：Raw Intake / Domain Admission / 校验编排 / 派生业务视图。
 *
 * ⚠️ 本文件的判据是**合成占位规则**，只为回答"机制层能否承载这类判据"，
 * **不构成** PR #42 任何科研语义政策的实现，也不得被引用为其证据。
 * 唯一逐字对齐契约的是**归约顺序**（RPT-02/RD-38：FAIL 优先于 INDETERMINATE），
 * 因为"机制能否表达这条规则"本身就是被验证对象。
 *
 * ## D-19c（外部复审第三轮，2026-10-30）：本文件**不再执行任何对象写**
 *
 * 修前形状：`IntakeService.admit()` 直接 `tx.createObject({kind:'test.claim'})`，而
 * `test.claim` 按 `TEST_OBJECT_MODEL.ownsKinds` 归**对象模型能力**拥有——记录域一直在经
 * 通用事务面跨归属写别人的权威数据（`EVIDENCE.md` D-19c 节有实测：把这里改走自有端口即
 * 12 例报 `CAPABILITY_SCOPE_ESCAPE`）。通用面不受检只是因为它没人查。
 *
 * 修后分工（与复审者的两层写面一致，**不改 kind 归属**）：
 *   · 本文件＝**领域策略**：只回答"能不能写、写成什么载荷、用什么边角色、必填与否"，
 *     产出的是**草稿**（`LedgerEventDraft` / `RefEdgeDraft`），自己一笔都不落；
 *   · `src/app/**`＝**Application Use-case**：在**同一条** SpaceTransaction 内经
 *     **对象拥有者的作用域端口**（`NamespaceWriter.createOwned/linkOwned`）落笔（Q40 原子性）；
 *   · 门禁：`tests/domain-write-face.test.ts` 扫描 `src/domains/**`，出现
 *     `createObject / revise / linkRef / appendLedger / declareRecord` 任一即红。
 *
 * 唯一保留的机制级写面是 `recordReport`（校验报告登记）：它写的是机制的
 * `check_report`/`records`，不创建、不修改任何能力拥有的对象，故不在禁用名单内
 * （理由逐条写在该门禁的注释里，不接受"顺手加的例外"）。
 */
import type { PluginFace, UnitOfWork } from '../kernel/kernel.ts';
import type { PluginManifest } from '../contracts/index.ts';
import { VALIDATOR_ID, synthClaimChecker, type SynthInput } from './test-validation.ts';
import type { Authorizer } from '../kernel/kernel.ts';
import {
  Refusal,
  type CommitSequence, type ObjectKindLabel, type ObjectOid, type AnyRef,
  type RevisionRef, type VerifiedPrincipal,
} from '../contracts/index.ts';
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

/**
 * 领域交给 Application Use-case 的**事件草稿**：事件类型与载荷是领域的话，
 * 落笔（H 追加）是用例的话。草稿里不含任何"由谁执行"的权限信息——那由装配根决定。
 */
export interface LedgerEventDraft {
  readonly eventType: string;
  readonly payload: unknown;
  readonly recordId?: string;
  readonly objectId?: ObjectOid;
  readonly revision?: number;
  /** 与机制侧 `appendLedger.declaresRecord` 同名同义：草稿不得在字段名上悄悄换口径。 */
  readonly declaresRecord?: boolean;
}

/** 领域交给用例的**引用边草稿**（边角色与必填性由领域决定，RF-05/RF-06 的判据住在这里）。 */
export interface RefEdgeDraft {
  readonly from: RevisionRef;
  readonly to: AnyRef;
  readonly role: string;
  readonly required: boolean;
}

/** 接纳判据的产出：要么给出载荷，要么给出拒绝码——**没有第三种"静默不写"**。 */
export type AdmissionDecision
  = { readonly admitted: true; readonly payload: Record<string, unknown> }
  | { readonly refused: 'synth:not-admissible' };

/**
 * 接纳策略（领域侧，**零写权限**）。名字里的 "Policy" 是刻意的：它不再叫 Service，
 * 因为它不再执行任何动作——D-19c 之前它叫 `IntakeService` 并同时握着判据与写面，
 * 于是"跨归属写权威数据"和"判断能不能接纳"住在同一个类里，无从审计。
 */
export class IntakePolicy {
  /**
   * H 记录承载体（对象化路径，RF-06）使用的 kind 标签。
   * **归属不写在这里**：这条 kind 归谁由注册表决定，由用例经拥有者的端口落笔——
   * 换归属（transferRoute / 改清单）时本策略一行都不用动，这是"归属是空间状态"的体现。
   */
  readonly carrierKind: ObjectKindLabel = 'test.subject';

  /** 原始材料登记的领域语义：解析状态是数据字段，不是对象（ID-08：不产生对象）。 */
  rawIntakeEvent(a: { recordId: string; text: string; sourceRef: string; unparseable?: boolean }): LedgerEventDraft {
    return {
      eventType: 'synth:raw-intake',
      recordId: a.recordId,
      declaresRecord: true,
      payload: { text: a.text, sourceRef: a.sourceRef, parseState: a.unparseable ? 'UNPARSEABLE' : 'PARSEABLE' },
    };
  }

  /** 领域接纳判定（#44 §7.2）：不接纳时只给拒绝码，**绝不触碰**已登记的原始输入。 */
  decide(a: { recordId: string; kind: ObjectKindLabel; text: string }): AdmissionDecision {
    if (!PARSEABLE(a.text)) return { refused: 'synth:not-admissible' };
    return { admitted: true, payload: { text: a.text, fromRecord: a.recordId } };
  }

  /** 对象化承载体的载荷（RF-06：承载记录的个体可以当端点，记录本身不行）。 */
  carrierPayload(recordId: string): Record<string, unknown> {
    return { carrier: 'H-RECORD', recordId };
  }

  /** 来源引用边：对象化必须指回原始记录；`required` 由这条路径的语义决定，不是调用方随手给。 */
  derivedFromEdge(oid: ObjectOid, recordId: string, required: boolean): RefEdgeDraft {
    return {
      from: { kind: 'revision-ref', oid, revision: 1 },
      to: { kind: 'record-ref', recordId },
      role: 'synth:derived-from',
      required,
    };
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
    /**
     * 可选：装配根提供的边角色视图。
     * D-15 修复：**缺省不再填 `() => []`**。填空数组等于把"宿主根本没交接线"伪装成
     * "交了的视图里没有这条边"，双正源检查会在报告标 COMPLETE 的情况下静默不执行。
     * 现在缺省即 `undefined`，由校验器产出 INDETERMINATE 负信号。
     */
    private readonly hostEdges?: (oid: ObjectOid) => readonly string[],
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
        environment: env, registeredEdges: this.hostEdges ? this.hostEdges(oid) : undefined,
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
export class FactStandingPolicy {
  /** 只接窄面：领域持有 Kernel 或 port 就等于命名空间隔离对它失效（门禁会红，F-23）。 */
  constructor(private readonly face: PluginFace, private readonly authority?: Authorizer) {}

  /**
   * 事实声明事件的**领域部分**（D-19c：只出草稿，不落笔）。
   * 业务授权轴（`domain-admission`）的判定留在这里——它是业务规则，不是协调权；
   * 用例拿到的是"已判完的话"，它无权把 `AUTHORITY_UNVERIFIED` 改写成 `AUTHORIZED`。
   */
  designationEvent(principal: VerifiedPrincipal, a: { oid: ObjectOid; revision: number; stance: 'ACCEPTED' | 'WITHDRAWN' }): LedgerEventDraft {
    const authorized = this.authority?.can(principal.actorId, 'domain-admission', this.face.space) ?? false;
    return {
      eventType: 'synth:fact-designation',
      objectId: a.oid, revision: a.revision,
      payload: { stance: a.stance, by: principal.actorId, note: authorized ? 'AUTHORIZED' : 'AUTHORITY_UNVERIFIED' },
    };
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
