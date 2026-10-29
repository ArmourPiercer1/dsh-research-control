/**
 * 语义组合攻击（独立审查员）— S-7/S-8：XC-28 真双重源、XC-01/XC-22 反向字段写回
 *
 * S-7 被违反的契约（H_S_R_COMPOSITION_MATRIX_DRAFT.md XC-28 行）：
 *  「operating_context 作为 Entity 字段**同时**注册 USED_IN association」⇒ 违反 EN-W-5 /
 *  RD-12 单一正源；修法=「association 是正源，Entity 侧只有派生视图」。
 *  RECONCILIATION.md 第 8 行把 `NAMESPACE_ESCAPE` 越权拒绝标为 RD-07/15/37、XC-28 的实证，
 *  test-facet.ts 的注释也把"拿核心对象命名空间写"标为「XC-28 的攻击面」——
 *  但 NAMESPACE_ESCAPE 守的是 #44 §6.2「禁止复制核心权威」（跨命名空间写），
 *  **不是** XC-28 的"同一事实两处正源"威胁。
 *
 * 现状（缺陷，两条）：
 *  1. 机制面：createObject/revise 的 payload 不透明（设计使然，Kernel 不应知道字段名），
 *     但因此领域可以在**同一事务**里既把 operating_context 写进核心对象 payload，
 *     又 linkRef 一条 USED_IN 边——两者并存、无拒绝、无标注、无"谁是正源"的机制形态。
 *     单一正源是**领域校验器**规则（SL1-ENT-05/08），而本 PoC 的合成校验器没有实现任何
 *     禁止字段规则 ⇒ PoC 对 XC-28 只有"可写性"证据，没有"可检测性"证据，
 *     对账表却记为已实证。
 *  2. 文档面：上述错位标注（test-facet.ts 注释 + RECONCILIATION 第 8 行锚点）。
 *
 * S-8 被违反的契约：
 *  - XC-01/C01：「adopted this time」应写成**独立的采纳记录**（ledger 事件），
 *    不得写回被采纳对象的反向字段（SL1-ASS-08）；
 *  - XC-22：冲突声明应写成新的冲突记录，不得写回原对象的内联 superseded 字段。
 *
 * 现状（缺陷）：revise 的 payload 全量替换且机制层零提示，上述写回全部可静默提交；
 *  缓解事实（如实记录）：旧 revision 行仍在（append-only 的 domain_state——但在 S-0 修复前
 *  该表本身可被原始 DML 改写），写回**可审计**却**可读到**：最新视图上，
 *  「采纳」/「被取代」的内联形态与合法状态字段同形，机制层无从区分。
 *
 * 本文件断言的是**当前（有缺陷的）行为**——今天通过，修复后应变红：
 * 最小修复（不把科研语义判定推进 Kernel）：
 *  ① 修正标注：RECONCILIATION 第 8 行拆成两条（NAMESPACE_ESCAPE ⇒ #44 §6.2 核心权威复制禁止，
 *     已实证；XC-28/RD-15 单一正源 ⇒ 待合成校验器补禁止字段规则后另行实证）；
 *  ② 合成校验器补一条领域规则：核心 payload 出现关系族字段且同对象存在已注册关联边时
 *     出 VIOLATION finding（payload 对领域可读，规则可表达——本攻击证明"可写"，
 *     补规则即证明"可检测"）；
 *  ③ 采纳/取代的写回同理：合成校验器禁止 adopted_by/superseded 类内联字段
 *    （采纳正源 = 领域 appendLedger 事件，机制已提供）。
 * 回归测试：本文件即攻击证据（①为文档修正；②③的回归=新合成规则+新用例）。
 */
import { describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../../src/harness/paths.ts';
import { openWorld, PRINCIPAL } from '../../src/harness/world.ts';
import { CAP_FACET, FacetStore, TEST_FACET_CALIB } from '../../src/domains/test-facet.ts';
import { TEST_OBJECT_MODEL } from '../../src/domains/test-object-model.ts';

const ALICE = PRINCIPAL('alice');

describe('S-7 XC-28：字段 + 已注册关联并存（真双重源）静默可写', () => {
  test('同一事实两处正源：payload 字段与 USED_IN 边同事务并存、后续可独立改写', () => {
    const dir = mkdtempSync(join(POC_DATA_DIR, 'sem-xc28-'));
    const w = openWorld({ file: join(dir, 'attack.db'), space: 'SP-SEM-7', grants: { alice: ['space-write'] } });
    try {
      const w1 = w.uow(ALICE, (tx) => {
        const subject = tx.createObject({
          kind: 'test.subject',
          // XC-28 的"Entity 字段"侧：operating_context 直接内联
          payload: { serial: 'A1', operating_context: 'W1' },
        });
        const usage = tx.createObject({ kind: 'test.claim', payload: { text: '使用记录' } });
        // XC-28 的"USED_IN association"侧：同一事实同时注册为关联边
        tx.linkRef({
          from: { kind: 'revision-ref', oid: subject, revision: 1 },
          to: { kind: 'revision-ref', oid: usage, revision: 1 },
          role: 'USED_IN',
        });
        return { subject, usage };
      });

      // 无任何拒绝；两处"正源"并存：
      expect(w.readObject(w1.subject)?.payload.operating_context).toBe('W1');
      expect(w.raw.get(`select 1 as x from ref_edge where from_oid=? and role=?`, w1.subject, 'USED_IN')).toBeDefined();

      // 字段侧单独改写 ⇒ 关联边仍在，两者开始漂移，机制层零提示：
      w.uow(ALICE, (tx) =>
        tx.revise(w1.subject, { payload: { serial: 'A1', operating_context: 'W2' } }),
      );
      expect(w.readObject(w1.subject)?.payload.operating_context).toBe('W2');
      expect(w.raw.get(`select 1 as x from ref_edge where from_oid=? and role=?`, w1.subject, 'USED_IN')).toBeDefined();
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('反差锚点：PoC 自称的 XC-28 防护（NAMESPACE_ESCAPE）守的是另一条威胁', () => {
    const dir = mkdtempSync(join(POC_DATA_DIR, 'sem-xc28-anchor-'));
    const w = openWorld({
      file: join(dir, 'attack.db'), space: 'SP-SEM-7B',
      grants: { alice: ['space-write'] }, plugins: [TEST_OBJECT_MODEL, TEST_FACET_CALIB],
    });
    try {
      const facets = new FacetStore(w.kernel, CAP_FACET);
      const subject = w.uow(ALICE, (tx) =>
        tx.createObject({ kind: 'test.subject', payload: { serial: 'A1' } }),
      );
      // 跨命名空间写（#44 §6.2 核心权威复制禁止）⇒ 被拒：
      expect(() => w.uow(ALICE, (tx) => facets.writeIntoForeignNamespace(tx, subject))).toThrow(/NAMESPACE_ESCAPE/);
      // 而上一条用例证明：同命名空间内的"字段 + 边"双重源无任何拒绝。
      // ⇒ NAMESPACE_ESCAPE 的通过不构成 XC-28 单一正源的实证。
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('S-8 XC-01/XC-22：采纳/取代的内联反向字段写回静默可提交', () => {
  test('XC-01：采纳写成被采纳对象的反向字段（adopted_by）⇒ 无拒绝', () => {
    const dir = mkdtempSync(join(POC_DATA_DIR, 'sem-xc01-'));
    const w = openWorld({ file: join(dir, 'attack.db'), space: 'SP-SEM-8', grants: { alice: ['space-write'] } });
    try {
      const target = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { text: '被采纳' } }));
      // C01 要求采纳是独立记录（ledger 事件）；此处按 XC-01 的反面写回：
      w.uow(ALICE, (tx) =>
        tx.revise(target, { payload: { text: '被采纳', adopted_by: 'actor:alice', adopted_at: 100 } }),
      );
      expect(w.readObject(target)?.payload.adopted_by).toBe('actor:alice');
      // 机制层无任何"这是反向字段"的提示；最新视图上它与普通状态字段同形。
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('XC-22：冲突声明写回原对象内联（superseded）⇒ 无拒绝', () => {
    const dir = mkdtempSync(join(POC_DATA_DIR, 'sem-xc22-'));
    const w = openWorld({ file: join(dir, 'attack.db'), space: 'SP-SEM-8B', grants: { alice: ['space-write'] } });
    try {
      const orig = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { text: '原声明' } }));
      const challenger = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { text: '挑战声明' } }));
      // XC-22 的反面：把冲突状态写回原对象内联字段：
      w.uow(ALICE, (tx) =>
        tx.revise(orig, {
          payload: { text: '原声明', superseded: true, superseded_by: { kind: 'revision-ref', oid: challenger, revision: 1 } },
        }),
      );
      const snap = w.readObject(orig)!;
      expect(snap.payload.superseded).toBe(true);
      expect(snap.revision).toBe(2); // 原对象被"就地宣判"，旧内容只在历史里
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
