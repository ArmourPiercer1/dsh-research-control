/**
 * 演化轴攻击 3 —— 契约版本偏差：manifest contractVersion v1 → v2。
 *
 * 任务问题：机制层是否有**可判定的**不兼容路径？旧登记的 payload 形状与新读取器共存会怎样？
 *
 * 代码事实（静态核验，见 attacks/evolution 的 grep 证据）：
 *  - `capability_route.contract_version` 被持久化并被 `activate()` 覆盖进内存视图
 *    （kernel.ts:204-211），但**没有任何一处**把它与加载的 manifest `provides[].contractVersion`
 *    比较；
 *  - `activate()` 的依赖环检测（kernel.ts:98-114）只检查能力**存在性**，
 *    `requires[].contractVersion` 从参与判定；
 *  - `routeNs`（kernel.ts:145-154）只比较存储命名空间 ns，不比较契约版本。
 *
 * 被检验的契约：`PluginManifest.provides[].contractVersion` / `requires[].contractVersion`
 * 是契约面上被持久化、被回显的字段 ⇒ 机制必须对版本偏离开出一条可判定路径
 * （拒绝装配 / SCHEMA_INCOMPATIBLE），而不是让旧 payload 形状与新读取器静默共存。
 */
import { describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../../src/harness/paths.ts';
import { openWorld, PRINCIPAL, type World } from '../../src/harness/world.ts';
import { TEST_OBJECT_MODEL, CAP_OBJECT_MODEL } from '../../src/domains/test-object-model.ts';
import type { PluginManifest } from '../../src/contracts/index.ts';

const ALICE = PRINCIPAL('alice');
const GRANTS = { alice: ['space-write', 'capability-admin'] };

/** 同一能力的 v2 契约实现：payload 形状新增必填字段 b（v1 形状只有 a）。 */
const V2: PluginManifest = {
  ...TEST_OBJECT_MODEL,
  codeVersion: '0.0.2',
  provides: [{ capability: CAP_OBJECT_MODEL, contractVersion: 'v2' }],
};

function freshWorld(prefix: string, plugins: readonly PluginManifest[]) {
  const dir = mkdtempSync(join(POC_DATA_DIR, prefix));
  const file = join(dir, 'world.db');
  const w = openWorld({ file, space: 'SP-CVS', grants: GRANTS, plugins });
  return { dir, file, w };
}

describe('evolution attacks: contractVersion v1 -> v2 skew has no decidable mechanism path', () => {
  test('re-opening a v1-persisted space with a v2 manifest must be decidable (refuse or adopt the loaded version)', () => {
    const dir = mkdtempSync(join(POC_DATA_DIR, 'evolution-cvs-activate-'));
    const file = join(dir, 'world.db');
    try {
      const w1 = openWorld({ file, space: 'SP-CVS', grants: GRANTS, plugins: [TEST_OBJECT_MODEL] });
      w1.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { a: 1 } }));
      w1.close();

      // 以 v2 清单重开同一空间。机制必须**可判定**：要么装配期拒绝（版本不兼容），
      // 要么生效的契约版本就是加载代码声明的 v2。静默沿用持久化的 v1 意味着"版本轴"不承载任何判定。
      let activated: World | undefined;
      let activationError: unknown;
      try {
        activated = openWorld({ file, space: 'SP-CVS', grants: GRANTS, plugins: [V2] });
      } catch (e) { activationError = e; }
      const effective = activated?.kernel.registry.capability(CAP_OBJECT_MODEL)?.contractVersion;
      const declared = V2.provides.find((p) => p.capability === CAP_OBJECT_MODEL)!.contractVersion;
      expect(
        activationError !== undefined || effective === declared,
        `装配静默成功且生效契约版本=${JSON.stringify(effective)}（持久路由的旧值），加载代码声明=${declared}：` +
          '机制对 contractVersion 偏差无任何可判定路径',
      ).toBe(true);
      activated?.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('old-registered payload shape must not be handed to the new reader without a decidable signal', () => {
    const dir = mkdtempSync(join(POC_DATA_DIR, 'evolution-cvs-reader-'));
    const file = join(dir, 'world.db');
    try {
      const w1 = openWorld({ file, space: 'SP-CVS', grants: GRANTS, plugins: [TEST_OBJECT_MODEL] });
      const oid = w1.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { a: 1 } }));
      w1.close();

      const w2 = openWorld({ file, space: 'SP-CVS', grants: GRANTS, plugins: [V2] });
      try {
        // v2 读取器（合成）：形状上新增必填字段 b。
        const readAsV2 = (): { b: number } => {
          const snap = w2.readObject(oid)!;
          if (snap.payload.b === undefined) throw new Error('SILENT_WRONG_READ');
          return { b: snap.payload.b as number };
        };
        let mechanismSignal: unknown;
        let silentRead: unknown;
        try {
          silentRead = w2.readObject(oid);
          readAsV2();
        } catch (e) { mechanismSignal = e; }
        const decidable = mechanismSignal instanceof Error && /SCHEMA_INCOMPATIBLE|Refusal/.test(String(mechanismSignal.code ?? mechanismSignal.message));
        expect(
          decidable,
          `旧 v1 payload ${JSON.stringify(silentRead?.payload)} 被原样交给 v2 读取器（b===undefined ⇒ 静默错答）；` +
            '机制没有 SCHEMA_INCOMPATIBLE 之类的可判定信号（routeNs 只比 ns，不比契约版本）',
        ).toBe(true);
      } finally { w2.close(); }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('requires[].contractVersion is decorative: a v2 requirement silently assembles against a v1 provider', () => {
    const CONSUMER_V2: PluginManifest = {
      pluginId: 'consumer.v2', codeVersion: '1.0.0',
      provides: [{ capability: 'cap.consumer', contractVersion: 'v1' }],
      requires: [{ capability: CAP_OBJECT_MODEL, contractVersion: 'v2' }],
      storageNamespace: 'dom_consumer',
    };
    const { dir, w } = freshWorld('evolution-cvs-requires-', [TEST_OBJECT_MODEL, CONSUMER_V2]);
    try {
      // 装配已发生（openWorld 内部 activate）。若机制能判定版本满足性，它应当：
      // 拒绝装配（ACTIVATION_IMPOSSIBLE）——没有这条路径；或至少记录降级/不满足。
      const provider = w.kernel.registry.capability(CAP_OBJECT_MODEL);
      const required = CONSUMER_V2.requires[0].contractVersion;
      expect(
        provider !== undefined && provider.contractVersion === required,
        `装配静默成功：consumer 声明 requires cap@${required}，实际 provider 契约版本=${provider?.contractVersion}；` +
          'requires[].contractVersion 从不参与装配判定（activate() 只查能力存在性）',
      ).toBe(true);
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('contrast anchor: a version-satisfied requires assembles (the gap is version matching, not the requires machinery)', () => {
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
});
