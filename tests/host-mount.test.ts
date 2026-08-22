/**
 * WP-0.2 — structural tests for the host mount skeleton.
 *
 * Scope (per WP-0.2 brief): import the source entry and assert the service
 * form structurally — default export is a class, `static inject` deep-equals
 * the four hard dependencies, `static Config` is an object schema (the
 * standard-schema V1 contract that cordis' loader consumes), and
 * `[Service.init]` is an async method readable off the prototype.
 *
 * NO cordis App is started here: fiber PENDING/LOADING semantics (inject
 * resolution, effect disposal ordering) are real-machine verifications owned
 * by WP-0.6. The stub-construction probe below exercises the Service
 * constructor wiring only (registration key + ctx.effect ownership) with a
 * minimal context double — still not the runtime.
 */
import { Service, type Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import hostEntry from '../src/host/index.js'
import { ResearchControlService } from '../src/host/dsh-adapter/host/index.js'

describe('host mount skeleton (WP-0.2)', () => {
  it('default-exports the service class through the host entry (pure assembly)', () => {
    expect(typeof hostEntry).toBe('function')
    // src/host/index.ts is assembly-only: it must re-export the exact same
    // constructor object, not a wrapper.
    expect(hostEntry).toBe(ResearchControlService)
    expect(hostEntry.name).toBe('ResearchControlService')
  })

  it('declares the four hard inject dependencies (DSH_ADAPTER §4 verbatim)', () => {
    expect(hostEntry.inject).toEqual(['sessions', 'tools', 'subagents', 'workspaceRegistry'])
  })

  it('declares static Config as an object schema (standard-schema V1)', async () => {
    const config = hostEntry.Config
    expect(config).toBeDefined()
    // schemastery schemas are callable; "object schema" means the described
    // type is object (s.object), not that typeof is "object".
    expect(config.type).toBe('object')
    // cordis' resolveConfig() consumes the standard-schema V1 surface:
    expect(typeof config['~standard']).toBe('object')
    expect(typeof config['~standard'].validate).toBe('function')
    // Config carries the WP-2.6 `minDshVersion` field (schemastery, default
    // `0.1.0-rc.8`): validating an empty config resolves the default.
    const result = (await Promise.resolve(config['~standard'].validate({}))) as
      | { value: unknown; issues?: never }
      | { issues: readonly unknown[]; value?: never }
    expect((result as { issues?: readonly unknown[] }).issues).toBeUndefined()
    expect((result as { value: unknown }).value).toEqual({ minDshVersion: '0.1.0-rc.8' })
  })

  it('implements [Service.init] as an async own method on the prototype', () => {
    const proto = hostEntry.prototype
    const init = (proto as unknown as Record<symbol, unknown>)[Service.init]
    expect(Object.hasOwn(proto, Service.init)).toBe(true)
    expect(typeof init).toBe('function')
    expect((init as { constructor: { name: string } }).constructor.name).toBe('AsyncFunction')
  })

  it('registers as researchControl with a typert gateway binding and one ctx.effect', () => {
    // Minimal context double — construction wiring only, NOT the cordis App.
    const provided: Array<{ name: string; value: unknown }> = []
    const effectBodies: Array<() => unknown> = []
    const ctx = {
      reflect: {
        provide: (name: string, value: unknown) => {
          provided.push({ name, value })
        },
      },
      effect: (execute: () => unknown) => {
        effectBodies.push(execute)
        return {}
      },
    } as unknown as Context

    const svc = new hostEntry(ctx, {})

    expect(svc.name).toBe('researchControl')
    expect(provided).toEqual([{ name: 'researchControl', value: svc }])
    // TypertRemoteService binds the same key as wire namespace (DSH_ADAPTER §5 step 1)
    expect(svc.typertRemote.serviceKey).toBe('researchControl')
    expect(svc.typertRemote.namespace).toBe('researchControl')
    // constructor owns exactly one ctx.effect (teardown placeholder)
    expect(effectBodies).toHaveLength(1)
    const disposer = effectBodies[0]()
    expect(typeof disposer).toBe('function')
  })
})
