/**
 * WP-7.4 / G7 S1b — the one-click investigation channel（client 半）。
 *
 * ## What this module is
 *
 * The client-side carrier for the plugin-OWNED host command
 * `/research-investigate`（registered by the dsh-adapter host half — see
 * `src/host/dsh-adapter/host/investigate-command.ts`). It executes the
 * command line through the DSH built-in **`commands/execute` gateway
 * method** — the same typert gateway domain the host's own web composer
 * uses for every `/` submission（checkout
 * `packages/client/ui-commands/src/client/service.ts` `execute()` →
 * `ctx.remote.commands.execute(sessionId, line, images)`）, proxied over
 * the host's apiproxy fetch route（`POST /api/commands/execute`）. The
 * shared carrier（`command-carrier.ts`）owns the wire envelope; this
 * module owns the one-click semantics（the line is built by the SHARED
 * single source `buildInvestigationCommandLine` —
 * `src/shared/investigation-command.ts` — the host handler parses the
 * same grammar）.
 *
 * ## Why not `session.prompt`（pin-version reality）
 *
 * The `session.prompt` doc contract（「single text block starting with `/`
 * dispatches a slash command」）is **not implemented on the apiproxy
 * carrier in dsh@0.1.0-rc.8** — its handler follows the line to the model
 * as an ordinary user message and always answers `{accepted:true}`
 * without the command slot（pinned bundle
 * `dsh-host-apiproxy@0.1.0-rc.8` `prompt` handler: no dispatch, no slot;
 * the smoke run proved it live: a `/research-investigate …` line landed
 * in `session.history` as a `user/message`）. `commands/execute` IS the
 * carrier the host UI actually uses for commands（`/permission`, …）—
 * executing through it keeps the one-click on the REAL user command
 * path（`command/run` + `command/done` lifecycle, `source.kind 'user'`,
 * composer-visible result）instead of faking a prompt.
 *
 * ## 13-RPC compatibility（the WP-7.4 report's 4-face argument, face 1）
 *
 * ZERO new RPCs: the ARCHITECTURE §7.1 13-RPC list and
 * `src/shared/rpc-contracts.ts` are untouched. This module does NOT
 * touch the `researchRpc` facade（that one is the plugin's own
 * namespace）— it talks to the DSH BUILT-IN `commands` gateway domain
 * over the host's own `/api` carrier route. The same-origin browser
 * fetch makes the route reachable without any plugin config.
 *
 * ## Permission semantics
 *
 * The submission is a USER act（the button click / composer line）— the
 * command registry records it with `source: {kind:'user'}`（checkout
 * `packages/interaction/commands/src/index.ts` `command/run` append —
 * verified on the wire: `command/run` `source: {kind:'user'}`）,
 * satisfying the ARCHITECTURE §6 row 启动 Investigator U ✅ / P ❌: the
 * plugin never initiates the launch, it only executes the user's
 * command.
 *
 * ## Fail-loud surface
 *
 *  - blank `sessionId`（agentId）→ throws BEFORE any network（the
 *    session-scoped slot must have resolved one — a blank dispatch is a
 *    wiring bug, not a user error to paper over）;
 *  - malformed intervention id / blank question → the shared builder
 *    throws（the GUI validates first; this is the second line）;
 *  - carrier-contract deviations → the shared carrier throws（non-2xx,
 *    undecodable envelope, non-server-response, unresolved command —
 *    the GUI must show them, not swallow them）;
 *  - envelope `ok:false` / command `kind:'error'`（the handler's own
 *    failure — the `IVL_*` mapping）→ `ok: false` outcome with the
 *    structured text verbatim（`[<code>] …` / `[IVL_*] …`）;
 *  - `kind:'success'` WITHOUT text → throws（the shared single-source
 *    success text always carries the launched session id — an empty
 *    success is a contract deviation, not a silent fallback）;
 *  - success text WITHOUT the session-id marker → throws（single-source
 *    drift — the GUI binds the investigator panel to exactly this id,
 *    it never guesses）.
 *
 * No DSH package imports（the carrier is a plain same-origin fetch over
 * the frozen envelope — `check-imports` sees zero DSH symbols; the
 * module sits in the dsh-adapter/remote territory by channel ownership,
 * not by import necessity）.
 */

import {
  buildInvestigationCommandLine,
  parseInvestigationSessionId,
} from '../../../shared/investigation-command.js'
import { executeHostCommand } from './command-carrier.js'

/** One one-click investigation submission. */
export interface InvestigateChannelInput {
  /** The CURRENT host session id（the session-scoped slot's framework
   *  `sessionId` standard prop）— the command executes ADDRESSED to
   *  this session's agent（`agentId`）; its `command/run` /
   *  `command/done` lifecycle lands in this session's log with
   *  `source.kind 'user'`（the user-visible command card）. */
  readonly sessionId: string
  /** The Intervention id（frozen `IV-<n>` — the production store's id
   *  face, read from the dashboard DTO rows）. */
  readonly interventionId: string
  /** The investigation question（non-blank after whitespace
   *  normalization — the frozen prompt format embeds it verbatim）. */
  readonly question: string
}

/** The channel outcome（success = the command settled with its
 *  success text; failure = the structured carrier/command error）. */
export interface InvestigateChannelOutcome {
  readonly ok: boolean
  /** Success: the command's success text（「只读调查已启动 — 会话
   *  <id>…」）. Failure: the structured error text（`[<code>]
   *  <message>` / the handler's `[IVL_*] …` line）— the GUI fault
   *  line renders it verbatim. */
  readonly message: string
  /** Success only: the launched investigator session id（parsed from
   *  the shared single-source success text）— the GUI binds the
   *  investigator panel to it. */
  readonly sessionId?: string
}

/**
 * Execute the one-click investigation command over the built-in
 * `commands/execute` gateway method.
 * @param input - the current session + the intervention row + the
 *  question（the GUI row state）.
 * @returns the outcome（`ok` + the user-facing text — the GUI renders
 *  success/fault from it, no re-parsing）.
 * @throws {Error} before the network（missing sessionId / malformed
 *  line）or on a carrier-contract deviation — the GUI shows the
 *  message.
 */
export async function investigateIntervention(input: InvestigateChannelInput): Promise<InvestigateChannelOutcome> {
  if (input.sessionId === '') {
    throw new Error('一键调查不可用: 当前无宿主会话 id（session 作用域插槽未解析出 sessionId — 先打开一个宿主会话）')
  }
  const line = buildInvestigationCommandLine(input.interventionId, input.question)

  const outcome = await executeHostCommand(input.sessionId, line)
  if (outcome.kind === 'error') {
    // The carrier's structured error（the gateway's agent-lookup
    // failures as `[code] message`; the handler's own failure as its
    // `[IVL_*] …` text — both already carry their code prefix）.
    return { ok: false, message: outcome.message }
  }
  const successText = outcome.text
  if (successText === undefined || successText === '') {
    throw new Error('一键调查通道: 命令成功但无 success text（共享成功文本单源必须携带被启动会话 id — 契约偏离）')
  }
  const sessionId = parseInvestigationSessionId(successText)
  if (sessionId === null) {
    throw new Error('一键调查通道: success text 无被启动会话 id 标记（INVESTIGATION_SUCCESS_TEXT 单源漂移 — 契约偏离）')
  }
  return { ok: true, message: successText, sessionId }
}
