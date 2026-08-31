// @vitest-environment jsdom
/**
 * V2-UI-8 — 统一 Needs Attention 页 component tests (D §14 / B §27-§31;
 * ADJ-5 in-place evolution of the V2-T5.2 重要事件 page — the t52
 * selector surface, the 状态段 buttons and the IV card's Chinese action
 * row are preserved byte-compatible and re-pinned here).
 *
 * Plain stub props — no real cordis in the component spec (the views-*
 * test pattern). The inject faces (`loadAttention` / `updateInterventionState` /
 * `onInvestigate` + the four optional mutation faces) are vi.fn stubs per
 * case; the wire fixtures are re-parsed through the strict
 * `QueryAttentionResultSchema` in ./fixtures.ts, so a fixture that
 * drifts from the wire contract fails the suite, not the wire.
 *
 * Gate coverage (plan D3 — 组件测试 过滤/动作状态机/空态 + t52 兼容):
 *  - 单一 fetch 生命周期: loading → ready (ONE fetch/mount, StrictMode
 *    in-flight dedupe), HUB `{limit:200}` vs scoped `{projectId, limit:200}`,
 *    initial rejection → failed face + 刷新 retry, refresh =
 *    stale-while-revalidate (failure keeps stale data + 刷新失败 line,
 *    no stacked fetch while one is in flight);
 *  - 三段组: default view = OPEN/ACTIVE group + PENDING group (host
 *    order — never re-sorted, INV-ATTN-1), 已关闭 folded (local expand,
 *    NO second fetch), segment click narrows + re-click restores,
 *    per-group 暂无 copy, filter-to-terminals-only → 空态 face;
 *  - B §27.1 过滤器×5 (ADJ-9 single-select exact match): option value
 *    sets, [Project] narrow, [Workstream] cascade + auto-reset,
 *    scoped role = all plane projects listed but scope authoritative;
 *  - IV 卡 (t52 surface + B §27.2 common fields): 一键调查 blank =
 *    fault + 零调用 / success = investigated line / reject = fault,
 *    标记处理中 / 关闭[备注必填] / 确认关闭 / 重开 args (frozen §13
 *    machine — `resolutionNote` only for CLOSED), busy = refetch,
 *    reject = fault + NO re-fetch, CLOSED terminal = no controls;
 *  - 非 IV 卡: EXPLICIT_BLOCKER [Clear] via face, DERIVED_BLOCKER
 *    cause + Open Cause nav (never a Clear), NEXT_ACTION
 *    Promote/Dismiss (workstreamId omitted when null) + PROMOTED task
 *    line + Open Task nav, unwired face = button hidden (graceful);
 *  - B §31 missing-NA 卡: frozen three lines + CTA face-gated +
 *    inline form (blank submit disabled, create args, cancel, reject
 *    keeps the form + fault);
 *  - 空态: 当前没有需要处理的事件 + 去看工作流进展;
 *  - 导航: HUB project labels / chips → onOpenProject(projectId);
 *    scoped roles → no labels, chips → onGoToWorkstreams;
 *  - the pure helpers (`formatRelativeTime`, `attentionGroupOf`,
 *    `applyAttentionFilters`, `visibleAttentionIds`).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { StrictMode, act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  InterventionStreamPage,
  EMPTY_FILTERS,
  attentionGroupOf,
  applyAttentionFilters,
  formatRelativeTime,
  visibleAttentionIds,
  type InterventionStreamPageProps,
} from '../../src/client/views/shell/intervention-stream.js'
import type {
  AttentionItemDto,
  ClearBlockerResult,
  CreateNextActionResult,
  DismissNextActionResult,
  PromoteNextActionResult,
  QueryAttentionResult,
  UpdateInterventionStateResult,
} from '../../src/shared/rpc-contracts.js'
import {
  ATTN_CLOSED_ONLY_RESULT,
  ATTN_EMPTY_RESULT,
  ATTN_FULL_RESULT,
  ATTN_NO_PENDING_RESULT,
  NOW,
  PROJECTS,
  UPDATE_PENDING_OK,
} from './fixtures.js'

const HOUR = 60 * 60 * 1000

/** A manually-settled promise (the in-flight face pins). */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (err: unknown) => void } {
  let resolve!: (value: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** The mutation faces' payloads are never read by the component — a
 *  placeholder body pins the SUCCESS type, not the wire. */
function dummy<T>(): T {
  return {} as T
}

const makeLoad = (result: QueryAttentionResult): InterventionStreamPageProps['loadAttention'] =>
  vi.fn(async (): Promise<QueryAttentionResult> => result)

/** Render the page with ALL faces wired (the production shape); cases
 *  override what they pin (an `undefined` override = the face unwired). */
function renderStream(
  load: InterventionStreamPageProps['loadAttention'],
  overrides: Partial<InterventionStreamPageProps> = {},
): InterventionStreamPageProps {
  const props: InterventionStreamPageProps = {
    role: 'HUB',
    scopeProjectId: null,
    loadAttention: load,
    projects: PROJECTS,
    updateInterventionState: vi.fn(async (): Promise<UpdateInterventionStateResult> => UPDATE_PENDING_OK),
    onInvestigate: vi.fn(async (): Promise<string> => '只读调查已启动 — 会话 S-INV-1'),
    clearBlocker: vi.fn(async (): Promise<ClearBlockerResult> => dummy()),
    promoteNextAction: vi.fn(async (): Promise<PromoteNextActionResult> => dummy()),
    dismissNextAction: vi.fn(async (): Promise<DismissNextActionResult> => dummy()),
    createNextAction: vi.fn(async (): Promise<CreateNextActionResult> => dummy()),
    onOpenProject: vi.fn(),
    onGoToWorkstreams: vi.fn(),
    ...overrides,
  }
  render(<InterventionStreamPage {...props} />)
  return props
}

/** Wait for the ready face (the h1 page title). */
async function awaitReady(): Promise<void> {
  await screen.findByRole('heading', { name: 'Needs Attention' })
}

/** The one card by its source id (IV cards: data-iv-id; others: data-item-id). */
function cardOf(id: string): HTMLElement {
  const el = document.querySelector(`[data-iv-id="${id}"], [data-item-id="${id}"]`)
  if (el === null) throw new Error(`card ${id} is not rendered`)
  return el as HTMLElement
}

function setSelect(selector: string, value: string): void {
  const el = document.querySelector(selector) as HTMLSelectElement
  fireEvent.change(el, { target: { value } })
}

function options(selector: string): string[] {
  const el = document.querySelector(selector) as HTMLSelectElement
  return Array.from(el.querySelectorAll('option')).map((o) => o.textContent ?? '')
}

/** The visible cards (default view — both non-terminal groups) in
 *  document order. */
function visibleCardIds(): string[] {
  const id = (el: Element): string => el.getAttribute('data-iv-id') ?? el.getAttribute('data-item-id') ?? ''
  return Array.from(document.querySelectorAll('[data-attention-card]')).map(id)
}

afterEach(() => {
  cleanup()
})

// ── the pure helpers ────────────────────────────────────────────────────

describe('formatRelativeTime — 相对时间', () => {
  it('buckets: 刚刚 / N 分钟前 / N 小时前 / N 天前 / absolute past 30 days', () => {
    expect(formatRelativeTime(NOW - 30 * 1000, NOW)).toBe('刚刚')
    expect(formatRelativeTime(NOW - 5 * 60 * 1000, NOW)).toBe('5 分钟前')
    expect(formatRelativeTime(NOW - 2 * HOUR, NOW)).toBe('2 小时前')
    expect(formatRelativeTime(NOW - 5 * 24 * HOUR, NOW)).toBe('5 天前')
    // Past 30 days the relative label is noise → the absolute YYYY-MM-DD.
    const far = formatRelativeTime(NOW - 40 * 24 * HOUR, NOW)
    expect(far).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('attentionGroupOf — B §27.1 group partition', () => {
  it('maps the 8 status words onto the three groups (RECON §27 table)', () => {
    const items = ATTN_FULL_RESULT.items
    const byId = (id: string): AttentionItemDto => items.find((i) => i.sourceId === id) as AttentionItemDto
    expect(attentionGroupOf(byId('IV-1'))).toBe('OPEN') // IV OPEN
    expect(attentionGroupOf(byId('BLK-1'))).toBe('OPEN') // explicit BLK ACTIVE
    expect(attentionGroupOf(byId('DERIVED-1'))).toBe('OPEN') // derived const ACTIVE
    expect(attentionGroupOf(byId('NA-1'))).toBe('OPEN') // NA PROPOSED — non-terminal
    expect(attentionGroupOf(byId('MISSING-NA-WS-3'))).toBe('OPEN') // missing const OPEN
    expect(attentionGroupOf(byId('IV-2'))).toBe('PENDING') // PENDING IV only
    expect(attentionGroupOf(byId('IV-3'))).toBe('CLOSED') // IV CLOSED
    expect(attentionGroupOf(byId('BLK-2'))).toBe('CLOSED') // BLK CLEARED
    expect(attentionGroupOf(byId('NA-2'))).toBe('CLOSED') // NA PROMOTED
    expect(attentionGroupOf({ ...byId('NA-1'), status: 'DISMISSED' })).toBe('CLOSED')
  })
})

describe('applyAttentionFilters — ADJ-9 exact match', () => {
  it('scope + five axes: exact match over the wire words, host order kept', () => {
    const items = ATTN_FULL_RESULT.items
    const ids = (r: readonly AttentionItemDto[]): string[] => r.map((i) => i.sourceId)
    expect(ids(applyAttentionFilters(items, null, EMPTY_FILTERS))).toEqual([
      'IV-1',
      'MISSING-NA-WS-3',
      'IV-2',
      'BLK-1',
      'DERIVED-1',
      'NA-1',
      'NA-0',
      'BLK-2',
      'NA-2',
      'IV-3',
    ])
    expect(ids(applyAttentionFilters(items, 'PRJ-1', EMPTY_FILTERS))).toEqual([
      'IV-1',
      'IV-2',
      'BLK-1',
      'DERIVED-1',
      'IV-3',
    ])
    expect(ids(applyAttentionFilters(items, null, { ...EMPTY_FILTERS, workstream: 'WS-1' }))).toEqual([
      'IV-1',
      'IV-2',
      'DERIVED-1',
    ])
    expect(ids(applyAttentionFilters(items, null, { ...EMPTY_FILTERS, type: 'EXPLICIT_BLOCKER' }))).toEqual([
      'BLK-1',
      'BLK-2',
    ])
    expect(ids(applyAttentionFilters(items, null, { ...EMPTY_FILTERS, status: 'ACTIVE' }))).toEqual([
      'BLK-1',
      'DERIVED-1',
    ])
    expect(ids(applyAttentionFilters(items, null, { ...EMPTY_FILTERS, status: 'PROPOSED' }))).toEqual(['NA-1', 'NA-0'])
    expect(ids(applyAttentionFilters(items, null, { ...EMPTY_FILTERS, priority: 'HIGH' }))).toEqual([
      'IV-1',
      'MISSING-NA-WS-3',
      'IV-2',
    ])
    expect(ids(applyAttentionFilters(items, 'PRJ-2', { ...EMPTY_FILTERS, workstream: 'WS-9' }))).toEqual([
      'NA-1',
      'NA-2',
    ])
  })
})

describe('visibleAttentionIds — the visible-card projection', () => {
  it('DEFAULT = OPEN group + PENDING in host order; a segment narrows to its group', () => {
    const items = ATTN_FULL_RESULT.items
    expect(visibleAttentionIds(items, null, EMPTY_FILTERS, 'DEFAULT')).toEqual([
      'IV-1',
      'MISSING-NA-WS-3',
      'BLK-1',
      'DERIVED-1',
      'NA-1',
      'NA-0',
      'IV-2',
    ])
    expect(visibleAttentionIds(items, null, EMPTY_FILTERS, 'OPEN')).toEqual([
      'IV-1',
      'MISSING-NA-WS-3',
      'BLK-1',
      'DERIVED-1',
      'NA-1',
      'NA-0',
    ])
    expect(visibleAttentionIds(items, null, EMPTY_FILTERS, 'PENDING')).toEqual(['IV-2'])
    expect(visibleAttentionIds(items, 'PRJ-2', EMPTY_FILTERS, 'DEFAULT')).toEqual([
      'MISSING-NA-WS-3',
      'NA-1',
      'NA-0',
    ])
    expect(visibleAttentionIds(items, 'PRJ-2', { ...EMPTY_FILTERS, type: 'INTERVENTION' }, 'DEFAULT')).toEqual([])
  })
})

// ── the ONE fetch lifecycle ─────────────────────────────────────────────

describe('InterventionStreamPage — 单一 fetch 生命周期', () => {
  it('HUB mount: loading face → ready; exactly one {limit:200} fetch', async () => {
    const d = deferred<QueryAttentionResult>()
    const load = vi.fn(() => d.promise)
    renderStream(load)
    expect(screen.getByText('正在加载重要事件…')).toBeDefined()
    expect(document.querySelector('[data-attention-stream]')?.getAttribute('data-phase')).toBe('loading')
    d.resolve(ATTN_FULL_RESULT)
    await awaitReady()
    expect(load).toHaveBeenCalledTimes(1)
    expect(load).toHaveBeenCalledWith({ limit: 200 })
    expect(screen.getByRole('heading', { name: 'Needs Attention' })).toBeDefined()
    expect(document.querySelector('[data-attention-stream]')?.getAttribute('data-role')).toBe('HUB')
  })

  it('a scoped role fetches {projectId, limit:200} (ADJ-4 mgmt leg) and filters client-side', async () => {
    const d = deferred<QueryAttentionResult>()
    const load = vi.fn(() => d.promise)
    renderStream(load, { role: 'MANAGED', scopeProjectId: 'PRJ-1' })
    d.resolve(ATTN_FULL_RESULT)
    await awaitReady()
    expect(load).toHaveBeenCalledTimes(1)
    expect(load).toHaveBeenCalledWith({ projectId: 'PRJ-1', limit: 200 })
    // Other projects' items never render (限本项目).
    expect(document.querySelector('[data-item-id="NA-1"]')).toBeNull()
    expect(document.querySelector('[data-iv-id="IV-1"]')).not.toBeNull()
  })

  it('a StrictMode double-effect issues exactly one fetch (in-flight dedupe)', async () => {
    const d = deferred<QueryAttentionResult>()
    const load = vi.fn(() => d.promise)
    const props: InterventionStreamPageProps = {
      role: 'HUB',
      scopeProjectId: null,
      loadAttention: load,
      projects: PROJECTS,
      updateInterventionState: vi.fn(async (): Promise<UpdateInterventionStateResult> => UPDATE_PENDING_OK),
      onInvestigate: vi.fn(async (): Promise<string> => 'x'),
      onOpenProject: vi.fn(),
      onGoToWorkstreams: vi.fn(),
    }
    render(
      <StrictMode>
        <InterventionStreamPage {...props} />
      </StrictMode>,
    )
    await act(async () => {})
    expect(load).toHaveBeenCalledTimes(1)
    expect(load).toHaveBeenCalledWith({ limit: 200 })
    d.resolve(ATTN_FULL_RESULT)
    await awaitReady()
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('initial rejection → failed face; 刷新 retries and recovers', async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce(ATTN_FULL_RESULT)
    renderStream(load)
    await screen.findByRole('alert')
    expect(screen.getByText('Failed to load the attention list.')).toBeDefined()
    expect(document.querySelector('[data-attention-stream]')?.getAttribute('data-phase')).toBe('failed')
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    await awaitReady()
    expect(load).toHaveBeenCalledTimes(2)
    expect(load).toHaveBeenLastCalledWith({ limit: 200 })
  })

  it('refresh is stale-while-revalidate: a failure keeps the stale data + the fault line', async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce(ATTN_FULL_RESULT)
      .mockRejectedValueOnce(new Error('boom'))
    renderStream(load)
    await awaitReady()
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    await screen.findByText('刷新失败：boom')
    expect(document.querySelector('[data-attention-stream]')?.getAttribute('data-phase')).toBe('ready')
    expect(document.querySelector('[data-iv-id="IV-1"]')).not.toBeNull()
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('a refresh while one is in flight does not stack a second fetch', async () => {
    const first = deferred<QueryAttentionResult>()
    const second = deferred<QueryAttentionResult>()
    const load = vi.fn(() => first.promise)
    renderStream(load)
    first.resolve(ATTN_FULL_RESULT)
    await awaitReady()
    load.mockImplementation(() => second.promise)
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    await act(async () => {})
    expect(load).toHaveBeenCalledTimes(2)
    second.resolve(ATTN_FULL_RESULT)
    await act(async () => {})
    expect(load).toHaveBeenCalledTimes(2)
  })
})

// ── the three groups + the 状态段 segments ──────────────────────────────

describe('InterventionStreamPage — 三段组 + 状态段', () => {
  it('default view: OPEN/ACTIVE + PENDING sections in host order; the folded section stays hidden', async () => {
    renderStream(makeLoad(ATTN_FULL_RESULT))
    await awaitReady()
    const open = document.querySelector('[data-attention-group="OPEN"]')
    const pending = document.querySelector('[data-attention-group="PENDING"]')
    expect(open).not.toBeNull()
    expect(pending).not.toBeNull()
    expect(open!.compareDocumentPosition(pending!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(document.querySelector('[data-attention-closed-section]')).toBeNull()
    // The host order is never re-sorted (INV-ATTN-1): rank order first.
    const id = (el: Element): string => el.getAttribute('data-iv-id') ?? el.getAttribute('data-item-id') ?? ''
    expect(Array.from(open!.querySelectorAll('[data-attention-card]')).map(id)).toEqual([
      'IV-1',
      'MISSING-NA-WS-3',
      'BLK-1',
      'DERIVED-1',
      'NA-1',
      'NA-0',
    ])
    expect(Array.from(pending!.querySelectorAll('[data-attention-card]')).map(id)).toEqual(['IV-2'])
  })

  it('已关闭 expands LOCALLY (no second fetch); terminals keep the host createdAt-desc order; toggles back', async () => {
    const load = makeLoad(ATTN_FULL_RESULT)
    renderStream(load)
    await awaitReady()
    fireEvent.click(screen.getByRole('button', { name: '已关闭 ▾' }))
    const closed = document.querySelector('[data-attention-closed-section]')
    expect(closed).not.toBeNull()
    expect(document.querySelector('[data-attention-group-heading="CLOSED"]')?.textContent).toBe(
      'CLOSED / CLEARED / DISMISSED',
    )
    const id = (el: Element): string => el.getAttribute('data-iv-id') ?? el.getAttribute('data-item-id') ?? ''
    expect(Array.from(closed!.querySelectorAll('[data-attention-card]')).map(id)).toEqual(['BLK-2', 'NA-2', 'IV-3'])
    expect(load).toHaveBeenCalledTimes(1) // the terminals ride the SAME fetch
    fireEvent.click(screen.getByRole('button', { name: '已关闭 ▴' }))
    expect(document.querySelector('[data-attention-closed-section]')).toBeNull()
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('an empty folded section shows 暂无已关闭事件', async () => {
    renderStream(makeLoad(ATTN_NO_PENDING_RESULT))
    await awaitReady()
    fireEvent.click(screen.getByRole('button', { name: '已关闭 ▾' }))
    expect(screen.getByText('暂无已关闭事件')).toBeDefined()
    expect(document.querySelector('[data-attention-closed-empty]')).not.toBeNull()
  })

  it('a terminals-only feed: default view = 空态 face, the folded section carries the terminals', async () => {
    const load = makeLoad(ATTN_CLOSED_ONLY_RESULT)
    renderStream(load)
    await awaitReady()
    expect(document.querySelector('[data-attention-empty]')).not.toBeNull()
    expect(screen.getByRole('button', { name: '待处理 0' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '已关闭 ▾' }))
    const closed = document.querySelector('[data-attention-closed-section]')
    expect(closed).not.toBeNull()
    const id = (el: Element): string => el.getAttribute('data-iv-id') ?? el.getAttribute('data-item-id') ?? ''
    expect(Array.from(closed!.querySelectorAll('[data-attention-card]')).map(id)).toEqual(['BLK-2', 'NA-2', 'IV-3'])
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('待处理 segment narrows to the OPEN group; re-click restores the union', async () => {
    renderStream(makeLoad(ATTN_FULL_RESULT))
    await awaitReady()
    fireEvent.click(screen.getByRole('button', { name: '待处理 6' }))
    expect(screen.getByRole('button', { name: '待处理 6' }).getAttribute('aria-pressed')).toBe('true')
    expect(document.querySelector('[data-attention-group="OPEN"]')).not.toBeNull()
    expect(document.querySelector('[data-attention-group="PENDING"]')).toBeNull()
    expect(document.querySelector('[data-iv-id="IV-2"]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '待处理 6' }))
    expect(screen.getByRole('button', { name: '待处理 6' }).getAttribute('aria-pressed')).toBe('false')
    expect(document.querySelector('[data-attention-group="PENDING"]')).not.toBeNull()
  })

  it('待确认 segment narrows to the PENDING group only', async () => {
    renderStream(makeLoad(ATTN_FULL_RESULT))
    await awaitReady()
    fireEvent.click(screen.getByRole('button', { name: '待确认 1' }))
    expect(document.querySelector('[data-attention-group="OPEN"]')).toBeNull()
    const pending = document.querySelector('[data-attention-group="PENDING"]')
    expect(pending).not.toBeNull()
    const id = (el: Element): string => el.getAttribute('data-iv-id') ?? el.getAttribute('data-item-id') ?? ''
    expect(Array.from(pending!.querySelectorAll('[data-attention-card]')).map(id)).toEqual(['IV-2'])
  })

  it('a group with no (filtered) items shows its 暂无 copy', async () => {
    renderStream(makeLoad(ATTN_NO_PENDING_RESULT))
    await awaitReady()
    expect(screen.getByText('暂无待确认事件')).toBeDefined()
    expect(document.querySelector('[data-attention-group-empty="PENDING"]')).not.toBeNull()
  })

  it('a filter matching only terminals collapses the default view to the 空态 face', async () => {
    renderStream(makeLoad(ATTN_FULL_RESULT))
    await awaitReady()
    setSelect('[data-attention-filter="status"]', 'CLOSED')
    expect(screen.getByText('当前没有需要处理的事件')).toBeDefined()
    expect(document.querySelector('[data-attention-empty]')).not.toBeNull()
    expect(document.querySelector('[data-attention-group="OPEN"]')).toBeNull()
  })
})

// ── the B §27.1 filters ─────────────────────────────────────────────────

describe('InterventionStreamPage — B §27.1 过滤器×5', () => {
  it('renders the five filters with their locked value sets', async () => {
    renderStream(makeLoad(ATTN_FULL_RESULT))
    await awaitReady()
    expect(options('[data-attention-filter="project"]')).toEqual([
      'All',
      '机器人视觉定位系统 (PRJ-1)',
      '独立实验 (PRJ-2)',
    ])
    // [Workstream] is derived from the fetched items (first appearance —
    // rank order; null ws ids never listed) — zero new wire.
    expect(options('[data-attention-filter="workstream"]')).toEqual(['All', 'WS-1', 'WS-3', 'WS-2', 'WS-9'])
    expect(options('[data-attention-filter="type"]')).toEqual([
      'All',
      'Intervention',
      'Blocker',
      'Derived Blocker',
      'Next Action',
      'Missing Next Action',
    ])
    // The 8-value wire union — the raw words, no semantic normalization.
    expect(options('[data-attention-filter="status"]')).toEqual([
      'All',
      'OPEN',
      'PENDING',
      'CLOSED',
      'ACTIVE',
      'CLEARED',
      'PROPOSED',
      'PROMOTED',
      'DISMISSED',
    ])
    expect(options('[data-attention-filter="priority"]')).toEqual(['All', 'High', 'Medium', 'Low'])
  })

  it('[Project] narrows the cards; [Workstream] cascades and auto-resets on project change', async () => {
    renderStream(makeLoad(ATTN_FULL_RESULT))
    await awaitReady()
    setSelect('[data-attention-filter="workstream"]', 'WS-1')
    expect(visibleCardIds()).toEqual(['IV-1', 'DERIVED-1', 'IV-2'])
    // Switch project → the PRJ-1 workstream is no longer offered.
    setSelect('[data-attention-filter="project"]', 'PRJ-2')
    expect((document.querySelector('[data-attention-filter="workstream"]') as HTMLSelectElement).value).toBe('')
    expect(options('[data-attention-filter="workstream"]')).toEqual(['All', 'WS-3', 'WS-9'])
    expect(visibleCardIds()).toEqual(['MISSING-NA-WS-3', 'NA-1', 'NA-0'])
  })

  it('[Type]/[Status]/[Priority] are single-select exact matches over the wire words', async () => {
    renderStream(makeLoad(ATTN_FULL_RESULT))
    await awaitReady()
    setSelect('[data-attention-filter="type"]', 'INTERVENTION')
    expect(visibleCardIds()).toEqual(['IV-1', 'IV-2'])
    setSelect('[data-attention-filter="type"]', '')
    setSelect('[data-attention-filter="status"]', 'ACTIVE')
    expect(visibleCardIds()).toEqual(['BLK-1', 'DERIVED-1'])
    setSelect('[data-attention-filter="status"]', '')
    setSelect('[data-attention-filter="priority"]', 'HIGH')
    expect(visibleCardIds()).toEqual(['IV-1', 'MISSING-NA-WS-3', 'IV-2'])
  })

  it('a scoped role lists ALL plane projects but its scope stays authoritative', async () => {
    renderStream(makeLoad(ATTN_FULL_RESULT), { role: 'MANAGED', scopeProjectId: 'PRJ-1' })
    await awaitReady()
    expect(options('[data-attention-filter="project"]')).toEqual([
      'All',
      '机器人视觉定位系统 (PRJ-1)',
      '独立实验 (PRJ-2)',
    ])
    // Picking the other project = empty (the scope filter still applies).
    setSelect('[data-attention-filter="project"]', 'PRJ-2')
    expect(screen.getByText('当前没有需要处理的事件')).toBeDefined()
  })
})

// ── the IV card: the t52 surface + the frozen §13 machine ───────────────

describe('InterventionStreamPage — IV 卡 (t52 面 + §13 机器)', () => {
  it('IV OPEN card: the t52 surface + the B §27.2 common fields', async () => {
    renderStream(makeLoad(ATTN_FULL_RESULT))
    await awaitReady()
    const card = cardOf('IV-1')
    expect(card.getAttribute('data-attention-card')).not.toBeNull()
    expect(card.getAttribute('data-iv-status')).toBe('OPEN')
    expect(card.getAttribute('data-iv-origin')).toBe('AUTO_FLOODING')
    expect(card.getAttribute('data-iv-project')).toBe('PRJ-1')
    expect(card.querySelector('[data-iv-title]')?.textContent).toBe('标定管线阻塞')
    // HUB: the project label (the projects map's displayName).
    const label = card.querySelector('[data-iv-project-label]')
    expect(label?.textContent).toBe('机器人视觉定位系统')
    expect(label?.getAttribute('title')).toBe('进入 机器人视觉定位系统')
    expect(card.querySelector('[data-iv-origin-badge]')?.textContent).toBe('自动洪泛检测')
    const chip = card.querySelector('[data-iv-ws-chip]')
    expect(chip?.getAttribute('data-iv-ws-chip')).toBe('WS-1')
    expect(chip?.textContent).toBe('WS-1')
    expect(card.querySelector('[data-iv-time]')?.textContent).toBe(formatRelativeTime(NOW - 2 * HOUR))
    // Additive B §27.2 common fields (the t52 surface above untouched).
    expect(card.querySelector('[data-iv-kind-badge]')?.textContent).toBe('Intervention')
    expect(card.querySelector('[data-iv-status-badge]')?.textContent).toBe('OPEN')
    expect(card.querySelector('[data-iv-priority-badge]')?.textContent).toBe('High')
    expect(card.querySelector('[data-iv-reason]')?.textContent).toBe('Why shown here: 自动洪泛：3 分钟内 12 次告警')
    // The OPEN control row (the t52 matrix).
    expect(card.querySelector('[data-iv-question]')?.getAttribute('placeholder')).toBe('调查问题（一键调查必填）')
    expect(card.querySelector('[data-iv-note]')?.getAttribute('placeholder')).toBe('关闭备注（必填）')
    for (const a of ['investigate', 'pending', 'close']) {
      expect(card.querySelector(`[data-iv-action="${a}"]`)).not.toBeNull()
    }
    expect(card.querySelector('[data-iv-action="confirm-close"]')).toBeNull()
    expect(card.querySelector('[data-iv-action="reopen"]')).toBeNull()
    // B §28 关闭人工责任 prompt (the attention.closeNotePrompt t() key) —
    // the new chrome line next to the note input (the legacy placeholder
    // above stays verbatim).
    const prompt = card.querySelector('[data-iv-close-note-prompt]')
    expect(prompt?.textContent).toBe(
      'Record the human-handling decision that closes this item (not a claim that the research question itself is resolved).',
    )
  })

  it('一键调查 with a blank question → fault + zero calls', async () => {
    const props = renderStream(makeLoad(ATTN_FULL_RESULT))
    await awaitReady()
    fireEvent.click(cardOf('IV-1').querySelector('[data-iv-action="investigate"]') as HTMLElement)
    expect(cardOf('IV-1').querySelector('[data-iv-fault]')?.textContent).toBe('一键调查请填写调查问题')
    expect(props.onInvestigate).not.toHaveBeenCalled()
  })

  it('一键调查 fires {id,title}+question; success → the investigated line', async () => {
    const d = deferred<string>()
    const onInv = vi.fn(() => d.promise)
    const props = renderStream(makeLoad(ATTN_FULL_RESULT), { onInvestigate: onInv })
    await awaitReady()
    fireEvent.change(cardOf('IV-1').querySelector('[data-iv-question]') as HTMLInputElement, {
      target: { value: '为什么标定卡住了？' },
    })
    fireEvent.click(cardOf('IV-1').querySelector('[data-iv-action="investigate"]') as HTMLElement)
    expect(onInv).toHaveBeenCalledWith({ id: 'IV-1', title: '标定管线阻塞' }, '为什么标定卡住了？')
    expect(cardOf('IV-1').querySelector('[data-iv-action="investigate"]')?.textContent).toBe('调查中…')
    await act(async () => {
      d.resolve('只读调查已启动 — 会话 S-INV-1')
    })
    expect(cardOf('IV-1').querySelector('[data-iv-investigated]')?.textContent).toBe(
      '只读调查已启动 — 会话 S-INV-1',
    )
  })

  it('一键调查 with a rejection shows the fault line', async () => {
    renderStream(makeLoad(ATTN_FULL_RESULT), {
      onInvestigate: vi.fn(async (): Promise<string> => {
        throw new Error('调查器拒绝')
      }),
    })
    await awaitReady()
    fireEvent.change(cardOf('IV-1').querySelector('[data-iv-question]') as HTMLInputElement, {
      target: { value: 'q' },
    })
    fireEvent.click(cardOf('IV-1').querySelector('[data-iv-action="investigate"]') as HTMLElement)
    await screen.findByText('调查器拒绝')
    expect(cardOf('IV-1').querySelector('[data-iv-fault]')).not.toBeNull()
  })

  it('标记处理中: OPEN→PENDING args (no resolutionNote) + a success re-fetch', async () => {
    const load = makeLoad(ATTN_FULL_RESULT)
    const props = renderStream(load)
    await awaitReady()
    fireEvent.click(cardOf('IV-1').querySelector('[data-iv-action="pending"]') as HTMLElement)
    expect(props.updateInterventionState).toHaveBeenCalledWith({
      interventionId: 'IV-1',
      status: 'PENDING',
      projectId: 'PRJ-1',
    })
    await act(async () => {})
    expect(load).toHaveBeenCalledTimes(2) // success re-fetches (no local patch)
  })

  it('关闭 with a blank note → fault + zero calls', async () => {
    const props = renderStream(makeLoad(ATTN_FULL_RESULT))
    await awaitReady()
    fireEvent.click(cardOf('IV-1').querySelector('[data-iv-action="close"]') as HTMLElement)
    expect(cardOf('IV-1').querySelector('[data-iv-fault]')?.textContent).toBe('关闭时请填写处理备注')
    expect(props.updateInterventionState).not.toHaveBeenCalled()
  })

  it('关闭 fires with the trimmed resolutionNote + a success re-fetch', async () => {
    const load = makeLoad(ATTN_FULL_RESULT)
    const props = renderStream(load)
    await awaitReady()
    fireEvent.change(cardOf('IV-1').querySelector('[data-iv-note]') as HTMLInputElement, {
      target: { value: '  已处理  ' },
    })
    fireEvent.click(cardOf('IV-1').querySelector('[data-iv-action="close"]') as HTMLElement)
    expect(props.updateInterventionState).toHaveBeenCalledWith({
      interventionId: 'IV-1',
      status: 'CLOSED',
      projectId: 'PRJ-1',
      resolutionNote: '已处理',
    })
    await act(async () => {})
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('a rejected transition shows the fault and does NOT re-fetch', async () => {
    const load = makeLoad(ATTN_FULL_RESULT)
    renderStream(load, {
      updateInterventionState: vi.fn(async (): Promise<UpdateInterventionStateResult> => {
        throw new Error('状态机拒绝')
      }),
    })
    await awaitReady()
    fireEvent.change(cardOf('IV-1').querySelector('[data-iv-note]') as HTMLInputElement, {
      target: { value: 'note' },
    })
    fireEvent.click(cardOf('IV-1').querySelector('[data-iv-action="close"]') as HTMLElement)
    await screen.findByText('状态机拒绝')
    expect(cardOf('IV-1').querySelector('[data-iv-fault]')).not.toBeNull()
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('PENDING card: 确认关闭 carries the note; 重开 fires OPEN without one', async () => {
    const load = makeLoad(ATTN_FULL_RESULT)
    const props = renderStream(load)
    await awaitReady()
    const card = cardOf('IV-2')
    // The PENDING control row (no investigate/pending/close tokens).
    for (const a of ['investigate', 'pending', 'close']) {
      expect(card.querySelector(`[data-iv-action="${a}"]`)).toBeNull()
    }
    expect(card.querySelector('[data-iv-action="confirm-close"]')).not.toBeNull()
    expect(card.querySelector('[data-iv-action="reopen"]')).not.toBeNull()
    fireEvent.change(card.querySelector('[data-iv-note]') as HTMLInputElement, {
      target: { value: '复核完成' },
    })
    fireEvent.click(card.querySelector('[data-iv-action="confirm-close"]') as HTMLElement)
    expect(props.updateInterventionState).toHaveBeenCalledWith({
      interventionId: 'IV-2',
      status: 'CLOSED',
      projectId: 'PRJ-1',
      resolutionNote: '复核完成',
    })
    await act(async () => {})
    fireEvent.click(cardOf('IV-2').querySelector('[data-iv-action="reopen"]') as HTMLElement)
    expect(props.updateInterventionState).toHaveBeenLastCalledWith({
      interventionId: 'IV-2',
      status: 'OPEN',
      projectId: 'PRJ-1',
    })
  })

  it('a CLOSED IV card (folded section) is terminal — no controls', async () => {
    renderStream(makeLoad(ATTN_FULL_RESULT))
    await awaitReady()
    fireEvent.click(screen.getByRole('button', { name: '已关闭 ▾' }))
    const card = cardOf('IV-3')
    expect(card.querySelector('[data-iv-action]')).toBeNull()
    expect(card.querySelector('[data-iv-note]')).toBeNull()
    expect(card.querySelector('[data-iv-question]')).toBeNull()
    // no controls → no 关闭人工责任 prompt line either
    expect(card.querySelector('[data-iv-close-note-prompt]')).toBeNull()
  })
})

// ── the non-IV cards: B §29/§30/§31 ─────────────────────────────────────

describe('InterventionStreamPage — 非 IV 卡 (B §29/§30/§31)', () => {
  it('EXPLICIT_BLOCKER card: common fields + [Clear] via the face + a success re-fetch', async () => {
    const load = makeLoad(ATTN_FULL_RESULT)
    const props = renderStream(load)
    await awaitReady()
    const card = cardOf('BLK-1')
    expect(card.getAttribute('data-kind')).toBe('EXPLICIT_BLOCKER')
    expect(card.getAttribute('data-item-status')).toBe('ACTIVE')
    expect(card.getAttribute('data-item-project')).toBe('PRJ-1')
    expect(card.querySelector('[data-item-kind-badge]')?.textContent).toBe('Blocker')
    expect(card.querySelector('[data-item-status-badge]')?.textContent).toBe('ACTIVE')
    expect(card.querySelector('[data-item-priority-badge]')?.textContent).toBe('Medium')
    const chip = card.querySelector('[data-item-ws-chip]')
    expect(chip?.getAttribute('data-item-ws-chip')).toBe('WS-2')
    expect(card.querySelector('[data-item-time]')?.textContent).toBe(formatRelativeTime(NOW - 5 * HOUR))
    expect(card.querySelector('[data-item-reason]')?.textContent).toBe('Why shown here: 人工登记的阻塞')
    const clear = card.querySelector('[data-item-action="clearBlocker"]') as HTMLElement
    expect(clear.textContent).toBe('Clear')
    fireEvent.click(clear)
    expect(props.clearBlocker).toHaveBeenCalledWith({ blockerId: 'BLK-1', projectId: 'PRJ-1' })
    await act(async () => {})
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('an unwired mutation face hides its button (graceful — nav tokens stay)', async () => {
    renderStream(makeLoad(ATTN_FULL_RESULT), {
      clearBlocker: undefined,
      promoteNextAction: undefined,
      dismissNextAction: undefined,
      createNextAction: undefined,
    })
    await awaitReady()
    expect(cardOf('BLK-1').querySelector('[data-item-action="clearBlocker"]')).toBeNull()
    expect(cardOf('NA-1').querySelector('[data-item-action="promoteNextAction"]')).toBeNull()
    expect(cardOf('NA-1').querySelector('[data-item-action="dismissNextAction"]')).toBeNull()
    expect(cardOf('MISSING-NA-WS-3').querySelector('[data-missing-cta]')).toBeNull()
    // Pure client navigation needs no face.
    expect(cardOf('NA-1').querySelector('[data-item-action="openWorkstream"]')).not.toBeNull()
  })

  it('DERIVED_BLOCKER card: the cause line + Open Cause nav (never a Clear)', async () => {
    const props = renderStream(makeLoad(ATTN_FULL_RESULT))
    await awaitReady()
    const card = cardOf('DERIVED-1')
    expect(card.getAttribute('data-kind')).toBe('DERIVED_BLOCKER')
    expect(card.querySelector('[data-item-kind-badge]')?.textContent).toBe('Derived Blocker')
    expect(card.querySelector('[data-item-cause]')?.textContent).toBe('打开源干预 IV-1')
    expect(card.querySelector('[data-item-action="clearBlocker"]')).toBeNull()
    const nav = card.querySelector('[data-item-action="openCause"]') as HTMLElement
    expect(nav.textContent).toBe('Open Cause')
    fireEvent.click(nav)
    expect(props.onOpenProject).toHaveBeenCalledWith('PRJ-1')
  })

  it('NEXT_ACTION card: Promote/Dismiss args; workstreamId omitted when null', async () => {
    const load = makeLoad(ATTN_FULL_RESULT)
    const props = renderStream(load)
    await awaitReady()
    const na1 = cardOf('NA-1')
    expect(na1.querySelector('[data-item-kind-badge]')?.textContent).toBe('Next Action')
    expect(na1.querySelector('[data-item-status-badge]')?.textContent).toBe('PROPOSED')
    fireEvent.click(na1.querySelector('[data-item-action="promoteNextAction"]') as HTMLElement)
    expect(props.promoteNextAction).toHaveBeenCalledWith({
      nextActionId: 'NA-1',
      workstreamId: 'WS-9',
      projectId: 'PRJ-2',
    })
    await act(async () => {}) // the row is busy until the promise settles
    // The workstream-less NA: the arg is OMITTED (never a null on the wire).
    const na0 = cardOf('NA-0')
    expect(na0.querySelector('[data-item-ws-chip]')).toBeNull()
    fireEvent.click(na0.querySelector('[data-item-action="promoteNextAction"]') as HTMLElement)
    expect(props.promoteNextAction).toHaveBeenLastCalledWith({ nextActionId: 'NA-0', projectId: 'PRJ-2' })
    await act(async () => {})
    fireEvent.click(na0.querySelector('[data-item-action="dismissNextAction"]') as HTMLElement)
    expect(props.dismissNextAction).toHaveBeenCalledWith({ nextActionId: 'NA-0', projectId: 'PRJ-2' })
    await act(async () => {})
    expect(load).toHaveBeenCalledTimes(4) // mount + 2 promote + 1 dismiss re-fetches
  })

  it('a PROMOTED NEXT_ACTION (folded): the Task id line + the Open Task nav', async () => {
    const props = renderStream(makeLoad(ATTN_FULL_RESULT))
    await awaitReady()
    fireEvent.click(screen.getByRole('button', { name: '已关闭 ▾' }))
    const card = cardOf('NA-2')
    expect(card.getAttribute('data-item-status')).toBe('PROMOTED')
    expect(card.querySelector('[data-item-task]')?.textContent).toBe('TASK-77')
    const nav = card.querySelector('[data-item-action="openTask"]') as HTMLElement
    expect(nav.textContent).toBe('Open Task')
    fireEvent.click(nav)
    expect(props.onOpenProject).toHaveBeenCalledWith('PRJ-2')
  })

  it('missing-NA card: the B §31 frozen three lines + the face-gated CTA', async () => {
    renderStream(makeLoad(ATTN_FULL_RESULT))
    await awaitReady()
    const card = cardOf('MISSING-NA-WS-3')
    expect(card.getAttribute('data-kind')).toBe('MISSING_NEXT_ACTION')
    expect(card.getAttribute('data-item-id')).toBe('MISSING-NA-WS-3')
    expect(card.querySelector('[data-item-title]')?.textContent).toBe('Missing Next Action')
    expect(card.querySelector('[data-missing-body]')?.textContent).toBe(
      'This Workstream has an active objective but no promoted Next Action.',
    )
    const cta = card.querySelector('[data-missing-cta]') as HTMLElement
    expect(cta.textContent).toBe('Create Next Action')
    expect(card.querySelector('[data-item-ws-chip]')?.getAttribute('data-item-ws-chip')).toBe('WS-3')
  })

  it('missing-NA: CTA → inline form; blank submit disabled; create args; success closes the form + re-fetches', async () => {
    const load = makeLoad(ATTN_FULL_RESULT)
    const props = renderStream(load)
    await awaitReady()
    fireEvent.click(cardOf('MISSING-NA-WS-3').querySelector('[data-missing-cta]') as HTMLElement)
    const form = cardOf('MISSING-NA-WS-3').querySelector('[data-missing-form]')
    expect(form).not.toBeNull()
    const statement = form!.querySelector('[data-missing-statement]') as HTMLInputElement
    expect(statement.getAttribute('placeholder')).toBe('Statement')
    const create = form!.querySelector('[data-missing-create]') as HTMLButtonElement
    expect(create.textContent).toBe('Create')
    expect(create.disabled).toBe(true)
    fireEvent.change(statement, { target: { value: '  补一条下一步  ' } })
    const requery = cardOf('MISSING-NA-WS-3').querySelector('[data-missing-create]') as HTMLButtonElement
    expect(requery.disabled).toBe(false)
    fireEvent.click(requery)
    expect(props.createNextAction).toHaveBeenCalledWith({
      workstreamId: 'WS-3',
      statement: '补一条下一步',
      projectId: 'PRJ-2',
    })
    await act(async () => {})
    expect(cardOf('MISSING-NA-WS-3').querySelector('[data-missing-form]')).toBeNull()
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('missing-NA: cancel closes the form; a rejection keeps it open + the fault line', async () => {
    renderStream(makeLoad(ATTN_FULL_RESULT), {
      createNextAction: vi.fn(async (): Promise<CreateNextActionResult> => {
        throw new Error('创建被拒绝')
      }),
    })
    await awaitReady()
    fireEvent.click(cardOf('MISSING-NA-WS-3').querySelector('[data-missing-cta]') as HTMLElement)
    let card = cardOf('MISSING-NA-WS-3')
    fireEvent.change(card.querySelector('[data-missing-statement]') as HTMLInputElement, {
      target: { value: 'x' },
    })
    fireEvent.click(cardOf('MISSING-NA-WS-3').querySelector('[data-missing-create]') as HTMLElement)
    await screen.findByText('创建被拒绝')
    expect(cardOf('MISSING-NA-WS-3').querySelector('[data-item-fault]')).not.toBeNull()
    expect(cardOf('MISSING-NA-WS-3').querySelector('[data-missing-form]')).not.toBeNull()
    card = cardOf('MISSING-NA-WS-3')
    expect(card.querySelector('[data-missing-cancel]')?.textContent).toBe('Cancel')
    fireEvent.click(card.querySelector('[data-missing-cancel]') as HTMLElement)
    expect(cardOf('MISSING-NA-WS-3').querySelector('[data-missing-form]')).toBeNull()
    expect(cardOf('MISSING-NA-WS-3').querySelector('[data-missing-cta]')).not.toBeNull()
  })
})

// ── the 空态 face ────────────────────────────────────────────────────────

describe('InterventionStreamPage — 空态', () => {
  it('an empty list → 当前没有需要处理的事件 + 去看工作流进展', async () => {
    const props = renderStream(makeLoad(ATTN_EMPTY_RESULT))
    await awaitReady()
    expect(document.querySelector('[data-attention-empty]')).not.toBeNull()
    expect(screen.getByText('当前没有需要处理的事件')).toBeDefined()
    expect(screen.getByText(/一键调查/)).toBeDefined() // the hint line
    expect(screen.getByRole('button', { name: '待处理 0' })).toBeDefined()
    expect(screen.getByRole('button', { name: '待确认 0' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '去看工作流进展' }))
    expect(props.onGoToWorkstreams).toHaveBeenCalledTimes(1)
  })
})

// ── the navigation (HUB vs scoped roles) ────────────────────────────────

describe('InterventionStreamPage — 导航 (B §4.4)', () => {
  it('HUB: project labels + workstream chips navigate to the item project', async () => {
    const props = renderStream(makeLoad(ATTN_FULL_RESULT))
    await awaitReady()
    fireEvent.click(cardOf('IV-1').querySelector('[data-iv-project-label]') as HTMLElement)
    expect(props.onOpenProject).toHaveBeenCalledWith('PRJ-1')
    fireEvent.click(cardOf('IV-1').querySelector('[data-iv-ws-chip]') as HTMLElement)
    expect(props.onOpenProject).toHaveBeenLastCalledWith('PRJ-1')
    fireEvent.click(cardOf('BLK-1').querySelector('[data-item-project-label]') as HTMLElement)
    expect(props.onOpenProject).toHaveBeenLastCalledWith('PRJ-1')
    fireEvent.click(cardOf('NA-1').querySelector('[data-item-ws-chip]') as HTMLElement)
    expect(props.onOpenProject).toHaveBeenLastCalledWith('PRJ-2')
  })

  it('a scoped role renders no project labels; chips jump to the 总览 console', async () => {
    const props = renderStream(makeLoad(ATTN_FULL_RESULT), { role: 'MANAGED', scopeProjectId: 'PRJ-1' })
    await awaitReady()
    expect(document.querySelector('[data-iv-project-label]')).toBeNull()
    expect(document.querySelector('[data-item-project-label]')).toBeNull()
    fireEvent.click(cardOf('IV-1').querySelector('[data-iv-ws-chip]') as HTMLElement)
    expect(props.onGoToWorkstreams).toHaveBeenCalledTimes(1)
    expect(props.onOpenProject).not.toHaveBeenCalled()
  })
})
