/**
 * V2-T2.1 — the research settings domain, host half (design §7.5 / §3.1,
 * Q4): the frozen namespace + schema, the directory-name rule
 * (validateDirName), the pure §4 step 1 resolution core (invalid →
 * default + warn), the optional-service registration (absent → ONE warn
 * + defaults, register called with the exact namespace + schema), and
 * the live read T2.2's discovery consumes (no cache — the §7.5
 * save→rescan contract).
 *
 * Fakes: a plain-object settings double (records `register` calls,
 * answers `get` from a mutable section) and a minimal ctx double
 * exposing the optional-service `get` face — the same structural-fake
 * style as `tests/host-investigate-command.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_HUB_DIR,
  DEFAULT_PROJECT_TREE_DIR,
  MAX_DIR_NAME_LENGTH,
  RESEARCH_SETTINGS_NAMESPACE,
  RESEARCH_SETTINGS_SCHEMA,
  getResearchDirNames,
  registerResearchSettings,
  resolveResearchDirNames,
  validateDirName,
  type ResearchDirNames,
  type ResearchSettings,
  type SettingsServiceLike,
} from '../../src/host/dsh-adapter/host/settings.js'

const DEFAULT_NAMES: ResearchDirNames = {
  treeDir: DEFAULT_PROJECT_TREE_DIR,
  hubDir: DEFAULT_HUB_DIR,
}

/**
 * A host settings service double: records every `register` call and
 * answers `get` from a mutable stored section (the §7.5 save
 * transaction commits there; `setSection` simulates that commit).
 */
function makeSettingsDouble(initialSection: unknown) {
  const registered: { ns: string; schema: unknown }[] = []
  let section = initialSection
  const service: SettingsServiceLike = {
    register: (ns: string, schema: unknown) => {
      registered.push({ ns, schema })
    },
    get: (ns: string) => (ns === RESEARCH_SETTINGS_NAMESPACE ? section : undefined),
  }
  return {
    registered,
    service,
    setSection(next: unknown): void {
      section = next
    },
  }
}

/** A minimal cordis ctx double exposing the optional-service read face. */
function makeCtx(settings: unknown): never {
  return {
    get: (name: string) => (name === 'settings' ? settings : undefined),
  } as never
}

describe('the frozen namespace and schema (design §7.5 field table)', () => {
  it('pins the namespace string (the settings-card pairing key)', () => {
    expect(RESEARCH_SETTINGS_NAMESPACE).toBe('dsh-research-control')
  })

  it('pins the two defaults and the length bound (frozen §3.1/Q4/§7.5)', () => {
    expect(DEFAULT_PROJECT_TREE_DIR).toBe('.research')
    expect(DEFAULT_HUB_DIR).toBe('.research-control')
    expect(MAX_DIR_NAME_LENGTH).toBe(64)
  })

  it('resolves an empty section to the full default (schema defaults applied)', () => {
    expect(RESEARCH_SETTINGS_SCHEMA({} as never)).toEqual({
      projectTreeDir: '.research',
      hubDir: '.research-control',
    })
  })

  it('fills absent fields with defaults, keeps present ones', () => {
    expect(RESEARCH_SETTINGS_SCHEMA({ projectTreeDir: 'mytree' } as never)).toEqual({
      projectTreeDir: 'mytree',
      hubDir: '.research-control',
    })
  })

  it('keeps a full section verbatim', () => {
    const section: ResearchSettings = { projectTreeDir: 'a', hubDir: 'b' }
    expect(RESEARCH_SETTINGS_SCHEMA(section as never)).toEqual(section)
  })

  it('serializes to JSON (the host descriptor carries schema.toJSON())', () => {
    expect(() => JSON.stringify(RESEARCH_SETTINGS_SCHEMA.toJSON())).not.toThrow()
  })
})

describe('validateDirName (frozen §7.5 rule: single segment, leading dot ok, no "/" and no "."/"..", non-empty, ≤ 64)', () => {
  it('accepts the defaults and plain names', () => {
    expect(validateDirName('.research')).toBeNull()
    expect(validateDirName('.research-control')).toBeNull()
    expect(validateDirName('mytree')).toBeNull()
    expect(validateDirName('a')).toBeNull()
  })

  it('allows a leading dot and dotted names — only the literals "." and ".." are the traversal ban', () => {
    expect(validateDirName('.a')).toBeNull()
    expect(validateDirName('..a')).toBeNull()
    expect(validateDirName('a..b')).toBeNull()
  })

  it('accepts exactly 64 characters (inclusive bound)', () => {
    expect(validateDirName('a'.repeat(MAX_DIR_NAME_LENGTH))).toBeNull()
  })

  it.each([
    ['', 'must not be empty'],
    ['a/b', 'must be a single path segment (no "/")'],
    ['a//b', 'must be a single path segment (no "/")'],
    ['/a', 'must be a single path segment (no "/")'],
    ['a/', 'must be a single path segment (no "/")'],
    ['.', 'must not be "." or ".."'],
    ['..', 'must not be "." or ".."'],
    ['a'.repeat(65), 'must be at most 64 characters (got 65)'],
  ])('rejects %j with "%s"', (value, message) => {
    expect(validateDirName(value)).toBe(message)
  })
})

describe('resolveResearchDirNames — the pure §4 step 1 core (读设置 → 解析 → 非法回退默认并告警)', () => {
  it('no settings service → both defaults, NO warn (the absence warn belongs to the registration)', () => {
    const warnings: string[] = []
    const out = resolveResearchDirNames(undefined, (message) => warnings.push(message))
    expect(out).toEqual(DEFAULT_NAMES)
    expect(warnings).toEqual([])
  })

  it('service present but namespace unregistered → defaults + one diagnostic warn', () => {
    const warnings: string[] = []
    const out = resolveResearchDirNames(makeSettingsDouble(undefined).service, (message) => warnings.push(message))
    expect(out).toEqual(DEFAULT_NAMES)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain(RESEARCH_SETTINGS_NAMESPACE)
  })

  it('a default-resolved section (no user override) → defaults, no warn', () => {
    const warnings: string[] = []
    const out = resolveResearchDirNames(
      makeSettingsDouble({ projectTreeDir: '.research', hubDir: '.research-control' }).service,
      (message) => warnings.push(message),
    )
    expect(out).toEqual(DEFAULT_NAMES)
    expect(warnings).toEqual([])
  })

  it('a valid override → returned verbatim, no warn', () => {
    const warnings: string[] = []
    const out = resolveResearchDirNames(
      makeSettingsDouble({ projectTreeDir: 'mytree', hubDir: 'myhub' }).service,
      (message) => warnings.push(message),
    )
    expect(out).toEqual({ treeDir: 'mytree', hubDir: 'myhub' })
    expect(warnings).toEqual([])
  })

  it.each([
    ['a/b', 'must be a single path segment (no "/")'],
    ['.', 'must not be "." or ".."'],
    ['..', 'must not be "." or ".."'],
    ['', 'must not be empty'],
    ['a'.repeat(65), 'must be at most 64 characters (got 65)'],
  ])('an invalid treeDir %j → treeDir falls back, hubDir untouched, exactly one warn', (bad, reason) => {
    const warnings: string[] = []
    const out = resolveResearchDirNames(
      makeSettingsDouble({ projectTreeDir: bad, hubDir: 'myhub' }).service,
      (message) => warnings.push(message),
    )
    expect(out).toEqual({ treeDir: DEFAULT_PROJECT_TREE_DIR, hubDir: 'myhub' })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('projectTreeDir')
    expect(warnings[0]).toContain(reason)
    expect(warnings[0]).toContain(DEFAULT_PROJECT_TREE_DIR)
  })

  it('an invalid hubDir → hubDir falls back, treeDir untouched, one warn', () => {
    const warnings: string[] = []
    const out = resolveResearchDirNames(
      makeSettingsDouble({ projectTreeDir: 'mytree', hubDir: 'a/b' }).service,
      (message) => warnings.push(message),
    )
    expect(out).toEqual({ treeDir: 'mytree', hubDir: DEFAULT_HUB_DIR })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('hubDir')
    expect(warnings[0]).toContain(DEFAULT_HUB_DIR)
  })

  it('both fields invalid → both fall back, one warn per field (field order pinned)', () => {
    const warnings: string[] = []
    const out = resolveResearchDirNames(
      makeSettingsDouble({ projectTreeDir: '.', hubDir: '..' }).service,
      (message) => warnings.push(message),
    )
    expect(out).toEqual(DEFAULT_NAMES)
    expect(warnings).toHaveLength(2)
    expect(warnings[0]).toContain('projectTreeDir')
    expect(warnings[1]).toContain('hubDir')
  })

  it('a wrong-type field (a hand-edited document) → default + warn (durable-file boundary)', () => {
    const warnings: string[] = []
    const out = resolveResearchDirNames(
      makeSettingsDouble({ projectTreeDir: 42, hubDir: 'myhub' }).service,
      (message) => warnings.push(message),
    )
    expect(out).toEqual({ treeDir: DEFAULT_PROJECT_TREE_DIR, hubDir: 'myhub' })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('projectTreeDir')
  })

  it('an absent field → the default silently (schema-default inheritance)', () => {
    const warnings: string[] = []
    const out = resolveResearchDirNames(
      makeSettingsDouble({ projectTreeDir: 'mytree' }).service,
      (message) => warnings.push(message),
    )
    expect(out).toEqual({ treeDir: 'mytree', hubDir: DEFAULT_HUB_DIR })
    expect(warnings).toEqual([])
  })

  it('returns a fresh object per call (no shared mutable state)', () => {
    const service = makeSettingsDouble({ projectTreeDir: 'mytree', hubDir: 'myhub' }).service
    const a = resolveResearchDirNames(service, () => {})
    const b = resolveResearchDirNames(service, () => {})
    expect(a).toEqual(b)
    expect(a).not.toBe(b)
  })
})

describe('registerResearchSettings — the optional-service registration (§7.5 host side)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('settings present → register called exactly once with the exact namespace + schema (identity)', () => {
    const fake = makeSettingsDouble(undefined)
    registerResearchSettings(makeCtx(fake.service))
    expect(fake.registered).toHaveLength(1)
    expect(fake.registered[0].ns).toBe(RESEARCH_SETTINGS_NAMESPACE)
    expect(fake.registered[0].schema).toBe(RESEARCH_SETTINGS_SCHEMA)
    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(logSpy.mock.calls[0][0]).toContain(RESEARCH_SETTINGS_NAMESPACE)
  })

  it('settings absent → no throw, ONE console.warn across repeated calls', async () => {
    // A FRESH module instance: the once-flag is module state, and this
    // suite must observe its first firing regardless of the other suites.
    vi.resetModules()
    const mod = await import('../../src/host/dsh-adapter/host/settings.js')
    const ctx = makeCtx(undefined)
    expect(() => {
      mod.registerResearchSettings(ctx)
      mod.registerResearchSettings(ctx)
    }).not.toThrow()
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(String(warnSpy.mock.calls[0][0])).toContain('no settings service')
    expect(String(warnSpy.mock.calls[0][0])).toContain(DEFAULT_PROJECT_TREE_DIR)
    expect(String(warnSpy.mock.calls[0][0])).toContain(DEFAULT_HUB_DIR)
    // the read path still answers with the defaults (no hard dependency):
    expect(mod.getResearchDirNames(ctx)).toEqual(DEFAULT_NAMES)
  })
})

describe('getResearchDirNames — the live discovery read (THE name source for T2.2)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('no settings service → defaults, and the READ path stays silent (the absence warn is the registration’s)', () => {
    expect(getResearchDirNames(makeCtx(undefined))).toEqual(DEFAULT_NAMES)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('a valid override → returned', () => {
    const fake = makeSettingsDouble({ projectTreeDir: 'mytree', hubDir: 'myhub' })
    expect(getResearchDirNames(makeCtx(fake.service))).toEqual({ treeDir: 'mytree', hubDir: 'myhub' })
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('an invalid stored value → per-field fallback + console.warn naming the field, value, and violation', () => {
    const fake = makeSettingsDouble({ projectTreeDir: 'a/b', hubDir: '..' })
    const out = getResearchDirNames(makeCtx(fake.service))
    expect(out).toEqual(DEFAULT_NAMES)
    expect(warnSpy).toHaveBeenCalledTimes(2)
    const first = String(warnSpy.mock.calls[0][0])
    const second = String(warnSpy.mock.calls[1][0])
    expect(first).toContain('projectTreeDir')
    expect(first).toContain('a/b')
    expect(first).toContain('single path segment')
    expect(first).toContain(DEFAULT_PROJECT_TREE_DIR)
    expect(second).toContain('hubDir')
    expect(second).toContain('must not be "." or ".."')
    expect(second).toContain(DEFAULT_HUB_DIR)
  })

  it('reads LIVE on every call (no cache — the §7.5 save→rescan contract)', () => {
    const fake = makeSettingsDouble({ projectTreeDir: '.research', hubDir: '.research-control' })
    expect(getResearchDirNames(makeCtx(fake.service))).toEqual(DEFAULT_NAMES)
    // the §7.5 save transaction commits new names into the settings document:
    fake.setSection({ projectTreeDir: 'renamed-tree', hubDir: 'renamed-hub' })
    expect(getResearchDirNames(makeCtx(fake.service))).toEqual({ treeDir: 'renamed-tree', hubDir: 'renamed-hub' })
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('a name invalidated after a save re-validates on the next read (fallback + warn)', () => {
    const fake = makeSettingsDouble({ projectTreeDir: 'mytree', hubDir: 'myhub' })
    expect(getResearchDirNames(makeCtx(fake.service))).toEqual({ treeDir: 'mytree', hubDir: 'myhub' })
    fake.setSection({ projectTreeDir: 'my/tree', hubDir: 'myhub' })
    expect(getResearchDirNames(makeCtx(fake.service))).toEqual({ treeDir: DEFAULT_PROJECT_TREE_DIR, hubDir: 'myhub' })
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(String(warnSpy.mock.calls[0][0])).toContain('my/tree')
  })
})
