/**
 * WP-7.1 — Investigator preset 面（DSH_ADAPTER §10.2 路径 A step 3:
 * 「专用 agent preset（agent.cordis.yml 只挂只读工具; 样例
 * apps/cli/config/agent-presets/standard/）」— INV-PERM-3 第一层）。
 *
 * 三个纯函数（无 I/O — 文件落盘归 dsh-adapter/launcher 的 ensure 步,
 * 本模块只拥有组合文本的**构造**与**回读解析**）:
 *
 *  - `renderInvestigatorPresetComposition(presetId)` — 渲染
 *    `agent.cordis.yml`（确定性文本 — 注释是审计面, tests 逐字钉）;
 *    行集 = 闭集 `INVESTIGATOR_PRESET_TOOL_NAMES`（types.ts）, 逐行
 *    `{id, name}` — **唯一例外**: `tool-fs-search` 行携带恰好一个
 *    上游必需 config 键 `sampleOverCapGlobResults: false`（pin 版
 *    dsh@0.1.0-rc.8: 该键 required 无 fallback — 缺失即 mount 失败
 *    「$.sampleOverCapGlobResults missing required value」, 实机 TC-
 *    DSH-010 发现; 值 = 上游 standard/code preset 同行逐字。语义 =
 *    over-cap glob 分页的**读呈现**排序〔true 采样 / false 保 mtime
 *    序头〕— 零写能力面, README 实核）。除此无 config / 无 group /
 *    无 disabled — 组合面没有其他自由度（闭集即一行一工具, 例外键
 *    单源钉死在本模块）;
 *  - `parsePresetComposition(yamlText)` — **严格**解析: 顶层 list,
 *    每行恰为 `{id, name}`（fs-search 行额外恰为 `{id, name,
 *    config:{sampleOverCapGlobResults: false}}` — 值/键漂移即拒）且
 *    `name` ∈ 闭集只读集（**写工具行混入即拒** — 非白名单能力即拒,
 *    INV-PERM-3 运行面; group/disabled/多余键/其他 config 键一律拒 —
 *    行形状闭集, 不猜）;
 *  - `assertReadonlyPermissionPreset(name)` — `/permission` 参数闭集
 *    守卫: 只认 `READ_ONLY_PERMISSION_PRESET` 字面量（preset 表其余行
 *    `workspace-write` / `danger-full-access` 是写能力, 编译期已不可达,
 *    运行面再钉一道 — 同 assertUserActor 先例）。
 *
 * preset 解析的 U5 依据: preset 是 **agent-plane** 组合（挂载在 agent
 * scope 下的插件行 — checkout `packages/preset/agent-presets/src/mount.ts`
 * `mountPreset`）, **不能**钉 host-plane 的 sandbox mode（证据链见报告
 * 「U5 消解」专节）— 所以本组合只收敛**工具面**, sandbox 收敛由
 * `/permission read-only` 承担（路径 A 第二步, 强制）。
 */

import { parse as parseYaml } from 'yaml'
import {
  INVESTIGATOR_PRESET_ID,
  INVESTIGATOR_PRESET_TOOL_NAMES,
  READ_ONLY_PERMISSION_PRESET,
} from './types.js'
import { InvestigatorLaunchError } from './types.js'

/**
 * The audited config face — the ONE upstream-required key the fs-search
 * row must carry（pin 版 dsh@0.1.0-rc.8 `dsh-tool-fs-search`: required,
 * no fallback — the upstream `standard`/`code` presets set it to `false`
 * verbatim; checkout the shipped `standard` / `code` preset rows）. Pure
 * read-presentation ordering（over-cap glob pages: `false` keeps the
 * modification-time-ordered head）— no write-capability face.
 */
const FS_SEARCH_CONFIG = { sampleOverCapGlobResults: false } as const

/** The fs-search package name（the one row that carries the config）. */
const FS_SEARCH_TOOL_NAME = '@deepseek-ai/dsh-tool-fs-search'

/** 一个解析后的 preset 行（闭集形状: 恰好 id + name; fs-search 行
 *  额外携带恰好一个审计过的 config 键）。 */
export interface InvestigatorPresetRow {
  /** The row's local id（preset 内唯一, 小写连字符 — 镜像 DSH `PRESET_ID`）. */
  readonly id: string
  /** The plugin package name（闭集成员 — 白名单判定键）. */
  readonly name: string
  /** fs-search 行 only — the upstream-required read-presentation key,
   *  pinned `false`（upstream standard preset verbatim）。其他行携带
   *  config 即拒（闭集）。 */
  readonly config?: { readonly sampleOverCapGlobResults: false }
}

/** 一个解析后的 preset 组合（行序保真 — 文档序即挂载序）。 */
export interface InvestigatorPresetSpec {
  /** The preset id the composition belongs to（目录名约定 — 解析入参）。 */
  readonly id: string
  /** The rows in document order（闭集成员, 无重复）. */
  readonly rows: readonly InvestigatorPresetRow[]
}

/**
 * 渲染 `research-investigator` 的 `agent.cordis.yml` 文本（确定性 —
 * 同一闭集永远渲染同一文本, tests 逐字钉; 注释声明只读契约与「勿加行」
 * 纪律 — launcher 会回读解析并拒绝非闭集行）。
 *
 * @param presetId - the preset id（必须是 `INVESTIGATOR_PRESET_ID` —
 *   本插件只拥有这一个 investigator preset; 其他 id 是 IVL_INPUT,
 *   防误用）。
 * @returns the complete composition text.
 * @throws {@link InvestigatorLaunchError} `IVL_INPUT` — 非闭集 presetId.
 */
export function renderInvestigatorPresetComposition(presetId: string): string {
  if (presetId !== INVESTIGATOR_PRESET_ID) {
    throw new InvestigatorLaunchError({
      code: 'IVL_INPUT',
      message: `renderInvestigatorPresetComposition: presetId must be "${INVESTIGATOR_PRESET_ID}" (the plugin authors exactly one investigator preset), got ${JSON.stringify(presetId)}`,
    })
  }
  const rows = INVESTIGATOR_PRESET_TOOL_NAMES.map((name) => {
    const lines = [`- id: ${name.replace(/^@deepseek-ai\/dsh-/, '')}`, `  name: '${name}'`]
    if (name === FS_SEARCH_TOOL_NAME) {
      // The upstream-required read-presentation key（pinned `false` —
      // upstream standard preset verbatim; see FS_SEARCH_CONFIG doc）.
      lines.push('  config:', '    sampleOverCapGlobResults: false')
    }
    return lines.join('\n')
  })
  return [
    `# ${INVESTIGATOR_PRESET_ID} — read-only Investigator agent preset (dsh-research-control WP-7.1).`,
    '#',
    '# AGENT-PLANE composition: read-only tools ONLY (INV-PERM-3 layer 1 —',
    '# DSH_ADAPTER §10.2 「preset 只注册只读工具」). The write path is excluded at',
    '# THREE layers: this composition (no write tool registers), the per-agent',
    '# tools.restrict() deny list over the research write set, and the',
    '# `/permission read-only` sandbox mode (the fs/bash backends reject every',
    '# write — the preset itself CANNOT set the sandbox mode: the permission',
    '# stack is host-plane, U5 resolution — see the plugin WP-7.1 report).',
    '#',
    '# Do not add rows or config keys: the plugin launcher parses this file',
    '# back and refuses to launch when a row (or the one audited fs-search',
    '# config key) is not in its closed read-only set.',
    ...rows,
    '',
  ].join('\n')
}

/**
 * 严格解析 `agent.cordis.yml`（回读面 — ensure 后 / 挂载前, launcher 用
 * 它证明「将挂载的组合」是闭集只读的）。
 *
 * 拒（`IVL_PRESET_NOT_READONLY`, reason 进 message）:
 *  - 非 YAML / 非顶层 list / 空 list;
 *  - 行非 map / `id` 或 `name` 缺失非字符串;
 *  - `name` ∉ 闭集只读集（**写工具行 = 写能力注入, 即拒** — 包括
 *    `@deepseek-ai/dsh-tool-fs`（write/edit 函数）、
 *    `@deepseek-ai/dsh-tool-str-replace-editor` 等任何非白名单插件）;
 *  - 多余键（`disabled` / `group` / 其他行上的 `config` — 行形状闭集:
 *    一个未被闭集审计过的键不猜语义）。**唯一例外**: fs-search 行恰
 *    携带 `config: {sampleOverCapGlobResults: false}`（上游 required 键
 *    的审计值 — 键多/键少/值非 `false` 即拒, 不猜语义）;
 *  - 重复 `name`。
 *
 * @param presetId - the preset id the file belongs to（记录进 spec）.
 * @param yamlText - the composition text.
 * @returns the parsed closed spec（行序保真）.
 * @throws {@link InvestigatorLaunchError} `IVL_PRESET_NOT_READONLY`.
 */
export function parsePresetComposition(presetId: string, yamlText: string): InvestigatorPresetSpec {
  const fail = (reason: string): never => {
    throw new InvestigatorLaunchError({
      code: 'IVL_PRESET_NOT_READONLY',
      message: `parsePresetComposition(${presetId}): ${reason}`,
    })
  }
  let document: unknown
  try {
    document = parseYaml(yamlText)
  } catch (error) {
    return fail(`not parseable YAML: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!Array.isArray(document)) {
    return fail('the composition must be a top-level list of plugin rows')
  }
  if (document.length === 0) {
    return fail('the composition is empty (a preset with no tools is not the investigator)')
  }
  const allowed = new Set(INVESTIGATOR_PRESET_TOOL_NAMES)
  const rows: InvestigatorPresetRow[] = []
  const seenNames = new Set<string>()
  for (let i = 0; i < document.length; i += 1) {
    const row = document[i]
    const at = `row ${String(i + 1)}`
    if (typeof row !== 'object' || row === null || Array.isArray(row)) {
      return fail(`${at} is not a plugin row (expected a map with "id" and "name")`)
    }
    const keys = Object.keys(row)
    const hasConfig = keys.includes('config')
    const allowedKeys = hasConfig ? ['config', 'id', 'name'] : ['id', 'name']
    if (
      keys.length !== allowedKeys.length
      || !keys.includes('id')
      || !keys.includes('name')
      || (hasConfig && keys.length === 2)
    ) {
      return fail(`${at} carries keys ${JSON.stringify(keys.sort())} — the closed row shape is exactly {id, name} (fs-search may add the one audited config key; no disabled/group: an unaudited key is not admitted)`)
    }
    const { id, name, config } = row as { id: unknown; name: unknown; config?: unknown }
    if (typeof id !== 'string' || id === '') {
      return fail(`${at} has no string "id"`)
    }
    if (typeof name !== 'string' || name === '') {
      return fail(`${at} has no string "name"`)
    }
    if (!allowed.has(name)) {
      return fail(`${at} names "${name}" — not in the closed read-only set [${INVESTIGATOR_PRESET_TOOL_NAMES.join(', ')}] (a non-whitelisted capability is refused — INV-PERM-3)`)
    }
    if (seenNames.has(name)) {
      return fail(`${at} duplicates "${name}"`)
    }
    seenNames.add(name)
    // The config exception is AUDITED to exactly one key on exactly one
    // row: fs-search + {sampleOverCapGlobResults: false}（上游 required
    // 读呈现键 — 别行带 config / 键集偏离 / 值非 false 全拒）。
    if (hasConfig) {
      if (name !== FS_SEARCH_TOOL_NAME) {
        return fail(`${at} (${name}) carries a config block — only the fs-search row may carry the one audited key`)
      }
      if (typeof config !== 'object' || config === null || Array.isArray(config)) {
        return fail(`${at} config must be a plain map`)
      }
      const configKeys = Object.keys(config)
      if (configKeys.length !== 1 || configKeys[0] !== 'sampleOverCapGlobResults') {
        return fail(`${at} config carries keys ${JSON.stringify(configKeys.sort())} — the audited config face is exactly {sampleOverCapGlobResults: false}`)
      }
      if ((config as { sampleOverCapGlobResults?: unknown }).sampleOverCapGlobResults !== false) {
        return fail(`${at} config.sampleOverCapGlobResults must be exactly false (the upstream standard-preset value — other values are unaudited)`)
      }
      rows.push(Object.freeze({ id, name, config: FS_SEARCH_CONFIG }))
      continue
    }
    if (name === FS_SEARCH_TOOL_NAME) {
      return fail(`${at} (fs-search) carries no config — the upstream-required key sampleOverCapGlobResults: false must be present (a mount without it fails on the real machine)`)
    }
    rows.push(Object.freeze({ id, name }))
  }
  return Object.freeze({ id: presetId, rows: Object.freeze(rows) })
}

/**
 * `/permission` 参数闭集守卫（路径 A 第二步的参数面 — U5 定案: preset
 * 不能钉 sandbox mode, 此命令是 sandbox 收敛的**唯一**合法入口, 且只
 * 认 read-only 字面量）。
 *
 * @param name - the permission preset name a launch would submit.
 * @throws {@link InvestigatorLaunchError} `IVL_WRITE_CAPABILITY` —
 *   任何非 `read-only` 名字（`workspace-write` / `danger-full-access` /
 *   未知名 — 指名 + INV-PERM-3）。
 */
export function assertReadonlyPermissionPreset(name: string): void {
  if (name !== READ_ONLY_PERMISSION_PRESET) {
    throw new InvestigatorLaunchError({
      code: 'IVL_WRITE_CAPABILITY',
      message: `assertReadonlyPermissionPreset: "${name}" is not the read-only permission preset (the investigator launches ONLY "${READ_ONLY_PERMISSION_PRESET}" — every other preset carries a write-capable sandbox mode — INV-PERM-3)`,
    })
  }
}
