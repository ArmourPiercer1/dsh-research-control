# TEST_MATRIX.md - 测试计划与追溯矩阵

> 文档状态：**Frozen V1**（2026-08-22 冻结；含独立审计修订 A-1（TC-DB-002 措辞）与新增 TC-DOM-033，追溯见计划书 §40 附录）
> 上游：计划书 §33（测试计划）、§34（V1 验收标准）、各规范文档的 INV-\* 条目
> 追溯链：`ARCHITECTURE.md` INV-\*（及其他文档规则）-> 本文档 TC-\* -> 实现期测试代码。**任何 INV 无测试覆盖即视为冻结 blocker。**

---

## 1. 测试策略总览

| 套件 | 前缀 | 运行器 | 环境 | 速度 |
|---|---|---|---|---|
| Domain 单元 | TC-DOM | vitest | 纯逻辑，无 I/O、无 DSH | 快，每次提交 |
| History 属性 | TC-HIST | vitest + fast-check | 纯逻辑 + 临时 SQLite | 快 |
| Git 集成 | TC-GIT | vitest | 每用例独立临时 Git repo | 中 |
| DSH 集成 | TC-DSH | vitest | 本仓库 DSH checkout（0.1.0-rc.8）dev harness | 中 |
| Audit/DB 韧性 | TC-AUDIT / TC-DB | vitest | 临时 repo + 临时 DB | 中 |
| UI E2E | TC-E2E | Playwright | DSH Web GUI + 本插件 | 慢，夜间/发布前 |
| 性能 | TC-PERF | vitest bench | synthetic dataset（10k events） | 中 |

原则：

- domain 层测试**禁止** import DSH（INV-PERM-5 的可测试面）；
- Git 集成测试**每个用例**使用独立 `mkdtemp` 仓库，测试后销毁；
- 事件 fixture 由 `schema/history/` 自动生成（每事件 ≥1 正例 + mutation 负例）；
- 所有属性测试使用固定 seed 的随机事件序列，失败可复现。

## 2. 不变量 -> 测试覆盖矩阵

### 2.1 结构 / 三时区 / Task

| 不变量 | 覆盖用例 |
|---|---|
| INV-STRUCT-1 | TC-DOM-001 |
| INV-STRUCT-2 | TC-DOM-002 |
| INV-STRUCT-3 | TC-DOM-003 |
| INV-STRUCT-4 | TC-DOM-004 |
| INV-TZ-1..2 | TC-E2E-005、TC-HIST-002 |
| INV-TZ-3 | TC-DOM-006（plan 校验仅 PLANNED 项）、TC-E2E-005 |
| INV-TZ-4 | TC-DOM-016（返工新 Task 语义：EXECUTED 后仅可新建 Task，不可回退 execution） |
| INV-TASK-1 | TC-DOM-016 |
| INV-TASK-2 | TC-DOM-017 |
| INV-TASK-3 | TC-DOM-017、TC-DOM-018 |
| INV-SCI-4 | TC-DOM-019 |

### 2.2 History / Plan

| 不变量 | 覆盖用例 |
|---|---|
| INV-HIST-1 | TC-HIST-003、TC-HIST-005（无 update/delete API 为编译期+测试断言） |
| INV-HIST-2 | TC-HIST-007 |
| INV-HIST-3 | TC-HIST-009 |
| INV-HIST-4 | TC-HIST-008 |
| INV-HIST-5 | TC-HIST-001 |
| INV-HIST-6 | TC-HIST-003 |
| INV-HIST-7 | TC-DOM-015 |
| INV-HIST-8 | TC-HIST-007（wrapper 聚合不改底层事件） |
| INV-HIST-9 | TC-DOM-022 |
| INV-PLAN-1 | TC-DOM-005、TC-E2E-003 |
| INV-PLAN-2 | 设计约束（无自动化；由 schema 无 dependency 字段保证） |
| INV-PLAN-3 | TC-DOM-007、TC-DOM-030 |
| INV-PLAN-4 | TC-DOM-024（创建后无修改/删除 API 路径）、TC-E2E-008 |
| INV-PLAN-5 | TC-DOM-009/010/011 |
| INV-PLAN-6 | TC-DOM-008、TC-DOM-024（工具无 base 参数的结构断言） |
| INV-PLAN-7 | TC-DOM-012、TC-DOM-029、TC-E2E-007 |
| INV-PLAN-8 | TC-DOM-009/010/011、TC-E2E-008 |
| INV-PLAN-9 | TC-DOM-029（物化后旧 item 定义文件保留） |

### 2.3 科研语义 / Relation / 注意力 / 持久化 / Git / 权限

| 不变量 | 覆盖用例 |
|---|---|
| INV-SCI-1..3 | 设计约束（无自动化）；由 schema 无 epistemic 字段保证 |
| INV-REL-1 | TC-DOM-014 |
| INV-REL-2 | TC-DOM-014（反向边拒绝、无闭包表断言） |
| INV-REL-3 | TC-DOM-014 |
| INV-REL-4 | 设计约束 |
| INV-ATTN-1 | TC-DOM-031、TC-E2E-011 |
| INV-ATTN-2 | TC-DOM-031（评分器特征权重约束：耗时仅标签） |
| INV-ATTN-3 | TC-DOM-032 |
| INV-ATTN-4 | 设计约束（awareness kind 白名单 = schema） |
| INV-ATTN-5 | TC-DOM-028（仅机械触发创建 Intervention 的枚举断言） |
| INV-DB-1 | TC-DB-004（DB schema 无 secret 列 + 扫描断言） |
| INV-DB-2 | TC-DSH-004（只存指针/摘要断言） |
| INV-DB-3 | TC-DB-001/002/003 |
| INV-GIT-1 | TC-GIT-012、TC-GIT-017 |
| INV-GIT-2 | TC-GIT-001/015（无自动 commit 路径断言） |
| INV-GIT-3 | TC-GIT-002/015 |
| INV-GIT-4 | TC-GIT-008/009/010 |
| INV-GIT-5 | TC-GIT-005（restore 仅显式触发断言） |
| INV-GIT-6 | 静态检查（git 层无 shell 拼接）+ TC-GIT-016 |
| INV-GIT-7 | 静态检查（白名单外的 git 子命令不可达） |
| INV-GIT-8 | TC-GIT-015（无 revision 表断言）+ 设计检查 |
| INV-PERM-1/2 | TC-DOM-013（agent 工具能力矩阵逐项断言） |
| INV-PERM-3 | TC-DSH-010（Investigator 无写工具注册） |
| INV-PERM-4 | TC-E2E-011 |
| INV-PERM-5 | TC-DOM-030（lint 规则 + domain 测试无 DSH import） |

## 3. 测试用例明细

### 3.1 TC-DOM 域单元

| ID | 用例 | 断言要点 |
|---|---|---|
| TC-DOM-001 | Workstream 单一 Topic 归属 | 多父/悬空 topic_id 拒绝 |
| TC-DOM-002 | 拓扑边同 Topic | 跨 Topic inputs/outputs 拒绝 |
| TC-DOM-003 | 跨 Topic 协作仅显式 relation | 拓扑层无跨 Topic 通道 |
| TC-DOM-004 | 无嵌套层级 | 嵌套 WS/OBJECTIVE 结构拒绝 |
| TC-DOM-005 | plan 顺序稳定 | 写入->重载->重启模拟，顺序逐位相等 |
| TC-DOM-006 | plan.yaml 引用校验 | item 存在、属本 WS、无重复 |
| TC-DOM-007 | Agent 无 canonical plan 变更路径 | 工具注册表逐项断言（无 reorder/insert/delete）；service 层 agent 上下文拒绝 |
| TC-DOM-008 | unresolved PF 不能作 base | 工具入参无 base；OPEN PF 上创建的新 PF 基准=canonical 而非该 PF |
| TC-DOM-009 | PF stale：plan.yaml 变化 | 顺序变化/内容变化 -> STALE + stale_reason |
| TC-DOM-010 | PF stale：item 定义变化 | 修改 T-2.goal（顺序不变）-> STALE |
| TC-DOM-011 | PF stale：closure 增删 | 增删 plan item -> 路径集合变化 -> STALE；相同内容重写不误报 |
| TC-DOM-012 | SELECT 连锁失效 | SELECT 后同 WS 其余 OPEN PF 全部 STALE |
| TC-DOM-013 | Agent 能力矩阵 | §25 工具逐项：可写集合内放行、外拒绝（含 Intervention 状态、awareness、Git restore、History delete） |
| TC-DOM-014 | Relation 规范 | 反向边（SUPPORTS/PRODUCES/REQUIRED_BY/VALIDATES）拒绝；未知 type 拒绝；组合表外 kind 组合拒绝；重复边拒绝 |
| TC-DOM-015 | 一等 identity 不 hard delete | 所有 operational 表无 delete API；retract/supersede/mark-missing 路径可用 |
| TC-DOM-016 | Task 状态机 | 非法转换逐项拒绝（含 EXECUTED 终态；「返工」只能新建 Task） |
| TC-DOM-017 | 派生字段 | DONE 公式；execution/validation/completion/blockage 直接写入拒绝 |
| TC-DOM-018 | NOT_REQUIRED 约束 | AC 非空时 validation->NOT_REQUIRED 拒绝 |
| TC-DOM-019 | 负结果任务 | EXECUTED+PASSED+DONE 判定；Claim 记录路径 |
| TC-DOM-020 | blockage 派生 | 显式 blocker/依赖 Gate 三档判定 |
| TC-DOM-021 | Gate READY_FOR_REVIEW 派生 | 前置 item 全部 EXECUTED/CANCELLED 时触发 |
| TC-DOM-022 | 拓扑事件 owner | FORK->inputs[0]、MERGE->outputs[0]；realized 边基数校验（FORK inputs=1、MERGE outputs=1） |
| TC-DOM-023 | 无 WS 关联 Intervention | 不产生 History 事件、仅入 operational 队列 |
| TC-DOM-024 | PF 创建校验全路径 | 8 项校验逐项失败路径 + 成功路径（trigger 存在性、reason/necessity 非空、anchor 合法、creator run 属本 WS） |
| TC-DOM-025 | anchor 校验 | 哨兵开关、序号关系（fork≤merge）、存在性、policy required_item_types |
| TC-DOM-026 | ID 规范 | 最长前缀解析（TE/T、INT/IN）、唯一性范围、文件名与 id 一致性校验 |
| TC-DOM-027 | 声明式加载校验 | 路径/id 不匹配、悬空引用、schema 违规 -> 精确报错定位，其余文件正常加载 |
| TC-DOM-028 | flooding | 阈值触发一次且去重（已有 OPEN 同源 Intervention 不重复）；阈值以下不触发 |
| TC-DOM-029 | SELECT 物化 | 新 item ID 分配、定义文件写入、plan.yaml 重写（KEEP/NEW/哨兵/相等 anchor）、旧 item 定义保留、ManagementAction 记录、**无** ResearchHistory 事件 |
| TC-DOM-030 | adapter 隔离 lint | src/（除 dsh-adapter）无 DSH 内部 import；domain 测试运行时无 DSH 模块加载 |
| TC-DOM-031 | Attention Manager | 只排序不隐藏（OPEN/PENDING 恒在）；耗时特征不改变重要度主导排序；human override 持久化 |
| TC-DOM-032 | Brief 投影 | 三级 Brief 每项关键陈述携带可解析 drill-down 引用 |
| TC-DOM-033 | PLANNED WS 首事件原子 realize | 首个事件接受与其 PLANNED→REALIZED 迁移（workstream.yaml + derived_state）为同一事务：成功则翻转、事件被拒则 WS 保持 PLANNED（HISTORY_EVENT_CATALOG §3） |

### 3.2 TC-HIST History 属性测试（fast-check，随机事件序列）

| ID | 用例 | 断言要点 |
|---|---|---|
| TC-HIST-001 | mutation 一致性 | 随机序列中注入 from≠当前状态 -> 拒绝且不产生副作用 |
| TC-HIST-002 | late registration | occurredAt 早于已有事件：semantic 时间线插入正确位置；audit 顺序仍尾 append |
| TC-HIST-003 | event_seq 单调 | 每 WS 内严格 +1；任何 API 不改写既有 seq/eventId |
| TC-HIST-004 | 时间并列 tie-break | occurredAt 相等时 semantic replay 顺序由 event_seq 唯一决定（确定性） |
| TC-HIST-005 | replay 幂等 | 同一事件流重放 N 次结果逐字节一致；semantic/audit 两种排序均可重复 |
| TC-HIST-006 | 派生重建 | 空 DB 重放全部事件 -> 所有派生列与原状态一致；重放不产生新事件 |
| TC-HIST-007 | 原子性 | RUNS_STARTED 拆为每 owner 一条事件；Run 结束逐 Run；wrapper 聚合视图不改底层 |
| TC-HIST-008 | schema 严格性 | 未知 eventType、未知 schemaVersion、payload 违规 -> 拒绝写入 |
| TC-HIST-009 | owner 唯一性 | 每事件恰一 owner；跨 WS 聚合事件被拒绝 |

### 3.3 TC-GIT Git 集成（每用例独立临时 repo；对应 GIT_INTEGRATION §5.2 实测）

| ID | 用例 | 断言要点 |
|---|---|---|
| TC-GIT-001 | dirty working tree | 读操作/加载不受影响；checkpoint 仅 `.research/**` |
| TC-GIT-002 | 无关 staged 变更保护 | checkpoint 后：无关变更不在 commit 中**且**仍保持 staged（实测行为固化） |
| TC-GIT-003 | untracked `.research` 文件 | 经 add+pathspec commit 进入 commit |
| TC-GIT-004 | plan hash 前后对比 | 编辑前后 `hash-object` OID 变化；相同内容重写 OID 不变；`hash-object` == `rev-parse HEAD:<path>`（内容一致时） |
| TC-GIT-005 | contract restore | `git log`/`show`/`restore --source` 全链路；恢复后 schema 校验；非法内容不静默回滚 |
| TC-GIT-006 | branch switch | 切换分支后 `.research/` 工作副本重新加载且顺序稳定 |
| TC-GIT-007 | detached HEAD | log/show 正常；checkpoint 给出警告 |
| TC-GIT-008 | merge 进行中 | checkpoint 拒绝（标志文件检测 + git 自身 `cannot do a partial commit during a merge` exit 128 双保险） |
| TC-GIT-009 | rebase 进行中 | 同上（rebase-apply / rebase-merge 标志） |
| TC-GIT-010 | cherry-pick 进行中 | 同上（CHERRY_PICK_HEAD 标志） |
| TC-GIT-011 | Git 缺失 | mock PATH 移除 git -> 功能降级、无崩溃 |
| TC-GIT-012 | 非 repo 目录 | 注册拒绝；无任何 git init 副作用 |
| TC-GIT-013 | 手工编辑 `.research/` | 非法 YAML/schema 违规 -> 拒载该文件、精确定位、其余文件正常 |
| TC-GIT-014 | 空 checkpoint | `.research/` 无变更 -> 「无可提交内容」成功短路，无空 commit |
| TC-GIT-015 | commit 内容审计 | checkpoint commit 的 diff 只含 `.research/**`；无 revision 表（schema 断言） |
| TC-GIT-016 | 超时 | 慢命令 mock -> 超时 kill、错误上报、无重试写操作 |
| TC-GIT-017 | 显式 init | 仅 GUI 显式操作触发；自动路径永不出现在调用图中 |

### 3.4 TC-DSH DSH 集成

| ID | 用例 | 断言要点 |
|---|---|---|
| TC-DSH-001 | session 发现 | 注册 workspace 内无 context session -> DiscoveredSession(PENDING) |
| TC-DSH-002 | 绑定即 Run | 显式 ResearchContext/workstream -> 自动注册 formal Run（含 workstream_id） |
| TC-DSH-003 | detach 不再发现 | DETACH/IGNORE 后同一 session 不重复出现；原 DSH session 保留 |
| TC-DSH-004 | 生命周期入史 | session start/finish 映射 RUN_STARTED/RUN_FINISHED；**只存指针/摘要，不复制 session log** |
| TC-DSH-005 | 卸载清理 | 插件 unload 后无残留 service/slot/event 监听 |
| TC-DSH-006 | RPC 类型生成 | Typert 契约 -> 双端类型一致；§7.1 的 13 个 RPC 全部可调用 roundtrip |
| TC-DSH-007 | slot 注册 | Research 页面出现在 Web GUI；刷新后仍存在 |
| TC-DSH-008 | 版本兼容 smoke | pin 0.1.0-rc.8 启动冒烟；版本不匹配时明确报错而非静默失败 |
| TC-DSH-009 | 热加载循环 | load/unload N 轮无状态泄漏 |
| TC-DSH-010 | Investigator 只读 | 注册的工具集无任何写路径；sandbox 内写操作被拒 |

### 3.5 TC-AUDIT / TC-DB

| ID | 用例 | 断言要点 |
|---|---|---|
| TC-AUDIT-001 | tracked 修改发现 | `git status/diff` 发现 strict tracked 资源的手工修改 -> 分类入 Inbox |
| TC-AUDIT-002 | 新产物发现 | discovery zone 新文件 -> UNREGISTERED_WORKSPACE_CHANGE Inbox item |
| TC-AUDIT-003 | ignored 不扫描 | ignored 目录变更不产生发现 |
| TC-AUDIT-004 | reconciliation 三档 | AUTO/PROPOSE/ESCALATE 机械分类正确；ESCALATE 产生 Intervention；不改写历史 |
| TC-DB-001 | 原子文件写 | 写入中途 kill -> 文件为旧版或新版，绝无半写 |
| TC-DB-002 | DB 损坏恢复 | 损坏 sqlite -> 明确报错；`.research/`+Git 完好；operational 数据不可恢复（派生列重建能力由 TC-HIST-006 单独保证，前提为事件表完好） |
| TC-DB-003 | checkpoint 中断 | 步骤 3/4 间 kill -> 仓库仍合法（最坏 staged 残留），无损坏 |
| TC-DB-004 | 无 secrets | DB 内无 key/token 列；写入含 secret 值的调用被拒绝 |

### 3.6 TC-E2E UI（Playwright）

| ID | 用例 | 断言要点 |
|---|---|---|
| TC-E2E-001 | 创建项目结构 | project/topic/workstream 创建后持久化（重启可见） |
| TC-E2E-002 | 增加计划项 | G/T/M 加入 plan；三区渲染正确 |
| TC-E2E-003 | 刷新顺序稳定 | 多次刷新/reload 后 plan order 逐位一致 |
| TC-E2E-004 | Run 起止 | 模拟 run start/end -> History 出现 RUN_STARTED/RUN_FINISHED |
| TC-E2E-005 | 三区迁移 | T: PLANNED->ACTIVE->EXECUTED 依次出现在 Future/Current/History，identity 不变 |
| TC-E2E-006 | PF overlay | Agent PF 与 canonical 视觉不可混淆（样式差异断言） |
| TC-E2E-007 | SELECT PF | 选择后 canonical 更新、其余 PF STALE、checkpoint 提示出现 |
| TC-E2E-008 | STALE PF | 手动编辑 canonical 后旧 PF 显示 STALE 及原因 |
| TC-E2E-009 | flooding | 制造 >阈值 OPEN PF -> AUTO_FLOODING Intervention 出现 |
| TC-E2E-010 | contract restore | merge contract 从 Git 历史恢复到 working copy |
| TC-E2E-011 | Intervention 状态 | OPEN/PENDING/CLOSED 仅用户可改（Agent 侧工具无此能力） |
| TC-E2E-012 | drill-down | Claim/Artifact -> Run -> DSH Session 链路可点击到达 |
| TC-E2E-013 | Home 2-3 击到达 | Home -> 问题对象 -> 原 Run/Session ≤3 次点击 |

### 3.7 TC-PERF 性能

| ID | 用例 | 断言要点 |
|---|---|---|
| TC-PERF-001 | 10k 事件 semantic replay | 全量语义回放 < 1s（本地 SQLite）；分页查询 p95 < 200ms |
| TC-PERF-002 | 10k 事件 audit replay | 同量级 |
| TC-PERF-003 | 过滤查询 | 按 event_type/run/task/workstream 过滤走索引（EXPLAIN QUERY PLAN 无全表扫描） |
| TC-PERF-004 | 分页 | 时间窗口分页 O(window) 而非 O(total) |
| TC-PERF-005 | 无 O(n²) | 1k vs 10k 规模耗时比值 < 15x（线性容差） |
| TC-PERF-006 | 图渲染懒加载 | 大 plan/topology 只渲染 viewport（节点数断言） |

## 4. 验收标准追溯（计划书 §34）

| AC | 验收标准 | 覆盖用例 |
|---|---|---|
| AC-1 | 多 Project/Topic/Workstream 注册 | TC-E2E-001、TC-DOM-027 |
| AC-2 | Workstream 三区正确分离 | TC-E2E-005、TC-DOM-021 |
| AC-3 | canonical plan 顺序稳定 | TC-DOM-005、TC-E2E-003 |
| AC-4 | Agent 无法直接修改 canonical plan | TC-DOM-007、TC-DOM-013、TC-DOM-030 |
| AC-5 | Agent PlanFork 完整工作 | TC-DOM-008..012、TC-DOM-024/025/029、TC-E2E-006..009 |
| AC-6 | ResearchHistory 原子、可查询、可回放 | TC-HIST-001..009 |
| AC-7 | Run/Session 生命周期可追踪 | TC-DSH-001..004 |
| AC-8 | Claim/Fact/Artifact 可 drill-down | TC-E2E-012、TC-DOM-014 |
| AC-9 | Intervention 人类责任队列 | TC-E2E-011、TC-DOM-031 |
| AC-10 | Home 推荐处理顺序 | TC-DOM-031、TC-E2E-013 |
| AC-11 | Git 查看/恢复 Plan/Topology/Contract | TC-GIT-005、TC-E2E-010 |
| AC-12 | Audit 发现未登记变化 | TC-AUDIT-001..004 |
| AC-13 | 无第二套文件版本系统 | TC-GIT-015（无 revision 表 + Git 唯一真源断言） |
| AC-14 | 不修改 DSH core | TC-DSH-005/008/009 + 仓库 diff 检查（deepseek-harness/ 零改动） |
| AC-15 | 10k 事件规模可交互 | TC-PERF-001..006 |
| AC-16 | 崩溃不损坏 Git workspace / DSH Sessions | TC-DB-001..003 |

## 5. Fixture 与测试环境

1. **临时 Git repo 工厂**：`mkdtemp` + 初始化 + 预置 `.research/` 样本；支持注入冲突状态（merge/rebase/cherry-pick）、detached HEAD、dirty/staged 变体；
2. **synthetic event 生成器**：按 `schema/history/` 生成随机合法事件序列（固定 seed），规模参数化（1k/10k）；包含 late-registration、时间并列、跨 WS 分布；
3. **事件 fixture**：schema 自动生成每事件正例 + mutation 负例（INV-HIST-4 的 fixture 化）；
4. **DSH harness**：使用本仓库 `deepseek-harness/` checkout 启动 dev harness；E2E 前置 `pnpm install` + 构建产物就绪检查；DSH 侧零改动校验（`git -C deepseek-harness status --porcelain` 为空）；
5. **DB 重建工具**：从事件流重建派生列的测试 helper（TC-HIST-006 复用）。

## 6. CI 建议

- **每次提交**：TC-DOM、TC-HIST、TC-GIT、TC-AUDIT/TC-DB、INV-PERM-5 lint；
- **每夜**：TC-DSH（含 load/unload 循环）、TC-E2E、TC-PERF；
- **发布前**：全量 + AC-1..16 追溯报告（本矩阵自动生成）；
- **兼容性**：DSH pin `0.1.0-rc.8` 基线 smoke；上游新版本出现时跑 TC-DSH-008 并更新 DSH_ADAPTER.md。
