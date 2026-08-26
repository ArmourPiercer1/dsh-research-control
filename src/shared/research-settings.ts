/**
 * The research settings domain — the PURE core shared by the host half and
 * the client half (V2-T6.1, design §7.5 / Q4).
 *
 * The host half (src/host/dsh-adapter/host/settings.ts) owns the DSH wiring
 * (the optional-service settings face, the schemastery registration, the
 * live read the discovery layer consumes) and re-exports this module's
 * frozen face; the client half (the DSH 设置 plugin card, V2-T6.1) consumes
 * it directly. Everything in here is dependency-free and unit-testable
 * without a cordis context — the same separation the host file documents.
 */

import type { PlaneStateSummary } from './rpc-contracts.js'

/* ------------------------------------------------------------------ *
 * Frozen §7.5 field table (namespace + defaults)
 * ------------------------------------------------------------------ */

/**
 * The DSH user-settings namespace owned by this plugin (frozen §7.5 —
 * 「按设置域 namespace 配对」). The host's `settingsNamespace()` brands
 * exactly this string pattern; the plugin keeps it as a plain string
 * because it does not devDep on `@deepseek-ai/dsh-settings`. The client
 * card registers into the `settings.plugin.item` slot under THIS key, so
 * the host and the browser half pair on the same name.
 */
export const RESEARCH_SETTINGS_NAMESPACE = 'dsh-research-control'

/** The project data directory name, default (the per-project declarative tree). */
export const DEFAULT_PROJECT_TREE_DIR = '.research'

/** The management-center directory name, default (hub marker + registry + dbs). */
export const DEFAULT_HUB_DIR = '.research-control'

/** Length cap for one configurable directory name (frozen §7.5 校验). */
export const MAX_DIR_NAME_LENGTH = 64

/**
 * One resolved section of the research settings namespace — the shape both
 * halves speak: the host schema's value, the client card's snapshot value,
 * and the two-phase save's write payload.
 */
export interface ResearchSettingsSection {
  /** The project data directory name (a single path segment). */
  readonly projectTreeDir: string
  /** The management-center directory name (a single path segment). */
  readonly hubDir: string
}

/* ------------------------------------------------------------------ *
 * Directory-name validation (frozen §7.5 校验 rule)
 * ------------------------------------------------------------------ */

/**
 * The four violation CLASSES of the frozen §7.5 rule — the stable codes
 * an i18n layer maps to per-language copy. The host read path warns with
 * the English phrase (`validateDirName`); the client card renders the
 * Chinese inline error (the view's mapping over these codes). Both map
 * off the SAME classifier, so the rule lives in exactly one place.
 */
export type DirNameViolation = 'empty' | 'too-long' | 'slash' | 'dot'

/**
 * Classify a candidate directory name against the frozen §7.5 rule
 * (single path segment, leading dot allowed, no "/", no "."/"..",
 * non-empty, ≤ {@link MAX_DIR_NAME_LENGTH}).
 *
 * @returns `null` when valid, else the violation class (checked in the
 *  same priority order the rule documents).
 */
export function classifyDirNameViolation(value: string): DirNameViolation | null {
  if (value.length === 0) return 'empty'
  if (value.length > MAX_DIR_NAME_LENGTH) return 'too-long'
  if (value.includes('/')) return 'slash'
  if (value === '.' || value === '..') return 'dot'
  return null
}

/**
 * Validate one configurable directory name against the frozen §7.5 rule:
 * a SINGLE path segment, leading dot allowed (`.research`), `/` forbidden,
 * the literal names `.`/`..` forbidden, non-empty, length ≤
 * {@link MAX_DIR_NAME_LENGTH}.
 *
 * The rule is a PURE function of the candidate string — the host read path
 * (invalid → default + warn) and the client card (inline error + save
 * blocked) run the same code, so a value the card refuses is a value the
 * host would refuse to keep.
 *
 * @param value - the candidate directory name.
 * @returns `null` when valid, else a human-readable violation phrase
 *  (the read path falls back to the default and warns with it; the
 *  §7.5 save transaction pre-checks the same way before writing).
 */
export function validateDirName(value: string): string | null {
  const code = classifyDirNameViolation(value)
  if (code === null) return null
  switch (code) {
    case 'empty':
      return 'must not be empty'
    case 'too-long':
      return `must be at most ${MAX_DIR_NAME_LENGTH} characters (got ${value.length})`
    case 'slash':
      return 'must be a single path segment (no "/")'
    case 'dot':
      return 'must not be "." or ".."'
  }
}

/* ------------------------------------------------------------------ *
 * The §7.5 two-phase save — the pure verification step
 * ------------------------------------------------------------------ */

/**
 * What a directory rename made unreachable (the §7.5 校验发现结果 step).
 * `hubLost` is the hub marker the plane detected before the save no longer
 * being recognized; `lostTreePaths` are the project trees that were
 * detected before the save and are no longer detected after it.
 */
export interface LostDiscovery {
  /** Whether the pre-save hub is no longer recognized. */
  readonly hubLost: boolean
  /** The pre-save hub's workspace path (the rename made it unreachable); `null` when the plane had no hub before the save. */
  readonly hubPath: string | null
  /** Every pre-save detected project tree that the post-save discovery no longer finds. */
  readonly lostTreePaths: string[]
}

/**
 * Compare the pre-save and post-save discovery snapshots and report what
 * the rename made unreachable — the pure core of the §7.5 two-phase save
 * transaction (write → rescan → **verify** → roll back on loss).
 *
 * Baseline semantics (frozen §7.5): a rename takes effect on restart; the
 * rescan covers what it can and startup discovery is the fallback — so the
 * verification is conservative: it only flags what the plane DETECTED
 * before the save and the rescan no longer finds (projects in the pre-save
 * `projects` set, the pre-save hub). Entries that were already missing
 * before the save are out of scope: the rename is not responsible for
 * losses that stood before it, and the card's warning must name only
 * what the save itself broke.
 *
 * A hub is lost when the pre-save summary carried a hub and the post-save
 * summary carries none, or carries one at a DIFFERENT workspace path
 * (the hub workspace path is stable across a rename — a moved hub path is
 * a different hub, which the §3.1 「恰好一个」 rule treats as a new
 * discovery, but for the save transaction the pre-save hub is gone
 * either way).
 *
 * @param pre - the discovery state BEFORE the settings write (the plane
 *  state as last scanned under the OLD names).
 * @param post - the discovery state AFTER the rescan under the NEW names.
 * @returns the loss report; `{ hubLost: false, hubPath: null,
 *  lostTreePaths: [] }` when the rename lost nothing.
 */
export function findLostDiscovery(
  pre: Pick<PlaneStateSummary, 'hub' | 'projects'>,
  post: Pick<PlaneStateSummary, 'hub' | 'projects'>,
): LostDiscovery {
  const hubLost =
    pre.hub !== null && (post.hub === null || post.hub.path !== pre.hub.path)
  const foundAfter = new Set(post.projects.map((p) => p.wsPath))
  const lostTreePaths = pre.projects
    .filter((p) => !foundAfter.has(p.wsPath))
    .map((p) => p.wsPath)
  return {
    hubLost,
    hubPath: pre.hub === null ? null : pre.hub.path,
    lostTreePaths,
  }
}

/* ------------------------------------------------------------------ *
 * The §7.5 two-phase save — the outcome the client card renders
 * ------------------------------------------------------------------ */

/**
 * The outcome of one §7.5 save attempt, as the adapter reports it to the
 * card view (the view renders a state per status; the adapter owns every
 * wire call and every rollback, the view owns only its own draft and
 * status line — the client/AGENTS.md rule 7 inject-face split).
 *
 * - `saved` — write + rescan + verification all clean (brief 已保存);
 * - `missing` — the rename lost a detected hub/tree: the warning
 *  「请先在磁盘上重命名文件夹，再保存」+ BOTH fields auto-rolled back;
 * - `rescan-error` — the pre-save check or the rescan failed: the
 *  transaction treats failure as loss-equivalent and keeps nothing
 *  (nothing was written, or the writes were rolled back) — no silent
 *  success, the old values stay visible;
 * - `write-error` — a settings-domain write failed: nothing is kept
 *  (nothing was written, or the partial write was rolled back).
 */
export type ResearchSettingsSaveOutcome =
  | { readonly status: 'saved' }
  | {
      readonly status: 'missing'
      readonly hubLost: boolean
      readonly hubPath: string | null
      readonly lostTreePaths: string[]
    }
  | { readonly status: 'rescan-error'; readonly message: string }
  | { readonly status: 'write-error'; readonly message: string }
