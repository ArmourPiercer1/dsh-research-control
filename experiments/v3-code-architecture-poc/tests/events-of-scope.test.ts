/**
 * E-01：`PluginFace.eventsOf()` 的**作用域与授权**（外部复核提出，沿用 R3-A 先例）。
 *
 * 跨领域读历史是 H 系统的真实需求，但不等于任何领域插件都能无条件取回**他能力**对象的
 * 原始事件载荷。规则：默认只读本能力拥有的对象；跨命名空间需装配根
 * `grantCrossEventRead`（走既有 `capability-admin` 权威轴，不新增 AuthorityResource 枚举值）。
 *
 * 已知耦合（登记 P2，指向 D-12）：拒绝本身声明了"该 oid 存在且属他人"。
 * oid 若可预测，这就成了存在性 oracle——G1 须在"拒读"与"一律返回空"之间裁定，
 * 本文件把当前选择钉住，改动必然留下测试痕迹。
 */
import { describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../src/harness/paths.ts';
import { openWorld, PRINCIPAL } from '../src/harness/world.ts';
import { TEST_OBJECT_MODEL } from '../src/domains/test-object-model.ts';
import { CAP_OBJECT_MODEL } from '../src/domains/test-object-model.ts';
import type { PluginManifest } from '../src/contracts/index.ts';

/**
 * 未授权读者用**第二个能力**，不用 records：装配根的 `CROSS_EVENT_READ` 表本来就放行了 records，
 * 拿它当"未授权跨读"的例子会永远通过不了——那等于让被授权者去证明授权有效。
 */
const FOREIGN = 'cap.test.second';
const SECOND: PluginManifest = {
  pluginId: 'test.second-events', codeVersion: '0.0.1',
  provides: [{ capability: FOREIGN, contractVersion: 'v1' }], requires: [],
  storageNamespace: 'dom_test_second_evt', eventAuthority: 'none',
  ownsKinds: [{ kind: 'test.artifact', capability: FOREIGN }],
};

function setup(name: string) {
  const dir = mkdtempSync(join(POC_DATA_DIR, `evt-${name}-`));
  const w = openWorld({
    file: join(dir, 'space.db'), space: 'SP-EVT',
    grants: { admin: ['space-write', 'capability-admin'] },
    plugins: [TEST_OBJECT_MODEL, SECOND],
  });
  // test.claim 归对象模型能力所有 ⇒ 对 records 而言是"他能力"的对象
  const oid = w.uow(PRINCIPAL('admin'), (tx) => tx.createObject({ kind: 'test.claim', payload: { text: 'x' } }));
  // 事件类型不硬编码：从 ledger 实取，避免测试因机制事件改名而假绿/假红
  const et = w.raw.all<{ event_type: string }>(
    `select distinct event_type from ledger where object_id=?`, oid)[0]!.event_type;
  return { w, dir, oid, et, head: w.kernel.head };
}

describe('eventsOf 的作用域与授权（E-01）', () => {
  test('读自己能力拥有的对象 ⇒ 正常返回载荷', () => {
    const { w, dir, oid, et, head } = setup('own');
    try {
      const ev = w.kernel.faceFor(CAP_OBJECT_MODEL).eventsOf(oid, et, head);
      expect(ev.length).toBeGreaterThan(0);
      expect(ev[0]!.seq).toBeGreaterThan(0);
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('未授权读他能力对象 ⇒ NAMESPACE_ESCAPE，与 R3-A 封 revisionOf 同一拒绝码', () => {
    const { w, dir, oid, et, head } = setup('foreign');
    try {
      expect(() => w.kernel.faceFor(FOREIGN).eventsOf(oid, et, head)).toThrow(/NAMESPACE_ESCAPE/);
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('授权需 capability-admin；无该权威的主体不得自行开权', () => {
    const { w, dir, oid, et, head } = setup('grant-auth');
    try {
      expect(() => w.kernel.grantCrossEventRead(FOREIGN, PRINCIPAL('nobody'))).toThrow();
      // 未开权成功 ⇒ 跨读仍然被拒
      expect(() => w.kernel.faceFor(FOREIGN).eventsOf(oid, et, head)).toThrow(/NAMESPACE_ESCAPE/);
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('装配根授权后跨读放行，载荷可读回；撤销后恢复拒绝', () => {
    const { w, dir, oid, et, head } = setup('granted');
    try {
      w.kernel.grantCrossEventRead(FOREIGN, PRINCIPAL('admin'));
      expect(w.kernel.faceFor(FOREIGN).eventsOf(oid, et, head).length).toBeGreaterThan(0);
      w.kernel.revokeCrossEventRead(FOREIGN, PRINCIPAL('admin'));
      expect(() => w.kernel.faceFor(FOREIGN).eventsOf(oid, et, head)).toThrow(/NAMESPACE_ESCAPE/);
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('目录里没有的 oid ⇒ 不抛归属错、返回空集（不额外造存在性 oracle）', () => {
    const { w, dir } = setup('missing');
    try {
      const ghost = w.kernel.faceFor(FOREIGN).eventsOf(
        'OBJ-SP-EVT-999999' as never, 'whatever', w.kernel.head);
      expect(ghost).toEqual([]);
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
