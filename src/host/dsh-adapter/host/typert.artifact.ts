/**
 * Hand-written `./typert` host-face artifact (WP-0.3 RPC spike).
 *
 * U4 fallback (STATUS E009): the typert generator cannot run in this
 * workspace (npm registry is stale at 0.0.1-rc.1; the harness checkout has
 * no node_modules), so this module mirrors the shape of the generated
 * `lib/typert.host.{js,d.ts}` by hand: a named `TYPERT` export of the
 * contribution manifest. The `dsh-typert-loader` imports `./typert`,
 * validates `mod.TYPERT` field-by-field (`validateTypertManifest`,
 * checkout packages/typert/loader/src/index.ts:83-142) and registers the
 * contribution into `ctx.typert`; tests/rpc-spike.test.ts replicates those
 * rules.
 *
 * Type note: the whole-manifest type is the LOCAL `TypertContributionMirror`
 * (registry package stale/uninstallable) — 以 loader 运行时校验为准. The
 * `invocations` field is deliberately typed with the REAL protocol
 * `InvocationDescriptor`: that structural check proves the shared
 * hand-written descriptor stays identical to what the gateway dispatch
 * consumes.
 *
 * This file is host-dsh-adapter territory: it may import `@deepseek-ai/*`
 * (INV-PERM-5 exempt set).
 */

import type { InvocationDescriptor } from '@deepseek-ai/dsh-typert-protocol'
import {
  PingResultSchema,
  RESEARCH_CONTROL_PACKAGE,
  pingInvocation,
  type TypertContributionMirror,
} from '../../../shared/rpc-contracts.js'

/**
 * The host-face `TYPERT` manifest (mirror of the registry `TypertContribution`;
 * the loader's runtime validation is the authority).
 */
export interface TypertHostManifest extends Omit<TypertContributionMirror, 'face' | 'invocations'> {
  readonly face: 'host'
  /** Real protocol type: cross-checks the shared mirror at the module boundary. */
  readonly invocations: readonly InvocationDescriptor[]
}

export const TYPERT: TypertHostManifest = {
  package: RESEARCH_CONTROL_PACKAGE,
  face: 'host',
  schemas: [
    { name: 'PingResult', schema: PingResultSchema },
  ],
  invocations: [pingInvocation],
  model: {
    services: [
      {
        key: 'researchControl',
        exportName: 'ResearchControlService',
        description: 'Research Control Plane host service (WP-0.3: ping spike only).',
        tags: [],
        members: [
          {
            name: 'ping',
            signature: 'ping(): Promise<PingResult>',
            kind: 'method',
          },
        ],
        types: [
          {
            name: 'PingResult',
            declaration:
              'interface PingResult { readonly ok: true; readonly service: "researchControl"; readonly time: number }',
          },
        ],
      },
    ],
    events: [],
    objects: [],
  },
}
