/**
 * D-27 真修（包 6，席位 G5-A 反审，P1 完整性）：机制审计名预留 + 路由守闸核「机制落账」见证。
 *
 * 席位纠正（RE-REVIEW-G5-A ①/②/③，附录 A F4/F4b 移植——夹具与链路按原形，断言改为修法后
 * 判据）：D-27 的可达面此前被误记为「装配裸面/运维」——`appendLedger`/`write()` 对五个机制
 * 审计事件名**零预留**，任何只有 space-write 的主体都能 mint 与机制真账逐列同形的审计行
 * （`event_type` 同、payload 同形、`actor` 自定、`authority_basis` 同为 NULL），再用裸面
 * UPDATE 把停用改回启用 ⇒「静默改写」实为「可伪造改写 + 伪证借 `ledger_no_delete` 不可篡改」。
 *
 * 修法两段（CONTRACTS.md §16.3）：
 * ① 五个审计名进预留通道——与正式事件名同一判据点、同一码 `EVENT_AUTHORITY_REQUIRED`；
 * ② `route_change_guarded` 审计存在性判据补核 `actor` 非空 + `authority_basis` 机制见证
 *   （N1 同信封：axis=capability-admin、capability 字面相符、authorized=1）。
 *
 * **席位 ③ 判据的专用钉子（G27-C）**：只做 ① 不做 ② ⇒ 攻击者用**真实 actor** mint 仍过闸。
 * 本文件那条用例正是为打红这个半形而写：半形（预留 + 只查形状）下它必红——变异实验见 EVIDENCE。
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../src/harness/paths.ts';
import { openWorld, PRINCIPAL, type World } from '../src/harness/world.ts';
import { TEST_OBJECT_MODEL } from '../src/domains/test-object-model.ts';
import { TEST_RECORDS, CAP_RECORDS } from '../src/domains/test-records.ts';
import { Refusal } from '../src/contracts/index.ts';

const ADM = PRINCIPAL('g27adm');       // space-write + capability-admin + domain-admission
const NOBODY = PRINCIPAL('g27nobody'); // 只有 space-write：G5-A 的攻击主体
const GRANTS = {
  g27adm: ['space-write', 'capability-admin', 'domain-admission'],
  g27nobody: ['space-write'],
};
let dir: string;
beforeAll(() => { dir = mkdtempSync(join(POC_DATA_DIR, 'g5a-d27-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

const open = (name: string): World =>
  openWorld({ file: join(dir, `${name}.db`), space: 'SP-G27', grants: GRANTS, plugins: [TEST_OBJECT_MODEL, TEST_RECORDS] });

const outcome = (fn: () => unknown): string => {
  try { fn(); return 'NO_REFUSAL'; }
  catch (e) {
    const err = e as { code?: unknown; message?: unknown };
    return typeof err?.code === 'string' && err.code !== 'ERR_SQLITE_ERROR' ? err.code : String(err?.message ?? e);
  }
};
const refusal = (fn: () => unknown): Refusal => {
  try { fn(); } catch (e) { if (e instanceof Refusal) return e; throw e; }
  throw new Error('预期 Refusal，实际无拒绝');
};
const routeRow = (w: World) =>
  w.raw.get<{ enabled: number; changed_seq: number | null }>(
    `select enabled, changed_seq from capability_route where capability=?`, CAP_RECORDS)!;

const FIVE = ['capability-enabled', 'capability-disabled', 'capability-transferred',
  'object-registered', 'check-report-recorded'] as const;

describe('G5A-F4（移植）：五个机制审计名进预留通道，mint 归零', () => {
  test('G27-A 只有 space-write 的主体经 appendLedger / write() mint 五个审计名：全部 EVENT_AUTHORITY_REQUIRED；反向锚（正式事件名同码）与正例（普通事件名照常）不回归', () => {
    const w = open('g27-a');
    try {
      const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } }));
      // 席位原形的五个 mint 逐名核对：从「全部成功」翻为「全部通道拒」（同一条预留通道、同一个码）
      for (const et of FIVE) {
        const r = refusal(() => w.uow(NOBODY, (tx) =>
          tx.appendLedger({ eventType: et, payload: { capability: CAP_RECORDS } })));
        expect(r.code, `审计名 ${et} 必须被预留通道拒`).toBe('EVENT_AUTHORITY_REQUIRED');
      }
      // write() 的第二后门同拒（D-20 对正式事件名的判据点扩到审计名）
      const rw = refusal(() => w.uow(NOBODY, (tx) => w.writerOf(CAP_RECORDS, tx).write(
        { ns: 'dom_test_records', oid, revision: 1, payload: { x: 1 }, eventType: 'capability-enabled' })));
      expect(rw.code).toBe('EVENT_AUTHORITY_REQUIRED');
      // 反向锚（F4 对照段，逐字保留）：正式事件名走同一条通道也是同码——预留是同一机制，不是新发明
      expect(outcome(() => w.uow(NOBODY, (tx) =>
        tx.appendLedger({ eventType: 'synth:fact-designation', payload: { stance: 'ACCEPTED' } }))))
        .toBe('EVENT_AUTHORITY_REQUIRED');
      // 正例：普通事件名不受影响（预留不是泛化封口）
      expect(outcome(() => w.uow(NOBODY, (tx) =>
        tx.appendLedger({ eventType: 'ext.g27.ordinary', payload: { ok: true } })))).toBe('NO_REFUSAL');
      // 清单认领五名同样被拒（否则窄面正式通道成为预留的第二 breach）
      expect(outcome(() => openWorld({
        file: join(dir, 'g27-a-claim.db'), space: 'SP-G27', grants: GRANTS,
        plugins: [{ ...TEST_RECORDS, pluginId: 'claim.evil', ownsEventTypes: [
          { eventType: 'capability-enabled', capability: CAP_RECORDS, requiresAuthority: 'biz.g27' },
        ] }],
      }))).toBe('AMBIGUOUS_AUTHORITY');
    } finally { w.close(); }
  });
});

describe('G5A-F4b（移植）：路由守闸核机制落账见证，无见证 mint 过不了闸', () => {
  test('G27-B 裸面 mint「形态齐全」审计行（无见证）再 UPDATE 复活停用 ⇒ ROUTE_AUDIT_REQUIRED；停用决策保持', () => {
    const w = open('g27-b');
    try {
      w.unloadCapability(CAP_RECORDS, ADM);
      expect(routeRow(w).enabled).toBe(0);
      const forged = routeRow(w).changed_seq! + 42; // 席位原形的未来戳
      w.raw.run(
        `insert into ledger(seq, space, event_type, actor, payload_json, recorded_at) values(?,?,?,?,?,?)`,
        forged, 'SP-G27', 'capability-enabled', 'forged', JSON.stringify({ capability: CAP_RECORDS }), 1,
      );
      // 修前：NO_REFUSAL（形状全对即过闸）；修后：无机制见证的审计行不再是「机制落账」
      expect(outcome(() => w.raw.run(
        `update capability_route set enabled=1, changed_seq=? where capability=?`, forged, CAP_RECORDS,
      ))).toContain('ROUTE_AUDIT_REQUIRED');
      expect(routeRow(w).enabled).toBe(0);
      // 伪证本身删不掉（append-only 不变量不因预留修法而松动）
      expect(outcome(() => w.raw.run(`delete from ledger where seq=?`, forged))).toContain('HISTORY_IMMUTABLE');
    } finally { w.close(); }
  });

  test('G27-C 半形专钉（席位 ③）：用**真实 actor** mint、形状逐列同形，无机制见证仍过不了闸；见证成立但 actor 为 NULL 亦拒（actor 判据专钉，复核补）；伪造见证可过——边界如实登记', () => {
    const w = open('g27-c');
    try {
      w.unloadCapability(CAP_RECORDS, ADM);
      const forged = routeRow(w).changed_seq! + 7;
      // 半形攻击：actor 用**真实管理员主体 id**（G5-A：actor 列本就是主体自报值，人人可写）。
      // 只做名字预留、守闸仍只查形状的半形修法下，这一行过闸 ⇒ 本断言红（变异实验 1）。
      w.raw.run(
        `insert into ledger(seq, space, event_type, actor, payload_json, recorded_at) values(?,?,?,?,?,?)`,
        forged, 'SP-G27', 'capability-enabled', 'g27adm', JSON.stringify({ capability: CAP_RECORDS }), 1,
      );
      expect(outcome(() => w.raw.run(
        `update capability_route set enabled=1, changed_seq=? where capability=?`, forged, CAP_RECORDS,
      ))).toContain('ROUTE_AUDIT_REQUIRED');
      // 见证不成立形（axis/authorized 造错）同样拒——核的是内容，不是「列非空」
      const forged2 = routeRow(w).changed_seq! + 8;
      w.raw.run(
        `insert into ledger(seq, space, event_type, actor, authority_basis, payload_json, recorded_at) values(?,?,?,?,?,?,?)`,
        forged2, 'SP-G27', 'capability-enabled', 'g27adm',
        JSON.stringify({ axis: 'space-write', capability: CAP_RECORDS, authorized: false }),
        JSON.stringify({ capability: CAP_RECORDS }), 1,
      );
      expect(outcome(() => w.raw.run(
        `update capability_route set enabled=1, changed_seq=? where capability=?`, forged2, CAP_RECORDS,
      ))).toContain('ROUTE_AUDIT_REQUIRED');
      // actor 判据专钉（第五席复核补，防「半形二」）：见证**完整成立**但 actor 为 NULL ⇒ 仍拒。
      // 没有这一断言，`l.actor is not null` 被短路就是无人能发现的变异（变异实验 M1b 专红于此）。
      const forged0 = routeRow(w).changed_seq! + 10;
      w.raw.run(
        `insert into ledger(seq, space, event_type, actor, authority_basis, payload_json, recorded_at) values(?,?,?,?,?,?,?)`,
        forged0, 'SP-G27', 'capability-enabled', null,
        JSON.stringify({ axis: 'capability-admin', capability: CAP_RECORDS, authorized: true }),
        JSON.stringify({ capability: CAP_RECORDS }), 1,
      );
      expect(outcome(() => w.raw.run(
        `update capability_route set enabled=1, changed_seq=? where capability=?`, forged0, CAP_RECORDS,
      ))).toContain('ROUTE_AUDIT_REQUIRED');
      // 诚实边界（CONTRACTS.md §16.3）：裸面连**见证列**一起伪造仍能过闸——预留把插件可达
      // mint 归零，把裸面伪造从「随便一行」抬到「必须在见证列撒谎」；痕迹不可删，处置归运维/审计。
      const forged3 = routeRow(w).changed_seq! + 9;
      w.raw.run(
        `insert into ledger(seq, space, event_type, actor, authority_basis, payload_json, recorded_at) values(?,?,?,?,?,?,?)`,
        forged3, 'SP-G27', 'capability-enabled', 'g27adm',
        JSON.stringify({ axis: 'capability-admin', capability: CAP_RECORDS, authorized: true }),
        JSON.stringify({ capability: CAP_RECORDS }), 1,
      );
      expect(outcome(() => w.raw.run(
        `update capability_route set enabled=1, changed_seq=? where capability=?`, forged3, CAP_RECORDS,
      ))).toBe('NO_REFUSAL');
      expect(w.raw.get<{ c: number }>(`select count(*) c from ledger where seq=?`, forged3)!.c).toBe(1);
    } finally { w.close(); }
  });

  test('G27-D 正例护栏：机制启停自带见证，停用/启用往返照常；审计行的 authority_basis 是机制信封', () => {
    const w = open('g27-d');
    try {
      w.unloadCapability(CAP_RECORDS, ADM);
      w.loadCapability(CAP_RECORDS, ADM);
      expect(routeRow(w).enabled).toBe(1);
      const rows = w.raw.all<{ event_type: string; actor: string; authority_basis: string | null }>(
        `select event_type, actor, authority_basis from ledger where event_type in ('capability-enabled','capability-disabled') order by seq`);
      expect(rows.map((r) => r.event_type)).toEqual(['capability-disabled', 'capability-enabled']);
      for (const r of rows) {
        expect(r.actor).not.toBeNull();
        expect(JSON.parse(r.authority_basis!)).toEqual({ axis: 'capability-admin', capability: CAP_RECORDS, authorized: true });
      }
    } finally { w.close(); }
  });
});
