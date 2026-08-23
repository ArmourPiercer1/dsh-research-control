// @vitest-environment jsdom
/**
 * WP-5.2 — 注意力三对象容器（React 面装配点 — 真 store + 真组件树）:
 *
 *  - 挂载后经 use-actions-slices 惰性加载三切片（in-flight 去重 — 双载只
 *    一取）;
 *  - 页面结构（data-actions-page + 三 Section）与中文文案;
 *  - 用户操作面（转正/弃用/清除）经回调 props 上抛 — 容器不伪造本地状态
 *    （宿主是数据真值 — 同 WP-4.6 InterventionBoard 纪律）; 未接线时按钮
 *    禁用;
 *  - fail-loud 面: 无 dataProvider 的 store ⇒ NextAction 切片 error,
 *    页面渲染 role=alert（点名 13-RPC 缺口）— 绝不伪造数据;
 *  - 刷新按钮透传 onRefetchRequested。
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import type { BlockerItem, NextActionItem, ProjectTopicSource } from '../../src/client/stores/actions-slices.js'
import { createActionsSlicesStore } from '../../src/client/stores/actions-slices.js'
import { ActionsViewContainer } from '../../src/client/views/actions/actions-container.js'
import { PROJECT_FIXTURE, TOPIC_FIXTURE } from '../rpc-face/fixtures.js'

afterEach(cleanup)

const NA: NextActionItem[] = [
  { id: 'NA-1', workstreamId: 'WS-1', statement: '先跑基线', rationale: null, status: 'PROPOSED', promotedToTaskId: null, createdAt: 1 },
]
const BLK: BlockerItem[] = [
  { id: 'BLK-1', statement: 'GPU 队列满', affects: [{ kind: 'WORKSTREAM', id: 'WS-1' }], status: 'ACTIVE', source: '用户报告', references: null, createdAt: 1, clearedAt: null },
]

const okRpc: ProjectTopicSource = {
  getProject: async () => ({ ok: true, value: PROJECT_FIXTURE }),
  getTopic: async () => ({ ok: true, value: TOPIC_FIXTURE }),
}

function makeStore() {
  return createActionsSlicesStore({
    rpc: okRpc,
    dataProvider: {
      async listNextActions() {
        return NA
      },
      async listBlockers() {
        return BLK
      },
    },
  })
}

describe('ActionsViewContainer（装配面）', () => {
  it('mounts, lazily loads all three slices, and renders the three sections', async () => {
    render(
      <StrictMode>
        <ActionsViewContainer store={makeStore()} />
      </StrictMode>,
    )
    expect(screen.getByText('下一步行动 · 阻碍 · 目标')).toBeTruthy()
    // Blocker 显著区:
    await waitFor(() => expect(screen.getByText('GPU 队列满')).toBeTruthy())
    expect(screen.getByText('来源：用户报告')).toBeTruthy()
    // Objective 进度概览（冻结 RPC 面 — PROJECT_FIXTURE 的 OBJ-1）:
    await waitFor(() => expect(screen.getByText('1 个目标：1 活跃 / 0 已达成 / 0 已放弃')).toBeTruthy())
    // 目标陈述同时出现在进度概览行与 NextAction 组头（项目级目标覆盖全 WS）:
    expect(screen.getAllByText('Understand the system').length).toBeGreaterThanOrEqual(2)
    // NextAction 清单（provider 缝）:
    await waitFor(() => expect(screen.getByText('先跑基线')).toBeTruthy())
    expect(screen.getByText('待转正')).toBeTruthy()
  })

  it('mutation callbacks propagate the ids up (转正/弃用/清除)', async () => {
    const events: string[] = []
    render(
      <ActionsViewContainer
        store={makeStore()}
        onPromote={(id) => events.push(`promote:${id}`)}
        onDismiss={(id) => events.push(`dismiss:${id}`)}
        onClearBlocker={(id) => events.push(`clear:${id}`)}
      />,
    )
    await waitFor(() => expect(screen.getByRole('button', { name: '转正' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '转正' }))
    fireEvent.click(screen.getByRole('button', { name: '弃用' }))
    fireEvent.click(screen.getByRole('button', { name: '清除' }))
    expect(events).toEqual(['promote:NA-1', 'dismiss:NA-1', 'clear:BLK-1'])
  })

  it('without callbacks the mutation controls are disabled (宿主接线缺口的可见提示)', async () => {
    render(<ActionsViewContainer store={makeStore()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '转正' })).toBeTruthy())
    expect((screen.getByRole('button', { name: '转正' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '弃用' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '清除' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('a store without the data face renders the fail-loud alert (never fakes data)', async () => {
    const store = createActionsSlicesStore({ rpc: okRpc })
    render(<ActionsViewContainer store={store} />)
    // NextAction + Blocker 两切片同缝 — 双双大声失败（objectiveProgress 正常）:
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThanOrEqual(2))
    const alerts = screen.getAllByRole('alert')
    expect(alerts.some((a) => a.textContent?.includes('not wired in this build'))).toBe(true)
  })

  it('the 刷新 button forwards to onRefetchRequested', () => {
    let calls = 0
    render(<ActionsViewContainer store={makeStore()} onRefetchRequested={() => calls++} />)
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    expect(calls).toBe(2)
  })
})
