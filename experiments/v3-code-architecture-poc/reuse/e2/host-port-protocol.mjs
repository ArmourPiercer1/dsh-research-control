// e2 HostPort 协议——「宿主端口缝」的协议正源：同一张协议表，由两个 adapter 实现——
//   ① DSH adapter（宿主进程内，直接调核心对象）；② 非 DSH adapter（stdio JSON-RPC，本切片落地面）。
// 本文件只定义协议面（方法表 / 工具表 / 错误码 / 帧格式），零领域逻辑（领域在 core.mjs）、
// 零宿主 import——任何宿主（DSH / Claude Code 型 / Codex 型）都只依赖本文件 + 自己的 adapter。
//
// 帧格式：stdin/stdout 上的 **换行分隔 JSON（NDJSON）**——每条消息一行，一个 JSON-RPC 2.0 对象。
// 取 MCP stdio 传输的帧形（newline-delimited JSON），方法集为 MCP 形子集：
// initialize / tools/list / tools/call（+ ping）。stdout 只走协议，诊断一律 stderr。

export const PROTOCOL_VERSION = "host-port/1";
export const CORE_NAME = "research-core-e2";
export const CORE_VERSION = "0.1.0";

// —— JSON-RPC 2.0 标准错误码（规范值，不许挪）——————————————————————
export const RPC = Object.freeze({
  PARSE_ERROR: -32700, // 行不是合法 JSON
  INVALID_REQUEST: -32600, // 不是合法请求对象（缺 jsonrpc/method 等）
  METHOD_NOT_FOUND: -32601, // 未知方法
  INVALID_PARAMS: -32602, // 参数不合法
  INTERNAL_ERROR: -32603, // 服务端未分类内部错
});

// —— e2 领域错误码（JSON-RPC server error 保留区 -32000..-32099）———————
export const E2 = Object.freeze({
  POLICY_REFUSED: -32001, // 写侧政策拒绝（E0_REFUSED 透传：拒绝必回错误码，绝不静默接纳）
  LEDGER_CORRUPT: -32002, // 真源 jsonl digest 链断 / 行损坏（读路径 fail-loud）
  NOT_INITIALIZED: -32003, // initialize 之前调 tools/call
  UNKNOWN_TOOL: -32004, // tools/call 指向工具表外名字
});

export const METHODS = Object.freeze({
  INITIALIZE: "initialize", // 宿主声明 name/capabilities/storageRoot → 核心回版本 + 工具表
  TOOLS_LIST: "tools/list", // 工具表（幂等）
  TOOLS_CALL: "tools/call", // { name, arguments } → 工具执行
  PING: "ping", // 存活探测
});

// 工具面 = 四事件命令（工具名与事件名同形，1:1）+ panel.get（面板读）。
export const EVENT_TOOL_NAMES = Object.freeze([
  "assertion.recorded",
  "evidence.linked",
  "assessment.appended",
  "standing.changed",
]);

const EV_ARGS = {
  type: "object",
  properties: {
    data: { type: "object", description: "事件载荷（对象）。各事件必填键见政策；缺字段读回恒 UNKNOWN，禁补全" },
    sourceEventSeqs: {
      type: "array",
      items: { type: "integer", minimum: 0 },
      description: "因果引用：此前已接纳事件的 seq 数组；缺省空数组",
    },
  },
  required: ["data"],
};

export const TOOL_TABLE = Object.freeze([
  Object.freeze({
    name: "assertion.recorded",
    description:
      "写入一条断言事件。data.assertionId 必填；channel 必填且为单值封闭枚举 SOURCE|INFERENCE|SUGGESTION（数组/组合串=混存，必拒）；INFERENCE/SUGGESTION 必须带 basedOn（已接纳 seq）；SOURCE 通道键名命中 /inference|suggestion|llm_/ 必拒。",
    readOnly: false,
    inputSchema: EV_ARGS,
  }),
  Object.freeze({
    name: "evidence.linked",
    description:
      "写入一条证据链接事件。data.evidenceId/assertionId（须已存在）/relation（supports|contradicts|context）必填；locator/quote 可缺——缺省读回恒 UNKNOWN，绝不猜。",
    readOnly: false,
    inputSchema: EV_ARGS,
  }),
  Object.freeze({
    name: "assessment.appended",
    description:
      "追加一条评估事件（不覆盖）。data.assessmentId（唯一）/subjectRef.assertionId（须已存在）必填；stance 可缺——缺省读回恒 UNKNOWN（给默认立场=补全=事故）；禁 _defaulted 族键、禁 null 伪装缺省。",
    readOnly: false,
    inputSchema: EV_ARGS,
  }),
  Object.freeze({
    name: "standing.changed",
    description:
      "写入一条 standing 转移事件（撤回/接纳只表达为事件追加，无 standing 对象）。data.subjectRef.assertionId 必填；from 必须等于当前折叠值（防丢更新）；转移须落封闭集（UNKNOWN/CANDIDATE/ACCEPTED/RETRACTED/CONTESTED 间合法边）。",
    readOnly: false,
    inputSchema: EV_ARGS,
  }),
  Object.freeze({
    name: "panel.get",
    description:
      "面板读：从真源 jsonl（digest 链校验）重放折叠出读面。无 GUI 宿主下返回 markdown 渲染（UI 降级：format=markdown，body 为纯文本）；链断时回错误码 LEDGER_CORRUPT，不返脏读。",
    readOnly: true,
    inputSchema: { type: "object", properties: {} },
  }),
]);

// —— 帧编解码（两个 adapter 共用；客户端与服务端不得各写一套）——————————
export class RpcError extends Error {
  constructor(code, message, data) {
    super(message);
    this.name = "RpcError";
    this.code = code;
    if (data !== undefined) this.data = data;
  }
}

export function encodeMessage(msg) {
  return JSON.stringify(msg); // 调用方追加 "\n"
}

export function decodeLine(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    throw new RpcError(RPC.PARSE_ERROR, "Parse error: line is not valid JSON");
  }
  if (msg === null || typeof msg !== "object" || Array.isArray(msg) || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    throw new RpcError(RPC.INVALID_REQUEST, "Invalid Request: need { jsonrpc:'2.0', method:string, ... }");
  }
  return msg;
}

export function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

export function rpcError(id, code, message, data) {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data !== undefined ? { data } : {}) } };
}

// 协议面自检：工具表漂移（少四事件之一 / 少 panel.get / 多注册）即拒跑。
export function assertToolTableStable() {
  if (TOOL_TABLE.length !== EVENT_TOOL_NAMES.length + 1) throw new Error(`TOOL_TABLE 漂移：期望 ${EVENT_TOOL_NAMES.length + 1} 个工具，实际 ${TOOL_TABLE.length}`);
  for (const n of EVENT_TOOL_NAMES) if (!TOOL_TABLE.some((t) => t.name === n)) throw new Error(`TOOL_TABLE 缺事件工具 ${n}`);
  if (!TOOL_TABLE.some((t) => t.name === "panel.get")) throw new Error("TOOL_TABLE 缺 panel.get");
  for (const t of TOOL_TABLE) {
    if (typeof t.description !== "string" || !t.description) throw new Error(`工具 ${t.name} 缺 description`);
    if (t.inputSchema === null || typeof t.inputSchema !== "object") throw new Error(`工具 ${t.name} 缺 inputSchema`);
  }
}
