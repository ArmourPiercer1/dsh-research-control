/**
 * D-28（包 5，席位 G4-A G4A-N9b 实测，P2）：`object_directory` 曾无 DELETE 触发器 ⇒ RD-01 在存储层从未闭合。
 *
 * 席位实测：`REPLACE INTO object_directory` 改 `created_seq`/`owner_capability`/`ns` 成功、
 * `DELETE FROM` 抹身份行成功；换假 owner 后该对象**所有读路径当场 `CAPABILITY_INACTIVE`
 * 且机制内无救济**（UPDATE 被触发器拦 ⇒ 连「改回来」都做不到）。RD-01 注释宣称
 * 「kind/space 创建即固定」，实际只固定了 UPDATE 一形。
 *
 * 修法（CONTRACTS.md §16.2 包 5 存储纪律）：
 * ① `directory_no_delete`：DELETE（含 REPLACE 隐式删除）abort `DIRECTORY_IDENTITY_FROZEN`——
 *    与既有 UPDATE 禁令合成「身份行不可改、不可删」；
 * ② `directory_birth_audited`（INSERT）：**账本非空**的空间里，新身份行必须带一条
 *    `seq = created_seq`、`event_type='object-registered'`、`object_id` 相符的 ledger 行 ⇒
 *    否则 `DIRECTORY_IDENTITY_FROZEN`；`createObject` 的写序改为 ledger 先行。
 * ③ 裁定入契约：**owner 一经登记不可变更**——PoC 内没有任何正当的 owner 变更路径；
 *    `transferRoute` 移交的是「能力→实现/ns」的路由行，不改也不得改目录行。
 *
 * **诚实边界**：ledger 为空的空间不参判据（迁移器/存量库夹具形态——old-schema 攻击资产正是
 * 这一形状，钉死它会撞审查方基线，如实登记）；裸面伪造身份同样可「先落账再插行」，边界与
 * D-27 同构：无痕变有痕，处置归审计。
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../src/harness/paths.ts';
import { openWorld, PRINCIPAL, type World } from '../src/harness/world.ts';
import { asOid } from '../src/contracts/index.ts';

const ALICE = PRINCIPAL('d28alice');
const GRANTS = { d28alice: ['space-write'] };
let dir: string;
beforeAll(() => { dir = mkdtempSync(join(POC_DATA_DIR, 'd28-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

const open = (file: string): World =>
  openWorld({ file, space: 'SP-D28', grants: GRANTS });

const outcome = (fn: () => unknown): string => {
  try { fn(); return 'NO_REFUSAL'; }
  catch (e) {
    const err = e as { code?: unknown; message?: unknown };
    return typeof err?.code === 'string' && err.code !== 'ERR_SQLITE_ERROR' ? err.code : String(err?.message ?? e);
  }
};
const dirRow = (w: World, oid: string) =>
  w.raw.get<{ kind: string; owner_capability: string; ns: string; created_seq: number; space: string }>(
    `select kind, owner_capability, ns, created_seq, space from object_directory where oid=?`, oid)!;

describe('D-28 身份冻结面：目录行不可删、不可整行替换、新身份必须随账出生', () => {
  test('D28-1 席位三式全灭：DELETE 抹行、REPLACE 改 created_seq/owner、REPLACE 换假 owner ⇒ 全部 DIRECTORY_IDENTITY_FROZEN，行一字不变、读面照常', () => {
    const w = open(join(dir, 'd28-1.db'));
    try {
      const oid = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { core: 1 } }));
      const before = dirRow(w, oid);
      // 式 1：DELETE 抹身份行（修前成功 ⇒ 对象从所有读面消失）
      expect(outcome(() => w.raw.run(`delete from object_directory where oid=?`, oid)))
        .toContain('DIRECTORY_IDENTITY_FROZEN');
      // 式 2：REPLACE 伪造出生坐标（修前成功 ⇒ 出生证明整体漂移）
      expect(outcome(() => w.raw.run(
        `replace into object_directory(oid, space, kind, owner_capability, ns, created_seq)
         values(?,'SP-D28','test.claim','cap.test.object-model','dom_test_om',9999)`, oid,
      ))).toContain('DIRECTORY_IDENTITY_FROZEN');
      // 式 3：换假 owner（修前成功 ⇒ 读面当场 CAPABILITY_INACTIVE 且无救济）
      expect(outcome(() => w.raw.run(
        `replace into object_directory(oid, space, kind, owner_capability, ns, created_seq)
         values(?,?,'test.claim','cap.evil.taken','dom_evil',1)`, oid, 'SP-D28',
      ))).toContain('DIRECTORY_IDENTITY_FROZEN');
      // 三式之后：行一字不变，读面照常（席位的「无救济」场景失去地基）
      expect(dirRow(w, oid)).toEqual(before);
      expect(w.readObject(oid)?.payload).toEqual({ core: 1 });
    } finally { w.close(); }
  });

  test('D28-2 出生审计：活跃空间里无 ledger 出生证明的目录行被拒；先落账再插行 = 声明的上限（痕进 append-only H）；createObject 照常（ledger 先行的重排锚）', () => {
    const w = open(join(dir, 'd28-2.db'));
    try {
      const oid = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } }));
      // 正当路径重排后仍绿，且出生证明在位：created_seq 指向真实的 object-registered 行
      const row = dirRow(w, oid);
      expect(w.raw.get<{ c: number }>(
        `select count(*) c from ledger where seq=? and event_type='object-registered' and object_id=?`,
        row.created_seq, oid,
      )!.c).toBe(1);
      // 无出生证明的裸面伪造（账本非空的空间）⇒ 拒
      expect(outcome(() => w.raw.run(
        `insert into object_directory(oid, space, kind, owner_capability, ns, created_seq)
         values('OBJ-D28-GHOST','SP-D28','test.claim','cap.test.object-model','dom_test_om',1)`,
      ))).toContain('DIRECTORY_IDENTITY_FROZEN');
      // 诚实边界：先向 H 落一条 object-registered 再插行 ⇒ 过闸（无痕变有痕）
      const forgedSeq = w.raw.get<{ m: number }>(`select max(seq)+1 m from ledger`)!.m;
      w.raw.run(
        `insert into ledger(seq, space, event_type, actor, object_id, revision, payload_json, recorded_at)
         values(?,'SP-D28','object-registered','forged','OBJ-D28-GHOST',1,'{}',1)`, forgedSeq,
      );
      expect(outcome(() => w.raw.run(
        `insert into object_directory(oid, space, kind, owner_capability, ns, created_seq)
         values('OBJ-D28-GHOST','SP-D28','test.claim','cap.test.object-model','dom_test_om',?)`, forgedSeq,
      ))).toBe('NO_REFUSAL');
    } finally { w.close(); }
  });

  test('D28-3 边界：账本为空的空间不参出生判据（迁移器/存量库夹具形状，old-schema 绿条资产所赖）；该行仍在 ⇒ 打开路径照常接管', () => {
    const file = join(dir, 'd28-3.db');
    const w = open(file);
    w.close(); // 全新库：ledger 为空
    const raw = new DatabaseSync(file);
    try {
      // 无版本标记迁移语义由打开路径负责；出生触发器在空账本上不设卡（如实边界）
      expect(outcome(() => raw.exec(
        `insert into object_directory(oid, space, kind, owner_capability, ns, created_seq)
         values('OBJ-LEGACY-A','SP-D28','test.claim','cap.test.object-model','dom_test_om',7)`,
      ))).toBe('NO_REFUSAL');
    } finally { raw.close(); }
    const w2 = open(file);
    try {
      expect(w2.raw.get<{ c: number }>(
        `select count(*) c from object_directory where oid='OBJ-LEGACY-A'`)!.c).toBe(1);
      // 新写入照常（出生判据在账本转非空后即刻生效）
      const oid = w2.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { n: 1 } }));
      expect(dirRow(w2, oid).created_seq).toBeGreaterThan(0);
    } finally { w2.close(); }
  });

  test('D28-4 裁定锚：owner 一经登记不可变更——变更 owner 的任何形态（UPDATE/REPLACE/删后重插）在存储层全部无门', () => {
    const w = open(join(dir, 'd28-4.db'));
    try {
      const oid = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: {} }));
      const owner = dirRow(w, oid).owner_capability;
      expect(outcome(() => w.raw.run(
        `update object_directory set owner_capability='cap.evil' where oid=?`, oid,
      ))).toContain('DIRECTORY_IDENTITY_FROZEN');   // 既有 UPDATE 禁令（包 4 前即在）
      expect(outcome(() => w.raw.run(`delete from object_directory where oid=?`, oid)))
        .toContain('DIRECTORY_IDENTITY_FROZEN');    // 包 5 新增：删不掉 ⇒ 重插替换无路
      expect(dirRow(w, oid).owner_capability).toBe(owner);
    } finally { w.close(); }
  });
});
