// @vitest-environment jsdom
/**
 * WP-5.5 — Brief 容器端到端测试（真 `createResearchStore` + stub RPC —
 * 同 tests/attention 容器口径: 断言用户可见行为, 容器不见 DSH ctx）。
 *
 * 覆盖:
 *  - mount ⇒ lazy `loadDashboard` + `loadProject`（主 store 去重 —
 *    StrictMode 双跑只发一次 fetch）⇒ 三级面板渲染（L1 常驻）;
 *  - 刷新按钮驱动 `store.refresh('manual')`（refetch dashboard/project
 *    ⇒ 切片重算 ⇒ L1 收敛）;
 *  - dashboard 首载失败 ⇒ 「加载失败」面 + 重试（恢复后收敛）;
 *  - project 失败 ⇒ Brief 仍渲染（不硬依赖）+ 数据面说明文案显式提示
 *    （不静默 — objectives 回落占位）;
 *  - 刷新失败（有缓存）⇒ 陈旧 brief + 错误条（stale-while-revalidate
 *    容器端到端）;
 *  - ref 跳转渠道（WP-4.6 模式）: ref chip 点击 ⇒ 容器 banner（占位渠道
 *    显式可见）+ 注入的 `onOpenRef` 渠道回调收到精确 ref。
 */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DashboardSnapshot } from '../../src/shared/rpc-contracts.js'
import { createResearchStore } from '../../src/client/stores/index.js'
import { BriefView } from '../../src/client/views/brief/BriefView'
import { makeStubRpc, type StubRpc } from '../stores/stub-rpc.js'
import { ATTENTION_DASHBOARD_FIXTURE, T_NOW } from '../attention/fixtures.js'
import { PROJECT_FIXTURE } from '../rpc-face/fixtures.js'

afterEach(cleanup)

const DASH: DashboardSnapshot = ATTENTION_DASHBOARD_FIXTURE

function renderView(rpc: StubRpc = makeStubRpc(), over: { onOpenRef?: (ref: unknown) => void } = {}) {
  rpc.set('getDashboard', { ok: true, value: DASH })
  rpc.set('getProject', { ok: true, value: PROJECT_FIXTURE })
  const store = createResearchStore({ rpc: rpc.rpc })
  const utils = render(<BriefView store={store} onOpenRef={over.onOpenRef} />)
  return { rpc, store, ...utils }
}

const L1_FULL = '《Project One》：1 个活跃目标；干预 1 OPEN / 1 PENDING'

describe('BriefView 容器（主 store 驱动）', () => {
  it('mount ⇒ lazy loadDashboard + loadProject ⇒ L1 渲染（两侧数据面汇聚）', async () => {
    const { rpc } = renderView()
    expect(await screen.findByText(L1_FULL, {}, { timeout: 2000 })).toBeDefined()
    expect(rpc.countOf('getDashboard')).toBe(1)
    expect(rpc.countOf('getProject')).toBe(1)
    // L1 常驻（无展开交互）+ 项目 ref chip:
    expect(screen.getByRole('button', { name: 'PROJECT:PRJ-1' })).toBeDefined()
  })

  it('刷新按钮驱动 store.refresh（refetch ⇒ 切片重算 ⇒ L1 收敛）', async () => {
    const { rpc } = renderView()
    await screen.findByText(L1_FULL, {}, { timeout: 2000 })
    expect(rpc.countOf('getDashboard')).toBe(1)

    // 刷新后 dashboard 多一条 PENDING Intervention ⇒ L1 计数收敛:
    rpc.set('getDashboard', {
      ok: true,
      value: {
        ...DASH,
        pendingInterventions: [
          ...DASH.pendingInterventions,
          { id: 'IV-3', title: '刷新后新增的审计差异', origin: 'AUTO_AUDIT', status: 'PENDING', workstreamIds: ['WS-1'], createdAt: T_NOW + 60 * 1000 },
        ],
      },
    })
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    expect(await screen.findByText('《Project One》：1 个活跃目标；干预 1 OPEN / 2 PENDING', {}, { timeout: 2000 })).toBeDefined()
    expect(rpc.countOf('getDashboard')).toBe(2)
  })

  it('dashboard 首载失败 ⇒ 「加载失败」面 + 重试（恢复后收敛）', async () => {
    const rpc = makeStubRpc()
    rpc.set('getDashboard', {
      ok: false,
      error: { code: 'NOT_READY', message: 'research service not ready', details: {} },
    })
    rpc.set('getProject', { ok: true, value: PROJECT_FIXTURE })
    const store = createResearchStore({ rpc: rpc.rpc })
    render(<BriefView store={store} />)
    expect(
      await screen.findByText('加载失败：NOT_READY: research service not ready', {}, { timeout: 2000 }),
    ).toBeDefined()

    // 恢复服务 ⇒ 重试 ⇒ 收敛:
    rpc.set('getDashboard', { ok: true, value: DASH })
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByText(L1_FULL, {}, { timeout: 2000 })).toBeDefined()
    expect(rpc.countOf('getDashboard')).toBe(2)
  })

  it('project 失败 ⇒ Brief 仍渲染（不硬依赖）+ 数据面说明显式提示（stale-while-revalidate: 陈旧 objectives 仍可见, 不静默）', async () => {
    const { rpc } = renderView()
    await screen.findByText(L1_FULL, {}, { timeout: 2000 })
    expect(screen.getByText(/1 个活跃目标/)).toBeDefined()

    rpc.set('getProject', {
      ok: false,
      error: { code: 'NOT_READY', message: 'project facade down', details: {} },
    })
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    expect(
      await screen.findByText(/项目快照加载失败（Objectives 可能不完整）：NOT_READY: project facade down/, {}, { timeout: 2000 }),
    ).toBeDefined()
    // L1 保持（主 store stale-while-revalidate: 失败 refetch 保留最后好的
    // 数据 — objectives 仍是陈旧但可见的值; 面板不空白、不静默）:
    expect(screen.getByText(L1_FULL)).toBeDefined()
  })

  it('刷新失败（有缓存）⇒ 陈旧 brief + 错误条（stale-while-revalidate 端到端）', async () => {
    const { rpc } = renderView()
    await screen.findByText(L1_FULL, {}, { timeout: 2000 })

    rpc.set('getDashboard', {
      ok: false,
      error: { code: 'NOT_READY', message: 'refresh blew up', details: {} },
    })
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    expect(
      await screen.findByText(/刷新失败：NOT_READY: refresh blew up/, {}, { timeout: 2000 }),
    ).toBeDefined()
    // 陈旧 L1 仍可见（数据面未更新）:
    expect(screen.getByText(L1_FULL)).toBeDefined()
  })

  it('ref 跳转渠道: chip 点击 ⇒ 详情区（drill-down 坐标）⇒ 「打开详情」⇒ 注入 onOpenRef 收到精确 ref + 容器 banner（占位渠道显式）', async () => {
    const onOpenRef = vi.fn()
    renderView(makeStubRpc(), { onOpenRef })
    await screen.findByText(L1_FULL, {}, { timeout: 2000 })

    // chip 点击 = 选中（详情区自包含渲染 — drilldown 跳转模式第 1 击）:
    fireEvent.click(screen.getByRole('button', { name: 'PROJECT:PRJ-1' }))
    const detail = await screen.findByRole('region', { name: 'ref 详情' })
    expect(within(detail).getByText('PRJ-1')).toBeDefined()

    // 「打开详情」= 渠道触发（第 2 击 — 容器持渠道）:
    fireEvent.click(within(detail).getByRole('button', { name: '打开详情 ↗' }))
    expect(onOpenRef).toHaveBeenCalledTimes(1)
    expect(onOpenRef).toHaveBeenCalledWith({ kind: 'OBJECT', objectKind: 'PROJECT', id: 'PRJ-1' })
    // 占位渠道 banner 显式可见（跳转目标坐标 — 渠道接管前用户可见）:
    expect(await screen.findByText(/跳转目标：PROJECT:PRJ-1/)).toBeDefined()
  })
})
