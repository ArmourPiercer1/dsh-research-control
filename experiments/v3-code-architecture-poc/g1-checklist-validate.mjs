#!/usr/bin/env node
/**
 * G1 对账清单的最小结构校验器（外部复审第五轮裁定第 2、3 条；PLAN §15 G1-d 的兑现）。
 *
 * 为什么存在：G1 的放行判据此前是两条 `grep -c`。grep 只数「长得像的行」——
 * **删条目、填无效权威来源、漏写证据、未知字段混入都不会被抓**（§15 G1-d 原话），
 * 等于把「经审查通过」换个写法。本脚本把清单变成真正的机验对象：**解析它，而不是扫描它**。
 *
 * 实现取舍（零依赖）：
 *   - 不引第三方 YAML 库（本仓无运行时 YAML 依赖，侧车门禁必须零安装即可跑）。
 *   - 采用「受控子集 + 自写解析器」：清单的形状（顶层标量 + `items:` 条目表 +
 *     `sources:` 字符串列表）完全落在子集内；**任何子集外的构造（块标量 |/>、流式
 *     {}[]、多文档、未闭合引号、缩进错位）一律 PARSE 红**——fail-loud，不静默降级为
 *     行扫描。「真实解析而非 grep」是裁定的原话，解析失败也算红，就是这条的兑现。
 *
 * 校验面（violation 一律 `规则码` 命名，逐条给行号与条目 id）：
 *   - `ID-PATTERN`      id 形如 G1-<域>-<NN>（大写域 + 两位序号）
 *   - `ID-DUP`          id 重复 = 红（唯一性；不复用/不重排语义属评审纪律，见下）
 *   - `STATUS-VOCAB`    status ∈ {open, assigned, done, superseded}；旧词 `resolved`
 *                       已于 2026-10-31 迁移为 `done`，再出现即红（词汇漂移防护）
 *   - `OWNER-RULE`      open 允许 UNASSIGNED；assigned/done/superseded 必须非空且非 UNASSIGNED
 *   - `SPEC-NONEMPTY`   正文字段非空（`topic` ≡ 裁定文本里的 `spec`；两者互斥、必须恰有其一）
 *   - `DONE-EVIDENCE`   **done 必须有非空 evidence 且含可定位锚点**（提交号 / 带扩展名的
 *                       文件路径〔可带 :行号〕）。这是 GT 系列教训的直接迁移：
 *                       「已修」不许是自我声明——没有锚 = 红。
 *                       **锚点真值（P1-2 修复，2026-11-01，RE-REVIEW-G1-ENG §E4）**：形态合规
 *                       不再是终点——锚里的提交号必须 `git cat-file -e <sha>^{commit}` 通过、
 *                       路径必须存在（提交判据照 g0-gate 基线 `generated_from_commit` 的祖先判据
 *                       先例，路径判据照本文件 PLAN-PATH「对账对象不许是幽灵路径」先例）；
 *                       假提交号 / 幽灵路径 ⇒ 本规则红。边界如实：机器证的是「锚点存在」，
 *                       **不证**「锚点内容支持该条结论」——后者仍是人工审查（见「已知边界」）。
 *   - `DONE-RESOLUTION` **done 必须有非空 resolution**（第六轮裁定：关闭态三件套
 *                       = 权威 owner + 可定位 evidence + 明确 resolution，缺一即红。
 *                       owner 的「权威」语义仍是人工判据，见「已知边界」）
 *   - `SUPERSEDED-BY-EXISTS` superseded_by 指向的 id 必须存在、不得指向自己
 *                       （规则旧名 `SUPERSEDES-EXISTS`，随字段改名同步，2026-10-31 第七轮）
 *   - `SUPERSEDED-TARGET` status=superseded 必须给出 superseded_by
 *   - `SUPERSEDED-CHAIN` **superseded 链必须最终到达 done**（第六轮裁定：防「superseded 环」
 *                       与「指向 open 的甩锅链」——链上每步 superseded_by 都必须可解析，
 *                       成环或终点非 done ⇒ 红）
 *   - `SUPERSESSION-REASON`   **status=superseded 必须有非空 supersession_reason 且含可定位
 *                       锚点**（锚点判据与 DONE-EVIDENCE 同**形态段**：提交号 / 带扩展名文件路径。
 *                       空占位红；「被裁定取代」式结论词无锚 = 红——替代理由不许是自我声明。
 *                       **真值段只判 supersession_evidence**：reason 是叙事文本，证据锚的真值
 *                       由 SUPERSESSION-EVIDENCE 把门，分工写死在代码注释）
 *   - `SUPERSESSION-EVIDENCE` **status=superseded 必须有非空 supersession_evidence 且含
 *                       可定位锚点**（同上判据，**含锚点真值**——假提交号/幽灵路径 = 红；
 *                       缺证据的「已被取代」= 换皮的未完成）
 *   - `FREEZE-TIER`     **每条条目必须有 freeze_tier，取值闭集 {A, B}**（专题⑤，2026-11-01；
 *                       判据全文 `g1/G1-FREEZE-CRITERIA.md` §4）。缺失、空占位、词表外取值一律红。
 *                       **故意不设缺省层级**：缺省成 A ⇒ 既有清单形态突然全红（误伤闸，第二天就被绕过）；
 *                       缺省成 B ⇒ 「不写分层」自动等于「不计入冻结阻塞」，冻结面当场腾空（洗白闸）。
 *                       两头都是失效，所以只给点名（自验 M27 缺字段红 / M28 取值漂移红）。
 *   - `FREEZE-TIER-BASIS` **freeze_tier=B 必须有 tier_basis 且含可定位锚点，并过锚点真值**
 *                       （与 DONE-EVIDENCE 同一真值判据、同一个 anchor 工厂）。理由：B 层免检的是
 *                       「完成」，所以「把条目移出冻结阻塞面」这个动作必须留痕——它与替代关系同级，
 *                       都是判据面变更，不许是自我声明（自验 M29 无留痕红 / M30 带真锚的整体降级
 *                       由**谓词**的「A 层非空」项拦住，见 clearBlockers）。
 *   - `UNKNOWN-FIELD`   条目字段封闭集之外 = 红（防漂移：新字段先改校验器再进清单）。
 *                       **旧字段名 `supersedes` 是点名禁止字段**：出现即红并给出方向说明
 *                       （防新旧混用，见下方「字段方向」段；自验 M16 钉死复活、M17 钉死
 *                       「用旧名切断继任链」的绕过——必须与 SUPERSEDED-TARGET 双红，
 *                       「无继任」不是中性态）
 *   - `UNKNOWN-TOP`     顶层键封闭集之外 = 红
 *   - `SCHEMA-VERSION`  schema_version 必须是 1
 *   - `PLAN-PATH`       plan 指向的文件必须真实存在（对账对象不许是幽灵路径）
 *   - `PARSE`           YAML 子集解析失败 = 红；**同一条目/同一顶层的重复字段也在解析期直接
 *                       红**（第六轮裁定点名的「两个判据看到不同事实」缺陷：旧实现里
 *                       语义校验用最后一次赋值、计数统计用 find() 取第一次 ⇒ 一条条目
 *                       可以同时「被验证为 done」而「被统计为 open」。修在解析期是唯一
 *                       不引入「哪个赋值算数」新裁量的位置；自验 M11 钉死该形态）
 *
 * 字段方向（第七轮改名 `supersedes` → `superseded_by` 的理由，写死）：
 *   - 现行 `docs/decisions/ADR-0003`（冻结面，只读）规定的 `supersedes` 边由**取代者指向
 *     被取代者**（取代方的 ADR front-matter 列出它取代了谁）。
 *   - 本清单的替代关系字段方向**相反**：由 `status: superseded` 的被取代条目指向继任条目，
 *     故必须叫 `superseded_by`（「被谁取代」）。同名反向 = 语义混淆本身是缺陷——两个方向
 *     混用一次，继任链判据就会判到反方向上。
 *   - `supersedes` 因此保留为**禁止字段**：在清单条目里出现即 UNKNOWN-FIELD 红（自验 M16）；
 *     它同时**不是链的关闭开关**——superseded 条目只写旧名 ⇒ UNKNOWN-FIELD 与
 *     SUPERSEDED-TARGET 双红（自验 M17），不存在「旧名让链静默断掉」的第三条路。
 *
 * 替代关系为什么是「结构校验 + 人工确认」而不是继续加自动推理（第七轮裁定原话，本段改动的
 * 设计依据）：**「机器无法自动证明两个复杂契约语义等价 ⇒ 用『结构校验 + 人工确认替代关系』
 * 的门禁，不要继续堆自动推理规则」**。兑现为两层：
 *   - 结构层（日常判据即红）：superseded 条目自身必须带替代理由 + 可定位证据
 *     （SUPERSESSION-REASON / SUPERSESSION-EVIDENCE）+ 合法继任链（SUPERSEDED-CHAIN）——
 *     「指向任意一条 done」不再能洗白整片 open（第七轮点名的终局洗白反例，自验 M14/M15）。
 *   - 人工确认层（仅 --require-clear 拦，日常不阻塞推进）：每条 superseded 必须有
 *     `supersession_review: "REVIEW: <YYYY-MM-DD> <非作者审查者>"`，**缺失、形态不合法、日期
 *     不是真实历法日期（第八轮收紧：`9999-99-99`、`2026-02-30` 形合而历法不存在，不算签字），
 *     或审查者==owner ⇒ 终局谓词判红**——替代关系等同性由人签字，机器只核对签字存在、形态
 *     合法、日子真存在且非本人。闰日（如 `2024-02-29`）是真日子，必须放行（自验 M24 防误伤）。
 *
 * 已知边界（如实，不做超出裁定的事）：
 *   - 「id 不复用」只能靠 git diff 评审（删除条目会显示在 diff 里）；「不重排语义」同理。
 *   - `owner` 必须是「Q 编号 / 裁定提交 / 用户指令」这条仍是**人工判据**（自由文本无法
 *     机验语义），本文书 §2-G1 保留该人工条款；校验器只判非空 / 非 UNASSIGNED。
 *   - `supersession_review` 的「非作者」同理是人工判据：机器能钉的是**形态合法且审查者
 *     与 owner 不同名**；「签名的两个人是否真有权威」不在机验面（与 owner 权威性同一边界）。
 *   - **锚点真值的边界（P1-2，2026-11-01 补）**：机器能证「锚点存在」——提交号在 git 仓里
 *     解析为 commit、路径能落到真实文件；机器**不能**证「锚点内容支持该条结论」——真提交可以
 *     不相关、真文件可以没讲这件事、「锚点空转」仍是人工审查面（与「批准者是否真读了 diff」
 *     同一人认边界）。自验 M18/M19/M21 把「假锚」钉死为红，钉不住「真锚空转」，不许把
 *     M20 判绿误读成「内容过审」。
 *
 * 用法与谓词语义（写死，别让下一个读者猜——父代理 2026-10-31 点名的三态澄清；
 * **第六轮修订**，外部复审点名 G1 门禁 P1：旧 `--require-clear` 数的是 open/unassigned，
 * 把全部条目改成 `assigned` + 非空 owner 就能「清零」放行——推进态冒充终局态）：
 *   node g1-checklist-validate.mjs
 *       日常机验：违规==0 即绿。**这是常驻门禁跑的形态**（READINESS.md §5）。
 *       `assigned` 在日常形态**允许存在**——它是有主的推进态，不是违规。
 *   node g1-checklist-validate.mjs --require-clear
 *       G1 **终局放行谓词**（第六轮改写；第七轮补 superseded 人工确认门）：违规==0 且
 *       **所有有效工作项均为 done，或为 superseded_by 链最终到达 done、且带合法
 *       supersession_review（REVIEW: <日期> <审查者>，审查者≠owner）的 superseded**。
 *       `open` 与 `assigned` 一律不放行——「有人认领了」不等于「裁定落地了」；
 *       「被替代了但没人签字确认替代关系」同样不放行——终局面上 superseded 不是免检通道
 *       （第七轮点名的「23 条 open 全改 superseded 指向任意 done ⇒ 终局 PASS」反例，
 *       自验 M14/M15 钉死）。done 的三件套（权威 owner / 可定位 evidence / 明确
 *       resolution）由 DONE-EVIDENCE、DONE-RESOLUTION、OWNER-RULE 三条规则兜住，
 *       谓词只判剩余面。
 *       G1 未完成阶段它红是**预期状态**（G1 NO-GO），不是判据坏死——所以它进 §2-G1
 *       放行判据，不进日常门。
 *       **两层口径（专题⑤，2026-11-01；上面那段旧描述逐字有效，此处只登记唯一一处收窄）**：
 *       `open`/`assigned` 的**终局阻塞面从「全局」收窄到「A 层」**——B 层是纯 G2/G3 实施与验证义务，
 *       它的 open 是排期事实不是合同缺口（判据件 §1：单层口径的两个失效形态之一正是「为清零提前做实现」）。
 *       其余四项**一字未动**：违规==0、全局 `unassigned==0`（这一项顺带就是「B 层必须有归属」）、
 *       `supersededUnreviewed==0`（替代关系的人工确认门与层级无关）。新增一项 **A 层非空**：
 *       A 层被整体抽空时「A 层全闭」是真空真，谓词会自己变成洗白通道，故必须独立拦住
 *       （自验 M30 钉死：全量降级 + 每条真锚留痕 + owner 全填，仍须因「A 层被抽空」判红）。
 *       谓词实现收敛进 `clearBlockers()` 单一函数——主流程与自验读同一份，不许各写一遍。
 *   node g1-checklist-validate.mjs --max-open <N>
 *       进度护栏：违规==0 且 open<=N。评审期可断言「open 面不扩大」，不要求清零。
 *   node g1-checklist-validate.mjs --self-test      # 变异自验（架空而非删除，见 MUTANTS；
 *       锚点真值族 M18（假提交号红）/M19（幽灵路径红）/M20（真锚绿，防空转）/M21（§E4 终局洗白
 *       全形常驻回归）为 P1-2 修复的复现-修复证据；第八轮补 M22（签字日期 9999-99-99 红）/
 *       M23（2026-02-30 红）/M24（闰日 2024-02-29 绿，防误伤）/M25（裸位置参数必非 0）/
 *       M26（--file 正常形态必 exit 0，防把 fail-loud 修成死闸），条数以本行运行输出为准）
 *       专题⑤（2026-11-01）分层族五补：**M27**（缺 freeze_tier 红）/ **M28**（取值漂移红）/
 *       **M29**（A 层全量降级为 B 且不补 tier_basis ⇒ FREEZE-TIER-BASIS 红）/
 *       **M30**（**谓词型**：全量降级 + 每条真锚留痕 + owner 全填 ⇒ 违规面全过，仍必须因
 *       「A 层被抽空」判红，红因点名才算捕获）/ **M31**（**正向防死闸**：A 层全闭 + B 层仍 open
 *       且已指名归属 ⇒ 终局门必须判绿——没有正向条的分层判据就是死闸，与「谓词永远红」同一种失效）。
 *   node g1-checklist-validate.mjs --file <path>    # 指定清单路径（自验与排查用）
 *
 * 参数面 fail-loud（第八轮，验席挖出的第 2 处小口，写死）：**只认** `--file` / `--require-clear`
 * / `--max-open` / `--self-test` 四个 flag；未知参数、裸位置参数（如把清单路径直接甩在命令行上）、
 * flag 缺值、flag 重复 ⇒ 打印一行说明 + **exit 2**。理由不是洁癖：旧实现用 `includes`/`indexOf`
 * 读参数，**其余静默忽略**——`node g1-checklist-validate.mjs 某清单.yaml` 会被丢掉路径后去校验
 * **默认主清单**并 exit 0，调用者以为验绿的是自己指定的那份。校验器报「绿」的对象必须与调用者
 * 指的对象一致，否则门禁的绿就是假的（自验 M25/M26 两侧常驻）。新 flag 先进 parseArgs 再谈使用。
 *
 * 为什么不存在「清单永远不可能 clear」的死判据：**open 不要求 UNASSIGNED**——
 * UNASSIGNED 只是 open 条目**被允许**的取值，任何状态都可以（也应该）指名 owner；而
 * OWNER-RULE 禁止非 open 条目挂 UNASSIGNED。⇒ 放行路径 = assign 之后逐条关闭（done
 * 三件套，或「合法 superseded」= 继任链到达 done + reason/evidence 带锚点 + review 形态
 * 合法且审查者≠owner），推进与放行两个谓词可同时满足。--require-clear 里的
 * unassigned==0 在所有项关闭时本是 OWNER-RULE 的推论，仍显式保留 = 纵深（规则将来被
 * 放宽时，放行谓词不会静默跟着松）。superseded 路径「齐形可绿」不是纸面声明：全形夹具
 * （载荷齐 + review 齐）实测 --require-clear 判绿、去 review / 审查者==owner 两种减法
 * 实测判红，第七轮实测记录见 READINESS.md 第七轮节与 G0-R-CLOSURE.md。
 * 退出码：0 无违规（且给定谓词满足）；1 任何违规 / 谓词未满足 / 变异未被捕获；
 * 2 用法错误（未知参数 / 裸位置参数 / flag 缺值或非法值 / flag 重复）——用法错误不去猜校验对象。
 */
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CHECKLIST = join(HERE, 'G1-RECONCILIATION-CHECKLIST.yaml');

// ---------- 受控 YAML 子集解析（fail-loud） ----------
// 支持的形状恰好是本清单的形状：
//   key: scalar
//   items:
//     - id: X
//       field: scalar
//       list-field:
//         - "item"
// 引号形式仅双引号（转义 \" 与 \\）；标量允许无引号；`#` 仅在行首（去缩进后）为注释。
class ParseError extends Error {
  constructor(lineNo, why) {
    super(`PARSE 行${lineNo}: ${why}`);
    this.lineNo = lineNo;
  }
}

function parseScalar(raw, lineNo, where) {
  const s = raw.trim();
  if (s === '') throw new ParseError(lineNo, `${where} 的值不能为空行内联（子集不支持块值）`);
  if (s.startsWith('"')) {
    let out = '';
    for (let i = 1; i < s.length; i++) {
      const ch = s[i];
      if (ch === '\\') {
        const nx = s[i + 1];
        if (nx !== '"' && nx !== '\\') throw new ParseError(lineNo, `${where} 引号串含非法转义 \\${nx ?? '<EOF>'}`);
        out += nx;
        i++;
      } else if (ch === '"') {
        if (i !== s.length - 1) throw new ParseError(lineNo, `${where} 引号串闭合后仍有多余内容`);
        return out;
      } else {
        out += ch;
      }
    }
    throw new ParseError(lineNo, `${where} 引号串未闭合`);
  }
  if (s.startsWith("'")) throw new ParseError(lineNo, `${where} 单引号串不在受控子集内（用双引号）`);
  if (s.startsWith('|') || s.startsWith('>') || s.startsWith('&') || s.startsWith('*'))
    throw new ParseError(lineNo, `${where} 的标量形态（块标量/锚点/别名）不在受控子集内`);
  if (s.startsWith('{')) throw new ParseError(lineNo, `${where} 的流式映射不在受控子集内`);
  if (s.startsWith('[')) {
    // 行内字符串列表——清单既有条目（G1-DONE-* 的 sources）就是这个形状，子集必须收。
    const list = flowList(s, lineNo, where);
    list.__flow = true;
    return list;
  }
  return s;
}

function flowList(s, lineNo, where) {
  if (!s.endsWith(']')) throw new ParseError(lineNo, `${where} 行内列表未闭合 ]`);
  const inner = s.slice(1, -1);
  const out = [];
  let cur = '';
  let inQ = false;
  let esc = false;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (inQ) {
      if (esc) {
        if (ch !== '"' && ch !== '\\') throw new ParseError(lineNo, `${where} 行内列表引号串含非法转义`);
        cur += ch;
        esc = false;
      } else if (ch === '\\') esc = true;
      else if (ch === '"') {
        out.push(cur);
        cur = '';
        inQ = false;
      } else cur += ch;
      continue;
    }
    if (ch === '"') {
      if (cur.trim() !== '') throw new ParseError(lineNo, `${where} 行内列表引号串前有多余内容「${cur}」`);
      cur = '';
      inQ = true;
      continue;
    }
    if (ch === ',') {
      if (cur.trim() !== '') throw new ParseError(lineNo, `${where} 行内列表只允许引号串项（裸标量项请改写为带引号）`);
      cur = '';
      continue;
    }
    if (ch !== ' ') throw new ParseError(lineNo, `${where} 行内列表含非引号串内容「${ch}」`);
  }
  if (inQ) throw new ParseError(lineNo, `${where} 行内列表引号串未闭合`);
  if (inner.trim() !== '' && out.length === 0) throw new ParseError(lineNo, `${where} 行内列表非空但解析出 0 项`);
  return out;
}

const KEY_RE = /^([A-Za-z_][A-Za-z0-9_-]*):(.*)$/;

function parseChecklist(text) {
  const rawLines = text.split('\n');
  const lines = []; // {no, indent, body} 去空行/整行注释
  rawLines.forEach((line, idx) => {
    const stripped = line.replace(/\r$/, '');
    const t = stripped.trim();
    if (t === '' || t.startsWith('#')) return;
    if (stripped.includes('\t')) throw new ParseError(idx + 1, '缩进含 Tab（子集只许空格）');
    const indent = stripped.length - stripped.trimStart().length;
    lines.push({ no: idx + 1, indent, body: stripped.trim() });
  });

  const top = {};
  let i = 0;
  const items = [];
  while (i < lines.length) {
    const L = lines[i];
    if (L.indent !== 0) throw new ParseError(L.no, `顶层位置出现缩进内容「${L.body.slice(0, 40)}」`);
    if (L.body === '---') throw new ParseError(L.no, '多文档分隔符不在受控子集内');
    const m = KEY_RE.exec(L.body);
    if (!m) throw new ParseError(L.no, `顶层行不是 key: value「${L.body.slice(0, 40)}」`);
    const key = m[1];
    const rest = m[2];
    // 顶层重复键 = 解析期红（与条目字段同族：Object 赋值取最后、语义判据取首次的分裂面，
    // 第六轮裁定「两个判据不得看到不同事实」）。
    if (key in top) throw new ParseError(L.no, `顶层键「${key}」重复（行${top[key].line} 已出现）——同一键不许有两个赋值`);
    i++;
    if (rest.trim() !== '') {
      top[key] = { value: parseScalar(rest, L.no, `顶层 ${key}`), line: L.no };
      continue;
    }
    if (key !== 'items') throw new ParseError(L.no, `顶层键 ${key}: 打开块但子集只允许 items: 打开块`);
    // items 列表：条目从缩进 >0 的「- …」行开始
    // 同一条目内重复字段 ⇒ **解析期**直接拒绝（第六轮裁定的「两个判据看到不同事实」：
    // 语义校验按最后一次赋值取 f[key]，计数统计 find() 取首次 ⇒ 同一条目可以既
    // 「被验证为 done」又「被统计为 open」。修在解析期，两边从此看同一份事实。）
    const pushField = (item, entry) => {
      const dup = item.__fields.find((x) => x.key === entry.key);
      if (dup)
        throw new ParseError(entry.line,
          `条目「${item.__fields[0] ? String(item.__fields[0].value) || '?' : '?'}」字段「${entry.key}」重复（行${dup.line} 已出现）——同一条目同一字段不许有两个赋值`);
      item.__fields.push(entry);
    };
    while (i < lines.length && lines[i].indent > 0 && lines[i].body.startsWith('- ')) {
      const itemIndent = lines[i].indent;
      const item = { __line: lines[i].no, __fields: [] };
      const first = lines[i].body.slice(2);
      const fm = KEY_RE.exec(first);
      if (!fm) throw new ParseError(lines[i].no, 'items 条目必须以「- key: value」开始');
      pushField(item, { key: fm[1], value: parseScalar(fm[2], lines[i].no, `条目 ${fm[1]}`), line: lines[i].no, list: null });
      i++;
      while (i < lines.length && lines[i].indent > itemIndent && !lines[i].body.startsWith('- ')) {
        const f = lines[i];
        if (f.indent !== itemIndent + 2)
          throw new ParseError(f.no, `条目字段缩进 ${f.indent} ≠ 期望 ${itemIndent + 2}（形状漂移）`);
        const km = KEY_RE.exec(f.body);
        if (!km) throw new ParseError(f.no, `条目字段行不是 key: value「${f.body.slice(0, 40)}」`);
        const fkey = km[1];
        const fRest = km[2];
        if (fRest.trim() !== '') {
          pushField(item, { key: fkey, value: parseScalar(fRest, f.no, `${item.__fields[0].value || '?'} 的 ${fkey}`), line: f.no, list: null });
          i++;
          continue;
        }
        // 空值 ⇒ 只能打开字符串列表
        const list = [];
        const listIndent = f.indent + 2;
        i++;
        while (i < lines.length && lines[i].indent === listIndent && lines[i].body.startsWith('- ')) {
          list.push({ value: parseScalar(lines[i].body.slice(2), lines[i].no, `${fkey} 列表项`), line: lines[i].no });
          i++;
        }
        if (list.length === 0) throw new ParseError(f.no, `${fkey}: 打开列表但没有任何条目`);
        pushField(item, { key: fkey, value: list, line: f.no, list });
      }
      items.push(item);
    }
  }
  return { top, items };
}

// ---------- 结构与语义校验 ----------
const TOP_KEYS = new Set(['schema_version', 'plan', 'revision', 'items']);
const ITEM_KEYS = new Set([
  'id', 'topic', 'spec', 'sources', 'owner', 'status', 'evidence', 'resolution',
  'superseded_by', 'supersession_reason', 'supersession_evidence', 'supersession_review',
  // 专题⑤（2026-11-01）冻结分层：freeze_tier = 每条必填的 A/B 层标记；tier_basis = B 层的降级留痕。
  // 字段先在这里进封闭集，再进清单（既有纪律「新字段先改校验器再进清单」）。
  'freeze_tier', 'tier_basis',
]);
// 冻结分层的取值闭集（专题⑤；判据见 g1/G1-FREEZE-CRITERIA.md §4）。**没有缺省值**：
// 「缺字段算 A 还是算 B」这个问题本身就是洗白通道——缺省成 A 会让旧清单形态突然全红，
// 缺省成 B 直接把冻结面腾空。故缺失即红，取值漂移即红，两条都有常驻变异（M27 / M28）。
const FREEZE_TIERS = new Set(['A', 'B']);
// 禁止字段（第七轮）：旧字段名不许复活——ADR-0003 的 `supersedes` 方向是取代者→被取代者，
// 与本清单 `superseded_by`（被取代者→取代者）相反，混用一次判据就判反方向（见头注「字段方向」）。
const BANNED_KEYS = new Map([
  ['supersedes', '禁止字段「supersedes」：该名字按 ADR-0003 是「取代者→被取代者」，与本清单继任链方向相反；本清单字段为「superseded_by」（被取代者→取代者），不许新旧混用（见文件头「字段方向」段）'],
]);
const STATUSES = new Set(['open', 'assigned', 'done', 'superseded']);
const ID_RE = /^G1-[A-Z][A-Z0-9]*-\d{2}$/;
// 人工确认替代关系的形态（第七轮，仅 --require-clear 拦）：REVIEW: <YYYY-MM-DD> <审查者>
// **第八轮收紧（验席挖出的第 1 处小口）**：正则只证「长得像日期」，`9999-99-99`、`2026-02-30`
// 这类**形合但不可能存在**的串同样命中——而签字日期是替代关系的时间锚，不可能日期等于没锚
// （要骗过机器的人不会写一个语法错的日期，只会写一个语法对的假日期）。故形态段之后再加
// **真实历法日期**判据：月须 01–12、日须落在该月实际天数内（闰年 2-29 合法，防误伤）。
// 零外部依赖：只用 `Date` 往返判等（见 isRealIsoDate）。判红位置照旧在**谓词面**（与「缺
// review / 形态不符 / 审查者==owner」同一门），日常推进形态照旧不拦——收紧的是终局放行。
const REVIEW_RE = /^REVIEW:\s*(\d{4}-\d{2}-\d{2})\s+(\S.*?)\s*$/;
// 真实历法日期判据（形态已由 REVIEW_RE 保证是 4-2-2 位数字，这里只判「这个日子存在吗」）：
// Date.UTC 会把越界的月/日**进位**（2026-02-30 → 2026-03-02），所以「往返后各字段是否仍等于
// 字面值」就是「该月有没有这一天」的判据；不引任何外部日期库。
function isRealIsoDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;      // 月 01–12、日至少存在到 1（00 日不存在）
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (y <= 99) dt.setUTCFullYear(y);                  // Date.UTC 把 0–99 映射到 1900–1999，回拨以核对 4 位字面年份
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}
// 可定位锚点：git 提交号（7–40 位十六进制）或带扩展名的文件路径（可带 :行号）。
const COMMIT_RE = /\b[0-9a-f]{7,40}\b/;
const FILE_RE = /[\w./-]+\.(?:md|ts|tsx|mjs|cjs|json|ya?ml|sql|db|jsonl)\b/i;

// ---------- 锚点真值（P1-2 修复，2026-11-01；RE-REVIEW-G1-ENG §E4） ----------
// 旧 DONE-EVIDENCE / SUPERSESSION-* 只判**形态**：形态合规的假锚（不存在的提交号 + 不存在的
// 路径）把 27 条全 done 的伪造清单洗成 `--require-clear` exit 0（审查席实测；本仓复现同形，
// 复现即自验 M21 常驻）。补**存在性**半边，两条判据都走同仓既有先例、零新依赖：
//   - 提交号：`git cat-file -e <sha>^{commit}` 必须通过（g0-gate 基线 generated_from_commit
//     用 `git merge-base --is-ancestor` 判真祖先，同一「git 即锚点仓库」先例）；
//   - 路径：existsSync——先按「清单目录 / 仓根」两候选根，都落空再退到 `git ls-files *basename`
//     后缀匹配（现存合法形态：G1-DONE-04 的 evidence 以裸 basename 引用 tests/ 下的夹具；
//     幽灵 basename 在 git 索引里也是空集 ⇒ 照红）。PLAN-PATH「对账对象不许是幽灵路径」同族。
// 边界（写进头注「已知边界」）：机器证的是**锚点存在**，不证**锚点内容支持该条结论**——
// 「真锚点 + 空转结论」仍是人工审查面。git 不可用 / 清单在 git 树外 ⇒ fail-closed：
// 提交锚一律点名（本门禁是仓门禁，不是通用 YAML 工具，宁可红不可盲）。
const COMMIT_RE_G = /\b[0-9a-f]{7,40}\b/g;
const FILE_RE_G = /[\w./-]+\.(?:md|ts|tsx|mjs|cjs|json|ya?ml|sql|db|jsonl)\b/gi;
function makeAnchorChecker(checklistPath) {
  const baseDir = checklistPath ? dirname(checklistPath) : HERE;
  const top = spawnSync('git', ['-C', baseDir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  const repoRoot = top.status === 0 && top.stdout.trim() ? top.stdout.trim() : null;
  const bases = repoRoot ? [baseDir, repoRoot] : [baseDir];
  const commitCache = new Map();
  const pathCache = new Map();
  const commitOk = (sha) => {
    if (!commitCache.has(sha)) {
      let ok = false;
      if (repoRoot) ok = spawnSync('git', ['-C', repoRoot, 'cat-file', '-e', `${sha}^{commit}`], { stdio: 'ignore' }).status === 0;
      commitCache.set(sha, ok);
    }
    return commitCache.get(sha);
  };
  const pathOk = (raw) => {
    if (!pathCache.has(raw)) {
      const p = raw.replace(/:\d+(?:-\d+)?$/, '');
      let ok = p.startsWith('/') ? existsSync(p) : bases.some((b) => existsSync(join(b, p)));
      if (!ok && repoRoot) {
        const base = p.split('/').pop();
        const r = spawnSync('git', ['-C', repoRoot, 'ls-files', '--', `*${base}`], { encoding: 'utf8' });
        ok = r.status === 0 && r.stdout.split('\n').some((rel) => rel.trim() !== '' && existsSync(join(repoRoot, rel.trim())));
      }
      pathCache.set(raw, ok);
    }
    return pathCache.get(raw);
  };
  const problemsOf = (text) => {
    const out = [];
    for (const m of String(text).matchAll(COMMIT_RE_G))
      if (!commitOk(m[0])) out.push(`锚点提交号「${m[0]}」在 git 仓库不存在（git cat-file -e ${m[0]}^{commit} 未通过）——形态合规的假提交号`);
    for (const m of String(text).matchAll(FILE_RE_G))
      if (!pathOk(m[0])) out.push(`锚点路径「${m[0]}」不存在（清单目录/仓根两候选根未命中，git ls-files 后缀匹配亦空）——幽灵路径`);
    return out;
  };
  return { problemsOf, repoRoot };
}

function validate(text, checklistPath) {
  const violations = [];
  const V = (rule, id, line, why) => violations.push({ rule, id, line, why });
  const anchor = makeAnchorChecker(checklistPath);   // P1-2：锚点真值（存在性），形态合规之后的第二道
  let parsed;
  try {
    parsed = parseChecklist(text);
  } catch (e) {
    return { violations: [{ rule: 'PARSE', id: '-', line: e.lineNo ?? '-', why: e.message }], counts: null, parsed: null };
  }
  const { top, items } = parsed;

  for (const k of Object.keys(top)) if (!TOP_KEYS.has(k)) V('UNKNOWN-TOP', '-', top[k].line, `未知顶层键「${k}」`);
  if (!('schema_version' in top)) V('SCHEMA-VERSION', '-', 1, '缺 schema_version');
  else if (top.schema_version.value !== '1') V('SCHEMA-VERSION', '-', top.schema_version.line, `schema_version=${top.schema_version.value}，期望 1`);
  if (items.length === 0) V('UNKNOWN-TOP', '-', 1, 'items 缺失或为空');
  if ('plan' in top && checklistPath) {
    const p = resolve(dirname(checklistPath), '..', '..', top.plan.value);
    if (!existsSync(p)) V('PLAN-PATH', '-', top.plan.line, `plan 指向的文件不存在：${top.plan.value}`);
  }

  const seenIds = new Map();
  items.forEach((it) => {
    const f = {};
    for (const fl of it.__fields) {
      f[fl.key] = fl;
      if (BANNED_KEYS.has(fl.key)) V('UNKNOWN-FIELD', String(f.id?.value ?? '-'), fl.line, BANNED_KEYS.get(fl.key));
      else if (!ITEM_KEYS.has(fl.key)) V('UNKNOWN-FIELD', String(f.id?.value ?? '-'), fl.line, `未知字段「${fl.key}」——新字段须先进校验器封闭集再进清单`);
    }
    const id = f.id ? (typeof f.id.value === 'string' ? f.id.value : '-') : '-';
    const line = f.id ? f.id.line : it.__line;
    // 非标量出现在标量字段上 = 形状漂移（只有 sources 允许是列表）。
    for (const [k, fl] of Object.entries(f)) {
      if (k !== 'sources' && typeof fl.value !== 'string')
        V('SCALAR-TYPE', id, fl.line, `字段「${k}」的值必须是标量（字符串），实际是行内列表`);
    }
    if (!f.id) V('ID-PATTERN', '-', it.__line, '缺 id');
    else if (!ID_RE.test(id)) V('ID-PATTERN', id, line, `id 不符合 G1-<域>-<NN>（大写域 + 两位序号）：「${id}」`);
    if (seenIds.has(id)) V('ID-DUP', id, line, `id 重复（首次出现于行${seenIds.get(id)}）——id 唯一且不复用`);
    else seenIds.set(id, line);

    // 正文：topic（清单既有形状）≡ spec（裁定文本名），互斥且必须恰有其一、非空
    const hasTopic = f.topic !== undefined;
    const hasSpec = f.spec !== undefined;
    if (hasTopic && hasSpec) V('SPEC-NONEMPTY', id, line, 'topic 与 spec 同时出现——正文字段只能有其一');
    const body = hasTopic ? f.topic : hasSpec ? f.spec : null;
    if (!body) V('SPEC-NONEMPTY', id, line, '缺正文字段（topic 或 spec）');
    else if (typeof body.value === 'string' && body.value.trim() === '')
      V('SPEC-NONEMPTY', id, body.line, '正文字段为空——不允许空占位');

    // sources：允许缺省；出现则必须是非空字符串列表（块列表或行内列表均可）
    if (f.sources !== undefined) {
      const asList = f.sources.list ?? (Array.isArray(f.sources.value) ? f.sources.value : null);
      if (!asList || asList.length === 0)
        V('SPEC-NONEMPTY', id, f.sources.line, 'sources 必须是非空字符串列表');
    }

    if (!f.status) V('STATUS-VOCAB', id, line, '缺 status');
    const status = f.status ? (typeof f.status.value === 'string' ? f.status.value : null) : null;
    if (status !== null && !STATUSES.has(status))
      V('STATUS-VOCAB', id, f.status.line, `status=「${status}」不在封闭集 {open, assigned, done, superseded}（v1 词 resolved 已迁移为 done，见文件头）`);

    // —— 冻结分层（专题⑤，2026-11-01；判据全文见 g1/G1-FREEZE-CRITERIA.md §4/§6）——
    // 缺失即红、漂移即红：**故意不给缺省值**。缺省成 A 会让既有清单形态突然全红（误伤闸，
    // 第二天就被绕过），缺省成 B 直接把冻结面腾空（洗白闸）。两个方向都不给，只给点名。
    const tierRaw = f.freeze_tier ? (typeof f.freeze_tier.value === 'string' ? f.freeze_tier.value.trim() : null) : null;
    if (!f.freeze_tier)
      V('FREEZE-TIER', id, line, '缺 freeze_tier——每条条目必须显式声明冻结分层 A|B；「缺省算哪一层」这个问题不许存在（缺省成 B 腾空冻结面、缺省成 A 误伤旧形态，两头都是失效）');
    else if (tierRaw === null || tierRaw === '')
      V('FREEZE-TIER', id, f.freeze_tier.line, 'freeze_tier 是空占位（取值闭集 {A, B}）');
    else if (!FREEZE_TIERS.has(tierRaw))
      V('FREEZE-TIER', id, f.freeze_tier.line, `freeze_tier=「${tierRaw}」不在封闭集 {A, B}（A = 关键基础合同，冻结前必须闭合；B = 纯 G2/G3 实施与验证义务，不计入冻结阻塞但必须有归属）`);
    // B 层免检「完成」，所以降级必须留痕：tier_basis 必填 + 含可定位锚点 + 过锚点真值（与
    // DONE-EVIDENCE 真值段同判据、同一 anchor 工厂）。A 降 B 是**判据面变更**，与替代关系同级。
    if (tierRaw === 'B') {
      const tb = f.tier_basis ? (typeof f.tier_basis.value === 'string' ? f.tier_basis.value.trim() : '') : null;
      if (!f.tier_basis)
        V('FREEZE-TIER-BASIS', id, line, 'freeze_tier=B 但没有 tier_basis——把条目移出冻结阻塞面是判据面变更，必须写明「依据哪份在位裁定/条文，本条判据已闭合、剩余只有实施」（与替代关系同级，不许自我声明）');
      else if (tb === '')
        V('FREEZE-TIER-BASIS', id, f.tier_basis.line, 'tier_basis 是空占位');
      else if (!COMMIT_RE.test(tb) && !FILE_RE.test(tb))
        V('FREEZE-TIER-BASIS', id, f.tier_basis.line, 'tier_basis 缺可定位锚点（提交号 / 带扩展名的文件路径〔可带 :行号〕）——「我认为这条只剩实现」不许是自我声明');
      else for (const bad of anchor.problemsOf(tb))
        V('FREEZE-TIER-BASIS', id, f.tier_basis.line, `锚点真值未过：${bad}（与 DONE-EVIDENCE 真值段同判据；降级留痕的锚不许是假锚）`);
    }

    const owner = f.owner ? (typeof f.owner.value === 'string' ? f.owner.value.trim() : '') : null;
    if (!f.owner) V('OWNER-RULE', id, line, '缺 owner');
    else if (owner === '') V('OWNER-RULE', id, f.owner.line, 'owner 为空');
    else if (status !== null && status !== 'open' && owner === 'UNASSIGNED')
      V('OWNER-RULE', id, f.owner.line, `status=${status} 不允许 owner=UNASSIGNED——关闭/推进任何条目都要有权威归属`);

    const ev = f.evidence ? (typeof f.evidence.value === 'string' ? f.evidence.value.trim() : '') : null;
    if (f.evidence && ev === '') V('DONE-EVIDENCE', id, f.evidence.line, 'evidence 是空占位');
    if (status === 'done') {
      if (ev === null) V('DONE-EVIDENCE', id, line, 'status=done 但没有 evidence——「已修」不许是自我声明');
      else if (!COMMIT_RE.test(ev) && !FILE_RE.test(ev))
        V('DONE-EVIDENCE', id, f.evidence.line, 'evidence 缺可定位锚点（提交号 / 带扩展名的文件路径〔可带 :行号〕）——只写「经审查确认」不算证据');
      // P1-2 真值段：形态过了不等于锚存在。假提交号 / 幽灵路径逐锚点名（判据与先例见工厂注释）。
      else for (const bad of anchor.problemsOf(ev))
        V('DONE-EVIDENCE', id, f.evidence.line, `锚点真值未过：${bad}（「形态合规≠锚存在」由 RE-REVIEW-G1-ENG P1-2 定案；自验 M18/M19/M21 钉死，正向 M20 防空转）`);
      // 第六轮裁定：done 三件套 = 权威 owner（OWNER-RULE 判非空/非 UNASSIGNED，权威性仍人工）
      // + 可定位 evidence（DONE-EVIDENCE）+ 明确 resolution（本条）。「已解决」不含
      // 「谁让位、依据什么」= 结论词自我声明，GT 系列的同款教训。
      const resv = f.resolution ? (typeof f.resolution.value === 'string' ? f.resolution.value.trim() : '') : null;
      if (!f.resolution)
        V('DONE-RESOLUTION', id, line, 'status=done 但没有 resolution——关闭三件套缺一：明确「谁让位、依据什么」不在载荷里，不许只留结论');
      else if (resv === '')
        V('DONE-RESOLUTION', id, f.resolution.line, 'resolution 是空占位');
    }

    const supRaw = f.superseded_by ? f.superseded_by.value : null;
    const supTargets = supRaw === null ? [] : Array.isArray(supRaw) ? supRaw : [supRaw];
    if (supTargets.length > 0) {
      const allIds = new Set(items.map((o) => { const v = o.__fields.find((x) => x.key === 'id')?.value; return typeof v === 'string' ? v : '-'; }));
      for (const sup of supTargets) {
        if (sup === id) V('SUPERSEDED-BY-EXISTS', id, f.superseded_by.line, 'superseded_by 指向自己');
        else if (!allIds.has(sup)) V('SUPERSEDED-BY-EXISTS', id, f.superseded_by.line, `superseded_by 指向不存在的 id「${sup}」`);
      }
    }
    if (status === 'superseded' && supTargets.length === 0)
      V('SUPERSEDED-TARGET', id, line, 'status=superseded 必须给出 superseded_by（指向取代它的条目；方向=被取代者→取代者，见文件头）');
    // —— superseded 自身的替代载荷（第七轮，反「指向任意 done 即整片洗白」反例的结构层）：——
    // 理由与证据都必须带可定位锚点（锚点判据复用 DONE-EVIDENCE 一条：提交号 / 带扩展名
    // 文件路径）。空占位红；「被裁定取代」「经审查确认」式结论词无锚 = 红——替代理由与
    // 替代证据都不许是自我声明。这是裁定「结构校验」层的兑现；「人工确认」层在谓词面，见头注。
    if (status === 'superseded') {
      for (const [key, rule, whyMissing] of [
        ['supersession_reason', 'SUPERSESSION-REASON', 'status=superseded 但没有 supersession_reason——替代理由不在载荷里，「它被取代了」不含「为什么两条问题等价/让位」'],
        ['supersession_evidence', 'SUPERSESSION-EVIDENCE', 'status=superseded 但没有 supersession_evidence——替代关系没有可定位依据，「已被取代」不许是自我声明'],
      ]) {
        const v = f[key] ? (typeof f[key].value === 'string' ? f[key].value.trim() : '') : null;
        if (!f[key]) V(rule, id, line, whyMissing);
        else if (v === '') V(rule, id, f[key].line, `${key} 是空占位`);
        else if (!COMMIT_RE.test(v) && !FILE_RE.test(v))
          V(rule, id, f[key].line, `${key} 缺可定位锚点（提交号 / 带扩展名的文件路径〔可带 :行号〕）——结论词不能充当替代理由/证据（锚点判据与 DONE-EVIDENCE 同）`);
        // P1-2 真值段：只判 supersession_evidence（替代关系的**证据**锚）——reason 是叙事文本，
        // 其锚点只判形态（判据分工写进头注），证据锚造假已由本规则码点名。
        else if (key === 'supersession_evidence')
          for (const bad of anchor.problemsOf(v))
            V(rule, id, f[key].line, `锚点真值未过：${bad}（与 DONE-EVIDENCE 真值段同判据；自验 M18/M19/M21 同族）`);
      }
    }
  });

  // —— superseded 链闭合判据（第六轮）：每条 superseded 的继任链必须最终到达 done。——
  // 防的是两种「换皮未完成」：superseded 环（A 说 B 取代、B 说 A 取代，每一步单看都
  // 指向存在 id，环整体却没有任何裁定落地）与指向 open 的甩锅链（把工作推给未开始项）。
  // 逐链只在起点报一次（链上各 superseded 各自起点各报各的，点名到条目）。
  const byId = new Map();
  const fieldOf = (it, k) => it.__fields.find((x) => x.key === k);
  for (const it of items) {
    const v = fieldOf(it, 'id')?.value;
    const k = typeof v === 'string' ? v : null;
    if (k && !byId.has(k)) byId.set(k, it);   // 重号已被 ID-DUP 红；解析期已禁止条目内重复字段，find 与最后赋值必然同值
  }
  for (const it of items) {
    const st = typeof fieldOf(it, 'status')?.value === 'string' ? fieldOf(it, 'status').value : null;
    if (st !== 'superseded') continue;
    const id = typeof fieldOf(it, 'id')?.value === 'string' ? fieldOf(it, 'id').value : '-';
    const line = fieldOf(it, 'superseded_by')?.line ?? it.__line;
    const seen = new Set([id]);
    let cur = it;
    let curId = id;
    for (;;) {
      const sup = cur.__fields.find((x) => x.key === 'superseded_by')?.value;
      // 缺 superseded_by / 指自己 / 指向不存在 id：SUPERSEDED-TARGET / SUPERSEDED-BY-EXISTS 已各自红，链判据不重复记。
      if (typeof sup !== 'string' || sup === '' || sup === curId) break;
      if (seen.has(sup)) {
        V('SUPERSEDED-CHAIN', id, line, `superseded_by 链回到「${sup}」成环——继任链不许闭合，环里没有任何裁定落地`);
        break;
      }
      seen.add(sup);
      const nxt = byId.get(sup);
      if (!nxt) break; // 指向不存在 id：SUPERSEDED-BY-EXISTS 已红
      const nst = fieldOf(nxt, 'status')?.value;
      if (nst === 'done') break;              // 到达已完成 ⇒ 链合法
      if (nst === 'superseded') { cur = nxt; curId = sup; continue; }
      V('SUPERSEDED-CHAIN', id, line,
        `superseded_by 链终点「${sup}」status=「${typeof nst === 'string' ? nst : '缺失/非法'}」≠ done——superseded 必须由最终完成的条目继任（禁止指向 open/assigned 的甩锅链）`);
      break;
    }
  }

  let unassigned = 0;
  let open = 0;
  let assigned = 0;
  let done = 0;
  let superseded = 0;
  // 人工确认门（第七轮，裁定：「机器无法自动证明两个复杂契约语义等价 ⇒ 结构校验 + 人工
  // 确认替代关系」）：每条 superseded 需合法 supersession_review 且审查者≠owner。
  // **日常判据不拦**（缺 review 不记违规，不阻塞推进）；只在此计数，供 --require-clear 拦。
  let supersededUnreviewed = 0;
  const unreviewedDetail = [];
  // —— 冻结分层计数（专题⑤，2026-11-01；判据全文见 g1/G1-FREEZE-CRITERIA.md）——
  // **从严规则**：freeze_tier 缺失或取值非法（FREEZE-TIER 已各自红）的条目，此处在谓词面**一律按 A 层计**——
  // 「层级不明」绝不允许被当成「不阻塞冻结」，否则「删掉 freeze_tier 行」就是最省事的降级手法。
  // B 层的「有归属」= owner 非空且非 UNASSIGNED；这一项由**全局 unassigned** 承担（旧谓词那一项一字不动
  // ⇒ B 层免检的是**完成**，不免**归属**）。
  const tierOf = (it) => {
    const t = it.__fields.find((x) => x.key === 'freeze_tier')?.value;
    return typeof t === 'string' && FREEZE_TIERS.has(t.trim()) ? t.trim() : 'A';
  };
  const tierA = { items: 0, open: 0, assigned: 0, done: 0, superseded: 0, supersededUnreviewed: 0 };
  const tierB = { items: 0, open: 0, assigned: 0, done: 0, superseded: 0, unowned: 0 };
  for (const it of items) {
    const g = (k) => it.__fields.find((x) => x.key === k)?.value;
    const st = typeof g('status') === 'string' ? g('status') : '';
    const tier = tierOf(it);
    const own = typeof g('owner') === 'string' ? g('owner').trim() : '';
    if (tier === 'A') {
      tierA.items++;
      if (st === 'open') tierA.open++;
      else if (st === 'assigned') tierA.assigned++;
      else if (st === 'done') tierA.done++;
      else if (st === 'superseded') tierA.superseded++;
    } else {
      tierB.items++;
      if (st === 'open') tierB.open++;
      else if (st === 'assigned') tierB.assigned++;
      else if (st === 'done') tierB.done++;
      else if (st === 'superseded') tierB.superseded++;
      if (own === '' || own === 'UNASSIGNED') tierB.unowned++;
    }
    const unrevBefore = supersededUnreviewed;
    if (st === 'open') open++;
    else if (st === 'assigned') assigned++;
    else if (st === 'done') done++;
    else if (st === 'superseded') {
      superseded++;
      const idOf = typeof g('id') === 'string' ? g('id') : '-';
      const rv = typeof g('supersession_review') === 'string' ? g('supersession_review') : null;
      const m = rv === null ? null : REVIEW_RE.exec(rv);
      const ownerOf = typeof g('owner') === 'string' ? g('owner').trim() : '';
      if (rv === null) {
        supersededUnreviewed++;
        unreviewedDetail.push(`${idOf}：缺 supersession_review（终局面须人工确认替代关系，形如 "REVIEW: <YYYY-MM-DD> <非作者审查者>"）`);
      } else if (!m) {
        supersededUnreviewed++;
        unreviewedDetail.push(`${idOf}：supersession_review 形态不合法「${rv.slice(0, 60)}」（须为 REVIEW: <YYYY-MM-DD> <审查者>）`);
      } else if (!isRealIsoDate(m[1])) {
        // 第八轮：形合的不可能日期（9999-99-99 / 2026-02-30）不再充当签字日期——正则过了
        // 历法不过，同样算未经确认。闰年真实日期（2024-02-29）必须放行，常驻变异 M24 防误伤。
        supersededUnreviewed++;
        unreviewedDetail.push(`${idOf}：supersession_review 日期「${m[1]}」不是真实历法日期（月须 01–12、日须在该月实际天数内，含闰年 2 月 29 日）——形态合规的不可能日期不算签字`);
      } else if (m[2].trim() === ownerOf) {
        supersededUnreviewed++;
        unreviewedDetail.push(`${idOf}：supersession_review 审查者与 owner 同名「${m[2].trim()}」——自己确认自己的替代关系不算确认`);
      }
    }
    if (tier === 'A' && supersededUnreviewed > unrevBefore) tierA.supersededUnreviewed++;
    if (typeof g('owner') === 'string' && g('owner').trim() === 'UNASSIGNED') unassigned++;
  }
  return {
    violations,
    counts: {
      items: items.length, open, assigned, done, superseded, unassigned, supersededUnreviewed,
      tierA, tierB,
    },
    unreviewedDetail,
    parsed,
  };
}

// ---------- 终局放行谓词（第六/七/八轮的旧谓词 + 专题⑤两层口径，2026-11-01） ----------
// **旧谓词原文（保留以示演化，逐项对照）**：
//   违规==0 ∧ open==0 ∧ assigned==0 ∧ unassigned==0 ∧ supersededUnreviewed==0
// **现行谓词（本函数）**：
//   违规==0 ∧ A 层非空 ∧ A 层 open==0 ∧ A 层 assigned==0 ∧ unassigned==0 ∧ supersededUnreviewed==0
// 相对旧谓词**只收窄一项**：`open`/`assigned` 的终局阻塞面从「全局」收窄到「A 层」——B 层是纯 G2/G3
// 实施与验证义务，它的 open/assigned 是排期事实不是合同缺口（判据件《g1/G1-FREEZE-CRITERIA.md》§1）。
// 其余四项**一字未动**：`unassigned==0` 顺带就是「B 层必须有归属」，`supersededUnreviewed==0` 不分层
// （替代关系的人工确认门与层级无关）。新增项「A 层非空」拦的是把分层整体抽空——A 层为空时
// 「A 层全闭」是真空真，会让谓词自己变成洗白通道。
// 返回**阻塞原因数组**（空数组 = 放行）：调用方（主流程 / 自验的 CLEAR、PREDICATE 判据）读同一个函数，
// 不许在两处各写一遍谓词——「两个判据不得看到不同事实」是第六轮裁定的老纪律。
function clearBlockers(c) {
  if (!c) return ['清单解析失败（counts 为空），终局谓词无从判定'];
  const b = [];
  if (c.tierA.items === 0)
    b.push('A 层条目数 = 0（分层被整体抽空：没有任何「关键基础合同」条目，「A 层全闭」就成了真空真）');
  if (c.tierA.open !== 0) b.push(`A 层未闭合 open=${c.tierA.open}（期望 0——A 层是冻结前置）`);
  if (c.tierA.assigned !== 0) b.push(`A 层仍是推进态 assigned=${c.tierA.assigned}（期望 0——「有人认领」不放行）`);
  if (c.unassigned !== 0)
    b.push(`owner=UNASSIGNED ${c.unassigned} 条（期望 0——含 B 层：B 层免检的是完成，不免归属）`);
  if (c.supersededUnreviewed !== 0)
    b.push(`superseded 未经人工确认 ${c.supersededUnreviewed} 条（期望 0——终局面需合法 supersession_review 且审查者≠owner）`);
  return b;
}

// ---------- 变异自验（架空，不是删除） ----------
// 每个变异都是在**真实清单文本**上做最小「洗白形」改写——仿照审查方会用来骗过校验器的
// 形态（关闭无证据、指向幽灵 id、塞未知字段、重号、旧词复活、空口关闭）。
// 判据：对应规则码必须出现 = 被捕获；任何一个变异活下来 ⇒ 校验器自身失效 = exit 1。
// 第八轮日期变体的共用夹具：一条**除日期外全部齐形**的 superseded 条目（id 合法、owner 有主、
// 继任链到达 done、reason/evidence 都带真实可定位锚、审查者≠owner）。齐形是刻意的——若其余角
// 有缺口，红就可能是别的规则顺带命中（错误原因通过），日期判据本身根本没被检验。
// 唯一变量是 supersession_review 里的日期字符串。
function supersededWithReview(id, iso, reviewer) {
  return '\n  - id: ' + id + '\n'
    + '    topic: "变异夹具：supersession_review 日期判据（除日期外全齐形，不落主清单）"\n'
    + '    owner: "Q40（夹具归属）"\n'
    + '    status: superseded\n'
    // 分层字段必须给：缺失本身就是 FREEZE-TIER 红，日期族变异要求违规==0 才算「红因是日期判据」，
    // 不给这一行会让四条日期变异全部因错误原因通过（专题⑤加字段时同步补齐，旧断言一字未动）。
    + '    freeze_tier: "A"\n'
    + '    superseded_by: "G1-DONE-01"\n'
    + '    supersession_reason: "g1-checklist-validate.mjs:1（夹具锚：演示日期判据专用）"\n'
    + '    supersession_evidence: "g1-checklist-validate.mjs:1（夹具锚）"\n'
    + '    supersession_review: "REVIEW: ' + iso + ' ' + reviewer + '"\n';
}

// 日期族变体的判据（谓词面）：红/绿都不在 violations 里（人工确认门只作用于 --require-clear），
// 判据 = supersededUnreviewed 计数 + 点名到该条目的细节文本；违规必须仍为 0，否则红是别的规则
// 顺带挡的、日期判据本身没被检验（错误原因通过）。
function dateRedCheck(mu) {
  return (res) => {
    const detail = (res.unreviewedDetail ?? []).find((d) => d.startsWith(`${mu.id}：`));
    const hit = res.violations.length === 0 && res.counts !== null
      && res.counts.supersededUnreviewed > 0 && /真实历法日期/.test(detail ?? '');
    return {
      hit,
      verdict: hit
        ? `捕获（违规=0 前提下终局门判红：superseded_unreviewed=${res.counts.supersededUnreviewed}｜点名：${detail}）`
        + `｜不可能日期「${mu.iso}」不得充当签字日期`
        : `**存活**（期望违规=0 且日期「${mu.iso}」被历法判据点名；实际违规=${res.violations.length} `
          + `计数=${res.counts ? JSON.stringify(res.counts) : '解析失败'} 点名=${detail ?? '无'}）`,
    };
  };
}
// 正向侧（真闰日必须放行）：除这条夹具外主清单没有 superseded ⇒ superseded==1 且未确认计数==0。
function dateGreenCheck(mu) {
  return (res) => {
    const hit = res.violations.length === 0 && res.counts !== null
      && res.counts.superseded === 1 && res.counts.supersededUnreviewed === 0;
    const detail = (res.unreviewedDetail ?? []).find((d) => d.startsWith(`${mu.id}：`));
    return {
      hit,
      verdict: hit
        ? `捕获（真闰日不误伤：违规=0、superseded=1、superseded_unreviewed=0 ⇒「REVIEW: ${mu.iso}」被接受）`
        : `**存活**（期望真日期「${mu.iso}」放行；实际违规=${res.violations.length} `
          + `计数=${res.counts ? JSON.stringify(res.counts) : '解析失败'} 点名=${detail ?? '无'}）`,
    };
  };
}

const MUTANTS = [
  {
    name: 'M1-done-无证据（把 DONE-01 的 evidence 整行摘掉，其余一字不动）',
    expect: 'DONE-EVIDENCE',
    apply(text) {
      const i = text.indexOf('- id: G1-DONE-01');
      if (i < 0) throw new Error('变异夹具失配：找不到 G1-DONE-01');
      const seg = text.slice(i);
      const out = seg.replace(/\n {4}evidence: "[^"]*"/, '');
      if (out === seg) throw new Error('变异未生效：DONE-01 的 evidence 未被摘除');
      return text.slice(0, i) + out;
    },
  },
  {
    name: 'M2-superseded_by 指向不存在 id（新增一条形状完全合法的 superseded 条目；字段名随第七轮改名同步——若用旧名会被禁止字段先拦，成错误原因通过）',
    expect: 'SUPERSEDED-BY-EXISTS',
    apply(text) {
      return (
        text +
        '\n  - id: G1-MUTA-99\n' +
        '    topic: "变异夹具：指向幽灵 id 的取代声明"\n' +
        '    owner: "Q40"\n' +
        '    status: superseded\n' +
        '    freeze_tier: "A"\n' +
        '    evidence: "g1-checklist-validate.mjs"\n' +
        '    superseded_by: "G1-NOPE-99"\n'
      );
    },
  },
  {
    name: 'M3-未知字段（往 G1-TIME-01 里塞 priority，模拟字段漂移）',
    expect: 'UNKNOWN-FIELD',
    apply(text) {
      const i = text.indexOf('- id: G1-TIME-01');
      if (i < 0) throw new Error('变异夹具失配：找不到 G1-TIME-01');
      return text.slice(0, i) + '- id: G1-TIME-01\n    priority: "P0"' + text.slice(i + '- id: G1-TIME-01'.length);
    },
  },
  {
    name: 'M4-id 重号（复制一条合法条目，只留同 id 形状）',
    expect: 'ID-DUP',
    apply(text) {
      const m = / {2}- id: G1-READ-01[\s\S]*?\n(?= {2}- id:)/.exec(text);
      if (!m) throw new Error('变异夹具失配：抓不到 G1-READ-01 整块');
      return text + '\n' + m[0];
    },
  },
  {
    name: 'M5-旧词复活（把 DONE-02 的 status 改回 v1 词汇 resolved）',
    expect: 'STATUS-VOCAB',
    apply(text) {
      const i = text.indexOf('- id: G1-DONE-02');
      if (i < 0) throw new Error('变异夹具失配：找不到 G1-DONE-02');
      const seg = text.slice(i);
      const out = seg.replace('status: done', 'status: resolved');
      if (out === seg) throw new Error('变异未生效：DONE-02 的 status 未被改写');
      return text.slice(0, i) + out;
    },
  },
  {
    name: 'M6-done 带无锚证据（把 DONE-01 的 evidence 换成「经审查确认」式自我声明）',
    expect: 'DONE-EVIDENCE',
    apply(text) {
      const i = text.indexOf('- id: G1-DONE-01');
      if (i < 0) throw new Error('变异夹具失配：找不到 G1-DONE-01');
      const seg = text.slice(i);
      const out = seg.replace(/evidence: "[^"]*"/, 'evidence: "经审查确认，无需再证"');
      if (out === seg) throw new Error('变异未生效：evidence 未被替换');
      return text.slice(0, i) + out;
    },
  },
  {
    name: 'M7-解析面攻击（注入未闭合引号串，验证解析器 fail-loud 而非退化成 grep）',
    expect: 'PARSE',
    apply(text) {
      return text + '\n  - id: G1-MUTA-98\n    topic: "未闭合引号\n';
    },
  },
  // —— 第六轮新增（裁定原话：现有 7/7 只证明七个**预设**变异被捕获）。——
  {
    name: 'M8-终局态洗白（全部 open→assigned 且 UNASSIGNED 换成有主 owner：日常判据无违规，'
      + '旧 --require-clear 只数 open/unassigned 会当场放行——这正是被点名的 G1 门禁 P1）',
    expect: 'PREDICATE',   // 捕获 = 违规==0 且谓词红（若靠违规红算「捕获」是错误原因通过，不算）
    apply(text) {
      const out = text
        .replace(/^    status: open$/gm, '    status: assigned')
        .replace(/^    owner: "UNASSIGNED"$/gm, '    owner: "M8 变异：伪装权威归属"');
      if (out === text) throw new Error('变异未生效：清单里找不到 status: open / owner=UNASSIGNED 面');
      return out;
    },
  },
  {
    name: 'M9-done 三件套缺角（把 DONE-01 的 resolution 整行摘掉，owner+evidence 原样在——'
      + '「已解决」只剩结论，没有「谁让位、依据什么」）',
    expect: 'DONE-RESOLUTION',
    apply(text) {
      const i = text.indexOf('- id: G1-DONE-01');
      if (i < 0) throw new Error('变异夹具失配：找不到 G1-DONE-01');
      const seg = text.slice(i);
      const out = seg.replace(/\n {4}resolution: "[^"]*"/, '');
      if (out === seg) throw new Error('变异未生效：DONE-01 的 resolution 未被摘除');
      return text.slice(0, i) + out;
    },
  },
  {
    name: 'M10-superseded 环（两条互指 superseded：每一步单看都指向存在 id，环整体无任何裁定落地）',
    expect: 'SUPERSEDED-CHAIN',
    apply(text) {
      return text +
        '\n  - id: G1-MUTA-90\n    topic: "变异夹具：superseded 环 A 侧"\n    owner: "Q40"\n' +
        '    status: superseded\n    freeze_tier: "A"\n    superseded_by: "G1-MUTA-91"\n' +
        '  - id: G1-MUTA-91\n    topic: "变异夹具：superseded 环 B 侧"\n    owner: "Q40"\n' +
        '    status: superseded\n    freeze_tier: "A"\n    superseded_by: "G1-MUTA-90"\n';
    },
  },
  {
    name: 'M11-同条目重复字段（给 G1-TIME-01 追加第二条 status: done，首条仍是 open——旧实现'
      + '语义校验取最后一次赋值、计数统计 find() 取第一次，「被验证的状态 ≠ 被统计的状态」）',
    expect: 'PARSE',
    apply(text) {
      const marker = '- id: G1-TIME-01';
      const i = text.indexOf(marker);
      if (i < 0) throw new Error('变异夹具失配：找不到 G1-TIME-01');
      return text.slice(0, i) + marker + '\n    status: done' + text.slice(i + marker.length);
    },
  },
  {
    name: 'P1-正向形状（全部 open→done 并补齐三件套：终局谓词必须**绿**——只测反例的判据'
      + '工具已被打过一次（旧 N3 门只证新代码自证）；本条防谓词永远红把门禁变死闸）',
    expect: 'CLEAR',   // 捕获 = 违规==0 且谓词绿（与 M8 的 PREDICATE 红互为正反两面）
    apply(text) {
      const chunks = text.split(/(?=^  - id: )/m);
      let n = 0;
      const out = chunks.map((c) => {
        if (!/^    status: open$/m.test(c)) return c;
        n++;
        let d = c
          .replace(/^    owner: "UNASSIGNED"$/m, '    owner: "Q40（正向夹具）"')
          .replace(/^    status: open$/m, '    status: done\n    resolution: "正向夹具：占位裁定（自验专用，不落主清单）"');
        if (/^    evidence: "/m.test(d)) d = d.replace(/^    evidence: ".*"$/m, '    evidence: "g1-checklist-validate.mjs:1"');
        else d += '\n    evidence: "g1-checklist-validate.mjs:1"';
        return d;
      }).join('');
      if (n === 0) throw new Error('变异未生效：清单里没有 open 条目可转 done');
      return out;
    },
  },
  {
    name: 'M12-superseded 甩锅链（除 TIME-01 外全部 open→superseded 并统一 superseded_by 指向'
      + '仍 open 的 TIME-01：每一跳单看都指向存在 id，整条链没有任何裁定落地——'
      + '父席要求把这条的完整形态留在自验输出里，不只报条数）',
    expect: 'SUPERSEDED-CHAIN',
    apply(text) {
      const chunks = text.split(/(?=^  - id: )/m);
      let n = 0;
      const out = chunks.map((c) => {
        if (!/^    status: open$/m.test(c) || /^  - id: G1-TIME-01$/m.test(c)) return c;
        n++;
        return c
          .replace(/^    status: open$/m, '    status: superseded\n    superseded_by: "G1-TIME-01"')
          .replace(/^    owner: "UNASSIGNED"$/m, '    owner: "M12 变异：甩锅给 open 项"');
      }).join('');
      if (n === 0) throw new Error('变异未生效：清单里没有可甩的 open 条目');
      return out;
    },
  },
  // —— 第七轮新增（裁定点名的「superseded 终局洗白」反例：全部 open 改 superseded +
  //    非空 owner + 全部指向任意既有 done ⇒ 旧校验器终局 PASS，而 23 个问题一个没解决）。——
  {
    name: 'M14-终局洗白最小形（全部 open→superseded + 有主 owner + 统一 superseded_by 指向'
      + '既有 done G1-DONE-01，不带 reason/evidence/review——链终点确为 done、每步 id 都存在，'
      + '旧校验器 --require-clear 实测判绿（第七轮反例）；修后必须红在替代载荷缺失上）',
    expect: 'SUPERSESSION-REASON',
    apply(text) {
      const out = text
        .replace(/^    owner: "UNASSIGNED"$/gm, '    owner: "M14 变异：伪装权威归属"')
        .replace(/^    status: open$/gm, '    status: superseded\n    superseded_by: "G1-DONE-01"');
      if (out === text) throw new Error('变异未生效：清单里找不到 status: open / owner=UNASSIGNED 面');
      return out;
    },
  },
  {
    name: 'M15-同形但带人工确认（M14 全形 + 补齐 reason/evidence 但两者均为无锚结论词 + '
      + '合法形态 supersession_review 且审查者≠owner）⇒ **仍红**：无锚的「经审查确认」式'
      + '载荷形态不足，签字不能把自我声明变成证据——可绿的充分形态见头注（锚点齐 + 审查合法）',
    expect: 'SUPERSESSION-EVIDENCE',
    apply(text) {
      const out = text
        .replace(/^    owner: "UNASSIGNED"$/gm, '    owner: "M15 变异：伪装权威归属"')
        .replace(/^    status: open$/gm, '    status: superseded\n    superseded_by: "G1-DONE-01"'
          + '\n    supersession_reason: "经审查确认，原问题已被取代"'
          + '\n    supersession_evidence: "裁定已另行给出，无需再证"'
          + '\n    supersession_review: "REVIEW: 2026-11-01 M15 变异：非owner审查者"');
      if (out === text) throw new Error('变异未生效：清单里找不到 status: open / owner=UNASSIGNED 面');
      return out;
    },
  },
  {
    name: 'M16-旧字段复活（给 G1-TIME-01 追加 supersedes 字段：ADR-0003 方向与本清单相反，'
      + '新旧混用即禁止字段红，即便指向存在 id 且形状合法）',
    expect: 'UNKNOWN-FIELD',
    apply(text) {
      const marker = '- id: G1-TIME-01';
      const i = text.indexOf(marker);
      if (i < 0) throw new Error('变异夹具失配：找不到 G1-TIME-01');
      return text.slice(0, i) + marker + '\n    supersedes: "G1-DONE-01"' + text.slice(i + marker.length);
    },
  },
  {
    name: 'M17-旧字段切断链尝试（新 superseded 条目只写旧名 supersedes 指向存在的 done：'
      + '链遍历已不读旧名，若无兜底这会被「静默当成无继任」放成链终点缺失——必须双红：'
      + 'UNKNOWN-FIELD（禁止字段）+ SUPERSEDED-TARGET（缺 superseded_by 本身就是红，'
      + '「无继任」不是中性态）。父席 2026-10-31 点名的绕过形态，单靠 M16 钉不住这条链'
      + '（M16 的旧名挂在 open 条目上，不在链判据路径））',
    expect: ['UNKNOWN-FIELD', 'SUPERSEDED-TARGET'],
    apply(text) {
      // 载荷其余字段（reason/evidence 含锚）刻意给齐：让违规面**恰好只剩**禁止字段+缺继任
      // 两条——若把其余角也摘掉，双红可能只是别的原因顺带命中（错误原因通过）。
      return text +
        '\n  - id: G1-MUTA-97\n    topic: "变异夹具：旧字段切断链尝试（只写旧名指向存在 done）"\n' +
        '    owner: "Q40"\n    status: superseded\n    freeze_tier: "A"\n    supersedes: "G1-DONE-01"\n' +
        '    supersession_reason: "g1-checklist-validate.mjs（夹具锚：演示形态不落主清单）"\n' +
        '    supersession_evidence: "g1-checklist-validate.mjs:1（夹具锚）"\n';
    },
  },
  // ——— P1-2（RE-REVIEW-G1-ENG §E4，2026-11-01）：锚点真值的四条形变 ———
  // 先复现后修的复现记录：修**前**（只判形态）用同一构造跑 `--file fake.yaml --require-clear`
  // 实测 **exit 0**（27/27 done、违规=0；`git cat-file -t abcdef0` = 128、幽灵路径 ls = 2，
  // 两个锚都不存在却被判绿）。修**后** M18/M19/M21 全红、M20 保持绿——四侧钉死，
  // 「假锚洗白终局放行谓词」这条路从此常驻有守门员。
  {
    name: 'M18-done+假提交号（把 DONE-01 的 evidence 换成「abcdef0 见 真实文件」：abcdef0 形态合规'
      + '（COMMIT_RE 命中）但 git cat-file 无此提交——修前该形态判绿（§E4 反例的 done 侧），修后必红'
      + '（真值段的提交半边））',
    expect: 'DONE-EVIDENCE',
    apply(text) {
      const m = text.match(/^ {4}evidence: "CONTRACTS\.md:277-288[^"]*"$/m);
      if (!m) throw new Error('变异夹具失配：找不到 DONE-01 的 evidence 行');
      return text.replace(m[0], '    evidence: "abcdef0 见 g1-checklist-validate.mjs:1"');
    },
  },
  {
    name: 'M19-done+不存在路径（evidence 换成 ghost-evidence-does-not-exist.md：FILE_RE 形态命中、'
      + '两候选根 existsSync 与 git ls-files 后缀匹配三面全空——真值段的路径半边必红）',
    expect: 'DONE-EVIDENCE',
    apply(text) {
      const m = text.match(/^ {4}evidence: "CONTRACTS\.md:277-288[^"]*"$/m);
      if (!m) throw new Error('变异夹具失配：找不到 DONE-01 的 evidence 行');
      return text.replace(m[0], '    evidence: "ghost-evidence-does-not-exist.md"');
    },
  },
  {
    name: 'M20-done+真提交+真路径（正向防空转：HEAD 实测提交号 + 本校验器路径，形态与真值两面'
      + '全过 ⇒ 必须判绿——真值校验若把真锚也判红就是误伤闸，第二天就会被绕过）',
    expect: 'CLEAN',
    apply(text) {
      const head = spawnSync('git', ['-C', HERE, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
      if (!/^[0-9a-f]{7,40}$/.test(head)) throw new Error('变异构造失败：取不到 HEAD 提交号');
      const m = text.match(/^ {4}evidence: "CONTRACTS\.md:277-288[^"]*"$/m);
      if (!m) throw new Error('变异夹具失配：找不到 DONE-01 的 evidence 行');
      return text.replace(m[0], `    evidence: "${head} 见 g1-checklist-validate.mjs:1"`);
    },
  },
  {
    name: 'M21-终局洗白全形常驻回归（RE-REVIEW-G1-ENG §E4 的**原反例**：27 条全改 done + owner 伪造'
      + '归属 + 每条 evidence 同一条假锚「abcdef0 见 ghost-evidence-does-not-exist.md」+ resolution'
      + ' 形合文本——修前该文本 --require-clear exit 0（今天实测的绿，登记为常驻回归）；修后 DONE-EVIDENCE'
      + ' 逐条点名真值违规，放行谓词必红）',
    expect: 'DONE-EVIDENCE',
    apply(text) {
      let t = text
        .replace(/^    status: open$/gm, '    status: done\n    resolution: "形合文本：经审查已解决（伪造）"')
        .replace(/^    owner: "UNASSIGNED"$/gm, '    owner: "Q40（伪造归属）"')
        .replace(/^    evidence: ".*"$/gm, '    evidence: "abcdef0 见 ghost-evidence-does-not-exist.md"');
      // 原本没有 evidence 行的条目补假锚行——洗白场景不限于「已有锚」的条目（照 §E4 复现脚本同构）
      t = t.split(/(?=^  - id: )/m).map((c) =>
        (/^    status: done$/m.test(c) && !/^    evidence: /m.test(c)
          ? c.replace(/^  - id: (G1-[A-Z0-9-]+)\n/, '  - id: $1\n    evidence: "abcdef0 见 ghost-evidence-does-not-exist.md"\n')
          : c)).join('');
      if (!/^    owner: "Q40（伪造归属）"/m.test(t)) throw new Error('变异未生效：洗白形未构造成功');
      return t;
    },
  },
  // ——— 第八轮（验席挖出的两处校验器小口，2026-11-01）：日期真值 + 参数 fail-loud ———
  // 两侧都留常驻变异：不可能日期必红、闰年真实日期必绿；裸位置参数必非 0、--file 必正常。
  // 只测反例的判据工具已被打过两次（M20/M21 同族教训），正向侧不是可选项。
  {
    name: 'M22-supersession_review 不可能日期「9999-99-99」（REGEX 形合但历法不存在：修前 REVIEW_RE'
      + ' 命中即算已确认，一条从没存在过的日子就能给替代关系签字；修后历法判据必红，且红因'
      + '必须是日期而非别的角——夹具除日期外全齐形）',
    expect: 'REVIEW-DATE-RED',
    id: 'G1-MUTA-96', iso: '9999-99-99',
    apply(text) {
      const out = text + supersededWithReview('G1-MUTA-96', '9999-99-99', 'M22 变异：非owner审查者');
      if (!out.includes('REVIEW: 9999-99-99')) throw new Error('变异未生效：不可能日期夹具未追加');
      return out;
    },
  },
  {
    name: 'M23-supersession_review 历法不存在日期「2026-02-30」（月对日错：2 月没有 30 日，旧实现'
      + '的 \\d{2} 一视同仁放行——日期真值不是只查月；夹具同 M22 全齐形，红因只许是日期）',
    expect: 'REVIEW-DATE-RED',
    id: 'G1-MUTA-95', iso: '2026-02-30',
    apply(text) {
      const out = text + supersededWithReview('G1-MUTA-95', '2026-02-30', 'M23 变异：非owner审查者');
      if (!out.includes('REVIEW: 2026-02-30')) throw new Error('变异未生效：2026-02-30 夹具未追加');
      return out;
    },
  },
  {
    name: 'M24-supersession_review 闰年真实日期「2024-02-29」（**正向防误伤**：收紧历法判据若把'
      + '闰日也判红，第二天就会有人把日期写成 2 月 28 日糊弄过去——真日子必须照常放行；'
      + '夹具其余角与 M22/M23 逐字同形，唯一差别就是这个日子真存在）',
    expect: 'REVIEW-DATE-GREEN',
    id: 'G1-MUTA-94', iso: '2024-02-29',
    apply(text) {
      const out = text + supersededWithReview('G1-MUTA-94', '2024-02-29', 'M24 变异：非owner审查者');
      if (!out.includes('REVIEW: 2024-02-29')) throw new Error('变异未生效：闰日夹具未追加');
      return out;
    },
  },
  {
    name: 'M25-裸位置参数被静默忽略（CLI 型：把清单路径当裸位置参数传进去。修前旧实现丢掉它、'
      + '转去校验**默认主清单**并 exit 0——调用者以为绿的是自己指定的那份，这是「换个对象变绿」'
      + '不是「少报一个参数」；修后必非 0 且打印一行用法说明）',
    expect: 'CLI-FAIL-LOUD',
    run({ target }) {
      const bad = runSelf([target]);
      const out = `${bad.stdout ?? ''}${bad.stderr ?? ''}`.trim();
      const first = out.split('\n')[0] ?? '';
      const hit = bad.status !== null && bad.status !== 0 && /用法错误/.test(out);
      return {
        hit,
        verdict: hit
          ? `捕获（裸位置参数 exit=${bad.status}，一行说明：${first}）`
          : `**存活**（期望非 0 + 一行用法说明；实际 exit=${bad.status} 首行「${first || '无输出'}」——`
            + '裸路径被静默忽略就是校验对象错位）',
      };
    },
  },
  {
    name: 'M26-「--file <路径>」正向防误伤（同一份清单以 --file 传入必须照常校验并 exit 0：'
      + 'fail-loud 若顺手把合法形态也拦掉，就把门禁换成了死闸，与「谓词永远红」同一种失效）',
    expect: 'CLI-OK',
    run({ target }) {
      const ok = runSelf(['--file', target]);
      const out = `${ok.stdout ?? ''}${ok.stderr ?? ''}`.trim();
      const hit = ok.status === 0 && /结论：绿/.test(out);
      return {
        hit,
        verdict: hit
          ? `捕获（--file 正常工作：exit=0，输出「${out.split('\n').pop()}」）`
          : `**存活**（期望 --file 正常 exit 0；实际 exit=${ok.status} 输出「${out.split('\n').slice(0, 2).join(' / ') || '无输出'}」）`,
      };
    },
  },
  // ——— 专题⑤（2026-11-01）冻结分层族：A/B 两层判据的常驻守卫 ———
  // 分层把「B 层的 open/assigned」移出终局阻塞面，等于**新开了一条降级洗白路**：
  // 「这条不算冻结阻塞」一旦可以随口宣称，清单清零就重新变成可实现的目标（正是判据件 §1 过松的一端）。
  // 所以这条新通道开通的同一轮，就给它配常驻守卫：缺字段、取值漂移、无留痕降级、
  // **带真锚的整体降级**（谓词面）、以及正向防死闸（A 层全闭 + B 层仍开放必须判绿）。
  {
    name: 'M27-分层字段缺失（把 G1-TIME-01 的 freeze_tier 整行摘掉：缺失若被缺省成 A，既有清单形态'
      + '突然全红（误伤闸）；被缺省成 B 就直接把冻结面腾空（洗白闸）——两头都不许发生，只能点名）',
    expect: 'FREEZE-TIER',
    apply(text) {
      const parts = text.split(/(?=^  - id: )/m);
      let touched = false;
      const out = parts.map((c) => {
        if (!touched && /^  - id: G1-TIME-01$/m.test(c)) {
          touched = true;
          return c.replace(/^ {4}freeze_tier: "A"\n/m, '');
        }
        return c;
      }).join('');
      if (!touched || out === text) throw new Error('变异未生效：找不到 G1-TIME-01 的 freeze_tier 行');
      return out;
    },
  },
  {
    name: 'M28-分层取值漂移（G1-TIME-01 的 freeze_tier 写成「C」：分层是判据面不是自由文本，'
      + '词表外的取值既不属 A 也不属 B，必须点名而不是替调用者挑一个默认层）',
    expect: 'FREEZE-TIER',
    apply(text) {
      const parts = text.split(/(?=^  - id: )/m);
      let touched = false;
      const out = parts.map((c) => {
        if (!touched && /^  - id: G1-TIME-01$/m.test(c)) {
          touched = true;
          return c.replace(/^ {4}freeze_tier: "A"$/m, '    freeze_tier: "C"');
        }
        return c;
      }).join('');
      if (!touched || out === text) throw new Error('变异未生效：改不动 G1-TIME-01 的 freeze_tier 行');
      return out;
    },
  },
  {
    name: 'M29-降级无留痕（把 A 层的 freeze_tier 全改成 B 且不补 tier_basis：「这条不算冻结阻塞」'
      + '若是随口宣称，清单清零立刻重新变成可实现的目标——判据件 §1 过松的那一端）',
    expect: 'FREEZE-TIER-BASIS',
    apply(text) {
      const out = text.replace(/^ {4}freeze_tier: "A"$/gm, '    freeze_tier: "B"');
      const n = (out.match(/^ {4}freeze_tier: "B"$/gm) ?? []).length;
      if (n <= 7) throw new Error(`变异未生效：降级条数 ${n} 未覆盖 A 层面（期望 > 7）`);
      return out;
    },
  },
  {
    name: 'M30-整体降级且**带真锚留痕**（谓词型，最硬的一条：全部 A→B + 每条补一条真实在盘的 '
      + 'tier_basis 锚 + owner 全部伪装成有主 ⇒ 违规面全过、unassigned 归零，「A 层全闭」成了真空真。'
      + '此时唯一还拦得住的是谓词里的「A 层非空」项——它必须独立成立，且红因必须点名到 A 层被抽空）',
    expect: 'TIER-WASH',
    apply(text) {
      let t = text.replace(/^ {4}freeze_tier: "A"$/gm, '    freeze_tier: "B"');
      // 每条缺 tier_basis 的 B 层条目补一条**真锚**（g1/G1-FREEZE-CRITERIA.md 实测在盘）：
      // 真值段不得成为红因，否则这条变异验的是锚点校验，不是谓词。
      t = t.split(/(?=^  - id: )/m).map((c) =>
        (/^ {4}freeze_tier: "B"$/m.test(c) && !/^ {4}tier_basis: /m.test(c)
          ? c.replace(/^ {4}freeze_tier: "B"\n/m,
              '    freeze_tier: "B"\n    tier_basis: "g1/G1-FREEZE-CRITERIA.md:1（变异夹具：真实在盘的锚，用来证明红因不是假锚）"\n')
          : c)).join('');
      t = t.replace(/^    owner: "UNASSIGNED"$/gm, '    owner: "M30 变异：伪装权威归属"');
      const basisCount = (t.match(/^ {4}tier_basis: /gm) ?? []).length;
      if (basisCount <= 7) throw new Error(`变异未生效：补留痕条数 ${basisCount} 异常`);
      return t;
    },
  },
  {
    name: 'M31-B 层开放但已指名归属（正向防死闸：A 层全部关闭 + B 层仍是 open 且 owner 已指名 ⇒ '
      + '终局门必须判绿。没有正向条的分层判据就是死闸——「永远红」与「永远绿」是同一种失效；'
      + '它同时钉住「B 层免检完成、不免归属」这一刀在实现上没有反噬）',
    expect: 'TIER-CLEAR',
    apply(text) {
      const t = text.split(/(?=^  - id: )/m).map((c) => {
        if (!/^    status: open$/m.test(c)) return c;
        if (/^    freeze_tier: "A"$/m.test(c)) {
          let d = c.replace(/^    status: open$/m,
            '    status: done\n    resolution: "形合文本：经审查已解决（正向夹具）"');
          if (/^    evidence: .*$/m.test(d))
            d = d.replace(/^    evidence: .*$/m, '    evidence: "g1/G1-FREEZE-CRITERIA.md:1（正向夹具锚）"');
          else
            d = d.replace(/^  - id: (G1-[A-Z0-9-]+)\n/, '  - id: $1\n    evidence: "g1/G1-FREEZE-CRITERIA.md:1（正向夹具锚）"\n');
          return d.replace(/^    owner: "UNASSIGNED"$/m, '    owner: "Q40（正向夹具）"');
        }
        // B 层：刻意**保持 open**（这就是「B 层开放不阻塞冻结」的正面形态），只把归属补齐
        return c.replace(/^    owner: "UNASSIGNED"$/m, '    owner: "Q40（正向夹具：B 层已指名）"');
      }).join('');
      if (!/^    status: open$/m.test(t)) throw new Error('变异失效：B 层没有留下 open 条目，正向面根本没被检验');
      if (/^    owner: "UNASSIGNED"$/m.test(t)) throw new Error('变异失效：仍有条目无归属，正向面根本没被检验');
      return t;
    },
  },
];

// ---------- 命令行参数解析（第八轮改为 fail-loud） ----------
// 旧实现只 `includes`/`indexOf` 自己认得的三个 flag，**其余参数静默忽略**。后果不是「报得难看」
// 而是**判错对象**：`node g1-checklist-validate.mjs 某清单.yaml` 里的路径被丢掉，脚本转去校验
// **默认主清单**并 exit 0——调用者以为绿的是自己指定的那份。这类「静默换个对象变绿」比红危险
// 得多（与本文件「不许把未验证的东西报成绿」同一条底线），故现在：未知参数 / 裸位置参数 /
// flag 缺值 / flag 重复 ⇒ 打印一行说明 + exit 2（沿用 --max-open 非法值既有的用法错误码）。
const USAGE = '用法：node g1-checklist-validate.mjs [--file <清单路径>] [--require-clear] [--max-open <N>] [--self-test]';
function failUsage(why) {
  console.log(`用法错误：${why}——静默忽略参数会让人以为校验的是自己指定的清单（${USAGE}）`);
  process.exit(2);
}
function parseArgs(argv) {
  const out = { selfTest: false, requireClear: false, maxOpen: null, file: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--self-test':
        if (out.selfTest) failUsage('「--self-test」重复给出');
        out.selfTest = true;
        break;
      case '--require-clear':
        if (out.requireClear) failUsage('「--require-clear」重复给出');
        out.requireClear = true;
        break;
      case '--max-open': {
        if (out.maxOpen !== null) failUsage('「--max-open」重复给出');
        const v = argv[i + 1];
        if (v === undefined || v.startsWith('--')) failUsage('「--max-open」缺少参数值（须为非负整数）');
        if (!Number.isInteger(Number(v)) || Number(v) < 0) failUsage(`「--max-open」需要非负整数，收到「${v}」`);
        out.maxOpen = Number(v);
        i++;
        break;
      }
      case '--file': {
        if (out.file !== null) failUsage('「--file」重复给出（两份清单要分两次跑，别指望一次验两份）');
        const v = argv[i + 1];
        if (v === undefined || v.startsWith('--')) failUsage('「--file」缺少参数值（须为清单路径）');
        out.file = resolve(v);
        i++;
        break;
      }
      default:
        if (a.startsWith('-'))
          failUsage(`未知参数「${a}」（只认 --file / --require-clear / --max-open / --self-test；新 flag 须先改进本解析器）`);
        else
          failUsage(`不接受裸位置参数「${a}」，指定清单请写「--file ${a}」`);
    }
  }
  return out;
}

// CLI 型变体的执行器（M25/M26）：用当前 node 跑**本文件自身**——判据是真实退出码与输出文本，
// 这正是「校验器作为命令行门禁」的对外契约面，进程内 validate() 摸不到。子进程不带 --self-test
// ⇒ 不会递归。
const SELF_PATH = fileURLToPath(import.meta.url);
function runSelf(args) {
  return spawnSync(process.execPath, [SELF_PATH, ...args], { encoding: 'utf8', cwd: HERE });
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { selfTest, requireClear, maxOpen } = opts;
  const target = opts.file ?? DEFAULT_CHECKLIST;

  const text = readFileSync(target, 'utf8');

  if (selfTest) {
    // 自验先证「主清单此刻是绿的」——否则变异红可能只是基线本来红，证明不了任何事。
    const base = validate(text, target);
    console.log(`主清单基线：违规 ${base.violations.length} 条`);
    if (base.violations.length > 0) {
      for (const v of base.violations) console.log(`  违规 [${v.rule}] id=${v.id} 行${v.line}: ${v.why}`);
      console.log('SELF-TEST ABORT：主清单不绿时变异自验无意义（先修基线）。');
      process.exit(1);
    }
    let failed = 0;
    for (const mu of MUTANTS) {
      let verdict;
      try {
        // CLI 型变体（M25/M26）判的是进程行为（退出码 + 输出），validate() 摸不到，故由 run()
        // 自跑子进程自报命中；文本型变体走原路。
        if (typeof mu.run === 'function') {
          const r = mu.run({ target, text });
          if (!r.hit) failed++;
          console.log(`${mu.name}\n  ⇒ ${r.verdict}`);
          continue;
        }
        const mutated = mu.apply(text);
        const res = validate(mutated, target);
        let hit;
        if (mu.expect === 'REVIEW-DATE-RED' || mu.expect === 'REVIEW-DATE-GREEN') {
          // 第八轮日期族：判据在**谓词面**（人工确认门只作用于 --require-clear），不在 violations 里。
          const r = (mu.expect === 'REVIEW-DATE-RED' ? dateRedCheck : dateGreenCheck)(mu)(res);
          hit = r.hit;
          verdict = r.verdict;
        } else if (mu.expect === 'CLEAR') {
          // 正向形状：**只有**违规==0 且终局谓词真绿才算捕获——谓词在合法全清形态上必须放行，
          // 否则门禁成死闸（「永远红」与「永远绿」是同一种失效）。
          // 专题⑤起读**同一个** clearBlockers()：自验与主流程不许各持一份谓词副本。
          const blockers = clearBlockers(res.counts);
          hit = res.violations.length === 0 && blockers.length === 0;
          verdict = hit
            ? `捕获（全清形态下 --require-clear 判绿：items=${res.counts.items} done=${res.counts.done} 违规=0）`
            : `**存活**（期望全清判绿；实际违规=${res.violations.length} `
              + `计数=${res.counts ? JSON.stringify(res.counts) : '解析失败'}`
              + `阻塞=[${blockers.join(' ｜ ') || '无'}]`
              + `${res.violations.length ? ` 首条=[${res.violations[0].id}] ${res.violations[0].why}` : ''}）`;
        } else if (mu.expect === 'PREDICATE') {
          // 谓词型变异：**只有**在「日常判据无违规」前提下 --require-clear 仍红才算捕获。
          // 若它同时制造了违规，红就是违规挡的，谓词有没有洞根本没被检验——错误原因通过。
          const blockers = clearBlockers(res.counts);
          hit = res.violations.length === 0 && res.counts !== null && blockers.length > 0;
          verdict = hit
            ? `捕获（违规=0 前提下 --require-clear 判红：open=${res.counts.open} assigned=${res.counts.assigned} unassigned=${res.counts.unassigned} superseded_unreviewed=${res.counts.supersededUnreviewed}）`
              + `｜阻塞=${blockers.join(' ｜ ')}`
            : `**存活**（期望违规=0 且谓词红；实际违规=${res.violations.length} `
              + `计数=${res.counts ? JSON.stringify(res.counts) : '解析失败'}）`;
        } else if (mu.expect === 'TIER-WASH') {
          // 分层洗白的谓词面专项（M30）：违规必须为 0——否则红是规则挡的，谓词的洞没被检验；
          // 且红因必须**点名到「A 层被抽空」**，靠别的面红不算捕获（错误原因通过）。
          const blockers = clearBlockers(res.counts);
          const named = blockers.find((b) => /A 层条目数 = 0/.test(b));
          hit = res.violations.length === 0 && res.counts !== null && named !== undefined;
          verdict = hit
            ? `捕获（违规=0、unassigned=${res.counts.unassigned}、B 层 items=${res.counts.tierB.items} 全降级之后，`
              + `终局门仍因「A 层被抽空」判红）｜阻塞=${blockers.join(' ｜ ')}`
            : `**存活**（期望违规=0 且红因点名「A 层条目数 = 0」；实际违规=${res.violations.length} `
              + `计数=${res.counts ? JSON.stringify(res.counts) : '解析失败'} 阻塞=[${blockers.join(' ｜ ') || '无'}]）`;
        } else if (mu.expect === 'TIER-CLEAR') {
          // 正向防死闸（M31）：A 层全闭 + **B 层仍 open 但已指名归属** ⇒ 谓词必须判绿，
          // 且必须**真的**留有 B 层 open 条目（否则这条变异什么都没验——空转的正向条等于没有正向条）。
          const blockers = clearBlockers(res.counts);
          hit = res.violations.length === 0 && res.counts !== null
            && blockers.length === 0 && res.counts.tierB.open > 0 && res.counts.tierB.unowned === 0;
          verdict = hit
            ? `捕获（A 层 items=${res.counts.tierA.items} 全闭、B 层 open=${res.counts.tierB.items === 0 ? 0 : res.counts.tierB.open} 条仍开放`
              + ` 且归属齐 ⇒ --require-clear 判绿；全局 open=${res.counts.open} 证明「清零」不再是冻结前置）`
            : `**存活**（期望违规=0、B 层有开放条目且无缺席归属、谓词绿；实际违规=${res.violations.length} `
              + `计数=${res.counts ? JSON.stringify(res.counts) : '解析失败'} 阻塞=[${blockers.join(' ｜ ') || '无'}]`
              + `${res.violations.length ? ` 首条=[${res.violations[0].id}] ${res.violations[0].why}` : ''}）`;
        } else if (mu.expect === 'CLEAN') {
          // 真值正向型（M20）：done + **真提交 + 真路径**必须判绿——真值校验不得变成只会被动的
          // 误伤闸；「假锚红、真锚绿」两侧都有常驻变异，判据才不是单向的。
          hit = res.violations.length === 0;
          verdict = hit
            ? '捕获（真提交+真路径判绿：违规=0，真值段不误伤）'
            : `**存活**（期望违规=0；实际违规=${res.violations.length} 首条=[${res.violations[0].id}] ${res.violations[0].why}）`;
        } else {
          // expect 允许单规则或规则数组（数组=每条都必须命中——M17 的「禁止字段+缺继任」双红，
          // 只命中其一都是错误原因通过）。
          const rules = Array.isArray(mu.expect) ? mu.expect : [mu.expect];
          const hits = rules.map((r) => res.violations.filter((v) => v.rule === r));
          hit = hits.every((h) => h.length > 0);
          // 具体形态必须随条数一并入输出（父席指令：别只报条数）——首条命中逐字打出来。
          const shape = rules.map((r, i) => `${r} ×${hits[i].length}`).join(' + ');
          verdict = hit
            ? `捕获（${shape}）｜首条：[${hits[0][0].id}] 行${hits[0][0].line} ${hits[0][0].why}`
              + (hits[0].length > 1 ? `｜末条：[${hits[0][hits[0].length - 1].id}] 行${hits[0][hits[0].length - 1].line}` : '')
            : `**存活**（期望 ${rules.join('+')}，缺=[${rules.filter((r, i) => hits[i].length === 0).join(',')}] `
              + `实际规则=${[...new Set(res.violations.map((v) => v.rule))].join(',') || '无违规'}）`;
        }
        if (!hit) failed++;
      } catch (e) {
        verdict = `**存活**（变异构造失败：${e.message}）`;
        failed++;
      }
      console.log(`${mu.name}\n  ⇒ ${verdict}`);
    }
    console.log(failed === 0 ? `变异自验：${MUTANTS.length}/${MUTANTS.length} 全部捕获。` : `变异自验：${failed} 个变异存活 ⇒ 校验器失效。`);
    process.exit(failed === 0 ? 0 : 1);
  }

  const { violations, counts, unreviewedDetail } = validate(text, target);
  if (violations.length > 0) {
    for (const v of violations) console.log(`违规 [${v.rule}] id=${v.id} 行${v.line}: ${v.why}`);
  }
  if (counts) {
    console.log(`计数 items=${counts.items} open=${counts.open} assigned=${counts.assigned} `
      + `done=${counts.done} superseded=${counts.superseded} unassigned=${counts.unassigned} `
      + `superseded_unreviewed=${counts.supersededUnreviewed} 违规=${violations.length}`);
    // 分层计数行（专题⑤新增；上面那行**逐字保留**，矩阵/计划引用的旧口径不受影响）：
    // A 层 = 冻结前置；B 层 = 实施义务（open 不阻塞，unowned 阻塞）。
    console.log(`分层 A：items=${counts.tierA.items} open=${counts.tierA.open} assigned=${counts.tierA.assigned} `
      + `done=${counts.tierA.done} superseded=${counts.tierA.superseded} `
      + `superseded_unreviewed=${counts.tierA.supersededUnreviewed} ｜ `
      + `B：items=${counts.tierB.items} open=${counts.tierB.open} assigned=${counts.tierB.assigned} `
      + `done=${counts.tierB.done} superseded=${counts.tierB.superseded} unowned=${counts.tierB.unowned}`);
  }
  // 终局放行谓词（第六轮改写，G1 门禁 P1 的修复点；第七轮补 superseded 人工确认门；
  // 专题⑤ 2026-11-01 改两层口径：`open`/`assigned` 的阻塞面收窄到 A 层，其余四项一字未动，
  // 并新增「A 层非空」。判据全文 = clearBlockers() 的注释 + g1/G1-FREEZE-CRITERIA.md §6。
  // 链合法性与替代载荷仍由 SUPERSEDED-CHAIN / SUPERSESSION-REASON / SUPERSESSION-EVIDENCE
  // 违规在上方判红，谓词只在 违规==0 的前提下数剩余面。）
  if (requireClear && counts && (violations.length !== 0 || clearBlockers(counts).length !== 0)) {
    const blockers = clearBlockers(counts);
    console.log('G1 终局放行谓词未满足（NO-GO 阶段的预期红，见头注语义说明与 g1/G1-FREEZE-CRITERIA.md）：'
      + `A 层未闭合 open=${counts.tierA.open}、assigned=${counts.tierA.assigned}（期望均为 0——A 层是冻结前置；`
      + 'assigned 是推进态不是终局态，「有人认领」不放行）；'
      + `A 层条目数=${counts.tierA.items}（=0 即分层被抽空，同样不放行）；owner=UNASSIGNED `
      + `${counts.unassigned}（期望 0——含 B 层，B 层免检的是完成、不免归属）；`
      + `superseded 未经人工确认 ${counts.supersededUnreviewed} 条（期望 0——终局面上 superseded 需合法 `
      + 'supersession_review 且审查者≠owner，「被替代」不是免检通道）；'
      + `违规=${violations.length} 条（期望 0——含 DONE-RESOLUTION/SUPERSEDED-CHAIN/SUPERSESSION-REASON/`
      + 'SUPERSESSION-EVIDENCE/FREEZE-TIER/FREEZE-TIER-BASIS，done 三件套、继任链闭合、替代载荷与分层标注都在此闸）');
    for (const b of blockers) console.log(`  阻塞项：${b}`);
    for (const d of unreviewedDetail) console.log(`  未经确认的 superseded：${d}`);
    process.exit(1);
  }
  if (maxOpen !== null && counts && counts.open > maxOpen) {
    console.log(`进度护栏未满足：open=${counts.open} > 允许上限 ${maxOpen}`);
    process.exit(1);
  }
  if (violations.length > 0) {
    console.log(`结论：红（${violations.length} 条违规）。`);
    process.exit(1);
  }
  console.log('结论：绿（结构/语义校验无违规）。');
  process.exit(0);
}

main();
