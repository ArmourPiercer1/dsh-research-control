/**
 * WP-4.4 — History timeline view integration tests (jsdom + testing-library).
 *
 * The container is driven through its REAL data path: a `createResearchStore`
 * over a controllable stub facade (tests/views-history/fixtures.ts — the
 * full 14-method face, `queryHistory` emulating the host's seq-axis window
 * protocol over an in-memory log). Task test matrix:
 *
 *  - 双序渲染差异 (dual-order diff): the scenario's LATE-REGISTERED
 *    RUN_FINISHED (H-3) sorts to position 2 in the semantic timeline
 *    (research time) but stays at position 3 (its seq) in audit order;
 *    switching the tab re-queries with `order: 'audit'` and the primary
 *    timestamp flips 发生 → 登记;
 *  - wrapper 分组正确性 (run-grouping): per-Run groups (sorted by runId),
 *    the RUNS_STARTED fan-out (one row in two groups), statuses, and
 *    「聚合不改底层事件」— switching back to the atomic view shows every
 *    row, unmodified, in order;
 *  - 分页触发 (pagination): 「加载更多」issues
 *    `queryHistory(afterSeq = previous nextAfterSeq)` and stops at
 *    exhaustion; the in-flight window disables the button while the
 *    stale page stays visible; a failed window offers a retry;
 *  - 空态/加载态 (empty / loading) + business-fault error banner;
 *  - 事件类型徽标 / 演员 U/A/P 标识 (badges + actor letters).
 *
 * Assertions target user-visible text/roles/order — never class names.
 * `afterEach(cleanup)` is explicit: the repo's vitest config has no
 * `globals: true`, so testing-library's auto-cleanup hook cannot attach.
 */

// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { formatEpochMs, HistoryTimelineView } from '../../src/client/views/history/index.js'
import type { ResearchStore } from '../../src/client/stores/index.js'
import {
  AUDIT_ORDER,
  type HistoryFacade,
  makeFaultyFacade,
  makeHistoryFacade,
  pageOf,
  SCENARIO,
  SEMANTIC_ORDER,
  T0,
  storeOver,
} from './fixtures.js'

/* -- tiny visible-order helpers (DOM order of the timeline rows) -- */

/** The event ids of the visible timeline rows, in DOM (visual) order. */
function rowIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('li'))
    .map(li => li.textContent ?? '')
    .map(text => {
      const match = text.match(/· (H-\d+)/)
      return match === null ? '' : match[1]
    })
    .filter(id => id !== '')
}

/** The row element carrying one event id. */
function rowByEventId(container: HTMLElement, id: string): HTMLElement {
  const row = Array.from(container.querySelectorAll('li')).find(li => (li.textContent ?? '').includes(`· ${id}`))
  if (row === undefined) throw new Error(`row for ${id} not found`)
  return row
}

const auditButton = () => screen.getByRole('button', { name: '审计序（登记时间）' })
const semanticButton = () => screen.getByRole('button', { name: '语义序（发生时间）' })
const runsButton = () => screen.getByRole('button', { name: '按 Run 聚合' })
const atomicButton = () => screen.getByRole('button', { name: '原子时间线' })
const loadMoreButton = () => screen.getByRole('button', { name: '加载更多' })

describe('HistoryTimelineView — dual-order rendering (catalog §2 双时序)', () => {
  let facade: HistoryFacade
  let store: ResearchStore

  beforeEach(() => {
    facade = makeHistoryFacade(SCENARIO)
    store = storeOver(facade.rpc)
  })
  afterEach(cleanup)

  it('renders the DEFAULT semantic timeline: the late-registered end sorts to its research-time position', async () => {
    const { container } = render(<HistoryTimelineView store={store} workstreamId="WS-1" />)
    await screen.findByText(/· H-6/)
    // Semantic order = occurredAt: H-3 (occurredAt T0+5s) sits BETWEEN H-1 and H-2.
    expect(rowIds(container)).toEqual(SEMANTIC_ORDER)
    // Semantic mode highlights the OCCURRENCE time as primary.
    expect(rowByEventId(container, 'H-3').textContent).toContain(`发生 ${formatEpochMs(T0 + 5_000)}`)
    expect(rowByEventId(container, 'H-1').textContent).toContain(`发生 ${formatEpochMs(T0)}`)
  })

  it('the audit tab re-queries with order:"audit": registration order, 登记 time primary (the dual-order diff)', async () => {
    const { container } = render(<HistoryTimelineView store={store} workstreamId="WS-1" />)
    await screen.findByText(/· H-6/)
    expect(rowIds(container)).toEqual(SEMANTIC_ORDER)

    fireEvent.click(auditButton())
    await screen.findByText(new RegExp(`登记 ${formatEpochMs(T0 + 50_000)}`))
    // Audit order = eventSeq: H-3 (seq 3) returns to its registration slot.
    expect(rowIds(container)).toEqual(AUDIT_ORDER)
    // The tab re-issued the FIRST window of the new order (fresh reading).
    expect(facade.calls[1]).toEqual({ workstreamId: 'WS-1', order: 'audit', limit: 20 })
    // Audit mode highlights the REGISTRATION time as primary.
    expect(rowByEventId(container, 'H-3').textContent).toContain(`登记 ${formatEpochMs(T0 + 50_000)}`)
    // The active tab is marked.
    expect(auditButton().getAttribute('aria-pressed')).toBe('true')
    expect(semanticButton().getAttribute('aria-pressed')).toBe('false')
  })
})

describe('HistoryTimelineView — the per-Run wrapper view (catalog §3.7, INV-HIST-8)', () => {
  let facade: HistoryFacade
  let store: ResearchStore

  beforeEach(() => {
    facade = makeHistoryFacade(SCENARIO)
    store = storeOver(facade.rpc)
  })
  afterEach(cleanup)

  it('groups by Run (sorted by runId) with the RUNS_STARTED fan-out and derived statuses', async () => {
    const { container } = render(<HistoryTimelineView store={store} workstreamId="WS-1" />)
    await screen.findByText(/· H-6/)
    fireEvent.click(runsButton())

    const sections = Array.from(container.querySelectorAll('section'))
    expect(sections.map(section => section.getAttribute('data-run-id'))).toEqual(['R-1', 'R-2', 'R-3'])

    const r1 = sections[0]
    const r2 = sections[1]
    const r3 = sections[2]
    expect(r1.textContent).toContain('R-1')
    expect(r1.textContent).toContain('已完成')
    expect(r1.textContent).toContain('2 条事件')
    expect(r2.textContent).toContain('已取消')
    expect(r2.textContent).toContain('2 条事件')
    expect(r3.textContent).toContain('运行中')
    expect(r3.textContent).toContain('1 条事件')

    // R-1 members in the ACTIVE (semantic) input order: start H-1, late end H-3.
    const r1Ids = Array.from(r1.querySelectorAll('li'))
      .map(li => li.textContent ?? '')
      .map(text => text.match(/· (H-\d+)/)?.[1] ?? '')
      .filter(id => id !== '')
    expect(r1Ids).toEqual(['H-1', 'H-3'])

    // The batch row H-4 is projected into BOTH R-2 and R-3 (fan-out,
    // zero-copy — one underlying row, two reading groups).
    expect(r2.textContent).toContain('· H-4')
    expect(r2.textContent).toContain('· H-5')
    expect(r3.textContent).toContain('· H-4')
    // The non-run row H-6 (GATE_EVALUATED) belongs to no group.
    expect(r1.textContent).not.toContain('· H-6')
    expect(r2.textContent).not.toContain('· H-6')
    expect(r3.textContent).not.toContain('· H-6')
  })

  it('aggregation does not alter the underlying events: the atomic view still shows every row, in order', async () => {
    const { container } = render(<HistoryTimelineView store={store} workstreamId="WS-1" />)
    await screen.findByText(/· H-6/)
    fireEvent.click(runsButton())
    await screen.findByText('R-3')
    fireEvent.click(atomicButton())
    // All six rows, back, in the semantic order — nothing lost, added, or reordered.
    expect(rowIds(container)).toEqual(SEMANTIC_ORDER)
  })

  it('a page with no run-lifecycle events shows a hint instead of empty groups', async () => {
    const lone = SCENARIO.filter(event => event.eventId === 'H-6')
    const loneFacade = makeHistoryFacade(lone)
    render(<HistoryTimelineView store={storeOver(loneFacade.rpc)} workstreamId="WS-1" />)
    await screen.findByText(/· H-6/)
    fireEvent.click(runsButton())
    expect(screen.getByText('当前页面没有 Run 生命周期事件（原子时间线共 1 条事件）')).toBeTruthy()
    fireEvent.click(atomicButton())
    expect(screen.getByText(/· H-6/)).toBeTruthy()
  })
})

describe('HistoryTimelineView — pagination (seq-axis windows, rpc-contracts §5)', () => {
  let facade: HistoryFacade
  let store: ResearchStore

  beforeEach(() => {
    facade = makeHistoryFacade(SCENARIO)
    store = storeOver(facade.rpc)
  })
  afterEach(cleanup)

  it('load-more fetches the NEXT seq window (afterSeq = previous nextAfterSeq) and stops at exhaustion', async () => {
    const { container } = render(<HistoryTimelineView store={store} workstreamId="WS-1" pageSize={3} />)
    await screen.findByText(/· H-2/)
    // First window (0,3] — the three seq rows, presented semantically.
    expect(facade.calls[0]).toEqual({ workstreamId: 'WS-1', order: 'semantic', limit: 3 })
    expect(rowIds(container)).toEqual(['H-1', 'H-3', 'H-2'])
    expect(screen.queryByText('时间线已加载完毕（共 6 条事件）')).toBeNull()

    fireEvent.click(loadMoreButton())
    await screen.findByText('时间线已加载完毕（共 6 条事件）')
    // The next window is anchored at the previous page's nextAfterSeq (3).
    expect(facade.calls[1]).toEqual({ workstreamId: 'WS-1', order: 'semantic', afterSeq: 3, limit: 3 })
    // The full stream, re-sorted semantically across pages.
    expect(rowIds(container)).toEqual(SEMANTIC_ORDER)
    // Exhausted: no load-more button remains.
    expect(screen.queryByRole('button', { name: '加载更多' })).toBeNull()
  })

  it('disables load-more while the next window is in flight; the stale page stays visible until it settles', async () => {
    const { container } = render(<HistoryTimelineView store={store} workstreamId="WS-1" pageSize={3} />)
    await screen.findByText(/· H-2/)
    expect(rowIds(container)).toEqual(['H-1', 'H-3', 'H-2'])

    facade.nextControlled() // the NEXT queryHistory call will hold
    fireEvent.click(loadMoreButton())
    // In flight: the button is disabled, the stale page still renders.
    const inFlight = screen.getByRole('button', { name: '加载更多中…' })
    expect((inFlight as HTMLButtonElement).disabled).toBe(true)
    expect(rowIds(container)).toEqual(['H-1', 'H-3', 'H-2'])
    expect(screen.queryByRole('button', { name: '加载更多' })).toBeNull()

    const second = pageOf(SCENARIO, { workstreamId: 'WS-1', order: 'semantic', afterSeq: 3, limit: 3 })
    facade.resolve(second)
    await screen.findByText('时间线已加载完毕（共 6 条事件）')
    expect(rowIds(container)).toEqual(SEMANTIC_ORDER)
  })

  it('a failed load-more keeps the loaded page (stale-while-revalidate) and offers a retry that re-fetches', async () => {
    const { container } = render(<HistoryTimelineView store={store} workstreamId="WS-1" pageSize={3} />)
    await screen.findByText(/· H-2/)
    expect(rowIds(container)).toEqual(['H-1', 'H-3', 'H-2'])

    facade.nextFails('HIST_IO', 'page fetch blew up')
    fireEvent.click(loadMoreButton())
    const banner = await screen.findByRole('alert')
    expect(banner.textContent).toContain('page fetch blew up')
    // The stale first page remains visible under the error.
    expect(rowIds(container)).toEqual(['H-1', 'H-3', 'H-2'])
    expect(screen.queryByRole('button', { name: '加载更多' })).toBeNull()

    // The retry re-issues the failed window (same args) and settles the stream.
    fireEvent.click(screen.getByRole('button', { name: '重试加载' }))
    await screen.findByText('时间线已加载完毕（共 6 条事件）')
    const retried = facade.calls[facade.calls.length - 1]
    expect(retried).toEqual({ workstreamId: 'WS-1', order: 'semantic', afterSeq: 3, limit: 3 })
    expect(rowIds(container)).toEqual(SEMANTIC_ORDER)
  })

  it('switching the order tab resets pagination (a fresh first-window query, no continuation)', async () => {
    const { container } = render(<HistoryTimelineView store={store} workstreamId="WS-1" pageSize={3} />)
    await screen.findByText(/· H-2/)
    fireEvent.click(loadMoreButton())
    await screen.findByText('时间线已加载完毕（共 6 条事件）')
    expect(facade.calls.length).toBe(2)

    fireEvent.click(auditButton())
    // Fresh audit reading: a NEW first window (3 rows — not exhausted, so
    // the load-more button returns) replaces the semantic stream.
    await screen.findByRole('button', { name: '加载更多' })
    expect(facade.calls.length).toBe(3)
    expect(facade.calls[2]).toEqual({ workstreamId: 'WS-1', order: 'audit', limit: 3 })
    expect(rowIds(container)).toEqual(['H-1', 'H-2', 'H-3'])
  })
})

describe('HistoryTimelineView — empty / loading / error states', () => {
  afterEach(cleanup)

  it('shows the loading state until the first window arrives; the first query is the canonical first window', async () => {
    const facade = makeHistoryFacade(SCENARIO)
    facade.nextControlled() // hold the FIRST page
    render(<HistoryTimelineView store={storeOver(facade.rpc)} workstreamId="WS-1" />)
    expect(screen.getByText('时间线加载中…')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '加载更多' })).toBeNull()
    expect(facade.calls).toEqual([{ workstreamId: 'WS-1', order: 'semantic', limit: 20 }])

    facade.resolve(pageOf(SCENARIO, { workstreamId: 'WS-1', order: 'semantic', limit: 20 }))
    await screen.findByText(/· H-6/)
    expect(screen.queryByText('时间线加载中…')).toBeNull()
  })

  it('shows the empty state for a workstream with no events', async () => {
    render(<HistoryTimelineView store={storeOver(makeHistoryFacade([]).rpc)} workstreamId="WS-1" />)
    await screen.findByText('No recorded history yet.')
    expect(screen.queryByRole('button', { name: '加载更多' })).toBeNull()
  })

  it('surfaces a business fault as an error banner with a retry button (first load, no stale rows)', async () => {
    render(<HistoryTimelineView store={storeOver(makeFaultyFacade())} workstreamId="WS-1" />)
    const banner = await screen.findByRole('alert')
    expect(banner.textContent).toContain('历史时间线加载失败')
    expect(banner.textContent).toContain('workstream log missing')
    expect(screen.queryByText('No recorded history yet.')).toBeNull()
    expect(screen.getByRole('button', { name: '重试加载' })).toBeTruthy()
  })
})

describe('HistoryTimelineView — event type badges and actor U/A/P letters', () => {
  afterEach(cleanup)

  it('renders the catalog Chinese label per row and the actor letter from the envelope', async () => {
    const facade = makeHistoryFacade(SCENARIO)
    const { container } = render(<HistoryTimelineView store={storeOver(facade.rpc)} workstreamId="WS-1" />)
    await screen.findByText(/· H-6/)

    // The six rows carry their catalog labels (event-meta §4 mapping).
    for (const label of ['Run 开始', '记录 Fact', 'Run 正常结束', '批量启动 Run', 'Run 已取消', 'Gate 评估']) {
      expect(screen.getByText(label)).toBeTruthy()
    }

    // The actor badge letter (the row's span whose entire text is the letter):
    // H-1 USER→U, H-2 AGENT→A, H-4 PLUGIN→P.
    const letterOf = (id: string): string[] =>
      Array.from(rowByEventId(container, id).querySelectorAll('span'))
        .map(span => span.textContent ?? '')
        .filter(text => text.length === 1)
    expect(letterOf('H-1')).toContain('U')
    expect(letterOf('H-2')).toContain('A')
    expect(letterOf('H-4')).toContain('P')
  })

  it('unknown event types degrade to a readable badge (no crash)', async () => {
    const ghost = [
      SCENARIO[0],
      { ...SCENARIO[5], eventId: 'H-7', eventSeq: 7, eventType: 'FUTURE_EVENT_TYPE', payload: { note: 'new catalog row' } },
    ]
    render(<HistoryTimelineView store={storeOver(makeHistoryFacade(ghost).rpc)} workstreamId="WS-1" />)
    // The raw type name becomes the label (event-meta fallback).
    await screen.findByText('FUTURE_EVENT_TYPE')
  })
})
