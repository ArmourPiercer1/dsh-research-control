/**
 * WP-3.1 — AgentPlanForkPolicy (PLAN_FORK_SPEC §9): load, defaults, checks.
 *
 * Frozen contracts (read-only):
 *  - PLAN_FORK_SPEC §9 — `.research/policies/agent-plan-fork.yaml` 文档
 *    (enabled / anchors.{allow_boundary_sentinels, required_item_types} /
 *    flooding.threshold / triggers.{require_at_least_one, allowed_kinds})
 *    + 默认值语义 (schema `default`: enabled=true, sentinels=true,
 *    required_item_types=[], threshold=5, require_at_least_one=true,
 *    allowed_kinds=全部 5 种);
 *  - schema/declarative/agent-plan-fork-policy.schema.json (冻结, 经 WP-1.1
 *    `loadSchemas` 原样编译 — 单一编译路径, 零 schema 改写);
 *  - DOMAIN_SCHEMA §14 (布局: `policies/agent-plan-fork.yaml`; 所有 YAML 经
 *    冻结 schema 校验, 失败即拒绝并精确定位) + §16.1 (policy 文件为可选
 *    slot — WP-1.1 loader 以 `required: false` 装载: **文件缺失 = 全默认
 *    policy**, 非错误)。
 *
 * 消费点 (PLAN_FORK_SPEC §4 创建八步):
 *   - step 1 — `enabled = true` (本文件 `assertPolicyEnabled`);
 *   - step 5 — anchor 约束 (`applyAnchorPolicy`: 哨兵开关 + required_item_types);
 *   - step 6 — trigger 约束 (`applyTriggerPolicy`: allowed_kinds 子集 +
 *     require_at_least_one);
 *   - flooding.threshold — WP-3.5 消费 (本 WP 只装载 + 校验, 不做 flooding)。
 *
 * Pure: YAML 读经注入 `ResearchFileReader`; 编译经 WP-1.1 `loadSchemas`。
 */

import { parseAllDocuments } from 'yaml'

import { loadSchemas, pjoin, schemaErrorSummary } from '../loader/index.js'
import type { ResearchFileReader } from '../loader/index.js'
import {
  PLAN_FORK_ITEM_KINDS,
  PLAN_FORK_TRIGGER_KINDS,
  PlanForkError,
  type PlanForkItemKind,
  type PlanForkTriggerKind,
} from './types.js'

/** The frozen policy document with ALL schema defaults materialized. */
export interface AgentPlanForkPolicy {
  /** §9 `enabled` (schema default true). */
  readonly enabled: boolean
  readonly anchors: {
    /** §9 `anchors.allow_boundary_sentinels` (default true). */
    readonly allow_boundary_sentinels: boolean
    /** §9 `anchors.required_item_types` (default [] — 空 = 任意 item 可作 anchor). */
    readonly required_item_types: readonly PlanForkItemKind[]
  }
  readonly flooding: {
    /** §9 `flooding.threshold` (default 5; WP-3.5 消费). */
    readonly threshold: number
  }
  readonly triggers: {
    /** §9 `triggers.require_at_least_one` (default true). */
    readonly require_at_least_one: boolean
    /** §9 `triggers.allowed_kinds` (default 全部 5 种). */
    readonly allowed_kinds: readonly PlanForkTriggerKind[]
  }
}

/** The §9 default policy (schema defaults materialized; 文件缺失即此值). */
export const DEFAULT_AGENT_PLAN_FORK_POLICY: AgentPlanForkPolicy = {
  enabled: true,
  anchors: { allow_boundary_sentinels: true, required_item_types: [] },
  flooding: { threshold: 5 },
  triggers: { require_at_least_one: true, allowed_kinds: [...PLAN_FORK_TRIGGER_KINDS] },
}

/** `loadPlanForkPolicy` result (aggregated; `policy` null on error). */
export interface PlanForkPolicyLoadResult {
  readonly policy: AgentPlanForkPolicy | null
  readonly errors: readonly PlanForkError[]
  /** True when the file was absent and the default policy applies. */
  readonly defaulted: boolean
}

/** The policy file's `.research`-relative path (DOMAIN_SCHEMA §14). */
export const POLICY_REL_PATH = 'policies/agent-plan-fork.yaml'

/**
 * Load + validate `.research/policies/agent-plan-fork.yaml`.
 *
 *  - file ABSENT ⇒ `{ policy: DEFAULT_AGENT_PLAN_FORK_POLICY, defaulted: true }`
 *    (DOMAIN_SCHEMA §14: policy 为可选 slot; §9 defaults 即工程默认);
 *  - file PRESENT ⇒ single-YAML-document parse (loader 同款语义: 空文件 /
 *    多文档 / 非 mapping ⇒ PF_POLICY_INVALID) + 冻结 schema 校验
 *    (`loadSchemas` 编译, useDefaults 物化默认) — 逐错误精确定位 (path)。
 *  - policy schema 文件缺失/不可编译 ⇒ PF_POLICY_INVALID (fail loud,
 *    绝不在无 schema 时放行)。
 */
export function loadPlanForkPolicy(reader: ResearchFileReader, researchRoot: string, schemaDir: string): PlanForkPolicyLoadResult {
  const loadErrors: import('../loader/index.js').ResearchLoadError[] = []
  const compiled = loadSchemas(reader, schemaDir, loadErrors)
  const validator = compiled.validators.get('agent-plan-fork-policy')
  if (validator === undefined || loadErrors.length > 0) {
    const first = loadErrors[0]
    return {
      policy: null,
      defaulted: false,
      errors: [
        new PlanForkError({
          code: 'PF_POLICY_INVALID',
          path: first?.file,
          message:
            `agent-plan-fork policy schema unavailable${first ? `: ${first.message}` : ''} — ` +
            `no plan fork can be created until the frozen policy schema loads (schema/declarative/agent-plan-fork-policy.schema.json)`,
        }),
      ],
    }
  }

  const abs = pjoin(researchRoot, POLICY_REL_PATH)
  let text: string | null
  try {
    text = reader.readFile(abs)
  } catch (cause) {
    return {
      policy: null,
      defaulted: false,
      errors: [
        new PlanForkError({
          code: 'PF_POLICY_INVALID',
          path: POLICY_REL_PATH,
          message: `policy file read failed: ${cause instanceof Error ? cause.message : String(cause)}`,
          cause,
        }),
      ],
    }
  }
  if (text === null) {
    return { policy: DEFAULT_AGENT_PLAN_FORK_POLICY, defaulted: true, errors: [] }
  }

  const errors: PlanForkError[] = []
  const carrier = parseSingleYamlDoc(POLICY_REL_PATH, text, errors)
  if (carrier === null) return { policy: null, defaulted: false, errors }

  // useDefaults (WP-1.1 loadSchemas config) materializes §9 defaults into
  // `carrier` in place; the frozen validator then enforces the closed field
  // set (additionalProperties:false) + value constraints.
  const validated = { ...carrier }
  if (!validator(validated)) {
    for (const err of validator.errors ?? []) {
      errors.push(
        new PlanForkError({
          code: 'PF_POLICY_INVALID',
          path: err.instancePath === '' ? undefined : err.instancePath,
          message: schemaErrorSummary(err),
        }),
      )
    }
    return { policy: null, defaulted: false, errors }
  }

  return { policy: normalizePolicy(validated), defaulted: false, errors: [] }
}

/** Field-for-field normalization (validator-accepted shape → frozen policy type). */
function normalizePolicy(doc: Record<string, unknown>): AgentPlanForkPolicy {
  // AJV useDefaults only materializes defaults for objects that PRESENT in
  // the doc; a partial doc (e.g. only `enabled`) leaves the absent nested
  // objects' fields undefined. §9 semantics: omitted field = schema default,
  // so fill any undefined against DEFAULT_AGENT_PLAN_FORK_POLICY (which is
  // exactly the fully-materialized §9 default policy).
  const d = DEFAULT_AGENT_PLAN_FORK_POLICY
  const anchors = (doc.anchors ?? {}) as Record<string, unknown>
  const flooding = (doc.flooding ?? {}) as Record<string, unknown>
  const triggers = (doc.triggers ?? {}) as Record<string, unknown>
  return {
    enabled: doc.enabled as boolean,
    anchors: {
      allow_boundary_sentinels: (anchors.allow_boundary_sentinels as boolean | undefined) ?? d.anchors.allow_boundary_sentinels,
      required_item_types: (anchors.required_item_types as readonly PlanForkItemKind[] | undefined) ?? d.anchors.required_item_types,
    },
    flooding: { threshold: (flooding.threshold as number | undefined) ?? d.flooding.threshold },
    triggers: {
      require_at_least_one: (triggers.require_at_least_one as boolean | undefined) ?? d.triggers.require_at_least_one,
      allowed_kinds: (triggers.allowed_kinds as readonly PlanForkTriggerKind[] | undefined) ?? d.triggers.allowed_kinds,
    },
  }
}

/* ------------------------------------------------------------------ *
 * The three creation-time policy gates (§4 steps 1 / 5 / 6)
 * ------------------------------------------------------------------ */

/**
 * §4 step 1 — `policy enabled = true`. Throws PF_POLICY_DISABLED (step 1)
 * when the policy is disabled.
 */
export function assertPolicyEnabled(policy: AgentPlanForkPolicy): void {
  if (!policy.enabled) {
    throw new PlanForkError({
      code: 'PF_POLICY_DISABLED',
      step: 1,
      path: '/enabled',
      message: 'agent-plan-fork policy is disabled (enabled=false in ' + POLICY_REL_PATH + ') — plan fork creation refused (PLAN_FORK_SPEC §4 步骤 1)',
    })
  }
}

/**
 * §4 step 5 — policy anchor constraints on an ALREADY-RESOLVED anchor pair
 * (存在性/顺序 in anchors.ts; 本 gate 只做 policy 半边):
 *   - a sentinel anchor requires `anchors.allow_boundary_sentinels = true`;
 *   - a non-sentinel anchor whose item kind ∉ `anchors.required_item_types`
 *     (non-empty) is refused (「required_item_types: 空 = 任意 item 可作
 *     anchor；可设 [GATE]」— §9 原文).
 * `anchorKind` is the id prefix kind of a non-sentinel anchor (TASK/GATE/
 * MILESTONE) or null for sentinels.
 */
export function applyAnchorPolicy(
  policy: AgentPlanForkPolicy,
  name: 'fork_anchor' | 'merge_anchor',
  anchor: string,
  isSentinel: boolean,
  anchorKind: PlanForkItemKind | null,
): void {
  if (isSentinel && !policy.anchors.allow_boundary_sentinels) {
    throw new PlanForkError({
      code: 'PF_ANCHOR_POLICY',
      step: 5,
      path: `/${name}`,
      message:
        `anchor ${name}=${JSON.stringify(anchor)} is a boundary sentinel but policy ` +
        `anchors.allow_boundary_sentinels=false (${POLICY_REL_PATH}) — sentinel anchors refused (PLAN_FORK_SPEC §4 步骤 5/§9)`,
    })
  }
  if (!isSentinel && policy.anchors.required_item_types.length > 0 && anchorKind !== null) {
    if (!policy.anchors.required_item_types.includes(anchorKind)) {
      throw new PlanForkError({
        code: 'PF_ANCHOR_POLICY',
        step: 5,
        path: `/${name}`,
        message:
          `anchor ${name}=${JSON.stringify(anchor)} (kind ${anchorKind}) violates policy ` +
          `anchors.required_item_types=[${policy.anchors.required_item_types.join(', ')}] (${POLICY_REL_PATH}) — ` +
          `only the listed item kinds may serve as anchors (PLAN_FORK_SPEC §4 步骤 5/§9)`,
      })
    }
  }
}

/**
 * §4 step 6 — policy trigger constraints (the per-ref 存在性 is step 6's
 * resolver half, in create.ts):
 *   - `triggers.require_at_least_one = true` with an empty `trigger_refs`
 *     ⇒ PF_TRIGGERS_EMPTY;
 *   - a ref kind ∉ `triggers.allowed_kinds` ⇒ PF_TRIGGER_KIND_FORBIDDEN.
 */
export function applyTriggerPolicy(policy: AgentPlanForkPolicy, triggerRefs: readonly { kind: PlanForkTriggerKind }[]): void {
  if (policy.triggers.require_at_least_one && triggerRefs.length === 0) {
    throw new PlanForkError({
      code: 'PF_TRIGGERS_EMPTY',
      step: 6,
      path: '/trigger_refs',
      message:
        'policy triggers.require_at_least_one=true but trigger_refs is empty — ' +
        'at least one existing trigger ref is required (PLAN_FORK_SPEC §4 步骤 6/§9)',
    })
  }
  for (let i = 0; i < triggerRefs.length; i++) {
    const kind = triggerRefs[i]!.kind
    if (!policy.triggers.allowed_kinds.includes(kind)) {
      throw new PlanForkError({
        code: 'PF_TRIGGER_KIND_FORBIDDEN',
        step: 6,
        path: `/trigger_refs/${i}/kind`,
        message:
          `trigger_refs[${i}].kind=${JSON.stringify(kind)} is not in policy triggers.allowed_kinds=[` +
          `${policy.triggers.allowed_kinds.join(', ')}] (${POLICY_REL_PATH}) (PLAN_FORK_SPEC §4 步骤 6/§9)`,
      })
    }
  }
}

/* ------------------------------------------------------------------ *
 * Single-YAML-document parse (loader 同款语义, 聚合错误)
 * ------------------------------------------------------------------ */

function parseSingleYamlDoc(rel: string, text: string, errors: PlanForkError[]): Record<string, unknown> | null {
  let docs
  try {
    docs = parseAllDocuments(text)
  } catch (cause) {
    errors.push(new PlanForkError({ code: 'PF_POLICY_INVALID', path: rel, message: `YAML parse failed: ${cause instanceof Error ? cause.message : String(cause)}`, cause }))
    return null
  }
  const substantive = docs.filter((d) => d.errors.length > 0 || (d.contents !== null && d.contents !== undefined))
  if (substantive.length === 0) {
    errors.push(new PlanForkError({ code: 'PF_POLICY_INVALID', path: rel, message: 'empty or comment-only YAML file (expected a mapping)' }))
    return null
  }
  if (substantive.length > 1) {
    errors.push(new PlanForkError({ code: 'PF_POLICY_INVALID', path: rel, message: `multiple YAML documents (${substantive.length}); expected exactly one` }))
    return null
  }
  const doc = substantive[0]!
  if (doc.errors.length > 0) {
    for (const e of doc.errors) {
      const first = e.linePos?.[0]
      const shortMsg = e.message.split('\n')[0]
      const where = first ? ` (line ${first.line}, col ${first.col})` : ''
      errors.push(new PlanForkError({ code: 'PF_POLICY_INVALID', path: rel, message: `YAML: ${shortMsg}${where}` }))
    }
    return null
  }
  let value: unknown
  try {
    value = doc.toJS()
  } catch (cause) {
    errors.push(new PlanForkError({ code: 'PF_POLICY_INVALID', path: rel, message: `YAML parse failed: ${cause instanceof Error ? cause.message : String(cause)}`, cause }))
    return null
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    const what = value === null ? 'null' : Array.isArray(value) ? 'sequence' : typeof value
    errors.push(new PlanForkError({ code: 'PF_POLICY_INVALID', path: rel, message: `top-level YAML document must be a mapping (got ${what})` }))
    return null
  }
  return value as Record<string, unknown>
}
