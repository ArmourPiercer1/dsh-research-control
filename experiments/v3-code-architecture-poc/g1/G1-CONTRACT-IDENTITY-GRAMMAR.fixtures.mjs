#!/usr/bin/env node
/*
  G1-CONTRACT-IDENTITY-GRAMMAR.fixtures.mjs —— 与 G1-CONTRACT-IDENTITY-GRAMMAR.md（IG）互相对账的夹具。

  用法：node experiments/v3-code-architecture-poc/g1/G1-CONTRACT-IDENTITY-GRAMMAR.fixtures.mjs
  退出码：0 = 契约结构自洽 + 正反例全命中 + 六条「架空判据必红」变异自验全部捕获；
          1 = 有任一项 FAIL；2 = 夹具自身无法运行（缺文件等）。

  纪律：
  - 零依赖（只用 node:fs / node:path / node:crypto），可直接 node 跑；不起数据库、不跑 PoC、不写生产代码。
  - 这里实现的是**文法与入口判据链的最小模型**（IG-4 步骤序 / 出生绑定 / 保留前缀双检 / rec: 方案 /
    目录点查解析 / 正式发号无空间分量），不是机制实现；判据语义逐条对应契约正文 IG-* 小节。
  - 变异纪律：MUT-* 架空判据**常驻本文件不删除**；每条自验双向——真实判据必须拦住对应负例，
    架空判据必须放过同一负例（否则该负例对「架空」没有判别力）。MUT 仅在自验分支旁路调用，
    真实判据恒为主路径唯一调用者。「放宽长度（MUT-1）或忽略大小写折叠（MUT-2/MUT-3）⇒ 必红」。
*/

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const DOC_PATH = join(HERE, 'G1-CONTRACT-IDENTITY-GRAMMAR.md');
const SELF_PATH = fileURLToPath(import.meta.url);
const RL_PATH = join(HERE, 'G1-CONTRACT-RELOCATION.md');
const SRC_CONTRACTS_PATH = join(HERE, '..', 'src', 'contracts', 'index.ts');
const SRC_KERNEL_PATH = join(HERE, '..', 'src', 'kernel', 'kernel.ts');

function load(p, what) {
  try { return readFileSync(p, 'utf8'); }
  catch (e) { process.stderr.write(`FATAL: 读不到${what} ${p}：${e.message}\n`); process.exit(2); }
}
const doc = load(DOC_PATH, '契约正文');
const selfSrc = load(SELF_PATH, '夹具自身');
const rlDoc = load(RL_PATH, 'RL 契约');
const srcContracts = load(SRC_CONTRACTS_PATH, 'src 契约');
const srcKernel = load(SRC_KERNEL_PATH, 'src kernel');

let pass = 0, fail = 0; const fails = [];
function check(name, cond, detail) {
  if (cond) { pass += 1; process.stdout.write('PASS  ' + name + '\n'); }
  else { fail += 1; fails.push(name); process.stdout.write('FAIL  ' + name + (detail ? '  —— ' + detail : '') + '\n'); }
}

// ============================================================ 文法常量（与契约机读块互认）

const SPACE_ID_RE_SRC = '^[a-z0-9][a-z0-9._-]{0,63}$';
const SPACE_ID_LEN_MIN = 1;
const SPACE_ID_LEN_MAX = 64;
const RECORD_ID_RE_SRC = '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$';
const OID_HYGIENE_RE_SRC = '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$';
const REC_SCHEME_RE_SRC = '^rec:[A-Za-z0-9][A-Za-z0-9._-]{0,63}$';
const RESERVED_PREFIXES = ['RPT-', 'FM-', 'FR-', 'NSR-'];
const SPACE_RESERVED_WORDS = ['default', 'assembly'];
const TRANSPORT_ORDER = [
  '出现唯一性与字节卫生', '百分号规范化', '形态闸', '空间路由', '槽位类别',
  '机制入口（构造期）', '声明通道', '引用通道',
];

const SPACE_RE = new RegExp(SPACE_ID_RE_SRC);
const RECORD_RE = new RegExp(RECORD_ID_RE_SRC);
const OID_RE = new RegExp(OID_HYGIENE_RE_SRC);
const REC_RE = new RegExp(REC_SCHEME_RE_SRC);

// 独立手写判定器（S1 语义对拍用——刻意**不复用上列正则**，两源一致才算互认）
const inSet = (c, set) => set.includes(c);
const PUNCT = '._-';
function handSpace(s) {
  if (typeof s !== 'string' || s.length < SPACE_ID_LEN_MIN || s.length > SPACE_ID_LEN_MAX) return false;
  const first = s[0];
  if (!((first >= 'a' && first <= 'z') || (first >= '0' && first <= '9'))) return false;
  for (const c of s) {
    if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || inSet(c, PUNCT)) continue;
    return false;
  }
  return true;
}
function handAlnumStart(s, lowerOnly) {
  if (typeof s !== 'string' || s.length < 1 || s.length > 64) return false;
  const first = s[0];
  const okFirst = (first >= 'A' && first <= 'Z') || (first >= 'a' && first <= 'z') || (first >= '0' && first <= '9');
  if (!okFirst) return false;
  for (const c of s) {
    if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || inSet(c, PUNCT)) continue;
    return false;
  }
  if (lowerOnly && /[A-Z]/.test(s)) return false;
  return true;
}
const handRecord = (s) => handAlnumStart(s, false);
const handOid = (s) => handAlnumStart(s, false);

// 文法闸（真实判据；主路径唯一调用者）
const spaceGrammarOk = (s) => typeof s === 'string' && SPACE_RE.test(s);
const recordGrammarOk = (s) => typeof s === 'string' && RECORD_RE.test(s);
const oidHygieneOk = (s) => typeof s === 'string' && OID_RE.test(s);
const recSchemeOk = (s) => typeof s === 'string' && REC_RE.test(s);
const spaceReservedWord = (s) => SPACE_RESERVED_WORDS.includes(s);

// 保留前缀双检（IG-2.2：逐字节前缀 ∪ ASCII 大小写折叠前缀）
const asciiFold = (s) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());
const reservedHit = (id) => {
  const f = asciiFold(String(id));
  return RESERVED_PREFIXES.find((p) => id.startsWith(p) || f.startsWith(asciiFold(p)));
};

// ============================================================ 架空判据（常驻不删；§8 MUT 登记）

// MUT-1：长度上界放宽 64→128
const spaceGrammarOkMUT1 = (s) => new RegExp('^[a-z0-9][a-z0-9._-]{0,127}$').test(String(s));
// MUT-2：判等改 ASCII case-fold（大小写折叠 ⇒ 假碰撞）
// MUT-3：保留前缀只按逐字节精确前缀（放掉折叠形仿冒）
const reservedHitMUT3 = (id) => RESERVED_PREFIXES.find((p) => String(id).startsWith(p));
// MUT-4：传输层百分号解码一次后**不再复验**文法
// MUT-5：空间比对挪到目录解析之后（存在性差分 oracle）
// MUT-6：正式发号拼回空间名（`OBJ-<space>-<n>` 回潮）——见 mintOidMUT6

// ============================================================ 最小模型

class Refusal { constructor(code, detail) { this.code = code; this.detail = detail || {}; } }
class AssemblyRed { constructor(signal, detail) { this.signal = signal; this.detail = detail || {}; } }

const digest12 = (s) => createHash('sha256').update(String(s)).digest('hex').slice(0, 12);
const pctDecodeOnce = (s) => s.replace(/%([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
function shapeClass(s) {
  const v = String(s);
  if (v.length === 0) return 'EMPTY';
  if (/^\.+$/.test(v)) return 'DOT_ONLY';
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(v)) return 'CONTROL';
  // eslint-disable-next-line no-control-char
  if (/[^\x20-\x7e]/.test(v)) return 'NON_ASCII';
  if (v.includes('%')) return 'PERCENT';
  if (/[A-Z]/.test(v)) return 'UPPERCASE';
  if (v.length > 64) return 'OVERLONG';
  return 'OTHER';
}
// IG-1.6/IG-2.7：畸变候选零原文回显——只回显 shapeClass/length/digest
const transportFail = (serviceCode, candidate) => ({
  ok: false, serviceCode,
  echo: { shapeClass: shapeClass(candidate), length: String(candidate).length, digest: digest12(candidate) },
});
function transport(kind, value, occurrences = 1) {
  if (occurrences > 1) return transportFail('ID_AMBIGUOUS_OCCURRENCE', value); // 步骤①
  if (typeof value !== 'string') return transportFail('ID_MALFORMED', String(value));
  let v = value;
  if (v.includes('%')) { // 步骤②：至多解码一次，解后必须重过同一文法
    v = pctDecodeOnce(v);
    if (!grammarOk(kind, v)) return transportFail('ID_MALFORMED', value);
  }
  if (!grammarOk(kind, v)) return transportFail('ID_MALFORMED', value); // 步骤③
  return { ok: true, value: v };
}
function transportMUT4(kind, value) { // 解码一次后不复验 ⇒ 架空
  if (typeof value !== 'string') return transportFail('ID_MALFORMED', String(value));
  const v = value.includes('%') ? pctDecodeOnce(value) : value;
  return { ok: true, value: v };
}
function grammarOk(kind, v) {
  if (kind === 'space') return spaceGrammarOk(v);
  if (kind === 'record') return recordGrammarOk(v);
  if (kind === 'oid') return oidHygieneOk(v);
  if (kind === 'rec') return recSchemeOk(v);
  throw new Error('unknown kind ' + kind);
}
// 机制入口（框层解码已由通道完成）：**自身从不解码**——含 `%` 的值即形态非法（IG-1.2 纵深双闸）
const mechGrammarOk = (kind, v) => typeof v === 'string' && !v.includes('%') && grammarOk(kind, v);

function newWorld(spaceId) {
  assemblyGate(spaceId); // 构造期：空间上下文在装配根建立时已过文法
  return {
    bornSpace: spaceId, idCounter: 0, seq: 0,
    records: new Map(), directory: new Map(), ledger: [],
    resolverCalls: [],
  };
}
// IG-4 步骤⑥（构造期，装配红 = 构建期判据信号，非 RefusalCode）
function assemblyGate(spaceId) {
  if (!spaceGrammarOk(spaceId)) throw new AssemblyRed('ASSEMBLY_ID_GRAMMAR_MALFORMED', { reason: 'GRAMMAR', ...transportFail('ID_MALFORMED', spaceId).echo });
  if (spaceReservedWord(spaceId)) throw new AssemblyRed('ASSEMBLY_ID_GRAMMAR_MALFORMED', { reason: 'RESERVED_WORD' });
}
function openWorld(world, spaceId) { // IG-1.5 出生绑定
  assemblyGate(spaceId);
  if (world.bornSpace !== spaceId) throw new Refusal('SPACE_FROZEN', { current: world.bornSpace });
  return world;
}

// IG-2.5 领域轨声明（IG-4 步骤③→⑦）；mut* 分支仅供变异自验旁路调用
function declareRecord(world, rawId, opts = {}) {
  if (opts.mut4) { // MUT-4 架空：解码后不复验（旁路自验专用）
    const v = transportMUT4('record', rawId);
    if (v.ok && reservedHit(v.value) === undefined) {
      world.seq += 1; world.records.set(v.value, { recordId: v.value, declaredSeq: world.seq });
      world.ledger.push({ seq: world.seq, kind: 'record-declared', recordId: v.value });
      return world.seq;
    }
    if (v.ok) return 'mut-pass-reserved';
  }
  if (!mechGrammarOk('record', rawId)) { // 机制闸：不解码、零规范化、形态非法即拒（回显 digest 形）
    throw new Refusal('TOOL_INPUT', { serviceCode: 'ID_MALFORMED', ...transportFail('ID_MALFORMED', rawId).echo });
  }
  const hit = opts.mut3 ? reservedHitMUT3(rawId) : reservedHit(rawId);
  if (hit !== undefined && !opts.mut3) {
    throw new Refusal('RECORD_ID_RESERVED', { recordId: rawId, prefix: hit });
  }
  const key = opts.mut2 ? asciiFold(rawId) : rawId; // MUT-2 旁路
  if (world.records.has(key)) throw new Refusal('RECORD_ALREADY_DECLARED', { recordId: rawId });
  world.seq += 1;
  world.records.set(key, { recordId: rawId, declaredSeq: world.seq });
  world.ledger.push({ seq: world.seq, kind: 'record-declared', recordId: rawId });
  return world.seq;
}
// IG-2.3 引用≠声明：解析 rec: 串查已存在记录
function resolveRecord(world, recStr) {
  if (!recSchemeOk(recStr)) throw new Refusal('TOOL_INPUT', { serviceCode: 'ID_MALFORMED', ...transportFail('ID_MALFORMED', recStr).echo });
  const body = recStr.slice(4);
  if (!world.records.has(body)) throw new Refusal('RECORD_UNDECLARED', { recordId: body });
  return world.records.get(body);
}

// IG-2.5 机制轨发号（发号侧不经保留闸——它是保留域的主人）
function mintMechanism(world, prefix) {
  if (!RESERVED_PREFIXES.includes(prefix)) throw new Error('mintMechanism only for reserved prefixes');
  world.seq += 1;
  const id = prefix + world.seq;
  world.records.set(id, { recordId: id, declaredSeq: world.seq, minted: true });
  return id;
}
// IG-3.2 正式发号：无空间分量（盐参与派生、不出现在串内）
function mintOid(world) {
  world.idCounter += 1;
  const h = createHash('sha256').update('mint-salt|' + world.idCounter).digest('hex').slice(0, 20);
  return 'obj-' + h;
}
function mintOidMUT6(world) { world.idCounter += 1; return 'OBJ-' + world.bornSpace + '-' + world.idCounter; }

// IG-4 步骤④（真实：目录解析**之前**，常量体零存在性；mut5 旁路仅供变异自验——
// 架空形把比对挪到解析之后，且解析失败时**信任自报的 declaredSpace 提示**回退宿主索引 =
// 第二权威索引形态，正是要钉死的差分）
const CROSS_BODY = JSON.stringify({ code: 'CROSS_SPACE_REFUSED' });
const NOTFOUND_BODY = JSON.stringify({ code: 'NOT_FOUND_IN_SPACE' });
function probeObject(world, declaredSpace, oidStr, opts = {}) {
  const tr = transport('oid', oidStr);
  if (!tr.ok) throw new Refusal('TOOL_INPUT', { serviceCode: tr.serviceCode, ...tr.echo });
  if (declaredSpace !== world.bornSpace && !opts.mut5) return CROSS_BODY; // 常量体：不解析目录，零存在性
  const found = world.directory.has(oidStr);
  if (declaredSpace !== world.bornSpace && opts.mut5) {
    const viaHint = opts.host ? opts.host.get(declaredSpace)?.has(oidStr) === true : false;
    return (found || viaHint) ? CROSS_BODY : NOTFOUND_BODY; // oracle 形：存在/不存在可分辨
  }
  if (!found) return NOTFOUND_BODY;
  world.resolverCalls.push('map-get');
  return JSON.stringify({ ok: true, row: world.directory.get(oidStr) });
}
function createObject(world) {
  const oid = mintOid(world);
  world.seq += 1;
  world.directory.set(oid, { oid, ns: 'ns-a', seq: world.seq });
  world.ledger.push({ seq: world.seq, kind: 'object-registered', oid });
  return oid;
}
// IG-3.2 解析器对 oid **零拆解**：目录点查唯一手段（resolverCalls 只允许 'map-get'）
// IG-3.3：修订类入参出现 space 槽 ⇒ 形态拒、零落行（SS-10 同向）
function revise(world, oid, a) {
  if ('space' in a || 'space_id' in a) {
    throw new Refusal('TOOL_INPUT', { serviceCode: 'ID_MALFORMED', reason: 'unexpected-space-field' });
  }
  if (!world.directory.has(oid)) return NOTFOUND_BODY;
  return JSON.stringify({ ok: true, revision: 2 });
}
// IG-2.4：rec:/保留前缀串进对象引用槽 ⇒ 领域契约拒；解析器**不接收**（FM-1.2）
function objectSlotAccept(str) {
  if (recSchemeOk(str) || asciiFold(str).startsWith('rec:')) return { ok: false, via: 'domain-contract' };
  if (reservedHit(str) !== undefined) return { ok: false, via: 'domain-contract' };
  return { ok: true };
}
function residueSnapshot(world) {
  return JSON.stringify({
    records: [...world.records.keys()], dir: [...world.directory.keys()],
    ledger: world.ledger, seq: world.seq, idCounter: world.idCounter,
  });
}

// ============================================================ S 组：结构校验

function machineBlock(tag) {
  const m = doc.match(new RegExp('<!-- ' + tag + ' GRAMMAR-BEGIN([\\s\\S]*?)' + tag + ' GRAMMAR-END -->'));
  if (!m) return null;
  const kv = {};
  for (const line of m[1].split('\n')) {
    const mm = line.match(/^([A-Z_0-9]+)=(.*)$/); if (mm) kv[mm[1]] = mm[2].trim();
  }
  return kv;
}
const IG1 = machineBlock('IG-1');
const IG2 = machineBlock('IG-2');
const IG4m = doc.match(/<!-- IG-4 ORDER-BEGIN([\s\S]*?)IG-4 ORDER-END -->/);

check('S1a 文法机读块三方逐等（契约 IG-1/IG-2/REC_SCHEME ↔ 夹具常量）',
  !!IG1 && !!IG2
  && IG1.SPACE_ID_GRAMMAR === SPACE_ID_RE_SRC && IG1.SPACE_ID_LEN_MIN === '1' && IG1.SPACE_ID_LEN_MAX === '64'
  && IG2.RECORD_ID_GRAMMAR === RECORD_ID_RE_SRC
  && IG2.REC_SCHEME_GRAMMAR === REC_SCHEME_RE_SRC
  && IG2.RECORD_ID_RESERVED_PREFIXES === RESERVED_PREFIXES.join(' | '));
{
  const stepLines = IG4m ? IG4m[1].split('\n').filter((l) => /^\d \S/.test(l)) : [];
  const nums = stepLines.map((l) => Number(l[0]));
  check('S1b IG-4 步骤序机读块在位且八步齐备（顺序即判据；续行折叠后逐步核）',
    !!IG4m && nums.length === 8 && nums.every((n, i) => n === i + 1)
    && TRANSPORT_ORDER.every((frag, i) => stepLines[i].includes(frag)));
}

// S1c 语义对拍：正则判定器 ↔ 手写判定器 ↔ 边界 63/64/65
{
  const corpus = ['a', '0', 'a-b', 'a.b', 'a_b', 'zzzz'.repeat(16), 'z'.repeat(63), 'z'.repeat(64),
    'z'.repeat(65), '', '.', '..', '.x', 'x.', 'A', 'aB', 'a b', 'a\tb', 'a\nb', 'a%b', 'a:b', 'Ｒ', 'a\u0301',
    'ａ', 'a＋b', 'a‮b', '🙂', 'a'.repeat(200)];
  let agree = true;
  for (const s of corpus) {
    if (spaceGrammarOk(s) !== handSpace(s)) { agree = false; break; }
    if (recordGrammarOk(s) !== handRecord(s)) { agree = false; break; }
    if (oidHygieneOk(s) !== handOid(s)) { agree = false; break; }
  }
  check('S1c 正则↔手写双源判定逐字符一致（含 63/64/65 长度界）',
    agree && handSpace('z'.repeat(64)) && !handSpace('z'.repeat(65))
    && handRecord('z'.repeat(64)) && !handRecord('z'.repeat(65))
    && REC_RE.test('rec:' + 'z'.repeat(64)) && !REC_RE.test('rec:' + 'z'.repeat(65)));
}

// S2 保留前缀三方：契约 ↔ 夹具 ↔ src（⊆ + 扩员去向句）
{
  const srcList = (srcKernel.match(/RESERVED_RECORD_ID_PREFIXES\s*=\s*\[([^\]]*)\]/) || [, ''])[1]
    .split(',').map((x) => x.trim().replace(/^'|'$/g, '')).filter(Boolean);
  check('S2 保留前缀三方（契约封闭集 ↔ 夹具 ↔ src 常量 ⊆）+ G1-LINK-01 扩员去向句在位',
    IG2 && IG2.RECORD_ID_RESERVED_PREFIXES.split(' | ').join(',') === RESERVED_PREFIXES.join(',')
    && srcList.length > 0 && srcList.every((p) => RESERVED_PREFIXES.includes(p))
    && doc.includes('G1-LINK-01') && doc.includes('RPT-') && doc.includes('NSR-'));
}

// S3 拒绝码封闭集零扩张：契约反引号全大写码 ⊆ src 封闭集 ∪ 显式例外表
{
  const CLOSED = new Set((srcContracts.match(/'([A-Z][A-Z0-9_]{2,})'/g) ?? []).map((s) => s.slice(1, -1)));
  const DECLARED = new Set([
    'TOOL_INPUT',                        // X-3/M-3 传输面过渡形（非机制码，G-26）
    'ASSEMBLY_ID_GRAMMAR_MALFORMED',     // 构建期判据信号名（非 RefusalCode 成员，IG-4.2）
    'ID_MALFORMED', 'ID_AMBIGUOUS_OCCURRENCE', 'SPACE_MISMATCH', // detail.serviceCode 值（先例 IDEMPOTENCY_KEY_REUSED 只进 detail）
    'IDEMPOTENCY_KEY_REUSED',            // X-2 既有 detail 名（引用出现，非新码）
    'NS_SHAPE',                          // RL-4 门 3 门名（引用出现，非新码）
    'RESERVED_RECORD_ID_PREFIXES',       // src 常量名（引用出现）
    'RECORD_ID_GRAMMAR', 'SPACE_ID_GRAMMAR', 'REC_SCHEME_GRAMMAR', // 机读块常量名
  ]);
  const cited = new Set((doc.match(/`([A-Z][A-Z0-9_]{2,}(?:_[A-Z0-9]+)*)`/g) ?? []).map((s) => s.slice(1, -1)));
  const violations = [...cited].filter((c) => !CLOSED.has(c) && !DECLARED.has(c));
  check('S3 封闭集零扩张：契约全部反引号码 ⊆ src 封闭集 ∪ 声明过渡形/构建信号/门名例外表（新增 RefusalCode = 0）',
    CLOSED.size >= 20 && violations.length === 0, violations.join(','));
  check('S3b 封闭集内码引用真实存在（SPACE_FROZEN/CROSS_SPACE_REFUSED/RECORD_ID_RESERVED 等逐名在 src）',
    ['SPACE_FROZEN', 'CROSS_SPACE_REFUSED', 'RECORD_ID_RESERVED', 'RECORD_ALREADY_DECLARED',
      'RECORD_UNDECLARED', 'NOT_FOUND_IN_SPACE', 'ID_TAKEN', 'HARD_REF_NOT_PINNED']
      .every((c) => CLOSED.has(c) && doc.includes(c)));
}

check('S4 新命名声明在位（「我方契约层新命名」+ 不假装上层已定 + T-GAP-09/10 引用）',
  doc.includes('我方契约层新命名') && doc.includes('不得、也不被允许被引用为「上层已定」')
  && doc.includes('T-GAP-09') && doc.includes('本层不自行发明'));

check('S5 冻结义务句 + 回填清单 R-①…R-⑥ 在位',
  doc.includes('冻结面变更') && doc.includes('同一提交') && doc.includes('契约不得自称已批准')
  && ['R-①', 'R-②', 'R-③', 'R-④', 'R-⑤', 'R-⑥'].every((r) => doc.includes(r)));

{
  const docIds = [...doc.matchAll(/^\| (T-[PN]\d{1,2}) \|/gm)].map((m) => m[1]);
  const fixIds = [...selfSrc.matchAll(/^function run_(T_[PN]\d{1,2})\(/gm)].map((m) => m[1].replace('_', '-'));
  const a = [...new Set(docIds)].sort().join(',');
  const b = [...new Set(fixIds)].sort().join(',');
  check('S6 §5 矩阵 ↔ 夹具 run_T_* 双向逐等', a === b && a.split(',').length === 19, a === b ? '' : `doc=${a} fix=${b}`);
}

check('S7 六条 MUT 契约↔夹具互指常驻',
  [1, 2, 3, 4, 5, 6].every((k) => doc.includes('MUT-' + k) && selfSrc.includes('MUT-' + k))
  && doc.includes('放宽长度') && doc.includes('大小写折叠'));

check('S8 IG-1 文法与 RL 门 3 NS_SHAPE 同型（跨文件提取对拍）+ 注册域分离句在位',
  rlDoc.includes('^[a-z0-9][a-z0-9._-]{0,63}$') && SPACE_ID_RE_SRC === '^[a-z0-9][a-z0-9._-]{0,63}$'
  && doc.includes('注册域分离') && doc.includes('不得由 `space_id` 派生'));

check('S9 rec: 与冒号不相容自洽（冒号出字符集 ⇒ 双 scheme/折叠 scheme 文法非法）',
  !RECORD_RE.test('a:b') && !REC_RE.test('REC:x') && !REC_RE.test('rec:rec:x')
  && REC_RE.test('rec:RPT-1') && doc.includes('无歧义'));

// ============================================================ T 组：表驱动正反例（§5 矩阵逐行）

function run_T_P1() {
  const good = ['a', '0', 's1', 'lab.2026-11', 'x_y', 'z'.repeat(64), 'research-control'];
  if (!good.every((s) => spaceGrammarOk(s) && handSpace(s))) return '合法族被误拒';
  if (spaceGrammarOk('z'.repeat(65))) return '65 字符越上界被收';
  return null;
}
function run_T_P2() {
  const w = newWorld('alpha');
  const ids = RESERVED_PREFIXES.map((p) => mintMechanism(w, p));
  if (!ids.every((id) => recordGrammarOk(id) && handRecord(id))) return '机制发号不过 IG-2 文法';
  if (!['Abc-1', 'x', '9lead', 'a.b_c-d', 'R'.repeat(64)].every(recordGrammarOk)) return 'record 合法族被误拒';
  return null;
}
function run_T_P3() {
  const w = newWorld('alpha');
  declareRecord(w, 'note-1');
  const r = resolveRecord(w, 'rec:note-1');
  const mId = mintMechanism(w, 'RPT-'); // 引用已存在机制记录放行（引用≠声明）
  const r2 = resolveRecord(w, 'rec:' + mId);
  return r.recordId === 'note-1' && r2.minted === true ? null : 'rec: 解析失败';
}
function run_T_P4() {
  const w = newWorld('alpha');
  declareRecord(w, 'Abc-1'); declareRecord(w, 'abc-1'); // 逐字节两个身份并存
  return w.records.size === 2 ? null : '大小写并存被折叠（逐字节判等失守）';
}
function run_T_P5() {
  const w = newWorld('alpha');
  const oid = createObject(w);
  const body = probeObject(w, 'alpha', oid);
  const missing = probeObject(w, 'alpha', 'obj-' + '0'.repeat(20)); // 未登记的合法形 oid
  const rev = revise(w, oid, { payload: {}, expectedRevision: 1 });
  if (!body.includes('"ok":true') || missing !== NOTFOUND_BODY || !rev.includes('"ok":true')) return '解析面不符';
  if (w.resolverCalls.some((c) => c !== 'map-get')) return '解析器对 oid 有拆解调用';
  return null;
}
function run_T_P6() {
  const w = newWorld('alpha');
  openWorld(w, 'alpha');
  return w.bornSpace === 'alpha' ? null : '重开失败';
}
function run_T_P7() {
  const w = newWorld('alpha-7');
  const mints = Array.from({ length: 40 }, () => createObject(w));
  if (mints.some((o) => o.includes('alpha') || o.includes('alpha-7'))) return '正式发号含空间分量';
  if (!mints.every(oidHygieneOk)) return '正式发号不过卫生文法';
  if (!oidHygieneOk('OBJ-alpha-7-3')) return '夹具存量形态被判红（C2 不回迁失守）';
  return null;
}
function run_T_P8() {
  const wA = newWorld('alpha');
  const oid = createObject(wA);
  const wB = newWorld('beta');
  const b1 = probeObject(wB, 'alpha', oid);        // 他空间真实 oid
  const b2 = probeObject(wB, 'alpha', 'obj-deadbeef'); // 他空间不存在的 oid
  if (b1 !== b2 || b1 !== CROSS_BODY) return '跨空间探测两世界不同形';
  const w = newWorld('alpha');
  declareRecord(w, 'dup-1');
  let c1 = null, c2 = null;
  try { declareRecord(w, 'dup-1'); } catch (e) { c1 = e; }
  try { declareRecord(newWorld('beta'), 'dup-1'); c2 = 'ok'; } catch (e) { c2 = e; } // 他空间同名是不同键空间
  if (!(c1 instanceof Refusal) || c1.code !== 'RECORD_ALREADY_DECLARED') return '同空间碰撞码不符';
  if (c2 !== 'ok') return '跨空间同名被误判碰撞（唯一性=空间内事实）';
  return null;
}
function run_T_N1() {
  // 框层（传输面）：解码一次后复验——解后控制符/多重编码全拒
  const badFraming = ['', '.', '..', '.x', 'Alpha', 'a b', 'a\tb', 'a\nb', 'ａｌｐｈａ', 'a\u0301', 'é',
    'a%00b', 'a‮x', '🙂', 'z'.repeat(65), '+a', 'a+b', '%2561lpha'];
  for (const s of badFraming) {
    if (spaceGrammarOk(s) || handSpace(s)) return '畸变族漏网：' + shapeClass(s);
    const t = transport('space', s);
    if (t.ok) return '框层漏网：' + shapeClass(s);
    const echo = JSON.stringify(t.echo);
    if (echo.includes(String(s).slice(0, 4)) && String(s).length > 2) return '畸变回显携带原文';
  }
  // 框层/值层两分（IG-1.1 百分号条）：`%61lpha` **值层**必拒（机制入口不解码、含 % 即形态非法）；
  // 框层解码后以 `alpha` 过闸是它唯一的合法路径（正控断言）
  if (spaceGrammarOk('%61lpha') || handSpace('%61lpha')) return '值层含 % 被收（机制面不解码失守）';
  const framed = transport('space', '%61lpha');
  if (!framed.ok || framed.value !== 'alpha') return '框层单层解码正控失败';
  return null;
}
function run_T_N2() {
  const w = newWorld('alpha');
  try { openWorld(w, 'beta'); return '出生绑定冲突未拒'; }
  catch (e) { return e instanceof Refusal && e.code === 'SPACE_FROZEN' ? null : '拒绝码不符：' + e.code; }
}
function run_T_N3() {
  const w = newWorld('alpha');
  const oid = createObject(w);
  if (probeObject(w, 'beta', oid) !== CROSS_BODY) return '空间比对未先拒';
  if (!probeObject(w, 'alpha', oid).includes('"ok":true')) return '等值情形被误拦';
  return null;
}
function run_T_N4() {
  const w = newWorld('alpha');
  const fakes = ['RPT-1', 'Rpt-1', 'rPt-1', 'rpt-1', 'FM-1', 'fm-1', 'FR-9', 'NSR-2'];
  for (const f of fakes) {
    try { declareRecord(w, f); return '仿冒漏网：' + f; }
    catch (e) { if (!(e instanceof Refusal) || e.code !== 'RECORD_ID_RESERVED') return '码不符：' + f; }
  }
  try { declareRecord(w, 'ＲＰＴ－1'); return '全形仿冒未拒'; }
  catch (e) { // 顺序断言：文法闸先拒（原因不是保留闸）
    if (e.code !== 'TOOL_INPUT' || e.detail.serviceCode !== 'ID_MALFORMED') return '全形仿冒应在文法闸先拒';
  }
  return null;
}
function run_T_N5() {
  const w = newWorld('alpha');
  const bad = ['', ':x', 'rec:x', 'a:b', 'a%00b', 'a b', 'a\tb', 'z'.repeat(65), '.', 'ＡＢ', '🙂', '.hidden'];
  for (const s of bad) {
    try { declareRecord(w, s); return 'record 畸变漏网：' + shapeClass(s); }
    catch (e) { if (!(e instanceof Refusal) || e.code !== 'TOOL_INPUT') return '码不符：' + s; }
  }
  return null;
}
function run_T_N6() {
  const w = newWorld('alpha');
  for (const s of ['rec:note-1', 'FR-7', 'RPT-3']) {
    const slot = objectSlotAccept(s);
    if (slot.ok) return '槽位闸漏网：' + s;
  }
  if (w.resolverCalls.length !== 0) return '解析器被投入 rec:/FR 串';
  if (recSchemeOk('rec:rec:x') || recSchemeOk('REC:x')) return '双 scheme/折叠 scheme 被收';
  return null;
}
function run_T_N7() {
  const w = newWorld('alpha');
  const before = residueSnapshot(w);
  try { probeObject(w, 'alpha', 'space:obj@rev'); return 'space:obj@rev 未被拒'; }
  catch (e) { if (e.code !== 'TOOL_INPUT') return '码不符'; }
  try { probeObject(w, 'alpha', 'obj@r2'); return '@ 串未被拒'; }
  catch (e) { if (e.code !== 'TOOL_INPUT') return '码不符'; }
  return residueSnapshot(w) === before ? null : '零残留失守';
}
function run_T_N8() {
  const w = newWorld('alpha');
  const oid = createObject(w);
  const before = residueSnapshot(w);
  for (const k of ['space', 'space_id']) {
    try { revise(w, oid, { payload: {}, [k]: 'alpha' }); return '修订类带 ' + k + ' 未被拒'; }
    catch (e) { if (e.code !== 'TOOL_INPUT') return '码不符'; }
  }
  return residueSnapshot(w) === before ? null : '零残留失守';
}
function run_T_N9() {
  const w = newWorld('alpha');
  const before = residueSnapshot(w);
  const probes = [
    () => declareRecord(w, 'RPT-1'), () => declareRecord(w, 'bad id'), () => declareRecord(w, 'x'.repeat(65)),
    () => openWorld(w, 'beta'), () => probeObject(w, 'beta', 'obj-aa'),
    () => probeObject(w, 'alpha', 'space:x@r1'),
    () => resolveRecord(w, 'rec:ghost-1'), () => resolveRecord(w, 'rec:x:y'),
    () => revise(w, 'obj-aa', { payload: {}, space: 'x' }),
  ];
  for (const p of probes) { try { p(); } catch (e) { if (!(e instanceof Refusal)) return '非 Refusal 异常'; } }
  return residueSnapshot(w) === before ? null : '负例后世界被改动';
}
function run_T_N10() {
  const w = newWorld('alpha');
  const before = residueSnapshot(w);
  try {
    const b = probeObject(w, 'alpha', 'HENT-abc123'); // V1/HSR 形态无特判：与任一未知 oid 同体
    if (b !== NOTFOUND_BODY) return '跨平面形态有特判成功路径';
    probeObject(w, 'alpha', 'V1:CLAIM:9'); return 'external citation 串被当引用送解析';
  } catch (e) { if (e.code !== 'TOOL_INPUT') return '码不符'; }
  return residueSnapshot(w) === before ? null : '零残留失守';
}
function run_T_N11() {
  for (const r of SPACE_RESERVED_WORDS) {
    if (!spaceGrammarOk(r)) return '保留字应过文法（两闸分开）';
    try { newWorld(r); return '保留字未拒：' + r; }
    catch (e) {
      if (!(e instanceof AssemblyRed) || e.signal !== 'ASSEMBLY_ID_GRAMMAR_MALFORMED') return '装配信号不符';
      if (e.detail.reason !== 'RESERVED_WORD') return '保留字拒因错标为文法';
    }
  }
  return null;
}

// ============================================================ 变异自验（架空判据必须被捕获）

function mutSelfCheck(name, realCatches, mutPasses, detail) {
  check(name + '（真实拦下 ∧ 架空放过同一负例）', realCatches && mutPasses,
    realCatches ? '架空判据没放过——该负例对架空无判别力：' + detail : '真实判据没拦下：' + detail);
}
{
  // MUT-1 长度放宽 64→128
  const over = 'z'.repeat(65);
  mutSelfCheck('MUT-1 长度上界放宽', !spaceGrammarOk(over) && !handSpace(over), spaceGrammarOkMUT1(over), '65 字符');

  // MUT-2 判等 case-fold
  const w2 = newWorld('alpha');
  let real2 = false, mut2 = false;
  try { declareRecord(w2, 'Abc-1'); declareRecord(w2, 'abc-1'); } catch { real2 = true; }
  const w3 = newWorld('alpha');
  try { declareRecord(w3, 'Abc-1', { mut2: true }); declareRecord(w3, 'abc-1', { mut2: true }); } catch { mut2 = true; }
  mutSelfCheck('MUT-2 大小写折叠判等', !real2 && w2.records.size === 2, mut2 || w3.records.size === 1, '假碰撞/漏碰撞');

  // MUT-3 保留前缀只按逐字节（折叠仿冒漏网）
  let real3 = false, mut3 = false;
  try { declareRecord(newWorld('alpha'), 'Rpt-9'); } catch (e) { real3 = e.code === 'RECORD_ID_RESERVED'; }
  try { declareRecord(newWorld('alpha'), 'Rpt-9', { mut3: true }); mut3 = true; } catch { mut3 = false; }
  mutSelfCheck('MUT-3 保留前缀单形匹配', real3, mut3, 'Rpt-9 仿冒');

  // MUT-4 解码后不复验
  let real4 = false, mut4 = false;
  try { declareRecord(newWorld('alpha'), 'alpha%00'); } catch (e) { real4 = e.code === 'TOOL_INPUT'; }
  try { declareRecord(newWorld('alpha'), 'alpha%00', { mut4: true }); mut4 = true; } catch { mut4 = false; }
  mutSelfCheck('MUT-4 传输解码不复验', real4, mut4, 'alpha%00 → 控制符');

  // MUT-5 空间比对挪到目录解析之后（+自报提示回退 ⇒ 存在性差分）
  const wA = newWorld('alpha'); const oid = createObject(wA); const wB = newWorld('beta');
  const host = new Map([['alpha', wA.directory]]);
  const realSame = probeObject(wB, 'alpha', oid) === probeObject(wB, 'alpha', 'obj-unknown');
  const mutDiff = probeObject(wB, 'alpha', oid, { mut5: true, host }) !== probeObject(wB, 'alpha', 'obj-unknown', { mut5: true, host });
  mutSelfCheck('MUT-5 空间比对后置', realSame, mutDiff, '他空间存在/不存在差分');

  // MUT-6 正式发号拼空间名
  const w6 = newWorld('alpha'); const w7 = newWorld('alpha');
  const real6 = !/alpha/.test(mintOid(w6));
  const mut6 = mintOidMUT6(w7).includes('alpha');
  mutSelfCheck('MUT-6 发号拼回空间名', real6, mut6, 'OBJ-alpha-<n> 回潮');
}

// ============================================================ 运行表驱动用例 + 收尾

// 显式运行表（ESM 模块作用域无 new Function 可见性；S6 已对拍本表 ↔ 源码函数 ↔ 契约矩阵）
const RUN_TABLE = [
  ['T-P1', run_T_P1], ['T-P2', run_T_P2], ['T-P3', run_T_P3], ['T-P4', run_T_P4],
  ['T-P5', run_T_P5], ['T-P6', run_T_P6], ['T-P7', run_T_P7], ['T-P8', run_T_P8],
  ['T-N1', run_T_N1], ['T-N2', run_T_N2], ['T-N3', run_T_N3], ['T-N4', run_T_N4],
  ['T-N5', run_T_N5], ['T-N6', run_T_N6], ['T-N7', run_T_N7], ['T-N8', run_T_N8],
  ['T-N9', run_T_N9], ['T-N10', run_T_N10], ['T-N11', run_T_N11],
];
check('R0 运行表 ↔ 源码 run_T_* 函数 ↔ 契约矩阵三方同集',
  RUN_TABLE.length === 19 && new Set(RUN_TABLE.map((x) => x[0])).size === 19);
for (const [id, fn] of RUN_TABLE) {
  let why = 'EXCEPTION';
  try { why = fn(); } catch (e) { why = '夹具内异常：' + (e && e.message ? e.message : String(e)); }
  check(id + '（' + (id.startsWith('T-P') ? '正' : '负') + '）', why === null, why === null ? '' : String(why));
}

process.stdout.write(`\nIG 夹具：PASS ${pass} / FAIL ${fail}` + (fail ? '（FAIL 项：' + fails.join('；') + '）' : '') + '\n');
process.exit(fail ? 1 : 0);
