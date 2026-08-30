// @vitest-environment jsdom
/**
 * WP-4.6 — Research Cockpit container tests (the registered tab root).
 *
 * Runs the REAL `createResearchStore` (the stub facade injected through
 * the store's `rpc` seam) around the REAL cockpit component tree:
 *
 *  - home renders the §27.1 dashboard + the Intervention queue board;
 *  - the Gate P4 chain (TC-E2E-013): intervention WS chip (1) → claim
 *    card (2) → session link (3) = EXACTLY THREE interactions from the
 *    dashboard to the DSH session pointer;
 *  - the drill-down display layer (rebuilt from queryHistory) shows the
 *    claim/artifact cards, the linked run with its pointer kind, and the
 *    session link's `data-session-id`;
 *  - the placeholder session-open channel records the pointer visibly
 *    (the banner) — no host session UI is touched (INV-PERM-5);
 *  - the workstream page composes the three-zone view + PF panel +
 *    graph + drill-down + git panel; the PF panel shows OPEN/STALE with
 *    the `staleReason`;
 *  - back navigation returns home.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

// BEFORE any cockpit import (the ws page mounts the WP-4.5 graph — the
// real React Flow runtime needs browser layout surfaces jsdom lacks; the
// mock renders the node/edge layer for real, WP-4.5 test-layer pattern).
import '../graph/xyflow-mock.js'

import { ResearchCockpit } from '../../src/client/views/drilldown'
// WP-7.4 — the shared one-click success text (the launched-session marker
// the cockpit parses to bind the investigator panel).
import { INVESTIGATION_SUCCESS_TEXT } from '../../src/shared/investigation-command.js'
import {
  mountResearchRemotes,
  unmountResearchRemotes,
  type RemoteContext,
} from '../../src/client/dsh-adapter/remote/mount.js'
import { makeStubRpc, type StubRpc } from '../stores/stub-rpc.js'
import {
  DRILLDOWN_DASHBOARD,
  DRILLDOWN_GIT_DRIFTED,
  DRILLDOWN_HISTORY,
  DRILLDOWN_TOPIC,
  DRILLDOWN_WORKSTREAM,
} from './fixtures'

afterEach(() => {
  cleanup()
  // Drop the facade binding (the cockpit's store resolves the facade at
  // CALL time — the next test re-mounts its own stub).
  unmountResearchRemotes()
})

/** Fresh stub pre-configured with the drill-down wire fixtures. */
function makeStub(): StubRpc {
  const stub = makeStubRpc()
  stub.set('getDashboard', { ok: true, value: DRILLDOWN_DASHBOARD })
  stub.set('getWorkstream', { ok: true, value: DRILLDOWN_WORKSTREAM })
  stub.set('queryHistory', { ok: true, value: DRILLDOWN_HISTORY })
  stub.set('getTopic', { ok: true, value: DRILLDOWN_TOPIC })
  stub.set('getGitHistory', { ok: true, value: DRILLDOWN_GIT_DRIFTED })
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

/** Click counter (the Gate P4 interaction budget is user-visible clicks). */
function clickCounter(): { readonly n: number; click: (el: Element) => void } {
  let n = 0
  return {
    get n(): number {
      return n
    },
    click: (el: Element) => {
      n += 1
      fireEvent.click(el)
    },
  }
}

/**
 * A linked-Run row SCOPED to the drill-down panel (UI-4 maintenance):
 * the Current Execution zone's Runs group now renders `data-run-id`
 * rows for the workstream snapshot's runs too, so a document-level
 * `[data-run-id=…]` query is no longer unique.
 */
function drilldownRunRow(runId: string): Element | null {
  return document.querySelector(
    `section[aria-label="Claim/Artifact drill-down"] [data-run-id="${runId}"]`,
  )
}

describe('ResearchCockpit — home page', () => {
  it('renders the dashboard + intervention queue on mount (one lazy fetch each)', async () => {
    const stub = makeStub()
    await mountStub(stub)
    renderCockpit()

    // The home dashboard heading (the HomeDashboardView §27.1 face).
    expect(await screen.findByText('研究总览')).toBeTruthy()
    // The intervention queue board (the WP-4.6 cockpit-owned section) and
    // its rows (the lazy slice lands a tick after the heading).
    await waitFor(() => {
      expect(document.querySelector('[aria-label="Intervention 队列（用户状态操作）"]')).toBeTruthy()
      expect(document.querySelector('[data-iv-id="IV-1"]')).toBeTruthy()
      expect(document.querySelector('[data-iv-id="IV-2"]')).toBeTruthy()
    })
    // The WS chip (the Gate P4 path's first stop).
    expect(document.querySelector('[data-iv-ws="WS-1"]')).toBeTruthy()

    await waitFor(() => {
      expect(stub.countOf('getDashboard')).toBeGreaterThanOrEqual(1)
    })
  })

  it('shows the AUTO_FLOODING origin label on the flooding intervention', async () => {
    const stub = makeStub()
    await mountStub(stub)
    renderCockpit()
    await screen.findByText('研究总览')
    // The origin copy renders as 「来源：自动洪泛检测」 (a compound text
    // node — match by substring; scoped to the cockpit-owned board, since
    // the §27.1 home section renders the same origin copy too).
    await waitFor(() => {
      const board = document.querySelector('[aria-label="Intervention 队列（用户状态操作）"]')
      expect(board?.textContent).toContain('自动洪泛检测')
    })
  })
})

describe('ResearchCockpit — Gate P4 chain (TC-E2E-013)', () => {
  /** Wait until the home page's IV-1 WS chip is clickable (slice landed). */
  async function waitChip(): Promise<Element> {
    await waitFor(() => {
      const chip = document.querySelector('[data-iv-ws="WS-1"]')
      expect(chip).toBeTruthy()
      return chip
    })
    return document.querySelector('[data-iv-ws="WS-1"]')!
  }

  it('reaches the DSH session in EXACTLY 3 interactions (chip → claim → session)', async () => {
    const stub = makeStub()
    await mountStub(stub)
    renderCockpit()
    await screen.findByText('研究总览')

    const clicks = clickCounter()

    // 1) the intervention's workstream chip → the workstream page.
    clicks.click(await waitChip())
    await waitFor(() => {
      expect(document.querySelector('[data-cockpit-page="ws"]')).toBeTruthy()
    })

    // 2) the claim card → the linked run panel (the run row + session
    //    link appear WITHOUT a further run-row click: the panel lists the
    //    linked runs directly).
    await screen.findByText('铁基超导的机制以电子关联主导')
    clicks.click(document.querySelector('[data-claim-id="C-1"]')!)
    await waitFor(() => {
      expect(drilldownRunRow('R-1')).toBeTruthy()
    })
    // The pointer kind is user-visible (the data path, §26).
    expect(drilldownRunRow('R-1')?.textContent).toContain('created_by_run 事件指针')

    // 3) the session link → the placeholder channel records the pointer.
    const sessionLink = document.querySelector('button[data-session-id="session-e2e-sess-1"]')
    expect(sessionLink).toBeTruthy()
    clicks.click(sessionLink!)

    const banner = await waitFor(() => {
      const el = document.querySelector('[role="status"][data-session-id]')
      expect(el).toBeTruthy()
      return el
    })
    expect(banner?.textContent).toContain('session-e2e-sess-1')
    expect(banner?.textContent).toContain('在宿主会话列表中打开')

    // The interaction budget: exactly three user-visible clicks.
    expect(clicks.n).toBe(3)
  })

  it('the artifact card links through BOTH pointer kinds (TC-E2E-012 chain)', async () => {
    const stub = makeStub()
    await mountStub(stub)
    renderCockpit()
    await screen.findByText('研究总览')

    fireEvent.click(await waitChip())
    await screen.findByText('高温超导综述初稿')
    fireEvent.click(document.querySelector('[data-artifact-id="A-1"]')!)

    const runRow = await waitFor(() => {
      const el = drilldownRunRow('R-1')
      expect(el).toBeTruthy()
      return el
    })
    expect(runRow).toBeTruthy()
    expect(drilldownRunRow('R-1')?.textContent).toContain('PRODUCED_BY 关系')
    expect(drilldownRunRow('R-1')?.textContent).toContain('created_by_run 事件指针')
    // The session link exists on the same row (no extra navigation).
    expect(document.querySelector('button[data-session-id="session-e2e-sess-1"]')).toBeTruthy()
  })

  it('clicking the selected claim card again deselects (toggle)', async () => {
    const stub = makeStub()
    await mountStub(stub)
    renderCockpit()
    await screen.findByText('研究总览')
    fireEvent.click(await waitChip())
    await screen.findByText('铁基超导的机制以电子关联主导')

    const card = document.querySelector('[data-claim-id="C-1"]')!
    fireEvent.click(card)
    expect(await waitFor(() => drilldownRunRow('R-1'))).toBeTruthy()
    fireEvent.click(card)
    await waitFor(() => {
      expect(drilldownRunRow('R-1')).toBeNull()
    })
  })
})

describe('ResearchCockpit — workstream page composition', () => {
  async function gotoWs(stub: StubRpc): Promise<void> {
    await mountStub(stub)
    renderCockpit()
    await screen.findByText('研究总览')
    await waitFor(() => {
      const chip = document.querySelector('[data-iv-ws="WS-1"]')
      expect(chip).toBeTruthy()
    })
    fireEvent.click(document.querySelector('[data-iv-ws="WS-1"]')!)
    await waitFor(() => {
      expect(document.querySelector('[data-cockpit-page="ws"]')).toBeTruthy()
    })
  }

  it('shows the PF panel with OPEN + STALE (and the staleReason)', async () => {
    const stub = makeStub()
    await gotoWs(stub)

    await waitFor(() => {
      expect(document.querySelector('[aria-label="PlanFork 管理"]')).toBeTruthy()
    })
    const panel = document.querySelector('[aria-label="PlanFork 管理"]')
    if (panel === null) throw new Error('PF panel missing from DOM')
    // Scoped to the cockpit-owned panel: the §27.4 FutureZone renders its
    // own data-pf rows earlier in the DOM.
    expect(panel.querySelector('[data-pf="PF-1"] [data-pf-status="OPEN"]')).toBeTruthy()
    const stale = panel.querySelector('[data-pf="PF-2"]')
    expect(stale?.textContent).toContain('superseded by PF-1 selection')
    expect(stale?.textContent).toContain('陈旧原因')
  })

  it('shows the git panel verdict (drifted) for the merge contract', async () => {
    const stub = makeStub()
    await gotoWs(stub)

    const contract = await waitFor(() => {
      const el = document.querySelector('[data-contract-path=".research/merges/TE-2/contract.md"]')
      expect(el).toBeTruthy()
      return el
    })
    expect(contract).toBeTruthy()
    // The verdict slice (the second window) lands with the drifted flag.
    await waitFor(() => {
      const verdict = document.querySelector('[data-contract-same=".research/merges/TE-2/contract.md"]')
      expect(verdict?.textContent).toContain('不一致')
    })
  })

  it('renders the three-zone workstream view (Current/Future/History zones)', async () => {
    const stub = makeStub()
    await gotoWs(stub)

    await waitFor(() => {
      // UI-4 ADJ-9: the zone title migrated 当前执行 → Current Execution.
      expect(document.querySelector('[aria-label="Current Execution"]')).toBeTruthy()
    })
    expect(document.querySelector('[aria-label="未来计划"]')).toBeTruthy()
    expect(document.querySelector('[aria-label="历史"]')).toBeTruthy()
  })

  it('back from the workstream page returns home', async () => {
    const stub = makeStub()
    await gotoWs(stub)

    const back = [...document.querySelectorAll('[data-cockpit-page="ws"] button')].find(
      (b) => b.textContent === '← 返回',
    )
    expect(back).toBeTruthy()
    fireEvent.click(back!)
    await waitFor(() => {
      expect(document.querySelector('[data-cockpit-page="home"]')).toBeTruthy()
    })
  })
})

describe('ResearchCockpit — fault faces', () => {
  it('a queryHistory transport fault keeps the page alive (empty model face)', async () => {
    const stub = makeStub()
    stub.set('queryHistory', new Error('transport down'))
    await mountStub(stub)
    renderCockpit()
    await screen.findByText('研究总览')

    await waitFor(() => {
      const chip = document.querySelector('[data-iv-ws="WS-1"]')
      expect(chip).toBeTruthy()
    })
    fireEvent.click(document.querySelector('[data-iv-ws="WS-1"]')!)
    await waitFor(() => {
      expect(document.querySelector('[data-cockpit-page="ws"]')).toBeTruthy()
    })
    // The drill-down section renders its empty model face (no crash).
    const drilldown = document.querySelector('[aria-label="Claim/Artifact drill-down"]')
    expect(drilldown).toBeTruthy()
    expect(drilldown?.textContent).toContain('本 Run 窗口无 Claim 事件')
  })
})

/* -------------------------------------------------------------------- *
 * WP-7.4 / G7 S1b + S1c — 一键调查入口 + 调查员页（AnalysisRecord
 * GUI 消费面）。
 * -------------------------------------------------------------------- */
describe('ResearchCockpit — WP-7.4 一键调查 + 调查员页', () => {
  it('导航栏含「调查员」页; 无 sessionId 时进入 = 大声点名缺口（不虚构绑定）', async () => {
    const stub = makeStub()
    await mountStub(stub)
    renderCockpit()
    await screen.findByText('研究总览')
    // 导航项在位（数据属性可断言）。
    const navInvestigator = document.querySelector('[data-cockpit-nav-item="investigator"]')
    expect(navInvestigator).toBeTruthy()
    expect(navInvestigator?.textContent).toBe('调查员')
    fireEvent.click(navInvestigator!)
    await waitFor(() => {
      expect(document.querySelector('[data-cockpit-page="investigator"]')).toBeTruthy()
    })
    // 无 sessionId（框架未解析宿主会话）⇒ 诚实缺口行, 不渲染面板。
    const page = document.querySelector('[data-cockpit-page="investigator"]')!
    expect(page.textContent).toContain('当前无宿主会话 id')
    expect(page.querySelector('[data-investigator-page]')).toBeNull()
  })

  it('一键调查成功（seam 通道）⇒ 自动跳入调查员页 + 面板绑定被启动调查会话', async () => {
    const stub = makeStub()
    await mountStub(stub)
    const calls: Array<{ id: string; question: string }> = []
    render(
      <StrictMode>
        <ResearchCockpit
          sessionId="sess-current"
          onInvestigate={async (item, question) => {
            calls.push({ id: item.id, question })
            return INVESTIGATION_SUCCESS_TEXT('investigator-live-777')
          }}
        />
      </StrictMode>,
    )
    await screen.findByText('研究总览')
    // 进入干预分组页（一键入口所在）。
    fireEvent.click(document.querySelector('[data-cockpit-nav-item="intervention"]')!)
    await waitFor(() => {
      expect(document.querySelector('[data-iv-question="IV-1"]')).toBeTruthy()
    })
    // 填问题 + 点击「调查此事项」（IV-1 = OPEN 行）。
    fireEvent.change(document.querySelector('[data-iv-question="IV-1"]')!, { target: { value: '为什么 PF 在堆积?' } })
    fireEvent.click(document.querySelector('[data-iv-id="IV-1"] [data-iv-investigate="IV-1"]')!)
    // 成功 ⇒ 自动跳入调查员页, 面板绑定被启动调查会话（非当前会话）。
    await waitFor(() => {
      expect(document.querySelector('[data-cockpit-page="investigator"]')).toBeTruthy()
    })
    const page = document.querySelector('[data-cockpit-page="investigator"]')!
    const panel = page.querySelector('[data-investigator-page]')
    expect(panel).toBeTruthy()
    expect(panel?.getAttribute('data-investigator-page')).toBe('investigator-live-777')
    // 通道入参逐字（item id + 问题）。
    expect(calls).toEqual([{ id: 'IV-1', question: '为什么 PF 在堆积?' }])
  })

  it('调查员页导航直达（有 sessionId, 无被启动会话）⇒ 面板回落绑定当前宿主会话', async () => {
    const stub = makeStub()
    await mountStub(stub)
    render(
      <StrictMode>
        <ResearchCockpit sessionId="sess-current" />
      </StrictMode>,
    )
    await screen.findByText('研究总览')
    fireEvent.click(document.querySelector('[data-cockpit-nav-item="investigator"]')!)
    await waitFor(() => {
      const panel = document.querySelector('[data-cockpit-page="investigator"] [data-investigator-page]')
      expect(panel).toBeTruthy()
    })
    const panel = document.querySelector('[data-cockpit-page="investigator"] [data-investigator-page]')
    expect(panel?.getAttribute('data-investigator-page')).toBe('sess-current')
  })

  it('一键调查失败（seam 抛错）⇒ 停留干预页 + fault 行透出错误', async () => {
    const stub = makeStub()
    await mountStub(stub)
    render(
      <StrictMode>
        <ResearchCockpit
          sessionId="sess-current"
          onInvestigate={async () => {
            throw new Error('[command-error] 调查启动失败: IVL_PERMISSION')
          }}
        />
      </StrictMode>,
    )
    await screen.findByText('研究总览')
    fireEvent.click(document.querySelector('[data-cockpit-nav-item="intervention"]')!)
    await waitFor(() => {
      expect(document.querySelector('[data-iv-question="IV-1"]')).toBeTruthy()
    })
    fireEvent.change(document.querySelector('[data-iv-question="IV-1"]')!, { target: { value: '问题' } })
    fireEvent.click(document.querySelector('[data-iv-id="IV-1"] [data-iv-investigate="IV-1"]')!)
    await waitFor(() => {
      const fault = document.querySelector('[data-cockpit-page="intervention"] [data-iv-inv-fault]')
      expect(fault).toBeTruthy()
    })
    const fault = document.querySelector('[data-cockpit-page="intervention"] [data-iv-inv-fault]')
    expect(fault?.textContent).toContain('[command-error]')
    // 失败不跳转 — 仍停留干预页。
    expect(document.querySelector('[data-cockpit-page="investigator"]')).toBeNull()
  })
})
