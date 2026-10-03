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

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stringify } from 'yaml'
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
  isMigrationPending,
  RESEARCH_SETTINGS_MIGRATION_MARKER,
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

describe('parseLegacyResearchSection — the scoped 0.1 section reader (REAL yaml parser)', () => {
  /* The hand-rolled line parser is retired (reviewer defect: it stripped
   * ` #` as a comment and corrupted legal quoted names). Every case
   * below exercises the `yaml` library semantics a real serializer
   * produces — quoted "#" names, escapes, flow style, round-trips. */
  it('block style: quoted/bare scalars, comment lines, unrelated keys/sections scoped out', () => {
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
    expect(out).toEqual({ section: { projectTreeDir: '.legacy-tree', hubDir: '.legacy hub' }, malformed: false })
  })

  it('REGRESSION: a quoted name containing " #" survives VERBATIM (the hand parser truncated it)', () => {
    const out = parseLegacyResearchSection('dsh-research-control:\n  hubDir: ".research #1"\n')
    expect(out.section).toEqual({ hubDir: '.research #1' })
  })

  it('REGRESSION: trailing comment after a QUOTED value does not truncate the quoted text', () => {
    const out = parseLegacyResearchSection('dsh-research-control:\n  hubDir: ".hub-x" # renamed by user\n')
    expect(out.section).toEqual({ hubDir: '.hub-x' })
  })

  it('escaped text (serializer output) parses to the real value', () => {
    const out = parseLegacyResearchSection('dsh-research-control:\n  hubDir: "a\\"quoted\\" name"\n')
    expect(out.section).toEqual({ hubDir: 'a"quoted" name' })
  })

  it('yaml.stringify round-trip (real serializer → real parser, exotic-but-legal names)', () => {
    const document = {
      'dsh-research-control': { projectTreeDir: '.research #1', hubDir: '.hub: with colon' },
      'ui-onboarding': { seen: true },
    }
    const out = parseLegacyResearchSection(stringify(document))
    expect(out).toEqual({
      section: { projectTreeDir: '.research #1', hubDir: '.hub: with colon' },
      malformed: false,
    })
  })

  it('flow inline style', () => {
    const out = parseLegacyResearchSection('dsh-research-control: { projectTreeDir: ".x", hubDir: .y }')
    expect(out.section).toEqual({ projectTreeDir: '.x', hubDir: '.y' })
  })

  it('no research section → no section, NOT malformed (fresh installs, unrelated documents)', () => {
    expect(parseLegacyResearchSection('ui-onboarding:\n  seen: true\n')).toEqual({ section: undefined, malformed: false })
    expect(parseLegacyResearchSection('')).toEqual({ section: undefined, malformed: false })
  })

  it('research section WITHOUT either field → undefined section (nothing to migrate)', () => {
    expect(parseLegacyResearchSection('dsh-research-control:\n  other: 1\n')).toEqual({ section: undefined, malformed: false })
  })

  it('trailing document (section at EOF, no trailing newline)', () => {
    expect(parseLegacyResearchSection('x:\n  a: 1\ndsh-research-control:\n  hubDir: .hub').section!.hubDir).toBe('.hub')
  })

  it('MALFORMED YAML → malformed flag (the migration must write NOTHING on such a file)', () => {
    expect(parseLegacyResearchSection('dsh-research-control:\n\tbroken: [\n  unbalanced'))
      .toEqual({ section: undefined, malformed: true })
  })

  it('research section not a mapping → malformed', () => {
    expect(parseLegacyResearchSection('dsh-research-control: just-a-string')).toEqual({ section: undefined, malformed: true })
  })

  it('field present but wrong TYPE passes through to the per-field rule (not a parse failure)', () => {
    const out = parseLegacyResearchSection('dsh-research-control:\n  hubDir: [a, b]\n')
    expect(out.malformed).toBe(false)
    expect(out.section).toEqual({ hubDir: ['a', 'b'] }) // validateDirName rejects it at consumption
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

describe('migrateLegacyResearchSettings — the ONE-shot atomic migration (host ConfigEditor.edit)', () => {
  /* The fake editor below is DELIBERATELY strict about the real contract
   * (boot/config-editor/src/index.ts:49 + :87-135): configuration()
   * rows are { entry, inherited, override }, and edit(entry, change)
   * identity-checks the LIVE entry (a rebuilt look-alike throws) and
   * hands `change` a fresh clone of the CURRENT stored config — the
   * same in-critical-section re-read the host performs. Same-shape
   * shortcuts therefore cannot produce a green here. */
  interface FakeEntry {
    options: { id?: string; config?: Record<string, unknown> }
    fiber: unknown
  }
  interface FakeRow {
    entry: FakeEntry
    inherited: Record<string, unknown>
    override: Record<string, unknown>
  }
  interface Fixture {
    readonly home: string
    readonly row: FakeRow
    readonly edits: Array<Record<string, unknown>>
    readonly ctx: unknown
    dispose(): void
  }
  const LEGACY_DOC =
    'ui-onboarding:\n  seen: true\ndsh-research-control:\n  projectTreeDir: .legacy-tree\n  hubDir: .legacy-hub\n'

  function makeFixture(options?: {
    legacy?: string
    fileName?: string
    userConfig?: Record<string, unknown>
    entryId?: string
    noEditor?: boolean
  }): Fixture {
    const home = mkdtempSync(join(tmpdir(), 'rc-legacy-'))
    if (options?.legacy !== undefined) {
      writeFileSync(join(home, options.fileName ?? 'settings.yaml'), options.legacy)
    }
    const fiber = { uid: 11 }
    const row: FakeRow = {
      entry: { options: { id: options?.entryId ?? RESEARCH_SETTINGS_ENTRY_ID, config: structuredClone(options?.userConfig ?? {}) }, fiber },
      inherited: {},
      override: structuredClone(options?.userConfig ?? {}),
    }
    const edits: Array<Record<string, unknown>> = []
    const editor = {
      configuration: () => [row],
      edit: async (
        entry: FakeEntry,
        change: (current: Record<string, unknown>, inherited: Record<string, unknown>) => Record<string, unknown>,
      ): Promise<void> => {
        if (entry !== row.entry) {
          throw new Error('ConfigEditor.edit: entry identity violated (rebuilt look-alike passed)')
        }
        const current = structuredClone(row.entry.options.config ?? {})
        const next = change(current, row.inherited)
        row.entry.options.config = next
        row.override = structuredClone(next)
        edits.push(next)
      },
    }
    const ctx = {
      fiber,
      profileContext: { home },
      get: (name: string) => (name === 'configEditor' && options?.noEditor !== true ? editor : undefined),
    }
    resetLegacyResearchCacheForTests()
    return {
      home,
      row,
      edits,
      ctx,
      dispose: () => rmSync(home, { recursive: true, force: true }),
    }
  }

  it('pending (no marker) + legacy section → ONE edit writing fields + completion marker atomically', async () => {
    const f = makeFixture({ legacy: LEGACY_DOC })
    try {
      expect(isMigrationPending(f.ctx as never)).toBe(true)
      await migrateLegacyResearchSettings(f.ctx as never, { settle: async () => {} })
      expect(f.edits).toHaveLength(1)
      const written = f.edits[0]!
      expect(written.projectTreeDir).toBe('.legacy-tree')
      expect(written.hubDir).toBe('.legacy-hub')
      expect(typeof written[RESEARCH_SETTINGS_MIGRATION_MARKER]).toBe('number')
      expect(isMigrationPending(f.ctx as never)).toBe(false)
    } finally {
      f.dispose()
    }
  })

  it('an EXPLICIT user value is never clobbered (per field); the missing one migrates', async () => {
    const f = makeFixture({ legacy: LEGACY_DOC, userConfig: { projectTreeDir: '.user-tree' } })
    try {
      await migrateLegacyResearchSettings(f.ctx as never, { settle: async () => {} })
      expect(f.edits).toHaveLength(1)
      expect(f.edits[0]!.projectTreeDir).toBe('.user-tree')
      expect(f.edits[0]!.hubDir).toBe('.legacy-hub')
    } finally {
      f.dispose()
    }
  })

  it('TOCTOU closed: a value a CONCURRENT writer commits before the edit is present in the in-callback re-read and wins', async () => {
    const f = makeFixture({ legacy: LEGACY_DOC })
    try {
      // The settle seam stands in for the host file lock: by the time
      // edit() runs, a concurrent settings write has landed a NEWER
      // hubDir in the stored config. The migration reads `current`
      // INSIDE the callback, so it sees — and keeps — the newer value.
      await migrateLegacyResearchSettings(f.ctx as never, {
        settle: async () => {
          f.row.entry.options.config = { ...(f.row.entry.options.config ?? {}), hubDir: '.concurrent-newer' }
        },
      })
      expect(f.edits).toHaveLength(1)
      expect(f.edits[0]!.hubDir).toBe('.concurrent-newer')
      expect(f.edits[0]!.projectTreeDir).toBe('.legacy-tree')
    } finally {
      f.dispose()
    }
  })

  it('COMPLETED (marker present) → migration is a permanent no-op (no edit at all)', async () => {
    const f = makeFixture({
      legacy: LEGACY_DOC,
      userConfig: { hubDir: '.renamed-after-migration', [RESEARCH_SETTINGS_MIGRATION_MARKER]: 1700000000000 },
    })
    try {
      expect(isMigrationPending(f.ctx as never)).toBe(false)
      await migrateLegacyResearchSettings(f.ctx as never, { settle: async () => {} })
      expect(f.edits).toHaveLength(0)
    } finally {
      f.dispose()
    }
  })

  it('RESET AFTER MIGRATION does not resurrect the legacy name (the legacy file exits authority)', async () => {
    const f = makeFixture({ legacy: LEGACY_DOC })
    try {
      await migrateLegacyResearchSettings(f.ctx as never, { settle: async () => {} })
      // The user now RESETS both names back to the defaults (the user
      // layer keeps the marker — ConfigEditor.edit deletes the config
      // key only when the WHOLE section equals the inherited defaults,
      // and the marker is exactly what keeps the row alive).
      f.row.entry.options.config = { [RESEARCH_SETTINGS_MIGRATION_MARKER]: f.edits[0]![RESEARCH_SETTINGS_MIGRATION_MARKER] }
      f.row.override = { ...f.row.entry.options.config }
      resetLegacyResearchCacheForTests()
      await migrateLegacyResearchSettings(f.ctx as never, { settle: async () => {} })
      expect(f.edits).toHaveLength(1) // no second write
      // And a fresh boot's read resolves DEFAULTS, never the legacy file:
      const names = getResearchDirNames(f.ctx as never)
      expect(names).toEqual({ treeDir: DEFAULT_PROJECT_TREE_DIR, hubDir: DEFAULT_HUB_DIR })
    } finally {
      f.dispose()
    }
  })

  it('the legacy FILE ITSELF is never rewritten (lazy backup; original bytes intact)', async () => {
    const f = makeFixture({ legacy: LEGACY_DOC })
    try {
      await migrateLegacyResearchSettings(f.ctx as never, { settle: async () => {} })
      expect(readFileSync(join(f.home, 'settings.yaml'), 'utf8')).toBe(LEGACY_DOC)
    } finally {
      f.dispose()
    }
  })

  it('already-imported home: settings.yaml.imported is consulted (REQUIRED real case)', async () => {
    const f = makeFixture({ legacy: LEGACY_DOC, fileName: 'settings.yaml.imported' })
    try {
      await migrateLegacyResearchSettings(f.ctx as never, { settle: async () => {} })
      expect(f.edits[0]!.hubDir).toBe('.legacy-hub')
    } finally {
      f.dispose()
    }
  })

  it('custom entry id: identity is the FIBER, the id follows the row (edit gets the live entry)', async () => {
    const f = makeFixture({ legacy: LEGACY_DOC, entryId: 'rc-custom' })
    try {
      await migrateLegacyResearchSettings(f.ctx as never, { settle: async () => {} })
      expect(f.edits).toHaveLength(1) // identity check inside edit passed
    } finally {
      f.dispose()
    }
  })

  it('MALFORMED legacy document → NOTHING is written, migration skipped', async () => {
    const f = makeFixture({ legacy: 'dsh-research-control:\n\tbroken: [\n  unbalanced' })
    try {
      await migrateLegacyResearchSettings(f.ctx as never, { settle: async () => {} })
      expect(f.edits).toHaveLength(0)
      expect(readFileSync(join(f.home, 'settings.yaml'), 'utf8')).toContain('broken')
    } finally {
      f.dispose()
    }
  })

  it('no config editor → loud warn, boot stays pending (overlay keeps THIS boot correct)', async () => {
    const f = makeFixture({ legacy: LEGACY_DOC, noEditor: true })
    const warns: unknown[] = []
    const spy = vi.spyOn(console, 'warn').mockImplementation((...args) => void warns.push(args.join(' ')))
    try {
      await migrateLegacyResearchSettings(f.ctx as never, { settle: async () => {} })
      expect(f.edits).toHaveLength(0)
      expect(warns.some((w) => String(w).includes('ConfigEditor'))).toBe(true)
      expect(isMigrationPending(f.ctx as never)).toBe(true)
    } finally {
      spy.mockRestore()
      f.dispose()
    }
  })

  it('an invalid legacy field is never persisted (the per-field rule guards the write path too)', async () => {
    const f = makeFixture({ legacy: 'dsh-research-control:\n  projectTreeDir: a/b\n  hubDir: .ok\n' })
    try {
      await migrateLegacyResearchSettings(f.ctx as never, { settle: async () => {} })
      expect(f.edits).toHaveLength(1)
      expect(f.edits[0]!.projectTreeDir).toBeUndefined()
      expect(f.edits[0]!.hubDir).toBe('.ok')
    } finally {
      f.dispose()
    }
  })

  it('a legacy file WITHOUT the profile home (no profileContext) → silent no-op', async () => {
    resetLegacyResearchCacheForTests()
    await migrateLegacyResearchSettings({ fiber: {}, get: () => undefined } as never, { settle: async () => {} })
  })
})
