/**
 * WP-7.4 / G7 S1 — analysis 数据面生产 provider（client 半）测试。
 *
 * 覆盖（fetch 结构化 stub — 载包契约同 investigate 通道口径; 本套件
 * 不挂 research remotes, provider 照常工作 = **13-RPC 无关性的结构性
 * 证明**: 通道走 DSH 内置 `commands/execute` 网关域, 非插件 RPC —
 * 清单零 diff）:
 *  - 请求面: /api/commands/execute + client-request 载包 + 单对象 args
 *    （agentId = 当前宿主会话 id 现读 / line = 共享单源命令行 /
 *    images 空）— 三个方法各自的命令行逐字钉;
 *  - 成功面: transient 快照 / 记录列表 / 保存产物 JSON 回解 + 形状门;
 *    会话 id 现读（闭包每次执行重读, 不缓存挂载时旧值）;
 *  - 失败面: 命令 error 结果（宿主 `[AN_*]` / 语法）⇒ throw 携带逐字
 *    文本（操作失败 — 容器 fault 面渲染, 数据面不提交半载荷）;
 *  - 契约偏离面: 空白会话 id（fetch 零调用, 本地大声）/ 保存坏载荷
 *    （构建器 throw, 零 fetch）/ 非 2xx / 非 JSON / 非 server-response /
 *    命令未解析（ok 无 value）/ 成功无载荷文本 / 载荷非 JSON / 载荷形状
 *    偏离 ⇒ 全部 throw（GUI 大声点名, 不吞不降级）;
 *  - provider 面: 三方法在位 + 工厂无模块级状态（两个工厂结果互不串
 *    会话 — 闭包隔离）。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createCommandAnalysisDataProvider } from '../src/client/dsh-adapter/remote/analysis-channel.js'
import {
  ANALYSIS_LIST_COMMAND_NAME,
  ANALYSIS_SAVE_COMMAND_NAME,
  ANALYSIS_TRANSIENT_READ_COMMAND_NAME,
} from '../src/shared/analysis-command.js'

interface CarrierCall {
  url: string
  init: RequestInit
}

function stubFetch(response: { status?: number; body?: unknown; rawText?: string }): { calls: CarrierCall[] } {
  const calls: CarrierCall[] = []
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input)
    calls.push({ url, init: init ?? {} })
    return new Response(response.rawText !== undefined ? response.rawText : JSON.stringify(response.body), {
      status: response.status ?? 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  vi.stubGlobal('fetch', fetchImpl)
  return { calls }
}

/** 按调用序返回不同响应（多次命令序列 — 每次 fetch 一个响应面）。 */
function stubFetchQueued(responses: { status?: number; body?: unknown; rawText?: string }[]): { calls: CarrierCall[] } {
  const calls: CarrierCall[] = []
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input)
    calls.push({ url, init: init ?? {} })
    const response = responses[Math.min(calls.length - 1, responses.length - 1)] as { status?: number; body?: unknown; rawText?: string }
    return new Response(response.rawText !== undefined ? response.rawText : JSON.stringify(response.body), {
      status: response.status ?? 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  vi.stubGlobal('fetch', fetchImpl)
  return { calls }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

/** 一个成功 envelope（value 槽 = 命令 success 文本 — pin 版 wire 形状）。 */
function okEnvelope(text?: string) {
  return {
    type: 'server-response',
    rpcId: 'r1',
    result: {
      ok: true,
      value: {
        commandId: 'cmd-1',
        result: text === undefined ? { kind: 'success' } : { kind: 'success', text },
      },
    },
  }
}

/** 一个 error envelope（envelope ok:false — 网关 RPC 错误变体）。 */
function errEnvelope(code: string, message: string) {
  return {
    type: 'server-response',
    rpcId: 'r1',
    result: { ok: false, error: { code, message } },
  }
}

const TRANSIENT_PAYLOAD = JSON.stringify({
  sessionId: 'investigator-live-1',
  session: { id: 'investigator-live-1', cwd: '/ws/project', title: null, running: false, createdAt: 1_700_000_000_000 },
  pointer: null,
  run: null,
})

const RECORD_PAYLOAD = JSON.stringify([
  { id: 'AN-1', sourceRef: { kind: 'INTERVENTION', id: 'IV-1' }, investigatorRunId: null, dshSessionId: null, content: 'c', createdAt: 1_700_000_001_000 },
])

const SAVED_PAYLOAD = JSON.stringify({
  id: 'AN-9',
  sourceRef: { kind: 'INTERVENTION', id: 'IV-1' },
  investigatorRunId: null,
  dshSessionId: 'investigator-live-1',
  content: '保存的分析',
  createdAt: 1_700_000_009_000,
})

describe('analysis 数据面 provider — 请求面（载包契约逐字钉）', () => {
  it('readTransient: /api/commands/execute + 单对象 args（agentId 现读 + 共享命令行 + images 空）', async () => {
    const { calls } = stubFetch({ body: okEnvelope(TRANSIENT_PAYLOAD) })
    const provider = createCommandAnalysisDataProvider(() => 'sess-current')
    await provider.readTransient('investigator-live-1')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('/api/commands/execute')
    const body = JSON.parse(String(calls[0]?.init.body)) as {
      type: string
      method: string
      payload: { args: { agentId: string; line: string; images: unknown[] } }
    }
    expect(body.type).toBe('client-request')
    expect(body.method).toBe('commands/execute')
    expect(Object.keys(body.payload)).toEqual(['args'])
    expect(body.payload.args.agentId).toBe('sess-current')
    expect(body.payload.args.line).toBe(`/${ANALYSIS_TRANSIENT_READ_COMMAND_NAME} investigator-live-1`)
    expect(body.payload.args.images).toEqual([])
  })

  it('listAnalysisRecords: 命令行逐字（无参）+ 成功面回解', async () => {
    const { calls } = stubFetch({ body: okEnvelope(RECORD_PAYLOAD) })
    const provider = createCommandAnalysisDataProvider(() => 'sess-1')
    const records = await provider.listAnalysisRecords()
    expect(calls[0]?.init).toBeTruthy()
    const body = JSON.parse(String(calls[0]?.init.body)) as { payload: { args: { line: string } } }
    expect(body.payload.args.line).toBe(`/${ANALYSIS_LIST_COMMAND_NAME}`)
    expect(records).toEqual([
      { id: 'AN-1', sourceRef: { kind: 'INTERVENTION', id: 'IV-1' }, investigatorRunId: null, dshSessionId: null, content: 'c', createdAt: 1_700_000_001_000 },
    ])
  })

  it('saveAnalysisRecord: 命令行 = 共享构建器（单行 JSON 载荷逐字）+ 产物回解', async () => {
    const { calls } = stubFetch({ body: okEnvelope(SAVED_PAYLOAD) })
    const provider = createCommandAnalysisDataProvider(() => 'sess-1')
    const args = { sourceRef: { kind: 'INTERVENTION', id: 'IV-1' }, content: '保存的分析' }
    const saved = await provider.saveAnalysisRecord(args)
    const body = JSON.parse(String(calls[0]?.init.body)) as { payload: { args: { line: string } } }
    expect(body.payload.args.line).toBe(`/${ANALYSIS_SAVE_COMMAND_NAME} ${JSON.stringify(args)}`)
    expect(saved).toEqual({
      id: 'AN-9',
      sourceRef: { kind: 'INTERVENTION', id: 'IV-1' },
      investigatorRunId: null,
      dshSessionId: 'investigator-live-1',
      content: '保存的分析',
      createdAt: 1_700_000_009_000,
    })
  })

  it('会话 id 现读: 闭包每次执行重读（会话切换后不打旧会话）', async () => {
    const { calls } = stubFetchQueued([{ body: okEnvelope(TRANSIENT_PAYLOAD) }, { body: okEnvelope(RECORD_PAYLOAD) }])
    let current = 'sess-old'
    const provider = createCommandAnalysisDataProvider(() => current)
    await provider.readTransient('s-1')
    current = 'sess-new'
    await provider.listAnalysisRecords()
    const agentIds = calls.map((call) => {
      const body = JSON.parse(String(call.init.body)) as { payload: { args: { agentId: string } } }
      return body.payload.args.agentId
    })
    expect(agentIds).toEqual(['sess-old', 'sess-new'])
  })
})

describe('analysis 数据面 provider — 失败面（不吞不降级）', () => {
  it('envelope ok:false（网关错误变体）⇒ throw 携带 [code] message', async () => {
    stubFetch({ body: errEnvelope('agent-not-found', 'no agent "sess-x"') })
    const provider = createCommandAnalysisDataProvider(() => 'sess-x')
    await expect(provider.readTransient('s-1')).rejects.toThrow(/\[agent-not-found\] no agent "sess-x"/)
  })

  it('命令 error 结果（宿主 AN_ 映射）⇒ throw 携带逐字文本', async () => {
    stubFetch({
      body: {
        type: 'server-response',
        rpcId: 'r1',
        result: {
          ok: true,
          value: {
            commandId: 'cmd-2',
            result: { kind: 'error', text: '[AN_STORE] list failed: no such table' },
          },
        },
      },
    })
    const provider = createCommandAnalysisDataProvider(() => 's-1')
    await expect(provider.listAnalysisRecords()).rejects.toThrow(/\[AN_STORE\] list failed: no such table/)
  })

  it('保存失败（宿主用户门/冻结网拒绝）⇒ throw 携带逐字文本（数据面不提交半载荷）', async () => {
    stubFetch({
      body: {
        type: 'server-response',
        rpcId: 'r1',
        result: {
          ok: true,
          value: {
            commandId: 'cmd-3',
            result: { kind: 'error', text: '[AN_INPUT] saveAsAnalysisRecord.content must be non-blank' },
          },
        },
      },
    })
    const provider = createCommandAnalysisDataProvider(() => 's-1')
    await expect(
      provider.saveAnalysisRecord({ sourceRef: { kind: 'INTERVENTION', id: 'IV-1' }, content: 'c' }),
    ).rejects.toThrow(/\[AN_INPUT\]/)
  })
})

describe('analysis 数据面 provider — 契约偏离面（全 throw, GUI 大声点名）', () => {
  it('空白会话 id ⇒ throw + fetch 零调用（先于网络, 不猜目标会话）', async () => {
    const { calls } = stubFetch({ body: okEnvelope(TRANSIENT_PAYLOAD) })
    const provider = createCommandAnalysisDataProvider(() => '')
    await expect(provider.readTransient('s-1')).rejects.toThrow(/无宿主会话 id/)
    await expect(provider.listAnalysisRecords()).rejects.toThrow(/无宿主会话 id/)
    await expect(
      provider.saveAnalysisRecord({ sourceRef: { kind: 'INTERVENTION', id: 'IV-1' }, content: 'c' }),
    ).rejects.toThrow(/无宿主会话 id/)
    expect(calls).toHaveLength(0)
  })

  it('保存坏载荷（空 content — 构建器第二道防线）⇒ throw + fetch 零调用', async () => {
    const { calls } = stubFetch({ body: okEnvelope(SAVED_PAYLOAD) })
    const provider = createCommandAnalysisDataProvider(() => 's-1')
    await expect(
      provider.saveAnalysisRecord({ sourceRef: { kind: 'INTERVENTION', id: 'IV-1' }, content: '   ' }),
    ).rejects.toThrow(/content/)
    expect(calls).toHaveLength(0)
  })

  it('非 2xx ⇒ throw（apiproxy 契约偏离）', async () => {
    stubFetch({ status: 500, rawText: 'boom' })
    const provider = createCommandAnalysisDataProvider(() => 's-1')
    await expect(provider.listAnalysisRecords()).rejects.toThrow(/HTTP 500/)
  })

  it('非 JSON 响应 ⇒ throw（封包不可解码）', async () => {
    stubFetch({ rawText: '<html>not json</html>' })
    const provider = createCommandAnalysisDataProvider(() => 's-1')
    await expect(provider.readTransient('s-1')).rejects.toThrow(/不是合法的 apiproxy 载包/)
  })

  it('非 server-response ⇒ throw（响应类型偏离）', async () => {
    stubFetch({ body: { type: 'something-else', result: {} } })
    const provider = createCommandAnalysisDataProvider(() => 's-1')
    await expect(provider.readTransient('s-1')).rejects.toThrow(/server-response/)
  })

  it('命令未解析（ok 无 value — 注册面偏离）⇒ throw（不猜命令结果）', async () => {
    stubFetch({ body: { type: 'server-response', rpcId: 'r1', result: { ok: true } } })
    const provider = createCommandAnalysisDataProvider(() => 's-1')
    await expect(provider.listAnalysisRecords()).rejects.toThrow(/未解析出命令/)
  })

  it('成功无载荷文本（单源漂移）⇒ throw', async () => {
    stubFetch({ body: okEnvelope(undefined) })
    const provider = createCommandAnalysisDataProvider(() => 's-1')
    await expect(provider.readTransient('s-1')).rejects.toThrow(/无载荷文本/)
  })

  it('载荷非 JSON（契约偏离）⇒ throw', async () => {
    stubFetch({ body: okEnvelope('这不是 JSON') })
    const provider = createCommandAnalysisDataProvider(() => 's-1')
    await expect(provider.listAnalysisRecords()).rejects.toThrow(/不是合法 JSON/)
  })

  it('载荷形状偏离（列表非数组 / 记录缺字段）⇒ throw（不渲染半记录）', async () => {
    stubFetch({ body: okEnvelope(JSON.stringify({ id: 'AN-1' })) })
    const provider = createCommandAnalysisDataProvider(() => 's-1')
    await expect(provider.listAnalysisRecords()).rejects.toThrow(/形状偏离/)

    stubFetch({ body: okEnvelope(JSON.stringify({ id: 'AN-1', content: 'c', createdAt: 1 })) })
    await expect(
      provider.saveAnalysisRecord({ sourceRef: { kind: 'INTERVENTION', id: 'IV-1' }, content: 'c' }),
    ).rejects.toThrow(/AnalysisRecord 载荷形状偏离/)
  })
})

describe('analysis 数据面 provider — 工厂纪律', () => {
  it('两个工厂结果闭包隔离（无模块级状态 — 会话读取器互不串）', async () => {
    const { calls } = stubFetch({ body: okEnvelope(TRANSIENT_PAYLOAD) })
    const providerA = createCommandAnalysisDataProvider(() => 'sess-A')
    const providerB = createCommandAnalysisDataProvider(() => 'sess-B')
    await providerA.readTransient('s-1')
    await providerB.readTransient('s-2')
    const agentIds = calls.map((call) => {
      const body = JSON.parse(String(call.init.body)) as { payload: { args: { agentId: string } } }
      return body.payload.args.agentId
    })
    expect(agentIds).toEqual(['sess-A', 'sess-B'])
  })
})
