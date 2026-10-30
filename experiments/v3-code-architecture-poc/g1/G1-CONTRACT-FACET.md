# G1 契约正文 — Facet 双身份与挂载契约（G1-FACET-01）

> 状态：**规范性契约正文（可实施、可写测试）**，2026-11-01 起草于分支 `g1/contracts-20261031`
> （仓内侧车引用以工作树行号为准；`G1-ADJUDICATION-TABLE.md` 按工作树版引用）。本文件把
> `G1-CONTRACT-DESIGNS.md` 节 A（含 A.8 第六轮裁定）**升为正文**；DESIGN 节 A 与其附三原文保留不删
> （附三纪律：更正以追加留痕，不静默覆盖）。本文件不是机制代码：所有 TS 形状与表形状是
> 「先契约后机制」的「先」（§16 先例 / D-20 先例），实现批按本文落 `src/**` 与 G2 DDL。
> 事件与见证形状**复用** `G1-CONTRACT-EVENT-AUTHORITY.md`（下称 EA 契约）的 EA-1/EA-2/EA-3/EA-4
> 既有形状，本文件不另造事件、不另造信封、不扩拒绝码封闭集。
> 夹具（与本合同同批、互相对账）：
> 「node experiments/v3-code-architecture-poc/g1/G1-CONTRACT-FACET.fixtures.mjs
> 退出码 0 = 契约结构自洽（含与 EA 契约正文/夹具的跨文件形状对拍）+ 正反例全命中 +
> 三条「架空判据」变异全部被捕获；1 = 有任一项 FAIL；2 = 夹具无法运行。」
> 平面声明（EA §0.1 同型）：本合同只裁 **V3 机制侧车（本 PoC）** 的 Facet 挂载与双身份面。
> V1 冻结面（`ARCHITECTURE.md` §7.2、`schema/**`）与 #47 HSR 层各有其文；#47 七文件对
> 「Facet/挂载」**零条文覆盖**（§0.3 F-14 实测），故本合同对 #47 的引用只有「条件式间接锚」与
> 「未覆盖」两档，**不写「属 #47 决策面」**（附三 F-1/F-2 教训 + 裁决表 D5-a「此后禁止」句）。
> 凡本文写「归 X 裁定」都给条文锚；给不出的写「未决 + 指名裁定人」。
> 禁改清单沿用席位任务书：本文件与同目录夹具之外的任何文件本席不改。

---

## 0. 引用与平面纪律

### 0.1 三个平面（沿 EA §0.1，不重开）

| 平面 | 本合同的关系 |
| --- | --- |
| V1 冻结面（根文档 + `schema/**`） | 不触碰；本 PoC DDL 在侧车、不在冻结 `schema/**`（CONTRACTS §16.2 存储面段既有句） |
| #47 HSR Schema 层 | Facet/挂载**零条文覆盖**（F-14 实测），无辖域主张可让；间接锚一律条件式 |
| V3 机制侧车（本 PoC `src/**`） | 本文即该面 Facet 挂载与双身份的冻结文本；事件命名与签发面归 EA 契约（本文复用） |

### 0.2 引用格式

每条引用给「文件 + 规则号/小节 + 原文短句 + SHA」。跨分支条文经
「git show <sha>:<path>」对 blob 原文核验：#42 = `0369c3196c`、#44 = `5ec38974fc`、
#47 = `37de107ed5`。**#47 引用一律条件式**（条件：#42 合并且条文文本不变；沿 `G1-RECON-PR47.md` §0
固定注记与裁决表表头）。**未取得项：无**；「未覆盖」不是「未取得」——F-14 为全库检索实测。

### 0.3 引用清单（正文以 F-xx 指代）

| # | SHA | 文件 | 规则号/行位 | 原文短句 |
| --- | --- | --- | --- | --- |
| F-01 | `5ec38974fc` | `docs/architecture/V3_CODE_ARCHITECTURE_DRAFT.md`（L200-204，#44） | §6.2（Q45） | 「Facet 是面向一个已存在对象的独立领域扩展记录，不是五类以外的新基础对象类别」「基础对象的身份、`object_kind`、核心修订及其身份构成字段只有**主 Capability** 写；Facet 只有自己的数据、记录标识、版本与生命周期权威」 |
| F-02 | `5ec38974fc` | 同 F-01 `docs/architecture/V3_CODE_ARCHITECTURE_DRAFT.md`（L205，#44） | §6.2 | 「记录可按 `ObjectRef` 挂载并用于 UI 导航；当扩展信息属于正式科研主张、检查或历史引用时，**必须精确绑定 `RevisionRef` 或其合法记录引用**，不能隐式 latest」 |
| F-03 | `5ec38974fc` | 同 F-01 `docs/architecture/V3_CODE_ARCHITECTURE_DRAFT.md`（L206，#44） | §6.2 | 「**禁止平行复制**……不能由私有字段重新定义 Proposition 的真值条件（RD-15、RD-37、XC-28）」 |
| F-04 | `5ec38974fc` | 同 F-01 `docs/architecture/V3_CODE_ARCHITECTURE_DRAFT.md`（L207，#44） | §6.2 | 「不能把 Facet 记录 ID 冒充科研对象 ID（RF-05/RF-06）」 |
| F-05 | `5ec38974fc` | 同 F-01 `docs/architecture/V3_CODE_ARCHITECTURE_DRAFT.md`（L208，#44） | §6.2 | 「Facet 缺席/升级失败只让依赖该扩展的能力降级，不能使基础对象消失或被改写。Facet 自己需要 H 追溯和权限保护」 |
| F-06 | `5ec38974fc` | 同 F-01 `docs/architecture/V3_CODE_ARCHITECTURE_DRAFT.md`（L325，#44） | §11 | 「Facet 也有自己的 Schema/记录版本，不能覆盖对象核心 Revision」 |
| F-07 | `5ec38974fc` | 同 F-01 `docs/architecture/V3_CODE_ARCHITECTURE_DRAFT.md`（L329-330，#44） | §11 | 「拆包或迁移插件只改变 `PluginID` 对某 `CapabilityID` 的实现映射，不改变 ObjectID/RevisionRef」「Facet 可独立迁移、失效和恢复」 |
| F-08 | `5ec38974fc` | 同 F-01 `docs/architecture/V3_CODE_ARCHITECTURE_DRAFT.md`（L173、L193，#44） | §5.2/§6 贡献表 | 「正式声明、论证输入/结论、评价/接纳目标、检查对象引用精确 `RevisionRef`（RD-05）」「Facet Contribution＝独立 Capability 拥有的扩展记录，明确所挂接对象与相应修订/解释契约」 |
| F-09 | `0369c3196c` | `H_S_R_DECISIONS_AND_GAPS_DRAFT.md`（L43，#42） | RD-05 | 「正式声明位置（论证输入/结论/条件、评价目标、接纳目标、检查对象）**只允许精确引用**；『跟随当前』仅限浏览与非规范选择」 |
| F-10 | `0369c3196c` | 同 F-09 `H_S_R_DECISIONS_AND_GAPS_DRAFT.md`（L39，#42） | RD-01 | 「`object_kind` 与 `space_id` 创建即固定且不可变」 |
| F-11 | `0369c3196c` | 同 F-09 `H_S_R_DECISIONS_AND_GAPS_DRAFT.md`（L53、L75，#42） | RD-15 / RD-37 | 「来源关系只登记一次为来源记录」「使用语境存回 Entity 会恢复双真源」 |
| F-12 | `0369c3196c` | `H_S_R_DOMAIN_FOUNDATIONS_DRAFT.md`（L123-124，#42） | RF-05 / RF-06 | 「不能直接充当 Association 的参与端点或论证的输入角色端点」「原始记录成为证据的合法路径是对象化，不是放宽端点类别」 |
| F-13 | `0369c3196c` | 同 F-12 `H_S_R_DOMAIN_FOUNDATIONS_DRAFT.md`（L155，#42） | SP-09 | 「空间写权限与业务授权是两件事……未生效声明……对目标空间无写权限 → 请求被拒绝」（EA C-07 同位） |
| F-14 | `37de107ed5` | `H_S_R_*_DRAFT.md` 七文件（#47） | 全库检索实测 | 「Facet/facet/挂载/mount」对 #47 全部七文件 **零命中** ⇒ Facet/挂载面 #47 条文**未覆盖**；本行不是「一致」，也不是「冲突」；条件式注记照旧（条件：#42 合并且条文文本不变） |
| F-15 | `37de107ed5` | `H_S_R_SCHEMA_FOUNDATIONS_DRAFT.md`（SF-28，#47） | SF-28 | 身份分离同形状间接锚：跨面引用是「断言不是可解析引用」「不参与身份判定」（条件式；本合同的双身份与其同向不借道） |
| F-16 | `d2f19cc` | `CONTRACTS.md`（§16.1「已知缺口」段） | D-24 现状契约 | 「**不采用**『oid 主能力 == 写入能力』的一刀切（那会打断 Q45 正例，护栏测试持续阻止该回头路）」 |
| F-17 | `d2f19cc` | `attacks/review/g1a-regression.test.ts`（:196） | Q45 正例护栏 | 「D-24 正例护栏：Facet 把扩展记录挂载到他人拥有的核心对象（Q45 合法形态）必须继续成功」——已入 `attacks/BASELINE.json` 的 `passes`，`g0-gate.mjs` 逐等对拍（G-2 修法） |
| F-18 | `d2f19cc` | `CONTRACTS.md`（§16.3 D-24 读侧「后果登记」段） | D-24 读侧 | 「合法 Facet 挂载行（oid∈dir、行落扩展者自己的 ns）在快照面本就不可见，扫描面现在对齐」 |
| F-19 | `d2f19cc` | `G1-CONTRACT-DESIGNS.md`（A.8-1/A.8-2） | 第六轮裁定 | 「`FacetRecordID`……与……`ObjectID` / `RevisionRef` 是**两套身份**」「挂载登记不得把目标对象 ID 充当 Facet 自身版本身份」「卸载 / 解除挂载 / 所有权移交是三种不同操作」「不得以卸载替代撤销或删除历史」 |
| F-20 | `d2f19cc` | `CONTRACTS.md`（§16.2 路由触发器段） | 包 5 裁定 | 「**审计先行必须与变更同事务原子**（外部复审点名：否则『先审计』反而制造幽灵审计——假凭据比零审计更糟）」 |
| F-21 | `d2f19cc` | `G1-CONTRACT-EVENT-AUTHORITY.md`（§2.2/§2.4/§8） | EA-2/EA-8 | 通道×类别矩阵 + 新机制名 EA-2.4 六步 + T-N1「挂载判据本体归 G1-FACET-01/A1，本表只钉引用形状」+ T-P2「mountRegistryOk=true ⇒ 放行」引用形状 |
| F-22 | `d2f19cc` | `G1-CONTRACT-EVENT-AUTHORITY.md`（§9.1-③/EA-4.2/EA-4.5/EA-4.6） | EA-4 | 「信封增 actor + 全形闸 + 审计复算三态」——`AuthorizationContext` 九字段信封与全形闸在本文件**复用**，不另造 |
| F-23 | `d2f19cc` | `CONTRACTS.md`（§16.2 轴值判据，D-26）/ EA C-17 | D-26 | 「登记的轴名**不得是机制自身权限轴**（至少 space-write、capability-admin）」 |
| F-24 | `d2f19cc` | `G1-ADJUDICATION-TABLE.md`（D1-c、X-5、D5-a） | 裁决已定行 | 「无权与不存在对外完全同形」；「写他人核心对象的合法路径只有后者（或 Facet 挂载登记，另席）」；「唯一责任者 = 我方 G1 契约……此后禁止再写『属 #47 决策面』」 |
| F-25 | `d2f19cc` | `READINESS.md` D-24 行 + `G1-RECONCILIATION-CHECKLIST.yaml` `G1-FACET-01` | 登记位 | 「D-24 的完整修法必须新增挂载声明机制，而不是在 `write()` 里加一条归属拒绝（后者当场打断正例）」 |

---

## 1. FM-1 双身份（A1 显式挂载登记 + A2 独立记录身份，共同冻结）

A.8 裁定把两案共同冻结：A1 的**显式挂载登记**（FM-2/FM-3）与 A2 的**独立记录身份约束**（本节）。
「等写 DDL 时再讨论记录究竟是谁」被本轮裁定关闭——身份约束不等 DDL，本面 G1 定死。

### 1.1 两套身份（规范句）

「`FacetRecordID`（扩展记录自身标识）与 `FacetRevision`（扩展记录自身修订），同被挂接对象的
`ObjectID` / `RevisionRef` 是**两套身份**：核心对象的修订归主 Capability，扩展记录及其修订归
Facet Capability。**挂载登记不得把目标对象 ID 充当 Facet 自身版本身份**，扩展行也不得反向把
自身标识冒充核心修订。」（F-19 原文约束的本合同承接；版本轴事实依据 = F-01/F-06。）

| 身份 | 签发者 | 权威归属 | 禁止 |
| --- | --- | --- | --- |
| `ObjectID` / `RevisionRef`（核心） | 机制（目录/修订纪律，§4/§16.1） | 主 Capability | 不经 Facet 面改写（FM-5.1） |
| `FacetRecordID`（记为 `FR-<seq>`） | 机制计数器（D-21 `RPT-<seq>` 同族先例） | Facet Capability | 冒充科研对象 ID（F-04/F-12）；调用方自带（FM-3.1 判据⑤） |
| `FacetMountId`（记为 `FM-<seq>`） | 机制计数器（同上） | 机制（登记行本身） | 调用方自带；承载「跟随承诺」（FM-2.3） |

### 1.2 标识不得冒充（机验落点）

- FM-/FR- 属机制保留前缀：任何声明类通道携带保留前缀自造标识 ⇒ `RECORD_ID_RESERVED`
  （D-21 既有码既有语义「保留前缀 id 收归机制计数器」，零扩张复用）。
- 正式引用位（F-08/F-09 清单：论证输入/结论、评价目标、接纳目标、检查对象）只接受
  `RevisionRef` 形态或合法记录引用；`FR-…` 出现在端点/正式声明槽位 ⇒ 领域契约拒（F-12），
  机制面的责任 = **不把 FR 标识投进任何对象引用解析器**，且机制读面回执不产出「FR 可当对象引用」
  的形状。有独立科研指称者走 Domain Admission 对象化（F-04/F-12：对象化是合法路径，
  不放宽端点类别）。

### 1.3 生命周期与版本

Facet Capability 对自己记录的写入、修订、失效、恢复各有权威（F-01「自己的数据、记录标识、
版本与生命周期权威」+ F-07「Facet 可独立迁移、失效和恢复」）；核心对象的 Schema/记录版本轴与
Facet 的相互独立，**Facet 版本不能覆盖对象核心 Revision**（F-06）。

## 2. FM-2 挂载登记（机制事实，A1 形态）

### 2.1 登记形状

「type FacetBinding =
   | { readonly mode: 'NAVIGATION' }                                   // 普通挂载：指向稳定 ObjectRef，可导航
   | { readonly mode: 'PINNED'; readonly revisionRef: RevisionRef };   // 承载正式声明/证据/检查输入：精确绑修订

 interface FacetMountRow {                 // append-only 链的一行
   readonly mountId: FacetMountId;        // FM-<seq>，机制发号
   readonly gen: number;                  // 代数：MOUNT 开链，UNLINK 追加终标记；当前态 = 最大 gen 行
   readonly op: 'MOUNT' | 'UNLINK';
   readonly facetCapability: CapabilityId;// 挂载方 = 端口能力（机制注入，非入参可填）
   readonly targetOid: ObjectOid;         // 逻辑身份，不携物理 ns、不携空间分量（D1-a 已裁文法方向）
   readonly binding: FacetBinding;
   readonly snapshotRevision: number | null; // 建立时目标修订快照（FM-2.3；机制写入，非入参）
   readonly witnessSeq: CommitSequence;   // 同事务审计行（EA-4 全形信封；先账后行，F-20）
 }」

### 2.2 入口判据序（机制独占入口；取证先于对象解析——C-02/#44 §5.1 序，与 EA-4.3 同排布）

「① 空间写权：无 ⇒ `NO_SPACE_WRITE`（完全拒绝，四表零变化，SP-09(b)/F-13）；
 ② 端口能力激活：未激活 ⇒ `CAPABILITY_INACTIVE`；
 ③ 挂载授权轴取证：`principalCan(actor, 'facet-mount')`；缺轴 ⇒ `AUTHORITY_REQUIRED`
    且**零残留**——审计先行不得制造幽灵审计（F-20 点名教训：拒绝路径不落任何行）；
 ④ 目标解析：`targetOid` ∈ `object_directory`？解析不到（不存在与无可见权**完全同形**，
    D1-c 已裁，F-24）⇒ `NOT_FOUND_IN_SPACE`；
 ⑤ 绑定形态：`PINNED` 缺精确修订 ⇒ `HARD_REF_NOT_PINNED`（既有码既有语义「硬引用不得指向
    浮动目标」）；所钉修订在归属 ns 不真实存在 ⇒ `NOT_FOUND_IN_SPACE`（§16.1 ②修订级存在
    判据 join `object_directory` 按归属 ns 归因，同形同码）；
 ⑥ 落账：同事务内**先**追加 `facet-mounted` 审计行（EA-4 全形信封，轴 'facet-mount'、
    `authorized` 必为 true——见 FM-2.4），**后**追加 mount 行；两行原子（F-20），
    返回 `{ mountId, witnessSeq }`。」

**不采信 B-3 形态（如实声明）**：EA 契约对**领域事件**采「有写权无业务轴 ⇒ 收为未生效声明」
（C-05/SP-09(a)）。本合同把挂载登记裁定为**机制判定输入**而非历史声明：未生效挂载行没有可
承载的语义（它一旦存在就会放行写入，等于把「未授权」翻转成「已授权」），故 ③ 缺轴即拒、
`authorized=false` 的行**不落**——与路由审计类「`envelope.authorized = 1`」闸门同族（F-22/EA-4.5）。

### 2.3 建立时修订快照 = 快照事实，非跟随承诺

- `NAVIGATION` 挂载的 mount 行记录**挂载登记建立时**的目标修订（机制读目录 head 写入）；
  每条扩展记录落笔时由机制补写**该记录建立时**的目标修订（同理由机制写，入参面无此字段——
  「签发主体是机制事实，不是载荷字段」的同族立场）。两处都是**快照事实**。
- 核心对象的新修订**不自动改写**既有 Facet 记录的历史解释，也不触发机制侧重验；是否重验由
  领域规则决定（A.8-2③，与 D-20/EA-5「不得事后重解释历史」同族）。修订不可变 ⇒
  「被扩展对象已无该修订」不可达，A.6-2 的报告语义即此一句，不另造状态。
- 「跟随当前」只允许出现在导航/浏览用途（F-09）；机制不对 mount 提供任何「解析到最新」的
  授权性服务——导航解析属宿主/UI 面，不产生可被正式位置消费的引用。

### 2.4 挂载不授予读权限；挂载信息默认不上插件读面

挂载登记只回答「扩展方可否以该核心对象为键写自己的行」，**不授予**对目标的任何读权（E-01 家族：
读权走既有读面判据）。挂载登记的读面：挂载方能力可查**自己的**登记（`listOwnMounts`，自己的
行零泄露问题）；**不提供**「目标的挂载方列表」给目标属主或第三方——默认不上插件读面（A.4-A1
原文处置），确需暴露走已裁决的呈现裁定通道（E-01/G1-READ-02 复核范围），与 EA-7.4 通道封闭
同型。审计/运维面可读挂载账（内部审计通道）。

### 2.5 账本形态与守卫（形状冻结，物理 DDL 归 G2）

「表 `facet_mount`：PK `(mount_id, gen)`；只允许 INSERT；触发器拒 UPDATE/DELETE ⇒ 存储层信号
`MOUNT_ROW_FROZEN`；`facet_mount_insert_guarded`：INSERT 必须已有 `ledger.seq = witness_seq`、
事件名与 op 相配（MOUNT⇒`facet-mounted`，UNLINK⇒`facet-unlinked`）、全形信封、echo 相符的行，
否则 ⇒ 存储层信号 `MOUNT_AUDIT_REQUIRED`（三者均**存储层信号文本**，不是 `RefusalCode` 封闭集成员——`ROUTE_AUDIT_REQUIRED` 同构先例，§16.2 既有区分）。
辅助索引：`(target_oid)` 与 `(facet_capability, target_oid)`（FM-3 写判据热路径）、
`(witness_seq)`。打开期判据（归 D5-a 我方打开序）：表在位 + 触发器在位 + 每 mount_id 链终态
合法 + 目标 oid ∈ 目录 + 见证引用可解析；随 `SCHEMA_VERSION` 推进与 G1-STORAGE-02 期望摘要
外置同批。」

## 3. FM-3 挂载判据——D-24 完整修法

### 3.1 判定（唯一判据点）

「hasActiveMount(facetCapability, targetOid) ⇔ 存在 mount_id 使最大 gen 行 op='MOUNT'。
状态行写入（含现行 `NamespaceWriter.write()` 的他人-oid 形态与目标形态 `writeFacetRecord`）：
「目标 oid ∈ 目录」= 属主行天然成立，或 hasActiveMount(端口能力, oid) = true。
否则 ⇒ 拒：对外（到达插件/调用方）= `CAPABILITY_SCOPE_ESCAPE`（复用理由见 FM-7）；
机制内部判定信号 = `REFUSE_UNMOUNTED`（存储层信号文本，EA 契约 T-N1 钉住的引用形状原样承接：
「mountRegistryOk=false ⇒ refuse ∧ 目录/状态零残留」）。
对外同形 / 内部保真（三条均为规范句，父席 2026-11-01 裁定记入）：

「(a) **detail 封闭键集 = {oid, capability}**，由机制**唯一塑形函数**产出；两个来源
（未挂载判定 vs D-19 越权判定）到达调用方的字节必须**逐等**——detail 不得含来源标记、判定信号、
计数或任何可区分二者的字段；`REFUSE_UNMOUNTED`/`REFUSE_BINDING_MISMATCH` 属内部信号，
**不得出现在任何对外可见字节里**（夹具 T-N8 逐字节对拍）。
(b) **内部审计保留真区别**：真因 ∈ {UNMOUNTED, NO_RIGHT, OWNER_OK, MOUNT_ACTIVE} 的落点 =
**内部审计通道的判定复算面**——挂载账 ⋈ `object_directory` ⋈ 路由激活态 + 操作类即可复算，
**无需额外落行**；可读面 = 装配根/运维授权的审计查询（与 §16.1 审计面、EA-7.4 通道封闭同一
边界），插件读面零入口。被拒尝试本身仍零残留（拒绝不落行是既有纪律，不因本契约改变）；
未来若要求「拒绝历史可回看」，那按 EA-2.4 六步另立名单项——**本契约不顺手加**。
(c) **复用声明（防被读成既成事实）**：复用不改变 `CAPABILITY_SCOPE_ESCAPE` 原有的越权语义
（D-19：能力作用域事务试图改/引用其它能力拥有的对象），只是**新增一个同形来源**（未挂载的
他人-oid 行判定）。不得反向引用本契约来论证「该码本来就是指未挂载」。」

入参字段白名单（运行时守卫，JS/`as unknown as` 面——D-17/N3 教训：类型面不是墙）：
`writeFacetRecord` 的合法入参字段封闭为 FM-6 所列；携带 `facetRecordId`/`mountId` 自造值、
核心改写位（FM-5.1）或任何白名单外身份/权威字段 ⇒ 同一 `CAPABILITY_SCOPE_ESCAPE`，
`detail.reason ∈ {'input-carries-id-field','input-carries-core-override','input-carries-foreign-authority'}`。

### 3.2 Q45 正例不破坏条款（规范句，非愿望）

- **「任何条款都不得使该正例判红」**——本契约全部判据（FM-2.2 入口序、FM-3.1 挂载判定、
  FM-7 码表、FM-8 矩阵）的组合效果，在「已建立挂载登记的跨 Capability 扩展写入」上必须
  收敛为放行；本契约若与 F-17 护栏在任一可达输入上冲突，**改契约，不改护栏**（被契约判红
  等于推翻 Q45 裁定）。夹具以 T-P2 做**形状级对拍**：本契约判定模型的挂载放行路径复现
  `g1a-regression.test.ts:196` 该测试钉住的三条断言（成功码、扩展按自身修订可读、核心权威
  payload 逐字段不变），S6 检查护栏测试名在本文逐字在位且与本夹具对拍函数互指。
- 本修法的放行判据**换了事实来源**（行形态 → 挂载登记），**没有收紧人群**：已登记挂载的扩展
  能力照旧「以自己的 ns、以核心对象为键」写扩展记录。
- 钉住测试：`attacks/review/g1a-regression.test.ts` 的
  「D-24 正例护栏：Facet 把扩展记录挂载到他人拥有的核心对象（Q45 合法形态）必须继续成功」
  （F-17）**不得被打死**——`attacks/BASELINE.json` `passes` 集合与基线逐等是每次门禁运行都在
  重复的否证权（G-2 修法）。实施批义务 = 在该测试世界的 `FacetStore` 式 helper 前补一步
  `declareMount`（机制通道操作），断言三条（成功码、扩展按自身修订可读、核心 payload
  逐字段不变）一字不改。
- 一刀切「oid owner == 写入 Capability」**继续禁止**（F-16 原文仍有效；本契约就是它等的那个
  「显式挂载声明/登记机制」）。

### 3.3 现状通道的收敛（如实登记现状与顺序）

- 现行 `write()` 的 `eventType` 参数与登记式台账行：已被 EA-2.2 矩阵判死（「write() 的登记式
  台账行」对 mechanism/domain/raw 三列全拒）；扩展内容的正式事件走**归属能力签发 Port**
  （EA-2.2/EA-3），复用 EA 契约归属账既有示例 `facet:calibration-observed`
  （owner = cap-calibration，`requiresAuthority = 'calibration-write'`）作为合法形状，本契约
  不新造事件名、不新造归属。
- `write()` 对他人-oid 的行形态在挂载通道落地前**维持已登记边界**（F-16「被记录的边界，不是
  被忽略的洞」）；挂载通道落地批必须与 FM-2.5 触发器/守卫、EA-2.4 名单入账**同批**
  （D-27/D-28 教训：新写面若无触发器/预留同批，就是下一个洞）。
- 物理形态向 A2（自有记录身份为主键的行、核心读面按构造不见扩展行）收敛属 G2 真实 DDL 批次；
  G1 冻结的是**判据与身份**，不冻结列布局。存量挂载行迁移语义登记为 G2 实施批义务（D-6 家族）。

### 3.4 五条落点的逐点闭合（D-24 全表清偿）

| 落点（READINESS D-24 行） | 闭合事实 | 出处 |
| --- | --- | --- |
| 种幽灵 oid | `NOT_FOUND_IN_SPACE` 先于任何写、零残留 | 包 1 已收口（§16.1 ①） |
| 伪造修订级 required 硬引用 | 修订判据 join `object_directory` 按归属 ns 归因 | 包 1 已收口（§16.1 ②） |
| 幽灵 `from` 跳过 `linkRef` 归属判定 | `linkRef` 归属判据随 D-19c 两侧门；Facet 侧只能 own 自己的边（FM-5.3 面②） | §16 双层写面 + 本文 |
| `readAsOf` 以他人之名端出 | 每行过同一个 `routeNs` 判据，归属不符剔除并计数 | 包 6 已收口（F-18） |
| `write()` 顺手写 ledger+journal 注入他人事件流 | 登记式台账行三列全拒；事件唯一入口归 EA-2.2 | EA 契约已裁（F-21） |
| 合法挂载与伪造行同一行形态 | **本契约**：挂载登记 + FM-3.1 判据 | F-25 点名「必须新增挂载声明机制」 |

## 4. FM-4 三种不同操作（A.8-2④ 规范条款）

**「卸载实现 / 解除挂载 / 所有权移交是三种不同操作」**（F-19 原文），逐条冻结：

| 操作 | 语义 | 唯一通道 | 落的事件 | 挂载账效果 | 可恢复性 |
| --- | --- | --- | --- | --- | --- |
| 卸载实现（能力退出/停用，Q44 语义） | 实现不再运行，权威不变 | `setRouteEnabled`（既有） | `capability-disabled`（EA 封闭名单**既有成员**，零新名） | **零删除、零改写**：链态不变（仍 ACTIVE，F-07「失效和恢复」）；停用期间写面 `CAPABILITY_INACTIVE` | 重启用即恢复（挂载仍有效）——卸载**不是**撤销 |
| 解除挂载（unlink） | 挂载登记本身终止 | `FacetMountPort.unlinkMount`（FM-6） | `facet-unlinked`（planned 名，FM-9） | 追加 UNLINK 终标记行；此后该挂载下写入被 FM-3.1 拒；**历史代永久可读** | 重挂 = 新挂载登记（新 `FM-` id 开新链），历史链不复活不重写 |
| 所有权移交（Q44 受控移交） | Capability→Plugin 实现映射变更，权威原子切换 | `transferRoute`（既有，携 `capability-admin` 轴） | `capability-transferred`（既有成员，零新名） | **挂载行一字不动**：挂载按 `CapabilityID` 记，移交只换 `PluginID` 映射（F-07）；新实现（同 CapabilityID）照常可用既有挂载 | 移交本身按既有受控通道再移交 |

- **「不得以卸载替代撤销或删除历史」**（F-19 原文）：停用不得清挂载 ACTIVE 态；解除挂载不得
  删历史行；移交不得触挂载账。任何实现若把三者合并为一个「删除/清理」动作 = 本合同违例，
  夹具 MUT-2 钉判别方向。归属账本不随停用消失（§16.2 既有先例）在挂载面同样成立。
- 三操作各自的事件**见证来源**见 FM-9 表；前两名走既有路由审计信封（轴
  `capability-admin`、`authorized=1`），`facet-unlinked` 走挂载审计信封（轴 `facet-mount`）。

## 5. FM-5 核心权威不可侵犯与第二真源

### 5.1 核心修订不可被 Facet 覆盖（结构性）

- Facet 可达的任何 Port **类型面上不存在**改写核心身份/kind/核心修订的字段（F-01「只有主
  Capability 写」的机制化 = **无写点**，不是纪律）；核心修订唯一入口 = 属主面的 revise 通道
  （`CAPABILITY_SCOPE_ESCAPE` 归属核对，D-19 既有）。
- 运行时守卫双向：入参携带核心改写位（如 `coreRevisionOverride`、目标属主权威字段）⇒
  `CAPABILITY_SCOPE_ESCAPE` + `detail.reason='input-carries-core-override'`；机制落账面核心
  目录/修订行不因任何扩展写入而变化（夹具逐断言核心 head 与 payload 逐字段不变）。
- 版本轴独立且**不可覆盖**（F-06）：`FacetRevision` 的推进不产生、不引用、不消费核心
  `RevisionRef` 的推进。

### 5.2 核心读面不并入扩展行（既有事实承接）

F-18 已实测冻结：属主状态视图（快照/双时间/最新）只含归属行；合法 Facet 挂载行在快照面本就
不可见、扫描面已对齐。本合同把它升为规范义务：**任何未来读面加速/物化不得把扩展行并入核心
状态**（D-24 读侧同一判据函数复用，禁复制逻辑）。扩展记录经挂载账按 `ObjectRef` 导航取用
（F-02 的「可导航」= 挂载方/宿主经挂载账 + `FR` 标识取自己的行），不是经核心状态视图。

### 5.3 第二真源禁令与判据归属（A.6-5 闭合）

「承载正式科研关系/事实的扩展行，不得复制核心关系或事实形成第二真源。」（F-03/F-11 的挂载面
直落点。）判据归属裁定（回答 A.6-5「领域出、机制执行，还是机制自判」）：

- **机制不自判科研真值**（Kernel 业务无知，#44 §5.3 停线；机制对「payload 语义是否重复核心
  关系」零判定，也**不得**误炸——负例 T-N8 把「机制零误炸」也做成断言）。
- **机制执行三面**（全部可机验）：① 结构禁：核心表/核心边对 Facet 无写通道（FM-5.1；
  `linkOwned` 只能 own 自己的边）；② 读面禁：扩展行不入核心状态（FM-5.2）；③ 报告面：
  XC-28 型重复检测作为**领域校验规则**运行，产出 CheckReport（存在性形态闸与版本钉归
  裁决表 D4-b 已裁形状），结论 NOT_ACHIEVED 不改写、不折叠（RD-25 三线独立，D4-a 已裁）。
- 边界如实：`NAMESPACE_ESCAPE` 不守这个面，两者不得互替（`RECONCILIATION.md` §3 8b 行既有实测）；
  检测规则的科研正当性与词表属领域资产（G3），机制只提供三面执行与输入可得性。

### 5.4 缺席只降级

Facet 缺席/失效/升级失败只让依赖扩展的能力降级，基础对象不消失不被改写（F-05）；其 H 追溯与
权限保护按本契约与 EA 契约承担，扩展行的缓存不是权威数据（F-05 同句）。

## 6. FM-6 Port 签名与数据形状（契约形状；实现批按此落 `src/**`）

「type FacetMountId = string;      // 机制发号 'FM-<seq>'
 type FacetRecordId = string;     // 机制发号 'FR-<seq>'；禁冒充对象 ObjectID（FM-1.2）

 interface FacetMountPort {       // 仅经能力窄面可达（PluginFace 扩一个具名成员；无通用通道等价物）
   /** 挂载登记（唯一入口；FM-2.2 判据序；同事务审计先行原子）。 */
   declareMount(a: {
     readonly targetOid: ObjectOid;
     readonly binding: FacetBinding;
   }): { readonly mountId: FacetMountId; readonly witnessSeq: CommitSequence };
   /** 解除挂载（≠卸载实现 ≠移交，FM-4；追加终标记 + facet-unlinked 见证，同事务原子）。 */
   unlinkMount(a: { readonly mountId: FacetMountId }): CommitSequence;
   /** 查询：仅本能力自己的登记（FM-2.4）。 */
   mountState(a: { readonly mountId: FacetMountId }): {
     readonly mountId: FacetMountId; readonly active: boolean; readonly gen: number;
     readonly targetOid: ObjectOid; readonly binding: FacetBinding;
     readonly snapshotRevision: number | null;
   } | null;
   listOwnMounts(a?: { readonly targetOid?: ObjectOid }): readonly FacetMountPort['mountState'] extends
     (x: never) => infer R ? NonNullable<R>[] : never;
   /** 扩展记录写入（目标形态；判据消费挂载登记，不消费自由 oid）。 */
   writeFacetRecord(a: {
     readonly mountId: FacetMountId;
     readonly boundRevisionRef?: RevisionRef;   // PINNED 必填且 = 挂载钉修订；NAVIGATION 可省=机制写建立时修订
     readonly payload: unknown;
   }): { readonly facetRecordId: FacetRecordId; readonly facetRevision: number;
         readonly targetRevisionAtRecord: number };
 }」

- **移交无新 Port**：所有权移交唯一通道 = 既有 `transferRoute`（FM-4 表；#44 §6.1 已裁
  「受控、可审计、原子」）。**不存在「变更挂载主体」通道**：挂载主体变更 = 旧能力
  `unlinkMount` + 新能力 `declareMount` 两次登记，各自带各自见证。
- 挂载方能力标识、挂载时修订、`facetRecordId`/`facetRevision`、目标建立时修订、`actor`/信封
  一律**机制写**——入参面无位（EA-4.3「不得自带见证」结构性立场在挂载面的同族延伸）。
- 登记行表 `facet_mount` 形状/索引/触发器见 FM-2.5；扩展记录行物理表（`FR` 主键、按
  `(facet_record_id, facet_revision)` append）物理布局归 G2（A2 方向），语义下限 G1 冻结：
  每条扩展记录可解析出 {挂载、目标 ObjectID、目标建立时修订、FacetRecordID、FacetRevision}
  五元组，且五元组各自不冒充（FM-1）。
- PluginManifest **零加宽**：挂载不靠装配期名单预批（每次 `declareMount` 都是运行期登记事实，
  受 FM-2.2 全套判据）；Kernel 词汇表因此只增 {挂载登记, 双身份, facet-mount 轴} 三词，无科研词。

## 7. FM-7 错误码与轴值（封闭集零扩张）

**复用码逐码理由**（§14.2 纪律：新码必须给「与既有码不同修法」论证——本契约一律不开新码）：

| 码（既有） | 挂载面用法 | 复用理由（为何不是新码） |
| --- | --- | --- |
| `NO_SPACE_WRITE` | 无空间写权 | SP-09(b)/B-4 既有语义原样 |
| `CAPABILITY_INACTIVE` | 未激活能力declare/写 | 激活核对既有语义原样 |
| `AUTHORITY_REQUIRED` | 缺 `facet-mount` 轴 | 「缺该业务动作所需的授权轴（与写权分轴，SP-09）」**定义即此** |
| `NOT_FOUND_IN_SPACE` | 目标不存在 / 无可见权 / PINNED 修订不存在 | 同形合并码既有语义；D1-c 已裁「无权与不存在对外完全同形」 |
| `HARD_REF_NOT_PINNED` | PINNED 绑定缺精确修订（浮动） | 定义即「硬引用不得指向浮动目标」；挂载钉修订就是硬引用 |
| `CAPABILITY_SCOPE_ESCAPE` | 无挂载写他人 oid；入参携带越权身份/核心改写位 | D-19 定义即「试图改/引用其它能力拥有的对象」——无挂载的他人-oid 行正是该语义的未覆盖形状；**复用不改变该码原有越权语义，只是新增一个同形来源**（FM-3.1(c)）；detail 封闭键集与两源逐字节等（FM-3.1(a)，T-N8） |
| `RECORD_ID_RESERVED` | 声明通道携带 FM-/FR- 前缀自造标识 | D-21 定义即「保留前缀收归机制计数器」 |
| `ACTIVATION_IMPOSSIBLE` | 挂载名未入封闭名单时装配挂载 Port | EA-3.2 判据③同型 fail-closed：判据依赖的名册缺项 = 装配红 |
| `EVENT_AUTHORITY_REQUIRED` | 通用通道 mint `facet-mounted`/`facet-unlinked` | EA-2.2/EA-2.3 既有判定与 detail 合同原样，本契约不碰 |

**存储层信号文本**（与 `ROUTE_AUDIT_REQUIRED`/`HISTORY_IMMUTABLE` 同构，**不是** `RefusalCode`
封闭集成员，登记于此以免误读）：`MOUNT_ROW_FROZEN`、`MOUNT_AUDIT_REQUIRED`、
`REFUSE_UNMOUNTED`（FM-3.1 机制内部判定信号 = EA 契约 T-N1 引用形状）、
`REFUSE_BINDING_MISMATCH`（PINNED 绑定不符，对外折叠进 `CAPABILITY_SCOPE_ESCAPE` detail）。

**轴值**：挂载审计轴定名 `'facet-mount'`（不透明串）。`MECHANISM_RESOURCES` 从
{space-write, capability-admin} 扩为含 `'facet-mount'`——依据 = C-17/D-26 原文「至少」二字
+ 同族定位（机制自有操作轴，与路由审计轴同族）；manifest 登记 `requiresAuthority='facet-mount'`
⇒ `ACTIVATION_IMPOSSIBLE`（判据④同型）。该轴的**授予政策**归宿主/装配（机制只做不透明轴取证，
SP-09 两分；与裁决表 §4 项 1 采纳权委托同族，不是新决策项）。

## 8. FM-8 权限矩阵

| 动作 | 通道 | 前置核对（序 = FM-2.2/§16.2 先例） | 见证 | 拒绝形状（对外） |
| --- | --- | --- | --- | --- |
| 挂载登记 | `FacetMountPort.declareMount`（能力窄面） | 写权→激活→facet-mount 轴→目标解析→绑定形态 | `facet-mounted` 行全形信封（轴 facet-mount，authorized=1，capability=挂载方） | 见 FM-2.2 序各码；detail 零加成 |
| 扩展记录写 | `writeFacetRecord` / 现行 `write()` 他人-oid 形态 | 写权→激活→挂载 ACTIVE→（PINNED）绑定一致；核心面零触碰 | 无事件（状态行非事件；内容声明另走 EA-2.2 签发 Port） | `CAPABILITY_SCOPE_ESCAPE`(+REFUSE_UNMOUNTED/REFUSE_BINDING_MISMATCH 信号) / `HARD_REF_NOT_PINNED` |
| 解除挂载 | `unlinkMount` | 写权→激活→挂载属于本能力→facet-mount 轴 | `facet-unlinked` 行全形信封 | `NOT_FOUND_IN_SPACE`（非己挂载与不存在同形）/ `AUTHORITY_REQUIRED` |
| 查询（own） | `mountState`/`listOwnMounts` | 激活；只回本能力行 | 读面无事件 | 非己 id ⇒ null（与不存在同形） |
| 目标侧挂载列表 | **不存在此读面** | —（FM-2.4；确需暴露走呈现裁定通道） | — | 面锚对拍钉「成员名集零增删」（`arch-independence.test.ts` 先例） |
| 卸载实现 | `setRouteEnabled`（装配/运维面） | `capability-admin` 轴 | `capability-disabled`（既有名，路由审计信封） | 既有形状 |
| 所有权移交 | `transferRoute`（装配/运维面） | `capability-admin` 轴；不携 ns | `capability-transferred`（既有名） | 既有形状（`TRANSFER_NS_DRIFT` 等不动） |
| 审计面读挂载账 | 装配根/运维授权审计查询 | 运维授权（EA-7.4 通道封闭同型） | — | 插件读面无入口 |

## 9. FM-9 与 C 契约事件的对应（复用，不另造）

**planned 名单占位块（三方逐等之契约侧锚；夹具 S1 机验）**：
「<!-- FM-9 PLANNED-MOUNT-LIST-BEGIN --> facet-mounted · facet-unlinked <!-- FM-9 PLANNED-MOUNT-LIST-END -->」
两名的最终承载 = 锚文件 `g1/EVENT-CONTRACT-LEDGER.json` 的 `planned: true, gated_by: 'G1-FACET-01'`
条目；入账（翻 `planned:false` 进运行时名单）走 EA-2.4 六步，本块在此之前**不得被引用为已入账**。

| 动作 | 事件 | 类别/写点 | 见证来源 | 名字状态 |
| --- | --- | --- | --- | --- |
| declareMount | `facet-mounted` | 机制类，机制内部直写（挂载入口内） | `AuthorizationContext` 全形（EA-4.2 九字段原样复用；轴 `facet-mount`；`authorized=1`；`replayAuthorityEvidence` 三态适用） | **planned**：`planned:true, gated_by:'G1-FACET-01'` 占位 |
| writeFacetRecord | （无）；内容声明 = 领域事件如 `facet:calibration-observed` | 领域类，owner 签发 Port（EA-2.2） | EA-4 全形信封，B-3 形态（authorized=false 收存不投影）**适用** | 领域名走 EA-3 归属账登记，本契约零新名 |
| unlinkMount | `facet-unlinked` | 机制类，同 declareMount | 同上 | **planned**，同左 |
| 卸载实现 | `capability-disabled` | 机制类（路由） | 路由审计信封（轴 capability-admin，authorized=1） | **既有成员**（EA §2.4 名单） |
| 恢复启用 | `capability-enabled` | 机制类（路由） | 同上 | **既有成员** |
| 所有权移交 | `capability-transferred` | 机制类（路由） | 同上 + 三元组见证既有形 | **既有成员** |
| 核心修订（对照行，非本契约动作） | `object-revised` | 机制类 | EA-5.2 解释原样 | **既有成员**；Facet 无达该写点的路径（FM-5.1 结构性） |

**入账顺序与无窗口论证**：两个 planned 名进入机制封闭名单**必须走 EA-2.4 六步**（提案→用户
裁定 + `Approved-By` 人工标记→锚文件 `g1/EVENT-CONTRACT-LEDGER.json` 独立提交 +
`Event-Name-Review:` trailer→异源对账 R1–R4→护栏同批→重锚登记）；本合同是**命名提案 + 载荷 +
writeSites + 护栏判据**的文书，**本身不构成入账**（入账动作的用户批准归 EA-2.4 步骤 2，那是
既有流程义务）。未入账期间不存在放行窗口：EA-1.2.2 对 `unregistered` 名一切通用通道**默认拒**，
机制内部直写同样受「字符串必须已分类为 mechanism」约束——所以挂载 Port 在名单入账前**装配红
fail-closed**（`ACTIVATION_IMPOSSIBLE`，FM-7），而不是「先开后补」。**「未入账期间已按
unregistered 默认拒」不是散文论证**：夹具 T-N5 把 planned 名（`facet-mounted`）直接推过通用
写入通道，在入账前/入账后两阶段分别断言 `EVENT_AUTHORITY_REQUIRED`（classification 依次
`unregistered`/`mechanism`）——该通道在夹具判据模型中可表达（EA 夹具 `genericAppend` 同型），
故此论证为已机验而非推理。名单三方逐等（本契约 planned 块 ↔ 锚文件 ↔ 夹具）由夹具 S 组当场
执行。`ns-relocated` 仍由 G1-NS-01 门控，本契约不代裁、不并案。

## 10. FM-10 正反例表（可执行判据；与夹具逐一对账，id 双向一致）

| id | 正/负 | 场景 | 期望判定 | 可执行断言形状 | 夹具 |
| --- | --- | --- | --- | --- | --- |
| T-P1 | 正 | 跨 Capability 合法挂载：cap-calibration 对 cap-records 拥有的核心对象 declareMount(NAVIGATION) → 写扩展记录 | 允许；`FR` id 由机制发号且 ≠ 目标 oid；核心 head/payload 逐字段不变；挂载行携建立时目标修订快照；此后核心再修订，挂载快照与既有扩展记录解释不变（A.8-2③） | 「declare ok ∧ FR≠oid ∧ coreHead 不变 ∧ snapshotRevision=r1 ∧ 核心再修订后解释逐字段等」 | run_T_P1 |
| T-P2 | 正 | Q45 护栏同形：登记在先，扩展行以核心 oid 为键落扩展者自己 ns；核心权威数据不被改写 | 允许；扩展按自身修订序列可读 | 「NO_REFUSAL ∧ facet 可读 ∧ 核心 payload 逐字段不变」（护栏三断言同形） | run_T_P2 |
| T-P3 | 正 | PINNED 挂载承载正式声明/检查输入：精确 RevisionRef；检查输入槽位接受绑定对 | 允许；浮动/错绑各拒 | 「PINNED 绑 r2 成功 ∧ bound=r2 行收 ∧ bound 缺⇒HARD_REF_NOT_PINNED ∧ bound≠r2⇒CAPABILITY_SCOPE_ESCAPE(+REFUSE_BINDING_MISMATCH)」 | run_T_P3 |
| T-P4 | 正 | 三操作各走各路：disable → enable → unlink → 重挂 → transfer | 卸载不清挂载态（恢复即写通）；解除=追加终标记、历史可读、重挂新链；移交挂载行字节不变、同 CapabilityID 新实现写通 | 「落 capability-disabled/capability-transferred/facet-unlinked 各自 ∧ 挂载行数单调不降 ∧ 各步写判据如表」 | run_T_P4 |
| T-P5 | 正 | 非 oracle：他人对某核心对象挂载 0 vs 1 个，属主读面响应逐字节等；挂载方 own 面只见自己行 | 允许形态零差分 | 「response(前)=response(后) 逐字节 ∧ listOwnMounts 无他人行 ∧ 插件可见成员名集零增删」 | run_T_P5 |
| T-P6 | 正 | 入账顺序 fail-closed：名单未入账阶段装配挂载 Port | `ACTIVATION_IMPOSSIBLE`，零挂载行零审计行 | 「pre-listing declare ⇒ ACTIVATION_IMPOSSIBLE ∧ 两表零行」 | run_T_P6 |
| T-P7 | 正 | 真因内部保真（FM-3.1(b)）：同一响应面之外，内部审计复算面对「未挂载」与「越权（有挂载但改核心）」给出**可区分**真因；插件面读不到 | 允许形态：内部 {UNMOUNTED ≠ NO_RIGHT}；对外字节不可区分（由 T-N8 对偶钉） | 「auditQuery(admin) 两真因各异 ∧ 无运维授权 ⇒ 无入口 ∧ 插件可见响应字节不含真因词」 | run_T_P7 |
| T-N1 | 负 | **无挂载伪造核心修订**（Q45 反面对偶）：扩展能力对未登记挂载的他人核心对象写状态行 | 拒 `CAPABILITY_SCOPE_ESCAPE`（内部信号 REFUSE_UNMOUNTED）；目录/状态/台账零残留 | 「refusal 命中 ∧ signal=REFUSE_UNMOUNTED ∧ dir/facetRows/ledger 行数不变」（EA T-N1 引用形状承接） | run_T_N1 |
| T-N2 | 负 | 身份冒充：自带 facetRecordId/自带 FM- 前缀 id/FR 进正式端点槽位 | 各拒；机制发号不可自填 | 「白名单外 id ⇒ CAPABILITY_SCOPE_ESCAPE(reason=input-carries-id-field) ∧ FM-/FR- 声明 ⇒ RECORD_ID_RESERVED ∧ formalSlot(FR)=拒 ∧ formalSlot(oid@rev)=收」 | run_T_N2 |
| T-N3 | 负 | 同形不泄：目标不存在 vs 目标存在但无可见权，declareMount 响应 | 两世界逐字段等（D1-c） | 「两世界 refusal JSON 逐字节等（同码同 detail 键集）」 | run_T_N3 |
| T-N4 | 负 | 核心覆盖：入参携 coreRevisionOverride / facet 面枚举核心改写方法 | 结构拒 + 枚举空集；核心 head 不变 | 「reason=input-carries-core-override ∧ 枚举(port 面 ∩ 核心改写词表)=∅」 | run_T_N4 |
| T-N5 | 负 | 绕行与 mint：通用通道 mint `facet-mounted`；绕过入口直插 mount 行（无见证） | mint 拒（入账前 classification=unregistered / 入账后 mechanism）；裸插拒 | 「EVENT_AUTHORITY_REQUIRED 两阶段各自命中 ∧ rawInsert ⇒ MOUNT_AUDIT_REQUIRED ∧ 行数不变」 | run_T_N5 |
| T-N6 | 负 | 幽灵审计：缺 facet-mount 轴主体尝试挂载 | `AUTHORITY_REQUIRED` 且**零挂载行、零审计行**（F-20 假凭据禁令） | 「refusal ∧ mounts.size=0 ∧ auditRows=0」 | run_T_N6 |
| T-N7 | 负 | 第二真源三面：扩展 payload 重复核心关系（used_in 形态） | 机制零语义误炸（写通），但核心快照不含它、扩展不能认领核心边、领域 XC-28 检查可落 NOT_ACHIEVED 报告 | 「write ok ∧ coreSnapshot 不含扩展行 ∧ linkOwned(核心边)⇒CAPABILITY_SCOPE_ESCAPE ∧ report(NOT_ACHIEVED) 可落且不改写核心」 | run_T_N7 |
| T-N8 | 负 | 同形双源（FM-3.1(a)）：「未挂载目标被拒」与「D-19 越权被拒」在同一响应面**逐字节等**；`REFUSE_UNMOUNTED`/`REFUSE_BINDING_MISMATCH` 信号词不得出现在对外字节中 | 两世界 refusal JSON 逐字节等；detail 键集 = {oid, capability}；信号词零出现 | 「JSON.stringify(拒A)=JSON.stringify(拒B) ∧ keys(detail)={capability,oid} ∧ 对外全文不含两信号词」 | run_T_N8 |

**架空判据变异（常驻不删，自验判别方向——真实判据必须拦，架空必须放）**：

| id | 架空形态 | 被谁捕获 |
| --- | --- | --- |
| MUT-1 | 行形态判据（ns=自己 ⇒ 放行）= D-24 现状 | T-N1 负例在 MUT-1 下必须被放行（证明挂载判据有判别力；EA A.2 机验否证的夹具化） |
| MUT-2 | 卸载即撤销（disable 清挂载 ACTIVE 态） | T-P4 的「卸载非撤销」断言（重启用后必须仍写通）在 MUT-2 下必红 |
| MUT-3 | 审计后置且可脱钩（先行落行、见证异步补） | 对账器点名「无见证挂载链」（MUT-3 的崩溃窗口产出孤儿；原子形态零孤儿）——F-20 幽灵审计禁令的机验化 |

## 11. FM-11 裁定记录、A.6 清偿与关系表

### 11.1 A.6 开放问题逐条清偿

| A.6 | 处置 |
| --- | --- |
| 1 绑定粒度 | 已由第六轮裁定 + 本文 FM-2.1/FM-2.3 成文（binding 两态 + 两处「建立时修订」机制写快照） |
| 2 修订演进/作废 | FM-2.3：修订不可变 ⇒ 「已无该修订」不可达；机制不重验，领域自决 |
| 3 卸载/换包状态迁移 | FM-4 表：三操作分轨；历史记录永久可读 |
| 4 读面语义 | FM-3.1（拒绝 detail 零加成）+ FM-2.4（默认不上读面）+ FM-8（同形位）；同形收口归 D1-c/E-01 呈现复核，本契约保证**不加一格** |
| 5 XC-28 判据归属 | FM-5.3：领域出判据（版本钉检查规则），机制执行三面、不自判真值；`NAMESPACE_ESCAPE` 不得互替 |
| 6 挂载账与 ns 重定位 | 挂载 `targetOid` 是逻辑身份，不随物理 ns 迁移而语义变化；挂载方行的物理归属属 B1 重定位覆盖集（B.5-3 已把「挂载登记、Facet 扩展记录」列入），细节归 G1-NS-01；B1 落地前挂载不引入新的幽灵形态（routeNs 重定位链判据同源） |

### 11.2 与 #42 / #44 / #47 已裁定语义的关系

| 已裁定语义 | 关系 | 依据 |
| --- | --- | --- |
| #44 §6.2 全部（F-01…F-05） | **一致 + 机制化** | FM-1（双身份/RF-05/06）、FM-2（ObjectRef 导航 + RevisionRef 精确绑）、FM-5（平行复制/缺席降级）逐格落点 |
| #44 §11（F-06/F-07） | **一致** | 版本轴独立（FM-1.3）；移交≠挂载变更、Facet 可独立失效/恢复（FM-4） |
| #42 RD-05 / RD-01（F-09/F-10） | **一致** | PINNED/NAVIGATION 二分正是「只允许精确引用/跟随仅限浏览」的挂载面直落；身份构成零触碰 |
| #42 RD-15/RD-37/XC-28（F-03/F-11） | **一致 + 归属闭合** | FM-5.3 三面执行（原 A.7「需澄清」由本契约闭合为条款） |
| #42 RF-05/RF-06（F-12） | **一致** | FM-1.2 端点禁 + 对象化唯一路径 |
| #42 SP-09（F-13） | **一致 + 限定延伸** | 两轴分权原样（FM-7）；「未生效声明」不延伸到**判定输入型**登记行（FM-2.2 如实声明该限定） |
| #47（F-14） | **未覆盖**——条件式：即便 #42 合并且条文不变，#47 现文对 Facet/挂载零规则；**不写「属 #47 决策面」**（F-24） | 全库检索实测；DDL/物理形态按裁决表 D5-a/D5-b「唯一责任者=我方 G1 + G2 实施」承接 |
| #47 SF-28（F-15，条件式） | **同向不借道** | 双身份与「断言不参与身份」同形状，但本契约不依赖 #47 条文成立 |
| PoC 内部 §16.1/§16.3、D1-c/X-5 裁决行 | **承接不推翻** | 包 1/包 6 已收口面原样；本契约补 F-25 点名的「挂载声明机制」最后一块 |

### 11.3 真·用户决策

**无**。本契约全部问题已给出裁决；唯一需要用户动作的是**流程义务**：两个 planned 机制名入账时
按 EA-2.4 步骤 2 落 `Approved-By` 人工标记（该义务由 EA 契约既有流程设定，非本席新设开放项）。
`facet-mount` 轴的宿主授予政策属既有「采纳权委托与政策」同族面（裁决表 §4 项 1），本契约只裁
机制取证形状。

### 11.4 本契约的变更纪律

FM-2.1 形状、FM-3.1 判定、FM-4 表、FM-7 码/轴表、FM-10 表、§9 planned 块任一变动 = 本合同
冻结面变更：夹具（同目录 `.fixtures.mjs`）必须当场红，或经「契约 ↔ 锚文件 ↔ 夹具」三方逐等
更新后绿，且需人工批准标记；Q45 护栏测试（F-17）方向**永不重开**（其基线逐等由门禁持续执行）。
