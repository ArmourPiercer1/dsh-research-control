# G1 契约补正 · 专题③ — 领域命令权威：Application 不得绕过对象拥有者的领域规则

> 状态：**Draft（本席位产出，待并入 `G1-UNIFIED-CONTRACTS.md` / `CONTRACTS.md` §16 评审）**
> 席位：G1 补正专题③（远程审查点名的「归属校验被当成领域校验」缺口）。分支 `g1/contracts-20261031`。
> 纪律：本文只新建本文件与同目录 `G1-CONTRACT-DOMAIN-COMMAND.fixtures.mjs`；**不改** `g1/` 既有文件、
> 清单/校验器、`g0-gate.mjs`、`src/**`、`tests/**`、`attacks/**`、`CONTRACTS.md`、`READINESS.md`、
> `IMPLEMENTATION-PLAN-DRAFT.md`、`docs/**`、冻结面。全部 TS/表形状是**契约形状**（「先契约后机制」的
> 「先」，§16/D-20/FM/RL 先例），物理 DDL 与落码归 G2 实施批（裁决表 D5-b）。他席文件的改动一律
> **只登记责任 PR**（§7），本席不动手。
> 夹具：「node experiments/v3-code-architecture-poc/g1/G1-CONTRACT-DOMAIN-COMMAND.fixtures.mjs
> 退出码 0 = 契约自洽（机器可读块与判据逐等 + 结构/行为双判据全命中 + 五条「架空判据」行为变异
> MUT-DC-1..5 全部被捕获 + 五条「削弱正文」静态变异 W1..W5 全部被捕获 + 拒绝码封闭集零扩张经真读
> `src/contracts/index.ts` 核验）；1 = 有任一项 FAIL；2 = 夹具无法运行。」
> 平面声明（EA §0.1 / FM §0.1 同型）：本文只裁 **V3 机制侧车（本 PoC）** 的写权威分层。V1 冻结面
> （根文档 + `schema/**`）不触碰；#47 层对「Application 写面 / 领域命令入口」零条文覆盖（沿
> `G1-RECON-PR47.md` 全库检索实测），故对 #47 **不写「属 #47 决策面」**（裁决表 D5-a「此后禁止」句）。

---

## 0. 问题陈述（一句话）

`writerOwningKind(kind, tx)` 能证明**存储归属**正确（写者能力 == 注册表判定的 kind 拥有者），但**不能证明对象拥有者的业务规则已被执行**——当前条文允许 Application 拿 `NamespaceWriter` 直写，等于把「归属校验通过」当成「领域校验通过」，正是 D-19 的核心教训复发。

### 0.1 本席真库实测（洞存在，非推测定级）

探针（`.scratch`，可弃、不入仓；SQLite 真实空间，`node:sqlite`）：
「node --experimental-transform-types experiments/v3-code-architecture-poc/.scratch/g1-cmd/probe-d19-hole.mts ⇒ **exit 0**（0 = 洞存在）」

关键输出（逐字，2026-11-01 复跑）：

```
领域规则判定（对象拥有者侧的接纳判据）: {"refused":"synth:not-admissible"}
经 IntakeUseCase.tryAdmit（会先问领域策略）: {"refused":"synth:not-admissible"}
取得的端口 ns = dom_test_om （= 对象模型能力自己的 ns，归属完全合法）
旁门直写结果 oid = OBJ-SP-PROBE-1
提交后库里的对象 = {"oid":"OBJ-SP-PROBE-1","kind":"test.claim","revision":1,"payload":{"text":"残缺不堪的陈述","fromRecord":"R-1"},"recordedSeq":1}
object_directory 中 test.claim 行数 = 1
该对象的归属 = {"owner_capability":"cap.test.object-model","ns":"dom_test_om"} （归属核对全绿，没有任何一条既有判据报警）

结论：领域规则说「不可接纳」，机制说「归属正确，收下了」⇒ 洞存在。
```

> 探针可弃（`.scratch` 不入仓，历史上已被清过一次）。**等价常驻形态**是夹具里的 `legacyContrast()`
> （模型形的同一旁门，`run_T_N1_legacy` 对照项，必须放行才算负例非平凡）；两者一真库一模型，互为佐证，
> 任一失效都不影响另一条证据链。

三条事实，逐条对应本契约的一条判据：

1. 同一条载荷，**对象拥有者自己的规则拒**（`synth:not-admissible`），**经合法 `NamespaceWriter` 直写成功并原子落库** ⇒ 归属判据与领域判据是两根独立的轴，前者不能代替后者（→ DC-8 行为判据 B1a/B1b）。
2. 直写走的是**当前契约允许的**那条路（P4/§1.1 权限矩阵 Application 行），不是绕过机制——**洞在条文里，不只在代码里**（→ §7 回填义务）。
3. 拥有者侧今天**根本没有可跑的规则**：`src/domains/test-object-model.ts` 只有 `ownsKinds` 清单，零规则；接纳判据住在**另一个能力**（`src/domains/test-records.ts` 的 `IntakePolicy`）。因此「只把直写改道成命令 Port」而不要求拥有者**实现**前置点，等于把空壳换个名字（→ DC-4 第 ④ 步必须非空 + DC-13 迁移前置项）。

---

## 1. 裁定总表（条文 DC-1 … DC-13；每条给判据锚）

| 条文 | 裁定 | 机验锚 |
| --- | --- | --- |
| DC-1 | 正式调用链改为「**Application → Owner Domain Command Port → Capability-scoped Storage Port → Kernel**」；四段之间不得跨段 | §2 链式表；夹具 D4 |
| DC-2 | Application 面**不再取得他人领域的 `NamespaceWriter`**；`UseCaseDelegation.writerOwningKind/writerOf` 自 G2 起从 Application 可见面退役 | 结构判据 S1（可达性）；夹具 T-S1 |
| DC-3 | 协调权 ≠ 写权：Application 保留**同一条事务内的排序权、事务句柄、多拥有者编排**；不保留任何物理写方法 | §3 保留清单（逐条）；夹具 T-P4 |
| DC-4 | `DomainCommandPort` 的**前置条件按序执行**（①–⑦，含 ④ 领域前置点），全部先于任何写、零残留 | DC-6 序表；夹具 T-N1/T-N2/T-P1 |
| DC-5 | **禁通用反射分发口**：命令入口只有**具名方法**，一个业务动作一个方法；`run(name, payload)` 形态本身判违例 | 结构判据 S3；夹具 T-N6 |
| DC-6 | 命令 Port 实现内部**只许消费**：自己的 `createOwned/reviseOwned`、自己的 `linkOwned`、自己的 `appendAuthoritativeEvent`、挂载内 `writeFacetRecord`；四禁原样承接（D4-d/X-7） | §4.4；夹具 T-N4 |
| DC-7 | 见证来源**唯一** = EA 的 `AuthorizationContext`（机制在命令入口内单点签发，`CommandReceipt.witnessSeq` 是其登记序）；命令入参字段集封闭，**无字段可携带见证** | EA-4.2/4.3/4.5；夹具 T-N5 |
| DC-8 | 机验判据 = **结构（可达性 S1 + 静态集合等值 S2 + 入参封闭 S3）+ 行为（B1a/B1b 双轴独立 + B2 原子正例 + B3 容错不误伤）**；「归属校验无法替代」由**双轴各自可反**定义 | §5 全节；夹具 T-S*/T-N*/T-P* |
| DC-9 | **拒绝码封闭集零扩张**：机制判定复用现有 `RefusalCode`，领域判定用既有强制前缀的 `DomainRefusalCode` | 夹具 D2（真读 `src/contracts/index.ts`） |
| DC-10 | **Q40 不破**：跨领域编排仍在**调用方交来的那一条事务**内成功；命令 Port 不自开事务、不得「先提交再校验」 | 夹具 T-P2/T-P3（第二腿失败 ⇒ 两笔同滚） |
| DC-11 | **Q37 容错不被误伤**：Raw Intake 的「收」不经领域前置点判定；「拒写 ≠ 拒收」一字不改 | 夹具 T-P5/T-N7 + MUT-DC-4 |
| DC-12 | 拥有者侧命令入口**必须真的有前置点**（非空壳）：装配期要求登记 `preconditionCount ≥ 1` 或在清单里显式声明 `statelessKind`（该 kind 无领域前置，须人工签字） | 夹具 T-N8；§7 迁移前置项 |
| DC-13 | 判据强度次序沿用 §16：**运行时可达性/作用域是墙，源码扫描是网**；本契约的新增判据以**可达性**为主判据，词法扫描只作防遗忘 | §5.1；夹具 T-S2（负空间：网扫不到的形态由墙拦） |

---

## 2. DC-1 新调用链（一句话版 + 链式表）

**一句话**：`Application → Owner Domain Command Port → Capability-scoped Storage Port → Kernel`
—— 跨归属落笔必须经**对象拥有者自己导出的具名命令入口**，该入口内部再消费拥有者**自己的**作用域存储端口；Application 全程不持有他人领域的物理写方法。

| 段 | 持有者 | 能做什么 | 绝不能做 |
| --- | --- | --- | --- |
| Application | 用例类（`src/app/**`） | 取调用方交来的那**一条**事务；按序调用 1..n 个拥有者的命令 Port；决定提交/回滚 | 取得他人领域 `NamespaceWriter`；持有 `createObject/revise/linkRef/createOwned/reviseOwned/linkOwned/appendLedger/declareRecord/appendAuthoritativeEvent/recordReport/write` 中任一（名单见机器块 `[DC-BANNED-WRITE-METHODS]`）；自开事务 |
| Owner Domain Command Port | 对象拥有者能力（`src/domains/<owner>/**`） | 执行 DC-6 的 ①–⑦；把领域判定结果落成自己拥有的对象/事件 | 取通用 `UnitOfWork`/raw SQL/重取 face（四禁，DC-6 段末）；把入参原样转手成 `createOwned(payload)` 而不执行任何前置（DC-12） |
| Capability-scoped Storage Port | `NamespaceWriter`（`face.writerFor(tx)`） | 机制归属核对 + 物理写（科研语义零判定，P4 原句） | 被**非拥有者**持有（归属不符 ⇒ `CAPABILITY_SCOPE_ESCAPE`，既有墙不动） |
| Kernel | 机制 | Directory/Ledger/发号/归属账/见证签发/提交期判据 | 判科研语义（#44 §5「不由 Kernel 执行」列，一字不改） |

**为什么不在 Storage Port 里加语义判据**（本契约的关键取舍，写死防日后翻案）：「持有合法 writer 也不得创建成功」这条**只能在结构层实现**。若把「载荷是否违反领域规则」塞进 `NamespaceWriter.createOwned`，则 Kernel 必须理解科研语义 ⇒ 直接违反 #44 §5 表（「领域对象私有规则」明列**不由 Kernel 执行**）与 §16 首表「判据只用机制事实……Kernel 内不含科研语义判定」。故本契约的行为判据不是「存储层能拦住违规载荷」，而是「**违规载荷到不了存储层**——Application 面上没有通往存储层的他人领域写方法」。

---

## 3. DC-2/DC-3 Application 面的退役与保留（逐条）

### 3.1 退役项（G2 起不得再出现在 Application 可见面）

| 退役成员 | 今天在哪 | 退役后由谁承担 |
| --- | --- | --- |
| `UseCaseDelegation.writerOwningKind(kind, tx): NamespaceWriter` | `src/app/delegation.ts:48`、`src/harness/world.ts:99,108` | 装配根按 DC-6 装配期把**拥有者导出的命令 Port**注入用例；`ownerOfKind` 查询留在装配期（运行时不查归属交给用例） |
| `UseCaseDelegation.writerOf(capability, tx): NamespaceWriter` | `src/app/delegation.ts:50`、`world.ts:91,109` | 同上；「指定能力」这一入口本就是越权的直接形态（P4 四禁同族） |
| `tx.appendLedger(...)`（带 `D-19c-ALLOWED` 行标记 + 计数双判据） | `src/app/intake-use-case.ts:53` | 记录域 `RawIntakeCommandPort.declare(tx, …)`（唯一入口，内部 = 拥有者自己的 `appendAuthoritativeEvent`）；**`D-19c-ALLOWED` 标记制随之退役**（PR-2 把 `synth:raw-intake` 登记为正式事件类型后，通用通道本就 `EVENT_AUTHORITY_REQUIRED`） |
| 「用例可写 kind == 该领域自有端口」这句论证 | `src/app/delegation.ts` 头表 | 换成更强的句子：「用例**不写**任何 kind；它只把命令交给拥有者」 |

「标记 + 出现次数 == 签字次数」这套双判据的**退役本身要留痕**：它当初是为了给一份「要逐条签字的清单」兜底；本契约把清单清零 ⇒ `src/app/**` 的允许写面从「委派端口 + 带标记台账」收缩为**空集**。§16 与 `src/app/delegation.ts` 头表回填见 §7（不静默删纪律，按 §16「收紧方向的重锚，逐条点名」纪律）。

### 3.2 保留项（逐条，一条不动就写「不动」）

1. **同一条事务的句柄传递**：用例仍收调用方交来的 `tx`（`UnitOfWork` 只作**坐标**，不作写面）；命令 Port 的每个方法签名都带它（`createClaim(tx, cmd)`）。
2. **排序权**：多条命令的先后由用例决定；机制不规定领域动作顺序。
3. **多拥有者编排**：一条事务内调用 n 个不同拥有者的命令 Port ⇒ 仍是一次原子提交（DC-10 / Q40）。
4. **回滚决定权**：用例抛错即全滚；用例也可捕获命令 Port 的领域拒绝并选择「只拒不抛」（Q37 形态，DC-11）。
5. **不自开事务**：既有条文与既有测试（`tests/use-case-write-path.test.ts` ⑤「用例不持有事务入口」）**不动**，且本契约把该测试的成员名单扩到 DC-BANNED 全名单（§7）。
6. **读面**：Application 无独立特权读面（§1.1 表既有句，不动）。
7. **拥有者自己的写路径**：领域插件经 `face.writerFor(tx)` 写自己拥有的 kind——**一字不改**（§16 首表第一行）。命令 Port 的实现正是这个自有端口的**唯一合法消费者**（DC-6）；这不是新增权限，而是把「领域自己写自己」和「替别人写」两件事在代码结构上分开。

---

## 4. DC-4 … DC-7 `DomainCommandPort` 正式签名（契约形状 TS；落码归实施批）

### 4.1 装配期登记（清单扩形，与 `ownsKinds` / `ownsEventTypes` 同族）

「<!-- DC-REGISTRATION-BEGIN -->
export type DomainCommandName = `${string}:${string}`;   // `<拥有者本地前缀>:<动词>`，
                                                         // 与 DomainRefusalCode 同族：强制含冒号
export interface DomainCommandRegistration {
  readonly command: DomainCommandName;
  readonly capability: CapabilityId;                     // 拥有者（装配期核对 = ownerOfKind）
  readonly affectsKinds: readonly ObjectKindLabel[];     // 必须是本能力 ownsKinds 的子集
  readonly requires?: AuthorityResource;                 // 业务授权轴（机制不透明；缺省 = 无业务轴）
  readonly inputFields: readonly string[];               // 入参字段封闭白名单（DC-7，运行时按此核）
  readonly preconditionCount: number;                    // DC-12：≥1，或走 statelessKind 显式签字
}
// 装配期判据序（与 ownsEventTypes 同族，按序判定，零装配副作用）：
//   ① command 被两个能力登记 ⇒ AMBIGUOUS_AUTHORITY
//   ② capability 未激活 ⇒ CAPABILITY_INACTIVE
//   ③ affectsKinds ⊄ 该能力 ownsKinds ⇒ ACTIVATION_IMPOSSIBLE（名册错配 = 装配红）
//   ④ requires ∈ MECHANISM_RESOURCES ⇒ ACTIVATION_IMPOSSIBLE（D-26 轴值判据原样复用）
//   ⑤ preconditionCount < 1 且未声明 statelessKind ⇒ ACTIVATION_IMPOSSIBLE（DC-12）
<!-- DC-REGISTRATION-END -->」

`statelessKind` 的显式声明是 DC-12 的**人工签字面**：确实没有领域前置的 kind（PoC 里的合成承载体
`test.subject` 就是）必须逐个点名并写理由，而不是让「零前置」成为默认。它不是豁免通道——装配红逼它进
评审面（EA-2.4「名册缺项 = 装配红」同族）。

### 4.2 Port 形状（Application 可见的唯一形态：具名方法）

「<!-- DC-PORT-BEGIN -->
/** 拥有者导出、装配根注入。**一个业务动作一个方法**（DC-5：禁通用 run(name, payload)）。 */
export interface ObjectModelCommandPort {
  createClaim(tx: UnitOfWork, cmd: CreateClaimCommand): CommandReceipt;
  objectifyCarrier(tx: UnitOfWork, cmd: ObjectifyCarrierCommand): CommandReceipt;
}
export interface RawIntakeCommandPort {
  declare(tx: UnitOfWork, cmd: DeclareRawIntakeCommand): CommandReceipt;   // Q37 容错通道，DC-11
}

export interface CreateClaimCommand {
  readonly command: 'test.object-model:createClaim';   // 判别式字面量；不在名册 ⇒ 运行期红
  readonly recordId: string;                           // 领域必填（缺 ⇒ DomainRefusalCode）
  readonly text: string;                               // 领域判其可否接纳；机制零解释
}
export interface ObjectifyCarrierCommand {
  readonly command: 'test.object-model:objectifyCarrier';
  readonly recordId: string;
}
export interface DeclareRawIntakeCommand {
  readonly command: 'test.records:declareRawIntake';
  readonly recordId: string;
  readonly text: string;
  readonly sourceRef: string;
  readonly unparseable?: boolean;                      // 载荷字段（DC-11：解析状态是数据不是闸门）
}
export interface CommandReceipt {
  readonly oid: ObjectOid;
  readonly revision: number;
  readonly witnessSeq: CommitSequence;                 // DC-7：机制在入口内签发的登记序
}
// Application 目标可见成员名单（S1 可达性判据的正例侧）：
<!-- DC-APP-SURFACE-BEGIN -->
intake  tryAdmit  admit  objectifyRecord  intakeAndAdmit  declare  standingAt
<!-- DC-APP-SURFACE-END -->
// Application 面禁止可达的物理写方法名（S1 可达性判据的负例侧；含既有 D-19c 名单的超集）：
// 「他人领域作用域端口的取得入口」一并入名单——只禁物理写方法会漏掉「拿到 writer 这一步」本身。
<!-- DC-BANNED-WRITE-METHODS-BEGIN -->
createObject  revise  linkRef  createOwned  reviseOwned  linkOwned
write  appendLedger  declareRecord  appendAuthoritativeEvent  recordReport  declareRawIntake
writerOwningKind  writerOf  uow  uowFor  port  raw  kernel  namespacedWriter  writerFor
<!-- DC-BANNED-WRITE-METHODS-END -->」

单动作提交 Port（D4-c 的 `ValidationReportSubmission.submitReport`）**不在**禁用名单里：判据按**成员名**
判定，不按「是不是 Port」判定——`submitReport` 不是物理写方法名，`recordReport` 才是。这条区分写死，
防止实现批把 D4-c 已裁的受限提交口一并扫掉（那是另一契约的既裁面，本契约不重开）。

### 4.3 DC-4/DC-6 前置条件执行序（编号即执行顺序；全部先于任何写、零残留）

「<!-- DC-PREORDER-BEGIN -->
① command-in-roster              ⇒ ACTIVATION_IMPOSSIBLE（名册缺项 = 装配红的运行期延伸）
② owner-capability-active        ⇒ CAPABILITY_INACTIVE（D-25 既有判据源：本进程内存 registry）
③ authority-evidence <parse      ⇒ AUTHORITY_REQUIRED（登记的轴被机制外变更掉的兜底）
                                    取证通道抛错 ⇒ 原样拒绝 + 事务回滚（fail-closed）
                                    取证结论 authorized=false ⇒ **不拒写**（B-3/PR-A1），只决定投影
④ OWNER-DOMAIN PRECONDITIONS     ⇒ DomainRefusalCode（`<域前缀>:<规则>`，如 synth:not-admissible）
                                    ← 本契约新增的、归属校验无法替代的那一点（DC-8/B1a）
⑤ ownership-scoped physical write ⇒ CAPABILITY_SCOPE_ESCAPE / ID_TAKEN / KIND_FROZEN / SPACE_FROZEN /
                                    RECORD_ID_RESERVED（既有码，既有执行点，一字不动）
⑥ required-edge incremental      ⇒ REQUIRED_REF_MISSING / HARD_REF_NOT_PINNED（禁全表重扫，§16.1 D-24）
⑦ handle liveness（任一步之前）    ⇒ TX_CLOSED（§16.1 D-23 原样）
<!-- DC-PREORDER-END -->」

**④ 在 ⑤ 之前**不是风格选择，是判据要求：若 ④ 排在 ⑤ 之后（或干脆复用 ⑤ 的执行点），则「归属合法但领域违规」这一格无人拦（B1a 红），而「领域通过但归属不符」那一格仍会被拦（B1b 绿）——两条不对称正是「领域前置被并进归属判据」的可观测特征（MUT-DC-2 钉它）。

### 4.4 DC-6 实现侧四禁（承接 D4-d / X-7 / P4，不重开）

命令 Port 的实现体只许消费：本能力的 `createOwned/reviseOwned`、本能力的 `linkOwned`、本能力的
`appendAuthoritativeEvent`、已挂载内 `writeFacetRecord`（FM-6）。四禁原样：**不得**① 重取通用 Kernel port
或 `writerFor` 他力；② 触 raw SQL；③ 接全权 `UnitOfWork` 作字段（作**形参坐标**传递是 DC-3 第 1 条，
作实例字段持有是 D-22 已裁的越权形态）；④ 把未绑 resolver 输出当事实输入（X-7 可信绑定，G1-BIND-01/02）。

### 4.5 DC-7 见证来源（沿用 EA，零新造）

- 命令入口落权威事件行时，`AuthorizationContext` 九字段（EA-4.2）由**机制在该入口内**单点生成，
  顺序 = 归属核对 → 激活核对 → 取证 → 对象/修订解析（EA-4.3 序原样，本契约的 ①–⑤ 与之相容）。
- `CommandReceipt.witnessSeq` 只是那行的 `CommitSequence`，**不返回信封对象**（返回信封 = 把见证交回
  调用方手里，EA-4.1「字段相等不够」的反面）。调用方要回看走 `eventsOf` 的 `authority` 列（既有读面）。
- 命令入参字段集封闭（`inputFields` 白名单）：类型面 + 运行时守卫双向（D-17/N3 教训：类型面不是墙）。
  携带见证字段 ⇒ 复用 `EVENT_AUTHORITY_REQUIRED`，`detail.reason = 'input-carries-witness-field'`
  （EA-2.3 既有码既有 reason，零扩张）。

### 4.6 错误模型（DC-9：封闭集零扩张，逐码复用理由）

| 码 | 谁判 | 复用理由（与既有语义同修法） |
| --- | --- | --- |
| `ACTIVATION_IMPOSSIBLE` | 装配期 + 运行期名册 | FM-7/EA-2.4 已确立「名册缺项 = 装配红」同族同码；修法相同（补名册或换入口，不可重试） |
| `CAPABILITY_INACTIVE` | 机制 ② | D-25 既有激活核对，两个通道同判的既有立场 |
| `AUTHORITY_REQUIRED` | 机制 ③ | 缺授权轴（EA/§16.2 判据 ③ 的兜底，非「取证为 false」） |
| `CAPABILITY_SCOPE_ESCAPE` | 机制 ⑤ | 既有 D-19 归属越权，语义与执行点一字不动 |
| `ID_TAKEN` / `KIND_FROZEN` / `SPACE_FROZEN` / `RECORD_ID_RESERVED` | 机制 ⑤ | 既有身份/固定/保留前缀判据 |
| `NOT_FOUND_IN_SPACE` | 机制 ⑤（对象/修订解析） | 无权/他空间/未提交同形（D1-c/C1），本契约**不区分成因** |
| `REQUIRED_REF_MISSING` / `HARD_REF_NOT_PINNED` | 机制 ⑥ | §16.1 D-24 提交期增量判定 |
| `TX_CLOSED` | 机制 ⑦ | §16.1 D-23 |
| `SCHEMA_INCOMPATIBLE` | 命令 ① | 入参携带名册外字段（**形状与登记不符**）：`inputFields` 白名单是运行时守卫，不只类型面（D-17/N3 教训：类型面不是墙） |
| `EVENT_AUTHORITY_REQUIRED` | 机制 ①/③ 的通道面 | 通用通道写正式事件类型 + 自带见证字段（EA-2.3）；**Raw 通道禁出此码**（EA T-N8 同族，DC-11） |
| `synth:*` / 任意 `<域前缀>:<规则>` | 领域 ④ | `DomainRefusalCode = ${string}:${string}` 既有强制前缀机制；领域规则违反**本就**有码可用，无需机制新码（本夹具实际观察到 `synth:not-admissible` 与 `synth:record-ref-required` 两枚，均为领域码 ⇒ 「领域判定不住在机制码里」的形状证据） |

**新增 `RefusalCode` 恰零枚**（对照：`G1-UNIFIED-CONTRACTS.md` §2 全组只新增一枚 `RELOCATION_PRECONDITION`）。
「领域规则被违反」不需要新机制码——`DomainRefusalCode` 的强制前缀就是为此存在的（`src/contracts/index.ts`
原文：「避免与 Kernel 封闭集混淆或被误当成机制语义」）。夹具 D2 真读该文件核名单，正文若写了名单外码即红。

---

## 5. DC-8 机验判据（结构 + 行为；「归属校验无法替代」的形式定义）

### 5.1 结构判据（墙优先，网防遗忘——DC-13）

| id | 判据 | 形态 |
| --- | --- | --- |
| **S1 可达性**（主判据，墙） | 装配根注入给用例的**全部协作对象**，沿「公开成员 → 其返回值」做有界闭包（深度 ≤2）枚举成员名，与 `[DC-BANNED-WRITE-METHODS]` 的交集 **= ∅**；且用例自身可见成员名 ⊆ `[DC-APP-SURFACE]` | 运行时枚举（`Object.getOwnPropertyNames` + 原型链，`tests/use-case-write-path.test.ts` ⑤ 的 `surface()` 形状延伸）。#私有字段天然不可达（N3 教训的执行面） |
| **S2 静态集合等值**（网） | 「Application 目录内的跨归属落笔调用点集合」== **∅**；「全仓 `createOwned/reviseOwned/linkOwned/appendAuthoritativeEvent` 调用点集合」⊆「拥有者自己目录内的调用点集合」 | 词法扫描（**自曝边界**：计算属性/拼接成员名/反射取成员**扫不到**，由 S1 与既有墙负责；本契约必须有一条**断言扫不到**的负空间用例，沿 `tests/domain-write-face.test.ts` 的做法） |
| **S3 具名性与入参封闭** | 命令 Port 的成员名集中**不含** `run/execute/invoke/call/dispatch/apply/send`；命令对象的自有键集 ⊆ 装配期 `inputFields` | 双钉：类型面判别式 + 运行时白名单守卫（EA-4.3 同形） |
| **S4 名册等值** | 装配期 `affectsKinds ⊆ ownsKinds` ∧ `preconditionCount ≥ 1 ∨ statelessKind` 逐名签字 | 装配红（DC-12） |

「**归属校验无法替代**」的形式定义（S1 + B1a/B1b 合起来）：存在一个写路径上的判定点 P，使得
∃ 载荷 L：`owns(writer, L) = 真 ∧ P(L) = 拒`（B1a），且 ∃ 载荷 M：`P(M) = 真 ∧ owns(writer', M) = 假`（B1b）。
两根轴各自可反 ⇒ P 与归属判据不是同一个点。只满足 B1b（只有归属在拦）就是今天的样子：探针里
`CAPABILITY_SCOPE_ESCAPE` 从未触发，违规对象照样落库。

### 5.2 行为判据

| id | 场景 | 必须成立 |
| --- | --- | --- |
| **B1a** | **归属合法 + 领域规则违反**（远程审查点名的负例） | 命令入口拒（`DomainRefusalCode`）+ 目录/状态/台账/边**零残留**；把机制归属检查整体换成恒真（MUT-DC-2）**仍必须拒** ⇒ 证明拒因来自 ④ 不来自 ⑤ |
| **B1b** | 领域规则通过 + 归属不符（非拥有者端口写他人 kind） | `CAPABILITY_SCOPE_ESCAPE`（既有墙一字不动） |
| **B2** | 两个拥有者的命令在同一条事务里各写各的（Q40 正例） | 两笔都在；第二腿抛错 ⇒ **两笔一起回滚**（不是「命令 Port 各开各的事务」） |
| **B3** | Raw Intake 未解析 / 类型未注册 / 结构不合法 | **收**（原文与来源留存，不冒充五类）；`EVENT_AUTHORITY_REQUIRED` 零出现；领域前置点对该通道**零调用**（DC-11） |
| **B4** | 命令 Port 被架空成「直接转手 payload」 | S4 装配红（`preconditionCount < 1`）+ B1a 转绿（夹具捕获） |
| **B5** | 入参自带见证 / 自带 actor / 自带 `authorized:true` | 结构拒（`EVENT_AUTHORITY_REQUIRED`，`reason='input-carries-witness-field'`）+ 零残留 |

### 5.3 正反例表（可执行判据；与夹具 id 双向一致）

| id | 正/负 | 场景 | 期望判定 | 可执行断言形状 | 夹具 |
| --- | --- | --- | --- | --- | --- |
| T-P1 | 正 | 合法命令经拥有者命令 Port 落笔（领域前置全过） | 允许；回执三字段齐；目录/状态/台账各 +1；见证全形 | 「receipt.oid ∧ revision=1 ∧ witnessSeq>0 ∧ dir+1 ∧ state+1 ∧ ledger+1 ∧ gateFullShape(row)=true」 | run_T_P1 |
| T-P2 | 正 | 跨领域编排：记录域 `declare` + 对象模型域 `createClaim` 在**同一条**事务（Q40） | 两笔都在，一次原子提交 | 「两 oid 都在库 ∧ 提交序单调 ∧ 全程只开 1 条事务」 | run_T_P2 |
| T-P3 | 正 | 同 P2 但第二腿抛错 | 两笔一起回滚（Q40 不破） | 「对象/记录/边计数全回到初值 ∧ 无半提交」 | run_T_P3 |
| T-P4 | 正 | Application 面可达性（正例侧） | 用例可见成员 ⊆ 名单；禁名单交集 = ∅ | 「surface(用例) ∩ BANNED = ∅ ∧ 成员名全部 ∈ APP-SURFACE」 | run_T_P4 |
| T-P5 | 正 | Raw Intake 三形（未解析 / 类型未注册 / 结构不合法） | 全收；记录域 `parseState` 落 `'UNPARSEABLE'`（真实现状只有这一对值，`src/domains/test-records.ts:110`）；原始材料不销毁 | 「收 ∧ 原文逐字节留存 ∧ 该通道 classify 调用计数=0 ∧ 零 EVENT_AUTHORITY_REQUIRED」 | run_T_P5 |
| T-P6 | 正 | 有写权无业务轴的主体经命令入口签发 | 收为未生效声明（`authorized=false`），投影不计 | 「行在 ∧ envelope.authorized=false ∧ countsInProjection=false」 | run_T_P6 |
| T-N1 | 负 | **必给负例（远程审查点名）**：载荷归属合法但违反拥有者领域规则 | **拒**（`synth:not-admissible`）+ 零残留；**不得因持有合法 writer 而创建成功** | 「refusal=DomainRefusalCode ∧ dir/state/ledger/edge 计数不变 ∧ 同夹具内 legacy 直写形态必须成功（判别力对照，独占 kernel）」 | run_T_N1 |
| T-N2 | 负 | 名册外命令名 / 未激活能力的命令 Port | 各拒（`ACTIVATION_IMPOSSIBLE` / `CAPABILITY_INACTIVE`）零残留 | 「名册外 / 未激活 / 终结句柄三码各自命中 ∧ 四表计数不变」 | run_T_N2 |
| T-N3 | 负 | 非拥有者端口写他人 kind（领域规则本可通过） | `CAPABILITY_SCOPE_ESCAPE`（B1b，既有墙） | 「码等 ∧ 目标 head 不变」 | run_T_N3 |
| T-N4 | 负 | 命令 Port 实现体内取通用 UoW / raw / 重取 face | 结构判红（四禁）；即便类型面绕过，运行时归属墙拦 | 「实现体源码扫描命中 ⇒ 红 ∧ 同一形态运行时得 `CAPABILITY_SCOPE_ESCAPE` ∧ 换命名空间落笔得 `NAMESPACE_ESCAPE`（夹具两条都实测）」 | run_T_N4 |
| T-N5 | 负 | 入参自带见证字段（actor / authority_basis / authorized:true，值还全对） | 结构拒 `EVENT_AUTHORITY_REQUIRED`，`reason='input-carries-witness-field'`；零行 | 「见证码 + `reason` 命中 ∧ 名册外字段得 `SCHEMA_INCOMPATIBLE` ∧ 缺 required 引用得 `synth:record-ref-required` ∧ ledger 零增量」 | run_T_N5 |
| T-N6 | 负 | 通用分发口 `execute(name, payload)` 形态的「命令 Port」 | S3 判红（具名性失守 = 换个名字的通用写面） | 「成员名 ∈ 通用分动词集 ⇒ 红；真 Port 名单 ⊆ 业务动词条」 | run_T_N6 |
| T-N7 | 负 | 把领域前置点接到 Raw 通道（未解析材料被拒收） | 本契约判 **RED**（DC-11 / B-1 违例：命名/校验权威被用成收取闸门） | 「Raw 路径出现任何拒收形态 = 契约违例 ∧ 该路径领域判据调用计数必须为 0」 | run_T_N7 |
| T-N8 | 负 | 空壳命令入口（`preconditionCount=0` 且未声明 statelessKind） | 装配红 `ACTIVATION_IMPOSSIBLE`，零装配副作用 | 「assemble 抛 ∧ registry 零增量 ∧ 显式 statelessKind 后绿」 | run_T_N8 |
| T-S1 | 结构负 | 装配根把 `writerOwningKind` 形态的委派面交进用例 | S1 判红：可达成员名 ∩ BANNED ≠ ∅ | 「reachable(用例, ≤2) ∩ BANNED ⊇ {writerOwningKind, writerOf} ⇒ 红；目标形态同判据 ⇒ 绿」（再往里一层的 `createOwned` 需**先调用** getter 才可见 ⇒ 归 S1 之外的既有墙，本判据不宣称覆盖） | run_T_S1 |
| T-S2 | 结构负 | 计算属性/拼接成员名绕过词法网 | 网**扫不到**（如实断言扫不到）⇒ 由 S1 可达性 + 既有墙拦下 | 「扫描器对绕过形态返回 ∅（负空间）∧ 同一形态运行时被拒」 | run_T_S2 |

> **建模范围如实声明**：本表「可执行断言形状」列写的是**契约级要求**，夹具实现的是其中**与写权威分层有关**的
> 机器可分子集。以下三项本夹具**不**建模，留给 G2 落码测试逐条钉：T-P5 的记录域载荷字段形态（现状只有
> `parseState` 一对值 `'UNPARSEABLE' | 'PARSEABLE'`，见 `src/domains/test-records.ts:110`；更细的畸变类型标注属 R-6 范围）、T-P6 的「投影不计」（投影属呈现层，夹具只断言
> `envelope.authorized === false` 这一机制事实）、T-N4 的 raw SQL 分支（夹具世界无 SQL）。缺这三项不影响本
> 契约的核心判据（S1 可达性 + B1a/B1b 双轴独立），但**不得**据此声称「G2 无须再测」。

### 5.4 架空判据变异（常驻不删；自验方向 = 真实判据必须拦，架空的必须放）

| id | 架空形态 | 被谁捕获 |
| --- | --- | --- |
| **MUT-DC-1** | 命令入口短路：把 ④ 领域前置整体旁路（`return writeThrough(cmd)`） | **T-N1 必须变绿**（违规载荷被放行）⇒ 夹具记 FAIL 于「负例被拒」⇒ 捕获 ⇒ 证明 T-N1 对「把领域前置点架空」有判别力（本席任务书点名的自验） |
| **MUT-DC-2** | 把 ④ 并进 ⑤（「归属过 ⇒ 领域过」，= 今天 P4 的语义） | T-N1 变绿而 T-N3 仍绿 ⇒ **不对称** ⇒ 双轴独立性判据失效被捕获 |
| **MUT-DC-3** | 结构判据写成「Application 目录里 grep 不到 `createOwned` 字样即过」（拿网当墙） | T-S1 的绕过形态被放过 + T-S2 负空间 ⇒ 捕获（网失效 ≠ 墙失效，DC-13） |
| **MUT-DC-4** | 「为稳妥起见，Raw Intake 也走一遍领域前置」 | T-P5 变红（未解析材料被拒收）⇒ 捕获（DC-11：收紧误伤 Q37） |
| **MUT-DC-5** | 命令 Port 改通用分发口 `execute(name, payload)`（名单外命令名运行时不校验） | T-N6 变绿 ⇒ 捕获（DC-5）。**不宣称双捕**：名册外命令的运行时拒（T-N2）在夹具里由名册查找函数承担，本变异不动它 ⇒ T-N2 保持绿；差异如实登记，不写成「两条都抓」 |

---

## 6. DC-10/DC-11 与其它契约的关系（复用不改）

| 关系对象 | 关系 | 依据 |
| --- | --- | --- |
| X-5 裁决行 | **兑现**：X-5 已写「写他人核心对象的合法路径只有（命令 Port 或 Facet 挂载登记）」；本文把这条落到 Application 行与 Port 形状 | `G1-ADJUDICATION-TABLE.md:82`（X-5 三条定死 ①②③） |
| `G1-UNIFIED-CONTRACTS.md` P4 | **收紧**：P4 已定义两层写面与命令 Port 形状（先例 = `FactDesignationCommandPort`），但其 Application 句「经 `writerOwningKind` 完成跨归属写」与本契约 DC-2 不相容 ⇒ §8 冲突登记 C-1，**不抹平** | P4（`G1-UNIFIED-CONTRACTS.md:135-152`） |
| `G1-UNIFIED-CONTRACTS.md` §1.1 权限矩阵 Application 行 | **待回填**（本席不改）：该行的可达 Port 写的是 `UseCaseDelegation.writerOwningKind` | §7 回填项 R-1 |
| EA 契约（事件命名/见证） | **复用**：`AuthorizationContext` 九字段、单点生成、入参封闭、全形闸 EA-4.5 三支谓词，全部原样引用，零新造、零扩名单 | EA-4.2/4.3/4.5 |
| FM 契约（Facet 挂载） | **正交**：挂载登记是**另一条**合法跨归属路径（X-5 括注「另席」）；本契约不重开 FM-3.1 判据，`writeFacetRecord` 只在 DC-6 四禁白名单里出现一次 | FM-2.2/FM-6；X-5 |
| `CONTRACTS.md` §16 D-19/D-19c | **承接并再收紧**：§16 首表两行一字不动（领域自有端口不变）；**新增第三行**（命令入口）+ D-19c 句改写；`D-19c-ALLOWED` 标记制退役留痕 | §7 回填项 R-2/R-3 |
| Q40（单 Space 原子事务） | **不破**：命令 Port 只在调用方事务里落笔；B2/B3 就是这条的护栏 | #44 §7.3（R-04）；夹具 T-P2/T-P3 |
| Q37（Raw Intake ≠ Domain Admission） | **不被误伤**：DC-11 + B3 + T-P5/T-N7/MUT-DC-4 三层钉住；「拒写 ≠ 拒收」一字不动 | #44 §7.2（R-03）；EA §1.3 B-1..B-6 |
| Q12（领域数据只能经所属领域权威接口修改） | **从约定升为机制**：D-19 行早就写着「没有它们，Q12 就只是文档上的话」；本文把同一句话从「领域侧」推到「用例侧」 | CONTRACTS §16 首表末注 |
| #42 RD-05 / RD-27 / RD-33 | **一致**：命令入参用 `RevisionRef` 形态（精确引用）、写权与业务授权两分（③ 的 `authorized=false` 不拒写）、机制不判语义等价（④ 归领域） | R-08/R-10/R-11 |
| #47 | **未覆盖**（条件式）：#47 层对 Application 写面/命令入口零条文；不写「属 #47 决策面」 | D5-a；`G1-RECON-PR47.md` 检索实测 |

---

## 7. 迁移影响与责任 PR 登记（**只登记，本席不改他席文件**）

> 编号 R-x；「责任席」= 该文件的当前维护席位。本契约给形状与判据，落地与既有测试改写在下列 PR。

| id | 目标文件/面 | 要改什么 | 责任 PR | 前置/同批约束 |
| --- | --- | --- | --- | --- |
| R-1 | `g1/G1-UNIFIED-CONTRACTS.md` §1.1 表 Application 行 + P4 | 可达 Port 由 `writerOwningKind(kind,tx)` 改为「拥有者导出的具名命令 Port 集合」；「跨归属写」措辞改为「跨领域**编排**」；同批更新 §2.10 错误码登记（本契约新增码 = 0） | 汇编席（G1-UNIFIED-CONTRACTS 维护） | 与本契约并入同批评审；**不得**只改措辞不改权限矩阵 |
| R-2 | `CONTRACTS.md` §16 首表 | 加第三行「Domain Command Port（拥有者具名命令入口）｜ 拥有者能力实现 ｜ 执行完 DC-6 ①–⑦ 后落笔 ｜ DC-2/DC-6」；D-19c 句改写为「用例层不得持有**任何**他人领域写面（含作用域端口）」 | PoC 契约席（CONTRACTS.md §16） | 收紧方向的重锚：逐条点名，不走静默（§16 既有纪律） |
| R-3 | `CONTRACTS.md` §16 + `src/app/delegation.ts` 头表 | `D-19c-ALLOWED` 标记 + 计数双判据**退役留痕**（保留历史句，标注被 DC-2 取代）；`src/app/**` 允许写面收缩为空集 | PoC 契约席 + G2 实施 | 与 R-4 同批，否则「标记制已废但代码还在用」会假绿 |
| R-4 | `src/app/intake-use-case.ts`（`:99-101` 跨归属直写、`:53` `appendLedger`） | `#writeOwned` 改为 `#objectModelCommands.createClaim(tx, …)` / `#rawIntakeCommands.declare(tx, …)`；删 `UseCaseDelegation` 依赖；`tryAdmit` 的「只拒不抛」语义保持（DC-11/B3） | **G2 新立 PR-11**（Application 面退役，建议名 `app: Application 写面清零 + 命令入口改道`）；`G2-DEV-PLAN` 现无此 PR，登记为待新增 | **进入门禁**：R-5 已合入（拥有者侧无前置点时改道 = 空壳搬家，DC-12 装配红） |
| R-5 | `src/domains/test-object-model.ts` | 拥有者侧**长出**命令入口与真实前置点（现只有 `ownsKinds` 清单、零规则，§0.1 实测第 3 条）；`test.subject` 若确无前置 ⇒ 逐个 `statelessKind` 显式签字 | **G2 PR-11 同批**（拥有者侧与用例侧**同一提交**，否则装配红） | DC-12/S4 机验；禁止「先改道后补规则」的拆批 |
| R-6 | `src/domains/test-records.ts`（`IntakePolicy`） | 接纳判据**迁移到拥有者命令入口**或显式声明为跨域草稿（现状：接纳规则住在记录域，写的却是对象模型拥有的 kind——§0.1 第 3 条）；本表登记为**领域规则归属复核项**：`synth:not-admissible` 这条规则到底该由谁执行，G2 前须有结论 | G2 PR-11 + 领域席位复核 | 「规则住在 A 域、写发生在 B 域对象」是 D-19 教训的**另一半**，不能靠改道自动解决 |
| R-7 | `tests/domain-write-face.test.ts` / `tests/use-case-write-path.test.ts` | 名单扩到 `[DC-BANNED-WRITE-METHODS]` 全名单；S1 改为**可达性**枚举（现只查用例自身成员名，深度 0）；保留「断言扫不到」的负空间用例；⑤「用例不持有事务入口」不动 | G2 PR-11（测试与实现同批） | 测试改动方向只能是**收紧**；任何放宽逐条点名 |
| R-8 | `g1/G2-DEV-PLAN.md`（PR-2 段 L141「协调台账行改走 `writerOwningKind` 委派」） | 该行措辞与本契约不相容 ⇒ 改为「协调台账行改走记录域 `RawIntakeCommandPort`」；并把 R-4/R-5 挂进 PR 依赖图（PR-2 ↔ PR-11） | G2 计划席 | 与 PR-2 的 `synth:raw-intake` 登记义务同批（R-9 已提前，工程审查 P1-3） |
| R-9 | `g1/G1-ACCEPTANCE-MATRIX.md`（X-5 / G1-OWN-02 证据列） | 验收行补：S1 可达性 + B1a/B1b 双轴 + MUT-DC-1 捕获；`G1-OWN-02` 的 evidence 从「靠约定不靠机制」更新为「机制：DC-2/DC-8 + 夹具 exit 0」 | 矩阵席 / 清单席 | 清单条目**由本契约给出可关闭证据形态**，但 status 变更须三件套（owner/evidence/resolution），本席不代改 |
| R-10 | `src/kernel/kernel.ts` / `src/app/delegation.ts` 的 `UseCaseDelegation` 接口 | 接口成员退役（`writerOwningKind`/`writerOf`）；`namespacedWriter` 保持但只对 `face.writerFor` 与装配期开放 | G2 PR-11 | 插件可见面成员**只减不增**；面锚对拍（`arch-independence.test.ts`）同批复跑 |

**迁移顺序（写死，防拆批假绿）**：R-5（拥有者侧前置点 + 名册）→ R-4 + R-6 + R-10（同一提交）→ R-7（判据）→ R-1/R-2/R-3/R-8（条文回填）→ R-9（验收登记）。
**R-5 之前禁止 R-4**：那会造出「有命令入口、入口里没规则」的空壳形态（DC-12/B4 专防这一格），比现状更隐蔽。

---

## 8. 冲突登记（**不抹平**，两侧原文并列）

| id | 冲突 | 两侧原文位置 | 本席处置 |
| --- | --- | --- | --- |
| C-1 | Application 可否取得他人领域 `NamespaceWriter` | 甲：`G1-UNIFIED-CONTRACTS.md` P4「Application 层只做跨域事务协调：经 `writerOwningKind` 在调用方同一条事务内完成跨归属写」+ §1.1 表 Application 行；乙：`G1-ADJUDICATION-TABLE.md:82`（X-5）「协调方不持有通用写面……写他人核心对象的合法路径只有（命令 Port 或 Facet 挂载登记）」 | 本契约按**乙**收紧（甲是乙的未兑现形态）。**不判甲错**：甲在 D-19c 当时是**收紧**（此前用例拿 `tx.createObject`，`READINESS.md` D-19c 行），只是没走到底。回填走 R-1/R-2，本席不改 |
| C-2 | 拒绝码是否需新增 | 甲：直觉主张「领域规则违反该有一个机制码」；乙：`src/contracts/index.ts` `DomainRefusalCode` 注释（强制前缀即为区分而设）+ §14.2「新码必须论证与既有码不同修法」 | 采乙：**新增零枚**（DC-9）。探针里领域拒的既有形态 `synth:not-admissible` 就是可用形态（真库实测第一行） |
| C-3 | 「Application 面上的 `appendLedger`」 | 甲：`CONTRACTS.md` §16（标记 + 计数双判据 = 合法白名单）；乙：本契约 DC-2 BANNED 名单含 `appendLedger` | 采乙，但**退役留痕**（R-3）：现行双判据是「清单要逐条签字」，本契约把清单清零，比签字更严；须在 §16 原文处标注取代关系，不得静默删条 |
| C-4 | 观察项（非冲突） | `src/app/delegation.ts` 头表称「委派端口与领域自有端口能力完全相同，一步多不了」——**就 kind 而言真，就规则执行而言假**（探针实证） | 本契约把该句的量化范围收窄到「物理可写集」，并在 R-3 同批改写「不存在第二个权威」句为「不存在**未跑领域前置的**写路径」 |

---

## 9. 真·用户决策

**无**。本专题全部问题由既有裁决（X-5、Q40、Q37、Q12、D-19 教训、#44 §4/§5/§7.3、#42 RD-05/RD-27/RD-33）
直接推得，无需用户新裁。需要**人工动作**的只有两件流程义务（都不是开放决策）：

1. R-9 清单条目 `G1-OWN-02` 的 status 变更须按清单三件套（owner 非 UNASSIGNED + 可定位 evidence +
   resolution 写清谁让位），本席只给证据形态，不代改（清单席动作）。
2. 领域规则归属复核项（R-6）：`synth:not-admissible` 这条接纳规则该由**记录域**还是**对象模型域**执行
   —— 这是**领域建模问题**，属席位可裁范围之外的领域政策面；但它是**产品/领域席的评审动作**，
   不是用户决策（用户已裁的是「规则由拥有者执行」这一机制原则，未裁「哪条规则归谁」）。

---

## 10. 引用账本（上层条文以 `git show` 对 blob 原文核验；夹具 S 组机验）

| # | SHA | 文件 | 位置 | 原文短句 |
| --- | --- | --- | --- | --- |
| R-01 | `5ec38974fc` | `docs/architecture/V3_CODE_ARCHITECTURE_DRAFT.md`（#44） | L112（§4 目录树） | 「application/         # 跨域 Use-case 及事务协调，非中心业务规则」 |
| R-02 | `5ec38974fc` | 同 #44 | L125（§4.2 依赖方向） | 「领域插件只使用其他能力的**版本化公开 Ports**，禁止 import 其他插件的 private SQL/schema/implementation；Application Use-case 通过注册的 Port 协调。」 |
| R-03 | `5ec38974fc` | 同 #44 | L137（§5 表） | 「单 Space 原子 Unit-of-Work 与受约束的 Storage Port ｜ 领域对象私有规则、任意跨空间事务或外部 Agent 执行副作用」 |
| R-04 | `5ec38974fc` | 同 #44 | L242（§7.3，Q40） | 「允许在一个事务中预分配 ID、暂存多个拥有者各自的数据，并通过拥有者的 Port 进行完整性检查，再**一次原子提交**」 |
| R-05 | `5ec38974fc` | 同 #44 | L266（§8.2） | 「实体类型、World/Scope、Concept 定义、Scheme 版本由所属领域 Capability 验证。」 |
| R-06 | `5ec38974fc` | 同 #44 | L235（§7.2，Q37） | 「Domain Admission：……通过拥有者检查其最低可解析条件、固定 kind/space、注册 Directory 与领域内容，并原子写 H」 |
| R-07 | `0369c3196c` | `H_S_R_DECISIONS_AND_GAPS_DRAFT.md`（#42） | L43（RD-05） | 「正式声明位置（论证输入/结论/条件、评价目标、接纳目标、检查对象）**只允许精确引用**；「跟随当前」仅限浏览与非规范选择」 |
| R-08 | `0369c3196c` | 同 #42 | L65（RD-27） | 「**空间写权限与业务授权分离**：有权空间内可存未生效接纳声明；无写权限一律拒绝」 |
| R-09 | `5ec38974fc` | `docs/architecture/V3_CODE_ARCHITECTURE_DRAFT.md`（#44） | L174（§5.3，Q44） | 「`CapabilityID` 稳定且单空间同一时刻只有一个权威写入者」（本契约把它从「谁写」推到「经谁的入口写」） |
| R-10 | `5ec38974fc` | 同 #44 | L266（§8.2 同段） | 「机器校验只能检查声明是否具备合法结构，不自动验证科学语义等价（RD-33）」 |
| R-10b | `0369c3196c` | `H_S_R_DECISIONS_AND_GAPS_DRAFT.md`（#42） | L71（RD-33） | 「**S-L1 只查声明不判语义**：涉及等价、原意、真值条件变化的规则只验证声明存在与一致，不验证其内容」 |
| R-11 | `d2f19cc`（工作树） | `CONTRACTS.md` | §16 首表 + D-19c 段 | 「Application Use-case 层的写权限形态（D-19c 收口）：……只能经 `UseCaseDelegation.writerOwningKind(kind, tx)` 取得**对象拥有者的作用域端口**」 |
| R-12 | `d2f19cc` | `CONTRACTS.md` | §16 首表末注 | 「没有它们，『领域数据只能经所属领域权威接口修改』（Q12）就只是文档上的话」 |
| R-13 | 工作树 | `g1/G1-ADJUDICATION-TABLE.md` | :82（X-5） | 「① 协调方（Application/UoWImpl）**不持有通用写面**；② Capability-scoped Storage Port……≠ Domain Command Port……写他人核心对象的合法路径只有后者」 |
| R-14 | 工作树 | `g1/G1-UNIFIED-CONTRACTS.md` | :135-152（P4） | 「Domain Command Port = 领域能力把科研动作表达为自己语义集的具名 Port……实现内部只许消费：自己的 `createOwned/reviseOwned`、自己的 `appendAuthoritativeEvent`、挂载内 `writeFacetRecord`；**不得**取通用 UoW/raw SQL/重取 face（四禁）」 |
| R-15 | 工作树 | `g1/G1-UNIFIED-CONTRACTS.md` | :152 | 「墙 > 网：运行时作用域上界是墙，源码扫描是网（§16 判据强度次序，防倒置）」 |
| R-16 | 工作树 | `src/contracts/index.ts` | RefusalCode 封闭集 + `DomainRefusalCode` 注释 | 「领域扩展码必须带命名空间前缀（含冒号），既不与 Kernel 封闭集混淆，也不把某个域的前缀写进机制契约本身」 |
| R-17 | 工作树 | `READINESS.md` | D-19 / D-19c 行 | 「`UnitOfWork.revise()` 取了 `owner_capability` 却不与调用方比对，领域代码拿通用事务即可改任意领域对象，违背 Q12」（D-19 教训原文） |
| R-18 | 工作树 | `IMPLEMENTATION-PLAN-DRAFT.md` | :623（§15 G1-a） | 「`createOwned(kind, payload)` 只保证写者属于正确 Capability，**不保证跑过对象拥有者的完整领域校验**……否则 G2 的『权威存储实现』会把这层混淆固化成 API」 |

---

## 11. 变更纪律与未决项（诚实清单）

- **本契约的变更纪律**：DC-1/DC-2/DC-8/DC-9/DC-11/DC-12 任一条变动，或 `[DC-BANNED-WRITE-METHODS]` /
  `[DC-APP-SURFACE]` / `[DC-PREORDER]` 三个机器块任一变动 ⇒ 本文件与夹具**同批**改，夹具 exit 0 才算改完。
  变窄方向（将任何禁成员移出名单、把任何 ①–⑦ 步后置、把任何 S/B 判据降级为「建议」）视同冻结面变更，
  须走冻结变更流程并留 `Frozen-Face-Review` 式人工标记。
- **未决 / 保留项**：
  1. `statelessKind` 的人工签字**由谁签**（产品席 or 领域席）本契约不裁，只裁「必须显式点名 + 装配红」；
     默认按 R-6 的领域规则归属复核一并处理。
  2. S1 可达性闭包深度定为 2（协作对象 → 其返回值）；更深层（返回值的方法再返回写面）靠 N3 私有字段纪律 +
     既有墙兜底。**未实现**更深的图遍历判据（成本/收益不划算），如实登记。
  3. 本契约**不**给「拥有者命令入口的领域规则内容是否正确」提供任何判据——那是领域政策与检查器
     （D4-c/S-R 校验面）的事（RD-33：机制只查声明合法，不判语义等价）。DC-12 只保证「有一个前置点」，
     不保证「那个点判得对」。这条边界写死，防「有命令入口 ⇒ 领域正确」的新洗白。
  4. 探针在 `.scratch/`（不入仓，会被清理）；等价形态已常驻夹具 —— `legacyContrast()`（对照项「现状机制确实拦不住」）
     就是同一旁门的模型形，T-N1 用它钉判别力，故证据链不依赖可弃目录。
  5. `attacks/**` 是审查方冻结面：本席不写、不建议改。若审查方要把 T-N1 形态做成攻击夹具，由该席自行决定。
  6. **夹具自身的判据自验**（防「静态对账写成装饰」）：夹具正文路径可用 `DC_DOC=` 覆盖，把正文按五种方式削弱后
     各跑一次，D 组必须红——实测全部 **exit 1**：①（W1）调换 ④/⑤ 顺序 ⇒ `D4b` 红；②（W2）从 `[DC-BANNED-WRITE-METHODS]`
     删掉 `writerOwningKind/writerOf` ⇒ `D3a` + `D9c` + `run_T_S1` 红；③（W3）偷偷新增一枚不在封闭集内的假码
     ⇒ `D2` 红（名单外）；④（W4）删掉 T-N1 行 ⇒ `D5a` 红（runner 孤儿）；⑤（W5）拆掉「拥有者侧前置点先于改道」那句禁令 ⇒ `D6b` 红。
     （教训记一笔：削弱必须**全量替换**——正文他处引用同一句时，只替换首个出现处会让削弱悄悄失效。）削弱形态编号 W1..W5 写在夹具里，与本节 ①..⑤ 一一对应；默认路径（本正文）**exit 0、52 项全过**
     拆解：16 条正反例 + 1 条判别力对照（legacy 形态必须放行）+ 6 项行为变异捕获（MUT-DC-2 额外查不对称面）
      + 24 项静态对账（D1..D11）+ 5 项削弱自验；套件实际观察到 10 枚拒绝码（含 `synth:*` 两枚领域码），全部能在本文件找到出处（D11 逐码反查）。
