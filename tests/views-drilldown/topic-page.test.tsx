// @vitest-environment jsdom
/**
 * UI-6 D4 — TopicPage: the topology zone as the single mutation entry.
 *
 * The REAL `TopicPage` (standalone — the cockpit's navigation shell is
 * the caller, not the contract) on the REAL `createResearchStore` (stub
 * facade through the store's `rpc` seam). React Flow is mocked at the
 * component layer (../graph/xyflow-mock.ts — imported FIRST).
 *
 * Pinned here (ADJ-6 / B §10.4):
 *  - the topology zone `[data-topic-id]` mounts `[data-role="topology-graph"]`
 *    with the action-bar entry hooks (`[data-topology-actions]`);
 *  - the Workstream cards still drill into the workstream page (the
 *    §26 navigation is unchanged);
 *  - NO other mutation face renders on the topic page — the plan graph
 *    (the workstream page's canvas) is absent.
 */
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// BEFORE any page import (the topology zone mounts the graph view).
import '../graph/xyflow-mock.js'

import { TopicPage } from '../../src/client/views/drilldown'
import { createResearchStore } from '../../src/client/stores/index.js'
import { makeStubRpc } from '../stores/stub-rpc.js'
import type { TopicSnapshot, WorkstreamCardDto } from '../../src/shared/rpc-contracts.js'

afterEach(cleanup)

const T = 1755000000000

function ws(id: string, title: string, lifecycle: WorkstreamCardDto['lifecycle']): WorkstreamCardDto {
  return {
    id,
    title,
    lifecycle,
    summary: null,
    planItemCount: 0,
    openPlanForkCount: 0,
    runningRunCount: 0,
  }
}

function t71Snapshot(): TopicSnapshot {
  return {
    topic: {
      id: 'TPC-1',
      title: '标定与配准',
      description: '机器人视觉定位的标定与配准研究主题（亚像素级精度目标）',
      importance: null,
      attentionMode: null,
      objectiveRefs: ['OBJ-1'],
      createdAt: T,
    },
    workstreams: [
      ws('WS-1', '主标定管线', 'REALIZED'),
      ws('WS-2', '独立标定管线', 'PLANNED'),
      ws('WS-3', '合并后管线', 'PLANNED'),
    ],
    topology: {
      edges: [
        { id: 'TE-1', operation: 'FORK', lifecycle: 'PLANNED', inputs: ['WS-1'], outputs: ['WS-2'], note: null },
        { id: 'TE-2', operation: 'MERGE', lifecycle: 'PLANNED', inputs: ['WS-1', 'WS-2'], outputs: ['WS-3'], note: null },
      ],
    },
    mergeContracts: [],
    objectives: [],
  }
}

async function renderPage(): Promise<{
  utils: ReturnType<typeof render>
  onOpenWorkstream: ReturnType<typeof vi.fn>
  onBack: ReturnType<typeof vi.fn>
}> {
  const stub = makeStubRpc()
  stub.set('getTopic', { ok: true, value: t71Snapshot() })
  const store = createResearchStore({ rpc: stub.rpc })
  const onOpenWorkstream = vi.fn()
  const onBack = vi.fn()
  const utils = render(
    <TopicPage store={store} topicId="TPC-1" onOpenWorkstream={onOpenWorkstream} onBack={onBack} />,
  )
  await waitFor(() => expect(utils.container.querySelector('[data-topology-actions]')).not.toBeNull())
  return { utils, onOpenWorkstream, onBack }
}

describe('the topology zone (ADJ-6: the single Topic-page mutation entry)', () => {
  it('mounts the graph + the action-bar entry hooks inside [data-topic-id]', async () => {
    const { utils } = await renderPage()
    const zone = utils.container.querySelector('[data-topic-id="TPC-1"]')
    expect(zone).not.toBeNull()
    expect(zone!.querySelector('[data-role="topology-graph"]')).not.toBeNull()
    const actions = zone!.querySelector('[data-topology-actions]')
    expect(actions).not.toBeNull()
    for (const kind of ['fork', 'merge', 'drop']) {
      expect(actions!.querySelector(`[data-topology-action="${kind}"]`)).not.toBeNull()
    }
    // the legend rides the same zone (B §10.3):
    expect(zone!.querySelector('[data-topology-legend]')).not.toBeNull()
  })

  it('no OTHER mutation face renders on the topic page (the workstream canvas stays home)', async () => {
    const { utils } = await renderPage()
    // the plan graph is the WORKSTREAM page's seat — it must not appear
    // on the topic page (the topology zone is the only entry):
    expect(document.querySelector('[data-role="plan-graph"]')).toBeNull()
    // and the only action bar in the document is the topology one:
    expect(document.querySelectorAll('[data-topology-actions]').length).toBe(1)
  })
})

describe('the unchanged §26 navigation', () => {
  it('a Workstream card click drills into the workstream page', async () => {
    const { utils, onOpenWorkstream, onBack } = await renderPage()
    expect(utils.container.querySelectorAll('[data-ws-id]')).toHaveLength(3)
    fireEvent.click(utils.container.querySelector('[data-ws-id="WS-2"]') as HTMLElement)
    expect(onOpenWorkstream).toHaveBeenCalledTimes(1)
    expect(onOpenWorkstream).toHaveBeenCalledWith('WS-2')
    expect(onBack).not.toHaveBeenCalled()
  })
})
