// @vitest-environment jsdom
/**
 * UI-9 D4 (ADJ-11) — the read-only surface (container tests).
 *
 * Coverage (BRIEF D4 test line — the ADJ-11 client half):
 *  - `composeProjectReadonly` (the PURE integrity → client-info
 *    composer): the absent-integrity default, the reinitialized flag,
 *    the per-code phrase map, the `, `-join in the locked code order,
 *    the grammar fallback, and the not-readonly null reason;
 *  - `ReadOnlyBanner`: renders NOTHING while the surface is writable
 *    and not re-initialized; the B §33.4 frozen three lines
 *    (data-readonly-title / -reason / -browse) with the composed
 *    reason; the wiring-reinit notice (the D3 error state 2) with the
 *    D3-compatible data-* hooks;
 *  - the [Retry] rule (B §33.3 user-triggered re-send only): the
 *    button renders iff the D3 mapping says retryable AND an
 *    onRefresh is supplied; a click re-fires the SAME call (no
 *    automatic retry exists anywhere).
 */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PlaneIntegrityDto } from '../../src/shared/rpc-contracts.js'
import { ReadOnlyBanner } from '../../src/client/components/readonly-banner.js'
import {
  INTEGRITY_CODE_CONSISTENCY_MISMATCH,
  INTEGRITY_CODE_GIT_REPO_ERROR,
  INTEGRITY_CODE_TREE_PARTIAL,
  INTEGRITY_CODE_WIRING_REINITIALIZED,
  NO_PROJECT_READONLY,
  ProjectReadonlyProvider,
  composeProjectReadonly,
} from '../../src/client/components/readonly-context.js'
import { t } from '../../src/client/i18n/copy.js'

afterEach(cleanup)

/* ==================================================================== *
 * composeProjectReadonly — the pure ADJ-11 projection
 * ==================================================================== */

describe('composeProjectReadonly — the ADJ-11 integrity projection (pure)', () => {
  it('absent integrity (null / undefined) → the absent-integrity default', () => {
    expect(composeProjectReadonly(null)).toEqual(NO_PROJECT_READONLY)
    expect(composeProjectReadonly(undefined)).toEqual(NO_PROJECT_READONLY)
  })

  it('clean gate (writable, no codes) → the writable default', () => {
    expect(composeProjectReadonly({ readOnly: false, checkCodes: [] })).toEqual(NO_PROJECT_READONLY)
  })

  it('WIRING_REINITIALIZED sets the reinitialized flag — with or without readonly', () => {
    const reinit: PlaneIntegrityDto = {
      readOnly: false,
      checkCodes: [INTEGRITY_CODE_WIRING_REINITIALIZED],
    }
    const info = composeProjectReadonly(reinit)
    expect(info.reinitialized).toBe(true)
    // the notice is NOT the banner: a writable surface composes no reason
    expect(info.readonly).toBe(false)
    expect(info.reasonText).toBeNull()
    expect(composeProjectReadonly({ readOnly: false, checkCodes: [] }).reinitialized).toBe(false)
  })

  it('readonly: each check code contributes its own phrase', () => {
    const treePartial = composeProjectReadonly({
      readOnly: true,
      checkCodes: [INTEGRITY_CODE_TREE_PARTIAL],
    })
    expect(treePartial.reasonText).toBe(t('error.readonly.treePartial'))
    const mismatch = composeProjectReadonly({
      readOnly: true,
      checkCodes: [INTEGRITY_CODE_CONSISTENCY_MISMATCH],
    })
    expect(mismatch.reasonText).toBe(t('error.readonly.consistencyMismatch'))
    const gitError = composeProjectReadonly({
      readOnly: true,
      checkCodes: [INTEGRITY_CODE_GIT_REPO_ERROR],
    })
    expect(gitError.reasonText).toBe(t('error.readonly.gitRepoError'))
  })

  it('readonly: all three phrases join with ", " in the locked code order (input order irrelevant)', () => {
    const info = composeProjectReadonly({
      readOnly: true,
      checkCodes: [
        INTEGRITY_CODE_GIT_REPO_ERROR,
        INTEGRITY_CODE_TREE_PARTIAL,
        INTEGRITY_CODE_WIRING_REINITIALIZED,
        INTEGRITY_CODE_CONSISTENCY_MISMATCH,
      ],
    })
    expect(info.reasonText).toBe(
      `${t('error.readonly.treePartial')}, ${t('error.readonly.consistencyMismatch')}, ${t('error.readonly.gitRepoError')}`,
    )
    // WIRING_REINITIALIZED is a notice code, never a banner phrase —
    // but it still flags the reinit notice:
    expect(info.reinitialized).toBe(true)
  })

  it('readonly with no phrase code → the tree-partial fallback (grammar guard)', () => {
    const info = composeProjectReadonly({ readOnly: true, checkCodes: [] })
    expect(info.reasonText).toBe(t('error.readonly.treePartial'))
  })

  it('not readonly → reasonText stays null even with phrase codes present', () => {
    const info = composeProjectReadonly({
      readOnly: false,
      checkCodes: [INTEGRITY_CODE_TREE_PARTIAL, INTEGRITY_CODE_CONSISTENCY_MISMATCH],
    })
    expect(info.reasonText).toBeNull()
    expect(info.readonly).toBe(false)
  })

  it('checkCodes pass through verbatim (the raw machine vocabulary)', () => {
    const codes = [
      INTEGRITY_CODE_TREE_PARTIAL,
      INTEGRITY_CODE_GIT_REPO_ERROR,
    ]
    expect(composeProjectReadonly({ readOnly: true, checkCodes: codes }).checkCodes).toEqual(codes)
  })
})

/* ==================================================================== *
 * ReadOnlyBanner — the B §33.4 persistent banner
 * ==================================================================== */

function renderBanner(integrity: PlaneIntegrityDto | null | undefined, onRefresh?: () => void) {
  return render(
    <ProjectReadonlyProvider integrity={integrity}>
      <ReadOnlyBanner onRefresh={onRefresh} />
    </ProjectReadonlyProvider>,
  )
}

describe('ReadOnlyBanner — the B §33.4 persistent banner', () => {
  it('writable surface without re-init → renders nothing', () => {
    renderBanner({ readOnly: false, checkCodes: [] })
    expect(document.querySelector('[data-readonly-surface]')).toBeNull()
  })

  it('absent integrity snapshot → renders nothing', () => {
    renderBanner(null)
    expect(document.querySelector('[data-readonly-surface]')).toBeNull()
  })

  it('renders the frozen three lines with the composed reason', () => {
    renderBanner({
      readOnly: true,
      checkCodes: [INTEGRITY_CODE_TREE_PARTIAL, INTEGRITY_CODE_CONSISTENCY_MISMATCH],
    })
    const banner = document.querySelector('[data-readonly-banner]')
    expect(banner).not.toBeNull()
    expect(banner!.getAttribute('role')).toBe('alert')
    expect(document.querySelector('[data-readonly-title]')!.textContent).toBe(
      t('error.readonly.title'),
    )
    const reason = t('error.readonly.reasonLine', {
      reason: `${t('error.readonly.treePartial')}, ${t('error.readonly.consistencyMismatch')}`,
    })
    expect(document.querySelector('[data-readonly-reason]')!.textContent).toBe(reason)
    expect(document.querySelector('[data-readonly-browse]')!.textContent).toBe(
      t('error.readonly.browse'),
    )
  })

  it('the re-init notice renders WITHOUT the banner (writable surface, the D3 state 2)', () => {
    renderBanner({ readOnly: false, checkCodes: [INTEGRITY_CODE_WIRING_REINITIALIZED] })
    expect(document.querySelector('[data-readonly-banner]')).toBeNull()
    const notice = document.querySelector('[data-error-state="wiring-reinitialized"]')
    expect(notice).not.toBeNull()
    expect(notice!.getAttribute('role')).toBe('status')
    expect(notice!.getAttribute('data-error-code')).toBe(INTEGRITY_CODE_WIRING_REINITIALIZED)
    expect(notice!.getAttribute('data-error-data-changed')).toBe('unknown')
    expect(document.querySelector('[data-error-what-failed]')!.textContent).toBe(
      t('error.whatFailed.wiringReinitialized'),
    )
    expect(document.querySelector('[data-error-scope]')!.textContent).toBe(
      t('error.scope.researchPlane'),
    )
    expect(document.querySelector('[data-wiring-reinit-hint]')!.textContent).toBe(
      t('error.wiringReinitialized.retryHint'),
    )
  })

  it('readonly + re-init → the banner AND the notice render together', () => {
    renderBanner({
      readOnly: true,
      checkCodes: [INTEGRITY_CODE_WIRING_REINITIALIZED, INTEGRITY_CODE_TREE_PARTIAL],
    })
    expect(document.querySelector('[data-readonly-banner]')).not.toBeNull()
    expect(document.querySelector('[data-error-state="wiring-reinitialized"]')).not.toBeNull()
  })
})

describe('ReadOnlyBanner — the [Retry] rule (user-triggered re-send only)', () => {
  it('no onRefresh → no retry button (no automatic retry exists)', () => {
    renderBanner({ readOnly: false, checkCodes: [INTEGRITY_CODE_WIRING_REINITIALIZED] })
    expect(document.querySelector('[data-error-retry]')).toBeNull()
  })

  it('onRefresh → [Retry] carries the common.retry label; a click re-fires the SAME call', () => {
    const onRefresh = vi.fn()
    renderBanner({ readOnly: false, checkCodes: [INTEGRITY_CODE_WIRING_REINITIALIZED] }, onRefresh)
    const retry = document.querySelector('[data-error-retry]') as HTMLButtonElement
    expect(retry).not.toBeNull()
    expect(retry.textContent).toBe(t('common.retry'))
    fireEvent.click(retry)
    // the SAME call re-fires, exactly once (no automatic retry exists):
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })
})
