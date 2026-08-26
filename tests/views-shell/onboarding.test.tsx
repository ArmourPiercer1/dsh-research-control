// @vitest-environment jsdom
/**
 * V2-T4.2 — 引导卡 component tests (design §5 引导卡状态表 + §8 设中枢/接入流).
 *
 * Plain stub props — no real cordis in the component spec (the views-* test
 * pattern). All three injected faces (`loadPlaneState` / `setHub` /
 * `bindProject`) are vi.fn stubs per case; the wire fixtures are re-parsed
 * through the strict `GetResearchPlaneStateResultSchema` in ./fixtures.ts.
 *
 * Gate coverage (plan §P4 T4.2):
 *  - the two §5 状态表 states: hub === null → BOTH buttons enabled;
 *    hub !== null → 「设为中枢」 disabled + reason copy 已存在中枢,
 *    「接入」 enabled;
 *  - 设为中枢: confirm dialog (explains the `<hubDir>/` marker + empty
 *    `registry.yaml`) → `setHub({wsPath})` → success RE-FETCHES the plane
 *    state → the role flips to HUB → the 中枢控制台 renders (4 entries);
 *  - 接入: displayName dialog (prefilled with the folder name) →
 *    `bindProject({wsPath, displayName, scaffold: true})` → success →
 *    re-fetch → the project console renders (MANAGED with a hub /
 *    STANDALONE without);
 *  - 无中枢 接入: the 「尚无管理中枢」 warning comes FIRST and confirming
 *    does NOT block (proceeds to the displayName dialog, single-workspace
 *    mode per design §5/§8 Q7);
 *  - EVERY cancel path: dialog closes, no RPC fired, no re-fetch, state
 *    unchanged (the card stays exactly as it was);
 *  - every RPC error: the error shows on the card (role=alert), the card
 *    stays, no re-fetch;
 *  - NO_CWD: the disabled narrow variant stays inert (no dialog reachable,
 *    no reason copy).
 *
 * StrictMode note: the shell's in-flight dedupe reuses the first fetch
 * across StrictMode's double effect — exactly one fetch per user-visible
 * load, and the post-mutation re-fetch is the second visible load.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { act, StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// BEFORE any shell import (the shell transitively loads the cockpit → the
// WP-4.5 graph → @xyflow/react; the mock renders the node/edge layer for
// real, the WP-4.5 test-layer pattern).
import '../graph/xyflow-mock.js'

import {
  mountResearchRemotes,
  unmountResearchRemotes,
  type RemoteContext,
} from '../../src/client/dsh-adapter/remote/mount.js'
import { ResearchShell, type ResearchShellProps } from '../../src/client/views/shell/index.js'
import type {
  GetResearchPlaneStateResult,
} from '../../src/shared/rpc-contracts.js'
import { makeStubRpc, type StubRpc } from '../stores/stub-rpc.js'
import {
  HUB_RESULT_AT_UNREGISTERED,
  MANAGED_RESULT_AT_UNREGISTERED,
  NO_CWD_RESULT,
  STANDALONE_RESULT_AT_UNREGISTERED,
  UNREGISTERED_NOHUB_RESULT,
  UNREGISTERED_PATH,
  UNREGISTERED_RESULT,
} from './fixtures.js'

/** The two §5 onboarding button names (design §5 引导卡状态表). */
const SET_HUB_BUTTON = '将此工作区设为研究管理中枢'
const BIND_BUTTON = '将此工作区接入研究管理系统'
/** The §5 状态表 reason copy (有中枢 → 「设为中枢」 置灰). */
const SET_HUB_REASON = '已存在中枢'

const SET_HUB_OK = {
  hubPath: UNREGISTERED_PATH,
  registryPath: `${UNREGISTERED_PATH}/.research-control/registry.yaml`,
} as const
const BIND_OK = { projectId: 'PRJ-9', registryPath: null, dbMigrated: false } as const

interface Faces {
  readonly load: ReturnType<typeof vi.fn>
  readonly setHub: ReturnType<typeof vi.fn>
  readonly bindProject: ReturnType<typeof vi.fn>
}

/**
 * Render the shell with explicit stub faces (the onboarding flows inspect
 * the mutation calls, unlike the branch-routing spec). `loads` are the
 * plane-state results the fetch resolves IN ORDER (the first load on mount,
 * then the post-mutation re-fetch; the last value repeats if asked again).
 */
function renderOnboarding(
  loads: readonly GetResearchPlaneStateResult[],
  opts: {
    readonly sessionId?: string
    readonly setHubImpl?: () => Promise<unknown>
    readonly bindImpl?: () => Promise<unknown>
  } = {},
): Faces {
  const load = vi.fn()
  for (const value of loads) {
    load.mockResolvedValueOnce(value)
  }
  if (loads.length > 0) {
    load.mockResolvedValue(loads[loads.length - 1])
  }
  const setHub = vi.fn(opts.setHubImpl ?? (async () => SET_HUB_OK))
  const bindProject = vi.fn(opts.bindImpl ?? (async () => BIND_OK))
  // T4.3: the shell requires the three MISSING-modal mutation faces. The
  // onboarding fixtures carry NO missing entries (`missing: []`), so the
  // modal never pops and the inert resolvers stay inert.
  const rescan = vi.fn(async () => ({ hub: null, dirNames: { treeDir: '.research', hubDir: '.research-control' }, projects: [], missing: [] }))
  const unbindProject = vi.fn(async () => ({ projectId: 'PRJ-9', archivedDir: '/workspace/.research-control/archived/PRJ-9' }))
  const ackMissingReminder = vi.fn(async () => ({ acknowledged: true }))
  render(
    <StrictMode>
      <ResearchShell
        sessionId={opts.sessionId}
        loadPlaneState={load as ResearchShellProps['loadPlaneState']}
        setHub={setHub as ResearchShellProps['setHub']}
        bindProject={bindProject as ResearchShellProps['bindProject']}
        rescan={rescan as ResearchShellProps['rescan']}
        unbindProject={unbindProject as ResearchShellProps['unbindProject']}
        ackMissingReminder={ackMissingReminder as ResearchShellProps['ackMissingReminder']}
      />
    </StrictMode>,
  )
  return { load, setHub, bindProject }
}

/**
 * Mount the plugin's facade over the stub namespace — required ONLY for the
 * success-flip cases whose re-fetch resolves a MANAGED/STANDALONE role (the
 * project console branch renders the REAL cockpit, which fetches through
 * the mounted facade; the HUB flip renders the frame and needs no mount).
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

afterEach(() => {
  cleanup()
  unmountResearchRemotes()
})

/** Wait for the 引导卡 to render (the ready face after the initial fetch). */
async function awaitCard(): Promise<void> {
  expect(await screen.findByRole('region', { name: '研究管理系统引导' })).toBeTruthy()
}

describe('OnboardingCard — §5 引导卡状态表 (two states)', () => {
  it('hub === null: BOTH buttons enabled, no reason copy', async () => {
    renderOnboarding([UNREGISTERED_NOHUB_RESULT], { sessionId: 'sess-unregistered' })
    await awaitCard()

    expect((screen.getByRole('button', { name: SET_HUB_BUTTON }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('button', { name: BIND_BUTTON }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.queryByText(SET_HUB_REASON)).toBeNull()
  })

  it('hub !== null: 「设为中枢」 disabled + reason copy 已存在中枢, 「接入」 enabled', async () => {
    renderOnboarding([UNREGISTERED_RESULT], { sessionId: 'sess-unregistered' })
    await awaitCard()

    expect((screen.getByRole('button', { name: SET_HUB_BUTTON }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(SET_HUB_REASON)).toBeTruthy()
    expect((screen.getByRole('button', { name: BIND_BUTTON }) as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('OnboardingCard — 设为中枢 flow (design §8)', () => {
  it('confirm dialog → setHub({wsPath}) → success RE-FETCHES → role flips to HUB (hub console renders)', async () => {
    const faces = renderOnboarding([UNREGISTERED_NOHUB_RESULT, HUB_RESULT_AT_UNREGISTERED], {
      sessionId: 'sess-unregistered',
    })
    await awaitCard()

    // The confirm dialog explains what will be created (design §8 设为中枢).
    fireEvent.click(screen.getByRole('button', { name: SET_HUB_BUTTON }))
    const dialog = await screen.findByRole('dialog', { name: '设为研究管理中枢' })
    expect(dialog).toBeTruthy()
    expect(screen.getByText('.research-control/')).toBeTruthy()
    expect(screen.getByText('registry.yaml')).toBeTruthy()

    // Confirm → the RPC fires with the session wsPath; success re-fetches
    // the plane state and the role flips to HUB (the 中枢控制台 renders).
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '设为中枢' }))
    })
    expect(faces.setHub).toHaveBeenCalledTimes(1)
    expect(faces.setHub).toHaveBeenCalledWith({ wsPath: UNREGISTERED_PATH })
    expect(faces.load).toHaveBeenCalledTimes(2) // initial + the post-mutation re-fetch

    expect(await screen.findByRole('button', { name: '总览' })).toBeTruthy()
    expect(document.querySelector('[data-role="HUB"]')).toBeTruthy()
    for (const label of ['总览', '重要事件', '调查员', '设置']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy()
    }
  })

  it('cancel on the confirm dialog: no RPC fired, no re-fetch, card stays unchanged', async () => {
    const faces = renderOnboarding([UNREGISTERED_NOHUB_RESULT], { sessionId: 'sess-unregistered' })
    await awaitCard()

    fireEvent.click(screen.getByRole('button', { name: SET_HUB_BUTTON }))
    await screen.findByRole('dialog', { name: '设为研究管理中枢' })

    fireEvent.click(screen.getByRole('button', { name: '取消' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(faces.setHub).not.toHaveBeenCalled()
    expect(faces.load).toHaveBeenCalledTimes(1) // no re-fetch — state unchanged
    expect(screen.getByRole('region', { name: '研究管理系统引导' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull() // no error surfaced
    expect((screen.getByRole('button', { name: SET_HUB_BUTTON }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('RPC error: the error shows on the card, the card stays, no re-fetch', async () => {
    const fault = new Error(
      `research shell: setHub failed — PLANE_HUB_EXISTS: a hub already exists at ${UNREGISTERED_PATH}`,
    )
    const faces = renderOnboarding([UNREGISTERED_NOHUB_RESULT], {
      sessionId: 'sess-unregistered',
      setHubImpl: async () => {
        throw fault
      },
    })
    await awaitCard()

    fireEvent.click(screen.getByRole('button', { name: SET_HUB_BUTTON }))
    await screen.findByRole('dialog', { name: '设为研究管理中枢' })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '设为中枢' }))
    })

    // The error is shown (role=alert) and the card STAYS (still interactive —
    // the user can retry; the button is enabled again).
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('PLANE_HUB_EXISTS')
    expect(screen.getByRole('region', { name: '研究管理系统引导' })).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull() // the dialog closed
    expect((screen.getByRole('button', { name: SET_HUB_BUTTON }) as HTMLButtonElement).disabled).toBe(false)
    expect(faces.load).toHaveBeenCalledTimes(1) // no re-fetch after a failed mutation
  })
})

describe('OnboardingCard — 接入 flow (design §8)', () => {
  it('hub present: displayName dialog (prefilled with the folder name) → bindProject → re-fetch → MANAGED console', async () => {
    await mountStub(makeStubRpc())
    const faces = renderOnboarding([UNREGISTERED_RESULT, MANAGED_RESULT_AT_UNREGISTERED], {
      sessionId: 'sess-unregistered',
    })
    await awaitCard()

    // 接入（有中枢）: no warning — the displayName dialog opens directly,
    // prefilled with the folder name (design §8: 默认文件夹名).
    fireEvent.click(screen.getByRole('button', { name: BIND_BUTTON }))
    const dialog = await screen.findByRole('dialog', { name: '接入研究管理系统' })
    expect(dialog).toBeTruthy()
    const input = screen.getByLabelText('项目显示名') as HTMLInputElement
    expect(input.value).toBe('unregistered')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '接入' }))
    })
    expect(faces.bindProject).toHaveBeenCalledTimes(1)
    expect(faces.bindProject).toHaveBeenCalledWith({
      wsPath: UNREGISTERED_PATH,
      displayName: 'unregistered',
      scaffold: true,
    })
    expect(faces.load).toHaveBeenCalledTimes(2) // initial + the post-mutation re-fetch

    // The role flips to MANAGED — the project console (real cockpit) renders.
    expect(await screen.findByText('研究总览')).toBeTruthy()
    expect(document.querySelector('[data-role="MANAGED"]')).toBeTruthy()
  })

  it('no hub: 「尚无管理中枢」 warning FIRST — confirming does NOT block → displayName dialog → bindProject → STANDALONE console', async () => {
    await mountStub(makeStubRpc())
    const faces = renderOnboarding([UNREGISTERED_NOHUB_RESULT, STANDALONE_RESULT_AT_UNREGISTERED], {
      sessionId: 'sess-unregistered',
    })
    await awaitCard()

    // The warning comes FIRST (design §5 状态表 无中枢 row / §8 接入（无中枢）).
    fireEvent.click(screen.getByRole('button', { name: BIND_BUTTON }))
    const warning = await screen.findByRole('dialog', { name: '尚无管理中枢' })
    expect(warning).toBeTruthy()
    // The single-workspace-mode statement (design §8 接入（无中枢）/ Q7).
    expect(screen.getByText(/单工作区模式/)).toBeTruthy()

    // Confirming does NOT block — it proceeds to the displayName dialog.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '继续接入' }))
    })
    expect(faces.bindProject).not.toHaveBeenCalled() // the confirm only proceeds
    await screen.findByRole('dialog', { name: '接入研究管理系统' })
    const input = screen.getByLabelText('项目显示名') as HTMLInputElement
    expect(input.value).toBe('unregistered')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '接入' }))
    })
    expect(faces.bindProject).toHaveBeenCalledTimes(1)
    expect(faces.bindProject).toHaveBeenCalledWith({
      wsPath: UNREGISTERED_PATH,
      displayName: 'unregistered',
      scaffold: true,
    })
    expect(faces.load).toHaveBeenCalledTimes(2)

    // Single-workspace mode: the re-fetch resolves STANDALONE — the project
    // console (real cockpit) renders.
    expect(await screen.findByText('研究总览')).toBeTruthy()
    expect(document.querySelector('[data-role="STANDALONE"]')).toBeTruthy()
  })

  it('cancel on the 「尚无管理中枢」 warning: no RPC fired, no re-fetch, card stays', async () => {
    const faces = renderOnboarding([UNREGISTERED_NOHUB_RESULT], { sessionId: 'sess-unregistered' })
    await awaitCard()

    fireEvent.click(screen.getByRole('button', { name: BIND_BUTTON }))
    await screen.findByRole('dialog', { name: '尚无管理中枢' })

    fireEvent.click(screen.getByRole('button', { name: '取消' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(faces.bindProject).not.toHaveBeenCalled()
    expect(faces.load).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('region', { name: '研究管理系统引导' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('cancel on the displayName dialog (hub present): no RPC fired, no re-fetch, card stays', async () => {
    const faces = renderOnboarding([UNREGISTERED_RESULT], { sessionId: 'sess-unregistered' })
    await awaitCard()

    fireEvent.click(screen.getByRole('button', { name: BIND_BUTTON }))
    await screen.findByRole('dialog', { name: '接入研究管理系统' })

    fireEvent.click(screen.getByRole('button', { name: '取消' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(faces.bindProject).not.toHaveBeenCalled()
    expect(faces.load).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('region', { name: '研究管理系统引导' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('cancel on the displayName dialog after the no-hub warning continue: no RPC fired, no re-fetch', async () => {
    const faces = renderOnboarding([UNREGISTERED_NOHUB_RESULT], { sessionId: 'sess-unregistered' })
    await awaitCard()

    fireEvent.click(screen.getByRole('button', { name: BIND_BUTTON }))
    await screen.findByRole('dialog', { name: '尚无管理中枢' })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '继续接入' }))
    })
    await screen.findByRole('dialog', { name: '接入研究管理系统' })

    fireEvent.click(screen.getByRole('button', { name: '取消' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(faces.bindProject).not.toHaveBeenCalled()
    expect(faces.load).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('region', { name: '研究管理系统引导' })).toBeTruthy()
  })

  it('an edited display name is what bindProject receives', async () => {
    const faces = renderOnboarding([UNREGISTERED_RESULT], { sessionId: 'sess-unregistered' })
    await awaitCard()

    fireEvent.click(screen.getByRole('button', { name: BIND_BUTTON }))
    await screen.findByRole('dialog', { name: '接入研究管理系统' })

    const input = screen.getByLabelText('项目显示名') as HTMLInputElement
    fireEvent.change(input, { target: { value: '我的新项目' } })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '接入' }))
    })
    expect(faces.bindProject).toHaveBeenCalledTimes(1)
    expect(faces.bindProject).toHaveBeenCalledWith({
      wsPath: UNREGISTERED_PATH,
      displayName: '我的新项目',
      scaffold: true,
    })
  })

  it('a blank display name keeps the confirm disabled (no empty name can be bound)', async () => {
    renderOnboarding([UNREGISTERED_RESULT], { sessionId: 'sess-unregistered' })
    await awaitCard()

    fireEvent.click(screen.getByRole('button', { name: BIND_BUTTON }))
    await screen.findByRole('dialog', { name: '接入研究管理系统' })

    const input = screen.getByLabelText('项目显示名') as HTMLInputElement
    fireEvent.change(input, { target: { value: '   ' } })

    expect((screen.getByRole('button', { name: '接入' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('bindProject RPC error: the error shows on the card, the card stays, no re-fetch', async () => {
    const fault = new Error(
      `research shell: bindProject failed — PLANE_TREE_EXISTS: a research tree already exists at ${UNREGISTERED_PATH}/.research`,
    )
    const faces = renderOnboarding([UNREGISTERED_NOHUB_RESULT], {
      sessionId: 'sess-unregistered',
      bindImpl: async () => {
        throw fault
      },
    })
    await awaitCard()

    fireEvent.click(screen.getByRole('button', { name: BIND_BUTTON }))
    await screen.findByRole('dialog', { name: '尚无管理中枢' })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '继续接入' }))
    })
    await screen.findByRole('dialog', { name: '接入研究管理系统' })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '接入' }))
    })

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('PLANE_TREE_EXISTS')
    expect(screen.getByRole('region', { name: '研究管理系统引导' })).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect((screen.getByRole('button', { name: BIND_BUTTON }) as HTMLButtonElement).disabled).toBe(false)
    expect(faces.load).toHaveBeenCalledTimes(1)
  })
})

describe('OnboardingCard — NO_CWD narrow variant stays inert (T4.1 contract kept)', () => {
  it('both buttons disabled, no dialog reachable, no reason copy', async () => {
    renderOnboarding([NO_CWD_RESULT], { sessionId: 'sess-no-cwd' })
    await awaitCard()

    expect(screen.getByText('本会话未关联工作区')).toBeTruthy()
    const setHubButton = screen.getByRole('button', { name: SET_HUB_BUTTON }) as HTMLButtonElement
    const bindButton = screen.getByRole('button', { name: BIND_BUTTON }) as HTMLButtonElement
    expect(setHubButton.disabled).toBe(true)
    expect(bindButton.disabled).toBe(true)
    expect(screen.queryByText(SET_HUB_REASON)).toBeNull()

    // The disabled buttons fire no click handler — no dialog, no RPC.
    fireEvent.click(setHubButton)
    fireEvent.click(bindButton)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
