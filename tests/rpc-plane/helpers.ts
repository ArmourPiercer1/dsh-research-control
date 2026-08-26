/**
 * V2-T3.2a — shared harness for the plane-read RPC suites (tests/rpc-plane/).
 *
 * Drives the REAL `ResearchControlService.[Service.init]` end-to-end (the
 * host-startup.test.ts assembly technique — the structural ctx double +
 * REAL temp workspaces + the real frozen schemas + a per-test
 * `$DSH_HOME`), extended with the face T3.2a needs:
 *   - `sessions.list()` returns FAKE live sessions with a configurable
 *     `header.cwd` (the §5 role-segment cwd source — the real host
 *     satisfies the same structural shape; the fake is the bench's
 *     session-registry stand-in);
 *   - the per-project wirings are reachable through the service's
 *     `projectWirings` field (a TS `private` — a plain runtime property;
 *     the test casts, same whitebox seam as the stale-precheck suite's
 *     fake-wiring constructor).
 *
 * No cordis App is started (the host-mount convention) — the ctx double
 * is the assembly seam.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Service, type Context } from '@deepseek-ai/cordis'
import { afterAll, afterEach } from 'vitest'

import { ResearchControlService } from '../../src/host/dsh-adapter/host/index.js'
import type { HostWiring } from '../../src/host/service/wiring/index.js'
import type { InterventionRecord } from '../../src/host/service/flooding/index.js'
import { serializeRegistry } from '../../src/host/domain/registry/index.js'
import type { RegistryEntry } from '../../src/host/domain/registry/index.js'
import { makeFile } from '../registry/fixtures.js'
import { APPENDIX_A_PROJECT_YAML, TOPIC_YAML, WS1_YAML } from '../loader/fixtures.js'
import { initGitRepo, writeResearchTree } from '../wiring/helpers.js'

/* ------------------------------------------------------------------ *
 * Temp plumbing (per-test $DSH_HOME; tracked for cleanup)
 * ------------------------------------------------------------------ */

const roots: string[] = []

export function makeTemp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

afterAll(async () => {
  // The startup integrity gate's git boundary check is the one ASYNC
  // check (git spawns, never fatal): let the last composed wirings'
  // pending checks settle BEFORE the temp dirs disappear (the
  // host-startup convention — no late ENOENT noise).
  await new Promise((r) => setTimeout(r, 500))
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

/** Point DSH_HOME at a fresh per-test home (dshHomePath reads the env live). */
export function freshDshHome(): string {
  const home = makeTemp('t32a-dsh-home-')
  process.env['DSH_HOME'] = home
  return home
}

/* ------------------------------------------------------------------ *
 * Workspace fixtures (real .research trees + real git repos)
 * ------------------------------------------------------------------ */

/** The PRJ-2 tree: the base tree's project.yaml + topic.yaml +
 *  workstream.yaml cross-refs patched (the host-startup PRJ2_PATCH
 *  shape), plus DISTINCT topic + workstream titles so the routing
 *  tests can tell the two projects' data apart (the routing
 *  fingerprints: 'Project Two Topic' / 'Project Two Pipeline'). */
const PRJ2_PATCH: Record<string, string> = {
  'project.yaml': APPENDIX_A_PROJECT_YAML.replace('id: PRJ-1', 'id: PRJ-2'),
  'topics/TPC-1/topic.yaml': TOPIC_YAML.replace(
    'project_id: PRJ-1',
    'project_id: PRJ-2',
  ).replace('title: 标定与配准', 'title: Project Two Topic'),
  'topics/TPC-1/workstreams/WS-1/workstream.yaml': WS1_YAML.replace(
    'title: 主标定管线',
    'title: Project Two Pipeline',
  ),
}

/** A project workspace: the complete valid `.research` tree + a real git repo. */
export function makeProjectWs(projectId: 'PRJ-1' | 'PRJ-2'): string {
  const root = makeTemp('t32a-ws-')
  writeResearchTree(root, projectId === 'PRJ-2' ? PRJ2_PATCH : {})
  initGitRepo(root)
  return root
}

/** A hub workspace: `<hubDir>/registry.yaml` with the given entries. */
export function makeHubWs(entries: readonly RegistryEntry[]): string {
  const root = makeTemp('t32a-hub-')
  const hubDir = join(root, '.research-control')
  mkdirSync(hubDir, { recursive: true })
  writeFileSync(join(hubDir, 'registry.yaml'), serializeRegistry(makeFile(entries)), 'utf8')
  return root
}

/** A plain (empty) registered workspace. */
export function makePlainWs(): string {
  return makeTemp('t32a-plain-')
}

/**
 * The 大计划 (WS-4-106-项) performance fixture (T3.2a brief): the base
 * tree's WS-1 plan grows from 7 to 106 ordered items (99 generated task
 * definitions T-101..T-199 — every id resolvable, the loader's
 * dangling-reference check stays green). The point of the fixture: the
 * overview aggregation must take COUNTS, not the expanded list — the
 * 106-item plan stays on disk, the card carries only numbers.
 */
export const BIG_PLAN_ITEM_COUNT = 106

export function bigPlanPatch(): Record<string, string> {
  const items = ['G-1', 'T-1', 'T-2', 'T-3', 'M-1', 'T-4', 'G-2']
  for (let i = 101; i <= 199; i += 1) items.push(`T-${i}`)
  const patch: Record<string, string> = {
    'topics/TPC-1/workstreams/WS-1/plan.yaml':
      `workstream: WS-1\nordered_items: [${items.join(', ')}]\n`,
  }
  for (let i = 101; i <= 199; i += 1) {
    patch[`topics/TPC-1/workstreams/WS-1/items/tasks/T-${i}.yaml`] = [
      `id: T-${i}`,
      'workstream_id: WS-1',
      `title: 大批量计划任务 ${i}`,
      'goal: 大计划性能用例的占位任务',
      'created_by: { kind: USER, label: researcher }',
      'created_at: 2026-08-21T09:36:00Z',
      '',
    ].join('\n')
  }
  return patch
}

/** A project workspace with the 106-item big plan (the perf fixture). */
export function makeBigPlanWs(): string {
  const root = makeTemp('t32a-bigplan-')
  writeResearchTree(root, bigPlanPatch())
  initGitRepo(root)
  return root
}

/**
 * Checkpoint a workspace's working tree (`git add -A` + commit) — the
 * test-side stand-in for the user's first `saveResearchCheckpoint`.
 * Needed for STANDALONE projects: their `research.sqlite` lives at
 * `<ws>/.research/state/` (design §3.3), and the RR-018① audit refresh
 * (which `getHubOverview` runs per project) reports the uncommitted
 * state dir as a `RESEARCH_UNCHECKPOINTED` checkpoint-gap finding and
 * mechanically captures one inbox item for it. Call it AFTER any db
 * writes (seeded interventions) and BEFORE the overview RPC, so the
 * audit scan sees a clean tree and the inbox stays zero (the production
 * behavior after the user's first checkpoint — the finding clears).
 */
export function commitWorkspaceState(ws: string): void {
  execFileSync('git', ['-C', ws, 'add', '-A'], { encoding: 'utf8' })
  execFileSync('git', ['-C', ws, 'commit', '-q', '--allow-empty', '-m', 'checkpoint (test)'], {
    encoding: 'utf8',
  })
}

/* ------------------------------------------------------------------ *
 * The host ctx double (host-mount.test.ts assembly technique, extended)
 * ------------------------------------------------------------------ */

/** One fake live session (the host `SessionLike` structural shape). */
export interface FakeSession {
  readonly id: string
  readonly cwd?: string
}

interface HostHarness {
  readonly svc: ResearchControlService
  /** Every `ctx.effect` body — run (then dispose) to tear the plane down. */
  readonly effectBodies: Array<() => unknown>
  /** The tool names registered through `ctx.tools.register`. */
  readonly toolNames: string[]
  readonly workspaces: readonly string[]
}

/**
 * Compose the service over the given registered workspaces + fake
 * sessions (the `sessions.list()` face — the §5 role-segment cwd source).
 */
export function mountHost(
  workspaces: readonly string[],
  sessions: readonly FakeSession[] = [],
): HostHarness {
  const effectBodies: Array<() => unknown> = []
  const toolNames: string[] = []
  const ctx = {
    reflect: {
      provide: (_name: string, _value: unknown): void => {},
    },
    effect: (execute: () => unknown): unknown => {
      effectBodies.push(execute)
      return {}
    },
    // Optional-service face: settings / commands / agents all absent —
    // the settings-absent path (one warn + defaults) and the
    // no-command-registry path (null + loud warn) both run, as on a
    // minimal deployment. `agents` absent ⇒ every session reports
    // running: false (the listSessions default).
    get: (_name: string): unknown => undefined,
    sessions: {
      list: (): unknown[] =>
        sessions.map((s) => ({
          id: s.id,
          header: {
            ...s.cwd === undefined ? {} : { cwd: s.cwd },
            createdAt: 1_755_000_000_000,
          },
          events: [],
        })),
    },
    events: {
      on: (_name: string, _handler: unknown): (() => void) => () => {},
    },
    tools: {
      register: (def: { name: string }): (() => void) => {
        toolNames.push(def.name)
        return () => {}
      },
    },
    workspaceRegistry: {
      list: () => workspaces.map((path) => ({ path })),
    },
  } as unknown as Context
  const svc = new ResearchControlService(ctx, { minDshVersion: '0.1.0-rc.8' })
  return { svc, effectBodies, toolNames, workspaces }
}

/** Run `[Service.init]` on the harness (the host-mount prototype read). */
export function initPlane(h: HostHarness): Promise<void> {
  const init = (ResearchControlService.prototype as unknown as Record<symbol, unknown>)[
    Service.init
  ] as unknown as (this: ResearchControlService) => Promise<void>
  return init.call(h.svc)
}

/** Tear the fiber down (run every effect body, then its disposer). */
export function disposeFiber(h: HostHarness): void {
  for (const body of h.effectBodies) {
    const disposer = body()
    if (typeof disposer === 'function') disposer()
  }
}

/* ------------------------------------------------------------------ *
 * Whitebox seams (TS `private` = a plain runtime property; the test
 * casts — the stale-precheck suite's constructor-seam precedent)
 * ------------------------------------------------------------------ */

/** The per-project wirings of an initialized harness (undefined pre-init). */
export function harnessWirings(h: HostHarness): Map<string, HostWiring> | undefined {
  return (h.svc as unknown as { projectWirings?: Map<string, HostWiring> }).projectWirings
}

let ivCounter = 0

/**
 * Seed one intervention row into a project's wiring (the store's insert
 * face — the shape net validates against the real frozen schema; ids are
 * unique per row). `created_at` defaults to "now minus 1h" so the
 * attention row's `oldestHours` is a small positive number.
 */
export function seedIntervention(
  wiring: HostWiring,
  over: Partial<InterventionRecord> = {},
): InterventionRecord {
  ivCounter += 1
  const record: InterventionRecord = {
    id: `IV-${1000 + ivCounter}`,
    title: 'plane 面测试干预',
    origin: 'USER',
    workstream_ids: ['WS-1'],
    source_refs: [],
    status: 'OPEN',
    created_by: { kind: 'USER', label: 'researcher' },
    created_at: Date.now() - 3_600_000,
    ...over,
  }
  wiring.interventions.insertIntervention(record)
  return record
}
