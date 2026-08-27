/**
 * WP-7.4 / G7 S1b — the production one-click investigation entry (host half).
 *
 * ## The channel（13-RPC 兼容性论证 — 见 WP-7.4 报告）
 *
 * The user-triggered investigator launch rides the DSH built-in command
 * registry: a plugin-OWNED global command `/research-investigate`,
 * registered here from the `[Service.init]` composition（the disposer
 * goes through `ctx.effect` — fiber unmount unregisters it, the same
 * registration-as-effect convention the 11 tools use）. The client
 * reaches it over the DSH built-in `session.prompt` carrier（the frozen
 * host apiproxy surface — a single text block starting with `/`
 * dispatches a slash command, never sent to the model; checkout
 * `packages/host/apiproxy/src/api/sessions.ts` session.prompt doc）. The
 * plugin adds ZERO new RPCs: the ARCHITECTURE §7.1 13-RPC list stays
 * byte-identical, and no `rpc-contracts.ts` schema moves.
 *
 * ## Permission semantics（ARCHITECTURE §6: 启动 Investigator U ✅ / P ❌）
 *
 * The launch is initiated by a USER submission（the command registry
 * accepts user invocations only — there is no plugin-originated
 * dispatch face）; the plugin NEVER self-launches an investigator — this
 * handler only executes what the user typed or clicked. The host-side
 * wiring（the launcher over the injected port + the Intervention store +
 * the repo root）is the G7 task's host-side mechanism in its permission-
 * safe form: the data the launch needs（the full InterventionRecord
 * context fields + cwd）is read from the production store AT TRIGGER
 * TIME, so the client channel carries no research data — only the
 * command line（`<IV-id> <question>`）.
 *
 * ## Handler chain（fail loud at every step, mapped to the command result）
 *
 *   rawInput = `IV-<n> <question>`（the GUI builds it — the shared
 *   single-source builder; free-typing the same face in any composer is
 *   the identical path）
 *     → parse（no IV id / no question ⇒ error result with the grammar —
 *       `parseInvestigationInput`, shared with the client builder）
 *     → `wiring.interventions.getIntervention(id)`（absent ⇒ error —
 *       the store face is the production source, no client echo）
 *     → `wiring.investigator.launchFromIntervention(record, question,
 *       wiring.repoRoot)` — the FULL production guard chain（context →
 *       request closed-set → assertReadonlyLaunchRequest → the DSH
 *       adapter's ensure-preset / create+restrict / `/permission
 *       read-only` / followup — no degraded launch, IVL_PERMISSION
 *       fail loud）
 *     → `{kind:'success', text: 会话 <id>}` / `{kind:'error', text:
 *       [IVL_*] <message>}`.
 *
 * DSH surface: the cordis `Context` type only（same import the launcher
 * adapter and the host index use — the dsh-adapter territory stays the
 * ONE DSH-touching zone, INV-PERM-5）.
 */

import type { Context } from '@deepseek-ai/cordis'

import {
  INVESTIGATION_COMMAND_NAME,
  INVESTIGATION_SUCCESS_TEXT,
  investigationCommandGrammar,
  parseInvestigationInput,
} from '../../../shared/investigation-command.js'
import { isInvestigatorLaunchError } from '../../service/investigator/index.js'
import type { HostWiring } from '../../service/wiring/index.js'

/**
 * The host command registry face this module registers into（structural
 * mirror of `CommandRuntime.register` — checkout
 * `packages/interaction/commands/src/index.ts:267-278`; the plugin does
 * not devDep on `@deepseek-ai/dsh-commands`, the same structural-mirror
 * discipline as the launcher adapter's `CommandsRuntimeLike`）.
 */
export interface CommandRegistrarLike {
  register(definition: {
    readonly name: string
    readonly description: string
    readonly input?: { readonly hint: string; readonly images?: boolean }
    readonly recordInput?: boolean
    readonly handler: (invocation: { readonly rawInput: string }) => CommandOutcome | Promise<CommandOutcome>
  }): () => void
}

/** The command result vocabulary（mirror of `CommandResult` — checkout
 *  `packages/interaction/commands/src/types.ts:27-36`; the host
 *  normalizer rejects unknown kinds, so the mirror keeps both）. */
export type CommandOutcome =
  | { readonly kind: 'success'; readonly text?: string }
  | { readonly kind: 'error'; readonly text: string }

/** The no-wiring error text（the command channel of an empty plane or a
 *  multi-project plane — the frozen command face carries no projectId, so
 *  there is no unambiguous routing target; a single-project plane resolves
 *  the sole wiring and this branch never fires — 多项目命令路由面 is a
 *  T3.x design decision, the same §12.1 argument as the 11 tools）. */
export const INVESTIGATION_NO_WIRING_TEXT =
  '一键调查不可用: 研究平面当前没有可路由的唯一项目 wiring（空平面或多项目平面）— 单项目平面下此入口自动可用; 多项目命令路由面是 T3.x 设计项'

/**
 * The command handler（exported for unit tests — the production entry
 * {@link registerInvestigationCommand} is a thin registration wrapper
 * over it, same split as the launcher's pure builder + adapter seam）.
 *
 * @param getWiring - the LIVE resolver of the sole-project wiring (the
 *  host service's `#wiring` field). The plane-mutation RE-INIT
 *  (`#reinitResearchPlane` after setHub / bindProject / unbindProject /
 *  restoreProject / rescan) closes the boot-time wiring and swaps a
 *  fresh one IN PLACE — a handler capturing the boot-time VALUE would
 *  execute its reads/launches on the CLOSED second connections (a raw
 *  driver "database is not open" far from the cause). The getter
 *  re-resolves on EVERY invocation (the same live-field discipline as
 *  `requireRpc` / `#runResearchTool`); `undefined` (empty / multi-project
 *  plane) → the clear {@link INVESTIGATION_NO_WIRING_TEXT} error result,
 *  never a closed-handle failure.
 */
export function makeInvestigationCommandHandler(
  getWiring: () => HostWiring | undefined,
): (invocation: { readonly rawInput: string }) => Promise<CommandOutcome> {
  return async (invocation): Promise<CommandOutcome> => {
    const wiring = getWiring()
    if (wiring === undefined) {
      return { kind: 'error', text: INVESTIGATION_NO_WIRING_TEXT }
    }
    const parsed = parseInvestigationInput(invocation.rawInput)
    if (parsed === null) {
      return {
        kind: 'error',
        text: `语法: ${investigationCommandGrammar} — 例如 /${INVESTIGATION_COMMAND_NAME} IV-1 为什么 PF 在堆积?`,
      }
    }
    const record = wiring.interventions.getIntervention(parsed.interventionId)
    if (record === null) {
      return {
        kind: 'error',
        text: `Intervention ${parsed.interventionId} 不存在（本项目 intervention 存储无此 id — 检查 id 或先刷新 dashboard）`,
      }
    }
    try {
      const result = await wiring.investigator.launchFromIntervention(record, parsed.question, wiring.repoRoot)
      return {
        kind: 'success',
        // The shared single-source success text — the client channel
        // parses the launched session id back out of it（the one-click
        // flow then navigates to the investigator panel bound to the
        // launched session）.
        text: INVESTIGATION_SUCCESS_TEXT(result.sessionId),
      }
    } catch (cause) {
      if (isInvestigatorLaunchError(cause)) {
        return { kind: 'error', text: `[${cause.code}] ${cause.message}` }
      }
      const message = cause instanceof Error ? cause.message : String(cause)
      return { kind: 'error', text: `[IVL_LAUNCH] 调查启动失败: ${message}` }
    }
  }
}

/**
 * Register the global `/research-investigate` command on the host
 * command registry（the disposer is returned — the caller registers it
 * with `ctx.effect`, the registration-as-effect convention）.
 *
 * The registration happens ONCE at `[Service.init]` (when the plane
 * carries the sole wiring); the handler re-resolves the wiring LIVE on
 * every invocation, so a later plane-mutation RE-INIT (which closes the
 * boot-time wiring and swaps a fresh one in place) never strands the
 * command on a closed connection — and a plane that later leaves the
 * single-project shape fails loud with {@link INVESTIGATION_NO_WIRING_TEXT}
 * instead of a closed-handle driver error.
 *
 * @param ctx - the host context（`ctx.get('commands')` 结构面）.
 * @param getWiring - the live sole-project wiring resolver（见
 *  {@link makeInvestigationCommandHandler}）.
 * @returns the registration disposer, or `null` when the deployment
 *  exposes no command registry（a non-web profile — the caller logs the
 *  gap loud; the launch capability itself is untouched and still fails
 *  loud `IVL_PERMISSION` on use — no silent downgrade）.
 */
export function registerInvestigationCommand(
  ctx: Context,
  getWiring: () => HostWiring | undefined,
): (() => void) | null {
  const registrar = (ctx as unknown as { get: (name: string) => unknown }).get('commands') as
    | CommandRegistrarLike
    | undefined
  if (registrar === undefined) return null
  return registrar.register({
    name: INVESTIGATION_COMMAND_NAME,
    description: '对一个 Intervention 启动只读 Investigator 调查（transient 输出; 参数: IV-<n> <调查问题>）',
    input: { hint: 'IV-<n> <调查问题>' },
    handler: makeInvestigationCommandHandler(getWiring),
  })
}
