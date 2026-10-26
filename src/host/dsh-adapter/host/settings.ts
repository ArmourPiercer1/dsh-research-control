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

import type { Context } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
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
 * PURE resolution core (no ctx, no console — the warn sink is
 * injected): read the registered section, validate each field, fall
 * back per-field to the default with a warn for every violation
 * (frozen §4 step 1: 非法即回退默认并告警).
 *
 * Behavior matrix (0.2 authorities: served describe() view → service
 * Config fallback → frozen defaults):
 *  - `settings === undefined` → fallback when wired (silently), else
 *    both defaults with NO warn (the service-absent warn is fired
 *    exactly once by {@link registerResearchSettings});
 *  - service present but the entry view not served (THIS fiber's own
 *    boot window, or a degraded read) → fallback when wired (silently),
 *    else both defaults + one warn;
 *  - a served/fallback field `undefined` → the default silently
 *    (schema-default inheritance, the documented no-override path);
 *  - a field of the wrong type (a hand-edited document) → the default
 *    + a warn (the section crosses the durable-file boundary — the
 *    type check lives in the schema at registration, this is the
 *    read-side guard; the fallback path runs the SAME guard);
 *  - a string field failing {@link validateDirName} → the default + a
 *    warn naming the field, the value, and the violation.
 *
 * @param settings - the host settings service, or `undefined` when the
 *  host composes none (the read still returns usable names).
 * @param warn - sink for fallback diagnostics (the wiring passes
 *  `console.warn`; tests pass a collector).
 * @returns the validated directory names, default-applied.
 */
export function resolveResearchDirNames(
  settings: SettingsServiceLike | undefined,
  warn: (message: string) => void,
  fallback?: ResearchDirNamesFallback | undefined,
): ResearchDirNames {
  if (settings === undefined) {
    // No service at all: the service-owned config (user layer included)
    // is the remaining authority; absent both, the frozen defaults.
    return fallback === undefined
      ? { treeDir: DEFAULT_PROJECT_TREE_DIR, hubDir: DEFAULT_HUB_DIR }
      : namesFromSection(fallback, warn)
  }
  // Runtime shape guard (the real host taught this lesson): a settings
  // service WITHOUT the 0.2 describe() face cannot answer — fall back
  // loudly instead of throwing inside discovery.
  if (typeof settings.describe !== 'function') {
    warn(
      'the host settings service does not expose the 0.2 describe() face — the research ' +
        'settings namespace cannot be read, using the service config fallback ' +
        '(or the frozen defaults when no fallback is wired)',
    )
    return fallback === undefined
      ? { treeDir: DEFAULT_PROJECT_TREE_DIR, hubDir: DEFAULT_HUB_DIR }
      : namesFromSection(fallback, warn)
  }
  const entry = settings.describe().find(view => view.ns === RESEARCH_SETTINGS_ENTRY_ID)
  const section = entry?.value
  if (section === undefined || section === null) {
    // The boot window (and service-degraded reads): describe() only serves
    // ACTIVE entries, so while this plugin's own fiber is still mounting
    // its view is absent — the service-owned Config (loader-resolved, the
    // user layer included — e2e-verified on dsh@0.2.0-rc.2) carries the
    // configured names through exactly that window. No warn while a
    // fallback exists: the window is the documented behavior, not an
    // anomaly; the warn fires only when BOTH authorities are missing.
    if (fallback !== undefined) {
      return namesFromSection(fallback, warn)
    }
    warn(
      `the research settings namespace (profile entry "${RESEARCH_SETTINGS_ENTRY_ID}", the plugin's ` +
        'own settings view in the 0.2 model) is not served by the host settings service and no ' +
        'service config fallback is wired — using the frozen defaults ' +
        `"${DEFAULT_PROJECT_TREE_DIR}" / "${DEFAULT_HUB_DIR}"`,
    )
    return { treeDir: DEFAULT_PROJECT_TREE_DIR, hubDir: DEFAULT_HUB_DIR }
  }
  return namesFromSection(section as { projectTreeDir?: unknown; hubDir?: unknown }, warn)
}

/** Resolve both fields of one section (served view or Config fallback) with the SAME per-field rule. */
function namesFromSection(
  section: { projectTreeDir?: unknown; hubDir?: unknown },
  warn: (message: string) => void,
): ResearchDirNames {
  return {
    treeDir: resolveDirField('projectTreeDir', unwrapVolatile(section.projectTreeDir), DEFAULT_PROJECT_TREE_DIR, warn),
    hubDir: resolveDirField('hubDir', unwrapVolatile(section.hubDir), DEFAULT_HUB_DIR, warn),
  }
}

/**
 * Unwrap one cosmokit volatile config cell (`{ get(): … }` — what the
 * loader mounts for `.volatile()` fields, read live like the host's own
 * `config.timeoutMs.get()` convention). Plain values pass through
 * untouched (the served describe() view is already plain).
 */
function unwrapVolatile(value: unknown): unknown {
  if (value !== null && typeof value === 'object' && typeof (value as { get?: unknown }).get === 'function') {
    return (value as { get: () => unknown }).get()
  }
  return value
}

/** Resolve one directory-name field (the matrix above, per field). */
function resolveDirField(
  field: 'projectTreeDir' | 'hubDir',
  value: unknown,
  fallback: string,
  warn: (message: string) => void,
): string {
  if (value === undefined) return fallback
  if (typeof value !== 'string') {
    warn(
      `the research settings field "${field}" must be a string (stored ${typeof value}) — ` +
        `using the default "${fallback}"`,
    )
    return fallback
  }
  const violation = validateDirName(value)
  if (violation === null) return value
  warn(
    `the research settings field "${field}" value ${JSON.stringify(value)} is invalid ` +
      `(a directory name ${violation}) — using the default "${fallback}"`,
  )
  return fallback
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
  return resolveResearchDirNames(
    settings,
    (message) => console.warn(`[research-control] ${message}`),
    fallback,
  )
}
