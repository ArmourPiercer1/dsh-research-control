/**
 * N3 结构门禁：「TS 构造器参数属性运行时可枚举」这条教训的**结构性**防线（第 1+2 道门）。
 *
 * 同一课在本仓已犯四次（D-17 `NamespaceWriterImpl`、P2-2、D-22 `ValidationService.runIn`、
 * 以及 G2-A 点名的 `FactStandingPolicy`/`FacetStore`/`IntakeUseCase`/`StandingUseCase`）。
 * **教训第四次被写进注释之后，本文件把它写进结构**：从现在起这条纪律不靠人记得住，
 * 靠 CI 红。判定形态 = CONTRACTS.md §14.6 规则 1（类型面即边界）的运行时补全：
 * `private readonly x` 只在编译期存在，运行时就是自有可枚举属性——所以两道门：
 *
 *   门 1（源码级，零实例化、零误报面）：`src/domains/**`、`src/app/**` 的构造函数参数里
 *     不得出现 `private | protected | public | readonly` 修饰符（参数属性形态）。
 *   门 2（运行时级）：这些类的**实例自有属性值**不得含可调用成员，也不得含"携带方法的对象"
 *     （face / authority / delegation / policy 这些协作对象全是这个形状）。
 *
 * 两条纪律：
 *   · **变异锚点**：门 1 自带"已知违规样本必须报警"的自测（沿用 arch-independence 的规矩，
 *     否则绿色不携带信息）；门 2 对已知违规形态（参数属性实例）同样先红后绿。
 *   · **白名单不许静默**：`PARAM_PROPERTY_WHITELIST` 若出现条目必须带理由并逐条签字；
 *     当前必须为空——"白名单为空"本身就是断言（见 门 1 最后一条测试）。
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
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

// ─────────────────────────────────────────────────────────────────────────────
// 门 1：源码级——构造器参数属性扫描
// ─────────────────────────────────────────────────────────────────────────────

/** 剥注释（与 arch-independence 同款）：纪律写进注释是允许的，参数表里出现修饰符才是违规。 */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

/**
 * 提取每个 `constructor` 的参数表（括号配对），返回 [{ file, params }]。
 * 参数表里出现 `private|protected|public|readonly` 即参数属性——JS/TS 里没有合法的
 * 参数名或默认值会用到这些裸关键字，所以"出现即违规"不需要更细的上下文分析（这正是
 * 本门零误报面的来源，也意味着它**不可**被改名/换拼写绕过：形态是语法级的）。
 */
function constructorParams(file: string, src: string): { file: string; params: string }[] {
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

const SCANNED_DIRS = ['src/domains', 'src/app'];
const filesUnder = (rel: string): string[] => {
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)],
  );
  return walk(join(POC_ROOT, rel)).filter((f) => f.endsWith('.ts'));
};

/**
 * 违规 = 某个**参数的起始位置**（`(` 或 `,` 之后）紧跟修饰符关键字 + 标识符。
 * 锚在参数起始是有意的：类型注解里的 `readonly`（`a: readonly string[]`）永远跟在 `:` 后，
 * 不是参数属性——不锚起始就会误报，误报的门禁没人信，没人信的门禁等于没有。
 */
const MODIFIER_TOKEN = /[(,]\s*(private|protected|public|readonly)\s+[\w$]/;
const isParamProperty = (params: string): boolean =>
  MODIFIER_TOKEN.test(`(${params.replace(/\bconstructor\s*\(/, '')}`);
const paramPropertyHits = (entries: { file: string; params: string }[]): string[] =>
  entries.filter((e) => isParamProperty(e.params))
    .map((e) => `${e.file.replace(POC_ROOT + '/', '')}: ${e.params.replace(/\s+/g, ' ').slice(0, 90)}`);

/**
 * **白名单（当前必须为空）**：若将来某处确实必须保留参数属性，在这里加
 * `{ file, reason }`——reason 必须说清"为什么不能用 #私有字段"，并在此文件的
 * PR 描述里单独过审。不许"顺手豁免"：这条豁免名单本身就是审计对象。
 */
const PARAM_PROPERTY_WHITELIST: readonly { file: string; reason: string }[] = [];

describe('N3 门 1（源码级）：src/domains/** 与 src/app/** 不得有构造器参数属性', () => {
  const entries = SCANNED_DIRS.flatMap((d) => filesUnder(d).map((f) => constructorParams(f, readFileSync(f, 'utf-8')))).flat();

  test('变异锚点：扫描器对已知违规样本必须报警（否则绿色不携带信息）', () => {
    const dirty = constructorParams('MEMBERY', `
      class Bad { constructor(private readonly face: PluginFace, private readonly authority?: Authorizer) {} }
      class Also {
        constructor(
          private readonly policy: IntakePolicy,
          private readonly delegation: UseCaseDelegation,
        ) {}
      }`);
    expect(dirty).toHaveLength(2);
    expect(paramPropertyHits(dirty)).toHaveLength(2);
    // 反面对照：合规形态（普通参数 + #私有赋值）与 `readonly` 类型注解都不得误报
    const clean = constructorParams('MEMBERY', `
      class Good { readonly #face: PluginFace; constructor(face: PluginFace) { this.#face = face; } }
      class Also { constructor(a: string, b?: number) {} }
      class Typed { constructor(items: readonly string[], opts?: Record<string, unknown>) {} }`)
      .flatMap((e) => (isParamProperty(e.params) ? ['误报'] : []));
    expect(clean).toEqual([]);
  });

  test('全量扫描零命中：参数属性形态在领域/用例行里已经绝迹', () => {
    // 命中样例（修前的四例，防止有人"以为修了"）：
    //   FactStandingPolicy(constructor(private readonly face, private readonly authority?))
    //   FacetStore(constructor(private readonly face))
    //   IntakeUseCase / StandingUseCase 同款
    const hits = paramPropertyHits(entries).filter((h) =>
      !PARAM_PROPERTY_WHITELIST.some((w) => h.startsWith(w.file)));
    expect(hits, '参数属性 = 运行时自有可枚举属性（D-17/P2-2/D-22/N3 四次同课，别再写注释了）').toEqual([]);
  });

  test('白名单为空本身是一条断言；若出现条目必须带理由', () => {
    expect(PARAM_PROPERTY_WHITELIST, '豁免必须逐条写理由并单独过审，静默豁免=违规').toEqual([]);
    for (const w of PARAM_PROPERTY_WHITELIST) expect(w.reason.length, '每条豁免要有理由').toBeGreaterThan(10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 门 2：运行时级——实例自有属性值不得含可调用成员
// ─────────────────────────────────────────────────────────────────────────────

/** 值 v 是否"含可调用成员"：本身是函数，或是携带方法的对象（face/authority/policy/delegation 形状）。 */
function callableSurface(v: unknown): boolean {
  if (typeof v === 'function') return true;
  if (v === null || typeof v !== 'object') return false;
  // 两层检查：对象自有属性 + 直接类原型（类实例的方法住在原型上，`Object.keys` 会漏 ⇒ 假绿）。
  // 再往上是 Object/Array 等内置原型：普通数据对象不算"携带方法"，协作者形状两层内全暴露。
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

const runtimeLeaks = (label: string, inst: object): string[] =>
  Reflect.ownKeys(inst)
    .filter((k) => {
      const d = Object.getOwnPropertyDescriptor(inst, k);
      return d && 'value' in d && callableSurface(d.value);
    })
    .map((k) => `${label}.${String(k)}`);

// 修前红形态的具名样本（门 2 的变异锚点）：与 g1a D-22 抓 `svc.runIn` 同一手法。
class PreFixShapeReplica {
  constructor(readonly face: unknown, readonly authority?: unknown) {}
}

describe('N3 门 2（运行时级）：领域/用例类实例自有属性值不得含可调用成员', () => {
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

  test('变异锚点：参数属性实例在门 2 下必须现形（绿色不是摆设）', () => {
    const replica = new PreFixShapeReplica({ writerFor() { return null; } }, { can: () => false });
    const leaks = runtimeLeaks('replica', replica);
    expect(leaks.sort()).toEqual(['replica.authority', 'replica.face']); // 修前 FactStandingPolicy 的实测形状
  });

  test('门 1↔门 2 覆盖面互为镜像：源码里有构造函数的文件，运行时清单必须全部有实例', () => {
    const filesWithCtor = new Set(
      SCANNED_DIRS.flatMap((d) => filesUnder(d))
        .filter((f) => /\bconstructor\s*\(/.test(stripComments(readFileSync(f, 'utf-8'))))
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
