// @vitest-environment jsdom
/**
 * WP-4.7 — project page CONTAINER tests (store binding layer, G4 S1).
 *
 * The container (ProjectPage.tsx) is the ONE store-touching file of the
 * project view: it pulls the `project` slice out of the research store,
 * triggers the lazy first load on mount, re-maps the slice onto the pure
 * props view, and hands over the navigation callbacks. These tests run
 * the REAL `createResearchStore` (tests/stores/stub-rpc.ts facade stub
 * injected through the store's `rpc` seam) against the real component —
 * asserting user-visible behavior (text, callbacks, fetch counts), never
 * class names or internal store mechanics.
 *
 * Behaviors pinned here:
 *  - mount → lazy `loadProject` (exactly one fetch; StrictMode
 *    double-effect issues exactly one fetch via the store's in-flight
 *    dedupe) → the §27.2 blocks render from the slice;
 *  - the frozen-null placeholder fields render their 「待 Phase 5」
 *    markers through the container (the whole §27.2 face, end to end);
 *  - first-load failure (business fault AND transport fault) → 加载失败
 *    face + 重试 → a good retry renders the data;
 *  - failed refetch (store.refresh — the home 刷新 cycle) → stale data
 *    stays visible + 刷新失败 banner (stale-while-revalidate, end to end);
 *  - navigation callbacks pass through the container to the display layer.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createResearchStore } from '../../src/client/stores'
import { ProjectPage } from '../../src/client/views/project'
import { makeStubRpc, type StubRpc } from '../stores/stub-rpc.js'
import { PROJECT_PAGE_FIXTURE } from './fixtures'

afterEach(cleanup)

interface RenderContainerOptions {
  /** Pre-built stub (default: fresh). */
  rpc?: StubRpc
  /** The INITIAL getProject outcome (default: ok + PROJECT_PAGE_FIXTURE). */
  initial?: unknown
  onOpenTopic?: (topicId: string) => void
  onBack?: () => void
}

/**
 * Render the container bound to a fresh store over a stub facade. Hermetic:
 * the initial getProject outcome is pinned to THIS suite's fixture unless
 * `initial` overrides it (the suite does not depend on rpc-face fixtures).
 */
function renderContainer(options: RenderContainerOptions = {}) {
  const stub = options.rpc ?? makeStubRpc()
  stub.set('getProject', options.initial ?? { ok: true, value: PROJECT_PAGE_FIXTURE })
  const store = createResearchStore({ rpc: stub.rpc })
  const utils = render(
    <StrictMode>
      <ProjectPage
        store={store}
        onOpenTopic={options.onOpenTopic ?? (() => undefined)}
        onBack={options.onBack ?? (() => undefined)}
      />
    </StrictMode>,
  )
  return { store, rpc: stub, ...utils }
}

describe('ProjectPage container — mount + lazy load', () => {
  it('issues exactly ONE lazy getProject on mount and renders the §27.2 face', async () => {
    const { rpc } = renderContainer()

    // The lazy slice lands a tick after the heading (heading renders with
    // the idle slice, then the fetch resolves).
    await screen.findByText('完成凝聚态物理关键方向的系统综述', {}, { timeout: 2000 })
    await waitFor(() => {
      expect(rpc.countOf('getProject')).toBe(1)
    })

    // §27.2 blocks, end to end (data + placeholders through the container).
    expect(screen.getByRole('heading', { level: 1, name: /PRJ-1 · 凝聚态方向综述/ })).toBeDefined()
    expect(screen.getByText('追踪关键方向进展并整理证据链')).toBeDefined()
    expect(screen.getByText('重要度：5')).toBeDefined()
    expect(screen.getByText('注意力：聚焦')).toBeDefined()
    expect(screen.getByRole('button', { name: /高温超导/ })).toBeDefined()
    expect(screen.getAllByText('待 Phase 5')).toHaveLength(2)
  })

  it('StrictMode double-effect + re-render never double-fetches the idle slice', async () => {
    const { rpc } = renderContainer()
    await screen.findByText('建立高温超导机制的定量模型', {}, { timeout: 2000 })
    await waitFor(() => {
      expect(rpc.countOf('getProject')).toBe(1)
    })
  })
})

describe('ProjectPage container — fault faces', () => {
  it('first-load BUSINESS fault → 加载失败 + 重试; a good retry renders the data', async () => {
    const { rpc } = renderContainer({
      initial: { ok: false, error: { code: 'RESEARCH_LOAD_FAILED', message: 'tree invalid' } },
    })

    await screen.findByText('加载失败：RESEARCH_LOAD_FAILED: tree invalid', {}, { timeout: 2000 })
    expect(screen.getByRole('button', { name: '重试' })).toBeDefined()

    // The retry: the stub now answers ok → the slice goes ready.
    rpc.set('getProject', { ok: true, value: PROJECT_PAGE_FIXTURE })
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await screen.findByText('完成凝聚态物理关键方向的系统综述', {}, { timeout: 2000 })
  })

  it('first-load TRANSPORT fault → the slice carries the error face (no crash)', async () => {
    renderContainer({ initial: new Error('research: not mounted') })

    await screen.findByText('加载失败：research: not mounted', {}, { timeout: 2000 })
    expect(screen.getByRole('alert')).toBeDefined()
  })

  it('failed refetch via store.refresh keeps stale data + shows 刷新失败 (stale-while-revalidate)', async () => {
    const { store, rpc } = renderContainer()
    await screen.findByText('完成凝聚态物理关键方向的系统综述', {}, { timeout: 2000 })

    // The refresh cycle now fails (e.g. the gateway is down); the last
    // good data must stay visible with the banner (the home 刷新 button
    // drives store.refresh; the project slice refetches among non-idle).
    // The refresh rejects on the transport fault (fail-loud at the store
    // boundary) — the view swallows it, exactly like the home container's
    // refresh handler, so the test mirrors that.
    rpc.set('getProject', new Error('gateway timeout'))
    await store.refresh('manual').catch(() => undefined)

    await screen.findByText('刷新失败：gateway timeout', {}, { timeout: 2000 })
    expect(screen.getByRole('heading', { level: 1, name: /PRJ-1 · 凝聚态方向综述/ })).toBeDefined()
    expect(screen.getByText('完成凝聚态物理关键方向的系统综述')).toBeDefined()
    // and no 重试 (the data is still usable — retry belongs to the no-data path)
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull()
  })
})

describe('ProjectPage container — navigation passthrough', () => {
  it('topic card → onOpenTopic(topicId); 返回 → onBack', async () => {
    const onOpenTopic = vi.fn()
    const onBack = vi.fn()
    renderContainer({ onOpenTopic, onBack })
    await screen.findByRole('button', { name: /高温超导/ })

    fireEvent.click(screen.getByRole('button', { name: /高温超导/ }))
    expect(onOpenTopic).toHaveBeenCalledTimes(1)
    expect(onOpenTopic).toHaveBeenCalledWith('TPC-1')

    fireEvent.click(screen.getByRole('button', { name: '← 返回总览' }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
