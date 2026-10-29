/**
 * 语义组合攻击（独立审查员）— S-1：RPT-02 归约契约 vs 本 PoC 自称"唯一字面对齐"的实现
 *
 * 被违反的契约（.scratch/p42/docs/architecture/H_S_R_NORMALIZATION_CONTRACT_DRAFT.md）：
 *  - RPT-02：NOT_ACHIEVED⟸任一 FAIL（最高优先）；否则任一 INDETERMINATE→INDETERMINATE；
 *    否则全 PASS/合法 NOT_APPLICABLE→ACHIEVED。且明文：
 *    「coverage 与 declared_gaps[] 是独立字段，**不参与归约、不改变 verdict**」。
 *  - RPT-02 逐项判定表：校验器不可用 ∈ INDETERMINATE 的**理由**（reason = CHECKER_UNAVAILABLE），
 *    即它应体现为一条 INDETERMINATE finding，而不是 coverage 值。
 *  - RPT-03：报告携带 coverage ∈ {COMPLETE, INCOMPLETE_DUE_TO_VISIBILITY, NOT_DISCLOSED}（封闭三值）。
 *
 * 现状（缺陷）：
 *  1. `synthReduce(findings, coverage)` 的第三分支直接消费 coverage：
 *     `coverage === 'CHECK_UNAVAILABLE' ? 'INDETERMINATE' : 'ACHIEVED'`
 *     ——同一 findings 集合，verdict 随 coverage 改变 ⇒ coverage 参与了归约并改变了 verdict。
 *  2. `Coverage` 类型发明了 RPT-03 封闭集之外的第四值 'CHECK_UNAVAILABLE'，
 *     把"校验器不可用"这个本属 INDETERMINATE 理由的语义塞进了 coverage 轴。
 *  3. 校验器离线时 findings=[]（p3-unavailable 还把 `findings toEqual([])` 写成期望），
 *     与 RPT-02 结果表要求的 INDETERMINATE(reason=CHECKER_UNAVAILABLE) 项相悖。
 *  4. test-records.ts 文件头自称「唯一与契约字面对齐的是**归约顺序**」——第三分支证明连这条都不成立。
 *     CONTRACTS.md §7「归约 FAIL > INDETERMINATE > ACHIEVED 在领域实现 [实测]」「coverage 独立呈现 [实测]」
 *     的 [实测] 只覆盖了混合例（FAIL+INDETERMINATE），未覆盖（也确实不成立于）CHECK_UNAVAILABLE 例。
 *
 * 本文件断言的是**当前（偏离的）行为**——今天通过，修复后应变红并按 RPT-02 形态改写：
 * 最小修复（纯领域侧，不动 Kernel）：
 *  ① 校验器不可用 ⇒ 产出 finding {code:'SYNTH_CHECKER_UNAVAILABLE', outcome:'INDETERMINATE', severity:'NOTE'}；
 *  ② synthReduce 只消费 findings（第三分支改为无条件 ACHIEVED），coverage 保持独立字段；
 *  ③ Coverage 回到 RPT-03 三值（'CHECK_UNAVAILABLE' 移出类型，或明确标注为合成扩展且永不参与归约）；
 *  ④ 修正 test-records.ts 文件头与 CONTRACTS.md §7 的两处 [实测] 措辞；p3-unavailable 断言
 *     改为"一条 INDETERMINATE finding + verdict INDETERMINATE + coverage 独立"。
 * 回归测试：本文件即攻击证据（修复后 ①② 两处断言反转）。
 */
import { describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../../src/harness/paths.ts';
import { openWorld, PRINCIPAL } from '../../src/harness/world.ts';
import { ValidationService, synthReduce } from '../../src/domains/test-records.ts';
import { VALIDATOR_ID } from '../../src/domains/test-validation.ts';
import { CAP_RECORDS } from '../../src/domains/test-records.ts';
import type { Coverage } from '../../src/domains/validation-contract.ts';

const ALICE = PRINCIPAL('alice');

/** 编译期探针：四个值当前都可通过 Coverage 类型检查（第四值存在）。修复 ③ 后本文件编译即红。 */
const coverageMembers: Coverage[] = ['COMPLETE', 'INCOMPLETE_DUE_TO_VISIBILITY', 'NOT_DISCLOSED', 'CHECK_UNAVAILABLE'];

describe('S-1 RPT-02：coverage 参与归约 + 第四 coverage 值', () => {
  test('同一 findings 集合，verdict 随 coverage 改变 ⇒ coverage 参与了归约', () => {
    // findings 完全相同（空集），仅 coverage 不同：
    expect(synthReduce([], 'CHECK_UNAVAILABLE')).toBe('INDETERMINATE');
    expect(synthReduce([], 'COMPLETE')).toBe('ACHIEVED');
    // RPT-02：「coverage 与 declared_gaps[] 是独立字段，不参与归约、不改变 verdict」
    // ⇒ 上面两行若同时成立，即证明归约消费了 coverage。
    expect(synthReduce([], 'CHECK_UNAVAILABLE')).not.toBe(synthReduce([], 'COMPLETE'));
  });

  test('Coverage 含 RPT-03 封闭集之外的第四值 CHECK_UNAVAILABLE', () => {
    expect(coverageMembers).toHaveLength(4);
    expect(coverageMembers).toContain('CHECK_UNAVAILABLE');
  });

  test('世界级复现：校验器离线 ⇒ findings=[] 且 verdict 由 coverage 分支决定', () => {
    const dir = mkdtempSync(join(POC_DATA_DIR, 'sem-reduce-'));
    const w = openWorld({ file: join(dir, 'attack.db'), space: 'SP-SEM-1', grants: { alice: ['space-write'] } });
    try {
      // 夹具装配同步（F-23 之后领域只接窄面 + 装配根事务执行器）；断言未动。
      const validation = new ValidationService(w.kernel.faceFor(CAP_RECORDS), (fn) => w.uow(ALICE, fn), (ref) => w.kernel.readRevision(ref));
      const oid = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { text: 'x' } }));

      validation.withValidatorOffline(VALIDATOR_ID, () => {
        const rep = validation.run(oid, 1, { actor: 'alice' });
        // 当前（偏离）形态：零 finding，verdict 由 coverage==='CHECK_UNAVAILABLE' 分支给出。
        expect(rep.findings).toEqual([]);
        expect(rep.coverage).toBe('CHECK_UNAVAILABLE');
        expect(rep.verdict).toBe('INDETERMINATE');
        // 归约确实走了 coverage 分支（而非 findings）：
        expect(synthReduce(rep.findings, rep.coverage)).toBe(rep.verdict);
        expect(synthReduce(rep.findings, 'COMPLETE')).toBe('ACHIEVED'); // 同一 findings，另一 verdict
      });
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
