// UI-9 ADJ-1 — locale-aware datetime carriers (D §15.1): the
// default-locale output is byte-invariant to the pre-UI-9 helpers
// (hub-overview / intervention-stream / drilldown cockpit), and the
// zh output goes through the catalog + built-in Intl (zero deps).
//
// Date/time values are SHAPE-pinned (the repo convention — the CI TZ
// is not fixed); the relative/age labels are pure millisecond
// arithmetic and are pinned byte-exact.

import { describe, expect, it } from 'vitest'
import {
  formatEpochDate,
  formatOldestAge,
  formatRelativeTime,
  formatTime,
} from '../../src/client/i18n/datetime.js'
import { CATALOGS, t } from '../../src/client/i18n/copy.js'

const MIN = 60 * 1000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
/** a fixed clock for the deterministic relative labels */
const NOW = Date.UTC(2026, 6, 25, 12, 0, 0)

describe('i18n datetime (UI-9 ADJ-1)', () => {
  it('formatEpochDate: the YYYY-MM-DD shape, both locales', () => {
    const ms = NOW
    expect(formatEpochDate(ms)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    // the zh part must agree with the platform's zh-CN formatter
    expect(formatEpochDate(ms, 'zh')).toBe(
      new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(ms))
    )
  })

  it('formatTime: the YYYY-MM-DD HH:MM shape, both locales', () => {
    const ms = NOW
    expect(formatTime(ms)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
    expect(formatTime(ms, 'zh')).toBe(`${formatEpochDate(ms, 'zh')} ${formatTime(ms).slice(11)}`)
  })

  it('formatRelativeTime: the 5 bands, byte-exact in both locales', () => {
    expect(formatRelativeTime(NOW - 30 * 1000, NOW)).toBe('刚刚')
    expect(formatRelativeTime(NOW - 5 * MIN, NOW)).toBe('5 分钟前')
    expect(formatRelativeTime(NOW - 3 * HOUR, NOW)).toBe('3 小时前')
    expect(formatRelativeTime(NOW - 12 * DAY, NOW)).toBe('12 天前')
    // past 30 days → the absolute-date fallback (local shape)
    expect(formatRelativeTime(NOW - 40 * DAY, NOW)).toBe(formatEpochDate(NOW - 40 * DAY))
    // the zh labels are identical today (display-invariant sweep, E-1)
    for (const ago of [30 * 1000, 5 * MIN, 3 * HOUR, 12 * DAY]) {
      expect(formatRelativeTime(NOW - ago, NOW, 'zh')).toBe(formatRelativeTime(NOW - ago, NOW))
    }
    // the fallback band respects the locale's date shape
    expect(formatRelativeTime(NOW - 40 * DAY, NOW, 'zh')).toBe(formatEpochDate(NOW - 40 * DAY, 'zh'))
  })

  it('formatOldestAge: floor semantics, byte-exact in both locales', () => {
    expect(formatOldestAge(48.7)).toBe('最旧 2 天')
    expect(formatOldestAge(0.5)).toBe('最旧 <1 小时')
    expect(formatOldestAge(5.9)).toBe('最旧 5 小时')
    expect(formatOldestAge(24)).toBe('最旧 1 天')
    expect(formatOldestAge(23.9)).toBe('最旧 23 小时')
    for (const h of [48.7, 0.5, 5.9, 24, 23.9]) {
      expect(formatOldestAge(h, 'zh')).toBe(formatOldestAge(h))
    }
  })

  it('t() honors the locale override (the flip is a one-constant change)', () => {
    expect(t('app.title')).toBe('Research Control')
    expect(t('app.title', undefined, 'zh')).toBe('研究管理')
    expect(CATALOGS.en['app.title']).toBe('Research Control')
    expect(CATALOGS.zh['app.title']).toBe('研究管理')
  })
})
