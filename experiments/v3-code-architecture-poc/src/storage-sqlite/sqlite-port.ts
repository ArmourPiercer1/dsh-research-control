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
import { createHash } from 'node:crypto';
import { Refusal } from '../contracts/index.ts';
import type { RawTx, StoragePort } from '../contracts/index.ts';
import { assertInsidePocData } from '../harness/paths.ts';

const SCHEMA = `
create table if not exists meta(key text primary key, value integer not null);
insert or ignore into meta(key, value) values('id_counter', 0), ('ledger_seq', 0);
-- D-29（包 5，席位 G4-A G4A-N9d）：计数面只增不减。ledger_seq 是 H 单调序号的水位、
-- id_counter 是 OID 分配器、schema_version 是打开路径判据的地基——三者被「归零/下调」
-- 都会让打开校验建立在动过的地基上。归零两式（REPLACE 的隐式删除形、ON CONFLICT DO UPDATE
-- 的 UPDATE 形）分别撞下面的 DELETE/UPDATE 触发器。边界如实：前跳（ghost seq）与合法发号
-- 在触发器层不可分辨（登记于 CONTRACTS.md §16.2 包 5 存储纪律）；id_counter 键的 DELETE
-- 不拦——该形态打开期即 SCHEMA_UPGRADE_REQUIRED，属已治理的打开期形态。
create trigger if not exists meta_counter_monotonic before update on meta
for each row when new.value < old.value
begin select raise(abort, 'META_COUNTER_MONOTONICITY'); end;
create trigger if not exists meta_ledger_seq_no_delete before delete on meta
for each row when old.key = 'ledger_seq'
begin select raise(abort, 'META_COUNTER_MONOTONICITY'); end;

create table if not exists ledger(
  seq           integer primary key,
  space         text not null,
  event_type    text not null,
  actor         text,
  -- 包 3（N1，CONTRACTS.md §16.2 判据 ③）：机制授权见证的 JSON 封套（AuthorityEvidence 形状）。
  -- 仅 appendAuthoritativeEvent 写；其余写通道与历史行一律 NULL。触发器保证行不可改 ⇒ 见证
  -- 落库后连机制自己都改不动——这是「授权结论是机制事实」的存储层支点。
  authority_basis text,
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
-- D-28（包 5，席位 G4-A G4A-N9b）：RD-01 宣称「创建即固定」，修前只固定了 UPDATE 一形——
-- DELETE 抹身份行、REPLACE 整行替换（改 created_seq/owner/ns）都合法；换假 owner 后所有读
-- 路径当场 CAPABILITY_INACTIVE 且无救济。现钉死为「身份行不可改、不可删、新身份必须随账出生」。
-- **owner 一经登记不可变更**（CONTRACTS.md §16.2 包 5 存储纪律的裁定）：没有任何正当的 owner
-- 变更路径，可变列而无正当写者正是本洞根因。
create trigger if not exists directory_no_update before update on object_directory
begin select raise(abort, 'DIRECTORY_IDENTITY_FROZEN'); end;
create trigger if not exists directory_no_delete before delete on object_directory
begin select raise(abort, 'DIRECTORY_IDENTITY_FROZEN'); end;
-- 出生审计（D-28）：账本非空的空间里，新身份行必须带 seq=created_seq、object_id 相符的
-- object-registered ledger 行（kernel 对象登记的写序已改为账本先行）。
-- **账本为空的空间不参判据**：迁移器/存量库夹具形状（old-schema 攻击资产所赖），如实登记。
create trigger if not exists directory_birth_audited before insert on object_directory
for each row
when exists (select 1 from ledger)
 and not exists (
   select 1 from ledger l
    where l.seq = new.created_seq
      and l.event_type = 'object-registered'
      and l.object_id = new.oid)
begin select raise(abort, 'DIRECTORY_IDENTITY_FROZEN'); end;

-- Capability→实现映射与启用状态**必须持久**：内存路由无法回答"提交后崩溃/重启后谁是所有者"，
-- 也就谈不上 #44 §11 要求的"原子切换"。身份表禁改，路由表可改——这条区分是刻意的。
-- 包 5（D-27，席位 G4-A G4A-N9c）把「可改」收紧为「只能经审计通道改」：启停只经
-- setRouteEnabled、移交只经 transferRoute，且变更必须随审计落账。修前裸面一条
-- replace into capability_route(... enabled=1 ...) 即**零审计**复活被停用的能力。
create table if not exists capability_route(
  capability text primary key, plugin_id text not null, ns text not null,
  contract_version text not null, enabled integer not null default 1, changed_seq integer
);
-- REPLACE 在路由表全灭：隐式删除（recursive_triggers=ON，包 4）撞本触发器。
create trigger if not exists route_no_delete before delete on capability_route
begin select raise(abort, 'ROUTE_FROZEN'); end;
-- 初始登记形态钉死：INSERT 只接受 activate() 的登记形（enabled=1、无变更戳）——
-- INSERT 伪造不出「已审计」，启停/移交只能经 UPDATE 走审计面。
create trigger if not exists route_insert_guarded before insert on capability_route
for each row when new.enabled <> 1 or new.changed_seq is not null
begin select raise(abort, 'ROUTE_SHAPE_FROZEN'); end;
-- 变更三判据（机制判据，不是运维约定）：
-- ① changed_seq 严格单调递增——钉死的是「戳只能前进」，不是「戳有意义」（ghost 戳见残余登记）；
-- ② 审计随附：ledger 必须已存在 seq=new.changed_seq、事件类型合名单、payload.capability
--    字面相符、actor 非空且 authority_basis 携带 N1 同信封的机制见证（axis=capability-admin、
--    capability 字面相符、authorized=1）的行（kernel 三个写方已改为先写 ledger 后改路由；
--    BEFORE 触发器逐语句判，账必须在先）。json_valid 先行是防御：非法 JSON 的行不得让判据
--    整体炸成不透明错误。
--    **D-27 真修（G5-A 包 6，CONTRACTS.md §16.3）追加「机制落账」判据**：审计行必须
--    actor 非空且 authority_basis 携带 N1 同信封的机制见证（axis=capability-admin、
--    authorized=1）——只查形状 = 把谎言写进删不掉的表：G5-A 实测任何 space-write 主体
--    经通用台账通道 mint 的行与机制真账逐列同形（actor 本就是主体自报值），**只做名字
--    预留不核见证，攻击者用真实 actor mint 仍过闸**（席位 ③ 判据，专用用例+变异钉住）。
-- ③ 方向一致：翻 enabled 必须配 capability-enabled/disabled 的对应方向事件，改路由三元组
--    必须配 capability-transferred。
-- 诚实边界（D-27 真修后收窄但**未归零**）：kernel 两条通用台账通道已被机制审计名预留封死；
-- 裸面（port.raw DML / 裸文件）仍可向 append-only 的 H 写一条**连见证列一起伪造**
-- 的行再过闸——见证把伪造成本从「随便一行」抬到「必须在见证列撒谎」，痕迹不可删，
-- 处置归运维/审计（CONTRACTS.md §16.2 包 5 存储纪律 + §16.3 边界登记）。
create trigger if not exists route_change_guarded before update on capability_route
begin
  select case when old.changed_seq is not null
               and (new.changed_seq is null or new.changed_seq <= old.changed_seq)
          then raise(abort, 'ROUTE_CHANGED_SEQ_MONOTONICITY') end;
  select case when not exists (
      select 1 from ledger l
       where l.seq = new.changed_seq
         and l.event_type in ('capability-enabled','capability-disabled','capability-transferred')
         and l.actor is not null
         and json_valid(l.payload_json)
         and json_extract(l.payload_json, '$.capability') = new.capability
         -- D-27 真修（G5-A 包 6）：机制落账见证（N1 同信封）——无见证 / 见证不成立 = 审计行不是机制写的。
         and l.authority_basis is not null
         and json_valid(l.authority_basis)
         and json_extract(l.authority_basis, '$.axis') = 'capability-admin'
         and json_extract(l.authority_basis, '$.capability') = new.capability
         and json_extract(l.authority_basis, '$.authorized') = 1)
          then raise(abort, 'ROUTE_AUDIT_REQUIRED') end;
  select case
    when new.enabled <> old.enabled and not exists (
      select 1 from ledger l
       where l.seq = new.changed_seq
         and l.event_type = case new.enabled when 1 then 'capability-enabled' else 'capability-disabled' end)
      then raise(abort, 'ROUTE_AUDIT_REQUIRED')
    when new.enabled = old.enabled
     and (new.plugin_id <> old.plugin_id or new.ns <> old.ns or new.contract_version <> old.contract_version)
     and not exists (
      select 1 from ledger l
       where l.seq = new.changed_seq and l.event_type = 'capability-transferred')
      then raise(abort, 'ROUTE_AUDIT_REQUIRED')
  end;
end;

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

-- 追加式表在**存储层**就被钉住：Kernel 自身从不 UPDATE/DELETE 这三张表（grep 实测为零），
-- 所以放行 DML 只会留下"绕过机制就能改历史"这一条路（S-0）。
create trigger if not exists domain_state_no_update before update on domain_state
begin select raise(abort, 'DOMAIN_STATE_APPEND_ONLY'); end;
create trigger if not exists domain_state_no_delete before delete on domain_state
begin select raise(abort, 'DOMAIN_STATE_APPEND_ONLY'); end;
create trigger if not exists ref_edge_no_update before update on ref_edge
begin select raise(abort, 'REF_EDGE_FROZEN'); end;
create trigger if not exists ref_edge_no_delete before delete on ref_edge
begin select raise(abort, 'REF_EDGE_FROZEN'); end;
create trigger if not exists records_no_update before update on records
begin select raise(abort, 'RECORD_MATERIAL_IMMUTABLE'); end;
create trigger if not exists records_no_delete before delete on records
begin select raise(abort, 'RECORD_MATERIAL_IMMUTABLE'); end;
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
/**
 * v4→v5（包 3，N1）：`ledger` 新增可空列 `authority_basis`（机制授权见证）。
 * v5→v6（包 5，D-27/D-28/D-29，席位 G4-A）：新增 7 条触发器（`route_no_delete`、
 * `route_insert_guarded`、`route_change_guarded`、`directory_no_delete`、
 * `directory_birth_audited`、`meta_counter_monotonic`、`meta_ledger_seq_no_delete`）并全部
 * 纳入 `REQUIRED_TRIGGERS`——摘掉任何一条就不算同一套模式。
 * 打开路径纪律不变：既有旧库一律 `SCHEMA_UPGRADE_REQUIRED` fail-loud，不隐式迁移
 * （PoC 测试世界每次新建库、不承担 v5→v6 迁移债，同包 3 先例；实施期旧库迁移器需显式补写并登记）。
 * v6→v7（包 6，G5-A）：`route_change_guarded` 的审计存在性判据追加「机制落账」见证核
 * （actor 非空 + authority_basis 的 capability-admin 信封，D-27 真修）。触发器体变了 ⇒
 * 与 v6 库**不算同一套模式**（打开路径按名比对之外现在还核 SQL 体摘要，见 REQUIRED_TRIGGERS 后）；
 * 既有旧库照旧 fail-loud，不隐式迁移。
 */
export const SCHEMA_VERSION = 7;
const REQUIRED_TABLES = [
  'meta', 'ledger', 'records', 'check_report', 'object_directory', 'domain_state',
  'journal', 'capability_route', 'projection_state', 'ref_edge',
] as const;
const REQUIRED_TRIGGERS = [
  'ledger_no_update', 'ledger_no_delete', 'check_report_no_update', 'check_report_no_delete',
  'directory_no_update',
  // S-0：追加式三张表也进必备集，缺一个就不算同一套模式
  'domain_state_no_update', 'domain_state_no_delete', 'ref_edge_no_update', 'ref_edge_no_delete',
  'records_no_update', 'records_no_delete',
  // 包 5（D-27/D-28/D-29）：路由/身份/计数三面的新触发器同进必备集
  'route_no_delete', 'route_insert_guarded', 'route_change_guarded',
  'directory_no_delete', 'directory_birth_audited',
  'meta_counter_monotonic', 'meta_ledger_seq_no_delete',
] as const;

/**
 * F5c（G5-A 包 6，CONTRACTS.md §16.3）：必备触发器从**名字比对**升级为**名字 + SQL 体摘要**。
 * 席位实测：摘掉触发器再建**同名空壳**，名字判据重开全绿、保护全灭——名字集合对
 * 「体被掏空」失明。期望摘要在模块加载时于**内存基准库**上 `exec(SCHEMA)` 后读回
 * `sqlite_master` 计算——**不手工维护摘要表**：SCHEMA 是唯一正源，改 SCHEMA 期望自动跟着变
 * （手写摘要 = 判据自身的腐烂面）。归一化只做排版（折叠空白、`if not exists` 差异——
 * sqlite_master 存文本会剥去它并把头部大写），不改语义字符；同体异形（重排空白）不报警，
 * 同名异体（空壳、改逻辑）必报警。
 * 残余登记：字节级同体重建（原样抄回）仍在承诺盲区——那要求持有裸面且伪造结果 = 保持
 * 不变量成立；真正的防线仍是触发器把守数据面，摘要判据钉的是「打开时声明的保护就是这套」。
 */
const normalizeTriggerSql = (sql: string): string =>
  sql.trim().replace(/\s+/g, ' ').replace(/^create trigger if not exists /i, 'create trigger ');
const expectedTriggerDigests: ReadonlyMap<string, string> = (() => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(SCHEMA);
    const rows = db.prepare(`select name, sql from sqlite_master where type='trigger'`).all() as
      { name: string; sql: string | null }[];
    return new Map(rows
      .filter((r) => r.sql !== null)
      .map((r) => [r.name, createHash('sha256').update(normalizeTriggerSql(r.sql as string)).digest('hex')]));
  } finally { db.close(); }
})();

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
    // N9（包 4，席位 G3-A A2-5）：`INSERT OR REPLACE` 的冲突消解走「隐式删除 + 插入」，而 SQLite
    // 的隐式删除**仅在 recursive_triggers=ON 时才触发 DELETE 触发器**（默认 OFF）——不开这条 PRAGMA，
    // 「UPDATE/DELETE 被触发器 abort ⇒ H 不可变」的存储层支点对一条普通 REPLACE 整行替换失效
    // （投影可被翻成 ADOPTED）。本 PRAGMA 让 REPLACE 撞 `ledger_no_delete` 等 DELETE 触发器，
    // append-only 与 guard 面「REPLACE 属被禁写法」的登记（见 guard()）自此同真。
    this.db.exec('pragma recursive_triggers = on;');
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
    // F5b（G5-A 包 6，CONTRACTS.md §16.3）：**水位判据**——`max(ledger.seq) ≤ meta.ledger_seq`。
    // 与上一条同族（「计数器落后于账本」在打开期必须可判定）：席位实测归零水位后重开全绿、
    // 首次机制提交以裸驱动主键冲突越界。合法形态恒满足 `≤`（发号先行、行可回滚缺席）；
    // 违例（归零/倒退/ghost 号前占）一律拒绝打开，修复交显式运维路径。
    const ledgerMaxSeq = (this.db.prepare(`select coalesce(max(seq), 0) m from ledger`).get() as { m: number }).m;
    const watermark = (this.db.prepare(`select value from meta where key='ledger_seq'`).get() as { value: number } | undefined)?.value ?? 0;
    if (ledgerMaxSeq > watermark) {
      throw new Refusal('SCHEMA_UPGRADE_REQUIRED', {
        file: this.file, reason: 'ledger_seq 水位落后于台账历史（归零/倒退/ghost 号），下一次发号必撞既有 seq',
        ledgerMaxSeq, ledgerSeqWatermark: watermark, expectedVersion: SCHEMA_VERSION,
      });
    }

    if (missingTables.length > 0 || missingTriggers.length > 0) {
      // 版本对得上但表/触发器缺失：不可变性可能已被拆除，静默补齐等于假装它一直在
      throw new Refusal('SCHEMA_UPGRADE_REQUIRED', {
        file: this.file, reason: '版本一致但表集/触发器集不完整', missingTables, missingTriggers,
        expectedVersion: SCHEMA_VERSION,
      });
    }
    // F5c（G5-A 包 6，CONTRACTS.md §16.3）：名字齐了还要核**体**——同名空壳摘保护在名字
    // 判据下隐形。摘要期望由模块加载时的 SCHEMA 基准库算得（唯一正源，见 expectedTriggerDigests）。
    const alteredTriggers: string[] = [];
    {
      const stmt = this.db.prepare(`select sql from sqlite_master where type='trigger' and name=?`);
      for (const name of REQUIRED_TRIGGERS) {
        const stored = stmt.get(name) as { sql: string | null } | undefined;
        const expected = expectedTriggerDigests.get(name);
        if (stored === undefined || stored.sql === null || expected === undefined) continue; // 缺名/缺基准走既有判据
        if (createHash('sha256').update(normalizeTriggerSql(stored.sql)).digest('hex') !== expected) alteredTriggers.push(name);
      }
    }
    if (alteredTriggers.length > 0) {
      throw new Refusal('SCHEMA_UPGRADE_REQUIRED', {
        file: this.file, reason: '必备触发器名字在位但 SQL 体与本实现不符（同名空壳/改体——保护可能已被同名替换掏空）',
        alteredTriggers, expectedVersion: SCHEMA_VERSION,
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

  /** 只读句柄：走**更严**的守卫（S-0：只允许 SELECT/WITH，DML 连读路径都不给）。 */
  read<T>(fn: (raw: RawTx) => T): T { return fn(guardRead(this.adapter)); }

  /** 供隔离/并发攻击测试使用的第二条真实连接（同文件、同 WAL）。 */
  openSecond(): SqlitePort { return new SqlitePort({ ...this.opts, file: this.file }); }

  close(): void { this.db.close(); }

  /**
   * `port.raw`（装配根/运维/测试界外面）——**包 6 二选一裁决：取守卫**（CONTRACTS.md §16.3）。
   * 拒绝 **PRAGMA 赋值形 / 函数形 / 白名单外一切 PRAGMA** / DDL / ATTACH 与多语句：
   * `recursive_triggers` 连接态从此**经本 Port 交出的任何句柄都关不掉**（G5-A 新洞2：此前 raw 一条
   * `pragma recursive_triggers=off` 即拆掉全部 REPLACE 系触发器防线，且关闸写入重开不可检出）。
   * **PRAGMA 无参透传形按白名单放行**（F-G6A-1 收紧，席位 G6-A §①#14：旧类目「裸读形=只读连接态」
   * **不实**——`optimize`/`wal_checkpoint` 是无参写副作用形。白名单只收可证无写副作用的单结果查询形，
   * **按词法形状放行、不按语义**，逐形钉在 `tests/g6a-pragma-whitelist.test.ts`）；DML 放行——
   * 它是界外面的本职（运维修复、审计夹具、攻击锚点）：REPLACE/upsert 仍**放行到触发器**受拒，
   * 「触发器不豁免写形」的既有锚不得被守卫截胡。
   * **如实边界（不写过头话）**：手工 `new DatabaseSync` / 裸文件不在任何承诺内（默认
   * `recursive_triggers=OFF`），关闸写入的数据重开不可检出；`raw` 的 DML 仍可伪造数据行
   * （含伪造审计行与见证列）。"存储不变量对持有裸文件者不设防"为真，登记为运维界。
   */
  get raw(): RawTx { return guardRawBoundary(this.adapter); }

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
  // N9 残余（G5-A 包 6，CONTRACTS.md §16.3）：`UNIQUE constraint failed: ledger.seq` 此前以
  // **裸驱动文本**越过「驱动词汇不得越过 Storage Port 边界」的既有纪律——违例已登记 READINESS。
  // 现包装为机制码：水位落后于台账（归零/倒退在会话中发生），发号撞既有 seq。
  // **不可重试**：重试只会再撞同一号——修复是运维/迁移动作，不是调用方动作。
  // 驱动文本只留在 detail 作证据（TX_CONTENTION 同法）。
  if (err?.errcode !== undefined && (err.errcode & 0xff) === 19 && /ledger\.seq/.test(String(err.message ?? ''))) {
    return new Refusal('LEDGER_SEQ_CONFLICT', {
      retryable: false,
      reason: 'meta.ledger_seq 水位落后于台账历史（会话内被归零/倒退），下一次发号必撞既有 seq；需显式修复或恢复',
      driverErrcode: err.errcode, driverMessage: String(err.message ?? '').slice(0, 120),
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
 * N9（包 4，席位 G3-A A2-5）：REPLACE 形态**与 guard 面「被禁写法」登记**（CONTRACTS.md §16.2 存储纪律）。
 * `insert or replace` / `replace into` 的冲突消解走「隐式删除 + 插入」；主修是连接开
 * `recursive_triggers=ON`（见构造函数），让隐式删除触发 DELETE 触发器把历史行 abort 掉。guard 这条是
 * **纵深防御的第二道**：机制句柄本就不该出现 REPLACE 语义——Kernel 的正常写全是 append `insert into`，
 * 一条 REPLACE 出现在机制句柄上即属越界形态，先于触发器直接拒。只禁 REPLACE 两形态，不禁普通
 * `insert into`（Kernel 落 ledger/domain_state 靠它）。
 * D-30（包 5，席位 G4-A G4A-N9e）：**放弃 `^` 锚**。`insert/*c*\/or replace`、`replace/*c*\/into`、
 * `insert--c␊or replace` 三式都让锚定式失配而放行（中置注释实测穿透）——被禁形态与位置无关，
 * 归一化（剥全部注释）之后按**子串**匹配。
 */
const FORBIDDEN_REPLACE_FORM = /\b(insert\s+or\s+replace|replace\s+into)\b/i;
/**
 * D-30（包 5）：upsert 的 `DO UPDATE` 形是 REPLACE 的同族——冲突时**整行改写**，同样绕 INSERT-only
 * 通道。`DO NOTHING` 保持合法：它是投影登记的唯一合法 upsert 形（projection.ts 冷启动在用），
 * 名单只杀改写形。多语句在下方单独拒，`[^;]*` 已把匹配限制在单语句内。
 */
const FORBIDDEN_UPSERT_FORM = /\bon\s+conflict\b[^;]*\bdo\s+update\b/i;
/**
 * 归一化后再判定。**D-30 重写**：修前只剥**前导**注释（独立复审实测 `/* x *\/ drop trigger …`
 * 绕过之后，席位 G4-A 又实测中置注释四式绕过锚定形）——现在剥**全部**注释：块注释与行注释、
 * 任意位置，剥完再做头部关键字、被禁形态（子串）与多语句判定。
 * **词法手段的如实边界**（CONTRACTS.md §16.2 包 5 存储纪律）：字符串字面量里的 `--`、
 * 块注释符、被禁词会被误剥误杀——误杀方向安全（拒而不放行）；更深的形态（字面量内伪关键词、
 * 未来新语法形）仍可能绕，主修始终是触发器层（D-27/D-28/D-29 已把三个可变面逐表钉死）。
 */
function normalizeSql(sql: string): string {
  let out = sql
    .replace(/\/\*[\s\S]*?(?:\*\/|$)/g, ' ')
    .replace(/--[^\n]*/g, ' ');
  for (;;) {
    const stripped = out.replace(/^[\s;]+/, '');
    if (stripped === out) break;
    out = stripped;
  }
  return out;
}
/**
 * 只读守卫（S-0）。此前的"读"句柄只拒 DDL/PRAGMA/ATTACH，`run('update …')` 照样执行——
 * 于是 `kernel.port.read(raw => raw.run(...))` 能改 ref_edge/domain_state/records/capability_route
 * 与 `meta.ledger_seq`，且**不留 journal/ledger 痕迹**：审计链与不变量一起被拆。
 * 读路径的正确形状是"只能是查询"，不是"不能是 DDL"。
 */
const READ_ONLY_HEAD = /^(select|with)\b/i;
function guardRead(raw: RawTx): RawTx {
  const check = (sql: string): void => {
    const head = normalizeSql(sql);
    if (!READ_ONLY_HEAD.test(head)) {
      throw new Refusal('RAW_SQL_REFUSED', { reason: '只读句柄只允许 SELECT/WITH', sql: sql.slice(0, 60) });
    }
    if (/;\s*\S/.test(head)) throw new Refusal('RAW_SQL_REFUSED', { reason: '不得经机制句柄提交多语句', sql: sql.slice(0, 60) });
  };
  return {
    run: (sql, ...p) => { check(sql); return raw.run(sql, ...p); },
    all: (sql, ...p) => { check(sql); return raw.all(sql, ...p); },
    get: (sql, ...p) => { check(sql); return raw.get(sql, ...p); },
  };
}

/**
 * `port.raw` 的边界守卫（包 6，G5-A 新洞2 修法「二选一取守卫」，CONTRACTS.md §16.3）。
 * 拒绝：**全部 DDL**（`FORBIDDEN_KEYWORD` 头部词表，与机制写句柄同源 + `normalizeSql` 剥注释）、
 * **PRAGMA 白名单外一切形**（赋值形 `pragma x = off`、函数形 `pragma x(v)` 是 G5-A 新洞2 的原形；
 * **F-G6A-1 收紧（席位 G6-A §①#14）后连白名单外的无参形也拒**——见 `PRAGMA_QUERY_ONLY_NAMES`）、
 * 多语句。
 * 放行：DML（REPLACE/upsert 仍**到触发器**受拒，「触发器不豁免写形」的锚不得被这层截胡）
 * 与 **PRAGMA 无参透传形白名单**（下方 `PRAGMA_FUNCTIONLESS_PASSTHROUGH`）。误杀方向安全（拒而
 * 不放行）；词法边界与 D-30 登记同族。
 */
/**
 * F-G6A-1 白名单（席位 G6-A §①#14 裁定「不应仅改一个常量名便声称已解决」）：只收**可证无写副作用
 * 的单结果查询形**。类目更名 `PRAGMA_FUNCTIONLESS_PASSTHROUGH`——旧名 `BARE_PRAGMA_READ`（「裸读形」）
 * 名不符实：`pragma optimize`（VACUUM+ANALYZE）与 `pragma wal_checkpoint` 是**无参写副作用**形，
 * 被旧判据按「裸读」放行（G6A-A5-2 实测）。**放行按词法形状、不按语义**（CONTRACTS.md §16.3）；
 * 排除面：`optimize`、`wal_checkpoint`、`foreign_keys`（含函数形，宁可误杀）、一切赋值形
 * （等号/空格/函数调用/`schema.` 前缀组合）。`recursive_triggers` 在列——它是 ST-D/n9 核对连接态
 * 所赖的读锚，同为无写副作用的单行查询形。**残余如实**：词法判据仍可能被字面量伪关键词/未来同义形
 * 误判，误杀方向安全；新增白名单条目必须逐条给「无写副作用」论证（CONTRACTS §16.3 类目更正段）。
 * 逐形测试：`tests/g6a-pragma-whitelist.test.ts`（含原 G6A-A5-2 的耐久开关全拦对照转正）。
 */
const PRAGMA_QUERY_ONLY_NAMES = [
  'journal_mode', 'synchronous', 'user_version', 'schema_version', 'data_version',
  'integrity_check', 'foreign_key_check', 'table_info', 'compile_options', 'module_list',
  'page_count', 'freelist_count', 'recursive_triggers',
];
const PRAGMA_FUNCTIONLESS_PASSTHROUGH = new RegExp(
  `^pragma\\s+(?:[A-Za-z_][A-Za-z0-9_]*\\.)?(?:${PRAGMA_QUERY_ONLY_NAMES.join('|')})\\s*$`, 'i');
function guardRawBoundary(raw: RawTx): RawTx {
  const check = (sql: string): void => {
    const head = normalizeSql(sql);
    if (FORBIDDEN_KEYWORD.test(head) && !PRAGMA_FUNCTIONLESS_PASSTHROUGH.test(head)) {
      throw new Refusal('RAW_SQL_REFUSED', {
        reason: 'DDL / PRAGMA（白名单外一切形：赋值、函数、写副作用查询）/ ATTACH 不得经 port.raw 执行'
          + '（包 6：经 Port 交出的句柄关不掉连接态不变量；F-G6A-1：无参透传形按白名单放行，按词法不按语义）',
        sql: sql.slice(0, 60),
      });
    }
    if (/;\s*\S/.test(head)) {
      throw new Refusal('RAW_SQL_REFUSED', { reason: '不得经 port.raw 提交多语句', sql: sql.slice(0, 60) });
    }
  };
  return {
    run: (sql, ...p) => { check(sql); return raw.run(sql, ...p); },
    all: (sql, ...p) => { check(sql); return raw.all(sql, ...p); },
    get: (sql, ...p) => { check(sql); return raw.get(sql, ...p); },
  };
}

function guard(raw: RawTx): RawTx {
  const check = (sql: string): void => {
    const head = normalizeSql(sql);
    const reason = FORBIDDEN_KEYWORD.test(head) ? 'DDL/PRAGMA/ATTACH 不得经机制句柄执行'
      // N9：REPLACE 形态绕触发器的写法，机制句柄一律拒（主修 recursive_triggers 已在连接层把门）
      : FORBIDDEN_REPLACE_FORM.test(head) ? 'insert or replace / replace into 属被禁写法（N9：REPLACE 走隐式删除，历史行不可经此改写）'
      // D-30（包 5）：upsert DO UPDATE 是 REPLACE 同族的整行改写（DO NOTHING 不在此列）
      : FORBIDDEN_UPSERT_FORM.test(head) ? 'on conflict do update 属被禁写法（D-30：upsert 改写形与 REPLACE 同族）'
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
