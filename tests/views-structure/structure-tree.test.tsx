// @vitest-environment jsdom
/**
 * V2-UI-0.4 UI-3 — the Project structure tree (B §1.5 / §7.2 / §8.1-8.4):
 * the console's left rail.
 *
 * Runs the REAL `createResearchStore` (the stub facade through the store's
 * `rpc` seam — same discipline as the project-container tests) around the
 * REAL `StructureTree`, pinning at the user-visible level:
 *  - the expanded form (B §8.1): the Project row (click → Project
 *    Overview, the console's own navigation — judgment #12) + the Topic
 *    rows (expand/collapse controls) + the lazy Workstream rows (click →
 *    the Workstream Workspace);
 *  - plan §24 laziness: the tree fetches NOTHING before a topic is
 *    expanded (zero getTopic calls);
 *  - the current-item highlight (B §8.3 / judgment #12): on a ws page
 *    the WS row is marked current (its owning topic auto-expanded so the
 *    highlight is visible); on the project page the Project row is;
 *  - the collapsed form (B §8.2): the narrow rail keeping the reopen
 *    affordance + the current project marker; the collapse is
 *    user-controlled;
 *  - the create entries (B §8.4): the tree-top + Topic and the per-topic
 *    + (both open the shared dialogs — the tree-side instances);
 *  - the fault faces: the project slice error + the topic slice error.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// BEFORE any shell import (the convention guard — the console's page
// imports transitively reach the WP-4.5 graph; the tree itself stays
// graph-free, the mock only future-proofs this suite).
import '../graph/xyflow-mock.js'

import { createResearchStore, type ResearchStore } from '../../src/client/stores'
import { StructureTree } from '../../src/client/views/shell/structure-tree.js'
import type { ConsolePage } from '../../src/client/views/shell/project-console.js'
import { makeStubRpc, type StubRpc } from '../stores/stub-rpc.js'

afterEach(cleanup)

interface RenderTreeOptions {
  /** The console stack top (default: the project overview page). */
  readonly page?: ConsolePage
  /** A pre-configured stub (default: fresh). */
  readonly rpc?: StubRpc
}

function renderTree(options: RenderTreeOptions = {}) {
  const rpc = options.rpc ?? makeStubRpc()
  const store = createResearchStore({ rpc: rpc.rpc })
  const onOpenProject = vi.fn()
  const onOpenWorkstream = vi.fn()
  const utils = render(
    <StrictMode>
      <StructureTree
        store={store}
        page={options.page ?? { kind: 'project' }}
        onOpenProject={onOpenProject}
        onOpenWorkstream={onOpenWorkstream}
      />
    </StrictMode>,
  )
  return { store, rpc, onOpenProject, onOpenWorkstream, ...utils }
}

/** The tree SUBSCRIBES to the console's store — the console issues the
 *  project's first load. Mirror that, then wait for the ready face. */
async function settleProject(store: ResearchStore): Promise<void> {
  void store.loadProject().catch(() => undefined)
  await screen.findByText('Project One', {}, { timeout: 2000 })
}

/** Expand TPC-1 and wait for its (stub) workstream rows. */
async function expandFirstTopic(): Promise<Element> {
  const topic = document.querySelector('[data-tree-topic][data-topic-id="TPC-1"]')
  expect(topic).toBeTruthy()
  fireEvent.click(topic as Element)
  const ws = await screen.findByText('Workstream One', {}, { timeout: 2000 })
  return ws.closest('[data-tree-ws]') as Element
}

describe('the expanded form (B §8.1)', () => {
  it('renders the Project row + the Topic rows from the project slice (nothing below)', async () => {
    const { store } = renderTree()
    await settleProject(store)

    const projectRow = document.querySelector('[data-tree-project]')
    expect(projectRow).not.toBeNull()
    expect(projectRow?.textContent).toContain('Project One')
    // the project page: the Project row IS the current item
    expect(projectRow?.getAttribute('data-tree-current')).toBe('true')

    const topicRow = document.querySelector('[data-tree-topic][data-topic-id="TPC-1"]')
    expect(topicRow).not.toBeNull()
    expect(topicRow?.textContent).toContain('Topic One')
    expect(topicRow?.getAttribute('aria-expanded')).toBe('false')

    // collapsed by default → no workstream rows, nothing fetched
    expect(document.querySelector('[data-tree-ws]')).toBeNull()
  })

  it('fetches NOTHING before expansion (plan §24)', async () => {
    const { store, rpc } = renderTree()
    await settleProject(store)
    expect(rpc.countOf('getTopic')).toBe(0)
    // one expansion → exactly one getTopic (the in-flight dedupe keeps a
    // double-issue — StrictMode — a no-op)
    const topic = document.querySelector('[data-tree-topic][data-topic-id="TPC-1"]')
    fireEvent.click(topic as Element)
    await screen.findByText('Workstream One', {}, { timeout: 2000 })
    await waitFor(() => {
      expect(rpc.countOf('getTopic')).toBe(1)
    })
  })

  it('expanding a topic lazily loads it and renders the Workstream rows', async () => {
    const { store, rpc } = renderTree()
    await settleProject(store)
    expect(rpc.countOf('getTopic')).toBe(0)

    const wsRow = await expandFirstTopic()
    expect(rpc.countOf('getTopic')).toBe(1)
    expect(wsRow.getAttribute('data-ws-id')).toBe('WS-1')
    // the toggle flips to expanded
    expect(document.querySelector('[data-tree-topic][data-topic-id="TPC-1"]')?.getAttribute('aria-expanded')).toBe('true')
    // collapse again (the Topic row is a pure expand/collapse control)
    fireEvent.click(document.querySelector('[data-tree-topic][data-topic-id="TPC-1"]') as Element)
    expect(document.querySelector('[data-tree-ws]')).toBeNull()
  })

  it('clicking a Workstream row fires onOpenWorkstream(wsId, topicId) — the console navigation', async () => {
    const { store, onOpenWorkstream } = renderTree()
    await settleProject(store)
    const wsRow = await expandFirstTopic()
    fireEvent.click(wsRow)
    expect(onOpenWorkstream).toHaveBeenCalledTimes(1)
    expect(onOpenWorkstream).toHaveBeenCalledWith('WS-1', 'TPC-1')
  })

  it('clicking the Project row fires onOpenProject (B §8.1 → Overview)', async () => {
    const { store, onOpenProject } = renderTree()
    await settleProject(store)
    fireEvent.click(document.querySelector('[data-tree-project]') as Element)
    expect(onOpenProject).toHaveBeenCalledTimes(1)
  })
})

describe('the current-item highlight (B §8.3 / judgment #12)', () => {
  it('on a ws page the WS row is current (owning topic auto-expanded); the Project row is not', async () => {
    const { store } = renderTree({ page: { kind: 'ws', workstreamId: 'WS-1', topicId: 'TPC-1' } })
    await settleProject(store)
    // the auto-expand fired the lazy topic load — wait for the row
    const ws = await screen.findByText('Workstream One', {}, { timeout: 2000 })
    const wsRow = ws.closest('[data-tree-ws]') as Element
    expect(wsRow.getAttribute('data-tree-current')).toBe('true')
    expect(wsRow.getAttribute('aria-current')).toBe('true')
    expect(document.querySelector('[data-tree-project]')?.getAttribute('data-tree-current')).toBe('false')
    // the topic row is NOT the current item (only its child is)
    expect(document.querySelector('[data-tree-topic][data-topic-id="TPC-1"]')?.getAttribute('data-tree-current')).toBe('false')
  })
})

describe('the collapsed form (B §8.2)', () => {
  it('collapse → the narrow rail (project marker + reopen); reopen restores the tree', async () => {
    const { store } = renderTree()
    await settleProject(store)

    fireEvent.click(document.querySelector('[data-tree-collapse]') as Element)
    // the narrow rail: the project marker + the reopen affordance
    const collapsed = document.querySelector('[data-structure-tree-collapsed]')
    expect(collapsed).not.toBeNull()
    expect(document.querySelector('[data-structure-tree]')).toBeNull()
    expect(document.querySelector('[data-tree-project-marker]')?.textContent).toBe('PRJ-1')

    fireEvent.click(document.querySelector('[data-tree-reopen]') as Element)
    expect(document.querySelector('[data-structure-tree-collapsed]')).toBeNull()
    expect(document.querySelector('[data-structure-tree]')).not.toBeNull()
    // the previous state is kept (local state, not remounted)
    expect(document.querySelector('[data-tree-project]')).not.toBeNull()
  })
})

describe('the create entries (B §8.4)', () => {
  it('the tree-top + Topic opens the shared create-topic dialog', async () => {
    const { store } = renderTree()
    await settleProject(store)
    fireEvent.click(document.querySelector('[data-tree-create-topic]') as Element)
    expect(document.querySelector('[data-create-topic-dialog]')).not.toBeNull()
  })

  it('the per-topic + opens the shared create-workstream dialog (owning topic in the context line)', async () => {
    const { store } = renderTree()
    await settleProject(store)
    fireEvent.click(
      document.querySelector('[data-tree-create-workstream][data-topic-id="TPC-1"]') as Element,
    )
    expect(document.querySelector('[data-create-workstream-dialog]')).not.toBeNull()
    // the dialog carries the owning topic's title as its context line
    expect(document.querySelector('[data-create-workstream-topic]')?.textContent).toContain('Topic One')
  })
})

describe('the fault faces', () => {
  it('a first-load project fault renders the tree error face (the decoded fault)', async () => {
    const rpc = makeStubRpc()
    rpc.set('getProject', { ok: false, error: { code: 'HIER_INPUT', message: 'no such project' } })
    const { store } = renderTree({ rpc })
    // the CONSOLE issues the project's first load — mirror it
    void store.loadProject().catch(() => undefined)
    expect(await screen.findByRole('alert')).toBeDefined()
    expect(document.querySelector('[data-structure-tree-error]')?.textContent).toBe(
      'HIER_INPUT: no such project',
    )
  })

  it('a failed topic load renders the per-topic error face (no data)', async () => {
    const rpc = makeStubRpc()
    rpc.set('getTopic', { ok: false, error: { code: 'HIER_INPUT', message: 'no such topic' } })
    const { store } = renderTree({ rpc })
    await settleProject(store)
    const topic = document.querySelector('[data-tree-topic][data-topic-id="TPC-1"]')
    fireEvent.click(topic as Element)
    expect(await screen.findByRole('alert')).toBeDefined()
    expect(document.querySelector('[data-tree-topic-error]')?.textContent).toBe('加载失败')
    expect(document.querySelector('[data-tree-ws]')).toBeNull()
  })
})
