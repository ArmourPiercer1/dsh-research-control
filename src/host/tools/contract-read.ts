/**
 * research_contract_read (WP-3.3) — STUB (the forwarding service has not
 * landed yet; the report's stub table names the replacement).
 *
 * Parameter face: `edge_id` — the topology edge (TE-<n>) whose merge
 * contract (`contract.md`) is read. The agent may EDIT contracts only by
 * direct file editing inside the workspace (ARCHITECTURE §6 脚注 ²: the
 * plugin neither blocks nor prompts it — there is deliberately NO
 * contract-write tool; the read is the structured lane). Read-only by
 * construction.
 */

import { assertArgsObject, checkKeySet, requireKey } from './args.js'
import { makeStubDefinition, str, STUB_OUTPUT_SCHEMA } from './stub.js'
import { ToolError, type ResearchToolDefinition, type ToolParameters } from './types.js'

/** Frozen §7.2 name. */
export const RESEARCH_CONTRACT_READ = 'research_contract_read'

/** The frozen tool parameter key set. */
export const CONTRACT_READ_ARG_KEYS = ['edge_id'] as const

/** The tool's model-facing parameter face (frozen 1 key). */
export const CONTRACT_READ_PARAMETERS: ToolParameters = {
  edge_id: str('The topology edge id (TE-<n>) whose merge contract to read.', true),
}

export const CONTRACT_READ_OUTPUT_SCHEMA = STUB_OUTPUT_SCHEMA

function parseContractReadArgs(args: unknown): void {
  const obj = assertArgsObject(args, RESEARCH_CONTRACT_READ)
  checkKeySet(obj, CONTRACT_READ_ARG_KEYS, RESEARCH_CONTRACT_READ)
  requireKey(obj, 'edge_id', RESEARCH_CONTRACT_READ)
  if (typeof obj['edge_id'] !== 'string' || (obj['edge_id'] as string).length === 0) {
    throw new ToolError('TOOL_INPUT', '/edge_id: must be a non-empty string')
  }
}

export function makeContractReadDefinition(): ResearchToolDefinition {
  return makeStubDefinition({
    name: RESEARCH_CONTRACT_READ,
    description:
      'Read the merge contract (contract.md) of a topology edge — the agreed integration conditions between ' +
      'workstreams. Read-only (editing happens by direct file edit in the workspace, not through a tool).',
    access: 'read',
    parameters: CONTRACT_READ_PARAMETERS,
    plannedService: 'the contract-read service (WP-1.4 MergeContractStore.readContract composition; host wiring WP-3.6) — not yet landed (stub; see report)',
    parseArgs: parseContractReadArgs,
  })
}
