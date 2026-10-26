/**
 * WP-4.1a — loader `validateTypertManifest` semantics, re-implemented
 * locally for the rpc-face suite.
 *
 * Ported from checkout packages/typert/loader/src/index.ts:89-149
 * (0.2.0-rc.2); error messages condensed, field-level semantics preserved
 * 1:1. This mirror is the suite's fast structural check; the AUTHORITY is
 * the REAL published loader, imported and run against the full face by
 * tests/rpc-face/real-loader.test.ts (0.2.0-rc.2 re-anchor: the npm
 * `@deepseek-ai/dsh-typert-loader` is published and installable — the
 * historical staleness is gone).
 *
 * 0.2 shape changes vs the 0.1 mirror: `manifest.schemas` entries are
 * `{name, create: () => schema}` FACTORIES (the loader requires
 * `typeof create === 'function'`, :111-113) and strict codecs carry
 * `create()` too (:281-283, with optional `decode`/`encode` functions
 * :276-279). The old `_zod`-brand runtime checks no longer exist in the
 * loader — schema validity is decided at boundary decode through the
 * factory, not by manifest duck-typing.
 */

const MEMBER_KINDS = new Set(['property', 'method', 'getter', 'setter', 'call', 'construct', 'index'])

function requireObject(value: unknown, subject: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${subject} must be an object`)
  }
  return value as Record<string, unknown>
}

function requireArray(value: unknown, subject: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${subject} must be an array`)
  return value
}

function requireString(value: Record<string, unknown>, key: string, subject: string): void {
  if (typeof value[key] !== 'string' || (value[key] as string).length === 0) {
    throw new Error(`${subject} has a missing or empty ${key}`)
  }
}

function requireDocumentation(value: Record<string, unknown>, subject: string): void {
  requireArray(value.tags, `${subject}.tags`)
  for (const key of ['description', 'summary', 'jsDoc'] as const) {
    if (value[key] !== undefined && typeof value[key] !== 'string') {
      throw new Error(`${subject}.${key} must be a string`)
    }
  }
}

function requireMembers(value: unknown, subject: string): void {
  for (const item of requireArray(value, `${subject}.members`)) {
    const member = requireObject(item, `${subject} member`)
    requireString(member, 'name', `${subject} member`)
    requireString(member, 'signature', `${subject} member`)
    if (typeof member.kind !== 'string' || !MEMBER_KINDS.has(member.kind)) {
      throw new Error(`${subject} member "${String(member.name)}" has invalid kind`)
    }
  }
}

function requireTypes(value: unknown, subject: string): void {
  for (const item of requireArray(value, `${subject}.types`)) {
    const type = requireObject(item, `${subject} type`)
    requireString(type, 'name', `${subject} type`)
    requireString(type, 'declaration', `${subject} type`)
  }
}

function requireStrictCodec(value: unknown, subject: string): void {
  const codec = requireObject(value, subject)
  if (codec.mode !== 'strict') throw new Error(`${subject} must use a strict codec`)
  requireString(codec, 'typeSymbol', subject)
  // Optional byte codecs: present ⇒ function (loader :276-279).
  for (const method of ['decode', 'encode'] as const) {
    if (codec[method] !== undefined && typeof codec[method] !== 'function') {
      throw new Error(`${subject}.${method} must be a function`)
    }
  }
  if (typeof codec.create !== 'function') {
    throw new Error(`${subject} has no create() factory`)
  }
}

function requireInvocation(value: unknown): void {
  const invocation = requireObject(value, 'invocation')
  for (const key of ['id', 'service', 'namespace', 'method'] as const) {
    requireString(invocation, key, 'invocation')
  }
  const id = invocation.id as string
  const receiver = requireObject(invocation.invocation, `invocation "${id}" receiver`)
  if (receiver.kind === 'context') {
    requireString(receiver, 'context', `invocation "${id}" Context receiver`)
    requireString(receiver, 'wire', `invocation "${id}" Context receiver`)
    requireStrictCodec(receiver.codec, `invocation "${id}" Context codec`)
  } else if (receiver.kind !== 'direct') {
    throw new Error(`invocation "${id}" receiver kind must be "direct" or "context"`)
  }
  const wires = new Set<string>()
  const parameters = new Map<string, Record<string, unknown>>()
  let lookupCount = 0
  for (const valueParameter of requireArray(invocation.parameters, `invocation "${id}" parameters`)) {
    const parameter = requireObject(valueParameter, `invocation "${id}" parameter`)
    requireString(parameter, 'name', `invocation "${id}" parameter`)
    requireString(parameter, 'wire', `invocation "${id}" parameter`)
    const wire = parameter.wire as string
    if (wires.has(wire)) throw new Error(`invocation "${id}" repeats wire field "${wire}"`)
    wires.add(wire)
    if (parameter.source === 'lookup') {
      lookupCount += 1
      requireString(parameter, 'lookup', `invocation "${id}" lookup parameter`)
    } else if (parameter.source === 'json') {
      if (parameter.lookup !== undefined) {
        throw new Error(`invocation "${id}" JSON parameter declares a lookup`)
      }
    } else {
      throw new Error(`invocation "${id}" parameter source must be "json" or "lookup"`)
    }
    parameters.set(wire, parameter)
    requireStrictCodec(parameter.codec, `invocation "${id}" parameter codec`)
  }
  if (invocation.cancellation !== undefined) {
    const cancellation = requireObject(invocation.cancellation, `invocation "${id}" cancellation`)
    if (cancellation.parameter !== 'signal') {
      throw new Error(`invocation "${id}" cancellation parameter must be "signal"`)
    }
  }
  if (invocation.scope !== undefined) {
    if (receiver.kind !== 'direct') {
      throw new Error(`invocation "${id}" Context receiver cannot declare a direct scope projection`)
    }
    const scope = requireObject(invocation.scope, `invocation "${id}" scope`)
    requireString(scope, 'context', `invocation "${id}" scope`)
    requireString(scope, 'wire', `invocation "${id}" scope`)
    const parameter = parameters.get(scope.wire as string)
    if (lookupCount !== 1 || parameter?.source !== 'lookup' || parameter.lookup !== scope.context) {
      throw new Error(`invocation "${id}" scope wire must select its only lookup parameter`)
    }
  }
  if (receiver.kind === 'context' && wires.has(receiver.wire as string)) {
    throw new Error(`invocation "${id}" repeats Context wire field "${String(receiver.wire)}"`)
  }
  requireStrictCodec(invocation.result, `invocation "${id}" result codec`)
  if (invocation.sourceLocation !== undefined) {
    const location = requireObject(invocation.sourceLocation, `invocation "${id}" sourceLocation`)
    requireString(location, 'file', `invocation "${id}" sourceLocation`)
    for (const key of ['line', 'column'] as const) {
      if (!Number.isInteger(location[key]) || (location[key] as number) < 1) {
        throw new Error(`invocation "${id}" sourceLocation.${key} must be a positive integer`)
      }
    }
  }
}

/** Mirror of the loader's validateTypertManifest (packages/typert/loader/src/index.ts:83). */
export function validateTypertManifest(pkgName: string, exported: unknown): void {
  if (typeof exported !== 'object' || exported === null) {
    throw new Error(`${pkgName} module has no TYPERT manifest object`)
  }
  const manifest = exported as Record<string, unknown>
  if (manifest.package !== pkgName) {
    throw new Error(`${pkgName} TYPERT manifest is not owned by the exporting package`)
  }
  if (manifest.face !== 'host') {
    throw new Error(`${pkgName} TYPERT.face is not "host"`)
  }
  for (const value of requireArray(manifest.schemas, 'TYPERT.schemas')) {
    const schema = requireObject(value, 'schema')
    requireString(schema, 'name', 'schema')
    // 0.2 loader: the entry is a {name, create} FACTORY — a bare schema
    // value object (the 0.1 shape) fails exactly here (loader :111-113).
    if (typeof schema.create !== 'function') {
      throw new Error(`TYPERT schema "${String(schema.name)}" has no create() factory`)
    }
  }
  const model = requireObject(manifest.model, 'TYPERT.model')
  const services = requireArray(model.services, 'TYPERT.model.services')
  const events = requireArray(model.events, 'TYPERT.model.events')
  const objects = requireArray(model.objects, 'TYPERT.model.objects')
  for (const value of services) {
    const service = requireObject(value, 'service')
    requireDocumentation(service, 'service')
    requireString(service, 'key', 'service')
    requireString(service, 'exportName', 'service')
    requireMembers(service.members, `service "${String(service.key)}"`)
    requireTypes(service.types, `service "${String(service.key)}"`)
  }
  for (const value of events) {
    const event = requireObject(value, 'event')
    requireDocumentation(event, 'event')
    requireString(event, 'name', 'event')
    requireString(event, 'signature', `event "${String(event.name)}"`)
    if (event.mode !== undefined && typeof event.mode !== 'string') {
      throw new Error(`event "${String(event.name)}" mode must be a string`)
    }
  }
  for (const value of objects) {
    const object = requireObject(value, 'object')
    requireDocumentation(object, 'object')
    requireString(object, 'name', 'object')
    requireString(object, 'exportName', 'object')
    requireMembers(object.members, `object "${String(object.name)}"`)
    requireTypes(object.types, `object "${String(object.name)}"`)
  }
  for (const value of requireArray(manifest.invocations, 'TYPERT.invocations')) {
    requireInvocation(value)
  }
}
