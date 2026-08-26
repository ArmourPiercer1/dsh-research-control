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
import type {
  AckMissingReminderArgs,
  AckMissingReminderResult,
  BindProjectArgs,
  BindProjectResult,
  GetPortfolioInterventionsArgs,
  GetPortfolioInterventionsResult,
  GetResearchPlaneStateResult,
  HubOverviewResult,
  PortfolioInterventionItemDto,
  RescanArgs,
  RescanResult,
  SetHubArgs,
  SetHubResult,
  UnbindProjectArgs,
  UnbindProjectResult,
  UpdateInterventionStateArgs,
  UpdateInterventionStateResult,
} from '../../shared/rpc-contracts.js'
import { ResearchShell, type ResearchShellProps } from '../views/shell/index.js'
import { investigateIntervention } from './remote/investigate.js'
import { researchRpc } from './remote/mount.js'

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

/**
 * Register the Research tab on the `conversation.view` slot.
 *
 * V2-T4.1 (design §5/§6): the tab body is the RESEARCH SHELL — on mount
 * it fetches `getResearchPlaneState` (the injected face below carries the
 * framework sessionId; the host resolves cwd → role from the session
 * registry) and routes the tab body to one of the five §5 branches
 * (HUB console frame / 同构收窄控制台 / 引导卡 / NO_CWD
 * narrowing). The tab registration ITSELF is unchanged — always visible,
 * same id/order/label. V2-T5.1: the HUB 总览 renders the 聚合条 + 卡墙
 * (the `loadHubOverview` face below); the MANAGED/STANDALONE 总览 renders
 * the project console (its own per-mount `createResearchStore()`).
 *
 * The injected face is the apply-world → view channel (client/AGENTS.md
 * rule 7 — plain data and callbacks only): it wraps the mounted
 * `researchRpc` facade's plane-state call, (V2-T5.1, design §12 row 2)
 * the HUB 总览 `getHubOverview` fetch (`loadHubOverview`), and (V2-T4.2,
 * design §8) the two onboarding mutations — `setHub` (设为中枢) and
 * `bindProject` (接入) — and (V2-T4.3, design §4 MISSING 处置) the 四选一
 * modal's mutations — `rescan` (恢复), `unbindProject` (移除登记), and
 * `ackMissingReminder` (推后, the runtime dedup flag) — and folds the
 * carrier's `ok: false` branch into a plain rejection, so the DSH-free
 * view (views/ — INV-PERM-5) never sees a `RemoteResult`.
 *
 * The registration rides the slot service's `inject` wrapper, so a late
 * slot declaration is tolerated and plugin unload removes the tab
 * (ui-trajectory precedent, same call shape).
 * @param ctx - client context with the injected slots service.
 */
export function registerResearchUI(ctx: ResearchClientContext): void {
  ctx.slots.inject(CONVERSATION_VIEW_SLOT, () =>
    ctx.slots.register(
      {
        name: CONVERSATION_VIEW_SLOT,
        id: 'research',
        order: 20,
        label: () => '研究',
        inject: (
          sessionId: string,
        ): Pick<
          ResearchShellProps,
          | 'loadPlaneState'
          | 'loadHubOverview'
          | 'loadPortfolioInterventions'
          | 'updateInterventionState'
          | 'onInvestigate'
          | 'setHub'
          | 'bindProject'
          | 'rescan'
          | 'unbindProject'
          | 'ackMissingReminder'
        > => ({
          loadPlaneState: async (): Promise<GetResearchPlaneStateResult> => {
            const result = await researchRpc.getResearchPlaneState({ sessionId })
            if (!result.ok) {
              // Business fault folded into a plain rejection — the shell's
              // failure face (重试) responds; the view stays DSH-free.
              throw new Error(
                `research shell: plane-state fetch failed — ${result.error.code}: ${result.error.message}`,
              )
            }
            return result.value
          },
          // V2-T5.1 (design §12 row 2): the HUB 总览 fetch. Same fold as
          // loadPlaneState — the overview's failure face (重试) responds on
          // rejection; the view stays DSH-free.
          loadHubOverview: async (): Promise<HubOverviewResult> => {
            const result = await researchRpc.getHubOverview({})
            if (!result.ok) {
              throw new Error(
                `research shell: getHubOverview failed — ${result.error.code}: ${result.error.message}`,
              )
            }
            return result.value
          },
          // V2-T4.2 (design §8 设为中枢): the 引导卡 confirm flow. Same fold
          // as loadPlaneState — the card shows the error message and stays
          // on rejection (the card stays, the user can retry).
          setHub: async (args: SetHubArgs): Promise<SetHubResult> => {
            const result = await researchRpc.setHub(args)
            if (!result.ok) {
              throw new Error(
                `research shell: setHub failed — ${result.error.code}: ${result.error.message}`,
              )
            }
            return result.value
          },
          // V2-T4.2 (design §8 接入): the 引导卡 displayName flow.
          bindProject: async (args: BindProjectArgs): Promise<BindProjectResult> => {
            const result = await researchRpc.bindProject(args)
            if (!result.ok) {
              throw new Error(
                `research shell: bindProject failed — ${result.error.code}: ${result.error.message}`,
              )
            }
            return result.value
          },
          // V2-T4.3 (design §4 MISSING 处置): the 四选一 modal's 恢复 action —
          // re-run discovery & reconciliation (the tree may have come back).
          // The same face the 设置页 「重扫并连接」 shares (§12 row 8).
          rescan: async (args: RescanArgs): Promise<RescanResult> => {
            const result = await researchRpc.rescan(args)
            if (!result.ok) {
              throw new Error(`research shell: rescan failed — ${result.error.code}: ${result.error.message}`)
            }
            return result.value
          },
          // V2-T4.3: the modal's 移除登记 action (归档口径 — the registry
          // entry goes `archived`, never deleted). The same face the 设置页
          // 解绑 flow shares (§12 row 6).
          unbindProject: async (args: UnbindProjectArgs): Promise<UnbindProjectResult> => {
            const result = await researchRpc.unbindProject(args)
            if (!result.ok) {
              throw new Error(
                `research shell: unbindProject failed — ${result.error.code}: ${result.error.message}`,
              )
            }
            return result.value
          },
          // V2-T4.3: the modal's 推后 action — the 「推后处理」 runtime dedup
          // flag set (in-memory for this backend run; a restart restores
          // the reminder, design §14). §12 row 9.
          ackMissingReminder: async (args: AckMissingReminderArgs): Promise<AckMissingReminderResult> => {
            const result = await researchRpc.ackMissingReminder(args)
            if (!result.ok) {
              throw new Error(
                `research shell: ackMissingReminder failed — ${result.error.code}: ${result.error.message}`,
              )
            }
            return result.value
          },
          // V2-T5.2 (design §7.2, §12 row 3): the 重要事件 stream fetch.
          // ALWAYS the cross-project host-side call for every role — the
          // 限本项目 narrowing (MANAGED/STANDALONE) is a CLIENT-SIDE filter
          // the shell applies from the plane state (no new wire field).
          // Same fold as loadPlaneState — the page's failure face responds
          // on rejection; the view stays DSH-free.
          loadPortfolioInterventions: async (args: GetPortfolioInterventionsArgs): Promise<GetPortfolioInterventionsResult> => {
            const result = await researchRpc.getPortfolioInterventions(args)
            if (!result.ok) {
              throw new Error(
                `research shell: getPortfolioInterventions failed — ${result.error.code}: ${result.error.message}`,
              )
            }
            return result.value
          },
          // V2-T5.2 (design §7.2 动作行, the frozen §13 machine): the 状态
          // 迁移 mutation. `projectId` always rides the item's own project
          // (design §12.1 explicit multi-project routing, both roles).
          // Same fold as loadHubOverview — the row's fault line responds on
          // rejection; the page re-fetches on success (no local patch).
          updateInterventionState: async (args: UpdateInterventionStateArgs): Promise<UpdateInterventionStateResult> => {
            const result = await researchRpc.updateInterventionState(args)
            if (!result.ok) {
              throw new Error(
                `research shell: updateInterventionState failed — ${result.error.code}: ${result.error.message}`,
              )
            }
            return result.value
          },
          // V2-T5.2 (design §7.2 动作行): the 一键调查 channel (the V1
          // investigation channel, OPEN cards only — NOT a §13 transition).
          // The channel resolves its outcome {ok, message, sessionId?};
          // ok:false carries the structured error text (the row's fault
          // line renders it verbatim) → folded into a rejection with the
          // same text; ok:true resolves the success text (it carries the
          // launched investigator session id — the transient 输出口径 the
          // row shows). The view never sees the outcome shape.
          onInvestigate: async (item: PortfolioInterventionItemDto, question: string): Promise<string> => {
            const outcome = await investigateIntervention({ sessionId, interventionId: item.id, question })
            if (!outcome.ok) {
              throw new Error(outcome.message)
            }
            return outcome.message
          },
        }),
      },
      ResearchShell,
    ),
  )
}
