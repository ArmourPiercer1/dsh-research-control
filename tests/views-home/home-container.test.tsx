// @vitest-environment jsdom
/**
 * WP-4.2 — home dashboard CONTAINER tests (store binding layer).
 *
 * The container (HomeDashboard.tsx) is the ONE store-touching file of the
 * home view: it pulls the `dashboard` slice out of the research store,
 * triggers the lazy first load on mount, drives `store.refresh()` from the
 * 刷新 button, and re-maps the slice onto the pure props view. These tests
 * run the REAL `createResearchStore` (tests/stores/stub-rpc.ts facade stub
 * injected through the store's `rpc` seam) against the real component —
 * asserting user-visible behavior (text, callbacks, fetch counts), never
 * class names or internal store mechanics.
 *
 * Timing note: the stub records and delivers each `getDashboard` call
 * synchronously when the store's fetch starts (inside the render act), so
 * the INITIAL outcome is passed through `renderContainer({ initial })`;
 * later `rpc.set` overrides only affect subsequent fetches (refresh/retry).
 *
 * Behaviors pinned here:
 *  - mount → lazy `loadDashboard` (exactly one fetch; StrictMode
 *    double-effect issues exactly one fetch via the store's in-flight
 *    dedupe) → the §27.1 blocks render from the slice;
 *  - the frozen-null fields render their 「待 Phase 5/6」 placeholders
 *    through the container (the whole §27.1 face, end to end);
 *  - 刷新 → `store.refresh('manual')` re-fetches the non-idle slice and
 *    the new data re-renders;
 *  - first-load failure (business fault AND transport fault) → 加载失败
 *    face + 重试 → a good retry renders the data;
 *  - failed refetch → stale data stays visible + 刷新失败 banner
 *    (stale-while-revalidate, end to end);
 *  - navigation callbacks pass through the container to the display layer.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createResearchStore } from '../../src/client/stores'
import { HomeDashboard } from '../../src/client/views/home'
import { makeStubRpc, type StubRpc } from '../stores/stub-rpc.js'
import {
  HOME_EMPTY_FIXTURE,
  HOME_FIXTURE,
  HOME_REFRESHED_FIXTURE,
} from './fixtures'

afterEach(cleanup)

interface RenderContainerOptions {
  /** Pre-built stub (default: fresh). */
  rpc?: StubRpc
  /** The INITIAL getDashboard outcome (default: ok + HOME_FIXTURE). */
  initial?: unknown
  onOpenTopic?: (topicId: string) => void
  onOpenWorkstream?: (workstreamId: string) => void
  onOpenHistory?: (workstreamId: string) => void
}

/**
 * Render the container bound to a fresh store over a stub facade. Hermetic:
 * the initial getDashboard outcome is pinned to THIS suite's fixture unless
 * `initial` overrides it (the suite does not depend on rpc-face fixtures).
 */
function renderContainer(options: RenderContainerOptions = {}) {
  const stub = options.rpc ?? makeStubRpc()
  stub.set('getDashboard', options.initial ?? { ok: true, value: HOME_FIXTURE })
  const store = createResearchStore({ rpc: stub.rpc })
  const utils = render(
    <HomeDashboard
      store={store}
      onOpenTopic={options.onOpenTopic}
      onOpenWorkstream={options.onOpenWorkstream}
      onOpenHistory={options.onOpenHistory}
    />,
  )
  return { store, rpc: stub, ...utils }
}

/** Await the first good dashboard render (project title visible). */
async function awaitDashboardLoaded(): Promise<void> {
  await screen.findByText('凝聚态方向综述', {}, { timeout: 2000 })
}

describe('mount → lazy load → §27.1 blocks render from the dashboard slice', () => {
  it('issues exactly one getDashboard on mount and renders every block', async () => {
    const { rpc } = renderContainer()
    await awaitDashboardLoaded()

    expect(rpc.countOf('getDashboard')).toBe(1)
    // project card + topic overview
    expect(screen.getByRole('heading', { level: 2, name: '凝聚态方向综述' })).toBeDefined()
    expect(screen.getByRole('button', { name: /高温超导/ })).toBeDefined()
    // intervention groups (INV-ATTN-1 complete) + placeholders
    expect(screen.getByText('审阅 Agent 累积的计划分叉')).toBeDefined()
    expect(screen.getByText('等待用户确认的审计发现')).toBeDefined()
    expect(screen.getAllByText('待 Phase 5')).toHaveLength(3)
    expect(screen.getAllByText('待 Phase 6')).toHaveLength(1)
  })

  it('renders from whatever snapshot the stub delivers (the slice IS the source)', async () => {
    renderContainer({ initial: { ok: true, value: HOME_EMPTY_FIXTURE } })
    expect(await screen.findByText('项目一', {}, { timeout: 2000 })).toBeDefined()
    expect(screen.getByText('暂无主题')).toBeDefined()
  })

  it('issues exactly one getDashboard under a StrictMode double-effect (in-flight dedupe)', async () => {
    const rpc = makeStubRpc()
    rpc.set('getDashboard', { ok: true, value: HOME_FIXTURE })
    const store = createResearchStore({ rpc: rpc.rpc })
    render(
      <StrictMode>
        <HomeDashboard store={store} />
      </StrictMode>,
    )
    await awaitDashboardLoaded()
    // mount → effect → simulated unmount → effect re-run: the store's
    // per-key in-flight dedupe collapses the double load into one fetch.
    expect(rpc.countOf('getDashboard')).toBe(1)
  })
})

describe('刷新 button → store.refresh() → re-fetch + re-render', () => {
  it('re-fetches the dashboard slice and renders the refreshed data', async () => {
    const { rpc } = renderContainer()
    await awaitDashboardLoaded()
    expect(rpc.countOf('getDashboard')).toBe(1)

    rpc.set('getDashboard', { ok: true, value: HOME_REFRESHED_FIXTURE })
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    await screen.findByText('凝聚态方向综述（刷新）', {}, { timeout: 2000 })

    expect(rpc.countOf('getDashboard')).toBe(2)
    // refresh refetched the non-idle slice only (fresh store: dashboard alone)
    expect(rpc.calls.filter(c => c.method !== 'getDashboard')).toHaveLength(0)
  })
})

describe('first-load failure faces (slice records the fault; the view renders it)', () => {
  it('business fault (ok:false) → 加载失败 + 重试; a good retry renders the data', async () => {
    const { rpc } = renderContainer({
      initial: {
        ok: false,
        error: { code: 'NOT_READY', message: 'research service not ready', details: {} },
      },
    })

    expect(
      await screen.findByText('加载失败：NOT_READY: research service not ready', {}, { timeout: 2000 }),
    ).toBeDefined()
    expect(screen.getByRole('alert')).toBeDefined()

    // retry with a good outcome
    rpc.set('getDashboard', { ok: true, value: HOME_FIXTURE })
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await awaitDashboardLoaded()
    expect(rpc.countOf('getDashboard')).toBe(2)
  })

  it('transport fault (thrown Error) → 加载失败 with the error message (slice markError precedes the re-throw)', async () => {
    renderContainer({ initial: new Error('gateway connection reset') })

    expect(
      await screen.findByText('加载失败：gateway connection reset', {}, { timeout: 2000 }),
    ).toBeDefined()
    expect(screen.getByRole('button', { name: '重试' })).toBeDefined()
    // the swallowed rejection must not surface as an unhandled rejection —
    // the test reaching this assertion with no crash pins that.
  })
})

describe('failed refetch → stale-while-revalidate (stale data + 刷新失败 banner)', () => {
  it('keeps the last good data visible and shows the banner', async () => {
    const { rpc } = renderContainer()
    await awaitDashboardLoaded()

    rpc.set('getDashboard', {
      ok: false,
      error: { code: 'GATEWAY_TIMEOUT', message: 'upstream timed out', details: {} },
    })
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))

    expect(
      await screen.findByText('刷新失败：GATEWAY_TIMEOUT: upstream timed out', {}, { timeout: 2000 }),
    ).toBeDefined()
    // the stale data stayed rendered
    expect(screen.getByRole('heading', { level: 2, name: '凝聚态方向综述' })).toBeDefined()
    expect(screen.getByText('审阅 Agent 累积的计划分叉')).toBeDefined()
    expect(rpc.countOf('getDashboard')).toBe(2)
  })
})

describe('navigation callbacks pass through the container', () => {
  it('topic / workstream / history callbacks fire with the right ids', async () => {
    const onOpenTopic = vi.fn()
    const onOpenWorkstream = vi.fn()
    const onOpenHistory = vi.fn()
    renderContainer({ onOpenTopic, onOpenWorkstream, onOpenHistory })
    await awaitDashboardLoaded()

    fireEvent.click(screen.getByRole('button', { name: /高温超导/ }))
    expect(onOpenTopic).toHaveBeenCalledWith('TPC-1')

    fireEvent.click(screen.getByRole('button', { name: 'WS-2' }))
    expect(onOpenWorkstream).toHaveBeenCalledWith('WS-2')

    fireEvent.click(screen.getAllByRole('button', { name: '历史' })[0])
    expect(onOpenHistory).toHaveBeenCalledWith('WS-1')
  })

  it('tolerates absent navigation callbacks (optional wiring face)', async () => {
    renderContainer()
    await awaitDashboardLoaded()
    // clicking must not throw when the wiring passed no callbacks
    expect(() => fireEvent.click(screen.getByRole('button', { name: /高温超导/ }))).not.toThrow()
    expect(() => fireEvent.click(screen.getByRole('button', { name: 'WS-1' }))).not.toThrow()
  })
})
