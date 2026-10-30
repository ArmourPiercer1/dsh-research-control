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
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const REPO = join(ROOT, '..', '..');
const CONFIG = join(ROOT, 'vitest.config.ts');
const argv = process.argv.slice(2);
const baselinePath = argv.includes('--baseline')
  ? argv[argv.indexOf('--baseline') + 1]
  : join(ROOT, 'attacks', 'BASELINE.json');

// GT-4（外部复审第四轮，席位 G2-A/G3-A 两次实测放大）：原先这里是魔数下限 90，而实际例数
// 一路涨到 167 ⇒ **可静默消失的窗口 = 167 − 90 = 77 例 ≈ 46%**：整删 4 个测试文件（47 例）后
// 门禁仍打印「OK —— 90 例全绿」PASS。魔数下限本身不可信（注释还停在「当前 95 例」），
// 故换成与审查方流**同构的显式锚**：`AUTHOR_ANCHOR.json` 记录 passed / files / 生成提交，
// 判据是**逐等**而非 ≥ —— 变多变少都必须显式 `--reanchor` 承认。
// 理由：覆盖面缩水与覆盖面静默增长是同一类失真，后者让「全绿」这句话的含义随时间悄悄漂移。
const anchorPath = argv.includes('--anchor')
  ? argv[argv.indexOf('--anchor') + 1]
  : join(ROOT, 'AUTHOR_ANCHOR.json');
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
  const passNames = new Set();   // G-2：通过项的身份也要留痕
  const loadErrors = [];   // 收集/解析期失败：testResults 里有文件但没有断言 ⇒ 不是"已知断言红"
  let passed = 0;
  let skipped = 0;
  let success = false;   // 必须在 try 外声明：解析失败时也要能被判为 false
  let total = 0;         // 同上：j 是 try 内的局部量，外层取值必须提前声明
  try {
    const j = JSON.parse(out.slice(start));
    success = j.success === true;
    total = j.numTotalTests ?? 0;
    for (const f of j.testResults ?? []) {
      // 外部复审第三轮：审查方流**允许**已知断言失败，但不允许"文件根本没跑起来"混在里面。
      // 收集期/解析期崩溃的文件有 status=failed 却没有 assertionResults ⇒ 单独收集。
      const reds = (f.assertionResults ?? []).filter((a) => a.status === 'failed').length;
      // GT-1（席位 G1-A 实测）：原判据要求「该文件 0 条断言」，于是「断言全通过 + afterAll 抛错」
      // 这类**清理期崩溃**被读成正常（vitest exit=1 / success=false，门禁仍 PASS）。
      // 新判据：文件级失败但**没有任何一条已登记断言失败**能解释它 ⇒ 判收集/解析/清理期失败。
      // 席位在现有 attacks 上实测零误报（命中其夹具 1 份，11 份已知红文件不误报）。
      if ((f.status === 'failed' && reds === 0) || ((f.assertionResults ?? []).length === 0 && f.message)) {
        loadErrors.push(`${String(f.name ?? '?').replace(REPO + '/', '')}：${String(f.message ?? '文件级失败但无一条断言失败可解释（清理/收集期崩溃）').split('\n')[0].slice(0, 160)}`);
      }
      for (const a of f.assertionResults ?? []) {
        if (a.status === 'failed') failed.add(`${f.name.replace(REPO + '/', '')} > ${a.fullName}`);
        else if (a.status === 'passed') { passed += 1; passNames.add(`${f.name.replace(REPO + '/', '')} > ${a.fullName}`); }
        else skipped += 1;   // pending / skipped / todo —— 作者流里一条都不许有
      }
    }
  } catch {
    return { failed: null, passNames: null, loadErrors: null, total: 0, passed: 0, skipped: 0,
      status: r.status, success: false, raw: (out + (r.stderr ?? '')).slice(-800) };
  }
  return { failed, passNames, loadErrors, total: total || (failed.size + passed + skipped),
    passed, skipped, status: r.status, success, raw: '' };
}

note('[1/3] 类型门（含作者 tests，不含 attacks/**）');
const t = spawnSync('npx', ['tsc', '-p', join(ROOT, 'tsconfig.json')], { cwd: REPO, encoding: 'utf-8' });
if (t.status !== 0) { fail.push('tsc: ' + (t.stdout ?? '').split('\n').filter(Boolean).slice(0, 5).join(' | ')); }
else note('  OK');

note('[2/3] 作者测试门（tests/**，0 红是硬条件）');
const a = runVitest([join(ROOT, 'tests')]);
// 显式重锚：只能记"当前真实通过数"，且当前必须干净（有红/有 skip 一律拒写），
// 否则重锚就变成了把回归洗成基线的通道——那是 GT-3 教过的事。
if (argv.includes('--reanchor')) {
  if (a.failed === null || a.status !== 0 || !a.success || a.skipped > 0 || a.failed.size > 0) {
    fail.push('拒绝写锚：作者测试当前不干净（有红 / 有 skip / 非零退出）。锚只能记真实通过数。');
  } else {
    const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf-8' }).stdout.trim();
    writeFileSync(anchorPath, JSON.stringify({
      generated_from_commit: head,
      passed: a.passed,
      total: a.total,
      note: '作者侧覆盖面锚（GT-4）。判据是逐等而非 ≥：实测通过数与本文件 passed 不等即红，'
        + '变少=测试被删/被排除/被 skip，变多=「全绿」的含义已漂移；两者都必须显式 --reanchor 承认。',
    }, null, 2) + '\n');
    note(`  已重锚 ${anchorPath}：passed=${a.passed} total=${a.total} @ ${head.slice(0, 7)}`);
  }
}
let anchor = null;
let anchorErr = '';
try {
  anchor = JSON.parse(readFileSync(anchorPath, 'utf-8'));
} catch (e) {
  anchorErr = `作者覆盖面锚缺失或不可解析（${String(e.message).split('\n')[0]}）：`
    + `覆盖面判据失效，须显式 \`node g0-gate.mjs --reanchor\` 建立`;
}
if (a.failed === null) fail.push('作者测试门无法解析 vitest 输出:\n' + a.raw);
else if (a.status !== 0) fail.push(`作者测试门 vitest 退出码=${a.status}，解析到的红条数=${a.failed.size}。`
  + `典型成因：测试文件在 import 阶段崩溃（收集期错误不进 assertionResults）——`
  + `只看断言计数会把它读成"全绿"。`);
else if (!a.success) fail.push('作者测试门 success=false 但未解析到红条（同上的收集期崩溃形态）');
else if (a.skipped > 0) fail.push(`作者测试门出现 ${a.skipped} 条 skip/pending —— 跳过不是通过。`
  + `整文件 skip 时 vitest 退出码仍为 0，只有计数能抓住它`);
else if (a.failed.size > 0) fail.push(`作者测试红 ${a.failed.size} 条：\n  ${[...a.failed].join('\n  ')}`);
else if (anchorErr) fail.push(anchorErr);
else if (!/^[0-9a-f]{7,40}$/.test(anchor.generated_from_commit ?? '')) {
  fail.push('作者锚缺 generated_from_commit 或不是提交号：覆盖面判据的来源不可追溯');
} else if (spawnSync('git', ['merge-base', '--is-ancestor', anchor.generated_from_commit, 'HEAD'],
  { cwd: REPO, encoding: 'utf-8' }).status !== 0) {
  fail.push(`作者锚的 ${anchor.generated_from_commit} 不是 HEAD 的祖先：来自分叉或已 rebase，须重锚`);
} else if (a.passed !== anchor.passed) {
  fail.push(`作者覆盖面漂移：实测 ${a.passed} 例 ≠ 锚 ${anchor.passed} 例`
    + `（锚建于 ${String(anchor.generated_from_commit).slice(0, 7)}）。`
    + `变少 ⇒ 测试被删 / 被排除 / 被 skip；变多 ⇒ 「全绿」这句话的含义已经漂移。`
    + `两个方向都必须核对差异后显式 \`node g0-gate.mjs --reanchor\` 承认。`);
} else note(`  OK —— ${a.passed} 例全绿，与覆盖面锚逐等（skip=0，exit=0，success=true）`);

note('[3/3] 审查方基线门（attacks/**：多一条要查，少一条也要查）');
const b = JSON.parse(readFileSync(baselinePath, 'utf-8'));
// P2-4（席位 A）：`generated_from_commit` 原先只是注释性字段，不参与校验 ⇒ 基线可以悄悄
// 停在旧提交上，红条集合早已变化而门禁仍"完全相等"。现在要求它存在、且确实是 HEAD 的祖先。
if (!/^[0-9a-f]{7,40}$/.test(b.generated_from_commit ?? '')) {
  fail.push('BASELINE.json 缺 generated_from_commit 或不是提交号：基线来源不可追溯');
} else {
  const anc = spawnSync('git', ['merge-base', '--is-ancestor', b.generated_from_commit, 'HEAD'],
    { cwd: REPO, encoding: 'utf-8' });
  if (anc.status !== 0) fail.push(`BASELINE.json 的 ${b.generated_from_commit} 不是 HEAD 的祖先：`
    + `基线来自分叉或已 rebase，须在其对应的干净 worktree 上重生成`);
}
const known = new Set(b.failures);
const v = runVitest([join(ROOT, 'attacks')]);
if (v.failed === null) fail.push('审查方门无法解析 vitest 输出:\n' + v.raw);
else if (v.status === 0 && v.passed === 0 && known.size > 0) fail.push('审查方门 0 通过且退出码 0：疑似整目录未被收集');
else {
  // G-2（外部复审，2026-10-30）：只比失败集合会被**覆盖面缩水**骗过——
  // 原本通过的审查方测试被 describe.skip、被删文件、被改名时，失败集合可以一字不变，
  // 门禁照样报"与基线一致"。所以通过项的身份同样必须在基线里，且必须逐一对上。
  if (v.loadErrors.length > 0) fail.push(`审查方收集期失败 ${v.loadErrors.length} 份文件 —— 这与"已知断言红"是两类事，`
    + `不能因为失败集合没变就当没发生：\n  ${v.loadErrors.join('\n  ')}`);
  if (v.skipped > 0) fail.push(`审查方出现 ${v.skipped} 条 skip/pending：被跳过的覆盖面必须显式入基线，不能静默消失`);
  if ((b.total ?? 0) > 0 && v.total !== b.total) fail.push(`审查方收集总数 ${v.total} ≠ 基线 ${b.total}：有文件没被收集或凭空多出一份`);
  if ((b.total ?? 0) === 0) fail.push('BASELINE.json 缺 total：收集总数变化无法被发现');
  const knownPass = new Set(b.passes ?? []);
  if ((b.passes?.length ?? 0) === 0) fail.push('BASELINE.json 缺 passes：覆盖面缩水无法被发现（G-2）');
  const pAdded = [...v.passNames].filter((x) => !knownPass.has(x)).sort();
  const pGone = [...knownPass].filter((x) => !v.passNames.has(x)).sort();
  if (pAdded.length > 0) fail.push(`审查方新增通过 ${pAdded.length} 条（覆盖面变大，须显式入基线）：\n  ${pAdded.join('\n  ')}`);
  if (pGone.length > 0) fail.push(`审查方测试消失或不再通过（skip / 改名 / 删文件都长这样）`
    + ` —— 覆盖面缩水绝不能读成"与基线一致"：\n  ${pGone.join('\n  ')}`);
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
