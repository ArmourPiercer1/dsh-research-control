#!/usr/bin/env node
/**
 * events-recon.mjs —— 机制事件名单 ↔ 写点 异源对账（EA-6.2 R1–R4）
 *
 * 判据来源：experiments/v3-code-architecture-poc/g1/G1-CONTRACT-EVENT-AUTHORITY.md §6.2
 *   R1 EVENT_RECON_ORPHAN     事实集 ⊄ 期望集：写点写了名单外的事件名
 *   R2 EVENT_RECON_STALE      期望集条目既无写点又非 planned:true
 *   R3 EVENT_RECON_SAMESOURCE 期望集来源不合规（只许读锚文件；不得从写点模块/MECHANISM_* 计算）
 *   R4 EVENT_RECON_COUPLING   名单语义行与写点模块同提交（git 单提交检查）
 *
 * 设计要点（R3 的自我约束）：
 *   - 期望集**只**从 ANCHOR_PATH 读取；脚本硬编码该路径，不 import 任何 src/** 模块。
 *   - 事实集由 TS Compiler API 扫描 --impl-root 下匹配 writeSites glob 的文件：
 *       a) 对象字面量属性 `eventType: '<lit>'`
 *       b) `insert into ledger` 的 SQL 语句所在调用里的事件名字面量（含 `.prepare(sql).run(...)` 形）
 *   - 二者都是「写点」形态；不解析 MECHANISM_AUDIT_EVENT_TYPES 之类的常量名单（那会退化成同源）。
 *
 * 用法：
 *   node scripts/events-recon.mjs [--impl-root DIR] [--anchor FILE] [--json]
 *   node scripts/events-recon.mjs --commit <sha>     # R4 单提交耦合检查（在 git 仓内运行）
 *   node scripts/events-recon.mjs --self-test        # 四条判据各配一条架空形，应各自非 0（返回 0 = 自验通过）
 *
 * 退出码：0 全绿；1 有判据红；2 用法/环境错误。
 */
import { existsSync, readFileSync, readdirSync, statSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
// TS 7（原生 Go 移植）不暴露 Compiler API；本仓已有 `typescript-6` 别名先例（N3 门 1）——
// 对账脚本用该别名取 AST，避免为了一个只读扫描把整个工具链钉回 TS 6。
import ts from 'typescript-6';

const REPO = resolve(import.meta.dirname, '..');
const ANCHOR_PATH = join(REPO, 'contracts/event-registry/EVENT-CONTRACT-LEDGER.json');
const NAME_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

/* ------------------------------------------------------------------ 期望集（只读锚文件） */

function loadExpected(anchorPath = ANCHOR_PATH) {
  const raw = readFileSync(anchorPath, 'utf8');
  const doc = JSON.parse(raw);
  if (typeof doc.schemaVersion !== 'number') throw new Error('锚文件缺 schemaVersion');
  if (!Array.isArray(doc.entries) || !Array.isArray(doc.approved)) throw new Error('锚文件缺 entries/approved 数组');
  const byName = new Map();
  for (const e of doc.entries) {
    if (!e || typeof e.eventType !== 'string') throw new Error('entries 条目缺 eventType');
    if (byName.has(e.eventType)) throw new Error(`entries 重复条目：${e.eventType}`);
    byName.set(e.eventType, e);
  }
  return { doc, byName, names: [...byName.keys()] };
}

/**
 * 批准三要素机验（EA-6.1「两处同现」的**文件侧**那一处；trailer 那一处在 `--commit` 里查）。
 *
 * 独立审查 P1-3 的修法：`anchor` 只当字符串后缀用过等于「谁都能自签」。这里要求：
 *   ① 非 legacy 锚 = 「仓内**已存在**文件路径 + `#<eventType>`」；
 *   ② 该文件里必须有 `Approved-By: <approvedOn> <approvedBy>` 原文行（日期/人逐字对齐条目）；
 *   ③ 该文件必须提到这个名字（覆盖关系不是凭空后缀）；
 *   ④ 批准者不得是实现者形态（`implementer`/`author`/`self` 等；④是**形态拦截**，真身份属人工面）。
 * legacy 锚（本仓无 `CONTRACTS.md` 的既有评审事实）走显式白名单，必须逐条写明理由。
 */
const LEGACY_ANCHOR_WHITELIST = new Map([
  ['legacy:C-19', {
    reason: 'C-19 既有评审事实（CONTRACTS.md §16.3 / D-27；该文件不在本仓，锚以事实标识字符串表达）',
    names: ['capability-enabled', 'capability-disabled', 'capability-transferred', 'object-registered', 'check-report-recorded'],
  }],
  ['legacy:EA-5.2', {
    reason: 'EA-5.2 存量升格就地（G1-CONTRACT-EVENT-AUTHORITY.md 表内批准事实）',
    names: ['object-revised', 'record-backfilled'],
  }],
]);
const APPROVER_DENY = /implementer|implementor|author|self|the-same/i;

function verifyApprovals(doc, repoRoot) {
  const approved = new Set();
  const problems = [];
  for (const a of doc.approved ?? []) {
    const anchor = String(a?.anchor ?? '');
    const by = String(a?.approvedBy ?? '').trim();
    const on = String(a?.approvedOn ?? '').trim();
    const m = /^(.+)#([a-z][a-z0-9]*(?:-[a-z0-9]+)*)$/.exec(anchor);
    if (!by || !on) { problems.push({ code: 'EVENT_RECON_UNPROVED', name: m?.[2] ?? anchor, msg: `批准记录缺 approvedBy/approvedOn：${anchor}` }); continue; }
    if (!m) { problems.push({ code: 'EVENT_RECON_UNPROVED', name: anchor, msg: `批准锚形状非法（须为 <路径或 legacy:id>#<eventType>）：${anchor}` }); continue; }
    const [, src, name] = m;
    if (APPROVER_DENY.test(by)) { problems.push({ code: 'EVENT_RECON_UNPROVED', name, msg: `批准者形态不可接受（${by}）：批准者必须是独立于实现者的人` }); continue; }
    if (src.startsWith('legacy:')) {
      const legacy = LEGACY_ANCHOR_WHITELIST.get(src);
      if (!legacy) { problems.push({ code: 'EVENT_RECON_UNPROVED', name, msg: `未登记的 legacy 锚：${src}（legacy 锚进显式白名单才有效）` }); continue; }
      // legacy 锚还必须绑定它**历史上覆盖的名字集**——否则白名单就成了「给任何新名自签」的通道
      if (!legacy.names.includes(name)) { problems.push({ code: 'EVENT_RECON_UNPROVED', name, msg: `legacy 锚 ${src} 不覆盖名字 ${name}（它只覆盖：${legacy.names.join('/')}）` }); continue; }
      approved.add(name); continue;
    }
    const abs = join(repoRoot, src);
    let text;
    try { text = readFileSync(abs, 'utf8'); } catch { problems.push({ code: 'EVENT_RECON_UNPROVED', name, msg: `批准锚指向的文件不存在：${src}` }); continue; }
    const line = `Approved-By: ${on} ${by}`;
    // 签名块：fenced code block（```…```）**且**块内含逐字 `Approved-By: <日期> <批准人>` 行。
    // 只认块内逐名出现——「文书里别处提到该名 + 挡了另一个名字的签字行」不算批准
    // （第二轮复审：`ns-relocated` 被文书明确写「不入本批」，却能被这种拼法签上）。
    const blocks = [...text.matchAll(/```[\s\S]*?```/g)].map((m) => m[0]).filter((b) => b.includes(line));
    if (blocks.length === 0) {
      problems.push({ code: 'EVENT_RECON_UNPROVED', name, msg: `${src} 里没有含逐字批准行「${line}」的签名块——锚与签字须同源` });
      continue;
    }
    const nameInBlock = blocks.some((b) => new RegExp(`(^|[^a-z0-9-])${name}([^a-z0-9-]|$)`, 'm').test(b));
    if (!nameInBlock) {
      problems.push({ code: 'EVENT_RECON_UNPROVED', name, msg: `${src} 的签名块内没有逐名列出 ${name}——「文书里别处提到过」不等于批准了它` });
      continue;
    }
    approved.add(name);
  }
  return { approved, problems };
}

/* ------------------------------------------------------------------ 事实集（TS AST 扫描） */

function walkFiles(root, globs) {
  const out = [];
  const norm = (p) => p.split(sep).join('/');
  const toRe = (g) => new RegExp('^' + norm(g)
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*') + '$');
  const res = globs.map(toRe);
  // 只遍历 glob 的静态前缀目录（`src/kernel/**` → `src/kernel`），避免扫全仓/穿到符号链接
  const bases = [...new Set(globs.map((g) => {
    const i = g.indexOf('*');
    const head = i < 0 ? g : g.slice(0, i);
    return join(root, head.endsWith('/') ? head : head.replace(/[^/]*$/, ''));
  }))];
  const seen = new Set();
  const visit = (dir) => {
    if (seen.has(dir)) return;
    seen.add(dir);
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    for (const name of entries) {
      if (name === 'node_modules' || name === '.git') continue;
      const abs = join(dir, name);
      let st;
      try { st = statSync(abs); } catch { continue; }      // 断链符号链接 ⇒ 跳过
      if (st.isDirectory()) { visit(abs); continue; }
      if (!/\.(ts|mts|tsx|js|mjs)$/.test(name)) continue;
      const rel = norm(relative(root, abs));
      if (res.some((r) => r.test(rel))) out.push(abs);
    }
  };
  for (const b of bases) visit(b);
  return out;
}

/**
 * 从一个文件里抽出「写点事件名」集合。
 *
 * 反盲区（PR-1 独立审查 P1-4 修复）：
 * - **形状违规名不丢弃**：`eventType: 'evil:colon'` 这类不合名单文法的名字也要报出来（否则换个
 *   形状就能从 R1 的视野里消失）。返回 `invalid` 供 R1 以 detail 说明其违规形态。
 * - **常量间接解析**：`const EVT = 'x'; appendLedger({eventType: EVT})` 与 `insert ... run(..., EVT)`
 *   必须在同文件内解析到字面量；解析不到（函数返回/外部 import/拼接）⇒ 记 `unresolved`，R1 报红
 *   （「无法证明它写的是名单内名字」不等于「它写的是名单内名字」）。
 */
function factsFromFile(abs) {
  const text = readFileSync(abs, 'utf8');
  const sf = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true, abs.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const names = new Map(); // name -> first line
  const invalid = [];      // {text, line}
  const unresolved = [];   // {expr, line}
  const relays = [];       // {expr, line} —— 转发形写点（名字来自调用方）
  const lineOf = (n) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
  const add = (lit, node) => {
    const line = lineOf(node);
    if (!NAME_RE.test(lit)) { invalid.push({ text: lit, line }); return; }
    if (!names.has(lit)) names.set(lit, line);
  };
  const litText = (n) => (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) ? n.text : null);

  // 同文件 const/let 字面量表（只取单次赋值、初始化即字面量的形）
  const consts = new Map();
  const collectConsts = (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      const t = litText(n.initializer);
      if (t !== null) consts.set(n.name.text, t);
    }
    ts.forEachChild(n, collectConsts);
  };
  collectConsts(sf);

  /** 把一个表达式解析成事件名字面量；解析不到就记 unresolved */
  const resolveName = (expr) => {
    const t = litText(expr);
    if (t !== null) { add(t, expr); return; }
    if (ts.isIdentifier(expr) && consts.has(expr.text)) { add(consts.get(expr.text), expr); return; }
    if (ts.isParenthesizedExpression(expr)) { resolveName(expr.expression); return; }
    // 转发形：`a.eventType` / `e.eventType` 这类成员访问没有名字本体，值由调用方给。
    // 它不是「名字事实」，但**必须**在同文件里有归属/名单核对（`formalEventOwner` /
    // `registry.*` 之类），否则就是一条无从证明的通用写点（独立审查 P1-4 的同族盲区）。
    if (ts.isPropertyAccessExpression(expr)) { relays.push({ expr: expr.getText(sf), line: lineOf(expr) }); return; }
    if (ts.isTemplateExpression(expr)) { unresolved.push({ expr: expr.getText(sf), line: lineOf(expr) }); return; }
    if (ts.isConditionalExpression(expr)) {
      resolveName(expr.whenTrue); resolveName(expr.whenFalse); return;
    }
    unresolved.push({ expr: expr.getText(sf).slice(0, 80), line: lineOf(expr) });
  };

  const visit = (node) => {
    // (a) 属性 eventType: '<lit>'（appendLedger({eventType}) 形）
    if (ts.isPropertyAssignment(node)) {
      const key = node.name && (ts.isIdentifier(node.name) ? node.name.text : ts.isStringLiteral(node.name) ? node.name.text : '');
      if (key === 'eventType') resolveName(node.initializer);
    }
    // (b) 含 `insert into ledger(...)` 的 SQL 调用：**只取 event_type 列对应的实参**（不是所有 args）
    if (ts.isCallExpression(node)) {
      const sqlOf = (a) => (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a) ? a.text : null);
      const ledgerCols = (sql) => {
        const m = /insert\s+into\s+ledger\s*\(([^)]*)\)/i.exec(sql ?? '');
        if (!m) return null;
        const cols = m[1].split(',').map((c) => c.trim().toLowerCase());
        const idx = cols.indexOf('event_type');
        return idx >= 0 ? idx : null;
      };
      const fromArgs = (args) => {
        const idx = ledgerCols(args.map(sqlOf).find((t) => t && /insert\s+into\s+ledger/i.test(t)));
        if (idx == null) return;
        const value = args[idx + 1];        // args[0] = SQL；第 k 个占位符 = args[k]
        if (value) resolveName(value);
      };
      const direct = node.arguments.map(sqlOf).find((t) => t && /insert\s+into\s+ledger/i.test(t));
      if (direct) fromArgs(node.arguments);
      else if (/\.run$/.test(node.expression.getText(sf)) && ts.isPropertyAccessExpression(node.expression)) {
        const prep = node.expression.expression;   // prepare(`insert into ledger ...`).run(...)
        if (ts.isCallExpression(prep) && /\.prepare$/.test(prep.expression.getText(sf))) {
          fromArgs([prep.arguments[0], ...node.arguments]);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  // 归属/名单核对调用（AST）：callee 文本命中其一即算本文件有核对
  // 核对调用的形态：归属查询 / 机制轴查询 / 名单成员判定。后两类在源码里常带类型断言
  // （`(MECHANISM_AUDIT_EVENT_TYPES as readonly string[]).includes(x)`、`this.formalEvents.has(x)`），
  // 所以按「callee 文本里出现名单符号 + 以 .has/.includes 收尾」判，而不是要求紧邻点号。
  const GUARD_CALL = /(?:formalEventOwner|formalEventAuthority|formalEventEntry|registry\s*\.\s*(?:lookup|formal|capability|ownsEvent|capabilities)|MECHANISM_AUDIT_EVENT_TYPES[\s\S]{0,60}?\.\s*(?:has|includes)|formalEvents\s*\.\s*(?:has|get))/;
  // 逐点绑定（第三轮复审 P2-①）：光「文件里有核对调用」不够——哑元 `registry.lookup('占位')`
  // 就能覆盖全文件的转发点。核对必须**吃进这个转发表达式本身**（实参文本包含它）。
  const guardArgs = [];
  const countGuards = (n) => {
    if (ts.isCallExpression(n) && GUARD_CALL.test(n.expression.getText(sf))) {
      guardArgs.push(...n.arguments.map((a) => a.getText(sf)));
    }
    ts.forEachChild(n, countGuards);
  };
  countGuards(sf);

  visit(sf);
  // 每个转发点单独判定：某次核对调用的实参里出现过这个表达式才算「核过它」
  for (const r of relays) r.guardedByCall = guardArgs.some((t) => t.includes(r.expr));
  return { names, invalid, unresolved, relays, guardArgs };
}

function collectFacts(implRoot, byName) {
  const globs = new Set();
  for (const e of byName.values()) for (const g of e.writeSites ?? []) globs.add(g);
  const files = walkFiles(implRoot, [...globs]);
  const facts = new Map(); // name -> {file, line}
  const invalid = [];
  const unresolved = [];
  const relays = [];
  for (const f of files) {
    const rel = relative(implRoot, f).split(sep).join('/');
    const r = factsFromFile(f);
    for (const [n, line] of r.names) if (!facts.has(n)) facts.set(n, { file: rel, line });
    for (const x of r.invalid) invalid.push({ ...x, file: rel });
    for (const x of r.unresolved) unresolved.push({ ...x, file: rel });
    if (r.relays.length) {
      // 同文件必须真的**调用**归属/名单核对——用 AST 的调用名判定，注释/字符串里出现不算
      // （审查反攻第 3 条：字符串匹配可被一行注释满足）。
      // 逐点判据：每个转发点各自有 guardedByCall（文件里有一次无关的核对调用不算数）
      for (const x of r.relays) relays.push({ ...x, file: rel, guarded: x.guardedByCall === true });
    }
  }
  return { files, facts, invalid, unresolved, relays };
}

/* ------------------------------------------------------------------ 判据 */

/** 契约块声明的 gated_by 闭集（EA §2.4 四门 + FM §9 FM-9 一门）。新增门控必须同批改这里与夹具。 */
const GATED_BY_CLOSED = new Set(['EA-1.2.3', 'EA-7.1', 'EA-7.2', 'G1-NS-01', 'G1-FACET-01']);
// gate-id → 契约正文路径的**静态映射**：只查「文件存在」等于让作者自证（锚自指 / 自建文件 /
// 随便一个既有文件都能过）。出处必须是**指定的那份契约**。
const GATE_CONTRACT = new Map([
  ['EA-1.2.3', 'experiments/v3-code-architecture-poc/g1/G1-CONTRACT-EVENT-AUTHORITY.md'],
  ['EA-7.1', 'experiments/v3-code-architecture-poc/g1/G1-CONTRACT-EVENT-AUTHORITY.md'],
  ['EA-7.2', 'experiments/v3-code-architecture-poc/g1/G1-CONTRACT-EVENT-AUTHORITY.md'],
  ['G1-NS-01', 'experiments/v3-code-architecture-poc/g1/G1-CONTRACT-RELOCATION.md'],
  ['G1-FACET-01', 'experiments/v3-code-architecture-poc/g1/G1-CONTRACT-FACET-MOUNT.md'],
]);

function checkR1(facts, byName, scan) {
  const bad = [...facts.entries()].filter(([n]) => !byName.has(n));
  const out = bad.map(([n, loc]) => ({ code: 'EVENT_RECON_ORPHAN', name: n, ...loc, msg: `写点出现名单外事件名 ${n}（${loc.file}:${loc.line}）` }));
  for (const x of scan.invalid) {
    out.push({ code: 'EVENT_RECON_ORPHAN', name: x.text, file: x.file, line: x.line,
      msg: `写点事件名 ${JSON.stringify(x.text)} 不符合名单文法（${x.file}:${x.line}）——形状违规名同样不得静默放过` });
  }
  for (const x of scan.relays ?? []) {
    if (x.guarded) continue;
    out.push({ code: 'EVENT_RECON_ORPHAN', name: x.expr, file: x.file, line: x.line,
      msg: `转发形写点（${x.expr}）所在文件没有归属/名单核对：名字来自调用方且无从证明已过名单（${x.file}:${x.line}）` });
  }
  for (const x of scan.unresolved) {
    out.push({ code: 'EVENT_RECON_ORPHAN', name: x.expr, file: x.file, line: x.line,
      msg: `写点事件名无法静态解析（${x.file}:${x.line} ${x.expr}）——不能证明它来自名单，按违规处理` });
  }
  return out;
}

function checkR2(facts, byName, approvedSet) {
  const bad = [];
  for (const [n, e] of byName) {
    if (facts.has(n)) continue;
    if (e.planned === true) continue;
    bad.push({ code: 'EVENT_RECON_STALE', name: n, msg: `入账条目 ${n} 既无写点又非 planned:true（名单膨胀/删码未清账）` });
  }
  // 批准覆盖（EA-6.1「机制条目缺批准 = 对账红」的可机验形）：
  //   planned:false ⇒ 必须有 anchor 以 #<name> 结尾的批准记录；
  //   planned:true  ⇒ 允许未批准，但必须带 gated_by（挂起归属），否则同样红。
  for (const [n, e] of byName) {
    if (e.class !== 'mechanism') continue;
    if (approvedSet.has(n)) continue;
    // planned:true 只允许「提案未入账 + 门控锚 ∈ 契约声明闭集」这一种免批准形态；
    // 任意非空串（`G1-OTHER`）不再被当作有效门控（独立审查 P2-1）。
    // 出处强引用（第三轮复审 P2-②）：光有 `gated_by` 标签不够——标签可以随便贴。
    // 每个 planned 名必须带 `contractRef: "<仓内路径>#<gate-id>"`：路径必须**存在**（只做存在性检查，
    // 不解析内容——否则 recon 就有第二个读取源，异源对账退化成自证对账），且 gate-id 必须与
    // `gated_by` 一致并落在契约声明闭集内。
    if (e.planned === true && typeof e.gated_by === 'string' && GATED_BY_CLOSED.has(e.gated_by)) {
      const ref = String(e.contractRef ?? '');
      const m = /^([^#]+)#([A-Za-z0-9.\-]+)$/.exec(ref);
      if (!m) {
        bad.push({ code: 'EVENT_RECON_UNPROVED', name: n,
          msg: `机制条目 ${n} 缺 contractRef（须为 "<仓内路径>#<gate-id>"）：gated_by=${e.gated_by} 只是标签，出处必须可核` });
        continue;
      }
      if (GATE_CONTRACT.get(m[2]) !== m[1]) {
        bad.push({ code: 'EVENT_RECON_UNPROVED', name: n,
          msg: `机制条目 ${n} 的 contractRef 路径必须是该 gate 的指定契约 ${GATE_CONTRACT.get(m[2]) ?? '(未登记 gate)'}，实为 ${m[1]}（出处不能由作者自选）` });
        continue;
      }
      if (!existsSync(join(REPO, m[1]))) {
        bad.push({ code: 'EVENT_RECON_UNPROVED', name: n,
          msg: `机制条目 ${n} 的 contractRef 路径在仓内不存在：${m[1]}` });
        continue;
      }
      if (!GATED_BY_CLOSED.has(m[2]) || m[2] !== e.gated_by) {
        bad.push({ code: 'EVENT_RECON_UNPROVED', name: n,
          msg: `机制条目 ${n} 的 contractRef gate-id（${m[2]}）与 gated_by（${e.gated_by}）不一致或不在闭集内` });
        continue;
      }
      continue;
    }
    bad.push({ code: 'EVENT_RECON_UNPROVED', name: n,
      msg: e.planned === true
        ? `机制条目 ${n} planned:true 但 gated_by=${JSON.stringify(e.gated_by ?? null)} 不在契约声明闭集内（${[...GATED_BY_CLOSED].join('/')}）`
        : `机制条目 ${n} 缺 Approved-By 覆盖（anchor 需为「仓内已存在文件 + Approved-By: <日期> <批准人>」并指向本名）` });
  }
  return bad;
}

function checkR3(scriptPath = import.meta.filename) {
  const src = readFileSync(scriptPath, 'utf8');
  const bad = [];
  // 不得 import src/** 或 experiments/** 的写点模块——四种形态都要查（独立审查 P2-3）：
  // 具名/默认 import、side-effect import、动态 import()、createRequire/require
  const isForbidden = (spec) => /(^|\/)(src|experiments)\//.test(spec);
  for (const m of src.matchAll(/^\s*import[^;]*?from\s+['"]([^'"]+)['"]/gm))
    if (isForbidden(m[1])) bad.push({ code: 'EVENT_RECON_SAMESOURCE', msg: `脚本 import 了写点/实验模块：${m[1]}` });
  for (const m of src.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm))
    if (isForbidden(m[1])) bad.push({ code: 'EVENT_RECON_SAMESOURCE', msg: `side-effect import 了写点/实验模块：${m[1]}` });
  for (const m of src.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]/g))
    if (isForbidden(m[1])) bad.push({ code: 'EVENT_RECON_SAMESOURCE', msg: `动态 import 了写点/实验模块：${m[1]}` });
  for (const m of src.matchAll(/\b(?:createRequire|require)\s*\(\s*['"]([^'"]+)['"]/g))
    if (isForbidden(m[1])) bad.push({ code: 'EVENT_RECON_SAMESOURCE', msg: `require 了写点/实验模块：${m[1]}` });
  // 期望集只读锚文件：不得出现第二个 JSON 读取路径作为期望源
  const jsonReads = [...src.matchAll(/readFileSync\(\s*([A-Za-z_$][\w$]*|['"][^'"]+['"])/g)].map((m) => m[1]);
  const allowed = new Set(['anchorPath', 'raw', 'abs', 'f', 'scriptPath', 'p', 'file']);
  for (const r of jsonReads) if (!allowed.has(r) && !/^['"]/.test(r)) bad.push({ code: 'EVENT_RECON_SAMESOURCE', msg: `可疑的额外读取源：${r}` });
  return bad;
}

/* --commit：R4 单提交耦合检查 */

const LEDGER_REL = 'contracts/event-registry/EVENT-CONTRACT-LEDGER.json';

const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));

/**
 * R4 单提交耦合检查（**按语义比，不按行子串**）。
 *
 * 独立审查 P1-1 的修法：旧实现「diff 行里出现 planned/approvedBy/anchor 就豁免」有两个实测绕过
 * （把名单压成单行 JSON ⇒ 整段豁免；同提交改 approvedBy + 改写点 ⇒ 豁免）。改为解析 `sha^` 与 `sha`
 * 两份 JSON 逐 entry 比字段：
 *   - entries：按 eventType 建表；**新增/删除条目 = 语义行**（删名会让 R1/R2 失明，新增名是名单扩形）；
 *     已有条目只允许 `planned` 由 true→false 一种变化（EA-2.4 步骤 3），其余任何字段变化 = 语义行；
 *   - approved：只允许**追加**（既有条目逐字保留，multiset 子集），删除/改写 = 语义行；
 *   - 解析失败（格式坏了）= 语义行（不能以「解析不了」换豁免）；
 *   - 同一提交里出现新增批准记录 ⇒ 必须带 `Event-Name-Review:` trailer（EA-2.4 两处同现的提交侧）。
 */
function checkCoupling(sha, cwd = REPO) {
  const git = (...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const files = git('show', '--name-only', '--format=', sha).split('\n').filter(Boolean);
  const touchesLedger = files.includes(LEDGER_REL);
  // PR-1..PR-10 的真实代码在 `experiments/<pkg>/src/{kernel,storage-sqlite}/**`（生产根迁移前），
  // 只认 `src/**` 会让「名单语义行 + 真实写点同提交」在迁移窗口内全绿——第二轮复审 P1-3。
  // 契约正文也在语义行面内（复核残余风险）：同提交「改契约条文 + 改锚」= 既改判据又改被判对象，
  // 只有夹具能拦，而夹具是代码、可同提交改。契约文件与锚文件必须分居两个提交。
  const CONTRACT_DOC = /^experiments\/[^/]+\/g1\/G1-CONTRACT-[A-Za-z0-9-]+\.md$/;
  const writeModules = files.filter((f) => /^(?:experiments\/[^/]+\/)?src\/(?:kernel|storage-sqlite)\//.test(f) || CONTRACT_DOC.test(f));
  const hits = [];
  const push = (detail) => hits.push({ code: 'EVENT_RECON_COUPLING', msg: `提交 ${sha.slice(0, 7)} 同时改了名单语义行与写点模块（${writeModules.slice(0, 3).join(', ')}…）：${detail}` });
  if (!touchesLedger) return hits;

  const readAt = (rev) => {
    try { return JSON.parse(git('show', `${rev}:${LEDGER_REL}`)); } catch { return null; }
  };
  const beforeRaw = readAt(`${sha}^`);
  // 创建锚文件的提交：父提交根本没有该文件 ⇒ 不存在「语义行变更」，不能拿空对象当基线。
  const before = beforeRaw ?? { entries: [], approved: [] };
  const created = beforeRaw === null;
  const after = readAt(sha);

  if (!after) { push('提交后的名单不可解析——格式损坏不能换豁免'); return hits; }
  // 顶层键集合与其中非 entries/approved 的值（schemaVersion / interpretationRuleSetVersion / writeSites …）
  // 变化同样是语义行：改 schemaVersion 就能让读面按另一套规则解释，那不是格式化。
  const top = (o) => Object.keys(o).filter((k) => k !== 'entries' && k !== 'approved').sort();
  const tBefore = top(before); const tAfter = top(after);
  if (created) { /* 创建提交不做基线比较：只保留 trailer 检查 */ }
  if (!created && tBefore.join(',') !== tAfter.join(',')) push(`顶层键集合变化：${tBefore.join(',')} → ${tAfter.join(',')}`);
  else if (!created) for (const k of tAfter) {
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) push(`顶层字段 ${k} 变化`);
  }

  // EA-2.4 两处同现的**提交侧**：任何新增批准记录的提交都必须带 trailer——
  // 与「是否同提交改了写点」无关（锚文件的独立性正体现于此，独立审查 P1-3 的修法）。
  // multiset 差（不是长度差）：删 1 加 1 长度为 0，但来源已被改写——那不是「没新增」。
  const key = (a) => JSON.stringify([a?.approvedBy, a?.approvedOn, a?.anchor]);
  const beforeBag = new Map(); for (const a of before.approved ?? []) { const k = key(a); beforeBag.set(k, (beforeBag.get(k) ?? 0) + 1); }
  const afterBag = new Map(); for (const a of after.approved ?? []) { const k = key(a); afterBag.set(k, (afterBag.get(k) ?? 0) + 1); }
  const tri = (a) => {
    const m = /#([a-z][a-z0-9-]*)$/.exec(String(a?.anchor ?? ''));
    return JSON.stringify([m?.[1] ?? '', a?.approvedBy, a?.approvedOn]);
  };
  const triBag2 = (list) => { const m = new Map(); for (const a of list) { const k = tri(a); m.set(k, (m.get(k) ?? 0) + 1); } return m; };
  const tb2 = triBag2(before.approved ?? []); const ta2 = triBag2(after.approved ?? []);
  const addedFacts = [...ta2].reduce((n, [k, c]) => n + Math.max(0, c - (tb2.get(k) ?? 0)), 0);
  const approvedAddedRaw = [...afterBag].reduce((n, [k, c]) => n + Math.max(0, c - (beforeBag.get(k) ?? 0)), 0);
  const approvedRemoved = [...beforeBag].reduce((n, [k, c]) => n + Math.max(0, c - (afterBag.get(k) ?? 0)), 0);
  // 锚路径规范化（同一批准事实换个可解析路径）不算「改写批准」：三元组
  // (名字, 批准人, 批准日) 不变、只有 anchor 路径不同 ⇒ 视为同一批准事实的重新锚定。

  // 「同一批准事实换锚」只在**纯目录前缀搬迁**且新路径在父提交里已存在时才算数
  // （`g1/…` → `experiments/…/g1/…` 正是这种搬迁）。其余改锚一律要求人工签署 trailer：
  // 否则外部真实批准可以在一次纯名单提交里被静默换成作者自签的文书（复核终局 ②-a 的实测通道）。
  const pathOf = (a) => { const m = /^(.+)#[a-z][a-z0-9-]*$/.exec(String(a?.anchor ?? '')); return m ? m[1] : null; };
  const existsAtParent = (pth) => { try { git('cat-file', '-e', `${sha}^:${pth}`); return true; } catch { return false; } };
  const legitReanchor = (oldA, newA) => {
    const o = pathOf(oldA); const n = pathOf(newA);
    if (o === null || n === null) return false;
    if (n === o) return true;
    // 旧锚根本指不到仓内文件（历史里的描述性字符串）⇒ 规范化成可核路径是合法搬迁
    // 旧锚指不到文件时：规范化为 legacy: 白名单形式（其有效性由 verifyApprovals 另判）或仓内已存在路径
    if (!existsAtParent(o)) return n.startsWith('legacy:') || existsAtParent(n);
    if (!n.endsWith('/' + o)) return false;      // 其余只接受目录前缀延伸
    return existsAtParent(n);                     // 且新锚所指文件在父提交已存在
  };
  const pairOk = (list) => {
    const oldList = before.approved ?? []; const newList = after.approved ?? [];
    const used = new Set();
    for (const a of oldList) {
      const hit = newList.findIndex((b2, i) => !used.has(i) && tri(a) === tri(b2) && legitReanchor(a, b2));
      if (hit >= 0) { used.add(hit); continue; }
      // 没有合法配对 ⇒ 该条算「被删除/改写」
      if (!newList.some((b2) => tri(a) === tri(b2) && String(b2?.anchor) === String(a?.anchor))) return false;
    }
    return true;
  };
  const sameFacts = pairOk();
  const hasTrailer = /^Event-Name-Review:\s*\d{4}-\d{2}-\d{2}\s+\S+/m.test(git('show', '--format=%B', '-s', sha));
  if (approvedRemoved > 0 && !hasTrailer && !sameFacts) push(`批准记录被删除/改写 ${approvedRemoved} 条（approval 只许追加）`);
  // 只有「真正新增批准事实」才要求 trailer；重新锚定（三元组不变）不新增事实。
  const approvedAdded = addedFacts;
  if (approvedAdded > 0) {
    const msg = git('show', '--format=%B', '-s', sha);
    if (!/^Event-Name-Review:\s*\d{4}-\d{2}-\d{2}\s+\S+/m.test(msg)) {
      hits.push({ code: 'EVENT_RECON_UNSIGNED', msg: `提交 ${sha.slice(0, 7)} 新增了 ${approvedAdded} 条批准记录但提交信息缺 Event-Name-Review trailer（EA-2.4 两处同现）` });
    }
  }

  if (writeModules.length === 0) return hits;
  // EA-2.4 步骤 3：批准记录必须**独立于**写点提交——带 trailer 也不能与写点同提交。
  if (approvedAdded > 0) push(`批准记录追加与写点同提交（批准须独立提交，trailer 不代替独立性）`);

  const mapOf = (d) => new Map((d.entries ?? []).map((e) => [e.eventType, e]));
  const b = mapOf(before); const a = mapOf(after);
  for (const [name, oldE] of b) {
    const newE = a.get(name);
    if (!newE) { push(`删除条目 ${name}（删名会让 R1/R2 失明）`); continue; }
    const { planned: oldP, ...oldRest } = oldE;
    const { planned: newP, ...newRest } = newE;
    if (canon(oldRest) !== canon(newRest)) { push(`条目 ${name} 的语义字段变化`); continue; }
    if (oldP !== newP && !(oldP === true && newP === false)) push(`条目 ${name} 的 planned 变化方向非法（只许 true→false）`);
  }
  for (const name of a.keys()) if (!b.has(name)) push(`新增条目 ${name}`);

  const approvedBefore = (before.approved ?? []).map(canon);
  const approvedAfter = (after.approved ?? []).map(canon);
  const pool = new Map();
  for (const x of approvedAfter) pool.set(x, (pool.get(x) ?? 0) + 1);
  for (const x of approvedBefore) {
    const n = pool.get(x) ?? 0;
    if (n === 0) { push('删除或改写了既有批准记录'); break; }
    pool.set(x, n - 1);
  }
  return hits;
}

/* ------------------------------------------------------------------ 主流程 */

function run({ implRoot, anchorPath = ANCHOR_PATH }) {
  const { doc, byName } = loadExpected(anchorPath);
  const { approved: approvedSet, problems: approvalProblems } = verifyApprovals(doc, REPO);
  const scan = collectFacts(implRoot, byName);
  const { files, facts } = scan;
  const problems = [
    ...checkR1(facts, byName, scan),
    ...checkR2(facts, byName, approvedSet),
    ...approvalProblems,
    ...checkR3(),
  ];
  return {
    implRoot: relative(REPO, implRoot).split(sep).join('/') || '.',
    scannedFiles: files.length,
    expected: byName.size,
    planned: [...byName.values()].filter((e) => e.planned === true).length,
    facts: facts.size,
    relayed: (scan.relays ?? []).filter((r) => r.guarded).length,
    problems,
    counts: {
      R1: problems.filter((p) => p.code === 'EVENT_RECON_ORPHAN').length,
      R2: problems.filter((p) => p.code === 'EVENT_RECON_STALE').length,
      R3: problems.filter((p) => p.code === 'EVENT_RECON_SAMESOURCE').length,
      R_APPROVED: problems.filter((p) => p.code === 'EVENT_RECON_UNPROVED').length,
    },
  };
}

/* ------------------------------------------------------------------ 自验：四条判据各一条架空形 */

function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), 'evrecon-'));
  const results = [];
  const emit = (name, phase, ok, extra = '') => results.push({ name, phase, ok, extra });
  try {
    // 架空形 A：写点写了名单外名字 ⇒ R1 必须红
    const A = join(dir, 'a');
    mkdirSync(join(A, 'src/kernel'), { recursive: true });
    writeFileSync(join(A, 'src/kernel/x.ts'),
      `declare function appendLedger(a: { eventType: string; payload: unknown }): void;\nappendLedger({ eventType: 'totally-new-mechanism-name', payload: {} });\n`);
    const a = run({ implRoot: A });
    emit('MUT-R1 名单外写点', 'R1', a.counts.R1 === 1, `R1=${a.counts.R1}（期望 1）`);

    // 架空形 B：入账名无写点、非 planned ⇒ R2 必须红
    const B = join(dir, 'b');
    mkdirSync(join(B, 'src/kernel'), { recursive: true });
    writeFileSync(join(B, 'src/kernel/y.ts'), `// 无任何 ledger 写点\n`);
    const b = run({ implRoot: B });
    emit('MUT-R2 入账名无写点', 'R2', b.counts.R2 > 0, `R2=${b.counts.R2}（期望 >0）`);

    // 架空形 C：脚本自身 import 写点模块 ⇒ R3 必须红
    const C = join(dir, 'c.ts');
    writeFileSync(C, `import { kernel } from '../src/kernel/kernel';\n`);
    const c = checkR3(C);
    emit('MUT-R3 同源 import', 'R3', c.length === 1, `R3=${c.length}（期望 1）`);

    // 架空形 D：同提交改名单语义行 + 写点模块 ⇒ R4 必须红（一次性临时仓）
    const D = join(dir, 'd');
    mkdirSync(D, { recursive: true });
    const g = (...args) => execFileSync('git', args, { cwd: D, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    g('init', '-q'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
    mkdirSync(join(D, 'src/kernel'), { recursive: true });
    mkdirSync(join(D, 'contracts/event-registry'), { recursive: true });
    const writeLedger = (obj) => writeFileSync(join(D, LEDGER_REL), JSON.stringify(obj, null, 2));
    const baseLedger = { schemaVersion: 1, approved: [], entries: [{ eventType: 'x-y', class: 'mechanism', planned: false }] };
    writeFileSync(join(D, 'src/kernel/k.ts'), `export const a = 1;\n`);
    writeLedger(baseLedger);
    g('add', '.'); g('commit', '-qm', 'base');
    const commit = (msg) => { g('add', '.'); g('commit', '-qm', msg); return g('rev-parse', 'HEAD').trim(); };
    const coupled = (sha) => checkCoupling(sha, D).length;

    writeLedger({ ...baseLedger, entries: [{ eventType: 'x-z', class: 'mechanism', planned: false }] });
    writeFileSync(join(D, 'src/kernel/k.ts'), `export const a = 2;\n`);
    emit('MUT-R4 语义行（eventType 更名）+ 写点同提交', 'R4', coupled(commit('coupled')) >= 1, `hits=${coupled('HEAD')}（期望 ≥1）`);

    // 审查 P1-1 绕过形 1：把名单压成**单行 JSON** 再改名 ⇒ 旧实现整段豁免而绿，必须仍红
    writeFileSync(join(D, LEDGER_REL), JSON.stringify({ ...baseLedger, entries: [{ eventType: 'x-w', class: 'mechanism', planned: false }] }));
    writeFileSync(join(D, 'src/kernel/k.ts'), `export const a = 3;\n`);
    emit('MUT-R4 单行压缩 + 改名 + 写点（旧绕过形）', 'R4', coupled(commit('oneline')) >= 1, `hits=${coupled('HEAD')}（期望 ≥1）`);

    // 审查 P1-1 绕过形 2：同提交把 approvedBy 改成实现者 + 改写点 ⇒ 必须红
    writeLedger({ ...baseLedger, approved: [{ approvedBy: 'the-implementer', approvedOn: '2026-11-03', anchor: 'x#x-y' }], entries: [{ eventType: 'x-y', class: 'mechanism', planned: false }] });
    writeFileSync(join(D, 'src/kernel/k.ts'), `export const a = 4;\n`);
    emit('MUT-R4 改写 approvedBy + 写点（旧绕过形）', 'R4', coupled(commit('selfsigned')) >= 1, `hits=${coupled('HEAD')}（期望 ≥1）`);

    // 审查 P1-1 绕过形 3：planned false→true + 同提交删写点 ⇒ 必须红
    writeLedger({ ...baseLedger, entries: [{ eventType: 'x-y', class: 'mechanism', planned: true }] });
    writeFileSync(join(D, 'src/kernel/k.ts'), `export const a = 5;\n`);
    emit('MUT-R4 planned false→true + 写点同提交', 'R4', coupled(commit('flipbad')) >= 1, `hits=${coupled('HEAD')}（期望 ≥1）`);

    // 对照 1：只改名单（approved 追加 + planned 翻转）+ 带 trailer ⇒ 不算耦合
    writeLedger({ ...baseLedger, approved: [{ approvedBy: 'independent-review-seat', approvedOn: '2026-11-03', anchor: 'docs/x.md#x-y' }], entries: [{ eventType: 'x-y', class: 'mechanism', planned: false }] });
    emit('对照1：approved 追加 + planned 翻转不算耦合', 'R4', coupled(commit('ledger-only\n\nEvent-Name-Review: 2026-11-03 independent-review-seat')) === 0, `hits=${coupled('HEAD')}（期望 0）`);

    // 架空形：新增批准记录但缺 Event-Name-Review trailer ⇒ 必须红（两处同现的提交侧）
    writeLedger({ ...baseLedger, approved: [
      { approvedBy: 'independent-review-seat', approvedOn: '2026-11-03', anchor: 'docs/x.md#x-y' },
      { approvedBy: 'independent-review-seat', approvedOn: '2026-11-03', anchor: 'docs/x.md#x-z' },
    ], entries: [{ eventType: 'x-y', class: 'mechanism', planned: false }] });
    const unsigned = commit('unsigned-approval');
    emit('MUT-R4 新增批准缺 trailer', 'R4', checkCoupling(unsigned, D).some((h) => h.code === 'EVENT_RECON_UNSIGNED'), `codes=${checkCoupling(unsigned, D).map((h) => h.code).join(',')}`);

    // 对照 2：纯格式变化（缩进/排序）+ 写点 ⇒ 不算语义行
    writeFileSync(join(D, LEDGER_REL), JSON.stringify({ ...baseLedger, approved: [
      { approvedBy: 'independent-review-seat', approvedOn: '2026-11-03', anchor: 'docs/x.md#x-y' },
      { approvedBy: 'independent-review-seat', approvedOn: '2026-11-03', anchor: 'docs/x.md#x-z' },
    ], entries: [{ eventType: 'x-y', class: 'mechanism', planned: false }] }));
    writeFileSync(join(D, 'src/kernel/k.ts'), `export const a = 6;\n`);
    emit('对照2：纯格式变化（单行压缩）不算语义行', 'R4', coupled(commit('format-only\n\nEvent-Name-Review: 2026-11-03 x')) === 0, `hits=${coupled('HEAD')}（期望 0）`);

    // 架空形 E：批准三要素——空路径自签 / 批准者形态是实现者 / legacy 未登记 ⇒ 都要红
    const baseDoc = { schemaVersion: 1, approved: [], entries: [{ eventType: 'x-y', class: 'mechanism', planned: false }] };
    const selfSigned = verifyApprovals({ ...baseDoc, approved: [{ approvedBy: 'someone', approvedOn: '2026-11-03', anchor: '#x-y' }] }, D);
    emit('MUT-APPROVAL 空路径自签锚', 'R2', selfSigned.approved.size === 0, `approved=${selfSigned.approved.size}（期望 0）`);
    const implementer = verifyApprovals({ ...baseDoc, approved: [{ approvedBy: 'the-implementer', approvedOn: '2026-11-03', anchor: 'docs/x.md#x-y' }] }, D);
    emit('MUT-APPROVAL 批准者形态=实现者', 'R2', implementer.approved.size === 0, `approved=${implementer.approved.size}（期望 0）`);
    const ghost = verifyApprovals({ ...baseDoc, approved: [{ approvedBy: 'someone', approvedOn: '2026-11-03', anchor: 'legacy:NOPE#x-y' }] }, D);
    emit('MUT-APPROVAL 未登记 legacy 锚', 'R2', ghost.approved.size === 0, `approved=${ghost.approved.size}（期望 0）`);
    mkdirSync(join(D, 'docs'), { recursive: true });
    writeFileSync(join(D, 'docs/x.md'),
      '# approvals\n\n说明文字里提到 x-z 不算批准。\n\n```\nApproved-By: 2026-11-03 reviewer-b\n  x-y   —— 批准理由\n```\n');
    // 对照（负）：同一文件、同一批准行，但名字只在**块外**出现 ⇒ 必须不算批准
    const outsideBlock = verifyApprovals({ ...baseDoc, approved: [
      { approvedBy: 'reviewer-b', approvedOn: '2026-11-03', anchor: 'docs/x.md#x-y' },
      { approvedBy: 'reviewer-b', approvedOn: '2026-11-03', anchor: 'docs/x.md#x-z' },
    ] }, D);
    emit('MUT-APPROVAL 名字只在签名块外出现', 'R2', outsideBlock.approved.size === 1, `approved=${outsideBlock.approved.size}（期望 1，仅 x-y）`);
    const good = verifyApprovals({ ...baseDoc, approved: [{ approvedBy: 'reviewer-b', approvedOn: '2026-11-03', anchor: 'docs/x.md#x-y' }] }, D);
    emit('对照3：锚文件存在 + 逐字批准行 ⇒ 通过', 'R2', good.approved.size === 1, `approved=${good.approved.size}（期望 1）`);

    // 架空形 F：R1 盲区——形状违规名 / 常量间接 / 无法解析
    const F = join(dir, 'f');
    mkdirSync(join(F, 'src/kernel'), { recursive: true });
    writeFileSync(join(F, 'src/kernel/bad-shape.ts'),
      `declare function appendLedger(a: { eventType: string }): void;\nappendLedger({ eventType: 'evil:colon-name' });\n`);
    const f1 = run({ implRoot: F });
    emit('MUT-R1 形状违规名不再静默丢弃', 'R1', f1.counts.R1 >= 1, `R1=${f1.counts.R1}（期望 ≥1）`);
    const G = join(dir, 'g');
    mkdirSync(join(G, 'src/kernel'), { recursive: true });
    writeFileSync(join(G, 'src/kernel/indirect.ts'),
      `declare function appendLedger(a: { eventType: string }): void;\nconst EVT = 'smuggled-mechanism-name';\nappendLedger({ eventType: EVT });\n`);
    const f2 = run({ implRoot: G });
    emit('MUT-R1 常量间接写点被解析出来', 'R1', f2.counts.R1 >= 1 && f2.facts === 1, `R1=${f2.counts.R1} 事实=${f2.facts}（期望 ≥1 / 1）`);
    const H = join(dir, 'h');
    mkdirSync(join(H, 'src/kernel'), { recursive: true });
    writeFileSync(join(H, 'src/kernel/unres.ts'),
      `declare function appendLedger(a: { eventType: string }): void;\ndeclare function pick(): string;\nappendLedger({ eventType: pick() });\n`);
    const f3 = run({ implRoot: H });
    emit('MUT-R1 无法解析的事件名按违规处理', 'R1', f3.counts.R1 >= 1, `R1=${f3.counts.R1}（期望 ≥1）`);

    // 架空形 J：legacy 锚给**新**名字自签 ⇒ 必须红（legacy 白名单不得成为签新名的通道）
    const legacyNew = verifyApprovals({ ...baseDoc, approved: [{ approvedBy: 'someone', approvedOn: '2026-11-03', anchor: 'legacy:C-19#brand-new-mechanism-name' }] }, D);
    emit('MUT-APPROVAL legacy 锚给新名自签', 'R2', legacyNew.approved.size === 0, `approved=${legacyNew.approved.size}（期望 0）`);

    // 架空形 K：核对只出现在**注释**里 ⇒ 转发写点仍红（AST 判调用，不判字符串）
    const K = join(dir, 'k');
    mkdirSync(join(K, 'src/kernel'), { recursive: true });
    writeFileSync(join(K, 'src/kernel/relay.ts'),
      `declare const raw: { run(s: string, ...p: unknown[]): void };\ndeclare const a: { eventType: string };\n`
      + `// 这里"提到" formalEventOwner 只是注释，不是核对\nraw.run('insert into ledger(seq, space, event_type) values(?,?,?)', 1, 'SP', a.eventType);\n`);
    const k1 = run({ implRoot: K });
    emit('MUT-R1 转发写点仅注释提到核对', 'R1', k1.counts.R1 >= 1, `R1=${k1.counts.R1}（期望 ≥1）`);
    const K2 = join(dir, 'k2');
    mkdirSync(join(K2, 'src/kernel'), { recursive: true });
    writeFileSync(join(K2, 'src/kernel/relay2.ts'),
      `declare const raw: { run(s: string, ...p: unknown[]): void };\ndeclare const a: { eventType: string };\n`
      + `declare function formalEventOwner(t: string): string | undefined;\nformalEventOwner(a.eventType);\n`
      + `raw.run('insert into ledger(seq, space, event_type) values(?,?,?)', 1, 'SP', a.eventType);\n`);
    const k2 = run({ implRoot: K2 });
    emit('对照4：转发写点 + 真核对调用 ⇒ 通过', 'R1', k2.counts.R1 === 0 && k2.relayed === 1, `R1=${k2.counts.R1} relayed=${k2.relayed}（期望 0 / 1）`);

    // 架空形 M（第三轮复审 P2-②）：planned 名带合法 gated_by 但 contractRef 指向不存在的路径 / gate 不一致。
    // 判据只做存在性检查（不解析契约正文，避免第二个读取源），但「标签随便贴」不再能免批准。
    const M = join(dir, 'm');
    mkdirSync(join(M, 'src/kernel'), { recursive: true });
    for (const [label, ref] of [['路径不存在', 'nope/NOPE.md#EA-7.1'], ['gate 与 gated_by 不一致', 'contracts/event-registry/EVENT-CONTRACT-LEDGER.json#EA-7.2'], ['缺 contractRef', null]]) {
      const anchorM = join(M, 'ledger.json');
      const entry = { eventType: 'probe-planned', class: 'mechanism', planned: true, gated_by: 'EA-7.1', writeSites: ['src/kernel/**'] };
      if (ref) entry.contractRef = ref;
      writeFileSync(anchorM, JSON.stringify({ schemaVersion: 1, approved: [], entries: [entry] }, null, 2));
      const m1 = run({ implRoot: M, anchorPath: anchorM });
      emit(`MUT-R2 planned 名出处不可核（${label}）`, 'R2', m1.counts.R_APPROVED >= 1, `UNPROVED=${m1.counts.R_APPROVED}（期望 ≥1）`);
    }

    // 架空形 N（终局复核 ②-a）：把真实批准锚改到**作者同提交新建**的文书，无 trailer ⇒ 必须红
    const N = join(dir, 'n');
    mkdirSync(join(N, 'src/kernel'), { recursive: true });
    const gN2 = (...a) => execFileSync('git', a, { cwd: N, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    gN2('init', '-q'); gN2('config', 'user.email', 't@t'); gN2('config', 'user.name', 't');
    mkdirSync(join(N, 'docs'), { recursive: true });
    writeFileSync(join(N, 'docs/a.md'), '# a\n\n```\nApproved-By: 2026-11-03 reviewer-b\n  x-y  —— ok\n```\n');
    const ledgerN = join(N, LEDGER_REL); mkdirSync(join(N, 'contracts/event-registry'), { recursive: true });
    const writeN = (anchors) => writeFileSync(join(N, 'contracts/event-registry/EVENT-CONTRACT-LEDGER.json'), JSON.stringify({ schemaVersion: 1, approved: anchors, entries: [{ eventType: 'x-y', class: 'mechanism', planned: false }] }, null, 2));
    writeN([{ approvedBy: 'reviewer-b', approvedOn: '2026-11-03', anchor: 'docs/a.md#x-y' }]);
    gN2('add', '.'); gN2('commit', '-qm', 'n-base');
    writeFileSync(join(N, 'docs/mine.md'), '# mine\n\n```\nApproved-By: 2026-11-03 reviewer-b\n  x-y\n```\n');
    writeN([{ approvedBy: 'reviewer-b', approvedOn: '2026-11-03', anchor: 'docs/mine.md#x-y' }]);
    gN2('add', '.'); gN2('commit', '-qm', 'n-reanchor');
    const nHead = gN2('rev-parse', 'HEAD').trim();
    emit('MUT-R4 改锚到作者新建文书（无 trailer）', 'R4', checkCoupling(nHead, N).length >= 1, `hits=${checkCoupling(nHead, N).length}（期望 ≥1）`);

    // 架空形 O（终局复核 ②-b）：contractRef 指向锚文件自身 / 无关既有文件 ⇒ 必须红
    const O = join(dir, 'o');
    mkdirSync(join(O, 'src/kernel'), { recursive: true });
    for (const badRef of ['contracts/event-registry/EVENT-CONTRACT-LEDGER.json#EA-7.1', 'scripts/events-recon.mjs#EA-7.1']) {
      const anchorO = join(O, 'ledger.json');
      writeFileSync(anchorO, JSON.stringify({ schemaVersion: 1, approved: [], entries: [{ eventType: 'probe-planned', class: 'mechanism', planned: true, gated_by: 'EA-7.1', contractRef: badRef, writeSites: ['src/kernel/**'] }] }, null, 2));
      const o1 = run({ implRoot: O, anchorPath: anchorO });
      emit(`MUT-R2 contractRef 指向非指定契约（${badRef.split('/').pop()}）`, 'R2', o1.counts.R_APPROVED >= 1, `UNPROVED=${o1.counts.R_APPROVED}（期望 ≥1）`);
    }

    // 架空形 L（第三轮复审 P2-①）：文件里有一次**哑元**核对（实参无关）+ 两条转发写点 ⇒ 必须红
    const L = join(dir, 'l');
    mkdirSync(join(L, 'src/kernel'), { recursive: true });
    writeFileSync(join(L, 'src/kernel/relay3.ts'),
      `declare const raw: { run(s: string, ...p: unknown[]): void };\ndeclare const a: { eventType: string };\n`
      + `declare function formalEventOwner(t: string): string | undefined;\nformalEventOwner('占位');\n`
      + `raw.run('insert into ledger(seq, space, event_type) values(?,?,?)', 1, 'SP', a.eventType);\n`);
    const l1 = run({ implRoot: L });
    emit('MUT-R1 哑元核对 + 转发写点', 'R1', l1.counts.R1 >= 1, `R1=${l1.counts.R1}（期望 ≥1）`);

    // 架空形 I：gated_by 不在契约闭集 ⇒ UNPROVED
    const I = join(dir, 'i');
    mkdirSync(join(I, 'src/kernel'), { recursive: true });
    const anchorI = join(I, 'ledger.json');
    writeFileSync(anchorI, JSON.stringify({ schemaVersion: 1, approved: [], entries: [{ eventType: 'p-q', class: 'mechanism', planned: true, gated_by: 'G1-OTHER', writeSites: ['src/kernel/**'] }] }, null, 2));
    const i1 = run({ implRoot: I, anchorPath: anchorI });
    emit('MUT-R2 gated_by 不在闭集', 'R2', i1.counts.R_APPROVED === 1, `UNPROVED=${i1.counts.R_APPROVED}（期望 1）`);

  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  [${r.phase}] ${r.name} —— ${r.extra}`);
  const failed = results.filter((r) => !r.ok);
  console.log(failed.length ? `\n自验失败：${failed.length} 条判据的架空形未被捕获` : `\n自验通过：${results.length}/${results.length} 条架空形均被对应判据捕获。`);
  return failed.length ? 1 : 0;
}

/* ------------------------------------------------------------------ 入口 */

try {
  if (flag('--self-test')) process.exit(selfTest());

  if (argv.includes('--commit')) {
    const sha = opt('--commit');
    const bad = checkCoupling(sha, resolve(REPO, opt('--impl-root', '.')));
    if (bad.length) { for (const b of bad) console.error(`FAIL [${b.code}] ${b.msg}`); process.exit(1); }
    console.log(`PASS [EVENT_RECON_COUPLING] 提交 ${sha.slice(0, 7)} 未同时改动名单语义行与写点模块`);
    process.exit(0);
  }

  const implRoot = resolve(REPO, opt('--impl-root', '.'));
  // `--anchor` 必须真正生效（第二轮复审 P1-1：声明了却没接线 = 静默 no-op，比没有更坏）
  const anchorPath = resolve(REPO, opt('--anchor', ANCHOR_PATH));
  const r = run({ implRoot, anchorPath });
  if (flag('--json')) console.log(JSON.stringify(r, null, 2));
  else {
    console.log(`扫描：impl-root=${r.implRoot} 文件=${r.scannedFiles} 期望=${r.expected}（planned=${r.planned}） 事实=${r.facts}`);
    for (const p of r.problems) console.error(`FAIL [${p.code}] ${p.msg}`);
    console.log(`R1=${r.counts.R1} R2=${r.counts.R2} R3=${r.counts.R3} UNPROVED=${r.counts.R_APPROVED}`);
  }
  process.exit(r.problems.length ? 1 : 0);
} catch (e) {
  console.error(`events-recon 环境/用法错误：${e && e.message ? e.message : e}`);
  process.exit(2);
}
