// @vitest-environment jsdom
/**
 * WP-5.2 — 注意力三对象展示层（纯 props 组件 — 零 hook）:
 *
 *  - BlockerSection: ACTIVE 显著卡（statement/阻碍对象 chip/来源 + 清除
 *    按钮 — 无接线时禁用）; CLEARED 折叠; 空态「无活跃阻碍」; 错误切片
 *    role=alert（stale-while-revalidate 附注「显示上次成功数据」）;
 *  - ObjectiveProgress: 计数摘要「N 个目标：…」、逐行状态徽标/优先级/
 *    目标日期/待转正提案数、空态;
 *  - NextActionsSection: 按 objective 分组（组头 statement + 项目级/主题级
 *    chip + 优先级）; PROPOSED 行 转正/弃用 按钮（回调上抛）; PROMOTED 行
 *    「已转正为 T-n」; DISMISSED 行 muted; 「未关联目标」组; 空态。
 *
 * 中文文案面 + data-* 钩子（e2e 断言稳定 — 无 hash 命名空间纪律）。
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { ObjectiveDto } from '../../src/shared/rpc-contracts.js'
import type { BlockerItem, NextActionItem } from '../../src/client/stores/actions-slices.js'
import type { SliceState } from '../../src/client/stores/model.js'
import {
  splitBlockers,
  type NextActionGroup,
} from '../../src/client/views/actions/actions-model.js'
import {
  BlockerSection,
  NextActionsSection,
  ObjectiveProgress,
} from '../../src/client/views/actions/actions-view.js'

afterEach(cleanup)

function ready<T>(data: T): SliceState<T> {
  return { status: 'ready', data, error: null, updatedAt: 1 }
}
function errorSlice<T>(data: T | null, error: string): SliceState<T> {
  return { status: 'error', data, error, updatedAt: 1 }
}

const OBJ1: ObjectiveDto = { id: 'OBJ-1', scope: 'PROJECT', statement: '项目级目标', status: 'ACTIVE', priority: 'P1', targetDate: null }
const OBJ2: ObjectiveDto = { id: 'OBJ-2', scope: 'TOPIC', statement: '主题级目标', status: 'ACTIVE', priority: 'P0', targetDate: null }

const NA: NextActionItem[] = [
  { id: 'NA-1', workstreamId: 'WS-1', statement: '先跑基线', rationale: '数据不足', status: 'PROPOSED', promotedToTaskId: null, createdAt: 1 },
  { id: 'NA-2', workstreamId: 'WS-1', statement: '对比方案', rationale: null, status: 'PROMOTED', promotedToTaskId: 'T-5', createdAt: 2 },
  { id: 'NA-3', workstreamId: null, statement: '悬空提案', rationale: null, status: 'DISMISSED', promotedToTaskId: null, createdAt: 3 },
]
const BLK: BlockerItem[] = [
  { id: 'BLK-1', statement: 'GPU 队列满', affects: [{ kind: 'WORKSTREAM', id: 'WS-1' }, { kind: 'RUN', id: 'R-1' }], status: 'ACTIVE', source: '用户报告', references: null, createdAt: 1, clearedAt: null },
  { id: 'BLK-2', statement: '已清的阻碍', affects: [{ kind: 'TASK', id: 'T-1' }], status: 'CLEARED', source: '审计', references: null, createdAt: 2, clearedAt: 9 },
]

function makeGroups(): NextActionGroup[] {
  return [
    {
      objective: OBJ2,
      items: NA.filter((n) => n.workstreamId === 'WS-1'),
      proposedCount: 1,
    },
    {
      objective: null,
      items: NA.filter((n) => n.workstreamId === null),
      proposedCount: 0,
    },
  ]
}

describe('BlockerSection（显著区）', () => {
  it('ACTIVE 卡: statement + 阻碍对象 chips + 来源 + 清除按钮', () => {
    render(<BlockerSection slice={ready({ items: BLK })} sections={splitBlockers(BLK)} />)
    expect(screen.getByText('GPU 队列满')).toBeTruthy()
    expect(screen.getByText('活跃', { selector: 'span' })).toBeTruthy()
    expect(screen.getByText('阻碍对象')).toBeTruthy()
    const chips = screen.getAllByText(/^WS-1$|R-1$/)
    expect(chips.map((c) => c.textContent)).toEqual(['WS-1', 'R-1'])
    expect(screen.getByText('来源：用户报告')).toBeTruthy()
    expect(screen.getByText('1 个活跃')).toBeTruthy()
    // 无接线 ⇒ 清除按钮禁用:
    const btn = screen.getByRole('button', { name: '清除' }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it('清除按钮接线后上抛 id', () => {
    let called: string | null = null
    render(<BlockerSection slice={ready({ items: BLK })} sections={splitBlockers(BLK)} onClear={(id) => (called = id)} />)
    fireEvent.click(screen.getByRole('button', { name: '清除' }))
    expect(called).toBe('BLK-1')
  })

  it('CLEARED 折进 details; 空 ACTIVE 显示「无活跃阻碍」', () => {
    render(<BlockerSection slice={ready({ items: BLK })} sections={splitBlockers(BLK)} />)
    expect(screen.getByText('1 个已清除')).toBeTruthy()
    expect(screen.getByText('已清除', { selector: 'span' })).toBeTruthy()
    expect(screen.getByText('已清的阻碍')).toBeTruthy()
    expect(screen.queryByText('无活跃阻碍')).toBeNull()

    cleanup()
    const clearedOnly: BlockerItem[] = [BLK[1]!]
    render(<BlockerSection slice={ready({ items: clearedOnly })} sections={splitBlockers(clearedOnly)} />)
    expect(screen.getByText('无活跃阻碍')).toBeTruthy()
  })

  it('错误切片: role=alert + 消息; stale 数据保留时附注', () => {
    render(<BlockerSection slice={errorSlice({ items: BLK }, '数据缝未接线')} sections={splitBlockers(BLK)} />)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('数据缝未接线')
    expect(alert.textContent).toContain('显示上次成功数据')
  })
})

describe('ObjectiveProgress（进度概览）', () => {
  it('计数摘要 + 逐行（状态徽标/优先级/目标日期/待转正提案数）', () => {
    const rows = [
      { objective: OBJ2, proposedCount: 3 },
      { objective: { ...OBJ1, targetDate: 1757126400000 }, proposedCount: 0 },
    ]
    const counts = { total: 2, active: 2, achieved: 0, dropped: 0 }
    render(<ObjectiveProgress slice={ready({ objectives: [], topics: [] })} rows={rows} counts={counts} />)
    expect(screen.getByText('2 个目标：2 活跃 / 0 已达成 / 0 已放弃')).toBeTruthy()
    expect(screen.getByText('主题级目标')).toBeTruthy()
    expect(screen.getByText('项目级目标')).toBeTruthy()
    // 状态徽标「活跃」×2:
    expect(screen.getAllByText('活跃').length).toBeGreaterThanOrEqual(2)
    // 目标日期（epoch ms → YYYY-MM-DD）:
    expect(screen.getByText(new Date(1757126400000).toISOString().slice(0, 10))).toBeTruthy()
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2)
    // 待转正提案数: 3 显示, 0 显示 —:
    expect(screen.getByText('3', { selector: 'td' })).toBeTruthy()
  })

  it('终态徽标（已达成/已放弃）', () => {
    const rows = [
      { objective: { ...OBJ1, status: 'ACHIEVED' as const }, proposedCount: 0 },
      { objective: { ...OBJ1, id: 'OBJ-9', status: 'DROPPED' as const }, proposedCount: 0 },
    ]
    const counts = { total: 2, active: 0, achieved: 1, dropped: 1 }
    render(<ObjectiveProgress slice={ready({ objectives: [], topics: [] })} rows={rows} counts={counts} />)
    expect(screen.getByText('已达成')).toBeTruthy()
    expect(screen.getByText('已放弃')).toBeTruthy()
    expect(screen.getByText('2 个目标：0 活跃 / 1 已达成 / 1 已放弃')).toBeTruthy()
  })

  it('空 objectives: 提示尚无声明', () => {
    render(<ObjectiveProgress slice={ready({ objectives: [], topics: [] })} rows={[]} counts={{ total: 0, active: 0, achieved: 0, dropped: 0 }} />)
    expect(screen.getByText('尚无 Objective 声明（.research/objectives.yaml）')).toBeTruthy()
  })
})

describe('NextActionsSection（按 objective 分组）', () => {
  it('组头（statement + 主题级 + 优先级）+ 「未关联目标」组', () => {
    render(<NextActionsSection slice={ready({ items: NA })} groups={makeGroups()} />)
    expect(screen.getByText('主题级目标')).toBeTruthy()
    expect(screen.getByText('主题级')).toBeTruthy()
    expect(screen.getByText('未关联目标')).toBeTruthy()
  })

  it('PROPOSED 行: 待转正徽标 + 理由 + 转正/弃用 按钮（无接线禁用）', () => {
    render(<NextActionsSection slice={ready({ items: NA })} groups={makeGroups()} />)
    expect(screen.getByText('待转正')).toBeTruthy()
    expect(screen.getByText('理由：数据不足')).toBeTruthy()
    const promote = screen.getByRole('button', { name: '转正' }) as HTMLButtonElement
    const dismiss = screen.getByRole('button', { name: '弃用' }) as HTMLButtonElement
    expect(promote.disabled).toBe(true)
    expect(dismiss.disabled).toBe(true)
  })

  it('接线后按钮上抛 id（转正/弃用）', () => {
    const events: string[] = []
    render(
      <NextActionsSection
        slice={ready({ items: NA })}
        groups={makeGroups()}
        onPromote={(id) => events.push(`promote:${id}`)}
        onDismiss={(id) => events.push(`dismiss:${id}`)}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '转正' }))
    fireEvent.click(screen.getByRole('button', { name: '弃用' }))
    expect(events).toEqual(['promote:NA-1', 'dismiss:NA-1'])
  })

  it('PROMOTED 行: 已转正为 T-n（data-task-id 钩子）; DISMISSED 行 muted 无控件', () => {
    render(<NextActionsSection slice={ready({ items: NA })} groups={makeGroups()} />)
    expect(screen.getByText('已转正')).toBeTruthy()
    const pointer = screen.getByText('T-5')
    expect(pointer.getAttribute('data-task-id')).toBe('T-5')
    expect(screen.getByText('已弃用')).toBeTruthy()
    // 仅 PROPOSED 行有按钮（NA-1 一条）:
    expect(screen.getAllByRole('button', { name: '转正' })).toHaveLength(1)
  })

  it('WS chip 展示（data-ws-id 钩子）', () => {
    render(<NextActionsSection slice={ready({ items: NA })} groups={makeGroups()} />)
    expect(screen.getAllByText('WS-1').length).toBeGreaterThanOrEqual(1)
  })

  it('空清单: 提示暂无 NextAction', () => {
    render(<NextActionsSection slice={ready({ items: [] })} groups={[]} />)
    expect(screen.getByText('暂无 NextAction（Agent 可经工具面提案）')).toBeTruthy()
  })

  it('错误切片（无数据）: role=alert', () => {
    render(<NextActionsSection slice={errorSlice<{ readonly items: readonly NextActionItem[] }>(null, '缝未接线')} groups={[]} />)
    expect(screen.getByRole('alert').textContent).toContain('缝未接线')
  })
})
