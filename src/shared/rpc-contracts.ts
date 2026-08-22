/**
 * Shared RPC wire contracts for the Research Control Plane's Typert
 * artifacts (WP-0.3 ping spike).
 *
 * Single source of truth for the ping wire shape: the host `./typert`
 * manifest (`src/host/dsh-adapter/host/typert.artifact.ts`) and the client
 * `./remote` contribution (`src/client/dsh-adapter/remote/contribution.ts`)
 * are both built from the exports here so the two faces cannot drift.
 *
 * Dependency rule (ARCHITECTURE.md §2.2 rule 2 / INV-PERM-5, lint-enforced):
 * this file is pure TS types plus zod schemas and must NOT import any
 * `@deepseek-ai/*` package. zod is not a DSH package — it is the codec
 * backend for strict typert codecs: the registry stores live zod v4 schema
 * instances and the loader duck-checks them via the `_zod` brand.
 *
 * The `*Mirror` interfaces below re-declare the Typert protocol types
 * (npm `@deepseek-ai/dsh-typert-protocol` 0.1.0-rc.8 `lib/types/types.d.ts`)
 * and the registry manifest types (checkout `packages/typert/registry/src/types.ts`)
 * because this file cannot import those packages. The host and client
 * artifact files re-attach the REAL protocol types at their export
 * boundaries — tsc's structural check there keeps every mirror honest.
 */

import { z } from 'zod'

/** npm package name owning both artifact faces; the loader requires manifest.package to match it. */
export const RESEARCH_CONTROL_PACKAGE = 'dsh-research-control'

/** Wire namespace of the Research Control service (`TypertRemoteService` super key). */
export const RESEARCH_CONTROL_NAMESPACE = 'researchControl'

/**
 * Result of the ping RPC spike. `time` is the host wall-clock at ping
 * moment in **epoch milliseconds (UTC)**: a plain JSON number, unambiguous
 * across time zones (DSH_ADAPTER §5 step 3: pure JSON DTOs only).
 */
export interface PingResult {
  readonly ok: true
  readonly service: typeof RESEARCH_CONTROL_NAMESPACE
  readonly time: number
}

/**
 * Strict codec schema for `PingResult` (zod v4 instance — carries the `_zod`
 * brand the loader and the gateway's strict path require).
 */
export const PingResultSchema = z.object({
  ok: z.literal(true),
  service: z.literal(RESEARCH_CONTROL_NAMESPACE),
  time: z.number(),
})

/**
 * Structural mirror of the protocol `TypertSchema` (the minimal runtime
 * capability a strict codec schema must carry).
 */
export interface TypertSchemaLike {
  parse(value: unknown): unknown
}

/** Structural mirror of the protocol `TypertCodec` union. */
export type TypertCodecMirror =
  | { readonly mode: 'strict'; readonly typeSymbol: string; readonly schema: TypertSchemaLike }
  | { readonly mode: 'src-json' }

/** Structural mirror of the protocol `InvocationParameterDescriptor`. */
export interface InvocationParameterMirror {
  readonly name: string
  readonly wire: string
  readonly source: 'json' | 'lookup'
  readonly lookup?: string
  readonly codec: TypertCodecMirror
  readonly acceptsUndefined?: true
}

/**
 * Structural mirror of the protocol `InvocationDescriptor`
 * (types.d.ts:140-178, field-for-field).
 */
export interface InvocationDescriptorMirror {
  readonly id: string
  readonly service: string
  readonly namespace: string
  readonly method: string
  readonly implementation?: string
  readonly invocation:
    | { readonly kind: 'direct' }
    | { readonly kind: 'context'; readonly context: string; readonly wire: string; readonly codec: TypertCodecMirror }
  readonly scope?: { readonly context: string; readonly wire: string }
  readonly parameters: readonly InvocationParameterMirror[]
  readonly cancellation?: { readonly parameter: 'signal' }
  readonly result: TypertCodecMirror
  readonly sourceLocation?: { readonly file: string; readonly line: number; readonly column: number }
}

/** Structural mirror of the registry `TypertDocTag`. */
export interface TypertDocTagMirror {
  readonly name: string
  readonly argument?: string
  readonly comment?: string
  readonly text: string
}

interface TypertDocumentationMirror {
  readonly description?: string
  readonly summary?: string
  readonly tags: readonly TypertDocTagMirror[]
  readonly jsDoc?: string
}

/** Structural mirror of the registry `TypertMemberModel`. */
export interface TypertMemberModelMirror {
  readonly kind: 'property' | 'method' | 'getter' | 'setter' | 'call' | 'construct' | 'index'
  readonly name: string
  readonly signature: string
  readonly summary?: string
  readonly jsDoc?: string
}

/** Structural mirror of the registry `TypertTypeModel`. */
export interface TypertTypeModelMirror {
  readonly name: string
  readonly declaration: string
}

/** Structural mirror of the registry `TypertServiceModel`. */
export interface TypertServiceModelMirror extends TypertDocumentationMirror {
  readonly key: string
  readonly exportName: string
  readonly members: readonly TypertMemberModelMirror[]
  readonly types: readonly TypertTypeModelMirror[]
}

/** Structural mirror of the registry `TypertEventModel`. */
export interface TypertEventModelMirror extends TypertDocumentationMirror {
  readonly name: string
  readonly mode?: string
  readonly signature: string
}

/** Structural mirror of the registry `TypertObjectModel`. */
export interface TypertObjectModelMirror extends TypertDocumentationMirror {
  readonly name: string
  readonly exportName: string
  readonly members: readonly TypertMemberModelMirror[]
  readonly types: readonly TypertTypeModelMirror[]
}

/** Structural mirror of the registry `TypertPackageModel`. */
export interface TypertPackageModelMirror {
  readonly services: readonly TypertServiceModelMirror[]
  readonly events: readonly TypertEventModelMirror[]
  readonly objects: readonly TypertObjectModelMirror[]
}

/** Structural mirror of the registry `TypertSchema`. */
export interface TypertSchemaMirror {
  readonly name: string
  readonly schema: TypertSchemaLike
}

/**
 * Structural mirror of the registry `TypertContribution` (the `TYPERT`
 * manifest object a `./typert` module must export).
 */
export interface TypertContributionMirror {
  readonly package: string
  readonly face: 'host' | 'client'
  readonly schemas: readonly TypertSchemaMirror[]
  readonly model: TypertPackageModelMirror
  readonly invocations: readonly InvocationDescriptorMirror[]
}

/**
 * The ping invocation descriptor shared by both artifact faces.
 *
 * `id` follows the generator's invocation-identity grammar
 * (`<serviceKey>#<namespace>/<exportedMethod>`,
 * checkout packages/typert/generator/src/analyzer.ts:1111). No
 * `cancellation`/`sourceLocation`: the spike method takes no parameters
 * (DSH_ADAPTER §5 step 4 applies to long-running RPCs, not ping), and a
 * hand-written source location would rot — the field is optional in both
 * the protocol type and the loader.
 */
export const pingInvocation: InvocationDescriptorMirror = {
  id: `${RESEARCH_CONTROL_NAMESPACE}#${RESEARCH_CONTROL_NAMESPACE}/ping`,
  service: RESEARCH_CONTROL_NAMESPACE,
  namespace: RESEARCH_CONTROL_NAMESPACE,
  method: 'ping',
  invocation: { kind: 'direct' },
  parameters: [],
  result: { mode: 'strict', typeSymbol: 'PingResult', schema: PingResultSchema },
}
