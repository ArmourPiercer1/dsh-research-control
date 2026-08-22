/**
 * research_history_query (WP-3.3) — STUB (the forwarding service has not
 * landed yet; the report's stub table names the replacement).
 *
 * Parameter face — a faithful projection of the WP-2.3 read-only query
 * surface (`queryEvents`, seq-cursor pagination, §8 「History 按页面/时间
 * 窗口分页」): `workstream_id` (the owner WS whose log is read — every
 * HistoryEvent has exactly one owner, INV-HIST-3) + optional `order`
 * ('semantic' | 'audit'), `after_seq` (exclusive lower bound, ≥ 0),
 * `before_seq` (exclusive upper bound), `limit` (page size, ≥ 1).
 * Read-only by construction — History mutation/delete has NO tool
 * (INV-PERM-2; the matrix row 「History update/delete ❌ ❌ ❌ ❌」).
 */

import { assertArgsObject, assertEnum, assertOptionalInteger, checkKeySet, requireKey } from './args.js'
import { makeStubDefinition, str, STUB_OUTPUT_SCHEMA } from './stub.js'
import { ToolError, type ResearchToolDefinition, type ToolParameters } from './types.js'

/** Frozen §7.2 name. */
export const RESEARCH_HISTORY_QUERY = 'research_history_query'

/** The frozen replay-order vocabulary (WP-2.3 ReplayOrder). */
export const HISTORY_ORDERS = ['semantic', 'audit'] as const

/** The frozen tool parameter key set. */
export const HISTORY_QUERY_ARG_KEYS = ['workstream_id', 'order', 'after_seq', 'before_seq', 'limit'] as const

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
  limit: { type: 'integer', description: 'Page size in events (caps the window).' },
}

export const HISTORY_QUERY_OUTPUT_SCHEMA = STUB_OUTPUT_SCHEMA

function parseHistoryQueryArgs(args: unknown): void {
  const obj = assertArgsObject(args, RESEARCH_HISTORY_QUERY)
  checkKeySet(obj, HISTORY_QUERY_ARG_KEYS, RESEARCH_HISTORY_QUERY)
  requireKey(obj, 'workstream_id', RESEARCH_HISTORY_QUERY)
  if (typeof obj['workstream_id'] !== 'string' || (obj['workstream_id'] as string).length === 0) {
    throw new ToolError('TOOL_INPUT', '/workstream_id: must be a non-empty string')
  }
  if (obj['order'] !== undefined) assertEnum(obj['order'], '/order', HISTORY_ORDERS)
  assertOptionalInteger(obj, 'after_seq', { min: 0 })
  assertOptionalInteger(obj, 'before_seq', { min: 1 })
  assertOptionalInteger(obj, 'limit', { min: 1 })
}

export function makeHistoryQueryDefinition(): ResearchToolDefinition {
  return makeStubDefinition({
    name: RESEARCH_HISTORY_QUERY,
    description:
      'Query a workstream ResearchHistory (the append-only research event log) with seq-cursor pagination. ' +
      'Read-only: the log cannot be mutated or deleted from any agent surface.',
    access: 'read',
    parameters: HISTORY_QUERY_PARAMETERS,
    plannedService: 'the history-query service (WP-2.3 queryEvents composition; host wiring WP-3.6) — not yet landed (stub; see report)',
    parseArgs: parseHistoryQueryArgs,
  })
}
