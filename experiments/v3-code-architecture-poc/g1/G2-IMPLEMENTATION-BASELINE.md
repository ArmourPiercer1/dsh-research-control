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
   `spaceId`；不得在缺显式绑定时「按默认值兜底」。缺绑定 ⇒ 显式拒绝**既有码 `CONTEXT_INCOMPLETE`**（`detail{field:"spaceId", reason:"space-unbound"}`，不新增码），
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
| **被冻结的契约版本** | **`fa3b892`**（不可变内容身份；G1 契约文本的冻结版本。`fa3b892` 之后的提交只增加授权记录与实施配置，**不改契约文本**） |
| **G2 开发起点（字面 SHA）** | **`04c773a45a9b33f8d5b88ddc041dbd0446838c9d`** —— 由 `g2/impl` 第一提交（`da9c7f9`）写死；判定式：`git rev-parse g2/impl~1` 逐字等于本值（2026-11-03 实测输出见本节末「起点验证记录」） |
| 目标分支（G2 开发分支） | `g2/impl`，**用字面 SHA 创建**：`git switch -c g2/impl <G2_START_SHA>`；**禁止** `$(git rev-parse g1/contracts-20261031)` / `origin/...` 这类浮动指针作为基线 |
| 合并去向（两级，不可混） | **① 开发**：`g2/impl` 自由推进；**② 生产收编**：`main` ← **以 `main` 为起点的选择性收编 PR**（见 §2.4），**不是** `g2/impl` 或 `#49` 的普通分支合并 |
| 正式生产码现状 | `src/**`（`host`/`client`/`shared` 等）；**无** `src/kernel/**`／`packages/kernel/**` |
| 新 Kernel 可运行实现现状 | `experiments/v3-code-architecture-poc/src/**`（**仅作证据与回归基线**） |
| 依赖 PR（Draft，按 head SHA 锁定读法） | #42 `0369c3196cec` · #47 `37de107ed529` · #44 `5ec38974fca4` · #48 `d2f19cc16f22` · #49 `5a451e6`（本分支，冻结时以 tip 为准） |

**历史修订沿革（仅备查，不是起点）**：`7b3315a`（基线）→ `71fa972`（§0bis 三项）→ `4e30c18`（R1 阻塞）→
`01db6f6`（结项报告）→ `e3e8eb5`（R2 P1）→ `36501d2`（R3 P0）→ `53f3329`（R4 收口）→ `db27ad2`（R5 收口）。
**起点判定规则（取代旧的「冻结 tip」说法）**：开发起点 = 建 `g2/impl` 时钉死的字面 SHA，必须
① ≥ `788c6ee`（含 Bootstrap 冻结面登记）——更早的 SHA 缺 `e9e4a77`（Bootstrap Gate + 错误模型对账）、
`5a451e6`（错误载体清理）、`6c2ec69`/`a2cf9c1`（授权与事件名批准记录）；
② 其**判据文本**与冻结版本 `fa3b892` **逐文件 sha256 相等**：判据文本 = `g1/G1-UNIFIED-CONTRACTS.md`、
`g1/G1-CONTRACT-*.md`、`g1/G1-ERROR-MODEL-RECONCILIATION.md`、`g1/G1-TRUSTED-PROFILE-DELTA.md`；
`g1/G2-*.md`（计划/基线/矩阵/报告）与登记类新文件允许新增或改状态行，**但不得夹带判据改写**
（判定：`git diff --stat fa3b892 <SHA> -- 'g1/G1-UNIFIED-CONTRACTS.md' 'g1/G1-CONTRACT-*.md'` 必须为空）。
建分支后**立刻**在 `g2/impl` 第一提交把实际 SHA 写入本表并附 `git rev-parse g2/impl~1` 的输出。

**起点验证记录（2026-11-03，`g2/impl` 第一提交实测）**：

```
$ git branch --show-current
g2/impl
$ git rev-parse HEAD          # 本表所在提交（g2/impl 第一提交）
da9c7f9ee7d5cb61be62f5a7ce9d7b4983458dbf
$ git rev-parse g2/impl~1     # 开发起点 = 本表所钉字面 SHA
04c773a45a9b33f8d5b88ddc041dbd0446838c9d
$ git diff --stat fa3b892 04c773a -- 'g1/G1-UNIFIED-CONTRACTS.md' 'g1/G1-CONTRACT-*.md' \
    'g1/G1-ERROR-MODEL-RECONCILIATION.md' 'g1/G1-TRUSTED-PROFILE-DELTA.md'
(空 —— 判据文本与冻结版本 fa3b892 逐文件一致；0 字节输出)
```

⇒ 起点 `04c773a` 满足判定①（≥ `788c6ee`）与判定②（判据文本 diff 为空）。注：本表所在分支的**第一提交**
即本提交，故 `~1` 指向起点本身，不存在自引用。

**收编原则（不变）**：禁止整体合并 PoC 分支（`#48`/`#49` 不整体合并）。按三类分别收编：

| 类别 | 内容 | 收编方式 |
| --- | --- | --- |
| 冻结面 | 8 根文档 + `schema/**` | 已有流程（`snapshot:update` 同提交 + `Frozen-Face-Review` 标记） |
| 实验产物 | `experiments/**`（PoC src、preflight、prex、attacks、证据报告） | **留在实验区**，作为证据与回归基线；不迁入生产包 |
| 门禁脚本 | `g1-checklist-validate.mjs`、`g0-gate.mjs`、异源对账脚本 | 随对应 PR 迁入 `scripts/**` 并由 CI 调用 |

**首批进入生产分支的文件（Bootstrap 第一提交，封闭清单）**：`src/kernel/**`（Kernel/NamespaceWriter/Registry 最小面）、
`src/storage-sqlite/sqlite-port.ts`、`src/contracts/**` 的类型与拒绝码（与生产既有 `src/contracts/**` 合流）、
`tests/kernel-bootstrap.test.ts`、`tests/p3-intake-validation.test.ts`（从 `experiments/**/tests/` 迁入，根 vitest 才收）。
**其余 `experiments/**` 一律作为证据保留在原处，不进生产分支**（含 `preflight/**`、`prex/**`、`attacks/**`——
后者到 PR-10 再迁入 `tests/**`）。

**PoC → 正式模块映射（粒度 = 机制文件，不是目录 mv）**：

| PoC 路径 | 正式目标 | 首个落地 PR |
| --- | --- | --- |
| `experiments/v3-code-architecture-poc/src/kernel/**` | **`src/kernel/**`（已定，单包；Bootstrap Gate 落点，不拆 `packages/*`）** | **PR-2 第一提交（Bootstrap）** |
| `…/src/storage-sqlite/**` | `src/storage-sqlite/**`（Port 骨架随 Bootstrap 入，完整表形/触发器在 PR-5） | PR-2 Bootstrap / PR-5 |
| `…/src/contracts/**`（类型与拒绝码） | `src/contracts/**`（生产类型面）+ 事件名单锚文件 | PR-1/PR-2 |
| `…/src/harness/world.ts` | 装配根（Adapter 侧），不进 Kernel 包 | PR-9 |
| `…/src/domains/test-*.ts` | **不迁移**（合成测试域，仅作夹具） | — |
| `…/preflight/**`、`…/prex/**` | **不迁移**（实验证据，保留原处） | — |
| `…/attacks/**` | 迁入正式 `tests/**`（PR-10 的「攻击面迁入正式测试面」项） | PR-10 |

**允许迁移的实验代码范围**：仅上表「正式目标」列非空的条目；迁移时必须**逐文件**说明来源与差异，
不得 `git mv` 整个目录后「顺手清理」。任何把 PoC 的合成域、实验夹具、证据报告带进生产包的迁移，一律拒。

### 2.4 进入 `main` 的方式：选择性收编 PR（非分支合并）

既有纪律「禁止整体合并 PoC 分支」在 Git 操作层的落地：

1. **收编 PR 的 base 是 `main`**（不是 `g2/impl`、不是 `g1/contracts-20261031`）。在该分支上**重新落文件**
   （`git checkout <g2/impl> -- <path>` 后逐文件提交，或 `git cherry-pick -x`），绝不 `git merge g2/impl`。
2. **允许进入的路径（白名单）**：`src/**`（生产机制码）、`tests/**`（正式测试）、`scripts/**`（门禁脚本）、
   `docs/**`（若该 PR 涉及）、冻结面 8 根文档 + `schema/**`（仅在走完冻结变更流程时）。**逐 PR 附文件清单**。
3. **不得进入的路径（黑名单）**：`experiments/**`、`.scratch/**`、`.poc-data/**`、`references/**`、
   `tests/deepseek-harness/**`、任何 `.env`/本地状态。实验证据留在 #49/#48 分支与 PR 历史里。
4. **合并前核对**：`git diff --stat main...<收编分支>` 必须等于该 PR 声明的文件清单；多一个文件即拒。
5. 因此 `g2/impl → g1/contracts-20261031` 只用于**开发期的依赖可见性**（可选），**不是**发布路径；
   `#49` 保持 Draft，冻结后其契约文书按 §2.4 白名单逐个收编，不做分支合并。

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
- `packages/kernel` 拆包：**已定不拆**（Bootstrap Gate 落 `src/kernel/**`）；若未来确需拆包，走独立提案，
  不作为任何 PR 的分支条件。
- CI 触发面调整涉及 `.github/**`（非冻结面，但属工程配置）：由第一个实施 PR 一并提交，附本文件 §4 引用。
