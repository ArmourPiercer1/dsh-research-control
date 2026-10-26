/**
 * V2-T6.1 — the DSH 设置 plugin card (design §7.5, Q4), adapter half.
 * R5 (train 0.2.0-rc.2) — migrated to the 0.2 PUBLIC config-form face.
 *
 * This file is client-dsh-adapter territory (INV-PERM-5 exempt set — the
 * same zone as `./ui.ts` and `./remote/mount.ts`): it touches the two DSH
 * faces the card needs and keeps the VIEW (`../views/settings/
 * research-settings-card.tsx`) DSH-free —
 *
 *  1. the CLIENT CONFIG FORM (`ctx.configForms`, the
 *     `dsh-client-ui-settings` base service — in 0.2 a plugin's durable
 *     configuration is reached by HOST PROFILE ENTRY ID through
 *     `configForms.get(entryId)` (host checkout
 *     `packages/client/ui-settings/src/client/config-form.ts:293`), giving
 *     a reactive `ConfigForm` handle: `getSnapshot` / `subscribe` /
 *     `mutate` (config-form-types.ts). The 0.1 `settingsScope
 *     .bind(namespace)` face and the keyed `settings.plugin.item` slot are
 *     RETIRED — the entry id is the pairing key with the host half
 *     ({@link RESEARCH_SETTINGS_ENTRY_ID}, the descriptor `ns` the host
 *     `describe()` serves and the read path resolves). The service is
 *     OPTIONAL (read through `ctx.get`, never a hard `inject`): a
 *     deployment without the settings composition must still load the
 *     research plane., and
 *  2. the mounted `researchRpc` facade (`getResearchPlaneState` for the
 *     pre-save discovery snapshot, `rescan` for the post-save re-
 *     discovery — the §7.5 two-phase save transaction).
 *
 * ## The row-config seat (0.2, the real Installed navigation)
 *
 * The card registers into the KEYED slot `plugins.row.config` (owned by
 * `@deepseek-ai/dsh-client-ui-plugin-manager`, slot-contract.ts: kind
 * `keyed`, scope `root`, owner `PluginConfigViewProps`) under the key
 * `<bundle package>#<row id as the bundle's patch declares it>` — the
 * config ledger's `rowConfigKey` (config-ledger.ts), here
 * `dsh-research-control#research-control`. The host contract is explicit
 * that a bundle's configuration belongs on the bundle/row config seats,
 * NOT in the Official-group `plugins.item` list, and the ledger/page route
 * keyed contributions by `options.key`. GUI path: 插件管理 → Installed →
 * dsh-research-control → research-control.
 *
 * The registration is UNCONDITIONAL (it needs no service and no describe
 * view): the slot contribution rides this fiber's effect (plugin unload
 * removes the card; reload re-registers), the seat's owner `form` arrives
 * with each render, and the optional `configForms` service is re-read on
 * every face build — so a service or describe mirror that lands AFTER
 * this plugin's apply still reaches the card (the late-scope lesson of the
 * settingsScope era needs no re-probe timer in this model: the write path
 * is resolved per render, not once at apply time).
 *
 * ## The inject face (client/AGENTS.md rule 7 — plain data + callbacks)
 *
 * The card's props are the face members below: a stable-reference
 * snapshot getter + subscription (the view syncs via
 * `useSyncExternalStore`), the composition defaults (the reset-to-
 * default affordance), and the `save` callback that runs the WHOLE
 * two-phase transaction. The view never sees a form, a `RemoteResult`, or
 * a channel shape. When the row page supplies its owner `form` (the entry
 * the PAGE resolved — custom owning ids keep their identity end to end)
 * the view passes it back to `save` and the transaction writes through IT;
 * the canonical `configForms.get(entryId)` form is the fallback display /
 * write path, and neither existing resolves an honest 未就绪 refusal
 * (ONE warn, no silent success).
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
 *  2. WRITE: ONE ATOMIC `form.mutate([set projectTreeDir, set hubDir],
 *     expectedRevision)` — the host contract (config-form-types.ts):
 *     「All operations share one revision fence, Host validation,
 *     persistence decision, and recovery read」. The fence is the
 *     revision the snapshot carried when the save began. The 0.2 answer
 *     semantics: `true` = Host acceptance; `false` = refusal/conflict
 *     and NOTHING of the ops landed (atomicity — there is nothing to
 *     compensate); transport failures reject.
 *  3. RESCAN: the `rescan` plane RPC re-runs discovery under the NEW
 *     names (the host reads the configured names fresh per scan —
 *     T2.1/T2.2).
 *  4. VERIFY: `findLostDiscovery` (the shared pure core) compares the
 *     pre-save and post-save snapshots. A pre-save hub that no longer
 *     stands, or a pre-save detected tree that the rescan no longer
 *     finds, is LOST → FENCED ROLLBACK: both fields are written back to
 *     their pre-save values under the revision OUR accepted write
 *     produced (a newer writer then owns the namespace, the Host refuses
 *     the stale fence, and nothing is trampled), followed by a RESCAN OF
 *     THE RESTORED paths so the old plane is live and the old project
 *     queryable IMMEDIATELY. A rollback or restore-rescan failure rides
 *     the outcome's `restoreFault` — the card renders the second fault
 *     (never a silent success).
 *
 * Failure discipline (the gate's rescan-error path — treat as failure,
 * keep the old values visible, no silent success): a failed pre-check
 * writes NOTHING; a refused (`false`) or thrown write writes NOTHING of
 * ours — NO compensating rollback is issued for either (the atomic mutate
 * left nothing half-applied; a rejection is indeterminate and never earns
 * a blind write), NO rescan, and the recovery read refreshes the editor;
 * a failed rescan or a lost-discovery verification runs the fenced
 * rollback + restored rescan. Either way the outcome reports the fault
 * and the card keeps showing the old values.
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  DEFAULT_HUB_DIR,
  DEFAULT_PROJECT_TREE_DIR,
  RESEARCH_SETTINGS_ENTRY_ID,
  RESEARCH_SETTINGS_NAMESPACE,
  deriveSettingsSectionFromRaw,
  findLostDiscovery,
  type ResearchSettingsSaveOutcome,
  type ResearchSettingsSection,
} from '../../shared/research-settings.js'
import { researchRpc } from './remote/mount.js'
import { t } from '../i18n/copy.js'
import {
  ResearchSettingsCard,
  type ResearchSettingsCardFace,
  type ResearchSettingsCardSnapshot,
} from '../views/settings/research-settings-card.js'
import type { ResearchClientContext } from './ui.js'

/**
 * The KEYED configuration seat of one bundle row on the Plugins manager's
 * Installed pages (ui-plugin-manager slot-contract.ts: kind `keyed`,
 * scope `root`, owner `PluginConfigViewProps` — 「a bundle's configuration
 * belongs in `plugins.bundle.config` or `plugins.row.config` instead [of
 * the Official `plugins.item` group]」).
 */
export const ROW_CONFIG_SLOT = 'plugins.row.config'

/** The host profile entry id — also the row id the bundle's patch declares. */
const ENTRY_ID = RESEARCH_SETTINGS_ENTRY_ID

/**
 * The keyed seat identity: `<bundle package>#<row id as the bundle's patch
 * declares it>` — config-ledger.ts `rowConfigKey` verbatim (the ledger and
 * the page route keyed contributions by this `options.key`). The bundle
 * half is the frozen npm package name {@link RESEARCH_SETTINGS_NAMESPACE}.
 */
export const ROW_CONFIG_KEY = `${RESEARCH_SETTINGS_NAMESPACE}#${ENTRY_ID}`

/* ------------------------------------------------------------------ *
 * Structural mirrors of the 0.2 client config-form contract
 * ------------------------------------------------------------------ */

/**
 * Structural mirror of `ConfigFormSnapshot<T>` (host checkout
 * `packages/client/ui-settings/src/client/config-form-types.ts`) — the
 * members this plugin's card consumes. The plugin does not devDep on the
 * host's client packages (the client bundle purity gate: cross-plugin
 * collaboration goes through services, never value imports), so the shape
 * is mirrored structurally — the same discipline as the `SlotService`
 * mirror in `./ui.ts` and the host half's `SettingsServiceLike`. The full
 * snapshot also carries `base` / `user` / `mode`; the card reads none of
 * them.
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
 * Structural mirror of the field-op payload `ConfigForm.mutate` carries
 * (`SettingsPathOpView`, dsh-api-remotes/client ← settings package
 * types.ts): `set` writes the value at the path, `unset` removes it. The
 * card only ever issues two single-segment `set` ops.
 */
export interface SettingsPathOpViewLike {
  readonly op: 'set' | 'unset'
  readonly path: readonly string[]
  readonly value?: unknown
}

/**
 * Structural mirror of `ConfigForm<T>` (same host contract file) — the
 * reactive handle over one Host entry's configuration. `set`/`unset` are
 * absent here: the card's two fields travel in ONE atomic `mutate` (the
 * retired two-sequential-`set` pattern left a half-applied doc when the
 * second write failed).
 */
export interface ConfigFormLike<T> {
  /** The current sync snapshot (stable reference until the next change). */
  getSnapshot(): ConfigFormSnapshotLike<T>
  /** Observe snapshot replacements; returns the disposer. */
  subscribe(listener: () => void): () => void
  /**
   * Queue ONE ATOMIC namespace mutation — all ops share one revision
   * fence, Host validation, persistence decision, and recovery read
   * (host contract config-form-types.ts, `ConfigForm.mutate`). `true` =
   * accepted; `false` = refused/conflict and NOTHING of the ops was
   * written; transport failures reject.
   */
  mutate(ops: readonly SettingsPathOpViewLike[], expectedRevision?: number): Promise<boolean>
}

/**
 * Structural mirror of the page-owner `ConfigPageForm` the row-config seat
 * renders contributions with (ui-plugin-manager slot-contract.ts):
 * accepted values refreshed by the page owner + the atomic write command
 * (no subscribe — the page re-renders on refresh).
 */
export interface OwnerFormLike {
  readonly state: ConfigFormSnapshotLike<Record<string, unknown>>
  mutate(ops: readonly SettingsPathOpViewLike[], expectedRevision?: number): Promise<boolean>
}

/**
 * Structural mirror of the 0.2 `configForms` base service — only `get`
 * (the host caches one controller per entry id, so repeated `get` is
 * stable). `whileServed` is deliberately NOT part of the mirror: the card
 * registers unconditionally (the per-render write-path resolution below
 * makes a served-gate redundant, and a late describe mirror needs no
 * re-registration).
 */
export interface ConfigFormsServiceLike {
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

/**
 * Adapt the seat's owner form to the ConfigForm face the transaction
 * speaks. The owner's `state` object is replaced wholesale on refresh (the
 * page re-render re-runs the contribution's inject), so no subscribe is
 * needed; the WRITE rides the owner's own `mutate` — the real entry / real
 * namespace the page resolved (a custom owning id keeps its identity end
 * to end).
 */
function ownerFormToFormLike(owner: OwnerFormLike): ConfigFormLike<ResearchSettingsSection> {
  return {
    // The section is PLAIN JSON crossing the wire — the per-field guards in
    // the shared derivation own the narrowing; this is the (host-mirrored)
    // generics erasure, same discipline as the SettingsScope mirror before.
    getSnapshot: () => owner.state as unknown as ConfigFormSnapshotLike<ResearchSettingsSection>,
    subscribe: () => () => {},
    mutate: (ops, expectedRevision) => owner.mutate(ops, expectedRevision),
  }
}

/** Runtime narrowing of the opaque `form` owner prop the pure view hands back. */
function isOwnerFormLike(value: unknown): value is OwnerFormLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { mutate?: unknown }).mutate === 'function' &&
    'state' in (value as object)
  )
}

/* ------------------------------------------------------------------ *
 * Snapshot derivation (stable-reference for useSyncExternalStore)
 * ------------------------------------------------------------------ */

/**
 * The card's display snapshot — the form snapshot narrowed to what the
 * card renders (the shared pure core {@link deriveSettingsSectionFromRaw},
 * so the adapter and the seat-rendered view narrow identically).
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
 * The ONE-REQUEST ATOMIC two-field write: both fields travel in one
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
 * trampled. `acceptedRevision === undefined` (frozen-snapshot seats, see
 * runTwoPhaseSave) delegates the fence to the live form's own mirrored
 * post-write revision — still never behind the Host without a conflict.
 * Only ever issued after an ACCEPTED write (never for a `false`
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
  // The fence any compensating rollback carries. On seats whose form snapshot
  // is LIVE (the legacy settings dialog: getSnapshot advances when the Host
  // mirrors our write) the acceptance folds the new revision into the
  // snapshot, so we read it back and pin the rollback to it — a newer
  // concurrent writer is then rejected by the stale fence and never trampled.
  // But the 0.2 plugin-manager row-config seat hands us a RENDER-TIME VALUE
  // COPY (`PluginManagerPage.tsx:1258` snapshots `form.getSnapshot()` into a
  // plain `state` field), so the frozen snapshot cannot see the revision our
  // own write produced; reading it back there yields the stale pre-write
  // revision and every rollback self-conflicts (`settings/conflict`). When
  // the snapshot did not advance we pass `undefined` instead — the host's
  // ConfigForm.mutate contract then fences the compensating write with the
  // live form's own post-write mirrored revision, the exact value a live seat
  // would read. It never tramples a newer writer the live form has mirrored
  // (that revision becomes the fence, so a further Host move still conflicts),
  // and it matches the seat's OWN field-editor fence discipline (`set()` also
  // forwards `undefined`). The precise-fence path is preserved wherever the
  // snapshot advances.
  const postRevision = form.getSnapshot().revision
  const acceptedRevision =
    postRevision !== undefined && postRevision !== baseRevision ? postRevision : undefined
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

/**
 * The fallback write path for deployments where the row page resolves no
 * owner form (a custom owning entry id whose settings namespace no row id
 * names, or a describe mirror that has not landed — late appearance).
 * Resolved PER FACE BUILD: the service may appear late and disappears on
 * unload, so nothing is cached across builds; the host caches controllers
 * per entry id, so repeated `get` is stable.
 */
function ownCanonicalForm(ctx: ResearchClientContext): ConfigFormLike<ResearchSettingsSection> | undefined {
  const configForms = readConfigFormsService(ctx)
  if (configForms === undefined || typeof configForms.get !== 'function') return undefined
  return configForms.get<ResearchSettingsSection>(ENTRY_ID)
}

let warnedNoFormPath = false

/**
 * The face the slot runtime spreads into the pure view, built for one
 * render of the seat. The canonical `configForms.get(entryId)` form is the
 * display/write fallback; when the seat supplies the page-owner `form`
 * prop, the view displays ITS state and hands it back to `save`, which
 * routes the whole transaction through it (real entry identity, custom
 * owning ids included). Neither existing → an honest unavailable face
 * (`save` refuses through the existing 未就绪 outcome; no silent success,
 * no fake plane; ONE warn).
 */
function buildCardFace(ctx: ResearchClientContext): ResearchSettingsCardFace {
  const canonical = ownCanonicalForm(ctx)
  if (canonical === undefined && !warnedNoFormPath) {
    warnedNoFormPath = true
    console.warn(
      '[research-control] the settings card seat has no owner form and the client exposes no ' +
        `configForms service — saving is unavailable (entry "${ENTRY_ID}")`,
    )
  }

  // Stable-reference snapshot derivation (useSyncExternalStore requires a
  // getter returning the SAME reference until the store changes). The raw
  // snapshot is stable per update (own form: per subscription tick), so
  // cache the derived object on its identity.
  let cachedRaw: unknown = null
  let cachedDerived: ResearchSettingsCardSnapshot = { status: 'loading', values: undefined, writable: false }
  const getSnapshot = (): ResearchSettingsCardSnapshot => {
    if (canonical === undefined) return { status: 'unavailable', values: undefined, writable: false }
    const raw = canonical.getSnapshot()
    if (raw !== cachedRaw) {
      cachedRaw = raw
      cachedDerived = deriveCardSnapshot(canonical)
    }
    return cachedDerived
  }

  return {
    getSnapshot,
    subscribe: (listener: () => void) => (canonical === undefined ? () => {} : canonical.subscribe(listener)),
    defaults: {
      projectTreeDir: DEFAULT_PROJECT_TREE_DIR,
      hubDir: DEFAULT_HUB_DIR,
    },
    // The seat spreads the page-owner props onto the component, and the
    // view passes its `form` prop back here at SAVE time: when the row page
    // resolved a form (the canonical path), that form — the entry the PAGE
    // owns, custom owning ids included — executes the transaction; the
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
 * row-config seat (插件管理 → Installed → dsh-research-control →
 * research-control), under the key `<package>#<row id>` the config ledger
 * defines ({@link ROW_CONFIG_KEY} — routed through `options.key`).
 *
 * The registration is unconditional: the seat's owner form arrives with
 * each render, the optional service is re-read per face build, so a
 * late-appearing describe mirror or service needs no re-registration, and
 * the slot contribution rides this fiber's effect (plugin unload removes
 * the card; reload re-registers). The host slot contract routes a
 * BUNDLE's configuration to this seat — the Official-group `plugins.item`
 * list is not our seat (slot-contract.ts).
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
              // The keyed seat identity the ledger/page route on
              // (config-ledger.ts reads `entry.options.key`).
              key: ROW_CONFIG_KEY,
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
