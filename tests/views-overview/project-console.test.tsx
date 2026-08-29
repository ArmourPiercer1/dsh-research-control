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
    // The topic section renders the stub's single topic (TPC-1), collapsed
    // by default. (The name 'Topic One' is NOT a plain role query anymore —
    // the structure tree renders a same-named rail button, so scope to the
    // section toggle.)
    fireEvent.click(document.querySelector('[data-topic-toggle]') as Element)
    // The expanded section's Topology shortcut is the drill into the topic
    // page (UI-3: the section itself only expands/collapses).
    fireEvent.click(await screen.findByRole('button', { name: 'View topology' }))
    await waitFor(() => {
      expect(document.querySelector('[data-project-console-page="topic"]')).toBeTruthy()
    })
    // The topic page loaded the REAL topic data: the WS-1 workstream
    // card is present and CLICKABLE (the drill into the workstream page).
    // (Scoping: the graph layer renders the same title as a
    // non-interactive node label, and the structure tree auto-expands
    // the topic, adding a same-named [data-tree-ws] rail button — the
    // CARD is the button without the data-tree-ws attribute.)
    expect(
      Array.from(document.querySelectorAll('button[data-ws-id="WS-1"]')).some(
        (el) => !el.hasAttribute('data-tree-ws'),
      ),
    ).toBe(true)

    // Linear back: the topic page's back returns to the project page.
    fireEvent.click(screen.getByRole('button', { name: '← 返回总览' }))
    await waitFor(() => {
      expect(document.querySelector('[data-project-console-page="project"]')).toBeTruthy()
    })
    expect(screen.getByText(/PRJ-1 · Project One/)).toBeTruthy()
  })
})

/** Drill project → topic (the section's Topology shortcut) → workstream
 *  (the WS card). Shared by the breadcrumb-depth tests. */
async function drillToWorkstream(): Promise<void> {
  // the topic section (collapsed by default) → expand → the Topology
  // shortcut (scope the toggle — the tree rail has a same-named button)
  fireEvent.click(document.querySelector('[data-topic-toggle]') as Element)
  fireEvent.click(await screen.findByRole('button', { name: 'View topology' }))
  await waitFor(() => {
    expect(document.querySelector('[data-project-console-page="topic"]')).toBeTruthy()
  })
  // the topic page's WS card → the workstream page (scoped — the tree
  // auto-expands the topic and adds a same-named [data-tree-ws] row)
  const wsCard = Array.from(document.querySelectorAll('button[data-ws-id="WS-1"]')).find(
    (el) => !el.hasAttribute('data-tree-ws'),
  ) as Element
  fireEvent.click(wsCard)
  await waitFor(() => {
    expect(document.querySelector('[data-project-console-page="ws"]')).toBeTruthy()
  })
}

describe('ProjectConsole — UI-3 D7 breadcrumb (B §2.3)', () => {
  it('project depth: two levels, current span, no back affordance in root mode', async () => {
    await mountStub(makeStubRpc())
    renderConsole()
    await screen.findByText(/PRJ-1 · Project One/)

    const crumb = document.querySelector('[data-project-breadcrumb]')
    expect(crumb).not.toBeNull()
    // root crumb: a STATIC span in root mode (no onBackToWall — there is
    // no wall to return to), not a button
    const root = document.querySelector('[data-breadcrumb-root]')
    expect(root?.textContent).toBe('Research Control')
    expect(screen.queryByRole('button', { name: 'Research Control' })).toBeNull()
    // project crumb: the CURRENT level → a static span, not a button
    // (the tree rail keeps a same-named project button — so assert the
    // breadcrumb element's tag rather than a global role query)
    const projectCrumb = document.querySelector('[data-breadcrumb-project]')
    expect(projectCrumb?.textContent).toBe('Project One')
    expect(projectCrumb?.tagName).toBe('SPAN')
    // no topic/ws levels at project depth
    expect(document.querySelector('[data-breadcrumb-topic]')).toBeNull()
    expect(document.querySelector('[data-breadcrumb-ws]')).toBeNull()
  })

  it('drill mode: the root crumb is a button firing onBackToWall', async () => {
    await mountStub(makeStubRpc())
    const onBackToWall = vi.fn()
    renderConsole(onBackToWall)
    await screen.findByText(/PRJ-1 · Project One/)

    fireEvent.click(screen.getByRole('button', { name: 'Research Control' }))
    expect(onBackToWall).toHaveBeenCalledTimes(1)
  })

  it('ws depth: four levels; the topic + ws titles lazy-load; the project crumb is a back button', async () => {
    await mountStub(makeStubRpc())
    renderConsole()
    await screen.findByText(/PRJ-1 · Project One/)
    await drillToWorkstream()

    // four levels in order: Research Control / Project One / Topic One /
    // Workstream One (the topic + ws titles come from the owning topic's
    // slice — one lazy loadTopic fills both crumbs)
    expect(document.querySelector('[data-breadcrumb-root]')?.textContent).toBe('Research Control')
    await waitFor(() => {
      expect(document.querySelector('[data-breadcrumb-topic]')?.textContent).toBe('Topic One')
      expect(document.querySelector('[data-breadcrumb-ws]')?.textContent).toBe('Workstream One')
    })
    // the project crumb BECOMES a button at ws depth (tag check — the tree
    // rail keeps a same-named button) → back to the project page (and the
    // topic/ws levels drop off again)
    const projectCrumb = document.querySelector('[data-breadcrumb-project]')
    expect(projectCrumb?.tagName).toBe('BUTTON')
    fireEvent.click(projectCrumb as Element)
    await waitFor(() => {
      expect(document.querySelector('[data-project-console-page="project"]')).toBeTruthy()
    })
    expect(document.querySelector('[data-breadcrumb-topic]')).toBeNull()
    expect(document.querySelector('[data-breadcrumb-ws]')).toBeNull()
    // the project crumb is the current span again
    const currentCrumb = document.querySelector('[data-breadcrumb-project]')
    expect(currentCrumb?.textContent).toBe('Project One')
    expect(currentCrumb?.tagName).toBe('SPAN')
  })
})

describe('ProjectConsole — UI-3 D4 structure tree rail (B §7.2)', () => {
  it('the rail renders beside the page with the project row', async () => {
    await mountStub(makeStubRpc())
    renderConsole()
    await screen.findByText(/PRJ-1 · Project One/)

    expect(document.querySelector('[data-structure-tree]')).not.toBeNull()
    expect(document.querySelector('[data-tree-project]')?.textContent).toContain('Project One')
    // the stub's single topic row renders under the project row
    expect(document.querySelector('[data-tree-topic][data-topic-id="TPC-1"]')).not.toBeNull()
  })
})
