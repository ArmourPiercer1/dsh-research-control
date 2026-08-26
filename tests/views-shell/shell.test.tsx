// @vitest-environment jsdom
/**
 * V2-T4.1 — Research shell component tests (角色分流 + 标签壳).
 *
 * Plain stub props — no real cordis in the component spec (the views-* test
 * pattern). The injected fetch face (`loadPlaneState`) is a vi.fn stub per
 * case; the wire fixtures are re-parsed through the strict
 * `GetResearchPlaneStateResultSchema` in ./fixtures.ts, so a fixture that
 * drifts from the wire contract fails the suite.
 *
 * Gate coverage (plan §P4 T4.1: 5 角色 × 加载中/失败重试; V2-T5.1 adds the
 * 总览 page assertions):
 *  - HUB           → 中枢控制台 frame: nav + the 4 first-level entries
 *                    总览/重要事件/调查员/设置 (design §6 fixed naming) +
 *                    总览 = 聚合条 + 项目卡墙 (the `loadHubOverview` stub
 *                    resolves the single-project wire fixture; the
 *                    whole-card click drills into the project view, back =
 *                    返回总览 to the wall);
 *  - MANAGED       → 同构收窄控制台: the SAME 4-entry frame, 总览 = the
 *                    project console as ROOT (the real store over the stub
 *                    facade — the plugin's own mount seam, a plain fake
 *                    ctx, NOT cordis; no aggregate strip, no back);
 *  - STANDALONE    → same narrowed console branch (data-role distinguishes);
 *  - UNREGISTERED  → 引导卡 skeleton: visually distinct card, the two §5
 *                    button names render as placeholders;
 *  - NO_CWD        → 引导卡 收窄文案「本会话未关联工作区」, buttons disabled;
 *  - session null  → routed to the NO_CWD narrowing (documented edge — the
 *                    fetch was made without a resolvable caller);
 *  - loading       → the loading face while the fetch is in flight;
 *  - failure       → the failure face + 重试; clicking 重试 re-invokes the
 *                    fetch stub (and the resolved result renders).
 *
 * StrictMode note: the shell's in-flight dedupe reuses the first fetch
 * across StrictMode's double effect — exactly one fetch per user-visible
 * load (the home container pins the same invariant via store dedupe).
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
import type { AnalysisRecordDto, InvestigatorTransientDto } from '../../src/shared/analysis-command.js'
import type {
  AckMissingReminderArgs,
  AckMissingReminderResult,
  GetPortfolioInterventionsResult,
  GetResearchPlaneStateResult,
  HubOverviewResult,
  UpdateInterventionStateResult,
} from '../../src/shared/rpc-contracts.js'
import { makeStubRpc, type StubRpc } from '../stores/stub-rpc.js'
import { HUB_OVERVIEW_RESULT } from '../views-overview/fixtures.js'
import {
  HUB_RESULT,
  MANAGED_RESULT,
  NO_CWD_RESULT,
  NO_SESSION_RESULT,
  STANDALONE_RESULT,
  UNREGISTERED_RESULT,
} from './fixtures.js'

/** The two §5 onboarding button names (design §5 引导卡状态表). */
const SET_HUB_BUTTON = '将此工作区设为研究管理中枢'
const BIND_BUTTON = '将此工作区接入研究管理系统'

function renderShell(loadPlaneState: ResearchShellProps['loadPlaneState'], sessionId?: string): void {
  // T4.2: the shell requires the two onboarding mutation faces. The
  // branch-routing cases here never trigger them (NO_CWD disables the
  // buttons; the onboarding flows are covered in onboarding.test.tsx), so
  // inert resolvers keep this file focused on the routing.
  const setHub = vi.fn(async () => ({ hubPath: '/workspace/unregistered', registryPath: '/workspace/unregistered/.research-control/registry.yaml' }))
  const bindProject = vi.fn(async () => ({ projectId: 'PRJ-9', registryPath: null, dbMigrated: false }))
  // T4.3: the shell requires the three MISSING-modal mutation faces. The
  // routing fixtures here carry NO missing entries (`missing: []`), so the
  // modal never pops and the inert resolvers stay inert.
  const rescan = vi.fn(async () => ({ hub: null, dirNames: { treeDir: '.research', hubDir: '.research-control' }, projects: [], missing: [], registry: [] }))
  const unbindProject = vi.fn(async () => ({ projectId: 'PRJ-9', archivedDir: '/workspace/.research-control/archived/PRJ-9' }))
  const restoreProject = vi.fn(async () => ({ wsPath: '/workspace/PRJ-9' }))
  const ackMissingReminder = vi.fn(async (_args: AckMissingReminderArgs): Promise<AckMissingReminderResult> => ({ acknowledged: true }))
  // T5.1: the shell requires the HUB 总览 fetch face. The HUB branch calls
  // it (the stub resolves the single-project wire fixture — the 聚合条 +
  // 卡墙 assertions below read it); the other roles never call it.
  const loadHubOverview = vi.fn(async (): Promise<HubOverviewResult> => HUB_OVERVIEW_RESULT)
  // T5.2: the shell requires the 重要事件 stream faces. The routing fixtures
  // here only render the 重要事件 frame (the stream's own behavior is
  // covered in tests/views-intervention-stream/), so an EMPTY portfolio
  // keeps these cases focused on the frame wiring (the empty-state face
  // shows).
  const loadPortfolioInterventions = vi.fn(async (): Promise<GetPortfolioInterventionsResult> => ({ items: [] }))
  const updateInterventionState = vi.fn(async (): Promise<UpdateInterventionStateResult> => ({
    interventionId: 'IV-1',
    statusFrom: 'OPEN',
    statusTo: 'PENDING',
    closedAt: null,
    resolutionNote: null,
  }))
  const onInvestigate = vi.fn(async (): Promise<string> => '调查已启动')
  // T5.3: the 调查员 page faces (the repositioned V1 analysis channel).
  // The routing fixtures never navigate to the 调查员 page, so inert
  // resolvers keep this file focused on the frame routing.
  const readInvestigatorTransient = vi.fn(
    async (sid: string): Promise<InvestigatorTransientDto> => ({
      sessionId: sid,
      session: null,
      pointer: null,
      run: null,
    }),
  )
  const loadAnalysisRecords = vi.fn(async (): Promise<readonly AnalysisRecordDto[]> => [])
  const saveAnalysisRecord = vi.fn(
    async (): Promise<AnalysisRecordDto> => ({
      id: 'AN-1',
      sourceRef: { kind: 'INTERVENTION', id: 'IV-1' },
      investigatorRunId: null,
      dshSessionId: null,
      content: 'stub 结论',
      createdAt: 1_700_000_000_000,
    }),
  )
  render(
    <StrictMode>
      <ResearchShell
        sessionId={sessionId}
        loadPlaneState={loadPlaneState}
        loadHubOverview={loadHubOverview}
        loadPortfolioInterventions={loadPortfolioInterventions}
        updateInterventionState={updateInterventionState}
        onInvestigate={onInvestigate}
        readInvestigatorTransient={readInvestigatorTransient}
        loadAnalysisRecords={loadAnalysisRecords}
        saveAnalysisRecord={saveAnalysisRecord}
        setHub={setHub}
        bindProject={bindProject}
        rescan={rescan}
        unbindProject={unbindProject}
        restoreProject={restoreProject}
        ackMissingReminder={ackMissingReminder}
      />
    </StrictMode>,
  )
}

/**
 * Mount the plugin's facade over the stub namespace (the cockpit branch
 * creates its own store; the mount seam is the only production injection
 * point — the same pattern tests/views-drilldown/cockpit.test.tsx uses; a
 * plain fake ctx, no cordis).
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

describe('ResearchShell — 加载中', () => {
  it('renders the loading state while the fetch is in flight', async () => {
    const load = vi.fn(() => new Promise<never>(() => {}))
    renderShell(load, 'sess-x')

    expect(await screen.findByRole('status')).toBeTruthy()
    expect(screen.getByText('正在加载研究平面…')).toBeTruthy()
    expect(document.querySelector('[data-shell-phase="loading"]')).toBeTruthy()
    // Exactly one fetch per load (the StrictMode double effect reuses the
    // in-flight promise).
    expect(load).toHaveBeenCalledTimes(1)
  })
})

describe('ResearchShell — 加载失败 / 重试', () => {
  it('renders the failure face with 重试; clicking 重试 re-invokes the fetch', async () => {
    // The second fetch is DEFERRED: the test asserts the loading face while
    // the retry fetch is in flight, then resolves it to the HUB result.
    let resolveSecond: (r: GetResearchPlaneStateResult) => void = () => undefined
    const second = new Promise<GetResearchPlaneStateResult>((r) => {
      resolveSecond = r
    })
    const load = vi
      .fn<ResearchShellProps['loadPlaneState']>()
      .mockRejectedValueOnce(new Error('gateway down'))
      .mockReturnValueOnce(second)
    renderShell(load, 'sess-hub')

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText('研究平面状态加载失败')).toBeTruthy()
    expect(document.querySelector('[data-shell-phase="failed"]')).toBeTruthy()
    expect(load).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: '重试' }))

    // The retry re-invokes the fetch stub and the loading face responds
    // while the re-fetch is in flight.
    expect(load).toHaveBeenCalledTimes(2)
    expect(screen.getByText('正在加载研究平面…')).toBeTruthy()

    await act(async () => {
      resolveSecond(HUB_RESULT)
    })
    // The resolved HUB result renders the 中枢控制台 frame.
    expect(screen.getByRole('button', { name: '总览' })).toBeTruthy()
    expect(document.querySelector('[data-role="HUB"]')).toBeTruthy()
  })
})

describe('ResearchShell — 5 角色分支', () => {
  it('HUB: renders the 中枢控制台 frame with the 4 first-level entries (design §6)', async () => {
    const load = vi.fn().mockResolvedValue(HUB_RESULT)
    renderShell(load, 'sess-hub')

    expect(await screen.findByRole('button', { name: '总览' })).toBeTruthy()
    expect(document.querySelector('[data-role="HUB"]')).toBeTruthy()
    expect(document.querySelector('nav[aria-label="研究控制台一级入口"]')).toBeTruthy()
    // The 4 first-level entries, fixed naming (总览 — NOT 「首页」).
    for (const label of ['总览', '重要事件', '调查员', '设置']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy()
    }
    expect(document.querySelector('[data-page="overview"]')).toBeTruthy()
    // V2-T5.1: the 总览 body is the 聚合条 + 项目卡墙 (the loadHubOverview
    // stub resolves the single-project wire fixture).
    expect(await screen.findByText('1 个项目 · 未决干预 0 · 收件箱 0')).toBeTruthy()
    expect(document.querySelector('[data-hub-overview][data-phase="ready"]')).toBeTruthy()
    // The 需关注 row is ABSENT (the fixture's attention list is empty —
    // 无则整行不渲染，不占位).
    expect(document.querySelector('[data-hub-overview-attention]')).toBeNull()
    // The card wall carries the fixture's single card.
    expect(document.querySelector('[data-project-id="PRJ-1"]')).toBeTruthy()
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('HUB: whole-card click drills into the project view; 返回总览 back to the wall', async () => {
    await mountStub(makeStubRpc())
    renderShell(vi.fn().mockResolvedValue(HUB_RESULT), 'sess-hub')

    const card = await screen.findByRole('button', { name: /查看项目 PRJ-1/ })
    fireEvent.click(card)

    // The 总览 content switches to the project view (the project page as
    // the console root) — the aggregate strip is gone, the back
    // affordance is in.
    expect(await screen.findByText(/PRJ-1 · Project One/)).toBeTruthy()
    expect(document.querySelector('[data-project-console-page="project"]')).toBeTruthy()
    expect(document.querySelector('[data-hub-overview]')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '← 返回总览' }))

    // The wall re-renders (the overview re-fetches; the stub resolves
    // again).
    expect(await screen.findByText('1 个项目 · 未决干预 0 · 收件箱 0')).toBeTruthy()
  })

  it('HUB: the nav switches the active entry — 重要事件 = the real stream, 设置 = 四段式管理面', async () => {
    renderShell(vi.fn().mockResolvedValue(HUB_RESULT), 'sess-hub')
    await screen.findByRole('button', { name: '总览' })

    // T5.2: 重要事件 is the live pure-intervention stream (the stub resolves
    // an EMPTY portfolio → the stream's empty-state face; the page's own
    // behavior is pinned in tests/views-intervention-stream/).
    fireEvent.click(screen.getByRole('button', { name: '重要事件' }))
    expect(document.querySelector('[data-page="attention"]')).toBeTruthy()
    expect(await screen.findByText('当前没有需要处理的事件')).toBeTruthy()

    // T5.4: 设置 is the 四段式管理面 (design §7.4). The HUB role sees ALL
    // four sections (①②③④ — the 登记册 included).
    fireEvent.click(screen.getByRole('button', { name: '设置' }))
    expect(document.querySelector('[data-page="settings"]')).toBeTruthy()
    expect(document.querySelector('[data-settings-page]')).toBeTruthy()
    // ① 当前状态: the HUB role label.
    expect(await screen.findByText('① 当前状态')).toBeTruthy()
    // ② 操作: 重扫并连接 (no 接入 — the hub already has projects).
    expect(screen.getByText('② 操作')).toBeTruthy()
    expect(screen.getByRole('button', { name: '重扫并连接' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '解除绑定' })).toBeNull()
    // ③ 项目登记册 (HUB only): the PRJ-1 book row, 正常.
    expect(screen.getByText('③ 项目登记册')).toBeTruthy()
    expect(document.querySelector('[data-book-row][data-book-id="PRJ-1"][data-book-status="normal"]')).toBeTruthy()
    // ④ 数据位置 (the read-only location rows).
    expect(screen.getByText('④ 数据位置')).toBeTruthy()
    expect(document.querySelectorAll('[data-location-row]').length).toBeGreaterThan(0)
  })

  it('MANAGED: 同构收窄控制台 — 总览 = the project console as ROOT (no aggregate strip, no back)', async () => {
    await mountStub(makeStubRpc())
    renderShell(vi.fn().mockResolvedValue(MANAGED_RESULT), 'sess-managed')

    // The 4-entry frame (design §6 — the SAME entries as the HUB).
    expect(await screen.findByRole('button', { name: '总览' })).toBeTruthy()
    for (const label of ['总览', '重要事件', '调查员', '设置']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy()
    }
    expect(document.querySelector('[data-role="MANAGED"]')).toBeTruthy()
    // The 总览 body is the project page AS ROOT (the real store over the
    // stub facade — PRJ-1 = the stub's single project).
    expect(await screen.findByText(/PRJ-1 · Project One/)).toBeTruthy()
    // NO aggregate strip (the 聚合条 is HUB-only) and NO back affordance
    // (root mode — the project page IS the 总览 root).
    expect(document.querySelector('[data-hub-overview]')).toBeNull()
    expect(screen.queryByRole('button', { name: '← 返回总览' })).toBeNull()
  })

  it('STANDALONE: 同构收窄控制台 — 总览 = the project console as ROOT (data-role distinguishes)', async () => {
    await mountStub(makeStubRpc())
    renderShell(vi.fn().mockResolvedValue(STANDALONE_RESULT), 'sess-standalone')

    expect(await screen.findByText(/PRJ-1 · Project One/)).toBeTruthy()
    expect(document.querySelector('[data-role="STANDALONE"]')).toBeTruthy()
    expect(document.querySelector('[data-hub-overview]')).toBeNull()
    expect(screen.queryByRole('button', { name: '← 返回总览' })).toBeNull()
  })

  it('UNREGISTERED: renders the 引导卡 with the §5 状态表 button states (T4.2)', async () => {
    renderShell(vi.fn().mockResolvedValue(UNREGISTERED_RESULT), 'sess-unregistered')

    expect(await screen.findByRole('region', { name: '研究管理系统引导' })).toBeTruthy()
    expect(document.querySelector('[data-onboarding-variant="unregistered"]')).toBeTruthy()
    expect(screen.getByText('接入研究管理系统')).toBeTruthy()
    // T4.2 (design §5 状态表 — the fixture plane carries a hub, the 「有中枢」
    // row): 「设为中枢」 is DISABLED with the reason copy 已存在中枢;
    // 「接入」 stays enabled (the normal registration flow).
    expect((screen.getByRole('button', { name: SET_HUB_BUTTON }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('已存在中枢')).toBeTruthy()
    expect((screen.getByRole('button', { name: BIND_BUTTON }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('NO_CWD: renders the 引导卡 收窄文案「本会话未关联工作区」with buttons disabled', async () => {
    renderShell(vi.fn().mockResolvedValue(NO_CWD_RESULT), 'sess-no-cwd')

    expect(await screen.findByRole('region', { name: '研究管理系统引导' })).toBeTruthy()
    expect(document.querySelector('[data-onboarding-variant="no-cwd"]')).toBeTruthy()
    expect(screen.getByText('本会话未关联工作区')).toBeTruthy()
    expect((screen.getByRole('button', { name: SET_HUB_BUTTON }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: BIND_BUTTON }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('session null (no resolvable caller): routes to the NO_CWD narrowing', async () => {
    renderShell(vi.fn().mockResolvedValue(NO_SESSION_RESULT))

    expect(await screen.findByRole('region', { name: '研究管理系统引导' })).toBeTruthy()
    expect(screen.getByText('本会话未关联工作区')).toBeTruthy()
    expect((screen.getByRole('button', { name: SET_HUB_BUTTON }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('T5.4: UNREGISTERED / NO_CWD sessions never reach the console frame — the 设置 entry is absent (the 引导卡 is their face)', async () => {
    // design §5: the 引导卡 branches render NO ConsoleFrame at all — the
    // 4-entry nav (incl. 设置) exists only for HUB / MANAGED / STANDALONE.
    renderShell(vi.fn().mockResolvedValue(UNREGISTERED_RESULT), 'sess-unregistered')
    expect(await screen.findByRole('region', { name: '研究管理系统引导' })).toBeTruthy()
    expect(document.querySelector('[data-role]')).toBeNull()
    expect(screen.queryByRole('button', { name: '设置' })).toBeNull()
    expect(document.querySelector('[data-settings-page]')).toBeNull()
    cleanup()

    renderShell(vi.fn().mockResolvedValue(NO_CWD_RESULT), 'sess-no-cwd')
    expect(await screen.findByRole('region', { name: '研究管理系统引导' })).toBeTruthy()
    expect(document.querySelector('[data-role]')).toBeNull()
    expect(screen.queryByRole('button', { name: '设置' })).toBeNull()
    expect(document.querySelector('[data-settings-page]')).toBeNull()
  })
})
