/**
 * WP-3.1 — 持久化缝 (真实 research.sqlite): DatabaseSync 封装模式端到端
 * (WP-2.1 openDatabase 先行 + 第二连接幂等 DDL — 同 WP-2.4 runbinding),
 * 存储层不变量 (no-DELETE / 内容不可变 / 字段共现 CHECK), 创建双写同事务,
 * 行↔记录往返 (SQL 层), id 分配 (reserve/commit/release, 失败留 gap 不重复)。
 */

import { DatabaseSync } from 'node:sqlite'
import { join as joinPath } from 'node:path'
import { describe, expect, it, afterEach } from 'vitest'

import { IdAllocator } from '../../src/shared/ids/index.js'
import { InMemoryMetaStore } from '../../src/host/persistence/meta/index.js'
import { PlanForkError, PlanForkStore } from '../../src/host/domain/planfork/index.js'
import { openStore, adaptDatabaseSync, type PersistHarness } from './persist-harness.js'
import { makeParams } from './fixtures.js'

/** COUNT(*) rows come back as number|bigint from node:sqlite — normalize. */
const count = (row: Record<string, unknown> | undefined): number => Number(row?.n ?? 0)
/** node:sqlite: all/get live on StatementSync, not DatabaseSync. */
const qAll = (db: DatabaseSync, sql: string): Record<string, unknown>[] => db.prepare(sql).all() as Record<string, unknown>[]
const qGet = (db: DatabaseSync, sql: string, ...params: (string | number | null)[]): Record<string, unknown> | undefined =>
  db.prepare(sql).get(...params) as Record<string, unknown> | undefined

describe('DDL on the real file (DatabaseSync 封装模式)', () => {
  let h: PersistHarness
  afterEach(() => h?.close())

  it('creates plan_fork + management_action on top of the WP-2.1 core tables', () => {
    h = openStore()
    const tables = qAll(h.rawDb, `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).map((r) => String(r.name))
    // 核心三表 (WP-2.1) + 本 WP 两表
    expect(tables).toContain('history_event')
    expect(tables).toContain('derived_state')
    expect(tables).toContain('meta')
    expect(tables).toContain('plan_fork')
    expect(tables).toContain('management_action')
    // §15 关键索引
    const indexes = qAll(h.rawDb, `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'plan_fork'`).map((r) => String(r.name))
    expect(indexes).toContain('idx_plan_fork_ws_status')
    // triggers (存储层不变量)
    const triggers = qAll(h.rawDb, `SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'plan_fork'`).map((r) => String(r.name))
    expect(triggers).toContain('plan_fork_no_delete')
    expect(triggers).toContain('plan_fork_no_content_update')
    // management_action: 双触发器形态对齐 plan_fork (G3 R1 加固)
    const maTriggers = qAll(h.rawDb, `SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'management_action'`).map((r) => String(r.name))
    expect(maTriggers).toContain('management_action_no_delete')
    expect(maTriggers).toContain('management_action_no_content_update')
  })

  it('is IDEMPOTENT — a second/third connection re-applies IF NOT EXISTS cleanly', () => {
    h = openStore()
    const second = h.secondStore()
    expect(second.getPlanFork('PF-1')).toBeNull()
    const third = new PlanForkStore({
      db: adaptDatabaseSync(new DatabaseSync(joinPath(h.dir, 'research.sqlite'))),
      allocator: new IdAllocator(new InMemoryMetaStore()),
      projectId: 'PRJ-1',
    })
    expect(third.listPlanForks()).toHaveLength(0)
  })
})

describe('createPlanFork — 双写单事务 (plan_fork 行 + PF_CREATED 账本)', () => {
  let h: PersistHarness
  afterEach(() => h?.close())

  it('persists the OPEN record and the PF_CREATED ledger row atomically', () => {
    h = openStore()
    const record = h.store.createPlanFork(makeParams(), h.ctx())
    expect(record.id).toBe('PF-1')
    expect(record.status).toBe('OPEN')
    // SQL 层回读 = 内存记录 (行↔记录往返)
    const row = qGet(h.rawDb, `SELECT * FROM plan_fork WHERE id = ?`, record.id)
    expect(row).toBeDefined()
    expect(String(row!.workstream_id)).toBe('WS-1')
    expect(String(row!.status)).toBe('OPEN')
    const base = JSON.parse(String(row!.base_plan_objects)) as { path: string; git_blob_oid: string }[]
    expect(base).toHaveLength(8)
    // 账本行
    const ma = h.store.getManagementAction('MA-1')!
    expect(ma.action_kind).toBe('PF_CREATED')
    expect(ma.actor).toEqual({ kind: 'AGENT', run_id: 'R-81' })
    expect(ma.subject_refs).toEqual([{ kind: 'PLAN_FORK', id: 'PF-1' }])
    expect(ma.git_blob_oids).toHaveLength(8)
    // 第二次创建 ⇒ PF-2 / MA-2 (单调计数器)
    const second = h.store.createPlanFork(makeParams(), h.ctx())
    expect(second.id).toBe('PF-2')
    expect(h.store.getManagementAction('MA-2')!.action_kind).toBe('PF_CREATED')
  })

  it('rolls back BOTH rows when the transaction fails (零半落地)', () => {
    h = openStore()
    // 注入失败: 预占 MA-1 的 PK (management_action 表) 使 INSERT 冲突
    h.rawDb.prepare(`INSERT INTO management_action (id, action_kind, actor, subject_refs, occurred_at) VALUES ('MA-1', 'PF_CREATED', '{}', '[]', 1)`).run()
    let storeErr: unknown
    try {
      h.store.createPlanFork(makeParams(), h.ctx())
    } catch (e) {
      storeErr = e
    }
    expect(storeErr).toBeInstanceOf(PlanForkError)
    expect((storeErr as PlanForkError).code).toBe('PF_STORE')
    // plan_fork 零行 (事务回滚)
    expect(count(qGet(h.rawDb, `SELECT COUNT(*) AS n FROM plan_fork`))).toBe(0)
    // 分配器: 失败路径 release ⇒ PF-1/MA-1 烧掉留 gap (单调不回收) — 下一次从 PF-2 起
    const next = h.store.createPlanFork(makeParams(), h.ctx())
    expect(next.id).toBe('PF-2')
    expect(h.store.getManagementAction('MA-2')).not.toBeNull()
  })

  it('rejects a validation failure BEFORE any row is written (八步先于落库)', () => {
    h = openStore()
    let valErr: unknown
    try {
      h.store.createPlanFork(makeParams({ proposedItems: [] }), h.ctx())
    } catch (e) {
      valErr = e
    }
    expect(valErr).toBeInstanceOf(PlanForkError)
    expect((valErr as PlanForkError).code).toBe('PF_ITEMS_EMPTY')
    expect(count(qGet(h.rawDb, `SELECT COUNT(*) AS n FROM plan_fork`))).toBe(0)
    expect(h.store.listManagementActions()).toHaveLength(0)
    // id 分配器未被烧号
    const ok = h.store.createPlanFork(makeParams(), h.ctx())
    expect(ok.id).toBe('PF-1')
  })
})

describe('存储层不变量 (trigger 级 — 任何连接生效)', () => {
  let h: PersistHarness
  afterEach(() => h?.close())

  function seed(): string {
    return h.store.createPlanFork(makeParams(), h.ctx()).id
  }

  it('INV-PLAN-4: raw DELETE on plan_fork is ABORTED (行永不删除)', () => {
    h = openStore()
    const id = seed()
    let err: unknown
    try {
      h.rawDb.prepare(`DELETE FROM plan_fork WHERE id = ?`).run(id)
    } catch (e) {
      err = e
    }
    expect(err).toBeDefined()
    expect(String(err)).toContain('never deleted')
    expect(h.store.getPlanFork(id)).not.toBeNull()
    // management_action 同样不删
    expect(() => h.rawDb.prepare(`DELETE FROM management_action WHERE id = 'MA-1'`).run()).toThrow()
  })

  it('INV-PLAN-4: raw UPDATE of content columns is ABORTED; state-cache UPDATE is allowed', () => {
    h = openStore()
    const id = seed()
    let err: unknown
    try {
      h.rawDb.prepare(`UPDATE plan_fork SET reason = 'hacked' WHERE id = ?`).run(id)
    } catch (e) {
      err = e
    }
    expect(String(err)).toContain('immutable')
    expect(h.store.getPlanFork(id)!.reason).not.toBe('hacked')
    // base 内容列同样锁死
    expect(() => h.rawDb.prepare(`UPDATE plan_fork SET base_plan_objects = '[]' WHERE id = ?`).run(id)).toThrow()
    // 状态缓存列是合法 UPDATE 面 (经 store 迁移)
    h.store.transition(id, { to: 'STALE', stale_reason: 's' }, { kind: 'PLUGIN' })
    expect(h.store.getPlanFork(id)!.status).toBe('STALE')
  })

  it('G3 R1: raw UPDATE of a management_action ledger row is ABORTED (账本内容不可变, 对齐 plan_fork 双触发器)', () => {
    h = openStore()
    seed() // PF-1 + MA-1 (PF_CREATED)
    let err: unknown
    try {
      h.rawDb.prepare(`UPDATE management_action SET detail = 'FORGED' WHERE id = 'MA-1'`).run()
    } catch (e) {
      err = e
    }
    expect(err).toBeDefined()
    expect(String(err)).toContain('immutable')
    // 行未被篡改 (store API 回读)
    expect(h.store.getManagementAction('MA-1')!.detail).not.toBe('FORGED')
    // 其余内容列同样锁死 (8 列全内容列, 无状态缓存列)
    expect(() => h.rawDb.prepare(`UPDATE management_action SET action_kind = 'X' WHERE id = 'MA-1'`).run()).toThrow()
    expect(() => h.rawDb.prepare(`UPDATE management_action SET actor = '{"kind":"PLUGIN"}' WHERE id = 'MA-1'`).run()).toThrow()
    expect(() => h.rawDb.prepare(`UPDATE management_action SET subject_refs = '[]' WHERE id = 'MA-1'`).run()).toThrow()
    expect(() => h.rawDb.prepare(`UPDATE management_action SET git_commit_oid = 'FORGED' WHERE id = 'MA-1'`).run()).toThrow()
    expect(() => h.rawDb.prepare(`UPDATE management_action SET git_blob_oids = '[]' WHERE id = 'MA-1'`).run()).toThrow()
    expect(() => h.rawDb.prepare(`UPDATE management_action SET occurred_at = 0 WHERE id = 'MA-1'`).run()).toThrow()
    // 行仍在 (no_delete 半边 + 内容锁共同维持账本完整)
    expect(h.store.getManagementAction('MA-1')).not.toBeNull()
  })

  it('字段共现 CHECK: 手搓的非法状态组合落不了库', () => {
    h = openStore()
    expect(() =>
      h.rawDb
        .prepare(
          `INSERT INTO plan_fork (id, workstream_id, base_plan_objects, fork_anchor, merge_anchor, proposed_items, trigger_refs, reason, necessity, created_by_run, created_at, status)
           VALUES ('PF-90', 'WS-1', '[{"path":"p","git_blob_oid":"a"}]', 'G-1', 'G-2', '[]', '[]', 'r', 'n', 'R-1', 1, 'SELECTED')`,
        )
        .run(),
    ).toThrow() // SELECTED 无 selected_at/selected_by ⇒ CHECK 违例
    expect(() =>
      h.rawDb
        .prepare(
          `INSERT INTO plan_fork (id, workstream_id, base_plan_objects, fork_anchor, merge_anchor, proposed_items, trigger_refs, reason, necessity, created_by_run, created_at, status, stale_reason)
           VALUES ('PF-91', 'WS-1', '[{"path":"p","git_blob_oid":"a"}]', 'G-1', 'G-2', '[]', '[]', 'r', 'n', 'R-1', 1, 'OPEN', 'x')`,
        )
        .run(),
    ).toThrow() // OPEN 带 stale_reason ⇒ CHECK 违例
    expect(count(qGet(h.rawDb, `SELECT COUNT(*) AS n FROM plan_fork`))).toBe(0)
  })
})

describe('queries (get/list/countOpen — §15 索引面)', () => {
  let h: PersistHarness
  afterEach(() => h?.close())

  it('listPlanForks filters by workstream/status; getPlanFork by id', () => {
    h = openStore()
    const p1 = h.store.createPlanFork(makeParams(), h.ctx())
    h.store.createPlanFork(makeParams(), h.ctx())
    h.store.transition(p1.id, { to: 'STALE', stale_reason: 's' }, { kind: 'PLUGIN' })
    expect(h.store.listPlanForks()).toHaveLength(2)
    expect(h.store.listPlanForks({ workstreamId: 'WS-1' })).toHaveLength(2)
    expect(h.store.listPlanForks({ workstreamId: 'WS-2' })).toHaveLength(0)
    expect(h.store.listPlanForks({ status: 'OPEN' })).toHaveLength(1)
    expect(h.store.listPlanForks({ status: 'STALE' })).toHaveLength(1)
    expect(h.store.listPlanForks({ workstreamId: 'WS-1', status: 'OPEN' })).toHaveLength(1)
    expect(h.store.getPlanFork('PF-404')).toBeNull()
    // 非法 status 过滤值被运行面拒 (冻结状态枚举)
    let filterErr: unknown
    try {
      h.store.listPlanForks({ status: 'ARCHIVED' as never })
    } catch (e) {
      filterErr = e
    }
    expect(filterErr).toBeInstanceOf(PlanForkError)
    expect((filterErr as PlanForkError).code).toBe('PF_INPUT')
  })

  it('exposes NO delete method (API 面 INV-PLAN-4 半边)', () => {
    h = openStore()
    const store = h.store as unknown as Record<string, unknown>
    expect(Object.keys(store).filter((k) => /delete|remove/i.test(k))).toEqual([])
  })
})
