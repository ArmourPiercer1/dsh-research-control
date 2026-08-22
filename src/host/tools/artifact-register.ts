/**
 * research_artifact_register (WP-3.3) — STUB (the forwarding service has
 * not landed yet; the report's stub table names the replacement).
 *
 * Parameter face — frozen ARTIFACT_REGISTERED payload + envelope owner:
 * `workstream_id` (artifacts are Workstream-local; the service
 * cross-checks it against the calling run's WS), `type` (frozen
 * artifactType enum), `title`, `uri` (the plugin stores path/URI/reference
 * only — never copies content, ARCHITECTURE §9.3), optional
 * `content_hash` / `related_task` / `supersedes`. The id (A-<n>) and
 * `created_by_run` are NOT arguments — allocated / attributed by the
 * service from the call context.
 */

import { assertArgsObject, assertEnum, assertOptionalString, checkKeySet, requireKey } from './args.js'
import { makeStubDefinition, str, STUB_OUTPUT_SCHEMA } from './stub.js'
import { ToolError, type ResearchToolDefinition, type ToolParameters } from './types.js'

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
  workstream_id: str('The workstream (WS id) the artifact belongs to.', true),
  type: { type: 'string', enum: [...ARTIFACT_TYPES], required: true, description: 'The artifact kind (frozen vocabulary).' },
  title: str('Short title of the artifact.', true),
  uri: str('Where the artifact lives (workspace-relative path or URI) — the plugin stores the reference, never copies the content.', true),
  content_hash: str('Optional content hash (integrity pointer).'),
  related_task: str('Optional id of the task (T-<n>) that produced the artifact.'),
  supersedes: str('Optional id of the earlier artifact (A-<n>) this one replaces.'),
}

export const ARTIFACT_REGISTER_OUTPUT_SCHEMA = STUB_OUTPUT_SCHEMA

function parseArtifactRegisterArgs(args: unknown): void {
  const obj = assertArgsObject(args, RESEARCH_ARTIFACT_REGISTER)
  checkKeySet(obj, ARTIFACT_REGISTER_ARG_KEYS, RESEARCH_ARTIFACT_REGISTER)
  for (const key of ['workstream_id', 'type', 'title', 'uri'] as const) requireKey(obj, key, RESEARCH_ARTIFACT_REGISTER)
  for (const key of ['workstream_id', 'title', 'uri'] as const) {
    const value = obj[key]
    if (typeof value !== 'string' || value.length === 0) {
      throw new ToolError('TOOL_INPUT', `/${key}: must be a non-empty string`)
    }
  }
  assertEnum(obj['type'], '/type', ARTIFACT_TYPES)
  assertOptionalString(obj, 'content_hash')
  assertOptionalString(obj, 'related_task')
  assertOptionalString(obj, 'supersedes')
}

export function makeArtifactRegisterDefinition(): ResearchToolDefinition {
  return makeStubDefinition({
    name: RESEARCH_ARTIFACT_REGISTER,
    description:
      'Register an artifact (dataset / figure / model / code / report / note) by reference: the plugin stores ' +
      'the path/URI and metadata, never copies the content.',
    access: 'write',
    parameters: ARTIFACT_REGISTER_PARAMETERS,
    plannedService: 'the artifact-recording service (ARTIFACT_REGISTERED + registry row) — not yet landed (stub; see report)',
    parseArgs: parseArtifactRegisterArgs,
  })
}
