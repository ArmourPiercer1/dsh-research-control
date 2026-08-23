/**
 * WP-4.3 — three-zone view tests: PURE zone components (data presentation
 * + plan order + reorder callback + empty states).
 *
 * Rendering face: the zones are PURE display components (no hooks), so
 * every test either
 *  ① renders them with `react-dom/server` (`renderToString`) and asserts
 *     USER-VISIBLE text (never class names), or
 *  ② calls them DIRECTLY and walks the element tree (the WP-4.3 harness)
 *     to invoke the reorder/history callbacks — DOM-free click
 *     simulation (no jsdom/@testing-library devDep — see report).
 *
 * Zone rules under test (ARCHITECTURE §3.1 / INV-TZ-2, plan §27.4):
 *  - Current: ACTIVE/PAUSED tasks + pending-review validations + runs
 *    (checkpoint = last heartbeat);
 *  - Future: canonical plan in EXACT plan position (position-by-position)
 *    + PF overlay data seam (WP-4.5 owns the visual style) + the minimal
 *    reorder entry (up/down, boundary-disabled);
 *  - History: log-size summary + timeline entry (the timeline itself is
 *    WP-4.4).
 */

import type { ReactElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { CurrentTaskDto, PlanItemDto, RunDto } from '../../src/shared/rpc-contracts.js'
import { CurrentZone, FutureZone, HistoryZone } from '../../src/client/views/workstream/index.js'
import { findByAriaLabel, findByHostText, hostElementText, invokeClick, ssrText } from './harness.js'

const T = 1_755_000_000_000

/** renderToString + SSR text-node separator normalization (see harness). */
function render(el: ReactElement): string {
  return ssrText(renderToString(el))
}

/* ==================================================================== *
 * CurrentZone
 * ==================================================================== */

const CURRENT_TASKS: readonly CurrentTaskDto[] = [
  {
    id: 'T-1',
    title: '设计实验方案',
    execution: 'ACTIVE',
    validation: 'PENDING',
    acceptanceCriteria: ['可复现的基线结果'],
    liveRunIds: ['R-1'],
  },
  {
    id: 'T-2',
    title: '撰写论文初稿',
    execution: 'PAUSED',
    validation: 'NOT_REQUIRED',
    acceptanceCriteria: [],
    liveRunIds: [],
  },
  {
    id: 'T-3',
    title: '数据清洗',
    execution: 'EXECUTED',
    validation: 'UNDER_REVIEW',
    acceptanceCriteria: [],
    liveRunIds: [],
  },
  {
    id: 'T-4',
    title: '规划中的后续任务',
    execution: 'PLANNED',
    validation: 'NOT_REQUIRED',
    acceptanceCriteria: [],
    liveRunIds: [],
  },
]

const CURRENT_RUNS: readonly RunDto[] = [
  {
    id: 'R-1',
    status: 'RUNNING',
    taskId: 'T-1',
    intent: '执行基线实验',
    startedAt: T,
    endedAt: null,
    lastCheckpointAt: T + 60_000,
    lastCheckpointNote: '半程检查点',
  },
  {
    id: 'R-2',
    status: 'FINISHED',
    taskId: 'T-3',
    intent: null,
    startedAt: T,
    endedAt: T + 5,
    lastCheckpointAt: null,
    lastCheckpointNote: null,
  },
]

describe('CurrentZone（当前执行）', () => {
  it('渲染活动任务、live Run、检查点与待 review 校验（§27.4 Current）', () => {
    const html = render(<CurrentZone tasks={CURRENT_TASKS} runs={CURRENT_RUNS} />)
    // zone + section headers, in §27.4 order
    expect(html).toContain('当前执行')
    expect(html.indexOf('活动任务')).toBeLessThan(html.indexOf('待 review 校验'))
    expect(html.indexOf('待 review 校验')).toBeLessThan(html.lastIndexOf('Run'))
    // active list: only ACTIVE/PAUSED tasks
    expect(html).toContain('设计实验方案')
    expect(html).toContain('进行中')
    expect(html).toContain('撰写论文初稿')
    expect(html).toContain('已暂停')
    // validation facet (PENDING on the active task) + acceptance criteria
    expect(html).toContain('待验证')
    expect(html).toContain('可复现的基线结果')
    // live Run join (§27.4 「live Run」)
    expect(html).toContain('实时 Run：R-1')
    // PLANNED task with no pending validation appears NOWHERE in this zone
    expect(html).not.toContain('规划中的后续任务')
    // pending-review section: EXECUTED task under review (same identity,
    // validation facet)
    expect(html).toContain('数据清洗')
    expect(html).toContain('审查中')
    // runs: status + task binding + intent + last checkpoint (heartbeat)
    expect(html).toContain('R-1')
    expect(html).toContain('运行中')
    expect(html).toContain('任务：T-1')
    expect(html).toContain('意图：执行基线实验')
    expect(html).toContain(`最近检查点：${new Date(T + 60_000).toISOString()}（半程检查点）`)
    // finished run without checkpoint
    expect(html).toContain('R-2')
    expect(html).toContain('已结束')
    expect(html).toContain('最近检查点：暂无')
  })

  it('空态：无活动任务 / 无待 review 校验 / 暂无 Run', () => {
    const html = render(
      <CurrentZone tasks={CURRENT_TASKS.slice(3)} runs={[]} />,
    )
    expect(html).toContain('无活动任务')
    expect(html).toContain('无待 review 校验')
    expect(html).toContain('暂无 Run')
    // no task/run identity leaked into the empty zone
    expect(html).not.toContain('T-4')
    expect(html).not.toContain('R-1')
  })
})

/* ==================================================================== *
 * FutureZone
 * ==================================================================== */

/** Plan deliberately OUT of id order — position must follow the plan,
 *  not the ids. */
const PLAN_ITEMS: readonly PlanItemDto[] = [
  { id: 'T-9', kind: 'TASK', title: '收尾：整理实验记录' },
  { id: 'G-1', kind: 'GATE', title: '数据完整性门' },
  { id: 'M-2', kind: 'MILESTONE', title: '中期里程碑' },
  { id: 'T-3', kind: 'TASK', title: '基线实验' },
]

describe('FutureZone（未来计划）', () => {
  it('按 plan 顺序逐位渲染 canonical G/T/M 列表（plan order = 用户意图）', () => {
    const html = render(
      <FutureZone
        planItems={PLAN_ITEMS}
        planForks={[]}
        unresolvedPlanForkCount={0}
        onMoveItem={() => undefined}
        reorderPending={false}
        reorderFault={null}
      />,
    )
    // position-by-position: the four titles appear strictly in plan order
    const titles = ['收尾：整理实验记录', '数据完整性门', '中期里程碑', '基线实验']
    let last = -1
    for (const title of titles) {
      const at = html.indexOf(title)
      expect(at, `title "${title}" must render in plan order`).toBeGreaterThan(last)
      last = at
    }
    // ids + kind labels ride their rows
    expect(html).toContain('T-9')
    expect(html).toContain('任务')
    expect(html).toContain('门')
    expect(html).toContain('里程碑')
  })

  it('上移/下移按钮触发 onMoveItem(itemId, direction) 回调', () => {
    const onMoveItem = vi.fn()
    const tree = FutureZone({
      planItems: PLAN_ITEMS,
      planForks: [],
      unresolvedPlanForkCount: 0,
      onMoveItem,
      reorderPending: false,
      reorderFault: null,
    })
    // every row carries exactly one up + one down button
    for (const item of PLAN_ITEMS) {
      expect(findByAriaLabel(tree, `上移：${item.id}`).length).toBe(1)
      expect(findByAriaLabel(tree, `下移：${item.id}`).length).toBe(1)
    }
    // middle item, both directions
    invokeClick(findByAriaLabel(tree, '上移：G-1')[0]!)
    expect(onMoveItem).toHaveBeenCalledWith('G-1', 'up')
    invokeClick(findByAriaLabel(tree, '下移：M-2')[0]!)
    expect(onMoveItem).toHaveBeenCalledWith('M-2', 'down')
    expect(onMoveItem).toHaveBeenCalledTimes(2)
  })

  it('边界按钮禁用：首项不可上移、末项不可下移', () => {
    const tree = FutureZone({
      planItems: PLAN_ITEMS,
      planForks: [],
      unresolvedPlanForkCount: 0,
      onMoveItem: () => undefined,
      reorderPending: false,
      reorderFault: null,
    })
    expect(findByAriaLabel(tree, '上移：T-9')[0]!.props.disabled).toBe(true)
    expect(findByAriaLabel(tree, '下移：T-3')[0]!.props.disabled).toBe(true)
    // interior items stay enabled in both directions
    expect(findByAriaLabel(tree, '上移：G-1')[0]!.props.disabled).toBe(false)
    expect(findByAriaLabel(tree, '下移：G-1')[0]!.props.disabled).toBe(false)
  })

  it('PF overlay 数据缝：渲染未决 PlanFork 计数与数据行（视觉区分归 WP-4.5）', () => {
    const planForks = [
      {
        id: 'PF-1',
        status: 'OPEN' as const,
        reason: '计划缺少基线实验',
        necessity: '目标依赖基线结果',
        forkAnchor: 'T-3',
        mergeAnchor: 'T-9',
        createdByRun: 'R-2',
        createdAt: T,
        staleReason: null,
        proposedItemCount: 2,
        baseGitCommit: null,
      },
      {
        id: 'PF-2',
        status: 'STALE' as const,
        reason: '计划已变化，提案过期',
        necessity: '原基线依赖已移除',
        forkAnchor: 'T-3',
        mergeAnchor: 'T-3',
        createdByRun: 'R-1',
        createdAt: T - 1000,
        staleReason: '计划重排',
        proposedItemCount: 1,
        baseGitCommit: null,
      },
    ]
    const html = render(
      <FutureZone
        planItems={PLAN_ITEMS}
        planForks={planForks}
        unresolvedPlanForkCount={2}
        onMoveItem={() => undefined}
        reorderPending={false}
        reorderFault={null}
      />,
    )
    expect(html).toContain('未决 PlanFork')
    expect(html).toContain('未决 PlanFork：2')
    expect(html).toContain('PF-1')
    expect(html).toContain('待处理')
    expect(html).toContain('PF-2')
    expect(html).toContain('已陈旧')
    expect(html).toContain('计划缺少基线实验')
    expect(html).toContain('提案 2 项')
    expect(html).toContain('锚点 T-3 → T-9')
  })

  it('空态：计划为空 / 暂无未决 PlanFork；reorder 提示行', () => {
    const html = render(
      <FutureZone
        planItems={[]}
        planForks={[]}
        unresolvedPlanForkCount={0}
        onMoveItem={() => undefined}
        reorderPending={false}
        reorderFault={null}
      />,
    )
    expect(html).toContain('计划为空')
    expect(html).toContain('暂无未决 PlanFork')
    expect(html).not.toContain('排序保存中')
    expect(html).not.toContain('排序失败')

    const busy = render(
      <FutureZone
        planItems={PLAN_ITEMS}
        planForks={[]}
        unresolvedPlanForkCount={0}
        onMoveItem={() => undefined}
        reorderPending={true}
        reorderFault={null}
      />,
    )
    expect(busy).toContain('排序保存中…')

    const failed = render(
      <FutureZone
        planItems={PLAN_ITEMS}
        planForks={[]}
        unresolvedPlanForkCount={0}
        onMoveItem={() => undefined}
        reorderPending={false}
        reorderFault='计划已被其他操作修改'
      />,
    )
    expect(failed).toContain('排序失败：计划已被其他操作修改')
  })
})

/* ==================================================================== *
 * HistoryZone
 * ==================================================================== */

describe('HistoryZone（历史入口）', () => {
  it('渲染 WS 级事件摘要入口（eventCount + 时间线入口）', () => {
    const html = render(<HistoryZone eventCount={12} onOpenHistory={() => undefined} />)
    expect(html).toContain('历史')
    expect(html).toContain('历史事件：12 条')
    expect(html).toContain('查看事件时间线')
  })

  it('点击入口按钮触发 onOpenHistory 回调', () => {
    const onOpenHistory = vi.fn()
    const tree = HistoryZone({ eventCount: 12, onOpenHistory })
    const entry = findByHostText(tree, '查看事件时间线')
    expect(entry.length).toBe(1)
    expect(hostElementText(entry[0]!)).toBe('查看事件时间线')
    invokeClick(entry[0]!)
    expect(onOpenHistory).toHaveBeenCalledTimes(1)
  })

  it('空态：事件数为 0 时无入口按钮', () => {
    const html = render(<HistoryZone eventCount={0} onOpenHistory={() => undefined} />)
    expect(html).toContain('暂无历史事件')
    expect(html).not.toContain('查看事件时间线')
  })
})
