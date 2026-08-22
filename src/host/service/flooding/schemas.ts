/**
 * WP-3.5 — frozen operational attention schema loading (loader pattern,
 * 同 WP-3.1 `loadPlanForkSchemas` / WP-2.5 `loadSemanticSchemas`)。
 *
 * 通过注入的 `ResearchFileReader` 装载**冻结** `schema/operational/
 * attention.schema.json`（+ 父 `schema/common.schema.json` 的
 * idIntervention/typedRef/actorRef/epochMs/idWorkstream refs）:
 *
 *   - 校验器直接取自冻结文档（`ajv.getSchema($id + '#/$defs/Intervention')`）
 *     — 零派生 schema, 零 `schema/` 改写（冻结只读）;
 *   - 失败聚合（loadErrors; isUsable=false ⇒ `InterventionStore` 拒绝写入,
 *     fail loud — 绝不在无 schema 时放行, 同 WP-3.1 PF_SCHEMA_UNAVAILABLE）;
 *   - AJV 2020-12（冻结 `$schema` 方言）, allErrors + verbose（精确定位）,
 *     useDefaults off（operational 记录无 schema 默认 — 每字段显式）。
 *
 * 消费: `InterventionStore.insertIntervention`（行落库前的整行冻结形状网 —
 * 类型面同构的运行时保证）+ tests/flooding 的模型往返断言面。
 */

import Ajv2020 from 'ajv/dist/2020.js'
import type { ValidateFunction } from 'ajv'
import addFormats from 'ajv-formats'

import { pjoin, schemaErrorSummary } from '../../domain/loader/index.js'
import type { ResearchFileReader } from '../../domain/loader/index.js'
import type { InterventionSchemaError, InterventionShapeCheck, InterventionSchemas } from './types.js'

interface JsonPointerLike {
  $id?: string
  [key: string]: unknown
}

/**
 * 装载 + 编译冻结 attention schema。聚合失败, 永不抛（loader 模式）。
 */
export function loadInterventionSchemas(reader: ResearchFileReader, schemaDir: string): InterventionSchemas {
  const errors: InterventionSchemaError[] = []
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false, // 冻结 schema 原样消费
    verbose: true, // 错误对象携带违例值
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

  // common.schema.json 在 operational 目录的**父目录**（冻结布局:
  // schema/common.schema.json + schema/operational/*.schema.json）— 以自身
  // $id 注册, 冻结的 `../common.schema.json` 相对 ref 无需任何改写即可解析。
  const common = readJson(pjoin(schemaDir, '..', 'common.schema.json'))
  if (common === null || typeof common.$id !== 'string') {
    errors.push({ path: pjoin(schemaDir, '..', 'common.schema.json'), message: 'common.schema.json is missing or has no $id' })
    return unavailable(schemaDir, errors)
  }
  try {
    ajv.addSchema(common, common.$id)
  } catch (cause) {
    errors.push({ path: pjoin(schemaDir, '..', 'common.schema.json'), message: `common.schema.json rejected: ${cause instanceof Error ? cause.message : String(cause)}` })
    return unavailable(schemaDir, errors)
  }

  const doc = readJson(pjoin(schemaDir, 'attention.schema.json'))
  if (doc === null || typeof doc.$id !== 'string') {
    errors.push({ path: pjoin(schemaDir, 'attention.schema.json'), message: 'attention.schema.json is missing or has no $id' })
    return unavailable(schemaDir, errors)
  }
  try {
    ajv.addSchema(doc, doc.$id)
  } catch (cause) {
    errors.push({ path: pjoin(schemaDir, 'attention.schema.json'), message: `attention.schema.json rejected: ${cause instanceof Error ? cause.message : String(cause)}` })
    return unavailable(schemaDir, errors)
  }

  const recordValidator = ajv.getSchema(`${doc.$id}#/$defs/Intervention`)
  if (recordValidator === undefined) {
    errors.push({ path: pjoin(schemaDir, 'attention.schema.json'), message: 'schema compile failed for $defs/Intervention' })
    return unavailable(schemaDir, errors)
  }

  return {
    schemaDir,
    isUsable: true,
    loadErrors: [],
    checkInterventionShape: (record) => runCheck(recordValidator, record),
  }
}

function mapErrors(validator: ValidateFunction): InterventionSchemaError[] {
  return (validator.errors ?? []).map((err) => ({ path: err.instancePath, message: schemaErrorSummary(err) }))
}

function runCheck(validator: ValidateFunction, value: unknown): InterventionShapeCheck {
  const ok = validator(value) as boolean
  if (ok) return { ok: true, errors: [] }
  return { ok: false, errors: mapErrors(validator) }
}

function unavailable(schemaDir: string, errors: readonly InterventionSchemaError[]): InterventionSchemas {
  const unavailableCheck: InterventionShapeCheck = {
    ok: false,
    errors: [{ path: '', message: 'intervention schema set unavailable — see InterventionSchemas.loadErrors' }],
  }
  return {
    schemaDir,
    isUsable: false,
    loadErrors: errors,
    checkInterventionShape: () => unavailableCheck,
  }
}
