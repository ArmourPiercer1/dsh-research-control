/**
 * D-19c：**Application Use-case 侧的写路径**（外部复审第三轮，2026-10-30）。
 *
 * 复审者的验收形状（本文件逐条钉住）：
 *
 * ```
 * Application Use-case（持有协调权，不持有业务规则豁免权）
 *     └── 共享同一条事务 SpaceTransaction
 *           ├── 记录域那一腿：机制级 H 记录声明（本 PoC 的记录域不拥有任何 kind）
 *           └── 对象模型域那一腿：经其**作用域端口**创建 test.claim / test.subject（归属不变）
 * ```
 *
 * 与 `tests/domain-write-face.test.ts` 的分工：那边管**运行时上界**（墙）与**词法提醒**（网）；
 * 本文件管**用例这一层是否真的走拥有者的端口、是否真的仍是一条事务、委派有没有多给权限**。
 * 三条最容易自欺的判据各自成一条用例，都不接受"看代码觉得是这样"：
 *   ① 归属**没被用例改写**——`owner_capability` 仍是注册表判定的那个拥有者；
 *   ② 原子性**没被打折**——两腿同生共死，失败不留半条（Q40）；
 *   ③ 委派**不多给权限**——拿到的端口与领域自有端口能力完全相同，越界照样拒；
 *   ④ 归属是**查出来的**——移交 / 换装配后用例一行不改即可跟随，非拥有者照样被拒。
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../src/harness/paths.ts';
import { openWorld, PRINCIPAL } from '../src/harness/world.ts';
import { TEST_OBJECT_MODEL, CAP_OBJECT_MODEL } from '../src/domains/test-object-model.ts';
import { TEST_RECORDS } from '../src/domains/test-records.ts';
import type { NamespaceWriter, UnitOfWork } from '../src/kernel/kernel.ts';
import type { ObjectOid, PluginManifest } from '../src/contracts/index.ts';

const ADMIN = PRINCIPAL('uc-admin');
const CAP_SECOND = 'cap.test.second';
const SECOND: PluginManifest = {
  pluginId: 'test.second-use-case', codeVersion: '0.0.1',
  provides: [{ capability: CAP_SECOND, contractVersion: 'v1' }], requires: [],
  storageNamespace: 'dom_test_second_uc', eventAuthority: 'none',
  ownsKinds: [{ kind: 'test.artifact', capability: CAP_SECOND }],
};

let dir: string;
beforeAll(() => { dir = mkdtempSync(join(POC_DATA_DIR, 'uc-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });
const world = (name: string, plugins?: readonly PluginManifest[]) =>
  openWorld({
    file: join(dir, `${name}.db`), space: 'SP-UC',
    grants: { 'uc-admin': ['space-write', 'capability-admin'] },
    plugins: plugins ?? [TEST_OBJECT_MODEL, SECOND],
  });
const refusalCode = (fn: () => unknown): string => {
  try { fn(); return 'NO_REFUSAL'; } catch (e) { return (e as { code?: string }).code ?? 'OTHER'; }
};

describe('D-19c 用例侧：跨归属写经拥有者的端口，且仍是一条事务', () => {
  test('① 归属不变：用例造出的对象，owner_capability 仍是注册表判定的拥有者', () => {
    const w = world('owner-unchanged');
    try {
      const intake = w.intakeUseCase();
      const oid = w.uow(ADMIN, (tx) => {
        intake.intake(tx, { recordId: 'RAW-1', text: '可解析', sourceRef: 's://1' });
        return intake.admit(tx, { recordId: 'RAW-1', kind: 'test.claim', text: '可解析' });
      });
      const row = w.raw.get<{ owner_capability: string; ns: string }>(
        `select owner_capability, ns from object_directory where oid=?`, oid)!;
      expect(row.owner_capability).toBe(CAP_OBJECT_MODEL);   // 不是记录域，更没有"用例"这个归属
      expect(row.ns).toBe('dom_test_om');
      // 对象化路径同理：kind 由领域给、归属由注册表查，两边都不是用例写死的
      const carrier = w.uow(ADMIN, (tx) => intake.objectifyRecord(tx, { recordId: 'RAW-1' }));
      expect(w.raw.get<{ owner_capability: string }>(
        `select owner_capability from object_directory where oid=?`, carrier)!.owner_capability).toBe(CAP_OBJECT_MODEL);
      // 来源边由对象模型那一腿写下（发起方归属 = 被写对象归属，没有跨归属挂边）
      expect(w.raw.all<{ role: string; to_record: string }>(
        `select role, to_record from ref_edge where from_oid=?`, carrier))
        .toContainEqual({ role: 'synth:derived-from', to_record: 'RAW-1' });
    } finally { w.close(); }
  });

  test('② 原子性（Q40）：记录那一腿 + 对象那一腿同生共死，失败不留半条', () => {
    const w = world('atomic');
    try {
      const intake = w.intakeUseCase();
      const ok = w.uow(ADMIN, (tx) => intake.intakeAndAdmit(tx, { recordId: 'RAW-A', kind: 'test.claim', text: 'ok', sourceRef: 's://a' }));
      if (!('oid' in ok)) throw new Error('正例应接纳成功');
      expect(w.readObject(ok.oid)).toBeDefined();
      expect(w.readRecord('RAW-A')).toBeDefined();

      // 反例：两腿都写完之后再炸 ⇒ 对象与记录**都**消失
      //（不是"记录留下了、对象没了"那种半提交——那正是把原子性拆成两段事务的形态）
      expect(() => w.uow(ADMIN, (tx) => {
        intake.intake(tx, { recordId: 'RAW-B', text: 'ok', sourceRef: 's://b' });
        intake.admit(tx, { recordId: 'RAW-B', kind: 'test.claim', text: 'ok' });
        throw new Error('用例中途失败');
      })).toThrow('用例中途失败');
      expect(w.readRecord('RAW-B')).toBeUndefined();
      expect(w.raw.get<{ c: number }>(`select count(*) c from object_directory where kind='test.claim'`)!.c).toBe(1);
      expect(w.raw.get<{ c: number }>(`select count(*) c from ref_edge where to_record='RAW-B'`)!.c).toBe(0);
    } finally { w.close(); }
  });

  test('②b 两个拥有者的端口在同一条事务里各写各的，第二条腿失败时两笔一起回滚', () => {
    // "跨插件原子提交要靠通用面"这句话在这里被替换掉：协调靠的是**各自的端口**，
    // 通用对象写面对用例同样关着门（白名单扫描见 domain-write-face.test.ts）。
    const w = world('two-owners');
    try {
      const writeBoth = (tx: UnitOfWork): [ObjectOid, ObjectOid] => {
        const om = w.writerOwningKind('test.claim', tx);
        const sec = w.writerOf(CAP_SECOND, tx);
        return [om.createOwned({ kind: 'test.claim', payload: { v: 1 } }),
          sec.createOwned({ kind: 'test.artifact', payload: { v: 1 } })];
      };
      const [a, b] = w.uow(ADMIN, (tx) => writeBoth(tx));
      expect(w.readObject(a)!.kind).toBe('test.claim');
      expect(w.readObject(b)!.kind).toBe('test.artifact');

      expect(() => w.uow(ADMIN, (tx) => {
        writeBoth(tx);
        throw new Error('第二条腿失败');
      })).toThrow('第二条腿失败');
      // 只剩上一轮那一对了：第二条腿炸掉时，第一条腿的写入一起消失
      expect(w.raw.get<{ c: number }>(`select count(*) c from object_directory`)!.c).toBe(2);
    } finally { w.close(); }
  });

  test('③ 委派不多给权限：委派端口与领域自有端口能力完全相同（越界照样拒）', () => {
    const w = world('delegation-bound');
    try {
      const foreign = w.uow(ADMIN, (tx) => tx.createObject({ kind: 'test.artifact', payload: { v: 1 } }));
      w.uow(ADMIN, (tx) => {
        const delegated = w.useCaseDelegation.writerOf(CAP_OBJECT_MODEL, tx) as NamespaceWriter;
        expect(refusalCode(() => delegated.createOwned({ kind: 'test.artifact', payload: {} }))).toBe('CAPABILITY_SCOPE_ESCAPE');
        expect(refusalCode(() => delegated.reviseOwned(foreign, { payload: { pwned: true } }))).toBe('CAPABILITY_SCOPE_ESCAPE');
        // 而且它就是同一个窄面（原型成员集相同 ⇒ 不存在"用例专用加强版端口"）
        const names = (o: object): string[] => Object.getOwnPropertyNames(Object.getPrototypeOf(o)).sort();
        expect(names(delegated)).toEqual(names(w.kernel.faceFor(CAP_OBJECT_MODEL).writerFor(tx) as object));
        // 委派面不交事务、不交裸句柄
        expect((delegated as unknown as Record<string, unknown>).tx).toBeUndefined();
        expect((delegated as unknown as Record<string, unknown>).raw).toBeUndefined();
      });
      expect(w.readObject(foreign)!.payload.pwned).toBeUndefined();
    } finally { w.close(); }
  });

  test('④ 归属是查出来的：能力移交到新命名空间后，用例与 writerOwningKind 一起跟随', () => {
    const OM_MOVED: PluginManifest = {
      ...TEST_OBJECT_MODEL, pluginId: 'test.object-model.b', codeVersion: '0.0.2',
      storageNamespace: 'dom_test_om_b',   // 换包同时迁移了命名空间
    };
    const w = world('follow-route');
    try {
      expect(w.uow(ADMIN, (tx) => w.writerOwningKind('test.claim', tx).ns)).toBe('dom_test_om');
      w.transferCapability(CAP_OBJECT_MODEL, OM_MOVED, ADMIN);
      expect(w.uow(ADMIN, (tx) => w.writerOwningKind('test.claim', tx).ns)).toBe('dom_test_om_b');
      const oid = w.uow(ADMIN, (tx) => w.intakeUseCase().admit(tx, { recordId: 'RAW-C', kind: 'test.claim', text: 'ok' }));
      // 落笔落在**新路由**的命名空间；用例一行未改（它内部没有任何 capability 常量）
      expect(w.raw.get<{ ns: string; owner_capability: string }>(
        `select ns, owner_capability from object_directory where oid=?`, oid))
        .toEqual({ ns: 'dom_test_om_b', owner_capability: CAP_OBJECT_MODEL });
      // 非拥有者照样写不动：墙不因移交而变软
      expect(refusalCode(() => w.uowFor(CAP_SECOND, ADMIN, (tx) => tx.createObject({ kind: 'test.claim', payload: {} }))))
        .toBe('CAPABILITY_SCOPE_ESCAPE');
      // 无人拥有的 kind ⇒ fail-loud，绝不"随便挑个能力写下去"
      expect(refusalCode(() => w.uow(ADMIN, (tx) => w.writerOwningKind('test.nobody-owns-me', tx))))
        .toBe('CAPABILITY_INACTIVE');
    } finally { w.close(); }
  });

  test('④b 同一份用例代码换一个装配就换一个拥有者；非拥有者的端口一律被拒', () => {
    // 机制里 kind→capability 的归属只能在装配期由清单声明（`transferRoute` 移交的是
    // capability→plugin 的实现映射，kind 归属没有运行时改写入口——这本身是一处该记录的现状）。
    // 所以"归属换了用例跟不跟"用两次装配来验，比在运行时偷改注册表诚实。
    const DOC = 'demo.doc';
    const mk = (cap: string, ns: string, kind: string): PluginManifest => ({
      pluginId: `demo.${cap.split('.').pop()}`, codeVersion: '0.0.1',
      provides: [{ capability: cap, contractVersion: 'v1' }],
      requires: [], storageNamespace: ns, eventAuthority: 'none',
      ownsKinds: [{ kind, capability: cap }],
    });
    const OTHER = mk('cap.demo.other', 'dom_demo_other', 'demo.other-kind'); // 永不拥有 DOC
    const runOn = (name: string, owner: PluginManifest): { owner: string; ns: string; otherRefused: string } => {
      const w = world(name, [owner, OTHER]);
      try {
        const oid = w.uow(ADMIN, (tx) => w.intakeUseCase().admit(tx, { recordId: 'RAW-D', kind: DOC, text: 'ok' }));
        const row = w.raw.get<{ owner: string; ns: string }>(
          `select owner_capability as owner, ns from object_directory where oid=?`, oid)!;
        const otherRefused = w.uow(ADMIN, (tx) =>
          refusalCode(() => w.writerOf('cap.demo.other', tx).createOwned({ kind: DOC, payload: {} })));
        return { ...row, otherRefused };
      } finally { w.close(); }
    };
    // 两份装配：拥有者不同 ⇒ 同一份用例代码写到不同的命名空间，且非拥有者都被拒
    expect(runOn('kind-a', mk('cap.demo.a', 'dom_demo_a', DOC)))
      .toEqual({ owner: 'cap.demo.a', ns: 'dom_demo_a', otherRefused: 'CAPABILITY_SCOPE_ESCAPE' });
    expect(runOn('kind-b', mk('cap.demo.b', 'dom_demo_b', DOC)))
      .toEqual({ owner: 'cap.demo.b', ns: 'dom_demo_b', otherRefused: 'CAPABILITY_SCOPE_ESCAPE' });
  });

  test('⑤ 用例不持有事务入口（协调权 ≠ 自开事务的权力）', () => {
    const w = world('no-uow');
    try {
      const surface = (o: object): string[] => {
        const out = new Set<string>();
        let cur: object | null = o;
        while (cur && cur !== Object.prototype) {
          for (const n of Object.getOwnPropertyNames(cur)) out.add(n);
          cur = Object.getPrototypeOf(cur) as object | null;
        }
        return [...out].sort();
      };
      const seen = surface(w.intakeUseCase() as object);
      expect(seen.filter((m) => ['uow', 'uowFor', 'port', 'raw', 'kernel', 'namespacedWriter'].includes(m))).toEqual([]);
      expect(seen).toEqual(expect.arrayContaining(['intake', 'tryAdmit', 'admit', 'objectifyRecord', 'intakeAndAdmit']));
    } finally { w.close(); }
  });

  test('已知缺陷 · 已修（D-20，包 2）：appendLedger 判 objectId 归属，正式事件另锁通道', () => {
    // 修前（RE-REVIEW-G1-A §④ 点名的分类错误）：本条用 `expect(code).toBe('NO_REFUSAL')`
    // 把"appendLedger 的 objectId 归属不受检"钉成期望行为，等于给一条 P1 打绿灯。
    // 包 2 修完 D-20 后按报告要求改成**双向断言**（两条都得钉住，缺一即假绿）：
    //   · 普通事件在 scoped 事务里写他人对象 ⇒ `CAPABILITY_SCOPE_ESCAPE`（读侧 E-01 的写侧对称门）；
    //   · 已登记的正式事件类型在**一切**作用域（含 assembly）都不能经通用通道写 ⇒
    //     `EVENT_AUTHORITY_REQUIRED`（唯一入口是归属领域的授权命令 Port，CONTRACTS.md §16.2）。
    // 反向对照必须同时成立，否则"修成一刀切"也能骗绿：
    //   · 普通事件写**自己**对象的台账照常成功；
    //   · 正式事件经命令 Port（`standing.declare`）照常成功。
    const w = world('ledger-gap', [TEST_OBJECT_MODEL, SECOND, TEST_RECORDS]);
    try {
      const foreign = w.uow(ADMIN, (tx) => tx.createObject({ kind: 'test.artifact', payload: { v: 1 } }));
      const own = w.uow(ADMIN, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } }));
      // ① 跨归属普通台账：scoped 事务 ⇒ 拒，且拒绝先于写入（该 oid 名下零 ledger 行）。
      const cross = refusalCode(() => w.uowFor(CAP_OBJECT_MODEL, ADMIN, (tx) => tx.appendLedger({
        eventType: 'synth:foreign-note', objectId: foreign, revision: 1, payload: { note: '别人的对象上记一笔' },
      })));
      expect(cross, 'scoped 事务对他人对象 appendLedger 必须被拒（D-20 归属判据）').toBe('CAPABILITY_SCOPE_ESCAPE');
      expect(w.raw.get<{ c: number }>(
        `select count(*) c from ledger where object_id=? and event_type='synth:foreign-note'`, foreign)!.c)
        .toBe(0);                                             // 拒绝先于写入，不留残留
      // ② 装配作用域写他人对象的普通台账仍可用（协调权，Q40——不许把这条修成一刀切）。
      expect(refusalCode(() => w.uow(ADMIN, (tx) => tx.appendLedger({
        eventType: 'synth:assembly-note', objectId: foreign, revision: 1, payload: {},
      })))).toBe('NO_REFUSAL');
      // ③ 普通事件写自己拥有的对象：照常成功（正例护栏）。
      expect(refusalCode(() => w.uowFor(CAP_OBJECT_MODEL, ADMIN, (tx) => tx.appendLedger({
        eventType: 'synth:own-note', objectId: own, revision: 1, payload: {},
      })))).toBe('NO_REFUSAL');
      // ④ 正式事件类型：连装配作用域都写不动（通道判据与归属判据正交，作用域帮不上忙）。
      expect(refusalCode(() => w.uow(ADMIN, (tx) => tx.appendLedger({
        eventType: 'synth:fact-designation', objectId: foreign, revision: 1,
        payload: { stance: 'ACCEPTED', note: 'AUTHORIZED' },
      })))).toBe('EVENT_AUTHORITY_REQUIRED');
      // ⑤ 同一事件经领域命令 Port（唯一入口）照常落笔——证明上面三条不是过度收紧。
      const standing = w.standingUseCase();
      const seq = w.uow(ADMIN, (tx) => standing.declare(tx, { oid: foreign, revision: 1, stance: 'ACCEPTED' }));
      expect(seq).toBeGreaterThan(0);
      //  ADMIN 无 domain-admission ⇒ 声明保存但不计入投影（PR-A1，判据在领域不在机制）。
      expect(standing.standingAt(foreign, w.ledgerHead()).state).toBe('NOT_ADOPTED');
    } finally { w.close(); }
  });
});
