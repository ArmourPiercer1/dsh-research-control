/**
 * N3 结构门禁：「TS 构造器参数属性运行时可枚举」这条教训的**结构性**防线（第 1+2 道门）。
 *
 * 同一课在本仓已犯四次（D-17 `NamespaceWriterImpl`、P2-2、D-22 `ValidationService.runIn`、
 * 以及 G2-A 点名的 `FactStandingPolicy`/`FacetStore`/`IntakeUseCase`/`StandingUseCase`）。
 *
 * **包 4 重写（2026-10-30，席位 G3-A 把包 3 的两道门实测打穿后裁定）**——旧形态的败因在案：
 *  · 门 1 旧版是正则 + 括号配对扫描：`constructor(tag = ")", private readonly face)` 用默认值字符串里
 *    **未配对的右括号**截断参数表 ⇒ 修饰符落在截断点之后，三形态全漏（G3-A N3b）。
 *  · 门 2 旧版只认 `'value' in d` 的 descriptor 且不下钻：**getter 访问器**（`Object.defineProperty(this,
 *    'face', {get})`）与**一层包装** `{bundle:{face}}` 失明，运行时 `.face` / `.bundle.face` 照样可走
 *    （G3-A N3e/N3f）。
 * 现形态（已裁定，照做）：
 *  · **门 1 = AST**（TS Compiler API，经 `typescript-6` 别名——本仓 train 的 `typescript@7` 是原生移植，
 *    不暴露经典 Compiler API；经典 API 正源钉在 `typescript-6`，字符串再刁钻也骗不过语法树）：
 *    遍历 `ClassDeclaration`/类表达式的**构造器参数修饰符**（public/private/protected/readonly 参数属性），
 *    顺带覆盖 **PropertyDeclaration**（显式可见性修饰符 = 运行时自有可枚举，`#` 私有字段不在其列；
 *    裸 `readonly` 数据字段不判，由门 2 按值兜）、**AccessorDeclaration**（领域/用例类不得自带 getter/setter
 *    成员——N3e 的源码面投影）、以及 **`Object.defineProperty(s)(this, …)` 注入**（N3c/N3e 的注入口）。
 *  · **门 2 = 双 descriptor + 一层递归**：自有键（`Reflect.ownKeys`，Symbol 继续查）上 **accessor
 *    descriptor 与 value descriptor 都判**——own accessor 一律保守拦（求值 getter 等于执行领域代码，
 *    副作用不值得换）；值为 plain-object 包装时对**自有面**递归**一层**（N3f 形态）。已知残余：
 *    两层以上嵌套包装与 Proxy ownKeys 欺骗（N3g，理论形态）——由门 1 的 AST 面与「白名单为空」纪律兜。
 *  · **白名单为空本身仍是断言**；出现条目必须带理由并逐条签字。
 *  · **红→绿血统（本文件自带的强制形态）**：旧门实现原样保留在下方「旧门副本」段，专用于对照测试——
 *    每条已知绕过形态都必须先以「旧门漏检」钉红（G3-A 实测的复现），再以「新门抓住」转绿。
 *    只测新门通过的绿不携带信息（§14.6 规则 2：恒真式/无红史的绿等于没有门禁）。
 *
 * 覆盖面纪律：门 1 扫 `src/domains/**` + `src/app/**`（G3-A 观察项：storage/kernel 装配层的参数属性
 * 在面外、插件不可达，扩面须先在此登记）。门 1↔门 2 互为镜像：源码里有构造函数的文件，运行时清单必须有实例。
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript-6';
import { POC_DATA_DIR, POC_ROOT } from '../src/harness/paths.ts';
import { openWorld, PRINCIPAL, type World } from '../src/harness/world.ts';
import { TEST_OBJECT_MODEL } from '../src/domains/test-object-model.ts';
import { TEST_VALIDATION } from '../src/domains/test-validation.ts';
import {
  CAP_RECORDS, TEST_RECORDS, FactDesignationCommandPort, FactStandingPolicy,
  IntakePolicy, ValidationService,
} from '../src/domains/test-records.ts';
import { CAP_FACET, FacetStore } from '../src/domains/test-facet.ts';
import { IntakeUseCase } from '../src/app/intake-use-case.ts';
import { StandingUseCase } from '../src/app/standing-use-case.ts';

const SCANNED_DIRS = ['src/domains', 'src/app'];
const filesUnder = (rel: string): string[] => {
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)],
  );
  return walk(join(POC_ROOT, rel)).filter((f) => f.endsWith('.ts'));
};

// ─────────────────────────────────────────────────────────────────────────────
// 旧门副本（包 3 原文，逐字保留）——**不参与对被扫源码的裁决**，只用于「红→绿血统」对照。
// 删除本段 = 抹掉 N3b/N3e/N3f 的红史，下一次重写就又只剩「新门通过」的无信息绿灯。
// ─────────────────────────────────────────────────────────────────────────────
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

function oldConstructorParams(file: string, src: string): { file: string; params: string }[] {
  const code = stripComments(src);
  const out: { file: string; params: string }[] = [];
  const re = /\bconstructor\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    let i = re.lastIndex - 1;      // '(' 的位置
    let depth = 0;
    for (; i < code.length; i++) {
      const ch = code[i];
      if (ch === '(') depth++;
      else if (ch === ')') { depth--; if (depth === 0) break; }
    }
    out.push({ file, params: code.slice(m.index, i) });
  }
  return out;
}
const OLD_MODIFIER_TOKEN = /[(,]\s*(private|protected|public|readonly)\s+[\w$]/;
const oldIsParamProperty = (params: string): boolean =>
  OLD_MODIFIER_TOKEN.test(`(${params.replace(/\bconstructor\s*\(/, '')}`);
const oldGate1Hit = (src: string): boolean =>
  oldConstructorParams('X', src).some((e) => oldIsParamProperty(e.params));

function oldCallableSurface(v: unknown): boolean {
  if (typeof v === 'function') return true;
  if (v === null || typeof v !== 'object') return false;
  for (const o of [v as object, Object.getPrototypeOf(v) as object | null]) {
    if (!o || o === Object.prototype || o === Array.prototype) continue;
    for (const k of [...Object.getOwnPropertyNames(o), ...Object.getOwnPropertySymbols(o)]) {
      if (k === 'constructor') continue;
      const d = Object.getOwnPropertyDescriptor(o, k);
      if (d && 'value' in d && typeof d.value === 'function') return true;
    }
  }
  return false;
}
const oldRuntimeLeaks = (label: string, inst: object): string[] =>
  Reflect.ownKeys(inst)
    .filter((k) => {
      const d = Object.getOwnPropertyDescriptor(inst, k);
      return d && 'value' in d && oldCallableSurface(d.value);
    })
    .map((k) => `${label}.${String(k)}`);

// ─────────────────────────────────────────────────────────────────────────────
// 门 1（新，AST）：语法树不骗不过——默认值字符串、注释、任意嵌套括号都在同一个解析器面前
// ─────────────────────────────────────────────────────────────────────────────

type LeakKind = 'param-property' | 'accessibility-field' | 'accessor' | 'defineProperty-injection' | 'unparseable';
interface AstHit { file: string; line: number; kind: LeakKind; detail: string }

const PARAM_MODS = new Set([ts.SyntaxKind.PrivateKeyword, ts.SyntaxKind.ProtectedKeyword,
  ts.SyntaxKind.PublicKeyword, ts.SyntaxKind.ReadonlyKeyword]);
const ACCESSIBILITY_MODS = new Set([ts.SyntaxKind.PrivateKeyword, ts.SyntaxKind.ProtectedKeyword, ts.SyntaxKind.PublicKeyword]);
const modsOf = (n: ts.Node): readonly ts.ModifierLike[] =>
  ts.canHaveModifiers(n) ? ts.getModifiers(n) ?? [] : [];

function astLeaks(relFile: string, src: string): AstHit[] {
  const sf = ts.createSourceFile(relFile, src, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const hits: AstHit[] = [];
  const lineOf = (pos: number): number => sf.getLineAndCharacterOfPosition(pos).line + 1;
  // **fail-closed**：AST 门禁遇到解析诊断必须报红，不得因"读不懂"而默认放过。
  // 这是 AST 门相对正则门的额外红利——正则门靠"出现即违规"硬兜畸形样本，AST 门靠"读不进语法树=违规"。
  // `parseDiagnostics` 是 SourceFile 上的运行时属性，公共 d.ts 未暴露 → 显式 cast 读取（不是抑制）。
  const parseDiagnostics = (sf as unknown as { parseDiagnostics?: readonly ts.DiagnosticWithLocation[] }).parseDiagnostics ?? [];
  for (const d of parseDiagnostics) {
    hits.push({ file: relFile, line: sf.getLineAndCharacterOfPosition(d.start).line + 1, kind: 'unparseable',
      detail: `解析诊断：${ts.flattenDiagnosticMessageText(d.messageText, ' ')}` });
  }
  const walk = (n: ts.Node): void => {
    if (ts.isConstructorDeclaration(n)) {
      for (const p of n.parameters) {
        const m = modsOf(p);
        if (m.some((x) => PARAM_MODS.has(x.kind))) {
          hits.push({ file: relFile, line: lineOf(p.getStart(sf)), kind: 'param-property',
            detail: `构造参数「${p.getText(sf).slice(0, 60)}」带修饰符 = 运行时自有可枚举属性` });
        }
      }
    }
    if (ts.isPropertyDeclaration(n) && modsOf(n).some((x) => ACCESSIBILITY_MODS.has(x.kind))) {
      // 显式可见性修饰符（private/protected/public）的字段在运行时就是自有可枚举属性——
      // D-17/P2-2/D-22/N3 四次同课的源码面。`#` 字段（PrivateIdentifier）不命中本判据；
      // 无修饰符/裸 readonly 的公开数据字段不在此拦（值形态由门 2 兜，误报的门禁没人信）。
      hits.push({ file: relFile, line: lineOf(n.getStart(sf)), kind: 'accessibility-field',
        detail: `字段「${n.name.getText(sf)}」带 TS 可见性修饰符 = 编译期隐私、运行时可枚举` });
    }
    if (ts.isAccessor(n)) {
      hits.push({ file: relFile, line: lineOf(n.getStart(sf)), kind: 'accessor',
        detail: `访问器「${n.name.getText(sf)}」= N3e 泄漏形态的源码面（getter 可返回任意协作对象）` });
    }
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)
      && ts.isIdentifier(n.expression.expression) && n.expression.expression.text === 'Object'
      && ['defineProperty', 'defineProperties'].includes(n.expression.name.text)
      && n.arguments.length > 0 && n.arguments[0].kind === ts.SyntaxKind.ThisKeyword) {
      hits.push({ file: relFile, line: lineOf(n.getStart(sf)), kind: 'defineProperty-injection',
        detail: 'Object.defineProperty(s)(this, …) 向实例注入成员 = N3c/N3e 注入口，领域/用例行禁用' });
    }
    ts.forEachChild(n, walk);
  };
  walk(sf);
  return hits;
}

/** 门 1↔门 2 镜像判据用：该源码里是否真有构造函数（AST 判定，不再用词法碰运气）。 */
const astHasConstructor = (relFile: string, src: string): boolean => {
  const sf = ts.createSourceFile(relFile, src, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  let found = false;
  const walk = (n: ts.Node): void => {
    if (ts.isConstructorDeclaration(n)) found = true;
    ts.forEachChild(n, walk);
  };
  walk(sf);
  return found;
};

/**
 * **白名单（当前必须为空）**：若将来某处确实必须保留违规形态，加 `{ file, kind, reason }`——
 * reason 必须说清「为什么不能用 #私有字段/普通参数」，并在此文件的 PR 描述里单独过审。
 * 不许「顺手豁免」：豁免名单本身就是审计对象。「白名单为空」由专门测试断言。
 */
const PARAM_PROPERTY_WHITELIST: readonly { file: string; kind: LeakKind; reason: string }[] = [];

// ─────────────────────────────────────────────────────────────────────────────
// 门 2（新）：双 descriptor（accessor 与 value 都判）+ plain-object 包装一层递归 + Symbol 键
// ─────────────────────────────────────────────────────────────────────────────

/** 已知违规运行时样本（对照/变异锚共用）：与 g1a D-22 抓 `svc.runIn` 同一手法。 */
class PreFixShapeReplica {
  constructor(readonly face: unknown, readonly authority?: unknown) {}
}
/** G3-A N3e 原形态：getter 访问器持有协作对象（旧门 2 对 accessor descriptor 失明）。 */
class GetterLeakReplica {
  #f: unknown;
  constructor(f: unknown) { this.#f = f; Object.defineProperty(this, 'face', { get: () => this.#f, enumerable: true }); }
}
/** G3-A N3f 原形态：一层包装 `{bundle:{face}}`（旧门 2 不下钻自有面）。 */
class BundleLeakReplica {
  bundle: unknown;
  constructor(f: unknown) { this.bundle = { face: f }; }
}

const faceStub = { writerFor() { return null; } };
const isWrapperObject = (v: object): boolean => {
  const p = Object.getPrototypeOf(v) as object | null;
  return p === Object.prototype || p === null;
};

/** 值 v 是否「含可调用成员」：本身是函数；或对象自有/直接原型带函数**或访问器**；
 *  或 plain-object 包装的自有值（递归一层）命中前述任一判据。 */
function callableSurface(v: unknown, depth = 0): boolean {
  if (typeof v === 'function') return true;
  if (v === null || typeof v !== 'object') return false;
  // 两层检查：对象自有属性 + 直接类原型（类实例的方法住在原型上，`Object.keys` 会漏 ⇒ 假绿）。
  // 再往上是 Object/Array 等内置原型：普通数据对象不算「携带方法」，协作者形状两层内全暴露。
  for (const o of [v as object, Object.getPrototypeOf(v) as object | null]) {
    if (!o || o === Object.prototype || o === Array.prototype) continue;
    for (const k of [...Object.getOwnPropertyNames(o), ...Object.getOwnPropertySymbols(o)]) {
      if (k === 'constructor') continue;
      const d = Object.getOwnPropertyDescriptor(o, k);
      if (!d) continue;
      // 双 descriptor：accessor（get/set）与 value 都判——旧门只认 `'value' in d`，N3e 正是从这里漏的。
      // accessor 保守拦：求值 getter 等于执行任意代码，副作用面不换那一点精度。
      if (d.get !== undefined || d.set !== undefined) return true;
      if (typeof d.value === 'function') return true;
    }
  }
  // 一层递归：plain-object 包装（N3f 的 `{bundle:{face}}`）。只进一层——两层以上嵌套是**登记的残余形态**
  // （源码面由门 1 的 AST 判据兜：能构造这种实例的类必在 src/domains|src/app 现形）。
  if (depth < 1 && isWrapperObject(v)) {
    for (const k of [...Object.getOwnPropertyNames(v), ...Object.getOwnPropertySymbols(v)]) {
      const d = Object.getOwnPropertyDescriptor(v, k);
      if (!d) continue;
      if (d.get !== undefined || d.set !== undefined) return true;
      if (d.value !== v && callableSurface(d.value, depth + 1)) return true;
    }
  }
  return false;
}

const runtimeLeaks = (label: string, inst: object): string[] =>
  Reflect.ownKeys(inst)   // Symbol 键继续查（G3-A N3d：这条旧承诺成立，保留）
    .filter((k) => {
      const d = Object.getOwnPropertyDescriptor(inst, k);
      if (!d) return false;
      // 双 descriptor：实例自有 accessor（N3e 形态）与 value 都判。own accessor 一律保守拦。
      if (d.get !== undefined || d.set !== undefined) return true;
      return callableSurface(d.value);
    })
    .map((k) => `${label}.${String(k)}`);

// ─────────────────────────────────────────────────────────────────────────────

describe('N3 门 1（AST）：src/domains/** 与 src/app/** 不得有构造器参数属性/可见性字段/访问器/defineProperty 注入', () => {
  const entries = SCANNED_DIRS.flatMap((d) => filesUnder(d)
    .map((f) => astLeaks(f.replace(POC_ROOT + '/', ''), readFileSync(f, 'utf-8')))).flat();

  test('红→绿血统·门 1：G3-A N3b 三形态在**旧门**下逐条漏检（复现红史），在**新 AST 门**逐条转绿', () => {
    const bypasses = [
      `class A { constructor(tag = ")", private readonly face: unknown) {} }`,
      'class A { constructor(t = `)`, private x = 1) {} }',
      `class A { constructor(tag = "))", public y = 1, private z = 2) {} }`,
    ];
    for (const src of bypasses) {
      // 旧门红史：字符串里未配对右括号截断参数表 ⇒ 修饰符在截断点后 ⇒ 漏检（这是被实证打穿的现状复现）
      expect(oldGate1Hit(src), `旧门漏检记录：${src}`).toBe(false);
      // 新门转绿：AST 看语法树，默认值字符串里的括号不是括号
      expect(astLeaks('BYPASS', src).map((h) => h.kind), `新门必须抓住：${src}`).toContain('param-property');
    }
    // 旧门对非参数属性注入形态同样失明（N3c 的旧门记录）：AST 门现在直接命中
    const injection = `class A { constructor(f: unknown) { Object.defineProperty(this, 'face', { value: f, enumerable: true }); } }`;
    expect(oldGate1Hit(injection)).toBe(false);
    expect(astLeaks('INJ', injection).map((h) => h.kind)).toContain('defineProperty-injection');
  });

  test('门 1 变异锚点：已知违规样本必须报警（否则绿色不携带信息）', () => {
    const dirty = [
      `class Bad { constructor(private readonly face: PluginFace, private readonly authority?: Authorizer) {} }`,
      `class Also { constructor(\n  public\n  a: number,\n) {} }`,
      `const C = class { constructor(private x: unknown) {} };`,            // 类表达式同捕
      `class T { constructor(items: readonly string[]) {} }`,               // 见下：这条**不该**命中
      `class F { private holder = makeFace(); }`,                            // 可见性字段
      `class G { get face() { return 1; } }`,                                // 访问器成员
    ];
    const kinds = dirty.map((src) => astLeaks('M', src).map((h) => h.kind));
    expect(kinds[0]).toContain('param-property');
    // 跨行修饰符样本是**语法错误**的 TS（`public` 换行 `a: number` 会被解析成两个参数 + 诊断）——
    // AST 门对解析诊断 **fail-closed** 报红：读不进语法树的源码一律不许悄悄过关（旧门靠正则硬兜同款，
    // 两条实现都必须抓住它，红史等价）。
    expect(kinds[1]).toContain('unparseable');
    expect(kinds[2]).toContain('param-property');
    expect(kinds[3], 'readonly 出现在**类型注解**（readonly string[]）不是参数属性——不锚语法位置就误报，误报的门禁没人信').toEqual([]);
    expect(kinds[4]).toContain('accessibility-field');
    expect(kinds[5]).toContain('accessor');
    // 合规形态零误报：#私有字段 + 普通参数 + 公开数据字段（值形态归门 2）
    const clean = [
      `class Good { readonly #face: PluginFace; constructor(face: PluginFace) { this.#face = face; } }`,
      `class Also { constructor(a: string, b?: number) {} }`,
      `class D { carrierKind = 'test.subject'; constructor() {} }`,
    ].flatMap((src) => astLeaks('C', src));
    expect(clean).toEqual([]);
  });

  test('全量扫描零命中：违规形态在领域/用例行里已经绝迹', () => {
    const hits = entries.filter((h) =>
      !PARAM_PROPERTY_WHITELIST.some((w) => w.file === h.file && w.kind === h.kind));
    expect(hits, '参数属性/可见性字段/访问器/defineProperty 注入 = 运行时可枚举泄漏面（D-17/P2-2/D-22/N3 四次同课）').toEqual([]);
  });

  test('白名单为空本身是一条断言；若出现条目必须带理由', () => {
    expect(PARAM_PROPERTY_WHITELIST, '豁免必须逐条写理由并单独过审，静默豁免=违规').toEqual([]);
    for (const w of PARAM_PROPERTY_WHITELIST) expect(w.reason.length, '每条豁免要有理由').toBeGreaterThan(10);
  });
});

describe('N3 门 2（运行时级）：实例自有面判 accessor 与 value，plain-object 包装递归一层，Symbol 键继续查', () => {
  let dir: string;
  let w: World;
  const instances: { label: string; sourceFile: string; make: () => object }[] = [];

  // 覆盖 = 门 1 扫描面里**所有带构造函数的导出类**（构造签名与 world 装配点一致）。
  {
    // 收集在 beforeAll 做（world 要先开）；这里只声明构造配方。
    instances.push(
      { label: 'FactStandingPolicy', sourceFile: 'src/domains/test-records.ts',
        make: () => new FactStandingPolicy(w.kernel.faceFor(CAP_RECORDS), w.authority) },
      { label: 'FactDesignationCommandPort', sourceFile: 'src/domains/test-records.ts',
        make: () => new FactDesignationCommandPort(new FactStandingPolicy(w.kernel.faceFor(CAP_RECORDS), w.authority), w.kernel.faceFor(CAP_RECORDS)) },
      { label: 'ValidationService', sourceFile: 'src/domains/test-records.ts',
        make: () => new ValidationService(w.kernel.faceFor(CAP_RECORDS),
          w.validationSubmission(PRINCIPAL('n3-host')),
          (r) => w.readRevision(r)) },
      { label: 'IntakePolicy', sourceFile: 'src/domains/test-records.ts', make: () => new IntakePolicy() },
      { label: 'FacetStore', sourceFile: 'src/domains/test-facet.ts',
        make: () => new FacetStore(w.kernel.faceFor(CAP_FACET)) },
      { label: 'IntakeUseCase', sourceFile: 'src/app/intake-use-case.ts', make: () => w.intakeUseCase() },
      { label: 'StandingUseCase', sourceFile: 'src/app/standing-use-case.ts', make: () => w.standingUseCase() },
    );
  }

  beforeAll(() => {
    dir = mkdtempSync(join(POC_DATA_DIR, 'n3-runtime-'));
    w = openWorld({ file: join(dir, 'n3.db'), space: 'SP-N3',
      grants: { 'n3-host': ['space-write', 'capability-admin', 'domain-admission'] },
      plugins: [TEST_OBJECT_MODEL, TEST_VALIDATION, TEST_RECORDS] });
  });
  afterAll(() => { w.close(); rmSync(dir, { recursive: true, force: true }); });

  test('红→绿血统·门 2：G3-A N3e getter 访问器与 N3f 一层包装在**旧门 2**下漏检（复现红史），**新门 2**逐条转绿', () => {
    // N3e：getter 访问器持有协作对象。旧门：`'value' in d` 过滤 ⇒ 结构性失明；运行时 .face 照样可走。
    const g = new GetterLeakReplica(faceStub);
    expect(oldRuntimeLeaks('g', g), '旧门漏检记录（N3e）').toEqual([]);
    expect((g as unknown as { face: unknown }).face).toBe(faceStub); // 泄漏是真的，不是纸面形态
    expect(runtimeLeaks('g', g), '新门必须抓住 own accessor（N3e 转绿）').toEqual(['g.face']);
    // N3f：一层包装 {bundle:{face}}。旧门：callableSurface 不下钻自有属性 ⇒ 失明；运行时 .bundle.face 可走。
    const b = new BundleLeakReplica(faceStub);
    expect(oldRuntimeLeaks('b', b), '旧门漏检记录（N3f）').toEqual([]);
    expect(((b.bundle as { face: unknown }).face)).toBe(faceStub);
    expect(runtimeLeaks('b', b), '新门必须抓住一层 plain-object 包装（N3f 转绿）').toEqual(['b.bundle']);
    // 登记残余（勿当已修）：两层以上包装与 Proxy ownKeys 欺骗（N3g）仍是运行时面的理论盲区——
    // 兜底是门 1 的 AST 面：能构造这种实例的类必须在 src/domains|src/app 的源码扫描里现形。
  });

  test('门 2 变异锚点：参数属性实例与 Symbol 键泄漏必须现形（旧承诺 + 新增都绿）', () => {
    const replica = new PreFixShapeReplica(faceStub, { can: () => false });
    expect(runtimeLeaks('replica', replica).sort()).toEqual(['replica.authority', 'replica.face']); // 修前 FactStandingPolicy 的实测形状
    expect(runtimeLeaks('p', Object.assign({}, { face: faceStub }))).toEqual(['p.face']);
    expect(runtimeLeaks('s', { [Symbol.for('face')]: faceStub })).toEqual(['s.Symbol(face)']); // Symbol 键继续查（N3d）
    // 反面对照：纯数据自有属性不误报
    expect(runtimeLeaks('d', { name: 'x', n: 1, list: ['a'] } as object)).toEqual([]);
  });

  test('门 1↔门 2 覆盖面互为镜像：源码里有构造函数的文件，运行时清单必须全部有实例', () => {
    const filesWithCtor = new Set(
      SCANNED_DIRS.flatMap((d) => filesUnder(d))
        .filter((f) => astHasConstructor(f.replace(POC_ROOT + '/', ''), readFileSync(f, 'utf-8')))
        .map((f) => f.replace(POC_ROOT + '/', '')),
    );
    const covered = new Set(instances.map((i) => i.sourceFile));
    expect([...filesWithCtor].filter((f) => !covered.has(f)), '新带构造函数的领域/用例类必须同时进门 2 清单').toEqual([]);
  });

  test('全部实例自有属性零可调用面（#私有字段在 Reflect 下不存在，正是本门要的形态）', () => {
    const hits = instances.flatMap((i) => runtimeLeaks(i.label, i.make()));
    expect(hits, '协作对象（face/authority/delegation/policy/commands）不得留在运行时自有属性上').toEqual([]);
    // 逐类点名断言：整体为空可能只是清单空转，每条单独钉一遍才知道每个类真被测了。
    for (const i of instances) {
      expect(runtimeLeaks(i.label, i.make()), `${i.label} 实例必须无自有可调用面`).toEqual([]);
    }
  });
});
