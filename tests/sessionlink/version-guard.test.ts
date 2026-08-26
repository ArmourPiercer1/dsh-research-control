/**
 * WP-2.6 (rider 3, RR-008) — the `minDshVersion` fail-loud guard:
 * the strict version comparator (semver pre-release ordering), the
 * fail-loud assert (with an INJECTED fake version source), and the REAL
 * installed-package version source against this repo's own devDependency
 * (`@deepseek-ai/dsh-typert-protocol`, locked `0.1.1-rc.2`).
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  assertMinDshVersion,
  compareDshVersions,
  createPackageVersionSource,
  DshVersionError,
  DSH_VERSION_PACKAGE,
  parseDshVersion,
  type DshVersionSource,
} from '../../src/host/service/sessionlink/index.js'

const HERE = dirname(fileURLToPath(import.meta.url))

/** A fake version source (the injected seam the brief names). */
function fakeSource(version: string | null): DshVersionSource {
  return { getHostVersion: () => version }
}

/** Run `fn`, returning the thrown value (the repo's toThrow takes a CLASS,
 *  not a predicate; code-level checks need the error value itself). */
function throws(fn: () => unknown): unknown {
  try {
    fn()
  } catch (e) {
    return e
  }
  throw new Error('expected the call to throw, but it returned')
}

describe('parseDshVersion / compareDshVersions — semver pre-release ordering', () => {
  it('parses the baseline and its neighbors', () => {
    expect(parseDshVersion('0.1.0-rc.8')).toEqual({ core: [0, 1, 0], pre: ['rc', '8'] })
    expect(parseDshVersion('0.1.0')).toEqual({ core: [0, 1, 0], pre: [] })
  })

  it('rejects malformed versions (fail loud — a comparison on garbage is a lie)', () => {
    for (const bad of ['', '0.1', '0.1.0.x', 'a.b.c', '0.1.0-', '0.1.0-rc.', '0.1.0+build.1', '0.1.0-rc..8']) {
      const e = throws(() => parseDshVersion(bad))
      expect(e).toBeInstanceOf(DshVersionError)
      expect((e as DshVersionError).code).toBe('INVALID_VERSION')
    }
  })

  it('orders rc pre-releases numerically (rc.8 < rc.9 < rc.10 < release)', () => {
    expect(compareDshVersions('0.1.0-rc.8', '0.1.0-rc.8')).toBe(0)
    expect(compareDshVersions('0.1.0-rc.9', '0.1.0-rc.8')).toBe(1)
    expect(compareDshVersions('0.1.0-rc.7', '0.1.0-rc.8')).toBe(-1)
    expect(compareDshVersions('0.1.0-rc.10', '0.1.0-rc.9')).toBe(1) // numeric, not lexicographic
    expect(compareDshVersions('0.1.0', '0.1.0-rc.9')).toBe(1) // release > pre-release
    expect(compareDshVersions('0.1.0-rc.9', '0.1.0')).toBe(-1)
  })

  it('orders the core triple and multi-identifier pre-releases', () => {
    expect(compareDshVersions('0.2.0-rc.1', '0.1.0-rc.9')).toBe(1)
    expect(compareDshVersions('0.1.1', '0.1.0')).toBe(1)
    expect(compareDshVersions('1.0.0', '0.99.99')).toBe(1)
    expect(compareDshVersions('0.1.0-rc.8.1', '0.1.0-rc.8')).toBe(1) // longer wins as prefix
    expect(compareDshVersions('0.1.0-alpha', '0.1.0-rc.1')).toBe(-1) // lexicographic
    expect(compareDshVersions('0.1.0-1', '0.1.0-alpha')).toBe(-1) // numeric < alphanumeric
  })
})

describe('assertMinDshVersion — the fail-loud guard (fake source)', () => {
  it('passes when installed >= min (equality included)', () => {
    expect(() => assertMinDshVersion('0.1.0-rc.8', fakeSource('0.1.0-rc.8'))).not.toThrow()
    expect(() => assertMinDshVersion('0.1.0-rc.8', fakeSource('0.1.0-rc.9'))).not.toThrow()
    expect(() => assertMinDshVersion('0.1.0-rc.8', fakeSource('0.1.0'))).not.toThrow()
    expect(() => assertMinDshVersion('0.1.0-rc.8', fakeSource('2.0.0-rc.1'))).not.toThrow()
  })

  it('THROWS MIN_VERSION_VIOLATION when installed < min (both values named)', () => {
    const e = throws(() => assertMinDshVersion('0.1.0-rc.8', fakeSource('0.1.0-rc.7')))
    expect(e).toBeInstanceOf(DshVersionError)
    const d = e as DshVersionError
    expect(d.code).toBe('MIN_VERSION_VIOLATION')
    expect(d.message).toContain('"0.1.0-rc.7"')
    expect(d.message).toContain('"0.1.0-rc.8"')
  })

  it('THROWS VERSION_UNREACHABLE when the version is unobservable (never silently skipped)', () => {
    const e = throws(() => assertMinDshVersion('0.1.0-rc.8', fakeSource(null)))
    expect(e).toBeInstanceOf(DshVersionError)
    expect((e as DshVersionError).code).toBe('VERSION_UNREACHABLE')
  })

  it('rejects a malformed MINIMUM (INVALID_VERSION — the config is the input boundary)', () => {
    const e = throws(() => assertMinDshVersion('garbage', fakeSource('0.1.0-rc.8')))
    expect(e).toBeInstanceOf(DshVersionError)
    expect((e as DshVersionError).code).toBe('INVALID_VERSION')
  })
})

describe('createPackageVersionSource — the installed-package channel (REAL)', () => {
  it('reads the installed version of the real devDependency in THIS repo (the host channel)', () => {
    const source = createPackageVersionSource(DSH_VERSION_PACKAGE, import.meta.url)
    const version = source.getHostVersion()
    // the repo's exact pin (package.json peerDependencies + devDependencies)
    expect(version).toBe('0.1.1-rc.2')
    // and the guard passes against it
    expect(() => assertMinDshVersion('0.1.0-rc.8', source)).not.toThrow()
    const e = throws(() => assertMinDshVersion('0.1.1-rc.3', source))
    expect(e).toBeInstanceOf(DshVersionError)
    expect((e as DshVersionError).code).toBe('MIN_VERSION_VIOLATION')
  })

  it('caches the first read (stable across calls)', () => {
    const source = createPackageVersionSource(DSH_VERSION_PACKAGE, import.meta.url)
    expect(source.getHostVersion()).toBe(source.getHostVersion())
  })

  it('returns null for an unresolvable package (the assert then fails loud downstream)', () => {
    const source = createPackageVersionSource('@deepseek-ai/does-not-exist-wp26', import.meta.url)
    expect(source.getHostVersion()).toBeNull()
  })

  it('the repo pin and the installed manifest agree (the lockstep evidence for the report)', () => {
    const pluginPkg = JSON.parse(readFileSync(join(HERE, '..', '..', 'package.json'), 'utf8')) as {
      peerDependencies: Record<string, string>
      devDependencies: Record<string, string>
    }
    expect(pluginPkg.peerDependencies[DSH_VERSION_PACKAGE]).toBe('0.1.1-rc.2')
    expect(pluginPkg.devDependencies[DSH_VERSION_PACKAGE]).toBe('0.1.1-rc.2')
    expect(createPackageVersionSource(DSH_VERSION_PACKAGE, import.meta.url).getHostVersion()).toBe('0.1.1-rc.2')
  })
})
