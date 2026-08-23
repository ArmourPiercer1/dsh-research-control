// @vitest-environment jsdom
/**
 * WP-6.4 — Research Inbox 展示层（纯 props 组件 — 零 hook）:
 *
 *  - InboxListView: 来源/类别 badge + 状态 badge + 高影响升级标记 ⚠
 *    （data-escalation 钩子）+ payload 预览 + 空态 + 错误切片 role=alert;
 *  - InboxItemDetail: payload/raw/contextRefs/convertedTo 面 + 转换 7
 *    kind 按钮（CAPTURED 态才出现）+ 忽略按钮（无接线禁用）; 非 CAPTURED
 *    条目无操作面（§13 终态无出口）;
 *  - InboxConversionDialog: kind 标签 + 每 kind 字段表单 + 必填门
 *    （缺必填 = 确认禁用）+ 显式确认回调（fields 载荷）+ 错误行。
 *
 * 中文文案面 + data-* 钩子（e2e 断言稳定 — 无 hash 命名空间纪律）。
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { InboxItemDto } from '../../src/client/stores/inbox-slice.js'
import type { SliceState } from '../../src/client/stores/model.js'
import { selectInboxRows } from '../../src/client/views/inbox/inbox-model.js'
import { InboxConversionDialog, InboxItemDetail, InboxListView } from '../../src/client/views/inbox/inbox-view.js'

afterEach(cleanup)

function ready<T>(data: T): SliceState<T> {
  return { status: 'ready', data, error: null, updatedAt: 1 }
}
function errorSlice<T>(data: T | null, error: string): SliceState<T> {
  return { status: 'error', data, error, updatedAt: 1 }
}

const item = (overrides: Partial<InboxItemDto> = {}): InboxItemDto => ({
  id: 'IN-1',
  source: 'HUMAN_QUICK_CAPTURE',
  payload: '随手记: 周三组会讨论 results 目录',
  raw: null,
  contextRefs: [{ kind: 'WORKSTREAM', id: 'WS-1' }],
  state: 'CAPTURED',
  convertedTo: null,
  createdAt: 1_700_000_000_001,
  ...overrides,
})

describe('InboxListView（清单 — badge + 升级标记）', () => {
  it('行渲染: id + 预览 + 状态/类别/来源 badge + 时间', () => {
    const items = [
      item({ id: 'IN-1' }),
      item({ id: 'IN-2', source: 'UNREGISTERED_WORKSPACE_CHANGE', state: 'DISMISSED' }),
    ]
    const { container } = render(<InboxListView slice={ready({ items })} rows={selectInboxRows(items)} selectedId={null} onOpenItem={() => {}} />)
    expect(container.querySelector('[data-inbox-list]')).not.toBeNull()
    const rows = container.querySelectorAll('[data-inbox-item]')
    expect(rows).toHaveLength(2)
    expect(rows[0].getAttribute('data-inbox-state')).toBe('CAPTURED')
    expect(rows[0].getAttribute('data-inbox-source')).toBe('HUMAN_QUICK_CAPTURE')
    expect(rows[1].getAttribute('data-inbox-state')).toBe('DISMISSED')
    // 中文 badge（冻结面标签 — 用户/机械类别 + 来源标签）。
    expect(screen.getByText('用户快捷捕获')).not.toBeNull()
    expect(screen.getByText('未注册工作区变化')).not.toBeNull()
    expect(screen.getAllByText('用户')).toHaveLength(1)
    expect(screen.getAllByText('机械')).toHaveLength(1)
    expect(screen.getByText('已捕获')).not.toBeNull()
    expect(screen.getByText('已忽略')).not.toBeNull()
    // 待处理计数（CAPTURED 数 / 全部数）。
    expect(screen.getByText('1 个待处理 / 2 全部')).not.toBeNull()
  })

  it('高影响升级条目: ⚠ 高影响 badge + data-escalation 钩子（卡片面）', () => {
    const items = [
      item({
        id: 'IN-9',
        source: 'UNCLASSIFIED_AUDIT_FINDING',
        payload: 'audit: deletion',
        raw: { escalation: { highImpact: true, reasons: ['DELETION'] } },
      }),
    ]
    const { container } = render(<InboxListView slice={ready({ items })} rows={selectInboxRows(items)} selectedId={null} onOpenItem={() => {}} />)
    const card = container.querySelector('[data-inbox-item="IN-9"]')
    expect(card?.getAttribute('data-escalation')).toBe('high-impact')
    expect(screen.getByText(/⚠ 高影响/)).not.toBeNull()
  })

  it('非高影响升级标记不打 ⚠（raw.escalation.highImpact=false）', () => {
    const items = [item({ raw: { escalation: { highImpact: false, reasons: [] } } })]
    render(<InboxListView slice={ready({ items })} rows={selectInboxRows(items)} selectedId={null} onOpenItem={() => {}} />)
    expect(screen.queryByText(/⚠/)).toBeNull()
  })

  it('点击条目 ⇒ onOpenItem(id)（data-open-inbox 钩子）', () => {
    const items = [item({ id: 'IN-7' })]
    const onOpen = vi.fn()
    const { container } = render(<InboxListView slice={ready({ items })} rows={selectInboxRows(items)} selectedId={null} onOpenItem={onOpen} />)
    fireEvent.click(container.querySelector('[data-open-inbox="IN-7"]')!)
    expect(onOpen).toHaveBeenCalledWith('IN-7')
  })

  it('空态: 「收件箱为空（捕获优先 — 尚无条目）」', () => {
    render(<InboxListView slice={ready({ items: [] })} rows={[]} selectedId={null} onOpenItem={() => {}} />)
    expect(screen.getByText(/收件箱为空/)).not.toBeNull()
  })

  it('错误切片: role=alert（无数据）/ 附注（stale-while-revalidate 有数据）', () => {
    const items = [item()]
    render(<InboxListView slice={errorSlice<{ readonly items: readonly InboxItemDto[] }>(null, 'inbox data face not wired')} rows={[]} selectedId={null} onOpenItem={() => {}} />)
    expect(screen.getByRole('alert').textContent).toMatch(/inbox data face not wired/)
    cleanup()
    const { container } = render(
      <InboxListView slice={errorSlice({ items }, 'transient')} rows={selectInboxRows(items)} selectedId={null} onOpenItem={() => {}} />,
    )
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/显示上次成功数据/)
  })

  it('loading 无数据: 加载中…', () => {
    const slice: SliceState<{ items: readonly InboxItemDto[] }> = { status: 'loading', data: null, error: null, updatedAt: 1 }
    render(<InboxListView slice={slice} rows={[]} selectedId={null} onOpenItem={() => {}} />)
    expect(screen.getByText('加载中…')).not.toBeNull()
  })
})

describe('InboxItemDetail（详情 — 操作面）', () => {
  it('CAPTURED 条目: payload + contextRefs + 7 kind 转换按钮 + 忽略按钮', () => {
    const it1 = item({ contextRefs: [{ kind: 'WORKSTREAM', id: 'WS-1' }, { kind: 'ARTIFACT', id: 'A-2' }] })
    const onConvert = vi.fn()
    const onDismiss = vi.fn()
    render(<InboxItemDetail item={it1} onConvert={onConvert} onDismiss={onDismiss} onBack={() => {}} />)
    expect(screen.getByText('随手记: 周三组会讨论 results 目录')).not.toBeNull()
    expect(screen.getByText('WORKSTREAM:WS-1')).not.toBeNull()
    expect(screen.getByText('ARTIFACT:A-2')).not.toBeNull()
    // 7 kind 转换按钮（§28 动作集 — data-convert-kind 钩子）。
    expect(screen.getByRole('button', { name: '任务' })).not.toBeNull()
    expect(screen.getByRole('button', { name: '下一步行动' })).not.toBeNull()
    expect(screen.getByRole('button', { name: '干预' })).not.toBeNull()
    expect(screen.getByRole('button', { name: '主张' })).not.toBeNull()
    expect(screen.getByRole('button', { name: '事实' })).not.toBeNull()
    expect(screen.getByRole('button', { name: '汇报项' })).not.toBeNull()
    expect(screen.getByRole('button', { name: '互动' })).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '干预' }))
    expect(onConvert).toHaveBeenCalledWith('INTERVENTION')
    // 忽略按钮（有接线 = 可用）。
    fireEvent.click(screen.getByRole('button', { name: /忽略/ }))
    expect(onDismiss).toHaveBeenCalledWith('IN-1')
  })

  it('忽略无接线 ⇒ 禁用 + title 提示（宿主操作通道未接线）', () => {
    render(<InboxItemDetail item={item()} onConvert={() => {}} onBack={() => {}} />)
    const btn = screen.getByRole('button', { name: /忽略/ }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    expect(btn.getAttribute('title')).toBe('宿主操作通道未接线')
  })

  it('CONVERTED 条目: 无操作面（§13 终态无出口）+ convertedTo 行', () => {
    const { container } = render(
      <InboxItemDetail
        item={item({ state: 'CONVERTED', convertedTo: { kind: 'INTERVENTION', id: 'IV-4' } })}
        onConvert={() => {}}
        onBack={() => {}}
      />,
    )
    expect(screen.getByText('INTERVENTION:IV-4')).not.toBeNull()
    expect(container.querySelector('[data-convert-kind]')).toBeNull()
    expect(screen.queryByRole('button', { name: /忽略/ })).toBeNull()
  })

  it('DISMISSED 条目: 无操作面', () => {
    const { container } = render(<InboxItemDetail item={item({ state: 'DISMISSED' })} onConvert={() => {}} onBack={() => {}} />)
    expect(container.querySelector('[data-convert-kind]')).toBeNull()
  })

  it('高影响标记: ⚠ + 中文理由（关键路径/损失/批量影响）', () => {
    render(
      <InboxItemDetail
        item={item({ raw: { escalation: { highImpact: true, reasons: ['STRICT_TRACKED_CHANGE', 'BATCH_IMPACT'] } } })}
        onConvert={() => {}}
        onBack={() => {}}
      />,
    )
    expect(screen.getByText(/⚠ 高影响/).textContent).toContain('关键路径、批量影响')
  })

  it('raw 折叠面（原始数据 JSON）+ 返回按钮', () => {
    const onBack = vi.fn()
    render(<InboxItemDetail item={item({ raw: { deep: [1, 2] } })} onConvert={() => {}} onBack={onBack} />)
    expect(screen.getByText('原始数据（raw）')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /返回清单/ }))
    expect(onBack).toHaveBeenCalled()
  })
})

describe('InboxConversionDialog（转换确认 — §28 显式确认面）', () => {
  it('字段表单（INTERVENTION: 标题必填 + 详情/关联工作流可选）+ 必填门', () => {
    const onConfirm = vi.fn()
    render(
      <InboxConversionDialog
        item={item()}
        kind="INTERVENTION"
        fieldValues={{}}
        busy={false}
        error={null}
        onFieldChange={() => {}}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    )
    // 确认禁用（必填标题空）。
    const confirm = screen.getByRole('button', { name: '确认转换' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
  })

  it('必填齐备 ⇒ 确认可用 ⇒ 回调收到 {kind, ...} 载荷（trim + workstreamIds 拆）', () => {
    const onConfirm = vi.fn()
    render(
      <InboxConversionDialog
        item={item()}
        kind="INTERVENTION"
        fieldValues={{ title: '  Review finding  ', workstreamIds: ' WS-1 , WS-2 ' }}
        busy={false}
        error={null}
        onFieldChange={() => {}}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '确认转换' }))
    expect(onConfirm).toHaveBeenCalledWith({ kind: 'INTERVENTION', title: 'Review finding', workstreamIds: ['WS-1', 'WS-2'] })
  })

  it('必填缺失时输入补全（onFieldChange 驱动 — 展示层状态由容器持）', () => {
    const onConfirm = vi.fn()
    const { rerender } = render(
      <InboxConversionDialog
        item={item()}
        kind="TASK"
        fieldValues={{}}
        busy={false}
        error={null}
        onFieldChange={() => {}}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    )
    // 模拟容器回填（受控输入 — 容器持 fieldValues 状态）。
    rerender(
      <InboxConversionDialog
        item={item()}
        kind="TASK"
        fieldValues={{ workstreamId: 'WS-1', title: '做A' }}
        busy={false}
        error={null}
        onFieldChange={() => {}}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '确认转换' }))
    expect(onConfirm).toHaveBeenCalledWith({ kind: 'TASK', workstreamId: 'WS-1', title: '做A' })
  })

  it('显式确认文案（§28「需显式确认」+ 终态提示）+ busy 面 + 错误行', () => {
    const onConfirm = vi.fn()
    const { container } = render(
      <InboxConversionDialog
        item={item({ id: 'IN-5' })}
        kind="CLAIM"
        fieldValues={{ workstreamId: 'WS-1', statement: 's' }}
        busy={true}
        error="target not wired (CLAIM)"
        onFieldChange={() => {}}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    )
    expect(screen.getByText(/显式确认/)).not.toBeNull()
    expect(screen.getByText(/CONVERTED/)).not.toBeNull() // 终态不可重转提示
    const confirm = screen.getByRole('button', { name: '转换中…' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('target not wired (CLAIM)')
    expect((container.querySelector('input') as HTMLInputElement).disabled).toBe(true)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('取消按钮（对话框关闭面）', () => {
    const onCancel = vi.fn()
    render(
      <InboxConversionDialog
        item={item()}
        kind="FACT"
        fieldValues={{}}
        busy={false}
        error={null}
        onFieldChange={() => {}}
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    )
    fireEvent.click(screen.getAllByRole('button', { name: '取消' })[0])
    expect(onCancel).toHaveBeenCalled()
  })
})
