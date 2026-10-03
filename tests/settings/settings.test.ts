/**
 * V2-T2.1 — the research settings domain, host half (design §7.5 / §3.1,
 * Q4): the frozen namespace + schema, the directory-name rule
 * (validateDirName), the pure §4 step 1 resolution core (invalid →
 * default + warn), the optional-service registration (absent → ONE warn
 * + defaults, and the plugin Config carries the field pair), and the
 * live read T2.2's discovery consumes (no cache — the §7.5 save→rescan
 * contract).
 *
 * 0.2.0-rc.2 migration: `settings.register`/`get` are RETIRED (the real
 * host caught the stale assumption — `SettingsForms` has neither). A
 * namespace IS a profile plugin entry; reads ride `describe()`. The
 * §7.5 fields now live in the plugin `Config` schema and the namespace
 * id is the profile entry id.
 *
 * Fakes: a plain-object settings double answering `describe` from a
 * mutable entry view, and a minimal ctx double exposing the
 * optional-service `get` face — the same structural-fake style as
 * `tests/host-investigate-command.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type s from '@deepseek-ai/schemastery'

import { ResearchControlService } from '../../src/host/dsh-adapter/host/index.js'

import {
  DEFAULT_HUB_DIR,
  DEFAULT_PROJECT_TREE_DIR,
  MAX_DIR_NAME_LENGTH,
  RESEARCH_SETTINGS_NAMESPACE,
  RESEARCH_SETTINGS_SCHEMA,
  RESEARCH_SETTINGS_ENTRY_ID,
  getResearchDirNames,
  registerResearchSettings,
  resolveResearchDirNames,
  parseLegacyResearchSection,
  findResearchEntry,
  migrateLegacyResearchSettings,
  resetLegacyResearchCacheForTests,
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
 * A host settings service double in the 0.2 `SettingsForms` shape: the
 * research entry view (id = the profile entry id) answers `describe()`
 * from a mutable stored section (the §7.5 save transaction commits
 * there; `setSection` simulates that commit). `undefined` section =
 * the entry is not served at all (empty describe()).
 */
function makeSettingsDouble(initialSection: unknown) {
  let section = initialSection
  const service: SettingsServiceLike = {
    describe: () =>
      section === undefined || section === null
        ? []
        : [{ ns: RESEARCH_SETTINGS_ENTRY_ID, value: section }],
  }
  return {
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

  it('0.2: the plugin Config carries the §7.5 field pair (lockstep with RESEARCH_SETTINGS_SCHEMA)', () => {
    // The 0.2 settings model has no namespace registration — the fields
    // ride the plugin's own Config schema (its profile entry IS the
    // namespace). This pins the two schema halves in lockstep: same
    // defaults, same resolved shape.
    const config: s<unknown> = (ResearchControlService as unknown as { Config: s<unknown> }).Config
    const unwrap = (value: unknown): unknown =>
      typeof value === 'object' && value !== null && typeof (value as { get?: unknown }).get === 'function'
        ? (value as { get: () => unknown }).get()
        : value
    const resolved = config({} as never) as Record<string, unknown>
    expect(resolved['minDshVersion']).toBe('0.2.0-rc.2')
    // `.volatile()` fields mount as live cosmokit cells (the runtime reads
    // them through `.get()` — the bash-local config convention).
    expect(unwrap(resolved['projectTreeDir'])).toBe('.research')
    expect(unwrap(resolved['hubDir'])).toBe('.research-control')
    const fromSettingsSchema = RESEARCH_SETTINGS_SCHEMA({} as never) as unknown as Record<string, unknown>
    expect(unwrap(resolved['projectTreeDir'])).toBe(fromSettingsSchema['projectTreeDir'])
    expect(unwrap(resolved['hubDir'])).toBe(fromSettingsSchema['hubDir'])
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

describe('fallback chain (0.2 authorities: served view → service Config → frozen defaults)', () => {
  it('entry NOT served + fallback wired → fallback names, NO warn (the documented boot window)', () => {
    const warnings: string[] = []
    const out = resolveResearchDirNames(
      makeSettingsDouble(undefined).service,
      (message) => warnings.push(message),
      { projectTreeDir: 'mytree', hubDir: 'myhub' },
    )
    expect(out).toEqual({ treeDir: 'mytree', hubDir: 'myhub' })
    expect(warnings).toEqual([])
  })

  it('entry NOT served + NO fallback → defaults + one warn (the anomaly case)', () => {
    const warnings: string[] = []
    const out = resolveResearchDirNames(makeSettingsDouble(undefined).service, (message) => warnings.push(message))
    expect(out).toEqual(DEFAULT_NAMES)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('no authority fallback is wired')
  })

  it('a served view WINS over the fallback (live authority order pinned)', () => {
    const warnings: string[] = []
    const out = resolveResearchDirNames(
      makeSettingsDouble({ projectTreeDir: 'served-tree', hubDir: 'served-hub' }).service,
      (message) => warnings.push(message),
      { projectTreeDir: 'stale-tree', hubDir: 'stale-hub' },
    )
    expect(out).toEqual({ treeDir: 'served-tree', hubDir: 'served-hub' })
    expect(warnings).toEqual([])
  })

  it('a FALLBACK field invalid → the same per-field fallback + warn (no smuggling through the boot window)', () => {
    const warnings: string[] = []
    const out = resolveResearchDirNames(
      makeSettingsDouble(undefined).service,
      (message) => warnings.push(message),
      { projectTreeDir: 'a/b', hubDir: 'myhub' },
    )
    expect(out).toEqual({ treeDir: DEFAULT_PROJECT_TREE_DIR, hubDir: 'myhub' })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('projectTreeDir')
  })

  it('a volatile-CELL fallback field (the loader-mounted shape) is read through .get()', () => {
    const warnings: string[] = []
    const out = resolveResearchDirNames(
      makeSettingsDouble(undefined).service,
      (message) => warnings.push(message),
      {
        projectTreeDir: { get: () => 'cell-tree' },
        hubDir: { get: () => 'bad/name' },
      },
    )
    expect(out).toEqual({ treeDir: 'cell-tree', hubDir: DEFAULT_HUB_DIR })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('hubDir')
  })

  it('settings service ABSENT + fallback wired → fallback silently (the degraded-deployment authority)', () => {
    const warnings: string[] = []
    const out = resolveResearchDirNames(
      undefined,
      (message) => warnings.push(message),
      { projectTreeDir: 'mytree', hubDir: 'myhub' },
    )
    expect(out).toEqual({ treeDir: 'mytree', hubDir: 'myhub' })
    expect(warnings).toEqual([])
  })

  it('a NON-0.2 service shape (no describe face) + fallback → warn once + fallback names', () => {
    const warnings: string[] = []
    const legacyShaped = { get: () => undefined } as unknown as SettingsServiceLike
    const out = resolveResearchDirNames(
      legacyShaped,
      (message) => warnings.push(message),
      { projectTreeDir: 'mytree', hubDir: 'myhub' },
    )
    expect(out).toEqual({ treeDir: 'mytree', hubDir: 'myhub' })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('describe()')
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

  it('service present but the entry view is not served → defaults + one diagnostic warn', () => {
    const warnings: string[] = []
    const out = resolveResearchDirNames(makeSettingsDouble(undefined).service, (message) => warnings.push(message))
    expect(out).toEqual(DEFAULT_NAMES)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain(RESEARCH_SETTINGS_ENTRY_ID)
  })

  it('a NON-0.2 service shape (no describe face) → defaults + one loud warn, never a throw', () => {
    const warnings: string[] = []
    const legacyShaped = { get: () => ({ projectTreeDir: 'x' }) } as unknown as SettingsServiceLike
    const out = resolveResearchDirNames(legacyShaped, (message) => warnings.push(message))
    expect(out).toEqual(DEFAULT_NAMES)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('describe()')
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

describe('registerResearchSettings — 0.2 model: nothing to register, observability kept', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('settings present → NO registration call (0.2 retired register), ONE log naming the entry + the Config home', async () => {
    vi.resetModules()
    const mod = await import('../../src/host/dsh-adapter/host/settings.js')
    const fake = makeSettingsDouble({ projectTreeDir: '.research', hubDir: '.research-control' })
    const service = fake.service as SettingsServiceLike & Record<string, unknown>
    expect(service['register']).toBeUndefined()
    mod.registerResearchSettings(makeCtx(fake.service))
    mod.registerResearchSettings(makeCtx(fake.service))
    expect(warnSpy).not.toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(String(logSpy.mock.calls[0][0])).toContain(RESEARCH_SETTINGS_ENTRY_ID)
    expect(String(logSpy.mock.calls[0][0])).toContain('0.2 settings model')
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

/* ------------------------------------------------------------------ *
 * 0.1 → 0.2 legacy settings.yaml migration (reviewer P1)
 * ------------------------------------------------------------------ */

describe('parseLegacyResearchSection — the scoped 0.1 section parser', () => {
  it('block style with quoted and bare values + comments', () => {
    const out = parseLegacyResearchSection([
      'ui-onboarding:',
      '  seen: true',
      'dsh-research-control:',
      '  # frozen §7.5 pair',
      '  projectTreeDir: .legacy-tree',
      '  hubDir: ".legacy hub"',
      '  unrelatedKey: whatever',
      'shell:',
      '  mode: workspace-write',
    ].join('\n'))
    expect(out).toEqual({ projectTreeDir: '.legacy-tree', hubDir: '.legacy hub' })
  })

  it('flow inline style', () => {
    const out = parseLegacyResearchSection('dsh-research-control: { projectTreeDir: ".x", hubDir: .y }')
    expect(out).toEqual({ projectTreeDir: '.x', hubDir: '.y' })
  })

  it('no research section → undefined (fresh installs, unrelated documents)', () => {
    expect(parseLegacyResearchSection('ui-onboarding:\n  seen: true\n')).toBeUndefined()
  })

  it('research section WITHOUT either field → undefined (nothing to migrate)', () => {
    expect(parseLegacyResearchSection('dsh-research-control:\n  other: 1\n')).toBeUndefined()
  })

  it('trailing document (section at EOF, no dedent line)', () => {
    expect(parseLegacyResearchSection('x:\n  a: 1\ndsh-research-control:\n  hubDir: .hub')!.hubDir).toBe('.hub')
  })
})

describe('layered resolution (user > legacy > served > config > default — reviewer P1)', () => {
  const warnings: string[] = []
  const warn = (m: string) => warnings.push(m)
  const servedDouble = (value: unknown, user?: unknown) => ({
    service: { describe: () => [{ ns: 'research-control', value, ...(user === undefined ? {} : { user }) }] },
  })

  it('LEGACY custom names win over untouched defaults on the FIRST upgrade boot (R6: no restart)', () => {
    const out = resolveResearchDirNames(
      servedDouble({ projectTreeDir: '.research', hubDir: '.research-control' }).service,
      warn,
      undefined,
      { legacy: { projectTreeDir: '.legacy-tree', hubDir: '.legacy-hub' }, userOverride: {} },
    )
    expect(out).toEqual({ treeDir: '.legacy-tree', hubDir: '.legacy-hub' })
    expect(warnings).toEqual([])
  })

  it('a USER-set value is NEVER overwritten by the legacy section (per field)', () => {
    const out = resolveResearchDirNames(
      servedDouble({ projectTreeDir: '.kept', hubDir: '.research-control' }, { projectTreeDir: '.kept' }).service,
      warn,
      undefined,
      { legacy: { projectTreeDir: '.legacy-tree', hubDir: '.legacy-hub' } },
    )
    expect(out).toEqual({ treeDir: '.kept', hubDir: '.legacy-hub' })
  })

  it('served descriptor user layer beats the boot userOverride (live authority)', () => {
    const out = resolveResearchDirNames(
      servedDouble({ projectTreeDir: '.x' }, { projectTreeDir: '.served-user' }).service,
      warn,
      undefined,
      { userOverride: { projectTreeDir: '.stale-override' } },
    )
    expect(out.treeDir).toBe('.served-user')
  })

  it('boot window (entry not served): userOverride beats legacy, legacy beats fallback — all silent', () => {
    const out = resolveResearchDirNames(servedDouble(undefined).service, warn, { projectTreeDir: '.fb' }, {
      legacy: { projectTreeDir: '.legacy' },
      userOverride: { projectTreeDir: '.user' },
    })
    expect(out.treeDir).toBe('.user')
    const out2 = resolveResearchDirNames(servedDouble(undefined).service, warn, { projectTreeDir: '.fb' }, {
      legacy: { projectTreeDir: '.legacy' },
      userOverride: {},
    })
    expect(out2.treeDir).toBe('.legacy')
    expect(warnings).toEqual([])
  })

  it('an INVALID legacy value warns (naming the source) and falls through the layers', () => {
    warnings.length = 0
    const out = resolveResearchDirNames(servedDouble({ projectTreeDir: '.research' }).service, warn, undefined, {
      legacy: { projectTreeDir: 'a/b' },
      userOverride: {},
    })
    expect(out.treeDir).toBe('.research')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('legacy 0.1 settings.yaml section')
  })

  it('CUSTOM profile entry id: the descriptor follows the entry', () => {
    const custom = {
      service: {
        describe: () => [{ ns: 'rc-custom', value: { projectTreeDir: '.custom-tree', hubDir: '.custom-hub' } }],
      },
    }
    const out = resolveResearchDirNames(custom.service as never, warn, undefined, { entryId: 'rc-custom' })
    expect(out).toEqual({ treeDir: '.custom-tree', hubDir: '.custom-hub' })
  })

  it('findResearchEntry: exact id first; shape fallback only when UNAMBIGUOUS', () => {
    const rows = [
      { ns: 'other', value: { projectTreeDir: 1 } },
      { ns: 'rc-weird', value: { projectTreeDir: 2 } },
    ]
    expect(findResearchEntry(rows as never, 'rc-weird')).toBe(rows[1])
    expect(findResearchEntry(rows as never, 'missing')).toBeUndefined() // ambiguous
    expect(findResearchEntry([{ ns: 'solo-weird', value: { projectTreeDir: 2 } }] as never, 'missing')!.ns).toBe('solo-weird')
  })
})

describe('migrateLegacyResearchSettings — persistence guards (the E2E persist/restart/idempotency proof is the REAL host upgrade fixture)', () => {
  it('a legacy file WITHOUT the profile home (no profileContext) → silent no-op', async () => {
    resetLegacyResearchCacheForTests()
    const updates: unknown[] = []
    const ctx = {
      fiber: { uid: 1 },
      get: (name: string) =>
        name === 'settings'
          ? { describe: () => [{ ns: 'research-control', value: {}, user: {} }], update: async (ns: string, patch: object) => { updates.push({ ns, patch }) } }
          : undefined,
    }
    await migrateLegacyResearchSettings(ctx as never, { settle: async () => {} })
    expect(updates).toEqual([])
  })

  it('an invalid legacy field is never persisted (validation guards the write face too)', () => {
    // The parser keeps the raw value; the PERSIST rule (mirrored in the
    // module) drops fields failing validateDirName — pinned here on the
    // parser+validator composition so a drift is caught in unit scope.
    const section = parseLegacyResearchSection('dsh-research-control:\n  projectTreeDir: a/b\n  hubDir: .ok')
    expect(section).toEqual({ projectTreeDir: 'a/b', hubDir: '.ok' })
    const persisted: Record<string, string> = {}
    for (const field of ['projectTreeDir', 'hubDir'] as const) {
      const value = section?.[field]
      if (typeof value !== 'string' || validateDirName(value) !== null) continue
      persisted[field] = value
    }
    expect(persisted).toEqual({ hubDir: '.ok' })
  })
})
