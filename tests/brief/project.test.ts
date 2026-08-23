/**
 * WP-5.5 — 投影引擎纯函数测试（`projectBrief` + `validateBriefRefs`）。
 *
 * 覆盖（任务测试项「投影纯函数: 给定输入确定性输出、每陈述有 ref 断言、
 * 缺口占位」）:
 *  - 确定性: 同输入同输出（deep equal）; 输入数组乱序 ⇒ 同输出
 *    （每类要点内部排序键固定 — 全序 tie-break）;
 *  - 每陈述有 ref（INV-ATTN-3 机器形态）: 每条 DATA 要点 refs 非空 +
 *    `validateBriefRefs` 零违规; ref 形状良构（15 kind 白名单 / seq 正整数）;
 *  - 结构完备: L2 八类「重点回答」逐类落点; L3 13 行逐面落行（固定序）;
 *  - 缺口占位: 空面 = PLACEHOLDER「暂无数据」点 + L3 EMPTY 行;
 *    audit/inbox 恒「待开通」（Phase 6 不虚构 — 结构上无输入路径）;
 *    dashboard/attention null = 数据面不可用占位（L1 降级陈述）;
 *  - L1 一句话态势: 计数子句确定性 + 空工作区面 + 空 ref 面;
 *  - L3 计数自洽: AVAILABLE ⇒ count ≡ refs.length; 摘要窗口截断（5 条）;
 *  - `validateBriefRefs` 负例: 篡改后的 Brief 逐一产生违规（机器可查面
 *    不是死代码 — 每条校验分支至少一个触发用例）。
 */

import { describe, expect, it } from 'vitest'

import { ATTENTION_WEIGHTS } from '../../src/host/service/attention/scorer.js'
import { projectBrief, validateBriefRefs, BRIEF_RECENT_CAP, BRIEF_SEV_HORIZON_MS } from '../../src/host/service/brief/project.js'
import type { BriefInputs, BriefPoint, BriefRef, LivingBrief } from '../../src/host/service/brief/types.js'
import {
  BRIEF_DATA_PLANES,
  BRIEF_POINT_CATEGORIES,
  makeEmptyInputs,
  makeFullInputs,
  planeRow,
  pointsOf,
  refKey,
  T_NOW,
} from './fixtures.js'

/* -------------------------------------------------------------------- *
 * 确定性
 * -------------------------------------------------------------------- */

describe('确定性（纯函数: 同输入同输出）', () => {
  it('同一输入两次投影 deep equal', () => {
    const inputs = makeFullInputs()
    const a = projectBrief(inputs, T_NOW)
    const b = projectBrief(inputs, T_NOW)
    expect(b).toEqual(a)
  })

  it('输入数组乱序 ⇒ 同输出（每类排序键固定, 输入序无关）', () => {
    const base = makeFullInputs()
    const shuffled: BriefInputs = {
      ...base,
      interventions: [...base.interventions].reverse(),
      objectives: [...base.objectives].reverse(),
      history: [...base.history].reverse(),
      scheduledEvents: [...base.scheduledEvents].reverse(),
      reportingItems: [...base.reportingItems].reverse(),
      interactions: [...base.interactions].reverse(),
      nextActions: [...base.nextActions].reverse(),
      blockers: [...base.blockers].reverse(),
      futurePlans: [...base.futurePlans].reverse(),
    }
    expect(projectBrief(shuffled, T_NOW)).toEqual(projectBrief(base, T_NOW))
  })

  it('now 只影响时间相关陈述（L1 临近判定 / SEV 相位）, 同 now 同输出', () => {
    const inputs = makeFullInputs()
    expect(projectBrief(inputs, T_NOW)).toEqual(projectBrief(inputs, T_NOW))
    // 不同 now ⇒ 至少 SEV 相位/临近计数可能变（此处只钉同 now 恒等 — 上方已覆盖）
  })
})

/* -------------------------------------------------------------------- *
 * 结构完备（八类要点 + 13 行底座）
 * -------------------------------------------------------------------- */

describe('结构完备', () => {
  it('L2 八类「重点回答」逐类 ≥1 条（§19.2 清单落点）', () => {
    const brief = projectBrief(makeFullInputs(), T_NOW)
    for (const category of BRIEF_POINT_CATEGORIES) {
      expect(pointsOf(brief, category).length, `category ${category}`).toBeGreaterThanOrEqual(1)
    }
  })

  it('L3 恒 13 行且顺序 = BRIEF_DATA_PLANES（完整数据底座 — 不隐藏）', () => {
    const brief = projectBrief(makeFullInputs(), T_NOW)
    expect(brief.level3.map((r) => r.plane)).toEqual([...BRIEF_DATA_PLANES])
    expect(brief.level3).toHaveLength(13)
  })

  it('空输入也结构完备（八类占位 + 13 行 — 全定义引擎）', () => {
    const brief = projectBrief(makeEmptyInputs(), T_NOW)
    for (const category of BRIEF_POINT_CATEGORIES) {
      expect(pointsOf(brief, category).length, `category ${category}`).toBeGreaterThanOrEqual(1)
    }
    expect(brief.level3.map((r) => r.plane)).toEqual([...BRIEF_DATA_PLANES])
  })
})

/* -------------------------------------------------------------------- *
 * 每陈述有 ref（INV-ATTN-3 机器形态）
 * -------------------------------------------------------------------- */

describe('每陈述有 ref（INV-ATTN-3）', () => {
  it('全数据 Brief: validateBriefRefs 零违规 + 每条 DATA 要点 refs 非空', () => {
    const brief = projectBrief(makeFullInputs(), T_NOW)
    expect(validateBriefRefs(brief)).toEqual([])
    for (const point of brief.level2) {
      if (point.status === 'DATA') {
        expect(point.refs.length, `${point.id} 的 refs`).toBeGreaterThanOrEqual(1)
      } else {
        expect(point.refs.length, `${point.id} 占位不应带 refs`).toBe(0)
      }
    }
  })

  it('空输入 Brief: validateBriefRefs 零违规（占位面合法 — 无 DATA 点）', () => {
    const brief = projectBrief(makeEmptyInputs(), T_NOW)
    expect(validateBriefRefs(brief)).toEqual([])
  })

  it('OBJECTIVE 要点 ref = 目标 id（drill-down 到结构化对象）', () => {
    const brief = projectBrief(makeFullInputs(), T_NOW)
    const points = pointsOf(brief, 'OBJECTIVE')
    // 2 条 ACTIVE（OBJ-1 P1, OBJ-2 P0）⇒ 排序: P0 先
    expect(points).toHaveLength(2)
    expect(points[0]!.refs.map(refKey)).toEqual(['OBJECT:OBJECTIVE:OBJ-2'])
    expect(points[1]!.refs.map(refKey)).toEqual(['OBJECT:OBJECTIVE:OBJ-1'])
  })

  it('RECENT 要点 ref = 事件坐标（ws + seq + eventId — History drill-down 入口）', () => {
    const brief = projectBrief(makeFullInputs(), T_NOW)
    const points = pointsOf(brief, 'RECENT')
    expect(points).toHaveLength(3)
    // 最新在前: H-3 (T-30min) → H-2 (T-1h) → H-1 (T-2h)
    expect(points[0]!.refs.map(refKey)).toEqual(['EVENT:WS-1:3:H-3'])
    expect(points[1]!.refs.map(refKey)).toEqual(['EVENT:WS-2:2:H-2'])
    expect(points[2]!.refs.map(refKey)).toEqual(['EVENT:WS-1:1:H-1'])
  })

  it('IN_FLIGHT 要点 ref = 注意力项对象 (+WS)', () => {
    const brief = projectBrief(makeFullInputs(), T_NOW)
    const points = pointsOf(brief, 'IN_FLIGHT')
    expect(points).toHaveLength(2)
    expect(points[0]!.refs.map(refKey)).toEqual(['OBJECT:INTERVENTION:IV-1', 'OBJECT:WORKSTREAM:WS-1'])
    expect(points[1]!.refs.map(refKey)).toEqual(['OBJECT:BLOCKER:BLK-1', 'OBJECT:WORKSTREAM:WS-2'])
  })

  it('BLOCKER 要点 ref 含 affects（WS/T/R 均可 drill-down）', () => {
    const brief = projectBrief(makeFullInputs(), T_NOW)
    const points = pointsOf(brief, 'BLOCKER')
    expect(points[0]!.refs.map(refKey)).toEqual(['OBJECT:BLOCKER:BLK-1', 'OBJECT:WORKSTREAM:WS-2'])
  })

  it('INTERVENTION 要点 ref = 队列全量（INV-ATTN-1: 不隐藏）', () => {
    const brief = projectBrief(makeFullInputs(), T_NOW)
    const points = pointsOf(brief, 'INTERVENTION')
    expect(points).toHaveLength(1)
    expect(points[0]!.refs.map(refKey)).toEqual(['OBJECT:INTERVENTION:IV-1', 'OBJECT:INTERVENTION:IV-2'])
    expect(points[0]!.statement).toContain('2 项人工干预待处理')
    expect(points[0]!.statement).toContain('OPEN 1 / PENDING 1')
  })

  it('L1 refs = 项目 + 注意力 Top 项（去重）', () => {
    const brief = projectBrief(makeFullInputs(), T_NOW)
    expect(brief.level1.refs.map(refKey)).toEqual([
      'OBJECT:PROJECT:PRJ-1',
      'OBJECT:INTERVENTION:IV-1',
      'OBJECT:BLOCKER:BLK-1',
    ])
  })

  it('L3 attention 行 refs = 全量队列（只排序不隐藏 — 与 L2 Top5 截断不同源）', () => {
    const inputs = makeFullInputs()
    const brief = projectBrief(inputs, T_NOW)
    expect(planeRow(brief, 'attention').refs.map(refKey)).toEqual([
      'OBJECT:INTERVENTION:IV-1',
      'OBJECT:BLOCKER:BLK-1',
    ])
  })
})

/* -------------------------------------------------------------------- *
 * L1 一句话态势
 * -------------------------------------------------------------------- */

describe('L1 一句话态势', () => {
  it('全数据: 项目标题 + 各计数子句（确定性模板）', () => {
    const brief = projectBrief(makeFullInputs(), T_NOW)
    const s = brief.level1.statement
    expect(s).toBe(
      '《Project One》：2 个活跃目标；干预 1 OPEN / 1 PENDING；1 项阻碍未解除；1 项建议待决；3 项临近/待汇报；最近 CLAIM_RECORDED（WS-1）',
    )
  })

  it('空工作区: 「无进行中数据」+ refs 只有项目', () => {
    const brief = projectBrief(makeEmptyInputs(), T_NOW)
    expect(brief.level1.statement).toBe('《Project One》：无进行中数据（各数据面为空集）')
    expect(brief.level1.refs.map(refKey)).toEqual(['OBJECT:PROJECT:PRJ-1'])
  })

  it('dashboard null: 数据缺口陈述 + 空 refs（不虚构项目）', () => {
    const brief = projectBrief({ ...makeEmptyInputs(), dashboard: null }, T_NOW)
    expect(brief.level1.statement).toBe('无法组装态势：dashboard 快照缺失（数据面不可用）')
    expect(brief.level1.refs).toEqual([])
    expect(validateBriefRefs(brief)).toEqual([])
    expect(planeRow(brief, 'dashboard').status).toBe('PLACEHOLDER')
  })

  it('attention null: IN_FLIGHT 占位区分「数据面不可用」（与空队列不同措辞）', () => {
    const unavailable = projectBrief({ ...makeEmptyInputs(), attention: null }, T_NOW)
    expect(pointsOf(unavailable, 'IN_FLIGHT')[0]!.statement).toBe('暂无进行中事项（attention 数据面不可用）')
    const emptyQueue = projectBrief(makeEmptyInputs(), T_NOW)
    expect(pointsOf(emptyQueue, 'IN_FLIGHT')[0]!.statement).toBe('暂无进行中事项（注意力队列为空集）')
  })
})

/* -------------------------------------------------------------------- *
 * 缺口占位（不虚构）
 * -------------------------------------------------------------------- */

describe('缺口占位（Phase 6 / 空面 — 不虚构）', () => {
  it('audit/inbox 恒「待开通」占位（全数据面也不出现数据行）', () => {
    const brief = projectBrief(makeFullInputs(), T_NOW)
    for (const plane of ['audit', 'inbox']) {
      const row = planeRow(brief, plane)
      expect(row.status).toBe('PLACEHOLDER')
      expect(row.count).toBe(0)
      expect(row.refs).toEqual([])
      expect(row.note).toContain('待开通')
    }
  })

  it('空面 = L2「暂无数据」占位点（无 refs）+ L3 EMPTY 行', () => {
    const brief = projectBrief(makeEmptyInputs(), T_NOW)
    for (const category of BRIEF_POINT_CATEGORIES) {
      const points = pointsOf(brief, category)
      expect(points).toHaveLength(1)
      expect(points[0]!.status).toBe('PLACEHOLDER')
      expect(points[0]!.statement).toContain('暂无')
      expect(points[0]!.refs).toEqual([])
    }
    for (const plane of ['interventions', 'objectives', 'nextActions', 'blockers', 'scheduledEvents', 'reportingItems', 'interactions', 'history', 'futurePlans']) {
      expect(planeRow(brief, plane).status).toBe('EMPTY')
    }
    expect(planeRow(brief, 'attention').status).toBe('EMPTY')
  })

  it('ACHIEVED/DROPPED 目标不出现在要点, 但占位陈述计数提及', () => {
    const inputs = makeFullInputs()
    const brief = projectBrief(
      {
        ...inputs,
        objectives: inputs.objectives.filter((o) => o.status !== 'ACTIVE'),
      },
      T_NOW,
    )
    const points = pointsOf(brief, 'OBJECTIVE')
    expect(points).toHaveLength(1)
    expect(points[0]!.status).toBe('PLACEHOLDER')
    expect(points[0]!.statement).toBe('暂无 ACTIVE Objective（已登记 1 条, 均为达成/放弃终态）')
  })

  it('空 items 的 FuturePlan WS 不产要点; 全无 = 占位', () => {
    const inputs = makeFullInputs()
    const brief = projectBrief({ ...inputs, futurePlans: inputs.futurePlans.filter((p) => p.items.length > 0) }, T_NOW)
    expect(pointsOf(brief, 'FUTURE_PLAN')).toHaveLength(1)
    const none = projectBrief({ ...inputs, futurePlans: [] }, T_NOW)
    expect(pointsOf(none, 'FUTURE_PLAN')[0]!.status).toBe('PLACEHOLDER')
  })
})

/* -------------------------------------------------------------------- *
 * 窗口截断与计数自洽
 * -------------------------------------------------------------------- */

describe('窗口截断与 L3 计数自洽', () => {
  it('History 摘要截断最近 5（输入 10 ⇒ L2 RECENT 5 条 + L3 count 5 + 截断注记）', () => {
    const inputs = makeFullInputs()
    const extra = Array.from({ length: 10 }, (_, i) => ({
      eventId: `H-X${i}`,
      eventSeq: i + 1,
      ownerWorkstreamId: 'WS-1',
      eventType: 'TASK_STARTED',
      occurredAt: T_NOW - (i + 1) * 1000,
    }))
    const brief = projectBrief({ ...inputs, history: extra }, T_NOW)
    const recent = pointsOf(brief, 'RECENT')
    expect(recent).toHaveLength(BRIEF_RECENT_CAP)
    // 最新在前: H-X0 (T-1000) 打头
    expect(recent[0]!.refs.map(refKey)).toEqual(['EVENT:WS-1:1:H-X0'])
    const row = planeRow(brief, 'history')
    expect(row.count).toBe(BRIEF_RECENT_CAP)
    expect(row.refs).toHaveLength(BRIEF_RECENT_CAP)
    expect(row.note).toBe('摘要窗口截断：仅最近 5 条')
    expect(validateBriefRefs(brief)).toEqual([])
  })

  it('L3 AVAILABLE 行 count ≡ refs.length（逐面核对）', () => {
    const brief = projectBrief(makeFullInputs(), T_NOW)
    for (const row of brief.level3) {
      if (row.status === 'AVAILABLE') {
        expect(row.refs.length, row.plane).toBe(row.count)
        expect(row.count, row.plane).toBeGreaterThanOrEqual(1)
      } else {
        expect(row.refs.length, row.plane).toBe(0)
        expect(row.count, row.plane).toBe(0)
      }
    }
    // 各面具体计数:
    expect(planeRow(brief, 'dashboard').count).toBe(2) // 项目 + 1 主题
    expect(planeRow(brief, 'interventions').count).toBe(2)
    expect(planeRow(brief, 'objectives').count).toBe(3) // 含终态 — 引用表列全量
    expect(planeRow(brief, 'scheduledEvents').count).toBe(4)
    expect(planeRow(brief, 'reportingItems').count).toBe(2)
    expect(planeRow(brief, 'futurePlans').count).toBe(2) // 2 个计划 item（空 WS 不贡献）
  })
})

/* -------------------------------------------------------------------- *
 * 语义面（相位/排序/文案）
 * -------------------------------------------------------------------- */

describe('语义面（确定性文案）', () => {
  it('UPCOMING 四相位: 已到期/临近/已排期/周期（排序 at 升, null 最后; RPT 未履约在后, REPORTED 排除）', () => {
    const brief = projectBrief(makeFullInputs(), T_NOW)
    const points = pointsOf(brief, 'UPCOMING')
    expect(points.map((p) => p.statement)).toEqual([
      '计划事件 SEV-0：已过期评审（已到期）',
      '计划事件 SEV-1：组会汇报（临近（7 天视距内））',
      '计划事件 SEV-2：远期刊截稿（已排期）',
      '计划事件 SEV-3：每周文献调研（周期事件（V1 不推算下次发生））',
      '待汇报 RPT-1（OPEN）：向 导师 — 汇报本周实验进展',
    ])
    expect(points.every((p) => p.status === 'DATA')).toBe(true)
  })

  it('OBJECTIVE 排序: priority 升（P0 先）→ id; 要点文案含 scope 中文档', () => {
    const brief = projectBrief(makeFullInputs(), T_NOW)
    const points = pointsOf(brief, 'OBJECTIVE')
    expect(points[0]!.statement).toBe('目标 OBJ-2（P0, 项目级）：构建基线评估集')
    expect(points[1]!.statement).toBe('目标 OBJ-1（P1, 项目级）：理解目标系统的失效模式')
  })

  it('IN_FLIGHT 文案 = rank + title + 得分 + why-now（评分器 reasons 透传 — 单一真源）', () => {
    const brief = projectBrief(makeFullInputs(), T_NOW)
    const points = pointsOf(brief, 'IN_FLIGHT')
    expect(points[0]!.statement).toBe(
      '注意力 #1：审阅累积的 Agent PlanFork [WS-1]（得分 110 — OPEN Intervention — 待人类负责；来源: AUTO_FLOODING；用户尚未知悉（awareness UNSEEN））',
    )
  })

  it('FUTURE_PLAN 要点 = WS 计划头部（first item）+ 其后计数', () => {
    const brief = projectBrief(makeFullInputs(), T_NOW)
    const points = pointsOf(brief, 'FUTURE_PLAN')
    expect(points[0]!.statement).toBe('WS-1 计划下一步：TASK 数据清洗脚本化（T-1，其后还有 1 项）')
    expect(points[0]!.refs.map(refKey)).toEqual(['OBJECT:WORKSTREAM:WS-1', 'OBJECT:TASK:T-1'])
  })

  it('NEXT_ACTION 要点含 WS ref（workstreamId 非 null 时）', () => {
    const brief = projectBrief(makeFullInputs(), T_NOW)
    const points = pointsOf(brief, 'NEXT_ACTION')
    expect(points[0]!.refs.map(refKey)).toEqual(['OBJECT:NEXT_ACTION:NA-1', 'OBJECT:WORKSTREAM:WS-1'])
  })

  it('SEV 视距常量与评分器近度视距同口径（漂移钉）', () => {
    expect(BRIEF_SEV_HORIZON_MS).toBe(ATTENTION_WEIGHTS.scheduledEventHorizonMs)
  })
})

/* -------------------------------------------------------------------- *
 * validateBriefRefs 负例（机器可查面 — 每条校验分支有触发用例）
 * -------------------------------------------------------------------- */

describe('validateBriefRefs 负例（篡改 Brief ⇒ 违规非空）', () => {
  const full = () => projectBrief(makeFullInputs(), T_NOW)

  /* 可变镜像类型（引擎输出 readonly — 负例需要改深拷贝副本; 字段按
   * LivingBrief 结构放宽, 枚举位放宽为 string 以容纳违规值）。 */
  type MutRef =
    | { kind: 'OBJECT'; objectKind: string; id: string }
    | { kind: 'HISTORY_EVENT'; workstreamId: string; eventSeq: number; eventId: string }
  type MutBrief = {
    generatedAt: number
    level1: { statement: string; refs: MutRef[] }
    level2: { id: string; category: string; status: string; statement: string; refs: MutRef[] }[]
    level3: { plane: string; label: string; status: string; count: number; refs: MutRef[]; note: string | null }[]
  }

  /** 深拷贝后按可变类型交给篡改函数, 结果按 LivingBrief 面回交校验器。 */
  function mutate(brief: LivingBrief, fn: (b: MutBrief) => void): LivingBrief {
    const copy = JSON.parse(JSON.stringify(brief)) as MutBrief
    fn(copy)
    return copy as unknown as LivingBrief
  }

  it('DATA 要点 refs 清空 ⇒ INV-ATTN-3 违规', () => {
    const b = mutate(full(), (c) => {
      const p = c.level2.find((x) => x.status === 'DATA')!
      p.refs = []
    })
    const violations = validateBriefRefs(b)
    expect(violations.length).toBeGreaterThanOrEqual(1)
    expect(violations.some((v) => v.includes('INV-ATTN-3'))).toBe(true)
  })

  it('占位要点携带 refs ⇒ 违规（占位不应引用不存在的数据）', () => {
    const empty = projectBrief(makeEmptyInputs(), T_NOW)
    const b = mutate(empty, (c) => {
      c.level2[0]!.refs = [{ kind: 'OBJECT', objectKind: 'PROJECT', id: 'PRJ-1' }]
    })
    expect(validateBriefRefs(b).some((v) => v.includes('占位但携带 refs'))).toBe(true)
  })

  it('OBJECT ref 的 objectKind 白名单外 ⇒ 违规', () => {
    const b = mutate(full(), (c) => {
      const p = c.level2.find((x) => x.status === 'DATA')!
      const ref = p.refs[0]!
      if (ref.kind === 'OBJECT') ref.objectKind = 'NOT_A_KIND'
    })
    expect(validateBriefRefs(b).some((v) => v.includes('objectKind 不在白名单'))).toBe(true)
  })

  it('HISTORY_EVENT ref 的 eventSeq 非正整数 ⇒ 违规', () => {
    const b = mutate(full(), (c) => {
      const p = c.level2.find((x) => x.refs.some((r) => r.kind === 'HISTORY_EVENT'))!
      const ref = p.refs.find((r) => r.kind === 'HISTORY_EVENT')!
      ref.eventSeq = 0
    })
    expect(validateBriefRefs(b).some((v) => v.includes('eventSeq 非法'))).toBe(true)
  })

  it('缺类别（删一条 RECENT 要点后类别消失）⇒ 违规', () => {
    const empty = projectBrief(makeEmptyInputs(), T_NOW)
    const b = mutate(empty, (c) => {
      c.level2 = c.level2.filter((p) => p.category !== 'RECENT')
    })
    expect(validateBriefRefs(b).some((v) => v.includes('缺少类别 RECENT'))).toBe(true)
  })

  it('缺 L3 行（删 audit 行）⇒ 违规', () => {
    const b = mutate(full(), (c) => {
      c.level3 = c.level3.filter((r) => r.plane !== 'audit')
    })
    expect(validateBriefRefs(b).some((v) => v.includes('缺少数据面 audit'))).toBe(true)
  })

  it('audit 行非 PLACEHOLDER ⇒ 违规（Phase 6 面不虚构）', () => {
    const b = mutate(full(), (c) => {
      const row = c.level3.find((r) => r.plane === 'audit')!
      row.status = 'AVAILABLE'
      row.count = 1
      row.refs = [{ kind: 'OBJECT', objectKind: 'PROJECT', id: 'PRJ-1' }]
    })
    expect(validateBriefRefs(b).some((v) => v.includes('必须为 PLACEHOLDER'))).toBe(true)
  })

  it('AVAILABLE 行 count ≠ refs.length ⇒ 违规', () => {
    const b = mutate(full(), (c) => {
      const row = c.level3.find((r) => r.plane === 'interventions')!
      row.count = 99
    })
    expect(validateBriefRefs(b).some((v) => v.includes('count/refs 不自洽'))).toBe(true)
  })

  it('EMPTY 行携带数据 ⇒ 违规', () => {
    const empty = projectBrief(makeEmptyInputs(), T_NOW)
    const b = mutate(empty, (c) => {
      const row = c.level3.find((r) => r.plane === 'interventions')!
      row.refs = [{ kind: 'OBJECT', objectKind: 'INTERVENTION', id: 'IV-9' }]
    })
    expect(validateBriefRefs(b).some((v) => v.includes('count/refs 非零'))).toBe(true)
  })

  it('generatedAt 非法 ⇒ 违规', () => {
    const b = mutate(full(), (c) => {
      c.generatedAt = -1
    })
    expect(validateBriefRefs(b).some((v) => v.includes('generatedAt 非法'))).toBe(true)
  })
})

/** 占位 helper: 确保 BriefPoint/BriefRef 类型面被引用（编译期钉）。 */
export type { BriefPoint, BriefRef }
