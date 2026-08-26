// @vitest-environment jsdom
/**
 * V2-T5.1 — project console component tests (the 总览 body of the
 * MANAGED / STANDALONE 同构收窄控制台; the HUB drill target).
 *
 * The REAL `createResearchStore()` over the stub facade (the plugin's own
 * mount seam — a plain fake ctx into `mountResearchRemotes`, NOT cordis;
 * the same pattern tests/views-drilldown/cockpit.test.tsx uses).
 *
 * Gate coverage (plan P5 T5.1):
 *  - ROOT mode (no `onBackToWall` — the MANAGED/STANDALONE 总览): the
 *    project page renders as ROOT — NO back affordance, NO aggregate
 *    strip (the 聚合条 is HUB-only);
 *  - DRILL mode (`onBackToWall` — the HUB card wall's drill target): the
 *    ← 返回总览 back button fires the callback (the wall re-renders);
 *  - the drill chain stays INSIDE the console: 项目 → 主题 (the topic
 *    page renders over the same store; the back chain is linear).
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// BEFORE any console import (the console transitively loads the
// workstream page → the WP-4.5 graph → @xyflow/react; the mock renders
// the node/edge layer for real, the WP-4.5 test-layer pattern).
import '../graph/xyflow-mock.js'

import {
  mountResearchRemotes,
  unmountResearchRemotes,
  type RemoteContext,
} from '../../src/client/dsh-adapter/remote/mount.js'
import { ProjectConsole } from '../../src/client/views/shell/project-console.js'
import { makeStubRpc, type StubRpc } from '../stores/stub-rpc.js'

/** Mount the stub facade as the production `researchRpc` (the store's
 *  factory binds it at mount time — the plugin's own seam, no cordis). */
async function mountStub(stub: StubRpc): Promise<void> {
  const fakeCtx = {
    remote: {
      $mount: async (): Promise<() => void> => () => undefined,
      researchControl: stub.rpc,
    },
  } as unknown as RemoteContext
  await mountResearchRemotes(fakeCtx)
}

function renderConsole(onBackToWall?: () => void): void {
  render(
    <StrictMode>
      <ProjectConsole onBackToWall={onBackToWall} />
    </StrictMode>,
  )
}

afterEach(() => {
  cleanup()
  unmountResearchRemotes()
})

describe('ProjectConsole — root mode (MANAGED/STANDALONE 总览)', () => {
  it('renders the project page AS ROOT: no back affordance, no aggregate strip', async () => {
    await mountStub(makeStubRpc())
    renderConsole()

    // The project page (the stub's single project PRJ-1).
    expect(await screen.findByText(/PRJ-1 · Project One/)).toBeTruthy()
    expect(document.querySelector('[data-project-console-page="project"]')).toBeTruthy()
    // NO aggregate strip (the 聚合条 is HUB-only — 总览 as root is the
    // existing project page: brief + 目标 + topic list).
    expect(document.querySelector('[data-hub-overview]')).toBeNull()
    // NO back affordance (root mode — there is no previous level).
    expect(screen.queryByRole('button', { name: '← 返回总览' })).toBeNull()
  })
})

describe('ProjectConsole — drill mode (HUB 钻取)', () => {
  it('the ← 返回总览 back button fires onBackToWall (the wall re-renders)', async () => {
    await mountStub(makeStubRpc())
    const onBackToWall = vi.fn()
    renderConsole(onBackToWall)

    expect(await screen.findByText(/PRJ-1 · Project One/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '← 返回总览' }))
    expect(onBackToWall).toHaveBeenCalledTimes(1)
  })
})

describe('ProjectConsole — 钻取链 (stays inside the console)', () => {
  it('项目 → 主题: the topic list click opens the topic page; the back chain is linear', async () => {
    await mountStub(makeStubRpc())
    renderConsole()

    await screen.findByText(/PRJ-1 · Project One/)
    // The topic list renders the stub's single topic (TPC-1).
    fireEvent.click(screen.getByRole('button', { name: /Topic One/ }))
    await waitFor(() => {
      expect(document.querySelector('[data-project-console-page="topic"]')).toBeTruthy()
    })
    // The topic page loaded the REAL topic data: the WS-1 workstream
    // card is present and CLICKABLE (the drill into the workstream page).
    // (findByText('Workstream One') is ambiguous — the graph layer renders
    // the same title as a non-interactive node label.)
    expect(await screen.findByRole('button', { name: /Workstream One/ })).toBeTruthy()

    // Linear back: the topic page's back returns to the project page.
    fireEvent.click(screen.getByRole('button', { name: '← 返回总览' }))
    await waitFor(() => {
      expect(document.querySelector('[data-project-console-page="project"]')).toBeTruthy()
    })
    expect(screen.getByText(/PRJ-1 · Project One/)).toBeTruthy()
  })
})
