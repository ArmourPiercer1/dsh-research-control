/**
 * WP-5.2 — 操作性 DDL 面（real sqlite — node:sqlite 双连接）:
 *
 *  - 幂等建表（`CREATE TABLE IF NOT EXISTS` — 每 WP schema.ts 先例）;
 *  - 列面/索引面与冻结 §15 SQLite 映射 + attention.schema.json $defs 一致;
 *  - 零删除触发器（`*_no_delete` — TC-DB-004 纪律, 所有 operational 表）;
 *  - 内容不可变触发器（`*_no_content_update` — IFNULL 相等口径: 内容列
 *    仅可沿状态迁移改状态/迁移产物, 其余一律 ABORT）;
 *  - 状态回退触发器（`*_no_status_regression` — §13 终态在引擎层也锁死:
 *    即便绕过 service 层, 行也不能「复活」或退回 PROPOSED/ACTIVE）;
 *  - CHECK 共现（`promoted_to_task_id ⇔ PROMOTED` / `cleared_at ⇔ CLEARED`）
 *    — 冻结 schema 共现约束在引擎层的镜像;
 *  - 行解码器损坏 fail loud（created_by/affects/references JSON 坏行）。
 */

import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

import { openDatabase } from '../../src/host/persistence/store/index.js'
import { IdAllocator } from '../../src/shared/ids/index.js'
import { InMemoryMetaStore } from '../../src/host/persistence/meta/index.js'
import {
  ActionsError,
  ActionsStore,
  BLOCKER_TABLE,
  NEXT_ACTION_TABLE,
  rowToBlocker,
  rowToNextAction,
} from '../../src/host/service/actions/index.js'
import { adaptDatabaseSync, USER_ACTOR, agentActor, openActionsHarness } from './harness.js'

const roots: string[] = []
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

function scratchDb(): DatabaseSync {
  const dir = mkdtempSync(join(tmpdir(), 'wp52-schema-'))
  roots.push(dir)
  const core = openDatabase(join(dir, 'research.sqlite'))
  void core
  const raw = new DatabaseSync(join(dir, 'research.sqlite'))
  raw.exec('PRAGMA busy_timeout = 5000')
  return raw
}

function freshStore(raw: DatabaseSync): ActionsStore {
  return new ActionsStore({
    db: adaptDatabaseSync(raw),
    allocator: new IdAllocator(new InMemoryMetaStore()),
    projectId: 'PRJ-1',
    now: () => Date.parse('2026-08-23T10:00:00Z'),
  })
}

describe('DDL 面（幂等 + 冻结 §15 映射）', () => {
  it('two consecutive ActionsStore constructions over one connection succeed (CREATE IF NOT EXISTS)', () => {
    const raw = scratchDb()
    expect(() => freshStore(raw)).not.toThrow()
    expect(() => freshStore(raw)).not.toThrow()
    raw.close()
  })

  it('pins the next_action column face（§9.3 冻结字段, snake_case）', () => {
    const raw = scratchDb()
    freshStore(raw)
    const cols = (raw.prepare(`PRAGMA table_info(${NEXT_ACTION_TABLE})`).all() as { name: string }[])
      .map((c) => c.name)
    expect(cols).toEqual(['id', 'workstream_id', 'statement', 'rationale', 'status', 'promoted_to_task_id', 'created_by', 'created_at'])
    raw.close()
  })

  it('pins the blocker column face（§9.4 冻结字段, snake_case）', () => {
    const raw = scratchDb()
    freshStore(raw)
    const cols = (raw.prepare(`PRAGMA table_info(${BLOCKER_TABLE})`).all() as { name: string }[])
      .map((c) => c.name)
    expect(cols).toEqual(['id', 'statement', 'affects', 'status', 'source', 'references', 'created_at', 'cleared_at'])
    raw.close()
  })

  it('pins the three indexes（列表查询面 — 任务书视图目标 3 的查询支撑）', () => {
    const raw = scratchDb()
    freshStore(raw)
    const names = (raw.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'`).all() as { name: string }[])
      .map((r) => r.name)
    expect(names).toEqual(expect.arrayContaining(['idx_next_action_status', 'idx_next_action_workstream', 'idx_blocker_status']))
    raw.close()
  })

  it('pins the trigger set（零删除/内容不可变/回退锁/共现字段锁）', () => {
    const raw = scratchDb()
    freshStore(raw)
    const names = (raw.prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger'`).all() as { name: string }[])
      .map((r) => r.name)
      .filter((n) => n.startsWith('next_action_') || n.startsWith('blocker_'))
      .sort()
    expect(names).toEqual(
      [
        'blocker_cleared_at_immutable',
        'blocker_no_content_update',
        'blocker_no_delete',
        'blocker_no_status_regression',
        'next_action_no_content_update',
        'next_action_no_delete',
        'next_action_no_status_regression',
        'next_action_promoted_task_immutable',
      ].sort(),
    )
    raw.close()
  })
})

describe('next_action 引擎层守卫（real sqlite 负例）', () => {
  it('no-delete: raw DELETE is ABORTed（TC-DB-004 零删除纪律）', () => {
    const h = openActionsHarness()
    try {
      h.store.createNextAction({ statement: '先跑基线' }, USER_ACTOR)
      expect(() => h.rawDb.exec(`DELETE FROM ${NEXT_ACTION_TABLE}`)).toThrow()
      expect(h.store.listNextActions().length).toBe(1)
    } finally {
      h.close()
    }
  })

  it('no content update: every content column is locked after insert', () => {
    const h = openActionsHarness()
    try {
      const rec = h.store.createNextAction({ statement: '先跑基线', workstreamId: 'WS-1', rationale: '数据缺失' }, USER_ACTOR)
      const id = rec.id
      for (const col of ['workstream_id', 'statement', 'rationale', 'created_by', 'created_at', 'id'] as const) {
        expect(() => h.rawDb.exec(`UPDATE ${NEXT_ACTION_TABLE} SET ${col} = 'x' WHERE id = '${id}'`)).toThrow()
      }
      // promoted_to_task_id 在 NULL 时同样锁死（迁移产物仅可经迁移 SQL 设置）。
      expect(() => h.rawDb.exec(`UPDATE ${NEXT_ACTION_TABLE} SET promoted_to_task_id = 'T-9' WHERE id = '${id}'`)).toThrow()
    } finally {
      h.close()
    }
  })

  it('status regression: a raw move OUT of a terminal state is ABORTed', () => {
    const h = openActionsHarness()
    try {
      const rec = h.store.createNextAction({ statement: 's' }, USER_ACTOR)
      h.store.promoteNextAction(rec.id, 'T-1', USER_ACTOR)
      // raw PROMOTED → PROPOSED（复活）:
      expect(() => h.rawDb.exec(`UPDATE ${NEXT_ACTION_TABLE} SET status = 'PROPOSED' WHERE id = '${rec.id}'`)).toThrow()
      // raw PROMOTED → DISMISSED（§13 无此边 — 终态无出边）:
      expect(() => h.rawDb.exec(`UPDATE ${NEXT_ACTION_TABLE} SET status = 'DISMISSED' WHERE id = '${rec.id}'`)).toThrow()
    } finally {
      h.close()
    }
  })

  it('the engine trigger does NOT over-lock the legal direction (raw PROPOSED → PROMOTED passes)', () => {
    const h = openActionsHarness()
    try {
      const rec = h.store.createNextAction({ statement: 's', workstreamId: 'WS-1' }, USER_ACTOR)
      // 引擎面合法方向（service 层仍保有 §13 纯守卫 + 物化面 — 此处只验证
      // trigger 不误伤）:
      expect(() => h.rawDb.exec(`UPDATE ${NEXT_ACTION_TABLE} SET status = 'PROMOTED', promoted_to_task_id = 'T-1' WHERE id = '${rec.id}'`)).not.toThrow()
      expect(h.store.getNextAction(rec.id)?.status).toBe('PROMOTED')
    } finally {
      h.close()
    }
  })

  it('CHECK co-occurrence: promoted_to_task_id ⇔ PROMOTED (both directions, raw)', () => {
    const h = openActionsHarness()
    try {
      // PROMOTED without a task id:
      expect(() =>
        h.rawDb.exec(
          `INSERT INTO ${NEXT_ACTION_TABLE} (id, workstream_id, statement, rationale, status, promoted_to_task_id, created_by, created_at) VALUES ('NA-99', NULL, 'x', NULL, 'PROMOTED', NULL, '{"kind":"USER"}', 1)`,
        ),
      ).toThrow()
      // PROPOSED with a task id:
      expect(() =>
        h.rawDb.exec(
          `INSERT INTO ${NEXT_ACTION_TABLE} (id, workstream_id, statement, rationale, status, promoted_to_task_id, created_by, created_at) VALUES ('NA-98', NULL, 'x', NULL, 'PROPOSED', 'T-1', '{"kind":"USER"}', 1)`,
        ),
      ).toThrow()
      // an unknown status is CHECK-rejected:
      expect(() =>
        h.rawDb.exec(
          `INSERT INTO ${NEXT_ACTION_TABLE} (id, workstream_id, statement, rationale, status, promoted_to_task_id, created_by, created_at) VALUES ('NA-97', NULL, 'x', NULL, 'BROKEN', NULL, '{"kind":"USER"}', 1)`,
        ),
      ).toThrow()
    } finally {
      h.close()
    }
  })

  it('rowToNextAction decodes a real row and fails loud on corrupt JSON', () => {
    const h = openActionsHarness()
    try {
      h.store.createNextAction({ statement: 's', workstreamId: 'WS-1', rationale: 'r' }, agentActor('R-1'))
      const row = h.rawDb.prepare(`SELECT * FROM ${NEXT_ACTION_TABLE}`).get() as Record<string, unknown>
      const decoded = rowToNextAction(row)
      expect(decoded.id).toBe('NA-1')
      expect(decoded.status).toBe('PROPOSED')
      expect(decoded.created_by).toEqual({ kind: 'AGENT', run_id: 'R-1', label: 'agent-1' })
      expect(decoded.workstream_id).toBe('WS-1')
      expect(decoded.rationale).toBe('r')
      expect(decoded.promoted_to_task_id).toBeUndefined()
      expect(() => rowToNextAction({ ...row, created_by: 'not-json' })).toThrowError(/row corruption at next_action.created_by/)
      expect(() => rowToNextAction({ ...row, created_by: 42 })).toThrowError(/row corruption at next_action.created_by/)
    } finally {
      h.close()
    }
  })
})

describe('blocker 引擎层守卫（real sqlite 负例）', () => {
  it('no-delete: raw DELETE is ABORTed', () => {
    const h = openActionsHarness()
    try {
      h.store.createBlocker({ statement: '数据源挂了', affects: [{ kind: 'WORKSTREAM', id: 'WS-1' }], source: 'user-report' }, USER_ACTOR)
      expect(() => h.rawDb.exec(`DELETE FROM ${BLOCKER_TABLE}`)).toThrow()
      expect(h.store.listBlockers().length).toBe(1)
    } finally {
      h.close()
    }
  })

  it('no content update: statement/affects/source/references are locked', () => {
    const h = openActionsHarness()
    try {
      const rec = h.store.createBlocker(
        { statement: '数据源挂了', affects: [{ kind: 'WORKSTREAM', id: 'WS-1' }], source: 'user-report', references: ['run:R-1'] },
        USER_ACTOR,
      )
      for (const col of ['statement', 'affects', 'source', 'references', 'created_at', 'id'] as const) {
        expect(() => h.rawDb.exec(`UPDATE ${BLOCKER_TABLE} SET ${col} = 'x' WHERE id = '${rec.id}'`)).toThrow()
      }
      expect(() => h.rawDb.exec(`UPDATE ${BLOCKER_TABLE} SET cleared_at = 1 WHERE id = '${rec.id}'`)).toThrow()
    } finally {
      h.close()
    }
  })

  it('status regression: CLEARED cannot be revived raw (CLEARED→CLEARED self-loop is a no-op at engine level; the service layer rejects self-loops)', () => {
    const h = openActionsHarness()
    try {
      const rec = h.store.createBlocker({ statement: 's', affects: [{ kind: 'TASK', id: 'T-1' }], source: 'audit' }, USER_ACTOR)
      h.store.clearBlocker(rec.id, USER_ACTOR)
      expect(() => h.rawDb.exec(`UPDATE ${BLOCKER_TABLE} SET status = 'ACTIVE' WHERE id = '${rec.id}'`)).toThrow()
      // 自环: 引擎层 no-op（行不变）, service 层 §13 纯守卫拒绝。
      h.rawDb.exec(`UPDATE ${BLOCKER_TABLE} SET status = 'CLEARED' WHERE id = '${rec.id}'`)
      expect(h.store.getBlocker(rec.id)?.status).toBe('CLEARED')
      expect(() => h.store.clearBlocker(rec.id, USER_ACTOR)).toThrow(ActionsError)
    } finally {
      h.close()
    }
  })

  it('CHECK co-occurrence: cleared_at ⇔ CLEARED (both directions, raw)', () => {
    const h = openActionsHarness()
    try {
      expect(() =>
        h.rawDb.exec(
          `INSERT INTO ${BLOCKER_TABLE} (id, statement, affects, status, source, references, created_at, cleared_at) VALUES ('BLK-99', 'x', '[{"kind":"WORKSTREAM","id":"WS-1"}]', 'ACTIVE', 's', NULL, 1, 1)`,
        ),
      ).toThrow()
      expect(() =>
        h.rawDb.exec(
          `INSERT INTO ${BLOCKER_TABLE} (id, statement, affects, status, source, references, created_at, cleared_at) VALUES ('BLK-98', 'x', '[{"kind":"WORKSTREAM","id":"WS-1"}]', 'CLEARED', 's', NULL, 1, NULL)`,
        ),
      ).toThrow()
    } finally {
      h.close()
    }
  })

  it('rowToBlocker decodes a real row and fails loud on corrupt refs', () => {
    const h = openActionsHarness()
    try {
      h.store.createBlocker(
        { statement: 'GPU 队列满', affects: [{ kind: 'WORKSTREAM', id: 'WS-1' }, { kind: 'RUN', id: 'R-1' }], source: 'run:R-1', references: ['doc:a.md'] },
        USER_ACTOR,
      )
      const row = h.rawDb.prepare(`SELECT * FROM ${BLOCKER_TABLE}`).get() as Record<string, unknown>
      const decoded = rowToBlocker(row)
      expect(decoded.id).toBe('BLK-1')
      expect(decoded.status).toBe('ACTIVE')
      expect(decoded.affects).toEqual([{ kind: 'WORKSTREAM', id: 'WS-1' }, { kind: 'RUN', id: 'R-1' }])
      expect(decoded.references).toEqual(['doc:a.md'])
      expect(decoded.cleared_at).toBeUndefined()
      expect(() => rowToBlocker({ ...row, affects: '[{"kind":"GATE","id":"G-1"}]' })).toThrowError(/row corruption at blocker.affects/)
      expect(() => rowToBlocker({ ...row, affects: 'not-json' })).toThrowError(/row corruption at blocker.affects/)
      expect(() => rowToBlocker({ ...row, references: JSON.stringify(42) })).toThrowError(/row corruption at blocker.references/)
    } finally {
      h.close()
    }
  })
})
