/**
 * WP-3.1 — AgentPlanForkPolicy (§9) 测试:
 *   - §9 原文示例 (byte-exact POLICY_YAML_EXAMPLE) 装载 + 默认值物化;
 *   - 文件缺失 = 全默认 policy (DOMAIN_SCHEMA §14 可选 slot);
 *   - 冻结 schema 负例 (坏 threshold / 未知键 / 坏 kind / 多文档 / 非 mapping);
 *   - 创建时 policy 检查: enabled 门 (step 1)、哨兵开关 + required_item_types
 *     (step 5)、allowed_kinds 子集 + require_at_least_one (step 6)、
 *     flooding.threshold 装载面 (WP-3.5 消费, 本 WP 只校验)。
 */

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_AGENT_PLAN_FORK_POLICY,
  POLICY_REL_PATH,
  PlanForkError,
  applyAnchorPolicy,
  applyTriggerPolicy,
  assertPolicyEnabled,
  loadPlanForkPolicy,
  type AgentPlanForkPolicy,
} from '../../src/host/domain/planfork/index.js'
import { MEM_RESEARCH_ROOT, MEM_SCHEMA_DIR, POLICY_YAML_EXAMPLE, baseTreeFiles, makeReader } from '../loader/fixtures.js'

const POLICY_ABS = `${MEM_RESEARCH_ROOT}/${POLICY_REL_PATH}`

/** Run `fn`, expect a PlanForkError with the given code (code-level check). */
function expectCode(fn: () => unknown, code: string): PlanForkError {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(PlanForkError)
    expect((e as PlanForkError).code).toBe(code)
    return e as PlanForkError
  }
  throw new Error(`expected PlanForkError(${code}), got success`)
}

function load(files: Record<string, string> = baseTreeFiles()) {
  const reader = makeReader(files)
  return loadPlanForkPolicy(reader, MEM_RESEARCH_ROOT, MEM_SCHEMA_DIR)
}

describe('loadPlanForkPolicy — §9 原文示例 + 默认值', () => {
  it('loads the byte-exact §9 example (all fields explicit)', () => {
    const result = load()
    expect(result.errors).toEqual([])
    expect(result.defaulted).toBe(false)
    expect(result.policy).toEqual({
      enabled: true,
      anchors: { allow_boundary_sentinels: true, required_item_types: [] },
      flooding: { threshold: 5 },
      triggers: { require_at_least_one: true, allowed_kinds: ['CLAIM', 'FACT', 'ARTIFACT', 'MILESTONE', 'OBJECTIVE'] },
    })
  })

  it('materializes schema defaults for omitted fields (partial policy doc)', () => {
    const files = { ...baseTreeFiles(), [POLICY_REL_PATH]: 'enabled: false\n' }
    const result = load(files)
    expect(result.errors).toEqual([])
    expect(result.policy).toEqual({ ...DEFAULT_AGENT_PLAN_FORK_POLICY, enabled: false })
  })

  it('missing policy file ⇒ the full default policy (可选 slot, 非错误)', () => {
    const files = { ...baseTreeFiles() }
    delete files[POLICY_REL_PATH]
    const result = load(files)
    expect(result.errors).toEqual([])
    expect(result.defaulted).toBe(true)
    expect(result.policy).toEqual(DEFAULT_AGENT_PLAN_FORK_POLICY)
  })
})

describe('loadPlanForkPolicy — frozen schema 负例 (精确定位)', () => {
  it('rejects threshold = 0 (minimum 1) and non-integer threshold', () => {
    for (const doc of ['enabled: true\nflooding:\n  threshold: 0\n', 'flooding:\n  threshold: 2.5\n']) {
      const result = load({ ...baseTreeFiles(), [POLICY_REL_PATH]: doc })
      expect(result.policy).toBeNull()
      expect(result.errors.every((e) => e.code === 'PF_POLICY_INVALID')).toBe(true)
    }
  })

  it('rejects unknown keys (additionalProperties:false)', () => {
    const result = load({ ...baseTreeFiles(), [POLICY_REL_PATH]: 'rogue: true\n' })
    expect(result.policy).toBeNull()
    expect(result.errors.some((e) => e.message.includes('unexpected property "rogue"'))).toBe(true)
  })

  it('rejects bad enum values (allowed_kinds / required_item_types)', () => {
    const result = load({ ...baseTreeFiles(), [POLICY_REL_PATH]: 'triggers:\n  allowed_kinds: [CLAIM, GOAL]\n' })
    expect(result.policy).toBeNull()
    const other = load({ ...baseTreeFiles(), [POLICY_REL_PATH]: 'anchors:\n  required_item_types: [TASK, RUN]\n' })
    expect(other.policy).toBeNull()
  })

  it('rejects wrong types (enabled: "yes") and non-mapping / multi-doc files', () => {
    expect(load({ ...baseTreeFiles(), [POLICY_REL_PATH]: 'enabled: "yes"\n' }).policy).toBeNull()
    expect(load({ ...baseTreeFiles(), [POLICY_REL_PATH]: '- a\n- b\n' }).policy).toBeNull()
    expect(load({ ...baseTreeFiles(), [POLICY_REL_PATH]: 'a: 1\n---\nb: 2\n' }).policy).toBeNull()
    expect(load({ ...baseTreeFiles(), [POLICY_REL_PATH]: '# only a comment\n' }).policy).toBeNull()
  })

  it('keeps the §9 example loadable end-to-end (byte-exact frozen doc)', () => {
    const files = { ...baseTreeFiles(), [POLICY_REL_PATH]: POLICY_YAML_EXAMPLE }
    const result = load(files)
    expect(result.errors).toEqual([])
    expect(result.policy!.enabled).toBe(true)
    expect(result.policy!.anchors.allow_boundary_sentinels).toBe(true)
  })
})

describe('creation-time policy gates (§4 steps 1 / 5 / 6)', () => {
  it('step 1: disabled policy ⇒ PF_POLICY_DISABLED (指明 /enabled)', () => {
    const policy = { ...DEFAULT_AGENT_PLAN_FORK_POLICY, enabled: false }
    try {
      assertPolicyEnabled(policy)
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(PlanForkError)
      expect((e as PlanForkError).code).toBe('PF_POLICY_DISABLED')
      expect((e as PlanForkError).step).toBe(1)
      expect((e as PlanForkError).path).toBe('/enabled')
    }
    expect(() => assertPolicyEnabled(DEFAULT_AGENT_PLAN_FORK_POLICY)).not.toThrow()
  })

  it('step 5: sentinel gate (allow_boundary_sentinels=false)', () => {
    const policy: AgentPlanForkPolicy = {
      ...DEFAULT_AGENT_PLAN_FORK_POLICY,
      anchors: { ...DEFAULT_AGENT_PLAN_FORK_POLICY.anchors, allow_boundary_sentinels: false },
    }
    expect(() => applyAnchorPolicy(policy, 'fork_anchor', 'G-1', false, 'GATE')).not.toThrow()
    const err = expectCode(() => applyAnchorPolicy(policy, 'fork_anchor', '__START__', true, null), 'PF_ANCHOR_POLICY')
    expect(err.step).toBe(5)
    expect(err.path).toBe('/fork_anchor')
    expect(err.message).toContain('allow_boundary_sentinels=false')
    // merge 哨兵同样被拒
    expectCode(() => applyAnchorPolicy(policy, 'merge_anchor', '__END__', true, null), 'PF_ANCHOR_POLICY')
  })

  it('step 5: required_item_types 子集 (空 = 任意; [GATE] = 只许 Gate)', () => {
    const gateOnly: AgentPlanForkPolicy = {
      ...DEFAULT_AGENT_PLAN_FORK_POLICY,
      anchors: { ...DEFAULT_AGENT_PLAN_FORK_POLICY.anchors, required_item_types: ['GATE'] },
    }
    expect(() => applyAnchorPolicy(gateOnly, 'fork_anchor', 'G-1', false, 'GATE')).not.toThrow()
    const err = expectCode(() => applyAnchorPolicy(gateOnly, 'fork_anchor', 'T-1', false, 'TASK'), 'PF_ANCHOR_POLICY')
    expect(err.message).toContain('required_item_types=[GATE]')
    // required_item_types 不约束哨兵 (哨兵不是 item — 与哨兵开关正交)
    expect(() => applyAnchorPolicy(gateOnly, 'merge_anchor', '__END__', true, null)).not.toThrow()
    // 默认空集合 = 任意 kind
    expect(() => applyAnchorPolicy(DEFAULT_AGENT_PLAN_FORK_POLICY, 'fork_anchor', 'M-1', false, 'MILESTONE')).not.toThrow()
  })

  it('step 6: require_at_least_one + allowed_kinds 子集', () => {
    const restricted: AgentPlanForkPolicy = {
      ...DEFAULT_AGENT_PLAN_FORK_POLICY,
      triggers: { require_at_least_one: true, allowed_kinds: ['FACT', 'CLAIM'] },
    }
    expectCode(() => applyTriggerPolicy(restricted, []), 'PF_TRIGGERS_EMPTY')
    expect(() => applyTriggerPolicy(restricted, [{ kind: 'FACT' }])).not.toThrow()
    const err = expectCode(() => applyTriggerPolicy(restricted, [{ kind: 'FACT' }, { kind: 'ARTIFACT' }]), 'PF_TRIGGER_KIND_FORBIDDEN')
    expect(err.path).toBe('/trigger_refs/1/kind')
    expect(err.message).toContain('allowed_kinds=[FACT, CLAIM]')
    // require_at_least_one=false 放宽空集 (frozen record schema minItems 1 仍是存储下限)
    const relaxed: AgentPlanForkPolicy = { ...DEFAULT_AGENT_PLAN_FORK_POLICY, triggers: { require_at_least_one: false, allowed_kinds: ['FACT'] } }
    expect(() => applyTriggerPolicy(relaxed, [])).not.toThrow()
  })
})
