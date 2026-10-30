// 【边界收窄 · 席位 G1-A 实测】本文件所称「墙 / 运行时作用域上界」只对经 Kernel.uowFor(cap,…) 取得
// 的事务生效；装配根把 uow() 全权事务交进领域对象的路径（D-22）上没有该执行点，只有词法网。
// 权威表述见 CONTRACTS.md §16。D-19c 的"已收口"仅在该限定路径内成立。
/**
 * D-19c：**领域写面门禁**（外部复审第三轮，2026-10-30）。
 *
 * ## 本文件分两段，顺序即判据优先级
 *
 * 1. **墙（运行时上界，主判据）**——领域拿到的是 **scoped tx**（`kernel.uowFor(cap, …)`）或
 *    **能力作用域端口**（`face.writerFor(tx)`），通用 `createObject / revise / linkRef` 在
 *    它们身上跨归属就是 `CAPABILITY_SCOPE_ESCAPE`。这是机制保证，与源码怎么写无关。
 * 2. **网（词法扫描，防遗忘）**——`src/domains/**` 里出现通用写面即红。它的用途只有一个是
 *    诚实的：**提醒作者别把跨归属写偷偷留在领域代码里**。
 *
 * **判据顺序**：墙失效 = 洞（可被利用的越权）；网失效 = 退化（少了一道提醒，墙仍在）。
 * 因此下面任何一条扫描红都**不得**被写成"领域越权已被阻止"的证据；那句话由墙负责。
 *
 * ## 词法扫描的边界（自曝，不声称做不到的事）
 *
 * 本门只拦**写成 `x.<成员名>(` 或裸标识符**的调用。以下形态它**扫不到**，且下面有一条测试
 * 专门断言"扫不到"（`负空间` 用例）：
 *   · 别名后再取成员？——**这一类我们能抓**（本门按裸标识符匹配，不按 `tx.` 前缀，比最低要求严）；
 *   · 计算属性 / 拼接成员名：`const m='rev'+'ise'; (tx as any)[m](…)` ⇒ **扫不到**；
 *   · 反射：`Object.getPrototypeOf(tx)` 上取名字再调用 ⇒ **扫不到**。
 * 之所以仍要它：这类绕过需要作者**主动**伪装，而历史上的 12 例红（EVIDENCE.md D-19c 节）
 * 是明写的 `tx.createObject(...)`。网拦的是"顺手写歪"，墙拦的是"想绕"。
 *
 * ## 白名单准入判据（谁能进、凭什么）
 *
 * | 目录 | 角色 | 准入判据 | 规则 |
 * | --- | --- | --- | --- |
 * | `src/kernel`、`src/contracts` | 机制本身 | 写面的**实现处**，没有"实现者不得调用自己的成员"这种道理 | 不扫描；但 `src/` 顶层目录清单被钉死，新增目录不会悄悄变成豁免 |
 * | `src/app` | **Application Use-case** | ① 由装配根构造；② 只经 `UseCaseDelegation` 拿**对象拥有者的作用域端口**落笔；③ 不自开事务、不持 `uow/port/raw`；④ 业务判据一律来自领域草稿 | 禁 `createObject/revise/linkRef/declareRecord`；`appendLedger` 每处必须带 `D-19c-ALLOWED` 行内标记，且全部命中行会被列出来供逐条复核 |
 * | `src/harness` | **装配根**（#44 §4 `product/`） | 同上，且它是唯一构造 Kernel / 授予委派的地方 | 同 `src/app`，**再加一条**：装配根一处直接写都不许有（带标记的 `appendLedger` 也不行）——要开这口子必须先改本表，并明确改掉那条判据 |
 * | 其余 `src/**`（如 `src/storage-sqlite`） | 未准入 | 没登记 = 与领域同等对待 | 按领域规则扫（零通用写面） |
 *
 * "白名单不是一条豁免，是一份要逐条签字的清单"：标记缺失、标记了但不在准入目录、
 * 新目录想混进来，三条都会红。
 */
import { describe, expect, test } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR, POC_ROOT } from '../src/harness/paths.ts';
import { openWorld, PRINCIPAL } from '../src/harness/world.ts';
import { TEST_OBJECT_MODEL, CAP_OBJECT_MODEL } from '../src/domains/test-object-model.ts';
import { CAP_RECORDS } from '../src/domains/test-records.ts';
import type { PluginManifest } from '../src/contracts/index.ts';

/** 跨归属用的第二个能力（拥有 test.artifact）。 */
const CAP_SECOND = 'cap.test.second';
const SECOND: PluginManifest = {
  pluginId: 'test.second-write-face', codeVersion: '0.0.1',
  provides: [{ capability: CAP_SECOND, contractVersion: 'v1' }], requires: [],
  storageNamespace: 'dom_test_second_wf', eventAuthority: 'none',
  ownsKinds: [{ kind: 'test.artifact', capability: CAP_SECOND }],
};

// ── 扫描器 ────────────────────────────────────────────────────────────────────
const MECHANISM_DIRS = ['src/kernel', 'src/contracts'];
const WHITELIST_DIRS: readonly string[] = ['src/app', 'src/harness'];
/** 标记：白名单里每一处机制级 H 写入都要签字，否则红。 */
const MARKER = 'D-19c-ALLOWED';
/** 领域（含未准入目录）一律禁止的通用写面成员名。 */
const BANNED_ALL = ['createObject', 'revise', 'linkRef', 'appendLedger', 'declareRecord'] as const;
/** 白名单里额外禁止的：跨归属**对象**写面（appendLedger 走标记制）。 */
const BANNED_IN_WHITELIST = ['createObject', 'revise', 'linkRef', 'declareRecord'] as const;

const filesUnder = (rel: string): string[] => {
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)],
  );
  return walk(join(POC_ROOT, rel)).filter((f) => f.endsWith('.ts'));
};
/** 注释里写"这里以前调用过 tx.createObject"是允许的，写进代码就是违规。 */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

/** 按**裸标识符**命中（不按 `tx.` 前缀）：换变量名、换接收者都跑不掉。 */
const hitsOf = (src: string, names: readonly string[]): string[] => {
  const code = stripComments(src);
  return names.filter((w) => new RegExp(`(^|[^A-Za-z0-9_$])${w}([^A-Za-z0-9_$]|$)`).test(code));
};
/** 逐行找 `appendLedger` 调用（行级判定，标记必须在**同一行**）。 */
const unmarkedAppends = (f: string, src: string): string[] =>
  src.split('\n').flatMap((line, i) => {
    const code = stripComments(line);
    if (!/\.\s*appendLedger\s*\(/.test(code)) return [];
    return line.includes(MARKER) ? [] : [`${f}:${i + 1}  appendLedger 无 ${MARKER} 标记`];
  });
const markedAppends = (f: string, src: string): string[] =>
  src.split('\n').flatMap((line, i) =>
    (/\.\s*appendLedger\s*\(/.test(stripComments(line)) && line.includes(MARKER))
      ? [`${f}:${i + 1}  ${line.trim().slice(0, 120)}`] : []);

const srcTopDirs = (): string[] =>
  readdirSync(join(POC_ROOT, 'src'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => `src/${d.name}`);

const ADMIN = PRINCIPAL('wf-admin');
/** 每个用例一个临时库：固定文件名会让上一轮留下的行参与这一轮的判据（假绿/假红都可能）。 */
const world = (name: string): { w: ReturnType<typeof openWorld>; dir: string } => {
  const dir = mkdtempSync(join(POC_DATA_DIR, `wf-${name}-`));
  const w = openWorld({
    file: join(dir, 'space.db'), space: 'SP-WF',
    grants: { 'wf-admin': ['space-write', 'capability-admin'] },
    plugins: [TEST_OBJECT_MODEL, SECOND],
  });
  return { w, dir };
};
const close = ({ w, dir }: { w: { close(): void }; dir: string }): void => {
  try { w.close(); } catch { /* 已关 */ }
  rmSync(dir, { recursive: true, force: true });
};

describe('D-19c 墙：scoped tx 上的通用写面受归属上界约束（主判据）', () => {
  // 运行时才是墙。扫描器全绿而这里红了，才是洞；反过来扫描红了只是"有人忘了接线"。
  test('领域 scoped tx 跨归属用通用写面 ⇒ CAPABILITY_SCOPE_ESCAPE（create/revise/linkRef 三面全测）', () => {
    const ctx = world('wall-cross');
    const w = ctx.w;
    try {
      const foreign = w.uow(ADMIN, (tx) => tx.createObject({ kind: 'test.artifact', payload: { v: 1 } }));
      const code = (fn: () => unknown): string => {
        try { fn(); return 'NO_REFUSAL'; } catch (e) { return (e as { code?: string }).code ?? 'OTHER'; }
      };
      // ① 创建别人拥有的 kind
      expect(code(() => w.uowFor(CAP_OBJECT_MODEL, ADMIN, (tx) => tx.createObject({ kind: 'test.artifact', payload: {} }))))
        .toBe('CAPABILITY_SCOPE_ESCAPE');
      // ② 修订别人拥有的对象
      expect(code(() => w.uowFor(CAP_OBJECT_MODEL, ADMIN, (tx) => tx.revise(foreign, { payload: { pwned: true } }))))
        .toBe('CAPABILITY_SCOPE_ESCAPE');
      // ③ 以别人的对象为源挂引用边
      expect(code(() => w.uowFor(CAP_OBJECT_MODEL, ADMIN, (tx) => tx.linkRef({
        from: { kind: 'revision-ref', oid: foreign, revision: 1 },
        to: { kind: 'record-ref', recordId: 'X' }, role: 'pwn', required: false,
      }))))
        .toBe('CAPABILITY_SCOPE_ESCAPE');
      // ④ 记录域（不拥有任何 kind）拿 scoped tx 后连 test.claim 都创建不了
      //    —— 这正是 D-19c 迁移时把 12 例打红的那条判据；当时它被当作"迁移失败"，
      //    现在它是**负例**：领域代码本来就不该这么写（EVIDENCE.md D-19c 节的活案例）。
      expect(code(() => w.uowFor(CAP_RECORDS, ADMIN, (tx) => tx.createObject({ kind: 'test.claim', payload: {} }))))
        .toBe('CAPABILITY_SCOPE_ESCAPE');
      // 拒绝必须发生在写入之前
      expect(w.readObject(foreign)!.payload.pwned).toBeUndefined();
    } finally { close(ctx); }
  });

  test('正例：scoped tx 改自己拥有的对象照常成功（否则墙等于把领域写权一并废掉）', () => {
    const ctx = world('wall-own');
    const w = ctx.w;
    try {
      const own = w.uow(ADMIN, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } }));
      expect(w.uowFor(CAP_OBJECT_MODEL, ADMIN, (tx) => tx.revise(own, { payload: { v: 2 }, expectedRevision: 1 }))).toBe(2);
      expect(w.uowFor(CAP_OBJECT_MODEL, ADMIN, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } }))).toContain('OBJ-SP-WF-');
      // 第二个能力只能写自己的 kind：写 test.claim 同样被拒（墙对每个能力一样硬）
      let code = '';
      try { w.uowFor(CAP_SECOND, ADMIN, (tx) => tx.createObject({ kind: 'test.claim', payload: {} })); }
      catch (e) { code = (e as { code?: string }).code ?? ''; }
      expect(code).toBe('CAPABILITY_SCOPE_ESCAPE');
    } finally { close(ctx); }
  });

  test('扫描扫不到的动态派发写法，运行时仍被墙拦下（网漏 ≠ 墙漏）', () => {
    const ctx = world('wall-dynamic');
    const w = ctx.w;
    try {
      const foreign = w.uow(ADMIN, (tx) => tx.createObject({ kind: 'test.artifact', payload: { v: 1 } }));
      // 成员名是拼出来的，任何词法扫描都看不到 "revise" 这个标识符
      const out = w.uowFor(CAP_OBJECT_MODEL, ADMIN, (tx) => {
        const m = ['rev', 'ise'].join('');
        try { (tx as never as Record<string, (o: unknown, a: unknown) => unknown>)[m](foreign, { payload: { pwned: true } }); return 'NO_REFUSAL'; }
        catch (e) { return (e as { code?: string }).code ?? 'OTHER'; }
      });
      expect(out).toBe('CAPABILITY_SCOPE_ESCAPE');
      expect(w.readObject(foreign)!.payload.pwned).toBeUndefined();
    } finally { close(ctx); }
  });
});

describe('D-19c 网：写面词法门禁（防遗忘，不是墙）', () => {
  test('扫描器自证（变异锚点）：明写与换变量名必须命中；自有端口与注释不得误报', () => {
    expect(hitsOf(`tx.createObject({ kind: k });`, BANNED_ALL)).toContain('createObject');
    expect(hitsOf(`const svc = tx; svc.revise(oid, { payload: {} });`, BANNED_ALL)).toContain('revise');
    expect(hitsOf(`tx.appendLedger({ eventType: 'e' });`, BANNED_ALL)).toContain('appendLedger');
    // 自有端口不是违规：createOwned / reviseOwned / linkOwned 不得被误报
    expect(hitsOf(`w.createOwned({ kind: k }); w.reviseOwned(oid, {}); w.linkOwned(e);`, BANNED_ALL)).toEqual([]);
    // 注释不算违规
    expect(hitsOf(`// 这里以前是 tx.createObject(...)，现已改走拥有者端口`, BANNED_ALL)).toEqual([]);
  });

  test('src/domains/** 零通用写面（含未准入目录）', () => {
    const scanned = srcTopDirs().filter((d) => !MECHANISM_DIRS.includes(d) && !WHITELIST_DIRS.includes(d));
    const offenders = scanned.flatMap((d) => filesUnder(d).flatMap((f) => {
      const hits = hitsOf(readFileSync(f, 'utf-8'), BANNED_ALL);
      return hits.map((h) => `${f.replace(POC_ROOT + '/', '')} → ${h}`);
    }));
    expect(offenders, '领域侧出现通用写面：请改走「拥有者的作用域端口」（见 src/app/delegation.ts）').toEqual([]);
    // 反假绿：扫描面确实收到了文件，且**扫描器对这些文件不是恒绿**——
    // 拿机制目录里的真源码（kernel 实现了这些成员）跑同一个判据，必须命中。
    expect(filesUnder('src/domains').length).toBeGreaterThan(0);
    expect(hitsOf(readFileSync(join(POC_ROOT, 'src/kernel/kernel.ts'), 'utf-8'), BANNED_ALL).length)
      .toBeGreaterThan(0);
  });

  test('白名单目录：禁跨归属对象写面；appendLedger 逐处签字（清单见断言消息）', () => {
    const objectFace = WHITELIST_DIRS.flatMap((d) => filesUnder(d).flatMap((f) =>
      hitsOf(readFileSync(f, 'utf-8'), BANNED_IN_WHITELIST).map((h) => `${f.replace(POC_ROOT + '/', '')} → ${h}`)));
    expect(objectFace, '用例层/装配根必须经拥有者的作用域端口跨归属写，不许用通用事务面').toEqual([]);

    const unmarked = WHITELIST_DIRS.flatMap((d) => filesUnder(d).flatMap((f) => unmarkedAppends(f.replace(POC_ROOT + '/', ''), readFileSync(f, 'utf-8'))));
    expect(unmarked, `每处 appendLedger 都要带 ${MARKER} 与理由`).toEqual([]);
    // 行级判定挡不住"把调用拆成两行"（`tx` 换行再 `.appendLedger(`）——那种写法会躲过同行标记。
    // 因此再加一条**计数**判据：注释剥掉后，白名单里 appendLedger 的出现次数必须等于被标记的行数。
    const miscount = WHITELIST_DIRS.flatMap((d) => filesUnder(d).flatMap((f) => {
      const src = readFileSync(f, 'utf-8');
      const total = (stripComments(src).match(/\bappendLedger\b/g) ?? []).length;
      const signedN = markedAppends(f.replace(POC_ROOT + '/', ''), src).length;
      return total === signedN ? [] : [`${f.replace(POC_ROOT + '/', '')}：出现 ${total} 次 / 被标记 ${signedN} 次`];
    }));
    expect(miscount, '有 appendLedger 没被签字（含拆行写法）').toEqual([]);
    // 反假绿：两条判据互补，谁被删掉都会露馅——
    // 括号下标写法 `tx['appendLedger'](...)` 躲得过行级正则（它要求 `.name(` 形态），
    // 但躲不过计数（剥注释后仍出现 appendLedger 这个标识符）。
    const bracket = `tx['appendLedger']({ eventType: 'e' });`;
    expect(unmarkedAppends('synthetic.ts', bracket), '行级判据本就看不见这种形态（所以计数判据必须存在）').toEqual([]);
    expect((stripComments(bracket).match(/\bappendLedger\b/g) ?? []).length).toBe(1);
    const signed = WHITELIST_DIRS.flatMap((d) => filesUnder(d).flatMap((f) => markedAppends(f.replace(POC_ROOT + '/', ''), readFileSync(f, 'utf-8'))));
    // 签字清单不为空 = 白名单里确实有机制级写入在被盯着；若哪天用例层的 H 写入消失，
    // 这条会红，提醒把白名单**收窄**（白名单只会越来越小，不会悄悄变大）。
    expect(signed.length).toBeGreaterThan(0);
    // 装配根比用例层更紧：它**一处直接写都不许有**（含带标记的）。它只装配，不参与业务写；
    // 谁要开这一口子，必须先在文件头准入表里登记理由，再把这条判据显式改掉。
    const harnessWrites = WHITELIST_DIRS.filter((d) => d === 'src/harness')
      .flatMap((d) => filesUnder(d).flatMap((f) =>
        markedAppends(f.replace(POC_ROOT + '/', ''), readFileSync(f, 'utf-8'))));
    expect(harnessWrites, '装配根不得直接写数据：请经用例或领域端口').toEqual([]);
  });

  test('白名单不可被新目录悄悄扩张（src 顶层目录清单必须显式更新）', () => {
    const known = new Set([...MECHANISM_DIRS, ...WHITELIST_DIRS, 'src/domains', 'src/storage-sqlite']);
    const unknown = srcTopDirs().filter((d) => !known.has(d));
    expect(unknown, `新增 src 顶层目录 ${JSON.stringify(unknown)}：必须先在文件头的准入表里登记角色与判据`).toEqual([]);
  });

  test('分层方向：用例层不得反向 import 装配根 / 存储驱动 / 机制内部通道', () => {
    const bad = filesUnder('src/app').flatMap((f) => [...readFileSync(f, 'utf-8').matchAll(/from\s+["']([^"']+)["']/g)]
      .map((m) => m[1])
      .filter((s) => /harness|storage-sqlite|kernel\/internal/.test(s))
      .map((s) => `${f.replace(POC_ROOT + '/', '')} → ${s}`));
    expect(bad, '用例层只能由装配根装配，反过来拿装配根就等于第二条装配根').toEqual([]);
    // 反假绿：装配根确实 import 了用例层（方向是装配根 → 用例，不是两边都不 import）
    expect(/from '\.\.\/app\//.test(readFileSync(join(POC_ROOT, 'src/harness/world.ts'), 'utf-8'))).toBe(true);
  });

  test('负空间（诚实）：拼接成员名与反射取成员这两类写法，本门**扫不到**', () => {
    // 断言的是"扫不到"。若哪天扫描器强到能抓这些，本条会红——那是好事，
    // 但必须同步改掉文件头"边界"一节与本用例，不许把负空间偷偷改成正空间。
    const dynamic = `const m = 'rev' + 'ise'; (tx as any)[m](oid, { payload: {} });`;
    const reflect = `const f = Object.getPrototypeOf(tx)['rev' + 'ise']; f.call(tx, oid, {});`;
    expect(hitsOf(dynamic, BANNED_ALL)).toEqual([]);
    expect(hitsOf(reflect, BANNED_ALL)).toEqual([]);
    // 对照：同一动作写成字面量就命中（说明"扫不到"是形态问题，不是扫描器坏了）
    expect(hitsOf(`tx.revise(oid, { payload: {} });`, BANNED_ALL)).toContain('revise');
    // 而这两类在运行时都过不了墙——见上方「扫描扫不到的动态派发写法」用例。
  });
});
