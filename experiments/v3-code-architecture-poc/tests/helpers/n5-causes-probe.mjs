/**
 * N5 常驻探针（被 `tests/n5-failure-cause-signature.test.ts` 以子进程拉起）。
 *
 * 血统：RE-REVIEW-G2-A.md §③ N5（P2）+ G6-A §①#11 —— 「同文件一条已登记断言红会把
 * afterAll 抛错吸收成已知失败」的**同形注入**在门禁 [3/3] 流必须红（席位测得 133 例基线
 * 零误报，裁定要求把该测量落成测试）。本探针把四类形态各造一个最小 vitest 夹具集，
 * 用 `gate-causes.mjs` 的**唯一实现**（与 g0-gate.mjs 同一份代码，禁第二拷贝）提取成因，
 * 输出 JSON 摘要给 TS 侧断言。
 *
 * 形态集：
 *   A 吸收形  = 纯断言红 + afterAll 抛错（旧门放成 PASS 的同形 ⇒ 必须产出未登记成因）；
 *   B 钩子形  = 全绿 + afterAll 抛错（GT-1 纯形态不回退）；
 *   C 对照形  = 纯断言红（基线 133 例的全部红都是这个形状 ⇒ 成因必须为 0 = 零误报）；
 *   D 收集形  = import 不存在的模块（收集期错误必须产出成因）；
 *   E 运行级吸收形（第六轮 G0-R 收尾）= 纯断言红 + **未归属任何文件**的运行级异常
 *     （未处理 rejection）。旧判据的 `totalReds===0` 前置让红条把它豁免成已知失败；
 *     修复后 banner 通道（gate-causes.unhandledBannerCauses）**不看 reds** ⇒ 必须产出
 *     未登记的 `<vitest-run>` 运行级成因。vitest 4.1.11 实测：这种异常在 JSON 里
 *     **零痕迹**（顶层无 errors/failureMessage 键、文件级 message 为空），唯一落点是
 *     default reporter 写 stderr 的 `Unhandled Errors` banner——`--reporter=json`
 *     单独跑或加 basic 都把它丢弃，故本探针与 g0-gate 同形：
 *     `--reporter=json --outputFile.json=<file> --reporter=default`，stderr 传进判据。
 *
 * 夹具写在 `.poc-data/n5-probe-*`（gitignored、跑完即删）。注意：全量无过滤收集时
 * `.poc-data` 里的 `.test.ts` 会被收进——这正是探针运行期间的事后瞬态，探针结束即清理。
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectCauses, assessCauses } from '../../gate-causes.mjs';

const HELPERS = dirname(fileURLToPath(import.meta.url)); // <repo>/experiments/v3-code-architecture-poc/tests/helpers
const POC = join(HELPERS, '..', '..');
const REPO = join(POC, '..', '..');
const CONFIG = join(POC, 'vitest.config.ts');
const TAG = 'seat7-perm';

mkdirSync(join(POC, '.poc-data'), { recursive: true });
const dir = mkdtempSync(join(POC, '.poc-data', 'n5-probe-'));
try {
  const write = (set, name, body) => {
    mkdirSync(join(dir, set), { recursive: true });
    writeFileSync(join(dir, set, name), body);
    return join(dir, set, name);
  };
  const files = {
    A: write('a', 'a1-absorption.test.ts',
      `import { afterAll, expect, test } from 'vitest';\n`
      + `test('baseline-shaped known red (pure assertion)', () => { expect(1).toBe(2); });\n`
      + `afterAll(() => { throw new Error('N5 probe absorption ${TAG}'); });\n`),
    B: write('b', 'b1-hook-only.test.ts',
      `import { afterAll, expect, test } from 'vitest';\n`
      + `test('green test', () => { expect(1).toBe(1); });\n`
      + `afterAll(() => { throw new Error('N5 probe hook-only ${TAG}'); });\n`),
    C: write('c', 'c1-red-only.test.ts',
      `import { expect, test } from 'vitest';\n`
      + `test('baseline-shaped known red only', () => { expect(1).toBe(2); });\n`),
    D: write('d', 'd1-collection.test.ts',
      `import './missing-module-${TAG}.ts';\n`
      + `import { expect, test } from 'vitest';\n`
      + `test('never collected', () => { expect(1).toBe(1); });\n`),
    E: write('e', 'e1-runlevel-absorption.test.ts',
      `import { expect, test } from 'vitest';\n`
      + `test('baseline-shaped known red (pure assertion)', () => { expect(1).toBe(2); });\n`
      + `Promise.reject(new Error('N5 probe runlevel unhandled ${TAG}'));\n`),
  };
  const summary = {};
  for (const [set, file] of Object.entries(files)) {
    const jsonPath = join(dir, `${set}-report.json`);
    const r = spawnSync('npx', ['vitest', 'run', '--config', CONFIG,
      '--reporter=json', `--outputFile.json=${jsonPath}`, '--reporter=default', file],
    { cwd: REPO, encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 });
    let out = '';
    try {
      out = readFileSync(jsonPath, 'utf-8');
    } catch {
      out = '';
    }
    if (out.trim() === '') out = r.stdout ?? '';
    const j = JSON.parse(out.slice(out.indexOf('{')));
    let reds = 0; let passed = 0; let skipped = 0;
    for (const f of j.testResults ?? []) {
      for (const a of f.assertionResults ?? []) {
        if (a.status === 'failed') reds += 1; else if (a.status === 'passed') passed += 1; else skipped += 1;
      }
    }
    const causes = collectCauses(j, { status: r.status, totalReds: reds, totalSkipped: skipped,
      stripPrefix: REPO + '/', stderr: r.stderr ?? '' });
    // 登记集恒空——与当前基线同形（BASELINE.json 无 file_causes 字段）。
    const unregistered = assessCauses(causes, new Set()).map((c) => ({ file: c.file, kind: c.kind, sig: c.sig }));
    summary[set] = { status: r.status, success: j.success, reds, passed, skipped,
      bannerInStderr: /Unhandled Errors/.test(r.stderr ?? ''),
      causes, unregistered };
  }
  process.stdout.write(JSON.stringify({ ok: true, dir, summary }));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
