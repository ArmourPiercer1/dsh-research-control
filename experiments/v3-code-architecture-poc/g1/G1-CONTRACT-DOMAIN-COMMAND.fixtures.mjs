#!/usr/bin/env node
/**
 * G1-CONTRACT-DOMAIN-COMMAND 夹具（零依赖，`node` 直跑；退出码即结论）
 *
 *   node experiments/v3-code-architecture-poc/g1/G1-CONTRACT-DOMAIN-COMMAND.fixtures.mjs
 *   退出码 0 = 全部判据通过；1 = 有 FAIL；2 = 夹具无法运行（读不到正文/机器块缺失）。
 *
 * 本夹具**不是** `src/**` 的复述，而是 `G1-CONTRACT-DOMAIN-COMMAND.md` 的形状化模型
 * （沿 EA/FM/RL/IDC 先例）。三件套：
 *   ① 正反例（模型形 kernel / domain / application 三层）；
 *   ② 五条「架空判据」变异 + 判别方向自验（真实判据必须拦住点名的负例，架空的必须放过）；
 *   ③ 正文 ↔ 夹具 ↔ **真读仓库现状与上层 blob** 的静态对账（D 组）。
 *
 * 刻意保留的对照物：`legacy` 形态（Application 经 `writerOwningKind` 直写）下 T-N1 的载荷
 * **会创建成功**。那不是失败，而是判别力证据——今天的机制确实拦不住（真库探针 exit 0 同向）。
 * 诚实边界（同正文 §11）：夹具证明**判据有判别力**，不证明落码正确，也不证明领域规则内容判得对。
 */
import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const POC = dirname(HERE);
const REPO = dirname(dirname(POC));
// 正文路径可覆盖，仅供**判据自验**：DC_DOC= 指向被改坏的副本，用来证明 D 组静态对账真会红（不是装饰）。
const doc = readFileSync(process.env.DC_DOC || join(HERE, 'G1-CONTRACT-DOMAIN-COMMAND.md'), 'utf8');   // 读不到 ⇒ 抛 ⇒ exit 2

let pass = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass += 1; console.log(`PASS  ${name}`); }
  else { failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}

const seenCodes = new Set();
class Refusal extends Error {
  constructor(code, detail) {
    super(code); this.name = 'Refusal'; this.code = code; this.detail = detail;
    if (typeof code === 'string' && code !== 'NO_REFUSAL') seenCodes.add(code);
  }
}
const codeOf = (fn) => { try { fn(); return 'NO_REFUSAL'; } catch (e) { return e instanceof Refusal ? e.code : `CRASH:${e && e.message}`; } };

// ───────────────────────────── 判据名单：从契约正文的机器块抽取（夹具不内联副本）

function block(tag) {
  const m = doc.match(new RegExp(`<!-- ${tag}-BEGIN -->([\\s\\S]*?)<!-- ${tag}-END -->`));
  if (!m) { console.error(`契约正文缺少机器块 ${tag}`); process.exit(2); }
  return m[1];
}
const APP_SURFACE = block('DC-APP-SURFACE').split(/\s+/).filter(Boolean);
const BANNED = block('DC-BANNED-WRITE-METHODS').split(/\s+/).filter(Boolean);
const PREORDER = block('DC-PREORDER').split('\n').map((l) => l.trim()).filter((l) => /^[①②③④⑤⑥⑦]/.test(l));
if (APP_SURFACE.length === 0 || BANNED.length === 0 || PREORDER.length === 0) {
  console.error('机器块解析为空'); process.exit(2);
}

// ───────────────────────────── 模型世界

const CAPS = {
  'cap.om': { ns: 'dom_test_om', active: true },
  'cap.rec': { ns: 'dom_test_rec', active: true },
  'cap.fgn': { ns: 'dom_foreign', active: true },           // 第三方：造 B1b 的越权
};
const KINDS = { 'test.claim': 'cap.om', 'test.subject': 'cap.om', 'test.record': 'cap.rec' };
const ENVELOPE_FIELDS = ['ctxId', 'actor', 'capability', 'axis', 'authorized', 'ruleSetVersion',
  'contractVersion', 'issuedAtMs', 'txSeq'];                 // EA-4.2 九字段（复用，不另造）

/** DC-4.1 装配期名册。 */
const ROSTER = [
  { command: 'test.object-model:createClaim', capability: 'cap.om', affectsKinds: ['test.claim'],
    requires: 'domain-admission', inputFields: ['command', 'recordId', 'text'], preconditionCount: 2 },
  { command: 'test.object-model:objectifyCarrier', capability: 'cap.om', affectsKinds: ['test.subject'],
    inputFields: ['command', 'recordId'], preconditionCount: 0, stateless: true,
    signoff: 'statelessKind 人工签字：合成承载体无领域前置（DC-12）' },
  { command: 'test.records:declareRawIntake', capability: 'cap.rec', affectsKinds: ['test.record'],
    inputFields: ['command', 'recordId', 'text', 'sourceRef', 'unparseable'], preconditionCount: 0,
    stateless: true, signoff: 'DC-11/B-1：收取闸门不得等于领域准入（Q37）' },
];
/** 拥有者自己的领域前置点（住在拥有者目录；对象模型的接纳规则）。 */
const OM_PRECONDITIONS = [
  { run(cmd) { if (cmd.command === 'test.object-model:createClaim' && String(cmd.text ?? '').includes('残缺')) {
      throw new Refusal('synth:not-admissible', { rule: 'claim-text-parseable' }); } } },
  { run(cmd) { if (cmd.command === 'test.object-model:createClaim' && !cmd.recordId) {
      throw new Refusal('synth:record-ref-required', { rule: 'claim-record-ref-required' }); } } },
];
const WITNESS_FIELDS = ['actor', 'authority_basis', 'authorized', 'witnessSeq', 'envelope'];
const IDENTITY_FIELDS = ['facetRecordId', 'oid'];
/** 词法网的已知盲区（正文 §5.1 S2 自曝边界；MUT-DC-3 用它做判别）。 */
const BYPASS_SRC = 'const name = "create" + "Owned"; owner[name]({ kind: "test.claim", payload: {} });';

/** DC-4.1 装配期判据序（返回码或 null）。 */
function assemble(roster) {
  const seen = new Set();
  for (const r of roster) {
    if (seen.has(r.command)) return 'AMBIGUOUS_AUTHORITY';
    seen.add(r.command);
    if (!CAPS[r.capability] || !CAPS[r.capability].active) return 'CAPABILITY_INACTIVE';
    if (r.affectsKinds.some((k) => KINDS[k] !== r.capability)) return 'ACTIVATION_IMPOSSIBLE';
    if (r.requires === 'space-write' || r.requires === 'capability-admin') return 'ACTIVATION_IMPOSSIBLE';
    if ((r.preconditionCount ?? 0) < 1 && !(r.stateless === true && String(r.signoff ?? '').length > 0)) {
      return 'ACTIVATION_IMPOSSIBLE';                       // DC-12：空壳入口 = 装配红
    }
  }
  return null;
}

/** 最小 kernel：只有机制事实（kind 归属账 / 归属核对 / 发号 / 台账）。载荷零判定。 */
function makeKernel(cfg = {}) {
  const db = { dir: [], state: [], ledger: [], edges: [] };
  let seq = 0, oidNo = 0, txOpened = 0;
  const probes = { domainPreOnRaw: 0, rawRefusals: 0 };
  const ownerOfKind = (k) => KINDS[k];

  function assertLive(tx) { if (!tx || tx.closed) throw new Refusal('TX_CLOSED', {}); }
  function writer(cap, tx) {
    if (!CAPS[cap] || !CAPS[cap].active) throw new Refusal('CAPABILITY_INACTIVE', { capability: cap });
    const guard = (what, kind) => {
      assertLive(tx);
      if (cfg.ownership !== 'off' && ownerOfKind(kind) !== cap) {
        throw new Refusal('CAPABILITY_SCOPE_ESCAPE', { action: what, scope: cap, owner: ownerOfKind(kind) });
      }
    };
    return {
      ns: CAPS[cap].ns,
      /** 命名空间越界（kernel.ts:601 同码）：想落到别人的 ns ⇒ 与写侧越界同名码。 */
      into(nsName) {
        if (nsName !== CAPS[cap].ns) throw new Refusal('NAMESPACE_ESCAPE', { ns: nsName, own: CAPS[cap].ns });
        return this;
      },
      /** 机制语义零判定：本方法**看不见**载荷的业务含义，因此结构上不可能执行拥有者的领域规则。 */
      createOwned({ kind, payload, oid }) {
        guard('createObject', kind);
        if (!ownerOfKind(kind)) throw new Refusal('CAPABILITY_INACTIVE', { kind });
        const id = oid ?? `OBJ-${String(++oidNo).padStart(4, '0')}`;
        if (db.dir.some((r) => r.oid === id)) throw new Refusal('ID_TAKEN', { oid: id });
        const s = ++seq;
        tx.ops.push(() => { db.dir.pop(); db.state.pop(); db.ledger.pop(); });
        db.dir.push({ oid: id, kind, ns: CAPS[cap].ns, revision: 1 });
        db.state.push({ oid: id, revision: 1, payload });
        db.ledger.push({ seq: s, eventType: 'object-registered', objectId: id, revision: 1, envelope: null });
        return id;
      },
      linkOwned({ from, to, role, required }) {
        assertLive(tx);
        tx.ops.push(() => { db.edges.pop(); });
        db.edges.push({ from: from.oid, to, role, required: required === true });
      },
      appendAuthoritativeEvent({ eventType, objectId, revision, payload, envelope }) {
        assertLive(tx);
        if (!db.dir.some((r) => r.oid === objectId)) throw new Refusal('NOT_FOUND_IN_SPACE', { objectId });
        const missing = ENVELOPE_FIELDS.filter((f) => envelope[f] === undefined);
        if (missing.length) throw new Refusal('EVENT_AUTHORITY_REQUIRED', { reason: 'envelope-incomplete', missing });
        const s = ++seq;
        tx.ops.push(() => { db.ledger.pop(); });
        db.ledger.push({ seq: s, eventType, objectId, revision, payload, envelope });
        return s;
      },
    };
  }
  /** 通用写面（D-19 的墙所在）：只有归属核对，没有领域前置——这正是洞的结构成因。 */
  function genericUow(principal, scopeCap) {
    const tx = { principal, ops: [], closed: false };
    txOpened += 1;
    return {
      tx,
      createObject({ kind, payload }) { return writer(scopeCap ?? 'assembly', tx).createOwned({ kind, payload }); },
      appendLedger({ eventType, objectId, revision, payload }) {
        assertLive(tx);
        if (/fact-designation|raw-intake/.test(eventType)) {
          throw new Refusal('EVENT_AUTHORITY_REQUIRED', { eventType, reason: 'formal-event-channel' });
        }
        const s = ++seq; tx.ops.push(() => { db.ledger.pop(); });
        db.ledger.push({ seq: s, eventType, objectId, revision, payload, envelope: null });
        return s;
      },
      close() { tx.closed = true; },
    };
  }
  function transact(principal, fn) {
    const tx = { principal, ops: [], closed: false }; txOpened += 1;
    try { const r = fn(tx); tx.closed = true; return r; }
    catch (e) { for (const undo of tx.ops.reverse()) undo(); tx.closed = true; throw e; }
  }
  const counts = () => ({ dir: db.dir.length, state: db.state.length, ledger: db.ledger.length, edges: db.edges.length });
  return { db, writer, genericUow, transact, counts, txCount: () => txOpened, probes };
}

const mechanismEnvelope = (tx, cap, reg, authorized) => ({
  ctxId: `CTX-${tx.principal.actorId}`, actor: tx.principal.actorId, capability: cap,
  axis: reg.requires ?? 'space-write', authorized, ruleSetVersion: 'v1', contractVersion: '1.0.0',
  issuedAtMs: 1700000000000, txSeq: 1,
});

/** 领域层：拥有者自己的命令入口（DC-4/DC-6 的 ①–⑦ 序）。 */
function makeDomainCommandPorts(k, cfg = {}) {
  const authorityLedger = cfg.authorityLedger ?? { 'u-ada@sp1': ['domain-admission'] };
  function entry(cmdName, cap, run) {
    const reg = ROSTER.find((r) => r.command === cmdName);
    return (tx, cmd) => {
      // ① 名册 + 入参形状封闭（DC-7：无字段可携带见证）
      if (!reg || reg.capability !== cap) throw new Refusal('ACTIVATION_IMPOSSIBLE', { command: cmdName });
      const own = Object.keys(cmd ?? {});
      const witness = own.filter((f) => WITNESS_FIELDS.includes(f));
      if (witness.length) throw new Refusal('EVENT_AUTHORITY_REQUIRED', { reason: 'input-carries-witness-field', fields: witness });
      if (own.some((f) => IDENTITY_FIELDS.includes(f))) throw new Refusal('CAPABILITY_SCOPE_ESCAPE', { reason: 'input-carries-id-field' });
      const unknown = own.filter((f) => !reg.inputFields.includes(f));
      if (unknown.length) throw new Refusal('SCHEMA_INCOMPATIBLE', { reason: 'input-field-not-in-roster', unknown });
      // ② 激活核对
      if (!CAPS[cap].active) throw new Refusal('CAPABILITY_INACTIVE', { capability: cap });
      // ③ 授权取证（先于对象解析；false 不拒写，只决定投影）
      let authorized = true;
      if (reg.requires) {
        const axes = authorityLedger[`${tx.principal.actorId}@${tx.principal.space}`];
        if (!axes) throw new Refusal('AUTHORITY_REQUIRED', { axis: reg.requires });
        authorized = axes.includes(reg.requires);
      }
      // ④ 拥有者领域前置点（本契约新增的、归属校验无法替代的那一点）
      const onRaw = cmdName === 'test.records:declareRawIntake';
      if (onRaw) {
        if (cfg.rawViaPreconditions === true) {                     // MUT-DC-4：把收取当准入
          k.probes.domainPreOnRaw += 1;
          if (cmd.unparseable === true) throw new Refusal('synth:not-admissible', { rule: 'misapplied-admission-gate' });
        }
      } else if (cfg.preconditions === 'folded-into-ownership') {   // MUT-DC-2：④ 并进 ⑤
        if (KINDS[reg.affectsKinds[0]] !== reg.capability) throw new Refusal('CAPABILITY_SCOPE_ESCAPE', {});
      } else if (cfg.preconditions !== 'bypassed') {                // MUT-DC-1：④ 整体旁路
        for (const p of OM_PRECONDITIONS) p.run(cmd);
      }
      // ⑤⑥⑦ 落笔（拥有者自己的窄面）
      return run(tx, cmd, reg, authorized);
    };
  }
  const objectModel = {
    createClaim: entry('test.object-model:createClaim', 'cap.om', (tx, cmd, reg, authorized) => {
      const w = k.writer('cap.om', tx);
      const oid = w.createOwned({ kind: 'test.claim', payload: { text: cmd.text, fromRecord: cmd.recordId } });
      w.linkOwned({ from: { oid }, to: cmd.recordId, role: 'derived-from', required: true });
      const witnessSeq = w.appendAuthoritativeEvent({
        eventType: 'synth:claim-registered', objectId: oid, revision: 1, payload: { recordId: cmd.recordId },
        envelope: mechanismEnvelope(tx, 'cap.om', reg, authorized) });
      return { oid, revision: 1, witnessSeq };
    }),
    objectifyCarrier: entry('test.object-model:objectifyCarrier', 'cap.om', (tx, cmd) => {
      const w = k.writer('cap.om', tx);
      const oid = w.createOwned({ kind: 'test.subject', payload: { fromRecord: cmd.recordId } });
      w.linkOwned({ from: { oid }, to: cmd.recordId, role: 'objectified-from', required: true });
      return { oid, revision: 1, witnessSeq: 0 };
    }),
  };
  if (cfg.genericDispatch === true) {          // MUT-DC-5：换成名字的通用写面
    objectModel.execute = (name, cmd) => (name === 'createClaim' ? objectModel.createClaim(cmd.tx, cmd) : objectModel.objectifyCarrier(cmd.tx, cmd));
  }
  const rawIntake = {
    declare: entry('test.records:declareRawIntake', 'cap.rec', (tx, cmd) => {
      try {
        const w = k.writer('cap.rec', tx);
        const oid = w.createOwned({ kind: 'test.record', payload: { text: cmd.text, sourceRef: cmd.sourceRef, unparseable: cmd.unparseable === true } });
        w.linkOwned({ from: { oid }, to: cmd.sourceRef, role: 'source-ref', required: true });
        return { oid, revision: 1, witnessSeq: 0 };
      } catch (e) { k.probes.rawRefusals += 1; throw e; }
    }),
  };
  return { objectModel, rawIntake };
}

// ───────────────────────────── 应用层：现状形态 vs 目标形态

/** 现状（P4/D-19c 的形态）：Application 经 `writerOwningKind` 取他人领域 `NamespaceWriter` 直写。 */
class IntakeUseCaseLegacy {
  constructor(delegation) { this.delegation = delegation; }      // N3 点名的运行时可达面
  intake(tx, a) { return tx.appendLedger({ eventType: 'synth:raw-intake', objectId: a.recordId, revision: 1, payload: { text: a.text } }); }
  tryAdmit(tx, a) {
    const owner = this.delegation.writerOwningKind('test.claim', tx);
    const oid = owner.createOwned({ kind: 'test.claim', payload: { text: a.text, fromRecord: a.recordId } });
    owner.linkOwned({ from: { oid }, to: a.recordId, role: 'derived-from', required: true });
    return { oid };
  }
}
/** 目标（DC-1/DC-2）：只持拥有者导出的具名命令 Port；物理写方法零可达。 */
class IntakeUseCaseTarget {
  #objectModel; #rawIntake;
  constructor(deps) { this.#objectModel = deps.objectModel; this.#rawIntake = deps.rawIntake; }
  intake(tx, a) { return this.#rawIntake.declare(tx, { command: 'test.records:declareRawIntake', recordId: a.recordId, text: a.text, sourceRef: a.sourceRef, unparseable: a.unparseable === true }); }
  tryAdmit(tx, a) {
    try { return { ok: this.admit(tx, a) }; }
    catch (e) { if (e instanceof Refusal && e.code.includes(':')) return { refused: e.code }; throw e; }
  }
  admit(tx, a) { return this.#objectModel.createClaim(tx, { command: 'test.object-model:createClaim', recordId: a.recordId, text: a.text }); }
  objectifyRecord(tx, a) { return this.#objectModel.objectifyCarrier(tx, { command: 'test.object-model:objectifyCarrier', recordId: a.recordId }); }
  intakeAndAdmit(tx, a) {
    const record = this.intake(tx, a);                                // Q37：先收（容错）
    const claim = this.tryAdmit(tx, { recordId: record.oid, text: a.text });   // 再对象化：领域拒 ⇒ 只拒不抛
    return { record, claim };
  }
}
class StandingUseCaseTarget {
  #commands;
  constructor(deps) { this.#commands = deps.objectModel; }
  declare(tx, a) { return this.#commands.objectifyCarrier(tx, { command: 'test.object-model:objectifyCarrier', recordId: a.recordId }); }
  standingAt() { return { state: 'NOT_ADOPTED' }; }
}

// ───────────────────────────── 结构判据：S1 运行时可达性（墙）/ S2 词法扫描（网）

function surfaceMembers(o) {
  const out = new Set();
  let cur = o;
  while (cur && cur !== Object.prototype) {
    for (const n of Object.getOwnPropertyNames(cur)) if (n !== 'constructor') out.add(n);
    cur = Object.getPrototypeOf(cur);
  }
  return out;
}
function reachableMembers(root, depth = 2) {
  const seen = new Set(); const objs = new Map([[root, depth]]);
  const visit = (o, d) => {
    for (const n of surfaceMembers(o)) {
      seen.add(n);
      let v; try { v = o[n]; } catch { continue; }
      if (v && typeof v === 'object' && !objs.has(v) && d > 0) { objs.set(v, d - 1); visit(v, d - 1); }
    }
  };
  visit(root, depth);
  return [...seen];
}
const scanBanned = (src) => BANNED.filter((n) => new RegExp(`\\b${n}\\b`).test(src));

const PRINCIPAL = { actorId: 'u-ada', space: 'sp1', verified: true };
const ENGINE_CFG = {
  target: {},
  legacy: {},
  'MUT-DC-1': { preconditions: 'bypassed' },
  'MUT-DC-2': { preconditions: 'folded-into-ownership' },
  'MUT-DC-3': { judge: 'lexical-only' },
  'MUT-DC-4': { rawViaPreconditions: true },
  'MUT-DC-5': { genericDispatch: true },
};
function buildWorld(engine) {
  const cfg = ENGINE_CFG[engine];
  if (!cfg) throw new Error(`未知 engine: ${engine}`);
  const k = makeKernel(cfg);
  const ports = makeDomainCommandPorts(k, cfg);
  return {
    k, ports, cfg, engine,
    app: engine === 'legacy'
      ? new IntakeUseCaseLegacy({ writerOwningKind: (kind, tx) => k.writer(KINDS[kind] ?? 'cap.fgn', tx), writerOf: (cap, tx) => k.writer(cap, tx) })
      : new IntakeUseCaseTarget(ports),
    standing: new StandingUseCaseTarget(ports),
  };
}

// ───────────────────────────── 正反例 runner（id 与正文 §5.3 表逐等）

const CASES = {
  // ---- 正例
  run_T_P1() {                                       // 合法命令经拥有者入口落笔 + 全形信封
    const k = makeKernel({}); const p = makeDomainCommandPorts(k, {});
    const r = k.transact(PRINCIPAL, (tx) => p.objectModel.createClaim(tx, { command: 'test.object-model:createClaim', recordId: 'R-1', text: '可解析的陈述' }));
    const row = k.db.ledger.find((x) => x.eventType === 'synth:claim-registered');
    const full = !!row && ENVELOPE_FIELDS.every((f) => row.envelope[f] !== undefined);
    const c = k.counts();
    return [!!r.oid && r.revision === 1 && r.witnessSeq > 0 && full && c.dir === 1 && c.state === 1 && c.ledger === 2,
      `receipt=${JSON.stringify(r)} counts=${JSON.stringify(c)} envelopeFull=${full}`];
  },
  run_T_P2() {                                       // Q40 正例：两个拥有者同一条事务、一次原子提交
    const k = makeKernel({}); const p = makeDomainCommandPorts(k, {});
    const out = k.transact(PRINCIPAL, (tx) => {
      const rec = p.rawIntake.declare(tx, { command: 'test.records:declareRawIntake', recordId: 'R-1', text: '残缺原文也要收', sourceRef: 'SRC-1', unparseable: true });
      const claim = p.objectModel.createClaim(tx, { command: 'test.object-model:createClaim', recordId: rec.oid, text: '可解析的陈述' });
      return { rec, claim };
    });
    return [k.txCount() === 1 && !!out.rec.oid && !!out.claim.oid, `txCount=${k.txCount()} out=${JSON.stringify(out)}`];
  },
  run_T_P3() {                                       // Q40：第二腿领域拒 ⇒ 两笔一起回滚
    const k = makeKernel({}); const p = makeDomainCommandPorts(k, {});
    const before = JSON.stringify(k.counts());
    const code = codeOf(() => k.transact(PRINCIPAL, (tx) => {
      p.rawIntake.declare(tx, { command: 'test.records:declareRawIntake', recordId: 'R-1', text: '原文', sourceRef: 'SRC-1' });
      p.objectModel.createClaim(tx, { command: 'test.object-model:createClaim', recordId: 'R-1', text: '残缺不堪的陈述' });
    }));
    return [code === 'synth:not-admissible' && JSON.stringify(k.counts()) === before,
      `code=${code} after=${JSON.stringify(k.counts())} before=${before}`];
  },
  run_T_P4() {                                       // S1 正例侧：目标形态零可达 + 成员名 ⊆ 名单
    const ports = makeDomainCommandPorts(makeKernel({}), {});
    const useCase = new IntakeUseCaseTarget(ports);
    const reach = reachableMembers(useCase);
    const hit = reach.filter((n) => BANNED.includes(n));
    const own = [...surfaceMembers(useCase)];
    const outside = own.filter((n) => !APP_SURFACE.includes(n));
    const standingOutside = [...surfaceMembers(new StandingUseCaseTarget(ports))].filter((n) => !APP_SURFACE.includes(n));
    return [hit.length === 0 && outside.length === 0 && standingOutside.length === 0,
      `bannedHit=[${hit}] outside=[${outside}] standingOutside=[${standingOutside}]`];
  },
  run_T_P5() {                                       // Q37：Raw 三形全收 + 不触领域前置
    const k = makeKernel({}); const p = makeDomainCommandPorts(k, {});
    const forms = [
      { recordId: 'R-1', text: '残缺不堪、无法解析的原文', sourceRef: 'SRC-1', unparseable: true },
      { recordId: 'R-2', text: '类型未注册的材料', sourceRef: 'SRC-2', unparseable: true },
      { recordId: 'R-3', text: '结构不合法{{{{', sourceRef: 'SRC-3', unparseable: true },
    ];
    const ids = forms.map((f) => k.transact(PRINCIPAL, (tx) => p.rawIntake.declare(tx, { command: 'test.records:declareRawIntake', ...f })).oid);
    const retained = forms.every((f, i) => JSON.stringify(k.db.state[i].payload).includes(f.text));
    return [ids.every(Boolean) && retained && k.probes.domainPreOnRaw === 0 && k.probes.rawRefusals === 0,
      `ids=[${ids}] preOnRaw=${k.probes.domainPreOnRaw} rawRefusals=${k.probes.rawRefusals} retained=${retained}`];
  },
  run_T_P6() {                                       // 有写权无业务轴 ⇒ 未生效声明，投影不计
    const k = makeKernel({}); const p = makeDomainCommandPorts(k, { authorityLedger: { 'u-x@sp1': [] } });
    const tx = { principal: { actorId: 'u-x', space: 'sp1', verified: true }, ops: [], closed: false };
    const r = p.objectModel.createClaim(tx, { command: 'test.object-model:createClaim', recordId: 'R-1', text: '可解析的陈述' });
    const row = k.db.ledger.find((x) => x.eventType === 'synth:claim-registered');
    return [!!r.oid && row.envelope.authorized === false, `receipt=${JSON.stringify(r)} authorized=${row && row.envelope.authorized}`];
  },
  // ---- 负例
  run_T_N1(w) {                                      // ★ 远程审查点名的必给负例
    const k = makeKernel(w.cfg);                     // 每例独占 kernel（跨例零污染，红/绿才可归因）
    const p = makeDomainCommandPorts(k, w.cfg);
    const app = new IntakeUseCaseTarget(p);
    const handle = k.genericUow(PRINCIPAL, 'assembly');
    const before = JSON.stringify(k.counts());
    const out = app.tryAdmit(handle.tx, { recordId: 'R-1', text: '残缺不堪的陈述', sourceRef: 'SRC-1' });
    return [out.refused === 'synth:not-admissible' && JSON.stringify(k.counts()) === before,
      `out=${JSON.stringify(out)} after=${JSON.stringify(k.counts())} before=${before}`];
  },
  run_T_N2(w) {                                      // 名册外命令 / 未激活能力 / 终结句柄
    const k = makeKernel(w.cfg);
    const p = makeDomainCommandPorts(k, w.cfg);
    const handle = k.genericUow(PRINCIPAL, 'assembly');
    const unknown = codeOf(() => {
      const reg = ROSTER.find((r) => r.command === 'test.object-model:sayAnything');
      if (!reg) throw new Refusal('ACTIVATION_IMPOSSIBLE', { command: 'unknown' });
      return p.objectModel.createClaim(handle.tx, { command: 'test.object-model:sayAnything', recordId: 'R', text: 'x' });
    });
    const saved = CAPS['cap.om'].active; CAPS['cap.om'].active = false;
    const inactive = codeOf(() => p.objectModel.createClaim(handle.tx, { command: 'test.object-model:createClaim', recordId: 'R-1', text: '可解析' }));
    CAPS['cap.om'].active = saved;
    handle.close();
    const late = codeOf(() => p.objectModel.createClaim(handle.tx, { command: 'test.object-model:createClaim', recordId: 'R-1', text: '可解析' }));
    return [unknown === 'ACTIVATION_IMPOSSIBLE' && inactive === 'CAPABILITY_INACTIVE'
      && late === 'TX_CLOSED' && k.counts().dir === 0,
      `unknown=${unknown} inactive=${inactive} late=${late} counts=${JSON.stringify(k.counts())}`];
  },
  run_T_N3(w) {                                      // B1b：载荷领域上可通过，但归属不符
    const k = makeKernel(w.cfg);
    const code = codeOf(() => { const h = k.genericUow(PRINCIPAL, 'assembly'); k.writer('cap.fgn', h.tx).createOwned({ kind: 'test.claim', payload: { text: '完全合法的载荷' } }); });
    // 同例第二条：权威事件指向不存在的对象 ⇒ NOT_FOUND_IN_SPACE（同形面，不区分成因）
    const k2 = makeKernel(w.cfg); const h2 = k2.genericUow(PRINCIPAL, 'assembly');
    const missing = codeOf(() => k2.writer('cap.om', h2.tx).appendAuthoritativeEvent({
      eventType: 'synth:claim-registered', objectId: 'OBJ-不存在', revision: 1, payload: {},
      envelope: mechanismEnvelope(h2.tx, 'cap.om', { requires: 'domain-admission' }, true) }));
    return [code === 'CAPABILITY_SCOPE_ESCAPE' && missing === 'NOT_FOUND_IN_SPACE' && k.counts().dir === 0,
      `scope=${code} missing=${missing} counts=${JSON.stringify(k.counts())}`];
  },
  run_T_N4() {                                       // 四禁：命令实现体取通用写面
    const BAD_IMPL = 'function createClaim(tx, cmd){ return tx.createObject({ kind: "test.claim", payload: cmd }); }';
    const netHit = scanBanned(BAD_IMPL);
    const k = makeKernel({});
    const code = codeOf(() => { const h = k.genericUow(PRINCIPAL, 'cap.fgn'); h.createObject({ kind: 'test.claim', payload: {} }); });
    // 第二条：换命名空间落的形态 ⇒ 与写侧越界同名码 NAMESPACE_ESCAPE（kernel.ts:601 同源）
    const nsCode = codeOf(() => { const h = k.genericUow(PRINCIPAL, 'cap.rec'); k.writer('cap.rec', h.tx).into('dom_test_om'); });
    return [netHit.length > 0 && code === 'CAPABILITY_SCOPE_ESCAPE' && nsCode === 'NAMESPACE_ESCAPE' && k.counts().dir === 0,
      `netHit=[${netHit}] scope=${code} ns=${nsCode}`];
  },
  run_T_N5(w) {                                      // 自带见证（值全对也拒）+ 名册外字段
    const k = makeKernel(w.cfg);
    const p = makeDomainCommandPorts(k, w.cfg);
    const h = k.genericUow(PRINCIPAL, 'assembly');
    const code = codeOf(() => p.objectModel.createClaim(h.tx, { command: 'test.object-model:createClaim', recordId: 'R-1', text: '可解析', authorized: true, authority_basis: 'B' }));
    const shape = codeOf(() => p.objectModel.createClaim(h.tx, { command: 'test.object-model:createClaim', recordId: 'R-1', text: '可解析', extraField: 1 }));
    // 第三条：领域前置点自己的码（缺 required 引用）⇒ 证明领域判定住在 DomainRefusalCode，不住机制码
    const domainCode = codeOf(() => p.objectModel.createClaim(h.tx, { command: 'test.object-model:createClaim', text: '可解析但缺引用' }));
    return [code === 'EVENT_AUTHORITY_REQUIRED' && shape === 'SCHEMA_INCOMPATIBLE'
      && domainCode === 'synth:record-ref-required' && k.counts().dir === 0,
      `witness=${code} shape=${shape} domain=${domainCode} counts=${JSON.stringify(k.counts())}`];
  },
  run_T_N6(w) {                                      // 具名性：通用分发口判红
    const GENERIC = ['run', 'execute', 'invoke', 'call', 'dispatch', 'apply', 'send'];
    const fakePort = { execute(name, payload) { return { name, payload }; } };
    const fakeHit = [...surfaceMembers(fakePort)].filter((n) => GENERIC.includes(n));
    const realHit = [...surfaceMembers(w.ports.objectModel)].filter((n) => GENERIC.includes(n));
    return [fakeHit.length > 0 && realHit.length === 0, `fakeHit=[${fakeHit}] realHit=[${realHit}]`];
  },
  run_T_N7(w) {                                      // Raw 通道出现任何拒收 = 契约违例
    const p = makeDomainCommandPorts(w.k, w.cfg);
    const forms = [{ recordId: 'R-1', text: '残缺原文', sourceRef: 'S', unparseable: true }, { recordId: 'R-2', text: '', sourceRef: 'S', unparseable: true }];
    const codes = forms.map((f) => codeOf(() => w.k.transact(PRINCIPAL, (tx) => p.rawIntake.declare(tx, { command: 'test.records:declareRawIntake', ...f }))));
    return [codes.every((c) => c === 'NO_REFUSAL') && w.k.probes.domainPreOnRaw === 0 && w.k.probes.rawRefusals === 0,
      `codes=[${codes}] preOnRaw=${w.k.probes.domainPreOnRaw}`];
  },
  run_T_N8() {                                       // 空壳命令入口 ⇒ 装配红；显式签字后绿
    const without = assemble([{ command: 'x.a:c', capability: 'cap.om', affectsKinds: ['test.claim'], inputFields: ['command'], preconditionCount: 0 }]);
    const withSignoff = assemble([{ command: 'x.a:c', capability: 'cap.om', affectsKinds: ['test.claim'], inputFields: ['command'], preconditionCount: 0, stateless: true, signoff: '人工签字' }]);
    const doubleClaim = assemble([{ command: 'x.a:c', capability: 'cap.om', affectsKinds: ['test.claim'], inputFields: ['command'], preconditionCount: 1 },
      { command: 'x.a:c', capability: 'cap.rec', affectsKinds: ['test.record'], inputFields: ['command'], preconditionCount: 1 }]);
    return [without === 'ACTIVATION_IMPOSSIBLE' && withSignoff === null && doubleClaim === 'AMBIGUOUS_AUTHORITY',
      `without=${without} withSignoff=${withSignoff} doubleClaim=${doubleClaim}`];
  },
  run_T_S1() {                                       // 结构负例：委派面被交进用例 ⇒ S1 判红
    const legacy = new IntakeUseCaseLegacy({ writerOwningKind: (kind) => ({ kind }), writerOf: () => ({}) });
    const hit = reachableMembers(legacy).filter((n) => BANNED.includes(n));
    return [hit.includes('writerOwningKind') && hit.includes('writerOf'), `hit=[${hit}]`];
  },
  run_T_S2() {                                       // 负空间：网扫不到的形态由墙拦（如实断言扫不到）
    const netMiss = scanBanned(BYPASS_SRC).length === 0;
    const k = makeKernel({});
    const h = k.genericUow(PRINCIPAL, 'assembly');
    const owner = k.writer('cap.fgn', h.tx);
    const runtime = codeOf(() => owner['create' + 'Owned']({ kind: 'test.claim', payload: { text: '合法载荷' } }));
    return [netMiss && runtime === 'CAPABILITY_SCOPE_ESCAPE' && k.counts().dir === 0, `netMiss=${netMiss} runtime=${runtime}`];
  },
};

/** 判别力对照：同一载荷在**现状形态**（今天的条文）下必须创建成功。 */
function legacyContrast() {
  const w = buildWorld('legacy');
  const h = w.k.genericUow(PRINCIPAL, 'assembly');
  const out = w.app.tryAdmit(h.tx, { recordId: 'R-1', text: '残缺不堪的陈述' });
  const landed = w.k.db.dir.some((r) => r.kind === 'test.claim')
    && JSON.stringify(w.k.db.state[0] && w.k.db.state[0].payload).includes('残缺');
  return [out.oid !== undefined && landed, `legacy out=${JSON.stringify(out)} dir=${JSON.stringify(w.k.db.dir)}`];
}

// ───────────────────────────── 套件与变异捕获

function suite(engine) {
  const w = buildWorld(engine);
  const out = [];
  for (const [id, fn] of Object.entries(CASES)) {
    let ok = false, detail = '';
    try { [ok, detail] = fn(w); } catch (e) { ok = false; detail = `THROW ${e && e.message}`; }
    out.push({ id, ok, detail });
  }
  if (w.cfg.judge === 'lexical-only') {
    // 架空判据：拿词法扫描当墙 ⇒ 对计算成员名形态判绿（放过洞）⇒ 本夹具必须判它红
    out.push({ id: 'JUDGE-lexical-only', ok: scanBanned(BYPASS_SRC).length > 0,
      detail: '词法网对 BYPASS 形态返回 ∅ ⇒ 判据失效' });
  }
  return out;
}

// 1) 真实判据套件（目标形态）全绿
for (const r of suite('target')) check(`套件(target) ${r.id}`, r.ok, r.detail);

// 2) 判别力对照（保留，不删）
{
  const [ok, detail] = legacyContrast();
  check('对照 run_T_N1_legacy（现状机制确实拦不住 ⇒ 该负例非平凡为真）', ok, detail);
}

// 3) 五条架空变异：每条必须让预期用例变红（= 判据失效被捕获）
const MUTATIONS = {
  'MUT-DC-1': { mustRed: ['run_T_N1'], why: '把 ④ 整体旁路 ⇒ 违规载荷被放行；若 T-N1 仍绿则判据是空转' },
  'MUT-DC-2': { mustRed: ['run_T_N1'], mustGreen: ['run_T_N3'], why: '④ 并进 ⑤ ⇒ 只剩不对称：N1 绿而 N3 仍红' },
  'MUT-DC-3': { mustRed: ['JUDGE-lexical-only'], why: '拿网当墙 ⇒ 词法判据放过计算成员名形态的可达写面' },
  'MUT-DC-4': { mustRed: ['run_T_N7'], why: '把收取当准入 ⇒ 未解析原始材料被拒收（Q37 误伤）' },
  'MUT-DC-5': { mustRed: ['run_T_N6'], why: '换成通用分发口 ⇒ 具名性判据失守（换个名字的通用写面）' },
};
for (const [mut, spec] of Object.entries(MUTATIONS)) {
  const rs = suite(mut);
  const red = rs.filter((r) => !r.ok).map((r) => r.id);
  const green = rs.filter((r) => r.ok).map((r) => r.id);
  check(`${mut} 被捕获（应转红：${spec.mustRed.join(', ')}）— ${spec.why}`,
    spec.mustRed.every((id) => red.includes(id)), `red=[${red}] green=[${green}]`);
  if (spec.mustGreen) {
    check(`${mut} 的不对称面仍被拦住（${spec.mustGreen.join(', ')} 保持绿）`,
      spec.mustGreen.every((id) => green.includes(id)), `green=[${green}]`);
  }
}

// ───────────────────────────── D 组：正文 ↔ 夹具 ↔ 仓库现状 静态对账

const D = [];

const CLAUSES = Array.from({ length: 13 }, (_, i) => `DC-${i + 1}`);
const missingClauses = CLAUSES.filter((c) => !doc.includes(`| ${c} |`));
D.push(['D1 条文 DC-1..DC-13 全部在册（表行存在）', missingClauses.length === 0, `缺=[${missingClauses}]`]);

// D2 拒绝码封闭集零扩张（真读 src/contracts/index.ts）
const contractsSrc = readFileSync(join(POC, 'src/contracts/index.ts'), 'utf8');
const refusalBlock = contractsSrc.match(/export type RefusalCode =([\s\S]*?);/);
if (!refusalBlock) { console.error('读不到 RefusalCode 封闭集'); process.exit(2); }
const CLOSED = new Set([...refusalBlock[1].matchAll(/'([A-Z][A-Z0-9_]+)'/g)].map((x) => x[1]));
// 非 RefusalCode 的合法大写标识（不得当成「新造拒绝码」）：RELOCATION_PRECONDITION = 他契约新增码；
// MECHANISM_RESOURCES = 名册字段取值域名；UNPARSEABLE/PARSEABLE = 记录域载荷字段取值（test-records.ts:110）。
const NON_CODES = new Set(['RELOCATION_PRECONDITION', 'MECHANISM_RESOURCES', 'UNPARSEABLE', 'PARSEABLE', 'DOMAIN', 'OWNER', 'PRECONDITIONS',
  'ROSTER', 'PARSE', 'ACTIVE', 'EVIDENCE', 'INCREMENTAL', 'LIVENESS', 'HANDLE', 'PHYSICAL', 'WRITE', 'EDGE', 'FULL']);
const CITED = [...new Set([...doc.matchAll(/`([A-Z][A-Z0-9_]{3,})`/g)].map((x) => x[1]))].filter((c) => !NON_CODES.has(c));
const NEW = CITED.filter((c) => !CLOSED.has(c));
D.push([`D2 拒绝码封闭集零扩张（封闭集 ${CLOSED.size} 枚；正文引用 ${CITED.length} 枚，真读源码核对）`,
  CLOSED.size >= 20 && CITED.length >= 8 && NEW.length === 0, `名单外=[${NEW}]`]);
D.push(['D2b 领域判定走既有强制前缀机制（DomainRefusalCode 在源码与正文都在册）',
  /export type DomainRefusalCode = `\$\{string\}:\$\{string\}`;/.test(contractsSrc) && doc.includes('DomainRefusalCode'), '']);

// D3 机器块自洽
const MUST_BAN = ['createObject', 'revise', 'linkRef', 'declareRecord', 'appendLedger', 'createOwned',
  'reviseOwned', 'linkOwned', 'writerFor', 'namespacedWriter', 'writerOwningKind', 'writerOf'];
D.push(['D3a BANNED ⊇ 既有 D-19c 名单 + 取得入口本身（只增不减）',
  MUST_BAN.every((n) => BANNED.includes(n)), `缺=[${MUST_BAN.filter((n) => !BANNED.includes(n))}]`]);
D.push(['D3b BANNED ∩ APP-SURFACE = ∅', BANNED.filter((n) => APP_SURFACE.includes(n)).length === 0,
  `交=[${BANNED.filter((n) => APP_SURFACE.includes(n))}]`]);
D.push(['D3c D4-c 单动作提交口 submitReport 不在 BANNED（防误伤既裁面）', !BANNED.includes('submitReport'), '']);
D.push(['D3d APP-SURFACE 含 Q37/Q40 用例动作且非空',
  APP_SURFACE.length >= 5 && ['intake', 'tryAdmit', 'intakeAndAdmit'].every((n) => APP_SURFACE.includes(n)), `APP=[${APP_SURFACE}]`]);

// D4 前置序
D.push(['D4a PREORDER 七步齐（①–⑦，不多不少）',
  PREORDER.length === 7 && ['①', '②', '③', '④', '⑤', '⑥', '⑦'].every((n) => PREORDER.some((l) => l.startsWith(n))),
  `计=${PREORDER.length}`]);
{
  const i4 = PREORDER.findIndex((l) => l.startsWith('④'));
  const i5 = PREORDER.findIndex((l) => l.startsWith('⑤'));
  D.push(['D4b ④ 领域前置点在 ⑤ 归属核对**之前**（顺序即判据；MUT-DC-2 钉它）',
    i4 >= 0 && i5 > i4 && /OWNER-DOMAIN/.test(PREORDER[i4]) && /CAPABILITY_SCOPE_ESCAPE/.test(PREORDER[i5]),
    `④=${PREORDER[i4]}|⑤=${PREORDER[i5]}`]);
}
{
  const orderCodes = [...new Set([...PREORDER.join('\n').matchAll(/\b([A-Z][A-Z0-9_]{3,})\b/g)].map((x) => x[1]))]
    .filter((c) => !NON_CODES.has(c));
  const bad = orderCodes.filter((c) => !CLOSED.has(c));
  D.push([`D4c DC-PREORDER 引用的机制码全部 ∈ 封闭集（${orderCodes.length} 枚）`, bad.length === 0 && orderCodes.length >= 8, `越界=[${bad}]`]);
}

// D5 正文 ↔ 夹具 双向一致
{
  const inDoc = [...new Set([...doc.matchAll(/\bT-[PSN]\d+\b/g)].map((x) => x[0]))];
  const inFixture = new Set(Object.keys(CASES).map((k) => k.replace(/^run_T_/, 'T-')));
  const docMissingRunner = inDoc.filter((id) => !inFixture.has(id));
  const fixtureExtra = [...inFixture].filter((id) => !inDoc.includes(id));
  D.push([`D5a 正反例表 ↔ 夹具 runner 双向一致（正文 ${inDoc.length} 条，零孤儿）`,
    inDoc.length >= 14 && docMissingRunner.length === 0 && fixtureExtra.length === 0,
    `正文缺 runner=[${docMissingRunner}] 夹具多出=[${fixtureExtra}]`]);
  const docMut = [...new Set([...doc.matchAll(/\bMUT-DC-\d+\b/g)].map((x) => x[0]))];
  const fixMut = Object.keys(MUTATIONS);
  D.push(['D5b 变异常驻双向一致 + 每条给出「为什么这样就能绕过」',
    docMut.length === fixMut.length && docMut.length === 5
    && fixMut.every((m) => doc.includes(m) && String(MUTATIONS[m].why).length > 15) && docMut.every((m) => MUTATIONS[m]),
    `正文=[${docMut}] 夹具=[${fixMut}]`]);
}

// D6 迁移责任 PR 登记
{
  const sec7 = doc.slice(doc.indexOf('## 7. 迁移影响与责任 PR 登记'), doc.indexOf('## 8. 冲突登记'));
  const rows = [...sec7.matchAll(/^\| (R-\d+) \| (.+?) \| (.+?) \| (.+?) \|/gm)].map((x) => ({ id: x[1], pr: x[4] }));
  D.push([`D6a §7 迁移登记 ${rows.length} 行且每行责任 PR 非空（只登记，本席不改他席文件）`,
    rows.length >= 8 && rows.every((r) => /PR|席/.test(r.pr)), `空责任=[${rows.filter((r) => !/PR|席/.test(r.pr)).map((r) => r.id)}]`]);
  D.push(['D6b 迁移顺序写死（拥有者侧前置点先于改道；禁止拆批假绿）',
    /R-5（拥有者侧前置点 \+ 名册）→ R-4/.test(doc) && /R-5 之前禁止 R-4/.test(doc), '']);
  D.push(['D6c 真属用户决策一节写「无」', /\n## 9\. 真·用户决策\n\n\*\*无\*\*/.test(doc), '']);
}

// D7 变更纪律
D.push(['D7 变更纪律：三个机器块任一变动 ⇒ 正文与夹具同批改；变窄视同冻结面变更',
  doc.includes('三个机器块') && doc.includes('视同冻结面变更') && doc.includes('夹具 exit 0 才算改完'), '']);

// D8 上层条文逐字（跨分支 blob 经 git show 对原文；不可达 ⇒ 如实跳过并声明）
{
  const BLOBS = [
    ['5ec38974fc', 'docs/architecture/V3_CODE_ARCHITECTURE_DRAFT.md', [
      '跨域 Use-case 及事务协调，非中心业务规则',
      'Application Use-case 通过注册的 Port 协调',
      '领域对象私有规则、任意跨空间事务或外部 Agent 执行副作用',
      '并通过拥有者的 Port 进行完整性检查',
      'Scheme 版本由所属领域 Capability 验证',
      '单空间同一时刻只有一个权威写入者',
      '机器校验只能检查声明是否具备合法结构']],
    ['0369c3196c', 'docs/architecture/H_S_R_DECISIONS_AND_GAPS_DRAFT.md', [
      '空间写权限与业务授权分离', 'S-L1 只查声明不判语义']],
  ];
  let n = 0; const bad = []; const skipped = [];
  for (const [sha, path, frags] of BLOBS) {
    let t = null;
    try { t = execFileSync('git', ['-C', REPO, 'show', `${sha}:${path}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
    catch { skipped.push(`${sha}:${path}`); continue; }
    for (const f of frags) {
      n += 1;
      if (!t.includes(f)) bad.push(`${path} ⊅「${f}」`);
      if (!doc.includes(f)) bad.push(`正文未逐字引「${f}」`);
    }
  }
  D.push([`D8 上层条文逐字一致（${n} 片段；git show 对 blob 核验）`, bad.length === 0 && n >= 7,
    bad.length ? bad.join(' | ') : (skipped.length ? `blob 不可达，如实跳过：${skipped}` : '')]);
}

// D9 现状锚（真读仓库源码：收紧对今天的代码判红 ⇒ 迁移登记不是虚构）
{
  const appSrc = readFileSync(join(POC, 'src/app/intake-use-case.ts'), 'utf8');
  const delSrc = readFileSync(join(POC, 'src/app/delegation.ts'), 'utf8');
  const omSrc = readFileSync(join(POC, 'src/domains/test-object-model.ts'), 'utf8');
  const hits = scanBanned(appSrc);
  D.push(['D9a 现状锚：S1 名单对今天的 `src/app/intake-use-case.ts` 判红（迁移登记必要）',
    hits.length > 0 && /writerOwningKind\(kind: ObjectKindLabel, tx: UnitOfWork\): NamespaceWriter/.test(delSrc), `hits=[${hits}]`]);
  D.push(['D9b 现状锚：拥有者侧今天零规则（只有 ownsKinds 清单）⇒ DC-12 迁移前置项必要',
    /ownsKinds/.test(omSrc) && !/refused|Policy|precondition/.test(omSrc), '']);
  D.push(['D9c 现状锚：运行时可达性对 legacy 委派形态判红（与真库探针同向）',
    (() => { const l = new IntakeUseCaseLegacy({ writerOwningKind: () => ({ createOwned() {} }), writerOf: () => ({}) });
      const hit = reachableMembers(l).filter((n) => BANNED.includes(n)); return hit.length >= 2; })(), '']);
}

// D10 冲突登记两侧原文真实（不抹平）
{
  const unified = readFileSync(join(HERE, 'G1-UNIFIED-CONTRACTS.md'), 'utf8');
  const adj = readFileSync(join(HERE, 'G1-ADJUDICATION-TABLE.md'), 'utf8');
  D.push(['D10a C-1 甲侧原文真实（P4/§1.1 确实写着经 writerOwningKind 完成跨归属写）', /writerOwningKind/.test(unified), '']);
  D.push(['D10b C-1 乙侧原文真实（X-5 确实裁「协调方不持有通用写面」）', /不持有通用写面/.test(adj), '']);
  D.push(['D10c 冲突登记不抹平：C-1..C-4 在册且给两侧原文位置',
    ['C-1', 'C-2', 'C-3', 'C-4'].every((c) => doc.includes(`| ${c} |`)) && /两侧原文并列/.test(doc), '']);
}

// D11 夹具实际观察到的每个拒绝码，正文必须提到（防夹具私造语义）
{
  const unmentioned = [...seenCodes].filter((c) => !doc.includes(c));
  D.push([`D11 套件观察到的拒绝码 ${seenCodes.size} 枚全部在正文出现`,
    seenCodes.size >= 8 && unmentioned.length === 0, `未提及=[${unmentioned}] 观察=[${[...seenCodes].sort()}]`]);
}

for (const [name, ok, detail] of D) check(name, ok, detail);


// ───────────────────────────── W 组：判据自验（把正文削弱后重跑本夹具，D 组必须红）
// 子进程模式（DC_SELFCHECK_CHILD=1）下跳过，避免递归。父进程只验「削弱即变红」，不重复计数业务判据。
if (!process.env.DC_SELFCHECK_CHILD) {
  const TMP = join(POC, '.scratch', 'g1-cmd', 'selfcheck');
  const insertAfter = (t, anchor, added) => {
    const i = t.indexOf(anchor);
    return i < 0 ? `${t}\n${added}` : `${t.slice(0, i + anchor.length)}\n${added}${t.slice(i + anchor.length)}`;
  };
  const WEAK = [
    { id: 'W1 把 ④/⑤ 顺序调换（领域前置点后置于归属核对）',
      apply: (t) => t.split('④ OWNER-DOMAIN PRECONDITIONS').join('⑤ OWNER-DOMAIN PRECONDITIONS')
        .split('⑤ ownership-scoped physical write').join('④ ownership-scoped physical write'), mustFailWith: 'D4b' },
    { id: 'W2 从禁用名单删掉两个「取得入口」',
      apply: (t) => t.split('writerOwningKind  writerOf  uow  uowFor').join('uow  uowFor'), mustFailWith: 'D3a' },
    { id: 'W3 偷偷新增一枚机制拒绝码',
      apply: (t) => insertAfter(t, '| `TX_CLOSED` | 机制 ⑦ | §16.1 D-23 |',
        '| `ZZ_FAKE_REFUSAL_CODE` | 领域 ④ | 新造一枚机制码 |'), mustFailWith: 'D2 ' },
    { id: 'W4 删掉点名的必给负例（T-N1）行',
      apply: (t) => t.split('| T-N1 | 负 |').join('| T-N9 | 负 |'), mustFailWith: 'D5a' },
    { id: 'W5 拆掉迁移顺序约束（允许先改道后补规则）',
      apply: (t) => t.split('R-5 之前禁止 R-4').join('随时可拆批'), mustFailWith: 'D6b' },
  ];
  let tmpReady = true;
  try { mkdirSync(TMP, { recursive: true }); } catch { tmpReady = false; }
  if (!tmpReady) {
    check('W0 自验可运行（`.scratch` 可写）', false, `无法建 ${TMP}：静态对账的判别力无法自验，视为 FAIL`);
  } else {
    const selfPath = fileURLToPath(import.meta.url);
    for (const w of WEAK) {
      const file = join(TMP, `weakened-${w.mustFailWith.trim().replace(/\W+/g, '')}.md`);
      writeFileSync(file, w.apply(doc), 'utf8');
      const r = spawnSync(process.execPath, [selfPath], {
        encoding: 'utf8', env: { ...process.env, DC_DOC: file, DC_SELFCHECK_CHILD: '1' },
      });
      const out = `${r.stdout || ''}${r.stderr || ''}`;
      const turnedRed = r.status === 1 && out.includes(`FAIL  ${w.mustFailWith}`);
      check(`${w.id} ⇒ 本夹具必须判红（应见 FAIL ${w.mustFailWith}）`, turnedRed,
        `exit=${r.status}，未出现预期 FAIL：${out.split('\n').filter((l) => l.startsWith('FAIL')).join(' / ').slice(0, 200)}`);
    }
    try { rmSync(TMP, { recursive: true, force: true }); } catch { /* 可弃目录，留手也无害 */ }
  }
}

console.log(`\n= 夹具小结 = 通过 ${pass} 项，失败 ${failures.length} 项；机器块：APP-SURFACE ${APP_SURFACE.length} 名 / BANNED ${BANNED.length} 名 / PREORDER ${PREORDER.length} 步；观察码 ${seenCodes.size} 枚 / 封闭集 ${CLOSED.size} 枚`);
if (failures.length) { console.log('失败项：\n' + failures.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
process.exit(0);
