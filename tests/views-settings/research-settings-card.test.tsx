// @vitest-environment jsdom
/**
 * V2-T6.1 — the DSH 设置 plugin card, component spec (design §7.5 / Q4).
 *
 * Pure-props stub face (the views-* test pattern — no real cordis, no
 * slots, no scope): `makeFace` below owns the snapshot and the `save`
 * outcome, so both gate surfaces are pinned:
 *
 *  - the VALIDATION MATRIX through the UI: `.research` /
 *    `.research-control` clean; `a/b` (any "/"), `.`, `..`, empty → the
 *    inline Chinese error AND save blocked before any write (the stub
 *    `save` is never called); a leading-dot name stays clean;
 *  - the SAVE STATE MACHINE: success (brief 已保存, drafts keep the new
 *    values), missing-rollback (the EXACT warning text
 *    「请先在磁盘上重命名文件夹，再保存」 + BOTH fields back to their
 *    pre-save values), rescan-error / write-error (the fault line, old
 *    values stay visible, no 已保存 — the no-silent-success rule);
 *  - the snapshot contract: loading / unavailable notices, draft
 *    reseed on a scope update while idle, dirty drafts NOT clobbered by
 *    an unrelated update, writable=false disables the card.
 *
 * Assertions are plain chai (repo convention — @testing-library/jest-dom
 * is not installed): `toBeTruthy()` / `toBeNull()` / `textContent`.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode, act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ResearchSettingsCard,
  type ResearchSettingsCardFace,
  type ResearchSettingsCardSnapshot,
} from '../../src/client/views/settings/research-settings-card.js'
import type {
  ResearchSettingsSaveOutcome,
  ResearchSettingsSection,
} from '../../src/shared/research-settings.js'

const DEFAULTS: ResearchSettingsSection = {
  projectTreeDir: '.research',
  hubDir: '.research-control',
}

/** A ready snapshot with both fields (stable object identity per call site). */
function ready(values: ResearchSettingsSection, writable = true): ResearchSettingsCardSnapshot {
  return { status: 'ready', values, writable }
}

/**
 * The stub face: a mutable snapshot the tests advance with `act` and a
 * `save` spy (resolves whatever outcome the test pins — the adapter's
 * §7.5 transaction is the adapter's contract to deliver).
 */
function makeFace(
  initial: ResearchSettingsCardSnapshot,
  save: (next: ResearchSettingsSection) => Promise<ResearchSettingsSaveOutcome>,
) {
  let snapshot = initial
  const listeners = new Set<() => void>()
  const saveSpy = vi.fn(save)
  const face: ResearchSettingsCardFace = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    defaults: { ...DEFAULTS },
    save: (next: ResearchSettingsSection) => saveSpy(next),
  }
  return {
    face,
    saveSpy,
    setSnapshot(next: ResearchSettingsCardSnapshot) {
      snapshot = next
      for (const listener of [...listeners]) listener()
    },
  }
}

function renderCard(face: ResearchSettingsCardFace) {
  return render(
    <StrictMode>
      <ResearchSettingsCard {...face} />
    </StrictMode>,
  )
}

function setInputValue(testId: string, value: string): void {
  const input = screen.getByTestId(testId) as HTMLInputElement
  fireEvent.change(input, { target: { value } })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/* ------------------------------------------------------------------ *
 * Snapshot states (loading / unavailable / writable)
 * ------------------------------------------------------------------ */

describe('snapshot states', () => {
  it('shows the loading line and no fields while the section loads', () => {
    const { face } = makeFace(
      { status: 'loading', values: undefined, writable: true },
      async () => ({ status: 'saved' }),
    )
    renderCard(face)
    expect(screen.getByTestId('settings-card-loading')).toBeTruthy()
    expect(screen.queryByTestId('settings-card-tree-dir')).toBeNull()
    expect(screen.queryByTestId('settings-card-save')).toBeNull()
  })

  it('shows the unavailable notice (and no editable fields) when the namespace is not served', () => {
    const { face } = makeFace(
      { status: 'unavailable', values: undefined, writable: false },
      async () => ({ status: 'saved' }),
    )
    renderCard(face)
    expect(screen.getByTestId('settings-card-unavailable')).toBeTruthy()
    expect(screen.queryByTestId('settings-card-tree-dir')).toBeNull()
    expect(screen.queryByTestId('settings-card-save')).toBeNull()
  })

  it('disables the save button when the section is read-only (writable=false)', () => {
    const { face } = makeFace(ready(DEFAULTS, false), async () => ({ status: 'saved' }))
    renderCard(face)
    expect((screen.getByTestId('settings-card-save') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByTestId('settings-card-tree-dir') as HTMLInputElement).disabled).toBe(true)
  })

  it('reseeds the drafts when the scope updates while the user is idle', () => {
    const { face, setSnapshot } = makeFace(ready(DEFAULTS), async () => ({ status: 'saved' }))
    renderCard(face)
    expect((screen.getByTestId('settings-card-tree-dir') as HTMLInputElement).value).toBe('.research')
    act(() => {
      setSnapshot(ready({ projectTreeDir: '.research-b', hubDir: '.research-control' }))
    })
    expect((screen.getByTestId('settings-card-tree-dir') as HTMLInputElement).value).toBe('.research-b')
  })

  it('does NOT clobber a dirty draft on an unrelated scope update', () => {
    const { face, setSnapshot } = makeFace(ready(DEFAULTS), async () => ({ status: 'saved' }))
    renderCard(face)
    setInputValue('settings-card-tree-dir', '.research-edited')
    act(() => {
      setSnapshot(ready(DEFAULTS)) // same values, new identity (a revision bump)
    })
    expect((screen.getByTestId('settings-card-tree-dir') as HTMLInputElement).value).toBe('.research-edited')
  })
})

/* ------------------------------------------------------------------ *
 * The validation matrix through the UI (shared frozen §7.5 rule,
 * Chinese inline errors, save blocked BEFORE any write)
 * ------------------------------------------------------------------ */

describe('validation matrix (inline Chinese errors, save blocked before any write)', () => {
  it('accepts the defaults and leading-dot names without an error', () => {
    const { face } = makeFace(ready(DEFAULTS), async () => ({ status: 'saved' }))
    renderCard(face)
    expect(screen.queryByTestId('settings-card-tree-dir-error')).toBeNull()
    expect(screen.queryByTestId('settings-card-hub-dir-error')).toBeNull()
    setInputValue('settings-card-tree-dir', '.ok')
    setInputValue('settings-card-hub-dir', '.research-control')
    expect(screen.queryByTestId('settings-card-tree-dir-error')).toBeNull()
    expect(screen.queryByTestId('settings-card-hub-dir-error')).toBeNull()
  })

  it('rejects a name containing "/" (any position) and blocks the save', () => {
    const { face, saveSpy } = makeFace(ready(DEFAULTS), async () => ({ status: 'saved' }))
    renderCard(face)
    setInputValue('settings-card-tree-dir', 'a/b')
    const error = screen.getByTestId('settings-card-tree-dir-error')
    expect(error.textContent).toContain('必须是单一路径段（不能包含 "/"）')
    const save = screen.getByTestId('settings-card-save') as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.click(save)
    expect(saveSpy).not.toHaveBeenCalled()
  })

  it('rejects "." and ".." and blocks the save', () => {
    for (const value of ['.', '..']) {
      cleanup()
      const { face, saveSpy } = makeFace(ready(DEFAULTS), async () => ({ status: 'saved' }))
      renderCard(face)
      setInputValue('settings-card-hub-dir', value)
      const error = screen.getByTestId('settings-card-hub-dir-error')
      expect(error.textContent).toContain('不能使用 "." 或 ".."')
      const save = screen.getByTestId('settings-card-save') as HTMLButtonElement
      expect(save.disabled).toBe(true)
      fireEvent.click(save)
      expect(saveSpy).not.toHaveBeenCalled()
    }
  })

  it('rejects the empty name and blocks the save', () => {
    const { face, saveSpy } = makeFace(ready(DEFAULTS), async () => ({ status: 'saved' }))
    renderCard(face)
    setInputValue('settings-card-tree-dir', '')
    const error = screen.getByTestId('settings-card-tree-dir-error')
    expect(error.textContent).toContain('目录名不能为空')
    expect((screen.getByTestId('settings-card-save') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByTestId('settings-card-save'))
    expect(saveSpy).not.toHaveBeenCalled()
  })

  it('flags the per-field error on the right field only', () => {
    const { face } = makeFace(ready(DEFAULTS), async () => ({ status: 'saved' }))
    renderCard(face)
    setInputValue('settings-card-hub-dir', '..')
    expect(screen.getByTestId('settings-card-hub-dir-error')).toBeTruthy()
    expect(screen.queryByTestId('settings-card-tree-dir-error')).toBeNull()
  })
})

/* ------------------------------------------------------------------ *
 * The save state machine (the adapter's §7.5 outcomes, rendered)
 * ------------------------------------------------------------------ */

describe('save state machine (the §7.5 outcomes)', () => {
  it('success: 已保存 appears and the drafts keep the new values', async () => {
    const { face, saveSpy } = makeFace(ready(DEFAULTS), async () => ({ status: 'saved' }))
    renderCard(face)
    setInputValue('settings-card-tree-dir', '.research-x')
    await act(async () => {
      fireEvent.click(screen.getByTestId('settings-card-save'))
    })
    expect(saveSpy).toHaveBeenCalledWith({ projectTreeDir: '.research-x', hubDir: '.research-control' })
    const saved = screen.getByTestId('settings-card-saved')
    expect(saved.textContent).toContain('已保存')
    expect((screen.getByTestId('settings-card-tree-dir') as HTMLInputElement).value).toBe('.research-x')
  })

  it('the brief 已保存 line clears on its own (~2.5s)', async () => {
    vi.useFakeTimers()
    try {
      const { face } = makeFace(ready(DEFAULTS), async () => ({ status: 'saved' }))
      renderCard(face)
      await act(async () => {
        fireEvent.click(screen.getByTestId('settings-card-save'))
      })
      expect(screen.getByTestId('settings-card-saved')).toBeTruthy()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2500)
      })
      expect(screen.queryByTestId('settings-card-saved')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('missing-rollback: the EXACT warning + BOTH fields back to pre-save values', async () => {
    const { face, saveSpy } = makeFace(ready(DEFAULTS), async () => ({
      status: 'missing',
      hubLost: true,
      hubPath: '/ws/hub',
      lostTreePaths: ['/ws/p1'],
    }))
    renderCard(face)
    setInputValue('settings-card-tree-dir', '.research-z')
    setInputValue('settings-card-hub-dir', '.hub-z')
    await act(async () => {
      fireEvent.click(screen.getByTestId('settings-card-save'))
    })
    expect(saveSpy).toHaveBeenCalledTimes(1)
    const warning = screen.getByTestId('settings-card-warning')
    expect(warning.textContent).toContain('请先在磁盘上重命名文件夹，再保存')
    expect(warning.textContent).toContain('管理中枢已失联：/ws/hub')
    expect(warning.textContent).toContain('项目树已失联：/ws/p1')
    // the UI ends on the OLD values (both fields)
    expect((screen.getByTestId('settings-card-tree-dir') as HTMLInputElement).value).toBe('.research')
    expect((screen.getByTestId('settings-card-hub-dir') as HTMLInputElement).value).toBe('.research-control')
    expect(screen.queryByTestId('settings-card-saved')).toBeNull()
  })

  it('rescan-error: the fault line, old values visible, no 已保存', async () => {
    const { face, saveSpy } = makeFace(ready(DEFAULTS), async () => ({
      status: 'rescan-error',
      message: '重扫失败（E_RESYNC: boom），已回退到原目录名',
    }))
    renderCard(face)
    setInputValue('settings-card-tree-dir', '.research-x')
    await act(async () => {
      fireEvent.click(screen.getByTestId('settings-card-save'))
    })
    expect(saveSpy).toHaveBeenCalledTimes(1)
    const fault = screen.getByTestId('settings-card-fault')
    expect(fault.textContent).toContain('重扫失败（E_RESYNC: boom），已回退到原目录名')
    expect((screen.getByTestId('settings-card-tree-dir') as HTMLInputElement).value).toBe('.research')
    expect(screen.queryByTestId('settings-card-saved')).toBeNull()
    expect(screen.queryByTestId('settings-card-warning')).toBeNull()
  })

  it('write-error: treated like any fault (old values stay, no 已保存)', async () => {
    const { face } = makeFace(ready(DEFAULTS), async () => ({
      status: 'write-error',
      message: '写入设置失败（E_SCOPE: denied），已保留原目录名',
    }))
    renderCard(face)
    setInputValue('settings-card-hub-dir', '.hub-x')
    await act(async () => {
      fireEvent.click(screen.getByTestId('settings-card-save'))
    })
    const fault = screen.getByTestId('settings-card-fault')
    expect(fault.textContent).toContain('写入设置失败（E_SCOPE: denied），已保留原目录名')
    expect((screen.getByTestId('settings-card-hub-dir') as HTMLInputElement).value).toBe('.research-control')
    expect(screen.queryByTestId('settings-card-saved')).toBeNull()
  })

  it('shows 保存中… while the transaction runs and keeps the card frozen', async () => {
    let resolveSave: ((o: ResearchSettingsSaveOutcome) => void) | undefined
    const { face } = makeFace(ready(DEFAULTS), (next) =>
      new Promise((resolve) => {
        resolveSave = resolve
      }),
    )
    renderCard(face)
    setInputValue('settings-card-tree-dir', '.research-x')
    await act(async () => {
      fireEvent.click(screen.getByTestId('settings-card-save'))
    })
    const save = screen.getByTestId('settings-card-save')
    expect(save.textContent).toContain('保存中…')
    expect((save as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByTestId('settings-card-tree-dir') as HTMLInputElement).disabled).toBe(true)
    await act(async () => {
      resolveSave?.({ status: 'saved' })
    })
    await waitFor(() => expect(screen.getByTestId('settings-card-saved')).toBeTruthy())
  })
})
