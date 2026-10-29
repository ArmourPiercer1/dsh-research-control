/**
 * Storage Port 的 SQLite 实现（#44 §4 `storage-sqlite/`、§7）。
 * 真实驱动：`node:sqlite`（本机实测 SQLite 3.53.4）。**不用内存数组假装事务。**
 *
 * 三条权威边界直接落在 DDL 上，而不是只写在注释里：
 *  - `ledger` 的 UPDATE/DELETE 被触发器 `abort` ⇒ H 不可变性由存储层强制（#44 §7.1）；
 *  - `object_directory` 的 UPDATE 被触发器 `abort` ⇒ kind/space 创建即固定（RD-01）；
 *  - `journal` 允许删除与压缩 ⇒ 它不是 H（#44 §7.4），缺口由 Kernel 的游标校验暴露。
 */
import { DatabaseSync } from 'node:sqlite';
import { Refusal } from '../contracts/index.ts';
import type { RawTx, StoragePort } from '../contracts/index.ts';
import { assertInsidePocData } from '../harness/paths.ts';

const SCHEMA = `
create table if not exists meta(key text primary key, value integer not null);
insert or ignore into meta(key, value) values('id_counter', 0), ('ledger_seq', 0);

create table if not exists ledger(
  seq           integer primary key,
  space         text not null,
  event_type    text not null,
  actor         text,
  object_id     text,
  revision      integer,
  record_id     text,
  payload_json  text not null,
  described_at  integer,
  recorded_at   integer not null
);
create trigger if not exists ledger_no_update before update on ledger
begin select raise(abort, 'HISTORY_IMMUTABLE'); end;
create trigger if not exists ledger_no_delete before delete on ledger
begin select raise(abort, 'HISTORY_IMMUTABLE'); end;

-- 路由三元组：capability + 存储命名空间 + 登记序。ns 在此**固定记录**，
-- 使"实现换包但没做迁移"在读路径上 fail-loud，而不是静默返回空（#44 §11）。
create table if not exists object_directory(
  oid text primary key, space text not null, kind text not null,
  owner_capability text not null, ns text not null, created_seq integer not null
);
create trigger if not exists directory_no_update before update on object_directory
begin select raise(abort, 'DIRECTORY_IDENTITY_FROZEN'); end;

-- Capability→实现映射与启用状态**必须持久**：内存路由无法回答"提交后崩溃/重启后谁是所有者"，
-- 也就谈不上 #44 §11 要求的"原子切换"。身份表禁改，路由表可改——这条区分是刻意的。
create table if not exists capability_route(
  capability text primary key, plugin_id text not null, ns text not null,
  contract_version text not null, enabled integer not null default 1, changed_seq integer
);

create table if not exists domain_state(
  ns text not null, oid text not null, revision integer not null,
  payload_json text not null, recorded_seq integer not null,
  -- 写入时的生效契约版本。空串只允许出现在迁移器回填之前；读面据此判断
  -- "这份 payload 的形状是不是当前读者能理解的"（F-27）。只比 ns 不比契约版本，
  -- 就会把旧实现写的形状原样交给新读取器——那是静默错答，不是兼容读取。
  contract_version text not null default '',
  primary key(ns, oid, revision)
);

create table if not exists records(
  record_id     text primary key,
  declared_seq  integer not null,
  payload_json  text not null
);

create table if not exists journal(
  seq integer primary key autoincrement, tx_epoch integer not null,
  ns text, oid text, op text not null, payload_json text
);

-- 派生索引的水位与基线：baseline 之前的 Journal 缺口已由全量重建覆盖，之后的缺口才是问题。
create table if not exists projection_state(
  name text primary key, seq integer not null, baseline integer not null, rebuilt_at integer
);

create table if not exists projection_cursor(
  projection text primary key, journal_seq integer not null,
  authority_seq integer, status text not null
);

create table if not exists ref_edge(
  from_oid text not null, from_rev integer not null,
  to_oid text, to_rev integer, to_record text,
  role text not null, required integer not null default 0,
  primary key(from_oid, from_rev, role, to_oid, to_record)
);

create table if not exists check_report(
  report_id text primary key, target_kind text not null, target_oid text, target_rev integer,
  target_record text, validator_id text not null, rule_version text not null, schema_version text not null,
  environment text not null, executed_at integer not null, guarantee_scope text not null,
  verdict text not null, findings_json text not null, declared_gaps_json text not null,
  recorded_seq integer not null
);
create trigger if not exists check_report_no_update before update on check_report
begin select raise(abort, 'CHECK_REPORT_IMMUTABLE'); end;
create trigger if not exists check_report_no_delete before delete on check_report
begin select raise(abort, 'CHECK_REPORT_IMMUTABLE'); end;
`;

/**
 * 显式迁移器：把 `records` 表之前声明的记录回填为首次声明行。
 *
 * 只回填**已有事实**（同一 record_id 取 ledger 里最早的那条），不新造语义、不改任何既有行；
 * 迁移本身是写操作，因此必须由调用方显式发起（装配根的升级步骤），不能藏在打开路径里。
 * 返回回填条数。幂等：已存在的 record_id 不动。
 */
export function migrateLegacyRecords(file: string): number {
  assertInsidePocData(file);
  const db = new DatabaseSync(file);
  try {
    db.exec('pragma busy_timeout = 2000;');
    const rows = db.prepare(
      `select l.record_id as record_id, min(l.seq) as seq, min(l.rowid) as rid
         from ledger l
        where l.record_id is not null
          and not exists (select 1 from records r where r.record_id = l.record_id)
        group by l.record_id`,
    ).all() as { record_id: string; seq: number; rid: number }[];
    if (rows.length === 0) return 0;
    db.exec('begin immediate;');
    try {
      for (const r of rows) {
        const src = db.prepare(`select space, event_type, payload_json from ledger where rowid=?`).get(r.rid) as
          { space: string; event_type: string; payload_json: string };
        db.prepare(`insert into records(record_id, declared_seq, payload_json) values(?,?,?)`)
          .run(r.record_id, r.seq, src.payload_json);
        // 迁移登记也走同一条计数器协议（meta.ledger_seq），不另造第二套序号；
        // 这样迁移后的历史仍可被 recorded_as_of 截点看见，且不会与后续提交撞号。
        const next = (db.prepare(`select value from meta where key='ledger_seq'`).get() as { value: number }).value + 1;
        db.prepare(`update meta set value = ? where key='ledger_seq'`).run(next);
        db.prepare(
          `insert into ledger(seq, space, event_type, actor, record_id, payload_json, described_at, recorded_at)
           values(?,?,?,?,?,?,?,?)`)
          .run(next, src.space, 'record-backfilled', 'migrator', r.record_id,
            JSON.stringify({ recordId: r.record_id, via: 'migrateLegacyRecords', originalSeq: r.seq, originalEventType: src.event_type }),
            null, Date.now());
        db.prepare(`insert into journal(tx_epoch, ns, oid, op) values(?,?,?,?)`)
          .run(next, src.space, `rec:${r.record_id}`, 'record-backfilled');
      }
      db.exec('commit;');
    } catch (e) {
      try { db.exec('rollback;'); } catch { /* 已隐式回滚 */ }
      throw e;
    }
    return rows.length;
  } finally { db.close(); }
}

class Adapter implements RawTx {
  constructor(private readonly db: DatabaseSync) {}
  run(sql: string, ...p: readonly unknown[]): void { this.db.prepare(sql).run(...(p as never[])); }
  all<T>(sql: string, ...p: readonly unknown[]): T[] { return this.db.prepare(sql).all(...(p as never[])) as T[]; }
  get<T>(sql: string, ...p: readonly unknown[]): T | undefined { return this.db.prepare(sql).get(...(p as never[])) as T | undefined; }
}

/**
 * 打开既有库时的**模式契约**（长期演化轴，见 REVIEW.md F-16/F-17）：
 *  1. 打开路径不得隐含一次迁移。DDL 是写操作；把 DDL 放在每次打开时执行，等于
 *     "打开旧库"悄悄变成"把旧库改成新库"：缺表被静默补上，旧数据语义却没迁过。
 *  2. 因此：空库才建表；已有库必须先过版本与表集/触发器集校验，通过后**不再执行任何 DDL**。
 *     任何分歧都 fail-loud，交显式迁移器处理。
 */
export const SCHEMA_VERSION = 3;
const REQUIRED_TABLES = [
  'meta', 'ledger', 'records', 'check_report', 'object_directory', 'domain_state',
  'journal', 'capability_route', 'projection_state', 'ref_edge',
] as const;
const REQUIRED_TRIGGERS = [
  'ledger_no_update', 'ledger_no_delete', 'check_report_no_update', 'check_report_no_delete',
  'directory_no_update',
] as const;

export interface SqlitePortOptions {
  readonly file: string;
  /** 故障注入：在本次 COMMIT 之前抛出（模拟提交阶段失败，#44 §12「跨插件暂存后失败」）。 */
  readonly failBeforeCommit?: Error;
}

export class SqlitePort implements StoragePort {
  private readonly db: DatabaseSync;
  private readonly adapter: Adapter;
  failBeforeCommit: Error | undefined;

  constructor(readonly opts: SqlitePortOptions) {
    assertInsidePocData(opts.file);
    this.db = new DatabaseSync(opts.file);
    this.db.exec('pragma journal_mode = wal;');
    this.db.exec('pragma busy_timeout = 2000;');
    this.db.exec('pragma foreign_keys = on;');
    this.assertOpenableThenPrepare();
    this.adapter = new Adapter(this.db);
    this.failBeforeCommit = opts.failBeforeCommit;
  }

  /**
   * 单事务边界：`begin immediate` 让写冲突在开始时而非提交时才暴露，但**仍**可能提交期
   * 拿不到写锁（实测 SQLITE_BUSY errcode=5，等待 busy_timeout 后失败且无部分提交）。
   */
  /**
   * 打开策略：空库 ⇒ 建表并登记版本；已有表 ⇒ 只校验、不写。
   * detail 里的 missingTables/missingTriggers/版本就是迁移器的输入，不靠运维猜。
   */
  private assertOpenableThenPrepare(): void {
    const rows = this.db.prepare(`select name, type from sqlite_master`).all() as { name: string; type: string }[];
    const tables = new Set(rows.filter((r) => r.type === 'table').map((r) => r.name));
    const triggers = new Set(rows.filter((r) => r.type === 'trigger').map((r) => r.name));
    if (tables.size === 0) {
      this.db.exec(SCHEMA);
      this.db.prepare(`insert into meta(key, value) values('schema_version', ?)
        on conflict(key) do update set value = excluded.value`).run(SCHEMA_VERSION);
      return;
    }
    const missingTables = REQUIRED_TABLES.filter((x) => !tables.has(x));
    const missingTriggers = REQUIRED_TRIGGERS.filter((x) => !triggers.has(x));
    const marked = this.db.prepare(`select value from meta where key='schema_version'`).get() as { value: number } | undefined;
    if (marked === undefined) {
      throw new Refusal('SCHEMA_UPGRADE_REQUIRED', {
        file: this.file, reason: '既有库没有模式版本标记，无法判定是否已迁移',
        missingTables, missingTriggers, expectedVersion: SCHEMA_VERSION,
      });
    }
    if (marked.value !== SCHEMA_VERSION) {
      throw new Refusal('SCHEMA_UPGRADE_REQUIRED', {
        file: this.file, reason: '模式版本与本实现不一致', foundVersion: marked.value,
        expectedVersion: SCHEMA_VERSION, missingTables, missingTriggers,
      });
    }
    // OID 计数器一致性：计数器落后于已冻结对象 ⇒ 下一次 createObject 必然撞号。
    // 不在打开时判定，就会在写入时以驱动主键冲突的形式冒出来（越界、不可判定，F-07 同族）。
    const suffixes = (this.db.prepare(`select oid from object_directory`).all() as { oid: string }[])
      .map((r) => /-(\d+)$/.exec(r.oid)?.[1]).filter((x): x is string => x !== undefined)
      .map(Number);
    const maxOid = suffixes.length > 0 ? Math.max(...suffixes) : 0;
    const counter = (this.db.prepare(`select value from meta where key='id_counter'`).get() as { value: number } | undefined)?.value ?? 0;
    if (counter < maxOid) {
      throw new Refusal('SCHEMA_UPGRADE_REQUIRED', {
        file: this.file, reason: 'OID 计数器落后于已冻结对象，继续写入必然撞号',
        idCounter: counter, maxExistingOidSuffix: maxOid, expectedVersion: SCHEMA_VERSION,
      });
    }

    if (missingTables.length > 0 || missingTriggers.length > 0) {
      // 版本对得上但表/触发器缺失：不可变性可能已被拆除，静默补齐等于假装它一直在
      throw new Refusal('SCHEMA_UPGRADE_REQUIRED', {
        file: this.file, reason: '版本一致但表集/触发器集不完整', missingTables, missingTriggers,
        expectedVersion: SCHEMA_VERSION,
      });
    }
    // 模式新但历史旧：records 表出现之前合法声明过的记录只活在 ledger.record_id 里。
    // 表集/版本校验全过，之后 readRecord 静默返回 undefined、必需 record-ref 被误判缺失。
    // 检出即拒绝，修复交显式迁移器——打开路径仍然一个字节都不写（F-15 的同一条纪律）。
    const legacy = (this.db.prepare(
      `select count(distinct l.record_id) c from ledger l
         where l.record_id is not null
           and not exists (select 1 from records r where r.record_id = l.record_id)`,
    ).get() as { c: number }).c;
    if (legacy > 0) {
      throw new Refusal('SCHEMA_UPGRADE_REQUIRED', {
        file: this.file, reason: '历史中存在 records 表之前的记录声明，需显式迁移',
        legacyRecordCount: legacy, migration: 'migrateLegacyRecords',
        expectedVersion: SCHEMA_VERSION,
      });
    }
    // 校验通过：打开路径到此为止，不执行任何 DDL
  }

  tx<T>(fn: (raw: RawTx) => T): T {
    try {
      // begin 本身也可能因写锁失败 ⇒ 必须在同一个 try 内，才能走同一条翻译路径。
      this.db.exec('begin immediate;');
      const r = fn(guard(this.adapter));
      if (this.failBeforeCommit) {
        const e = this.failBeforeCommit;
        this.failBeforeCommit = undefined;
        throw e; // 尚未 COMMIT ⇒ 下面的 ROLLBACK 生效
      }
      this.db.exec('commit;');
      return r;
    } catch (e) {
      try { this.db.exec('rollback;'); } catch { /* 已隐式回滚 */ }
      throw translate(e);   // 驱动词汇不得越过 Storage Port 边界
    }
  }

  read<T>(fn: (raw: RawTx) => T): T { return fn(guard(this.adapter)); }

  /** 供隔离/并发攻击测试使用的第二条真实连接（同文件、同 WAL）。 */
  openSecond(): SqlitePort { return new SqlitePort({ ...this.opts, file: this.file }); }

  close(): void { this.db.close(); }

  get raw(): RawTx { return this.adapter; }

  get file(): string { return this.opts.file; }
}

/**
 * 驱动错误 → 机制拒绝码。Storage Port 是**唯一**允许出现 SQLite 错误码的地方；
 * 上层拿到的必须是可判定的机制语义（含"可否重试"），而不是需要反推的驱动异常。
 */
function translate(e: unknown): unknown {
  const err = e as { errcode?: number; code?: string; message?: string };
  if (err?.errcode === 5 || err?.errcode === 6) {   // SQLITE_BUSY / SQLITE_LOCKED
    return new Refusal('TX_CONTENTION', {
      retryable: true, driverErrcode: err.errcode, driverMessage: String(err.message ?? '').slice(0, 120),
    });
  }
  return e;
}

/**
 * 机制边界上的 SQL 守卫：插件与领域服务拿到的 RawTx 只是**受限视图**。
 * 不可变性由触发器把守，而触发器本身是 DDL 可删的对象——若把未守卫的句柄交给领域，
 * "存储层保证不可变"就退化为"没人去删触发器时保证不可变"。因此 DDL / 附加库 / PRAGMA
 * 在这一层直接拒绝（纵深防御：类型面上 UnitOfWork 已不再暴露 raw）。
 */
const FORBIDDEN_KEYWORD = /^(drop|alter|create|attach|detach|pragma|vacuum|reindex|analyze)\b/i;
/**
 * 归一化后再判定：前导注释、块注释、行注释、空白与多余分号都能让锚定式正则形同虚设
 * （独立复审实测 `/* x *\/ drop trigger …` 绕过）。归一化后还要拒绝多语句，
 * 否则 `select 1; drop trigger …` 以合法关键字开头却带着 DDL。
 */
function normalizeSql(sql: string): string {
  let out = sql;
  for (;;) {
    const stripped = out
      .replace(/^\s+/, '')
      .replace(/^\/\*[\s\S]*?\*\//, '')
      .replace(/^--[^\n]*\n?/, '')
      .replace(/^;+/, '');
    if (stripped === out) break;
    out = stripped;
  }
  return out;
}
function guard(raw: RawTx): RawTx {
  const check = (sql: string): void => {
    const head = normalizeSql(sql);
    const reason = FORBIDDEN_KEYWORD.test(head) ? 'DDL/PRAGMA/ATTACH 不得经机制句柄执行'
      // 多语句：第一条合法不代表整条合法
      : /;\s*\S/.test(head) ? '不得经机制句柄提交多语句'
      : undefined;
    if (reason) {
      throw new Refusal('RAW_SQL_REFUSED', { reason, sql: sql.slice(0, 60) });
    }
  };
  return {
    get<T>(sql: string, ...p: unknown[]) { check(sql); return raw.get<T>(sql, ...p); },
    all<T>(sql: string, ...p: unknown[]) { check(sql); return raw.all<T>(sql, ...p); },
    run(sql: string, ...p: unknown[]) { check(sql); return raw.run(sql, ...p); },
  };
}
