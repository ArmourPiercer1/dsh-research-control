/**
 * WP-7.4 / G7 S1 — DSH 内置 `commands/execute` 网关域的 client 载包
 * （一键调查通道 + analysis 数据面通道的**共用**执行器 — 一条载包路径
 * 只有一处实现, 两个消费者不各自镜像封包契约）。
 *
 * ## 载包契约（冻结宿主面 — pin 版 dsh@0.1.0-rc.8 实机 wire 验证, 见
 * `investigate.ts` 头注）:
 *  - 路由: `POST /api/commands/execute`（宿主 apiproxy 的 `/api` 载包
 *    代理注册域 `/<domain>/<method>` — 与 `/api/researchControl/<method>`
 *    13-RPC 面同一条路由, 但目标是 DSH 内置 `commands` 域, **非**插件
 *    RPC — ARCHITECTURE §7.1 13-RPC 清单零 diff 的构造方式）;
 *  - 请求封包: `{type:'client-request', rpcId, method:'commands/execute',
 *    payload:{args}}`（单 plain-object `args` 字段 — 网关 remote-args
 *    契约 `{agentId, line, images}`; 位置数组形会被宿主 descriptor 拒 —
 *    实机钉）;
 *  - 响应封包: `{type:'server-response', rpcId, result:{ok,value|error}}`;
 *    `commands/execute` 的 value 携带命令的 `CommandResult` 内联
 *    （`{commandId, result:{kind:'success',text?}|{kind:'error',text}}`）;
 *    未解析命令 = `ok:true` **无** value（注册面偏离 — 大声, 不猜）。
 *
 * ## 失败面（契约偏离不吞 — 全部 throw, GUI 必须显示）:
 *  - 非 2xx / 不可解码封包 / 非 server-response / ok:true 无 value ⇒
 *    throw（宿主回归的组合面偏离 — 吞掉 = 缺口沉默）;
 *  - envelope `ok:false`（RPC 错误变体 — 网关 agent 查找失败 /
 *    descriptor 不匹配 …）⇒ `{kind:'error'}` 结构化结果（`[code]
 *    message` 逐字 — 消费者渲染 fault 行, 非 throw）;
 *  - 命令 handler 自身 `kind:'error'` 结果 ⇒ `{kind:'error'}`（handler
 *    的文本已携带 `[CODE] …` 前缀 — 逐字透出）。
 *
 * 零 DSH import（纯 same-origin fetch over 冻结封包 — check-imports
 * 0 违规; 本模块在 dsh-adapter/remote 领地 = 载包面归属纪律, 与
 * `mount.ts` 同目录, 零 cordis 触点）。
 */

/** One settled command execution over the carrier. */
export type CommandExecuteOutcome =
  | { readonly kind: 'success'; readonly text: string | undefined }
  | { readonly kind: 'error'; readonly message: string }

/** The apiproxy client-request envelope（frozen contract mirror —
 *  checkout `packages/host/apiproxy/src/api/rpc.schema.ts`）. */
interface ClientRequestEnvelope {
  readonly type: 'client-request'
  readonly rpcId: string
  readonly method: string
  readonly payload: unknown
}

/** The gateway `commands/execute` remote args（typert descriptor
 *  `{agentId, line, images}` — the single plain-object args field the
 *  carrier requires）. */
interface CommandExecuteArgs {
  readonly agentId: string
  readonly line: string
  readonly images: readonly unknown[]
}

/** The apiproxy server-response envelope（frozen contract mirror）.
 *  The `commands/execute` value carries the command's `CommandResult`
 *  inline（pinned-rc.8 wire shape — verified live）; an unresolved
 *  command answers `ok:true` WITHOUT a value. */
interface ServerResponseEnvelope {
  readonly type: 'server-response'
  readonly rpcId: string
  readonly result:
    | {
        readonly ok: true
        readonly value?: {
          readonly commandId: string
          readonly result:
            | { readonly kind: 'success'; readonly text?: string }
            | { readonly kind: 'error'; readonly text: string }
        }
      }
    | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }
}

/**
 * Execute one slash-command line ADDRESSED to the given host session
 * over the built-in `commands/execute` gateway.
 * @param sessionId - the CURRENT host session id（the command executes
 *  for this session's agent; its `command/run` / `command/done`
 *  lifecycle lands in this session's log with `source.kind 'user'` —
 *  the user-visible command card）.
 * @param line - the complete slash-command line（the shared single-
 *  source builders in `src/shared/` — never hand-rolled here）.
 * @throws {Error} on any carrier-contract deviation（non-2xx,
 *  undecodable envelope, non-server-response, unresolved command）.
 */
export async function executeHostCommand(sessionId: string, line: string): Promise<CommandExecuteOutcome> {
  const args: CommandExecuteArgs = { agentId: sessionId, line, images: [] }
  const envelope: ClientRequestEnvelope = {
    type: 'client-request',
    rpcId: makeRpcId(),
    method: 'commands/execute',
    payload: { args },
  }

  const response = await fetch('/api/commands/execute', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(envelope),
  })
  if (!response.ok) {
    throw new Error(`commands 载包通道: /api/commands/execute 返回 HTTP ${response.status}（宿主 apiproxy 契约偏离 — 需大声报出）`)
  }
  const text = await response.text()
  let decoded: ServerResponseEnvelope
  try {
    decoded = JSON.parse(text) as ServerResponseEnvelope
  } catch {
    throw new Error(`commands 载包通道: 响应不是合法的 apiproxy 载包（前 120 字符: ${text.slice(0, 120)}）`)
  }
  if (decoded.type !== 'server-response') {
    throw new Error(`commands 载包通道: 响应 type=${String(decoded.type)}（非 server-response — 契约偏离）`)
  }
  if (decoded.result.ok === false) {
    const code = decoded.result.error.code
    const message = decoded.result.error.message
    return { kind: 'error', message: `[${code}] ${message}` }
  }
  const execution = decoded.result.value
  if (execution === undefined) {
    throw new Error('commands 载包通道: commands/execute 成功但未解析出命令（该行指向的插件 host 命令未在宿主命令注册表 — 注册面偏离, 大声点名）')
  }
  if (execution.result.kind === 'error') {
    // The handler's own failure（its text already carries the `[CODE]`
    // prefix — verbatim, the consumer renders the fault line）.
    return { kind: 'error', message: execution.result.text }
  }
  return { kind: 'success', text: execution.result.text }
}

/** A client-side rpcId（the apiproxy `rpcIdSchema` is a plain string —
 *  uniqueness is correlation-only, the server does not mint it）. */
function makeRpcId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `research-cmd-${crypto.randomUUID()}`
  }
  return `research-cmd-${Date.now()}-${Math.random().toString(16).slice(2)}`
}
