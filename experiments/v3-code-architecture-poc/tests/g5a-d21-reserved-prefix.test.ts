/**
 * D-21 最小止血（包 6，席位 G5-A 反审，P1 可用性）：保留前缀 id 收归机制计数器。
 *
 * 席位事实（附录 A C5a 移植）：`RPT-${head+2}` 等报告保留前缀 id 任何 space-write 主体可
 * **滚动预占**（declare 掉计数器将要发号的每一个 id）⇒ 合法验证提交撞 `RECORD_ALREADY_DECLARED`，
 * 报告落账面被持续 DoS。
 *
 * 修法（CONTRACTS.md §16.3）：声明通道显式携带保留前缀 ⇒ `RECORD_ID_RESERVED` 拒
 * （身份 namespace 判据，不是存在性判据：空空间与已占用空间同形同拒）；机制 `recordReport`
 * 按 ledger 计数器发号不受影响；**引用**已存在的该前缀记录不受影响。
 * 保留前缀的完整语义（前缀全集/域保留申请/发号区间）归 G1——本止血不发明分配器政策。
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../src/harness/paths.ts';
import { openWorld, PRINCIPAL, type World } from '../src/harness/world.ts';
import { TEST_OBJECT_MODEL } from '../src/domains/test-object-model.ts';
import { Refusal, type ObjectOid } from '../src/contracts/index.ts';

const ADMIN = PRINCIPAL('g21admin');   // space-write + capability-admin
const NOBODY = PRINCIPAL('g21nobody'); // 只有 space-write：席位的攻击主体
const GRANTS = { g21admin: ['space-write', 'capability-admin'], g21nobody: ['space-write'] };
let dir: string;
beforeAll(() => { dir = mkdtempSync(join(POC_DATA_DIR, 'g5a-d21-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

const open = (name: string, space = 'SP-G21'): World =>
  openWorld({ file: join(dir, `${name}.db`), space, grants: GRANTS, plugins: [TEST_OBJECT_MODEL] });
const refusalOf = (fn: () => unknown): string => {
  try { fn(); return 'NO_REFUSAL'; }
  catch (e) { return e instanceof Refusal ? e.code : `OTHER:${String((e as Error).message).slice(0, 40)}`; }
};
const submit = (w: World, oid: ObjectOid) =>
  w.uow(ADMIN, (tx) => tx.recordReport({
    target: { kind: 'revision-ref', oid, revision: 1 },
    validatorId: 'v.g21', ruleVersion: 'r1', schemaVersion: 's1', environment: 'test',
    executedAt: 1, guaranteeScope: 'unit', verdict: 'PASS', findings: [], declaredGaps: [],
  }));

describe('G5A-C5a（移植）：保留前缀预占被拒，合法报告通道不再被滚动撞号', () => {
  test('G21-A 显式声明 RPT- 前缀 ⇒ RECORD_ID_RESERVED（零半成品）；随后合法提交照常、连续提交也照常', () => {
    const w = open('g21-a');
    try {
      const oid = w.uow(ADMIN, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } })) as ObjectOid;
      // 席位原形：预占「计数器下一个要发的号」。修前：成功；修后：显式保留前缀即拒。
      const head = w.ledgerHead();
      const r = refusalOf(() => w.uow(NOBODY, (tx) =>
        tx.declareRecord({ recordId: `RPT-${head + 2}`, eventType: 'ext.g21.preempt', payload: { evil: true } })));
      expect(r).toBe('RECORD_ID_RESERVED');
      expect(w.ledgerHead(), '入口拒在落账之前：零半成品').toBe(head);
      expect(w.readRecord(`RPT-${head + 2}`)).toBeUndefined();
      // 合法路径不受影响：机制按计数器发号
      const first = submit(w, oid);
      expect(first.reportId).toBe(`RPT-${first.seq}`);
      expect(w.readRecord(first.reportId)!.payload.verdict).toBe('PASS');
      // 席位钉的是**持续**拒用 ⇒ 反钉也是持续：第二次、第三次照常落账
      const second = submit(w, oid);
      expect(second.reportId).toBe(`RPT-${second.seq}`);
      // 换一个保留前缀位也拒（不是只挡 head+2 一个形状）
      expect(refusalOf(() => w.uow(NOBODY, (tx) =>
        tx.declareRecord({ recordId: `RPT-${w.ledgerHead() + 9}`, eventType: 'ext.g21.preempt2', payload: {} }))))
        .toBe('RECORD_ID_RESERVED');
      // 非保留前缀照常（止血不是泛化封口）
      expect(refusalOf(() => w.uow(NOBODY, (tx) =>
        tx.declareRecord({ recordId: 'REC-g21-normal', eventType: 'ext.g21.ok', payload: {} })))).toBe('NO_REFUSAL');
    } finally { w.close(); }
  });

  test('G21-B 引用形态不受影响：对已存在 RPT-* 的 record-ref（含 required 边）照常提交', () => {
    const w = open('g21-b');
    try {
      const oid = w.uow(ADMIN, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } })) as ObjectOid;
      const rep = submit(w, oid);
      expect(refusalOf(() => w.uow(ADMIN, (tx) => tx.linkRef({
        from: { kind: 'revision-ref', oid, revision: 1 }, to: { kind: 'record-ref', recordId: rep.reportId },
        role: 'attested-by', required: true,
      })))).toBe('NO_REFUSAL');
      const audit = w.kernel.auditRequiredIntegrity();
      expect(audit.violations).toEqual([]);
    } finally { w.close(); }
  });

  test('G21-C 存在性负例：空空间与已占用空间对同一 RPT- 声明给出同码同形拒绝——拒绝不回答「这个 id 在不在」', () => {
    const w1 = open('g21-c1');
    let detail1: unknown;
    try {
      try { w1.uow(NOBODY, (tx) => tx.declareRecord({ recordId: 'RPT-1', eventType: 'ext.g21', payload: {} })); }
      catch (e) { if (e instanceof Refusal) detail1 = e.detail; }
    } finally { w1.close(); }
    const w2 = open('g21-c2', 'SP-G21B');
    let code2 = ''; let detail2: unknown;
    try {
      const oid = w2.uow(ADMIN, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } })) as ObjectOid;
      submit(w2, oid); // 现在 RPT-<seq> 里至少有一个真实报告（seq=2：1 是 createObject）
      const head = w2.ledgerHead();
      try { w2.uow(NOBODY, (tx) => tx.declareRecord({ recordId: `RPT-${head}`, eventType: 'ext.g21', payload: {} })); }
      catch (e) { if (e instanceof Refusal) { code2 = e.code; detail2 = e.detail; } }
    } finally { w2.close(); }
    expect(code2).toBe('RECORD_ID_RESERVED');
    // detail 形状与内容都不含存在性判定（只回显输入与前缀）
    expect(detail1).toEqual({ recordId: 'RPT-1', prefix: 'RPT-', reason: (detail1 as { reason: string }).reason });
    expect((detail2 as { prefix: string }).prefix).toBe('RPT-');
    expect(Object.keys(detail2 as object).sort()).toEqual(Object.keys(detail1 as object).sort());
  });
});
