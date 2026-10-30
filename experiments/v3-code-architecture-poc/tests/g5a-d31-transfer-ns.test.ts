/**
 * D-31（包 6，席位 G5-A 反审，P1 可用性）：`transferRoute` 不携带 ns 变更，且入口 fail-loud。
 *
 * 席位事实（附录 A C1a/C1b/C1c 移植）：包 5 裁定「owner 一经登记不可变更」与移交携 ns 互斥，
 * 携新 ns 移交后既有对象 `readSnapshot`/`readLatest` 全抛 `SCHEMA_INCOMPATIBLE`、`readAsOf`
 * 整页炸死且不存在任何能通过的历史截点页——**一次完全合法、全走机制通道（capability-admin）
 * 的操作 = 永久毒化全库双时间读面**，重启持续。
 *
 * 修法（CONTRACTS.md §16.3，采纳席位签名判定「ns 参数根本不该存在」）：
 * `reassignRouteInternal` 删除 ns 参数（机制面无改 ns 通道）；`transferRoute` 把清单 ns 降为
 * **校验输入**：与当前生效路由 ns 不同 ⇒ 入口即拒 `TRANSFER_NS_DRIFT`（零半成品、不落账、
 * 不开事务）。ns 迁移另立显式通道（机制没有，不拿移交凑数）。正向对照（C1c）：同 ns 换包不变。
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../src/harness/paths.ts';
import { openWorld, PRINCIPAL, type World } from '../src/harness/world.ts';
import { readAsOf } from '../src/kernel/read-context.ts';
import { TEST_OBJECT_MODEL, TEST_OBJECT_MODEL_SPLIT, CAP_OBJECT_MODEL } from '../src/domains/test-object-model.ts';
import { Refusal, type CommitSequence, type ObjectOid } from '../src/contracts/index.ts';

const ADMIN = PRINCIPAL('g31admin');
const GRANTS = { g31admin: ['space-write', 'capability-admin'] };
/** 席位 C1a 的「换包并携新 ns」形态：只有 ns 不同。 */
const RENAMED_NS = { ...TEST_OBJECT_MODEL_SPLIT, storageNamespace: 'dom_g31_v2' };
/** C1c 正向对照：同 ns 换包。 */
const SAME_NS = { ...TEST_OBJECT_MODEL_SPLIT };

let dir: string;
beforeAll(() => { dir = mkdtempSync(join(POC_DATA_DIR, 'g5a-d31-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

const open = (name: string, space = 'SP-G31'): World =>
  openWorld({ file: join(dir, `${name}.db`), space, grants: GRANTS, plugins: [TEST_OBJECT_MODEL] });
const outcome = (fn: () => unknown): string => {
  try { fn(); return 'NO_REFUSAL'; }
  catch (e) { return (e as { code?: string }).code ?? 'OTHER'; }
};

describe('G5A-C1a（移植）：携新 ns 的移交在入口被拒，读面全程无恙', () => {
  test('G31-A 入口 TRANSFER_NS_DRIFT；零半成品（不落账、路由不动）；对象读面三形照常；重启后依旧', () => {
    const file = join(dir, 'g31-a.db');
    const w = open('g31-a');
    const oid = w.uow(ADMIN, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } })) as ObjectOid;
    const head = w.ledgerHead();
    let code = 'NO_REFUSAL'; let detail: Record<string, unknown> = {};
    try { w.transferCapability(CAP_OBJECT_MODEL, RENAMED_NS, ADMIN); }
    catch (e) { if (e instanceof Refusal) { code = e.code; detail = e.detail as Record<string, unknown>; } }
    expect(code).toBe('TRANSFER_NS_DRIFT');
    // detail 只回显调用方自己的输入 + 当前路由归属（跨空间不泄漏负例的基础，见 G31-D）
    expect(detail).toEqual({
      capability: CAP_OBJECT_MODEL, currentNs: 'dom_test_om', declaredNs: 'dom_g31_v2',
      reason: detail.reason, // 解释文本不参与形状钉
    });
    expect(w.ledgerHead(), '入口拒必须在落账之前：零半成品').toBe(head);
    expect(w.raw.get<{ ns: string; plugin_id: string }>(
      `select ns, plugin_id from capability_route where capability=?`, CAP_OBJECT_MODEL,
    )).toEqual({ ns: 'dom_test_om', plugin_id: 'test.object-model' });
    // 修前：这三步是「整库读面死亡」的现场；修后：什么都没有发生
    expect(w.readObject(oid)!.payload).toEqual({ v: 1 });
    expect(outcome(() => w.uow(ADMIN, (tx) => tx.readLatest(oid) ?? null))).toBe('NO_REFUSAL');
    w.close();
    const w2 = openWorld({ file, space: 'SP-G31', grants: GRANTS, plugins: [TEST_OBJECT_MODEL] });
    try {
      expect(w2.readObject(oid)!.payload).toEqual({ v: 1 }); // 毒化不残留（从未发生）
    } finally { w2.close(); }
  });

  test('G31-B 可用性面：被拒后同 oid 的快照/修订/双时间读照常；不存在「通不过的任何历史截点页」', () => {
    const w = open('g31-b');
    try {
      const oid = w.uow(ADMIN, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } })) as ObjectOid;
      expect(outcome(() => w.transferCapability(CAP_OBJECT_MODEL, RENAMED_NS, ADMIN))).toBe('TRANSFER_NS_DRIFT');
      // 席位 C1a 的可用性主张逐截点反钉：**每个**历史截点页都必须可读且含属主状态行
      for (let x = 1; x <= w.ledgerHead(); x += 1) {
        const page = readAsOf(w.kernel, {
          space: w.kernel.space, principal: ADMIN, mode: 'as-recorded', consistency: 'required',
          recordedAsOf: x as CommitSequence,
        });
        expect(page.rows.some((r) => r.oid === oid), `截点 ${x} 必须含属主状态行`).toBe(true);
      }
      expect(w.readRevision({ kind: 'revision-ref', oid, revision: 1 })!.payload).toEqual({ v: 1 });
      // 追加一个修订再验一遍（既有对象的后续写入不受入口拒影响）
      w.uow(ADMIN, (tx) => tx.revise(oid, { payload: { v: 2 } }));
      expect(w.readObject(oid)!.payload).toEqual({ v: 2 });
    } finally { w.close(); }
  });
});

describe('G5A-C1c（移植，正向对照）：同 ns 换包移交行为不变', () => {
  test('G31-C 换包（pluginId/contractVersion 变、ns 不动）：成功、路由 ns 恒等、对象照常、审计在位且带机制见证', () => {
    const w = open('g31-c');
    try {
      const oid = w.uow(ADMIN, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } })) as ObjectOid;
      expect(outcome(() => w.transferCapability(CAP_OBJECT_MODEL, SAME_NS, ADMIN))).toBe('NO_REFUSAL');
      expect(w.raw.get<{ ns: string; plugin_id: string }>(
        `select ns, plugin_id from capability_route where capability=?`, CAP_OBJECT_MODEL,
      )).toEqual({ ns: 'dom_test_om', plugin_id: 'test.object-model.split' });
      expect(w.readObject(oid)!.payload).toEqual({ v: 1 });
      // 目录身份冻结不因移交改变（D-28 语义保持）
      expect(w.raw.get<{ ns: string }>(`select ns from object_directory where oid=?`, oid)!.ns).toBe('dom_test_om');
      const aud = w.raw.all<{ event_type: string; payload_json: string; authority_basis: string | null }>(
        `select event_type, payload_json, authority_basis from ledger where event_type='capability-transferred'`);
      expect(aud).toHaveLength(1);
      expect(JSON.parse(aud[0]!.payload_json)).toEqual({
        capability: CAP_OBJECT_MODEL, from: 'test.object-model', to: 'test.object-model.split', ns: 'dom_test_om',
      });
      expect(JSON.parse(aud[0]!.authority_basis!)).toEqual({ axis: 'capability-admin', capability: CAP_OBJECT_MODEL, authorized: true });
      // 重启：持久行 = split 插件、原 ns，读面照常
      const w2 = openWorld({ file: join(dir, 'g31-c.db'), space: 'SP-G31', grants: GRANTS, plugins: [SAME_NS] });
      try { expect(w2.readObject(oid)!.payload).toEqual({ v: 1 }); } finally { w2.close(); }
    } finally { w.close(); }
  });
});

describe('TRANSFER_NS_DRIFT 存在性负例（拒绝码封闭集纪律：不得泄漏跨空间存在性）', () => {
  test('G31-D 有对象的空间与空空间对同一携 ns 移交给出逐字同形的拒绝——detail 不含任何存在性判别', () => {
    const withData = open('g31-d1');
    let d1: Record<string, unknown> | undefined;
    try {
      withData.uow(ADMIN, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } }));
      try { withData.transferCapability(CAP_OBJECT_MODEL, RENAMED_NS, ADMIN); }
      catch (e) { if (e instanceof Refusal) d1 = e.detail as Record<string, unknown>; }
    } finally { withData.close(); }
    const empty = open('g31-d2');
    let d2: Record<string, unknown> | undefined;
    try {
      try { empty.transferCapability(CAP_OBJECT_MODEL, RENAMED_NS, ADMIN); }
      catch (e) { if (e instanceof Refusal) d2 = e.detail as Record<string, unknown>; }
    } finally { empty.close(); }
    expect(d2).toEqual(d1); // 同输入同 detail：拒绝不回答「这里有没有东西」
  });
});
