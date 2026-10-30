/**
 * 独立复验席位 A —— G0（D-7/D-16/D-17）插件视角逃逸攻击（运行时面）。
 *
 * **双状态版本**：
 * - fa9c2d0（修复前）：本文件旧版实测 5/5 通过 = `.constructor → peekRaw` 逃逸成立（P1 已复现）；
 * - ccc1449（修复后）：本文件断言改为"构造器路径已闭合 + 对象图上无句柄"，
 *   并按协调要求扩展三个焦点：
 *     F1 构造器/原型/描述器穷举（tx、writer、face 三个插件可及对象）；
 *     F2 句柄除属性外的其它泄露形态（闭包、回调参数、异常携带、Error.cause、Reflect.apply）；
 *     F3（门禁绕过另行手工实验，见报告 §新发现）；
 *   另保留 symbol 通道残余强度（测试侧单列）与源码扫描旁路矩阵。
 *
 * 视角纪律：只使用插件实际拿得到的对象——`face = kernel.faceFor(cap)` 及其
 * writerFor/readOwn/eventsOf/revisionOf，以及 uow 回调参数 `tx`。测试侧额外持有
 * `w.kernel`/`w.raw` 的部分单独标注，不计入插件视角结论。
 *
 * 工程纪律：探针结果先收集成纯数据、在 uow 回调**外**断言——回调内抛错会被回滚
 * 路径接管，真实失败被 `database is not open` 盖掉（作者测试注释实测踩过）。
 *
 * 本文件位于 attacks/review/，不在门禁源码扫描面（src/domains、src/contracts）内。
 */
import { describe, expect, test } from 'vitest';
import { inspect } from 'node:util';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../../src/harness/paths.ts';
import { openWorld, PRINCIPAL } from '../../src/harness/world.ts';
import { TEST_OBJECT_MODEL, CAP_OBJECT_MODEL } from '../../src/domains/test-object-model.ts';
import { KERNEL_PORT } from '../../src/kernel/internal.ts';
import type { PluginManifest } from '../../src/contracts/index.ts';

const CAP_SECOND = 'cap.g0a.second';
const SECOND: PluginManifest = {
  pluginId: 'g0a.second', codeVersion: '0.0.1',
  provides: [{ capability: CAP_SECOND, contractVersion: 'v1' }], requires: [],
  storageNamespace: 'dom_g0a_second', eventAuthority: 'none',
  ownsKinds: [{ kind: 'test.artifact2', capability: CAP_SECOND }],
};

type Raw = {
  get(sql: string, ...p: unknown[]): unknown;
  all(sql: string, ...p: unknown[]): unknown[];
  run(sql: string, ...p: unknown[]): void;
};

const chainNames = (x: object): string[] => {
  const out = new Set<string>();
  let cur: object | null = x;
  while (cur && cur !== Object.prototype) {
    for (const n of Object.getOwnPropertyNames(cur)) out.add(n);
    cur = Object.getPrototypeOf(cur) as object | null;
  }
  return [...out].sort();
};
const chainSymbols = (x: object): string[] => {
  const out: string[] = [];
  let cur: object | null = x;
  while (cur && cur !== Object.prototype) {
    for (const s of Object.getOwnPropertySymbols(cur)) out.push(s.description ?? String(s));
    cur = Object.getPrototypeOf(cur) as object | null;
  }
  return out;
};
/** 构造器自身携带什么（剔除每个类都有的 length/name/prototype）——F1 核心判据 */
const ctorExtras = (o: object): string[] => {
  const ctor = Reflect.get(o, 'constructor') as object | undefined;
  if (!ctor || typeof ctor !== 'function') return ['<无 function 构造器>'];
  return [...Object.getOwnPropertyNames(ctor), ...Object.getOwnPropertySymbols(ctor).map(String)]
    .filter((n) => !['length', 'name', 'prototype'].includes(n));
};
/** 构造器上每个额外成员的取值器形状（value getter 也算）——F1 补充 */
const ctorDescriptors = (o: object): Record<string, string> => {
  const ctor = Reflect.get(o, 'constructor') as object | undefined;
  const out: Record<string, string> = {};
  if (!ctor || typeof ctor !== 'function') return out;
  for (const [k, d] of Object.entries(Object.getOwnPropertyDescriptors(ctor))) {
    out[k] = d.get ? 'getter' : typeof (d.value as unknown);
  }
  return out;
};
const safeStr = (e: unknown): string => String((e as Error)?.message ?? e).slice(0, 110);

describe('G0-A：插件视角逃逸攻击（D-7/D-16/D-17，ccc1449 后形态）', () => {
  test('F1+F2：tx/writer/face 穷举——构造器路径闭合、对象图无句柄、闭包/异常/回调无旁路', () => {
    const dir = mkdtempSync(join(POC_DATA_DIR, 'g0a-'));
    const w = openWorld({ file: join(dir, 'a.db'), space: 'SP-G0A', grants: { alice: ['space-write'] }, plugins: [TEST_OBJECT_MODEL, SECOND] });
    try {
      const omOid = w.uow(PRINCIPAL('alice'), (tx) => tx.createObject({ kind: 'test.claim', payload: { text: 'OM-SECRET-PAYLOAD' } }));
      const s2Oid = w.uow(PRINCIPAL('alice'), (tx) => tx.createObject({ kind: 'test.artifact2', payload: { text: 'SECOND-NS-PAYLOAD' } }));
      const face = w.kernel.faceFor(CAP_OBJECT_MODEL);

      let escaped: Raw | undefined;
      const R = w.uow(PRINCIPAL('alice'), (tx) => {
        const writer = face.writerFor(tx);
        const txObj = tx as object;
        const wObj = writer as object;
        const fObj = face as object;
        const ctor = Reflect.get(tx, 'constructor') as { name?: string; peekRaw?: (t: unknown) => Raw };

        // ── 穷举枚举面（记录）──
        const enumTx = {
          ownNames: Object.getOwnPropertyNames(txObj),
          ownSymbols: Object.getOwnPropertySymbols(txObj).map((s) => s.description ?? '?'),
          forIn: Object.keys(txObj),
          reflectOwnKeys: Reflect.ownKeys(txObj).map(String),
          chainNames: chainNames(txObj),
          chainSymbols: chainSymbols(txObj),
          json: (() => { try { return JSON.stringify(txObj); } catch (e) { return 'ERR ' + safeStr(e); } })(),
          utilInspect: inspect(txObj, { depth: 8, showHidden: true }).replace(/\n/g, ' '),
        };
        const enumWriter = {
          ownNames: Object.getOwnPropertyNames(wObj),
          chainNames: chainNames(wObj),
          chainSymbols: chainSymbols(wObj),
          json: (() => { try { return JSON.stringify(wObj); } catch (e) { return 'ERR ' + safeStr(e); } })(),
        };
        const enumFace = {
          ownNames: Object.getOwnPropertyNames(fObj),
          chainNames: chainNames(fObj),
          chainSymbols: chainSymbols(fObj),
          json: (() => { try { return JSON.stringify(face); } catch (e) { return 'ERR ' + safeStr(e); } })(),
          writerForSrc: face.writerFor.toString().slice(0, 120),
        };

        // ── F1：构造器路径（旧 P1 的通道）──
        const f1 = {
          txCtorName: ctor?.name,
          txPeekRawPresent: 'peekRaw' in ctor,
          txCtorExtras: ctorExtras(txObj),
          txCtorDescriptors: ctorDescriptors(txObj),
          writerCtorName: (Reflect.get(wObj, 'constructor') as { name?: string })?.name,
          writerCtorExtras: ctorExtras(wObj),
          writerCtorDescriptors: ctorDescriptors(wObj),
          faceCtorName: (Reflect.get(fObj, 'constructor') as { name?: string })?.name,
          faceCtorExtras: ctorExtras(fObj),
          // 原型链上可调用入口逐个点名（记录哪些机制内部成员仍挂在运行时面）
          txProtoMethods: Object.getOwnPropertyNames(Object.getPrototypeOf(txObj)),
          writerProtoMethods: Object.getOwnPropertyNames(Object.getPrototypeOf(wObj)),
        };

        // ── F2-1：闭包与 Receiver 劫持 ──
        let receiverHijack = '';
        try {
          // 箭头函数忽略 this 参数：拿伪造 this 调 writerFor，看能否换出 kernel
          const fakeThis = { marker: 'EVIL-THIS' };
          const out = Reflect.apply(face.writerFor, fakeThis, [tx]);
          receiverHijack = `returned=${(out as object).constructor?.name} (arrow 忽略 this，仍走原闭包)`;
        } catch (e) { receiverHijack = 'THROW ' + safeStr(e); }
        let callTry = '';
        try {
          // Function.prototype.call 直调（非箭头场景的通用手法）
          (face.readOwn as unknown as (...a: unknown[]) => unknown).call({ marker: 'EVIL-THIS' }, omOid);
          callTry = 'no-throw';
        } catch (e) { callTry = 'THROW ' + safeStr(e); }

        // ── F2-2：异常携带 / Error.cause ──
        const errProbe: Record<string, string> = {};
        try {
          face.revisionOf({ kind: 'revision-ref', oid: s2Oid, revision: 1 });
          errProbe.revisionOf = 'NO-THROW?!';
        } catch (e) {
          const err = e as Error & Record<string, unknown>;
          errProbe.revisionOf = `code=${(err as { code?: string }).code} ownNames=[${Object.getOwnPropertyNames(err)}] cause=${JSON.stringify(err.cause ?? null)}`;
          errProbe.revisionOfProto = Object.getOwnPropertyNames(Object.getPrototypeOf(err)).join(',');
          // 异常对象上是否有可调用物
          errProbe.revisionOfCallables = Object.entries(Object.getOwnPropertyDescriptors(err))
            .filter(([, d]) => typeof d.value === 'function').map(([k]) => k).join(',') || '无';
        }
        let authErr = '';
        try {
          // 机制内部方法仍挂在原型上（作者测试甚至断言其存在）：以非 admin 主体调用
          (tx as unknown as { reassignRouteInternal: (c: string, m: PluginManifest, n: string, v: string) => void })
            .reassignRouteInternal(CAP_OBJECT_MODEL, SECOND, 'dom_g0a_second', 'v1');
          authErr = 'NO-THROW?!';
        } catch (e) {
          const err = e as Error & Record<string, unknown>;
          authErr = `code=${(err as { code?: string }).code} ownNames=[${Object.getOwnPropertyNames(err)}]`;
        }

        // ── 旧逃逸通道的复测（ccc1449 下应已不存在）──
        try { escaped = ctor.peekRaw ? ctor.peekRaw(tx) : undefined; } catch (e) { escaped = undefined; }
        const direct = {
          txRaw: (tx as unknown as { raw?: unknown }).raw,
          txK: (tx as unknown as { k?: unknown }).k,
          txPort: (tx as unknown as { port?: unknown }).port,
          writerK: (wObj as { k?: unknown }).k,
          writerRaw: (wObj as { raw?: unknown }).raw,
          writerPort: (wObj as { port?: unknown }).port,
        };
        return { enumTx, enumWriter, enumFace, f1, receiverHijack, callTry, errProbe, authErr, direct, hasPeekRaw: !!ctor?.peekRaw };
      });

      console.log('[G0A-SURFACE-POSTFIX]', JSON.stringify(R, null, 1));

      // ── 断言：F1 构造器路径闭合 ──
      expect(R.f1.txCtorName).toBe('UnitOfWorkImpl');
      expect(R.f1.txPeekRawPresent).toBe(false);
      expect(R.f1.txCtorExtras).toEqual([]);
      expect(R.f1.writerCtorExtras).toEqual([]);
      // face 是普通对象字面量：构造器为 Object，其"额外成员"全是 JS 内置静态，不构成机制通道
      expect(R.f1.faceCtorName).toBe('Object');
      expect(R.f1.faceCtorExtras.every((n) => n in Object)).toBe(true);
      expect(escaped).toBeUndefined();
      // 直读面仍然封住
      expect(R.direct.txRaw).toBeUndefined();
      expect(R.direct.txK).toBeUndefined();
      expect(R.direct.txPort).toBeUndefined();
      expect(R.direct.writerK).toBeUndefined();
      expect(R.direct.writerRaw).toBeUndefined();
      expect(R.direct.writerPort).toBeUndefined();
      // 枚举面：实例自有面只有 principal / cap / face 六个成员
      expect(R.enumTx.ownNames).toEqual(['principal']);
      expect(R.enumTx.chainSymbols).toEqual([]);
      expect(R.enumTx.json).not.toMatch(/raw|port|kernel/i);
      expect(R.enumWriter.ownNames).toContain('cap'); // TS private 的 cap 仍是自有字段（P2 信息泄露，保留证据）
      // ── 断言：F2 无旁路 ──
      expect(R.receiverHijack).toMatch(/returned=NamespaceWriterImpl/); // 返回的是 writer（设计内），不是 kernel
      expect(R.errProbe.revisionOf).toMatch(/code=NAMESPACE_ESCAPE/);
      expect(R.errProbe.revisionOfCallables).toBe('无');
      expect(R.errProbe.revisionOf).toMatch(/cause=null/);
      expect(R.authErr).toMatch(/code=AUTHORITY_?DENIED|code=AUTHORITY/);
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('F2-3：无插件可见路径改写 capability_route（旧逃逸 DML 的影响面已断）', () => {
    const dir = mkdtempSync(join(POC_DATA_DIR, 'g0a-hijack-'));
    const file = join(dir, 'h.db');
    const opts = { file, space: 'SP-G0A-H', grants: { alice: ['space-write'] }, plugins: [TEST_OBJECT_MODEL, SECOND] };
    const w1 = openWorld(opts);
    w1.uow(PRINCIPAL('alice'), (tx) => tx.createObject({ kind: 'test.artifact2', payload: { text: 'hijack-target' } }));
    // 插件视角唯一"像路由改写"的入口：机制内部方法，但需 capability-admin
    let attempted: string;
    try {
      w1.uow(PRINCIPAL('alice'), (tx) => {
        (tx as unknown as { reassignRouteInternal: (c: string, m: PluginManifest, n: string, v: string) => void })
          .reassignRouteInternal(CAP_SECOND, SECOND, 'dom_evil_attacker', 'v1');
      });
      attempted = 'NO-THROW?!（路由可能被改写！）';
    } catch (e) { attempted = 'REFUSED ' + safeStr(e); }
    // 测试侧核对 DB：路由未被篡改
    const nsAfter = w1.raw.get('select ns from capability_route where capability=?', CAP_SECOND) as { ns: string };
    w1.close();
    console.log('[G0A-HIJACK-POSTFIX]', JSON.stringify({ attempted, nsAfter: nsAfter.ns }));
    expect(attempted).toMatch(/^REFUSED/);
    expect(nsAfter.ns).toBe('dom_g0a_second');
    rmSync(dir, { recursive: true, force: true });
  });

  test('symbol 通道残余强度（测试侧持有 kernel，单列）：无需 import internal.ts 即可重导出 port', () => {
    const dir = mkdtempSync(join(POC_DATA_DIR, 'g0a-sym-'));
    const file = join(dir, 's.db');
    const w = openWorld({ file, space: 'SP-G0A-S', grants: { a: ['space-write'] } });
    try {
      const proto = Object.getPrototypeOf(w.kernel) as object;
      const syms = Object.getOwnPropertySymbols(proto);
      const derived = syms.find((s) => s.description === 'KERNEL_PORT');
      expect(derived).toBeDefined();
      expect(derived).toBe(KERNEL_PORT);
      const port = Reflect.get(w.kernel, derived!) as {
        file: string;
      } & Record<string, unknown>;
      expect(port.file).toBe(file);
      const portOwn = Object.getOwnPropertyNames(port);
      const adapter = Reflect.get(port, 'adapter') as { db: { prepare(q: string): { get(): unknown } } };
      const count = (adapter.db.prepare('select count(*) c from sqlite_master').get() as { c: number }).c;
      console.log('[G0A-SYMBOL]', JSON.stringify({ portOwn, sqliteMasterRows: count }));
      expect(count).toBeGreaterThan(5);
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('globalThis 无机制句柄残留（含 WeakMap 修复后复测）', () => {
    const keys = Object.getOwnPropertyNames(globalThis).filter((k) => /kernel|sqlite|peekRaw|UnitOfWork|SqlitePort|storagePort|RAW_OF_UOW/i.test(k));
    console.log('[G0A-GLOBAL]', JSON.stringify(keys));
    expect(keys).toEqual([]);
  });

  test('门禁旁路矩阵（静态复算）：攻击代码的可行形态可穿过领域源码扫描', () => {
    const FORBIDDEN = [
      { re: /:\s*Kernel\b|new Kernel|extends Kernel/, why: 'Kernel' },
      { re: /\bverified:\s*true\b/, why: 'verified' },
      { re: /:\s*any\b|as any\b|<any>/, why: 'any' },
      { re: /as unknown as /, why: 'dbl-assert' },
      { re: /@ts-(ignore|expect-error|nocheck)/, why: 'ts-directive' },
      { re: /\.port\b/, why: 'port' },
      { re: /\.raw\b/, why: 'raw' },
      { re: /node:sqlite/, why: 'node:sqlite' },
    ];
    const stripComments = (src: string): string =>
      src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
    const hits = (src: string): string[] =>
      FORBIDDEN.filter(({ re }) => re.test(stripComments(src))).map((x) => x.why);

    // ccc1449 后：Reflect.get 构造器形态不再能取到句柄（peekRaw 已删），
    // 但"绕过源码扫描"这一性质仍在——攻击者改目标名即可，扫描本身没有变强。
    // 这里复算的是：旧 P1 的攻击形态在扫描器下是绿的（说明门禁从未覆盖构造器路径，
    // 只能靠 ccc1449 新增的"构造器静态面断言"兜底——那条断言的覆盖面见报告裁定）。
    const legacyAttack = [
      "import type { UnitOfWork } from '../kernel/kernel.ts';",
      'export class Attacker {',
      '  esc: unknown;',
      '  capture(tx: UnitOfWork): void {',
      "    const ctor = Reflect.get(tx, 'constructor');",
      '    this.esc = ctor.peekRaw ? ctor.peekRaw(tx) : null;',
      '  }',
      '}',
    ].join('\n');
    console.log('[G0A-SCAN]', JSON.stringify({ legacyAttackHits: hits(legacyAttack) }));
    expect(hits(legacyAttack)).toEqual([]);

    const d7 = /from\s+'[^']*kernel\/internal\.ts'/;
    expect(d7.test('import { KERNEL_PORT } from "../kernel/internal.ts";')).toBe(false);
    expect(d7.test('import { KERNEL_PORT } from "../kernel/internal.ts";'.replace(/"/g, "'"))).toBe(true);
    expect(d7.test('const m = await import("../kernel/internal.ts");')).toBe(false);
  });
});
