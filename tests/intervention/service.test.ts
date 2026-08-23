/**
 * WP-5.1 — InterventionService 全流 + 状态机全转换 + 权限双面 +
 * INV-ATTN-5 机械来源闭集（真实 research.sqlite + 真实 registry +
 * 真实冻结 attention schema 形状网 + 真实 IdAllocator）。
 *
 * 覆盖（任务测试项）:
 *  - 创建: 用户类（origin=USER）/ 机械类（INV-ATTN-5 闭集三 trigger,
 *    origin/actor kind 推导逐字）; INTERVENTION_CREATED 经 registry append
 *    （E 列 U/A/P 三泳道全走; origin=AUTO_* ⇒ actor.kind=PLUGIN 的
 *    CROSS_FIELD 在真实 registry 内钉）; 无 WS 关联 = 无事件（TC-DOM-023）;
 *  - 状态机全转换（§13 冻结表 3×3 全格: 4 合法 + 5 非法含自环与终态出口）;
 *  - 权限（Agent 迁移被拒**双面**）: 类型面 @ts-expect-error 编译断言 +
 *    运行面伪造 actor 断言（零写入）;
 *  - INV-ATTN-5 机械来源闭集: 闭集三值逐字 + 映射 pin + 无第四种入口;
 *  - INV-ATTN-1 查询面: OPEN/PENDING 全量（无隐藏过滤器 — 混合 origin/WS
 *    计数逐字钉死）。
 */

import { describe, expect, it } from 'vitest'

import {
  IV_STATUSES,
  IV_TRANSITIONS,
  MECHANICAL_TRIGGER_KINDS,
  type InterventionRecord,
  type IvStatus,
} from '../../src/host/service/flooding/index.js'
import {
  InterventionError,
  InterventionLifecycleStore,
  InterventionService,
  MECHANICAL_TRIGGER_ACTOR_KIND,
  MECHANICAL_TRIGGER_ORIGIN,
  type UserActorRef,
} from '../../src/host/service/intervention/index.js'
import {
  makeInterventionHarness,
  throwsIntervention,
  type InterventionHarness,
} from './fixtures.js'

const USER: UserActorRef = { kind: 'USER', label: 'researcher' }
const PLUGIN = { kind: 'PLUGIN', label: 'research-control' } as const
const AGENT = { kind: 'AGENT', run_id: 'R-1', label: 'agent' } as const

const harnesses: InterventionHarness[] = []
function harness(): InterventionHarness {
  const h = makeInterventionHarness()
  harnesses.push(h)
  return h
}
// 注: fixtures 的 afterAll 统一清理（harnesses 数组仅用于本文件可读性）。

/* ================================================================== *
 * 创建 — 用户类
 * ================================================================== */

describe('createUserIntervention（origin=USER, E 列 U 栏）', () => {
  it('WS 关联创建: 行逐字段 + INTERVENTION_CREATED 事件逐字段（§5.7 payload）', () => {
    const h = harness()
    const result = h.service.createUserIntervention(
      {
        title: '确认标定数据是否可复现',
        detail: '两组数据的重投影误差差异超过 1px',
        workstream_ids: ['WS-1'],
        // PLAN_FORK ref: 非 WS-local kind — V1 registry 快照不建模（跳过
        // 存在性检查, 同 WP-3.5 事件构造先例）; 存在性检查面由 WS 锚 ref 承载。
        source_refs: [{ kind: 'PLAN_FORK', id: 'PF-3' }],
      },
      USER,
    )

    // 行（§9.2 11 键形状, 初始 OPEN）。
    expect(result.intervention).toEqual({
      id: 'IV-1',
      title: '确认标定数据是否可复现',
      detail: '两组数据的重投影误差差异超过 1px',
      origin: 'USER',
      workstream_ids: ['WS-1'],
      source_refs: [{ kind: 'PLAN_FORK', id: 'PF-3' }],
      status: 'OPEN',
      created_by: { kind: 'USER', label: 'researcher' },
      created_at: result.intervention.created_at,
    })
    expect(h.lifecycle.getIntervention('IV-1')).toEqual(result.intervention)

    // 事件（§5.7 逐字 + WORKSTREAM ref 打头的 V1 owner 推导适配）。
    const events = h.dbPair.store.listRange('WS-1', 1)
    expect(events).toHaveLength(1)
    const ev = events[0]!
    expect(ev.eventType).toBe('INTERVENTION_CREATED')
    expect(ev.schemaVersion).toBe(1)
    expect(ev.eventId).toBe(result.eventId)
    expect(ev.ownerWorkstreamId).toBe('WS-1')
    expect(ev.occurredAt).toBe(result.intervention.created_at) // 单次时钟采样
    expect(ev.actor).toEqual({ kind: 'USER', label: 'researcher' })
    expect(ev.payload).toEqual({
      intervention_id: 'IV-1',
      title: '确认标定数据是否可复现',
      origin: 'USER',
      source_refs: [
        { kind: 'WORKSTREAM', id: 'WS-1' }, // owner 锚（V1 适配）
        { kind: 'PLAN_FORK', id: 'PF-3' }, // 记录原样 refs
      ],
    })
  })

  it('source_refs 为空时事件 payload 仅含 owner WS 锚 ref', () => {
    const h = harness()
    h.service.createUserIntervention({ title: '无 ref 的手工登记', workstream_ids: ['WS-1'] }, USER)
    const ev = h.dbPair.store.listRange('WS-1', 1)[0]!
    expect(ev.payload.source_refs).toEqual([{ kind: 'WORKSTREAM', id: 'WS-1' }])
  })

  it('source_refs 已含 owner WS ref 时不重复打头', () => {
    const h = harness()
    h.service.createUserIntervention(
      { title: '自带 WS ref', workstream_ids: ['WS-1'], source_refs: [{ kind: 'WORKSTREAM', id: 'WS-1' }] },
      USER,
    )
    const ev = h.dbPair.store.listRange('WS-1', 1)[0]!
    expect(ev.payload.source_refs).toEqual([{ kind: 'WORKSTREAM', id: 'WS-1' }])
  })

  it('无 WS 关联（TC-DOM-023）: 行入 operational 队列, 零 History 事件', () => {
    const h = harness()
    const result = h.service.createUserIntervention({ title: '无 WS 关联事项' }, USER)
    expect(result.intervention.id).toBe('IV-1')
    expect(result.eventId).toBeNull()
    expect(h.lifecycle.getIntervention('IV-1')!.workstream_ids).toEqual([])
    expect(h.dbPair.store.listRange('WS-1', 1)).toHaveLength(0)
    expect(h.dbPair.store.listRange('WS-2', 1)).toHaveLength(0)
  })

  it('空 title 拒绝（IV_INPUT）— 零行零事件', () => {
    const h = harness()
    throwsIntervention(
      () => h.service.createUserIntervention({ title: '', workstream_ids: ['WS-1'] }, USER),
      'IV_INPUT',
      /title/,
    )
    expect(h.lifecycle.listInterventions()).toHaveLength(0)
    expect(h.dbPair.store.listRange('WS-1', 1)).toHaveLength(0)
  })

  it('坏 WS id 模式拒绝（IV_INPUT）', () => {
    const h = harness()
    throwsIntervention(
      () => h.service.createUserIntervention({ title: 't', workstream_ids: ['WS-0'] }, USER),
      'IV_INPUT',
      /WS-\[1-9\]/,
    )
  })

  it('不存在的 WS 拒绝（IV_INPUT, §16 规则 2 写入时校验）— 零行零事件', () => {
    const h = harness()
    throwsIntervention(
      () => h.service.createUserIntervention({ title: 't', workstream_ids: ['WS-99'] }, USER),
      'IV_INPUT',
      /does not exist in the declarative snapshot/,
    )
    expect(h.lifecycle.listInterventions()).toHaveLength(0)
    expect(h.dbPair.store.listRange('WS-1', 1)).toHaveLength(0)
  })

  it('运行面: 伪造 AGENT actor 触达用户面 ⇒ IV_ACTOR_FORBIDDEN（零写入）', () => {
    const h = harness()
    throwsIntervention(
      () => h.service.createUserIntervention({ title: 't', workstream_ids: ['WS-1'] }, { kind: 'AGENT', run_id: 'R-1' } as unknown as UserActorRef),
      'IV_ACTOR_FORBIDDEN',
      /USER actor/,
    )
    expect(h.lifecycle.listInterventions()).toHaveLength(0)
  })
})

/* ================================================================== *
 * 创建 — 机械类（INV-ATTN-5 闭集）
 * ================================================================== */

describe('createMechanicalIntervention（INV-ATTN-5 闭集三 trigger）', () => {
  it('PLAN_FORK_FLOODING + PLUGIN ⇒ origin=AUTO_FLOODING, 事件 actor.kind=PLUGIN（CROSS_FIELD）', () => {
    const h = harness()
    const result = h.service.createMechanicalIntervention(
      {
        title: 'Review accumulated agent plan forks [WS-1]',
        detail: 'auto flooding evidence …',
        trigger: 'PLAN_FORK_FLOODING',
        workstream_ids: ['WS-1'],
        source_refs: [{ kind: 'PLAN_FORK', id: 'PF-3' }],
      },
      PLUGIN,
    )
    expect(result.intervention.origin).toBe('AUTO_FLOODING')
    expect(result.intervention.created_by).toEqual({ kind: 'PLUGIN', label: 'research-control' })
    const ev = h.dbPair.store.listRange('WS-1', 1)[0]!
    expect(ev.actor).toEqual({ kind: 'PLUGIN', label: 'research-control' })
    expect(ev.payload.origin).toBe('AUTO_FLOODING')
  })

  it('AUDIT_HIGH_IMPACT_DISCREPANCY + PLUGIN ⇒ origin=AUTO_AUDIT', () => {
    const h = harness()
    const result = h.service.createMechanicalIntervention(
      { title: 'audit: 高影响未决差异', trigger: 'AUDIT_HIGH_IMPACT_DISCREPANCY', workstream_ids: ['WS-2'] },
      PLUGIN,
    )
    expect(result.intervention.origin).toBe('AUTO_AUDIT')
    expect(h.dbPair.store.listRange('WS-2', 1)).toHaveLength(1)
  })

  it('AGENT_REPORT_REQUIRES_HUMAN + AGENT(run_id) ⇒ origin=AGENT_REPORT, 事件 actor 携带 run_id（E 列 A 栏）', () => {
    const h = harness()
    const result = h.service.createMechanicalIntervention(
      { title: 'agent 请求人工判断', trigger: 'AGENT_REPORT_REQUIRES_HUMAN', workstream_ids: ['WS-1'] },
      AGENT,
    )
    expect(result.intervention.origin).toBe('AGENT_REPORT')
    expect(result.intervention.created_by).toEqual({ kind: 'AGENT', run_id: 'R-1', label: 'agent' })
    const ev = h.dbPair.store.listRange('WS-1', 1)[0]!
    expect(ev.actor).toEqual({ kind: 'AGENT', run_id: 'R-1', label: 'agent' })
  })

  it('trigger/actor 不配对 ⇒ IV_ACTOR_FORBIDDEN（运行面）— 零行零事件', () => {
    const h = harness()
    throwsIntervention(
      () =>
        h.service.createMechanicalIntervention(
          { title: 't', trigger: 'AGENT_REPORT_REQUIRES_HUMAN', workstream_ids: ['WS-1'] },
          { kind: 'PLUGIN', label: 'research-control' } as const,
        ),
      'IV_ACTOR_FORBIDDEN',
      /AGENT/,
    )
    expect(h.lifecycle.listInterventions()).toHaveLength(0)
    expect(h.dbPair.store.listRange('WS-1', 1)).toHaveLength(0)
  })

  it('AUTO_FLOODING + AGENT actor ⇒ IV_ACTOR_FORBIDDEN（origin=AUTO_* 要求 PLUGIN）', () => {
    const h = harness()
    throwsIntervention(
      () =>
        h.service.createMechanicalIntervention(
          { title: 't', trigger: 'PLAN_FORK_FLOODING', workstream_ids: ['WS-1'] },
          AGENT,
        ),
      'IV_ACTOR_FORBIDDEN',
      /PLUGIN/,
    )
  })

  it('AGENT actor 无 run_id ⇒ 真实 registry 拒绝（IV_EVENT）— 事件先行, 行不落', () => {
    const h = harness()
    throwsIntervention(
      () =>
        h.service.createMechanicalIntervention(
          { title: 't', trigger: 'AGENT_REPORT_REQUIRES_HUMAN', workstream_ids: ['WS-1'] },
          { kind: 'AGENT', label: 'agent' } as const,
        ),
      'IV_EVENT',
      /run_id/,
    )
    expect(h.lifecycle.listInterventions()).toHaveLength(0)
  })

  it('AGENT actor 指向不存在的 Run ⇒ 真实 registry 拒绝（IV_EVENT）', () => {
    const h = harness()
    throwsIntervention(
      () =>
        h.service.createMechanicalIntervention(
          { title: 't', trigger: 'AGENT_REPORT_REQUIRES_HUMAN', workstream_ids: ['WS-1'] },
          { kind: 'AGENT', run_id: 'R-99', label: 'agent' } as const,
        ),
      'IV_EVENT',
      /R-99/,
    )
    expect(h.lifecycle.listInterventions()).toHaveLength(0)
  })

  it('失败烧号留 gap（§1.1 单调）: registry 拒绝烧 IV-1, 下一次成功 = IV-2', () => {
    const h = harness()
    expect(
      () =>
        h.service.createMechanicalIntervention(
          { title: 't', trigger: 'AGENT_REPORT_REQUIRES_HUMAN', workstream_ids: ['WS-1'] },
          { kind: 'AGENT' } as const, // 无 run_id ⇒ registry 拒绝
        ),
    ).toThrow(InterventionError)
    const ok = h.service.createUserIntervention({ title: '下一条', workstream_ids: ['WS-1'] }, USER)
    expect(ok.intervention.id).toBe('IV-2')
  })

  it('INV-ATTN-5 闭集逐字 pin: 三值 + origin/actor 映射（无第四种入口 — Claim conflict 不在列）', () => {
    expect([...MECHANICAL_TRIGGER_KINDS]).toEqual([
      'PLAN_FORK_FLOODING',
      'AUDIT_HIGH_IMPACT_DISCREPANCY',
      'AGENT_REPORT_REQUIRES_HUMAN',
    ])
    expect(MECHANICAL_TRIGGER_ORIGIN).toEqual({
      PLAN_FORK_FLOODING: 'AUTO_FLOODING',
      AUDIT_HIGH_IMPACT_DISCREPANCY: 'AUTO_AUDIT',
      AGENT_REPORT_REQUIRES_HUMAN: 'AGENT_REPORT',
    })
    expect(MECHANICAL_TRIGGER_ACTOR_KIND).toEqual({
      PLAN_FORK_FLOODING: 'PLUGIN',
      AUDIT_HIGH_IMPACT_DISCREPANCY: 'PLUGIN',
      AGENT_REPORT_REQUIRES_HUMAN: 'AGENT',
    })
    // 闭集 = 冻结 4 origin 的 AUTO_* 半集 + AGENT_REPORT（§6 脚注 ¹ 三类）;
    // USER 不是机械 trigger（用户类走 createUserIntervention）。
    expect(Object.keys(MECHANICAL_TRIGGER_ORIGIN).sort()).toEqual([...MECHANICAL_TRIGGER_KINDS].sort())
    expect(Object.values(MECHANICAL_TRIGGER_ORIGIN).includes('USER')).toBe(false)
  })
})

/* ================================================================== *
 * 状态迁移 — §13 全转换 + 权限双面（INV-PERM-4）
 * ================================================================== */

describe('updateState（§13 状态机全转换, 仅用户）', () => {
  function seed(h: InterventionHarness, status: IvStatus): InterventionRecord {
    const r = h.service.createUserIntervention({ title: `seed-${status}`, workstream_ids: ['WS-1'] }, USER).intervention
    // 预置状态（直接状态缓存列 — 测试探针; 生产路径只经本 service）。
    h.raw.prepare(`UPDATE intervention SET status = ? WHERE id = ?`).run(status, r.id)
    return h.lifecycle.getIntervention(r.id)!
  }

  it('全格矩阵: 4 合法迁移逐格放行 + 5 非法格（含自环/终态出口）逐格拒绝', () => {
    for (const from of IV_STATUSES) {
      for (const to of IV_STATUSES) {
        const h = harness()
        seed(h, from)
        const legal = IV_TRANSITIONS[from].includes(to)
        if (legal) {
          const result = h.service.updateState('IV-1', to, USER, ...(to === 'CLOSED' && from === 'PENDING' ? ['处理完毕'] : []))
          expect(result, `legal ${from} -> ${to}`).toMatchObject({
            interventionId: 'IV-1',
            statusFrom: from,
            statusTo: to,
          })
          const row = h.lifecycle.getIntervention('IV-1')!
          expect(row.status).toBe(to)
          if (to === 'CLOSED') {
            expect(row.closed_at).toBeTypeOf('number')
            expect(result.closedAt).toBe(row.closed_at)
            if (from === 'PENDING') {
              expect(row.resolution_note).toBe('处理完毕')
              expect(result.resolutionNote).toBe('处理完毕')
            } else {
              expect(row.resolution_note).toBeUndefined()
              expect(result.resolutionNote).toBeNull()
            }
          } else {
            expect(row.closed_at).toBeUndefined()
            expect(result.closedAt).toBeNull()
            expect(result.resolutionNote).toBeNull()
          }
        } else {
          const err = throwsIntervention(
            () => h.service.updateState('IV-1', to, USER),
            'IV_ILLEGAL_TRANSITION',
            new RegExp(`${from} -> ${to}`),
          )
          // 行不变 + 零事件（迁移无事件面 — 冻结目录无对应事件）。
          expect(h.lifecycle.getIntervention('IV-1')!.status).toBe(from)
          expect(h.dbPair.store.listRange('WS-1', 2)).toHaveLength(0)
          if (from === 'CLOSED') {
            expect(err.message).toMatch(/terminal/)
          }
        }
      }
    }
  })

  it('OPEN → PENDING（待处理）: 行状态 + 结果 DTO 逐字', () => {
    const h = harness()
    h.service.createUserIntervention({ title: 't', workstream_ids: ['WS-1'] }, USER)
    const result = h.service.updateState('IV-1', 'PENDING', USER)
    expect(result).toEqual({ interventionId: 'IV-1', statusFrom: 'OPEN', statusTo: 'PENDING', closedAt: null, resolutionNote: null })
    expect(h.lifecycle.getIntervention('IV-1')!.status).toBe('PENDING')
  })

  it('resolutionNote 仅随 CLOSED（非关闭携带 ⇒ IV_INPUT, 行不变）', () => {
    const h = harness()
    h.service.createUserIntervention({ title: 't', workstream_ids: ['WS-1'] }, USER)
    throwsIntervention(
      () => h.service.updateState('IV-1', 'PENDING', USER, 'note'),
      'IV_INPUT',
      /only valid when closing/,
    )
    expect(h.lifecycle.getIntervention('IV-1')!.status).toBe('OPEN')
  })

  it('不存在 id ⇒ IV_NOT_FOUND; 坏 id 模式 / 坏 status ⇒ IV_INPUT', () => {
    const h = harness()
    throwsIntervention(() => h.service.updateState('IV-99', 'CLOSED', USER), 'IV_NOT_FOUND')
    throwsIntervention(() => h.service.updateState('IV-0', 'CLOSED', USER), 'IV_INPUT')
    h.service.createUserIntervention({ title: 't', workstream_ids: ['WS-1'] }, USER)
    throwsIntervention(() => h.service.updateState('IV-1', 'DONE' as unknown as IvStatus, USER), 'IV_INPUT')
  })

  it('乐观并发门: 迁移期间状态已变（0 行）⇒ IV_CONCURRENT_STATE（大声, 不猜）', () => {
    const h = harness()
    h.service.createUserIntervention({ title: 't', workstream_ids: ['WS-1'] }, USER)
    // 子类 lifecycle: getIntervention 返回**陈旧** OPEN（模拟读后行被并发改为
    // PENDING）— 继承真实行面（super 方法 this = 真实实例, 私有面完好）,
    // 只换读面（同 stale-precheck 测试的 fake 面纪律）。
    class StaleLifecycle extends InterventionLifecycleStore {
      constructor(options: ConstructorParameters<typeof InterventionLifecycleStore>[0], private readonly staleStatus: IvStatus) {
        super(options)
      }
      override getIntervention(id: string): InterventionRecord | null {
        const row = super.getIntervention(id)
        return row === null ? null : { ...row, status: this.staleStatus, closed_at: undefined, resolution_note: undefined }
      }
    }
    const staleLifecycle = new StaleLifecycle(
      { db: h.dbPair.db, interventions: h.interventions },
      'OPEN',
    )
    const staleService = new InterventionService({
      store: h.dbPair.store,
      registry: h.registry,
      lifecycle: staleLifecycle,
      allocator: h.allocator,
      projectId: 'PRJ-1',
      externalState: () => h.external,
      now: h.now,
    })
    h.raw.prepare(`UPDATE intervention SET status = 'PENDING' WHERE id = 'IV-1'`).run()
    throwsIntervention(
      () => staleService.updateState('IV-1', 'PENDING', USER),
      'IV_CONCURRENT_STATE',
      /moved concurrently/,
    )
    expect(h.lifecycle.getIntervention('IV-1')!.status).toBe('PENDING')
  })

  it('权限**类型面**: 非 USER actor 是编译错误（@ts-expect-error 钉死 — 仅 tsc 校验, 永不执行）', () => {
    const h = harness()
    h.service.createUserIntervention({ title: 't', workstream_ids: ['WS-1'] }, USER)
    // 这些 lambda **从不被调用**（vitest 不做类型检查 — @ts-expect-error
    // 的钉死只在 `tsc --noEmit` 时生效: 删掉注释 = 构建红）。
    const forbiddenUpdateAgent = () => {
      // @ts-expect-error — AGENT actor 不是 UserActorRef（INV-PERM-4 类型面）
      h.service.updateState('IV-1', 'CLOSED', { kind: 'AGENT', run_id: 'R-1' })
    }
    const forbiddenUpdatePlugin = () => {
      // @ts-expect-error — PLUGIN actor 不是 UserActorRef
      h.service.updateState('IV-1', 'CLOSED', { kind: 'PLUGIN' })
    }
    const forbiddenCreateAgent = () => {
      // @ts-expect-error — 用户创建面同样不接受 AGENT
      h.service.createUserIntervention({ title: 'x' }, { kind: 'AGENT', run_id: 'R-1' })
    }
    expect(forbiddenUpdateAgent).toBeTypeOf('function')
    expect(forbiddenUpdatePlugin).toBeTypeOf('function')
    expect(forbiddenCreateAgent).toBeTypeOf('function')
    // 行未动（零调用 ⇒ 零写入）。
    expect(h.lifecycle.getIntervention('IV-1')!.status).toBe('OPEN')
  })

  it('权限**运行面**: 伪造非 USER actor ⇒ IV_ACTOR_FORBIDDEN（零写入, 行/事件不变）', () => {
    const h = harness()
    h.service.createUserIntervention({ title: 't', workstream_ids: ['WS-1'] }, USER)
    throwsIntervention(
      () => h.service.updateState('IV-1', 'CLOSED', { kind: 'AGENT', run_id: 'R-1' } as unknown as UserActorRef),
      'IV_ACTOR_FORBIDDEN',
      /USER actor/,
    )
    throwsIntervention(
      () => h.service.updateState('IV-1', 'PENDING', { kind: 'PLUGIN' } as unknown as UserActorRef),
      'IV_ACTOR_FORBIDDEN',
      /USER actor/,
    )
    // 行未动 + 迁移未产生任何事件（目录无事件面）。
    expect(h.lifecycle.getIntervention('IV-1')!.status).toBe('OPEN')
    expect(h.dbPair.store.listRange('WS-1', 2)).toHaveLength(0)
  })
})

/* ================================================================== *
 * 查询面 — INV-ATTN-1（无隐藏过滤器）
 * ================================================================== */

describe('查询面（INV-ATTN-1: 全量, 无隐藏过滤器）', () => {
  it('混合 origin/WS/状态: OPEN/PENDING/CLOSED 三组全量逐字（计数 = 全部行, 零隐藏）', () => {
    const h = harness()
    const a = h.service.createUserIntervention({ title: 'a', workstream_ids: ['WS-1'] }, USER).intervention
    const b = h.service.createMechanicalIntervention(
      { title: 'b', trigger: 'AGENT_REPORT_REQUIRES_HUMAN', workstream_ids: ['WS-2'] },
      AGENT,
    ).intervention
    const c = h.service.createMechanicalIntervention(
      { title: 'c', trigger: 'PLAN_FORK_FLOODING', workstream_ids: ['WS-1'] },
      PLUGIN,
    ).intervention
    const d = h.service.createMechanicalIntervention(
      { title: 'd', trigger: 'AUDIT_HIGH_IMPACT_DISCREPANCY', workstream_ids: ['WS-1', 'WS-2'] },
      PLUGIN,
    ).intervention
    // 状态布置: b→PENDING, c→PENDING, d→CLOSED（经用户面全流）。
    h.service.updateState(b.id, 'PENDING', USER)
    h.service.updateState(c.id, 'PENDING', USER)
    h.service.updateState(d.id, 'CLOSED', USER, '审计差异已处置')

    const open = h.service.listOpen()
    // 全量 = 不隐藏: 迁移后的 OPEN 组恰为 [a]（USER 组）, 无过滤无截断。
    expect(open.map((r) => r.id)).toEqual([a.id])
    expect(open.map((r) => r.origin)).toEqual(['USER'])

    const pending = h.service.listPending()
    expect(pending.map((r) => r.id)).toEqual([b.id, c.id].sort())
    // PENDING 组跨两个 origin 来源组（用户创建类的 AGENT_REPORT + 机械类的 AUTO_*）
    // 全在 — 无隐藏过滤器。
    expect(pending.map((r) => r.origin).sort()).toEqual(['AGENT_REPORT', 'AUTO_FLOODING'])

    const active = h.service.listActive()
    expect([...active.open, ...active.pending].map((r) => r.id).sort()).toEqual([a.id, b.id, c.id].sort())
    // 全量不变量: OPEN + PENDING = 全部非 CLOSED 行（无隐藏过滤器）。
    expect(active.open.length + active.pending.length).toBe(h.lifecycle.listInterventions().length - 1) // −1 = CLOSED 行

    const closed = h.service.listClosed()
    expect(closed).toHaveLength(1)
    expect(closed[0]).toMatchObject({ id: d.id, status: 'CLOSED', resolution_note: '审计差异已处置', closed_at: expect.any(Number) })

    // get: 每行可单查（含 CLOSED）。
    for (const id of [a.id, b.id, c.id, d.id]) {
      expect(h.service.get(id)!.id).toBe(id)
    }
    expect(h.service.get('IV-99')).toBeNull()

    // 稳定顺序: created_at ASC, id ASC（harness 单调时钟下 = 创建序）。
    expect(h.service.listActive().open.map((r) => r.id)).toEqual([a.id])
    expect(h.service.listActive().pending.map((r) => r.id)).toEqual([b.id, c.id])
  })

  it('空库: 四查询面全空（不是 undefined / 不是错误）', () => {
    const h = harness()
    expect(h.service.listOpen()).toEqual([])
    expect(h.service.listPending()).toEqual([])
    expect(h.service.listClosed()).toEqual([])
    expect(h.service.listActive()).toEqual({ open: [], pending: [] })
  })
})
