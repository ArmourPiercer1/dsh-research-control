/**
 * R3-companion（reviewer 安全门）— deny-7 restriction 的生命周期补钉。
 *
 * 事实链（pinned 0.2.0-rc.2 checkout, READ ONLY 引用）:
 *  - preset 行不持有 restriction: `PresetDefinition`（agent-preset-registry
 *    src/definition.ts:5-11）只有 plugins 组合, 注册表没有 restriction 钩子;
 *  - 宿主 resume 的 setup 只做 selection + mount
 *    （api/session-controller/src/agent.ts:391-395 — `installSelection`
 *    + `presets.mount`, 不调用本插件的 setupInvestigator）, 而
 *    ToolRuntime.view 的起点是全部全局工具（core/tools/src/index.ts:1178
 *    「inherited tools filtered by layer admissions」）— 本插件全局注册的
 *    7 个可写 research 工具对 resumed investigator 默认可见;
 *  - ⇒ restriction 若只在 launch 时施加, RESUME 后的 investigator 就重新
 *    拿到写面（0.1 亦如此 = existing debt, 非 rc.2 新增回归 — 但存在公开
 *    补钉面, 本模块把它补上）。
 *
 * 补钉面（public, host 自己吃自家 dogfood）: `agent/created` 是串行事件,
 * 在 setup 完成之后、排队工作放行之前派发（core/agent/src/index.ts:176,
 * :550; payload `{agent, source: 'startup' | 'resume' | …}` —
 * runtime-types.ts:124, :261）。permission-presets 对 session 作用域的
 * pinning 用的就是同一类 seam（interaction/permission-presets/src/
 * index.ts:245）。本监听器: preset 判定为 investigator 的每个 agent（不
 * 问 launch/resume）⇒ `agent.ctx.tools.restrict({deny: 可写 7})`。
 * launch 路径与 setupInvestigator 的施加经 WeakSet 去重（restrict 同集合
 * 重复 append 本身也幂等 — restrictions intersect, core/tools
 * index.ts:677-679 — 去重只是省一层）。
 *
 * preset 判定读面（顺序即优先级）: `sessionProjections.stateOf(session,
 * 'agentPreset')`（宿主同款读法, api/session-controller/src/agent.ts:361
 * — 该 projection unit 由 dsh-agent-loop 注册, loop 缺席时键不存在 = 能力
 * 缺席）⇒ 回退 `session.meta.agentPreset`（session-controller 建会话时
 * 写入的持久 meta, :491）⇒ 都没有则跳过（宁可不施加, 绝不误伤他方会话）。
 *
 * fail 面: 本监听器是串行派发, throw = 宿主回滚该 agent 创建（core/agent
 * index.ts:420）⇒ investigator 施加失败即 fail-CLOSED（无 deny-7 无会话,
 * 与 launch 面 IVL_* 同一教义）; 判定面读失败只 warn+跳过（不误伤他方,
 * 残余风险文档化）。
 */
import { INVESTIGATOR_DENIED_TOOL_NAMES, INVESTIGATOR_PRESET_ID } from '../../service/investigator/index.js'

/** Minimal structural face of the agent-scoped tools surface this watch touches. */
export interface RestrictableAgentCtx {
  readonly tools: {
    restrict(filter: { deny?: readonly string[] }): unknown
  }
}

/** Agent face read by the `agent/created` listener. */
export interface RestrictableAgent {
  readonly ctx: RestrictableAgentCtx
  readonly session?: {
    readonly meta?: { readonly agentPreset?: unknown }
  }
}

/** Host-context face (all members probed optional — unit contexts may lack them). */
export interface RestrictionWatchContext {
  get(name: string): unknown
  on?(
    event: 'agent/created',
    listener: (payload: { agent: unknown; source?: unknown }) => void | Promise<void>,
    options?: { global?: boolean },
  ): () => unknown
}

/**
 * Agent-scoped ctxs this process has already restricted. The real AgentLoop
 * sets `agent.ctx = scope.ctx` and hands that SAME object to the launch
 * `setup(agent.ctx)`, so keying here on the scoped ctx makes the launch-time
 * restriction (`setupInvestigator`) and this watch dedupe to one apply.
 */
const restrictedCtxs = new WeakSet<object>()

/**
 * Shared apply used by BOTH the launcher setup and the resume watch
 * (idempotent per scoped ctx).
 *
 * @returns `true` when the restriction was newly appended, `false` when this
 *   scoped ctx was already restricted (the WeakSet short-circuit).
 */
export function restrictInvestigatorCtx(agentCtx: RestrictableAgentCtx): boolean {
  if (restrictedCtxs.has(agentCtx as unknown as object)) return false
  agentCtx.tools.restrict({ deny: [...INVESTIGATOR_DENIED_TOOL_NAMES] })
  restrictedCtxs.add(agentCtx as unknown as object)
  return true
}

/** preset 判定读面（projection → persisted session meta → undefined）. */
function investigatorPresetOf(ctx: RestrictionWatchContext, agent: RestrictableAgent): string | undefined {
  const projections = ctx.get('sessionProjections') as
    | { stateOf?(session: unknown, key: string): unknown }
    | undefined
  // The projection fold needs the full live Session (it folds the event log);
  // a not-yet-materialised / foreign session can throw out of `stateOf`. That
  // must NOT abort the read — the persisted `session.meta.agentPreset` is an
  // INDEPENDENT durable source (session-controller writes it at
  // agent.ts:491), so a projection read failure falls through to it rather
  // than silently skipping an investigator.
  let projected: unknown
  try {
    projected = projections?.stateOf?.(agent.session, 'agentPreset')
  } catch {
    projected = undefined
  }
  if (typeof projected === 'string') return projected
  const meta = agent.session?.meta?.agentPreset
  return typeof meta === 'string' ? meta : undefined
}

/**
 * Install the deny-7 watch over `agent/created`. Returns a disposer (the
 * host registers it through `ctx.effect`, so plugin unload removes it).
 */
export function installInvestigatorRestrictionWatch(ctx: RestrictionWatchContext): () => void {
  if (typeof ctx.on !== 'function') {
    console.warn(
      '[research-control] investigator restriction watch NOT installed (this context has no `ctx.on`): ' +
        'resumed investigator sessions keep the launch-time-only deny-7 behavior (documented existing debt)',
    )
    return () => {}
  }
  const dispose = ctx.on('agent/created', ({ agent }) => {
    const candidate = agent as RestrictableAgent
    if (typeof candidate?.ctx?.tools?.restrict !== 'function') return
    let preset: string | undefined
    try {
      preset = investigatorPresetOf(ctx, candidate)
    } catch (error: unknown) {
      // 判定面坏了 ≠ 可以乱施加（误伤他方会话更糟）也 ≠ 静默放行 investigator。
      // 读面失败: 大声, 跳过（残余风险, 文档化 — projection/meta 双读面同时
      // 崩解的组合现实中不存在）。
      console.warn(
        '[research-control] agent/created: the investigator preset could not be determined ' +
          `(${error instanceof Error ? error.message : String(error)}) — restriction skipped for this agent`,
      )
      return
    }
    if (preset !== INVESTIGATOR_PRESET_ID) return
    try {
      restrictInvestigatorCtx(candidate.ctx)
    } catch (error: unknown) {
      // fail-CLOSED: 这是串行监听器 — throw ⇒ 宿主回滚该 agent 的创建并 emit
      // agent/disposed（core/agent/src/index.ts:420）。investigator 拿不到
      // deny-7 就不该有会话（INV-PERM-3 与 launch 面 IVL_* 同一教义）;
      // 非 investigator 会话永不经此处, 本监听器不可能因我们的 bug 误杀他方。
      throw new Error(
        '[research-control] refusing an investigator agent without the deny-7 restriction: ' +
          `${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      )
    }
  }, { global: true })
  return typeof dispose === 'function' ? dispose : () => {}
}
