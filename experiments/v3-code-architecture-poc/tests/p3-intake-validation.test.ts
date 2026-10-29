/**
 * P3 — 历史、接纳与校验（#44 §7.2、§9.2、§13.5/§13.8/§13.9）。
 *
 * 领域政策一律是**合成策略**（见 src/domains/test-records.ts 文件头），只用于验证机制能否
 * 承载这些判据；不得被引用为 PR #42 科研语义政策的实现。契约锚点逐条标注在断言旁。
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../src/harness/paths.ts';
import { openWorld, PRINCIPAL, type World } from '../src/harness/world.ts';
import { TEST_OBJECT_MODEL } from '../src/domains/test-object-model.ts';
import { TEST_VALIDATION, CAP_VALIDATION } from '../src/domains/test-validation.ts';
import { IntakeService, ValidationService, FactStandingService, SYNTH_NOTE } from '../src/domains/test-records.ts';
import { Refusal } from '../src/contracts/index.ts';

const WRITER = PRINCIPAL('alice');      // 有 space-write
const ADMITTER = PRINCIPAL('carol');    // 有 space-write + domain-admission
const OUTSIDER = PRINCIPAL('mallory');  // 无任何授权
const GRANTS = { alice: ['space-write'], carol: ['space-write', 'domain-admission'] };

const PLUGINS = [TEST_OBJECT_MODEL, TEST_VALIDATION];

describe('P3 Raw Intake / Domain Admission / 版本化校验 / 派生业务视图', () => {
  let dir: string;
  beforeAll(() => { dir = mkdtempSync(join(POC_DATA_DIR, 'p3-')); });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  const mk = (name: string) => {
    const w = openWorld({ file: join(dir, `${name}.db`), space: 'SP-1', grants: GRANTS, plugins: PLUGINS });
    return {
      w,
      intake: new IntakeService(w.kernel),
      validation: new ValidationService(w.kernel),
      standing: new FactStandingService(w.kernel, w.authority),
    };
  };

  test('合成策略标记存在且可被引用（不得把占位规则当作科研政策）', () => {
    expect(SYNTH_NOTE).toMatch(/测试专用/);
  });

  test('无法解析的原始材料仍可 Raw Intake 并保留来源，且不产生正式对象（ID-08）', () => {
    const { w, intake } = mk('p3-raw');
    const seq = w.uow(WRITER, (tx) => intake.intake(tx, {
      recordId: 'RAW-1', text: '一段当时无法解析的原始记录', sourceRef: 'mailbox://lab/2026-10-29', unparseable: true,
    }));
    const rec = w.readRecord('RAW-1')!;
    expect(rec.seq).toBe(seq);
    expect(rec.payload.sourceRef).toBe('mailbox://lab/2026-10-29');
    expect(w.raw.get<{ c: number }>(`select count(*) c from object_directory`)!.c).toBe(0); // 记录不是对象
    w.close();
  });

  test('Domain Admission 失败不删除原始输入；失败事务不留正式对象（#44 §7.2）', () => {
    const { w, intake } = mk('p3-admission');
    w.uow(WRITER, (tx) => intake.intake(tx, { recordId: 'RAW-2', text: '残缺内容', sourceRef: 's://2', unparseable: true }));
    const r = w.uow(WRITER, (tx) => intake.tryAdmit(tx, { recordId: 'RAW-2', kind: 'test.claim', text: '残缺内容' }));
    expect(r).toEqual({ refused: 'synth:not-admissible' });
    expect(w.readRecord('RAW-2')!.payload.text).toBe('残缺内容');     // 原始输入仍在
    expect(w.raw.get<{ c: number }>(`select count(*) c from object_directory`)!.c).toBe(0);

    // 中途抛错的接纳事务不得留下半对象，也不得碰原始记录
    expect(() => w.uow(WRITER, (tx) => {
      intake.admit(tx, { recordId: 'RAW-2', kind: 'test.claim', text: '可解析部分' });
      throw new Error('接纳中途失败');
    })).toThrow('接纳中途失败');
    expect(w.raw.get<{ c: number }>(`select count(*) c from object_directory`)!.c).toBe(0);
    expect(w.readRecord('RAW-2')).toBeDefined();
    w.close();
  });

  test('成功接纳产生正式对象并留下指向原始记录的来源引用（RF-06 的对象化路径）', () => {
    const { w, intake } = mk('p3-admit-ok');
    w.uow(WRITER, (tx) => intake.intake(tx, { recordId: 'RAW-3', text: '可解析', sourceRef: 's://3' }));
    const oid = w.uow(WRITER, (tx) => intake.admit(tx, { recordId: 'RAW-3', kind: 'test.claim', text: '可解析' }));
    expect(w.readObject(oid)!.kind).toBe('test.claim');
    const edges = w.raw.all<{ role: string; to_record: string }>(`select role, to_record from ref_edge where from_oid=?`, oid);
    expect(edges).toContainEqual({ role: 'synth:derived-from', to_record: 'RAW-3' });
    w.close();
  });

  test('S-L1 不达标的对象可保存，报告是 FAIL 且不会被读成 PASS（RPT-02、DF-07）', () => {
    const { w, intake, validation } = mk('p3-fail');
    w.uow(WRITER, (tx) => intake.intake(tx, { recordId: 'RAW-4', text: 'x', sourceRef: 's://4' }));
    const oid = w.uow(WRITER, (tx) => intake.admit(tx, { recordId: 'RAW-4', kind: 'test.claim', text: '缺必填字段' }));
    const rep = validation.run(oid, 1, { actor: 'alice' });
    expect(rep.verdict).toBe('NOT_ACHIEVED');
    expect(rep.findings.some((f) => f.code === 'SYNTH_MISSING_REQUIRED')).toBe(true);
    expect(w.raw.get<{ c: number }>(`select count(*) c from object_directory where oid=?`, oid)!.c).toBe(1); // FAIL 不阻止保存
    w.close();
  });

  test('校验器版本改变产生新报告，旧报告逐字段保留且改不动（RPT-01、C11）', () => {
    const { w, intake, validation } = mk('p3-version');
    w.uow(WRITER, (tx) => intake.intake(tx, { recordId: 'RAW-5', text: 'x', sourceRef: 's://5' }));
    const oid = w.uow(WRITER, (tx) => intake.admit(tx, { recordId: 'RAW-5', kind: 'test.claim', text: '合格内容' }));
    const first = validation.run(oid, 1, { actor: 'alice' }, 'v1');
    expect(first.verdict).toBe('ACHIEVED');

    const second = validation.run(oid, 1, { actor: 'alice' }, 'v2');
    const rows = w.raw.all<{ report_id: string; rule_version: string; verdict: string; recorded_seq: number }>(
      `select report_id, rule_version, verdict, recorded_seq from check_report where target_oid=? order by recorded_seq`, oid,
    );
    expect(rows.length).toBe(2);
    expect(rows[0]).toEqual({ report_id: first.reportId, rule_version: 'v1', verdict: 'ACHIEVED', recorded_seq: first.recordedAt });
    expect(rows[1].rule_version).toBe('v2');
    // 旧报告不可改写（存储层）
    expect(() => w.raw.run(`update check_report set verdict='FAIL' where report_id=?`, first.reportId)).toThrow(/CHECK_REPORT_IMMUTABLE/);
    expect(() => w.raw.run(`delete from check_report where report_id=?`, first.reportId)).toThrow(/CHECK_REPORT_IMMUTABLE/);
    w.close();
  });

  test('允许 UNKNOWN 的字段如实声明未知仍得 PASS，并进入 declared_gaps（RPT-05、RD-25）', () => {
    const { w, intake, validation } = mk('p3-unknown');
    w.uow(WRITER, (tx) => intake.intake(tx, { recordId: 'RAW-6', text: 'x', sourceRef: 's://6' }));
    const oid = w.uow(WRITER, (tx) => intake.admit(tx, { recordId: 'RAW-6', kind: 'test.claim', text: 'ok' }));
    const rep = validation.run(oid, 1, { actor: 'alice', optionalField: { st: 'UNKNOWN' as const } }, 'v1');
    expect(rep.verdict).toBe('ACHIEVED');
    expect(rep.declaredGaps).toContain('optionalField');
    // 反向对照：同一字段**未声明状态**（连 UNKNOWN 都没有）才是 VIOLATION（RPT-08 第三分支）
    const bad = validation.run(oid, 1, { actor: 'alice', optionalField: { st: 'UNDECLARED' as const } }, 'v1');
    expect(bad.verdict).toBe('NOT_ACHIEVED');
    expect(bad.findings.some((f) => f.code === 'SYNTH_STATE_UNDECLARED' && f.severity === 'VIOLATION')).toBe(true);
    w.close();
  });

  test('校验器不可用 ⇒ INDETERMINATE 报告，旧 PASS 不改写且不转为否定（F-CHECK-UNAVAILABLE、SP-08）', () => {
    const { w, intake, validation } = mk('p3-unavailable');
    w.uow(WRITER, (tx) => intake.intake(tx, { recordId: 'RAW-7', text: 'x', sourceRef: 's://7' }));
    const oid = w.uow(WRITER, (tx) => intake.admit(tx, { recordId: 'RAW-7', kind: 'test.claim', text: '合格内容' }));
    const before = validation.run(oid, 1, { actor: 'alice' }, 'v1');
    expect(before.verdict).toBe('ACHIEVED');

    validation.withValidatorOffline('synth.claim-checker', () => {
      const rep = validation.run(oid, 1, { actor: 'alice' }, 'v1');
      expect(rep.verdict).toBe('INDETERMINATE');
      expect(rep.findings).toEqual([]);   // 不是 FAIL：没有确定性缺陷可报
    });
    const rows = w.raw.all<{ verdict: string }>(`select verdict from check_report where target_oid=? order by recorded_seq`, oid);
    expect(rows.map((r) => r.verdict)).toEqual(['ACHIEVED', 'INDETERMINATE']); // 旧 PASS 原样在
    w.close();
  });

  test('同一报告既有 FAIL 又有 INDETERMINATE 时归约为 NOT_ACHIEVED（RPT-02 优先；XC-27）', () => {
    const { w, intake, validation } = mk('p3-mixed');
    w.uow(WRITER, (tx) => intake.intake(tx, { recordId: 'RAW-8', text: 'x', sourceRef: 's://8' }));
    const oid = w.uow(WRITER, (tx) => intake.admit(tx, { recordId: 'RAW-8', kind: 'test.claim', text: '缺必填字段' }));
    const rep = validation.run(oid, 1, { actor: 'alice', optionalField: { st: 'UNRESOLVED' as const, withheld: true } }, 'v1');
    expect(rep.findings.map((f) => f.outcome).sort()).toEqual(['FAIL', 'INDETERMINATE']);
    expect(rep.verdict).toBe('NOT_ACHIEVED');  // 已确认的缺陷不得被"看不见的东西"掩盖
    expect(rep.coverage).toBe('INCOMPLETE_DUE_TO_VISIBILITY');
    w.close();
  });

  test('H 记录不得直接充当论证输入端点；对象化后可以（RF-05 → RF-06）', () => {
    const { w, intake, validation } = mk('p3-endpoint');
    w.uow(WRITER, (tx) => intake.intake(tx, { recordId: 'RAW-9', text: 'x', sourceRef: 's://9' }));
    const oid = w.uow(WRITER, (tx) => intake.admit(tx, { recordId: 'RAW-9', kind: 'test.claim', text: 'ok' }));
    const direct = validation.checkEndpoint(oid, 1, { kind: 'record-ref', recordId: 'RAW-9' });
    expect(direct.accepted).toBe(false);
    expect(direct.code).toBe('SYNTH_RECORD_NOT_ENDPOINT');

    // 对象化路径：把原始记录承载个体登记为对象，再引用它
    const carrier = w.uow(WRITER, (tx) => intake.objectifyRecord(tx, { recordId: 'RAW-9' }));
    const via = validation.checkEndpoint(oid, 1, { kind: 'revision-ref', oid: carrier, revision: 1 });
    expect(via.accepted).toBe(true);
    // Kernel 层没有这条判据：它是领域校验的贡献（停线证明）
    expect(w.raw.all(`select 1 from ref_edge where role='synth:derived-from'`).length).toBeGreaterThan(0);
    w.close();
  });

  test('无空间写权连 Raw Intake 也被完全拒绝（RD-27、PR-A1）', () => {
    const { w, intake } = mk('p3-nowrite');
    expect(() => w.uow(OUTSIDER, (tx) => intake.intake(tx, { recordId: 'RAW-X', text: 'x', sourceRef: 's://x' })))
      .toThrow(Refusal);
    expect(w.readRecord('RAW-X')).toBeUndefined();
    w.close();
  });

  test('有写权但无接纳授权：声明完整保存但 AUTHORITY_UNVERIFIED，不改变派生业务视图（PR-A1、CS-23）', () => {
    const { w, standing } = mk('p3-unverified');
    const oid = w.uow(WRITER, (tx) => tx.createObject({ kind: 'test.claim', payload: {} }));
    w.uow(WRITER, (tx) => standing.declare(tx, { oid, revision: 1, stance: 'ACCEPTED' }));
    const rows = w.raw.all<{ note: string }>(`select json_extract(payload_json,'$.note') note from ledger where event_type='synth:fact-designation'`);
    expect(rows[0].note).toBe('AUTHORITY_UNVERIFIED');
    expect(w.readRecord).toBeTypeOf('function');
    expect(standing.standingAt(oid, w.ledgerHead()).state).toBe('NOT_ADOPTED');
    w.close();
  });

  test('有接纳授权则视图改变，且在选定截点上一致（截点前旧值、截点后新值；PR-A4、RD-04）', () => {
    const { w, standing } = mk('p3-standing');
    const oid = w.uow(WRITER, (tx) => tx.createObject({ kind: 'test.claim', payload: {} }));
    const beforeCutoff = w.ledgerHead();

    const at = w.uow(ADMITTER, (tx) => standing.declare(tx, { oid, revision: 1, stance: 'ACCEPTED' }));
    expect(standing.standingAt(oid, w.ledgerHead()).state).toBe('ADOPTED');
    // 同一对象的旧截点读数不得被今天的登记追溯改写
    expect(standing.standingAt(oid, beforeCutoff).state).toBe('NOT_ADOPTED');
    expect(standing.standingAt(oid, at).state).toBe('ADOPTED');
    w.close();
  });

  test('撤回保留全部历史；新截点回到未接纳，旧截点仍显示当时状态（PR-A4、C11）', () => {
    const { w, standing } = mk('p3-withdraw');
    const oid = w.uow(WRITER, (tx) => tx.createObject({ kind: 'test.claim', payload: {} }));
    const adoptedAt = w.uow(ADMITTER, (tx) => standing.declare(tx, { oid, revision: 1, stance: 'ACCEPTED' }));
    const withdrawnAt = w.uow(ADMITTER, (tx) => standing.declare(tx, { oid, revision: 1, stance: 'WITHDRAWN' }));

    expect(standing.standingAt(oid, withdrawnAt).state).toBe('NOT_ADOPTED');
    expect(standing.standingAt(oid, adoptedAt).state).toBe('ADOPTED');
    const n = w.raw.get<{ c: number }>(`select count(*) c from ledger where event_type='synth:fact-designation'`)!.c;
    expect(n).toBe(2); // 撤回是新记录，不是就地改写
    w.close();
  });
});
