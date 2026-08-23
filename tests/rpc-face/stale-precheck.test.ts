/**
 * WP-4.6 — RR-015① disposition: the query-path stale pre-check.
 *
 * The production port (`ProductionResearchRpcServices`) must run the
 * idempotent `stale.checkAllOpen()` sweep BEFORE the projection of
 * `getDashboard` (full sweep — every topic card counts OPEN PFs) and
 * `getWorkstream` (workstream-scoped sweep), so the snapshot reflects
 * the CURRENT PF truth (PLAN_FORK_SPEC §5 「检测时机」: 「PF 列表查询
 * 懒检测」; §3 idempotency: a non-OPEN re-check is a NO-OP). No new RPC
 * (the 13-list of ARCHITECTURE §7.1 stays frozen — the pre-check rides
 * the existing query path, the report documents the compatibility
 * argument).
 *
 * These tests drive the PRODUCTION implementation (not the test stub)
 * over a REAL `.research/` tree (the loader fixture base tree) + the
 * REAL frozen schema root, with every wiring face faked EXCEPT the
 * `stale` recorder under test — the constructor seam (a cast partial
 * `HostWiring`) is exactly where the production composition root hands
 * the wiring in, so the fake is structurally honest.
 */

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { baseTreeFiles } from '../loader/fixtures.js'
import { ProductionResearchRpcServices } from '../../src/host/dsh-adapter/host/rpc-services.js'
import type { HostWiring } from '../../src/host/service/wiring/index.js'

const HERE = dirname(fileURLToPath(import.meta.url))

/** WR root (three levels up: tests/rpc-face → tests → plugin repo → WR). */
const WR_ROOT = join(HERE, '..', '..', '..')
/** The real frozen contract schema ROOT (WR `schema/`). */
const SCHEMA_ROOT = join(WR_ROOT, 'schema')

interface StaleCall {
  readonly workstreamId: string | undefined
}

/** Build the production port over a valid tree with a recording `stale` face. */
function makeProduction(
  stale: (workstreamId?: string) => Promise<{ outcomes: readonly unknown[]; failures: readonly unknown[] }>,
): { services: ProductionResearchRpcServices; calls: StaleCall[]; tmp: string } {
  const tmp = mkdtempSync(join(tmpdir(), 'wp46-stale-precheck-'))
  const researchRoot = join(tmp, 'ws', '.research')
  mkdirSync(researchRoot, { recursive: true })
  for (const [rel, content] of Object.entries(baseTreeFiles())) {
    const abs = join(researchRoot, rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, content, 'utf8')
  }
  const dataDir = join(tmp, 'data')
  mkdirSync(dataDir, { recursive: true })

  const calls: StaleCall[] = []
  const wiring = {
    repoRoot: join(tmp, 'ws'),
    researchRoot,
    projectId: 'PRJ-1',
    dataDir,
    stale: {
      checkAllOpen: async (workstreamId?: string) => {
        calls.push({ workstreamId })
        return await stale(workstreamId)
      },
    },
    store: { listRange: () => [] as never[] },
    tables: { listRuns: () => [] as never[] },
    planForks: { countOpen: () => 0, listPlanForks: () => [] as never[] },
    interventions: { listInterventions: () => [] as never[], getIntervention: () => null },
    allocator: { reserve: () => ({ id: 'MA-1', kind: 'MA' }), commit: () => {}, release: () => {} },
  } as unknown as HostWiring

  return {
    services: new ProductionResearchRpcServices({ wiring, schemaRoot: SCHEMA_ROOT }),
    calls,
    tmp,
  }
}

describe('WP-4.6 host RPC face — query-path stale pre-check (RR-015①)', () => {
  let tmp: string
  const cleanup: string[] = []
  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'wp46-stale-precheck-suite-'))
  })
  afterAll(() => {
    for (const dir of cleanup) rmSync(dir, { recursive: true, force: true })
    rmSync(tmp, { recursive: true, force: true })
  })

  it('getDashboard runs the FULL sweep (undefined scope) before the projection', async () => {
    const { services, calls, tmp: t } = makeProduction(async () => ({ outcomes: [], failures: [] }))
    cleanup.push(t)
    const snapshot = await services.getDashboard()
    services.close()
    expect(calls).toEqual([{ workstreamId: undefined }])
    // the pre-check did not perturb the payload itself
    expect(snapshot.project.id).toBe('PRJ-1')
    expect(snapshot.openInterventions).toEqual([])
    expect(snapshot.pendingInterventions).toEqual([])
  })

  it('getWorkstream runs the WORKSTREAM-SCOPED sweep before the projection', async () => {
    const { services, calls, tmp: t } = makeProduction(async () => ({ outcomes: [], failures: [] }))
    cleanup.push(t)
    const snapshot = await services.getWorkstream({ workstreamId: 'WS-1' })
    services.close()
    expect(calls).toEqual([{ workstreamId: 'WS-1' }])
    expect(snapshot.workstream.id).toBe('WS-1')
  })

  it('a per-PF sweep failure (collected, never thrown) does NOT abort the query', async () => {
    const { services, calls, tmp: t } = makeProduction(async () => ({
      outcomes: [],
      failures: [{ pfId: 'PF-9', error: new Error('git exploded') }],
    }))
    cleanup.push(t)
    // checkAllOpen collects per-PF failures in the result — the pre-check
    // sees a settled sweep either way; the snapshot still reflects truth.
    const snapshot = await services.getDashboard()
    services.close()
    expect(calls).toHaveLength(1)
    expect(snapshot.topics.length).toBeGreaterThan(0)
  })

  it('a sweep-level throw propagates (a lying query is worse than a failed one)', async () => {
    const { services, tmp: t } = makeProduction(async () => {
      throw new Error('store unreadable')
    })
    cleanup.push(t)
    await expect(services.getDashboard()).rejects.toThrow('store unreadable')
    services.close()
  })

  it('the pre-check runs BEFORE the PF read: the sweep call precedes listPlanForks', async () => {
    const order: string[] = []
    const tmp2 = mkdtempSync(join(tmpdir(), 'wp46-stale-order-'))
    const researchRoot = join(tmp2, 'ws', '.research')
    mkdirSync(researchRoot, { recursive: true })
    for (const [rel, content] of Object.entries(baseTreeFiles())) {
      const abs = join(researchRoot, rel)
      mkdirSync(join(abs, '..'), { recursive: true })
      writeFileSync(abs, content, 'utf8')
    }
    const dataDir = join(tmp2, 'data')
    mkdirSync(dataDir, { recursive: true })
    const wiring = {
      repoRoot: join(tmp2, 'ws'),
      researchRoot,
      projectId: 'PRJ-1',
      dataDir,
      stale: {
        checkAllOpen: async () => {
          order.push('stale')
          return { outcomes: [], failures: [] }
        },
      },
      store: { listRange: () => [] as never[] },
      tables: { listRuns: () => [] as never[] },
      planForks: {
        countOpen: () => 0,
        listPlanForks: () => {
          order.push('planForks')
          return [] as never[]
        },
      },
      interventions: { listInterventions: () => [] as never[], getIntervention: () => null },
      allocator: { reserve: () => ({ id: 'MA-1', kind: 'MA' }), commit: () => {}, release: () => {} },
    } as unknown as HostWiring
    const services = new ProductionResearchRpcServices({ wiring, schemaRoot: SCHEMA_ROOT })
    await services.getWorkstream({ workstreamId: 'WS-1' })
    services.close()
    rmSync(tmp2, { recursive: true, force: true })
    expect(order[0]).toBe('stale')
    expect(order).toContain('planForks')
    expect(order.indexOf('stale')).toBeLessThan(order.indexOf('planForks'))
  })
})
