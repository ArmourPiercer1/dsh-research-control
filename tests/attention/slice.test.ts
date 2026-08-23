/**
 * WP-5.4 — attention store 切片（src/client/stores/attention-slices.ts）
 * 单元测试。
 *
 * 覆盖（任务测试项: store 切片）:
 *  - 工厂面（两实例独立 — 零模块级句柄; DSH_ADAPTER §6 纪律）;
 *  - 状态机: idle → ready（ranking 落定）; loading 保持陈旧 ranking
 *    （stale-while-revalidate）; error 无缓存 → error 面; error 有缓存
 *    → 陈旧 ranking + 错误条;
 *  - **uSES 引用稳定**（引擎 §1）: 内容未变的 ready 同步 ⇒ 快照引用不变
 *    （不重渲）; 内容变更 ⇒ 新引用;
 *  - `rankingFromDashboard` 映射: DTO → 评分输入（第一个关联 WS / 无则
 *    null / createdAt / origin / status）; context 取 dashboard.project
 *    真实 importance/attention_mode（baseline 零权重 ⇒ 与 host 默认值
 *    同序 — host/client 一致性）;
 *  - wire-valid fixture 经 strict schema 重解析（契约漂移 ⇒ 套件红）。
 */
import { DashboardSnapshotSchema } from '../../src/shared/rpc-contracts.js'
import { describe, expect, it } from 'vitest'
import {
  createAttentionRankingStore,
  initialAttentionRankingSlice,
  rankingFromDashboard,
  type DashboardProjection,
} from '../../src/client/stores/attention-slices.js'
import {
  ATTENTION_DASHBOARD_FIXTURE,
  ATTENTION_EMPTY_DASHBOARD_FIXTURE,
  T_NOW,
} from './fixtures.js'

const NOW = () => T_NOW

describe('fixture wire-validity（契约漂移 ⇒ 套件红）', () => {
  it('ATTENTION_DASHBOARD_FIXTURE 与 EMPTY 过 strict schema', () => {
    expect(() => DashboardSnapshotSchema.parse(ATTENTION_DASHBOARD_FIXTURE)).not.toThrow()
    expect(() => DashboardSnapshotSchema.parse(ATTENTION_EMPTY_DASHBOARD_FIXTURE)).not.toThrow()
  })
})

describe('rankingFromDashboard（DTO → 评分输入映射）', () => {
  it('OPEN + PENDING 全集进评分（INV-ATTN-1 client 半边: 恒完整）', () => {
    const ranking = rankingFromDashboard(ATTENTION_DASHBOARD_FIXTURE, T_NOW)
    expect(ranking.items.map((i) => i.id)).toEqual(['IV-1', 'IV-2'])
    const iv1 = ranking.items[0]!
    expect(iv1.kind).toBe('INTERVENTION')
    if (iv1.kind !== 'INTERVENTION') throw new Error('fixture kind drift')
    expect(iv1.origin).toBe('AUTO_FLOODING')
    expect(iv1.status).toBe('OPEN')
    expect(iv1.workstreamId).toBe('WS-1') // 第一个关联 WS
    expect(iv1.createdAt).toBe(ATTENTION_DASHBOARD_FIXTURE.openInterventions[0]!.createdAt)
    expect(ranking.generatedAt).toBe(T_NOW)
  })

  it('空 dashboard ⇒ 空排序（不伪造数据）', () => {
    expect(rankingFromDashboard(ATTENTION_EMPTY_DASHBOARD_FIXTURE, T_NOW).items).toEqual([])
  })

  it('context 差异不产生排序分歧（baseline 零权重 — host/client 一致性）', () => {
    const a = rankingFromDashboard(ATTENTION_DASHBOARD_FIXTURE, T_NOW)
    // 同数据、不同 now（时间近度只作用于 ScheduledEvent; 本面无事件）⇒ 同序:
    const b = rankingFromDashboard(ATTENTION_DASHBOARD_FIXTURE, T_NOW + 3600 * 1000)
    expect(b.items.map((i) => `${i.id}:${i.score}`)).toEqual(a.items.map((i) => `${i.id}:${i.score}`))
  })
})

describe('切片状态机 + uSES 引用稳定', () => {
  it('初始 idle; 双实例独立（零模块级句柄）', () => {
    const a = createAttentionRankingStore({ now: NOW })
    const b = createAttentionRankingStore({ now: NOW })
    expect(a.getSnapshot()).toEqual(initialAttentionRankingSlice())
    expect(b.getSnapshot()).toEqual(initialAttentionRankingSlice())
    a.sync({ status: 'ready', data: ATTENTION_DASHBOARD_FIXTURE, error: null })
    expect(a.getSnapshot().status).toBe('ready')
    expect(b.getSnapshot().status).toBe('idle') // 互不串扰
  })

  it('ready 同步 ⇒ ranking 落定; 内容未变的再同步 ⇒ 快照引用不变', () => {
    const store = createAttentionRankingStore({ now: NOW })
    store.sync({ status: 'loading', data: null, error: null })
    expect(store.getSnapshot().status).toBe('loading')

    store.sync({ status: 'ready', data: ATTENTION_DASHBOARD_FIXTURE, error: null })
    const first = store.getSnapshot()
    expect(first.status).toBe('ready')
    expect(first.data?.items.map((i) => i.id)).toEqual(['IV-1', 'IV-2'])
    expect(first.updatedAt).toBe(T_NOW)

    // 同内容再同步（例如 refresh 循环 refetch 了同样的 dashboard）:
    store.sync({ status: 'ready', data: ATTENTION_DASHBOARD_FIXTURE, error: null })
    expect(store.getSnapshot()).toBe(first) // 引用稳定 — 不重渲
  })

  it('内容变更 ⇒ 新引用（新 Intervention 进 dashboard）', () => {
    const store = createAttentionRankingStore({ now: NOW })
    store.sync({ status: 'ready', data: ATTENTION_DASHBOARD_FIXTURE, error: null })
    const before = store.getSnapshot()
    const grown: typeof ATTENTION_DASHBOARD_FIXTURE = {
      ...ATTENTION_DASHBOARD_FIXTURE,
      pendingInterventions: [
        ...ATTENTION_DASHBOARD_FIXTURE.pendingInterventions,
        {
          id: 'IV-3',
          title: '新增的审计差异',
          origin: 'AUTO_AUDIT',
          status: 'PENDING',
          workstreamIds: ['WS-1'],
          createdAt: T_NOW + 60 * 1000,
        },
      ],
    }
    store.sync({ status: 'ready', data: grown, error: null })
    const after = store.getSnapshot()
    expect(after).not.toBe(before)
    expect(after.data?.items.map((i) => i.id).sort()).toEqual(['IV-1', 'IV-2', 'IV-3'])
  })

  it('loading 保持陈旧 ranking（stale-while-revalidate）', () => {
    const store = createAttentionRankingStore({ now: NOW })
    store.sync({ status: 'ready', data: ATTENTION_DASHBOARD_FIXTURE, error: null })
    const ready = store.getSnapshot()
    store.sync({ status: 'loading', data: null, error: null })
    const loading = store.getSnapshot()
    expect(loading.status).toBe('loading')
    expect(loading.data).toBe(ready.data) // 旧数据保持可见
    expect(loading.error).toBeNull()
  })

  it('error 无缓存 ⇒ error 面; error 有缓存 ⇒ 陈旧 ranking + 错误条', () => {
    const fresh = createAttentionRankingStore({ now: NOW })
    fresh.sync({ status: 'error', data: null, error: 'getDashboard: BIZ_FAULT' })
    expect(fresh.getSnapshot()).toMatchObject({ status: 'error', data: null, error: 'getDashboard: BIZ_FAULT' })

    const withCache = createAttentionRankingStore({ now: NOW })
    withCache.sync({ status: 'ready', data: ATTENTION_DASHBOARD_FIXTURE, error: null })
    const ready = withCache.getSnapshot()
    withCache.sync({ status: 'error', data: null, error: 'refresh: TIMEOUT' })
    const stale = withCache.getSnapshot()
    expect(stale.status).toBe('error')
    expect(stale.error).toBe('refresh: TIMEOUT')
    expect(stale.data).toBe(ready.data) // 陈旧数据保留
  })

  it('error 重复同步同消息 ⇒ 引用不变', () => {
    const store = createAttentionRankingStore({ now: NOW })
    store.sync({ status: 'error', data: null, error: 'E1' })
    const a = store.getSnapshot()
    store.sync({ status: 'error', data: null, error: 'E1' })
    expect(store.getSnapshot()).toBe(a)
  })

  it('subscribe/dispose 语义（uSES 面）', () => {
    const store = createAttentionRankingStore({ now: NOW })
    let ticks = 0
    const dispose = store.subscribe(() => {
      ticks += 1
    })
    store.sync({ status: 'ready', data: ATTENTION_DASHBOARD_FIXTURE, error: null })
    expect(ticks).toBe(1)
    dispose()
    store.sync({ status: 'ready', data: ATTENTION_EMPTY_DASHBOARD_FIXTURE, error: null })
    expect(ticks).toBe(1) // disposed 后不再通知
    dispose() // 幂等
  })
})

describe('sync 入参面（容器驱动契约）', () => {
  it('idle 投影清空缓存（防御面）', () => {
    const store = createAttentionRankingStore({ now: NOW })
    store.sync({ status: 'ready', data: ATTENTION_DASHBOARD_FIXTURE, error: null })
    store.sync({ status: 'idle', data: null, error: null })
    expect(store.getSnapshot()).toEqual(initialAttentionRankingSlice())
  })
})

/** 类型面: 主 store 的 dashboard 切片节点（`SliceState<DashboardSnapshot>`）
 *  可直接作为 `DashboardProjection` 传入 `sync`（容器无转换层 —
 *  结构兼容是编译期保证）。 */
import type { SliceState } from '../../src/client/stores/model.js'
import type { DashboardSnapshot } from '../../src/shared/rpc-contracts.js'

function _sliceIsProjection(slice: SliceState<DashboardSnapshot>): DashboardProjection {
  return slice
}
void _sliceIsProjection
