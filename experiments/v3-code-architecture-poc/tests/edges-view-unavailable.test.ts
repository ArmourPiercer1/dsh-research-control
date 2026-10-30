/**
 * D-15（P1）修复的作者侧锁：**"边视图没交"不得被读成"检过了、没问题"**。
 *
 * 修复前：装配根未交接线时缺省填 `() => []`，双正源规则静默不触发，
 * 报告仍报 `verdict=ACHIEVED` + `coverage=COMPLETE` —— 零负信号。
 * 修复后：未交 ⇒ 出 `SYNTH_EDGES_UNAVAILABLE`（INDETERMINATE）⇒ verdict 不可能是 ACHIEVED；
 * 交了但为空 ⇒ 是真的检过没这条边，仍可 ACHIEVED。**这两种情况必须可区分**（C12/T-05）。
 *
 * 刻意**不动** coverage 封闭三值：新增第四值等于让 coverage 参与 verdict，
 * 会破坏刚落地的 RPT-03 / S-1 结论——那是用一个新缺陷去修旧缺陷。
 */
import { describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../src/harness/paths.ts';
import { openWorld, PRINCIPAL, type World } from '../src/harness/world.ts';
import type { ObjectOid } from '../src/contracts/index.ts';
import { CAP_RECORDS, ValidationService } from '../src/domains/test-records.ts';
import { TEST_OBJECT_MODEL } from '../src/domains/test-object-model.ts';

const WRITER = PRINCIPAL('edges-writer');
const GRANTS = { 'edges-writer': ['space-write'] };

/** `view` 省略 ⇒ 装配根**没交**边视图；给了就是"交了"，内容由视图自己决定。 */
function mk(name: string, view?: (w: World) => (oid: ObjectOid) => readonly string[]):
  { w: World; v: ValidationService; tmp: string } {
  const dir = mkdtempSync(join(POC_DATA_DIR, `edges-${name}-`));
  const w = openWorld({ file: join(dir, 'space.db'), space: 'SP-E', grants: GRANTS, plugins: [TEST_OBJECT_MODEL] });
  // D-22（包 2）：受限提交接口替代全权事务回调（CONTRACTS.md §16.2）。
  const v = new ValidationService(
    w.kernel.faceFor(CAP_RECORDS), w.validationSubmission(WRITER),
    (ref) => w.readRevision(ref), view ? view(w) : undefined,
  );
  return { w, v, tmp: dir };
}

const realEdges = (w: World) => (oid: ObjectOid): readonly string[] =>
  w.raw.all<{ role: string }>(`select role from ref_edge where from_oid=?`, oid).map((r) => r.role);

/** 造一个双正源对象：payload 里有 operating_context，且注册了 USED_IN 边。 */
function dualSource(w: World): ObjectOid {
  const target = w.uow(WRITER, (tx) => tx.createObject({ kind: 'test.claim', payload: { text: 'ok' } }));
  return w.uow(WRITER, (tx) => {
    const o = tx.createObject({ kind: 'test.claim', payload: { text: 'ok', operating_context: 'W1' } });
    tx.linkRef({ from: { kind: 'revision-ref', oid: o, revision: 1 },
      to: { kind: 'revision-ref', oid: target, revision: 1 }, role: 'USED_IN', required: false });
    return o;
  });
}

describe('D-15：边视图"未提供"与"提供为空"必须可区分', () => {
  test('未交边视图 ⇒ 出 INDETERMINATE 负信号，verdict 不得为 ACHIEVED', () => {
    const { w, v, tmp } = mk('unprovided', undefined);
    try {
      const oid = dualSource(w);
      const rep = v.run(oid, 1, { actor: 'alice' }, 'v1');
      expect(rep.findings.map((f) => f.code)).toContain('SYNTH_EDGES_UNAVAILABLE');
      expect(rep.verdict).not.toBe('ACHIEVED');
      // coverage 仍是封闭三值之一，且没被拉来承担"没检"的语义
      expect(rep.coverage).toBe('COMPLETE');
    } finally { w.close(); rmSync(tmp, { recursive: true, force: true }); }
  });

  test('反差：同一份数据，接上线 ⇒ 真检出 VIOLATION、NOT_ACHIEVED', () => {
    const dir = mkdtempSync(join(POC_DATA_DIR, 'edges-wired-'));
    const w = openWorld({ file: join(dir, 'space.db'), space: 'SP-E', grants: GRANTS, plugins: [TEST_OBJECT_MODEL] });
    const v = new ValidationService(w.kernel.faceFor(CAP_RECORDS), w.validationSubmission(WRITER),
      (ref) => w.readRevision(ref), realEdges(w));
    try {
      const oid = dualSource(w);
      const rep = v.run(oid, 1, { actor: 'alice' }, 'v1');
      expect(rep.findings.map((f) => f.code)).toContain('SYNTH_DUAL_SOURCE');
      expect(rep.verdict).toBe('NOT_ACHIEVED');
      expect(rep.findings.map((f) => f.code)).not.toContain('SYNTH_EDGES_UNAVAILABLE');
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('反差：**交了但视图为空** ⇒ 是真检过没这条边，不得冒"未提供"的信号', () => {
    const dir = mkdtempSync(join(POC_DATA_DIR, 'edges-empty-'));
    const w = openWorld({ file: join(dir, 'space.db'), space: 'SP-E', grants: GRANTS, plugins: [TEST_OBJECT_MODEL] });
    const v = new ValidationService(w.kernel.faceFor(CAP_RECORDS), w.validationSubmission(WRITER),
      (ref) => w.readRevision(ref), () => []);
    try {
      const oid = w.uow(WRITER, (tx) => tx.createObject({ kind: 'test.claim', payload: { text: 'ok', operating_context: 'W1' } }));
      const rep = v.run(oid, 1, { actor: 'alice' }, 'v1');
      const codes = rep.findings.map((f) => f.code);
      expect(codes).not.toContain('SYNTH_EDGES_UNAVAILABLE');
      expect(codes).not.toContain('SYNTH_DUAL_SOURCE');
      expect(rep.verdict).toBe('ACHIEVED');
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
