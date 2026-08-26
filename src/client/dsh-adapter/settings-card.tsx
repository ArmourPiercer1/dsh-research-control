/**
 * V2-T6.1 — the DSH 设置 plugin card (design §7.5, Q4), adapter half.
 *
 * This file is client-dsh-adapter territory (INV-PERM-5 exempt set — the
 * same zone as `./ui.ts` and `./remote/mount.ts`): it touches the two
 * DSH faces the card needs and keeps the VIEW (`../views/settings/
 * research-settings-card.tsx`) DSH-free —
 *
 *  1. the client SETTINGS SCOPE (`ctx.settingsScope`, the
 *     `dsh-client-ui-settings` base service — `bind(namespace)` gives a
 *     reactive owner handle over one namespace's durable section:
 *     `getSnapshot` / `subscribe` / `set`), and
 *  2. the mounted `researchRpc` facade (`getResearchPlaneState` for the
 *     pre-save discovery snapshot, `rescan` for the post-save re-
 *     discovery — the §7.5 two-phase save transaction).
 *
 * ## The keyed slot entry (standard third-party plugin card)
 *
 * The card registers into the KEYED slot `settings.plugin.item` under
 * the settings-namespace key `dsh-research-control` — the host's
 * configurable-plugins tab (ui-settings-plugins) dispatches that slot
 * once per served namespace, so the host and this browser half pair on
 * the namespace alone (slot-contract.ts of that package: 「keying on
 * the namespace is what lets a plugin distributed outside this
 * repository contribute a card」). The registration rides the slot
 * service's `inject` wrapper (late declaration tolerated — the tab
 * declares the slot when the settings section first renders).
 *
 * ## The inject face (client/AGENTS.md rule 7 — plain data + callbacks)
 *
 * The card's props are the face members below: a stable-reference
 * snapshot getter + subscription (the view syncs via
 * `useSyncExternalStore`), the composition defaults (the reset-to-
 * default affordance), and the `save` callback that runs the WHOLE
 * two-phase transaction. The view never sees a scope, a `RemoteResult`,
 * or a channel shape.
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
 *  2. WRITE: both fields through the settingsScope face — the SAME face
 *     the card displays them (the scope serializes writes with revision
 *     fencing and folds the host's answer back into the snapshot).
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
 * all-or-nothing. A failed pre-check writes NOTHING; a failed write
 * rolls back what landed; a failed rescan rolls back BOTH writes (the
 * rename is unverified — the baseline 「改名重启生效」 must not be left
 * half-applied by a save that could not prove it safe). Either way the
 * outcome reports the fault and the card keeps showing the old values.
 *
 * Resilience: the settingsScope service is OPTIONAL — a deployment
 * without the settings base plugin gets ONE `console.warn` and no card
 * (the host half of §7.5 has the same absent-service discipline; the
 * namespace simply is not served, so the host's configurable tab would
 * not dispatch this key anyway — the card stays registered-harmless).
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  DEFAULT_HUB_DIR,
  DEFAULT_PROJECT_TREE_DIR,
  RESEARCH_SETTINGS_NAMESPACE,
  findLostDiscovery,
  type ResearchSettingsSaveOutcome,
  type ResearchSettingsSection,
} from '../../shared/research-settings.js'
import { researchRpc } from './remote/mount.js'
import {
  ResearchSettingsCard,
  type ResearchSettingsCardFace,
  type ResearchSettingsCardSnapshot,
} from '../views/settings/research-settings-card.js'
import type { ResearchClientContext } from './ui.js'

/**
 * The keyed slot the host's configurable-plugins tab dispatches (ui-
 * settings-plugins slot-contract.ts: kind `keyed`, scope `root`, keyed
 * by the settings namespace the card edits).
 */
export const SETTINGS_PLUGIN_ITEM_SLOT = 'settings.plugin.item'

/* ------------------------------------------------------------------ *
 * Structural mirrors of the client settings-scope contract
 * ------------------------------------------------------------------ */

/**
 * Structural mirror of `SettingsScopeSnapshot` (host checkout
 * `packages/client/runtime/src/client/contract/settings-scope.ts`) —
 * the fields this plugin's card consumes. The plugin does not devDep on
 * the host's client packages (the client bundle purity gate: cross-
 * plugin collaboration goes through services, never value imports), so
 * the shape is mirrored structurally — the same discipline as the
 * `SlotService` mirror in `./ui.ts` and the host half's
 * `SettingsServiceLike`.
 */
export interface SettingsScopeSnapshotLike<T> {
  /** `loading` until the first accepted section; `ready` while one stands; `unavailable` when the namespace is not served to this client. */
  readonly status: 'loading' | 'ready' | 'unavailable'
  /** The last accepted schema-resolved section (`undefined` before the first acceptance). */
  readonly value: T | undefined
  /** Whether the host document accepts writes (memory mode never does). */
  readonly writable: boolean
}

/**
 * Structural mirror of `SettingsScope<T>` (same host contract file) —
 * the reactive owner handle over one namespace's durable section.
 */
export interface SettingsScopeLike<T> {
  /** The current sync snapshot (stable reference until the next change). */
  getSnapshot(): SettingsScopeSnapshotLike<T>
  /** Observe snapshot changes; returns the disposer. */
  subscribe(listener: () => void): () => void
  /** Queue one field write (revision-fenced, ordered); resolves after the host accepts and the recovery read folds back. */
  set(field: string, value: unknown): Promise<void>
}

/**
 * Structural mirror of `SettingsScopeBinder` (host checkout `packages/
 * client/ui-settings/src/client/settings-scope.ts`) — the base service
 * every preference feature reaches the settings transport through.
 * `bind` registers the scope's disposer on the CALLER's plugin
 * lifecycle (the service proxy binds the call to this plugin's fiber),
 * so plugin unload removes the scope with the rest of the wiring.
 */
export interface SettingsScopeBinderLike {
  bind<T>(spec: { readonly namespace: string }): SettingsScopeLike<T>
}

/**
 * Read the optional settingsScope service from the client context
 * (the host-side twin of `readSettingsService` in `src/host/dsh-adapter/
 * host/settings.ts` — the optional-service `ctx.get` face, never a hard
 * `inject` entry: pinning this plugin's activation on the host's
 * settings composition would make a deployment without settings unload
 * the whole research plane).
 */
function readSettingsScopeBinder(ctx: Context): SettingsScopeBinderLike | undefined {
  return (ctx as unknown as { get?: (name: string) => unknown }).get?.('settingsScope') as
    | SettingsScopeBinderLike
    | undefined
}

/* ------------------------------------------------------------------ *
 * Snapshot derivation (stable-reference for useSyncExternalStore)
 * ------------------------------------------------------------------ */

/**
 * The card's display snapshot — the scope snapshot narrowed to what the
 * card renders. `values` is `undefined` until the section is accepted;
 * per-field non-string guards fall back to the defaults (belt-and-
 * braces over the schema, which already resolves strings + defaults —
 * the same per-field resilience the host read path documents).
 */
export function deriveCardSnapshot(scope: SettingsScopeLike<ResearchSettingsSection>): ResearchSettingsCardSnapshot {
  const raw = scope.getSnapshot()
  const record =
    typeof raw.value === 'object' && raw.value !== null ? (raw.value as Record<string, unknown>) : {}
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
function committedSection(scope: SettingsScopeLike<ResearchSettingsSection>): ResearchSettingsSection | undefined {
  const derived = deriveCardSnapshot(scope)
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

/**
 * Roll BOTH fields back to their pre-save values through the same
 * settingsScope face (awaited — the settings document must settle
 * before the outcome resolves, the live rehearsal asserts the on-disk
 * revert). A failed rollback cannot strand the card silently: it warns
 * (the view still ends on the old values locally — its draft resets are
 * independent of the wire) and the restart re-resolves through the
 * host read path (the §4 step 1 fallback + warn is the final backstop).
 */
async function rollbackBoth(scope: SettingsScopeLike<ResearchSettingsSection>, before: ResearchSettingsSection): Promise<void> {
  try {
    await scope.set('projectTreeDir', before.projectTreeDir)
    await scope.set('hubDir', before.hubDir)
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
  scope: SettingsScopeLike<ResearchSettingsSection>,
  next: ResearchSettingsSection,
): Promise<ResearchSettingsSaveOutcome> {
  // Step 1 — the pre-save discovery baseline (the plane state as last
  // scanned under the OLD names; a pure read, no re-discovery).
  const preRes = await researchRpc.getResearchPlaneState({})
  if (!preRes.ok) {
    return {
      status: 'rescan-error',
      message: `保存前预检失败（${faultMessage(preRes.error)}），设置未写入`,
    }
  }
  // Step 2 — the pre-save committed values (the card's current display;
  // the §7.5 「自动回退字段到旧值」 target).
  const before = committedSection(scope)
  if (before === undefined) {
    return { status: 'rescan-error', message: '设置域尚未就绪，保存未执行' }
  }
  // Step 3 — write BOTH fields through the settingsScope face (the same
  // face the card displays them).
  try {
    await scope.set('projectTreeDir', next.projectTreeDir)
    await scope.set('hubDir', next.hubDir)
  } catch (err) {
    await rollbackBoth(scope, before)
    return {
      status: 'write-error',
      message: `写入设置失败（${faultMessage(err)}），已保留原目录名`,
    }
  }
  // Step 4 — rescan: fresh discovery under the NEW names.
  const postRes = await researchRpc.rescan({})
  if (!postRes.ok) {
    await rollbackBoth(scope, before)
    return {
      status: 'rescan-error',
      message: `重扫失败（${faultMessage(postRes.error)}），已回退到原目录名`,
    }
  }
  // Step 5 — verify: did the rename lose what the plane detected before?
  const lost = findLostDiscovery(preRes.value, postRes.value)
  if (lost.hubLost || lost.lostTreePaths.length > 0) {
    await rollbackBoth(scope, before)
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

let warnedScopeAbsent = false

/**
 * Register the research settings card into the keyed slot
 * `settings.plugin.item` under the namespace key
 * {@link RESEARCH_SETTINGS_NAMESPACE} (paired with the host half's
 * namespace registration — design §7.5 「按设置域 namespace 配对」).
 *
 * The registration rides the slot service's `inject` wrapper (the tab
 * declares the slot when the settings section renders — late
 * declaration tolerated, plugin unload removes the card). Service absent
 * → ONE warn + no card (the optional-service discipline, the host twin).
 *
 * @param ctx - the client context (slots from the entry's inject list;
 *  the settingsScope face read through the optional `ctx.get`).
 */
export function registerResearchSettingsCard(ctx: ResearchClientContext): void {
  const binder = readSettingsScopeBinder(ctx)
  if (binder === undefined) {
    if (!warnedScopeAbsent) {
      warnedScopeAbsent = true
      console.warn(
        '[research-control] the client exposes no settingsScope service — the research ' +
          `settings card (namespace "${RESEARCH_SETTINGS_NAMESPACE}") is unavailable in this deployment`,
      )
    }
    return
  }
  const scope = binder.bind<ResearchSettingsSection>({ namespace: RESEARCH_SETTINGS_NAMESPACE })

  // Stable-reference snapshot derivation (useSyncExternalStore requires
  // the getter to return the SAME reference until the store changes —
  // the scope's raw snapshot is stable per update, so cache the derived
  // object keyed on the raw reference; both closures are created ONCE
  // per registration, so their identities are stable across renders).
  let cachedRaw: object | null = null
  let cachedDerived: ResearchSettingsCardSnapshot = {
    status: 'loading',
    values: undefined,
    writable: false,
  }
  const getSnapshot = (): ResearchSettingsCardSnapshot => {
    const raw = scope.getSnapshot()
    if (raw !== cachedRaw) {
      cachedRaw = raw
      cachedDerived = deriveCardSnapshot(scope)
    }
    return cachedDerived
  }

  const face: ResearchSettingsCardFace = {
    getSnapshot,
    subscribe: (listener: () => void) => scope.subscribe(listener),
    defaults: {
      projectTreeDir: DEFAULT_PROJECT_TREE_DIR,
      hubDir: DEFAULT_HUB_DIR,
    },
    save: (next: ResearchSettingsSection): Promise<ResearchSettingsSaveOutcome> =>
      runTwoPhaseSave(scope, next),
  }

  ctx.slots.inject(SETTINGS_PLUGIN_ITEM_SLOT, () =>
    ctx.slots.register(
      {
        name: SETTINGS_PLUGIN_ITEM_SLOT,
        // The keyed entry: the settings namespace the card edits (the
        // host's configurable tab dispatches per served namespace).
        key: RESEARCH_SETTINGS_NAMESPACE,
        inject: () => face,
      },
      // The component is the PURE view — the slot runtime hands it the
      // face members as props (the register `inject` contract; the
      // keyed slot's owner share is empty, so the face IS the props).
      ResearchSettingsCard,
    ),
  )
}
