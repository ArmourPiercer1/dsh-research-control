/**
 * WP-4.3 — three-zone view tests: PURE zone components (data presentation
 * + plan order + reorder callback + empty states).
 *
 * Rendering face: the zones are PURE display components (no hooks), so
 * every test either
 *  ① renders them with `react-dom/server` (`renderToString`) and asserts
 *     USER-VISIBLE text (never class names), or
 *  ② calls them DIRECTLY and walks the element tree (the WP-4.3 harness)
 *     to invoke the reorder/history callbacks — DOM-free click
 *     simulation (no jsdom/@testing-library devDep — see report).
 *
 * Zone rules under test (ARCHITECTURE §3.1 / INV-TZ-2, plan §27.4;
 * UI-4 D4 extends Current to the eight ADJ-10 groups):
 *  - Current: the eight ADJ-10 groups (Runs LAST) — objectives / focus /
 *    active tasks / pending validations / blockers ([Explicit] clearable,
 *    [Derived] read-only with the verbatim primary action) / next actions
 *    (Promote to Task / Dismiss + the promote receipt) / interventions
 *    (read-only; CLOSED renders "Closed") / runs (checkpoint = last
 *    heartbeat). Domain enum values render their canonical English form
 *    (D §25 — never translated); every other string is the t() copy;
 *  - Future: canonical plan in EXACT plan position (position-by-position)
 *    as the UI-5 ordered strip — the ADJ-16 ←/→ move buttons
 *    (boundary-disabled) + the ADJ-5 execution summary badge (tasks only)
 *    + the current-focus entry (B §20: the marker + the verbatim `Set as
 *    Current Focus` button) + the three-state Remove (B §19.4 verbatim
 *    labels via the classifier) + the create/edit forms + the dependency
 *    face (B §17) + the PF count badge (ADJ-9, read-only seam rows);
 *  - History: log-size summary + timeline entry (the timeline itself is
 *    WP-4.4).
 */

import type { ReactElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type {
  BlockerDto,
  CurrentTaskDto,
  DependencyEdgeDto,
  DerivedBlockerDto,
  InterventionFullDto,
  NextActionDto,
  ObjectiveFullDto,
  PlanItemDto,
  RunDto,
} from '../../src/shared/rpc-contracts.js'
import {
  EMPTY_PLAN_ITEM_DRAFT,
  CurrentZone,
  FutureZone,
  HistoryZone,
  classifyRemoveState,
  hasExecutionHistory,
  newPlanItemDraft,
  REMOVE_STATE_KEY,
  type CurrentFocusView,
  type CurrentZoneProps,
  type FutureZoneProps,
  type TaskExecution,
} from '../../src/client/views/workstream/index.js'
import {
  findByAriaLabel,
  findHostElements,
  findByHostText,
  hostElementText,
  invokeClick,
  ssrText,
} from './harness.js'

const T = 1_755_000_000_000

/** renderToString + SSR text-node separator normalization (see harness). */
function render(el: ReactElement): string {
  return ssrText(renderToString(el))
}

/* ==================================================================== *
 * CurrentZone
 * ==================================================================== */

const CURRENT_TASKS: readonly CurrentTaskDto[] = [
  {
    id: 'T-1',
    title: '设计实验方案',
    execution: 'ACTIVE',
    validation: 'PENDING',
    acceptanceCriteria: ['可复现的基线结果'],
    liveRunIds: ['R-1'],
  },
  {
    id: 'T-2',
    title: '撰写论文初稿',
    execution: 'PAUSED',
    validation: 'NOT_REQUIRED',
    acceptanceCriteria: [],
    liveRunIds: [],
  },
  {
    id: 'T-3',
    title: '数据清洗',
    execution: 'EXECUTED',
    validation: 'UNDER_REVIEW',
    acceptanceCriteria: [],
    liveRunIds: [],
  },
  {
    id: 'T-4',
    title: '规划中的后续任务',
    execution: 'PLANNED',
    validation: 'NOT_REQUIRED',
    acceptanceCriteria: [],
    liveRunIds: [],
  },
]

const CURRENT_RUNS: readonly RunDto[] = [
  {
    id: 'R-1',
    status: 'RUNNING',
    taskId: 'T-1',
    intent: '执行基线实验',
    startedAt: T,
    endedAt: null,
    lastCheckpointAt: T + 60_000,
    lastCheckpointNote: '半程检查点',
  },
  {
    id: 'R-2',
    status: 'FINISHED',
    taskId: 'T-3',
    intent: null,
    startedAt: T,
    endedAt: T + 5,
    lastCheckpointAt: null,
    lastCheckpointNote: null,
  },
]

/** UI-4 aggregate faces (wire-valid shapes, same convention as the
 *  `getWorkstreamCurrent` fixtures in the store suites). */
const CURRENT_OBJECTIVES: readonly ObjectiveFullDto[] = [
  {
    id: 'OBJ-1',
    scope: 'TOPIC',
    statement: 'Complete the baseline experiment',
    status: 'ACTIVE',
    priority: 'P1',
    targetDate: null,
    successCriteria: ['Reproducible baseline'],
    linkedRefs: [{ kind: 'WORKSTREAM', id: 'WS-1' }],
  },
]

const CURRENT_FOCUS: CurrentFocusView = {
  planItemId: 'T-9',
  title: '收尾：整理实验记录',
}

const EXPLICIT_BLOCKERS: readonly BlockerDto[] = [
  {
    id: 'BLK-1',
    statement: 'GPU quota exhausted',
    affects: [{ kind: 'WORKSTREAM', id: 'WS-1' }],
    status: 'ACTIVE',
    source: 'manual note',
    references: null,
    createdAt: T,
    clearedAt: null,
  },
  {
    id: 'BLK-2',
    statement: 'Missing dataset license',
    affects: [{ kind: 'TASK', id: 'T-3' }],
    status: 'CLEARED',
    source: 'agent report',
    references: null,
    createdAt: T - 5000,
    clearedAt: T - 1000,
  },
]

const DERIVED_BLOCKERS: readonly DerivedBlockerDto[] = [
  {
    id: 'DERIVED-GATE-G-1',
    source: 'GATE',
    statement: 'Gate G-1 was evaluated FAILED before the focus task',
    reasonRefs: ['G-1'],
    primaryAction: { label: 'Open G-1', targetKind: 'GATE', targetId: 'G-1' },
  },
]

const NEXT_ACTIONS: readonly NextActionDto[] = [
  {
    id: 'NA-1',
    workstreamId: 'WS-1',
    statement: 'Prepare the ablation dataset',
    rationale: 'Needed before the ablation runs',
    status: 'PROPOSED',
    promotedToTaskId: null,
    createdAt: T,
  },
]

const INTERVENTIONS: readonly InterventionFullDto[] = [
  {
    id: 'IV-1',
    title: 'Baseline results diverge',
    origin: 'AGENT_REPORT',
    status: 'OPEN',
    workstreamIds: ['WS-1'],
    createdAt: T,
    detail: 'Two runs disagree on metric X',
    closedAt: null,
    resolutionNote: null,
  },
  {
    id: 'IV-2',
    title: 'Hardware failure',
    origin: 'USER',
    status: 'CLOSED',
    workstreamIds: ['WS-1'],
    createdAt: T - 1000,
    detail: null,
    closedAt: T,
    resolutionNote: 'Replaced node',
  },
]

/** The full CurrentZone props (every face populated). */
function fullCurrentProps(overrides: Partial<CurrentZoneProps> = {}): CurrentZoneProps {
  return {
    tasks: CURRENT_TASKS,
    runs: CURRENT_RUNS,
    objectives: CURRENT_OBJECTIVES,
    focus: CURRENT_FOCUS,
    explicitBlockers: EXPLICIT_BLOCKERS,
    derivedBlockers: DERIVED_BLOCKERS,
    nextActions: NEXT_ACTIONS,
    interventions: INTERVENTIONS,
    promotedTaskId: null,
    onClearBlocker: () => undefined,
    onPromoteNextAction: () => undefined,
    onDismissNextAction: () => undefined,
    ...overrides,
  }
}

describe('CurrentZone（当前执行 — the eight ADJ-10 groups）', () => {
  it('渲染 8 组按 ADJ-10 顺序（Runs 末位）+ zone 标题', () => {
    const html = render(<CurrentZone {...fullCurrentProps()} />)
    expect(html).toContain('Current Execution')
    const groups = [
      'Current Objective',
      'Current Focus',
      'Active Tasks',
      'Pending Validation',
      'Blockers',
      'Next Actions',
      'Interventions',
      'Runs',
    ]
    let last = -1
    for (const group of groups) {
      // anchored on the exact element text `>…<` — the CSS-module class
      // names in the dev SSR html (e.g. `_liveRuns_…`) contain the bare
      // words and must not count
      const at = html.indexOf(`>${group}<`)
      expect(at, `group "${group}" must render`).toBeGreaterThanOrEqual(0)
      expect(at, `group "${group}" must keep its ADJ-10 position`).toBeGreaterThan(last)
      last = at
    }
  })

  it('Current Objective：statement + 规范 scope/priority 枚举（D §25）', () => {
    const html = render(<CurrentZone {...fullCurrentProps()} />)
    expect(html).toContain('Complete the baseline experiment')
    expect(html).toContain('TOPIC')
    expect(html).toContain('P1')
  })

  it('Current Focus：焦点 plan item（可解析时显示标题，否则原始 id；无指针时空态）', () => {
    const withTitle = render(<CurrentZone {...fullCurrentProps()} />)
    expect(withTitle).toContain('收尾：整理实验记录')
    const withoutTitle = render(
      <CurrentZone {...fullCurrentProps({ focus: { planItemId: 'T-404', title: null } })} />,
    )
    expect(withoutTitle).toContain('T-404')
    const none = render(<CurrentZone {...fullCurrentProps({ focus: null })} />)
    expect(none).toContain('No current focus')
  })

  it('Active Tasks：execution/validation 规范枚举 + live Run join + 验收标准', () => {
    const html = render(<CurrentZone {...fullCurrentProps()} />)
    // active list: only ACTIVE/PAUSED tasks
    expect(html).toContain('设计实验方案')
    expect(html).toContain('ACTIVE')
    expect(html).toContain('撰写论文初稿')
    expect(html).toContain('PAUSED')
    // the validation facet renders the raw enum (D §25 — never translated)
    expect(html).toContain('Validation: PENDING')
    // acceptance criteria
    expect(html).toContain('可复现的基线结果')
    // live Run join (§27.4 「live Run」)
    expect(html).toContain('Live runs: R-1')
    // PLANNED task with no pending validation appears NOWHERE in this zone
    expect(html).not.toContain('规划中的后续任务')
  })

  it('Pending Validation：PENDING/UNDER_REVIEW 任务（同一 identity 可同现两组）', () => {
    const html = render(<CurrentZone {...fullCurrentProps()} />)
    // scope to the Pending Validation section itself (the Active Tasks
    // group precedes it and shares the PENDING task identity)
    const section = html.slice(html.indexOf('Pending Validation'), html.indexOf('Blockers'))
    expect(section).toContain('设计实验方案')
    expect(section).toContain('数据清洗')
    expect(section).toContain('UNDER_REVIEW')
    // the PAUSED/NOT_REQUIRED task is OUT of this group
    expect(section).not.toContain('撰写论文初稿')
  })

  it('Blockers：[Explicit] 可 Clear + [Derived] 只读且 primary action 逐字（B §15.5）', () => {
    const onClearBlocker = vi.fn()
    const tree = CurrentZone(fullCurrentProps({ onClearBlocker }))
    const html = render(<CurrentZone {...fullCurrentProps()} />)
    // both source tags (B §15.5 verbatim)
    expect(html).toContain('[Explicit]')
    expect(html).toContain('[Derived]')
    // explicit rows: statement + the source note
    expect(html).toContain('GPU quota exhausted')
    expect(html).toContain('Source: manual note')
    // derived row: the primary action renders VERBATIM (the true-cause link)
    expect(html).toContain('Open G-1')
    // exactly one Clear button: the ACTIVE explicit blocker — the CLEARED
    // one and the derived one carry none (ADJ-4: derived is never clearable)
    const clears = findByAriaLabel(tree, 'Clear blocker: BLK-1')
    expect(clears.length).toBe(1)
    expect(findByAriaLabel(tree, 'Clear blocker: BLK-2').length).toBe(0)
    expect(findByAriaLabel(tree, 'Clear blocker: DERIVED-GATE-G-1').length).toBe(0)
    invokeClick(clears[0]!)
    expect(onClearBlocker).toHaveBeenCalledWith('BLK-1')
  })

  it('Next Actions：statement + rationale + Promote/Dismiss 入口（B §15.6）', () => {
    const onPromoteNextAction = vi.fn()
    const onDismissNextAction = vi.fn()
    const tree = CurrentZone(fullCurrentProps({ onPromoteNextAction, onDismissNextAction }))
    const html = render(<CurrentZone {...fullCurrentProps()} />)
    expect(html).toContain('Prepare the ablation dataset')
    expect(html).toContain('Rationale: Needed before the ablation runs')
    expect(html).toContain('Promote to Task')
    expect(html).toContain('Dismiss')
    invokeClick(findByAriaLabel(tree, 'Promote to Task: NA-1')[0]!)
    expect(onPromoteNextAction).toHaveBeenCalledWith('NA-1')
    invokeClick(findByAriaLabel(tree, 'Dismiss: NA-1')[0]!)
    expect(onDismissNextAction).toHaveBeenCalledWith('NA-1')
  })

  it('promote 回执：host 确认的新 Task id 明确显示（B §15.6）', () => {
    const withReceipt = render(<CurrentZone {...fullCurrentProps({ promotedTaskId: 'T-9' })} />)
    expect(withReceipt).toContain('Promoted to task: T-9')
    const without = render(<CurrentZone {...fullCurrentProps()} />)
    expect(without).not.toContain('Promoted to task:')
  })

  it('Interventions：title/status/source/related-WS/detail；CLOSED 显示 Closed（B §15.7）', () => {
    const html = render(<CurrentZone {...fullCurrentProps()} />)
    expect(html).toContain('Baseline results diverge')
    expect(html).toContain('OPEN')
    expect(html).toContain('Source: AGENT_REPORT')
    expect(html).toContain('Workstreams: WS-1')
    expect(html).toContain('Two runs disagree on metric X')
    // the CLOSED card: "Closed" — never "Solved"
    expect(html).toContain('Hardware failure')
    expect(html).toContain('Closed')
    expect(html).toContain('Replaced node')
    expect(html).not.toContain('Solved')
  })

  it('Runs：规范状态 + task/intent/最近检查点（heartbeat）facet', () => {
    const html = render(<CurrentZone {...fullCurrentProps()} />)
    expect(html).toContain('RUNNING')
    expect(html).toContain('Task: T-1')
    expect(html).toContain('Intent: 执行基线实验')
    expect(html).toContain(`Last checkpoint: ${new Date(T + 60_000).toISOString()} (半程检查点)`)
    // finished run without checkpoint
    expect(html).toContain('FINISHED')
    expect(html).toContain('Last checkpoint: none')
  })

  it('空态：8 组各显示低噪提示；无 identity 泄漏', () => {
    const empty: CurrentZoneProps = {
      tasks: [],
      runs: [],
      objectives: [],
      focus: null,
      explicitBlockers: [],
      derivedBlockers: [],
      nextActions: [],
      interventions: [],
      promotedTaskId: null,
      onClearBlocker: () => undefined,
      onPromoteNextAction: () => undefined,
      onDismissNextAction: () => undefined,
    }
    const html = render(<CurrentZone {...empty} />)
    expect(html).toContain('No active objectives')
    expect(html).toContain('No current focus')
    expect(html).toContain('No active tasks')
    expect(html).toContain('No pending validations')
    expect(html).toContain('No blockers')
    expect(html).toContain('No proposed next actions')
    expect(html).toContain('No interventions')
    expect(html).toContain('No runs')
    // no task/run identity leaked into the empty zone
    expect(html).not.toContain('T-1')
    expect(html).not.toContain('R-1')
  })
})

/* ==================================================================== *
 * FutureZone
 * ==================================================================== */

/** Plan deliberately OUT of id order — position must follow the plan,
 *  not the ids. */
const PLAN_ITEMS: readonly PlanItemDto[] = [
  { id: 'T-9', kind: 'TASK', title: '收尾：整理实验记录' },
  { id: 'G-1', kind: 'GATE', title: '数据完整性门' },
  { id: 'M-2', kind: 'MILESTONE', title: '中期里程碑' },
  { id: 'T-3', kind: 'TASK', title: '基线实验' },
]

describe('FutureZone（未来计划 — the UI-5 ordered strip）', () => {
  /** The full prop face with inert defaults (the zone is PURE — every
   *  value is a prop; the harness invokes handlers from the element tree). */
  function futureProps(overrides: Partial<FutureZoneProps> = {}): FutureZoneProps {
    return {
      planItems: PLAN_ITEMS,
      planForks: [],
      unresolvedPlanForkCount: 0,
      onMoveItem: () => undefined,
      reorderPending: false,
      reorderFault: null,
      focusedPlanItemId: null,
      onSetCurrentFocus: () => undefined,
      selectedItemId: null,
      onSelectItem: () => undefined,
      executionById: new Map<string, TaskExecution>(),
      createForm: null,
      draft: newPlanItemDraft('TASK'),
      onDraftChange: () => undefined,
      onOpenCreate: () => undefined,
      onCreateSubmit: () => undefined,
      onCreateClose: () => undefined,
      createPending: false,
      createFault: null,
      editDraft: EMPTY_PLAN_ITEM_DRAFT,
      onEditDraftChange: () => undefined,
      onEditSubmit: () => undefined,
      onEditClose: () => undefined,
      updatePending: false,
      updateFault: null,
      onRemoveItem: () => undefined,
      removePending: false,
      removeFault: null,
      dependencyEdges: [],
      depTargetId: '',
      onDepTargetChange: () => undefined,
      onAddDependency: () => undefined,
      addDependencyFault: null,
      onRemoveDependency: () => undefined,
      removeDependencyFault: null,
      ...overrides,
    }
  }

  it('按 plan 顺序逐位渲染 canonical G/T/M 列表（plan order = 用户意图）', () => {
    const html = render(<FutureZone {...futureProps()} />)
    // position-by-position: the four titles appear strictly in plan order
    const titles = ['收尾：整理实验记录', '数据完整性门', '中期里程碑', '基线实验']
    let last = -1
    for (const title of titles) {
      const at = html.indexOf(title)
      expect(at, `title "${title}" must render in plan order`).toBeGreaterThan(last)
      last = at
    }
    // ids + kind labels ride their rows
    expect(html).toContain('T-9')
    expect(html).toContain('任务')
    expect(html).toContain('门')
    expect(html).toContain('里程碑')
    // the UI-5 strip face: the frozen section title + the head `+` slot
    expect(html).toContain('Future Plan')
    expect(html).toContain('Add at start')
  })

  it('左移/右移按钮触发 onMoveItem(itemId, direction)（left = up, right = down）', () => {
    const onMoveItem = vi.fn()
    const tree = FutureZone(futureProps({ onMoveItem }))
    // every row carries exactly one left + one right button (ADJ-16)
    for (const item of PLAN_ITEMS) {
      expect(findByAriaLabel(tree, `左移：${item.id}`).length).toBe(1)
      expect(findByAriaLabel(tree, `右移：${item.id}`).length).toBe(1)
    }
    // middle item, both directions
    invokeClick(findByAriaLabel(tree, '左移：G-1')[0]!)
    expect(onMoveItem).toHaveBeenCalledWith('G-1', 'up')
    invokeClick(findByAriaLabel(tree, '右移：M-2')[0]!)
    expect(onMoveItem).toHaveBeenCalledWith('M-2', 'down')
    expect(onMoveItem).toHaveBeenCalledTimes(2)
  })

  it('边界按钮禁用：首项不可左移、末项不可右移', () => {
    const tree = FutureZone(futureProps())
    expect(findByAriaLabel(tree, '左移：T-9')[0]!.props.disabled).toBe(true)
    expect(findByAriaLabel(tree, '右移：T-3')[0]!.props.disabled).toBe(true)
    // interior items stay enabled in both directions
    expect(findByAriaLabel(tree, '左移：G-1')[0]!.props.disabled).toBe(false)
    expect(findByAriaLabel(tree, '右移：G-1')[0]!.props.disabled).toBe(false)
  })

  it('PF 计数徽章（ADJ-9）：仅当存在未决 PF 时渲染，展开 = 只读数据缝', () => {
    const planForks = [
      {
        id: 'PF-1',
        status: 'OPEN' as const,
        reason: '计划缺少基线实验',
        necessity: '目标依赖基线结果',
        forkAnchor: 'T-3',
        mergeAnchor: 'T-9',
        createdByRun: 'R-2',
        createdAt: T,
        staleReason: null,
        proposedItemCount: 2,
        baseGitCommit: null,
      },
      {
        id: 'PF-2',
        status: 'STALE' as const,
        reason: '计划已变化，提案过期',
        necessity: '原基线依赖已移除',
        forkAnchor: 'T-3',
        mergeAnchor: 'T-3',
        createdByRun: 'R-1',
        createdAt: T - 1000,
        staleReason: '计划重排',
        proposedItemCount: 1,
        baseGitCommit: null,
      },
    ]
    const html = render(<FutureZone {...futureProps({ planForks, unresolvedPlanForkCount: 2 })} />)
    expect(html).toContain('未决 PlanFork')
    expect(html).toContain('未决 PlanFork：2')
    expect(html).toContain('PF-1')
    expect(html).toContain('待处理')
    expect(html).toContain('PF-2')
    expect(html).toContain('已陈旧')
    expect(html).toContain('计划缺少基线实验')
    expect(html).toContain('提案 2 项')
    expect(html).toContain('锚点 T-3 → T-9')
    // zero unresolved → NO badge at all (the strip stays clean)
    const none = render(<FutureZone {...futureProps({ planForks, unresolvedPlanForkCount: 0 })} />)
    expect(none).not.toContain('未决 PlanFork')
  })

  it('空态：计划为空 → No planned items；无 PF 徽章、无 strip 列表', () => {
    const html = render(<FutureZone {...futureProps({ planItems: [] })} />)
    expect(html).toContain('No planned items')
    expect(html).not.toContain('未决 PlanFork')
    expect(html).not.toContain('Add at start')
    expect(html).not.toContain('排序保存中')
    expect(html).not.toContain('排序失败')
  })

  it('reorder 提示行：pending = 排序保存中…；fault = 排序失败：{msg}', () => {
    const busy = render(<FutureZone {...futureProps({ reorderPending: true })} />)
    expect(busy).toContain('排序保存中…')

    const failed = render(<FutureZone {...futureProps({ reorderFault: '计划已被其他操作修改' })} />)
    expect(failed).toContain('排序失败：计划已被其他操作修改')
  })

  it('focus marker：只有被聚焦的 plan 行携带（B §20 / ADJ-11）', () => {
    const tree = FutureZone(futureProps({ focusedPlanItemId: 'G-1' }))
    const focusedRows = findHostElements(tree, el => el.props['data-plan-focus'] === 'true')
    expect(focusedRows.length).toBe(1)
    // the focused row is the G-1 row (its title sits in the row subtree)
    expect(
      findHostElements(focusedRows[0]!, el => hostElementText(el) === '数据完整性门').length,
    ).toBe(1)
    // no pointer → no marker anywhere
    const none = FutureZone(futureProps({ focusedPlanItemId: null }))
    expect(
      findHostElements(none, el => el.props['data-plan-focus'] === 'true').length,
    ).toBe(0)
  })

  it('Set as Current Focus：每行一个逐字按钮；点击上报该 item（B §20 verbatim）', () => {
    const onSetCurrentFocus = vi.fn()
    const tree = FutureZone(futureProps({ onSetCurrentFocus }))
    for (const item of PLAN_ITEMS) {
      expect(findByAriaLabel(tree, `Set as Current Focus: ${item.id}`).length).toBe(1)
    }
    // the VISIBLE text is the B §20 verbatim (the id rides the aria-label)
    const button = findByAriaLabel(tree, 'Set as Current Focus: T-9')[0]!
    expect(hostElementText(button)).toBe('Set as Current Focus')
    invokeClick(button)
    expect(onSetCurrentFocus).toHaveBeenCalledWith('T-9')
  })

  it('行点击 = 选中（data-strip-selected）→ onSelectItem；+ 槽位 → onOpenCreate(index)', () => {
    const onSelectItem = vi.fn()
    const onOpenCreate = vi.fn()
    const tree = FutureZone(futureProps({ selectedItemId: 'G-1', onSelectItem, onOpenCreate }))
    // the selected row carries the flag; the others do not
    const selected = findHostElements(tree, el => el.props['data-strip-selected'] === 'true')
    expect(selected).toHaveLength(1)
    expect(findHostElements(selected[0]!, el => hostElementText(el) === '数据完整性门').length).toBe(1)
    // row click selects (the row li carries the handler)
    invokeClick(findHostElements(tree, el => el.props['data-strip-item'] === 'G-1')[0]!)
    expect(onSelectItem).toHaveBeenCalledWith('G-1')
    // the head `+` slot asks for index 0; the per-row `+` asks for index i+1
    invokeClick(findHostElements(tree, el => el.props['data-strip-add-head'] === true)[0]!)
    expect(onOpenCreate).toHaveBeenCalledWith(0)
    invokeClick(findHostElements(tree, el => el.props['data-strip-add-after'] === 'T-9')[0]!)
    expect(onOpenCreate).toHaveBeenCalledWith(1)
  })

  it('ADJ-5 执行摘要：只有任务行显示 execution 徽章（client join，值 verbatim）', () => {
    const executionById = new Map<string, TaskExecution>([
      ['T-9', 'EXECUTED'],
      ['T-3', 'PAUSED'],
      ['G-1', 'ACTIVE'], // non-task — must NOT render
    ])
    const html = render(<FutureZone {...futureProps({ executionById })} />)
    expect(html).toContain('data-strip-exec="EXECUTED"')
    expect(html).toContain('data-strip-exec="PAUSED"')
    // the GATE row shows no badge even though the map carries G-1
    expect(html).not.toContain('data-strip-exec="ACTIVE"')
    // a task WITHOUT a join entry shows no badge (M-2 never joins)
    expect(html).not.toContain('data-strip-exec="PLANNED"')
  })

  it('三态 Remove（B §19.4 verbatim）：标签由 classifier 驱动，单 RPC', () => {
    const withHistory = new Map<string, TaskExecution>([['T-9', 'EXECUTED']])
    const tree = FutureZone(futureProps({ executionById: withHistory }))
    // TASK with execution history → "Drop planned item"
    const dropBtn = findByAriaLabel(tree, 'Drop planned item: T-9')[0]!
    expect(hostElementText(dropBtn)).toBe('Drop planned item')
    // fresh TASK + the GATE → "Remove from Future Plan"
    for (const id of ['T-3', 'G-1', 'M-2']) {
      const btn = findByAriaLabel(tree, `Remove from Future Plan: ${id}`)[0]!
      expect(hostElementText(btn)).toBe('Remove from Future Plan')
    }
    // click → onRemoveItem(id); removePending disables the buttons
    const onRemoveItem = vi.fn()
    const live = FutureZone(futureProps({ onRemoveItem }))
    invokeClick(findByAriaLabel(live, 'Remove from Future Plan: T-9')[0]!)
    expect(onRemoveItem).toHaveBeenCalledWith('T-9')
    const busy = FutureZone(futureProps({ removePending: true }))
    expect(findByAriaLabel(busy, 'Remove from Future Plan: T-9')[0]!.props.disabled).toBe(true)
  })

  it('classifier 单元：WITH_HISTORY 需要 execution 离开 PLANNED；v1 无 UNUSED 路径', () => {
    const task: PlanItemDto = { id: 'T-1', kind: 'TASK', title: 'x' }
    const gate: PlanItemDto = { id: 'G-1', kind: 'GATE', title: 'x' }
    expect(classifyRemoveState(task, new Map<string, TaskExecution>([['T-1', 'PLANNED']]))).toBe('IN_PLAN_FRESH')
    expect(classifyRemoveState(task, new Map<string, TaskExecution>([['T-1', 'EXECUTED']]))).toBe('IN_PLAN_WITH_HISTORY')
    // non-task kinds never carry history states
    expect(classifyRemoveState(gate, new Map<string, TaskExecution>([['G-1', 'EXECUTED']]))).toBe('IN_PLAN_FRESH')
    expect(hasExecutionHistory(undefined)).toBe(false)
    expect(hasExecutionHistory('PLANNED')).toBe(false)
    expect(hasExecutionHistory('CANCELLED')).toBe(true)
    // the three frozen keys are pinned (the unused-definition state is
    // RESERVED — no v1 kind/classifier path reaches it)
    expect(REMOVE_STATE_KEY.IN_PLAN_WITH_HISTORY).toBe('ws.future.remove.drop')
    expect(REMOVE_STATE_KEY.IN_PLAN_FRESH).toBe('ws.future.remove.fromPlan')
    expect(REMOVE_STATE_KEY.UNUSED_DEFINITION).toBe('ws.future.remove.deleteUnused')
  })

  it('Create 表单：内联渲染；空标题禁用 Save；kind 决定字段集', () => {
    const onCreateClose = vi.fn()
    const tree = FutureZone(
      futureProps({
        createForm: { kind: 'TASK', index: 0 },
        draft: newPlanItemDraft('TASK'),
        onCreateClose,
      }),
    )
    const form = findHostElements(tree, el => el.props['data-strip-form'] === true)[0]!
    expect(findHostElements(form, el => hostElementText(el) === 'Add to Future Plan').length).toBe(1)
    // the kind select defaults to TASK with the three options
    const kindSelect = findHostElements(form, el => el.props['data-strip-field'] === 'kind')[0]!
    expect(kindSelect.props.value).toBe('TASK')
    expect(findHostElements(kindSelect, el => el.type === 'option')).toHaveLength(3)
    // the TASK field set (title/goal/acceptanceCriteria/deliverables/note)
    for (const field of ['title', 'goal', 'acceptanceCriteria', 'deliverables', 'note']) {
      expect(findHostElements(form, el => el.props['data-strip-field'] === field)).toHaveLength(1)
    }
    // blank title → Save disabled
    expect(findHostElements(form, el => el.props['data-strip-form-save'] === true)[0]!.props.disabled).toBe(true)
    // a non-blank title enables it; a GATE draft swaps the field set
    const gateTree = FutureZone(
      futureProps({
        createForm: { kind: 'GATE', index: 1 },
        draft: { ...newPlanItemDraft('GATE'), title: '数据完整性门', criteria: 'c1' },
      }),
    )
    const gateForm = findHostElements(gateTree, el => el.props['data-strip-form'] === true)[0]!
    expect(findHostElements(gateForm, el => el.props['data-strip-field'] === 'criteria')).toHaveLength(1)
    expect(findHostElements(gateForm, el => el.props['data-strip-field'] === 'goal')).toHaveLength(0)
    expect(findHostElements(gateForm, el => el.props['data-strip-form-save'] === true)[0]!.props.disabled).toBe(false)
    // cancel closes the form
    invokeClick(findHostElements(form, el => el.props['data-strip-form-cancel'] === true)[0]!)
    expect(onCreateClose).toHaveBeenCalledTimes(1)
  })

  it('Edit 表单：选中行内联编辑（prefill 来自 editDraft）', () => {
    const onEditSubmit = vi.fn()
    const onEditClose = vi.fn()
    const editDraft = { ...newPlanItemDraft('TASK'), title: '收尾：整理实验记录', acceptanceCriteria: '可复现' }
    const tree = FutureZone(futureProps({ selectedItemId: 'T-9', editDraft, onEditSubmit, onEditClose }))
    const edit = findHostElements(tree, el => el.props['data-strip-edit'] === true)[0]!
    // the heading names the item id
    expect(findHostElements(edit, el => hostElementText(el) === 'Edit planned item · T-9').length).toBe(1)
    // the draft prefills the title field
    const titleInput = findHostElements(edit, el => el.props['data-strip-field'] === 'title')[0]!
    expect(titleInput.props.value).toBe('收尾：整理实验记录')
    // non-blank title → Save enabled; save/cancel forward to the page
    invokeClick(findHostElements(edit, el => el.props['data-strip-edit-save'] === true)[0]!)
    expect(onEditSubmit).toHaveBeenCalledTimes(1)
    invokeClick(findHostElements(edit, el => el.props['data-strip-edit-cancel'] === true)[0]!)
    expect(onEditClose).toHaveBeenCalledTimes(1)
    // blank title → Save disabled
    const blank = FutureZone(
      futureProps({ selectedItemId: 'T-9', editDraft: { ...newPlanItemDraft('TASK'), title: '  ' } }),
    )
    const blankEdit = findHostElements(blank, el => el.props['data-strip-edit'] === true)[0]!
    expect(findHostElements(blankEdit, el => el.props['data-strip-edit-save'] === true)[0]!.props.disabled).toBe(true)
    // no selection → no edit form at all (the page owns the selection)
    expect(findHostElements(FutureZone(futureProps()), el => el.props['data-strip-edit'] === true)).toHaveLength(0)
    expect(findHostElements(FutureZone(futureProps()), el => el.props['data-strip-form'] === true)).toHaveLength(0)
  })

  it('依赖面（B §17）：depends-on 可删 / depended-by 只读 / 空目标禁用 Add', () => {
    const onRemoveDependency = vi.fn()
    const onAddDependency = vi.fn()
    const editDraft = { ...newPlanItemDraft('TASK'), title: '收尾：整理实验记录' }
    const dependencyEdges: readonly DependencyEdgeDto[] = [
      { relationId: 'REL-1', sourceId: 'T-9', targetId: 'G-1' },
      { relationId: 'REL-2', sourceId: 'G-1', targetId: 'T-9' },
    ]
    const tree = FutureZone(
      futureProps({
        selectedItemId: 'T-9',
        editDraft,
        dependencyEdges,
        onRemoveDependency,
        onAddDependency,
      }),
    )
    // depends-on (outgoing REL-1 → G-1): the row names the target + a remove button
    const dependsOn = findHostElements(tree, el => el.props['data-dep-depends-on'] === true)[0]!
    const row1 = findHostElements(dependsOn, el => el.props['data-dep-edge'] === 'REL-1')[0]!
    expect(findHostElements(row1, el => hostElementText(el) === 'G-1')).toHaveLength(1)
    expect(findHostElements(row1, el => hostElementText(el) === '数据完整性门')).toHaveLength(1)
    invokeClick(findByAriaLabel(row1, 'Remove dependency: REL-1')[0]!)
    expect(onRemoveDependency).toHaveBeenCalledWith('REL-1')
    // depended-by (inbound REL-2 ← G-1): read-only (no remove button)
    const dependedBy = findHostElements(tree, el => el.props['data-dep-depended-by'] === true)[0]!
    const row2 = findHostElements(dependedBy, el => el.props['data-dep-edge'] === 'REL-2')[0]!
    expect(findHostElements(row2, el => hostElementText(el) === 'G-1')).toHaveLength(1)
    expect(findByAriaLabel(row2, 'Remove dependency: REL-2')).toHaveLength(0)
    // the add row: the target select lists every OTHER item (not T-9 itself)
    const addRow = findHostElements(tree, el => el.props['data-dep-add'] === true)[0]!
    const options = findHostElements(addRow, el => el.type === 'option')
    expect(options.map(o => o.props.value)).toEqual(['', 'G-1', 'M-2', 'T-3'])
    // empty target → Add disabled; a chosen target enables it
    expect(findHostElements(addRow, el => el.props['data-dep-add-button'] === true)[0]!.props.disabled).toBe(true)
    const ready = FutureZone(futureProps({ selectedItemId: 'T-9', editDraft, dependencyEdges, depTargetId: 'G-1', onAddDependency }))
    invokeClick(findHostElements(ready, el => el.props['data-dep-add-button'] === true)[0]!)
    expect(onAddDependency).toHaveBeenCalledTimes(1)
  })

  it('依赖面空态：选中项无出入依赖 → No dependencies', () => {
    const editDraft = { ...newPlanItemDraft('TASK'), title: '收尾：整理实验记录' }
    const tree = FutureZone(futureProps({ selectedItemId: 'T-9', editDraft }))
    const edit = findHostElements(tree, el => el.props['data-strip-edit'] === true)[0]!
    expect(findHostElements(edit, el => hostElementText(el) === 'No dependencies')).toHaveLength(1)
    expect(findHostElements(edit, el => el.props['data-dep-depends-on'] === true)).toHaveLength(0)
  })

  it('fault 行：create/edit/remove/dep 各自的 verbatim 前缀', () => {
    const editDraft = { ...newPlanItemDraft('TASK'), title: '收尾：整理实验记录' }
    const html = render(
      <FutureZone
        {...futureProps({
          createForm: { kind: 'TASK', index: 0 },
          createFault: 'SCHEMA_VIOLATION',
          selectedItemId: 'T-9',
          editDraft,
          updateFault: 'STALE_ORDER',
          removeFault: 'PLAN_REORDERED',
          addDependencyFault: 'DEPENDENCY_EXISTS',
        })}
      />,
    )
    expect(html).toContain('Create failed：SCHEMA_VIOLATION')
    expect(html).toContain('Save failed：STALE_ORDER')
    expect(html).toContain('Remove failed：PLAN_REORDERED')
    expect(html).toContain('Dependency change failed：DEPENDENCY_EXISTS')
  })
})

/* ==================================================================== *
 * HistoryZone
 * ==================================================================== */

describe('HistoryZone（历史入口）', () => {
  it('渲染 WS 级事件摘要入口（eventCount + 时间线入口）', () => {
    const html = render(<HistoryZone eventCount={12} onOpenHistory={() => undefined} />)
    expect(html).toContain('历史')
    expect(html).toContain('历史事件：12 条')
    expect(html).toContain('查看事件时间线')
  })

  it('点击入口按钮触发 onOpenHistory 回调', () => {
    const onOpenHistory = vi.fn()
    const tree = HistoryZone({ eventCount: 12, onOpenHistory })
    const entry = findByHostText(tree, '查看事件时间线')
    expect(entry.length).toBe(1)
    expect(hostElementText(entry[0]!)).toBe('查看事件时间线')
    invokeClick(entry[0]!)
    expect(onOpenHistory).toHaveBeenCalledTimes(1)
  })

  it('空态：事件数为 0 时无入口按钮', () => {
    const html = render(<HistoryZone eventCount={0} onOpenHistory={() => undefined} />)
    expect(html).toContain('暂无历史事件')
    expect(html).not.toContain('查看事件时间线')
  })
})
