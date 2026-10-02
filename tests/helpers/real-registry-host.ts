/**
 * G5 — the REAL tool-registry acceptance harness.
 *
 * What is REAL here (the layer the earlier host seams did NOT have):
 *  - `@deepseek-ai/cordis` `Context` — the actual pinned root context
 *    (real reflect / events / effect / fiber machinery, no Proxy double);
 *  - `@deepseek-ai/dsh-tools` `ToolRuntime` — the ACTUAL host tool
 *    registry the pinned DSH harness mounts as `ctx.tools`. The 11
 *    research tools are registered through `ToolRuntime.register`
 *    (the real `assertSupportedJsonSchema` registration gate runs on
 *    every output schema) and every call goes through
 *    `ToolRuntime.execute` → the real dispatch pipeline → the REAL
 *    output validator (`validateJsonSchemaValue` on the success value,
 *    failures folded as `ToolOutputError` / `INVALID_TOOL_OUTPUT`) and
 *    the real `output.render` projection into content blocks;
 *  - `ResearchControlService` — the real plugin host service, real
 *    `[Service.init]`, real discovery over temp workspaces, real git
 *    repos, real `research.sqlite` (node:sqlite), real frozen schemas;
 *  - the USER lanes driven through REAL production services
 *    (`RunBindingService.registerRun`, `ProductionResearchRpcServices`).
 *
 * What is SIMULATED (host-owned faces the pinned packages do not ship
 * standalone — exactly the DSH_ADAPTER test seam, disclosed in
 * docs/TOOLS_TRACEABILITY.md):
 *  - `systemPrompt` — a minimal service object with the three members
 *    `ToolRuntime` reads (`.tools(cb)` registers the wire-schema
 *    provider; native mode never renders a prompt);
 *  - `workspaceRegistry.list()` — returns the mounted workspace paths
 *    (in production the DSH app owns this list);
 *  - `sessions.list()` — empty list (the session-query reader's live
 *    face; no live sessions in tests);
 *  - `exec.agent` — the plain `{ sessionId }` carrier. ToolRuntime
 *    treats `exec.agent` as an opaque scope token; the plugin reads
 *    ONLY `.sessionId` (the same resolution the production host does).
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import { ToolRuntime, type ToolExecutionInput } from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'

import { ResearchControlService } from '../../src/host/dsh-adapter/host/index.js'
import { ProductionResearchRpcServices } from '../../src/host/dsh-adapter/host/rpc-services.js'
import type { HostWiring } from '../../src/host/service/wiring/index.js'
import { serializeRegistry } from '../../src/host/domain/registry/index.js'
import { makeFile } from '../registry/fixtures.js'
import { initGitRepo, writeResearchTree } from '../wiring/helpers.js'

/* ------------------------------------------------------------------ *
 * Content-block/result shapes (the registry's dispatched result face)
 * ------------------------------------------------------------------ */

export interface DispatchedResult {
  isError: boolean
  value?: unknown
  content: readonly unknown[]
  error?: { message: string; info?: { name: string; code?: string } }
}

/* ------------------------------------------------------------------ *
 * Temp plumbing (same convention as tests/discovery/host-*)
 * ------------------------------------------------------------------ */

const roots: string[] = []

export function g5TempDir(prefix = 'g5-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

/** Let the startup integrity gate's async git checks settle, then remove
 *  every registered temp root (host-* convention). Call in `afterAll`. */
export async function g5CleanupAll(): Promise<void> {
  await new Promise((r) => setTimeout(r, 500))
  for (const r of roots) rmSync(r, { recursive: true, force: true })
}

function freshDshHome(): string {
  const home = g5TempDir('g5-home-')
  process.env['DSH_HOME'] = home
  return home
}

/** A valid single-project plane: hub + registered tree (PRJ-1). */
export function g5Plane(): { hubPath: string; wsPath: string } {
  freshDshHome()
  const wsPath = g5TempDir('g5-ws-')
  writeResearchTree(wsPath)
  initGitRepo(wsPath)
  const hubPath = g5TempDir('g5-hub-')
  const hubDir = join(hubPath, '.research-control')
  mkdirSync(hubDir, { recursive: true })
  const entry = {
    id: 'PRJ-1',
    path: wsPath,
    displayName: 'G5 真实 registry 验收',
    status: 'active' as const,
    boundAt: 1770000000000,
    archivedAt: null,
  }
  writeFileSync(join(hubDir, 'registry.yaml'), serializeRegistry(makeFile([entry])), 'utf8')
  return { hubPath, wsPath }
}

/* ------------------------------------------------------------------ *
 * The harness
 * ------------------------------------------------------------------ */

export interface RealRegistryHarness {
  readonly svc: ResearchControlService
  /** The REAL registry instance (dsh-tools `ToolRuntime`). */
  readonly runtime: ToolRuntime
  readonly workspacePaths: readonly string[]
  /** Live PRJ-1 wiring (throws when the plane is gone). */
  wiring(): HostWiring
  /** The production RPC (USER) lane over the CURRENT live wiring.
   *  Lazily constructed once per wiring; closed on dispose. */
  rpc(): ProductionResearchRpcServices
  callTool(
    name: string,
    args: unknown,
    opts?: { readonly sessionId?: string; readonly callId?: string },
  ): Promise<DispatchedResult>
  dispose(): Promise<void>
}

let callSeq = 0

export async function bootRealRegistryHarness(workspacePaths?: readonly string[]): Promise<RealRegistryHarness> {
  const paths = workspacePaths ?? (() => {
    const { hubPath, wsPath } = g5Plane()
    return [hubPath, wsPath]
  })()

  // REAL cordis root context (built-in reflect/events/registry/logger).
  const root = new Context()

  // SIMULATED (disclosed): the host-owned systemPrompt service — only
  // the faces ToolRuntime touches under mode:'native' exist.
  root.provide('systemPrompt', {
    tools: (_cb: unknown) => ({ dispose: (): void => {} }),
    section: (_s: unknown) => ({ dispose: (): void => {} }),
    getSectionOrder: (_name: string) => 0,
  })

  // THE REAL REGISTRY — the exact dsh-tools service the DSH host mounts.
  const runtime = new ToolRuntime(root, { mode: 'native' })

  // Child context carrying the (documented) host-side faces + an
  // effect-shadow so tests can dispose exactly what the plugin
  // registered (production: the fiber unmount does this).
  const disposers: Array<() => unknown> = []
  const realEffect = root.effect.bind(root)
  const child = root.extend({
    workspaceRegistry: { list: () => paths.map((path) => ({ path })) },
    sessions: { list: () => [] },
    effect: (execute: () => unknown, label?: string): unknown => {
      const disposer = (realEffect as (e: () => unknown, l?: string) => () => unknown)(execute, label)
      disposers.push(disposer)
      return disposer
    },
  })

  const svc = new ResearchControlService(child, { minDshVersion: '0.1.0-rc.8' })
  const init = (ResearchControlService.prototype as unknown as Record<symbol, unknown>)[
    Service.init
  ] as (this: ResearchControlService) => Promise<void>
  await init.call(svc)

  let rpc: ProductionResearchRpcServices | undefined
  let rpcWiring: HostWiring | undefined

  const harness: RealRegistryHarness = {
    svc,
    runtime,
    workspacePaths: paths,
    wiring() {
      const map = (svc as unknown as { projectWirings?: Map<string, HostWiring> }).projectWirings
      const w = map?.get('PRJ-1')
      if (w === undefined) throw new Error('no PRJ-1 wiring on the plane (harness broken)')
      return w
    },
    rpc() {
      const w = harness.wiring()
      if (rpc !== undefined && rpcWiring === w) return rpc
      rpc?.close()
      rpc = new ProductionResearchRpcServices({ wiring: w, schemaRoot: w.schemaRoot })
      rpcWiring = w
      return rpc
    },
    async callTool(name, args, opts = {}) {
      const exec: ToolExecutionInput = {
        callId: ToolCallId(opts.callId ?? `g5-call-${(callSeq += 1)}`),
        name,
        arguments: args,
        signal: new AbortController().signal,
        ...(opts.sessionId !== undefined ? { agent: { sessionId: opts.sessionId } as unknown as ToolExecutionInput['agent'] } : {}),
      }
      return (await runtime.execute(exec)) as DispatchedResult
    },
    async dispose() {
      rpc?.close()
      rpc = undefined
      // Reverse registration order (cordis fiber convention).
      for (const d of disposers.reverse()) {
        try {
          await d()
        } catch {
          /* best effort — teardown must not fail the test */
        }
      }
      disposers.length = 0
    },
  }
  return harness
}

/* ------------------------------------------------------------------ *
 * Assertion helpers over the REAL dispatched results
 * ------------------------------------------------------------------ */

/** Assert the registry-dispatched result SUCCEEDED (the registry itself
 *  ran the real output validator over `value` and the real renderer
 *  over `content` — a success here IS the codec-acceptance proof). */
export function expectDispatchOk(result: DispatchedResult, label: string): Record<string, unknown> {
  if (result.isError !== false) {
    throw new Error(
      `${label}: expected a registry-validated SUCCESS, got isError=true error=${JSON.stringify(result.error)}`,
    )
  }
  if (result.value === undefined) throw new Error(`${label}: success result carries no value`)
  if (!Array.isArray(result.content) || result.content.length === 0) {
    throw new Error(`${label}: the real renderer produced no content blocks`)
  }
  return result.value as Record<string, unknown>
}

/** Assert the machine code on the registry-folded failure
 *  (`result.error.info.code` — HarnessError carrier; messages are
 *  corroborating evidence only, G1 Review-#1 discipline). */
export function expectDispatchErr(
  result: DispatchedResult,
  code: string,
  messageIncludes?: string,
): DispatchedResult {
  if (result.isError !== true) {
    throw new Error(
      `${code}: expected a structured FAILURE, got success value=${JSON.stringify(result.value).slice(0, 240)}`,
    )
  }
  const info = result.error?.info
  if (info?.code !== code) {
    throw new Error(
      `expected machine code ${JSON.stringify(code)}, got info=${JSON.stringify(info)} message=${JSON.stringify(result.error?.message)}`,
    )
  }
  if (messageIncludes !== undefined && !String(result.error?.message).includes(messageIncludes)) {
    throw new Error(`expected the message to include ${JSON.stringify(messageIncludes)}, got ${result.error?.message}`)
  }
  return result
}

/* ------------------------------------------------------------------ *
 * Zero-side-effect snapshots (no-partial-write proofs)
 * ------------------------------------------------------------------ */

function hashTree(dir: string, base: string, map: Map<string, string>): void {
  if (!existsSync(dir)) return
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    const st = statSync(abs)
    if (st.isDirectory()) hashTree(abs, base, map)
    else map.set(relative(base, abs).replace(/\\/g, '/'), createHash('sha256').update(readFileSync(abs)).digest('hex'))
  }
}

/** Stable sha256 snapshot of the declarative tree (`<wsRoot>/.research/**`,
 *  git metadata excluded — zero-declarative-write proofs). */
export function g5TreeSnapshot(wsRoot: string): string {
  const base = join(wsRoot, '.research')
  const map = new Map<string, string>()
  hashTree(base, base, map)
  return [...map.entries()].sort().map(([k, v]) => `${k} ${v}`).join('\n')
}

/** Deep-compare two snapshots and report the first difference. */
export function g5SnapshotDiff(a: string, b: string): string | null {
  const al = a.split('\n')
  const bl = b.split('\n')
  for (let i = 0; i < Math.max(al.length, bl.length); i += 1) {
    if (al[i] !== bl[i]) return `line ${i}: ${JSON.stringify(al[i])} vs ${JSON.stringify(bl[i])}`
  }
  return null
}

// re-exported for the suites' wiring-side helpers
export { dirname }
