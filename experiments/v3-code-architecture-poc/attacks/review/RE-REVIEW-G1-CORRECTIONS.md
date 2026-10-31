# RE-REVIEW-G1-CORRECTIONS —— 远程审查四项 P1 缺口的独立定向复验（复验席）

> **席位**：独立定向复验席（只读）。**对象只有一件事**：远程审查判定的四项 P1 缺口（①历史序号、
> ②幂等、③领域命令权威、④身份文法）+ ⑤冻结判据两层化，在 `HEAD`（`6e23f34`，分支
> `g1/contracts-20261031`，补正提交 `079b69f`/`744f777`）上**是否真的被闭合**，以及直接回归。
> 不开新战场、不重开 Q1–Q45、不重跑领域/工程两轮。统一契约收编席并行工作（其清单回填稍后落），
> 本席以 `HEAD` 已提交内容为基准（见 §0 漂移登记）。
> **全部判据来自本席亲手重跑**，无一采信席位回报数字。**计数：闭合 5 / 部分闭合 1 / 未闭合 0**
> （⑤ 判部分闭合——闭合的是机制面，其 §2 自设的「专题文书未跟踪不得引用为已闭合」判据在
> HEAD 上已满足，但 §6 期望退出码与 A 层「机验面」状态行的**历史实测记录未随在盘事实整批更新**，
> 属文书卫生非判据失效——详见 §5，不上升也不遮掩）。
> 构造物全部落 `.scratch/re-review-g1/`（gitignored）。被审文件复验前后逐字未动（§8）。

---

## 0. 工作树与漂移登记（诚实前置）

- 本席全程唯一写入 = 本文件 + `.scratch/re-review-g1/**`。**零 git 写操作**、零被审文件写入。
- 复验开始时 `G1-CONTRACT-COMMIT-SEQUENCE.md` 已带他席未提交改动（`M`，本席读的是 HEAD 版本 +
  工作树版本的差 = 头注/`read-context.ts:100-103→100-101`/BF-06 补句三处，均为**并行收编席**所改，
  非本席）。复验期间 `G1-RECONCILIATION-CHECKLIST.yaml`、`G1-ACCEPTANCE-MATRIX.md`、
  `G1-ADJUDICATION-TABLE.md`、`G1-UNIFIED-CONTRACTS.md`、`G2-DEV-PLAN.md` 由并行席陆续转 `M`
  （清单 4 行 evidence 加注，status/tier/owner 结构面零动，本席复核过 diff）。这些漂移**均非本席所为**；
  本席的门禁复跑（§6）在漂移前后各跑一遍，结论一致（daily 0 / clear 1 / self-test 0）。

## 1. 专题① 历史序号（`g1/G1-CONTRACT-COMMIT-SEQUENCE.md`）—— **闭合**（契约/判据层）

**本席自建真库探针** `.scratch/re-review-g1/probe1-commit-seq.mjs`（`node v24.21.0` + `node:sqlite`
`DatabaseSync`，SQLite 3.53.4）：`meta`/`ledger`/`domain_state` 三段 DDL（含全部守卫触发器）从
`src/storage-sqlite/sqlite-port.ts` **正则逐字提取**；`commit_record` + 归属映射按契约 CS-1.3
**夹具形**自建（契约明写物理 DDL 归 G2，此处即夹具形态，与 CS 夹具同界）。**PASS 15 / FAIL 0，exit 0**：

| 判据 | 本席实测 |
| --- | --- |
| **原反例复现**（被禁谓词 `recorded_seq <= k`，`read-context.ts:100` 逐字语义） | `k=2` 在同库切出 `seq∈{1,2}`——「一次事务三事件、只看见前两条」的**从未原子提交过的中间态**确实切得出 ⇒ 靶真实存在（`MUT1-forbidden-predicate-does-slice-intermediate` PASS） |
| **契约谓词切不出** | `commit_sequence <= resolved_cutoff`（候选截点 = `{0}∪提交账键`，I-6），枚举 `0..事件头+2` **一切取值**：可见集恒 ∈ 全量快照族 {∅, 3行, 5行}，**无任何截点给出中间态**（`Q1-…` PASS，空集） |
| **冒充支**（事件序数值当提交序传入） | 每个 k 经 `resolveCutoff` 要么越界拒（detail 无 head），要么落回**完整提交前缀**——永不可达事务内部（`Q2-…` PASS）；机制 = 提交轴稠密（CS-1.4 结构性论证），本席独立复算成立 |
| **回滚/提交期失败无 ghost** | 事务内预留 + 3 事件后 `rollback` / COMMIT 前注入抛错 ⇒ 另一连接读 `meta.commit_sequence=0`、`meta.ledger_seq=0`、三表 0 行；下一提交**复用** c=1（T-P2/T-P4 形复现） |
| **回填式分配**（MUT-3 形） | 提交后 UPDATE 归属落点撞 `HISTORY_IMMUTABLE` ⇒ 分配点只能在行插入前（T-N5 形复现） |
| **时钟回拨** | 语料 c1@1000, c2@3000, **c3@2000（更晚提交携更早墙钟）**, c4@5000；10 个观察时刻 × 4 次追加重解析：`cutoff(t)` 历史**逐次不变或前移，零回退**（`Q3-…` PASS）；t=2500 在 c3 注入后仍 =1（保守不前移，CS-3.2 边界句）；同条件**重复解析 5 次恒等**（CS-3.2 已解析截点固定的解析侧性质） |
| **CS-3.3 跨毫秒提交** | 同一事务两事件行 `recorded_at` 人为拉开 1000/9999、提交墙钟 5000 一枚 ⇒ t=4999 全不见 / t=5000 全见，**切不开**；逐行取 `recorded_at` 的架空形在 t=1500 立刻切开（`MUT2` 配对判红） |

契约条款面本席逐条核对：CS-1.4 禁令 1–7 封闭清单、CS-2.1 两支入参封闭、CS-2.2 解析单点不读水位、
CS-3.1 运行最大前缀界定义、I-1 等号（本席实测水位前跳 ghost 被等号识破、解析器不随之前跳）。
§5 对现状的差（`read-context.ts:100-101` 谓词、单品牌、`get head` 说谎名）**如实登记在契约自身**——
生产码仍是缺陷现场属预期（G1 契约阶段），换轨归 BF-03/PR-4；**远程审查缺口的本体是"载体未定/判据未定"，
本席判定已定且机验可复跑** ⇒ 闭合。

**残口（如实，不影响闭合）**：T-P7（游标重放不重解析）与 T-P6/P8 在 CS 夹具中标"模型"形——本席对
解析器的单调/稳定性质做了独立真库级复核，但**完整游标**（自包含 + 跨授权类同形拒）的真库对应物随
PR-4/PR-3 落码；CS-3.2 的"一次逻辑读入口解析一次"是流程判据，机验半边（游标重放）与 MUT-4 同为模型形，
契约 §6 自己标了"模型"，无虚报。

## 2. 专题② 幂等（`g1/G1-CONTRACT-IDEMPOTENCY.md`）—— **闭合**（契约/判据层，超出"止于模型形"下限）

契约自身声明模型形（§8 真库对应物归后续 PR）；本席**独立做了真库级复现**，超出其自设下限：
`.scratch/re-review-g1/probe2-idem.mjs` + `probe2-child.mjs`——同一 Space 文件（契约 P1 文件=事务边界）内
`idem_receipt`（四元组 PK）+ `domain_rev`，**真 SIGKILL 子进程崩溃注入** + **真双进程并发**，WAL 恢复审计。
**PASS 7 / FAIL 0，exit 0**：

- **两窗口在契约形态下不可观测**：kill 点 ∈ {pre-txn, mid-key-inserted, mid-domain-inserted,
  pre-commit, post-commit} 五格 ×（崩溃 + 重放）穷举 ⇒ 恢复态 `孤儿键=0 ∧ 孤儿效果=0`，
  重放后恒 `revs=1 ∧ receipts=1`；pre-commit 及以前崩溃 = 提交前态（键与业务**同缺**），
  post-commit 崩溃 = 提交后态（重放命中首次结果零新增）。**M1/M2 两格只存在于日志中间态**，
  与 IDC-3 的证明逐字相符。
- **判别力配对（反证两窗口在被否形态下可观测）**：两段提交·键先 ⇒ `receipts=1, revs=0, orphanKeys=1`
  且重放被误导（`REPLAY-UNRESOLVABLE-REF o1@1`，回吐指向不存在的首次结果）；两段提交·业务先 ⇒
  `orphanEffects=1` 且重试**造出第二修订**（`revs=2`，直违 SI-41 首句）⇒ 独立账被否理由（窗口 B
  不可判定）在本席探针上成立，非纸面论证。
- **并发同键**：契约形态（`BEGIN IMMEDIATE` 内查+写，IDC-7）双进程同键 ⇒ `revs=1, receipts=1`
  （后到者事务内命中走重放支）；架空形 MUT-IDEM-2（事务外查键 + 两段写）⇒ **`revs=2`** ⇒
  持锁窗口判据有真实判别力。
- 条款面：IDC-5 四步序 + "被拒不占键"推论、IDC-6 逐字节回吐不重读域、IDC-9 断言形状、
  IDC-11 三层分置（键+摘要+引用永久热存、快照可冷存不删）本席逐条读文；`IDEMPOTENCY_KEY_REUSED`
  = `TOOL_INPUT.detail.serviceCode` 非机制码——本席核 `src/contracts/index.ts` 封闭集内无此名 ✓。

**残口（如实）**：**契约自身与真库实现之间还差装配落点**——现 `src/**` 无任何按请求幂等账本
（`store.ts` 的 idempotent 是重入语义，契约 §0 自述属实）；receipt 表 DDL、写事务①–⑤链插入点、
kill -9 真测试、双连接真测试、INV-4 静态门全部登记为**后续 PR（§8 真库对应物清单，落 PR-9 执行序，
DEP-PR9-1 已登）**。本席的真库探针证的是**判据形态在真 SQLite 语义下成立且可判别**，不代做 PR。
按任务书口径：契约判据闭合；真库对应物归 **PR-9**（契约 §7/§8 自登记，本席核在位）。

## 3. 专题③ 领域命令权威（`g1/G1-CONTRACT-DOMAIN-COMMAND.md`）—— **闭合**（契约/判据层）

**本席自建 S1 可达性扫描 + 载荷最小复现**（`.scratch/re-review-g1/probe3-domain-command.probe.test.ts`，
vitest 真跑，**PASS 9 / FAIL 0，exit 0**）：

- **可达集自扫（机器块逐字提取，不手抄）**：`[DC-BANNED-WRITE-METHODS]` 21 名 + `[DC-APP-SURFACE]` 7 名。
  - **legacy 装配形（= 今天 `src/harness/world.ts:107-110` 实际注入对象的形状）**：深度 ≤2 闭包
    与禁名单交集 ⊇ `{writerOwningKind, writerOf}` ⇒ **今天仍在可达集内，S1 判红**——与契约 §3.1
    退役清单（"今天在哪"列逐位核对：`delegation.ts:48/:50`、`world.ts:91/99/108/109`）及夹具 D9c
    同向 ⇒ 契约**没有假装今天已拆墙**，如实登记 G2 PR-11 拆（R-7 测试同批）。
  - **目标形（DC-2/DC-6：注入拥有者命令 Port）**：可达成员 ∩ 禁名单 = ∅，成员名 ⊆ 业务动词语料 ⇒ 绿。
  - **真实 `IntakeUseCase` 类实例**（直接 import 生产源码跑运行时枚举）：自有可见成员
    `{intake, tryAdmit, admit, objectifyRecord, intakeAndAdmit}` ⊆ APP-SURFACE；`#delegation` 为
    ES 私有字段，名可达扫描**天然不可见**——本席如实记录该判据强度边界：S1 的墙必须扫**注入的
    协作对象本体**（夹具正是这么做的），扫类实例会假绿。契约 §5.1 括注自认此边界，无虚报。
- **载荷最小复现（真实领域规则 × 机制归属-only 写端口）**：真实 `IntakePolicy.decide`（
  `src/domains/test-records.ts:116`）对载荷 `text 含"残缺"` 判 `synth:not-admissible`；
  机制写端口镜像 `kernel.createOwned` 语义（只判归属，非拥有者 ⇒ `CAPABILITY_SCOPE_ESCAPE`）。结果：
  - **legacy 直写（今天的形态）：归属合法 + 领域违规载荷创建成功**（dir/state/ledger 各 +1）
    ⇒ 洞今天为真，复现成立——这与夹具 `run_T_N1_legacy` 判别力对照同向（本席另跑夹具：
    `PASS 对照 run_T_N1_legacy（现状机制确实拦不住 ⇒ 该负例非平凡为真）` 在输出行在案）；
  - **目标链（④ 领域前置钉在 ⑤ 归属物理写之前）：同载荷被拒 `synth:not-admissible` 且四计数零残留**；
  - **MUT-DC-2 架空形（"归属过⇒领域过"）：同载荷放行** ⇒ 目标链非空转判据（双轴独立性 B1a 成立）；
  - **B1b 反轴**：非拥有者端口写他人 kind 仍 `CAPABILITY_SCOPE_ESCAPE`（既有墙不动）。

**残口（如实）**：现 `src/app/delegation.ts`/`world.ts` 的 legacy 委派面仍在盘（预期，G1 只裁契约）；
S2 词法网的负空间用例（计算属性绕过"断言扫不到"）夹具已含、本席未重复造。DC-6 ①–⑦ 完整运行序
由夹具 52 项覆盖（本席见 T-N2/N4/N5/N6/N8 + MUT-DC-1..5 行），本席的最小复现只钉 B1a/B1b 双轴心。

## 4. 专题④ 身份文法（`g1/G1-CONTRACT-IDENTITY-GRAMMAR.md`）—— **闭合**

**本席自造 42 例语料**（`.scratch/re-review-g1/probe4-grammar.mjs`，判据按机读块 `SPACE_ID_GRAMMAR`/
`RECORD_ID_GRAMMAR`/`REC_SCHEME_GRAMMAR` 逐字提取重建 + IG-4 步序；**PASS 42 / FAIL 0，exit 0**），
覆盖任务点名全部形态：

| 族 | 结果 |
| --- | --- |
| 超长 | space/record 64 界内收、65 拒（不钳制不截断）；`rec:`+64=68 收、+65 先撞 id 文法拒 |
| 大小写折叠 | space 大写**形态非法**（非"不区分"）；record `Abc-1`≠`abc-1` **逐字节两身份**并存收；`REC:`/`Rec:` scheme 折叠方向拒（与保留前缀双检相反向，理由在条文） |
| NFC/NFD/全形 | `café`(NFC)/`cafe\u0301`(NFD)/`ａlpha` 全拒——规范化问题被 ASCII 闭集消灭，非"先归一再比" |
| `%` 百分号 | 值含 `%` 文法拒；`%61lpha` 值层拒、框层解一次成 `alpha` 过闸（唯一合法路径正控）、`%2561lpha` 解一次仍含 `%` 拒；机制面自身零解码 |
| `NSR-` 前缀自造 | 声明通道 `NSR-1` 字节形 + `Nsr-1`/`rpt-1`/`Rpt-1` 折叠形全 `RECORD_ID_RESERVED`（双检）；`ＮＳＲ－１` 全形先撞文法闸（顺序断言③先⑤）；**引用通道 `NSR-9`/`FR-1` 放行**（引用≠声明） |
| 含冒号 | record_id `a:b`/`rec:x` 自含全拒（冒号出集）⇒ `rec:` 前缀切分唯一；`rec:rec:x` 嵌套拒；保留字 `default`/`assembly` 整词拒、`default1` 收 |

**`RefusalCode` 封闭集零新增（真读源文件）**：`git diff --exit-code d2f19cc..HEAD -- …/src/contracts/index.ts`
⇒ **exit 0，字节逐等**（锚点 `d2f19cc` 至 HEAD 该文件零改动）；封闭集 = 29 枚（本席数读 + DC 夹具
"封闭集 29 枚"行一致），IG 契约引用码逐名 ⊆ 封闭集 ∪ 声明的过渡形/构建期信号（探针 `codes:` 行 PASS，
本席的两处豁免——机器块键名与 src 常量名——已在探针内如实标注）。

**残口（如实登记，属契约自身已声明的实现批缺口非隐瞒）**：`src` 现状 `RESERVED_RECORD_ID_PREFIXES=['RPT-']`
（`kernel.ts:68`，判据为**字节形 startsWith**，`kernel.ts:1275`）⇒ FM-/FR-/NSR- 与折叠形**今天不被现状代码拦**；
`asSpaceId` 现状 = 裸 cast（`contracts/index.ts`，G-23"现状零校验"属实）。两处均在契约 §6.2 R-④ 登记为
G2 实施批义务（扩集 + 双检 + 构造期文法断言 + IG-4 步序落链）——**契约层面判据已闭合，代码层按禁改面纪律
留 G2**，与 CS/IDC/DC 三席同一形态。IG-4 步骤①②④属传输层（PoC 无 HTTP 面，条文先行，§4.1 自明），
本席以纯函数复建②③⑦可判部分；④（可信上下文比对）未单独造例。

## 5. 专题⑤ 冻结判据两层化（`g1/G1-FREEZE-CRITERIA.md` + 校验器）—— **部分闭合**（机制全绿，一处文书卫生未闭合）

**本席自造三形副本**（`make_forms.py` 从真实 27 条清单程序化生成，绝不触碰本体；副本落 `.scratch/`）
实测真实退出码：

| 形 | 构造 | 期望 | **本席实测** |
| --- | --- | --- | --- |
| (a) A 全闭 + B 全 open 有归属 | 20 条 A → done（三件套 + 真锚 evidence）；7 条 B open + owner 齐 | **绿** | `--require-clear` **exit 0**（计数行 `违规=0`、`分层 A：open=0 ｜ B：unowned=0`）⇒ 终局门非死闸，M31 同形独立成立 |
| (b) 全部降级 B + 每条真锚 tier_basis + owner 全有主 | 27 条全 `freeze_tier:"B"`、tier_basis 指真实文件:行、status 原样 | **仍红**（A 层非空判据） | `--require-clear` **exit 1**；**唯一阻塞项** = `A 层条目数 = 0（分层被整体抽空）`，违规=0、unassigned=0——红因精确落在抽空判据上（M30 同形），非顺带红 |
| (c) 缺 `freeze_tier` | 27 条全删该字段 | 红 | 日常门 **exit 1**、`--require-clear` **exit 1**；`FREEZE-TIER` ×27 逐条点名；且谓词面缺失条目**按 A 计**（从严规则，§641 注释与实现一致——"删字段即降级"最省事通道被堵） |

配套自验：`--self-test` **31/31 exit 0**（M27–M31 分层族五连本席亲见捕获行）；日常门首行逐字不变
（计数行形态与旧版同构，`分层`行为新增第二行）。机验边界（§7 三面拦不住）契约自述诚实。

**未闭合的一角（判部分闭合的唯一理由，文书卫生级）**：`G1-FREEZE-CRITERIA.md` §2 内三段"实测登记"
（`:44-63`）与 §5 表下/§6 的口径句，最终态停在"夹具已落盘但仍红（ReferenceError exit 1）/A 层机验面红"
——本席实测 `node g1/G1-CONTRACT-COMMIT-SEQUENCE.fixtures.mjs` **exit 0 / PASS 50**（§1 与本席独立探针
双证），即该文件的**最后一段历史实测已被后续事实超过而未加第四次复测注**；它同时是 A 层判据
"专题文书未跟踪不得引用为已闭合"的**登记处自身**（现全部已跟踪，`git status` 无 `??`）。
不判未闭合的理由：判据本体（分层规则、谓词、三形退出码）全部成立且被本席独立复跑坐实；该处是
登记文字的滞后不是规则漏洞（且 CS 契约 §头注已自行并排登记了同一时间线）。但它确属"实测记录未随
事实闭环更新"，与本仓"两段实测原样保留不删 + 追加复测注"的自家纪律差一步 ⇒ **部分闭合**，修复 = 补一段
第四次复测注（分钟级，归冻结判据席位或收编席）。

## 6. 回归（本席亲手全跑，真实退出码）

| # | 命令（均在仓根 `node …/experiments/v3-code-architecture-poc/…` 直跑） | 退出码 / 关键输出 |
| - | --- | --- |
| 1 | `node g1-checklist-validate.mjs`（HEAD 版与并行席漂移版各一次） | **0 / 0**；`违规=0`，分层 `A:20(open=16) ｜ B:7(unowned=6)` |
| 2 | `node g1-checklist-validate.mjs --self-test`（×2 时点） | **0 / 0**；变异自验 **31/31 全部捕获** |
| 3 | `node g1-checklist-validate.mjs --require-clear`（×2 时点） | **1 / 1**（NO-GO 预期红；阻塞 = A 层 open=16 + unassigned=22） |
| 4 | `node g1-checklist-validate.mjs --bogus-arg` | **2**（fail-loud 在位） |
| 5 | CS 夹具 `G1-CONTRACT-COMMIT-SEQUENCE.fixtures.mjs` | **0**；PASS 50/FAIL 0（含 MUT-1 双向自验、T-P1/T-N4 真库行） |
| 6 | 幂等夹具 | **0**；PASS 29/FAIL 0 |
| 7 | DC 夹具 | **0**；52/0，`run_T_N1` + `对照 run_T_N1_legacy` + MUT-DC-1/2 捕获行在案 |
| 8 | IG 夹具 | **0**；PASS 38/FAIL 0 |
| 9 | EA 夹具 | **0**；51/0 |
| 10 | FM 夹具 | **0**；35/0 |
| 11 | RL 夹具 | **0**；60/0 |
| 12 | `node g0-gate.mjs`（后台真跑） | **0**；三条流：身份锚绿 + 作者门 `225 例全绿`（passed/total/passed_sha/files_sha 逐等）+ 审查方基线 `33 条已知红逐等` |
| 13 | `npx tsc -p experiments/v3-code-architecture-poc/tsconfig.json` | **0** |
| 14 | 本席探针四件套（§1–§4 各表） | **0**（15/15、7/7、9/9、42/42）+ 三形门禁（§5）0/1/1 |

**CLI 小形备考（非本轮四项，非回归）**：`--file <相对路径>` 相对**校验器目录**解析（cwd 相对会被
解析到 `experiments/.scratch/…` ENOENT 崩栈 exit 1）——用绝对路径无恙；建议与第八轮"未知位置参数拒收"
同批处理成 cwd 相对或 fail-loud 提示。

## 7. 实跑命令清单（全文）

```
node --version && node -e "…node:sqlite…"                                    # v24.21.0 / SQLite 3.53.4
node .scratch/re-review-g1/probe1-commit-seq.mjs                              # 0（15/15）
node .scratch/re-review-g1/probe2-idem.mjs                                    # 0（7/7；子进程 probe2-child.mjs 真 SIGKILL）
npx vitest run --config .scratch/re-review-g1/vitest.probe.config.ts          # 0（probe3 9/9，vitest 转译绕开 node strip-only 的 parameter-property 限制）
node .scratch/re-review-g1/probe4-grammar.mjs                                 # 0（42/42）
git diff --exit-code d2f19cc..HEAD -- experiments/…/src/contracts/index.ts    # 0（封闭集字节逐等）
python3 .scratch/re-review-g1/make_forms.py                                   # 0（27 条 → 三形副本）
node g1-checklist-validate.mjs --file <abs>/form-a-green.yaml --require-clear # 0
node g1-checklist-validate.mjs --file <abs>/form-b-demoted.yaml --require-clear # 1（唯一阻塞= A 层抽空）
node g1-checklist-validate.mjs --file <abs>/form-c-notier.yaml                # 1（FREEZE-TIER ×27）
node g1-checklist-validate.mjs --file <abs>/form-c-notier.yaml --require-clear# 1
node g1-checklist-validate.mjs / --self-test / --require-clear / --bogus-arg  # 0 / 0(31/31) / 1 / 2（两时点各一遍）
node g1/G1-CONTRACT-{COMMIT-SEQUENCE,IDEMPOTENCY,DOMAIN-COMMAND,IDENTITY-GRAMMAR,EVENT-AUTHORITY,FACET,RELOCATION}.fixtures.mjs
                                                                              # 全 0：50/29/52/38/51/35/60 PASS
node g0-gate.mjs                                                              # 0（225 全绿 + 33 已知红逐等）
npx tsc -p experiments/v3-code-architecture-poc/tsconfig.json                 # 0
sha256sum <被审九文件>（复验前后各一次，见 §8）
```

## 8. 被审文件零改动自证

- 复验开始（HEAD `6e23f34`）与本席收尾逐文件 `sha256sum`：九文件清单见 `.scratch/re-review-g1/sha-start.txt`
  / `sha-end.txt`。**本席写入仅本文件与 `.scratch/re-review-g1/**`。**
- 期间 `G1-RECONCILIATION-CHECKLIST.yaml`（`997bc81…`→`05a5631…`）与其四份姊妹文档转 `M` 均为
  **并行收编席**所为（清单 diff = 4 行 evidence 加注，`git diff` 亲验结构面零动）；
  `G1-CONTRACT-COMMIT-SEQUENCE.md` 的 `M` 在本席开始前的 `git status` 中已存在。本席读判据以
  `git show HEAD:<path>`（哈希 `b9fcfa31…`）+ 工作树双版本对照，凡两版有差处（三处，§0 列明）
  均按 **HEAD 版**下判。

## 9. 读不到的东西

- GitHub PR #42/#44/#47 与远程审查原文（沿仓内转录，`G1-RECON/台账`口径）。
- PR-4/PR-9/PR-11 的落地实现（G1 契约阶段不存在，属预期非缺陷）。
- 传输层 HTTP 面（IG-4①②④ 的宿主侧实跑）、真 DDL/`SCHEMA_VERSION` 推进后的打开期 I-1/I-3/I-4/I-5
  实装（契约 §0.5/§1.6 归 G2）——本席以夹具形/纯函数形复现其判据语义，未冒充实装验证。
- `docs:check`/CI（本地无 GitHub CI；沿各席"未完成 CI 验收"声明口径）。

## 10. 六句回报（口径版）

1. **① 闭合**——契约谓词（提交归属截点）在本席真库探针下枚举一切截点**切不出中间态**，被禁谓词同库
   立刻切得出；回滚无 ghost、回拨只不变或前移，全部亲跑。
2. **② 闭合**——真 SIGKILL 崩溃五 kill 点穷举下两窗口**不可观测**且判别力配对全红；并发同键持锁形态
   恰 1 修订、事务外查键必造第二修订；真库对应物归 PR-9（契约自登记，核在位）。
3. **③ 闭合**——自扫可达集：目标装配 ∩ 禁名单 = ∅，legacy 装配判红与契约"今天在哪"逐位相符；
   "归属合法+领域违规"载荷在 legacy 形创建成功、在目标链必拒零残留，夹具 legacy 对照实测为真。
4. **④ 闭合**——自造 42 例（超长/折叠/NFC/%/NSR-/冒号）判据全按契约所述拒/放；`src/contracts/index.ts`
   自锚 `d2f19cc` 字节逐等 ⇒ RefusalCode **零新增**实证。
5. **⑤ 部分闭合**——三形实测退出码 0/1/1 精确命中（绿须 A 全闭+B 有主、抽空必红、缺字段必红）、
   self-test 31/31；唯一未闭合角 = 判据件 §2/§5 的 A 层实测登记文字停在"夹具红"旧事实，缺第四次复测注。
6. **回归全绿**——validator 0、self-test 0（31/31）、`--require-clear` 1（NO-GO 预期红）、坏参数 2、
   七夹具 0（50/29/52/38/51/35/60）、g0-gate 0（225 全绿+33 已知红逐等）、tsc 0；G1 冻结仍 NO-GO，
   Current 冻结面零接触。
