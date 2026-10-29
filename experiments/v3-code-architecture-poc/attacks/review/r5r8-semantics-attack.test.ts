/**
 * 独立复验席 R5–R8 第 2–6 项独立攻击：
 *  S-1（coverage 不驱动结论）· S-3（报告身份锚定 records）· S-2/F-24（空集可归因 + 第四成因）
 *  · D-12（计数不抗探测，复核）· S-4（HARD_REF_NOT_PINNED 位置主张实测）· S-7/S-8（XC-28 可检测性）
 *
 * 本席纪律：只新建 attacks/review/ 下文件；不改 src/**、tests/**、他人攻击文件与既有断言。
 */
import { describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../../src/harness/paths.ts';
import { openWorld, PRINCIPAL, type World } from '../../src/harness/world.ts';
import { asOid, asSpaceId, type CommitSequence, type ObjectOid } from '../../src/contracts/index.ts';
import type { UnitOfWork } from '../../src/kernel/kernel.ts';
import { readAsOf } from '../../src/kernel/read-context.ts';
import { CAP_RECORDS, synthReduce, ValidationService, type RunResult } from '../../src/domains/test-records.ts';
import { VALIDATOR_ID } from '../../src/domains/test-validation.ts';

const ALICE = PRINCIPAL('alice');
const ADMIN = PRINCIPAL('admin');

function mkWorld(tag: string, space: string, grants?: Record<string, string[]>) {
  const dir = mkdtempSync(join(POC_DATA_DIR, tag));
  const w = openWorld({
    file: join(dir, 'attack.db'), space,
    grants: grants ?? { alice: ['space-write'], admin: ['capability-admin'] },
  });
  return { w, dir };
}
function finish(w: World, dir: string) {
  w.close();
  rmSync(dir, { recursive: true, force: true });
}
function mkSvc(w: World, hostEdges?: (oid: ObjectOid) => readonly string[]): ValidationService {
  return new ValidationService(
    w.kernel.faceFor(CAP_RECORDS),
    (fn) => w.uow(ALICE, fn),
    (ref) => {
      const s = w.kernel.readRevision(ref);
      return s ? { revision: s.revision, payload: s.payload } : undefined;
    },
    hostEdges,
  );
}
const codeOf = (e: unknown): string => {
  const x = e as { code?: string };
  return x.code ?? String(e);
};

// ---------------------------------------------------------------- S-1

describe('S-1：coverage 不驱动 verdict（RPT-02）', () => {
  test('coverage 与 findings 任意矛盾组合：verdict 只由 findings 决定', () => {
    expect(synthReduce([], 'NOT_DISCLOSED')).toBe('ACHIEVED');
    expect(synthReduce([], 'COMPLETE')).toBe('ACHIEVED');
    expect(synthReduce([{ outcome: 'FAIL' }], 'NOT_DISCLOSED')).toBe('NOT_ACHIEVED');
    expect(synthReduce([{ outcome: 'FAIL' }], 'INCOMPLETE_DUE_TO_VISIBILITY')).toBe('NOT_ACHIEVED');
    expect(synthReduce([{ outcome: 'INDETERMINATE' }], 'NOT_DISCLOSED')).toBe('INDETERMINATE');
    expect(synthReduce([{ outcome: 'INDETERMINATE' }], 'COMPLETE')).toBe('INDETERMINATE');
  });

  test('世界级：校验器离线 ⇒ CHECKER_UNAVAILABLE 的 INDETERMINATE finding；coverage 分支确已死', () => {
    const { w, dir } = mkWorld('r5r8-s1-', 'SP-S1');
    try {
      const oid = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { text: 'x' } }));
      const svc = mkSvc(w);
      let rep: RunResult | undefined;
      svc.withValidatorOffline(VALIDATOR_ID, () => {
        rep = svc.run(oid, 1, { actor: 'alice' });
      });
      expect(rep).toBeDefined();
      const r = rep!;
      expect(r.verdict).toBe('INDETERMINATE');
      expect(r.findings.map((f) => f.code)).toContain('CHECKER_UNAVAILABLE');
      // RPT-03 封闭三值：离线落的是三值之一，不是旧第四值
      expect(['COMPLETE', 'INCOMPLETE_DUE_TO_VISIBILITY', 'NOT_DISCLOSED']).toContain(r.coverage);
      // 同一 findings，把 coverage 换成最"宽松"值，归约结果不变 ⇒ coverage 未参与
      expect(synthReduce(r.findings, 'COMPLETE')).toBe('INDETERMINATE');
    } finally { finish(w, dir); }
  });
});

// ---------------------------------------------------------------- S-3

describe('S-3：报告自身身份锚定 records', () => {
  test('提交后的报告必有 records 行且可解析；幽灵报告号 ⇒ OPAQUE', () => {
    const { w, dir } = mkWorld('r5r8-s3-', 'SP-S3');
    try {
      const oid = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { text: 'x' } }));
      const res = w.uow(ALICE, (tx) => tx.recordReport({
        target: { kind: 'revision-ref', oid, revision: 1 },
        validatorId: 'v', ruleVersion: 'r1', schemaVersion: 's1', environment: 'e',
        executedAt: Date.now(), guaranteeScope: 'g', verdict: 'ACHIEVED', findings: [], declaredGaps: [],
      }));
      expect(res.reportId).toBe(`RPT-${res.seq}`);
      expect(w.readRecord(res.reportId)).toBeDefined();
      expect(w.kernel.resolvePresented({ kind: 'record-ref', recordId: res.reportId })).toEqual({ state: 'PRESENT' });
      expect(w.kernel.resolvePresented({ kind: 'record-ref', recordId: 'RPT-999999' })).toEqual({ state: 'OPAQUE' });
      expect(w.readRecord('RPT-999999')).toBeUndefined();
    } finally { finish(w, dir); }
  });

  test('报告目标为 record-ref（ledger.record_id 被目标 id 占用）时，报告自身号仍 PRESENT（旧 S-3 误判路径）', () => {
    const { w, dir } = mkWorld('r5r8-s3b-', 'SP-S3B');
    try {
      const recId = w.uow(ALICE, (tx) => tx.declareRecord({ recordId: 'REC-S3', eventType: 'synth:raw-intake', payload: { text: 'x' } }));
      const oid = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { text: 'x' } }));
      const res = w.uow(ALICE, (tx) => tx.recordReport({
        target: { kind: 'record-ref', recordId: recId },
        validatorId: 'v', ruleVersion: 'r1', schemaVersion: 's1', environment: 'e',
        executedAt: Date.now(), guaranteeScope: 'g', verdict: 'ACHIEVED', findings: [], declaredGaps: [],
      }));
      // 报告号只可能经 records 行 PRESENT（其 ledger 行 record_id 是目标 id，不是报告号）
      expect(w.kernel.resolvePresented({ kind: 'record-ref', recordId: res.reportId })).toEqual({ state: 'PRESENT' });
      expect(w.readRecord(recId)).toBeDefined();
      expect(w.kernel.resolvePresented({ kind: 'record-ref', recordId: recId })).toEqual({ state: 'PRESENT' });
    } finally { finish(w, dir); }
  });

  test('经装配根未守卫面手插 check_report 行：不可被引用/读取（身份正源是 records 而非 check_report 表）', () => {
    const { w, dir } = mkWorld('r5r8-s3c-', 'SP-S3C');
    try {
      w.raw.run(
        `insert into check_report(report_id, target_kind, validator_id, rule_version, schema_version, environment, executed_at, guarantee_scope, verdict, findings_json, declared_gaps_json, recorded_seq) values(?,?,?,?,?,?,?,?,?,?,?,?)`,
        'RPT-PHANTOM', 'revision-ref', 'v', 'r1', 's1', 'e', 1, 'g', 'ACHIEVED', '[]', '[]', w.ledgerHead());
      expect(w.kernel.resolvePresented({ kind: 'record-ref', recordId: 'RPT-PHANTOM' })).toEqual({ state: 'OPAQUE' });
      expect(w.readRecord('RPT-PHANTOM')).toBeUndefined();
      // 行确实存在（check_report 可被绕过身份锚写入），但 PoC 面内没有任何"引用/计数"消费它：
      // src 全量 grep 确认除 kernel.ts 的 insert 外无任何 check_report 读取
      const n = w.kernel.port.read((r) => (r.get('select count(*) c from check_report') as { c: number }).c);
      expect(n).toBe(1);
    } finally { finish(w, dir); }
  });
});

// ---------------------------------------------------------------- S-2 / D-12

describe('S-2/F-24：空集可归因', () => {
  test('第四成因（数据层）：describedAt 为数字但量纲/纪元不一致 ⇒ 回显全静默，与"真没有"不可区分', () => {
    const { w, dir } = mkWorld('r5r8-s2-', 'SP-S2');
    try {
      // 对象的"时间"按秒记（1.7e9）；调用方按毫秒窗口查询同一物理时段
      const oid = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { text: 'x', describedAt: 1_700_000_000 } }));
      const res = readAsOf(w.kernel, {
        space: asSpaceId('SP-S2'), principal: ALICE, mode: 'as-recorded', consistency: 'stale-ok',
        describedAtOrDuring: { during: [1_600_000_000_000, 1_800_000_000_000] },
      });
      expect(res.rows).toEqual([]);
      const e = res.echo;
      expect(e.hiddenByInactiveCapability).toBe(0);
      expect(e.hiddenByContractSkew).toBe(0);
      expect(e.timeFieldMissing).toBe(false); // 键在且是数字 ⇒ 形状检查通过，成因未被标记
      expect(e.truncated).toBe(false);
      // 但对象存在，且其"时间"在秒制下落在窗口内 ⇒ 空是数据层成因（量纲/纪元），机制不标记
      expect(w.readObject(oid)).toBeDefined();
    } finally { finish(w, dir); }
  });

  test('负对照：键真缺失时 timeFieldMissing=true（作者的键名归因有效）', () => {
    const { w, dir } = mkWorld('r5r8-s2c-', 'SP-S2C');
    try {
      w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { text: 'no-time-field' } }));
      const res = readAsOf(w.kernel, {
        space: asSpaceId('SP-S2C'), principal: ALICE, mode: 'as-recorded', consistency: 'stale-ok',
        describedAtOrDuring: { during: [0, 1_000_000_000_000_000] },
      });
      expect(res.rows).toEqual([]);
      expect(res.echo.timeFieldMissing).toBe(true);
    } finally { finish(w, dir); }
  });
});

describe('D-12：计数不抗探测（复核 READINESS 的席位结论）', () => {
  test('截点前缀差分 C(X)-C(X-1) 可枚举被剔除行的精确 recorded_seq', () => {
    const { w, dir } = mkWorld('r5r8-d12-', 'SP-D12');
    try {
      const oid = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { text: 'x' } }));
      const S = w.readObject(oid)!.recordedSeq;
      const owner = w.kernel.port.read((r) => (r.get('select owner_capability from object_directory where oid=?', oid) as { owner_capability: string }).owner_capability);
      w.unloadCapability(owner, ADMIN);
      let prev = 0;
      let jumpAt: number | undefined;
      for (let x = 1; x <= S; x++) {
        const res = readAsOf(w.kernel, {
          space: asSpaceId('SP-D12'), principal: ALICE, mode: 'as-recorded', consistency: 'stale-ok',
          recordedAsOf: x as CommitSequence,
        });
        const c = res.echo.hiddenByInactiveCapability;
        if (c > prev) jumpAt = x;
        prev = c;
      }
      expect(prev).toBeGreaterThanOrEqual(1); // 隐藏行被计数
      expect(jumpAt).toBe(S);                 // 精确位置可枚举 ⇒ D-12 成立
    } finally { finish(w, dir); }
  });

  test('默认截点回显 head（泄露）；oid 按创建序可直接命名', () => {
    const { w, dir } = mkWorld('r5r8-d12b-', 'SP-D12B');
    try {
      const oid = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { text: 'x' } }));
      const res = readAsOf(w.kernel, {
        space: asSpaceId('SP-D12B'), principal: ALICE, mode: 'as-recorded', consistency: 'stale-ok',
      });
      expect(res.echo.recordedAsOfWasDefaulted).toBe(true);
      expect(res.echo.usedRecordedAsOf).toBe(w.ledgerHead());
      expect(w.readObject(asOid('OBJ-SP-D12B-1'))).toBeDefined();
      expect(w.readObject(asOid('OBJ-SP-D12B-1'))!.oid).toBe(oid);
    } finally { finish(w, dir); }
  });
});

// ---------------------------------------------------------------- S-4

describe('S-4：HARD_REF_NOT_PINNED 位置主张实测（幽灵/存在但被修订/record-ref）', () => {
  test('幽灵目标（object-ref 指向不存在的 oid）⇒ 仍是 REQUIRED_REF_MISSING（存在性判据在前，旧码不变）', () => {
    const { w, dir } = mkWorld('r5r8-s4-', 'SP-S4');
    try {
      const src = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { text: 'x' } }));
      let code = 'COMMITTED';
      try {
        w.uow(ALICE, (tx) => tx.linkRef({
          from: { kind: 'revision-ref', oid: src, revision: 1 },
          to: { kind: 'object-ref', oid: asOid('OBJ-SP-S4-999') },
          role: 'hard', required: true,
        }));
      } catch (e) { code = codeOf(e); }
      expect(code).toBe('REQUIRED_REF_MISSING');
    } finally { finish(w, dir); }
  });

  test('存在目标 + 未钉死 object-ref ⇒ HARD_REF_NOT_PINNED（"存在但未修订"与"存在但被修订"都触发）', () => {
    const { w, dir } = mkWorld('r5r8-s4b-', 'SP-S4B');
    try {
      const t = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { text: 't' } }));
      const tryLink = (src: ObjectOid): string => {
        try {
          w.uow(ALICE, (tx) => tx.linkRef({
            from: { kind: 'revision-ref', oid: src, revision: 1 },
            to: { kind: 'object-ref', oid: t },
            role: 'hard', required: true,
          }));
          return 'COMMITTED';
        } catch (e) { return codeOf(e); }
      };
      const s1 = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { text: 's1' } }));
      expect(tryLink(s1)).toBe('HARD_REF_NOT_PINNED'); // 存在但未修订
      w.uow(ALICE, (tx) => tx.revise(t, { payload: { text: 't2' } }));
      const s2 = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { text: 's2' } }));
      expect(tryLink(s2)).toBe('HARD_REF_NOT_PINNED'); // 存在但被修订（目标已漂移，判据不变：形状未钉死）
    } finally { finish(w, dir); }
  });

  test('revision-ref/record-ref/源端：逐分支判据', () => {
    const { w, dir } = mkWorld('r5r8-s4c-', 'SP-S4C');
    try {
      const t = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { text: 't' } }));
      const mkSrc = (tag: string): ObjectOid => w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { text: tag } }));
      const codeOfTx = (fn: (tx: UnitOfWork) => void): string => {
        try { w.uow(ALICE, fn); return 'COMMITTED'; } catch (e) { return codeOf(e); }
      };
      // 修订级缺失
      const s1 = mkSrc('s1');
      expect(codeOfTx((tx) => tx.linkRef({
        from: { kind: 'revision-ref', oid: s1, revision: 1 },
        to: { kind: 'revision-ref', oid: t, revision: 99 }, role: 'hard', required: true,
      }))).toBe('REQUIRED_REF_MISSING');
      // 钉死到存在修订 ⇒ 提交成功
      const s2 = mkSrc('s2');
      expect(codeOfTx((tx) => tx.linkRef({
        from: { kind: 'revision-ref', oid: s2, revision: 1 },
        to: { kind: 'revision-ref', oid: t, revision: 1 }, role: 'hard', required: true,
      }))).toBe('COMMITTED');
      // record-ref 存在 ⇒ 提交成功（记录不可变，天然钉死，无 pinning 检查）
      const recId = w.uow(ALICE, (tx) => tx.declareRecord({ recordId: 'REC-S4', eventType: 'synth:raw-intake', payload: { text: 'x' } }));
      const s3 = mkSrc('s3');
      expect(codeOfTx((tx) => tx.linkRef({
        from: { kind: 'revision-ref', oid: s3, revision: 1 },
        to: { kind: 'record-ref', recordId: recId }, role: 'hard', required: true,
      }))).toBe('COMMITTED');
      // record-ref 幽灵 ⇒ REQUIRED_REF_MISSING
      const s4 = mkSrc('s4');
      expect(codeOfTx((tx) => tx.linkRef({
        from: { kind: 'revision-ref', oid: s4, revision: 1 },
        to: { kind: 'record-ref', recordId: 'REC-GHOST' }, role: 'hard', required: true,
      }))).toBe('REQUIRED_REF_MISSING');
      // 源端修订缺失 ⇒ REQUIRED_REF_MISSING（level=source，既有判据）
      const s5 = mkSrc('s5');
      expect(codeOfTx((tx) => tx.linkRef({
        from: { kind: 'revision-ref', oid: s5, revision: 7 },
        to: { kind: 'revision-ref', oid: t, revision: 1 }, role: 'hard', required: true,
      }))).toBe('REQUIRED_REF_MISSING');
    } finally { finish(w, dir); }
  });
});

// ---------------------------------------------------------------- S-7/S-8

describe('S-7/S-8：XC-28 可检测性（registeredEdges 缺省空视图）', () => {
  test('同一双正源数据：装配根缺省（未交 hostEdges）⇒ ACHIEVED+COMPLETE 静默通过；接入真实边视图 ⇒ SYNTH_DUAL_SOURCE+NOT_ACHIEVED', () => {
    const { w, dir } = mkWorld('r5r8-xc-', 'SP-XC');
    try {
      const usedIn = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { text: 'ctx' } }));
      const oid = w.uow(ALICE, (tx) => {
        const o = tx.createObject({ kind: 'test.claim', payload: { text: 'x', operating_context: 'W1' } });
        tx.linkRef({
          from: { kind: 'revision-ref', oid: o, revision: 1 },
          to: { kind: 'revision-ref', oid: usedIn, revision: 1 },
          role: 'USED_IN', required: false,
        });
        return o;
      });
      // 缺省装配（ValidationService 未提供第 4 参 hostEdges）
      const defaultRep = mkSvc(w).run(oid, 1, { actor: 'alice' });
      expect(defaultRep.findings.map((f) => f.code)).not.toContain('SYNTH_DUAL_SOURCE');
      expect(defaultRep.verdict).toBe('ACHIEVED');
      expect(defaultRep.coverage).toBe('COMPLETE'); // 无"边视图未交"的负信号
      // 装配根接入真实边视图（宿主读 ref_edge 角色交入）
      const realEdges = (o: ObjectOid): readonly string[] =>
        w.kernel.port.read((r) => (r.all('select role from ref_edge where from_oid=? and from_rev=?', o, 1) as { role: string }[]).map((x) => x.role));
      const wiredRep = mkSvc(w, realEdges).run(oid, 1, { actor: 'alice' });
      expect(wiredRep.findings.map((f) => f.code)).toContain('SYNTH_DUAL_SOURCE');
      expect(wiredRep.verdict).toBe('NOT_ACHIEVED');
    } finally { finish(w, dir); }
  });

  test('SYNTH_INLINE_STATE_FIELD 不依赖边视图：内联 adopted_by/superseded 在缺省边下仍被检出', () => {
    const { w, dir } = mkWorld('r5r8-xcb-', 'SP-XCB');
    try {
      const oid = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { text: 'x', adopted_by: 'someone' } }));
      const rep = mkSvc(w).run(oid, 1, { actor: 'alice' });
      expect(rep.findings.map((f) => f.code)).toContain('SYNTH_INLINE_STATE_FIELD');
      expect(rep.verdict).toBe('NOT_ACHIEVED');
    } finally { finish(w, dir); }
  });
});
