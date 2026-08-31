/**
 * Locale-aware datetime carriers (UI-9 ADJ-1, D §15.1: i18n-ready
 * datetime formatting — no locale-baked literals in views).
 *
 * The default-locale behavior is BYTE-INVARIANT to the pre-UI-9 helpers
 * (they lived in hub-overview.tsx / intervention-stream.tsx /
 * drilldown/cockpit.tsx and are re-exported from there for import
 * stability):
 * - EN dates/times: local-time `YYYY-MM-DD` / `YYYY-MM-DD HH:MM` via the
 *   Date getters (the existing tests pin the shape, keeping TZ stability)
 * - relative/age labels: catalog keys (attention.relTime.* / hub.oldest*)
 *   whose EN values are the pre-UI-9 literals
 * - zh: built-in Intl.DateTimeFormat('zh-CN', …) for dates (zero deps —
 *   Intl is a platform builtin, not a package)
 */

import { LOCALE, t } from './copy.js'
import type { CopyKey, Locale } from './copy.js'

/** zh date part (local time, zero-pad shape). */
function zhDatePart(epochMs: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(epochMs))
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** epoch ms → `YYYY-MM-DD` (local time, TZ-stable shape). */
export function formatEpochDate(epochMs: number, locale: Locale = LOCALE): string {
  if (locale === 'zh') return zhDatePart(epochMs)
  const d = new Date(epochMs)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** epoch ms → `YYYY-MM-DD HH:MM` (local time). `<= 0` → `—` (the
 * pre-UI-9 guard for absent timestamps — a symbol, not a translated
 * string, so it stays out of the catalog). */
export function formatTime(epochMs: number, locale: Locale = LOCALE): string {
  if (epochMs <= 0) return '—'
  const d = new Date(epochMs)
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  return locale === 'zh' ? `${zhDatePart(epochMs)} ${time}` : `${formatEpochDate(epochMs, 'en')} ${time}`
}

/**
 * epoch ms → relative label (the Needs Attention time carriers, design
 * §7.2): < 1 min → 刚刚; < 1 h → N 分钟前; < 24 h → N 小时前;
 * < 30 d → N 天前; further → the absolute date (a relative label past a
 * month is noise). `now` injectable for the tests.
 */
export function formatRelativeTime(
  epochMs: number,
  now: number = Date.now(),
  locale: Locale = LOCALE
): string {
  const delta = now - epochMs
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  if (delta < minute) return t('attention.relTime.justNow', undefined, locale)
  if (delta < hour) return t('attention.relTime.minutesAgo', { n: Math.floor(delta / minute) }, locale)
  if (delta < day) return t('attention.relTime.hoursAgo', { n: Math.floor(delta / hour) }, locale)
  if (delta < 30 * day) return t('attention.relTime.daysAgo', { n: Math.floor(delta / day) }, locale)
  return formatEpochDate(epochMs, locale)
}

/**
 * hours-since-oldest-open-intervention → 「最旧 N 天/小时」 display
 * carrier (the contract's `oldestHours` is a FLOAT — the raw value never
 * reaches the UI): ≥ 24h → whole days (floor); < 1h → 「最旧 <1 小时」;
 * otherwise whole hours (floor).
 */
export function formatOldestAge(hours: number, locale: Locale = LOCALE): string {
  const key: CopyKey =
    hours >= 24 ? 'hub.oldestDays' : hours < 1 ? 'hub.oldestLtHour' : 'hub.oldestHours'
  if (key === 'hub.oldestLtHour') return t(key, undefined, locale)
  const n = key === 'hub.oldestDays' ? Math.floor(hours / 24) : Math.floor(hours)
  return t(key, { n }, locale)
}
