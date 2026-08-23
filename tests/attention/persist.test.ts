/**
 * WP-5.4 — `awareness` 表持久化（真实 research.sqlite; DatabaseSync 封装
 * 模式端到端 — 同 tests/flooding/persist.test.ts 纪律）。
 *
 * 覆盖:
 *  - DDL 落地（§15 冻结行: `awareness` PK `(object_kind, object_id)`;
 *    CHECK = 冻结 kind 白名单/四态）+ 列集 live pin（TC-DB-004 的文本级
 *    清单之外的活库面 — 同 planfork persist 先例）;
 *  - 幂等（第二连接/第二 store 重放 DDL）;
 *  - 行↔记录往返 / 查询面 / PK upsert（只触状态缓存列）;
 *  - 存储层不变量: no-DELETE trigger（INV-HIST-7）/ 内容不可变 trigger
 *    （object_ref 不可动; state/updated_at 可动 — 用户改状态面）/
 *    CHECK 拒绝白名单外 kind（INV-ATTN-4 存储层半边）;
 *  - API 面: 无 delete 方法（结构断言）。
 */
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

import {
  AWARENESS_TABLE,
  AttentionService,
  isAttentionError,
  openAttentionDatabase,
  type AttentionDatabase,
} from '../../src/host/service/attention/index.js'
import { makeTempDir } from '../flooding/fixtures.js'

describe('awareness 表持久化（真实 research.sqlite）', () => {
  let pair: AttentionDatabase
  let raw: DatabaseSync
  const dir = makeTempDir('wp54-attn-persist-')

  afterAll(() => {
    try {
      pair?.close()
    } catch {
      /* closed */
    }
    try {
      raw?.close()
    } catch {
      /* closed */
    }
  })

  it('DDL 落地: §15 冻结表 + PK + CHECK + 双 trigger; 列集 live pin', () => {
    pair = openAttentionDatabase(join(dir, 'research.sqlite'))
    // DDL 由 AwarenessStore 构造时幂等应用（同 WP-3.5: InterventionStore
    // 构造时落 intervention DDL — 第二连接模式, schema.ts 头注）。
    new AttentionService({ db: pair.db }).close()
    raw = new DatabaseSync(pair.store.path)
    raw.exec('PRAGMA busy_timeout = 5000')

    const tables = (
      raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]
    )
      .map((r) => r.name)
      .sort()
    expect(tables).toContain(AWARENESS_TABLE)

    // 列集 live pin（顺序 = DDL 声明; 与 TC-DB-004 文本级 PINNED_COLUMNS 同值）:
    const cols = (raw.prepare(`PRAGMA table_xinfo(${AWARENESS_TABLE})`).all() as { name: string }[]).map((r) => r.name)
    expect(cols).toEqual(['object_kind', 'object_id', 'state', 'updated_at'])

    // PK = (object_kind, object_id)（§15 冻结）:
    const pk = (raw.prepare(`PRAGMA table_xinfo(${AWARENESS_TABLE})`).all() as { name: string; pk: number }[])
      .filter((r) => r.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map((r) => r.name)
    expect(pk).toEqual(['object_kind', 'object_id'])

    // 双 trigger 就位:
    const triggers = (
      raw.prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = '${AWARENESS_TABLE}'`).all() as { name: string }[]
    )
      .map((r) => r.name)
      .sort()
    expect(triggers).toEqual(['awareness_no_content_update', 'awareness_no_delete'])
  })

  it('DDL 幂等（第二 store 在同一连接重放不报错）', () => {
    const svc = new AttentionService({ db: pair.db })
    expect(() => svc.close()).not.toThrow()
  })

  it('行↔记录往返: upsert → get → 全等; list 稳定顺序', () => {
    const svc = new AttentionService({ db: pair.db, now: () => 1_700_000_000_000 })
    const rec = svc.setAwareness({ kind: 'INTERVENTION', id: 'IV-1' }, 'SEEN', { kind: 'USER', user_id: 'u-1' })
    expect(rec).toEqual({ object_kind: 'INTERVENTION', object_id: 'IV-1', state: 'SEEN', updated_at: 1_700_000_000_000 })
    expect(svc.getAwareness({ kind: 'INTERVENTION', id: 'IV-1' })).toEqual(rec)

    const svc2 = new AttentionService({ db: pair.db, now: () => 1_700_000_001_000 })
    svc2.setAwareness({ kind: 'CLAIM', id: 'CLM-1' }, 'UNSEEN', { kind: 'USER', user_id: 'u-1' })
    const list = svc2.listAwareness()
    expect(list.map((r) => `${r.object_kind}:${r.object_id}`)).toEqual(['CLAIM:CLM-1', 'INTERVENTION:IV-1'])

    // upsert 覆盖（PK 冲突 ⇒ 同一条目新状态, 不产生第二行）:
    svc2.setAwareness({ kind: 'INTERVENTION', id: 'IV-1' }, 'ASSESSED', { kind: 'USER', user_id: 'u-1' })
    const again = svc2.getAwareness({ kind: 'INTERVENTION', id: 'IV-1' })
    expect(again).toEqual({ object_kind: 'INTERVENTION', object_id: 'IV-1', state: 'ASSESSED', updated_at: 1_700_000_001_000 })
    expect(svc2.listAwareness()).toHaveLength(2)
  })

  it('no-DELETE trigger: raw DELETE 被 ABORT（INV-HIST-7 存储层半边）', () => {
    expect(() => raw.exec(`DELETE FROM ${AWARENESS_TABLE} WHERE object_kind = 'CLAIM'`)).toThrow(
      /awareness rows are never deleted/,
    )
    // 行还在:
    const n = raw.prepare(`SELECT COUNT(*) AS c FROM ${AWARENESS_TABLE}`).get() as { c: number }
    expect(n.c).toBe(2)
  })

  it('内容不可变 trigger: object_ref UPDATE 被 ABORT; state/updated_at 可动（状态缓存面）', () => {
    expect(() => raw.exec(`UPDATE ${AWARENESS_TABLE} SET object_id = 'IV-999' WHERE object_kind = 'INTERVENTION'`)).toThrow(
      /awareness object_ref is immutable/,
    )
    expect(() =>
      raw.exec(`UPDATE ${AWARENESS_TABLE} SET object_kind = 'TASK' WHERE object_kind = 'INTERVENTION'`),
    ).toThrow(/awareness object_ref is immutable/)
    // 状态缓存列面（用户改状态的行侧机制 — service 的 upsert 走的面）:
    raw.exec(`UPDATE ${AWARENESS_TABLE} SET state = 'REVIEWED', updated_at = 1700000002000 WHERE object_kind = 'CLAIM'`)
    const row = raw.prepare(`SELECT * FROM ${AWARENESS_TABLE} WHERE object_kind = 'CLAIM'`).get() as Record<string, unknown>
    expect(row.state).toBe('REVIEWED')
    expect(row.updated_at).toBe(1_700_000_002_000)
    // 改回（保持后续断言基线）:
    raw.exec(`UPDATE ${AWARENESS_TABLE} SET state = 'UNSEEN', updated_at = 1700000001000 WHERE object_kind = 'CLAIM'`)
  })

  it('CHECK 拒绝: 白名单外 kind（INV-ATTN-4 存储层半边）/ 白名单外 state', () => {
    expect(() => raw.exec(`INSERT INTO ${AWARENESS_TABLE} VALUES ('TASK', 'T-1', 'UNSEEN', 1)`)).toThrow(
      /CHECK constraint failed/,
    )
    expect(() => raw.exec(`INSERT INTO ${AWARENESS_TABLE} VALUES ('CLAIM', 'CLM-9', 'RECALLED', 1)`)).toThrow(
      /CHECK constraint failed/,
    )
  })

  it('PK 冲突: 同 (object_kind, object_id) INSERT 被拒（唯一性）', () => {
    expect(() => raw.exec(`INSERT INTO ${AWARENESS_TABLE} VALUES ('CLAIM', 'CLM-1', 'UNSEEN', 1)`)).toThrow(
      /UNIQUE constraint failed/,
    )
  })

  it('API 面无 delete 方法（INV-HIST-7 的 API 面 — 结构断言）', () => {
    const svc = new AttentionService({ db: pair.db })
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(svc))
      .filter((m) => m !== 'constructor')
      .sort()
    expect(methods).toEqual(['close', 'getAttentionRanking', 'getAwareness', 'listAwareness', 'setAwareness'])
    expect(methods.some((m) => /delete|remove|drop/i.test(m))).toBe(false)
    svc.close()
    // 关闭后所有面大声拒（ATTN_STORE）:
    let closed: unknown
    try {
      svc.getAwareness({ kind: 'CLAIM', id: 'CLM-1' })
    } catch (e) {
      closed = e
    }
    expect(closed).toBeDefined()
    expect(isAttentionError(closed)).toBe(true)
    expect(closed).toHaveProperty('code', 'ATTN_STORE')
  })
})
