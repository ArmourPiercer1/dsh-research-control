/**
 * WP-5.5 — brief 切片测试（`briefFromClientSlices` 纯映射 + 切片状态机）。
 *
 * 覆盖（任务测试项「store 切片」）:
 *  - `briefFromClientSlices`: dashboard(+project) 快照 → 三级 Brief
 *    （wire-valid fixture 经 strict schema 重解析 — 契约漂移 ⇒ 红;
 *    objectives 来自 project 切片 — project null ⇒ 空集占位）;
 *  - 切片状态机（与 WP-4.1b 引擎/WP-5.4 attention 切片同族）:
 *    双实例独立 / ready 落定 / **内容未变 ⇒ 引用稳定**（uSES 不重渲,
 *    generatedAt 元数据不进比较）/ 内容变化 ⇒ 新引用 / loading 保陈旧
 *    / error 无缓存·有缓存 / error 重复同消息引用不变 / idle 防御清空 /
 *    subscribe-dispose 幂等;
 *  - project 节点不参与状态机（Brief 只硬依赖 dashboard）: project
 *    ready/error 只经 data 参与重算（内容变化 ⇒ 新引用, 状态保持 ready）。
 */

import { describe, expect, it } from 'vitest'

import { DashboardSnapshotSchema, ProjectSnapshotSchema } from '../../src/shared/rpc-contracts.js'
import type { DashboardSnapshot, ProjectSnapshot } from '../../src/shared/rpc-contracts.js'
import {
  createBriefSliceStore,
  initialBriefSlice,
  briefFromClientSlices,
  type BriefSyncInput,
} from '../../src/client/stores/brief-slice.js'
import { validateBriefRefs } from '../../src/host/service/brief/project.js'
import { ATTENTION_DASHBOARD_FIXTURE, T_NOW } from '../attention/fixtures.js'
import { PROJECT_FIXTURE } from '../rpc-face/fixtures.js'

/* -------------------------------------------------------------------- *
 * 契约钉（wire fixture strict 重解析 — 漂移 ⇒ 红）。
 * parse 校验形状（strict schema）; 一处既有 schema/类型角差（schema 的
 * description 为 optional — 冻结 TS 类型为 string | null）用显式 cast
 * 收敛, 注释记此 — 夹具两字段实际值均为 null（下方断言钉）。
 * -------------------------------------------------------------------- */

const parsedDashboard = DashboardSnapshotSchema.parse(ATTENTION_DASHBOARD_FIXTURE)
const parsedProject = ProjectSnapshotSchema.parse(PROJECT_FIXTURE)
const DASHBOARD = parsedDashboard as unknown as DashboardSnapshot
const PROJECT = parsedProject as unknown as ProjectSnapshot

describe('契约钉', () => {
  it('夹具在 description 角差处实际值有定义（cast 收敛面 — 无 undefined 混入 TS 类型要求的 string | null 位）', () => {
    expect(parsedDashboard.project.description).toBeNull()
    expect(parsedProject.project.description).toBe('A research project')
  })
})

/* -------------------------------------------------------------------- *
 * briefFromClientSlices（纯映射）
 * -------------------------------------------------------------------- */

describe('briefFromClientSlices（client 数据面 → 引擎输入）', () => {
  it('dashboard + project ⇒ 三级 Brief: L1 标题/计数 + objectives DATA 点 + interventions DATA 点', () => {
    const brief = briefFromClientSlices(DASHBOARD, PROJECT, T_NOW)
    expect(validateBriefRefs(brief)).toEqual([])
    expect(brief.generatedAt).toBe(T_NOW)
    expect(brief.level1.statement).toBe('《Project One》：1 个活跃目标；干预 1 OPEN / 1 PENDING')
    // L1 refs = 项目 + 注意力 Top（2 IV）:
    expect(brief.level1.refs.map((r) => (r.kind === 'OBJECT' ? r.id : r.eventId))).toEqual(['PRJ-1', 'IV-1', 'IV-2'])
    // objectives（来自 project 切片）:
    const obj = brief.level2.find((p) => p.category === 'OBJECTIVE')!
    expect(obj.status).toBe('DATA')
    expect(obj.refs[0]).toEqual({ kind: 'OBJECT', objectKind: 'OBJECTIVE', id: 'OBJ-1' })
    // interventions（来自 dashboard 全集）:
    const iv = brief.level2.find((p) => p.category === 'INTERVENTION')!
    expect(iv.statement).toBe('2 项人工干预待处理（OPEN 1 / PENDING 1）')
    expect(iv.refs.map((r) => (r.kind === 'OBJECT' ? r.id : ''))).toEqual(['IV-1', 'IV-2'])
    // client 无 wire 路径的面 = 占位/EMPTY（不虚构）:
    expect(brief.level2.find((p) => p.category === 'RECENT')!.status).toBe('PLACEHOLDER')
    expect(brief.level3.find((r) => r.plane === 'history')!.status).toBe('EMPTY')
    expect(brief.level3.find((r) => r.plane === 'nextActions')!.status).toBe('EMPTY')
    expect(brief.level3.find((r) => r.plane === 'audit')!.status).toBe('PLACEHOLDER')
    expect(brief.level3.find((r) => r.plane === 'inbox')!.status).toBe('PLACEHOLDER')
    // L3 计数:
    expect(brief.level3.find((r) => r.plane === 'interventions')!.count).toBe(2)
    expect(brief.level3.find((r) => r.plane === 'objectives')!.count).toBe(1)
    expect(brief.level3.find((r) => r.plane === 'attention')!.count).toBe(2)
    expect(brief.level3.find((r) => r.plane === 'dashboard')!.count).toBe(2)
  })

  it('project null ⇒ objectives 空集占位（不阻塞 Brief — 状态机不硬依赖）', () => {
    const brief = briefFromClientSlices(DASHBOARD, null, T_NOW)
    expect(validateBriefRefs(brief)).toEqual([])
    expect(brief.level2.find((p) => p.category === 'OBJECTIVE')!.status).toBe('PLACEHOLDER')
    expect(brief.level3.find((r) => r.plane === 'objectives')!.status).toBe('EMPTY')
    // 其余面不受影响:
    expect(brief.level2.find((p) => p.category === 'INTERVENTION')!.status).toBe('DATA')
  })

  it('空 dashboard（无候选）⇒ 全占位面（空工作区 — 与 host 同形）', () => {
    const emptyDashboard: DashboardSnapshot = { ...DASHBOARD, openInterventions: [], pendingInterventions: [] }
    const brief = briefFromClientSlices(emptyDashboard, null, T_NOW)
    expect(validateBriefRefs(brief)).toEqual([])
    expect(brief.level1.statement).toBe('《Project One》：无进行中数据（各数据面为空集）')
  })

  it('dashboard 组内错位行防御（open 组 PENDING 行不进 interventions 面 — WP-5.4 同口径）', () => {
    const messy: DashboardSnapshot = {
      ...DASHBOARD,
      openInterventions: [
        ...DASHBOARD.openInterventions,
        {
          id: 'IV-9',
          title: '错位行',
          origin: 'USER',
          status: 'PENDING',
          workstreamIds: [],
          createdAt: T_NOW,
        },
      ],
    }
    const brief = briefFromClientSlices(messy, null, T_NOW)
    const ivRow = brief.level3.find((r) => r.plane === 'interventions')!
    // 只收真 OPEN（IV-1）+ 真 PENDING（IV-2）— 错位 IV-9 被两组同时拒绝:
    expect(ivRow.count).toBe(2)
  })
})

/* -------------------------------------------------------------------- *
 * 切片状态机
 * -------------------------------------------------------------------- */

const readyDashboard = { status: 'ready' as const, data: DASHBOARD, error: null }
const readyProject = { status: 'ready' as const, data: PROJECT, error: null }
const idleProject = { status: 'idle' as const, data: null, error: null }

function makeSync(over: Partial<BriefSyncInput> = {}): BriefSyncInput {
  return { dashboard: readyDashboard, project: readyProject, ...over }
}

describe('brief 切片状态机（WP-4.1b 同族）', () => {
  it('初始 = idle 空切片', () => {
    const store = createBriefSliceStore({ now: () => T_NOW })
    expect(store.getSnapshot()).toEqual(initialBriefSlice())
  })

  it('双实例独立（工厂结果 — 无模块级句柄）', () => {
    const a = createBriefSliceStore({ now: () => T_NOW })
    const b = createBriefSliceStore({ now: () => T_NOW })
    a.sync(makeSync())
    expect(a.getSnapshot().status).toBe('ready')
    expect(b.getSnapshot().status).toBe('idle')
  })

  it('dashboard ready ⇒ ready + 数据; project 未 ready 不阻塞', () => {
    const store = createBriefSliceStore({ now: () => T_NOW })
    store.sync(makeSync({ project: idleProject }))
    const snap = store.getSnapshot()
    expect(snap.status).toBe('ready')
    expect(snap.data!.level2.find((p) => p.category === 'OBJECTIVE')!.status).toBe('PLACEHOLDER')
  })

  it('内容未变 ⇒ 快照引用不变（uSES 不重渲; generatedAt 元数据不进比较）', () => {
    const store = createBriefSliceStore({ now: () => T_NOW })
    store.sync(makeSync())
    const first = store.getSnapshot()
    store.sync(makeSync())
    expect(store.getSnapshot()).toBe(first)
    // 同内容但 now 推进（generatedAt 变）⇒ 仍同引用:
    let clock = T_NOW
    const store2 = createBriefSliceStore({ now: () => clock })
    store2.sync(makeSync())
    const first2 = store2.getSnapshot()
    clock = T_NOW + 1000
    store2.sync(makeSync())
    expect(store2.getSnapshot()).toBe(first2)
  })

  it('内容变化 ⇒ 新引用（dashboard 数据面变更）', () => {
    const store = createBriefSliceStore({ now: () => T_NOW })
    store.sync(makeSync())
    const first = store.getSnapshot()
    const changed: DashboardSnapshot = {
      ...DASHBOARD,
      pendingInterventions: [
        ...DASHBOARD.pendingInterventions,
        { id: 'IV-3', title: '新增', origin: 'USER', status: 'PENDING', workstreamIds: ['WS-1'], createdAt: T_NOW },
      ],
    }
    store.sync({ ...makeSync(), dashboard: { status: 'ready', data: changed, error: null } })
    const second = store.getSnapshot()
    expect(second).not.toBe(first)
    expect(second.data!.level3.find((r) => r.plane === 'interventions')!.count).toBe(3)
  })

  it('project ready 后到 ⇒ objectives 填充（内容变化 ⇒ 新引用, 状态保持 ready）', () => {
    const store = createBriefSliceStore({ now: () => T_NOW })
    store.sync(makeSync({ project: idleProject }))
    const first = store.getSnapshot()
    store.sync(makeSync())
    const second = store.getSnapshot()
    expect(second).not.toBe(first)
    expect(second.status).toBe('ready')
    expect(second.data!.level2.find((p) => p.category === 'OBJECTIVE')!.status).toBe('DATA')
  })

  it('project error（data null）⇒ objectives 回落空集（内容变化 ⇒ 新引用, 状态保持 ready）', () => {
    const store = createBriefSliceStore({ now: () => T_NOW })
    store.sync(makeSync())
    const first = store.getSnapshot()
    store.sync({ ...makeSync(), project: { status: 'error', data: null, error: 'boom' } })
    const second = store.getSnapshot()
    expect(second).not.toBe(first)
    expect(second.status).toBe('ready')
    expect(second.data!.level2.find((p) => p.category === 'OBJECTIVE')!.status).toBe('PLACEHOLDER')
  })

  it('loading 保陈旧（ready → loading: data 保留, 状态 loading）', () => {
    const store = createBriefSliceStore({ now: () => T_NOW })
    store.sync(makeSync())
    const stale = store.getSnapshot()
    store.sync({ ...makeSync(), dashboard: { status: 'loading', data: DASHBOARD, error: null } })
    const snap = store.getSnapshot()
    expect(snap.status).toBe('loading')
    expect(snap.data).toBe(stale.data)
    expect(snap.error).toBeNull()
  })

  it('loading 自 idle（无缓存）: data null, 状态 loading', () => {
    const store = createBriefSliceStore({ now: () => T_NOW })
    store.sync({ ...makeSync(), dashboard: { status: 'loading', data: null, error: null } })
    const snap = store.getSnapshot()
    expect(snap.status).toBe('loading')
    expect(snap.data).toBeNull()
  })

  it('error 无缓存 ⇒ error 面; 重复同消息 ⇒ 引用不变', () => {
    const store = createBriefSliceStore({ now: () => T_NOW })
    store.sync({ ...makeSync(), dashboard: { status: 'error', data: null, error: 'NOT_READY' } })
    const first = store.getSnapshot()
    expect(first.status).toBe('error')
    expect(first.error).toBe('NOT_READY')
    expect(first.data).toBeNull()
    store.sync({ ...makeSync(), dashboard: { status: 'error', data: null, error: 'NOT_READY' } })
    expect(store.getSnapshot()).toBe(first)
  })

  it('error 有缓存 ⇒ 陈旧 brief + 错误条（stale-while-revalidate）', () => {
    const store = createBriefSliceStore({ now: () => T_NOW })
    store.sync(makeSync())
    const stale = store.getSnapshot()
    store.sync({ ...makeSync(), dashboard: { status: 'error', data: null, error: 'refresh failed' } })
    const snap = store.getSnapshot()
    expect(snap.status).toBe('error')
    expect(snap.data).toBe(stale.data)
    expect(snap.error).toBe('refresh failed')
  })

  it('idle 防御 ⇒ 清空缓存', () => {
    const store = createBriefSliceStore({ now: () => T_NOW })
    store.sync(makeSync())
    store.sync({ ...makeSync(), dashboard: { status: 'idle', data: null, error: null } })
    expect(store.getSnapshot()).toEqual(initialBriefSlice())
  })

  it('subscribe/dispose 幂等', () => {
    const store = createBriefSliceStore({ now: () => T_NOW })
    let notified = 0
    const dispose = store.subscribe(() => {
      notified += 1
    })
    store.sync(makeSync())
    dispose()
    const after = notified
    store.sync(makeSync())
    expect(notified).toBe(after)
    dispose() // 二次 dispose 不抛
  })
})
