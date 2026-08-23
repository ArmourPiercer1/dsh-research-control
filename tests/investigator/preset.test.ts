/**
 * WP-7.1 — preset 面测试（DSH_ADAPTER §10.2 路径 A step 3 — INV-PERM-3
 * 第一层「preset 只注册只读工具」的构造 + 回读解析; 任务测试项「preset
 * 解析」+「写路径拒绝（preset 行混入写工具被拒）」）。
 *
 * 覆盖:
 *  - `renderInvestigatorPresetComposition` 逐字钉（注释审计面 + 闭集
 *    2 行; 非闭集 presetId ⇒ IVL_INPUT）;
 *  - `parsePresetComposition` 回读闭环（render → parse 同构）;
 *  - 写工具行 / 非白名单行 / 多余键（config/disabled/group）/ 重复行 /
 *    非 list / 空 list / 坏 YAML ⇒ IVL_PRESET_NOT_READONLY（指名拒因 —
 *    非白名单能力即拒）;
 *  - `assertReadonlyPermissionPreset` 闭集守卫（只认 read-only 字面量 —
 *    U5 定案: /permission 是 sandbox 收敛唯一合法入口）。
 */

import { describe, expect, it } from 'vitest'

import {
  assertReadonlyPermissionPreset,
  INVESTIGATOR_PRESET_ID,
  isInvestigatorLaunchError,
  parsePresetComposition,
  renderInvestigatorPresetComposition,
  type InvestigatorPresetSpec,
} from '../../src/host/service/investigator/index.js'

/** 捕获 preset 解析错误（精确错误面 + 拒因断言）。 */
function expectPresetRejection(fn: () => unknown, needle: string): void {
  let caught: unknown
  try {
    fn()
  } catch (error) {
    caught = error
  }
  if (caught === undefined || !isInvestigatorLaunchError(caught) || caught.code !== 'IVL_PRESET_NOT_READONLY') {
    throw new Error(`expected IVL_PRESET_NOT_READONLY matching ${JSON.stringify(needle)}, got ${caught === undefined ? 'no throw' : String(caught)}`)
  }
  if (!caught.message.includes(needle)) {
    throw new Error(`IVL_PRESET_NOT_READONLY message must name ${JSON.stringify(needle)} — got: ${caught.message}`)
  }
}

describe('renderInvestigatorPresetComposition（闭集构造 — 逐字钉）', () => {
  it('闭集 2 行 + 只读契约注释（agent.cordis.yml 全文冻结）', () => {
    expect(renderInvestigatorPresetComposition(INVESTIGATOR_PRESET_ID)).toBe(
      '# research-investigator — read-only Investigator agent preset (dsh-research-control WP-7.1).'
      + '\n#'
      + '\n# AGENT-PLANE composition: read-only tools ONLY (INV-PERM-3 layer 1 —'
      + '\n# DSH_ADAPTER §10.2 「preset 只注册只读工具」). The write path is excluded at'
      + '\n# THREE layers: this composition (no write tool registers), the per-agent'
      + '\n# tools.restrict() deny list over the research write set, and the'
      + '\n# `/permission read-only` sandbox mode (the fs/bash backends reject every'
      + '\n# write — the preset itself CANNOT set the sandbox mode: the permission'
      + '\n# stack is host-plane, U5 resolution — see the plugin WP-7.1 report).'
      + '\n#'
      + '\n# Do not add rows: the plugin launcher parses this file back and refuses'
      + '\n# to launch when a row is not in its closed read-only set.'
      + '\n- id: tool-bash'
      + "\n  name: '@deepseek-ai/dsh-tool-bash'"
      + '\n- id: tool-fs-search'
      // 文件尾换行（agent.cordis.yml 落盘形态 — YAML 文件惯例）。
      + "\n  name: '@deepseek-ai/dsh-tool-fs-search'\n",
    )
  })

  it('非闭集 presetId ⇒ IVL_INPUT（插件只拥有一个 investigator preset）', () => {
    let caught: unknown
    try {
      renderInvestigatorPresetComposition('other-preset')
    } catch (error) {
      caught = error
    }
    if (caught === undefined || !isInvestigatorLaunchError(caught) || caught.code !== 'IVL_INPUT') {
      throw new Error(`expected IVL_INPUT, got ${String(caught)}`)
    }
    expect(caught.message).toContain('research-investigator')
  })
})

describe('parsePresetComposition（严格回读 — 非白名单能力即拒）', () => {
  it('render → parse 闭环: 行序 + 闭集 2 行同构', () => {
    const spec: InvestigatorPresetSpec = parsePresetComposition(INVESTIGATOR_PRESET_ID, renderInvestigatorPresetComposition(INVESTIGATOR_PRESET_ID))
    expect(spec.id).toBe('research-investigator')
    expect(spec.rows).toEqual([
      { id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash' },
      { id: 'tool-fs-search', name: '@deepseek-ai/dsh-tool-fs-search' },
    ])
    expect(Object.isFrozen(spec)).toBe(true)
    expect(Object.isFrozen(spec.rows)).toBe(true)
  })

  it('手写等价组合（行序不同）也过解析（解析不依赖渲染器）', () => {
    const spec = parsePresetComposition(INVESTIGATOR_PRESET_ID, [
      "- id: search",
      "  name: '@deepseek-ai/dsh-tool-fs-search'",
      '- id: shell',
      "  name: '@deepseek-ai/dsh-tool-bash'",
      '',
    ].join('\n'))
    expect(spec.rows.map(row => row.name)).toEqual(['@deepseek-ai/dsh-tool-fs-search', '@deepseek-ai/dsh-tool-bash'])
  })

  it.each([
    ['@deepseek-ai/dsh-tool-fs', 'write/edit 函数面 — 只读工具集外'],
    ['@deepseek-ai/dsh-tool-str-replace-editor', '写编辑器工具'],
    ['@deepseek-ai/dsh-tool-web', '非闭集插件（闭集外即拒, 不猜只读性）'],
    ['@deepseek-ai/dsh-tool-ralph', '递归启动能力 — 绝不在 investigator 面'],
  ])('写/非白名单工具行 %s ⇒ 拒（指名该行 + 闭集）', (name) => {
    expectPresetRejection(
      () => parsePresetComposition(INVESTIGATOR_PRESET_ID, `- id: x\n  name: '${name}'\n`),
      name,
    )
  })

  it('多余键 config ⇒ 拒（行形状闭集 {id,name} — 未审计的键不猜语义）', () => {
    expectPresetRejection(
      () => parsePresetComposition(INVESTIGATOR_PRESET_ID, "- id: bash\n  name: '@deepseek-ai/dsh-tool-bash'\n  config:\n    timeoutMs: 1\n"),
      'closed row shape',
    )
  })

  it('多余键 disabled ⇒ 拒（disabled 行改变有效组合 — 闭集外形态）', () => {
    expectPresetRejection(
      () => parsePresetComposition(INVESTIGATOR_PRESET_ID, "- id: bash\n  name: '@deepseek-ai/dsh-tool-bash'\n  disabled: true\n"),
      'closed row shape',
    )
  })

  it('group 行 ⇒ 拒（嵌套行集 = 闭集外的自由度）', () => {
    expectPresetRejection(
      () => parsePresetComposition(INVESTIGATOR_PRESET_ID, '- id: g\n  group: true\n  config:\n    - id: x\n      name: \'@deepseek-ai/dsh-tool-bash\'\n'),
      'closed row shape',
    )
  })

  it('缺 name / 缺 id / 空 id ⇒ 拒', () => {
    expectPresetRejection(() => parsePresetComposition(INVESTIGATOR_PRESET_ID, '- id: bash\n'), 'closed row shape')
    expectPresetRejection(() => parsePresetComposition(INVESTIGATOR_PRESET_ID, "- name: '@deepseek-ai/dsh-tool-bash'\n"), 'closed row shape')
    expectPresetRejection(() => parsePresetComposition(INVESTIGATOR_PRESET_ID, "- id: ''\n  name: '@deepseek-ai/dsh-tool-bash'\n"), 'string "id"')
  })

  it('重复 name ⇒ 拒', () => {
    expectPresetRejection(
      () => parsePresetComposition(
        INVESTIGATOR_PRESET_ID,
        "- id: a\n  name: '@deepseek-ai/dsh-tool-bash'\n- id: b\n  name: '@deepseek-ai/dsh-tool-bash'\n",
      ),
      'duplicates',
    )
  })

  it.each([
    ['map 文档', 'top: value\n'],
    ['标量文档', 'just a string\n'],
    ['空 list', '[]\n'],
  ])('%s ⇒ 拒（指名 composition 形状）', (_label, yamlText) => {
    expectPresetRejection(() => parsePresetComposition(INVESTIGATOR_PRESET_ID, yamlText), 'composition')
  })

  it('坏 YAML ⇒ 拒（指名 not parseable）', () => {
    expectPresetRejection(() => parsePresetComposition(INVESTIGATOR_PRESET_ID, '- id: [unterminated\n'), 'not parseable YAML')
  })

  it('非 map 行（标量行）⇒ 拒', () => {
    expectPresetRejection(() => parsePresetComposition(INVESTIGATOR_PRESET_ID, '- just-a-string\n'), 'plugin row')
  })
})

describe('assertReadonlyPermissionPreset（/permission 参数闭集 — U5 定案）', () => {
  it('read-only 字面量放行（唯一可启动的 permission preset）', () => {
    expect(() => assertReadonlyPermissionPreset('read-only')).not.toThrow()
  })

  it.each([
    'workspace-write',
    'danger-full-access',
    'Read-Only',
    'unknown-preset',
  ])('%s ⇒ IVL_WRITE_CAPABILITY（指名 + INV-PERM-3）', (name) => {
    let caught: unknown
    try {
      assertReadonlyPermissionPreset(name)
    } catch (error) {
      caught = error
    }
    if (caught === undefined || !isInvestigatorLaunchError(caught) || caught.code !== 'IVL_WRITE_CAPABILITY') {
      throw new Error(`expected IVL_WRITE_CAPABILITY for ${name}, got ${String(caught)}`)
    }
    expect(caught.message).toContain(name)
    expect(caught.message).toContain('INV-PERM-3')
  })
})
