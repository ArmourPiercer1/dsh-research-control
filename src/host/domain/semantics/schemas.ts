/**
 * WP-2.5 — schema-driven row validation (operational schemas, schemaDir
 * injection — loader pattern, cf. WP-1.1 `loadSchemas` / WP-2.2 registry).
 *
 * Loads the TWO frozen operational row-projection schemas through the
 * injected reader (the kernel performs no I/O):
 *
 *   - `<schemaDir>/semantic-labels.schema.json` — oneOf Claim | Fact |
 *     Artifact ($defs/Claim, $defs/Fact, $defs/Artifact);
 *   - `<schemaDir>/relation.schema.json`        — $defs/Relation;
 *   - `<schemaDir>/../common.schema.json`       — shared $defs (id patterns,
 *     typedRef, actorRef, epochMs, artifactType), registered under its own
 *     `$id` so the frozen `../common.schema.json` $refs resolve without any
 *     schema mutation (frozen, read-only — zero writes to `schema/`).
 *
 * Per-row-type validators come straight from the frozen documents via
 * `ajv.getSchema($id + '#/$defs/<Name>')` — no derived schemas, no mutation.
 * Failures aggregate (SCHEMA_LOAD / SCHEMA_COMPILE, never throw); an
 * unusable loader reports every row check as unavailable.
 *
 * Usage (service / replay layers): after `loadSemanticSchemas`, every
 * derived row produced by the reducer can be held to the FROZEN contract:
 * `checkRowShape('claim', row)` — this is what makes the TC-HIST-006
 * rebuild assertable against the real schemas, not against local mirrors.
 */

import Ajv2020 from 'ajv/dist/2020.js'
import type { ValidateFunction } from 'ajv'
import addFormats from 'ajv-formats'

import { pjoin, schemaErrorSummary } from '../loader/index.js'
import type {
  RowShapeCheck,
  RowShapeError,
  SemanticRowType,
  SemanticSchemaLoadError,
  SemanticSchemaReader,
} from './types.js'

/** The frozen operational inventory: (row type, file in schemaDir, $defs name). */
const OPERATIONAL_SCHEMA_FILES: ReadonlyArray<readonly [SemanticRowType, string, string]> = [
  ['claim', 'semantic-labels.schema.json', 'Claim'],
  ['fact', 'semantic-labels.schema.json', 'Fact'],
  ['artifact', 'semantic-labels.schema.json', 'Artifact'],
  ['relation', 'relation.schema.json', 'Relation'],
]

export interface SemanticSchemas {
  /** The schemaDir the loader was loaded from. */
  readonly schemaDir: string
  /** False when loadErrors is non-empty; checkRowShape then reports unavailable. */
  readonly isUsable: boolean
  readonly loadErrors: readonly SemanticSchemaLoadError[]
  /** Validate one row against its frozen operational schema. */
  readonly checkRowShape: (type: SemanticRowType, row: unknown) => RowShapeCheck
}

interface JsonPointerLike {
  $id?: string
  [key: string]: unknown
}

/**
 * Load + compile the frozen semantic row schemas. Aggregates failures, never
 * throws (loader pattern — WP-1.1 `loadSchemas` semantics).
 */
export function loadSemanticSchemas(reader: SemanticSchemaReader, schemaDir: string): SemanticSchemas {
  const errors: SemanticSchemaLoadError[] = []
  const validators = new Map<SemanticRowType, ValidateFunction>()
  /** file name → the document's own (frozen) $id, once registered. */
  const docIds = new Map<string, string>()

  const ajv = new Ajv2020({
    allErrors: true, // every violation reported (precise multi-error location)
    strict: false, // frozen schemas consumed exactly as shipped
    verbose: true, // error objects carry the violating value (TC-DOM-027 style)
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

  // common.schema.json lives in the PARENT of the operational dir (frozen
  // layout: schema/common.schema.json + schema/operational/*.schema.json).
  const commonPath = pjoin(schemaDir, '..', 'common.schema.json')
  const common = readJson(commonPath)
  if (common === null || typeof common.$id !== 'string') {
    errors.push({
      code: 'SCHEMA_LOAD',
      file: commonPath,
      message: 'common.schema.json is missing or has no $id; no operational row can be validated',
    })
    return { schemaDir, isUsable: false, loadErrors: errors, checkRowShape: (type) => unavailableRow(type) }
  }
  try {
    ajv.addSchema(common, common.$id)
  } catch (cause) {
    errors.push({
      code: 'SCHEMA_LOAD',
      file: commonPath,
      message: `common.schema.json rejected by validator engine: ${cause instanceof Error ? cause.message : String(cause)}`,
    })
    return { schemaDir, isUsable: false, loadErrors: errors, checkRowShape: (type) => unavailableRow(type) }
  }

  for (const [type, file, def] of OPERATIONAL_SCHEMA_FILES) {
    let docId = docIds.get(file)
    if (docId === undefined) {
      const path = pjoin(schemaDir, file)
      const schema = readJson(path)
      if (schema === null) continue
      if (typeof schema.$id !== 'string') {
        errors.push({ code: 'SCHEMA_LOAD', file: path, message: 'schema has no $id; cannot register' })
        continue
      }
      try {
        ajv.addSchema(schema, schema.$id)
        docIds.set(file, schema.$id)
        docId = schema.$id
      } catch (cause) {
        errors.push({
          code: 'SCHEMA_LOAD',
          file: path,
          message: `schema rejected by validator engine: ${cause instanceof Error ? cause.message : String(cause)}`,
        })
        continue
      }
    }
    const validator = ajv.getSchema(`${docId}#/$defs/${def}`)
    if (validator === undefined) {
      errors.push({
        code: 'SCHEMA_COMPILE',
        file: pjoin(schemaDir, file),
        message: `schema compile failed for $defs/${def} (${type})`,
      })
      continue
    }
    validators.set(type, validator)
  }

  return {
    schemaDir,
    isUsable: errors.length === 0,
    loadErrors: errors,
    checkRowShape: (type, row) => {
      const validator = validators.get(type)
      if (validator === undefined) return unavailableRow(type)
      const ok = validator(row) as boolean
      if (ok) return { ok: true }
      const mapped: RowShapeError[] = (validator.errors ?? []).map((err) => ({
        path: err.instancePath,
        message: schemaErrorSummary(err),
      }))
      return { ok: false, errors: mapped }
    },
  }
}

function unavailableRow(type: string): RowShapeCheck {
  return {
    ok: false,
    errors: [{ path: '', message: `row validator for ${type} unavailable — see SemanticSchemas.loadErrors` }],
  }
}
