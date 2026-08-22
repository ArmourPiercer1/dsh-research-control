/**
 * WP-3.4 — §6.3 修正版拼接公式（A-13 修订原文）全分支测试（PURE）。
 *
 * 测试用例**直接从原文示例构造**：
 *   - §11 端到端示例（必用）：初始 canonical G-1,T-1,T-2,T-3,M-1,T-4,G-2;
 *     PF proposed = [NEW Task, KEEP T-3, NEW Milestone, NEW Task, KEEP T-4],
 *     fork G-1 / merge G-2 ⇒ 新序列 G-1,T-5,T-3,M-2,T-6,T-4,G-2（§11 步骤 6
 *     原文逐字 — 新 item 正式 ID T-5/M-2/T-6 亦为原文）;
 *   - §6.3 原文两式（通用含 prefix/suffix + 纯插入特例）+ 哨兵边界处理
 *     （__START__/__END__ 按计划边界）— 逐分支钉死;
 *   - 前置不变量违例（KEEP 区间外/重复/缺失、kind 不一致、anchor 缺失/
 *     乱序、空 proposed）— 大声失败, 错误码与 §4 链同系;
 *   - §6.2 「T/G/M 各自的下一序号」— 含未列入保留文件（INV-PLAN-9）;
 *   - 与 WP-3.1 `derivePlanForkChanges`（INSERT/MOVE/DELETE 位置分类）
 *     交叉验证（同一布局的两种视角必须一致）。
 */

import { describe, expect, it } from 'vitest'

import { PlanForkError, derivePlanForkChanges, resolveAnchors } from '../../src/host/domain/planfork/index.js'
import {
  allocateNewIds,
  computeNewPlan,
  itemIdSequence,
  spliceNewPlan,
  type ComputeNewPlanInput,
} from '../../src/host/service/select/index.js'
import { keep, newGate, newMilestone, newTask } from '../planfork/fixtures.js'

/** §11 初始 canonical（原文）。 */
const WS1: readonly string[] = ['G-1', 'T-1', 'T-2', 'T-3', 'M-1', 'T-4', 'G-2']

/** §11 PF proposed（原文顺序）。 */
const S11_PROPOSED = [
  { action: 'NEW' as const, kind: 'TASK' as const, spec: { title: '复算误差预算', goal: '重新推导误差预算并给出复算脚本' } },
  { action: 'KEEP' as const, kind: 'TASK' as const, ref: 'T-3' },
  { action: 'NEW' as const, kind: 'MILESTONE' as const, spec: { title: '标定方案定稿', statement: '误差预算复算通过且标定方案冻结' } },
  { action: 'NEW' as const, kind: 'TASK' as const, spec: { title: '补充实验', goal: '对残余误差项补充测量实验' } },
  { action: 'KEEP' as const, kind: 'TASK' as const, ref: 'T-4' },
]

/** 基础现有 id（= §11 树: T-1..T-4, G-1,G-2, M-1）。 */
const BASE_EXISTING: ComputeNewPlanInput['existingIdsByKind'] = {
  TASK: ['T-1', 'T-2', 'T-3', 'T-4'],
  GATE: ['G-1', 'G-2'],
  MILESTONE: ['M-1'],
}

function compute(
  canonical: readonly string[],
  forkAnchor: string,
  mergeAnchor: string,
  proposedItems: ComputeNewPlanInput['proposedItems'],
  existing: ComputeNewPlanInput['existingIdsByKind'] = BASE_EXISTING,
): ReturnType<typeof computeNewPlan> {
  return computeNewPlan({ canonical, forkAnchor, mergeAnchor, proposedItems, existingIdsByKind: existing })
}

function expectPfError(fn: () => unknown, code: string): void {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(PlanForkError)
    expect((e as PlanForkError).code).toBe(code)
    return
  }
  throw new Error(`expected PlanForkError(${code}), but no error was thrown`)
}

describe('§6.3 修正版公式 — 原文示例逐个', () => {
  it('§11 端到端示例（必用）: G-1,T-5,T-3,M-2,T-6,T-4,G-2 — 正式 ID 亦为原文', () => {
    const r = compute(WS1, 'G-1', 'G-2', S11_PROPOSED)
    // §11 步骤 6 原文: 「plan.yaml 重写为 G-1, T-5, T-3, M-2, T-6, T-4, G-2」
    expect(r.newOrder).toEqual(['G-1', 'T-5', 'T-3', 'M-2', 'T-6', 'T-4', 'G-2'])
    // §11 步骤 6 原文: 「新 items 获得 T-5、M-2、T-6 正式 ID」— proposed 顺序消费
    expect(r.newItems.map((i) => i.id)).toEqual(['T-5', 'M-2', 'T-6'])
    expect(r.newItems.map((i) => i.proposedIndex)).toEqual([0, 2, 3])
    expect(r.newItems.map((i) => i.kind)).toEqual(['TASK', 'MILESTONE', 'TASK'])
    // DELETE 形态: 开区间 (G-1, G-2) 内未被 KEEP 的 T-1,T-2,M-1 离开计划（文件保留 — INV-PLAN-9）
    expect(r.removedIds).toEqual(['T-1', 'T-2', 'M-1'])
    expect(r.keptIds).toEqual(['T-3', 'T-4'])
    // anchor 解析: fork idx 0 / merge idx 6 / 非纯插入
    expect(r.resolution.forkIndex).toBe(0)
    expect(r.resolution.mergeIndex).toBe(6)
    expect(r.resolution.pureInsertion).toBe(false)
  })

  it('通用式（fork 序号 < merge 序号, 中段 anchor）: prefix(含 fork) + S + suffix(含 merge)', () => {
    const canonical = ['G-1', 'T-1', 'T-2', 'T-3', 'G-2']
    const r = compute(canonical, 'T-1', 'G-2', [newTask({ title: 'X', goal: 'g' })])
    // prefix = [G-1, T-1]（含 fork T-1）; suffix = [G-2]（含 merge）; 开区间 (T-1,G-2)={T-2,T-3} 被替换
    expect(r.newOrder).toEqual(['G-1', 'T-1', 'T-5', 'G-2'])
    expect(r.removedIds).toEqual(['T-2', 'T-3'])
    expect(r.keptIds).toEqual([])
  })

  it('哨兵 __START__ 为 fork（prefix 空）', () => {
    const canonical = ['G-1', 'T-1', 'G-2']
    const r = compute(canonical, '__START__', 'G-2', [newTask({ title: 'X', goal: 'g' })], {
      TASK: ['T-1'],
      GATE: ['G-1', 'G-2'],
      MILESTONE: [],
    })
    // prefix = []（计划起点之前）; suffix = [G-2]（含 merge）
    expect(r.newOrder).toEqual(['T-2', 'G-2'])
    expect(r.removedIds).toEqual(['G-1', 'T-1'])
    expect(r.resolution.forkIndex).toBe(-1)
  })

  it('哨兵 __END__ 为 merge（suffix 空）', () => {
    const canonical = ['G-1', 'T-1', 'G-2']
    const r = compute(canonical, 'G-1', '__END__', [newGate({ title: 'X', criteria: 'c' })])
    // prefix = [G-1]（含 fork）; suffix = []（计划终点之后）; 开区间 (G-1,__END__)={T-1,G-2} 被替换
    expect(r.newOrder).toEqual(['G-1', 'G-3'])
    expect(r.removedIds).toEqual(['T-1', 'G-2'])
    expect(r.resolution.mergeIndex).toBe(3)
  })

  it('双哨兵 = 整计划替换（prefix 空 + suffix 空 — KEEP 全域合法）', () => {
    const canonical = ['G-1', 'T-1', 'G-2']
    const r = compute(canonical, '__START__', '__END__', [keep('T-1'), newTask({ title: 'X', goal: 'g' })], {
      TASK: ['T-1'],
      GATE: ['G-1', 'G-2'],
      MILESTONE: [],
    })
    expect(r.newOrder).toEqual(['T-1', 'T-2'])
    expect(r.removedIds).toEqual(['G-1', 'G-2'])
    expect(r.keptIds).toEqual(['T-1'])
  })

  it('纯插入特例（fork == merge == X, 中段）: X 保留一次, S 紧随其后', () => {
    const canonical = ['G-1', 'T-1', 'T-2', 'G-2']
    const r = compute(canonical, 'T-1', 'T-1', [newTask({ title: 'X', goal: 'g' })], {
      TASK: ['T-1', 'T-2'],
      GATE: ['G-1', 'G-2'],
      MILESTONE: [],
    })
    expect(r.resolution.pureInsertion).toBe(true)
    // canonical[..T-1]（含）+ [T-3] + canonical[T-2..]（X 之后首个起, 含）
    expect(r.newOrder).toEqual(['G-1', 'T-1', 'T-3', 'T-2', 'G-2'])
    expect(r.removedIds).toEqual([]) // 纯插入无删除
    expect(r.keptIds).toEqual([])
  })

  it('纯插入特例（fork == merge == __START__）: S 置于计划起点之前', () => {
    const canonical = ['G-1', 'T-1', 'T-2', 'G-2']
    const r = compute(canonical, '__START__', '__START__', [newTask({ title: 'X', goal: 'g' })], {
      TASK: ['T-1', 'T-2'],
      GATE: ['G-1', 'G-2'],
      MILESTONE: [],
    })
    expect(r.newOrder).toEqual(['T-3', 'G-1', 'T-1', 'T-2', 'G-2'])
    expect(r.removedIds).toEqual([])
  })

  it('纯插入特例（fork == merge == __END__）: S 追加于计划终点之后', () => {
    const canonical = ['G-1', 'T-1', 'T-2', 'G-2']
    const r = compute(canonical, '__END__', '__END__', [newTask({ title: 'X', goal: 'g' })], {
      TASK: ['T-1', 'T-2'],
      GATE: ['G-1', 'G-2'],
      MILESTONE: [],
    })
    expect(r.newOrder).toEqual(['G-1', 'T-1', 'T-2', 'G-2', 'T-3'])
    expect(r.removedIds).toEqual([])
  })

  it('相邻 anchor（通用式, 开区间为空）≡ 同位置纯插入 — 两式边界一致', () => {
    const canonical = ['G-1', 'T-1', 'T-2', 'G-2']
    const existing = { TASK: ['T-1', 'T-2'], GATE: ['G-1', 'G-2'], MILESTONE: [] } as ComputeNewPlanInput['existingIdsByKind']
    // 通用: fork T-1(idx1) < merge T-2(idx2) — 开区间 (T-1,T-2) 空
    const general = compute(canonical, 'T-1', 'T-2', [newTask({ title: 'X', goal: 'g' })], existing)
    expect(general.resolution.pureInsertion).toBe(false)
    expect(general.newOrder).toEqual(['G-1', 'T-1', 'T-3', 'T-2', 'G-2'])
    // 纯插入: X = T-1 — 同一布局
    const pure = compute(canonical, 'T-1', 'T-1', [newTask({ title: 'X', goal: 'g' })], existing)
    expect(pure.newOrder).toEqual(general.newOrder)
  })

  it('全 KEEP 重排（无 NEW, 无删除）: 位置即 §6.3 拼接结果, 无新 ID', () => {
    const canonical = ['G-1', 'T-1', 'T-2', 'T-3', 'G-2']
    const r = compute(canonical, 'G-1', 'G-2', [keep('T-3'), keep('T-1'), keep('T-2')])
    expect(r.newOrder).toEqual(['G-1', 'T-3', 'T-1', 'T-2', 'G-2'])
    expect(r.newItems).toEqual([])
    expect(r.removedIds).toEqual([])
    expect(r.keptIds).toEqual(['T-3', 'T-1', 'T-2'])
  })

  it('空 canonical + 双哨兵: 物化即全计划', () => {
    const r = compute([], '__START__', '__END__', [newTask({ title: 'X', goal: 'g' })], { TASK: [], GATE: [], MILESTONE: [] })
    expect(r.newOrder).toEqual(['T-1'])
  })

  it('空 canonical + 哨兵对: __START__ 序号 -1 ≠ __END__ 序号 0 ⇒ 通用式（两式同边界, 结果同）', () => {
    const r = compute([], '__START__', '__END__', [newTask({ title: 'X', goal: 'g' })], { TASK: [], GATE: [], MILESTONE: [] })
    // -1 < 0 ⇒ 通用式; prefix = [0..-1] 空, suffix = [0..] 空（n = 0）
    expect(r.resolution.pureInsertion).toBe(false)
    expect(r.resolution.forkIndex).toBe(-1)
    expect(r.resolution.mergeIndex).toBe(0)
    expect(r.newOrder).toEqual(['T-1'])
    // 同一空计划上的「双 __START__」纯插入 — 布局一致
    const pure = compute([], '__START__', '__START__', [newTask({ title: 'X', goal: 'g' })], { TASK: [], GATE: [], MILESTONE: [] })
    expect(pure.resolution.pureInsertion).toBe(true)
    expect(pure.newOrder).toEqual(r.newOrder)
  })
})

describe('§6.2 正式 ID 分配（T/G/M 各自下一序号）', () => {
  it('未列入计划的保留文件占用序号（INV-PLAN-9 — 最大号 + 1 越过它们）', () => {
    const existing: ComputeNewPlanInput['existingIdsByKind'] = {
      TASK: ['T-1', 'T-2', 'T-9'], // T-9 在盘但未列入（先前物化/补偿遗留）
      GATE: ['G-1'],
      MILESTONE: [],
    }
    const r = compute(['G-1', 'T-1'], 'G-1', '__END__', [newTask({ title: 'X', goal: 'g' }), newMilestone({ title: 'M', statement: 's' })], existing)
    expect(r.newItems.map((i) => i.id)).toEqual(['T-10', 'M-1'])
  })

  it('多 kind 交错按 proposed 顺序 per-kind 消费', () => {
    const r = compute(
      ['G-1', 'T-1', 'M-1', 'G-2'],
      'G-1',
      '__END__',
      [newGate({ title: 'a', criteria: 'c' }), newTask({ title: 'b', goal: 'g' }), newMilestone({ title: 'c', statement: 's' }), newGate({ title: 'd', criteria: 'c' })],
      { TASK: ['T-1'], GATE: ['G-1', 'G-2'], MILESTONE: ['M-1', 'M-2'] },
    )
    expect(r.newItems.map((i) => i.id)).toEqual(['G-3', 'T-2', 'M-3', 'G-4'])
  })
})

describe('§6.3 前置不变量 — 大声失败（错误码与 §4 链同系）', () => {
  it('KEEP 在替换开区间之外 ⇒ PF_KEEP_REF_OUTSIDE_SPAN（物化将重复列出）', () => {
    expectPfError(
      () => compute(['G-1', 'T-1', 'T-2', 'T-3', 'G-2'], 'T-1', 'G-2', [keep('G-1')]),
      'PF_KEEP_REF_OUTSIDE_SPAN',
    )
    // merge 侧之外同样拒绝
    expectPfError(
      () => compute(['G-1', 'T-1', 'T-2', 'T-3', 'G-2'], 'T-1', 'T-2', [keep('G-2')]),
      'PF_KEEP_REF_OUTSIDE_SPAN',
    )
  })

  it('纯插入（空开区间）时任何 KEEP ⇒ PF_KEEP_REF_OUTSIDE_SPAN', () => {
    expectPfError(
      () => compute(['G-1', 'T-1', 'T-2', 'G-2'], 'T-1', 'T-1', [keep('T-2')]),
      'PF_KEEP_REF_OUTSIDE_SPAN',
    )
  })

  it('KEEP ref 重复 ⇒ PF_KEEP_REF_DUPLICATE', () => {
    expectPfError(
      () => compute(['G-1', 'T-1', 'T-2', 'T-3', 'G-2'], 'T-1', 'G-2', [keep('T-2'), keep('T-2')]),
      'PF_KEEP_REF_DUPLICATE',
    )
  })

  it('KEEP ref 不在当前 canonical ⇒ PF_KEEP_REF_MISSING', () => {
    // T-9 在盘（保留文件）但未列入计划 — ref 必须存在于 ordered_items
    expectPfError(
      () => compute(['G-1', 'T-1', 'G-2'], 'G-1', 'G-2', [keep('T-9')], { TASK: ['T-1', 'T-9'], GATE: ['G-1', 'G-2'], MILESTONE: [] }),
      'PF_KEEP_REF_MISSING',
    )
  })

  it('KEEP kind ↔ ref 前缀不一致 ⇒ PF_ITEM_KIND_MISMATCH', () => {
    expectPfError(
      () => compute(['G-1', 'T-1', 'T-2', 'G-2'], 'G-1', 'G-2', [{ action: 'KEEP', kind: 'GATE', ref: 'T-1' }]),
      'PF_ITEM_KIND_MISMATCH',
    )
  })

  it('anchor 不在 canonical ⇒ PF_ANCHOR_MISSING（指名哪个 anchor）', () => {
    expectPfError(() => compute(['G-1', 'T-1'], 'T-99', 'G-1', [newTask({ title: 'X', goal: 'g' })]), 'PF_ANCHOR_MISSING')
    expectPfError(() => compute(['G-1', 'T-1'], 'G-1', 'T-99', [newTask({ title: 'X', goal: 'g' })]), 'PF_ANCHOR_MISSING')
  })

  it('fork 序号 > merge 序号 ⇒ PF_ANCHOR_ORDER', () => {
    expectPfError(
      () => compute(['G-1', 'T-1', 'T-2', 'G-2'], 'G-2', 'G-1', [newTask({ title: 'X', goal: 'g' })]),
      'PF_ANCHOR_ORDER',
    )
  })

  it('空 proposed_items ⇒ PF_ITEMS_EMPTY', () => {
    expectPfError(() => compute(['G-1', 'T-1'], 'G-1', '__END__', []), 'PF_ITEMS_EMPTY')
  })
})

describe('spliceNewPlan — §6.3 字面切片边界（已知 id 分配的纯拼接）', () => {
  it('通用式切片: prefix=[0..fork] / suffix=[merge..]（下标公式直接钉死）', () => {
    const canonical = ['G-1', 'T-1', 'T-2', 'T-3', 'M-1', 'T-4', 'G-2']
    const resolution = resolveAnchors('G-1', 'G-2', canonical)
    expect(spliceNewPlan(canonical, resolution, ['T-5', 'T-3', 'M-2', 'T-6', 'T-4'])).toEqual(['G-1', 'T-5', 'T-3', 'M-2', 'T-6', 'T-4', 'G-2'])
  })

  it('纯插入切片: prefix=[0..X]（min(X+1,n)）/ suffix=[X+1..]（X 后首项起）', () => {
    const canonical = ['G-1', 'T-1', 'T-2', 'G-2']
    const resolution = resolveAnchors('T-1', 'T-1', canonical)
    expect(resolution.pureInsertion).toBe(true)
    expect(spliceNewPlan(canonical, resolution, ['T-3'])).toEqual(['G-1', 'T-1', 'T-3', 'T-2', 'G-2'])
  })

  it('双 __END__ 纯插入: prefix = min(n+1, n) = n（全计划）+ suffix 空', () => {
    const canonical = ['G-1', 'T-1', 'G-2']
    const resolution = resolveAnchors('__END__', '__END__', canonical)
    expect(spliceNewPlan(canonical, resolution, ['T-2'])).toEqual(['G-1', 'T-1', 'G-2', 'T-2'])
  })

  it('双 __START__ 纯插入: prefix = min(0, n) = 0 + suffix = 全计划', () => {
    const canonical = ['G-1', 'T-1', 'G-2']
    const resolution = resolveAnchors('__START__', '__START__', canonical)
    expect(spliceNewPlan(canonical, resolution, ['T-2'])).toEqual(['T-2', 'G-1', 'T-1', 'G-2'])
  })

  it('通用式 + __END__ merge: suffix = canonical[n..] = 空', () => {
    const canonical = ['G-1', 'T-1', 'G-2']
    const resolution = resolveAnchors('G-1', '__END__', canonical)
    expect(spliceNewPlan(canonical, resolution, ['T-2'])).toEqual(['G-1', 'T-2'])
  })
})

describe('itemIdSequence / allocateNewIds — 纯分配原语', () => {
  it('itemIdSequence 解析 T/G/M id 的序号; 非良构/非 TGM ⇒ null', () => {
    expect(itemIdSequence('T-12')).toBe(12)
    expect(itemIdSequence('G-1')).toBe(1)
    expect(itemIdSequence('M-99')).toBe(99)
    expect(itemIdSequence('PF-17')).toBeNull()
    expect(itemIdSequence('WS-1')).toBeNull()
    expect(itemIdSequence('not-an-id')).toBeNull()
  })

  it('allocateNewIds: 无现有 ⇒ 从 1 起; 有现有 ⇒ 最大号 + 1; proposed 顺序消费', () => {
    expect(allocateNewIds({ TASK: [], GATE: [], MILESTONE: [] }, ['TASK', 'TASK', 'GATE'])).toEqual(['T-1', 'T-2', 'G-1'])
    expect(allocateNewIds({ TASK: ['T-3', 'T-1'], GATE: ['G-7'], MILESTONE: [] }, ['MILESTONE', 'TASK'])).toEqual(['M-1', 'T-4'])
  })
})

describe('与 WP-3.1 derivePlanForkChanges 交叉验证（同一布局的两种视角）', () => {
  it('§11 示例: 公式 newOrder 位置 == 变更分类 toIndex（KEEP/UNCHANGED 同位）', () => {
    const r = compute(WS1, 'G-1', 'G-2', S11_PROPOSED)
    const changes = derivePlanForkChanges(WS1, r.resolution, S11_PROPOSED)
    // 位置一致性: 每个带 ref 的分类项（MOVE/UNCHANGED/DELETE-fromIndex）在
    // 新序列中的位置 == 分类 toIndex; DELETE 项不在新序列中且 ∈ removedIds。
    for (const c of changes) {
      if (c.kind === 'MOVE' || c.kind === 'UNCHANGED') {
        expect(r.newOrder[c.toIndex!]).toBe(c.ref)
      }
      if (c.kind === 'DELETE') {
        expect(r.newOrder).not.toContain(c.ref)
        expect(r.removedIds).toContain(c.ref)
        expect(WS1[c.fromIndex!]).toBe(c.ref)
      }
    }
    // INSERT 形态: 分类的 toIndex 序列（proposed 顺序）== 公式 newItems 的
    // 正式 ID 序列（同序消费 — §6.2）逐位落在 newOrder 上。
    const inserts = changes.filter((c) => c.kind === 'INSERT').sort((a, b) => (a.toIndex ?? 0) - (b.toIndex ?? 0))
    inserts.forEach((c, k) => {
      expect(r.newOrder[c.toIndex!]).toBe(r.newItems[k]!.id)
    })
    // §11 形态学: T-1/T-2/M-1 删除, T-3 移动（3→2）, T-4 同位（5→5, 5 个
    // proposed 项中第 5 位恰好落回原位置）, G-1/G-2 不动, 3 插入
    const kinds = [...changes.map((c) => c.kind)].sort()
    expect(kinds).toEqual(['DELETE', 'DELETE', 'DELETE', 'INSERT', 'INSERT', 'INSERT', 'MOVE', 'UNCHANGED', 'UNCHANGED', 'UNCHANGED'].sort())
    expect(changes.filter((c) => c.kind === 'DELETE').map((c) => c.ref).sort()).toEqual(['M-1', 'T-1', 'T-2'])
    expect(changes.filter((c) => c.kind === 'MOVE').map((c) => c.ref)).toEqual(['T-3'])
    expect(changes.filter((c) => c.kind === 'UNCHANGED').map((c) => c.ref).sort()).toEqual(['G-1', 'G-2', 'T-4'])
  })

  it('纯插入: 无 DELETE（区间空）, 被挤后项 MOVE 与公式布局一致', () => {
    const canonical = ['G-1', 'T-1', 'T-2', 'G-2']
    const proposed = [newTask({ title: 'X', goal: 'g' })]
    const existing = { TASK: ['T-1', 'T-2'], GATE: ['G-1', 'G-2'], MILESTONE: [] } as ComputeNewPlanInput['existingIdsByKind']
    const r = compute(canonical, 'T-1', 'T-1', proposed, existing)
    const changes = derivePlanForkChanges(canonical, r.resolution, proposed)
    expect(changes.filter((c) => c.kind === 'DELETE')).toEqual([])
    expect(changes.filter((c) => c.kind === 'INSERT')).toHaveLength(1)
    // G-1/T-1 原位; T-2/G-2 被挤后一位（MOVE）— 与公式 newOrder 逐位一致
    for (const c of changes) {
      if (c.kind === 'MOVE' || c.kind === 'UNCHANGED') {
        expect(r.newOrder[c.toIndex!]).toBe(c.ref)
      }
    }
    expect(changes.filter((c) => c.kind === 'MOVE').map((c) => c.ref)).toEqual(['T-2', 'G-2'])
    expect(r.newOrder).toEqual(['G-1', 'T-1', 'T-3', 'T-2', 'G-2'])
  })
})
