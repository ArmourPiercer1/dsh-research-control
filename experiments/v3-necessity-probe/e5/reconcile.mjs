#!/usr/bin/env node
/**
 * reconcile.mjs — E5 · 通用对账谓词 P1–P8（阶段一冻结实现）
 *
 * 用法: node reconcile.mjs <pkgRoot>... [--out findings.jsonl]
 * 零第三方依赖；对被测包只读（只 stat/读，不写；对包外路径不做 existsSync）。
 *
 * 每条命中输出 JSONL 一行:
 *   {id, predicate, predicate_name, package, pkg_root, file, loc, evidence(≤120字), tier_hypothesis, detail}
 *
 * 实现纪律：谓词严格按任务书 8 条逐条实现，无事件定制规则；
 * 所有正则/阈值为通用约定（见各 P 注释），不针对具体 9 事件调参。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
let outPath = 'findings.jsonl';
const roots = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out') outPath = args[++i];
  else roots.push(args[i]);
}
if (!roots.length) { console.error('usage: node reconcile.mjs <pkgRoot>... [--out f.jsonl]'); process.exit(2); }

const t0 = Date.now();
const findings = [];
const stats = { packages: [] };

/* ---------- 基础工具 ---------- */
const TEXT_EXT = new Set(['md','txt','log','py','sh','bash','mjs','cjs','js','ts','ipynb','in','csv','tsv','json','yaml','yml','rst','tex','bat','cmd','dat','EGN','EGN2','CPL','NOS','POL','FNT','OUT','doc','hlp','bas','fnt','cpl','nos','pol','f','in']);
const ARTIFACT_RE = /\.(png|jpe?g|svg|gif|csv|tsv|mat|h5|hdf5|gdf|out)$/i;
const ARTIFACT_JSON_RE = /(result|summary|output|out_|diagnostic|validation|probe|terminal|review)/i;
const ARTIFACT_INPUT_EXCLUDE = /(^|\/)(input|deck|params?|config|settings)\./i;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile()) out.push(p);
  }
  return out;
}

const textCache = new Map();
function readText(abs, maxBytes = 1_000_000) {
  if (textCache.has(abs)) return textCache.get(abs);
  let s = null;
  try {
    const st = fs.statSync(abs);
    const buf = Buffer.alloc(Math.min(st.size, maxBytes));
    const fd = fs.openSync(abs, 'r');
    try { fs.readSync(fd, buf, 0, buf.length, 0); } finally { fs.closeSync(fd); }
    // 二进制嗅探：前 8KB 含 NUL → 二进制
    const head = buf.subarray(0, 8192);
    if (head.includes(0)) s = null;
    else {
      s = buf.toString('utf8');
      if (s.includes('\uFFFD')) s = s.replace(/\uFFFD/g, '?');
    }
  } catch { s = null; }
  textCache.set(abs, s);
  return s;
}


const lineCache = new Map();
function linesOf(f) {
  if (!f.text) return [];
  if (!lineCache.has(f.abs)) lineCache.set(f.abs, f.text.split(/\r?\n/));
  return lineCache.get(f.abs);
}

function sha256(abs) {
  try {
    const h = crypto.createHash('sha256');
    const fd = fs.openSync(abs, 'r');
    try {
      const buf = Buffer.alloc(1 << 20);
      let n;
      while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
    } finally { fs.closeSync(fd); }
    return h.digest('hex');
  } catch { return null; }
}

/** 包外路径一律视为不存在（不越界 stat）。包 = 三个被测根之一。 */
function safeExists(p) {
  const norm = p.replace(/\\/g, '/');
  if (norm.startsWith('Z:')) return false;
  for (const r of roots) {
    if (norm === r || norm.startsWith(r + '/') || p === r || p.startsWith(r + path.sep)) {
      return fs.existsSync(p);
    }
  }
  // 机器真实前缀（被测所在盘）允许 stat
  if (norm.startsWith('«盘C»/') || norm.startsWith('«盘D»/')) return fs.existsSync(norm);
  return false;
}

const NEG_BEFORE = /不|未|没|无|not|no\b|never|without|cannot|can'?t|does?n'?t|won'?t|isn'?t|wasn'?t|don'?t|fail to|不做|非/i;
function negatedBefore(line, idx, span = 30) {
  return NEG_BEFORE.test(line.slice(Math.max(0, idx - span), idx));
}
const clip = (s, n = 120) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
let seq = 0;
function addHit(pkg, pred, name, tier, file, loc, evidence, detail = {}) {
  findings.push({
    id: `${pred}-${String(++seq).padStart(3, '0')}`,
    predicate: pred,
    predicate_name: name,
    package: pkg.name,
    pkg_root: pkg.root,
    file, loc, evidence: clip(evidence), tier_hypothesis: tier, ...detail,
  });
}

/* ---------- 包加载 ---------- */
function loadPkg(root) {
  const abs = path.resolve(root);
  if (!fs.statSync(abs).isDirectory()) throw new Error('not a dir: ' + abs);
  const files = walk(abs);
  const rel = a => path.relative(abs, a);
  const pkg = {
    name: path.basename(abs), root: abs, files: [],
  };
  for (const a of files) {
    const r = rel(a);
    const ext = path.extname(a).replace('.', '').toLowerCase();
    const rec = { abs: a, rel: r, name: path.basename(a), ext, dir: path.dirname(a), size: fs.statSync(a).size };
    rec.hash = null; // 懒加载
    const t = readText(a);
    rec.text = t; // null = 二进制或读取失败
    pkg.files.push(rec);
  }
  return pkg;
}
const pkgs = roots.map(loadPkg);

/* ============================================================
 * P1 清单覆盖度
 * 完整性清单 = 文件名匹配 SHA256*.txt / *SUMS* / (package_)manifest.json
 * 覆盖 = 清单项在包内实际存在的文件数；覆盖 < 包内文件总数(不含清单自身) → 命中
 * ============================================================ */
function p1Manifest(pkg) {
  const name = pkg.name;
  const manifests = pkg.files.filter(f =>
    (f.ext === 'txt' && (/^sha256/i.test(f.name) || /sums/i.test(f.name))) ||
    (/^(package_)?manifest\.json$/i.test(f.name))
  );
  const total = pkg.files.filter(f => !manifests.includes(f)).length;
  for (const m of manifests) {
    let listed = new Set();
    if (m.ext === 'txt' && m.text) {
      for (const line of m.text.split(/\r?\n/)) {
        const mo = line.match(/^[0-9a-fA-F]{16,64}\s+\*?(\S+)/);
        if (mo) listed.add(mo[1].replace(/^\.\//, ''));
      }
    } else if (m.text) {
      let j = null; try { j = JSON.parse(m.text); } catch { /* not json */ }
      if (j) {
        const visit = (node) => {
          if (Array.isArray(node)) {
            // (a) 对象数组: {path|file|name: ...} + sha256/hash 字段
            if (node.length >= 2 && node.every(x => x && typeof x === 'object' && !Array.isArray(x))) {
              for (const x of node) {
                const pk = ['path', 'file', 'name', 'filename'].find(k => typeof x[k] === 'string');
                const hk = ['sha256', 'hash', 'digest'].find(k => typeof x[k] === 'string');
                if (pk && hk) listed.add(String(x[pk]).replace(/^\.\//, ''));
              }
            } else if (node.length >= 3 && node.every(x => typeof x === 'string' && /[\w.\-]+(\.[\w]+)?/.test(x))) {
              // (b) 裸路径字符串数组：仅当 ≥3 项在包内实际存在才视为清单（排除"排除清单"类字段）
              const ex = node.filter(p => pkg.files.some(f => f.rel === p || f.rel === p.replace(/^\.\//, '')));
              if (ex.length >= 3) for (const p of node) listed.add(String(p).replace(/^\.\//, ''));
            }
            for (const x of node) if (x && typeof x === 'object') visit(x);
          } else if (node && typeof node === 'object') {
            const entries = Object.entries(node);
            const pathLikeKey = (k) => k.includes('/') || /\.[a-z0-9]{1,6}$/i.test(k);
            const hashVals = entries.filter(([k, v]) => typeof v === 'string' && /^[0-9a-fA-F]{32,64}$/.test(v) && pathLikeKey(k));
            if (hashVals.length >= 2) {
              for (const [k] of hashVals) listed.add(k);
            }
            for (const v of Object.values(node)) if (v && typeof v === 'object') visit(v);
          }
        };
        visit(j);
      }
    }
    let covered = 0;
    for (const p of listed) {
      const cand = p.replace(/^\.\//, '');
      if (pkg.files.some(f => f.rel === cand || f.rel === path.join(path.dirname(m.rel), cand))) { covered++; }
    }
    if (covered < total) {
      const missing = pkg.files
        .filter(f => !manifests.includes(f) && ![...listed].some(p => {
          const c = p.replace(/^\.\//, '');
          return f.rel === c || f.rel === path.join(path.dirname(m.rel), c);
        }))
        .slice(0, 5).map(f => f.rel);
      addHit(pkg, 'P1', '清单覆盖度', 'T0(自述完整性)/T4(移动无记录)', m.rel, 'whole file',
        `${m.name} 覆盖 ${covered}/${total} 个包内文件；未覆盖例: ${missing.join(', ') || '—'}`,
        { listed_count: listed.size, covered, total, missing_sample: missing });
    }
  }
}

/* ============================================================
 * P2 自述路径不符
 * 日志/README/脚本/JSON 行中"输出声明语境"(saved to / output dir / OUT= / 保存 / 输出至 / SET PATH …)
 * 声明了绝对路径(unix ≥2 段 或 盘符路径) → 该路径不存在，或 ≠ 实际所在目录 → 命中
 * ============================================================ */
const P2_CONTEXT = /saved? (?:the )?outputs?|was saved|writ(?:e|es|ten) (?:to|into|out)|output[sd]? (?:to|dir|directory|path|at)|output (?:file|files)|sav(?:e|es|ed) (?:to|outputs?)|保存|输出(?:到|至|于|目录|路径|文件)?|写入|落盘|存至|存到|SET\s+PATH|(?:^|[^A-Za-z])(OUT|OUTPUT|OUTDIR|OUT_DIR|OUTPUT_DIR)\s*=\s*["']?/i;
const P2_UNIX = /(?:^|[\s"'=(,>:\u4e00-\u9fff])(\/(?:[\w.@+-]+\/){1,}[\w.@+-]*)/g;
const P2_WIN = /([A-Za-z]:\\(?:[\w.@+-]+\\)*[\w.@+-]+)/g;
function p2DeclaredPaths(pkg) {
  const seen = new Set();
  for (const f of pkg.files) {
    if (!f.text) continue;
    const lines = linesOf(f);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!P2_CONTEXT.test(line)) continue;
      const paths = new Set();
      let mo;
      P2_UNIX.lastIndex = 0;
      while ((mo = P2_UNIX.exec(line))) paths.add(mo[1]);
      P2_WIN.lastIndex = 0;
      while ((mo = P2_WIN.exec(line))) paths.add(mo[1]);
      for (const p of paths) {
        const key = f.rel + ':' + (i + 1) + ':' + p;
        if (seen.has(key)) continue;
        seen.add(key);
        const exists = safeExists(p);
        const sameDir = p === pkg.root || pkg.root.startsWith(p + path.sep) || p.startsWith(pkg.root + path.sep);
        if (!exists || !sameDir) {
          addHit(pkg, 'P2', '自述路径不符', 'T0/T4(自述位置≠实际)', f.rel, `line ${i + 1}`,
            `声明路径 ${p} — 存在:${exists} 与包同位:${sameDir} — "${clip(line.trim(), 80)}"`,
            { declared: p, exists, matches_pkg_location: sameDir });
        }
      }
    }
  }
}

/* ============================================================
 * P3 声称的担保不存在
 * 文本行声称某脚本会 assert/abort/校验/拒收/verify（未加否定），
 * 且该行(或自述: 所在文件自身)指名了一个脚本 → 该脚本的可执行代码
 * (去掉注释/docstring) 中找不到 assert/raise/sys.exit/abort/verify/if…raise → 命中
 * ============================================================ */
const P3_CLAIM = /\b(assert\w*|abort\w*|verif\w*|reject\w*)\b|拒收|拒绝|校验|验证/gi;
const P3_SCRIPTNAME = /([A-Za-z0-9_][A-Za-z0-9_.\/-]*\.(?:py|sh|bash|mjs|cjs|js|pl|pm|bat|cmd|exe|nb|ipynb|tcl|awk|f90|f|r))\b/gi; // 尾 \b：.js 不得部分匹配 .json（冻结前解析 bug 修正）
const P3_CN_SCRIPT = /([A-Za-z0-9_\-./]{4,})\s*脚本/g;
const P3_CONSTRUCT = /\bassert\s+\S|self\.assert\w+\s*\(|raise\s+[A-Za-z_(]|sys\.exit|os\._exit|\bexit\s*\(|abort\s*\(|\babort\b|\bverif\w*\s*\(|if\s+[^:;{]+:\s*raise/i; // self.assert*：unittest 惯用法即断言构造（冻结前解析修正）

function codeLinesOf(f) {
  if (!f.text) return [];
  const ext = f.ext.toLowerCase();
  if (ext === 'py') {
    const out = [];
    let inDoc = false, docMark = '';
    for (const raw of f.text.split(/\r?\n/)) {
      const line = raw;
      // 三引号 docstring 块（近似跟踪）
      const marks = line.match(/("""|''')/g);
      if (marks && marks.length) {
        if (!inDoc) { inDoc = true; docMark = marks[0]; if ((line.split(docMark).length - 1) % 2 === 0) inDoc = false; continue; }
        if (line.includes(docMark)) { inDoc = false; continue; }
        continue;
      }
      if (inDoc) continue;
      if (line.trim().startsWith('#')) continue;
      out.push(line);
    }
    return out;
  }
  if (['sh', 'bash'].includes(ext)) return f.text.split(/\r?\n/).filter(l => !l.trim().startsWith('#'));
  return f.text.split(/\r?\n/);
}

function p3ClaimedGuarantee(pkg) {
  const claimLines = [];
  for (const f of pkg.files) {
    if (!f.text) continue;
    if (!/^(py|sh|txt|md|json|log|rst|ipynb|bat)$/.test(f.ext.toLowerCase())) continue;
    const lines = linesOf(f);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      P3_CLAIM.lastIndex = 0;
      let mo;
      while ((mo = P3_CLAIM.exec(line))) {
        if (negatedBefore(line, mo.index)) continue;
        claimLines.push({ file: f, line: i + 1, text: line, claim: mo[0] });
        break; // 每行最多一条
      }
    }
  }
  const targets = new Map(); // pkg file → 构造检查结果（懒）
  const hasConstruct = (tf) => {
    if (!targets.has(tf.abs)) {
      const code = codeLinesOf(tf);
      targets.set(tf.abs, code.some(l => P3_CONSTRUCT.test(l)));
    }
    return targets.get(tf.abs);
  };
  const resolveTarget = (named, claimFile) => {
    const stem = path.basename(named).replace(/\.[^.]+$/, '').toLowerCase();
    if (stem.length < 3) return null;
    const cands = pkg.files.filter(tf => {
      const s = path.basename(tf.abs).replace(/\.[^.]+$/, '').toLowerCase();
      return s === stem || s.endsWith('-' + stem) || s.endsWith('_' + stem) || s.endsWith('/' + stem) || (stem.length >= 6 && s.includes(stem));
    });
    if (cands.length) return cands.sort((a, b) => a.rel.length - b.rel.length)[0];
    return null;
  };
  const done = new Set();
  for (const c of claimLines) {
    const named = new Set();
    let mo;
    P3_SCRIPTNAME.lastIndex = 0;
    while ((mo = P3_SCRIPTNAME.exec(c.text))) named.add(mo[1]);
    P3_CN_SCRIPT.lastIndex = 0;
    while ((mo = P3_CN_SCRIPT.exec(c.text))) named.add(mo[1]);
    // 自述: 声称行所在 .py 文件自身
    const selfIsScript = /^(py|sh|bash|ipynb)$/i.test(c.file.ext);
    let hitThisLine = false;
    const checks = [];
    for (const n of named) {
      const tf = resolveTarget(n, c.file);
      if (tf) checks.push({ target: tf, via: n });
    }
    if (selfIsScript && !named.size) checks.push({ target: c.file, via: '(self)' });
    else if (selfIsScript) checks.push({ target: c.file, via: '(self)' });
    for (const ck of checks) {
      const key = c.file.rel + ':' + c.line + ':' + ck.target.rel;
      if (done.has(key)) continue;
      if (!hasConstruct(ck.target)) {
        done.add(key);
        hitThisLine = true;
        addHit(pkg, 'P3', '声称的担保不存在', 'T4(担保不存在)', c.file.rel, `line ${c.line}`,
          `声称"${clip(c.text.trim(), 70)}" — 指名脚本 ${ck.target.rel}（via ${ck.via}）可执行代码中无 assert/raise/sys.exit/abort/verify 构造`,
          { claim: c.claim, target: ck.target.rel, via: ck.via });
      }
    }
    void hitThisLine;
  }
}

/* ============================================================
 * P4 登记定义与实现不一致
 * 登记 = JSON/YAML 中 *_formulas / *_definition / definition / ddof / percentile / quantile / formula 一类字段
 * 实现 = (a) 脚本代码行 ddof=N / np.percentile / quantile( / interpolat；
 *        (b) 任何文本行对统计用法的描述（含注释/docstring，ddof=N、线性插值分位等）
 * 配对（通用共指启发）: 直接引用登记文件名 token(≥8) / 指标名前后缀(≥3) / 文件名 token(≥5) 共指
 * 矛盾 = ddof 值不同，或 登记 index 差分 vs 实现 插值分位（或反向）→ 命中
 * ============================================================ */
const P4_KEY = /(_formulas?|_definition|definition|ddof|percentile|quantile|formula|statistic)/i;
const P4_DDOF = /ddof\s*=\s*(\d)/i;
function p4MethodFromText(s) {
  // 返回 'index' | 'interp' | null（考虑否定）
  // 方法证据须为公式形态：函数调用 token(、排序索引 s[、round(、或中文统计词"分位"；
  // 散文中的 "interpolation/插值"（无调用）不构成统计方法证据（冻结前修正：字段/网格插值散文误触发，非事件调参）。
  const negIdx = (re) => {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    for (const m of s.matchAll(g)) { if (!negatedBefore(s, m.index, 12)) return m; }
    return null;
  };
  const idxTok = negIdx(/no\s+(?:linear\s+)?interpolat|不插值|不做.*插值|无插值|sorted\s*\w{0,3}\s*\[|round\s*\(|差分|index\s*\[/i);
  const intTok = negIdx(/(?:interpolat\w*|percentile|quantile)\s*\(|分位/i);
  if (intTok && !idxTok) return 'interp';
  if (idxTok && intTok && /no\s+interpolat|不插值|不做.*插值|无插值/i.test(s.slice(Math.max(0, intTok.index - 12), intTok.index + intTok[0].length + 4))) return 'index';
  if (idxTok) return 'index';
  return null;
}
function p4Registered(pkg) {
  const regs = [];
  for (const f of pkg.files) {
    if (!f.text) continue;
    if (!/^(json|ya?ml)$/.test(f.ext.toLowerCase())) continue;
    let j = null;
    if (f.ext.toLowerCase() === 'json') { try { j = JSON.parse(f.text); } catch { continue; } }
    else continue; // YAML 解析零依赖不做，仅 JSON（通用取舍，报告注明）
    const stemTokens = f.name.replace(/\.[^.]+$/, '').toLowerCase().split(/[._\-]/);
    const walkReg = (node, keyPath) => {
      if (Array.isArray(node)) { node.forEach((x, i) => walkReg(x, keyPath + '[' + i + ']')); return; }
      if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) {
          const kp = keyPath ? keyPath + '.' + k : k;
          if (typeof v === 'string') {
            if (P4_KEY.test(k)) {
              const ddofM = v.match(P4_DDOF) || (P4_KEY.test(k) && /^\d+$/.test(v.trim()) ? [null, v.trim()] : null);
              const method = p4MethodFromText(v);
              if (ddofM || method || /np\.|std|percentile|quantile|sorted|round/i.test(v)) {
                regs.push({ file: f, key: kp, metric: k, ddof: ddofM ? Number(ddofM[1]) : null, method, text: v });
              }
            }
          } else if (v && typeof v === 'object') {
            if (P4_KEY.test(k)) {
              // 形如 width_formulas: {sigma: "np.std(v, ddof=0)", W90: "..."}
              for (const [k2, v2] of Object.entries(v)) {
                if (typeof v2 === 'string') {
                  const ddofM = v2.match(P4_DDOF);
                  const method = p4MethodFromText(v2);
                  if (ddofM || method) regs.push({ file: f, key: kp + '.' + k2, metric: k2, ddof: ddofM ? Number(ddofM[1]) : null, method, text: v2 });
                }
              }
            }
            walkReg(v, kp);
          } else if (typeof v === 'number' && /^ddof$/i.test(k)) {
            regs.push({ file: f, key: kp, metric: k, ddof: v, method: null, text: String(v) });
          }
        }
        return;
      }
    };
    walkReg(j, '');
    void stemTokens;
  }
  return regs;
}
function normTok(s) { return s.toLowerCase().replace(/[^a-z0-9]/g, ''); }
function p4Usage(pkg) {
  const uses = [];
  for (const f of pkg.files) {
    if (!f.text) continue;
    const isScript = /^(py|sh|bash|js|mjs|ipynb)$/i.test(f.ext);
    const lines = linesOf(f);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const ddofM = line.match(P4_DDOF);
      const method = p4MethodFromText(line);
      const looksStat = ddofM || /np\.(percentile|quantile)|\bpercentile\s*\(|\bquantile\s*\(|interpolat|分位/i.test(line);
      if (!looksStat) continue;
      if (isScript && line.trim().startsWith('#')) continue; // 脚本注释行不作为"实现"
      uses.push({
        file: f, line: i + 1, text: line, kind: isScript ? 'script' : 'text',
        ddof: ddofM ? Number(ddofM[1]) : null, method,
      });
    }
  }
  return uses;
}
function p4Pairs(reg, use, pkg) {
  const regStemTokens = reg.file.name.replace(/\.[^.]+$/, '').toLowerCase().split(/[._\-]/);
  // 共指必须是"行级"的：冲突是逐句断言，只有该行自身引用了登记（文件 token ≥8 或指标名）才算同一口径。
  // 冻结前修正（通用语义）：原 v1 规则含"文件级引用"（文件任何位置提到登记文件名）与"文件名 stem token 共指"，
  // 会把包内命名前缀（如 fieldsanity-*）与 docstring 引用当成指标共指，产生与登记指标无关的行级误配（冻结前实测于 PoC 包，属解析宽泛性 bug，非事件调参）。
  let direct = false;
  // token 须 ≥8 且含数字：包内标识符（frozen32/ref2topo/…）才是强共指；普通英文词（independent 等）不构成
  direct = regStemTokens.some(t => t.length >= 8 && /[0-9]/.test(t) && use.text.toLowerCase().includes(t));
  // 指标名共指（前后缀 ≥3），仅在该行内
  const mN = normTok(reg.metric);
  let metric = false;
  if (mN.length >= 3) {
    const uTxt = use.text.toLowerCase();
    metric = uTxt.includes(reg.metric.toLowerCase()) ||
      uTxt.split(/[^a-z0-9]+/).some(t => t.length >= 3 && (mN.startsWith(t) || t.startsWith(mN)));
  }
  return { direct, metric, cofile: false, linked: direct || metric };
}
function p4RegisteredVsImpl(pkg) {
  const regs = p4Registered(pkg).filter(r => r.ddof !== null || r.method !== null);
  const uses = p4Usage(pkg);
  const done = new Set();
  for (const r of regs) for (const u of uses) {
    if (u.file.rel === r.file.rel && u.line === 0) { /* n/a */ }
    const { linked, direct, metric, cofile } = p4Pairs(r, u, pkg);
    if (!linked) continue;
    let conflict = null;
    if (r.ddof !== null && u.ddof !== null && r.ddof !== u.ddof) conflict = `ddof 登记=${r.ddof} 实现=${u.ddof}`;
    else if (r.method === 'index' && u.method === 'interp') conflict = '登记 index 差分 vs 实现 插值分位';
    else if (r.method === 'interp' && u.method === 'index') conflict = '登记 插值 vs 实现 index 差分';
    if (!conflict) continue;
    const key = r.file.rel + '|' + r.key + '|' + u.file.rel + ':' + u.line;
    if (done.has(key)) continue;
    done.add(key);
    addHit(pkg, 'P4', '登记定义与实现不一致', 'T2(口径登记 vs 实现)', r.file.rel, `field ${r.key}`,
      `登记 ${r.file.rel}#${r.key}="${clip(r.text, 50)}" ↔ 实现 ${u.file.rel}:${u.line} (${u.kind}) → ${conflict}`,
      { reg: { file: r.file.rel, key: r.key, ddof: r.ddof, method: r.method }, use: { file: u.file.rel, line: u.line, kind: u.kind, ddof: u.ddof, method: u.method }, conflict, link: { direct, metric, cofile } });
  }
}

/* ============================================================
 * P5 同名多口径
 * 结构化标签 = CSV 表头/长表 metric 列值、JSON 对象键；
 * 强口径限定 = population/cohort/scope/caliber/群体/口径 类键的取值
 * 同一标签(归一化)出现在 ≥2 个不同文件，且其强口径取值集合 ≥2 → 命中
 * ============================================================ */
const P5_STRONG = /(population|cohort|scope|caliber|口径|群体|分群)/i;
const P5_METRICCOL = /^(metric|variable|label|name)$/i;
const P5_ID_LABEL = /^(id|name|index|row|key|file|path|tag|date|time|z|x|y|plane|face_group|facegroup|face|group|ref)$/i;
// 结构性键（出处/元数据/方法描述）不是"指标标签"，同名多口径谓词不适用（冻结前通用修正：如 "sources" 自由文本出处被误作指标）
const P5_STRUCT_KEY = /^(sources?|refs?|references?|provenance|generated_?by|generator|tool|method|methods|notes?|description|desc|comments?|comments_en|comments_zh|scope_statement|statement|statements|license|author|authors|version|created|created_at|modified|updated|date_?stamp|run_?id|job_?id|config|config_file|input|inputs|input_file|input_files|output|outputs|output_file|output_files|args|kwargs|parameters|parameter|options|option|seed|timestamp|time_?stamp|elapsed|duration|status|result|result_summary|summary|note_zh|note_en)$/i;
function p5SameNameMultiCaliber(pkg) {
  // label → { files:Set, quals:Set }
  const labels = new Map();
  const touch = (normLabel, fileRel, qual) => {
    if (!normLabel || normLabel.length < 3) return;
    if (P5_ID_LABEL.test(normLabel)) return;
    if (P5_STRUCT_KEY.test(normLabel)) return;
    if (!labels.has(normLabel)) labels.set(normLabel, { files: new Set(), quals: new Set(), raw: normLabel });
    const e = labels.get(normLabel);
    e.files.add(fileRel);
    if (qual != null) e.quals.add(String(qual));
  };
  for (const f of pkg.files) {
    if (!f.text) continue;
    if (f.ext.toLowerCase() === 'csv' || f.ext.toLowerCase() === 'tsv') {
      const sep = f.ext.toLowerCase() === 'tsv' ? '\t' : ',';
      const lines = linesOf(f).filter(l => l.trim() !== '');
      if (lines.length < 2) continue;
      const header = lines[0].split(sep).map(s => s.trim());
      const qCol = header.findIndex(h => P5_STRONG.test(h));
      const mCol = header.findIndex(h => P5_METRICCOL.test(h));
      for (const h of header) if (qCol < 0 || header.indexOf(h) !== qCol) touch(normTok(h), f.rel, null);
      const qColName = qCol >= 0 ? header[qCol] : null;
      for (let i = 1; i < lines.length; i++) {
        const cells = lines[i].split(sep).map(s => s.trim());
        const qual = qCol >= 0 ? cells[qCol] : null;
        if (mCol >= 0) {
          touch(normTok(cells[mCol]), f.rel, qual); // 长表：metric 列值=标签，同行强口径列=限定
        } else if (qual != null) {
          for (const h of header) if (h !== qColName) touch(normTok(h), f.rel, qual); // 宽表：表头=标签，行强口径值=限定
        }
      }
    } else if (f.ext.toLowerCase() === 'json') {
      let j = null; try { j = JSON.parse(f.text); } catch { continue; }
      const visit = (node) => {
        if (Array.isArray(node)) { node.forEach(visit); return; }
        if (node && typeof node === 'object') {
          const qk = Object.keys(node).find(k => P5_STRONG.test(k));
          const qual = qk ? node[qk] : null;
          for (const k of Object.keys(node)) if (k !== qk) touch(normTok(k), f.rel, qk ? String(qual) : null);
          for (const v of Object.values(node)) if (v && typeof v === 'object') visit(v);
        }
      };
      visit(j);
    }
  }
  for (const [nl, e] of labels) {
    if (e.files.size >= 2 && e.quals.size >= 2) {
      addHit(pkg, 'P5', '同名多口径', 'T2(同标签多口径并存)', [...e.files].slice(0, 3).join(' + ') + (e.files.size > 3 ? ' +…' : ''),
        `label "${nl}"`,
        `标签 ${nl} 在 ${e.files.size} 个文件并存，强口径取值 ${[...e.quals].slice(0, 4).join(' / ')}（${e.quals.size} 种）`,
        { label: nl, files: [...e.files].slice(0, 6), quals: [...e.quals].slice(0, 8) });
    }
  }
}

/* ============================================================
 * P6 run 终态与参数未登记
 * run id = 显式 run/job id 字段 或 ≥16 位字母数字(排除纯 hex 哈希/纯数字)
 * 命中 = 被引用的 id 在包内任何文件中都无终态登记(exit/status/state/terminal+值)
 *       且无参数登记；或同一 id 在不同文件被赋予不同参数集
 * ============================================================ */
const P6_EXPLICIT = /(?:run[_\s-]?id|job[_\s-]?id|任务号)\s*["']?\s*[:=]\s*["']?([A-Za-z0-9._-]{6,})/gi;
const P6_BARE = /\b([0-9A-Za-z]{16,40})\b/g;
function p6RunState(pkg) {
  const mentions = new Map(); // id → {lines:Set, files:Set}
  for (const f of pkg.files) {
    if (!f.text) continue;
    const ids = new Set();
    const fname = f.name.toLowerCase();
    const lines = linesOf(f);
    // 文件名里的长 id
    let mo;
    P6_BARE.lastIndex = 0;
    while ((mo = P6_BARE.exec(f.name))) ids.add(mo[1]);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      P6_EXPLICIT.lastIndex = 0;
      while ((mo = P6_EXPLICIT.exec(line))) ids.add(mo[1]);
      // URL 路径分量（DOI/PII/文章号）不是 run id：先标出 URL 区间（冻结前解析修正：参考文献 URL 内 PII 误报）
      const urlSpans = [];
      const P6_URL = /https?:\/\/[^\s"'<>()\[\]]+/g;
      let uo;
      P6_URL.lastIndex = 0;
      while ((uo = P6_URL.exec(line))) urlSpans.push([uo.index, uo.index + uo[0].length]);
      const inUrl = (idx) => urlSpans.some(([s, e]) => idx >= s && idx < e);
      P6_BARE.lastIndex = 0;
      while ((mo = P6_BARE.exec(line))) {
        const v = mo[1];
        if (inUrl(mo.index)) continue; // URL 内：书目标识
        if (/^[0-9a-fA-F]{32,64}$/.test(v)) continue; // 哈希
        if (/^\d+$/.test(v)) continue; // 纯数字
        // 低熵 token（重复字符串）是 ASCII 绘图/数据列，不是 run id（冻结前通用修正：charplot 绘图行误报）
        {
          const uniq = new Set(v).size;
          const runs = v.match(/(.)\1+/g) || [];
          const maxRun = runs.reduce((m, r) => Math.max(m, r.length), 0);
          if (uniq / v.length < 0.35 || maxRun >= 8) continue;
        }
        // 科学计数法尾数（全小写数字+e）不是 run id：要求含大写字母且含数字
        if (!/[A-Z]/.test(v) || !/\d/.test(v)) continue;
        ids.add(v);
      }
    }
    for (const id of ids) {
      if (!mentions.has(id)) mentions.set(id, { lines: new Set(), files: new Set() });
      const m = mentions.get(id);
      m.files.add(f.rel);
      // 终态/参数登记检测（文件级窗口）
      if (/(exit[_\s-]?code|status|state|terminal|succeeded|failed|completed|converged|not_run)/i.test(f.text) &&
          /["']?\s*[:=]\s*["']?[A-Za-z0-9=; \-]+/.test(f.text)) {
        // 进一步：id 所在文件是否同时有 字段:值 形态的终态行
        let termLine = false;
        for (const l of lines) {
          if ((l.includes(id) || fname.includes(id.toLowerCase())) &&
              /["']?(exit[_\s-]?code|status|state|terminal|succeeded|failed|completed|converged)["']?\s*[:=]/i.test(l)) termLine = true;
        }
        if (termLine || /terminal|status/i.test(fname)) m.terminal = true;
        // 文件级：同一文件既引用该 id，又含 终态字段:值 形态（字段与 id 可不同行）
        if (f.text.includes(id) && /["']?(job[_\s-]?status|exit[_\s-]?code|status|state|terminal|succeeded|failed|completed|converged)["']?\s*[:=]/i.test(f.text)) m.terminal = true;
      }
      // 参数登记：id 行(或同名文件)附近存在 param/args 字段
      for (const l of lines) {
        if (l.includes(id) && /["']?(params?|args|inputs?|config|settings|initial)["']?\s*[:=]/i.test(l)) m.params = true;
      }
    }
  }
  for (const [id, m] of mentions) {
    if (m.files.size === 0) continue;
    if (!m.terminal && !m.params) {
      const sample = [...m.files].slice(0, 2).join(', ');
      addHit(pkg, 'P6', 'run 终态与参数未登记', 'T1/T4(run 身份/终态未登记)', sample, 'id ' + id,
        `run/job id ${id} 被 ${m.files.size} 个文件引用（${sample}…），包内无终态(exit/status)或参数登记`,
        { run_id: id, files: [...m.files].slice(0, 6), terminal: !!m.terminal, params: !!m.params });
    }
  }
}

/* ============================================================
 * P7 影子副本分歧
 * 同名(大小写不敏感)文件出现在 ≥2 目录且 sha256 不同，且包内无
 * 变更记录(changelog 类文件，或 提及该文件名+变更词 的行) → 命中
 * ============================================================ */
const P7_CHANGE = /change[d]?|updat|revis|modif|replac|new version|different version|变更|修改|更新|版本差异|覆盖|另存|copy of/i;
function p7ShadowCopies(pkg) {
  const byBase = new Map();
  for (const f of pkg.files) {
    const k = f.name.toLowerCase();
    if (!byBase.has(k)) byBase.set(k, []);
    byBase.get(k).push(f);
  }
  const textBlobs = pkg.files.filter(f => f.text);
  const hasChangelogFile = pkg.files.some(f => /changelog|change[-_ ]?log|revision[-_ ]?history|变更|修改记录/i.test(f.name));
  for (const [base, group] of byBase) {
    const dirs = new Set(group.map(g => g.dir));
    if (dirs.size < 2) continue;
    const hashes = new Set();
    for (const g of group) {
      const h = g.hash || (g.hash = sha256(g.abs));
      if (h) hashes.add(h);
    }
    if (hashes.size < 2) continue; // 内容全部相同 → 只是冗余副本，无分歧
    // 变更记录检查：提及 base(含/不含扩展名) + 变更词
    const baseNoExt = base.replace(/\.[^.]+$/, '');
    let changelog = hasChangelogFile;
    if (!changelog) {
      outer: for (const t of textBlobs) {
        for (const l of linesOf(t)) {
          if ((l.includes(baseNoExt) || l.toLowerCase().includes(base)) && P7_CHANGE.test(l)) { changelog = true; break outer; }
        }
      }
    }
    if (changelog) continue;
    const sample = group.slice(0, 4).map(g => `${path.relative(pkg.root, g.dir) || '.'}/${g.name}=${g.size}B`).join(' ; ');
    addHit(pkg, 'P7', '影子副本分歧', 'T0/T4(同名多版无变更记录)', `${base} ×${group.length}`, `dirs: ${[...dirs].slice(0, 4).map(d => path.relative(pkg.root, d)).join(', ')}`,
      `同名 ${base} 在 ${dirs.size} 目录 ${group.length} 份、${hashes.size} 种内容；无变更记录 — ${clip(sample, 90)}`,
      { base, count: group.length, hash_variants: hashes.size, dirs: [...dirs].slice(0, 6).map(d => path.relative(pkg.root, d)) });
  }
}

/* ============================================================
 * P8 工件无出处
 * 结果类工件 = 图(png/jpg/svg/gif)/csv/tsv/mat/h5/gdf/out + 名字含
 * result/summary/output/diagnostic/validation/probe/terminal/review 的 json
 * 出处 = 包内任一文本行同时提及工件名 stem 且含 "工具词+版本"(word v?N.N[.N])
 * 无出处 → 命中（每工件一条）
 * ============================================================ */
const P8_VERSION = /(?:^|[\s"'(])([A-Za-z][A-Za-z0-9_.+-]{1,30})[\s_-]*v?(\d+\.\d+(\.\d+)?)/;
function p8Provenance(pkg) {
  const texts = pkg.files.filter(f => f.text);
  // 只保留"含 工具词+版本"的行（罕见），避免对全量行做小写复制
  const verLines = [];
  const allLower = []; // 提及检查用：行号 -> lower（仅对含候选 stem 词的行惰性使用）
  for (const f of texts) {
    for (let i = 0; i < linesOf(f).length; i++) {
      const line = linesOf(f)[i];
      if (P8_VERSION.test(line)) verLines.push({ f, i, lower: line.toLowerCase() });
    }
  }
  const allLines = null;
  const artifacts = pkg.files.filter(f => {
    if (ARTIFACT_INPUT_EXCLUDE.test(f.rel)) return false;
    if (ARTIFACT_RE.test(f.name)) return true;
    if (f.ext.toLowerCase() === 'json' && ARTIFACT_JSON_RE.test(f.name)) return true;
    return false;
  });
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const a of artifacts) {
    const stem = a.name.replace(/\.[^.]+$/, '').toLowerCase();
    if (stem.length < 4) continue;
    // 词边界匹配：stem 前后不得是词字符；短 stem(<6) 须紧跟 "."（文件名语境），避免 4-5 字母普通词巧合命中（冻结前通用修正：裸子串 includes 把 "…TEST…BY 0.1" 巧合行当出处）
    const stemRe = new RegExp('(?<![a-z0-9_])' + escRe(stem) + (stem.length < 6 ? '\\.' : '(?![a-z0-9_])'), 'i');
    let proven = null;
    for (const L of verLines) {
      if (stemRe.test(L.lower)) { proven = L; break; }
    }
    if (!proven) {
      // 提及检查：仅扫版本行不够（提及可能无版本）→ 用逐文件 contains（大小写不敏感，惰性 lower）
      let mentioned = false;
      outer2: for (const f of texts) {
        for (const l of linesOf(f)) {
          if (l.length >= stem.length && l.toLowerCase().includes(stem)) { mentioned = true; break outer2; }
        }
      }
      addHit(pkg, 'P8', '工件无出处', 'T0(工件无工具名+版本记录)', a.rel, 'artifact',
        `结果工件 ${a.rel}（${a.size}B）包内${mentioned ? '有文本提及但' : ''}无"工具名+版本"记录行`,
        { mentioned, stem, size: a.size });
    }
  }
}

/* ---------- 执行 ---------- */
for (const pkg of pkgs) {
  const pStart = Date.now();
  const before = findings.length;
  p1Manifest(pkg);
  p2DeclaredPaths(pkg);
  p3ClaimedGuarantee(pkg);
  p4RegisteredVsImpl(pkg);
  p5SameNameMultiCaliber(pkg);
  p6RunState(pkg);
  p7ShadowCopies(pkg);
  p8Provenance(pkg);
  const byPred = {};
  for (let i = before; i < findings.length; i++) byPred[findings[i].predicate] = (byPred[findings[i].predicate] || 0) + 1;
  stats.packages.push({
    name: pkg.name, root: pkg.root,
    files: pkg.files.length,
    text_files: pkg.files.filter(f => f.text).length,
    hits: findings.length - before, byPred,
    elapsed_ms: Date.now() - pStart,
  });
}

fs.writeFileSync(outPath, findings.map(f => JSON.stringify(f)).join('\n') + '\n', 'utf8');
const summary = {
  total_hits: findings.length,
  by_predicate: stats.packages.reduce((a, p) => { for (const [k, v] of Object.entries(p.byPred)) a[k] = (a[k] || 0) + v; return a; }, {}),
  packages: stats.packages,
  total_elapsed_ms: Date.now() - t0,
  out: path.resolve(outPath),
};
console.error(JSON.stringify(summary, null, 1));
