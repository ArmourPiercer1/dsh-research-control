/**
 * WP-2.2 — `loadHistoryEventRegistry`: the schema-driven typed event registry
 * (loader pattern, cf. WP-1.1 `loadSchemas`).
 *
 * The EVENT TYPE SET is decided by the frozen machine-readable truth
 * `schema/history/history-events.schema.json` (20 `oneOf` branches, each
 * pinning `eventType` + `schemaVersion` consts and the payload schema). The
 * §4/§5 semantic columns (emitters, mutation flag, owner rule, transition,
 * category) come from the hand-frozen `EVENT_METADATA` table. Loading
 * performs the mechanized frozen-contract sync check (catalog §7.2 「冻结时
 * 人工核对一次」): the two type sets must match EXACTLY (same names, each
 * with schemaVersion 1), else the registry is unusable with `CATALOG_SYNC`
 * errors — a drift between the semantic document and the machine schema can
 * never go silent.
 *
 * Per-event validation precision: instead of running the whole `oneOf`
 * (whose sub-branch errors AJV does not surface cleanly), each branch is
 * wrapped as `$defs/perEvent_<TYPE>` inside an in-memory DERIVED copy of the
 * frozen schema (the frozen file itself is never mutated) and compiled as a
 * standalone validator `#per-event/<TYPE>`. Dispatch is on the candidate's
 * `eventType` string: unknown type → precise `ENVELOPE` error at
 * `/eventType`; known type → the per-event validator yields precise
 * envelope+payload errors (INV-HIST-4: unknown (eventType, schemaVersion) or
 * payload violation ⇒ reject).
 *
 * I/O: exactly two reads through the injected `HistorySchemaReader`
 * (loader pattern) — no fs, no DSH (INV-PERM-5), no persistence.
 */

import Ajv2020 from 'ajv/dist/2020.js'
import type { ErrorObject, ValidateFunction } from 'ajv'
import addFormats from 'ajv-formats'

import { EVENT_METADATA } from './emitters.js'
import type {
  EventRegistryEntry,
  EventValidationError,
  HistoryEventRegistry,
  HistoryEventType,
  HistoryRegistryLoadError,
  HistorySchemaReader,
  ShapeCheck,
} from './types.js'

/** Frozen layout: the events schema lives in `schema/history/`, common in `schema/`. */
const EVENTS_FILE = 'history-events.schema.json'
const COMMON_FILE = 'common.schema.json'

/**
 * Minimal path join with `.`/`..` resolution for the two-file layout
 * (kernel stays platform-free, cf. WP-1.1 `pjoin`). Separator-aware for
 * BOTH `/` and `\` with the same absolute-prefix recognition (POSIX `/`,
 * Windows drive `C:`, UNC `//`) and forward-slash output normalization —
 * the host hands native roots (a Windows `C:\…`), and the injected reader
 * maps the normalized output onto the host FS (node fs accepts `/`).
 */
function joinPath(base: string, ...segments: string[]): string {
  // absolute-prefix on the FIRST segment: POSIX `/`, drive `C:` (+sep or
  // bare), UNC `\\…`/`//…`. (Same recognition as the frozen
  // ABSOLUTE_PATH_PATTERN twins.) Drive-relative (`C:foo`) is not a root.
  let prefix = ''
  let firstBody = base
  // UNC first: `//…` also starts with `/` (Windows UNC forward-slash form).
  if (base.startsWith('\\\\') || base.startsWith('//')) {
    prefix = '//'
    firstBody = base.slice(2)
  } else if (base.startsWith('/')) {
    prefix = '/'
    firstBody = base.slice(1)
  } else {
    const drive = /^([A-Za-z]:)([\\/])(.*)$/.exec(base)
    if (drive) {
      prefix = drive[1]!
      firstBody = drive[3]!
    } else if (/^[A-Za-z]:$/.test(base)) {
      prefix = base
      firstBody = ''
    }
  }
  const absolute = prefix !== ''
  const out: string[] = []
  const pushParts = (raw: string): void => {
    for (const part of raw.split(/[\\/]/)) {
      if (part === '' || part === '.') continue
      if (part === '..') {
        if (out.length > 0 && out[out.length - 1] !== '..') out.pop()
        else if (!absolute) out.push('..')
        continue
      }
      out.push(part)
    }
  }
  pushParts(firstBody)
  for (const segment of segments) pushParts(segment)
  if (out.length === 0) return prefix.endsWith(':') ? `${prefix}/` : prefix
  return prefix.endsWith(':') ? `${prefix}/${out.join('/')}` : `${prefix}${out.join('/')}`
}

interface RawSchema {
  readonly $id: string
  readonly [key: string]: unknown
  $defs?: Record<string, unknown>
}

interface Branch {
  readonly name: string
  readonly version: number
  readonly schema: Record<string, unknown>
}

export function loadHistoryEventRegistry(reader: HistorySchemaReader, schemaDir: string): HistoryEventRegistry {
  const loadErrors: HistoryRegistryLoadError[] = []
  const eventsFile = joinPath(schemaDir, EVENTS_FILE)
  const commonFile = joinPath(schemaDir, '..', COMMON_FILE)

  const readJson = (file: string): RawSchema | null => {
    let text: string | null
    try {
      text = reader.readFile(file)
    } catch (cause) {
      loadErrors.push({ code: 'SCHEMA_LOAD', file, message: `schema file read failed: ${errMsg(cause)}` })
      return null
    }
    if (text === null) {
      loadErrors.push({ code: 'SCHEMA_LOAD', file, message: `schema file not found (schemaDir=${schemaDir})` })
      return null
    }
    try {
      const parsed: unknown = JSON.parse(text)
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        loadErrors.push({ code: 'SCHEMA_LOAD', file, message: 'schema file is not a JSON object' })
        return null
      }
      return parsed as RawSchema
    } catch (cause) {
      loadErrors.push({ code: 'SCHEMA_LOAD', file, message: `schema file is not valid JSON: ${errMsg(cause)}` })
      return null
    }
  }

  const common = readJson(commonFile)
  const events = readJson(eventsFile)

  // ---- extract the oneOf branches (the schema-driven type set) ----------
  const branches: Branch[] = []
  if (events !== null && typeof events.$id === 'string') {
    const oneOf: unknown = events.oneOf
    if (!Array.isArray(oneOf) || oneOf.length === 0) {
      loadErrors.push({ code: 'SCHEMA_LOAD', file: eventsFile, message: 'history-events.schema.json has no oneOf branches' })
    } else {
      for (const raw of oneOf) {
        const branch = raw as { properties?: { eventType?: { const?: unknown }; schemaVersion?: { const?: unknown } } }
        const name = branch?.properties?.eventType?.const
        const version = branch?.properties?.schemaVersion?.const
        if (typeof name !== 'string' || typeof version !== 'number') {
          loadErrors.push({
            code: 'SCHEMA_LOAD',
            file: eventsFile,
            message: `oneOf branch is missing the eventType/schemaVersion consts: ${compact(raw)}`,
          })
          continue
        }
        branches.push({ name, version, schema: raw as Record<string, unknown> })
      }
    }
  }

  // ---- CATALOG_SYNC: schema type set × §4/§5 metadata must match exactly --
  // (only meaningful when the events schema actually loaded; a missing file
  // is a pure SCHEMA_LOAD failure, not a catalog drift)
  if (events !== null && typeof events.$id === 'string') {
    const metaNames = Object.keys(EVENT_METADATA) as HistoryEventType[]
    const metaSet = new Set(metaNames)
    const seen = new Set<string>()
    for (const branch of branches) {
      if (seen.has(branch.name)) {
        loadErrors.push({ code: 'CATALOG_SYNC', message: `duplicate eventType in schema oneOf: ${branch.name}` })
        continue
      }
      seen.add(branch.name)
      if (!metaSet.has(branch.name as HistoryEventType)) {
        loadErrors.push({
          code: 'CATALOG_SYNC',
          message: `schema eventType ${JSON.stringify(branch.name)} has no §4/§5 registry metadata (frozen catalog out of sync)`,
        })
      }
      if (branch.version !== 1) {
        loadErrors.push({
          code: 'CATALOG_SYNC',
          message: `schema eventType ${branch.name} declares schemaVersion ${branch.version}; the V1 registry expects 1 (HISTORY_EVENT_CATALOG §1)`,
        })
      }
    }
    for (const name of metaNames) {
      if (!seen.has(name)) {
        loadErrors.push({ code: 'CATALOG_SYNC', message: `§4/§5 metadata for ${name} has no matching oneOf branch in the schema` })
      }
    }
  }

  const eventsById = new Map<string, Branch>()
  for (const branch of branches) if (!eventsById.has(branch.name)) eventsById.set(branch.name, branch)

  const unusable = (eventTypes: readonly HistoryEventType[], events: ReadonlyMap<HistoryEventType, EventRegistryEntry>): HistoryEventRegistry => ({
    schemaDir,
    isUsable: false,
    loadErrors,
    eventTypes,
    events,
    checkShape: () => ({
      ok: false,
      errors: [
        {
          code: 'REGISTRY_UNUSABLE',
          message: `registry is unusable (load errors: ${loadErrors.map((e) => e.code).join(', ')}); see HistoryEventRegistry.loadErrors`,
        },
      ],
    }),
  })

  if (loadErrors.length > 0) return unusable([], new Map())
  if (common === null || events === null || typeof common.$id !== 'string' || typeof events.$id !== 'string') {
    return unusable([], new Map())
  }

  // ---- compile: common + derived events schema (frozen bytes never mutated) --
  const ajv = new Ajv2020({
    allErrors: true, // every violation reported (precise multi-error location)
    strict: false, // consume the frozen schemas exactly as shipped
    verbose: true, // err.data carries the violating value
  })
  addFormats(ajv) // common.schema.json declares date-time/date formats

  try {
    ajv.addSchema(common, common.$id)
  } catch (cause) {
    loadErrors.push({ code: 'SCHEMA_COMPILE', file: commonFile, message: `common.schema.json rejected by validator engine: ${errMsg(cause)}` })
    return unusable([], new Map())
  }

  // Derived copy: the frozen $defs plus one `perEvent_<TYPE>` wrapper per
  // oneOf branch (the VERBATIM branch object). Same $id as the frozen schema
  // so the branches' `../common.schema.json#/$defs/…` refs resolve exactly as
  // they do in the frozen file. The derived schema is the ONLY events schema
  // registered with AJV.
  const derived: RawSchema = { ...events }
  derived.$defs = {
    ...((events.$defs as Record<string, unknown> | undefined) ?? {}),
    ...Object.fromEntries(branches.map((b) => [`perEvent_${b.name}`, b.schema])),
  }
  try {
    ajv.addSchema(derived, events.$id)
  } catch (cause) {
    loadErrors.push({ code: 'SCHEMA_COMPILE', file: eventsFile, message: `derived events schema rejected by validator engine: ${errMsg(cause)}` })
    return unusable([], new Map())
  }

  // Per-event standalone validators (precise errors, no oneOf noise). The
  // per-event $id is fragment-FREE (AJV's 2020-12 meta-validation rejects
  // fragments in $id) and needs no resolution semantics: the schema carries a
  // single full-URI $ref to the derived schema's branch wrapper.
  const baseId = events.$id.replace(/\.json(#.*)?$/, '')
  const validators = new Map<HistoryEventType, ValidateFunction>()
  for (const branch of branches) {
    const type = branch.name as HistoryEventType
    const perEventSchema = {
      $id: `${baseId}/per-event/${branch.name}.schema.json`,
      $ref: `${events.$id}#/$defs/perEvent_${branch.name}`,
    }
    try {
      validators.set(type, ajv.compile(perEventSchema))
    } catch (cause) {
      loadErrors.push({ code: 'SCHEMA_COMPILE', file: eventsFile, message: `per-event validator compile failed for ${branch.name}: ${errMsg(cause)}` })
    }
  }
  if (loadErrors.length > 0) return unusable([], new Map())

  // ---- assemble the 20-row registry (schema order) ------------------------
  const eventTypes: HistoryEventType[] = []
  const entries = new Map<HistoryEventType, EventRegistryEntry>()
  for (const branch of branches) {
    const type = branch.name as HistoryEventType
    const meta = EVENT_METADATA[type]
    if (meta === undefined) continue // unreachable: CATALOG_SYNC ran first
    eventTypes.push(type)
    entries.set(type, {
      eventType: type,
      schemaVersion: branch.version,
      category: meta.category,
      isMutation: meta.isMutation,
      emitters: meta.emitters,
      ownerRule: meta.ownerRule,
      ...(meta.transition !== undefined ? { transition: meta.transition } : {}),
      ...(meta.aggregate !== undefined ? { aggregate: meta.aggregate } : {}),
      semantics: meta.semantics,
    })
  }

  const checkShape: (event: unknown) => ShapeCheck = (event) => {
    if (event === null || typeof event !== 'object' || Array.isArray(event)) {
      return {
        ok: false,
        errors: [{ code: 'ENVELOPE', message: `event must be a JSON object (got ${describeType(event)}) (HISTORY_EVENT_CATALOG §1)` }],
      }
    }
    const candidate = event as Record<string, unknown>
    const type = candidate.eventType
    if (typeof type !== 'string') {
      return {
        ok: false,
        errors: [
          {
            code: 'ENVELOPE',
            path: '/eventType',
            message: `eventType must be a string (got ${describeValue(type)}) (HISTORY_EVENT_CATALOG §1)`,
          },
        ],
      }
    }
    const validator = validators.get(type as HistoryEventType)
    if (validator === undefined) {
      return {
        ok: false,
        errors: [
          {
            code: 'ENVELOPE',
            path: '/eventType',
            message: `unknown eventType ${JSON.stringify(type)} (not one of the ${eventTypes.length} §4 catalog types; INV-HIST-4)`,
          },
        ],
      }
    }
    if (!validator(event)) {
      return { ok: false, errors: (validator.errors ?? []).map(shapeError) }
    }
    return { ok: true, eventType: type as HistoryEventType }
  }

  return { schemaDir, isUsable: true, loadErrors: [], eventTypes, events: entries, checkShape }
}

/* ------------------------------------------------------------------ *
 * AJV error → precise ENVELOPE rejection
 * ------------------------------------------------------------------ */

function shapeError(err: ErrorObject): EventValidationError {
  const params = err.params as Record<string, unknown>
  // `required` errors carry the missing field in params (instancePath is the
  // parent) — surface it in the pointer for precise location.
  let path = err.instancePath === '' ? undefined : err.instancePath
  if (err.keyword === 'required' && typeof params.missingProperty === 'string') {
    path = `${err.instancePath}/${params.missingProperty}`
  }
  return { code: 'ENVELOPE', path, message: summarize(err, params) }
}

function describeValue(value: unknown): string {
  if (value === undefined) return 'undefined'
  try {
    const text = JSON.stringify(value)
    if (text === undefined) return String(value)
    return text.length > 60 ? `${text.slice(0, 57)}…` : text
  } catch {
    return String(value)
  }
}

function describeType(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function summarize(err: ErrorObject, params: Record<string, unknown>): string {
  const got = ` (got ${describeValue(err.data)})`
  switch (err.keyword) {
    case 'required':
      return `missing required property "${String(params.missingProperty ?? '?')}" (HISTORY_EVENT_CATALOG §1/§5)`
    case 'additionalProperties':
      return `unexpected property "${String(params.additionalProperty ?? '?')}"${got} (payload is closed, INV-HIST-4)`
    case 'const':
      return `must equal ${JSON.stringify(params.allowedValue)}${got}`
    case 'enum': {
      const allowed = Array.isArray(params.allowedValues) ? params.allowedValues.map((v) => JSON.stringify(v)).join(' | ') : ''
      return `must be one of [${allowed}]${got}`
    }
    case 'pattern':
      return `must match pattern ${JSON.stringify(params.pattern)}${got}`
    case 'minLength':
      return `must have length >= ${String(params.limit)}${got}`
    case 'maxLength':
      return `must have length <= ${String(params.limit)}${got}`
    case 'minItems':
      return `must have >= ${String(params.limit)} item(s)${got}`
    case 'maxItems':
      return `must have <= ${String(params.limit)} item(s)${got}`
    case 'minimum':
      return `must be >= ${String(params.limit)}${got}`
    case 'maximum':
      return `must be <= ${String(params.limit)}${got}`
    case 'uniqueItems':
      return `must have unique items${got}`
    case 'type':
      return `must be of type ${String(params.type)}${got}`
    case 'format':
      return `invalid ${JSON.stringify(params.format)} value${got}`
    default:
      return `${err.message ?? `failed ${err.keyword}`}${got}`
  }
}

function errMsg(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function compact(value: unknown): string {
  try {
    const text = JSON.stringify(value)
    return text === undefined ? String(value) : text.length > 120 ? `${text.slice(0, 117)}…` : text
  } catch {
    return String(value)
  }
}
