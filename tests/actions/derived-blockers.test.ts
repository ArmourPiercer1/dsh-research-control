/**
 * UI-4 (D §10, D1) — `deriveWorkstreamBlockers` 纯投影单元测试
 * （ADJ-3 / ADJ-4 — 无 I/O, 无 DSH import, 纯输入 → 确定性输出）。
 *
 * 覆盖（模块头 = 规则集权威, ADJ-3 锁定）:
 *  - focus gating: focusTaskId null / 非 Task id ⇒ 两规则全灭（短路 []）;
 *    Task 语法但不在 canonicalOrder ⇒ DEPENDENCY 照发, GATE 规则跳过;
 *  - ① DEPENDENCY: focus Task 的 ACTIVE 出向 DEPENDS_ON 边, 目标
 *    KNOWN 且 ≠ EXECUTED（removed 边落、EXECUTED/未知目标落、边过滤器 —
 *    relation_type / source kind / source id / target kind; 坏 payload 忽略）;
 *  - ② GATE: 每 Gate 的 LATEST GATE_EVALUATED（审计序覆盖）, 限定 canonical
 *    序中 focus 之前（无事件 = PLANNED = 无; focus 之后的 FAILED = 无;
 *    WAIVED ≠ FAILED; 非 Gate id 不点火）;
 *  - 确定性: 源词表序（DEPENDENCY < GATE）+ 自然数值 ref 序
 *    （T-2 < T-10, G-2 < G-11）; 同输入恒同输出（e2e reload-no-drift 门
 *    的单元面）。
 */

import { describe, expect, it } from 'vitest'

import {
  deriveWorkstreamBlockers,
  type DerivedBlocker,
  type DerivedBlockerEvent,
  type DerivedBlockersInput,
} from '../../src/host/service/actions/index.js'

/** 基线 canonical 序（tests/loader/fixtures APPENDIX_A_PLAN_YAML, WS-1）。 */
const CANONICAL = ['G-1', 'T-1', 'T-2', 'T-3', 'M-1', 'T-4', 'G-2'] as const

const BASE_EXECUTION: Record<string, string> = {
  'T-1': 'EXECUTED',
  'T-2': 'ACTIVE',
  'T-3': 'PLANNED',
  'T-4': 'PLANNED',
}

function run(over: Partial<DerivedBlockersInput> = {}): readonly DerivedBlocker[] {
  return deriveWorkstreamBlockers({
    workstreamId: 'WS-1',
    focusTaskId: 'T-2',
    canonicalOrder: CANONICAL,
    taskExecution: BASE_EXECUTION,
    events: [],
    ...over,
  })
}

function ev(seq: number, eventType: string, payload: unknown): DerivedBlockerEvent {
  return { eventSeq: seq, eventType, payload }
}

/** 一条 RELATION_ADDED 边（默认 focus T-2 → target T-3 的 DEPENDS_ON 形）。 */
function edge(
  seq: number,
  over: { relationId?: string; relationType?: string; sourceKind?: string; sourceId?: string; targetKind?: string; targetId?: string } = {},
): DerivedBlockerEvent {
  return ev(seq, 'RELATION_ADDED', {
    relation_id: over.relationId ?? 'REL-7',
    relation_type: over.relationType ?? 'DEPENDS_ON',
    source: { kind: over.sourceKind ?? 'TASK', id: over.sourceId ?? 'T-2' },
    target: { kind: over.targetKind ?? 'TASK', id: over.targetId ?? 'T-3' },
  })
}

function gateEvaluated(seq: number, gateId: string, result: string): DerivedBlockerEvent {
  return ev(seq, 'GATE_EVALUATED', { gate_id: gateId, result, evaluated_by: { kind: 'USER' } })
}

describe('focus gating（两规则共同锚点）', () => {
  it('focusTaskId null ⇒ []（即使有 FAILED gate + active 依赖边）', () => {
    const out = run({
      focusTaskId: null,
      events: [edge(1), gateEvaluated(2, 'G-1', 'FAILED')],
    })
    expect(out).toEqual([])
  })

  it('非 Task 的 focus id（G-1 — 非 T- 语法）⇒ []', () => {
    const out = run({
      focusTaskId: 'G-1',
      events: [
        ev(1, 'RELATION_ADDED', {
          relation_id: 'REL-7',
          relation_type: 'DEPENDS_ON',
          source: { kind: 'GATE', id: 'G-1' },
          target: { kind: 'TASK', id: 'T-3' },
        }),
        gateEvaluated(2, 'G-1', 'FAILED'),
      ],
    })
    expect(out).toEqual([])
  })

  it('Task 语法但不在 canonicalOrder（T-99）⇒ DEPENDENCY 照发, GATE 规则跳过（focusIndex = -1）', () => {
    const out = run({
      focusTaskId: 'T-99',
      events: [
        edge(1, { sourceId: 'T-99', targetId: 'T-3' }),
        gateEvaluated(2, 'G-1', 'FAILED'),
      ],
    })
    expect(out.map((b) => b.id)).toEqual(['DERIVED-DEPENDENCY-T-3'])
  })
})

describe('规则 ① DEPENDENCY（ACTIVE 出向边 × 目标 KNOWN 未完成）', () => {
  it('命中边 ⇒ 完整形状（id / source / statement / reasonRefs / primaryAction 逐字）', () => {
    const out = run({ events: [edge(1)] })
    expect(out).toEqual([
      {
        id: 'DERIVED-DEPENDENCY-T-3',
        source: 'DEPENDENCY',
        statement: 'Blocked by dependency on T-3',
        reasonRefs: ['REL-7', 'T-3'],
        primaryAction: { label: 'Open T-3', targetKind: 'TASK', targetId: 'T-3' },
      },
    ])
  })

  it('RELATION_REMOVED（同 relation_id）⇒ 边落, 无 blocker', () => {
    const out = run({
      events: [edge(1), ev(2, 'RELATION_REMOVED', { relation_id: 'REL-7' })],
    })
    expect(out).toEqual([])
  })

  it('REMOVE 后同 relation_id 重新 ADD ⇒ 边复活, 重新点火', () => {
    const out = run({
      events: [edge(1), ev(2, 'RELATION_REMOVED', { relation_id: 'REL-7' }), edge(3)],
    })
    expect(out.map((b) => b.id)).toEqual(['DERIVED-DEPENDENCY-T-3'])
    expect(out[0]!.reasonRefs).toEqual(['REL-7', 'T-3'])
  })

  it('目标 EXECUTED（T-1）⇒ 无 blocker（已完成不算未完成）', () => {
    const out = run({ events: [edge(1, { targetId: 'T-1' })] })
    expect(out).toEqual([])
  })

  it('目标未知（T-9 不在 taskExecution — 跨 WS 不可见）⇒ 无 blocker（未证明未完成）', () => {
    const out = run({ events: [edge(1, { targetId: 'T-9' })] })
    expect(out).toEqual([])
  })

  it('目标 CANCELLED ⇒ KNOWN 且 ≠ EXECUTED ⇒ 点火', () => {
    const out = run({
      taskExecution: { ...BASE_EXECUTION, 'T-3': 'CANCELLED' },
      events: [edge(1)],
    })
    expect(out.map((b) => b.id)).toEqual(['DERIVED-DEPENDENCY-T-3'])
  })

  it('边过滤器: 错 relation_type / 非 TASK source / source ≠ focus / 非 TASK target 全不点火', () => {
    expect(run({ events: [edge(1, { relationType: 'SUPPORTED_BY' })] })).toEqual([])
    expect(run({ events: [edge(1, { sourceKind: 'CLAIM', sourceId: 'C-1' })] })).toEqual([])
    expect(run({ events: [edge(1, { sourceId: 'T-1' })] })).toEqual([])
    expect(run({ events: [edge(1, { targetKind: 'GATE', targetId: 'G-2' })] })).toEqual([])
    expect(run({ events: [edge(1, { targetKind: 'MILESTONE', targetId: 'M-1' })] })).toEqual([])
    expect(run({ events: [edge(1, { targetKind: 'WORKSTREAM', targetId: 'WS-2' })] })).toEqual([])
  })

  it('坏 payload 全忽略（非 record / 缺 relation_id / 缺 source / 缺 target）', () => {
    const out = run({
      events: [
        ev(1, 'RELATION_ADDED', ['not', 'a', 'record']),
        ev(2, 'RELATION_ADDED', { relation_type: 'DEPENDS_ON', source: { kind: 'TASK', id: 'T-2' }, target: { kind: 'TASK', id: 'T-3' } }),
        ev(3, 'RELATION_ADDED', { relation_id: 'REL-8', relation_type: 'DEPENDS_ON', target: { kind: 'TASK', id: 'T-3' } }),
        ev(4, 'RELATION_ADDED', { relation_id: 'REL-9', relation_type: 'DEPENDS_ON', source: { kind: 'TASK', id: 'T-2' } }),
      ],
    })
    expect(out).toEqual([])
  })

  it('非 focus 的出向边（T-1 → T-3, focus = T-2）⇒ 不点火', () => {
    const out = run({ events: [edge(1, { sourceId: 'T-1' })] })
    expect(out).toEqual([])
  })
})

describe('规则 ② GATE（LATEST 审计序覆盖 × canonical 序 focus 之前）', () => {
  it('focus 之前的 Gate FAILED ⇒ 完整形状', () => {
    const out = run({ events: [gateEvaluated(1, 'G-1', 'FAILED')] })
    expect(out).toEqual([
      {
        id: 'DERIVED-GATE-G-1',
        source: 'GATE',
        statement: 'Blocked by Gate G-1',
        reasonRefs: ['G-1'],
        primaryAction: { label: 'Open G-1', targetKind: 'GATE', targetId: 'G-1' },
      },
    ])
  })

  it('FAILED 之后 LATEST = PASSED（审计序覆盖）⇒ 无 blocker', () => {
    const out = run({ events: [gateEvaluated(1, 'G-1', 'FAILED'), gateEvaluated(2, 'G-1', 'PASSED')] })
    expect(out).toEqual([])
  })

  it('PASSED 之后 LATEST = FAILED ⇒ 点火', () => {
    const out = run({ events: [gateEvaluated(1, 'G-1', 'PASSED'), gateEvaluated(2, 'G-1', 'FAILED')] })
    expect(out.map((b) => b.id)).toEqual(['DERIVED-GATE-G-1'])
  })

  it('无事件（PLANNED — gate state 无字段, 只有历史折叠）⇒ 无 blocker', () => {
    const out = run({})
    expect(out).toEqual([])
  })

  it('focus 之后的 Gate FAILED（G-2）⇒ 无 blocker', () => {
    const out = run({ events: [gateEvaluated(1, 'G-2', 'FAILED')] })
    expect(out).toEqual([])
  })

  it('非 Gate id（M-1 milestone 的 GATE_EVALUATED — 坏数据）⇒ 不点火', () => {
    const out = run({ events: [gateEvaluated(1, 'M-1', 'FAILED')] })
    expect(out).toEqual([])
  })

  it('LATEST = WAIVED（≠ FAILED）⇒ 无 blocker', () => {
    const out = run({ events: [gateEvaluated(1, 'G-1', 'FAILED'), gateEvaluated(2, 'G-1', 'WAIVED')] })
    expect(out).toEqual([])
  })
})

describe('确定性与输出序（reload-no-drift 门单元面）', () => {
  it('混合源: DEPENDENCY 全在 GATE 前; 自然数值 ref 序 T-2 < T-10, G-2 < G-11', () => {
    const out = run({
      focusTaskId: 'T-99',
      canonicalOrder: ['G-11', 'G-2', 'T-2', 'T-10', 'T-99'],
      taskExecution: { 'T-2': 'PLANNED', 'T-10': 'PLANNED', 'T-99': 'ACTIVE' },
      events: [
        gateEvaluated(1, 'G-11', 'FAILED'),
        gateEvaluated(2, 'G-2', 'FAILED'),
        edge(3, { relationId: 'REL-9', sourceId: 'T-99', targetId: 'T-10' }),
        edge(4, { relationId: 'REL-8', sourceId: 'T-99', targetId: 'T-2' }),
      ],
    })
    expect(out.map((b) => b.id)).toEqual([
      'DERIVED-DEPENDENCY-T-2',
      'DERIVED-DEPENDENCY-T-10',
      'DERIVED-GATE-G-2',
      'DERIVED-GATE-G-11',
    ])
    expect(out.map((b) => b.source)).toEqual(['DEPENDENCY', 'DEPENDENCY', 'GATE', 'GATE'])
  })

  it('同输入恒同输出（两次调用深相等 — 投影无随机面）', () => {
    const input: DerivedBlockersInput = {
      workstreamId: 'WS-1',
      focusTaskId: 'T-3',
      canonicalOrder: CANONICAL,
      taskExecution: BASE_EXECUTION,
      events: [
        edge(1, { relationId: 'REL-1', sourceId: 'T-3', targetId: 'T-4' }),
        gateEvaluated(2, 'G-1', 'FAILED'),
        gateEvaluated(3, 'G-2', 'FAILED'),
      ],
    }
    expect(deriveWorkstreamBlockers(input)).toEqual(deriveWorkstreamBlockers(input))
    expect(deriveWorkstreamBlockers(input).map((b) => b.id)).toEqual([
      'DERIVED-DEPENDENCY-T-4',
      'DERIVED-GATE-G-1',
    ])
  })
})
