/**
 * D-23 / D-24 作者侧回归（外部复审第四轮"包 1：事务与存储完整性"）。
 *
 * 与 `attacks/review/g1a-regression.test.ts`（审查方钉"应该怎样"）的分工：那边判**缺陷是否仍在**，
 * 本文件判**修法自身的承诺面**——精确拒绝码、三形终结（提交/回滚/提交期抛错）、读写同权、
 * 增量提交期判据 + 审计承接、以及"审计不在插件可见面"的运行时证据。
 * 纪律照 §15.4：每个拒绝形态都配正例锚点，防"用拒绝把合法路径一并废掉"的假修法。
 */
import { describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../src/harness/paths.ts';
import { openWorld, PRINCIPAL, type World } from '../src/harness/world.ts';
import { Kernel, type NamespaceWriter, type UnitOfWork } from '../src/kernel/kernel.ts';
import { SqlitePort } from '../src/storage-sqlite/sqlite-port.ts';
import { asOid, asSpaceId } from '../src/contracts/index.ts';
import { CAP_OBJECT_MODEL, TEST_OBJECT_MODEL } from '../src/domains/test-object-model.ts';
import { CAP_FACET, TEST_FACET_CALIB } from '../src/domains/test-facet.ts';

const ADM = PRINCIPAL('d234-adm');
const OTHER = PRINCIPAL('d234-other');
const GRANTS = { 'd234-adm': ['space-write'], 'd234-other': ['space-write'] };

function open(prefix: string): { dir: string; w: World } {
  const dir = mkdtempSync(join(POC_DATA_DIR, prefix));
  const w = openWorld({
    file: join(dir, 's.db'), space: 'SP-D234', grants: GRANTS,
    plugins: [TEST_OBJECT_MODEL, TEST_FACET_CALIB],
  });
  return { dir, w };
}

const code = (fn: () => unknown): string => {
  try { fn(); return 'NO_REFUSAL'; }
  catch (e) {
    const c = (e as { code?: unknown })?.code;
    return typeof c === 'string' ? c : `OTHER:${e instanceof Error ? e.constructor.name : String(e)}`;
  }
};

/** 沿原型链收集运行时成员（与 arch-independence 同一手法，own + prototype 全量）。 */
const surface = (x: object): string[] => {
  const out = new Set<string>();
  let cur: object | null = x;
  while (cur && cur !== Object.prototype) {
    for (const k of Object.getOwnPropertyNames(cur)) out.add(k);
    cur = Object.getPrototypeOf(cur) as object | null;
  }
  return [...out].sort();
};

describe('D-23① 事务终结：TX_CLOSED 覆盖所有派生句柄（读写同权，三形同判）', () => {
  test('装配路径：提交后的旧句柄写被拒（精确码 TX_CLOSED），库面零迟到', () => {
    const { dir, w } = open('d234-a-');
    try {
      let stale: UnitOfWork | undefined;
      const oid = w.uow(ADM, (tx) => { stale = tx; return tx.createObject({ kind: 'test.claim', payload: { v: 1 } }); });
      expect(code(() => stale!.revise(oid, { payload: { late: 1 } }))).toBe('TX_CLOSED');
      expect(w.readObject(oid)!.revision).toBe(1);
      // 只读入口同样受限（CONTRACTS §16.1：终结后读写一律 TX_CLOSED，不返回"新世界的当前值"冒充事务视图）
      expect(code(() => stale!.readLatest(oid))).toBe('TX_CLOSED');
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('回滚形：回调抛错后句柄同样终结；迟到写不得以"重试"名义经 autocommit 落库', () => {
    const { dir, w } = open('d234-b-');
    try {
      let stale: UnitOfWork | undefined;
      expect(() => w.uow(ADM, (tx) => {
        stale = tx;
        tx.createObject({ kind: 'test.claim', payload: { v: 1 } });
        throw new Error('boom');
      })).toThrow(/boom/);
      expect(code(() => stale!.createObject({ kind: 'test.claim', payload: { v: 2 } }))).toBe('TX_CLOSED');
      expect(w.raw.get<{ c: number }>(`select count(*) c from object_directory`)!.c).toBe(0);
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('提交期抛错形：failBeforeCommit 注入提交失败 ⇒ 句柄仍终结（三形同判）', () => {
    const dir = mkdtempSync(join(POC_DATA_DIR, 'd234-c-'));
    const port = new SqlitePort({ file: join(dir, 's.db') });
    const k = new Kernel(asSpaceId('SP-D234C'), port, { can: () => true });
    try {
      k.registry.register(TEST_OBJECT_MODEL);
      k.activate();
      // 注入必须晚于 activate（activate 自己走 port.tx 登记路由，会先吃掉注入位）
      port.failBeforeCommit = new Error('injected-commit-failure');
      let stale: UnitOfWork | undefined;
      expect(() => k.uow(ADM, (tx) => { stale = tx; tx.createObject({ kind: 'test.claim', payload: { v: 1 } }); }))
        .toThrow(/injected-commit-failure/);
      expect(code(() => stale!.createObject({ kind: 'test.claim', payload: { v: 2 } }))).toBe('TX_CLOSED');
      expect(port.read((r) => r.get<{ c: number }>(`select count(*) c from object_directory`)!.c)).toBe(0);
    } finally { port.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('迟到写全家桶：领域 scoped 句柄、旧句柄上事后建立的 writer、以及 writer 本身一律 TX_CLOSED', () => {
    const { dir, w } = open('d234-d-');
    try {
      let staleScoped: UnitOfWork | undefined;
      w.uowFor(CAP_OBJECT_MODEL, ADM, (tx) => { staleScoped = tx; });
      expect(code(() => staleScoped!.createObject({ kind: 'test.claim', payload: {} }))).toBe('TX_CLOSED');

      let stale: UnitOfWork | undefined;
      w.uow(ADM, (tx) => { stale = tx; });
      // 迟到写形态①：writerFor(旧句柄) —— 端口根本不得建立
      expect(code(() => w.kernel.faceFor(CAP_FACET).writerFor(stale!))).toBe('TX_CLOSED');
      // 迟到写形态②：提交前建立、提交后使用的 writer —— 写入口判同一本事务账
      let wr: NamespaceWriter | undefined;
      const oid = w.uow(ADM, (tx) => { wr = w.kernel.faceFor(CAP_FACET).writerFor(tx);
        return tx.createObject({ kind: 'test.claim', payload: { v: 1 } }); });
      expect(code(() => wr!.write({ ns: wr!.ns, oid, revision: 1, payload: { late: true }, eventType: 'extension-registered' }))).toBe('TX_CLOSED');
      // 双写组合形（READINESS D-23 行的 Q40 形态）：第一条迟到写被拒后**再次**迟到写，
      // 不得出现"第一笔拒、第二笔进"的半落库——首写即拒使组合形整体不可达，两笔都要有回执。
      expect(code(() => wr!.write({ ns: wr!.ns, oid, revision: 2, payload: { late: 'again' }, eventType: 'extension-registered' }))).toBe('TX_CLOSED');
      expect(code(() => stale!.revise(oid, { payload: { late: 'combo' } }))).toBe('TX_CLOSED');
      expect(w.raw.get<{ c: number }>(`select count(*) c from domain_state where ns='dom_test_facet'`)!.c).toBe(0);
      expect(w.readObject(oid)!.revision).toBe(1);
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('D-23② 提交期增量验证 + 审计承接（存量损坏不阻塞无关提交）', () => {
  test('本事务自己的悬空 required 边仍被当场拒绝且整体回滚（增量≠放松）', () => {
    const { dir, w } = open('d234-e-');
    try {
      const o = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: {} }));
      expect(code(() => w.uow(ADM, (tx) => tx.linkRef({
        from: { kind: 'revision-ref', oid: o, revision: 1 },
        to: { kind: 'record-ref', recordId: 'REC-D234-NEVER' }, role: 'd234-own', required: true,
      })))).toBe('REQUIRED_REF_MISSING');
      expect(w.raw.get<{ c: number }>(`select count(*) c from ref_edge`)!.c).toBe(0);
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('linkOwned 经 #scoped 瞬时实例写的 required 边同样入账（最易漏的旁路）', () => {
    const { dir, w } = open('d234-f-');
    try {
      const c = code(() => w.uowFor(CAP_OBJECT_MODEL, ADM, (tx) => {
        const wr = w.kernel.faceFor(CAP_OBJECT_MODEL).writerFor(tx);
        const o = wr.createOwned({ kind: 'test.claim', payload: {} });
        wr.linkOwned({
          from: { kind: 'revision-ref', oid: o, revision: 1 },
          to: { kind: 'record-ref', recordId: 'REC-D234-NEVER' }, role: 'd234-scoped', required: true,
        });
      }));
      // 若 #scoped 的边漏出增量账，这里会以"提交成功"（NO_REFUSAL）的形式假绿
      expect(c).toBe('REQUIRED_REF_MISSING');
      expect(w.raw.get<{ c: number }>(`select count(*) c from ref_edge`)!.c).toBe(0);
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('存量悬空边不阻塞无关主体的合法提交；auditRequiredIntegrity 如实报告它（正例锚：干净库报零）', () => {
    const { dir, w } = open('d234-g-');
    try {
      const clean = w.kernel.auditRequiredIntegrity();
      // 包 6（C2 补漏）回执加宽：softChecked/softGhosts 覆盖 required:false 的目标存在性——只报不阻塞
      expect(clean, '正例锚点：干净库必须报零违规（否则审计是恒红噪音）').toEqual({ checked: 0, violations: [], softChecked: 0, softGhosts: 0 });
      const o = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: {} }));
      // 用装配根未守卫面直插存量脏边（与"旧句柄迟到写"同形，机制层无从区分来源）
      w.raw.run(
        `insert into ref_edge(from_oid, from_rev, to_oid, to_rev, to_record, role, required) values(?,?,?,?,?,?,?)`,
        o, 1, null, null, 'REC-D234-NEVER', 'd234-legacy', 1,
      );
      expect(code(() => w.uow(OTHER, (tx) => tx.createObject({ kind: 'test.subject', payload: {} }))),
        '后果锁（作者侧镜像）：存量脏边不得拒绝无辜主体的合法提交').toBe('NO_REFUSAL');
      const audit = w.kernel.auditRequiredIntegrity();
      expect(audit.checked).toBe(1);
      expect(audit.violations).toEqual([
        { code: 'REQUIRED_REF_MISSING', detail: { from: o, role: 'd234-legacy', to: 'REC-D234-NEVER' } },
      ]);
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('审计与提交期共用归属 ns 判据：他 ns 伪造的修订行在审计里同样是 revision 级违规（D-24②）', () => {
    const { dir, w } = open('d234-h-');
    try {
      const victim = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } }));
      w.raw.run(`insert into domain_state(ns, oid, revision, payload_json, recorded_seq, contract_version)
                 values('dom_test_facet',?,?,?,0,'v1')`, victim, 99, '{}');
      w.raw.run(
        `insert into ref_edge(from_oid, from_rev, to_oid, to_rev, to_record, role, required) values(?,?,?,?,?,?,?)`,
        victim, 1, victim, 99, null, 'd234-forged-rev', 1,
      );
      const audit = w.kernel.auditRequiredIntegrity();
      expect(audit.violations).toEqual([
        { code: 'REQUIRED_REF_MISSING', detail: { from: victim, role: 'd234-forged-rev', to: victim, revision: 99, level: 'revision' } },
      ]);
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('D-24 write() 无歧义面与插件可见面证据', () => {
  test('幽灵 oid（不在 object_directory）的状态行以 NOT_FOUND_IN_SPACE 拒绝，零残留', () => {
    const { dir, w } = open('d234-i-');
    try {
      const ghost = asOid('OBJ-D234-GHOST');
      const c = w.uow(ADM, (tx) => {
        const wr = w.kernel.faceFor(CAP_FACET).writerFor(tx);
        return code(() => wr.write({ ns: wr.ns, oid: ghost, revision: 1, payload: { forged: true }, eventType: 'extension-registered' }));
      });
      expect(c).toBe('NOT_FOUND_IN_SPACE');
      expect(w.raw.get<{ c: number }>(`select count(*) c from domain_state where oid=?`, ghost)!.c).toBe(0);
      expect(w.raw.get<{ c: number }>(`select count(*) c from ledger where object_id=?`, ghost)!.c).toBe(0);
      expect(w.raw.get<{ c: number }>(`select count(*) c from journal where oid=?`, ghost)!.c).toBe(0);
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('正例锚点：合法 Facet 挂载（他人核心对象、目录内 oid）继续成功——两面无歧义判据不得误伤 Q45', () => {
    const { dir, w } = open('d234-j-');
    try {
      const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.subject', payload: { serial: 'OK' } }));
      const c = w.uow(ADM, (tx) => {
        const wr = w.kernel.faceFor(CAP_FACET).writerFor(tx);
        return code(() => wr.write({ ns: wr.ns, oid, revision: 1, payload: { calibration: 'C-1' }, eventType: 'extension-registered' }));
      });
      expect(c).toBe('NO_REFUSAL');
      expect(w.kernel.readNamespaced(CAP_FACET, oid)?.payload.calibration).toBe('C-1');
      expect(w.readObject(oid)!.payload.serial).toBe('OK');
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('auditRequiredIntegrity 不在插件可见面：face / writer / uow 成员清单为封闭集且不含它', () => {
    const { dir, w } = open('d234-k-');
    try {
      // PluginFace 的运行时封闭集（与 HEAD 前后对拍为空 diff 的实证另见回报）
      expect(surface(w.kernel.faceFor(CAP_FACET) as object))
        .toEqual(['capability', 'eventsOf', 'readOwn', 'revisionOf', 'space', 'writerFor']);
      const surfaces = w.uow(ADM, (tx) => ({
        writer: surface(w.kernel.faceFor(CAP_FACET).writerFor(tx)),
        uow: surface(tx as object),
      }));
      for (const [name, s] of Object.entries(surfaces)) {
        expect(s, `${name} 不得携带 Kernel 运维/审计成员`).not.toContain('auditRequiredIntegrity');
        for (const m of ['uow', 'uowFor', 'port', 'raw', 'kernel', 'namespacedWriter', 'transferRoute', 'setRouteEnabled']) {
          expect(s, `${name} 不得携带 ${m}`).not.toContain(m);
        }
      }
      // Kernel 面上它确实存在（存在性 + 不可达性成对断言，缺一即假绿）
      expect(surface(w.kernel)).toContain('auditRequiredIntegrity');
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
