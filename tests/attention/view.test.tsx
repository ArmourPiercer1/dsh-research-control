// @vitest-environment jsdom
/**
 * WP-5.4 — 注意力清单视图渲染测试（jsdom; 同 tests/views-home 纪律:
 * 断言用户可见行为 — roles/text/回调, 绝不断言 CSS module 类名）。
 *
 * 覆盖（任务测试项: 视图渲染）:
 *  - 混排清单: 各对象类型（Intervention/Blocker/计划事件/下一步）同列
 *    渲染 + 类型徽标（中文）+ rank 序号 — 数据给什么渲染什么
 *    （INV-ATTN-1 展示面: 零过滤分支, 零分项恒渲染）;
 *  - 耗时标签展示（INV-ATTN-2 展示面）: `estimatedDurationMs` 渲染为
 *    「预计耗时 ≈ …」标签; 无耗时 = 无标签; 标签存在与否不改变行的
 *    顺序（顺序恒来自 data 的 rank — 组件从不重排）;
 *  - awareness 标签: SEEN/REVIEWED/ASSESSED 渲染, UNSEEN/无记录不渲染
 *    （默认态不占视觉 — INV-ATTN-4 展示面）;
 *  - why-now（reasons）逐行渲染;
 *  - 空队列 / 加载 / 首载失败 / 刷新失败（陈旧数据 + 错误条）各状态面;
 *  - 刷新回调;
 *  - formatDurationLabel 纯函数面（分钟/小时/天/零值）。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  AttentionListView,
  formatDurationLabel,
  type AttentionListViewProps,
} from '../../src/client/views/attention/AttentionListView'
import { AttentionView } from '../../src/client/views/attention/AttentionView'
import { createResearchStore } from '../../src/client/stores/index.js'
import { makeStubRpc, type StubRpc } from '../stores/stub-rpc.js'
import {
  ATTENTION_WEIGHTS,
  AttentionRankedItem,
  rankAttention,
  type AttentionItem,
} from '../../src/host/service/attention/scorer.js'
import {
  ATTENTION_DASHBOARD_FIXTURE,
  makeBlocker,
  makeContext,
  makeEvent,
  makeIntervention,
  makeNextAction,
  T_NOW,
} from './fixtures.js'

afterEach(cleanup)

/** 构造一个四类混排的排序 fixture（含耗时标签 + awareness 态）。 */
function makeRankingFixture(): readonly AttentionRankedItem[] {
  const items: AttentionItem[] = [
    makeIntervention({ id: 'IV-1', status: 'OPEN', origin: 'AUTO_FLOODING' }),
    makeIntervention({ id: 'IV-2', status: 'PENDING', title: 'PENDING 的审计差异', origin: 'AUTO_AUDIT', awarenessState: 'ASSESSED', estimatedDurationMs: 45 * 60 * 1000 }),
    makeBlocker({ id: 'BLK-1', awarenessState: 'SEEN' }),
    makeEvent({ id: 'SEV-1', estimatedDurationMs: 3 * 60 * 60 * 1000 }),
    makeNextAction({ id: 'NA-1' }),
  ]
  return rankAttention(items, makeContext()).items
}

function renderView(over: Partial<AttentionListViewProps> = {}) {
  const onRefresh = vi.fn()
  const utils = render(
    <AttentionListView
      data={{ generatedAt: T_NOW, weights: ATTENTION_WEIGHTS, items: makeRankingFixture() }}
      status="ready"
      error={null}
      onRefresh={onRefresh}
      {...over}
    />,
  )
  return { onRefresh, ...utils }
}

describe('混排清单 + 类型徽标（INV-ATTN-1 展示面）', () => {
  it('5 项全数渲染（无过滤/无折叠）+ 徽标中文 + rank 1..n', () => {
    renderView()
    // 标题 + 类型徽标:
    expect(screen.getByText('注意力清单')).toBeDefined()
    // 类型徽标（每种类型至少一个）:
    expect(screen.getAllByText('Intervention')).toHaveLength(2)
    expect(screen.getAllByText('Blocker')).toHaveLength(1)
    expect(screen.getAllByText('计划事件')).toHaveLength(1)
    expect(screen.getAllByText('下一步')).toHaveLength(1)
    // 每项标题可见:
    for (const title of ['审阅累积的 Agent PlanFork', 'PENDING 的审计差异', 'GPU 集群排队, 实验无法启动', '组会汇报', '考虑把数据清洗脚本化']) {
      expect(screen.getAllByText(title)).toHaveLength(1)
    }
    // rank 序号 1..5 全在:
    for (const n of ['1', '2', '3', '4', '5']) {
      expect(screen.getAllByText(n).length).toBeGreaterThanOrEqual(1)
    }
    // WS chip:
    expect(screen.getAllByText('WS-1').length).toBeGreaterThanOrEqual(3)
  })

  it('零分项恒渲染（视距外事件 — 只排序不隐藏的展示面证据）', () => {
    const items: AttentionItem[] = [
      makeIntervention(),
      makeEvent({ id: 'SEV-9', at: T_NOW + 30 * 24 * 60 * 60 * 1000, awarenessState: 'ASSESSED' }),
    ]
    const ranking = rankAttention(items, makeContext())
    expect(ranking.items.find((i) => i.id === 'SEV-9')!.score).toBe(0) // 分数 0（ASSESSED 无 gap）
    renderView({ data: ranking })
    // 分数 0 的事件仍在清单里, 且 why-now 说明「视距外」:
    expect(screen.getByText('组会汇报')).toBeDefined()
    expect(screen.getAllByText(/ScheduledEvent 在视距外/)).toHaveLength(1)
  })
})

describe('耗时标签（INV-ATTN-2 展示面: 只标签, 不重排）', () => {
  it('estimatedDurationMs 渲染为「预计耗时 ≈ …」; 无耗时 = 无标签', () => {
    renderView()
    // IV-2 45 分钟 + SEV-1 3 小时:
    expect(screen.getByText('预计耗时 ≈ 45 分钟')).toBeDefined()
    expect(screen.getByText('预计耗时 ≈ 3 小时')).toBeDefined()
    // 标签总数 = 2（其余三项无耗时字段）:
    expect(screen.getAllByText(/预计耗时/)).toHaveLength(2)
  })

  it('耗时标签存在与否不改变行序（顺序恒来自 data.rank）', () => {
    const withDur = makeRankingFixture()
    const withoutDur = withDur.map(({ estimatedDurationMs: _drop, ...rest }) => rest)
    const first = renderView({ data: { generatedAt: T_NOW, weights: ATTENTION_WEIGHTS, items: withDur } })
    const order1 = liTitles(first)
    cleanup()
    const second = renderView({ data: { generatedAt: T_NOW, weights: ATTENTION_WEIGHTS, items: withoutDur } })
    const order2 = liTitles(second)
    expect(order1).toEqual(order2)
  })
})

describe('awareness 标签 + why-now', () => {
  it('SEEN/ASSESSED 渲染状态标签; UNSEEN/无记录不渲染', () => {
    renderView()
    expect(screen.getByText('已见')).toBeDefined() // BLK-1 SEEN
    expect(screen.getByText('已评估')).toBeDefined() // IV-2 ASSESSED
    // UNSEEN（IV-1/SEV-1/NA-1）无标签:
    expect(screen.queryAllByText('尚未知悉')).toHaveLength(0)
  })

  it('why-now reasons 逐行渲染（含来源/状态/近度解释）', () => {
    renderView()
    expect(screen.getAllByText(/OPEN Intervention — 待人类负责/)).toHaveLength(1)
    expect(screen.getAllByText(/来源: AUTO_FLOODING/)).toHaveLength(1)
    expect(screen.getAllByText(/用户尚未知悉/).length).toBeGreaterThanOrEqual(1)
  })
})

describe('状态面', () => {
  it('空队列: 「暂无需要关注的事项」', () => {
    renderView({ data: rankAttention([], makeContext()) })
    expect(screen.getByText(/暂无需要关注的事项/)).toBeDefined()
  })

  it('loading（无缓存）: 「加载中…」', () => {
    renderView({ data: null, status: 'loading' })
    expect(screen.getByText('加载中…')).toBeDefined()
  })

  it('首载失败: 「加载失败」+ 重试按钮', () => {
    const { onRefresh } = renderView({ data: null, status: 'error', error: 'getDashboard: BIZ_FAULT' })
    expect(screen.getByRole('alert').textContent).toBe('加载失败：getDashboard: BIZ_FAULT')
    const retry = screen.getByRole('button', { name: '重试' })
    fireEvent.click(retry)
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('刷新失败（有缓存）: 错误条 + 陈旧清单保持可见', () => {
    const { onRefresh } = renderView({ status: 'error', error: 'refresh: TIMEOUT' })
    expect(screen.getByRole('alert').textContent).toBe('刷新失败：refresh: TIMEOUT')
    // 陈旧清单仍在:
    expect(screen.getAllByText('Intervention')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })
})

describe('formatDurationLabel（纯函数面）', () => {
  it('分钟/小时/天档 + 零值/负值/NaN 无标签', () => {
    expect(formatDurationLabel(45 * 60 * 1000)).toBe('预计耗时 ≈ 45 分钟')
    expect(formatDurationLabel(59 * 60 * 1000)).toBe('预计耗时 ≈ 59 分钟')
    expect(formatDurationLabel(60 * 60 * 1000)).toBe('预计耗时 ≈ 1 小时')
    expect(formatDurationLabel(3 * 60 * 60 * 1000)).toBe('预计耗时 ≈ 3 小时')
    expect(formatDurationLabel(48 * 60 * 60 * 1000)).toBe('预计耗时 ≈ 2 天')
    expect(formatDurationLabel(0)).toBeNull()
    expect(formatDurationLabel(-1)).toBeNull()
    expect(formatDurationLabel(Number.NaN)).toBeNull()
    expect(formatDurationLabel(null)).toBeNull()
    expect(formatDurationLabel(undefined)).toBeNull()
  })
})

/** 容器面（store 驱动）: 主 store dashboard 切片 → attention 切片 → 清单。
 *  同 tests/views-home/home-container.test.tsx 纪律: 真 createResearchStore
 *  + stub facade（`rpc` seam 注入）, 断言用户可见行为。 */
describe('AttentionView 容器（主 store 驱动）', () => {
  function renderContainer(rpc: StubRpc = makeStubRpc()) {
    rpc.set('getDashboard', { ok: true, value: ATTENTION_DASHBOARD_FIXTURE })
    const store = createResearchStore({ rpc: rpc.rpc })
    const utils = render(<AttentionView store={store} />)
    return { rpc, store, ...utils }
  }

  it('mount ⇒ lazy loadDashboard ⇒ 清单渲染 OPEN+PENDING 全集（INV-ATTN-1 client 端到端）', async () => {
    const { rpc } = renderContainer()
    await screen.findByText('注意力清单', {}, { timeout: 2000 })
    // 全集: 1 OPEN + 1 PENDING 都渲染:
    expect(await screen.findByText('审阅累积的 Agent PlanFork [WS-1]', {}, { timeout: 2000 })).toBeDefined()
    expect(screen.getByText('PENDING 的审计差异')).toBeDefined()
    expect(rpc.countOf('getDashboard')).toBe(1)
  })

  it('刷新按钮驱动 store.refresh（refetch dashboard ⇒ 切片重算）', async () => {
    const { rpc } = renderContainer()
    await screen.findByText('审阅累积的 Agent PlanFork [WS-1]', {}, { timeout: 2000 })
    expect(rpc.countOf('getDashboard')).toBe(1)

    // 刷新后 dashboard 多一条 PENDING Intervention ⇒ 清单多一行:
    rpc.set('getDashboard', {
      ok: true,
      value: {
        ...ATTENTION_DASHBOARD_FIXTURE,
        pendingInterventions: [
          ...ATTENTION_DASHBOARD_FIXTURE.pendingInterventions,
          {
            id: 'IV-3',
            title: '刷新后新增的审计差异',
            origin: 'AUTO_AUDIT',
            status: 'PENDING',
            workstreamIds: ['WS-1'],
            createdAt: T_NOW + 60 * 1000,
          },
        ],
      },
    })
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    expect(await screen.findByText('刷新后新增的审计差异', {}, { timeout: 2000 })).toBeDefined()
    expect(rpc.countOf('getDashboard')).toBe(2)
  })

  it('loading 面: dashboard 未落定前显示加载中', async () => {
    const rpc = makeStubRpc()
    rpc.set('getDashboard', new Promise<never>(() => undefined)) // 永不落定
    const store = createResearchStore({ rpc: rpc.rpc })
    render(<AttentionView store={store} />)
    expect(screen.getByText('加载中…')).toBeDefined()
  })

  it('首载失败 ⇒ 「加载失败」面（切片 error 传播）', async () => {
    const rpc = makeStubRpc()
    rpc.set('getDashboard', {
      ok: false,
      error: { code: 'NOT_READY', message: 'research service not ready', details: {} },
    })
    const store = createResearchStore({ rpc: rpc.rpc })
    render(<AttentionView store={store} />)
    expect(
      await screen.findByText('加载失败：NOT_READY: research service not ready', {}, { timeout: 2000 }),
    ).toBeDefined()
  })
})

/** 行级标题抓取（li 元素 → 行序断言用; 标题来自 fixture 的已知全集）。 */
const KNOWN_TITLES = [
  '审阅累积的 Agent PlanFork',
  'PENDING 的审计差异',
  'GPU 集群排队, 实验无法启动',
  '组会汇报',
  '考虑把数据清洗脚本化',
]

function liTitles(utils: { container: HTMLElement }): string[] {
  return [...utils.container.querySelectorAll('li')].map((li) => {
    const text = li.textContent ?? ''
    const hit = KNOWN_TITLES.find((t) => text.includes(t))
    if (hit === undefined) throw new Error(`no known title in li: ${text}`)
    return hit
  })
}
