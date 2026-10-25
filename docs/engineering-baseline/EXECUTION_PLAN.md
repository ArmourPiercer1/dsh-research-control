# Engineering Baseline — 执行计划（EB0–EB3）

> **执行方案（未实施）｜2026-10-26**。结构目标：[STRUCTURE_DESIGN.md](STRUCTURE_DESIGN.md)。基础分支：`main` @ `8b910513e188db5aac08b8840756f2f25b8028d4`。
> **依赖红线：先完成工程基线、将其通过 Gate 的结果合入 `main`，再恢复 PR #9 和 PR #10 的实际开发。** 本 PR 仅包含两份计划文档，不宣称任何 Gate 已经通过。

## 一、组织、验收口径和执行顺序

```text
main 8b910513
    │
    ├─ EB0 资产/来源盘点 ── G0
    ├─ EB1 单正源迁移 ──── G1
    ├─ EB2 文档治理 ────── G2
    └─ EB3 CI/验收/V3移交 ─ G3 BASELINE_READY
                                 │
                            先 PR #9
                                 │
                            后 PR #10
```

- 本 PR 是**父级设计/执行合同**。经审查可先合入 `main`；每阶段实际实现使用独立、小范围 task PR，不把迁移、CI、产品改动塞在同一 PR。
- 所有阶段按 G0→G1→G2→G3 顺序推进。Agent 可只读并行盘点，但每个共享语义契约须有唯一决策 Owner；集成分支由唯一 Integrator 写入并进行**合并后**验收。
- 每个 Gate 只有 `PASS / BLOCKED / UNKNOWN`。记录输入、候选及最终 SHA；任何 required test `SKIPPED`、未运行 Host、部分绿色都不等于 PASS。新的无关缺陷转 backlog，而非自动扩大当前任务。
- 初始时间预算（汇总 Owner-hours）：EB0 ≤8h，EB1 ≤12h，EB2 ≤12h，EB3 ≤16h。每阶段最多 12 个有明确假设的实验；单实验 30 分钟，最多一次鉴别性复测；EB3 最多 6 次真实 Host 启/停。不因预算紧张而跳过阻塞门；超限就停止，报告实证、未知项及需批准的扩展。
- 所有日志/临时 Git/SQLite/DSH_HOME/Playwright 工件只进入受限的 ignored 或仓外目录，有清理/保留预算；禁止使用稳定 DSH 实例、生产研究数据与用户 Profile。Tracked evidence 的删除必须先作引用审计和单独裁决。
- 每个 Gate 的最小记录：plan 版本、phase、源 SHA/合并候选 SHA、环境（Node、pnpm、OS、DSH pin）、测试世界 ID、完整命令与真实 exit、passed/failed/skipped/not-run、mock/real 划分、日志路径或 CI run URL、验证者、结论和已知限制。环境被改变时失效的证据须重跑，不得照抄旧记录。

## EB0 — 冻结输入与来源/环境盘点

**允许范围**：只读盘点、独立 clone 验证、有限文档证据；不修改冻结 V1、`schema/`、`snapshot-release.mjs`、业务代码，也不清理不明数据。

### 任务与 PoC

1. 固定最新 `main` HEAD 与 repo status；逐一确认 [PR #8](https://github.com/ArmourPiercer1/dsh-research-control/pull/8)、[PR #9](https://github.com/ArmourPiercer1/dsh-research-control/pull/9)、[PR #10](https://github.com/ArmourPiercer1/dsh-research-control/pull/10) 的真实 base/head、未合并内容和引用；不要把旧记录当新基线。
2. 枚举八份根文档、仓内 `schema/**`（历史记录 23 文件，以当前实测为准）、`SNAPSHOT.md`、`docs/BASELINE_*`、G0–G5、`TOOLS_TRACEABILITY`、V2/V3 设计、运行时/测试引用和仓外正源。输出 `path → 权威性 → 状态 → Owner → 来源 → SHA-256 → 替代/引用`，避免无目的地重写历史。
3. **正源三态 PoC**：分别检验 `仓外正源与仓内逐字一致 / 不一致 / 不可访问`。特别核对现有索引记录的 SI-001 裁决书、外部 V2 设计和计划书，缺失写 UNKNOWN。哈希脚本不得把不存在的文件标记为匹配。
4. 在没有父目录 fixture 的干净独立 clone 中，按当前官方顺序实际运行 `pnpm install --frozen-lockfile`、`npx tsc -p tsconfig.json`、`pnpm run lint`、`pnpm run build`、`pnpm test`、`pnpm run pack:verify`；可选性能/真实 Host 均明确记录是否运行，test 的 build 顺序不得省略。TS 历史 21 错/40 行是**旧 SHA 的 known-failing 记录**，要记录当轮完整错误身份，不能宣称 `tsc PASS`。
5. 基础设施清单：`lib/` 提交与新鲜度、构建对父目录的隐含依赖、Git ignored scratch、现有 CI（当前 `main` 未观察到 `.github/workflows`）、已追踪日志与膨胀风险、正式 Host pin。`main` 现钉 `0.1.2-alpha.3` 相关包；宿主 `0.2.0-rc.2` 仍是单独的 Draft PR #8，不自动吸收。

### G0 决策表

| PoC 结果 | 裁决与后续 |
| --- | --- |
| 两来源内容一致且可验证 | G0 可 PASS；EB1 以**原字节**切换权威，域语义零修改 |
| 来源冲突 | G0 BLOCKED；列出文件/哈希/差异及风险，用户裁决优先版本后再继续 |
| 仓外正源不可访问 | G0 BLOCKED；仅在用户**显式认定某仓内提交的副本为新正源**时解除，不得默认采用 |
| 构建/测试不独立、未知快照破坏 | 记录具体 blocker、复现命令；设计 EB1 先失败/后通过 PoC；不可凭猜测宣称已修 |
| 文档状态、依赖、日志/宿主 pin 不清 | G0 UNKNOWN/BLOCKED，缩小问题并提出可选裁决，不进行无界探索 |

**G0 PASS 交付**：单一当前状态/来源差异清单；可靠命令与失败集；可验收的迁移输入；新旧文件全量哈希索引；下一阶段任务边界。没有 Source Ratification 不得开始 EB1 切换。

## EB1 — 仓库内唯一正式契约正源切换

**前置**：G0 PASS、外部正源采纳已裁决。**变更边界**：构建与打包流程、必要的契约元数据与引用；不修改 V1 语义、权限、DB/RPC/工具行为。

### 先做可证伪 PoC

1. 在一次性 clone 的父目录布置**有意冲突**的 `schema/` 和八根文档。旧构建的实际反应留日志；新构建必须不再从父目录读取为正源或覆盖仓库正式内容。
2. 证明仓库父目录**不存在**这些文件时 `build/test/pack:verify` 仍可运行，不允许以 `SKIP external source` 冒充构建新鲜度校验。
3. 逐文件校验新正源与 G0 批准版本的 SHA-256；人为制造损坏的 Schema、缺项 Manifest 与 stale `lib/`，验证检查不会漏报。
4. 最小消费者验证：运行时默认 `<pkg>/schema` 路径、显式 `DSH_RESEARCH_SCHEMA_ROOT` 覆盖、tarball/git-install 包内八文档、JSON Schema 结构、冻结 11 工具输出契约不被迁移改变。

### 实施

- 单独迁移 PR：保留现有 `schema/**` 与八根规范文件的路径和历史，正式使它们成为 Git 内正源；如果 G0 有经授权的来源差异，按单独可核验提交记录，不能隐含于工具改动。
- 替换 `scripts/snapshot-release.mjs` 的“清除→从父目录复制→chmod 只读”行为为**对 repo canonical 的非破坏性校验与确定性打包清单**。可保留兼容入口或改脚本名并同步脚本调用者，但不可继续存在第二条仓外写入源。`SNAPSHOT.md` 改为 Git 正源对应哈希的**生成产物**，不再记录外部根为唯一作者；防止机器绝对路径、每次 build 时间戳制造脏树。
- 更新 `schema/README.md`、根 `README.md`、`docs/BASELINE_INDEX.md`、`docs/packaging.md` 及必要旧说明；将 SI-001 标为被 AD-EB-01 在迁移合并提交取代的**历史机制**，找不到原裁决书时登记缺口，禁止伪造。
- 对 `lib/`、Schema、Manifest 及打包输出实施真实**freshness check**，并保留 git-install/pack 的已发布路径兼容。旧外部正本**只读保留，不删除、不写回**；运行时 `DSH_RESEARCH_SCHEMA_ROOT` 接口先不借机变更。
- 用单个迁移 PR 的合并提交完成**权威切换**，不长期开启双写、静默 fallback 或双可编辑正源。

### G1

**PASS**：逐文件哈希对应批准版本；父目录故意污染与空父目录 PoC 均通过；`pnpm run build`、完整相关测试、`pnpm run pack:verify`、git-install / unpack smoke、新鲜度负例、当前冻结接口/数据结构兼容；记录合并后的 SHA，外部原件安全。

**BLOCKED**：父目录仍能覆盖正源、打包丢文件、运行时兼容不成立、数据/权限语义需变化、证据不足或清单新鲜度检查无效。停工向用户报告新的迁移/契约方案。

**回退**：撤销整个迁移 PR、复跑旧版 build/test/pack；原外部只读正本保持可恢复。不得只回退清单而保留被覆盖的 Schema；已有后续变更时需先审查回退冲突。

## EB2 — 文档分层、Agent 开发纪律、变更探针

**前置**：G1 PASS。**变更边界**：文档、CI 前置脚本、必要的静态测试；不改变 V1 运行逻辑、V3 Draft 语义。

### PoC 与负对照

- 修改 `src/host/history/` → `docs:probe` 能指出事件/重放/契约和相应测试；
- 修改 `src/host/dsh-adapter/` → 必须指出 Host pin/适配与 T3 门；
- 修改 `schema/operational/` → 必须指出 Schema/Contract 影响；
- 人为放入坏链接、重复 ADR ID、虚假的 verified evidence → `docs:check` 应明确失败；
- 修改未归属的新目录 → `DOC_IMPACT_UNOWNED` 提示；`docs:sync --write` 被要求写 `AGENTS.md`、Frozen Contract、ADR、人工 Registry、业务源码时应拒绝；
- 同一个变更在本地检查和预期 CI 检查内核中应得到一致结果，不得两份相异规则。

### 实施

- 添加简洁 `AGENTS.md`（红线、唯一真源、变更分级、worktree/owner、测试隔离、文档入口），而非超长“开发手册”；补 `docs/README.md`、`development.md`、`testing.md` 和最小 ADR 约定。
- 只分类/索引现有 `BASELINE_*`、G0–G5、冻结 V1 与 V3 Proposal，不为搬迁而搬迁；标注 Current/Proposed/Historical 和 `supersedes` 关系，杜绝将 Draft #9 写成已生效契约。
- 建 `dev/engineering/registry.yaml`（非推导状态与证据）、`doc-ownership.yaml`（最具体 glob 优先）；模块未知归属可 advisory，冻结/权限/发布高风险面逐步升级为阻塞。
- 实现三个薄入口：`pnpm docs:probe --base <sha>`（read-only Git diff 影响范围）、`pnpm docs:check`（read-only 全量一致性）、`pnpm docs:sync --write`（仅白名单派生索引）；生产脚本和测试复用同一校验规则，禁止通过修改 Contract 来“自动修复”错误。
- 文档与证据校验只声称静态一致性，不能声称实证科学有效或 Host 已运行。状态 `proposed/accepted/implemented/verified/released` 各自独立，不能相互推导。

### G2

**PASS**：每个正反 PoC 有对应预期结果，生成器写边界有负控，文档检查不改 tracked 文件，独立 clone 无外部仓库前提，变更→文档映射正确且报告未覆盖范围，Owner / ADR / 受控规范唯一。

**BLOCKED**：自动修改规范、双权威、错误地将静态状态升级为验证通过、严重误判影响范围或文档系统反过来要求重构业务中心。未覆盖的普通模块允许标记 advisory，暂不全仓强拦。

## EB3 — CI、隔离 Host 验收与 V3 交接

**前置**：G2 PASS。**变更边界**：自动化门禁、测试世界和低风险清理、PR #9/#10 只读冲突盘点；本阶段不实施 V3 模型。

### PoC

1. 创建 disposable 验证 PR：故意破坏 doc/schema/tsc/artifact freshness 的至少一种必需门，观察**真实 GitHub Actions** 对 PR 产生红灯；修复后观察绿灯。没有真实运行记录不得将 Workflow YAML 当作 CI 已上线。
2. 在**全新独立 clone** 执行 `pnpm install --frozen-lockfile → tsc → lint → build → test → test:perf → pack:verify`，严格区分 old TS debt 和本次新增错误。禁止只按 error 条数相等通过；无新增错误是**债务例外**，不能显示成 tsc 全绿。
3. 使用单独 `DSH_HOME`、独立端口、固定 Host SHA / profile 的 T3 世界，测试宿主加载、11 工具注册/RPC、权限拒绝和一次 unload/restart。实测仅宣称真实执行过的表面；Registry 测试不能替代真实 Host、UI 未验证要标明。**稳定实例和生产 Profile 完全禁用**。
4. 宿主选择需明确裁决：在 `main` 当前支持的 `0.1.2-alpha.3` 相关依赖列车中找到真实可运行 Host，或先由用户批准并解决 [#8](https://github.com/ArmourPiercer1/dsh-research-control/pull/8) 的全部 0.2.0-rc.2 阻塞，再切换。**不可无意中把两个列车揉在同一测试结论里**。无法运行 Host 必须 BLOCKED/NOT_RUN。
5. 对 V3 [#9](https://github.com/ArmourPiercer1/dsh-research-control/pull/9) 与 [#10](https://github.com/ArmourPiercer1/dsh-research-control/pull/10) 做只读兼容性检查：Draft 状态、文件命名、文档权威引用、阶段 Gate、PoC 工作区隔离、历史事件与 W3C 命名映射。不在 EB3 证明 PROV/SOSA 科研语义；那属于 #10 P0–P4。

### 实施

- 建 GitHub Workflow：`pull_request(main)`、`push(main)`、手动触发；T0+必要的 T1/T2 用**与本地相同的命令**。Required 检查不得以跳过返回绿色。只有首次真实红/绿结果核对后才配置 required status。
- 临时 `no-new-TypeScript-errors` 门以**归一化诊断身份、稳定版本与可信基线**比较，而非计数相等。`docs/BASELINE_TSC_BASELINE.md` 的逐字旧证据保持历史定位；未来独立清偿到 TS 零错误后升级为正常 tsc required。不得静默屏蔽现有测试或改宽 tsconfig。
- 引入 T0–T4 风险选门：一般 PR 跑快门；Contract、权限、持久化、宿主 Adapter 变化选真实 T2/T3；V3 科研语义变更选 T4。T4 的 golden scientific cases、PROV/SOSA 测试样本由 #10 的 P0–P4 构建，EB3 只交代接口和证据纪律。
- 已有 tracked 大日志/未知文件按 Owner 清点与引用确认后，在独立清理 PR 中归档/迁移；不直接删不明资产。性能门、GUI E2E、升级兼容真实能力未执行时不能借已有历史记录宣称 Pass。
- 生成有 Git SHA、宿主 pin、测试等级覆盖、类型债务、证据链接与已知缺口的 `BASELINE_READY` 视图；来源是 Git/机器检测和人工注册事实，**不再建一个手工维护的当前真相文件**。

### G3 = BASELINE_READY

| 必须满足 | 判定 |
| --- | --- |
| G1 正源迁移 | 仓内版本唯一可编辑，构建不接受父目录隐式覆盖 |
| G2 文档纪律 | 探针、check、写白名单负控均有效 |
| 基础测试 | clean clone 可按明确顺序构建和测试，错误、skip 与历史债务诚实呈现 |
| 真实 CI | PR 有已观察的红/绿运行，required 规则实际有效 |
| Host 世界 | 有固定版本的隔离 T3，明确通过范围；被阻塞部分不能伪装为验收成功 |
| 资产与安全 | 无数据/实例/凭据泄漏、无未批准删除、无不受控大型工件 |
| 后续衔接 | #9/#10 的 base 关系及需要调整的文档/接口清单已确认 |

任何必须项不成立 → **G3 BLOCKED**；可提交子项 green 的事实，但不能解除“先基线、后 V3”阻塞。发生规范来源争议、测试世界不可建立、严重权限/数据风险或超预算时停止并请求具体裁决。

## 二、G3 PASS 后的 PR #9/#10 进入协议

1. 固定已经包含 EB0–EB3 实施成果的 `main` 完整 SHA，确认 CI、文档权威和 Host baseline ready。
2. **先处理 #9**（当前 base=`main`）：引入新文档归属/ADR 语义，仍保持 V3 为 Proposal；解决与 baseline 改动的冲突并审查。避免无授权的 force-push；必要时合并新的 `main` 到设计分支并保留 Git 历史。
3. **后处理 #10**（当前 base=`design/v3-typed-research-epistemics-20261018`，即 #9 分支，**不是 main**）：先确认 #9 的集成方式，再按真实祖先关系保留或调整 #10 base，防止重复引入 #9 的变更。不得在 EB 阶段默默移动 #9/#10 的分支、合并或将其改成 Ready。
4. #10 的 P0–P4 必须继续按原有科学和工程 PoC Gate 推进：P1 后离线历史，P2 后被动观察，P3 后人工审核建议，P4 后才讨论授权反馈。EB 的 G3 不是科研 PoC 的 P0 或发布许可。
5. 若 V3 设计需要触碰冻结 V1 Schema、权限、历史事件或写入真实科研数据，先另行 Contract/ADR、迁移和兼容性裁决，不借“基线已就绪”绕过。

## 三、Agent 每阶段交付和停工协议

**每阶段至少交付**：任务/Owner 与输入 SHA；PoC 假设和正反例结果；源文件与文档差异；真实命令、退出码和证据路径；Gate 结果；仍开放的问题及明确选项；下一阶段是否解锁。只报告必要事实，不生成无意义超长周报或二次转述。

**必须停工并等待裁决的情况**：外部正源不一致/缺失未获授权；V1 科研语义/权限/运行数据需要变更；CI/真实 Host Gate 有未闭合红灯；脚本可能清理用户文件或污染稳定 Host；证据无法绑定最终 SHA；已经达到预算却仍无法区分关键假设；方案实际要求另建复杂 Authority Snapshot 系统。

本计划允许阶段内合理修复，但**不授权无界研究、跨阶段抢跑、把 mock 当实 Host、自动把 Draft V3 当正式设计，或通过放松安全/测试/文档约束去获得“绿灯”**。
