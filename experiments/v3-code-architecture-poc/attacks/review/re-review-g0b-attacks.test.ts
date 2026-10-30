/**
 * 独立复验席位 B（G0 / D-15 攻击面）——临时攻击测试。
 *
 * 纪律：本文件在 `attacks/review/`（tsconfig include 之外，不被 `tsc -p` 收集）；
 * 不修改 src/**、tests/**。所有断言记录**实测行为**；标注 [预期] 的期望来自任务书，
 * 若实测不符则断言失败并在报告中以实测为准。
 *
 * 攻击清单：
 *  B-1  恒空视图 vs 未交视图：报告级可区分性 + 空视图下的残留假通过
 *  B-2  抛异常视图 / 返回 undefined 视图 / 异步视图：类型层与运行时行为
 *  B-3  边角色拼写变体（used_in / USED_IN_ / Used_In）能否绕过 includes('USED_IN')
 *  B-4  payload 字段别名（operatingContext / context.operating）是否仍被检出
 *  B-5  INDETERMINATE 归约方向（直接 + 端到端混合实例 + 呈现层不洗白）
 */
import { describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../../src/harness/paths.ts';
import { openWorld, PRINCIPAL, type World } from '../../src/harness/world.ts';
import type { ObjectOid } from '../../src/contracts/index.ts';
import { CAP_RECORDS, ValidationService, synthReduce } from '../../src/domains/test-records.ts';
import { TEST_OBJECT_MODEL } from '../../src/domains/test-object-model.ts';
import { presentReport } from '../../src/domains/report-presentation.ts';

const WRITER = PRINCIPAL('g0b-writer');
const GRANTS = { 'g0b-writer': ['space-write'] };

function open(prefix: string) {
  const dir = mkdtempSync(join(POC_DATA_DIR, prefix));
  const w = openWorld({ file: join(dir, 's.db'), space: 'SP-G0B', grants: GRANTS, plugins: [TEST_OBJECT_MODEL] });
  return { dir, w };
}

const realEdges = (w: World) => (oid: ObjectOid): readonly string[] =>
  w.raw.all<{ role: string }>(`select role from ref_edge where from_oid=?`, oid).map((r) => r.role);

/** 造双正源对象：payload 带 operating_context + 一条指定 role 的边（默认 USED_IN）。 */
function dualSource(w: World, role = 'USED_IN'): ObjectOid {
  const target = w.uow(WRITER, (tx) => tx.createObject({ kind: 'test.claim', payload: { text: 'ok' } }));
  return w.uow(WRITER, (tx) => {
    const o = tx.createObject({ kind: 'test.claim', payload: { text: 'ok', operating_context: 'W1' } });
    tx.linkRef({ from: { kind: 'revision-ref', oid: o, revision: 1 },
      to: { kind: 'revision-ref', oid: target, revision: 1 }, role, required: false });
    return o;
  });
}

function svc(w: World, view?: (oid: ObjectOid) => readonly string[]): ValidationService {
  return new ValidationService(w.kernel.faceFor(CAP_RECORDS), (fn) => w.uow(WRITER, fn),
    (ref) => w.readRevision(ref), view);
}

describe('B-1 恒空视图 vs 未交视图', () => {
  test('未交（基线锁定）：INDETERMINATE + COMPLETE，非 ACHIEVED', () => {
    const { dir, w } = open('g0b-b1a-');
    try {
      const oid = dualSource(w);
      const rep = svc(w).run(oid, 1, { actor: 'alice' }, 'v1');
      expect(rep.findings.map((f) => f.code)).toContain('SYNTH_EDGES_UNAVAILABLE');
      expect(rep.verdict).toBe('INDETERMINATE');
      expect(rep.coverage).toBe('COMPLETE');
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('恒空视图 + 真实 USED_IN 边存在：仍报 ACHIEVED + COMPLETE（残留假通过）', () => {
    const { dir, w } = open('g0b-b1b-');
    try {
      const oid = dualSource(w);
      // 先证明数据库里这条边**真实存在**（视图是谎言，不是世界为空）
      const dbRoles = w.raw.all<{ role: string }>(`select role from ref_edge where from_oid=?`, oid).map((r) => r.role);
      expect(dbRoles).toContain('USED_IN');
      const rep = svc(w, () => []).run(oid, 1, { actor: 'alice' }, 'v1');
      // 实测记录（任务书要求：两者的结论分别是什么）
      expect(rep.findings.map((f) => f.code)).not.toContain('SYNTH_EDGES_UNAVAILABLE');
      expect(rep.findings.map((f) => f.code)).not.toContain('SYNTH_DUAL_SOURCE');
      expect(rep.verdict).toBe('ACHIEVED');
      expect(rep.coverage).toBe('COMPLETE');
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('对照：同一对象接真实视图 ⇒ NOT_ACHIEVED（证明世界确实违规）', () => {
    const { dir, w } = open('g0b-b1c-');
    try {
      const oid = dualSource(w);
      const rep = svc(w, realEdges(w)).run(oid, 1, { actor: 'alice' }, 'v1');
      expect(rep.findings.map((f) => f.code)).toContain('SYNTH_DUAL_SOURCE');
      expect(rep.verdict).toBe('NOT_ACHIEVED');
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('B-2 异常 / undefined / 异步视图', () => {
  test('抛异常视图：run() 直接抛，不落任何报告（安全方向但无 INDETERMINATE 降级）', () => {
    const { dir, w } = open('g0b-b2a-');
    try {
      const oid = dualSource(w);
      const before = (w.raw.get<{ c: number }>(`select count(*) c from check_report`) as { c: number }).c;
      const v = svc(w, () => { throw new Error('view down'); });
      expect(() => v.run(oid, 1, { actor: 'alice' }, 'v1')).toThrow(/view down/);
      const after = (w.raw.get<{ c: number }>(`select count(*) c from check_report`) as { c: number }).c;
      expect(after).toBe(before); // 没有报告行被记录
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('运行时返回 undefined 的视图：退化为"未交"，出 INDETERMINATE（安全方向）', () => {
    const { dir, w } = open('g0b-b2b-');
    try {
      const oid = dualSource(w);
      const undefView = ((_o: ObjectOid) => undefined) as unknown as (oid: ObjectOid) => readonly string[];
      const rep = svc(w, undefView).run(oid, 1, { actor: 'alice' }, 'v1');
      expect(rep.findings.map((f) => f.code)).toContain('SYNTH_EDGES_UNAVAILABLE');
      expect(rep.verdict).toBe('INDETERMINATE');
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('异步视图（运行时注入）：check 内 TypeError（Promise 无 includes），run() 抛', () => {
    const { dir, w } = open('g0b-b2c-');
    try {
      const oid = dualSource(w);
      const asyncView = (async (_o: ObjectOid) => [] as const) as unknown as (oid: ObjectOid) => readonly string[];
      expect(() => svc(w, asyncView).run(oid, 1, { actor: 'alice' }, 'v1')).toThrow(TypeError);
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('B-3 边角色拼写变体（includes("USED_IN") 精确匹配面）', () => {
  for (const role of ['used_in', 'USED_IN_', 'Used_In', ' USED_IN']) {
    test(`role=${JSON.stringify(role)}：双正源真实存在却不被检出`, () => {
      const { dir, w } = open('g0b-b3-');
      try {
        const oid = dualSource(w, role);
        const dbRoles = w.raw.all<{ role: string }>(`select role from ref_edge where from_oid=?`, oid).map((r) => r.role);
        expect(dbRoles).toContain(role);
        const rep = svc(w, realEdges(w)).run(oid, 1, { actor: 'alice' }, 'v1');
        expect(rep.findings.map((f) => f.code)).not.toContain('SYNTH_DUAL_SOURCE');
        expect(rep.verdict).toBe('ACHIEVED');
        expect(rep.coverage).toBe('COMPLETE');
      } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
    });
  }
});

describe('B-4 payload 字段别名 / 嵌套（检测触发面完整性）', () => {
  test('operatingContext（camelCase）+ 未交视图：连 INDETERMINATE 都不出', () => {
    const { dir, w } = open('g0b-b4a-');
    try {
      const oid = w.uow(WRITER, (tx) =>
        tx.createObject({ kind: 'test.claim', payload: { text: 'ok', operatingContext: 'W1' } }));
      const rep = svc(w).run(oid, 1, { actor: 'alice' }, 'v1'); // 未交视图
      expect(rep.findings.map((f) => f.code)).not.toContain('SYNTH_EDGES_UNAVAILABLE');
      expect(rep.findings.map((f) => f.code)).not.toContain('SYNTH_DUAL_SOURCE');
      expect(rep.verdict).toBe('ACHIEVED');
      expect(rep.coverage).toBe('COMPLETE');
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('context.operating（嵌套）+ 真实视图（空）：零信号 ACHIEVED', () => {
    const { dir, w } = open('g0b-b4b-');
    try {
      const oid = w.uow(WRITER, (tx) =>
        tx.createObject({ kind: 'test.claim', payload: { text: 'ok', context: { operating: 'W1' } } }));
      const rep = svc(w, realEdges(w)).run(oid, 1, { actor: 'alice' }, 'v1');
      expect(rep.findings.map((f) => f.code)).not.toContain('SYNTH_DUAL_SOURCE');
      expect(rep.findings.map((f) => f.code)).not.toContain('SYNTH_EDGES_UNAVAILABLE');
      expect(rep.verdict).toBe('ACHIEVED');
      expect(rep.coverage).toBe('COMPLETE');
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('B-5 INDETERMINATE 归约方向', () => {
  test('直接：一条 INDETERMINATE + 若干 PASS ⇒ INDETERMINATE（PASS 不洗白）', () => {
    expect(synthReduce([{ outcome: 'INDETERMINATE' }, { outcome: 'PASS' }, { outcome: 'PASS' }, { outcome: 'PASS' }]))
      .toBe('INDETERMINATE');
    expect(synthReduce([{ outcome: 'PASS' }, { outcome: 'PASS' }])).toBe('ACHIEVED');
    expect(synthReduce([])).toBe('ACHIEVED');
    expect(synthReduce([{ outcome: 'FAIL' }, { outcome: 'INDETERMINATE' }, { outcome: 'PASS' }])).toBe('NOT_ACHIEVED');
  });

  test('端到端混合：INDETERMINATE(withheld) + INDETERMINATE(edges) ⇒ verdict INDETERMINATE', () => {
    const { dir, w } = open('g0b-b5a-');
    try {
      const oid = dualSource(w);
      const rep = svc(w).run(oid, 1, { actor: 'alice', optionalField: { st: 'UNRESOLVED', withheld: true } }, 'v1');
      const codes = rep.findings.map((f) => f.code).sort();
      expect(codes).toEqual(['SYNTH_EDGES_UNAVAILABLE', 'SYNTH_WITHHELD_REFERENCE']);
      expect(rep.verdict).toBe('INDETERMINATE');
      expect(rep.coverage).toBe('INCOMPLETE_DUE_TO_VISIBILITY');
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('端到端 FAIL+INDETERMINATE 混合：FAIL 优先 ⇒ NOT_ACHIEVED（RPT-02 顺序）', () => {
    const { dir, w } = open('g0b-b5b-');
    try {
      const oid = w.uow(WRITER, (tx) =>
        tx.createObject({ kind: 'test.claim', payload: { operating_context: 'W1' } })); // 缺 text
      const rep = svc(w).run(oid, 1, { actor: 'alice' }, 'v1');
      const codes = rep.findings.map((f) => f.code).sort();
      expect(codes).toEqual(['SYNTH_EDGES_UNAVAILABLE', 'SYNTH_MISSING_REQUIRED']);
      expect(rep.verdict).toBe('NOT_ACHIEVED');
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('呈现层不洗白：非审计/审计读者均见 INDETERMINATE', () => {
    const rep = {
      items: [{ code: 'SYNTH_EDGES_UNAVAILABLE', outcome: 'INDETERMINATE' }],
      coverage: 'COMPLETE',
    };
    expect(presentReport(rep, 'bob').verdict).toBe('INDETERMINATE');
    expect(presentReport(rep, 'auditor').verdict).toBe('INDETERMINATE');
  });
});
