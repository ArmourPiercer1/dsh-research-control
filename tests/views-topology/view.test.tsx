// @vitest-environment jsdom
/**
 * UI-6 D4 — TopologyGraphContainer: the Topic-page topology zone as the
 * single first-version mutation entry (ADJ-6 / B §10.4, §21, §22, §23).
 *
 * The REAL `createResearchStore` (the stub facade injected through the
 * store's `rpc` seam — the container takes the store as a PROP, so no
 * mount seam is needed) runs around the REAL container + view. React Flow
 * is mocked at the component layer (../graph/xyflow-mock.ts — imported
 * FIRST, the test-layer pattern).
 *
 * The fixture mirrors the v2-t71 baseline (RECON §9): TPC-1 with
 * WS-1..4, TE-1 FORK PLANNED (WS-1→WS-2, the note) and TE-2 MERGE
 * PLANNED ([WS-1, WS-2]→WS-3), no merge contracts yet (the contract is
 * CREATED during the t71 run).
 *
 * Mutation idiom under test (D4⑧): `okValue →
 * refetchKeys(INVALIDATE_REGISTRY) → return` — no optimistic updates;
 * a rejected round-trip surfaces as the dialog error line (the view's
 * catch), a resolved one refetches the topic slice (the graph
 * re-derives from the wire).
 */
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

// BEFORE any container import (the ws graph mounts through the view —
// the real React Flow runtime needs browser layout surfaces jsdom lacks).
import '../graph/xyflow-mock.js'

import { TopologyGraphContainer } from '../../src/client/graph/TopologyGraphContainer.js'
import { createResearchStore } from '../../src/client/stores/index.js'
import { makeStubRpc, type StubRpc } from '../stores/stub-rpc.js'
import { COPY_TABLE } from '../../src/client/i18n/copy.js'
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

/** The v2-t71 baseline shape (RECON §9) — see the module doc. */
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
      ws('WS-4', '长程验证矩阵（大计划）', 'PLANNED'),
    ],
    topology: {
      edges: [
        {
          id: 'TE-1',
          operation: 'FORK',
          lifecycle: 'PLANNED',
          inputs: ['WS-1'],
          outputs: ['WS-2'],
          note: '分支出独立标定管线',
        },
        {
          id: 'TE-2',
          operation: 'MERGE',
          lifecycle: 'PLANNED',
          inputs: ['WS-1', 'WS-2'],
          outputs: ['WS-3'],
          note: null,
        },
      ],
    },
    mergeContracts: [],
    objectives: [],
  }
}

function makeStub(): StubRpc {
  const stub = makeStubRpc()
  stub.set('getTopic', { ok: true, value: t71Snapshot() })
  return stub
}

/** Mount the real container on the real store; wait for the graph face. */
async function renderContainer(stub: StubRpc): Promise<ReturnType<typeof render>> {
  const store = createResearchStore({ rpc: stub.rpc })
  const utils = render(<TopologyGraphContainer store={store} topicId="TPC-1" />)
  await waitFor(() => expect(utils.container.querySelector('[data-topology-actions]')).not.toBeNull())
  return utils
}

/* -------------------------------------------------------------------- */

describe('the action face (ADJ-6: the single Topic-page topology entry)', () => {
  it('renders the action bar + legend once the topic slice is ready', async () => {
    const utils = await renderContainer(makeStub())
    const actions = utils.container.querySelector('[data-topology-actions]')!
    for (const kind of ['fork', 'merge', 'drop']) {
      expect(actions.querySelector(`[data-topology-action="${kind}"]`)).not.toBeNull()
    }
    const legend = utils.container.querySelector('[data-topology-legend]')
    expect(legend).not.toBeNull()
    expect([...legend!.querySelectorAll('[data-legend]')].length).toBe(6)
  })

  it('the Drop entry is disabled while no PLANNED edge exists (ADJ-5: PLANNED-only entry)', async () => {
    const stub = makeStub()
    // A realized-only topology: nothing left to drop.
    stub.set('getTopic', {
      ok: true,
      value: {
        ...t71Snapshot(),
        topology: {
          edges: [
            { id: 'TE-1', operation: 'FORK', lifecycle: 'REALIZED', inputs: ['WS-1'], outputs: ['WS-2'], note: null },
          ],
        },
      },
    })
    const utils = await renderContainer(stub)
    const drop = utils.container.querySelector('[data-topology-action="drop"]') as HTMLButtonElement
    expect(drop.disabled).toBe(true)
    const fork = utils.container.querySelector('[data-topology-action="fork"]') as HTMLButtonElement
    expect(fork.disabled).toBe(false)
  })
})

/* -------------------------------------------------------------------- */

describe('Create Workstream Fork (B §21.2)', () => {
  it('an empty title is rejected client-side and never reaches the wire', async () => {
    const stub = makeStub()
    const utils = await renderContainer(stub)
    fireEvent.click(utils.container.querySelector('[data-topology-action="fork"]') as HTMLElement)
    const dialog = utils.container.querySelector('[data-topology-dialog="fork"]')!
    // two empty title rows by default → the length gate fires first:
    fireEvent.click(dialog.querySelector('[data-fork-submit]') as HTMLElement)
    const error = dialog.querySelector('[data-fork-error]')!
    expect(error.textContent).toBe(COPY_TABLE['topic.topology.fork.errTitleLength'])
    expect(stub.countOf('createWorkstreamFork')).toBe(0)
  })

  it('the happy path binds topicId, fans the note out to EVERY child, and refetches the slice', async () => {
    const stub = makeStub()
    const utils = await renderContainer(stub)
    fireEvent.click(utils.container.querySelector('[data-topology-action="fork"]') as HTMLElement)
    const dialog = utils.container.querySelector('[data-topology-dialog="fork"]')!
    fireEvent.change(dialog.querySelector('[data-fork-title-index="0"]') as HTMLInputElement, {
      target: { value: 'Child A' },
    })
    fireEvent.change(dialog.querySelector('[data-fork-title-index="1"]') as HTMLInputElement, {
      target: { value: 'Child B' },
    })
    fireEvent.change(dialog.querySelector('[data-fork-note]') as HTMLInputElement, {
      target: { value: 'fan note' },
    })
    fireEvent.click(dialog.querySelector('[data-fork-submit]') as HTMLElement)
    await waitFor(() => expect(stub.countOf('createWorkstreamFork')).toBe(1))
    const call = stub.callsTo('createWorkstreamFork')[0]
    expect(call.args).toEqual({
      topicId: 'TPC-1',
      parentWorkstreamId: 'WS-1',
      children: [
        { title: 'Child A', note: 'fan note' },
        { title: 'Child B', note: 'fan note' },
      ],
    })
    // the dialog closes on success AND the topic slice refetched
    // (the INVALIDATE_REGISTRY rule — the graph re-derives from the wire):
    await waitFor(() => expect(utils.container.querySelector('[data-topology-dialog="fork"]')).toBeNull())
    expect(stub.countOf('getTopic')).toBeGreaterThanOrEqual(2)
  })

  it('the last remaining title row cannot be removed (children ≥ 1)', async () => {
    const stub = makeStub()
    const utils = await renderContainer(stub)
    fireEvent.click(utils.container.querySelector('[data-topology-action="fork"]') as HTMLElement)
    const dialog = utils.container.querySelector('[data-topology-dialog="fork"]')!
    // the default two rows: removing one leaves the survivor un-removable:
    fireEvent.click(dialog.querySelector('[data-fork-remove="0"]') as HTMLElement)
    expect(dialog.querySelectorAll('[data-fork-title-index]')).toHaveLength(1)
    const survivor = dialog.querySelector('[data-fork-remove="0"]') as HTMLButtonElement
    expect(survivor.disabled).toBe(true)
  })
})

/* -------------------------------------------------------------------- */

describe('Create Planned Merge (B §22)', () => {
  it('a single input is rejected and never reaches the wire', async () => {
    const stub = makeStub()
    const utils = await renderContainer(stub)
    fireEvent.click(utils.container.querySelector('[data-topology-action="merge"]') as HTMLElement)
    const dialog = utils.container.querySelector('[data-topology-dialog="merge"]')!
    fireEvent.click(dialog.querySelector('[data-merge-input="WS-1"]') as HTMLInputElement)
    fireEvent.change(dialog.querySelector('[data-merge-output]') as HTMLSelectElement, {
      target: { value: 'WS-3' },
    })
    fireEvent.click(dialog.querySelector('[data-merge-submit]') as HTMLElement)
    const error = dialog.querySelector('[data-merge-error]')!
    expect(error.textContent).toBe(COPY_TABLE['topic.topology.merge.errInputs'])
    expect(stub.countOf('createPlannedMerge')).toBe(0)
  })

  it('the output cannot be one of the inputs (the UI-level gate)', async () => {
    const stub = makeStub()
    const utils = await renderContainer(stub)
    fireEvent.click(utils.container.querySelector('[data-topology-action="merge"]') as HTMLElement)
    const dialog = utils.container.querySelector('[data-topology-dialog="merge"]')!
    fireEvent.click(dialog.querySelector('[data-merge-input="WS-1"]') as HTMLInputElement)
    fireEvent.click(dialog.querySelector('[data-merge-input="WS-2"]') as HTMLInputElement)
    fireEvent.change(dialog.querySelector('[data-merge-output]') as HTMLSelectElement, {
      target: { value: 'WS-1' },
    })
    fireEvent.click(dialog.querySelector('[data-merge-submit]') as HTMLElement)
    const error = dialog.querySelector('[data-merge-error]')!
    expect(error.textContent).toBe(COPY_TABLE['topic.topology.merge.errOutputInInputs'])
    expect(stub.countOf('createPlannedMerge')).toBe(0)
  })

  it('the happy path resolves the NEW edge id and auto-opens its contract editor (B §22 "Edit later")', async () => {
    const stub = makeStub()
    stub.set('createPlannedMerge', {
      ok: true,
      value: {
        edgeId: 'TE-9',
        topicId: 'TPC-1',
        inputs: ['WS-1', 'WS-2'],
        outputWorkstreamId: 'WS-3',
        lifecycle: 'PLANNED',
        managementActionId: 'MA-9',
      },
    })
    // the NEW edge has no contract yet — a value face, not an error:
    stub.set('getMergeContract', {
      ok: true,
      value: { edgeId: 'TE-9', content: null, path: 'merges/TE-9/contract.md' },
    })
    const utils = await renderContainer(stub)
    fireEvent.click(utils.container.querySelector('[data-topology-action="merge"]') as HTMLElement)
    const dialog = utils.container.querySelector('[data-topology-dialog="merge"]')!
    fireEvent.click(dialog.querySelector('[data-merge-input="WS-1"]') as HTMLInputElement)
    fireEvent.click(dialog.querySelector('[data-merge-input="WS-2"]') as HTMLInputElement)
    fireEvent.change(dialog.querySelector('[data-merge-output]') as HTMLSelectElement, {
      target: { value: 'WS-3' },
    })
    fireEvent.click(dialog.querySelector('[data-merge-submit]') as HTMLElement)
    await waitFor(() => expect(stub.countOf('createPlannedMerge')).toBe(1))
    expect(stub.callsTo('createPlannedMerge')[0].args).toEqual({
      topicId: 'TPC-1',
      inputWorkstreamIds: ['WS-1', 'WS-2'],
      outputWorkstreamId: 'WS-3',
    })
    // the merge dialog closes and the contract editor opens on TE-9:
    const contract = await waitFor(() => {
      const d = utils.container.querySelector('[data-topology-dialog="contract"]')
      expect(d).not.toBeNull()
      return d as HTMLElement
    })
    expect(contract.querySelector('[data-contract-edge]')!.getAttribute('data-contract-edge')).toBe('TE-9')
    await waitFor(() => expect(contract.querySelector('[data-contract-status="empty"]')).not.toBeNull())
    expect(contract.querySelector('[data-contract-create]')).not.toBeNull()
    expect(stub.countOf('getMergeContract')).toBe(1)
  })
})

/* -------------------------------------------------------------------- */

describe('the merge-contract editor (B §23 / ADJ-7)', () => {
  it('an EXISTING contract opens prefilled; Save round-trips the raw draft and closes', async () => {
    const stub = makeStub()
    stub.set('getMergeContract', {
      ok: true,
      value: { edgeId: 'TE-2', content: '# Merge contract\n\nbody', path: 'merges/TE-2/contract.md' },
    })
    const utils = await renderContainer(stub)
    // the merge edge is the entry (B §23.1) — the mock forwards the click:
    fireEvent.click(utils.container.querySelector('[data-mock-edge="TE-2:WS-1->WS-3"]') as HTMLElement)
    const dialog = await waitFor(() => {
      const d = utils.container.querySelector('[data-topology-dialog="contract"]')
      expect(d).not.toBeNull()
      return d as HTMLElement
    })
    await waitFor(() => expect(dialog.querySelector('[data-contract-status="editing"]')).not.toBeNull())
    const text = dialog.querySelector('[data-contract-text]') as HTMLTextAreaElement
    expect(text.value).toBe('# Merge contract\n\nbody')
    // the SAVED bytes are the raw draft (untrimmed, verbatim):
    const draft = '# Merge contract\n\nbody — revised \n'
    fireEvent.change(text, { target: { value: draft } })
    fireEvent.click(dialog.querySelector('[data-contract-save]') as HTMLElement)
    await waitFor(() => expect(stub.countOf('saveMergeContract')).toBe(1))
    expect(stub.callsTo('saveMergeContract')[0].args).toEqual({ edgeId: 'TE-2', content: draft })
    await waitFor(() => expect(utils.container.querySelector('[data-topology-dialog="contract"]')).toBeNull())
  })

  it('a whitespace-only draft is rejected; Cancel leaves the save uncalled', async () => {
    const stub = makeStub()
    stub.set('getMergeContract', {
      ok: true,
      value: { edgeId: 'TE-2', content: null, path: 'merges/TE-2/contract.md' },
    })
    const utils = await renderContainer(stub)
    fireEvent.click(utils.container.querySelector('[data-mock-edge="TE-2:WS-1->WS-3"]') as HTMLElement)
    const dialog = await waitFor(() => {
      const d = utils.container.querySelector('[data-topology-dialog="contract"]')
      expect(d).not.toBeNull()
      return d as HTMLElement
    })
    // content null ⇒ the "No merge contract [Create]" state:
    await waitFor(() => expect(dialog.querySelector('[data-contract-status="empty"]')).not.toBeNull())
    fireEvent.click(dialog.querySelector('[data-contract-create]') as HTMLElement)
    await waitFor(() => expect(dialog.querySelector('[data-contract-status="editing"]')).not.toBeNull())
    const text = dialog.querySelector('[data-contract-text]') as HTMLTextAreaElement
    fireEvent.change(text, { target: { value: '   ' } })
    fireEvent.click(dialog.querySelector('[data-contract-save]') as HTMLElement)
    const error = dialog.querySelector('[data-contract-error]')
    expect(error).not.toBeNull()
    expect(error!.textContent).toBe(COPY_TABLE['topic.topology.contract.errEmpty'])
    expect(stub.countOf('saveMergeContract')).toBe(0)
    // Cancel closes the dialog; the wire was never touched:
    fireEvent.click(dialog.querySelector('[data-contract-cancel]') as HTMLElement)
    await waitFor(() => expect(utils.container.querySelector('[data-topology-dialog="contract"]')).toBeNull())
    expect(stub.countOf('saveMergeContract')).toBe(0)
  })
})

/* -------------------------------------------------------------------- */

describe('Drop Topology Edge (B §10.4 / ADJ-5: the PLANNED-only UI entry)', () => {
  it('lists PLANNED edges only; confirm round-trips the edge id and closes', async () => {
    const stub = makeStub()
    // a REALIZED edge rides the same snapshot — it must NOT be offered:
    stub.set('getTopic', {
      ok: true,
      value: {
        ...t71Snapshot(),
        topology: {
          edges: [
            ...t71Snapshot().topology.edges,
            { id: 'TE-3', operation: 'MERGE', lifecycle: 'REALIZED', inputs: ['WS-3'], outputs: ['WS-4'], note: null },
          ],
        },
      },
    })
    const utils = await renderContainer(stub)
    fireEvent.click(utils.container.querySelector('[data-topology-action="drop"]') as HTMLElement)
    const dialog = utils.container.querySelector('[data-topology-dialog="drop"]')!
    const select = dialog.querySelector('[data-drop-edge]') as HTMLSelectElement
    const options = [...select.querySelectorAll('option')].filter(o => o.value !== '')
    expect(options.map(o => o.value)).toEqual(['TE-1', 'TE-2'])
    fireEvent.change(select, { target: { value: 'TE-2' } })
    fireEvent.click(dialog.querySelector('[data-drop-confirm]') as HTMLElement)
    await waitFor(() => expect(stub.countOf('dropTopologyEdge')).toBe(1))
    expect(stub.callsTo('dropTopologyEdge')[0].args).toEqual({ edgeId: 'TE-2' })
    await waitFor(() => expect(utils.container.querySelector('[data-topology-dialog="drop"]')).toBeNull())
  })

  it('a rejected drop surfaces as the dialog error; the dialog stays open', async () => {
    const stub = makeStub()
    stub.set('dropTopologyEdge', {
      ok: false,
      error: { code: 'DOMAIN_SCHEMA_VIOLATION', message: 'synthetic drop failure (test)', details: {} },
    })
    const utils = await renderContainer(stub)
    fireEvent.click(utils.container.querySelector('[data-topology-action="drop"]') as HTMLElement)
    const dialog = utils.container.querySelector('[data-topology-dialog="drop"]')!
    // the default selection = the first PLANNED edge (TE-1):
    fireEvent.click(dialog.querySelector('[data-drop-confirm]') as HTMLElement)
    await waitFor(() =>
      expect((dialog.querySelector('[data-drop-error]') as HTMLElement).textContent).toBe(
        'synthetic drop failure (test)',
      ),
    )
    // still open, no longer busy:
    expect(utils.container.querySelector('[data-topology-dialog="drop"]')).not.toBeNull()
    const confirm = dialog.querySelector('[data-drop-confirm]') as HTMLButtonElement
    expect(confirm.disabled).toBe(false)
  })
})
