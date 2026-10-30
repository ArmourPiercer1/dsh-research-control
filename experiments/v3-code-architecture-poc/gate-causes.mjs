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
 * 第六轮（外部复审 2026-10-31，G0-R 收尾）：运行级异常**独立判定**，断言红不得成为豁免。
 * 旧运行级分支要求 `totalReds===0` ⇒ 「已登记红 + 未归属运行级异常」的组合被红条吸收，
 * 门禁 [3/3] 流（不消费 exit/success）打印「与基线完全一致」PASS——假绿**实测成立**：
 *   · 「红 + 未处理 rejection」的 JSON 与纯红**同形**——顶层无 errors/failureMessage 键
 *     （键集实测：numTotalTestSuites…success/testResults 14 键），文件级 message 为空，
 *     numFailedTests 只计断言红；单 `--reporter=json` 时 stderr 也**没有** banner；
 *   · 红场景 exit 恒 1（红自身强制），exit 通道零信息；
 *   · 对照组（全绿 + 同款异常）exit=1 且 success=true ⇒ 异常真实且迫使运行失败，
 *     零红时旧分支抓得到，红场里旧分支被 `totalReds===0` 短路。
 * 因此本模块新增**第二信号通道**（vitest 4.1.11 实测）：`--reporter=default` 会把
 * `Unhandled Errors` 汇总连同一个 `Unhandled Rejection/Error/Exception` 独立块写到
 * **stderr**；`--reporter=json` 单独跑或加 `--reporter=basic` 都**不**打印它（被 reporter
 * 丢弃），`--outputFile.json=<file>` 可让 JSON 走文件、与 default reporter 的 stdout 进度
 * 互不干扰。`g0-gate.mjs` 的 runVitest 已改为该双通道形态，把 stderr 传入 collectCauses。
 * 运行级成因**不看 totalReds**：banner 在 ⇒ 每块产出一条 `<vitest-run>` 成因，未登记一律红；
 * 纯红运行无 banner（实测），基线零误报前提不变。
 *
 * **banner 是被钉的契约，不是可信依赖**（第六轮父席裁定，防止把假绿换成「banner 一改就
 * 静默放行」的新脆弱耦合）：
 *   · 默认方向是**反转的**——`exit≠0 或 success≠true` 且文件级成因=0、运行级成因=0、
 *     红=0、skip=0 的**一切无法归因形态**一律红（签名原文「运行结果无法归因（banner 未匹配
 *     / 信号缺失）⇒ 保守判红」）。「banner 匹配到才红、匹配不到算一致」是**错的默认**，禁止回退。
 *   · banner 正则（本文件 `BANNER_SECTION_RE`/`BANNER_BLOCK_RE`）与 **vitest 4.1.11** 绑定：
 *     常驻测试 `tests/n5-failure-cause-signature.test.ts` 的 E 形断言「已知未处理异常夹具必须
 *     让 banner 命中」——vitest 升级若改文案，**该测试先红并写明「守卫需随 reporter 形态更新」**，
 *     门禁不允许静默失能。升级 vitest 的验收清单必须含「复跑 n5 五形态」。
 *   · 诚实的残余（不编造检测手段）：**红存在 + banner 缺失**时 exit≠0 被登记红解释，JSON 与
 *     纯红同形——该组合在 banner 失配期间不可检出，唯一防线就是上一条的钉形测试先红。
 * 如实边界（实测登记，不许被读成「运行级全拦住」）：
 *   · 异常若发生在 worker 回收之后（如 250ms `setTimeout` 抛，vitest 等不到定时器就退出），
 *     vitest 自身零痕迹、exit=0——runner 都不看见的形态，任何基于其输出的判据都不可见；
 *   · exit-only 兜底分支保留：stderr 未传入（其它调用方）或崩溃发生在 banner 打印之前时，
 *     「exit≠0/success=false 且无文件级解释且无红无 skip」仍产出一条粗签名成因
 *     （签名原文「运行结果无法归因（banner 未匹配 / 信号缺失）⇒ 保守判红」）；
 *     红存在时 exit≠0 被红解释，该兜底**不**重复报（避免把 33 条已知红的日常形态刷成噪音）。
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
 *     第六轮同形实测：`tests/**` 与 `attacks/**` 全量在双 reporter 形态下 stderr 的
 *     `Unhandled Errors` banner 计数均为 0（两条流各自跑全量 grep 核验，收尾回报贴原文）
 *     ⇒ 新增 banner 通道对当前基线零误报，与「纯断言红不产出成因」前提是同一件事的两个面。
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

/**
 * stderr 的 `Unhandled Errors` banner → 运行级成因清单（第六轮新增的第二信号通道）。
 * 实测形状（vitest 4.1.11，default reporter，非 TTY 无 ANSI）：
 *   `⎯⎯…⎯ Unhandled Errors ⎯…⎯` 节头，随后每个异常一个块：
 *   `⎯⎯…⎯ Uncaught Exception ⎯…⎯` / `⎯⎯…⎯ Unhandled Rejection ⎯…⎯`，块首行即 `Error: …`。
 * 判据**不看 totalReds**——断言红不是豁免（G0-R 收尾裁定）。节头在但一块解析不出
 * ⇒ 单条粗签名 fail-closed（形态漂移=行为变化信号，与签名归一化同一选边）。
 */
const BANNER_SECTION_RE = /^\s*⎯*\s*Unhandled Errors\s*⎯*\s*$/;
const BANNER_BLOCK_RE = /^\s*⎯+\s*([A-Za-z][A-Za-z ]*?)\s*⎯+\s*$/;

export function unhandledBannerCauses(stderr) {
  const lines = String(stderr ?? '').split('\n');
  const start = lines.findIndex((l) => BANNER_SECTION_RE.test(l));
  if (start < 0) return [];
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    const m = BANNER_BLOCK_RE.exec(lines[i]);
    if (!m || m[1].trim() === 'Unhandled Errors') continue;
    const type = m[1].trim();
    let errLine = '';
    for (let k = i + 1; k < lines.length; k++) {
      const t = lines[k].trim();
      if (t === '' || /^⎯+$/.test(t)) continue;
      errLine = t;
      break;
    }
    out.push({ file: '<vitest-run>', kind: 'uncaught-or-run-level',
      sig: `${type}: ${causeSignature(errLine)}` });
  }
  if (out.length === 0) {
    out.push({ file: '<vitest-run>', kind: 'uncaught-or-run-level',
      sig: 'Unhandled Errors banner 在位但块不可解析（fail-closed）' });
  }
  return out;
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
 * 一次 vitest 流 → 全部成因（文件级 + 运行级）。运行级**独立判定**（第六轮）：
 *   通道①（banner，主）：stderr 出现 `Unhandled Errors` 汇总（default reporter 实测输出，
 *     见 `unhandledBannerCauses`）⇒ 每块一条 `<vitest-run>` 成因，**与 totalReds 无关**——
 *     「已登记红」不再是未归属运行级异常的豁免条件（G0-R 收尾裁定的修复点）。
 *   通道②（exit-only，兜底）：exit≠0/success=false 但没有任何文件级红、文件级成因、skip
 *     能解释、也没有 banner ⇒ 未捕获异常族（vitest JSON 不归属到文件，实测见头注），
 *     单列粗签名条目。红存在时 exit≠0 被红解释，此通道**不**重复触发——那是 33 条
 *     已知红的日常形态（噪音豁免的如实边界见头注「如实边界」）。
 * 两通道同样必须登记进基线 `file_causes` 才放行；未登记一律红。
 */
export function collectCauses(j, { status, totalReds, totalSkipped, stripPrefix = '', stderr = '' }) {
  const causes = [];
  for (const f of j.testResults ?? []) {
    causes.push(...fileCauses(f, String(f.name ?? '?').replace(stripPrefix, '')));
  }
  causes.push(...unhandledBannerCauses(stderr));
  // 反转默认（第六轮父席裁定）：**一切无法归因的非零状态一律红**——banner 只是归因通道之一，
  // 不是放行的前提。banner 匹配不到（如 vitest 升级改文案）时绝不落回「与基线完全一致」。
  if ((status !== 0 || j.success !== true) && causes.length === 0 && totalReds === 0 && totalSkipped === 0) {
    causes.push({ file: '<vitest-run>', kind: 'uncaught-or-run-level',
      sig: '运行结果无法归因（banner 未匹配 / 信号缺失）⇒ 保守判红' });
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
