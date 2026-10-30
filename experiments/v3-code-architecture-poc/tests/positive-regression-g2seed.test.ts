/**
 * 正向零失败回归面（第五轮裁定第④点的「第二半」：正式门禁逐步采用
 * 「修复后的安全行为应当 PASS」的独立回归，让正式 CI 最终恢复**普通零失败判据**，
 * 而不必永久维护「33 条失败才算正确」的特殊系统）。
 *
 * 本文件是 **G2 正式 CI 的种子清单**（刻意 10 条、不求大而全）：每条从「已修」的红队用例
 * 翻出一条正向断言，注释按 `原红队用例名 ↔ 出处` 双钉（报告小节 + 用例名）；与既有
 * `tests/g5a-*` / `tests/d23-tx-lifecycle.test.ts` 的镜像**刻意重复**——那批文件钉的是
 * 「攻击面逐形」，本文件钉的是「哪些行为已成为普通回归」，CI 迁移时以本文件为搬迁清单。
 * 对照表（回报同款）：
 *   P1/P2/P3 ← g1a-regression `D-23 装配路径/领域路径/后果锁`（RE-REVIEW-G1-A.md §②、READINESS D-23 行）
 *   P4       ← G27-A 五个审计名 mint（RE-REVIEW-G5-A.md §②新洞1、附录 A）
 *   P5/P6    ← G6B-D31-1 移交删参 + 停用闸（RE-REVIEW-G6-A.md §① D-31 行、附录 A.2）
 *   P7       ← G24-A 三读面一致（RE-REVIEW-G5-A.md §②C3 行、附录 A）+ G6B-D31-3 遮蔽计数面（G6-A A.2）
 *   P8       ← G21-A RPT- 预占（RE-REVIEW-G5-A.md §②D-21 行、附录 A）
 *   P9       ← G5-A 新洞2 关闸形 + G6A-A5-2 写副作用形（RE-REVIEW-G5-A.md §②新洞2、RE-REVIEW-G6-A.md §①#14）
 *   P10      ← ST-A/F5b 水位判据进打开路径（RE-REVIEW-G5-A.md 附录 A①、READINESS 包 6 段）
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { POC_DATA_DIR } from '../src/harness/paths.ts';
import { openWorld, PRINCIPAL, type World } from '../src/harness/world.ts';
import { readAsOf } from '../src/kernel/read-context.ts';
import { TEST_OBJECT_MODEL, CAP_OBJECT_MODEL } from '../src/domains/test-object-model.ts';
import { TEST_RECORDS, CAP_RECORDS } from '../src/domains/test-records.ts';
import { type ObjectOid, type ReadContextSpec } from '../src/contracts/index.ts';

const ADM = PRINCIPAL('g2seed-admin');
const NOBODY = PRINCIPAL('g2seed-nobody');
const OTHER = PRINCIPAL('g2seed-other');
const GRANTS = {
  'g2seed-admin': ['space-write', 'capability-admin'],
  'g2seed-nobody': ['space-write'],
  'g2seed-other': ['space-write'],
};
let dir: string;
beforeAll(() => { dir = mkdtempSync(join(POC_DATA_DIR, 'g2seed-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

const open = (name: string): World =>
  openWorld({ file: join(dir, `${name}.db`), space: 'SP-G2SEED', grants: GRANTS,
    plugins: [TEST_OBJECT_MODEL, TEST_RECORDS] });
const code = (fn: () => unknown): string => {
  try { fn(); return 'NO_REFUSAL'; }
  catch (e) {
    const c = (e as { code?: unknown })?.code;
    return typeof c === 'string' ? c : `OTHER:${e instanceof Error ? e.constructor.name : String(e)}`;
  }
};

describe('G2 正式 CI 种子：已修机制的正向零失败回归（每条注明原红队用例 + 报告小节）', () => {
  test('P1 提交后的旧事务句柄写必被拒 TX_CLOSED 且库面零迟到', () => {
    // 原红队用例：g1a-regression.test.ts「D-23 装配路径」（RE-REVIEW-G1-A.md §②，修前红）。
    const w = open('p1');
    try {
      let stale: import('../src/kernel/kernel.ts').UnitOfWork | undefined;
      const oid = w.uow(ADM, (tx) => { stale = tx; return tx.createObject({ kind: 'test.claim', payload: { v: 1 } }); });
      expect(code(() => stale!.revise(oid, { payload: { late: 1 } }))).toBe('TX_CLOSED');
      expect(w.readObject(oid)!.revision).toBe(1);
    } finally { w.close(); }
  });

  test('P2 领域路径：uowFor 被扣住的 scoped 句柄在回调返回后同样 TX_CLOSED', () => {
    // 原红队用例：g1a-regression.test.ts「D-23 领域路径」（RE-REVIEW-G1-A.md §②，修前红）。
    const w = open('p2');
    try {
      let staleScoped: import('../src/kernel/kernel.ts').UnitOfWork | undefined;
      w.uowFor(CAP_OBJECT_MODEL, ADM, (tx) => { staleScoped = tx; });
      expect(code(() => staleScoped!.createObject({ kind: 'test.claim', payload: {} }))).toBe('TX_CLOSED');
    } finally { w.close(); }
  });

  test('P3 后果锁：存量悬空 required 边不阻塞无关主体的合法提交，巡检如实报告它', () => {
    // 原红队用例：g1a-regression.test.ts「D-23 后果锁」（RE-REVIEW-G1-A.md §②；
    // 修前 = 一条历史损坏永久阻塞整个空间）。
    const w = open('p3');
    try {
      const o = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: {} }));
      w.raw.run(
        `insert into ref_edge(from_oid, from_rev, to_oid, to_rev, to_record, role, required) values(?,?,?,?,?,?,?)`,
        o, 1, null, null, 'REC-G2SEED-NEVER', 'g2seed-legacy', 1,
      );
      expect(code(() => w.uow(OTHER, (tx) => tx.createObject({ kind: 'test.claim', payload: { i: 1 } }))))
        .toBe('NO_REFUSAL');
      const audit = w.kernel.auditRequiredIntegrity();
      expect(audit.violations.some((x) => (x.detail as { to?: unknown }).to === 'REC-G2SEED-NEVER')).toBe(true);
    } finally { w.close(); }
  });

  test('P4 五个机制审计事件名进预留通道：只有 space-write 的主体 mint 全拒（EVENT_AUTHORITY_REQUIRED）', () => {
    // 原红队用例：G27-A（RE-REVIEW-G5-A.md §②新洞1、附录 A；修前五个名全部 mint 成功）。
    const FIVE = ['capability-enabled', 'capability-disabled', 'capability-transferred',
      'object-registered', 'check-report-recorded'];
    const w = open('p4');
    try {
      for (const et of FIVE) {
        expect(code(() => w.uow(NOBODY, (tx) =>
          tx.appendLedger({ eventType: et, payload: { capability: CAP_RECORDS } }))), et)
          .toBe('EVENT_AUTHORITY_REQUIRED');
      }
      // 正例不回归：普通事件名照常。
      expect(code(() => w.uow(NOBODY, (tx) => tx.appendLedger({ eventType: 'g2seed.plain', payload: {} }))))
        .toBe('NO_REFUSAL');
    } finally { w.close(); }
  });

  test('P5 移交入口已删参：合法移交成功且 route.ns 一字不动（ns 已不可能经移交写出）', () => {
    // 原红队用例：G6B-D31-1 前半（RE-REVIEW-G6-A.md §① D-31 行、附录 A.2；修前 ns 随移交漂移）。
    const w = open('p5');
    try {
      w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 'real' } }));
      expect(code(() => w.transferCapability(
        CAP_OBJECT_MODEL, { ...TEST_OBJECT_MODEL, pluginId: 'test.object-model.g2seed' }, ADM,
      ))).toBe('NO_REFUSAL');
      const route = w.raw.get<{ ns: string; plugin_id: string }>(
        `select ns, plugin_id from capability_route where capability=?`, CAP_OBJECT_MODEL)!;
      expect(route.ns).toBe('dom_test_om'); // 删参后 ns 无处可传 ⇒ 漂移通道关闭（入口面）
      expect(route.plugin_id).toBe('test.object-model.g2seed');
    } finally { w.close(); }
  });

  test('P6 停用中的能力移交被闸住（CAPABILITY_INACTIVE），不产生半成品', () => {
    // 原红队用例：G6B-D31-1 后半（RE-REVIEW-G6-A.md 附录 A.2「EVIDENCE ⑤ 未覆盖组合钉齐」）。
    const w = open('p6');
    try {
      w.unloadCapability(CAP_OBJECT_MODEL, ADM);
      const head0 = w.ledgerHead();
      expect(code(() => w.transferCapability(
        CAP_OBJECT_MODEL, { ...TEST_OBJECT_MODEL, pluginId: 'test.om.v3' }, ADM,
      ))).toBe('CAPABILITY_INACTIVE');
      expect(w.ledgerHead()).toBe(head0); // 零半成品：台账一字未动
    } finally { w.close(); }
  });

  test('P7 三读面同一时刻同一答案：ns 投毒行经扫描面剔除且计数可归因', () => {
    // 原红队用例：G24-A（RE-REVIEW-G5-A.md §②C3 行、附录 A；修前 readAsOf 以他人对象之名端出
    // 攻击者 payload）+ G6B-D31-3 遮蔽计数面（RE-REVIEW-G6-A.md 附录 A.2，包 6 修）。
    const w = open('p7');
    try {
      const victim = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 'real' } })) as ObjectOid;
      w.uow(ADM, (tx) => w.writerOf(CAP_RECORDS, tx).write(
        { ns: 'dom_test_records', oid: victim, revision: 99, payload: { evil: true }, eventType: 'ext.g2seed' }));
      const ctx = { space: w.kernel.space, principal: ADM, mode: 'as-recorded', consistency: 'required' } as ReadContextSpec;
      const scan = readAsOf(w.kernel, ctx);
      const rows = scan.rows.filter((r) => r.oid === victim);
      expect(rows.map((r) => r.payload)).toEqual([{ v: 'real' }]);
      expect(scan.echo.hiddenByContractSkew).toBe(1);
      expect(w.readObject(victim)!.payload).toEqual({ v: 'real' });
    } finally { w.close(); }
  });

  test('P8 报告保留前缀 RPT- 预占被拒（RECORD_ID_RESERVED）且零半成品，合法滚动照常', () => {
    // 原红队用例：G21-A（RE-REVIEW-G5-A.md §②D-21 行、附录 A；修前一条预占 id 让报告落账持续 DoS）。
    const w = open('p8');
    try {
      const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } })) as ObjectOid;
      const head = w.ledgerHead();
      expect(code(() => w.uow(ADM, (tx) => tx.declareRecord(
        { recordId: `RPT-${head + 2}`, eventType: 'ext.g2seed.preempt', payload: {} }))))
        .toBe('RECORD_ID_RESERVED');
      expect(w.ledgerHead()).toBe(head); // 入口拒在落账之前：零半成品
      expect(w.readRecord(`RPT-${head + 2}`)).toBeUndefined();
      const first = w.uow(ADM, (tx) => tx.recordReport({
        target: { kind: 'revision-ref', oid, revision: 1 },
        validatorId: 'v.g2seed', ruleVersion: 'r1', schemaVersion: 's1', environment: 'test',
        executedAt: 1, guaranteeScope: 'unit', verdict: 'PASS', findings: [], declaredGaps: [],
      }));
      expect(first.reportId).toBe(`RPT-${first.seq}`); // 合法滚动不受影响
    } finally { w.close(); }
  });

  test('P9 经 Port 交出的句柄关不掉存储不变量：PRAGMA 赋值形与无参写副作用形全拒', () => {
    // 原红队用例：G5-A 新洞2（RE-REVIEW-G5-A.md §②新洞2；修前 `recursive_triggers=off` 一条
    // 拆掉全部 REPLACE 系防线）+ G6A-A5-2（RE-REVIEW-G6-A.md §①#14；修前 optimize/
    // wal_checkpoint 按「裸读」放行——本轮 F-G6A-1 收紧，全矩阵见 tests/g6a-pragma-whitelist.test.ts）。
    const w = open('p9');
    try {
      // 先造一条真台账行（原 G6A-A5-2 同形——否则 DELETE 空转不触发行级触发器）。
      w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } }));
      expect(code(() => w.raw.run(`pragma recursive_triggers = off`))).toContain('RAW_SQL_REFUSED');
      expect(code(() => w.raw.all(`pragma optimize`))).toContain('RAW_SQL_REFUSED');
      expect(code(() => w.raw.all(`pragma wal_checkpoint`))).toContain('RAW_SQL_REFUSED');
      expect(w.raw.get<{ recursive_triggers: number }>(`pragma recursive_triggers`)!.recursive_triggers).toBe(1);
      // 触发器拒语在驱动 message 里（code() 只到 ERR_SQLITE_ERROR 层，此处按原用例读消息体）。
      let delMsg = '';
      try { w.raw.run(`delete from ledger where seq=1`); } catch (e) { delMsg = String((e as Error).message); }
      expect(delMsg).toContain('HISTORY_IMMUTABLE');
    } finally { w.close(); }
  });

  test('P10 水位判据进打开路径：外路归零 ledger_seq 的库重开即拒；正常库重开照旧绿', () => {
    // 原红队用例：ST-A（F5b，RE-REVIEW-G5-A.md 附录 A①；修前归零水位重开无声通过）。
    const w = open('p10');
    const file = join(dir, 'p10.db');
    try { w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } })); } finally { w.close(); }
    const db = new DatabaseSync(file);
    try { db.exec(`replace into meta(key, value) values('ledger_seq', 0)`); } finally { db.close(); }
    expect(code(() => openWorld({ file, space: 'SP-G2SEED', grants: GRANTS,
      plugins: [TEST_OBJECT_MODEL, TEST_RECORDS] }))).toBe('SCHEMA_UPGRADE_REQUIRED');
    // 正例锚：同构造不破坏 ⇒ 正常重开绿（判据不是恒红门槛）。
    expect(code(() => { const ok = open('p10-ok'); ok.close(); })).toBe('NO_REFUSAL');
  });
});
