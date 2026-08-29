/**
 * UI0 (R-01) — `rowToCurrentFocus` corrupt-row unit test (BL-01).
 *
 * Task-1 review follow-up: the bad-row path of the row→record mapper had
 * no DIRECT unit coverage — through the store, SQLite's type affinity
 * coerces most garbage into strings/numbers before the mapper sees it,
 * so the CF_STORE mapping branch was near-unreachable via SQL. This
 * suite drives the mapper with FORGED row objects (the mapper is the
 * single mapping seam; the store is a thin SQL layer above it).
 *
 * The mapper is a hard failure on every corrupt shape (a corrupt row is
 * user data the module wrote itself — nothing repairs it): CF_STORE with
 * the precise column named in the message.
 */

import { describe, expect, it } from 'vitest'
import {
  CurrentFocusError,
  isCurrentFocusError,
  rowToCurrentFocus,
} from '../../src/host/service/current-focus/index.js'

const VALID_ROW = { workstream_id: 'WS-1', plan_item_id: 'T-1', updated_at: 1_755_000_000_000 }

/** Run `fn` and assert it throws a CF_STORE CurrentFocusError naming
 *  `current_focus.<column>` in the message. */
function expectCfStore(fn: () => unknown, column: string): void {
  let caught: unknown
  try {
    fn()
  } catch (e) {
    caught = e
  }
  expect(caught, `expected ${column} to be rejected`).toBeInstanceOf(CurrentFocusError)
  expect(caught).toHaveProperty('code', 'CF_STORE')
  expect((caught as CurrentFocusError).message).toContain(`current_focus.${column}`)
}

describe('UI0 BL-01 — rowToCurrentFocus corrupt-row mapping (forged rows)', () => {
  it('maps a valid row 1:1 (column order = DDL)', () => {
    expect(rowToCurrentFocus(VALID_ROW)).toEqual({
      workstreamId: 'WS-1',
      planItemId: 'T-1',
      updatedAt: 1_755_000_000_000,
    })
  })

  it('workstream_id: non-string / empty / absent ids are CF_STORE', () => {
    for (const bad of [42, null, undefined, true, ['WS-1'], '']) {
      expectCfStore(() => rowToCurrentFocus({ ...VALID_ROW, workstream_id: bad }), 'workstream_id')
    }
  })

  it('plan_item_id: non-string / empty / absent ids are CF_STORE', () => {
    for (const bad of [0, null, undefined, 1.5, '']) {
      expectCfStore(() => rowToCurrentFocus({ ...VALID_ROW, plan_item_id: bad }), 'plan_item_id')
    }
  })

  it('updated_at: non-integer stamps (float / string / null / NaN) are CF_STORE', () => {
    for (const bad of [1.5, '1755000000000', null, undefined, NaN]) {
      expectCfStore(() => rowToCurrentFocus({ ...VALID_ROW, updated_at: bad }), 'updated_at')
    }
  })

  it('the error taxonomy guard: CF errors pass, plain Errors do not', () => {
    let caught: unknown
    try {
      rowToCurrentFocus({ ...VALID_ROW, updated_at: 'x' })
    } catch (e) {
      caught = e
    }
    expect(isCurrentFocusError(caught)).toBe(true)
    expect(isCurrentFocusError(new Error('a plain kernel error'))).toBe(false)
    expect(isCurrentFocusError(undefined)).toBe(false)
  })
})
