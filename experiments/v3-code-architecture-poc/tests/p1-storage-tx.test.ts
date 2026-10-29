/**
 * P1 — 统一存储与事务原子性（#44 §7.1/§7.3/§7.4、§13.4、§15.1 边界 1）。
 *
 * 全部断言跑在**真实 SQLite 文件**上（`node:sqlite`，实测 3.53.4），不用内存数组假装。
 * 目标不是"CRUD 能跑"，而是证伪/证实四条架构假设：
 *  1. 领域状态 + Directory + History Ledger + Change Journal 能否一次原子提交；
 *  2. 中途失败是否留下部分提交或"幽灵对象"（预留 ID 冒充已存在）；
 *  3. 登记序是否事务性（回滚不得留下被当作已提交的空洞）；
 *  4. 重启后已提交内容是否仍在，未提交内容是否确实消失。
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../src/harness/paths.ts';
import { openWorld, type World } from '../src/harness/world.ts';
import { asOid, type VerifiedPrincipal } from '../src/contracts/index.ts';
import { TEST_OBJECT_MODEL } from '../src/domains/test-object-model.ts';
import { TEST_FACET_CALIB, CAP_FACET, FacetStore } from '../src/domains/test-facet.ts';

const ALICE: VerifiedPrincipal = { actorId: 'alice', verified: true };

describe('P1 单空间跨插件 Unit-of-Work 原子性', () => {
  let dir: string;
  beforeAll(() => { dir = mkdtempSync(join(POC_DATA_DIR, 'p1-')); });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  test('一次事务同时提交领域状态 / Directory / Ledger / Journal', () => {
    const w = openWorld({ file: join(dir, 's1.db'), space: 'SP-1', grants: { alice: ['space-write'] } });
    const out = w.uow(ALICE, (tx) => {
      const oid = tx.createObject({ kind: 'test.claim', payload: { label: 'a' } });
      const seq = tx.appendLedger({ eventType: 'test.annotated', objectId: oid, payload: { note: 'x' } });
      return { oid, seq };
    });

    expect(w.raw.get<{ c: number }>(`select count(*) c from object_directory`)!.c).toBe(1);
    expect(w.raw.get<{ c: number }>(`select count(*) c from domain_state`)!.c).toBe(1);
    expect(w.raw.get<{ c: number }>(`select count(*) c from ledger`)!.c).toBe(2); // created + annotated
    expect(w.raw.get<{ c: number }>(`select count(*) c from journal`)!.c).toBe(1); // 领域写入的变更通知
    expect(out.seq).toBe(2);
    w.close();
  });

  test('事务中途抛错 ⇒ 四者全部回滚，预留 ObjectID 不冒充已存在对象', () => {
    const w = openWorld({ file: join(dir, 's2.db'), space: 'SP-1', grants: { alice: ['space-write'] } });
    let staged = asOid('');
    expect(() =>
      w.uow(ALICE, (tx) => {
        staged = tx.createObject({ kind: 'test.claim', payload: { label: 'ghost' } });
        tx.appendLedger({ eventType: 'test.annotated', objectId: staged, payload: {} });
        throw new Error('注入的中途失败');
      }),
    ).toThrow('注入的中途失败');

    const counts = {
      dir: w.raw.get<{ c: number }>(`select count(*) c from object_directory`)!.c,
      state: w.raw.get<{ c: number }>(`select count(*) c from domain_state`)!.c,
      ledger: w.raw.get<{ c: number }>(`select count(*) c from ledger`)!.c,
      journal: w.raw.get<{ c: number }>(`select count(*) c from journal`)!.c,
    };
    expect(counts).toEqual({ dir: 0, state: 0, ledger: 0, journal: 0 });

    // 登记序必须是事务性的：回滚不能留下被当作已提交的空洞（否则 as-recorded 截点会指向幽灵提交）。
    const next = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { label: 'real' } }));
    // 失败事务没有推进水位：计数器随事务回滚，下一次成功提交仍从 1 开始（无幽灵空洞）。
    expect(w.ledgerHead()).toBe(1); // 唯一一次成功提交的 object-registered
    expect(w.raw.get<{ c: number }>(`select count(*) c from ledger where seq > 1`)!.c).toBe(0);
    expect(w.readObject(next)!.revision).toBe(1);
    w.close();
  });

  test('重启（关闭并重开同一文件）后已提交内容仍在，未提交内容不存在', () => {
    const file = join(dir, 's3.db');
    const w1 = openWorld({ file, space: 'SP-1', grants: { alice: ['space-write'] } });
    const oid = w1.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { label: 'durable' } }));
    try {
      w1.uow(ALICE, (tx) => {
        tx.createObject({ kind: 'test.claim', payload: { label: 'lost' } });
        throw new Error('提交前崩溃');
      });
    } catch { /* 预期失败 */ }
    w1.close();

    const w2 = openWorld({ file, space: 'SP-1', grants: { alice: ['space-write'] } });
    expect(w2.raw.get<{ c: number }>(`select count(*) c from object_directory`)!.c).toBe(1);
    expect(w2.readObject(oid)!.payload.label).toBe('durable');
    expect(w2.raw.get<{ c: number }>(`select count(*) c from domain_state where json_extract(payload_json,'$.label')='lost'`)!.c).toBe(0);
    w2.close();
  });

  test('跨能力单事务：对象 + 扩展记录 + 报告必须同生共死（#44 §7.3）', () => {
    // 一次 UoW 内由**两个不同能力**写入（核心对象走 object-model，扩展记录走 facet 能力），
    // 再加一份检查报告：三者必须落在同一个 SQLite 事务里。
    const w = openWorld({
      file: join(dir, 's3b.db'), space: 'SP-1', grants: { alice: ['space-write'] },
      plugins: [TEST_OBJECT_MODEL, TEST_FACET_CALIB],
    });
    const facets = new FacetStore(w.kernel.faceFor(CAP_FACET));
    const counts = () => w.raw.get<{ a: number; b: number; c: number; d: number }>(
      `select (select count(*) from object_directory) a,
              (select count(*) from domain_state) b,
              (select count(*) from ledger) c,
              (select count(*) from check_report) d`,
    )!;

    const out = w.uow(ALICE, (tx) => {
      const oid = tx.createObject({ kind: 'test.subject', payload: { serial: 'X' } });
      facets.write(tx, oid, { calibration: 'C-1' });          // 另一个能力的持久命名空间
      const r = tx.recordReport({
        target: { kind: 'revision-ref', oid, revision: 1 }, validatorId: 'synth.x', ruleVersion: 'v1',
        schemaVersion: 's', environment: 'e', executedAt: 1, guaranteeScope: 'g', verdict: 'ACHIEVED',
        findings: [], declaredGaps: [],
      });
      return { oid, ...r };
    });
    expect(counts()).toEqual({ a: 1, b: 2, c: 3, d: 1 });        // 核心 1 + 扩展 1；三条登记；一份报告
    expect(w.readObject(out.oid)!.payload.serial).toBe('X');

    // 中途失败：第二个能力已写入之后抛出 ⇒ 全部消失，且第二个能力的命名空间也没留下痕迹
    expect(() => w.uow(ALICE, (tx) => {
      const oid = tx.createObject({ kind: 'test.subject', payload: { serial: 'Y' } });
      facets.write(tx, oid, { calibration: 'C-2' });
      throw new Error('跨能力中途失败');
    })).toThrow('跨能力中途失败');
    expect(counts()).toEqual({ a: 1, b: 2, c: 3, d: 1 });
    expect(w.raw.get<{ c: number }>(`select count(*) c from domain_state where ns='dom_test_facet'`)!.c).toBe(1);
    w.close();
  });

  // ---------- 以下为对抗性探针：不是 TDD 驱动的新行为，而是尝试证伪已声明的架构不变量。
  // 每条探针都配一个"反差锚点"，证明它可能失败（否则绿色不携带信息）。

  test('提交阶段失败（COMMIT 之前抛出）不留任何部分提交', () => {
    const w = openWorld({ file: join(dir, 's4.db'), space: 'SP-1', grants: { alice: ['space-write'] } });
    w.port.failBeforeCommit = new Error('提交阶段失败');
    expect(() => w.uow(ALICE, (tx) => { tx.createObject({ kind: 'test.claim', payload: { label: 'x' } }); })).toThrow('提交阶段失败');
    expect(w.raw.get<{ c: number }>(`select count(*) c from object_directory`)!.c).toBe(0);
    expect(w.ledgerHead()).toBe(0);
    // 反差锚点：同一世界随后能正常提交 ⇒ 前面的零不是"世界根本写不进"
    w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { label: 'y' } }));
    expect(w.raw.get<{ c: number }>(`select count(*) c from object_directory`)!.c).toBe(1);
    w.close();
  });

  test('真实提交冲突：另一连接持写锁时 COMMIT 真失败，且不留部分状态', () => {
    const w = openWorld({ file: join(dir, 's5.db'), space: 'SP-1', grants: { alice: ['space-write'] } });
    const other = w.openSecondConnection();
    other.raw.run(`begin immediate;`);
    other.raw.run(`insert into journal(tx_epoch, ns, oid, op) values(0,'x','y','lock')`);
    // 同一文件上的第二条真实连接已占写锁；busy_timeout 用尽后应失败而非部分提交
    // 钉住失败原因：必须是真实的 SQLITE_BUSY(errcode=5)，否则这条探针可能在为 trivial 的理由通过。
    let busy: { code?: string; errcode?: number; message: string } | undefined;
    try {
      w.uow(ALICE, (tx) => { tx.createObject({ kind: 'test.claim', payload: { label: 'blocked' } }); });
    } catch (e) { busy = e as { code?: string; errcode?: number; message: string }; }
    other.raw.run(`commit;`);
    // 机制层必须给出可判定的语义（可重试），驱动码只作为证据保留在 detail 内。
    expect(busy?.code).toBe('TX_CONTENTION');
    expect((busy as unknown as { detail: Record<string, unknown> }).detail.driverErrcode).toBe(5);
    expect((busy as unknown as { detail: Record<string, unknown> }).detail.retryable).toBe(true);
    expect(w.raw.get<{ c: number }>(`select count(*) c from object_directory where kind='test.claim'`)!.c).toBe(0);
    other.close();
    w.close();
  });

  test('未提交的暂存 ObjectID 对另一条真实连接不可见', () => {
    const w = openWorld({ file: join(dir, 's6.db'), space: 'SP-1', grants: { alice: ['space-write'] } });
    const other = w.openSecondConnection();
    let staged = asOid('');
    try {
      w.uow(ALICE, (tx) => {
        staged = tx.createObject({ kind: 'test.claim', payload: { label: 'staged' } });
        // 另一连接在事务进行中读取
        expect(other.raw.get(`select oid from object_directory where oid=?`, staged)).toBeUndefined();
        throw new Error('保持回滚');
      });
    } catch { /* 预期 */ }
    expect(w.raw.get(`select oid from object_directory where oid=?`, staged)).toBeUndefined();
    other.close();
    w.close();
  });

  test('Ledger 不可变（存储层强制），而 Journal 允许压缩', () => {
    const w = openWorld({ file: join(dir, 's7.db'), space: 'SP-1', grants: { alice: ['space-write'] } });
    w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { label: 'x' } }));
    expect(() => w.raw.run(`update ledger set event_type='tampered' where seq=1`)).toThrow(/HISTORY_IMMUTABLE/);
    expect(() => w.raw.run(`delete from ledger where seq=1`)).toThrow(/HISTORY_IMMUTABLE/);
    // 反差锚点：journal 可删 ⇒ 证明上面的拒绝不是"整库只读"
    expect(() => w.raw.run(`delete from journal where seq=1`)).not.toThrow();
    w.close();
  });

  test('领域事件权威唯一：第二个声明者在同一空间被拒绝装配', () => {
    const dup = {
      pluginId: 'test.second-events', codeVersion: '1', storageNamespace: 'dom_second',
      provides: [{ capability: 'cap.second', contractVersion: 'v1' }], requires: [],
      eventAuthority: 'ledger-payload' as const,
    };
    expect(() =>
      openWorld({ file: join(dir, 's8.db'), space: 'SP-1', plugins: [TEST_OBJECT_MODEL, dup] }),
    ).toThrow(/AMBIGUOUS_AUTHORITY/);
    // 反差锚点：声明为 none 的同插件可以共存 ⇒ 拒绝针对"第二个权威"，不是针对"第二个插件"
    const ok = openWorld({
      file: join(dir, 's8b.db'), space: 'SP-1',
      plugins: [TEST_OBJECT_MODEL, { ...dup, eventAuthority: 'none' }],
    });
    expect(ok.kernel.registry.eventAuthorityMode?.pluginId).toBe('test.object-model');
    ok.close();
  });

  test('无本空间写权 ⇒ 完全拒绝写入，四表零变化', () => {
    const w = openWorld({ file: join(dir, 's9.db'), space: 'SP-1', grants: { alice: ['space-write'] } });
    expect(() => w.uow({ actorId: 'mallory', verified: true }, (tx) => tx.createObject({ kind: 'test.claim', payload: {} })))
      .toThrow(/NO_SPACE_WRITE/);
    expect(w.raw.get<{ c: number }>(`select count(*) c from ledger`)!.c).toBe(0);
    // 反差锚点：同世界同参数换有写权的主体即成功
    w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: {} }));
    expect(w.raw.get<{ c: number }>(`select count(*) c from ledger`)!.c).toBe(1);
    w.close();
  });
});

