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
 *  - the 需关注 row SHOWS with the attention data (⚠ line — per-project
 *    open count + 最旧 N 天/小时) and HIDES when the attention is empty
 *    (no placeholder element, no text in the DOM at all);
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
  HubOverviewResult,
  SetHubArgs,
  SetHubResult,
} from '../../src/shared/rpc-contracts.js'
import {
  HUB_OVERVIEW_ATTENTION_RESULT,
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

describe('HubOverviewPage — 需关注 row', () => {
  it('renders the row with per-project open counts + oldest age when attention is non-empty', async () => {
    renderOverview(vi.fn().mockResolvedValue(HUB_OVERVIEW_ATTENTION_RESULT))

    const row = await screen.findByText(
      '⚠ 需关注：PRJ-1 机器人视觉定位（干预 ×2，最旧 2 天）；PRJ-2 独立拓扑项目（干预 ×1，最旧 5 小时）',
    )
    expect(row.closest('[data-hub-overview-attention]')).toBeTruthy()
  })

  it('HIDES the row when the attention is empty (no placeholder element, no text in the DOM)', async () => {
    renderOverview(vi.fn().mockResolvedValue(HUB_OVERVIEW_RESULT))

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
  it('formatOldestAge: ≥24h → whole days (floor), below → the hour count', () => {
    expect(formatOldestAge(70)).toBe('最旧 2 天')
    expect(formatOldestAge(24)).toBe('最旧 1 天')
    expect(formatOldestAge(5)).toBe('最旧 5 小时')
  })

  it('formatEpochDate: the YYYY-MM-DD shape (TZ-stable form)', () => {
    expect(formatEpochDate(1780000000000)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
