/**
 * WP-3.1 — INV-PLAN-6 双钉: 创建 API **无 base 参数** (PLAN_FORK_SPEC §4
 * 步骤 3 「不接受客户端提交 base — INV-PLAN-6 的结构性保证」/ ARCHITECTURE
 * §5.4 INV-PLAN-6 「fork API 无 base 参数, 基准永远重算自 canonical」)。
 *
 * 编译期 (类型面, tsc/typecheck 消费者生效):
 *   - `CreatePlanForkParams` 的任何 base 变体键进入接口 ⇒ 下面的
 *     `Expect` 断言编译失败 (tsc 红) — 这是冻结输入面的类型证明;
 * 运行期 (JS 调用者绕过类型的护栏, vitest 生效):
 *   - `assertFrozenInputSurface` 拒绝任何未知键, 点名 INV-PLAN-6;
 *   - 冻结键元组 `CREATE_PARAM_KEYS` 与接口键集逐字一致 (运行时镜像核对)。
 */

import { describe, expect, it } from 'vitest'

import {
  CREATE_PARAM_KEYS,
  PlanForkError,
  assertFrozenInputSurface,
  validatePlanForkCreation,
  type CreatePlanForkParams,
} from '../../src/host/domain/planfork/index.js'
import { makeHarness, makeParams } from './fixtures.js'

/* ------------------------------------------------------------------ *
 * 编译期类型面断言 (任何违例 ⇒ tsc 编译失败)
 * ------------------------------------------------------------------ */

/** Standard type-level boolean machinery (fails the build on violation). */
type Expect<T extends true> = T
/** True iff K is NOT a key of T (the INV-PLAN-6 assertion shape). */
type Absent<K extends string, T> = [K] extends [keyof T] ? false : true

type T_NoBase = Expect<Absent<'base', CreatePlanForkParams>>
type T_NoBasePlanObjects_Snake = Expect<Absent<'base_plan_objects', CreatePlanForkParams>>
type T_NoBasePlanObjects_Camel = Expect<Absent<'basePlanObjects', CreatePlanForkParams>>
type T_NoBaseGitCommit_Snake = Expect<Absent<'base_git_commit', CreatePlanForkParams>>
type T_NoBaseGitCommit_Camel = Expect<Absent<'baseGitCommit', CreatePlanForkParams>>
type T_NoBaseClosure = Expect<Absent<'baseClosure', CreatePlanForkParams>>

/** 正例: 冻结的 8 键都在类型面上 (接口演进时同步更新此断言)。 */
type T_HasWorkstreamId = Expect<['workstreamId'] extends [keyof CreatePlanForkParams] ? true : false>
type T_HasForkAnchor = Expect<['forkAnchor'] extends [keyof CreatePlanForkParams] ? true : false>
type T_HasMergeAnchor = Expect<['mergeAnchor'] extends [keyof CreatePlanForkParams] ? true : false>
type T_HasProposedItems = Expect<['proposedItems'] extends [keyof CreatePlanForkParams] ? true : false>
type T_HasTriggerRefs = Expect<['triggerRefs'] extends [keyof CreatePlanForkParams] ? true : false>
type T_HasReason = Expect<['reason'] extends [keyof CreatePlanForkParams] ? true : false>
type T_HasNecessity = Expect<['necessity'] extends [keyof CreatePlanForkParams] ? true : false>
type T_HasCreatedByRun = Expect<['createdByRun'] extends [keyof CreatePlanForkParams] ? true : false>

// 让编译器保留这些别名 (noUnusedLocals 无关 — 类型别名不参与值层)。
const _typeSurface: [T_NoBase, T_NoBasePlanObjects_Snake, T_NoBasePlanObjects_Camel, T_NoBaseGitCommit_Snake,
  T_NoBaseGitCommit_Camel, T_NoBaseClosure, T_HasWorkstreamId, T_HasForkAnchor, T_HasMergeAnchor,
  T_HasProposedItems, T_HasTriggerRefs, T_HasReason, T_HasNecessity, T_HasCreatedByRun] = [
  true, true, true, true, true, true, true, true, true, true, true, true, true, true,
]
void _typeSurface

describe('INV-PLAN-6 — 创建 API 无 base 参数 (类型面)', () => {
  it('the frozen input tuple lists exactly the §4 8 keys (运行时镜像)', () => {
    expect([...CREATE_PARAM_KEYS].sort()).toEqual([
      'createdByRun',
      'forkAnchor',
      'mergeAnchor',
      'necessity',
      'proposedItems',
      'reason',
      'triggerRefs',
      'workstreamId',
    ])
  })

  it('the param object built by makeParams has exactly those keys (实例核对)', () => {
    expect(Object.keys(makeParams()).sort()).toEqual([...CREATE_PARAM_KEYS].sort())
  })

  it('type-level: no base variant key exists on CreatePlanForkParams (见编译期断言)', () => {
    // 编译期断言在文件顶部 (T_NoBase*); 此处是 vitest 可见的对等说明例。
    expect(['base', 'base_plan_objects', 'basePlanObjects', 'base_git_commit', 'baseGitCommit']).not.toEqual(
      expect.arrayContaining(Object.keys(makeParams())),
    )
  })
})

describe('INV-PLAN-6 — 运行时冻结输入面守卫 (JS 绕过类型的护栏)', () => {
  /** Run `fn`, expect a PlanForkError with code PF_INPUT (code-level check). */
  function expectPfInput(fn: () => unknown): PlanForkError {
    try {
      fn()
    } catch (e) {
      expect(e).toBeInstanceOf(PlanForkError)
      expect((e as PlanForkError).code).toBe('PF_INPUT')
      return e as PlanForkError
    }
    throw new Error('expected PF_INPUT, got success')
  }

  it('assertFrozenInputSurface rejects an unknown base key, naming INV-PLAN-6', () => {
    const smuggled = { ...makeParams(), base: { objects: [] } } as unknown as Record<string, unknown>
    const err = expectPfInput(() => assertFrozenInputSurface(smuggled))
    expect(err.path).toBe('/base')
    expect(err.message).toContain('INV-PLAN-6')
    expect(err.message).toContain('服务端重算')
    // snake_case 变体同样被拒
    const smuggled2 = { ...makeParams(), base_plan_objects: [] } as unknown as Record<string, unknown>
    expect(expectPfInput(() => assertFrozenInputSurface(smuggled2)).path).toBe('/base_plan_objects')
  })

  it('assertFrozenInputSurface rejects missing frozen keys and non-object input', () => {
    const { necessity, ...rest } = makeParams()
    void necessity
    expect(expectPfInput(() => assertFrozenInputSurface(rest)).message).toContain('missing frozen')
    expectPfInput(() => assertFrozenInputSurface(null))
    expectPfInput(() => assertFrozenInputSurface([]))
    // 合法输入通过
    expect(() => assertFrozenInputSurface(makeParams())).not.toThrow()
  })

  it('validatePlanForkCreation refuses a JS caller that smuggles base past the type (零行落地)', () => {
    const h = makeHarness()
    const smuggled = { ...makeParams(), base_plan_objects: [{ path: 'x', git_blob_oid: 'a' }] } as unknown as CreatePlanForkParams
    expectPfInput(() => validatePlanForkCreation(smuggled, h.makeContext()))
    // 合法调用不受影响
    const draft = validatePlanForkCreation(makeParams(), h.makeContext())
    expect(draft.base_plan_objects).toHaveLength(8) // 基准来自服务端捕获, 非输入
  })
})
