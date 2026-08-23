/**
 * WP-7.1 — Read-only Investigator launcher（investigator 启动）: type surface.
 *
 * 冻结契约依据（只读）:
 *  - ARCHITECTURE §2.3（`DshAgentLauncherAdapter` — 只读 Investigator Agent
 *    的受限启动；TS 定义插件自有, 实现在 host/dsh-adapter/）+ §5.9
 *    **INV-PERM-3**（Investigator Agent 完全只读（无任何写路径）；输出默认
 *    transient, 仅用户显式保存才落 AnalysisRecord — R+T）+ §6 权限矩阵
 *    （INVESTIGATOR 列: 除「启动 Investigator」✅(USER) 外全 ❌; 记录
 *    Fact/Claim/Artifact ❌; History append ❌; 启动 Investigator: U ✅ /
 *    A ❌ / P ❌）+ §7.2（只读工具 4 个 vs 可写工具 7 个 — 本模块
 *    `INVESTIGATOR_DENIED_TOOL_NAMES` 钉死可写集为 restriction 黑名单）;
 *  - 计划书 §26.1（可读: plugin state / ResearchHistory / DSH Session /
 *    Git history/diff / workspace files / Artifact refs; 不可写: workspace /
 *    plan / Claim/Fact / Gate / Task / Contract / History / Agent executor
 *    scheduling）+ Phase 7 任务 1（read-only Agent preset）+ **Gate P7 三条**
 *    （无 workspace write path / 无 plan/history mutation tool / 能从
 *    Intervention 一键启动并引用相关上下文 — 本 WP 交付第三条的 launch 缝
 *    `launch(investigationContext)`）;
 *  - DSH_ADAPTER §10.2（只读 Investigator — 路径 A: `session.create`
 *    `{agentPreset, cwd}` + `/permission read-only` + `prompt(task)`;
 *    只读约束三层保障: preset 只注册只读工具 + `/permission read-only`
 *    （sandbox 后端拒绝写）+ TC-DSH-010 注册面断言; 映射行:
 *    `DshAgentLauncherAdapter.launchInvestigator(workspaceId, task)` =
 *    ensure preset → `session.create({agentPreset, cwd})` →
 *    `command('/permission read-only')` → `prompt(task)`）;
 *  - **§13-U5（本 WP 消解, 定案 = 路径 A）**: 「preset（agent-plane）不能含
 *    host-plane sandbox 行; blank session `/permission` 时序」— 验证路径
 *    「读 permission-presets 命令 handler + sandbox-policy per-session
 *    override 折叠」已执行（报告「U5 消解」专节 file:line 证据链）:
 *    preset 不能钉 sandbox mode（agent-plane 组合 vs host-plane 权限栈;
 *    preset mount 先于 `session/created` 的 `pinInitialPermission`）,
 *    `/permission read-only` 在 blank session 首 prompt 前**有效**
 *    （命令执行不开 turn, 纯 log-only append; sandbox mode 每次受限调用
 *    折叠 — 首 turn 的每次工具执行都读到 read-only）。故 `/permission`
 *    步是**强制**的（preset 不能替代它）— 路径 A 定案, fallback 路径 B
 *    （host `ctx.subagents.start` + `toolFilter`）不实现（任务书: 能确认
 *    即定案 A）。
 *
 * ## INV-PERM-3 类型面（任务目标 2 的编译期半边）
 *
 * 启动请求 `InvestigatorLaunchRequest` 是**闭集**: 恰好 4 个字段
 * （`presetId` / `permissionPreset` / `cwd` / `task`）, 其中
 * `presetId` / `permissionPreset` 是**字面量类型**（只能取
 * `INVESTIGATOR_PRESET_ID` / `READ_ONLY_PERMISSION_PRESET`）— 请求面
 * **不存在** sandbox mode / approval policy / tools / capabilities 字段,
 * 写能力在类型上无法表达（连「选择」都写不出来）。运行时伪造（cast /
 * 多余键）由 `guard.ts` 的闭集断言在触达宿主前拒绝（`IVL_WRITE_CAPABILITY`
 * — 非白名单能力即拒, 零宿主调用）; 适配器在端口边界**再断言一次**
 * （决策所在操作处执行决策 — 双钉, 同 WP-5.1 `assertUserActor` 先例）。
 *
 * Layer (ARCHITECTURE §2.2): service — 纯逻辑, 无 DSH import (INV-PERM-5),
 * 无 I/O。端口 `DshAgentLauncherAdapter` 在本文件声明（任务书授权目录
 * 约束下的落点, 偏离说明见报告「偏离与豁免」）, 实现在
 * `src/host/dsh-adapter/launcher/`（WP-7.1 同批交付, host 半边）。
 */

import type { TypedRef } from '../../history/registry/index.js'
import type { InterventionOrigin } from '../flooding/index.js'

/* ------------------------------------------------------------------ *
 * 闭集常量（INV-PERM-3 — 字面量即边界）
 * ------------------------------------------------------------------ */

/**
 * The agent preset the plugin authors and the launcher mounts
 * (`research-investigator/agent.cordis.yml` under the user preset root
 * `$DSH_HOME/.agent-presets` — DSH_ADAPTER §10.2 路径 A step 3 「专用
 * agent preset（agent.cordis.yml 只挂只读工具）」）。The id IS a path
 * segment (DSH `PRESET_ID = /^[a-z0-9][a-z0-9-]*$/`), so a lowercase
 * hyphenated literal.
 */
export const INVESTIGATOR_PRESET_ID = 'research-investigator'

/**
 * The permission preset the launcher submits as `/permission read-only`
 * (DSH_ADAPTER §10.2 路径 A step 2). The name is FROZEN by the host's
 * preset table (checkout `packages/bundle/base/cordis.patch.yml:197-199`:
 * `read-only: {sandbox: read-only, approval: ask}` — the web profile) and
 * by the `SandboxMode` vocabulary (`packages/sandbox/sandbox-policy/src/
 * session-mode.ts:42` — `'read-only'` is the first, fail-safe mode;
 * `sandbox-policy/src/index.ts:94` default). Only this literal is
 * launchable — `workspace-write` / `danger-full-access` are compile
 * errors on the request face (INV-PERM-3 类型面).
 */
export const READ_ONLY_PERMISSION_PRESET = 'read-only'

/**
 * The closed set of DSH tool packages the investigator preset
 * composition may mount (DSH_ADAPTER §10.2: 「preset 只注册只读工具」—
 * INV-PERM-3 第一层). Chosen for 计划书 §26.1 可读清单:
 *  - `@deepseek-ai/dsh-tool-bash` — workspace files + Git history/diff
 *    (read commands; every write is rejected by the read-only sandbox
 *    backend — session-mode.ts:11-12 「EXECUTION honors the same fold」);
 *  - `@deepseek-ai/dsh-tool-fs-search` — pure workspace file search
 *    (no write function exists in the tool).
 * `@deepseek-ai/dsh-tool-fs` is deliberately EXCLUDED (its `write`/`edit`
 * functions would sit in the catalog and be rejected per-call — noise for
 * the model; bash + search cover §26.1's file reads). The 4 read-only
 * research tools (ARCHITECTURE §7.2) need no preset row: the plugin's
 * host service registers them on the GLOBAL tools layer, and the
 * per-agent restriction below denies only the writable 7.
 */
export const INVESTIGATOR_PRESET_TOOL_NAMES: readonly string[] = [
  '@deepseek-ai/dsh-tool-bash',
  '@deepseek-ai/dsh-tool-fs-search',
]

/**
 * The closed set of capabilities a read-only Investigator may have —
 * the whitelist the runtime assertion measures against（INV-PERM-3:
 * 「无任何写路径」; 计划书 §26.1 可读清单的机械编码）。**No write
 * capability exists in the set — not even as a refused option**（the
 * matrix column is all-❌, ARCHITECTURE §6）.
 */
export const INVESTIGATOR_CAPABILITIES: readonly string[] = [
  'read-workspace-files',
  'read-git-history',
  'read-research-state',
]

/**
 * The research tools the investigator agent must NOT see (Gate P7 二:
 * 「无 plan/history mutation tool」). Exactly the §7.2 writable group
 * (WP-3.3 冻结面 `WRITE_TOOL_NAMES`, 同值不复制 — 单一来源) — the
 * adapter's per-agent `tools.restrict({deny})` list
 * (DSH checkout `packages/core/tools/src/index.ts:680-685`
 * `ToolRestriction` — per-scope filter over global tools; the 4 read-only
 * research tools stay visible — they ARE the investigator's research-state
 * readers, 计划书 §26.1).
 */
import { WRITE_TOOL_NAMES } from '../../tools/index.js'
export const INVESTIGATOR_DENIED_TOOL_NAMES: readonly string[] = WRITE_TOOL_NAMES

/* ------------------------------------------------------------------ *
 * 一键启动缝（Gate P7 三: 「能从 Intervention 一键启动并引用相关上下文」）
 * ------------------------------------------------------------------ */

/**
 * The one-click launch context（任务目标 3）: everything the launcher
 * needs, referenced FROM an Intervention（计划书 §26.1: 「用户在某个
 * Intervention / Audit finding / Brief 中点击『进一步解释』时启动」）.
 * Built by `buildInvestigationContext`（context.ts）from an
 * `InterventionRecord`（WP-3.5 冻结行形状, 经 WP-5.1 服务查询面取得）+
 * the user's question + the research workspace root.
 */
export interface InvestigationContext {
  /** `IV-<n>` — the Intervention the launch is about（引用相关上下文 ①）. */
  readonly interventionId: string
  /** The Intervention's title（引用相关上下文 ②）. */
  readonly title: string
  /** The Intervention's mechanical evidence detail, when present（②）. */
  readonly detail?: string
  /** The Intervention's origin（§1.4 4 值闭集 — 溯源, ②）. */
  readonly origin: InterventionOrigin
  /** The Intervention's linked workstreams（③ — the scope the agent may read）. */
  readonly workstreamIds: readonly string[]
  /** The Intervention's source refs（④ — 指向触发对象, e.g. 相关 PF）. */
  readonly sourceRefs: readonly TypedRef[]
  /** The user's investigation question（trim 后非空）. */
  readonly question: string
  /** The research workspace root（absolute; 只读沙箱的 workspace 边界 —
   * DSH `SandboxPolicyService.resolve`: 「A session cwd is its
   * workspace-write boundary」, read-only 下同样界内只读）. */
  readonly cwd: string
}

/* ------------------------------------------------------------------ *
 * 启动请求（INV-PERM-3 类型面 — 闭集 4 字段, 两个字面量）
 * ------------------------------------------------------------------ */

/**
 * The closed-set read-only launch request. EXACTLY four fields — no
 * sandbox mode, no approval policy, no tools, no capabilities, no signal,
 * no sessionId: a write capability cannot be EXPRESSED on this face
 * （INV-PERM-3 编译期半边; 运行时伪造由 guard.ts 拒绝）.
 */
export interface InvestigatorLaunchRequest {
  /** Closed literal — only the plugin's investigator preset is launchable. */
  readonly presetId: typeof INVESTIGATOR_PRESET_ID
  /** Closed literal — only the read-only permission preset is launchable. */
  readonly permissionPreset: typeof READ_ONLY_PERMISSION_PRESET
  /** Absolute workspace root（the session cwd; read-only sandbox boundary）. */
  readonly cwd: string
  /** The investigation task prompt（rendered by `investigationTask`, 纯文本）. */
  readonly task: string
}

/**
 * The settled result of one launch（transient 输出的宿主引用 — INV-PERM-3:
 * 输出默认 transient, 仅用户显式保存才落 AnalysisRecord — 落地面归
 * WP-7.3, 本结果不虚构持久化）.
 */
export interface InvestigatorLaunchResult {
  /** The live session id the investigator agent drives. */
  readonly sessionId: string
  /** The agent preset id the session runs under（absent: the deployment
   * composes no preset roster — the session runs the host composition;
   * the read-only guarantee then rests on the restriction + sandbox
   * layers alone, documented in the adapter）. */
  readonly presetId?: string
  /** The permission preset submitted（always `read-only` — echo of the
   * closed request field, for the caller's record）. */
  readonly permissionPreset: typeof READ_ONLY_PERMISSION_PRESET
  /** The task prompt submitted（echo — the session transcript carries
   * the durable copy）. */
  readonly task: string
}

/* ------------------------------------------------------------------ *
 * 端口（ARCHITECTURE §2.3 行 8 — DshAgentLauncherAdapter）
 * ------------------------------------------------------------------ */

/**
 * Host-side adapter port（ARCHITECTURE §2.3: 「只读 Investigator Agent 的
 * 受限启动」; DSH_ADAPTER §10.2 映射行）: ensure preset →
 * `session.create({agentPreset, cwd})`（host 面: `ctx.agents.create` +
 * preset `setup`）→ `command('/permission read-only')`（blank-session
 * safe, U5 定案）→ `prompt(task)`（host 面: `agent.followup`）.
 *
 * The implementation（`src/host/dsh-adapter/launcher/`）re-asserts the
 * closed request set at the port boundary — the adapter is the operation
 * that touches the host, so the write-path denial executes there too
 * （双钉; 宿主面永不收到伪造请求）.
 */
export interface DshAgentLauncherAdapter {
  /**
   * Launch one read-only investigator session and submit its task.
   * @param request - the closed-set launch request（4 fields, two
   *   literals; anything else is an INV-PERM-3 violation）.
   * @returns the settled launch result（sessionId + echoes）.
   * @throws {@link InvestigatorLaunchError} on every denial/failure —
   *   the launch is all-or-nothing（session + agent 创建失败回滚由宿主
   *   agent 工厂保证: setup 抛错即整体回滚, 不发布半配置会话 — checkout
   *   `packages/core/agent/src/index.ts:114-126`）.
   */
  launchInvestigator(request: InvestigatorLaunchRequest): Promise<InvestigatorLaunchResult>
}

/* ------------------------------------------------------------------ *
 * 错误面（IVL_ 前缀 — 同 IV_ / IN_ 服务错误模式: class + code + guard）
 * ------------------------------------------------------------------ */

/** 闭集错误码（`IVL_` = investigator launcher）. */
export type InvestigatorErrorCode =
  /** 模块边界参数畸形（坏 id / 空 question / 非 absolute cwd / 空 task — 精确指名失败项）. */
  | 'IVL_INPUT'
  /** INV-PERM-3 运行面: 请求携带非白名单能力（多余键 / 已知能力键
   *   sandbox/approval/tools/… — 写能力注入即拒, 零宿主调用）. */
  | 'IVL_WRITE_CAPABILITY'
  /** preset ensure/resolve 失败（ensure 后仍 unknown / 宿主面异常 — cause 保留）. */
  | 'IVL_PRESET'
  /** 宿主任册报告 preset broken（组合不可装载）. */
  | 'IVL_PRESET_BROKEN'
  /** preset 组合回读解析失败 / 行不在闭集只读集（写工具混入即拒）. */
  | 'IVL_PRESET_NOT_READONLY'
  /** `/permission read-only` 不可用或报错（部署 preset 表缺 read-only 行 —
   *   非 web profile; 命令未注册）. */
  | 'IVL_PERMISSION'
  /** `agents.create`（session + agent 创建 + setup 组合）失败（cause 保留）. */
  | 'IVL_LAUNCH'

export class InvestigatorLaunchError extends Error {
  readonly code: InvestigatorErrorCode
  constructor(init: { code: InvestigatorErrorCode; message: string; cause?: unknown }) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause })
    this.name = 'InvestigatorLaunchError'
    this.code = init.code
  }
}

export function isInvestigatorLaunchError(error: unknown): error is InvestigatorLaunchError {
  return error instanceof InvestigatorLaunchError
}
