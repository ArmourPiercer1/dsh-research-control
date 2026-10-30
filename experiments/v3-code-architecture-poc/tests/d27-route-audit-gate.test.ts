/**
 * D-27（包 5，席位 G4-A G4A-N9c 实测，P1）：`capability_route` 曾被裸面 `REPLACE` 无审计复活停用。
 *
 * 席位链（本文件第 1 例按原形复现）：停用（enabled=0，机制审计在位）→ 装配裸面
 * `replace into capability_route(..., enabled, changed_seq)` 把停用改回启用并伪造审计序号 ⇒
 * **零 ledger 审计** → 新进程 `activate()` 读持久路由 → 被停用的能力恢复签发。绕开的是
 * `capability-admin` 轴的持久化，被绕的是「停用」这一安全决策。
 *
 * 修法（CONTRACTS.md §16.2 包 5 存储纪律）：`capability_route` 三条触发器——
 * ① `route_no_delete`：DELETE（含 REPLACE 隐式删除）abort `ROUTE_FROZEN`；
 * ② `route_change_guarded`（UPDATE）：`changed_seq` 严格单调递增（`ROUTE_CHANGED_SEQ_MONOTONICITY`）
 *    + 变更必须随**机制落账**（`ledger` 里必须已有 `seq = new.changed_seq`、事件类型合名单、
 *    payload.capability 字面相符、`actor` 非空且 `authority_basis` 携带 capability-admin 机制见证
 *    ⇒ 否则 `ROUTE_AUDIT_REQUIRED`；见证判据是包 6 D-27 真修追加，见下）；
 * ③ `route_insert_guarded`（INSERT）：初始登记形态钉死 `enabled=1 且 changed_seq 为 NULL`
 *    （`ROUTE_SHAPE_FROZEN`）——启停/移交只能经 UPDATE 走审计面。
 * REPLACE 被拒于哪一闸取决于载荷形状：BEFORE INSERT 先于冲突消解执行 ⇒ 带伪造戳的席位原形
 * 撞 ③；「登记形 REPLACE」穿过 ③ 后被隐式删除的 ① 拒。两条都有用例钉住（D27-1 / D27-4）。
 *
 * **诚实边界（包 6 D-27 真修后收窄但未归零，CONTRACTS.md §16.3）**：G5-A 实测「只查形状」的
 * ②可被 `appendLedger` mint 出的真形审计行过闸 ⇒ 真修 = 通用通道预留五审计名（插件侧 mint
 * 归零）+ ②核 N1 同信封的机制见证。残余：裸面（`port.raw` DML / 裸文件）连**见证列**一起
 * 伪造仍能过闸——伪造从「零审计」「随手一行」抬到「必须在见证列撒谎且落账不可删」，
 * 处置归运维/审计。收窄后的边界钉在 tests/g5a-d27-audit-reserve.test.ts G27-C；
 * D27-4 现钉的是「无见证 mint 过不了闸」这半形必红的判据本身。
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../src/harness/paths.ts';
import { openWorld, PRINCIPAL, type World } from '../src/harness/world.ts';
import { TEST_OBJECT_MODEL } from '../src/domains/test-object-model.ts';
import { TEST_RECORDS, CAP_RECORDS } from '../src/domains/test-records.ts';
import { asOid, type ObjectOid } from '../src/contracts/index.ts';

const ADM = PRINCIPAL('d27adm');       // space-write + capability-admin + domain-admission
const NOBODY = PRINCIPAL('d27nobody'); // 只有 space-write：签出的行见证 false
const GRANTS = {
  d27adm: ['space-write', 'capability-admin', 'domain-admission'],
  d27nobody: ['space-write'],
};
let dir: string;
beforeAll(() => { dir = mkdtempSync(join(POC_DATA_DIR, 'd27-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

const openFile = (file: string): World =>
  openWorld({ file, space: 'SP-D27', grants: GRANTS, plugins: [TEST_OBJECT_MODEL, TEST_RECORDS] });
const open = (name: string): World => openFile(join(dir, `${name}.db`));

/** 触发器 abort 文本在 message 里（node:sqlite 的 code 恒为 ERR_SQLITE_ERROR——N9 同法）。 */
const outcome = (fn: () => unknown): string => {
  try { fn(); return 'NO_REFUSAL'; }
  catch (e) {
    const err = e as { code?: unknown; message?: unknown };
    return typeof err?.code === 'string' && err.code !== 'ERR_SQLITE_ERROR' ? err.code : String(err?.message ?? e);
  }
};
const routeRow = (w: World) =>
  w.raw.get<{ enabled: number; changed_seq: number | null }>(
    `select enabled, changed_seq from capability_route where capability=?`, CAP_RECORDS)!;
const auditRows = (w: World) =>
  w.raw.all<{ seq: number; event_type: string }>(
    `select seq, event_type from ledger where event_type in ('capability-enabled','capability-disabled','capability-transferred') order by seq`);

describe('D-27 路由持久面：启停只能经 setRouteEnabled，变更必须随审计落账', () => {
  test('D27-1 席位完整链复现：REPLACE 复活停用 ⇒ 路由 REPLACE 在存储层被拒（席位原形撞形态闸）；停用决策跨进程保持、新进程签发仍拒、攻击全程零审计', () => {
    const file = join(dir, 'd27-1.db');
    const w = openFile(file);
    const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { core: true } }));
    w.uow(NOBODY, (tx) => w.standingUseCase().declare(tx, { oid: asOid(oid), revision: 1, stance: 'ACCEPTED' }));
    expect(w.standingUseCase().standingAt(asOid(oid), w.ledgerHead()).state).toBe('NOT_ADOPTED');
    // 席位原形：停用 → REPLACE 改回 enabled=1 并伪造 changed_seq → 新进程 activate → 签发
    w.unloadCapability(CAP_RECORDS, ADM);
    const auditAfterUnload = auditRows(w).map((r) => r.event_type);
    expect(auditAfterUnload).toEqual(['capability-disabled']); // 停用本身有账
    // 席位原形带着伪造戳（changed_seq=-1）⇒ 先撞 INSERT 形态闸（BEFORE INSERT 先于冲突消解执行）；
    // 不带伪造戳的「登记形 REPLACE」则穿过形态闸、被隐式删除的 DELETE 闸拒（D27-4 钉那条）。
    // 两闸同族：任何路由 REPLACE 都被拒，只是被哪一闸拒取决于伪造载荷的形状。
    expect(outcome(() => w.raw.run(
      `replace into capability_route(capability, plugin_id, ns, contract_version, enabled, changed_seq)
       values(?,'test.test-records','dom_test_records','v1',1,-1)`, CAP_RECORDS,
    ))).toContain('ROUTE_SHAPE_FROZEN');
    expect(routeRow(w).enabled).toBe(0);
    w.close();
    const w2 = openFile(file); // 模拟新进程：activate() 读持久路由
    try {
      expect(outcome(() => w2.uow(NOBODY, (tx) => w2.standingUseCase().declare(tx, {
        oid: asOid(oid), revision: 1, stance: 'ACCEPTED',
      })))).toContain('CAPABILITY_INACTIVE');
      expect(auditRows(w2).map((r) => r.event_type)).toEqual(auditAfterUnload); // 攻击零审计新增
    } finally { w2.close(); }
  });

  test('D27-2 裸面 UPDATE 四式均拒：不动戳翻 enabled（非严格递增）、伪造未来戳无审计、戳倒退、戳前进一格仍无审计行', () => {
    const w = open('d27-2');
    try {
      w.unloadCapability(CAP_RECORDS, ADM);
      const stamp = routeRow(w).changed_seq!;
      // 式 1：只翻 enabled，不动 changed_seq ⇒ 戳未严格递增
      expect(outcome(() => w.raw.run(
        `update capability_route set enabled=1 where capability=?`, CAP_RECORDS,
      ))).toContain('ROUTE_CHANGED_SEQ_MONOTONICITY');
      // 式 2：给一个未来戳但 H 里没有对应审计行
      expect(outcome(() => w.raw.run(
        `update capability_route set enabled=1, changed_seq=99999 where capability=?`, CAP_RECORDS,
      ))).toContain('ROUTE_AUDIT_REQUIRED');
      // 式 3：把戳改回更小（审计行还在，但戳必须只进不退）
      expect(outcome(() => w.raw.run(
        `update capability_route set enabled=1, changed_seq=1 where capability=?`, CAP_RECORDS,
      ))).toContain('ROUTE_CHANGED_SEQ_MONOTONICITY');
      // 式 4：戳前进一格、H 无该戳的审计行 ⇒ 审计随附判据拒（单调性放行到这步为止）
      expect(outcome(() => w.raw.run(
        `update capability_route set enabled=1, changed_seq=? where capability=?`, stamp + 1, CAP_RECORDS,
      ))).toContain('ROUTE_AUDIT_REQUIRED');
      expect(routeRow(w).enabled).toBe(0);
    } finally { w.close(); }
  });

  test('D27-3 正当通道不受影响：setRouteEnabled 停用/启用各自落账且 changed_seq 严格递增；loadCapability 后恢复签发', () => {
    const w = open('d27-3');
    const oid: ObjectOid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { core: true } }));
    try {
      w.unloadCapability(CAP_RECORDS, ADM);
      const off = routeRow(w);
      expect([off.enabled, auditRows(w).map((r) => r.event_type)]).toEqual([0, ['capability-disabled']]);
      expect(outcome(() => w.uow(NOBODY, (tx) => w.standingUseCase().declare(tx, { oid, revision: 1, stance: 'ACCEPTED' }))))
        .toContain('CAPABILITY_INACTIVE');
      w.loadCapability(CAP_RECORDS, ADM);
      const on = routeRow(w);
      expect([on.enabled, on.changed_seq! > off.changed_seq!]).toEqual([1, true]);
      expect(auditRows(w).map((r) => r.event_type)).toEqual(['capability-disabled', 'capability-enabled']);
      // 恢复签发（D-25 判据的反方向钉：启/停都在审计面上，两个方向都有账）
      expect(outcome(() => w.uow(NOBODY, (tx) => w.standingUseCase().declare(tx, { oid, revision: 1, stance: 'ACCEPTED' }))))
        .toBe('NO_REFUSAL');
      expect(w.standingUseCase().standingAt(oid, w.ledgerHead()).state).toBe('NOT_ADOPTED');
    } finally { w.close(); }
  });

  // ── 原子性（外部复审追问「审计先行必须与变更同事务原子，否则审计面出现幽灵行 ⇒ 假凭据比零审计更糟」的实测答复）──
  // 同事务由谁保证：**kernel.ts `uow()` 的 `return this.#port.tx((raw) => { … fn(tx) … })`**——
  // setRouteEnabled 的回调体整个活在这一个回调里，审计 insert 与路由 update 拿的是同一个 raw
  // （`RAW_OF_UOW.get(tx)` 就是 port.tx 交进来的那条句柄）；而 **sqlite-port.ts `tx()` 的
  // `begin immediate` → `fn(...)` → `commit` / catch 里 `rollback`** 是唯一的事务边界。
  // **不存在第二个事务边界**：机制代码不经 `tx()` 回调的写只有 `port.raw`（同一连接的
  // autocommit），那条面本来就是已登记的运维后门——它不是隐蔽的第二边界，而是明示的界外
  // （下例 D27-6 把它产生的幽灵审计钉成显式断言，而不是假装没有）。
  test('D27-5 审计先行与变更同事务原子：三种「审计写过而事务没落」形态在机制内均零残留（含序号也不留 ghost）', () => {
    const w = open('d27-5');
    try {
      const auditCount0 = auditRows(w).length;
      // 形①：提交期失败（failBeforeCommit 注入）——审计已写、COMMIT 抛错 ⇒ 整事务回滚
      w.port.failBeforeCommit = new Error('injected-commit-failure');
      expect(outcome(() => w.unloadCapability(CAP_RECORDS, ADM))).toContain('injected-commit-failure');
      expect(routeRow(w).enabled).toBe(1);                    // 变更没落
      expect(auditRows(w)).toHaveLength(auditCount0);          // 审计零残留（幽灵 = 0）
      expect(w.ledgerHead()).toBe(0);                          // 序号分配一并回滚（不留 ghost seq）
      // 形②：事务中途被触发器拒绝——审计先写、路由 update 撞 `route_change_guarded`（审计载荷
      //        的 capability 与被改行字面不符 ⇒ ROUTE_AUDIT_REQUIRED abort）⇒ 回滚连坐审计
      const head = w.ledgerHead();
      expect(outcome(() => w.port.tx((raw) => {
        raw.run(`update meta set value = ? where key='ledger_seq'`, head + 1);
        raw.run(
          `insert into ledger(seq, space, event_type, actor, payload_json, recorded_at)
           values(?,?,?,?,?,?)`, head + 1, 'SP-D27', 'capability-enabled', 'whoever',
          JSON.stringify({ capability: 'cap.some.other' }), Date.now(),
        );
        raw.run(`update capability_route set enabled=0, changed_seq=? where capability=?`, head + 1, CAP_RECORDS);
      }))).toContain('ROUTE_AUDIT_REQUIRED');
      expect(auditRows(w)).toHaveLength(auditCount0);          // 形②同样零残留
      expect(w.ledgerHead()).toBe(head);                       // meta 计数回滚
      expect(routeRow(w).enabled).toBe(1);
      // 形③：CAPABILITY_SCOPE_ESCAPE——判据在**任何写之前**抛出（与①②的「写过又被回滚」不同形，
      //        是「根本没写」形；两种都要求零残留）
      expect(outcome(() => w.uowFor(CAP_RECORDS, ADM, (tx) =>
        tx.createObject({ kind: 'test.claim', payload: {} }),
      ))).toContain('CAPABILITY_SCOPE_ESCAPE');
      expect(auditRows(w)).toHaveLength(auditCount0);
      expect(w.ledgerHead()).toBe(head);
    } finally { w.close(); }
  });

  test('D27-6 界外钉死（幽灵审计的形状，机制不承诺、断言必须看见）：裸面两条独立 autocommit「审计先落、变更被拒」⇒ H 里留下从未生效的审计行', () => {
    const w = open('d27-6');
    try {
      const head = w.ledgerHead();
      // 模拟「调用方吞异常」的拆分执行：审计与变更各自一条 autocommit 语句（`port.raw`，界外）。
      w.raw.run(`update meta set value = ? where key='ledger_seq'`, head + 1);
      w.raw.run(
        `insert into ledger(seq, space, event_type, actor, payload_json, recorded_at)
         values(?,?,?,?,?,?)`, head + 1, 'SP-D27', 'capability-enabled', 'splitter',
        JSON.stringify({ capability: CAP_RECORDS }), Date.now(),
      );
      const ghost = outcome(() => w.raw.run(
        // 故意给错戳（head+2 ≠ 审计行的 head+1）⇒ 变更被拒；异常按「调用方吞掉」处理
        `update capability_route set enabled=1, changed_seq=? where capability=?`, head + 2, CAP_RECORDS,
      ));
      expect(ghost).toContain('ROUTE_AUDIT_REQUIRED');
      // 幽灵审计**存在**：审计行落了库而路由一字未动——这正是同事务纪律要消灭的形状。
      // 机制内的三条正当写路径（D27-5）不可产生它；`port.raw` 的 autocommit 可以——
      // 它删不掉审计（ledger_no_delete），痕永久留账，处置归审计（CONTRACTS.md §16.2 包 5）。
      expect(w.raw.get<{ c: number }>(`select count(*) c from ledger where seq=?`, head + 1)!.c).toBe(1);
      expect(routeRow(w).enabled).toBe(1);
      // 且这条幽灵行**不可被抹除**（审计面自身的不可变性把幽灵也一起钉住了——如实的副作用）
      expect(outcome(() => w.raw.run(`delete from ledger where seq=?`, head + 1))).toContain('HISTORY_IMMUTABLE');
    } finally { w.close(); }
  });

  test('D27-4 登记形态钉死 + 声明的上限：insert 伪造停用/预审计形被拒，insert or replace 撞 DELETE 触发器，登记形照旧合法；伪造必须落账且带机制见证（零审计与无见证都过不了闸）', () => {
    const w = open('d27-4');
    try {
      w.unloadCapability(CAP_RECORDS, ADM);
      // INSERT 伪造「预停用」或「已审计」形态 ⇒ 登记面拒
      expect(outcome(() => w.raw.run(
        `insert into capability_route(capability, plugin_id, ns, contract_version, enabled, changed_seq)
         values('cap.evil.new','p','ns_evil','v1',0,1)`,
      ))).toContain('ROUTE_SHAPE_FROZEN');
      // 同 pk 的 insert or replace = 隐式删除 ⇒ ROUTE_FROZEN（REPLACE 族在路由表全灭）
      expect(outcome(() => w.raw.run(
        `insert or replace into capability_route(capability, plugin_id, ns, contract_version)
         values(?,'test.test-records','dom_test_records','v1')`, CAP_RECORDS,
      ))).toContain('ROUTE_FROZEN');
      // 全新能力的「登记形」插入合法——activate() 干的正是这个形状（登记面不得误伤）
      expect(outcome(() => w.raw.run(
        `insert into capability_route(capability, plugin_id, ns, contract_version) values('cap.d27.new','p','ns_new','v1')`,
      ))).toBe('NO_REFUSAL');
      // 包 6 翻转钉：裸面写一条**形状齐全但无机制见证**的审计行、再以该行为戳改路由 ⇒ 拒。
      // （修前这里是 NO_REFUSAL——「形态齐全」即过闸；D-27 真修后 ②核 actor+authority_basis
      //  见证，见证只能由机制写通道盖（G5-A 半形判据的正身，配套红测在 g5a-d27 G27-C）。）
      const forgedStamp = routeRow(w).changed_seq! + 7;
      w.raw.run(
        `insert into ledger(seq, space, event_type, actor, payload_json, recorded_at)
         values(?,'SP-D27','capability-enabled','forged',?,1)`,
        forgedStamp, JSON.stringify({ capability: CAP_RECORDS }),
      );
      expect(outcome(() => w.raw.run(
        `update capability_route set enabled=1, changed_seq=? where capability=?`, forgedStamp, CAP_RECORDS,
      ))).toContain('ROUTE_AUDIT_REQUIRED');
      expect(routeRow(w).enabled).toBe(0); // 停用决策保持——伪造不再能复活被停用的能力
      expect(w.raw.get<{ c: number }>(`select count(*) c from ledger where seq=?`, forgedStamp)!.c).toBe(1); // 痕在，删不掉
    } finally { w.close(); }
  });
});
