/**
 * research_history_query (G2 §2d — LIVE forwarding, the stub retired).
 *
 * Parameter face — a faithful projection of the WP-2.3 read-only query
 * surface (`queryEvents`, seq-cursor pagination, §8 「History 按页面/时间
 * 窗口分页」): `workstream_id` (the owner WS whose log is read — every
 * HistoryEvent has exactly one owner, INV-HIST-3) + optional `order`
 * ('semantic' | 'audit'), `after_seq` (exclusive lower bound, ≥ 0),
 * `before_seq` (exclusive upper bound), `limit` (page size, ≥ 1).
 * Read-only by construction — History mutation/delete has NO tool
 * (INV-PERM-2; the matrix row 「History update/delete ❌ ❌ ❌ ❌」).
 *
 * PAGE-SIZE POLICY (BASELINE_PLAN §5 Q2 — the small ruling, THIS tool
 * only): no frozen document names a default or a maximum (verified:
 * `QueryHistoryArgsSchema` leaves `limit` unbounded; TEST_MATRIX names
 * no numbers), so the tool boundary resolves `limit ?? 100` and REFUSES
 * `limit > 1000` with TOOL_INPUT — never a silent clamp (the caller
 * learns the cap and pages with the frozen cursor instead). The applied
 * page size is echoed on every page (`limit`). Everything else is the
 * WP-2.3 protocol verbatim: windows PARTITION the seq axis, rows are
 * never truncated mid-window, `next_after_seq`/`exhausted` are
 * self-terminating.
 */

import { assertArgsObject, assertEnum, assertOptionalInteger, checkKeySet, requireKey } from './args.js'
import { mapReadServiceError, type ToolHistoryPage, type ToolHistoryQuery } from './read-ports.js'
import { str } from './stub.js'
import {
  buildTool,
  toToolJsonValue,
  ToolError,
  type ResearchToolDeps,
  type ResearchToolDefinition,
  type ToolJsonSchemaNode,
  type ToolJsonValue,
  type ToolParameters,
} from './types.js'

/** Frozen §7.2 name. */
export const RESEARCH_HISTORY_QUERY = 'research_history_query'

/** The frozen replay-order vocabulary (WP-2.3 ReplayOrder). */
export const HISTORY_ORDERS = ['semantic', 'audit'] as const

/** The frozen tool parameter key set. */
export const HISTORY_QUERY_ARG_KEYS = ['workstream_id', 'order', 'after_seq', 'before_seq', 'limit'] as const

/** Q2 (this tool only): default page size when `limit` is absent. */
export const HISTORY_QUERY_DEFAULT_LIMIT = 100
/** Q2 (this tool only): maximum page size — above it the call is REFUSED
 *  (TOOL_INPUT), never silently truncated. */
export const HISTORY_QUERY_MAX_LIMIT = 1000

/** The tool's model-facing parameter face (frozen 5 keys). */
export const HISTORY_QUERY_PARAMETERS: ToolParameters = {
  workstream_id: str('The workstream (WS id) whose ResearchHistory to query (the event-log owner).', true),
  order: {
    type: 'string',
    enum: [...HISTORY_ORDERS],
    description: 'Replay order: semantic (research-time timeline, default) or audit (registration order).',
  },
  after_seq: {
    type: 'integer',
    description: 'Exclusive lower bound on eventSeq (start after this event; default 0 = from the beginning).',
  },
  before_seq: {
    type: 'integer',
    description: 'Exclusive upper bound on eventSeq (the first seq NOT included).',
  },
  limit: {
    type: 'integer',
    description: `Page size in events (${HISTORY_QUERY_DEFAULT_LIMIT} when omitted; maximum ${HISTORY_QUERY_MAX_LIMIT} — larger calls are refused, page with after_seq instead).`,
  },
}

/** The frozen event envelope (`HistoryEventRecord`, camelCase carrier —
 *  the same DTO face the frozen `queryHistory` RPC row serves). */
const HISTORY_EVENT_SCHEMA: ToolJsonSchemaNode = {
  type: 'object',
  additionalProperties: false,
  required: ['eventId', 'ownerWorkstreamId', 'eventType', 'schemaVersion', 'occurredAt', 'actor', 'payload', 'eventSeq', 'recordedAt'],
  properties: {
    eventId: { type: 'string' },
    ownerWorkstreamId: { type: 'string' },
    eventType: { type: 'string' },
    schemaVersion: { type: 'integer' },
    occurredAt: { type: 'integer' },
    actor: {
      type: 'object',
      additionalProperties: false,
      required: ['kind'],
      properties: {
        kind: { type: 'string' },
        user_id: { type: 'string' },
        run_id: { type: 'string' },
        session_id: { type: 'string' },
        label: { type: 'string' },
      },
    },
    source: {
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind'],
          properties: {
            kind: { type: 'string' },
            session_id: { type: 'string' },
            path: { type: 'string' },
            commit_oid: { type: 'string' },
            interaction_id: { type: 'string' },
            note: { type: 'string' },
          },
        },
        { type: 'null' },
      ],
    },
    // The frozen per-type payload bodies (20 kinds) are NOT re-named here:
    // the envelope is strict, the payload object is the open lossless
    // carrier (the registry owns payload validity).
    payload: { type: 'object', additionalProperties: true },
    eventSeq: { type: 'integer' },
    recordedAt: { type: 'integer' },
  },
}

/** The canonical output contract: ONE page of the frozen seq-cursor
 *  protocol (rows verbatim; `next_after_seq`/`exhausted` as WP-2.3). */
export const HISTORY_QUERY_OUTPUT_SCHEMA: ToolJsonSchemaNode = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'workstream_id', 'order', 'limit', 'events', 'next_after_seq', 'exhausted'],
  properties: {
    status: { type: 'string', const: 'ok' },
    workstream_id: { type: 'string' },
    order: { type: 'string', enum: [...HISTORY_ORDERS] },
    limit: { type: 'integer' },
    events: { type: 'array', items: HISTORY_EVENT_SCHEMA },
    next_after_seq: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    exhausted: { type: 'boolean' },
  },
}

/** Validate + parse the frozen 5-key wire face into the port query
 *  (the page-size policy resolves HERE: default applied, max REFUSED). */
export function parseHistoryQueryArgs(args: unknown): ToolHistoryQuery {
  const obj = assertArgsObject(args, RESEARCH_HISTORY_QUERY)
  checkKeySet(obj, HISTORY_QUERY_ARG_KEYS, RESEARCH_HISTORY_QUERY)
  requireKey(obj, 'workstream_id', RESEARCH_HISTORY_QUERY)
  if (typeof obj['workstream_id'] !== 'string' || (obj['workstream_id'] as string).length === 0) {
    throw new ToolError('TOOL_INPUT', '/workstream_id: must be a non-empty string')
  }
  const order = obj['order'] !== undefined ? assertEnum(obj['order'], '/order', HISTORY_ORDERS) : undefined
  const afterSeq = assertOptionalInteger(obj, 'after_seq', { min: 0 })
  const beforeSeq = assertOptionalInteger(obj, 'before_seq', { min: 1 })
  const limit = assertOptionalInteger(obj, 'limit', { min: 1, max: HISTORY_QUERY_MAX_LIMIT })
  return {
    workstreamId: obj['workstream_id'],
    ...(order !== undefined ? { order } : {}),
    ...(afterSeq !== undefined ? { afterSeq } : {}),
    ...(beforeSeq !== undefined ? { beforeSeq } : {}),
    limit: limit ?? HISTORY_QUERY_DEFAULT_LIMIT,
  }
}

export function makeHistoryQueryDefinition(deps: ResearchToolDeps): ResearchToolDefinition {
  return buildTool({
    name: RESEARCH_HISTORY_QUERY,
    description:
      'Query a workstream ResearchHistory (the append-only research event log) with seq-cursor pagination. ' +
      'Read-only: the log cannot be mutated or deleted from any agent surface.',
    access: 'read',
    requiresRun: false,
    parameters: HISTORY_QUERY_PARAMETERS,
    output: {
      schema: HISTORY_QUERY_OUTPUT_SCHEMA,
      render: (_args, value) => {
        const v = value as unknown as ToolHistoryPage & { status: string }
        const text =
          `${String(v.events.length)} event(s) of ${v.workstream_id} (${v.order} order, page size ${String(v.limit)})` +
          (v.exhausted ? ' — log exhausted.' : ` — next page after seq ${String(v.next_after_seq)}.`)
        return [{ type: 'text', text }]
      },
    },
    handle: async (args, _ctx): Promise<ToolJsonValue> => {
      const query = parseHistoryQueryArgs(args)
      try {
        const page = deps.historyQuery(query)
        return {
          status: 'ok',
          workstream_id: page.workstream_id,
          order: page.order,
          limit: page.limit,
          events: toToolJsonValue([...page.events]),
          next_after_seq: toToolJsonValue(page.next_after_seq),
          exhausted: page.exhausted,
        }
      } catch (cause) {
        throw mapReadServiceError(RESEARCH_HISTORY_QUERY, cause)
      }
    },
  })
}
