#!/usr/bin/env node
// e2 假宿主——模拟「Claude Code 型」宿主 client（模型形，非真宿主；边界清单见 README §8）。
// 它做的事与真宿主驱动 MCP server 的事**同形**：spawn 一个 stdio server 子进程 →
// initialize（声明 name/capabilities/storageRoot）→ tools/list → 依序 tools/call 四事件 → panel.get，
// 全程只经 stdio NDJSON JSON-RPC 2.0，不 import 任何宿主构建产物。
// 本文件与 server.mjs 共用 host-port-protocol.mjs 的协议表——缝的两端只认同一张表。

import { spawn } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { METHODS, E2, PROTOCOL_VERSION, CORE_NAME, EVENT_TOOL_NAMES, RpcError } from "./host-port-protocol.mjs";

const EXPECTED_TOOLS = [...EVENT_TOOL_NAMES, "panel.get"];

// —— JSON-RPC 2.0 over NDJSON 客户端（缝的宿主侧实现）————————————————
export class RpcClient {
  constructor({ output, sink }) {
    this._sink = sink;
    this._pending = new Map();
    this._notices = [];
    this._noticeWaiters = [];
    this._idSeq = 0;
    this._rawLines = 0;
    this._badLines = 0;
    this._badSchema = 0;
    this._buf = "";
    output.setEncoding("utf8");
    output.on("data", (chunk) => {
      this._buf += chunk;
      let i;
      while ((i = this._buf.indexOf("\n")) >= 0) {
        const line = this._buf.slice(0, i).replace(/\r$/, "");
        this._buf = this._buf.slice(i + 1);
        if (!line.trim()) continue;
        this._rawLines++;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          this._badLines++;
          continue;
        }
        if (msg === null || typeof msg !== "object" || msg.jsonrpc !== "2.0") this._badSchema++;
        this._route(msg);
      }
    });
  }

  _route(msg) {
    if (msg && typeof msg === "object" && "id" in msg && this._pending.has(msg.id)) {
      const p = this._pending.get(msg.id);
      this._pending.delete(msg.id);
      if (msg.error) p.rej(new RpcError(msg.error.code, msg.error.message, msg.error.data));
      else p.res(msg.result);
      return;
    }
    this._notices.push(msg);
    for (const w of this._noticeWaiters.splice(0)) w();
  }

  request(method, params, { timeoutMs = 10000 } = {}) {
    const id = ++this._idSeq;
    return new Promise((res, rej) => {
      const t = setTimeout(() => {
        this._pending.delete(id);
        rej(new Error(`rpc timeout: ${method}`));
      }, timeoutMs);
      this._pending.set(id, {
        res: (v) => {
          clearTimeout(t);
          res(v);
        },
        rej: (e) => {
          clearTimeout(t);
          rej(e);
        },
      });
      this._sink.write(JSON.stringify({ jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) }) + "\n");
    });
  }

  sendRaw(line) {
    // 测试通道：发送原始行（不带帧语义）
    this._sink.write(line);
  }

  // 等待一条「非挂起请求回应」的通知型消息（如 id=null 的 Parse error）
  waitForNotice(pred, { timeoutMs = 10000 } = {}) {
    const take = () => {
      const i = this._notices.findIndex(pred);
      return i >= 0 ? this._notices.splice(i, 1)[0] : undefined;
    };
    const hit = take();
    if (hit) return Promise.resolve(hit);
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error("waitForNotice timeout")), timeoutMs);
      this._noticeWaiters.push(() => {
        const m = take();
        if (m) {
          clearTimeout(t);
          res(m);
        }
      });
    });
  }

  stats() {
    return { rawLines: this._rawLines, badLines: this._badLines, badSchema: this._badSchema };
  }
}

// —— 断言小工具 ———————————————————————————————————————————————
function makeHarness() {
  const checks = [];
  let pass = 0;
  let fail = 0;
  async function check(name, fn) {
    try {
      const r = await fn();
      if (r === false) throw new Error("断言为假");
      pass++;
      checks.push(`PASS ${name}`);
    } catch (err) {
      fail++;
      checks.push(`FAIL ${name} :: ${err?.message ?? err}`);
    }
  }
  return { checks, tally: () => ({ pass, fail, total: pass + fail }), check };
}

async function expectRpcError(h, name, promise, code, frag) {
  await h.check(name, async () => {
    try {
      const r = await promise;
      throw new Error(`应得错误码 ${code} 却成功返回: ${JSON.stringify(r)?.slice(0, 120)}`);
    } catch (e) {
      if (e.code === code && (!frag || String(e.message).includes(frag))) return true;
      throw new Error(`错误码不符: got code=${e.code} msg=${e.message}（期望 code=${code}${frag ? ` 含「${frag}」` : ""}）`);
    }
  });
}

// 独立 witness：稳定 stringify（键排序）——不共用核心/协议代码，读回逐字段等才有意义
function stableStringify(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + stableStringify(v[k])).join(",") + "}";
}

// —— 场景脚本（断言本体）——————————————————————————————————
export async function runFakeHost({ child, jsonlPath, sqlitePath, hostDecl }) {
  const h = makeHarness();
  const { check } = h;
  const client = new RpcClient({ output: child.stdout, sink: child.stdin });
  const call = (name, arguments_) => client.request(METHODS.TOOLS_CALL, { name, arguments: arguments_ });

  // ① 握手前纪律：未 initialize 先 tools/call 必得错误码（不是静默/挂起）
  await expectRpcError(h, "A0 未 initialize 先 tools/call → 错误码 NOT_INITIALIZED", call("assertion.recorded", { data: { assertionId: "Z" } }), E2.NOT_INITIALIZED);

  // ② initialize：宿主声明 name/capabilities（+storageRoot）→ 核心回版本 + 工具表
  await check("A1 initialize → 回 serverInfo 版本 + 工具表（5 工具）", async () => {
    const r = await client.request(METHODS.INITIALIZE, hostDecl);
    if (r.protocolVersion !== PROTOCOL_VERSION) throw new Error(`protocolVersion=${r.protocolVersion}`);
    if (r.serverInfo?.name !== CORE_NAME || !r.serverInfo?.version) throw new Error(`serverInfo 缺失: ${JSON.stringify(r.serverInfo)}`);
    if (!Array.isArray(r.tools) || r.tools.length !== 5) throw new Error(`initialize 未回工具表或数量错: ${r.tools?.length}`);
    // 跨进程金丝雀回执：server 子进程自报宿主专用环境变量在它那端确实被设置（变量名同法拼装）
    const hostEnvVar = ["DSH", "HOME"].join("_");
    if (r.envProbe?.[hostEnvVar] !== true) throw new Error(`server envProbe 未见宿主专用环境变量: ${JSON.stringify(r.envProbe)}`);
    return true;
  });

  // ③ tools/list：工具面 = 四事件 + panel.get，每个带 description + inputSchema
  await check("A2 tools/list → 恰 5 工具（四事件+panel.get），均有 description/inputSchema", async () => {
    const r = await client.request(METHODS.TOOLS_LIST, {});
    const names = r.tools.map((t) => t.name).sort();
    if (stableStringify(names) !== stableStringify([...EXPECTED_TOOLS].sort())) throw new Error(`工具面漂移: ${names.join(",")}`);
    for (const t of r.tools) {
      if (typeof t.description !== "string" || !t.description) throw new Error(`${t.name} 缺 description`);
      if (t.inputSchema === null || typeof t.inputSchema !== "object") throw new Error(`${t.name} 缺 inputSchema`);
    }
    return true;
  });

  // ④ 协议负例：未知方法 / 坏帧 / 未知工具——错误码逐一回传
  await expectRpcError(h, "A3 未知方法 → -32601 Method not found", client.request("bogus/method", {}), -32601);
  await check("A4 坏帧（非 JSON 行）→ -32700 Parse error（id=null）", async () => {
    client.sendRaw("this is not json\n");
    const m = await client.waitForNotice((x) => x?.error?.code === -32700);
    return m.id === null;
  });
  await expectRpcError(h, "A5 未知工具名 → -32004 UNKNOWN_TOOL", call("panel.set", {}), E2.UNKNOWN_TOOL);

  // ⑤ 依序 tools/call 四事件（写）——逐字段回显 + seq 连续
  const sent = [];
  async function writeEvent(name, data, sourceEventSeqs, label) {
    const expectedSeq = sent.length;
    sent.push({ seq: expectedSeq, type: name, sourceEventSeqs: sourceEventSeqs ?? [], data });
    await check(label, async () => {
      const r = await call(name, { data, ...(sourceEventSeqs ? { sourceEventSeqs } : {}) });
      if (r.ok !== true) throw new Error(`ok 非 true: ${JSON.stringify(r)}`);
      if (r.seq !== expectedSeq) throw new Error(`seq=${r.seq} 期望 ${expectedSeq}`);
      if (!/^[0-9a-f]{64}$/.test(r.digest ?? "")) throw new Error(`digest 非 64 位小写 hex: ${r.digest}`);
      if (stableStringify(r.event.data) !== stableStringify(data)) throw new Error("回显 data 与发送 data 非逐字段等");
      if (r.event.type !== name) throw new Error("回显 type 漂移");
      return true;
    });
  }

  await writeEvent("assertion.recorded", { assertionId: "A1", channel: "SOURCE", text: "论文X §3：方法在 3 个基准上收敛" }, [], "W1 事件1 assertion.recorded（SOURCE 断言 A1）→ seq0 + 逐字段回显");
  await writeEvent("evidence.linked", { evidenceId: "EV1", assertionId: "A1", relation: "supports", locator: "p.12 ¶2", quote: "converges on all three" }, [0], "W2 事件2 evidence.linked（EV1 全字段）→ seq1 + 逐字段回显");
  await writeEvent("evidence.linked", { evidenceId: "EV2", assertionId: "A1", relation: "contradicts" }, [0], "W3 事件3 evidence.linked（EV2 缺 locator/quote）→ seq2 + 逐字段回显");
  await writeEvent("assessment.appended", { assessmentId: "ASM1", subjectRef: { assertionId: "A1" }, rationale: "直接引用支持（stance 故意缺省）" }, [1], "W4 事件4 assessment.appended（ASM1 缺 stance）→ seq3 + 逐字段回显");
  await writeEvent("standing.changed", { subjectRef: { assertionId: "A1" }, from: "UNKNOWN", to: "CANDIDATE", reason: "EV1 支持到位" }, [1], "W5 事件5 standing.changed（A1 UNKNOWN→CANDIDATE）→ seq4 + 逐字段回显");

  // ⑥ 写后读回逐字段等（跨进程独立 witness：client 直接读盘上的真源 jsonl）
  await check("R1 写后读回逐字段等：jsonl 落盘 5 条记录与发送逐字段一致（含 digest 链字段）", async () => {
    const lines = readFileSync(jsonlPath, "utf8").split("\n").filter((l) => l.length > 0);
    if (lines.length !== sent.length) throw new Error(`jsonl 行数=${lines.length} 期望 ${sent.length}`);
    lines.forEach((l, i) => {
      const rec = JSON.parse(l);
      const exp = sent[i];
      if (rec.seq !== exp.seq || rec.type !== exp.type) throw new Error(`行${i + 1} seq/type 漂移`);
      if (stableStringify(rec.sourceEventSeqs) !== stableStringify(exp.sourceEventSeqs)) throw new Error(`行${i + 1} 因果引用漂移`);
      if (stableStringify(rec.data) !== stableStringify(exp.data)) throw new Error(`行${i + 1} data 非逐字段等`);
      if (!/^[0-9a-f]{64}$/.test(rec.digest)) throw new Error(`行${i + 1} digest 格式错`);
    });
    return true;
  });

  // ⑦ panel.get（无 GUI 宿主 → markdown 降级渲染）
  let panel;
  await check("R2 panel.get → format=markdown，events=5（此时恰 5 写），body 为字符串", async () => {
    panel = await call("panel.get", {});
    if (panel.format !== "markdown") throw new Error(`format=${panel.format}（期望 markdown）`);
    if (panel.events !== 5) throw new Error(`events=${panel.events} 期望 5`);
    return typeof panel.body === "string";
  });

  await check("R3 markdown 内容逐字段到位（A1 文本 / EV1 locator+quote / ASM1 rationale / standing CANDIDATE）", async () => {
    const b = panel.body;
    for (const frag of ["论文X §3：方法在 3 个基准上收敛", "p.12 ¶2", "converges on all three", "直接引用支持（stance 故意缺省）", "| A1 | SOURCE | CANDIDATE |"]) {
      if (!b.includes(frag)) throw new Error(`markdown 缺字段「${frag}」`);
    }
    return true;
  });

  await check("R3b 缺字段读回恒 UNKNOWN（EV2 locator/quote 双 UNKNOWN；ASM1 stance UNKNOWN；禁补全）", async () => {
    const rows = panel.body.split("\n");
    const ev2 = rows.find((l) => l.startsWith("| EV2 "));
    const asm1 = rows.find((l) => l.startsWith("| ASM1 "));
    if (!ev2 || (ev2.match(/UNKNOWN/g) ?? []).length !== 2) throw new Error(`EV2 行 UNKNOWN 单元格错: ${ev2}`);
    if (!asm1 || !asm1.includes("| UNKNOWN |")) throw new Error(`ASM1 行 stance 非 UNKNOWN: ${asm1}`);
    if (asm1.includes("POSITIVE") || asm1.includes("NEGATIVE") || asm1.includes("MIXED")) throw new Error("stance 被补全（纪律失效）");
    return true;
  });

  await check("R4 UI 降级：输出是 markdown 文本而非 slot 结构（format 标记 + 纯字符串 + markdown 形）", async () => {
    const r = panel;
    if ("slot" in r || "kind" in r || "panel" in r) throw new Error(`结果含 slot 结构键: ${Object.keys(r).join(",")}`);
    if (typeof r.body !== "string") throw new Error("body 非纯文本");
    if (!/^# /.test(r.body)) throw new Error("body 无 markdown 标题");
    if (!r.body.includes("|---|")) throw new Error("body 无 markdown 表格");
    return true;
  });

  // ⑧ 跨 wire 的纪律一：三通道不混存——拒绝必回错误码（不是静默）
  await expectRpcError(
    h,
    "D1 混存通道（channel 数组）→ -32001 MIXED_OR_UNKNOWN_CHANNEL（跨 wire 拒收）",
    call("assertion.recorded", { data: { assertionId: "B1", channel: ["SOURCE", "INFERENCE"] } }),
    E2.POLICY_REFUSED,
    "MIXED_OR_UNKNOWN_CHANNEL",
  );
  await expectRpcError(
    h,
    "D2 SOURCE 键名混存（inference_basis）→ -32001 MIXED_CHANNEL_KEY",
    call("assertion.recorded", { data: { assertionId: "B2", channel: "SOURCE", inference_basis: "模型脑补" } }),
    E2.POLICY_REFUSED,
    "MIXED_CHANNEL_KEY",
  );
  await expectRpcError(
    h,
    "D3 INFERENCE 缺 basedOn → -32001 BASED_ON_REQUIRED",
    call("assertion.recorded", { data: { assertionId: "B3", channel: "INFERENCE", text: "无据外推" } }),
    E2.POLICY_REFUSED,
    "BASED_ON_REQUIRED",
  );

  // ⑨ 拒绝不留痕：被拒 B1 不可见；后续合法写 seq 严格连续（=5）
  await expectRpcError(
    h,
    "D4a 引用被拒断言 B1 → -32001 DANGLING_ASSERTION（拒绝不留痕）",
    call("evidence.linked", { data: { evidenceId: "EV3", assertionId: "B1", relation: "supports" } }),
    E2.POLICY_REFUSED,
    "DANGLING_ASSERTION",
  );
  await writeEvent("standing.changed", { subjectRef: { assertionId: "A1" }, from: "CANDIDATE", to: "ACCEPTED", reason: "人工确认接纳" }, [1], "D4b 被拒后合法写 seq 严格连续 → seq5（A1 CANDIDATE→ACCEPTED）");
  await check("D4c 拒绝不留痕：面板 events=6，A1 standing 折叠为 ACCEPTED", async () => {
    const p = await call("panel.get", {});
    if (p.events !== 6) throw new Error(`events=${p.events} 期望 6`);
    if (!p.body.includes("| A1 | SOURCE | ACCEPTED |")) throw new Error("A1 standing 未折叠到 ACCEPTED");
    return true;
  });

  // ⑩ 自有投影 sqlite（client 进程直接只读打开——跨进程派生读面）
  await check("D5 sqlite 投影镜像 6 行且无 standing 对象表（client 直读）", async () => {
    const db = new DatabaseSync(sqlitePath, { readOnly: true });
    try {
      const n = db.prepare("SELECT COUNT(*) c FROM e0_event").get().c;
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
      if (n !== 6) throw new Error(`e0_event 行数=${n} 期望 6`);
      if (tables.some((t) => /standing/i.test(t))) throw new Error(`存在 standing 对象表: ${tables.join(",")}`);
      return true;
    } finally {
      db.close();
    }
  });

  // ⑪ stdout 通道卫生：server stdout 每一行都是合法 jsonrpc 2.0 帧（诊断只走 stderr）
  await check("H1 stdout 通道卫生：server 输出的每一行都是合法 JSON-RPC 2.0 帧", async () => {
    const s = client.stats();
    if (s.badLines !== 0 || s.badSchema !== 0) throw new Error(`badLines=${s.badLines} badSchema=${s.badSchema}（stdout 被污染）`);
    return s.rawLines > 0;
  });

  // ⑫ 篡改检出：改写真源 jsonl 一行 → 经协议重放读，digest 链断必红（错误码回传）
  await check("T1 篡改 jsonl 一行（EV1 supports→contradicts）→ panel.get 回 -32002 CHAIN_BROKEN", async () => {
    const raw = readFileSync(jsonlPath, "utf8");
    const lines = raw.split("\n").filter((l) => l.length > 0);
    const idx = lines.findIndex((l) => l.includes('"evidenceId":"EV1"'));
    if (idx < 0) throw new Error("夹具缺 EV1 行");
    lines[idx] = lines[idx].replace('"supports"', '"contradicts"');
    writeFileSync(jsonlPath, lines.join("\n") + "\n");
    try {
      await call("panel.get", {});
      throw new Error("篡改后 panel.get 竟成功（链未检出）");
    } catch (e) {
      if (e.code !== E2.LEDGER_CORRUPT) throw new Error(`错误码=${e.code} 期望 ${E2.LEDGER_CORRUPT}（msg=${e.message}）`);
      if (!String(e.message).includes("CHAIN_BROKEN")) throw new Error(`message 缺 CHAIN_BROKEN: ${e.message}`);
      return true;
    }
  });

  const { pass, fail, total } = h.tally();
  return { checks: h.checks, pass, fail, total, stats: client.stats() };
}

// —— 独立运行入口（node fake-host.mjs）：自己 spawn server —————————————————
async function main() {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const REPO = resolve(HERE, "../../../..");
  const DATA = join(REPO, ".scratch", "e2", "standalone");
  rmSync(DATA, { recursive: true, force: true });
  const STORE = join(DATA, "store");
  const child = spawn(process.execPath, [join(HERE, "server.mjs")], { cwd: REPO, stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (c) => {
    stderr += c;
  });
  child.on("error", (e) => console.error("[fake-host] spawn error:", e.message));
  const hostDecl = { name: "fake-claude-code-host", version: "1.0.0", capabilities: { ui: "none", stdio: true }, storageRoot: STORE };
  const res = await runFakeHost({ child, jsonlPath: join(STORE, "e2-ledger.jsonl"), sqlitePath: join(STORE, "e2-projection.sqlite"), hostDecl });
  child.stdin.end();
  const code = await new Promise((r) => {
    const t = setTimeout(() => {
      child.kill("SIGKILL");
      r(-1);
    }, 5000);
    child.on("exit", (c) => {
      clearTimeout(t);
      r(c ?? -1);
    });
  });
  for (const l of res.checks) console.log(l.includes("FAIL") ? l : `  ${l}`);
  console.log(`\n[fake-host] ${res.fail === 0 ? "跑通" : "未跑通"}（${res.total} 条：绿 ${res.pass} 红 ${res.fail}）｜server exit=${code}`);
  if (res.fail > 0 || code !== 0) {
    if (stderr) console.error("[server stderr]\n" + stderr);
    process.exit(1);
  }
  process.exit(0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
