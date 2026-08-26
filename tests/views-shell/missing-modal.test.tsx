// @vitest-environment jsdom
/**
 * V2-T4.3 — MISSING four-action modal component tests (design §4 四选一弹窗
 * / §12 rows 5, 6, 8, 9).
 *
 * Plain stub props — no real cordis in the component spec (the views-* test
 * pattern). Every injected face is a vi.fn stub per case; the wire fixtures
 * are re-parsed through the strict `GetResearchPlaneStateResultSchema` in
 * ./fixtures.ts, so a fixture that drifts from the wire contract fails the
 * suite.
 *
 * The pinned dedup contract (host: plane-mutation-services.ts +
 * plane-read-services.ts): `ackMissingReminder` is a pure runtime-memory
 * write — the entry stays in `missing` with its `deferred` flag flipped to
 * `true` (the read port projects the flag live, no rescan needed; the flag
 * survives a rescan and the backend run, a restart restores the reminder).
 * The modal therefore lists ONLY `deferred === false` entries, and the
 * post-ack re-fetch filters the acked entry out — the second render in the
 * same runtime does NOT re-pop for it (the gate's heart).
 *
 * Gate coverage (plan §P4 T4.3):
 *  - the modal appears on the FIRST render when the plane state carries
 *    live missing entries — listing each entry's displayName + id +
 *    registered path, and ONLY the live (`deferred === false`) ones;
 *  - 恢复 fires `rescan({})` (the strict empty request);
 *  - 重初始化 fires `bindProject({ wsPath, scaffold: true })` (the wire
 *    carries the registered path + scaffold — no projectId field);
 *  - 移除登记 fires `unbindProject({ wsPath })` (the wire takes the path);
 *  - 推后 fires `ackMissingReminder({ projectId })`;
 *  - every SUCCESS closes the modal and re-fetches the plane state;
 *  - every ERROR shows in the modal (role=alert), the modal STAYS open,
 *    no re-fetch (the entry is still 挂起);
 *  - DEDUP: after 推后 + re-fetch (the entry's `deferred` flipped), a
 *    second render does NOT re-pop; a plane where every entry is already
 *    deferred never pops at all;
 *  - the modal is PLANE-level: it pops over the HUB console AND over the
 *    UNREGISTERED 引导卡;
 *  - multi-entry: acking ONE entry re-pops for the OTHER live entry only.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { act, StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// BEFORE any shell import (the shell transitively loads the cockpit → the
// WP-4.5 graph → @xyflow/react; the mock renders the node/edge layer for
// real, the WP-4.5 test-layer pattern).
import '../graph/xyflow-mock.js'

import { ResearchShell, type ResearchShellProps } from '../../src/client/views/shell/index.js'
import type { GetPortfolioInterventionsResult, GetResearchPlaneStateResult, HubOverviewResult, UpdateInterventionStateResult } from '../../src/shared/rpc-contracts.js'
import { HUB_OVERVIEW_RESULT } from '../views-overview/fixtures.js'
import {
  MISSING_ACKED_RESULT,
  MISSING_CLEARED_RESULT,
  MISSING_ENTRY,
  MISSING_RESULT,
  MISSING_RESULT_AT_UNREGISTERED,
  MISSING_TWO_ACKED_FIRST_RESULT,
  MISSING_TWO_RESULT,
  MISSING_WS_PATH,
} from './fixtures.js'

/** The modal's dialog name (aria-label — the 四选一 panel). */
const DIALOG_NAME = '研究树缺失处置'
/** The four 处置 button names (design §4 table, task-pinned). */
const BTN_RESCAN = '恢复'
const BTN_REBIND = '重初始化'
const BTN_UNBIND = '移除登记'
const BTN_ACK = '推后'

interface ModalFaces {
  readonly load: ReturnType<typeof vi.fn>
  readonly rescan: ReturnType<typeof vi.fn>
  readonly bindProject: ReturnType<typeof vi.fn>
  readonly unbindProject: ReturnType<typeof vi.fn>
  readonly ackMissingReminder: ReturnType<typeof vi.fn>
}

/**
 * Render the shell with explicit stub faces (the modal spec inspects the
 * mutation calls). `loads` are the plane-state results the fetch resolves
 * IN ORDER (the first load on mount, then the post-action re-fetch; the
 * last value repeats if asked again). The four mutation faces default to
 * wire-valid success resolvers; individual cases override via `impls`.
 */
function renderMissing(
  loads: readonly GetResearchPlaneStateResult[],
  impls: {
    readonly rescanImpl?: () => Promise<unknown>
    readonly bindImpl?: () => Promise<unknown>
    readonly unbindImpl?: () => Promise<unknown>
    readonly ackImpl?: () => Promise<unknown>
  } = {},
): ModalFaces {
  const load = vi.fn()
  for (const value of loads) {
    load.mockResolvedValueOnce(value)
  }
  if (loads.length > 0) {
    load.mockResolvedValue(loads[loads.length - 1])
  }
  const rescan = vi.fn(
    impls.rescanImpl ??
      (async () => ({
        hub: null,
        dirNames: { treeDir: '.research', hubDir: '.research-control' },
        projects: [],
        missing: [],
      })),
  )
  const bindProject = vi.fn(
    impls.bindImpl ?? (async () => ({ projectId: 'PRJ-3', registryPath: null, dbMigrated: false })),
  )
  const unbindProject = vi.fn(
    impls.unbindImpl ?? (async () => ({ projectId: 'PRJ-3', archivedDir: `${MISSING_WS_PATH}/.research.archived-1770000000000` })),
  )
  const ackMissingReminder = vi.fn(impls.ackImpl ?? (async () => ({ acknowledged: true })))
  // T5.1: the shell requires the HUB 总览 fetch face (the modal rides a
  // HUB session, so the HUB branch renders the overview under the modal —
  // the inert resolver resolves the single-project wire fixture).
  const loadHubOverview = vi.fn(async (): Promise<HubOverviewResult> => HUB_OVERVIEW_RESULT)
  // T5.2: the shell requires the 重要事件 stream faces. The modal spec rides
  // the 总览 entry (the stream is NOT mounted here), so inert EMPTY
  // resolvers keep this file focused on the modal.
  const loadPortfolioInterventions = vi.fn(async (): Promise<GetPortfolioInterventionsResult> => ({ items: [] }))
  const updateInterventionState = vi.fn(async (): Promise<UpdateInterventionStateResult> => ({
    interventionId: 'IV-1',
    statusFrom: 'OPEN',
    statusTo: 'PENDING',
    closedAt: null,
    resolutionNote: null,
  }))
  const onInvestigate = vi.fn(async (): Promise<string> => '调查已启动')
  render(
    <StrictMode>
      <ResearchShell
        sessionId="sess-hub"
        loadPlaneState={load as ResearchShellProps['loadPlaneState']}
        loadHubOverview={loadHubOverview}
        loadPortfolioInterventions={loadPortfolioInterventions as ResearchShellProps['loadPortfolioInterventions']}
        updateInterventionState={updateInterventionState as ResearchShellProps['updateInterventionState']}
        onInvestigate={onInvestigate as ResearchShellProps['onInvestigate']}
        setHub={vi.fn(async () => ({ hubPath: '/workspace/hub', registryPath: '/workspace/hub/.research-control/registry.yaml' }))}
        bindProject={bindProject as ResearchShellProps['bindProject']}
        rescan={rescan as ResearchShellProps['rescan']}
        unbindProject={unbindProject as ResearchShellProps['unbindProject']}
        ackMissingReminder={ackMissingReminder as ResearchShellProps['ackMissingReminder']}
      />
    </StrictMode>,
  )
  return { load, rescan, bindProject, unbindProject, ackMissingReminder }
}

afterEach(() => {
  cleanup()
})

/** Wait for the 四选一 modal to be open. */
async function awaitModal(): Promise<void> {
  await screen.findByRole('dialog', { name: DIALOG_NAME })
}

/** Wait for the modal to be gone (the closed state — no dialog at all). */
async function awaitModalClosed(): Promise<void> {
  await waitFor(() => {
    expect(screen.queryByRole('dialog', { name: DIALOG_NAME })).toBeNull()
  })
}

describe('MissingModal — 弹窗出现（首次渲染，live MISSING 条目）', () => {
  it('pops on the first render when the plane state carries a live missing entry — listing displayName + id + registered path', async () => {
    renderMissing([MISSING_RESULT])

    await awaitModal()
    // The live entry's three fields (the task's listing contract).
    expect(screen.getByText(MISSING_ENTRY.displayName)).toBeTruthy()
    expect(screen.getByText(MISSING_ENTRY.projectId)).toBeTruthy()
    expect(screen.getByText(MISSING_WS_PATH)).toBeTruthy()
    // All four 处置 actions render per entry.
    for (const label of [BTN_RESCAN, BTN_REBIND, BTN_UNBIND, BTN_ACK]) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy()
    }
  })

  it('lists ONLY live entries — an already-deferred (推后-acked) entry is NOT listed (the pinned dedup rule)', async () => {
    renderMissing([MISSING_RESULT]) // missing: [PRJ-3 (live), PRJ-4 (deferred)]

    await awaitModal()
    expect(screen.getByText(MISSING_ENTRY.displayName)).toBeTruthy()
    // PRJ-4 (deferred: true) is filtered out — its identity is absent.
    expect(screen.queryByText('PRJ-4')).toBeNull()
    expect(screen.queryByText('已推后项目')).toBeNull()
    expect(screen.queryByText('/workspace/proj-4')).toBeNull()
    // Exactly ONE entry card → exactly four action buttons in total.
    expect(screen.getAllByRole('button', { name: BTN_RESCAN })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: BTN_ACK })).toHaveLength(1)
  })

  it('never pops when every missing entry is already deferred (the second runtime state)', async () => {
    renderMissing([MISSING_ACKED_RESULT]) // missing: [PRJ-3 (deferred), PRJ-4 (deferred)]

    // The ready face renders (the hub console) — and NO modal.
    expect(await screen.findByRole('button', { name: '总览' })).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: DIALOG_NAME })).toBeNull()
  })

  it('pops over the UNREGISTERED 引导卡 too (the modal is plane-level, not session-role-level)', async () => {
    renderMissing([MISSING_RESULT_AT_UNREGISTERED])

    await awaitModal()
    // The 引导卡 is underneath (the modal overlays the branch).
    expect(screen.getByRole('region', { name: '研究管理系统引导' })).toBeTruthy()
    expect(screen.getByText(MISSING_ENTRY.displayName)).toBeTruthy()
  })
})

describe('MissingModal — 四动作（正确的 RPC + 正确的 args + 成功后关闭/重取）', () => {
  it('恢复 fires rescan({}) — the strict empty request — closes the modal and re-fetches', async () => {
    const faces = renderMissing([MISSING_RESULT, MISSING_CLEARED_RESULT])
    await awaitModal()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: BTN_RESCAN }))
    })

    expect(faces.rescan).toHaveBeenCalledTimes(1)
    expect(faces.rescan).toHaveBeenCalledWith({})
    // The other three RPCs are untouched.
    expect(faces.bindProject).not.toHaveBeenCalled()
    expect(faces.unbindProject).not.toHaveBeenCalled()
    expect(faces.ackMissingReminder).not.toHaveBeenCalled()
    // Success tail: modal closed + plane state re-fetched (initial + 1).
    await awaitModalClosed()
    expect(faces.load).toHaveBeenCalledTimes(2)
  })

  it('重初始化 fires bindProject({ wsPath, scaffold: true }) at the registered path — closes and re-fetches', async () => {
    const faces = renderMissing([MISSING_RESULT, MISSING_CLEARED_RESULT])
    await awaitModal()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: BTN_REBIND }))
    })

    expect(faces.bindProject).toHaveBeenCalledTimes(1)
    expect(faces.bindProject).toHaveBeenCalledWith({ wsPath: MISSING_WS_PATH, scaffold: true })
    expect(faces.rescan).not.toHaveBeenCalled()
    expect(faces.unbindProject).not.toHaveBeenCalled()
    expect(faces.ackMissingReminder).not.toHaveBeenCalled()
    await awaitModalClosed()
    expect(faces.load).toHaveBeenCalledTimes(2)
  })

  it('移除登记 fires unbindProject({ wsPath }) — the wire takes the registered path — closes and re-fetches', async () => {
    const faces = renderMissing([MISSING_RESULT, MISSING_CLEARED_RESULT])
    await awaitModal()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: BTN_UNBIND }))
    })

    expect(faces.unbindProject).toHaveBeenCalledTimes(1)
    expect(faces.unbindProject).toHaveBeenCalledWith({ wsPath: MISSING_WS_PATH })
    expect(faces.rescan).not.toHaveBeenCalled()
    expect(faces.bindProject).not.toHaveBeenCalled()
    expect(faces.ackMissingReminder).not.toHaveBeenCalled()
    await awaitModalClosed()
    expect(faces.load).toHaveBeenCalledTimes(2)
  })

  it('推后 fires ackMissingReminder({ projectId }) — closes the modal and re-fetches', async () => {
    const faces = renderMissing([MISSING_RESULT, MISSING_ACKED_RESULT])
    await awaitModal()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: BTN_ACK }))
    })

    expect(faces.ackMissingReminder).toHaveBeenCalledTimes(1)
    expect(faces.ackMissingReminder).toHaveBeenCalledWith({ projectId: MISSING_ENTRY.projectId })
    expect(faces.rescan).not.toHaveBeenCalled()
    expect(faces.bindProject).not.toHaveBeenCalled()
    expect(faces.unbindProject).not.toHaveBeenCalled()
    await awaitModalClosed()
    expect(faces.load).toHaveBeenCalledTimes(2)
  })

  it('every action button is disabled while an action is in flight', async () => {
    let resolveAck: ((value: { acknowledged: true }) => void) | undefined
    // The re-fetch returns the ACKED state (deferred flipped — the pinned
    // host contract), so the modal stays closed after the success tail.
    const faces = renderMissing([MISSING_RESULT, MISSING_ACKED_RESULT], {
      ackImpl: () =>
        new Promise((resolve) => {
          resolveAck = resolve
        }),
    })
    await awaitModal()

    fireEvent.click(screen.getByRole('button', { name: BTN_ACK }))
    // The in-flight state: every 处置 button is disabled (one action at a
    // time — the host serializes plane mutations on one FIFO mutex).
    await waitFor(() => {
      expect((screen.getByRole('button', { name: BTN_ACK }) as HTMLButtonElement).disabled).toBe(true)
      expect((screen.getByRole('button', { name: BTN_RESCAN }) as HTMLButtonElement).disabled).toBe(true)
    })

    await act(async () => {
      resolveAck!({ acknowledged: true })
    })
    await awaitModalClosed()
    expect(faces.load).toHaveBeenCalledTimes(2)
  })
})

describe('MissingModal — 运行时去重（推后 → 同运行期二次渲染不再弹）', () => {
  it('DEDUP: after 推后 + re-fetch (the host flips `deferred` to true), the second render does NOT re-pop', async () => {
    // loads[0]: the entry is live (the first render pops); loads[1]: the
    // post-ack re-fetch — the entry STAYS in `missing` but its `deferred`
    // flag is `true` (the pinned host contract: the read port projects the
    // runtime set live; nothing drops). The modal must stay closed.
    const faces = renderMissing([MISSING_RESULT, MISSING_ACKED_RESULT])
    await awaitModal()
    expect(screen.getByText(MISSING_ENTRY.displayName)).toBeTruthy()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: BTN_ACK }))
    })

    // The re-fetch settled (the second render over the acked state).
    expect(faces.load).toHaveBeenCalledTimes(2)
    await awaitModalClosed()
    // The underlying branch re-rendered (the hub console — the re-fetch's
    // ready face) and NO modal is present: the acked entry is filtered by
    // its `deferred: true` flag — no second pop in the same runtime.
    expect(await screen.findByRole('button', { name: '总览' })).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: DIALOG_NAME })).toBeNull()
    expect(screen.queryByText(MISSING_ENTRY.displayName)).toBeNull()
  })

  it('multi-entry: acking ONE entry re-pops for the OTHER live entry only (per-entry 挂起 semantics)', async () => {
    const faces = renderMissing([MISSING_TWO_RESULT, MISSING_TWO_ACKED_FIRST_RESULT])
    await awaitModal()
    // Both live entries are listed on the first pop.
    expect(screen.getAllByText(MISSING_ENTRY.displayName)).toHaveLength(1)
    expect(screen.getByText('另一个缺失项目')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: BTN_ACK })).toHaveLength(2)

    // 推后 the FIRST entry (PRJ-3).
    await act(async () => {
      fireEvent.click(
        screen.getAllByRole('button', { name: BTN_ACK })[0]!,
      )
    })

    expect(faces.ackMissingReminder).toHaveBeenCalledTimes(1)
    expect(faces.ackMissingReminder).toHaveBeenCalledWith({ projectId: 'PRJ-3' })
    expect(faces.load).toHaveBeenCalledTimes(2)
    // The re-fetch still carries PRJ-5 (live) → the modal RE-POPS for it
    // ONLY — PRJ-3 (deferred: true after the ack) is gone from the list.
    await awaitModal()
    expect(screen.getByText('另一个缺失项目')).toBeTruthy()
    expect(screen.queryByText(MISSING_ENTRY.projectId)).toBeNull()
    expect(screen.queryByText(MISSING_ENTRY.displayName)).toBeNull()
    expect(screen.getAllByRole('button', { name: BTN_ACK })).toHaveLength(1)
  })
})

describe('MissingModal — 错误（显示错误, 弹窗保留, 不重取）', () => {
  it('a rejected 恢复 shows the error (role=alert), the modal STAYS open, and no re-fetch happens', async () => {
    const fault = new Error(
      'PLANE_NOT_REGISTERED_WORKSPACE: /workspace/proj-3 is not a registered DSH workspace — nothing unregistered can be unbound (design §3.2)',
    )
    const faces = renderMissing([MISSING_RESULT], {
      rescanImpl: async () => {
        throw fault
      },
    })
    await awaitModal()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: BTN_RESCAN }))
    })

    // The fault message is shown in the modal (role=alert, 处置失败 prefix).
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('处置失败：')
    expect(alert.textContent).toContain('PLANE_NOT_REGISTERED_WORKSPACE')
    // The modal STAYS open (the entry is still 挂起) with all entries.
    expect(screen.getByRole('dialog', { name: DIALOG_NAME })).toBeTruthy()
    expect(screen.getByText(MISSING_ENTRY.displayName)).toBeTruthy()
    // No re-fetch (the fault short-circuits the success tail).
    expect(faces.load).toHaveBeenCalledTimes(1)
    // The buttons are enabled again (the user can retry).
    expect((screen.getByRole('button', { name: BTN_RESCAN }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('a rejected 推后 keeps the entry live in the modal (the ack flag was NOT set — the next render re-pops)', async () => {
    // The ack faults (e.g. PLANE_NOT_MISSING — the host refused the flag):
    // the modal stays, the error shows, and — crucially — the SAME render
    // still lists the entry (the dedup flag is host-side only; a failed
    // ack changes nothing on the wire).
    const faces = renderMissing([MISSING_RESULT], {
      ackImpl: async () => {
        throw new Error('PLANE_NOT_MISSING: project PRJ-3 is not in the plane\'s MISSING set — the 「推后处理」 flag is for live MISSING entries only')
      },
    })
    await awaitModal()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: BTN_ACK }))
    })

    await screen.findByRole('alert')
    expect(screen.getByRole('dialog', { name: DIALOG_NAME })).toBeTruthy()
    expect(screen.getByText(MISSING_ENTRY.displayName)).toBeTruthy()
    expect(faces.load).toHaveBeenCalledTimes(1)
  })
})
