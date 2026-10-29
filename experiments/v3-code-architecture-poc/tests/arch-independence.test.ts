/**
 * 架构独立性硬门（任务硬约束：「必须保证 Kernel 不包含科研语义判定规则」）。
 *
 * 每条扫描都配一个"变异锚点"：先在一段已知违规的源码上跑同一个扫描器并确认它报警，
 * 否则绿色不携带任何信息（扫描器可能只是没在工作）。
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR, POC_ROOT } from '../src/harness/paths.ts';
import { openWorld, PRINCIPAL } from '../src/harness/world.ts';
import { TEST_OBJECT_MODEL, CAP_OBJECT_MODEL } from '../src/domains/test-object-model.ts';
import type { PluginManifest } from '../src/contracts/index.ts';

const KERNEL_DIRS = ['src/kernel', 'src/contracts'];
/** 科研语义标识符：出现在 Kernel/契约的**代码**里即为违规。 */
const FORBIDDEN = [
  'Proposition', 'Association', 'Argumentation', 'Entity', 'Concept', 'AssertionID',
  'FactStanding', 'S-L1', 'S-L0', 'R-L1', 'R-L0', 'SL1', 'RL1', 'WITHHELD', 'UNVERIFIABLE',
  'NOT_ACHIEVED', 'NOT_APPLICABLE', 'AUTHORITY_UNVERIFIED', 'domain-admission',
  'test.claim', 'test.subject', 'test.relation', 'synth:',
];

const filesUnder = (rel: string): string[] => {
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)],
  );
  return walk(join(POC_ROOT, rel)).filter((f) => f.endsWith('.ts'));
};

/** 剥掉注释后再扫描：边界说明写在注释里是允许的，写进代码就是违规。 */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

const scanSemantics = (src: string): string[] => {
  const code = stripComments(src);
  return FORBIDDEN.filter((w) => {
    const esc = w.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
    return new RegExp(`(^|[^A-Za-z0-9_$.])${esc}([^A-Za-z0-9_$]|$)`).test(code);
  });
};

const importsOf = (src: string): string[] => [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);

let dir: string;
beforeAll(() => { dir = mkdtempSync(join(POC_DATA_DIR, 'arch-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

describe('架构独立性硬门', () => {
  test('扫描器本身会报警（变异锚点，否则绿色无意义）', () => {
    expect(scanSemantics(`if (kind === 'Proposition') return 'NOT_ACHIEVED';`)).toEqual(
      expect.arrayContaining(['Proposition', 'NOT_ACHIEVED']),
    );
    expect(scanSemantics(`// 本文件不得出现 Proposition 之类的词`)).toEqual([]); // 注释不算违规
  });

  test('Kernel 与契约代码中不含任何科研语义标识符', () => {
    const dirty = KERNEL_DIRS.flatMap((d) => filesUnder(d).map((f) => {
      const hits = scanSemantics(readFileSync(f, 'utf-8'));
      return hits.length > 0 ? { file: f.replace(POC_ROOT + '/', ''), hits } : null;
    })).filter(Boolean);
    expect(dirty).toEqual([]);
  });

  test('依赖方向：Kernel/契约不 import 领域、装配或具体存储驱动', () => {
    const bad = KERNEL_DIRS.flatMap((d) => filesUnder(d).flatMap((f) =>
      importsOf(readFileSync(f, 'utf-8'))
        .filter((s) => /domains|harness|storage-sqlite|product|node:sqlite/.test(s))
        .map((s) => `${f.replace(POC_ROOT + '/', '')} → ${s}`),
    ));
    expect(bad).toEqual([]);
    // 变异锚点：同样的扫描器能抓到反向依赖
    expect(importsOf(`import { x } from '../domains/foo.ts';`).filter((s) => /domains/.test(s))).toHaveLength(1);
  });

  test('领域不反向依赖装配层，也不绕过机制直接写核心表', () => {
    const offenders = filesUnder('src/domains').flatMap((f) => {
      const src = readFileSync(f, 'utf-8');
      const viaImport = importsOf(src).some((s) => /harness/.test(s));
      const rawWrite = /(insert|update|delete)\s+into\s+(object_directory|domain_state|ledger|ref_edge|check_report)/i
        .test(stripComments(src));
      return viaImport || rawWrite ? [f.replace(POC_ROOT + '/', '')] : [];
    });
    expect(offenders).toEqual([]);
  });

  test('新增第二个领域插件不需要改动 Kernel（面哈希 + 行为同时成立）', () => {
    const surface = [...KERNEL_DIRS.flatMap((d) => filesUnder(d))].sort();
    const hash = createHash('sha256');
    for (const f of surface) hash.update(readFileSync(f));
    const actual = hash.digest('hex');
    const baselineFile = join(POC_ROOT, 'KERNEL_SURFACE.sha256');
    const expected = readFileSync(baselineFile, 'utf-8').trim();
    expect(actual).toBe(expected);   // 变更 Kernel 面必须显式重生成基线并说明理由

    // 行为面：第二个插件带全新 kind 注册进来，Kernel 一行未改即可路由
    const SECOND: PluginManifest = {
      pluginId: 'test.second-model', codeVersion: '0.0.1',
      provides: [{ capability: 'cap.test.second', contractVersion: 'v1' }], requires: [],
      storageNamespace: 'dom_test_second', eventAuthority: 'none',
      ownsKinds: [{ kind: 'test.artifact', capability: 'cap.test.second' }],
    };
    const w = openWorld({ file: join(dir, 'two-models.db'), space: 'SP-1', grants: { alice: ['space-write'] }, plugins: [TEST_OBJECT_MODEL, SECOND] });
    const a = w.uow(PRINCIPAL('alice'), (tx) => tx.createObject({ kind: 'test.claim', payload: {} }));
    const b = w.uow(PRINCIPAL('alice'), (tx) => tx.createObject({ kind: 'test.artifact', payload: {} }));
    expect(w.readObject(a)!.kind).toBe('test.claim');
    expect(w.readObject(b)!.kind).toBe('test.artifact');
    // 两个 kind 由不同能力拥有：Kernel 只用注册表路由，没有任何 kind 常量
    expect(w.kernel.registry.ownerOfKind('test.artifact')!.capability).toBe('cap.test.second');
    expect(w.kernel.registry.ownerOfKind('test.claim')!.capability).toBe(CAP_OBJECT_MODEL);
    w.close();
  });

  test('必需代码依赖成环 ⇒ 拒绝装配，而不是半装配运行', () => {
    const X: PluginManifest = { pluginId: 'x', codeVersion: '1', provides: [{ capability: 'cx', contractVersion: 'v1' }], requires: [{ capability: 'cy', contractVersion: 'v1', required: true }], storageNamespace: 'dx' };
    const Y: PluginManifest = { pluginId: 'y', codeVersion: '1', provides: [{ capability: 'cy', contractVersion: 'v1' }], requires: [{ capability: 'cx', contractVersion: 'v1', required: true }], storageNamespace: 'dy' };
    expect(() => openWorld({ file: join(dir, 'cycle.db'), space: 'SP-1', plugins: [X, Y] })).toThrow(/ACTIVATION_IMPOSSIBLE/);
    // 反差锚点：去掉必需性即可装配 ⇒ 拒绝针对"必需依赖成环"，不是"存在依赖"
    expect(() => openWorld({
      file: join(dir, 'cycle-ok.db'), space: 'SP-1',
      plugins: [X, { ...Y, requires: [{ capability: 'cx', contractVersion: 'v1', required: false }] }],
    })).not.toThrow();
  });
});
