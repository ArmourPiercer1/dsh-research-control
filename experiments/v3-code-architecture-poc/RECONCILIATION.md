# Architecture Reconciliation — Q1–Q45 × PR #42 领域契约 × PR #44 代码模块

> 状态：**PoC 阶段 A/B 产物**（非正式设计登记、非 Current 代次）。所属分支
> `poc/v3-code-arch-20261030`，实验区 `experiments/v3-code-architecture-poc/`。
> 本文不改变 V1 冻结契约、不批准实施、不解锁任何 `LIVE_*`。

## 0. 实际使用的提交（本轮逐一核验，未沿用旧记录）

| 输入 | Ref | SHA | 核验方式 |
| --- | --- | --- | --- |
| `main`（工程基线） | `origin/main` | `80abe7d` | `git rev-parse` |
| PR #42 领域契约 | `origin/design/hsr-foundations-discussion-20261027` | `0369c3196cec0b217125afeba78b89933be5d4c9` | `gh pr view --json headRefOid` |
| PR #44 代码架构（本分支基） | `origin/design/v3-code-architecture-review-20261027` | `5ec38974`（本分支 HEAD = 该值） | 同上 |
| 本 PoC 分支 | `poc/v3-code-arch-20261030` | 见 `git log` | 由 #44 head 直接创建，未 upstream 跟踪（防误推） |

**两处与先前记录不符，已按实测为准**：

1. 本地 `design/v3-code-architecture-review-20261027` 停在 `05ebff4`，比 PR #44 实际 head
   `5ec38974` **落后一个提交**（该提交正是 `docs(arch): reconcile Q36–Q45 with PR #42`）。
   本轮基线取远端 head。
2. PR #44 §15 的对账自述其核对基线是 PR #42 head `ab6ffafb…`，而 #42 现为 `0369c319…`。
   因此本轮**重新逐条核验** §15 引用的规则号是否仍存在于当前 #42 head，而不是假定其有效。

规则原文由两次只读提取获得（`git ls-tree` / `git show` / `git grep`，未切分支、未写文件），
行号均为文件内行号，定义行与引用行已区分。

## 1. 核验结果：#44 引用的规则号有效性

对 #44 §15 表与正文引用的 46 个规则号逐一核验：**全部在 `0369c319` 下存在**。未出现失效引用。

同时确认下列编号**在该 ref 下不存在**（对 `docs/` 全树 66 文件做词边界 grep，已排除
`RPT-0x`/`RL1-0x` 同形误报）。任何文档若引用它们，就是引用了没有条文的编号：

**下列编号在本 ref 下不存在**（本表是**反例清单**：本仓任何文件都不得把它们当条文引用）：

| 编号（**不存在**） | 实际情况 |
| --- | --- |
| `ID-09`、`ID-10` | 身份表止于 `ID-08`（`H_S_R_DOMAIN_FOUNDATIONS_DRAFT.md:47`） |
| `RF-07`、`RF-08` | 引用族止于 `RF-06`（:124） |
| `T-06`、`T-07`、`T-08` | 时间族止于 `T-05`（:85） |
| `PR-A5`、`PR-A6` | 命题接纳族止于 `PR-A4`（`H_S_R_PROPOSITION_CONTRACT_DRAFT.md:124`） |
| `SD-01…SD-20` | 该 ref 全树无 `SD-` 命中（`SD-*` 属 PR #47 的 Schema 决策族，不在 #42） |

> 消歧说明：独立审查中有人把本表读成了引用表，故标题改为不可误读形态。复核方式：对本仓
> `src/`、`tests/`、`*.md` 做 `\b(ID-09|ID-10|RF-07|RF-08|T-06|T-07|T-08|PR-A5|PR-A6|SD-)` 引用位 grep，
> 命中仅本表自身。

另确认存在但常被漏引的两条，与本轮机制直接相关：
**`SP-09`**（:155，空间写权限与业务授权分离）、**`SP-10`**（:156，审计视图与呈现视图分离且真源唯一）。

**`SP-09` 原文要点**：空间写权与业务授权是两件事。
**本轮实测已被它纠正一次**：PoC 最初把"Capability 所有权移交"实现成蹭 `space-write` 的内部
事务，直接被自己的授权门拒绝（`NO_SPACE_WRITE`）。按 `SP-09` 改为独立授权轴
`capability-admin` 后才成立——见 §5 发现 F-02。

## 2. "检查报告不可改写"没有 RD- 条文（对账修正）

任务书把它列为 PR #42 已明确的约束，但 **#42 中承载它的不是任何 `RD-*`**：

| 正源 | 位置 | 要点 |
| --- | --- | --- |
| `RPT-01` | `H_S_R_NORMALIZATION_CONTRACT_DRAFT.md:42` | 报告**追加不可改**；重检产生**新报告**；历史 PASS 与其规则/环境/时间永久保留 |
| `C11` | `H_S_R_COMPOSITION_SEMANTICS_DRAFT.md:103` | "不得自动改写旧结论、旧 PASS 或旧使用记录" |
| `RV-03` | `H_S_R_DOMAIN_FOUNDATIONS_DRAFT.md:138` | 修订不得改写历史检查/评价/接纳 |
| `DF-06` | `H_S_R_DOMAIN_FOUNDATIONS_DRAFT.md:167` | 历史检查锚定旧修订；新规则只产生新报告 |
| `IC-S2` 不变量 | `H_S_R_INTERACTION_CONTRACT_DRAFT.md:87` | 报告不可被后续重检改写 |

`RD-09`（追加纪律）与 `RD-13`（概念修订不扰动历史检查）只是相邻纪律，**不能替代**上述正源。
本 PoC 的实现据此把 `check_report` 的 UPDATE/DELETE 在**存储层**用触发器封死
（`CHECK_REPORT_IMMUTABLE`），而不是只在应用层约定。

## 3. 十项机制的对账表

列含义：**唯一责任主体 / 权威数据位置**（谁拥有、存在哪）、**#42 锚点**（约束它的契约条文）、
**变更范围**（换领域规则或换物理插件时应改哪里）、**PoC 状态**（`tests/` 中的实证位置）。

| # | 机制 | 责任主体与权威位置 | #42 锚点 | 换领域/换插件的变更范围 | PoC 状态 |
| --- | --- | --- | --- | --- | --- |
| 1 | `ResearchSpace / SpaceContext / ReadContext` | Kernel 持有句柄与授权判定；**空间语义**归宿主 Adapter | `SP-01…SP-10`、`ID-02`、`T-05`、`RD-32` | 换宿主只改 Adapter 的 principal 注入；空间粒度不改 Kernel | P1/P4 部分（隔离在 P4） |
| 2 | `History Ledger` / `Change Journal` | Ledger=Kernel，每空间 DB 内 `ledger`（**触发器禁改删**）；Journal=Kernel，可压缩 | `ID-03`、`T-02`、`C11`、`IC-H6` | 换存储驱动只改 Storage Port 实现；登记序语义不变 | **P1 已实证**（9 例，含真实 SQLITE_BUSY 提交失败） |
| 3 | `Object Directory / ObjectRef / RevisionRef` | Kernel 持有 `object_directory`（身份路由三元组）；kind 语义归领域 | `ID-01/04/05/08`、`RD-01/05`、`RF-02/04/05` | 新增对象类别只加 manifest 的 `ownsKinds`；Kernel 零改动 | **P2 已实证**（10 例） |
| 4 | `Capability Registry / Plugin Lifecycle / Product Profile` | Kernel 注册表 + **持久** `capability_route`（启用状态与所有者归空间） | `Q44`、`SP-09` | 拆包/移交只改路由行与 manifest；ObjectID 不动 | **P2 已实证**（含重启持久性与失败事务不回写） |
| 5 | `Raw Intake / Domain Admission` | Kernel 提供登记与事务边界；**是否可接纳由领域判定** | `IC-H3`、`IC-S1`、`RPT-00`、`RF-06`、`RD-25` | 接纳政策是领域插件的规则版本，Kernel 无感 | P3 进行中 |
| 6 | `Unit-of-Work / Transaction / Storage Port` | Kernel 唯一写入口；每空间一 DB；`StoragePort` 可换驱动 | `Q40`、`C10`、`RF-02`、`ID-04` | 换驱动只改 `storage-sqlite/`；UoW 语义不变 | **P1 已实证** |
| 7 | `Validation Capability / CheckReport` | 规则与 verdict 含义归领域；Kernel 只有注册表 + 不可改写报告通道 | `RPT-00…RPT-11`、`RD-25/26/33/38` | 换校验器=新 `ruleVersion` 贡献，旧报告不动 | P3 进行中 |
| 8a | `Facet Contribution`（所有权与越权） | 每个 Facet 能力**独立拥有**自己的记录与版本；跨命名空间写被机制拒绝 | `RD-07/15/37`、`RF-05/06` | Facet 可独立装卸/迁移，基础对象无恙 | **P2 已实证**（`NAMESPACE_ESCAPE` 越权拒绝） |
| 8b | `XC-28` 单一正源 | 同一事实不得既有 payload 字段又有已注册关联边 | `XC-28`、`RD-15` | 字段与边漂移时**可被检测** | **只实证了「可写性」，未实证「可检测性」**（S-7，开放 P1）：`operating_context` 字段与 `USED_IN` 边可同事务并存、各自漂移且零提示，合成校验器无禁止规则。`NAMESPACE_ESCAPE` 守的是 #44 §6.2 核心权威复制禁止，**不是**单一正源威胁，两者不得互替 |
| 9 | `Dependency / Impact Projection` | 依赖事实归各领域；反向索引是可重建读面，**不是判定引擎** | `C06…C10`、`IC-R7`、`RD-15` | 新增依赖类型由领域登记；索引层零改动 | P4 计划 |
| 10 | `DSH Adapter Contribution` | Adapter 侧；业务插件不 import DSH | `Q2/Q4/Q29` | 换宿主只改 Adapter；领域零改动 | 不在本 PoC 面内（§7） |

## 4. Kernel 业务无知的停线（哪些契约要求它）

下列条文的强制措辞直接要求"机器不得替研究者判定科研语义"，是 `arch-independence.test.ts`
源码扫描的正当性来源（不是我自己发明的洁癖）：

`ID-06`（链不携带含义/真值）、`ID-07`（合并按永远是登记行为）、`C01`（记录新≠真）、
`C02`（局部结局不写入全局真值）、`C06/C07/C08/C09/C10`（无通用支持传递律、不合并 AND/OR、
不投票不平均、不按路径数提升支持度、环不自证）、`C11`（不改写旧 PASS）、
`C12`（空结果≠¬P）、`RD-25`（如实 UNKNOWN 仍 PASS，否则"系统性奖励虚构科研语义"）、
`RD-33`（S-L1 只查声明不判语义）、`RD-02/UN-03`（不虚构值）、`RD-29/RD-06`（判不了保留分歧不选边）。

## 5. 本轮实测产生的发现（按对架构的影响排序）

| 编号 | 级别 | 发现 | 证据 | 最小处置 |
| --- | --- | --- | --- | --- |
| F-01 | P1 | **#44 §11 的"原子移交"在纯内存注册表下不可实现**：Capability→Plugin 映射若只活在内存在，提交后崩溃即无人知道谁是所有者；"原子切换"无从谈起。 | `p2-identity-plugin.test.ts` 要求重启后路由仍是新所有者；原设计无法通过 | 新增**持久** `capability_route` 表（所有者+ns+contract+enabled），移交在事务内改写并留 `capability-transferred` 登记；激活时以持久路由覆盖内存视图。已实现并通过 |
| F-02 | P1 | **移交/装卸不能蹭 `space-write`**：与 `SP-09`（写权与业务授权分离）冲突；实测被自己的授权门拒绝。 | 4 例 P2 初始失败均为 `NO_SPACE_WRITE` | `uow(principal, fn, requires)` 允许每个业务动作声明授权轴；移交/装卸声明 `capability-admin`，新增 `AUTHORITY_REQUIRED` 码。已实现并通过 |
| F-03 | P1 | **换实现未迁移命名空间会静默返回空**：读路径按"当前能力声明的 ns"取数，与 Directory 登记的 ns 不一致时旧对象会"消失"，比报错更糟。 | `p2-drift` 用例 | Directory 在创建时**固定登记 ns**；读写共用同一条 `routeNs` 判据，漂移即 `SCHEMA_INCOMPATIBLE` fail-loud。已实现并通过 |
| F-04 | P2 | **登记序必须是事务性计数器**：若用 `AUTOINCREMENT` 之类非事务序列，回滚会留下空洞，`recorded_as_of` 截点可能指向从未提交的区间。 | `p1` 第 2 例：回滚后 `ledger_head` 仍为 0，下一次成功提交从 1 开始 | 用 `meta.ledger_seq` 行内计数器，随事务回滚。已实现并通过 |
| F-05 | P2 | **拒绝码集合本身可能是侧信道**：曾拟单列 `STAGE_INVISIBLE` 表示"目标处于未提交暂存态"，这等于告诉探测者"该 ID 正在被写入"。 | 设计期自查 | 从封闭集中删除该码；未提交身份与不存在**同一形态**（`NOT_FOUND_IN_SPACE`）。已实现 |

> F-01…F-05 是阶段 A/B 的对账发现。**F-06…F-09**（阶段 B/C 实测逼出的契约修正）登记在
> `CONTRACTS.md` §11；**F-10…F-14**（阶段 D 独立对抗审查打穿的 5 处 P1）登记在 `REVIEW.md` §2
> 并同步进 `CONTRACTS.md` §11。本表不重复，避免三处正源。

## 6. 与 PR #44 §13/§15.1 的对应

#44 §13 列出 12 条"架构可执行检验"并明确声明**均未作为程序测试执行**；§15.1 收敛为 4 处
必须先验证的边界。本 PoC 就是把这些变成可执行断言：

| §15.1 边界 | 本 PoC 的落点 | 当前状态 |
| --- | --- | --- |
| ① Ledger/领域事件/Journal 在同一 SQLite 事务内唯一真源 | `tests/p1-storage-tx.test.ts` | **POC VERIFIED**（含权威唯一性拒绝、触发器不可变、Journal 可压缩的反差锚点） |
| ② 拆包与 Facet 后仍唯一所有者、无环、无关系真源复制 | `tests/p2-identity-plugin.test.ts` | **POC VERIFIED**（移交、重启、漂移 fail-loud、`NAMESPACE_ESCAPE`） |
| ③ 未解析/不可见引用如实保存且对外不可区分 | `tests/p3-*`、`tests/p4-*` | 进行中 |
| ④ 版本化校验器 / 派生业务视图 / Impact 的水位与降级 | `tests/p3-*`、`tests/p4-*` | 进行中 |

## 7. 本 PoC 明确不做

不接 DSH、不碰 `src/**` 与 `schema/**`、不做 V1 迁移、不做热插件与沙箱、不做完整 RDF/Lean
引擎、不实现五类对象的真实字段与状态机。领域侧一律使用**标注为合成**的占位规则
（见 `src/domains/*.ts` 文件头），**不得被引用为 PR #42 科研语义政策的实现**。
