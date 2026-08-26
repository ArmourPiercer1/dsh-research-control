// @vitest-environment jsdom
/**
 * V2-T5.3 — 调查员页重定位 component tests (design §7.3, A 案 — the ASCII
 * layout is the spec; the machinery is the V1-accepted channel REPOSITIONED).
 *
 * Plain stub props — no real cordis in the component spec (the views-*
 * test pattern). The three analysis faces (`readTransient` /
 * `loadRecords` / `saveRecord`) are vi.fn stubs per case; the DTOs are
 * plain interface values (the client display types, no wire schema —
 * the host is the shape authority on the wire side).
 *
 * Gate coverage (plan P5 T5.3 — 组件测试 引导条常驻/溯源链渲染/过滤 +
 * the task's four assertions):
 *  - 只读引导条: ALWAYS rendered at the top of the page (every role) —
 *    the HUB role carries the §7.3 portfolio/neutral copy verbatim, the
 *    project roles the 页面身份 variant;
 *  - 溯源链: a record with a chain renders record ← sourceRef ←
 *    investigator session (the intervention piece is a clickable 反链 →
 *    `onOpenIntervention`; the session piece re-binds → `onBindSession`);
 *    a null session piece renders the honest （无会话指针） text;
 *  - 对象类型过滤: the segments = 全部 + the kinds PRESENT (frozen
 *    OBJECT_KINDS order, 中文 labels) — a kind click NARROWS the list,
 *    全部 restores; a filtered-empty group renders its own copy;
 *  - 绑定来源行: the bound session + the launching intervention 反链
 *    (click → `onOpenIntervention`) + 解绑 (click → `onUnbind`);
 *    unbound renders the honest 未绑定 face (no fake binding row);
 *  - 瞬态面板收缩: the status bar shows the run status (the §1.4 词表
 *    labels) + 已产出 N 条分析 + the 转录指引 + the explicit-save entry;
 *    the 保存对话框 prefill (binding's INTERVENTION sourceRef + the
 *    bound session id) and the confirm → `saveRecord` → 成功 chip +
 *    host-truth RE-FETCH (the V1 显式保存 discipline, unchanged);
 *  - fault faces: records list rejection → the 数据面不可用 line (fail
 *    loud); transient rejection → the status-bar fault line.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { act } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import type {
  AnalysisRecordDto,
  InvestigatorTransientDto,
  SaveAnalysisRecordArgs,
} from '../../src/shared/analysis-command.js'
import {
  InvestigatorPage,
  type InvestigatorBinding,
  type InvestigatorPageProps,
} from '../../src/client/views/shell/investigator-page.js'

/* -------------------------------------------------------------------- *
 * Fixtures (plain DTO values — the client display types)
 * -------------------------------------------------------------------- */

const BOUND_SID = 'investigator-abc-123'

function recordDto(overrides: Partial<AnalysisRecordDto> = {}): AnalysisRecordDto {
  return {
    id: 'AN-1',
    sourceRef: { kind: 'INTERVENTION', id: 'IV-3' },
    investigatorRunId: 'R-81',
    dshSessionId: BOUND_SID,
    content: '标定漂移分析：主标定管线连续分叉，漂移量超阈值。',
    createdAt: 1_700_000_000_900,
    ...overrides,
  }
}

function transientDto(overrides: Partial<InvestigatorTransientDto> = {}): InvestigatorTransientDto {
  return {
    sessionId: BOUND_SID,
    session: { id: BOUND_SID, cwd: '/workspace/tree-ws', title: '调查会话', running: true, createdAt: 1_700_000_000_100 },
    pointer: { workstreamId: 'WS-1', taskId: 'T-3', intent: 'explain IV-3', lastSeq: 7, runId: 'R-81', runStartedAt: 1_700_000_000_100 },
    run: { id: 'R-81', workstreamId: 'WS-1', status: 'RUNNING', startedAt: 1_700_000_000_100, endedAt: null },
    ...overrides,
  }
}

const BINDING: InvestigatorBinding = {
  sessionId: BOUND_SID,
  interventionId: 'IV-3',
  interventionTitle: '标定管线阻塞',
}

/** Build the page stub props (vi.fn faces per case). */
function makeProps(overrides: Partial<InvestigatorPageProps> = {}): InvestigatorPageProps {
  return {
    role: 'HUB',
    binding: null,
    onUnbind: vi.fn(),
    onOpenIntervention: vi.fn(),
    onBindSession: vi.fn(),
    readTransient: vi.fn(async (_target: string): Promise<InvestigatorTransientDto> => transientDto()),
    loadRecords: vi.fn(async (): Promise<readonly AnalysisRecordDto[]> => [recordDto()]),
    saveRecord: vi.fn(async (): Promise<AnalysisRecordDto> => recordDto({ id: 'AN-2' })),
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
})

/* -------------------------------------------------------------------- *
 * 只读引导条 (design §7.3 — 常驻, never dismissed)
 * -------------------------------------------------------------------- */

describe('只读引导条 (resident guide bar)', () => {
  test('is ALWAYS rendered — the HUB role carries the §7.3 copy verbatim', async () => {
    render(<InvestigatorPage {...makeProps({ binding: null })} />)
    const guide = screen.getByRole('note')
    expect(guide.textContent).toContain('中枢工作区的会话是只读观察位')
    expect(guide.hasAttribute('data-investigator-guide')).toBe(true)
    expect(guide.getAttribute('data-guide-role')).toBe('HUB')
    expect(guide.textContent).toContain('深度调查请用「一键调查」启动专职调查会话')
    await waitFor(() => expect(screen.getByText(/已保存记录（1）/)).not.toBeNull())
  })

  test('is rendered for the project roles with the 页面身份 framing (project-scoped)', async () => {
    for (const role of ['MANAGED', 'STANDALONE'] as const) {
      cleanup()
      render(<InvestigatorPage {...makeProps({ role, binding: null })} />)
      const guide = screen.getByRole('note')
      expect(guide.textContent).toMatch(/调查员页只做调查管理 \+ 分析记录沉淀/)
      expect(guide.getAttribute('data-guide-role')).toBe(role)
      // The guide bar is present in EVERY state (bound or not):
      await waitFor(() => expect(screen.getByText(/已保存记录（1）/)).not.toBeNull())
      expect(screen.getByRole('note')).not.toBeNull()
    }
  })

  test('stays visible while bound (常驻 — no dismiss affordance)', async () => {
    render(<InvestigatorPage {...makeProps({ binding: BINDING })} />)
    await waitFor(() => expect(screen.getByText(/已保存记录（1）/)).not.toBeNull())
    expect(screen.getByRole('note')).not.toBeNull()
  })
})

/* -------------------------------------------------------------------- *
 * 绑定来源行 (the bound session + intervention 反链 + 解绑)
 * -------------------------------------------------------------------- */

describe('绑定来源行 (binding row)', () => {
  test('shows the bound session, the intervention 反链, and 解绑 fires its callback', async () => {
    const onOpenIntervention = vi.fn()
    const onUnbind = vi.fn()
    render(<InvestigatorPage {...makeProps({ binding: BINDING, onOpenIntervention, onUnbind })} />)

    const binding = screen.getByText('绑定会话:')
    expect(binding).not.toBeNull()
    const container = binding.closest('[data-investigator-binding]')
    expect(container).not.toBeNull()
    expect(container.getAttribute('data-investigator-binding')).toBe(BOUND_SID)
    expect(within(container as HTMLElement).getByText(BOUND_SID)).not.toBeNull()

    // The 反链 carries the launching intervention (id + title) and jumps
    // to 重要事件.
    const link = within(container as HTMLElement).getByRole('button', { name: /来自 IV-3 标定管线阻塞/ })
    expect(link.getAttribute('data-binding-intervention')).toBe('IV-3')
    fireEvent.click(link)
    expect(onOpenIntervention).toHaveBeenCalledTimes(1)
    expect(onOpenIntervention).toHaveBeenCalledWith('IV-3')

    // 解绑 fires its callback.
    fireEvent.click(within(container as HTMLElement).getByRole('button', { name: '解绑' }))
    expect(onUnbind).toHaveBeenCalledTimes(1)
  })

  test('unbound renders the honest 未绑定 face — NO binding row, NO status bar', async () => {
    const readTransient = vi.fn()
    render(<InvestigatorPage {...makeProps({ binding: null, readTransient })} />)
    await waitFor(() => expect(screen.getByText(/未绑定调查会话/)).not.toBeNull())
    expect(screen.queryByText('绑定会话:')).toBeNull()
    expect(screen.queryByRole('button', { name: '保存为 AnalysisRecord' })).toBeNull()
    // The readTransient face is NEVER called without a binding (no fake
    // snapshot for a session that does not exist).
    expect(readTransient).not.toHaveBeenCalled()
  })

  test('a binding without an intervention origin renders the session only (no fake 反链)', async () => {
    render(
      <InvestigatorPage
        {...makeProps({ binding: { sessionId: BOUND_SID, interventionId: null, interventionTitle: null } })}
      />,
    )
    const container = screen.getByText('绑定会话:').closest('[data-investigator-binding]') as HTMLElement
    expect(container).not.toBeNull()
    expect(container.querySelector('[data-binding-intervention]')).toBeNull()
  })
})

/* -------------------------------------------------------------------- *
 * 瞬态面板收缩 = 状态条 (run status + 已产出 + 转录指引 + save entry)
 * -------------------------------------------------------------------- */

describe('状态条 (collapsed transient panel)', () => {
  test('shows the run status label, the produced count, and the 转录指引', async () => {
    const readTransient = vi.fn(async (_t: string): Promise<InvestigatorTransientDto> => transientDto())
    render(
      <InvestigatorPage
        {...makeProps({
          binding: BINDING,
          readTransient,
          loadRecords: vi.fn(async (): Promise<readonly AnalysisRecordDto[]> => [
            recordDto(),
            recordDto({ id: 'AN-2', dshSessionId: BOUND_SID }),
            recordDto({ id: 'AN-3', dshSessionId: 'investigator-other' }),
          ]),
        })}
      />,
    )
    await waitFor(() => expect(screen.getByText('运行中')).not.toBeNull())
    // The status bar carries the label (meaningful text, primary band).
    const label = screen.getByText('运行中')
    expect(label.getAttribute('data-status-label')).toBe('运行中')
    // 已产出 counts the bound session's records (AN-1 + AN-2, not AN-3).
    expect(screen.getByText('已产出 2 条分析').getAttribute('data-produced-count')).toBe('2')
    // The 转录指引 (the copy steering the user to the explicit save).
    expect(screen.getByText(/完整转录由宿主会话界面承载/)).not.toBeNull()
    expect(readTransient).toHaveBeenCalledTimes(1)
    expect(readTransient).toHaveBeenCalledWith(BOUND_SID)
  })

  test('maps the frozen RunStatus 词表 (已完成 / 失败 / 已取消)', async () => {
    for (const [status, label] of [
      ['FINISHED', '已完成'],
      ['FAILED', '失败'],
      ['CANCELLED', '已取消'],
    ] as const) {
      cleanup()
      // (The stub is hoisted OUT of the JSX spread attribute: a next-line
      // arrow body in that position trips a TSX parse edge case.)
      const readTransient = vi.fn(async (_t: string): Promise<InvestigatorTransientDto> =>
        transientDto({ run: { id: 'R-1', workstreamId: 'WS-1', status, startedAt: 1, endedAt: null } }),
      )
      render(
        <InvestigatorPage
          {...makeProps({
            binding: BINDING,
            readTransient,
          })}
        />,
      )
      await waitFor(() => expect(screen.getByText(label)).not.toBeNull())
    }
  })

  test('a disposed session (session === null) stays HONEST', async () => {
    render(
      <InvestigatorPage
        {...makeProps({
          binding: BINDING,
          readTransient: vi.fn(async (_t: string): Promise<InvestigatorTransientDto> => transientDto({ session: null })),
        })}
      />,
    )
    await waitFor(() => expect(screen.getByText('会话已不在 live 列表（可能已 dispose）')).not.toBeNull())
  })

  test('the save entry opens the V1 保存对话框 with the binding prefill', async () => {
    render(<InvestigatorPage {...makeProps({ binding: BINDING })} />)
    await waitFor(() => expect(screen.getByText('运行中')).not.toBeNull())
    fireEvent.click(screen.getByRole('button', { name: '保存为 AnalysisRecord' }))

    const dialog = await screen.findByRole('dialog')
    // sourceRef prefill: the binding's INTERVENTION (kind select + id
    // input — the V1 dialog, unchanged).
    const kindSelect = within(dialog).getByDisplayValue('INTERVENTION') as HTMLSelectElement
    expect(kindSelect).toBeTruthy()
    const idInput = within(dialog).getByPlaceholderText('IV-5') as HTMLInputElement
    expect(idInput.value).toBe('IV-3')
    // dshSessionId prefill = the bound session (the V1 initialSaveField-
    // Values discipline, unchanged — the placeholder is the static
    // `investigator-<uuid>` hint, the VALUE carries the session id).
    const sessionInput = within(dialog).getByPlaceholderText('investigator-<uuid>') as HTMLInputElement
    expect(sessionInput.value).toBe(BOUND_SID)
  })

  test('confirm runs saveRecord and re-fetches the host truth (no local patch)', async () => {
    const saveRecord = vi.fn(async (_args: SaveAnalysisRecordArgs): Promise<AnalysisRecordDto> => recordDto({ id: 'AN-2' }))
    const loadRecords = vi.fn(async (): Promise<readonly AnalysisRecordDto[]> => [recordDto()])
    const props = makeProps({ binding: BINDING, saveRecord, loadRecords })
    render(<InvestigatorPage {...props} />)
    await waitFor(() => expect(screen.getByText('运行中')).not.toBeNull())
    fireEvent.click(screen.getByRole('button', { name: '保存为 AnalysisRecord' }))
    const dialog = await screen.findByRole('dialog')

    const content = within(dialog).getByPlaceholderText('investigator 分析内容（从会话中摘录 / 整理）') as HTMLTextAreaElement
    fireEvent.change(content, { target: { value: '调查结论：漂移量超阈值，需重新标定。' } })
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: '确认保存' }))
    })

    await waitFor(() => expect(saveRecord).toHaveBeenCalledTimes(1))
    const savedArgs = saveRecord.mock.calls[0]![0] as SaveAnalysisRecordArgs
    expect(savedArgs.sourceRef).toEqual({ kind: 'INTERVENTION', id: 'IV-3' })
    expect(savedArgs.content).toBe('调查结论：漂移量超阈值，需重新标定。')
    expect(savedArgs.dshSessionId).toBe(BOUND_SID)
    expect(savedArgs.investigatorRunId).toBe('R-81')
    // Success: 成功 chip (AN-2 — the id rides a nested span) + the
    // RE-FETCH (the host is the truth).
    await waitFor(() => expect(screen.getByText('AN-2')).not.toBeNull())
    await waitFor(() => expect(loadRecords).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  test('a save rejection keeps the dialog open with the fault (the host wrote nothing)', async () => {
    render(
      <InvestigatorPage
        {...makeProps({
          binding: BINDING,
          saveRecord: vi.fn(async (): Promise<AnalysisRecordDto> => {
            throw new Error('[AN_INPUT] content 必填')
          }),
        })}
      />,
    )
    await waitFor(() => expect(screen.getByText('运行中')).not.toBeNull())
    fireEvent.click(screen.getByRole('button', { name: '保存为 AnalysisRecord' }))
    const dialog = await screen.findByRole('dialog')
    const content = within(dialog).getByPlaceholderText('investigator 分析内容（从会话中摘录 / 整理）') as HTMLTextAreaElement
    fireEvent.change(content, { target: { value: '结论' } })
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: '确认保存' }))
    })
    await waitFor(() => expect(within(dialog).getByText(/\[AN_INPUT\] content 必填/)).not.toBeNull())
    expect(dialog).not.toBeNull()
  })
})

/* -------------------------------------------------------------------- *
 * 记录列表 (溯源链 + 对象类型过滤)
 * -------------------------------------------------------------------- */

describe('记录列表 (provenance chain + object-type filter)', () => {
  const THREE_KINDS: readonly AnalysisRecordDto[] = [
    recordDto({ id: 'AN-1', sourceRef: { kind: 'INTERVENTION', id: 'IV-3' } }),
    recordDto({ id: 'AN-2', sourceRef: { kind: 'FACT', id: 'F-7' }, dshSessionId: 'investigator-other' }),
    recordDto({ id: 'AN-3', sourceRef: { kind: 'CLAIM', id: 'C-2' }, dshSessionId: null }),
  ]

  test('renders the 溯源链 for a record with a chain (record ← sourceRef ← session, both clickable)', async () => {
    const onOpenIntervention = vi.fn()
    const onBindSession = vi.fn()
    render(
      <InvestigatorPage
        {...makeProps({
          binding: BINDING,
          onOpenIntervention,
          onBindSession,
          loadRecords: vi.fn(async (): Promise<readonly AnalysisRecordDto[]> => [
            recordDto({ id: 'AN-12', sourceRef: { kind: 'INTERVENTION', id: 'IV-3' }, dshSessionId: 'investigator-2026' }),
          ]),
        })}
      />,
    )

    const item = await screen.findByText('AN-12')
    const row = item.closest('[data-record-id]') as HTMLElement
    expect(row).not.toBeNull()
    expect(row.getAttribute('data-record-id')).toBe('AN-12')

    const ivLink = within(row).getByRole('button', { name: '← IV-3' })
    expect(ivLink.getAttribute('data-record-iv')).toBe('IV-3')
    const sessionLink = within(row).getByRole('button', { name: '← investigator-2026' })
    expect(sessionLink.getAttribute('data-record-session')).toBe('investigator-2026')

    // The chain is CLICKABLE: the intervention piece jumps to 重要事件,
    // the session piece re-binds the page (with the record's sourceRef).
    fireEvent.click(ivLink)
    expect(onOpenIntervention).toHaveBeenCalledWith('IV-3')
    fireEvent.click(sessionLink)
    expect(onBindSession).toHaveBeenCalledWith('investigator-2026', { kind: 'INTERVENTION', id: 'IV-3' })
  })

  test('a record with a non-intervention sourceRef renders the labeled chain piece (still present, honestly)', async () => {
    render(
      <InvestigatorPage
        {...makeProps({
          loadRecords: vi.fn(async (): Promise<readonly AnalysisRecordDto[]> => [
            recordDto({ id: 'AN-1', sourceRef: { kind: 'FACT', id: 'F-7' }, dshSessionId: null }),
          ]),
        })}
      />,
    )
    await waitFor(() => expect(screen.getByText('AN-1')).not.toBeNull())
    const row = screen.getByText('AN-1').closest('[data-record-id]') as HTMLElement
    // 事实 is the 中文 label of the FACT kind (SOURCE_REF_KIND_LABEL).
    expect(within(row).getByText('← 事实 F-7')).not.toBeNull()
    expect(within(row).getByText('← （无会话指针）')).not.toBeNull()
    expect(row.querySelector('[data-record-iv]')).toBeNull()
    expect(row.querySelector('[data-record-session]')).toBeNull()
  })

  test('the 对象类型过滤 segments narrow the list (全部 restores)', async () => {
    render(<InvestigatorPage {...makeProps({ loadRecords: vi.fn(async (): Promise<readonly AnalysisRecordDto[]> => THREE_KINDS) })} />)

    await waitFor(() => expect(screen.getByText('已保存记录（3）')).not.toBeNull())
    // Segments = 全部 + the kinds PRESENT, in frozen OBJECT_KINDS order
    // (INTERVENTION before CLAIM before FACT in the 词表 — verify the
    // rendered labels, not the internal order).
    for (const label of ['全部', '干预', '主张', '事实']) {
      expect(screen.getByRole('button', { name: label })).not.toBeNull()
    }
    // All three rows visible by default.
    for (const id of ['AN-1', 'AN-2', 'AN-3']) {
      expect(screen.getByText(id)).not.toBeNull()
    }

    // 事实 → only AN-2.
    fireEvent.click(screen.getByRole('button', { name: '事实' }))
    expect(screen.getByText('AN-2')).not.toBeNull()
    expect(screen.queryByText('AN-1')).toBeNull()
    expect(screen.queryByText('AN-3')).toBeNull()

    // 主张 → only AN-3.
    fireEvent.click(screen.getByRole('button', { name: '主张' }))
    expect(screen.getByText('AN-3')).not.toBeNull()
    expect(screen.queryByText('AN-2')).toBeNull()

    // 全部 → all three again.
    fireEvent.click(screen.getByRole('button', { name: '全部' }))
    for (const id of ['AN-1', 'AN-2', 'AN-3']) {
      expect(screen.getByText(id)).not.toBeNull()
    }
  })

  test('the record count shows the TOTAL (the filter narrows the rows, not the count)', async () => {
    render(<InvestigatorPage {...makeProps({ loadRecords: vi.fn(async (): Promise<readonly AnalysisRecordDto[]> => THREE_KINDS) })} />)
    await waitFor(() => expect(screen.getByText('已保存记录（3）')).not.toBeNull())
    fireEvent.click(screen.getByRole('button', { name: '事实' }))
    expect(screen.getByText('已保存记录（3）')).not.toBeNull()
  })

  test('an empty list renders the honest empty copy (零记录 — no fake rows)', async () => {
    render(<InvestigatorPage {...makeProps({ loadRecords: vi.fn(async (): Promise<readonly AnalysisRecordDto[]> => []) })} />)
    await waitFor(() => expect(screen.getByText(/暂无已保存的分析记录/)).not.toBeNull())
    expect(screen.queryByText('AN-1')).toBeNull()
  })
})

/* -------------------------------------------------------------------- *
 * Fault faces (fail loud — the 数据面 never fakes an empty state)
 * -------------------------------------------------------------------- */

describe('fault faces', () => {
  test('a records-list rejection renders the 数据面不可用 line (no fake empty list)', async () => {
    render(
      <InvestigatorPage
        {...makeProps({
          loadRecords: vi.fn(async (): Promise<readonly AnalysisRecordDto[]> => {
            throw new Error('commands 载包通道: 命令未在宿主命令注册表（多项目平面 — 无命令绑定）')
          }),
        })}
      />,
    )
    await waitFor(() =>
      expect(screen.getByText(/分析数据面不可用/).textContent).toContain('命令未在宿主命令注册表'),
    )
    expect(screen.queryByText(/暂无已保存的分析记录/)).toBeNull()
  })

  test('a transient rejection renders the status-bar fault line', async () => {
    render(
      <InvestigatorPage
        {...makeProps({
          binding: BINDING,
          readTransient: vi.fn(async (_t: string): Promise<InvestigatorTransientDto> => {
            throw new Error('transient 读取失败: [AN_CHANNEL] 会话缺席')
          }),
        })}
      />,
    )
    await waitFor(() => expect(screen.getByText(/调查会话状态读取失败/).textContent).toContain('transient 读取失败'))
  })
})
