/**
 * R3 (reviewer final ruling) — the investigator preset declaration rides
 * the bundle's companion `@deepseek-ai/dsh-agent-preset` row, whose
 * `static inject = ['agentPresets']` makes cordis's dependency graph the
 * declaration's real lifecycle:
 *
 *  - registry appears LATE (loader runs concurrently, this plugin first) →
 *    the companion row simply activates after the registry exists;
 *  - registry unloaded / RELOADED → the row reactivates with the new
 *    generation and re-declares — persisted investigator sessions stay
 *    resumable with NO new launch (resume leg =
 *    `session-controller/src/agent.ts → composeAgent → presets.resolve(saved)`).
 *
 * This suite pins the two things that are OURS:
 *  1. LOCKSTEP — the patch `config` equals `investigatorPresetDefinition()`
 *     field-for-field (a drift here means the declared composition is no
 *     longer the closed read-only set the launcher audits);
 *  2. MECHANISM — registering exactly the parsed patch config into the
 *     REAL pinned roster makes the RESUME-LEG resolve succeed before any
 *     launch, across a generation replacement (dispose → re-register),
 *     while the launcher's own gate still refuses foreign content.
 *
 * Deadlock discipline (agent-preset-registry/src/index.ts:117-134): the
 * companion row only registers during activation; resolve/list run here
 * only after `loader.await()` (resume is user-triggered, never startup).
 */
import { afterAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { Context } from '@deepseek-ai/cordis'
import { default as TypertRegistry } from '@deepseek-ai/dsh-typert-registry'
import { default as PluginLoader } from '@deepseek-ai/cordis-plugin-loader'
import { default as SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { default as AgentPresetRegistry } from '@deepseek-ai/dsh-agent-preset-registry'

import { INVESTIGATOR_PRESET_ID } from '../../src/host/service/investigator/index.js'
import { investigatorPresetDefinition } from '../../src/host/service/investigator/preset.js'

type Roster = {
  resolve(id?: string): Promise<{ id: string; broken?: string }>
  list(): Promise<readonly { id: string }[]>
  register(definition: unknown): Promise<() => Promise<void>>
}

/** The companion row exactly as `@deepseek-ai/dsh-agent-preset` consumes it. */
function companionPatchConfig(): {
  id: string
  name?: string
  description?: string
  order?: number
  plugins: readonly { id?: string; name: string; config?: unknown }[]
} {
  const text = readFileSync(join(__dirname, '../../cordis.patch.yml'), 'utf8')
  const rows = parse(text) as Array<{ insert?: Array<Record<string, unknown>> }>
  const row = rows
    .flatMap((patchRow) => patchRow.insert ?? [])
    .find((entry) => entry['name'] === '@deepseek-ai/dsh-agent-preset')
  if (row === undefined) throw new Error('cordis.patch.yml carries no @deepseek-ai/dsh-agent-preset companion row')
  expect(row['id']).toBe('research-investigator-preset')
  return row['config'] as never
}

async function bootRealRoster() {
  const ctx = new Context()
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(PluginLoader)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentPresetRegistry, { default: 'standard' })
  const roster = ctx.get('agentPresets') as Roster
  return { ctx, roster }
}

let h: Awaited<ReturnType<typeof bootRealRoster>> | undefined

afterAll(async () => {
  await h?.ctx.fiber.dispose()
  h = undefined
})

describe('R3 — companion preset row (patch lockstep + real-roster lifecycle)', () => {
  it('LOCKSTEP: the patch config equals investigatorPresetDefinition() field-for-field', () => {
    const patch = companionPatchConfig()
    const definition = investigatorPresetDefinition()
    expect(patch.id).toBe(definition.id)
    expect(patch.name).toBe(definition.name)
    expect(patch.description).toBe(definition.description)
    // rows: id/name (+ the one audited config key) in closed order
    expect(patch.plugins.map((row) => row.name)).toEqual(definition.plugins.map((row) => row.name))
    expect(patch.plugins.map((row) => row.id)).toEqual(definition.plugins.map((row) => row.id))
    expect(patch.plugins.map((row) => row.config)).toEqual(definition.plugins.map((row) => row.config))
  })

  it('registry appears late → row activates after it: resume-leg resolve succeeds with NO launch', async () => {
    h = await bootRealRoster()
    // The companion row's init, verbatim: register(own config), nothing else.
    const lease = await h.roster.register(companionPatchConfig())
    // Loader settlement (the activation audit) completes before any resume.
    await h.ctx.root.loader?.await?.()
    const resolved = await h.roster.resolve(INVESTIGATOR_PRESET_ID)
    expect(resolved.id).toBe(INVESTIGATOR_PRESET_ID)
    // `broken` here, if present, can only be "waiting for tools, shell,
    // systemPrompt, …" — the minimal 4-service context never provides the
    // host-app services the TOOL ROWS inject. It is never a declaration
    // defect, and the resume-leg only needs the declaration PRESENT.
    // (The full unbroken activation is proven positively in
    // investigator-lifecycle.test.ts with the app-like service set.)
    expect((await h.roster.list()).map((row) => row.id)).toContain(INVESTIGATOR_PRESET_ID)
    await lease()
  })

  it('registry generation replacement: the next generation re-declares (stale latch cannot swallow it)', async () => {
    const run = await bootRealRoster()
    try {
      const generation1 = await run.roster.register(companionPatchConfig())
      await run.ctx.root.loader?.await?.()
      expect((await run.roster.list()).map((r) => r.id)).toContain(INVESTIGATOR_PRESET_ID)

      // Registry row unload/reload: the generation's lease ends → row gone.
      await generation1()
      await expect(run.roster.resolve(INVESTIGATOR_PRESET_ID)).rejects.toMatchObject({
        code: 'agent-preset/not-found',
      })

      // The reload reactivates the companion row → a FRESH register of the
      // same patch config (the inject graph re-runs the row — no plugin
      // instance state is involved, so no stale latch can suppress it).
      const generation2 = await run.roster.register(companionPatchConfig())
      const resolved = await run.roster.resolve(INVESTIGATOR_PRESET_ID)
      expect(resolved.id).toBe(INVESTIGATOR_PRESET_ID)
      await generation2()
    } finally {
      await run.ctx.fiber.dispose()
    }
  })

  it('foreign content under our id is refused by the launcher gate anyway (declaration ≠ trust)', async () => {
    const run = await bootRealRoster()
    try {
      const foreign = companionPatchConfig()
      const tampered = JSON.parse(JSON.stringify(foreign)) as ReturnType<typeof companionPatchConfig>
      ;(tampered.plugins as unknown as Array<Record<string, unknown>>).push({
        id: 'tool-fs',
        name: '@deepseek-ai/dsh-tool-fs',
      })
      const lease = await run.roster.register(tampered)
      await run.ctx.root.loader?.await?.()
      // The launcher re-parses the registry-held document at launch
      // (resolveOrEnsure → readDocument → parsePresetComposition). The
      // closed-set parser is the gate — exercised directly here on the
      // DOCUMENT TEXT the roster actually mounts:
      const rosterWithDoc = run.roster as unknown as { readDocument?(id: string): Promise<{ content: string }> }
      expect(typeof rosterWithDoc.readDocument).toBe('function')
      const doc = await rosterWithDoc.readDocument!(INVESTIGATOR_PRESET_ID)
      const { parsePresetComposition } = await import('../../src/host/service/investigator/preset.js')
      expect(() => parsePresetComposition(INVESTIGATOR_PRESET_ID, doc.content)).toThrow()
      await lease()
    } finally {
      await run.ctx.fiber.dispose()
    }
  })
})
