// @vitest-environment jsdom
/**
 * V2-T5.2 — 重要事件（纯干预流）component tests (design §7.2 — the ASCII
 * layout is the spec; the action row mirrors the frozen §13 machine from
 * the V1 board).
 *
 * Plain stub props — no real cordis in the component spec (the views-*
 * test pattern). The inject faces (`loadPortfolioInterventions` /
 * `updateInterventionState` / `onInvestigate`) are vi.fn stubs per case;
 * the wire fixtures are re-parsed through the strict
 * `GetPortfolioInterventionsResultSchema` in ./fixtures.ts, so a fixture
 * that drifts from the wire contract fails the suite, not the wire.
 *
 * Gate coverage (plan P5 T5.2 — 组件测试 过滤/动作状态机/空态):
 *  - 状态段过滤: default view = OPEN+PENDING (CLOSED folded + lazy
 *    explicit-status fetch on first 已关闭 expand, cached across toggles);
 *    segment click filters, re-click returns to the union default;
 *    per-group 暂无 copy for a filtered-empty group;
 *  - 动作行状态机: OPEN → 一键调查/标记处理中/关闭 (关闭必填备注 — blank =
 *    fault + 零调用), PENDING → 确认关闭/重开, CLOSED → terminal (no
 *    actions); the state machine fires `updateInterventionState` with the
 *    right args (`projectId` always — §12.1 routing; `resolutionNote`
 *    only for CLOSED); busy disables the row's buttons; a rejection shows
 *    the fault line + NO re-fetch; success re-fetches (no local patch);
 *  - 空态: stream empty → 「当前没有需要处理的事件」 + 「去看工作流进展」
 *    (click → `onGoToWorkstreams`);
 *  - 限本项目: the project roles filter CLIENT-SIDE (other projects'
 *    items never render, no 项目标签); HUB = portfolio (项目标签 present,
 *    click → `onOpenProject`);
 *  - the pure helpers (`formatRelativeTime`, `visibleInterventionIds`).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  InterventionStreamPage,
  formatRelativeTime,
  visibleInterventionIds,
  type InterventionStreamPageProps,
} from '../../src/client/views/shell/intervention-stream.js'
import type {
  GetPortfolioInterventionsArgs,
  GetPortfolioInterventionsResult,
  PortfolioInterventionItemDto,
  UpdateInterventionStateResult,
} from '../../src/shared/rpc-contracts.js'
import {
  NOW,
  STREAM_CLOSED_RESULT,
  STREAM_EMPTY_RESULT,
  STREAM_NO_PENDING_RESULT,
  STREAM_RESULT,
  STREAM_SINGLE_OPEN_RESULT,
  STREAM_SINGLE_PENDING_RESULT,
  UPDATE_CLOSED_OK,
  UPDATE_PENDING_OK,
  UPDATE_REOPEN_OK,
} from './fixtures.js'

/**
 * The default load stub: the plain call resolves `defaultResult`, the
 * explicit `status: 'CLOSED'` call resolves `closedResult` (the two wire
 * views the page owns). Both are inspectable via the returned vi.fn.
 */
function makeLoad(
  defaultResult: GetPortfolioInterventionsResult,
  closedResult: GetPortfolioInterventionsResult = STREAM_CLOSED_RESULT,
): InterventionStreamPageProps['loadPortfolioInterventions'] {
  return vi.fn(async (args: GetPortfolioInterventionsArgs): Promise<GetPortfolioInterventionsResult> =>
    args.status === 'CLOSED' ? closedResult : defaultResult,
  )
}

/** Render the page with inert defaults; cases override what they pin. */
function renderStream(
  load: InterventionStreamPageProps['loadPortfolioInterventions'],
  overrides: Partial<InterventionStreamPageProps> = {},
): InterventionStreamPageProps {
  const props: InterventionStreamPageProps = {
    role: 'HUB',
    scopeProjectId: null,
    loadPortfolioInterventions: load,
    updateInterventionState: vi.fn(
      async (): Promise<UpdateInterventionStateResult> => UPDATE_PENDING_OK as UpdateInterventionStateResult,
    ),
    onInvestigate: vi.fn(async (): Promise<string> => '只读调查已启动 — 会话 S-INV-1'),
    onOpenProject: vi.fn(),
    onGoToWorkstreams: vi.fn(),
    ...overrides,
  }
  render(<InterventionStreamPage {...props} />)
  return props
}

/** Wait for the default view to be ready (the loading face is gone). */
async function awaitReady(): Promise<void> {
  await screen.findByRole('button', { name: /待处理/ })
}

afterEach(() => {
  cleanup()
})

describe('formatRelativeTime — 相对时间', () => {
  it('buckets: 刚刚 / N 分钟前 / N 小时前 / N 天前 / absolute past 30 days', () => {
    expect(formatRelativeTime(NOW - 30 * 1000, NOW)).toBe('刚刚')
    expect(formatRelativeTime(NOW - 5 * 60 * 1000, NOW)).toBe('5 分钟前')
    expect(formatRelativeTime(NOW - 2 * 60 * 60 * 1000, NOW)).toBe('2 小时前')
    expect(formatRelativeTime(NOW - 5 * 24 * 60 * 60 * 1000, NOW)).toBe('5 天前')
    // Past 30 days the relative label is noise → the absolute YYYY-MM-DD.
    const far = formatRelativeTime(NOW - 40 * 24 * 60 * 60 * 1000, NOW)
    expect(far).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('visibleInterventionIds — 可见卡片投影 (scope + segment)', () => {
  it('HUB default view: OPEN group first, then PENDING (host order kept)', () => {
    expect(visibleInterventionIds(STREAM_RESULT.items, null, 'DEFAULT')).toEqual(['IV-4', 'IV-1', 'IV-2'])
  })

  it('the 限本项目 scope filters to the session project only', () => {
    expect(visibleInterventionIds(STREAM_RESULT.items, 'PRJ-1', 'DEFAULT')).toEqual(['IV-1', 'IV-2'])
    expect(visibleInterventionIds(STREAM_RESULT.items, 'PRJ-2', 'DEFAULT')).toEqual(['IV-4'])
  })

  it('a segment narrows to that group (CLOSED is not part of the union)', () => {
    expect(visibleInterventionIds(STREAM_RESULT.items, null, 'OPEN')).toEqual(['IV-4', 'IV-1'])
    expect(visibleInterventionIds(STREAM_RESULT.items, null, 'PENDING')).toEqual(['IV-2'])
    expect(visibleInterventionIds(STREAM_RESULT.items, 'PRJ-2', 'PENDING')).toEqual([])
  })
})

describe('InterventionStreamPage — 默认视图 (OPEN+PENDING, CLOSED folded)', () => {
  it('fetches the plain call on mount and renders the two groups in order', async () => {
    const load = makeLoad(STREAM_RESULT)
    renderStream(load)
    await awaitReady()

    expect(load).toHaveBeenCalledTimes(1)
    expect(load).toHaveBeenCalledWith({})
    const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-attention-card]'))
    expect(cards.map((c) => c.dataset.ivId)).toEqual(['IV-4', 'IV-1', 'IV-2'])
    // CLOSED never renders in the default view.
    expect(document.querySelector('[data-iv-status="CLOSED"]')).toBeNull()
  })

  it('HUB: every card carries the 项目标签 (displayName) — click drills to the project', async () => {
    const onOpenProject = vi.fn()
    renderStream(makeLoad(STREAM_RESULT), { onOpenProject })
    await awaitReady()

    const tag = screen.getByRole('button', { name: '独立实验' })
    expect(tag.closest('[data-iv-id="IV-4"]')).toBeTruthy()
    fireEvent.click(tag)
    expect(onOpenProject).toHaveBeenCalledWith('PRJ-2')
  })

  it('renders the 来源徽标 (V1 copy), the 工作流 chips and the relative time', async () => {
    renderStream(makeLoad(STREAM_RESULT))
    await awaitReady()

    // Origin badges (the V1 ORIGIN_LABEL copy verbatim).
    expect(screen.getByText('自动洪泛检测').closest('[data-iv-id="IV-1"]')).toBeTruthy()
    expect(screen.getByText('Agent 报告').closest('[data-iv-id="IV-2"]')).toBeTruthy()
    expect(screen.getByText('用户').closest('[data-iv-id="IV-4"]')).toBeTruthy()
    // Workflow chips (per item — IV-1 carries two; the WS-1 chip exists on
    // TWO cards here, so query within the card).
    const card1 = document.querySelector('[data-iv-id="IV-1"]')
    expect(card1?.querySelector('[data-iv-ws-chip="WS-1"]')).toBeTruthy()
    expect(card1?.querySelector('[data-iv-ws-chip="WS-2"]')).toBeTruthy()
    // The relative time (2 小时前 for IV-1 at NOW-2h; the default now = Date.now()
    // is far newer → the absolute date is fine either way, so pin the element).
    const time = document.querySelector<HTMLElement>('[data-iv-id="IV-1"] [data-iv-time]')
    expect(time?.textContent).toBeTruthy()
  })

  it('a failed FIRST load: the failure face + 刷新 re-invokes the fetch', async () => {
    const load = vi.fn(async (): Promise<GetPortfolioInterventionsResult> => {
      throw new Error('IVL_1')
    })
    renderStream(load)

    expect(await screen.findByText('重要事件加载失败')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    expect(load).toHaveBeenCalledTimes(2)
    // The retry fails again: the failure face re-commits.
    await act(async () => {})
    expect(document.querySelector('[data-attention-stream][data-phase="failed"]')).toBeTruthy()
  })
})

describe('InterventionStreamPage — 状态段过滤', () => {
  it('shows the per-segment counts on the segment buttons', async () => {
    renderStream(makeLoad(STREAM_RESULT))
    await awaitReady()

    expect(screen.getByRole('button', { name: '待处理 2' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '待确认 1' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '已关闭 ▾' })).toBeTruthy()
  })

  it('click 待处理 → OPEN only; re-click → back to the union default', async () => {
    renderStream(makeLoad(STREAM_RESULT))
    await awaitReady()

    const openSegment = screen.getByRole('button', { name: '待处理 2' })
    fireEvent.click(openSegment)
    expect(openSegment.getAttribute('aria-pressed')).toBe('true')
    expect(Array.from(document.querySelectorAll<HTMLElement>('[data-attention-card]')).map((c) => c.dataset.ivId)).toEqual([
      'IV-4',
      'IV-1',
    ])

    fireEvent.click(openSegment)
    expect(openSegment.getAttribute('aria-pressed')).toBe('false')
    expect(Array.from(document.querySelectorAll<HTMLElement>('[data-attention-card]')).map((c) => c.dataset.ivId)).toEqual([
      'IV-4',
      'IV-1',
      'IV-2',
    ])
  })

  it('click 待确认 → PENDING only', async () => {
    renderStream(makeLoad(STREAM_RESULT))
    await awaitReady()

    fireEvent.click(screen.getByRole('button', { name: '待确认 1' }))
    expect(Array.from(document.querySelectorAll<HTMLElement>('[data-attention-card]')).map((c) => c.dataset.ivId)).toEqual([
      'IV-2',
    ])
  })

  it('已关闭 expand: the FIRST expand fetches the explicit status, later toggles reuse the cache', async () => {
    const load = makeLoad(STREAM_RESULT)
    renderStream(load)
    await awaitReady()
    expect(load).toHaveBeenCalledTimes(1)

    const closedSegment = screen.getByRole('button', { name: '已关闭 ▾' })
    fireEvent.click(closedSegment)
    expect(await screen.findByText('归档前的历史洪泛')).toBeTruthy()
    expect(load).toHaveBeenCalledTimes(2)
    expect(load).toHaveBeenLastCalledWith({ status: 'CLOSED' })
    // The closed section renders the terminal card; the segment flips ▴.
    expect(document.querySelector('[data-attention-closed-section]')).toBeTruthy()
    expect(document.querySelector('[data-iv-id="IV-3"][data-iv-status="CLOSED"]')).toBeTruthy()
    expect(screen.getByRole('button', { name: '已关闭 ▴' })).toBeTruthy()

    // Collapse + re-expand: the cached CLOSED view — NO third fetch.
    fireEvent.click(screen.getByRole('button', { name: '已关闭 ▴' }))
    expect(document.querySelector('[data-attention-closed-section]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '已关闭 ▾' }))
    expect(screen.getByText('归档前的历史洪泛')).toBeTruthy()
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('a failed CLOSED fetch: the fault line in the closed section, the default view stays live', async () => {
    const load = vi.fn(async (args: GetPortfolioInterventionsArgs): Promise<GetPortfolioInterventionsResult> => {
      if (args.status === 'CLOSED') throw new Error('IVL_2')
      return STREAM_RESULT
    })
    renderStream(load)
    await awaitReady()

    fireEvent.click(screen.getByRole('button', { name: '已关闭 ▾' }))
    expect(await screen.findByText(/已关闭列表加载失败/)).toBeTruthy()
    // The fault replaces the 暂无 copy (the closed section shows the fault, not the empty state).
    expect(screen.queryByText('暂无已关闭事件')).toBeNull()
    // The default view is untouched (stale-while-revalidate discipline).
    expect(screen.getByText('标定管线阻塞')).toBeTruthy()
  })

  it('the per-group 暂无 copy for a filtered-empty group (the group does not vanish)', async () => {
    renderStream(makeLoad(STREAM_NO_PENDING_RESULT))
    await awaitReady()

    fireEvent.click(screen.getByRole('button', { name: '待确认 0' }))
    expect(screen.getByText('暂无待确认事件')).toBeTruthy()
  })
})

describe('InterventionStreamPage — 动作行状态机 (§13 mirror)', () => {
  it('OPEN: 一键调查 / 标记处理中 / 关闭 + the note input render', async () => {
    renderStream(makeLoad(STREAM_SINGLE_OPEN_RESULT))
    await awaitReady()

    const card = document.querySelector('[data-iv-id="IV-1"]')
    expect(card?.querySelector('[data-iv-action="investigate"]')).toBeTruthy()
    expect(card?.querySelector('[data-iv-action="pending"]')).toBeTruthy()
    expect(card?.querySelector('[data-iv-action="close"]')).toBeTruthy()
    expect(card?.querySelector('[data-iv-note="IV-1"]')).toBeTruthy()
    // PENDING-only actions are absent on an OPEN card.
    expect(card?.querySelector('[data-iv-action="confirm-close"]')).toBeNull()
    expect(card?.querySelector('[data-iv-action="reopen"]')).toBeNull()
  })

  it('标记处理中: fires OPEN→PENDING with the item projectId; busy disables the row; success re-fetches', async () => {
    let resolveUpdate!: (value: UpdateInterventionStateResult) => void
    const update = vi.fn(
      () =>
        new Promise<UpdateInterventionStateResult>((resolve) => {
          resolveUpdate = resolve
        }),
    )
    const load = makeLoad(STREAM_SINGLE_OPEN_RESULT)
    renderStream(load, { updateInterventionState: update })
    await awaitReady()

    const card = document.querySelector('[data-iv-id="IV-1"]')
    const pendingButton = card?.querySelector<HTMLButtonElement>('[data-iv-action="pending"]')
    fireEvent.click(pendingButton as HTMLButtonElement)

    // The right args (frozen machine + §12.1 routing — NO resolutionNote).
    expect(update).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith({ interventionId: 'IV-1', status: 'PENDING', projectId: 'PRJ-1' })
    // Busy: the row's buttons disable (the 处理中… label on the clicked one).
    expect((card?.querySelector<HTMLButtonElement>('[data-iv-action="pending"]') as HTMLButtonElement).disabled).toBe(true)
    expect((card?.querySelector<HTMLButtonElement>('[data-iv-action="close"]') as HTMLButtonElement).disabled).toBe(true)
    expect((card?.querySelector<HTMLButtonElement>('[data-iv-action="investigate"]') as HTMLButtonElement).disabled).toBe(true)
    // Both 迁移 buttons carry the busy label while in flight.
    expect(screen.getAllByText('处理中…')).toHaveLength(2)

    await act(async () => {
      resolveUpdate(UPDATE_PENDING_OK as UpdateInterventionStateResult)
    })
    // Success → RE-FETCH (no local patch — the host is the single source).
    expect(load).toHaveBeenCalledTimes(2)
    expect(load).toHaveBeenLastCalledWith({})
  })

  it('关闭 with a BLANK 备注: the fault line + 零调用 (the §9.2 discipline)', async () => {
    const update = vi.fn(async (): Promise<UpdateInterventionStateResult> => UPDATE_CLOSED_OK as UpdateInterventionStateResult)
    renderStream(makeLoad(STREAM_SINGLE_OPEN_RESULT), { updateInterventionState: update })
    await awaitReady()

    const card = document.querySelector('[data-iv-id="IV-1"]')
    fireEvent.click(card?.querySelector('[data-iv-action="close"]') as HTMLButtonElement)

    expect(update).not.toHaveBeenCalled()
    expect(card?.querySelector('[data-iv-fault]')?.textContent).toBe('关闭时请填写处理备注')
  })

  it('关闭 with a 备注: fires →CLOSED with the resolutionNote; success re-fetches', async () => {
    const update = vi.fn(async (): Promise<UpdateInterventionStateResult> => UPDATE_CLOSED_OK as UpdateInterventionStateResult)
    const load = makeLoad(STREAM_SINGLE_OPEN_RESULT)
    renderStream(load, { updateInterventionState: update })
    await awaitReady()

    const card = document.querySelector('[data-iv-id="IV-1"]')
    fireEvent.change(card?.querySelector<HTMLInputElement>('[data-iv-note="IV-1"]') as HTMLInputElement, {
      target: { value: '已处理' },
    })
    fireEvent.click(card?.querySelector('[data-iv-action="close"]') as HTMLButtonElement)

    expect(update).toHaveBeenCalledWith({
      interventionId: 'IV-1',
      status: 'CLOSED',
      projectId: 'PRJ-1',
      resolutionNote: '已处理',
    })
    // Success → RE-FETCH (the 刷新 toolbar stays; the stale view re-resolves).
    await act(async () => {})
    expect(screen.getByRole('button', { name: '刷新' })).toBeTruthy()
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('a state-mutation REJECTION: the fault line carries the message, NO re-fetch', async () => {
    const update = vi.fn(async (): Promise<UpdateInterventionStateResult> => {
      throw new Error('IVL_3 状态机拒绝该迁移')
    })
    const load = makeLoad(STREAM_SINGLE_OPEN_RESULT)
    renderStream(load, { updateInterventionState: update })
    await awaitReady()

    const card = document.querySelector('[data-iv-id="IV-1"]')
    fireEvent.click(card?.querySelector('[data-iv-action="pending"]') as HTMLButtonElement)
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(card?.querySelector('[data-iv-fault]')?.textContent).toContain('状态机拒绝该迁移')
    // The row is no longer busy; the page did NOT re-fetch.
    expect((card?.querySelector<HTMLButtonElement>('[data-iv-action="pending"]') as HTMLButtonElement).disabled).toBe(false)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('PENDING: 确认关闭 / 重开 render (no 一键调查); 重开 fires →OPEN without a note', async () => {
    const update = vi.fn(async (): Promise<UpdateInterventionStateResult> => UPDATE_REOPEN_OK as UpdateInterventionStateResult)
    renderStream(makeLoad(STREAM_SINGLE_PENDING_RESULT), { updateInterventionState: update })
    await awaitReady()

    const card = document.querySelector('[data-iv-id="IV-2"]')
    expect(card?.querySelector('[data-iv-action="confirm-close"]')).toBeTruthy()
    expect(card?.querySelector('[data-iv-action="reopen"]')).toBeTruthy()
    // OPEN-only actions are absent on a PENDING card (§7.2 enumeration).
    expect(card?.querySelector('[data-iv-action="investigate"]')).toBeNull()
    expect(card?.querySelector('[data-iv-action="pending"]')).toBeNull()
    expect(card?.querySelector('[data-iv-question="IV-2"]')).toBeNull()

    fireEvent.click(card?.querySelector('[data-iv-action="reopen"]') as HTMLButtonElement)
    expect(update).toHaveBeenCalledWith({ interventionId: 'IV-2', status: 'OPEN', projectId: 'PRJ-1' })
  })

  it('PENDING 确认关闭 with a 备注 fires →CLOSED with the resolutionNote', async () => {
    const update = vi.fn(async (): Promise<UpdateInterventionStateResult> => UPDATE_CLOSED_OK as UpdateInterventionStateResult)
    renderStream(makeLoad(STREAM_SINGLE_PENDING_RESULT), { updateInterventionState: update })
    await awaitReady()

    const card = document.querySelector('[data-iv-id="IV-2"]')
    fireEvent.change(card?.querySelector<HTMLInputElement>('[data-iv-note="IV-2"]') as HTMLInputElement, {
      target: { value: '复核后关闭' },
    })
    fireEvent.click(card?.querySelector('[data-iv-action="confirm-close"]') as HTMLButtonElement)
    expect(update).toHaveBeenCalledWith({
      interventionId: 'IV-2',
      status: 'CLOSED',
      projectId: 'PRJ-1',
      resolutionNote: '复核后关闭',
    })
  })

  it('CLOSED: terminal — no action row at all', async () => {
    renderStream(makeLoad(STREAM_RESULT, STREAM_CLOSED_RESULT))
    await awaitReady()
    fireEvent.click(screen.getByRole('button', { name: '已关闭 ▾' }))
    await screen.findByText('归档前的历史洪泛')

    const card = document.querySelector('[data-iv-id="IV-3"]')
    expect(card?.querySelector('[data-iv-action]')).toBeNull()
    expect(card?.querySelector('[data-iv-note]')).toBeNull()
  })

  it('一键调查 with a BLANK question: the fault line + 零调用', async () => {
    const onInvestigate = vi.fn(async (): Promise<string> => '只读调查已启动 — 会话 S-INV-1')
    renderStream(makeLoad(STREAM_SINGLE_OPEN_RESULT), { onInvestigate })
    await awaitReady()

    const card = document.querySelector('[data-iv-id="IV-1"]')
    fireEvent.click(card?.querySelector('[data-iv-action="investigate"]') as HTMLButtonElement)

    expect(onInvestigate).not.toHaveBeenCalled()
    expect(card?.querySelector('[data-iv-fault]')?.textContent).toBe('一键调查请填写调查问题')
  })

  it('一键调查 with a question: fires the channel face; success shows the text, a failure shows the fault', async () => {
    const onInvestigate = vi.fn(
      async (_item: PortfolioInterventionItemDto, _question: string): Promise<string> => '只读调查已启动 — 会话 S-INV-1',
    )
    renderStream(makeLoad(STREAM_SINGLE_OPEN_RESULT), { onInvestigate })
    await awaitReady()

    const card = document.querySelector('[data-iv-id="IV-1"]')
    const input = card?.querySelector<HTMLInputElement>('[data-iv-question="IV-1"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: '为什么标定管线被标记洪泛？' } })
    fireEvent.click(card?.querySelector('[data-iv-action="investigate"]') as HTMLButtonElement)

    expect(onInvestigate).toHaveBeenCalledTimes(1)
    // The face receives the wire item + the typed question.
    const arg = onInvestigate.mock.calls[0][0]
    expect(arg.id).toBe('IV-1')
    expect(onInvestigate.mock.calls[0][1]).toBe('为什么标定管线被标记洪泛？')
    expect(await screen.findByText('只读调查已启动 — 会话 S-INV-1')).toBeTruthy()
    // The 调查中… busy label was shown while in flight (it is gone now).
    expect(screen.queryByText('调查中…')).toBeNull()
  })

  it('一键调查 failure: the channel error text lands on the fault line', async () => {
    const onInvestigate = vi.fn(async (): Promise<string> => {
      throw new Error('[IVL_INVESTIGATE] 无可用调查代理')
    })
    renderStream(makeLoad(STREAM_SINGLE_OPEN_RESULT), { onInvestigate })
    await awaitReady()

    const card = document.querySelector('[data-iv-id="IV-1"]')
    fireEvent.change(card?.querySelector<HTMLInputElement>('[data-iv-question="IV-1"]') as HTMLInputElement, {
      target: { value: '为什么？' },
    })
    fireEvent.click(card?.querySelector('[data-iv-action="investigate"]') as HTMLButtonElement)
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(card?.querySelector('[data-iv-fault]')?.textContent).toContain('无可用调查代理')
  })
})

describe('InterventionStreamPage — 空态', () => {
  it('stream empty: 「当前没有需要处理的事件」 + 「去看工作流进展」 (click → onGoToWorkstreams)', async () => {
    const onGoToWorkstreams = vi.fn()
    renderStream(makeLoad(STREAM_EMPTY_RESULT), { onGoToWorkstreams })
    await awaitReady()

    expect(screen.getByText('当前没有需要处理的事件')).toBeTruthy()
    // 空态提示（一键调查入口在哪 — 「待处理」事件卡片上）: 随空态一并呈现。
    expect(
      screen.getByText(/出现「待处理」事件后.*「一键调查」入口/),
    ).toBeTruthy()
    const button = screen.getByRole('button', { name: '去看工作流进展' })
    fireEvent.click(button)
    expect(onGoToWorkstreams).toHaveBeenCalledTimes(1)
    // The per-group 暂无 copy is NOT the stream-empty face.
    expect(screen.queryByText('暂无待处理事件')).toBeNull()
  })

  it('without onGoToWorkstreams the light action is omitted (the copy stays)', async () => {
    renderStream(makeLoad(STREAM_EMPTY_RESULT), { onGoToWorkstreams: undefined })
    await awaitReady()

    expect(screen.getByText('当前没有需要处理的事件')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '去看工作流进展' })).toBeNull()
  })
})

describe('InterventionStreamPage — 限本项目 (project roles) + 刷新', () => {
  it('MANAGED: other projects items never render; no 项目标签; the chip jumps to 总览', async () => {
    const onGoToWorkstreams = vi.fn()
    renderStream(makeLoad(STREAM_RESULT), {
      role: 'MANAGED',
      scopeProjectId: 'PRJ-1',
      onGoToWorkstreams,
    })
    await awaitReady()

    expect(document.querySelector('[data-attention-stream][data-role="MANAGED"]')).toBeTruthy()
    // The PRJ-2 item is filtered OUT client-side.
    expect(document.querySelector('[data-iv-id="IV-4"]')).toBeNull()
    expect(Array.from(document.querySelectorAll<HTMLElement>('[data-attention-card]')).map((c) => c.dataset.ivId)).toEqual([
      'IV-1',
      'IV-2',
    ])
    // No 项目标签 in the project role (hub-only field).
    expect(document.querySelector('[data-iv-project-label]')).toBeNull()
    // The workflow chip is the 总览 jump (no project drill in the narrowed
    // console). The WS-1 chip exists on TWO cards here → click the one
    // inside IV-1.
    const card1 = document.querySelector('[data-iv-id="IV-1"]')
    fireEvent.click(card1?.querySelector('[data-iv-ws-chip="WS-1"]') as HTMLButtonElement)
    expect(onGoToWorkstreams).toHaveBeenCalledTimes(1)
    // The wire call was STILL the cross-project one (the host groups both).
    expect(screen.getByRole('button', { name: '待处理 1' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '待确认 1' })).toBeTruthy()
  })

  it('a scope with no items: the stream-empty face (当前没有需要处理的事件)', async () => {
    renderStream(makeLoad(STREAM_RESULT), { role: 'STANDALONE', scopeProjectId: 'PRJ-3' })
    await awaitReady()

    expect(screen.getByText('当前没有需要处理的事件')).toBeTruthy()
  })

  it('刷新 re-invokes the plain call; a failed refresh keeps the stale data + the fault line', async () => {
    const load = makeLoad(STREAM_RESULT)
    renderStream(load)
    await awaitReady()
    expect(load).toHaveBeenCalledTimes(1)

    // A successful refresh (the stale face is NOT shown).
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    await act(async () => {})
    expect(load).toHaveBeenCalledTimes(2)
    expect(document.querySelector('[data-attention-stream][data-phase="ready"]')).toBeTruthy()

    // Now make the next plain call fail: the data stays, the fault line explains.
    load.mockImplementation(async () => {
      throw new Error('IVL_4')
    })
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    expect(await screen.findByText(/刷新失败/)).toBeTruthy()
    expect(screen.getByText('标定管线阻塞')).toBeTruthy()
    expect(document.querySelector('[data-attention-stream][data-phase="ready"]')).toBeTruthy()
  })
})
