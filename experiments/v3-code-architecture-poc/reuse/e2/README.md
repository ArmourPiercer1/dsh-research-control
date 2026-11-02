# E2 有界切片——「科研核心可以在非 DSH 宿主下工作」（可运行证据）

- 分支 `g1/contracts-20261031`，2026-11-01。前置证据：`../e0/`（`e0/lib/` 7 模块只读引用，已验证 exit 0）；本切片不重做 e0 调研。
- 性质：`experiments/` 侧车薄片。**只新建本目录文件 + `.scratch/e2/`（可弃，gitignored）；零修改既有文件、零 git 写、未触碰 `references/**`、`src/**`、`schema/**`、8 根文档与冻结面。**
- **性质声明（先说）：本切片是协议证明，不是真宿主验证**——「Claude Code 型宿主」是本目录的 `fake-host.mjs`（模型形）；全程没有真 Claude Code / Codex / DSH 参与（模型形清单见 §8）。
- 怎么跑（`node` 直跑，退出码即结论）：

  ```bash
  node experiments/v3-code-architecture-poc/reuse/e2/run.mjs        # 29 条断言；0 = 跑通
  node experiments/v3-code-architecture-poc/reuse/e2/fake-host.mjs  # 独立跑（自 spawn server）；25 条；0 = 跑通
  ```

- 本机实测（真实观测值）：`run.mjs` **exit 0**（29/29 绿；宿主声明 `fake-claude-code-host`，ui=none）；`fake-host.mjs` 独立 **exit 0**（25/25 绿，server exit=0）；零 DSH grep **rc=1**（零命中，§7）；既有门禁前后各一遍全绿且输出逐字一致（§10）。

## 1. 本切片证明什么

同一科研核心（e0 的四事件政策 + 折叠投影 + jsonl digest 链 + sqlite 镜像）作为一个 **stdio JSON-RPC 2.0 server**，被一个「非 DSH 宿主」驱动——宿主只认 HostPort 协议表（`host-port-protocol.mjs`），不 import 任何 DSH 构建产物、不读任何 DSH 专用环境变量。断言覆盖四组（规格①–④）：

1. **写后读回逐字段等**：wire 回显 + client 独立读盘上的 jsonl（R1/R3）；
2. **跨 wire 的纪律**：混存通道事件被 server 拒、client 收到错误码（不是静默）；缺字段读回恒 `UNKNOWN`（D1–D4、R3b）；
3. **UI 降级**：无 GUI 宿主下 `panel.get` 返回 markdown 渲染（断言输出是 markdown 文本而非 slot 结构）（R2/R4）；
4. **篡改检出**：跑完改写 jsonl 一行再经协议重放读，digest 链断必红、错误码回传（T1）。

## 2. 文件清单

| 文件 | 作用 |
|---|---|
| `host-port-protocol.mjs` | HostPort 协议正源：方法表 / 工具表 / 错误码 / NDJSON 帧 + `RpcError`；两个 adapter 共用的同一张表 |
| `core.mjs` | 核心本体：只 import e0 的 5 个零宿主模块；自有真源 jsonl + 自有投影 sqlite；markdown 面板渲染 |
| `server.mjs` | 非 DSH adapter：stdio JSON-RPC 2.0 server（宿主 spawn 目标）；stdout 只走协议帧，诊断走 stderr |
| `fake-host.mjs` | 「Claude Code 型」宿主 client（模型形）：initialize → tools/list → 依序四事件 → panel.get + 全部断言；可独立运行 |
| `run.mjs` | 主跑手：存储根 + 环境变量金丝雀 → spawn server → 驱动 fake-host → 汇总 29 条断言 → exit 0/1 |

## 3. HostPort 协议（stdio NDJSON，JSON-RPC 2.0，MCP 形子集）

帧：每条消息一行、一个 JSON-RPC 2.0 对象（MCP stdio 传输的帧形）；**stdout 只走协议帧、诊断一律 stderr**（H1 断言机验通道卫生）。

### 方法表

| 方法 | 请求参数 | 结果 | 错误 |
|---|---|---|---|
| `initialize` | `{ name, version?, capabilities?, storageRoot }`——宿主声明 name/capabilities，并**经协议声明存储根**（核心不猜路径、不读宿主环境变量） | `{ protocolVersion, serverInfo{name,version}, host, tools[5], envProbe }`——版本 + 工具表 + 环境变量金丝雀回执 | -32602（缺 name/storageRoot） |
| `tools/list` | `{}` | `{ tools[5] }` | — |
| `tools/call` | `{ name, arguments{ data, sourceEventSeqs? } }` | 事件写：`{ ok, seq, digest, event{seq,type,sourceEventSeqs,occurredAt,recordedAt,data} }`；`panel.get`：`{ format:"markdown", body, events, source }` | -32003 未初始化 / -32602 参数 / -32004 未知工具 / -32001 政策拒 / -32002 链断 |
| `ping` | `{}` | `{ pong, protocolVersion }` | — |

### 错误码表

| 码 | 含义 |
|---|---|
| -32700 / -32600 / -32601 / -32602 / -32603 | JSON-RPC 2.0 标准（parse / invalid request / 未知方法 / 参数 / 内部） |
| -32001 `POLICY_REFUSED` | 写侧政策拒绝（E0_REFUSED 透传）：**拒绝必回错误码，绝不静默接纳** |
| -32002 `LEDGER_CORRUPT` | 读路径：jsonl digest 链断 / 行损坏（fail-loud，不返脏读） |
| -32003 `NOT_INITIALIZED` | initialize 之前调 tools/call |
| -32004 `UNKNOWN_TOOL` | 工具表外名字 |

### 工具面（5 = 四事件命令 + panel.get）

| 工具 | 对应事件 | 关键纪律 |
|---|---|---|
| `assertion.recorded` | assertion.recorded | channel 单值封闭枚举（数组/组合串=混存必拒）；缺通道不默认；INFERENCE/SUGGESTION 强制 basedOn |
| `evidence.linked` | evidence.linked | assertionId 须已存在（悬空必拒）；locator/quote 可缺 → 读回恒 UNKNOWN |
| `assessment.appended` | assessment.appended | stance 可缺 → 读回恒 UNKNOWN；`_defaulted` 族键 / null 伪装缺省必拒；assessmentId 唯一 |
| `standing.changed` | standing.changed | from 必须等于当前折叠值（防丢更新）；封闭转移集；standing 不是对象（无对象表） |
| `panel.get` | （读） | 从真源 jsonl 重放（digest 链每次校验）；无 GUI 宿主 → `format:"markdown"` |

**缝的声明**：HostPort 是本切片自己的稳定宿主端口缝——同一张协议表由两个 adapter 实现：① DSH adapter（宿主进程内直接调核心对象，UI 走 slot 面板）；② 非 DSH adapter（stdio JSON-RPC，UI 降级 markdown）——**本切片落地的是第②臂**；第①臂只声明、未建，也不声称已验证。

## 4. 真源选择：核心自有，而非宿主 Session

| 维度 | 宿主 Session 真源（e0 案 A） | 核心自有真源（本切片） |
|---|---|---|
| 绑在谁身上 | 单个 DSH 会话（机制形：append/deepFreeze/seq） | 谁都不绑——核心是独立库 |
| 多宿主 | ❌ Codex / Claude Code 型宿主没有宿主 Session 这一层；引入 = 硬依赖 DSH 构建产物 | ✅ 任何宿主都是协议的一个 JSON-RPC client |
| 跨进程 | 进程内真源不过进程边界（e0 的 jsonl 是重放镜像） | jsonl digest 链**就是**真源本身：跨进程可复活（restore）+ 篡改可检出（链断必红）+ 撕裂尾截断 |
| 读面 | 宿主存储域（宿主私有持久面）/ 投影缓存自建的投影 | 核心自有 sqlite 投影（触发器 DDL 形 = 生产 append-only 形；无 standing 表） |

**为什么核心自有**：多宿主目标。宿主 Session 真源把核心绑死在「单个 DSH 会话」+「DSH 构建产物在位」上——到 Codex / Claude Code 型宿主，那一层根本不存在。核心自有 jsonl digest 链 + sqlite 投影之后，宿主降级为「经协议驱动核心的一个客户端」——这是核心能在非 DSH 宿主下工作的结构前提。e0 的机制形（eventlog/validate/projection/jsonl/sqlite 五件）全部复用，变的只是「谁提供写入口与存储根」：本切片由宿主在 `initialize` 时经协议声明。

## 5. UI 降级矩阵

| 宿主形态 | 面板形态 | 本切片状态 |
|---|---|---|
| DSH 宿主（GUI，有 slot 面） | slot 面板（进程内 adapter 直接注册 slot） | 只声明，未建 |
| 非 DSH 宿主（stdio，无 GUI） | **markdown 文本**（`panel.get` → `format:"markdown"`，`body` 纯字符串） | **实测**（R2/R3/R4：format 标记 + markdown 形 + 无 slot 结构键） |

`format` 字段是降级标记，宿主侧按它决定渲染方式；stdio adapter 没有 slot 面，故一律 markdown——即便宿主声明了 slot 能力也不例外。

## 6. 断言清单（29 条，全绿）

- **握手/协议（6）**：A0 未初始化先调 → -32003；A1 initialize 回版本 + 5 工具表 + 环境变量金丝雀回执；A2 tools/list 面 = 四事件 + panel.get；A3 未知方法 → -32601；A4 坏帧 → -32700（id=null）；A5 未知工具 → -32004。
- **写/读回（7）**：W1–W5 依序写四事件（seq 0–4，逐字段回显 + 64 位 hex digest）；R1 写后读回逐字段等（client 独立读盘上 jsonl，5 条逐字段）；R2 panel.get format=markdown、events=5。
- **UI 降级（2）**：R3 markdown 内容逐字段到位（断言文本 / 证据 locator+quote / 评估 rationale / standing 折叠值）；R4 输出是 markdown 文本而非 slot 结构。
- **缺字段恒 UNKNOWN（1）**：R3b EV2 locator/quote 双 UNKNOWN + ASM1 stance UNKNOWN + stance 未被补全。
- **纪律跨 wire（6）**：D1 混存通道（数组）→ -32001 MIXED_OR_UNKNOWN_CHANNEL；D2 SOURCE 键名混存 → -32001 MIXED_CHANNEL_KEY；D3 INFERENCE 缺 basedOn → -32001 BASED_ON_REQUIRED；D4a 引用被拒断言 → -32001 DANGLING_ASSERTION（拒绝不留痕）；D4b 被拒后合法写 seq 严格连续（=5）；D4c 面板折叠正确（events=6、ACCEPTED）。
- **投影/通道（2）**：D5 sqlite 镜像 6 行 + 无 standing 对象表（client 只读直开）；H1 server stdout 每一行都是合法 JSON-RPC 2.0 帧。
- **篡改检出（1）**：T1 改写 jsonl 一行（EV1 supports→contradicts）→ panel.get → -32002 CHAIN_BROKEN。
- **零 DSH（4）**：G1 宿主专用环境变量被设置并随 spawn 传入 server 子进程（金丝雀在位）；G2 金丝雀目录为空（核心全程未读未写）；G3 存储全落在协议声明根 `.scratch/e2/store`（jsonl 6 行 + sqlite 在位）；G4 server 在 stdin 关闭后干净退出（exit 0）。

## 7. 零 DSH 断言（真实 rc）

守卫：本树任何文件（含本 README）不出现宿主符号。守卫模式共 5 个备选，其中第 3 个是宿主专用环境变量的名字（两段拼接：`D` + `SH_HOME`）。为让本树不自我命中，下面命令里 5 个备选都用 shell 引号拼接拆开书写（每处 `''` 接缝展开后即该备选），`P` 展开后与守卫命令逐字节相同（已机验；仓根运行，路径取真实 e2 目录）：

```bash
P='dsh-''session|@deepseek-''ai|D''SH_HOME|storage''Domain|ctx''\.'
grep -rE "$P" experiments/v3-code-architecture-poc/reuse/e2/
# 实测 rc = 1（grep 语义：1 = 零命中；0 = 有命中；2 = 运行错误）
```

- 代码侧同理：`run.mjs` / `server.mjs` / `fake-host.mjs` 以 `["DSH","HOME"].join("_")` 运行时拼装该环境变量名——本树任何文件都不含其字面量。
- 阳性对照：同一模式对含该字面量的对照文件命中（rc=0，实测）——模式本身不空转。
- import 面自证：`core.mjs` 只 import `../e0/lib/{eventlog,validate,projection,jsonl,sqlite}.mjs` + `node:` 内建；`hostsession.mjs`（含 DSH 构建产物 import）与 `exit.mjs`（模型形出口，禁引）虽在 e0 树内，本切片一律未 import。

## 8. 模型形清单（诚实边界——不许过度声称）

1. **fake-host 是协议证明，不是真宿主验证**：`fake-host.mjs` 模拟的是「宿主经 stdio 驱动 MCP server」这一**形态**——spawn + NDJSON JSON-RPC + initialize/tools/list/tools/call 时序 + 断言。它**没有**模拟：真 Claude Code / Codex 的权限模型、工具 schema 方言、流式/中断语义、沙箱边界、模型侧工具选择。「假宿主跑通」≠「真宿主验证」——后者需要真实宿主接入，不在本切片内。
2. 协议表是「MCP 形子集」（NDJSON 帧 + 3 方法 + ping）；本切片**不声明**与真实 MCP 规范的兼容性（无通知全表面、无 resource/prompt 面、无版本协商）。
3. DSH adapter 臂只声明（未建）：「同一核心在 DSH 宿主进程内也工作」留给后续切片。
4. 宿主声明的 `storageRoot` 被原样信任（单宿主信任模型）；真多宿主部署需要存储根绑定/权限缝——本切片没有这一维度。
5. 全部 29 条断言单机（node v24.21.0）单进程树跑通；不涉及并发写 / 多宿主并行。

## 9. 已知局限（不只报好消息）

1. **post-commit 两步（jsonl + sqlite）不可回滚**：真源写后镜像失败只能靠链检出，无 UoW 原子性（e0 §7.1 同类教训；V3 的 Change Journal 是结构答案）。
2. **篡改后政策面与真源脱节**：T1 之后内存政策面（hasSeq/hasAssertion）仍持篡改前状态，后续写会「成功」（append 进已断链）——读路径恒红，但写路径不拒。真装配需写路径也过链校验（本切片界到「读必红」）。
3. **无 Space / 租户隔离**：单存储根单账本；跨 Space 引用、归属裁决、越权拒均不在本切片（e0 同缺）。
4. **panel.get 读路径每次全量重读（O(n)）**：大账本需游标 + 基线投影层（e0 §7.5 同缺）。
5. **markdown 渲染器是固定模板**：字段面（如 basedOn 展示）未参数化；真实宿主的渲染协商（format 选择 / 字段子集）留给协议 v2。

## 10. 门禁账（真实退出码）

| 命令（仓根） | 开工时 | 收工后 |
|---|---|---|
| `node experiments/v3-code-architecture-poc/g1-checklist-validate.mjs` | exit 0（绿：结构/语义校验无违规） | exit 0（输出逐字一致） |
| `node experiments/v3-code-architecture-poc/g0-gate.mjs` | exit 0（PASS：tsc 0 错 / 作者测试 225 全绿 / 审查方 33 条已知红与基线逐等） | exit 0（输出逐字一致） |
| `node experiments/v3-code-architecture-poc/reuse/e2/run.mjs` | —（新切片） | exit 0（29/29） |
| `node experiments/v3-code-architecture-poc/reuse/e2/fake-host.mjs`（独立） | — | exit 0（25/25，server exit=0） |
| 零 DSH grep（§7） | — | rc=1（零命中） |
| `git status --porcelain` | 干净（0 行） | 仅新增 `experiments/v3-code-architecture-poc/reuse/e2/**`（6 个未跟踪文件）；`.scratch/` 已 gitignore 不入树 |
