# Engineering Baseline — 结构设计

> 状态：**实施方案 / 用户已接受 AD-EB-01、AD-EB-02；尚未实施**（2026-10-26）。
> 本文件是工程治理的目标契约，不是当前运行时事实，也不修改 V1 冻结接口。
> 源基线：`main` @ `8b910513e188db5aac08b8840756f2f25b8028d4`。
> 执行顺序与停工门：见 [EXECUTION_PLAN.md](EXECUTION_PLAN.md)。本设计 PR 只写文档。

## 1. 使命与不变边界

在继续 [V3 架构 PR #9](https://github.com/ArmourPiercer1/dsh-research-control/pull/9) 和 [V3 PoC PR #10](https://github.com/ArmourPiercer1/dsh-research-control/pull/10) 之前，为 `dsh-research-control` 建立**独立 clone 可复现、契约有唯一归属、实现与验证状态可辨、CI 自动运行、证据有边界**的工程基线。

约束：

1. **不改变产品职责**：本项目管理科研记录、状态、来源、语义和注意力，不负责 Agent 编排、调度、审批或设备控制；不得把 DSH / `dsh-agent-team` 职责吸收进中心。
2. **不重新设计冻结 V1**：十一种 `research_*` 工具、RPC、历史事件、Schema、数据库迁移语义、权限和当前科研数据不因“文档整理”而改变。需要语义变更必须另开 Contract/ADR。
3. **不复制过重的团队治理**：Git + 少量人工状态 + 派生视图 + 分层检查足够；不引入不可变 Authority Snapshot/指针切换、中央执行编排器、复杂审批图或新服务。
4. **无默许通过**：历史测试、局部模拟、已跳过项、真实 Host 未运行项都不得写成“本次通过”。
5. **不做无限盘点**：未知事实列为 UNKNOWN/待裁决；不自动扩大范围、搬运大量日志或重写整个文档体系。

本轮是**工程基础设施重构**，不是 V3 业务功能开发。实际阶段合并 SHA 与最终 Host pin 在 EB0 清点后登记；不可用旧报告代替本轮运行。

## 2. 两项已接受的架构决策

### AD-EB-01 — 正式契约正源进入本 Git 仓库（Accepted）

目标：`schema/**` 与当前根目录的八份冻结契约文档成为**同一 Git 提交中受版本管理的唯一可编辑正源**。版本化源码、正式契约、打包输入和测试输入彼此绑定。外部科研工作区可**消费**它们，不再可以在构建时静默覆盖它们。

这是对现行 SI-001 快照机制的**有控制替换**，而非声称已经切换。旧机制的真实状态为：

- `scripts/snapshot-release.mjs` 构建时以仓库父目录（或 `DSH_SNAPSHOT_SOURCE_ROOT`）为作者正源，复制 `schema/**` + 八份根文档到包根，原路径标记只读并写 `SNAPSHOT.md`；
- 当前包根的契约副本、`SNAPSHOT.md` 和预构建 `lib/` 已入 Git，供 git-install / tarball 使用；
- `docs/BASELINE_INDEX.md` 记载外层 V2 设计、SI-001 裁决书和“计划书”的仓外正源缺口；不得假装它们已经入库；
- G0 已使单独 clone 的测试默认使用仓库自身 `schema/`，此成果必须保留。

**正源迁移协议（见 EB1）**：

1. 清点外部正源和包内副本，按文件清单比较 SHA-256；对外部缺席、内容冲突或无法验证的文件停止自动切换，提交差异及来源裁决。若外部不可访问，只有用户**显式批准**以某个仓库提交中的快照作为新正源，才允许继续；不得默认“仓内较新就是正确”。
2. 在一个可回滚的迁移 PR 中切换正源权威与构建逻辑：仓库内文件可在经过冻结变更流程后修改；不再把仓库父目录当作隐含正源。
3. `snapshot-release.mjs` 应改成**非破坏性、确定性的契约校验/发布清单生成器**，或迁入新脚本并保留兼容入口；严禁再删除重建包内 canonical `schema/` / 根文档、从父目录回填或“缺源 loud-skip 即绿色”。保留发布包的同名契约文件和必要兼容面，`SNAPSHOT.md` 改为**仓库内正源对应内容哈希的发布清单**（不是第二正源）；消除易变生成时间/机器绝对路径对版本树的污染。
4. 更新 `schema/README.md`、根 `README.md`、`docs/BASELINE_INDEX.md`、`docs/packaging.md`、构建说明和所有有关外部正源的权威声明。把 SI-001 旧判决作为历史记录明确标注 `superseded by AD-EB-01 @ <merge SHA>`；未取得旧正本文本时可登记缺口，不得伪造或删除历史。
5. 继续验证 `pnpm run build`、`pnpm run pack:verify`、已提交 `lib/` 新鲜度、完整分发包中的 Schema/八文档及独立安装行为。运行时 `DSH_RESEARCH_SCHEMA_ROOT` 作为现有显式部署覆盖接口应先保留，另行检查和记录覆盖所指版本，**不借工程治理改变实际运行时解析优先级**。
6. 迁移合并点是唯一的“新正源生效点”；迁移前执行旧规则，迁移后执行新规则。外部原件先只读保留，禁止未经裁决删除；合并失败、验证失败或出现双正源时回退整个迁移变更，不能只修半个构建脚本。

### AD-EB-02 — 轻量治理、暂不引入权威快照系统（Accepted）

保留 `Git SHA / PR / ADR / contracts / tests / registry` 作为基础。只有**非可推导**的决策与状态由人维护，机器事实从 Git、Schema、构建和测试提取。绝不为状态更新引入需要单独运行的中心服务、Authority Pointer、双读迁移或编排拓扑。若未来有多执行控制者的实际冲突证据，再另开 ADR 论证。

## 3. 目标目录及逐步落地

现有八份根文档、`schema/`、`SNAPSHOT.md` 与 `docs/BASELINE_*.md` **先保留在原位**。以下仅是新增内容的目标归属，不要求提前创建空目录：

```text
AGENTS.md                     # ≤约 200 行常驻纪律和入口索引
README.md                     # 项目入口、安装、使用、测试入口
ARCHITECTURE.md / ...         # 八份现有 V1 冻结契约：迁移后仓内唯一正源
schema/                       # JSON Schema 机器契约：迁移后仓内唯一正源
SNAPSHOT.md                   # 发布内容清单：生成物，非正源
docs/
  README.md                   # 权威导航 + 文档状态说明
  development.md              # worktree、PR、变更范围与并行约束
  testing.md                  # 测试等级、隔离环境、Host pin 及证据
  architecture/              # V3 PR #9 将引入，EB 阶段不凭空实施 V3
  decisions/                 # 今后新 ADR，独立编号、不可改写历史决策
  contracts/                 # 追加的接口/行为契约；已有冻结根文件不重复制
  plans/active|archive/      # 本次以及后续有限工作包和历史计划
  postmortems/               # 经证实的故障根因
  evidence/                  # 小型索引，不存无界原始日志
dev/engineering/
  registry.yaml              # 人工维护非推导状态、Owner、证据引用
  doc-ownership.yaml         # 最具体规则优先的源码→文档所有权映射
scripts/                     # docs:probe / docs:check / docs:sync
.github/workflows/           # PR 触发的真实 CI
```

文档四类（文档头必须有 `Status`，由目录和索引解释，普通说明无需复杂状态表）：

- **Normative**：Accepted ADR、冻结契约与 Schema，提供约束；修改须通过明确的审查和兼容 Gate。
- **Proposal**：Draft ADR、未批准设计、PoC 计划；不能宣称已实施，不能覆盖 V1。
- **Operational**：测试/开发指引、当前执行计划和权威索引；随有效基线维护。
- **Historical**：完成/放弃/被替代计划和故障复盘；保存链路，不作为当前指令。

既有 `docs/BASELINE_INDEX.md`、`BASELINE_PLAN.md`、`BASELINE_PROGRESS.md`、`BASELINE_TSC_BASELINE.md`、G0–G5 与 `TOOLS_TRACEABILITY.md` 经 EB0 分类。必须记录每一现存文档的权威等级、归属者、是否仍适用及取代关系；拒绝为了“整洁”大规模改名或丢失历史证据。

## 4. 真源边界（同一事实不重复编辑）

| 问题 | 唯一主责 | 其他文档的角色 |
| --- | --- | --- |
| 类型、导出、RPC 参数的真实代码形状 | 源码/类型声明 | 契约解释承诺，说明文档链接 |
| 序列化字段与结构约束 | `schema/**` | Contract 提供语义及兼容策略 |
| 权限、状态机、不变量、冻结行为 | 根正式契约 / 经批准的新 Contract | ADR 记原因，测试追溯 |
| 决策为何接受、什么被否决 | 带状态的 ADR | 架构概览引用 |
| 具体实现是否存在/合并 | Git + 静态检测 | 注册表引用 commit / PR |
| 验证是否成立 | 对应提交与环境的执行证据 | 视图派生标识，不把报告转成事实 |
| 本阶段允许做什么 | `docs/plans/active/` 当前被批准计划 | 各执行单元只引用，不重建平行指挥面 |

禁止“代码变了就默默改规范”。规范与代码冲突输出 `SPEC_IMPLEMENTATION_GAP`，需先决定修代码还是经 ADR 调整契约；不能用文档改写掩盖行为回归。相似术语统一为 W3C 的决定仅适用于 PR #9 尚在讨论的 V3，不能静默改动 V1 API、数据库或历史。

## 5. 状态与验证证据

`dev/engineering/registry.yaml` 只记录无法从代码推导的事实，包括 Owner、ADR/PR/Contract 引用、验收证据引用和独立四轴状态（仅对关键能力/契约登记，不逐 Markdown 建表）：

| 轴 | 枚举 |
| --- | --- |
| decision_status | proposed / accepted / rejected / superseded |
| implementation_status | not_started / in_progress / implemented_in_branch / merged |
| verification_status | not_verified / verified_unit / verified_integration / verified_host |
| release_status | not_released / candidate / released |

四轴不隐含彼此。任何 `verified_*` 都要求可查到**与指定源 SHA、环境指纹、具体命令和结果绑定**的证据；`not_run`、`skipped`、`blocked` 保留独立测试结果，不提升为 verified。可派生 `current-state.json` 等视图，生成文件禁止手工编辑；只生成当前需要的最小索引，不构建快照发布事务。

证据等级：

- T0：静态和文档/Schema/类型/产物完整性；
- T1：领域单元、性质、不变量、决定性样本；
- T2：真实 SQLite/Git、事件重放、RPC/Registry、模拟 Host 缝与异常恢复；
- T3：隔离的**真实、精确 pin 的 DSH Host**，插件安装/启动/卸载、权限、UI/会话与回滚；
- T4：可追溯科研样本、来源/语义负例、科学结论审阅（按语义变更选择；**不在本轮构建 V3 业务**）。

T3 的真实 Host 不等于真实科研结论，T2 的真实 registry 不等于完整 Host E2E；T4 不等于自动“科学判真”。验证记录中显式区别真正的组件、替身和未执行段。

## 6. 文档管理/变更探针

参照 DSH 文档一致性检查与 `dsh-agent-team` 的工程基线实践，但只实现本仓库需要的最小表面：

- `pnpm docs:probe --base <sha>`：**只读**，从 Git diff（含 staged/unstaged/untracked 在合适模式下）推断变更面，报告关联 Contract/Schema/ADR、文档 Owner、缺失说明、需要执行的 Gate。未知归属输出 `DOC_IMPACT_UNOWNED` 警告；不得静默假定不受影响。
- `pnpm docs:check`：**只读、可在独立 clone 运行**，检查链接、唯一 ID、状态、引用的 commit/文件存在性、约束与当前权威一致性、生成内容新鲜度。明确异常码；至少准备故意缺链接、重复 ID、失效证据和未同步 Schema 的负对照。
- `pnpm docs:sync --write`：仅修改**显式 allowlist 的机器派生文件**，打印 diff；绝不写 `AGENTS.md`、冻结契约、ADR、计划、用户判断、人工状态和源码。CI 只用 check 模式。
- `doc-ownership.yaml`：最具体 glob 优先，权限边界/Schema/历史语义/DSH adapter/发布路径要有明确映射；初始大多数映射为 advisory，证实可靠后才对高风险面开启 blocking。

**同一套检查内核**被本地探针和 CI 调用，禁止各自维护一套不同的允许/拒绝逻辑。静态检查不能证明 Markdown 内容真实；证据、实现和审查必须分别判断。

## 7. 工作流、并行与边界

- 一工作包一 worktree、一条基线；合并分支只能由明确的 Integrator 写入。Feature Owner 可并行开发相互独立的接口/语义面；共享契约、权限和持久化格式只有一位决策 Owner。
- 同一物理文件允许并行分支编辑**仅在语义接口隔离且冲突可人工集成时**，不允许共享模块语义由多个 Owner 分头决定。最终合并提交必须重跑受影响 T2/T3，不能沿用分支局部绿灯。
- 常规修复 Local 无 ADR；Contract 变化要求契约/迁移/兼容测试；Architecture 变化要求 ADR + 有限 PoC + 阶段 Gate。安全、持久化、权限、科学语义越界按高一级处理。
- 维护隔离测试 Home/临时 git / ports，绝不使用用户稳定 DSH_HOME、已有用户 Profile、研究数据库或生产端口。日志/中间数据存仓库外或 Git ignored 的有界临时目录；预算、保留/清理条件和失败时保护政策必须显式。
- 现有 `lib/` 是随 Git 提交的预构建运行面；源码与产物的新鲜度需要机器校验，不能只靠“记得 build 后 push”。打包结果不得泄漏证据、测试世界或凭据。
- `dsh-research-control` `main` 当前依赖 `@deepseek-ai/* 0.1.2-alpha.3`；[宿主 0.2.0-rc.2 迁移 Draft PR #8](https://github.com/ArmourPiercer1/dsh-research-control/pull/8) 的 Host/UI/leak Gate 尚未完全闭合。工程基线不得借迁移自动采用新宿主或把 #8 的局部证据认作已放行。

## 8. 验收层与禁止扩张

- **快门禁（每 PR）**：docs:probe/check、tsc 防新增错误、现有 lint、build/预构建产物完整性、受影响 T1/T2。required leg 的 SKIP 不等于 PASS；GitHub CI 要观察首次真实 run 才能设置为 required。
- **集成/候选门**：独立 clean clone 完整 T1/T2、`pack:verify`、安全/持久化面 T3、必要时 T4；每个结果绑定**最终合并候选 SHA**、宿主 pin、测试数据与隔离世界。
- **TypeScript 历史债**：`docs/BASELINE_TSC_BASELINE.md` 的 21 项/40 行是历史已知失败，*不是*通过。迁移初期以受控、规范化的诊断集合 `no-new-errors` 检查回归，逐项清偿到零后才宣布 `tsc green`；不要通过删测试/放松 tsconfig 获得绿色。
- **无界研究保护**：新增问题登记为独立 backlog；EB 工作包不得延伸到 V3 模型重构、未获批准的 Host 迁移、整仓代码重新排布或“顺便”完善所有旧文档。遇到来源无法裁决、真实 Gate 失败或触及安全/科研数据写面，停工给出选择，而不是猜测继续。

## 9. 参考与实施入口

现行证据入口：`docs/BASELINE_INDEX.md`、`docs/BASELINE_PROGRESS.md`、`docs/G0_REPRODUCIBLE_TEST_ROOT.md`、`docs/TOOLS_TRACEABILITY.md`、`docs/BASELINE_TSC_BASELINE.md`；当前构建入口：`package.json`、`scripts/snapshot-release.mjs`、`scripts/pack-verify.mjs`。

对照实践：DSH 上游的文档同步/检查与 Agent 指引；`dsh-agent-team` 的 `AGENTS.md`、`dev/engineering/doc-ownership.yaml`、`scripts/docs-probe.mjs`、`scripts/docs-sync.mjs` 和 PR #361（作为设计参考，不照搬复杂状态切换）；PETSc/SciPy 的数值验证和 Astropy 的设计提案习惯。

**进入 V3 前的完整 Gate 和 PR #9/#10 依赖处理**详见 [执行计划](EXECUTION_PLAN.md)；此处没有授权直接实施 PR #9/#10。
