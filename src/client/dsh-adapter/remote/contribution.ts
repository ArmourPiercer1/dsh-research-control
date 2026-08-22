/**
 * Client-side `./remote` artifact (WP-0.3 RPC spike).
 *
 * U4 fallback (STATUS E009): hand-written twin of the generated
 * `lib/typert.remote-client.{js,d.ts}` — same module shape (named
 * `TYPERT_REMOTE` + default export), so the client half stays a drop-in
 * for a future generator-produced artifact. Consumed by
 * `ctx.remote.$mount(contribution)` (DSH_ADAPTER §5): the gateway client
 * installs the `researchControl` namespace service in the CALLER's fiber.
 *
 * The `declare module` block below mirrors what the generated
 * remote-client d.ts emits (checkout packages/typert/generator/src/
 * emitter.ts renderRemoteDts): it merges our endpoint into the protocol's
 * merge-extensible maps, which is what types `ctx.remote.researchControl`
 * for consumers. The namespace interface name follows the generator's
 * grammar `TypertRemoteNamespace$<utf8-hex(namespace)>`.
 *
 * This file is client-dsh-adapter territory: it may import
 * `@deepseek-ai/*` (INV-PERM-5 exempt set).
 */

import type {
  RemoteResult,
  TypertRemoteContribution,
} from '@deepseek-ai/dsh-typert-protocol'
import {
  PingResult,
  RESEARCH_CONTROL_PACKAGE,
  pingInvocation,
} from '../../../shared/rpc-contracts.js'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteMap {
    'researchControl/ping': () => Promise<RemoteResult<PingResult>>
  }

  interface TypertRemoteNamespaceMap {
    researchControl: TypertRemoteNamespace$726573656172636f6e74726f6c
  }

  /** Mounted namespace methods for `researchControl` (generator-named interface). */
  interface TypertRemoteNamespace$726573656172636f6e74726f6c {
    ping: () => Promise<RemoteResult<PingResult>>
  }
}

/**
 * The research contribution: the client half of the `./typert` manifest.
 * `descriptors` is the SAME object as `TYPERT.invocations` on the host
 * face (shared `pingInvocation`), strict result codec included.
 */
export const researchRemotes: TypertRemoteContribution = {
  package: RESEARCH_CONTROL_PACKAGE,
  descriptors: [pingInvocation],
}

export default researchRemotes
