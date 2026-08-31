/**
 * UI-8 (D §14) — `src/host/service/attention/unified.ts` 单元测试（纯函数
 * 层 — 注入式 sources, 零 I/O）。
 *
 * 覆盖矩阵:
 *  - 评分上下文形状 unit-pin（红线: 零伪造 — `{now, projectImportance: 0,
 *    attentionMode: 'NORMAL'}` 逐字段冻结）;
 *  - 5 类映射（IV 3 态 / 显式 BLK 2 态 / NA 3 态 / derived 投影 /
 *    missing-NA 合成 — ADJ-3 收紧条件逐字: 触发 + PROMOTED 抑制 +
 *    PROPOSED 并存不抑制 + DROPPED 控制项 + 文件序首匹配）;
 *  - 冻结 §7 allowedActions 表（含 PENDING-IV 无 openWorkstream —
 *    RECON §7 冻结表优先; 导航 token 目标缺席时机械省略）;
 *  - ADJ-2 priority 带边界（110/100/85/50 → HIGH/MEDIUM/MEDIUM/MEDIUM;
 *    40 → LOW; 终态 0 → LOW）;
 *  - 全序（score 降序 → TYPE_RANK → createdAt 升序 → id 升序; 终态尾段
 *    createdAt 降序 → id 升序; rank 1-based 跨项目）;
 *  - 过滤（kind/status 精确匹配/priority/workstreamId）+ total/offset/
 *    limit（默认 50 / 上限 200 钳制 / 只截断不重排）;
 *  - `workstreamId` 无 `projectId` ⇒ fail-loud;
 *  - 零写面: 输入对象 Object.freeze 深冻结后收集仍成功（零变异）+
 *    sources 面调用白名单（只有 8 个只读面被调用）;
 *  - 确定性: 同输入 → 同输出; 输入乱序 → 同输出序。
 */
import { describe, expect, it } from 'vitest'

import {
  MISSING_NA_TITLE,
  assembleProjectAttention,
  assembleUnified,
  collectProjectAttention,
  queryUnifiedAttention,
  unifiedAttentionContext,
  type AttentionEventView,
  type AttentionWorkstreamNode,
  type ProjectAttentionSources,
  type ScoreableCandidate,
  type TerminalCandidate,
} from '../../src/host/service/attention/unified.js'
import type { AttentionItemDto } from '../../src/shared/rpc-contracts.js'
import type { BlockerRecord, NextActionRecord } from '../../src/host/service/actions/types.js'
import type { ObjectiveDoc } from '../../src/host/domain/loader/types.js'
import type { InterventionRecord } from '../../src/host/service/flooding/types.js'

/** 确定性时钟原点（同 tests/attention/fixtures.ts T_NOW）。 */
const T_NOW = Date.parse('2026-08-22T09:00:00Z')

const USER = { kind: 'USER' as const }

/* ===================================================================== *
 * fixture 构造器
 * ===================================================================== */

function makeIv(over: Partial<InterventionRecord> = {}): InterventionRecord {
  return {
    id: 'IV-1',
    title: 'Review accumulated agent plan forks [WS-1]',
    origin: 'AUTO_FLOODING',
    workstream_ids: ['WS-1'],
    source_refs: [{ kind: 'PLAN_FORK', id: 'PF-1' }],
    status: 'OPEN',
    created_by: USER,
    created_at: 1_000,
    ...over,
  }
}

function makeNa(over: Partial<NextActionRecord> = {}): NextActionRecord {
  return {
    id: 'NA-1',
    workstream_id: 'WS-1',
    statement: 'Draft the baseline schema for the fork review',
    status: 'PROPOSED',
    created_by: USER,
    created_at: 3_000,
    ...over,
  }
}

function makeBlk(over: Partial<BlockerRecord> = {}): BlockerRecord {
  return {
    id: 'BLK-1',
    statement: 'Upstream API contract is frozen until the vendor reply',
    affects: [{ kind: 'WORKSTREAM', id: 'WS-1' }, { kind: 'TASK', id: 'T-2' }],
    status: 'ACTIVE',
    source: 'user report',
    created_at: 2_000,
    ...over,
  }
}

function makeObjective(over: Partial<ObjectiveDoc> = {}): ObjectiveDoc {
  return {
    id: 'OBJ-1',
    scope: 'TOPIC',
    topic_id: 'TPC-1',
    statement: 'Ship the unified attention list',
    success_criteria: ['D §14 page lands'],
    status: 'ACTIVE',
    priority: 'P1',
    linked_refs: [{ kind: 'WORKSTREAM', id: 'WS-1' }],
    created_at: 500,
    ...over,
  }
}

/** 无 derived/missing 投影的最小 sources（空 WS 节点列表）。 */
function makeSources(over: Partial<ProjectAttentionSources> = {}): ProjectAttentionSources {
  return {
    projectId: 'PRJ-1',
    listInterventions: () => [],
    listBlockers: () => [],
    listNextActions: () => [],
    listObjectives: () => [],
    listWorkstreamNodes: () => [],
    listEvents: () => [],
    currentFocusPlanItem: () => null,
    awarenessState: () => null,
    ...over,
  }
}

/** WS 节点: T-1/T-2 任务 + plan 序 [G-1, T-1, T-2] + CF→T-1。 */
function makeWsNode(over: Partial<AttentionWorkstreamNode> = {}): AttentionWorkstreamNode {
  return {
    id: 'WS-1',
    taskIds: ['T-1', 'T-2'],
    canonicalOrder: ['G-1', 'T-1', 'T-2'],
    ...over,
  }
}

/** G-1 FAILED 事件（derived GATE 规则的触发输入 — audit seq 序）。 */
function gateFailedEvent(gateId = 'G-1', seq = 1): AttentionEventView {
  return { eventSeq: seq, eventType: 'GATE_EVALUATED', payload: { gate_id: gateId, result: 'FAILED' } }
}

/** focus=T-1, 依赖边 T-1→T-2（derived DEPENDENCY 规则触发输入）。 */
function depEdgeEvent(seq = 2): AttentionEventView {
  return {
    eventSeq: seq,
    eventType: 'RELATION_ADDED',
    payload: {
      relation_id: 'REL-1',
      relation_type: 'DEPENDS_ON',
      source: { kind: 'TASK', id: 'T-1' },
      target: { kind: 'TASK', id: 'T-2' },
    },
  }
}

/* ===================================================================== *
 * 评分上下文形状（红线 pin）
 * ===================================================================== */

describe('unifiedAttentionContext — 形状冻结（unit-pin）', () => {
  it('returns exactly {now, projectImportance: 0, attentionMode: "NORMAL"}', () => {
    expect(unifiedAttentionContext(T_NOW)).toEqual({ now: T_NOW, projectImportance: 0, attentionMode: 'NORMAL' })
    // 键集冻结（无多余键 — strict 形状）。
    expect(Object.keys(unifiedAttentionContext(0)).sort()).toEqual(['attentionMode', 'now', 'projectImportance'])
  })
})

/* ===================================================================== *
 * 5 类映射
 * ===================================================================== */

describe('collectProjectAttention — INTERVENTION 映射', () => {
  it('OPEN IV → scoreable 候选（sourceRef=source_refs[0]; ws=workstream_ids[0]; context.origin）', () => {
    const c = collectProjectAttention(
      makeSources({ listInterventions: () => [makeIv()] }),
      T_NOW,
    )
    expect(c.scoreables).toHaveLength(1)
    expect(c.terminals).toHaveLength(0)
    const [s] = c.scoreables
    expect(s.scorer).toMatchObject({ kind: 'INTERVENTION', id: 'IV-1', status: 'OPEN', origin: 'AUTO_FLOODING', workstreamId: 'WS-1' })
    expect(s.dto).toMatchObject({
      kind: 'INTERVENTION',
      sourceId: 'IV-1',
      sourceRef: { kind: 'PLAN_FORK', id: 'PF-1' },
      projectId: 'PRJ-1',
      workstreamId: 'WS-1',
      title: 'Review accumulated agent plan forks [WS-1]',
      status: 'OPEN',
      createdAt: 1_000,
      detectedAt: 1_000,
      context: { intervention: { origin: 'AUTO_FLOODING' } },
    })
    // 冻结 §7 表: OPEN → markPending/closeIntervention/openWorkstream。
    expect(s.dto.allowedActions).toEqual(['markPending', 'closeIntervention', 'openWorkstream'])
  })

  it('PENDING IV → 冻结表无 openWorkstream（RECON §7 优先于 R 候选 — 有 WS 也不得出现）', () => {
    const c = collectProjectAttention(
      makeSources({ listInterventions: () => [makeIv({ id: 'IV-2', status: 'PENDING' })] }),
      T_NOW,
    )
    const [s] = c.scoreables
    expect(s.dto.allowedActions).toEqual(['reopenIntervention', 'closeIntervention'])
    expect(s.dto.status).toBe('PENDING')
  })

  it('CLOSED IV → 终态候选（allowedActions 空; 无 scorer 输入）', () => {
    const c = collectProjectAttention(
      makeSources({ listInterventions: () => [makeIv({ status: 'CLOSED', closed_at: 9_000 })] }),
      T_NOW,
    )
    expect(c.scoreables).toHaveLength(0)
    expect(c.terminals).toHaveLength(1)
    const [t] = c.terminals
    expect(t.dto).toMatchObject({ kind: 'INTERVENTION', sourceId: 'IV-1', status: 'CLOSED' })
    expect(t.dto.allowedActions).toEqual([])
  })

  it('无 WS 关联的 OPEN IV → workstreamId=null 且 openWorkstream 机械省略', () => {
    const c = collectProjectAttention(
      makeSources({ listInterventions: () => [makeIv({ workstream_ids: [] })] }),
      T_NOW,
    )
    const [s] = c.scoreables
    expect(s.dto.workstreamId).toBeNull()
    expect(s.dto.allowedActions).toEqual(['markPending', 'closeIntervention'])
  })

  it('空 source_refs → 自指 fallback（防御性; 不伪造外部 ref）', () => {
    const c = collectProjectAttention(
      makeSources({ listInterventions: () => [makeIv({ source_refs: [] })] }),
      T_NOW,
    )
    expect(c.scoreables[0]!.dto.sourceRef).toEqual({ kind: 'INTERVENTION', id: 'IV-1' })
  })

  it('awareness 记录注入 scorer 输入（REVIEWED ⇒ 无 UNSEEN gap）', () => {
    const c = collectProjectAttention(
      makeSources({
        listInterventions: () => [makeIv()],
        awarenessState: (id) => (id === 'IV-1' ? 'REVIEWED' : null),
      }),
      T_NOW,
    )
    const dto = assembleProjectAttention(c, T_NOW)[0]!
    expect(dto.score).toBe(100) // 100（OPEN）+ 0（非 UNSEEN）
    expect(dto.priority).toBe('HIGH')
  })
})

describe('collectProjectAttention — 显式 BLOCKER 映射', () => {
  it('ACTIVE BLK → scoreable（ws = affects 第一个 WORKSTREAM ref; 动作表冻结）', () => {
    const c = collectProjectAttention(makeSources({ listBlockers: () => [makeBlk()] }), T_NOW)
    const [s] = c.scoreables
    expect(s.scorer).toMatchObject({ kind: 'BLOCKER', id: 'BLK-1', status: 'ACTIVE', workstreamId: 'WS-1' })
    expect(s.dto).toMatchObject({
      kind: 'EXPLICIT_BLOCKER',
      sourceId: 'BLK-1',
      sourceRef: { kind: 'BLOCKER', id: 'BLK-1' },
      workstreamId: 'WS-1',
      title: 'Upstream API contract is frozen until the vendor reply',
      status: 'ACTIVE',
      createdAt: 2_000,
      detectedAt: 2_000,
      context: {},
    })
    expect(s.dto.allowedActions).toEqual(['clearBlocker', 'openWorkstream'])
  })

  it('CLEARED BLK → 终态候选', () => {
    const c = collectProjectAttention(makeSources({ listBlockers: () => [makeBlk({ status: 'CLEARED', cleared_at: 9_000 })] }), T_NOW)
    expect(c.scoreables).toHaveLength(0)
    expect(c.terminals[0]!.dto).toMatchObject({ kind: 'EXPLICIT_BLOCKER', status: 'CLEARED' })
    expect(c.terminals[0]!.dto.allowedActions).toEqual([])
  })

  it('affects 无 WORKSTREAM ref → workstreamId=null（INV-ATTN-1: 不隐藏）', () => {
    const c = collectProjectAttention(
      makeSources({ listBlockers: () => [makeBlk({ affects: [{ kind: 'TASK', id: 'T-1' }] })] }),
      T_NOW,
    )
    const [s] = c.scoreables
    expect(s.dto.workstreamId).toBeNull()
    expect(s.dto.allowedActions).toEqual(['clearBlocker'])
  })
})

describe('collectProjectAttention — NEXT_ACTION 映射', () => {
  it('PROPOSED NA → scoreable（context.promotedToTaskId=null; 动作表冻结）', () => {
    const c = collectProjectAttention(makeSources({ listNextActions: () => [makeNa()] }), T_NOW)
    const [s] = c.scoreables
    expect(s.scorer).toMatchObject({ kind: 'NEXT_ACTION', id: 'NA-1', status: 'PROPOSED', workstreamId: 'WS-1' })
    expect(s.dto).toMatchObject({
      kind: 'NEXT_ACTION',
      sourceId: 'NA-1',
      sourceRef: { kind: 'NEXT_ACTION', id: 'NA-1' },
      workstreamId: 'WS-1',
      status: 'PROPOSED',
      context: { nextAction: { promotedToTaskId: null } },
    })
    expect(s.dto.allowedActions).toEqual(['promoteNextAction', 'dismissNextAction', 'openWorkstream'])
  })

  it('PROMOTED NA → 终态（openTask + context.promotedToTaskId 回填）', () => {
    const c = collectProjectAttention(
      makeSources({ listNextActions: () => [makeNa({ status: 'PROMOTED', promoted_to_task_id: 'T-9' })] }),
      T_NOW,
    )
    expect(c.terminals).toHaveLength(1)
    const t = c.terminals[0]!
    expect(t.dto).toMatchObject({
      kind: 'NEXT_ACTION',
      status: 'PROMOTED',
      context: { nextAction: { promotedToTaskId: 'T-9' } },
    })
    expect(t.dto.allowedActions).toEqual(['openTask'])
  })

  it('PROMOTED 但 promoted_to_task_id 缺席（防御）→ openTask 机械省略', () => {
    const c = collectProjectAttention(
      makeSources({ listNextActions: () => [makeNa({ status: 'PROMOTED' })] }),
      T_NOW,
    )
    expect(c.terminals[0]!.dto.allowedActions).toEqual([])
    expect(c.terminals[0]!.dto.context).toEqual({ nextAction: { promotedToTaskId: null } })
  })

  it('DISMISSED NA → 终态（空动作面）', () => {
    const c = collectProjectAttention(makeSources({ listNextActions: () => [makeNa({ status: 'DISMISSED' })] }), T_NOW)
    expect(c.terminals[0]!.dto).toMatchObject({ kind: 'NEXT_ACTION', status: 'DISMISSED' })
    expect(c.terminals[0]!.dto.allowedActions).toEqual([])
  })
})

describe('collectProjectAttention — DERIVED_BLOCKER 投影', () => {
  it('G-1 FAILED 且早于 focus T-1 → DERIVED-GATE 候选（createdAt=0; openCause; primaryAction 回填）', () => {
    const c = collectProjectAttention(
      makeSources({
        listWorkstreamNodes: () => [makeWsNode()],
        listEvents: () => [gateFailedEvent()],
        currentFocusPlanItem: (ws) => (ws === 'WS-1' ? 'T-1' : null),
      }),
      T_NOW,
    )
    expect(c.scoreables).toHaveLength(1)
    const [s] = c.scoreables
    expect(s.scorer).toMatchObject({ kind: 'BLOCKER', id: 'DERIVED-GATE-G-1', status: 'ACTIVE', workstreamId: 'WS-1', createdAt: 0 })
    expect(s.dto).toMatchObject({
      kind: 'DERIVED_BLOCKER',
      sourceId: 'DERIVED-GATE-G-1',
      sourceRef: { kind: 'DERIVED_BLOCKER', id: 'DERIVED-GATE-G-1' },
      status: 'ACTIVE',
      createdAt: 0,
      detectedAt: 0,
      allowedActions: ['openCause'],
      context: { derivedBlocker: { primaryAction: { label: 'Open G-1', targetKind: 'GATE', targetId: 'G-1' } } },
    })
  })

  it('focus T-1 → T-2 依赖边（T-2 非 EXECUTED）→ DERIVED-DEPENDENCY 候选', () => {
    const c = collectProjectAttention(
      makeSources({
        listWorkstreamNodes: () => [makeWsNode()],
        listEvents: () => [depEdgeEvent()],
        currentFocusPlanItem: (ws) => (ws === 'WS-1' ? 'T-1' : null),
      }),
      T_NOW,
    )
    const [s] = c.scoreables
    expect(s.scorer).toMatchObject({ id: 'DERIVED-DEPENDENCY-T-2', status: 'ACTIVE' })
    expect(s.dto.context).toEqual({
      derivedBlocker: { primaryAction: { label: 'Open T-2', targetKind: 'TASK', targetId: 'T-2' } },
    })
  })

  it('无 CF 指针 → 两条 derived 规则均短路（零候选）', () => {
    const c = collectProjectAttention(
      makeSources({
        listWorkstreamNodes: () => [makeWsNode()],
        listEvents: () => [gateFailedEvent(), depEdgeEvent()],
        currentFocusPlanItem: () => null,
      }),
      T_NOW,
    )
    expect(c.scoreables).toHaveLength(0)
  })

  it('G-1 PASSED（非 FAILED）→ GATE 规则不触发', () => {
    const c = collectProjectAttention(
      makeSources({
        listWorkstreamNodes: () => [makeWsNode()],
        listEvents: () => [{ eventSeq: 1, eventType: 'GATE_EVALUATED', payload: { gate_id: 'G-1', result: 'PASSED' } }],
        currentFocusPlanItem: () => 'T-1',
      }),
      T_NOW,
    )
    expect(c.scoreables).toHaveLength(0)
  })

  it('TASK_EXECUTION_CHANGED 折叠: 依赖目标 T-2 EXECUTED → DEPENDENCY 规则不触发', () => {
    const events: AttentionEventView[] = [
      depEdgeEvent(),
      { eventSeq: 3, eventType: 'TASK_EXECUTION_CHANGED', payload: { task_id: 'T-2', from: 'PLANNED', to: 'EXECUTED' } },
    ]
    const c = collectProjectAttention(
      makeSources({
        listWorkstreamNodes: () => [makeWsNode()],
        listEvents: () => events,
        currentFocusPlanItem: () => 'T-1',
      }),
      T_NOW,
    )
    expect(c.scoreables).toHaveLength(0)
  })
})

describe('collectProjectAttention — MISSING_NEXT_ACTION（ADJ-3 逐字条件）', () => {
  const wsSources = (objectives: readonly ObjectiveDoc[], nas: readonly NextActionRecord[]) =>
    makeSources({
      listObjectives: () => objectives,
      listNextActions: () => nas,
      listWorkstreamNodes: () => [makeWsNode()],
    })

  it('触发: ACTIVE objective 链接 WS-1 ∧ 无 PROMOTED NA ⇒ 恰一条合成项', () => {
    const c = collectProjectAttention(wsSources([makeObjective()], []), T_NOW)
    expect(c.scoreables).toHaveLength(1)
    const [s] = c.scoreables
    expect(s.scorer).toMatchObject({ kind: 'NEXT_ACTION', id: 'MISSING-NA-WS-1', title: MISSING_NA_TITLE, workstreamId: 'WS-1', createdAt: T_NOW })
    expect(s.dto).toMatchObject({
      kind: 'MISSING_NEXT_ACTION',
      sourceId: 'MISSING-NA-WS-1',
      syntheticKey: 'MISSING-NA-WS-1',
      sourceRef: { kind: 'OBJECTIVE', id: 'OBJ-1' },
      title: 'Missing Next Action',
      status: 'OPEN',
      createdAt: T_NOW,
      detectedAt: T_NOW,
      allowedActions: ['createNextAction'],
      context: { missingNextAction: { objectiveId: 'OBJ-1' } },
    })
    expect(MISSING_NA_TITLE).toBe('Missing Next Action') // B §31 冻结文案逐字
  })

  it('PROPOSED NA 并存**不**抑制（RECON §6.3 旧建议被 BRIEF ADJ-3 取代 — 显式 pin）', () => {
    const c = collectProjectAttention(wsSources([makeObjective()], [makeNa()]), T_NOW)
    const missing = c.scoreables.filter((s) => s.dto.kind === 'MISSING_NEXT_ACTION')
    expect(missing).toHaveLength(1)
    expect(missing[0]!.dto.syntheticKey).toBe('MISSING-NA-WS-1')
  })

  it('PROMOTED NA（同 WS）抑制合成项', () => {
    const c = collectProjectAttention(
      wsSources([makeObjective()], [makeNa({ status: 'PROMOTED', promoted_to_task_id: 'T-9' })]),
      T_NOW,
    )
    expect(c.scoreables.filter((s) => s.dto.kind === 'MISSING_NEXT_ACTION')).toHaveLength(0)
  })

  it('PROMOTED NA 在**别的** WS → 不抑制本 WS 的合成项', () => {
    const c = collectProjectAttention(
      wsSources([makeObjective()], [makeNa({ id: 'NA-9', workstream_id: 'WS-2', status: 'PROMOTED', promoted_to_task_id: 'T-9' })]),
      T_NOW,
    )
    expect(c.scoreables.filter((s) => s.dto.kind === 'MISSING_NEXT_ACTION')).toHaveLength(1)
  })

  it('控制项: DROPPED objective 不触发; ACHIEVED 不触发; 未链接 WS 不触发', () => {
    expect(collectProjectAttention(wsSources([makeObjective({ status: 'DROPPED' })], []), T_NOW).scoreables).toHaveLength(0)
    expect(collectProjectAttention(wsSources([makeObjective({ status: 'ACHIEVED' })], []), T_NOW).scoreables).toHaveLength(0)
    expect(
      collectProjectAttention(wsSources([makeObjective({ linked_refs: [{ kind: 'WORKSTREAM', id: 'WS-9' }] })], []), T_NOW).scoreables,
    ).toHaveLength(0)
  })

  it('无 objective → 不触发; 无 WS 节点 → 不触发', () => {
    expect(collectProjectAttention(wsSources([], []), T_NOW).scoreables).toHaveLength(0)
    expect(
      collectProjectAttention(
        makeSources({ listObjectives: () => [makeObjective()] }),
        T_NOW,
      ).scoreables,
    ).toHaveLength(0)
  })

  it('两个 ACTIVE objective 同链 WS-1 → 恰一条合成项; objectiveId = 文件序首个', () => {
    const c = collectProjectAttention(
      wsSources([makeObjective({ id: 'OBJ-1' }), makeObjective({ id: 'OBJ-2' })], []),
      T_NOW,
    )
    const missing = c.scoreables.filter((s) => s.dto.kind === 'MISSING_NEXT_ACTION')
    expect(missing).toHaveLength(1)
    expect(missing[0]!.dto.context).toEqual({ missingNextAction: { objectiveId: 'OBJ-1' } })
  })

  it('多 WS 各带 ACTIVE objective → per-WS 一条合成项（key 含 wsId）', () => {
    const c = collectProjectAttention(
      makeSources({
        listObjectives: () => [makeObjective({ id: 'OBJ-1' }), makeObjective({ id: 'OBJ-3', linked_refs: [{ kind: 'WORKSTREAM', id: 'WS-2' }] })],
        listWorkstreamNodes: () => [makeWsNode(), makeWsNode({ id: 'WS-2', taskIds: [], canonicalOrder: [] })],
      }),
      T_NOW,
    )
    const missing = c.scoreables
      .filter((s) => s.dto.kind === 'MISSING_NEXT_ACTION')
      .map((s) => s.dto.syntheticKey)
      .sort()
    expect(missing).toEqual(['MISSING-NA-WS-1', 'MISSING-NA-WS-2'])
  })
})

/* ===================================================================== *
 * 组装: 分数 / 带 / 全序
 * ===================================================================== */

describe('assembleProjectAttention — 分数与 ADJ-2 priority 带', () => {
  it('IV OPEN（UNSEEN）= 110 HIGH; IV PENDING = 85 MEDIUM; BLK = 100 HIGH; NA = 50 MEDIUM', () => {
    const c = collectProjectAttention(
      makeSources({
        listInterventions: () => [makeIv({ id: 'IV-1', status: 'OPEN', created_at: 1_000 }), makeIv({ id: 'IV-2', status: 'PENDING', created_at: 500 })],
        listBlockers: () => [makeBlk()],
        listNextActions: () => [
          makeNa({ id: 'NA-1', created_at: 3_000 }),
          makeNa({ id: 'NA-2', created_at: 4_000 }),
        ],
        // INV-ATTN-4 白名单: awareness 只注入 INTERVENTION — 该回调对 NA-2
        // 返回 'SEEN' 也**不得**被 D1 读取（scorer 输入无 awarenessState 字段
        // ⇒ NA 恒按 UNSEEN 计 gap）。
        awarenessState: (id) => (id === 'NA-2' ? 'SEEN' : null),
      }),
      T_NOW,
    )
    const dtos = new Map(assembleProjectAttention(c, T_NOW).map((d) => [d.sourceId, d]))
    expect(dtos.get('IV-1')!.score).toBe(110)
    expect(dtos.get('IV-1')!.priority).toBe('HIGH')
    expect(dtos.get('IV-2')!.score).toBe(85)
    expect(dtos.get('IV-2')!.priority).toBe('MEDIUM')
    expect(dtos.get('BLK-1')!.score).toBe(100)
    expect(dtos.get('BLK-1')!.priority).toBe('HIGH')
    expect(dtos.get('NA-1')!.score).toBe(50)
    expect(dtos.get('NA-1')!.priority).toBe('MEDIUM')
    expect(dtos.get('NA-2')!.score).toBe(50)
  })

  it('终态项: score=0 / rank=null / priority=LOW; 尾段 createdAt 降序 → id 升序', () => {
    const c = collectProjectAttention(
      makeSources({
        listInterventions: () => [makeIv({ status: 'CLOSED', created_at: 5_000 }), makeIv({ id: 'IV-9', status: 'CLOSED', created_at: 9_000 })],
        listNextActions: () => [makeNa({ status: 'DISMISSED', created_at: 9_000 })],
      }),
      T_NOW,
    )
    const dtos = assembleProjectAttention(c, T_NOW)
    // 无 scoreable — 全部终态, createdAt 降序: IV-9(9000), NA-1(9000, id 'NA-1' > 'IV-9'), IV-1(5000)。
    expect(dtos.map((d) => d.sourceId)).toEqual(['IV-9', 'NA-1', 'IV-1'])
    for (const d of dtos) {
      expect(d.score).toBe(0)
      expect(d.rank).toBeNull()
      expect(d.priority).toBe('LOW')
    }
  })
})

describe('assembleProjectAttention — 全序（含终态尾段）', () => {
  it('混合输入 → score 降序 → TYPE_RANK → createdAt 升序 → id 升序; 终态尾段', () => {
    const c = collectProjectAttention(
      makeSources({
        listInterventions: () => [
          makeIv({ id: 'IV-1', status: 'OPEN', created_at: 1_000 }),
          makeIv({ id: 'IV-2', status: 'PENDING', created_at: 500 }),
        ],
        listBlockers: () => [makeBlk({ created_at: 2_000 })],
        listNextActions: () => [makeNa({ id: 'NA-1', created_at: 3_000 })],
        listObjectives: () => [makeObjective({ linked_refs: [{ kind: 'WORKSTREAM', id: 'WS-2' }] })],
        listWorkstreamNodes: () => [
          makeWsNode(),
          makeWsNode({ id: 'WS-2', taskIds: ['T-1'], canonicalOrder: ['G-1', 'T-1'] }),
        ],
        listEvents: (ws) => (ws === 'WS-1' ? [gateFailedEvent()] : []),
        currentFocusPlanItem: (ws) => (ws === 'WS-1' ? 'T-1' : null),
      }),
      T_NOW,
    )
    const dtos = assembleProjectAttention(c, T_NOW)
    // 评分段:
    //  IV-1  OPEN  110 (TYPE 0)
    //  DERIVED-GATE-G-1  100 (TYPE 1, createdAt 0)
    //  BLK-1           100 (TYPE 1, createdAt 2000)
    //  IV-2  PENDING 85  (TYPE 0)
    //  NA-1            50  (TYPE 3, createdAt 3000)
    //  MISSING-NA-WS-2 50  (TYPE 3, createdAt T_NOW > 3000)
    expect(dtos.map((d) => d.sourceId)).toEqual([
      'IV-1',
      'DERIVED-GATE-G-1',
      'BLK-1',
      'IV-2',
      'NA-1',
      'MISSING-NA-WS-2',
    ])
    expect(dtos.map((d) => d.rank)).toEqual([1, 2, 3, 4, 5, 6])
  })
})

/* ===================================================================== *
 * queryUnifiedAttention — 过滤 / 分页 / 跨项目
 * ===================================================================== */

describe('queryUnifiedAttention — 过滤（精确匹配语义）', () => {
  const mixedSources = makeSources({
    listInterventions: () => [makeIv({ id: 'IV-1', status: 'OPEN', created_at: 1_000 }), makeIv({ id: 'IV-9', status: 'CLOSED', created_at: 7_000 })],
    listBlockers: () => [makeBlk()],
    listNextActions: () => [makeNa({ id: 'NA-1', created_at: 3_000 })],
    listObjectives: () => [makeObjective()],
    listWorkstreamNodes: () => [makeWsNode()],
  })

  it('kind 过滤', () => {
    const r = queryUnifiedAttention([mixedSources], { kind: 'MISSING_NEXT_ACTION' }, T_NOW)
    expect(r.items.map((i) => i.kind)).toEqual(['MISSING_NEXT_ACTION'])
    expect(r.total).toBe(1)
  })

  it('status 精确匹配（8 值 wire 并集 — "OPEN" 命中 IV OPEN + 合成项, 不命中 PENDING/ACTIVE）', () => {
    const r = queryUnifiedAttention([mixedSources], { status: 'OPEN' }, T_NOW)
    expect(r.items.map((i) => i.sourceId).sort()).toEqual(['IV-1', 'MISSING-NA-WS-1'])
  })

  it('priority 过滤', () => {
    const r = queryUnifiedAttention([mixedSources], { priority: 'LOW' }, T_NOW)
    // 评分段无 LOW（110/100/50 全 MEDIUM+）; 终态 IV-9 CLOSED = LOW。
    expect(r.items.map((i) => i.sourceId)).toEqual(['IV-9'])
  })

  it('workstreamId 过滤 = DTO.workstreamId 等值（null 不命中）', () => {
    const noWs = makeSources({ listInterventions: () => [makeIv({ id: 'IV-8', workstream_ids: [] })] })
    const r = queryUnifiedAttention([mixedSources, noWs], { projectId: 'PRJ-1', workstreamId: 'WS-1' }, T_NOW)
    for (const i of r.items) expect(i.workstreamId).toBe('WS-1')
    // noWs 的 IV-8（ws=null）不得出现; 合成项（WS-1）必须出现。
    const ids = r.items.map((i) => i.sourceId)
    expect(ids).not.toContain('IV-8')
    expect(ids).toContain('MISSING-NA-WS-1')
  })

  it('组合过滤: kind + status + workstreamId', () => {
    const r = queryUnifiedAttention(
      [mixedSources],
      { projectId: 'PRJ-1', kind: 'NEXT_ACTION', status: 'PROPOSED', workstreamId: 'WS-1' },
      T_NOW,
    )
    expect(r.items.map((i) => i.sourceId)).toEqual(['NA-1'])
  })

  it('workstreamId 无 projectId ⇒ fail-loud（TypeError）', () => {
    expect(() => queryUnifiedAttention([mixedSources], { workstreamId: 'WS-1' }, T_NOW)).toThrow(TypeError)
    expect(() => queryUnifiedAttention([mixedSources], { workstreamId: 'WS-1' }, T_NOW)).toThrow(/workstreamId requires projectId/)
  })
})

describe('queryUnifiedAttention — total / offset / limit', () => {
  it('total = 过滤后长度; 默认 limit 50（51 条 PROPOSED NA ⇒ items 50 / total 51）', () => {
    const nas = Array.from({ length: 51 }, (_, i) => makeNa({ id: `NA-${String(i + 1).padStart(2, '0')}`, created_at: 1_000 + i }))
    const r = queryUnifiedAttention([makeSources({ listNextActions: () => nas })], {}, T_NOW)
    expect(r.total).toBe(51)
    expect(r.items).toHaveLength(50)
    expect(r.items.map((i) => i.sourceId)[0]).toBe('NA-01')
  })

  it('limit 上限 200 钳制（纯核心层防御; schema 在 @Remote 层已拒 >200）', () => {
    const nas = Array.from({ length: 250 }, (_, i) => makeNa({ id: `NA-${String(i + 1).padStart(3, '0')}`, created_at: 1_000 + i }))
    const r = queryUnifiedAttention([makeSources({ listNextActions: () => nas })], { limit: 500 }, T_NOW)
    expect(r.items).toHaveLength(200)
    expect(r.total).toBe(250)
  })

  it('offset 只截断, 不破坏全序（续页与整序对应段一致）', () => {
    const nas = Array.from({ length: 10 }, (_, i) => makeNa({ id: `NA-${i + 1}`, created_at: 1_000 + i }))
    const all = queryUnifiedAttention([makeSources({ listNextActions: () => nas })], { limit: 100 }, T_NOW)
    const page = queryUnifiedAttention([makeSources({ listNextActions: () => nas })], { limit: 3, offset: 4 }, T_NOW)
    expect(page.items.map((i) => i.sourceId)).toEqual(all.items.slice(4, 7).map((i) => i.sourceId))
    expect(page.total).toBe(10)
  })

  it('offset 越界 → 空 items / total 不变', () => {
    const r = queryUnifiedAttention([makeSources({ listNextActions: () => [makeNa()] })], { offset: 99 }, T_NOW)
    expect(r.items).toHaveLength(0)
    expect(r.total).toBe(1)
  })
})

describe('queryUnifiedAttention — 跨项目 hub 语义', () => {
  it('rank = 跨项目 1-based 全序; 终态尾段跨项目 createdAt 降序合并', () => {
    const prj1 = makeSources({
      listInterventions: () => [makeIv({ id: 'IV-1', created_at: 1_000 })],
    })
    const prj2 = makeSources({
      projectId: 'PRJ-2',
      listInterventions: () => [
        makeIv({ id: 'IV-7', status: 'CLOSED', created_at: 9_000 }),
        makeIv({ id: 'IV-8', created_at: 2_000 }),
      ],
    })
    const r = queryUnifiedAttention([prj1, prj2], {}, T_NOW)
    // 评分段（rank 跨项目）: IV-1 110 → rank1; IV-8 110（同分, TYPE 同档, createdAt 2000 > 1000）→ rank2。
    expect(r.items.map((i) => [i.sourceId, i.rank, i.projectId])).toEqual([
      ['IV-1', 1, 'PRJ-1'],
      ['IV-8', 2, 'PRJ-2'],
      // 终态尾段: IV-7 (PRJ-2, 9000) 在前。
      ['IV-7', null, 'PRJ-2'],
    ])
    expect(r.total).toBe(3)
  })
})

/* ===================================================================== *
 * 红线: 零写面 / 零变异 / 确定性
 * ===================================================================== */

describe('红线 — 零写面 / 零变异 / 确定性', () => {
  it('sources 面调用白名单: 只允许 8 个只读面（任何未声明面被调用 ⇒ 测试红）', () => {
    const READ_FACES = new Set([
      'listInterventions',
      'listBlockers',
      'listNextActions',
      'listObjectives',
      'listWorkstreamNodes',
      'listEvents',
      'currentFocusPlanItem',
      'awarenessState',
    ])
    const calls: string[] = []
    const spy: ProjectAttentionSources = {
      projectId: 'PRJ-1',
      listInterventions: () => {
        calls.push('listInterventions')
        return [makeIv()]
      },
      listBlockers: () => {
        calls.push('listBlockers')
        return [makeBlk()]
      },
      listNextActions: () => {
        calls.push('listNextActions')
        return [makeNa()]
      },
      listObjectives: () => {
        calls.push('listObjectives')
        return [makeObjective()]
      },
      listWorkstreamNodes: () => {
        calls.push('listWorkstreamNodes')
        return [makeWsNode()]
      },
      listEvents: () => {
        calls.push('listEvents')
        return [gateFailedEvent()]
      },
      currentFocusPlanItem: () => {
        calls.push('currentFocusPlanItem')
        return 'T-1'
      },
      awarenessState: () => {
        calls.push('awarenessState')
        return null
      },
    }
    // Proxy 兜底: 白名单外的任何属性访问（= 试图调用写面）立即抛错。
    const guarded = new Proxy(spy, {
      get(target, prop) {
        if (typeof prop === 'string' && prop !== 'projectId' && !READ_FACES.has(prop) && !(prop in target)) {
          throw new Error(`unexpected face accessed: ${prop}`)
        }
        return (target as unknown as Record<string | symbol, unknown>)[prop]
      },
    })
    const r = queryUnifiedAttention([guarded], {}, T_NOW)
    for (const c of calls) expect(READ_FACES.has(c)).toBe(true)
    expect(r.items.length).toBeGreaterThan(0)
  })

  it('输入对象深冻结 ⇒ 收集/组装零变异', () => {
    const iv = makeIv()
    Object.freeze(iv)
    Object.freeze(iv.workstream_ids)
    Object.freeze(iv.source_refs)
    Object.freeze(iv.source_refs[0])
    const blk = makeBlk()
    Object.freeze(blk)
    Object.freeze(blk.affects)
    for (const a of blk.affects) Object.freeze(a)
    const nas = [makeNa()]
    for (const na of nas) Object.freeze(na)
    const objectives = [makeObjective()]
    for (const o of objectives) {
      Object.freeze(o)
      Object.freeze(o.linked_refs)
      Object.freeze(o.linked_refs[0])
      Object.freeze(o.success_criteria)
    }
    const node = makeWsNode()
    Object.freeze(node)
    Object.freeze(node.taskIds)
    Object.freeze(node.canonicalOrder)
    const events = [gateFailedEvent()]
    for (const e of events) {
      Object.freeze(e)
      Object.freeze(e.payload)
    }
    const sources = makeSources({
      listInterventions: () => [iv],
      listBlockers: () => [blk],
      listNextActions: () => nas,
      listObjectives: () => objectives,
      listWorkstreamNodes: () => [node],
      listEvents: () => events,
      currentFocusPlanItem: () => 'T-1',
    })
    // 不抛错 = 零变异（严格模式下对冻结对象的写会 TypeError）。
    const r = queryUnifiedAttention([sources], {}, T_NOW)
    expect(r.items.map((i) => i.kind).sort()).toEqual(
      ['DERIVED_BLOCKER', 'EXPLICIT_BLOCKER', 'INTERVENTION', 'MISSING_NEXT_ACTION', 'NEXT_ACTION'].sort(),
    )
  })

  it('确定性: 同输入 → 同输出（deep equal）', () => {
    const sources = makeSources({
      listInterventions: () => [makeIv(), makeIv({ id: 'IV-2', status: 'PENDING' })],
      listBlockers: () => [makeBlk()],
      listNextActions: () => [makeNa()],
      listObjectives: () => [makeObjective()],
      listWorkstreamNodes: () => [makeWsNode()],
      listEvents: () => [gateFailedEvent(), depEdgeEvent()],
      currentFocusPlanItem: () => 'T-1',
    })
    const a = queryUnifiedAttention([sources], {}, T_NOW)
    const b = queryUnifiedAttention([sources], {}, T_NOW)
    expect(b).toEqual(a)
  })

  it('输入乱序 → 同一输出序（全序 tie-break: score → TYPE_RANK → createdAt → id）', () => {
    const ivs = [makeIv({ id: 'IV-1', created_at: 1_000 }), makeIv({ id: 'IV-2', status: 'PENDING', created_at: 500 }), makeIv({ id: 'IV-3', status: 'PENDING', created_at: 500 })]
    const nas = [makeNa({ id: 'NA-1', created_at: 3_000 }), makeNa({ id: 'NA-2', created_at: 3_000, statement: 'second' })]
    const sourcesA = makeSources({ listInterventions: () => ivs, listNextActions: () => nas })
    const sourcesB = makeSources({ listInterventions: () => [...ivs].reverse(), listNextActions: () => [...nas].reverse() })
    const a = queryUnifiedAttention([sourcesA], {}, T_NOW)
    const b = queryUnifiedAttention([sourcesB], {}, T_NOW)
    expect(b.items.map((i) => i.sourceId)).toEqual(a.items.map((i) => i.sourceId))
    expect(b.items.map((i) => i.rank)).toEqual(a.items.map((i) => i.rank))
  })
})

/* ===================================================================== *
 * 候选类型导出面（组装原语可直接消费 — host 适配器侧复用）
 * ===================================================================== */

describe('assembleUnified — 候选原语', () => {
  it('接受手工构造的候选（ScoreableCandidate/TerminalCandidate）并正确回填', () => {
    const scoreable: ScoreableCandidate = {
      scorer: { kind: 'BLOCKER', id: 'BLK-9', title: 'manual', createdAt: 0, workstreamId: null, status: 'ACTIVE' },
      dto: {
        kind: 'EXPLICIT_BLOCKER',
        sourceId: 'BLK-9',
        sourceRef: { kind: 'BLOCKER', id: 'BLK-9' },
        projectId: 'PRJ-1',
        workstreamId: null,
        title: 'manual',
        status: 'ACTIVE',
        createdAt: 0,
        detectedAt: 0,
        reason: 'fallback',
        allowedActions: ['clearBlocker'],
        context: {},
      },
    }
    const terminal: TerminalCandidate = {
      dto: {
        kind: 'NEXT_ACTION',
        sourceId: 'NA-9',
        sourceRef: { kind: 'NEXT_ACTION', id: 'NA-9' },
        projectId: 'PRJ-1',
        workstreamId: null,
        title: 'done',
        status: 'DISMISSED',
        createdAt: 1_000,
        detectedAt: 1_000,
        reason: 'fallback',
        allowedActions: [],
        context: {},
      },
    }
    const dtos: AttentionItemDto[] = assembleUnified([scoreable], [terminal], T_NOW)
    expect(dtos[0]).toMatchObject({ sourceId: 'BLK-9', score: 100, rank: 1, priority: 'HIGH' })
    expect(dtos[0].reason).not.toBe('fallback') // scorer reason 覆盖收集期 fallback
    expect(dtos[1]).toMatchObject({ sourceId: 'NA-9', score: 0, rank: null, priority: 'LOW' })
  })
})
