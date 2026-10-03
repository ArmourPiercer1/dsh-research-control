/**
 * V2-T6.1 — the DSH 设置 plugin card (design §7.5, Q4), adapter half.
 *
 * This file is client-dsh-adapter territory (INV-PERM-5 exempt set — the
 * same zone as `./ui.ts` and `./remote/mount.ts`): it touches the two DSH
 * faces the card needs and keeps the VIEW (`../views/settings/
 * research-settings-card.tsx`) DSH-free —
 *
 *  1. the CLIENT CONFIG FORM (`ctx.configForms`, the
 *     `dsh-client-ui-settings` base service — in 0.2 a plugin's durable
 *     configuration is reached by HOST PROFILE ENTRY ID through
 *     `configForms.get(entryId)`, giving a reactive `ConfigForm` handle:
 *     `getSnapshot` / `subscribe` / `set` — the 0.1 `settingsScope
 *     .bind(namespace)` face is retired), and
 *  2. the mounted `researchRpc` facade (`getResearchPlaneState` for the
 *     pre-save discovery snapshot, `rescan` for the post-save re-
 *     discovery — the §7.5 two-phase save transaction).
 *
 * ## The `plugins.item` entry (standard third-party plugin config card)
 *
 * The card registers into the LIST slot `plugins.item` (owned by
 * `@dsh/ui-plugin-manager`, slot-contract.ts: kind `list`, scope `root`,
 * owner `PluginConfigViewProps`) with `id` = the entry id, an `order`, and
 * a `label` — the Plugins manager renders the contribution as the plugin's
 * own configuration page (`view: 'page'`) plus its list one-liner
 * (`view: 'summary'`, the owner prop the slot hands the component). This
 * is the 0.2 seat every first-party plugin config card uses (subagent /
 * agent-loop / web-search / shell all register here); the retired
 * `settings.plugin.item` keyed slot no longer exists. The registration is
 * gated by `configForms.whileServed([entryId], …)` so the card mounts only
 * once the host actually serves this entry's descriptor (the 0.2 optional-
 * served discipline — a deployment without the entry simply never pairs).
 *
 * ## The inject face (client/AGENTS.md rule 7 — plain data + callbacks)
 *
 * The card's props are the face members below: a stable-reference
 * snapshot getter + subscription (the view syncs via
 * `useSyncExternalStore`), the composition defaults (the reset-to-
 * default affordance), and the `save` callback that runs the WHOLE
 * two-phase transaction. The view never sees a form, a `RemoteResult`, or
 * a channel shape.
 *
 * ## The §7.5 two-phase save (verbatim: 写入设置域 → 触发 rescan → 校验
 * 发现结果 → 失联 → warning + 自动回退字段到旧值)
 *
 *  1. PRE-CHECK read: `getResearchPlaneState` (a PURE projection over
 *     the discovered plane — it does not re-discover) captures the
 *     plane state as last scanned under the OLD names: which hub and
 *     which project trees were DETECTED before the save. The read is
 *     side-effect-free, so the §7.5 「write → rescan」 order is intact;
 *     only the verification baseline is captured before the write.
 *  2. WRITE: both fields through the ConfigForm face — the SAME face the
 *     card displays them. **0.2 `set` returns `Promise<boolean>`** —
 *     `true` = Host acceptance, `false` = REFUSAL / skipped write (revision
 *     fence, validation, memory mode), transport failures reject. A `false`
 *     is a FAILURE, not a success: the card must NOT proceed to rescan or
 *     report 已保存 — it rolls back and reports the refusal.
 *  3. RESCAN: the `rescan` plane RPC re-runs discovery under the NEW
 *     names (the host reads the configured names fresh per scan —
 *     T2.1/T2.2).
 *  4. VERIFY: `findLostDiscovery` (the shared pure core) compares the
 *     pre-save and post-save snapshots. A pre-save hub that no longer
 *     stands, or a pre-save detected tree that the rescan no longer
 *     finds, is LOST → ROLLBACK: both fields are written back to their
 *     pre-save values through the same face (awaited, so the settings
 *     document settles before the outcome resolves) and the outcome
 *     carries the loss report for the card's warning (「请先在磁盘上
 *     重命名文件夹，再保存」).
 *
 * Failure discipline (the gate's rescan-error path — treat as failure,
 * keep the old values visible, no silent success): the transaction is
 * all-or-nothing. A failed pre-check writes NOTHING; a refused/thrown write
 * rolls back what landed; a failed rescan rolls back BOTH writes (the
 * rename is unverified — the baseline 「改名重启生效」 must not be left
 * half-applied by a save that could not prove it safe). Either way the
 * outcome reports the fault and the card keeps showing the old values.
 *
 * Resilience: the configForms service is OPTIONAL (read through `ctx.get`,
 * never a hard `inject`) — a deployment without the settings base plugin
 * gets ONE `console.warn` and no card (the host half of §7.5 has the same
 * absent-service discipline; the entry simply is not served, so
 * `whileServed` would never pair anyway — the card stays harmless).
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  DEFAULT_HUB_DIR,
  DEFAULT_PROJECT_TREE_DIR,
  RESEARCH_SETTINGS_ENTRY_ID,
  findLostDiscovery,
  type ResearchSettingsSaveOutcome,
  type ResearchSettingsSection,
} from '../../shared/research-settings.js'
import { researchRpc } from './remote/mount.js'; import { t } from '../i18n/copy.js' // line-merged to keep pre-existing tsc error line numbers byte-stable (INV-PERM-5 lint permits)
import {
  ResearchSettingsCard,
  type ResearchSettingsCardFace,
  type ResearchSettingsCardSnapshot,
} from '../views/settings/research-settings-card.js'
import type { ResearchClientContext } from './ui.js'

/**
 * The LIST slot the Plugins manager dispatches for a single plugin's
 * configuration card (ui-plugin-manager slot-contract.ts: kind `list`,
 * scope `root`, owner `PluginConfigViewProps` — `view: 'summary' | 'page'`).
 */
export const PLUGINS_ITEM_SLOT = 'plugins.item'

/** The list-slot registration id / entry key (the host profile entry id). */
const ENTRY_ID = RESEARCH_SETTINGS_ENTRY_ID

/** The Plugins-manager tab / list label for this card's page. */
const CARD_LABEL = 'settingsCard.title'

/* ------------------------------------------------------------------ *
 * Structural mirrors of the 0.2 client ConfigForm contract
 * ------------------------------------------------------------------ */

/**
 * Structural mirror of `ConfigFormSnapshot` (host checkout
 * `packages/client/ui-settings/src/client/config-form-types.ts`) — the
 * fields this plugin's card consumes. The plugin does not devDep on the
 * host's client packages (the client bundle purity gate: cross-plugin
 * collaboration goes through services, never value imports), so the shape
 * is mirrored structurally — the same discipline as the `SlotService`
 * mirror in `./ui.ts` and the host half's `SettingsServiceLike`. The full
 * snapshot also carries `base` / `user` / `revision` / `mode`; the card
 * only reads `status` / `value` / `writable`.
 */
export interface ConfigFormSnapshotLike<T> {
  /** `loading` until the first accepted section; `ready` while one stands; `unavailable` when the entry is not served to this client (or memory mode). */
  readonly status: 'loading' | 'ready' | 'unavailable'
  /** The last accepted schema-resolved section (`undefined` before the first acceptance). */
  readonly value: T | undefined
  /** Whether the host document accepts writes (memory mode never does). */
  readonly writable: boolean
}

/**
 * Structural mirror of `ConfigForm<T>` (same host contract file) — the
 * reactive owner handle over one host entry's durable configuration.
 * `set` returns `Promise<boolean>` in 0.2 (true = accepted, false =
 * REFUSED/skipped, transport rejects) — the caller must treat `false` as a
 * failed write, never as success.
 */
export interface ConfigFormLike<T> {
  /** The current sync snapshot (stable reference until the next change). */
  getSnapshot(): ConfigFormSnapshotLike<T>
  /** Observe snapshot changes; returns the disposer. */
  subscribe(listener: () => void): () => void
  /** Queue one field write (revision-fenced, ordered); `true` accepted, `false` refused/skipped, transport rejects. */
  set(field: string, value: unknown): Promise<boolean>
}

/**
 * Structural mirror of the `ConfigForms` provider service (host checkout
 * `packages/client/ui-settings/src/client/config-form.ts`) — every
 * configuration feature reaches the settings transport through
 * `get(entryId)`, and gates its slot registration on `whileServed`.
 */
export interface ConfigFormsServiceLike {
  get<T>(entryId: string): ConfigFormLike<T>
  /** Run `register` once one of `namespaces` appears in the describe mirror; returns the disposer. */
  whileServed(namespaces: readonly string[], register: (served: ReadonlySet<string>) => () => void): () => void
}

/**
 * Read the optional configForms service from the client context (the
 * client-side twin of `readSettingsService` in `src/host/dsh-adapter/
 * host/settings.ts` — the optional-service `ctx.get` face, never a hard
 * `inject` entry: pinning this plugin's activation on the host's settings
 * composition would make a deployment without settings unload the whole
 * research plane).
 */
function readConfigFormsService(ctx: Context): ConfigFormsServiceLike | undefined {
  return (ctx as unknown as { get?: (name: string) => unknown }).get?.('configForms') as
    | ConfigFormsServiceLike
    | undefined
}

/* ------------------------------------------------------------------ *
 * Snapshot derivation (stable-reference for useSyncExternalStore)
 * ------------------------------------------------------------------ */

/**
 * The card's display snapshot — the form snapshot narrowed to what the
 * card renders. `values` is `undefined` until the section is accepted;
 * per-field non-string guards fall back to the defaults (belt-and-
 * braces over the schema, which already resolves strings + defaults —
 * the same per-field resilience the host read path documents).
 */
export function deriveCardSnapshot(form: ConfigFormLike<ResearchSettingsSection>): ResearchSettingsCardSnapshot {
  const raw = form.getSnapshot()
  const record =
    typeof raw.value === 'object' && raw.value !== null ? (raw.value as unknown as Record<string, unknown>) : {}
  return {
    status: raw.status,
    values:
      raw.value === undefined
        ? undefined
        : {
            projectTreeDir:
              typeof record.projectTreeDir === 'string' ? record.projectTreeDir : DEFAULT_PROJECT_TREE_DIR,
            hubDir: typeof record.hubDir === 'string' ? record.hubDir : DEFAULT_HUB_DIR,
          },
    writable: raw.writable,
  }
}

/** The pre-save committed section (the rollback target), or `undefined` before the first acceptance. */
function committedSection(form: ConfigFormLike<ResearchSettingsSection>): ResearchSettingsSection | undefined {
  const derived = deriveCardSnapshot(form)
  if (derived.status !== 'ready' || derived.values === undefined) return undefined
  return derived.values
}

/* ------------------------------------------------------------------ *
 * The §7.5 two-phase save transaction
 * ------------------------------------------------------------------ */

/** Fold one wire/business fault into the outcome's message line. */
function faultMessage(fault: { code: string; message: string } | unknown): string {
  if (typeof fault === 'object' && fault !== null && 'code' in fault && 'message' in fault) {
    const f = fault as { code: string; message: string }
    return `${f.code}: ${f.message}`
  }
  return fault instanceof Error ? fault.message : String(fault)
}

/** Write BOTH fields, in order, through the ConfigForm face. Resolves
 *  `true` only when the Host accepted every write; a `false` refusal or a
 *  thrown transport fault resolves `false` (the caller rolls back). */
async function writeBoth(
  form: ConfigFormLike<ResearchSettingsSection>,
  section: ResearchSettingsSection,
): Promise<{ ok: true } | { ok: false; fault: unknown }> {
  try {
    const treeOk = await form.set('projectTreeDir', section.projectTreeDir)
    const hubOk = await form.set('hubDir', section.hubDir)
    if (treeOk && hubOk) return { ok: true }
    // 0.2: `false` = Host REFUSED / skipped the write (revision fence,
    // validation, memory mode). It is a failure, not a success.
    return { ok: false, fault: treeOk === false || hubOk === false ? 'host-refused-write' : 'write-skipped' }
  } catch (err) {
    return { ok: false, fault: err }
  }
}

/**
 * Roll BOTH fields back to their pre-save values through the same
 * config-form face (awaited — the settings document must settle before the
 * outcome resolves, the live rehearsal asserts the on-disk revert). A
 * failed rollback cannot strand the card silently: it warns (the view still
 * ends on the old values locally — its draft resets are independent of the
 * wire) and the restart re-resolves through the host read path (the §4
 * step 1 fallback + warn is the final backstop).
 */
async function rollbackBoth(form: ConfigFormLike<ResearchSettingsSection>, before: ResearchSettingsSection): Promise<void> {
  try {
    const rollback = await writeBoth(form, before)
    if (!rollback.ok) {
      console.warn(
        `[research-control] the settings card's rollback write was refused by the Host (${faultMessage(rollback.fault)}) — ` +
          'the on-disk values may not match the display until the next rescan or restart',
      )
    }
  } catch (err) {
    console.warn(
      `[research-control] the settings card's rollback write failed (${faultMessage(err)}) — ` +
        'the on-disk values may not match the display until the next rescan or restart',
    )
  }
}

/**
 * Run the §7.5 two-phase save (see the module header for the steps).
 * The outcome is what the card renders — the view owns only its draft
 * and status line.
 */
async function runTwoPhaseSave(
  form: ConfigFormLike<ResearchSettingsSection>,
  next: ResearchSettingsSection,
): Promise<ResearchSettingsSaveOutcome> {
  // Step 1 — the pre-save discovery baseline (the plane state as last
  // scanned under the OLD names; a pure read, no re-discovery).
  const preRes = await researchRpc.getResearchPlaneState({})
  if (!preRes.ok) {
    return {
      status: 'rescan-error',
      message: t('settings.preflightFailed', { fault: faultMessage(preRes.error) }),
    }
  }
  // Step 2 — the pre-save committed values (the card's current display;
  // the §7.5 「自动回退字段到旧值」 target).
  const before = committedSection(form)
  if (before === undefined) {
    return { status: 'rescan-error', message: t('settings.notReady') }
  }
  // Step 3 — write BOTH fields through the config-form face (the same face
  // the card displays them). A `false` (Host refusal) or a thrown transport
  // fault is a FAILURE: roll back and report — never proceed to rescan.
  const write = await writeBoth(form, next)
  if (!write.ok) {
    await rollbackBoth(form, before)
    return {
      status: 'write-error',
      message: t('settings.writeFailed', { fault: faultMessage(write.fault) }),
    }
  }
  // Step 4 — rescan: fresh discovery under the NEW names.
  const postRes = await researchRpc.rescan({})
  if (!postRes.ok) {
    await rollbackBoth(form, before)
    return {
      status: 'rescan-error',
      message: t('settings.rescanFailed', { fault: faultMessage(postRes.error) }),
    }
  }
  // Step 5 — verify: did the rename lose what the plane detected before?
  const lost = findLostDiscovery(preRes.value, postRes.value)
  if (lost.hubLost || lost.lostTreePaths.length > 0) {
    await rollbackBoth(form, before)
    return {
      status: 'missing',
      hubLost: lost.hubLost,
      hubPath: lost.hubPath,
      lostTreePaths: lost.lostTreePaths,
    }
  }
  return { status: 'saved' }
}

/* ------------------------------------------------------------------ *
 * Registration (one surface: registerResearchUI calls this once)
 * ------------------------------------------------------------------ */

let warnedFormsAbsent = false

/**
 * Register the research settings card into the `plugins.item` list slot
 * with `id` {@link RESEARCH_SETTINGS_ENTRY_ID} (paired with the host half's
 * entry — design §7.5 「按设置域 namespace 配对」, realized in 0.2 as
 * entry-id pairing).
 *
 * The registration is gated by `configForms.whileServed([entryId], …)` so
 * the card mounts only while the host serves this entry's descriptor (the
 * 0.2 optional-served discipline; the slot registrations ride the caller's
 * fiber effects — plugin unload removes the card). Service absent → ONE
 * warn + no card (the optional-service discipline, the host twin).
 *
 * @param ctx - the client context (slots from the entry's inject list; the
 *  configForms face read through the optional `ctx.get`).
 */
export function registerResearchSettingsCard(ctx: ResearchClientContext): void {
  const configForms = readConfigFormsService(ctx)
  if (configForms === undefined || typeof configForms.get !== 'function') {
    if (!warnedFormsAbsent) {
      warnedFormsAbsent = true
      console.warn(
        '[research-control] the client exposes no configForms service — the research ' +
          `settings card (entry "${ENTRY_ID}") is unavailable in this deployment`,
      )
    }
    return
  }
  const form = configForms.get<ResearchSettingsSection>(ENTRY_ID)

  // Stable-reference snapshot derivation (useSyncExternalStore requires
  // the getter to return the SAME reference until the store changes —
  // the form's raw snapshot is stable per update, so cache the derived
  // object keyed on the raw reference; both closures are created ONCE
  // per registration, so their identities are stable across renders).
  let cachedRaw: unknown = null
  let cachedDerived: ResearchSettingsCardSnapshot = {
    status: 'loading',
    values: undefined,
    writable: false,
  }
  const getSnapshot = (): ResearchSettingsCardSnapshot => {
    const raw = form.getSnapshot()
    if (raw !== cachedRaw) {
      cachedRaw = raw
      cachedDerived = deriveCardSnapshot(form)
    }
    return cachedDerived
  }

  const face: ResearchSettingsCardFace = {
    getSnapshot,
    subscribe: (listener: () => void) => form.subscribe(listener),
    defaults: {
      projectTreeDir: DEFAULT_PROJECT_TREE_DIR,
      hubDir: DEFAULT_HUB_DIR,
    },
    save: (next: ResearchSettingsSection): Promise<ResearchSettingsSaveOutcome> =>
      runTwoPhaseSave(form, next),
  }

  // Mount while the host serves this entry's descriptor. The slot
  // registrations ride this fiber effect (registered by the caller's
  // apply); `whileServed` returns the disposer that unregisters the slot
  // contribution once the entry stops being served.
  ctx.effect(
    () =>
      configForms.whileServed([ENTRY_ID], () =>
        ctx.slots.inject(PLUGINS_ITEM_SLOT, () =>
          ctx.slots.register(
            {
              name: PLUGINS_ITEM_SLOT,
              // The list-slot identity: the host profile entry id.
              id: ENTRY_ID,
              order: 40,
              label: () => t(CARD_LABEL),
              inject: () => face,
            },
            // The component is the PURE view — the slot runtime hands it the
            // face members plus the owner share (`view: 'summary' | 'page'`).
            ResearchSettingsCard,
          ),
        ),
      ),
    'research-control/settings-card',
  )
}
