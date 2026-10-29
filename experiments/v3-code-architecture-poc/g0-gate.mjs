#!/usr/bin/env node
/**
 * G0 回归门禁（可稳定执行版）。
 *
 * 为什么要有它：全量里长期存在审查方红条。若只是"知道那 31 条是正常的"，
 * 时间一长没人再核对，门禁就退化成噪音——**新增的真回归会混在已知红里溜过去**，
 * 而"某条红消失了"（= 它记录的洞被修好了）也没人发现，基线就此失真。
 *
 * 三条流分开判，任一不合预期即非零退出：
 *   1. `tsc`            —— 必须 0 错；
 *   2. 作者测试 `tests/**` —— 必须 0 红（这一条**永不放宽**）；
 *   3. 审查方 `attacks/**` —— 失败集合必须与 `attacks/BASELINE.json` **完全相等**：
 *        多出红条 ⇒ 红（新增失败必须先定性：产品缺陷还是修复导致，写进 EVIDENCE 再更新基线）；
 *        少了红条 ⇒ 也红（说明某个洞被修好了，必须显式确认并更新基线，不许静默通过）。
 *
 * 这不是把审查方的红"藏起来"：恰恰相反，它把红条集合变成**被逐条盯住的资产**。
 * 基线文件由作者维护，但内容全部来自审查方的实测失败名，作者不改他们的测试。
 *
 * 用法：node experiments/v3-code-architecture-poc/g0-gate.mjs [--baseline <path>]
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const REPO = join(ROOT, '..', '..');
const CONFIG = join(ROOT, 'vitest.config.ts');
const argv = process.argv.slice(2);
const baselinePath = argv.includes('--baseline')
  ? argv[argv.indexOf('--baseline') + 1]
  : join(ROOT, 'attacks', 'BASELINE.json');

const fail = [];
const note = (s) => console.log(s);

/** 跑一次 vitest，返回 { failed: Set<string>, passed: number, raw }。 */
function runVitest(paths) {
  const r = spawnSync('npx', ['vitest', 'run', '--config', CONFIG, '--reporter=json', ...paths],
    { cwd: REPO, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
  const out = r.stdout ?? '';
  const start = out.indexOf('{');            // reporter=json 前可能混有 banner 行
  const failed = new Set();
  let passed = 0;
  try {
    const j = JSON.parse(out.slice(start));
    for (const f of j.testResults ?? []) {
      for (const a of f.assertionResults ?? []) {
        if (a.status === 'failed') failed.add(`${f.name.replace(REPO + '/', '')} > ${a.fullName}`);
        else if (a.status === 'passed') passed += 1;
      }
    }
  } catch {
    return { failed: null, passed: 0, raw: (out + (r.stderr ?? '')).slice(-800) };
  }
  return { failed, passed, raw: '' };
}

note('[1/3] 类型门（含作者 tests，不含 attacks/**）');
const t = spawnSync('npx', ['tsc', '-p', join(ROOT, 'tsconfig.json')], { cwd: REPO, encoding: 'utf-8' });
if (t.status !== 0) { fail.push('tsc: ' + (t.stdout ?? '').split('\n').filter(Boolean).slice(0, 5).join(' | ')); }
else note('  OK');

note('[2/3] 作者测试门（tests/**，0 红是硬条件）');
const a = runVitest([join(ROOT, 'tests')]);
if (a.failed === null) fail.push('作者测试门无法解析 vitest 输出:\n' + a.raw);
else if (a.failed.size > 0) fail.push(`作者测试红 ${a.failed.size} 条：\n  ${[...a.failed].join('\n  ')}`);
else note(`  OK —— ${a.passed} 例全绿`);

note('[3/3] 审查方基线门（attacks/**：多一条要查，少一条也要查）');
const b = JSON.parse(readFileSync(baselinePath, 'utf-8'));
const known = new Set(b.failures);
const v = runVitest([join(ROOT, 'attacks')]);
if (v.failed === null) fail.push('审查方门无法解析 vitest 输出:\n' + v.raw);
else {
  const added = [...v.failed].filter((x) => !known.has(x));
  const gone = [...known].filter((x) => !v.failed.has(x));
  if (added.length) fail.push(`审查方新增红 ${added.length} 条（先定性再更新基线）：\n  ${added.join('\n  ')}`);
  if (gone.length) fail.push(`审查方红条消失 ${gone.length} 条 ⇒ 可能意味着洞已关闭，必须显式确认：\n  ${gone.join('\n  ')}`);
  if (!added.length && !gone.length) note(`  OK —— 与基线完全一致（${known.size} 条已知红，均已定性）`);
}

if (fail.length) {
  console.error('\n[g0-gate] FAIL');
  for (const f of fail) console.error(' - ' + f);
  process.exit(1);
}
console.log('\n[g0-gate] PASS —— 三条流均符合预期（审查方红条是"已定性的已知项"，不代表产品通过）');
