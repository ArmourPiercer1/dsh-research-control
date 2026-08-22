/**
 * WP-2.6 (rider 3, RR-008 / DSH_ADAPTER §12-②) — the `minDshVersion`
 * fail-loud host-version guard.
 *
 * DSH_ADAPTER §12: 「DSH 无 plugin API 版本检查机制 … 做法：② 插件 `Config`
 * 自持 `minDshVersion` 字段，`[Service.init]` 与宿主可观测版本比对
 * fail-loud [?]（宿主版本获取途径：plugin-inventory 快照内容，Phase 0
 * 验证）」. This WP resolves the `[?]` — the observability investigation
 * (WP-2.6 report, 骑手 3 专节) found:
 *
 *   - NO host service carries the host version: the plugin-inventory
 *     snapshot (`packages/host/plugin-inventory/src/types.ts`
 *     `PluginInventoryEntry` — entryId/moduleName/enabled/fiberPhase only)
 *     does not, the Loader entries do not, and the CLI only PRINTS the
 *     version (`dsh --version`, `apps/cli/src/bin.ts`);
 *   - the channel the plugin CAN read: the INSTALLED version of the
 *     `@deepseek-ai/dsh-*` packages the host runtime actually loaded — all
 *     dsh-* packages (and the CLI app) are versioned in lockstep with the
 *     harness root `package.json` (checkout `0.1.0-rc.8`, verified across
 *     typert-protocol / core-session / host-plugin-inventory / boot-app-boot).
 *     The plugin already imports `@deepseek-ai/dsh-typert-protocol` at
 *     runtime (WP-0.3 TypertRemoteService), so resolving ITS installed
 *     `package.json` `version` from the plugin's own module location reads
 *     exactly the host's package version.
 *
 * Guard semantics (TC-DSH-008 「版本不匹配时明确报错而非静默失败」):
 *   - `actual < min`  → THROW (the `[Service.init]` throw fails the fiber —
 *     it never reaches ACTIVE);
 *   - `actual >= min` → pass;
 *   - version UNREADABLE (package unresolvable / manifest unreadable / no
 *     `version` field) → THROW (`VERSION_UNREACHABLE`): a guard that cannot
 *     observe the version must not be silently skipped (fail loud);
 *   - malformed version strings THROW (`INVALID_VERSION`) — a comparison on
 *     garbage would be a silent lie.
 */

import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** Structured guard failure. */
export class DshVersionError extends Error {
  readonly code: 'INVALID_VERSION' | 'MIN_VERSION_VIOLATION' | 'VERSION_UNREACHABLE'
  /** The offending value(s) for diagnostics. */
  readonly value?: string

  constructor(init: { code: DshVersionError['code']; message: string; value?: string }) {
    super(init.message)
    this.name = 'DshVersionError'
    this.code = init.code
    if (init.value !== undefined) this.value = init.value
  }
}

/** One parsed version (core triple + optional pre-release identifiers). */
interface ParsedVersion {
  core: readonly [number, number, number]
  pre: readonly string[]
}

/**
 * Parse a strict `MAJOR.MINOR.PATCH[-pre]` version. Pre-release identifiers
 * follow semver §10 (dot-separated; numeric vs alphanumeric). Build
 * metadata (`+build`) is NOT accepted — the harness uses none and a build
 * suffix would silently change the observable value.
 */
export function parseDshVersion(value: string): ParsedVersion {
  if (typeof value !== 'string' || value.length === 0) {
    throw new DshVersionError({ code: 'INVALID_VERSION', message: `version must be a non-empty string (got ${JSON.stringify(value)})`, value: String(value) })
  }
  const dash = value.indexOf('-')
  const corePart = dash === -1 ? value : value.slice(0, dash)
  const prePart = dash === -1 ? null : value.slice(dash + 1)
  const parts = corePart.split('.')
  if (parts.length !== 3 || parts.some((p) => !/^[0-9]+$/.test(p))) {
    throw new DshVersionError({
      code: 'INVALID_VERSION',
      message: `version core must be MAJOR.MINOR.PATCH with non-negative integer segments (got ${JSON.stringify(corePart)})`,
      value,
    })
  }
  const core = parts.map(Number) as [number, number, number]
  if (core.some((n) => !Number.isSafeInteger(n))) {
    throw new DshVersionError({ code: 'INVALID_VERSION', message: `version segments overflow safe integers (got ${JSON.stringify(corePart)})`, value })
  }
  if (prePart === null) return { core, pre: [] }
  if (prePart.length === 0) {
    throw new DshVersionError({ code: 'INVALID_VERSION', message: `version ${JSON.stringify(value)} has an empty pre-release segment`, value })
  }
  const pre = prePart.split('.')
  for (const id of pre) {
    if (id.length === 0 || !/^[0-9A-Za-z-]+$/.test(id)) {
      throw new DshVersionError({ code: 'INVALID_VERSION', message: `version ${JSON.stringify(value)} has an illegal pre-release identifier ${JSON.stringify(id)}`, value })
    }
  }
  return { core, pre: pre as readonly string[] }
}

/**
 * Compare two strict versions (semver §11 precedence):
 *  - core triples compare numerically, segment by segment;
 *  - equal cores: a PRE-RELEASE has lower precedence than the release
 *    (`0.1.0-rc.8 < 0.1.0`);
 *  - both pre-release: identifier by identifier — numeric identifiers
 *    compare numerically, numeric < alphanumeric, otherwise lexicographic;
 *    the longer list wins when the shorter is a prefix.
 * @returns -1 / 0 / 1.
 * @throws `DshVersionError` (`INVALID_VERSION`) on either malformed value.
 */
export function compareDshVersions(a: string, b: string): -1 | 0 | 1 {
  const va = parseDshVersion(a)
  const vb = parseDshVersion(b)
  for (let i = 0; i < 3; i += 1) {
    if (va.core[i] !== vb.core[i]) return va.core[i] < vb.core[i] ? -1 : 1
  }
  if (va.pre.length === 0 && vb.pre.length === 0) return 0
  if (va.pre.length === 0) return 1 // release > pre-release
  if (vb.pre.length === 0) return -1
  const n = Math.min(va.pre.length, vb.pre.length)
  for (let i = 0; i < n; i += 1) {
    const x = va.pre[i]
    const y = vb.pre[i]
    const xn = /^[0-9]+$/.test(x)
    const yn = /^[0-9]+$/.test(y)
    if (xn && yn) {
      const dx = Number.parseInt(x, 10) - Number.parseInt(y, 10)
      if (dx !== 0) return dx < 0 ? -1 : 1
    } else if (xn) {
      return -1 // numeric < alphanumeric
    } else if (yn) {
      return 1
    } else if (x !== y) {
      return x < y ? -1 : 1
    }
  }
  if (va.pre.length !== vb.pre.length) return va.pre.length < vb.pre.length ? -1 : 1
  return 0
}

/**
 * The observable host-version source (the WP-2.6 investigation channel,
 * module doc): reads the `version` field of the INSTALLED package's
 * `package.json`, resolved from the given module URL — i.e. the package the
 * host runtime actually loaded.
 */
export interface DshVersionSource {
  /** The installed version, or `null` when it cannot be determined
   *  (package unresolvable / manifest unreadable / `version` absent). */
  readonly getHostVersion: () => string | null
}

/**
 * The package whose installed version is the host-version signal: a dsh-*
 * package this plugin already imports at runtime (WP-0.3) — ALL dsh-*
 * packages are versioned in lockstep with the harness (module doc).
 */
export const DSH_VERSION_PACKAGE = '@deepseek-ai/dsh-typert-protocol'

/**
 * Build a `DshVersionSource` over the installed `package.json` of
 * `packageName`, resolved from `fromUrl` (the caller's `import.meta.url` —
 * in the bundled plugin every module shares one location, so any of them
 * resolves the same host node_modules tree). Resolution + read are LAZY
 * (on the first `getHostVersion` call) so constructing the source can
 * never fail; unreadability surfaces as `null` (the assert then throws
 * `VERSION_UNREACHABLE`).
 */
export function createPackageVersionSource(packageName: string, fromUrl: string): DshVersionSource {
  let cached: string | null | undefined
  return {
    getHostVersion(): string | null {
      if (cached !== undefined) return cached
      let version: string | null = null
      try {
        const require = createRequire(fromUrl)
        const entry = require.resolve(packageName)
        let dir = dirname(entry)
        for (let i = 0; i < 8; i += 1) {
          let manifest: unknown
          try {
            manifest = JSON.parse(readFileSync(`${dir}/package.json`, 'utf8'))
          } catch {
            manifest = null
          }
          if (manifest !== null && typeof manifest === 'object' && (manifest as { name?: unknown }).name === packageName) {
            const v = (manifest as { version?: unknown }).version
            version = typeof v === 'string' && v.length > 0 ? v : null
            break
          }
          const parent = dirname(dir)
          if (parent === dir) break
          dir = parent
        }
      } catch {
        version = null // unresolvable — the assert fails loud downstream
      }
      cached = version
      return version
    },
  }
}

/**
 * The `[Service.init]` guard (DSH_ADAPTER §12-② / RR-008): compare the
 * installed host version against `minDshVersion` and FAIL LOUD on
 * violation or on an unobservable version (module doc semantics).
 *
 * @param minDshVersion - the Config-validated minimum (default
 *   `0.1.0-rc.8` — the default lives in the schema, not here).
 * @param source - the observable host-version channel.
 * @throws `DshVersionError` (`MIN_VERSION_VIOLATION` /
 *   `VERSION_UNREACHABLE` / `INVALID_VERSION`).
 */
export function assertMinDshVersion(minDshVersion: string, source: DshVersionSource): void {
  parseDshVersion(minDshVersion) // malformed minimum → INVALID_VERSION (fail loud before comparing)
  const actual = source.getHostVersion()
  if (actual === null) {
    throw new DshVersionError({
      code: 'VERSION_UNREACHABLE',
      message:
        `minDshVersion guard: the installed DSH host version is UNREADABLE (expected a resolvable ` +
        `${DSH_VERSION_PACKAGE} package.json) — the guard cannot verify compatibility and refuses to ` +
        'silently skip (DSH_ADAPTER §12-② fail-loud)',
      value: String(minDshVersion),
    })
  }
  if (compareDshVersions(actual, minDshVersion) < 0) {
    throw new DshVersionError({
      code: 'MIN_VERSION_VIOLATION',
      message:
        `minDshVersion guard: installed DSH host version ${JSON.stringify(actual)} is BELOW the required ` +
        `minimum ${JSON.stringify(minDshVersion)} (DSH_ADAPTER §12-②; upgrade the host or lower the ` +
        'plugin config) — the plugin fiber refuses to start',
      value: actual,
    })
  }
}
