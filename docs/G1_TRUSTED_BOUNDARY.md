# G1 — Trusted boundary / lifecycle（独立说明，非冻结）

> 范围：BASELINE_PLAN §2c（PR 组 G1，先于 G2-G4）+ §3 review 点 #1/#3。
> 分支 `feat/g1-trusted-boundary-lifecycle`，基线 `6cd8663a640b7c9b02c54535363c922c1e3b2eff`。
> 本文只述 G1 落地的边界与其证据；各 stub 的业务成功语义属 G2/G3/G4，不在此发明。

## 1. 交付的两条边界

### B1 · Live-wiring dispatch（修「rescan 后工具闭包持旧 wiring」）

- **缺口**〔实证 `0fa2b1a` = 本基线 src〕：11 工具在 `[Service.init]` 注册一次并捕获
  boot wiring 的 `tools` 闭包；`#reinitResearchPlane`（setHub/bind/unbind/restore/rescan 的
  统一尾部）换新 wiring 后，旧闭包落在已关闭连接——使用面 fail-loud
  （`runbinding tables are closed` / db-adapter 的 `WIRING_CLOSED` 类），非静默但不可用。
- **修复**：注册仍恰好一次（显式单项目注册边界不变、注册数不随 mutation 增长），但
  `#runResearchTool(name, …)` 每次调用从**当前 `#wiring`** 现取可执行定义
  （`wiring.tools.find(name)`）——与 commands 通道既有的 `() => this.#wiring` getter 及
  `requireRpc` 同纪律。live wiring 缺席（spike/多项目/unbind 后）→ 清晰
  `TOOL_INTERNAL … not initialized`，绝不裸抛已关闭连接。
- **不变式**：frozen §7.2 面意味着任意 wiring 暴露同名 11 工具；现取 miss = 组合不变式破坏，
  fail-loud（不回落注册时闭包——那正是陈旧类）。
- **证据**：`tests/discovery/host-tools-reinit.test.ts`（真宿主缝：boot 成功 → `rescan({})` →
  同一批已注册 def 再次成功 + 注册数仍 11 + boot wiring 直读确已 closed；identity 用例见 B2；
  unbind 后 11 工具全部清晰 TOOL_INTERNAL）。修复前红证：
  `.baseline-logs/g1/focused-red-prerefix.log`（`runbinding tables are closed`）。

### B2 · Checkpoint 同-run 等值门（caller.run_id === target runId）

- **缺口**〔实证〕：`RunBindingService.recordCheckpoint` 只验 actor kind（USER-or-AGENT）+
  目标 run 存在；AGENT(run-A) 可对任意 run B 补记 note——INV-PERM-1 的 run-attribution 未在
  可信边界执行。
- **修复**（在**服务边界**，覆盖全部调用方；工具层不重复实现）：
  存在性检查仍最先（错 id 对任何车道保持 `RB_RUN_NOT_FOUND`，无 oracle 变化）；随后
  AGENT 报告者必须携带自己的 formal `run_id` 且等于目标 run，否则新错误码
  **`RB_CHECKPOINT_FOREIGN_RUN`**（缺 run_id 视为未归因 → 同拒）。USER 车道**不收紧**
  （跨 run 备注仍是 GUI/运维车道，§6.1）。工具面结构化载体不变：`TOOL_SERVICE` +
  `detail.serviceCode=RB_CHECKPOINT_FOREIGN_RUN`。
- **不发明 RUNNING-only**：§6.1 状态无关，终态 run 仍可被同 run AGENT / USER 补记——测试钉住
  （`checkpoint-boundary.test.ts`「no RUNNING-only invention」）。
- **来源身份不由输入伪造**（既有链路，G1 加钉）：actor 由宿主从 `exec.agent.sessionId` →
  `getRunBySessionId` 解析，args 无任何身份键（11 面全量扫描 + 两个活工具对注入 `actor` 键
  的 TOOL_INPUT 拒绝）；`run_id` 仅存在于 run-checkpoint 一面且为**目标**语义，B2 门使
  target === caller。
- **证据**：`tests/runbinding/checkpoint-boundary.test.ts`（同 run 正例保持 / 跨 run 拒 + 目标行
  未动 / 无 run_id AGENT 拒 / USER 跨 run 放行 / 终态 run 可记 / 存在性最先）、
  `tests/tools/run-checkpoint.test.ts`（转发保真 + 工具面映射）、
  `tests/tools/trusted-boundary.test.ts`（身份不可伪造面钉）、
  `tests/discovery/host-tools-reinit.test.ts`（宿主缝跨 run 拒绝 + run-less session 无法经 args
  制造身份）。

## 2. 保留的既有边界（未动，测试不重复但此处备案）

- 单项目平面注册面（host/index.ts `#wiring` 单例注释区）；多项目工具面仍 T3.x。
- 7 写 + 4 读车道、Investigator = 4 只读白名单（`permissions.test.ts` 既有审计）。
- 窄依赖 `ResearchToolDeps` 两面（INV-PLAN-3 类型面证明）；`createdByRun` 只从 gate 强制的
  `ctx.runId` 流入。
- event-first, row-second 写序与已承认残余窗口；`[CODE]`-in-message + 结构化 ToolError 载体。
- USER-only 清单（SELECT/DISMISS PlanFork、canonical plan 修改、NextAction PROMOTE/DISMISS 等）
  继续不入工具面。**非政策禁止**备案：Claim retraction / mark-Artifact-missing 在 §6 矩阵对
  AGENT 为 ✅，但不在本轮 11-tool API——仅 scope 外，不得宣称被禁。

## 3. 对后续组的接线基础（不含业务语义）

- G2 读面与 G3/G4 写面的新服务端口在 `wiring/create.ts` 组入 `toolsDeps` 后，**自动**获得
  跨 rescan 存活性（B1 的现取 dispatch），无需各组自管重建；桩退役 = 替换 `makeStubDefinition`
  为该工具的真实 handle/严格 output schema，dispatch/生命周期层零改动。
- 成功 schema 的既有先例：两个活工具返回真实记录投影（`status` 判别 + 冻结记录），
  G2 的严格 output schema 直接沿用该形态（history 的 bounded 分页为 Q2 小裁决，仅该工具）。

## 4. 门禁与本组证据

- 顺序 tsc→lint→build→test 全套日志：`.baseline-logs/g1/`（会话工作区，不入库）。
  tsc 与 `docs/BASELINE_TSC_BASELINE.md` **逐行**比对（非计数）；e2e = **NOT_RUN**。
- 红→绿：`focused-red-prerefix.log`（实现 stash 后 5 失败 = 恰为本两组缺口）→
  `focused-green.log`（23/23）。
- 既有 fixture 更新说明：`tests/tools/run-checkpoint.test.ts` 的正例 actor 原持
  `R-81`（与真实创建的 `R-1` 天然错配，系旧缺口下的历史遗留）——G1 后改为同 run id；
  跨 run 用例新增为负例。这是计划 §2c 明载的契约修正，非回归。
- **Review #1 窄修（host error code/message 互换）**：`ResearchToolHostError` ctor 为
  `(code, message, options)`，但 host catch 与 `toHostError` 两处按 message-first 传参
  （preexisting），机器路由 `error.code` 实为整句、`message` 反成裸码；G1 的 checkpoint
  拒绝把该形状直接暴露到模型侧。修复 = 两处改为 code-first（message 文本面保持原句式、
  `cause` 经标准 ErrorOptions 透传——对 pinned 运行时实测确认，非发明接口）；missing-tool /
  not-initialized / caller-unresolved 三处构造本已正确未动。宿主测试相应升级为**精确
  `error.code` 等值断言**（跨 run→`TOOL_SERVICE`、内部异常注入→`TOOL_INTERNAL`、
  run-less→`TOOL_RUN_REQUIRED`，message 只作包含性辅证），并新增一个 live-wiring
  故障注入用例覆盖 unexpected-throw→`TOOL_INTERNAL` 映射。红→绿证据：
  `review-fix-red.log`（`code="TOOL_RUN_REQUIRED: …整句"` 精确断言失败）→
  `review-fix-green.log`（23/23）；tsc 逐行仍与基线 diff 为空（`tsc-reviewfix.log`）。

