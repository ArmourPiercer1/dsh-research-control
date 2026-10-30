/**
 * 存储不变量补漏（包 6，席位 G5-A 反审 F5 族，附录 A 移植）：
 * ① 打开路径水位判据 `max(ledger.seq) ≤ meta.ledger_seq`（F5b 重开形）；
 * ② 会话内水位被外路归零后的机制提交：**裸驱动文本包装成机制码** `LEDGER_SEQ_CONFLICT`
 *    （违例「驱动词汇不得越过 Storage Port 边界」在 READINESS 登记后被修掉）；
 * ③ 必备触发器从**名字比对**升级为**名字 + SQL 体摘要**（F5c 同名空壳形）；
 * ④ `port.raw` 二选一裁决 = **守卫**：PRAGMA 赋值形 / DDL / 多语句拒，DML 与 PRAGMA 裸读形
 *    放行（G5-A 新洞2：一条 `pragma recursive_triggers=off` 拆掉全部 REPLACE 系防线）。
 * ①–③ 的破坏面一律用**手工裸连接**构造——这是如实的：那正是承诺外域，本包修的是
 * 「域外破坏域内不可检出/不可归因」，不是把裸文件拉回承诺内。
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { POC_DATA_DIR } from '../src/harness/paths.ts';
import { openWorld, PRINCIPAL, type World } from '../src/harness/world.ts';
import { TEST_OBJECT_MODEL } from '../src/domains/test-object-model.ts';
import { Refusal } from '../src/contracts/index.ts';

const ADMIN = PRINCIPAL('sto-admin');
const GRANTS = { 'sto-admin': ['space-write', 'capability-admin'] };
let dir: string;
beforeAll(() => { dir = mkdtempSync(join(POC_DATA_DIR, 'g5a-storage-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

const file = (n: string): string => join(dir, `${n}.db`);
const open = (n: string): World =>
  openWorld({ file: file(n), space: 'SP-STO', grants: GRANTS, plugins: [TEST_OBJECT_MODEL] });
const refusalOf = (fn: () => unknown): { code: string; detail: Record<string, unknown> } => {
  try { fn(); return { code: 'NO_REFUSAL', detail: {} }; }
  catch (e) {
    if (e instanceof Refusal) return { code: e.code, detail: e.detail as Record<string, unknown> };
    return { code: 'BARE_ERROR', detail: { message: String((e as Error).message).slice(0, 80) } };
  }
};
/** 承诺外域的执行器：手工裸连接（默认 recursive_triggers=OFF，REPLACE 绕 DELETE 触发器）。 */
const outside = (n: string, fn: (db: DatabaseSync) => void): void => {
  const db = new DatabaseSync(file(n));
  try { fn(db); } finally { db.close(); }
};

describe('① F5b（移植）：水位判据进打开路径——归零的 ledger_seq 重开必须红', () => {
  test('ST-A 裸连接 REPLACE 归零 ledger_seq ⇒ 重开 SCHEMA_UPGRADE_REQUIRED（detail 给出水位与台账最大值）；正例：正常重开照旧绿', () => {
    const w = open('st-a');
    try { w.uow(ADMIN, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } })); } finally { w.close(); }
    outside('st-a', (db) => { db.exec(`replace into meta(key, value) values('ledger_seq', 0)`); });
    const r = refusalOf(() => open('st-a'));
    expect(r.code).toBe('SCHEMA_UPGRADE_REQUIRED');
    expect(r.detail.ledgerMaxSeq).toBe(1);
    expect(r.detail.ledgerSeqWatermark).toBe(0);
    // 正例锚：同构造但不破坏 ⇒ 重开绿（判据不是恒红门槛）
    const w2 = open('st-b');
    try { w2.uow(ADMIN, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } })); } finally { w2.close(); }
    expect(refusalOf(() => open('st-b')).code).toBe('NO_REFUSAL');
  });

  test('ST-B 会话内归零后的机制提交 ⇒ LEDGER_SEQ_CONFLICT（修前：裸驱动文本 UNIQUE constraint failed 越界）；不可重试', () => {
    const w = open('st-c');
    try {
      w.uow(ADMIN, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } }));
      outside('st-c', (db) => { db.exec(`replace into meta(key, value) values('ledger_seq', 0)`); });
      const r = refusalOf(() => w.uow(ADMIN, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 2 } })));
      expect(r.code, '驱动词汇不得越过 Storage Port 边界').toBe('LEDGER_SEQ_CONFLICT');
      expect(r.detail.retryable, '重试只会再撞同一号——修复是运维动作').toBe(false);
      expect(String(r.detail.driverMessage)).toContain('ledger.seq'); // 驱动文本只作 detail 证据
      // 不泄漏跨空间存在性：detail 不含任何对象/空间数据（只回显驱动证据）
      expect(Object.keys(r.detail).sort()).toEqual(['driverErrcode', 'driverMessage', 'reason', 'retryable']);
    } finally { w.close(); }
  });
});

describe('② F5c（移植）：必备触发器核 SQL 体摘要——同名空壳重开必须红', () => {
  test('ST-C drop + 同名空壳重建 ⇒ 重开 SCHEMA_UPGRADE_REQUIRED（alteredTriggers 点名）；缺名判据仍优先于改体', () => {
    const w = open('st-d');
    try { w.uow(ADMIN, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } })); } finally { w.close(); }
    outside('st-d', (db) => {
      db.exec(`drop trigger ledger_no_delete;
               create trigger ledger_no_delete before delete on ledger begin select 1; end;`);
    });
    const r = refusalOf(() => open('st-d'));
    expect(r.code).toBe('SCHEMA_UPGRADE_REQUIRED');
    expect((r.detail.alteredTriggers as string[])).toContain('ledger_no_delete');
    // 空壳在名字判据下隐形（这正是升级的原因）——名字集合本身确实在位：
    const names = new DatabaseSync(file('st-d'));
    try {
      expect(names.prepare(`select count(*) c from sqlite_master where type='trigger' and name='ledger_no_delete'`)
        .get()).toEqual({ c: 1 });
    } finally { names.close(); }
  });

  test('ST-E 摘要判据自证（复核要求「改一个字必红」）：`<`→`>` 一字翻转 ⇒ 同体 A/B 证明保护当场被掏空（原体减记撞 abort、翻体减记放行），重开必红点名；同体异形（只改换行缩进）不误伤', () => {
    // ① 掏空证明（st-f2，A/B 同文件）：原始体下减记 meta 撞 abort（D29-1 同形，此处作本例对照）；
    //    把 `when new.value < old.value` 改成 `when new.value > old.value`——**只差一个字符**，
    //    名字、头部、排版全同，名字判据看到的仍是「那条触发器在位」，减记却直接放行。
    const wf2 = open('st-f2');
    try { wf2.uow(ADMIN, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } })); } finally { wf2.close(); }
    const sub = (db: DatabaseSync): string => {
      try { db.exec(`update meta set value = 0 where key='ledger_seq'`); return 'NO_REFUSAL'; }
      catch (e) { return String((e as Error).message).includes('META_COUNTER_MONOTONICITY') ? 'ABORT' : 'OTHER'; }
    };
    outside('st-f2', (db) => { expect(sub(db)).toBe('ABORT'); });
    outside('st-f2', (db) => {
      db.exec(`drop trigger meta_counter_monotonic;
        CREATE TRIGGER meta_counter_monotonic before update on meta
        for each row when new.value > old.value
        begin select raise(abort, 'META_COUNTER_MONOTONICITY'); end;`);
      expect(sub(db)).toBe('NO_REFUSAL'); // 保护已被一个字掏空——这正是要摘要判据的理由
    });
    // ② 必红证明（st-f，数据面不动，让重开走到摘要判据）：同一个一字之差的体 ⇒ 点名。
    open('st-f').close();
    outside('st-f', (db) => {
      db.exec(`drop trigger meta_counter_monotonic;
        CREATE TRIGGER meta_counter_monotonic before update on meta
        for each row when new.value > old.value
        begin select raise(abort, 'META_COUNTER_MONOTONICITY'); end;`);
    });
    const r = refusalOf(() => open('st-f'));
    expect(r.code).toBe('SCHEMA_UPGRADE_REQUIRED');
    expect(r.detail.alteredTriggers as string[]).toContain('meta_counter_monotonic');
    // ③ 不误伤：同体异形——token 流一字不差、只重排换行缩进 ⇒ 归一化后同摘要，重开照常绿。
    open('st-g').close();
    outside('st-g', (db) => {
      db.exec(`drop trigger meta_ledger_seq_no_delete;
        CREATE TRIGGER meta_ledger_seq_no_delete before delete on meta
          for each row when old.key = 'ledger_seq'
          begin select raise(abort, 'META_COUNTER_MONOTONICITY');
          end;`);
    });
    expect(refusalOf(() => open('st-g')).code).toBe('NO_REFUSAL');
  });
});

describe('③ G5-A 新洞2（移植）：port.raw 守卫——经 Port 交出的句柄关不掉不变量', () => {
  test('ST-D raw 三分法逐形钉死：DDL/PRAGMA 赋值形/函数形/多语句拒；裸读形、DML（照撞触发器）、事务控制放行；无事务 rollback 驱动原文越界（残余为实）', () => {
    const w = open('st-e');
    try {
      const oid = w.uow(ADMIN, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } }));
      // 修前：这一条把连接态 recursive_triggers 关掉，此后一切 REPLACE 静默摘 DELETE 触发器
      const off = refusalOf(() => w.raw.run(`pragma recursive_triggers = off`));
      expect(off.code).toBe('RAW_SQL_REFUSED');
      expect(w.raw.get<{ recursive_triggers: number }>(`pragma recursive_triggers`)!.recursive_triggers)
        .toBe(1); // 裸读形放行且状态未变（既有绿锚 n9 用的正是这个形态）
      // DDL 也拒（drop trigger 是这条防线最直白的拆法）
      expect(refusalOf(() => w.raw.run(`drop trigger ledger_no_delete`)).code).toBe('RAW_SQL_REFUSED');
      expect(refusalOf(() => w.raw.run(`select 1; select 2`)).code).toBe('RAW_SQL_REFUSED');
      // PRAGMA 函数调用形与赋值形一并拒（词法不可辨，误杀方向登记）；纯读改写为 SELECT 放行
      expect(refusalOf(() => w.raw.all(`pragma table_info(ledger)`)).code).toBe('RAW_SQL_REFUSED');
      expect(Array.isArray(w.raw.all(`select * from pragma_table_info('ledger')`))).toBe(true);
      // DML **不截胡**：REPLACE 放行到触发器受拒——「触发器不豁免写形」的既有锚保持
      let msg = 'NO_REFUSAL';
      try {
        w.raw.run(
          `replace into ledger(seq, space, event_type, actor, payload_json, recorded_at) values(1,'SP-STO','x','y','{}',0)`,
        );
      } catch (e) { msg = String((e as Error).message); }
      expect(msg).toContain('HISTORY_IMMUTABLE');
      // 事务控制**放行**（p1 第二连接写锁锚所赖；界外在自己连接上开合，不新增绕触发器通道）
      w.raw.run(`begin immediate`);
      w.raw.run(`commit`);
      // 残余为实：无事务的 rollback 以**驱动错误原文**越界——raw 是唯一不做驱动词汇翻译的面
      expect(refusalOf(() => w.raw.run(`rollback`)).code).toBe('BARE_ERROR');
      // 机制面自身（tx 句柄）的词法守卫不受影响（同文件既有锚 D30 族）
      expect(oid).toBeTruthy();
    } finally { w.close(); }
  });
});
