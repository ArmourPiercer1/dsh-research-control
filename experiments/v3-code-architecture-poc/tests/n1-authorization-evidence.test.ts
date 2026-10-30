/**
 * N1 + D-25 单层直测（包 3，D-20 第三层「投影信任模型」的机制收口；CONTRACTS.md §16.2 包 3 条目）。
 *
 * 判定口径与分层防御纪律（父会话定过的规矩）：**每一层单独可打红**。
 * 本文件刻意绕开 `FactDesignationPolicy`/命令 Port 的领域判据层，直调机制唯一入口
 * `NamespaceWriter.appendAuthoritativeEvent`（席位 G2-A C4 的利用形态）——
 * 这样机制侧取证（判据 ③）一旦被摘掉，红点就落在机制层，不会被领域层的绿掩盖。
 *
 * 变异验证（实际跑过，输出记录在回报）：
 *   M1 摘掉 `principalCan` 取证（写死 authorized:true）⇒ 「未授权直调⇒见证 false 且不计」红；
 *   M2 摘掉 ledger 见证列写入（恒 NULL）⇒ 同条红（v3 判据要求见证存在）；
 *   M3 摘掉投影的见证优先闸 ⇒ 「自称 v2 绕见证」红。
 *
 * 三条被钉历史行为（RE-REVIEW-G2-A 组合 C 组）在末段回归钉里逐条复验：
 * issuer≠actor 仍拒；未知 policyVersion 仍 fail-closed；撤销后历史按当时版本生效、新写不计入。
 * 「无见证 + v2 外形」的历史行仍按冻结的 v2 判据计入——那是「只读历史语义」的另一半，同样钉死。
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../src/harness/paths.ts';
import { openWorld, PRINCIPAL, type World } from '../src/harness/world.ts';
import { TEST_OBJECT_MODEL } from '../src/domains/test-object-model.ts';
import {
  CAP_RECORDS, TEST_RECORDS,
  FACT_DESIGNATION_EVENT, FACT_DESIGNATION_SCHEMA, FACT_STANDING_POLICY_VERSION,
} from '../src/domains/test-records.ts';
import type { PluginManifest } from '../src/contracts/index.ts';
import { asOid } from '../src/contracts/index.ts';

const ADM = PRINCIPAL('n1adm');       // space-write + capability-admin + domain-admission
const NOBODY = PRINCIPAL('n1nobody'); // 只有 space-write（g1a/g2a 夹具同形的攻击主体）
const BOB = PRINCIPAL('n1bob');       // space-write + domain-admission
const GRANTS = {
  n1adm: ['space-write', 'capability-admin', 'domain-admission'],
  n1nobody: ['space-write'],
  n1bob: ['space-write', 'domain-admission'],
};

let dir: string;
beforeAll(() => { dir = mkdtempSync(join(POC_DATA_DIR, 'n1-authz-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

const open = (name: string): World =>
  openWorld({ file: join(dir, `${name}.db`), space: 'SP-N1', grants: GRANTS,
    plugins: [TEST_OBJECT_MODEL, TEST_RECORDS] });

const code = (fn: () => unknown): string => {
  try { fn(); return 'NO_REFUSAL'; }
  catch (e) {
    const c = (e as { code?: unknown })?.code;
    return typeof c === 'string' ? c : `OTHER:${String(e)}`;
  }
};

/** 席位 C4 形态：绕开领域 policy，装配位置直调机制唯一入口，载荷自称一应俱全。 */
const directIssue = (w: World, actor: typeof NOBODY, payload: Record<string, unknown>): void => {
  w.uow(actor, (tx) => w.kernel.faceFor(CAP_RECORDS).writerFor(tx).appendAuthoritativeEvent({
    eventType: FACT_DESIGNATION_EVENT, objectId: asOid('OBJ-SP-N1-1'), revision: 1, payload,
  }));
};
const v3Shaped = (issuer: string, policyVersion = FACT_STANDING_POLICY_VERSION): Record<string, unknown> => ({
  designationSchema: FACT_DESIGNATION_SCHEMA, stance: 'ACCEPTED',
  issuer, authorization: 'AUTHORIZED', policyVersion,
});
const witness = (w: World): { authorized: 'true' | 'false' | null; axis: string | null }[] =>
  w.raw.all<{ authorized: number | null; axis: string | null }>(
    `select json_extract(authority_basis,'$.authorized') authorized,
            json_extract(authority_basis,'$.axis') axis
       from ledger where event_type=? order by seq`, FACT_DESIGNATION_EVENT)
    // SQLite 的 json_extract 把 JSON 布尔落成 1/0（没有布尔存储类）——归一化回文本形状，
    // null（无见证）原样保留：三种取值（true/false/无见证）正是投影判据的三个分支。
    .map((r) => ({ authorized: r.authorized === 1 ? 'true' : r.authorized === 0 ? 'false' : null, axis: r.axis }));
const standing = (w: World, oid: string = 'OBJ-SP-N1-1') =>
  w.standingUseCase().standingAt(asOid(oid), w.ledgerHead()).state;

describe('N1 单层直测：授权结论只来自机制取证（直调机制唯一入口，不经领域 policy）', () => {
  test('未授权主体直调 ⇒ 行仍落库（PR-A1）但见证 authorized:false ⇒ 投影 NOT_ADOPTED【M1/M2 变异打红点】', () => {
    const w = open('n1-direct-unauth');
    try {
      const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { core: true } }));
      w.uow(NOBODY, (tx) => w.kernel.faceFor(CAP_RECORDS).writerFor(tx).appendAuthoritativeEvent({
        eventType: FACT_DESIGNATION_EVENT, objectId: oid, revision: 1, payload: v3Shaped('n1nobody'),
      }));
      // 行落库（未授权声明完整保存），但**授权证据**是机制侧的 false——载荷自称的 AUTHORIZED 不算。
      const rows = witness(w);
      expect(rows.map((r) => r.authorized)).toEqual(['false']);   // M2：见证列不写 ⇒ 这里就是 [null] ⇒ 红
      expect(rows[0].axis).toBe('domain-admission');              // 轴名来自清单登记，不是入参
      expect(standing(w, oid)).toBe('NOT_ADOPTED');               // M1：取证写死 true ⇒ 这里翻 ADOPTED ⇒ 红
      // 意图字段仍写着攻击者的自称 `AUTHORIZED`——机制**不改写**载荷（那是审计证据：谁说了什么），
      // 但投影不采信它。走正当命令 Port 时这个字段才会由领域判成 UNVERIFIED；这里的对比形状
      // 恰好演示了包 3 的分工：载荷=意图（可谎），见证=证据（机制写）。
      expect(w.raw.get<{ a: string }>(
        `select json_extract(payload_json,'$.authorization') a from ledger where event_type=?`,
        FACT_DESIGNATION_EVENT)!.a).toBe('AUTHORIZED');
    } finally { w.close(); }
  });

  test('已授权主体直调 ⇒ 见证 authorized:true ⇒ 计入（正例护栏：修法不是一刀切）', () => {
    const w = open('n1-direct-auth');
    try {
      const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { core: true } }));
      directIssue(w, ADM, v3Shaped('n1adm'));
      expect(witness(w).map((r) => r.authorized)).toEqual(['true']);
      expect(standing(w, oid)).toBe('ADOPTED');
    } finally { w.close(); }
  });

  test('未授权主体自称 policyVersion:fact-standing/v2 走旧判据 ⇒ 见证优先闸挡住，NOT_ADOPTED【M3 变异打红点】', () => {
    // 父代理点名要钉的逃逸道：今天的新写入挑旧版本号绕"载荷自称"。权威通道的每一行必带见证，
    // 见证优先闸在任何版本查表之前生效 ⇒ v2 自称道对带见证行不可达。
    const w = open('n1-v2-escape');
    try {
      const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { core: true } }));
      w.uow(NOBODY, (tx) => w.kernel.faceFor(CAP_RECORDS).writerFor(tx).appendAuthoritativeEvent({
        eventType: FACT_DESIGNATION_EVENT, objectId: oid, revision: 1,
        payload: v3Shaped('n1nobody', 'fact-standing/v2'),
      }));
      expect(witness(w).map((r) => r.authorized)).toEqual(['false']); // 见证照样落（行是新写入）
      expect(standing(w, oid)).toBe('NOT_ADOPTED');                   // M3：摘闸 ⇒ v2 判据认自称 ⇒ 红
    } finally { w.close(); }
  });

  test('v2 是只读历史语义：无见证 + v2 外形的历史行仍按冻结判据计入（历史不被新规则重解释）', () => {
    const w = open('n1-v2-legacy');
    try {
      const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { core: true } }));
      // 模拟包 3 生效前写入的既有行（装配裸面 = 历史行唯一来源；插件没有任何写 ledger 的旁路）。
      w.raw.run(
        `insert into ledger(seq, space, event_type, actor, authority_basis, object_id, revision, payload_json, recorded_at)
         values(900,'SP-N1',?, 'n1adm', null, ?, 1, ?, 1)`,
        FACT_DESIGNATION_EVENT, oid, JSON.stringify(v3Shaped('n1adm', 'fact-standing/v2')));
      w.raw.run(`update meta set value=? where key='ledger_seq'`, 900);
      expect(standing(w, oid)).toBe('ADOPTED'); // 冻结的 v2 判据对无见证历史行原样生效——两个方向都不许偏
    } finally { w.close(); }
  });

  test('同一本 authority 账本：grant 动态生效于新写入的取证、不追溯改写既有见证（不建第二套权限账本）', () => {
    const w = open('n1-single-ledger');
    try {
      const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { core: true } }));
      directIssue(w, NOBODY, v3Shaped('n1nobody'));          // 未授权 ⇒ false
      w.grant('n1nobody', 'domain-admission');               // 用装配根的既有授权表（同一 closure）
      directIssue(w, NOBODY, v3Shaped('n1nobody'));          // 已授权 ⇒ true
      expect(witness(w).map((r) => r.authorized)).toEqual(['false', 'true']);
      // 事后授权不得重解释历史：两条见证各按写入当时——第 2 行生效不改变第 1 行的证据。
      expect(standing(w, oid)).toBe('ADOPTED');
    } finally { w.close(); }
  });

  test('取证先于对象解析：未授权主体探他人幽灵 oid 的签发在取证处就得结论，对象面零信息差', () => {
    const w = open('n1-order');
    try {
      // ghost 与真实 oid 走未授权主体直调 ⇒ 两者都落库（见证 false），错误面不因授权而异
      const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { core: true } }));
      expect(code(() => directIssue(w, NOBODY, v3Shaped('n1nobody')))).toBe('NO_REFUSAL');
      expect(code(() => {
        w.uow(NOBODY, (tx) => w.kernel.faceFor(CAP_RECORDS).writerFor(tx).appendAuthoritativeEvent({
          eventType: FACT_DESIGNATION_EVENT, objectId: asOid('OBJ-GHOST-N1'), revision: 1,
          payload: v3Shaped('n1nobody'),
        }));
      })).toBe('NOT_FOUND_IN_SPACE');
      expect(w.raw.get<{ c: number }>(`select count(*) c from ledger where event_type=?`,
        FACT_DESIGNATION_EVENT)!.c).toBe(1); // 幽灵目标零残留；真实目标那一行见证 false
      expect(standing(w, oid)).toBe('NOT_ADOPTED');
    } finally { w.close(); }
  });

  test('见证列内容被裸面改成坏形状 ⇒ fail-closed 向「不计入」坍缩，绝不退化成无见证历史行', () => {
    const w = open('n1-malformed');
    try {
      const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { core: true } }));
      directIssue(w, ADM, v3Shaped('n1adm'));
      expect(standing(w, oid)).toBe('ADOPTED');
      // 装配裸面把见证改成坏 JSON（模拟存量损坏/攻击存量；插件可达面没有任何写列通道）。
      // 注：ledger 行被触发器钉成不可改，这里插入一条新的坏形状行代替"改写"。
      const seq = w.raw.get<{ m: number }>(`select coalesce(max(seq),0)+1 m from ledger`)!.m;
      w.raw.run(
        `insert into ledger(seq, space, event_type, actor, authority_basis, object_id, revision, payload_json, recorded_at)
         values(?, 'SP-N1', ?, 'n1adm', '{oops', ?, 2, ?, 2)`,
        seq, FACT_DESIGNATION_EVENT, oid, JSON.stringify({ ...v3Shaped('n1adm'), stance: 'WITHDRAWN' }));
      w.raw.run(`update meta set value=? where key='ledger_seq'`, seq);
      // 坏见证 = 未授权见证（不是 null！）⇒ WITHDRAWN 不计入 ⇒ 状态仍是上一行留下的 ADOPTED。
      expect(standing(w, oid)).toBe('ADOPTED');
    } finally { w.close(); }
  });
});

describe('N1 注册期 fail-closed 与判据顺序（缺轴 ⇒ 装配不成立；顺序保住席位 C2 语义）', () => {
  const evilManifest = (eventType: string, capability: string): PluginManifest => ({
    pluginId: `n1.evil.${capability}`, codeVersion: '0', provides: [{ capability, contractVersion: 'v1' }],
    requires: [], storageNamespace: `dom_n1_${capability}`, eventAuthority: 'none',
    // 未登记授权轴（cast 模拟运行时 JS 攻击者/漏声明插件——类型面禁了也要有运行时兜底）
    ownsEventTypes: [{ eventType, capability } as unknown as
      { eventType: string; capability: string; requiresAuthority: string }],
  });

  test('正式事件缺 requiresAuthority ⇒ ACTIVATION_IMPOSSIBLE（先 AMBIGUOUS→再 INACTIVE→再缺轴的顺序不混）', () => {
    // 缺轴 + 事件类型重复：先报 AMBIGUOUS（归属歧义是更靠前的装配事实）
    expect(code(() => openWorld({ file: join(dir, 'n1-reg-dup.db'), space: 'SP-R1', grants: GRANTS,
      plugins: [TEST_OBJECT_MODEL, TEST_RECORDS, evilManifest(FACT_DESIGNATION_EVENT, 'cap.n1.dup')] })))
      .toBe('AMBIGUOUS_AUTHORITY');
    // 缺轴 + 归属指向**没有任何插件提供**的能力：先报 CAPABILITY_INACTIVE（席位 g2a-c2 语义保持——
    // 注意归属指向必须由**另一个**插件提供才轮得到激活判据，自供自登记时能力就在账上、判据不响）
    const orphanHost: PluginManifest = {
      pluginId: 'n1.ghost', codeVersion: '0', provides: [{ capability: 'cap.n1.ghost', contractVersion: 'v1' }],
      requires: [], storageNamespace: 'dom_n1_ghost', eventAuthority: 'none',
      ownsEventTypes: [{ eventType: 'synth:n1-orphan', capability: 'cap.n1.nobody-provides-me' } as unknown as
        { eventType: string; capability: string; requiresAuthority: string }],
    };
    expect(code(() => openWorld({ file: join(dir, 'n1-reg-orphan.db'), space: 'SP-R2', grants: GRANTS,
      plugins: [TEST_OBJECT_MODEL, orphanHost] })))
      .toBe('CAPABILITY_INACTIVE');
    // 只缺轴 ⇒ ACTIVATION_IMPOSSIBLE：正式事件没有授权轴 = 永远产生不了授权证据，装配不成立
    expect(code(() => openWorld({ file: join(dir, 'n1-reg-noaxis.db'), space: 'SP-R3', grants: GRANTS,
      plugins: [TEST_OBJECT_MODEL, evilManifest('synth:n1-noaxis', 'cap.n1.ok')] })))
      .toBe('ACTIVATION_IMPOSSIBLE');
    // 正例护栏：登记了轴的插件照常装得起来
    const okManifest: PluginManifest = {
      pluginId: 'n1.ok', codeVersion: '0', provides: [{ capability: 'cap.n1.ok2', contractVersion: 'v1' }],
      requires: [], storageNamespace: 'dom_n1_ok2', eventAuthority: 'none',
      ownsEventTypes: [{ eventType: 'synth:n1-ok', capability: 'cap.n1.ok2', requiresAuthority: 'n1-axis' }],
    };
    const w = openWorld({ file: join(dir, 'n1-reg-ok.db'), space: 'SP-R4', grants: GRANTS,
      plugins: [TEST_OBJECT_MODEL, okManifest] });
    expect(code(() => w.kernel.faceFor('cap.n1.ok2' as never))).toBe('NO_REFUSAL');
    w.close();
  });
});

describe('D-25 直测面：停用拥有者 ⇒ 权威通道与通用通道同判写不动', () => {
  test('unloadCapability 后 appendAuthoritativeEvent ⇒ CAPABILITY_INACTIVE、零残留；再启用恢复', () => {
    const w = open('n1-d25');
    try {
      const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { core: true } }));
      w.unloadCapability(CAP_RECORDS, ADM); // capability-admin 轴停用（运维止血）
      const ledgerBefore = w.raw.get<{ c: number }>(`select count(*) c from ledger`)!.c;
      // 通道 B（本次修复的洞）：权威入口
      expect(code(() => w.uow(ADM, (tx) => w.kernel.faceFor(CAP_RECORDS).writerFor(tx)
        .appendAuthoritativeEvent({ eventType: FACT_DESIGNATION_EVENT, objectId: oid, revision: 1,
          payload: v3Shaped('n1adm') }))))
        .toBe('CAPABILITY_INACTIVE');
      // 通道 A（包 2 已拦）：通用入口仍按通道判据拒
      expect(code(() => w.uow(ADM, (tx) => tx.appendLedger({ eventType: FACT_DESIGNATION_EVENT, payload: {} }))))
        .toBe('EVENT_AUTHORITY_REQUIRED');
      // 对照：同能力常规写面同码（证明停用不是空转，也证明两通道现在同判）
      expect(code(() => w.uow(ADM, (tx) => w.kernel.faceFor(CAP_RECORDS).writerFor(tx)
        .write({ ns: 'dom_test_records', oid, revision: 1, payload: {}, eventType: 'x-registered' }))))
        .toBe('CAPABILITY_INACTIVE');
      expect(w.raw.get<{ c: number }>(`select count(*) c from ledger`)!.c).toBe(ledgerBefore); // 零残留
      // 恢复：再启用后正当入口照常可签发（不是修成永久砖）
      w.loadCapability(CAP_RECORDS, ADM);
      expect(w.uow(ADM, (tx) => w.standingUseCase().declare(tx, { oid, revision: 1, stance: 'ACCEPTED' })))
        .toBeGreaterThan(0);
      expect(standing(w, oid)).toBe('ADOPTED');
    } finally { w.close(); }
  });
});

describe('组合回归（RE-REVIEW-G2-A 组合 C 组钉过的三条 + 撤销双钉，不得被本次修复削弱）', () => {
  test('issuer≠actor 冒充仍不进投影（C3 形态，走机制直调）', () => {
    const w = open('n1-c3');
    try {
      const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { core: true } }));
      directIssue(w, NOBODY, v3Shaped('n1adm')); // issuer 自称 adm；机制 actor=nobody
      expect(standing(w, oid)).toBe('NOT_ADOPTED');
    } finally { w.close(); }
  });

  test('未知 policyVersion 仍 fail-closed（经正当命令 Port，载荷里的版本由领域盖）', () => {
    const w = open('n1-c-ver');
    try {
      const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { core: true } }));
      w.raw.run(
        `insert into ledger(seq, space, event_type, actor, authority_basis, object_id, revision, payload_json, recorded_at)
         values(901,'SP-N1',?, 'n1adm', ?, ?, 1, ?, 1)`,
        FACT_DESIGNATION_EVENT, JSON.stringify({ axis: 'domain-admission', capability: CAP_RECORDS, authorized: true }),
        oid, JSON.stringify(v3Shaped('n1adm', 'fact-standing/v99')));
      w.raw.run(`update meta set value=? where key='ledger_seq'`, 901);
      expect(standing(w, oid)).toBe('NOT_ADOPTED'); // 带真见证也不认未知版本：冻结表没这一行
    } finally { w.close(); }
  });

  test('撤销 × 历史双钉：旧声明按当时版本+见证继续生效；撤销后的新声明落 UNVERIFIED/见证 false 不计入', () => {
    const w = open('n1-c6');
    try {
      const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { core: true } }));
      const uc = w.standingUseCase();
      w.uow(BOB, (tx) => { uc.declare(tx, { oid, revision: 1, stance: 'ACCEPTED' }); });
      expect(uc.standingAt(oid, w.ledgerHead()).state).toBe('ADOPTED');
      w.revoke('n1bob', 'domain-admission');
      // 方向①：已落库事件不被当前权限重解释（见证按写入当时，v3 判据不查当前权限）
      expect(uc.standingAt(oid, w.ledgerHead()).state).toBe('ADOPTED');
      // 方向②：撤销后的新写入——仍完整保存（PR-A1），但意图 UNVERIFIED + 见证 false ⇒ 不计
      w.uow(BOB, (tx) => { uc.declare(tx, { oid, revision: 1, stance: 'WITHDRAWN' }); });
      expect(uc.standingAt(oid, w.ledgerHead()).state).toBe('ADOPTED');
      expect(w.raw.all<{ a: string }>(
        `select json_extract(payload_json,'$.authorization') a from ledger where event_type=? order by seq`,
        FACT_DESIGNATION_EVENT).map((r) => r.a)).toEqual(['AUTHORIZED', 'AUTHORITY_UNVERIFIED']);
      expect(witness(w).map((r) => r.authorized)).toEqual(['true', 'false']);
    } finally { w.close(); }
  });
});
