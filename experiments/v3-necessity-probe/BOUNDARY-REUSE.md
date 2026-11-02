# 责任边界与复用面（宿主 + 已有技能资产）

> 一手证据来源：`tests/deepseek-harness/`（train 0.2.0-rc.2 @ `c1b47e41fc`，本仓唯一真值测试实例）、
> `~/.dsh/skills/real2sim-*`。只读查证，路径:行为证。0.1.5-rc.2 差异另行标注。
> 本文件是**事实清单**，不是设计提案。

## A. DSH 宿主 0.2 能被插件复用到什么程度

| # | 能力 | 判定 | 证据 |
|---|---|---|---|
| 1 | **KV/文档存储 `ctx.storageDomain`** | **可直接复用**（第三方插件可用） | `defineDomain` 公开导出 `storage/storage-domain/src/index.ts:21`；宿主自带插件真实调用：`schedule/src/index.ts:101,126`、`workspace/src/index.ts:171,198`、`session-projection-cache/src/index.ts:105,118`。"available only to host code"（`storage/README.md:12`）上下文（`:28,:46`）指**宿主侧(server) 相对浏览器 client**，不是禁止第三方。前提：组合需挂 storage 栈——`dsh-base` 默认挂（root=`$DSH_HOME/storages`，`bundle/base/cordis.patch.yml:165-174`），`sdk-minimal` 不含 |
| 2 | **事务 / 并发 / CAS** | **宿主没有** | 无跨表事务 `storage-domain/README.md:152`；sqlite 后端 "no explicit transactions" `storage-sqlite/src/unit.ts:5`；无 CAS，domain 版本不符直接拒 `:153`。仅 per-domain 写链串行 `README:88-89` + json 原子发布 temp+fsync+rename `storage-json/README.md:74`。全仓唯一 CAS 在 agent-team 任务 revision `docs/subsystems/agent-team.md:58` |
| 3 | **workspace 实体** | **实体可复用；独立命名空间没有** | `ctx.workspaceRegistry`（create/move/pin/archive/hide/restore）`workspace/src/index.ts:171+`；0.2 新增 `initializeDefault`、`workspace/pin\|archive` 事件、`restore`（0.1.5 无）。**不能挂独立 DB**：记录共享 `$DSH_HOME/storages`（`spec.ts:76`）、会话共享 `$DSH_HOME/sessions`（`:133`），仅按 cwd 分组（`workspace/README.md:12,53`）。`workspace/changes` 是另一物（deliverables 的每轮文件变更 `recorder.ts:354`） |
| 4 | **principal / 权限** | **部分复用；无泛化 principal，也没有 per-agent 资源权限 lanes** | 主体 = 活 Agent 对象，`agent.id = SessionId`（`docs/subsystems/scope.md:11`）；用户侧仅每 home 匿名 UUID（`identity/anonymous-user-id/README.md:40`）；进程内拿到的 Agent 可信。`/permission` 写会话事件（`permission-presets/src/index.ts:256,441-454`）。实有：`ctx.tools.restrict` allow/deny 掩码（`docs/subsystems/tools.md:163-175`）、`tools/pre-execute` allow/deny/ask 瀑布（`core/tools/README.md:105`）、per-session approval/sandbox。**可直接查询不必自建**：`ctx.sandboxPolicy.resolve()/overrideOf()`（`sandbox-policy/src/index.ts:164-180`）、`ctx.approval.effectivePolicy()`、`ctx.tools.get(name,scope)` |
| 5 | **不注册工具即喂上下文** | **可直接复用** | `agent.inject(UserMessage): void` → next-step 收件箱、**不唤醒 idle agent**（`core/agent-loop/src/agent.ts:171-173`；JSDoc `core/agent/src/runtime-types.ts:233-241`）；撤回 = `agent.inbox.remove/replace(messageId)`（`:77-84`）；无内建幂等。**注意 0.2 删除了 0.1.5 的共享 `kind:'plugin'`**（0.1.5 `llm/src/message.ts:101-107` → 0.2 `:110-115` 换成 `'system-prompt'`），source kind 需自声明。另有 `ctx.systemPrompt.section()/context()`（每步重渲染，`core/system-prompt/src/index.ts:454,489`）、`agent/pre-step` 瀑布、`context` 组、tool result 的 `additionalContexts/deferContext` |
| 6 | **"不改中心文件即可换实现"** | **部分复用：组合机制有，对象/能力注册没有** | Cordis patch：`insert` 追加、按 `id` override、`disabled`（bool/`!!js`）、`isolate`（service realm）、`group`（`skills/cordis-composition-reference/SKILL.md:14-23`，实现 `vendor/loader/src/config/`）。**全仓无 `defineCapability`/`defineObject`/registry 一等公民**。跨插件数据契约版本化仅两处：`session-projection` 的 `key + stateVersion + zod stateSchema`（不兼容版本 throw，README:36,58-66）、`storage-domain` 的 `name + version`（:153）。其余全靠约定 |
| 7 | **schema 迁移框架** | **宿主没有（插件必须自建）** | `storage-domain` "No data migration"（:153）；`storage-sqlite` 版本不符拒绝（`schema.ts:14-20,82-87`）；`session-query` 派生索引 drop 重建（`schema.ts:7,66`）。会话格式迁移是宿主内部事（session-format-v3→v4） |
| 8 | **通用检索 / 索引** | **宿主没有** | FTS5 只索引会话事件（`session-query-sqlite/src/schema.ts:127-137`），可弃派生索引且**拒绝未知 user tables**（`:87-94`）；无通用搜索端口 |
| 9 | **可复用 UI 组件（实体详情/时间线/图谱）** | **宿主没有** | `ui-primitives` 只有通用 atoms（Button/Modal/Menu/Tag/JsonTree/DiffBlock/TerminalBlock，零 Cordis）；无 Timeline/Graph/Table 原语；`ui-trajectory` 的 timeline/table 是**会话轨迹专用**视图（`client/ui-trajectory/README.md:1-15`） |

### A 的直接含义（只列可被证据支撑的三条）

1. **V3 内核十项职责里，可原样落到宿主的只有 3 项**：事件真源（`Session.append` + 会话事件表）、KV 目录（`storageDomain`）、上下文出口（`agent.inject` / `systemPrompt.section`）。
   其余 6 项（一致性读快照、Unit-of-Work、能力/类型注册、验证规则注册、投影、检索）宿主不提供。
2. **但这 6 项里有 4 项本仓生产码已有实现**：`src/host/persistence`（迁移）、`src/host/history`（append/replay/projection）、`src/host/service/{dependency,stale,topology}`（投影）、`src/host/service/semantics`。
   → "宿主没有" ≠ "需要新写一套"。
3. **`agent.inject` 可撤回且有官方前缀/KV-cache 语义**（`core/agent-loop/README.md:170,176-178`）。
   因此契约里"输出仅供人阅览、不注入主 Agent 指令"（`V3_IMPLEMENTATION_CONTRACT-DRAFT.md:126-135`）
   是一条**自我限制**，不是宿主限制。

## B. `~/.dsh/skills/real2sim-*` 已经实现了 T2/T3/T5 的记录范式

11 个技能（`00-router`…`10-validation-review`）+ `real2sim-shared/schemas/` 10 份 JSON Schema（draft 2020-12）+ fixtures。
每技能强制一份 YAML sidecar（schema 校验）+ Markdown 报告。按 `PROTOCOL.md` 的 T 档映射：

| T 档 | 承担者与字段 | 完备度 | 有无阻塞语义 |
|---|---|---|---|
| **T2 口径登记** | `02-system-decomposition` 的 `representations[{id, class(8值), units, semantics, transform_from(命名+版本化)}]`；`03-parameter-registry` 的 units/角色；`01-envelope` 的 `qoi.representation` | **完备**（口径 = 表示 class + 命名版本化变换 + 单位） | **有**：HF-08「未命名变换的比较」hard-fail；router INV-09 前置 |
| **T3 共变记录** | `06-experiment-design` 的 `varied_factors / held_constant / blocking_factors / randomized_order / replication_plan.rationale / discriminating_prediction` | **完备** | **有**：字段全 required；router 以 `05` 裁决为前置（targets 来源未机器校验） |
| **T4 前提+指纹+适用域** | `07-calibration-result` 的 `preconditions` + `provenance{simulator_version, data_identity, transform_versions, artifact_identity}`；`01` 的 `bounds/excluded_regions`；`10` 的 `envelope_check` | **部分**（指纹是自由文本版本串，**无参数变更史**） | **有**：schema `if/then`——verdict=PASS 必须前置裁决 ∈ {CALIBRATE, CALIBRATE_SUBSET} 且两个 declared 布尔为 true |
| **T5 否定性状态** | `05-identifiability-report` 的 `DO_NOT_CALIBRATE_YET / INSUFFICIENT_EVIDENCE`；`unassigned`；`unmodeled_processes`；`unresolved_regions`；`INCONCLUSIVE`（INV-05） | **完备** | **有**：该裁决下 `07/10` **无法出 PASS**（fixture `invalid-pass-without-preconditions.json` 即拒收样例） |

### B 的重叠与缺口（双向）

**V3 主张 → real2sim 有无等价物**

| V3 主张 | 判定 |
|---|---|
| 语义精确性 / World 条件（"这个量怎么算出来的"） | **有等价物** = `02` 的表示 + 命名版本化变换链（即 T2 行） |
| 证据关系不评分 | **等价**（全程无数值评分；`09` 只有 high/med/low 分类置信） |
| 五态字段（缺失恒 UNKNOWN、无补全） | **部分**：枚举含 UNKNOWN、"不得静默省略"、INSUFFICIENT_EVIDENCE，但**无跨字段统一纪律** |
| 四时间轴（登记 vs 发生） | **无对应**：10 份 schema **没有任何时间戳字段**，只有版本轴 |
| 双图谱（关联 vs 推理） | **无对应**：无图对象，只有单向产物引用与变换链 |
| 可撤回接纳（standing） | **无对应**：只有 INV-12「新校准=新身份、禁原地覆盖」的版本替换纪律 |

**real2sim 有而 V3 文档没有**：8 表示 class + 版本化变换链；六轴正交量登记 + `estimation_policy(DO_NOT_FIT/MARGINALIZE)`；
`scientific_role` 七值 + "已用数据降级 DEVELOPMENT 后不得称 independent"；随机过程单一 owner + 显式 conditioning；
9 类残差分类 + 竞争假设 + 区分测试；逐字段 `evidence_level` L0–L4。

**复用可行性**：机器可读**是**（YAML + JSON Schema + fixtures，阻塞语义可执行）；版本字段**部分**（仅 `01` 有 version）；
稳定 id **无**（跨产物引用是自由路径串）。→ **需薄转换**：补 id 映射 + 时间戳即可被引用。

### B 的直接含义

V3 若要覆盖 T2/T3/T5，**这台机器上已有可运行、带 schema、带阻塞语义的实现**（且是用户自己的技能库），
而 V3 全部文档未引用它一次。V3 真正**独有且无人实现**的是三件：**时间轴、可撤回接纳状态、稳定可引用 id / 跨产物图**
——恰好都不是当前 G1 契约的重心（当前重心是五类对象、双图谱、内核与插件框架）。
