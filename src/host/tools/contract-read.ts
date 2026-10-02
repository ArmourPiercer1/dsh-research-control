/**
 * research_contract_read (G2 §2d — LIVE forwarding, the stub retired).
 *
 * Parameter face: `edge_id` — the tool reads the merge contract of ONE
 * cross-workstream edge (MERGE/FORK, DOMAIN_SCHEMA §3.1) at its
 * path-fixed location `merges/<TE-id>/contract.md` (§3.2; INV-GIT-8:
 * content ownership by path, no field copy).
 *
 * Forwards to `ResearchToolDeps.contractRead` — the WP-1.4
 * `MergeContractStore.readContract` kernel (Markdown stored/read
 * byte-for-byte) composed with the declarative edge snapshot (the tree
 * is the edge identity authority, §3.1). Single edge → the FULL
 * structured subject (edge identity + content + path), no pagination or
 * truncation surface:
 *  - a TE id that is malformed → the kernel's structured `INVALID_ID`;
 *  - a WELL-FORMED TE id naming no topology edge → `EDGE_NOT_FOUND`
 *    (the ownership-by-path file must anchor to a real edge, §16.1(h) —
 *    a missing object is a structured error, never an empty result);
 *  - an edge that exists WITHOUT a contract.md → the ADJ-7 VALUE face:
 *    `content: null`, absence as data (the value has no existence
 *    independent of the path — the path is the identity).
 * Contract WRITING stays outside the tool face (ARCHITECTURE §6 脚注 ²).
 */

import { assertArgsObject, checkKeySet, requireKey } from './args.js'
import { mapReadServiceError } from './read-ports.js'
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
export const RESEARCH_CONTRACT_READ = 'research_contract_read'

/** The frozen tool parameter key set. */
export const CONTRACT_READ_ARG_KEYS = ['edge_id'] as const

/** The tool's model-facing parameter face (frozen 1 key). */
export const CONTRACT_READ_PARAMETERS: ToolParameters = {
  edge_id: str('The cross-workstream topology edge (TE id) whose merge contract to read.', true),
}

/** The canonical output contract: ONE edge's identity + its contract
 *  bytes (`content: null` = the edge exists but has no contract.md yet). */
export const CONTRACT_READ_OUTPUT_SCHEMA: ToolJsonSchemaNode = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'edge', 'content', 'path'],
  properties: {
    status: { type: 'string', const: 'ok' },
    edge: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'topic_id', 'operation', 'lifecycle', 'inputs', 'outputs'],
      properties: {
        id: { type: 'string' },
        topic_id: { type: 'string' },
        operation: { type: 'string', enum: ['FORK', 'MERGE'] },
        lifecycle: { type: 'string', enum: ['PLANNED', 'REALIZED', 'VOID'] },
        inputs: { type: 'array', items: { type: 'string' } },
        outputs: { type: 'array', items: { type: 'string' } },
        note: { type: 'string' },
      },
    },
    content: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    path: { type: 'string' },
  },
}

/** Validate + parse the frozen 1-key wire face. */
export function parseContractReadArgs(args: unknown): { readonly edge_id: string } {
  const obj = assertArgsObject(args, RESEARCH_CONTRACT_READ)
  checkKeySet(obj, CONTRACT_READ_ARG_KEYS, RESEARCH_CONTRACT_READ)
  requireKey(obj, 'edge_id', RESEARCH_CONTRACT_READ)
  if (typeof obj['edge_id'] !== 'string' || (obj['edge_id'] as string).length === 0) {
    throw new ToolError('TOOL_INPUT', '/edge_id: must be a non-empty string')
  }
  return { edge_id: obj['edge_id'] }
}

export function makeContractReadDefinition(deps: ResearchToolDeps): ResearchToolDefinition {
  return buildTool({
    name: RESEARCH_CONTRACT_READ,
    description:
      'Read the merge contract (contract.md) of one cross-workstream topology edge. Read-only: contract ' +
      'content is edited in the workspace, never through an agent tool.',
    access: 'read',
    requiresRun: false,
    parameters: CONTRACT_READ_PARAMETERS,
    output: {
      schema: CONTRACT_READ_OUTPUT_SCHEMA,
      render: (_args, value) => {
        const v = value as { edge: { id: string }; content: string | null; path: string }
        const text =
          v.content === null
            ? `Edge ${v.edge.id} has no merge contract yet (${v.path} does not exist).`
            : `Merge contract of edge ${v.edge.id} (${v.path}): ${v.content.length} character(s).`
        return [{ type: 'text', text }]
      },
    },
    handle: async (args, _ctx): Promise<ToolJsonValue> => {
      const parsed = parseContractReadArgs(args)
      try {
        const view = deps.contractRead(parsed.edge_id)
        return {
          status: 'ok',
          edge: toToolJsonValue(view.edge),
          content: toToolJsonValue(view.content),
          path: view.path,
        }
      } catch (cause) {
        throw mapReadServiceError(RESEARCH_CONTRACT_READ, cause)
      }
    },
  })
}
