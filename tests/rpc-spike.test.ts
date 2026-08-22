/**
 * WP-0.3 — structural tests for the ping RPC spike (host method + hand-written
 * typert artifacts + client mount half).
 *
 * Scope (per WP-0.3 brief):
 * ① the `@Remote('ping')` marker is readable off a live service instance
 *    (markers attach via class initializers, so an instance is required —
 *    the minimal context double mirrors tests/host-mount.test.ts; NO cordis
 *    App is started, fiber/gateway runtime stays WP-0.5/WP-0.6);
 * ② the `TYPERT` manifest passes a local re-implementation of the loader's
 *    `validateTypertManifest` field-by-field rules — the npm
 *    `@deepseek-ai/dsh-typert-loader` is stale (0.0.1-rc.1, uninstallable)
 *    and deliberately NOT imported; the mirror is copied from the host repo
 *    checkout (packages/typert/loader/src/index.ts:83-276, rc.8), plus
 *    negative probes proving the mirror rejects corrupted manifests;
 * ③ host manifest and client contribution descriptors are the same contract
 *    (same object, same strict zod schema parses the same fixture);
 * ④ the contribution's package ownership;
 * ⑤ the mount module's exported surface, including facade behavior
 *    pre-mount and the `$mount` wiring against a fake `remote` service.
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  isTypertRemoteSegment,
  remoteMethods,
  type TypertCodec,
} from '@deepseek-ai/dsh-typert-protocol'
import { describe, expect, it } from 'vitest'
import { ResearchControlService } from '../src/host/dsh-adapter/host/index.js'
import { TYPERT } from '../src/host/dsh-adapter/host/typert.artifact.js'
import { researchRemotes } from '../src/client/dsh-adapter/remote/contribution.js'
import {
  mountResearchRemotes,
  researchRpc,
  unmountResearchRemotes,
  type RemoteContext,
} from '../src/client/dsh-adapter/remote/mount.js'
import {
  PingResult,
  PingResultSchema,
  RESEARCH_CONTROL_PACKAGE,
  pingInvocation,
} from '../src/shared/rpc-contracts.js'

// ---------------------------------------------------------------------------
// ② — loader `validateTypertManifest` semantics, re-implemented locally.
// Ported from checkout packages/typert/loader/src/index.ts:83-276 (rc.8);
// error messages condensed, field-level semantics preserved 1:1.
// ---------------------------------------------------------------------------

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
  if (
    typeof codec.schema !== 'object'
    || codec.schema === null
    || !('_zod' in (codec.schema as Record<string, unknown>))
    || typeof (codec.schema as { parse?: unknown }).parse !== 'function'
  ) {
    throw new Error(`${subject} is not backed by a zod v4 schema`)
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
function validateTypertManifest(pkgName: string, exported: unknown): void {
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
    if (
      typeof schema.schema !== 'object'
      || schema.schema === null
      || !('_zod' in (schema.schema as Record<string, unknown>))
    ) {
      throw new Error(`TYPERT schema "${String(schema.name)}" is not a zod v4 schema instance`)
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

// ---------------------------------------------------------------------------

/** The ping fixture both artifact faces must parse through their strict schema. */
const fixture: PingResult = { ok: true, service: 'researchControl', time: 1755000000000 }

/** Narrow a descriptor codec to its strict arm (the brief fixes every codec here to strict). */
function strictCodec(codec: TypertCodec): Extract<TypertCodec, { mode: 'strict' }> {
  if (codec.mode !== 'strict') throw new Error(`expected strict codec, got ${codec.mode}`)
  return codec
}

/** Minimal context double (construction wiring only — mirrors host-mount.test.ts). */
function minimalCtx(): Context {
  return {
    reflect: { provide: () => undefined },
    effect: () => ({}),
  } as unknown as Context
}

describe('WP-0.3 ping RPC spike', () => {
  it('① @Remote("ping") marks the method as a direct Remote invocation', () => {
    // Markers attach in class initializers, so a live instance is required;
    // the double covers the Service constructor wiring only.
    const svc = new ResearchControlService(minimalCtx(), {})
    expect(remoteMethods(svc)).toEqual([{ method: 'ping', invocation: { kind: 'direct' } }])
    // Same key as the wire namespace (DSH_ADAPTER §5 step 1).
    expect(svc.typertRemote.serviceKey).toBe('researchControl')
    expect(svc.typertRemote.namespace).toBe('researchControl')
  })

  it('②a TYPERT passes the mirrored loader validation (validateTypertManifest semantics)', () => {
    expect(() => validateTypertManifest(RESEARCH_CONTROL_PACKAGE, TYPERT)).not.toThrow()
  })

  it('②b TYPERT satisfies every loader field rule the brief enumerates', () => {
    // package / face
    expect(TYPERT.package).toBe(RESEARCH_CONTROL_PACKAGE)
    expect(TYPERT.face).toBe('host')
    // schemas: entries carry a name and a live zod v4 instance (the `_zod` brand)
    expect(Array.isArray(TYPERT.schemas)).toBe(true)
    const [schemaEntry] = TYPERT.schemas
    expect(schemaEntry.name).toBe('PingResult')
    expect('_zod' in schemaEntry.schema).toBe(true)
    // model: services entry carries the loader-required key/exportName/members/tags
    const [service] = TYPERT.model.services
    expect(TYPERT.model.events).toEqual([])
    expect(TYPERT.model.objects).toEqual([])
    expect(service.key).toBe('researchControl')
    expect(service.exportName).toBe('ResearchControlService')
    expect(Array.isArray(service.tags)).toBe(true)
    const [member] = service.members
    expect(member.name).toBe('ping')
    expect(typeof member.signature).toBe('string')
    expect(MEMBER_KINDS.has(member.kind)).toBe(true)
    for (const type of service.types) {
      expect(typeof type.name).toBe('string')
      expect(typeof type.declaration).toBe('string')
    }
    // invocation: id/service/namespace/method, direct receiver, strict result codec
    const [invocation] = TYPERT.invocations
    for (const key of ['id', 'service', 'namespace', 'method'] as const) {
      expect(typeof invocation[key]).toBe('string')
      expect((invocation[key] as string).length).toBeGreaterThan(0)
    }
    expect(invocation.invocation).toEqual({ kind: 'direct' })
    expect(invocation.parameters).toEqual([])
    const resultCodec = strictCodec(invocation.result)
    expect(resultCodec.typeSymbol).toBe('PingResult')
    expect('_zod' in resultCodec.schema).toBe(true)
    expect(resultCodec.schema.parse(fixture)).toEqual(fixture)
    // wire segment grammar (the endpoint must survive the shared RPC carrier)
    expect(isTypertRemoteSegment(invocation.namespace)).toBe(true)
    expect(isTypertRemoteSegment(invocation.method)).toBe(true)
  })

  it.each([
    ['manifest owned by another package', { package: 'other-package' }],
    ['client face', { face: 'client' }],
    ['schema without the zod v4 brand', { schemas: [{ name: 'PingResult', schema: { parse: () => undefined } }] }],
    ['service member with invalid kind', {
      model: {
        services: [{
          key: 'researchControl',
          exportName: 'ResearchControlService',
          tags: [],
          members: [{ name: 'ping', signature: 'ping(): Promise<PingResult>', kind: 'function' }],
          types: [],
        }],
        events: [],
        objects: [],
      },
    }],
    ['invocation missing namespace', { invocations: [{ ...pingInvocation, namespace: '' }] }],
    ['result codec not strict', { invocations: [{ ...pingInvocation, result: { mode: 'src-json' } }] }],
    [
      'parameter source lookup without lookup key',
      {
        invocations: [
          {
            ...pingInvocation,
            parameters: [
              { name: 'x', wire: 'x', source: 'lookup', codec: { mode: 'strict', typeSymbol: 'PingResult', schema: PingResultSchema } },
            ],
          },
        ],
      },
    ],
    ['cancellation parameter not signal', { invocations: [{ ...pingInvocation, cancellation: { parameter: 'abort' } }] }],
    [
      'duplicate parameter wire fields',
      {
        invocations: [
          {
            ...pingInvocation,
            parameters: [
              { name: 'a', wire: 'w', source: 'json', codec: { mode: 'strict', typeSymbol: 'PingResult', schema: PingResultSchema } },
              { name: 'b', wire: 'w', source: 'json', codec: { mode: 'strict', typeSymbol: 'PingResult', schema: PingResultSchema } },
            ],
          },
        ],
      },
    ],
  ])('②c the mirrored loader validation rejects %s', (_label, patch) => {
    expect(() => validateTypertManifest(RESEARCH_CONTROL_PACKAGE, { ...TYPERT, ...patch })).toThrow()
  })

  it('③ client descriptors and manifest invocations are the same strict contract', () => {
    expect(researchRemotes.descriptors).toHaveLength(1)
    // Both faces re-export the shared descriptor object — no drift by construction.
    expect(researchRemotes.descriptors[0]).toBe(pingInvocation)
    expect(TYPERT.invocations[0]).toBe(pingInvocation)
    expect(researchRemotes.descriptors[0]).toEqual(TYPERT.invocations[0])
    // The host manifest's named schema entry is the same zod instance the
    // strict result codec carries.
    expect(TYPERT.schemas[0].schema).toBe(PingResultSchema)
    expect(strictCodec(researchRemotes.descriptors[0].result).schema).toBe(PingResultSchema)
    // The same fixture parses through both the shared schema and the
    // descriptor's strict codec.
    expect(PingResultSchema.parse(fixture)).toEqual(fixture)
    expect(strictCodec(researchRemotes.descriptors[0].result).schema.parse(fixture)).toEqual(fixture)
    expect(strictCodec(TYPERT.invocations[0].result).schema.parse(fixture)).toEqual(fixture)
    // And the strict schema rejects an off-contract value.
    expect(() => PingResultSchema.parse({ ...fixture, ok: false })).toThrow()
  })

  it('④ the contribution is owned by the research-control package', () => {
    expect(researchRemotes.package).toBe('dsh-research-control')
  })

  it('⑤ the mount module exposes the expected surface and a loud pre-mount failure', async () => {
    expect(typeof mountResearchRemotes).toBe('function')
    expect(typeof unmountResearchRemotes).toBe('function')
    expect(researchRpc).toBeTypeOf('object')
    expect(typeof researchRpc.ping).toBe('function')
    unmountResearchRemotes()
    await expect(researchRpc.ping()).rejects.toThrow(/not mounted/)
  })

  it('⑤b mounting binds the facade to the mounted namespace method', async () => {
    const calls: string[] = []
    const fakeRemote = {
      $mount: async (contribution: unknown) => {
        expect(contribution).toBe(researchRemotes)
        return async () => undefined
      },
      researchControl: {
        ping: async () => {
          calls.push('ping')
          return { ok: true, value: fixture } as const
        },
      },
    }
    const dispose = await mountResearchRemotes({ remote: fakeRemote } as unknown as RemoteContext)
    expect(typeof dispose).toBe('function')
    const result = await researchRpc.ping()
    expect(result).toEqual({ ok: true, value: fixture })
    expect(calls).toEqual(['ping'])
    await dispose()
    unmountResearchRemotes()
  })
})
