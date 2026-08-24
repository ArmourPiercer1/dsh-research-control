# ARCHITECTURE.md — DSH Research Control Plane V1 架构规范（工程版）

> 文档状态：**Frozen V1**（2026-08-22 冻结；含独立审计修订 A-1~A-18，追溯见 TEST_MATRIX.md 与计划书 §40 附录）
> 上游计划书：`docs/plans/active/DSH_Research_Control_Plane_V1_Design_and_Implementation_Plan.md`（本文是其 §2「架构不变量」及全文架构决策的可测试工程化版本）
> 基线宿主版本：DeepSeek Harness **0.1.0-rc.8**（developer preview，breaking change 风险见 §10 与 DSH_ADAPTER.md）
> 本文件地位：V1 实现的**架构契约**。与 `DOMAIN_SCHEMA.md`、`HISTORY_EVENT_CATALOG.md`、`PLAN_FORK_SPEC.md`、`GIT_INTEGRATION.md`、`DSH_ADAPTER.md`、`TEST_MATRIX.md` 及 `schema/` 目录共同构成计划书 §37 规定的首批工程产物。冻结后任何修改必须同步更新受影响文档、schema 与测试。

---

## 1. 系统定位与边界

### 1.1 一句话定义

> 一个 Git-backed、event-sourced、DSH-native 的科研工作流 Cockpit：用 Project/Topic/Workstream 组织研究，用 History/Current/Future 分离过去、现在与未来，用 immutable Agent PlanFork 保护用户对计划的最终控制权，用 Intervention 管理稀缺的人类注意力，并始终把科学判断留给人和科研 Agent。

### 1.2 职责边界（最高优先级约束）

| 插件**做** | 插件**不做** |
|---|---|
| 管理、记录、提醒、排序、展示 | 调度 executor agent；暂停/恢复 Agent |
| 维护计划、状态、历史、人工介入点、研究上下文 | 选择模型 / provider / 路由 |
| 将分散信息组织成可回放、可审计、可推进的工作流 | 判断 Claim 是否科学正确、自动验证证据 |
| 机械校验（引用存在、字段存在、拓扑合法） | 自动发现科研冲突、构造证明链、Claim 可信度评分 |
| 用户明确请求时启动**只读** Investigator Agent | 自动回滚研究、强制遵守 Merge Contract、自动构造 prompt/context |

### 1.3 环境拓扑

```text
┌─────────────────────────────────────────────────────────────────────┐
│ DSH Host（Node runtime，宿主进程）                                    │
│  ├── DSH core（不 patch、不 fork）                                    │
│  └── 本插件 host 模块：                                               │
│       dsh-adapter → [service, domain, history, persistence,          │
│                      git, workspace, audit, tools]                    │
│       ctx.researchControl（host service，经 Typert RPC 暴露）          │
└───────────────┬──────────────────────────────┬──────────────────────┘
                │ Typert RPC（低频 query/mutation）│ session/event feed（复用）
┌───────────────┴──────────────────────────────┴──────────────────────┐
│ DSH Web Client（浏览器）                                              │
│  └── 本插件 client 模块：dsh-adapter → [stores, views, graph,          │
│      components]（slot 注册 Research 页面）                            │
└──────────────────────────────────────────────────────────────────────┘
                │ 文件 I/O（仅经插件 git/workspace 层）
┌───────────────┴─────────────────────────────────────────────────────┐
│ Research Workspace（用户 Git 仓库，注册制）                            │
│  └── .research/（声明式真源：manifest/plan/topology/contract/policy）  │
└──────────────────────────────────────────────────────────────────────┘
                │ 独立 SQLite（不进 Git）
┌───────────────┴─────────────────────────────────────────────────────┐
│ $DSH_HOME/research-control/<project-id>/research.sqlite（运行时真源） │
└──────────────────────────────────────────────────────────────────────┘
```

关键事实：

- DSH Session 的 raw log 由 DSH 自身持久化，插件只保存 session 指针（INV-DB-2）；
- Research Workspace 是**用户的代码仓库**，插件对它的写入被限制在 `.research/**`（INV-GIT-3）；
- 两个真源的定义见 §4。

---

## 2. 代码分层与包结构

### 2.1 目录结构（冻结目标）

```text
dsh-research-control/
├── package.json
├── cordis.patch.yml
├── ARCHITECTURE.md / DOMAIN_SCHEMA.md / HISTORY_EVENT_CATALOG.md
├── GIT_INTEGRATION.md / DSH_ADAPTER.md / PLAN_FORK_SPEC.md / TEST_MATRIX.md
├── schema/                        # V1 冻结契约（JSON Schema 2020-12）
├── src/
│   ├── host/
│   │   ├── index.ts               # 插件 host 入口（仅组装）
│   │   ├── service/               # researchControl service：用例编排（RPC/tools 的实现层）
│   │   ├── domain/                # 纯领域逻辑：状态机、派生规则、invariant 校验（无 I/O）
│   │   ├── history/               # 事件信封、append、replay、projection
│   │   ├── persistence/           # SQLite operational store
│   │   ├── git/                   # Git wrapper（唯一允许调用 git 的层）
│   │   ├── workspace/             # workspace 注册、发现、audit 扫描
│   │   ├── audit/                 # 三层 audit + reconciliation 分类
│   │   ├── tools/                 # agent-facing tools（§7.2 的实现）
│   │   └── dsh-adapter/           # DSH API → 插件自有接口的适配实现
│   ├── client/
│   │   ├── index.tsx              # 插件 client 入口（slot 注册）
│   │   ├── stores/                # client store / scope
│   │   ├── views/                 # Dashboard / Project / Topic / Workstream 三区
│   │   ├── graph/                 # React Flow PlanGraph / TopologyGraph
│   │   ├── components/
│   │   └── dsh-adapter/           # client 侧 DSH API 适配
│   └── shared/
│       ├── schemas/               # 运行时校验（由 schema/ 契约生成的 zod 等）
│       └── ids/                   # ID 前缀注册表、ID 解析/构造（host/client 共用）
└── tests/
```

### 2.2 依赖方向规则（review 必查）

```text
shared  ←  host/*  ←  client/*（仅 shared 可被 client 引用）
domain  ←  service / history / persistence / git / workspace / audit / tools
dsh-adapter 实现 domain（或 service）声明的接口，方向永远单向
```

1. `domain/` 是纯逻辑：**禁止** import 任何 I/O、DSH 包、sqlite、git；
2. 除 `src/host/dsh-adapter/` 与 `src/client/dsh-adapter/` 外，**任何文件不得 import DSH 内部模块**（INV-PERM-5）；
3. `git/` 是唯一允许 spawn `git` 进程的层（INV-GIT-6）；
4. `service/` 是唯一允许写 operational DB 与 `.research/` 的编排层。

### 2.3 dsh-adapter 接口清单

业务代码只依赖下列**插件自有**接口（TS 定义在 `src/shared/`，实现在 `*/dsh-adapter/`；与真实 DSH API 的逐项映射见 `DSH_ADAPTER.md`）：

| 接口 | 职责 |
|---|---|
| `DshHostAdapter` | 插件生命周期挂载、host service 注册、host event 订阅 |
| `DshSessionAdapter` | session 列表、生命周期事件、session-query 读取 |
| `DshWorkspaceAdapter` | workspace 身份/注册、根目录解析 |
| `DshRpcAdapter` | Typert remote 定义与注册（§7.1） |
| `DshUiAdapter` | client slot 注册、store/HMR 约定 |
| `DshPersistenceAdapter` | 插件数据目录定位（`$DSH_HOME/research-control/`）、可复用 storage 工具 |
| `DshToolAdapter` | agent-facing tool 注册 |
| `DshAgentLauncherAdapter` | 只读 Investigator Agent 的受限启动 |

DSH breaking change 时只改 adapter 实现与 `DSH_ADAPTER.md`，不动业务层。

---

## 3. 核心数据结构

### 3.1 三时区投影（同一 Task identity）

```text
T7 PLANNED  → Future Plan          ┐
T7 ACTIVE   → Current Execution    ├─ 同一个 T7；身份跨区稳定
T7 EXECUTED → History projection   ┘
```

三区是同一 Workstream 的不同投影，**不是三套 identity**。分区规则：

- **History**：只描述过去实际发生的内容，由 ResearchHistory 回放（Run 生命周期、状态变化、Fact/Claim、Artifact、Gate/Milestone、topology realize、Intervention creation）；
- **Current Execution**：ACTIVE/PAUSED Task、live Run、待 review 的 Gate/Task validation、当前执行摘要、blocker；
- **Future Plan**：PLANNED Task、planned Gate/Milestone、unresolved Agent PlanFork proposal。

### 3.2 ResearchHistory

- 每 Workstream 一条**线性 append-only** typed event log（无 DAG）；
- 信封字段与 20 个事件类型的 payload 规范：见 `HISTORY_EVENT_CATALOG.md`；
- 双时序：`eventSeq`（登记顺序）/ `occurredAt`（现实发生时间）/ `recordedAt`（登记时间）；
- 语义回放 `ORDER BY occurred_at, event_seq`；审计回放 `ORDER BY event_seq`；默认 UI 按语义时间线。

### 3.3 WorkstreamTopologyGraph

- 只回答「Workstream 之间的路线谱系如何 fork / merge」；
- `TopologyEdge { operation: FORK|MERGE, lifecycle: PLANNED|REALIZED|DROPPED, inputs[], outputs[] }`；
- planned 与 realized 使用**同一对象模型**，plan change 不改写历史；
- 渲染约定：realized 实线、planned 虚线、dropped 默认隐藏、planned Workstream 淡化、merge contract badge。

### 3.4 FuturePlanGraph

- canonical Future Plan = 单 Workstream 内用户确认的**稳定有序 G/T/M 线性序列**（持久化于 `plan.yaml`）；
- `plan order ≠ dependency`：位置含用户意图，插件不解释；
- Agent 只能创建 append-only **PlanFork** proposal（不同视觉样式 overlay），完整规则见 `PLAN_FORK_SPEC.md`。

---

## 4. 双真源持久化

| | Declarative 真源 | Operational 真源 |
|---|---|---|
| 内容 | 结构、当前规划、topology、Merge Contract、policy | History、Run、Claim/Fact、Intervention、Inbox、Audit、PlanFork runtime 记录、awareness、reporting |
| 载体 | `.research/` 文本文件（YAML/Markdown） | `$DSH_HOME/research-control/<project-id>/research.sqlite` |
| 版本真源 | **Git**（commit/diff/log/restore） | event log 本身（append-only） |
| 写入者 | 用户（经插件 UI）或插件代用户执行显式操作 | service 层（含 agent tools 途径） |
| 禁止 | 进 Git 的高频数据；自建 revision table | 存 API key/secrets；复制 DSH Session raw log |

分配原则（判定新数据放哪里的规则）：

1. 人可编辑、低频、项目声明式 → `.research/` + Git；
2. 高频、运行时、append-only 或状态型 → SQLite；
3. `.research/` 布局与 SQLite 表映射的精确规范：`DOMAIN_SCHEMA.md` §14/§15。

---

## 5. 不变量目录（INV-\*）

> 本目录是 TEST_MATRIX.md 追溯的锚点。「校验层」含义：**S** = schema/加载期校验；**R** = 运行时（service/domain）校验；**T** = 仅由测试保证（无法在单一入口校验的全局性质）。

### 5.1 结构不变量

| ID | 不变量 | 校验层 |
|---|---|---|
| INV-STRUCT-1 | 一个 Workstream 恰属于一个 Topic（强制外键，无多父） | S |
| INV-STRUCT-2 | TopologyEdge 的所有 inputs/outputs 必须属于同一 Topic（Topic 是拓扑硬边界） | S+R |
| INV-STRUCT-3 | 跨 Topic 协作只能通过显式 dependency/reference（relation edge / 引用字段）表达 | R |
| INV-STRUCT-4 | 层级仅 Project > Topic > Workstream 三层；无嵌套 Workstream、无嵌套 Objective | S |

### 5.2 三时区不变量

| ID | 不变量 | 校验层 |
|---|---|---|
| INV-TZ-1 | History 只描述过去实际发生的内容 | R+T |
| INV-TZ-2 | Current Execution 只含 ACTIVE/PAUSED Task、live Run、待 review validation | R（派生投影） |
| INV-TZ-3 | Future Plan 只含 PLANNED 项与 unresolved PlanFork；不以历史节点为 anchor | S+R |
| INV-TZ-4 | 返工过去工作必须创建**新的** PLANNED Task，不得在 PlanGraph 中回到过去 | R |

### 5.3 History 不变量

| ID | 不变量 | 校验层 |
|---|---|---|
| INV-HIST-1 | ResearchHistory 按 Workstream 线性 append-only：无 insert/update/delete/DAG | R+T |
| INV-HIST-2 | 一个 HistoryEvent 对应一个原子 source operation（唯一例外：RUNS_STARTED 批量启动） | R |
| INV-HIST-3 | 每个 HistoryEvent 恰有一个 owner_workstream | S |
| INV-HIST-4 | payload 由 `event_type + schema_version` 严格校验，未知组合拒绝写入 | S |
| INV-HIST-5 | mutation event 必须包含 `from -> to`，且 `from` 必须等于对象当前状态，否则拒绝 | R |
| INV-HIST-6 | `eventSeq` 每 workstream 单调递增且永不改写；`eventId` 项目内唯一 | R+T |
| INV-HIST-7 | 进入 History 的一等 identity（Run/Task/Claim/Fact/Artifact/Gate/Milestone/…）不 hard delete；撤销/失效用 retract / supersede / mark-missing 表达 | R+T |
| INV-HIST-8 | 事件不因可读性聚合不同科研操作；聚合只存在于 wrapper/projection 层 | T |
| INV-HIST-9 | TOPOLOGY_FORK_REALIZED 的 owner = source Workstream；TOPOLOGY_MERGE_REALIZED 的 owner = resulting Workstream | R |

### 5.4 Plan 不变量

| ID | 不变量 | 校验层 |
|---|---|---|
| INV-PLAN-1 | canonical Future Plan 在单 Workstream 内是稳定有序 G/T/M 线性序列，顺序持久化于 `plan.yaml`；加载/刷新/重启不改变顺序 | S+T |
| INV-PLAN-2 | `plan order ≠ dependency`；插件不解释位置的科研含义 | 设计约束 |
| INV-PLAN-3 | Agent 无任何 API 可直接修改 canonical plan（reorder/insert/delete） | R+T |
| INV-PLAN-4 | Agent 只能创建 append-only PlanFork proposal；不能修改/删除已有 PlanFork | R+T |
| INV-PLAN-5 | PlanFork 必须基于创建时刻 canonical plan closure 的精确 `(path, git_blob_oid)` 集合 | R |
| INV-PLAN-6 | unresolved（OPEN）PlanFork 不能作为新 PlanFork 的基准（fork API 无 base 参数，基准永远重算自 canonical） | R |
| INV-PLAN-7 | 用户 SELECT 后：canonical plan 被替换、PF=SELECTED、同基准其他 unresolved PF=STALE；DISMISS 只改状态不删除 | R+T |
| INV-PLAN-8 | canonical plan（或其引用的 G/T/M 定义）被修改后，旧基准 PF 判 STALE（blob OID 集合比对） | R+T |
| INV-PLAN-9 | `plan.yaml` 只保存当前 Future zone 的有序 ID；G/T/M 定义文件长期保留，不随离开计划而删除 | S+T |

### 5.5 Task 不变量

| ID | 不变量 | 校验层 |
|---|---|---|
| INV-TASK-1 | execution/validation 状态只能沿 DOMAIN_SCHEMA §13 的合法转换表变化 | R |
| INV-TASK-2 | completion（DONE）与 blockage 是派生字段，任何 API 不接受直接写入 | R+T |
| INV-TASK-3 | validation=NOT_REQUIRED 仅当 acceptance_criteria 为空；DONE = EXECUTED ∧ (PASSED ∨ NOT_REQUIRED) | R |

### 5.6 科研语义不变量

| ID | 不变量 | 校验层 |
|---|---|---|
| INV-SCI-1 | Claim/Fact 是 Workstream-local 一等语义标签，用于索引/引用/Brief/drill-down，不形式化为知识对象 | 设计约束 |
| INV-SCI-2 | 插件不判断 Claim 科学正确性、不自动验证证据、不自动检测冲突、不做可信度评分 | 设计约束 |
| INV-SCI-3 | 跨 Workstream 迁移认知时只记录新 Run/Claim，不追踪原 Claim 来源 | 设计约束 |
| INV-SCI-4 | 负科研结果可为 `EXECUTED + PASSED + DONE`（结论本身记为 Claim/Fact） | 设计约束 |

### 5.7 Relation 不变量

| ID | 不变量 | 校验层 |
|---|---|---|
| INV-REL-1 | Relation 统一 `RELY_ON` 方向：TARGET 始终是 SOURCE 的前提/来源/输入/证据/上位目标 | S |
| INV-REL-2 | 只持久化直接边；不存传递闭包、不存反向边（反向视图由 incoming-edge query 派生） | R+T |
| INV-REL-3 | relation type 限于 V1 目录 10 种（DOMAIN_SCHEMA §8） | S |
| INV-REL-4 | 插件不沿 relation 图做科学推理 | 设计约束 |

### 5.8 Git 不变量

| ID | 不变量 | 校验层 |
|---|---|---|
| INV-GIT-1 | 注册 Research Workspace 必须位于 Git repo，否则拒绝 managed mode；绝不静默 `git init`（显式 GUI 按钮除外） | R |
| INV-GIT-2 | 默认不静默 commit；checkpoint 仅用户显式触发 | R+T |
| INV-GIT-3 | checkpoint 只提交 `.research/**`，不包含用户其他 staged changes | R+T |
| INV-GIT-4 | merge/rebase/cherry-pick 进行中禁止插件自动提交（fail loud） | R+T |
| INV-GIT-5 | restore 需用户显式触发；恢复产生新 working copy，不改写 Git 历史 | R+T |
| INV-GIT-6 | 所有 Git 命令使用 argv 数组 API，禁止拼接 shell 字符串 | T |
| INV-GIT-7 | 插件不执行网络/历史改写类操作：push/pull/fetch/merge/rebase/reset/clean/stash 等 | T |
| INV-GIT-8 | Git 是声明式状态唯一版本真源；不实现 PlanRevision/ContractRevision/TopologyRevision 等自建版本表 | S+T |

### 5.9 权限不变量

| ID | 不变量 | 校验层 |
|---|---|---|
| INV-PERM-1 | Agent 可写仅限：Fact/Claim/Artifact 注册、Intervention **创建**、NextAction 创建、PlanFork 创建、Run checkpoint 报告 | R+T |
| INV-PERM-2 | Agent 不可：canonical plan 变更、PlanFork select/dismiss、Intervention 状态迁移、awareness 状态、topology 改写、Git restore、History mutation/delete | R+T |
| INV-PERM-3 | Investigator Agent 完全只读（无任何写路径）；输出默认 transient，仅用户显式保存才落 AnalysisRecord | R+T |
| INV-PERM-4 | Intervention 状态（OPEN/PENDING/CLOSED）只允许用户显式修改 | R+T |
| INV-PERM-5 | 业务代码不得 import DSH 内部模块（仅 dsh-adapter 可以） | 静态检查（lint 规则）+ T |

### 5.10 注意力不变量

| ID | 不变量 | 校验层 |
|---|---|---|
| INV-ATTN-1 | OPEN/PENDING Intervention 始终完整展示；Attention Manager 只排序、不隐藏 | T |
| INV-ATTN-2 | 预计耗时只作为标签，不得用于让短任务压过高重要度任务 | R（评分器约束） |
| INV-ATTN-3 | Brief 是 projection 非 source of truth；每项重要陈述必须可 drill-down 到结构化对象/History/Run | T |
| INV-ATTN-4 | Awareness 只对高价值对象/事件使用，不要求逐事件确认 | 设计约束 |
| INV-ATTN-5 | 不因 Claim scientific conflict 自动创建 Intervention（自动来源仅限 §6 脚注所列机械触发） | R+T |

### 5.11 持久化不变量

| ID | 不变量 | 校验层 |
|---|---|---|
| INV-DB-1 | operational DB 不存 API key/secrets；模型/provider secrets 由 DSH credential system 负责 | T |
| INV-DB-2 | 不复制 DSH Session raw log；只存 session_id、Run 绑定、事件指针、摘要 | R+T |
| INV-DB-3 | 插件崩溃/异常不得损坏用户 Git workspace 与 DSH Sessions（原子写、无跨系统事务假设） | T |

---

## 6. 权限模型（actor capability matrix）

行 = 操作；列 = USER（GUI）/ RESEARCH_AGENT（tools）/ INVESTIGATOR（只读）/ PLUGIN（系统自动）。

| 操作 | USER | RESEARCH_AGENT | INVESTIGATOR | PLUGIN |
|---|---|---|---|---|
| 创建/编辑 Project/Topic/Workstream manifest | ✅ | ❌ | ❌（只读） | ❌ |
| canonical plan reorder/insert/delete | ✅ | ❌ | ❌ | ❌ |
| 创建 PlanFork | ❌ | ✅（经校验） | ❌ | ❌ |
| SELECT / DISMISS PlanFork | ✅ | ❌ | ❌ | ❌ |
| 记录 Fact / Claim / Artifact | ✅ | ✅ | ❌ | ❌ |
| Retract Claim / mark Artifact missing | ✅ | ✅ | ❌ | ❌ |
| Run 生命周期事件 | ✅（手工登记） | ✅（checkpoint 报告触发） | ❌ | ✅（session 绑定自动登记） |
| Intervention 创建 | ✅ | ✅ | ❌ | ✅（仅机械触发¹） |
| Intervention OPEN/PENDING/CLOSED | ✅ | ❌ | ❌ | ❌ |
| NextAction 创建 | ✅ | ✅ | ❌ | ❌ |
| NextAction PROMOTE/DISMISS | ✅ | ❌ | ❌ | ❌ |
| Awareness 状态 | ✅ | ❌ | ❌ | ❌ |
| topology 编辑（declarative） | ✅ | ❌ | ❌ | ❌ |
| Merge Contract 编辑 | ✅ | ✅² | ❌（只读） | ❌ |
| Save Research Checkpoint（git commit） | ✅ | ❌ | ❌ | ❌ |
| Git restore | ✅ | ❌ | ❌ | ❌ |
| History append | ✅ | ✅（受限事件集） | ❌ | ✅ |
| History update/delete | ❌ | ❌ | ❌ | ❌ |
| 启动 Investigator | ✅ | ❌ | — | ❌ |

¹ 机械触发仅限：PlanFork flooding 超阈值；audit 高影响 unresolved discrepancy；运行时明确要求人工判断的 Agent report。**不**因 Claim scientific conflict 触发（INV-ATTN-5）。
² 计划书 §6.3：插件不限制 Agent 对 planned merge / contract 的写入；V1 以文件编辑权限为准（Agent 在 workspace 内可直接编辑 contract.md，插件不阻止也不默认提示）。

---

## 7. RPC 与工具面

### 7.1 Client RPC（Typert Remote，低频 query/mutation）

`getDashboard` · `getProject` · `getTopic` · `getWorkstream` · `queryHistory` · `reorderPlan` · `selectPlanFork` · `dismissPlanFork` · `updateInterventionState` · `registerInteraction` · `saveResearchCheckpoint` · `getGitHistory` · `restoreDeclarativeFile`

规则：持续 stream 不塞进 unary RPC；实时性策略见 §8。

### 7.2 Agent-facing tools

可写：`research_fact_record` · `research_claim_record` · `research_artifact_register` · `research_intervention_create` · `research_next_action_create` · `research_plan_fork_create` · `research_run_checkpoint`

只读：`research_context_get` · `research_plan_get` · `research_history_query` · `research_contract_read`

禁止暴露给 Agent 的操作（INV-PERM-2）：canonical plan reorder、PlanFork select/dismiss、Intervention 状态、topology delete/rewrite、Git restore、History mutation/delete、user awareness state。

---

## 8. 实时性与性能策略

**实时性**（V1 不开发独立 streaming protocol）：

1. 初始页面通过 RPC 拉 snapshot；
2. Run live 状态尽量复用 DSH 已有 session/event/client feed；
3. 低频 research state mutation 后主动 invalidate/refetch；
4. 必要时当前页面低频 polling。

**性能**（V1 不实现 materialized projection/snapshot framework；单用户前几个月预计 ~10⁴ event，直接 replay/query，先 profile 后优化）：

1. 初始化只加载 Project/Topic/Intervention/Attention summary；
2. Workstream 图按 Topic 懒加载；
3. History 按页面/时间窗口分页；
4. 大图只渲染当前 viewport / selected neighborhood；
5. Run/Session 详情按需读取；
6. 性能验收：10,000 HistoryEvent synthetic dataset 下无明显 O(n²) 路径（TEST_MATRIX TC-PERF-\*）。

---

## 9. 安全

1. **Git**：不静默 init / commit；checkpoint 仅 `.research/**`；冲突状态 fail loud；restore 显式触发；argv API（§5.8）。
2. **Agent**：PlanFork creation 是 proposal 权限而非 plan mutation 权限；Investigator 只读 FS/sandbox；Agent 不得改 Intervention user-state、不得 hard delete。
3. **插件数据**：不存 API key；Artifact 只存 path/URI/reference，不复制敏感大文件。

---

## 10. 失效与降级

| 失效 | 行为 |
|---|---|
| Git 可执行缺失 / 非 repo | 拒绝 managed research mode，给出「Initialize Git Repository」显式操作入口；绝不静默 init |
| `.research/` 文件非法（schema 校验失败） | 拒绝加载该文件并报错定位（文件+字段），不猜测修复；其余文件正常加载 |
| SQLite 损坏 | 报错 + 指向数据库文件；声明式真源（`.research/`+Git）不受影响；operational 数据（History/Run/Intervention 等）**不可恢复**，需重新积累（已知风险：V1 不做事件导出/备份；派生列重建仅适用于事件表完好的场景，见 TC-HIST-006） |
| DSH API breaking change | 仅 dsh-adapter 层失效；domain 测试必须不依赖 DSH（纯逻辑），compatibility smoke 见 DSH_ADAPTER.md |
| 插件崩溃 | 原子文件写（临时文件+rename）保证 `.research/` 不留半写状态；Git workspace 与 DSH Sessions 不受影响（INV-DB-3） |
| PlanFork 基准失效 | 自动 STALE，不阻塞用户；重提议由 Agent 重新发起 |

---

## 11. 文档地图

| 文档 | 内容 | 何时查阅 |
|---|---|---|
| 本文件 | 架构、分层、不变量目录 INV-\*、权限矩阵 | 任何设计决策前 |
| `DOMAIN_SCHEMA.md` | 全部对象的正式字段、ID 规范、状态机、`.research/` 布局、SQLite 表映射 | 实现任何 domain/persistence 代码前 |
| `HISTORY_EVENT_CATALOG.md` | 事件信封、20 个事件 payload、双时序回放规则 | 实现 history 层前 |
| `PLAN_FORK_SPEC.md` | PlanFork 模型、closure/blob OID、stale、SELECT/DISMISS、flooding | 实现 plan fork 前 |
| `GIT_INTEGRATION.md` | Git 操作白名单、checkpoint 流程、错误分类、实测行为记录 | 实现 git 层前 |
| `DSH_ADAPTER.md` | DSH 0.1.0-rc.8 真实 API ↔ adapter 接口映射、打包 runbook | 实现 dsh-adapter 前 |
| `TEST_MATRIX.md` | INV-\* → 测试用例追溯、验收标准覆盖 | 写任何测试前 |
| `schema/` | JSON Schema 2020-12 冻结契约（机器可读） | 生成运行时校验与 fixture |
