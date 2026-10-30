/**
 * N5 —— 文件级失败成因签名（G0 门禁 [3/3] 流的判据内核；`g0-gate.mjs` 与
 * `tests/helpers/n5-causes-probe.mjs` 共用的**唯一**实现，禁止第二份拷贝）。
 *
 * 起源（RE-REVIEW-G2-A.md §③ N5，P2；G6-A §①#11 复现）：旧判据
 * 「文件 status=failed 且 reds===0 ⇒ 判收集/清理期失败」只修了 GT-1 的一半——
 * **同文件只要有一条已登记断言红**，`afterAll` 抛错就被「有登记红可解释」吸收成
 * 已知失败，门禁 PASS（吸收形）。这是 G-1/G-2/GT-1 同族第四次「每次只补当前见到的
 * 那一种形态」。
 *
 * 自洽形态（G2-A 席位的裁定，本模块照此实现）：断言红逐条有名字（BASELINE 的
 * `failures` 已双向核对）；**文件级失败必须另有成因登记**——基线可选字段
 * `file_causes: ["<文件> | <成因类> | <归一签名>", …]`，逐条登记成因；
 * **任何未登记的成因一律红**（「所有文件级失败都必须有名字」，与「所有红都必须
 * 逐条定性」同构）。当前基线没有 `file_causes` 字段 ⇒ 登记集为空 ⇒ 一切文件级
 * 失败都红——这正是「133 例基线零误报」成立的前提：已知红全部是纯断言红，
 * 而纯断言红**不产生**文件级成因（vitest JSON reporter 实测：只有断言失败时
 * 文件级 `message` 为空；钩子/收集期错误才写 `message`）。
 *
 * 成因分类依据（vitest 4.1.11 JSON reporter 实测，2026-10-31，勿凭文档想象）：
 *   · 纯断言红        ⇒ 文件 status=failed、`message` 为空；失败文本只在
 *                       assertionResults[i].failureMessages，**不进**文件级 message；
 *   · 钩子异常        ⇒ 文件 status=failed 且 `message` = 抛出物本体（首行即错误
 *                       message，无堆栈、无 ANSI）；`beforeAll` 抛时未跑的用例记
 *                       skipped；
 *   · 收集期错误      ⇒ assertionResults 为空 + `message` 非空（import 崩溃、
 *                       语法坏掉、无套件……）；
 *   · 未捕获异常      ⇒ JSON **不归属到任何文件**（文件 status=passed、无 message），
 *                       只有进程 exit≠0 可见 ⇒ 归为运行级成因；
 *   · 其余「文件失败但既无红也无 message」⇒ 无法解释，单列一类（fail-closed）。
 *
 * 签名归一化（G2-A 实现要点：直接存全文会把误报转嫁成基线 churn）：取 `message`
 * 首个非空行，绝对路径归一为 <PATH>、数字串归一为 <N>，截 180 字符。文案漂移=
 * 行为变化信号 ⇒ 漂移即红是想要的语义，不是误报。
 *
 * 稳定性论证（第五轮父席追问「基线会不会天天漂移」，答案与选边一并入档）：
 *   · 成因键 = `<文件相对路径> | <成因类> | <归一签名>`；签名=文件级 `message` 首行归一。
 *     **用例名/测试名不参与**——vitest 实测：钩子异常的文件级 message 只有抛出物本身，
 *     断言失败文本（含用例名）不进文件级 message。此前回报里的签名「N5 absorption probe
 *     seat7」是**探针自己抛的文本**，不是用例名——两回事。
 *   · 参与签名的两个可控面：文件路径（挪文件/改文件名 ⇒ 键变 ⇒ 红）、钩子抛语
 *     （改抛出文本 ⇒ 红）。这是**「安全但吵」**的有意选边（父席确认同向）：攻击者能
 *     控制的恰恰是文本，签名必须咬住文本；「稳定但可能漏」的替代被否。
 *   · 改**用例名**的代价不落在成因判据上（签名不变），但**不落空**——用例名由
 *     `failures`/`passes` 名集判据（审查方流）与 `passed_sha256`（作者锚）管，改名在
 *     那两层必红。两层判据互补不互替：名集管「用例是谁」，成因管「文件为什么倒下」。
 *   · 现基线（33 红 / 26 文件）无任何文件级 message ⇒ `file_causes` 登记集为空 ⇒ 改既有
 *     用例名不会触发成因判据漂移；日常漂移面为零，只有真出现钩子/收集失败时才要求登记。
 *   · 配套护栏（同轮父席指令，不是可选项）：基线**写入**改走门禁 `--write-baseline`，
 *     工作树不干净 / 流不可解析 / 有 skip ⇒ 拒写（临时路径同判据）——堵住「改完 attacks
 *     随手重算把编辑蒸进已知红」这条比作者锚更隐蔽的 GT-3 换口通道。
 */

/** 首条非空行 + 路径/数字归一（见头注：抗抖动，不抗语义漂移——后者本就该红）。 */
export function causeSignature(message) {
  const first = String(message ?? '').split('\n').map((s) => s.trim()).filter(Boolean)[0] ?? '';
  return first
    .replace(/(?:\/[A-Za-z0-9._@+-]+){2,}/g, '<PATH>')
    .replace(/\b\d+\b/g, '<N>')
    .slice(0, 180);
}

/** 单文件结果 → 文件级成因清单（纯断言红 ⇒ 空清单，名字核对归 failures 集合管）。 */
export function fileCauses(f, relName) {
  const out = [];
  const assertions = f.assertionResults ?? [];
  const reds = assertions.filter((a) => a.status === 'failed').length;
  const message = String(f.message ?? '');
  if (f.status === 'failed' && message) {
    const kind = assertions.length === 0 ? 'collection-error' : 'hook-or-file-error';
    out.push({ file: relName, kind, sig: causeSignature(message) });
  } else if (f.status === 'failed' && !message && reds === 0) {
    // 既无断言红可解释、又无文件级 message：无法解释的文件失败（fail-closed）。
    out.push({ file: relName, kind: 'file-failure-unexplained', sig: 'no message and no failed assertion' });
  }
  return out;
}

/**
 * 一次 vitest 流 → 全部成因（文件级 + 运行级）。运行级：exit≠0/success=false 但
 * 没有任何文件级红、文件级成因、skip 能解释 ⇒ 未捕获异常族（vitest JSON 不归属到
 * 文件，实测见头注），单列 `<vitest-run>` 条目，同样必须登记才放行。
 */
export function collectCauses(j, { status, totalReds, totalSkipped, stripPrefix = '' }) {
  const causes = [];
  for (const f of j.testResults ?? []) {
    causes.push(...fileCauses(f, String(f.name ?? '?').replace(stripPrefix, '')));
  }
  if ((status !== 0 || j.success !== true) && causes.length === 0 && totalReds === 0 && totalSkipped === 0) {
    causes.push({ file: '<vitest-run>', kind: 'uncaught-or-run-level',
      sig: `exit=${'<N>'} success=${String(j.success)} 无文件级解释` });
  }
  return causes;
}

export const causeKey = (c) => `${c.file} | ${c.kind} | ${c.sig}`;

/** 基线登记集（缺字段=空集，当前 BASELINE.json 即此形态——一切成因都未登记）。 */
export function registeredCauses(baseline) {
  return new Set((baseline?.file_causes ?? []).map(String));
}

/** 未登记成因 = 一律红的部分。返回条目带 key 与可读行。 */
export function assessCauses(causes, registered) {
  return causes
    .map((c) => ({ ...c, key: causeKey(c) }))
    .filter((c) => !registered.has(c.key))
    .map((c) => ({ ...c, line: `${c.file}：成因「${c.kind}」签名「${c.sig}」未在基线 file_causes 登记` }));
}
