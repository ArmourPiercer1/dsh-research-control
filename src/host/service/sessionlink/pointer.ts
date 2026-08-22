/**
 * WP-2.6 — pointer-row codec (the `meta` KV value for one wired session).
 *
 * The pointer row (INV-DB-2: session_id → Run 绑定 + 事件指针, 无 raw log)
 * is persisted as ONE strict-JSON string in the operational `meta` table
 * under `pointerKey(sessionId)`. The `meta` table is the right home:
 *  - it is bookkeeping, NOT the rebuildable `derived_state` cache — a
 *    WP-2.3 `rebuildDerivedState` (wholesale replace) can never drop it;
 *  - it lives in the same SQLite file as the event log (one operational
 *    store per project, DOMAIN_SCHEMA §15), so a pointer + its events are
 *    crash-consistent in the file sense (WAL: each write is atomic on its
 *    own; the append→pointer ordering is documented on the service).
 *
 * Decoding is STRICT and fails loud (`STATE_CORRUPT`): a malformed row must
 * never be silently half-consumed (it would either re-process consumed
 * edges or finish the wrong run). The shape is exactly `SessionPointer` —
 * no field is ever ignored, no extra field is ever accepted.
 */

import { SessionLinkError, type SessionPointer } from './types.js'

/**
 * Encode a pointer row to its `meta` value (canonical strict JSON).
 * @throws `TypeError` on a structurally invalid row (the service never
 *   encodes one; the guard is the codec's own boundary).
 */
export function encodePointer(pointer: SessionPointer): string {
  validatePointer(pointer, 'encode')
  return JSON.stringify({
    workstreamId: pointer.workstreamId,
    ...(pointer.intent !== undefined ? { intent: pointer.intent } : {}),
    ...(pointer.taskId !== undefined ? { taskId: pointer.taskId } : {}),
    lastSeq: pointer.lastSeq,
    runId: pointer.runId,
    runStartedAt: pointer.runStartedAt,
  })
}

/**
 * Decode a `meta` value into a pointer row (strict shape check).
 * @throws `SessionLinkError` (`STATE_CORRUPT`) when the value is not valid
 *   JSON or violates the row shape — fail loud, never guess.
 */
export function decodePointer(raw: string, sessionId: string): SessionPointer {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (cause) {
    throw new SessionLinkError({
      code: 'STATE_CORRUPT',
      message: `pointer row of session ${JSON.stringify(sessionId)} is not valid JSON: ${(cause as Error).message}`,
    })
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw corrupt(`pointer row of session ${JSON.stringify(sessionId)} must be a JSON object`)
  }
  const d = parsed as Record<string, unknown>
  let runId: string | null = null
  if (d.runId !== undefined && d.runId !== null) {
    if (typeof d.runId !== 'string' || d.runId.length === 0) {
      throw corrupt(`pointer row of session ${JSON.stringify(sessionId)}: runId must be a non-empty string or null`)
    }
    runId = d.runId
  }
  let runStartedAt: number | null = null
  if (d.runStartedAt !== undefined && d.runStartedAt !== null) {
    if (typeof d.runStartedAt !== 'number' || !Number.isSafeInteger(d.runStartedAt) || d.runStartedAt < 0) {
      throw corrupt(`pointer row of session ${JSON.stringify(sessionId)}: runStartedAt must be a non-negative safe integer or null`)
    }
    runStartedAt = d.runStartedAt
  }
  // The open-run binding pair: stored rows are external data, so a broken
  // pair is STATE_CORRUPT here (the ENCODE boundary reports TypeError via
  // validatePointer — the in-memory API never yields a broken row).
  if ((runId === null) !== (runStartedAt === null)) {
    throw corrupt(`pointer row of session ${JSON.stringify(sessionId)}: runId and runStartedAt must be both null or both set (open-run binding pair)`)
  }
  const out: SessionPointer = {
    workstreamId: requireString(d, 'workstreamId', sessionId),
    ...(d.intent !== undefined ? { intent: requireString(d, 'intent', sessionId) } : {}),
    ...(d.taskId !== undefined ? { taskId: requireString(d, 'taskId', sessionId) } : {}),
    lastSeq: requireNonNegativeInt(d, 'lastSeq', sessionId),
    runId,
    runStartedAt,
  }
  return out
}

/** Cross-field shape validation (shared by encode + decode). */
function validatePointer(p: SessionPointer, what: string): void {
  if (typeof p.workstreamId !== 'string' || p.workstreamId.length === 0) {
    throw new TypeError(`${what}: workstreamId must be a non-empty string`)
  }
  if (!Number.isSafeInteger(p.lastSeq) || p.lastSeq < 0) {
    throw new TypeError(`${what}: lastSeq must be a non-negative safe integer`)
  }
  if (p.intent !== undefined && typeof p.intent !== 'string') {
    throw new TypeError(`${what}: intent must be a string when present`)
  }
  if (p.taskId !== undefined && typeof p.taskId !== 'string') {
    throw new TypeError(`${what}: taskId must be a string when present`)
  }
  // runId / runStartedAt travel as a pair (the pointer is the durable
  // 「Run 绑定」: an open run always carries its started_at).
  if ((p.runId === null) !== (p.runStartedAt === null)) {
    throw new TypeError(`${what}: runId and runStartedAt must be both null or both set (open-run binding pair)`)
  }
  if (p.runId !== null && typeof p.runId !== 'string' && typeof p.runId !== 'number') {
    throw new TypeError(`${what}: runId must be null or a string when set`)
  }
  if (p.runStartedAt !== null && (typeof p.runStartedAt !== 'number' || !Number.isSafeInteger(p.runStartedAt) || p.runStartedAt < 0)) {
    throw new TypeError(`${what}: runStartedAt must be null or a non-negative safe integer when set`)
  }
}

function requireString(d: Record<string, unknown>, field: string, sessionId: string): string {
  if (typeof d[field] !== 'string' || (d[field] as string).length === 0) {
    throw corrupt(`pointer row of session ${JSON.stringify(sessionId)}: ${field} must be a non-empty string`)
  }
  return d[field] as string
}

function requireNonNegativeInt(d: Record<string, unknown>, field: string, sessionId: string): number {
  if (typeof d[field] !== 'number' || !Number.isSafeInteger(d[field]) || (d[field] as number) < 0) {
    throw corrupt(`pointer row of session ${JSON.stringify(sessionId)}: ${field} must be a non-negative safe integer`)
  }
  return d[field] as number
}

function corrupt(message: string): SessionLinkError {
  return new SessionLinkError({ code: 'STATE_CORRUPT', message })
}
