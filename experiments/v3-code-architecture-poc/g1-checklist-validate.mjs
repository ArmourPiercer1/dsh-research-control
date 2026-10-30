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
 *   - `SUPERSEDES-EXISTS` supersedes 指向的 id 必须存在、不得指向自己
 *   - `SUPERSEDED-TARGET` status=superseded 必须给出 supersedes
 *   - `UNKNOWN-FIELD`   条目字段封闭集之外 = 红（防漂移：新字段先改校验器再进清单）
 *   - `UNKNOWN-TOP`     顶层键封闭集之外 = 红
 *   - `SCHEMA-VERSION`  schema_version 必须是 1
 *   - `PLAN-PATH`       plan 指向的文件必须真实存在（对账对象不许是幽灵路径）
 *   - `PARSE`           YAML 子集解析失败 = 红
 *
 * 已知边界（如实，不做超出裁定的事）：
 *   - 「id 不复用」只能靠 git diff 评审（删除条目会显示在 diff 里）；「不重排语义」同理。
 *   - `owner` 必须是「Q 编号 / 裁定提交 / 用户指令」这条仍是**人工判据**（自由文本无法
 *     机验语义），本文书 §2-G1 保留该人工条款；校验器只判非空 / 非 UNASSIGNED。
 *
 * 用法与谓词语义（写死，别让下一个读者猜——父代理 2026-10-31 点名的三态澄清）：
 *   node g1-checklist-validate.mjs
 *       日常机验：违规==0 即绿。**这是常驻门禁跑的形态**（READINESS.md §5）。
 *   node g1-checklist-validate.mjs --require-clear
 *       G1 **放行谓词**：违规==0 且 open==0 且 unassigned==0。G1 未完成阶段它红是
 *       **预期状态**（G1 NO-GO），不是判据坏死——所以它进 §2-G1 放行判据，不进日常门。
 *   node g1-checklist-validate.mjs --max-open <N>
 *       进度护栏：违规==0 且 open<=N。评审期可断言「open 面不扩大」，不要求清零。
 *   node g1-checklist-validate.mjs --self-test      # 变异自验（架空而非删除，见 MUTANTS）
 *   node g1-checklist-validate.mjs --file <path>    # 指定清单路径（自验与排查用）
 *
 * 为什么不存在「清单永远不可能 clear」的死判据：**open 不要求 UNASSIGNED**——
 * UNASSIGNED 只是 open 条目**被允许**的取值，任何状态都可以（也应该）指名 owner；而
 * OWNER-RULE 禁止非 open 条目挂 UNASSIGNED。⇒ 放行路径 = 先 assign 再关闭，两个谓词
 * 可同时满足。--require-clear 里的 unassigned==0 在 open==0 时本是 OWNER-RULE 的推论，
 * 仍显式保留 = 纵深（规则将来被放宽时，放行谓词不会静默跟着松）。
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
    i++;
    if (rest.trim() !== '') {
      top[key] = { value: parseScalar(rest, L.no, `顶层 ${key}`), line: L.no };
      continue;
    }
    if (key !== 'items') throw new ParseError(L.no, `顶层键 ${key}: 打开块但子集只允许 items: 打开块`);
    // items 列表：条目从缩进 >0 的「- …」行开始
    while (i < lines.length && lines[i].indent > 0 && lines[i].body.startsWith('- ')) {
      const itemIndent = lines[i].indent;
      const item = { __line: lines[i].no, __fields: [] };
      const first = lines[i].body.slice(2);
      const fm = KEY_RE.exec(first);
      if (!fm) throw new ParseError(lines[i].no, 'items 条目必须以「- key: value」开始');
      item.__fields.push({ key: fm[1], value: parseScalar(fm[2], lines[i].no, `条目 ${fm[1]}`), line: lines[i].no, list: null });
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
          item.__fields.push({ key: fkey, value: parseScalar(fRest, f.no, `${item.__fields[0].value || '?'} 的 ${fkey}`), line: f.no, list: null });
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
        item.__fields.push({ key: fkey, value: list, line: f.no, list });
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

  let unassigned = 0;
  let open = 0;
  let done = 0;
  for (const it of items) {
    const g = (k) => it.__fields.find((x) => x.key === k)?.value;
    const st = typeof g('status') === 'string' ? g('status') : '';
    if (st === 'open') open++;
    if (st === 'done') done++;
    if (typeof g('owner') === 'string' && g('owner').trim() === 'UNASSIGNED') unassigned++;
  }
  return { violations, counts: { items: items.length, open, done, unassigned }, parsed };
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
        const hit = res.violations.some((v) => v.rule === mu.expect);
        verdict = hit
          ? `捕获（${mu.expect} ×${res.violations.filter((v) => v.rule === mu.expect).length}）`
          : `**存活**（期望 ${mu.expect}，实际规则=${[...new Set(res.violations.map((v) => v.rule))].join(',') || '无违规'}）`;
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
    console.log(`计数 items=${counts.items} open=${counts.open} done=${counts.done} unassigned=${counts.unassigned} 违规=${violations.length}`);
  }
  if (requireClear && counts && (counts.open !== 0 || counts.unassigned !== 0)) {
    console.log(`G1 放行谓词未满足（NO-GO 阶段的预期红，见头注语义说明）：open=${counts.open}（期望 0），owner=UNASSIGNED ${counts.unassigned}（期望 0）`);
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
