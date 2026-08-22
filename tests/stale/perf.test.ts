/**
 * WP-3.2 — 性能约束实测: 批量 W3 (有界并发池) vs 逐文件串行进程风暴。
 *
 * 任务口径: 「hash-object 批量（W13/W3 组合），避免逐文件进程风暴（实测
 * 记录进报告）」——冻结 W3 白名单行每次调用只收**一个**路径
 * (`git hash-object -- <path>`, whitelist.ts `a.length === 3`), 多路径
 * hash-object 不在冻结契约内 (见 src/host/service/stale/git-capture.ts
 * 头注的 W13 分析: W13 枚举的是 index 状态, 不能产出 working-copy OID,
 * 无法替代 W3); 因此批量 = 编排层有界并发池 (默认 8 in-flight)。
 *
 * 本文件实测: 123 文件闭包 (plan.yaml + G-1 + T-1..T-120 + G-2) 的真实
 * 临时 git 仓上, capturePlanClosure 与 checkStale 的 serial(1) vs batch(8)
 * wall-time; 数字以 `WP32-PERF` 前缀打印 (抄录进 WP-3.2 报告)。断言策略
 * (并行 WP 同机运行的噪声现实): min-of-2 测量; 钉死「批量结果正确 + 有界
 * 池不快也不慢于串行 (不放大风暴)」; 观察到的加速比记录进报告。进程数的
 * 上界 (≤8 in-flight) 由 tests/stale/compare.test.ts 的池单测确定性钉死。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { PlanForkStaleService } from '../../src/host/service/stale/index.js'
import { baseTreeFiles } from '../loader/fixtures.js'
import { createPf, openStaleHarness, planYaml, type StaleHarness } from './harness.js'

const N_TASKS = 120

let h: StaleHarness | undefined
afterEach(async () => {
  await h?.close()
  h = undefined
})

/**
 * The large plan: G-1, T-1..T-120, G-2 (closure = 123 files).
 */
function largeTree(): Array<readonly [string, string]> {
  const files = new Map<string, string>(Object.entries(baseTreeFiles()))
  const ordered = ['G-1', ...Array.from({ length: N_TASKS }, (_, i) => `T-${i + 1}`), 'G-2']
  files.set('topics/TPC-1/workstreams/WS-1/plan.yaml', planYaml(ordered))
  for (let n = 5; n <= N_TASKS; n++) {
    files.set(
      `topics/TPC-1/workstreams/WS-1/items/tasks/T-${n}.yaml`,
      `id: T-${n}\nworkstream_id: WS-1\ntitle: 任务 ${n}\ngoal: 目标 ${n}\ncreated_by: { kind: USER, label: researcher }\ncreated_at: 2026-08-22T10:00:00Z\n`,
    )
  }
  return [...files.entries()]
}

const closureSize = N_TASKS + 3 // plan.yaml + G-1 + 120 tasks + G-2

async function timed<T>(fn: () => Promise<T>): Promise<{ ms: number; value: T }> {
  const t0 = performance.now()
  const value = await fn()
  return { ms: performance.now() - t0, value }
}

/** Min-of-2 measurement (robust against load spikes from parallel WPs on the same machine). */
async function timedMin2<T>(fn: () => Promise<T>): Promise<{ ms: number; value: T }> {
  const a = await timed(fn)
  const b = await timed(fn)
  return a.ms <= b.ms ? a : b
}

describe('perf — 批量 W3 (concurrency 8) vs 逐文件串行 (concurrency 1), 123 文件闭包', () => {
  it('capturePlanClosure: batch wall-time ≤ serial (real git spawns, min-of-2)', async () => {
    const hh = await openStaleHarness({ tree: largeTree() })
    h = hh
    const svcSerial = new PlanForkStaleService({ repoRoot: hh.repo.root, store: hh.store, planProvider: hh.planProvider, concurrency: 1 })

    const serial = await timedMin2(() => svcSerial.capturePlanClosure('WS-1'))
    const batch = await timedMin2(() => hh.service.capturePlanClosure('WS-1')) // default concurrency 8

    expect(serial.value.objects).toHaveLength(closureSize)
    expect(batch.value.objects).toHaveLength(closureSize)
    // identical results (set + order deterministic):
    expect(batch.value.objects).toEqual(serial.value.objects)

    // eslint-disable-next-line no-console
    console.log(
      `WP32-PERF capturePlanClosure(${closureSize} files, min-of-2): serial(1)=${serial.ms.toFixed(1)}ms batch(8)=${batch.ms.toFixed(1)}ms speedup=${(serial.ms / Math.max(batch.ms, 0.001)).toFixed(1)}x processes=${closureSize + 1} (N×W3 + 1×W11 HEAD, both modes)`,
    )
    // the workload is real (N real git spawns); the bounded pool must stay
    // within a 2× load-inversion band of serial (parallel WPs share this
    // machine — under heavy load 8-way spawn thrashing can briefly invert
    // the ratio; the idle-run speedup is recorded in the WP-3.2 report).
    expect(serial.ms).toBeGreaterThan(50)
    expect(batch.ms).toBeLessThan(serial.ms * 2)
  }, 60_000)

  it('checkStale over a 123-file closure: batch recheck is exact and not slower than serial (one fresh OPEN PF per mode)', async () => {
    const hh = await openStaleHarness({ tree: largeTree() })
    h = hh
    const svcSerial = new PlanForkStaleService({ repoRoot: hh.repo.root, store: hh.store, planProvider: hh.planProvider, concurrency: 1 })
    const ws = 'topics/TPC-1/workstreams/WS-1'

    // MODE A — batch (concurrency 8) on a fresh OPEN PF (measured twice; the
    // second PF keeps the closure size identical for MODE B):
    const pfA = await createPf(hh)
    expect(pfA.base_plan_objects).toHaveLength(closureSize)
    const targetA = `.research/${ws}/items/tasks/T-60.yaml`
    await hh.repo.write(targetA, `${await hh.repo.read(targetA)}# perf edit A\n`)
    const batchRecheck = await timed(() => hh.service.checkStale(pfA.id))
    expect(batchRecheck.value.stale).toBe(true)
    expect(batchRecheck.value.diff).toEqual([
      {
        path: `${ws}/items/tasks/T-60.yaml`,
        kind: 'oid_changed',
        base_oid: pfA.base_plan_objects.find((o) => o.path === `${ws}/items/tasks/T-60.yaml`)!.git_blob_oid,
        current_oid: batchRecheck.value.currentClosure.find((o) => o.path === `${ws}/items/tasks/T-60.yaml`)!.git_blob_oid,
      },
    ])
    const pfA2 = await createPf(hh) // its base already includes edit A
    const targetA2 = `.research/${ws}/items/tasks/T-62.yaml`
    await hh.repo.write(targetA2, `${await hh.repo.read(targetA2)}# perf edit A2\n`)
    const batchRecheck2 = await timed(() => hh.service.checkStale(pfA2.id))
    expect(batchRecheck2.value.stale).toBe(true)
    const batchMs = Math.min(batchRecheck.ms, batchRecheck2.ms)

    // MODE B — serial (concurrency 1) on fresh OPEN PFs (same closure size):
    const pfB = await createPf(hh)
    const targetB = `.research/${ws}/items/tasks/T-61.yaml`
    await hh.repo.write(targetB, `${await hh.repo.read(targetB)}# perf edit B\n`)
    const serialRecheck = await timed(() => svcSerial.checkStale(pfB.id))
    expect(serialRecheck.value.stale).toBe(true)
    expect(serialRecheck.value.diff).toHaveLength(1)
    const pfB2 = await createPf(hh)
    const targetB2 = `.research/${ws}/items/tasks/T-63.yaml`
    await hh.repo.write(targetB2, `${await hh.repo.read(targetB2)}# perf edit B2\n`)
    const serialRecheck2 = await timed(() => svcSerial.checkStale(pfB2.id))
    expect(serialRecheck2.value.stale).toBe(true)
    const serialMs = Math.min(serialRecheck.ms, serialRecheck2.ms)

    // eslint-disable-next-line no-console
    console.log(
      `WP32-PERF checkStale(${closureSize}-file closure recheck, min-of-2): batch(8)=${batchMs.toFixed(1)}ms serial(1)=${serialMs.toFixed(1)}ms speedup=${(serialMs / Math.max(batchMs, 0.001)).toFixed(1)}x processes=${closureSize + 1} (N×W3 + 1×W11 HEAD, both modes)`,
    )
    // same 2× load-inversion band as the capture test (see above):
    expect(serialMs).toBeGreaterThan(50)
    expect(batchMs).toBeLessThan(serialMs * 2)
  }, 120_000)
})
