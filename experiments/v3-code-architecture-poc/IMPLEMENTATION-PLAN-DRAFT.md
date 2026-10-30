# V3 代码架构 — 正式实施计划（Draft）

> **状态：Draft（供外部复审者逐项审查 + 用户裁定；作者不得自升档位）**
> 撰写基线：分支 `poc/v3-code-arch-20261030`，本文写作时所见 HEAD = `72b7f65`。
> 撰写过程中**未修改本文件以外的任何文件**；文中所有"通过/全绿"类数字，凡本文撰写时未复跑的，
> 一律标注**「依据仓内记录，未独立复跑」**（清单见 §11）。
> 本文不是 `READINESS.md` 的副本：`READINESS.md` 是**前置条件与缺陷台账**（是什么还没好），
> 本文是**推进路线**（按什么顺序做、每步拿什么证据放行、什么不许并行、哪里会长出新的中心耦合）。
> 旧 `V3_IMPLEMENTATION_CONTRACT-DRAFT.md` 不替代本文。

---

## 0. 读者、用途、非目标

| 项 | 内容 |
| --- | --- |
| 读者 | 外部复审者（另一模型，逐项审：阶段依赖、模块拆解、验收门禁、并行度、新中心耦合）；用户（授权与裁决） |
| 用途 | 把"是否批准进入 V3 正式实施"变成**可逐项否决**的对象，而不是对一段叙述表态 |
| 非目标 | 不申请 IMPLEMENTATION READY；不申请 PRODUCT READY；不申请合并任何 PR；不声称本文已被审查通过 |
| 采纳关系 | 复审者 2026-10-30 给出的 G0–G4 审查基准**采纳为骨架**（§2），但每格的"必须交付/放行判据"均用本仓实测证据与可执行命令充实；凡本文写"通过"，必须附一条可跑的判据 |

**本文档自身的效力边界**：它是作者单方产物。作者在本轮实测中反复出现同一类失误（把门禁不读退出码
写成"全绿"、把清单成员写歪、编辑锚点插错语法位置），详见 `REVIEW.md` §31、§32.1。
**因此本文的任何"已达成"都不构成放行**，放行只发生在对应命令由独立方跑出退出码为 0 之后。

---

## 1. 四档状态词汇与当前实际状态

四档**不可互推**（`README.md:4-5`、`ASSESSMENT.md:4-5`）：
`ARCHITECTURALLY SOUND`（架构自洽）→ `POC VERIFIED`（机制假设经真实运行证明）→
`IMPLEMENTATION READY`（可进入实施）→ `PRODUCT READY`（可上生产）。
后一档**不得**由前一档推出；尤其 `POC VERIFIED` 与生产可用性之间隔着迁移、并发容量、故障域三整段（`README.md:67`）。

| 档位 | 当前实际状态 | 依据 |
| --- | --- | --- |
| ARCHITECTURALLY SOUND | **未单独裁定**（PoC 未主张，`README.md:4`） | — |
| POC VERIFIED | **成立但被外部收窄为 CONDITIONAL PASS**（机制可行性通过；作为实施基线 BLOCKED） | 外部裁定表 `ASSESSMENT.md` §8 |
| IMPLEMENTATION READY | **未达到**。缺：G0-R 两项 P1 候选（D-19 / G-2）、E-00 同等范围独立复验、G1 三份契约会合、用户的工程基线授权 | `ASSESSMENT.md` §10 五前置对照 |
| PRODUCT READY | **NO-GO，且与本实验区无关** | `README.md:67`；无生产装配、无迁移器、无并发容量与故障域实测 |

---

## 2. 阶段划分与放行判据

阶段编号沿用复审者的 G0–G4 基准。**G0 已部分完成，剩余部分重命名为 G0-R**（不粉饰为已完成）。

### G0-R — 机制与安全收口（当前阶段，未完成）

| 项 | 内容 |
| --- | --- |
| 进入条件 | 已满足（外部裁定 GO 编制计划 + GO 修 G0） |
| 必须交付 | ① **D-19** 修复（跨领域写授权，§4）；② **G-2** 修复（审查方门禁覆盖面，§4）；③ **E-00** 同等范围独立复验（`eventsOf` 跨能力读授权，`READINESS.md:120`）；④ 每条修复各自一条**变异验证**（§7 规则）；⑤ 回归门禁在三条流上**可稳定执行**且集合已定性；⑥ **D-19c 强制门**（领域层禁用通用 `UnitOfWork` 写）+ D-19d 变异验证——**当前不存在，是本阶段最大欠账** |
| 放行判据（可执行） | `node experiments/v3-code-architecture-poc/g0-gate.mjs` ⇒ exit 0；且 D-19 负例测试红→绿前后各贴一次输出（§4 断言形态）；且 G-2 的三条变异（skip / 删除 / 改名）各自使门禁红；且**独立席位报告**逐项写明"修复前可复现 / 修复后是否仍可复现"两个状态 |
| 出口证据落点 | `EVIDENCE.md`（逐条红条归属）+ `attacks/review/RE-REVIEW-G0-*.md`（席位报告）+ `ASSESSMENT.md` §9 复验账 |
| 未完成时禁止启动 | **禁止启动 G1 的任何 schema/DDL 落地**（写权限模型未定就先建表 = 把 D-19 复制进真库）；**禁止启动 G2 的领域侧代码**（机制面仍在动，领域侧必然返工）；**禁止把当前 PoC 称为已验收实施基线**（外部裁定 BLOCKED 维持） |

### G1 — 契约会合（三份契约的权威对账）

| 项 | 内容 |
| --- | --- |
| 进入条件 | G0-R 全部放行判据 exit 0 且经独立复验 |
| 必须交付 | ① **PR #42 语义 / PR #44 机制 / PR #47 Schema** 的**权威边界表**：每条冲突标明"谁让位、依据哪个 Q 编号或哪次裁定"；② **可信绑定**（`hostSnapshot` / `registeredEdges` resolver 的**绑定约束**，闭合 `READINESS.md:62` 的 D-9——PoC 只有形状没有绑定）；③ **描述时间 → 历史序列映射**（D-5 的 `recordedAt`/`seq` 二选一 + 改名前调用方清点，`READINESS.md:34`）；④ **V1/V3 过渡期历史正源**（同一空间内 v2/v3 事件混存时谁是权威；与 D-11 `ledger.contract_version` 版本记录方式同批定，`READINESS.md:105`）；⑤ D-12 / E-01 的存在性 oracle 裁定（§10）；⑥ 若生产形态要求硬隔离，此处一并裁定 symbol 通道是否重做（`ASSESSMENT.md` §9.1 第 1 条） |
| 放行判据（可执行） | 冲突清单中**每条**都有权威指向（Q 编号 / 裁定提交 / 用户指令原文三者之一），无"待议"残留；`CONTRACTS.md` §2–§9 冻结为实施契约并提交评审；`pnpm run docs:check` exit 0；`npx tsc -p experiments/v3-code-architecture-poc/tsconfig.json` exit 0 |
| 出口证据落点 | 新增 `docs/reviews/`（或 `experiments/**`）下一份对账表 + `CONTRACTS.md` 相应章节改写 |
| 未完成时禁止启动 | 禁止 G2 的**真实 DDL**、`capability_route` 演进、Schema 迁移器（会基于错误的时间/所有权模型固化）；禁止用真实五类对象替换 `test.*` 占位 |

### G2 — 基础实施（机制层，科研语义仍为空）

| 项 | 内容 |
| --- | --- |
| 进入条件 | G1 契约冻结完成 + 用户批准工程基线（分支/PR/train pin） |
| 必须交付 | Kernel / StoragePort(+SQL 守卫) / Capability Registry / Capability-scoped Mutation Port / 事务与提交序 / Projection + ReadContext 的**正式包内实现**（非 `experiments/**`）；`arch-independence.test.ts` 三类门禁与 `attacks/**` **迁入正式测试面并接进 CI**（`READINESS.md:40`）；Schema 迁移器 + PITR 最小闭环**先于任何读面加速**（`READINESS.md:45`） |
| 放行判据（可执行） | 根 `pnpm run check:types` / `pnpm run lint` / `pnpm run build` / `pnpm test` 各自 exit 0（根门禁，非侧车）；迁入 CI 的三条架构门各自有**变异验证**记录；Kernel 目录内科研词表扫描为空且结构门（§5 的 M-2）通过 |
| 出口证据落点 | 正式仓内 `tests/**` + `docs/engineering-baseline/` 门禁记录 |
| 未完成时禁止启动 | 禁止 G3 的科研语义实现（读面与授权模型未固化时写领域 = 双层返工） |

### G3 — 科研能力实施（五类基础对象与领域服务）

| 项 | 内容 |
| --- | --- |
| 进入条件 | G2 机制面在正式包内绿；G1 语义对账冻结；**Q12 写权限模型已由 D-19 修复落地** |
| 必须交付 | 五类基础对象（`Proposition` / `Association` / `Argumentation` / `Entity` / `Concept`，见 `tests/arch-independence.test.ts:21` 的禁用词表即这五类）的字段、状态机、领域接纳判据，全部走 PR #42 已定语义；**不得新增第六类对象或第四套认识系统**（`READINESS.md:42-43`）；`test.*` 占位 kind 与合成策略全部退役 |
| 放行判据（可执行） | 每条 PR #42 语义有对应正例 + 负例测试；"校验词表只存在于 `src/domains/validation-contract.ts`"这一止损线为真（`CONTRACTS.md` §14.1）；解除 N-2 限定的三项交付（角色名入库规范化 / 别名字面量表 / payload 形状校验）任一未做，文档**不得**写无限定的"可检测" |
| 出口证据落点 | 领域侧测试 + 契约文档改写记录 |
| 未完成时禁止启动 | 禁止 G4 集成验收 |

### G4 — 集成验收（宿主与真实运行）

| 项 | 内容 |
| --- | --- |
| 进入条件 | G3 完成 |
| 必须交付 | DSH 宿主权限面证据（`CONTRACTS.md` §10 未证明项：装配根注入 principal **≠** 宿主身份真实性，`READINESS.md:21`）；热插件加载与沙箱；并发容量与故障域实测；`pack:verify` / `test:e2e` 隔离面（`AGENTS.md` §5 README「开发」节四件套与发布门禁） |
| 放行判据（可执行） | 每项一个**可复跑证据目录**；DSH 相关运行一律 `DSH_HOME` 落在 `tests/dsh-homes/<用途>` 内（`AGENTS.md` §3，越界即视为流程违规）；e2e 走 `scripts/e2e-run.sh` 的既有隔离语义 |
| 出口证据落点 | `docs/` 下验收记录 + `tests/dsh-homes/` 证据目录名登记 |
| 未完成时禁止启动 | 不得对外声称 PRODUCT READY（本档在本计划内**始终不由作者主张**） |

---

## 3. 当前真实状态（诚实标注，不写"已完成"）

**已达成的三项技术出口条件**（`ASSESSMENT.md` §10，依据两席位实测）：
G0 范围内 P1 清零且经独立复验（D-7 / D-15 / D-16 / D-17 / G-1）；无未分类门禁失败（32 条红逐条定性）；
运行时对象表面与契约相符（构造器 / 原型 / 描述器 / 直读四路实测）。

**必须被看见的未完成项**：

| 项 | 真实状态 | 为什么不能算完 |
| --- | --- | --- |
| **D-19**（新 P1 候选） | **已提交 `7fef5a9`，但只修了一半**：新增能力作用域写端口 + 104 行新测试；通用 `UnitOfWork` 上「读 `owner_capability` 却不比对调用方能力」的形态仍在，且无门禁止领域层用它 | 违背 Q12「领域数据只能经所属领域权威接口修改」。**且已选修法尚不构成机验强制**——领域层仍有四处经通用 `UnitOfWork` 写（`test-records.ts:52-64`），且没有禁止这种调用的门（详见 §4.1） |
| **G-2**（新 P1 候选，门禁） | **修复进行中**（撰写时 `g0-gate.mjs` 有未提交改动，未见对应变异验证记录）；已提交形态下 `g0-gate.mjs:86-101` 实测：第三条流只比 `b.failures` 名称集合；`skipped` 只在第二条流用于判红） | 原本通过的审查方测试被 skip 或删除时，失败集合可以**逐字不变** ⇒ 覆盖面缩水而门禁仍 PASS |
| **E-00** | **已修，未经同等范围独立复验** | 两席位均声明不在其范围（`ASSESSMENT.md` §9 最后一行）；作者不自证 |
| G1 三份契约会合 | **未做** | 复审者的第五前置之一，且是 D-12/E-01/D-9/D-11 的裁决场所 |
| 工程基线与实施授权 | **属用户，不是作者可自决项** | 分支现状、是否以本分支开 PR、train pin |
| **文档与记录不一致（自曝）** | `READINESS.md:122-123` 的 D-16/D-17 行仍写"待独立复验"，而 `ASSESSMENT.md` §9 已记为席位 A 通过 | 台账未同步。收编时应以 `ASSESSMENT.md` §9 + 席位报告为准，**并保留"曾不一致"的痕迹**，不要静默改写 |

---

## 4. 两条开放 P1 候选（复审者 2026-10-30 提出）

### 4.1 发现 A — D-19：通用 `UnitOfWork` 可跨领域写

**当前状态（撰写过程中随作者推进刷新）**：修复**已提交 `7fef5a9`**（`CONTRACTS.md` +20 / `kernel.ts` +75 / `contracts/index.ts` +1 / 新测试 `tests/capability-scope.test.ts` 104 行；面哈希 `91f941e2 → e2ebba74`；作者自述 `g0-gate` exit=0 且 attacks 基线 32 红完全相等——**依据仓内记录，本文未独立复跑**）。修复前形态见 `72b7f65`。

（初稿曾把这一项记为「修复进行中，未提交」——**该更正痕迹保留**，以说明本文状态栏是随工作树刷新过的，
不是事后追认。新测试 `capability-scope.test.ts` 的判据形态：装配根/用例层可跨领域写、
端口改他能力对象 ⇒ `CAPABILITY_SCOPE_ESCAPE` 且目标修订未被改动、端口改自己对象照常成功。）

**作者已选形状与本文原建议不同（据实记录，不改写）**：新形状是在能力作用域端口上新增
`createOwned` / `reviseOwned` / `linkOwned`，归属不符 ⇒ `CAPABILITY_SCOPE_ESCAPE`
（`CONTRACTS.md:312` 已登记该成员，依据 Q12），并**保留**装配根/用例层经通用 `UnitOfWork` 的跨领域写
以维持 Q40。本文 §4.1 末尾的"摘掉写方法"方案**未被采纳**。

**⚠ 但按撰写时所见，这个修法还不构成 Q12 的机验强制，且仓内已有活反例**：

```
src/domains/test-records.ts:52   const oid = tx.createObject({ kind: a.kind, payload: {…} });
src/domains/test-records.ts:53   tx.linkRef({
src/domains/test-records.ts:63   const oid = tx.createObject({ kind: 'test.subject', … });
src/domains/test-records.ts:64   tx.linkRef({
```

即：**领域插件仍然通过未收口的通用 `UnitOfWork` 写**，通用写方法仍在插件可拿到的对象上。
撰写时 grep `tests/arch-independence.test.ts` 与其它测试，**未见**任何一条禁止 `src/domains/**`
调用 `tx.createObject` / `tx.revise` / `tx.linkRef` / `tx.appendLedger` 的门。
所以当前状态的准确表述是：**能力作用域端口已提供，Q12 的强制仍主要靠文档与纪律，不靠门禁**。
若就这样收口 D-19，复审者完全可以说"洞从『无机制』变成了『有机制但没人被迫用它』"。

**因此 G0-R 的 D-19 出口必须包含这条机验（缺一项即不放行）**：

| 判据 | 形态 |
| --- | --- |
| D-19a 负例 | 领域端口改/建他能力拥有的对象 ⇒ `CAPABILITY_SCOPE_ESCAPE`，且目标对象修订**未被改动**（`capability-scope.test.ts` 已含，须保留） |
| D-19b 正例 | 装配根/用例层跨领域写在**同一事务**内成功（Q40 不被修法打断）；端口改自己对象照常成功 |
| D-19c **强制门** | `src/domains/**` 出现 `tx.createObject` / `tx.revise` / `tx.linkRef` / `tx.appendLedger` 即红；白名单只允许装配根与用例层文件。**现存反例（上面四行）必须一并迁到端口**，否则该门一加上就红——那是期望信号，不是回归 |
| D-19d 变异验证 | 在某个 `src/domains/**` 文件里临时加一行 `tx.revise(...)` ⇒ 该门必须红（§7 流程规则） |

**原始事实（HEAD `72b7f65`，撰写时读源码确认）**：`src/kernel/kernel.ts` 的 `revise()`

```ts
revise(oid, a) {
  const dir = this.#raw.get<{kind; owner_capability; ns}>(`select kind, owner_capability, ns from object_directory where oid=?`, oid);
  if (!dir) throw new Refusal('NOT_FOUND_IN_SPACE', { oid });
  const ns = routeNs(this.#k.registry, dir);      // ← owner_capability 只用于「路由到哪个命名空间」
```

`owner_capability` 参与**命名空间路由**，但从未与"当前这次写发生在谁的能力之下"比对——
`UnitOfWorkImpl` 根本没有能力概念（它只持有 `#k` 与 `#raw`）。因此任何拿到通用 `UnitOfWork` 的
领域代码，都能对**其它领域**的对象 `createObject` / `revise` / `linkRef`。
对照：`NamespaceWriterImpl` **有**这道门（`NAMESPACE_ESCAPE`），`UnitOfWork` 没有——
同一件事在两个对象上不对称，这正是洞。

**修法方向（复审者建议，作者认可其为原则；本仓落地形状已改为 §4.1 顶部的端口方案）**：
**Application Use-case 可协调跨领域事务；Domain Plugin 只能经自身 Capability-scoped Mutation Port 修改权威数据**，
同时保持 Q40 的跨插件原子提交。

**作者原建议（未采纳，留作对照）**：把写方法从 `UnitOfWork` 上**摘掉**，只保留在能力绑定的
`NamespaceWriter` 上（它已有 `#cap` 与 `assertWritable`），使 `UnitOfWork` 退化为
"事务句柄 + 读 + 提交序"，谁拿到它都写不了别人的东西。
其代价是 `CONTRACTS.md` §6 的 `UnitOfWork` 封闭成员集变小、`src/domains/**` 调用点全量迁移。
**未采纳的原因（作者自述，本文转述）**：会连带打断 Q40 的跨插件原子提交路径，且改动量比端口方案大一个量级。

**能力绑定不可伪造性依赖 P2-2 的修复**（`#cap` 已是真私有，`READINESS.md:112`）——
否则端口上的能力标识可被改写，作用域检查形同虚设。

**验收断言形态（G0-R 出口门：以 §4.1 表的 D-19a~d 为准）**：

以下断言块是**原建议**下的形态，其中第 2 条（`tx.revise` 不存在）**与已选形状冲突，现在必然为红**，
保留仅为记录当时的判据设计，**不得当作现行验收标准**：

```ts
// 1) 负例：拿着 A 能力的 writer 改 B 能力对象 ⇒ 拒（已选形状下等价于 CAPABILITY_SCOPE_ESCAPE）
expect(() => writerA(tx).revise(FOREIGN_OID, { payload: {} })).toThrow(/NAMESPACE_ESCAPE/);
// 2) 【原建议专用，现行形状下为红】通用 UnitOfWork 上根本没有写方法
expect(typeof (tx as unknown as { revise?: unknown }).revise).toBe('undefined');
// 3) 正例：跨领域协调仍是一个事务（Q40 原子性不得被修法打断）—— 现行验收仍要这条
// 4) 事件面不被顺带放宽：eventsOf 的跨能力仍需装配根显式授权（E-00 不回退）—— 现行验收仍要这条
```

**代价与红灯语义（已部分兑现，据实记录）**：修 D-19 会动 `CONTRACTS.md` §6 的 `UnitOfWork` 承诺集
（撰写时工作树 `src/contracts/index.ts` 已 +1 行、`KERNEL_SURFACE.sha256` 已变更），
并把 `src/domains/**` 的通用写调用点迁到端口。**这类红灯是期望信号，不是回归**——
本轮已三度出现"测试夹具依赖被审的洞"（`EVIDENCE.md` 的 `tx.raw` / `kernel.port` / `cap` 三例，
其中 `attacks/review/rereview-g0a-escape.test.ts:215` 直接把泄露当证据钉住），
处置方式固定为：**逐条定性写入 `EVIDENCE.md` + 在干净 worktree 重生成基线，绝不放宽判据、绝不改审查方文件**。

其中**第 2 条是主判据**（它把"是否泄漏"从"扫描有没有扫到"换成"对象上根本没有"），
第 3 条防止修法把 Q40 一起改掉。

### 4.2 发现 B — G-2：审查方门禁的覆盖面可以静默缩水

**当前状态**：**修复进行中**（撰写时 `g0-gate.mjs` 有未提交改动，且未见 §7 要求的变异验证记录 ⇒ 不满足收口条件）。

**事实（撰写时实测）**：`g0-gate.mjs` 第三条流比较的是 `BASELINE.json` 的 `failures` **名称集合**。
一条原本**通过**的审查方测试被 `describe.skip`、被改名、被整文件删除，都不会进入 `failures`
⇒ 集合逐字相等 ⇒ 门禁 **PASS**，而实际覆盖面已经缩水。
（作者流的四条保护——退出码 / `success` / `skipped>0` / 通过数下限——**没有一条作用在第三条流**。）

**修法方向**：审查方门禁从"失败名集合相等"升级为**完整测试身份 + 预期状态清单**：

```jsonc
// attacks/BASELINE.json 的目标形态
{
  "generated_from_commit": "<必须仍是 HEAD 祖先，已由 P2-4 校验>",
  "tests": [
    { "id": "<file> > <fullName>", "expected": "pass" },
    { "id": "<file> > <fullName>", "expected": "fail" }
  ]
}
```

独立拒绝条件（各自一条，缺一不算修好）：
① 身份集合不等（新增 / 消失 / 改名 ⇒ added、gone 均红）；
② `expected=pass` 实际未通过 ⇒ 红；
③ `expected=fail` 实际通过 ⇒ 红（**关闭一个洞必须显式确认**，沿用现有"少一条红也拦"的设计）；
④ 出现 `skip` / `todo` / `pending` ⇒ 红；
⑤ 收集失败（`status≠0` 但红条数为 0，即 G-1 的具名成因）⇒ 红；
⑥ `generated_from_commit` 非 HEAD 祖先 ⇒ 红（已有）。

**必须同时交付的变异验证（§7 规则，本条是它的示范）**：
(a) 对一条 `expected=pass` 加 `describe.skip` ⇒ 门禁红；
(b) 临时删除一条审查方测试文件 ⇒ 门禁红；
(c) 改名一条审查方测试 ⇒ 门禁红；
三条各自贴出红色输出后，按确切路径删除临时改动。

**撰写期间的实时观测（据实记录，含对本文不利的一半）**：撰写本文件期间，作者正在改 `g0-gate.mjs` 与
`BASELINE.json`。有一个瞬时窗口里 `attacks/review/rereview-g0a-escape.test.ts`（席位 A 的 5 例攻击矩阵）
在工作树中**处于删除状态**，而我此窗口内实际执行的 `g0-gate.mjs` **返回 exit 0 且报「与基线完全一致（32 条）」**
——这正是发现 B 的机制在真实仓库里跑了一遍：**审查方测试整文件消失，覆盖面从 93 例降到 88 例，门禁毫无反应**。
该文件随后已恢复（当前工作树内存在，`ls` 可见），我没有删除或改动任何审查方文件。
同一时刻 `BASELINE.json` 已被扩展为含 `passes` 身份清单（撰写时 93 条），`g0-gate.mjs` 已新增 `passNames` 收集
——**方向与本文 §4.2 建议一致**。仍待验证两点（未落地前 G-2 不算收口）：
① `skipped` 目前仍只在第二条流判红，第三条流是否真的对 skip / 消失 / 改名各自红；
② §4.2 列的三条变异验证（skip / 删除 / 改名）是否各自贴出过红色输出。

**固有残余（不许隐藏）**：同名同位置但**断言被弱化**，按名标识看不见。
唯一缓解是所有权纪律（`attacks/README.md`：作者永不改写 `attacks/**`）+ 逐 hunk 评审。
本仓已三度实证"审查方夹具依赖被审的洞"（`EVIDENCE.md` 三例），因此③这条会**周期性红**，
必须按"已定性"逐条落 `EVIDENCE.md`，**严禁为了让集合对上而修改审查方文件**。

---

## 5. 模块拆解、依赖方向与中心耦合点

### 5.1 依赖方向（唯一允许的方向：箭头指向被依赖者）

```
DSH Adapter ──▶ Application Use-case ──▶ Capability-scoped Mutation Ports ──┐
      │                        │                                          ├──▶ Kernel ──▶ StoragePort(+SQL 守卫) ──▶ SQLite
      │                        └──▶ Projection / ReadContext ──▶ Kernel ──┘        │
      │                                                                            ├──▶ Capability Registry（含 capability_route 恢复门）
领域插件（五类对象 / 记录 / 校验 / 报告）──▶ PluginFace（能力作用域）──▶ Kernel      └──▶ internal.ts（机制内部通道，仅机制内可 import）
```

不变式：**领域插件不 import Kernel 实现**（`tests/arch-independence.test.ts` 已有门）；
**Kernel 不 import 领域**；`internal.ts` 只允许 `src/kernel/**` import（同一文件内的 import 禁令，三形态正则：`from "…"` / `import("…")` / `require("…")`）；
装配根（PoC 中为 `src/harness/world.ts`）是唯一被允许知道"谁被授予什么"的地方。

### 5.2 中心耦合点清单（每条 = 禁止事项 + 可机验检查）

| 编号 | 位置 | 会长成什么样的中心耦合 | 禁止事项 | 可机验检查 |
| --- | --- | --- | --- | --- |
| M-1 | **Kernel** | 承担科研语义判定（接纳/校验/证据分级）⇒ Kernel 变成科研大脑，每个新领域都要改它 | 禁止出现科研标识符；禁止对 `kind` / `role` 做**值判定**（字符串字面量比较、白名单、正则） | 现有词表扫描（`FORBIDDEN`，`tests/arch-independence.test.ts:19-24`）+ **新增结构门 M-2**：Kernel/contracts 中 `case 'x'`、`=== '<领域字面量>'`、`Set(['…'])` 形态一律红；白名单只允许机制自身枚举（拒绝码、AuthorityResource、内置表名） |
| M-2 | 同上（**新门，G2 交付**） | 词表扫描本身是**命名门**，对"中性词承载的领域判定"构造上不可见（`CONTRACTS.md` §14.1，F-31 开放） | 禁止用"扫描通过"当"业务无知"的证据 | 该门自身需一条变异验证；文档中每次引用绿灯必须并列 §14.1 三条限制 |
| M-3 | **`eventsOf()` 授权** | 授权判断落到领域侧（插件自己决定能不能读）⇒ 权威散落，每个插件一套私有授权逻辑 | 禁止领域侧自行判断；禁止新增授权枚举绕过既有 `capability-admin` 轴 | 断言：未授权跨能力 ⇒ `NAMESPACE_ESCAPE`（`tests/events-of-scope.test.ts` 已钉）；**新增 grep 门**：授权表（`CROSS_EVENT_READ` 形态）只允许出现在装配根文件，出现在 `src/domains/**` 即红 |
| M-4 | **ReadContext / 读面** | 读权限未在机制层强制 ⇒ 退化成"适配层约定"（复审者列为 P1） | 禁止把可见性判定交给 Adapter/领域；禁止 `raw` SELECT 出现在插件可见面对象上 | 断言插件面四路不可达（构造器 / 原型 / 描述器 / 直读），沿用席位 A 矩阵形态；`attacks/semantics/checkreport-raw-read-attack.test.ts` 保持红=越权读不再可构造（`READINESS.md:98`） |
| M-5 | **装配根** | "宿主替它取"退化为"把任意读取器交给领域"（D-9，`READINESS.md:62`） | 禁止 resolver 无绑定约束地注入；禁止装配根后门（`World.raw`）出现在生产装配 | G1 交付绑定约束；一条 grep 门：`World.raw` / `hostSnapshot` / `registeredEdges` 的装配只出现在装配根文件；PoC 只有形状，**绑定约束目前无机制保证**（N-1 同根） |
| M-6 | **StoragePort / SQL 守卫** | 守卫规则表变成"谁都能加一条"的中心 | 禁止把守卫降级为字符串包含式；禁止 DDL 文本侧漏检（本仓历史：`CREATE TABLE IF NOT EXISTS` 曾漏检） | `tests/sql-guard.test.ts` 全绿（该夹具已从"顺 `tx.raw` 取句柄"改为 `withHandle` 走 `KERNEL_PORT`，席位 A/B 均判等价） |
| M-7 | **Capability Registry / 路由** | 路由表与注册表失配 ⇒ 重启后才暴（跨命名空间路由劫持） | 禁止绕过打开期路由一致性校验 | 打开期校验 + `kernel.ts:172-177` 的 `routeNs` 不一致即 `Refusal`（提交信息 `ccc1449` 记录劫持后果为重启后读写全拒） |
| M-8 | **五类基础对象 / 领域服务** | 出现第六类对象或第四套认识系统 ⇒ 语义体系中心扩散 | 禁止新增对象类别与第四套等级体系（`READINESS.md:42-43`） | 词表门反向检查：领域侧必须**只**在 `src/domains/**` 出现科研标识符；校验词表唯一存在于 `validation-contract.ts`（`CONTRACTS.md` §14.1 止损线） |
| M-9 | **门禁脚本自身** | 门禁成为"看起来绿"的生产线（本轮 G-1/G-2 两次实测） | 禁止门禁脚本不读被调用工具的退出码；禁止无变异验证的新门禁 | §7 规则；`g0-gate.mjs` 三条流各自独立退出码 |

---

## 6. 并行度与文件隔离纪律

### 6.1 可并行 / 必须串行

| 关系 | 内容 |
| --- | --- |
| **必须串行** | G0-R → G1 → G2 → G3 → G4。特别是：**G1 的语义对账不得晚于任何真实 DDL**（否则 D-19 的写模型错误会被固化进真库与迁移器）；**Schema 迁移器 + PITR 先于任何读面加速**（`READINESS.md:45`） |
| **可并行（G1 内）** | PR #42 语义线 / PR #44 机制线 / PR #47 Schema 线可并行**取证**，但**必须单一裁决人**汇总——三条线各自"合理"正是本轮 D-19 的来源（机制上通、语义上违 Q12） |
| **可并行（G2 内）** | StoragePort/DDL 与 Projection/ReadContext 可并行，前提是 §6 的 `UnitOfWork` 成员集与读面契约已冻结；`attacks/**` 扩充与门禁脚本改造可与功能实现并行（不同文件所有权） |
| **可并行（G3 内）** | 五类对象可按族并行，但对象契约（字段/状态机）必须先冻结；报告呈现与校验规则可并行 |
| **不得并行** | 同一文件的门禁脚本与基线产物由两方同时写（本轮实测：席位在工作树上写测试会进作者的收集面；作者的提交会让席位判定对象漂移） |

### 6.2 文件隔离纪律（已写入冻结面）

实施期一律执行 `SUBAGENT_ROUTING.md`「复验/审查席位的文件隔离」一节（提交 `467414f` 经冻结变更流程纳入；
此前一次未走流程的误改与回退见 `REVIEW.md` §31）：

1. 席位在**自己的 worktree** 内工作，检出到**被复验的那个提交**（detached），不跟随分支 HEAD：
   `git worktree add .scratch/wt-<席位> <提交>` + `ln -s ../../node_modules .scratch/wt-<席位>/node_modules`
   （worktree 必须落仓内沙箱可写路径，且放 gitignored 的 `.scratch/`）；
2. **禁止**仓库级 / 目录级 `git checkout --`、`git stash`、`git restore`；临时产物按确切路径逐个撤销，只撤自己创建的；
3. **基线 / 清单类产物必须在干净 worktree 内生成**——本轮实例：`attacks/BASELINE.json` 在
   `.scratch/wt-g0base`（detached `0fba915`）与 `.scratch/wt-bl`（detached `3508d2d`）生成；
   **不得**在有并发写入的工作树上生成基线，否则把别人的中间态固化成"权威基线"；
4. 要报"修复前 / 修复后"两态时用**两棵** worktree 分别检出（席位 A 的 `fa9c2d0` / `ccc1449` 双状态即此做法）。

**边界（不可混用，`SUBAGENT_ROUTING.md` 已写明）**：worktree 治**并发写冲突**，
不治"编辑锚点只匹配文字、不匹配语法位置"那一类失误（本仓四次：删掉 30 行的拼接、半应用的版本门、
差点插进多行 import 括号的 import、把模块级 `const` 插进类体导致 `TS1248`）。
后者靠**改动后立即类型检查 + `git diff --stat` 双验**：
`npx tsc -p experiments/v3-code-architecture-poc/tsconfig.json`；`git diff --stat`。两者不可互相替代。

---

## 7. 回归门禁（`g0-gate.mjs`）：拦什么、看不见什么

**当前三条流**（每条独立退出码，聚合 FAIL 即整体非 0）：

| 流 | 拦什么 | 已知盲区 |
| --- | --- | --- |
| 1 类型门 | 侧车 `tsc` 诊断。**只覆盖 `src` 与 `tests`** | **`attacks/**` 不类型检查**（`CONTRACTS.md` §14.1）——攻击文件的类型漂移不会被捕获（实证：`Coverage` 收回三值后，攻击文件手写的四值字面量运行时仍过） |
| 2 作者测试门 | `tests/**` 0 红为硬条件；另有 G-1 加的四条保护：`status≠0` 即红（并把"红条 0 但退出码非 0"具名为**收集期崩溃**）、`success=false` 即红、`skipped>0` 即红、通过数下限 `AUTHOR_MIN_PASSED=90` | 下限是硬编码常数，测试增删需同步；不校验**身份集合**（作者流同样可被"改名/弱化断言"绕过，与 G-2 同根） |
| 3 审查方基线门 | `attacks/**` 失败集合与 `BASELINE.json` **完全相等**（多一条要定性，**少一条也拦**）；基线戳必须是 HEAD 祖先（P2-4） | **发现 B / G-2**：原本通过的测试被 skip / 删除 / 改名 ⇒ 集合不变 ⇒ PASS。另有固有残余：同名断言被弱化，按名标识看不见 |

**跨流固有限制（必须与任何绿灯并列引用）**：

- 绿灯**不证明** Kernel 业务无知（`CONTRACTS.md` §14.1；词汇扫描是命名门，三种绕过已实证，F-31 开放）；
- 红条必须**逐条定性**，"0 红"与"红条已定性"是两种不同状态，不得混说；
- 计数必须同口径，引用任何"N passed / M failed"时须并列 `EVIDENCE.md` 的五条口径限定
  （`attacks` 不类型检查 / 陈旧绿 / 审查方未提交改动 / 逃逸项豁免 / 红条须定性）；
- `World.raw` 是刻意保留的**测试装配后门**，它的存在本身就是"绿灯不能证明业务无知"的物证（`READINESS.md:93-95`）。

**流程规则（本仓自本轮起执行，见 `REVIEW.md` §32.1）**：
**新增或修改门禁脚本，必须同时交付至少一条变异验证**——人为制造它应当拦住的情形，贴出红色输出，
否则不算完成。已交付的变异验证记录：G-1 两条（import 损坏、`describe.skip`）、
D-17 构造器路径（`expected [ 'peekRaw' ] to deeply equal []`）、import 禁令（双引号违规转红）、
基线截断（少一条红即 FAIL）。

---

## 8. 冻结面变更：独立审查与收编（复审者点名）

**事实**：本分支已改冻结面。提交 `467414f` 同时含 `SUBAGENT_ROUTING.md` 与重生成的 `SNAPSHOT.md`，
提交信息带机验标记 `Frozen-Face-Review: 2026-10-30 用户（…）`；流程留痕：
`snapshot:update`=0、`docs:check`=0、`docs:probe --fail-on-blocking` **不带标记=1**（正确投
`BLOCKING×2 (FROZEN_CONTRACT_ROOT, CONTRACT_SURFACE)`）、带标记=0。
**此前一次未走流程的误改（`db18c09`）已回退（`de82ed3`），违规经过记录在 `REVIEW.md` §31**
（根因是 `docs:check 2>&1 | tail -1 && …` 把退出码换成 `tail` 的 0——门禁存在但不接退出码 = 装饰）。

**如何独立审查**（建议按三个可独立评审的收编单元拆）：

| 收编单元 | 内容 | 独立评审方式 |
| --- | --- | --- |
| U-1 冻结面变更 | `SUBAGENT_ROUTING.md` 的 worktree 隔离节 + `SNAPSHOT.md` | 单独一个 PR，body 写 `Frozen-Face-Review` 标记；只评这一节，不与实验产物混评 |
| U-2 实验产物 | `experiments/v3-code-architecture-poc/**`（含席位报告与基线） | 单独 PR；`attacks/**` 所有权纪律（作者不改写）作为评审约束 |
| U-3 门禁脚本 | `g0-gate.mjs`、`arch-independence.test.ts` 迁移进正式 CI | 与 U-2 分离，必须附变异验证记录 |

**警告（必须写进任何收编 PR 的描述）**：**实验分支整体合并会顺带改变 V1 基线**——
本分支已含一次冻结面变更（`467414f`）与一次回退（`de82ed3`），整体合并会把两者连同实验侧车一起
写进主线，冻结面哈希与清单会被一并移动。收编必须按上表拆分，**不得**用一次 merge 解决。

---

## 9. 禁止事项（对作者与所有席位，写进文档而非记在脑子里）

1. **禁止**修改 V1 冻结面（8 份根文档）与 `schema/**`——除非走冻结变更流程（改契约 → `snapshot:update`
   → 契约与清单同一提交）且**获用户批准**，并按 `docs/development.md`「冻结变更的机器门」在 PR body 写标记；
2. **禁止**启动 V3 全量实现（当前仅授权到"编制计划"，G0-R 未放行）；
3. **禁止**改动 PR #42 已裁定语义（发现冲突时**提出并指向 Q 编号**，不自行重开）；
4. **禁止**合并任何 PR（#42 / #44 / #47 一律 Draft 至今）；
5. **禁止**弱化门禁或伪造 PASS：不得跳过、降标准、从索引剔除、不得为对齐基线改审查方文件
   （`READINESS.md:59`：任何放宽视为**未通过**，而不是"通过"）；
6. **禁止**把仓内记录的 PASS 当作自己的独立测试结果（本文撰写时的复跑清单见 §11）；
7. **禁止**在 G0-R 放行前把当前 PoC 称为"已验收实施基线"（外部裁定 BLOCKED 维持）。

---

## 10. 风险与未决台账

| 编号 | 级别 | 风险 | 计划中的处置位置 |
| --- | --- | --- | --- |
| **D-12** | P2（对外查询接口前必解） | 对象 ID **可枚举/可预测**（`OBJ-<space>-<n>` 按创建序单调）+ 过滤后**计数**可差分：席位实测用截点前缀差分 `C(X)-C(X-1)` 枚举被剔除行的精确 `recorded_seq`；`usedRecordedAsOf` 在默认截点泄露 head。**这条推翻了作者旧说法**——"只给数量不给 oid"只保证"不在单次批量应答里交全集合"，不抗探测（`READINESS.md:106`） | G1 裁定 + 对外读接口设计门 |
| **E-01** | P2 | `NAMESPACE_ESCAPE` 的拒绝本身声明「该 oid 存在且属他人」，与 D-12 叠加即成**存在性 oracle**；`refuse` 与 `withhold` 需裁定。当前取舍=显式拒读（静默返空会把"没权限"读成"没有历史"，属被禁止的"缺失读成空"家族），已被 `tests/events-of-scope.test.ts` 钉住 | G1 裁定 |
| **N-1** | P2 | 装配根交**恒空**视图而库中真有 `USED_IN` 边 ⇒ 报告仍 `ACHIEVED + COMPLETE` + 零信号。作者测试 bless 的"交而空 ⇒ ACHIEVED"**有条件**（视图须完整真实），该条件**机制内不可验证、当前依赖装配纪律** | G1（与 D-9 绑定约束同批） |
| **N-2** | P2 | "可检测"主张已被收窄：检测面实为 `ref_edge.role` 精确匹配字面量 `USED_IN` + 只认已声明字段 `operating_context`；`used_in`/`Used_In`/`" USED_IN"` 漏检，`operatingContext`、嵌套 `context.operating` 连 INDETERMINATE 都不触发。**解除限定需三项交付**：角色名入库规范化 / 别名字面量表 / payload 形状校验 | G3（未交付则文档不得写无限定"可检测"） |
| **N-3** | P2 | 视图抛异常 ⇒ `run()` 直接抛、不落报告、无 INDETERMINATE 降级（方向安全但与 `CHECKER_UNAVAILABLE` 降级哲学不一致）；`as unknown as` 注入不受 domains 扫描覆盖 | G1 |
| **P2-3** | P2 | 缺"原型方法返回句柄"式**行为级可达性**门禁；构造器断言盖不到。席位 A 运行时矩阵入库后被基线流收集，属**部分缓解** | G2（新门 M-2 同批设计） |
| D-11 | P2 | `ledger` 无 `contract_version`，`eventsOf` 把 `payload_json` 原样交进插件面 ⇒ v2 实现可能静默误读 v1 载荷。席位原话：不做必须写成**显式裁定**，"不能让它以'不算漏网'的名义消失"（`READINESS.md:105`） | G1（正式建库前定版本记录方式；会连带 D-6 同款回填器债务） |
| D-13 | P3 | `timeFieldMissing` 在剔除**前**的集合上计算 ⇒ 行全被剔除时口径误导 | G2 工程债 |
| D-1 / D-2 / D-3 / D-5 / D-6 | **需用户裁决** | 空间粒度（选单库多空间 ⇒ P4 隔离证明整体作废需重证）；派生面缺口策略；记录标识形态；`recordedAt`/`seq` 二选一（PoC 一次静默改名当场打断 4 个在用调用方）；**契约版本只有写入侧与读侧判定，无 v2→v3 回填迁移器**（`READINESS.md:30-35`） | G1 前必须裁 |
| D-8 / D-9 / D-10 | 契约裁量 | 禁用能力扫描面回显 vs 抛错（已采用成形方案）；装配 resolver 绑定约束；门禁可证明范围的三条限制 | G1 |
| **D-19 / G-2** | **P1 候选（开放）** | 见 §4 | **G0-R，本阶段** |
| F-31 | 开放 | 词表扫描对"中性词承载的领域判定"构造上不可见（三种绕过已实证） | G2（结构门 M-2） |
| 合规 C1/C2/C5–C9/C11、F-27、F-EV-R3 | P2 若干 | 已在台账，非本阶段放行项 | G2/G3 |
| 容量与故障域 | 未测 | PoC 数据量个位数行级；`ref_edge` 反向查询全表扫（`READINESS.md:24`）；多进程并发**已补证**（`READINESS.md:20`）但容量与故障域未测 | G2/G4 |

---

## 11. 本文撰写时的复跑与未复跑清单（不许把仓内 PASS 当自测结果）

| 命令 | 本文撰写时的状态 |
| --- | --- |
| `npx tsc -p experiments/v3-code-architecture-poc/tsconfig.json` | 见本文交付回报（撰写会话内实际执行） |
| `node experiments/v3-code-architecture-poc/g0-gate.mjs` | 见本文交付回报（撰写会话内实际执行；若因作者并发修改而红，按红如实报告，不解释为通过） |
| 全量 `tests/**` / `attacks/**` 分项计数（95 例 / 93 通过 / 32 已知红 / 167 与 168 等历史口径） | **依据仓内记录，未独立复跑**（`EVIDENCE.md`、`REVIEW.md`、席位 A/B 报告） |
| 席位 A 的攻击矩阵 5 例、席位 B 的 16 例 | **依据仓内报告，未独立复跑** |
| V1/V2 既有能力（V1 闭环、V2 证据链、宿主 e2e） | **依据仓内记录，未独立复跑** |
| D-19 代码事实（HEAD `72b7f65` 的 `revise()` 读 `owner_capability` 却不比对调用方能力）、G-2 门禁事实（`g0-gate.mjs:86-101` 第三条流不比 skip / 身份集合）、领域层四处通用写（`test-records.ts:52-64`）、以及**工作树中正在进行的 D-19 修复形状** | **撰写时直接读源码/工作树确认**（非引用他人结论）；行号随并发修改会漂移 |

---

## 12. 作者自评：本文最可能被挑战的三处

1. **G2 早于 G3 的顺序假设**（§6.1）。本文要求"机制全绿再做科研语义"。挑战点：五类对象的字段与
   状态机（G1/G3 内容）很可能反过来暴露机制面缺项，串行会把返工推到很后面；反过来（先写领域）
   则必然出现本轮 D-19 那种"机制上通、语义上违 Q12"。折中（G1 阶段就做一轮领域侧纸面推演 +
   一条端到端薄切片）本文没有采纳，理由未充分论证——这是最脆弱的一处。
2. **D-19 的修法选择**（§4.1）："从 `UnitOfWork` 上摘掉写方法"是最小改动，但它把跨领域协调的职责
   整体推给 Application 层，可能长出**新的中心**——Use-case 层知道所有能力的写形状，
   正是 §5 反中心原则要防的东西。复审者若主张"能力作用域应下推到事务本身（事务携带能力集）"，
   本文的修法会次优，且 `CONTRACTS.md` §6 的改动量差一个量级。
3. **放行判据的可执行性仍有虚处**（§2 G1/G3/G4）。G0-R/G2 的判据是命令 + 退出码，
   但 G1 的"冲突清单每条都有权威指向"、G3 的"每条语义有正负例"目前只是**人工核对项**，
   没有机验形态（无脚本、无清单文件）。按本文自己的标准（不得写"经审查通过"这类无法机验的话），
   这两格的写法不达标，应在复审后补成可 diff 的清单文件（例如 `docs/reviews/contract-reconciliation.yaml`）。

---

## 13. 变更记录

| 时间 | 内容 |
| --- | --- |
| 本轮首版 | 依外部裁定（机制 CONDITIONAL PASS / 编制计划 GO / 作为实施基线 BLOCKED / 产品 NO-GO）编制；采纳 G0–G4 骨架；写入 D-19 与 G-2 两条开放 P1 候选及各自可机验判据；自曝三处最弱环节与一处文档-记录不一致 |
| 同一轮（第二次刷新） | 状态随作者推进刷新：D-19 已提交 `7fef5a9`（本文判定其**尚缺强制门**）、G-2 修复进行中（已见 `passes` 身份清单雏形）、新增撰写期间门禁实时观测一条；补充 §11 本文实际复跑结果：`tsc` exit 0、`g0-gate` exit 0 |

## 14. 作者复核补记（撰写席位交稿后，作者本人）

**① §4.2 那条实时观测的时间线要说全，否则会被误读成"修完仍在漏"。**
撰写席位观察到 `attacks/review/rereview-g0a-escape.test.ts` 短暂缺席而 `g0-gate` 报
「与基线完全一致（32 条）」——那是 **G-2 修复之前的门禁**（基线尚无 `passes` 字段），
缺席原因是我当时正在做的**变异验证**（把该文件临时移出以证明缩水可被察觉）。
所以它证明的是"发现 B 在本仓真实发生过一次"，而不是"修复后仍然漏"。
修复后的实测（`6d4ac39`）：同一个"移走整份审查方测试"动作 ⇒ 门禁红，并逐条列出消失的通过项；
还原 ⇒ 绿。G-2 的三条覆盖面变化（消失/新增/降级为 skip）中，**"整文件消失"已单独验证会红**
（skip 与改名在实现上与消失同路径：三者都表现为该项从 `passes` 集合中缺席）。

**② §4.1 对 D-19 的批评成立，接受为强制交付。**
端口与拒绝码已提交（`7fef5a9`），但通用 `UnitOfWork` 写面仍在，而
`src/domains/test-records.ts:52-64` 正是**活反例**：领域层直接用 `tx.createObject/linkRef`，
且没有任何门禁禁止这种用法。"机制有了但没人被迫用它"是准确指控。
D-19c（领域层出现通用写即红，白名单只给装配根与用例层）与 D-19d（该门的变异验证）
按草案要求执行，完成前 D-19 不得记为闭合。

**③ §12 自曝的三处脆弱点不改动、原样保留。**
G2→G3 串行的取舍、D-19 修法强度（是否该把作用域下推进 `UnitOfWork` 自身）、
以及 G1/G3/G4 放行判据仍是人工核对——这三条是本文最该被复审者打的地方，
作者不把它们抹平；§11 的"复跑/未复跑"清单同样保留。
