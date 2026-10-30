/**
 * N9（包 4，席位 G3-A A2-5）：`INSERT OR REPLACE` 曾**静默整行替换**历史行——
 * SQLite 语义里 REPLACE 冲突消解的隐式删除**仅在 `recursive_triggers=ON` 时才触发 DELETE 触发器**
 * （默认 OFF），端口未开 ⇒ 同 seq 的「未授权 g3nobody 行」可被换成「授权行」，投影翻 ADOPTED，
 * append-only 核心不变量在一条普通 SQL 形态下失效。可达面 = 装配裸面/运维（插件句柄拿不到 raw），
 * 非越权，但必须封（CONTRACTS.md §16.2 包 4 存储纪律）。
 * 本文件两条腿：① 裸面 REPLACE **必须失败且原行不变**（PRAGMA 腿，实测）；
 * ② 机制守卫句柄把 `insert or replace`/`replace into` 登记为被禁写法（guard 纵深腿）。
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../src/harness/paths.ts';
import { openWorld, PRINCIPAL, type World } from '../src/harness/world.ts';
import { TEST_OBJECT_MODEL } from '../src/domains/test-object-model.ts';
import { CAP_RECORDS, TEST_RECORDS, FACT_DESIGNATION_EVENT, FACT_DESIGNATION_SCHEMA, FACT_STANDING_POLICY_VERSION } from '../src/domains/test-records.ts';
import { SqlitePort } from '../src/storage-sqlite/sqlite-port.ts';
import { asOid } from '../src/contracts/index.ts';

const ADM = PRINCIPAL('n9adm');     // space-write + capability-admin + domain-admission
const NOBODY = PRINCIPAL('n9nobody'); // 只有 space-write：签出来的行见证 false
const GRANTS = {
  n9adm: ['space-write', 'capability-admin', 'domain-admission'],
  n9nobody: ['space-write'],
};
let dir: string;
beforeAll(() => { dir = mkdtempSync(join(POC_DATA_DIR, 'n9-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

const open = (name: string): World =>
  openWorld({ file: join(dir, `${name}.db`), space: 'SP-N9', grants: GRANTS,
    plugins: [TEST_OBJECT_MODEL, TEST_RECORDS] });

/** 触发器 abort 的文本在 message 里（node:sqlite 的 code 恒为 ERR_SQLITE_ERROR——G3-A 同法）。 */
const outcome = (fn: () => unknown): string => {
  try { fn(); return 'NO_REFUSAL'; }
  catch (e) {
    const err = e as { code?: unknown; message?: unknown };
    const c = typeof err?.code === 'string' && err.code !== 'ERR_SQLITE_ERROR' ? err.code : String(err?.message ?? e);
    return c;
  }
};

describe('N9 REPLACE 形态不得改写 append-only 历史', () => {
  test('N9-1 裸面 `insert or replace` 打已有序号 ⇒ HISTORY_IMMUTABLE（DELETE 触发器经 recursive_triggers 触发），原行一字不变、投影不翻', () => {
    const w = open('n9-1');
    try {
      // recursive_triggers 必须真的开着——这是本修法的全部内容量所在，先钉连接事实
      expect(w.raw.get<{ recursive_triggers: number }>(`pragma recursive_triggers`)!.recursive_triggers).toBe(1);
      const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { core: true } }));
      // 未授权主体的正当签发（见证 false ⇒ NOT_ADOPTED），随后尝试用 REPLACE 把它换成授权行
      w.uow(NOBODY, (tx) => w.kernel.faceFor(CAP_RECORDS).writerFor(tx).appendAuthoritativeEvent({
        eventType: FACT_DESIGNATION_EVENT, objectId: asOid(oid), revision: 1,
        payload: { designationSchema: FACT_DESIGNATION_SCHEMA, stance: 'ACCEPTED', issuer: 'n9nobody', authorization: 'AUTHORIZED', policyVersion: FACT_STANDING_POLICY_VERSION },
      }));
      const seq = w.raw.get<{ m: number }>(`select max(seq) m from ledger`)!.m;
      expect(w.standingUseCase().standingAt(asOid(oid), w.ledgerHead()).state).toBe('NOT_ADOPTED');
      const forged = JSON.stringify({ axis: 'domain-admission', capability: CAP_RECORDS, authorized: true });
      // 席位 A2-5 原形态：同 seq 整行替换（actor + 见证 + payload 全换）——必须失败
      expect(outcome(() => w.raw.run(
        `insert or replace into ledger(seq, space, event_type, actor, authority_basis, object_id, revision, payload_json, recorded_at)
         values(?,'SP-N9',?,'n9adm',?,?,1,?,1)`,
        seq, FACT_DESIGNATION_EVENT, forged, oid,
        JSON.stringify({ designationSchema: FACT_DESIGNATION_SCHEMA, stance: 'ACCEPTED', issuer: 'n9adm', authorization: 'AUTHORIZED', policyVersion: FACT_STANDING_POLICY_VERSION }),
      ))).toContain('HISTORY_IMMUTABLE');
      // REPLACE 别名形态同拦
      expect(outcome(() => w.raw.run(
        `replace into ledger(seq, space, event_type, actor, authority_basis, object_id, revision, payload_json, recorded_at)
         values(?,'SP-N9',?,'n9adm',?,?,1,?,1)`,
        seq, FACT_DESIGNATION_EVENT, forged, oid,
        JSON.stringify({ designationSchema: FACT_DESIGNATION_SCHEMA, stance: 'ACCEPTED', issuer: 'n9adm', authorization: 'AUTHORIZED', policyVersion: FACT_STANDING_POLICY_VERSION }),
      ))).toContain('HISTORY_IMMUTABLE');
      // 原行不变：actor 仍是签发时主体、见证仍是 false、投影仍 NOT_ADOPTED
      const row = w.raw.get<{ actor: string; auth: number }>(
        `select actor, json_extract(authority_basis,'$.authorized') auth from ledger where seq=?`, seq)!;
      expect([row.actor, row.auth]).toEqual(['n9nobody', 0]);
      expect(w.standingUseCase().standingAt(asOid(oid), w.ledgerHead()).state).toBe('NOT_ADOPTED');
    } finally { w.close(); }
  });

  test('N9-2 guard 面把 REPLACE 两形态登记为被禁写法（纵深：先于触发器拒，且对无触发器表同样拒）', () => {
    const file = join(dir, 'n9-2.db');
    const port = new SqlitePort({ file });
    try {
      // 经机制守卫句柄（tx() 内层是 guard(adapter)）：REPLACE 语义在 SQL 守卫层即 RAW_SQL_REFUSED，
      // 不依赖目标表有没有触发器——journal 没有不可变性触发器，照样拒，证明拒的是**形态**不是后果。
      expect(outcome(() => port.tx((raw) => raw.run(
        `insert or replace into journal(seq, tx_epoch, ns, oid, op) values(1,1,'x','y','z')`,
      )))).toContain('RAW_SQL_REFUSED');
      expect(outcome(() => port.tx((raw) => raw.run(
        `replace into journal(seq, tx_epoch, ns, oid, op) values(1,1,'x','y','z')`,
      )))).toContain('RAW_SQL_REFUSED');
      // 反面对照：普通 insert 照常放行（守卫禁的是 REPLACE 形态，不是 DML 本身）
      expect(outcome(() => port.tx((raw) => raw.run(
        `insert into journal(tx_epoch, ns, oid, op) values(1,'x','y','normal-insert-stays-legal')`,
      )))).toBe('NO_REFUSAL');
      // 前导注释不改变判定（归一化后仍命中）
      expect(outcome(() => port.tx((raw) => raw.run(
        `/* 伪装 */ insert or replace into journal(seq, tx_epoch, ns, oid, op) values(2,1,'x','y','z')`,
      )))).toContain('RAW_SQL_REFUSED');
    } finally { port.close(); }
  });
});
