# G1 契约补正 · 专题② — 永久幂等账与领域事务的原子提交边界

> 状态：**Draft（本席位产出，待并入 `G1-UNIFIED-CONTRACTS.md` 评审；本席不改任何他席文件）**
> 席位：G1 补正专题②（前席未产出任何文件即结束，本席重做）。分支 `g1/contracts-20261031`。
> 纪律：只新建本文件与同目录 `G1-CONTRACT-IDEMPOTENCY.fixtures.mjs`；不改 `g1/` 既有文件、清单/校验器、
> `g0-gate.mjs`、`src/**`、`tests/**`、`attacks/**`、`CONTRACTS.md`、`READINESS.md`、
> `IMPLEMENTATION-PLAN-DRAFT.md`、`docs/**`、冻结面。**模型形条款**：不写生产 DDL/代码；
> 真库对应物登记为后续 PR（§8）。夹具：`node G1-CONTRACT-IDEMPOTENCY.fixtures.mjs`，零依赖，退出码即结论。
> 跨分支引用一律带 SHA（§9 引用账本）；仓内锚 SHA=`d2f19cc`。

## 0. 问题陈述与现状

SI-41（#47 `37de107ed5`，IF:93）裁定幂等键**对首次结果永久绑定**：「同一键的重复请求必须返回首次结果且
不产生第二条记录/第二个修订」「键相同但请求体摘要不同 → 不是重放，必须拒绝（`TOOL_INPUT` +
`detail{serviceCode:"IDEMPOTENCY_KEY_REUSED", step:"client_request_id"}`）并**不产生任何记录**」「去重窗口只是
**缓存**策略而非语义边界……**不得当作新请求**」；测试钉：「把窗口配置调小后重放，仍必须返回首次结果且零新记录」。
X-1（ADJ:78）裁「幂等层唯一责任者 = 接口/宿主工具面（我方契约层），不进机制存储语义：机制外账本存四元组键 +
首次请求体摘要，**永久保存非窗口化**」。X-2（ADJ:79）裁本仓账本「只存不透明 {alg, hex} 并做等值比较，
**不重算摘要**」，冲突拒绝「按 blob 原文码 `IDEMPOTENCY_KEY_REUSED` 只进工具 detail」。
而 `src/**` 现状（grep 实测）：**没有任何按请求的幂等账本**——`store/types.ts`、`store.ts`、`flooding/**`
的「idempotent」全部是 `close()`/DDL `IF NOT EXISTS` 的重入语义，与写幂等键无关。
`G1-RECON-PR47.md` §8.6 把 SI-40/41/42/43 判「与本 PoC 无对应面」——本席即该缺口的落点。

未决的正是**提交边界**：幂等回执（键+摘要+首次结果引用）与领域写入若分两次持久化，存在两个经典崩溃窗口
（键在业务不在 / 业务在键不在）；若同一次提交，须与 X-1「机制外账本」相容并说明与 Q40 的关系。

## 1. 裁定：回执与领域写入同一 ResearchSpace 原子提交（IDC-1 … IDC-3）

**IDC-1（提交边界唯一形）** 持有幂等键的写命令，其幂等回执行与全部领域效果（领域权威状态/事件、
Directory、H Ledger、Change Journal，Q40 语汇）**必须落在同一次 ResearchSpace 原子提交**内，
不存在第二种合法持久化形态。空间即文件/事务边界（P1，`G1-UNIFIED-CONTRACTS.md` §P1「空间是**文件/事务边界**」），
故回执行落在该 Space 文件的接口面表内；一次提交 = 一个 SQLite 写事务（`src/host/persistence/store/store.ts:316`
`BEGIN IMMEDIATE … COMMIT`，WAL 恢复「either pre- or post-transaction, never partial (kill -9 tested)」，:29-31）。

**IDC-2（责任者与提交边界两分，承接而非改写 X-1）** X-1 的「机制外账本」裁定的是**语义归属**
（表主、写者、读者都在接口/宿主工具装配层，机制零读写），**不是物理提交边界**；本条把后者补足：
装配层打开（或加入）本次领域写事务后，**在同一条事务内**先做幂等判定、后追加回执行。
X-1 的「先幂等、后机制」读作**同事务内判定顺序**，禁止读作「键行先单独提交」——后者恰是被否决的两段提交（IDC-3）。
机制语义零穿透不变量（INV-4）：域/机制代码路径零读写、零解释回执行；G2 落静态门（`src/**` 机制面不得引用
回执表名，§8 真库对应物）。

**IDC-3（否决「独立账 + 恢复协议」，附不可判定性论证）** 备选形态「回执在领域提交之外独立持久化 +
崩溃恢复协议」被**否决**，理由按可证明性等价要求逐条：

- **不变量集**（两方案都须满足）：INV-K（同键同体任意时刻重放 ⇒ 返回首次结果、零新记录/新修订）、
  INV-R（同键异体 ⇒ 拒且零记录）、INV-N（无孤儿键：回执 ⇒ 领域效果存在；INV-N'：无孤儿效果：
  带键请求的已提交领域效果 ⇒ 回执存在）。
- **窗口 B（业务在键不在）在独立账下不可判定**：崩溃发生在「领域提交后、键写入前」，则重试请求到达独立账时
  键缺失；独立账**无法区分**「已提交请求的网络重试」与「字节相同的新请求」——两者键、体、序完全一致，
  任何仅凭账本与到达顺序的恢复协议都没有判定依据。判为前者 ⇒ 需要领域侧告知效果引用 ⇒ 相关性事实必须进
  领域提交 ⇒ 键/回执进入机制存储语义，违 X-1/SD-14 责任边界；判为后者 ⇒ 重放产生第二个修订，直接违
  SI-41 首句与「重试造成双修订是缺陷」。故独立账形态**不存在可证明等价的恢复协议**。
- **同提交形态的证明**：前提仅一条——存储单提交原子性（store.ts WAL 实证 + Q40「全成或全回滚」）。
  任意崩溃点后的稳定状态 ∈ {提交前态, 提交后态}：提交前态 ⇒ 键行与领域效果**同缺** ⇒ 重放按新请求合法执行
  （零残留，INV-K/R/N/N' 成立）；提交后态 ⇒ 键、摘要、结果引用**同在** ⇒ 重放命中回首次结果。
  两个窗口都只存在于日志中间态，不落入任何可观测的稳定 Space 状态集 ⇒ **两窗口对外不可观测**（证毕，
  夹具 T3/T4 以任意 kill 点穷举复核，§5）。
- 结论取同提交：保证更强（两窗口不可观测 vs 需恢复协议事后弥合）、依赖前提更少（一条 vs 一套状态机 +
  领域侧相关性通道）、且不触碰 X-1 的机制边界。

## 2. 数据形状、冲突判定顺序、与 CommitSequence 的关系（IDC-4 … IDC-7）

**IDC-4（幂等记录数据形状，模型形）** 回执行 `IdempotencyReceipt`（Space 文件接口面表；契约形状示意，非 DDL）：

「interface IdempotencyReceipt {
   // —— 键（SI-41 四元组，缺一即不是同一个键）——
   readonly actorRef: ActorRef;         // USER→actor.user_id / AGENT→actor.run_id（SI-41 原文粒度）
   readonly spaceId: SpaceId;           // 与文件同值（行内恒等分量）；修订类不带 space_id 时取
                                        //   可信上下文注入值参与构键（SI-16a 通道，X-1 处置列），
                                        //   不得从 object_id 推导
   readonly operation: string;          // 归一化操作名
   readonly clientRequestId: string;
   // —— 摘要（X-2：不透明，仅等值比较，不重算）——
   readonly requestDigest: { readonly alg: string; readonly hex: string };
   // —— 首次结果 ——
   readonly resultRef: ResultRef;       // 领域引用（oid@revision / record_id）；追加型域内永久可解析
   readonly responseSnapshot: Uint8Array; // 首次响应字节快照，重放逐字节回吐
   readonly commitSequence: CommitSequence; // 首次提交 c1；由专题①唯一发号点产出（DEP-①-1）
   readonly recordedAtMs: EpochMs;      // 同提交时间戳，仅供 echo；禁排序/判等（D2-c）
   readonly rowSchemaVersion: number;   // 各行自带写入版本（SF-60 同形），读侧可读所有历史行形
 }」

唯一索引 = 四元组全体（键行**永久不删**，INV-K 的最小承载）；回执行提交后**永不改写**（追加型域同 SI-40，INV-5）。

**IDC-5（冲突判定顺序：取证 → 解析 → 摘要比对 → 前置）** 封闭四步，序即判据：

1. **取证**：`actor_ref`、修订类的 `space_id` 由可信调用上下文注入（SI-16a）；`actor_ref` 缺失 ⇒
   **不入账不查账**，直送机制，每次产生新记录（SI-41「宁可重复，不可吞掉一次真实登记」）。
2. **解析**：四元组归一构键；键集不全（含四元组任一字段缺失）⇒ `TOOL_INPUT` 拒，零账本写。
3. **摘要比对**（必须发生在写事务持锁窗口内，见 IDC-7/矩阵 M5）：查唯一索引——
   命中且 `requestDigest` 等值 ⇒ **重放**：逐字节回吐 `responseSnapshot`，零领域读、零新记录；
   命中且摘要不等 ⇒ 拒 `TOOL_INPUT + detail{serviceCode:"IDEMPOTENCY_KEY_REUSED", step:"client_request_id"}`，
   **零任何记录**——「任何记录」含回执行本身：既有回执行不改写、不新增（X-2 按 blob 码名，
   旧名 `IDEMPOTENCY_BODY_MISMATCH` 名不符 blob，沿用勘误）；
   未命中 ⇒ 进入第 4 步。
4. **前置**：SI-42/X-3 乐观前置（`expected_head_revision` 不匹配 ⇒ 拒写、**不写键行**、零残留，
   对外暂态码维持 SI-24 形态）；前置通过 ⇒ 同事务执行领域写 + 追加回执行（IDC-1）。

推论：被拒请求（第 2/3/4 步任一）**不占用键**——修正后同键重发是新请求，其首次成功才绑定「首次结果」。

**IDC-6（重放呈现截点 = 首次提交 c1；登记为对专题①的依赖）** 重试返回的首次结果按**首次提交
`commit_sequence` c1 的截点**呈现，不按重放时刻现读：SI-41「任意时刻的字节相同重放都必须返回首次结果」
⇒ 首次结果是**历史回显**而非当前读。主路径**逐字节回吐 `responseSnapshot`，不经截点解析**；
截点仅两处使用——(a) echo 三键的 `resolved_cutoff` 直接取回执行 `commitSequence`，
(b) 快照归档后重展开时按 c1 解析 `resultRef`（§6/IDC-10）。**依赖登记（不改他席文件，回填清单见 §7）**：

- **DEP-①-1**：回执行 `commitSequence` 字段取值 = 专题①唯一发号点的产出（P5 `appendAuthoritativeEvent`
  返回 `CommitSequence` 同形）；本契约不定义发号器、时钟与线格式（`commit_sequence` 线名归属见汇编 §0.3）。
- **DEP-①-2**：重放呈现**不做 `recorded_at` 截点重算**，直接取 c1（与 D2-c「截点比较只走 commit_sequence」
  同向）；若专题①未来引入「跨提交时间戳重排」形态，须回填说明 c1 截点解析的稳定性不受影响。
- **DEP-①-3**：`resultRef` 在 c1 截点的可解析性 = 专题①历史面承诺（SF-60/62「历史记录以原版本永远可读」）；
  本契约的重启语义（§6）以之为前提。

**IDC-7（判定必须在写事务持锁窗口内）** 第 3 步的「查索引」与第 4 步的「写键行」必须在**同一条**
`BEGIN IMMEDIATE` 写事务的持锁窗口内完成（store.ts:319「BEGIN IMMEDIATE holds the write lock」）。
事务外先读后写被禁止：那是 TOCTOU 窗口，并发同键会产生两个修订（夹具 MUT-IDEM-2 证红）。
并发同键同体 ⇒ 后到者在事务内见先到者已提交键行 ⇒ 走重放支路；并发同键异体 ⇒ 后到者走 REUSED 支路。

## 3. 崩溃矩阵（IDC-8；9 格 ≥ 6）

| # | 场景 | 可达性 | 恢复动作 | 对外可观测结果 | 夹具 |
|---|---|---|---|---|---|
| M1 | 键在、业务不在 | **不可达**（IDC-1 同提交 ⇒ 非稳定状态，仅日志中间态） | 无需；审计若见 ⇒ 账本损坏 ⇒ Space fail-loud 置只读、人工对账，禁自动补写 | 无任何形态使重放被误导（回不存在的「首次结果」） | T4；MUT-IDEM-1 下此格显形⇒红 |
| M2 | 业务在、键不在 | **不可达**（同上） | 同上；此格正是独立账方案被否决的原因（IDC-3 窗口 B 不可判定） | 无「重放写第二修订」形态 | T4；MUT-IDEM-1 |
| M3 | 提交中被杀 | 可达（崩溃常态） | WAL 恢复 ⇒ 提交前态（键与业务**同缺**）；重放按新请求合法执行，零残留 | 重试成功且恰好 1 修订；或落提交后态 ⇒ 重放回首次结果零新记录。两形态均合 SI-41 | T3 |
| M4 | 摘要不同的重放 | 可达（非崩溃） | 无恢复动作：拒 `TOOL_INPUT + detail{serviceCode:"IDEMPOTENCY_KEY_REUSED", step:"client_request_id"}` | 零任何记录（含键行）；既有回执不改写 | T2 |
| M5 | 并发同键（同体 / 异体） | 可达 | 写锁串行化（IDC-7）：后到者事务内命中已提交键行 | 同体 ⇒ 恰 1 修订 + 后到者逐字节首次结果；异体 ⇒ 后到者 REUSED 零记录 | T5 |
| M6 | 跨 Space 同键 | 可达 | 无：键含 `space_id` 分量且文件=Space 边界（P1） | 两 Space 各 1 记录互不干扰；各自重放命中各自回执（SI-41「把范围补齐」正例面） | T6 |
| M7 | 快照已归档后重放 | 可达（运维态） | 键+摘要命中 ⇒ 按 c1 截点从 `resultRef` 重展开响应；重展开失败 ⇒ fail-loud，**不伪造首次结果、不回空** | 语义等价首次结果（引用不变性保证）；绝不落「当新请求」 | T7 |
| M8 | `actor_ref` 缺失的请求 | 可达 | 不入账不查账直送机制（IDC-5 步骤 1） | 两次同字节请求 ⇒ 2 条记录（合法：宁可重复不可吞掉）；账本零行 | T8 |
| M9 | 前置不匹配后同键重发 | 可达 | 被拒尝试不写键行（IDC-5 步骤 4）⇒ 修正后重发为新请求 | 被拒尝试零残留；首个成功者绑定首次结果 | T9 |

## 4. 两个经典窗口 → G2 测试前提（IDC-9 / IDC-10）

**IDC-9** 两窗口在 G2 落为**可执行断言形状**（契约形状，真库对应物 = kill -9 实库事务中途，
先例 TC-DB-003；本夹具以模型形实现同判据）：

「// W1 无孤儿键（键在业务不在 ⇒ 不可观测）
 for 每个 killPoint ∈ killPoints(request(req)):
   S = recover(run(space, req, { killAt: killPoint }))
   assert ∀ k ∈ S.ledger: resolve(S.domain, k.resultRef) ≠ null        // 无孤儿键
   assert replay(S, req) ⇒ 命中则逐字节 == 首次响应；未命中则执行且恰新增 1 修订
 assert Σ 所有 killPoint: orphanKeys(S) = 0

 // W2 无孤儿效果（业务在键不在 ⇒ 不可观测）+ 重放零新增
 for 每个 killPoint ∈ killPoints(request(req)):
   S = recover(run(space, req, { killAt: killPoint }))
   assert ∀ e ∈ S.domain: origin(e) = key(req) ⇒ key(req) ∈ S.ledger   // 无孤儿效果
   S2 = replay(S, req)
   assert revisions(S2.domain) = revisions(S.domain)                    // 重放零新记录
 assert Σ 所有 killPoint: orphanEffects(S) = 0」

killPoints（模型形穷举）：取证前 / 构键后暂存中 / 领域效果暂存后·提交应用前 / 提交应用中 / 提交应用后
（最后一个 = 重放断言的常规态）。断言的 SI-41 测试钉对应面：「把窗口配置调小后重放仍返回首次结果」在夹具
以「无任何窗口配置存在」实现——本契约无窗口概念（INV-3），调窗参数不存在即钉自动满足（登记，§8）。

**IDC-10（架空式变异纪律）** 夹具常驻两条架空判据（「架空不删除」，同 FACET 夹具纪律）：

- **MUT-IDEM-1（两段提交）**：把 IDC-1 原子判据替换为「先提交领域、再独立提交键行」，在两段之间注杀
  ⇒ W1/W2 断言**必红**（M1/M2 格显形：孤儿键可回吐不存在的首次结果；孤儿效果使重放写第二修订）。
  夹具反向自检：若架空判据下断言仍全绿 ⇒ 断言无判别力 ⇒ 夹具整体判红（exit 1）。
- **MUT-IDEM-2（事务外查键）**：把 IDC-7 持锁窗口内判定替换为「事务外读索引→开事务写入」，并发同键
  场景产生 2 修订 ⇒ T5 必红；同样反向自检。

## 5. 不变量与证明要素（汇总）

- **INV-1 同提交全有全无**：带键写命令的全部持久效果 ∈ 一条 Space 事务（IDC-1，Q40 不破）。
- **INV-2 双向无孤儿**：稳定态上 `ledger → 可解析 resultRef` ∧ `带键领域效果 → 键行存在`（IDC-3 证）。
- **INV-3 键永久**：四元组唯一索引行永久不删、不窗口化；「去重窗口只是缓存策略而非语义边界」（SI-41/SD-14）。
- **INV-4 机制零穿透**：回执表为接口面专属，机制/域代码零读写零解释（X-1；G2 静态门）。
- **INV-5 回执不可改写**：回执行提交后只读；重放 = 只读快照回吐。
- **INV-6 拒写零残留**：任何拒绝支路（键集不全 / 摘要冲突 / 前置不符）⇒ 键行与领域效果同零（SI-41/SI-42）。

## 6. SI-41「永久」与账本不膨胀的兼容法（IDC-11）

**IDC-11（三层分置）** 「永久绑定首次结果」的**语义最小集 = 键索引 + 摘要 + 结果引用**，三者**永久热存**
（定长收敛：四元组 + {alg,hex} + 引用 + 序号 + 版本，与请求体大小无关）；`responseSnapshot` 字节体是
**可分层数据**（热→冷，**永不删除**）。兼容论证：

- **保留什么（永不动）**：四元组唯一索引、`requestDigest`、`resultRef`、`commitSequence`、
  `rowSchemaVersion`。丢了键或摘要 ⇒ 同体重放「当作新请求」或异体冲突不可判 ⇒ 直接违 SI-41 首句。
- **可归档什么**：仅 `responseSnapshot` 的**存储位置**（冷层/内容寻址——同 `resultRef` 同 c1 的响应字节确定，
  可按内容共享）。归档不是语义事件：命中路径「键+摘要 ⇒ 重放」不变；M7 支路按 c1 从 `resultRef` 重展开，
  域是追加型（SI-40）且历史版本永远可读（SF-60/62）⇒ `resultRef → 首次结果` 是**永久可重建函数**，
  「永久绑定」由引用不变性承载，不靠字节常驻。重展开失败 = 历史面故障（违 SF-60），走 fail-loud，
  不归因幂等层。
- **禁做清单**：删/合并/摘要化键行；清 `requestDigest`；任何 TTL/窗口过期语义；改写 `responseSnapshot`；
  「超窗 = 新请求」（SI-41 已裁首句优先）；把冷层当拒绝理由把重放放行为新请求。
- **不膨胀论证**：账本增速 = O(带键成功写次数)，与领域记录同阶（每成功写恰一行，零重试放大——
  重放不增行，M3/M5 保证）；行宽定长；大头（响应体）外指内容寻址冷层，域内本已持有同内容 ⇒ 零双份。
- 窗口参数若实现期引入，只能作为**缓存命中提示**（如热层保留集裁剪），其任何取值不得改变重放结果——
  SI-41 测试钉「把窗口配置调小后重放，仍必须返回首次结果且零新记录」以「语义面参数不存在」为最强实现。

## 7. 需他席回填清单（登记，不改他席文件）

| # | 对象 | 请求 |
|---|---|---|
| DEP-①-1 | 专题①（CommitSequence） | 回执行 `commitSequence` = 专题①唯一发号点同事务产出；确认 P5 返回值可直接落回执行 |
| DEP-①-2 | 专题① | 确认 c1 截点解析不做 `recorded_at` 重算（与 D2-c 同向）；若引入时间戳重排形态须回填说明 |
| DEP-①-3 | 专题①/历史面 | 确认 `resultRef` 在 c1 截点永久可解析（SF-60/62 承接面）——M7/§6 的前提 |
| DEP-汇编-1 | `G1-UNIFIED-CONTRACTS.md` 席位 | 并入时核对：本契约**零新增 Port RefusalCode**（`IDEMPOTENCY_KEY_REUSED` 是 `TOOL_INPUT` 的 `detail.serviceCode`，工具 detail 面，非 §2.10 码表；与 §2「封闭集纪律」相容） |
| DEP-PR9-1 | `G2-DEV-PLAN.md` PR-9 席位 | PR-9「幂等层前置（X-1/X-2/X-3）」的执行序 = 本契约 IDC-5/IDC-7；夹具 T1–T9 与 MUT-IDEM-1/2 登记为其测试前提（§8 真库对应物列） |

## 8. 真库对应物登记（后续 PR，本文件零生产 DDL/代码）

- 回执表 DDL（Space 文件内接口面表 + 四元组唯一索引）：后续 PR，附 `Frozen-Face-Review` 评估（若触冻结面）。
- 写面改造：工具写操作装配层在同一 `BEGIN IMMEDIATE` 写事务内加「查键→写键行」步骤（store.ts 写事务
  ①seq→②validate→③events→④derived_state→⑤realize 链上插入点与序，评审随 PR）。
- T3/M3 真库形态 = 实库事务中途 `kill -9` + WAL 恢复复跑（TC-DB-003 先例，store.ts:29-31）；
  T5 = 双连接并发同键；T6 = 双 Space 文件；T7 = 冷层桩。
- 静态门：`src/**` 机制/域模块 import 面与 SQL 文本零引用回执表名（INV-4）。
- SI-41 测试钉（调窗重放）落真库时 = 以「窗口配置项存在但只影响热层命中统计、逐字节断言重放响应不变」实现。
- 夹具→真测试映射：T1..T9 + MUT-IDEM-1/2 ↔ G2 测试前提清单（DEP-PR9-1）。

## 9. 引用账本（文件 + 规则号 + 短句 + SHA）

| 锚 | 出处 | 短句 | SHA |
|---|---|---|---|
| SI-41 | #47 `docs/architecture/H_S_R_INTERFACE_FOUNDATIONS_DRAFT.md` IF:93 | 「幂等键是四元组……键对首次结果永久绑定……去重窗口只是缓存策略而非语义边界……不得当作新请求」；拒绝形态「`TOOL_INPUT` + `detail{serviceCode:"IDEMPOTENCY_KEY_REUSED", step:"client_request_id"}`」 | `37de107ed5` |
| SI-40 | 同文 IF:92 | 「写操作只有追加效果……没有就地改写」 | `37de107ed5` |
| SI-42 | 同文 IF:94 | 「不匹配 → 拒绝写入，不产生记录（乐观前置）」 | `37de107ed5` |
| SD-14 | #47 `docs/architecture/H_S_R_SCHEMA_DECISIONS_DRAFT.md` SD:24 | 「键对首次结果**永久绑定**，去重窗口只是缓存策略、超窗重放也不得产生新记录」 | `37de107ed5` |
| SF-60/62 | #47 `docs/architecture/H_S_R_SCHEMA_FOUNDATIONS_DRAFT.md`（R-12/R-13 承接，RL:55-56 行） | 「读侧必须能读取所有历史版本」「破坏性变更绝不回溯……历史记录以原版本永远可读」 | `37de107ed5` |
| Q40 | #44 `docs/architecture/V3_CODE_ARCHITECTURE_DRAFT.md` §7.3 L242 | 「一次原子提交：领域权威状态/事件、Directory、H Ledger、Change Journal 全成或全回滚。未提交的 ID 对其他事务不可见」 | `5ec38974fc` |
| X-1 | `g1/G1-ADJUDICATION-TABLE.md` :78 | 「幂等层唯一责任者 = 接口/宿主工具面……机制外账本……永久保存非窗口化；Port = 工具写操作装配层（先幂等、后机制）」 | 仓内 `d2f19cc` |
| X-2 | 同表 :79 | 「本仓幂等账本只存不透明 {alg, hex} 并做等值比较，不重算摘要；冲突拒绝按 blob 原文码 `IDEMPOTENCY_KEY_REUSED` 只进工具 detail」 | 同上 |
| X-3 | 同表 :80 | 「不匹配 ⇒ 拒写零残留；对外失败码……维持 SI-24 暂态，本仓不自造 F-* 码」 | 同上 |
| P1 | `g1/G1-UNIFIED-CONTRACTS.md` §P1 | 「空间是文件/事务边界（§16 首表）」 | 同上 |
| P4 | 同文 §P4 | 「Q40（单 Space 原子事务，全成全回滚）不破且永不破（裁决 §5 未重开清单）」 | 同上 |
| D2-c | 同文 §7 表「墙钟回拨」行 | 「截点比较只走 commit_sequence；`recorded_at` 禁排序/去重/判等」 | 同上 |
| 现状 | `src/host/persistence/store/store.ts` :29-31, :316, :319 | 「ONE SQLite transaction……mid-transaction crash leave the DB either pre- or post-transaction, never partial (kill -9 tested)」；「BEGIN IMMEDIATE holds the write lock」 | HEAD（本分支） |
| 缺口 | `experiments/v3-code-architecture-poc/G1-RECON-PR47.md` :378 | 「SI-40/41/42/43（幂等/乐观前置/批量）判为『与本 PoC 无对应面』」 | 同上 |
| PR-9 | `g1/G2-DEV-PLAN.md` :309 起 | 「幂等层前置（`X-1` 乐观并发码 + `X-2` 不透明幂等 token 三要件 + `X-3` 码表定名）」 | 同上 |

## 10. 夹具对账表

| 夹具 | 判据 | 契约条 |
|---|---|---|
| T1 | 同键同体重放 3 次 ⇒ 恰 1 修订 + 逐字节首次结果 | IDC-5/INV-K |
| T2 | 同键异体 ⇒ REUSED 码 + 零记录 + 回执行不改写 | IDC-5/M4 |
| T3 | 提交中各 kill 点 ⇒ 恢复后重试成功恰 1 修订 或 命中首次结果 | IDC-1/M3 |
| T4 | 任意 kill 点穷举 ⇒ 双向无孤儿（W1+W2） | IDC-3/IDC-9 |
| T5 | 并发同键同体/异体 ⇒ 持锁窗口内串行判定 | IDC-7/M5 |
| T6 | 跨 Space 同键互不干扰 | M6 |
| T7 | 快照归档 ⇒ 按 c1 从引用重展开；历史不可读 ⇒ fail-loud | IDC-11/M7 |
| T8 | actor_ref 缺失 ⇒ 不入账、宁可重复 | IDC-5/M8 |
| T9 | 前置失败零键行；修正后同键重发成功 | IDC-5/M9 |
| MUT-IDEM-1 | 两段提交 ⇒ W1/W2 断言必红；不红则夹具自红 | IDC-10 |
| MUT-IDEM-2 | 事务外查键 ⇒ 并发场景必红；不红则夹具自红 | IDC-10 |
| D1..D5 | 与本文档静态对账（拒绝码名、勘误名缺席、矩阵行数、IDC 条数、DEP 行数、无新码表码） | 全文 |
