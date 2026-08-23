/**
 * WP-5.3 — reporting 视图渲染 (jsdom + testing-library):
 *  - 三视图渲染 (Interaction 记录流 / RPT 周报清单 / SEV 日程时间轴)
 *    走真实数据路径: 容器 ← createReportingWorkspace() 工厂 + 主 store
 *    的 registerInteraction mutation 面 (测试注入最小结构门面);
 *  - Interaction 登记闭环: 表单提交 → store.registerInteraction 收到
 *    规范化 args → resolve 后记录流出现该行 (id + kind 徽标 + 参与人);
 *    业务故障 → 错误条, 记录流不变;
 *  - RPT 清单: 新增 → 待启动分组; 迁移按钮只渲染 §13 合法边;
 *    点击迁移 → 分组迁移 + reportedAt 共现; 周报 = 近 7 天窗口过滤
 *    (旧 createdAt 条目不入窗) + 全量状态计数;
 *  - SEV 时间轴: 窗口档位过滤 (30 天窗口排除过去 ONCE; 「全部」含);
 *    RECURRING 行 = 节奏标签 (无锚点 ⇒ 不伪造具体 tick);
 *  - 边界文案: 「不接外部 Calendar」在时间轴可见 (V1 语义注记)。
 *
 * 断言目标 = 用户可见文本/角色/顺序 — 永不断言 class 名。
 * `afterEach(cleanup)` 显式 (repo vitest 无 globals:true)。
 */

// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { ResearchStore } from '../../src/client/stores/index.js'
import {
  createReportingWorkspace,
  type ReportingWorkspace,
} from '../../src/client/stores/reporting-slices.js'
import type { RegisterInteractionArgs, RegisterInteractionResult } from '../../src/shared/rpc-contracts.js'
import {
  InteractionStreamView,
  ReportingListView,
  ReportingView,
  ScheduledEventTimeline,
} from '../../src/client/views/reporting/index.js'

const DAY = 86_400_000
const NOW = Date.parse('2026-08-22T09:00:00Z')
const fixedNow = () => NOW

afterEach(cleanup)

/** 最小结构门面: 只实现 registerInteraction (容器仅消费此面)。 */
function makeStubStore(results?: { result?: RegisterInteractionResult; error?: Error }) {
  const calls: RegisterInteractionArgs[] = []
  const facade = {
    calls,
    registerInteraction: async (args: RegisterInteractionArgs): Promise<RegisterInteractionResult> => {
      calls.push(args)
      if (results?.error !== undefined) throw results.error
      return (
        results?.result ?? {
          id: 'INT-1',
          kind: args.kind,
          title: args.title,
          occurredAt: args.occurredAt,
          participants: [...(args.participants ?? [])],
          notes: args.notes ?? null,
          relatedWorkstreams: [...(args.relatedWorkstreams ?? [])],
          createdAt: NOW + 1,
        }
      )
    },
  }
  return facade as unknown as ResearchStore & { calls: RegisterInteractionArgs[] }
}

/* ==================================================================== *
 * Interaction 记录流 (生产 RPC 登记闭环)
 * ==================================================================== */

describe('InteractionStreamView — 登记闭环', () => {
  it('submits the form → registerInteraction 收到规范化 args → 记录流行出现', async () => {
    const workspace = createReportingWorkspace({ now: fixedNow })
    const store = makeStubStore()
    render(<InteractionStreamView workspace={workspace} store={store} now={fixedNow} />)

    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '周会' } })
    fireEvent.change(screen.getByLabelText('参与人（逗号分隔）'), { target: { value: '张三, 李四' } })
    fireEvent.change(screen.getByLabelText('关联 Workstream（逗号分隔）'), { target: { value: 'WS-1, WS-2' } })
    fireEvent.click(screen.getByRole('button', { name: '登记 Interaction' }))

    await waitFor(() => expect(store.calls).toHaveLength(1))
    expect(store.calls[0]).toEqual({
      kind: 'MEETING',
      title: '周会',
      occurredAt: NOW, // 表单默认 = 注入时钟
      participants: ['张三', '李四'],
      relatedWorkstreams: ['WS-1', 'WS-2'],
    })
    expect(await screen.findByText('INT-1')).toBeDefined()
    expect(screen.getByText('会议', { selector: 'span[data-kind]' })).toBeDefined() // kind 徽标 (中文; 排除表单 option)
    expect(screen.getByText('张三')).toBeDefined()
    expect(screen.getByText('WS-2')).toBeDefined()
    expect(screen.getByText(/已登记 INT-1/)).toBeDefined() // 成功回执
  })

  it('empty title is rejected client-side (no RPC call)', async () => {
    const workspace = createReportingWorkspace({ now: fixedNow })
    const store = makeStubStore()
    render(<InteractionStreamView workspace={workspace} store={store} now={fixedNow} />)
    fireEvent.click(screen.getByRole('button', { name: '登记 Interaction' }))
    expect(store.calls).toHaveLength(0)
    expect(screen.getByText('请填写 Interaction 标题')).toBeDefined()
  })

  it('business fault → 错误条 + 记录流不变', async () => {
    const workspace = createReportingWorkspace({ now: fixedNow })
    const faulty = makeStubStore({ error: new Error('registerInteraction: related workstream WS-99 does not exist') })
    render(<InteractionStreamView workspace={workspace} store={faulty} now={fixedNow} />)
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '坏引用' } })
    fireEvent.click(screen.getByRole('button', { name: '登记 Interaction' }))
    expect(await screen.findByText(/登记失败：registerInteraction: related workstream WS-99 does not exist/)).toBeDefined()
    expect(workspace.getSnapshot().interactions).toHaveLength(0)
  })
})

/* ==================================================================== *
 * ReportingItem 周报/清单
 * ==================================================================== */

describe('ReportingListView — 清单 + 周报 + §13 迁移按钮面', () => {
  it('adds an item (待启动分组) and walks it through legal transitions only', () => {
    const workspace = createReportingWorkspace({ now: fixedNow })
    render(<ReportingListView workspace={workspace} now={fixedNow} />)

    fireEvent.change(screen.getByLabelText('面向（audience）'), { target: { value: '导师' } })
    fireEvent.change(screen.getByLabelText('汇报什么（statement）'), { target: { value: '本周进展' } })
    fireEvent.click(screen.getByRole('button', { name: '新增汇报项' }))

    expect(screen.getByText('待启动（1）')).toBeDefined()
    expect(screen.getByText('面向 导师')).toBeDefined()
    expect(screen.getByText('本周进展')).toBeDefined()

    // OPEN 的唯一合法边 = 「材料准备完成」(§13 — 按钮面单一真源)。
    expect(screen.getByRole('button', { name: '材料准备完成' })).toBeDefined()
    expect(screen.queryByRole('button', { name: '已完成汇报' })).toBeNull() // 非法边不渲染

    fireEvent.click(screen.getByRole('button', { name: '材料准备完成' }))
    expect(screen.getByText('材料就绪（1）')).toBeDefined()
    // MATERIAL_READY 的合法边 = 待汇报 + 回退待启动。
    expect(screen.getByRole('button', { name: '标记可汇报' })).toBeDefined()
    expect(screen.getByRole('button', { name: '标记为待启动' })).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: '标记可汇报' }))
    fireEvent.click(screen.getByRole('button', { name: '已完成汇报' }))
    expect(screen.getByText('已汇报（1）')).toBeDefined()
    expect(workspace.getSnapshot().reportingItems[0]!.reportedAt).toBe(NOW)
  })

  it('周报 tab: 近 7 天窗口过滤 (旧 createdAt 条目不入窗) + 全量状态计数', () => {
    // 可变时钟: 先造一条 30 天前的草稿, 再回到 NOW 造一条本周草稿。
    let t = NOW - 30 * DAY
    const workspace = createReportingWorkspace({ now: () => t })
    workspace.addReportingItem({ audience: '期刊', statement: '上月投稿' })
    t = NOW
    workspace.addReportingItem({ audience: '导师', statement: '本周进展' })

    render(<ReportingListView workspace={workspace} now={fixedNow} />)
    fireEvent.click(screen.getByRole('button', { name: '周报（近 7 天）' }))
    // 全量计数 (两条都在): 待启动 2。
    expect(screen.getByText('待启动 2')).toBeDefined()
    expect(screen.getByText('已汇报 0')).toBeDefined()
    // 7 天窗口: 只含本周条目。
    expect(screen.getByText('本周进展')).toBeDefined()
    expect(screen.queryByText('上月投稿')).toBeNull()
  })
})

/* ==================================================================== *
 * ScheduledEvent 日程时间轴 (V1 时间窗 + 边界文案)
 * ==================================================================== */

describe('ScheduledEventTimeline — 窗口过滤 + V1 语义', () => {
  it('past ONCE is out of the 30-day window but in 「全部」', () => {
    const workspace = createReportingWorkspace({ now: fixedNow })
    workspace.addScheduledEvent({ title: '过去的会', schedule: { kind: 'ONCE', at: NOW - 10 * DAY } })
    workspace.addScheduledEvent({ title: '明天的会', schedule: { kind: 'ONCE', at: NOW + DAY }, reminderLeadMs: 3_600_000 })
    render(<ScheduledEventTimeline workspace={workspace} now={fixedNow} />)

    expect(screen.queryByText('过去的会')).toBeNull() // 30 天窗口默认档
    expect(screen.getByText('明天的会')).toBeDefined()
    expect(screen.getByText('一次性', { selector: 'span[data-event-kind="ONCE"]' })).toBeDefined() // 排除表单 option
    expect(screen.getByText(/提醒点 .*（展示用 · 无推送）/)).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: '全部' }))
    expect(screen.getByText('过去的会')).toBeDefined()
    expect(screen.getByText('明天的会')).toBeDefined()
  })

  it('RECURRING rows show the 节奏 label + until boundary (无锚点 ⇒ 不伪造 tick)', () => {
    const workspace = createReportingWorkspace({ now: fixedNow })
    workspace.addScheduledEvent({ title: '每周组会', schedule: { kind: 'RECURRING', freq: 'WEEKLY' } })
    workspace.addScheduledEvent({ title: '双月评审', schedule: { kind: 'RECURRING', freq: 'MONTHLY', interval: 2, until: NOW + 60 * DAY } })
    render(<ScheduledEventTimeline workspace={workspace} now={fixedNow} />)
    expect(screen.getByText('每周组会')).toBeDefined()
    expect(screen.getByText('双月评审')).toBeDefined()
    expect(screen.getByText('每周（持续中）', { selector: 'span[data-event-kind="RECURRING"]' })).toBeDefined()
    expect(screen.getByText(/每 2 个月（至 .+）/)).toBeDefined()
  })

  it('the boundary banner is visible: 不接外部 Calendar + 无调度器/提醒推送', () => {
    const workspace = createReportingWorkspace({ now: fixedNow })
    render(<ScheduledEventTimeline workspace={workspace} now={fixedNow} />)
    expect(screen.getByText(/仅管理用户登记的事件 — 不接外部 Calendar/)).toBeDefined()
    expect(screen.getByText(/无调度器\/提醒推送（到期 = 查询面时间窗过滤）/)).toBeDefined()
  })
})

/* ==================================================================== *
 * 顶层组合 (ReportingView)
 * ==================================================================== */

describe('ReportingView — 三节组合', () => {
  it('renders all three sections + the 沟通与日程 header', () => {
    const store = makeStubStore()
    render(<ReportingView store={store} now={fixedNow} />)
    expect(screen.getByText('沟通与日程')).toBeDefined()
    expect(screen.getByText('Interaction 记录流')).toBeDefined()
    expect(screen.getByText('汇报清单（ReportingItem）')).toBeDefined()
    expect(screen.getByText('日程（ScheduledEvent）')).toBeDefined()
    // 空态文案 (无伪造数据)。
    expect(screen.getByText(/暂无登记的 Interaction/)).toBeDefined()
    expect(screen.getByText(/暂无汇报项/)).toBeDefined()
    expect(screen.getByText(/该时间窗内没有日程/)).toBeDefined()
  })
})
