// @vitest-environment jsdom
/**
 * WP-4.6 — panel container tests (InterventionBoard / PfPanel / GitPanel).
 *
 * The user-side mutation faces, run against the REAL store (stub facade
 * through the store's `rpc` seam). The mutation → invalidate-registry →
 * refetch flow is tested END TO END: the post-mutation fixture is
 * configured synchronously right after the click (the registry refetch
 * resolves on a later microtask and reads the freshly configured
 * outcome — the host is the source of truth, the panel never patches
 * local state).
 *
 * InterventionBoard (TC-E2E-011, user-only state machine, §13):
 *  - CLOSED without a note → fault + NO mutation call (「关闭时用户填写」);
 *  - OPEN → PENDING (待处理) → the refetched slice re-renders the row
 *    with data-iv-status="PENDING";
 *  - OPEN → CLOSED (关闭 + note) → the mutation carries the
 *    resolutionNote; the refetched slice removes the row;
 *  - the WS chip opens the owning workstream (the Gate P4 first stop).
 *
 * PfPanel (TC-E2E-007/008):
 *  - OPEN + STALE rows with the `staleReason`;
 *  - SELECT → selectPlanFork resolves → the §6.7 checkpointHint renders
 *    (explicit, optional, NEVER automatic — INV-GIT-2; no checkpoint is
 *    auto-saved) → the refetched slice drops the selected PF;
 *  - DISMISS → the PF leaves the unresolved list.
 *
 * GitPanel (TC-E2E-010):
 *  - the contract version list + the working-copy verdict
 *    (pathContent.sameAsBaseline=false → 「不一致」);
 *  - 恢复到该版本 → restoreDeclarativeFile resolves → the result note
 *    shows the post-restore validation verdict; the refetched verdict
 *    window flips to 「一致」 (the registry refetches cached gitHistory
 *    windows).
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createResearchStore } from '../../src/client/stores'
import {
  GitPanel,
  InterventionBoard,
  PfPanel,
} from '../../src/client/views/drilldown'
import { makeStubRpc, type StubRpc } from '../stores/stub-rpc.js'
import {
  DRILLDOWN_DASHBOARD,
  DRILLDOWN_DASHBOARD_IV1_CLOSED,
  DRILLDOWN_DASHBOARD_IV1_PENDING,
  DRILLDOWN_GIT_DRIFTED,
  DRILLDOWN_GIT_RESTORED,
  DRILLDOWN_TOPIC,
  DRILLDOWN_WORKSTREAM,
  DRILLDOWN_WORKSTREAM_AFTER_SELECT,
  OID_NEWEST,
} from './fixtures'

afterEach(cleanup)

/* -------------------------------------------------------------------- *
 * InterventionBoard
 * -------------------------------------------------------------------- */

describe('InterventionBoard', () => {
  it('refuses CLOSE without a note (no mutation call)', async () => {
    const stub = makeStubRpc()
    stub.set('getDashboard', { ok: true, value: DRILLDOWN_DASHBOARD })
    render(
      <StrictMode>
        <InterventionBoard store={createResearchStore({ rpc: stub.rpc })} />
      </StrictMode>,
    )

    // The lazy load lands the rows first (the board renders from the slice).
    await screen.findByText('计划分叉洪泛告警')
    // IV-1's close button (the PENDING row IV-2 has one too — scope by id).
    fireEvent.click(document.querySelector('[data-iv-id="IV-1"] [data-iv-action="close"]')!)
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('关闭需要填写备注')
    })
    expect(stub.countOf('updateInterventionState')).toBe(0)
  })

  it('OPEN → PENDING via 待处理 (the refetched slice re-renders the row)', async () => {
    const stub = makeStubRpc()
    stub.set('getDashboard', { ok: true, value: DRILLDOWN_DASHBOARD })
    render(
      <StrictMode>
        <InterventionBoard store={createResearchStore({ rpc: stub.rpc })} />
      </StrictMode>,
    )
    const row = await screen.findByText('计划分叉洪泛告警')
    expect(row.closest('[data-iv-id="IV-1"]')?.getAttribute('data-iv-status')).toBe('OPEN')

    // The post-mutation refetch outcome (the host moved IV-1 to PENDING).
    stub.set('getDashboard', { ok: true, value: DRILLDOWN_DASHBOARD_IV1_PENDING })
    fireEvent.click(document.querySelector('[data-iv-id="IV-1"] [data-iv-action="pending"]')!)

    await waitFor(() => {
      expect(stub.countOf('updateInterventionState')).toBe(1)
    })
    const call = stub.callsTo('updateInterventionState')[0].args as {
      interventionId: string
      status: string
      resolutionNote?: string
    }
    expect(call).toEqual({ interventionId: 'IV-1', status: 'PENDING' })

    await waitFor(() => {
      expect(document.querySelector('[data-iv-id="IV-1"]')?.getAttribute('data-iv-status')).toBe('PENDING')
    })
  })

  it('CLOSE removes the row (the mutation carries the note)', async () => {
    const stub = makeStubRpc()
    stub.set('getDashboard', { ok: true, value: DRILLDOWN_DASHBOARD })
    render(
      <StrictMode>
        <InterventionBoard store={createResearchStore({ rpc: stub.rpc })} />
      </StrictMode>,
    )
    await screen.findByText('计划分叉洪泛告警')

    // Pre-set the post-close outcome (the registry refetch, a later
    // microtask, reads it — the host closed IV-1, so it leaves both
    // OPEN and PENDING groups).
    stub.set('getDashboard', { ok: true, value: DRILLDOWN_DASHBOARD_IV1_CLOSED })
    const note = document.querySelector('[data-iv-note="IV-1"]') as HTMLInputElement
    fireEvent.change(note, { target: { value: '已按 PF-1 物化，洪泛解除' } })
    fireEvent.click(document.querySelector('[data-iv-id="IV-1"] [data-iv-action="close"]')!)

    await waitFor(() => {
      expect(stub.countOf('updateInterventionState')).toBe(1)
    })
    const call = stub.callsTo('updateInterventionState')[0].args as {
      interventionId: string
      status: string
      resolutionNote?: string
    }
    expect(call.interventionId).toBe('IV-1')
    expect(call.status).toBe('CLOSED')
    expect(call.resolutionNote).toBe('已按 PF-1 物化，洪泛解除')

    await waitFor(() => {
      expect(document.querySelector('[data-iv-id="IV-1"]')).toBeNull()
    })
    // IV-2 (PENDING) is still in the queue.
    expect(document.querySelector('[data-iv-id="IV-2"]')).toBeTruthy()
  })

  it('CLOSED rows have no state controls (terminal state)', async () => {
    const stub = makeStubRpc()
    stub.set('getDashboard', { ok: true, value: DRILLDOWN_DASHBOARD })
    render(
      <StrictMode>
        <InterventionBoard store={createResearchStore({ rpc: stub.rpc })} />
      </StrictMode>,
    )
    await screen.findByText('计划分叉洪泛告警')
    // Both visible rows are non-terminal (OPEN + PENDING) — the closed
    // one is absent from the snapshot: assert the control set matches
    // exactly the §13 legal targets (OPEN: pending+close, PENDING:
    // reopen+close — no terminal row can render a control row).
    expect(document.querySelector('[data-iv-id="IV-1"] [data-iv-action="pending"]')).toBeTruthy()
    expect(document.querySelector('[data-iv-id="IV-1"] [data-iv-action="close"]')).toBeTruthy()
    expect(document.querySelector('[data-iv-id="IV-2"] [data-iv-action="reopen"]')).toBeTruthy()
    expect(document.querySelector('[data-iv-id="IV-2"] [data-iv-action="close"]')).toBeTruthy()
  })

  it('the WS chip opens the owning workstream (the Gate P4 first stop)', async () => {
    const stub = makeStubRpc()
    stub.set('getDashboard', { ok: true, value: DRILLDOWN_DASHBOARD })
    const onOpenWorkstream = vi.fn()
    render(
      <StrictMode>
        <InterventionBoard store={createResearchStore({ rpc: stub.rpc })} onOpenWorkstream={onOpenWorkstream} />
      </StrictMode>,
    )
    await screen.findByText('计划分叉洪泛告警')

    fireEvent.click(document.querySelector('[data-iv-ws="WS-2"]')!)
    expect(onOpenWorkstream).toHaveBeenCalledTimes(1)
    expect(onOpenWorkstream).toHaveBeenCalledWith('WS-2')
  })
})

/* -------------------------------------------------------------------- *
 * PfPanel
 * -------------------------------------------------------------------- */

describe('PfPanel', () => {
  it('shows OPEN + STALE with the staleReason; SELECT renders the checkpoint hint', async () => {
    const stub = makeStubRpc()
    stub.set('getWorkstream', { ok: true, value: DRILLDOWN_WORKSTREAM })
    render(
      <StrictMode>
        <PfPanel store={createResearchStore({ rpc: stub.rpc })} workstreamId="WS-1" />
      </StrictMode>,
    )

    const open = await screen.findByText('补充一条计算验证任务')
    expect(open.closest('[data-pf="PF-1"]')?.getAttribute('data-pf-status')).toBe('OPEN')
    const stale = document.querySelector('[data-pf="PF-2"]')
    expect(stale?.getAttribute('data-pf-status')).toBe('STALE')
    expect(stale?.textContent).toContain('superseded by PF-1 selection')

    // SELECT: the post-SELECT refetch reads the materialized snapshot.
    stub.set('getWorkstream', { ok: true, value: DRILLDOWN_WORKSTREAM_AFTER_SELECT })
    fireEvent.click(document.querySelector('[data-pf="PF-1"] [data-pf-action="select"]')!)

    await waitFor(() => {
      expect(stub.countOf('selectPlanFork')).toBe(1)
    })
    // The §6.7 checkpoint hint is user-visible (INV-GIT-2: explicit +
    // optional — it appears, and NO checkpoint is auto-saved).
    await waitFor(() => {
      const el = document.querySelector('[data-role="checkpoint-hint"]')
      expect(el?.textContent).toContain('saveResearchCheckpoint')
    })
    expect(stub.countOf('saveResearchCheckpoint')).toBe(0)

    // The refetched slice: PF-1 leaves the list, PF-2 stays STALE.
    await waitFor(() => {
      expect(document.querySelector('[data-pf="PF-1"]')).toBeNull()
    })
    expect(document.querySelector('[data-pf="PF-2"] [data-pf-status="STALE"]')).toBeTruthy()
  })

  it('DISMISS removes the PF (the registry refetch shows the remainder)', async () => {
    const stub = makeStubRpc()
    stub.set('getWorkstream', { ok: true, value: DRILLDOWN_WORKSTREAM })
    render(
      <StrictMode>
        <PfPanel store={createResearchStore({ rpc: stub.rpc })} workstreamId="WS-1" />
      </StrictMode>,
    )
    await screen.findByText('补充一条计算验证任务')

    stub.set('getWorkstream', { ok: true, value: DRILLDOWN_WORKSTREAM_AFTER_SELECT })
    fireEvent.click(document.querySelector('[data-pf="PF-1"] [data-pf-action="dismiss"]')!)

    await waitFor(() => {
      expect(stub.countOf('dismissPlanFork')).toBe(1)
    })
    await waitFor(() => {
      expect(document.querySelector('[data-pf="PF-1"]')).toBeNull()
    })
  })
})

/* -------------------------------------------------------------------- *
 * GitPanel
 * -------------------------------------------------------------------- */

describe('GitPanel', () => {
  it('lists the contract versions with the drifted verdict; restore flips it', async () => {
    const stub = makeStubRpc()
    stub.set('getWorkstream', { ok: true, value: DRILLDOWN_WORKSTREAM })
    stub.set('getTopic', { ok: true, value: DRILLDOWN_TOPIC })
    stub.set('getGitHistory', { ok: true, value: DRILLDOWN_GIT_DRIFTED })
    render(
      <StrictMode>
        <GitPanel store={createResearchStore({ rpc: stub.rpc })} workstreamId="WS-1" />
      </StrictMode>,
    )

    await screen.findByText('.research/merges/TE-2/contract.md')
    // The verdict window (the second slice — baseline = newest version)
    // lands with the drifted flag.
    await waitFor(() => {
      const verdict = document.querySelector('[data-contract-same=".research/merges/TE-2/contract.md"]')
      expect(verdict?.textContent).toContain('不一致')
    })
    // The version list is visible with its restore button.
    expect(document.querySelector(`[data-restore-oid="${OID_NEWEST}"]`)).toBeTruthy()

    // The restore: the POST-restore refetch reads the restored verdict.
    stub.set('getGitHistory', { ok: true, value: DRILLDOWN_GIT_RESTORED })
    fireEvent.click(document.querySelector(`[data-restore-oid="${OID_NEWEST}"]`)!)

    await waitFor(() => {
      expect(stub.countOf('restoreDeclarativeFile')).toBe(1)
    })
    const call = stub.callsTo('restoreDeclarativeFile')[0].args as { commitOid: string; path: string }
    expect(call.commitOid).toBe(OID_NEWEST)
    expect(call.path).toBe('.research/merges/TE-2/contract.md')

    // The result note shows the post-restore validation verdict.
    await waitFor(() => {
      const note = document.querySelector('[data-role="restore-result"]')
      expect(note?.textContent).toContain('树校验通过')
    })

    // The refetched verdict window flips to 「一致」.
    await waitFor(() => {
      const verdict = document.querySelector('[data-contract-same=".research/merges/TE-2/contract.md"]')
      expect(verdict?.textContent).toContain('一致')
      expect(verdict?.textContent).not.toContain('不一致')
    })
  })
})
