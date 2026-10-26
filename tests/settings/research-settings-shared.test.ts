/**
 * V2-T6.1 — the research settings shared core (design §7.5 / Q4):
 * the pure validation rule + i18n classifier, the §7.5
 * `findLostDiscovery` verification core, and the host re-export parity
 * (the host half moved the pure rule into `src/shared/` — the host
 * `validateDirName` MUST be the shared function, and the frozen host
 * face — constants, namespace, schema — is unchanged).
 *
 * Pure unit test — no cordis, no fakes beyond plain snapshot objects.
 */

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_HUB_DIR,
  DEFAULT_PROJECT_TREE_DIR,
  MAX_DIR_NAME_LENGTH,
  RESEARCH_SETTINGS_ENTRY_ID,
  RESEARCH_SETTINGS_NAMESPACE,
  classifyDirNameViolation,
  deriveSettingsSectionFromRaw,
  findLostDiscovery,
  validateDirName,
} from '../../src/shared/research-settings.js'
import {
  DEFAULT_HUB_DIR as HOST_DEFAULT_HUB_DIR,
  DEFAULT_PROJECT_TREE_DIR as HOST_DEFAULT_PROJECT_TREE_DIR,
  MAX_DIR_NAME_LENGTH as HOST_MAX_DIR_NAME_LENGTH,
  RESEARCH_SETTINGS_ENTRY_ID as HOST_ENTRY_ID,
  RESEARCH_SETTINGS_NAMESPACE as HOST_NAMESPACE,
  validateDirName as hostValidateDirName,
  type ResearchSettings as HostResearchSettings,
} from '../../src/host/dsh-adapter/host/settings.js'
import type {
  PlaneMissingDto,
  PlaneProjectDto,
  PlaneStateSummary,
} from '../../src/shared/rpc-contracts.js'

/* ------------------------------------------------------------------ *
 * The validation rule (frozen §7.5 — single segment, leading dot ok,
 * no "/", no "."/"..", non-empty, ≤ 64)
 * ------------------------------------------------------------------ */

describe('validateDirName + classifyDirNameViolation (shared pure core, frozen §7.5 rule)', () => {
  it('accepts the defaults and ordinary names (leading dot allowed)', () => {
    expect(validateDirName('.research')).toBeNull()
    expect(validateDirName('.research-control')).toBeNull()
    expect(validateDirName('mytree')).toBeNull()
    expect(validateDirName('a')).toBeNull()
    expect(validateDirName('.a')).toBeNull()
    expect(validateDirName('..a')).toBeNull()
    expect(validateDirName('a..b')).toBeNull()
    expect(classifyDirNameViolation('.research')).toBeNull()
  })

  it('accepts the max length exactly (64)', () => {
    expect(validateDirName('a'.repeat(MAX_DIR_NAME_LENGTH))).toBeNull()
    expect(classifyDirNameViolation('a'.repeat(MAX_DIR_NAME_LENGTH))).toBeNull()
  })

  it('rejects empty with the "empty" class', () => {
    expect(validateDirName('')).toBe('must not be empty')
    expect(classifyDirNameViolation('')).toBe('empty')
  })

  it('rejects names over 64 with the "too-long" class (counting the actual length)', () => {
    expect(validateDirName('a'.repeat(65))).toBe('must be at most 64 characters (got 65)')
    expect(classifyDirNameViolation('a'.repeat(65))).toBe('too-long')
  })

  it('rejects any "/" with the "slash" class (single path segment)', () => {
    for (const value of ['a/b', 'a//b', '/a', 'a/']) {
      expect(validateDirName(value)).toBe('must be a single path segment (no "/")')
      expect(classifyDirNameViolation(value)).toBe('slash')
    }
  })

  it('rejects the literal "." and ".." with the "dot" class', () => {
    expect(validateDirName('.')).toBe('must not be "." or ".."')
    expect(validateDirName('..')).toBe('must not be "." or ".."')
    expect(classifyDirNameViolation('.')).toBe('dot')
    expect(classifyDirNameViolation('..')).toBe('dot')
  })
})

/* ------------------------------------------------------------------ *
 * Host re-export parity (the pure core moved to shared; the frozen
 * host face is unchanged)
 * ------------------------------------------------------------------ */

describe('host re-export parity (host settings.ts re-exports the shared core)', () => {
  it('the host validateDirName IS the shared function (identity, not a copy)', () => {
    expect(hostValidateDirName).toBe(validateDirName)
  })

  it('the frozen constants are the shared values', () => {
    expect(HOST_NAMESPACE).toBe(RESEARCH_SETTINGS_NAMESPACE)
    expect(HOST_NAMESPACE).toBe('dsh-research-control')
    expect(HOST_DEFAULT_PROJECT_TREE_DIR).toBe(DEFAULT_PROJECT_TREE_DIR)
    expect(HOST_DEFAULT_PROJECT_TREE_DIR).toBe('.research')
    expect(HOST_DEFAULT_HUB_DIR).toBe(DEFAULT_HUB_DIR)
    expect(HOST_DEFAULT_HUB_DIR).toBe('.research-control')
    expect(HOST_MAX_DIR_NAME_LENGTH).toBe(MAX_DIR_NAME_LENGTH)
    expect(HOST_MAX_DIR_NAME_LENGTH).toBe(64)
  })

  it('the host ResearchSettings type is the shared section shape (compile-time identity spot check)', () => {
    const sample: HostResearchSettings = { projectTreeDir: '.research', hubDir: '.research-control' }
    expect(sample).toEqual({ projectTreeDir: DEFAULT_PROJECT_TREE_DIR, hubDir: DEFAULT_HUB_DIR })
  })
})

/* ------------------------------------------------------------------ *
 * findLostDiscovery (the §7.5 two-phase save verification core)
 * ------------------------------------------------------------------ */

function project(projectId: string, wsPath: string, kind: 'MANAGED' | 'STANDALONE' = 'MANAGED'): PlaneProjectDto {
  return { projectId, displayName: projectId, kind, wsPath }
}

function missing(wsPath: string): PlaneMissingDto {
  return { projectId: 'PRJ-X', displayName: 'X', wsPath, deferred: false }
}

function summary(partial: {
  hub?: { path: string } | null
  projects?: readonly PlaneProjectDto[]
  missing?: readonly PlaneMissingDto[]
}): Pick<PlaneStateSummary, 'hub' | 'projects' | 'missing'> {
  return {
    hub: partial.hub ?? null,
    projects: partial.projects ?? [],
    missing: partial.missing ?? [],
  }
}

describe('findLostDiscovery (pre-save vs post-save discovery)', () => {
  it('reports nothing lost when the rename kept everything detected', () => {
    const pre = summary({
      hub: { path: '/ws/hub' },
      projects: [project('PRJ-1', '/ws/p1'), project('PRJ-2', '/ws/p2')],
    })
    const post = summary({
      hub: { path: '/ws/hub' },
      projects: [project('PRJ-1', '/ws/p1'), project('PRJ-2', '/ws/p2')],
    })
    // hubPath reports the pre-save hub path regardless (the consumer gates
    // on hubLost — LostDiscovery.hubPath docs).
    expect(findLostDiscovery(pre, post)).toEqual({
      hubLost: false,
      hubPath: '/ws/hub',
      lostTreePaths: [],
    })
  })

  it('flags a pre-save hub the rescan no longer finds (hub → null)', () => {
    const pre = summary({ hub: { path: '/ws/hub' } })
    const post = summary({ hub: null })
    expect(findLostDiscovery(pre, post)).toEqual({ hubLost: true, hubPath: '/ws/hub', lostTreePaths: [] })
  })

  it('flags a hub whose workspace path moved (a different hub stands)', () => {
    const pre = summary({ hub: { path: '/ws/hub-old' } })
    const post = summary({ hub: { path: '/ws/hub-new' } })
    expect(findLostDiscovery(pre, post)).toEqual({ hubLost: true, hubPath: '/ws/hub-old', lostTreePaths: [] })
  })

  it('does not flag a hub the plane never had (pre null, post anything)', () => {
    const pre = summary({ hub: null })
    const post = summary({ hub: { path: '/ws/hub' } })
    expect(findLostDiscovery(pre, post)).toEqual({ hubLost: false, hubPath: null, lostTreePaths: [] })
  })

  it('flags every pre-save detected tree the rescan no longer finds', () => {
    const pre = summary({ projects: [project('PRJ-1', '/ws/p1'), project('PRJ-2', '/ws/p2')] })
    const post = summary({ projects: [project('PRJ-1', '/ws/p1')] })
    expect(findLostDiscovery(pre, post)).toEqual({
      hubLost: false,
      hubPath: null,
      lostTreePaths: ['/ws/p2'],
    })
  })

  it('keeps order and deduplicates nothing the post set still holds by path', () => {
    const pre = summary({ projects: [project('PRJ-2', '/ws/p2'), project('PRJ-3', '/ws/p3')] })
    const post = summary({ projects: [project('PRJ-9', '/ws/p3')] })
    expect(findLostDiscovery(pre, post).lostTreePaths).toEqual(['/ws/p2'])
  })

  it('does NOT count pre-existing missing entries (the rename is not responsible for prior losses)', () => {
    const pre = summary({ missing: [missing('/ws/gone')] })
    const post = summary({ projects: [] })
    expect(findLostDiscovery(pre, post)).toEqual({ hubLost: false, hubPath: null, lostTreePaths: [] })
  })

  it('reports hub loss and tree loss together', () => {
    const pre = summary({ hub: { path: '/ws/hub' }, projects: [project('PRJ-1', '/ws/p1')] })
    const post = summary({ hub: null, projects: [] })
    expect(findLostDiscovery(pre, post)).toEqual({
      hubLost: true,
      hubPath: '/ws/hub',
      lostTreePaths: ['/ws/p1'],
    })
  })
})

/* ------------------------------------------------------------------ *
 * R5 (0.2 configForms migration) — the pairing key and the pure
 * config-form → card derivation.
 * ------------------------------------------------------------------ */

describe('the 0.2 pairing key (the configForms get / describe() ns)', () => {
  it('pins the entry id — the profile entry / descriptor ns the two halves pair on', () => {
    expect(RESEARCH_SETTINGS_ENTRY_ID).toBe('research-control')
    // NOT the retired 0.1 namespace (the package name stays distinct):
    expect(RESEARCH_SETTINGS_ENTRY_ID).not.toBe(RESEARCH_SETTINGS_NAMESPACE)
  })

  it('the host read path resolves the SAME identity (re-export, not a copy)', () => {
    expect(HOST_ENTRY_ID).toBe(RESEARCH_SETTINGS_ENTRY_ID)
  })
})

describe('deriveSettingsSectionFromRaw (the shared card derivation)', () => {
  const defaults = { projectTreeDir: DEFAULT_PROJECT_TREE_DIR, hubDir: DEFAULT_HUB_DIR }

  it('ready + string fields → verbatim', () => {
    const raw = { status: 'ready' as const, value: { projectTreeDir: '.a', hubDir: '.b' }, writable: true }
    expect(deriveSettingsSectionFromRaw(raw, defaults)).toEqual({
      status: 'ready',
      values: { projectTreeDir: '.a', hubDir: '.b' },
      writable: true,
    })
  })

  it('non-string / absent fields fall back PER FIELD (belt-and-braces over the schema)', () => {
    const raw = { status: 'ready' as const, value: { projectTreeDir: 42, hubDir: '.b' }, writable: false }
    const derived = deriveSettingsSectionFromRaw(raw, defaults)
    expect(derived.values).toEqual({ projectTreeDir: DEFAULT_PROJECT_TREE_DIR, hubDir: '.b' })
    expect(derived.writable).toBe(false)
  })

  it('undefined value (pre-acceptance) → values undefined regardless of status', () => {
    for (const status of ['loading', 'ready', 'unavailable'] as const) {
      const derived = deriveSettingsSectionFromRaw({ status, value: undefined, writable: false }, defaults)
      expect(derived).toEqual({ status, values: undefined, writable: false })
    }
  })

  it('non-object value (a hand-edited / hostile doc) → per-field defaults with values still derived', () => {
    const derived = deriveSettingsSectionFromRaw({ status: 'ready', value: 'nope', writable: true }, defaults)
    expect(derived.values).toEqual(defaults)
  })
})
