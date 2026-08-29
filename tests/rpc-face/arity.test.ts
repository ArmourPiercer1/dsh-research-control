/**
 * WP-4.1a — RR-006 disposition: one "descriptor parameter face == method
 * signature arity" unit test per RPC (13 RPCs; the 14th, `ping`, is
 * covered too since it shares the same hand-written descriptor pattern).
 *
 * The gateway resolves strict-descriptor params POSITIONALLY in descriptor
 * order (checkout packages/api/gateway/src/index.ts `invoke()`), and the
 * SRC fallback path looks up parameters by method-parameter NAME. Both
 * paths stay correct only while every hand-written descriptor's parameter
 * face matches the actual method signature. This suite pins that
 * invariant for the whole face, so a future method/descriptor edit that
 * drifts (adds a param, renames `args`, changes an arity) fails the build
 * instead of the wire.
 */

import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { ResearchControlService } from '../../src/host/dsh-adapter/host/index.js'
import {
  ALL_RESEARCH_INVOCATIONS,
  REGISTERED_RESEARCH_INVOCATIONS,
  type ResearchRpcMethod,
} from '../../src/shared/rpc-contracts.js'

/** Minimal context double (construction wiring only — mirrors rpc-spike.test.ts). */
function minimalCtx(): Context {
  return {
    reflect: { provide: () => undefined },
    effect: () => ({}),
  } as unknown as Context
}

describe('WP-4.1a RR-006 arity — descriptor parameter face == method signature', () => {
  const svc = new ResearchControlService(minimalCtx(), {})

  it('the descriptor set is exactly ping + the 13 §7.1 RPCs, in order', () => {
    expect(ALL_RESEARCH_INVOCATIONS.map((d) => d.method)).toEqual([
      'ping',
      'getDashboard',
      'getProject',
      'getTopic',
      'getWorkstream',
      'queryHistory',
      'reorderPlan',
      'selectPlanFork',
      'dismissPlanFork',
      'updateInterventionState',
      'registerInteraction',
      'saveResearchCheckpoint',
      'getGitHistory',
      'restoreDeclarativeFile',
    ])
  })

  it('V2-T3.2b + UI-0.4: the REGISTERED face is the frozen 14 + all 9 plane RPCs + the 4 GUI management RPCs (in order)', () => {
    expect(REGISTERED_RESEARCH_INVOCATIONS.map((d) => d.method)).toEqual([
      'ping',
      'getDashboard',
      'getProject',
      'getTopic',
      'getWorkstream',
      'queryHistory',
      'reorderPlan',
      'selectPlanFork',
      'dismissPlanFork',
      'updateInterventionState',
      'registerInteraction',
      'saveResearchCheckpoint',
      'getGitHistory',
      'restoreDeclarativeFile',
      'getResearchPlaneState',
      'getHubOverview',
      'getPortfolioInterventions',
      'setHub',
      'bindProject',
      'unbindProject',
      'restoreProject',
      'rescan',
      'ackMissingReminder',
      'setCurrentFocus',
      'getCurrentFocus',
      'createTopic',
      'createWorkstream',
    ])
  })

  for (const descriptor of REGISTERED_RESEARCH_INVOCATIONS) {
    it(`descriptor parameter face == method signature arity: ${descriptor.method}`, () => {
      const fn = (svc as unknown as Record<string, unknown>)[descriptor.method]
      expect(typeof fn, `service method ${descriptor.method} must exist`).toBe('function')
      const arity = (fn as (...a: unknown[]) => unknown).length
      // The core RR-006 assertion.
      expect(arity, `method ${descriptor.method} arity`).toBe(descriptor.parameters.length)
      // Wire face of the parameter (when present): exactly one JSON param,
      // named and wired `args` (the SRC fallback looks up by method
      // parameter name; the gateway asserts the wire field name).
      for (const p of descriptor.parameters) {
        expect(p.name, `${descriptor.method} parameter name`).toBe('args')
        expect(p.wire, `${descriptor.method} wire field`).toBe('args')
        expect(p.source, `${descriptor.method} parameter source`).toBe('json')
        expect(p.codec.mode, `${descriptor.method} codec mode`).toBe('strict')
      }
      // Zero-param methods (ping + the two zero-arg queries) expose no wire
      // fields at all.
      if (descriptor.parameters.length === 0) {
        const zeroArg = (descriptor.method as ResearchRpcMethod) in {
          ping: true,
          getDashboard: true,
          getProject: true,
        }
        expect(zeroArg, `${descriptor.method} is zero-param and must be one of ping/getDashboard/getProject`).toBe(true)
      }
    })
  }
})
