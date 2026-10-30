/**
 * 单一正源（XC-28）与采纳/取代正源（XC-01/XC-22）的**可检测性**证据（S-7、S-8）。
 *
 * 此前 PoC 只有"可写性"证据：payload 字段与 USED_IN 关联边可以同事务并存、各自漂移且零提示，
 * 而对账表把 `NAMESPACE_ESCAPE` 一并记作 XC-28 已实证——那是过度声称（已降级，见 RECONCILIATION 8b）。
 * 本文件补的是缺失的另一半：合成域里放一条**能检出冲突**的规则，并证明它
 * ① 在冲突现场报 VIOLATION；② 在非冲突现场**不**报（否则规则只是无条件否决，不构成检测能力）。
 */
import { describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../src/harness/paths.ts';
import { openWorld, PRINCIPAL, type World } from '../src/harness/world.ts';
import { TEST_OBJECT_MODEL } from '../src/domains/test-object-model.ts';
import { CAP_RECORDS, ValidationService } from '../src/domains/test-records.ts';
import type { ObjectOid } from '../src/contracts/index.ts';

const WRITER = PRINCIPAL('xc28-writer');
const GRANTS = { 'xc28-writer': ['space-write'] };

/** `withEdges=true` 时装配根交出真实边角色；否则缺省空视图（不得假装检过）。 */
function mk(name: string, withEdges: boolean): { w: World; v: ValidationService; tmp: string } {
  const dir = mkdtempSync(join(POC_DATA_DIR, `xc28-${name}-`));
  const w = openWorld({ file: join(dir, 'space.db'), space: 'SP-X', grants: GRANTS, plugins: [TEST_OBJECT_MODEL] });
  const edges = (oid: ObjectOid): readonly string[] =>
    w.raw.all<{ role: string }>(`select role from ref_edge where from_oid=?`, oid).map((r) => r.role);
  // D-19c：接纳编排是 Application Use-case，一律由装配根构造（这里不使用它产出对象）
  const intake = w.intakeUseCase();
  const v = new ValidationService(
    w.kernel.faceFor(CAP_RECORDS), (fn) => w.uow(WRITER, fn),
    (ref) => w.readRevision(ref), withEdges ? edges : undefined,
  );
  // intake 只用于满足构造与主体链，这里不需要它产出对象
  void intake;
  return { w, v, tmp: dir };
}

const claim = (w: World, payload: Record<string, unknown>): ObjectOid =>
  w.uow(WRITER, (tx) => tx.createObject({ kind: 'test.claim', payload }));

describe('XC-28 单一正源可检测（S-7）', () => {
  test('payload 关系族字段 + 已注册 USED_IN 边 ⇒ VIOLATION，verdict 不达', () => {
    const { w, v, tmp } = mk('dual', true);
    try {
      const target = claim(w, { text: '合格内容' });
      const oid = w.uow(WRITER, (tx) => {
        const o = tx.createObject({ kind: 'test.claim', payload: { text: '合格内容', operating_context: 'W1' } });
        tx.linkRef({ from: { kind: 'revision-ref', oid: o, revision: 1 },
          to: { kind: 'revision-ref', oid: target, revision: 1 }, role: 'USED_IN', required: false });
        return o;
      });
      const rep = v.run(oid, 1, { actor: 'alice' }, 'v1');
      expect(rep.findings.map((f) => f.code)).toContain('SYNTH_DUAL_SOURCE');
      expect(rep.verdict).toBe('NOT_ACHIEVED');
    } finally { w.close(); rmSync(tmp, { recursive: true, force: true }); }
  });

  test('反差：同一 payload 但无关联边 ⇒ 不报双正源（规则是检测，不是无条件否决）', () => {
    const { w, v, tmp } = mk('field-only', true);
    try {
      const oid = claim(w, { text: '合格内容', operating_context: 'W1' });
      const rep = v.run(oid, 1, { actor: 'alice' }, 'v1');
      expect(rep.findings.map((f) => f.code)).not.toContain('SYNTH_DUAL_SOURCE');
      expect(rep.verdict).toBe('ACHIEVED');
    } finally { w.close(); rmSync(tmp, { recursive: true, force: true }); }
  });

  test('反差：装配根没交边视图时不得凭空触发（缺省空视图）', () => {
    const { w, v, tmp } = mk('no-view', false);
    try {
      const target = claim(w, { text: '合格内容' });
      const oid = w.uow(WRITER, (tx) => {
        const o = tx.createObject({ kind: 'test.claim', payload: { text: '合格内容', operating_context: 'W1' } });
        tx.linkRef({ from: { kind: 'revision-ref', oid: o, revision: 1 },
          to: { kind: 'revision-ref', oid: target, revision: 1 }, role: 'USED_IN', required: false });
        return o;
      });
      // 事实视图缺席 ⇒ 规则不触发；这记录的是"没检"，不是"检过且通过"
      expect(v.run(oid, 1, { actor: 'alice' }, 'v1').findings.map((f) => f.code)).not.toContain('SYNTH_DUAL_SOURCE');
    } finally { w.close(); rmSync(tmp, { recursive: true, force: true }); }
  });
});

describe('采纳/取代的内联回写可检测（S-8、XC-01、XC-22）', () => {
  for (const field of ['adopted_by', 'superseded']) {
    test(`${field} 内联进 payload ⇒ VIOLATION（正源是 ledger 事件，不是可改写字段）`, () => {
      const { w, v, tmp } = mk(`inline-${field}`, true);
      try {
        const oid = claim(w, { text: '合格内容', [field]: 'OBJ-OTHER' });
        const rep = v.run(oid, 1, { actor: 'alice' }, 'v1');
        expect(rep.findings.map((f) => f.code)).toContain('SYNTH_INLINE_STATE_FIELD');
        expect(rep.verdict).toBe('NOT_ACHIEVED');
      } finally { w.close(); rmSync(tmp, { recursive: true, force: true }); }
    });
  }

  test('反差：干净 payload 仍 ACHIEVED（两条规则都不误伤）', () => {
    const { w, v, tmp } = mk('clean', true);
    try {
      const oid = claim(w, { text: '合格内容' });
      expect(v.run(oid, 1, { actor: 'alice' }, 'v1').verdict).toBe('ACHIEVED');
    } finally { w.close(); rmSync(tmp, { recursive: true, force: true }); }
  });
});
