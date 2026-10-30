/**
 * 移植（血统）：`attacks/review/RE-REVIEW-G6-A.md` 附录 A.2 `G6B-D27-4`
 * （裁定表 ②「停用复活·PK 改名链」，P3 登记裸界；F-G6A-3 非本轮修法对象——修法方向
 * 属 G1 的 D-27 方向判据扩展）。第五轮裁定第 1 条：攻击产出转存量 ⇒ 移植进作者 `tests/`，
 * **只改 import 深度**（`../../src/…` → `../src/…`），用例体与断言一字未动。
 * 本用例绿 = 「链在裸界内仍可达」的**现状为真**（登记面），不是偶然通过；
 * 若未来判据扩展把链堵上，本用例转红并要求重定性（双向绊线，同 BASELINE 语义）。
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../src/harness/paths.ts';
import { openWorld, PRINCIPAL } from '../src/harness/world.ts';
import { TEST_OBJECT_MODEL } from '../src/domains/test-object-model.ts';
import { TEST_RECORDS, CAP_RECORDS } from '../src/domains/test-records.ts';
import { type ObjectOid } from '../src/contracts/index.ts';

const ADM = PRINCIPAL('g6badmin');
const NOBODY = PRINCIPAL('g6bnobody');
const GRANTS = {
  g6badmin: ['space-write', 'capability-admin', 'domain-admission'],
  g6bnobody: ['space-write'],
};
let dir: string;
beforeAll(() => { dir = mkdtempSync(join(POC_DATA_DIR, 'g6b-reacttack-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

const outcome = (fn: () => unknown): string => {
  try { fn(); return 'NO_REFUSAL'; }
  catch (e) {
    const err = e as { code?: unknown; message?: unknown };
    if (typeof err?.code === 'string' && err.code !== 'ERR_SQLITE_ERROR') return err.code;
    return String(err?.message ?? e);
  }
};

describe('G6B-D27 预留面的复攻（作者 G27 三例之外）', () => {
  test('G6B-D27-4（父席点名·完整链）UPDATE-PK 改名 + INSERT 全新登记形 ⇒ 停用复活且**方向判据全程未参与**；插件可达面逐步验证做不到', () => {
    const file = join(dir, 'd27-pkchain.db');
    const w = openWorld({ file, space: 'SP-G6B', grants: GRANTS, plugins: [TEST_OBJECT_MODEL, TEST_RECORDS] });
    const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: {} })) as ObjectOid;
    w.uow(NOBODY, (tx) => w.standingUseCase().declare(tx, { oid, revision: 1, stance: 'ACCEPTED' }));
    w.unloadCapability(CAP_RECORDS, ADM); // 真停用（真审计+真见证）
    const row = w.raw.get<{ plugin_id: string; ns: string; contract_version: string }>(
      `select plugin_id, ns, contract_version from capability_route where capability=?`, CAP_RECORDS)!;
    // —— 插件可达面先撞墙（同一攻击意图经机制通道的每一步）——
    expect(outcome(() => w.uow(NOBODY, (tx) => tx.appendLedger({ eventType: 'capability-enabled', payload: { capability: CAP_RECORDS } }))))
      .toBe('EVENT_AUTHORITY_REQUIRED'); // 预留拦 mint
    // —— 裸面三步链（1 条伪造见证审计 + 1 条 UPDATE + 1 条 INSERT）——
    const s = w.ledgerHead() + 1;
    const tomb = 'cap.g6a.tombstone'; // 改名后的墓碑名
    w.raw.run(
      `insert into ledger(seq, space, event_type, actor, authority_basis, payload_json, described_at, recorded_at)
       values(?,?,?,?,?,?,null,?)`,
      s, 'SP-G6B', 'capability-enabled', 'anyname',
      JSON.stringify({ axis: 'capability-admin', capability: tomb, authorized: true }),
      JSON.stringify({ capability: tomb }), Date.now(),
    );
    w.raw.run(`update meta set value = ? where key='ledger_seq'`, s);
    // 步骤①：路由行改名（capability 是 PK——**不在方向判据③的三元组里**，一条任意名审计即过）
    expect(outcome(() => w.raw.run(
      `update capability_route set capability=?, changed_seq=? where capability=?`, tomb, s, CAP_RECORDS,
    ))).toBe('NO_REFUSAL');
    // 步骤②：给原能力插一条全新登记形行（route_insert_guarded 只核 enabled=1/无戳——**新生行零审计是设计**）
    expect(outcome(() => w.raw.run(
      `insert into capability_route(capability, plugin_id, ns, contract_version) values(?,?,?,?)`,
      CAP_RECORDS, row.plugin_id, row.ns, row.contract_version,
    ))).toBe('NO_REFUSAL');
    w.close();
    // 步骤③：新进程按持久路由复活 ⇒ 停用被撤销，且 H 里**不存在任何一条**指向 CAP_RECORDS 的启用审计
    const w2 = openWorld({ file, space: 'SP-G6B', grants: GRANTS, plugins: [TEST_OBJECT_MODEL, TEST_RECORDS] });
    try {
      expect(w2.kernel.registry.capability(CAP_RECORDS) !== undefined, '新进程路由视图应已复活为启用').toBe(true);
      // H 里指向 CAP_RECORDS 的启停审计**只有停用那一条**——复活全程零启用审计（方向判据被链绕开）
      const audits = w2.raw.get<{ c: number }>(
        `select count(*) c from ledger where json_valid(payload_json) and json_extract(payload_json,'$.capability')=?
           and event_type in ('capability-enabled','capability-disabled','capability-transferred')`,
        CAP_RECORDS,
      )!.c;
      expect(audits).toBe(1); // 停用真账一条；启用：**没有**——审计面看不出「它又活了」
      const revived = w2.raw.get<{ enabled: number; changed_seq: number | null }>(
        `select enabled, changed_seq from capability_route where capability=?`, CAP_RECORDS,
      )!;
      expect(revived).toEqual({ enabled: 1, changed_seq: null }); // **新行无戳**：复活不留变更戳
      const tombRow = w2.raw.get<{ c: number }>(`select count(*) c from capability_route where capability=?`, tomb)!.c;
      expect(tombRow).toBe(1); // 墓碑行永久残留（route_no_delete 删不掉）= 痕迹
    } finally { w2.close(); }
  });
});
