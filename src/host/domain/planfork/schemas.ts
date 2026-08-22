/**
 * WP-3.1 — frozen operational plan-fork schema loading (loader pattern).
 *
 * Loads the FROZEN `schema/operational/plan-fork.schema.json` (+ its parent
 * `common.schema.json` for the `planItemId`/`typedRef`/`actorRef`/
 * `epochMs`/$id refs) through the injected `ResearchFileReader` (the kernel
 * performs no I/O; same pattern as WP-2.5 `loadSemanticSchemas` and WP-1.1
 * `loadSchemas`):
 *
 *   - per-part validators come straight from the frozen document via
 *     `ajv.getSchema($id + '#/$defs/<Name>')` — NO derived schemas, no
 *     mutation of `schema/` (frozen, read-only);
 *   - failures AGGREGATE (loadErrors; `isUsable` false ⇒ every check
 *     reports unavailable — the creation chain fails loud with
 *     PF_SCHEMA_UNAVAILABLE, never validates against nothing);
 *   - AJV 2020-12 (the frozen `$schema` dialect), allErrors + verbose
 *     (precise multi-error location, TC-DOM-027 style), useDefaults off
 *     (the operational record has NO schema defaults — every field is
 *     explicit in the row).
 *
 * Consumers:
 *   - create.ts step 4 — `checkNewItemSpec(kind, spec)` (NEW.spec 过对应
 *     item schema 校验, PLAN_FORK_SPEC §4 步骤 4 原文);
 *   - store.ts — `checkRecordShape(record)` (构造出的记录过整行冻结
 *     $defs/PlanFork — 类型面同构的运行时网);
 *   - tests/planfork/model.test.ts — 模型往返 (schema 同构) 断言面。
 */

import Ajv2020 from 'ajv/dist/2020.js'
import type { ErrorObject, ValidateFunction } from 'ajv'
import addFormats from 'ajv-formats'

import { pjoin, schemaErrorSummary } from '../loader/index.js'
import type { ResearchFileReader } from '../loader/index.js'
import type { PlanForkItemKind } from './types.js'

/** One frozen-schema violation, precisely located (path = schema instance path). */
export interface PlanForkSchemaError {
  readonly path: string
  readonly message: string
}

export interface PlanForkSchemaCheck {
  readonly ok: boolean
  readonly errors: readonly PlanForkSchemaError[]
}

/** The frozen plan-fork schema face (per-part validators, no mutation). */
export interface PlanForkSchemas {
  /** The schemaDir the loader was loaded from. */
  readonly schemaDir: string
  /** False when loadErrors is non-empty; every check then reports unavailable. */
  readonly isUsable: boolean
  readonly loadErrors: readonly PlanForkSchemaError[]
  /** The whole record against frozen `$defs/PlanFork` (model 往返断言面). */
  readonly checkRecordShape: (record: unknown) => PlanForkSchemaCheck
  /** One proposed item against frozen `$defs/ProposedItem` (outer shape). */
  readonly checkProposedItem: (item: unknown) => PlanForkSchemaCheck
  /**
   * A NEW item spec against the frozen per-kind def
   * (`$defs/NewItemSpecTask|Gate|Milestone`) — kind↔spec 对应 is enforced
   * by validating against the DEF OF THE DECLARED KIND (a Gate-shaped spec
   * under kind=TASK fails the Task def's required `goal`).
   */
  readonly checkNewItemSpec: (kind: PlanForkItemKind, spec: unknown) => PlanForkSchemaCheck
  /** The base closure set against frozen `$defs/BasePlanObject[]` shape. */
  readonly checkBasePlanObjects: (objects: unknown) => PlanForkSchemaCheck
}

interface JsonPointerLike {
  $id?: string
  [key: string]: unknown
}

/** kind → frozen $defs name (plan-fork.schema.json $defs, 逐字). */
const SPEC_DEF_BY_KIND: Readonly<Record<PlanForkItemKind, string>> = {
  TASK: 'NewItemSpecTask',
  GATE: 'NewItemSpecGate',
  MILESTONE: 'NewItemSpecMilestone',
}

/**
 * Load + compile the frozen plan-fork operational schema. Aggregates
 * failures, never throws (loader pattern).
 */
export function loadPlanForkSchemas(reader: ResearchFileReader, schemaDir: string): PlanForkSchemas {
  const errors: PlanForkSchemaError[] = []
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false, // frozen schemas consumed exactly as shipped
    verbose: true, // error objects carry the violating value
  })
  addFormats(ajv)

  const readJson = (path: string): JsonPointerLike | null => {
    let text: string | null
    try {
      text = reader.readFile(path)
    } catch (cause) {
      errors.push({ path, message: `schema file read failed: ${cause instanceof Error ? cause.message : String(cause)}` })
      return null
    }
    if (text === null) {
      errors.push({ path, message: `schema file not found (schemaDir=${schemaDir})` })
      return null
    }
    try {
      return JSON.parse(text) as JsonPointerLike
    } catch (cause) {
      errors.push({ path, message: `schema file is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}` })
      return null
    }
  }

  // common.schema.json lives in the PARENT of the operational dir (frozen
  // layout: schema/common.schema.json + schema/operational/*.schema.json) —
  // registered under its own $id so the frozen `../common.schema.json`
  // relative refs resolve without any schema mutation.
  const common = readJson(pjoin(schemaDir, '..', 'common.schema.json'))
  if (common === null || typeof common.$id !== 'string') {
    errors.push({ path: pjoin(schemaDir, '..', 'common.schema.json'), message: 'common.schema.json is missing or has no $id' })
    return unavailableSchemas(schemaDir, errors)
  }
  try {
    ajv.addSchema(common, common.$id)
  } catch (cause) {
    errors.push({ path: pjoin(schemaDir, '..', 'common.schema.json'), message: `common.schema.json rejected: ${cause instanceof Error ? cause.message : String(cause)}` })
    return unavailableSchemas(schemaDir, errors)
  }

  const doc = readJson(pjoin(schemaDir, 'plan-fork.schema.json'))
  if (doc === null || typeof doc.$id !== 'string') {
    errors.push({ path: pjoin(schemaDir, 'plan-fork.schema.json'), message: 'plan-fork.schema.json is missing or has no $id' })
    return unavailableSchemas(schemaDir, errors)
  }
  try {
    ajv.addSchema(doc, doc.$id)
  } catch (cause) {
    errors.push({ path: pjoin(schemaDir, 'plan-fork.schema.json'), message: `plan-fork.schema.json rejected: ${cause instanceof Error ? cause.message : String(cause)}` })
    return unavailableSchemas(schemaDir, errors)
  }

  const getValidator = (def: string): ValidateFunction | undefined => {
    const validator = ajv.getSchema(`${doc.$id}#/$defs/${def}`)
    if (validator === undefined) {
      errors.push({ path: pjoin(schemaDir, 'plan-fork.schema.json'), message: `schema compile failed for $defs/${def}` })
    }
    return validator
  }

  const recordValidator = getValidator('PlanFork')
  const proposedItemValidator = getValidator('ProposedItem')
  const taskSpecValidator = getValidator('NewItemSpecTask')
  const gateSpecValidator = getValidator('NewItemSpecGate')
  const milestoneSpecValidator = getValidator('NewItemSpecMilestone')
  const baseObjectValidator = getValidator('BasePlanObject')

  if (errors.length > 0 || recordValidator === undefined || proposedItemValidator === undefined ||
      taskSpecValidator === undefined || gateSpecValidator === undefined || milestoneSpecValidator === undefined ||
      baseObjectValidator === undefined) {
    return unavailableSchemas(schemaDir, errors)
  }

  const specValidatorFor = (kind: PlanForkItemKind): ValidateFunction => {
    void SPEC_DEF_BY_KIND[kind] // (doc: kind → $defs mapping, verbatim)
    return kind === 'TASK' ? taskSpecValidator : kind === 'GATE' ? gateSpecValidator : milestoneSpecValidator
  }

  return {
    schemaDir,
    isUsable: true,
    loadErrors: [],
    checkRecordShape: (record) => runCheck(recordValidator, record),
    checkProposedItem: (item) => runCheck(proposedItemValidator, item),
    checkNewItemSpec: (kind, spec) => runCheck(specValidatorFor(kind), spec),
    // §3.2 `base_plan_objects` = { path, git_blob_oid }[] 稳定集合, minItems 1
    // (frozen PlanFork 属性约束) — 逐元素过冻结 $defs/BasePlanObject, 容器
    // 形状 (array, ≥1) 由本检查机械核对 (零派生 schema)。
    checkBasePlanObjects: (objects) => {
      if (!Array.isArray(objects) || objects.length === 0) {
        return { ok: false, errors: [{ path: '/base_plan_objects', message: `base_plan_objects must be a non-empty array (frozen minItems 1)` }] }
      }
      const errorsOut: PlanForkSchemaError[] = []
      for (let i = 0; i < objects.length; i++) {
        const elementOk = baseObjectValidator(objects[i]) as boolean
        if (!elementOk) {
          for (const err of baseObjectValidator.errors ?? []) {
            errorsOut.push({ path: `/base_plan_objects/${i}${err.instancePath}`, message: schemaErrorSummary(err) })
          }
        }
      }
      return errorsOut.length === 0 ? { ok: true, errors: [] } : { ok: false, errors: errorsOut }
    },
  }
}

function mapErrors(validator: ValidateFunction): PlanForkSchemaError[] {
  return (validator.errors ?? []).map((err: ErrorObject) => ({ path: err.instancePath, message: schemaErrorSummary(err) }))
}

function runCheck(validator: ValidateFunction, value: unknown): PlanForkSchemaCheck {
  const ok = validator(value) as boolean
  if (ok) return { ok: true, errors: [] }
  return { ok: false, errors: mapErrors(validator) }
}

function unavailableSchemas(schemaDir: string, errors: readonly PlanForkSchemaError[]): PlanForkSchemas {
  const unavailable: PlanForkSchemaCheck = {
    ok: false,
    errors: [{ path: '', message: `plan-fork schema set unavailable — see PlanForkSchemas.loadErrors` }],
  }
  return {
    schemaDir,
    isUsable: false,
    loadErrors: errors,
    checkRecordShape: () => unavailable,
    checkProposedItem: () => unavailable,
    checkNewItemSpec: () => unavailable,
    checkBasePlanObjects: () => unavailable,
  }
}
