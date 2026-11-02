#!/usr/bin/env node
/*
  G1-CONTRACT-IDEMPOTENCY.fixtures.mjs —— 与 G1-CONTRACT-IDEMPOTENCY.md 互相对账的夹具（专题②）。

  用法：node experiments/v3-code-architecture-poc/g1/G1-CONTRACT-IDEMPOTENCY.fixtures.mjs
  退出码：0 = 契约结构自洽 + 崩溃矩阵 9 格正反例全命中 + 两个经典窗口不变量在原子引擎下全绿
          + 两条架空变异（两段提交 / 事务外查键）全部被断言捕获；1 = 有任一项 FAIL；2 = 夹具无法运行。

  纪律：
  - 零依赖（只用 node:fs / node:path / node:url），node 直跑；不起数据库、不写任何生产代码（模型形）。
  - 引擎 = 契约 IDC-1 的最小模型：atomic（单提交全有全无，WAL 语义）为真实判据；
    twophase-ledger-last / twophase-ledger-first（两段提交）与 toctou（事务外查键）为架空引擎，
    常驻不删除（仓内「架空不删除」纪律）。
  - 变异方向：真实引擎必须让 W1/W2 不变量与并发断言全绿；架空引擎必须让同一批断言变红
    （被夹具「捕获」记 PASS）。若架空引擎反而全绿 ⇒ 断言无判别力 ⇒ 夹具整体判红（IDC-10 反向自检）。
  - D1..D6 = 与契约正文的静态对账（拒绝码名、勘误、矩阵行数、IDC 条数、DEP 行数、架空常驻声明）。
*/

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DOC_PATH = join(HERE, 'G1-CONTRACT-IDEMPOTENCY.md');
const SELF_PATH = fileURLToPath(import.meta.url);

let doc = '';
try {
  doc = readFileSync(DOC_PATH, 'utf8');
} catch (e) {
  process.stderr.write('FATAL: 契约正文读不到：' + e.message + '\n');
  process.exit(2);
}
const selfSrc = readFileSync(SELF_PATH, 'utf8');

let pass = 0, fail = 0;
const fails = [];
function check(name, cond, detail) {
  if (cond) { pass += 1; process.stdout.write('PASS  ' + name + '\n'); }
  else { fail += 1; fails.push(name); process.stdout.write('FAIL  ' + name + (detail ? '  —— ' + detail : '') + '\n'); }
}

// ============================================================ 模型（IDC-1/IDC-4/IDC-5 的最小形）

// key = 四元组（IDC-4）；actorRef 缺失 ⇒ 不入账不查账（IDC-5 步骤 1）
const keyOf = (req) => [req.actorRef, req.spaceId, req.operation, req.clientRequestId].join('\u0000');

function newSpace(spaceId) {
  return {
    spaceId,
    domain: new Map(),        // targetOid -> [{ rev, originKey|null, bytes }]
    ledger: new Map(),        // keyStr -> receipt 行（IDC-4 形）
    historyBroken: false,     // SF-60 历史面故障注入（M7 支路）
    hotStats: 0,              // 纯缓存命中计数：调窗只动它，不动语义（IDC-11 / SI-41 测试钉）
  };
}

const resolveRef = (space, ref) => {
  if (space.historyBroken) throw { code: 'HISTORY_UNREADABLE' }; // M7：fail-loud，不伪造不回落新请求
  const [oid, revStr] = String(ref).split('@');
  const list = space.domain.get(oid);
  const rev = Number(revStr);
  return list && list.some(r => r.rev === rev) ? ref : null;
};

const buildResponse = (space, row) => {
  if (row.responseSnapshot !== null) return row.responseSnapshot; // 主路径：逐字节回吐（IDC-5）
  // M7/IDC-11：快照已归档 ⇒ 按首次提交截点 c1（模型中即当前域，域为追加型不可变）从引用重展开
  const ref = resolveRef(space, row.resultRef);
  if (ref === null) throw { code: 'RECEIPT_CORRUPT' };
  return 'resp:' + ref;
};

// 崩溃点（IDC-9）：atomic 引擎 = WAL 单提交，apply 中或之前被杀 ⇒ 一切未发生
const KILL_POINTS = ['beforeFetch', 'afterKeyBuild', 'duringCommitApply', 'afterCommitApply'];

// engine:
//   'atomic'        —— IDC-1 真实判据：键行与领域效果同一次提交（全有全无）
//   'twophase-last' —— MUT-IDEM-1a：先提交领域，再独立提交键行（业务在键不在窗口）
//   'twophase-first'—— MUT-IDEM-1b：先提交键行，再独立提交领域（键在业务不在窗口）
//   'toctou'        —— MUT-IDEM-2：事务外读索引 → 开事务写入（IDC-7 违例）
function makeEngine(engine) {
  const crash = (killAt, point) => { if (killAt === point) throw { __crash: true }; };
  const applyAll = (space, staged, killAt) => {
    crash(killAt, 'duringCommitApply');            // WAL：commit 记录未落 ⇒ apply 视同未发生
    if (engine === 'twophase-last') {
      staged.domain(space); crash(killAt, 'midTwoPhase'); staged.ledger(space);
    } else if (engine === 'twophase-first') {
      staged.ledger(space); crash(killAt, 'midTwoPhase'); staged.domain(space);
    } else {
      staged.domain(space); staged.ledger(space);  // 同提交：两写之间不存在可杀的稳定态
    }
  };

  // 单次尝试；返回回执或拒绝（模型内 throw {__crash} 表示进程被杀，由 recover 捕获）
  function attempt(space, req, { killAt = null, interleavedRead = null } = {}) {
    if (killAt === 'beforeFetch') throw { __crash: true };
    // IDC-5 步骤 1：取证；actorRef 缺失 ⇒ 不入账不查账（宁可重复，不可吞掉）
    if (req.actorRef === null || req.actorRef === undefined) {
      applyAll(space, {
        domain: (s) => pushRevision(s, req, null),
        ledger: () => {},
      }, killAt === 'afterKeyBuild' ? 'duringCommitApply' : killAt);
      return { accepted: true, bypassLedger: true };
    }
    if (killAt === 'afterKeyBuild') throw { __crash: true };
    const ks = keyOf(req);
    // IDC-5 步骤 3：查索引 + 比对。IDC-7：必须在持锁窗口内；toctou 引擎在事务外用事务外快照
    const row0 = engine === 'toctou' && interleavedRead ? interleavedRead.get(ks) : space.ledger.get(ks);
    if (row0 !== undefined) {
      if (row0.requestDigest === req.requestDigest) {
        space.hotStats += 1;
        return { accepted: true, replay: true, response: buildResponse(space, row0) };
      }
      return {
        accepted: false,
        code: 'TOOL_INPUT',
        serviceCode: 'IDEMPOTENCY_KEY_REUSED',
        step: 'client_request_id',
      };
    }
    // IDC-5 步骤 4：前置（SI-42）；不匹配 ⇒ 拒写且零键行（INV-6）
    const head = (space.domain.get(req.targetOid) ?? []).length;
    if (req.expectedHead !== undefined && req.expectedHead !== head) {
      return { accepted: false, code: 'PRECONDITION_MISMATCH' };
    }
    const nextRev = head + 1;
    const ref = req.targetOid + '@' + nextRev;
    const response = 'resp:' + ref;
    const staged = {
      domain: (s) => pushRevision(s, req, ks),
      ledger: (s) => s.ledger.set(ks, {
        actorRef: req.actorRef, spaceId: req.spaceId, operation: req.operation,
        clientRequestId: req.clientRequestId, requestDigest: req.requestDigest,
        resultRef: ref, responseSnapshot: response, commitSequence: nextCommit(s),
        recordedAtMs: 1, rowSchemaVersion: 1,
      }),
    };
    applyAll(space, staged, killAt);
    return { accepted: true, response, first: true };
  }

  return {
    name: engine,
    attempt,
    // 并发同键：两请求读 interleaved 快照后先后进入写事务（IDC-7 违例的可观测差）
    concurrentSameKey(space, req) {
      const snap = new Map(space.ledger);
      attempt(space, req, { interleavedRead: engine === 'toctou' ? snap : null });
      attempt(space, req, { interleavedRead: engine === 'toctou' ? snap : null });
      return space;
    },
  };
}

let _seq = 0;
const nextCommit = (_space) => ++_seq;
function pushRevision(space, req, originKey) {
  const list = space.domain.get(req.targetOid) ?? [];
  list.push({ rev: list.length + 1, originKey, bytes: 'body:' + req.requestDigest });
  space.domain.set(req.targetOid, list);
}

const recover = (fn) => { try { fn(); return { crashed: false }; } catch (e) { if (e && e.__crash) return { crashed: true }; throw e; } };
const revisionCount = (space) => [...space.domain.values()].reduce((n, l) => n + l.length, 0);

// 窗口不变量（IDC-9）：W1 无孤儿键 ∧ W2 无孤儿效果
function invariants(S) {
  let orphanKeys = 0, orphanEffects = 0;
  for (const row of S.ledger.values()) {
    let ok = false;
    try { ok = resolveRef(S, row.resultRef) !== null; } catch { ok = false; }
    if (!ok) orphanKeys += 1;
  }
  const keys = new Set(S.ledger.keys());
  for (const list of S.domain.values())
    for (const r of list) if (r.originKey !== null && !keys.has(r.originKey)) orphanEffects += 1;
  return { orphanKeys, orphanEffects };
}

// 窗口参数 = 纯缓存策略面（IDC-11 / SI-41 测试钉）：调小它只动命中统计，不动任何语义判定
function shrinkWindow(S) { S.hotStats = 0; }

const baseReq = (over = {}) => ({
  actorRef: 'user:u1', spaceId: 'sp-A', operation: 'record:create',
  clientRequestId: 'c-1', requestDigest: 'sha256:AAA', targetOid: 'OBJ-1',
  ...over,
});

const engines = {
  atomic: makeEngine('atomic'),
  twophaseLast: makeEngine('twophase-last'),
  twophaseFirst: makeEngine('twophase-first'),
  toctou: makeEngine('toctou'),
};

// ============================================================ T1..T9（崩溃矩阵逐格 + 正例）

{ // T1（M 正例 / IDC-5）：同键同体重放 3 次 ⇒ 恰 1 修订 + 逐字节首次结果
  const S = newSpace('sp-A');
  const r1 = engines.atomic.attempt(S, baseReq());
  const r2 = engines.atomic.attempt(S, baseReq());
  const r3 = engines.atomic.attempt(S, baseReq());
  check('T1 重放 3 次恰 1 修订', revisionCount(S) === 1, 'got ' + revisionCount(S));
  check('T1 重放逐字节首次结果', r2.response === r1.response && r3.response === r1.response && r2.replay === true);
  check('T1 恰一回执行', S.ledger.size === 1);
  const S2 = newSpace('sp-A');
  engines.atomic.attempt(S2, baseReq());
  shrinkWindow(S2); // SI-41 测试钉：调小窗口（仅缓存策略）后重放
  const rr = engines.atomic.attempt(S2, baseReq());
  check('T1 调窗后重放仍返回首次结果且零新记录', rr.replay === true && rr.response === 'resp:OBJ-1@1' && revisionCount(S2) === 1);
}

{ // T2（M4）：同键异体 ⇒ REUSED + 零任何记录 + 回执行不改写
  const S = newSpace('sp-A');
  engines.atomic.attempt(S, baseReq());
  const before = JSON.stringify([...S.ledger]);
  const bad = engines.atomic.attempt(S, baseReq({ requestDigest: 'sha256:BBB' }));
  check('T2 异体拒码 = TOOL_INPUT + IDEMPOTENCY_KEY_REUSED + step', bad.accepted === false && bad.code === 'TOOL_INPUT' && bad.serviceCode === 'IDEMPOTENCY_KEY_REUSED' && bad.step === 'client_request_id');
  check('T2 零记录（修订与键行均不增）', revisionCount(S) === 1 && S.ledger.size === 1);
  check('T2 回执行不改写（INV-5）', JSON.stringify([...S.ledger]) === before);
}

{ // T3（M3）：提交中被杀（atomic/WAL：apply 中或前被杀 = 一切未发生）⇒ 重试恰 1 修订
  let allOk = true, detail = '';
  for (const kp of KILL_POINTS) {
    const S = newSpace('sp-A');
    const rec = recover(() => engines.atomic.attempt(S, baseReq(), { killAt: kp }));
    const replay = rec.crashed ? engines.atomic.attempt(S, baseReq()) : engines.atomic.attempt(S, baseReq());
    if (!(revisionCount(S) === 1 && replay.accepted === true)) { allOk = false; detail = kp; }
    if (kp !== 'afterCommitApply' && rec.crashed === false) { allOk = false; detail = kp + ':应崩未崩'; }
  }
  check('T3 任意 kill 点恢复后重试恰 1 修订且合法（M3/INV-1）', allOk, detail);
}

{ // T4（W1+W2 / IDC-9）：atomic 引擎任意 kill 点穷举 ⇒ 双向无孤儿
  let allOk = true, detail = '';
  for (const kp of KILL_POINTS) {
    const S = newSpace('sp-A');
    recover(() => engines.atomic.attempt(S, baseReq(), { killAt: kp }));
    const iv = invariants(S);
    if (iv.orphanKeys !== 0 || iv.orphanEffects !== 0) { allOk = false; detail = kp + ' ' + JSON.stringify?.(iv); }
  }
  check('T4 W1+W2 任意 kill 点双向无孤儿（atomic）', allOk, detail);
}

{ // T5（M5/IDC-7）：并发同键同体 ⇒ atomic 串行恰 1 修订
  const S = newSpace('sp-A');
  engines.atomic.concurrentSameKey(S, baseReq());
  check('T5 并发同键同体恰 1 修订（atomic 持锁串行）', revisionCount(S) === 1, 'got ' + revisionCount(S));
  const S2 = newSpace('sp-A');
  engines.atomic.attempt(S2, baseReq());
  const late = engines.atomic.attempt(S2, baseReq({ requestDigest: 'sha256:CCC' }));
  check('T5 并发同键异体（后到）⇒ REUSED 零记录', late.accepted === false && late.serviceCode === 'IDEMPOTENCY_KEY_REUSED' && revisionCount(S2) === 1);
}

{ // T6（M6）：跨 Space 同键互不干扰
  const Sa = newSpace('sp-A'), Sb = newSpace('sp-A');
  Sb.spaceId = 'sp-B';
  const ra = engines.atomic.attempt(Sa, baseReq());
  const rb = engines.atomic.attempt(Sb, baseReq({ spaceId: 'sp-B' }));
  const replayA = engines.atomic.attempt(Sa, baseReq());
  check('T6 跨 Space 同名键各 1 记录', revisionCount(Sa) === 1 && revisionCount(Sb) === 1 && ra.accepted && rb.accepted && rb.first === true);
  check('T6 各自重放命中各自回执', replayA.replay === true && replayA.response === ra.response);
}

{ // T7（M7/IDC-11）：快照归档 ⇒ 按引用重展开等值；历史不可读 ⇒ fail-loud
  const S = newSpace('sp-A');
  const r1 = engines.atomic.attempt(S, baseReq());
  const row = S.ledger.get(keyOf(baseReq()));
  row.responseSnapshot = null; // 归档：仅存储位置变化，键/摘要/引用/序号原样
  const r2 = engines.atomic.attempt(S, baseReq());
  check('T7 归档后重放语义等价首次结果', r2.replay === true && r2.response === r1.response);
  S.historyBroken = true;
  let loud = null;
  try { engines.atomic.attempt(S, baseReq()); } catch (e) { loud = e && e.code; }
  check('T7 历史不可读 ⇒ fail-loud 不回空不吞重放', loud === 'HISTORY_UNREADABLE');
}

{ // T8（M8/IDC-5 步骤 1）：actor_ref 缺失 ⇒ 不入账、宁可重复
  const S = newSpace('sp-A');
  const a = engines.atomic.attempt(S, baseReq({ actorRef: null }));
  const b = engines.atomic.attempt(S, baseReq({ actorRef: null }));
  check('T8 actor_ref 缺失两次同字节 ⇒ 2 记录 + 账本零行', a.accepted && b.accepted && revisionCount(S) === 2 && S.ledger.size === 0);
}

{ // T9（M9/INV-6）：前置失败零键行；修正后同键重发成功
  const S = newSpace('sp-A');
  const bad = engines.atomic.attempt(S, baseReq({ operation: 'record:revise', expectedHead: 7 }));
  check('T9 前置不匹配 ⇒ 拒写零残留（键行也不写）', bad.accepted === false && bad.code === 'PRECONDITION_MISMATCH' && revisionCount(S) === 0 && S.ledger.size === 0);
  const ok = engines.atomic.attempt(S, baseReq({ operation: 'record:revise', expectedHead: 0 }));
  check('T9 修正后同键重发成功且绑定首次结果', ok.accepted === true && revisionCount(S) === 1 && S.ledger.size === 1);
}

// ============================================================ MUT-IDEM-1 / MUT-IDEM-2（架空引擎 ⇒ 必红，IDC-10）

{ // MUT-IDEM-1a（两段提交，键行后段）：mid 杀 ⇒ 业务在键不在（M2 显形）+ 重放写第二修订（违 SI-41）
  const S = newSpace('sp-A');
  recover(() => engines.twophaseLast.attempt(S, baseReq(), { killAt: 'midTwoPhase' }));
  const iv = invariants(S);
  let addedByReplay = null;
  try { addedByReplay = revisionCount(S) + 0; engines.twophaseLast.attempt(S, baseReq()); addedByReplay = revisionCount(S) - addedByReplay; }
  catch { addedByReplay = -1; }
  check('MUT-IDEM-1a 被捕获：孤儿效果显形（W2 红）', iv.orphanEffects > 0, 'orphanEffects=' + iv.orphanEffects);
  check('MUT-IDEM-1a 被捕获：重放产生第二修订（SI-41 违例显形）', addedByReplay === 1, 'replay added ' + addedByReplay);
}

{ // MUT-IDEM-1b（两段提交，键行前段）：mid 杀 ⇒ 键在业务不在（M1 显形 = 幻影回执）
  const S = newSpace('sp-A');
  recover(() => engines.twophaseFirst.attempt(S, baseReq(), { killAt: 'midTwoPhase' }));
  const iv = invariants(S);
  check('MUT-IDEM-1b 被捕获：孤儿键显形（W1 红，回执引用不可解析）', iv.orphanKeys > 0, 'orphanKeys=' + iv.orphanKeys);
}

{ // MUT-IDEM-2（事务外查键）：并发同键 ⇒ 2 修订（IDC-7 违例显形）
  const S = newSpace('sp-A');
  engines.toctou.concurrentSameKey(S, baseReq());
  check('MUT-IDEM-2 被捕获：事务外查键并发同键产生 2 修订', revisionCount(S) === 2, 'got ' + revisionCount(S));
}

// ============================================================ D1..D6（与契约正文静态对账）

{ // D1：拒绝形态按 blob 原文码名 + 勘误名只作勘误出现
  check('D1 正文含 TOOL_INPUT + IDEMPOTENCY_KEY_REUSED + step 形态', /IDEMPOTENCY_KEY_REUSED/.test(doc) && /step:"?client_request_id/.test(doc) && /TOOL_INPUT/.test(doc));
  const stale = (doc.match(/IDEMPOTENCY_BODY_MISMATCH/g) ?? []).length;
  check('D1 勘误名至多 1 处且伴随勘误注记', stale <= 1 && (stale === 0 || /名不符 blob/.test(doc)), 'stale=' + stale);
}
{ // D2：崩溃矩阵 ≥6 行
  const rows = (doc.match(/^\| M\d+ \|/gm) ?? []).length;
  check('D2 矩阵行数 ≥ 6', rows >= 6, 'rows=' + rows);
}
{ // D3：IDC 条文编号 ≥11 且 IDC-1..IDC-11 全在
  const ids = new Set((doc.match(/IDC-\d+/g) ?? []));
  const need = [...Array(11)].map((_, i) => 'IDC-' + (i + 1));
  check('D3 IDC-1..IDC-11 条文齐备', need.every((x) => ids.has(x)), [...ids].join(','));
}
{ // D4：DEP 依赖登记 ≥3 行（专题①）
  const deps = new Set((doc.match(/DEP-①-\d|DEP-汇编-\d|DEP-PR9-\d/g) ?? []));
  check('D4 专题①依赖登记 ≥3（DEP-①-1..3）', deps.has('DEP-①-1') && deps.has('DEP-①-2') && deps.has('DEP-①-3'), [...deps].join(','));
}
{ // D5：正文零新增 Port RefusalCode 的主张在册
  check('D5 零新增码表码主张在册', /零新增 Port RefusalCode/.test(doc));
}
{ // D6：架空变异常驻（本夹具 + 正文两侧）
  check('D6 架空常驻：MUT-IDEM-1/2 两侧在册', /MUT-IDEM-1/.test(doc) && /MUT-IDEM-2/.test(doc) && /必红/.test(doc) && /twophase/.test(selfSrc) && /toctou/.test(selfSrc));
}

// 反向自检（IDC-10）：若三条架空捕获有任何一条未红 ⇒ 判据无判别力 ⇒ 上面已记 FAIL，整体 exit 1。
// （即：上面 MUT-* 的 check 方向就是「变异必须被捕获」。）

process.stdout.write('\n合计：PASS ' + pass + ' / FAIL ' + fail + (fail ? '  [' + fails.join('; ') + ']' : '') + '\n');
process.exit(fail ? 1 : 0);
