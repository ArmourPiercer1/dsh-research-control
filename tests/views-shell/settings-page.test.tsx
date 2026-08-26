// @vitest-environment jsdom
/**
 * V2-T5.4 — 设置 page (四段式管理面, design §7.4) component tests.
 *
 * Plain stub props — no real cordis (the views-* test pattern): the five
 * mutation faces are vi.fn stubs resolving the strict wire results
 * (re-parsed through the strict schemas in ./fixtures.ts for the plane
 * state). Coverage per the T5.4 gate:
 *  - ROLE VISIBILITY MATRIX: each console role → the EXACT section set
 *    (HUB: ①②③④; MANAGED / STANDALONE: ①②④ — NO 登记册; the shell-level
 *    pin that UNREGISTERED / NO_CWD never see the 设置 entry lives in
 *    shell.test.tsx);
 *  - ② 操作 per-role 显隐 (the §7.4 状态表): 重扫并连接 always; HUB → the
 *    设为中枢 state line + 接入 on an empty hub; MANAGED → 解除绑定;
 *    STANDALONE → 接入研究管理系统 when a hub exists, 设为中枢 (the
 *    §5 状态表 无中枢 row, the marker + EMPTY registry confirm) when
 *    the plane has NO hub;
 *  - 解除绑定 confirm dialog: the 三件事 copy (条目转归档不删 / `<treeDir>/`
 *    改名 `<treeDir>.archived-<ts>` / 事件库保留在中枢), the confirm
 *    button reads 解除绑定 verbatim, confirm fires unbindProject with the
 *    session's wsPath + the shell re-fetch, cancel is inert (no RPC);
 *  - ③ 登记册: the book rows (declaration order) with the derived status
 *    (正常 / ⚠树缺失 — the missing-entry flagging — / 已归档) + the
 *    lifecycle stamps (登记于 boundAt; the 已归档 row adds 归档于);
 *    [重验] fires rescan; [恢复指引] expands the inline guide (no RPC);
 *    [移除登记] fires unbindProject with the entry's registered path;
 *    [恢复登记] fires restoreProject with the entry id + the shell
 *    re-fetch (a rejection faults in ③, no re-fetch);
 *  - ④ 数据位置: the §3.3 layout derived client-side (registry.yaml +
 *    per-entry db paths; the db never leaves the hub).
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { act, StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SettingsPage, type SettingsPageProps } from '../../src/client/views/shell/settings-page.js'
import type {
  BindProjectResult,
  GetResearchPlaneStateResult,
  RescanResult,
  RestoreProjectResult,
  SetHubResult,
  UnbindProjectResult,
} from '../../src/shared/rpc-contracts.js'
import {
  HUB_PATH,
  HUB_RESULT,
  HUB_RESULT_AT_UNREGISTERED,
  HUB_RESULT_WITH_ARCHIVED,
  MANAGED_PATH,
  MANAGED_RESULT,
  MISSING_RESULT,
  REGISTRY_ENTRY_PRJ3,
  STANDALONE_PATH,
  STANDALONE_RESULT,
  STANDALONE_RESULT_AT_UNREGISTERED,
} from './fixtures.js'

/** Wire-valid default mutation results (the strict shapes). */
const RESCAN_OK: RescanResult = {
  hub: null,
  dirNames: { treeDir: '.research', hubDir: '.research-control' },
  projects: [],
  missing: [],
  registry: [],
}
const BIND_OK: BindProjectResult = { projectId: 'PRJ-9', registryPath: null, dbMigrated: false }
const UNBIND_OK: UnbindProjectResult = {
  projectId: 'PRJ-1',
  archivedDir: `${MANAGED_PATH}/.research.archived-1755000000000`,
}
const RESTORE_OK: RestoreProjectResult = { wsPath: '/workspace/proj-6' }
const SET_HUB_OK: SetHubResult = {
  hubPath: '/workspace/proj-6',
  registryPath: '/workspace/proj-6/.research-control/registry.yaml',
}

interface Faces {
  readonly rescan: ReturnType<typeof vi.fn>
  readonly bindProject: ReturnType<typeof vi.fn>
  readonly setHub: ReturnType<typeof vi.fn>
  readonly unbindProject: ReturnType<typeof vi.fn>
  readonly restoreProject: ReturnType<typeof vi.fn>
  readonly onApplied: ReturnType<typeof vi.fn>
}

function makeFaces(over: Partial<Omit<SettingsPageProps, 'role' | 'cwd' | 'plane'>> = {}): Faces {
  return {
    rescan: over.rescan ?? vi.fn(async (): Promise<RescanResult> => RESCAN_OK),
    bindProject: over.bindProject ?? vi.fn(async (): Promise<BindProjectResult> => BIND_OK),
    setHub: over.setHub ?? vi.fn(async (): Promise<SetHubResult> => SET_HUB_OK),
    unbindProject: over.unbindProject ?? vi.fn(async (): Promise<UnbindProjectResult> => UNBIND_OK),
    restoreProject: over.restoreProject ?? vi.fn(async (): Promise<RestoreProjectResult> => RESTORE_OK),
    onApplied: over.onApplied ?? vi.fn(),
  }
}

function renderSettings(
  role: SettingsPageProps['role'],
  cwd: string | null,
  plane: GetResearchPlaneStateResult,
  over: Parameters<typeof makeFaces>[0] = {},
): Faces {
  const faces = makeFaces(over)
  render(
    <StrictMode>
      <SettingsPage
        role={role}
        cwd={cwd}
        plane={plane}
        rescan={faces.rescan as SettingsPageProps['rescan']}
        bindProject={faces.bindProject as SettingsPageProps['bindProject']}
        setHub={faces.setHub as SettingsPageProps['setHub']}
        unbindProject={faces.unbindProject as SettingsPageProps['unbindProject']}
        restoreProject={faces.restoreProject as SettingsPageProps['restoreProject']}
        onApplied={faces.onApplied}
      />
    </StrictMode>,
  )
  return faces
}

afterEach(() => {
  cleanup()
})

/* ===================================================================== *
 * Role visibility matrix (design §5/§7.4: the 收窄版 ①②④ for the project
 * roles; the 登记册 is HUB-only; the shell keeps UNREGISTERED / NO_CWD
 * on the 引导卡 — pinned in shell.test.tsx)
 * ===================================================================== */

describe('role visibility matrix (design §7.4 收窄版)', () => {
  it('HUB → ALL four sections (①②③④ — the 登记册 included)', () => {
    renderSettings('HUB', HUB_PATH, HUB_RESULT)
    expect(document.querySelector('[data-settings-page][data-settings-role="HUB"]')).toBeTruthy()
    for (const section of ['status', 'actions', 'book', 'locations']) {
      expect(document.querySelector(`[data-settings-section="${section}"]`), section).toBeTruthy()
    }
    expect(screen.getByText('① 当前状态')).toBeTruthy()
    expect(screen.getByText('② 操作')).toBeTruthy()
    expect(screen.getByText('③ 项目登记册')).toBeTruthy()
    expect(screen.getByText('④ 数据位置')).toBeTruthy()
  })

  it('MANAGED → the 收窄版 ①②④ (NO 登记册 section)', () => {
    renderSettings('MANAGED', MANAGED_PATH, MANAGED_RESULT)
    expect(document.querySelector('[data-settings-page][data-settings-role="MANAGED"]')).toBeTruthy()
    for (const section of ['status', 'actions', 'locations']) {
      expect(document.querySelector(`[data-settings-section="${section}"]`), section).toBeTruthy()
    }
    expect(document.querySelector('[data-settings-section="book"]')).toBeNull()
    expect(screen.queryByText('③ 项目登记册')).toBeNull()
  })

  it('STANDALONE → the 收窄版 ①②④ (NO 登记册 section)', () => {
    renderSettings('STANDALONE', STANDALONE_PATH, STANDALONE_RESULT)
    expect(document.querySelector('[data-settings-page][data-settings-role="STANDALONE"]')).toBeTruthy()
    for (const section of ['status', 'actions', 'locations']) {
      expect(document.querySelector(`[data-settings-section="${section}"]`), section).toBeTruthy()
    }
    expect(document.querySelector('[data-settings-section="book"]')).toBeNull()
    expect(screen.queryByText('③ 项目登记册')).toBeNull()
  })
})

/* ===================================================================== *
 * ① 当前状态 (角色 / 中枢路径 / 登记概况)
 * ===================================================================== */

describe('① 当前状态', () => {
  it('the role label, the hub path, and the 登记概况 counts (over the FULL book)', () => {
    renderSettings('HUB', HUB_PATH, HUB_RESULT_WITH_ARCHIVED)
    // HUB_RESULT_WITH_ARCHIVED: registry = [PRJ-1 active, PRJ-6 archived].
    const section = document.querySelector('[data-settings-section="status"]')!
    const values = [...section.querySelectorAll('[class*="stateValue"]')].map((el) => el.textContent)
    expect(values).toContain('中枢')
    expect(values).toContain(HUB_PATH)
    expect(values).toContain('共 2 条 · 正常 1 · 树缺失 0 · 已归档 1')
  })

  it('MANAGED: the 收窄版 ① still shows the hub path (plane-level fact)', () => {
    renderSettings('MANAGED', MANAGED_PATH, MANAGED_RESULT)
    const section = document.querySelector('[data-settings-section="status"]')!
    const values = [...section.querySelectorAll('[class*="stateValue"]')].map((el) => el.textContent)
    expect(values).toContain('受管项目')
    expect(values).toContain(HUB_PATH)
  })
})

/* ===================================================================== *
 * ② 操作 (the per-role 显隐 状态表, design §7.4)
 * ===================================================================== */

describe('② 操作 — the per-role 显隐 matrix', () => {
  it('HUB (projects present) → 重扫并连接 + the 设为中枢 state line; NO 接入, NO 解除绑定', () => {
    renderSettings('HUB', HUB_PATH, HUB_RESULT)
    expect(screen.getByRole('button', { name: '重扫并连接' })).toBeTruthy()
    expect(screen.getByText('本工作区已是研究管理中枢（设为中枢已满足）。')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '接入' })).toBeNull()
    expect(screen.queryByRole('button', { name: '解除绑定' })).toBeNull()
  })

  it('HUB (EMPTY hub) → 接入 appears (the 登记第一个研究项目 flow, fail-loud shape)', () => {
    renderSettings('HUB', HUB_RESULT_AT_UNREGISTERED.session!.cwd, HUB_RESULT_AT_UNREGISTERED)
    expect(screen.getByRole('button', { name: '重扫并连接' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '接入' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '解除绑定' })).toBeNull()
  })

  it('MANAGED → 解除绑定 appears; NO 接入 (the project is already registered)', () => {
    renderSettings('MANAGED', MANAGED_PATH, MANAGED_RESULT)
    expect(screen.getByRole('button', { name: '重扫并连接' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '解除绑定' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '接入' })).toBeNull()
    expect(screen.queryByRole('button', { name: '接入研究管理系统' })).toBeNull()
  })

  it('STANDALONE (hub exists) → 接入研究管理系统 appears', () => {
    renderSettings('STANDALONE', STANDALONE_PATH, STANDALONE_RESULT)
    expect(screen.getByRole('button', { name: '重扫并连接' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '接入研究管理系统' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '解除绑定' })).toBeNull()
  })

  it('STANDALONE (no hub) → 设为中枢 appears (the §7.4 ② 「设为中枢(无中枢时)」 + §5 状态表), NO 接入', () => {
    renderSettings('STANDALONE', STANDALONE_RESULT_AT_UNREGISTERED.session!.cwd, STANDALONE_RESULT_AT_UNREGISTERED)
    expect(screen.getByRole('button', { name: '重扫并连接' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '设为中枢' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '接入研究管理系统' })).toBeNull()
    expect(screen.queryByRole('button', { name: '解除绑定' })).toBeNull()
  })

  it('重扫并连接 fires rescan({}) + the shell re-fetch', async () => {
    const faces = renderSettings('HUB', HUB_PATH, HUB_RESULT)
    fireEvent.click(screen.getByRole('button', { name: '重扫并连接' }))
    await act(async () => {})
    expect(faces.rescan).toHaveBeenCalledTimes(1)
    expect(faces.rescan).toHaveBeenCalledWith({})
    expect(faces.onApplied).toHaveBeenCalledTimes(1)
  })
})

/* ===================================================================== *
 * 设为中枢 confirm dialog (STANDALONE + no hub — the 引导卡 setHub flow
 * repositioned: marker + EMPTY registry, the own tree stays STANDALONE)
 * ===================================================================== */

describe('设为中枢 confirm dialog (STANDALONE + no hub)', () => {
  const NOHUB_CWD = STANDALONE_RESULT_AT_UNREGISTERED.session!.cwd!

  it('opens on the STANDALONE 设为中枢 click with the marker + registry copy', () => {
    renderSettings('STANDALONE', NOHUB_CWD, STANDALONE_RESULT_AT_UNREGISTERED)
    fireEvent.click(screen.getByRole('button', { name: '设为中枢' }))
    const dialog = screen.getByRole('dialog', { name: '设为研究管理中枢' })
    expect(within(dialog).getByText(/将在本工作区创建/)).toBeTruthy()
    expect(within(dialog).getByText(/registry\.yaml/)).toBeTruthy()
    // The own-tree state copy: the db never moves (the §3.1 物理形状).
    expect(within(dialog).getByText(/保持独立模式/)).toBeTruthy()
  })

  it('取消 is inert: no RPC, no re-fetch, the dialog closes', async () => {
    const faces = renderSettings('STANDALONE', NOHUB_CWD, STANDALONE_RESULT_AT_UNREGISTERED)
    fireEvent.click(screen.getByRole('button', { name: '设为中枢' }))
    const dialog = screen.getByRole('dialog', { name: '设为研究管理中枢' })
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))
    await act(async () => {})
    expect(screen.queryByRole('dialog', { name: '设为研究管理中枢' })).toBeNull()
    expect(faces.setHub).not.toHaveBeenCalled()
    expect(faces.onApplied).not.toHaveBeenCalled()
  })

  it('confirm fires setHub with the session wsPath + the shell re-fetch, and closes', async () => {
    const faces = renderSettings('STANDALONE', NOHUB_CWD, STANDALONE_RESULT_AT_UNREGISTERED)
    fireEvent.click(screen.getByRole('button', { name: '设为中枢' }))
    const dialog = screen.getByRole('dialog', { name: '设为研究管理中枢' })
    fireEvent.click(within(dialog).getByRole('button', { name: '设为中枢' }))
    await act(async () => {})
    expect(faces.setHub).toHaveBeenCalledTimes(1)
    expect(faces.setHub).toHaveBeenCalledWith({ wsPath: NOHUB_CWD })
    expect(faces.onApplied).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog', { name: '设为研究管理中枢' })).toBeNull()
  })

  it('a rejected 设为中枢: the dialog closes, the ② fault line answers, NO re-fetch', async () => {
    const msg = 'research shell: setHub failed — PLANE_HUB_MARKER_EXISTS: a .research-control/ marker already exists'
    const faces = renderSettings('STANDALONE', NOHUB_CWD, STANDALONE_RESULT_AT_UNREGISTERED, {
      setHub: vi.fn(async (): Promise<SetHubResult> => {
        throw new Error(msg)
      }),
    })
    fireEvent.click(screen.getByRole('button', { name: '设为中枢' }))
    const dialog = screen.getByRole('dialog', { name: '设为研究管理中枢' })
    fireEvent.click(within(dialog).getByRole('button', { name: '设为中枢' }))
    await act(async () => {})
    expect(screen.queryByRole('dialog', { name: '设为研究管理中枢' })).toBeNull()
    const section = document.querySelector('[data-settings-section="actions"]')!
    expect(within(section).getByRole('alert').textContent).toContain(msg)
    expect(faces.onApplied).not.toHaveBeenCalled()
  })
})

/* ===================================================================== *
 * 解除绑定 confirm dialog (design §7.4: 明写三件事; the confirm button
 * reads 解除绑定 verbatim)
 * ===================================================================== */

describe('解除绑定 confirm dialog (the 三件事)', () => {
  it('opens on the MANAGED 解除绑定 click with the 三件事 copy', () => {
    renderSettings('MANAGED', MANAGED_PATH, MANAGED_RESULT)
    fireEvent.click(screen.getByRole('button', { name: '解除绑定' }))
    const dialog = screen.getByRole('dialog', { name: '解除绑定' })
    // 条目转归档（不删）
    expect(within(dialog).getByText(/登记册条目转归档（不删除/)).toBeTruthy()
    // `<treeDir>/` 改名 `<treeDir>.archived-<时间戳>` (the actual treeDir value)
    expect(within(dialog).getByText(/改名为/)).toBeTruthy()
    expect(within(dialog).getByText('.research.archived-〈时间戳〉/')).toBeTruthy()
    // 事件库保留在中枢
    expect(within(dialog).getByText(/事件库保留在中枢/)).toBeTruthy()
    // The confirm button reads 解除绑定 verbatim; 取消 is present.
    expect(within(dialog).getByRole('button', { name: '解除绑定' })).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: '取消' })).toBeTruthy()
  })

  it('取消 is inert: no RPC, no re-fetch, the dialog closes', async () => {
    const faces = renderSettings('MANAGED', MANAGED_PATH, MANAGED_RESULT)
    fireEvent.click(screen.getByRole('button', { name: '解除绑定' }))
    const dialog = screen.getByRole('dialog', { name: '解除绑定' })
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))
    await act(async () => {})
    expect(screen.queryByRole('dialog', { name: '解除绑定' })).toBeNull()
    expect(faces.unbindProject).not.toHaveBeenCalled()
    expect(faces.onApplied).not.toHaveBeenCalled()
  })

  it('confirm fires unbindProject with the session wsPath + the shell re-fetch, and closes', async () => {
    const faces = renderSettings('MANAGED', MANAGED_PATH, MANAGED_RESULT)
    fireEvent.click(screen.getByRole('button', { name: '解除绑定' }))
    const dialog = screen.getByRole('dialog', { name: '解除绑定' })
    fireEvent.click(within(dialog).getByRole('button', { name: '解除绑定' }))
    await act(async () => {})
    expect(faces.unbindProject).toHaveBeenCalledTimes(1)
    expect(faces.unbindProject).toHaveBeenCalledWith({ wsPath: MANAGED_PATH })
    expect(faces.onApplied).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog', { name: '解除绑定' })).toBeNull()
  })

  it('a rejected unbind: the dialog closes, the ② fault line answers, NO re-fetch', async () => {
    const msg = 'research shell: unbindProject failed — PLANE_NOT_MANAGED: no live MANAGED project at this workspace'
    const faces = renderSettings('MANAGED', MANAGED_PATH, MANAGED_RESULT, {
      unbindProject: vi.fn(async (): Promise<UnbindProjectResult> => {
        throw new Error(msg)
      }),
    })
    fireEvent.click(screen.getByRole('button', { name: '解除绑定' }))
    const dialog = screen.getByRole('dialog', { name: '解除绑定' })
    fireEvent.click(within(dialog).getByRole('button', { name: '解除绑定' }))
    await act(async () => {})
    expect(screen.queryByRole('dialog', { name: '解除绑定' })).toBeNull()
    const section = document.querySelector('[data-settings-section="actions"]')!
    expect(within(section).getByRole('alert')).toBeTruthy()
    expect(within(section).getByRole('alert').textContent).toContain(msg)
    expect(faces.onApplied).not.toHaveBeenCalled()
  })
})

/* ===================================================================== *
 * 接入 flow (the 引导卡 displayName flow repositioned)
 * ===================================================================== */

describe('接入 flow', () => {
  it('STANDALONE (hub exists): the dialog prefills the folder name; confirm registers WITHOUT scaffold (the tree is present)', async () => {
    const faces = renderSettings('STANDALONE', STANDALONE_PATH, STANDALONE_RESULT)
    fireEvent.click(screen.getByRole('button', { name: '接入研究管理系统' }))
    const dialog = screen.getByRole('dialog', { name: '接入研究管理系统' })
    const input = within(dialog).getByLabelText('项目显示名') as HTMLInputElement
    // The prefilled display name is the cwd's folder name.
    expect(input.value).toBe('standalone')
    fireEvent.click(within(dialog).getByRole('button', { name: '接入研究管理系统' }))
    await act(async () => {})
    expect(faces.bindProject).toHaveBeenCalledTimes(1)
    // Exact match: NO scaffold key (the host finds the existing tree).
    expect(faces.bindProject).toHaveBeenCalledWith({ wsPath: STANDALONE_PATH, displayName: 'standalone' })
    expect(faces.onApplied).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog', { name: '接入研究管理系统' })).toBeNull()
  })

  it('HUB (empty hub): confirm carries scaffold:true (the 引导卡 shape — the host refuses the hub-workspace bind and the fault line answers)', async () => {
    const cwd = HUB_RESULT_AT_UNREGISTERED.session!.cwd!
    const msg = 'research shell: bindProject failed — PLANE_HUB_WORKSPACE: the hub workspace cannot be registered as a project'
    const faces = renderSettings('HUB', cwd, HUB_RESULT_AT_UNREGISTERED, {
      bindProject: vi.fn(async (): Promise<BindProjectResult> => {
        throw new Error(msg)
      }),
    })
    fireEvent.click(screen.getByRole('button', { name: '接入' }))
    const dialog = screen.getByRole('dialog', { name: '接入' })
    const input = within(dialog).getByLabelText('项目显示名') as HTMLInputElement
    expect(input.value).toBe('unregistered')
    fireEvent.click(within(dialog).getByRole('button', { name: '接入' }))
    await act(async () => {})
    expect(faces.bindProject).toHaveBeenCalledTimes(1)
    expect(faces.bindProject).toHaveBeenCalledWith({
      wsPath: cwd,
      displayName: 'unregistered',
      scaffold: true,
    })
    // Fail-loud (the T5.1 pinned behavior): the dialog closes, the ② fault
    // line shows the host error, NO re-fetch.
    expect(screen.queryByRole('dialog', { name: '接入' })).toBeNull()
    const section = document.querySelector('[data-settings-section="actions"]')!
    expect(within(section).getByRole('alert').textContent).toContain(msg)
    expect(faces.onApplied).not.toHaveBeenCalled()
  })

  it('cancel the 接入 dialog: no RPC', async () => {
    const faces = renderSettings('STANDALONE', STANDALONE_PATH, STANDALONE_RESULT)
    fireEvent.click(screen.getByRole('button', { name: '接入研究管理系统' }))
    const dialog = screen.getByRole('dialog', { name: '接入研究管理系统' })
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))
    await act(async () => {})
    expect(screen.queryByRole('dialog', { name: '接入研究管理系统' })).toBeNull()
    expect(faces.bindProject).not.toHaveBeenCalled()
    expect(faces.onApplied).not.toHaveBeenCalled()
  })
})

/* ===================================================================== *
 * ③ 项目登记册 (HUB only — the standing relief channel)
 * ===================================================================== */

describe('③ 项目登记册 (the book)', () => {
  it('renders the book rows in declaration order with the derived 正常 status + [重验]', () => {
    renderSettings('HUB', HUB_PATH, HUB_RESULT)
    const section = document.querySelector('[data-settings-section="book"]')!
    const rows = section.querySelectorAll('[data-book-row]')
    expect(rows).toHaveLength(1)
    expect(rows[0].getAttribute('data-book-id')).toBe('PRJ-1')
    expect(rows[0].getAttribute('data-book-status')).toBe('normal')
    // The row carries the id / displayName / registered path + the chip.
    expect(within(rows[0] as HTMLElement).getByText('PRJ-1')).toBeTruthy()
    expect(within(rows[0] as HTMLElement).getByText('机器人视觉定位')).toBeTruthy()
    expect(within(rows[0] as HTMLElement).getByText(MANAGED_PATH)).toBeTruthy()
    expect(within(rows[0] as HTMLElement).getByText('正常')).toBeTruthy()
    // The 登记日期 meta (boundAt, local-time YYYY-MM-DD — TZ-agnostic shape
    // assertion; the exact stamp is the fixture's 1755000000000).
    expect(within(rows[0] as HTMLElement).getByText(/登记于 \d{4}-\d{2}-\d{2}/)).toBeTruthy()
    expect(within(rows[0] as HTMLElement).queryByText(/归档于/)).toBeNull()
    // 正常 row → [重验] only.
    expect(within(rows[0] as HTMLElement).getByRole('button', { name: '重验' })).toBeTruthy()
    expect(within(rows[0] as HTMLElement).queryByRole('button', { name: '恢复登记' })).toBeNull()
  })

  it('flags the MISSING entries: an active book entry riding the `missing` segment → ⚠树缺失 + [恢复指引] [移除登记]', () => {
    // MISSING_RESULT: registry [PRJ-1, PRJ-3, PRJ-4], missing [PRJ-3 (live), PRJ-4 (deferred)] —
    // the book flags BOTH (the deferred flag gates the 弹窗, not the book).
    renderSettings('HUB', HUB_RESULT.session!.cwd!, MISSING_RESULT)
    const section = document.querySelector('[data-settings-section="book"]')!
    const rows = section.querySelectorAll('[data-book-row]')
    expect(rows).toHaveLength(3)
    expect(rows[0].getAttribute('data-book-id')).toBe('PRJ-1')
    expect(rows[0].getAttribute('data-book-status')).toBe('normal')
    expect(rows[1].getAttribute('data-book-id')).toBe('PRJ-3')
    expect(rows[1].getAttribute('data-book-status')).toBe('missing')
    expect(rows[2].getAttribute('data-book-id')).toBe('PRJ-4')
    expect(rows[2].getAttribute('data-book-status')).toBe('missing')
    // The 树缺失 row: the ⚠ chip + the two standing-relief actions.
    const prj3 = rows[1] as HTMLElement
    expect(within(prj3).getByText('⚠树缺失')).toBeTruthy()
    expect(within(prj3).getByRole('button', { name: '恢复指引' })).toBeTruthy()
    expect(within(prj3).getByRole('button', { name: '移除登记' })).toBeTruthy()
    expect(within(prj3).queryByRole('button', { name: '重验' })).toBeNull()
  })

  it('[重验] fires rescan({}) + the shell re-fetch', async () => {
    const faces = renderSettings('HUB', HUB_PATH, HUB_RESULT)
    const row = document.querySelector('[data-book-row][data-book-id="PRJ-1"]') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: '重验' }))
    await act(async () => {})
    expect(faces.rescan).toHaveBeenCalledTimes(1)
    expect(faces.rescan).toHaveBeenCalledWith({})
    expect(faces.onApplied).toHaveBeenCalledTimes(1)
  })

  it('[恢复指引] expands the inline guide (the restore recipe, no RPC) and toggles closed', async () => {
    const faces = renderSettings('HUB', HUB_RESULT.session!.cwd!, MISSING_RESULT)
    const row = document.querySelector('[data-book-row][data-book-id="PRJ-3"]') as HTMLElement
    expect(document.querySelector('[data-book-guide]')).toBeNull()
    fireEvent.click(within(row).getByRole('button', { name: '恢复指引' }))
    await act(async () => {})
    const guide = document.querySelector('[data-book-guide]')!
    // The guide names the exact restore target: <entry.path>/<treeDir>.
    expect(guide.textContent).toContain(`${REGISTRY_ENTRY_PRJ3.path}/.research`)
    expect(faces.rescan).not.toHaveBeenCalled()
    expect(faces.onApplied).not.toHaveBeenCalled()
    // Toggle closed.
    fireEvent.click(within(row).getByRole('button', { name: '恢复指引' }))
    await act(async () => {})
    expect(document.querySelector('[data-book-guide]')).toBeNull()
  })

  it('[移除登记] fires unbindProject with the entry registered path + the shell re-fetch (the T4.3 face — the host guard decides)', async () => {
    const faces = renderSettings('HUB', HUB_RESULT.session!.cwd!, MISSING_RESULT)
    const row = document.querySelector('[data-book-row][data-book-id="PRJ-3"]') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: '移除登记' }))
    await act(async () => {})
    expect(faces.unbindProject).toHaveBeenCalledTimes(1)
    expect(faces.unbindProject).toHaveBeenCalledWith({ wsPath: REGISTRY_ENTRY_PRJ3.path })
    expect(faces.onApplied).toHaveBeenCalledTimes(1)
  })

  it('a rejected 移除登记: the ③ fault line answers, NO re-fetch (the host refused — the row stays)', async () => {
    const msg = 'research shell: unbindProject failed — PLANE_NOT_MANAGED: the entry has no live tree (it is MISSING)'
    const faces = renderSettings('HUB', HUB_RESULT.session!.cwd!, MISSING_RESULT, {
      unbindProject: vi.fn(async (): Promise<UnbindProjectResult> => {
        throw new Error(msg)
      }),
    })
    const row = document.querySelector('[data-book-row][data-book-id="PRJ-3"]') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: '移除登记' }))
    await act(async () => {})
    const section = document.querySelector('[data-settings-section="book"]')!
    expect(within(section).getByRole('alert').textContent).toContain(msg)
    expect(faces.onApplied).not.toHaveBeenCalled()
    // The row stays (no local patch — the re-fetch is the only state change).
    expect(document.querySelector('[data-book-row][data-book-id="PRJ-3"]')).toBeTruthy()
  })

  it('the ARCHIVED row renders 已归档 + [恢复登记]; the confirm fires restoreProject with the entry id + the shell re-fetch', async () => {
    const faces = renderSettings('HUB', HUB_PATH, HUB_RESULT_WITH_ARCHIVED)
    const row = document.querySelector('[data-book-row][data-book-id="PRJ-6"]') as HTMLElement
    expect(row).toBeTruthy()
    expect(row.getAttribute('data-book-status')).toBe('archived')
    expect(within(row).getByText('已归档')).toBeTruthy()
    // The ARCHIVED row carries BOTH lifecycle stamps (the 归档于 date is
    // the restore rename's `<ts>` suffix, the 恢复登记 evidence).
    expect(within(row).getByText(/登记于 \d{4}-\d{2}-\d{2}/)).toBeTruthy()
    expect(within(row).getByText(/归档于 \d{4}-\d{2}-\d{2}/)).toBeTruthy()
    expect(within(row).queryByRole('button', { name: '重验' })).toBeNull()
    fireEvent.click(within(row).getByRole('button', { name: '恢复登记' }))
    await act(async () => {})
    expect(faces.restoreProject).toHaveBeenCalledTimes(1)
    expect(faces.restoreProject).toHaveBeenCalledWith({ projectId: 'PRJ-6' })
    expect(faces.onApplied).toHaveBeenCalledTimes(1)
  })

  it('a rejected 恢复登记: the ③ fault line answers, NO re-fetch (the row stays 已归档)', async () => {
    const msg = 'research shell: restoreProject failed — PLANE_ARCHIVED_DIR_MISSING: the archived directory was not found'
    const faces = renderSettings('HUB', HUB_PATH, HUB_RESULT_WITH_ARCHIVED, {
      restoreProject: vi.fn(async (): Promise<RestoreProjectResult> => {
        throw new Error(msg)
      }),
    })
    const row = document.querySelector('[data-book-row][data-book-id="PRJ-6"]') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: '恢复登记' }))
    await act(async () => {})
    const section = document.querySelector('[data-settings-section="book"]')!
    expect(within(section).getByRole('alert').textContent).toContain(msg)
    expect(faces.onApplied).not.toHaveBeenCalled()
    expect(document.querySelector('[data-book-row][data-book-id="PRJ-6"]')).toBeTruthy()
  })

  it('an empty registry → the 空册 state line (no rows)', () => {
    renderSettings('HUB', HUB_RESULT_AT_UNREGISTERED.session!.cwd!, HUB_RESULT_AT_UNREGISTERED)
    const section = document.querySelector('[data-settings-section="book"]')!
    expect(within(section).getByText('登记册为空（尚无登记项目）。')).toBeTruthy()
    expect(section.querySelector('[data-book-row]')).toBeNull()
  })
})

/* ===================================================================== *
 * ④ 数据位置 (只读透明化 — the §3.3 layout, client-derived)
 * ===================================================================== */

describe('④ 数据位置 (the §3.3 layout)', () => {
  it('HUB → the registry.yaml + every entry db (the hub) + every standalone db (the tree state dir)', () => {
    renderSettings('HUB', HUB_PATH, HUB_RESULT)
    const section = document.querySelector('[data-settings-section="locations"]')!
    const paths = [...section.querySelectorAll('[class*="locationPath"]')].map((el) => el.textContent)
    expect(paths).toContain(`${HUB_PATH}/.research-control/registry.yaml`)
    // PRJ-1 (MANAGED): the hub db.
    expect(paths).toContain(`${HUB_PATH}/.research-control/projects/PRJ-1/research.sqlite`)
    // PRJ-2 (STANDALONE): the tree-local db (no registry entry).
    expect(paths).toContain(`${STANDALONE_PATH}/.research/state/research.sqlite`)
    expect(paths).toHaveLength(3)
  })

  it('an ARCHIVED entry keeps its hub db row (the 库留中枢 — the db never leaves the hub)', () => {
    renderSettings('HUB', HUB_PATH, HUB_RESULT_WITH_ARCHIVED)
    const section = document.querySelector('[data-settings-section="locations"]')!
    const paths = [...section.querySelectorAll('[class*="locationPath"]')].map((el) => el.textContent)
    expect(paths).toContain(`${HUB_PATH}/.research-control/projects/PRJ-6/research.sqlite`)
  })

  it('MANAGED → the own hub db (the project console sees its single location)', () => {
    renderSettings('MANAGED', MANAGED_PATH, MANAGED_RESULT)
    const section = document.querySelector('[data-settings-section="locations"]')!
    const paths = [...section.querySelectorAll('[class*="locationPath"]')].map((el) => el.textContent)
    expect(paths).toEqual([`${HUB_PATH}/.research-control/projects/PRJ-1/research.sqlite`])
  })

  it('STANDALONE → the own tree-local db', () => {
    renderSettings('STANDALONE', STANDALONE_PATH, STANDALONE_RESULT)
    const section = document.querySelector('[data-settings-section="locations"]')!
    const paths = [...section.querySelectorAll('[class*="locationPath"]')].map((el) => el.textContent)
    expect(paths).toEqual([`${STANDALONE_PATH}/.research/state/research.sqlite`])
  })
})
