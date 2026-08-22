/**
 * Client mount half for the research remotes (WP-0.3 RPC spike).
 *
 * Chosen form (per WP-0.3 brief, option 2): `mountResearchRemotes(ctx)` is
 * a plain function the WP-0.5 client entry calls from its own `apply` —
 * the entry (a functional client plugin) declares `'remote'` in its own
 * `inject` list, so its fiber waits for the gateway's `remote` service
 * before this runs (DSH_ADAPTER §4 PENDING semantics). A separate
 * name/inject/apply plugin form was rejected: it would nest a child plugin
 * fiber purely for a one-call mount, and the entry already owns the inject
 * declaration.
 *
 * Disposer semantics (gateway client half, checkout
 * packages/api/gateway/src/client/index.ts `$mount`): the mount is
 * registered as an effect on the CALLER's own fiber
 * (`callerCtx.effect(...)`), so fiber unmount rolls the mount back
 * automatically — the installed `researchControl` namespace service is
 * uninstalled and the remote contribution withdrawn. The returned
 * `TypertDisposer` is only needed for an explicit early unmount before the
 * fiber goes away; the WP-0.5 entry may hold or discard it.
 *
 * This file is client-dsh-adapter territory: it may import
 * `@deepseek-ai/*` (INV-PERM-5 exempt set).
 */

import type { Context } from '@deepseek-ai/cordis'
import type {
  RemoteResult,
  TypertClientRemote,
  TypertDisposer,
} from '@deepseek-ai/dsh-typert-protocol'
import type { PingResult } from '../../../shared/rpc-contracts.js'
import { researchRemotes } from './contribution.js'

/**
 * Structural stand-in for the gateway client's `remote` service: the base
 * layer's d.ts (dsh-api-gateway `./client`) augments the cordis Context
 * with `remote: ClientRemote` (ClientRemote = TypertClientRemote); this WP
 * deliberately does not devDep on that package, so the property is declared
 * here. The `researchControl` namespace member is typed through the
 * `TypertRemoteNamespaceMap` module augmentation in `contribution.ts`.
 * The WP-0.5 client entry passes its own (fully injected) context against
 * this type.
 */
export type RemoteContext = Context & { remote: TypertClientRemote }

/** Facade binding; set by `mountResearchRemotes`, cleared by `unmountResearchRemotes`. */
let boundRemote: TypertClientRemote | undefined

/**
 * Mount the research contribution in `ctx`'s fiber and bind the
 * `researchRpc` facade. The returned disposer withdraws the exact
 * contribution; see the module header for fiber-owned rollback.
 */
export async function mountResearchRemotes(ctx: RemoteContext): Promise<TypertDisposer> {
  boundRemote = ctx.remote
  return await ctx.remote.$mount(researchRemotes)
}

/** Drop the facade binding (the fiber's own rollback is unaffected). */
export function unmountResearchRemotes(): void {
  boundRemote = undefined
}

/**
 * Typed client RPC facade over the mounted namespace methods.
 *
 * The call surface is exactly the generated remote-client signature for a
 * direct descriptor with no cancellation: `namespace.ping()` resolving to
 * `RemoteResult<PingResult>` (the carrier folds host-side failures into the
 * `ok: false` branch; only assembly faults reject). There is deliberately
 * NO signal parameter: the ping descriptor declares no `cancellation`, and
 * the gateway client rejects a trailing argument for such descriptors
 * (arity check in client/src/client/index.ts `invoke()`; the generator
 * emits `signal?: AbortSignal` only when cancellation is declared).
 */
export const researchRpc = {
  ping(): Promise<RemoteResult<PingResult>> {
    if (boundRemote === undefined) {
      return Promise.reject(
        new Error('researchRpc: not mounted — call mountResearchRemotes(ctx) first'),
      )
    }
    return boundRemote.researchControl.ping()
  },
}
