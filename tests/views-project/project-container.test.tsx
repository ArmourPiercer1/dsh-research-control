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
 *
 * V2-UI-0.4 UI-3 FR7 — the Recent History CONTAINER contract (judgment
 * #9) is pinned here (the view tests pin only the presentation of the
 * pre-sorted face):
 *  - collapsed default → ZERO topic / history fetches on initial render;
 *  - one `queryHistory({workstreamId, limit: 200})` window per
 *    workstream (plan order), the last 3 events of each window BY
 *    occurredAt (independent of the RPC row order), merged
 *    occurredAt-desc with the strict full order asserted per entry;
 *  - the 20-workstream cap in plan order: exactly 20 usable → no note,
 *    22 usable → the first 20 contribute, the `showing first 20
 *    workstreams` note renders, the excluded 2 are never fetched;
 *  - a failed topic slice (business fault) contributes 0 workstreams —
 *    the other topics merge normally and the topic is not refetched;
 *  - the empty-state face (no usable workstreams at all; workstreams
 *    whose every window is empty).
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createResearchStore } from '../../src/client/stores'
import { ProjectPage, formatEpochDate } from '../../src/client/views/project'
import { makeStubRpc, type StubRpc } from '../stores/stub-rpc.js'
import { PROJECT_PAGE_FIXTURE } from './fixtures'
import {
  ProjectSnapshotSchema,
  QueryHistoryResultSchema,
  TopicSnapshotSchema,
  type HistoryEventDto,
  type ProjectSnapshot,
  type QueryHistoryResult,
  type TopicSnapshot,
} from '../../src/shared/rpc-contracts.js'

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
  it('topic section → Topology shortcut → onOpenTopic(topicId); 返回 → onBack', async () => {
    const onOpenTopic = vi.fn()
    const onBack = vi.fn()
    renderContainer({ onOpenTopic, onBack })
    await screen.findByRole('button', { name: /高温超导/ }, { timeout: 2000 })

    // UI-3 IA: the toggle expands the section (the container lazily
    // loads the topic slice — the stub answers TOPIC_FIXTURE), then the
    // Topology shortcut is the drill into the topic page.
    fireEvent.click(screen.getByRole('button', { name: /高温超导/ }))
    const viewTopology = await screen.findByRole('button', { name: 'View topology' }, { timeout: 2000 })
    fireEvent.click(viewTopology)
    expect(onOpenTopic).toHaveBeenCalledTimes(1)
    expect(onOpenTopic).toHaveBeenCalledWith('TPC-1')

    fireEvent.click(screen.getByRole('button', { name: '← 返回总览' }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})

/* -- V2-UI-0.4 UI-3 FR7: the Recent History container contract
 *    (judgment #9) — fixtures, DOM re-parse, and the pinned behaviors --
 *
 * The stub facade has no per-argument routing: outcomes are pinned as
 * per-call SEQUENCES (tests/stores/stub-rpc.ts), consumed in exactly the
 * order the container issues them — Phase 1 loads the idle topic slices
 * in PLAN order (one getTopic per call), Phase 3 issues one queryHistory
 * per window in PLAN order. The sequences below encode the plan order
 * directly, and the call-log assertions re-parse the recorded args to
 * pin that order verbatim.
 */

const RH_T = 1755000000000

interface RhTopicCard {
  readonly id: string
  readonly title: string
  readonly workstreamCount: number
}

interface RhWsRef {
  readonly id: string
  readonly title: string
}

/** A wire-valid project snapshot (re-parsed through the strict schema —
 *  a fixture that drifts from the frozen contract fails the suite). */
function makeRhProject(topics: readonly RhTopicCard[]): ProjectSnapshot {
  const fixture: ProjectSnapshot = {
    project: {
      id: 'PRJ-9',
      title: 'Recent History 容器项目',
      description: null,
      importance: 0,
      attentionMode: 'BACKGROUND',
      targetDate: null,
      currentObjectiveRefs: [],
      createdAt: RH_T,
    },
    objectives: [],
    topics: [...topics],
    upcomingInteractions: null,
    upcomingReporting: null,
  }
  ProjectSnapshotSchema.parse(fixture)
  return fixture
}

/** A wire-valid topic snapshot; its workstream cards drive the merge. */
function makeRhTopic(topicId: string, title: string, workstreams: readonly RhWsRef[]): TopicSnapshot {
  const fixture: TopicSnapshot = {
    topic: {
      id: topicId,
      title,
      description: null,
      importance: null,
      attentionMode: null,
      objectiveRefs: [],
      createdAt: RH_T,
    },
    workstreams: workstreams.map(ws => ({
      id: ws.id,
      title: ws.title,
      lifecycle: 'REALIZED',
      summary: null,
      planItemCount: 0,
      openPlanForkCount: 0,
      runningRunCount: 0,
    })),
    topology: { edges: [] },
    mergeContracts: [],
    objectives: [],
  }
  TopicSnapshotSchema.parse(fixture)
  return fixture
}

/** One wire-valid event. `eventType` defaults to the eventId so every
 *  row carries a DOM identity tag (the li renders the type verbatim). */
function makeRhEvent(eventId: string, wsId: string, occurredAt: number, eventType: string = eventId): HistoryEventDto {
  return {
    eventId,
    ownerWorkstreamId: wsId,
    eventType,
    schemaVersion: 1,
    occurredAt,
    actor: { kind: 'USER', user_id: 'u-1' },
    source: null,
    payload: {},
    eventSeq: 1,
    recordedAt: occurredAt,
  }
}

/** A wire-valid single-page `queryHistory` window (exhausted). */
function makeRhHistory(events: readonly HistoryEventDto[]): QueryHistoryResult {
  const fixture: QueryHistoryResult = { events: [...events], nextAfterSeq: null, exhausted: true }
  QueryHistoryResultSchema.parse(fixture)
  return fixture
}

/** One rendered history row, re-parsed from the DOM (date / ws label /
 *  event-type tag) — the strict per-entry assertion target. */
interface RhRow {
  readonly date: string
  readonly wsLabel: string
  readonly eventType: string
}

function readHistoryRows(): RhRow[] {
  return [...document.querySelectorAll('[data-history-entry]')].map(li => {
    const spans = [...li.querySelectorAll('span')]
    const typeSpan = li.querySelector('[data-history-event-type]')
    return {
      date: spans[0]?.textContent ?? '',
      wsLabel: spans[1]?.textContent ?? '',
      eventType: typeSpan?.getAttribute('data-history-event-type') ?? '',
    }
  })
}

/** Await the project face, expand Recent History, and wait for the
 *  settled face (the entries OR the empty state — the loading face is
 *  gone by then). */
async function expandRecentHistory(): Promise<void> {
  await screen.findByRole('heading', { level: 1, name: /PRJ-9/ }, { timeout: 2000 })
  fireEvent.click(screen.getByRole('button', { name: 'Recent History' }))
  await waitFor(
    () => {
      expect(
        document.querySelector('[data-history-entry]') ?? document.querySelector('[data-history-empty]'),
      ).not.toBeNull()
    },
    { timeout: 2000 },
  )
}

describe('ProjectPage container — Recent History (judgment #9, FR7)', () => {
  it('collapsed default: initial render issues ZERO topic / history fetches (no N+1)', async () => {
    const { rpc } = renderContainer({
      initial: { ok: true, value: makeRhProject([{ id: 'TPC-1', title: '方向甲', workstreamCount: 3 }]) },
    })

    await screen.findByRole('heading', { level: 1, name: /PRJ-9/ }, { timeout: 2000 })
    const toggle = screen.getByRole('button', { name: 'Recent History' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(document.querySelector('[data-history-entry]')).toBeNull()
    expect(rpc.countOf('getTopic')).toBe(0)
    expect(rpc.countOf('queryHistory')).toBe(0)
  })

  it('multi-topic / multi-WS: the LAST 3 events of each window are taken (by occurredAt, not RPC order), merged occurredAt-desc', async () => {
    const stub = makeStubRpc()
    // TPC-1: WS-1 (4 events → the oldest must drop out), WS-2 (3);
    // TPC-2: WS-3 (2).
    stub.set('getTopic', [
      {
        ok: true,
        value: makeRhTopic('TPC-1', '方向甲', [
          { id: 'WS-1', title: '标定管线' },
          { id: 'WS-2', title: '数据回流' },
        ]),
      },
      { ok: true, value: makeRhTopic('TPC-2', '方向乙', [{ id: 'WS-3', title: '长程验证' }]) },
    ])
    // Deliberately UNSORTED row orders (newest-first / scrambled) — the
    // tail-3 must come from occurredAt, not the array position.
    stub.set('queryHistory', [
      {
        ok: true,
        value: makeRhHistory([
          makeRhEvent('H-104', 'WS-1', RH_T + 400),
          makeRhEvent('H-101', 'WS-1', RH_T + 100),
          makeRhEvent('H-103', 'WS-1', RH_T + 300),
          makeRhEvent('H-102', 'WS-1', RH_T + 200),
        ]),
      },
      {
        ok: true,
        value: makeRhHistory([
          makeRhEvent('H-203', 'WS-2', RH_T + 350),
          makeRhEvent('H-202', 'WS-2', RH_T + 250),
          makeRhEvent('H-201', 'WS-2', RH_T + 150),
        ]),
      },
      {
        ok: true,
        value: makeRhHistory([
          makeRhEvent('H-301', 'WS-3', RH_T + 120),
          makeRhEvent('H-302', 'WS-3', RH_T + 320),
        ]),
      },
    ])
    const { rpc } = renderContainer({
      rpc: stub,
      initial: {
        ok: true,
        value: makeRhProject([
          { id: 'TPC-1', title: '方向甲', workstreamCount: 2 },
          { id: 'TPC-2', title: '方向乙', workstreamCount: 1 },
        ]),
      },
    })

    await expandRecentHistory()

    // Strict FULL order: every entry re-parsed (date / ws label / type tag).
    expect(readHistoryRows()).toEqual([
      { date: formatEpochDate(RH_T + 400), wsLabel: '标定管线（WS-1）', eventType: 'H-104' },
      { date: formatEpochDate(RH_T + 350), wsLabel: '数据回流（WS-2）', eventType: 'H-203' },
      { date: formatEpochDate(RH_T + 320), wsLabel: '长程验证（WS-3）', eventType: 'H-302' },
      { date: formatEpochDate(RH_T + 300), wsLabel: '标定管线（WS-1）', eventType: 'H-103' },
      { date: formatEpochDate(RH_T + 250), wsLabel: '数据回流（WS-2）', eventType: 'H-202' },
      { date: formatEpochDate(RH_T + 200), wsLabel: '标定管线（WS-1）', eventType: 'H-102' },
      { date: formatEpochDate(RH_T + 150), wsLabel: '数据回流（WS-2）', eventType: 'H-201' },
      { date: formatEpochDate(RH_T + 120), wsLabel: '长程验证（WS-3）', eventType: 'H-301' },
    ])

    // The WS-1 window carried 4 events: the OLDEST (H-101) is dropped.
    expect(readHistoryRows().map(row => row.eventType)).not.toContain('H-101')
    expect(readHistoryRows().filter(row => row.wsLabel === '标定管线（WS-1）')).toHaveLength(3)

    // One `limit: 200` window per workstream, fetched in plan order.
    expect(rpc.callsTo('queryHistory').map(call => call.args)).toEqual([
      { workstreamId: 'WS-1', limit: 200 },
      { workstreamId: 'WS-2', limit: 200 },
      { workstreamId: 'WS-3', limit: 200 },
    ])
    expect(document.querySelector('[data-history-note]')).toBeNull()
  })

  it('interleaved occurredAt across 4 workstreams of 2 topics: the strict full merge order is pinned per entry', async () => {
    const stub = makeStubRpc()
    stub.set('getTopic', [
      {
        ok: true,
        value: makeRhTopic('TPC-1', '方向甲', [
          { id: 'WS-1', title: '管线一' },
          { id: 'WS-2', title: '管线二' },
        ]),
      },
      {
        ok: true,
        value: makeRhTopic('TPC-2', '方向乙', [
          { id: 'WS-3', title: '管线三' },
          { id: 'WS-4', title: '管线四' },
        ]),
      },
    ])
    // 3 events per WS, timestamps INTERLEAVED across the workstreams;
    // each window's rows are passed in a non-ascending order on purpose
    // (the merge order must derive from occurredAt alone).
    stub.set('queryHistory', [
      {
        ok: true,
        value: makeRhHistory([
          makeRhEvent('H-103', 'WS-1', RH_T + 50),
          makeRhEvent('H-101', 'WS-1', RH_T + 10),
          makeRhEvent('H-102', 'WS-1', RH_T + 30),
        ]),
      },
      {
        ok: true,
        value: makeRhHistory([
          makeRhEvent('H-202', 'WS-2', RH_T + 31),
          makeRhEvent('H-203', 'WS-2', RH_T + 51),
          makeRhEvent('H-201', 'WS-2', RH_T + 11),
        ]),
      },
      {
        ok: true,
        value: makeRhHistory([
          makeRhEvent('H-303', 'WS-3', RH_T + 52),
          makeRhEvent('H-301', 'WS-3', RH_T + 12),
          makeRhEvent('H-302', 'WS-3', RH_T + 32),
        ]),
      },
      {
        ok: true,
        value: makeRhHistory([
          makeRhEvent('H-401', 'WS-4', RH_T + 13),
          makeRhEvent('H-403', 'WS-4', RH_T + 53),
          makeRhEvent('H-402', 'WS-4', RH_T + 33),
        ]),
      },
    ])
    const { rpc } = renderContainer({
      rpc: stub,
      initial: {
        ok: true,
        value: makeRhProject([
          { id: 'TPC-1', title: '方向甲', workstreamCount: 2 },
          { id: 'TPC-2', title: '方向乙', workstreamCount: 2 },
        ]),
      },
    })

    await expandRecentHistory()

    // Strict FULL merge order (occurredAt-desc, interleaved across WS):
    // +53 WS-4, +52 WS-3, +51 WS-2, +50 WS-1, +33 WS-4, +32 WS-3,
    // +31 WS-2, +30 WS-1, +13 WS-4, +12 WS-3, +11 WS-2, +10 WS-1.
    const label = (title: string, id: string): string => `${title}（${id}）`
    expect(readHistoryRows()).toEqual([
      { date: formatEpochDate(RH_T + 53), wsLabel: label('管线四', 'WS-4'), eventType: 'H-403' },
      { date: formatEpochDate(RH_T + 52), wsLabel: label('管线三', 'WS-3'), eventType: 'H-303' },
      { date: formatEpochDate(RH_T + 51), wsLabel: label('管线二', 'WS-2'), eventType: 'H-203' },
      { date: formatEpochDate(RH_T + 50), wsLabel: label('管线一', 'WS-1'), eventType: 'H-103' },
      { date: formatEpochDate(RH_T + 33), wsLabel: label('管线四', 'WS-4'), eventType: 'H-402' },
      { date: formatEpochDate(RH_T + 32), wsLabel: label('管线三', 'WS-3'), eventType: 'H-302' },
      { date: formatEpochDate(RH_T + 31), wsLabel: label('管线二', 'WS-2'), eventType: 'H-202' },
      { date: formatEpochDate(RH_T + 30), wsLabel: label('管线一', 'WS-1'), eventType: 'H-102' },
      { date: formatEpochDate(RH_T + 13), wsLabel: label('管线四', 'WS-4'), eventType: 'H-401' },
      { date: formatEpochDate(RH_T + 12), wsLabel: label('管线三', 'WS-3'), eventType: 'H-301' },
      { date: formatEpochDate(RH_T + 11), wsLabel: label('管线二', 'WS-2'), eventType: 'H-201' },
      { date: formatEpochDate(RH_T + 10), wsLabel: label('管线一', 'WS-1'), eventType: 'H-101' },
    ])
    expect(rpc.countOf('queryHistory')).toBe(4)
    expect(document.querySelector('[data-history-note]')).toBeNull()
  })

  it('20-workstream cap: 22 usable WS → only the FIRST 20 in plan order contribute, the note renders, the excluded 2 are never fetched', async () => {
    const stub = makeStubRpc()
    const tpc1 = Array.from({ length: 12 }, (_, i) => ({ id: `WS-${i + 1}`, title: `管线 ${i + 1}` }))
    const tpc2 = Array.from({ length: 10 }, (_, i) => ({ id: `WS-${i + 13}`, title: `管线 ${i + 13}` }))
    stub.set('getTopic', [
      { ok: true, value: makeRhTopic('TPC-1', '方向甲', tpc1) },
      { ok: true, value: makeRhTopic('TPC-2', '方向乙', tpc2) },
    ])
    // Only the first 20 windows (plan order) are ever fetched.
    stub.set(
      'queryHistory',
      Array.from({ length: 20 }, (_, i) => ({
        ok: true,
        value: makeRhHistory([makeRhEvent(`H-${i + 1}`, `WS-${i + 1}`, RH_T + (i + 1) * 1000)]),
      })),
    )
    const { rpc } = renderContainer({
      rpc: stub,
      initial: {
        ok: true,
        value: makeRhProject([
          { id: 'TPC-1', title: '方向甲', workstreamCount: 12 },
          { id: 'TPC-2', title: '方向乙', workstreamCount: 10 },
        ]),
      },
    })

    await expandRecentHistory()

    // Strict full order: WS-20 (the newest among the capped 20) … WS-1.
    const expected = Array.from({ length: 20 }, (_, rank) => {
      const i = 20 - rank
      return { date: formatEpochDate(RH_T + i * 1000), wsLabel: `管线 ${i}（WS-${i}）`, eventType: `H-${i}` }
    })
    expect(readHistoryRows()).toEqual(expected)

    // The >20 note renders; the excluded WS-21/WS-22 never appear and
    // were never fetched (the cap bounds the fetches, not just display).
    const note = document.querySelector('[data-history-note]')
    expect(note?.textContent).toBe('showing first 20 workstreams')
    const fetched = rpc.callsTo('queryHistory').map(call => call.args)
    expect(fetched).toHaveLength(20)
    expect(fetched).not.toContainEqual({ workstreamId: 'WS-21', limit: 200 })
    expect(fetched).not.toContainEqual({ workstreamId: 'WS-22', limit: 200 })
  })

  it('exactly 20 usable WS (the boundary): all 20 contribute, NO note (truncated only when MORE than 20)', async () => {
    const stub = makeStubRpc()
    const wsList = Array.from({ length: 20 }, (_, i) => ({ id: `WS-${i + 1}`, title: `管线 ${i + 1}` }))
    stub.set('getTopic', [{ ok: true, value: makeRhTopic('TPC-1', '方向甲', wsList) }])
    stub.set(
      'queryHistory',
      Array.from({ length: 20 }, (_, i) => ({
        ok: true,
        value: makeRhHistory([makeRhEvent(`H-${i + 1}`, `WS-${i + 1}`, RH_T + (i + 1) * 1000)]),
      })),
    )
    const { rpc } = renderContainer({
      rpc: stub,
      initial: { ok: true, value: makeRhProject([{ id: 'TPC-1', title: '方向甲', workstreamCount: 20 }]) },
    })

    await expandRecentHistory()

    const rows = readHistoryRows()
    expect(rows).toHaveLength(20)
    expect(rows[0]?.eventType).toBe('H-20')
    expect(rows[19]?.eventType).toBe('H-1')
    expect(document.querySelector('[data-history-note]')).toBeNull()
    expect(rpc.countOf('queryHistory')).toBe(20)
  })

  it('a FAILED topic slice (business fault) contributes 0 workstreams; the other topics merge normally', async () => {
    const stub = makeStubRpc()
    // TPC-2's getTopic business-faults — its 2 DECLARED workstreams must
    // contribute nothing (the topic section shows its own error face).
    stub.set('getTopic', [
      {
        ok: true,
        value: makeRhTopic('TPC-1', '方向甲', [
          { id: 'WS-1', title: '管线一' },
          { id: 'WS-2', title: '管线二' },
        ]),
      },
      { ok: false, error: { code: 'HIER_INPUT', message: 'no such topic' } },
      {
        ok: true,
        value: makeRhTopic('TPC-3', '方向丙', [
          { id: 'WS-5', title: '管线五' },
          { id: 'WS-6', title: '管线六' },
        ]),
      },
    ])
    // Plan order over the USABLE windows only: WS-1, WS-2, WS-5, WS-6.
    stub.set('queryHistory', [
      { ok: true, value: makeRhHistory([makeRhEvent('H-1', 'WS-1', RH_T + 1000)]) },
      { ok: true, value: makeRhHistory([makeRhEvent('H-2', 'WS-2', RH_T + 2000)]) },
      { ok: true, value: makeRhHistory([makeRhEvent('H-5', 'WS-5', RH_T + 3000)]) },
      { ok: true, value: makeRhHistory([makeRhEvent('H-6', 'WS-6', RH_T + 4000)]) },
    ])
    const { rpc } = renderContainer({
      rpc: stub,
      initial: {
        ok: true,
        value: makeRhProject([
          { id: 'TPC-1', title: '方向甲', workstreamCount: 2 },
          { id: 'TPC-2', title: '方向乙（失效）', workstreamCount: 2 },
          { id: 'TPC-3', title: '方向丙', workstreamCount: 2 },
        ]),
      },
    })

    await expandRecentHistory()

    expect(readHistoryRows()).toEqual([
      { date: formatEpochDate(RH_T + 4000), wsLabel: '管线六（WS-6）', eventType: 'H-6' },
      { date: formatEpochDate(RH_T + 3000), wsLabel: '管线五（WS-5）', eventType: 'H-5' },
      { date: formatEpochDate(RH_T + 2000), wsLabel: '管线二（WS-2）', eventType: 'H-2' },
      { date: formatEpochDate(RH_T + 1000), wsLabel: '管线一（WS-1）', eventType: 'H-1' },
    ])

    // No window was ever fetched for the failed topic's workstreams…
    expect(rpc.callsTo('queryHistory').map(call => call.args)).toEqual([
      { workstreamId: 'WS-1', limit: 200 },
      { workstreamId: 'WS-2', limit: 200 },
      { workstreamId: 'WS-5', limit: 200 },
      { workstreamId: 'WS-6', limit: 200 },
    ])
    // …and the failed topic was NOT refetched (one getTopic per topic).
    expect(rpc.countOf('getTopic')).toBe(3)
    expect(document.querySelector('[data-history-note]')).toBeNull()
  })

  it('no usable workstreams at all → the empty-state face (and ZERO history fetches)', async () => {
    const stub = makeStubRpc()
    stub.set('getTopic', [{ ok: true, value: makeRhTopic('TPC-1', '空方向', []) }])
    const { rpc } = renderContainer({
      rpc: stub,
      initial: { ok: true, value: makeRhProject([{ id: 'TPC-1', title: '空方向', workstreamCount: 0 }]) },
    })

    await expandRecentHistory()

    expect(screen.getByText('No history recorded yet.')).toBeDefined()
    expect(document.querySelector('[data-history-entry]')).toBeNull()
    expect(document.querySelector('[data-history-note]')).toBeNull()
    expect(rpc.countOf('queryHistory')).toBe(0)
  })

  it('workstreams exist but every window is empty → the SAME empty-state face (the merged-empty path)', async () => {
    const stub = makeStubRpc()
    stub.set('getTopic', [
      {
        ok: true,
        value: makeRhTopic('TPC-1', '方向甲', [
          { id: 'WS-1', title: '管线一' },
          { id: 'WS-2', title: '管线二' },
        ]),
      },
    ])
    // Both windows ARE fetched (the settle phase runs) — and come back empty.
    stub.set('queryHistory', [
      { ok: true, value: makeRhHistory([]) },
      { ok: true, value: makeRhHistory([]) },
    ])
    const { rpc } = renderContainer({
      rpc: stub,
      initial: {
        ok: true,
        value: makeRhProject([
          { id: 'TPC-1', title: '方向甲', workstreamCount: 2 },
        ]),
      },
    })

    await expandRecentHistory()

    expect(screen.getByText('No history recorded yet.')).toBeDefined()
    expect(document.querySelector('[data-history-entry]')).toBeNull()
    expect(document.querySelector('[data-history-note]')).toBeNull()
    expect(rpc.countOf('queryHistory')).toBe(2)
  })
})
