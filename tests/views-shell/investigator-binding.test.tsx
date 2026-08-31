// @vitest-environment jsdom
/**
 * V2-T5.3 — shell-level 一键调查 → 调查员 binding flow (design §7.3).
 *
 * The component spec (investigator-page.test.tsx) pins the PAGE; this
 * spec pins the SHELL wiring around it: a successful 一键调查 in the
 * 重要事件 stream (1) captures the launched investigator session into
 * the client-owned binding (parsed from the V1 channel's success text
 * via the shared `parseInvestigationSessionId` — the face itself
 * resolves the text unchanged), (2) jumps the console frame to the
 * 调查员 entry (the V1 cockpit's auto-navigation, repositioned), and
 * 解绑 clears the binding back to the honest 未绑定 face.
 *
 * Plain stub props — no real cordis (the views-* test pattern); the
 * plane-state fixture re-parses through the strict schema in
 * ./fixtures.ts.
 */

import '../graph/xyflow-mock.js'

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { StrictMode, act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AnalysisRecordDto, InvestigatorTransientDto } from '../../src/shared/analysis-command.js'
import { INVESTIGATION_SUCCESS_TEXT } from '../../src/shared/investigation-command.js'
import type {
  AckMissingReminderResult,
  AttentionItemDto,
  GetPortfolioInterventionsResult,
  PortfolioInterventionItemDto,
  QueryAttentionResult,
  UpdateInterventionStateResult,
} from '../../src/shared/rpc-contracts.js'
import { ResearchShell } from '../../src/client/views/shell/index.js'
import { HUB_OVERVIEW_RESULT } from '../views-overview/fixtures.js'
import { HUB_RESULT } from './fixtures.js'

const LAUNCHED_SID = 'inv-test-1'

const ITEM: PortfolioInterventionItemDto = {
  projectId: 'PRJ-1',
  displayName: '机器人视觉定位系统',
  id: 'IV-1',
  title: '标定管线阻塞',
  origin: 'AUTO_FLOODING',
  status: 'OPEN',
  workstreamIds: ['WS-1'],
  createdAt: 1_700_000_000_000,
}

/** UI-8 — the SAME intervention as the unified `queryAttention` item. */
const ATTN_ITEM: AttentionItemDto = {
  kind: 'INTERVENTION',
  sourceId: 'IV-1',
  sourceRef: { kind: 'INTERVENTION', id: 'IV-1' },
  projectId: 'PRJ-1',
  workstreamId: 'WS-1',
  title: '标定管线阻塞',
  reason: '自动洪泛检测',
  status: 'OPEN',
  priority: 'HIGH',
  score: 80,
  rank: 1,
  createdAt: 1_700_000_000_000,
  detectedAt: 1_700_000_000_000,
  allowedActions: ['markPending', 'closeIntervention', 'openWorkstream'],
  context: { intervention: { origin: 'AUTO_FLOODING' } },
}

/** Mount the HUB shell with an OPEN intervention in the Needs Attention
 *  unified stream (UI-8: the stream fetch switched to `queryAttention` —
 *  the unified item below; the legacy `loadPortfolioInterventions` face
 *  is kept REQUIRED-but-dormant in the shell props, stubbed for the
 *  byte-stable fixture contract). */
function renderHubShell(onInvestigate: (item: { readonly id: string; readonly title: string }, question: string) => Promise<string>): void {
  render(
    <StrictMode>
      <ResearchShell
        sessionId="sess-hub"
        loadPlaneState={vi.fn(async () => HUB_RESULT)}
        loadHubOverview={vi.fn(async () => HUB_OVERVIEW_RESULT)}
        loadPortfolioInterventions={vi.fn(async (): Promise<GetPortfolioInterventionsResult> => ({ items: [ITEM] }))}
        loadAttention={vi.fn(async (): Promise<QueryAttentionResult> => ({ items: [ATTN_ITEM], total: 1 }))}
        updateInterventionState={vi.fn(
          async (): Promise<UpdateInterventionStateResult> => ({
            interventionId: 'IV-1',
            statusFrom: 'OPEN',
            statusTo: 'PENDING',
            closedAt: null,
            resolutionNote: null,
          }),
        )}
        onInvestigate={onInvestigate}
        readInvestigatorTransient={vi.fn(
          async (sid: string): Promise<InvestigatorTransientDto> => ({
            sessionId: sid,
            session: { id: sid, cwd: '/workspace/hub-ws', title: '调查会话', running: true, createdAt: 1_700_000_000_000 },
            pointer: null,
            run: { id: 'R-1', workstreamId: 'WS-1', status: 'RUNNING', startedAt: 1_700_000_000_000, endedAt: null },
          }),
        )}
        loadAnalysisRecords={vi.fn(async (): Promise<readonly AnalysisRecordDto[]> => [])}
        saveAnalysisRecord={vi.fn(
          async (): Promise<AnalysisRecordDto> => ({
            id: 'AN-1',
            sourceRef: { kind: 'INTERVENTION', id: 'IV-1' },
            investigatorRunId: null,
            dshSessionId: null,
            content: 'stub 结论',
            createdAt: 1_700_000_000_000,
          }),
        )}
        setHub={vi.fn(async () => ({ hubPath: '/workspace/unregistered', registryPath: '/workspace/unregistered/.research-control/registry.yaml' }))}
        bindProject={vi.fn(async () => ({ projectId: 'PRJ-9', registryPath: null, dbMigrated: false }))}
        rescan={vi.fn(async () => ({ hub: null, dirNames: { treeDir: '.research', hubDir: '.research-control' }, projects: [], missing: [], registry: [] }))}
        unbindProject={vi.fn(async () => ({ projectId: 'PRJ-9', archivedDir: '/workspace/.research-control/archived/PRJ-9' }))}
        restoreProject={vi.fn(async () => ({ wsPath: '/workspace/PRJ-9' }))}
        ackMissingReminder={vi.fn(
          async (): Promise<AckMissingReminderResult> => ({ acknowledged: true }),
        )}
      />
    </StrictMode>,
  )
}

describe('T5.3 — 一键调查 → 调查员 binding (shell-level)', () => {
  afterEach(() => {
    cleanup()
  })

  it('a successful launch binds the session, jumps the frame to 调查员, and 解绑 clears the binding', async () => {
    const onInvestigate = vi.fn(async (): Promise<string> => INVESTIGATION_SUCCESS_TEXT(LAUNCHED_SID))
    renderHubShell(onInvestigate)

    // 重要事件 → the OPEN card (the frame exists once the plane fetch
    // resolves — wait for the nav before clicking).
    const attentionNav = await screen.findByRole('button', { name: 'Needs Attention' })
    fireEvent.click(attentionNav)
    const row = await waitFor(() => {
      const el = document.querySelector('[data-attention-card][data-iv-id="IV-1"]')
      if (el === null) throw new Error('card 未出现')
      return el as HTMLElement
    })
    expect(row.getAttribute('data-iv-status')).toBe('OPEN')

    // Fill the 调查问题 (必填 — blank = fault + 零调用) and 一键调查.
    const questionInput = within(row).getByPlaceholderText('调查问题（一键调查必填）')
    fireEvent.change(questionInput, { target: { value: '标定漂移的根因是什么？' } })
    await act(async () => {
      fireEvent.click(within(row).getByRole('button', { name: '一键调查' }))
    })
    expect(onInvestigate).toHaveBeenCalledTimes(1)
    expect(onInvestigate).toHaveBeenCalledWith(
      { id: 'IV-1', title: '标定管线阻塞' },
      '标定漂移的根因是什么？',
    )

    // The frame JUMPED to 调查员 (the V1 auto-navigation, repositioned)
    // and the binding row carries the launched session id. UI-3 D1: the
    // 调查员 entry is hidden from the first-level nav (VISIBLE_HUB_ENTRIES
    // filter), so the jump is asserted on the page section switch.
    await waitFor(() => expect(document.querySelector('[data-page="investigator"]')).not.toBeNull())
    const body = document.querySelector('[data-page="investigator"]') as HTMLElement
    expect(body).not.toBeNull()
    const binding = within(body).getByText('绑定会话:').closest('[data-investigator-binding]') as HTMLElement
    expect(binding.getAttribute('data-investigator-binding')).toBe(LAUNCHED_SID)
    // The 反链 carries the launching intervention (click → 重要事件).
    const link = within(binding).getByRole('button', { name: /来自 IV-1 标定管线阻塞/ })
    expect(link.getAttribute('data-binding-intervention')).toBe('IV-1')
    // The status bar is live for the bound session (the stub reports a
    // RUNNING run).
    await waitFor(() => expect(within(binding.parentElement as HTMLElement).getByText('运行中')).not.toBeNull())

    // 解绑 clears the binding → the honest 未绑定 face.
    fireEvent.click(within(binding).getByRole('button', { name: '解绑' }))
    expect(body.querySelector('[data-investigator-binding]')).toBeNull()
    expect(within(body).getByText(/未绑定调查会话/)).not.toBeNull()
  })

  it('a launch success text WITHOUT a session id stays unbound (no guessing)', async () => {
    const onInvestigate = vi.fn(async (): Promise<string> => '调查已启动（无会话指针 — 防御面）')
    renderHubShell(onInvestigate)

    const attentionNav = await screen.findByRole('button', { name: 'Needs Attention' })
    fireEvent.click(attentionNav)
    const row = await waitFor(() => {
      const el = document.querySelector('[data-attention-card][data-iv-id="IV-1"]')
      if (el === null) throw new Error('card 未出现')
      return el as HTMLElement
    })
    fireEvent.change(within(row).getByPlaceholderText('调查问题（一键调查必填）'), { target: { value: 'q' } })
    await act(async () => {
      fireEvent.click(within(row).getByRole('button', { name: '一键调查' }))
    })

    // The success text renders on the card (the channel text, unchanged)
    // but NO binding was captured and the frame did NOT jump.
    await waitFor(() => expect(within(row).getByText(/调查已启动（无会话指针/)).not.toBeNull())
    expect(document.querySelector('[data-page="investigator"]')).toBeNull()
    expect(document.querySelector('[data-investigator-binding]')).toBeNull()
    // UI-3 D1: the 调查员 entry is hidden from the first-level nav
    // (VISIBLE_HUB_ENTRIES filter) — there is no manual-nav path to it
    // anymore, only the programmatic jump on a successful launch.
    expect(screen.queryByRole('button', { name: '调查员' })).toBeNull()
  })
})
