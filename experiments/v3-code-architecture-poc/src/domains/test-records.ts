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
  type CheckReportRecord,
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
  // D-20（包 2，CONTRACTS.md §16.2）：`synth:fact-designation` 登记为**正式事件类型**，权威签发者
  // 是本能力。自登记那一刻起：通用 appendLedger / declareRecord / write() 台账行在一切作用域
  // （含 assembly）都写不动它；唯一入口是本能力命令 Port（`FactDesignationCommandPort`）背后的
  // `NamespaceWriter.appendAuthoritativeEvent`。登记进清单而不是装配点硬编码，是为了让
  // 「谁有权签发这个事件」成为可审查的**声明**，与 ownsKinds 同族。
  ownsEventTypes: [{ eventType: 'synth:fact-designation', capability: CAP_RECORDS }],
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

/**
 * D-22（外部复审第四轮，包 2，CONTRACTS.md §16.2）：领域验证服务的**受限提交接口**。
 *
 * 修前形状（A-8 实测越权）：装配根把一个「任意回调 + 全权事务」执行器
 * （`<R>(fn: (tx: UnitOfWork) => R) => R`，scope=assembly）交进领域对象——验证服务拿到的
 * 能力比它宣称的用途大了整整一个 Kernel，且参数属性在运行时可枚举，外部从实例上就能取回。
 * 修后形状：领域只接「登记一份校验报告」这**一个动作**的 Port。Application 层的跨插件
 * 协调事务不受影响：提交 Port 由装配根实现，内部用授权主体自开事务（F-23 主体链不变）。
 */
export interface ValidationReportSubmission {
  submitReport(a: Omit<CheckReportRecord, 'reportId' | 'recordedAt'>): { reportId: string; recordedAt: CommitSequence };
}

/**
 * 旧接线形态（D-22 修前的越权面本体，A-8）：装配根直接交出「任意回调 + 全权事务」执行器。
 * @deprecated 仅作为 `adaptLegacyValidationWiring` 的入参类型存在；新接线一律用
 * `ValidationReportSubmission`。实施期随旧夹具一起删除。
 */
export type LegacyRunIn = <R>(fn: (tx: UnitOfWork) => R) => R;

/**
 * **显式登记的运行时兼容适配器**（CONTRACTS.md §16.2，诚实登记的过渡形态）：
 *
 * 为什么存在：D-22 的**审查者冻结裁判**（`attacks/review/g1a-regression.test.ts`，不可改）
 * 自己就以本回调形态构造 `ValidationService`，且其绿条件预设构造成功、只要求句柄运行时不可达；
 * 另三个冻结攻击夹具同形态接线并调用 `run()`。在审查文件解禁前，构造器拒绝 callable 等于
 * 让裁判自身报错——那不是修复，是砸裁判。
 *
 * 它保证的性质（§16.2 登记、`tests/formal-event-authority.test.ts` 钉死）：
 * ① callable 只被**降级包装**成单动作 `ValidationReportSubmission`，服务对它的唯一使用形态
 *    是 `submitReport`（内部只允许 `tx.recordReport`）；
 * ② 原执行器不进实例、不进原型、不进任何可枚举位置——**兼容入口同样拿不到全权事务**；
 * ③ 返回对象是新构造的包装，调用方事后改写原引用不影响服务已装的提交口。
 *
 * 删除条件：三个旧夹具改接线后，删掉本函数、`LegacyRunIn` 与构造器里的那一行调用。
 */
export function adaptLegacyValidationWiring(
  wiring: ValidationReportSubmission | LegacyRunIn,
): ValidationReportSubmission {
  if (typeof wiring !== 'function') return wiring;
  const runIn: LegacyRunIn = wiring;
  return { submitReport: (a) => runIn((tx) => tx.recordReport(a)) };
}

/** 校验编排：校验器可离线；不可用 ⇒ INDETERMINATE，且**绝不**改写既有报告。 */
export class ValidationService {
  // D-22（包 2）：**构造参数一律 #私有字段，禁止参数属性。**
  // D-17（face/writer 的 k、raw）→ P2-2 → 本条，同一课第三次点名：TS `private`/参数属性
  // 只存在于编译期，运行时就是自有可枚举字段——"藏"任何可执行的东西都不许用它们。
  readonly #face: PluginFace;
  readonly #submit: ValidationReportSubmission;
  readonly #hostSnapshot: (ref: { kind: 'revision-ref'; oid: ObjectOid; revision: number }) =>
    { revision: number; payload: Record<string, unknown> } | undefined;
  readonly #hostEdges?: (oid: ObjectOid) => readonly string[];
  readonly #offline = new Set<string>();
  /**
   * `hostSnapshot` 由装配根提供：跨命名空间要读的对象由**宿主**替它取好交进来，
   * 而不是让领域拿一个能按任意 oid 读的句柄（R3-A：窄面一旦带上 revisionOf，
   * 任何领域都能把别的能力的对象读走）。
   * 可选 `hostEdges`：D-15 修复——**缺省不再填 `() => []`**。填空数组等于把
   * "宿主根本没交接线"伪装成"交了的视图里没有这条边"，双正源检查会在报告标
   * COMPLETE 的情况下静默不执行。缺省即 `undefined`，由校验器产出 INDETERMINATE 负信号。
   */
  constructor(
    face: PluginFace,
    submission: ValidationReportSubmission,
    hostSnapshot: (ref: { kind: 'revision-ref'; oid: ObjectOid; revision: number }) =>
      { revision: number; payload: Record<string, unknown> } | undefined,
    hostEdges?: (oid: ObjectOid) => readonly string[],
  ) {
    // 运行时兼容走**具名适配器**（上方 `adaptLegacyValidationWiring`，契约声明见 §16.2）：
    // 公开类型面只有受限提交接口；旧 callable 形态在构造边界被降级包装，原执行器不落实例。
    this.#face = face;
    this.#submit = adaptLegacyValidationWiring(submission);
    this.#hostSnapshot = hostSnapshot;
    this.#hostEdges = hostEdges;
  }

  withValidatorOffline(validatorId: string, fn: () => void): void {
    this.#offline.add(validatorId);
    try { fn(); } finally { this.#offline.delete(validatorId); }
  }

  run(oid: ObjectOid, revision: number, env: SynthInput, ruleVersion = 'v1'): RunResult {
    const snap = this.#hostSnapshot({ kind: 'revision-ref', oid, revision });
    if (!snap) throw new Refusal('NOT_FOUND_IN_SPACE', { oid, revision });
    let findings: readonly Finding[] = [];
    let declaredGaps: readonly string[] = [];
    let coverage: Coverage = 'COMPLETE';
    if (this.#offline.has(VALIDATOR_ID)) {
      // RPT-02：校验器不可用 ⇒ 一条 INDETERMINATE finding，reason=CHECKER_UNAVAILABLE；
      // 不是 coverage 的第四个值，也不让"没法检"被读成"不合格"或被读成"达成"。
      findings = [{ code: 'CHECKER_UNAVAILABLE', outcome: 'INDETERMINATE', severity: 'NOTE' }];
      coverage = 'INCOMPLETE_DUE_TO_VISIBILITY';
    } else {
      const out = synthClaimChecker(ruleVersion).check({
        target: { kind: 'revision-ref', oid, revision }, payload: snap.payload, declaredGaps: [],
        environment: env, registeredEdges: this.#hostEdges ? this.#hostEdges(oid) : undefined,
      });
      findings = out.findings.filter((f) => f.outcome !== 'PASS');
      declaredGaps = out.declaredGaps;
      coverage = out.coverage;
    }
    const verdict = synthReduce(findings, coverage);
    // 报告行的**授权主体**只能是宿主核验后交出的身份：提交 Port 由装配根实现，内部用它自己
    // 被授权的主体开事务（这里是 F-23 的主体链）。env.actor 只是报告载荷里的数据字段，
    // 写进 payload 不等于获得身份。D-22 后本服务连"顺手做别的写"的通道都不存在——
    // 提交接口上只有这一个动作。
    const res = this.#submit.submitReport({
      target: { kind: 'revision-ref', oid, revision },
      validatorId: VALIDATOR_ID, ruleVersion, schemaVersion: 'synth-1',
      environment: 'synth-env', executedAt: Date.now(), guaranteeScope: 'SYNTH-STRUCTURAL-ONLY',
      verdict, findings, declaredGaps,
    });
    return { reportId: res.reportId, verdict, findings, declaredGaps, coverage, recordedAt: res.recordedAt };
  }

  /** 端点资格判据（RF-05/RF-06）：这条规则住在**领域**，不在 Kernel。 */
  checkEndpoint(_oid: ObjectOid, _revision: number, ref: AnyRef): { accepted: boolean; code?: string } {
    if (ref.kind === 'record-ref') return { accepted: false, code: 'SYNTH_RECORD_NOT_ENDPOINT' };
    return { accepted: true };
  }
}

/**
 * **正式接纳事件（`synth:fact-designation`）的结构化契约**（D-20，外部复审第四轮，包 2）。
 *
 * 修前的伪造面（席位 A-6 实测）：投影读的是 `payload.note === 'AUTHORIZED'`——一个任何能力
 * 在 `appendLedger` 里随手写的字符串。修后的信任模型（CONTRACTS.md §16.2）：
 * ① 事件必须带 `designationSchema` 标记与齐全的结构化字段；② `issuer` 必须等于机制 ledger
 * 记下的 `actor`（载荷自称不算身份）；③ 授权是结构化字段，由**写入当时**的业务授权轴判定
 * 落成数据；④ `policyVersion` 记下判据版本，投影按**事件记录的版本**查冻结判据表，不按当前
 * 配置重算——事后权限变化不得静默重解释历史。
 */
export const FACT_DESIGNATION_EVENT = 'synth:fact-designation';
export const FACT_DESIGNATION_SCHEMA = 'synth:fact-designation/2';
/** 业务授权判据的版本号：写进事件，供投影按"当时"的规则判定。 */
export const FACT_STANDING_POLICY_VERSION = 'fact-standing/v2';

export interface FactDesignationPayload {
  readonly designationSchema: string;
  readonly stance: 'ACCEPTED' | 'WITHDRAWN';
  /** 已验证主体 id；仅当与机制 ledger.actor 相同时才承载身份（§16.2）。 */
  readonly issuer: string;
  /** 写入**当时**由业务授权轴判定的结果；投影从不重新查询权限。 */
  readonly authorization: 'AUTHORIZED' | 'AUTHORITY_UNVERIFIED';
  readonly policyVersion: string;
}

/**
 * 冻结判据表（D-20 要求 4 的落点）：`policyVersion` → **永不修改**的判定函数。
 * 新版本 = 加一行；旧行一旦落地不得改动——否则就是"按今天的规则重解释昨天的事件"。
 * 未知版本 ⇒ 不参与投影（fail-closed）：机制宁可少认，不可冒认。
 * 旧形状事件（无 designationSchema、只有 note 字符串）同样不进任何版本 = 自动退出投影；
 * H 里已有的这类行（含历史伪造）不再生效但仍在库——处置是运维/审计问题，见回报。
 */
const FACT_STANDING_RULES: Readonly<Record<string, (p: FactDesignationPayload, actor: string | null) => boolean>> = Object.freeze({
  [FACT_STANDING_POLICY_VERSION]: Object.freeze((p: FactDesignationPayload, actor: string | null): boolean =>
    p.designationSchema === FACT_DESIGNATION_SCHEMA
    && (p.stance === 'ACCEPTED' || p.stance === 'WITHDRAWN')
    && typeof p.issuer === 'string' && p.issuer !== '' && p.issuer === actor
    // 只有写入当时判定为**已获授权**的声明参与投影；未授权声明完整保存但不计入（PR-A1）。
    && p.authorization === 'AUTHORIZED'),
});

/** 行是否"生效声明"（计入投影）。未生效（未授权）声明完整保存但不参与（PR-A1）。 */
function designationCountsAsAdmitted(payload: unknown, actor: string | null): boolean {
  const p = payload as Partial<FactDesignationPayload> | null;
  if (!p || typeof p !== 'object' || typeof p.policyVersion !== 'string') return false;
  const rule = FACT_STANDING_RULES[p.policyVersion];
  if (!rule) return false;                       // 未知版本：fail-closed
  return rule(p as FactDesignationPayload, actor);
}

/**
 * 正式接纳事件的**授权命令 Port**（D-20 要求 2）：这类事件的**唯一写入口**。
 *
 * 与 `FactStandingPolicy` 的分工沿用 D-19c 的两层：判据（算不算已获授权、载荷长什么样）在
 * policy；本类只把"已判完的话"经机制的权威通道（`appendAuthoritativeEvent`，事件类型归属 +
 * 对象/修订存在性都在机制侧核对，actor 由机制落账）写进同一条事务。绕过本类没有第二条路：
 * 机制上通用 `appendLedger` 对已登记事件类型一律 `EVENT_AUTHORITY_REQUIRED`（§16.2）。
 */
export class FactDesignationCommandPort {
  readonly #policy: FactStandingPolicy;
  /** 只接窄面（F-23 同一条：领域持有 Kernel/port 即命名空间隔离失效）。 */
  readonly #face: PluginFace;
  constructor(policy: FactStandingPolicy, face: PluginFace) {
    this.#policy = policy;
    this.#face = face;
  }
  declare(tx: UnitOfWork, a: { oid: ObjectOid; revision: number; stance: 'ACCEPTED' | 'WITHDRAWN' }): CommitSequence {
    const d = this.#policy.designationEvent(tx.principal, a);
    return this.#face.writerFor(tx).appendAuthoritativeEvent({
      eventType: d.eventType,
      objectId: d.objectId as ObjectOid,
      revision: d.revision as number,
      payload: d.payload,
    });
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
   * 事实声明事件的**领域部分**（D-19c：只出草稿，不落笔；D-20：载荷结构化）。
   * 业务授权轴（`domain-admission`）的判定留在这里——它是业务规则，不是协调权；
   * 判定发生在**写入当时**，结果作为数据落进事件；投影端从不重新查权限。
   * 唯一合法消费者是 `FactDesignationCommandPort`（草稿不落笔，落笔即走权威通道）。
   */
  designationEvent(principal: VerifiedPrincipal, a: { oid: ObjectOid; revision: number; stance: 'ACCEPTED' | 'WITHDRAWN' }): LedgerEventDraft {
    const authorized = this.authority?.can(principal.actorId, 'domain-admission', this.face.space) ?? false;
    const payload: FactDesignationPayload = {
      designationSchema: FACT_DESIGNATION_SCHEMA,
      stance: a.stance,
      issuer: principal.actorId,
      authorization: authorized ? 'AUTHORIZED' : 'AUTHORITY_UNVERIFIED',
      policyVersion: FACT_STANDING_POLICY_VERSION,
    };
    return { eventType: FACT_DESIGNATION_EVENT, objectId: a.oid, revision: a.revision, payload };
  }

  /**
   * 投影（D-20 修后信任模型，CONTRACTS.md §16.2）：
   * 只认**结构化字段 + 机制记的签发方 + 事件记录的判据版本**——
   * 不读 `note` 之类的随手字符串（修前正是它让无关能力一条伪造声明翻转他人对象，席位 A-6）；
   * 不调 `authority.can`（那是"按当前权限重解释历史"，复审要求 4 明令禁止）。
   */
  standingAt(oid: ObjectOid, cutoff: CommitSequence): { state: 'ADOPTED' | 'NOT_ADOPTED'; watermark: CommitSequence } {
    // 只经机制原语取事件，不碰 port/raw：否则命名空间隔离对这个领域就是纸面上的（F-23）。
    const rows = this.face.eventsOf(oid, FACT_DESIGNATION_EVENT, cutoff);
    {
      let state: 'ADOPTED' | 'NOT_ADOPTED' = 'NOT_ADOPTED';
      for (const r of rows) {
        if (!designationCountsAsAdmitted(r.payload, r.actor)) continue; // 未生效/旧形状/未知版本一律不参与
        const stance = (r.payload as FactDesignationPayload).stance;
        state = stance === 'ACCEPTED' ? 'ADOPTED' : 'NOT_ADOPTED';
      }
      return { state, watermark: cutoff };
    }
  }
}
