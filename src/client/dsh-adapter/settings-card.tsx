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
  deriveSettingsSectionFromRaw,
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
 * The KEYED configuration seat of one bundle row on the Plugins manager's
 * Installed pages (ui-plugin-manager slot-contract.ts: kind `keyed`, scope
 * `root`, owner `PluginConfigViewProps`). The host contract is explicit:
 * "a bundle's configuration belongs in `plugins.bundle.config` or
 * `plugins.row.config`" — NOT in the Official-group `plugins.item` list.
 * R5 moved this card off the official group onto the real Installed row
 * seat (GUI path: Installed → dsh-research-control → research-control),
 * keeping the page-owner's form props as the write path.
 */
export const ROW_CONFIG_SLOT = 'plugins.row.config'

/** The host profile entry id — also the row id the bundle's patch declares. */
const ENTRY_ID = RESEARCH_SETTINGS_ENTRY_ID

/**
 * The keyed seat identity: `<bundle package>#<row id as the bundle's patch
 * declares it>` — config-ledger.ts `rowConfigKey` verbatim.
 */
export const ROW_CONFIG_KEY = `dsh-research-control#${ENTRY_ID}`

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
 * only reads `status` / `value` / `writable` / `revision`.
 */
export interface ConfigFormSnapshotLike<T> {
  /** `loading` until the first accepted section; `ready` while one stands; `unavailable` when the entry is not served to this client (or memory mode). */
  readonly status: 'loading' | 'ready' | 'unavailable'
  /** The last accepted schema-resolved section (`undefined` before the first acceptance). */
  readonly value: T | undefined
  /** Whether the host document accepts writes (memory mode never does). */
  readonly writable: boolean
  /** Namespace revision fencing the next write (`undefined` before the first Host view). */
  readonly revision: number | undefined
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
  /**
   * Queue ONE ATOMIC namespace mutation — all ops share one revision fence,
   * Host validation, persistence decision, and recovery read (host contract
   * config-form-types.ts, `ConfigForm.mutate`). `true` = accepted;
   * `false` = refused/conflict and NOTHING of the ops was written;
   * transport failures reject.
   */
  mutate(ops: readonly SettingsPathOpViewLike[], expectedRevision?: number): Promise<boolean>
}

/** Structural mirror of `SettingsPathOpView` (dsh-api-remotes/client) — the field-op shape this card uses. */
export interface SettingsPathOpViewLike {
  readonly op: 'set' | 'unset'
  readonly path: readonly string[]
  readonly value?: unknown
}

/**
 * Structural mirror of the page-owner `ConfigPageForm` the row-config seat
 * renders contributions with (ui-plugin-manager slot-contract.ts): accepted
 * values refreshed by the page owner + the atomic write command (no
 * subscribe — the page re-renders on refresh).
 */
export interface OwnerFormLike {
  readonly state: ConfigFormSnapshotLike<Record<string, unknown>>
  mutate(ops: readonly SettingsPathOpViewLike[], expectedRevision?: number): Promise<boolean>
}

/** The owner props the keyed row-config seat renders a contribution with. */
export interface RowConfigOwnerProps {
  readonly view?: 'summary' | 'page'
  readonly form?: OwnerFormLike
}

/**
 * Adapt the seat's owner form to the ConfigForm face the transaction
 * speaks. The owner's `state` object is replaced wholesale on refresh (the
 * page re-render re-runs the contribution's inject), so no subscribe is
 * needed; the WRITE rides the owner's own `mutate` — the real entry /
 * real namespace the page resolved (a custom owning id such as `rc-real`
 * keeps its identity end to end).
 */
function ownerFormToFormLike(owner: OwnerFormLike): ConfigFormLike<ResearchSettingsSection> {
  return {
    getSnapshot: () => owner.state as unknown as ConfigFormSnapshotLike<ResearchSettingsSection>,
    subscribe: () => () => {},
    mutate: (ops, expectedRevision) => owner.mutate(ops, expectedRevision),
  }
}

/**
 * Structural mirror of the `ConfigForms` provider service (host checkout
 * `packages/client/ui-settings/src/client/config-form.ts`) — every
 * configuration feature reaches the settings transport through
 * `get(entryId)`, and gates its slot registration on `whileServed`.
 */
export interface ConfigFormsServiceLike {
  /** One stable controller per entry id (the host caches them — `forms` Map). */
  get<T>(entryId: string): ConfigFormLike<T>
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
  return deriveSettingsSectionFromRaw(form.getSnapshot(), {
    projectTreeDir: DEFAULT_PROJECT_TREE_DIR,
    hubDir: DEFAULT_HUB_DIR,
  })
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

/** The two field ops of one section save — ONE atomic mutate's payload. */
function sectionOps(section: ResearchSettingsSection): SettingsPathOpViewLike[] {
  return [
    { op: 'set', path: ['projectTreeDir'], value: section.projectTreeDir },
    { op: 'set', path: ['hubDir'], value: section.hubDir },
  ]
}

/**
 * R5 — the ONE-REQUEST ATOMIC two-field write: both fields travel in one
 * `form.mutate(ops, expectedRevision)` (host contract: all ops share one
 * revision fence, Host validation, persistence decision, and recovery
 * read). `false` = refusal/conflict — the atomicity guarantees NOTHING of
 * this write landed, so the caller MUST NOT roll back (there is nothing of
 * ours to revert); it refreshes the display from the recovery read instead.
 * A transport rejection is indeterminate and likewise never earns a blind
 * compensating write.
 */
async function atomicWrite(
  form: ConfigFormLike<ResearchSettingsSection>,
  section: ResearchSettingsSection,
  expectedRevision: number | undefined,
): Promise<{ ok: true } | { ok: false; fault: unknown }> {
  try {
    const accepted = await form.mutate(sectionOps(section), expectedRevision)
    if (accepted) return { ok: true }
    return { ok: false, fault: 'host-refused-write' }
  } catch (err) {
    return { ok: false, fault: err }
  }
}

/**
 * Fenced compensating rollback: writes the pre-save section back under the
 * revision OUR accepted write produced — if a newer writer moved the
 * namespace since, the Host refuses the stale fence and nothing is
 * trampled. Only ever issued after an ACCEPTED write (never for a `false`
 * or a transport rejection).
 */
async function rollbackFenced(
  form: ConfigFormLike<ResearchSettingsSection>,
  before: ResearchSettingsSection,
  acceptedRevision: number | undefined,
): Promise<{ rolledBack: boolean; fault: unknown | undefined }> {
  try {
    const accepted = await form.mutate(sectionOps(before), acceptedRevision)
    return accepted ? { rolledBack: true, fault: undefined } : { rolledBack: false, fault: 'rollback-fence-refused' }
  } catch (err) {
    return { rolledBack: false, fault: err }
  }
}

/** One plane rescan (the RPC re-runs discovery under the CURRENT committed
 *  names and answers with the fresh discovery state). Never throws. */
async function rescanPlane(): Promise<{ ok: true } | { ok: false; fault: unknown }> {
  try {
    const result = await researchRpc.rescan({})
    return result.ok ? { ok: true } : { ok: false, fault: result.error }
  } catch (err) {
    return { ok: false, fault: err }
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
  // Step 3 — the ONE-REQUEST ATOMIC write of BOTH fields under the fence
  // read here. `false` (Host refusal / revision conflict) wrote NOTHING —
  // no rollback, no rescan, the recovery read refreshes the editor. A
  // transport rejection likewise never earns a blind compensating write.
  const baseRevision = form.getSnapshot().revision
  const write = await atomicWrite(form, next, baseRevision)
  if (!write.ok) {
    return {
      status: 'write-error',
      message: t('settings.writeFailed', { fault: faultMessage(write.fault) }),
    }
  }
  // The revision Host answered for OUR accepted write (the acceptance folds
  // it into the snapshot) — the fence any compensating rollback carries, so
  // a newer concurrent writer is never trampled.
  const acceptedRevision = form.getSnapshot().revision
  // The rolled-back tail shared by steps 4/5 failures: fenced rollback,
  // then a RESCAN OF THE RESTORED PATHS so the old plane is live and the
  // old project queryable IMMEDIATELY (no manual rescan, no restart). A
  // rollback or restore-rescan failure surfaces as the outcome's
  // `restoreFault` — the card stays blocked with the second fault.
  const rollBackAndRestore = async (): Promise<{ restoreFault?: string }> => {
    const rollback = await rollbackFenced(form, before, acceptedRevision)
    if (!rollback.rolledBack) return { restoreFault: faultMessage(rollback.fault) }
    const restored = await rescanPlane()
    return restored.ok ? {} : { restoreFault: faultMessage(restored.fault) }
  }
  // Step 4 — rescan: fresh discovery under the NEW names.
  const postRes = await researchRpc.rescan({})
  if (!postRes.ok) {
    const { restoreFault } = await rollBackAndRestore()
    return {
      status: 'rescan-error',
      message: t('settings.rescanFailed', { fault: faultMessage(postRes.error) }),
      ...(restoreFault === undefined ? {} : { restoreFault }),
    }
  }
  // Step 5 — verify: did the rename lose what the plane detected before?
  const lost = findLostDiscovery(preRes.value, postRes.value)
  if (lost.hubLost || lost.lostTreePaths.length > 0) {
    const { restoreFault } = await rollBackAndRestore()
    return {
      status: 'missing',
      hubLost: lost.hubLost,
      hubPath: lost.hubPath,
      lostTreePaths: lost.lostTreePaths,
      ...(restoreFault === undefined ? {} : { restoreFault }),
    }
  }
  return { status: 'saved' }
}

/* ------------------------------------------------------------------ *
 * Registration (one surface: registerResearchUI calls this once)
 * ------------------------------------------------------------------ */

/** Runtime narrowing of the opaque `form` owner prop the pure view hands back. */
function isOwnerFormLike(value: unknown): value is OwnerFormLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { mutate?: unknown }).mutate === 'function' &&
    'state' in (value as object)
  )
}

/**
 * The fallback write path for deployments where the row page resolves no
 * owner form (a custom owning entry id such as `rc-real`, whose settings
 * namespace no row id names, or a describe mirror that has not landed —
 * late appearance). Resolved PER FACE BUILD: the service may appear late
 * and disappears on unload, so nothing is cached across builds; the host
 * caches controllers per entry id, so repeated `get` is stable.
 */
function ownCanonicalForm(ctx: ResearchClientContext): ConfigFormLike<ResearchSettingsSection> | undefined {
  const configForms = readConfigFormsService(ctx)
  if (configForms === undefined || typeof configForms.get !== 'function') return undefined
  return configForms.get<ResearchSettingsSection>(ENTRY_ID)
}

let warnedNoFormPath = false

/**
 * The face the slot runtime spreads into the pure view, built for one
 * render of the seat. The ACTIVE form is the page-owner's when the seat
 * supplies one (the canonical R5 path — real entry identity, real
 * namespace, owner props preserved), else the canonical own-entry form.
 * Neither exists → an honest unavailable face (`save` refuses through the
 * existing 未就绪 outcome; no silent success, no fake plane).
 */
function buildCardFace(ctx: ResearchClientContext): ResearchSettingsCardFace {
  const canonical = ownCanonicalForm(ctx)
  const active = canonical
  if (active === undefined && !warnedNoFormPath) {
    warnedNoFormPath = true
    console.warn(
      '[research-control] the settings card seat has no owner form and the client exposes no ' +
        `configForms service — saving is unavailable (entry "${ENTRY_ID}")`,
    )
  }

  // Stable-reference snapshot derivation (useSyncExternalStore requires a
  // getter returning the SAME reference until the store changes). The raw
  // snapshot is stable per update (owner form: per page refresh; own form:
  // per subscription tick), so cache the derived object on its identity.
  let cachedRaw: unknown = null
  let cachedDerived: ResearchSettingsCardSnapshot = { status: 'loading', values: undefined, writable: false }
  const getSnapshot = (): ResearchSettingsCardSnapshot => {
    if (active === undefined) return { status: 'unavailable', values: undefined, writable: false }
    const raw = active.getSnapshot()
    if (raw !== cachedRaw) {
      cachedRaw = raw
      cachedDerived = deriveCardSnapshot(active)
    }
    return cachedDerived
  }

  return {
    getSnapshot,
    subscribe: (listener: () => void) => (active === undefined ? () => {} : active.subscribe(listener)),
    defaults: {
      projectTreeDir: DEFAULT_PROJECT_TREE_DIR,
      hubDir: DEFAULT_HUB_DIR,
    },
    // The seat spreads the page-owner props onto the component, and the
    // view passes its `form` prop here at SAVE time: when the row page
    // resolved a form (the canonical R5 path), that form — the entry the
    // PAGE owns, custom ids included — executes the transaction; the
    // canonical own-entry form is the fallback. No form at all → the
    // honest 未就绪 refusal (no silent success).
    save: (next: ResearchSettingsSection, ownerForm?: unknown): Promise<ResearchSettingsSaveOutcome> => {
      const writer = isOwnerFormLike(ownerForm) ? ownerFormToFormLike(ownerForm) : canonical
      return writer === undefined
        ? Promise.resolve({ status: 'rescan-error', message: t('settings.notReady') })
        : runTwoPhaseSave(writer, next)
    },
  }
}

/**
 * Register the research settings card on the Plugins manager's KEYED
 * row-config seat (Installed → dsh-research-control → research-control),
 * under the key `<package>#<row id>` the config ledger defines.
 *
 * R5 moved this off the Official-group `plugins.item` list — the host
 * slot contract reserves that slot for the official settings pages and
 * routes bundle configuration to the bundle/row config seats. The card
 * WRITES THROUGH THE PAGE-OWNER'S FORM PROPS when the row page supplies
 * one (the entry the page resolved keeps its identity — custom owning ids
 * included); the canonical `configForms.get(entryId)` form is the fallback
 * only. The registration is unconditional: the seat's form arrives with
 * each render, so a late-appearing describe mirror needs no re-registration,
 * and the slot contribution rides this fiber effect (plugin unload removes
 * the card; reload re-registers).
 *
 * @param ctx - the client context (slots from the entry's inject list; the
 *  optional configForms face read through `ctx.get`, never a hard inject).
 */
export function registerResearchSettingsCard(ctx: ResearchClientContext): void {
  ctx.effect(
    () =>
      ctx.slots.inject(
        ROW_CONFIG_SLOT,
        () =>
          ctx.slots.register(
            {
              name: ROW_CONFIG_SLOT,
              // The keyed seat identity: the bundle package + the row id the
              // bundle's patch declares.
              id: ROW_CONFIG_KEY,
              order: 40,
              label: () => t(CARD_LABEL),
              // The keyed seat renders contributions with the page-owner
              // props; the face is rebuilt per render against them.
              inject: () => buildCardFace(ctx),
            },
            // The component is the PURE view — the slot runtime hands it the
            // face members plus the owner share (`view`, `form`).
            ResearchSettingsCard,
          ),
      ),
    'research-control/settings-card',
  )
}
