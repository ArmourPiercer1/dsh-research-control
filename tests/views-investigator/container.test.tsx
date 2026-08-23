// @vitest-environment jsdom
/**
 * WP-7.3 — transient investigator 容器（React 面装配点 — 真 store + 真
 * 组件树; 同 views-inbox container 测试纪律）:
 *
 *  - 挂载后经 use-analysis-slice 惰性加载 transient + records 切片
 *    （in-flight 去重 — StrictMode 双载只一取）;
 *  - transient 面板**只读渲染**（三行数据 + transient 徽标 + 缺席态
 *    文案 — 不虚构）;
 *  - fail-loud 面: NOT_WIRED（缺省 provider）⇒ transient 区 error
 *    role=alert 点名 13-RPC 缺口（绝不伪造数据）;
 *  - **保存流（任务书目标 3: 按钮 → 确认对话框 → 保存）**:
 *    「保存为 AnalysisRecord」按钮 → 对话框（sourceRef/run/session 预填
 *    自 transient 快照 + 启动上下文）→ 空 content 时确认禁用 → 填内容
 *    → 确认 ⇒ provider.saveAnalysisRecord 收到正确载荷（sourceRef 预填 /
 *    dshSessionId = 会话指针 / run = 快照 run）⇒ 对话框关闭 + 成功 chip +
 *    records 切片自动刷新（宿主是数据真值）;
 *  - 取消 ⇒ 零调用; 保存失败 ⇒ 错误行 + 对话框保留（不吞错）;
 *  - 未接线 ⇒ 保存按钮禁用（title 点名缺口 — 不静默）。
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import type { AnalysisDataProvider, AnalysisRecordDto, InvestigatorTransientDto } from '../../src/client/stores/analysis-slice.js'
import { createAnalysisSliceStore } from '../../src/client/stores/analysis-slice.js'
import { InvestigatorViewContainer } from '../../src/client/views/investigator/investigator-container.js'

const SID = 'investigator-test-session-1'

afterEach(cleanup)

function transientDto(overrides: Partial<InvestigatorTransientDto> = {}): InvestigatorTransientDto {
  return {
    sessionId: SID,
    session: { id: SID, cwd: '/home/armourpiercer/projects/demo', title: 'investigate IV-5', running: true, createdAt: 1_699_999_999_500 },
    pointer: { workstreamId: 'WS-1', taskId: 'T-3', intent: 'explain IV-5', lastSeq: 7, runId: 'R-81', runStartedAt: 1_700_000_000_100 },
    run: { id: 'R-81', workstreamId: 'WS-1', status: 'RUNNING', startedAt: 1_700_000_000_100, endedAt: null },
    ...overrides,
  }
}

function recordDto(overrides: Partial<AnalysisRecordDto> = {}): AnalysisRecordDto {
  return {
    id: 'AN-1',
    sourceRef: { kind: 'INTERVENTION', id: 'IV-5' },
    investigatorRunId: 'R-81',
    dshSessionId: SID,
    content: '保存的分析内容',
    createdAt: 1_700_000_000_900,
    ...overrides,
  }
}

interface SaveCallArgs {
  readonly sourceRef: { readonly kind: string; readonly id: string }
  readonly content: string
  readonly investigatorRunId?: string
  readonly dshSessionId?: string
}

function makeProvider(overrides: Partial<AnalysisDataProvider> = {}): AnalysisDataProvider & {
  saveCalls: SaveCallArgs[]
  readonly listCalls: number
  readCalls: string[]
} {
  const saveCalls: SaveCallArgs[] = []
  const readCalls: string[] = []
  let listCalls = 0
  let records: readonly AnalysisRecordDto[] = []
  return {
    saveCalls,
    readCalls,
    get listCalls() {
      return listCalls
    },
    async readTransient(sessionId) {
      readCalls.push(sessionId)
      if (overrides.readTransient !== undefined) return overrides.readTransient(sessionId)
      return transientDto()
    },
    async listAnalysisRecords() {
      listCalls += 1
      if (overrides.listAnalysisRecords !== undefined) return overrides.listAnalysisRecords()
      return records
    },
    async saveAnalysisRecord(args) {
      saveCalls.push({ ...args, sourceRef: { ...args.sourceRef } })
      if (overrides.saveAnalysisRecord !== undefined) return overrides.saveAnalysisRecord(args)
      records = [...records, recordDto({ content: args.content })]
      return records[records.length - 1]!
    },
  }
}

async function mountWithTransient(): Promise<void> {
  await waitFor(() => expect(screen.getByText(/transient — 未落盘/)).not.toBeNull())
}

describe('挂载与惰性加载', () => {
  it('挂载后加载 transient + records（StrictMode 双载只一取 — in-flight 去重）', async () => {
    const provider = makeProvider()
    render(
      <StrictMode>
        <InvestigatorViewContainer store={createAnalysisSliceStore({ dataProvider: provider })} sessionId={SID} />
      </StrictMode>,
    )
    await mountWithTransient()
    expect(provider.readCalls).toEqual([SID])
    expect(provider.listCalls).toBe(1)
  })

  it('NOT_WIRED（缺省 provider）⇒ transient 区 error role=alert 点名 13-RPC（绝不伪造数据）', async () => {
    render(<InvestigatorViewContainer store={createAnalysisSliceStore()} sessionId={SID} />)
    await waitFor(() => {
      const alerts = screen.getAllByRole('alert').map((a) => a.textContent ?? '')
      expect(alerts.some((t) => t.includes('13-RPC'))).toBe(true)
    })
    expect(screen.queryByText(/运行中/)).toBeNull()
  })
})

describe('transient 面板只读渲染（缺席态诚实透出）', () => {
  it('三行齐: 会话/绑定/Run + transient 徽标 + 已保存空区', async () => {
    render(
      <InvestigatorViewContainer
        store={createAnalysisSliceStore({ dataProvider: makeProvider() })}
        sessionId={SID}
        sourceRef={{ kind: 'INTERVENTION', id: 'IV-5' }}
      />,
    )
    await mountWithTransient()
    // transient 徽标 + 面板头。
    expect(screen.getByText(/transient — 未落盘/)).not.toBeNull()
    // 会话行（运行中 — 会话徽标与 run 状态徽标同词, 计数 ≥1 即可）+ 标题 + cwd。
    expect(screen.getAllByText('运行中').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/investigate IV-5/)).not.toBeNull()
    expect(screen.getByText(/\/home\/armourpiercer\/projects\/demo/)).not.toBeNull()
    // 绑定行（指针面 — workstream + run + 事件指针）。
    expect(screen.getByText(/事件指针 seq=7/)).not.toBeNull()
    expect(screen.getAllByText('WS-1').length).toBeGreaterThanOrEqual(1)
    // Run 行（R-81 至少出现于指针/Run 行 — 精确计数不固定, 存在即可）。
    expect(screen.getAllByText('R-81').length).toBeGreaterThanOrEqual(1)
    // 已保存空区（计数 0）。
    expect(screen.getByText(/尚无保存/)).not.toBeNull()
    expect(screen.getByText(/已保存的 AnalysisRecord（0）/)).not.toBeNull()
  })

  it('指针缺席 ⇒ 「未绑定 workstream」文案（不虚构绑定）', async () => {
    render(
      <InvestigatorViewContainer
        store={createAnalysisSliceStore({
          dataProvider: makeProvider({ readTransient: async () => transientDto({ pointer: null }) }),
        })}
        sessionId={SID}
      />,
    )
    await waitFor(() => expect(screen.getByText(/未绑定 workstream/)).not.toBeNull())
  })

  it('会话缺席（已 dispose）⇒ 「不在 live 列表」文案', async () => {
    render(
      <InvestigatorViewContainer
        store={createAnalysisSliceStore({
          dataProvider: makeProvider({ readTransient: async () => transientDto({ session: null }) }),
        })}
        sessionId={SID}
      />,
    )
    await waitFor(() => expect(screen.getAllByText(/不在 live 列表/).length).toBeGreaterThanOrEqual(1))
  })
})

describe('保存流（按钮 → 确认对话框 → 保存 — 用户显式, INV-PERM-3 落地面）', () => {
  it('对话框预填（sourceRef 来自启动上下文; run/session 来自 transient 快照）', async () => {
    render(
      <InvestigatorViewContainer
        store={createAnalysisSliceStore({ dataProvider: makeProvider() })}
        sessionId={SID}
        sourceRef={{ kind: 'INTERVENTION', id: 'IV-5' }}
      />,
    )
    await mountWithTransient()
    fireEvent.click(screen.getByRole('button', { name: /保存为 AnalysisRecord/ }))
    const dialog = await screen.findByRole('dialog')
    // 预填断言（DOM 面）。
    const select = dialog.querySelector('select') as HTMLSelectElement
    expect(select.value).toBe('INTERVENTION')
    const inputs = Array.from(dialog.querySelectorAll('input[type="text"]')) as HTMLInputElement[]
    expect(inputs[0]?.value).toBe('IV-5') // sourceRef.id
    expect(inputs[1]?.value).toBe('R-81') // investigatorRunId（快照 run 预填）
    expect(inputs[2]?.value).toBe(SID) // dshSessionId（launcher 会话指针预填）
    // content 空 ⇒ 确认禁用。
    expect((within(dialog).getByRole('button', { name: /确认保存/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('完整保存流: 填 content → 确认 ⇒ provider 收到正确载荷 + 对话框关闭 + 成功 chip + 列表刷新', async () => {
    const provider = makeProvider()
    render(
      <InvestigatorViewContainer
        store={createAnalysisSliceStore({ dataProvider: provider })}
        sessionId={SID}
        sourceRef={{ kind: 'INTERVENTION', id: 'IV-5' }}
      />,
    )
    await mountWithTransient()
    fireEvent.click(screen.getByRole('button', { name: /保存为 AnalysisRecord/ }))
    const dialog = await screen.findByRole('dialog')

    // 填 content（必填 — 之前确认按钮禁用, 填入后启用）。
    fireEvent.change(within(dialog).getByPlaceholderText(/investigator 分析内容/), {
      target: { value: '## 结论\n\n3 个未注册 CSV 属于 T-3 产物。' },
    })
    const confirm = within(dialog).getByRole('button', { name: /确认保存/ }) as HTMLButtonElement
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)

    // provider 收到正确载荷（预填 + 用户内容 — 宿主 UserActorRef 门在接线面）。
    await waitFor(() => expect(provider.saveCalls).toHaveLength(1))
    expect(provider.saveCalls[0]).toEqual({
      sourceRef: { kind: 'INTERVENTION', id: 'IV-5' },
      content: '## 结论\n\n3 个未注册 CSV 属于 T-3 产物。',
      investigatorRunId: 'R-81',
      dshSessionId: SID,
    })
    // 对话框关闭 + 成功 chip + records 切片自动刷新（列表含新记录）。
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('AN-1'))
    expect(provider.listCalls).toBeGreaterThanOrEqual(2)
    await waitFor(() => expect(screen.getAllByText('AN-1').length).toBeGreaterThanOrEqual(2))
    expect(screen.getByText(/3 个未注册 CSV 属于 T-3 产物/)).not.toBeNull()
  })

  it('空 run 选择（清空可选字段）⇒ 载荷不携带 investigatorRunId（不虚构）', async () => {
    const provider = makeProvider()
    render(
      <InvestigatorViewContainer
        store={createAnalysisSliceStore({ dataProvider: provider })}
        sessionId={SID}
        sourceRef={{ kind: 'INBOX_ITEM', id: 'IN-11' }}
      />,
    )
    await mountWithTransient()
    fireEvent.click(screen.getByRole('button', { name: /保存为 AnalysisRecord/ }))
    const dialog = await screen.findByRole('dialog')
    const inputs = Array.from(dialog.querySelectorAll('input[type="text"]')) as HTMLInputElement[]
    // 清空 run（可选字段 — 空 = 不携带）。
    fireEvent.change(inputs[1]!, { target: { value: '' } })
    fireEvent.change(within(dialog).getByPlaceholderText(/investigator 分析内容/), { target: { value: 'audit 分析' } })
    fireEvent.click(within(dialog).getByRole('button', { name: /确认保存/ }))
    await waitFor(() => expect(provider.saveCalls).toHaveLength(1))
    const args = provider.saveCalls[0]!
    expect(args.sourceRef).toEqual({ kind: 'INBOX_ITEM', id: 'IN-11' })
    expect(args.content).toBe('audit 分析')
    expect('investigatorRunId' in args).toBe(false)
    expect(args.dshSessionId).toBe(SID)
  })

  it('坏 sourceRefId 形态 ⇒ 确认保持禁用（客户端前置门 — 不靠宿主报错）', async () => {
    render(
      <InvestigatorViewContainer
        store={createAnalysisSliceStore({ dataProvider: makeProvider() })}
        sessionId={SID}
        sourceRef={{ kind: 'INTERVENTION', id: 'IV-5' }}
      />,
    )
    await mountWithTransient()
    fireEvent.click(screen.getByRole('button', { name: /保存为 AnalysisRecord/ }))
    const dialog = await screen.findByRole('dialog')
    const inputs = Array.from(dialog.querySelectorAll('input[type="text"]')) as HTMLInputElement[]
    fireEvent.change(inputs[0]!, { target: { value: 'iv-5' } })
    fireEvent.change(within(dialog).getByPlaceholderText(/investigator 分析内容/), { target: { value: '内容' } })
    expect((within(dialog).getByRole('button', { name: /确认保存/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('取消 ⇒ 零保存调用', async () => {
    const provider = makeProvider()
    render(
      <InvestigatorViewContainer
        store={createAnalysisSliceStore({ dataProvider: provider })}
        sessionId={SID}
        sourceRef={{ kind: 'INTERVENTION', id: 'IV-5' }}
      />,
    )
    await mountWithTransient()
    fireEvent.click(screen.getByRole('button', { name: /保存为 AnalysisRecord/ }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByPlaceholderText(/investigator 分析内容/), { target: { value: '会取消的内容' } })
    // 两个「取消」按钮（头 × / 底 取消）— 取任一, 行为同。
    const cancels = within(dialog).getAllByRole('button', { name: /^取消$/ })
    fireEvent.click(cancels[cancels.length - 1]!)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(provider.saveCalls).toEqual([])
  })

  it('保存失败（宿主拒绝 — 如 Agent 门/预校验）⇒ 错误行 + 对话框保留（不吞错）', async () => {
    const provider = makeProvider({
      saveAnalysisRecord: async () => {
        throw new Error('requires a USER actor (INV-PERM-3)')
      },
    })
    render(
      <InvestigatorViewContainer
        store={createAnalysisSliceStore({ dataProvider: provider })}
        sessionId={SID}
        sourceRef={{ kind: 'INTERVENTION', id: 'IV-5' }}
      />,
    )
    await mountWithTransient()
    fireEvent.click(screen.getByRole('button', { name: /保存为 AnalysisRecord/ }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByPlaceholderText(/investigator 分析内容/), { target: { value: '被拒的内容' } })
    fireEvent.click(within(dialog).getByRole('button', { name: /确认保存/ }))
    await waitFor(() => {
      const alerts = screen.getAllByRole('alert').map((a) => a.textContent ?? '')
      expect(alerts.some((t) => t.includes('requires a USER actor'))).toBe(true)
    })
    // 对话框保留（用户可修正重试）+ 无成功 chip。
    expect(screen.getByRole('dialog')).not.toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })
})

describe('未接线面（fail-loud — 不静默）', () => {
  it('NOT_WIRED ⇒ 保存按钮禁用（title 点名 13-RPC 缺口）+ 点击无操作', async () => {
    render(<InvestigatorViewContainer store={createAnalysisSliceStore()} sessionId={SID} />)
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThanOrEqual(1))
    const btn = screen.getByRole('button', { name: /保存为 AnalysisRecord/ }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    expect(btn.title).toMatch(/13-RPC/)
  })
})
