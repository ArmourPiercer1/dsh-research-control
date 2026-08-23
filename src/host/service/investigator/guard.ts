/**
 * WP-7.1 — INV-PERM-3 运行面（任务目标 2 的运行半边: 「运行时断言
 * （非白名单能力即拒）」）。
 *
 * 类型面（types.ts 闭集 4 字段 + 两个字面量）挡不住**运行时**伪造:
 * `as InvestigatorLaunchRequest` cast、JSON 反序列化、原型注入都能带进
 * 多余键。守卫在**触达宿主前**把闭集重新验一遍（launcher 的 build 后
 * 一验 + 适配器端口边界再一验 — 双钉）:
 *
 *  - 键闭集: 请求对象的自有属性键必须 ⊆ {presetId, permissionPreset,
 *    cwd, task}（多余键 — 无论叫什么 — 即非白名单能力, 拒）;
 *  - 能力键具名拒: 已知写能力键（sandbox / sandboxMode / approval /
 *    approvalPolicy / mode / policy / tools / capabilities / capability /
 *    permission / permissions / write / writable / allowWrite / signal /
 *    sessionId / …）在拒因里**指名**（INV-PERM-3: 写能力注入零容忍,
 *    错误消息是审计面）;
 *  - 值闭集: presetId / permissionPreset 必须逐字等于字面量常量;
 *    cwd 必须 absolute; task 必须非空纯文本字符串;
 *  - 原型纯净: 请求对象必须是 null-原型或 Object 原型（原型链上夹带
 *    方法/字段 = 注入面, 拒）。
 *
 * 全部拒绝 = `IVL_WRITE_CAPABILITY`（非白名单能力即拒 — 单一错误码,
 * 字段名进 message）或 `IVL_INPUT`（值畸形 — 闭集内但值不合法）;
 * 零宿主调用（断言在 agents.create / commands.execute 之前, 失败路径
 * 不碰宿主 — tests 以假宿主计数钉死）。
 */

import {
  INVESTIGATOR_PRESET_ID,
  READ_ONLY_PERMISSION_PRESET,
  type InvestigationContext,
  type InvestigatorLaunchRequest,
} from './types.js'
import { InvestigatorLaunchError } from './types.js'

/** 请求闭集键（types.ts 的 4 字段 — 单一来源, 不复制字面）。 */
const REQUEST_KEYS: readonly string[] = ['presetId', 'permissionPreset', 'cwd', 'task']

/**
 * 已知写能力键（具名拒因 — 审计面: 错误消息点名「这是写能力」而非
 * 泛泛的未知键）。键集是**识别表**不是白名单: 白名单是 REQUEST_KEYS,
 * 这里只为拒因措辞服务（未知多余键同样拒, 只是措辞为 unknown field）。
 */
const KNOWN_CAPABILITY_KEYS: ReadonlyMap<string, string> = new Map([
  ['sandbox', 'a sandbox mode override'],
  ['sandboxMode', 'a sandbox mode override'],
  ['approval', 'an approval policy override'],
  ['approvalPolicy', 'an approval policy override'],
  ['mode', 'a sandbox mode override'],
  ['policy', 'an approval policy override'],
  ['tools', 'a tool set override'],
  ['toolFilter', 'a tool filter override (path B host capability — not a launch parameter)'],
  ['capabilities', 'a capability list override'],
  ['capability', 'a capability override'],
  ['permission', 'a permission override'],
  ['permissions', 'a permission override'],
  ['write', 'a write-capability flag'],
  ['writable', 'a write-capability flag'],
  ['allowWrite', 'a write-capability flag'],
  ['signal', 'a caller cancellation signal (not a launch parameter)'],
  ['sessionId', 'a preallocated session id (not a launch parameter)'],
  ['parent', 'a parent-session capability (not a launch parameter)'],
  ['persona', 'a persona override (not a launch parameter)'],
  ['outputSchema', 'an output schema (not a launch parameter)'],
  ['maxDepth', 'a delegation depth (not a launch parameter)'],
])

function ownKeys(value: object): string[] {
  return Object.getOwnPropertyNames(value)
}

function prototypeIsClean(value: object): boolean {
  const proto = Object.getPrototypeOf(value)
  return proto === null || proto === Object.prototype
}

/**
 * 闭集断言: 一个启动请求是否可提交给宿主（INV-PERM-3 运行面）。
 *
 * @param request - the candidate request（可以是任何值 — 非对象即
 *   IVL_INPUT; 键/值/原型逐层验）.
 * @throws {@link InvestigatorLaunchError} `IVL_INPUT`（非对象 / 值畸形）
 *   或 `IVL_WRITE_CAPABILITY`（多余键 / 字面量不符 — 指名 + INV-PERM-3）。
 */
export function assertReadonlyLaunchRequest(request: InvestigatorLaunchRequest): void {
  if (typeof request !== 'object' || request === null || Array.isArray(request)) {
    throw new InvestigatorLaunchError({
      code: 'IVL_INPUT',
      message: `assertReadonlyLaunchRequest: the launch request must be an object, got ${request === null ? 'null' : typeof request}`,
    })
  }
  if (!prototypeIsClean(request)) {
    throw new InvestigatorLaunchError({
      code: 'IVL_WRITE_CAPABILITY',
      message: 'assertReadonlyLaunchRequest: the launch request carries a non-clean prototype (a method or field inherited off Object.prototype is an injection surface — INV-PERM-3)',
    })
  }
  const keys = ownKeys(request)
  for (const key of keys) {
    if (!REQUEST_KEYS.includes(key)) {
      const known = KNOWN_CAPABILITY_KEYS.get(key)
      throw new InvestigatorLaunchError({
        code: 'IVL_WRITE_CAPABILITY',
        message: `assertReadonlyLaunchRequest: the field "${key}" is ${known ?? 'an unknown field'} — the closed launch request carries exactly [${REQUEST_KEYS.join(', ')}]; a non-whitelisted capability is refused (INV-PERM-3)`,
      })
    }
  }
  for (const key of REQUEST_KEYS) {
    if (!keys.includes(key)) {
      throw new InvestigatorLaunchError({
        code: 'IVL_INPUT',
        message: `assertReadonlyLaunchRequest: the field "${key}" is missing (the closed launch request requires exactly [${REQUEST_KEYS.join(', ')}])`,
      })
    }
  }
  if (request.presetId !== INVESTIGATOR_PRESET_ID) {
    throw new InvestigatorLaunchError({
      code: 'IVL_WRITE_CAPABILITY',
      message: `assertReadonlyLaunchRequest: presetId ${JSON.stringify(request.presetId)} is not the investigator preset "${INVESTIGATOR_PRESET_ID}" (only the closed read-only preset is launchable — INV-PERM-3)`,
    })
  }
  if (request.permissionPreset !== READ_ONLY_PERMISSION_PRESET) {
    throw new InvestigatorLaunchError({
      code: 'IVL_WRITE_CAPABILITY',
      message: `assertReadonlyLaunchRequest: permissionPreset ${JSON.stringify(request.permissionPreset)} is not "${READ_ONLY_PERMISSION_PRESET}" (only the read-only permission preset is launchable — INV-PERM-3)`,
    })
  }
  assertAbsoluteCwd(request.cwd)
  if (typeof request.task !== 'string' || request.task.trim() === '') {
    throw new InvestigatorLaunchError({
      code: 'IVL_INPUT',
      message: 'assertReadonlyLaunchRequest: task must be a non-empty string',
    })
  }
}

/**
 * 上下文闭集断言（一键缝的运行面 — build 后 / launch 前; 同口径）。
 *
 * @param context - the candidate context.
 * @throws {@link InvestigatorLaunchError} `IVL_INPUT` / `IVL_WRITE_CAPABILITY`.
 */
export function assertInvestigationContext(context: InvestigationContext): void {
  if (typeof context !== 'object' || context === null || Array.isArray(context)) {
    throw new InvestigatorLaunchError({
      code: 'IVL_INPUT',
      message: 'assertInvestigationContext: the context must be an object',
    })
  }
  if (!prototypeIsClean(context)) {
    throw new InvestigatorLaunchError({
      code: 'IVL_WRITE_CAPABILITY',
      message: 'assertInvestigationContext: the context carries a non-clean prototype (an injection surface — INV-PERM-3)',
    })
  }
  const allowed = ['interventionId', 'title', 'detail', 'origin', 'workstreamIds', 'sourceRefs', 'question', 'cwd']
  for (const key of ownKeys(context)) {
    if (!allowed.includes(key)) {
      const known = KNOWN_CAPABILITY_KEYS.get(key)
      throw new InvestigatorLaunchError({
        code: 'IVL_WRITE_CAPABILITY',
        message: `assertInvestigationContext: the field "${key}" is ${known ?? 'an unknown field'} — the context carries exactly [${allowed.join(', ')}]; a non-whitelisted capability is refused (INV-PERM-3)`,
      })
    }
  }
  if (typeof context.interventionId !== 'string' || !/^IV-\d+$/u.test(context.interventionId)) {
    throw new InvestigatorLaunchError({
      code: 'IVL_INPUT',
      message: `assertInvestigationContext: interventionId must match "IV-<n>", got ${JSON.stringify(context.interventionId)}`,
    })
  }
  if (typeof context.title !== 'string' || context.title.trim() === '') {
    throw new InvestigatorLaunchError({
      code: 'IVL_INPUT',
      message: 'assertInvestigationContext: title must be a non-empty string',
    })
  }
  if (context.detail !== undefined && typeof context.detail !== 'string') {
    throw new InvestigatorLaunchError({
      code: 'IVL_INPUT',
      message: 'assertInvestigationContext: detail must be a string when present',
    })
  }
  if (context.origin !== 'USER' && context.origin !== 'AGENT_REPORT'
    && context.origin !== 'AUTO_FLOODING' && context.origin !== 'AUTO_AUDIT') {
    throw new InvestigatorLaunchError({
      code: 'IVL_INPUT',
      message: `assertInvestigationContext: origin must be one of the §1.4 4 值闭集 [USER, AGENT_REPORT, AUTO_FLOODING, AUTO_AUDIT], got ${JSON.stringify(context.origin)}`,
    })
  }
  if (!Array.isArray(context.workstreamIds) || !context.workstreamIds.every(ws => typeof ws === 'string' && ws !== '')) {
    throw new InvestigatorLaunchError({
      code: 'IVL_INPUT',
      message: 'assertInvestigationContext: workstreamIds must be an array of non-empty strings',
    })
  }
  if (!Array.isArray(context.sourceRefs)
    || !context.sourceRefs.every(ref => typeof ref === 'object' && ref !== null
      && typeof (ref as { kind?: unknown }).kind === 'string'
      && typeof (ref as { id?: unknown }).id === 'string')) {
    throw new InvestigatorLaunchError({
      code: 'IVL_INPUT',
      message: 'assertInvestigationContext: sourceRefs must be an array of {kind, id} refs',
    })
  }
  if (typeof context.question !== 'string' || context.question.trim() === '') {
    throw new InvestigatorLaunchError({
      code: 'IVL_INPUT',
      message: 'assertInvestigationContext: question must be a non-empty string',
    })
  }
  assertAbsoluteCwd(context.cwd)
}

/** absolute 路径守卫（沙箱边界必须是 canonical 绝对路径 — IVL_INPUT）。 */
function assertAbsoluteCwd(cwd: unknown): void {
  if (typeof cwd !== 'string' || !cwd.startsWith('/')) {
    throw new InvestigatorLaunchError({
      code: 'IVL_INPUT',
      message: `assertAbsoluteCwd: cwd must be an absolute path, got ${JSON.stringify(cwd)}`,
    })
  }
}
