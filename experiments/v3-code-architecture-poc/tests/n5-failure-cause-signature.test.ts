/**
 * N5 常驻测试（RE-REVIEW-G2-A.md §③ N5，P2；G6-A §①#11 复现；第五轮裁定第②点修法要件）。
 *
 * 起因为何：旧门 [3/3] 判据「文件 failed 且 reds===0 ⇒ 收集期失败」只修 GT-1 的一半——
 * **同文件只要有一条已登记断言红，afterAll 抛错就被吸收成已知失败、门禁 PASS**（吸收形）。
 * 修法（gate-causes.mjs 唯一实现）：文件级失败一律提取成因签名，任何未登记成因一律红；
 * 纯断言红不产出成因 ⇒ 33 条已登记红的 133 例基线零误报（席位实测；本测试把该实测落成常驻）。
 *
 * 本测试跑法：子进程拉起 `tests/helpers/n5-causes-probe.mjs`（vitest JSON 夹具×4 形态），
 * 对摘要做四条判定——
 *   A 吸收形 ⇒ **必须红**（第五轮裁定的同形注入要件）；
 *   B 钩子形（全绿+afterAll）⇒ 必须红（GT-1 不回退）；
 *   C 对照形（纯断言红）⇒ 成因必须为 0（零误报=基线前提的常驻钉）；
 *   D 收集形 ⇒ 必须产出 collection-error 成因。
 * 两态实测（修前旧门 PASS / 修后同形红）的一次性证据见 .scratch/n5-repro（OLD.out/NEW.out），
 * 本文件承担的是**常驻**回归；成因规则被短路（如变异实验）时 A/B/D 三条即红。
 */
import { expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const POC = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = join(POC, '..', '..');

type Summary = {
  status: number; success: boolean; reds: number; passed: number; skipped: number;
  causes: { file: string; kind: string; sig: string }[];
  unregistered: { file: string; kind: string; sig: string }[];
};

test('N5 同形注入 ⇒ 未登记成因必红；纯断言红同形 ⇒ 零误报；钩子/收集形态不丢（GT-1 不回退）', () => {
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
}, 480_000);
