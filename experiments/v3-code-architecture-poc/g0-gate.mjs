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
 *      且**文件级失败必须逐条登记成因**（N5，gate-causes.mjs）：钩子异常/收集期错误/
 *        未捕获异常各有签名，登记在基线可选字段 `file_causes`；任何未登记成因一律红。
 *
 * 这不是把审查方的红"藏起来"：恰恰相反，它把红条集合变成**被逐条盯住的资产**。
 * 基线文件由作者维护，但内容全部来自审查方的实测失败名，作者不改他们的测试。
 *
 * 用法：node experiments/v3-code-architecture-poc/g0-gate.mjs [--baseline <读路径>]
 *      [--anchor <读路径>] [--reanchor]
 *      [--write-baseline [写路径]]  —— 基线写入通道（缺省写正源 BASELINE.json）：
 *        工作树不干净 / 流不可解析 / 出现 skip ⇒ 拒写（临时路径同判据，见 `writeBaseline` 定义处注释）。
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { collectCauses, assessCauses, registeredCauses, causeKey } from './gate-causes.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const REPO = join(ROOT, '..', '..');
const CONFIG = join(ROOT, 'vitest.config.ts');
const argv = process.argv.slice(2);
const baselinePath = argv.includes('--baseline')
  ? argv[argv.indexOf('--baseline') + 1]
  : join(ROOT, 'attacks', 'BASELINE.json');

// GT-4（外部复审第四轮起源，包 5 升级为**身份锚**；本注释先前版本有错，一并修正）。
// 演化三代：
// ① 魔数下限 90：实际例数涨到 167 ⇒ 可静默消失窗口 = 77 例 ≈ 46%，整删 4 个测试文件后
//    门禁仍打印「OK —— 90 例全绿」PASS。
// ② 计数锚（包 4 前后）：`AUTHOR_ANCHOR.json` 实现里实际记录的是 generated_from_commit /
//    passed / total / note，**判据只比 passed**（total 记了但从未参判）。本注释先前版本宣称
//    锚记「passed / files / 生成提交」——**没有 files 这个键**：注释与实现不符，是作者自己
//    承认的第二处错误文档（READINESS.md GT-4 行），本次先把注释改对。
// ③ 计数锚的真实缺口（席位 G4-A 实测，旧门禁 PASS 放过）：**等数替换**——删 K 条真用例、
//    补 K 条 `expect(1).toBe(1)`，passed/total 一字不变 ⇒ 「全绿」的含义已换而门禁无感。
//    计数钉不住覆盖面的**身份**。
// 现升级为身份锚，`AUTHOR_ANCHOR.json` 记录：generated_from_commit + passed + total +
// passed_sha256 + files_sha256 + note。判据**全部逐等**：
//   · passed / total——降级为可读冗余，但**仍参与判定**（不符即红，可读数字不得与摘要脱钩）；
//   · passed_sha256——排序后「文件相对路径 > 用例全名」集合的摘要（与审查方 BASELINE 的名集
//     判据同构）：用例增、删、改名、skip 一律变摘要；
//   · files_sha256——`tests/**` 全部文件「相对路径 + 内容 sha256」清单的摘要：删文件、加文件、
//     断言体乃至注释改一个字节都变摘要；
//   · generated_from_commit 必须是 HEAD 祖先（与审查方流同一条戳判据）。
// 拒写条款一字不动：当前有红 / 有 skip / 非零退出 / success=false ⇒ 拒绝 `--reanchor`，
// 且锚文件一字节都不动（锚只能记真实通过数——GT-3 的教训，实测钉在变异验收里）。
// **收不住的形态（如实登记）**：「改断言体**并且**重锚」——重锚是本机制要求的显式承认流程，
// 人一边改语义一边重新承认锚，任何摘要都拦不住；锚拦的是**静默**变更，含义漂移的防线是
// 变异抽检纪律（纪律，非机制）。此边界同步写进 READINESS.md GT-4 行。
const anchorPath = argv.includes('--anchor')
  ? argv[argv.indexOf('--anchor') + 1]
  : join(ROOT, 'AUTHOR_ANCHOR.json');
// —— 基线写入通道（第五轮收尾，父席指令：N5 的**配套**，不是可选项）——
// 背景（第六席·席位 G6-A 登记，父席第五轮裁定转配套）：`--baseline <path>` 一直是**只读重定向**——基线重生成在门禁外
// 用一次性脚本完成（历史上靠"干净 worktree"的口头纪律）。这意味着基线没有 `--reanchor`
// 那种拒写护栏，且比作者锚更隐蔽：改完 attacks 随手重算，攻击编辑就蒸进「已知红」。
// 现在写入走门禁本身并强制两条拒写判据（临时路径同判）：
//   ① `git status --porcelain` 非空（跟踪面不干净）⇒ 拒写——基线只能记可复现的树；
//   ② 审查方流不可解析 / 出现 skip ⇒ 拒写——skip 在基线里没有表示法，不许静默入册。
// 作者锚的拒写条款（[2/3] 处）不在此重复：它判的是「测试流干净」，此处判的是「工作树干净」。
const writeBaseline = argv.includes('--write-baseline')
  ? (argv[argv.indexOf('--write-baseline') + 1] && !argv[argv.indexOf('--write-baseline') + 1].startsWith('--')
    ? argv[argv.indexOf('--write-baseline') + 1]
    : join(ROOT, 'attacks', 'BASELINE.json'))
  : null;
const fail = [];
const note = (s) => console.log(s);

// —— GT-4 身份锚摘要（三代演化与如实边界见上方长注）——
const sha256hex = (buf) => createHash('sha256').update(buf).digest('hex');
/** 通过项身份摘要：`文件相对路径 > 用例全名` 排序集合。用例增/删/改名/skip 一律变摘要。 */
const passDigest = (names) => sha256hex([...names].sort().join('\n'));
/** tests/** 文件清单摘要：`相对路径\0内容sha256` 逐行清单再取摘要。改一个字节都变摘要。 */
function testsDigest() {
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);
  const files = walk(join(ROOT, 'tests')).sort();
  return sha256hex(files.map((f) => `${relative(ROOT, f)}\0${sha256hex(readFileSync(f))}`).join('\n'));
}

/** 跑一次 vitest，返回 { failed: Set<string>, passed: number, raw }。 */
function runVitest(paths) {
  // 第六轮（G0-R 收尾）：JSON **和** stderr banner 都要——`Unhandled Errors` 汇总只由
  // default reporter 写 stderr（实测 `--reporter=json` 单独跑或加 basic 都丢弃它），
  // 而 JSON reporter 的 stdout 会与 default 的进度输出混流。故 JSON 走
  // `--outputFile.json` 文件通道、default reporter 只贡献 stdout 进度与 stderr banner，
  // 两通道互不污染。banner 解析与「断言红不豁免运行级异常」在 gate-causes.mjs 唯一实现。
  const tmp = mkdtempSync(join(tmpdir(), 'g0-gate-'));
  const jsonPath = join(tmp, 'report.json');
  let r;
  try {
    r = spawnSync('npx', ['vitest', 'run', '--config', CONFIG,
      '--reporter=json', `--outputFile.json=${jsonPath}`, '--reporter=default', ...paths],
      { cwd: REPO, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
  // 席位 A 实测的假绿路径：测试文件在 **import 阶段**损坏时，vitest 退出码=1、success=false，
  // 但 JSON 里没有任何 assertionResult ⇒ failed 集合为空 ⇒ 门禁会打印"全绿"。
  // 退出码与 success 必须单独判，不能只看断言计数。
  let out = '';
  try {
    out = readFileSync(jsonPath, 'utf-8');
  } catch {
    out = '';
  }
  if (out.trim() === '') out = r.stdout ?? '';   // 兜底：旧单 reporter 形态（JSON 在 stdout）
  const failed = new Set();
  const passNames = new Set();   // G-2：通过项的身份也要留痕
  // N5（RE-REVIEW-G2-A §③ 裁定的实现，2026-10-31）：旧 loadErrors 判据
  // 「failed && reds===0」把**吸收形**（同文件一条登记红 + afterAll 抛错）放成 PASS。
  // 现在文件级失败一律提取**成因**（钩子异常/收集期错误/无法解释），连同运行级
  // 未捕获异常一起交给 gate-causes 判「是否逐条登记在基线 file_causes」——
  // **任何未登记成因一律红**；断言红不产出成因（名字核对归 failures/passes 集合管，
  // vitest 实测：只有断言失败时文件级 message 为空 ⇒ 133 例基线零误报）。
  let causes = [];
  let passed = 0;
  let skipped = 0;
  let success = false;   // 必须在 try 外声明：解析失败时也要能被判为 false
  let total = 0;         // 同上：j 是 try 内的局部量，外层取值必须提前声明
  let result;
  try {
    const j = JSON.parse(out.slice(out.indexOf('{')));
    success = j.success === true;
    total = j.numTotalTests ?? 0;
    for (const f of j.testResults ?? []) {
      for (const a of f.assertionResults ?? []) {
        if (a.status === 'failed') failed.add(`${f.name.replace(REPO + '/', '')} > ${a.fullName}`);
        else if (a.status === 'passed') { passed += 1; passNames.add(`${f.name.replace(REPO + '/', '')} > ${a.fullName}`); }
        else skipped += 1;   // pending / skipped / todo —— 作者流里一条都不许有
      }
    }
    // stderr 必须进 collectCauses：运行级 banner（通道①）在 JSON 里**零痕迹**，
    // 唯一落点是 default reporter 的 stderr（第六轮实测，gate-causes.mjs 头注）。
    causes = collectCauses(j, { status: r.status, totalReds: failed.size, totalSkipped: skipped,
      stripPrefix: REPO + '/', stderr: r.stderr ?? '' });
    result = { failed, passNames, causes, total: total || (failed.size + passed + skipped),
      passed, skipped, status: r.status, success, raw: '' };
  } catch {
    result = { failed: null, passNames: null, causes: null, total: 0, passed: 0, skipped: 0,
      status: r.status, success: false, raw: (out + (r.stderr ?? '')).slice(-800) };
  }
  rmSync(tmp, { recursive: true, force: true });
  return result;
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
      passed_sha256: passDigest(a.passNames),
      files_sha256: testsDigest(),
      note: '作者侧覆盖面**身份锚**（GT-4 包 5 升级，三代演化见 g0-gate.mjs 头注）。判据全部逐等：'
        + 'passed/total 是可读冗余但参判（不符即红）；passed_sha256 钉通过项身份（用例增/删/改名/skip 变摘要）；'
        + 'files_sha256 钉 tests/** 路径+内容（断言体乃至注释改一个字节变摘要）。'
        + '等数替换（删 K 真例补 K 假例）从计数锚的漏网形态变为双摘要齐红。'
        + '收不住：改断言体**并且**重锚——那是显式承认流程本身，防线是变异抽检纪律（纪律非机制）。',
    }, null, 2) + '\n');
    note(`  已重锚 ${anchorPath}：passed=${a.passed} total=${a.total} `
      + `passed_sha=${passDigest(a.passNames).slice(0, 12)}… files_sha=${testsDigest().slice(0, 12)}… @ ${head.slice(0, 7)}`);
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
} else if (a.passed !== anchor.passed || a.total !== anchor.total) {
  // passed/total 降级为可读冗余，但**仍参与判定**：可读数字不得与摘要脱钩（不符即红）。
  fail.push(`作者覆盖面计数漂移：实测 ${a.passed} 绿 / ${a.total} 总 ≠ 锚 ${anchor.passed} / ${anchor.total}`
    + `（锚建于 ${String(anchor.generated_from_commit).slice(0, 7)}）。`
    + `变少 ⇒ 测试被删 / 被排除 / 被 skip；变多 ⇒ 「全绿」这句话的含义已经漂移。`
    + `两个方向都必须核对差异后显式 \`node g0-gate.mjs --reanchor\` 承认。`);
} else if (typeof anchor.passed_sha256 !== 'string' || typeof anchor.files_sha256 !== 'string') {
  fail.push('作者锚缺 passed_sha256 / files_sha256（包 5 前的计数锚）：计数钉不住覆盖面**身份**'
    + '——等数替换（删 K 真例补 K 假例）计数一字不变而含义全换（席位 G4-A 实测 PASS 放过）。'
    + '身份锚升级须显式 \`node g0-gate.mjs --reanchor\` 完成。');
} else if (passDigest(a.passNames) !== anchor.passed_sha256) {
  fail.push(`作者通过集**身份**漂移：计数逐等（${a.passed}）但通过项名集摘要不等`
    + `（实测 ${passDigest(a.passNames).slice(0, 12)}… ≠ 锚 ${String(anchor.passed_sha256).slice(0, 12)}…）。`
    + `计数相等而名集不等 ⇒ 用例被改名 / 被换掉 / 被等数替换——「全绿」的两字中间换了货。`
    + `必须核对差异后显式 --reanchor。`);
} else if (testsDigest() !== anchor.files_sha256) {
  fail.push(`作者 tests/** 文件清单摘要不等（实测 ${testsDigest().slice(0, 12)}… ≠ 锚 `
    + `${String(anchor.files_sha256).slice(0, 12)}…）：名集与计数都没变而文件内容/路径变过`
    + `——断言体（乃至一个注释字节）与锚不一致。测试怎么写的也在锚定范围内，须核对后显式 --reanchor。`);
} else note(`  OK —— ${a.passed} 例全绿，与身份锚四项逐等（passed/total/passed_sha/files_sha；`
  + `skip=0，exit=0，success=true）`);

note('[3/3] 审查方基线门（attacks/**：多一条要查，少一条也要查）');
let b = null;
let bErr = '';
try {
  b = JSON.parse(readFileSync(baselinePath, 'utf-8'));
} catch (e) {
  bErr = `BASELINE.json 缺失或不可解析（${String(e.message).split('\n')[0]}）`;
}
const v = runVitest([join(ROOT, 'attacks')]);
if (writeBaseline !== null) {
  // 写入模式（护栏见 writeBaseline 定义处注释）：拒写判据通过才落盘；与旧基线的差异只作
  // 报告输出（写入本身就是「显式承认差异」的动作），不参与判定。
  const dirty = spawnSync('git', ['status', '--porcelain'], { cwd: REPO, encoding: 'utf-8' }).stdout.trim();
  if (dirty !== '') {
    fail.push('拒绝写基线：工作树不干净（`git status --porcelain` 非空）——基线只能从可复现的树写出；'
      + `先提交或还原改动再重算。当前差异前 5 行：\n  ${dirty.split('\n').slice(0, 5).join('\n  ')}`);
  } else if (v.failed === null) {
    fail.push('拒绝写基线：审查方流不可解析（vitest 输出非 JSON）');
  } else if (v.skipped > 0) {
    fail.push(`拒绝写基线：审查方出现 ${v.skipped} 条 skip/pending——skip 在基线里没有表示法，不许静默入册`);
  } else {
    const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf-8' }).stdout.trim();
    const old = b && Array.isArray(b.failures) ? b : null;
    writeFileSync(writeBaseline, JSON.stringify({
      generated_from_commit: head,
      total: v.total,
      failures: [...v.failed].sort(),
      passes: [...v.passNames].sort(),
      file_causes: v.causes.map(causeKey).sort(),
      note: '审查方实测基线（g0-gate --write-baseline 写出）。failures/passes 双向名集逐等（G-2）；'
        + 'file_causes = 文件级失败成因登记（N5，gate-causes.mjs）：`<文件> | <成因类> | <归一签名>`，'
        + '任何未登记成因一律红。签名不含用例名（用例名由名集判据管）；文件路径与钩子抛语参与签名'
        + '⇒ 改这两者会红——**安全但吵**是有意的选择（攻击者可控的恰是文本），不是误报缺陷。',
    }, null, 2) + '\n');
    note(`  已写基线 ${writeBaseline}：红 ${v.failed.size} / 过 ${v.passNames.size} / 总 ${v.total} / `
      + `成因 ${v.causes.length} @ ${head.slice(0, 7)}`);
    if (old) {
      const dFailAdd = [...v.failed].filter((x) => !new Set(old.failures).has(x)).sort();
      const dFailGone = old.failures.filter((x) => !v.failed.has(x)).sort();
      const dPassAdd = [...v.passNames].filter((x) => !new Set(old.passes ?? []).has(x)).sort();
      const dPassGone = (old.passes ?? []).filter((x) => !v.passNames.has(x)).sort();
      note(`  相对旧基线（读路径 ${baselinePath}）：红 +${dFailAdd.length}/-${dFailGone.length}，`
        + `过 +${dPassAdd.length}/-${dPassGone.length}`);
      for (const l of dFailAdd.map((x) => '  红+ ' + x).concat(dFailGone.map((x) => '  红- ' + x))
        .concat(dPassAdd.map((x) => '  过+ ' + x)).concat(dPassGone.map((x) => '  过- ' + x))) note(l);
    } else note('  （无旧基线可比对——首建形态）');
  }
} else if (bErr) fail.push(bErr);
else {
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
  if (v.failed === null) fail.push('审查方门无法解析 vitest 输出:\n' + v.raw);
  else if (v.status === 0 && v.passed === 0 && known.size > 0) fail.push('审查方门 0 通过且退出码 0：疑似整目录未被收集');
else {
  // G-2（外部复审，2026-10-30）：只比失败集合会被**覆盖面缩水**骗过——
  // 原本通过的审查方测试被 describe.skip、被删文件、被改名时，失败集合可以一字不变，
  // 门禁照样报"与基线一致"。所以通过项的身份同样必须在基线里，且必须逐一对上。
  // N5（吸收形修法，见 runVitest 头注与 gate-causes.mjs）：文件级失败（钩子异常/
  // 收集期错误/无法解释/运行级未捕获）必须逐条登记在基线 `file_causes`
  // （"<文件> | <成因类> | <归一签名>"）；**任何未登记成因一律红**——登记红的
  // 名字**不解释**文件级成因，「同文件有一条已知红」不再是清理期崩溃的豁免书。
  // GT-1 语义不回退：钩子异常没有任何登记红时同样在这里红（未登记 ⇒ 红）。
  const unregisteredCauses = assessCauses(v.causes, registeredCauses(b));
  if (unregisteredCauses.length > 0) fail.push(`审查方文件级失败成因 ${unregisteredCauses.length} 条未登记 —— `
    + `「文件级失败必须有名」与「红条逐条定性」同构；断言红名不解释钩子/收集/未捕获成因：\n  `
    + unregisteredCauses.map((c) => c.line).join('\n  '));
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
}

if (fail.length) {
  console.error('\n[g0-gate] FAIL');
  for (const f of fail) console.error(' - ' + f);
  process.exit(1);
}
console.log('\n[g0-gate] PASS —— 三条流均符合预期（审查方红条是"已定性的已知项"，不代表产品通过）');
