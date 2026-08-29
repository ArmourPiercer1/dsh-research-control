// @vitest-environment jsdom
/**
 * WP-4.7 — cockpit navigation flow tests (G4 S1): Home → Project →
 * Topic → Workstream and back.
 *
 * Runs the REAL `createResearchStore` (the stub facade injected through
 * the mount seam — the cockpit creates its OWN store internally) around
 * the REAL cockpit component tree, pinning the in-tab page-stack wiring
 * at the user-visible level:
 *  - the Home project card (the stretched hit button) opens the §27.2
 *    project page (the cockpit's page state flips to `project`);
 *  - the project page renders the §27.2 face from the `getProject` slice
 *    (brief + objective statements + the topic sections);
 *  - the project page's topic section drills into the topic page
 *    (UI-3 IA: the section is a disclosure — expand it, then the
 *    Topology shortcut), whose workstream card drills into the
 *    workstream page;
 *  - 返回 from the project page (and from the workstream page) returns
 *    home.
 *
 * The topic page mounts the real React Flow topology canvas — the mock
 * renders the node/edge layer for real (WP-4.5 test-layer pattern), so
 * the xyflow mock is imported BEFORE any cockpit import.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

// BEFORE any cockpit import (the ws/topic pages mount the WP-4.5 graph —
// the real React Flow runtime needs browser layout surfaces jsdom lacks).
import '../graph/xyflow-mock.js'

import { ResearchCockpit } from '../../src/client/views/drilldown'
import {
  mountResearchRemotes,
  unmountResearchRemotes,
  type RemoteContext,
} from '../../src/client/dsh-adapter/remote/mount.js'
import { makeStubRpc, type StubRpc } from '../stores/stub-rpc.js'
import {
  DRILLDOWN_DASHBOARD,
  DRILLDOWN_HISTORY,
  DRILLDOWN_TOPIC,
  DRILLDOWN_WORKSTREAM,
} from '../views-drilldown/fixtures'
import { PROJECT_PAGE_FIXTURE } from './fixtures'

afterEach(() => {
  cleanup()
  // Drop the facade binding (the cockpit's store resolves the facade at
  // CALL time — the next test re-mounts its own stub).
  unmountResearchRemotes()
})

/** Fresh stub pre-configured with the project-page flow fixtures. */
function makeStub(): StubRpc {
  const stub = makeStubRpc()
  stub.set('getDashboard', { ok: true, value: DRILLDOWN_DASHBOARD })
  stub.set('getProject', { ok: true, value: PROJECT_PAGE_FIXTURE })
  stub.set('getTopic', { ok: true, value: DRILLDOWN_TOPIC })
  stub.set('getWorkstream', { ok: true, value: DRILLDOWN_WORKSTREAM })
  stub.set('queryHistory', { ok: true, value: DRILLDOWN_HISTORY })
  return stub
}

/**
 * Mount the stub facade as the production `researchRpc` (the cockpit
 * creates its OWN store internally — the mount seam is the only
 * production injection point; the store's default facade resolves
 * `boundRemote` per call).
 */
async function mountStub(stub: StubRpc): Promise<void> {
  const fakeCtx = {
    remote: {
      $mount: async (): Promise<() => void> => () => undefined,
      researchControl: stub.rpc,
    },
  } as unknown as RemoteContext
  await mountResearchRemotes(fakeCtx)
}

function renderCockpit(): void {
  render(
    <StrictMode>
      <ResearchCockpit />
    </StrictMode>,
  )
}

describe('ResearchCockpit — Home → Project → Topic → Workstream (G4 S1 flow)', () => {
  it('the project card opens the §27.2 project page (brief + objectives + topic list)', async () => {
    const stub = makeStub()
    await mountStub(stub)
    renderCockpit()
    await screen.findByText('研究总览')

    // The Home project card's entry (the stretched hit button).
    const entry: Element = await waitFor(() => {
      const el = document.querySelector('[data-project-card]')
      expect(el).toBeTruthy()
      return el as Element
    })
    fireEvent.click(entry)

    // The cockpit's page state flips to the project page.
    await waitFor(() => {
      expect(document.querySelector('[data-cockpit-page="project"]')).toBeTruthy()
    })
    // The §27.2 face renders from the getProject slice.
    await screen.findByText('完成凝聚态物理关键方向的系统综述', {}, { timeout: 2000 })
    expect(screen.getByRole('heading', { level: 1, name: /PRJ-1 · 凝聚态方向综述/ })).toBeDefined()
    expect(screen.getByText('追踪关键方向进展并整理证据链')).toBeDefined()
    expect(screen.getByRole('button', { name: /高温超导/ })).toBeDefined()
    expect(screen.getAllByText('待 Phase 5')).toHaveLength(2)

    // The getProject slice was fetched exactly once (lazy + deduped).
    await waitFor(() => {
      expect(stub.countOf('getProject')).toBe(1)
    })
  })

  it('drills Home → Project → Topic → Workstream, and 返回 walks back home', async () => {
    const stub = makeStub()
    await mountStub(stub)
    renderCockpit()
    await screen.findByText('研究总览')

    // (1) Home → Project (the project card entry).
    const entry: Element = await waitFor(() => {
      const el = document.querySelector('[data-project-card]')
      expect(el).toBeTruthy()
      return el as Element
    })
    fireEvent.click(entry)
    await waitFor(() => {
      expect(document.querySelector('[data-cockpit-page="project"]')).toBeTruthy()
    })
    await screen.findByText('追踪关键方向进展并整理证据链', {}, { timeout: 2000 })

    // (2) Project → Topic (UI-3 IA: the topic section is a disclosure —
    // expand it, then the Topology shortcut drills to the topic page).
    fireEvent.click(screen.getByRole('button', { name: /高温超导/ }))
    const viewTopology: Element = await waitFor(
      () => {
        const el = document.querySelector('[data-topic-topology]')
        expect(el).toBeTruthy()
        return el as Element
      },
      { timeout: 2000 },
    )
    fireEvent.click(viewTopology)
    await waitFor(() => {
      expect(document.querySelector('[data-cockpit-page="topic"]')).toBeTruthy()
    })
    await screen.findByText('TPC-1 · 高温超导', {}, { timeout: 2000 })

    // (3) Topic → Workstream (the WS-1 summary card).
    const wsCard: Element = await waitFor(() => {
      const el = document.querySelector('button[data-ws-id="WS-1"]')
      expect(el).toBeTruthy()
      return el as Element
    })
    fireEvent.click(wsCard)
    await waitFor(() => {
      expect(document.querySelector('[data-cockpit-page="ws"]')).toBeTruthy()
    })
    await screen.findByText('高温超导机制研究', {}, { timeout: 2000 })

    // (4) 返回 from the workstream page → home.
    const back = [...document.querySelectorAll('[data-cockpit-page="ws"] button')].find(
      (b) => b.textContent === '← 返回',
    )
    expect(back).toBeTruthy()
    fireEvent.click(back!)
    await waitFor(() => {
      expect(document.querySelector('[data-cockpit-page="home"]')).toBeTruthy()
    })
    expect(document.querySelector('[data-cockpit-page="project"]')).toBeNull()
  })

  it('返回 from the project page goes straight home', async () => {
    const stub = makeStub()
    await mountStub(stub)
    renderCockpit()
    await screen.findByText('研究总览')

    const entry: Element = await waitFor(() => {
      const el = document.querySelector('[data-project-card]')
      expect(el).toBeTruthy()
      return el as Element
    })
    fireEvent.click(entry)
    await waitFor(() => {
      expect(document.querySelector('[data-cockpit-page="project"]')).toBeTruthy()
    })

    const back = [...document.querySelectorAll('[data-cockpit-page="project"] button')].find(
      (b) => b.textContent === '← 返回总览',
    )
    expect(back).toBeTruthy()
    fireEvent.click(back!)
    await waitFor(() => {
      expect(document.querySelector('[data-cockpit-page="home"]')).toBeTruthy()
    })
  })
})
