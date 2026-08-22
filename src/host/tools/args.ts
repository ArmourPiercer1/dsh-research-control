/**
 * Wire-boundary argument parsing for the agent tool face (WP-3.3).
 *
 * The host `defineTool` derives a JSON Schema from each tool's `parameters`
 * and validates model args BEFORE `execute` (DSH_ADAPTER §10.1) — but the
 * plugin must be self-contained (tests call `execute` directly; a future
 * code-mode SDK dispatch is another wire): every handler therefore re-checks
 * the SAME face here, at the wire boundary, with precise `/path` locations.
 * All violations throw `ToolError('TOOL_INPUT')`.
 *
 * The faces mirror the FROZEN schemas field-for-field (the host JSON Schema
 * derived from `parameters` and this parser must never diverge — the test
 * suite pins both sides).
 */

import { ToolError } from './types.js'

/** Construct one TOOL_INPUT violation with a JSON-pointer path. */
export function inputError(path: string, message: string): ToolError {
  return new ToolError('TOOL_INPUT', `${path}: ${message}`)
}

/** Join a (possibly empty) parent pointer with a key into a full path. */
function joinPath(base: string, key: string): string {
  return base === '' ? `/${key}` : `${base}/${key}`
}

/** The args must be a plain JSON object (arrays/nulls/primitives refused). */
export function assertArgsObject(args: unknown, toolName: string): Record<string, unknown> {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    throw inputError('/', `arguments must be a JSON object (tool ${toolName})`)
  }
  return args as Record<string, unknown>
}

/**
 * The object's key set must equal the frozen parameter key set (the
 * `additionalProperties: false` semantics of the host-derived schema).
 * `base` is the parent JSON pointer ('' at the top level). A `base*` key
 * on a tool that names `baseViolationNote` gets the INV-PLAN-6-specific
 * message (the base is server-recomputed, never input).
 */
export function checkKeySet(
  obj: Record<string, unknown>,
  allowedKeys: readonly string[],
  context: string,
  base = '',
  baseViolationNote?: (key: string) => string | null,
): void {
  for (const key of Object.keys(obj)) {
    if (!(allowedKeys as readonly string[]).includes(key)) {
      const note = baseViolationNote?.(key) ?? null
      if (note !== null) {
        throw new ToolError('TOOL_INPUT', `${joinPath(base, key)}: ${note}`)
      }
      throw inputError(joinPath(base, key), `unknown argument (frozen face for ${context}: [${allowedKeys.join(', ')}])`)
    }
  }
}

/** A required key must be present (value shape checked by the caller). */
export function requireKey(obj: Record<string, unknown>, key: string, context: string, base = ''): void {
  if (obj[key] === undefined) {
    throw inputError(joinPath(base, key), `missing required argument (frozen face for ${context})`)
  }
}

/** A present value must be a string (optionally non-empty). */
export function assertString(value: unknown, path: string, nonEmpty = false): string {
  if (typeof value !== 'string') {
    throw inputError(path, `expected a string, got ${jsonType(value)}`)
  }
  if (nonEmpty && value.length === 0) {
    throw inputError(path, 'must be a non-empty string')
  }
  return value
}

/** An optional string key: `undefined` passes, anything else must be a non-empty string. */
export function assertOptionalString(
  obj: Record<string, unknown>,
  key: string,
  base = '',
): string | undefined {
  const value = obj[key]
  if (value === undefined) return undefined
  return assertString(value, joinPath(base, key), true)
}

/** A present value must be a non-empty string array (frozen `string[]` faces). */
export function assertStringArray(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value)) {
    throw inputError(path, `expected an array of strings, got ${jsonType(value)}`)
  }
  for (let i = 0; i < value.length; i += 1) {
    assertString(value[i], `${path}/${i}`, true)
  }
  return value as readonly string[]
}

/** An optional string-array key. */
export function assertOptionalStringArray(
  obj: Record<string, unknown>,
  key: string,
  base = '',
): readonly string[] | undefined {
  const value = obj[key]
  if (value === undefined) return undefined
  return assertStringArray(value, joinPath(base, key))
}

/** A present value must be one of the frozen enum values (returns the narrowed member). */
export function assertEnum<T extends readonly string[]>(value: unknown, path: string, values: T): T[number] {
  const s = assertString(value, path)
  if (!(values as readonly string[]).includes(s)) {
    throw inputError(path, `expected one of [${values.join(', ')}], got ${JSON.stringify(s)}`)
  }
  return s as T[number]
}

/** A present value must be an integer within the bounds. */
export function assertInteger(value: unknown, path: string, bounds?: { min?: number; max?: number }): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw inputError(path, `expected an integer, got ${JSON.stringify(value)}`)
  }
  if (bounds?.min !== undefined && value < bounds.min) {
    throw inputError(path, `must be >= ${bounds.min}`)
  }
  if (bounds?.max !== undefined && value > bounds.max) {
    throw inputError(path, `must be <= ${bounds.max}`)
  }
  return value
}

/** An optional integer key within the bounds. */
export function assertOptionalInteger(
  obj: Record<string, unknown>,
  key: string,
  bounds?: { min?: number; max?: number },
): number | undefined {
  const value = obj[key]
  if (value === undefined) return undefined
  return assertInteger(value, `/${key}`, bounds)
}

/** A present value must be a plain object (for element-wise parsing). */
export function assertObject(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw inputError(path, `expected an object, got ${jsonType(value)}`)
  }
  return value as Record<string, unknown>
}

/** A present value must be an array (for element-wise parsing). */
export function assertArray(value: unknown, path: string, minItems = 0): unknown[] {
  if (!Array.isArray(value)) {
    throw inputError(path, `expected an array, got ${jsonType(value)}`)
  }
  if (value.length < minItems) {
    throw inputError(path, `must have at least ${minItems} item(s)`)
  }
  return value
}

/** The JSON type name for error messages (`null`/`array`/`object`/…). */
function jsonType(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}
