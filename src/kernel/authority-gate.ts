/**
 * EA-4.5 全形闸 + EA-4.6 审计复算（**判据函数，不含事件名清单**）。
 *
 * 为什么单独成文件：EA-4.5 的 R-2 修订段要求「闸内不写任何事件名清单」——三支划分只能依赖
 * 三个既有正源（分类器 / 机制轴集 / 名册登记的机制轴）。把这三样做成**注入参数**，本文件就
 * 结构上不可能藏一份白名单；`tests/kernel-event-authority.test.ts` 里有对应断言
 * （源码不得出现机制事件名字面量）。
 *
 * 存储层触发器与本模块是**同一判据的两种执行面**：触发器给中止消息文本（存储层信号，不进
 * `RefusalCode` 封闭集），本模块返回可核的裁决与理由。二者不可互相替代：触发器挡写入，
 * 本模块供审计复算与测试对拍。
 */
import type { AuthorizationContext, CapabilityId } from '../contracts';

/** 一行台账的见证面（读面最小投影）。 */
export interface WitnessRow {
  readonly seq: number;
  readonly eventType: string;
  readonly actor: string | null;
  /** `authority_basis` 列解析后的值（旧行可能是三字段 `AuthorityEvidence`，也可能是 `null`）。 */
  readonly envelope: unknown;
}

/**
 * 把一行存储记录装成见证视图（**构造点**）。放在本模块而不是 Kernel，是因为对账脚本把
 * "`eventType:` 属性赋值"视为一个事件名写点；见证视图不是写点，不应在 Kernel 里长成写点形状。
 */
export function witnessRowOf(seq: number, eventType: string, actor: string | null, envelope: unknown): WitnessRow {
  return { seq, eventType, actor, envelope };
}

/** 三支判据依赖的三个既有正源（**注入**，不由本模块持有名单）。 */
export interface GateSources {
  /** EA-1.2 分类器：'domain' | 'mechanism'；未知返回 'unknown'（fail-closed）。 */
  classify(eventType: string): 'domain' | 'mechanism' | 'unknown';
  /** 名册上该名字登记的机制轴（锚文件条目）。未登记返回 undefined。 */
  registeredMechanismAxis(eventType: string): string | undefined;
  /** 机制轴集（`MECHANISM_RESOURCES`，D-26 的既有方向）。 */
  readonly mechanismResources: ReadonlySet<string>;
  /** 归属账在**行自己钉住的 contractVersion** 下的 owner（禁止按当前账本回算，C-18）。 */
  ownerAt(eventType: string, contractVersion: string): CapabilityId | undefined;
  /** 冻结判据表里可解析的版本集合（规则集版本 ∪ 契约版本）。 */
  readonly frozenVersions: ReadonlySet<string>;
}

export type GateVerdict =
  | { readonly ok: true; readonly branch: 'domain' | 'route-audit' | 'mechanism-op' }
  | { readonly ok: false; readonly reason: string };

const ENVELOPE_FIELDS = [
  'ctxId', 'actor', 'capability', 'axis', 'authorized',
  'ruleSetVersion', 'contractVersion', 'issuedAtMs', 'txSeq',
] as const;

/** 九字段齐 + 类型对。**形状不全会返回 null**——半形必须红（夹具 MUT-1 的对应物）。 */
export function parseAuthorizationContext(raw: unknown): AuthorizationContext | null {
  if (raw === null || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  for (const f of ENVELOPE_FIELDS) if (!(f in o)) return null;
  if (Object.keys(o).length !== ENVELOPE_FIELDS.length) return null;
  if (typeof o.ctxId !== 'string' || o.ctxId.trim() === '') return null;
  if (typeof o.actor !== 'string' || o.actor.trim() === '') return null;
  if (typeof o.capability !== 'string' || o.capability.trim() === '') return null;
  if (typeof o.axis !== 'string' || o.axis.trim() === '') return null;
  if (typeof o.authorized !== 'boolean') return null;
  if (typeof o.ruleSetVersion !== 'string' || o.ruleSetVersion.trim() === '') return null;
  if (typeof o.contractVersion !== 'string' || o.contractVersion.trim() === '') return null;
  if (typeof o.issuedAtMs !== 'number' || !Number.isFinite(o.issuedAtMs)) return null;
  if (typeof o.txSeq !== 'number' || !Number.isFinite(o.txSeq)) return null;
  return o as unknown as AuthorizationContext;
}

/**
 * 「一切消费见证的闸门」的机验全形（EA-4.5）：
 *   actor ≠ NULL ∧ 信封全形 ∧ envelope.actor = row.actor ∧ 轴判据三分。
 */
export function gateFullShape(row: WitnessRow, src: GateSources): GateVerdict {
  if (row.actor === null || row.actor === undefined) return { ok: false, reason: 'actor-null' };
  const env = parseAuthorizationContext(row.envelope);
  if (!env) return { ok: false, reason: 'envelope-not-full-shape' };
  // 同源一致性（F-G6A-2 的修法转正）：两个字段互相印证只是「过程完整性的事后校验位」，
  // 证明力来自单点生成（EA-4.1），不是这条等式。
  if (env.actor !== row.actor) return { ok: false, reason: 'actor-source-mismatch' };
  if (env.txSeq !== row.seq) return { ok: false, reason: 'tx-seq-mismatch' };

  const cls = src.classify(row.eventType);
  if (cls === 'unknown') return { ok: false, reason: 'unclassified-event-type' };

  if (cls === 'domain') {
    if (src.mechanismResources.has(env.axis)) return { ok: false, reason: 'domain-axis-in-mechanism-set' };
    const owner = src.ownerAt(row.eventType, env.contractVersion);
    if (owner === undefined || owner !== env.capability) return { ok: false, reason: 'capability-owner-mismatch' };
    return { ok: true, branch: 'domain' };
  }

  // 机制类：② 是 ③ 的特例（'capability-admin' 本身在机制轴集内），单列只为把既成形态钉成
  // 可读的历史支；两支都要求 authorized = 1，不产生第二真源。
  if (!src.mechanismResources.has(env.axis)) return { ok: false, reason: 'mechanism-axis-outside-set' };
  if (env.authorized !== true) return { ok: false, reason: 'mechanism-not-authorized' };
  if (env.axis === 'capability-admin') return { ok: true, branch: 'route-audit' };
  const registered = src.registeredMechanismAxis(row.eventType);
  if (registered === undefined || registered !== env.axis) return { ok: false, reason: 'mechanism-axis-not-registered-for-name' };
  return { ok: true, branch: 'mechanism-op' };
}

export type ReplayVerdict = 'VERIFIED' | 'INCONSISTENT' | 'UNVERIFIABLE_LEGACY';

/**
 * EA-4.6 审计侧复算：**只**证明「该行系经单点取证入口、在同一授权上下文一致生成，且其声称
 * 的规则/契约版本在冻结表内可解析重放」。**不**证明宿主主体真实性，也**不**证明裸面未被改写。
 * 无信封的历史行 ⇒ `UNVERIFIABLE_LEGACY`（按当时语义可回放，但不产出「当时有权」的断言）；
 * 这**不是**失败，也**不得**被当成 VERIFIED——两者混淆就是把「未知」说成「有权」。
 */
export function replayAuthorityEvidence(row: WitnessRow, src: GateSources): ReplayVerdict {
  if (row.envelope === null || row.envelope === undefined) return 'UNVERIFIABLE_LEGACY';
  const env = parseAuthorizationContext(row.envelope);
  if (!env) return 'INCONSISTENT'; // 有信封但半形 = 不一致，不是「旧行」
  if (!gateFullShape(row, src).ok) return 'INCONSISTENT';
  if (!src.frozenVersions.has(env.ruleSetVersion)) return 'INCONSISTENT';
  if (!src.frozenVersions.has(env.contractVersion)) return 'INCONSISTENT';
  return 'VERIFIED';
}

/**
 * EA-7.4 非 oracle：机制审计事件（`integrity-audit-recorded` / `read-shadow-recorded`）的
 * **调用方回声**里不得出现任何 `hiddenBy*` 键。
 *
 * 理由不是「少暴露一点好看」：这两个事件的语义是「有东西被隐藏了/被影子读了」。若调用方
 * 能从返回值里读出「被隐藏的是什么」，那么本该只对审计可见的事实就通过回声漏给了发起者——
 * 审计事件退化成「查询接口」，影子读变成读前置探测。判据必须落在**返回值**这一侧，
 * 而不是「我们打算不返回它」的意图上。
 */
export const NON_ORACLE_FORBIDDEN_KEY_PREFIX = 'hiddenBy';

export interface NonOracleViolation {
  readonly path: string;
  readonly key: string;
}

/**
 * 递归找出回声里所有以 `hiddenBy` 开头的键（含嵌套对象与数组元素），返回违规清单。
 * 空数组 = 合规。不抛异常：调用方自行决定是把违规当拒绝还是当噪声记日志。
 */
export function findNonOracleViolations(echo: unknown, path = '$'): readonly NonOracleViolation[] {
  const out: NonOracleViolation[] = [];
  const walk = (v: unknown, p: string, depth: number): void => {
    if (depth > 32 || v === null || typeof v !== 'object') return;
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${p}[${i}]`, depth + 1)); return; }
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (k.startsWith(NON_ORACLE_FORBIDDEN_KEY_PREFIX)) out.push({ path: `${p}.${k}`, key: k });
      walk(x, `${p}.${k}`, depth + 1);
    }
  };
  walk(echo, path, 0);
  return out;
}
