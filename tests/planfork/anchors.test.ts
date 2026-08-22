/**
 * WP-3.1 — anchor 语义 (PLAN_FORK_SPEC §2.2 原文) + closure (§3.1) +
 * 三种变更形态 (INSERT/MOVE/DELETE 按 §2.1 原文表达) 的边界测试:
 *   - 哨兵解析 (__START__ = -1 / __END__ = N; 纯插入相等锚点三分支:
 *     双哨兵-同点 / item 自指 / __END__ 自指);
 *   - 存在性 (未知 id ⇒ PF_ANCHOR_MISSING, 指明哪个 anchor);
 *   - 顺序 (fork > merge ⇒ PF_ANCHOR_ORDER);
 *   - 开区间语义 (锚点本身保留; 整计划替换 = 双哨兵);
 *   - 变更派生 (§11 端到端示例 + 纯插入 + 空计划边界)。
 */

import { describe, expect, it } from 'vitest'

import {
  PlanForkError,
  anchorOrdinal,
  closureRelativePaths,
  derivePlanForkChanges,
  isBoundarySentinel,
  resolveAnchors,
  replacedSpan,
  type PlanItemChange,
} from '../../src/host/domain/planfork/index.js'
import { WS1_CANONICAL, keep, newGate, newMilestone, newTask } from './fixtures.js'

const CANONICAL = WS1_CANONICAL // G-1, T-1, T-2, T-3, M-1, T-4, G-2

function codes(anchors: [string, string]): { fork: number; merge: number; pure: boolean } {
  const r = resolveAnchors(anchors[0], anchors[1], CANONICAL)
  return { fork: r.forkIndex, merge: r.mergeIndex, pure: r.pureInsertion }
}

describe('anchor ordinals (§2.2: 哨兵 = 计划起点之前/终点之后)', () => {
  it('resolves __START__ to -1 and __END__ to N (plan length)', () => {
    expect(anchorOrdinal('__START__', CANONICAL)).toBe(-1)
    expect(anchorOrdinal('__END__', CANONICAL)).toBe(CANONICAL.length)
    expect(anchorOrdinal('G-1', CANONICAL)).toBe(0)
    expect(anchorOrdinal('T-3', CANONICAL)).toBe(3)
    expect(anchorOrdinal('G-2', CANONICAL)).toBe(6)
  })

  it('resolves on the EMPTY plan (__START__ = -1, __END__ = 0)', () => {
    expect(anchorOrdinal('__START__', [])).toBe(-1)
    expect(anchorOrdinal('__END__', [])).toBe(0)
  })

  it('returns null for unknown ids and recognizes exactly the two sentinels', () => {
    expect(anchorOrdinal('X-9', CANONICAL)).toBe(null)
    expect(anchorOrdinal('__START', CANONICAL)).toBe(null)
    expect(anchorOrdinal('__start__', CANONICAL)).toBe(null)
    expect(isBoundarySentinel('__START__')).toBe(true)
    expect(isBoundarySentinel('__END__')).toBe(true)
    expect(isBoundarySentinel('G-1')).toBe(false)
  })
})

describe('resolveAnchors — §2.2 校验 (存在性 + 顺序 + 纯插入)', () => {
  it('accepts the §11 example (fork G-1, merge G-2)', () => {
    const r = resolveAnchors('G-1', 'G-2', CANONICAL)
    expect(r).toEqual({ forkAnchor: 'G-1', mergeAnchor: 'G-2', forkIndex: 0, mergeIndex: 6, pureInsertion: false })
    expect(replacedSpan(CANONICAL, r)).toEqual(['T-1', 'T-2', 'T-3', 'M-1', 'T-4'])
  })

  it('accepts boundary sentinels (whole-plan replacement / pure tail append)', () => {
    expect(codes(['__START__', '__END__'])).toEqual({ fork: -1, merge: 7, pure: false })
    expect(codes(['G-1', '__END__'])).toEqual({ fork: 0, merge: 7, pure: false })
    expect(codes(['__START__', 'G-2'])).toEqual({ fork: -1, merge: 6, pure: false })
  })

  it('accepts EQUAL anchors as pure insertion (item 自指 / 双哨兵同点)', () => {
    const r1 = resolveAnchors('T-3', 'T-3', CANONICAL)
    expect(r1).toMatchObject({ forkIndex: 3, mergeIndex: 3, pureInsertion: true })
    expect(replacedSpan(CANONICAL, r1)).toEqual([]) // 空开区间 — 纯插入
    const r2 = resolveAnchors('__START__', '__START__', CANONICAL)
    expect(r2).toMatchObject({ forkIndex: -1, mergeIndex: -1, pureInsertion: true })
    const r3 = resolveAnchors('__END__', '__END__', CANONICAL)
    expect(r3).toMatchObject({ forkIndex: 7, mergeIndex: 7, pureInsertion: true })
  })

  it('accepts __START__ == __END__ on an EMPTY plan (single empty point)', () => {
    const r = resolveAnchors('__START__', '__END__', [])
    expect(r).toMatchObject({ forkIndex: -1, mergeIndex: 0, pureInsertion: false })
  })

  it('rejects unknown anchors with the anchor NAME named (存在性)', () => {
    let forkErr: PlanForkError | undefined
    try {
      resolveAnchors('X-9', 'G-2', CANONICAL)
    } catch (e) {
      forkErr = e as PlanForkError
    }
    expect(forkErr).toBeDefined()
    expect(forkErr!.code).toBe('PF_ANCHOR_MISSING')
    expect(forkErr!.step).toBe(5)
    expect(forkErr!.path).toBe('/fork_anchor')
    expect(forkErr!.message).toContain('fork_anchor="X-9"')

    let mergeErr: PlanForkError | undefined
    try {
      resolveAnchors('G-1', 'X-9', CANONICAL)
    } catch (e) {
      mergeErr = e as PlanForkError
    }
    expect(mergeErr!.code).toBe('PF_ANCHOR_MISSING')
    expect(mergeErr!.path).toBe('/merge_anchor')
    expect(mergeErr!.message).toContain('merge_anchor="X-9"')
  })

  it('rejects fork AFTER merge (顺序非法) — 含哨兵顺序', () => {
    const err = (): PlanForkError => {
      try {
        resolveAnchors('G-2', 'G-1', CANONICAL)
        throw new Error('should have thrown')
      } catch (e) {
        return e as PlanForkError
      }
    }
    expect(err().code).toBe('PF_ANCHOR_ORDER')
    expect(err().step).toBe(5)
    expect(err().message).toContain('fork 序号 ≤ merge 序号')
    // 哨兵顺序: __END__ 在 G-1 之后 ⇒ 顺序非法
    expect(() => resolveAnchors('__END__', 'G-1', CANONICAL)).toThrow('anchor order illegal')
    // 相等非纯插入之外的边界: __START__ 永远 ≤ 一切
    expect(resolveAnchors('__START__', 'G-1', CANONICAL).forkIndex).toBeLessThanOrEqual(resolveAnchors('__START__', 'G-1', CANONICAL).mergeIndex)
  })
})

describe('closure (§3.1: plan.yaml + 每个 ordered item 定义文件)', () => {
  it('computes the 8-file closure in stable order (plan first, canonical item order)', () => {
    const ws = 'topics/TPC-1/workstreams/WS-1'
    const closure = closureRelativePaths(ws, CANONICAL)
    expect(closure).toEqual([
      'topics/TPC-1/workstreams/WS-1/plan.yaml',
      'topics/TPC-1/workstreams/WS-1/items/gates/G-1.yaml',
      'topics/TPC-1/workstreams/WS-1/items/tasks/T-1.yaml',
      'topics/TPC-1/workstreams/WS-1/items/tasks/T-2.yaml',
      'topics/TPC-1/workstreams/WS-1/items/tasks/T-3.yaml',
      'topics/TPC-1/workstreams/WS-1/items/milestones/M-1.yaml',
      'topics/TPC-1/workstreams/WS-1/items/tasks/T-4.yaml',
      'topics/TPC-1/workstreams/WS-1/items/gates/G-2.yaml',
    ])
  })

  it('computes the 1-file closure for an empty plan (V1 默认整个 closure, 无区间裁剪)', () => {
    expect(closureRelativePaths('topics/TPC-1/workstreams/WS-9', [])).toEqual(['topics/TPC-1/workstreams/WS-9/plan.yaml'])
  })

  it('fails loud on a non-T/G/M canonical element (上游校验失效护栏)', () => {
    expect(() => closureRelativePaths('topics/TPC-1/workstreams/WS-1', ['X-1'])).toThrow('not a well-formed T/G/M id')
  })
})

/* ------------------------------------------------------------------ *
 * 三种变更形态 (INSERT/MOVE/DELETE 按 §2.1 原文表达)
 * ------------------------------------------------------------------ */

function summarize(changes: readonly PlanItemChange[]): Record<string, string[]> {
  const out: Record<string, string[]> = { INSERT: [], MOVE: [], DELETE: [], UNCHANGED: [] }
  for (const c of changes) out[c.kind].push(c.ref ?? `<new@${c.toIndex}>`)
  return out
}

describe('derivePlanForkChanges — the §11 end-to-end example', () => {
  it('classifies: 3 INSERT, 1 MOVE (T-3 重排), 1 UNCHANGED (T-4), 3 DELETE (T-1/T-2/M-1)', () => {
    const r = resolveAnchors('G-1', 'G-2', CANONICAL)
    // §11: proposed = [NEW Task, KEEP T-3, NEW Milestone, NEW Task, KEEP T-4]
    const changes = derivePlanForkChanges(CANONICAL, r, [
      newTask({ title: '复算误差预算', goal: '复算' }),
      keep('T-3'),
      newMilestone({ title: '标定方案定稿', statement: '冻结' }),
      newTask({ title: '补充实验', goal: '补实验' }),
      keep('T-4'),
    ])
    const s = summarize(changes)
    expect(s.INSERT).toHaveLength(3)
    expect(s.MOVE).toEqual(['T-3'])
    expect(s.UNCHANGED).toEqual(['G-1', 'T-4', 'G-2'])
    expect(s.DELETE).toEqual(['T-1', 'T-2', 'M-1'])
    // 位置核对: 物化顺序 G-1, N1, T-3, N2, N3, T-4, G-2
    const byRef = new Map(changes.map((c) => [c.ref, c]))
    expect(byRef.get('T-3')!.toIndex).toBe(2) // from 3 → 2 (NEW 插在其前)
    expect(byRef.get('T-4')!.toIndex).toBe(5) // 绝对位置恰好不变
    expect(changes.filter((c) => c.kind === 'INSERT').map((c) => c.toIndex!).sort((a, b) => a - b)).toEqual([1, 3, 4])
  })

  it('classifies a KEEP-only reordering as MOVEs (no INSERT/DELETE)', () => {
    const r = resolveAnchors('G-1', 'G-2', CANONICAL)
    // 区间 5 项全部 KEEP, 全部倒序 [T-4, M-1, T-3, T-2, T-1]:
    // 物化 G-1 T-4 M-1 T-3 T-2 T-1 G-2 — T-3 恰好落在原绝对位置 3 (UNCHANGED)。
    const changes = derivePlanForkChanges(CANONICAL, r, [keep('T-4'), keep('M-1', 'MILESTONE'), keep('T-3'), keep('T-2'), keep('T-1')])
    const s = summarize(changes)
    expect(s.INSERT).toEqual([])
    expect(s.DELETE).toEqual([])
    expect(s.MOVE.sort()).toEqual(['M-1', 'T-1', 'T-2', 'T-4'].sort())
    expect(s.UNCHANGED.sort()).toEqual(['G-1', 'G-2', 'T-3'].sort())
  })
})

describe('derivePlanForkChanges — 纯插入 (相等锚点) 边界', () => {
  it('item 自指: proposed 插入在 X 之后 (X 保留一次, 后缀后移)', () => {
    const r = resolveAnchors('T-2', 'T-2', CANONICAL)
    const changes = derivePlanForkChanges(CANONICAL, r, [newTask({ title: '插', goal: '入' })])
    const s = summarize(changes)
    expect(s.INSERT).toHaveLength(1)
    expect(s.DELETE).toEqual([])
    // 物化: G-1 T-1 T-2 NEW T-3 M-1 T-4 G-2
    const insert = changes.find((c) => c.kind === 'INSERT')!
    expect(insert.toIndex).toBe(3)
    const t3 = changes.find((c) => c.ref === 'T-3')!
    expect(t3).toMatchObject({ kind: 'MOVE', fromIndex: 3, toIndex: 4 })
    expect(changes.find((c) => c.ref === 'T-2')!).toMatchObject({ kind: 'UNCHANGED', fromIndex: 2, toIndex: 2 })
    expect(changes.find((c) => c.ref === 'G-2')!).toMatchObject({ kind: 'MOVE', fromIndex: 6, toIndex: 7 })
  })

  it('双 __START__: 头部插入 (prefix 为空)', () => {
    const r = resolveAnchors('__START__', '__START__', CANONICAL)
    const changes = derivePlanForkChanges(CANONICAL, r, [newGate({ title: '头', criteria: '首' })])
    const insert = changes.find((c) => c.kind === 'INSERT')!
    expect(insert.toIndex).toBe(0)
    expect(changes.find((c) => c.ref === 'G-1')!).toMatchObject({ kind: 'MOVE', fromIndex: 0, toIndex: 1 })
    expect(changes.find((c) => c.ref === 'G-2')!).toMatchObject({ kind: 'MOVE', fromIndex: 6, toIndex: 7 })
    expect(changes.find((c) => c.ref === 'G-2')!.toIndex).toBe(7)
  })

  it('双 __END__: 尾部追加 (suffix 为空)', () => {
    const r = resolveAnchors('__END__', '__END__', CANONICAL)
    const changes = derivePlanForkChanges(CANONICAL, r, [newTask({ title: '尾', goal: '加' })])
    const insert = changes.find((c) => c.kind === 'INSERT')!
    expect(insert.toIndex).toBe(7)
    // 全部既有项位置不变
    for (const c of changes) {
      if (c.kind !== 'INSERT' && c.ref !== undefined) expect(c.toIndex).toBe(c.fromIndex)
    }
  })

  it('empty plan: __START__/__END__ 纯插入 (唯一位置)', () => {
    const r = resolveAnchors('__START__', '__END__', [])
    const changes = derivePlanForkChanges([], r, [newTask({ title: '唯一', goal: '项' })])
    expect(changes).toEqual([{ kind: 'INSERT', toIndex: 0 }])
  })

  it('whole-plan replacement (双哨兵): 全 DELETE + 全 INSERT', () => {
    const r = resolveAnchors('__START__', '__END__', CANONICAL)
    const changes = derivePlanForkChanges(CANONICAL, r, [newGate({ title: '唯', criteria: '一' }), keep('T-4')])
    const s = summarize(changes)
    // span = 全部 7 项; KEEP T-4 (span 内) ⇒ MOVE; 其余 6 项 DELETE
    expect(s.DELETE.sort()).toEqual(['G-1', 'G-2', 'M-1', 'T-1', 'T-2', 'T-3'].sort())
    expect(s.MOVE).toEqual(['T-4'])
    expect(s.INSERT).toHaveLength(1)
    expect(changes.find((c) => c.ref === 'T-4')!.toIndex).toBe(1)
  })
})
