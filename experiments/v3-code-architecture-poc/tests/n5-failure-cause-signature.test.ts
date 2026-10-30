/**
 * N5 常驻测试（RE-REVIEW-G2-A.md §③ N5，P2；G6-A §①#11 复现；第五轮裁定第②点修法要件）。
 *
 * 起因为何：旧门 [3/3] 判据「文件 failed 且 reds===0 ⇒ 收集期失败」只修 GT-1 的一半——
 * **同文件只要有一条已登记断言红，afterAll 抛错就被吸收成已知失败、门禁 PASS**（吸收形）。
 * 修法（gate-causes.mjs 唯一实现）：文件级失败一律提取成因签名，任何未登记成因一律红；
 * 纯断言红不产出成因 ⇒ 33 条已登记红的 133 例基线零误报（席位实测；本测试把该实测落成常驻）。
 *
 * 本测试跑法：子进程拉起 `tests/helpers/n5-causes-probe.mjs`（vitest JSON 夹具×5 形态），
 * 对摘要做五条判定——
 *   A 吸收形 ⇒ **必须红**（第五轮裁定的同形注入要件）；
 *   B 钩子形（全绿+afterAll）⇒ 必须红（GT-1 不回退）；
 *   C 对照形（纯断言红）⇒ 成因必须为 0（零误报=基线前提的常驻钉）；
 *   D 收集形 ⇒ 必须产出 collection-error 成因；
 *   E 运行级吸收形（第六轮 G0-R 收尾）⇒ 「已登记红 + 未归属运行级异常」的组合**必须红**：
 *     vitest 4.1.11 实测这种异常在 JSON 零痕迹、红场里 exit 恒 1，旧判据的
 *     `totalReds===0` 前置使它被豁免（改造前门禁仿真打印「与基线完全一致」PASS，
 *     一次性证据 .scratch/n5-runlevel-repro/）；修复=运行级 banner 通道独立判定，
 *     **断言红不再是豁免条件**（gate-causes.unhandledBannerCauses，判据与 g0-gate 同源）。
 * F 兜底形（第六轮父席裁定「反转默认」的常驻钉，不经子进程直接打判据内核）：
 *   「exit≠0 **或** success≠true，且文件级成因=0、运行级成因=0、红=0、skip=0」的
 *   **一切无法归因形态**一律红——banner 只是归因通道之一，匹配不到绝不落回「与基线一致」。
 *   钉住它是因为父席点名的新脆弱耦合：门禁若只认 banner，vitest 升级改文案=静默放行；
 *   E 钉 banner 契约（升级先红），F 钉「banner 失配期间也红」，两条防线各管一半。
 *   界外（诚实登记，不编造检测手段）：worker 回收后的定时器异常 vitest 自身零痕迹 exit=0，
 *   任何基于其输出的判据都检不出；以及「红在场 + banner 失配」期间不可检出，防线即 E 先红。
 * 两态实测（修前旧门 PASS / 修后同形红）的一次性证据见 .scratch/n5-repro（OLD.out/NEW.out），
 * 本文件承担的是**常驻**回归；成因规则被短路（如变异实验）时 A/B/D/E/F 五条即红。
 */
import { expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
// gate-causes.mjs 是零依赖 ESM 判据内核（无类型面）；用非字面量动态导入，运行时同源加载，
// 不给 tsc 增设 .d.ts 声明面（声明会成第二份要维护的「形状」，与判据唯一实现原则相悖）。
const gateCausesUrl = new URL('../gate-causes.mjs', import.meta.url).href;

const POC = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = join(POC, '..', '..');

type Summary = {
  status: number; success: boolean; reds: number; passed: number; skipped: number;
  bannerInStderr?: boolean;
  causes: { file: string; kind: string; sig: string }[];
  unregistered: { file: string; kind: string; sig: string }[];
};

test('N5 同形注入 ⇒ 未登记成因必红；纯断言红同形 ⇒ 零误报；钩子/收集形态不丢（GT-1 不回退）', async () => {
  const r = spawnSync('node', [join(POC, 'tests', 'helpers', 'n5-causes-probe.mjs')],
    { cwd: REPO, encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024, timeout: 420_000 });
  expect(r.status, `探针进程失败：${(r.stderr ?? '').slice(-500)}`).toBe(0);
  const { summary } = JSON.parse(r.stdout.slice(r.stdout.indexOf('{'))) as { summary: Record<string, Summary> };

  // A 吸收形：登记红 + afterAll 抛错共存（旧门在此放行的正是这个形状）。
  const A = summary.A;
  expect(A.reds, '夹具自身的登记红必须在（否则不是吸收形）').toBeGreaterThanOrEqual(1);
  expect(A.unregistered.length, '吸收形必须产出 ≥1 条未登记成因').toBeGreaterThanOrEqual(1);
  expect(A.unregistered.some((c) => c.kind === 'hook-or-file-error'
    && c.sig.includes('N5 probe absorption')), '成因必须是钩子异常类且签名可指认').toBe(true);

  // B 钩子形：没有任何断言红也要红（GT-1 的纯形态，修前就红，不许回退）。
  const B = summary.B;
  expect(B.reds).toBe(0);
  expect(B.unregistered.some((c) => c.kind === 'hook-or-file-error'
    && c.sig.includes('N5 probe hook-only'))).toBe(true);

  // C 对照形：基线 133 例的红全是这个形状 ⇒ 成因必须为空（零误报钉）。
  const C = summary.C;
  expect(C.reds).toBeGreaterThanOrEqual(1);
  expect(C.causes, '纯断言红不得产出任何文件级成因（133 例基线零误报的常驻前提）').toEqual([]);

  // D 收集形：import 崩溃必须产出 collection-error（JSON 里 0 断言 + 文件级 message）。
  const D = summary.D;
  expect(D.causes.some((c) => c.kind === 'collection-error')).toBe(true);

  // E 运行级吸收形（第六轮）：登记红在场**不豁免**未归属运行级异常——banner 通道独立判定。
  const E = summary.E;
  expect(E.reds, '夹具自身的登记红必须在（否则不是运行级吸收形）').toBeGreaterThanOrEqual(1);
  expect(E.bannerInStderr, 'default reporter 必须在 stderr 打 Unhandled Errors banner——'
    + '本断言是被钉的 reporter 输出契约（与 vitest 4.1.11 实测形态绑定）：升级 vitest 若改文案，'
    + '这条必须**先红**并按「守卫需随 reporter 形态更新」显式适配，禁止放宽断言迁就新版；'
    + 'banner 通道失配期间门禁靠「无法归因⇒保守判红」兜底，不放行').toBe(true);
  expect(E.causes.some((c) => c.file !== '<vitest-run>'),
    'JSON 侧零痕迹是本形态的定义（第六轮实测）：不得出现任何文件级成因，'
    + '否则判据测试会退化成文件级测试的重复').toBe(false);
  expect(E.unregistered.length, '运行级吸收形必须产出 ≥1 条未登记运行级成因').toBeGreaterThanOrEqual(1);
  expect(E.unregistered.some((c) => c.file === '<vitest-run>'
    && c.kind === 'uncaught-or-run-level'
    && c.sig.includes('N5 probe runlevel')), '运行级成因必须归属 <vitest-run> 且签名可指认').toBe(true);

  // F 兜底形：反转默认的常驻钉（合成 JSON，直接打 collectCauses，不依赖子进程）。
  const { assessCauses, collectCauses, registeredCauses } = await import(gateCausesUrl);
  const reg = registeredCauses({}); // 与现基线同形：file_causes 未登记 ⇒ 空集
  const greenJson = {
    testResults: [{ name: 'x.test.ts', status: 'passed', assertionResults: [{ status: 'passed' }] }],
    success: true,
  };
  const fNormal = assessCauses(
    collectCauses(greenJson, { status: 0, totalReds: 0, totalSkipped: 0, stderr: '' }), reg);
  expect(fNormal, '正常绿（exit 0/success true/无 banner）不得产出任何成因——兜底不误伤').toEqual([]);
  // banner 失配（如 vitest 升级改文案）+ 无红无 skip + exit≠0 ⇒ 必须保守判红，禁止落回一致。
  const fNoBanner = assessCauses(
    collectCauses(greenJson, { status: 1, totalReds: 0, totalSkipped: 0, stderr: 'Test Files 1 passed\n' }), reg);
  expect(fNoBanner.length, '无法归因的非零状态必须产出一条保守判红成因（反转默认）').toBe(1);
  expect(fNoBanner[0].sig, '兜底签名必须写明无法归因与保守判红（父席裁定的原文语义）')
    .toContain('运行结果无法归因');
  // success=false 与 exit=0 的矛盾形态同样无法归因 ⇒ 红。
  const fSkew = assessCauses(
    collectCauses({ ...greenJson, success: false }, { status: 0, totalReds: 0, totalSkipped: 0, stderr: '' }), reg);
  expect(fSkew.length, 'success=false 且无任何解释 ⇒ 红（不依赖 exit 单通道）').toBe(1);
}, 480_000);
