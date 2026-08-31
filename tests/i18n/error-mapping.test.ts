/**
 * UI-9 D3 — the single error-state mapping table (B §33.3 / BRIEF D3).
 *
 * Unit coverage (BRIEF D3 test line):
 *  - the 9-group FULL VOCABULARY: every one of the 48 codes is mapped
 *    (no unmapped RECON §4.2 code, no stray code outside the nine
 *    groups + the ADJ-11 host codes);
 *  - the PLANE family's 13 codes TARGETED one by one (the BRIEF's
 *    explicit requirement);
 *  - NO ORPHAN KEY: every `error.*` catalog key is referenced by the
 *    table (whatFailed/scope), the unknown fallback,
 *    DATA_CHANGED_KEYS, or the readonly surface's key list (ADJ-11
 *    D4 — the banner renders those, not the D3 map) — and every
 *    dataChanged value used by the table has a catalog line;
 *  - the [RETRY] rule and the dataChanged rule per group;
 *  - `resolveErrorStateCode`: the single string decoder
 *    (extractResearchErrorCarrier) + the structured-carrier field read
 *    + the raw-detail fallback (information never dropped);
 *  - `lookupErrorState`: mapped vs the unknown fallback.
 */
import { describe, expect, it } from 'vitest'

import { CATALOGS } from '../../src/client/i18n/copy.js'
import { READONLY_SURFACE_KEYS } from '../../src/client/components/readonly-context.js'
import {
  DATA_CHANGED_KEYS,
  ERROR_STATE_MAP,
  lookupErrorState,
  resolveErrorStateCode,
  UNKNOWN_ERROR_STATE,
  type ErrorStateGroup,
} from '../../src/client/i18n/error-mapping.js'

/** The RECON §4.2 nine-group vocabulary at BASE (45 codes). */
const GROUP_CODES: Readonly<Record<Exclude<ErrorStateGroup, 'unknown'>, readonly string[]>> = {
  'project-unavailable': [
    'PLANE_NOT_MANAGED',
    'PLANE_SESSION_UNKNOWN',
    'PLANE_NOT_ARCHIVED',
    'PLANE_ARCHIVED_DIR_MISSING',
    'HIER_TREE_BROKEN',
  ],
  'wiring-reinitialized': ['WIRING_REINITIALIZED'],
  'read-only': ['TREE_PARTIAL', 'CONSISTENCY_MISMATCH', 'GIT_REPO_ERROR'],
  git: ['GIT_CONFLICT', 'GIT_SCOPE', 'GIT_TIMEOUT', 'GIT_WHITELIST', 'GIT_MISSING', 'GIT_ONLY'],
  'invalid-relation': [
    'OBJECT_ALREADY_EXISTS',
    'OBJECT_NOT_FOUND',
    'OWNER_MISMATCH',
    'CROSS_FIELD',
    'RELATION_DUPLICATE',
    'RELATION_REVERSE_DUPLICATE',
    'WRONG_STATE',
  ],
  lifecycle: [
    'IV_ILLEGAL_TRANSITION',
    'IV_ACTOR_FORBIDDEN',
    'IV_CONCURRENT_STATE',
    'IV_NOT_FOUND',
    'NA_WRONG_STATE',
    'BLK_WRONG_STATE',
    'OBJ_WRONG_STATE',
  ],
  stale: ['STALE_GIT', 'STALE_CAPTURE'],
  'partial-creation': [
    'LP_INPUT',
    'LP_DIR_EXISTS',
    'LP_GIT_INIT',
    'LP_MKDIR',
    'LP_METADATA',
    'LP_PARENT_INVALID',
    'LP_REGISTER',
    'LP_SCAFFOLD',
  ],
  'bind-conflict': [
    'PLANE_ALREADY_MANAGED',
    'PLANE_HUB_WORKSPACE',
    'PLANE_HUB_EXISTS',
    'PLANE_HUB_MARKER_EXISTS',
    'PLANE_TARGET_NAME_TAKEN',
    'PLANE_NOT_REGISTERED_WORKSPACE',
    'PLANE_TREE_MISSING',
    'PLANE_TREE_EXISTS',
    'PLANE_NOT_MISSING',
  ],
}

/** All 48 codes, flattened. */
const ALL_CODES: readonly string[] = Object.values(GROUP_CODES).flat()

/** A stand-in for the store's structured carrier (ResearchRpcError). */
class CarrierError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'CarrierError'
    this.code = code
  }
}

describe('ERROR_STATE_MAP — the full nine-group vocabulary', () => {
  it('maps every code exactly (48 codes, no stray entries)', () => {
    expect(Object.keys(ERROR_STATE_MAP).sort()).toEqual([...ALL_CODES].sort())
    for (const group of Object.keys(GROUP_CODES) as Array<keyof typeof GROUP_CODES>) {
      for (const code of GROUP_CODES[group]) {
        const row = ERROR_STATE_MAP[code]
        expect(row, `code ${code} must be mapped`).toBeDefined()
        expect(row.group).toBe(group)
      }
    }
  })

  it('PLANE family: the 13 codes targeted one by one (BRIEF D3)', () => {
    // group 1 — the plane-state read failures (incl. the L-5 cold-start
    // transient PLANE_SESSION_UNKNOWN):
    expect(ERROR_STATE_MAP['PLANE_NOT_MANAGED'].group).toBe('project-unavailable')
    expect(ERROR_STATE_MAP['PLANE_SESSION_UNKNOWN'].group).toBe('project-unavailable')
    expect(ERROR_STATE_MAP['PLANE_NOT_ARCHIVED'].group).toBe('project-unavailable')
    expect(ERROR_STATE_MAP['PLANE_ARCHIVED_DIR_MISSING'].group).toBe('project-unavailable')
    // group 9 — the atomic pre-application bind checks:
    expect(ERROR_STATE_MAP['PLANE_ALREADY_MANAGED'].group).toBe('bind-conflict')
    expect(ERROR_STATE_MAP['PLANE_HUB_WORKSPACE'].group).toBe('bind-conflict')
    expect(ERROR_STATE_MAP['PLANE_HUB_EXISTS'].group).toBe('bind-conflict')
    expect(ERROR_STATE_MAP['PLANE_HUB_MARKER_EXISTS'].group).toBe('bind-conflict')
    expect(ERROR_STATE_MAP['PLANE_TARGET_NAME_TAKEN'].group).toBe('bind-conflict')
    expect(ERROR_STATE_MAP['PLANE_NOT_REGISTERED_WORKSPACE'].group).toBe('bind-conflict')
    expect(ERROR_STATE_MAP['PLANE_TREE_MISSING'].group).toBe('bind-conflict')
    expect(ERROR_STATE_MAP['PLANE_TREE_EXISTS'].group).toBe('bind-conflict')
    expect(ERROR_STATE_MAP['PLANE_NOT_MISSING'].group).toBe('bind-conflict')
  })

  it('the retry rule: reads/retries per group (BRIEF D3 [Retry] line)', () => {
    const retryable = (code: string): boolean => ERROR_STATE_MAP[code].retryable
    // group 1: reads — always retryable (retry = re-fetch state):
    for (const code of GROUP_CODES['project-unavailable']) expect(retryable(code)).toBe(true)
    // group 2: the re-initialization already happened — re-fetch safe:
    expect(retryable('WIRING_REINITIALIZED')).toBe(true)
    // group 3: session-scoped, not transient — NO retry:
    for (const code of GROUP_CODES['read-only']) expect(retryable(code)).toBe(false)
    // group 4: everything retryable except GIT_TIMEOUT (re-sending a
    // timeout would just time out again, side effects unknown):
    expect(retryable('GIT_CONFLICT')).toBe(true)
    expect(retryable('GIT_SCOPE')).toBe(true)
    expect(retryable('GIT_TIMEOUT')).toBe(false)
    expect(retryable('GIT_WHITELIST')).toBe(true)
    expect(retryable('GIT_MISSING')).toBe(true)
    expect(retryable('GIT_ONLY')).toBe(true)
    // groups 5/6/7: pre-application validation — retryable:
    for (const group of ['invalid-relation', 'lifecycle', 'stale'] as const) {
      for (const code of GROUP_CODES[group]) expect(retryable(code)).toBe(true)
    }
    // group 8: partial creation — fail-loud, NO retry:
    for (const code of GROUP_CODES['partial-creation']) expect(retryable(code)).toBe(false)
    // group 9: atomic pre-application checks — retryable:
    for (const code of GROUP_CODES['bind-conflict']) expect(retryable(code)).toBe(true)
    // the fallback: never retryable:
    expect(UNKNOWN_ERROR_STATE.retryable).toBe(false)
  })

  it('the dataChanged rule: none / partial / unknown per group', () => {
    const dataChanged = (code: string): string => ERROR_STATE_MAP[code].dataChanged
    for (const code of GROUP_CODES['project-unavailable']) expect(dataChanged(code)).toBe('none')
    expect(dataChanged('WIRING_REINITIALIZED')).toBe('unknown')
    for (const code of GROUP_CODES['read-only']) expect(dataChanged(code)).toBe('unknown')
    expect(dataChanged('GIT_TIMEOUT')).toBe('unknown')
    for (const code of GROUP_CODES.git) {
      if (code !== 'GIT_TIMEOUT') expect(dataChanged(code)).toBe('none')
    }
    for (const group of ['invalid-relation', 'lifecycle', 'stale', 'bind-conflict'] as const) {
      for (const code of GROUP_CODES[group]) expect(dataChanged(code)).toBe('none')
    }
    // group 8: partial — the 「数据可能已变更」 wording:
    for (const code of GROUP_CODES['partial-creation']) expect(dataChanged(code)).toBe('partial')
    expect(UNKNOWN_ERROR_STATE.dataChanged).toBe('unknown')
  })

  it('no orphan key: every error.* catalog key is referenced, both locales', () => {
    const referenced = new Set<string>()
    for (const row of Object.values(ERROR_STATE_MAP)) {
      referenced.add(row.whatFailedKey)
      if (row.scopeKey !== null) referenced.add(row.scopeKey)
      expect(DATA_CHANGED_KEYS[row.dataChanged]).toBeDefined()
    }
    referenced.add(UNKNOWN_ERROR_STATE.whatFailedKey)
    if (UNKNOWN_ERROR_STATE.scopeKey !== null) referenced.add(UNKNOWN_ERROR_STATE.scopeKey)
    for (const key of Object.values(DATA_CHANGED_KEYS)) referenced.add(key)
    // ADJ-11 (UI-9 D4): the readonly surface's error.* keys are rendered
    // by the banner/composer (readonly-context.tsx / readonly-banner.tsx),
    // not by the D3 map — counted as referenced through the surface list.
    for (const key of READONLY_SURFACE_KEYS) referenced.add(key)

    const catalogKeys = new Set(Object.keys(CATALOGS.en))
    for (const key of catalogKeys) {
      if (!key.startsWith('error.')) continue
      expect(referenced.has(key), `orphan catalog key: ${key}`).toBe(true)
    }
    // the zh locale carries the identical key set (tsc enforces it — the
    // belt-and-braces assertion):
    expect(Object.keys(CATALOGS.zh).sort()).toEqual(Object.keys(CATALOGS.en).sort())
    for (const key of referenced) {
      expect(catalogKeys.has(key), `referenced key missing from catalog: ${key}`).toBe(true)
    }
  })
})

describe('resolveErrorStateCode — the single decode entry (NOTE-4)', () => {
  it('decodes a carrier string through extractResearchErrorCarrier', () => {
    expect(resolveErrorStateCode('[research-control] GIT_TIMEOUT: git timed out')).toEqual({
      code: 'GIT_TIMEOUT',
      detail: 'git timed out',
    })
  })

  it('reads the structured carrier (a typed field — not a second matcher)', () => {
    expect(resolveErrorStateCode(new CarrierError('LP_DIR_EXISTS', 'the target directory already exists'))).toEqual({
      code: 'LP_DIR_EXISTS',
      detail: 'the target directory already exists',
    })
  })

  it('the string decoder wins when BOTH a carrier and a code exist', () => {
    const err = new CarrierError('WRONG_CODE', '[research-control] STALE_GIT: the oid moved')
    expect(resolveErrorStateCode(err)).toEqual({ code: 'STALE_GIT', detail: 'the oid moved' })
  })

  it('an undecodable Error keeps its raw message as the detail', () => {
    expect(resolveErrorStateCode(new Error('research shell: plane-state fetch failed — X: y'))).toEqual({
      code: null,
      detail: 'research shell: plane-state fetch failed — X: y',
    })
  })

  it('a plain string / a non-Error value never drop information', () => {
    expect(resolveErrorStateCode('boom')).toEqual({ code: null, detail: 'boom' })
    expect(resolveErrorStateCode(42)).toEqual({ code: null, detail: '42' })
    expect(resolveErrorStateCode(null)).toEqual({ code: null, detail: 'null' })
  })
})

describe('lookupErrorState — mapped vs the unknown fallback', () => {
  it('returns the row for a mapped code', () => {
    expect(lookupErrorState('RELATION_DUPLICATE')).toBe(ERROR_STATE_MAP['RELATION_DUPLICATE'])
  })

  it('returns the fallback for null / unmapped codes', () => {
    expect(lookupErrorState(null)).toBe(UNKNOWN_ERROR_STATE)
    expect(lookupErrorState('NOT_A_REAL_CODE')).toBe(UNKNOWN_ERROR_STATE)
    expect(UNKNOWN_ERROR_STATE.group).toBe('unknown')
    expect(UNKNOWN_ERROR_STATE.scopeKey).toBeNull()
  })
})
