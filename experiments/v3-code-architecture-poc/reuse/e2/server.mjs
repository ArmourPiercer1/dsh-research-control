#!/usr/bin/env node
// e2 非 DSH adapter——科研核心作为 stdio JSON-RPC 2.0 server（宿主 spawn 目标）。
// 形态 = 「Claude Code 型」宿主驱动 MCP server 的样子：stdin 进请求行、stdout 出响应行（NDJSON）。
// stdout 只走协议帧，诊断一律 stderr（宿主侧断言 H1 机验通道卫生）。
// 本文件与 fake-host.mjs 共用 host-port-protocol.mjs 的协议表——同一张表，两个 adapter 实现。

import { METHODS, RPC, E2, PROTOCOL_VERSION, CORE_NAME, CORE_VERSION, TOOL_TABLE, decodeLine, rpcResult, rpcError, RpcError, assertToolTableStable } from "./host-port-protocol.mjs";
import { createCore, E2Error } from "./core.mjs";

assertToolTableStable();

let core = null;
let hostInfo = null;
let closing = false;

function reply(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}
function note(...args) {
  process.stderr.write(args.join(" ") + "\n");
}

function doInitialize(params) {
  if (!params || typeof params !== "object" || Array.isArray(params)) throw new RpcError(RPC.INVALID_PARAMS, "initialize.params required (object)");
  if (typeof params.name !== "string" || !params.name) throw new RpcError(RPC.INVALID_PARAMS, "initialize.params.name (host name) required");
  if (typeof params.storageRoot !== "string" || !params.storageRoot) {
    throw new RpcError(RPC.INVALID_PARAMS, "initialize.params.storageRoot required（存储根由宿主经协议提供；核心不读任何宿主环境变量）");
  }
  const caps = params.capabilities && typeof params.capabilities === "object" && !Array.isArray(params.capabilities) ? params.capabilities : {};
  core = createCore({ storageRoot: params.storageRoot });
  hostInfo = { name: params.name, version: params.version ?? "unknown", capabilities: caps };
  note(`[server] initialized host=${hostInfo.name}@${hostInfo.version} ui=${caps.ui ?? "none"} storageRoot=${params.storageRoot}`);
  // 跨进程金丝雀回执：server 进程自报「宿主专用环境变量是否在我这端被设置」
  // （变量名运行时拼装——守卫 grep 面不含本树字面量，见 README §5）
  const hostEnvVar = ["DSH", "HOME"].join("_");
  return {
    protocolVersion: PROTOCOL_VERSION,
    serverInfo: { name: CORE_NAME, version: CORE_VERSION },
    host: { name: hostInfo.name, capabilities: hostInfo.capabilities },
    tools: TOOL_TABLE, // 规格：initialize 回版本 + 工具表
    envProbe: { [hostEnvVar]: process.env[hostEnvVar] !== undefined },
  };
}

function doToolsList() {
  return { tools: TOOL_TABLE };
}

function doToolsCall(params) {
  if (!core) throw new RpcError(E2.NOT_INITIALIZED, "initialize before tools/call");
  if (!params || typeof params !== "object" || Array.isArray(params) || typeof params.name !== "string" || !params.name) {
    throw new RpcError(RPC.INVALID_PARAMS, "tools/call.params.name required");
  }
  const tool = TOOL_TABLE.find((t) => t.name === params.name);
  if (!tool) throw new RpcError(E2.UNKNOWN_TOOL, `unknown tool: ${params.name}`);
  const args = params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments) ? params.arguments : {};
  if (params.name === "panel.get") return core.panelGet();
  // 四事件命令
  if (!args.data || typeof args.data !== "object" || Array.isArray(args.data)) throw new RpcError(RPC.INVALID_PARAMS, "tools/call.arguments.data (object) required");
  const seqs = args.sourceEventSeqs;
  if (seqs !== undefined && (!Array.isArray(seqs) || seqs.some((s) => !Number.isInteger(s) || s < 0))) {
    throw new RpcError(RPC.INVALID_PARAMS, "sourceEventSeqs must be an array of non-negative integers");
  }
  return core.commitEvent(params.name, args.data, seqs ?? []);
}

function handle(line) {
  let req;
  try {
    req = decodeLine(line);
  } catch (err) {
    if (err instanceof RpcError) reply(rpcError(null, err.code, err.message)); // id 未知 → null（JSON-RPC 2.0 语义）
    return;
  }
  const hasId = "id" in req;
  const id = hasId ? req.id : null;
  let result;
  try {
    switch (req.method) {
      case METHODS.INITIALIZE:
        result = doInitialize(req.params);
        break;
      case METHODS.TOOLS_LIST:
        result = doToolsList();
        break;
      case METHODS.TOOLS_CALL:
        result = doToolsCall(req.params);
        break;
      case METHODS.PING:
        result = { pong: true, protocolVersion: PROTOCOL_VERSION };
        break;
      default:
        throw new RpcError(RPC.METHOD_NOT_FOUND, `Method not found: ${req.method}`);
    }
  } catch (e) {
    if (e instanceof RpcError || e instanceof E2Error) {
      const code = e instanceof E2Error ? e.rpcCode : e.code;
      reply(rpcError(id, code, e.message, e.data));
    } else {
      note("[server] internal error:", e?.stack ?? String(e));
      reply(rpcError(id, RPC.INTERNAL_ERROR, String(e?.message ?? e)));
    }
    return;
  }
  if (hasId) reply(rpcResult(id, result));
  // 通知（无 id）：处理完不回应（JSON-RPC 2.0 语义）
}

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).replace(/\r$/, "");
    buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    handle(line);
  }
});

function shutdown() {
  if (closing) return;
  closing = true;
  try {
    core?.close();
  } catch {
    /* ignore */
  }
  note("[server] stdin closed → shutdown");
  process.exit(0);
}
process.stdin.on("end", shutdown);
process.on("SIGTERM", shutdown);

note(`[server] e2 stdio JSON-RPC server ready（protocol ${PROTOCOL_VERSION}；${CORE_NAME}@${CORE_VERSION}）`);
