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
 * NOT expressed as a schemastery constraint: the host settings provider
 * REJECTS the whole namespace registration (and therefore fails this
 * plugin's fiber) when a stored section fails its schema, while the
 * frozen design requires the read path to fall back and warn instead.
 * The write side is guarded by the §7.5 two-phase save transaction
 * (write → rescan → validate the discovery → roll the field back) and
 * may pre-check values with {@link validateDirName} before writing.
 *
 * ## Effect discipline (registration is an effect)
 *
 * `settings.register` registers the un-registration as an effect on
 * the CALLING fiber (the host service resolves the effect through the
 * traced caller context), so the namespace disappears with this
 * plugin's fiber unmount — there is no separate disposer to hold, and
 * {@link registerResearchSettings} is safe to call once from
 * `[Service.init]` regardless of spike mode (the settings card is a
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
export interface SettingsServiceLike {
  /** Register one namespace schema (an effect on the calling fiber). */
  register(ns: string, schema: unknown): void
  /** Read one namespace's resolved value (schema defaults applied). */
  get(ns: string): unknown
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
 * Behavior matrix:
 *  - `settings === undefined` → both defaults, NO warn (the
 *    service-absent warn is fired exactly once by
 *    {@link registerResearchSettings} — the read path stays silent so
 *    repeated rescans do not re-log a boot-time fact);
 *  - section `undefined` (service present but the namespace is not
 *    registered — a deployment anomaly) → both defaults + one warn;
 *  - a field `undefined` → the default silently (schema-default
 *    inheritance, the documented no-override path);
 *  - a field of the wrong type (a hand-edited document) → the default
 *    + a warn (the section crosses the durable-file boundary — the
 *    type check lives in the schema at registration, this is the
 *    read-side guard);
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
): ResearchDirNames {
  if (settings === undefined) {
    return { treeDir: DEFAULT_PROJECT_TREE_DIR, hubDir: DEFAULT_HUB_DIR }
  }
  const section = settings.get(RESEARCH_SETTINGS_NAMESPACE)
  if (section === undefined || section === null) {
    warn(
      `the research settings section "${RESEARCH_SETTINGS_NAMESPACE}" is not registered ` +
        '(the host settings service answered without the namespace) — using the defaults ' +
        `"${DEFAULT_PROJECT_TREE_DIR}" / "${DEFAULT_HUB_DIR}"`,
    )
    return { treeDir: DEFAULT_PROJECT_TREE_DIR, hubDir: DEFAULT_HUB_DIR }
  }
  const record = section as { projectTreeDir?: unknown; hubDir?: unknown }
  return {
    treeDir: resolveDirField('projectTreeDir', record.projectTreeDir, DEFAULT_PROJECT_TREE_DIR, warn),
    hubDir: resolveDirField('hubDir', record.hubDir, DEFAULT_HUB_DIR, warn),
  }
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
export function registerResearchSettings(ctx: Context): void {
  const settings = readSettingsService(ctx)
  if (settings === undefined) {
    if (!warnedSettingsAbsent) {
      warnedSettingsAbsent = true
      console.warn(
        '[research-control] the host exposes no settings service — the research settings ' +
          `card (namespace "${RESEARCH_SETTINGS_NAMESPACE}") is unavailable and the directory ` +
          `names stay at the defaults ("${DEFAULT_PROJECT_TREE_DIR}" / "${DEFAULT_HUB_DIR}"); ` +
          'discovery is unaffected (warned once)',
      )
    }
    return
  }
  settings.register(RESEARCH_SETTINGS_NAMESPACE, RESEARCH_SETTINGS_SCHEMA)
  console.log(
    `[research-control] registered the research settings namespace "${RESEARCH_SETTINGS_NAMESPACE}" ` +
      `(projectTreeDir / hubDir — the discovery layer reads them through getResearchDirNames)`,
  )
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
 * @returns the validated names, default-applied per the §4 step 1 rule.
 */
export function getResearchDirNames(ctx: Context): ResearchDirNames {
  const settings = readSettingsService(ctx)
  return resolveResearchDirNames(settings, (message) =>
    console.warn(`[research-control] ${message}`),
  )
}
