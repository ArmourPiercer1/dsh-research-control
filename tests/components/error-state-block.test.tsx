// @vitest-environment jsdom
/**
 * UI-9 D3 — the B §33.3 four-field error-state block (container tests).
 *
 * Coverage (BRIEF D3 test line — 四字段渲染 + retry 规则):
 *  - the four elements render (what failed / affected scope / whether
 *    data changed / the detail line) + the data-* hooks
 *    (data-error-state / data-error-code / data-error-data-changed,
 *    data-error-what-failed / data-error-scope / data-error-detail);
 *  - the [RETRY] rule: user-initiated re-send only — the button
 *    renders iff mapping.retryable AND an onRetry is supplied; it
 *    re-fires the SAME call (no automatic retry exists anywhere);
 *  - group 8 fail-loud: the LP_* detail renders VERBATIM and no retry
 *    is offered;
 *  - the unknown fallback: unmapped/undecodable failures keep the raw
 *    message as the detail line (information never dropped) and omit
 *    the scope line.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ErrorStateBlock } from '../../src/client/components/error-state-block.js'
import { t } from '../../src/client/i18n/copy.js'

afterEach(cleanup)

/** A stand-in for the store's structured carrier (ResearchRpcError). */
class CarrierError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'CarrierError'
    this.code = code
  }
}

describe('ErrorStateBlock — the B §33.3 four fields', () => {
  it('renders all four elements + the data-* hooks for a mapped carrier string', () => {
    render(<ErrorStateBlock error="[research-control] GIT_CONFLICT: merge conflict at refs/heads/main" />)
    const block = screen.getByRole('alert')
    expect(block.getAttribute('data-error-state')).toBe('git')
    expect(block.getAttribute('data-error-code')).toBe('GIT_CONFLICT')
    expect(block.getAttribute('data-error-data-changed')).toBe('none')

    expect(screen.getByText(t('error.whatFailed.gitOperation')).getAttribute('data-error-what-failed')).not.toBeNull()
    expect(screen.getByText(t('error.scope.gitCheckpoint')).getAttribute('data-error-scope')).not.toBeNull()
    expect(screen.getByText(t('error.dataChanged.none'))).toBeDefined()
    expect(
      screen.getByText('merge conflict at refs/heads/main').getAttribute('data-error-detail'),
    ).not.toBeNull()
  })

  it('renders the fields from the structured carrier (typed code, no re-match)', () => {
    render(<ErrorStateBlock error={new CarrierError('IV_ILLEGAL_TRANSITION', 'the intervention is CLOSED')} />)
    const block = screen.getByRole('alert')
    expect(block.getAttribute('data-error-state')).toBe('lifecycle')
    expect(block.getAttribute('data-error-code')).toBe('IV_ILLEGAL_TRANSITION')
    expect(screen.getByText(t('error.whatFailed.invalidTransition'))).toBeDefined()
    expect(screen.getByText(t('error.scope.workstreamAction'))).toBeDefined()
    expect(screen.getByText('the intervention is CLOSED').getAttribute('data-error-detail')).not.toBeNull()
  })

  it('group 8 fail-loud: the LP_* detail stays verbatim, no retry', () => {
    render(
      <ErrorStateBlock
        error={new CarrierError('LP_DIR_EXISTS', 'the target directory already exists')}
        onRetry={() => {}}
      />,
    )
    const block = screen.getByRole('alert')
    expect(block.getAttribute('data-error-state')).toBe('partial-creation')
    expect(block.getAttribute('data-error-data-changed')).toBe('partial')
    // the 「数据可能已变更」 wording:
    expect(screen.getByText(t('error.dataChanged.partial'))).toBeDefined()
    expect(screen.getByText('the target directory already exists').getAttribute('data-error-detail')).not.toBeNull()
    // NO retry (partial => never), even though onRetry was supplied:
    expect(screen.queryByRole('button', { name: t('common.retry') })).toBeNull()
  })

  it('unknown fallback: raw detail preserved, scope line omitted, no retry', () => {
    render(<ErrorStateBlock error="something undecodable" onRetry={() => {}} />)
    const block = screen.getByRole('alert')
    expect(block.getAttribute('data-error-state')).toBe('unknown')
    expect(block.getAttribute('data-error-code')).toBe('unknown')
    expect(block.getAttribute('data-error-data-changed')).toBe('unknown')
    expect(screen.getByText(t('error.whatFailed.unknown'))).toBeDefined()
    expect(screen.queryByText(t('error.dataChanged.unknown'))).toBeDefined()
    // the scope line is omitted for the fallback:
    expect(document.querySelector('[data-error-scope]')).toBeNull()
    expect(screen.getByText('something undecodable').getAttribute('data-error-detail')).not.toBeNull()
    expect(screen.queryByRole('button', { name: t('common.retry') })).toBeNull()
  })
})

describe('ErrorStateBlock — the [Retry] rule', () => {
  it('shows the button when the mapping is retryable AND onRetry is supplied', () => {
    const onRetry = vi.fn()
    render(<ErrorStateBlock error="[research-control] PLANE_SESSION_UNKNOWN: cold start" onRetry={onRetry} />)
    const retry = screen.getByRole('button', { name: t('common.retry') })
    expect(retry.getAttribute('data-error-retry')).not.toBeNull()
    fireEvent.click(retry)
    fireEvent.click(retry)
    expect(onRetry).toHaveBeenCalledTimes(2)
    // the user-initiated re-send IS the retry — no automatic second call:
    expect(onRetry.mock.calls.length).toBe(2)
  })

  it('hides the button when the mapping is NOT retryable (even with onRetry)', () => {
    render(
      <ErrorStateBlock
        error="[research-control] GIT_TIMEOUT: git timed out"
        onRetry={() => {}}
      />,
    )
    const block = screen.getByRole('alert')
    expect(block.getAttribute('data-error-state')).toBe('git')
    expect(block.getAttribute('data-error-data-changed')).toBe('unknown')
    expect(screen.queryByRole('button', { name: t('common.retry') })).toBeNull()
  })

  it('hides the button when the face supplies no onRetry (an existing affordance answers)', () => {
    render(<ErrorStateBlock error="[research-control] PLANE_SESSION_UNKNOWN: cold start" />)
    expect(screen.queryByRole('button', { name: t('common.retry') })).toBeNull()
  })
})
