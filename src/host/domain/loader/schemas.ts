/**
 * WP-1.1 — schema loading & compilation (JSON Schema draft 2020-12).
 *
 * Loads the 11 frozen declarative schemas from `schemaDir` (read through the
 * injected reader — the domain kernel itself performs no I/O) plus
 * `common.schema.json` from the PARENT directory: every declarative schema
 * `$ref`s its shared structures as `../common.schema.json#/$defs/<name>`, which
 * AJV resolves against each schema's own `$id`
 * (`https://dsh-research-control.invalid/schema/declarative/*.json`);
 * registering common under its `$id`
 * (`https://dsh-research-control.invalid/schema/common.schema.json`) makes all
 * relative refs resolve without any schema mutation (frozen, read-only).
 *
 * `ajv-formats` is required because common.schema.json declares
 * `format: "date-time"` / `"date"` (DOMAIN_SCHEMA §1.2) — AJV 8 does not
 * validate unknown formats, so the formats package is what makes the frozen
 * time-carrier contract actually enforce.
 */

import Ajv2020 from 'ajv/dist/2020.js'
import type { ErrorObject, ValidateFunction } from 'ajv'
import addFormats from 'ajv-formats'

import { pjoin } from './path.js'
import type { ResearchFileReader, ResearchLoadError } from './types.js'

/** The 11 declarative document types (one frozen schema each, schema/README.md 目录表). */
export type SchemaType =
  | 'project'
  | 'topic'
  | 'workstream'
  | 'topology'
  | 'plan'
  | 'task'
  | 'gate'
  | 'milestone'
  | 'objectives'
  | 'workspace'
  | 'agent-plan-fork-policy'

/** Frozen declarative schema inventory: logical type → file name in schemaDir. */
export const DECLARATIVE_SCHEMAS: ReadonlyArray<readonly [SchemaType, string]> = [
  ['project', 'project.schema.json'],
  ['topic', 'topic.schema.json'],
  ['workstream', 'workstream.schema.json'],
  ['topology', 'topology.schema.json'],
  ['plan', 'plan.schema.json'],
  ['task', 'task.schema.json'],
  ['gate', 'gate.schema.json'],
  ['milestone', 'milestone.schema.json'],
  ['objectives', 'objectives.schema.json'],
  ['workspace', 'workspace.schema.json'],
  ['agent-plan-fork-policy', 'agent-plan-fork-policy.schema.json'],
] as const

export interface CompiledSchemas {
  /** Compiled validators keyed by schema type (may be partial on schema-load failure). */
  readonly validators: ReadonlyMap<SchemaType, ValidateFunction>
  /** True when common.schema.json failed to load (then NO validator can resolve). */
  commonFailed: boolean
}

interface JsonPointerLike {
  $id?: string
  [key: string]: unknown
}

/**
 * Load + compile the frozen schema set.
 *
 * Failures are aggregated (one `SCHEMA_LOAD`/`SCHEMA_COMPILE`-class error per
 * broken file, code `SCHEMA_LOAD`), never thrown: a missing declarative schema
 * only invalidates its own document type (`SCHEMA_UNAVAILABLE` at validation
 * time); a missing common schema invalidates all types (fail loud).
 */
export function loadSchemas(
  reader: ResearchFileReader,
  schemaDir: string,
  errors: ResearchLoadError[],
): CompiledSchemas {
  const validators = new Map<SchemaType, ValidateFunction>()
  // Ajv2020 = draft 2020-12 dialect (the frozen `$schema` of every contract
  // file) with its meta-schema bundled; the base Ajv class is draft-07 and
  // rejects the 2020-12 `$schema` ref.
  const ajv = new Ajv2020({
    // allErrors ⇒ every violation is reported (precise multi-error location);
    // strict off ⇒ the frozen schemas are consumed exactly as shipped (no lint
    // of the contract);
    // useDefaults ⇒ §14.1 工程默认 materialized at the loader boundary.
    // (Standard AJV semantics: a `default` on a `required` property is applied
    // first, so e.g. workspace.root effectively resolves to its default ".".)
    // verbose ⇒ error objects carry the violating value (err.data) for the
    // precise "违规内容摘要" (TC-DOM-027); the cost is only retained references
    // on failed validations.
    allErrors: true,
    strict: false,
    useDefaults: true,
    verbose: true,
  })
  addFormats(ajv)

  const readJson = (path: string): JsonPointerLike | null => {
    let text: string | null
    try {
      text = reader.readFile(path)
    } catch (cause) {
      errors.push({
        code: 'SCHEMA_LOAD',
        file: path,
        message: `schema file read failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      })
      return null
    }
    if (text === null) {
      errors.push({ code: 'SCHEMA_LOAD', file: path, message: `schema file not found (schemaDir=${schemaDir})` })
      return null
    }
    try {
      return JSON.parse(text) as JsonPointerLike
    } catch (cause) {
      errors.push({
        code: 'SCHEMA_LOAD',
        file: path,
        message: `schema file is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
      })
      return null
    }
  }

  // common.schema.json lives in the PARENT of the declarative dir (frozen layout:
  // schema/common.schema.json + schema/declarative/*.schema.json).
  const common = readJson(pjoin(schemaDir, '..', 'common.schema.json'))
  if (common === null || typeof common.$id !== 'string') {
    errors.push({
      code: 'SCHEMA_LOAD',
      file: pjoin(schemaDir, '..', 'common.schema.json'),
      message: 'common.schema.json is missing or has no $id; no declarative schema can be validated',
    })
    return { validators, commonFailed: true }
  }
  try {
    ajv.addSchema(common, common.$id)
  } catch (cause) {
    errors.push({
      code: 'SCHEMA_LOAD',
      file: pjoin(schemaDir, '..', 'common.schema.json'),
      message: `common.schema.json rejected by validator engine: ${cause instanceof Error ? cause.message : String(cause)}`,
    })
    return { validators, commonFailed: true }
  }

  for (const [type, file] of DECLARATIVE_SCHEMAS) {
    const path = pjoin(schemaDir, file)
    const schema = readJson(path)
    if (schema === null) continue
    if (typeof schema.$id !== 'string') {
      errors.push({ code: 'SCHEMA_LOAD', file: path, message: 'schema has no $id; cannot register' })
      continue
    }
    try {
      ajv.addSchema(schema, schema.$id)
      const validator = ajv.getSchema(schema.$id)
      if (validator === undefined) {
        errors.push({ code: 'SCHEMA_LOAD', file: path, message: `schema compile failed for $id ${schema.$id}` })
        continue
      }
      validators.set(type, validator)
    } catch (cause) {
      errors.push({
        code: 'SCHEMA_LOAD',
        file: path,
        message: `schema rejected by validator engine: ${cause instanceof Error ? cause.message : String(cause)}`,
      })
    }
  }

  return { validators, commonFailed: false }
}

/* ------------------------------------------------------------------ *
 * Schema error → precise, human-readable summary
 * ------------------------------------------------------------------ */

/** Compact digest of a violating value (truncated; never throws). */
export function describeValue(value: unknown): string | undefined {
  if (value === undefined) return undefined
  let text: string
  try {
    text = JSON.stringify(value)
  } catch {
    text = String(value)
  }
  if (text === undefined) return undefined
  if (text.length > 80) text = `${text.slice(0, 77)}…`
  return text
}

/**
 * Build the "违规内容摘要" for one AJV error (TC-DOM-027: file path + schema
 * error path + violation summary). The instance path comes from
 * `error.instancePath`; this message carries the keyword detail and the value.
 */
export function schemaErrorSummary(error: ErrorObject): string {
  const base = error.message ?? `failed ${error.keyword}`
  const got = describeValue(error.data)
  const params = error.params as Record<string, unknown>
  switch (error.keyword) {
    case 'additionalProperties': {
      const prop = typeof params.additionalProperty === 'string' ? params.additionalProperty : '?'
      return `unexpected property "${prop}"${got !== undefined ? ` (value ${got})` : ''}`
    }
    case 'enum': {
      const allowed = Array.isArray(params.allowedValues)
        ? params.allowedValues.map((v) => JSON.stringify(v)).join(' | ')
        : ''
      return `not an allowed value [${allowed}]${got !== undefined ? ` (got ${got})` : ''}`
    }
    case 'const': {
      return `must equal ${JSON.stringify(params.allowedValue)}${got !== undefined ? ` (got ${got})` : ''}`
    }
    case 'required': {
      const missing = typeof params.missingProperty === 'string' ? params.missingProperty : '?'
      return `missing required property "${missing}"`
    }
    case 'format': {
      return `invalid ${JSON.stringify(params.format)} value${got !== undefined ? ` (got ${got})` : ''}`
    }
    case 'pattern': {
      return `does not match pattern ${JSON.stringify(params.pattern)}${got !== undefined ? ` (got ${got})` : ''}`
    }
    default: {
      return got !== undefined ? `${base} (got ${got})` : base
    }
  }
}
