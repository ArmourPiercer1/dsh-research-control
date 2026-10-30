/**
 * 演化轴攻击 3（第 3 轮后重构）—— 契约版本偏差：manifest contractVersion v1 → v2。
 *
 * 第 3 轮前的行为（本轴第 1 轮证伪）：contractVersion 纯装饰——持久路由的 v1 被
 * 静默覆盖进 v2 清单的内存视图；v1 payload 原样交给 v2 读取器（b===undefined 静默错答）；
 * requires[].contractVersion 从不参与装配判定。
 *
 * 第 3 轮（HEAD 2284a99）的契约（F-26/F-27）：
 *  - requires 版本 vs 生效 provider 版本不符 ⇒ 装配期 ACTIVATION_IMPOSSIBLE（F-26）；
 *  - 同一所有者换契约版本（持久路由版本 ≠ 清单声明版本）⇒ ACTIVATION_IMPOSSIBLE，
 *    消息要求"先迁移数据，再显式移交路由"（F-27）；
 *  - domain_state 行带写入时的 contract_version 戳，readRevision 精确引用读面
 *    assertContractVersion：行版本 ≠ 生效版本 ⇒ SCHEMA_INCOMPATIBLE。
 *
 * 本文件：
 *  - T1/T2/T3 守卫上述装配期判据（通过 = 守卫，失败 = 回归）；
 *  - T4a/T4b 探测**残留缺口**：跨所有者移交（v1 包 → v2 包）是机制内的合法路径，
 *    它产生"行戳 v1 / 路由 v2"的混合版本库——F-27 的装配检查只判"同一所有者"，
 *    跨所有者移交不触发；域内也没有 domain_state 回填器（READINESS D-6）。
 *    于是快照读面（readObject，主读面）与双时间读面（readAsOf）是否仍会把
 *    旧版本形状的 payload 静默交给新读取器？
 */
import { describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../../src/harness/paths.ts';
import { openWorld, PRINCIPAL, type World } from '../../src/harness/world.ts';
import { readAsOf } from '../../src/kernel/read-context.ts';
import { TEST_OBJECT_MODEL, TEST_OBJECT_MODEL_SPLIT, CAP_OBJECT_MODEL } from '../../src/domains/test-object-model.ts';
import { Refusal, asSpaceId, type ObjectOid, type PluginManifest } from '../../src/contracts/index.ts';

const ALICE = PRINCIPAL('alice');
const ADMIN = PRINCIPAL('admin');
const GRANTS = { alice: ['space-write'], admin: ['space-write', 'capability-admin'] };
const SPACE = 'SP-CVS';

/** 同一能力的 v2 契约实现：payload 形状新增必填字段 b（v1 形状只有 a）。 */
const SPLIT_V2: PluginManifest = {
  ...TEST_OBJECT_MODEL_SPLIT,
  provides: [{ capability: CAP_OBJECT_MODEL, contractVersion: 'v2' }],
};

/** 同一所有者换契约版本（F-27 的"同一实现"形态）。 */
const V2_SAME_OWNER: PluginManifest = {
  ...TEST_OBJECT_MODEL,
  codeVersion: '0.0.2',
  provides: [{ capability: CAP_OBJECT_MODEL, contractVersion: 'v2' }],
};

function freshWorld(prefix: string, plugins: readonly PluginManifest[]) {
  const dir = mkdtempSync(join(POC_DATA_DIR, prefix));
  const file = join(dir, 'world.db');
  const w = openWorld({ file, space: SPACE, grants: GRANTS, plugins });
  return { dir, file, w };
}

const dualTimeRead = (w: World) =>
  readAsOf(w.kernel, {
    space: asSpaceId(SPACE), principal: ALICE, mode: 'as-recorded',
    recordedAsOf: w.ledgerHead(), consistency: 'required',
  });

describe('evolution attacks: contractVersion v1 -> v2 (post round-3: F-26/F-27 guards + residual probe)', () => {
  test('guard: same owner re-opened with a changed contractVersion must be a decidable activation refusal (F-27)', () => {
    const dir = mkdtempSync(join(POC_DATA_DIR, 'evolution-cvs-sameowner-'));
    const file = join(dir, 'world.db');
    try {
      const w1 = openWorld({ file, space: SPACE, grants: GRANTS, plugins: [TEST_OBJECT_MODEL] });
      w1.close();

      // 机制必须**可判定**：要么装配期拒绝（版本不兼容），要么生效版本就是加载声明的 v2。
      // 静默沿用持久化的 v1 意味着"版本轴"不承载任何判定（第 1 轮证伪的形态）。
      let activated: World | undefined;
      let activationError: unknown;
      try {
        activated = openWorld({ file, space: SPACE, grants: GRANTS, plugins: [V2_SAME_OWNER] });
      } catch (e) { activationError = e; }
      const effective = activated?.kernel.registry.capability(CAP_OBJECT_MODEL)?.contractVersion;
      const declared = V2_SAME_OWNER.provides.find((p) => p.capability === CAP_OBJECT_MODEL)!.contractVersion;
      expect(
        activationError !== undefined || effective === declared,
        `装配静默成功且生效契约版本=${JSON.stringify(effective)}（持久路由的旧值），加载代码声明=${declared}：` +
          '机制对 contractVersion 偏差无任何可判定路径',
      ).toBe(true);
      if (activationError instanceof Refusal) expect(activationError.code).toBe('ACTIVATION_IMPOSSIBLE');
      activated?.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('guard: requires[].contractVersion mismatch against the effective provider must be decidable (F-26)', () => {
    const CONSUMER_V2: PluginManifest = {
      pluginId: 'consumer.v2', codeVersion: '1.0.0',
      provides: [{ capability: 'cap.consumer', contractVersion: 'v1' }],
      requires: [{ capability: CAP_OBJECT_MODEL, contractVersion: 'v2' }],
      storageNamespace: 'dom_consumer',
    };
    const dir = mkdtempSync(join(POC_DATA_DIR, 'evolution-cvs-requires-'));
    const file = join(dir, 'world.db');
    try {
      // 可判定断言（与 T1 同形）：要么装配期拒绝，要么生效版本等于声明版本。
      let w: World | undefined;
      let refusal: unknown;
      try {
        w = openWorld({ file, space: SPACE, grants: GRANTS, plugins: [TEST_OBJECT_MODEL, CONSUMER_V2] });
      } catch (e) { refusal = e; }
      const provider = w?.kernel.registry.capability(CAP_OBJECT_MODEL);
      const required = CONSUMER_V2.requires[0].contractVersion;
      expect(
        refusal !== undefined || (provider !== undefined && provider.contractVersion === required),
        `装配静默成功：consumer 声明 requires cap@${required}，实际 provider 契约版本=${provider?.contractVersion}；` +
          'requires[].contractVersion 从不参与装配判定（activate() 只查能力存在性）',
      ).toBe(true);
      if (refusal instanceof Refusal) {
        expect(refusal.code).toBe('ACTIVATION_IMPOSSIBLE');
        expect(refusal.detail?.required).toBe('v2');
        expect(refusal.detail?.effective).toBe('v1');
      }
      w?.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('contrast anchor: version-satisfied requires assembles (the gap is version matching, not the requires machinery)', () => {
    const CONSUMER_V1: PluginManifest = {
      pluginId: 'consumer.v1', codeVersion: '1.0.0',
      provides: [{ capability: 'cap.consumer', contractVersion: 'v1' }],
      requires: [{ capability: CAP_OBJECT_MODEL, contractVersion: 'v1' }],
      storageNamespace: 'dom_consumer',
    };
    const { dir, w } = freshWorld('evolution-cvs-anchor-', [TEST_OBJECT_MODEL, CONSUMER_V1]);
    try {
      expect(w.kernel.registry.capability('cap.consumer')).toBeDefined();
      expect(w.kernel.registry.capability(CAP_OBJECT_MODEL)?.contractVersion).toBe('v1');
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('residual T4a: cross-owner transfer v1 -> v2 produces a mixed-version DB that assembles; the SNAPSHOT surface must not silently serve v1-shaped rows to the v2 reader (F-27 gap)', () => {
    // 机制内合法序列：v1 包写对象（行戳 v1）→ 移交路由给 v2 包。
    // F-27 装配检查只判"同一所有者"，跨所有者移交不触发；域内没有 domain_state 回填器
    // （READINESS D-6）⇒ 混合版本库可装配、可打开。
    const dir = mkdtempSync(join(POC_DATA_DIR, 'evolution-cvs-cross-'));
    const file = join(dir, 'world.db');
    try {
      const w1 = openWorld({ file, space: SPACE, grants: GRANTS, plugins: [TEST_OBJECT_MODEL] });
      const oid = w1.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { a: 1 } }));
      const rowVersion = w1.raw.get<{ contract_version: string }>(
        `select contract_version from domain_state where oid=? and revision=1`, oid)!.contract_version;
      expect(rowVersion).toBe('v1'); // 前置：行确实按写入期版本打戳
      w1.transferCapability(CAP_OBJECT_MODEL, SPLIT_V2, ADMIN);
      w1.close();

      // 可达性锚点：新所有者（v2 清单）激活**不被拒绝**
      const w2 = openWorld({ file, space: SPACE, grants: GRANTS, plugins: [SPLIT_V2] });
      try {
        expect(w2.kernel.registry.capability(CAP_OBJECT_MODEL)?.contractVersion).toBe('v2');
        // 精确引用读面有行级版本判据（锚点：它拒绝）
        let exactRefused: unknown;
        try { w2.readRevision({ kind: 'revision-ref', oid, revision: 1 }); } catch (e) { exactRefused = e; }
        expect(exactRefused, '锚点：readRevision 的行级 assertContractVersion 应当拒绝').toBeInstanceOf(Refusal);
        expect(String((exactRefused as Refusal).code ?? exactRefused)).toMatch(/SCHEMA_INCOMPATIBLE/);

        // 快照读面（主读面）：v2 读者拿到的行若仍是 v1 形状，必须可判定（拒答或版本一致），
        // 不得静默——v1 形状 {a} 对 v2 契约（必填 b）是错答
        let snap: unknown;
        try { snap = w2.readObject(oid); } catch (e) { snap = e; }
        if (snap instanceof Refusal) return; // 可判定拒答 = 契约满足
        const silentV1 = snap !== undefined && (snap as { payload: Record<string, unknown> }).payload.b === undefined;
        expect(
          silentV1,
          `快照读面把 v1 形状 payload ${JSON.stringify((snap as { payload: unknown })?.payload)} 原样交给 v2 读者（b===undefined）；` +
            'readLatest 不读 domain_state.contract_version，行级版本判据只装在 readRevision 上',
        ).toBe(false);
      } finally { w2.close(); }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('residual T4b: the same mixed-version DB must not leak v1-shaped rows through the dual-time surface either (readAsOf row-level gate missing)', () => {
    const dir = mkdtempSync(join(POC_DATA_DIR, 'evolution-cvs-cross-dt-'));
    const file = join(dir, 'world.db');
    try {
      const w1 = openWorld({ file, space: SPACE, grants: GRANTS, plugins: [TEST_OBJECT_MODEL] });
      const oid = w1.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { a: 1 } }));
      w1.transferCapability(CAP_OBJECT_MODEL, SPLIT_V2, ADMIN);
      w1.close();

      const w2 = openWorld({ file, space: SPACE, grants: GRANTS, plugins: [SPLIT_V2] });
      try {
        const rows = dualTimeRead(w2).rows.filter((r) => r.oid === oid);
        const silentV1 = rows.length > 0 && rows[0].payload.b === undefined;
        expect(
          silentV1,
          `双时间读面返回 v1 形状行 ${JSON.stringify(rows[0]?.payload)}（b===undefined）：readAsOf 的行级过滤只过 routeNs（命名空间），` +
            '不过 domain_state.contract_version——与快照面同样的缺口',
        ).toBe(false);
      } finally { w2.close(); }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
