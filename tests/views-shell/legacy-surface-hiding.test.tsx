// @vitest-environment jsdom
/**
 * UI-9 D2 — legacy surface hiding (ZERO deletion) assertion suite.
 *
 * D §15.6 freezes the formal hiding of the 5 legacy surfaces. The code
 * stays (D §27: "hidden but code remains"); this file pins the hiding
 * invariants at the render level so a future re-arm is a visible,
 * deliberate act.
 *
 *  - ADJ-2 Investigator: the first-tier nav renders EXACTLY the 3
 *    visible entries (Portfolio / Needs Attention / Settings); 调查员 is
 *    NOT a nav target. The programmatic deep-link (one-click investigate
 *    → [data-page="investigator"]) stays alive — pinned by
 *    tests/views-shell/investigator-binding.test.tsx (the jump + binding
 *    assertions); the frozen e2e t53 covers the journey and is untouched
 *    (ADJ-2: t53 一字不动).
 *
 *  - ADJ-3 PlanFork 主入口 (PfPanel, the LIVE workstream side panel):
 *    隐操作、留展示 — the select/dismiss operation controls
 *    ([data-pf-action]) remain in the DOM but are HIDDEN (the `hidden`
 *    attribute: invisible, unfocusable, unclickable in real browsers),
 *    while the read-only pending/stale visibility renders, and the
 *    PlanGraph overlay stays a read-only visualization
 *    ([data-role="plan-graph"] in the live workstream page).
 *
 *  - ADJ-4 Audit console: NO live face — nothing to hide.
 *    grep evidence: `grep -rn "Audit[A-Z]" src/client` → 0 component
 *    matches; there is no src/client/views/audit directory; "audit"
 *    survives only in the run-history data model (views/history
 *    ordered-events / run-group — the run audit event kind feeding the
 *    live 历史 timeline), not in any console. (ADJ-4: a mountable Audit
 *    component would be an IMPL-BLOCKER; none exists.)
 *
 *  - #17 ResearchCockpit (+ its dormant children Reporting / Inbox /
 *    Living Brief): DORMANT — the barrel export has NO live importer.
 *    grep evidence: `grep -rn "ResearchCockpit" src/client` → the barrel
 *    export in views/drilldown/index.ts + doc comments only;
 *    `grep -rn "ReportingView\|InboxViewContainer" src/client` → only
 *    cockpit.tsx (the ResearchCockpit body, L473/L509) imports them;
 *    `grep -rn "BriefView" src/client` → only cockpit.tsx imports
 *    views/brief (ADJ-9: the C §31 Living Brief face is dormant).
 *    The live tree (shell ready state + the live WorkstreamPage drill
 *    body) renders none of their DOM markers.
 *
 *  - ADJ-9 (C §31 三面收口): the 3 extra C §31 faces need NO additional
 *    hiding action — Living Brief ✓dormant (above), the Analysis manager
 *    component does not exist in src/client (`grep -rn "AnalysisManager"
 *    src/client` → 0 matches), and the live git-panel (Checkpoint/Git,
 *    restoreDeclarativeFile merge-contract recovery) is the
 *    domain-limited recovery face §26.1/J5 requires — KEPT, not a
 *    hiding target.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// BEFORE any src import (the shell + workstream page transitively load
// the WP-4.5 graph → @xyflow/react; the mock renders the node/edge layer
// for real — the repo test-layer pattern).
import '../graph/xyflow-mock.js'

import {
  mountResearchRemotes,
  unmountResearchRemotes,
  type RemoteContext,
} from '../../src/client/dsh-adapter/remote/mount.js'
import { ResearchShell, type ResearchShellProps } from '../../src/client/views/shell/index.js'
import { WorkstreamPage } from '../../src/client/views/drilldown/cockpit.js'
import { PfPanel } from '../../src/client/views/drilldown/pf-panel.js'
import { createResearchStore } from '../../src/client/stores'
import type {
  AckMissingReminderArgs,
  AckMissingReminderResult,
  GetPortfolioInterventionsResult,
  QueryAttentionResult,
  HubOverviewResult,
  UpdateInterventionStateResult,
} from '../../src/shared/rpc-contracts.js'
import type { AnalysisRecordDto, InvestigatorTransientDto } from '../../src/shared/analysis-command.js'
import { makeStubRpc, type StubRpc } from '../stores/stub-rpc.js'
import { HUB_OVERVIEW_RESULT } from '../views-overview/fixtures.js'
import { HUB_RESULT } from './fixtures.js'
import {
  DRILLDOWN_GIT_DRIFTED,
  DRILLDOWN_HISTORY,
  DRILLDOWN_TOPIC,
  DRILLDOWN_WORKSTREAM,
} from '../views-drilldown/fixtures.js'

/** The inert shell-prop harness (the same pattern as shell.test.tsx —
 *  only the HUB ready state is exercised here; the mutation faces never
 *  fire because the fixture carries no missing entries and no
 *  onboarding action is taken). */
function renderHubShell(): void {
  const setHub = vi.fn(async () => ({ hubPath: '/workspace/unregistered', registryPath: '/workspace/unregistered/.research-control/registry.yaml' }))
  const bindProject = vi.fn(async () => ({ projectId: 'PRJ-9', registryPath: null, dbMigrated: false }))
  const rescan = vi.fn(async () => ({ hub: null, dirNames: { treeDir: '.research', hubDir: '.research-control' }, projects: [], missing: [], registry: [] }))
  const unbindProject = vi.fn(async () => ({ projectId: 'PRJ-9', archivedDir: '/workspace/.research-control/archived/PRJ-9' }))
  const restoreProject = vi.fn(async () => ({ wsPath: '/workspace/PRJ-9' }))
  const ackMissingReminder = vi.fn(async (_args: AckMissingReminderArgs): Promise<AckMissingReminderResult> => ({ acknowledged: true }))
  const loadHubOverview = vi.fn(async (): Promise<HubOverviewResult> => HUB_OVERVIEW_RESULT)
  const loadPortfolioInterventions = vi.fn(async (): Promise<GetPortfolioInterventionsResult> => ({ items: [] }))
  const loadAttention = vi.fn(async (): Promise<QueryAttentionResult> => ({ items: [], total: 0 }))
  const updateInterventionState = vi.fn(async (): Promise<UpdateInterventionStateResult> => ({
    interventionId: 'IV-1',
    statusFrom: 'OPEN',
    statusTo: 'PENDING',
    closedAt: null,
    resolutionNote: null,
  }))
  const onInvestigate = vi.fn(async (): Promise<string> => '调查已启动')
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
        sessionId="sess-hub"
        loadPlaneState={vi.fn().mockResolvedValue(HUB_RESULT)}
        loadHubOverview={loadHubOverview}
        loadPortfolioInterventions={loadPortfolioInterventions}
        loadAttention={loadAttention}
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

/** The mount seam (a plain fake ctx, no cordis — the same pattern as
 *  shell.test.tsx / cockpit.test.tsx). */
async function mountStub(stub: StubRpc): Promise<void> {
  const fakeCtx = {
    remote: {
      $mount: async (): Promise<() => void> => () => undefined,
      researchControl: stub.rpc,
    },
  } as unknown as RemoteContext
  await mountResearchRemotes(fakeCtx)
}

/** The LIVE workstream drill body (the V2 project-console host page —
 *  the three-zone view + PfPanel + GitPanel side; NO Reporting/Inbox/Brief
 *  children — those live only in the dormant ResearchCockpit). */
function renderWorkstreamPage(): void {
  const stub = makeStubRpc()
  stub.set('getWorkstream', { ok: true, value: DRILLDOWN_WORKSTREAM })
  stub.set('queryHistory', { ok: true, value: DRILLDOWN_HISTORY })
  stub.set('getTopic', { ok: true, value: DRILLDOWN_TOPIC })
  stub.set('getGitHistory', { ok: true, value: DRILLDOWN_GIT_DRIFTED })
  render(
    <StrictMode>
      <WorkstreamPage
        store={createResearchStore({ rpc: stub.rpc })}
        workstreamId="WS-1"
        selection={null}
        onSelect={() => {}}
        onOpenSession={() => {}}
        onOpenHistory={() => {}}
        onBack={() => {}}
      />
    </StrictMode>,
  )
}

afterEach(() => {
  cleanup()
  unmountResearchRemotes()
})

describe('UI-9 D2 — legacy surface hiding (zero deletion)', () => {
  it('ADJ-2: the first-tier nav has NO investigator entry (exactly the 3 visible entries)', async () => {
    await mountStub(makeStubRpc())
    renderHubShell()

    // The HUB frame reaches the ready state (the nav renders per role).
    await screen.findByRole('button', { name: 'Portfolio' })
    for (const label of ['Portfolio', 'Needs Attention', 'Settings']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy()
    }
    // 调查员 is NOT a first-tier nav target (B §2.1) — no button for it,
    // while the page switch still owns the id (the deep-link surface).
    expect(screen.queryByRole('button', { name: '调查员' })).toBeNull()
    // Exactly the 3 visible entries in the header nav.
    expect(document.querySelectorAll('header nav button').length).toBe(3)
    expect(document.querySelector('[data-page="overview"]')).toBeTruthy()
    // The deep-link page id stays in the union: ConsoleFrame still maps
    // it (pinned behaviorally by investigator-binding.test.tsx).
    expect(document.querySelector('[data-page="investigator"]')).toBeNull()
  })

  it('Reporting / Inbox / Living Brief / ResearchCockpit: dormant — absent from the live tree', async () => {
    await mountStub(makeStubRpc())
    renderHubShell()
    await screen.findByRole('button', { name: 'Portfolio' })

    // HUB ready state (portfolio wall): none of the dormant cockpit
    // children's DOM markers appear.
    expect(document.querySelector('[data-reporting-section]')).toBeNull()
    expect(document.querySelector('[data-inbox-list]')).toBeNull()

    cleanup()
    unmountResearchRemotes()
    await mountStub(makeStubRpc())
    renderWorkstreamPage()

    // Live drill body (WorkstreamPage): same absence — the live page
    // composes the three-zone view + PfPanel + GitPanel only.
    expect(document.querySelector('[data-reporting-section]')).toBeNull()
    expect(document.querySelector('[data-inbox-list]')).toBeNull()
    // The live side panels ARE present (the hiding is surgical, not a
    // gutted page): the PfPanel section + the OPEN row render (the row
    // lands via the lazy ws slice — wait for it).
    await waitFor(() => {
      expect(document.querySelector('[data-pf="PF-1"]')).not.toBeNull()
    })
    expect(document.querySelector('section[aria-label="PlanFork 管理"]')).toBeTruthy()
    expect(document.querySelector('[data-pf="PF-1"]')).toBeTruthy()
  })

  it('ADJ-4: the Audit console has no live face (nothing to hide)', async () => {
    // The grep evidence is in the file header: 0 `Audit[A-Z]` component
    // matches in src/client, no views/audit directory, "audit" only in
    // the run-history data model (the live 历史 timeline's event kind).
    // Codified: the rendered live tree carries no audit console surface.
    await mountStub(makeStubRpc())
    renderHubShell()
    await screen.findByRole('button', { name: 'Portfolio' })
    expect(document.querySelector('[data-audit-console]')).toBeNull()
    expect(document.querySelector('[data-audit]')).toBeNull()
  })

  it('ADJ-3: PfPanel hides the select/dismiss actions, keeps the read-only display', async () => {
    const stub = makeStubRpc()
    stub.set('getWorkstream', { ok: true, value: DRILLDOWN_WORKSTREAM })
    render(
      <StrictMode>
        <PfPanel store={createResearchStore({ rpc: stub.rpc })} workstreamId="WS-1" />
      </StrictMode>,
    )

    // The rows land (the read-only pending/stale visibility is kept).
    const open = await screen.findByText('补充一条计算验证任务')
    const pf1 = open.closest('[data-pf="PF-1"]')
    expect(pf1?.getAttribute('data-pf-status')).toBe('OPEN')
    const stale = document.querySelector('[data-pf="PF-2"]')
    expect(stale?.getAttribute('data-pf-status')).toBe('STALE')
    expect(stale?.textContent).toContain('superseded by PF-1 selection')
    // The read-only meta summary renders (提案 N 项 · fork → merge · 来自 run).
    expect(pf1?.textContent).toContain('提案 1 项 · T-1 → T-2 · 来自 R-1')

    // The operation controls remain in the DOM (hide-not-delete) but are
    // HIDDEN: `hidden` → invisible, unfocusable, unclickable in real
    // browsers (Playwright actionability would reject a click).
    const select = document.querySelector<HTMLButtonElement>('[data-pf="PF-1"] [data-pf-action="select"]')
    const dismiss1 = document.querySelector<HTMLButtonElement>('[data-pf="PF-1"] [data-pf-action="dismiss"]')
    const dismiss2 = document.querySelector<HTMLButtonElement>('[data-pf="PF-2"] [data-pf-action="dismiss"]')
    expect(select).not.toBeNull()
    expect(dismiss1).not.toBeNull()
    expect(dismiss2).not.toBeNull()
    expect(select?.hidden).toBe(true)
    expect(dismiss1?.hidden).toBe(true)
    expect(dismiss2?.hidden).toBe(true)
  })

  it('ADJ-3 overlay kept: the live workstream page still renders the plan graph (read-only visualization)', async () => {
    renderWorkstreamPage()
    // The WP-4.5 plan graph face renders (the PF overlay branches are its
    // read-only visualization; the mutation affordances live nowhere in
    // the live tree — see the PfPanel assertion above).
    await waitFor(() => {
      expect(document.querySelector('[data-role="plan-graph"]')).not.toBeNull()
    })
  })
})
