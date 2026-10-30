/**
 * 包 2 · D-20 / D-22 的正反双向钉（外部复审第四轮修复的机制面）。
 *
 * 每条拒绝都必须配一条**同形态的正例**——否则"修成一刀切"也能骗绿；
 * 每条"不轻信"都必须配一条**真签发的对照**——否则投影坏成恒拒绝也看不出来。
 * 权威表述：CONTRACTS.md §16.2。红蓝对抗判据见 attacks/review/g1a-regression.test.ts（只读）。
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../src/harness/paths.ts';
import { openWorld, PRINCIPAL, type World } from '../src/harness/world.ts';
import { TEST_OBJECT_MODEL, CAP_OBJECT_MODEL } from '../src/domains/test-object-model.ts';
import { TEST_VALIDATION } from '../src/domains/test-validation.ts';
import {
  ValidationService, TEST_RECORDS, CAP_RECORDS,
  FACT_DESIGNATION_EVENT, FACT_DESIGNATION_SCHEMA, FACT_STANDING_POLICY_VERSION,
  adaptLegacyValidationWiring, type ValidationReportSubmission,
} from '../src/domains/test-records.ts';
import type { UnitOfWork } from '../src/kernel/kernel.ts';
import { Refusal } from '../src/contracts/index.ts';

const WRITER = PRINCIPAL('alice');      // space-write
const ADMITTER = PRINCIPAL('carol');    // space-write + domain-admission
const NOBODY = PRINCIPAL('nobody');     // 有 space-write、无 domain-admission（g1a 夹具同款）
const GRANTS = { alice: ['space-write'], carol: ['space-write', 'domain-admission'], nobody: ['space-write'] };

const refusalCode = (fn: () => unknown): string => {
  try { fn(); return 'NO_REFUSAL'; }
  catch (e) { return e instanceof Refusal ? e.code : `OTHER:${String(e)}`; }
};

describe('包 2 D-20：正式事件类型的唯一写入口与投影信任模型', () => {
  let dir: string;
  beforeAll(() => { dir = mkdtempSync(join(POC_DATA_DIR, 'fe-authority-')); });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });
  const worlds: World[] = [];
  const w = (name: string): World => {
    const x = openWorld({ file: join(dir, `${name}.db`), space: 'SP-FE', grants: GRANTS,
      plugins: [TEST_OBJECT_MODEL, TEST_VALIDATION, TEST_RECORDS] });
    worlds.push(x);
    return x;
  };

  test('通用通道写正式事件一律 EVENT_AUTHORITY_REQUIRED——scoped 与 assembly 都不例外', () => {
    const x = w('fe-channel');
    const standing = x.standingUseCase();
    const oid = x.uow(WRITER, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } }));
    // ① scoped 事务（g1a 红条的原始形态；nobody 有 space-write——通道判据在授权核对之后仍要成立）
    expect(refusalCode(() => x.uowFor(CAP_OBJECT_MODEL, NOBODY, (tx) => tx.appendLedger({
      eventType: FACT_DESIGNATION_EVENT, objectId: oid, revision: 1,
      payload: { stance: 'ACCEPTED', by: 'nobody', note: 'AUTHORIZED' },
    })))).toBe('EVENT_AUTHORITY_REQUIRED');
    // ② 装配作用域同样写不动（通道判据与归属判据正交，scope 帮不上忙）
    expect(refusalCode(() => x.uow(WRITER, (tx) => tx.appendLedger({
      eventType: FACT_DESIGNATION_EVENT, objectId: oid, revision: 1,
      payload: { stance: 'ACCEPTED', note: 'AUTHORIZED' },
    })))).toBe('EVENT_AUTHORITY_REQUIRED');
    // ③ 拒绝先于写入：H 里一条都没落
    expect(x.raw.get<{ c: number }>(`select count(*) c from ledger where event_type=?`,
      FACT_DESIGNATION_EVENT)!.c).toBe(0);
    expect(standing.standingAt(oid, x.ledgerHead()).state).toBe('NOT_ADOPTED');
  });

  test('唯一入口正例：命令 Port 签发 ⇒ 落账 actor=已验证主体、结构化字段齐全、投影翻转', () => {
    const x = w('fe-port');
    const standing = x.standingUseCase();
    const oid = x.uow(WRITER, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } }));
    const seq = x.uow(ADMITTER, (tx) => standing.declare(tx, { oid, revision: 1, stance: 'ACCEPTED' }));
    expect(seq).toBeGreaterThan(0);
    const row = x.raw.get<{ actor: string; p: string }>(
      `select actor, payload_json p from ledger where event_type=? and object_id=?`,
      FACT_DESIGNATION_EVENT, oid)!;
    expect(row.actor).toBe('carol');                    // 机制落账的签发主体（不是载荷自述）
    const p = JSON.parse(row.p) as Record<string, unknown>;
    expect(p).toMatchObject({
      designationSchema: FACT_DESIGNATION_SCHEMA, stance: 'ACCEPTED',
      issuer: 'carol', authorization: 'AUTHORIZED', policyVersion: FACT_STANDING_POLICY_VERSION,
    });
    expect(standing.standingAt(oid, x.ledgerHead()).state).toBe('ADOPTED');
    // 撤回同样只经命令 Port，且回读旧截点仍显示当时状态（历史不重写）
    const seq2 = x.uow(ADMITTER, (tx) => standing.declare(tx, { oid, revision: 1, stance: 'WITHDRAWN' }));
    expect(standing.standingAt(oid, x.ledgerHead()).state).toBe('NOT_ADOPTED');
    expect(standing.standingAt(oid, seq).state).toBe('ADOPTED');
  });

  test('非归属能力的窄面冒充签发 ⇒ EVENT_AUTHORITY_REQUIRED；未登记类型走权威通道同样被拒', () => {
    const x = w('fe-owner');
    const oid = x.uow(WRITER, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } }));
    // 别的能力的端口想借权威通道写记录域的正式事件
    expect(refusalCode(() => x.uow(WRITER, (tx) => x.kernel.faceFor(CAP_OBJECT_MODEL)
      .writerFor(tx).appendAuthoritativeEvent({
        eventType: FACT_DESIGNATION_EVENT, objectId: oid, revision: 1, payload: {},
      })))).toBe('EVENT_AUTHORITY_REQUIRED');
    // 没登记过的事件类型也进不了权威通道（机制不替没有主人的事件落账）
    expect(refusalCode(() => x.uow(WRITER, (tx) => x.kernel.faceFor(CAP_RECORDS)
      .writerFor(tx).appendAuthoritativeEvent({
        eventType: 'synth:not-registered', objectId: oid, revision: 1, payload: {},
      })))).toBe('EVENT_AUTHORITY_REQUIRED');
    // 对照：同能力 + 已登记类型 ⇒ 成功（不是过度收紧）
    const standing = x.standingUseCase();
    expect(x.uow(ADMITTER, (tx) => standing.declare(tx, { oid, revision: 1, stance: 'ACCEPTED' })))
      .toBeGreaterThan(0);
  });

  test('级别修订不存在 ⇒ NOT_FOUND_IN_SPACE，且不留半条事件', () => {
    const x = w('fe-rev');
    const standing = x.standingUseCase();
    const oid = x.uow(WRITER, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } }));
    expect(refusalCode(() => x.uow(ADMITTER, (tx) => standing.declare(tx, { oid, revision: 99, stance: 'ACCEPTED' }))))
      .toBe('NOT_FOUND_IN_SPACE');
    expect(x.raw.get<{ c: number }>(`select count(*) c from ledger where event_type=?`,
      FACT_DESIGNATION_EVENT)!.c).toBe(0);
  });

  test('投影只信结构化字段 + 机制 actor + 记录版本：三种历史伪造形态全部不计入', () => {
    const x = w('fe-forge');
    const standing = x.standingUseCase();
    const oid = x.uow(WRITER, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } }));
    const forge = (actor: string | null, payload: Record<string, unknown>): void => {
      const seq = (x.raw.get<{ m: number }>(`select coalesce(max(seq),0)+1 m from ledger`)!.m);
      x.raw.run(
        `insert into ledger(seq, space, event_type, actor, object_id, revision, payload_json, described_at, recorded_at)
         values(?,?,?,?,?,?,?,?,?)`,
        seq, 'SP-FE', FACT_DESIGNATION_EVENT, actor, oid, 1, JSON.stringify(payload), null, Date.now());
      // 把水位推到该行之后：这些行是"**已提交的历史**"，必须被投影看见并逐条按新判据拒识——
      // 若靠 seq>head 的水位差把它们挡掉，本测试就成了假绿（判据根本没被喂到）。
      x.raw.run(`update meta set value=? where key='ledger_seq'`, seq);
    };
    // ① 修前形态：只有 note 字符串（g1a 红条使用的载荷）——新判据不读 note，直接忽略
    forge('nobody', { stance: 'ACCEPTED', by: 'nobody', note: 'AUTHORIZED' });
    // ② 载荷自称 issuer 但和机制 actor 不一致（冒充他人签发）
    forge('mallory', {
      designationSchema: FACT_DESIGNATION_SCHEMA, stance: 'ACCEPTED',
      issuer: 'carol', authorization: 'AUTHORIZED', policyVersion: FACT_STANDING_POLICY_VERSION,
    });
    // ③ 未来/未知 policyVersion：fail-closed，不按今天的规则重解释
    forge('carol', {
      designationSchema: FACT_DESIGNATION_SCHEMA, stance: 'ACCEPTED',
      issuer: 'carol', authorization: 'AUTHORIZED', policyVersion: 'fact-standing/v99',
    });
    expect(standing.standingAt(oid, x.ledgerHead()).state).toBe('NOT_ADOPTED');
    // 对照正例：形状齐全 + issuer===actor + 已获授权 ⇒ 计入（判据不是恒拒绝的摆设）
    forge('carol', {
      designationSchema: FACT_DESIGNATION_SCHEMA, stance: 'ACCEPTED',
      issuer: 'carol', authorization: 'AUTHORIZED', policyVersion: FACT_STANDING_POLICY_VERSION,
    });
    expect(standing.standingAt(oid, x.ledgerHead()).state).toBe('ADOPTED');
  });
});

describe('包 2 D-22：验证服务不再持有全权事务执行器', () => {
  let dir: string;
  beforeAll(() => { dir = mkdtempSync(join(POC_DATA_DIR, 'd22-face-')); });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  test('运行时面取不回事务执行器；旧回调接线的行为仍完好（适配只活在构造器栈帧里）', () => {
    const x = openWorld({ file: join(dir, 'd22.db'), space: 'SP-FE', grants: GRANTS,
      plugins: [TEST_OBJECT_MODEL, TEST_VALIDATION, TEST_RECORDS] });
    // 攻击夹具形态：第 2 参给旧的全权回调（g1a D-22 红条同款构造）。攻击文件不经 tsc，
    // 这里用断言复现它的运行时形态——tests/ 允许，src/domains 的门禁禁的是领域内透传。
    const svc = new ValidationService(
      x.kernel.faceFor(CAP_RECORDS),
      ((fn: (tx: UnitOfWork) => unknown) => x.uow(WRITER, fn)) as unknown as ValidationReportSubmission,
      (r) => x.readRevision(r));
    // ① 实例 + 原型的可枚举名字里没有 runIn，也没有任何"函数形态的自有字段"
    expect((svc as unknown as Record<string, unknown>).runIn).toBeUndefined();
    const own = Object.getOwnPropertyNames(svc)
      .filter((k) => typeof (svc as unknown as Record<string, unknown>)[k] === 'function');
    expect(own).toEqual([]);
    const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(svc) as object)
      .filter((k) => k !== 'constructor');
    expect(proto.sort()).toEqual(['checkEndpoint', 'run', 'withValidatorOffline']);
    // ② 行为对照：旧接线仍能完成「登记一份校验报告」——收口不是把功能修瘫
    const oid = x.uow(WRITER, (tx) => tx.createObject({ kind: 'test.claim', payload: { text: 'ok' } }));
    const res = svc.run(oid, 1, { actor: 'alice' });
    expect(res.reportId).toMatch(/^RPT-/);
    expect(x.readRevision({ kind: 'revision-ref', oid, revision: 1 })).toBeDefined();
    x.close();
  });

  test('受限提交接口形态：单动作 Port 接线，跑同一流程（这是实施期的正式形态）', () => {
    const x = openWorld({ file: join(dir, 'd22b.db'), space: 'SP-FE', grants: GRANTS,
      plugins: [TEST_OBJECT_MODEL, TEST_VALIDATION, TEST_RECORDS] });
    const svc = new ValidationService(
      x.kernel.faceFor(CAP_RECORDS), x.validationSubmission(WRITER), (r) => x.readRevision(r));
    const oid = x.uow(WRITER, (tx) => tx.createObject({ kind: 'test.claim', payload: { text: 'ok' } }));
    expect(svc.run(oid, 1, { actor: 'alice' }).reportId).toMatch(/^RPT-/);
    x.close();
  });

  test('适配器本身不得成为事务句柄的来源：直接攻击 adaptLegacyValidationWiring', () => {
    const x = openWorld({ file: join(dir, 'd22c.db'), space: 'SP-FE', grants: GRANTS,
      plugins: [TEST_OBJECT_MODEL, TEST_VALIDATION, TEST_RECORDS] });
    // 全权执行器（装配根形态）交进适配器；适配器是模块级导出 = 服务的实例面之外的另一入口。
    let leakedTx: UnitOfWork | undefined;
    const p = adaptLegacyValidationWiring(<R,>(fn: (tx: UnitOfWork) => R): R => x.uow(WRITER, (tx) => {
      leakedTx = tx;                       // 接线者自己视角里 tx 当然可见（执行器是它写的）
      return fn(tx);
    }));
    leakedTx = undefined;                  // 只留"从 p 出发"的可达性，抹掉接线侧的目击
    // ① 名字穷举：包装对象只有 submitReport；原型就是 Object.prototype（没有藏方法的第二层）。
    expect(Object.getOwnPropertyNames(p)).toEqual(['submitReport']);
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(p) as object).sort())
      .toEqual(Object.getOwnPropertyNames(Object.prototype).sort());
    // ② 类型穷举：函数形态的成员被调用后，返回值里不含函数/句柄（tx 交不回调用方）。
    for (const k of Object.getOwnPropertyNames(p)) {
      const v = (p as unknown as Record<string, unknown>)[k];
      expect(typeof v).toBe('function');   // 除 submitReport 外不存在别的成员
    }
    const oid = x.uow(WRITER, (tx) => tx.createObject({ kind: 'test.claim', payload: { text: 'ok' } }));
    const res = p.submitReport({
      target: { kind: 'revision-ref', oid, revision: 1 },
      validatorId: 'synth.claim-checker', ruleVersion: 'v1', schemaVersion: 'synth-1',
      environment: 'synth-env', executedAt: Date.now(), guaranteeScope: 'SYNTH-STRUCTURAL-ONLY',
      verdict: 'ACHIEVED', findings: [], declaredGaps: [],
    });
    expect(Object.values(res).every((v) => typeof v !== 'function')).toBe(true);
    expect(res.reportId).toMatch(/^RPT-/);
    // ③ 行为面：p 只能完成「登记一份报告」。它没有 revise/createObject/appendLedger 的任何入口
    //    （名字面为空），拿它改他人对象数据 ⇒ 数据原样；ledger 里除报告行外无其它新行。
    expect((p as unknown as Record<string, unknown>).revise).toBeUndefined();
    expect((p as unknown as Record<string, unknown>).createObject).toBeUndefined();
    expect((p as unknown as Record<string, unknown>).appendLedger).toBeUndefined();
    expect((x.readRevision({ kind: 'revision-ref', oid, revision: 1 })!.payload as Record<string, unknown>).text)
      .toBe('ok');
    expect(x.raw.get<{ c: number }>(
      `select count(*) c from ledger where object_id=? and event_type <> 'check-report-recorded'`, oid)!.c)
      .toBeLessThanOrEqual(1);             // ≤1 = 只剩 createObject 自己的登记行，p 没写进台账
    x.close();
  });
});
