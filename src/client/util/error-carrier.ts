/**
 * V2-UI-0.4 UI-2 (NOTE-4) — the research RPC error CARRIER matcher.
 *
 * The typert gateway folds EVERY host error into
 * `{ code: 'internal', message }` — the machine-readable RPC error code
 * never rides `error.code` (that field is the frozen `PLANE_ERROR_CODES`
 * + `'internal'`, and the frozen list is NOT extensible). The code the
 * host carriers carry instead travels as a machine-matchable prefix of
 * the message: `[research-control] <CODE>: <detail>`.
 *
 * NOTE-4 ruling: the view layer must NOT branch on `error.code` (the
 * fold erases it); it machine-matches this prefix, with a raw-text
 * fallback for carriers that are not research-control carriers (e.g. the
 * transport-level 'internal' message without the prefix).
 *
 * This module is the SINGLE client-side decoder of that prefix — pure
 * (no imports, no side effects) so the match / fallback behaviour is
 * unit-testable in isolation.
 */

/** The decoded carrier halves (`[research-control] <CODE>: <detail>`). */
export interface ResearchErrorCarrier {
  /** The `<CODE>` half (e.g. `HIER_INPUT`, `LP_GIT_INIT`,
   *  `PLANE_HUB_WORKSPACE`). */
  readonly code: string
  /** The `<detail>` half (everything after `: `). */
  readonly detail: string
}

/**
 * The carrier prefix. The code is an upper-camel SCREAMING-SNAKE token
 * (the HIER_* / LP_* / PLANE_* families all match); the detail is the
 * rest of the string (it may be empty, and may itself contain colons).
 */
const CARRIER_RE = /\[research-control\] ([A-Z][A-Z0-9_]*): ?([\s\S]*)/

/**
 * Extract the `[research-control] <CODE>: <detail>` carrier from an
 * error message.
 *
 * The client-side fold wraps the gateway message in its own prefix
 * (`research shell: X failed — internal: [research-control] …`), so the
 * matcher searches ANYWHERE in the string, not just at index 0.
 *
 * @param message - The error message text (`error.message` of the
 *   rejected fold, or the raw carrier).
 * @returns The decoded carrier, or `null` when the message carries no
 *   recognized prefix (callers then render the raw message).
 */
export function extractResearchErrorCarrier(message: string): ResearchErrorCarrier | null {
  const m = CARRIER_RE.exec(message)
  if (m === null) return null
  return { code: m[1], detail: m[2] }
}
