// @vitest-environment jsdom
/**
 * V2-T5.1 — 总览（中枢模式）= 聚合条 + 项目卡墙 component tests
 * (design §7.1 — the ASCII layout is the spec).
 *
 * Plain stub props — no real cordis in the component spec (the views-*
 * test pattern). The injected fetch face (`loadHubOverview`) is a vi.fn
 * stub per case; the wire fixtures are re-parsed through the strict
 * `HubOverviewResultSchema` in ./fixtures.ts, so a fixture that drifts
 * from the wire contract fails the suite, not the wire.
 *
 * Gate coverage (plan P5 T5.1):
 *  - the 聚合条 renders the totals (single text node: 「N 个项目 · 未决干预
 *    N · 收件箱 N」);
 *  - the 需关注 row SHOWS from the `queryAttention` face (UI-8 D3: the
 *    ⚠ line — per-project NON-TERMINAL count + 最旧 N 天/小时 computed
 *    client-side from the items' detectedAt) and HIDES when the face is
 *    omitted, the list is empty, or every item is a terminal (no
 *    placeholder element, no text in the DOM at all);
 *  - the card wall: attention-mode badge (FOCUS/NORMAL/BACKGROUND),
 *    name + PRJ-id, the count row (data-open-interventions), the target
 *    line ONLY when present;
 *  - the WHOLE CARD is clickable → `onDrill(projectId)` (the 钻取链 root);
 *  - the empty hub (0 projects) → the onboarding card 「登记第一个研究
 *    项目」 at the card-wall position (wired into the T4.2 bind flow);
 *  - a failed FIRST load → the failure face + 刷新 (the click re-invokes
 *    the fetch).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  HubOverviewPage,
  formatEpochDate,
  formatOldestAge,
  type HubOverviewPageProps,
} from '../../src/client/views/shell/hub-overview.js'
import type {
  BindProjectArgs,
  BindProjectResult,
  CreateLocalResearchProjectArgs,
  CreateLocalResearchProjectResult,
  HubOverviewResult,
  InspectProjectDirectoryArgs,
  InspectProjectDirectoryResult,
  QueryAttentionResult,
  SetHubArgs,
  SetHubResult,
} from '../../src/shared/rpc-contracts.js'
import {
  ATTN_EMPTY_RESULT,
  ATTN_NOW,
  ATTN_ROW_RESULT,
  ATTN_SUMMARY_RESULT,
  ATTN_TERMINALS_ONLY_RESULT,
  HUB_OVERVIEW_ATTENTION_RESULT,
  HUB_OVERVIEW_CARD_MAPPING_RESULT,
  HUB_OVERVIEW_EMPTY_RESULT,
  HUB_OVERVIEW_RESULT,
} from './fixtures.js'

/** The non-fetch props (the 空中枢 onboarding-card faces — inert in
 *  every case here; the T4.2 flows are covered in onboarding.test.tsx). */
const CARD_PROPS: Omit<HubOverviewPageProps, 'loadHubOverview' | 'onDrill'> = {
  wsPath: '/workspace/hub',
  hub: { path: '/workspace/hub' },
  dirNames: { treeDir: '.research', hubDir: '.research-control' },
  setHub: async (_args: SetHubArgs): Promise<SetHubResult> => ({
    hubPath: '/workspace/hub',
    registryPath: '/workspace/hub/.research-control/registry.yaml',
  }),
  bindProject: async (_args: BindProjectArgs): Promise<BindProjectResult> => ({
    projectId: 'PRJ-9',
    registryPath: null,
    dbMigrated: false,
  }),
  onApplied: () => undefined,
}

function renderOverview(
  loadHubOverview: () => Promise<HubOverviewResult>,
  onDrill: (projectId: string) => void = () => undefined,
): void {
  render(<HubOverviewPage {...CARD_PROPS} loadHubOverview={loadHubOverview} onDrill={onDrill} />)
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('HubOverviewPage — 聚合条', () => {
  it('renders the strip with the totals (single text node)', async () => {
    renderOverview(vi.fn().mockResolvedValue(HUB_OVERVIEW_RESULT))

    expect(document.querySelector('[data-hub-overview][data-phase="loading"]')).toBeTruthy()
    const strip = await screen.findByText('1 个项目 · 未决干预 0 · 收件箱 0')
    expect(document.querySelector('[data-hub-overview][data-phase="ready"]')).toBeTruthy()
    expect(strip.closest('[data-hub-overview-strip]')).toBeTruthy()
    // The [刷新] toolbar is in (the re-fetch affordance).
    expect(document.querySelector('[data-hub-overview-refresh]')).toBeTruthy()
  })
})

describe('HubOverviewPage — 需关注 row (UI-8 D3: the queryAttention face)', () => {
  it('renders the row with per-project non-terminal counts + oldest age when attention is non-empty', async () => {
    // The oldest age is computed CLIENT-SIDE from Date.now() − min
    // detectedAt — pin the clock so the assertion is deterministic.
    vi.setSystemTime(ATTN_NOW)
    const { faces } = makeWiredFaces(() => Promise.resolve(ATTN_ROW_RESULT))
    renderWired(vi.fn().mockResolvedValue(HUB_OVERVIEW_ATTENTION_RESULT), faces)

    const row = await screen.findByText(
      '⚠ 需关注：PRJ-1 机器人视觉定位（需关注 ×2，最旧 2 天）；PRJ-2 独立拓扑项目（需关注 ×1，最旧 5 小时）',
    )
    expect(row.closest('[data-hub-overview-attention]')).toBeTruthy()
  })

  it('HIDES the row when the face is omitted (no placeholder element, no text in the DOM)', async () => {
    renderOverview(vi.fn().mockResolvedValue(HUB_OVERVIEW_RESULT))

    await screen.findByText('1 个项目 · 未决干预 0 · 收件箱 0')
    expect(document.querySelector('[data-hub-overview-attention]')).toBeNull()
    expect(document.body.textContent).not.toContain('需关注')
  })

  it('HIDES the row when the fetch settles empty (no placeholder element)', async () => {
    const { faces } = makeWiredFaces(() => Promise.resolve(ATTN_EMPTY_RESULT))
    renderWired(vi.fn().mockResolvedValue(HUB_OVERVIEW_RESULT), faces)

    await screen.findByText('1 个项目 · 未决干预 0 · 收件箱 0')
    expect(document.querySelector('[data-hub-overview-attention]')).toBeNull()
    expect(document.body.textContent).not.toContain('需关注')
  })

  it('HIDES the row when every item is a terminal (the non-terminal filter)', async () => {
    const { faces } = makeWiredFaces(() => Promise.resolve(ATTN_TERMINALS_ONLY_RESULT))
    renderWired(vi.fn().mockResolvedValue(HUB_OVERVIEW_RESULT), faces)

    await screen.findByText('1 个项目 · 未决干预 0 · 收件箱 0')
    expect(document.querySelector('[data-hub-overview-attention]')).toBeNull()
    expect(document.body.textContent).not.toContain('需关注')
  })
})

describe('HubOverviewPage — 项目卡墙', () => {
  it('renders one whole-card button per project: badge mode, name+id, counts; the target line only when present', async () => {
    renderOverview(vi.fn().mockResolvedValue(HUB_OVERVIEW_ATTENTION_RESULT))

    await screen.findByText('2 个项目 · 未决干预 3 · 收件箱 5')
    // Card 1: FOCUS badge, name + PRJ-id, counts, target date present.
    const card1 = document.querySelector('[data-project-id="PRJ-1"]') as HTMLButtonElement
    expect(card1.tagName).toBe('BUTTON')
    expect(card1.querySelector('[data-attention-mode="FOCUS"]')).toBeTruthy()
    expect(card1.textContent).toContain('PRJ-1 机器人视觉定位系统')
    const counts1 = card1.querySelector('[data-card-counts]')!
    expect(counts1.getAttribute('data-open-interventions')).toBe('2')
    expect(counts1.textContent).toBe('干预2 主题2 收3')
    expect(card1.querySelector('[data-card-target]')?.textContent).toContain('目标 ')
    // Card 2: BACKGROUND badge, no target date → NO line at all.
    const card2 = document.querySelector('[data-project-id="PRJ-2"]') as HTMLButtonElement
    expect(card2.querySelector('[data-attention-mode="BACKGROUND"]')).toBeTruthy()
    expect(card2.querySelector('[data-card-target]')).toBeNull()
    expect(card2.querySelector('[data-card-counts]')!.textContent).toBe('干预1 主题1 收2')
  })

  it('the whole-card click fires onDrill with the project id (the 钻取链 root)', async () => {
    const onDrill = vi.fn()
    renderOverview(vi.fn().mockResolvedValue(HUB_OVERVIEW_ATTENTION_RESULT), onDrill)

    await screen.findByText('2 个项目 · 未决干预 3 · 收件箱 5')
    fireEvent.click(document.querySelector('[data-project-id="PRJ-2"]')!)
    expect(onDrill).toHaveBeenCalledTimes(1)
    expect(onDrill).toHaveBeenCalledWith('PRJ-2')
    fireEvent.click(document.querySelector('[data-project-id="PRJ-1"]')!)
    expect(onDrill).toHaveBeenCalledTimes(2)
    expect(onDrill).toHaveBeenLastCalledWith('PRJ-1')
  })

  it('a null targetDate renders no target line (有则显 — the smoke-card case)', async () => {
    renderOverview(vi.fn().mockResolvedValue(HUB_OVERVIEW_RESULT))

    await screen.findByText('1 个项目 · 未决干预 0 · 收件箱 0')
    const card = document.querySelector('[data-project-id="PRJ-1"]') as HTMLElement
    expect(card.querySelector('[data-attention-mode="FOCUS"]')).toBeTruthy()
    expect(card.querySelector('[data-card-target]')).toBeNull()
    expect(card.querySelector('[data-card-counts]')!.getAttribute('data-open-interventions')).toBe('0')
  })
})

describe('HubOverviewPage — 空中枢 (0 projects)', () => {
  it('renders the onboarding card 「登记第一个研究项目」 at the card-wall position', async () => {
    renderOverview(vi.fn().mockResolvedValue(HUB_OVERVIEW_EMPTY_RESULT))

    expect(await screen.findByText('0 个项目 · 未决干预 0 · 收件箱 0')).toBeTruthy()
    expect(document.querySelector('[data-hub-overview-wall][data-hub-overview-empty="true"]')).toBeTruthy()
    expect(screen.getByText('登记第一个研究项目')).toBeTruthy()
    // The T4.2 bind flow stays wired (the card's 接入 button renders).
    expect(screen.getByRole('button', { name: '将此工作区接入研究管理系统' })).toBeTruthy()
  })
})

describe('HubOverviewPage — 加载生命周期', () => {
  it('a failed FIRST load renders the failure face; 刷新 re-invokes the fetch and the result renders', async () => {
    let resolveFetch: (r: HubOverviewResult) => void = () => undefined
    const pending = new Promise<HubOverviewResult>((r) => {
      resolveFetch = r
    })
    const load = vi.fn().mockRejectedValueOnce(new Error('gateway down')).mockReturnValueOnce(pending)
    renderOverview(load)

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText('研究总览加载失败')).toBeTruthy()
    expect(document.querySelector('[data-hub-overview][data-phase="failed"]')).toBeTruthy()
    expect(load).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    expect(load).toHaveBeenCalledTimes(2)

    await act(async () => {
      resolveFetch(HUB_OVERVIEW_RESULT)
    })
    expect(await screen.findByText('1 个项目 · 未决干预 0 · 收件箱 0')).toBeTruthy()
  })
})

describe('formatters', () => {
  it('formatOldestAge: ≥24h → whole days (floor), ≥1h → whole hours (floor), <1h → <1 小时', () => {
    expect(formatOldestAge(70)).toBe('最旧 2 天')
    expect(formatOldestAge(24)).toBe('最旧 1 天')
    expect(formatOldestAge(5)).toBe('最旧 5 小时')
    expect(formatOldestAge(5.7)).toBe('最旧 5 小时')
    // the acceptance T6.2 discovery: a fresh intervention (a float far below
    // 1h) must not leak the raw float into the UI
    expect(formatOldestAge(0.0067794444444444445)).toBe('最旧 <1 小时')
    expect(formatOldestAge(0)).toBe('最旧 <1 小时')
  })

  it('formatEpochDate: the YYYY-MM-DD shape (TZ-stable form)', () => {
    expect(formatEpochDate(1780000000000)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

/* ───────────────────────────────────────────────────────────────────── *
 * V2-UI-0.4 UI-3 — the Portfolio restructure (B §4.2-§4.6, D2) + the
 * D8 view-coverage pass: the frozen header, the Needs Attention
 * summary (cap 6, host order), the B §4.5 card field mapping (有则显),
 * and the B §4.6 verbatim empty state (dual buttons → the shared
 * journey dialogs).
 * ───────────────────────────────────────────────────────────────────── */

/** The wired D2 faces: the Create/Bind journeys + the attention
 *  summary face (UI-8 D3: `loadAttention` — the unified `queryAttention`
 *  fetch, zero args = the cross-project hub view) + its navigation
 *  target (the 重要事件 stream jump). */
function makeWiredFaces(attention: () => Promise<QueryAttentionResult> =
  () => Promise.resolve(ATTN_SUMMARY_RESULT)) {
  const onOpenAttention = vi.fn()
  const faces = {
    createLocalResearchProject: async (_args: CreateLocalResearchProjectArgs): Promise<CreateLocalResearchProjectResult> => ({
      ok: true,
      projectId: 'PRJ-99',
      treePath: '/workspace/new/.research',
      registryPath: null,
      dbMigrated: false,
    }),
    inspectProjectDirectory: async (_args: InspectProjectDirectoryArgs): Promise<InspectProjectDirectoryResult> => ({
      wsPath: '/workspace/existing',
      state: 'RC_PROJECT',
      message: '研究项目',
      detail: null,
      hasGitRepo: true,
      hasResearchTree: true,
      treeValid: true,
      alreadyManaged: false,
    }),
    loadAttention: attention,
    onOpenAttention,
  }
  return { faces, onOpenAttention }
}

function renderWired(
  loadHubOverview: () => Promise<HubOverviewResult>,
  faces: ReturnType<typeof makeWiredFaces>['faces'],
  onDrill: (projectId: string) => void = () => undefined,
): void {
  render(<HubOverviewPage {...CARD_PROPS} loadHubOverview={loadHubOverview} onDrill={onDrill} {...faces} />)
}

describe('Portfolio header (B §4.2/§4.3)', () => {
  it('renders the frozen title + subtitle', async () => {
    renderWired(vi.fn().mockResolvedValue(HUB_OVERVIEW_RESULT), makeWiredFaces().faces)
    // findByRole: the ready face lands one promise tick after mount
    expect(await screen.findByRole('heading', { level: 2, name: 'Portfolio' })).toBeDefined()
    expect(screen.getByText('Research projects overview')).toBeDefined()
  })

  it('the header buttons render ONLY when their faces are wired (nothing, no placeholders, otherwise)', async () => {
    // unwired (the CARD_PROPS default): no buttons in the DOM at all
    renderOverview(vi.fn().mockResolvedValue(HUB_OVERVIEW_RESULT))
    await screen.findByText('1 个项目 · 未决干预 0 · 收件箱 0')
    expect(document.querySelector('[data-portfolio-create]')).toBeNull()
    expect(document.querySelector('[data-portfolio-bind]')).toBeNull()

    cleanup()
    // wired: both buttons render with the B §4.3 MUST copy
    renderWired(vi.fn().mockResolvedValue(HUB_OVERVIEW_RESULT), makeWiredFaces().faces)
    expect(await screen.findByRole('button', { name: 'Create Project' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Bind Existing Project' })).toBeDefined()
  })

  it('the header buttons open the shared journey dialogs', async () => {
    renderWired(vi.fn().mockResolvedValue(HUB_OVERVIEW_RESULT), makeWiredFaces().faces)
    await screen.findByText('1 个项目 · 未决干预 0 · 收件箱 0')

    // both dialogs are independent mounts — open the create journey…
    fireEvent.click(screen.getByRole('button', { name: 'Create Project' }))
    expect(document.querySelector('[data-onboarding-create]')).not.toBeNull()
    // …and the bind journey (the create dialog stays mounted beside it)
    fireEvent.click(screen.getByRole('button', { name: 'Bind Existing Project' }))
    expect(document.querySelector('[data-onboarding-bind]')).not.toBeNull()
  })
})

describe('Needs Attention summary (B §4.4)', () => {
  it('renders the top-6 items in host order (item 7 is capped out) + [View all]', async () => {
    const { faces, onOpenAttention } = makeWiredFaces()
    renderWired(vi.fn().mockResolvedValue(HUB_OVERVIEW_RESULT), faces)

    expect(await screen.findByText('Needs Attention')).toBeDefined()
    // the cap: 7 items in → exactly 6 rendered (same commit as the heading)
    expect(document.querySelectorAll('[data-portfolio-attention-item]')).toHaveLength(6)
    expect(document.querySelector('[data-attention-item-id="IV-1"]')).not.toBeNull()
    expect(document.querySelector('[data-attention-item-id="IV-6"]')).not.toBeNull()
    expect(document.querySelector('[data-attention-item-id="IV-7"]')).toBeNull()

    // the item face: title + the meta line (displayName (projectId) · WS ·
    // kind · priority · status — UI-8 D3) — the fixture items share one
    // meta line, so it repeats exactly once per rendered item
    expect(screen.getByText('干预事项 1')).toBeDefined()
    expect(screen.getAllByText('机器人视觉定位 (PRJ-1) · WS-1 · Intervention · High · OPEN')).toHaveLength(6)

    // item click + [View all] both jump to the 重要事件 stream page
    fireEvent.click(document.querySelector('[data-attention-item-id="IV-1"]') as Element)
    expect(onOpenAttention).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'View all' }))
    expect(onOpenAttention).toHaveBeenCalledTimes(2)
  })

  it('renders NOTHING when the list is empty (无则不渲染，不占位)', async () => {
    const { faces } = makeWiredFaces(() => Promise.resolve(ATTN_EMPTY_RESULT))
    renderWired(vi.fn().mockResolvedValue(HUB_OVERVIEW_RESULT), faces)
    await screen.findByText('1 个项目 · 未决干预 0 · 收件箱 0')
    expect(document.querySelector('[data-portfolio-attention]')).toBeNull()
    expect(document.querySelector('[data-portfolio-attention-error]')).toBeNull()
  })

  it('renders NOTHING when the face is unwired (no section, no placeholder)', async () => {
    renderOverview(vi.fn().mockResolvedValue(HUB_OVERVIEW_RESULT))
    await screen.findByText('1 个项目 · 未决干预 0 · 收件箱 0')
    expect(document.querySelector('[data-portfolio-attention]')).toBeNull()
    expect(document.body.textContent).not.toContain('Needs Attention')
  })

  it('a failed summary fetch keeps the page + renders the carrier-decoded fault line', async () => {
    const faulted = () =>
      Promise.reject(new Error('[research-control] PLANE_DB_MISSING: hub db missing'))
    const { faces } = makeWiredFaces(faulted)
    renderWired(vi.fn().mockResolvedValue(HUB_OVERVIEW_RESULT), faces)
    await screen.findByText('1 个项目 · 未决干预 0 · 收件箱 0')
    expect(await screen.findByRole('alert')).toBeDefined()
    expect(document.querySelector('[data-portfolio-attention-error]')?.textContent).toBe('hub db missing')
    // the page itself is intact (the summary is a section, not the page)
    expect(document.querySelector('[data-hub-overview][data-phase="ready"]')).toBeTruthy()
    expect(document.querySelector('[data-portfolio-attention]')).toBeNull()
  })
})

describe('Portfolio cards (B §4.5 field mapping, 有则显)', () => {
  it('description + target date render ONLY when present; the counts row always renders', async () => {
    renderWired(vi.fn().mockResolvedValue(HUB_OVERVIEW_CARD_MAPPING_RESULT), makeWiredFaces().faces)

    const full = await screen.findByText('PRJ-1 Full card project')
    const fullCard = full.closest('[data-project-card]') as Element
    expect(fullCard.getAttribute('data-project-id')).toBe('PRJ-1')
    // the FULL card: description + target line present
    expect(fullCard.querySelector('[data-card-description]')?.textContent).toBe('多传感器融合定位')
    expect(fullCard.querySelector('[data-card-target]')?.textContent).toMatch(/^目标 \d{4}-\d{2}-\d{2}$/)
    expect(fullCard.querySelector('[data-card-counts]')?.textContent).toBe('干预2 主题3 收1')

    const sparse = screen.getByText('PRJ-2 Sparse card project')
    const sparseCard = sparse.closest('[data-project-card]') as Element
    // the SPARSE card: neither line in the DOM (有则显)
    expect(sparseCard.querySelector('[data-card-description]')).toBeNull()
    expect(sparseCard.querySelector('[data-card-target]')).toBeNull()
    expect(sparseCard.querySelector('[data-card-counts]')?.textContent).toBe('干预0 主题0 收0')
  })
})

describe('Portfolio empty state (B §4.6 verbatim)', () => {
  it('renders the verbatim empty box + the dual buttons opening the journey dialogs', async () => {
    const { faces } = makeWiredFaces()
    renderWired(vi.fn().mockResolvedValue(HUB_OVERVIEW_EMPTY_RESULT), faces)

    expect(await screen.findByText('No research projects yet')).toBeDefined()
    expect(screen.getByText('Start a new local research project or bind an existing project directory.')).toBeDefined()
    // the 必须解释 line (Create/Bind semantics, verbatim, one line)
    expect(
      document.querySelector('[data-portfolio-empty-explain]')?.textContent,
    ).toBe('Create = 创建新的本地 Project + Git + research structure。Bind = 接管已有目录 / Git repo')

    // the Create button → the shared create dialog, the Bind button →
    // the shared bind dialog (independent mounts — both may be open).
    // Scoped locators: the header ALSO renders a 'Bind Existing Project'
    // button (wired faces), so the role query would be ambiguous.
    fireEvent.click(screen.getByRole('button', { name: 'Create Research Project' }))
    expect(document.querySelector('[data-onboarding-create]')).not.toBeNull()
    fireEvent.click(document.querySelector('[data-portfolio-empty-bind]') as Element)
    expect(document.querySelector('[data-onboarding-bind]')).not.toBeNull()

    // the T5.1 onboarding card coexists (the SAME T4.2 bind flow)
    expect(document.body.textContent).toContain('登记第一个研究项目')
  })
})
