/**
 * G1-A 席位回归攻击 —— D-23 / D-24 / D-20 / D-22 四条 P1 的最小复现（**入库版**）。
 *
 * ## 来源标注（诚实声明，先于一切）
 * 本文件**由父代理依据席位 G1-A 报告 `RE-REVIEW-G1-A.md` §「复现命令」与 §「复现片段附录」重写**。
 * 席位原始攻击文件（`g1a-A-write-authority.test.ts`、`g1a-C-events-of-scope.test.ts`、`g1a-B-*` 夹具）
 * 已随其临时 worktree（`.scratch/wt-g1a`、`.scratch/wt-g1a-pre`）删除而下落不明。
 * **本文件不是逐字节复现，而是按其步骤重建**；不冒充席位的原始代码。
 * 每条测试与报告攻击矩阵的对应关系写在各自用例名与就近注释里。
 *
 * ## 判定口径（与外部复审者的要求一致）
 * 断言钉的是**「应该怎样」**，不是「现在怎样」：
 *   · **红 = 该 P1 缺陷仍在**（机制没有做到它声明该做的事）；修好即绿。
 *   · 严禁把越权成功写成 `expect(...).toBe('NO_REFUSAL')` 这类现状断言给洞打绿灯
 *     （报告 §④ 批评过的分类错误）。
 * 唯一例外是 `D-24 正例护栏` 一条：它钉的是**合法路径必须继续可用**（Q45），今天应绿；
 * 它的作用是阻止"把 D-24 修成一刀切按 oid 主能力拒绝"这种过度收紧的假修法。
 *
 * ## 四条 P1 与本报告矩阵的对应
 *   · **D-23**（报告 N1；A-10 / A-12 / A-12b / A-12c）——事务句柄在事务结束后仍可写。
 *       - 红条 1：装配路径 `uow()` 回调返回后的旧句柄写入必须被拒（临时修法：句柄失效位，
 *         后续写面入口查 closed ⇒ 新码 `TX_CLOSED`）。
 *       - 红条 2：uowFor 领域路径同形态（A-12c：不是只有装配根能做）。
 *       - 红条 3：**存量悬空 required 边不得阻塞无关主体的后续合法提交**。
 *         本条刻意**不**经由旧句柄造边（用装配根未守卫面直插，模拟"脏边已经以某种方式
 *         存在"——旧句柄迟到写、历史缺陷、存量数据都算）。因此**只做红条 1/2 的句柄失效修法
 *         不会让它转绿**：它要等 `checkRequiredRefs` 停止提交前全表重扫（改为"新增引用在所属
 *         事务内验证，存量完整性走打开期/迁移/审计路径"）才转绿。这是特性不是 bug——
 *         外部复审者已明确全表重扫不该是长期架构，本条守的是**最恶性的那条后果**（空间级、
 *         append-only 删不掉、重开库仍阻塞，报告 A-12/B-⑦），与"洞怎么被塞进来"正交。
 *   · **D-24**（报告 N2；A-1 / A-2 / A-13 / A-14）——`NamespaceWriter.write()` 从不判 oid。
 *       - 红条：幽灵 oid（不在 object_directory）的状态行必须被拒（报告修复方向：「oid 不在
 *         目录 ⇒ 拒（现在完全不查）」）。
 *       - 红条：修订级 required 判据必须按**归属命名空间**归因——我在自己 ns 里伪造的
 *         victim@rev99 行不得被算作"victim 存在第 99 修订"（`kernel.ts` 修订判据不带 ns）。
 *       - 正例护栏（今天应绿）：Facet 能力把扩展记录挂到**他人拥有的核心对象**上（Q45 合法
 *         形态，作者测试 `p1-storage-tx` / `p2-identity-plugin` 均钉此行为必须绿）必须继续成功。
 *       - **实测发现（写进基线定性时用得上）**：PoC 里合法 Facet 挂载与 A-2 伪造行在
 *         `write()` 入口**同为一种行形态**（ns=自己、oid=他人核心对象、任意 revision），
 *         机制层没有任何"挂载登记"能把二者区分开。因此本报告**不**断言"write() 对他人 oid
 *         一律拒"——那会撞 Q45（正例会红）；D-24 的完整修法需要显式的扩展挂载声明机制，
 *         这一缺口本身就是修法必须回应的问题。
 *   · **D-20**（报告 A-6）——`appendLedger` 不判 objectId 归属：无关能力 + 无 `domain-admission`
 *       的主体伪造一条 `synth:fact-designation(note=AUTHORIZED)` 即把他对象的采纳投影翻成
 *       `ADOPTED`。红条钉**投影不得被伪造声明翻转**（对照锚点：走正当入口，未授权主体只得到
 *       `AUTHORITY_UNVERIFIED` 且不进投影）。
 *   · **D-22**（报告 A-8 / A-8b）——装配根交入领域对象的全权事务可经运行时面取回
 *       （TS `private readonly` 参数属性 = 运行时自有可枚举字段，本仓 D-17/P2-2 同一条教训）。
 *       红条钉**结果**：无论句柄可达与否，经它跨归属 `revise` 必须被拒、他人权威数据必须无恙。
 *
 * ## 红→绿验证配方（每条红都已在一次性 worktree 实测转绿，还原见 EVIDENCE/回报）
 *   · D-23 红条 1/2：`Kernel.uow` 在 `fn(tx)` 完成后把该 `UnitOfWorkImpl` 记入模块级
 *     `WeakSet`（closed），`createObject/revise/linkRef/appendLedger/recordReport` 入口先查 ⇒ `TX_CLOSED`。
 *   · D-23 红条 3：`checkRequiredRefs` 只校验**本事务新写的边**（不再全表扫 `where required=1`）。
 *   · D-24 红条：write() 拒绝不在 object_directory 的 oid；修订级判据按归属 ns 归因。
 *   · D-20 红条：scoped 事务的 `appendLedger` 走与 `revise` 相同的 `#assertScope(owner)`。
 *   · D-22 红条：`ValidationService.runIn` 改为 `#runIn` 私有字段（运行时无该名字）。
 *
 * 纪律：不改 `src/**`、`tests/**`；本文件在 `attacks/review/`（tsconfig include 之外，
 * 不被 `tsc -p` 收集），只被 attacks 下的 vitest 收集并进 g0-gate 基线。
 */
import { describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../../src/harness/paths.ts';
import { openWorld, PRINCIPAL, type World } from '../../src/harness/world.ts';
import type { UnitOfWork } from '../../src/kernel/kernel.ts';
import { asOid } from '../../src/contracts/index.ts';
import { CAP_RECORDS, FactStandingPolicy, TEST_RECORDS, ValidationService } from '../../src/domains/test-records.ts';
import { CAP_OBJECT_MODEL, TEST_OBJECT_MODEL } from '../../src/domains/test-object-model.ts';
import { CAP_FACET, FacetStore, TEST_FACET_CALIB } from '../../src/domains/test-facet.ts';

/** 装配根主体：机制写权 + 运维权威 + 业务授权（报告附录共同夹具的 'adm'）。 */
const ADM = PRINCIPAL('g1ar-adm');
/** 有 space-write、**无** domain-admission：D-20 的伪造主体（报告附录 'nobody'）。 */
const NOBODY = PRINCIPAL('g1ar-nobody');
/** 与攻击者无关的第三方写主体：D-23 红条 3 用它证明"无辜提交被拒"是空间级阻塞。 */
const OTHER = PRINCIPAL('g1ar-other');

const GRANTS = {
  'g1ar-adm': ['space-write', 'capability-admin', 'domain-admission'],
  'g1ar-nobody': ['space-write'],
  'g1ar-other': ['space-write'],
};

/** 共同夹具：openWorld + 三个能力（对象模型 / 记录 / Facet），一测试一库一世界。 */
function open(prefix: string): { dir: string; w: World } {
  const dir = mkdtempSync(join(POC_DATA_DIR, prefix));
  const w = openWorld({
    file: join(dir, 's.db'), space: 'SP-G1AR', grants: GRANTS,
    plugins: [TEST_OBJECT_MODEL, TEST_RECORDS, TEST_FACET_CALIB],
  });
  return { dir, w };
}

/** 报告附录的 `code(fn)`：跑 fn，返回 Refusal.code；抛非 Refusal ⇒ OTHER:<类型>；没抛 ⇒ NO_REFUSAL。 */
function code(fn: () => unknown): string {
  try { fn(); return 'NO_REFUSAL'; }
  catch (e) {
    const c = (e as { code?: unknown })?.code;
    return typeof c === 'string' ? c : `OTHER:${e instanceof Error ? e.constructor.name : String(e)}`;
  }
}

describe('G1-A 回归（D-23/D-24/D-20/D-22 钉理想行为，红=缺陷仍在）', () => {
  // ───────────────────────────── D-23（报告 N1）─────────────────────────────

  test('D-23 装配路径：事务回调返回后旧句柄的写入必须被拒，迟到修订不得落库', () => {
    const { dir, w } = open('g1ar-d23a-');
    try {
      let stale: UnitOfWork | undefined;
      w.uow(ADM, (tx) => { stale = tx; });              // 这条事务已经结束（已提交）
      const mine = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } }));
      const c = code(() => stale!.revise(mine, { payload: { late: 'WRITE' } }));
      expect(c, 'D-23（A-10/A-12）：uow 回调返回即事务结束——被扣住的 UnitOfWork 句柄必须失效，'
        + '此后任何写入必须被拒绝（形如 TX_CLOSED），而不是经 SQLite autocommit 直接落库').not.toBe('NO_REFUSAL');
      // "应该怎样"的第二锚点：库面不得收到迟到数据 ⇒ 最新修订仍是 1。
      expect(w.readObject(mine)!.revision,
        'D-23：迟到写不得落库 ⇒ 快照最新修订必须仍为 1').toBe(1);
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('D-23 领域路径：uowFor 被扣住的 scoped 事务句柄在回调返回后同样必须被拒', () => {
    const { dir, w } = open('g1ar-d23b-');
    try {
      let stale: UnitOfWork | undefined;
      w.uowFor(CAP_OBJECT_MODEL, ADM, (tx) => { stale = tx; });   // 领域侧 scoped 事务，已结束
      const c = code(() => stale!.createObject({ kind: 'test.claim', payload: { late: 'DOMAIN' } }));
      expect(c, 'D-23（A-12c）：不是只有装配根能扣句柄——uowFor 交出的作用域收窄事务同样必须有生命周期执行点').not.toBe('NO_REFUSAL');
      expect((w.raw.get<{ c: number }>(`select count(*) c from ledger where event_type='object-registered'`) ?? { c: -1 }).c,
        'D-23：事务结束后的 createObject 不得在 H 里留下登记事件').toBe(0);
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('D-23 后果锁：存量悬空 required 边不得阻塞无关主体的后续合法提交（直到判据不再全表重扫）', () => {
    const { dir, w } = open('g1ar-d23c-');
    try {
      const mine = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } }));
      // 刻意**不**走旧句柄：用装配根未守卫面直插一条 required 悬空边，模拟"脏边已经存在"
      // （旧句柄迟到写只是产生它的路径之一；历史缺陷、存量数据同形）。本条守的是后果，不是入口。
      w.raw.run(
        `insert into ref_edge(from_oid, from_rev, to_oid, to_rev, to_record, role, required) values(?,?,?,?,?,?,?)`,
        mine, 1, null, null, 'REC-G1AR-NEVER-DECLARED', 'g1ar-legacy-dangling', 1,
      );
      // 第三方主体提交一笔与本条边毫无关系的合法事务：
      const innocent = code(() => w.uow(OTHER, (tx) => tx.createObject({ kind: 'test.subject', payload: { serial: 'innocent' } })));
      expect(innocent, 'D-23（A-12/B-⑦）：提交期判据对**全表** required 边重扫 ⇒ 一条存量脏边拒绝此后'
        + '任何人的任何提交（append-only 删不掉、重开库仍阻塞 = 不可自愈的空间级 DoS）。'
        + '机制声明"硬引用在事务内确实存在，否则整体回滚"只对**本事务**的引用成立；'
        + '无关主体的合法提交必须成功。本条在只做句柄失效（红条 1/2 的修法）后仍应保持红，'
        + '直到 checkRequiredRefs 把新增引用改为事务内验证、存量完整性另走打开期/迁移/审计路径'
      ).toBe('NO_REFUSAL');
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  // ───────────────────────────── D-24（报告 N2）─────────────────────────────

  test('D-24 幽灵 oid：write() 写不在 object_directory 的 oid 必须被拒且零残留', () => {
    const { dir, w } = open('g1ar-d24a-');
    try {
      const ghost = asOid('OBJ-G1AR-GHOST');
      const c = w.uow(ADM, (tx) => {
        const wr = w.kernel.faceFor(CAP_FACET).writerFor(tx);   // Facet 能力的窄面端口
        return code(() => wr.write({ ns: wr.ns, oid: ghost, revision: 1, payload: { forged: true }, eventType: 'extension-registered' }));
      });
      expect(c, 'D-24（A-1/A-3）：oid 根本不在 object_directory——没有任何对象拥有它，'
        + '也没有任何合法的扩展挂载能指向它。write() 现在完全不查目录，幽灵行照落').not.toBe('NO_REFUSAL');
      expect((w.raw.get<{ c: number }>(`select count(*) c from domain_state where oid=?`, ghost) ?? { c: -1 }).c,
        'D-24：被拒的写入不得留下 domain_state 行').toBe(0);
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('D-24 修订归因：required 引用必须按归属命名空间判修订存在——伪造 rev99 行不得使其提交成功', () => {
    const { dir, w } = open('g1ar-d24b-');
    try {
      const victim = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } })); // 真实只有 rev1，归对象模型
      const mine = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } }));
      // 攻击步骤（该步本身应被拒——见文件头"挂载登记缺口"；两种结局都接受，本条只钉提交期判据）：
      // 在 Facet 自己的 ns 里给 victim 种一条伪造的 rev99 状态行。
      w.uow(ADM, (tx) => {
        const wr = w.kernel.faceFor(CAP_FACET).writerFor(tx);
        try { wr.write({ ns: wr.ns, oid: victim, revision: 99, payload: { forged: 1 }, eventType: 'extension-registered' }); }
        catch { /* 修法落地后这里应当抛——伪造被拒同样是本条期望的世界状态 */ }
      });
      const c = code(() => w.uow(ADM, (tx) => tx.linkRef({
        from: { kind: 'revision-ref', oid: mine, revision: 1 },
        to: { kind: 'revision-ref', oid: victim, revision: 99 },   // victim 的归属 ns 里不存在第 99 修订
        role: 'g1ar-forged', required: true,
      })));
      expect(c, 'D-24（A-2）：RD-05 精确引用 = "该对象在其归属命名空间里确有该修订"。'
        + '提交期修订判据不带 ns ⇒ 我在 dom_test_facet 里伪造的行被判"存在"，'
        + 'required 边静默提交。应判 REQUIRED_REF_MISSING').toBe('REQUIRED_REF_MISSING');
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('D-24 正例护栏：Facet 把扩展记录挂载到他人拥有的核心对象（Q45 合法形态）必须继续成功', () => {
    const { dir, w } = open('g1ar-d24p-');
    try {
      const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.subject', payload: { serial: 'G1A-Q45' } }));
      const facets = new FacetStore(w.kernel.faceFor(CAP_FACET));
      const c = code(() => w.uow(ADM, (tx) => facets.write(tx, oid, { calibration: 'C-1' })));
      expect(c, 'D-24 正例护栏：Q45/#44 §6.2——Instrument(Facet) 能力的扩展记录**本来就**要以核心对象的 oid '
        + '落在自己的能力命名空间里（作者测试 p1-storage-tx/p2-identity-plugin 同样钉此行为必须绿）。'
        + '把 D-24 修成"write() 一律要求 oid 的主能力=写入能力"会当场打断这条路'
      ).toBe('NO_REFUSAL');
      expect(facets.read(oid)!.payload.calibration, 'D-24 正例护栏：扩展记录必须按扩展修订序列可读').toBe('C-1');
      expect(w.readObject(oid)!.payload.serial, 'D-24 正例护栏：扩展挂载不得改写核心权威数据').toBe('G1A-Q45');
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  // ───────────────────────────── D-20（报告 A-6）─────────────────────────────

  test('D-20 投影翻转：appendLedger 必须核对 objectId 归属——伪造声明不得把他人对象的采纳投影翻成 ADOPTED', () => {
    const { dir, w } = open('g1ar-d20-');
    try {
      const victim = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } }));
      const policy = new FactStandingPolicy(w.kernel.faceFor(CAP_RECORDS), w.authority);
      // 对照锚点（现状也成立，不是现状断言而是前提）：无声明 ⇒ NOT_ADOPTED。
      expect(policy.standingAt(victim, w.kernel.head).state, 'D-20 前提：伪造之前必须是 NOT_ADOPTED').toBe('NOT_ADOPTED');
      // 攻击：无关能力（Facet 作用域）+ 无 domain-admission 的主体，直投一条"看起来已过授权"的声明。
      code(() => w.uowFor(CAP_FACET, NOBODY, (tx) => tx.appendLedger({
        eventType: 'synth:fact-designation', objectId: victim, revision: 1,
        payload: { stance: 'ACCEPTED', by: 'nobody', note: 'AUTHORIZED' },
      })));
      expect(policy.standingAt(victim, w.kernel.head).state,
        'D-20（A-6）：走正当入口，同一未授权主体只能得到 AUTHORITY_UNVERIFIED 且不进投影（PR-A1）；'
        + '而 appendLedger 对 objectId 归属零核对 ⇒ 任何能力都能替别人的对象伪造"已授权"，'
        + '把业务投影翻成 ADOPTED。机制必须核对归属（或投影不信任裸 note），投影必须保持 NOT_ADOPTED'
      ).toBe('NOT_ADOPTED');
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  // ───────────────────────────── D-22（报告 A-8/A-8b）─────────────────────────────

  test('D-22 装配根全权事务泄漏：领域实例经运行时面取回 runIn 不得完成跨归属改写', () => {
    const { dir, w } = open('g1ar-d22-');
    try {
      const victim = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { text: 'ORIGINAL', v: 1 } }));
      // 装配根现状接线（src/domains/test-records.ts 的 ValidationService.runIn 即此形态）：
      const svc = new ValidationService(w.kernel.faceFor(CAP_RECORDS), (fn) => w.uow(ADM, fn), (r) => w.readRevision(r));
      // TS `private readonly` 参数属性在运行时是自有可枚举字段（D-17/P2-2 的同一条教训，A-8 重犯处）：
      const runIn = (svc as unknown as Record<string, unknown>).runIn as (<R>(fn: (tx: UnitOfWork) => R) => R) | undefined;
      const c = runIn
        ? code(() => runIn((tx) => tx.revise(victim, { payload: { text: 'REWRITTEN-BY-DOMAIN' } })))
        : 'HANDLE_NOT_AT_RUNTIME';
      expect(c, 'D-22（A-8）：装配根交进领域对象的全权事务（scope=assembly）要么在运行时面上不可达'
        + '（#私有字段/WeakMap），要么收窄为能力作用域事务——现状两者皆无：字段可枚举、事务全权，'
        + '跨归属 revise 直接成功。本条钉结果：拒绝或句柄不可得，二者必居其一').not.toBe('NO_REFUSAL');
      expect((w.readObject(victim)!.payload as Record<string, unknown>).text,
        'D-22：他人权威数据必须保持原样（CONTRACTS §16 的"墙"至少要真的存在）').toBe('ORIGINAL');
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
