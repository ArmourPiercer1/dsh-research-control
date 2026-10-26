/**
 * 0.2.0-rc.2 re-anchor — REAL-consumer face validation for the hand-written
 * typert artifacts.
 *
 * The historical suite mirrored `validateTypertManifest` locally (the npm
 * loader was stale/uninstallable). At 0.2.0-rc.2 the loader is published
 * (`@deepseek-ai/dsh-typert-loader@0.2.0-rc.2`), so this suite drops the
 * "mirror is the authority" stance: the mirror in
 * `tests/rpc-face/loader-validation.ts` stays as a fast structural check,
 * but the AUTHORITY here is the real published code:
 *
 *  1. `validateTypertManifest(pkgName, mod.TYPERT)` — the exact call the
 *     real loader makes on our `./typert` export
 *     (checkout packages/typert/loader/src/index.ts:89, applied :374);
 *  2. `TypertRegistry.register(contribution)` — the exact registration the
 *     loader performs into `ctx.typert` after validation
 *     (checkout packages/typert/registry/src/service.ts:500);
 *  3. the BUILT artifacts (`lib/typert.host.js`, `lib/typert.remote-client.js`)
 *     — imported as the host would import them (build must run first; the
 *     test skips loudly, never silently, when `lib/` is absent).
 *
 * The 0.2 shape contract pinned here (falsifiable both ways):
 *  - `TYPERT.schemas` entries are `{name, create: () => schema}` factories —
 *    a bare 0.1 schema-value entry MUST be rejected by the real loader;
 *  - strict codecs carry `create()` too — a 0.1 `{schema}` codec MUST be
 *    rejected;
 *  - the registered face is exactly 59 invocations, schemas count 115,
 *    and every `create()` materializes the shared live zod instance.
 */
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { validateTypertManifest } from '@deepseek-ai/dsh-typert-loader'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry'
import { describe, expect, it } from 'vitest'
import { TYPERT } from '../../src/host/dsh-adapter/host/typert.artifact.js'
import {
  RESEARCH_CONTROL_PACKAGE,
  REGISTERED_RESEARCH_INVOCATIONS,
} from '../../src/shared/rpc-contracts.js'

/** The built release tree (produced by `pnpm run build` → tsdown). */
const LIB = join(__dirname, '..', '..', 'lib')
const LIB_READY = existsSync(join(LIB, 'typert.host.js'))

/** The real loader's manifest ownership name — our package. */
const PKG = RESEARCH_CONTROL_PACKAGE

describe('0.2 REAL loader — validateTypertManifest against the source TYPERT', () => {
  it('accepts the hand-written host manifest (59 invocations survive the real loader)', () => {
    // The real loader returns the validated manifest; a throw IS the failure.
    const validated = validateTypertManifest(PKG, TYPERT)
    expect(validated.face).toBe('host')
    expect(validated.package).toBe(PKG)
    expect(validated.invocations).toHaveLength(59)
    expect(REGISTERED_RESEARCH_INVOCATIONS).toHaveLength(59)
    expect(validated.invocations.map((d) => d.method)).toEqual(
      REGISTERED_RESEARCH_INVOCATIONS.map((d) => d.method),
    )
  })

  it('every 0.2 schema entry and strict codec is a working create() factory', () => {
    const validated = validateTypertManifest(PKG, TYPERT)
    expect(validated.schemas).toHaveLength(115)
    for (const entry of validated.schemas) {
      const schema = entry.create()
      expect(typeof schema.parse, `schema "${entry.name}" factory materializes a parser`).toBe('function')
      expect(schema).toBe((TYPERT.schemas.find((s) => s.name === entry.name))?.create())
    }
    for (const invocation of validated.invocations) {
      const result = invocation.result
      expect(result.mode).toBe('strict')
      if (result.mode === 'strict') {
        expect(typeof result.create().parse).toBe('function')
        // Identity discipline: repeated factory calls return the SAME instance.
        expect(result.create()).toBe(result.create())
      }
      for (const parameter of invocation.parameters) {
        if (parameter.codec.mode === 'strict') {
          expect(typeof parameter.codec.create().parse).toBe('function')
        }
      }
    }
  })

  it('NEGATIVE — the 0.1 schema-value manifest entry is rejected by the real loader', () => {
    const stale = {
      ...TYPERT,
      schemas: [{ name: 'PingResult', schema: (TYPERT.schemas[0] as unknown as { create(): unknown }).create() }],
    }
    expect(() => validateTypertManifest(PKG, stale)).toThrow(/has no create\(\) factory/)
  })

  it('NEGATIVE — the 0.1 schema-value strict codec is rejected by the real loader', () => {
    const first = REGISTERED_RESEARCH_INVOCATIONS[0]!
    const staleCodec = {
      ...TYPERT,
      invocations: [
        {
          ...first,
          result: {
            mode: 'strict',
            typeSymbol: first.result.mode === 'strict' ? first.result.typeSymbol : 'x',
            schema: first.result.mode === 'strict' ? first.result.create() : {},
          },
        },
      ],
    }
    expect(() => validateTypertManifest(PKG, staleCodec)).toThrow(/has no create\(\) factory/)
  })
})

describe('0.2 REAL registry — ctx.typert.register consumes the validated manifest', () => {
  it('registers the host face into a live TypertRegistry (schema records materialize)', async () => {
    const ctx = new Context()
    await ctx.plugin(TypertRegistry)
    // The loader's exact sequence: validate, then register what survived.
    const contribution = validateTypertManifest(PKG, TYPERT)
    const dispose = ctx.typert.register(contribution as unknown as TypertContribution)
    const record = ctx.typert.get(`${PKG}#PingResult`)
    expect(record, 'PingResult schema record').toBeDefined()
    expect(typeof record!.schema.parse).toBe('function')
    expect(ctx.typert.list().some((r) => r.name === 'PingResult')).toBe(true)
    dispose()
    await ctx.fiber.dispose()
  })
})

describe('0.2 BUILT artifacts — the same face through real module imports', () => {
  it.skipIf(!LIB_READY)('lib/typert.host.js passes the real loader with 59 invocations', async () => {
    if (!LIB_READY) throw new Error('lib/ missing — run `pnpm run build` first')
    const mod = (await import(pathToFileURL(join(LIB, 'typert.host.js')).href)) as {
      TYPERT?: unknown
      default?: { TYPERT?: unknown }
    }
    const built = mod.TYPERT ?? mod.default?.TYPERT
    expect(built, 'built ./typert exports TYPERT').toBeDefined()
    const validated = validateTypertManifest(PKG, built)
    expect(validated.invocations).toHaveLength(59)
    expect(validated.schemas).toHaveLength(115)
    const ctx = new Context()
    await ctx.plugin(TypertRegistry)
    const dispose = ctx.typert.register(validated as unknown as TypertContribution)
    expect(typeof ctx.typert.get(`${PKG}#PingResult`)?.schema.parse).toBe('function')
    dispose()
    await ctx.fiber.dispose()
  })

  it.skipIf(!LIB_READY)('lib/typert.remote-client.js carries the same 59-descriptor face', async () => {
    if (!LIB_READY) throw new Error('lib/ missing — run `pnpm run build` first')
    const mod = (await import(pathToFileURL(join(LIB, 'typert.remote-client.js')).href)) as {
      default?: { package: string; descriptors: Array<{ method: string }> }
      package?: string
      descriptors?: Array<{ method: string }>
    }
    const contribution = mod.default ?? mod
    expect(contribution.package).toBe(PKG)
    const methods = contribution.descriptors?.map((d) => d.method) ?? []
    expect(methods).toEqual(REGISTERED_RESEARCH_INVOCATIONS.map((d) => d.method))
  })
})

if (!LIB_READY) {
  // Loud, never silent: the built-artifact checks are part of this face.
  console.warn('[real-loader] lib/ not built — built-artifact face checks SKIPPED; run `pnpm run build`')
}
