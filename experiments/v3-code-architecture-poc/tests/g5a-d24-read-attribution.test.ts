/**
 * D-24 读侧（包 6，席位 G5-A 反审，P1 完整性/语义可信）：扫描面与快照面**共用同一条**
 * `dir.ns` 归属判据；`serveable()` 对归属不符 / `SCHEMA_INCOMPATIBLE` 计入遮蔽数而非上抛炸整页。
 *
 * 席位事实（附录 A C3 + D-24 读侧提级）：`write()`（ns=自己、oid=他人）在机制面成功 ⇒
 * `readAsOf` 扫描面**无 ns 过滤**，以他人对象之名端出攻击者 payload；`readLatest`/`readSnapshot`
 * 按 `dir.ns` 过滤看不到 ⇒ **同一对象同一时刻两个答案**（G3-A 起登记过“两个答案”，本次提级）。
 * 另一半：路由 ns 漂移的 dir 使 `serveable()` 上抛 `SCHEMA_INCOMPATIBLE`，**整页**读不出来，
 * 且不存在能通过的历史截点。
 *
 * 修法（CONTRACTS.md §16.3）：扫描查询带上行 `ns`，每行过**同一个** `routeNs` 函数；
 * 行 ns ≠ 有效归属 ns ⇒ 剔除并计数；`SCHEMA_INCOMPATIBLE` ⇒ 计数不上抛。
 * 隐藏计数归 `hiddenByContractSkew`（语义加宽为「写入方不被当前读者保证」，echo 键集不动）。
 * 后果登记：合法 Facet 挂载行（oid∈dir、行落扩展者 ns）在快照面本就不可见，扫描面对齐——
 * 双时间扫描的可见面收窄为对象属主状态（G24-C 把这条后果钉成显式断言，不藏着）。
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../src/harness/paths.ts';
import { openWorld, PRINCIPAL, type World } from '../src/harness/world.ts';
import { readAsOf } from '../src/kernel/read-context.ts';
import { TEST_OBJECT_MODEL, CAP_OBJECT_MODEL } from '../src/domains/test-object-model.ts';
import { TEST_RECORDS, CAP_RECORDS } from '../src/domains/test-records.ts';
import { Refusal, type CommitSequence, type ObjectOid, type ReadContextSpec } from '../src/contracts/index.ts';

const ADMIN = PRINCIPAL('g24admin');
const GRANTS = { g24admin: ['space-write', 'capability-admin'] };
let dir: string;
beforeAll(() => { dir = mkdtempSync(join(POC_DATA_DIR, 'g5a-d24-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

const open = (name: string): World =>
  openWorld({ file: join(dir, `${name}.db`), space: 'SP-G24', grants: GRANTS, plugins: [TEST_OBJECT_MODEL, TEST_RECORDS] });
const ctx = (w: World, recordedAsOf?: number): ReadContextSpec => ({
  space: w.kernel.space, principal: ADMIN, mode: 'as-recorded', consistency: 'required',
  ...(recordedAsOf !== undefined ? { recordedAsOf: recordedAsOf as CommitSequence } : {}),
});

describe('G5A-C3（移植）：投毒行不再以他人对象之名出现——三读面同一时刻同一答案', () => {
  test('G24-A write() 挂他人 oid 仍成功（挂载面完整修法归 G1），但扫描面把它剔除计数，快照/修订/扫描同一时刻一致', () => {
    const w = open('g24-a');
    try {
      const victim = w.uow(ADMIN, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 'real' } })) as ObjectOid;
      // 席位原形的投毒：CAP_RECORDS 的写端口，ns=自己、oid=他人——机制通道全合法
      expect(() => w.uow(ADMIN, (tx) => w.writerOf(CAP_RECORDS, tx).write(
        { ns: 'dom_test_records', oid: victim, revision: 99, payload: { evil: true }, eventType: 'ext.g5a' },
      ))).not.toThrow();
      // 修前：readAsOf 端出 {evil:true}（与快照面两个答案）；修后：只端出属主状态
      const scan = readAsOf(w.kernel, ctx(w));
      const rowsOfVictim = scan.rows.filter((r) => r.oid === victim);
      expect(rowsOfVictim.map((r) => r.payload)).toEqual([{ v: 'real' }]);
      expect(rowsOfVictim.some((r) => (r.payload as { evil?: boolean }).evil)).toBe(false);
      // 剔除必须**可归因**：计入遮蔽数，只给数量不给身份
      expect(scan.echo.hiddenByContractSkew).toBe(1);
      // 三读面同一时刻一致（G3-A「两个答案」的收口钉）
      expect(w.readObject(victim)!.payload).toEqual({ v: 'real' });
      expect(w.readRevision({ kind: 'revision-ref', oid: victim, revision: 1 })!.payload).toEqual({ v: 'real' });
      // 每个历史截点页都一致（不是只有 head；属主行落在 seq=1）
      for (let x = 1; x <= w.ledgerHead(); x += 1) {
        const p = readAsOf(w.kernel, ctx(w, x));
        expect(p.rows.filter((r) => r.oid === victim).map((r) => r.payload), `截点 ${x}`)
          .toEqual([{ v: 'real' }]);
      }
    } finally { w.close(); }
  });

  test('G24-B 归属不符不炸整页：路由 ns 漂移（界外形状）下扫描面逐截点存活、剔除可归因', () => {
    const w = open('g24-b');
    try {
      const victim = w.uow(ADMIN, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } })) as ObjectOid;
      // 构造漂移的界外形状：装配视图被改成与冻结 dir.ns 不一致（等价于裸面改了路由 ns 后重开；
      // 机制通道经 D-31 入口拒已构造不出这个形状——正是修法的分工：入口防合法面，读侧防界外形）
      w.kernel.registry.setRoute(CAP_OBJECT_MODEL, {
        capability: CAP_OBJECT_MODEL, pluginId: 'test.object-model',
        storageNamespace: 'dom_g24_drift', contractVersion: 'v1',
      });
      // 快照面：该对象 fail-loud（单面对象，拒掉不损失什么——§14.5 分界不变）
      let code = 'NO_REFUSAL';
      try { w.readObject(victim); } catch (e) { code = e instanceof Refusal ? e.code : 'OTHER'; }
      expect(code).toBe('SCHEMA_INCOMPATIBLE');
      // 扫描面：**每个**截点都必须读得出来（修前：每个截点都抛，全库双时间面死亡），
      // 漂移对象的行剔除且计数——空页必须可归因，不得静默、更不得炸页。
      for (let x = 1; x <= w.ledgerHead(); x += 1) {
        const p = readAsOf(w.kernel, ctx(w, x));
        expect(p.rows.some((r) => r.oid === victim), `截点 ${x} 不得出现漂移对象行`).toBe(false);
        expect(p.echo.hiddenByContractSkew).toBeGreaterThanOrEqual(1);
      }
    } finally { w.close(); }
  });

  test('G24-C 后果钉（如实登记）：合法挂载行在扫描面的可见面收窄为属主状态；echo 键集不变（冻结附件钉着它）', () => {
    const w = open('g24-c');
    try {
      const host = w.uow(ADMIN, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } })) as ObjectOid;
      // 合法的扩展挂载（Q45 形态）：oid 在目录、行落扩展者自己的 ns——写侧仍合法
      w.uow(ADMIN, (tx) => w.writerOf(CAP_RECORDS, tx).write(
        { ns: 'dom_test_records', oid: host, revision: 1, payload: { facet: 'extended' }, eventType: 'ext.facet' },
      ));
      const scan = readAsOf(w.kernel, ctx(w));
      // 快照面从来只端属主状态；扫描面对齐 ⇒ 挂载行不出现（它不是「这个对象的当前答案」）
      expect(scan.rows.filter((r) => r.oid === host).map((r) => r.payload)).toEqual([{ v: 1 }]);
      expect(w.readObject(host)!.payload).toEqual({ v: 1 });
      expect(scan.echo.hiddenByContractSkew).toBe(1); // 剔除可归因：挂载行计数（不给身份）
      expect(Object.keys(scan.echo).sort()).toEqual([
        'hiddenByContractSkew', 'hiddenByInactiveCapability', 'mode', 'moreRows',
        'recordedAsOfWasDefaulted', 'timeFieldMissing', 'truncated', 'usedDescribedAt', 'usedRecordedAsOf',
      ]);
    } finally { w.close(); }
  });
});
