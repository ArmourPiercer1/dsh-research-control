// @vitest-environment jsdom
/**
 * WP-4.2 — home dashboard PRESENTATION layer tests (pure props components).
 *
 * Scope (task brief「渲染断言」):
 *  - each §27.1 block renders its data (project card, topic overview,
 *    OPEN/PENDING intervention groups, the four PHASE 5/6 placeholder
 *    sections, page header + refresh action);
 *  - null placeholder copy: the frozen-null fields show 「待 Phase 5/6」
 *    — the sections are SHOWN, never hidden;
 *  - INV-ATTN-1: both intervention groups render EVERY item in full
 *    (titles, meta, workstream chips) — no truncation, no hiding;
 *  - navigation callbacks fire with the right ids (topic → topic view,
 *    workstream chip → workstream view, 「历史」 → History timeline,
 *    刷新 → refresh callback);
 *  - loading / first-load failure / stale-while-revalidate error faces.
 *
 * Assertions target user-visible behavior (roles, text, callbacks) —
 * never CSS module class names.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { HomeDashboardView } from '../../src/client/views/home'
import {
  assertWireValidDashboard,
  HOME_EMPTY_FIXTURE,
  HOME_FIXTURE,
} from './fixtures'

afterEach(cleanup)

/** Render the pure view with a full snapshot + spy callbacks. */
function renderView(fixture = HOME_FIXTURE, callbacks?: Partial<Record<string, unknown>>) {
  const onRefresh = vi.fn()
  const onRetry = vi.fn()
  const onOpenTopic = vi.fn()
  const onOpenWorkstream = vi.fn()
  const onOpenHistory = vi.fn()
  const utils = render(
    <HomeDashboardView
      data={fixture}
      status="ready"
      error={null}
      onRefresh={onRefresh}
      onRetry={onRetry}
      onOpenTopic={onOpenTopic}
      onOpenWorkstream={onOpenWorkstream}
      onOpenHistory={onOpenHistory}
      {...callbacks}
    />,
  )
  return { onRefresh, onRetry, onOpenTopic, onOpenWorkstream, onOpenHistory, ...utils }
}

describe('fixtures are wire-valid (contract drift fails the suite, not the wire)', () => {
  it('HOME_FIXTURE and HOME_EMPTY_FIXTURE parse through the strict schema', () => {
    assertWireValidDashboard(HOME_FIXTURE)
    assertWireValidDashboard(HOME_EMPTY_FIXTURE)
  })
})

describe('section data rendering (§27.1 information architecture)', () => {
  it('renders the page header with the refresh action', () => {
    renderView()
    expect(screen.getByRole('heading', { level: 1, name: '研究总览' })).toBeDefined()
    expect(screen.getByRole('button', { name: '刷新' })).toBeDefined()
  })

  it('renders the project card: title, description, id, importance, attention mode, target date', () => {
    renderView()
    expect(screen.getByRole('heading', { level: 2, name: '凝聚态方向综述' })).toBeDefined()
    expect(screen.getByText('追踪关键方向进展并整理证据链')).toBeDefined()
    expect(screen.getByText('编号：PRJ-1')).toBeDefined()
    expect(screen.getByText('重要度：5')).toBeDefined()
    expect(screen.getByText('注意力：聚焦')).toBeDefined()
    // targetDate 1755000000000 renders as a YYYY-MM-DD date (local TZ shape)
    const target = screen.getByText(/^目标日期：/)
    expect(target.textContent).toMatch(/^目标日期：\d{4}-\d{2}-\d{2}$/u)
  })

  it('renders the topic overview with workstream counts', () => {
    renderView()
    expect(screen.getByRole('heading', { level: 3, name: '主题概览' })).toBeDefined()
    expect(screen.getByRole('button', { name: /高温超导/ })).toBeDefined()
    expect(screen.getByRole('button', { name: /拓扑材料/ })).toBeDefined()
    expect(screen.getByText('3 个工作流')).toBeDefined()
    expect(screen.getByText('0 个工作流')).toBeDefined()
  })

  it('renders the four PHASE 5/6 placeholder sections with their 「待 Phase N」 copy', () => {
    renderView()
    // the sections are SHOWN (not hidden) for every frozen-null field
    for (const title of ['计划事件', '报告项', '研究收件箱', '注意力排序']) {
      expect(screen.getByRole('heading', { level: 3, name: title })).toBeDefined()
    }
    // 待 Phase 5: scheduledEvents + reportingItems + attention (3 sections)
    expect(screen.getAllByText('待 Phase 5')).toHaveLength(3)
    // 待 Phase 6: inboxCount (1 section)
    expect(screen.getAllByText('待 Phase 6')).toHaveLength(1)
  })
})

describe('OPEN/PENDING intervention groups (INV-ATTN-1: complete, never hidden)', () => {
  it('renders EVERY open intervention in full: title, meta, origin, workstream chips', () => {
    renderView()
    const open = screen.getByRole('heading', { level: 3, name: 'OPEN 干预' })
    expect(open).toBeDefined()
    // both open items present (no truncation / no hiding)
    expect(screen.getByText('审阅 Agent 累积的计划分叉')).toBeDefined()
    expect(screen.getByText('实验优先级的用户疑问')).toBeDefined()
    // per-item meta (id · origin label · created date shape)
    expect(screen.getByText(/IV-1 · 来源：自动洪泛检测 · \d{4}-\d{2}-\d{2}/u)).toBeDefined()
    expect(screen.getByText(/IV-2 · 来源：用户 · \d{4}-\d{2}-\d{2}/u)).toBeDefined()
    // workstream chips of IV-1
    expect(screen.getByRole('button', { name: 'WS-1' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'WS-2' })).toBeDefined()
  })

  it('renders EVERY pending intervention in full in its own section (not merged into OPEN)', () => {
    renderView()
    expect(screen.getByRole('heading', { level: 3, name: 'PENDING 干预' })).toBeDefined()
    expect(screen.getByText('等待用户确认的审计发现')).toBeDefined()
    expect(screen.getByText(/IV-3 · 来源：自动审计 · \d{4}-\d{2}-\d{2}/u)).toBeDefined()
    expect(screen.getByRole('button', { name: 'WS-3' })).toBeDefined()
    // the pending item's id never appears in the OPEN group's rows
    const openSection = screen.getByRole('heading', { level: 3, name: 'OPEN 干预' }).closest('section')
    expect(openSection?.textContent).not.toContain('IV-3')
    const pendingSection = screen
      .getByRole('heading', { level: 3, name: 'PENDING 干预' })
      .closest('section')
    expect(pendingSection?.textContent).toContain('IV-3')
    expect(pendingSection?.textContent).not.toContain('IV-1')
  })

  it('shows an explicit empty state (not a hidden section) when a group is empty', () => {
    renderView(HOME_EMPTY_FIXTURE)
    expect(screen.getByRole('heading', { level: 3, name: 'OPEN 干预' })).toBeDefined()
    expect(screen.getByRole('heading', { level: 3, name: 'PENDING 干预' })).toBeDefined()
    expect(screen.getAllByText('暂无')).toHaveLength(2)
    expect(screen.getByText('暂无主题')).toBeDefined()
  })

  it('omits null ordinary data fields (description / targetDate) without empty labels', () => {
    renderView(HOME_EMPTY_FIXTURE)
    expect(screen.getByRole('heading', { level: 2, name: '项目一' })).toBeDefined()
    expect(screen.queryByText(/目标日期：/u)).toBeNull()
    expect(screen.queryByText(/重要度：0/u)).toBeDefined()
    expect(screen.getByText('注意力：后台')).toBeDefined()
  })
})

describe('navigation callbacks (entry points to topic/workstream/history views)', () => {
  it('fires onOpenTopic with the topic id when a topic card is clicked', () => {
    const { onOpenTopic } = renderView()
    fireEvent.click(screen.getByRole('button', { name: /高温超导/ }))
    expect(onOpenTopic).toHaveBeenCalledTimes(1)
    expect(onOpenTopic).toHaveBeenCalledWith('TPC-1')
  })

  it('fires onOpenWorkstream with the workstream id when a chip is clicked', () => {
    const { onOpenWorkstream } = renderView()
    fireEvent.click(screen.getByRole('button', { name: 'WS-2' }))
    expect(onOpenWorkstream).toHaveBeenCalledTimes(1)
    expect(onOpenWorkstream).toHaveBeenCalledWith('WS-2')
  })

  it('fires onOpenHistory with the intervention FIRST workstream id via the 「历史」 chip', () => {
    const { onOpenHistory } = renderView()
    // IV-1's workstreamIds = [WS-1, WS-2]; the History events of an
    // intervention are owned by its first related workstream.
    fireEvent.click(screen.getAllByRole('button', { name: '历史' })[0])
    expect(onOpenHistory).toHaveBeenCalledTimes(1)
    expect(onOpenHistory).toHaveBeenCalledWith('WS-1')
  })

  it('does not offer a 「历史」 chip for an intervention without workstreams', () => {
    renderView()
    // exactly one 「历史」 chip: only IV-1/IV-3 carry workstreamIds (IV-2 does not)
    expect(screen.getAllByRole('button', { name: '历史' })).toHaveLength(2)
  })

  it('fires onRefresh when the 刷新 button is clicked', () => {
    const { onRefresh } = renderView()
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })
})

describe('loading / error faces (status + data matrix)', () => {
  it('shows 加载中… while loading without data (idle/loading)', () => {
    render(<HomeDashboardView data={null} status="loading" error={null} onRefresh={vi.fn()} onRetry={vi.fn()} onOpenTopic={vi.fn()} onOpenWorkstream={vi.fn()} onOpenHistory={vi.fn()} />)
    expect(screen.getByRole('status')).toBeDefined()
    expect(screen.getByText('加载中…')).toBeDefined()
    // no section content while nothing is cached
    expect(screen.queryByRole('heading', { level: 3, name: '主题概览' })).toBeNull()
  })

  it('shows the failure text and a 重试 action on a first-load failure (error, no data)', () => {
    const onRetry = vi.fn()
    render(
      <HomeDashboardView
        data={null}
        status="error"
        error="research: not mounted"
        onRefresh={vi.fn()}
        onRetry={onRetry}
        onOpenTopic={vi.fn()}
        onOpenWorkstream={vi.fn()}
        onOpenHistory={vi.fn()}
      />,
    )
    expect(screen.getByRole('alert')).toBeDefined()
    expect(screen.getByText('加载失败：research: not mounted')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('keeps stale data visible with a 刷新失败 banner on a failed refetch (stale-while-revalidate)', () => {
    render(
      <HomeDashboardView
        data={HOME_FIXTURE}
        status="error"
        error="research: gateway timeout"
        onRefresh={vi.fn()}
        onRetry={vi.fn()}
        onOpenTopic={vi.fn()}
        onOpenWorkstream={vi.fn()}
        onOpenHistory={vi.fn()}
      />,
    )
    // the last good data stays rendered
    expect(screen.getByRole('heading', { level: 2, name: '凝聚态方向综述' })).toBeDefined()
    expect(screen.getByText('审阅 Agent 累积的计划分叉')).toBeDefined()
    // plus the error banner
    expect(screen.getByRole('alert')).toBeDefined()
    expect(screen.getByText('刷新失败：research: gateway timeout')).toBeDefined()
    // and no 重试 (the data is still usable — retry belongs to the no-data path)
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull()
  })

  it('shows a 正在刷新… indicator while refreshing with data present', () => {
    render(
      <HomeDashboardView
        data={HOME_FIXTURE}
        status="loading"
        error={null}
        onRefresh={vi.fn()}
        onRetry={vi.fn()}
        onOpenTopic={vi.fn()}
        onOpenWorkstream={vi.fn()}
        onOpenHistory={vi.fn()}
      />,
    )
    expect(screen.getByText('正在刷新…')).toBeDefined()
    expect(screen.getByRole('heading', { level: 2, name: '凝聚态方向综述' })).toBeDefined()
  })
})
