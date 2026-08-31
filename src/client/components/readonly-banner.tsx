/**
 * UI-9 D4 (ADJ-11) — the read-only surface: the B §33.4 persistent
 * banner + the wiring-reinit notice (the D3 error state 2).
 *
 * The B §33.4 banner (rendered while `integrity.readOnly`) is the
 * frozen three lines — title / reason / browse:
 *
 *   `Read-only mode`
 *   `This project cannot currently be modified because {reason}.`
 *   `Browsing remains available.`
 *
 * It is PERSISTENT (the shell renders it above the console bodies — it
 * stays on screen across all four first-level entries) and it carries
 * the composed reason (the gate's machine codes mapped through the
 * client catalog — see readonly-context.tsx). ALL mutation controls of
 * the scoped project consult `useProjectReadonly()` and disable
 * themselves with a tooltip carrying this same reason; browsing stays
 * available (the banner's third line is the contract).
 *
 * The wiring-reinit notice (rendered while the codes carry
 * WIRING_REINITIALIZED) is the D3 error state 2 (the same DTO field
 * doubles — ADJ-11). It renders with the D3-compatible hooks
 * (data-error-state / data-error-code / data-error-data-changed /
 * data-error-what-failed / data-error-scope / data-error-retry) and the
 * D3 mapping's wording (`lookupErrorState` — the single source), but
 * NOT through `ErrorStateBlock`: the banner's input is a plain object,
 * and the D3 decoder's raw fallback would lose the typed code (the
 * D3 architecture note — keep the D3 component pin-protected).
 */
import type { ReactElement } from 'react'

import { t } from '../i18n/copy.js'
import { lookupErrorState } from '../i18n/error-mapping.js'
import {
  INTEGRITY_CODE_WIRING_REINITIALIZED,
  useProjectReadonly,
} from './readonly-context.js'

/**
 * The persistent read-only surface (the shell renders it inside the
 * `ProjectReadonlyProvider`, above the console bodies).
 * @param props - `onRefresh` wires the reinit notice's [Retry] to the
 *   shell's plane re-fetch (the B §33.3 user-triggered re-send rule —
 *   no automatic retry; rendered iff the D3 mapping says retryable).
 * @returns the banner + notice, or `null` (nothing to report).
 */
export function ReadOnlyBanner({
  onRefresh,
}: {
  readonly onRefresh?: () => void
}): ReactElement | null {
  const info = useProjectReadonly()
  if (!info.readonly && !info.reinitialized) return null
  const reinitMapping = lookupErrorState(INTEGRITY_CODE_WIRING_REINITIALIZED)
  return (
    <div data-readonly-surface>
      {info.readonly && (
        <div data-readonly-banner role="alert">
          <p data-readonly-title>{t('error.readonly.title')}</p>
          <p data-readonly-reason>{t('error.readonly.reasonLine', { reason: info.reasonText ?? '' })}</p>
          <p data-readonly-browse>{t('error.readonly.browse')}</p>
        </div>
      )}
      {info.reinitialized && (
        <div
          role="status"
          data-error-state={reinitMapping.group}
          data-error-code={INTEGRITY_CODE_WIRING_REINITIALIZED}
          data-error-data-changed={reinitMapping.dataChanged}
        >
          <p data-error-what-failed>{t(reinitMapping.whatFailedKey)}</p>
          {reinitMapping.scopeKey !== null && <p data-error-scope>{t(reinitMapping.scopeKey)}</p>}
          <p data-wiring-reinit-hint>{t('error.wiringReinitialized.retryHint')}</p>
          {reinitMapping.retryable && onRefresh !== undefined && (
            <button type="button" data-error-retry onClick={onRefresh}>
              {t('common.retry')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
