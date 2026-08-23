// @vitest-environment jsdom
/**
 * WP-4.7 — project page PRESENTATION layer tests (pure props components).
 *
 * Scope (task brief「渲染断言」, §27.2 information architecture):
 *  - each §27.2 block renders its data (Project Brief, importance /
 *    attention mode meta, the Objective list with statements + the
 *    current-objective marker, the Topic list, the two PHASE 5
 *    placeholder sections for the frozen-null fields);
 *  - null semantics: ordinary data nulls (description / targetDate)
 *    render only when present; the frozen-null placeholder sections are
 *    SHOWN, never hidden (「待 Phase 5」);
 *  - navigation callbacks fire with the right ids (topic → topic view,
 *    返回 → home);
 *  - loading / first-load failure / stale-while-revalidate error faces.
 *
 * Assertions target user-visible behavior (roles, text, callbacks) —
 * never CSS module class names.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ProjectPageView } from '../../src/client/views/project'
import {
  assertWireValidProject,
  PROJECT_PAGE_EMPTY_FIXTURE,
  PROJECT_PAGE_FIXTURE,
} from './fixtures'

afterEach(cleanup)

/** Render the pure view with a full snapshot + spy callbacks. */
function renderView(
  fixture = PROJECT_PAGE_FIXTURE,
  callbacks?: Partial<Record<string, unknown>>,
) {
  const onRetry = vi.fn()
  const onBack = vi.fn()
  const onOpenTopic = vi.fn()
  const utils = render(
    <ProjectPageView
      data={fixture}
      status="ready"
      error={null}
      onRetry={onRetry}
      onBack={onBack}
      onOpenTopic={onOpenTopic}
      {...callbacks}
    />,
  )
  return { onRetry, onBack, onOpenTopic, ...utils }
}

describe('fixtures are wire-valid (contract drift fails the suite, not the wire)', () => {
  it('PROJECT_PAGE_FIXTURE and PROJECT_PAGE_EMPTY_FIXTURE parse through the strict schema', () => {
    assertWireValidProject(PROJECT_PAGE_FIXTURE)
    assertWireValidProject(PROJECT_PAGE_EMPTY_FIXTURE)
  })
})

describe('section data rendering (§27.2 information architecture)', () => {
  it('renders the page title with the project id + title and the back action', () => {
    renderView()
    expect(screen.getByRole('heading', { level: 1, name: /PRJ-1 · 凝聚态方向综述/ })).toBeDefined()
    expect(screen.getByRole('button', { name: '← 返回总览' })).toBeDefined()
  })

  it('renders the Project Brief (description)', () => {
    renderView()
    expect(screen.getByRole('heading', { level: 2, name: '项目简介' })).toBeDefined()
    expect(screen.getByText('追踪关键方向进展并整理证据链')).toBeDefined()
  })

  it('renders importance / attention mode (+ id / target date / created meta)', () => {
    renderView()
    expect(screen.getByText('编号：PRJ-1')).toBeDefined()
    expect(screen.getByText('重要度：5')).toBeDefined()
    expect(screen.getByText('注意力：聚焦')).toBeDefined()
    // 目标日期 appears twice: the project meta + OBJ-1 (the current
    // objective carries a targetDate). Both in the local YYYY-MM-DD shape.
    const targets = screen.getAllByText(/^目标日期：/u)
    expect(targets).toHaveLength(2)
    for (const el of targets) {
      expect(el.textContent).toMatch(/^目标日期：\d{4}-\d{2}-\d{2}$/u)
    }
    expect(screen.getByText(/^创建：\d{4}-\d{2}-\d{2}$/u)).toBeDefined()
  })

  it('renders EVERY objective with its statement, status, priority and current marker', () => {
    renderView()
    expect(screen.getByRole('heading', { level: 2, name: '目标（3）' })).toBeDefined()
    // statements (the §27.2 Objective content — not just refs)
    expect(screen.getByText('完成凝聚态物理关键方向的系统综述')).toBeDefined()
    expect(screen.getByText('建立高温超导机制的定量模型')).toBeDefined()
    expect(screen.getByText('旧方向的对比研究（已放弃）')).toBeDefined()
    // per-row meta
    const obj1 = document.querySelector('[data-objective-id="OBJ-1"]')
    expect(obj1?.textContent).toContain('进行中')
    expect(obj1?.textContent).toContain('P0')
    expect(obj1?.getAttribute('data-current')).toBe('true')
    expect(obj1?.textContent).toContain('当前目标')
    const obj2 = document.querySelector('[data-objective-id="OBJ-2"]')
    expect(obj2?.textContent).toContain('已达成')
    expect(obj2?.getAttribute('data-current')).toBe('false')
    const obj3 = document.querySelector('[data-objective-id="OBJ-3"]')
    expect(obj3?.textContent).toContain('已放弃')
  })

  it('renders the topic list with workstream counts (one card per topic)', () => {
    renderView()
    expect(screen.getByRole('heading', { level: 2, name: '主题（2）' })).toBeDefined()
    expect(screen.getByRole('button', { name: /高温超导/ })).toBeDefined()
    expect(screen.getByRole('button', { name: /拓扑材料/ })).toBeDefined()
    expect(screen.getByText('3 个工作流')).toBeDefined()
    expect(screen.getByText('0 个工作流')).toBeDefined()
  })

  it('renders the two PHASE 5 placeholder sections with their 「待 Phase 5」 copy', () => {
    renderView()
    // the sections are SHOWN (not hidden) for every frozen-null field
    expect(screen.getByRole('heading', { level: 3, name: '即将到来的交互' })).toBeDefined()
    expect(screen.getByRole('heading', { level: 3, name: '即将到来的报告' })).toBeDefined()
    expect(screen.getAllByText('待 Phase 5')).toHaveLength(2)
  })
})

describe('null semantics + empty states', () => {
  it('omits null ordinary data fields (description / targetDate) without empty labels', () => {
    renderView(PROJECT_PAGE_EMPTY_FIXTURE)
    expect(screen.getByRole('heading', { level: 1, name: /PRJ-1 · 项目一/ })).toBeDefined()
    expect(screen.queryByRole('heading', { level: 2, name: '项目简介' })).toBeNull()
    expect(screen.queryByText(/^目标日期：/u)).toBeNull()
    expect(screen.getByText('重要度：0')).toBeDefined()
    expect(screen.getByText('注意力：后台')).toBeDefined()
  })

  it('shows explicit empty states (not hidden sections) for empty objectives / topics', () => {
    renderView(PROJECT_PAGE_EMPTY_FIXTURE)
    expect(screen.getByRole('heading', { level: 2, name: '目标（0）' })).toBeDefined()
    expect(screen.getByText('暂无目标')).toBeDefined()
    expect(screen.getByRole('heading', { level: 2, name: '主题（0）' })).toBeDefined()
    expect(screen.getByText('暂无主题')).toBeDefined()
  })
})

describe('navigation callbacks (entry points to topic/home views)', () => {
  it('fires onOpenTopic with the topic id when a topic card is clicked', () => {
    const { onOpenTopic } = renderView()
    fireEvent.click(screen.getByRole('button', { name: /高温超导/ }))
    expect(onOpenTopic).toHaveBeenCalledTimes(1)
    expect(onOpenTopic).toHaveBeenCalledWith('TPC-1')
  })

  it('fires onBack when the 返回 button is clicked', () => {
    const { onBack } = renderView()
    fireEvent.click(screen.getByRole('button', { name: '← 返回总览' }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})

describe('loading / error faces (status + data matrix)', () => {
  it('shows 加载中… while loading without data (idle/loading)', () => {
    render(
      <ProjectPageView data={null} status="loading" error={null} onRetry={vi.fn()} onBack={vi.fn()} onOpenTopic={vi.fn()} />,
    )
    expect(screen.getByRole('status')).toBeDefined()
    expect(screen.getByText('加载中…')).toBeDefined()
  })

  it('shows the failure text and a 重试 action on a first-load failure (error, no data)', () => {
    const onRetry = vi.fn()
    render(
      <ProjectPageView
        data={null}
        status="error"
        error="research: not mounted"
        onRetry={onRetry}
        onBack={vi.fn()}
        onOpenTopic={vi.fn()}
      />,
    )
    expect(screen.getByRole('alert')).toBeDefined()
    expect(screen.getByText('加载失败：research: not mounted')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('keeps stale data visible with a 刷新失败 banner on a failed refetch (stale-while-revalidate)', () => {
    render(
      <ProjectPageView
        data={PROJECT_PAGE_FIXTURE}
        status="error"
        error="research: gateway timeout"
        onRetry={vi.fn()}
        onBack={vi.fn()}
        onOpenTopic={vi.fn()}
      />,
    )
    // the last good data stays rendered
    expect(screen.getByRole('heading', { level: 1, name: /PRJ-1 · 凝聚态方向综述/ })).toBeDefined()
    expect(screen.getByText('完成凝聚态物理关键方向的系统综述')).toBeDefined()
    // plus the error banner (no 重试 — the data is still usable)
    expect(screen.getByRole('alert')).toBeDefined()
    expect(screen.getByText('刷新失败：research: gateway timeout')).toBeDefined()
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull()
  })
})
