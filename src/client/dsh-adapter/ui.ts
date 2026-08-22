/**
 * Client slot wiring for the Research UI (WP-0.5 spike).
 *
 * INV-PERM-5 exempt set: this file is where the client half touches
 * DSH-shaped APIs. The slot service type below is a **local structural
 * mirror** — this repo deliberately does NOT install
 * `@deepseek-ai/dsh-client-ui-slots` (npm copy is stale/unpublished;
 * WP-0.5 type strategy). The mirror shape is provisional: the host
 * `dsh-client-ui-slots` runtime (packages/client, AGENTS.md slot system
 * standard) is authoritative, and Phase 4 finalizes the mirror against
 * the real `SlotMap`/`register` contract.
 *
 * The registered component is a pure props view (src/client/views/): it
 * never sees `ctx`; the `inject` face below is the only channel from the
 * apply world into the view (client/AGENTS.md rule 7: inject returns
 * plain data and callbacks).
 */

import type { Context } from '@deepseek-ai/cordis'
import { ResearchSpikeView } from '../views/ResearchSpikeView'

/**
 * Conversation view slot key — the primary Research UI landing point
 * (DSH_ADAPTER §6 slot table; ui-trajectory precedent at
 * packages/client/ui-trajectory/src/client/index.ts:43).
 */
export const CONVERSATION_VIEW_SLOT = 'conversation.view'

/**
 * Minimal mirror of the host slot register options. The host option set is
 * `{name, children?, store?, inject?, id?, order?, label?, locale?}`; only
 * the fields this spike passes are mirrored. Phase 4 extends the mirror
 * (`children`/`store`/`locale`) when the cockpit registers more seats.
 */
export interface SlotRegisterOptions {
  /** Slot key the contribution registers into (must be declared upstream). */
  readonly name: string
  /** Contribution id within the slot (the tab id). */
  readonly id: string
  /** Ordering weight among the slot's list contributions. */
  readonly order?: number
  /** Registration-time label thunk (re-read per render to follow locale). */
  readonly label?: () => string
  /** Inject face: per-session plain data handed to the component as props. */
  readonly inject?: (sessionId: string) => unknown
}

/**
 * Structural mirror of the host slots service (`dsh-client-ui-slots`).
 * Provisional shape — authoritative at the host runtime, finalized Phase 4.
 * `register` returns the disposer (registrations are effects). `inject`
 * waits on the slot declaration (late declaration tolerated), reruns after
 * redeclaration, and removes the contribution when that declaration
 * collapses (host behavior, packages/client/AGENTS.md checklist item 4).
 */
export interface SlotService {
  /** Register a component into a declared slot; returns the disposer. */
  register<P>(options: SlotRegisterOptions, component: (props: P) => unknown): () => void
  /**
   * Contribute to a slot lazily: the callback runs at declaration time
   * (and after redeclaration), leaving the caller's plugin fiber.
   */
  inject(slot: string, contribute: () => unknown): void
}

/** Client context carrying the slots service (mirror of the host Context merge). */
export type ResearchClientContext = Context & { slots: SlotService }

/** Inject face of the spike tab: the placeholder ping status (no data call). */
export interface ResearchSpikeViewInjected {
  readonly pingStatus: string
}

/** Placeholder ping status text until Phase 4 wires the live `researchRpc` ping result. */
const PING_STATUS_PLACEHOLDER = '占位：未接线（Phase 4 接入 ping）'

/**
 * Register the Research tab on the `conversation.view` slot.
 *
 * The registration rides the slot service's `inject` wrapper, so a late
 * slot declaration is tolerated and plugin unload removes the tab
 * (ui-trajectory precedent, same call shape).
 * @param ctx - client context with the injected slots service.
 */
export function registerResearchUI(ctx: ResearchClientContext): void {
  ctx.slots.inject(CONVERSATION_VIEW_SLOT, () =>
    ctx.slots.register({
      name: CONVERSATION_VIEW_SLOT,
      id: 'research',
      order: 20,
      label: () => '研究',
      inject: (): ResearchSpikeViewInjected => ({ pingStatus: PING_STATUS_PLACEHOLDER }),
    }, ResearchSpikeView),
  )
}
