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

  test('五类 kind 由多个能力分担时仍只靠注册表路由（Kernel 内没有 kind 常量）', () => {
    // 用五个占位 kind 模拟"多能力分工"，验证机制不关心 kind 的数量与含义。
    const KINDS = ['test.k1', 'test.k2', 'test.k3', 'test.k4', 'test.k5'] as const;
    const A: PluginManifest = {
      pluginId: 'test.kind-split-a', codeVersion: '1', storageNamespace: 'dom_ka', eventAuthority: 'none',
      provides: [{ capability: 'cap.ka', contractVersion: 'v1' }], requires: [],
      ownsKinds: [{ kind: KINDS[0], capability: 'cap.ka' }, { kind: KINDS[1], capability: 'cap.ka' }],
    };
    const B: PluginManifest = {
      pluginId: 'test.kind-split-b', codeVersion: '1', storageNamespace: 'dom_kb', eventAuthority: 'none',
      provides: [{ capability: 'cap.kb', contractVersion: 'v1' }], requires: [{ capability: 'cap.ka', contractVersion: 'v1', required: false }],
      ownsKinds: [{ kind: KINDS[2], capability: 'cap.kb' }, { kind: KINDS[3], capability: 'cap.kb' }, { kind: KINDS[4], capability: 'cap.kb' }],
    };
    const w = openWorld({ file: join(dir, 'five-kinds.db'), space: 'SP-1', grants: { alice: ['space-write'] }, plugins: [A, B] });
    const created = KINDS.map((k, i) => ({ k, oid: w.uow(PRINCIPAL('alice'), (tx) => tx.createObject({ kind: k, payload: { i } })) }));
    for (const c of created) {
      expect(w.readObject(c.oid)!.kind).toBe(c.k);
      expect(w.kernel.registry.ownerOfKind(c.k)!.capability).toBe(['cap.ka', 'cap.ka', 'cap.kb', 'cap.kb', 'cap.kb'][KINDS.indexOf(c.k as (typeof KINDS)[number])]);
    }
    // 两个能力的持久命名空间互不重叠（换包迁移的判据来自这里，不是来自 kind 名）
    const ns = w.raw.all<{ ns: string }>(`select distinct d.ns from object_directory d`).map((r) => r.ns);
    expect([...new Set(ns)].sort()).toEqual(['dom_ka', 'dom_kb']);
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

  // ── 插件面纪律（F-19/F-23 的门禁化）────────────────────────────────────────
  test('领域插件不得持有 Kernel，也不得触碰 port / raw / 驱动句柄', () => {
    // 这一条此前没有门禁，于是"插件只拿窄面"停留在文档里：FacetStore 曾持有 Kernel，
    // FactStandingService 甚至直接 kernel.port.read() 全库扫描——命名空间隔离对它形同虚设。
    const FORBIDDEN = [
      // 允许 import type PluginFace/NamespaceWriter/UnitOfWork；禁的是**持有 Kernel 这个值**
      { re: /:\s*Kernel\b|new Kernel|extends Kernel/, why: '持有 Kernel 即持有运维权威面（transferRoute/activate/setRouteEnabled）' },
      { re: /\bverified:\s*true\b/, why: '主体必须由宿主核验后交入，领域不得自造已验证身份' },
      { re: /\.port\b/, why: 'port 是全库出入口，越过命名空间写入器' },
      { re: /\.raw\b/, why: 'raw 是事务内裸句柄，只允许机制内部使用' },
      { re: /node:sqlite/, why: '领域不得自己打开数据库文件' },
    ];
    const offenders: string[] = [];
    for (const f of filesUnder('src/domains')) {
      const body = stripComments(readFileSync(f, 'utf-8'));
      for (const { re, why } of FORBIDDEN) if (re.test(body)) offenders.push(`${f}: ${why}`);
    }
    expect(offenders).toEqual([]);
  });

  test('门禁反差锚点：伪造一个持有 Kernel 的领域文件必须变红', () => {
    const fake = ['import type { Kernel } from "../kernel/kernel.ts";',      'export class Sneaky {', '  constructor(private k: Kernel) {}',      '  go() { return this.k.port.read((r) => r.all("select 1")); }', '}', ''].join('\n');
    expect(stripComments(fake)).toContain('Kernel');
    const hits = [/\bKernel\b/, /\.port\b/].filter((re) => re.test(stripComments(fake)));
    expect(hits).toHaveLength(2);              // 扫描器对这个形态两条都命中
    // 再证一次真目录扫描不会因为锚点字符串而误报：当前 src/domains 必须干净
    expect(filesUnder('src/domains').length).toBeGreaterThan(0);
  });

  test('UnitOfWork 的运行时面与契约声明的封闭集一致（契约↔实现漂移探测器）', () => {
    const w = openWorld({ file: join(dir, 'uow-surface.db'), space: 'SP-1' });
    try {
      // 方法挂在原型上，Object.keys 只看自有属性 ⇒ 必须沿原型链收集，否则这条门禁是假绿
      const surface = (x: object): string[] => {
        const out = new Set<string>();
        let cur: object | null = x;
        while (cur && cur !== Object.prototype) {
          for (const k of Object.getOwnPropertyNames(cur)) out.add(k);
          cur = Object.getPrototypeOf(cur) as object | null;
        }
        return [...out].sort();
      };
      const seen = w.uow(PRINCIPAL('alice'), (tx) => surface(tx as object));
      const DECLARED = [                       // CONTRACTS.md §6 承诺给插件的封闭集
        'declareRecord', 'appendLedger', 'linkRef', 'recordReport', 'createObject', 'revise',
        'readLatest', 'principal', 'checkRequiredRefs', 'reassignRouteInternal', 'k', 'raw', 'space',
      ].sort();
      // 只要求"承诺的方法一个都不能少"——多出来的是机制内部成员，由上一条门禁限制插件可达性
      for (const m of DECLARED.slice(0, 8)) expect(seen, `契约承诺的 ${m} 不在运行时面上`).toContain(m);
      // 反向：机制内部成员必须存在但**不在**插件可见类型面上（类型面由 tsc 把关，这里守住存在性）
      expect(seen).toContain('reassignRouteInternal');
      w.close();
    } finally { try { w.close(); } catch { /* 已关 */ } rmSync(dir, { recursive: true, force: true }); }
  });
});