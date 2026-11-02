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
import { readFileSync, readdirSync, statSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
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

/** 从一个文件里抽出「写点事件名」字面量集合 */
function factsFromFile(abs) {
  const text = readFileSync(abs, 'utf8');
  const sf = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true, abs.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const names = new Map(); // name -> first line
  const add = (lit, node) => {
    if (!NAME_RE.test(lit)) return;
    const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    if (!names.has(lit)) names.set(lit, line);
  };
  const litText = (n) => (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) ? n.text : null);

  const visit = (node) => {
    // (a) 属性 eventType: '<lit>'（appendLedger({eventType}) 形）
    if (ts.isPropertyAssignment(node)) {
      const key = node.name && (ts.isIdentifier(node.name) ? node.name.text : ts.isStringLiteral(node.name) ? node.name.text : '');
      if (key === 'eventType') {
        const direct = litText(node.initializer);
        if (direct) add(direct, node);
        else collectLits(node.initializer, (l, n) => add(l, n));
      }
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
        if (value) collectLits(value, (l, n) => add(l, n));
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
  const collectLits = (node, cb) => {
    const walk = (n) => {
      const t = litText(n);
      if (t) { cb(t, n); return; }
      ts.forEachChild(n, walk);
    };
    walk(node);
  };
  visit(sf);
  return names;
}

function collectFacts(implRoot, byName) {
  const globs = new Set();
  for (const e of byName.values()) for (const g of e.writeSites ?? []) globs.add(g);
  const files = walkFiles(implRoot, [...globs]);
  const facts = new Map(); // name -> {file, line}
  for (const f of files) {
    for (const [n, line] of factsFromFile(f)) {
      if (!facts.has(n)) facts.set(n, { file: relative(implRoot, f).split(sep).join('/'), line });
    }
  }
  return { files, facts };
}

/* ------------------------------------------------------------------ 判据 */

function checkR1(facts, byName) {
  const bad = [...facts.entries()].filter(([n]) => !byName.has(n));
  return bad.map(([n, loc]) => ({ code: 'EVENT_RECON_ORPHAN', name: n, ...loc, msg: `写点出现名单外事件名 ${n}（${loc.file}:${loc.line}）` }));
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
    if (e.planned === true && typeof e.gated_by === 'string' && e.gated_by) continue;
    bad.push({ code: 'EVENT_RECON_UNPROVED', name: n, msg: `机制条目 ${n} 缺 Approved-By 覆盖（anchor 需以 #${n} 结尾），且非带 gated_by 的 planned 条目` });
  }
  return bad;
}

function checkR3(scriptPath = import.meta.filename) {
  const src = readFileSync(scriptPath, 'utf8');
  const bad = [];
  // 不得 import src/** 或 experiments/** 的写点模块
  for (const m of src.matchAll(/^\s*import[^;]*?from\s+['"]([^'"]+)['"]/gm)) {
    if (/(^|\/)(src|experiments)\//.test(m[1])) bad.push({ code: 'EVENT_RECON_SAMESOURCE', msg: `脚本 import 了写点/实验模块：${m[1]}` });
  }
  // 期望集只读锚文件：不得出现第二个 JSON 读取路径作为期望源
  const jsonReads = [...src.matchAll(/readFileSync\(\s*([A-Za-z_$][\w$]*|['"][^'"]+['"])/g)].map((m) => m[1]);
  const allowed = new Set(['anchorPath', 'raw', 'abs', 'f', 'scriptPath', 'p', 'file']);
  for (const r of jsonReads) if (!allowed.has(r) && !/^['"]/.test(r)) bad.push({ code: 'EVENT_RECON_SAMESOURCE', msg: `可疑的额外读取源：${r}` });
  return bad;
}

/* --commit：R4 单提交耦合检查 */

const LEDGER_REL = 'contracts/event-registry/EVENT-CONTRACT-LEDGER.json';

function checkCoupling(sha, cwd = REPO) {
  const git = (...a) => execFileSync('git', a, { cwd, encoding: 'utf8' });
  const files = git('show', '--name-only', '--format=', sha).split('\n').filter(Boolean);
  const touchesLedger = files.includes(LEDGER_REL);
  const writeModules = files.filter((f) => /^src\/kernel\//.test(f) || /^src\/storage-sqlite\//.test(f));
  if (!touchesLedger || writeModules.length === 0) return [];
  const diff = git('show', '--format=', sha, '--', LEDGER_REL);
  const changed = diff.split('\n').filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l));
  const exempt = (l) => {
    const body = l.slice(1).trim();
    if (!body || body === ',' || body === '{' || body === '}' || body === '[' || body === ']') return true;
    if (/"approvedBy"|"approvedOn"|"anchor"/.test(body)) return true;            // approved[] 追加（EA-2.4 步骤 3）
    if (/"planned"\s*:\s*(true|false)/.test(body)) return true;                  // planned 翻转（R4 豁免）
    return false;
  };
  const semantic = changed.filter((l) => !exempt(l));
  return semantic.length
    ? [{ code: 'EVENT_RECON_COUPLING', msg: `提交 ${sha.slice(0, 7)} 同时改了名单语义行与写点模块（${writeModules.slice(0, 3).join(', ')}…）：语义行须与写点分居两提交`, lines: semantic.slice(0, 5) }]
    : [];
}

/* ------------------------------------------------------------------ 主流程 */

function run({ implRoot }) {
  const { doc, byName } = loadExpected();
  const approvedSet = new Set();
  for (const a of doc.approved) {
    const m = /#([a-z][a-z0-9-]*)$/.exec(String(a.anchor ?? ''));
    if (m) approvedSet.add(m[1]);
  }
  const { files, facts } = collectFacts(implRoot, byName);
  const problems = [
    ...checkR1(facts, byName),
    ...checkR2(facts, byName, approvedSet),
    ...checkR3(),
  ];
  return {
    implRoot: relative(REPO, implRoot).split(sep).join('/') || '.',
    scannedFiles: files.length,
    expected: byName.size,
    planned: [...byName.values()].filter((e) => e.planned === true).length,
    facts: facts.size,
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
    const g = (...args) => execFileSync('git', args, { cwd: D, encoding: 'utf8' });
    g('init', '-q'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
    mkdirSync(join(D, 'src/kernel'), { recursive: true });
    mkdirSync(join(D, 'contracts/event-registry'), { recursive: true });
    writeFileSync(join(D, 'src/kernel/k.ts'), `export const a = 1;\n`);
    writeFileSync(join(D, LEDGER_REL), JSON.stringify({ schemaVersion: 1, approved: [], entries: [{ eventType: 'x-y', class: 'mechanism', planned: false }] }, null, 2));
    g('add', '.');
    g('commit', '-qm', 'coupled');
    const sha = g('rev-parse', 'HEAD').trim();
    const d = checkCoupling(sha, D);
    emit('MUT-R4 同提交耦合', 'R4', d.length === 1, `R4=${d.length}（期望 1）`);

    // 对照 1：只改名单（approved 追加 + planned 翻转），不动写点模块 ⇒ 不算耦合（防误报）
    writeFileSync(join(D, LEDGER_REL), JSON.stringify({ schemaVersion: 1, approved: [{ approvedBy: 'x', approvedOn: 'y', anchor: 'z#x-y' }], entries: [{ eventType: 'x-y', class: 'mechanism', planned: false }] }, null, 2));
    g('add', '.'); g('commit', '-qm', 'ledger-only');
    const e = checkCoupling(g('rev-parse', 'HEAD').trim(), D);
    emit('对照1：只改名单（approved 追加/planned 翻转）不算耦合', 'R4', e.length === 0, `R4=${e.length}（期望 0）`);

    // 对照 2：同提交改名单语义行（eventType 更名）+ 写点 ⇒ 仍须红（防豁免过宽）
    writeFileSync(join(D, LEDGER_REL), JSON.stringify({ schemaVersion: 1, approved: [{ approvedBy: 'x', approvedOn: 'y', anchor: 'z#x-y' }], entries: [{ eventType: 'x-z', class: 'mechanism', planned: false }] }, null, 2));
    writeFileSync(join(D, 'src/kernel/k.ts'), `export const a = 3;\n`);
    g('add', '.'); g('commit', '-qm', 'semantic-coupled');
    const f = checkCoupling(g('rev-parse', 'HEAD').trim(), D);
    emit('对照2：语义行（eventType 更名）+ 写点同提交仍红', 'R4', f.length === 1, `R4=${f.length}（期望 1）`);
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
    const bad = checkCoupling(sha);
    if (bad.length) { for (const b of bad) console.error(`FAIL [${b.code}] ${b.msg}`); process.exit(1); }
    console.log(`PASS [EVENT_RECON_COUPLING] 提交 ${sha.slice(0, 7)} 未同时改动名单语义行与写点模块`);
    process.exit(0);
  }

  const implRoot = resolve(REPO, opt('--impl-root', '.'));
  const r = run({ implRoot });
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
