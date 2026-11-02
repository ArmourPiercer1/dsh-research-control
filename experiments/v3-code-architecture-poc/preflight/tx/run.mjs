#!/usr/bin/env node
/**
 * preflight/tx/run.mjs — JC-1 事务时序可执行性（P0 修订的真实证据）
 *
 * 背景（外部审查 P0，2026-11-03）：
 *   JC-1 旧顺序 = 开事务 → 幂等判定 → **预留序号并插入 `commit_record`（带事件闭区间）** →
 *   **写幂等回执（带 resultRef/responseSnapshot）** → 执行领域写与事件。
 *   该顺序**组合不可实现**：插入 `commit_record` 时事件区间未知（CS 又规定其不可 UPDATE），
 *   写回执时首次结果未知（IDC 规定 `resultRef`/`responseSnapshot` 必填）。
 *   单独看 CS、IDC 都 PASS，合起来要求系统提前写入尚不存在的数据 —— 这是组合可实现性问题。
 *
 * 本实验验证**修订后的唯一顺序**在真实 SQLite 上成立：
 *   BEGIN → 幂等判定（重放/拒绝支不占号）→ 预留 CommitSequence（只 `meta.commit_sequence+1`）
 *   → 执行领域命令与事件 → 取真实事件闭区间与结果引用 → INSERT 不可变 `commit_record`
 *   → INSERT 幂等回执（c1 读自 commit_record）→ COMMIT。
 *
 * 同时验证三组幂等回放缺口（旧夹具只有「连续两次重放、只比 resultJson」）：
 *   IDEM-1 中间插入其他提交后重放 ⇒ 返回首次 c1，不随 head 变化；
 *   IDEM-2 同键异体 ⇒ 拒（IDEMPOTENCY_KEY_REUSED），零任何记录；
 *   IDEM-3 首次提交后撤销调用者权限 ⇒ 零新领域效果，但按**当前**授权决定是否披露旧结果。
 *
 * 性质：类甲实验（真实 SQLite + 真实 PoC Kernel 事务/事件面；`commit_record`/回执为实验侧夹具表，
 * 形状按 CS-1.3 / IDC-4；不落生产代码、不改 `src/**`）。
 * 退出码：0 = 全过；1 = 有断言失败（技术否证）；2 = 脚手架失败（不得包装为技术结论）。
 */
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const SELF = fileURLToPath(import.meta.url);
const POC = dirname(dirname(dirname(SELF)));
const log = (...a) => console.log(...a);

if (!process.execArgv.some((a) => a.startsWith('--experimental-transform-types'))) {
  const r = spawnSync(process.execPath, ['--experimental-transform-types', '--no-warnings', SELF, ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(r.status ?? 2);
}

const { openWorld, PRINCIPAL } = await import('../../src/harness/world.ts');
const { TEST_OBJECT_MODEL, CAP_OBJECT_MODEL } = await import('../../src/domains/test-object-model.ts');
const { Refusal } = await import('../../src/contracts/index.ts');

const ADMIN = PRINCIPAL('tx-admin');
const GRANTS = { 'tx-admin': ['space-write', 'space-read'] };
const digest = (o) => createHash('sha256').update(JSON.stringify(o)).digest('hex');
const results = [];
const failures = [];
function check(id, title, fn) {
  try {
    const detail = fn();
    results.push({ id, ok: true, detail });
    log(`\n✅ [${id}] ${title}\n   ${detail}`);
  } catch (e) {
    results.push({ id, ok: false, detail: String(e?.message ?? e) });
    failures.push(`${id}: ${e?.message ?? e}`);
    log(`\n❌ [${id}] ${title}\n   ${e?.stack ?? e}`);
  }
}
const eq = (a, b, what) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what} 不一致：实际=${JSON.stringify(a)} 期望=${JSON.stringify(b)}`);
};
const refusal = (fn) => {
  try { fn(); return 'NO_REFUSAL'; } catch (e) {
    const msg = String(e?.message ?? e);
    const m = msg.match(/\b([A-Z][A-Z0-9_]{5,})\b/);
    return (e?.code && e.code !== 'ERR_SQLITE_ERROR') ? e.code : (m ? m[1] : `OTHER:${msg.slice(0, 60)}`);
  }
};

mkdirSync(join(POC, '.poc-data'), { recursive: true });
const dir = mkdtempSync(join(POC, '.poc-data', 'tx-'));
const dbFile = join(dir, 'space.db');

// ─────────────── 夹具：按 CS-1.3 / IDC-4 形状建提交账与幂等回执（含不可变守卫） ───────────────
function installFixture(dbPath) {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`
      create table if not exists commit_record(
        commit_sequence integer primary key,
        ledger_event_seq_from integer not null,
        ledger_event_seq_to integer not null,
        commit_recorded_at_ms integer not null);
      create trigger if not exists commit_record_no_update before update on commit_record
        begin select raise(abort, 'HISTORY_IMMUTABLE'); end;
      create trigger if not exists commit_record_no_delete before delete on commit_record
        begin select raise(abort, 'HISTORY_IMMUTABLE'); end;
      create table if not exists idempotency_receipt(
        actor_ref text not null, space_id text not null, operation text not null, client_request_id text not null,
        digest_hex text not null, result_ref text not null, response_snapshot blob not null,
        commit_sequence integer not null, recorded_at_ms integer not null,
        primary key(actor_ref, space_id, operation, client_request_id));
      create trigger if not exists idem_receipt_no_update before update on idempotency_receipt
        begin select raise(abort, 'IDEMPOTENCY_RECEIPT_IMMUTABLE'); end;
      create trigger if not exists idem_receipt_no_delete before delete on idempotency_receipt
        begin select raise(abort, 'IDEMPOTENCY_RECEIPT_IMMUTABLE'); end;
      insert into meta(key, value) values('commit_sequence', 0)
        on conflict(key) do nothing;
    `);
  } finally { db.close(); }
}

const file = dbFile;
let w = openWorld({ file, space: 'SP-TX', grants: GRANTS, plugins: [TEST_OBJECT_MODEL] });
// 建库后安装夹具表；随后重开（真实打开期判据照跑）
w.close();
installFixture(file);
w = openWorld({ file, space: 'SP-TX', grants: GRANTS, plugins: [TEST_OBJECT_MODEL] });

const metaValue = (key) => w.raw.get('select value from meta where key=?', key)?.value;
const commitRows = () => w.raw.all('select * from commit_record order by commit_sequence');
const receipt = (actor, op, crid) => w.raw.get(
  'select * from idempotency_receipt where actor_ref=? and space_id=? and operation=? and client_request_id=?',
  actor, 'SP-TX', op, crid);
const ledgerRange = () => {
  const r = w.raw.get('select min(seq) lo, max(seq) hi, count(*) n from ledger');
  return { lo: r?.lo ?? null, hi: r?.hi ?? null, n: r?.n ?? 0 };
};

/**
 * 修订后的唯一实现顺序（本实验的被测对象）：一次 UoW 内完成全部八步（JC-1）。
 * 返回 { kind: 'commit'|'replay'|'denied', ... }。
 */
function submit({ actor = ADMIN.actorId, operation = 'test.create', clientRequestId, body, effect, replayAuthCheck, injectAfter }) {
  const key = { actor, space: 'SP-TX', operation, crid: clientRequestId };
  const reqDigest = digest(body);
  return w.uow(ADMIN, (tx) => {
    // 2. 幂等判定（同事务、持写锁窗口内）
    const hit = receipt(actor, operation, clientRequestId);
    if (hit) {
      if (hit.digest_hex !== reqDigest) {
        throw new Refusal('IDEMPOTENCY_KEY_REUSED', { step: 'client_request_id', operation });
      }
      // 6'. 重放支：不做领域前置、不占号；但**披露前按当前授权判定**
      if (replayAuthCheck && !replayAuthCheck(actor)) {
        throw new Refusal('REPLAY_ACCESS_DENIED', { reason: '调用者对首次结果已无读授权', commitSequence: hit.commit_sequence });
      }
      return { kind: 'replay', commitSequence: hit.commit_sequence, response: Buffer.from(hit.response_snapshot).toString('utf8') };
    }
    // 3. 发号点：只推进水位，不插 commit_record（区间尚不可知）
    const before = ledgerRange();
    w.raw.run("update meta set value = value + 1 where key='commit_sequence'");
    const c1 = Number(metaValue('commit_sequence'));
    const reservedAt = Date.now(); // 预留点取时（一事务一枚；JC-1 要求登记时钟取本步，不是落账时）
    // 4. 领域命令与事件（同事务）
    const out = effect(tx);
    // 5. 取**真实**事件闭区间
    const after = ledgerRange();
    const from = before.hi === null ? after.lo : before.hi + 1;
    const to = after.hi;
    if (to === null || to < from) {
      // 一次将产生零事件的写事务不占号：抛错即回滚（含发号）
      throw new Refusal('COMMIT_RECORD_EMPTY', { commitSequence: c1 });
    }
    // 6. 不可变提交账（区间已真实存在）
    w.raw.run('insert into commit_record(commit_sequence, ledger_event_seq_from, ledger_event_seq_to, commit_recorded_at_ms) values(?,?,?,?)',
      c1, from, to, reservedAt);
    // 7. 幂等回执：c1 **读自**刚插入的 commit_record 行（不是局部变量直传），结果取自上一步领域返回
    const ledgerRow = w.raw.get('select commit_sequence, commit_recorded_at_ms from commit_record where commit_sequence = ?', c1);
    if (!ledgerRow || Number(ledgerRow.commit_sequence) !== c1) throw new Error(`回执取值通道失效：commit_record(${c1}) 不可读`);
    if (injectAfter === 'commit_record') throw new Refusal('INJECTED_AFTER_COMMIT_RECORD', { commitSequence: c1 });
    const snapshot = JSON.stringify({ oid: out.oid, revision: out.revision });
    w.raw.run(`insert into idempotency_receipt(actor_ref, space_id, operation, client_request_id, digest_hex, result_ref, response_snapshot, commit_sequence, recorded_at_ms)
               values(?,?,?,?,?,?,?,?,?)`,
      actor, 'SP-TX', operation, clientRequestId, reqDigest, `${out.oid}@${out.revision}`, snapshot,
      Number(ledgerRow.commit_sequence), Number(ledgerRow.commit_recorded_at_ms));
    if (injectAfter === 'receipt') throw new Refusal('INJECTED_AFTER_RECEIPT', { commitSequence: c1 });
    return { kind: 'commit', commitSequence: c1, eventFrom: from, eventTo: to, response: snapshot };
  });
}

// ─────────────────────────── TX-1：可变事件数量下区间真实且账稠密 ───────────────────────────
check('TX-1', '可变事件数量（1 / 3 条）下 commit_record 区间逐条真实、提交序稠密、行存在⇔已提交', () => {
  const r1 = submit({
    clientRequestId: 'req-1', body: { a: 1 },
    effect: (tx) => { const oid = tx.createObject({ kind: 'test.claim', payload: { a: 1 } }); return { oid, revision: 1 }; },
  });
  eq(r1.kind, 'commit', '第一次提交形态');
  eq(r1.commitSequence, 1, '第一次提交序');
  eq([r1.eventFrom, r1.eventTo], [1, 1], '单事件闭区间');

  // 一个命令产生 3 条事件（创建 + 两次修订）
  const r2 = submit({
    clientRequestId: 'req-2', body: { b: 1 },
    effect: (tx) => {
      const oid = tx.createObject({ kind: 'test.claim', payload: { b: 1 } });
      tx.revise(oid, { payload: { b: 2 }, expectedRevision: 1 });
      tx.revise(oid, { payload: { b: 3 }, expectedRevision: 2 });
      return { oid, revision: 3 };
    },
  });
  eq([r2.eventFrom, r2.eventTo], [2, 4], '三事件闭区间');
  const rows = commitRows();
  eq(rows.map((r) => [r.commit_sequence, r.ledger_event_seq_from, r.ledger_event_seq_to]), [[1, 1, 1], [2, 2, 4]], '提交账逐行');
  eq(Number(metaValue('commit_sequence')), 2, '水位与提交账等号（稠密）');
  const span = rows.reduce((n, r) => n + (r.ledger_event_seq_to - r.ledger_event_seq_from + 1), 0);
  eq(span, ledgerRange().n, '提交账区间总长 = 账本事件数（无空洞、无重叠）');
  return `c1=[1,1]、c2=[${r2.eventFrom},${r2.eventTo}]；水位 2 = 提交账 2 行；区间总长 ${span} = 事件数 ${ledgerRange().n}`;
});

// ───────────────────── TX-2：失败回滚（在提交账插入之后抛错）零残留 ─────────────────────
check('TX-2', '事务内失败（领域写后 / 提交账后 / 回执后三个注入点）⇒ 号/账/回执/领域效果同生同灭，号可复用', () => {
  const snap = () => ({
    meta: Number(metaValue('commit_sequence')), rows: commitRows().length, ledger: ledgerRange().n,
    objs: w.raw.get('select count(*) c from object_directory').c,
    receipts: w.raw.get('select count(*) c from idempotency_receipt').c,
  });
  const before = snap();
  // ① 领域写已发生、提交账未插入
  const c1 = refusal(() => submit({
    clientRequestId: 'req-crash-domain', body: { c: 1 },
    effect: (tx) => { tx.createObject({ kind: 'test.claim', payload: { c: 1 } }); throw new Refusal('INJECTED_FAILURE', {}); },
  }));
  // ② 提交账已插入、回执未插入
  const c2 = refusal(() => submit({
    clientRequestId: 'req-crash-commit', body: { c: 2 }, injectAfter: 'commit_record',
    effect: (tx) => { const oid = tx.createObject({ kind: 'test.claim', payload: { c: 2 } }); return { oid, revision: 1 }; },
  }));
  // ③ 回执已插入、COMMIT 未发生
  const c3 = refusal(() => submit({
    clientRequestId: 'req-crash-receipt', body: { c: 3 }, injectAfter: 'receipt',
    effect: (tx) => { const oid = tx.createObject({ kind: 'test.claim', payload: { c: 3 } }); return { oid, revision: 1 }; },
  }));
  const after = snap();
  eq(after, before, '三个注入点回滚后元数据/提交账/账本/身份行/回执');
  const next = submit({ clientRequestId: 'req-after-crash', body: { ok: 1 }, effect: (tx) => { const oid = tx.createObject({ kind: 'test.claim', payload: { ok: 1 } }); return { oid, revision: 1 }; } });
  eq(next.commitSequence, before.meta + 1, '失败未烧号（复用同一号）');
  return `三个注入点（${c1}/${c2}/${c3}）后零残留；下一提交 c=${next.commitSequence} = 水位 ${before.meta}+1（未烧号）`;
});

// ───────────────────────── TX-3：提交账与回执不可改写 ─────────────────────────
check('TX-3', 'commit_record / idempotency_receipt 的 UPDATE 与 DELETE 被拒（不可变账）', () => {
  const updCommit = refusal(() => w.raw.run('update commit_record set ledger_event_seq_to = 99 where commit_sequence = 1'));
  const delCommit = refusal(() => w.raw.run('delete from commit_record where commit_sequence = 1'));
  const updReceipt = refusal(() => w.raw.run("update idempotency_receipt set result_ref = 'x' where client_request_id = 'req-1'"));
  const delReceipt = refusal(() => w.raw.run("delete from idempotency_receipt where client_request_id = 'req-1'"));
  eq([updCommit, delCommit, updReceipt, delReceipt],
    ['HISTORY_IMMUTABLE', 'HISTORY_IMMUTABLE', 'IDEMPOTENCY_RECEIPT_IMMUTABLE', 'IDEMPOTENCY_RECEIPT_IMMUTABLE'],
    '不可变守卫拒绝码（四条）');
  return `UPDATE/DELETE 提交账 ⇒ ${updCommit}/${delCommit}；改写/删除回执 ⇒ ${updReceipt}/${delReceipt}`;
});

// ───────────────── TX-4：旧顺序（先插提交账）不可实现的真反例 ─────────────────
check('TX-4', '负例：按旧 JC-1 顺序「先插提交账再执行领域写」无法同时满足区间真实与不可变', () => {
  // 旧顺序在真实库上的可取形只有两种：占位区间（事后必错）或事后修正（撞不可变）。
  const oldFile = join(dir, 'space-old-order.db');
  w.close();
  copyFileSync(file, oldFile);
  const wOld = openWorld({ file: oldFile, space: 'SP-TX', grants: GRANTS, plugins: [TEST_OBJECT_MODEL] });
  const beforeCount = wOld.raw.get('select count(*) n from commit_record').n;
  let insertedRange = null;
  const code = refusal(() => wOld.uow(ADMIN, (tx) => {
    const before = wOld.raw.get('select coalesce(max(seq),0) hi from ledger').hi;
    wOld.raw.run("update meta set value = value + 1 where key='commit_sequence'");
    const c = Number(wOld.raw.get('select value from meta where key=?', 'commit_sequence').value);
    // 旧顺序：此刻只能写占位区间（领域写尚未发生）
    wOld.raw.run('insert into commit_record(commit_sequence, ledger_event_seq_from, ledger_event_seq_to, commit_recorded_at_ms) values(?,?,?,?)',
      c, before + 1, before + 1, 1);
    insertedRange = [before + 1, before + 1];
    const oid = tx.createObject({ kind: 'test.claim', payload: { old: 1 } });
    tx.revise(oid, { payload: { old: 2 }, expectedRevision: 1 });
    const after = wOld.raw.get('select max(seq) hi from ledger').hi;
    // 想对齐真实区间 ⇒ 必须改已插入的提交账 ⇒ 撞不可变守卫
    wOld.raw.run('update commit_record set ledger_event_seq_to = ? where commit_sequence = ?', after, c);
    return c;
  }));
  const state = wOld.raw.get('select count(*) n from commit_record').n;
  wOld.close();
  w = openWorld({ file, space: 'SP-TX', grants: GRANTS, plugins: [TEST_OBJECT_MODEL] });
  if (code !== 'HISTORY_IMMUTABLE') throw new Error(`旧顺序应被不可变守卫否证，实际 ${code}`);
  if (state !== beforeCount) throw new Error(`旧顺序的占位提交账不应留存（回滚后 ${state} ≠ 原 ${beforeCount}）`);
  return `占位区间 [${insertedRange[0]},${insertedRange[1]}] 写入后，真实区间修正 ⇒ ${code}；事务回滚，零残留`
    + `（结论：区间必须在事件落库之后才可写，故旧顺序不可实现）`;
});

// ───────────────── IDEM-1：中间插入其他提交后重放仍返回首次 c1 ─────────────────
check('IDEM-1', '首次提交后插入其他提交，再重放首次请求 ⇒ 返回首次 c1（不随 head 变化）', () => {
  const first = submit({ clientRequestId: 'idem-a', body: { x: 1 }, effect: (tx) => { const oid = tx.createObject({ kind: 'test.claim', payload: { x: 1 } }); return { oid, revision: 1 }; } });
  const other = submit({ clientRequestId: 'idem-b', body: { y: 1 }, effect: (tx) => { const oid = tx.createObject({ kind: 'test.claim', payload: { y: 1 } }); return { oid, revision: 1 }; } });
  if (other.commitSequence <= first.commitSequence) throw new Error('中间提交未取得更大的提交序');
  const replay = submit({ clientRequestId: 'idem-a', body: { x: 1 } });
  eq(replay.kind, 'replay', '重放形态');
  eq(replay.commitSequence, first.commitSequence, '重放返回首次 c1');
  eq(replay.response, first.response, '重放响应逐字节等');
  return `c1=${first.commitSequence}、中间提交 c=${other.commitSequence}；重放 ⇒ c=${replay.commitSequence} 响应字节等`;
});

// ───────────────── IDEM-2：同键异体必须拒绝，且零任何记录 ─────────────────
check('IDEM-2', '同幂等键、不同请求体 ⇒ 拒绝（IDEMPOTENCY_KEY_REUSED）且零任何记录', () => {
  const before = { rows: commitRows().length, ledger: ledgerRange().n, receipts: w.raw.get('select count(*) c from idempotency_receipt').c };
  const code = refusal(() => submit({ clientRequestId: 'idem-a', body: { x: 999 } }));
  const after = { rows: commitRows().length, ledger: ledgerRange().n, receipts: w.raw.get('select count(*) c from idempotency_receipt').c };
  eq(code, 'IDEMPOTENCY_KEY_REUSED', '异体拒绝码');
  eq(after, before, '异体拒绝后提交账/账本/回执');
  const kept = receipt(ADMIN.actorId, 'test.create', 'idem-a');
  if (!kept) throw new Error('既有回执被破坏');
  return `${code}；零新提交/零新事件/回执仍在（c=${kept.commit_sequence}）`;
});

// ───────────────── IDEM-3：权限撤销后的重放披露判定 ─────────────────
check('IDEM-3', '首次提交后撤销访问权 ⇒ 零新领域效果；披露按当前授权判定（两级守卫）', () => {
  const canRead = (actor) => w.grantsFor(actor).has('space-read');
  const before = { ledger: ledgerRange().n, rows: commitRows().length, objs: w.raw.get('select count(*) c from object_directory').c };

  // ① 连写权都被撤：更早的 UoW 守卫先拒（NO_SPACE_WRITE），根本到不了重放支
  w.revoke(ADMIN.actorId, 'space-write');
  const gate = refusal(() => submit({ clientRequestId: 'idem-a', body: { x: 1 }, replayAuthCheck: canRead }));
  w.grant(ADMIN.actorId, 'space-write');
  eq(gate, 'NO_SPACE_WRITE', '撤写权后的守卫码');

  // ② 写权在、读权撤：允许进入事务，但披露被当前授权拒（REPLAY_ACCESS_DENIED）
  if (!canRead(ADMIN.actorId)) throw new Error('前置：调用者应有读权');
  w.revoke(ADMIN.actorId, 'space-read');
  const code = refusal(() => submit({ clientRequestId: 'idem-a', body: { x: 1 }, replayAuthCheck: canRead }));
  const after = { ledger: ledgerRange().n, rows: commitRows().length, objs: w.raw.get('select count(*) c from object_directory').c };
  eq(code, 'REPLAY_ACCESS_DENIED', '撤读权后重放拒绝码');
  eq(after, before, '撤权后零新领域效果');

  // ③ 恢复读权：重放照旧返回首次结果（不重执行领域前置）
  w.grant(ADMIN.actorId, 'space-read');
  const ok = submit({ clientRequestId: 'idem-a', body: { x: 1 }, replayAuthCheck: canRead });
  eq(ok.kind, 'replay', '恢复授权后重放形态');
  return `撤写权 ⇒ ${gate}（UoW 守卫更早）；仅撤读权 ⇒ ${code}（零新事件/提交/对象）；恢复 ⇒ 重放 c=${ok.commitSequence}`;
});

// ─────────────────────────── 汇总 ───────────────────────────
log('\n════════ 汇总 ════════');
for (const r of results) log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.id}${r.ok ? '' : `  ${r.detail}`}`);
const all = results.length > 0 && results.every((r) => r.ok);
log(all
  ? '\n判定：PASS_TX_ORDER —— 修订后的唯一事务顺序在真实 SQLite 上可实现，且旧顺序被反例否证。'
  : `\n判定：FAIL —— ${failures.join(' | ')}`);

try { w.close(); } catch {}
rmSync(dir, { recursive: true, force: true });
process.exit(all ? 0 : 1);
