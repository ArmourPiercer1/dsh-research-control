// @vitest-environment jsdom
/**
 * WP-4.7 — project page PRESENTATION layer tests (pure props components).
 *
 * Scope (task brief「渲染断言」, §27.2 information architecture):
 *  - each §27.2 block renders its data (Project Brief, importance /
 *    attention mode meta, the Objective list with statements + the
 *    current-objective marker, the Topic sections, the two PHASE 5
 *    placeholder sections for the frozen-null fields);
 *  - null semantics: ordinary data nulls (description / targetDate)
 *    render only when present; the frozen-null placeholder sections are
 *    SHOWN, never hidden (「待 Phase 5」);
 *  - navigation callbacks fire with the right ids (topic → topic view,
 *    返回 → home);
 *  - loading / first-load failure / stale-while-revalidate error faces.
 *
 * V2-UI-0.4 UI-3 additions (B §7.2 / §9.1):
 *  - the Topic sections (collapsed by default, [Edit] / [+ Workstream]
 *    actions, lazy expanded body with description / objective summary /
 *    WS cards / the Topology shortcut);
 *  - the Project Attention section (UI-8 D3: the non-terminal rows of the
 *    single-project `queryAttention` projection — the UI-3 placeholder is
 *    retired; null state = heading only, no fabricated data, no loading
 *    line; workstream rows are clickable only when the topic id derives
 *    from the already-loaded topic faces);
 *  - the Recent History section (lazy, merged occurredAt-desc, the
 *    >20-workstream note, the empty state).
 *
 * Assertions target user-visible behavior (roles, text, callbacks) —
 * never CSS module class names.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ProjectPageView,
  type RecentHistoryFace,
  type TopicSectionFace,
} from '../../src/client/views/project'
import {
  assertWireValidProject,
  PROJECT_PAGE_EMPTY_FIXTURE,
  PROJECT_PAGE_FIXTURE,
} from './fixtures'
import {
  attentionItemDtoSchema,
  TopicSnapshotSchema,
  type AttentionItemDto,
  type HistoryEventDto,
  type TopicSnapshot,
} from '../../src/shared/rpc-contracts.js'

afterEach(cleanup)

/* -- UI-3 section fixtures (wire-valid, same discipline as the file) -- */

/** One ready Topic section (TPC-1 with two workstreams). */
const TOPIC_SECTION_FIXTURE: TopicSnapshot = {
  topic: {
    id: 'TPC-1',
    title: '高温超导',
    description: '高温超导机制研究',
    importance: 3,
    attentionMode: 'FOCUS',
    objectiveRefs: ['OBJ-2'],
    createdAt: 1755000000000,
  },
  workstreams: [
    {
      id: 'WS-1',
      title: '第一性原理计算',
      lifecycle: 'PLANNED',
      summary: 'DFT 计算',
      planItemCount: 4,
      openPlanForkCount: 1,
      runningRunCount: 0,
    },
    {
      id: 'WS-2',
      title: '实验复现',
      lifecycle: 'REALIZED',
      summary: null,
      planItemCount: 2,
      openPlanForkCount: 0,
      runningRunCount: 1,
    },
  ],
  topology: { edges: [] },
  mergeContracts: [],
  objectives: [
    {
      id: 'OBJ-2',
      scope: 'TOPIC',
      statement: '建立高温超导机制的定量模型',
      status: 'ACTIVE',
      priority: 'P1',
      targetDate: null,
    },
  ],
}

const READY_TOPIC_SECTIONS: ReadonlyMap<string, TopicSectionFace> = new Map([
  ['TPC-1', { status: 'ready', data: TOPIC_SECTION_FIXTURE, error: null }],
])

const FAILED_TOPIC_SECTIONS: ReadonlyMap<string, TopicSectionFace> = new Map([
  ['TPC-1', { status: 'error', data: null, error: 'research: HIER_INPUT: getTopic: no such topic' }],
])

const IDLE_RECENT_HISTORY: RecentHistoryFace = { entries: null, loading: false, truncated: false }

/**
 * UI-8 D3 — the Project Attention row fixtures (wire-valid: re-parsed
 * through the strict `attentionItemDtoSchema`, same discipline as the
 * file). WS-1/WS-2 live in TOPIC_SECTION_FIXTURE (TPC-1); WS-9 is
 * unknown to every loaded topic face (the never-guessed case).
 */
function attnItem(overrides: {
  readonly sourceId: string
  readonly workstreamId: string | null
  readonly status: AttentionItemDto['status']
  readonly title: string
}): AttentionItemDto {
  return attentionItemDtoSchema.parse({
    kind: 'INTERVENTION',
    sourceId: overrides.sourceId,
    sourceRef: { kind: 'intervention', id: overrides.sourceId },
    projectId: 'PRJ-1',
    workstreamId: overrides.workstreamId,
    title: overrides.title,
    reason: 'component-test item',
    status: overrides.status,
    priority: 'HIGH',
    score: 50,
    rank: null,
    createdAt: 1_750_000_000_000,
    detectedAt: 1_750_000_000_000,
    allowedActions: ['markPending', 'closeIntervention'],
    context: {},
  })
}

const ATTN_OPEN_WS1_ITEM = attnItem({
  sourceId: 'IV-1',
  workstreamId: 'WS-1',
  status: 'OPEN',
  title: '标定管线阻塞',
})
const ATTN_OPEN_UNKNOWN_WS_ITEM = attnItem({
  sourceId: 'IV-2',
  workstreamId: 'WS-9',
  status: 'OPEN',
  title: '未知工作流事项',
})
const ATTN_CLOSED_ITEM = attnItem({
  sourceId: 'IV-3',
  workstreamId: 'WS-1',
  status: 'CLOSED',
  title: '已关闭事项',
})

function makeHistoryEvent(eventId: string, wsId: string, occurredAt: number): HistoryEventDto {
  return {
    eventId,
    ownerWorkstreamId: wsId,
    eventType: 'run.completed',
    schemaVersion: 1,
    occurredAt,
    actor: { kind: 'USER', label: 'user-x' },
    source: null,
    payload: {},
    eventSeq: 1,
    recordedAt: occurredAt,
  }
}

/** Render the pure view with a full snapshot + spy callbacks. */
function renderView(
  fixture = PROJECT_PAGE_FIXTURE,
  options?: {
    readonly topicSections?: ReadonlyMap<string, TopicSectionFace>
    readonly recentHistory?: RecentHistoryFace
    readonly attentionItems?: readonly AttentionItemDto[] | null
    readonly attentionError?: string | null
    readonly onOpenWorkstream?: (workstreamId: string, topicId: string) => void
  },
) {
  const onRetry = vi.fn()
  const onBack = vi.fn()
  const onOpenTopic = vi.fn()
  const onExpandTopic = vi.fn()
  const onRetryTopic = vi.fn()
  const onEditTopic = vi.fn()
  const onAddWorkstream = vi.fn()
  const onCreateTopic = vi.fn()
  const onExpandRecentHistory = vi.fn()
  const utils = render(
    <ProjectPageView
      data={fixture}
      status="ready"
      error={null}
      onRetry={onRetry}
      onBack={onBack}
      onOpenTopic={onOpenTopic}
      topicSections={options?.topicSections ?? new Map()}
      onExpandTopic={onExpandTopic}
      onRetryTopic={onRetryTopic}
      onEditTopic={onEditTopic}
      onAddWorkstream={onAddWorkstream}
      onCreateTopic={onCreateTopic}
      onExpandRecentHistory={onExpandRecentHistory}
      recentHistory={options?.recentHistory ?? IDLE_RECENT_HISTORY}
      attentionItems={options?.attentionItems}
      attentionError={options?.attentionError}
      onOpenWorkstream={options?.onOpenWorkstream}
    />,
  )
  return {
    onRetry,
    onBack,
    onOpenTopic,
    onExpandTopic,
    onRetryTopic,
    onEditTopic,
    onAddWorkstream,
    onCreateTopic,
    onExpandRecentHistory,
    ...utils,
  }
}

describe('fixtures are wire-valid (contract drift fails the suite, not the wire)', () => {
  it('PROJECT_PAGE_FIXTURE and PROJECT_PAGE_EMPTY_FIXTURE parse through the strict schema', () => {
    assertWireValidProject(PROJECT_PAGE_FIXTURE)
    assertWireValidProject(PROJECT_PAGE_EMPTY_FIXTURE)
    TopicSnapshotSchema.parse(TOPIC_SECTION_FIXTURE)
  })
})

describe('section data rendering (§27.2 information architecture)', () => {
  it('renders the page title with the project id + title and the back action', () => {
    renderView()
    expect(screen.getByRole('heading', { level: 1, name: /PRJ-1 · 凝聚态方向综述/ })).toBeDefined()
    expect(screen.getByRole('button', { name: '← 返回总览' })).toBeDefined()
  })

  it('renders the Project Brief (description)', () => {
    renderView()
    expect(screen.getByRole('heading', { level: 2, name: '项目简介' })).toBeDefined()
    expect(screen.getByText('追踪关键方向进展并整理证据链')).toBeDefined()
  })

  it('renders importance / attention mode (+ id / target date / created meta)', () => {
    renderView()
    expect(screen.getByText('编号：PRJ-1')).toBeDefined()
    expect(screen.getByText('重要度：5')).toBeDefined()
    expect(screen.getByText('注意力：聚焦')).toBeDefined()
  })

  it('renders EVERY objective with its statement, status, priority and current marker', () => {
    renderView()
    expect(screen.getByRole('heading', { level: 2, name: '目标（3）' })).toBeDefined()
    expect(screen.getByText('完成凝聚态物理关键方向的系统综述')).toBeDefined()
    expect(screen.getByText('旧方向的对比研究（已放弃）')).toBeDefined()
    expect(screen.getByText('当前目标')).toBeDefined()
  })

  it('renders the two PHASE 5 placeholder sections with their 「待 Phase 5」 copy', () => {
    renderView()
    // the sections are SHOWN (not hidden) for every frozen-null field
    expect(screen.getByRole('heading', { level: 3, name: '即将到来的交互' })).toBeDefined()
    expect(screen.getByRole('heading', { level: 3, name: '即将到来的报告' })).toBeDefined()
    expect(screen.getAllByText('待 Phase 5')).toHaveLength(2)
  })
})

describe('UI-3 — Topic sections (B §7.2 / §9.1)', () => {
  it('renders one section per topic, COLLAPSED by default, with [Edit] / [+ Workstream]', () => {
    const { container } = renderView()
    expect(screen.getByRole('heading', { level: 2, name: /Topics \/ Workstreams（2）/ })).toBeDefined()
    const sections = container.querySelectorAll('[data-topic-id]')
    expect(sections).toHaveLength(2)
    for (const section of sections) {
      expect(section.getAttribute('data-topic-open')).toBe('false')
    }
    expect(screen.getByText('高温超导')).toBeDefined()
    expect(screen.getByText('3 个工作流')).toBeDefined()
    expect(screen.getByText('拓扑材料')).toBeDefined()
    expect(screen.getByText('0 个工作流')).toBeDefined()
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: '+ Workstream' })).toHaveLength(2)
    // collapsed → no body, and therefore no fetch was triggered
    expect(container.querySelector('[data-topic-body]')).toBeNull()
  })

  it('expands on toggle (fires onExpandTopic once; collapse fires nothing)', () => {
    const { container, onExpandTopic } = renderView()
    const section = container.querySelector('[data-topic-id="TPC-1"]')
    const toggle = section?.querySelector('[data-topic-toggle]')
    expect(toggle).not.toBeNull()
    fireEvent.click(toggle as Element)
    expect(onExpandTopic).toHaveBeenCalledTimes(1)
    expect(onExpandTopic).toHaveBeenCalledWith('TPC-1')
    expect(container.querySelector('[data-topic-id="TPC-1"]')?.getAttribute('data-topic-open')).toBe('true')
    fireEvent.click(toggle as Element)
    expect(onExpandTopic).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[data-topic-id="TPC-1"]')?.getAttribute('data-topic-open')).toBe('false')
  })

  it('the expanded body shows description / objective summary / WS cards / topology shortcut', () => {
    const { container, onOpenTopic } = renderView(PROJECT_PAGE_FIXTURE, {
      topicSections: READY_TOPIC_SECTIONS,
    })
    const section = container.querySelector('[data-topic-id="TPC-1"]')
    fireEvent.click(section?.querySelector('[data-topic-toggle]') as Element)

    expect(screen.getByText('高温超导机制研究')).toBeDefined()
    // the objective statement (scoped to the body — the project-level
    // objectives list carries the same statement for OBJ-2)
    const body = container.querySelector('[data-topic-body]')
    expect(body?.textContent).toContain('建立高温超导机制的定量模型')
    expect(screen.getByRole('heading', { level: 3, name: 'Workstreams' })).toBeDefined()
    // the WS cards: title + lifecycle + summary (only when present) + compact meta
    expect(screen.getByText('第一性原理计算')).toBeDefined()
    expect(screen.getByText('实验复现')).toBeDefined()
    expect(screen.getByText('规划中')).toBeDefined()
    expect(screen.getByText('已实现')).toBeDefined()
    expect(screen.getByText('DFT 计算')).toBeDefined()
    expect(screen.getByText('4 plan items · 1 open forks · 0 running')).toBeDefined()
    expect(screen.getByText('2 plan items · 0 open forks · 1 running')).toBeDefined()
    // the Topology row: the View topology shortcut → the topic view
    expect(screen.getByText('Topology:')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'View topology' }))
    expect(onOpenTopic).toHaveBeenCalledTimes(1)
    expect(onOpenTopic).toHaveBeenCalledWith('TPC-1')
  })

  it('the expanded body shows a loading face while the section has no data', () => {
    const { container } = renderView()
    const section = container.querySelector('[data-topic-id="TPC-1"]')
    fireEvent.click(section?.querySelector('[data-topic-toggle]') as Element)
    expect(container.querySelector('[data-topic-body] [role="status"]')).not.toBeNull()
    expect(screen.getByText('加载中…')).toBeDefined()
  })

  it('the expanded body shows the failure face + 重试 (fires onRetryTopic)', () => {
    const { container, onRetryTopic } = renderView(PROJECT_PAGE_FIXTURE, {
      topicSections: FAILED_TOPIC_SECTIONS,
    })
    const section = container.querySelector('[data-topic-id="TPC-1"]')
    fireEvent.click(section?.querySelector('[data-topic-toggle]') as Element)
    expect(screen.getByText(/加载失败：research: HIER_INPUT: getTopic: no such topic/)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(onRetryTopic).toHaveBeenCalledTimes(1)
    expect(onRetryTopic).toHaveBeenCalledWith('TPC-1')
  })

  it('[Edit] fires onEditTopic and [+ Workstream] fires onAddWorkstream', () => {
    const { container, onEditTopic, onAddWorkstream } = renderView()
    const section = container.querySelector('[data-topic-id="TPC-1"]') as Element
    fireEvent.click(section.querySelector('[data-topic-edit]') as Element)
    expect(onEditTopic).toHaveBeenCalledWith('TPC-1')
    fireEvent.click(section.querySelector('[data-topic-add-workstream]') as Element)
    expect(onAddWorkstream).toHaveBeenCalledWith('TPC-1')
  })

  it('the section heading + Topic action fires onCreateTopic', () => {
    const { onCreateTopic } = renderView()
    fireEvent.click(screen.getByRole('button', { name: '+ Topic' }))
    expect(onCreateTopic).toHaveBeenCalledTimes(1)
  })

  it('the ws-card click fires onOpenWorkstream(wsId, topicId) (carry-over #21 — B §8.1 navigation)', () => {
    const onOpenWorkstream = vi.fn()
    const { container } = renderView(PROJECT_PAGE_FIXTURE, {
      topicSections: READY_TOPIC_SECTIONS,
      onOpenWorkstream,
    })
    const section = container.querySelector('[data-topic-id="TPC-1"]') as Element
    fireEvent.click(section.querySelector('[data-topic-toggle]') as Element)
    fireEvent.click(section.querySelector('[data-ws-card][data-ws-id="WS-2"]') as Element)
    expect(onOpenWorkstream).toHaveBeenCalledTimes(1)
    expect(onOpenWorkstream).toHaveBeenCalledWith('WS-2', 'TPC-1')
  })
})

describe('UI-8 — Project Attention (B §7.2, D §14.3 real data)', () => {
  it('renders ONLY the heading before the fetch settles (no rows, no empty line, no loading line)', () => {
    const { container } = renderView()
    expect(screen.getByRole('heading', { level: 3, name: 'Project Attention' })).toBeDefined()
    expect(container.querySelector('[data-project-attention-items]')).toBeNull()
    expect(container.querySelector('[data-project-attention-empty]')).toBeNull()
    expect(container.querySelector('[data-project-attention-error]')).toBeNull()
  })

  it('renders the empty line when the projection settled with zero items', () => {
    renderView(PROJECT_PAGE_FIXTURE, { attentionItems: [] })
    expect(screen.getByText('Nothing needs attention right now.')).toBeDefined()
  })

  it('renders ONLY the non-terminal rows (kind · title · status — host order kept)', () => {
    const { container } = renderView(PROJECT_PAGE_FIXTURE, {
      attentionItems: [ATTN_OPEN_WS1_ITEM, ATTN_CLOSED_ITEM],
    })
    const rows = container.querySelectorAll('[data-project-attention-item]')
    expect(rows).toHaveLength(1)
    const row = rows[0] as Element
    expect(row.getAttribute('data-project-attention-item-id')).toBe('IV-1')
    expect(row.getAttribute('data-project-attention-item-status')).toBe('OPEN')
    expect(row.textContent).toBe('Intervention标定管线阻塞OPEN')
  })

  it('a workstream row whose topic derives from a loaded face fires onOpenWorkstream(wsId, topicId)', () => {
    const onOpenWorkstream = vi.fn()
    const { container } = renderView(PROJECT_PAGE_FIXTURE, {
      attentionItems: [ATTN_OPEN_WS1_ITEM],
      topicSections: READY_TOPIC_SECTIONS,
      onOpenWorkstream,
    })
    fireEvent.click(container.querySelector('[data-project-attention-item]') as Element)
    expect(onOpenWorkstream).toHaveBeenCalledTimes(1)
    expect(onOpenWorkstream).toHaveBeenCalledWith('WS-1', 'TPC-1')
  })

  it('a workstream row NOT present in any loaded topic face is NOT clickable (never guessed)', () => {
    const onOpenWorkstream = vi.fn()
    const { container } = renderView(PROJECT_PAGE_FIXTURE, {
      attentionItems: [ATTN_OPEN_UNKNOWN_WS_ITEM],
      topicSections: READY_TOPIC_SECTIONS,
      onOpenWorkstream,
    })
    fireEvent.click(container.querySelector('[data-project-attention-item]') as Element)
    expect(onOpenWorkstream).not.toHaveBeenCalled()
  })

  it('the fault line renders on fetch failure (role=alert, the carrier-decoded detail)', () => {
    renderView(PROJECT_PAGE_FIXTURE, { attentionError: 'hub db missing' })
    const fault = screen.getByRole('alert')
    expect(fault.getAttribute('data-project-attention-error')).not.toBeNull()
    expect(fault.textContent).toBe('hub db missing')
  })
})

describe('UI-3 — Recent History (judgment #9)', () => {
  it('is collapsed by default (no entries, no fetch trigger rendered)', () => {
    const { container } = renderView()
    const toggle = screen.getByRole('button', { name: 'Recent History' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('[data-history-entry]')).toBeNull()
  })

  it('expands on toggle (fires onExpandRecentHistory once) and shows the loading face', () => {
    const { onExpandRecentHistory } = renderView(PROJECT_PAGE_FIXTURE, {
      recentHistory: { entries: null, loading: true, truncated: false },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Recent History' }))
    expect(onExpandRecentHistory).toHaveBeenCalledTimes(1)
    expect(screen.getByText('加载中…')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Recent History' }))
    expect(onExpandRecentHistory).toHaveBeenCalledTimes(1)
  })

  it('renders the entries in the given order with ws label + event type', () => {
    // the VIEW renders the merged entries verbatim — the merge +
    // occurredAt-desc ordering is the CONTAINER's contract, pinned in
    // tests/views-project/project-container.test.tsx (UI-3 FR7 — the
    // Recent History container: tail-3 per window, the strict merge
    // order, the 20-workstream cap, the failed-topic and empty faces).
    // The entries arrive pre-sorted.
    const T0 = 1755000000000
    const { container } = renderView(PROJECT_PAGE_FIXTURE, {
      recentHistory: {
        entries: [
          {
            event: makeHistoryEvent('EV-1', 'WS-1', T0 + 300),
            workstreamId: 'WS-1',
            workstreamTitle: '第一性原理计算',
            topicId: 'TPC-1',
          },
          {
            event: makeHistoryEvent('EV-3', 'WS-1', T0 + 200),
            workstreamId: 'WS-1',
            workstreamTitle: '第一性原理计算',
            topicId: 'TPC-1',
          },
          {
            event: makeHistoryEvent('EV-2', 'WS-2', T0 + 100),
            workstreamId: 'WS-2',
            workstreamTitle: '实验复现',
            topicId: 'TPC-1',
          },
        ],
        loading: false,
        truncated: false,
      },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Recent History' }))
    const rows = container.querySelectorAll('[data-history-entry]')
    expect(rows).toHaveLength(3)
    // row order is preserved (occurredAt-desc: 300 → 200 → 100)
    expect(rows[0].textContent).toContain('第一性原理计算（WS-1）')
    expect(rows[1].textContent).toContain('第一性原理计算（WS-1）')
    expect(rows[2].textContent).toContain('实验复现（WS-2）')
    expect(screen.getAllByText('run.completed')).toHaveLength(3)
    // the actor label rides the row
    expect(screen.getAllByText('user-x')).toHaveLength(3)
  })

  it('shows the empty state when no window carried events', () => {
    const { container } = renderView(PROJECT_PAGE_FIXTURE, {
      recentHistory: { entries: [], loading: false, truncated: false },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Recent History' }))
    expect(screen.getByText('No history recorded yet.')).toBeDefined()
    expect(container.querySelector('[data-history-entry]')).toBeNull()
  })

  it('shows the first-20 note when the project has more than 20 workstreams', () => {
    renderView(PROJECT_PAGE_FIXTURE, {
      recentHistory: {
        entries: [
          {
            event: makeHistoryEvent('EV-1', 'WS-1', 300),
            workstreamId: 'WS-1',
            workstreamTitle: '第一性原理计算',
            topicId: 'TPC-1',
          },
        ],
        loading: false,
        truncated: true,
      },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Recent History' }))
    expect(screen.getByText('showing first 20 workstreams')).toBeDefined()
  })
})

describe('null semantics + empty states', () => {
  it('omits null ordinary data fields (description / targetDate) without empty labels', () => {
    renderView(PROJECT_PAGE_EMPTY_FIXTURE)
    expect(screen.getByRole('heading', { level: 1, name: /PRJ-1 · 项目一/ })).toBeDefined()
    expect(screen.queryByRole('heading', { level: 2, name: '项目简介' })).toBeNull()
    expect(screen.queryByText(/^目标日期：/u)).toBeNull()
    expect(screen.getByText('重要度：0')).toBeDefined()
    expect(screen.getByText('注意力：后台')).toBeDefined()
  })

  it('shows explicit empty states (not hidden sections) for empty objectives / topics', () => {
    renderView(PROJECT_PAGE_EMPTY_FIXTURE)
    expect(screen.getByRole('heading', { level: 2, name: '目标（0）' })).toBeDefined()
    expect(screen.getByText('暂无目标')).toBeDefined()
    expect(screen.getByRole('heading', { level: 2, name: /Topics \/ Workstreams（0）/ })).toBeDefined()
    expect(screen.getByText('暂无主题')).toBeDefined()
  })
})

describe('navigation callbacks (entry points to topic/home views)', () => {
  it('fires onOpenTopic with the topic id from the topology shortcut', () => {
    const { container, onOpenTopic } = renderView(PROJECT_PAGE_FIXTURE, {
      topicSections: READY_TOPIC_SECTIONS,
    })
    const section = container.querySelector('[data-topic-id="TPC-1"]')
    fireEvent.click(section?.querySelector('[data-topic-toggle]') as Element)
    fireEvent.click(screen.getByRole('button', { name: 'View topology' }))
    expect(onOpenTopic).toHaveBeenCalledTimes(1)
    expect(onOpenTopic).toHaveBeenCalledWith('TPC-1')
  })

  it('fires onBack when the 返回 button is clicked', () => {
    const { onBack } = renderView()
    fireEvent.click(screen.getByRole('button', { name: '← 返回总览' }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})

describe('loading / error faces (status + data matrix)', () => {
  it('shows 加载中… while loading without data (idle/loading)', () => {
    renderViewWithNullData({ data: null, status: 'loading', error: null })
    expect(screen.getByRole('status')).toBeDefined()
    expect(screen.getByText('加载中…')).toBeDefined()
  })

  it('shows the failure text and a 重试 action on a first-load failure (error, no data)', () => {
    const onRetry = vi.fn()
    renderViewWithNullData(
      { data: null, status: 'error', error: 'research: not mounted' },
      onRetry,
    )
    expect(screen.getByRole('alert')).toBeDefined()
    expect(screen.getByText('加载失败：research: not mounted')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('keeps stale data visible with a 刷新失败 banner on a failed refetch (stale-while-revalidate)', () => {
    render(
      <ProjectPageView
        data={PROJECT_PAGE_FIXTURE}
        status="error"
        error="research: gateway timeout"
        onRetry={vi.fn()}
        onBack={vi.fn()}
        onOpenTopic={vi.fn()}
        topicSections={new Map()}
        onExpandTopic={vi.fn()}
        onRetryTopic={vi.fn()}
        onEditTopic={vi.fn()}
        onAddWorkstream={vi.fn()}
        onCreateTopic={vi.fn()}
        onExpandRecentHistory={vi.fn()}
        recentHistory={IDLE_RECENT_HISTORY}
      />,
    )
    // the last good data stays rendered
    expect(screen.getByRole('heading', { level: 1, name: /PRJ-1 · 凝聚态方向综述/ })).toBeDefined()
    expect(screen.getByText('完成凝聚态物理关键方向的系统综述')).toBeDefined()
    // plus the error banner (no 重试 — the data is still usable)
    expect(screen.getByRole('alert')).toBeDefined()
    expect(screen.getByText('刷新失败：research: gateway timeout')).toBeDefined()
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull()
  })
})

/** The data-null faces (loading / first-load failure) — the same full
 *  prop face as the ready tests (the new required props typecheck too). */
function renderViewWithNullData(
  face: {
    readonly data: null
    readonly status: 'loading' | 'error'
    readonly error: string | null
  },
  onRetry?: () => void,
) {
  render(
    <ProjectPageView
      data={face.data}
      status={face.status}
      error={face.error}
      onRetry={onRetry ?? (() => undefined)}
      onBack={vi.fn()}
      onOpenTopic={vi.fn()}
      topicSections={new Map()}
      onExpandTopic={vi.fn()}
      onRetryTopic={vi.fn()}
      onEditTopic={vi.fn()}
      onAddWorkstream={vi.fn()}
      onCreateTopic={vi.fn()}
      onExpandRecentHistory={vi.fn()}
      recentHistory={IDLE_RECENT_HISTORY}
    />,
  )
}
