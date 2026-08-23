// @vitest-environment jsdom
/**
 * WP-5.1 — Intervention 分组视图容器/展示测试（任务测试项: 视图渲染 /
 * 分组 / 操作回调）。
 *
 * 真 `createResearchStore`（stub facade 经 store 的 `rpc` 缝）+ 真
 * `InterventionGroupsView` 组件树:
 *  - 分组渲染: 机械触发 / 用户创建 两组 + 计数徽标 + 状态徽标 + INV-ATTN-1
 *    全量（4 项无一隐藏, 计数逐字）;
 *  - 操作回调: OPEN → PENDING（待处理）/ PENDING → OPEN（重新打开）/
 *    → CLOSED（关闭 + 备注, mutation 逐字段; 缺备注 = fault + 零调用）—
 *    mutation 后**不本地打补丁**, 失效注册表（WP-4.1b: updateIntervention
 *    State → dashboard）refetch 重渲染（host 真源纪律, 同 WP-4.6 先例）;
 *  - 展示层纯面: CLOSED 行无操作按钮（§13 终态）— 直渲染 Intervention-
 *    GroupsList 钉死。
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { createResearchStore } from '../../src/client/stores/index.js'
import { InterventionGroupsList, InterventionGroupsView } from '../../src/client/views/intervention/index.js'
import { makeStubRpc, type StubRpc } from '../stores/stub-rpc.js'
import type { DashboardSnapshot, InterventionDto } from '../../src/shared/rpc-contracts.js'

const T = 1_700_000_000_000

function iv(id: string, origin: InterventionDto['origin'], status: InterventionDto['status'], workstreamIds: readonly string[] = ['WS-1']): InterventionDto {
  return { id, title: `事项 ${id}`, origin, status, workstreamIds, createdAt: T + Number(id.replace(/\D/g, '')) }
}

/** 初始 dashboard: 机械触发组 3 项（AUTO_FLOODING OPEN / AGENT_REPORT PENDING /
 *  AUTO_AUDIT PENDING）+ 用户创建组 1 项（USER OPEN）— INV-ATTN-1 全量钉死。 */
function dashboard(open: InterventionDto[], pending: InterventionDto[]): DashboardSnapshot {
  return {
    project: { id: 'PRJ-1', title: 'Project One', description: null, importance: 3, attentionMode: 'NORMAL', targetDate: null },
    topics: [],
    openInterventions: open,
    pendingInterventions: pending,
    scheduledEvents: null,
    reportingItems: null,
    inboxCount: 0,
    attention: null,
  }
}

const IV1 = iv('IV-1', 'AUTO_FLOODING', 'OPEN')
const IV2 = iv('IV-2', 'USER', 'OPEN', ['WS-1', 'WS-2'])
const IV3 = iv('IV-3', 'AGENT_REPORT', 'PENDING', ['WS-2'])
const IV4 = iv('IV-4', 'AUTO_AUDIT', 'PENDING')

const INITIAL = dashboard([IV1, IV2], [IV3, IV4])
const IV1_PENDING = dashboard([IV2], [iv('IV-1', 'AUTO_FLOODING', 'PENDING'), IV3, IV4])
const IV1_CLOSED = dashboard([IV2], [IV3, IV4])

function makeStore(stub: StubRpc) {
  stub.set('getDashboard', { ok: true, value: INITIAL })
  return createResearchStore({ rpc: stub.rpc })
}

afterEach(() => {
  cleanup()
})

describe('InterventionGroupsView（容器: 渲染 / 分组 / 操作回调）', () => {
  it('分组渲染: 机械触发 3 项 / 用户创建 1 项 + 状态徽标 + INV-ATTN-1 全量（4 项零隐藏）', async () => {
    const stub = makeStubRpc()
    render(
      <StrictMode>
        <InterventionGroupsView store={makeStore(stub)} />
      </StrictMode>,
    )

    await screen.findByText('事项 IV-1')
    // 两组在位（组序固定: 机械触发 / 用户创建）+ 计数徽标逐字。
    const mech = document.querySelector('[data-group-source="MECHANICAL"]')!
    const user = document.querySelector('[data-group-source="USER_CREATED"]')!
    expect(mech.querySelector('[data-group-count="MECHANICAL"]')?.textContent).toBe('3')
    expect(user.querySelector('[data-group-count="USER_CREATED"]')?.textContent).toBe('1')
    // 机械触发组 = 三类机械 origin 全在（AGENT_REPORT + AUTO_FLOODING + AUTO_AUDIT）
    // — 行选择器用 data-iv-origin（按钮等控制元素也带 data-iv-id, 行独有 origin 属性）。
    expect([...mech.querySelectorAll('[data-iv-origin]')].map((n) => n.getAttribute('data-iv-id')).sort()).toEqual(['IV-1', 'IV-3', 'IV-4'])
    expect(user.querySelectorAll('[data-iv-origin]')).toHaveLength(1)
    expect(user.querySelector('[data-iv-origin]')?.getAttribute('data-iv-id')).toBe('IV-2')
    // INV-ATTN-1: 4 项无一隐藏（总计数逐字）。
    expect(document.querySelector('[data-iv-total]')?.getAttribute('data-iv-total')).toBe('4')
    // 状态徽标: OPEN ×2 / PENDING ×2（徽标数据属性可断言）。
    expect(document.querySelectorAll('[data-iv-badge="OPEN"]').length).toBe(2)
    expect(document.querySelectorAll('[data-iv-badge="PENDING"]').length).toBe(2)
    // 操作面: OPEN 行 = 待处理 + 关闭; PENDING 行 = 重新打开 + 关闭。
    expect(document.querySelector('[data-iv-id="IV-1"] [data-iv-action="pending"]')).not.toBeNull()
    expect(document.querySelector('[data-iv-id="IV-1"] [data-iv-action="reopen"]')).toBeNull()
    expect(document.querySelector('[data-iv-id="IV-3"] [data-iv-action="reopen"]')).not.toBeNull()
    expect(document.querySelector('[data-iv-id="IV-3"] [data-iv-action="pending"]')).toBeNull()
    expect(document.querySelectorAll('[data-iv-action="close"]').length).toBe(4)
  })

  it('OPEN → PENDING（待处理）: mutation 逐字 + refetch 重渲染（host 真源, 不本地打补丁）', async () => {
    const stub = makeStubRpc()
    render(
      <StrictMode>
        <InterventionGroupsView store={makeStore(stub)} />
      </StrictMode>,
    )
    await screen.findByText('事项 IV-1')
    expect(document.querySelector('[data-iv-id="IV-1"]')?.getAttribute('data-iv-status')).toBe('OPEN')

    // 迁移后的 host 读数（refetch 读它 — 失效注册表: updateInterventionState → dashboard）。
    stub.set('getDashboard', { ok: true, value: IV1_PENDING })

    fireEvent.click(document.querySelector('[data-iv-id="IV-1"] [data-iv-action="pending"]')!)

    await waitFor(() => {
      expect(stub.countOf('updateInterventionState')).toBe(1)
    })
    expect(stub.callsTo('updateInterventionState')[0].args).toEqual({ interventionId: 'IV-1', status: 'PENDING' })

    // refetch 后: IV-1 徽章 = PENDING, 移入机械触发组仍可见（PENDING 也是全量组）。
    await waitFor(() => {
      expect(document.querySelector('[data-iv-id="IV-1"]')?.getAttribute('data-iv-status')).toBe('PENDING')
    })
    expect(document.querySelector('[data-iv-id="IV-1"] [data-iv-action="reopen"]')).not.toBeNull()
  })

  it('PENDING → OPEN（重新打开）: mutation 逐字', async () => {
    const stub = makeStubRpc()
    stub.set('getDashboard', { ok: true, value: dashboard([IV1], [IV3, IV4]) }) // IV-3 = AGENT_REPORT PENDING
    render(
      <StrictMode>
        <InterventionGroupsView store={createResearchStore({ rpc: stub.rpc })} />
      </StrictMode>,
    )
    await screen.findByText('事项 IV-3')
    expect(document.querySelector('[data-iv-id="IV-3"]')?.getAttribute('data-iv-status')).toBe('PENDING')
    // 迁移后的 host 读数（IV-3 已重新打开 — refetch 读它）。
    stub.set('getDashboard', { ok: true, value: dashboard([IV1, iv('IV-3', 'AGENT_REPORT', 'OPEN')], [IV4]) })
    fireEvent.click(document.querySelector('[data-iv-id="IV-3"] [data-iv-action="reopen"]')!)
    await waitFor(() => {
      expect(stub.countOf('updateInterventionState')).toBe(1)
    })
    expect(stub.callsTo('updateInterventionState')[0].args).toEqual({ interventionId: 'IV-3', status: 'OPEN' })
    await waitFor(() => {
      expect(document.querySelector('[data-iv-id="IV-3"]')?.getAttribute('data-iv-status')).toBe('OPEN')
    })
  })

  it('CLOSE 缺备注: fault + 零 mutation 调用（「关闭时用户填写」, §9.2）', async () => {
    const stub = makeStubRpc()
    render(
      <StrictMode>
        <InterventionGroupsView store={makeStore(stub)} />
      </StrictMode>,
    )
    await screen.findByText('事项 IV-1')
    fireEvent.click(document.querySelector('[data-iv-id="IV-1"] [data-iv-action="close"]')!)
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('关闭需要填写备注')
    })
    expect(stub.countOf('updateInterventionState')).toBe(0)
  })

  it('CLOSE 带备注: mutation 携带 resolutionNote（trim）+ refetch 后行离开全量组', async () => {
    const stub = makeStubRpc()
    render(
      <StrictMode>
        <InterventionGroupsView store={makeStore(stub)} />
      </StrictMode>,
    )
    await screen.findByText('事项 IV-1')
    stub.set('getDashboard', { ok: true, value: IV1_CLOSED })
    const note = document.querySelector('[data-iv-note="IV-1"]') as HTMLInputElement
    fireEvent.change(note, { target: { value: '  洪泛已人工核查, 解除  ' } })
    fireEvent.click(document.querySelector('[data-iv-id="IV-1"] [data-iv-action="close"]')!)

    await waitFor(() => {
      expect(stub.countOf('updateInterventionState')).toBe(1)
    })
    expect(stub.callsTo('updateInterventionState')[0].args).toEqual({ interventionId: 'IV-1', status: 'CLOSED', resolutionNote: '洪泛已人工核查, 解除' })

    // refetch 后: IV-1 离开 OPEN/PENDING 全量组（host 已 CLOSED）, 总量 3。
    await waitFor(() => {
      expect(document.querySelector('[data-iv-id="IV-1"]')).toBeNull()
    })
    expect(document.querySelector('[data-iv-total]')?.getAttribute('data-iv-total')).toBe('3')
  })

  it('WS 钻取回调: chip 点击 → onOpenWorkstream（交互 1, ≤3 点击链入口）', async () => {
    const stub = makeStubRpc()
    const opened: string[] = []
    render(
      <StrictMode>
        <InterventionGroupsView store={makeStore(stub)} onOpenWorkstream={(ws) => opened.push(ws)} />
      </StrictMode>,
    )
    await screen.findByText('事项 IV-2')
    fireEvent.click(document.querySelector('[data-iv-id="IV-2"] [data-iv-ws="WS-2"]')!)
    expect(opened).toEqual(['WS-2'])
  })
})

describe('InterventionGroupsList（展示层纯面）', () => {
  const closedItem = iv('IV-9', 'USER', 'CLOSED')

  it('CLOSED 行无操作按钮（§13 终态 — 重开 = 新 Intervention, 无迁移面）', () => {
    render(
      <InterventionGroupsList
        groups={[
          { source: 'MECHANICAL', items: [] },
          { source: 'USER_CREATED', items: [closedItem] },
        ]}
        total={1}
        notes={new Map()}
        questions={new Map()}
        busy={false}
        investigateBusy={false}
        onTransition={() => {
          throw new Error('no transition face should be reachable for CLOSED')
        }}
        onNote={() => undefined}
        onQuestion={() => undefined}
        onInvestigate={() => {
          throw new Error('no investigate face should be reachable for CLOSED')
        }}
      />
    )
    const row = document.querySelector('[data-iv-id="IV-9"]')!
    expect(row.getAttribute('data-iv-status')).toBe('CLOSED')
    expect(row.querySelector('[data-iv-badge="CLOSED"]')).not.toBeNull()
    expect(row.querySelector('[data-iv-action]')).toBeNull()
    expect(row.querySelector('[data-iv-note]')).toBeNull()
    expect(row.querySelector('[data-iv-question]')).toBeNull()
    expect(row.querySelector('[data-iv-investigate]')).toBeNull()
  })

  it('空组渲染空态文案（组不消失 — INV-ATTN-1 不隐藏组）', () => {
    render(
      <InterventionGroupsList
        groups={[
          { source: 'MECHANICAL', items: [] },
          { source: 'USER_CREATED', items: [] },
        ]}
        total={0}
        notes={new Map()}
        questions={new Map()}
        busy={false}
        investigateBusy={false}
        onTransition={() => undefined}
        onNote={() => undefined}
        onQuestion={() => undefined}
        onInvestigate={() => undefined}
      />
    )
    // CSS Modules 类名被哈希 — 经文本定位后按组归属断言（两组各一条空态）。
    const empties = screen.getAllByText('暂无')
    expect(empties).toHaveLength(2)
    for (const el of empties) {
      expect(el.closest('[data-group-source="MECHANICAL"], [data-group-source="USER_CREATED"]')).not.toBeNull()
    }
    expect(empties[0]!.closest('[data-group-source="MECHANICAL"]')).not.toBeNull()
    expect(empties[1]!.closest('[data-group-source="USER_CREATED"]')).not.toBeNull()
  })
})

describe('InterventionGroupsView（WP-7.4 一键调查入口）', () => {
  it('OPEN/PENDING 行渲染调查问题输入 + 「调查此事项」按钮（数据属性可断言）', async () => {
    const stub = makeStubRpc()
    render(
      <StrictMode>
        <InterventionGroupsView store={makeStore(stub)} />
      </StrictMode>,
    )
    await screen.findByText('事项 IV-1')
    // 全部 4 行都是 OPEN/PENDING — 每行一个调查输入 + 一个调查按钮。
    expect(document.querySelectorAll('[data-iv-question]').length).toBe(4)
    expect(document.querySelectorAll('[data-iv-investigate]').length).toBe(4)
    expect(document.querySelector('[data-iv-id="IV-1"] [data-iv-investigate="IV-1"]')?.textContent).toBe('调查此事项')
  })

  it('空问题点击 = fault + 零通道调用（同关闭备注必填纪律）', async () => {
    const stub = makeStubRpc()
    const calls: string[] = []
    render(
      <StrictMode>
        <InterventionGroupsView
          store={makeStore(stub)}
          onInvestigate={async (item, question) => {
            calls.push(`${item.id}:${question}`)
            return '只读调查已启动 — 会话 investigator-x（transient 输出; 保存为 AnalysisRecord 需用户显式操作）'
          }}
        />
      </StrictMode>,
    )
    await screen.findByText('事项 IV-1')
    fireEvent.click(document.querySelector('[data-iv-id="IV-1"] [data-iv-investigate="IV-1"]')!)
    await waitFor(() => expect(document.querySelector('[data-iv-inv-fault]')).not.toBeNull())
    expect(document.querySelector('[data-iv-inv-fault]')?.textContent).toContain('调查需要填写调查问题')
    expect(calls).toEqual([])
  })

  it('成功 → 状态行显示命令返回文本（含调查会话 id）+ 回调入参逐字', async () => {
    const stub = makeStubRpc()
    const calls: Array<{ id: string; question: string }> = []
    render(
      <StrictMode>
        <InterventionGroupsView
          store={makeStore(stub)}
          onInvestigate={async (item, question) => {
            calls.push({ id: item.id, question })
            return '只读调查已启动 — 会话 investigator-abc-123（transient 输出; 保存为 AnalysisRecord 需用户显式操作）'
          }}
        />
      </StrictMode>,
    )
    await screen.findByText('事项 IV-1')
    fireEvent.change(document.querySelector('[data-iv-question="IV-1"]')!, { target: { value: '  为什么   PF 在堆积? ' } })
    fireEvent.click(document.querySelector('[data-iv-id="IV-1"] [data-iv-investigate="IV-1"]')!)
    await waitFor(() => expect(document.querySelector('[data-iv-inv-launched]')).not.toBeNull())
    const launched = document.querySelector('[data-iv-inv-launched]')!
    expect(launched.getAttribute('data-iv-inv-launched')).not.toBeNull()
    expect(launched.textContent).toContain('investigator-abc-123')
    // 问题经容器两端 trim 后传给通道（内部空白折叠是共享构建器
    // buildInvestigationCommandLine 的单一真源 — 此处不重复归一化）。
    expect(calls).toEqual([{ id: 'IV-1', question: '为什么   PF 在堆积?' }])
  })

  it('失败 → fault 行显示通道错误（命令错误 / 载包契约偏离均透出）', async () => {
    const stub = makeStubRpc()
    render(
      <StrictMode>
        <InterventionGroupsView
          store={makeStore(stub)}
          onInvestigate={async () => {
            throw new Error('[command-error] 调查启动失败: IVL_PERMISSION /permission read-only 未注册')
          }}
        />
      </StrictMode>,
    )
    await screen.findByText('事项 IV-2')
    fireEvent.change(document.querySelector('[data-iv-question="IV-2"]')!, { target: { value: '检查 contract 漂移' } })
    fireEvent.click(document.querySelector('[data-iv-id="IV-2"] [data-iv-investigate="IV-2"]')!)
    await waitFor(() => expect(document.querySelector('[data-iv-inv-fault]')).not.toBeNull())
    const fault = document.querySelector('[data-iv-inv-fault]')!
    expect(fault.textContent).toContain('[command-error]')
    expect(fault.textContent).toContain('IVL_PERMISSION')
  })

  it('调查中 busy = 调查按钮禁用 + 文案切换（状态迁移按钮不受影响 — 两操作面并行）', async () => {
    const stub = makeStubRpc()
    let release: ((message: string) => void) | undefined
    const gate = new Promise<string>((resolve) => {
      release = resolve
    })
    render(
      <StrictMode>
        <InterventionGroupsView
          store={makeStore(stub)}
          onInvestigate={async () => gate}
        />
      </StrictMode>,
    )
    await screen.findByText('事项 IV-1')
    fireEvent.change(document.querySelector('[data-iv-question="IV-1"]')!, { target: { value: '问题' } })
    fireEvent.click(document.querySelector('[data-iv-id="IV-1"] [data-iv-investigate="IV-1"]')!)
    // busy 态: 按钮禁用 + 文案「调查中…」。
    const btn = document.querySelector('[data-iv-id="IV-1"] [data-iv-investigate="IV-1"]') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    expect(btn.textContent).toBe('调查中…')
    // 状态迁移按钮（待处理）不受调查 busy 影响 — 独立操作面。
    expect(document.querySelector('[data-iv-id="IV-1"] [data-iv-action="pending"]')?.hasAttribute('disabled')).toBe(false)
    release?.('只读调查已启动 — 会话 investigator-y（transient 输出; 保存为 AnalysisRecord 需用户显式操作）')
    await waitFor(() => expect(document.querySelector('[data-iv-inv-launched]')).not.toBeNull())
    expect(document.querySelector('[data-iv-inv-launched]')?.textContent).toContain('investigator-y')
  })
})
