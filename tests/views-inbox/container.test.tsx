// @vitest-environment jsdom
/**
 * WP-6.4 — Research Inbox 容器（React 面装配点 — 真 store + 真组件树）:
 *
 *  - 挂载后经 use-inbox-slice 惰性加载 items 切片（in-flight 去重 —
 *    StrictMode 双载只一取）;
 *  - 清单 → 详情 → 转换对话框 的视图内导航（纯 UI 状态, 非数据）;
 *  - 用户操作面（转换/忽略 — 仅用户）经切片 store 的 provider 透传;
 *    成功后 store 自动刷新 items 切片（宿主是数据真值 — 容器不镜像）;
 *  - fail-loud 面: NOT_WIRED provider ⇒ 列表 error role=alert（点名
 *    13-RPC 缺口）; 操作失败 ⇒ transient 错误行（不伪造状态）;
 *  - 忽略成功后焦点回清单（条目终态 — 详情退出）。
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import type { InboxDataProvider, InboxItemDto } from '../../src/client/stores/inbox-slice.js'
import { createInboxSliceStore } from '../../src/client/stores/inbox-slice.js'
import { InboxViewContainer } from '../../src/client/views/inbox/inbox-container.js'

afterEach(cleanup)

const CAPTURED: InboxItemDto = {
  id: 'IN-1',
  source: 'HUMAN_QUICK_CAPTURE',
  payload: '随手记: 周三组会讨论 results 目录',
  raw: null,
  contextRefs: [],
  state: 'CAPTURED',
  convertedTo: null,
  createdAt: 1_700_000_000_001,
}

function makeProvider(overrides: Partial<InboxDataProvider> = {}): InboxDataProvider & {
  convertCalls: { inboxItemId: string; targetKind: string; fields: Record<string, unknown> }[]
  dismissCalls: string[]
} {
  const convertCalls: { inboxItemId: string; targetKind: string; fields: Record<string, unknown> }[] = []
  const dismissCalls: string[] = []
  let items: readonly InboxItemDto[] = [CAPTURED]
  return {
    convertCalls,
    dismissCalls,
    async listInboxItems() {
      return items
    },
    async convertInboxItem(args) {
      convertCalls.push(args)
      if (overrides.convertInboxItem !== undefined) return overrides.convertInboxItem(args)
      items = items.map((it) =>
        it.id === args.inboxItemId ? { ...it, state: 'CONVERTED' as const, convertedTo: { kind: args.targetKind, id: `${args.targetKind}-1` } } : it,
      )
    },
    async dismissInboxItem(inboxItemId) {
      dismissCalls.push(inboxItemId)
      if (overrides.dismissInboxItem !== undefined) return overrides.dismissInboxItem(inboxItemId)
      items = items.map((it) => (it.id === inboxItemId ? { ...it, state: 'DISMISSED' as const } : it))
    },
    async quickCapture() {
      throw new Error('container test does not capture')
    },
  }
}

describe('挂载与惰性加载', () => {
  it('挂载后加载清单（StrictMode 双载只一取 — in-flight 去重）', async () => {
    const provider = makeProvider()
    let listCalls = 0
    const counting: InboxDataProvider = {
      ...provider,
      async listInboxItems() {
        listCalls += 1
        return provider.listInboxItems()
      },
    }
    render(
      <StrictMode>
        <InboxViewContainer store={createInboxSliceStore({ dataProvider: counting })} />
      </StrictMode>,
    )
    await waitFor(() => expect(screen.getByText(/1 个待处理 /)).not.toBeNull())
    expect(listCalls).toBe(1)
  })

  it('NOT_WIRED（缺省 provider）⇒ 列表 error role=alert 点名 13-RPC 缺口（绝不伪造数据）', async () => {
    render(<InboxViewContainer store={createInboxSliceStore()} />)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/13-RPC/))
    expect(screen.queryByText(/1 个待处理/)).toBeNull()
  })
})

describe('清单 → 详情 → 对话框 导航', () => {
  it('点开条目 ⇒ 详情（payload + kind 按钮）; 返回 ⇒ 清单', async () => {
    render(<InboxViewContainer store={createInboxSliceStore({ dataProvider: makeProvider() })} />)
    await waitFor(() => expect(screen.getByText(/1 个待处理 /)).not.toBeNull())
    // 清单面 → 点开。
    fireEvent.click(screen.getByText('IN-1'))
    expect(screen.getByText('随手记: 周三组会讨论 results 目录')).not.toBeNull()
    expect(screen.getByRole('button', { name: '干预' })).not.toBeNull()
    // 返回。
    fireEvent.click(screen.getByRole('button', { name: /返回清单/ }))
    await waitFor(() => expect(screen.getByText(/1 个待处理 /)).not.toBeNull())
    expect(screen.queryByRole('button', { name: '干预' })).toBeNull()
  })

  it('转换流程: 选 kind ⇒ 对话框（必填门）⇒ 填写 ⇒ 确认 ⇒ 成功刷新（条目 CONVERTED）', async () => {
    const provider = makeProvider()
    render(<InboxViewContainer store={createInboxSliceStore({ dataProvider: provider })} />)
    await waitFor(() => expect(screen.getByText(/1 个待处理 /)).not.toBeNull())
    fireEvent.click(screen.getByText('IN-1'))
    fireEvent.click(screen.getByRole('button', { name: '干预' }))
    // 对话框出现（必填门 — 空表单确认禁用）。
    await waitFor(() => expect(screen.getByRole('dialog')).not.toBeNull())
    const confirm = screen.getByRole('button', { name: '确认转换' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    // 填写标题（受控输入 — 容器持 fieldValues）。
    fireEvent.change(screen.getByPlaceholderText('干预标题'), { target: { value: 'Review finding' } })
    await waitFor(() => expect((screen.getByRole('button', { name: '确认转换' }) as HTMLButtonElement).disabled).toBe(false))
    // 显式确认。
    fireEvent.click(screen.getByRole('button', { name: '确认转换' }))
    await waitFor(() => expect(provider.convertCalls).toHaveLength(1))
    expect(provider.convertCalls[0]).toEqual({
      inboxItemId: 'IN-1',
      targetKind: 'INTERVENTION',
      fields: { kind: 'INTERVENTION', title: 'Review finding' },
    })
    // 成功: 对话框关闭 + 详情面 convertedTo chip（自动刷新 — store 层已钉）;
    // 返回清单后计数归 0。
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByText('INTERVENTION:INTERVENTION-1')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /返回清单/ }))
    await waitFor(() => expect(screen.getByText(/0 个待处理 /)).not.toBeNull())
  })

  it('取消对话框 ⇒ 不触发转换（无 provider 调用）', async () => {
    const provider = makeProvider()
    render(<InboxViewContainer store={createInboxSliceStore({ dataProvider: provider })} />)
    await waitFor(() => expect(screen.getByText(/1 个待处理 /)).not.toBeNull())
    fireEvent.click(screen.getByText('IN-1'))
    fireEvent.click(screen.getByRole('button', { name: '干预' }))
    await waitFor(() => expect(screen.getByRole('dialog')).not.toBeNull())
    fireEvent.click(screen.getAllByRole('button', { name: '取消' })[0])
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(provider.convertCalls).toHaveLength(0)
  })
})

describe('操作 fail-loud 面（不伪造本地状态）', () => {
  it('转换失败 ⇒ transient 错误行（provider 错误原文）+ 对话框保留（用户可重试/取消）', async () => {
    const provider = makeProvider({
      convertInboxItem: async () => {
        throw new Error('convert not wired (CLAIM) — 13-RPC gap')
      },
    })
    render(<InboxViewContainer store={createInboxSliceStore({ dataProvider: provider })} />)
    await waitFor(() => expect(screen.getByText(/1 个待处理 /)).not.toBeNull())
    fireEvent.click(screen.getByText('IN-1'))
    fireEvent.click(screen.getByRole('button', { name: '主张' }))
    await waitFor(() => expect(screen.getByRole('dialog')).not.toBeNull())
    fireEvent.change(screen.getByPlaceholderText('WS-1'), { target: { value: 'WS-1' } })
    fireEvent.change(screen.getByPlaceholderText('主张什么'), { target: { value: 's' } })
    fireEvent.click(screen.getByRole('button', { name: '确认转换' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('convert not wired (CLAIM) — 13-RPC gap'))
    // 对话框保留（失败不关 — 用户可重试）。
    expect(screen.getByRole('dialog')).not.toBeNull()
  })

  it('忽略失败 ⇒ transient 错误行（详情保留）', async () => {
    const provider = makeProvider({
      dismissInboxItem: async () => {
        throw new Error('state moved concurrently')
      },
    })
    render(<InboxViewContainer store={createInboxSliceStore({ dataProvider: provider })} />)
    await waitFor(() => expect(screen.getByText(/1 个待处理 /)).not.toBeNull())
    fireEvent.click(screen.getByText('IN-1'))
    fireEvent.click(screen.getByRole('button', { name: /忽略/ }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('state moved concurrently'))
    // 详情保留（未忽略成功）。
    expect(screen.getByRole('button', { name: /忽略/ })).not.toBeNull()
  })

  it('忽略成功 ⇒ 焦点回清单（条目终态）+ 计数更新', async () => {
    const provider = makeProvider()
    render(<InboxViewContainer store={createInboxSliceStore({ dataProvider: provider })} />)
    await waitFor(() => expect(screen.getByText(/1 个待处理 /)).not.toBeNull())
    fireEvent.click(screen.getByText('IN-1'))
    fireEvent.click(screen.getByRole('button', { name: /忽略/ }))
    await waitFor(() => expect(screen.getByText(/0 个待处理 /)).not.toBeNull())
    expect(provider.dismissCalls).toEqual(['IN-1'])
    expect(screen.queryByRole('button', { name: '干预' })).toBeNull()
  })
})
