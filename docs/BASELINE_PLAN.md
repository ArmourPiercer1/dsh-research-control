# BASELINE_PLAN — 11 工具实施计划与追溯矩阵（Stage-0 产物）

范围纪律：只列 11 个 `research_*` 工具从「当前基线」到「全部真实现」的**必要前置**；
不把 tsc 21 错、构建 normalize 等历史债扩进本阶段（各自独立小 PR）。

## 1. 保留的产品边界（不可动摇，来自冻结面与现有决策）

- 工具**仅在单项目平面注册**（`src/host/dsh-adapter/host/index.ts:512` 区域注释 + `#wiring` 单例语义）；
- **7 写 + 4 读** 权限车道（ARCHITECTURE §7.2；`src/host/tools/index.ts:190-192` WRITE/READ 分组）；
- **Investigator = 4 只读闭集**（`src/host/tools/index.ts:196-201` INVESTIGATOR_TOOL_NAMES = READ 组，INV-PERM-3 三层）；
- 两连接 **event-first, row-second** 写序与已承认的残余窗口（runbinding 模块头 L39-68）——不重设计持久化；
- `[CODE]`-in-message 错误载体 + 结构化 ToolError（现有惯例）；
- **Non-goals 两分类（精确口径，不捏造更严政策、不扩范围）**：
  1. **明确 USER-only**（§6 权限矩阵对 RESEARCH_AGENT 为 ❌ / INV-PERM-2）：SELECT/DISMISS PlanFork
     （`ARCHITECTURE.md:314`；`PLAN_FORK_SPEC.md:112` §6 用户 GUI 触发）、canonical plan
     reorder/insert/delete（`:311`）、Intervention OPEN/PENDING/CLOSED（`:319`）、
     **NextAction PROMOTE/DISMISS（`:321`；`DOMAIN_SCHEMA.md:443`「用户才 PROMOTE」、`:552`）**、
     Awareness（`:322`）、topology declarative 编辑（`:323`）、manifest 编辑（`:310`）、
     git「Save Research Checkpoint」（`:326`；注意 `research_run_checkpoint` 工具对应的是 `:317`
     Run 生命周期行的 AGENT 半——非 git commit）、Git restore、History mutation/delete（`:280`）。
     agent 工具面**不得**暴露这些操作。
  2. **冻结面允许 AGENT、但不在本轮 11-tool API 的操作（outside current scope，非政策禁止）**：
     **Retract Claim / mark Artifact missing**（§6 矩阵 `:317` USER ✅ **RESEARCH_AGENT ✅**；
     `HISTORY_EVENT_CATALOG.md:72` CLAIM_RETRACTED emitter=U A、`:74` ARTIFACT_MARKED_MISSING=U A P）、
     Merge Contract 编辑（`:324` AGENT ✅²；11-tool 仅含 contract_read 读面）。
     这些属未来能力评估，**本轮不实现、也不得声称被禁**。本轮范围 = 现有 11 工具。

## 2. 追溯矩阵（11 工具）

列：契约来源（冻结）→ 现状〔实证 SHA `0fa2b1a1`〕→ 目标服务/handler → 必要前置 → 验收 → 并行性。

### 2a. 写车道 · 语义三件套（PR 组 G3）

| 工具 | 契约来源 | 现状 | 目标路径 | 必要前置 | 验收 | 并行性 |
|---|---|---|---|---|---|---|
| research_fact_record | DOMAIN_SCHEMA §7；semantic-labels.schema.json；FACT_RECORDED（CATALOG）；ARCH §7.2 | 桩（`fact-record.ts:56`）；服务已有**USER 车道** `semantics/service.ts:168` | tools/fact-record → 新窄 agent 入口 → SemanticsService | **窄 agent 创建入口**：actor=AGENT(run_id) 事件、trusted run 校验、sameWS 门、`created_by_run` 行字段；`RecordFactArgs` 无 actor/run 形参（`semantics/types.ts:71`）——需窄化扩展（additive，USER 车道不动） | semantics 套件新用例 + `tests/tools/stubs.test.ts` 中该桩条目退役 + 冻结 schema 校验成功输出 | 与 claim/artifact 同一服务面，**内部串行**（reserve→precheck→append→commit 单通道，ADJ-2）；三工具间可并行开发同一改造 |
| research_claim_record | 同上（CLAIM_RECORDED） | 桩（`claim-record.ts:54`）；`service.ts:177` USER 车道 | 同上 | 同上（同一改造覆盖） | 同上 | 同上 |
| research_artifact_register | 同上 + BY REFERENCE §13.6（ARTIFACT_REGISTERED） | 桩（`artifact-register.ts:73`）；`service.ts:195` | 同上 | 同上 | 同上 | 同上 |

### 2b. 写车道 · 注意力两件（PR 组 G4）

| 工具 | 契约来源 | 现状 | 目标路径 | 必要前置 | 验收 | 并行性 |
|---|---|---|---|---|---|---|
| research_intervention_create | DOMAIN_SCHEMA §9.2；attention.schema.json；INTERVENTION_CREATED | 桩（`intervention-create.ts:119`）；服务已有（WP-5.1）：目标 API **`InterventionService.createMechanicalIntervention(params, actor)`**（`intervention/service.ts:160`），AGENT_REPORT 固定映射 `intervention/types.ts:122/130`（`AGENT_REPORT_REQUIRES_HUMAN`→origin=AGENT_REPORT+AGENT actor，已有测试 `tests/intervention/service.test.ts:211`；actor kind 门已有 `service.ts:175`） | tools → `createMechanicalIntervention`（不发明新 API 名） | **实际缺口精确化**：WS **存在性**校验已存在（`service.ts:219-228` 经 `#externalState().workstreams`，§16 规则 2；shape 在 :205-217）；source_refs 目前仅 shape（:211-217）→ 缺口 = **AGENT run 存在/归属校验 + source_refs typedRef 存在性 maps**（窄 validation context 注入）；保留 multiWS/optionalWS 与队列/事件语义，固定 AGENT_REPORT 不动 | 服务级注入真实 run/ref ctx 用例 + 桩条目退役 + 事件 payload 冻结校验 | 与 G3 并行（不同服务）；两工具**不同服务**（见下行） |
| research_next_action_create | DOMAIN_SCHEMA §9（NEXT_ACTION）；PROPOSED 行 | 桩（`next-action-create.ts:51`，planned WP-5.2） | tools → **ActionsService（独立服务，非 intervention）**：`createNextAction(params, actor)`（`actions/service.ts:214`） | **已有能力，勿重复造**：actor creator 门（`assertNextActionCreator` :215）+ optional WS 存在校验（:217-219）均已具备——本工具缺的主要是**工具→服务接线本身**（+ AGENT actor 透传），**不需要**新增 WS 校验 | 桩条目退役 + 接线用例（AGENT creator 通过、USER-only 操作仍拒） | 与 G3/intervention 并行（独立服务） |

### 2c. 写车道 · 已活两件 = 生命周期修复（PR 组 G1，**先于 G3/G4**）

| 工具 | 现状 | 缺口（父方 review #1/#3，已核实〔实证〕） | 必要前置 | 验收 |
|---|---|---|---|---|
| research_plan_fork_create | 活转发（deps port `planForkCreate`，`tools/index.ts:232`） | **re-init 后工具闭包悬空**：工具在 `[Service.init]` 注册一次并捕获 wiring 闭包；`#reinitResearchPlane`（`index.ts:1647-1662`）换 wiring 后旧闭包落在已关闭连接（自述边界 L1624-1634：使用时 fail-loud `WIRING_CLOSED`，非静默） | dispatch 改为**每次调用现取** wiring（对齐 commands 通道的 `() => this.#wiring` getter 纪律，L1636-1645 已有先例）；或等价的轻量 re-registration。不引入多项目面。顺带修正同函数注释的过期计数（L1608「any of the 22」→ 58+1） | rescan→两工具调用不触 `WIRING_CLOSED` 的回归测试（e2e t64 式或 host 级） |
| research_run_checkpoint | 活转发（`run-checkpoint.ts:126` → `RunBindingService.recordCheckpoint`） | **缺 `caller.run_id === 目标 run_id` 等值校验**（`runbinding/service.ts:467-482` 只验 actor kind + run 存在）。不加 RUNNING-only（现有语义允许终态 run 补记 note，尊重现状不发明策略） | 工具/服务边界上补等值校验（AGENT actor 必须 `actor.run_id === runId`；USER 保持可跨 run） | 负例：AGENT(run-A) checkpoint run-B → 结构化拒绝；正例保持 |

### 2d. 读车道四件（PR 组 G2，彼此独立、可与 G3/G4 并行）

| 工具 | 契约来源 | 现状 | 目标服务（plannedService〔实证〕） | 必要前置 | 验收 |
|---|---|---|---|---|---|
| research_context_get | DOMAIN_SCHEMA §6/§14 | 桩（`context-get.ts:40`） | runbinding + declarative loader 组合（WP-3.6 注释） | 真实成功 DTO → **严格 output schema 替换 `STUB_OUTPUT_SCHEMA`**（`stub.ts:33`）。**单 binding → 返回完整结构化 subject，不新增截断/分页**（有界由对象基数天然保证，非人为 cap） | 服务用例 + 输出对 schema 实例校验 |
| research_plan_get | PLAN_FORK_SPEC / §4.4 | 桩（`plan-get.ts:45`） | PlanStore.loadPlan（WP-1.3） | **单 WS 的 canonical plan → 返回完整结构化 subject**（严格 output schema；**不分页、不截断**——plan 是该 WS 的完整真源） | 同上 |
| research_history_query | HISTORY_EVENT_CATALOG；信封 schema | 桩（`history-query.ts:70`）；参数面已有分页键（`limit≥1`、`after/before_seq`）**但无默认页大小/上限**（`history-query.ts:44`） | queryEvents（WP-2.3） | **唯一需 bounded 的工具**（事件流可无界）：默认 limit + max cap 决策（**小裁决项 Q2，仅限本工具**）；真实投影事件 DTO 严格 output | 分页边界测试 + 输出实例校验 |
| research_contract_read | PLAN_FORK_SPEC §contract | 桩（`contract-read.ts:47`） | MergeContractStore.readContract（WP-1.4） | **单 edge 的 merge contract → 返回完整结构化 subject**（严格 output schema；不分页/不截断，非 history 口径） | 同上 |

### 2e. 收口（PR 组 G5）

acceptance（11 工具端到端 e2e 新 t 系列）、**非冻结补充追溯文档**（新增
`docs/TOOLS_TRACEABILITY.md` 或在 `BASELINE_PLAN.md` 矩阵上演进，INV→TC→AC 落点随工具 PR 更新）、
README「Model Experience/已知局限」改写、`tests/tools/stubs.test.ts` 全文退役为「无桩断言」。
**注意**：`TEST_MATRIX.md` 是 Frozen V1 快照（正源在仓库外层工作区根，INDEX canonical-only 规则）——
G5 **不直接编辑包根快照**；矩阵进入 TEST_MATRIX 正源的前提 = 正源更新**已获授权且可用**，
否则追溯仅存非冻结补充文档。

## 3. 父方 review 五点 → 计划映射

| # | 核实结论〔实证〕 | 落点 |
|---|---|---|
| 1 | 属实：`index.ts:1624-1634`（闭包持旧 wiring，使用面 fail-loud）+ `:1647-1662`（re-init 不重注册工具）。命令通道已有 live getter 先例 | G1 |
| 2 | 属实：`RecordFactArgs` 无 actor/run（`semantics/types.ts:71`）；服务硬编码 USER_ACTOR（`service.ts:106`） | G3 |
| 3 | 属实：`recordCheckpoint` 无 run 等值校验（`runbinding/service.ts:467`）；不发明 RUNNING-only | G1 |
| 4 | 修正后口径：intervention 的 WS **存在性**校验已有（`service.ts:219-228`，§16 规则 2）——真实缺口是 **AGENT run + source_refs 存在性 maps**（source_refs 仅 shape `:211-217`）；`createNextAction` 在**独立** ActionsService 且 actor 门 + optional WS 校验已有（`actions/service.ts:214-220`）。固定 AGENT_REPORT 映射有测试钉 | G4（窄 run/ref 校验；NextAction 仅接线，勿冗余 WS 校验） |
| 5 | 属实：9 桩 output=permissive STUB schema（`stub.ts:33`）；history 无界风险（无默认 limit）。#5 里的 select/canonical mutation/**promotion** = §6 矩阵 USER-only（`:314/:311/:321`）；**retraction（claim retract/artifact-missing）矩阵允许 AGENT**（`:317`）但不在本轮 11-tool API——见 §1 non-goals 分类 2。均非「待裁决缺口」 | G2（严格 output schema；**bounded 仅 history 分页**——context/plan/contract 单对象返回完整 subject，无人为截断）；select/promotion 不在工具面；retraction 属未来 scope 评估、本轮不做 |

## 4. 建议 PR 组顺序与并行边界

```
G0 测试 resolver 可覆盖化（小，见 §5 Q0）          [可并行，建议最先]
G1 boundary/lifecycle（dispatch live-wiring + checkpoint 等值） → 后续工具的地基
G2 4×read（一件一 PR 或 2×2，相互独立）            ┐ G3 3×semantic-create（一个窄入口改造 +
G4 2×attention                                    ┘  三工具转发）  与 G2/G4 并行
G5 integrated acceptance / docs / artifacts（最后，依赖 G1-G4 全部合入）
```

## 5. 未决 / 需父方或用户裁决（不在本阶段实现）

- **Q0**（工程）：14 个测试 resolver 硬编码 `WR_ROOT=<repo>/..` 且无 env 覆盖（清单见 PROGRESS §2）。
  建议 G0 引入统一 `resolveTestWorkspaceRoot()`（读 `DSH_RESEARCH_WORKSPACE_ROOT`，默认现值）；
  Stage-0 仅以 §4（PROGRESS）准备步骤过渡。
  **RESOLVED（G0，PR feat/g0-reproducible-test-root）**：`tests/helpers/workspace-root.ts` 落地；
  默认改为**包内快照**（父层默认达不成 standalone 目标；SI-001 sha256 内容一致保证 canonical 布局语义不变），
  `DSH_RESEARCH_WORKSPACE_ROOT` 显式覆盖指 canonical 正本。实际唯一 resolver 文件 = 14
  （§2 清单去重 stale-precheck 后 13，另补 §2 漏计的 `tests/git/tc-git-015.test.ts` URL 变体——由无 fixture
  隔离实跑捕获）。契约与复现见 `docs/G0_REPRODUCIBLE_TEST_ROOT.md`。
- ~~**Q1**~~（**已撤销 — 假阻塞**）：PlanFork select/dismiss、canonical plan mutation 等在冻结面
  （`ARCHITECTURE.md:280` INV-PERM-2、`:350` 禁止清单；`PLAN_FORK_SPEC.md:112` §6「SELECT 物化流程（用户，
  GUI 触发）」）中**明确为 USER 专属**，agent 工具面本就不应存在这些操作——属既定 non-goal（§1），
  **非缺口、非待用户裁决项**，不排期。
- **Q2**（小，**仅 history**）：`research_history_query` 默认页大小与上限的具体数值（bounded-output 文档协调）；context/plan/contract 读面**不在**此列（单 binding/单 WS/单 edge 返回完整结构化 subject，不新增截断或分页）。
- **Q3**（债务清单，独立小 PR）：tsc 21 错（src 2 + tests 19，PROGRESS §3；逐行证据 `docs/BASELINE_TSC_BASELINE.md`——修复前后按该文件**逐行 diff**判定增删，非计数）；构建 normalize
  （CSS region 注释/SNAPSHOT 时间戳）；无 CI。均不并入 11 工具 PR 组。
- **Q4**（正源）：V2 设计正源/计划书/SI-001 裁决书是否入库（BASELINE_INDEX §3 缺口清单）。
