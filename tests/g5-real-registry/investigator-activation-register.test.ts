/**
 * R3 (review P1 regression) — the investigator preset declaration is
 * ACTIVATION-owned, not launch-lazy.
 *
 * The pinned host resumes persisted sessions through
 * `session-controller/src/agent.ts → composeAgent → presets.resolve(savedPreset)`
 * — a resolve WITHOUT any new launch. With the 0.2 memory-only roster, a
 * cold start / plugin reload therefore has to re-declare the preset at
 * activation, or every persisted investigator session fails to reopen
 * until some OTHER new launch happens to register it (the regression this
 * suite locks out).
 *
 * Deadlock discipline (agent-preset-registry/src/index.ts:117-134 — the
 * activation audit awaits loader settlement): eager registration is
 * REGISTER-ONLY inside activation; resolve/list run only AFTER the loader
 * settled (mirroring resume, which is user-triggered, never startup).
 */
import { afterAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { default as TypertRegistry } from '@deepseek-ai/dsh-typert-registry'
import { default as PluginLoader } from '@deepseek-ai/cordis-plugin-loader'
import { default as SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { default as AgentPresetRegistry } from '@deepseek-ai/dsh-agent-preset-registry'

import { HostAgentLauncherAdapter } from '../../src/host/dsh-adapter/launcher/index.js'
import { INVESTIGATOR_PRESET_ID } from '../../src/host/service/investigator/index.js'

async function bootRealRoster() {
  const ctx = new Context()
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(PluginLoader)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentPresetRegistry, { default: 'standard' })
  const roster = ctx.get('agentPresets') as {
    resolve(id?: string): Promise<{ id: string; broken?: string }>
    list(): Promise<readonly { id: string }[]>
    register(definition: unknown): Promise<() => Promise<void>>
  }
  const effects: Array<() => Promise<void>> = []
  const patched = {
    get: (name: string) => (ctx as unknown as { get(n: string): unknown }).get(name),
    effect: async (execute: () => unknown, label?: string) => {
      void label
      const produced = (await (execute as () => unknown)()) as (() => Promise<void> | void) | void
      let done = false
      const dispose = async () => {
        if (done) return
        done = true
        await (typeof produced === 'function' ? produced() : undefined)
      }
      effects.push(dispose)
      return dispose
    },
  }
  return {
    ctx,
    roster,
    adapter: () => new HostAgentLauncherAdapter(patched as never),
    async disposeEffects() {
      for (const d of [...effects].reverse()) await d()
      effects.length = 0
    },
    async dispose() {
      await this.disposeEffects()
      await ctx.fiber.dispose()
    },
  }
}

let h: Awaited<ReturnType<typeof bootRealRoster>> | undefined

afterAll(async () => {
  await h?.dispose()
  h = undefined
})

describe('R3 — activation-owned preset declaration (resume works before any new launch)', () => {
  it('cold deployment: activation declares the preset; a RESUME-style resolve (no launch) finds it', async () => {
    h = await bootRealRoster()
    const adapter = h.adapter()

    // Activation seam (what [Service.init] must do): register-only, no resolve/list.
    await adapter.declarePresetAtActivation()

    // loader settles (activation audit completes) — resume happens later than this.
    await h.ctx.root.loader?.await?.()

    // THE regression assertion: composeAgent's resume leg (`presets.resolve(id)`)
    // succeeds on a cold deployment WITHOUT any new launch ever having run.
    const resolved = await h.roster.resolve(INVESTIGATOR_PRESET_ID)
    expect(resolved.id).toBe(INVESTIGATOR_PRESET_ID)
    expect((await h.roster.list()).map((row) => row.id)).toContain(INVESTIGATOR_PRESET_ID)
  })

  it('duplicate winner unloads → the survivor re-acquires (latch follows the REAL roster, not a wish)', async () => {
    const run = await bootRealRoster()
    try {
      // Winner: our own activation declaration, disposed (the reload/uninstall
      // of the row's owner — e.g. a second plugin instance losing the race).
      await run.adapter().declarePresetAtActivation()
      await run.ctx.root.loader?.await?.()
      expect((await run.roster.list()).map((r) => r.id)).toContain(INVESTIGATOR_PRESET_ID)

      await run.disposeEffects() // winner's lease ends → roster forgets the row
      await expect(run.roster.resolve(INVESTIGATOR_PRESET_ID)).rejects.toMatchObject({
        code: 'agent-preset/not-found',
      })

      // A SURVIVING instance (same adapter object, stale latch state from the
      // disposal) must recover: a re-declaration makes it resolvable again.
      const survivor = run.adapter()
      await survivor.declarePresetAtActivation()
      const resolved = await run.roster.resolve(INVESTIGATOR_PRESET_ID)
      expect(resolved.id).toBe(INVESTIGATOR_PRESET_ID)
    } finally {
      await run.dispose()
    }
  })

  it('no roster at activation → silent no-op (the plugin stays loadable; launch still fails loud later)', async () => {
    const ctx = new Context()
    const patched = { get: () => undefined, effect: async () => async () => {} }
    const adapter = new HostAgentLauncherAdapter(patched as never)
    await expect(adapter.declarePresetAtActivation()).resolves.toBe('no-roster')
  })
})
