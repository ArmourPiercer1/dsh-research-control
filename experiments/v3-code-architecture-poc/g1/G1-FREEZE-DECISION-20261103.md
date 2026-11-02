# G1 冻结决定与 G2 开工授权（2026-11-03）

> **性质**：用户授权的**登记文书**（决策记录），不是契约条文；不改变任何判据，只把「已获授权」这一事实
> 与范围写死，避免后续会话把它当成默认状态或遗忘。
> 授权者：项目所有者（用户）；登记时间：2026-11-03；来源：本轮对话中的明确指令
> 「我同意冻结 G1，并启动 G2 开发。」

## 1. 被冻结的对象（G1 机制契约集）

**冻结 SHA（契约 tip）**：`fa3b892`（本决策文书提交之前的最后一次契约修订；本决策文书本身**不计入**被冻结面）。

被冻结面 = `experiments/v3-code-architecture-poc/g1/**` 下**现行有效**的机制契约与判据文书，核心为：

| 文件 | 冻结内容 |
| --- | --- |
| `G1-UNIFIED-CONTRACTS.md` | 统一规范句（含 JC-1 八步、P1/P9、§2.10 错误码登记、§3.3/§3.4 版本轴） |
| `G1-CONTRACT-COMMIT-SEQUENCE.md` | CS：发号/提交账/事件轴 |
| `G1-CONTRACT-IDEMPOTENCY.md` | IDC：回执/判定序/IDC-12 披露判定 |
| `G1-CONTRACT-EVENT-AUTHORITY.md` | EA：事件归属、封闭名单、EA-2.4 批准流程 |
| `G1-CONTRACT-DOMAIN-COMMAND.md` / `-FACET.md` / `-RELOCATION.md` / `-IDENTITY-GRAMMAR.md` | DC/FM/RL/IG 现行判据（RL 中「重定位必需」的强制项已按 P-NS 分支条件化） |
| `G1-ERROR-MODEL-RECONCILIATION.md` | 四信号归类；封闭集净扩张 0 |
| `G1-TRUSTED-PROFILE-DELTA.md` | P-T/P-A 分层、开发批准 vs 科研采纳权 |
| `G2-DEV-PLAN.md` / `G2-IMPLEMENTATION-ENTRY.md` / `G2-IMPLEMENTATION-BASELINE.md` | 实施计划、唯一入口、实施基线（起点/映射/收编/CI） |
| `G1-RECONCILIATION-CHECKLIST.yaml` | 27 项清单（A 20/20 done、B 7 有归属） |

**不属本次冻结**：仓级冻结面（8 根根文档 + `schema/**`，仍按 AD-EB-01 的 `snapshot:update` 流程）、
`experiments/**` 的 PoC 代码与实验报告（它们是被冻结契约的**证据**，不是契约本身）、生产 `src/**`/`tests/**`。

## 2. 授权范围（G2 乙类开工）

**已授权**：

1. 建立 `g2/impl`（从冻结 tip 创建）并执行 **Bootstrap Gate**（`src/kernel/**` + `src/storage-sqlite/**` 骨架、
   `tests/kernel-bootstrap.test.ts`、`tests/helpers/kernel-harness.ts`、`tsconfig.kernel.json`、CI 触发面）。
2. 按计划推进 **PR-2 起的乙类开发**（改 `src/**`、正式 `tests/**`、`schema/**` 的 PR），各自按卡片进入/退出门禁。
3. 生产收编只走 `G2-IMPLEMENTATION-BASELINE.md §2.4` 的**选择性收编 PR**（base = `main`）。

**未授权 / 仍受限**：

| 事项 | 状态 |
| --- | --- |
| 整体合并 #48 / #49 | **仍禁止**（含普通分支合并；按 §2.4 白名单逐文件收编） |
| PR-8 / 物理重定位 / `ns-relocated` | **DEFERRED**，不在首版必经图 |
| 生产 DDL 与迁移脚本 | 随 PR-5 表形 PR，仍按冻结变更流程；本轮无预先授权越权 DDL |
| 五类对象的正式字段/状态机/科研接纳规则 | 属 **G3**，不在 G2 范围 |
| 科研采纳权（谁有权正式采纳命题） | 研究业务权限，按 `G1-REMAINING-USER-DECISIONS.md` **项 1** 另行确定；本次授权不等于已制定该政策 |
| D-1 空间粒度 | 仍未决；实现只许「显式绑定 / 缺绑定拒」，禁推导 |
| T-SEC 的 P-A 敌对加固 | 可选加固，需未来敌对部署立项 |

## 3. 冻结后的变更规则

1. 本契约集**不再是「修订轮次」的对象**：任何判据文本变更须走**冻结变更流程**——改文件 + 记录变更理由 +
   非作者复核（定向即可）+ 在同一提交或紧邻提交更新受影响 PR 卡与清单；不再以「集中修订包」形式批量重写。
2. **证据与契约分离**：实验（`preflight/**`、`prex/**`）可继续新增/重跑以产生证据，但不得据此**回溯修改**
   已冻结的判据文本；若实验否证某判据，走 §3.1 的变更流程并把「原判据 + 否证 + 新判据」三者同批记录。
3. **清单与入口同步**：`G2-IMPLEMENTATION-ENTRY.md` 的状态行、`G1-RECONCILIATION-CHECKLIST.yaml` 的
   `done` 状态、`G2-DEV-PLAN.md` 的门禁表，在冻结后只作**状态更新**，不得夹带判据改写。

## 4. 冻结时的已知未决（不阻塞冻结，但阻塞对应 PR）

| 未决项 | 阻塞谁 | 处理方式 |
| --- | --- | --- |
| 5 个待消费机制事件名的 `Approved-By`（PR-2×2：`integrity-audit-recorded`/`read-shadow-recorded`；PR-7×2：`facet-mounted`/`facet-unlinked`；PR-10×1：`raw-record-declared`） | 对应写面 PR 的**进入门禁** | 用户指派独立批准者，按 EA-2.4 逐名办理（见 §5） |
| CI 触发面（`.github/workflows/ci.yml` 只投 `main`） | Bootstrap 的投票路径 | 随 Bootstrap 第一提交同批改（非冻结面） |
| Bootstrap 本身 | PR-2 的第一步 | 已授权，执行即开始 G2 |
| D-1 粒度、科研采纳政策 | 各自业务启用点 | 不在 G2 机制面 |

## 5. 关于「独立批准者」（简要）

`Approved-By: <日期> <非作者>` 是 **EA-2.4 步骤 2** 要求的人工标记，两处同现才算数：锚文件
`EVENT-CONTRACT-LEDGER.json` 的 `approved[]` 一条 + 提交信息 trailer `Event-Name-Review:`。
批准者的**实质工作**只有一件：判断「这个机制事件名是否为『机制将新增一个可观察运行事实』所必需，
且不为领域语义私造」——批准者**不改代码、不写文书、不承担实现责任**，也不需要重新审查 G1。
批准者必须 ≠ 实现者（作者）。逐名办理，不重开架构讨论。
