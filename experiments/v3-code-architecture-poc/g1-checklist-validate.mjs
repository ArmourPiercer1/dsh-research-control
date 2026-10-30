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
 *   - `DONE-RESOLUTION` **done 必须有非空 resolution**（第六轮裁定：关闭态三件套
 *                       = 权威 owner + 可定位 evidence + 明确 resolution，缺一即红。
 *                       owner 的「权威」语义仍是人工判据，见「已知边界」）
 *   - `SUPERSEDES-EXISTS` supersedes 指向的 id 必须存在、不得指向自己
 *   - `SUPERSEDED-TARGET` status=superseded 必须给出 supersedes
 *   - `SUPERSEDED-CHAIN` **superseded 链必须最终到达 done**（第六轮裁定：防「superseded 环」
 *                       与「指向 open 的甩锅链」——链上每步 supersedes 都必须可解析，
 *                       成环或终点非 done ⇒ 红）
 *   - `UNKNOWN-FIELD`   条目字段封闭集之外 = 红（防漂移：新字段先改校验器再进清单）
 *   - `UNKNOWN-TOP`     顶层键封闭集之外 = 红
 *   - `SCHEMA-VERSION`  schema_version 必须是 1
 *   - `PLAN-PATH`       plan 指向的文件必须真实存在（对账对象不许是幽灵路径）
 *   - `PARSE`           YAML 子集解析失败 = 红；**同一条目/同一顶层的重复字段也在解析期直接
 *                       红**（第六轮裁定点名的「两个判据看到不同事实」缺陷：旧实现里
 *                       语义校验用最后一次赋值、计数统计用 find() 取第一次 ⇒ 一条条目
 *                       可以同时「被验证为 done」而「被统计为 open」。修在解析期是唯一
 *                       不引入「哪个赋值算数」新裁量的位置；自验 M11 钉死该形态）
 *
 * 已知边界（如实，不做超出裁定的事）：
 *   - 「id 不复用」只能靠 git diff 评审（删除条目会显示在 diff 里）；「不重排语义」同理。
 *   - `owner` 必须是「Q 编号 / 裁定提交 / 用户指令」这条仍是**人工判据**（自由文本无法
 *     机验语义），本文书 §2-G1 保留该人工条款；校验器只判非空 / 非 UNASSIGNED。
 *
 * 用法与谓词语义（写死，别让下一个读者猜——父代理 2026-10-31 点名的三态澄清；
 * **第六轮修订**，外部复审点名 G1 门禁 P1：旧 `--require-clear` 数的是 open/unassigned，
 * 把全部条目改成 `assigned` + 非空 owner 就能「清零」放行——推进态冒充终局态）：
 *   node g1-checklist-validate.mjs
 *       日常机验：违规==0 即绿。**这是常驻门禁跑的形态**（READINESS.md §5）。
 *       `assigned` 在日常形态**允许存在**——它是有主的推进态，不是违规。
 *   node g1-checklist-validate.mjs --require-clear
 *       G1 **终局放行谓词**（第六轮改写）：违规==0 且 **所有有效工作项均为 done，
 *       或为 supersedes 链最终到达 done 的 superseded**。`open` 与 `assigned` 一律不放行
 *       ——「有人认领了」不等于「裁定落地了」；done 的三件套（权威 owner / 可定位
 *       evidence / 明确 resolution）由 DONE-EVIDENCE、DONE-RESOLUTION、OWNER-RULE
 *       三条规则兜住，谓词只判剩余面。
 *       G1 未完成阶段它红是**预期状态**（G1 NO-GO），不是判据坏死——所以它进 §2-G1
 *       放行判据，不进日常门。
 *   node g1-checklist-validate.mjs --max-open <N>
 *       进度护栏：违规==0 且 open<=N。评审期可断言「open 面不扩大」，不要求清零。
 *   node g1-checklist-validate.mjs --self-test      # 变异自验（架空而非删除，见 MUTANTS）
 *   node g1-checklist-validate.mjs --file <path>    # 指定清单路径（自验与排查用）
 *
 * 为什么不存在「清单永远不可能 clear」的死判据：**open 不要求 UNASSIGNED**——
 * UNASSIGNED 只是 open 条目**被允许**的取值，任何状态都可以（也应该）指名 owner；而
 * OWNER-RULE 禁止非 open 条目挂 UNASSIGNED。⇒ 放行路径 = assign 之后逐条关闭（done
 * 三件套或合法 superseded 链），推进与放行两个谓词可同时满足。--require-clear 里的
 * unassigned==0 在所有项关闭时本是 OWNER-RULE 的推论，仍显式保留 = 纵深（规则将来被
 * 放宽时，放行谓词不会静默跟着松）。
 * 退出码：0 无违规（且给定谓词满足）；1 任何违规 / 谓词未满足 / 变异未被捕获。
 */
import { readFileSync, existsSync } from 'node:fs';
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
const ITEM_KEYS = new Set(['id', 'topic', 'spec', 'sources', 'owner', 'status', 'evidence', 'resolution', 'supersedes']);
const STATUSES = new Set(['open', 'assigned', 'done', 'superseded']);
const ID_RE = /^G1-[A-Z][A-Z0-9]*-\d{2}$/;
// 可定位锚点：git 提交号（7–40 位十六进制）或带扩展名的文件路径（可带 :行号）。
const COMMIT_RE = /\b[0-9a-f]{7,40}\b/;
const FILE_RE = /[\w./-]+\.(?:md|ts|tsx|mjs|cjs|json|ya?ml|sql|db|jsonl)\b/i;

function validate(text, checklistPath) {
  const violations = [];
  const V = (rule, id, line, why) => violations.push({ rule, id, line, why });
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
      if (!ITEM_KEYS.has(fl.key)) V('UNKNOWN-FIELD', String(f.id?.value ?? '-'), fl.line, `未知字段「${fl.key}」——新字段须先进校验器封闭集再进清单`);
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
      // 第六轮裁定：done 三件套 = 权威 owner（OWNER-RULE 判非空/非 UNASSIGNED，权威性仍人工）
      // + 可定位 evidence（DONE-EVIDENCE）+ 明确 resolution（本条）。「已解决」不含
      // 「谁让位、依据什么」= 结论词自我声明，GT 系列的同款教训。
      const resv = f.resolution ? (typeof f.resolution.value === 'string' ? f.resolution.value.trim() : '') : null;
      if (!f.resolution)
        V('DONE-RESOLUTION', id, line, 'status=done 但没有 resolution——关闭三件套缺一：明确「谁让位、依据什么」不在载荷里，不许只留结论');
      else if (resv === '')
        V('DONE-RESOLUTION', id, f.resolution.line, 'resolution 是空占位');
    }

    const supRaw = f.supersedes ? f.supersedes.value : null;
    const supTargets = supRaw === null ? [] : Array.isArray(supRaw) ? supRaw : [supRaw];
    if (supTargets.length > 0) {
      const allIds = new Set(items.map((o) => { const v = o.__fields.find((x) => x.key === 'id')?.value; return typeof v === 'string' ? v : '-'; }));
      for (const sup of supTargets) {
        if (sup === id) V('SUPERSEDES-EXISTS', id, f.supersedes.line, 'supersedes 指向自己');
        else if (!allIds.has(sup)) V('SUPERSEDES-EXISTS', id, f.supersedes.line, `supersedes 指向不存在的 id「${sup}」`);
      }
    }
    if (status === 'superseded' && supTargets.length === 0)
      V('SUPERSEDED-TARGET', id, line, 'status=superseded 必须给出 supersedes（指向取代它的条目）');
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
    const line = fieldOf(it, 'supersedes')?.line ?? it.__line;
    const seen = new Set([id]);
    let cur = it;
    let curId = id;
    for (;;) {
      const sup = cur.__fields.find((x) => x.key === 'supersedes')?.value;
      // 缺 supersedes / 指自己 / 指向不存在 id：SUPERSEDED-TARGET / SUPERSEDES-EXISTS 已各自红，链判据不重复记。
      if (typeof sup !== 'string' || sup === '' || sup === curId) break;
      if (seen.has(sup)) {
        V('SUPERSEDED-CHAIN', id, line, `supersedes 链回到「${sup}」成环——继任链不许闭合，环里没有任何裁定落地`);
        break;
      }
      seen.add(sup);
      const nxt = byId.get(sup);
      if (!nxt) break; // 指向不存在 id：SUPERSEDES-EXISTS 已红
      const nst = fieldOf(nxt, 'status')?.value;
      if (nst === 'done') break;              // 到达已完成 ⇒ 链合法
      if (nst === 'superseded') { cur = nxt; curId = sup; continue; }
      V('SUPERSEDED-CHAIN', id, line,
        `supersedes 链终点「${sup}」status=「${typeof nst === 'string' ? nst : '缺失/非法'}」≠ done——superseded 必须由最终完成的条目继任（禁止指向 open/assigned 的甩锅链）`);
      break;
    }
  }

  let unassigned = 0;
  let open = 0;
  let assigned = 0;
  let done = 0;
  let superseded = 0;
  for (const it of items) {
    const g = (k) => it.__fields.find((x) => x.key === k)?.value;
    const st = typeof g('status') === 'string' ? g('status') : '';
    if (st === 'open') open++;
    else if (st === 'assigned') assigned++;
    else if (st === 'done') done++;
    else if (st === 'superseded') superseded++;
    if (typeof g('owner') === 'string' && g('owner').trim() === 'UNASSIGNED') unassigned++;
  }
  return { violations, counts: { items: items.length, open, assigned, done, superseded, unassigned }, parsed };
}

// ---------- 变异自验（架空，不是删除） ----------
// 每个变异都是在**真实清单文本**上做最小「洗白形」改写——仿照审查方会用来骗过校验器的
// 形态（关闭无证据、指向幽灵 id、塞未知字段、重号、旧词复活、空口关闭）。
// 判据：对应规则码必须出现 = 被捕获；任何一个变异活下来 ⇒ 校验器自身失效 = exit 1。
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
    name: 'M2-supersedes 指向不存在 id（新增一条形状完全合法的 superseded 条目）',
    expect: 'SUPERSEDES-EXISTS',
    apply(text) {
      return (
        text +
        '\n  - id: G1-MUTA-99\n' +
        '    topic: "变异夹具：指向幽灵 id 的取代声明"\n' +
        '    owner: "Q40"\n' +
        '    status: superseded\n' +
        '    evidence: "g1-checklist-validate.mjs"\n' +
        '    supersedes: "G1-NOPE-99"\n'
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
        '    status: superseded\n    supersedes: "G1-MUTA-91"\n' +
        '  - id: G1-MUTA-91\n    topic: "变异夹具：superseded 环 B 侧"\n    owner: "Q40"\n' +
        '    status: superseded\n    supersedes: "G1-MUTA-90"\n';
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
    name: 'M12-superseded 甩锅链（除 TIME-01 外全部 open→superseded 并统一 supersedes 指向'
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
          .replace(/^    status: open$/m, '    status: superseded\n    supersedes: "G1-TIME-01"')
          .replace(/^    owner: "UNASSIGNED"$/m, '    owner: "M12 变异：甩锅给 open 项"');
      }).join('');
      if (n === 0) throw new Error('变异未生效：清单里没有可甩的 open 条目');
      return out;
    },
  },
];

function main() {
  const argv = process.argv.slice(2);
  const selfTest = argv.includes('--self-test');
  const requireClear = argv.includes('--require-clear');
  const maxOpenIdx = argv.indexOf('--max-open');
  const maxOpen = maxOpenIdx >= 0 ? Number(argv[maxOpenIdx + 1]) : null;
  if (maxOpenIdx >= 0 && (!Number.isInteger(maxOpen) || maxOpen < 0)) {
    console.log(`--max-open 需要非负整数，收到「${argv[maxOpenIdx + 1]}」`);
    process.exit(2);
  }
  const fileIdx = argv.indexOf('--file');
  const target = fileIdx >= 0 ? resolve(argv[fileIdx + 1]) : DEFAULT_CHECKLIST;

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
        const mutated = mu.apply(text);
        const res = validate(mutated, target);
        let hit;
        if (mu.expect === 'CLEAR') {
          // 正向形状：**只有**违规==0 且终局谓词真绿才算捕获——谓词在合法全清形态上必须放行，
          // 否则门禁成死闸（「永远红」与「永远绿」是同一种失效）。
          hit = res.violations.length === 0 && res.counts !== null
            && res.counts.open === 0 && res.counts.assigned === 0 && res.counts.unassigned === 0;
          verdict = hit
            ? `捕获（全清形态下 --require-clear 判绿：items=${res.counts.items} done=${res.counts.done} 违规=0）`
            : `**存活**（期望全清判绿；实际违规=${res.violations.length} `
              + `计数=${res.counts ? JSON.stringify(res.counts) : '解析失败'}`
              + `${res.violations.length ? ` 首条=[${res.violations[0].id}] ${res.violations[0].why}` : ''}）`;
        } else if (mu.expect === 'PREDICATE') {
          // 谓词型变异：**只有**在「日常判据无违规」前提下 --require-clear 仍红才算捕获。
          // 若它同时制造了违规，红就是违规挡的，谓词有没有洞根本没被检验——错误原因通过。
          hit = res.violations.length === 0 && res.counts !== null
            && (res.counts.open !== 0 || res.counts.assigned !== 0 || res.counts.unassigned !== 0);
          verdict = hit
            ? `捕获（违规=0 前提下 --require-clear 判红：open=${res.counts.open} assigned=${res.counts.assigned} unassigned=${res.counts.unassigned}）`
            : `**存活**（期望违规=0 且谓词红；实际违规=${res.violations.length} `
              + `计数=${res.counts ? JSON.stringify(res.counts) : '解析失败'}）`;
        } else {
          const hits = res.violations.filter((v) => v.rule === mu.expect);
          hit = hits.length > 0;
          // 具体形态必须随条数一并入输出（父席指令：别只报条数）——首条命中逐字打出来。
          verdict = hit
            ? `捕获（${mu.expect} ×${hits.length}）｜首条：[${hits[0].id}] 行${hits[0].line} ${hits[0].why}`
              + (hits.length > 1 ? `｜末条：[${hits[hits.length - 1].id}] 行${hits[hits.length - 1].line}` : '')
            : `**存活**（期望 ${mu.expect}，实际规则=${[...new Set(res.violations.map((v) => v.rule))].join(',') || '无违规'}）`;
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

  const { violations, counts } = validate(text, target);
  if (violations.length > 0) {
    for (const v of violations) console.log(`违规 [${v.rule}] id=${v.id} 行${v.line}: ${v.why}`);
  }
  if (counts) {
    console.log(`计数 items=${counts.items} open=${counts.open} assigned=${counts.assigned} `
      + `done=${counts.done} superseded=${counts.superseded} unassigned=${counts.unassigned} 违规=${violations.length}`);
  }
  // 终局放行谓词（第六轮改写，G1 门禁 P1 的修复点）：open/assigned 都算「未了结」。
  // superseded 不在此重复走链——SUPERSEDED-CHAIN 违规已在上方把「环 / 终点非 done」判红，
  // 谓词只在 违规==0 的前提下数剩余面，链的合法性是它的已知前提。
  if (requireClear && counts
    && (violations.length !== 0 || counts.open !== 0 || counts.assigned !== 0 || counts.unassigned !== 0)) {
    console.log('G1 终局放行谓词未满足（NO-GO 阶段的预期红，见头注语义说明）：'
      + `未了结工作项 open=${counts.open}、assigned=${counts.assigned}（期望均为 0——assigned 是推进态不是终局态，`
      + '「有人认领」不放行）；owner=UNASSIGNED '
      + `${counts.unassigned}（期望 0）；违规=${violations.length} 条（期望 0——含 DONE-RESOLUTION/SUPERSEDED-CHAIN，`
      + 'done 三件套与继任链闭合都在此闸）');
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
