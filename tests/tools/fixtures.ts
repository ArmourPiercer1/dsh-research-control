/**
 * WP-3.3 test infrastructure (tests/tools/).
 *
 * Shared actors, the exec factory (real AbortSignal), the ToolError
 * assertion helper, and recording deps (the two service ports with call
 * capture — the recording ports THROW if a stub path ever reaches them,
 * so a stub that touches a service is a test failure by construction).
 */

import { ToolError, type ResearchToolDeps, type ResearchToolExec, type ToolActorRef } from '../../src/host/tools/index.js'

/* ------------------------------------------------------------------ *
 * Actors (frozen actorRef shapes)
 * ------------------------------------------------------------------ */

/** The canonical AGENT actor: the §11 example run R-81 (a WS-1 formal run). */
export const AGENT: ToolActorRef = { kind: 'AGENT', run_id: 'R-81', session_id: 'sess-1', label: 'research-agent' }

/** An AGENT actor WITHOUT a run_id (the write-set rejection case). */
export const AGENT_NO_RUN: ToolActorRef = { kind: 'AGENT', session_id: 'sess-1' }

export const USER: ToolActorRef = { kind: 'USER', user_id: 'u-1', label: 'tester' }
export const PLUGIN: ToolActorRef = { kind: 'PLUGIN' }
export const SYSTEM: ToolActorRef = { kind: 'SYSTEM' }

/** Every NON-allowed actor kind (the matrix-column rejection sweep). */
export const NON_AGENT_ACTORS: readonly { name: string; actor: ToolActorRef }[] = [
  { name: 'USER', actor: USER },
  { name: 'PLUGIN', actor: PLUGIN },
  { name: 'SYSTEM', actor: SYSTEM },
]

/* ------------------------------------------------------------------ *
 * The exec factory
 * ------------------------------------------------------------------ */

export interface MakeExecOptions {
  readonly actor?: ToolActorRef
  /** Pre-aborted signal (the TOOL_ABORTED cases). */
  readonly aborted?: boolean
}

/** One ResearchToolExec (a real AbortController's signal). */
export function makeExec(options: MakeExecOptions = {}): ResearchToolExec & { controller: AbortController } {
  const controller = new AbortController()
  if (options.aborted) controller.abort()
  return {
    signal: controller.signal,
    actor: options.actor ?? AGENT,
    controller,
  }
}

/* ------------------------------------------------------------------ *
 * Assertions
 * ------------------------------------------------------------------ */

/** Human-readable rendering of a thrown value (assertion messages). */
function describeThrown(thrown: unknown): string {
  if (!(thrown instanceof Error)) return String(thrown)
  const code = 'code' in thrown ? String((thrown as { code: unknown }).code) : '?'
  return `${thrown.name}(${code}): ${thrown.message}`
}

/**
 * Run `fn` and assert it throws a ToolError with `code`; returns the
 * error (message/detail assertions follow at the call site).
 */
export function expectToolError(fn: () => unknown, code: string): asserts fn is never {
  let thrown: unknown
  try {
    fn()
  } catch (e) {
    thrown = e
  }
  if (thrown === undefined) {
    throw new Error(`expected ToolError(${code}) to be thrown, but nothing was thrown`)
  }
  if (!(thrown instanceof ToolError) || thrown.code !== code) {
    throw new Error(`expected ToolError(${code}), got ${describeThrown(thrown)}`)
  }
}

/** The async twin (the tool execute surface is async). */
export async function expectToolErrorAsync(fn: () => Promise<unknown>, code: string): Promise<ToolError> {
  let thrown: unknown
  try {
    await fn()
  } catch (e) {
    thrown = e
  }
  if (thrown === undefined) {
    throw new Error(`expected ToolError(${code}) to be thrown, but nothing was thrown`)
  }
  if (!(thrown instanceof ToolError) || thrown.code !== code) {
    throw new Error(`expected ToolError(${code}), got ${describeThrown(thrown)}`)
  }
  return thrown
}

/* ------------------------------------------------------------------ *
 * Recording deps (call capture + stub-firewall)
 * ------------------------------------------------------------------ */

export interface RecordingDeps extends ResearchToolDeps {
  readonly planForkCreateCalls: readonly unknown[]
  readonly recordCheckpointCalls: readonly { runId: string; params: { note?: string }; actor: ToolActorRef }[]
}

/**
 * Deps with call capture. `planForkCreate`/`recordCheckpoint` must be
 * overridden per-test (they throw by default: a stub path that reaches a
 * service is a test failure by construction).
 */
export function makeRecordingDeps(): RecordingDeps & {
  setPlanForkCreate(fn: ResearchToolDeps['planForkCreate']): void
  setRecordCheckpoint(fn: ResearchToolDeps['recordCheckpoint']): void
} {
  const planForkCreateCalls: unknown[] = []
  const recordCheckpointCalls: { runId: string; params: { note?: string }; actor: ToolActorRef }[] = []
  let pfImpl: ResearchToolDeps['planForkCreate'] = () => {
    throw new Error('deps.planForkCreate called without a test override (a stub reached the service port)')
  }
  let rcImpl: ResearchToolDeps['recordCheckpoint'] = () => {
    throw new Error('deps.recordCheckpoint called without a test override (a stub reached the service port)')
  }
  return {
    planForkCreateCalls,
    recordCheckpointCalls,
    planForkCreate: (params) => {
      planForkCreateCalls.push(params)
      return pfImpl(params)
    },
    recordCheckpoint: (runId, params, actor) => {
      recordCheckpointCalls.push({ runId, params, actor: actor as ToolActorRef })
      return rcImpl(runId, params, actor)
    },
    setPlanForkCreate: (fn) => {
      pfImpl = fn
    },
    setRecordCheckpoint: (fn) => {
      rcImpl = fn
    },
  }
}
