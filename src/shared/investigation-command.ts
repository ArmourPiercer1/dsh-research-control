/**
 * WP-7.4 / G7 S1b — the one-click investigation command LINE（shared
 * single source — the host command handler PARSES it and the client
 * channel BUILDS it; one module keeps the two halves from drifting,
 * the same single-source discipline as the frozen prompt format in
 * `src/host/service/investigator/context.ts`）.
 *
 * The command itself is plugin-OWNED host-side（`/research-investigate`,
 * registered by the dsh-adapter host half — see
 * `src/host/dsh-adapter/host/investigate-command.ts`）; the client
 * reaches it through the DSH built-in `session.prompt` carrier（a single
 * text block starting with `/` dispatches a slash command, never sent to
 * the model — checkout `packages/host/apiproxy/src/api/sessions.ts`
 * session.prompt doc）. NO new RPC: the ARCHITECTURE §7.1 13-RPC list
 * and `rpc-contracts.ts` stay byte-identical（WP-7.4 报告 13-RPC 兼容性
 * 论证）.
 *
 * Layer: shared — no DSH imports, no host/client imports（the grammar is
 * pure text discipline）.
 */

/** The plugin-owned command name（without the leading slash — the
 *  registry's `COMMAND_NAME` grammar: `^[a-z][a-z0-9_-]*$`). */
export const INVESTIGATION_COMMAND_NAME = 'research-investigate'

/** The user-facing grammar line（Chinese 组件纪律 — the error path and
 *  the client hint render the same string）. */
export const investigationCommandGrammar = `${INVESTIGATION_COMMAND_NAME} IV-<n> <调查问题>`

/** The frozen Intervention id pattern（the Intervention store's own id
 *  face — `IV-<n>`, n ≥ 1, no leading zeros）. */
const IV_ID_PATTERN = /^IV-[1-9][0-9]*$/

/**
 * Build the command line the client channel submits over
 * `session.prompt`（`/research-investigate IV-<n> <question>`）.
 *
 * @param interventionId - a well-formed `IV-<n>` id（the view rows carry
 *  the production ids from the dashboard DTO — this is the id face the
 *  host handler looks up, so a malformed id fails the parse, not the
 *  lookup）.
 * @param question - the investigation question（all whitespace collapsed
 *  to single spaces — the command line is a single-line carrier; a
 *  blank question is refused loud, the GUI validates it before the call
 *  and this is the second line of defense）.
 * @throws {Error} on a malformed id or a blank question（the channel
 *  never submits an unparseable line — the error reaches the user as
 *  the command's error result or the channel's local failure）.
 */
export function buildInvestigationCommandLine(interventionId: string, question: string): string {
  if (!IV_ID_PATTERN.test(interventionId)) {
    throw new Error(`buildInvestigationCommandLine: intervention id must match ${IV_ID_PATTERN}, got ${JSON.stringify(interventionId)}`)
  }
  const normalized = question.replace(/\s+/g, ' ').trim()
  if (normalized.length === 0) {
    throw new Error('buildInvestigationCommandLine: the investigation question must be non-blank')
  }
  return `/${INVESTIGATION_COMMAND_NAME} ${interventionId} ${normalized}`
}

/**
 * Parse a command line（or a rawInput tail — the host handler strips
 * nothing: the registry hands the handler the exact text following the
 * command name）into（interventionId, question）or `null`（the error
 * path shows the grammar）.
 *
 * Grammar: `IV-<n> <question>` — the id is the first whitespace-
 * delimited token（frozen IV pattern）, the question is the remainder
 * with internal whitespace collapsed（newlines normalized — the GUI is
 * single-line by construction, typed input is normalized here）. Both
 * parts must be present.
 */
export function parseInvestigationInput(
  rawInput: string,
): { readonly interventionId: string; readonly question: string } | null {
  const trimmed = rawInput.trim()
  if (trimmed.length === 0) return null
  const spaceIndex = trimmed.search(/\s/)
  const idPart = spaceIndex === -1 ? trimmed : trimmed.slice(0, spaceIndex)
  if (!IV_ID_PATTERN.test(idPart)) return null
  const question = spaceIndex === -1 ? '' : trimmed.slice(spaceIndex + 1).replace(/\s+/g, ' ').trim()
  if (question.length === 0) return null
  return { interventionId: idPart, question }
}

/* ------------------------------------------------------------------ *
 * The command success text（shared single source — the host handler
 * BUILDS it（`investigationSuccessText`）and the client channel PARSES
 * the launched session id back out（`parseInvestigationSessionId`）:
 * the one-click flow then navigates the GUI to the investigator panel
 * bound to the LAUNCHED session, without the client guessing the id
 * format（the launcher's `investigator-<uuid>` shape is the adapter's
 * private — only this text contract crosses the channel）.
 * ------------------------------------------------------------------ */

/** The frozen success-text template（the `<会话 <id>>` marker is the
 *  parse anchor — keep the shape when editing the wording）. */
export const INVESTIGATION_SUCCESS_TEXT = (sessionId: string): string =>
  `只读调查已启动 — 会话 ${sessionId}（transient 输出; 保存为 AnalysisRecord 需用户显式操作）`

/**
 * Extract the launched session id from a success text built by
 * {@link INVESTIGATION_SUCCESS_TEXT}; `null` when the text does not
 * carry the marker（defensive — the GUI then shows the text without a
 * session binding instead of guessing）.
 */
export function parseInvestigationSessionId(text: string): string | null {
  const marker = '会话 '
  const start = text.indexOf(marker)
  if (start === -1) return null
  const rest = text.slice(start + marker.length)
  const end = rest.search(/[\s（(]/)
  const id = end === -1 ? rest : rest.slice(0, end)
  if (id.length === 0) return null
  return id
}
