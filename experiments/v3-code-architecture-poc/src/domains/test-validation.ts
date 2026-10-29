/**
 * **合成校验插件（测试专用）**：只提供"形状"合法的 S/R 侧规则，用来验证机制能否承载
 * 版本化校验器、UNKNOWN 合法、不可用降级与归约唯一性。
 *
 * ⚠️ 这里的判据是**合成占位规则**，不是 PR #42 的科研语义政策；不得被引用为 S-L1/R-L1 的实现。
 * 归约顺序镜像 RPT-02/RD-38 的**结构**（FAIL 优先于 INDETERMINATE），因为那正是本 PoC 要验的
 * "机制能否表达这条契约规则"，而不是声称已实现该契约的科研含义。
 */
import type { PluginManifest, Coverage, ValidationContribution, ValidationInput, ValidationOutcome, Finding } from '../contracts/index.ts';

export const CAP_VALIDATION = 'cap.test.validation';
export const VALIDATOR_ID = 'synth.claim-checker';

export const TEST_VALIDATION: PluginManifest = {
  pluginId: 'test.validation',
  codeVersion: '0.0.1',
  provides: [{ capability: CAP_VALIDATION, contractVersion: 'v1' }],
  requires: [],
  storageNamespace: 'dom_test_val',
  eventAuthority: 'none',
};

type FieldState = 'DECLARED' | 'UNKNOWN' | 'NOT_APPLICABLE' | 'UNRESOLVED' | 'ABSENT' | 'UNDECLARED';
export interface SynthInput { readonly actor: string; readonly optionalField?: { readonly st: FieldState; readonly withheld?: boolean } }

/** 合成规则本体：只看"声明形态"，不判任何科研语义（RPT-07 的形状）。 */
export const synthClaimChecker = (ruleVersion: string): ValidationContribution => ({
  validatorId: VALIDATOR_ID,
  ruleVersion,
  schemaVersion: 'synth-1',
  check(input: ValidationInput): ValidationOutcome {
    const payload = input.payload as { text?: string };
    const env = input.environment as unknown as SynthInput;
    const findings: Finding[] = [];
    const declaredGaps: string[] = [];
    let coverage: Coverage = 'COMPLETE';

    if (typeof payload.text !== 'string' || payload.text.includes('缺必填字段')) {
      findings.push({ code: 'SYNTH_MISSING_REQUIRED', outcome: 'FAIL', severity: 'DEFICIENCY', fieldPath: 'text' });
    }
    const f = env.optionalField;
    if (f) {
      switch (f.st) {
        case 'UNKNOWN': case 'ABSENT':
          // 允许未知的字段如实声明未知 ⇒ PASS 并记入 declared_gaps（RPT-05、RD-25）
          declaredGaps.push('optionalField');
          break;
        case 'NOT_APPLICABLE':
          break;
        case 'UNRESOLVED':
          if (f.withheld) {
            // 被屏蔽的引用只能不可判定，禁止记 FAIL/PASS/NOT_APPLICABLE（RPT-03、SP-08）
            findings.push({ code: 'SYNTH_WITHHELD_REFERENCE', outcome: 'INDETERMINATE', severity: 'NOTE', fieldPath: 'optionalField' });
            coverage = 'INCOMPLETE_DUE_TO_VISIBILITY';
          } else {
            findings.push({ code: 'SYNTH_REF_UNRESOLVED', outcome: 'FAIL', severity: 'DEFICIENCY', fieldPath: 'optionalField' });
          }
          break;
        case 'UNDECLARED':
          // 连状态都没声明是违规（RPT-08 第三分支）
          findings.push({ code: 'SYNTH_STATE_UNDECLARED', outcome: 'FAIL', severity: 'VIOLATION', fieldPath: 'optionalField' });
          break;
        default:
          break;
      }
    }
    return { findings, declaredGaps, coverage };
  },
});
