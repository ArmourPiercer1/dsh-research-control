/**
 * WP-7.4 / G7 S1b — 一键调查通道（client 半）测试。
 *
 * 覆盖（fetch 结构化 stub — 载包契约逐字钉, 契约按 pin 版 dsh@0.1.0-rc.8
 * 实机 wire 验证 — 见 investigate.ts 头注「Why not session.prompt」）:
 *  - 请求面: /api/commands/execute + client-request 载包（type/rpcId/
 *    method='commands/execute' 逐字）+ payload = 网关 remote-args 契约
 *    （单 plain-object args 字段: agentId / line = 共享单源命令行 /
 *    images 空 — 位置数组 payload 会被宿主拒「exactly one plain-object
 *    args field」, 本面逐字钉对象形）;
 *  - 成功面: server-response ok + value.result success ⇒ ok 结果 + 消息
 *    逐字 + 被启动会话 id 回解（共享成功文本单源）;
 *  - 失败面: envelope ok:false（RPC 错误变体 — code/message 结构化透出
 *    `[code] message`）/ 命令 handler 自身 error 结果（`[IVL_*]` 逐字,
 *    ok:false 结果而非 throw — GUI fault 行可渲染）;
 *  - 契约偏离面: 无 sessionId（fetch 零调用, 本地 fail loud）/ 坏 IV
 *    id（构建器拒）/ 空问题（构建器拒）/ 非 2xx / 非 JSON / 非
 *    server-response / ok:true 无 value（命令未解析 — 注册面偏离）/
 *    成功但无 success text / 成功文本无 id 标记 ⇒ 全部 throw（GUI 大声
 *    点名, 不吞）;
 *  - 13-RPC 无关性: 通道零 researchRpc 依赖（纯载包 fetch — 本套件
 *    不挂 research remotes, 通道照常工作 = 结构性证明）; 通道面是 DSH
 *    内置 `commands` 网关域（宿主 UI 执行 `/` 命令的同一载体）, 非插件
 *    13-RPC — 清单零 diff。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  investigateIntervention,
  type InvestigateChannelOutcome,
} from '../src/client/dsh-adapter/remote/investigate.js'
import {
  INVESTIGATION_COMMAND_NAME,
  INVESTIGATION_SUCCESS_TEXT,
} from '../src/shared/investigation-command.js'

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

afterEach(() => {
  vi.unstubAllGlobals()
})

/** 一个成功 envelope（commands/execute 值槽 = CommandResult 内联 —
 *  pin 版实机 wire 形状）. */
function okEnvelope(sessionId: string) {
  return {
    type: 'server-response',
    rpcId: 'r1',
    result: {
      ok: true,
      value: {
        commandId: 'cmd-1',
        result: { kind: 'success', text: INVESTIGATION_SUCCESS_TEXT(sessionId) },
      },
    },
  }
}

describe('一键调查通道 — 请求面（载包契约逐字钉）', () => {
  it('合法提交: /api/commands/execute + client-request 载包 + 单对象 args（agentId/line/images）', async () => {
    const { calls } = stubFetch({ body: okEnvelope('investigator-1') })
    await investigateIntervention({ sessionId: 'sess-current', interventionId: 'IV-1', question: '为什么 PF 在堆积?' })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('/api/commands/execute')
    const body = JSON.parse(String(calls[0]?.init.body)) as {
      type: string
      rpcId: string
      method: string
      payload: { args: { agentId: string; line: string; images: unknown[] } }
    }
    expect(body.type).toBe('client-request')
    expect(body.method).toBe('commands/execute')
    expect(typeof body.rpcId).toBe('string')
    expect(body.rpcId.length).toBeGreaterThan(0)
    // payload = 网关 remote-args 契约: 恰好一个 plain-object args 字段
    // （位置数组形会被宿主 descriptor 拒 — 实机验证）.
    expect(Object.keys(body.payload)).toEqual(['args'])
    expect(body.payload.args.agentId).toBe('sess-current')
    expect(body.payload.args.line).toBe(`/${INVESTIGATION_COMMAND_NAME} IV-1 为什么 PF 在堆积?`)
    expect(body.payload.args.images).toEqual([])
  })

  it('问题内部空白经共享构建器折叠（命令行 = 单行）', async () => {
    const { calls } = stubFetch({ body: okEnvelope('investigator-1') })
    await investigateIntervention({ sessionId: 's', interventionId: 'IV-3', question: '  问题A   问题B ' })
    const body = JSON.parse(String(calls[0]?.init.body)) as {
      payload: { args: { line: string } }
    }
    expect(body.payload.args.line).toBe(`/${INVESTIGATION_COMMAND_NAME} IV-3 问题A 问题B`)
  })
})

describe('一键调查通道 — 成功/失败面', () => {
  it('成功: ok 结果 + 消息逐字 + 被启动会话 id 回解', async () => {
    stubFetch({ body: okEnvelope('investigator-abc-123') })
    const outcome: InvestigateChannelOutcome = await investigateIntervention({
      sessionId: 'sess-current',
      interventionId: 'IV-1',
      question: 'q',
    })
    expect(outcome.ok).toBe(true)
    expect(outcome.message).toBe(INVESTIGATION_SUCCESS_TEXT('investigator-abc-123'))
    expect(outcome.sessionId).toBe('investigator-abc-123')
  })

  it('命令 handler 自身 error 结果（IVL_* 映射）: ok:false + 消息逐字（非 throw — fault 行可渲染）', async () => {
    stubFetch({
      body: {
        type: 'server-response',
        rpcId: 'r1',
        result: {
          ok: true,
          value: {
            commandId: 'cmd-2',
            result: { kind: 'error', text: '[IVL_PERMISSION] /permission read-only 未注册 — 无只读化不降级启动' },
          },
        },
      },
    })
    const outcome = await investigateIntervention({ sessionId: 's', interventionId: 'IV-1', question: 'q' })
    expect(outcome).toEqual({ ok: false, message: '[IVL_PERMISSION] /permission read-only 未注册 — 无只读化不降级启动' })
  })

  it('RPC 级错误（ok:false — agent 查找失败等）: [code] message 逐字', async () => {
    stubFetch({
      body: {
        type: 'server-response',
        rpcId: 'r1',
        result: {
          ok: false,
          error: { code: 'agent-not-found', message: 'agent gone', details: {} },
        },
      },
    })
    const outcome = await investigateIntervention({ sessionId: 's', interventionId: 'IV-1', question: 'q' })
    expect(outcome.ok).toBe(false)
    expect(outcome.message).toBe('[agent-not-found] agent gone')
  })
})

describe('一键调查通道 — fail-loud 面（契约偏离不吞）', () => {
  it('空 sessionId ⇒ 本地 throw, fetch 零调用（先于网络的守卫）', async () => {
    const { calls } = stubFetch({ body: okEnvelope('x') })
    await expect(
      investigateIntervention({ sessionId: '', interventionId: 'IV-1', question: 'q' }),
    ).rejects.toThrow(/无宿主会话 id/)
    expect(calls).toHaveLength(0)
  })

  it('坏 IV id ⇒ 共享构建器 throw, fetch 零调用', async () => {
    const { calls } = stubFetch({ body: okEnvelope('x') })
    await expect(
      investigateIntervention({ sessionId: 's', interventionId: 'IV-0', question: 'q' }),
    ).rejects.toThrow(/intervention id/)
    expect(calls).toHaveLength(0)
  })

  it('空问题 ⇒ 共享构建器 throw, fetch 零调用', async () => {
    const { calls } = stubFetch({ body: okEnvelope('x') })
    await expect(
      investigateIntervention({ sessionId: 's', interventionId: 'IV-1', question: '   ' }),
    ).rejects.toThrow(/non-blank/)
    expect(calls).toHaveLength(0)
  })

  it('非 2xx ⇒ throw（载包契约偏离 — 宿主回归, GUI 必须显示）', async () => {
    stubFetch({ status: 500, body: { boom: true } })
    await expect(
      investigateIntervention({ sessionId: 's', interventionId: 'IV-1', question: 'q' }),
    ).rejects.toThrow(/HTTP 500/)
  })

  it('非 JSON 响应 ⇒ throw（不可解码载包）', async () => {
    stubFetch({ rawText: '<html>not json</html>' })
    await expect(
      investigateIntervention({ sessionId: 's', interventionId: 'IV-1', question: 'q' }),
    ).rejects.toThrow(/不是合法的 apiproxy 载包/)
  })

  it('非 server-response 类型 ⇒ throw', async () => {
    stubFetch({ body: { type: 'server-request', rpcId: 'r1', method: 'x', payload: {} } })
    await expect(
      investigateIntervention({ sessionId: 's', interventionId: 'IV-1', question: 'q' }),
    ).rejects.toThrow(/server-response/)
  })

  it('ok:true 无 value（命令未解析 — 插件 host 半未注册的组合偏离）⇒ throw', async () => {
    stubFetch({ body: { type: 'server-response', rpcId: 'r1', result: { ok: true } } })
    await expect(
      investigateIntervention({ sessionId: 's', interventionId: 'IV-1', question: 'q' }),
    ).rejects.toThrow(/未解析出命令/)
  })

  it('成功但无 success text（单源成功文本必须携带会话 id）⇒ throw', async () => {
    stubFetch({
      body: {
        type: 'server-response',
        rpcId: 'r1',
        result: { ok: true, value: { commandId: 'cmd-3', result: { kind: 'success' } } },
      },
    })
    await expect(
      investigateIntervention({ sessionId: 's', interventionId: 'IV-1', question: 'q' }),
    ).rejects.toThrow(/无 success text/)
  })

  it('成功文本无会话 id 标记（INVESTIGATION_SUCCESS_TEXT 单源漂移）⇒ throw', async () => {
    stubFetch({
      body: {
        type: 'server-response',
        rpcId: 'r1',
        result: { ok: true, value: { commandId: 'cmd-4', result: { kind: 'success', text: '无标记的文本' } } },
      },
    })
    await expect(
      investigateIntervention({ sessionId: 's', interventionId: 'IV-1', question: 'q' }),
    ).rejects.toThrow(/无被启动会话 id 标记/)
  })
})
