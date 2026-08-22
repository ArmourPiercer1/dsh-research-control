/**
 * WP-3.5 — INV-ATTN-5 机械触发面闭集断言（任务测试项 5）。
 *
 * ARCHITECTURE §5.10 INV-ATTN-5: 「不因 Claim scientific conflict 自动创建
 * Intervention（自动来源仅限 §6 脚注所列机械触发）」。§6 脚注 ¹ 逐字三类:
 *   1. PlanFork flooding 超阈值;
 *   2. audit 高影响 unresolved discrepancy;
 *   3. 运行时明确要求人工判断的 Agent report。
 *
 * 本 WP 的闭集面（类型面 + 运行面双钉, 同 WP-3.1 INV-PLAN-6 纪律）:
 *   - `MECHANICAL_TRIGGER_KINDS` 恰为三类（逐字编码; 无 Claim conflict 成员）;
 *   - `THIS_WP_MECHANICAL_TRIGGER` = PLAN_FORK_FLOODING（本 WP 只实现一类）;
 *   - 构建面 `buildAutoFloodingIntervention` 参数**无 origin / detail /
 *     created_by 键**（编译期 Expect<Absent> — 只能产 AUTO_FLOODING 记录）;
 *   - origin 枚举 = 冻结 4 值, 自动半集恰 {AUTO_FLOODING, AUTO_AUDIT};
 *   - `InterventionStore` / `FloodingService` 原型方法闭集审计:
 *     **无任何迁移/删除/更新方法**（INV-PERM-4 仅用户 — 本 WP 零非用户
 *     迁移面; 亦零 delete 面 — INV-HIST-7）;
 *   - `FloodingCheckResult.blocked` 字面类型 `false`（编译期 Equal 断言 —
 *     不阻止创建的类型面）。
 */

import { describe, expect, it } from 'vitest'

import {
  FloodingService,
  INTERVENTION_ORIGINS,
  InterventionStore,
  MECHANICAL_TRIGGER_KINDS,
  THIS_WP_MECHANICAL_TRIGGER,
  buildAutoFloodingIntervention,
  type FloodingCheckResult,
  type MechanicalTriggerKind,
} from '../../src/host/service/flooding/index.js'

/* ------------------------------------------------------------------ *
 * 编译期断言（四件套 tsc --noEmit 即消费者 — 同 WP-3.1 inv-plan-6 先例）
 * ------------------------------------------------------------------ */

type Expect<T extends true> = T
type Equal<A, B> = (<G>() => G extends A ? 1 : 2) extends <G>() => G extends B ? 1 : 2 ? true : false
type Absent<K extends string, T> = K extends keyof T ? never : true

type BuildParams = Parameters<typeof buildAutoFloodingIntervention>[0]

// 构建面闭集: 无 origin / detail / created_by / status 键（内容全由证据派生）。
type _T1 = Expect<Absent<'origin', BuildParams>>
type _T2 = Expect<Absent<'detail', BuildParams>>
type _T3 = Expect<Absent<'created_by', BuildParams>>
type _T4 = Expect<Absent<'status', BuildParams>>
type _T5 = Expect<Absent<'workstream_ids', BuildParams>>

// 钩子结果不阻止创建: blocked 字面类型 false（无法赋 true）。
type _T6 = Expect<Equal<FloodingCheckResult['blocked'], false>>

void (['_T1', '_T2', '_T3', '_T4', '_T5', '_T6'] as const)

/* ------------------------------------------------------------------ *
 * 运行面
 * ------------------------------------------------------------------ */

describe('INV-ATTN-5 — 机械触发闭集（§6 脚注 ¹ 三类, 逐字）', () => {
  it('MECHANICAL_TRIGGER_KINDS 恰为三类（flooding / audit / agent report）', () => {
    expect([...MECHANICAL_TRIGGER_KINDS]).toEqual([
      'PLAN_FORK_FLOODING',
      'AUDIT_HIGH_IMPACT_DISCREPANCY',
      'AGENT_REPORT_REQUIRES_HUMAN',
    ])
  })

  it('闭集中无 Claim scientific conflict 成员（INV-ATTN-5 明言排除）', () => {
    for (const kind of MECHANICAL_TRIGGER_KINDS) {
      expect(kind.toUpperCase()).not.toContain('CLAIM')
      expect(kind.toUpperCase()).not.toContain('CONFLICT')
    }
  })

  it('本 WP 实现的成员恰为 PLAN_FLOODING（唯一）', () => {
    expect(THIS_WP_MECHANICAL_TRIGGER).toBe('PLAN_FORK_FLOODING')
    expect(MECHANICAL_TRIGGER_KINDS).toContain(THIS_WP_MECHANICAL_TRIGGER)
    // 另两类不在本 WP 交付面（归 audit / agent report 各自 WP）。
    expect(MECHANICAL_TRIGGER_KINDS.filter((k) => k !== THIS_WP_MECHANICAL_TRIGGER)).toHaveLength(2)
  })

  it('origin 冻结 4 值; 自动半集恰 {AUTO_FLOODING, AUTO_AUDIT}', () => {
    expect([...INTERVENTION_ORIGINS]).toEqual(['USER', 'AGENT_REPORT', 'AUTO_FLOODING', 'AUTO_AUDIT'])
    const auto = INTERVENTION_ORIGINS.filter((o) => o.startsWith('AUTO_'))
    expect(auto).toEqual(['AUTO_FLOODING', 'AUTO_AUDIT'])
  })

  it('本 WP 构建的记录 origin 恒为 AUTO_FLOODING（构建面无法改出其他 origin）', () => {
    const record = buildAutoFloodingIntervention({
      id: 'IV-1',
      evidence: {
        workstream_id: 'WS-1',
        window: { kind: 'OPEN_STATE', as_of: 1, open_pf_ids: ['PF-1'] },
        count: 6,
        threshold: 5,
        rule: 'count(status == OPEN, per workstream) > threshold',
      },
      createdAt: 1,
    })
    expect(record.origin).toBe('AUTO_FLOODING')
    expect(INTERVENTION_ORIGINS).toContain(record.origin)
  })
})

describe('INV-PERM-4 — 非用户迁移面闭集审计（本 WP 零迁移口, 类型面即闭集）', () => {
  const TRANSITIONISH = /transition|update|setStatus|setState|move|promote|resolve|reopen|dismiss|delete|remove|drop|mutate/i

  it('InterventionStore 原型方法闭集: insert/query/close — 无迁移/删除面', () => {
    const proto = Object.getPrototypeOf(InterventionStore.prototype)
    const keys = Object.getOwnPropertyNames(InterventionStore.prototype).filter((k) => k !== 'constructor')
    expect([...keys].sort()).toEqual(
      ['close', 'findOpenAutoFlooding', 'getIntervention', 'insertIntervention', 'listInterventions'].sort(),
    )
    for (const k of keys) {
      expect(TRANSITIONISH.test(k), `method ${k} looks like a transition/delete face`).toBe(false)
    }
    // 无 delete（INV-HIST-7）— 闭集已含, 再钉一次负例。
    expect(keys).not.toContain('deleteIntervention')
    // 无状态迁移（INV-PERM-4）— 状态缓存列的 raw UPDATE 面留给未来用户面 WP。
    expect(keys.some((k) => /transition|update|set/i.test(k))).toBe(false)
    expect(proto).toBe(Object.prototype)
  })

  it('FloodingService 原型方法闭集: 两个钩子 — 无迁移/删除面', () => {
    const keys = Object.getOwnPropertyNames(FloodingService.prototype).filter((k) => k !== 'constructor')
    expect([...keys].sort()).toEqual(['onPlanForkCreated', 'onPlanLoaded'])
    for (const k of keys) {
      expect(TRANSITIONISH.test(k), `method ${k} looks like a transition/delete face`).toBe(false)
    }
  })

  it('机械触发 kind 的类型面封闭（编译期已钉; 运行面枚举核对）', () => {
    // MechanicalTriggerKind 的 3 值运行面 = 常量元组（无第 4 值可加而不破编译期断言）。
    const kinds: MechanicalTriggerKind[] = ['PLAN_FORK_FLOODING', 'AUDIT_HIGH_IMPACT_DISCREPANCY', 'AGENT_REPORT_REQUIRES_HUMAN']
    expect(kinds).toEqual([...MECHANICAL_TRIGGER_KINDS])
  })
})
