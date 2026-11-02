# E2 裁决书 —— 科研体系脱离 DSH 后怎么长

> 分支 `g1/contracts-20261031`，2026-11-01，父席收拢。
> 用户目标（2026-11-01）：**体系须脱离 DSH 也能适用——经 Adapter 接入 Codex / Claude Code 也能用。**
> 一手证据：`E2-COUPLING-INVENTORY.md`（耦合清单 + 宿主能力映射 + 拓扑，席位 1c2fd14b）、
> `e2/`（可运行非 DSH 宿主切片，席位 747701ac，**父席独立复跑 exit 0 / 29 断言全绿**）。
> 每条判定带可复现锚点；父席对三个关键数字做了独立复测（§3）。**未实测的不写死。**

## 0. 一句话回答

**「宿主无关内核」不是 V3 的设想，而是生产代码的现状**——核心区对 DSH 零 import（实测 + `check-imports` 机验门 rc=0）、数据库落点是纯函数（不在 `$DSH_HOME` 下）、工具定义是宿主无关 TS。多宿主目标**架构上已过半**；剩下的工程量集中在 **4 条 GAP 桥**（工具暴露 / UI 替代面 / 事件 intake / 编排端口），全部是「平面已有面 → 新宿主面」的 **adapter 层映射工作，不动平面内部**。E2 切片已跑通其中最核心的一格：**同一核心经 stdio JSON-RPC 被「Claude Code 型」非 DSH 宿主驱动，29/29 全绿，全程零 DSH、DSH_HOME 金丝雀为空**。

## 1. E2 切片证据（可运行，非纸面）

| 项 | 实测 | 父席独立复测 |
|---|---|---|
| `reuse/e2/run.mjs` | exit 0，29/29（席位） | **exit 0，29/29**（清空 `.scratch/e2` 后自跑） |
| 协议 | stdio NDJSON，JSON-RPC 2.0，MCP 形子集：`initialize`（宿主声明 name/capabilities/**storageRoot**）/`tools/list`/`tools/call`/`ping`；工具面 = 四事件命令 + `panel.get`；错误码 5 标准 + `-32001` 政策拒 / `-32002` 链断 / `-32003` 未初始化 / `-32004` 未知工具 | 协议正源 `host-port-protocol.mjs` 父席通读 |
| 零 DSH | 席位 grep rc=1（零命中） | 父席独立 grep（`dsh-session\|@deepseek-ai\|DSH_HOME\|storageDomain\|deepseek-harness`，剔注释）**0 命中** |
| 真源 | 核心自有 jsonl digest 链 + 自有 sqlite 投影（只 import e0 五个零宿主模块） | 同左（§2 分裂证据） |
| UI 降级 | `panel.get` → `{format:"markdown", body 纯文本}`，机验无 slot 结构键 | 断言 R2/R3/R4 在 29 条内 |
| 纪律跨 wire | 混存通道/键名混存/缺 basedOn 均回 `-32001`（非静默）；缺字段读回恒 `UNKNOWN`；篡改 jsonl 一行 → 读路径 `-32002 CHAIN_BROKEN` | 断言 D1–D5、R3b、T1 在 29 条内 |
| DSH_HOME 金丝雀 | G1 设置并传入 server 子进程（跨进程 envProbe 回执）→ G2 金丝雀目录为空 → G3 存储全落协议声明根 | 断言 G1–G3 在 29 条内 |
| 既有门禁 | g1 / g0 前后均 exit 0、输出逐字一致 | 父席独立跑 **g1=0 / g0=0** |

**模型形边界（席位自认、父席确认）**：`fake-host.mjs` 只证明「经 stdio NDJSON JSON-RPC 驱动核心的形态」——**无**真 Claude Code/Codex 的权限模型、schema 方言、流式、沙箱参与。**是协议证明，不是真宿主验证。**DSH 进程内臂未建（它已存在——现有 bundle 就是）。

## 2. 缝放对了位置（E0 薄片的分裂实测）

`e0/lib/` 的 7 模块在 DSH 绑定点上**恰好二分裂**（父席逐文件 grep 实测）：

| 文件 | 运行时 DSH 引用 | 角色 |
|---|---|---|
| `hostsession.mjs` | 有（唯一） | DSH adapter 绑定（宿主 Session 构建产物） |
| `eventlog / validate / projection / jsonl / sqlite` | **零** | 宿主无关核心 |

E2 的核心切片**按构造**只 import 后者五件——「核心与宿主绑定可干净分离」不是愿望，是 e0 结构本身的实测性质。

## 3. 耦合清单关键数字（父席独立复测）

来源 `E2-COUPLING-INVENTORY.md`；三个数字父席独立复测**逐一致**：

| 数字 | 席位 | 父席复测 |
|---|---|---|
| ① 核心区（`src/host/{audit,domain,git,workspace,history,persistence,service,tools}` + `src/shared` + 非 adapter 的 `src/client`）import `@deepseek-ai/*` 的文件数 | **0**（∅；全仓 src 12 文件 import 全在 `dsh-adapter/`） | **0 / 12 / 0**（复测命令见清单 §1.7） |
| ② `research.sqlite` 路径解析落点 | `service/storage-locations/resolve-db-path.ts:59`（纯函数、零 DSH import；**V2 落点不在 `$DSH_HOME` 下**——MANAGED=`<hub>/<hubDir>/projects/<id>/`、STANDALONE=`<ws>/<treeDir>/state/`；`$DSH_HOME` 残留仅 V1 提示探针 `dsh-adapter/host/index.ts:1817`） | `:59` 函数在位 + 零 DSH import（grep rc=1）✓ |
| ③ 耦合分档 H/S/I | **5 / 3 / 42**（生产面 50 项；测试面 31 文件单列） | H 锚（cordis.patch.yml / package.json `dsh` 块+19 依赖 pin / tsdown 客户端 bundle 契约 / client 入口）与 `check-imports` 门 **rc=0** 复测 ✓ |

**负面证据（同样重要）**：`grep -rn "systemPrompt" src/` **rc=1 零命中**（插件完全未用 DSH `systemPrompt.section` 面）；`querySession` 端口是 **TODO 桩**（I25）——DSH 的 FTS5 会话检索当前**未被使用**。

**H 项的正确读法**：5 个硬耦合（bundle manifest/patch、package.json 依赖 pin、客户端 bundle 打包契约、client 入口 `inject+apply`）**不是脱离 DSH 的障碍，而是 DSH adapter 自身的形态**。非 DSH 臂不携带这些——它有自己的入口（MCP server + CLI 包装）。即：**H 项归 DSH 臂所有，平面不背。**

## 4. 宿主无关内核需要什么端口集（8 面 × 3 宿主）

来源 `E2-COUPLING-INVENTORY.md` §2（CC/Codex 列按公开文档，标注「外部信息、未在仓内验证」）。**4 行 GAP** = 脱离 DSH 的全部工程面：

| # | 需求面 | DSH（现状） | 非 DSH | GAP？ |
|---|---|---|---|---|
| 1 | 工具注册/调用 | 进程内 `ctx.tools.register`（11 个研究工具） | **MCP tools（CC/Codex 均支持 MCP server）** | **GAP①** 工具暴露桥 |
| 2 | 提示注入 | launcher `agents/inject` 动态文本（I29） | 宿主自身机制（CC subagent 指令 / Codex AGENTS 语义） | 非 GAP（各宿主自有） |
| 3 | UI 表面 | client slots（会话视图/配置卡） | **无 GUI slot 面 → markdown（E2 已证）/ TUI（新写）** | **GAP③** UI 替代面 |
| 4 | 权限门 | `tools/pre-execute` 形（E0 实测） | 宿主自身权限模型（MCP 工具继承宿主权限） | 非 GAP |
| 5 | 事件通道 | `session/event` + lifecycle（I24/I42 端口） | **hook 回调（CC hooks / Codex 侧机制）** | **GAP⑤** intake 桥 |
| 6 | 会话/工作区上下文 | `agent.sessionId` 等（adapter 内） | 宿主 session 概念经 adapter 声明 | 非 GAP |
| 7 | 持久化根 | **平面自有** research.sqlite（纯解析器，宿主无关） | **不变**（平面自有） | 非 GAP（E2 金丝雀实证） |
| 8 | agent 编排 | opt-in agent-team（E0：9 工具） | CC subagents / Codex（外部信息） | **GAP⑧** 编排端口（E0 更正：重定义为宿主无关端口，各宿主声明能力集） |

**MCP 的正确定位（席位实测修正了我的初判）**：MCP 是 **CC↔Codex 之间的**最大公约数，**不是三宿主公约数**——DSH 无 MCP 面（DSH 臂走进程内 DI；仓内跨进程先例 = typert gateway JSON-RPC，59 个 `@Remote` 端点，`dsh-adapter/host/index.ts:149`）。**真正的三宿主公约数 = 科研平面自身**（自有事件真源 + 宿主无关工具定义 + 端口化 intake + 自有持久化）+ **逐宿主一个 adapter**。

## 5. 已具备 / 必须改（清单，非代码）

**已具备（多宿主目标的地基，全部实测在位）**：
1. 宿主无关核心（①=0，INV-PERM-5 机验门 rc=0）；
2. 纯函数数据库落点 + 自有 sqlite（②；E2 金丝雀实证宿主无关路径可承载）;
3. 宿主无关工具定义（`createResearchTools` 纯 TS 装配，11 工具——GAP① 的**输入侧已齐**）；
4. 端口定义在位（`shared/host-adapter-ports.ts`：`DshSessionAdapter`/`SessionQueryWindow`/launcher 端口——核心只依赖 TS 类型）；
5. 跨进程 RPC 先例（59 `@Remote`，JSON-RPC 2.0——GAP 桥不是新技术，是既有模式的复用）;
6. E2 的 HostPort 协议正源（stdio NDJSON 子集——非 DSH 臂的协议形状已跑通）。

**必须改（4 条 GAP 桥 + 3 个 S 项参数化；H 项归 DSH 臂不动）**：
1. **GAP① MCP 工具暴露桥**：`createResearchTools` 面 → MCP `tools/list`/`tools/call`（E2 的 `server.mjs` 是形状证明；生产化 = 把 11 个真工具接上，替换四事件薄片）;
2. **GAP③ UI 替代面**：markdown 读面（E2 已证）；交互面（TUI 或宿主原生气泡）**新写**；slot 形态保留为 DSH 臂专属;
3. **GAP⑤ intake 桥 ×3 实现**：同一 `onSessionEvent`/lifecycle 端口（I24/I42 已有端口形）——DSH 实现=现有、CC 实现=hooks 映射、Codex 实现=其侧机制映射;
4. **GAP⑧ 编排端口**：OutboundPort 重定义（E0-VERDICT 就地更正）——端口声明能力集，宿主有则填、无则降级;
5. **S1–S3 参数化**：版本守卫包名、investigator 工具名常量、preset YAML 输出语法——改常量/换语法，不动机制;
6. **E2 自身缺口（README §9，继承 e0 §7）**：无 UoW/跨命名空间单提交、无 capability 装配、无 Space、读路径 O(n) 全折叠、markdown 渲染器固定模板。

## 6. 每宿主 adapter 计划

| 宿主 | 进程形态 | 工具面 | 事件 intake | UI | 编排 |
|---|---|---|---|---|---|
| **DSH** | 进程内常驻 bundle（**现状，不动**） | `ctx.tools.register`（11 工具） | `session/*` 事件流（现状） | slots 面板（现状） | agent-team（声明能力集，opt-in） |
| **Claude Code** | sidecar 进程（**新**） | **MCP server（stdio）** | hooks → intake 桥 | markdown（E2 已证）+ 宿主气泡 | subagents（声明能力集） |
| **Codex CLI** | sidecar 进程（**新，与 CC 共用 MCP server 臂**） | **同一 MCP server** | 其侧机制 → intake 桥 | markdown | 其能力（外部信息，待核） |

**一个 MCP server 臂覆盖 CC + Codex**（MCP 是两者公约数）；两宿主差异只在 intake 映射与编排声明。

## 7. 对 V3 与 E0 旧判的关系

- **V3「宿主无关机制内核」前提：被证实**——不是 V3 要建，是生产核心已经是（§3），且 E2 证明它能被宿主外驱动。V3 的 1450 行 kernel.ts「从零重做」命题进一步失去意义：**它重做的东西，生产核心已经宿主无关地有了。**
- **V3 多 Space**：多宿主 ≠ 多 Space——每个宿主是**不同进程/adapter**，不是单账本内的租户。Space 只在「单部署服务多用户/多团队」时需要，仍是产品决策（未裁）。
- **V3 侧信道防御**：与宿主无关性正交，仍待用户威胁模型（E0-VERDICT §5.1，不变）。
- **V3 capability 装配**：多宿主下的「宿主能力声明」（E2 `initialize` 已留 capabilities 槽位）是真实需求；但 V3 完整 Capability 注册/ownsKinds 是**多插件共写**语义，不是多宿主语义——仍待单独论证，不由本目标直接推翻或直接证实。
- **E0 两处旧判已就地更正**（E0-VERDICT 内 2026-11-01 更正标注）：① 「宿主 Session = 事件真源」收窄为 DSH adapter 内部选项、体系真源改判自有（**E2 按此形状跑通**）；② OutboundPort X 档「删除」作废，重定义为宿主无关编排端口。

## 8. 用户决策项（更新后）

**继承 E0（不变）**：① 威胁模型（侧信道防御是否降级）；② V1 历史接管范围；③ 名单正源承载面。
**更正后残余**：④ 编排端口的**最小公约数形状**（Codex/Claude Code 各需满足什么能力集才算「有编排」——外部信息待核后与用户核）。
**新增**：⑤ 真 MCP server 臂是否升生产（E2 协议 = sidecar 臂形状；升生产属 G2 范围，需授权）；⑥ `querySession` 桩（I25，DSH FTS5 会话检索）是否需要——当前**未被使用**，多宿主下各宿主检索面也不同，建议**暂缓**。

## 9. 边界声明

- `fake-host` 跑通 = **协议证明**，≠ 真 Claude Code/Codex 验证（后者的权限模型/schema 方言/沙箱均未参与）。
- 本裁决**不推翻任何已裁 G1 条文**；不改冻结面；不写生产 DDL/生产机制代码；不把侧车升基线。
- **G1 冻结未申请、Current 未生效、G2 未开工。**本地门禁全绿（父席独立复跑），**无 GitHub CI ⇒ 未完成 CI 验收**。
