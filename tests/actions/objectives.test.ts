/**
 * WP-5.2 — Objective 声明式面（`.research/objectives.yaml` 原子写 +
 * 虚拟 reader 预校验 + 后置校验/补偿 + OBJECTIVE_EDITED 账本）:
 *
 *  - 声明式往返（round-trip）: loader 读取 → `serializeObjectives` →
 *    再加载, 文档等价 + 字节确定性（同数据 ⇒ 同字节, TC-DOM-005 口径）;
 *  - §13 迁移便捷面（`setObjectiveStatus` — ACTIVE → ACHIEVED | DROPPED,
 *    仅用户; 终态拒绝）;
 *  - 交叉引用预校验（新文档引用不存在的 topic ⇒ 精确 path 拒绝, 零落地）;
 *  - schema 预校验（minItems 等 — 冻结 objectives.schema.json）;
 *  - 后置校验补偿（writer 故障注入写坏字节 ⇒ 恢复旧字节 + 大声错误）;
 *  - 新建文件语义（fileCreated — 无旧字节 ⇒ 不可恢复, 手动对账口径）;
 *  - 坏树拒写（loadTreeOrThrow — 不给坏树叠写）;
 *  - 权限（USER only — 矩阵首行「创建/编辑 manifest ✅/❌/❌/❌」）。
 *
 * 基线树（tests/loader/fixtures baseTreeFiles）: 一个 TOPIC scope 目标
 * OBJ-1（topic TPC-1, priority P1, linked_refs WS-1 + G-1）。
 */

import { describe, expect, it } from 'vitest'
import { load } from '../loader/fixtures.js'

import {
  ActionsError,
  serializeObjectives,
} from '../../src/host/service/actions/index.js'
import type { ObjectiveDoc } from '../../src/host/domain/loader/index.js'
import {
  OBJECTIVES_PATH,
  PLUGIN_ACTOR,
  USER_ACTOR,
  agentActor,
  openActionsHarness,
  T0,
} from './harness.js'

function codeOf(e: unknown): string | undefined {
  return e instanceof ActionsError ? e.code : undefined
}

function captureError(fn: () => unknown): ActionsError {
  try {
    fn()
  } catch (e) {
    if (e instanceof ActionsError) return e
    throw e
  }
  throw new Error('expected the call to throw ActionsError')
}

/** A second, PROJECT-scoped objective doc（基线树合法引用面）. */
function obj2(overrides: Partial<ObjectiveDoc> = {}): ObjectiveDoc {
  return {
    id: 'OBJ-2',
    scope: 'PROJECT',
    statement: '项目级: 交付可复现的对比报告',
    success_criteria: ['对比报告可一键复现'],
    status: 'ACTIVE',
    priority: 'P0',
    linked_refs: [{ kind: 'WORKSTREAM', id: 'WS-1' }],
    created_at: T0,
    ...overrides,
  }
}

describe('声明式往返（loader 面 = 真值; 序列化确定性）', () => {
  it('load → serialize → re-load: document equivalence + stable bytes', () => {
    const h = openActionsHarness()
    try {
      const { present, objectives } = h.service.objectives.loadObjectives()
      expect(present).toBe(true)
      expect(objectives).toHaveLength(1)
      const obj1 = objectives[0]!
      expect(obj1.id).toBe('OBJ-1')

      // 往返: 序列化再加载, 逐字段等价。
      const serialized = serializeObjectives(objectives)
      h.fs.writer.writeAtomic(OBJECTIVES_PATH, serialized)
      const reloaded = load()
      expect(reloaded.errors).toEqual([])
      expect(reloaded.tree.objectives).toHaveLength(1)
      const re = reloaded.tree.objectives[0]!
      for (const field of ['id', 'scope', 'statement', 'success_criteria', 'status', 'priority', 'linked_refs', 'created_at'] as const) {
        expect(re[field], `field ${field}`).toEqual(obj1[field])
      }

      // 字节确定性: 同数据两次序列化同字节。
      expect(serializeObjectives(reloaded.tree.objectives)).toBe(serializeObjectives(objectives))
    } finally {
      h.close()
    }
  })

  it('defaults are materialized by the loader and omitted in the serialization (P2/ACTIVE/[])', () => {
    const h = openActionsHarness()
    try {
      const minimal = obj2() as unknown as Record<string, unknown>
      delete minimal.status
      delete minimal.priority
      delete minimal.linked_refs
      const doc = minimal as unknown as ObjectiveDoc
      const result = h.service.objectives.saveObjectives(
        [h.service.objectives.loadObjectives().objectives[0]!, doc],
        USER_ACTOR,
      )
      expect(result.fileCreated).toBe(false)
      // loader 物化 schema 默认值（objectives.schema.json defaults）:
      const reloaded = h.service.objectives.loadObjectives().objectives
      const loaded2 = reloaded.find((o) => o.id === 'OBJ-2')
      expect(loaded2?.status).toBe('ACTIVE')
      expect(loaded2?.priority).toBe('P2')
      expect(loaded2?.linked_refs).toEqual([])

      // 序列化省略 absent 可选字段（确定性 carrier — 纯函数面）:
      const minimalBytes = serializeObjectives([doc])
      expect(minimalBytes).not.toContain('status:')
      expect(minimalBytes).not.toContain('priority:')
      expect(minimalBytes).not.toContain('linked_refs:')
      const fullBytes = serializeObjectives([obj2()])
      expect(fullBytes).toContain('status: ACTIVE')
      expect(fullBytes).toContain('priority: P0')
    } finally {
      h.close()
    }
  })
})

describe('§13 状态迁移便捷面（setObjectiveStatus — 仅用户）', () => {
  it('ACTIVE → ACHIEVED: file rewrite + OBJECTIVE_EDITED ledger with the status diff', () => {
    const h = openActionsHarness()
    try {
      const before = h.fs.content(OBJECTIVES_PATH)
      const result = h.service.objectives.setObjectiveStatus('OBJ-1', 'ACHIEVED', USER_ACTOR)
      expect(result.managementActionId).toBe('MA-1')
      expect(result.objectives[0]?.status).toBe('ACHIEVED')

      const after = h.fs.content(OBJECTIVES_PATH)
      expect(after).not.toBeNull()
      expect(after).not.toBe(before)
      expect(after).toContain('status: ACHIEVED')

      // 账本行（§12.1 OBJECTIVE_EDITED — 三对象中唯一有 kind 的）:
      const ma = h.rawDb.prepare('SELECT * FROM management_action WHERE id = ?').get('MA-1') as Record<string, string>
      expect(ma.action_kind).toBe('OBJECTIVE_EDITED')
      expect(ma.detail).toContain('OBJ-1: ACTIVE → ACHIEVED')
      expect(ma.detail).toContain('objectives.yaml updated')

      // 读面同步（loader 真值）:
      expect(h.service.objectives.loadObjectives().objectives[0]?.status).toBe('ACHIEVED')
    } finally {
      h.close()
    }
  })

  it('ACTIVE → DROPPED is legal; terminal states refuse further moves (OBJ_WRONG_STATE)', () => {
    const h = openActionsHarness()
    try {
      h.service.objectives.setObjectiveStatus('OBJ-1', 'DROPPED', USER_ACTOR)
      expect(h.service.objectives.loadObjectives().objectives[0]?.status).toBe('DROPPED')
      const err = captureError(() => h.service.objectives.setObjectiveStatus('OBJ-1', 'ACHIEVED', USER_ACTOR))
      expect(err.code).toBe('OBJ_WRONG_STATE')
      const err2 = captureError(() => h.service.objectives.setObjectiveStatus('OBJ-1', 'ACTIVE', USER_ACTOR))
      expect(err2.code).toBe('OBJ_WRONG_STATE')
    } finally {
      h.close()
    }
  })

  it('unknown id → OBJ_NOT_FOUND; malformed id → ACT_INPUT', () => {
    const h = openActionsHarness()
    try {
      const err = captureError(() => h.service.objectives.setObjectiveStatus('OBJ-99', 'ACHIEVED', USER_ACTOR))
      expect(err.code).toBe('OBJ_NOT_FOUND')
      const err2 = captureError(() => h.service.objectives.setObjectiveStatus('nope', 'ACHIEVED', USER_ACTOR))
      expect(err2.code).toBe('ACT_INPUT')
    } finally {
      h.close()
    }
  })

  it('AGENT/PLUGIN are rejected (OBJ_ACTOR — 编辑面仅用户)', () => {
    const h = openActionsHarness()
    try {
      for (const actor of [agentActor('R-1'), PLUGIN_ACTOR]) {
        const err = captureError(() => h.service.objectives.setObjectiveStatus('OBJ-1', 'ACHIEVED', actor))
        expect(err.code).toBe('OBJ_ACTOR')
      }
      expect(h.service.objectives.loadObjectives().objectives[0]?.status).toBe('ACTIVE')
    } finally {
      h.close()
    }
  })
})

describe('saveObjectives 预校验（虚拟 reader — 零落地纪律）', () => {
  it('cross-reference violation: TOPIC objective pointing at a missing topic ⇒ rejected with the precise path, zero bytes written', () => {
    const h = openActionsHarness()
    try {
      const base = h.service.objectives.loadObjectives().objectives
      const bad = obj2({ id: 'OBJ-9', scope: 'TOPIC', topic_id: 'TPC-99' })
      const err = captureError(() => h.service.objectives.saveObjectives([...base, bad], USER_ACTOR))
      expect(err.code).toBe('OBJ_FILE')
      expect(err.message).toContain('objectives.yaml fails validation')
      // 零落地:
      expect(h.fs.writes.filter((w) => w.path === OBJECTIVES_PATH)).toHaveLength(0)
      expect(h.fs.content(OBJECTIVES_PATH)).not.toContain('OBJ-9')
    } finally {
      h.close()
    }
  })

  it('schema violation: empty success_criteria (minItems:1) ⇒ rejected', () => {
    const h = openActionsHarness()
    try {
      const base = h.service.objectives.loadObjectives().objectives
      const bad = obj2({ id: 'OBJ-9', success_criteria: [] })
      const err = captureError(() => h.service.objectives.saveObjectives([...base, bad], USER_ACTOR))
      // 入参面预检先于虚拟 reader schema 校验（ACT_INPUT）— 同样零落地:
      expect(err.code).toBe('ACT_INPUT')
      expect(err.message).toContain('success_criteria')
      expect(h.fs.writes.filter((w) => w.path === OBJECTIVES_PATH)).toHaveLength(0)
    } finally {
      h.close()
    }
  })

  it('input validation: duplicate id / malformed id / missing statement ⇒ ACT_INPUT (before any validation pass)', () => {
    const h = openActionsHarness()
    try {
      const base = h.service.objectives.loadObjectives().objectives
      const dup = obj2({ id: 'OBJ-1' })
      expect(codeOf(captureError(() => h.service.objectives.saveObjectives([...base, dup], USER_ACTOR)))).toBe('ACT_INPUT')
      const badId = obj2({ id: 'OBJ_x' })
      expect(codeOf(captureError(() => h.service.objectives.saveObjectives([badId], USER_ACTOR)))).toBe('ACT_INPUT')
      const noStatement = obj2({ statement: '' })
      expect(codeOf(captureError(() => h.service.objectives.saveObjectives([noStatement], USER_ACTOR)))).toBe('ACT_INPUT')
    } finally {
      h.close()
    }
  })

  it('a legal save adds the objective + records it in the ledger (「OBJ-2 added」diff)', () => {
    const h = openActionsHarness()
    try {
      const base = h.service.objectives.loadObjectives().objectives
      const result = h.service.objectives.saveObjectives([...base, obj2()], USER_ACTOR)
      expect(result.managementActionId).toBe('MA-1')
      const ma = h.rawDb.prepare('SELECT * FROM management_action WHERE id = ?').get('MA-1') as Record<string, string>
      expect(ma.detail).toContain('OBJ-2 added')
      expect(h.service.objectives.loadObjectives().objectives.map((o) => o.id)).toEqual(['OBJ-1', 'OBJ-2'])
    } finally {
      h.close()
    }
  })
})

describe('后置校验补偿 + 新建/坏树面', () => {
  it('writer fault corrupting the written bytes ⇒ post-validation restores the previous bytes (OBJ_FILE)', () => {
    const h = openActionsHarness()
    try {
      const previous = h.fs.content(OBJECTIVES_PATH)
      const base = h.service.objectives.loadObjectives().objectives
      h.fs.corruptNextWrite() // 原子写「成功」但字节被破坏（模拟写后损坏）

      const err = captureError(() => h.service.objectives.saveObjectives([...base, obj2()], USER_ACTOR))
      expect(err.code).toBe('OBJ_FILE')
      expect(err.message).toContain('post-validation')
      // 补偿: 旧字节恢复, OBJ-2 不在盘上:
      expect(h.fs.content(OBJECTIVES_PATH)).toBe(previous)
      expect(h.fs.content(OBJECTIVES_PATH)).not.toContain('OBJ-2')
      // 账本无行（协议在账本前失败）:
      expect(h.rawDb.prepare('SELECT COUNT(*) AS n FROM management_action').get() as { n: number }).toEqual({ n: 0 })
    } finally {
      h.close()
    }
  })

  it('a broken tree refuses the write (no stacking on a broken tree)', () => {
    const h = openActionsHarness()
    try {
      h.fs.reader.addFile(`${OBJECTIVES_PATH}`, 'objectives: [broken\n')
      const err = captureError(() => h.service.objectives.saveObjectives([obj2()], USER_ACTOR))
      expect(err.code).toBe('OBJ_FILE')
      expect(err.message).toContain('refusing to write on a broken tree')
      const err2 = captureError(() => h.service.objectives.loadObjectives())
      expect(err2.code).toBe('OBJ_FILE')
    } finally {
      h.close()
    }
  })
})

