#!/usr/bin/env node
/*
  G1-CONTRACT-COMMIT-SEQUENCE.fixtures.mjs —— 与 g1/G1-CONTRACT-COMMIT-SEQUENCE.md（CS）互相对账的夹具。

  用法：node experiments/v3-code-architecture-poc/g1/G1-CONTRACT-COMMIT-SEQUENCE.fixtures.mjs
  退出码：0 = 契约结构自洽 + 正反例全命中 + 五条「架空判据必红」变异自验全部捕获；
          1 = 有任一项 FAIL；2 = 夹具自身无法运行（缺文件 / node:sqlite 不可用 / 临时库建不起来）。

  纪律：
  - 零依赖：只用 node:fs / node:os / node:path / node:url / node:child_process / **node:sqlite**。
  - **真库用例是本案的正据**（任务点名要求）：`node:sqlite` 的 `DatabaseSync` 在仓库 `.scratch/` 下建
    临时库（跑完即删），WAL + 两条连接，逐字提取 `src/storage-sqlite/sqlite-port.ts` 的 `meta`/`ledger`/
    `domain_state` DDL 与守卫触发器（p11-trigger-check.mjs 先例），证明「事务中途回滚不可见」与
    「提交截点不暴露中间状态」。**夹具里的 commit_record / commit_sequence 列是夹具形状，不是生产 DDL**
    （生产 DDL 归 G2；本席不写 src/schema）。
  - 模型部分是**判据最小模型**（两轴 + 提交账 + 两支解析 + 游标），不是机制实现；判据语义逐条对 CS-*。
  - 变异纪律：MUT-* 架空判据**常驻本文件不删除**；每条双向自验——真实判据必须拦住/满足，
    架空判据必须放过同一负例。MUT 仅在自验分支旁路调用，真实判据恒为主路径唯一调用者。
    本案的主变异是 **MUT-1：把可见性判据改成用事件序过滤（现网逐字 SQL）⇒ 必红**。
*/

import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const HERE = dirname(fileURLToPath(import.meta.url));
const DOC_PATH = join(HERE, 'G1-CONTRACT-COMMIT-SEQUENCE.md');
const SELF_PATH = fileURLToPath(import.meta.url);
const SRC_PORT_PATH = join(HERE, '..', 'src', 'storage-sqlite', 'sqlite-port.ts');
const SRC_READ_PATH = join(HERE, '..', 'src', 'kernel', 'read-context.ts');
const SRC_CODES_PATH = join(HERE, '..', 'src', 'contracts', 'index.ts');
const REPO_ROOT = resolve(HERE, '..', '..', '..');

function load(p, what) {
  try { return readFileSync(p, 'utf8'); }
  catch (e) { process.stderr.write(`FATAL: 读不到${what} ${p}：${e.message}\n`); process.exit(2); }
}
const doc = load(DOC_PATH, '契约正文');
const selfSrc = load(SELF_PATH, '夹具自身');
const srcPort = load(SRC_PORT_PATH, 'src 存储 Port');
const srcRead = load(SRC_READ_PATH, 'src 读面');
const srcCodes = load(SRC_CODES_PATH, 'src 契约码集');

let pass = 0, fail = 0; const fails = [];
function check(name, cond, detail) {
  if (cond) { pass += 1; process.stdout.write('PASS  ' + name + '\n'); }
  else { fail += 1; fails.push(name); process.stdout.write('FAIL  ' + name + (detail ? '  —— ' + detail : '') + '\n'); }
}

// ============================================================ 拒绝码（封闭集零扩员）

const NEW_REFUSAL_CODES = [];            // 本契约新增码数必须恒为 0（CS §2.8）
const CODES = {
  CONTEXT_INCOMPLETE: 'CONTEXT_INCOMPLETE',
  READ_CUTOFF_UNSAFE: 'READ_CUTOFF_UNSAFE',
  CROSS_SPACE_REFUSED: 'CROSS_SPACE_REFUSED',
  SCHEMA_UPGRADE_REQUIRED: 'SCHEMA_UPGRADE_REQUIRED',
};
class Refusal extends Error {
  constructor(code, detail) { super(code); this.code = code; this.detail = detail ?? {}; }
}

// ============================================================ 判据最小模型（两轴 + 提交账）

/** 一条已提交事务的账行（CS-1.3 提交账）。 */
const mkCommitRow = (c, from, to, atMs) => ({
  commit_sequence: c, ledger_event_seq_from: from, ledger_event_seq_to: to, commit_recorded_at_ms: atMs,
});

class Ledger {
  constructor() {
    this.eventHead = 0;                    // meta.ledger_seq：事件轴水位
    this.commitHead = 0;                   // meta.commit_sequence：提交轴水位
    this.commits = [];                     // commit_record：已提交事实账（读面唯一候选集）
    this.rows = [];                        // domain_state 形状：{oid,revision,payload,eventSeq,commitSeq,eventRecordedAtMs}
  }
  begin(wallMs) { return new Tx(this, wallMs); }
  snapshotOf(cutoff) {                     // 真判据：按提交归属过滤（CS-1.4 禁令 2 的唯一允许形状）
    return this.rows.filter((r) => r.commitSeq <= cutoff).map((r) => `${r.oid}@${r.revision}`).sort();
  }
  snapshotEventFilter(cutoff) {            // MUT-1 旁路：现网形态 recorded_seq <= ?
    return this.rows.filter((r) => r.eventSeq <= cutoff).map((r) => `${r.oid}@${r.revision}`).sort();
  }
  snapshotWallPerRow(t) {                  // MUT-2 旁路：逐行取事件 recorded_at
    return this.rows.filter((r) => r.eventRecordedAtMs <= t).map((r) => `${r.oid}@${r.revision}`).sort();
  }
}

class Tx {
  constructor(ledger, wallMs) {
    this.L = ledger; this.wall = wallMs;
    this.c = null; this.first = null; this.last = null;
    this.staged = []; this.committed = false; this.rolledBack = false;
  }
  /** CS-1.2 分配点：事务内首次权威写之前预留；一个事务至多一个提交序。 */
  reserve() { if (this.c === null) { this.c = this.L.commitHead + 1; this.L.commitHead = this.c; } return this.c; }
  /** 一次权威登记：事件轴每事件 +1，提交轴复用本事务预留值。 */
  register(oid, payload, eventWallMs) {
    const c = this.reserve();
    const ev = this.L.eventHead + 1; this.L.eventHead = ev;
    if (this.first === null) this.first = ev;
    this.last = ev;
    this.staged.push({ oid, revision: 1, payload, eventSeq: ev, commitSeq: c, eventRecordedAtMs: eventWallMs });
    return ev;
  }
  commit() {                               // 生效 = COMMIT：一并落 domain_state 与提交账
    if (this.c !== null) {
      this.L.commits.push(mkCommitRow(this.c, this.first, this.last, this.wall));
      for (const r of this.staged) this.L.rows.push(r);
    }
    this.committed = true;
  }
  rollback() {                             // 预留随事务消失（无 ghost，CS-1.2）
    if (this.c !== null) this.L.commitHead = this.c - 1;
    this.staged = []; this.rolledBack = true;
  }
}

/** 已提交截点（读面缺省截点来源；只读提交账，不读 meta 水位）。 */
const committedHead = (L) => (L.commits.length === 0 ? 0 : L.commits[L.commits.length - 1].commit_sequence);
const commitRowOf = (L, c) => L.commits.find((r) => r.commit_sequence === c) ?? null;

/** CS-2.2 唯一判据点：两支各自解析到已提交截点。纯函数，候选集 = 提交账已有行。 */
function resolveCutoff(L, asOf) {
  if (asOf === undefined || asOf === null) {
    const c = committedHead(L);
    return { asOfBranch: 'head-default', resolvedCutoff: c, resolvedAtMs: c === 0 ? null : commitRowOf(L, c).commit_recorded_at_ms, cutoffDefaulted: true };
  }
  if (typeof asOf !== 'object' || Array.isArray(asOf) || typeof asOf.branch !== 'string') {
    throw new Refusal(CODES.CONTEXT_INCOMPLETE, { reason: 'as-of-shape-unknown' });
  }
  if (asOf.branch === 'commit-sequence') {
    const v = asOf.value;
    const ok = typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= committedHead(L);
    if (!ok) throw new Refusal(CODES.READ_CUTOFF_UNSAFE, { reason: 'cutoff-beyond-committed-head' });  // 不回显 head
    return { asOfBranch: 'commit-sequence', resolvedCutoff: v, resolvedAtMs: v === 0 ? null : commitRowOf(L, v).commit_recorded_at_ms, cutoffDefaulted: false };
  }
  if (asOf.branch === 'recorded-at-ms') {
    const t = asOf.epochMs;
    if (typeof t !== 'number' || !Number.isFinite(t)) {
      throw new Refusal(CODES.CONTEXT_INCOMPLETE, { reason: 'as-of-shape-unknown' });
    }
    let runMax = -Infinity, c = 0;
    for (const r of L.commits) {                       // CS-3.1：运行最大前缀界
      if (r.commit_recorded_at_ms > runMax) runMax = r.commit_recorded_at_ms;
      if (runMax > t) break;
      c = r.commit_sequence;
    }
    return { asOfBranch: 'recorded-at-ms', resolvedCutoff: c, resolvedAtMs: c === 0 ? null : commitRowOf(L, c).commit_recorded_at_ms, cutoffDefaulted: false };
  }
  throw new Refusal(CODES.CONTEXT_INCOMPLETE, { reason: 'as-of-shape-unknown' });
}

/** CS-2.6 游标：截点分量（提交轴）+ 页内位置（事件轴）+ 指纹 + 授权类。重放禁止二次解析。 */
const mkCursor = (resolved, position, fingerprint, authClass) => ({
  cutoff: resolved.resolvedCutoff, position, queryFingerprint: fingerprint, authorityClass: authClass,
});
function pageWithCursor(L, cursor, authClass) {
  if (cursor.authorityClass !== authClass) throw new Refusal(CODES.CONTEXT_INCOMPLETE, { reason: 'cursor-shape-unknown' });
  return L.snapshotOf(cursor.cutoff);                  // 只用自包含截点
}
function pageWithCursorMUT4(L, cursor, authClass) {    // 架空：每页重解析墙钟
  if (cursor.authorityClass !== authClass) throw new Refusal(CODES.CONTEXT_INCOMPLETE, { reason: 'cursor-shape-unknown' });
  return L.snapshotOf(resolveCutoff(L, { branch: 'recorded-at-ms', epochMs: cursor.position.reanchorMs }).resolvedCutoff);
}

/** 值域封闭集（I-6）：只从提交账导出，不看 meta 水位。 */
const resolvableSet = (L) => new Set([0, ...L.commits.map((r) => r.commit_sequence)]);
const eqArr = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const eqSet = (a, b) => eqArr([...a].sort(), [...b].sort());
const j = (x) => JSON.stringify(x);

/** 快照集族：每个已提交事务完成瞬间的完整可见集（「从未原子提交过的中间态」= 不在此族内）。 */
const snapshotFamily = (L) => {
  const fam = new Set([j(L.snapshotOf(0))]);
  for (const r of L.commits) fam.add(j(L.snapshotOf(r.commit_sequence)));
  return fam;
};

const MUT_IDS = ['MUT-1', 'MUT-2', 'MUT-3', 'MUT-4', 'MUT-5'];
const RUN_TABLE = [
  ['T-P1', run_T_P1], ['T-P2', run_T_P2], ['T-P3', run_T_P3], ['T-P4', run_T_P4], ['T-P5', run_T_P5],
  ['T-P6', run_T_P6], ['T-P7', run_T_P7], ['T-P8', run_T_P8], ['T-P9', run_T_P9],
  ['T-N1', run_T_N1], ['T-N2', run_T_N2], ['T-N3', run_T_N3], ['T-N4', run_T_N4], ['T-N5', run_T_N5],
  ['T-N6', run_T_N6], ['T-N7', run_T_N7], ['T-N8', run_T_N8],
];

// ============================================================ S 组：契约 ↔ 夹具结构互认

function block(tag) {
  const m = doc.match(new RegExp('<!-- ' + tag + '-BEGIN -->([\\s\\S]*?)<!-- ' + tag + '-END -->'));
  return m ? m[1] : null;
}
const rowsOf = (s, n) => (s ?? '').split('\n')
  .map((l) => l.replace(/^```[a-z]*\s*$/, '').split('|').map((c) => c.trim()))
  .filter((cs) => cs.length === n && !/^-+$/.test(cs[0]) && cs[0].length > 0 && !/^(seq_axis|as_of_branch|echo_cutoff_key|case_id)$/.test(cs[0]));

// S1 两轴的封闭属性表逐等（类型名 / 线名 / 步长 / 绝对禁止项）
const AXES = [
  ['event', 'LedgerEventSequence', 'ledger_event_seq', '每事件 +1', '作任何读面的历史截点'],
  ['commit', 'CommitSequence', 'commit_sequence', '每提交 +1', '作事件身份或页内排序键'],
];
{
  const b = block('CS-1 SEQ');
  const rs = rowsOf(b, 7).map((cs) => [cs[0], cs[1], cs[2], cs[3], cs[6]]);
  check('S1 CS-1 两轴属性表 ↔ 夹具 AXES 逐等（顺序敏感）', j(rs) === j(AXES), j(rs));
  check('S1b 两轴类型名与 src 既有品牌的关系如实（CommitSequence 既有、LedgerEventSequence 未入 src）',
    /export type CommitSequence = number & \{ readonly __brand: 'CommitSequence' \};/.test(srcCodes)
    && !/LedgerEventSequence/.test(srcCodes));
}

// S2 入参两支封闭（不存在事件序支）
const ASOF_BRANCHES = ['commit-sequence', 'recorded-at-ms'];
{
  const b = block('CS-2 ASOF');
  const rs = rowsOf(b, 4).map((cs) => cs[0]);
  check('S2 CS-2 入参两支封闭 ↔ 夹具 ASOF_BRANCHES 逐等（无第三支）', j(rs) === j(ASOF_BRANCHES), j(rs));
  const accepted = [...selfSrc.matchAll(/asOf\.branch === '([a-z-]+)'/g)].map((m) => m[1]);
  check('S2b 解析器实际接受的支集 = 两支封闭集（既不多也不少）',
    eqSet(accepted, ASOF_BRANCHES) && accepted.length === 2, j(accepted));
  check('S2c 入参面禁词：两支块内零「事件序支」词汇（ledger_event_seq / recorded_seq / eventSeq 不作入参）',
    !/ledger_event_seq|recorded_seq|eventSeq/.test(b ?? ''), (b ?? '').slice(0, 80));
}

// S3 回显四键（截点位只发提交轴，且全必填）
const ECHO_KEYS = ['as_of_input', 'resolved_cutoff', 'resolved_at_ms', 'cutoff_defaulted'];
{
  const b = block('CS-2 ECHO');
  const rs = rowsOf(b, 4);
  check('S3 CS-2 回显四键 ↔ 夹具 ECHO_KEYS 逐等且全必填',
    j(rs.map((cs) => cs[0])) === j(ECHO_KEYS) && rs.length === 4 && rs.every((cs) => cs[2] === '是'), j(rs.map((cs) => [cs[0], cs[2]])));
  check('S3b 契约 ResolvedCutoff 形状含四键的驼峰对应位',
    ['asOfBranch', 'resolvedCutoff', 'resolvedAtMs', 'cutoffDefaulted'].every((k) => doc.includes('readonly ' + k)));
  check('S3c 夹具回显里 resolvedCutoff 的来源恒为提交账（无 eventSeq 赋值）',
    !/resolvedCutoff:\s*\w*[eE]ventSeq/.test(selfSrc));
}

// S4 五情形 + 冒充 = 六行封闭表
const CLOCK_CASES = ['late-arrival', 'clock-rollback', 'same-millisecond', 'no-commit-at-millisecond', 'out-of-range', 'impersonation'];
{
  const b = block('CS-3 CASES');
  const rs = rowsOf(b, 3).map((cs) => cs[0]);
  check('S4 CS-3 情形表 ↔ 夹具 CASES 逐等（含 T-GAP-13 两分支 + 冒充支）', j(rs) === j(CLOCK_CASES), j(rs));
  check('S4b T-GAP-13 要求的两分支都在表内',
    rs.includes('same-millisecond') && rs.includes('no-commit-at-millisecond'));
}

// S5 D2 六情形逐条对齐行齐备 + 行 0（命名表）
{
  const ids = [...doc.matchAll(/^\| \*\*(D2-[a-f]|0（§2\.0 命名表）)\*\* \|/gm)].map((m) => m[1]);
  const need = ['0（§2.0 命名表）', 'D2-a', 'D2-b', 'D2-c', 'D2-d', 'D2-e', 'D2-f'];
  check('S5 CS-4 对齐表覆盖 D2-a…D2-f 六行 + 命名表行 0', need.every((x) => ids.includes(x)) && ids.length === 7, j(ids));
  const verdicts = [...doc.matchAll(/^\| \*\*(?:D2-[a-f]|0（§2\.0 命名表）)\*\* \| \*\*([^*]+)\*\* \|/gm)].map((m) => m[1]);
  check('S5b 每行都有明确判定（需修订 / 采认+补强），无空判', verdicts.length === 7 && verdicts.every((v) => /需修订|采认/.test(v)), j(verdicts));
  check('S5c 判词集合与「六行全需修订」的登记一致（无「不需修订」）', !verdicts.some((v) => v === '不需修订'), j(verdicts));
}

// S6 §6 正反例表 ↔ 夹具 RUN_TABLE 双向逐等；真库标记 ↔ 夹具 REAL_DB_CASES 双向逐等
const REAL_DB_CASES = ['T-P1', 'T-P2', 'T-P3', 'T-P4', 'T-P5', 'T-P9', 'T-N4', 'T-N5'];
const REAL_DB_MUTS = ['MUT-1', 'MUT-2', 'MUT-3'];
{
  const docIds = [...doc.matchAll(/^\| (T-[PN]\d+) \|/gm)].map((m) => m[1]);
  const docReal = [...doc.matchAll(/^\| (T-[PN]\d+) \|[^\n]*\| (✅|模型|文本) \|$/gm)].filter((m) => m[2] === '✅').map((m) => m[1]);
  const docMuts = [...doc.matchAll(/^\| (MUT-\d+) \|/gm)].map((m) => m[1]);
  const docMutsReal = [...doc.matchAll(/^\| (MUT-\d+) \|[^\n]*\| (✅|模型) \|$/gm)].filter((m) => m[2] === '✅').map((m) => m[1]);
  check('S6 §6 表 ↔ 夹具 RUN_TABLE 双向逐等',
    docIds.length === RUN_TABLE.length && docIds.every((x, i) => x === RUN_TABLE[i][0]),
    `doc=${docIds.join(',')} fix=${RUN_TABLE.map((x) => x[0]).join(',')}`);
  check('S6b 真库标记 ↔ 夹具 REAL_DB_CASES 双向逐等（真库用例不得只在契约里声称）',
    eqSet(docReal, REAL_DB_CASES), `doc=${docReal.join(',')}`);
  check('S6c MUT 表 ↔ 夹具 MUT 自验双向逐等，且真库 MUT 集逐等',
    docMuts.length === MUT_IDS.length && docMuts.every((x, i) => x === MUT_IDS[i]) && eqSet(docMutsReal, REAL_DB_MUTS),
    `doc=${docMuts.join(',')} fix=${MUT_IDS.join(',')} real=${docMutsReal.join(',')}`);
}

// S7 禁令清单七条齐备，且禁令 2 的形态与被禁的现状 SQL 实面对上
{
  const n = [...doc.matchAll(/^\d\. \*\*(入参|谓词|回显|游标|写回执|detail|审计面)/gm)].length;
  check('S7 CS-1.4 禁令封闭清单 7 条齐备', n === 7, String(n));
  const forbidden = /where recorded_seq <= \? order by recorded_seq, oid/.test(srcRead);
  check('S7b 禁令 2 点名的形态正是现网实面（read-context.ts 逐字谓词，登记不删）', forbidden);
  check('S7c 契约正文逐字含该被禁形态（不是转述）', doc.includes('where recorded_seq <= ? order by recorded_seq, oid')
    || doc.includes('recorded_seq <= ?'));
}

// S8 拒绝码零扩员 + 既有码真实存在（READ_CUTOFF_UNSAFE 此前零使用者 ⇒ 本契约收编）
{
  const closed = new Set([...srcCodes.matchAll(/^\s+\| '([A-Z_]+)'/gm)].map((m) => m[1]));
  const used = new Set(Object.values(CODES));
  check('S8 夹具使用的码全在 src 封闭集内', [...used].every((c) => closed.has(c)), j([...used].filter((c) => !closed.has(c))));
  check('S8b 本契约新增拒绝码数 = 0', NEW_REFUSAL_CODES.length === 0, j(NEW_REFUSAL_CODES));
  const inSrc = (srcCodes.match(/'READ_CUTOFF_UNSAFE'/g) ?? []).length;
  const usedInSrcImpl = srcPort.includes('READ_CUTOFF_UNSAFE') || srcRead.includes('READ_CUTOFF_UNSAFE');
  check('S8c READ_CUTOFF_UNSAFE 在 src 声明处 1 次且实现零使用（"收编" 陈述成立）',
    inSrc === 1 && !usedInSrcImpl, `decl=${inSrc}`);
}

// S9 上层锚点逐字保真（git show 取 blob，只读）
const ANCHORS = [
  ['5ec38974fc', 'docs/architecture/V3_CODE_ARCHITECTURE_DRAFT.md', 'readonly recordedAsOf?: CommitSequence;'],
  ['5ec38974fc', 'docs/architecture/V3_CODE_ARCHITECTURE_DRAFT.md', '同一 Space 统一不可变登记顺序/提交截点'],
  ['5ec38974fc', 'docs/architecture/V3_CODE_ARCHITECTURE_DRAFT.md', '未提交的 ID 对其他事务不可见'],
  ['5ec38974fc', 'docs/architecture/V3_CODE_ARCHITECTURE_DRAFT.md', '预留 ObjectID 不冒充已存在对象'],
  ['37de107ed5', 'docs/architecture/H_S_R_SCHEMA_DECISIONS_DRAFT.md', '同一毫秒内可有多个提交'],
  ['37de107ed5', 'docs/architecture/H_S_R_SCHEMA_DECISIONS_DRAFT.md', '时间戳不能充当事务快照边界'],
  ['37de107ed5', 'docs/architecture/H_S_R_SCHEMA_DECISIONS_DRAFT.md', 'epoch_ms → CommitSequence'],
  ['37de107ed5', 'docs/architecture/H_S_R_SCHEMA_DECISIONS_DRAFT.md', '回显实际使用的截点'],
  ['37de107ed5', 'docs/architecture/H_S_R_SCHEMA_FOUNDATIONS_DRAFT.md', '回显实际生效值与缺省'],
  ['37de107ed5', 'docs/architecture/H_S_R_INTERFACE_FOUNDATIONS_DRAFT.md', '调用方自报的 `recorded_at`（登记时间由系统产生）'],
  ['37de107ed5', 'docs/architecture/H_S_R_INTERFACE_FOUNDATIONS_DRAFT.md', '自包含知识截点'],
  ['37de107ed5', 'docs/architecture/H_S_R_INTERFACE_FOUNDATIONS_DRAFT.md', '游标跨越截点 → 拒绝并要求新查询'],
];
{
  const blobs = new Map();
  let gitOk = true;
  for (const [sha, path] of ANCHORS) {
    const k = sha + ':' + path;
    if (!blobs.has(k)) {
      try { blobs.set(k, execFileSync('git', ['show', k], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 << 20 })); }
      catch (e) { gitOk = false; check('S9a git show 取上层 blob（只读）', false, k + '：' + e.message.split('\n')[0]); break; }
    }
  }
  if (gitOk) {
    const miss = ANCHORS.filter(([sha, path, s]) => !blobs.get(sha + ':' + path).includes(s));
    check('S9 上层原文逐字保真（11 条锚点全部在 blob 中原样存在）', miss.length === 0, miss.map((m) => m[2]).join(' / '));
    const quoted = ANCHORS.filter(([, , s]) => !doc.includes(s));
    check('S9b 契约正文对这批锚点逐字引用（非转述）', quoted.length === 0, quoted.map((m) => m[2]).join(' / '));
  }
}

// S10 新命名对三 ref 零命中（命名正源；只读 git grep）
const NEW_WORDS = ['LedgerEventSequence', 'ledger_event_seq', 'commit_record', 'commit_recorded_at_ms',
  'resolved_cutoff', 'resolved_at_ms', 'commit_sequence'];
{
  const refs = ['0369c3196c', '5ec38974fc', '37de107ed5'];
  const hits = [];
  let ok = true;
  for (const w of NEW_WORDS) for (const r of refs) {
    try {
      const out = execFileSync('git', ['grep', '-w', '--count', w, r, '--', '*.md'], { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      if (out.trim().length > 0) hits.push(w + '@' + r);
    } catch (e) { if (e.status !== 1) { ok = false; } }   // git grep 无命中时 exit 1
  }
  check(`S10 ${NEW_WORDS.length} 个新命名对 #42/#44/#47 三 ref 零命中`, ok && hits.length === 0, hits.join(','));
}

// S11 现网截点谓词形态异或（现状 / 已按契约改，恰居其一）
{
  const eventForm = /from domain_state where recorded_seq <= \?/.test(srcRead);
  const commitForm = /commit_sequence\s*<=/.test(srcRead);
  check('S11 现网可见性谓词二形异或（现状事件序 XOR 已按 CS-1.4 改提交归属）',
    eventForm !== commitForm, `eventForm=${eventForm} commitForm=${commitForm}`);
  check('S11b 本席未改 src/**（夹具只读实测）', eventForm === true && commitForm === false);
}

// S12 存储面守卫实测（meta 计数器第三键；夹具形状建库）
// ============================================================ 真库层（node:sqlite）

function grab(re, what) {
  const m = srcPort.match(re);
  if (!m) { process.stderr.write(`FATAL: 未能从 sqlite-port.ts 逐字提取${what}\n`); process.exit(2); }
  return m[0];
}
const DDL_META = grab(/create table if not exists meta\(key text primary key, value integer not null\);/, 'meta 表');
const DDL_META_SEED = grab(/insert or ignore into meta\(key, value\) values\('id_counter', 0\), \('ledger_seq', 0\);/, 'meta 种子');
const DDL_META_MONO = grab(/create trigger if not exists meta_counter_monotonic[\s\S]*?end;/, 'meta 单调守卫');
const DDL_META_NODEL = grab(/create trigger if not exists meta_ledger_seq_no_delete[\s\S]*?end;/, 'meta DELETE 守卫');
const DDL_LEDGER = grab(/create table if not exists ledger\([\s\S]*?\n\);/, 'ledger 表');
const DDL_LEDGER_UP = grab(/create trigger if not exists ledger_no_update[\s\S]*?end;/, 'ledger_no_update');
const DDL_LEDGER_DEL = grab(/create trigger if not exists ledger_no_delete[\s\S]*?end;/, 'ledger_no_delete');
const DDL_STATE = grab(/create table if not exists domain_state\([\s\S]*?\n\);/, 'domain_state 表');
const DDL_STATE_UP = grab(/create trigger if not exists domain_state_no_update[\s\S]*?end;/, 'domain_state_no_update');

/** 夹具形状（**不是生产 DDL**）：提交账 + 归属列。G2 落地时按 CS-1.3 重写。 */
const FIXTURE_COMMIT_SHAPE = `
alter table ledger add column commit_sequence integer;
create table commit_record(
  commit_sequence integer primary key,
  ledger_event_seq_from integer not null,
  ledger_event_seq_to integer not null,
  commit_recorded_at_ms integer not null
);
create trigger commit_record_no_update before update on commit_record
begin select raise(abort, 'HISTORY_IMMUTABLE'); end;
create trigger commit_record_no_delete before delete on commit_record
begin select raise(abort, 'HISTORY_IMMUTABLE'); end;
insert into meta(key, value) values('commit_sequence', 0);`;

let scratch = null; const openDbs = [];
function openWorld(tag) {
  if (scratch === null) {
    try { scratch = mkdtempSync(join(REPO_ROOT, '.scratch', 'g1-cs-fix-')); }
    catch (e) {
      try { scratch = mkdtempSync(join(tmpdir(), 'g1-cs-fix-')); }
      catch (e2) { process.stderr.write(`FATAL: 建不起临时库目录：${e2.message}\n`); process.exit(2); }
    }
  }
  const file = join(scratch, tag + '.sqlite');
  const mk = () => {
    const db = new DatabaseSync(file);
    db.exec('pragma journal_mode = wal; pragma busy_timeout = 3000; pragma foreign_keys = on; pragma recursive_triggers = on;');
    return db;
  };
  const w = { file, a: mk(), b: mk(), close() { try { this.a.close(); } catch {} try { this.b.close(); } catch {} } };
  openDbs.push(w);
  w.a.exec([DDL_META, DDL_META_SEED, DDL_META_MONO, DDL_META_NODEL, DDL_LEDGER, DDL_LEDGER_UP, DDL_LEDGER_DEL,
    DDL_STATE, DDL_STATE_UP, FIXTURE_COMMIT_SHAPE].join('\n'));
  return w;
}
const metaVal = (db, k) => db.prepare(`select value from meta where key=?`).get(k)?.value ?? null;
const countOf = (db, t) => db.prepare(`select count(*) c from ${t}`).get().c;
/** 现网逐字机制写点形状：每事件 +1（kernel.ts:777-780 nextLedgerSeq）。 */
function nextEventSeq(raw) {
  const cur = raw.prepare(`select value from meta where key='ledger_seq'`).get().value;
  raw.prepare(`update meta set value = ? where key='ledger_seq'`).run(cur + 1);
  return cur + 1;
}
/** CS-1.2 分配点形状：每事务一次、首写之前预留。 */
function reserveCommit(raw) {
  const cur = raw.prepare(`select value from meta where key='commit_sequence'`).get().value;
  raw.prepare(`update meta set value = ? where key='commit_sequence'`).run(cur + 1);
  return cur + 1;
}
/** 真库读面：按提交归属过滤（唯一允许形状，join ledger 取归属）。 */
const visibleCommit = (db, cutoff) => db.prepare(
  `select d.oid from domain_state d join ledger l on l.seq = d.recorded_seq
     where l.commit_sequence <= ? order by d.oid`).all(cutoff).map((r) => r.oid);
/** MUT-1 旁路：现网逐字 SQL（read-context.ts:101）。 */
const visibleEventSeq = (db, cutoff) => db.prepare(
  `select oid from domain_state where recorded_seq <= ? order by recorded_seq, oid`).all(cutoff).map((r) => r.oid);
/** 打开期不变量 I-1（等号）+ I-5（事件轴被提交轴完全划分）。 */
function invariantsOk(db) {
  const head = metaVal(db, 'commit_sequence') ?? 0;
  const maxCommit = db.prepare(`select coalesce(max(commit_sequence),0) m from commit_record`).get().m;
  if (maxCommit !== head) return false;
  const rows = db.prepare(`select commit_sequence c, min(seq) f, max(seq) t, count(*) n from ledger
     where commit_sequence is not null group by commit_sequence order by commit_sequence`).all();
  const recs = db.prepare(`select commit_sequence c, ledger_event_seq_from f, ledger_event_seq_to t from commit_record
     order by commit_sequence`).all();
  if (rows.length !== recs.length) return false;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].c !== recs[i].c || rows[i].f !== recs[i].f || rows[i].t !== recs[i].t) return false;
    if (recs[i].t - recs[i].f + 1 !== rows[i].n) return false;
    if (i > 0 && recs[i].f !== recs[i - 1].t + 1) return false;      // 无重叠无缝隙
  }
  return true;
}
function dbCase(name, fn) {
  let why = null;
  try { why = fn(); } catch (e) { why = '真库异常：' + (e && e.message ? e.message : String(e)); }
  check(name, why === null, why === undefined ? '' : String(why));
}
function expectAbort(fn, signal, label) {
  try { fn(); return label + '：期望 abort 却成功'; }
  catch (e) { return String(e.message).includes(signal) ? null : label + '：信号词应为 ' + signal + '，实为 ' + e.message; }
}
/** 真库写一个提交：n 个事件（事件序连号），墙钟 wall。 */
function commitTx(w, n, wall) {
  const b = w.b;
  b.exec('begin immediate;');
  const c = reserveCommit(b);
  let first = null, last = null;
  for (let i = 0; i < n; i++) {
    const s = nextEventSeq(b);
    if (first === null) first = s; last = s;
    b.exec(`insert into ledger(seq, space, event_type, payload_json, recorded_at, commit_sequence)
            values(${s},'SP-1','object-registered','{}',${wall},${c})`);
    b.exec(`insert into domain_state(ns,oid,revision,payload_json,recorded_seq)
            values('ns','o${s}',1,'{}',${s})`);
  }
  b.exec(`insert into commit_record values(${c},${first},${last},${wall})`);
  return c;
}

// ============================================================ 表驱动正反例

function run_T_P1() {
  return dbCase('T-P1 一次原子提交三事件：提交截点切不开它（真库）', () => {
    const w = openWorld('t-p1');
    commitTx(w, 3, 1000);
    w.b.exec('commit;');
    const c1 = w.a.prepare(`select coalesce(max(commit_sequence),0) m from commit_record`).get().m;
    if (c1 !== 1) return '提交序应为 1，实为 ' + c1;
    if (!eqArr(visibleCommit(w.a, 0), [])) return 'cutoff=0 应空视图';
    if (!eqArr(visibleCommit(w.a, 1), ['o1', 'o2', 'o3'])) return 'cutoff=1 应见全三行：' + j(visibleCommit(w.a, 1));
    const L = new Ledger();
    const t = L.begin(1000);
    t.register('o1', {}, 1000); t.register('o2', {}, 1000); t.register('o3', {}, 1000);
    t.commit();
    const fam = snapshotFamily(L);
    for (let c = 0; c <= 4; c++) if (!fam.has(j(L.snapshotOf(c)))) return '截点 ' + c + ' 的可见集不在快照族内';
    if (fam.has(j(L.snapshotEventFilter(2)))) return '事件序过滤给出的中间态竟在快照族内（语料无判别力）';
    return null;
  });
}

function run_T_P2() {
  return dbCase('T-P2 事务中途回滚不可见 + 无 ghost + 序号稠密复用（真库）', () => {
    const w = openWorld('t-p2');
    const c = commitTx(w, 3, 1000);
    if (c !== 1) return '首次预留应为 1';
    if (metaVal(w.b, 'commit_sequence') !== 1 || metaVal(w.b, 'ledger_seq') !== 3) return '事务内自身水位应前移';
    w.b.exec('rollback;');
    if (metaVal(w.a, 'commit_sequence') !== 0 || metaVal(w.a, 'ledger_seq') !== 0) return '另一连接应见水位仍为 0';
    if (countOf(w.a, 'ledger') !== 0 || countOf(w.a, 'commit_record') !== 0 || countOf(w.a, 'domain_state') !== 0) return '另一连接不应见任何行';
    if (countOf(w.b, 'ledger') !== 0) return '回滚后本连接也不应见行';
    const c2 = commitTx(w, 3, 2000);
    w.b.exec('commit;');
    if (c2 !== 1) return '回滚后序号应被复用（稠密无 ghost），实为 ' + c2;
    if (metaVal(w.a, 'commit_sequence') !== 1 || metaVal(w.a, 'ledger_seq') !== 3) return '提交后水位应为 1/3';
    if (!invariantsOk(w.a)) return '提交后不变量 I-1/I-5 应成立';
    return null;
  });
}

function run_T_P3() {
  return dbCase('T-P3 第三个计数器键受既有泛化守卫保护（真库）', () => {
    const w = openWorld('t-p3');
    commitTx(w, 1, 1000); w.b.exec('commit;');
    const e1 = expectAbort(() => w.a.prepare(`update meta set value = 0 where key='commit_sequence'`).run(),
      'META_COUNTER_MONOTONICITY', '下调水位');
    if (e1) return e1;
    const e2 = expectAbort(() => w.a.prepare(`update meta set value = 0 where key='ledger_seq'`).run(),
      'META_COUNTER_MONOTONICITY', '下调事件序水位');
    if (e2) return e2;
    return null;
  });
}

function run_T_P4() {
  return dbCase('T-P4 提交期失败与回滚同形（零残留，真库）', () => {
    const w = openWorld('t-p4');
    commitTx(w, 2, 1000); w.b.exec('commit;');
    const before = { head: metaVal(w.a, 'commit_sequence'), seq: metaVal(w.a, 'ledger_seq'), l: countOf(w.a, 'ledger'), cr: countOf(w.a, 'commit_record') };
    commitTx(w, 2, 2000);
    let why = null;
    try { w.b.exec(`insert into commit_record values(99,990,991,2000)`); throw new Error('injected commit-phase failure'); }
    catch (e) { why = e.message; }
    w.b.exec('rollback;');
    if (!/injected commit-phase failure/.test(String(why))) return '注入未生效：' + why;
    const after = { head: metaVal(w.a, 'commit_sequence'), seq: metaVal(w.a, 'ledger_seq'), l: countOf(w.a, 'ledger'), cr: countOf(w.a, 'commit_record') };
    if (j(before) !== j(after)) return '注入前后状态不等：' + j(before) + ' vs ' + j(after);
    const c = commitTx(w, 1, 3000); w.b.exec('commit;');
    if (c !== 2) return '下一次成功提交应复用被释放的号 2，实为 ' + c;
    return null;
  });
}

function run_T_P5() {
  return dbCase('T-P5 值域封闭：解析只读提交账，不读 meta 水位（真库 + 模型）', () => {
    const w = openWorld('t-p5');
    commitTx(w, 2, 1000); w.b.exec('commit;');
    commitTx(w, 1, 2000); w.b.exec('commit;');
    const keys = w.a.prepare(`select commit_sequence c from commit_record order by commit_sequence`).all().map((r) => r.c);
    if (!eqArr(keys, [1, 2])) return '提交账键集应为 [1,2]：' + j(keys);
    if (!invariantsOk(w.a)) return 'I-1/I-5 应成立';
    // 把 meta 水位前跳（ghost 号形态，触发器只拦下调）⇒ 可解析集不得随之扩大
    w.a.prepare(`update meta set value = 9 where key='commit_sequence'`).run();
    const after = w.a.prepare(`select commit_sequence c from commit_record order by commit_sequence`).all().map((r) => r.c);
    if (!eqArr(after, keys)) return '可解析集随 meta 水位前跳而变（解析器读了水位）';
    if (invariantsOk(w.a)) return 'I-1 等号判据应能识破 ghost 水位';
    const L = new Ledger();
    const t1 = L.begin(1000); t1.register('o1', {}, 1000); t1.register('o2', {}, 1000); t1.commit();
    const t2 = L.begin(2000); t2.register('o3', {}, 2000); t2.commit();
    L.commitHead = 9;
    if (!eqSet(resolvableSet(L), [0, 1, 2])) return '模型可解析集应 = {0} ∪ 提交账键集：' + j([...resolvableSet(L)]);
    let refused = false;
    try { resolveCutoff(L, { branch: 'commit-sequence', value: 3 }); }
    catch (e) { refused = e.code === CODES.READ_CUTOFF_UNSAFE; }
    if (!refused) return 'c>committedHead 必须拒（不得钳制）';
    return null;
  });
}

function run_T_P6() {
  return dbCase('T-P6 墙钟解析单调（P1）：回拨与晚到都不回退', () => {
    const L = new Ledger();
    const mk = (wall, n) => { const t = L.begin(wall); for (let i = 0; i < n; i++) t.register('o' + (L.rows.length + 1), {}, wall); t.commit(); };
    mk(1000, 1); mk(2000, 1);
    const conds = [999, 1000, 1500, 1999, 2000, 2500];
    const before = conds.map((t) => resolveCutoff(L, { branch: 'recorded-at-ms', epochMs: t }).resolvedCutoff);
    mk(1500, 1);                         // 回拨：晚提交携带更早墙钟
    mk(1200, 1);
    const after = conds.map((t) => resolveCutoff(L, { branch: 'recorded-at-ms', epochMs: t }).resolvedCutoff);
    for (let i = 0; i < conds.length; i++) if (after[i] < before[i]) return 't=' + conds[i] + ' 截点回退：' + before[i] + '→' + after[i];
    if (resolveCutoff(L, { branch: 'recorded-at-ms', epochMs: 1750 }).resolvedCutoff !== 1) return '前缀界应在 c2(2000) 处断：t=1750 期望 1';
    if (resolveCutoff(L, { branch: 'recorded-at-ms', epochMs: 2000 }).resolvedCutoff !== 4) return 't=2000 时前缀内全部 ≤2000 ⇒ 期望 4';
    return null;
  });
}

function run_T_P7() {
  return dbCase('T-P7 已解析截点固定（CS-3.2）：游标自包含、重放不重解析、不重不漏', () => {
    const L = new Ledger();
    const t1 = L.begin(1000); t1.register('o1', {}, 1000); t1.commit();
    const r = resolveCutoff(L, { branch: 'recorded-at-ms', epochMs: 1500 });
    if (r.resolvedCutoff !== 1 || r.resolvedAtMs !== 1000) return '首次解析应为 c=1/at=1000';
    const cur = mkCursor(r, { oid: 'o1', revision: 1, reanchorMs: 1500 }, 'fp', 'AC-1');
    const first = pageWithCursor(L, cur, 'AC-1');
    const t2 = L.begin(1200); t2.register('o2', {}, 1200); t2.commit();    // 晚到墙钟提交
    const again = pageWithCursor(L, cur, 'AC-1');
    if (!eqArr(first, again)) return '同一游标重放结果改变（已解析截点未固定）：' + j(first) + ' vs ' + j(again);
    const fresh = resolveCutoff(L, { branch: 'recorded-at-ms', epochMs: 1500 });
    if (fresh.resolvedCutoff < r.resolvedCutoff) return '新的独立解析回退了截点';
    let refused = false;
    try { pageWithCursor(L, cur, 'AC-2'); } catch (e) { refused = e.code === CODES.CONTEXT_INCOMPLETE; }
    if (!refused) return '跨授权类游标必须拒';
    return null;
  });
}

function run_T_P8() {
  return dbCase('T-P8 同毫秒多提交 + 该刻无提交 + 两提交之间（CS-3.2 表）', () => {
    const L = new Ledger();
    const mk = (wall, tag) => { const t = L.begin(wall); t.register(tag, {}, wall); t.commit(); };
    mk(1000, 'o1'); mk(1000, 'o2'); mk(1000, 'o3'); mk(2000, 'o4');
    const at1000 = resolveCutoff(L, { branch: 'recorded-at-ms', epochMs: 1000 });
    if (at1000.resolvedCutoff !== 3) return '同毫秒三提交应全进截点（c=3），实为 ' + at1000.resolvedCutoff;
    if (at1000.resolvedAtMs !== 1000) return 'resolvedAtMs 应为该提交的墙钟 1000';
    const early = resolveCutoff(L, { branch: 'recorded-at-ms', epochMs: 999 });
    if (early.resolvedCutoff !== 0 || early.resolvedAtMs !== null) return '早于一切提交 ⇒ c=0 且 resolvedAtMs=null';
    if (j(L.snapshotOf(0)) !== j([])) return 'c=0 必须是空视图';
    const between = resolveCutoff(L, { branch: 'recorded-at-ms', epochMs: 1500 });
    if (between.resolvedCutoff !== 3) return '两提交之间应落此前最后一个提交（3）';
    const dflt = resolveCutoff(L, undefined);
    if (dflt.resolvedCutoff !== 4 || dflt.cutoffDefaulted !== true) return '缺省截点 = 已提交截点且回显 defaulted';
    return null;
  });
}

function run_T_P9() {
  return dbCase('T-P9 同一提交跨毫秒不被墙钟切开（CS-3.3，真库）', () => {
    const w = openWorld('t-p9');
    w.b.exec('begin immediate;');
    const c = reserveCommit(w.b);
    const s1 = nextEventSeq(w.b), s2 = nextEventSeq(w.b);
    w.b.exec(`insert into ledger(seq, space, event_type, payload_json, recorded_at, commit_sequence)
              values(${s1},'SP-1','object-registered','{}',1000,${c})`);
    w.b.exec(`insert into ledger(seq, space, event_type, payload_json, recorded_at, commit_sequence)
              values(${s2},'SP-1','object-revised','{}',1999,${c})`);
    w.b.exec(`insert into domain_state(ns,oid,revision,payload_json,recorded_seq) values('ns','o1',1,'{}',${s1})`);
    w.b.exec(`insert into domain_state(ns,oid,revision,payload_json,recorded_seq) values('ns','o2',1,'{}',${s2})`);
    w.b.exec(`insert into commit_record values(${c},${s1},${s2},1999)`);   // 一提交一枚墙钟
    w.b.exec('commit;');
    const ledgerRows = w.a.prepare(`select commit_sequence c, commit_recorded_at_ms ms from commit_record
       order by commit_sequence`).all();
    const resolveAt = (t) => { let runMax = -Infinity, c = 0;
      for (const r of ledgerRows) { if (r.ms > runMax) runMax = r.ms; if (runMax > t) break; c = r.c; } return c; };
    for (const t of [999, 1000, 1500, 1998, 1999, 2500]) {
      const seen = visibleCommit(w.a, resolveAt(t)).length;
      if (seen !== 0 && seen !== 2) return '墙钟条件 t=' + t + ' 把一次原子提交切开（见 ' + seen + ' 行）';
    }
    if (visibleCommit(w.a, resolveAt(1999)).length !== 2) return 't≥提交墙钟后应整提交可见';
    const perRow = [1000, 1500, 1998].map((t) => w.a.prepare(
      `select count(*) n from ledger where commit_sequence <= 1 and recorded_at <= ?`).get(t).n);
    if (!perRow.some((n) => n === 1)) return '夹具语料应能让逐行墙钟过滤切出单行（否则本例无判别力）：' + j(perRow);
    return null;
  });
}

function run_T_N1() {
  return dbCase('T-N1 越界/畸形态提交序入参各拒，detail 不回显 head', () => {
    const L = new Ledger();
    const t = L.begin(1000); t.register('o1', {}, 1000); t.commit();
    const bad = [3, -1, 1.5, '1', NaN, undefined];
    for (const v of bad) {
      let got = null;
      try { resolveCutoff(L, { branch: 'commit-sequence', value: v }); got = 'ACCEPT'; }
      catch (e) { got = e.code; }
      if (got !== CODES.READ_CUTOFF_UNSAFE) return 'value=' + j(v) + ' 应拒 READ_CUTOFF_UNSAFE，实为 ' + got;
    }
    let d = null;
    try { resolveCutoff(L, { branch: 'commit-sequence', value: 99 }); } catch (e) { d = e.detail; }
    const txt = j(d);
    if (/"head"|"committedHead"|99/.test(txt) || txt.includes(String(committedHead(L)))) return 'detail 泄露水位/差分：' + txt;
    if (j(Object.keys(d)) !== j(['reason'])) return 'detail 键集应只有 reason：' + txt;
    return null;
  });
}

function run_T_N2() {
  return dbCase('T-N2 截点入参形态非法 ⇒ CONTEXT_INCOMPLETE（未声明截点 = 未定义查询）', () => {
    const L = new Ledger();
    const t = L.begin(1000); t.register('o1', {}, 1000); t.commit();
    const bad = [5, 'commit-sequence', { value: 1 }, { branch: 'ledger-event-sequence', value: 1 },
      { branch: 'recorded-at-ms' }, { branch: 'recorded-at-ms', epochMs: 'soon' }, []];
    for (const v of bad) {
      let got = null;
      try { resolveCutoff(L, v); got = 'ACCEPT'; } catch (e) { got = e.code + ':' + j(e.detail); }
      if (got !== CODES.CONTEXT_INCOMPLETE + ':' + j({ reason: 'as-of-shape-unknown' })) {
        return '入参 ' + j(v) + ' 应拒 CONTEXT_INCOMPLETE(as-of-shape-unknown)，实为 ' + got;
      }
    }
    return null;
  });
}

function run_T_N3() {
  return dbCase('T-N3 游标跨授权类：拒且对外同形、无真因词', () => {
    const L = new Ledger();
    const t = L.begin(1000); t.register('o1', {}, 1000); t.commit();
    const cur = mkCursor(resolveCutoff(L, undefined), { oid: 'o1', revision: 1, reanchorMs: 1000 }, 'fp', 'AC-1');
    let mine = null, theirs = null;
    try { pageWithCursor(L, cur, 'AC-1'); mine = 'ACCEPT'; } catch (e) { mine = j([e.code, e.detail]); }
    try { pageWithCursor(L, cur, 'AC-2'); theirs = 'ACCEPT'; } catch (e) { theirs = j([e.code, e.detail]); }
    if (mine !== 'ACCEPT') return '同授权类应放行，实为 ' + mine;
    if (theirs !== j([CODES.CONTEXT_INCOMPLETE, { reason: 'cursor-shape-unknown' }])) return '跨授权类应拒：' + theirs;
    if (/AC-1|AC-2|authority/.test(theirs)) return '拒绝面泄露了授权类差异：' + theirs;
    return null;
  });
}

function run_T_N4() {
  return dbCase('T-N4 冒充：拿事件序数值当提交序传入，永不可达事务内部（真库）', () => {
    const w = openWorld('t-n4');
    commitTx(w, 3, 1000); w.b.exec('commit;');          // c=1，事件 1/2/3
    commitTx(w, 2, 2000); w.b.exec('commit;');          // c=2，事件 4/5
    const head = metaVal(w.a, 'ledger_seq');            // 事件轴头 = 5
    const family = new Set();
    for (const r of w.a.prepare(`select commit_sequence c from commit_record order by commit_sequence`).all()) {
      family.add(j(visibleCommit(w.a, r.c)));
    }
    family.add(j([]));
    for (let k = 0; k <= head + 2; k++) {
      const set = visibleCommit(w.a, k);                // 提交归属过滤（真判据）
      if (!family.has(j(set))) return '事件序值 ' + k + ' 冒充提交序后产出了非快照集：' + j(set);
    }
    const neverCommitted = j(['o1', 'o2']);
    for (let k = 0; k <= head + 2; k++) if (j(visibleCommit(w.a, k)) === neverCommitted) return 'k=' + k + ' 竟给出从未提交的中间态';
    if (!family.has(j(['o1', 'o2', 'o3']))) return '快照族应含第一次提交的完整三行：' + j([...family]);
    return null;
  });
}

function run_T_N5() {
  return dbCase('T-N5 回填式分配物理不可行（提交后补归属撞 append-only，真库）', () => {
    const w = openWorld('t-n5');
    commitTx(w, 2, 1000); w.b.exec('commit;');
    return expectAbort(() => w.a.prepare(`update ledger set commit_sequence = 7 where seq = 1`).run(),
      'HISTORY_IMMUTABLE', '提交后回填归属列');
  });
}

function run_T_N6() {
  return dbCase('T-N6 可见性判据形状扫描：被禁形态被点名、允许形态放过', () => {
    const forbiddenShape = /\b(recorded_seq|l?\.?seq)\s*<=\s*\?/;
    const allowedShape = /\bcommit_sequence\s*<=\s*\?/;
    const m = srcRead.match(/where recorded_seq <= \? order by recorded_seq, oid/);
    if (!m) return '现网谓词形态漂移（read-context.ts 已改？⇒ 本例与 S7b 需 repin）';
    const netLive = m[0];
    if (!forbiddenShape.test(netLive)) return '形状扫描器认不出被禁形态 ⇒ 该判据空转';
    if (allowedShape.test(netLive)) return '扫描器把被禁形态误判为允许';
    if (!allowedShape.test(`where l.commit_sequence <= ?`)) return '允许形态未被放过';
    if (forbiddenShape.test(`where l.commit_sequence <= ?`)) return '允许形态被误判为禁止';
    return null;
  });
}

function run_T_N7() {
  return dbCase('T-N7 派生面水位按事件推进 ⇒ 判非法（水位必须 ∈ 可解析截点集）', () => {
    const L = new Ledger();
    const t = L.begin(1000); t.register('o1', {}, 1000); t.register('o2', {}, 1000); t.commit();
    const legal = resolvableSet(L);
    if (legal.has(2)) return '事件序 2 竟在提交轴可解析集内';
    const eventWatermark = L.eventHead;                 // = 2，按事件推进的水位
    if (legal.has(eventWatermark)) return '按事件推进的水位应不可解析';
    const okWatermark = committedHead(L);
    if (!legal.has(okWatermark)) return '按提交推进的水位应可解析';
    return null;
  });
}

function run_T_N8() {
  return dbCase('T-N8 回显/detail 泄露面：无 head、无差分、无区间', () => {
    const L = new Ledger();
    const t = L.begin(1000); t.register('o1', {}, 1000); t.commit();
    const r = resolveCutoff(L, undefined);
    const leaky = { ...r, headAtResolution: committedHead(L), rowsBehind: L.rows.length, eventSeqRange: [t.first, t.last] };
    const allowedKeys = ['asOfBranch', 'resolvedCutoff', 'resolvedAtMs', 'cutoffDefaulted'];
    const real = Object.keys(r);
    if (!real.every((k) => allowedKeys.includes(k))) return '真判据回显键越出封闭集：' + j(real);
    const leaked = Object.keys(leaky).filter((k) => !allowedKeys.includes(k));
    if (leaked.length === 0) return '泄漏体夹具自身无效（无泄漏键可测）';
    let bad = false;
    try { resolveCutoff(L, { branch: 'commit-sequence', value: 42 }); }
    catch (e) { bad = Object.keys(e.detail).some((k) => !['reason'].includes(k)); }
    if (bad) return '拒绝 detail 含非 reason 键';
    return null;
  });
}

// ============================================================ 架空判据变异（常驻不删）

function mutSelfCheck(id, direction, realOk, mutSide, note) {
  check(id + ' 自验（' + direction + '）' + (note ? '：' + note : ''),
    realOk === true && mutSide === true, `real=${j(realOk)} mut=${j(mutSide)}`);
}

// MUT-1 把可见性判据改成用事件序过滤（现网逐字 SQL）⇒ 必红：产出从未原子提交过的中间态
{
  const w = openWorld('mut-1');
  commitTx(w, 3, 1000); w.b.exec('commit;');
  const fam = new Set([j([])]);
  const head = w.a.prepare(`select coalesce(max(commit_sequence),0) m from commit_record`).get().m;
  for (let c = 0; c <= head; c++) fam.add(j(visibleCommit(w.a, c)));
  let mut = false, real = true;
  for (let k = 0; k <= metaVal(w.a, 'ledger_seq'); k++) {
    if (!fam.has(j(visibleCommit(w.a, k)))) real = false;                 // 真判据：任何截点都是快照
    if (!fam.has(j(visibleEventSeq(w.a, k)))) mut = true;                 // 架空判据：出现非快照的中间态
  }
  mutSelfCheck('MUT-1 可见性判据改用事件序过滤', '真判据拦住 ∧ 架空判据放过同一负例', real, mut,
    '架空侧在 k=2 处给出「只见 o1,o2」的中间态；真判据全部落回快照族');
}

// MUT-2 墙钟解析逐行取事件 recorded_at ⇒ 必红：一次提交被墙钟切开
{
  const L = new Ledger();
  const t = L.begin(1999); t.register('o1', {}, 1000); t.register('o2', {}, 1999); t.commit();
  const fam = snapshotFamily(L);
  const c = resolveCutoff(L, { branch: 'recorded-at-ms', epochMs: 1500 }).resolvedCutoff;
  const real = fam.has(j(L.snapshotOf(c)));
  const mut = !fam.has(j(L.snapshotWallPerRow(1500)));
  mutSelfCheck('MUT-2 墙钟解析逐行取 recorded_at', '真判据拦住 ∧ 架空判据放过同一负例', real, mut, '同一提交跨毫秒 ⇒ 架空侧切出半提交');
}

// MUT-3 提交序分配点搬到 COMMIT 之后 ⇒ 必红：H append-only 使回填物理不可行（真库）
{
  const w = openWorld('mut-3');
  w.b.exec('begin immediate;');
  const s1 = nextEventSeq(w.b), s2 = nextEventSeq(w.b);
  for (const [s, wt] of [[s1, 1000], [s2, 1000]]) {
    w.b.exec(`insert into ledger(seq, space, event_type, payload_json, recorded_at) values(${s},'SP-1','object-registered','{}',${wt})`);
    w.b.exec(`insert into domain_state(ns,oid,revision,payload_json,recorded_seq) values('ns','o${s}',1,'{}',${s})`);
  }
  w.b.exec('commit;');
  const mutBlocked = expectAbort(
    () => w.a.prepare(`update ledger set commit_sequence = 1 where seq in (1,2)`).run(),
    'HISTORY_IMMUTABLE', 'mut-3') === null;
  const real = (() => {
    const w2 = openWorld('mut-3-real');
    commitTx(w2, 2, 1000); w2.b.exec('commit;');
    return invariantsOk(w2.a) && visibleCommit(w2.a, 1).length === 2;
  })();
  mutSelfCheck('MUT-3 分配点搬到 COMMIT 之后（回填式）', '真判据可行且满足不变量 ∧ 架空形态被 append-only 物理拦死', real, mutBlocked, '条文与物理不可同真');
}

// MUT-4 已解析截点每页重解析（游标回落当前时间）⇒ 必红：重放漏项
{
  const L = new Ledger();
  const t1 = L.begin(1000); t1.register('o1', {}, 1000); t1.commit();
  const cur = mkCursor(resolveCutoff(L, { branch: 'recorded-at-ms', epochMs: 1500 }),
    { oid: 'o1', revision: 1, reanchorMs: 1500 }, 'fp', 'AC-1');
  const first = pageWithCursor(L, cur, 'AC-1');
  const t2 = L.begin(1200); t2.register('o2', {}, 1200); t2.commit();
  const real = eqArr(pageWithCursor(L, cur, 'AC-1'), first);
  const mut = !eqArr(pageWithCursorMUT4(L, { ...cur, position: { oid: 'o1', revision: 1, reanchorMs: 9999 } }, 'AC-1'), first);
  mutSelfCheck('MUT-4 游标每页重解析墙钟', '真判据拦住 ∧ 架空判据放过同一负例', real, mut, '架空侧同一游标第二页多出晚到行');
}

// MUT-5 提交序按事件 +1（现状一值兼两职）⇒ 必红：存在截点给出事务真前缀
{
  const L = new Ledger();
  const t = L.begin(1000); t.register('o1', {}, 1000); t.register('o2', {}, 1000); t.register('o3', {}, 1000); t.commit();
  const fam = snapshotFamily(L);
  const real = [0, 1].every((c) => fam.has(j(L.snapshotOf(c))));
  const mut = fam.has(j(L.snapshotEventFilter(1))) === false;   // 事件序当提交序 ⇒ c=1 给出 o1 一行，不在族内
  mutSelfCheck('MUT-5 提交序按事件 +1（两轴合一）', '真判据拦住 ∧ 架空判据放过同一负例', real, mut, '架空侧截点 1 = 只登记了一条事件的世界');
}

// S12 存储面守卫缺口实测（登记不删；BF-07）——必须在其它真库用例之后跑
{
  let why = null;
  try {
    const w = openWorld('s12');
    commitTx(w, 1, 1000); w.b.exec('commit;');
    let delLedgerSeqBlocked = false;
    try { w.a.prepare(`delete from meta where key='ledger_seq'`).run(); } catch { delLedgerSeqBlocked = true; }
    let delCommitBlocked = false;
    try { w.a.prepare(`delete from meta where key='commit_sequence'`).run(); delCommitBlocked = false; }
    catch { delCommitBlocked = true; }
    if (!delLedgerSeqBlocked) why = 'ledger_seq 的 DELETE 守卫应生效';
    else if (delCommitBlocked) why = '新键的 DELETE 竟也被拦 ⇒ BF-07 登记的缺口已消失，须回填契约正文';
    else if (metaVal(w.a, 'commit_sequence') !== null) why = 'DELETE 应已删掉该键（缺口形状与登记一致）';
  } catch (e) { why = '真库异常：' + e.message; }
  check('S12 守卫缺口实测：既有 DELETE 守卫只钉 ledger_seq ⇒ 第三计数器键可删（已登记 BF-07）', why === null, why ?? '');
}

// ============================================================ 运行 + 收尾

for (const [, fn] of RUN_TABLE) fn();   // dbCase 内部逐条 check

for (const w of openDbs) w.close();
if (scratch !== null) { try { rmSync(scratch, { recursive: true, force: true }); } catch {} }

process.stdout.write(`\nCS 夹具：PASS ${pass} / FAIL ${fail}` + (fail ? '（FAIL 项：' + fails.join('；') + '）' : '') + '\n');
process.exit(fail ? 1 : 0);
