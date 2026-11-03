/**
 * PR-2 生产测试：事件归属账全形（EA-3）+ 授权证据与全形闸（EA-4）。
 *
 * 覆盖卡内点名的判据：
 * - EA-3.1 五字段缺一即装配红；EA-3.2 五序判据（双认领 / 认领机制名 / 缺轴 / 轴∈机制集 / 未激活）；
 * - EA-4.2 九字段信封；EA-4.3 **入参字段集封闭**（`as unknown as` 面也拦）；
 * - EA-4.5 三分闸（domain / route-audit / mechanism-op）+ 半形必红 + 同源一致性；
 * - EA-4.6 三态复算（VERIFIED / INCONSISTENT / UNVERIFIABLE_LEGACY）。
 *
 * 判据文本：`experiments/v3-code-architecture-poc/g1/G1-CONTRACT-EVENT-AUTHORITY.md` §3/§4。
 * 本文件**不断言**双轴分离（归 PR-4/PR-5），也**不**断言投影响应面（归 PR-3）。
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AXIS_DOMAIN, CAP_BOOTSTRAP, cleanup, DOMAIN_EVENT, openBootstrapWorld, PRINCIPAL, RETIRED_EVENT, tempDir,
  type BootstrapWorld,
} from './helpers/kernel-harness';
import { Refusal } from '../src/contracts';
import {
  findNonOracleViolations, gateFullShape, parseAuthorizationContext, replayAuthorityEvidence,
  type GateSources, type WitnessRow,
} from '../src/kernel/authority-gate';
import type { EventOwnershipEntry } from '../src/contracts';
import { MECHANISM_AUDIT_EVENT_TYPES, MECHANISM_EVENT_AXIS } from '../src/kernel/kernel';
import { createHash } from 'node:crypto';

const WRITER = PRINCIPAL('alice');   // space-write + 业务轴
const PLAIN = PRINCIPAL('bob');      // 只有 space-write
const MECHANISM_NAMES = ['object-registered', 'object-revised', 'record-backfilled', 'capability-enabled'];

describe('PR-2 EA-3 归属账：全形条目与装配期判据', () => {
  let dir: string; let w: BootstrapWorld;
  beforeAll(() => { dir = tempDir('g2-pr2-'); w = openBootstrapWorld(dir); });
  afterAll(() => { cleanup(dir); });

  test('全形条目可读回：五字段 + approval 原样（读面不当它是「可选装饰」）', () => {
    const e = w.kernel.registry.formalEventEntry(DOMAIN_EVENT)!;
    expect(e).toBeDefined();
    expect(e.capability).toBe(CAP_BOOTSTRAP);
    expect(e.requiresAuthority).toBe(AXIS_DOMAIN);
    expect(e.truthSource).toBe('ledger-payload');
    expect(e.interpretationRuleSetVersion).toBe('boot/r1');
    expect(e.contractVersion).toBe('v1');
    expect(e.approval?.approvedBy).toBe('harness-owner');
    expect(w.kernel.registry.formalEventEntries().length).toBe(2);
  });

  test('EA-3.2 ③ 缺 requiresAuthority ⇒ ACTIVATION_IMPOSSIBLE（不是运行期才炸）', () => {
    const bad = w.kernel.registry.constructor as unknown as { name: string };
    expect(bad.name).toBe('CapabilityRegistry');
    // 用独立 world 注册缺字段清单：装配期必须拒
    const d2 = tempDir('g2-pr2-bad-');
    try {
      expect(() => {
        const w2 = openBootstrapWorld(d2, {
          plugin: ({
            pluginId: 'bad.noaxis', codeVersion: '0', provides: [{ capability: 'cap.bad', contractVersion: 'v1' }],
            requires: [], storageNamespace: 'bad_noaxis', eventAuthority: 'ledger-payload',
            ownsKinds: [],
            ownsEventTypes: [{
              eventType: 'bad-x', capability: 'cap.bad', requiresAuthority: '' as never,
              truthSource: 'ledger-payload', interpretationRuleSetVersion: 'r1', contractVersion: 'v1',
            }],
          } as never),
        });
        w2.close();
      }).toThrowError(Refusal);
    } finally { cleanup(d2); }
  });

  test('EA-3.1 缺 truthSource / 版本钉 ⇒ 装配红（不给「先登记后补字段」留窗口）', () => {
    const cases: Partial<EventOwnershipEntry>[] = [
      { truthSource: undefined },
      { interpretationRuleSetVersion: '' },
      { contractVersion: '   ' },
      { truthSource: 'domain-table' as never },
    ];
    for (const patch of cases) {
      const d = tempDir('g2-pr2-t-');
      try {
        expect(() => openBootstrapWorld(d, {
          plugin: ({
            pluginId: 'bad.shape', codeVersion: '0', provides: [{ capability: 'cap.bad', contractVersion: 'v1' }],
            requires: [], storageNamespace: 'bad_shape', eventAuthority: 'ledger-payload', ownsKinds: [],
            ownsEventTypes: [{
              eventType: 'bad-y', capability: 'cap.bad', requiresAuthority: 'x',
              truthSource: 'ledger-payload', interpretationRuleSetVersion: 'r1', contractVersion: 'v1', ...patch,
            } as never],
          } as never),
        })).toThrowError(Refusal);
      } finally { cleanup(d); }
    }
  });

  test('EA-3.2 ② 认领机制名 ⇒ AMBIGUOUS_AUTHORITY（机制名不是清单可认领面）', () => {
    const d = tempDir('g2-pr2-m-');
    try {
      expect(() => openBootstrapWorld(d, {
        plugin: ({
          pluginId: 'bad.claim', codeVersion: '0', provides: [{ capability: 'cap.bad', contractVersion: 'v1' }],
          requires: [], storageNamespace: 'bad_claim', eventAuthority: 'ledger-payload', ownsKinds: [],
          ownsEventTypes: [{
            eventType: MECHANISM_NAMES[0], capability: 'cap.bad', requiresAuthority: 'x',
            truthSource: 'ledger-payload', interpretationRuleSetVersion: 'r1', contractVersion: 'v1',
          }],
        } as never),
      })).toThrowError(Refusal);
    } finally { cleanup(d); }
  });
});

describe('PR-2 EA-4 授权证据：九字段信封与入参封闭', () => {
  let dir: string; let w: BootstrapWorld;
  beforeAll(() => { dir = tempDir('g2-pr2b-'); w = openBootstrapWorld(dir); });
  afterAll(() => { cleanup(dir); });

  const mkObject = () => w.uow(WRITER, (tx) => tx.createObject({ kind: 'boot.probe', payload: { k: 1 } }) as never);

  test('EA-4.2 写入九字段信封：actor/capability/axis/authorized/版本/发号/登记序/时钟', () => {
    const oid = mkObject();
    const seq = w.uow(WRITER, (tx) => {
      const writer = w.kernel.faceFor(CAP_BOOTSTRAP).writerFor(tx);
      return writer.appendAuthoritativeEvent({
        eventType: DOMAIN_EVENT, objectId: oid, revision: 1, payload: { probe: 1 },
      });
    });
    let row: { actor: string; authority_basis: string } | undefined;
    w.port.read((raw) => { row = raw.get(`select actor, authority_basis from ledger where seq=?`, seq); });
    const env = parseAuthorizationContext(JSON.parse(row!.authority_basis));
    expect(env).not.toBeNull();
    expect(env!.actor).toBe('alice');
    expect(env!.actor).toBe(row!.actor);
    expect(env!.capability).toBe(CAP_BOOTSTRAP);
    expect(env!.axis).toBe(AXIS_DOMAIN);
    expect(env!.authorized).toBe(true);
    expect(env!.ruleSetVersion).toBe('boot/r1');
    expect(env!.contractVersion).toBe('v1');
    expect(env!.txSeq).toBe(seq);
    expect(typeof env!.ctxId).toBe('string');
    expect(Number.isFinite(env!.issuedAtMs)).toBe(true);
  });

  test('EA-4.1 有写权但无业务轴 ⇒ 收存不投影（authorized:false，不拒写）', () => {
    const oid = mkObject();
    const seq = w.uow(PLAIN, (tx) => w.kernel.faceFor(CAP_BOOTSTRAP).writerFor(tx)
      .appendAuthoritativeEvent({ eventType: DOMAIN_EVENT, objectId: oid, revision: 1, payload: { probe: 2 } }));
    let basis: string | undefined;
    w.port.read((raw) => { basis = raw.get<{ authority_basis: string }>(`select authority_basis from ledger where seq=?`, seq)!.authority_basis; });
    expect(parseAuthorizationContext(JSON.parse(basis!))!.authorized).toBe(false);
  });

  test('EA-4.3 入参携带见证字段 ⇒ 拒（detail.reason = input-carries-witness-field）', () => {
    const oid = mkObject();
    const attempt = (extra: Record<string, unknown>) => () => w.uow(WRITER, (tx) =>
      (w.kernel.faceFor(CAP_BOOTSTRAP).writerFor(tx).appendAuthoritativeEvent as unknown as (a: unknown) => number)(
        { eventType: DOMAIN_EVENT, objectId: oid, revision: 1, payload: {}, ...extra },
      ));
    for (const field of ['actor', 'authority_basis', 'authorized', 'ruleSetVersion', 'contractVersion', 'ctxId', 'capability', 'axis']) {
      try {
        attempt({ [field]: 'forged' })();
        throw new Error(`未拒绝见证字段 ${field}`);
      } catch (e) {
        expect(e).toBeInstanceOf(Refusal);
        expect((e as Refusal).code).toBe('EVENT_AUTHORITY_REQUIRED');
        expect((e as Refusal).detail?.reason).toBe('input-carries-witness-field');
      }
    }
  });

  test('EA-5 退役名不可再新写（读面不变，写面拒）', () => {
    const oid = mkObject();
    try {
      w.uow(WRITER, (tx) => w.kernel.faceFor(CAP_BOOTSTRAP).writerFor(tx)
        .appendAuthoritativeEvent({ eventType: RETIRED_EVENT, objectId: oid, revision: 1, payload: {} }));
      throw new Error('退役名竟可新写');
    } catch (e) {
      expect((e as Refusal).code).toBe('EVENT_AUTHORITY_REQUIRED');
    }
  });

  test('未登记名经权威入口 ⇒ EVENT_AUTHORITY_REQUIRED（没有权威签发者）', () => {
    const oid = mkObject();
    try {
      w.uow(WRITER, (tx) => w.kernel.faceFor(CAP_BOOTSTRAP).writerFor(tx)
        .appendAuthoritativeEvent({ eventType: 'never-registered', objectId: oid, revision: 1, payload: {} }));
      throw new Error('未登记名竟可写');
    } catch (e) {
      expect((e as Refusal).code).toBe('EVENT_AUTHORITY_REQUIRED');
    }
  });
});

describe('PR-2 EA-4.5/4.6 全形闸与三态复算', () => {
  const MECH = new Set(['space-write', 'capability-admin', 'facet-mount']);
  const base = (over: Partial<WitnessRow> & { env?: Record<string, unknown> } = {}): WitnessRow => {
    const env = {
      ctxId: 'ctx-1', actor: 'alice', capability: 'cap.boot', axis: 'domain-admission', authorized: true,
      ruleSetVersion: 'boot/r1', contractVersion: 'v1', issuedAtMs: 1, txSeq: 7,
      // 允许传 `env`（改一个字段）或 `envelope`（整份换掉，半形负例用）——
      // 之前只认 `env`，`drop()` 传的 `envelope` 被末尾覆盖掉，于是「缺字段」负例全绿（自证漏洞）。
      ...((over.env ?? (over as unknown as { envelope?: Record<string, unknown> }).envelope ?? {}) as Record<string, unknown>),
    };
    const { env: _e, envelope: _omit, ...rest } = over as Record<string, unknown>;
    return { seq: 7, eventType: 'domain-x', actor: 'alice', ...(rest as object), envelope: env };
  };
  const src = (over: Partial<GateSources> = {}): GateSources => ({
    classify: () => 'domain',
    registeredMechanismAxis: () => undefined,
    mechanismResources: MECH,
    ownerAt: () => 'cap.boot',
    frozenVersions: new Set(['boot/r1', 'v1']),
    ...over,
  });

  test('domain 支：轴不在机制集 ∧ capability = 该版本下的 owner ⇒ 通过', () => {
    expect(gateFullShape(base(), src())).toEqual({ ok: true, branch: 'domain' });
  });

  // 负例一律**内联构行**（不经 base 的合并逻辑）：合逻辑自身出过一次错，
  // 让「缺字段」负例全绿——负例的构造路径必须比被测代码更笨。
  const FULL = {
    ctxId: 'ctx-1', actor: 'alice', capability: 'cap.boot', axis: 'domain-admission', authorized: true,
    ruleSetVersion: 'boot/r1', contractVersion: 'v1', issuedAtMs: 1, txSeq: 7,
  };
  const row = (envelope: unknown, over: Partial<WitnessRow> = {}): WitnessRow =>
    ({ seq: 7, eventType: 'domain-x', actor: 'alice', envelope, ...over });

  test('半形必红：少一个字段 / 多一个字段 / 类型不对', () => {
    for (const k of Object.keys(FULL)) {
      const e: Record<string, unknown> = { ...FULL };
      delete e[k];
      expect(gateFullShape(row(e), src()), `缺 ${k} 竟通过`).toMatchObject({ ok: false });
    }
    expect(gateFullShape(row({ ...FULL, extra: 1 }), src()).ok).toBe(false);
    expect(gateFullShape(row({ ...FULL, authorized: 'true' }), src()).ok).toBe(false);
    expect(gateFullShape(row({ ...FULL, txSeq: 8 }), src()).ok).toBe(false);
    expect(gateFullShape(row(FULL, { actor: null }), src()).ok).toBe(false);
    expect(gateFullShape(row(null), src()).ok).toBe(false);
  });




  test('同源一致性：envelope.actor ≠ row.actor ⇒ 红（等式只是校验位，但仍是判据）', () => {
    expect(gateFullShape(row(FULL, { actor: 'mallory' }), src()).ok).toBe(false);
  });

  test('domain 支不许用机制轴；owner 按行钉住的 contractVersion 查', () => {
    expect(gateFullShape(row({ ...FULL, axis: 'capability-admin' }), src()).ok).toBe(false);
    expect(gateFullShape(row(FULL), src({ ownerAt: (_t, v) => (v === 'v1' ? 'cap.other' : 'cap.boot') })).ok).toBe(false);
    expect(gateFullShape(row({ ...FULL, contractVersion: 'v0' }), src({ ownerAt: (_t, v) => (v === 'v0' ? undefined : 'cap.boot') })).ok).toBe(false);
  });

  test('mechanism 三支：route-audit / mechanism-op 通过；挂错轴 / 未授权 / 轴不在机制集 ⇒ 红', () => {
    const mSrc = src({ classify: () => 'mechanism', registeredMechanismAxis: (t) => (t === 'facet-mounted' ? 'facet-mount' : undefined) });
    const m = (eventType: string, env: Record<string, unknown>) => row({ ...FULL, ...env }, { eventType });
    expect(gateFullShape(m('capability-enabled', { axis: 'capability-admin' }), mSrc)).toEqual({ ok: true, branch: 'route-audit' });
    expect(gateFullShape(m('facet-mounted', { axis: 'facet-mount' }), mSrc)).toEqual({ ok: true, branch: 'mechanism-op' });
    // 挂到别的机制轴（`space-write`）⇒ 红。注意 `capability-admin` 不算「挂错」：它本身就是
    // EA-4.5 ② 的 route-audit 支（轴=运维权威 ∧ authorized=1），与名字无关。
    expect(gateFullShape(m('facet-mounted', { axis: 'space-write' }), mSrc).ok).toBe(false);
    expect(gateFullShape(m('unknown-mech', { axis: 'facet-mount' }), mSrc).ok).toBe(false);
    expect(gateFullShape(m('facet-mounted', { axis: 'facet-mount', authorized: false }), mSrc).ok).toBe(false);
    expect(gateFullShape(m('facet-mounted', { axis: 'domain-admission' }), mSrc).ok).toBe(false);
  });

  test('EA-4.6 三态：VERIFIED / INCONSISTENT / UNVERIFIABLE_LEGACY 各归各位', () => {
    expect(replayAuthorityEvidence(row(FULL), src())).toBe('VERIFIED');
    // domain 支不看 authorized（B-3/C-05：false 只影响投影，不拒写）——所以「假授权」的复算红
    // 必须用**机制支**样本，否则这条断言会把契约语义测反。
    const mSrc = src({ classify: () => 'mechanism', registeredMechanismAxis: (t) => (t === 'facet-mounted' ? 'facet-mount' : undefined) });
    expect(replayAuthorityEvidence(row({ ...FULL, axis: 'facet-mount', authorized: false }, { eventType: 'facet-mounted' }), mSrc)).toBe('INCONSISTENT');
    expect(replayAuthorityEvidence(row({ ...FULL, ruleSetVersion: 'nope' }), src())).toBe('INCONSISTENT');
    expect(replayAuthorityEvidence(row(null, { eventType: 'object-revised' }), src())).toBe('UNVERIFIABLE_LEGACY');
    expect(replayAuthorityEvidence(row({ axis: 'a', capability: 'c', authorized: true }, { eventType: 'object-revised' }), src())).toBe('INCONSISTENT');
  });

  test('EA-7.4 非 oracle：回声里任何 hiddenBy* 键（含嵌套/数组）都算泄漏', () => {
    expect(findNonOracleViolations({ seq: 3, recordedAt: 1 })).toEqual([]);
    expect(findNonOracleViolations({ hiddenByPolicy: true }).map((v) => v.key)).toEqual(['hiddenByPolicy']);
    expect(findNonOracleViolations({ a: { b: [{ hiddenByFacet: 'x' }] } }).map((v) => v.path))
      .toEqual(['$.a.b[0].hiddenByFacet']);
    // 名字里含 hiddenBy 但不是前缀的键不算（`gHiddenBy` 是无关字段）——判据是前缀，不是子串
    expect(findNonOracleViolations({ gHiddenBy: 1 })).toEqual([]);
    // 循环引用不能把判据卡死
    const cyc: Record<string, unknown> = {}; cyc.self = cyc;
    expect(() => findNonOracleViolations(cyc)).not.toThrow();
  });

  test('通用台账通道不得写已登记的机制名（PR-2 R-8：机制写点只能走内部原语）', () => {
    const world = openBootstrapWorld(tempDir('g2-pr2-r8-'));
    // 机制名已在装配期登记（`facet-mounted` 属机制资源），通用 appendLedger 必须拒写：
    // 否则任何 space-write 主体都能 mint 机制真账行，EA-7.1/7.2 就成了摆设。
    // 只列**本世界已登记/已预留**的名字：`integrity-audit-recorded` / `read-shadow-recorded`
    // 目前仍是 planned:true（未落地），改由 R2 的“待落库”对账判据看着；等它们落地时必须
    // 一并加进 `MECHANISM_AUDIT_EVENT_TYPES`，那时这条测试也应随之上名单。
    for (const name of ['capability-enabled', 'object-registered', DOMAIN_EVENT,
      'integrity-audit-recorded', 'read-shadow-recorded']) {
      expect(() => world.uow(WRITER, (tx) => tx.appendLedger({ eventType: name, payload: {} })))
        .toThrowError(expect.objectContaining({ code: 'EVENT_AUTHORITY_REQUIRED' }));
    }
  });

  test('EA-7.1/7.2 机制内部写点：可落账、回声非 oracle、通用通道仍拒', () => {
    // 机制审计落账是**运维权威轴**（与启停路由同轴）：测试主体需有 `capability-admin`，
    // 否则连内部写点都进不去——这本身就是判据的一部分（不是任何 space-write 都能 mint 审计行）。
    const world = openBootstrapWorld(tempDir('g2-pr2-ea7-'), { grants: { alice: ['space-write', 'capability-admin'] } });
    const w0 = world as unknown as { kernel: { recordMechanismAudit: (a: unknown, by: unknown) => { seq: number } } };
    for (const name of ['integrity-audit-recorded', 'read-shadow-recorded'] as const) {
      const echo = w0.kernel.recordMechanismAudit({ eventType: name, payload: { hiddenByPolicy: 'x', note: 'ok' } }, WRITER);
      // 回声只回 seq（EA-7.4）：调用方不能从返回值读出「被隐藏的是什么」
      expect(Object.keys(echo)).toEqual(['seq']);
      expect(findNonOracleViolations(echo)).toEqual([]);
      // 入参里混进来的 hiddenBy* 不许进不可变账（否则读面会把谎话回出去）
      // 入参里混进来的 hiddenBy* 不许进不可变账：数一下含该键的行应为 0
      expect(world.count(`select count(*) as c from ledger where event_type=? and payload_json like '%hiddenBy%'`, name)).toBe(0);
      // 通用通道仍拒写这两个名字
      expect(() => world.uow(WRITER, (tx) => tx.appendLedger({ eventType: name, payload: {} })))
        .toThrowError(expect.objectContaining({ code: 'EVENT_AUTHORITY_REQUIRED' }));
    }
  });

  test('R-8 收敛：生产代码里没有 appendLedger 的调用方（只剩机制定义与测试）', () => {
    // 通用台账通道收敛为**机制内部原语**的可机验形态：`src/**` 除 kernel.ts 的定义处外，
    // 不得再出现 `.appendLedger(` 调用。领域侧一律走各自的授权命令 Port（`appendAuthoritativeEvent`）
    // 或机制内部写点；否则任何新领域都能绕过授权面直接落账。
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, e.name);
        if (e.isDirectory()) { walk(full); continue; }
        if (!e.name.endsWith('.ts')) continue;
        if (full.endsWith('/src/kernel/kernel.ts')) continue;
        const rel = full.slice(process.cwd().length + 1);
        if (readFileSync(full, 'utf8').includes('.appendLedger(')) offenders.push(rel);
      }
    };
    walk(join(process.cwd(), 'src'));
    expect(offenders).toEqual([]);
  });

  test('闸门源码不含事件名清单（R-2：三支只能依赖三个既有正源）', () => {
    const srcText = readFileSync(join(process.cwd(), 'src/kernel/authority-gate.ts'), 'utf8');
    for (const name of [...MECHANISM_NAMES, DOMAIN_EVENT, 'facet-mounted', 'read-shadow-recorded']) {
      expect(srcText.includes(`'${name}'`)).toBe(false);
    }
  });

  test('EA-3.2/§3.2 零装配副作用：清单中途被拒时，先登记的能力/事件名全部回滚', () => {
    const d0 = tempDir('g2-pr2-rollback-');
    const w = openBootstrapWorld(d0);
    const good = {
      eventType: 'test.good-entry', capability: 'cap.test.rollback', requiresAuthority: 'axis.x',
      truthSource: 'ledger-payload' as const, interpretationRuleSetVersion: 'v1', contractVersion: 'v1',
      approval: { approvedBy: 'h', approvedOn: '2026-11-03', anchor: 'tests' },
    };
    const bad = {
      eventType: 'raw-record-declared', capability: 'cap.test.events', requiresAuthority: 'axis.x',
      truthSource: 'ledger-payload' as const, interpretationRuleSetVersion: 'v1', contractVersion: 'v1',
      approval: { approvedBy: 'h', approvedOn: '2026-11-03', anchor: 'tests' },
    };
    const manifest = {
      pluginId: 'test.rollback', codeVersion: '0.0.1',
      provides: [{ capability: 'cap.test.rollback', contractVersion: 'v1' }], requires: [],
      storageNamespace: 'dom_rollback', eventAuthority: 'none' as const,
      ownsEventTypes: [good, bad],
    };
    const before = w.kernel.registry.formalEventEntries().length;
    expect(() => w.kernel.registry.register(manifest as never))
      .toThrowError(expect.objectContaining({ code: 'AMBIGUOUS_AUTHORITY' }));
    // 零增量：先登记的好条目也不许留下，能力也不许注册
    expect(w.kernel.registry.formalEventEntries().length).toBe(before);
    expect(w.kernel.registry.formalEventOwner('test.good-entry')).toBeUndefined();
    expect(w.kernel.registry.capability('cap.test.rollback')).toBeUndefined();
    w.close();
  });

  test('EA-3.1：缺 approval 的领域条目在装配期被拒（不给"先登记后补批准"留窗口）', () => {
    const d1 = tempDir('g2-pr2-approval-');
    const w = openBootstrapWorld(d1);
    const noApproval = {
      eventType: 'test.no-approval', capability: 'cap.test.na', requiresAuthority: 'axis.x',
      truthSource: 'ledger-payload', interpretationRuleSetVersion: 'v1', contractVersion: 'v1',
    };
    expect(() => w.kernel.registry.register({
      pluginId: 'test.na', codeVersion: '0.0.1',
      provides: [{ capability: 'cap.test.na', contractVersion: 'v1' }], requires: [],
      storageNamespace: 'dom_na', eventAuthority: 'none',
      ownsEventTypes: [noApproval],
    } as never)).toThrowError(expect.objectContaining({ code: 'ACTIVATION_IMPOSSIBLE' }));
    w.close();
  });

  test('EA-4.4/EA-4.6：机制写点落九字段信封，审计复算为 VERIFIED', () => {
    const d2 = tempDir('g2-pr2-envelope-');
    const w2 = openBootstrapWorld(d2, { grants: { alice: ['space-write', 'capability-admin'] } });
    const alice = PRINCIPAL('alice');
    w2.uow(alice, () => w2.kernel.declareRawIntake({ recordId: 'RAW-ENV', text: 'x', sourceRef: 's' }));
    type Row = { seq: number; event_type: string; actor: string; authority_basis: string };
    const readRow = (name: string): Row | undefined => w2.port.read((raw) =>
      raw.get<Row>(`select seq, event_type, actor, authority_basis from ledger where event_type=? order by seq desc limit 1`, name));
    const rawRow = readRow('raw-record-declared')!;
    const env = parseAuthorizationContext(JSON.parse(rawRow.authority_basis));
    expect(env, '机制写点也必须是九字段全形（否则审计侧只能判 INCONSISTENT）').not.toBeNull();
    expect(env!.txSeq).toBe(rawRow.seq);
    expect(env!.actor).toBe(rawRow.actor);
    expect(new Set(Object.keys(env!)).size).toBe(9);
    // 用**生产侧真实数据源**（Kernel.gateSources()），不再手搓一张"什么都能过"的轴表：
    // 复审第二轮指出手工轴表等于让测试给自己发合格证。
    expect(w2.kernel.gateSources().registeredMechanismAxis('raw-record-declared')).toBe('space-write');
    expect(replayAuthorityEvidence(
      { seq: rawRow.seq, eventType: rawRow.event_type, actor: rawRow.actor, envelope: env },
      w2.kernel.gateSources(),
    )).toBe('VERIFIED');
    // 生产入口复算同一行：形状与三态都成立
    expect(w2.kernel.replayLedger(rawRow.seq as never)).toMatchObject({
      shape: { ok: true, branch: 'mechanism-op' }, replay: 'VERIFIED',
    });

    // EA-7.1：巡检每次运行必落一条 integrity-audit-recorded（载荷形状照 §7.2）
    const before = w2.count(`select count(*) as c from ledger where event_type='integrity-audit-recorded'`);
    const audit = w2.kernel.auditRequiredIntegrity(alice, 'audit-call');
    expect(w2.count(`select count(*) as c from ledger where event_type='integrity-audit-recorded'`)).toBe(before + 1);
    const auditRow = readRow('integrity-audit-recorded')!;
    const body = JSON.parse(w2.port.read((raw) => raw.get<{ payload_json: string }>(
      `select payload_json from ledger where seq=?`, auditRow.seq))!.payload_json);
    expect(Object.keys(body).sort()).toEqual(
      ['counts', 'drift', 'ruleSetVersion', 'runId', 'schemaVersion', 'softwareGhostsDigest', 'trigger', 'violationsDigest']
        .filter((k) => k !== 'softwareGhostsDigest').concat('softGhostsDigest').sort());
    expect(body.counts).toEqual({
      checked: audit.checked, violations: audit.violations.length,
      softChecked: audit.softChecked, softGhosts: audit.softGhosts,
    });
    expect(body.trigger).toBe('audit-call');
    expect(body.ruleSetVersion).toBe('g1/fa3b892');
    // 软幽灵指纹是真指纹：无幽灵时等于空集 sha256，有幽灵时必须变（见下方专项用例）
    expect(body.softGhostsDigest).toBe(createHash('sha256').update('').digest('hex'));
    // EA-7.4 非 oracle：回执里没有任何 hiddenBy* 键
    expect(findNonOracleViolations(audit)).toEqual([]);
    w2.close();
  });

  test('EA-1.2.2：通用 write() 对三类事件名一律拒（含旧名单漏收的 object-revised/record-backfilled）', () => {
    const d3 = tempDir('g2-pr2-write-');
    const w3 = openBootstrapWorld(d3);
    const name = (t: string) => w3.uow(WRITER, (tx) => w3.kernel.faceFor(CAP_BOOTSTRAP).writerFor(tx)
      .write({ ns: 'boot_probe', oid: 'x' as never, revision: 1, payload: {}, eventType: t }));
    for (const t of ['never-registered-xyz', 'object-revised', 'record-backfilled', 'raw-record-declared', DOMAIN_EVENT]) {
      expect(() => name(t), `write() 必须拒 ${t}`).toThrowError(expect.objectContaining({ code: 'EVENT_AUTHORITY_REQUIRED' }));
    }
    expect(w3.count(`select count(*) as c from ledger where event_type in ('never-registered-xyz','object-revised','record-backfilled')`)).toBe(0);
    w3.close();
  });

  test('机制名单与锚逐条相等（EA-6.1 唯一正源；漏一个名字就是给通用通道留一个可 mint 的机制名）', () => {
    const anchor = JSON.parse(readFileSync(join(process.cwd(), 'contracts/event-registry/EVENT-CONTRACT-LEDGER.json'), 'utf8')) as
      { entries: { eventType: string; class: string }[] };
    const anchored = anchor.entries.filter((e) => e.class === 'mechanism').map((e) => e.eventType).sort();
    const declared = [...MECHANISM_AUDIT_EVENT_TYPES].sort();
    expect(declared).toEqual(anchored);
    // 轴上表覆盖同一集合（否则 registeredMechanismAxis 会对某些名字返回 undefined）
    expect(Object.keys(MECHANISM_EVENT_AXIS).sort()).toEqual(anchored);
  });
});

// ---------------------------------------------------------------- 复审第三轮补钉
import { DatabaseSync } from 'node:sqlite';
import { migrateLegacyRecords } from '../src/storage-sqlite/sqlite-port';

describe('PR-2 复审第三轮：契约分歧补钉', () => {
  test('write() 恒拒是**有意的死状态**（D-24 合法 Facet 挂载面在生产不可达，需冻结面裁定）', () => {
    const w = openBootstrapWorld(tempDir('g2-pr2-writedead-'));
    const oid = w.uow(WRITER, (tx) => w.kernel.faceFor(CAP_BOOTSTRAP).writerFor(tx)
      .createOwned({ kind: 'boot.probe' as never, payload: { n: 1 } }));
    const before = {
      ledger: w.count(`select count(*) as c from ledger`),
      state: w.count(`select count(*) as c from domain_state`),
      journal: w.count(`select count(*) as c from journal`),
    };
    // 真实存在的 oid 也不放行：本入口没有"合法"分支，拒绝先于任何写
    expect(() => w.uow(WRITER, (tx) => w.kernel.faceFor(CAP_BOOTSTRAP).writerFor(tx)
      .write({ ns: 'boot_probe', oid, revision: 1, payload: { n: 2 }, eventType: 'facet-mounted' })))
      .toThrowError(expect.objectContaining({ code: 'EVENT_AUTHORITY_REQUIRED' }));
    expect({
      ledger: w.count(`select count(*) as c from ledger`),
      state: w.count(`select count(*) as c from domain_state`),
      journal: w.count(`select count(*) as c from journal`),
    }).toEqual(before);
    w.close();
  });

  test('入事务的巡检与自开事务的巡检用**同一授权判据**（space-write 主体不得借调用方事务落审计行）', () => {
    const w = openBootstrapWorld(tempDir('g2-pr2-auditsym-'), { grants: { alice: ['space-write', 'capability-admin'], bob: ['space-write'] } });
    const bob = PRINCIPAL('bob');
    expect(() => w.uow(bob, () => w.kernel.auditRequiredIntegrity(bob, 'audit-call')))
      .toThrowError(expect.objectContaining({ code: 'AUTHORITY_REQUIRED' }));
    expect(w.count(`select count(*) as c from ledger where event_type='integrity-audit-recorded'`)).toBe(0);
    // 同一主体在事务外也被拒（两套判据必须一致，不是"事务内更宽松"）
    expect(() => w.kernel.auditRequiredIntegrity(bob, 'audit-call'))
      .toThrowError(expect.objectContaining({ code: 'AUTHORITY_REQUIRED' }));
    w.close();
  });

  test('迁移器补写行带九字段信封，且复算为 VERIFIED（旧行仍是 UNVERIFIABLE_LEGACY）', () => {
    const d = tempDir('g2-pr2-migrate-');
    const file = join(d, 'research.sqlite');
    const w = openBootstrapWorld(d);
    const oldSeq = w.port.read((raw) => raw.get<{ seq: number }>(`select max(seq) as seq from ledger`)!).seq;
    w.close();
    // 造一条"有 record_id、无 records 行"的旧账行（= 包 3 之前的历史形态；迁移器的输入就是这个形状）
    const raw = new DatabaseSync(file);
    raw.prepare(`insert into ledger(seq, space, event_type, actor, record_id, payload_json, described_at, recorded_at)
                 values(?,?,?,?,?,?,?,?)`).run(oldSeq + 1, 'SP-boot', 'object-registered', 'legacy:actor', 'LEG-1',
      JSON.stringify({ legacy: true }), null, Date.now());
    raw.prepare(`update meta set value=? where key='ledger_seq'`).run(oldSeq + 1);
    raw.close();
    expect(migrateLegacyRecords(file)).toBe(1);
    const w2 = openBootstrapWorld(d);
    // 补写行 = 机制行，九字段齐、复算 VERIFIED
    const backSeq = w2.port.read((raw) => raw.get<{ seq: number }>(
      `select seq from ledger where actor='migrator' order by seq desc limit 1`)!).seq;
    expect(w2.kernel.replayLedger(backSeq as never))
      .toMatchObject({ shape: { ok: true, branch: 'mechanism-op' }, replay: 'VERIFIED' });
    // 旧行没有被"顺带"证明：仍是 UNVERIFIABLE_LEGACY
    const legacySeq = w2.port.read((raw) => raw.get<{ seq: number }>(
      `select seq from ledger where actor='legacy:actor' limit 1`)!).seq;
    expect(w2.kernel.replayLedger(legacySeq as never).replay).toBe('UNVERIFIABLE_LEGACY');
    w2.close();
  });
});
