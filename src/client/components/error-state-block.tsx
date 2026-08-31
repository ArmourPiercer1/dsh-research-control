/**
 * UI-9 D3 — the B §33.3 four-field error-state block.
 *
 * Renders every failed call as the frozen four elements:
 *
 *   1. what failed        -> `data-error-what-failed` (mapping wording)
 *   2. affected scope     -> `data-error-scope` (mapping wording,
 *                            omitted for the unknown fallback)
 *   3. whether data changed -> `data-error-data-changed` attribute on
 *                            the wrapper + the `error.dataChanged.*` line
 *   4. retry if safe      -> `data-error-retry` button — user-initiated
 *                            re-send of the failed call ONLY (no
 *                            automatic retry, ever); rendered iff
 *                            `mapping.retryable` AND an `onRetry` is
 *                            supplied. 'partial'/'unknown' dataChanged
 *                            => no retry (the data-changed line carries
 *                            the 「数据可能已变更」 wording).
 *
 * The detail line (`data-error-detail`) always renders: the decoded
 * carrier detail, or the raw message when undecodable — information is
 * never dropped (group 8 LP_* fail-loud detail stays verbatim).
 *
 * Wrapper hooks: `role="alert"` + `data-error-state` (the RECON §4.2
 * group) + `data-error-code` (the decoded code, 'unknown' when none).
 *
 * INV-PERM-5: pure React — no @deepseek-ai import (the error arrives as
 * a plain value the view already holds).
 */

import type { ReactElement } from 'react'

import { t } from '../i18n/copy.js'
import {
  DATA_CHANGED_KEYS,
  lookupErrorState,
  resolveErrorStateCode,
} from '../i18n/error-mapping.js'

export interface ErrorStateBlockProps {
  /** The rejected value (an `Error` — preferably the store's structured
   *  carrier — or a stored fault string). */
  readonly error: unknown
  /** The user-initiated re-send of the failed call. Omit when the face
   *  already carries its own retry affordance (e.g. a toolbar refresh)
   *  — the button renders only when BOTH the mapping is retryable and
   *  this is provided. */
  readonly onRetry?: () => void
}

export function ErrorStateBlock({ error, onRetry }: ErrorStateBlockProps): ReactElement {
  const resolved = resolveErrorStateCode(error)
  const mapping = lookupErrorState(resolved.code)
  const retryVisible = mapping.retryable && onRetry !== undefined
  return (
    <div
      role="alert"
      data-error-state={mapping.group}
      data-error-code={resolved.code ?? 'unknown'}
      data-error-data-changed={mapping.dataChanged}
    >
      <p data-error-what-failed>{t(mapping.whatFailedKey)}</p>
      {mapping.scopeKey !== null && <p data-error-scope>{t(mapping.scopeKey)}</p>}
      <p>{t(DATA_CHANGED_KEYS[mapping.dataChanged])}</p>
      <p data-error-detail>{resolved.detail}</p>
      {retryVisible && (
        <button type="button" data-error-retry onClick={() => onRetry?.()}>
          {t('common.retry')}
        </button>
      )}
    </div>
  )
}
