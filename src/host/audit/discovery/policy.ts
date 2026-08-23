/**
 * WP-6.2 — discovery zone scanner: policy normalization + path matching
 * (pure, no I/O).
 *
 * Frozen basis: DOMAIN_SCHEMA §14.1 `audit` block (原文为准):
 *   - `discovery_zones[].path` — 目录白名单（第二层；计划书 §22.1
 *     「results/ docs/ figures/ selected output dirs/」均为目录）;
 *   - `ignored` — 第三层（「不扫描」，GIT_INTEGRATION §8）;
 *   - `strict_tracked.paths` — 第一层「关键代码 / Task deliverables /
 *     merge 相关文件 **glob**」（显式 glob 语义，区别于 zone 的目录
 *     前缀语义）.
 *
 * Schema defaults (workspace.schema.json `default`s, 与 loader ajv
 * `useDefaults` 同面): missing `audit` / missing block / missing array
 * all normalize to empty — an empty zone list scans NOTHING (zones is
 * the whitelist; §22.1 第二层只覆盖列出的目录).
 *
 * Path canonicalization (both policy entries and scanned/rel paths):
 * workspace-root-relative, POSIX `/` separators, no leading `./` or `/`,
 * no trailing `/`. `..` segments are REJECTED (fail loud — a policy or
 * feed path escaping the workspace root is a configuration/contract
 * violation, never silently clamped).
 */

import type { WorkspaceDoc } from '../../domain/loader/index.js'
import type { DiscoveryPolicy, NormalizedZone, PathLayer } from './types.js'

/**
 * Thrown for policy misconfiguration (fail loud, 同 loader 口径).
 * `code` is stable for machine dispatch; `message` is human-readable.
 */
export class DiscoveryPolicyError extends Error {
  readonly code: 'DISC_POLICY_INVALID'
  constructor(message: string) {
    super(message)
    this.name = 'DiscoveryPolicyError'
    this.code = 'DISC_POLICY_INVALID'
  }
}

/**
 * Normalize one policy path entry (zone dir / ignored dir / glob).
 *
 * Rules (mechanical, frozen):
 *  - backslashes are treated as separators (user-authored YAML
 *    convenience; a literal `\` in a workspace path is out of V1 scope);
 *  - leading `./` and leading `/` are stripped;
 *  - trailing `/` is stripped (zone `results/` ≡ `results`);
 *  - an entry that is empty (or only `.`/`/`) normalizes to `''`
 *    (the workspace root) for zones and ignored; for strict globs an
 *    empty entry matches NOTHING (see `compileGlob`) — the caller
 *    decides;
 *  - any `..` segment throws `DiscoveryPolicyError`.
 *
 * `path` is the raw entry (for error messages).
 */
export function normalizePolicyPath(path: string, label: string): string {
  if (typeof path !== 'string') {
    throw new DiscoveryPolicyError(`${label}: not a string (${String(path)})`)
  }
  const unix = path.replace(/\\/g, '/')
  const segments = unix.split('/')
  for (const seg of segments) {
    if (seg === '..') {
      throw new DiscoveryPolicyError(
        `${label}: "${path}" contains a ".." segment — policy paths must stay inside the workspace root`,
      )
    }
  }
  let out = ''
  if (segments.length > 0) {
    // drop empties (leading/trailing slashes, doubled slashes) and '.'
    out = segments.filter((s) => s.length > 0 && s !== '.').join('/')
  }
  return out
}

/**
 * Normalize the §14.1 `audit` block into a {@link DiscoveryPolicy}
 * (schema defaults materialized; zones de-duplicated by normalized dir —
 * duplicate dirs merge their `artifact_types` hints in first-seen order,
 * preserving the frozen ArtifactType vocabulary order).
 *
 * @throws DiscoveryPolicyError on `..` segments or non-array blocks.
 */
export function normalizePolicy(audit: WorkspaceDoc['audit'] | null | undefined): DiscoveryPolicy {
  const rawZones = audit?.discovery_zones
  const rawIgnored = audit?.ignored
  const rawStrict = audit?.strict_tracked?.paths
  if (rawZones !== undefined && !Array.isArray(rawZones)) {
    throw new DiscoveryPolicyError('audit.discovery_zones: not an array')
  }
  if (rawIgnored !== undefined && !Array.isArray(rawIgnored)) {
    throw new DiscoveryPolicyError('audit.ignored: not an array')
  }
  if (rawStrict !== undefined && !Array.isArray(rawStrict)) {
    throw new DiscoveryPolicyError('audit.strict_tracked.paths: not an array')
  }

  // zones — de-dup by normalized dir, merge hints deterministically
  const byDir = new Map<string, NormalizedZone>()
  for (const zone of rawZones ?? []) {
    const rawPath = zone?.path
    if (typeof rawPath !== 'string' || rawPath.length === 0) {
      throw new DiscoveryPolicyError(`audit.discovery_zones: entry without a non-empty "path" (${JSON.stringify(zone)})`)
    }
    const dir = normalizePolicyPath(rawPath, 'audit.discovery_zones')
    const hint: NormalizedZone['artifactTypes'] = Array.isArray(zone?.artifact_types)
      ? (zone?.artifact_types as readonly NormalizedZone['artifactTypes'][number][])
      : []
    const existing = byDir.get(dir)
    if (existing === undefined) {
      byDir.set(dir, { rawPath, dir, artifactTypes: [...hint] })
    } else if (existing.artifactTypes.length === 0 && hint.length > 0) {
      // first hint wins ordering; only fill when the first had none
      byDir.set(dir, { ...existing, artifactTypes: [...hint] })
    }
  }

  const ignored = (rawIgnored ?? []).map((entry, i) =>
    normalizePolicyPath(String(entry), `audit.ignored[${i}]`),
  )
  const strictTrackedGlobs = (rawStrict ?? []).map((entry, i) =>
    normalizePolicyPath(String(entry), `audit.strict_tracked.paths[${i}]`),
  )

  return {
    zones: [...byDir.values()],
    ignored: [...new Set(ignored)],
    strictTrackedGlobs: [...new Set(strictTrackedGlobs)],
  }
}

/**
 * Compile one strict-tracked glob (计划书 §14.1「glob」) to an anchored
 * RegExp over workspace-root-relative POSIX paths. Mechanical V1 subset:
 *  - `**`  — any number (≥ 0) of whole path segments; a trailing
 *    `src/**` (or trailing `/` form `src/`) matches every file UNDER
 *    `src` at any depth;
 *  - `*`   — any run of characters except `/` (within one segment);
 *  - `?`   — exactly one character except `/`;
 *  - every other character is matched literally (escaped);
 *  - a trailing `/` marks a DIRECTORY glob (matches all files under it,
 *    any depth) — `src/` ≡ `src/**`;
 *  - a glob with no `/` (after normalization) matches exactly one file
 *    with that name at the root (standard glob semantics — NOT a
 *    directory prefix; zones are where directory-whitelist semantics
 *    live);
 *  - the empty glob matches nothing (a no-op entry).
 *
 * @returns the anchored RegExp, or `null` for the empty (no-op) glob.
 */
export function compileGlob(glob: string): RegExp | null {
  if (glob.length === 0) return null
  let body = glob
  let dirGlob = false
  if (body.endsWith('/')) {
    dirGlob = true
    body = body.slice(0, -1)
  }
  if (body.length === 0) {
    // root directory glob (`/` or `./`) — every non-empty path under the root
    return new RegExp('^[^/]+(?:/[^/]+)*$')
  }
  const segments = body.split('/')
  let re = ''
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    if (seg === '**') {
      // zero or more whole segments before the next segment (or end)
      re += '(?:[^/]+/)*'
      continue
    }
    for (const ch of seg) {
      if (ch === '*') re += '[^/]*'
      else if (ch === '?') re += '[^/]'
      else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
    if (i < segments.length - 1) re += '/'
  }
  const isTrailingDoubleStar = segments[segments.length - 1] === '**'
  if (isTrailingDoubleStar) {
    // `src/**` — the `**` expansion above left a trailing `(?:.../)*`, so
    // append "at least one more segment" (files, at any depth under src)
    re += '[^/]+(?:/[^/]+)*'
  } else if (dirGlob) {
    // `src/` — every file under the directory, any depth
    re += '/[^/]+(?:/[^/]+)*'
  }
  return new RegExp(`^${re}$`)
}

/** Directory-prefix match: `rel` is strictly UNDER `dir` (or `dir` is the root). */
function underDir(rel: string, dir: string): boolean {
  if (dir.length === 0) return true
  if (rel === dir) return false // a file EQUAL to the dir name is not under it
  return rel.startsWith(dir + '/')
}

/** The zone whose normalized dir contains `rel` (first zone wins; `null` = none). */
export function matchZone(policy: DiscoveryPolicy, rel: string): NormalizedZone | null {
  for (const zone of policy.zones) {
    if (underDir(rel, zone.dir)) return zone
  }
  return null
}

/** Third layer (不扫描): `rel` is under an ignored dir, or IS one. */
export function isIgnored(policy: DiscoveryPolicy, rel: string): boolean {
  return policy.ignored.some((dir) => rel === dir || underDir(rel, dir))
}

/** First layer (WP-6.1 jurisdiction): `rel` matches any strict-tracked glob. */
export function isStrictTracked(policy: DiscoveryPolicy, rel: string): boolean {
  for (const glob of policy.strictTrackedGlobs) {
    const re = compileGlob(glob)
    if (re !== null && re.test(rel)) return true
  }
  return false
}

/**
 * The three-layer partition for one relative path (precedence frozen):
 * `.git/` and top-level `.research/` are OUT_OF_SCOPE by construction at
 * the walk/feed boundary (they never reach here as candidates);
 * otherwise IGNORED (第三层) > STRICT_TRACKED (第一层) > ZONE (第二层)
 * > OUT_OF_SCOPE.
 */
export function classifyPath(policy: DiscoveryPolicy, rel: string): PathLayer {
  if (isIgnored(policy, rel)) return 'IGNORED'
  if (isStrictTracked(policy, rel)) return 'STRICT_TRACKED'
  if (matchZone(policy, rel) !== null) return 'ZONE'
  return 'OUT_OF_SCOPE'
}

/**
 * Validate + normalize one FEED path (git-reported, so NO backslash
 * rewriting — git porcelain on POSIX emits real names). Rules:
 * non-empty; strip a single leading `./`; reject absolute paths, `..`
 * segments, and empty-after-strip.
 *
 * @returns the normalized relative path, or `null` when the entry is a
 *   `BAD_PATH` skip.
 */
export function normalizeFeedPath(path: string): string | null {
  if (typeof path !== 'string' || path.length === 0) return null
  let out = path
  if (out.startsWith('./')) out = out.slice(2)
  if (out.length === 0) return null
  if (out.startsWith('/')) return null
  for (const seg of out.split('/')) {
    if (seg === '..') return null
  }
  return out
}
