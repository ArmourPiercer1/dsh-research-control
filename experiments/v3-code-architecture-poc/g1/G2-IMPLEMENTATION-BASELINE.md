# G2 实施基线说明（实施配置，非架构裁决）

> 2026-11-03 · 依据外部审查 P1「正式代码从哪个基线实施仍需写成可执行说明」+「ResearchSpace 宿主映射未落地」
> 性质：**实施配置**（分支/起点/模块映射/测试入口/CI 投票），**不改**五类对象、H/S/R、Space 语义与任何高位判据。
> 本文件不裁决 D-1（空间粒度）；只把「不得由实现自行推导」写成可执行约束。

## 1. ResearchSpace 与 DSH 宿主对象的映射（P1，接口与装配边界）

**结论（最保守形态）**：

1. **ResearchSpace 是独立、稳定的科研空间身份**，由 `SpaceContext.spaceId` 承载，取值文法归
   `G1-CONTRACT-IDENTITY-GRAMMAR.md` IG-1（本文件不复制文法）。
2. **绑定由 Adapter 在可信上下文中显式完成**：宿主（DSH）侧何物对应一个 ResearchSpace，是**装配配置**
   （Adapter 的 profile/配置项），**不是 Kernel 语义**，也不进任何标识字符串（D1-a）。
3. **禁止自动推导**：不得从 Project、Workstream、Workspace、会话目录、路径、仓库名或文件名推出
   `spaceId`；不得在缺显式绑定时「按默认值兜底」。缺绑定 ⇒ 显式拒绝（`SPACE_UNBOUND`），
   与「未认证 principal ⇒ 拒」同型。
4. **Q24 不变**：一 ResearchSpace = 一权威数据库（一文件 = 一事务边界）。把「一 Project 一 Space」
   写死进实现属**禁止**形态——未来独立于 Project 的 ResearchSpace 会因此被迫重改身份绑定、查询权限与迁移流程。
5. **D-1（空间粒度）仍未决**：本文件不选粒度，只规定「未显式绑定即拒绝」。粒度裁决属用户；裁决后
   只需替换 Adapter 的绑定规则，Kernel 与契约不动。

**为什么不是「一 Project 一 Space」**：Project/Workstream 是宿主的工作组织概念，可重组、可并存、可嵌套；
ResearchSpace 是**数据归属与授权的稳定身份**（决定哪个库、谁能读、历史属于谁）。两者的生命周期与
可变性不同，绑定到可变对象会让身份随重构漂移——正是 `D1-a`（`space_id` 不进标识串）要避免的同类错误。

## 2. 正式实现基线（源码收编）

| 项 | 值 |
| --- | --- |
| 目标分支 | `g1/contracts-20261031`（本 PR #49 分支） |
| **G2 起点 SHA** | **`e3e8eb5c62ef…` + 本轮 P0 修正提交 `36501d2`；实际开工 base = #49 合并后的 tip**（按字面从 `e3e8eb5` 开工会拿到修正前的 JC-1 旧序，故不单列父提交） |
| 正式生产码现状 | `src/**`（`src/host`、`src/client`、`src/shared` 等）；不含新 Kernel |
| 新 Kernel 可运行实现现状 | `experiments/v3-code-architecture-poc/src/**`（**不整体合并**） |
| 依赖 PR（均为 Draft，按 head SHA 锁定读法） | #42 `0369c3196cec`（HSR 语义基础，base main）· #47 `37de107ed529`（Schema 界面，base #42）· #44 `5ec38974fca4`（架构评审，base main）· #48 `d2f19cc16f22`（PoC，base #44）· #49 `e3e8eb5c62ef`（G1 机制契约，base #48） |

**收编原则（不变）**：禁止整体合并 PoC 分支（`#48`/`#49` 不整体合并）。按三类分别收编：

| 类别 | 内容 | 收编方式 |
| --- | --- | --- |
| 冻结面 | 8 根文档 + `schema/**` | 已有流程（`snapshot:update` 同提交 + `Frozen-Face-Review` 标记） |
| 实验产物 | `experiments/**`（PoC src、preflight、prex、attacks、证据报告） | **留在实验区**，作为证据与回归基线；不迁入生产包 |
| 门禁脚本 | `g1-checklist-validate.mjs`、`g0-gate.mjs`、异源对账脚本 | 随对应 PR 迁入 `scripts/**` 并由 CI 调用 |

**PoC → 正式模块映射（粒度 = 机制文件，不是目录 mv）**：

| PoC 路径 | 正式目标 | 首个落地 PR |
| --- | --- | --- |
| `experiments/v3-code-architecture-poc/src/kernel/**` | `packages/kernel/src/**`（#44 §建议布局；若最终不拆包则 `src/kernel/**`，由 PR-3 定） | PR-3 |
| `…/src/storage-sqlite/**` | 同上，存储适配层（Port 实现） | PR-5 |
| `…/src/contracts/**`（类型与拒绝码） | `src/contracts/**`（生产类型面）+ 事件名单锚文件 | PR-1/PR-2 |
| `…/src/harness/world.ts` | 装配根（Adapter 侧），不进 Kernel 包 | PR-9 |
| `…/src/domains/test-*.ts` | **不迁移**（合成测试域，仅作夹具） | — |
| `…/preflight/**`、`…/prex/**` | **不迁移**（实验证据，保留原处） | — |
| `…/attacks/**` | 迁入正式 `tests/**`（PR-10 的「攻击面迁入正式测试面」项） | PR-10 |

**允许迁移的实验代码范围**：仅上表「正式目标」列非空的条目；迁移时必须**逐文件**说明来源与差异，
不得 `git mv` 整个目录后「顺手清理」。任何把 PoC 的合成域、实验夹具、证据报告带进生产包的迁移，一律拒。

## 3. 每个 PR 的正式测试与 CI 入口

| PR | 正式测试面 | CI 入口 |
| --- | --- | --- |
| PR-1/PR-2 | 事件名单异源对账、`tests/p3-intake-validation.test.ts` | `scripts/**` 脚本 + `pnpm test` |
| PR-3 | `tests/arch-independence.test.ts`、报告/事件权限面 | `pnpm test` |
| PR-5 | 表形/触发器/打开期判据（真库夹具） | `pnpm test` |
| PR-6/PR-6b | `tests/vertical-slice-min.test.ts`（切片） | `pnpm test` |
| PR-7 | 挂载面三操作、`MOUNT_*` 触发器 | `pnpm test` |
| PR-9 | 幂等/接口面（JC-1 顺序 + IDEM-1/2/3 反例） | `pnpm test` |
| PR-10 | `attacks/**` 迁入后的攻击面 + 全链路 | `pnpm test`（攻击面成为投票项） |

## 4. CI 投票要求（P1，工程实施与集成风险）

现状（如实）：`.github/workflows/ci.yml` 只在 `pull_request`/`push` 到 **`main`** 时触发投票；
PoC 侧车健康检查是 `continue-on-error: true`（**advisory，非投票**）。因此**侧车 PASS 不是验收**。

要求（G2 开工前生效，写进各实施 PR 的退出门禁）：

1. **正式测试从第一个实施 PR 起进入投票路径**：新测试放 `tests/**` 并随 `pnpm test` 跑，不等到 PR-10 集中接入。
2. **不得以侧车/实验区结果当验收**：`experiments/**` 的任何 PASS 只能作为证据引用，不能作为 CI 绿的条件。
3. **结果对应可识别 SHA**：CI job 需打印或归档 head SHA（`GITHUB_SHA`），使「这次绿」绑定到具体提交；
   不允许「本地跑过」替代。
4. 若 G2 在非 `main` 分支开发，需把该分支加入 `ci.yml` 的触发面（或开一个只跑 gate 的 workflow），
   否则 PR 永远没有投票结果——这是**阻塞项**，不是优化项。

## 5. 未决与升级路径

- D-1 空间粒度：未决（本文件不选，只禁推导）。
- `packages/kernel` 是否真的拆包：由 PR-3 定；本文件只要求「映射表 + 逐文件说明」。
- CI 触发面调整涉及 `.github/**`（非冻结面，但属工程配置）：由第一个实施 PR 一并提交，附本文件 §4 引用。
