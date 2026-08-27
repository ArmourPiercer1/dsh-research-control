/**
 * WP-7.1 — INV-PERM-3 运行面测试（任务目标 2 的测试项「写路径拒绝
 * （尝试注入写能力被拒）」+「参数构造全形态」的断言半边）。
 *
 * 覆盖:
 *  - 合法闭集请求全形态放行（4 键全在 / 键序无关 / 最小值合法）;
 *  - 已知能力键注入逐一拒（sandbox / approval / tools / toolFilter /
 *    signal / sessionId / … — 指名该键 + 其能力语义 + INV-PERM-3）;
 *  - 未知多余键拒（白名单 = 4 键, 其余即非白名单能力）;
 *  - 字面量不符拒（presetId / permissionPreset 非闭集值 — 写能力
 *    字面量在类型上不可表达, 运行面再钉）;
 *  - 值畸形拒（非 absolute cwd / 空 task / 缺键 / 非对象）;
 *  - 原型污染拒（dirty prototype = 注入面）;
 *  - 上下文断言同口径（多余键 / 坏 origin / 坏 ref 形状 / 相对 cwd）。
 *
 * 零宿主调用属性: 断言纯函数 — 失败路径不触达任何端口（launcher 测试
 * 以假端口计数交叉钉死「拒 ⇒ 端口 0 调用」）。
 */

import { describe, expect, it } from 'vitest'

import {
  assertInvestigationContext,
  assertReadonlyLaunchRequest,
  buildInvestigationContext,
  isInvestigatorLaunchError,
  type InvestigationContext,
  type InvestigatorLaunchRequest,
} from '../../src/host/service/investigator/index.js'
import { makeValidRequest } from './fixtures.js'

/** 捕获 IVL_WRITE_CAPABILITY（指名 + INV-PERM-3 面断言）。 */
function expectWriteDenial(fn: () => unknown, needle: string): void {
  let caught: unknown
  try {
    fn()
  } catch (error) {
    caught = error
    // 非 IVL 错误（如意外 TypeError）— 大声, 不吞。
    if (caught !== undefined && !(caught instanceof Error)) {
      throw caught
    }
  }
  if (caught === undefined || !isInvestigatorLaunchError(caught) || caught.code !== 'IVL_WRITE_CAPABILITY') {
    throw new Error(`expected IVL_WRITE_CAPABILITY matching ${JSON.stringify(needle)}, got ${caught === undefined ? 'no throw' : String(caught)}`)
  }
  if (!caught.message.includes(needle)) {
    throw new Error(`IVL_WRITE_CAPABILITY message must name ${JSON.stringify(needle)} — got: ${caught.message}`)
  }
  if (!caught.message.includes('INV-PERM-3')) {
    throw new Error(`IVL_WRITE_CAPABILITY message must cite INV-PERM-3 — got: ${caught.message}`)
  }
}

/** 捕获 IVL_INPUT。 */
function expectInput(fn: () => unknown, needle: string): void {
  let caught: unknown
  try {
    fn()
  } catch (error) {
    caught = error
  }
  if (caught === undefined || !isInvestigatorLaunchError(caught) || caught.code !== 'IVL_INPUT') {
    throw new Error(`expected IVL_INPUT matching ${JSON.stringify(needle)}, got ${caught === undefined ? 'no throw' : String(caught)}`)
  }
  if (!caught.message.includes(needle)) {
    throw new Error(`IVL_INPUT message must name ${JSON.stringify(needle)} — got: ${caught.message}`)
  }
}

describe('assertReadonlyLaunchRequest — 合法闭集全形态放行', () => {
  it('基线请求（4 键全在）放行', () => {
    expect(() => assertReadonlyLaunchRequest(makeValidRequest())).not.toThrow()
  })

  it('键序无关（闭集 = 键集, 非键序）', () => {
    const base = makeValidRequest()
    const reordered = {
      task: base.task,
      cwd: base.cwd,
      permissionPreset: base.permissionPreset,
      presetId: base.presetId,
    }
    expect(() => assertReadonlyLaunchRequest(reordered)).not.toThrow()
  })

  it('null-原型对象放行（Object.create(null) 是合法容器）', () => {
    const base = makeValidRequest()
    const bare = Object.assign(Object.create(null), base)
    expect(() => assertReadonlyLaunchRequest(bare)).not.toThrow()
  })
})

describe('assertReadonlyLaunchRequest — 写能力注入即拒（已知能力键具名）', () => {
  it.each([
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
    ['maxDepth', 'a delegation depth (not a launch parameter)'],
  ])('注入键 %s ⇒ 拒（指名 + 能力语义 + INV-PERM-3）', (key, semantics) => {
    expectWriteDenial(
      () => assertReadonlyLaunchRequest({ ...makeValidRequest(), [key]: 'danger-full-access' } as unknown as InvestigatorLaunchRequest),
      key,
    )
    // 语义面也进消息（审计面: 错误是给人看的）。
    let caught: unknown
    try {
      assertReadonlyLaunchRequest({ ...makeValidRequest(), [key]: true } as unknown as InvestigatorLaunchRequest)
    } catch (error) {
      caught = error
    }
    expect(String((caught as Error).message)).toContain(semantics)
  })

  it('未知多余键 ⇒ 拒（unknown field — 白名单外即非白名单能力）', () => {
    expectWriteDenial(
      () => assertReadonlyLaunchRequest({ ...makeValidRequest(), arbitrary: 1 } as unknown as InvestigatorLaunchRequest),
      'unknown field',
    )
  })

  it('写能力键 + 合法值也拒（值不影响键判定 — sandbox: read-only 也是能力键）', () => {
    expectWriteDenial(
      () => assertReadonlyLaunchRequest({ ...makeValidRequest(), sandbox: 'read-only' } as unknown as InvestigatorLaunchRequest),
      'sandbox',
    )
  })
})

describe('assertReadonlyLaunchRequest — 字面量 / 值畸形 / 容器畸形', () => {
  it('presetId 非闭集字面量 ⇒ IVL_WRITE_CAPABILITY（指名闭集值）', () => {
    expectWriteDenial(
      () => assertReadonlyLaunchRequest(makeValidRequest({ presetId: 'standard' } as unknown as Partial<InvestigatorLaunchRequest>)),
      'standard',
    )
  })

  it('permissionPreset 非闭集字面量 ⇒ IVL_WRITE_CAPABILITY', () => {
    expectWriteDenial(
      () => assertReadonlyLaunchRequest(makeValidRequest({ permissionPreset: 'workspace-write' } as unknown as Partial<InvestigatorLaunchRequest>)),
      'workspace-write',
    )
  })

  it.each([
    ['相对 cwd', { cwd: 'ws/project' }],
    ['空 task', { task: '   ' }],
    ['非字符串 task', { task: 42 }],
  ])('%s ⇒ IVL_INPUT', (_label, overrides) => {
    expectInput(
      () => assertReadonlyLaunchRequest(makeValidRequest(overrides as unknown as Partial<InvestigatorLaunchRequest>)),
      _label === '相对 cwd' ? 'absolute' : 'task',
    )
  })

  it('Windows absolute cwd 被接受（跨平台 — 宿主传入的是原生路径，不是 POSIX 专属）', () => {
    // 回归钉: 用户报障 `rescan failed — internal: repoRoot must be an
    // absolute path (got "D:\Projects\AIUED")` 的同一类校验面（guard 的
    // 沙箱边界守卫与 wiring/hardening 共用跨平台判定）。
    expect(() =>
      assertReadonlyLaunchRequest(makeValidRequest({ cwd: 'D:\\Projects\\AIUED' })),
    ).not.toThrow()
  })

  it.each([
    ['presetId'],
    ['permissionPreset'],
    ['cwd'],
    ['task'],
  ])('缺键 %s ⇒ IVL_INPUT', (key) => {
    const missing = { ...makeValidRequest() } as Record<string, unknown>
    delete missing[key]
    expectInput(() => assertReadonlyLaunchRequest(missing as unknown as InvestigatorLaunchRequest), key)
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['数组', [1, 2]],
    ['字符串', 'request'],
  ])('非对象请求 %s ⇒ IVL_INPUT', (_label, value) => {
    expectInput(() => assertReadonlyLaunchRequest(value as unknown as InvestigatorLaunchRequest), 'object')
  })

  it('dirty prototype（原型链夹带方法）⇒ IVL_WRITE_CAPABILITY', () => {
    const withProto = Object.create({ sneaky: () => 'write' })
    Object.assign(withProto, makeValidRequest())
    expectWriteDenial(() => assertReadonlyLaunchRequest(withProto as unknown as InvestigatorLaunchRequest), 'prototype')
  })
})

describe('assertInvestigationContext（上下文同口径）', () => {
  function makeContext(overrides?: Partial<InvestigationContext>): InvestigationContext {
    return buildInvestigationContext(
      {
        id: 'IV-1',
        title: 't',
        origin: 'USER',
        workstream_ids: [],
        source_refs: [],
        status: 'OPEN',
        created_by: { kind: 'USER' },
        created_at: 0,
        ...overrides,
      },
      'q',
      '/ws',
    )
  }

  it('合法上下文放行', () => {
    expect(() => assertInvestigationContext(makeContext())).not.toThrow()
  })

  it('多余能力键 ⇒ IVL_WRITE_CAPABILITY（指名 + INV-PERM-3）', () => {
    expectWriteDenial(
      () => assertInvestigationContext({ ...makeContext(), tools: [] } as unknown as InvestigationContext),
      'tools',
    )
  })

  it('未知多余键 ⇒ IVL_WRITE_CAPABILITY', () => {
    expectWriteDenial(
      () => assertInvestigationContext({ ...makeContext(), whatever: 1 } as unknown as InvestigationContext),
      'unknown field',
    )
  })

  it('坏 interventionId ⇒ IVL_INPUT', () => {
    const context = makeContext()
    expectInput(() => assertInvestigationContext({ ...context, interventionId: 'WS-1' }), 'IV-<n>')
  })

  it('未知 origin ⇒ IVL_INPUT（指名 4 值闭集）', () => {
    expectInput(
      () => assertInvestigationContext({ ...makeContext(), origin: 'SCIENTIFIC_CONFLICT' } as unknown as InvestigationContext),
      '4 值闭集',
    )
  })

  it('相对 cwd ⇒ IVL_INPUT', () => {
    expectInput(() => assertInvestigationContext({ ...makeContext(), cwd: 'ws' }), 'absolute')
  })

  it('坏 sourceRefs 形状 ⇒ IVL_INPUT', () => {
    expectInput(
      () => assertInvestigationContext({ ...makeContext(), sourceRefs: [{ kind: 'x' }] as never }),
      'sourceRefs',
    )
  })

  it('dirty prototype ⇒ IVL_WRITE_CAPABILITY', () => {
    const withProto = Object.create({ sneaky: true })
    Object.assign(withProto, makeContext())
    expectWriteDenial(() => assertInvestigationContext(withProto as unknown as InvestigationContext), 'prototype')
  })
})
