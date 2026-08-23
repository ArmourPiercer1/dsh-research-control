// @vitest-environment jsdom
/**
 * WP-5.5 — Brief 面板渲染/交互测试（jsdom; 同 tests/attention 视图纪律:
 * 断言用户可见行为 — roles/text/回调, 绝不断言 CSS module 类名）。
 *
 * 覆盖（任务测试项「视图三级交互渲染」）:
 *  - L1 常驻（一句话态势 + 其 ref chips — 无展开交互即渲染）;
 *  - L2 展开交互（默认折叠 ⇒ 点击展开 ⇒ 八类要点全渲染（零隐藏）⇒
 *    再点收起; 要点状态徽标「数据/暂无数据」; DATA 要点带 ref chips,
 *    占位要点无 chips）;
 *  - 每条可点开 ref 详情（drilldown 跳转模式复用: ref chip 点击 ⇒
 *    详情区渲染 drill-down 坐标（OBJECT: kind+id / HISTORY_EVENT:
 *    ws+seq+eventId）⇒「打开详情」按钮交 onOpenRef 回调（渠道归容器）
 *    ⇒ 关闭 ⇒ onSelectRef(null)）;
 *  - L3 展开交互（默认折叠 ⇒ 展开 = 13 行数据底座表; audit/inbox 恒
 *    「待开通」; AVAILABLE 行计数渲染）;
 *  - 状态面（loading / 首载失败 + 重试 / 刷新失败陈旧面 + 错误条）;
 *  - dataPlaneNote 渲染（client 投影诚实边界文案）;
 *  - refLabel 纯函数面。
 */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { projectBrief } from '../../src/host/service/brief/project.js'
import type { LivingBrief } from '../../src/host/service/brief/types.js'
import { BRIEF_PLANE_COUNT, BriefPanelView, refLabel, type BriefPanelViewProps } from '../../src/client/views/brief/brief-panel'
import { makeFullInputs, T_NOW } from '../brief/fixtures.js'

afterEach(cleanup)

/** 面板默认 props（全数据 Brief + 成功回调 spy）。 */
function makeProps(over: Partial<BriefPanelViewProps> = {}): BriefPanelViewProps {
  const brief: LivingBrief = projectBrief(makeFullInputs(), T_NOW)
  return {
    brief,
    status: 'ready',
    error: null,
    onRefresh: vi.fn(),
    onRetry: vi.fn(),
    dataPlaneNote: null,
    onOpenRef: vi.fn(),
    ...over,
  }
}

function renderPanel(over: Partial<BriefPanelViewProps> = {}) {
  const props = makeProps(over)
  const utils = render(<BriefPanelView {...props} />)
  return { props, ...utils }
}

/** 点开 L2（默认折叠）。 */
function openL2() {
  fireEvent.click(screen.getByRole('button', { name: /L2 · 要点列表/ }))
}

/** 点开 L3（默认折叠）。 */
function openL3() {
  fireEvent.click(screen.getByRole('button', { name: /L3 · 完整数据底座引用表/ }))
}

describe('L1 一句话态势（常驻）', () => {
  it('L1 无展开交互即渲染: 陈述 + 项目/Top 项 ref chips', () => {
    renderPanel()
    expect(screen.getByText('L1 · 一句话态势')).toBeDefined()
    expect(
      screen.getByText('《Project One》：2 个活跃目标；干预 1 OPEN / 1 PENDING；1 项阻碍未解除；1 项建议待决；3 项临近/待汇报；最近 CLAIM_RECORDED（WS-1）'),
    ).toBeDefined()
    // ref chips: 项目 + 注意力 Top 2（L1 refs 全集）:
    expect(screen.getByRole('button', { name: 'PROJECT:PRJ-1' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'INTERVENTION:IV-1' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'BLOCKER:BLK-1' })).toBeDefined()
  })
})

describe('L2 要点列表（展开交互 — 零隐藏）', () => {
  it('默认折叠（要点陈述不可见）; 点击展开 ⇒ 全量渲染; 再点收起', () => {
    const { container } = renderPanel()
    expect(screen.queryByText('暂无最近事件（History 摘要为空集）')).toBeNull()
    // 全数据 Brief 的 RECENT 要点陈述:
    expect(screen.queryByText(/最近：INTERVENTION_CREATED/)).toBeNull()

    openL2()
    // 八类要点全渲染（零过滤/零折叠 — 数据给什么渲染什么）:
    expect(screen.getByText(/目标 OBJ-2（P0, 项目级）/)).toBeDefined()
    expect(screen.getByText(/最近：CLAIM_RECORDED（WS-1, 事件 H-3, seq 3）/)).toBeDefined()
    expect(screen.getByText(/注意力 #1：审阅累积的 Agent PlanFork/)).toBeDefined()
    expect(screen.getByText(/WS-1 计划下一步：TASK 数据清洗脚本化/)).toBeDefined()
    expect(screen.getByText('2 项人工干预待处理（OPEN 1 / PENDING 1）')).toBeDefined()
    expect(screen.getByText(/阻碍 BLK-1：GPU 集群排队/)).toBeDefined()
    expect(screen.getByText(/计划事件 SEV-0：已过期评审（已到期）/)).toBeDefined()
    expect(screen.getByText(/下一步建议 NA-1：考虑把数据清洗脚本化/)).toBeDefined()

    // 要点计数 = L2 点数:
    const toggle = screen.getByRole('button', { name: /L2 · 要点列表/ })
    expect(toggle.textContent).toContain('条')
    const count = Number((toggle.textContent?.match(/（(\d+) 条）/) ?? [])[1])
    expect(count).toBe((container.querySelectorAll('[data-point-id]') as NodeListOf<HTMLElement>).length)

    // 再点收起:
    fireEvent.click(toggle)
    expect(screen.queryByText(/目标 OBJ-2（P0, 项目级）/)).toBeNull()
  })

  it('要点状态徽标: DATA = 「数据」; PLACEHOLDER = 「暂无数据」; 占位要点无 ref chips', () => {
    renderPanel({
      brief: projectBrief(
        { ...makeFullInputs(), interventions: [], objectives: [], history: [], blockers: [], scheduledEvents: [], reportingItems: [], nextActions: [], interactions: [], futurePlans: [] },
        T_NOW,
      ),
    })
    openL2()
    // 空面要点 = 占位徽标「暂无数据」+ 陈述含「暂无」:
    const ivPoint = (document.querySelector('[data-point-category="INTERVENTION"]') as HTMLElement)
    expect(within(ivPoint).getByText('暂无数据')).toBeDefined()
    expect(ivPoint.querySelectorAll('[data-ref-kind]').length).toBe(0)
    // 有数据的 IN_FLIGHT 要点（注意力队列仍有 2 项）= 「数据」徽标 + chips:
    const inflight = (document.querySelector('[data-point-category="IN_FLIGHT"]') as HTMLElement)
    expect(within(inflight).getByText('数据')).toBeDefined()
    expect(inflight.querySelectorAll('[data-ref-kind]').length).toBeGreaterThanOrEqual(1)
  })
})

describe('ref 详情（drilldown 跳转模式复用 — 选中态面板自持, 渠道归容器）', () => {
  it('OBJECT ref chip 点击 ⇒ 详情区渲染 kind+id; 「打开详情」交 onOpenRef; 关闭 ⇒ 详情消失', () => {
    const { props } = renderPanel()
    // L1 的项目 ref chip:
    fireEvent.click(screen.getByRole('button', { name: 'PROJECT:PRJ-1' }))
    // 详情区（drill-down 坐标）:
    const detail = screen.getByRole('region', { name: 'ref 详情' })
    expect(within(detail).getByText('对象种类')).toBeDefined()
    expect(within(detail).getByText('PROJECT')).toBeDefined()
    expect(within(detail).getByText('对象 id')).toBeDefined()
    expect(within(detail).getByText('PRJ-1')).toBeDefined()
    // 跳转按钮（WP-4.6 模式: 展示层交 ref, 渠道在容器）:
    fireEvent.click(within(detail).getByRole('button', { name: '打开详情 ↗' }))
    expect(props.onOpenRef).toHaveBeenCalledTimes(1)
    expect(props.onOpenRef).toHaveBeenCalledWith({ kind: 'OBJECT', objectKind: 'PROJECT', id: 'PRJ-1' })
    // 关闭（本地选中态回落 — 自包含交互）:
    fireEvent.click(within(detail).getByRole('button', { name: '关闭' }))
    expect(screen.queryByRole('region', { name: 'ref 详情' })).toBeNull()
    // 再点开 ⇒ 详情重现（选中态可重复触发）:
    fireEvent.click(screen.getByRole('button', { name: 'PROJECT:PRJ-1' }))
    expect(screen.getByRole('region', { name: 'ref 详情' })).toBeDefined()
  })

  it('HISTORY_EVENT ref chip 点击 ⇒ 详情区渲染 ws + seq + eventId（History 时间线入口坐标）', () => {
    renderPanel()
    openL2()
    // RECENT 要点的第一个 chip = 最新事件 H-3 (WS-1, seq 3):
    const recent = (document.querySelector('[data-point-category="RECENT"]') as HTMLElement)
    const chip = within(recent).getByRole('button', { name: 'WS-1·seq3' })
    fireEvent.click(chip)
    const detail = screen.getByRole('region', { name: 'ref 详情' })
    expect(within(detail).getByText('Workstream')).toBeDefined()
    expect(within(detail).getByText('WS-1')).toBeDefined()
    expect(within(detail).getByText('事件 seq')).toBeDefined()
    expect(within(detail).getByText('3')).toBeDefined()
    expect(within(detail).getByText('事件 id')).toBeDefined()
    expect(within(detail).getByText('H-3')).toBeDefined()
  })
})

describe('L3 完整数据底座引用表（展开交互）', () => {
  it('默认折叠; 展开 ⇒ 13 行全渲染（逐面落行 — 不隐藏）', () => {
    const { container } = renderPanel()
    expect(container.querySelectorAll('table').length).toBe(0)
    openL3()
    const rows = container.querySelectorAll('tbody tr[data-plane]')
    expect(rows.length).toBe(13)
    expect(rows.length).toBe(BRIEF_PLANE_COUNT)
  })

  it('audit/inbox 行 = 「待开通」+ Phase 6 注记（缺口不虚构）', () => {
    const { container } = renderPanel()
    openL3()
    const audit = (container.querySelector('tr[data-plane="audit"]') as HTMLElement)
    expect(audit.querySelector('td[data-plane-status]')!.textContent).toBe('待开通')
    expect(audit.textContent).toContain('待开通（Phase 6 审计面 — 未交付）')
    const inbox = (container.querySelector('tr[data-plane="inbox"]') as HTMLElement)
    expect(inbox.querySelector('td[data-plane-status]')!.textContent).toBe('待开通')
    expect(inbox.textContent).toContain('wire `inboxCount` 为冻结 null 占位')
  })

  it('AVAILABLE 行渲染计数 + ref chips（L3 引用表 = drill-down 直达入口）', () => {
    const { container } = renderPanel()
    openL3()
    const ivRow = (container.querySelector('tr[data-plane="interventions"]') as HTMLElement)
    expect(ivRow.querySelector('td[data-plane-status]')!.textContent).toBe('有数据')
    expect(ivRow.textContent).toContain('2')
    // chips 可点开详情（同 L2 口径）:
    expect(within(ivRow).getByRole('button', { name: 'INTERVENTION:IV-1' })).toBeDefined()
  })
})

describe('状态面', () => {
  it('loading（无缓存）⇒ 「加载中…」', () => {
    renderPanel({ brief: null, status: 'loading', error: null })
    // role=status 是 live region（accname 无 name-from-content）— 查角色 + 文本:
    const loading = screen.getByRole('status')
    expect(loading.textContent).toBe('加载中…')
  })

  it('error（无缓存）⇒ 「加载失败」+ 重试回调', () => {
    const { props } = renderPanel({ brief: null, status: 'error', error: 'NOT_READY: boom' })
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('加载失败：NOT_READY: boom')
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(props.onRetry).toHaveBeenCalledTimes(1)
  })

  it('error（有缓存）⇒ 陈旧 brief 仍渲染 + 刷新失败错误条（stale-while-revalidate 展示面）', () => {
    const { props } = renderPanel({ status: 'error', error: 'refresh failed' })
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('刷新失败：refresh failed')
    expect(alert.textContent).toContain('陈旧投影')
    // 陈旧 L1 仍可见:
    expect(screen.getByText(/《Project One》：/)).toBeDefined()
    // 刷新按钮可用:
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    expect(props.onRefresh).toHaveBeenCalledTimes(1)
  })

  it('dataPlaneNote 渲染（client 投影诚实边界文案）', () => {
    renderPanel({ dataPlaneNote: '本视图为 client 侧投影：…（测试注记）' })
    expect(screen.getByText(/本视图为 client 侧投影：…（测试注记）/)).toBeDefined()
  })
})

describe('refLabel 纯函数', () => {
  it('OBJECT ⇒ 「KIND:id」; HISTORY_EVENT ⇒ 「ws·seqN」', () => {
    expect(refLabel({ kind: 'OBJECT', objectKind: 'INTERVENTION', id: 'IV-1' })).toBe('INTERVENTION:IV-1')
    expect(refLabel({ kind: 'HISTORY_EVENT', workstreamId: 'WS-2', eventSeq: 42, eventId: 'H-42' })).toBe('WS-2·seq42')
  })
})
