/**
 * WP-4.1a — build-artifact verification: the built `lib/typert.host.js`
 * and `lib/typert.remote-client.js` must carry the FULL 14-endpoint
 * descriptor face (all 13 §7.1 RPCs + ping).
 *
 * `lib/` is a build product (gitignored): run `pnpm run build` before the
 * test suite (the standard four-piece order: tsc → lint → build → test).
 * Without a fresh build this file fails loud rather than skipping.
 *
 * The bundle re-creates the descriptor objects (they do not survive as
 * shared references), so the assertions are structural: id/method/arity/
 * codec shape + live zod result codecs + package/face/members.
 */

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  RESEARCH_CONTROL_PACKAGE,
  RESEARCH_RPC_INVOCATIONS,
  RESEARCH_RPC_METHODS,
} from '../../src/shared/rpc-contracts.js'

const libDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'lib')
const hostArtifact = join(libDir, 'typert.host.js')
const clientArtifact = join(libDir, 'typert.remote-client.js')

const METHODS = ['ping', ...RESEARCH_RPC_METHODS]

describe('WP-4.1a build artifacts — the full 14-endpoint descriptor face', () => {
  it('the build artifacts exist (run `pnpm run build` before the suite)', () => {
    for (const p of [hostArtifact, clientArtifact]) {
      expect(existsSync(p), `missing ${p} — run \`pnpm run build\``).toBe(true)
    }
  })

  it('lib/typert.host.js TYPERT carries all 13 RPC descriptors + ping', async () => {
    const mod = (await import(hostArtifact)) as {
      TYPERT: {
        package: string
        face: string
        schemas: readonly { name: string; schema: unknown }[]
        invocations: readonly {
          id: string
          service: string
          namespace: string
          method: string
          parameters: readonly unknown[]
          result: { mode: string; schema: unknown }
        }[]
        model: {
          services: readonly {
            key: string
            members: readonly { name: string }[]
          }[]
        }
      }
    }
    const t = mod.TYPERT
    expect(t.package).toBe(RESEARCH_CONTROL_PACKAGE)
    expect(t.face).toBe('host')
    expect(t.invocations.map((i) => i.method)).toEqual(METHODS)
    // Structural match against the src descriptors: id + arity per method.
    for (const src of RESEARCH_RPC_INVOCATIONS) {
      const built = t.invocations.find((i) => i.method === src.method)
      expect(built, `built descriptor for ${src.method}`).toBeDefined()
      expect(built!.id).toBe(src.id)
      expect(built!.namespace).toBe('researchControl')
      expect(built!.parameters).toHaveLength(src.parameters.length)
      // The bundled result codec is a live zod v4 instance (strict).
      expect(built!.result.mode).toBe('strict')
      expect('_zod' in (built!.result.schema as object), `${src.method} result codec zod brand`).toBe(true)
    }
    expect(t.schemas).toHaveLength(25)
    const [service] = t.model.services
    expect(service.key).toBe('researchControl')
    expect(service.members.map((m) => m.name)).toEqual(METHODS)
  })

  it('lib/typert.remote-client.js researchRemotes carries the same 14 descriptors', async () => {
    const mod = (await import(clientArtifact)) as {
      default: {
        package: string
        descriptors: readonly {
          id: string
          method: string
          parameters: readonly unknown[]
          result: { mode: string; schema: unknown }
        }[]
      }
    }
    const remotes = mod.default
    expect(remotes.package).toBe(RESEARCH_CONTROL_PACKAGE)
    expect(remotes.descriptors.map((d) => d.method)).toEqual(METHODS)
    for (const src of RESEARCH_RPC_INVOCATIONS) {
      const built = remotes.descriptors.find((d) => d.method === src.method)
      expect(built, `built client descriptor for ${src.method}`).toBeDefined()
      expect(built!.id).toBe(src.id)
      expect(built!.parameters).toHaveLength(src.parameters.length)
      expect(built!.result.mode).toBe('strict')
      expect('_zod' in (built!.result.schema as object), `${src.method} client result codec zod brand`).toBe(true)
    }
  })
})
