# G1 契约正文 — 事件命名空间、唯一所有权与授权签发（G1-EVT-01 / G1-AUDIT-01）

> 状态：**规范性契约正文（可实施、可写测试）**，2026-10-31 起草于分支 `g1/contracts-20261031`
> （仓内侧车引用以提交 `d2f19cc` 的工作树行号为准）。本文件把 `G1-CONTRACT-DESIGNS.md` 节 C 的
> **草案**升为正文；DESIGN 节 C 与其附三**原文保留不删**（附三纪律：更正以追加留痕，不静默覆盖）。
> 本文件不是机制代码：所有 TS 形状是「先契约后机制」的「先」（§16 先例），实现批按本文落 `src/**`。
> 夹具（与本合同同批、互相对账）：
> 「node experiments/v3-code-architecture-poc/g1/G1-CONTRACT-EVENT-AUTHORITY.fixtures.mjs
> 退出码 0 = 契约结构自洽 + 正反例全命中 + 三条架空判据变异全部被捕获。」」
> 平面声明：本合同只裁 **V3 机制侧车（本 PoC）** 的事件命名与签发面。V1 冻结面（`ARCHITECTURE.md`
> §7.2、`schema/**`）与 #47 HSR 层各有其文（§0.1）；按 DESIGN 附三教训（「跨草案的归属必须引用条文原文，
> 不能引用我的预期」），凡本文写「归 X 裁定」都必须给条文锚，给不出的一律写「未决 + 指名裁定人」（§9.4）。
> 禁改清单沿用席位任务书：本文件与同目录夹具之外的任何文件本席不改。

---

## 0. 引用与平面纪律

### 0.1 三个平面（引用前先认平面，防 F-1/B6 式归属互踢）

| 平面 | 事件/工具命名权威 | 本合同的关系 |
| --- | --- | --- |
| V1 冻结面（根文档 + `schema/**`） | `ARCHITECTURE.md` §7.2 清单 + 冻结变更流程（SI-02 引文 C-11） | 不触碰；只借其**流程同型**（人工批准标记） |
| #47 HSR Schema 层 | 自认不收口事件族：SF-72「那是**另一次**冻结面变更 + 独立评审，不得借道本层」、SD-07「硬塞会迫使领域语义迁就事件名」（C-13/C-14） | 其条文**未裁** V3 机制事件名；本文不声称「#47 已定」 |
| V3 机制侧车（本 PoC `src/**`） | **本合同自立**（F-1 已证「等 #47 定了再对齐」是空头承诺） | 本文即该面的冻结文本 |

### 0.2 引用格式

每条引用给「文件 + 规则号/小节 + 原文短句 + SHA」。跨分支文件取文方式：
「git show <sha>:<path>」（#42/#47 的正文不在当前分支树内；DESIGN 文件头「条文不在仓内」的
旧限制已被 `G1-RECON-PR47.md` 的 9/9 实取取代）。#47 引用的关系一律按 RECON-PR47 §0 注记记为
**条件式**（「#42 合并且条文文本不变」）。**未取得项：无**。

### 0.3 引用清单（正文以 C-xx 指代）

| # | SHA | 文件 | 规则号 | 原文短句 |
| --- | --- | --- | --- | --- |
| C-01 | `5ec38974fc` | `docs/architecture/V3_CODE_ARCHITECTURE_DRAFT.md`（L136，#44） | §5 首行 | 「Principal、ResearchSpace 访问验证、SpaceContext、统一业务授权入口」 |
| C-02 | `5ec38974fc` | `docs/architecture/V3_CODE_ARCHITECTURE_DRAFT.md`（L147） | §5.1 | 「权限校验先于对象解析，不能借猜测对象 ID 获知其他空间对象存在与否」 |
| C-03 | `5ec38974fc` | `docs/architecture/V3_CODE_ARCHITECTURE_DRAFT.md`（L223/228） | §7.1 | 「不能并行创建第二套事件真源」「禁止『领域事件表一份、Ledger 另一份，两者均声明为真实事件历史』」 |
| C-04 | `5ec38974fc` | `docs/architecture/V3_CODE_ARCHITECTURE_DRAFT.md`（L234） | §7.2 Q37 | 「即使 S-L0 无法解析仍保存为原始记录，**不冒充正式五类对象**」 |
| C-05 | `5ec38974fc` | `docs/architecture/V3_CODE_ARCHITECTURE_DRAFT.md`（L238） | §7.2 | 「有空间写权、缺少正式科研接纳授权的主体可保存**未生效声明**……**无空间写权则完全拒绝写入**（RD-27、PR-A1）」 |
| C-06 | `5ec38974fc` | `docs/architecture/V3_CODE_ARCHITECTURE_DRAFT.md`（L328） | §11 | 「旧解释器不可用时保留原始记录与版本身份并如实标注能力缺失，不套用新规则冒充旧解释」 |
| C-07 | `0369c3196c` | `H_S_R_DOMAIN_FOUNDATIONS_DRAFT.md`（L155，#42） | SP-09 | 「空间写权限与业务授权是两件事……（a）……**未生效声明**……（b）对目标空间**无写权限** → 请求被拒绝」 |
| C-08 | `0369c3196c` | `H_S_R_DOMAIN_FOUNDATIONS_DRAFT.md`（L162） | DF-01 | 「登记 ≠ 使用 ≠ 支持 ≠ 接纳 ≠ 为真」 |
| C-09 | `0369c3196c` | `H_S_R_INTERACTION_CONTRACT_DRAFT.md`（L36，#42） | F-SCHEMA-INVALID | 「落为 H 原始记录（保留原文与来源），不冒充正式对象，也不冒充通过门禁」 |
| C-10 | `0369c3196c` | `H_S_R_INTERACTION_CONTRACT_DRAFT.md`（L52-57） | IC-H3 | 「登记原始未解析材料……H 原始记录，可被引用与后续抽取；**不**产生正式对象」 |
| C-11 | `37de107ed5` | `H_S_R_INTERFACE_FOUNDATIONS_DRAFT.md`（L12，#47） | SI-02 | 「**新增任何工具名都是冻结面变更**：§7.2 清单与权限矩阵在 ARCHITECTURE.md 内，落地需走冻结变更流程 + Frozen-Face-Review: 人工标记 + tests/tools/permissions.test.ts 的禁止操作清单同步」 |
| C-12 | `37de107ed5` | `H_S_R_CHECK_SCHEMA_DRAFT.md`（L25/L106，#47） | SCR-03 / SCR-74 | 「三个版本字段（contract_version、schema_version、rule_set_version）**全部必填**」「规则集变更一律 bump rule_set_version……历史报告按其钉住的旧版本重放」 |
| C-13 | `37de107ed5` | `H_S_R_SCHEMA_FOUNDATIONS_DRAFT.md`（L141，#47） | SF-72 | 「需要新的历史事件族时，那是**另一次**冻结面变更 + 独立评审，不得借道本层」 |
| C-14 | `37de107ed5` | `H_S_R_SCHEMA_DECISIONS_DRAFT.md`（L17，#47） | SD-07 | 「五类对象的追加语义与既有 20 个事件词汇并非一一对应，硬塞会迫使领域语义迁就事件名」 |
| C-15 | `d2f19cc` | `CONTRACTS.md`（L462-463） | §16.2 | 「ledger 行的 actor 列由**机制**从本事务已验证主体写下——**签发主体是机制事实，不是载荷字段**；包 3 起 authority_basis 同理」 |
| C-16 | `d2f19cc` | `CONTRACTS.md`（L449-458） | §16.2 判据③ | 「授权取证，先于对象解析……证据 {axis, capability, authorized} 写入 ledger 新列 authority_basis——**机制独占写入**」 |
| C-17 | `d2f19cc` | `CONTRACTS.md`（L406-410） | §16.2 轴值判据（D-26） | 「登记的轴名**不得是机制自身权限轴**（至少 space-write、capability-admin）」 |
| C-18 | `d2f19cc` | `CONTRACTS.md`（L597-599） | §16.2 投影信任模型 | 「**禁止**按当前配置对历史事件做静默重解释——两个方向都不许偏」 |
| C-19 | `d2f19cc` | `CONTRACTS.md`（L641-663） | §16.3 D-27 真修 | 「预留五名：复用正式事件名已有的预留通道与同一拒绝码……机制自身的五个写点……走实现内部直写、不经通用通道 ⇒ 预留不误伤机制」 |
| C-20 | `d2f19cc` | `CONTRACTS.md`（L77-78） | §6 | 「无法解析的原始材料仍可登记，保留来源；**不产生对象**」「接纳失败只拒绝，**绝不删除**原始输入」 |
| C-21 | `d2f19cc` | `READINESS.md`（L245） | F-G6A-2 | 「**核的是『有一个 actor』，不是『这个 actor 有权』**」 |
| C-22 | `d2f19cc` | `READINESS.md`（L248） | F-G6A-5 | 「计数**合法流量可淹没**（1 投毒 + 5 合法 = 同一个 6）且**不落任何持久工件**……没人盯回声就没有发现」 |
| C-23 | `d2f19cc` | `attacks/review/RE-REVIEW-G6-A.md`（§① 1c 行） | 裁决位① | 「当前默认策略 = 名单外事件名默认可写（deny-by-exception）……『没洞』是巧合，不是设计」 |
| C-24 | `d2f19cc` | `attacks/review/RE-REVIEW-G6-A.md`（#13 行） | 建议#13 | 「auditRequiredIntegrity() 每次运行**落一条机制事件**（新预留名 integrity-audit-recorded……）把『一次性回声』变成**可回看的持久记录**……新机制名必须走封闭名单，不能又是一个默认可写的字符串」 |
| C-25 | `d2f19cc` | `attacks/review/RE-REVIEW-G5-A.md`（新洞1 节） | 预留对照 | 「**预留机制已存在**，只是三个机制审计名没有登记进去……修法是补全已存在的机制，不引入新中心耦合」 |
| C-26 | `d2f19cc` | `attacks/review/RE-REVIEW-G2-A.md`（L78） | 复审要求③④ | 「第④条已兑现（actor 机制落账 + policyVersion 冻结判据表）；**第③条只兑现了一半**……判据依旧认载荷自称」 |
| C-27 | `d2f19cc` | `G1-CONTRACT-DESIGNS.md`（C.7-2） | 第六轮裁定 | 「名单与事实**必须异源**才有机验力，这条同时约束 C2 的实现选型」 |
| C-28 | `d2f19cc` | `G1-CONTRACT-DESIGNS.md`（C.7-1/-3） | 第六轮裁定 | 「deny 的对象是『冒充正式事件的**写入**』，不是『看不懂的材料进入库』」「不允许为统一命名重写既有 History Ledger」 |
| C-29 | `d2f19cc` | `G1-RECONCILIATION-CHECKLIST.yaml` | G1-STORAGE-02 | 「『从 SCHEMA 源码删除触发器定义+REQUIRED_TRIGGERS 名单项』的洗白形态只被 files_sha 身份锚挡住，digest 判据对它为设计外真空」 |
| C-30 | `d2f19cc` | `CONTRACTS.md`（L424-431） | §16.2 包 4 纠正 | 「停用判据是进程内即时、跨进程最终一致」一致性窗口 = 停用前启动的全部常驻进程 |

---

## 1. EA-1 三类事件的封闭划分

### 1.1 定义与一句话边界

三类事件**封闭覆盖**全部合法写入；不存在第四类可写来源（EA-1.2.2）。

- **机制事件（Mechanism Event）**：机制自身运行事实（启停、移交、注册、修订、回填、原始记录落账、
  审计运行、遮蔽聚合），名字在**机制封闭名单**内，唯一作者 = 机制实现内部直写（C-19 先例）。
- **领域事件（Domain Event）**：领域对既有对象的正式业务声明，**唯一 Capability 所有权**
  （EA-3 注册表），唯一写入口 = 归属能力窄面的授权签发 Port（§16.2 现状的正式化）。
- **Raw Intake 信封（Raw Intake Envelope）**：未解释、未接纳的原始材料载体（C-04/C-09/C-10：
  「落为 H 原始记录（保留原文与来源），不冒充正式对象」），**不是一种事件类型**——它没有事件语义，
  机制不解释其内容；它的台账行借用一个机制封闭名单内的固定名（EA-1.2.3）。

三类边界一句话：**机制事件是「机制自己干了什么」，领域事件是「领域对对象声称了什么」，
Raw 信封是「库收下了什么还没人解释」——第三类永远不因「看不懂」被拒收，前两类永远不因「通道不对」被放行。**

### 1.2 分类器与封闭性公理

EA-1.2.1 运行时分类器（唯一判据点；拒绝面只许消费它的输出）：

「classifyEventType(eventType: string):
   | { cls: 'mechanism' }                                       // ∈ 机制封闭名单（§2.4 锚文件为唯一正源）
   | { cls: 'domain', owner: CapabilityId }                     // ∈ Event Ownership 注册表（EA-3）
   | { cls: 'unregistered', owner: null }                       // 两侧都不在 ⇒ 一切通用通道拒写

注：Raw 信封的 declaredType **不进分类器**——它是载荷数据（EA-1.3），不是事件名。」

EA-1.2.2 **封闭性公理**：任何到达 ledger `event_type` 列的字符串，必须已被分类为
`mechanism`（且写入方 = 机制内部）或 `domain`（且写入方 = 注册 owner 的签发 Port）；
`unregistered` 在任何通用通道一律拒（拒绝形状见 EA-2.3）。这把 C-23 点名的
「名单外事件名默认可写（deny-by-exception）」翻转为 **deny-by-default**。

EA-1.2.3 Raw 信封的台账行固定名 = 「raw-record-declared」（机制封闭名单成员，机制内部直写）。
信封自身的 Port 与形状：

「interface RawIntakeEnvelope {
   readonly recordId: string;                     // 记录标识（保留前缀判据不变，D-21/`RECORD_ID_RESERVED` 仍适用）
   readonly declaredType: string | null;          // 材料自称类型：机制**不解释、不登记、不据以命名**（数据就是数据）
   readonly origin: { readonly sourceRef: string | null;      // 来源引用或 null（不得由系统猜测来源，#42）
                      readonly medium: string;                // 'text' | 'bytes' | 'file-ref' | …（不透明标签）
                      readonly capturedAtMs: number | null }; // 采集时间（与登记时间分槽，#44 四类时间）
   readonly body: string | Uint8Array;            // 原文/原始字节——「原文不被解释污染」（#42 原始材料子型）
   readonly intakeNotes?: { readonly parseAttempt: 'UNPARSEABLE' | 'PARSE_FAILED' | 'STRUCTURED_INVALID';
                            readonly reportRef?: string };   // 解析尝试结局引用（每次尝试新增记录，#44 §7.2）
 }
 declareRawIntake(a: RawIntakeEnvelope): CommitSequence;   // 唯一入口；scoped 与 assembly 可达」

现状映射（登记为插件可见面收紧）：现 `declareRecord(recordId, eventType, payload)` 的 `eventType`
参数**降格为 `declaredType` 数据字段**，不再进 `event_type` 列；历史行的 `event_type` 一字不动
（EA-5）。原文全文留存位置（`records` 表 vs 载荷内联）属存储 DDL 选型，G2 真实 DDL 前不定，
但「原文与来源必须可保存」是本合同冻结的语义下限（C-04/C-20）。

**EA-1.3a `declaredType` 旁路封闭判据**（父席限定③，2026-10-31 通信裁定；「`declaredType` 是调用方
可控字符串，不封形状就会长成新的旁路输入面」的正面处置）：

- **形状上限**：`declaredType`（null 或）匹配「^[A-Za-z0-9][A-Za-z0-9.:+/-]{0,127}$」——至长 128、
  禁控制符/空白/非 ASCII。此判据是**传输层形状卫生**，与 #44 §7.2 许可 Raw Intake 核验
  「访问与基本写权限、大小限制」同型，**不是**对材料含义的判断（含义仍不解释）。
- **畸变仍收**：超限/字符集外的 `declaredType` ⇒ 以「`declaredType:null` + `intakeNotes.parseAttempt:
  'PARSE_FAILED'`」落账、**整封照常接收**——B-1 不得因元数据形状缺陷翻转为拒收；原文照存。
- **三不参与**（机验方向）：`declaredType` **不参与任何授权判定**（不进 `classifyEventType` /
  `principalCan` 的任何输入位）、**不参与路由**（不进 ns / kind / 路由键）、**不进索引键**
  （不落 ledger 列、不落任何索引/唯一约束，只出现在 payload JSON 内）。机验 = 构建期扫描断言
  intake 通路中「索引列 / 路由参数 / 授权入参」三类调用点对 `declaredType` 零引用；
  夹具 T-P3 钉「分类器在整个 intake 路径零调用」，T-N8 钉「拿它过预留闸 = 契约违例」。

### 1.3 「正式事件拒写 ≠ 原始材料拒收」逐条边界

| # | 场景 | 判定 | 依据 |
| --- | --- | --- | --- |
| B-1 | `declaredType` 完全不认识（未来格式、乱码、外来 schema） | **收**：`declareRawIntake` 成功，台账行 `raw-record-declared`，原文与来源完整保存；**永不**出 `EVENT_AUTHORITY_REQUIRED` | C-04「即使 S-L0 无法解析仍保存为原始记录」+ C-28「deny 的对象是『冒充正式事件的写入』，不是『看不懂的材料进入库』」 |
| B-2 | 通用通道写未登记事件名 | **拒写**（`EVENT_AUTHORITY_REQUIRED`）；若同一事务此前已落 Raw 行，Raw 行**零删除**（回滚只回滚本事务） | EA-1.2.2 + C-20「接纳失败只拒绝，绝不删除原始输入」 |
| B-3 | 有空间写权、无业务授权轴的主体签发领域事件 | **收为未生效声明**：行落库、见证 `authorized:false`、永不计入投影——不是拒收 | C-05 / C-07 SP-09(a) + §16.2 判据③「取证结论为未授权不是拒写」 |
| B-4 | 无空间写权 | **完全拒收**：四表零变化（Raw 也不进）；拒绝原因是空间写权缺失，**与类型是否认识无关** | C-07 SP-09(b) + §6「无写权 ⇒ 连 Raw Intake 也完全拒绝，四表零变化 [实测]」 |
| B-5 | 能解析但结构不合格 | **收**：可保存，报告 NOT_ACHIEVED，不得读成 PASS | §6「能解析但不合格的对象必须可保存」+ C-09 |
| B-6 | 接纳（Admission）中途失败 | 本事务原子回滚；**已有 Raw 原文行不受影响** | C-20 + #44 §7.2「每次尝试的输入/解释器版本/结局都新增记录」 |

**反向护栏（机验）**：Raw 通道对 `declaredType` 的任何取判都不得产生
`EVENT_AUTHORITY_REQUIRED`——夹具以 T-N8 钉「预留闸把未识别类型连 Raw 通道一起拒掉 =
把命名权威用成存在性 oracle」的形态必红（C-28 原文的机验化）。

---

## 2. EA-2 运行时默认预留

### 2.1 判定

机制事件名命名空间**默认预留**：预留不再是「枚举五个已知名字」的补丁，而是分类器的默认语义
——`mechanism` 类名字对一切通用通道恒拒，`unregistered` 名字对一切通用通道恒拒；
只有「机制内部直写」与「归属能力签发 Port」两条窄门分别对两类开放（C-19/C-25 先例：
「预留机制已存在……修法是补全已存在的机制，不引入新中心耦合」）。

### 2.2 通道 × 类别矩阵（唯一合法写面）

| 通道 | mechanism | domain | raw（信封） |
| --- | --- | --- | --- |
| `appendLedger`（含 assembly） | 拒 | 拒（导流至签发 Port） | 拒（导流至 `declareRawIntake`） |
| `NamespaceWriter.write()` 的登记式台账行 | 拒 | 拒 | 拒 |
| `NamespaceWriter.appendAuthoritativeEvent` | 拒 | **仅 owner 能力可写**，带见证 | 不适用 |
| `declareRawIntake` | 不适用（固定名由机制内部落） | 不适用 | **唯一入口**（需空间写权，B-4） |
| 机制实现内部直写（ledger insert 原语） | **唯一合法作者** | 禁（机制不得代签领域事件） | 固定名 `raw-record-declared` 的落账 |

通用 `appendLedger` 在切换后**没有面向插件/用例层的合法事件写点**：它收敛为机制内部原语。
原经它落协调台账行的用例层路径改为「把协调行登记为某能力的领域事件、经该能力签发 Port 在
同一条事务内写」（§16 D-19c 的 `writerOwningKind` 委派形态原样承载，Q40 不破；
`D-19c-ALLOWED` 签字清单随迁移批重排，登记为实施批义务，非语义变更）。

### 2.3 拒绝码与消息形状（接 `EVENT_AUTHORITY_REQUIRED` 现状）

拒绝码**不新增**（§14.2 封闭集纪律）：三处现状写点（`kernel.ts:877/:962/:1249`，已实测 detail
形状）统一升级为下面的 detail 合同——只回显调用方自己的输入与机制本地可判事实，
不含任何他空间存在性判定（E-01 家族的既有纪律）：

「Refusal('EVENT_AUTHORITY_REQUIRED', {
   eventType: string,              // 回显调用方输入的名字
   channel: 'appendLedger' | 'write' | 'appendAuthoritativeEvent' | 'declareRawIntake-input',
   capability?: CapabilityId,      // 端口能力（有端口时）
   owner: CapabilityId | null,     // 归属账内的 owner；未登记 = null（同空间机制事实，非跨空间泄露）
   classification: 'mechanism' | 'unregistered' | 'owned-by-other',
   reason: string                  // 静态文案（三条之一：机制名直写专属 / 未登记先登记 / 归他人所有）
 })」

空间写权缺失走既有授权拒绝路径（B-4），不用本码；「自带见证字段」的输入畸变也复用本码
（detail.reason = 'input-carries-witness-field'，见 EA-4.3），封闭集不因本合同扩张。

### 2.4 新增机制事件名的流程（冻结面变更；SI-02 同型）

借 C-11（SI-02：「新增任何工具名都是冻结面变更……冻结变更流程 + Frozen-Face-Review: 人工标记 +
禁止操作清单同步」）与 C-13（SF-72：新事件族 = 独立评审）的**流程同型**——注意平面：二者判的是
V1/HSR 面的工具名与事件族，**没有裁 V3 机制名**（F-1/B6 教训），本节是本侧车面的自立规则：

1. **提案**：新机制事件名只允许来自「机制将新增一个可观察运行事实」的提案（禁止为领域语义私造机制名）。
2. **人工裁定**：由**用户**（或用户指名代表）批准；批准以「Approved-By: <日期> <非作者>」标记写入
   锚文件 §6.1，且批准者 ≠ 实现者。
3. **锚文件先行**：名单唯一正源 = `g1/EVENT-CONTRACT-LEDGER.json`（EA-6.1），新名先入账、
   **独立提交**、与实现代码不同提交；提交信息带 `Event-Name-Review: <日期> <批准人>`（对齐
   `Frozen-Face-Review:` 的仓内既有惯例，AGENTS.md §5）。
4. **异源对账必过**：EA-6 的 R1/R2/R3 构建判据绿（名单 ↔ 写点双向 + 反自证）。
5. **护栏同批**：新名进预留的反例测试（通用通道 mint ⇒ `EVENT_AUTHORITY_REQUIRED`）与
   正例（机制内部写成功）与实现**同批**落地（D-27 教训：「新写面若无触发器/预留同批，就是下一个洞」）。
6. **重锚登记**：涉及触发器/打开判据时按包 3/5/6 先例 `SCHEMA_VERSION` 推进 + fail-loud 旧库。

**封闭名单 = 锚文件为唯一正源，不采用前缀规则**（裁决：存量机制名 `object-revised`/
`record-backfilled` 按 EA-5 原名保留、无前缀；前缀规则会让它们「形状上不像机制名」，制造
分类双源。封闭、可机验、异源的名单已经满足 SI-02 想买的性质，前缀只是其中一种实现且与存量冲突）。

机制封闭名单·**已入账**成员（= 锚文件 `class:'mechanism'` 且 `planned:false` 全集；夹具与本表逐等）：
<!-- EA-2 MECHANISM-CLOSED-LIST-BEGIN -->
「capability-enabled · capability-disabled · capability-transferred · object-registered ·
check-report-recorded · object-revised · record-backfilled」
<!-- EA-2 MECHANISM-CLOSED-LIST-END -->
其中前五名 = 包 6 既有预留（C-19，批准面 = `CONTRACTS.md` §16.3/D-27 的既有评审事实）；
`object-revised`/`record-backfilled` = 存量机制写点就地升格（EA-5.2，**不是新增名**，历史行同名同判）。

**【R-5 更正段｜2026-11-01；台账 `G1-CONTRACT-RECONCILIATION.md` R-5；本表与 EA-7.1/RL-2.2 同批】**
上面这个块旧作「首批成员（10 名）」并含 `raw-record-declared`/`integrity-audit-recorded`/
`read-shadow-recorded` 三名，其批准面旧写「批准记录 = 本合同」。**该批准面作废**：唯一有效批准 =
本节步骤 2 的人工标记（锚文件 `approved[]` 里一条「Approved-By: <日期> <非作者>」+ 提交 trailer
`Event-Name-Review:` 两处同现，§6.1 批准三要素），而 **G1 冻结评审尚未发生**
（`G0-R-CLOSURE.md` = NO-GO）⇒ 本契约及任何分契约**都不得自称已批准**；「名单的形状与判据由本契约
裁定」成立，但**判据 ≠ 批准**。因此三名自本段起降级为**提案未入账**（形状/类别/写点/判据仍由本契约
裁定，运行时名单不含它们）：

<!-- EA-2 PLANNED-PENDING-LIST-BEGIN -->
「raw-record-declared · integrity-audit-recorded · read-shadow-recorded · ns-relocated」
<!-- EA-2 PLANNED-PENDING-LIST-END -->

- 逐名 `gated_by`：`raw-record-declared` → `EA-1.2.3`（本契约新裁名）；`integrity-audit-recorded` →
  `EA-7.1`（C-24 建议转正）；`read-shadow-recorded` → `EA-7.2`（本契约新裁）；`ns-relocated` →
  `gated_by:'G1-NS-01'`——`ns-relocated`（DESIGN B.5-5）在 G1-NS-01 裁定前不入名单，锚文件以
  `planned:true, gated_by:'G1-NS-01'` 占位（B 面名称自裁；其提案文书侧的同一更正写在 RL-2.2）。
- **未入账期间的语义（fail-closed，不靠约定）**：分类器对四名给 `unregistered` ⇒ 通用通道 mint 拒
  （EA-2.2 既有默认，无放行窗口）；**机制内部直写通道同样拒**——装配期依赖这些名的写入口
  （Raw Intake 落账、审计持久化、遮蔽落账、重定位落账）在未批准期间 `ACTIVATION_IMPOSSIBLE`
  （与 FM-7「名册缺项 = 装配红」同族同码），已收材料/已做校验不丢，只是**台账行写不下去**。
  如实写明代价：这四名的 `Approved-By` 落地是**用户动作**，且是 G2 任何依赖它们的写面 PR 的
  **进入门禁**（不是「先落码后补批准」的退出门禁）。
- **不得反向解释**：本节不是把 C-19 五名或存量两名的既有批准面重开——那七名的批准面在上一段，
  本段只处理「由本组契约新造、且除本组契约外无批准记录」的名字。

### 2.5 诚实边界

- 裸面（`port.raw`/裸文件）可连台账一起伪造：预留使**插件可达 mint 归零**，裸面伪造「必须在
  见证列撒谎、痕迹不可删、处置归运维/审计」（§16.3 原文界，不重写不夸大）。
- 预留名单编译期随源码固化 ⇒ 旧进程不可能「不认识自己带来的机制名」；动态部分（领域归属账）的
  跨进程陈旧见 §9.2-⑤（D-25 同型实话，C-30）。

---

## 3. EA-3 Event Ownership 注册表（唯一所有权）

### 3.1 形状与 Port 签名

「interface EventOwnershipEntry {
   readonly eventType: string;                    // 不透明字符串；Kernel 不解释业务语义（#44 §5.2 业务无知）
   readonly ownerCapability: CapabilityId;        // 唯一 owner（单 Space 同一时刻唯一权威写者，Q44）
   readonly requiresAuthority: AuthorityResource; // 业务授权轴（不透明串）；缺省不存在——见 3.2 缺轴即拒
   readonly truthSource: 'ledger-payload' | 'ledger-referenced-store'; // C-03 唯一真源字段
   readonly interpretationRuleSetVersion: string; // 读者钉版本（C-12 SCR-74 同族）
   readonly contractVersion: ContractVersion;     // 该事件类型的解释契约版本（C-12 SCR-03 同族）
   readonly approval: { readonly approvedBy: string; readonly approvedOn: string; readonly anchor: string };
   readonly retired?: boolean;                    // 退役标记：只标不删，历史行读面不变（EA-5）
 }

 interface EventOwnershipRegistry {
   lookup(eventType: string): EventOwnershipEntry | null;
   entries(): readonly EventOwnershipEntry[];
   // 注册只在装配期发生（装配根执行清单登记）；运行期无注册写面：
   snapshot(): EventOwnershipSnapshot;            // 供审计复算（EA-4.6）与对账（EA-6）
 }」

归属账本**一本**：现 `PluginManifest.ownsEventTypes`（§16.2）扩形为本 `EventOwnershipEntry`，
不另立第二本「域名账」（C.5-2 裁决）；登记判据与 `ownsKinds` 同族。

### 3.2 注册判据（按序判定，全部装配期、零装配副作用）

沿用 §16.2 既有判据并封闭成序：① 同一 `eventType` 被两个能力登记 ⇒ `AMBIGUOUS_AUTHORITY`
（拒绝**装配**，不是运行期竞抢，CP-1 先例）；② 认领机制封闭名单内名字 ⇒ `AMBIGUOUS_AUTHORITY`
（包 6 既有：否则「窄面正式通道」成为预留的第二 breach）；③ 缺 `requiresAuthority` ⇒
`ACTIVATION_IMPOSSIBLE`（缺轴的正式事件永远无法产生授权证据，fail-closed）；④ 轴值 ∈ 机制自身
权限轴（`MECHANISM_RESOURCES` 排除谓词，C-17/D-26）⇒ `ACTIVATION_IMPOSSIBLE`；⑤ owner 能力
未激活 ⇒ `CAPABILITY_INACTIVE`。归属账按能力 id 记，**不随路由停用而消失**（§16.2 原文）。

### 3.3 双重权威禁止的机验判据（装配期四断言，夹具 T-N6/T-N7 对应）

「OA-1  ∀ eventType：|owners(eventType)| ≤ 1（multiset 判重，禁止「后注册覆盖前注册」）
 OA-2  ownership 名单 ∩ 机制封闭名单 = ∅（双向：manifest 不得认领机制名；机制侧不得把机制名写进归属账）
 OA-3  truthSource 每 eventType 恰一：'ledger-payload' 直存载荷；'ledger-referenced-store' 必须在
       机制注册过不可变引用解析器——两者都不许出现「领域事件表一份、Ledger 另一份」（C-03）
 OA-4  Raw 固定名 raw-record-declared 只存在于机制名单；任何 manifest 认领它 ⇒ AMBIGUOUS_AUTHORITY」

### 3.4 变更审批

- **新增领域名**：清单变更 = manifest diff + 3.2 判据 + 领域 owner 的批准记录入 `approval` 字段
  （与 EA-2.4 机制名流程分轨：机制名走用户裁定 + 锚文件；领域名走 owner 清单登记 + 装配核）。
- **移交**：唯一合法形态 = `capability-admin` 轴、受控、可审计、原子（Q44/#44 §5.2「迁移记录与
  数据/路由更新原子一致」）；归属账变更与路由变更同事务（复用包 5 审计先行 + 同事务原子纪律）。
- **退役**：`retired:true` 只标不删；`retired` 名字不可再新写（`EVENT_AUTHORITY_REQUIRED`），
  历史行读面与解释一字不动（EA-5）。
- **改名**：**不存在改名通道**——「退役旧名 + 登记新名」是两个名字的两次登记，任何情况下不得
  回写历史行的 `event_type`（EA-5.1）。

---

## 4. EA-4 授权证据与 AuthorizationContext

### 4.1 为什么「字段相等」不够（先立论，再给形状）

`ledger.actor == authority_basis.actor` 只是**同一次写入里两个字段互证**——伪造者若两只手都伸得进
这两个字段，等式恒真。「有一个 actor」不等于「这个 actor 有权」（C-21），单条等式与
`REQUIRED_TRIGGERS` ↔ SCHEMA 同源自证是**同一族缺陷**（C-27/C-29：名单与事实必须异源）。
G2-A 已实测同族的载荷侧半扇门：判据从 `note` 换到结构化字段仍认载荷自称（C-26）。所以本合同把
证明力从**数据等式**移到**生成过程**：actor、capability、axis、authorized、规则/契约版本必须在
**同一个授权上下文、同一个取证点、同一条事务、同一个已验证主体**上由机制一次写全（C-01「统一
业务授权入口」的机制落点 + C-15/C-16 既有立场的推广）；且**领域写入 Port 的入参面没有任何字段
可以携带见证**（EA-4.3 结构性质）。等式仍然核，但它降级为「过程完整性的事后校验位」，
不再是证明本身。

### 4.2 AuthorizationContext（信封内容，机制独占生成）

「interface AuthorizationContext {
   readonly ctxId: string;                  // 本次签发唯一（机制发号）
   readonly actor: ActorId;                 // 本事务已验证主体（宿主注入；载荷不可填，C-15）
   readonly capability: CapabilityId;       // 签发端口能力（归属账核对过的那个，EA-3）
   readonly axis: AuthorityResource;        // 取自归属账的 requiresAuthority（不透明串）
   readonly authorized: boolean;            // principalCan 取证结论；false 不拒写（B-3/C-05），只决定投影
   readonly ruleSetVersion: string;         // 签发时生效的规则集版本（C-12：入信封）
   readonly contractVersion: ContractVersion; // 签发时生效的契约版本（C-12：入信封）
   readonly issuedAtMs: number;             // 机制时钟（登记时间，与描述时间分槽，#44 四类时间）
   readonly txSeq: CommitSequence;          // 同事务内登记序（把「同一事务」做成可核事实）
 }」

### 4.3 单点生成与 Port 入参封闭（「不得自带见证」是结构性质，不是纪律）

- 唯一构造器 `issueAuthorizationContext(...)`：模块内私有，只被 `appendAuthoritativeEvent` 与
  机制内部审计/路由写方调用；顺序 = 归属核对 → 激活核对 → **取证（先于对象解析，C-02/#44 §5.1）**
  → 对象/修订解析（§16.2 判据 ①–⑤ 序原样保持）。
- **领域事件写入 Port 的入参字段集封闭**（现状 `appendAuthoritativeEvent`「入参里没有能填这一列的
  字段」的推广，C-16）：「appendAuthoritativeEvent(a: { eventType; objectId; revision; payload;
  describedAt? })」之外，`actor/authority_basis/ruleSetVersion/contractVersion/ctxId/authorized`
  一律**不在类型面存在**；运行时守卫按白名单字段严格拒绝携带见证字段的输入
  （JS/`as unknown as` 面，D-17/N3 教训：类型面不是墙）——拒绝复用
  `EVENT_AUTHORITY_REQUIRED`，detail.reason = 'input-carries-witness-field'。
- 机验：构建期 Port 形状检查（字段集 ⊆ 白名单）+ 运行时负例（T-N2）双向钉。

### 4.4 信封落账

`ledger.authority_basis` = `AuthorizationContext` 的 JSON（**增 `actor` 字段**：F-G6A-2 的修法
「机制侧信封增写 actor（取证同源）」在此转正）。列本身仍是 JSON 文本列 ⇒ 形状加字段**不动 DDL**、
不推 `SCHEMA_VERSION`（如实声明，防「每个变更都要版本推进」的误读）；历史行的旧信封（无 actor）
一字不动，其解释见 EA-5.2 第 3 行。

### 4.5 一切消费见证的闸门的机验全形

闸门（存储层触发器与审计面共用同一判据函数；abort 消息词是**存储层信号文本**，不进 `RefusalCode`
封闭集——包 5 的区分原样沿用）：

「gateFullShape(row) ⇔
   row.actor ≠ NULL
   ∧ parse(row.authority_basis) 为 AuthorizationContext **全形**（九字段齐、类型对）
   ∧ envelope.actor = row.actor                                  // 同源一致性（F-G6A-2 修法转正）
   ∧ 轴判据**三分**（封闭覆盖；每一支都是谓词，闸内**不写任何事件名清单**）：
       ① 正式领域事件：classify(row.event_type) = 'domain'
                        ∧ envelope.axis ∉ MECHANISM_RESOURCES
       ② 路由/运维审计（既有触发器形态原样钉住）：
                        classify(row.event_type) = 'mechanism'
                        ∧ envelope.axis = 'capability-admin' ∧ envelope.authorized = 1
       ③ 机制挂载/机制操作类审计（**覆盖式谓词，不点名轴名也不点名事件名**）：
                        classify(row.event_type) = 'mechanism'          // 名单唯一正源 = EA-2.4 机制封闭名单
                        ∧ envelope.axis ∈ MECHANISM_RESOURCES           // 机制轴集（D-26「至少」的既有方向）
                        ∧ envelope.axis = registeredMechanismAxis(row.event_type)  // 该名在册登记的机制轴（防串用）
                        ∧ envelope.authorized = 1
   ∧ envelope.capability = ownershipOwnerAt(row.event_type, envelope.contractVersion)（①类的审计复算面；
     ②③类的 capability = 该名写点的机制归属主体，由机制单点写，不做归属账复算）」

**R-2 修订段（2026-11-01；台账 `G1-CONTRACT-RECONCILIATION.md` R-2）**：本条旧式的轴判据只有两支
「`envelope.axis ∉ MECHANISM_RESOURCES`（正式事件）｜ `envelope.axis = 'capability-admin'`（路由审计）」，
在 G1-FACET-01 把机制轴 `facet-mount` 扩入机制轴集后**两式皆不满足**——挂载类审计行既不是路由审计，
又因轴在机制轴集内被 ① 排除，判据无式可依（汇编注册表 B 的 I-2）。三分修订即修此。三点如实写明：

- **② 是 ③ 的特例**（`'capability-admin'` 本身在机制轴集内），单列只为把现状 `route_change_guarded`
  的既成形态钉成可读的历史支；两支同时成立时判据等价（都要求 `authorized = 1`），不产生第二真源。
- **③ 不许退化成名单**：三支的划分只依赖三个既有正源——分类器（EA-1.2）、机制轴集
  （`MECHANISM_RESOURCES`）、名册登记的机制轴（锚文件条目）。新增机制名或新增机制轴 ⇒ 本判据
  **一字不改**；若在本闸内再写一份事件名白名单，就是把 C-27「名单与事实同源 ⇒ 失明」搬进闸门，
  按契约违例处置。
- **挂载方的显式依赖登记在同批**：`G1-CONTRACT-FACET.md` 的 FM-7 轴值段与 FM-11.2 关系表把
  「挂载见证行的全形闸依据 = 本条 ③」登记为**显式跨契约依赖**（依赖本三分修订）；本条亦点名 FM-7/FM-9
  为 ③ 的挂载方。两侧互指，任一单独回滚即夹具红（EA 夹具 S16 / FM 夹具 S12 双向机验）。

现状 `route_change_guarded` 只核 `l.actor is not null` + 轴 + authorized（C-21 点名处）；本合同
把它升到全形。**只做等式不做全形 = 半形**，半形必红由夹具变异 MUT-1 钉（§8/夹具）。
**③ 的架空同样必红**：MUT-4 把 ③ 写成「轴在机制轴集 ∧ authorized=1 即过」（丢掉名册轴绑定），
夹具 T-N12 用「机制名挂到别的机制轴上」这一负例区分——真判据拦得住，MUT-4 放过。

### 4.6 审计侧「事后能否复算」判据

「replayAuthorityEvidence(row, ownershipSnapshotAt(row), frozenRules) →
   | 'VERIFIED'            // 全形过 + envelope.ruleSetVersion/contractVersion 在冻结表内可解析
   | 'INCONSISTENT'        // 任一断言不成立 ⇒ 点名行 + 落审计事件（EA-7），**不阻塞写面**
   | 'UNVERIFIABLE_LEGACY' // 无信封的历史行：按当时语义可回放，但不产出「当时有权」的断言」

复算**只**证明：该行系经单点取证入口、在同一授权上下文一致生成，且其声称的规则/契约版本在冻结
表内可解析重放（C-12 SCR-21 三前提同族：用报告自己钉住的版本，不用当前版本回算）。复算**不**证明：
宿主主体真实性（`CONTRACTS.md` §10 未证明面）、裸面未改写（界外，处置归运维/审计）。
禁止用当前权限/当前名单回算历史行（C-18 两个方向都不许偏）。

---

## 5. EA-5 历史解释（Legacy Interpretation）

### 5.1 总则（C-28 冻结句的机验化）

- 历史事件行**保留原名、原版次（信封/载荷所钉版本）、原签发证据**；「不允许为统一命名重写既有
  History Ledger」升为机验条款：**存在任何对 `ledger.event_type/actor/authority_basis` 的
  UPDATE 路径即为违宪**（既有 `ledger_no_delete`/UPDATE 拒触发器在位，无需新增机制）。
- 读面解释按**行自己钉住的版本**查冻结判据表（C-06/C-18）；`hasOwnProperty` 查表纪律（N6/N7）沿用。
- 新写入一律走 EA-1/EA-2 新规则；「名字难看」与「名字违法」的处置都在读侧映射，不在写侧改写（C-28）。
- **EA-5.1a（父席限定②绑成的单条可测判据，2026-10-31 通信裁定）**：
  「认定预留只约束**新写入**」∧「历史读取解释**逐字不变**」∧「禁止为归类而重写 History Ledger」
  三件事是**同一条判据的三面**，机验形态：对任意切换前存在的行 `r`，
  「interpret(r, 冻结表@r.钉住版本) 与切换前逐字段等 ∧ 对 r 的任何 UPDATE 路径不存在（触发器拒，既有）∧
  classify(r.event_type)='mechanism' 只改变**未来写入**的通道判据」——三面任一违反，夹具 T-P6 当场红。
  解释器责任按名入冻结表：`object-revised` → 机制 revise 解释器（版本 r0=切换前形状 / r1=切换后同判据，
  由锚文件 `interpretationRuleSetVersion` 指名）；`record-backfilled` → 迁移器解释器（永久携带
  「回填事实」字段，B.7 句）；查表一律 `hasOwnProperty`，缺项 `UNINTERPRETED_FAIL_CLOSED`（N6/N7 课）。

### 5.2 逐名处置表（C.5-1 裁决：旧名原样**直接认定**为封闭名单成员；别名映射被否证，见 5.4）

| 名字 | 归类 | 历史读取解释 | 新写入政策 | 解释器责任与版本钉 |
| --- | --- | --- | --- | --- |
| `object-revised`（revise 写点，`kernel.ts:1231`） | mechanism（就地升格，**不改名**） | 行名不变即无读语义变更：仍是「机制登记了一次修订」；载荷语义按其写入时形状读，**不套新解释器** | 仅机制内部直写；`appendLedger`/`write()` mint 自此 `EVENT_AUTHORITY_REQUIRED`（这正是 C-23「今天没洞是巧合」的正面了断） | 读者查冻结表按行写入时的机制解释版本；无版本戳的行按「切换前」档读（5.3） |
| `record-backfilled`（`migrateLegacyRecords`） | mechanism（就地升格） | 同上：「迁移器回填了一条记录登记」原样读；**不得**因升格预留而被重解释为「合法迁移证明」——backfill 三句裁定（DESIGN B.7：默认禁止自动补造当时合法证据）在本表同样成立 | 仅迁移器（机制-运维显式通道）内部直写；通用通道 mint 拒 | 同左；迁移行必须永久携带「回填事实」字段，事后修复与当时发生之别不得抹（B.7 写死句） |
| 无信封历史行（包 3 前） | 原类别不变 | `UNVERIFIABLE_LEGACY`（EA-4.6）：按行原语义可回放；不产出「当时有权」断言 | 新行必带全形信封（EA-4.4） | 冻结判据表既有 v2 行只读语义原样保留（§16.2「v2 自此为只读历史语义」句） |
| 旧形 `declareRecord` 台账行（`event_type` 为调用方任意命名） | 历史事实 | 原 `event_type` 值原样保留为**历史名字数据**；读者不得据其推断任何现行类别归属 | 新写一律经 `declareRawIntake`（行名固定） | 读面按行时点区分（5.3 版本戳）；不做别名映射（5.4） |

### 5.3 解释器责任与版本钉住

- 依赖的既有缺口在账：`ledger` 无 `contract_version` 列（READINESS D-11 行）——本合同采认其
  建议形态「写入时盖戳（别塞进 payload）」为**新行必填**、与 PLAN §2-G1 交付④ 同批落地；
  **存量无戳行不回填**（C-12 SCR-74「历史报告按其钉住的旧版本重放」与 SF-62 不回溯同族：
  补戳 = 系统替历史补语义）。无戳行按「切换前」解释档读，读者必须能报告「此版本来自缺省档」。
- 每个机制名在锚文件带 `interpretationRuleSetVersion`；读者加载冻结解释表时逐名校验版本可解析，
  缺项 = 装配红（fail-closed，禁止「按当前版本猜」）。
- **无戳行的版本归属（R-6 收口句，2026-11-01；台账 `G1-CONTRACT-RECONCILIATION.md` R-6）**：
  本条「不回填、按「切换前」缺省档读」与裁决表 D5-c 行「历史行补 `contract_version` = **显式修补
  事件**语义（G1-VER-01）」不是互斥的两条——收口成一句写死：
  **「显式修补事件是显式、可审计的运维动作：它以追加行的方式登记「谁在何时把这行的呈现档从缺省档
  改判为某档」，只调整该行的*呈现档*且可被回看；机制绝不自动补戳（无打开期扫描补戳、无迁移器顺带
  盖章），也不得因修补而改写历史语义（原行字节与签发证据一字不动，修补只追加、零 UPDATE）。」**
  两侧对称：`EA-5.1` 的「禁止为归类而重写 History Ledger」禁的是**改旧行**，D5-c 允许的是**追加
  修补行**——「不回填」与「显式修补」因此同时成立，B 契约侧同一句写在 RL-6.1 版本行列与 RL-8.4
  （同一批落地，夹具 EA T-P9 正例 + T-N14 负例钉两侧）。

### 5.4 被否证的替代案（留痕）

「别名映射（旧名 → 新预留名的读侧映射）」被**否证**：映射层 = 在读面再造一个解释分支，
与 C-18「不得静默重解释历史」和 C-06「不套用新规则冒充旧解释」同立场相抵；且映射表自身成为
第二套命名真源（C-03）。旧名直接入名单则历史与未来的行同名同判，读面零分支。

---

## 6. EA-6 构建期对账：实际写入点 ↔ 独立批准的事件契约

### 6.1 独立正源（形状、位置、批准人、CI 取法）

- **位置**：「experiments/v3-code-architecture-poc/g1/EVENT-CONTRACT-LEDGER.json」——本契约冻结
  其路径与形状；文件本体在实施批物化（本席只建两文件的任务书边界），登记为实施批首项。
- **形状**：「{ schemaVersion: number,
   approved: { approvedBy: string; approvedOn: string; anchor: string }[],           // 人工批准记录（EA-2.4 步骤 2 的落点）
   entries: { eventType: string; class: 'mechanism' | 'domain';
              owner?: CapabilityId; requiresAuthority?: AuthorityResource;
              truthSource?: 'ledger-payload' | 'ledger-referenced-store';
              interpretationRuleSetVersion: string;
              writeSites: string[];        // glob：允许出现的实现文件集（写点白名单）
              planned: boolean;            // true = 已批准未落码（如 gated 的 ns-relocated）
              gated_by?: string }          // 挂起条目归属（如 'G1-NS-01'）
 }」
- **谁批准**：`approved[]` 每条 = 用户/非作者评审者的人工标记（EA-2.4 步骤 2/3）；机制条目缺批准 =
  对账红；领域条目以归属账 `approval` 字段为准，账 ↔ 文件互抄不一致 = 对账红。
- **批准三要素（父席限定①，2026-10-31 通信裁定的落点）**：归属目录 = 本节路径（正式仓承载见 U-1，
  G2 前以本侧车为工作正源）；批准者 = **用户或其指名代表**，且 ≠ 当次实现提交作者；变更审批标记 =
  锚文件内 `approved[]` 追加一条「Approved-By: <日期> <批准人>」+ 提交信息 trailer
  「Event-Name-Review: <日期> <批准人>」两处同现（缺一 = R 判据红）。**「名单与写入码被同一改动
  同时改掉」的机验拒止 = §6.2 R4（EVENT_RECON_COUPLING）**。机器所能达到的终点如实写明：
  R1–R4 能保证「任何时刻名单↔写点逐等、期望值必来自锚文件、语义变更必居独立提交且带独立批准标记」；
  「批准者是否真读了 diff」仍是**人认**边界——与 GT-4「改断言体 + 重锚拦到重锚为止」同界，
  不假装机器能审意图。
- **CI 取法**：对账脚本（构建门，G2 前挂本仓 `g0-gate` 流）**只读该 JSON 文件**取期望集，
  用 TS Compiler API（N3 门 1 的 `typescript-6` 别名先例）扫 `src/kernel/**` 的 ledger insert
  调用点与 `eventType` 字面量得事实集；正式 CI 落地前，本地命令与 `--reanchor` 拒写纪律同规。

### 6.2 判据（四条，全部红=构建失败）

「R1 EVENT_RECON_ORPHAN    事实集 ⊄ 期望集：写点在写名单外事件名（C-23 任意未来名的机验拦截点）。
 R2 EVENT_RECON_STALE     期望集中既无写点又无 planned:true 的条目（名单膨胀=下轮漏洞的前兆面）。
 R3 EVENT_RECON_SAMESOURCE 期望集来源不合规：对账脚本的期望集**只允许**来自 §6.1 锚文件；
    禁止从 MECHANISM_AUDIT_EVENT_TYPES、SCHEMA、REQUIRED_TRIGGERS 或任何写点所在模块计算期望值；
    脚本对锚文件路径硬编码 + 不得 import `src/kernel/**`（自身可机验：静态检查脚本 import 图）。
 R4 EVENT_RECON_COUPLING  名单与写码的**同提交耦合**拒（父席限定①，2026-10-31；异源的最后一环）：
    同一提交同时改动「机制名单的**语义行**」与「名单所约束的机制写点模块（`src/kernel/**` 的
    ledger 写入区）」⇒ 构建红。语义行 = 名单增删/owner/approved 条目；planned:true ↔ false 翻转、
    批准记录的**追加**、以及注释/排序/格式化不计（豁免表封闭列出，豁免只减不增）。
    合法流程因此被迫成形：名单变更与实现变更**必然分居两个提交**，评审者能看到「先改名单」
    与「后补写点」各是独立 diff——同 PR 允许、同 commit 禁止（CI 判据 = `git show --name-only`
    的文件集合同时命中名单文件与写点模块，且名单 diff 非豁免行）」

**R3+R4 是本节的全部意义**：名单与写入码同源 ⇒「名单与写点一起改掉」的删定义形态永远自证一致
（C-27「名单与事实必须异源才有机验力」；C-29 `REQUIRED_TRIGGERS` ↔ SCHEMA 的已实测先例——
该先例证明"异源"漏一次就重演一次）。
夹具以 MUT-3 演示同源对账在「删定义」形态下必然失明、异源对账必然点名（T-N9）。
对账脚本消费锚文件时同时核对本契约 §2.4 名单块 ↔ 锚文件 ↔ 夹具名单三方逐等（夹具 S 组结构校验
就是这三方的当场执行器）。

### 6.3 与运行时预留的关系

运行时预留（EA-2）防「插件 mint」，构建期对账（EA-6）防「机制自己的名单漂移/被删定义」。
两道判据互不替代（C3 = C1 + C2 的既有裁定），共同点：两者都必须异源于被保护的事实。

---

## 7. EA-7 「只报不阻」计数器的持久化（F-G6A-5 / G1-AUDIT-01）

### 7.1 两个机制名（本契约 = 其**提案文书**；批准归 EA-2.4，C-24 转正指判据面）

`integrity-audit-recorded`：`auditRequiredIntegrity()` **每次运行必落一条**机制事件（机制内部直写、
预留名）。`read-shadow-recorded`：读侧遮蔽计数（`hiddenByContractSkew`/`hiddenByInactiveCapability`）
的聚合落账事件。两名的 `class:'mechanism'`、`writeSites` 限定在审计/读上下文模块。

**【R-5 更正段｜2026-11-01；台账 `G1-CONTRACT-RECONCILIATION.md` R-5；旧句保留于下、以本段为准】**
本节旧题作「本契约 = 其命名**批准文书**（C-24 转正）」，正文旧写「批准记录 = 本合同（EA-2.4 步骤 2
的批准由 **G1 冻结评审 = 本条裁定承担**，落地时按流程补记 `Approved-By` 标记行）」。**自引用作废**：

- 本条**不授予批准**。它裁定的是两名的**形状、类别、写点白名单与落账判据**（= 提案的全部技术内涵，
  一字不缩），而批准的唯一落点是 EA-2.4 步骤 2 的人工标记（§6.1 批准三要素：用户或其指名代表、
  ≠ 实现者、锚文件 + trailer 两处同现）。**「本条裁定判据」与「本条即批准」是两件事**，旧句把前者
  写成了后者，等于让文书自己给自己签字，令「名单唯一正源 + 异源人工批准」的锚空转（I-5 的实况）。
- 「C-24 转正」自此准确表述为：**C-24 的建议在本契约转正为判据**（形状/写点/阈值/digest 都定了），
  不是转正为已入账名。两名在锚文件里 `planned:true`，`gated_by` 见 §2.4 提案未入账块。
- 入账前装配保持 **fail-closed**：审计持久化写入口未获批准即装配红（`ACTIVATION_IMPOSSIBLE`，
  FM-7 同族同码），F-G6A-5 的持久化修法在人工标记落地前**不得声称已上线**——这条代价如实登记，
  不用「先落码、补标记」绕过。夹具对拍：T-N13（无 `Approved-By` ⇒ 该名字不可入账、机制直写拒、
  通用通道走 `unregistered` 拒；标记落地后同一调用成功）。
- 同一更正的同族句写在 RL-2.2（`ns-relocated` 由「本契约即批准文书」降级为「提案文书」）；
  FM-9 的写法（「本合同是命名提案…本身不构成入账」）是**标准形**，本段向它对齐，A 侧条文不动。

### 7.2 落账形状与阈值裁决

「// integrity-audit-recorded 载荷（机制内部直写；插件读面不可见，装配根/运维面可查）
 { runId, trigger: 'open' | 'audit-call',
   counts: { checked, violations, softChecked, softGhosts },
   violationsDigest: string,      // 违规目标集（排序后）的 sha256——只给集合指纹不给身份
   softGhostsDigest: string,      // 幽灵目标集指纹（同上）
   drift: { routeDirMismatchCount: number, relocationGapCount: number } | null,  // G1-NS-01 落地后加维
   schemaVersion, ruleSetVersion }

// read-shadow-recorded 载荷（聚合落账）
 { capability, windowStartSeq, windowEndSeq,
   hidden: { byContractSkew, byInactiveCapability },
   targetsDigest: string }」

读侧落账裁决（一过性回声 → 持久痕迹的最小代价形态）：满足「该能力首次出现非零遮蔽」或
「距上次落账后非零遮蔽读次数达到 K = 32」即落一条；K 是**契约常量**（改值 = 动本合同冻结面，
运维不可私调大——防「把阈值调到天上去」掏空本判据）。落账**不阻塞任何读写**（C2 只报不阻语义
一字不动）。

**【R-1 更正段｜2026-11-01，跨契约对账裁决；台账见 `G1-CONTRACT-RECONCILIATION.md` R-1；旧句保留
于上、以本段为准】** 上一段末句旧作「**计数照旧进读回执**」，该句自本段起**作废**。依据 =
裁决表 D1-d 行与 C4 行（二者均为「否——裁决已定」）：#42 SP-03 要求「不得给出被屏蔽条目的
精确计数」、#47 SF-N-04 要求「不写被屏蔽计数」，故 `hiddenBy*` 遮蔽计数**退出调用方 echo 面**，
其唯一合法落点是本节的 `read-shadow-recorded` 行（内部审计通道，EA-7.4 通道封闭）。
**改的是出口，不是算法**：怎么算（按维度分别计）、K = 32 阈值、只报不阻、落账形状与载荷字段
（§7.2 `hidden: {byContractSkew, byInactiveCapability}`）一字不改；改前文本在「读回执里能看到
非零遮蔽」这一含义上不再成立。

### 7.3 合法流量淹没问题为何由此解决

C-22 的事实是「1 投毒 + 5 合法 = 同一个 6」且**不落持久工件**——不可分是回声的固有缺陷，
没人盯就归零。持久化改的是**证据形态**而非计数语义：① 每次审计/每个遮蔽窗口都是**可回看的行**，
发现不再依赖有人恰好在场盯回声；② 同数不同集 ⇒ `targetsDigest` 不同：「同一个 6」在账本上
是两个不同的 6，投毒无法借合法同框隐身；③ 相邻两行的 digest 差 = 可追溯的增量信号（谁在哪次
运行之间进了目标集），使「事后回看归因」成为可能。诚实边界：digest 不是加密承诺，小集合可被
运维面枚举——这与既有「知数量不给身份」的运维信息面同界，且本载荷**不进插件读面**（E-01 家族
的呈现裁定归 G1-READ-02，本合同只钉归属：审计面）。

### 7.4 非 oracle 判据（父席限定④：补洞不得开出新洞）

E-01/D-12 的教训是「计数回显泄露隐藏对象存在性」——审计持久化若把计数暴露给普通调用者，
就是把一过性回声升级成了**可差分的持久 oracle**。写死三条：

- **通道封闭**：`integrity-audit-recorded` / `read-shadow-recorded` 两类行**只进内部审计通道**——
  读取面 = 装配根/运维授权的审计查询（与 §16.1 审计面同界），插件读 API 与业务读面**没有**触达
  这两类行的入口；插件可见成员名集零增删（`arch-independence.test.ts` 运行时面对拍先例）。
- **响应面零差分**：普通调用者的任何响应体（含读回执、错误 detail）**不得因审计事件的存在或缺席
  而改变形状**——审计事件不新增任何键；「计数被落账」这件事本身对普通调用者不可观测。
  - **【R-1 更正段｜2026-11-01；台账 `G1-CONTRACT-RECONCILIATION.md` R-1；旧句保留于下、以本项
    新句为准】** 本项旧作「……既有 `hiddenByContractSkew` 等 echo 键是『知数量不给身份』的
    **已冻结面**（§16.3「echo 形状不加字段」句），审计事件**不改变任何既有键的取值来源**」，
    该两句自本段起**作废**。作废理由：它把「旧形态的键集」当成了冻结对象，与裁决表 D1-d/C4
    （遮蔽计数只进内部审计面、退出调用方 echo）正面冲突——若照旧句实现，`hiddenBy*` 键会随
    遮蔽发生而取值变化，正是 D1-d 要消除的「隐藏 0 / 1 / ≥2 可差分」形态。
  - **新形态（成文）**：调用方 echo 面**不含任何 `hiddenBy*` 键**——「知数量不给身份」不再是
    对普通调用者的承诺，而是**对内部审计面的描述**（计数在 `read-shadow-recorded` 行里，
    读取面归 §16.1 审计通道/运维授权）。隐藏 0 件、1 件、≥2 件三种世界在普通调用者处
    **逐字节同形**（D1-d 的负例要求）。键集**收缩**按 `CONTRACTS.md` §16 流程重登记对拍
    （C4 原句）；§16.3「echo 形状不加字段」句只禁**加**字段，撤键不在其禁内，故不作为保留
    旧键的理由。旧键集（`{hiddenByContractSkew, hiddenByInactiveCapability}`）作为历史形态记录在
    本段与台账里，G2 实现批按新形态落地并在 arch-independence 对拍中重锚。
- **暴露的唯一通道**：确需把审计信息给某个调用方 ⇒ 走**已裁决的运维授权路径 / E-01 呈现裁定**
  （G1-READ-02 复核范围既有句所辖），由呈现层在授权后映射——机制层不为此开特例读面。
  digest 的小集合枚举残余仍按 §7.3 的运维信息面同界处置。

夹具对拍：T-P7 断言「落账前后，普通调用者可见响应面的形状与取值逐字节等，且响应体**零
`hiddenBy*` 键**；内部审计通道的遮蔽行里带着那些计数」——把「持久化不扩对外信息面 + 遮蔽计数
退出调用方面」做成可执行判据，而不是修辞。反向负例 **T-N11**：把旧形态 echo 键集（带
`hiddenByContractSkew`）的响应体喂给判据 `callerSurfaceFreeOfShadowCounters()`，必判红；
配套的架空判据 MUT-5（只核「响应体里不出现审计事件名字样」，即旧 T-P7 的判据全部内涵）对同一
泄漏体**判绿**——证明本判据不是同义反复（架空必红纪律）。

---

## 8. EA-8 正反例表（可执行判据；与夹具逐一对账，id 双向一致）

| id | 正/负 | 场景 | 期望判定 | 可执行断言形状 | 夹具 |
| --- | --- | --- | --- | --- | --- |
| T-P1 | 正 | 跨 Capability 合法领域事件：cap-records 经自身签发 Port 对**他人拥有的对象**签发 `synth:fact-designation`（事件类型归属 ≠ 对象归属两根轴，§16.2） | 允许；行带全形信封 | 「write 成功 ∧ gateFullShape(row) = true ∧ replay = VERIFIED」 | run_T_P1 |
| T-P2 | 正 | 合法 Facet 挂载：扩展能力在**已登记挂载**的核心对象上写扩展行（Q45 护栏同形） | 允许 | 「mountRegistryOk=true ⇒ 放行 ∧ 计数不增遮蔽」 | run_T_P2 |
| T-P3 | 正 | Raw Intake 未识别材料：`declaredType='zzz:unknown/v9'` + 原文；另试超限/字符集外 declaredType | **收**；台账行名 = raw-record-declared；绝不出现 EVENT_AUTHORITY_REQUIRED；畸变 declaredType 置 null + PARSE_FAILED 仍收；分类器在整条 intake 路径零调用（EA-1.3a） | 「intake 成功 ∧ row.event_type='raw-record-declared' ∧ refusal=null ∧ body 逐字节留存 ∧ 超限样本落 declaredType:null∧note=PARSE_FAILED ∧ classify 调用计数=0」 | run_T_P3 |
| T-P4 | 正 | 有写权无业务轴：主体经正确 Port 签发 | 收为未生效声明：行在、authorized=false、投影不计 | 「row 存在 ∧ envelope.authorized=false ∧ countsInProjection(row)=false」 | run_T_P4 |
| T-P5 | 正 | 审计持久化：两次运行同为 6 条幽灵但目标集不同 | 落两条行且 digest 不同（淹没可分） | 「rows.length=2 ∧ sha256(setA) ≠ sha256(setB) ∧ counts 相同」 | run_T_P5 |
| T-P6 | 正 | 旧名历史行读取 + 新写切换：`object-revised` 历史行按原样读；切换后经通用通道再 mint 该名 | 历史行解释不变；新 mint 拒 | 「interpret(历史行) 与切换前逐字段等 ∧ 通用 mint = EVENT_AUTHORITY_REQUIRED」 | run_T_P6 |
| T-P7 | 正 | 非 oracle（EA-7.4）：审计落账 + 遮蔽落账各发生一次后，普通调用者读面照常查询 | 对外响应**形状与取值与落账前逐字节等**；内部审计通道行数 +2 | 「responseKeys(前)=responseKeys(后) ∧ response(前)=response(后) ∧ auditRows.length 增 2 ∧ 普通响应无 audit/shadow/digest 键」 | run_T_P7 |
| T-N1 | 负 | **无挂载伪造修订**：扩展能力对未登记挂载的他人核心对象写扩展状态行 | 拒（挂载登记缺位 ⇒ 判「无登记不放行」；挂载判据本体归 G1-FACET-01/A1，本表只钉引用形状） | 「mountRegistryOk=false ⇒ refuse(REFUSE_UNMOUNTED) ∧ 目录/状态零残留」 | run_T_N1 |
| T-N2 | 负 | **自带见证**：签发 Port 入参附加 actor / authority_basis / ruleSetVersion 字段（值还全对） | 结构拒（入参字段集封闭）；复用 EVENT_AUTHORITY_REQUIRED，reason='input-carries-witness-field' | 「任意白名单外键 ⇒ refusal 命中 ∧ reason 匹配 ∧ ledger 零行」 | run_T_N2 |
| T-N3 | 负 | **名单外机制名写入**：`appendLedger('capability-reloaded')`（未来名） | 拒，classification='unregistered' | 「refusal.code='EVENT_AUTHORITY_REQUIRED' ∧ classification='unregistered'」 | run_T_N3 |
| T-N4 | 负 | 名单内机制名 mint：`appendLedger('object-registered')` 自报 actor | 拒，classification='mechanism'（D-27 预留面的本契约再钉） | 「refusal 命中 ∧ classification='mechanism'」 | run_T_N4 |
| T-N5 | 负 | **信封 actor 不一致**：行 actor 非空、信封 actor 为他人 | 闸门全形拒 / 审计复算 INCONSISTENT | 「gateFullShape=false ∧ replay='INCONSISTENT'（而「只核非空」的半形必须放过 ⇒ 见 MUT-1）」 | run_T_N5 |
| T-N6 | 负 | 双认领：两个 manifest 登记同一 eventType | 装配红 AMBIGUOUS_AUTHORITY，零装配副作用 | 「assemble 抛 AMBIGUOUS_AUTHORITY ∧ registry.entries() 零增量」 | run_T_N6 |
| T-N7 | 负 | manifest 认领机制名（如 `raw-record-declared`） | 装配红 AMBIGUOUS_AUTHORITY（OA-2/OA-4） | 「assemble 抛 ∧ 名单逐字未变」 | run_T_N7 |
| T-N8 | 负 | **越界误用**：把预留闸接到 Raw 通道上，令未识别 declaredType 被 EVENT_AUTHORITY_REQUIRED 拒收 | 本合同判 RED——B-1 边界违例（命名权威被用成存在性 oracle） | 「declareRawIntake 路径上任何 EVENT_AUTHORITY_REQUIRED = 契约违例」 | run_T_N8 |
| T-N9 | 负 | 删定义洗白：某机制名从名单与写点被同步抹除，期望集若从写点现算则「一致」 | 异源对账 R1/R2 点名（写点没了走 R2 孤儿名单面；改写点藏名走 R1）；同源对账失明（MUT-3） | 「reconcile(ledger, sites, 'ledger-file') 报事件名点名 ∧ reconcile(..., 'derived') 报告无异常 = 被判定为不合格对账器」 | run_T_N9 |
| T-N10 | 负 | 同提交耦合（R4）：一个提交同时改名单**语义行**与 `src/kernel/**` 写点区；对照：两提交分开 / 同提交仅豁免变更（追加批准记录、planned 翻转） | 耦合提交构建红；两个合法形状放行 | 「reconcileCoupling(语义行变更 ∧ 写码变更)=EVENT_RECON_COUPLING ∧ 分开提交无违规 ∧ 纯追加批准记录无违规」 | run_T_N10 |
| T-P8 | 正 | **R-2 三分全形闸**：路由审计行（②）与机制挂载类审计行（③，轴 = 该名在册登记的机制轴）各过闸；再临时新增一根机制轴 + 一个新机制名入账 | 两支皆过；**旧两类别式对挂载行必须判不过**（证明三分是真改）；②③ 未 `authorized=1` 不过；新轴新名**不改判据一字**即被 ③ 覆盖（覆盖式谓词的定义性检验） | 「gateFullShape(路由行)=true ∧ gateFullShape(挂载行)=true ∧ gateFullShapeSuperseded2Branch(挂载行)=false ∧ gateFullShape(未生效行)=false ∧ gateFullShape(新轴新名行)=true」 | run_T_P8 |
| T-P9 | 正 | **R-6 显式修补事件**：无戳行按缺省档读；运维带人工标记追加一条修补行；同场试打开期自动补戳 | 无标记的修补被拒；带标记的修补**只追加行、只调呈现档、可回看**，原行逐字节不变；机制侧零自动补戳 | 「tier(未修补)=pre-cutover-default ∧ 无标记修补=PATCH_REQUIRES_HUMAN_MARKER ∧ tier(修补后)=patched@seqN ∧ JSON(原行) 前后逐字节等 ∧ patchLog[0].marker 含 Approved-By ∧ autoStampScan.stamped=0」 | run_T_P9 |
| T-N11 | 负 | **R-1 遮蔽计数泄漏**：把旧形态响应体（echo 里带 `hiddenByContractSkew`）作为普通调用者可见面 | 判红——遮蔽计数只进内部审计面，调用方面零 `hiddenBy*` 键 | 「callerSurfaceFreeOfShadowCounters(旧形态体)=false ∧ callerSurfaceFreeOfShadowCounters(新形态体)=true ∧ MUT-5(同一泄漏体)=true（判别力自验）」 | run_T_N11 |
| T-N12 | 负 | **R-2 串轴**：机制名挂到别的机制轴（挂载名带 `capability-admin`）；机制封闭名单外的名带机制轴；领域事件冒充机制审计轴 | 三形皆拒（③ 的名册轴绑定 + 名单合取项 + ① 的排除式） | 「gateFullShape(串轴挂载行)=false ∧ gateFullShape(名单外名带机制轴)=false ∧ gateFullShape(领域行冒充机制轴)=false ∧ gateFullShapeMUT4(串轴挂载行)=true（判别力自验）」 | run_T_N12 |
| T-N13 | 负 | **R-5 无批准标记**：`Approved-By` 未落地期间对提案名（如 `read-shadow-recorded`）分别试通用通道 mint 与机制内部直写；再模拟标记落地后重试 | 通用通道拒（`unregistered`）；机制直写**装配红 ACTIVATION_IMPOSSIBLE、零行**（不得给 `EVENT_AUTHORITY_REQUIRED`）；标记落地后同一调用成功 | 「classify(名,'proposed')=unregistered ∧ mint 拒 ∧ 直写 refusal.code=ACTIVATION_IMPOSSIBLE ∧ 账本零行 ∧ 入账后同调用 row 存在 ∧ MUT-6 放行同一未批准调用（判别力自验）」 | run_T_N13 |
| T-N14 | 负 | **R-6 自动补戳**：打开期扫描给无 `contract_version` 的历史行盖章 | 真判据下零补戳且历史行字节零改；架空形（顺带盖章）必须真的改了历史行字节 ⇒ 判据有判别力 | 「autoStampScan(历史).stamped=0 ∧ 历史逐字节不变 ∧ autoStampScanMUT7(历史).stamped>0 ∧ 历史被改（=违例形态被复现）」 | run_T_N14 |

---

## 9. EA-9 裁定记录、关系表与未决项

### 9.1 G1-EVT-01「一问四件」逐件回答

- **① 新机制名默认策略**：机制名命名空间**默认预留**（deny-by-default），封闭名单为唯一正源、
  新增走 EA-2.4 六步（用户裁定 + 人工标记 + 异源对账 + 护栏同批）；「名单外默认可写」废止（C-23 关闭）。
- **② 领域事件名所有权账形状**：EA-3 的 `EventOwnershipEntry`（`ownsEventTypes` 扩形，一本账）；
  未登记名在一切通用通道写不了（EA-1.2.2）。
- **③ actor/信封取证同源**：EA-4 全案——信封增 actor + 全形闸 + 审计复算三态；「有一个 actor」
  升级为「该行系单点授权上下文一致生成且可按钉住版本复算」（C-21 关闭路径）。
- **④ 冻结对齐**：PR-A1/SP-09 措辞直引 C-05/C-07；#44 §6.2 由 EA-1/EA-3 两根轴区分承载
  （事件类型归属轴 ≠ 对象归属轴，§16.2 原文既有立场）；跨进程陈旧的实话 = §9.2-⑤。

### 9.2 DESIGN C.5 开放问题裁定

1. **存量名处置**：旧名原样直接入封闭名单（EA-5.2），别名映射否证（EA-5.4）；冻结判据表**不加新行**
   （行名与语义未变，变的只是写通道判据，而写通道判据不在读者表内）。
2. **所有权账范围**：扩 `ownsEventTypes` 为全领域名账（EA-3）；域内自用名（夹具/测试世界）要么登记、
   要么改走 Raw 信封——**不留豁免窗**（豁免 = 名单外默认可写的残体）；存量夹具迁移登记为实施批义务。
3. **信封形状变更**：JSON 列内加字段，不动 DDL 不推版本（EA-4.4）；N1/G27-C 的「半形必红」判据与
   裸面边界断言在实现批**同批重锚**（收紧方向的重锚，逐条点名，不走静默）。
4. **审计事件名归属**：**【R-5 更正，2026-11-01；旧句保留于下、以本条为准】** 旧作「`integrity-audit-recorded`/`read-shadow-recorded` 归机制类、**本契约即批准**（EA-7.1）；`ns-relocated` 保持 planned-gated 待 G1-NS-01（C.5-4 的倒逼顺序就此解除）」。更正后：两名**归机制类**、分类与判据由本契约裁定——这部分成立；**批准不在本契约**（批准主体唯一 = EA-2.4 步骤 2 的人工 `Approved-By` 标记，且 G1 冻结评审尚未发生），两名现列 §2.4「提案未入账」块（`gated_by` = EA-7.1 / EA-7.2），入账前机制内部直写装配红（夹具 T-N13）；`ns-relocated` 保持 planned-gated 待 G1-NS-01，同族句 RL-2.2 已同步降级为**提案文书**（C.5-4 的倒逼顺序就此解除）。
5. **跨进程陈旧**：机制名单编译期固化；领域归属账装配期内存态 + 持久路由重开重载，实话同 C-30
   （D-25 家族）。**deny-by-default 的方向性红利写明**：陈旧窗口只会让旧进程「拒绝它不认识的新名」，
   不会出现「放行本该拒的旧名」——陈旧从安全洞降级为可用性角；补跨进程失效机制与否仍属 G1 余项。
6. **G1-ROUTE-01 主键维**：方向冻结为**覆盖式谓词**——「路由行的出现/变更/主键消失必须有同键随附
   见证」，不依赖事件名枚举（名单换谓词的 C.4-3 原句）；落码归 G1-ROUTE-01 实现批，执行点唯一。

### 9.3 与 #42 / #44 / #47 已裁定语义的关系（条件式纪律照 RECON-PR47 §0）

| 已裁定语义 | 关系 | 依据 |
| --- | --- | --- |
| #44 §7.1 唯一事件真源（C-03） | **一致** | OA-3 把「不并行创建第二套事件真源」做成装配期机验 |
| #44 §7.2 Q37（C-04/C-05）与 #42 SP-09/IC-H3（C-07/C-10） | **一致 + 机制化** | EA-1.3 边界表逐格可测；B-3 = SP-09(a)，B-4 = SP-09(b) |
| #44 §5.1 权限校验先于对象解析（C-02） | **一致** | EA-4.3 取证序保持「归属→激活→取证→解析」 |
| #44 §11 / C-06 历史解释（旧解释器不可用不套新规则） | **一致** | EA-5 全节；无戳行缺省档 + 不回溯 |
| #42 DF-01（C-08）登记≠接纳 | **一致** | B-3/T-P4：未生效声明收存但不投影 |
| #47 SCR-03/SCR-74（C-12）版本钉三件 | **一致（条件：#42 合并且条文文本不变）** | AuthorizationContext 入 ruleSetVersion/contractVersion；归属账钉 interpretationRuleSetVersion |
| #47 SF-72/SD-07（C-13/C-14）事件族不收口 | **无冲突 + 明确不借道** | 本合同只裁 V3 机制面名单；不声称任何跨平面合一（SF-73 同理）；HSR↔V1 平面分离由 RECON-PR47 §5 已核 |
| #47 SI-02（C-11） | **流程同型引用，非其辖域** | SI-02 判工具名；EA-2.4 借其「冻结 + 人工标记 + 同步清单」三件套自立于机制名——**不写「属 #47 决策面」**（附三 F-1/F-2 教训） |
| PoC 内部 §16.2/§16.3 | **承接不推翻** | 判据 ①–⑤、五名预留、见证优先闸、D-26 轴谓词全部原地沿用 |

### 9.4 未决与保留项（诚实清单）

- **U-1（真属用户决策，其余全部已在本文给出裁决）**：机制名单锚文件与 EventOwnership 持久表在
  **正式仓**的最终承载——进 8 份根文档冻结面、进 `schema/**`、还是留 #44 侧文档层？#47 条文原文
  「需要新的历史事件族时，那是另一次冻结面变更 + 独立评审，不得借道本层」（C-13，`37de107ed5`）
  把 HSR 层让开，而 T-GAP-09/10「本层不自行发明」把 Schema 层让回（RECON-PR47 C7/C8 实测）——
  按 B6 的教训，此处**不写「属 X」**，只登记：需用户指名裁定人 + 交付物名；在此之前，本侧车
  以 `g1/EVENT-CONTRACT-LEDGER.json` + 本文为**工作正源**（G2 前有效）。
- 已登记非悬空项：D-11 版本戳落码（PLAN 交付④同批）、`ns-relocated`（G1-NS-01）、随附审计谓词化
  落码（G1-ROUTE-01）、审计载荷呈现面（E-01/G1-READ-02 复核范围既有句「存在性 + 归属者身份 +
  登记者 + 授权见证」再 +1：审计行的 digest 属运维面信息面）、夹具世界迁移登记（实施批）。
- 本契约自身的变更纪律：§2.4 名单块、§8 表、EA-4.2 字段集、EA-7.2 阈值 K 任一变动 = 本合同冻结面
  变更，夹具（同目录 `.fixtures.mjs`）必须当场红或经名单三方逐等更新后绿，且需人工批准标记。

### 9.5 父席四条采纳与限定（2026-10-31 通信裁定，按其要求记入本裁定记录）

> 来源：父代理 `session-3e3f10a7` 2026-10-31 消息（「不停，四条我全部采纳，其中三条加限定」——
> 第四条「计数落两条机制名」为采纳 + 加限定）。四条款文均已写入正文本体（下表给落点），
> 本节只是裁定留痕，不是正文的替代。

| # | 裁决 | 父席限定 | 正文化落点 | 机验件（夹具） |
| --- | --- | --- | --- | --- |
| ① | 机制封闭名单为唯一正源、不设前缀规则 | 名单必须与写入点**异源**；给目录 / 批准者 / 审批标记 / 「名单与写码同改」的 CI 机验判据 | §6.1 批准三要素 + §6.2 **R4 EVENT_RECON_COUPLING**（语义行变更 ∧ 写点模块同提交 = 红；豁免表封闭只减不增；「人审意图」边界如实写明，不假装机器能审） | T-N10 + MUT-3 |
| ② | 旧名原样进封闭名单、别名映射否证 | 认定预留只约束新写入；历史读取解释逐字不变；两旧名各给「历史行如何解释、哪个解释器版本负责」；显式「禁止为归类重写 History Ledger」 | §5.1 **EA-5.1a** 三面合一判据 + §5.2 表（`object-revised`→revise 解释器 r0/r1；`record-backfilled`→迁移器解释器 + 永久回填事实字段） | T-P6 + S8 |
| ③ | `declaredType` 只作数据、台账行固定 `raw-record-declared` | 调用方可控字符串必须封形状：长度/字符集上限 + 不参与授权判定 + 不参与路由 + 不进索引键 | §1.3 **EA-1.3a**（≤128 + 「^[A-Za-z0-9][A-Za-z0-9.:+/-]{0,127}$」+ 畸变仍收 + 三不参与） | T-P3 + T-N8 |
| ④ | 计数落 `integrity-audit-recorded` / `read-shadow-recorded`，阈值入正文 | 两事件**不得成为存在性 oracle**（E-01/D-12 教训）：只进内部审计通道；普通调用者响应面不得含可差分计数；暴露走已裁决运维授权路径 | §7.4 非 oracle 三条（通道封闭 / 响应面零差分 / 暴露唯一通道） | T-P7 |

**本席对该限定的补充立场（一句话，防落地时被读松）**：④ 的正确读法是
「审计事件把**发现能力**从『恰好有人盯回声』升级为『账可回看』，同时把**信息面**原样封在运维侧」——
持久化扩的是内部审计的留存，不是对外可见性；两者同批落地，缺任一即本条未实现。

### 9.6 跨契约对账更正记录（2026-11-01；台账 `G1-CONTRACT-RECONCILIATION.md`）

> 来源：装配席 `G1-UNIFIED-CONTRACTS.md` §7.2 注册表 B 的硬不一致 I-1…I-6（编号对应本席的 R-1…R-6）。
> 裁决序位照 §7.1：裁决表 > 分契约 > `CONTRACTS.md` > 对账记录 > G0。本节只是留痕，正文的规范句在
> §2.4 / §4.5 / §5.3 / §7.1 / §7.2 / §7.4 本体里；**旧句一律保留原文 + 就地标注取代**（照 `CONTRACTS.md`
> D-25/包 4 更正段先例），不静默覆盖。

| 项 | 本契约侧改了什么 | 判据/夹具落点 | 状态 |
| --- | --- | --- | --- |
| **R-1**（I-1） | §7.2 末句「计数照旧进读回执」+ §7.4「既有 `hiddenBy*` echo 键是已冻结面、不改变取值来源」两条**作废并更正**：裁决表 D1-d/C4 为准，遮蔽计数**退出调用方 echo 面、只进内部审计面**。**改的是出口不是算法**——遮蔽算法、`K=32`、「只报不阻」、审计载荷 `hidden:{byContractSkew,byInactiveCapability}` 一字未动 | §7.4 新形态「调用方 echo 面零 `hiddenBy*` 键」；T-P7 反转断言 + 三态同形；新 T-N11 + MUT-5 | 已修，夹具绿 |
| **R-2**（I-2） | §4.5 轴判据二分支 → **三分**，③ 为覆盖式谓词（名 ∈ 机制封闭名单 ∧ 轴 ∈ 机制轴集 ∧ 轴 = `registeredMechanismAxis(名)` ∧ `authorized=1`），闸内不写事件名清单 | T-P8（含覆盖性自验）/ T-N12 + MUT-4；与 FM 的 DEP-EA45-3 互指（EA S16 ↔ FM S12） | 已修，两侧同批 |
| **R-3**（I-3） | 本契约零冲突，仅在 §2.4 名单侧确认「挂载登记表不是 ns 键控表」不影响机制名账 | — | 不适用（改在 RL/FM） |
| **R-4**（I-4） | 本契约零冲突（`failedGate` 封闭集是 B 契约面），只登记观察：封闭集与机制名账无耦合，改名不牵动本契约 | — | 不适用（改在 RL） |
| **R-5**（I-5） | §2.4 名单拆「已入账 7 名 + 提案未入账 4 名」两块（机器可读标记 + 逐名 `gated_by`）；§7.1 标题与正文删自授批准语义（**判据≠批准**）；§9.2-④ 同族句同步；机制内部直写通道未入账 ⇒ `ACTIVATION_IMPOSSIBLE` 装配红 | S1/S1b/S2/S2b 三方逐等 + 批准门在写入路径上；T-N13 + MUT-6 | 已修；**代价如实登记**：G2 前置是 4 个人工标记 |
| **R-6**（I-6） | §5.3 新增「无戳行的版本归属」成文收口句：修补是显式、可审计的运维动作，只调**呈现档**且可回看；机制**绝不自动补戳**，也不得因修补**改写历史语义**（只追加、零 UPDATE） | T-P9 / T-N14 + MUT-7；RL-6.1/RL-8.4 各补同半句 | 已修，两侧同步 |

**本节不改的东西（防读松）**：EA-4.2 九字段信封、EA-4.3 取证序、D-26 轴谓词的方向、EA-5.1a 合一判据、
`K=32` 阈值、EA-7.4「非 oracle」的方向本身——R-1 只是把「不进对外面」从「计数取值不变」推进到
「计数不在场」，方向同源。名单基数由「首批 10」变「已入账 7 + 提案未入账 4」⇒ 汇编席
`G1-UNIFIED-CONTRACTS.md` 的基数句需回填（本席禁改，已在台账登记为下游回填项）。

