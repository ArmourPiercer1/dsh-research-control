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
export const SCHEMA_VERSION = 2;
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
    if (missingTables.length > 0 || missingTriggers.length > 0) {
      // 版本对得上但表/触发器缺失：不可变性可能已被拆除，静默补齐等于假装它一直在
      throw new Refusal('SCHEMA_UPGRADE_REQUIRED', {
        file: this.file, reason: '版本一致但表集/触发器集不完整', missingTables, missingTriggers,
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
