/**
 * research_artifact_register (WP-3.3, live since G3) — register an
 * Artifact BY REFERENCE through the narrow AGENT create lane of the
 * semantic records service (SemanticsService.registerArtifactAsAgent).
 *
 * Parameter face — frozen ARTIFACT_REGISTERED payload + envelope owner:
 * `workstream_id` (artifacts are Workstream-local; the lane cross-checks
 * it against the calling run's WS), `type` (frozen artifactType enum),
 * `title`, `uri` (the plugin stores path/URI/reference only — never
 * copies content, ARCHITECTURE §9.3), optional `content_hash` /
 * `related_task` / `supersedes`. The id (A-<n>) and `created_by_run` are
 * NOT arguments — allocated / attributed by the service from the call
 * context (host-resolved run, G1). Existence rules (related_task /
 * supersedes) ride the frozen registry checks.
 *
 * The success value is the created artifact row (strict schema).
 */

import { assertArgsObject, assertEnum, assertOptionalString, checkKeySet, requireKey } from './args.js'
import { str } from './stub.js'
import {
  buildTool,
  semanticCallerFrom,
  toSemanticToolServiceError,
  ToolError,
  type ResearchToolDeps,
  type ResearchToolDefinition,
  type ToolJsonSchemaNode,
  type ToolJsonValue,
  type ToolParameters,
} from './types.js'

/** Frozen §7.2 name. */
export const RESEARCH_ARTIFACT_REGISTER = 'research_artifact_register'

/** The frozen artifact type vocabulary (common.schema.json $defs/artifactType). */
export const ARTIFACT_TYPES = ['DATASET', 'FIGURE', 'MODEL', 'CODE', 'REPORT', 'NOTE', 'OTHER'] as const

/** The frozen tool parameter key set. */
export const ARTIFACT_REGISTER_ARG_KEYS = [
  'workstream_id',
  'type',
  'title',
  'uri',
  'content_hash',
  'related_task',
  'supersedes',
] as const

/** The tool's model-facing parameter face (frozen 7 keys). */
export const ARTIFACT_REGISTER_PARAMETERS: ToolParameters = {
  workstream_id: str('The workstream (WS id) the artifact belongs to — it must be your run\'s workstream.', true),
  type: { type: 'string', enum: [...ARTIFACT_TYPES], required: true, description: 'The artifact kind (frozen vocabulary).' },
  title: str('Short title of the artifact.', true),
  uri: str('Where the artifact lives (workspace-relative path or URI) — the plugin stores the reference, never copies the content.', true),
  content_hash: str('Optional content hash (integrity pointer).'),
  related_task: str('Optional id of the task (T-<n>) that produced the artifact.'),
  supersedes: str('Optional id of the earlier artifact (A-<n>) this one replaces.'),
}

/** The canonical output contract (G3 strict): the created artifact row. */
export const ARTIFACT_REGISTER_OUTPUT_SCHEMA: ToolJsonSchemaNode = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'artifact'],
  properties: {
    status: { const: 'ok' },
    artifact: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'workstream_id', 'type', 'title', 'uri', 'status', 'created_by_run', 'recorded_at', 'event_id'],
      properties: {
        id: { type: 'string' },
        workstream_id: { type: 'string' },
        type: { enum: [...ARTIFACT_TYPES] },
        title: { type: 'string' },
        uri: { type: 'string' },
        content_hash: { type: 'string' },
        related_task: { type: 'string' },
        supersedes: { type: 'string' },
        status: { const: 'REGISTERED' },
        created_by_run: { type: 'string' },
        recorded_at: { type: 'integer' },
        event_id: { type: 'string' },
      },
    },
  },
}

interface ArtifactRegisterArgs {
  readonly workstream_id: string
  readonly type: (typeof ARTIFACT_TYPES)[number]
  readonly title: string
  readonly uri: string
  readonly content_hash?: string
  readonly related_task?: string
  readonly supersedes?: string
}

function parseArtifactRegisterArgs(args: unknown): ArtifactRegisterArgs {
  const obj = assertArgsObject(args, RESEARCH_ARTIFACT_REGISTER)
  checkKeySet(obj, ARTIFACT_REGISTER_ARG_KEYS, RESEARCH_ARTIFACT_REGISTER)
  for (const key of ['workstream_id', 'type', 'title', 'uri'] as const) requireKey(obj, key, RESEARCH_ARTIFACT_REGISTER)
  for (const key of ['workstream_id', 'title', 'uri'] as const) {
    const value = obj[key]
    if (typeof value !== 'string' || value.length === 0) {
      throw new ToolError('TOOL_INPUT', `/${key}: must be a non-empty string`)
    }
  }
  const type = assertEnum(obj['type'], '/type', ARTIFACT_TYPES)
  const contentHash = assertOptionalString(obj, 'content_hash')
  const relatedTask = assertOptionalString(obj, 'related_task')
  const supersedes = assertOptionalString(obj, 'supersedes')
  return {
    workstream_id: obj['workstream_id'] as string,
    type,
    title: obj['title'] as string,
    uri: obj['uri'] as string,
    ...(contentHash !== undefined ? { content_hash: contentHash } : {}),
    ...(relatedTask !== undefined ? { related_task: relatedTask } : {}),
    ...(supersedes !== undefined ? { supersedes } : {}),
  }
}

export function makeArtifactRegisterDefinition(deps: ResearchToolDeps): ResearchToolDefinition {
  return buildTool({
    name: RESEARCH_ARTIFACT_REGISTER,
    description:
      'Register an artifact (dataset / figure / model / code / report / note) by reference: the plugin stores ' +
      'the path/URI and metadata, never copies the content. Workstream-local; attributed to your run.',
    access: 'write',
    requiresRun: true,
    parameters: ARTIFACT_REGISTER_PARAMETERS,
    output: {
      schema: ARTIFACT_REGISTER_OUTPUT_SCHEMA,
      render: (_args, value) => {
        const v = value as { artifact: { id: string; workstream_id: string } }
        return [{ type: 'text', text: `Artifact ${v.artifact.id} registered on ${v.artifact.workstream_id}.` }]
      },
    },
    handle: async (args, ctx): Promise<ToolJsonValue> => {
      const parsed = parseArtifactRegisterArgs(args)
      const caller = semanticCallerFrom(ctx)
      try {
        const res = deps.semanticAgentCreate.registerArtifact(
          {
            workstreamId: parsed.workstream_id,
            type: parsed.type,
            title: parsed.title,
            uri: parsed.uri,
            ...(parsed.content_hash !== undefined ? { contentHash: parsed.content_hash } : {}),
            ...(parsed.related_task !== undefined ? { relatedTaskId: parsed.related_task } : {}),
            ...(parsed.supersedes !== undefined ? { supersedes: parsed.supersedes } : {}),
          },
          caller,
        )
        if (typeof res.createdByRun !== 'string') {
          throw new ToolError('TOOL_SERVICE', `${RESEARCH_ARTIFACT_REGISTER}: the lane returned an unattributed result (missing createdByRun)`)
        }
        return {
          status: 'ok',
          artifact: {
            id: res.artifactId,
            workstream_id: res.workstreamId,
            type: res.type,
            title: res.title,
            uri: res.uri,
            // optional fields echo the create inputs (a creation stores
            // verbatim what was handed to the lane — the row is the
            // payload folded); the service result carries the required
            // fields + allocation.
            ...(parsed.content_hash !== undefined ? { content_hash: parsed.content_hash } : {}),
            ...(parsed.related_task !== undefined ? { related_task: parsed.related_task } : {}),
            ...(parsed.supersedes !== undefined ? { supersedes: parsed.supersedes } : {}),
            status: res.status,
            created_by_run: res.createdByRun,
            recorded_at: res.recordedAt,
            event_id: res.eventId,
          },
        }
      } catch (cause) {
        throw toSemanticToolServiceError(RESEARCH_ARTIFACT_REGISTER, cause)
      }
    },
  })
}
