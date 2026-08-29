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
  GetPortfolioInterventionsResult,
  GetResearchPlaneStateResult,
  HubOverviewResult,
  UpdateInterventionStateResult,
} from '../../src/shared/rpc-contracts.js'
import { makeStubRpc, type StubRpc } from '../stores/stub-rpc.js'
import { HUB_OVERVIEW_RESULT } from '../views-overview/fixtures.js'
import {
  HUB_RESULT_AT_UNREGISTERED,
  MANAGED_RESULT_AT_UNREGISTERED,
  NO_CWD_RESULT,
  STANDALONE_RESULT_AT_UNREGISTERED,
  UNREGISTERED_NOHUB_RESULT,
  UNREGISTERED_PATH,
  UNREGISTERED_RESULT,
} from './fixtures.js'
import { extractResearchErrorCarrier } from '../../src/client/util/error-carrier.js'

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

// ── V2-UI-0.4 UI-2 journey fixtures (the create / inspect wire shapes) ────
/** Create SUCCESS arm (the wire result the host resolves on a clean run). */
const CREATE_OK_RESULT = {
  ok: true,
  projectId: 'PRJ-9',
  treePath: `${UNREGISTERED_PATH}/.research`,
  registryPath: null,
  dbMigrated: false,
} as const

/** Create FAILURE arm (RESOLVED, ok:false — the three-stage DTO; the
 *  gitInit step dies after the tree directory exists). */
const CREATE_FAIL_RESULT = {
  ok: false,
  code: 'LP_GIT_INIT',
  failedStep: 'gitInit',
  completedSteps: ['mkdir'],
  partialChangeNote: 'The tree directory /workspace/unregistered/.research was created.',
  detail: 'git init failed',
} as const

/** Inspect state 1: a live Research Control project (the re-bind path). */
const INSPECT_RC_RESULT = {
  wsPath: UNREGISTERED_PATH,
  state: 'RC_PROJECT',
  message: 'Existing Research Control project detected.',
  detail: null,
  hasGitRepo: true,
  hasResearchTree: true,
  treeValid: true,
  alreadyManaged: true,
  projectId: 'PRJ-1',
  title: '树标题',
} as const

/** Inspect state 2: a Git repo without the Research Control tree. */
const INSPECT_GIT_RESULT = {
  wsPath: UNREGISTERED_PATH,
  state: 'GIT_ONLY',
  message: 'Git repository detected.',
  detail: 'Research Control is not initialized.',
  hasGitRepo: true,
  hasResearchTree: false,
  treeValid: false,
  alreadyManaged: false,
} as const

/** Inspect state 3: a plain directory (no Git, no tree). */
const INSPECT_PLAIN_RESULT = {
  wsPath: UNREGISTERED_PATH,
  state: 'PLAIN_DIR',
  message: 'Directory detected.',
  detail: 'Git is not initialized.',
  hasGitRepo: false,
  hasResearchTree: false,
  treeValid: false,
  alreadyManaged: false,
} as const

/** Inspect state 4: incompatible — the flow explains and offers NO action. */
const INSPECT_INCOMPATIBLE_RESULT = {
  wsPath: UNREGISTERED_PATH,
  state: 'INCOMPATIBLE',
  message: 'Incompatible directory detected.',
  detail: 'the selected path is not an existing directory: /workspace/ghost',
  hasGitRepo: false,
  hasResearchTree: false,
  treeValid: false,
  alreadyManaged: false,
} as const

interface Faces {
  readonly load: ReturnType<typeof vi.fn>
  readonly setHub: ReturnType<typeof vi.fn>
  readonly bindProject: ReturnType<typeof vi.fn>
  /** V2-UI-0.4 UI-2: offered on the card ONLY when the case opts in. */
  readonly createLocalResearchProject: ReturnType<typeof vi.fn>
  readonly inspectProjectDirectory: ReturnType<typeof vi.fn>
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
    /** V2-UI-0.4 UI-2: OFFER the 新建研究项目 (Create) face on the card. */
    readonly createImpl?: (args: unknown) => Promise<unknown>
    /** V2-UI-0.4 UI-2: OFFER the 绑定已有目录 (Bind) inspect face on the card. */
    readonly inspectImpl?: (args: unknown) => Promise<unknown>
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
  // V2-UI-0.4 UI-2: the Create / Bind-journey faces are OPTIONAL on the
  // card — offered ONLY when the case opts in (omitted ⇒ the T4.2 card
  // stays byte-identical: no 新建研究项目 / 绑定已有目录 buttons).
  const createLocalResearchProject = vi.fn(opts.createImpl)
  const inspectProjectDirectory = vi.fn(opts.inspectImpl)
  // T4.3: the shell requires the three MISSING-modal mutation faces. The
  // onboarding fixtures carry NO missing entries (`missing: []`), so the
  // modal never pops and the inert resolvers stay inert.
  const rescan = vi.fn(async () => ({ hub: null, dirNames: { treeDir: '.research', hubDir: '.research-control' }, projects: [], missing: [], registry: [] }))
  const unbindProject = vi.fn(async () => ({ projectId: 'PRJ-9', archivedDir: '/workspace/.research-control/archived/PRJ-9' }))
  const restoreProject = vi.fn(async () => ({ wsPath: '/workspace/PRJ-9' }))
  const ackMissingReminder = vi.fn(async () => ({ acknowledged: true }))
  // T5.1: the shell requires the HUB 总览 fetch face. The onboarding cases
  // never reach the HUB overview (the UNREGISTERED/NO_CWD card branch
  // renders instead), so the inert resolver stays inert.
  const loadHubOverview = vi.fn(async (): Promise<HubOverviewResult> => HUB_OVERVIEW_RESULT)
  // T5.2: the shell requires the 重要事件 stream faces. The onboarding
  // cases never reach the console frame (the card branch renders instead),
  // so inert EMPTY resolvers stay inert.
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
        sessionId={opts.sessionId}
        loadPlaneState={load as ResearchShellProps['loadPlaneState']}
        loadHubOverview={loadHubOverview}
        loadPortfolioInterventions={loadPortfolioInterventions as ResearchShellProps['loadPortfolioInterventions']}
        updateInterventionState={updateInterventionState as ResearchShellProps['updateInterventionState']}
        onInvestigate={onInvestigate as ResearchShellProps['onInvestigate']}
        setHub={setHub as ResearchShellProps['setHub']}
        bindProject={bindProject as ResearchShellProps['bindProject']}
        rescan={rescan as ResearchShellProps['rescan']}
        unbindProject={unbindProject as ResearchShellProps['unbindProject']}
        restoreProject={restoreProject as ResearchShellProps['restoreProject']}
        ackMissingReminder={ackMissingReminder as ResearchShellProps['ackMissingReminder']}
        {...(opts.createImpl !== undefined
          ? { createLocalResearchProject: createLocalResearchProject as ResearchShellProps['createLocalResearchProject'] }
          : {})}
        {...(opts.inspectImpl !== undefined
          ? { inspectProjectDirectory: inspectProjectDirectory as ResearchShellProps['inspectProjectDirectory'] }
          : {})}
      />
    </StrictMode>,
  )
  return { load, setHub, bindProject, createLocalResearchProject, inspectProjectDirectory }
}

/**
 * Mount the plugin's facade over the stub namespace — required ONLY for the
 * success-flip cases whose re-fetch resolves a MANAGED/STANDALONE role (the
 * project console branch renders the REAL `ProjectConsole`, whose store
 * fetches through the mounted facade; the HUB flip renders the frame +
 * the overview face stub and needs no mount).
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

    expect(await screen.findByRole('button', { name: 'Portfolio' })).toBeTruthy()
    expect(document.querySelector('[data-role="HUB"]')).toBeTruthy()
    for (const label of ['Portfolio', 'Needs Attention', 'Settings']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy()
    }
    // UI-3 D1: the investigator entry is hidden from the first-level nav.
    expect(screen.queryByRole('button', { name: '调查员' })).toBeNull()
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

    // The role flips to MANAGED — the project console (同构收窄, 总览 =
    // the project page as ROOT) renders.
    expect(await screen.findByText(/PRJ-1 · Project One/)).toBeTruthy()
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
    // console (同构收窄, 总览 = the project page as ROOT) renders.
    expect(await screen.findByText(/PRJ-1 · Project One/)).toBeTruthy()
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

// ──────────────────────────────────────────────────────────────────────────
// V2-UI-0.4 UI-2 — the ADDITIVE Create / Bind-journey faces (frozen B spec).
// The T4.2 card stays byte-identical when the faces are OMITTED; the two
// journeys opt in through the optional shell props.
// ──────────────────────────────────────────────────────────────────────────

describe('OnboardingCard — UI-2 journeys are opt-in (T4.2 card byte-identical)', () => {
  it('faces omitted → NO 新建研究项目 / 绑定已有目录 buttons (the T4.2 card is unchanged)', async () => {
    renderOnboarding([UNREGISTERED_RESULT])
    await awaitCard()

    expect(screen.queryByText('新建研究项目')).toBeNull()
    expect(screen.queryByText('绑定已有目录')).toBeNull()
    // The T4.2 pair is still there, untouched.
    expect(screen.getByRole('button', { name: SET_HUB_BUTTON })).toBeTruthy()
    expect(screen.getByRole('button', { name: BIND_BUTTON })).toBeTruthy()
  })
})

describe('OnboardingCard — V2-UI-0.4 UI-2 Create journey (frozen B spec 5 steps)', () => {
  /** Open the Create dialog, advance to Step 2, and set the title. */
  async function openCreateStep2(title: string): Promise<void> {
    fireEvent.click(screen.getByRole('button', { name: '新建研究项目' }))
    await screen.findByRole('dialog', { name: '新建研究项目' })
    expect(screen.getByText('Step 1: Location')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    expect(screen.getByText('Step 2: Project metadata')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('项目标题（必填，1–200 字）'), { target: { value: title } })
  }

  it('happy path: 5 steps → createLocalResearchProject({wsPath, title}) → 进入项目 → MANAGED console', async () => {
    await mountStub(makeStubRpc())
    const faces = renderOnboarding([UNREGISTERED_RESULT, MANAGED_RESULT_AT_UNREGISTERED], {
      sessionId: 'sess-create',
      createImpl: async () => CREATE_OK_RESULT,
    })
    await awaitCard()

    fireEvent.click(screen.getByRole('button', { name: '新建研究项目' }))
    const dialog = await screen.findByRole('dialog', { name: '新建研究项目' })
    expect(dialog.getAttribute('data-create-step')).toBe('1')
    expect(screen.getByText('Step 1: Location')).toBeTruthy()
    // Step 1 shows the frozen location copy (session cwd + tree dir).
    expect(document.querySelector('[data-create-location]')?.textContent).toContain(UNREGISTERED_PATH)

    // Step 2: the title gate (optionals left empty ⇒ OMITTED from the args).
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    expect(screen.getByText('Step 2: Project metadata')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('项目标题（必填，1–200 字）'), { target: { value: '我的研究' } })
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))

    // Step 3: the confirm summary carries ONLY the set fields.
    expect(screen.getByText('Step 3: Confirm')).toBeTruthy()
    const summaryItems = [...document.querySelectorAll('[data-create-summary] li')].map((li) => li.textContent)
    expect(summaryItems).toEqual(['位置：/workspace/unregistered', '标题：我的研究'])

    // Step 3: B §5.5 — the「将执行」side-effect enumeration (four verbatim lines).
    expect(screen.getByText('将执行')).toBeTruthy()
    const effectItems = [...document.querySelectorAll('[data-create-effects] li')].map((li) => li.textContent)
    expect(effectItems).toEqual(['创建目录', 'git init', '初始化 Research Control', '注册 Project'])

    // Step 3 → 下一步 FIRES the create RPC (frozen B: Confirm → Initialize).
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    })
    expect(faces.createLocalResearchProject).toHaveBeenCalledTimes(1)
    expect(faces.createLocalResearchProject).toHaveBeenCalledWith({
      wsPath: UNREGISTERED_PATH,
      title: '我的研究',
    })

    // Step 5: Enter Project.
    expect(screen.getByText('Step 5: Enter Project')).toBeTruthy()
    expect(document.querySelector('[data-create-done]')?.textContent).toBe('项目已创建并注册：PRJ-9。')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '进入项目' }))
    })
    expect(screen.queryByRole('dialog', { name: '新建研究项目' })).toBeNull()
    expect(faces.load).toHaveBeenCalledTimes(2) // initial + the post-mutation re-fetch
    // The role flips to MANAGED — the project console renders.
    expect(await screen.findByText(/PRJ-1 · Project One/)).toBeTruthy()
    expect(document.querySelector('[data-role="MANAGED"]')).toBeTruthy()
  })

  it('optionals carried: description / importance / attention / targetDate are all sent when set', async () => {
    const faces = renderOnboarding([UNREGISTERED_RESULT], {
      sessionId: 'sess-create-opt',
      createImpl: async () => CREATE_OK_RESULT,
    })
    await awaitCard()
    await openCreateStep2(' 视觉定位 ')

    fireEvent.change(screen.getByLabelText('项目简介（可选）'), { target: { value: '研究简介' } })
    fireEvent.change(screen.getByLabelText('重要度（可选，1–5，留空默认 3）'), { target: { value: '4' } })
    fireEvent.change(screen.getByLabelText('注意力模式（可选，留空默认 常规）'), { target: { value: 'FOCUS' } })
    fireEvent.change(screen.getByLabelText('目标日期（可选，YYYY-MM-DD）'), { target: { value: '2026-12-31' } })
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))

    // The confirm summary shows the trimmed title + the display forms.
    const summaryItems = [...document.querySelectorAll('[data-create-summary] li')].map((li) => li.textContent)
    expect(summaryItems).toEqual([
      '位置：/workspace/unregistered',
      '标题：视觉定位',
      '简介：研究简介',
      '重要度：4',
      '注意力：聚焦',
      '目标日期：2026-12-31',
    ])

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    })
    expect(faces.createLocalResearchProject).toHaveBeenCalledTimes(1)
    expect(faces.createLocalResearchProject).toHaveBeenCalledWith({
      wsPath: UNREGISTERED_PATH,
      title: '视觉定位',
      description: '研究简介',
      importance: 4,
      attentionMode: 'FOCUS',
      targetDate: '2026-12-31',
    })
  })

  it('failure arm (RESOLVED ok:false): ✓/✗/○ status lines + partial-change note + 取消 / 打开目录 / Retry', async () => {
    const faces = renderOnboarding([UNREGISTERED_RESULT], {
      sessionId: 'sess-create-fail',
      createImpl: async () => CREATE_FAIL_RESULT,
    })
    await awaitCard()
    await openCreateStep2('失败项目')
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    expect(screen.getByText('Step 3: Confirm')).toBeTruthy()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    })
    expect(faces.createLocalResearchProject).toHaveBeenCalledTimes(1)

    // Step 4 STAYS — the resolved failure DTO renders the three-stage
    // partial-change state (frozen B spec: failed step + partial note +
    // Retry / Open folder / Cancel).
    const overlay = document.querySelector('[data-onboarding-create]')
    expect(overlay?.getAttribute('data-create-step')).toBe('4')
    expect(screen.getByText('Step 4: Initialize')).toBeTruthy()

    // The frozen status lines: mkdir ✓ (completed), gitInit ✗ (failed),
    // the unreached steps ○ pending.
    const lines = [...document.querySelectorAll('[data-create-line]')].map(
      (li) => `${li.getAttribute('data-create-line')}:${li.getAttribute('data-create-line-state')}:${li.textContent}`,
    )
    expect(lines).toEqual([
      'mkdir:done:✓ Directory created',
      'gitInit:failed:✗ Git initialized',
      'scaffold:pending:○ Research structure initialized',
      'metadata:pending:○ Runtime store initialized',
      'register:pending:○ Project registered',
    ])

    // The failure detail + the partial-change note (and NOT the rejection
    // error line — this is the resolved arm).
    expect(document.querySelector('[data-create-failure]')?.textContent).toBe('git init failed')
    expect(document.querySelector('[data-create-partial-note]')?.textContent).toBe(
      'The tree directory /workspace/unregistered/.research was created.',
    )
    expect(document.querySelector('[data-create-error]')).toBeNull()

    // 打开目录 reveals the folder path (the client has no host open channel
    // — path display only).
    fireEvent.click(screen.getByRole('button', { name: '打开目录' }))
    expect(document.querySelector('[data-create-folder]')?.textContent).toBe(`目录路径：${UNREGISTERED_PATH}`)

    // 取消 → back to Step 3 (the confirm step).
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(document.querySelector('[data-onboarding-create]')?.getAttribute('data-create-step')).toBe('3')
    expect(screen.getByText('Step 3: Confirm')).toBeTruthy()

    // Retry (from Step 4 after the same failure) re-fires the RPC; a
    // succeeding second call lands on Step 5.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    })
    expect(faces.createLocalResearchProject).toHaveBeenCalledTimes(2)
    expect(document.querySelector('[data-onboarding-create]')?.getAttribute('data-create-step')).toBe('4')
    faces.createLocalResearchProject.mockResolvedValueOnce(CREATE_OK_RESULT)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    })
    expect(faces.createLocalResearchProject).toHaveBeenCalledTimes(3)
    expect(document.querySelector('[data-onboarding-create]')?.getAttribute('data-create-step')).toBe('5')
    expect(screen.getByText('Step 5: Enter Project')).toBeTruthy()
  })

  it('rejection (pre-check rung): the NOTE-4 carrier decodes [research-control] <CODE> from the message', async () => {
    const faces = renderOnboarding([UNREGISTERED_RESULT], {
      sessionId: 'sess-create-rej',
      createImpl: async () => {
        throw new Error('[research-control] LP_DIR_EXISTS: the target directory already exists')
      },
    })
    await awaitCard()
    await openCreateStep2('已存在')
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    expect(screen.getByText('Step 3: Confirm')).toBeTruthy()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    })
    expect(faces.createLocalResearchProject).toHaveBeenCalledTimes(1)

    // The gateway folds every host error to code 'internal' — the client
    // machine-matches the [research-control] <CODE> prefix on the MESSAGE
    // (NOTE-4) and shows the decoded detail (no prefix spliced into copy).
    const errorLine = document.querySelector('[data-create-error]')
    expect(errorLine?.textContent).toBe('the target directory already exists')
    expect(errorLine?.textContent).not.toContain('[research-control]')
    expect(document.querySelector('[data-create-failure]')).toBeNull()
    expect(document.querySelector('[data-create-partial-note]')).toBeNull()
    // No step started — all five lines stay pending.
    const states = [...document.querySelectorAll('[data-create-line]')].map((li) => li.getAttribute('data-create-line-state'))
    expect(states).toEqual(['pending', 'pending', 'pending', 'pending', 'pending'])
    // The step is still 4 (the Initialize step holds the error + Retry).
    expect(document.querySelector('[data-onboarding-create]')?.getAttribute('data-create-step')).toBe('4')
    // Retry recovers: a succeeding re-fire lands on Step 5.
    faces.createLocalResearchProject.mockResolvedValueOnce(CREATE_OK_RESULT)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    })
    expect(faces.createLocalResearchProject).toHaveBeenCalledTimes(2)
    expect(document.querySelector('[data-onboarding-create]')?.getAttribute('data-create-step')).toBe('5')
  })

  it('rejection without a prefix: the raw message shows verbatim (no decode available)', async () => {
    const faces = renderOnboarding([UNREGISTERED_RESULT], {
      sessionId: 'sess-create-rej-raw',
      createImpl: async () => {
        throw new Error('boom: raw transport failure')
      },
    })
    await awaitCard()
    await openCreateStep2('无头')
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    expect(screen.getByText('Step 3: Confirm')).toBeTruthy()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    })
    expect(faces.createLocalResearchProject).toHaveBeenCalledTimes(1)
    // No [research-control] prefix in the message → the raw text shows as-is.
    expect(document.querySelector('[data-create-error]')?.textContent).toBe('boom: raw transport failure')
  })

  it('step-2 gate: 下一步 disabled until the title is non-blank (1–200 chars, raw length bound)', async () => {
    renderOnboarding([UNREGISTERED_RESULT], {
      sessionId: 'sess-create-gate',
      createImpl: async () => CREATE_OK_RESULT,
    })
    await awaitCard()
    fireEvent.click(screen.getByRole('button', { name: '新建研究项目' }))
    await screen.findByRole('dialog', { name: '新建研究项目' })
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))

    const next = () => screen.getByRole('button', { name: '下一步' }) as HTMLButtonElement
    expect(next().disabled).toBe(true) // empty
    fireEvent.change(screen.getByLabelText('项目标题（必填，1–200 字）'), { target: { value: '   ' } })
    expect(next().disabled).toBe(true) // whitespace-only
    fireEvent.change(screen.getByLabelText('项目标题（必填，1–200 字）'), { target: { value: 'x'.repeat(200) } })
    expect(next().disabled).toBe(false) // exactly 200
    fireEvent.change(screen.getByLabelText('项目标题（必填，1–200 字）'), { target: { value: 'x'.repeat(201) } })
    expect(next().disabled).toBe(true) // over 200
  })

  it('NO_CWD: the UI-2 buttons are offered but disabled — clicking fires nothing', async () => {
    const faces = renderOnboarding([NO_CWD_RESULT], {
      sessionId: 'sess-no-cwd-ui2',
      createImpl: async () => CREATE_OK_RESULT,
      inspectImpl: async () => INSPECT_RC_RESULT,
    })
    await awaitCard()

    const createBtn = screen.getByRole('button', { name: '新建研究项目' }) as HTMLButtonElement
    const bindBtn = screen.getByRole('button', { name: '绑定已有目录' }) as HTMLButtonElement
    expect(createBtn.disabled).toBe(true)
    expect(bindBtn.disabled).toBe(true)
    fireEvent.click(createBtn)
    fireEvent.click(bindBtn)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(faces.createLocalResearchProject).not.toHaveBeenCalled()
    expect(faces.inspectProjectDirectory).not.toHaveBeenCalled()
  })
})

describe('OnboardingCard — V2-UI-0.4 UI-2 Bind journey (frozen B spec 4 states)', () => {
  /** Open the Bind dialog and run the inspect (resolving `inspect`). */
  async function inspectToDetected(faces: Faces, inspect: unknown): Promise<void> {
    fireEvent.click(screen.getByRole('button', { name: '绑定已有目录' }))
    const dialog = await screen.findByRole('dialog', { name: '绑定已有目录' })
    expect(dialog.getAttribute('data-bind-phase')).toBe('select')
    expect(screen.getByText(/选择目录：当前会话工作区/)).toBeTruthy()
    faces.inspectProjectDirectory.mockResolvedValueOnce(inspect)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '检查目录' }))
    })
    expect(screen.getByRole('dialog', { name: '绑定已有目录' }).getAttribute('data-bind-phase')).toBe('detected')
  }

  it('state 1 (RC_PROJECT): message verbatim → [Bind] → confirm (tree-title prefill) → scaffold:false → MANAGED console', async () => {
    await mountStub(makeStubRpc())
    const faces = renderOnboarding([UNREGISTERED_RESULT, MANAGED_RESULT_AT_UNREGISTERED], {
      sessionId: 'sess-bind-rc',
      inspectImpl: async () => INSPECT_RC_RESULT,
    })
    await awaitCard()
    await inspectToDetected(faces, INSPECT_RC_RESULT)

    // The detected state: the FROZEN message verbatim, no detail, [Bind].
    const stateP = document.querySelector('[data-bind-state]')
    expect(stateP?.getAttribute('data-bind-state')).toBe('RC_PROJECT')
    expect(stateP?.textContent).toBe('Existing Research Control project detected.')
    expect(document.querySelector('[data-bind-detail]')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Bind' }))
    const dialog = screen.getByRole('dialog', { name: '绑定已有目录' })
    expect(dialog.getAttribute('data-bind-phase')).toBe('confirm')
    expect(document.querySelector('[data-bind-confirm-copy]')?.textContent).toBe('将把该目录登记为研究项目（不改动已有研究目录）。')
    // The tree's own title PREFILLS the display name (overrides folder).
    const nameInput = screen.getByLabelText('项目显示名') as HTMLInputElement
    expect(nameInput.value).toBe('树标题')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Bind' }))
    })
    expect(faces.bindProject).toHaveBeenCalledTimes(1)
    expect(faces.bindProject).toHaveBeenCalledWith({
      wsPath: UNREGISTERED_PATH,
      displayName: '树标题',
      scaffold: false,
    })
    expect(screen.queryByRole('dialog', { name: '绑定已有目录' })).toBeNull()
    expect(faces.load).toHaveBeenCalledTimes(2)
    // The role flips to MANAGED — the project console renders.
    expect(await screen.findByText(/PRJ-1 · Project One/)).toBeTruthy()
    expect(document.querySelector('[data-role="MANAGED"]')).toBeTruthy()
  })

  it('state 2 (GIT_ONLY): message + detail verbatim → [Initialize and Bind] → scaffold:true (folder-name prefill)', async () => {
    const faces = renderOnboarding([UNREGISTERED_RESULT], {
      sessionId: 'sess-bind-git',
      inspectImpl: async () => INSPECT_GIT_RESULT,
    })
    await awaitCard()
    await inspectToDetected(faces, INSPECT_GIT_RESULT)

    const stateP = document.querySelector('[data-bind-state]')
    expect(stateP?.getAttribute('data-bind-state')).toBe('GIT_ONLY')
    expect(stateP?.textContent).toBe('Git repository detected.')
    expect(document.querySelector('[data-bind-detail]')?.textContent).toBe('Research Control is not initialized.')

    fireEvent.click(screen.getByRole('button', { name: 'Initialize and Bind' }))
    expect(screen.getByRole('dialog', { name: '绑定已有目录' }).getAttribute('data-bind-phase')).toBe('confirm')
    expect(document.querySelector('[data-bind-confirm-copy]')?.textContent).toBe(
      '将在该目录初始化研究管理结构，然后登记为研究项目（保留已有 Git 仓库）。',
    )
    // No tree title in this state — the folder name default stands.
    expect((screen.getByLabelText('项目显示名') as HTMLInputElement).value).toBe('unregistered')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Initialize and Bind' }))
    })
    expect(faces.bindProject).toHaveBeenCalledTimes(1)
    expect(faces.bindProject).toHaveBeenCalledWith({
      wsPath: UNREGISTERED_PATH,
      displayName: 'unregistered',
      scaffold: true,
    })
    expect(screen.queryByRole('dialog', { name: '绑定已有目录' })).toBeNull()
    expect(faces.load).toHaveBeenCalledTimes(2) // initial + the post-mutation re-fetch
  })

  it('state 3 (PLAIN_DIR): message + detail verbatim → [Initialize Git + Research Control] → scaffold:true', async () => {
    const faces = renderOnboarding([UNREGISTERED_RESULT], {
      sessionId: 'sess-bind-plain',
      inspectImpl: async () => INSPECT_PLAIN_RESULT,
    })
    await awaitCard()
    await inspectToDetected(faces, INSPECT_PLAIN_RESULT)

    const stateP = document.querySelector('[data-bind-state]')
    expect(stateP?.getAttribute('data-bind-state')).toBe('PLAIN_DIR')
    expect(stateP?.textContent).toBe('Directory detected.')
    expect(document.querySelector('[data-bind-detail]')?.textContent).toBe('Git is not initialized.')

    fireEvent.click(screen.getByRole('button', { name: 'Initialize Git + Research Control' }))
    expect(screen.getByRole('dialog', { name: '绑定已有目录' }).getAttribute('data-bind-phase')).toBe('confirm')
    expect(document.querySelector('[data-bind-confirm-copy]')?.textContent).toBe('将初始化 Git 仓库与研究管理结构，然后登记为研究项目。')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Initialize Git + Research Control' }))
    })
    expect(faces.bindProject).toHaveBeenCalledWith({
      wsPath: UNREGISTERED_PATH,
      displayName: 'unregistered',
      scaffold: true,
    })
    expect(screen.queryByRole('dialog', { name: '绑定已有目录' })).toBeNull()
  })

  it('state 4 (INCOMPATIBLE): reason + detail shown, NO action offered, no auto-repair note', async () => {
    const faces = renderOnboarding([UNREGISTERED_RESULT], {
      sessionId: 'sess-bind-incompat',
      inspectImpl: async () => INSPECT_INCOMPATIBLE_RESULT,
    })
    await awaitCard()
    await inspectToDetected(faces, INSPECT_INCOMPATIBLE_RESULT)

    const stateP = document.querySelector('[data-bind-state]')
    expect(stateP?.getAttribute('data-bind-state')).toBe('INCOMPATIBLE')
    expect(stateP?.textContent).toBe('Incompatible directory detected.')
    expect(document.querySelector('[data-bind-detail]')?.textContent).toBe(
      'the selected path is not an existing directory: /workspace/ghost',
    )
    // No action button — the flow EXPLAINS and stops (no auto-repair).
    expect(document.querySelector('[data-bind-action]')).toBeNull()
    expect(document.querySelector('[data-bind-incompatible-note]')?.textContent).toBe(
      '该目录与本研究平面不兼容。请人工检查后重试（本流程不做自动修复）。',
    )
    // 取消 closes the dialog; nothing was fired beyond the inspect.
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('dialog', { name: '绑定已有目录' })).toBeNull()
    expect(faces.bindProject).not.toHaveBeenCalled()
  })

  it('failed inspect: stays on the select phase with the NOTE-4 carrier detail shown THERE (D6-4 fix)', async () => {
    const faces = renderOnboarding([UNREGISTERED_RESULT], {
      sessionId: 'sess-bind-inspect-fail',
      inspectImpl: async () => {
        throw new Error('[research-control] LP_INPUT: inspectProjectDirectory: wsPath must be an absolute path')
      },
    })
    await awaitCard()
    fireEvent.click(screen.getByRole('button', { name: '绑定已有目录' }))
    const dialog = await screen.findByRole('dialog', { name: '绑定已有目录' })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '检查目录' }))
    })
    expect(faces.inspectProjectDirectory).toHaveBeenCalledTimes(1)

    // The phase STAYS 'select' — the error renders on the select phase
    // itself (decoded carrier detail, no prefix spliced into the copy).
    expect(dialog.getAttribute('data-bind-phase')).toBe('select')
    expect(document.querySelector('[data-bind-inspect-error]')?.textContent).toBe(
      'inspectProjectDirectory: wsPath must be an absolute path',
    )
    expect(screen.getByText('检查目录')).toBeTruthy() // still actionable

    // Retrying from the same phase recovers into the detected state.
    faces.inspectProjectDirectory.mockResolvedValueOnce(INSPECT_RC_RESULT)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '检查目录' }))
    })
    expect(faces.inspectProjectDirectory).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('dialog', { name: '绑定已有目录' }).getAttribute('data-bind-phase')).toBe('detected')
    expect(document.querySelector('[data-bind-inspect-error]')).toBeNull()
  })

  it('failed bind: the NOTE-4 carrier detail shows on the confirm phase, no re-fetch, dialog stays', async () => {
    const faces = renderOnboarding([UNREGISTERED_RESULT], {
      sessionId: 'sess-bind-fail',
      inspectImpl: async () => INSPECT_GIT_RESULT,
      bindImpl: async () => {
        throw new Error('[research-control] PLANE_HUB_WORKSPACE: the workspace is already the research hub')
      },
    })
    await awaitCard()
    await inspectToDetected(faces, INSPECT_GIT_RESULT)
    fireEvent.click(screen.getByRole('button', { name: 'Initialize and Bind' }))
    const dialog = screen.getByRole('dialog', { name: '绑定已有目录' })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Initialize and Bind' }))
    })
    expect(faces.bindProject).toHaveBeenCalledTimes(1)
    // The error line decodes the carrier; the phase STAYS confirm (the
    // user can retry or go back); no plane-state re-fetch after a failure.
    expect(document.querySelector('[data-bind-error]')?.textContent).toBe('the workspace is already the research hub')
    expect(dialog.getAttribute('data-bind-phase')).toBe('confirm')
    expect(faces.load).toHaveBeenCalledTimes(1)
  })
})

describe('extractResearchErrorCarrier — the NOTE-4 machine matcher (client/util)', () => {
  it('decodes the [research-control] <CODE> prefix with its detail', () => {
    expect(extractResearchErrorCarrier('[research-control] HIER_INPUT: updateTopic: bad title')).toEqual({
      code: 'HIER_INPUT',
      detail: 'updateTopic: bad title',
    })
  })

  it('finds the prefix MID-string (the ui.ts fold format embeds it after the code)', () => {
    expect(
      extractResearchErrorCarrier('research shell: createLocalResearchProject failed — internal: [research-control] LP_GIT_INIT: git init failed'),
    ).toEqual({ code: 'LP_GIT_INIT', detail: 'git init failed' })
  })

  it('returns null for unprefixed / malformed / empty messages', () => {
    expect(extractResearchErrorCarrier('no prefix here')).toBeNull()
    expect(extractResearchErrorCarrier('[research-control] lowercase: x')).toBeNull()
    expect(extractResearchErrorCarrier('')).toBeNull()
  })
})
