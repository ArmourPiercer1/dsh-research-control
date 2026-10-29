/**
 * 校验能力的契约（领域侧，不在机制契约里）：逐项判定、覆盖度与 Finding 的取值是
 * 检查报告的语义，属 S/R 侧领域词汇；Kernel 只见不透明载荷（#44 §9.2、RPT-04）。
 * 位置本身就是"业务无知"停线的一处体现。
 */
import type { ObjectKindLabel, RecordRef, RevisionRef } from '../contracts/index.ts';

export interface ValidationContribution {
  readonly validatorId: string;
  readonly ruleVersion: string;
  readonly schemaVersion: string;
  /** 返回报告**载荷**；Kernel 不解释 verdict 的科学含义。 */
  check(input: ValidationInput): ValidationOutcome;
}
export interface ValidationInput {
  readonly target: RevisionRef | RecordRef;
  /** 被检对象的声明内容（校验器只查声明形态，不判科研语义，RPT-07）。 */
  readonly payload: unknown;
  readonly declaredGaps: readonly string[];
  readonly environment: unknown;
}
/**
 * 逐项判定。verdict **不由本类型承载**：一份报告可以同时含 FAIL 与 INDETERMINATE 项，
 * 归约是领域规则（RPT-02/RD-38：FAIL 优先），若在这里用联合类型把"整份不可判定"与
 * "某项不可判定"混为一谈，XC-27 就无法表达。
 */
export type CheckOutcome = 'PASS' | 'FAIL' | 'INDETERMINATE' | 'NOT_APPLICABLE';
/**
 * RPT-03 的**封闭三值**。曾经的第四值 'CHECK_UNAVAILABLE' 已删除（复审 S-1，P1）：
 * "校验器不可用"是 INDETERMINATE 的**理由**（RPT-02 的 reason=CHECKER_UNAVAILABLE），
 * 把它塞进 coverage 轴等于让 coverage 参与 verdict——那是 RPT-02 明文禁止的。
 */
export type Coverage = 'COMPLETE' | 'INCOMPLETE_DUE_TO_VISIBILITY' | 'NOT_DISCLOSED';
export interface ValidationOutcome {
  readonly findings: readonly Finding[];
  readonly declaredGaps: readonly string[];
  readonly coverage: Coverage;
}
export interface Finding {
  readonly code: string;
  readonly outcome: CheckOutcome;
  readonly severity: 'VIOLATION' | 'DEFICIENCY' | 'NOTE';
  readonly fieldPath?: string;
  readonly detail?: Readonly<Record<string, unknown>>;
}

/** Facet 贡献：独立拥有扩展记录，禁止复制核心权威（#44 §6.2 / Q45、XC-28）。 */
export interface FacetContribution {
  readonly facetId: string;
  readonly mountKind: ObjectKindLabel;
  readonly recordVersion: string;
}

// ---------------------------------------------------------------- 检查报告

/** CheckReport 由 Kernel 提供**通用持久化通道**；内容归领域（#44 §9.2 / C11）。 */
