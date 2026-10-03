/**
 * V2-T2.1 — the research settings domain, host half (design §7.5 / §3.1,
 * Q4): the DSH user-settings namespace carrying the two configurable
 * directory names.
 *
 * ## The namespace
 *
 * `dsh-research-control` (frozen §7.5 field table) holds EXACTLY two
 * fields, each a single path segment used by the discovery layer (T2.2)
 * to recognize workspaces' root-level directories (frozen §3.1):
 *
 *  - `projectTreeDir` — the project data directory name, default
 *    `.research` (the per-project declarative tree);
 *  - `hubDir` — the management-center directory name, default
 *    `.research-control` (the hub marker + `registry.yaml` + the
 *    per-project databases).
 *
 * Discovery recognizes ONLY the configured names (§3.1 「发现逻辑只认
 * 配置后的名字」) — T2.2 reads them exclusively through
 * {@link getResearchDirNames}, never through a hardcoded literal.
 *
 * ## Resilience discipline (external-plugin robustness)
 *
 * The settings service is OPTIONAL and is read through the documented
 * optional-service face `ctx.get('settings')` (DSH_ADAPTER §4 要点
 * 「可选服务用 `ctx.get('name')`」, the launcher adapter's `agents`
 * precedent) — NEVER a hard `static inject` entry: pinning this
 * plugin's activation on the host's settings composition would make a
 * deployment without settings unload the whole research plane.
 *
 *  - service absent → ONE `console.warn` + the defaults (the plugin
 *    loads, discovery runs on `.research` / `.research-control`);
 *  - stored section present but a FIELD invalid → per-field fallback to
 *    the default + a `console.warn` naming the field, the value, and
 *    the violation (frozen §4 step 1: 「读设置 → 解析 <treeDir>/<hubDir>
 *    （非法即回退默认并告警）」 — fallback and warn, never a boot
 *    failure: a typoed value must not take down the 13-RPC plane).
 *
 * The field-level name rule ({@link validateDirName}) is deliberately
 * NOT expressed as a schemastery constraint: a hard schema rejection
 * would fail the plugin's activation (0.1: rejecting the namespace
 * registration; 0.2: rejecting the plugin config), while the frozen
 * design requires the read path to fall back and warn instead.
 * The write side is guarded by the §7.5 two-phase save transaction
 * (write → rescan → validate the discovery → roll the field back) and
 * may pre-check values with {@link validateDirName} before writing.
 *
 * ## 0.2 settings model (registration retired)
 *
 * 0.2.0-rc.2 retired `settings.register`: a settings namespace IS a
 * profile plugin entry and its form schema IS the plugin `Config`
 * schema. The two §7.5 fields therefore live in `static Config` and the
 * namespace id is the profile entry id
 * ({@link RESEARCH_SETTINGS_ENTRY_ID}); reads ride the `describe()`
 * view (live on every call). {@link registerResearchSettings} keeps its
 * boot call site purely for observability (the settings card stays a
 * global preference the operator configures before any research tree
 * exists — §7.4 「全局偏好不在设置页，在 DSH 设置的插件卡片」).
 *
 * ## Layer rules
 *
 * This file is dsh-adapter territory (INV-PERM-5 exemption, ARCHITECTURE
 * §2.2 rule 2 — the same zone as `./index.ts`): it imports
 * `@deepseek-ai/cordis` (the `Context` type) and
 * `@deepseek-ai/schemastery` (the schema builder — the host index's
 * `static Config` precedent). The settings service itself is consumed
 * through the STRUCTURAL face {@link SettingsServiceLike} — the plugin
 * does not devDep on `@deepseek-ai/dsh-settings`; the host runtime
 * satisfies the shape structurally (the same structural-slice
 * discipline as the launcher adapter's `AgentsStoreLike`).
 *
 * Pure core ({@link validateDirName} / {@link resolveResearchDirNames})
 * is separated from the thin ctx wiring ({@link
 * registerResearchSettings} / {@link getResearchDirNames}) so the
 * resolution logic is unit-testable without a cordis context. V2-T6.1
 * moved the dependency-free half — the frozen §7.5 field table
 * (namespace + defaults), the directory-name rule, and the §7.5
 * save-transaction types — into `src/shared/research-settings.ts` so the
 * CLIENT half (the DSH 设置 plugin card) runs the SAME pure rule; this
 * file re-exports that frozen face unchanged (host semantics and the
 * host test imports are untouched).
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import { parse as parseYamlDocument } from 'yaml'
import {
  DEFAULT_HUB_DIR,
  DEFAULT_PROJECT_TREE_DIR,
  MAX_DIR_NAME_LENGTH,
  RESEARCH_SETTINGS_NAMESPACE,
  validateDirName,
  type ResearchSettingsSection,
} from '../../../shared/research-settings.js'

/* ------------------------------------------------------------------ *
 * Constants + schema (frozen §7.5 field table)
 * ------------------------------------------------------------------ */

/**
 * Frozen §7.5 field table — re-exported from the shared pure core
 * (V2-T6.1: the client card consumes the same constants; the host keeps
 * this file as the frozen export face — the host tests and the discovery
 * layer import from here exactly as before).
 */
export {
  RESEARCH_SETTINGS_NAMESPACE,
  DEFAULT_PROJECT_TREE_DIR,
  DEFAULT_HUB_DIR,
  MAX_DIR_NAME_LENGTH,
  validateDirName,
}

/**
 * Resolved research settings section (the schema's output shape) — the
 * shared section type, re-exported under the host's frozen name.
 */
export type ResearchSettings = ResearchSettingsSection

/**
 * The namespace schema registered with the host settings service
 * (schemastery — the host index `static Config` precedent; the ui-theme
 * `ThemeSettingsSchema` registration precedent). Shape + defaults only
 * (see the module header for why the name rule is not a schema
 * constraint); the `description` fields are the settings-card form
 * copy (product copy is Chinese — frozen §7.5 field labels).
 */
export const RESEARCH_SETTINGS_SCHEMA: s<ResearchSettings> = s.object({
  projectTreeDir: s
    .string()
    .description('项目数据目录名（工作区根级子目录；默认 .research）')
    .default(DEFAULT_PROJECT_TREE_DIR),
  hubDir: s
    .string()
    .description('管理中心目录名（工作区根级子目录；默认 .research-control）')
    .default(DEFAULT_HUB_DIR),
})

/* ------------------------------------------------------------------ *
 * Directory-name validation (frozen §7.5 校验 rule)
 * ------------------------------------------------------------------ */

/**
 * The frozen §7.5 directory-name rule lives in the shared pure core
 * (V2-T6.1 — `src/shared/research-settings.ts`: the client card runs
 * the SAME rule for its inline validation). It is re-exported above
 * under this file's frozen name, so the read path below and the host
 * tests consume it exactly as before — no host semantics moved.
 */

/* ------------------------------------------------------------------ *
 * Structural host faces + the pure resolution core
 * ------------------------------------------------------------------ */

/**
 * The host settings service face this module consumes (structural
 * mirror of `SettingsProvider`'s two used methods — checkout
 * `packages/settings/settings/src/index.ts`; the plugin does not
 * devDep on `@deepseek-ai/dsh-settings`, the host runtime satisfies
 * the shape structurally — the same discipline as the launcher
 * adapter's `AgentsStoreLike`).
 */
/**
 * One `describe()` view of a settings namespace. 0.2.0-rc.2 model
 * (`@deepseek-ai/dsh-settings` `SettingsForms`): a namespace IS a profile
 * plugin entry (`SettingsNamespaceView` — one view per profile plugin
 * entry), so `id` is the profile entry id and `value` the schema-resolved
 * section (schema defaults → composition base → user layer). Only the two
 * members the plugin reads; the host runtime satisfies it structurally.
 */
export interface SettingsDescriptorLike {
  /** The namespace key: the profile entry id (`entry.options.id` — the
   *  descriptor member is `ns`, NOT `id`; the real host proved it). */
  readonly ns: string
  readonly value: unknown
  /** The USER layer alone (keys the profile patch actually sets). The
   *  layered resolution needs it to tell "the user set the default"
   *  apart from "nobody set anything" — the merged `value` cannot. */
  readonly user?: unknown
}

/**
 * The 0.2 host settings service, structural slice (INV-PERM-5 exemption
 * zone; the plugin does NOT devDep `@deepseek-ai/dsh-settings`). 0.1's
 * `register`/`get` are retired (the real-host boot caught the stale
 * assumption): registration no longer exists — the plugin's own profile
 * entry IS its settings namespace — and reads ride `describe()`.
 */
export interface SettingsServiceLike {
  describe(options?: unknown): readonly SettingsDescriptorLike[]
  /** Public write face (the host form calls it; the legacy migration
   *  persists through exactly this). Optional on the structural slice —
   *  a service without it is read-only for migration purposes. */
  update?(ns: string, patch: object, expectedRevision?: number): Promise<unknown>
}

/**
 * The service-owned fallback section (the plugin's loader-resolved
 * Config — defaults + composition + user layer, e2e-verified): used when
 * the describe() view cannot answer (this fiber's own boot window, or a
 * service-degraded read). Fields pass the SAME per-field validation as
 * served values (a hand-edited profile layer must not smuggle a bad
 * name through the fallback path).
 */
export interface ResearchDirNamesFallback {
  /** Raw or cosmokit volatile-cell (`{ get(): string }` — the 0.2
   *  convention: host plugins read volatile Config fields through
   *  `.get()`, the bash-local `config.timeoutMs.get()` precedent; the
   *  loader mounts volatile fields as live cells). Unwrapped before the
   *  per-field validation. */
  readonly projectTreeDir?: unknown
  readonly hubDir?: unknown
}

/** The discovery-facing directory names (design §4 step 1 output). */
export interface ResearchDirNames {
  /** The project data directory name to scan for (default-applied). */
  readonly treeDir: string
  /** The management-center directory name to scan for (default-applied). */
  readonly hubDir: string
}

/**
 * One raw field layer for the layered resolution (values stay `unknown`
 * — every candidate passes the SAME per-field validation when consumed).
 */
export interface DirNameFieldLayer {
  readonly projectTreeDir?: unknown
  readonly hubDir?: unknown
}

/** Extra layers the layered resolver consults (beyond the served view
 *  and the service-Config fallback — see the matrix on
 *  {@link resolveResearchDirNames}). */
export interface ResearchDirResolutionOptions {
  /** The BOOT OVERLAY — the parsed 0.1 `settings.yaml` section, supplied
   *  ONLY while the one-shot migration is PENDING (the profile user layer
   *  carries no {@link RESEARCH_SETTINGS_MIGRATION_MARKER}). Pending lasts
   *  exactly one boot: the synchronous read serves the first upgraded
   *  boot's discovery (no manual rescan/restart), the atomic
   *  {@link migrateLegacyResearchSettings} then persists fields + marker
   *  through the host's own `ConfigEditor.edit`, and from then on the
   *  legacy document is PERMANENTLY out of the authority layers — a later
   *  reset back to a default stays default and never resurrects the old
   *  name (the file itself survives as a lazy backup; nothing rewrites or
   *  deletes it). The host legacy importer cannot carry this section:
   *  `LEGACY_SECTION_ENTRIES` only knows ui-developer-tools/
   *  ui-onboarding/shell (rc.2 settings index:200-206); the unmapped
   *  `dsh-research-control` section survives only in the renamed
   *  `.imported` file. */
  readonly legacy?: DirNameFieldLayer | undefined
  /** The raw profile user layer at boot (configEditor `override`) —
   *  during the boot window the served descriptor is absent and the
   *  Config fallback CANNOT tell a user-set default apart from an
   *  unset field; this layer can (empty ⇒ nobody set anything ⇒ the
   *  pending overlay may supply). */
  readonly userOverride?: DirNameFieldLayer | undefined
  /** This plugin's OWN profile entry id (custom installs carry a
   *  different one; the descriptor key follows the entry, the legacy
   *  section name never does). Defaults to
   *  {@link RESEARCH_SETTINGS_ENTRY_ID}. */
  readonly entryId?: string | undefined
}

/**
 * PURE resolution core (no ctx, no console — the warn sink is
 * injected): resolve each directory-name field through the priority
 * layers, validating every candidate with the SAME per-field rule
 * (frozen §4 step 1: 非法即回退默认并告警 — an invalid candidate warns
 * and the walk continues to the next layer).
 *
 * Priority (first VALID candidate wins, per field):
 *  1. the USER layer — the served descriptor's `user` once answered
 *     (else the `userOverride` boot layer): a value the user actually
 *     set ALWAYS wins — a legacy section never overwrites it;
 *  2. the LEGACY 0.1 section (explicit migration; see
 *     {@link ResearchDirResolutionOptions.legacy});
 *  3. the served 0.2 view (`value` — schema defaults merged with the
 *     composition base);
 *  4. the service Config fallback (loader-resolved, volatile cells
 *     unwrapped);
 *  5. the frozen defaults.
 *
 * Degradation warns (unchanged matrix):
 *  - service absent → NO warn (fired once by registerResearchSettings);
 *  - no describe() face → one warn regardless of layers (deployment
 *    anomaly);
 *  - entry not served (boot window) → warn ONLY when no other
 *    authority exists (no fallback, no legacy, no user override) —
 *    with any of them the window is documented behavior, not an anomaly.
 */
export function resolveResearchDirNames(
  settings: SettingsServiceLike | undefined,
  warn: (message: string) => void,
  fallback?: ResearchDirNamesFallback | undefined,
  options?: ResearchDirResolutionOptions | undefined,
): ResearchDirNames {
  const entryId = options?.entryId ?? RESEARCH_SETTINGS_ENTRY_ID
  let served: DirNameFieldLayer | undefined
  let user: DirNameFieldLayer | undefined = options?.userOverride
  const legacy = options?.legacy
  if (settings === undefined) {
    // No service at all: silent (the once-warn is registerResearchSettings' job).
  } else if (typeof settings.describe !== 'function') {
    warn(
      'the host settings service does not expose the 0.2 describe() face — the research ' +
        'settings namespace cannot be read, falling back to the remaining authorities',
    )
  } else {
    const entry = findResearchEntry(settings.describe(), entryId)
    if (entry !== undefined && entry.value !== undefined && entry.value !== null) {
      served = entry.value as DirNameFieldLayer
      if (entry.user !== undefined && entry.user !== null) user = entry.user as DirNameFieldLayer
    } else if (fallback === undefined && legacy === undefined && user === undefined) {
      warn(
        `the research settings namespace (profile entry "${entryId}", the plugin's ` +
          'own settings view in the 0.2 model) is not served by the host settings service and no ' +
          'authority fallback is wired — using the frozen defaults ' +
          `"${DEFAULT_PROJECT_TREE_DIR}" / "${DEFAULT_HUB_DIR}"`,
      )
    }
  }
  return {
    treeDir: pickDirField('projectTreeDir', user, legacy, served, fallback, warn),
    hubDir: pickDirField('hubDir', user, legacy, served, fallback, warn),
  }
}

/**
 * Locate this plugin's descriptor: exact entry-id match first; absent
 * that, the ONE descriptor whose served value carries our field pair
 * (a custom profile entry id renames the ns, never the fields).
 */
export function findResearchEntry(
  descriptors: readonly SettingsDescriptorLike[],
  entryId: string,
): SettingsDescriptorLike | undefined {
  const exact = descriptors.find((view) => view.ns === entryId)
  if (exact !== undefined) return exact
  const ours = descriptors.filter(
    (view) =>
      typeof view.value === 'object' &&
      view.value !== null &&
      'projectTreeDir' in (view.value as Record<string, unknown>),
  )
  return ours.length === 1 ? ours[0] : undefined
}

/**
 * Unwrap one cosmokit volatile config cell (`{ get(): … }` — what the
 * loader mounts for `.volatile()` fields, read live like the host's own
 * `config.timeoutMs.get()` convention). Plain values pass through
 * untouched (served layers are already plain).
 */
function unwrapVolatile(value: unknown): unknown {
  if (value !== null && typeof value === 'object' && typeof (value as { get?: unknown }).get === 'function') {
    return (value as { get: () => unknown }).get()
  }
  return value
}

/** Per-field walk over the priority layers (first valid candidate wins;
 *  an invalid candidate warns — naming its source — and the walk
 *  continues; nothing valid → the frozen default). */
function pickDirField(
  field: 'projectTreeDir' | 'hubDir',
  user: DirNameFieldLayer | undefined,
  legacy: DirNameFieldLayer | undefined,
  served: DirNameFieldLayer | undefined,
  fallback: ResearchDirNamesFallback | undefined,
  warn: (message: string) => void,
): string {
  const fallbackDefault = field === 'projectTreeDir' ? DEFAULT_PROJECT_TREE_DIR : DEFAULT_HUB_DIR
  const candidates: ReadonlyArray<readonly [string, unknown]> = [
    ['the user settings layer', user?.[field]],
    ['the legacy 0.1 settings.yaml section', legacy?.[field]],
    ['the served 0.2 settings view', served?.[field]],
    ['the service config', fallback === undefined ? undefined : unwrapVolatile(fallback[field])],
  ]
  for (const [source, value] of candidates) {
    if (value === undefined || value === null) continue
    if (typeof value !== 'string') {
      warn(
        `the research settings field "${field}" must be a string (stored ${typeof value} in ` +
          `${source}) — falling through to the next authority`,
      )
      continue
    }
    const violation = validateDirName(value)
    if (violation === null) return value
    warn(
      `the research settings field "${field}" value ${JSON.stringify(value)} from ` +
        `${source} is invalid (a directory name ${violation}) — ` +
        `falling through to the next authority (final default "${fallbackDefault}")`,
    )
  }
  return fallbackDefault
}

/**
 * Read the plugin's own section inside a 0.1 `settings.yaml` document
 * (the explicit-migration read) with the REAL YAML parser — the repo's
 * existing `yaml` dependency (direct dep, already used in
 * `src/host/service/**`). The previous hand-rolled line parser was
 * retired: it stripped ` #` as a comment and corrupted perfectly legal
 * quoted names (`".research #1"`), and could not express escapes, folded
 * scalars or flow style — the serializer round-trip cases below pin the
 * replacement.
 *
 * SCOPED by design: extract ONLY the `dsh-research-control` section's
 * `projectTreeDir` / `hubDir` entries (structure/type check — every
 * candidate still passes the SAME per-field `validateDirName` when
 * consumed); nothing else is read, and the file itself is NEVER written
 * or renamed (original bytes stay; the file is a lazy backup).
 *
 * @returns `section` = the recognized fields (values unvalidated by the
 *  directory-name rule on purpose — same per-field semantics as every
 *  other layer), `undefined` when the document carries no research
 *  section; `malformed` = the document (or its research section) is not
 *  the shape a 0.1 settings file has — then the migration writes NOTHING
 *  (loud skip; the document remains for manual rescue).
 */
export function parseLegacyResearchSection(text: string): {
  readonly section: DirNameFieldLayer | undefined
  readonly malformed: boolean
} {
  let document: unknown
  try {
    document = parseYamlDocument(text)
  } catch {
    return { section: undefined, malformed: true }
  }
  // An empty document parses to undefined/null — a valid "no sections"
  // file, not a malformed one.
  if (document === undefined || document === null) return { section: undefined, malformed: false }
  if (typeof document !== 'object' || Array.isArray(document)) {
    return { section: undefined, malformed: true }
  }
  const section = (document as Record<string, unknown>)[RESEARCH_SETTINGS_NAMESPACE]
  if (section === undefined) return { section: undefined, malformed: false }
  if (typeof section !== 'object' || section === null || Array.isArray(section)) {
    return { section: undefined, malformed: true }
  }
  const out: Record<string, unknown> = {}
  for (const key of ['projectTreeDir', 'hubDir'] as const) {
    const value = (section as Record<string, unknown>)[key]
    if (value !== undefined) out[key] = value
  }
  return { section: Object.keys(out).length === 0 ? undefined : out, malformed: false }
}

/* ------------------------------------------------------------------ *
 * Thin ctx wiring (the ONLY cordis-touching surface)
 * ------------------------------------------------------------------ */

/** Module-level once-flag: the service-absent warn fires at most once. */
let warnedSettingsAbsent = false

/**
 * Read the host settings service through the documented optional-
 * service face `ctx.get` (DSH_ADAPTER §4; NEVER a hard inject — see
 * the module header).
 *
 * @param ctx - the host context owning the plugin fiber.
 * @returns the structural settings face, or `undefined` when the host
 *  composes no settings service (or its fiber is not active yet).
 */
function readSettingsService(ctx: Context): SettingsServiceLike | undefined {
  return (ctx as unknown as { get: (name: string) => unknown }).get('settings') as
    | SettingsServiceLike
    | undefined
}

/**
 * Register the research settings namespace with the host settings
 * service — the host half of §7.5 (「宿主侧 `settingsNamespace` +
 * schema 注册（ui-theme 先例）」; the ui-theme registration runs under
 * `ctx.inject`, this plugin runs it under the optional-service `ctx.get`
 * face instead — the plugin's activation must never depend on the
 * host's settings composition).
 *
 * Called ONCE from `[Service.init]` (before the plane init), in every
 * mode including spike mode. The registration rides the calling fiber
 * as an effect (the host service resolves the un-registration through
 * the traced caller context) — fiber unmount removes the namespace;
 * there is no separate disposer to hold.
 *
 * Service absent → ONE `console.warn` (module-level once-flag) + the
 * defaults: the settings card is unavailable in that deployment, every
 * discovery falls back to `.research` / `.research-control`, and the
 * plugin loads and serves unchanged (no silent downgrade of the data
 * plane — the gap is named at boot).
 *
 * @param ctx - the host context owning the plugin fiber.
 */
/**
 * The 0.2 settings namespace identity of this plugin: the PROFILE ENTRY id
 * (the `dsh web` dump-config row `id: research-control`). 0.2 retired the
 * register-a-namespace API: a namespace IS a profile plugin entry and its
 * form schema IS the plugin `Config` schema, so `projectTreeDir` / `hubDir`
 * are Config fields and the entry id is what `describe()` keys on. The
 * legacy frozen constant {@link RESEARCH_SETTINGS_NAMESPACE} (the package
 * name, the 0.1 namespace) stays exported for the client half and the
 * frozen face.
 */
export const RESEARCH_SETTINGS_ENTRY_ID = 'research-control'

let loggedSettingsModel = false

/**
 * Boot hook, 0.2 semantics: NOTHING to register (0.1's
 * `settings.register` is retired — the plugin's own profile entry is its
 * settings namespace and the two §7.5 fields ride `static Config`). This
 * function keeps its call site and its observability: service absent →
 * ONE `console.warn` + defaults (unchanged); service present → ONE
 * `console.log` naming where the fields live.
 *
 * @param ctx - the host context owning the plugin fiber.
 */
export function registerResearchSettings(ctx: Context): void {
  const settings = readSettingsService(ctx)
  if (settings === undefined) {
    if (!warnedSettingsAbsent) {
      warnedSettingsAbsent = true
      console.warn(
        '[research-control] the host exposes no settings service — the research settings ' +
          `namespace (profile entry "${RESEARCH_SETTINGS_ENTRY_ID}") is unreadable and the directory ` +
          `names stay at the defaults ("${DEFAULT_PROJECT_TREE_DIR}" / "${DEFAULT_HUB_DIR}"); ` +
          'discovery is unaffected (warned once)',
      )
    }
    return
  }
  if (!loggedSettingsModel) {
    loggedSettingsModel = true
    console.log(
      `[research-control] research settings ride the 0.2 settings model — profile entry ` +
        `"${RESEARCH_SETTINGS_ENTRY_ID}" is its own settings namespace (projectTreeDir / hubDir are ` +
        'plugin Config fields, edited in DSH 设置 → 插件; the discovery layer reads them live ' +
        'through getResearchDirNames)',
    )
  }
}

/**
 * Read the current directory names for discovery (design §4 step 1 —
 * 「读设置 → 解析 <treeDir>/<hubDir>（非法即回退默认并告警）」).
 *
 * THE single source of the names: T2.2's discovery/rescan logic takes
 * `<treeDir>`/`<hubDir>` exclusively from this function (no hardcoded
 * literal). The read is LIVE on every call (no cache): the §7.5
 * save→rescan transaction must pick up a newly saved name within the
 * running process, and every startup/rescan re-validates.
 *
 * @param ctx - the host context (the settings service is re-read on
 *  every call through `ctx.get`).
 * @param fallback - the service-owned loader-resolved Config (the boot
 *  window + service-degraded authority; the served describe() view wins
 *  whenever it answers).
 * @returns the validated names, default-applied per the §4 step 1 rule.
 */
export function getResearchDirNames(
  ctx: Context,
  fallback?: ResearchDirNamesFallback | undefined,
): ResearchDirNames {
  const settings = readSettingsService(ctx)
  // The legacy document is a BOOT OVERLAY, never a permanent layer: it is
  // consulted ONLY while the one-shot migration is pending (no completion
  // marker in the user layer). After completion the read authority is the
  // live Config/describe stack alone — a reset back to a default stays
  // default and cannot resurrect the legacy name (the file is a lazy
  // backup, not a layer).
  const pending = isMigrationPending(ctx)
  const legacy = pending ? readLegacyResearchSection(ctx).section : undefined
  return resolveResearchDirNames(
    settings,
    (message) => console.warn(`[research-control] ${message}`),
    fallback,
    {
      legacy,
      userOverride: readOwnUserOverrideLayer(ctx),
      entryId: resolveOwnSettingsEntryId(ctx),
    },
  )
}

/* ------------------------------------------------------------------ *
 * Legacy 0.1 settings.yaml migration — ONE boot migration (reviewer
 * simplification ruling).
 *
 * Model: the legacy document is consulted ONLY while the migration is
 * PENDING — the profile user layer carries no completion marker
 * ({@link RESEARCH_SETTINGS_MIGRATION_MARKER}). The synchronous read
 * turns the pending section into the BOOT OVERLAY (so the first upgraded
 * boot's discovery already resolves the custom names — no manual
 * rescan/restart), and the persist step completes the migration through
 * the host's OWN public write face, `ConfigEditor.edit`: file lock,
 * profile reconcile, and the `current` re-read all happen INSIDE the
 * edit critical section (boot/config-editor/src/index.ts:87-135), so the
 * merge can never clobber a value a concurrent writer committed first
 * (the pre-fix `settings.update` read-then-write TOCTOU), and the fields
 * plus the completion marker land ATOMICALLY in one write. Once the
 * marker exists the legacy document is permanently out of every
 * authority layer — a later reset to a default stays default, and the
 * file survives untouched as a lazy backup. No hand-rolled YAML, no
 * revision bookkeeping of our own: the host editor owns lock/re-read/
 * atomic-write/reconcile/rollback and we reuse it.
 * ------------------------------------------------------------------ */

/** The internal completion marker: a NON-volatile Config field (never in
 *  the editable form), written by {@link migrateLegacyResearchSettings}
 *  in the SAME `ConfigEditor.edit` call as the migrated fields. Its
 *  presence (a number — the completion timestamp) in the raw user layer
 *  is the ONLY pending/completed authority. Mirrored in the host service
 *  `static Config` (host/index.ts — the schema must declare every key a
 *  config may carry). */
export const RESEARCH_SETTINGS_MIGRATION_MARKER = 'legacyMigrationCompletedAt'

/** Structural slice of the host config-editor service (optional
 *  `ctx.get` face — same discipline as the settings service). The row
 *  shape is the REAL one: `configuration(): Array<{ entry, inherited,
 *  override }>` (boot/config-editor/src/index.ts:49; consumed exactly
 *  this way by the host settings service at settings/src/index.ts:304),
 *  and `edit(entry, change)` takes the SAME live Loader `Entry` object
 *  the row carries (it identity-checks it against the current entries
 *  and re-reads `current` under the file lock — index.ts:87-135). */
interface ConfigEditorRow {
  readonly entry: {
    readonly options?: { readonly id?: string; readonly name?: string }
    readonly fiber?: unknown
    readonly id?: string
  }
  readonly inherited: Record<string, unknown>
  readonly override: Record<string, unknown>
}

interface ConfigEditorLike {
  configuration(): readonly ConfigEditorRow[]
  edit(
    entry: ConfigEditorRow['entry'],
    change: (current: Record<string, unknown>, inherited: Record<string, unknown>) => Record<string, unknown>,
  ): Promise<void>
}

function readConfigEditor(ctx: Context): ConfigEditorLike | undefined {
  let editor: unknown
  try {
    editor = (ctx as unknown as { get: (name: string) => unknown }).get('configEditor')
  } catch {
    return undefined
  }
  if (typeof editor !== 'object' || editor === null) return undefined
  const candidate = editor as ConfigEditorLike
  return typeof candidate.configuration === 'function' && typeof candidate.edit === 'function'
    ? candidate
    : undefined
}

/** Locate this plugin's OWN configuration row. Identity comes FIRST:
 *  the row whose `entry.fiber` is OUR fiber (exact, survives any custom
 *  entry id — `dsh plugin add` installs under one id but operators may
 *  rename it). Id/name matching are fallbacks for contexts where the
 *  fiber is not exposed (unit doubles); the row itself (and its LIVE
 *  `entry`) is returned verbatim because `edit` demands the very Entry
 *  object the loader handed out. */
function findOwnConfigRow(ctx: Context): ConfigEditorRow | undefined {
  const editor = readConfigEditor(ctx)
  if (editor === undefined) return undefined
  const ownFiber = (ctx as unknown as { fiber?: unknown }).fiber
  let rows: readonly ConfigEditorRow[]
  try {
    rows = editor.configuration()
  } catch {
    return undefined
  }
  if (ownFiber !== undefined) {
    const byFiber = rows.find((row) => row?.entry?.fiber === ownFiber)
    if (byFiber !== undefined) return byFiber
  }
  const byId = rows.filter((row) => row?.entry?.options?.id === RESEARCH_SETTINGS_ENTRY_ID)
  if (byId.length === 1) return byId[0]
  // custom entry ids: the ONE row whose user layer already speaks our
  // field pair (ambiguity → no row, never a guess).
  const ours = rows.filter(
    (row) => row?.override !== null && typeof row?.override === 'object' && 'projectTreeDir' in row.override,
  )
  return ours.length === 1 ? ours[0] : undefined
}

/** This plugin's live profile entry id (custom installs differ; the
 *  frozen constant is the fallback when the editor cannot answer). */
export function resolveOwnSettingsEntryId(ctx: Context): string {
  return findOwnConfigRow(ctx)?.entry?.options?.id ?? RESEARCH_SETTINGS_ENTRY_ID
}

/** The raw profile user layer (configEditor `override`) for our entry —
 *  the boot-window authority that distinguishes a user-SET default from
 *  an unset field (the merged Config cannot). */
export function readOwnUserOverrideLayer(ctx: Context): DirNameFieldLayer | undefined {
  const override = findOwnConfigRow(ctx)?.override
  if (typeof override === 'object' && override !== null) return override as DirNameFieldLayer
  return undefined
}

/** True while the one-shot 0.1 → 0.2 migration has NOT completed: the
 *  raw user layer carries no numeric completion marker. While pending,
 *  the read path may use the boot overlay; once completed it must not. */
export function isMigrationPending(ctx: Context): boolean {
  const override = findOwnConfigRow(ctx)?.override
  return typeof override?.[RESEARCH_SETTINGS_MIGRATION_MARKER] !== 'number'
}

/** Per-process cache of the parsed legacy document (per home). */
let legacyCache:
  | { readonly home: string; readonly section: DirNameFieldLayer | undefined; readonly malformed: boolean }
  | undefined
let legacyWarned = false

/**
 * Read + parse the 0.1 `settings.yaml` research section with the real
 * YAML parser (cached per home, warn-once on malformed/read failure).
 * Prefers the live document (before the host's post-loader rename),
 * falls back to the host-renamed `.imported` file (an already-imported
 * home is a REQUIRED migration case: the values survive only there).
 * Never writes, never renames: the file stays a lazy backup.
 */
export function readLegacyResearchSection(
  ctx: Context,
): { readonly section: DirNameFieldLayer | undefined; readonly malformed: boolean } {
  const home = (ctx as unknown as { profileContext?: { home?: string } }).profileContext?.home
  if (typeof home !== 'string' || home.length === 0) return { section: undefined, malformed: false }
  if (legacyCache !== undefined && legacyCache.home === home) {
    return { section: legacyCache.section, malformed: legacyCache.malformed }
  }
  let section: DirNameFieldLayer | undefined
  let malformed = false
  try {
    const path = existsSync(join(home, 'settings.yaml'))
      ? join(home, 'settings.yaml')
      : existsSync(join(home, 'settings.yaml.imported'))
        ? join(home, 'settings.yaml.imported')
        : undefined
    if (path !== undefined) {
      const parsed = parseLegacyResearchSection(readFileSync(path, 'utf8'))
      section = parsed.section
      malformed = parsed.malformed
      if (malformed && !legacyWarned) {
        legacyWarned = true
        console.warn(
          `[research-control] the legacy settings document at ${path} is not a readable YAML ` +
            'mapping (or its dsh-research-control section is not a mapping) — the migration ' +
            'writes NOTHING and the legacy names are NOT overlaid this boot; fix the file (or ' +
            'set the names in DSH 设置 → 插件) and restart (warned once)',
        )
      }
    }
  } catch (error: unknown) {
    malformed = true
    if (!legacyWarned) {
      legacyWarned = true
      console.warn(
        '[research-control] the legacy settings document could not be read — the 0.1 custom ' +
          'directory names stay in the file (nothing is lost, nothing is overwritten): ' +
          `${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  legacyCache = { home, section, malformed }
  return { section, malformed }
}

/** Test seam: drop the per-process legacy cache (module state). */
export function resetLegacyResearchCacheForTests(): void {
  legacyCache = undefined
  legacyWarned = false
}

/**
 * Complete the ONE-shot 0.1 → 0.2 migration — scheduled at activation,
 * persisted through the host's OWN `ConfigEditor.edit` (its callback
 * runs after the file lock + profile reconcile with a FRESH `current`,
 * so the merge is race-free: a value a concurrent writer committed
 * first is present in `current` and never overwritten). Fields AND the
 * completion marker land in the same write (atomic completion: a
 * crash between them cannot leave "half-migrated and re-migratable").
 *
 * Rules (reviewer-fixed):
 *  - runs ONLY while pending (no marker); a completed home never
 *    re-migrates, so a post-migration reset cannot resurrect old names;
 *  - a field the current user layer already sets is NEVER overwritten;
 *  - only legacy fields that are valid directory names are written;
 *  - a malformed legacy document writes nothing (already warned);
 *  - the legacy file itself is preserved untouched (lazy backup);
 *  - failure = loud warn — the boot overlay already served THIS boot,
 *    so a persist failure costs durability, never this-boot correctness,
 *    and the migration retries next boot (still pending).
 */
export function migrateLegacyResearchSettings(
  ctx: Context,
  options?: { readonly settle?: () => Promise<unknown> } | undefined,
): Promise<void> {
  const legacy = readLegacyResearchSection(ctx)
  if (legacy.malformed || legacy.section === undefined) return Promise.resolve()
  if (!isMigrationPending(ctx)) return Promise.resolve()
  const editor = readConfigEditor(ctx)
  if (editor === undefined) {
    console.warn(
      '[research-control] the legacy 0.1 directory names are being honored through the boot ' +
        'overlay, but the host config editor (ConfigEditor) is unavailable to persist them ' +
        'atomically — the migration will retry next boot',
    )
    return Promise.resolve()
  }
  const settle =
    options?.settle?.()
    ?? (ctx as unknown as { root?: { loader?: { await?: () => Promise<unknown> } } }).root?.loader?.await?.()
  const persist = async (): Promise<void> => {
    if (settle !== undefined) await settle
    // Re-check pending AFTER settlement (a concurrent activation in the
    // same process may already have completed the migration).
    if (!isMigrationPending(ctx)) return
    const row = findOwnConfigRow(ctx)
    if (row === undefined) {
      console.warn(
        '[research-control] the legacy settings migration cannot find this profile entry ' +
          'through ConfigEditor.configuration() — retrying next boot (nothing written)',
      )
      return
    }
    const entryId = row.entry?.options?.id ?? RESEARCH_SETTINGS_ENTRY_ID
    const legacySection = legacy.section!
    const wroteFields: string[] = []
    await editor.edit(row.entry, (current: Record<string, unknown>) => {
      // `current` is the LIVE, reconciled user layer inside the editor's
      // critical section — this re-read is what closes the TOCTOU.
      const next: Record<string, unknown> = { ...current }
      for (const field of ['projectTreeDir', 'hubDir'] as const) {
        const value = legacySection[field]
        if (typeof value !== 'string' || validateDirName(value) !== null) continue
        if (current[field] !== undefined) continue // never overwrite the user layer (fresh read)
        next[field] = value
        wroteFields.push(field)
      }
      // completion lands in the SAME write as the fields (atomic).
      next[RESEARCH_SETTINGS_MIGRATION_MARKER] = Date.now()
      return next
    })
    console.log(
      `[research-control] 0.1 settings migration complete: ${JSON.stringify(
        wroteFields,
      )} carried from settings.yaml into the profile user layer of entry "${entryId}" ` +
        `+ completion marker "${RESEARCH_SETTINGS_MIGRATION_MARKER}" — one atomic ` +
        'ConfigEditor.edit (the legacy file stays as a backup and exits the authority layers ' +
        'for good)',
    )
  }
  return persist().catch((error: unknown) => {
    console.warn(
      '[research-control] the legacy settings migration could not persist this run (the boot ' +
        `overlay still honored the legacy names this boot, and the migration retries next ` +
        `boot): ${error instanceof Error ? error.message : String(error)}`,
    )
  })
}
