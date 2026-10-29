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

const AUTHOR_MIN_PASSED = 90;   // 作者侧当前 95 例；下限兜住「测试整批消失」这一类假绿
const fail = [];
const note = (s) => console.log(s);

/** 跑一次 vitest，返回 { failed: Set<string>, passed: number, raw }。 */
function runVitest(paths) {
  const r = spawnSync('npx', ['vitest', 'run', '--config', CONFIG, '--reporter=json', ...paths],
    { cwd: REPO, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
  // 席位 A 实测的假绿路径：测试文件在 **import 阶段**损坏时，vitest 退出码=1、success=false，
  // 但 JSON 里没有任何 assertionResult ⇒ failed 集合为空 ⇒ 门禁会打印"全绿"。
  // 退出码与 success 必须单独判，不能只看断言计数。
  const out = r.stdout ?? '';
  const start = out.indexOf('{');            // reporter=json 前可能混有 banner 行
  const failed = new Set();
  let passed = 0;
  let skipped = 0;
  let success = false;   // 必须在 try 外声明：解析失败时也要能被判为 false
  try {
    const j = JSON.parse(out.slice(start));
    success = j.success === true;
    for (const f of j.testResults ?? []) {
      for (const a of f.assertionResults ?? []) {
        if (a.status === 'failed') failed.add(`${f.name.replace(REPO + '/', '')} > ${a.fullName}`);
        else if (a.status === 'passed') passed += 1;
        else skipped += 1;   // pending / skipped / todo —— 作者流里一条都不许有
      }
    }
  } catch {
    return { failed: null, passed: 0, skipped: 0, status: r.status, success: false, raw: (out + (r.stderr ?? '')).slice(-800) };
  }
  return { failed, passed, skipped, status: r.status, success, raw: '' };
}

note('[1/3] 类型门（含作者 tests，不含 attacks/**）');
const t = spawnSync('npx', ['tsc', '-p', join(ROOT, 'tsconfig.json')], { cwd: REPO, encoding: 'utf-8' });
if (t.status !== 0) { fail.push('tsc: ' + (t.stdout ?? '').split('\n').filter(Boolean).slice(0, 5).join(' | ')); }
else note('  OK');

note('[2/3] 作者测试门（tests/**，0 红是硬条件）');
const a = runVitest([join(ROOT, 'tests')]);
if (a.failed === null) fail.push('作者测试门无法解析 vitest 输出:\n' + a.raw);
else if (a.status !== 0) fail.push(`作者测试门 vitest 退出码=${a.status}，解析到的红条数=${a.failed.size}。`
  + `典型成因：测试文件在 import 阶段崩溃（收集期错误不进 assertionResults）——`
  + `只看断言计数会把它读成"全绿"。`);
else if (!a.success) fail.push('作者测试门 success=false 但未解析到红条（同上的收集期崩溃形态）');
else if (a.skipped > 0) fail.push(`作者测试门出现 ${a.skipped} 条 skip/pending —— 跳过不是通过。`
  + `整文件 skip 时 vitest 退出码仍为 0，只有计数能抓住它`);
else if (a.passed < AUTHOR_MIN_PASSED) fail.push(`作者测试通过数 ${a.passed} < 下限 ${AUTHOR_MIN_PASSED}：`
  + `测试集合被裁剪（文件丢失/被排除）同样表现为"0 红"，这条兜住"红是零但测试没了"`);
else if (a.failed.size > 0) fail.push(`作者测试红 ${a.failed.size} 条：\n  ${[...a.failed].join('\n  ')}`);
else note(`  OK —— ${a.passed} 例全绿（skip=${a.skipped}，exit=0，success=true）`);

note('[3/3] 审查方基线门（attacks/**：多一条要查，少一条也要查）');
const b = JSON.parse(readFileSync(baselinePath, 'utf-8'));
const known = new Set(b.failures);
const v = runVitest([join(ROOT, 'attacks')]);
if (v.failed === null) fail.push('审查方门无法解析 vitest 输出:\n' + v.raw);
else if (v.status === 0 && v.passed === 0 && known.size > 0) fail.push('审查方门 0 通过且退出码 0：疑似整目录未被收集');
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
