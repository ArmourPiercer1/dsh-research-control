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
 * Gate coverage (plan §P4 T4.1: 5 角色 × 加载中/失败重试):
 *  - HUB           → 中枢控制台 frame: nav + the 4 first-level entries
 *                    总览/重要事件/调查员/设置 (design §6 fixed naming) +
 *                    the placeholder page body (P5 fills it);
 *  - MANAGED       → the V1 cockpit stays wired as the project view (the
 *                    real cockpit + real store over the stub facade — the
 *                    plugin's own mount seam, a plain fake ctx, NOT cordis);
 *  - STANDALONE    → same cockpit branch (data-role distinguishes);
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
import type { GetResearchPlaneStateResult } from '../../src/shared/rpc-contracts.js'
import { makeStubRpc, type StubRpc } from '../stores/stub-rpc.js'
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
  render(
    <StrictMode>
      <ResearchShell sessionId={sessionId} loadPlaneState={loadPlaneState} />
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
    // The page body renders as a placeholder (P5 — T5.1…T5.4 — fills it).
    expect(document.querySelector('[data-page="overview"]')).toBeTruthy()
    expect(screen.getByText('总览 页建设中')).toBeTruthy()
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('HUB: the nav switches the active entry and the placeholder body follows', async () => {
    renderShell(vi.fn().mockResolvedValue(HUB_RESULT), 'sess-hub')
    await screen.findByRole('button', { name: '总览' })

    fireEvent.click(screen.getByRole('button', { name: '重要事件' }))
    expect(document.querySelector('[data-page="attention"]')).toBeTruthy()
    expect(screen.getByText('重要事件 页建设中')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '设置' }))
    expect(document.querySelector('[data-page="settings"]')).toBeTruthy()
    expect(screen.getByText('设置 页建设中')).toBeTruthy()
  })

  it('MANAGED: keeps the V1 cockpit wired as the project view', async () => {
    await mountStub(makeStubRpc())
    renderShell(vi.fn().mockResolvedValue(MANAGED_RESULT), 'sess-managed')

    // The cockpit's home face (研究总览 heading — always rendered by the
    // HomeDashboardView header) proves the REAL cockpit is the branch body.
    expect(await screen.findByText('研究总览')).toBeTruthy()
    expect(document.querySelector('[data-role="MANAGED"]')).toBeTruthy()
  })

  it('STANDALONE: keeps the V1 cockpit wired as the project view', async () => {
    await mountStub(makeStubRpc())
    renderShell(vi.fn().mockResolvedValue(STANDALONE_RESULT), 'sess-standalone')

    expect(await screen.findByText('研究总览')).toBeTruthy()
    expect(document.querySelector('[data-role="STANDALONE"]')).toBeTruthy()
  })

  it('UNREGISTERED: renders the 引导卡 skeleton with the two §5 placeholder buttons', async () => {
    renderShell(vi.fn().mockResolvedValue(UNREGISTERED_RESULT), 'sess-unregistered')

    expect(await screen.findByRole('region', { name: '研究管理系统引导' })).toBeTruthy()
    expect(document.querySelector('[data-onboarding-variant="unregistered"]')).toBeTruthy()
    expect(screen.getByText('接入研究管理系统')).toBeTruthy()
    // The §5-named buttons render as placeholders (T4.2 fills the two-state
    // logic); this task renders them enabled-but-inert.
    expect((screen.getByRole('button', { name: SET_HUB_BUTTON }) as HTMLButtonElement).disabled).toBe(false)
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
})
