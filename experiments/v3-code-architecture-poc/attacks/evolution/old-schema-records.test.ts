/**
 * 演化轴攻击 1（第 3 轮后重构）—— 模式演进：pre-F-13 旧库在**打开路径**上的可判定性。
 *
 * 第 3 轮（HEAD 2284a99）把原来的"静默接受旧库→静默错答"路径改为打开期
 * fail-loud：`meta.schema_version` 标记 + 表集/触发器集校验 + OID 计数器一致性
 * + 历史遗留声明检出，一律 `SCHEMA_UPGRADE_REQUIRED`（封闭集），修复交显式迁移器
 * `migrateLegacyRecords`（打开路径一个字节不写，F-15 同一条纪律）。
 *
 * 本文件现在检验的是**修复后的契约**（通过 = 守卫，失败 = 回归）：
 *  - 未标记旧库（无 schema_version）⇒ 可判定拒绝，detail 给出缺表/缺触发器/期望版本；
 *  - 模式新 / 历史旧（records 出现前的声明只活在 ledger）⇒ 检出 + 迁移提示；
 *  - 计数器落后于已冻结对象 ⇒ 检出（不等到写入时以驱动主键冲突冒头）；
 *  - 计数器**超前** ⇒ 不得误拒（判据要精确，不能把合法库判成坏库）；
 *  - 多缺陷叠加 ⇒ 仍然是一次可判定拒绝，不是崩溃/裸驱动错误；
 *  - 显式迁移器闭环：回填后打开通过，且 `declared_seq` 给出真实的声明截点
 *    （#4 历史可解释性的记录面答案：截点落在"表还不存在"的年代 ⇒ 迁移前
 *    打开期可判定拒绝，迁移后 declared_seq 让年代可回放）。
 */
import { describe, expect, test } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../../src/harness/paths.ts';
import { openWorld, PRINCIPAL } from '../../src/harness/world.ts';
import { migrateLegacyRecords, SCHEMA_VERSION } from '../../src/storage-sqlite/sqlite-port.ts';
import { Refusal } from '../../src/contracts/index.ts';

const ALICE = PRINCIPAL('alice');
const GRANTS = { alice: ['space-write'] };

/**
 * 造"真旧版本库"（测试装配）：无 schema_version 标记；缺 records / capability_route /
 * projection_state；历史里有一条只在 ledger 声明过的记录 REC-OLD（seq=3）+ 指向它的
 * 必需引用边；meta 只有 ledger_seq（缺 id_counter 键）。
 */
function buildV1EraDb(file: string, space: string): void {
  const db = new DatabaseSync(file);
  db.exec(`
    pragma journal_mode = wal;
    create table meta(key text primary key, value integer not null);
    insert into meta(key, value) values('ledger_seq', 4);

    create table ledger(
      seq integer primary key, space text not null, event_type text not null,
      actor text, object_id text, revision integer, record_id text,
      payload_json text not null, described_at integer, recorded_at integer not null
    );
    create trigger ledger_no_update before update on ledger
    begin select raise(abort, 'HISTORY_IMMUTABLE'); end;
    create trigger ledger_no_delete before delete on ledger
    begin select raise(abort, 'HISTORY_IMMUTABLE'); end;

    create table object_directory(
      oid text primary key, space text not null, kind text not null,
      owner_capability text not null, ns text not null, created_seq integer not null
    );
    create trigger directory_no_update before update on object_directory
    begin select raise(abort, 'DIRECTORY_IDENTITY_FROZEN'); end;

    create table domain_state(
      ns text not null, oid text not null, revision integer not null,
      payload_json text not null, recorded_seq integer not null,
      primary key(ns, oid, revision)
    );

    create table journal(
      seq integer primary key autoincrement, tx_epoch integer not null,
      ns text, oid text, op text not null, payload_json text
    );
    create table projection_cursor(
      projection text primary key, journal_seq integer not null,
      authority_seq integer, status text not null
    );
    create table ref_edge(
      from_oid text not null, from_rev integer not null,
      to_oid text, to_rev integer, to_record text,
      role text not null, required integer not null default 0,
      primary key(from_oid, from_rev, role, to_oid, to_record)
    );
    create table check_report(
      report_id text primary key, target_kind text not null, target_oid text, target_rev integer,
      target_record text, validator_id text not null, rule_version text not null, schema_version text not null,
      environment text not null, executed_at integer not null, guarantee_scope text not null,
      verdict text not null, findings_json text not null, declared_gaps_json text not null,
      recorded_seq integer not null
    );
    create trigger check_report_no_update before update on check_report
    begin select raise(abort, 'CHECK_REPORT_IMMUTABLE'); end;
    create trigger check_report_no_delete before delete on check_report
    begin select raise(abort, 'CHECK_REPORT_IMMUTABLE'); end;

    insert into object_directory(oid, space, kind, owner_capability, ns, created_seq)
      values('OBJ-${space}-1', '${space}', 'test.claim', 'cap.test.object-model', 'dom_test_om', 1);
    insert into domain_state(ns, oid, revision, payload_json, recorded_seq)
      values('dom_test_om', 'OBJ-${space}-1', 1, '{"v":"old"}', 1);
    insert into ledger(seq, space, event_type, actor, object_id, revision, record_id, payload_json, described_at, recorded_at)
      values(1, '${space}', 'object-registered', 'alice', 'OBJ-${space}-1', 1, null, '{}', null, 1000);
    insert into ledger(seq, space, event_type, actor, object_id, revision, record_id, payload_json, described_at, recorded_at)
      values(2, '${space}', 'object-revised', 'alice', 'OBJ-${space}-1', 1, null, '{}', null, 1001);
    insert into ledger(seq, space, event_type, actor, object_id, revision, record_id, payload_json, described_at, recorded_at)
      values(3, '${space}', 'synth:raw-intake', 'alice', null, null, 'REC-OLD', '{"text":"material","sourceRef":"src"}', null, 1002);
    insert into ledger(seq, space, event_type, actor, object_id, revision, record_id, payload_json, described_at, recorded_at)
      values(4, '${space}', 'synth:objectified', 'alice', null, null, 'REC-OLD', '{}', null, 1003);
    insert into ref_edge(from_oid, from_rev, to_oid, to_rev, to_record, role, required)
      values('OBJ-${space}-1', 1, null, null, 'REC-OLD', 'synth:derived-from', 1);
  `);
  db.close();
}

/** 经机制建好当前模式库，关闭后用裸 SQL 做定向破坏（破坏 = 测试装配，非机制出口）。 */
function tamperedV3(prefix: string, space: string, tamper: (raw: DatabaseSync) => void) {
  const dir = mkdtempSync(join(POC_DATA_DIR, prefix));
  const file = join(dir, 'old.db');
  const w = openWorld({ file, space, grants: GRANTS });
  w.close();
  const raw = new DatabaseSync(file);
  tamper(raw);
  raw.close();
  return { dir, file };
}

describe('evolution attacks: pre-migration DBs must be decidable at the open path (post round-3 contract)', () => {
  test('unmarked v1-era DB: open must be a decidable refusal with migration-relevant detail, not silent acceptance', () => {
    const dir = mkdtempSync(join(POC_DATA_DIR, 'evolution-v1era-open-'));
    const file = join(dir, 'v1era.db');
    try {
      buildV1EraDb(file, 'SP-V1');
      let thrown: unknown;
      try { openWorld({ file, space: 'SP-V1', grants: GRANTS }); } catch (e) { thrown = e; }
      expect(thrown, '未标记旧库必须被拒绝打开（静默接受 = 后续静默错答）').toBeInstanceOf(Refusal);
      expect((thrown as Refusal).code).toBe('SCHEMA_UPGRADE_REQUIRED');
      const d = (thrown as Refusal).detail as Record<string, unknown>;
      expect((d.missingTables as string[]).join(','), 'detail 必须列出缺表（迁移器输入，不靠运维猜）').toMatch(/records/);
      expect(d.expectedVersion).toBe(SCHEMA_VERSION);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  /** 造"模式新 / 历史旧"的真实形态（S-0 之后 records 被触发器钉死，删行不可行）：
   *  旧库特征 = ledger 里有 record_id 而 records 里没有对应行。直接补这样一条 ledger 行。 */
  function appendLegacyDeclaration(file: string, space: string, recordId: string): number {
    const raw = new DatabaseSync(file);
    const seq = (raw.prepare(`select value from meta where key='ledger_seq'`).get() as { value: number }).value + 1;
    raw.prepare(`update meta set value = ? where key='ledger_seq'`).run(seq);
    raw.prepare(
      `insert into ledger(seq, space, event_type, actor, record_id, payload_json, described_at, recorded_at)
       values(?,?,?,?,?,?,?,?)`,
    ).run(seq, space, 'synth:raw-intake', 'legacy-importer', recordId,
      JSON.stringify({ text: 'material' }), null, Date.now());
    raw.close();
    return seq;
  }

  test('schema-new / history-old: a records-predating declaration must be detected at open with a migration hint', () => {
    const dir = mkdtempSync(join(POC_DATA_DIR, 'evolution-legacy-detect-'));
    const file = join(dir, 'legacy.db');
    try {
      const w = openWorld({ file, space: 'SP-LEG', grants: GRANTS });
      w.close();
      appendLegacyDeclaration(file, 'SP-LEG', 'REC-ANCIENT');

      let thrown: unknown;
      try { openWorld({ file, space: 'SP-LEG', grants: GRANTS }); } catch (e) { thrown = e; }
      expect(thrown, '模式新/历史旧的库必须在打开期检出（表集校验发现不了它）').toBeInstanceOf(Refusal);
      expect((thrown as Refusal).code).toBe('SCHEMA_UPGRADE_REQUIRED');
      const d = (thrown as Refusal).detail as Record<string, unknown>;
      expect(d.migration).toBe('migrateLegacyRecords');
      expect(d.legacyRecordCount).toBe(1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('counter behind frozen objects: decidable at open (not as a raw PK conflict at first write)', () => {
    const { dir, file } = tamperedV3('evolution-counter-behind-', 'SP-CB', (raw) => {
      raw.exec(`delete from meta where key='id_counter'`);
      raw.exec(`insert into object_directory(oid, space, kind, owner_capability, ns, created_seq)
                values('OBJ-SP-CB-1', 'SP-CB', 'test.claim', 'cap.test.object-model', 'dom_test_om', 1)`);
    });
    try {
      let thrown: unknown;
      try { openWorld({ file, space: 'SP-CB', grants: GRANTS }); } catch (e) { thrown = e; }
      expect(thrown, '计数器缺键/落后于冻结对象必须打开期可判定，不得等到 createObject 撞主键').toBeInstanceOf(Refusal);
      expect((thrown as Refusal).code).toBe('SCHEMA_UPGRADE_REQUIRED');
      const d = (thrown as Refusal).detail as Record<string, unknown>;
      expect(d.maxExistingOidSuffix).toBe(1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('false-positive probe: a counter AHEAD of the max existing OID must NOT be refused', () => {
    const { dir, file } = tamperedV3('evolution-counter-ahead-', 'SP-CA', (raw) => {
      raw.exec(`update meta set value=99 where key='id_counter'`);
    });
    try {
      const w = openWorld({ file, space: 'SP-CA', grants: GRANTS }); // 不得抛
      try {
        // 继续写入：新对象从 99+1 编号，不撞已有空间
        const oid = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { n: 1 } }));
        expect(oid).toBe('OBJ-SP-CA-100');
      } finally { w.close(); }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('multiple defects at once (unmarked + missing counter + legacy declaration) must still be ONE decidable refusal', () => {
    const dir = mkdtempSync(join(POC_DATA_DIR, 'evolution-multi-defect-'));
    const file = join(dir, 'multi.db');
    try {
      buildV1EraDb(file, 'SP-MULTI'); // 无标记 + 缺 id_counter + 缺三张表 + 遗留声明
      let thrown: unknown;
      try { openWorld({ file, space: 'SP-MULTI', grants: GRANTS }); } catch (e) { thrown = e; }
      expect(thrown, '多缺陷叠加必须是一次封闭集拒绝，不是裸驱动错误/崩溃').toBeInstanceOf(Refusal);
      expect((thrown as Refusal).code).toBe('SCHEMA_UPGRADE_REQUIRED');
      // 打开路径不得留下任何写入痕迹（F-15 纪律）：重开得到同样的拒绝
      let thrown2: unknown;
      try { openWorld({ file, space: 'SP-MULTI', grants: GRANTS }); } catch (e) { thrown2 = e; }
      expect((thrown2 as Refusal).code).toBe('SCHEMA_UPGRADE_REQUIRED');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('repair loop: migrateLegacyRecords closes the era gap, declared_seq keeps the cut-point replayable, and a required ref to the legacy record is unblocked', () => {
    const dir = mkdtempSync(join(POC_DATA_DIR, 'evolution-legacy-repair-'));
    const file = join(dir, 'repair.db');
    try {
      // 真实旧库形态：对象 + 指向"records 表出现之前声明"的必需引用。
      // 引用边由夹具直接写入（机制写面会先以 REQUIRED_REF_MISSING 拒绝它——那正是
      // 迁移前该对象"永远写不进去"的机制内表现）
      const w0 = openWorld({ file, space: 'SP-RP', grants: GRANTS });
      const oid = w0.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } }));
      w0.close();
      const declSeq = appendLegacyDeclaration(file, 'SP-RP', 'REC-ANCIENT');
      {
        const raw = new DatabaseSync(file);
        raw.prepare(
          `insert into ref_edge(from_oid, from_rev, to_oid, to_rev, to_record, role, required)
           values(?,?,?,?,?,?,?)`,
        ).run(oid, 1, null, null, 'REC-ANCIENT', 'synth:derived-from', 1);
        raw.close();
      }

      // 迁移前：打开必须可判定拒绝（不得带着"永远写不进去"的对象静默放行）
      let thrown: unknown;
      try { openWorld({ file, space: 'SP-RP', grants: GRANTS }); } catch (e) { thrown = e; }
      expect(thrown).toBeInstanceOf(Refusal);
      expect((thrown as Refusal).code).toBe('SCHEMA_UPGRADE_REQUIRED');

      // 显式迁移：回填后打开通过
      const n = migrateLegacyRecords(file);
      expect(n).toBe(1);
      const w = openWorld({ file, space: 'SP-RP', grants: GRANTS });
      try {
        const rec = w.readRecord('REC-ANCIENT');
        expect(rec, '迁移后 readRecord 必须读到回填行').toBeDefined();
        expect(rec!.payload).toMatchObject({ text: 'material' });
        // #4 截点答案：declared_seq = 原始声明的 ledger 截点（不是回填事件的新 seq），
        // "records 表还不存在"的年代因此有了可回放的边界
        expect(rec!.seq, `declared_seq=${rec!.seq} 必须等于原始声明截点 ${declSeq}（回填行是另一个 seq）`).toBe(declSeq);
        // 原本被误判 REQUIRED_REF_MISSING 写死的对象恢复可写
        expect(() => w.uow(ALICE, (tx) => tx.revise(oid, { payload: { v: 2 } }))).not.toThrow();
      } finally { w.close(); }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
