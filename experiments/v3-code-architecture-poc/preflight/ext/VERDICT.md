# VERDICT — P-EXT 独立 Kernel 扩展缝核对

> 2026-11-03 · 授权与判据：`g1/G2-DEV-PLAN.md §0bis / P-EXT`（外部审查收口，现行）
> 性质：**类甲文书核对**（不建新实验；按 §0bis「优先逐项引用现有真测试 ID，确有证据则直接关闭」）
> 产物：本文件。未建 `preflight/ext/run.mjs`——现有证据足够（§3 逐项引用）。

## 1. 裁决

**`PASS_EXTENSION_SEAM` —— 范围为「基础 Capability 机制可扩展」，不含 G2 新具名命令架构的完整验证**（见 §4）。

在实验侧加入一个新的合成领域 Capability（版本化公开 Port / 具名命令、独立校验贡献、精确引用），
**不修改** Kernel 私有实现、其他领域私有代码或装配根（DSH Adapter 的 PoC 对应物），即可完成合法装配、
同 Space 原子提交与版本化报告——现有 G0/Q44/Q45/D-19/D-20 真测试已逐项覆盖，**未发现可重现的
Kernel 机制缝缺失**，故不记 `EXTENSION_SEAM_GAP`、不新增合成插件实验、不重跑（仅在本 HEAD 上复跑所引测试核对，见 §3.5）。

## 2. 问题分解与证据映射

| # | 子问题 | 证据（逐项引用真测试 / 实现点） | 结论 |
|---|---|---|---|
| 1 | **新合成能力可合法装配**（只经清单声明，不改 Kernel / 其他领域） | `src/harness/world.ts:53`（装配根接受任意 `plugins` 清单）；`tests/capability-scope.test.ts:53-97`（第二个能力 `cap.second` 独立清单装配、跨能力写面受控）；`tests/domain-write-face.test.ts`（`SECOND` 清单装配 + 写面门禁）；`tests/arch-independence.test.ts`（Kernel 业务无知的常驻机验） | 通过 |
| 2 | **版本化公开 Port / 具名命令** | `src/domains/test-records.ts`（`FactDesignationCommandPort`，D-20 唯一签入口）；`src/domains/test-facet.ts`（`FacetStore` 窄面：`#face` 私有，不持 Kernel）；`tests/formal-event-authority.test.ts:211-218`（Port 成员封闭集：只有 `submitReport`，原型面无第二层） | 通过 |
| 3 | **独立校验贡献** | `src/domains/validation-contract.ts`（`ValidationContribution`：`validatorId`/`ruleVersion`/`schemaVersion`/`check()`，语义归领域、Kernel 只存不透明载荷）；`src/domains/test-validation.ts`（合成长验器）；`tests/formal-event-authority.test.ts:173-221`（受限提交接口 `ValidationReportSubmission`） | 通过 |
| 4 | **精确引用** | `tests/p2-identity-plugin.test.ts:78-97`（精确 RevisionRef 读回原内容、旧修订行仍在）；`:100`（换实现后 ObjectID 与旧精确引用不变，Q44） | 通过 |
| 5 | **同 Space 原子提交（跨插件）** | `tests/capability-scope.test.ts:53`（「装配根 / 用例层可跨领域写（Q40 的跨插件原子提交不能被本修法制死）」）——同一事务内跨两个能力落笔 | 通过 |
| 6 | **版本化报告** | `tests/g5a-d21-reserved-prefix.test.ts:35`（`recordReport` 报告身份 `RPT-<seq>` 与保留前缀）；`tests/contract-skew-echo.test.ts:46-100`（版本偏差行**逐行剔除**且计数可归因到版本偏差，不静默错答）；`tests/formal-event-authority.test.ts:173`（报告提交只经受限接口） | 通过 |
| 7 | **负例：非法越权 / 版本不符必被拒** | `tests/capability-scope.test.ts:60`（改他能力拥有的对象 ⇒ `CAPABILITY_SCOPE_ESCAPE`，目标修订未动）、`:74`（创建他能力的 kind ⇒ 拒绝）；`src/domains/test-facet.ts` `writeIntoForeignNamespace`（XC-28 攻击面，`tests/xc28-detectability.test.ts`）；`tests/contract-skew-echo.test.ts`（无版本偏差时计数恒 0，防虚报） | 通过 |

## 3. 结论与边界

1. **机制缝存在且可用**：新能力只需「清单声明 + 领域侧 Port/校验贡献」，Kernel 与装配根零改动；
   跨插件原子提交与版本化报告都有机制级证据。
2. **诚实边界一**：PoC 无真实 DSH Adapter（真实绑定是 PR-9 范围）。本核对证明的是**机制/装配根层**
   无需为扩展缝改动；PR-9 的真实 Adapter 装配冒烟仍须按原卡执行（该卡不在 P-EXT 结论的替代范围内）。
3. **诚实边界二**：`world.ts` 的 `CROSS_EVENT_READ` 表是装配根的**显式声明**（跨 ns 事件读的唯一合法来源，
   E-01）——新增能力若需跨读他人 ns 事件，须在装配点登记理由，属声明面而非机制改动；本核对不把
   「声明一条用途」算作「修改私有实现」。
4. **诚实边界三**：本核对为**引用型**（未新增合成插件），故不覆盖「一个全新领域从零编写 Port 全流程」
   的开发者体验成本；§0bis 允许在证据欠缺时才建 run.mjs，此处不适用。
5. **本 HEAD 复跑核对**（2026-11-03，`npx vitest run --config experiments/v3-code-architecture-poc/vitest.config.ts`
   上述 7 个文件）：**7 files / 52 tests 全绿**，与门禁基线（tests/** 0 红）一致。

## 4. 分支后果

`PASS_EXTENSION_SEAM` ⇒ 无 `EXTENSION_SEAM_GAP`，无需把修复落入 PR-2/PR-5/PR-6；P-EXT 关闭，
并入结项报告。不重开 H/S/R、不建第六类生产对象（本核对未新增任何生产对象/事件名）。

## 4. 证据范围的诚实收窄（2026-11-03 外部审查 P1 修正）

`PASS_EXTENSION_SEAM` 只支持以下三条，**不得**上推为「G2 新领域命令端口架构已可无改 Kernel 扩展」：

1. **新 Capability 可注册并合法装配**（只经清单声明，Kernel/其他领域/装配根零改动）；
2. **能力级存储归属隔离**成立（`ns` 归属 + `CAPABILITY_SCOPE_ESCAPE` 负例）；
3. **精确引用与基础跨域事务机制**可用（同事务内跨两个能力落笔，Q40）。

**未证明**：G2 正式目标要求「Application 不再以物理写入（`tx.revise()` 这类通用写面）改领域数据」，
而本文件 §2 第 5 项引用的跨能力正例**正是**用通用事务写面落笔的。因此「具名命令端口架构下的跨域扩展」
属**未验证**，不能由本 P-EXT 关闭。

**验收责任归属（不新立 PoC）**：

| 待验事项 | 归属 | 验收形态 |
|---|---|---|
| 两个不同领域的**具名命令 Port** 在同一事务内完成合法写入，且不增加 Kernel 领域特殊代码 | **PR-11**（判据面）＋ **PR-6b**（实施切片） | 装配后经两个 Port 各自写入，事务原子；Kernel diff 零领域分支；`arch-independence` 常驻绿 |
| 事务边界的物理写面收窄（Application 不再直接 `tx.revise()`） | PR-6b | 写面门禁：应用层路径只能经具名命令；越面写入必红 |
