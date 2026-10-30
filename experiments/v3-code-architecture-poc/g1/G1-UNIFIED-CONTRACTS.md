# G1-UNIFIED-CONTRACTS —— G1 统一实施契约（阶段三交付物 1–4 合订）

> 日期：2026-11-01。席位：G1 汇编席。本文件是**汇编层，不是第五份分契约**：每一条都回指分契约条文、
> 裁决表裁决行或 `CONTRACTS.md` 已登记契约事实；本文件**不新增裁决、不新增错误码、不新增事件名、
> 不含生产代码与生产 DDL**（Port 签名与表的逻辑形状属于契约本身）。
> 引用锚点：分契约 = EA（`G1-CONTRACT-EVENT-AUTHORITY.md`）/ FM（`G1-CONTRACT-FACET.md`）/
> RL（`G1-CONTRACT-RELOCATION.md`）；裁决表 = ADJ（`G1-ADJUDICATION-TABLE.md`）；
> 对账台账 = RECON（`G1-RECON-PR47.md`）；主干契约 = `CONTRACTS.md`；收口记录 = `G0-R-CLOSURE.md`。
> 跨分支条文一律经 blob 核验（#42=`0369c3196c`、#44=`5ec38974fc`、#47=`37de107ed5`；仓内锚 SHA=`d2f19cc`）。

## 0. 阅读纪律与权威序位

**0.1 输入权威序位**（汇编遇冲突按此归位，且**必须**在文末 §7 登记；分契约彼此之间的硬不一致
**只登记、不抹平、不再裁决**——再裁决权在父席与下一轮裁决表）：

1. `g1/G1-ADJUDICATION-TABLE.md`——裁决面（39 行；「否——裁决已定」行具有裁决效力；§2.0 命名声明先于一切）。
2. `g1/G1-CONTRACT-EVENT-AUTHORITY.md` / `g1/G1-CONTRACT-FACET.md` / `g1/G1-CONTRACT-RELOCATION.md`——条文面
   （各自自称管辖面内为准：事件命名与签发归 EA、挂载与双身份归 FM、重定位归 RL）。
3. `CONTRACTS.md`（含 §16/§16.1/§16.2/§16.3）——已落地契约事实与收口纪律（§14.2 封闭集纪律、包 3/5/6 先例）。
4. `G1-RECON-PR47.md`——**台账不是裁决**（其 C1–C8 的处置以 ADJ 对应行为准；台账行按记账纪律不动）。
5. `G0-R-CLOSURE.md`——范围与去向（G1 冻结 **NO-GO** 是现状；本文件是契约文书，不充当冻结通过证据；
   G1-* 残余项去向按 G0 残余表执行，本文件不新增去向项）。

**0.2 三平面纪律**（EA §0.1 原样，不重开）：V1 冻结面（根文档 + `schema/**`）不触碰，只借流程同型
（人工批准标记）；#47 HSR 层条文**一律条件式**（条件：#42 合并且条文文本不变；RECON §0 固定注记），
且 #47 自认不收口的面（事件族 SF-72/SD-07、迁移与 DDL SF §12/T-GAP-09/10）**禁止**再写「属 #47 决策面」
（ADJ D5-a 附三纪律）；V3 机制侧车（本 PoC）= 本组文件自立冻结文本。

**0.3 术语声明**（ADJ §2.0 逐字承接）：`CommitSequence` 是 #44 既有 CamelCase 类型名（L161），非我方新造；
`commit_sequence`（线格式/DDL 名）与 `storage_schema_version` 是**我方契约层新命名**（三 ref 实测零命中），
只在我方 CONTRACTS/G2 DDL/接口序列化面生效，须待上层修订流程吸收后才成为上层词；HSR 工件层
`schema_version`（#47 SCR-03，条件式）与物理存储版本两层禁混用（ADJ D3-a）。

**0.4 保证范围如实**（G0-R-CLOSURE §3）：D-23 已验证闭合的是 **Kernel 管理的 UoW 路径**；
`SqlitePort.tx()` 自身无独立失效机制，StoragePort 层受限 `TransactionLease` = **G1-STORAGE-01**（实施批
义务）。本文件所有「事务边界」条款按此定界书写，不写「StoragePort 全部消费者同等保证」（§16.1 第五轮裁定）。

## 1. 身份、权威与权限矩阵（交付物 1）

### 1.1 一张总表

| 主体 | 可达 Port / 窄面 | 可读面 | 可写面 | 存在性呈现（对外） | 审计留存（内部） |
| --- | --- | --- | --- | --- | --- |
| 领域插件（能力窄面） | `NamespaceWriter`（`face.writerFor(tx)` 取得：`createOwned/reviseOwned/linkOwned/readLatest`）；有归属时另可达 `appendAuthoritativeEvent`、`FacetMountPort` | 本能力归属行（`readLatest`/双时间读面，按归属 ns 归因） | 仅本能力拥有对象（判据 = `object_directory.owner_capability` + `registry.ownerOfKind`，机制事实零科研语义）；归属不符 ⇒ `CAPABILITY_SCOPE_ESCAPE` | `NOT_FOUND_IN_SPACE`：无权、他空间、未提交、未挂载他人 oid **完全同形**（D1-c/C1；码内不区分成因） | 其写入的权威事件行带 `AuthorizationContext` 全形信封（`authority_basis`，机制独占写列，EA-4.4/§16.2） |
| 事件属主 Capability | `appendAuthoritativeEvent`（窄门；入参封闭面） | 自己登记的事件类型（归属账 `lookup`） | 已登记 `eventType` 的事件行——目标**可为他人拥有的对象**（事件类型归属 ≠ 对象归属，两根轴，§16.2/FM-9） | 同上同形 | 全形信封 + `replayAuthorityEvidence` 三态可复算（EA-4.6）；禁止按当前配置回算历史行授权（C-18） |
| 原始材料入口主体（持空间写权者） | `declareRawIntake`（唯一入口，EA-1.3；scoped 与 assembly 可达） | 无（raw 行不进业务读面；引用与抽取走授权通道） | 仅 `raw-record-declared` 固定名行；原文与来源**完整保存**，永不冒充五类（C-04/C-09） | 无写权 ⇒ 连 Raw Intake 也完全拒绝、四表零变化，与「有写权但类型不认识」的收取**不可差分**（B-4/B-1） | 每次尝试（输入/解析结局 `intakeNotes.parseAttempt`）新增记录（#44 §7.2 承接） |
| Facet 挂载方能力 | `FacetMountPort`（五成员，FM-6；PluginFace 扩一个具名成员，无通用通道等价物） | `mountState`/`listOwnMounts`：**仅本能力自己的登记**（FM-2.4） | 挂载登记行（`FM-<seq>`）+ 扩展记录（`FR-<seq>`，按挂载登记为键）；核心表/核心边**类型面上无写点**（FM-5.1） | 非己挂载与不存在同形（`mountState` ⇒ null）；「目标的挂载方列表」读面**不存在**（FM-2.4/FM-8） | `facet-mounted`/`facet-unlinked` 机制见证（全形信封，轴 `facet-mount`，`authorized=1` 必成立——判定输入型不落未生效行，FM-2.2 如实限定） |
| Application 用例层 | `UseCaseDelegation.writerOwningKind(kind, tx)`（交出的是**对象拥有者的作用域端口**）；机制台账 `appendLedger` 按 `D-19c-ALLOWED` 行标记 | 无独立特权读面 | 同一条事务内经委派的作用域端口跨归属写（**不存在第二个权威**，Q40 不破）；不得直接持有 `createObject/revise/linkRef` 通用面（§16 D-19c） | 同形 | `appendLedger` 出现次数 == 签字次数双判据逐条签字（行标记可被下标写法绕过，计数补洞，§16） |
| 装配根（`scope='assembly'`） | `Kernel.uow`（通用事务面）、`RelocationPorts`、`setRouteEnabled`、`transferRoute`、`auditRequiredIntegrity`、`EventOwnershipRegistry.snapshot` | 机制面全表（不受插件读面判据约束，但受呈现纪律约束） | 跨域原子提交（Q40）；路由启停/移交（**不携 ns**，D-31）；重定位五要素事务（RL-1.3） | —（非插件可达面；插件面成员零增删由 `arch-independence.test.ts` 面锚对拍） | 五机制审计名预留 + `route_change_guarded` 核机制落账见证（actor 非空 + `axis='capability-admin'` + `authorized=1`，§16.3 包 6） |
| 运维 / `capability-admin` 主体 | `assertAuthority` 断言先于一切写；移交/启停/重定位提案与批准 | 运维报告面（打开期点名、隔离姿态、`verifyRelocation` 结果） | `capability_route` 三元组（不含 ns）；重定位提案/批准（批准人 ≠ 提案人，RL-3.3②）；修复提案需 `operationGrant` 在场 | 不参读面；空空间同形负例钉「不得泄漏跨空间存在性」（包 6 三码同规） | `capability-enabled/disabled/transferred`、`ns-relocated` 全部带 `capability-admin` 轴全形信封；账步 `proposedBy/approvedBy` 异体 |
| 审计者（装配根/运维授权） | 内部审计查询通道（EA-7.4 通道封闭、FM-3.1(b) 判定复算面、RL-8.2 drift 两维） | **完整区分**：真因（UNMOUNTED/NO_RIGHT/OWNER_OK/MOUNT_ACTIVE）、遮蔽计数、drift{routeDirMismatchCount, relocationGapCount}、复算三态 | 零写（只读）；`integrity-audit-recorded`/`read-shadow-recorded` 行由**机制**落账 | 不适用（此面**就是**审计面本身） | 自身即审计留存面；`ns-relocated` 伪造痕迹不可删（H append-only），处置归运维/审计（RL-6.5a 界外层） |
| 无权者 / 跨空间探测者（反主体） | 零 Port 可达 | 零 | 零（无空间写权连 Raw 都不进，§6 [实测]/B-4） | 封闭清单：`NOT_FOUND_IN_SPACE` 与中性 `OPAQUE`（Kernel 从不区分不存在/他空间/未提交；`UNVERIFIABLE_*`/`NOT_DISCLOSED` 由呈现层映射，SP-10）；跨空间读取**没有代码路径**（快照/搜索/错误形态/跨空间引用/Facet/DB 五出口，§8 [实测]） | 被拒尝试**零残留**（拒绝不落行是既有纪律，FM-3.1(b)；未来「拒绝历史可回看」须走 EA-2.4 六步另立名单项，本组契约不加） |

### 1.2 两条规范句（冻结）

「**(a) 同形句（D1-c/C1 承接）**：无权与不存在对外**完全同形**——同码、同 `detail`、同形时序；
真区别只存内部审计（复算面：挂载账 ⋈ `object_directory` ⋈ 路由激活态 + 操作类即可复算，无需额外落行，
FM-3.1(b)）。现状 `NAMESPACE_ESCAPE` 显式拒读形态按 C1 裁决**让位**，`tests/events-of-scope.test.ts`
所钉取舍在实现批更新为同形形态（裁决方向，非现状描述）。」

「**(b) 泄露封闭清单（D1-d/C4 承接）**：计数、detail 加成、水位、total/exhausted、缓存键——五类载体
**都不得成为「被隐藏的东西存在」的 oracle**。`hiddenBy*` 遮蔽计数按 ADJ D1-d 退出调用方 echo、
只进内部审计面；`exhausted` 对可见集如实。⚠ 本句与 EA §7.2/7.4「echo 键集冻结、计数照旧进读回执」
存在**条文级正面冲突**，本汇编不裁决、两侧原文并列登记于 §7 注册表 I-1。」

## 2. Port 正式签名与错误模型（交付物 2；契约形状 TS，落码归实施批）

封闭集纪律（§14.2）：新码必须论证「与既有码不同修法」；本节全部 Port 的**新增 RefusalCode 恰一枚**
（`RELOCATION_PRECONDITION`，P8），其余一律复用或降格为存储层信号文本/构建期判据信号。逐码登记见 §2.10。

### P1 SpaceContext 与事务作用域

「interface SpaceContext {
   readonly spaceId: SpaceId;               // 取值文法 = 我方契约层新命名（ADJ D1-a/T-GAP-09 自认延后交 B；四契约均未落文法，见 §7 M-4）
   readonly principal: VerifiedPrincipal;   // 装配根注入；宿主身份真实性未在本 PoC 证明（§10）
   readonly requires?: readonly AuthorityResource[];  // 业务授权轴（不透明串，SP-09 两分，CP-7）
 }」

- 空间是**文件/事务边界**（§16 首表），PoC 测试形态 = 一空间一文件；空间粒度 D-1 未决，
  **裁决前不得由实现自行选择**（RECON 1.2 两侧同纪律）。`space_id` **不进任何标识字符串**（D1-a，
  条件式 SF-25 同向）。
- 事务入口两根：`Kernel.uow(principal, fn, requires?)`（`scope='assembly'`）与
  `Kernel.uowFor(capability, ...)`（scoped；`#assertScope` 墙只对此路径生效，界外只有词法网——§16 D-22 三处声明以彼为准）。
- 生命周期：句柄所属底层事务终结（提交/回滚/提交期抛错**三者同形**）⇒ 派生读写一律 `TX_CLOSED`；
  不可重试，须另起事务（§16.1 D-23；保证范围限 Kernel 管理路径，§0.4）。

错误模型：`NO_SPACE_WRITE`（SP-09(b)，四表零变化）；`AUTHORITY_REQUIRED`（缺业务轴，与写权分轴，F-02/CP-5）；
`ACTIVATION_IMPOSSIBLE`（必需依赖缺失/成环；登记轴值 ∈ 机制自身权限轴 D-26；挂载名未入名单时装配挂载 Port FM-7）；
`TX_CLOSED`。

### P2 ObjectRef / RevisionRef

「type ObjectOid = string;   // 不透明（条件式 SF-20 同向，ADJ D1-a 已裁我方文法权）；禁含空间分量与任何路由事实
 interface ObjectRef    { readonly oid: ObjectOid }                          // 可导航、浮动
 interface RevisionRef  { readonly oid: ObjectOid; readonly revision: number } // 精确；正式引用位唯一形态（RD-05/F-09）」

- 机制保留前缀 `RPT-`（报告，既有）/ `FM-`（挂载）/ `FR-`（扩展记录）/ `NSR-`（重定位）：机制计数器
  发号，声明通道不能预占（`RECORD_ID_RESERVED`，D-21/FM-1.2/RL-11.4）；前缀全集语义、域保留申请、
  发号区间 namespace 化 = **G1-LINK-01**（既有去向，不新立）。
- `FR-…` 出现在端点/正式声明槽位 ⇒ 领域契约拒；机制责任 = **不把 FR 标识投进任何对象引用解析器**（FM-1.2；
  RF-05/RF-06 对象化是唯一合法路径，不放宽端点类别）。
- 负例方向（D1-a 验收列）：`space:obj@rev` 形态、修订类携带 space_id ⇒ 入口即拒零残留；oid 冲突拒绝
  与 D1-c 同形。

错误模型：`ID_TAKEN`（oid 撞号，呈现同形）；`KIND_FROZEN`、`SPACE_FROZEN`（kind/space 创建即固定，RD-01/F-10）；
`RECORD_ID_RESERVED`；`HARD_REF_NOT_PINNED`（硬引用指向浮动目标；PINNED 绑定缺精确修订同码复用，FM-7）。

### P3 Directory / 路由读（归属判据单点）

「routeNs(registry, dir, chain) ⇐            // RL-6.5：读写共用单点，现状 P-06 的升维
   ① route.ns = dir.ns ⇒ dir.ns（快路径）
   ② chain（该 capability 的 `ns-relocated` 行按 seq 升序）前缀完备 ∧ 起点 = dir.ns ∧ 末点 = route.ns
      ∧ 每 hop 过 gateFullShape ⇒ route.ns
   ③ 其余 ⇒ `SCHEMA_INCOMPATIBLE`（fail-loud 语义一字不改；扫描面逐行遮蔽计数照 D-24 读侧）」

- 快照面/扫描面/最新面**共用同一条判据函数**（禁复制逻辑，§16.3 D-24 读侧）；宿主全局 Directory（若 G2 落地）
  受**三禁令**：路由提示、不载科研内容、不作授权判据（ADJ D1-b）。
- 读上下文与截点：`ReadContext` 缺任一必需字段 ⇒ `CONTEXT_INCOMPLETE`（未声明截点 = 未定义查询）；
  双时间顺序固定（先知识截点后可见性再对象时间）；`recorded_as_of`(epoch_ms) → `cutoff(t)` =
  **最大 c 使提交序 ≤ c 的登记的 recorded_at 全部 ≤ t**，echo 必填三键
  `{input_recorded_as_of, resolved_cutoff, resolved_at_ms}`（ADJ D2-b；`commit_sequence` 我方线名，§0.3）。
- 分页游标（G2 落地时强制）：自包含 {commit_sequence 截点 + 查询指纹 + 授权类标识}，重放用自包含截点，
  超上限拒（ADJ D2-e，游标词汇我方新命名）。

错误模型：`SCHEMA_INCOMPATIBLE`（ns 漂移/断链/陈旧 `ns_epoch` F-10；读写同判据 CP-6）；
`CAPABILITY_INACTIVE`；`CONTEXT_INCOMPLETE`；扫描面失败形态分界原则 §14.5（一行归属不符不得炸整页）。

### P4 Domain Command Port（**不等于**能力作用域 Storage Port）

两层写面差是契约的一部分（§16 首表）；X-5 的裁定在此成文：

- **能力作用域 Storage Port**（`NamespaceWriter`）= 机制归属核对通道，**科研语义零判定**；它不是领域命令面。
- **Domain Command Port** = 领域能力把科研动作表达为自己语义集的具名 Port（先例形状：正式事件
  `synth:fact-designation` 经属主能力签发 Port 对**他人拥有的对象**签发——EA §8 T-P1 与 §16.2 正式事件
  门五判据；「Domain Command Port」一词以 ADJ X-5 行为准）。
  契约形状（示意）：「interface FactDesignationCommandPort {
     designate(a: { readonly targetOid: ObjectOid; readonly revision: number;
                    readonly payload: unknown }): { readonly witnessSeq: CommitSequence };
   }」——实现内部只许消费：自己的 `createOwned/reviseOwned`、自己的 `appendAuthoritativeEvent`、
   挂载内 `writeFacetRecord`；**不得**取通用 UoW/raw SQL/重取 face（四禁，ADJ D4-d + X-7 可信绑定 G1-BIND-02）。
- **Application 层只做跨域事务协调**：经 `writerOwningKind` 在调用方同一条事务内完成跨归属写；Q40
  （单 Space 原子事务，全成全回滚）**不破且永不破**（裁决 §5 未重开清单）。
- 墙 > 网：运行时作用域上界是墙，源码扫描是网（§16 判据强度次序，防倒置）。

错误模型：`CAPABILITY_SCOPE_ESCAPE`（归属核对；墙实测守住拼接成员名/`getPrototypeOf`/`Reflect.get|apply`/
端口-kind 错配/移交后复用旧端口）；`AUTHORITY_REQUIRED`；`REQUIRED_REF_MISSING`（提交期**增量** required 边
判定，禁全表重扫，§16.1 D-24）；`HARD_REF_NOT_PINNED`；`ID_TAKEN`；`KIND_FROZEN`；`TX_CLOSED`；`RECORD_ID_RESERVED`。

### P5 Event Ownership 与签发

「appendAuthoritativeEvent(a: {          // EA-4.3 入参封闭面：无 actor/见证/时间戳字段可填
   readonly eventType: string;          // 归属账内 owner = 端口能力，否则 owned-by-other 拒
   readonly objectId: ObjectOid;        // 门④ ∈ object_directory
   readonly revision: number;           // 门⑤ 归属 ns 内真实存在（修订级判据 join 目录）
   readonly payload: unknown;
   readonly describedAt?: unknown;      // 所述对象时间（与 recorded_at 分槽，D2-a）
 }): CommitSequence」

- `EventOwnershipEntry` / `EventOwnershipRegistry`（EA-3.1 形状原样：`eventType/ownerCapability/
  requiresAuthority/truthSource/interpretationRuleSetVersion/contractVersion/approval/retired?`；
  注册只在装配期，运行期无注册写面）；归属账**一本**（`PluginManifest.ownsEventTypes` 扩形承载，C.5-2）。
- 注册判据序 EA-3.2 ①–⑤：双认领/认领机制名 ⇒ `AMBIGUOUS_AUTHORITY`；缺 `requiresAuthority` / 轴 ∈
  机制自身权限轴 ⇒ `ACTIVATION_IMPOSSIBLE`；owner 未激活 ⇒ `CAPABILITY_INACTIVE`。
- `AuthorizationContext` 九字段（`ctxId, actor, capability, axis, authorized, ruleSetVersion, contractVersion,
  issuedAtMs, txSeq`，EA-4.2）；`gateFullShape` 现两类别式（EA-4.5）：**正式类**（`axis ∉ MECHANISM_RESOURCES`）
  允许 `authorized ∈ {true,false}` 两态落账（B-3 未生效声明收存不投影）；**路由类**（`axis='capability-admin'`）
  要求 `authorized=1`。⚠ FM-7 把 `MECHANISM_RESOURCES` 扩入 `'facet-mount'` 后，挂载审计行两类别式皆不满足
  ——正面冲突登记 §7 I-2，修法（三类化）待裁，本汇编不造第三类公式。
- `replayAuthorityEvidence` 三态：`VERIFIED` / 信封不全形 / `UNVERIFIABLE_LEGACY`（包 3 前无信封行；
  复算按行钉住版本，禁按当前配置回算——C-18）。
- 机制事件名封闭名单首批 10 + planned 3（名单块以 EA §2.4 与锚文件逐等，夹具 S 组机验）；新名入账走
  EA-2.4 六步 + EA-6.2 R1–R4 异源对账（`EVENT_RECON_ORPHAN/STALE/SAMESOURCE/COUPLING` = **构建期判据
  信号名，不是运行期 `RefusalCode` 成员**，登记于此免误读）。

错误模型：`EVENT_AUTHORITY_REQUIRED`（detail 合同六键 EA-2.3；自带见证字段 = 同码 `reason='input-carries-witness-field'`）；
`AMBIGUOUS_AUTHORITY`；`AUTHORITY_REQUIRED`（事件类型未登记授权轴的兜底 / 缺轴）；`NOT_FOUND_IN_SPACE`（门④⑤）；
`CAPABILITY_INACTIVE`；取证通道抛错 ⇒ 原样拒绝 + 事务回滚（fail-closed，§16.2）。**「取证结论为未授权」不是拒写**
（B-3 三分法）。

### P6 Raw Intake

`declareRawIntake(a: RawIntakeEnvelope): CommitSequence`（唯一入口；EA-1.3 为形状全文锚，本汇编不复制全形：
要点 = `declaredType`（`null` 或 `^[A-Za-z0-9][A-Za-z0-9.:+/-]{0,127}$`，形状卫生**不是**含义判断；畸变 ⇒
置 null + `parseAttempt:'PARSE_FAILED'` **整封照常接收**）+ 原文与来源必存 + `intakeNotes` 三值
`{UNPARSEABLE, PARSE_FAILED, STRUCTURED_INVALID}`；`declaredType` **三不参与**：不进授权、不进路由、不进索引，
EA-1.3a）。边界 B-1…B-6 逐条以 EA §1.3 表为准（收取 ≠ 正式事件入账；拒写 ≠ 拒收）。

错误模型：`NO_SPACE_WRITE`（B-4）；`RECORD_ID_RESERVED`（raw 行标识机制发号）；
**本通道禁出 `EVENT_AUTHORITY_REQUIRED`**（T-N8 把「预留闸连 Raw 通道一起拒掉 = 命名权威用成存在性
oracle」钉成必红）。

### P7 FacetMountPort（四操作 + 一写）

FM-6 形状原文承接（逐字见 FM §6，此处列操作集与判据锚）：
`declareMount{targetOid, binding} → {mountId, witnessSeq}`（FM-2.2 判据序 ①写权→②激活→③`facet-mount`
轴取证→④目标解析→⑤绑定形态→⑥审计先行同事务落账）；`unlinkMount{mountId} → CommitSequence`
（≠卸载实现 ≠移交，FM-4 三操作分轨；主体变更 = unlink+declare 两次登记）；`mountState` / `listOwnMounts`
（仅本能力行）；`writeFacetRecord{mountId, boundRevisionRef?, payload} → {facetRecordId, facetRevision,
targetRevisionAtRecord}`（PINNED 必填且 = 挂载钉修订；机制写快照，入参无位）。挂载行无 ns 列（逻辑身份，
FM-2.1；与 RL-6.4 的张力登记 §7 I-3）。

错误模型（FM-7 封闭集零扩张，复用逐码理由以 FM-7 表为锚）：`NO_SPACE_WRITE` / `CAPABILITY_INACTIVE` /
`AUTHORITY_REQUIRED` / `NOT_FOUND_IN_SPACE`（目标不存在、无可见权、PINNED 修订不存在三者同形）/
`HARD_REF_NOT_PINNED` / `CAPABILITY_SCOPE_ESCAPE`（**同形双源**：未挂载他人-oid 与 D-19 越权到达调用方的
字节逐等，detail 封闭键集 `{oid, capability}`，FM-3.1(a)；复用不改变原越权语义 (c)）/ `RECORD_ID_RESERVED` /
`ACTIVATION_IMPOSSIBLE` / `EVENT_AUTHORITY_REQUIRED`。内部信号（非对外）：`REFUSE_UNMOUNTED`、
`REFUSE_BINDING_MISMATCH`。

### P8 RelocationPorts（提案/批准/校验/执行/校验/回退/修复）

RL-3 七成员签名原文承接（逐字见 RL §3；平面 = 机制运维面，插件可见面零增删）：
`proposeRelocation`（只记账零数据动作）→ `approveRelocation`（`capability-admin`；批准人 ≠ 提案人；
批准绑 `proposalDigest`，改参旧批准失效）→ `precheckRelocation`（**只读零写**，RL-4 十门封闭清单
`{AUTHORITY, ROUTE_STATE, NS_SHAPE, TARGET_UNCLAIMED, TARGET_EMPTY, SOURCE_PARSEABLE, CONTENT_DIGEST,
NO_INFLIGHT, CHAIN_INTACT, EPOCH_STABLE}`，产 `checklistDigest+contentDigest+rowCount`）→
`executeRelocation`（唯一原子切换通道：RL-5.1 六步写序单事务——复核 1/2/5/7/10 → digest 复算必等 →
位置键重映射 → **先落 `ns-relocated` 全形信封行** → 路由 `ns` 改写（enabled/plugin_id/contract_version
一字不动）→ `ns_epoch+1`；幂等 = 同 `proposalDigest` ∧ 账终态 COMMITTED 重放回首次结果，RL-7.2）→
`verifyRelocation`（四方对账只报不阻）→ `proposeRollback`（**不是撤销**：反向新提案、新独立批准，原链一字不动）→
`proposeRepair`（AFTER-THE-FACT-REPAIR 唯一合法入账；`operationGrant` + 漂移 digest 互检；执行走 RL-8.5
修复事务形，路由零改）。新鲜性三失效条件（ns_epoch / contentDigest / changed_seq 变化）RL-3.5。

错误模型：复用 `AUTHORITY_REQUIRED / CAPABILITY_INACTIVE / SCHEMA_INCOMPATIBLE / SCHEMA_UPGRADE_REQUIRED /
TRANSFER_NS_DRIFT（永久保留，RL-5.3）/ EVENT_AUTHORITY_REQUIRED / TX_CLOSED / TX_CONTENTION /
LEDGER_SEQ_CONFLICT`（RL-11.1 复用表）；**新增恰一枚** `RELOCATION_PRECONDITION`（语义「门判据不过 ⇒
零切换」；detail 封闭 `{capability, fromNs, toNs, failedGate, observed}`，只回显调用方输入与机制本地可判
事实；与 `SCHEMA_INCOMPATIBLE` 不同调用方不同修法——RL-11.2 论证）。⚠ `failedGate` 取值面与 RL-4 清单
的枚举冲突（`'APPROVAL'`、`'REPAIR_PROVENANCE'` 在十门之外）登记 §7 I-4。存储层信号文本：
`RELOCATION_LEDGER_FROZEN`、`ROUTE_RELOC_SPLIT_REQUIRED`（不入封闭集，P-03 区分原样）。

### P9 Check Request 与受限 `ValidationReportSubmission`（两立同构，ADJ D4-c）

- **对外（Agent/宿主）**：`hsr_check_request` 形态 = 检查是独立操作、不隐含写、每次新 `report_id`
  （SI-60/61 条件式）；注册走 V1 冻结面流程（D6-a：`ARCHITECTURE.md` §7.2 清单 + `Frozen-Face-Review:`
  标记 + `permissions.test.ts` 同步），且与 E-01 存在性 oracle（D1-c/D1-d）**同批裁定**；四条硬约束 D6-b
  （携 SpaceContext、echo 无隐藏计数、报告可见性从被检对象派生、跨空间只读面零 per-space 计数）。
  本 PoC 无工具层——此半面在侧车内**未覆盖**，G2 承接。
- **对内（领域校验器）**：单动作 Port，现状形状（`src/domains/test-records.ts:166-167`）：
  「interface ValidationReportSubmission {
     submitReport(a: Omit<CheckReportRecord, 'reportId'|'recordedAt'>):
       { readonly reportId: string; readonly recordedAt: CommitSequence };
   }」——领域服务不持 UoW（D-22；兼容路径 = 模块级具名适配器 `adaptLegacyValidationWiring`，
  可达性零由攻击性测试钉死）；报告签发资格 = 登记校验器身份（归属账 + 机制取证，requiresAuthority 同族）；
  **科研正式采纳权不进机制**（机制只做不透明业务轴取证；采纳权委托 = 用户决策既有项）。
- 报告钉住集（ADJ D4-b）：`{target 精确引用(可带 Representation 片段), contract_version+schema_version+
  rule_set_version, 校验器身份与版本, 输入环境摘要, checked_at, 保证范围}`——机制做**存在性形态闸**
  （缺件拒），不验科研对错；`RPT-` 机制发号；一经写入不可改写（ST-5 触发器 [实测]）；重检 = 新报告，
  旧 PASS 不改写（C11）。
- 降级路径（ADJ D4-a）：见 §4.3。

错误模型：`CONTEXT_INCOMPLETE`（检查输入缺件）；`AUTHORITY_REQUIRED`（无登记签发轴）；`TX_CLOSED`；
`REQUIRED_REF_MISSING`/`HARD_REF_NOT_PINNED`（target 精确引用形态）。形态闸拒绝的**对外响应码未命名**
（域侧 `F-*` 码表不在本层——登记 §7 M-3；临时按 X-3 同族 `TOOL_INPUT + detail.serviceCode` 形态，
不自造码）。

### 2.10 错误码与载体面扩张总登记（本组契约全部）

| 面 | 扩张内容 | 数量与出处 |
| --- | --- | --- |
| `RefusalCode` 封闭集（运行期） | **新增恰一枚：`RELOCATION_PRECONDITION`**（RL-11.2；§14.2 论证=不同调用方不同修法；每码钉跨空间存在性同形负例） | 1 |
| 存储层信号文本（**非**封闭集成员，P-03 区分） | `MOUNT_ROW_FROZEN`、`MOUNT_AUDIT_REQUIRED`、`REFUSE_UNMOUNTED`、`REFUSE_BINDING_MISMATCH`（FM-2.5/FM-3.1/FM-7）；`RELOCATION_LEDGER_FROZEN`、`ROUTE_RELOC_SPLIT_REQUIRED`（RL-2.1/RL-5.2/RL-11.3） | 6 |
| 构建期判据信号（**非**运行期码） | `EVENT_RECON_ORPHAN / STALE / SAMESOURCE / COUPLING`（EA-6.2） | 4 |
| 授权轴（`MECHANISM_RESOURCES`） | `+ 'facet-mount'`（FM-7；与 EA-4.5 类别式冲突待裁，I-2）；manifest 登记机制自轴 ⇒ `ACTIVATION_IMPOSSIBLE`（D-26 判据④） | 1 |
| 机制事件名封闭名单 | 首批 10（capability-enabled/-disabled/-transferred、object-registered、check-report-recorded、object-revised、record-backfilled、raw-record-declared、integrity-audit-recorded、read-shadow-recorded）+ planned 3（`facet-mounted`/`facet-unlinked` gated `G1-FACET-01`；`ns-relocated` 名已由 RL-2.2 自裁、翻转入账 gated `G1-NS-01` 落地批） | EA §2.4 |
| `meta` 键 | `ns_epoch`（受 `meta_counter_monotonic`；陈旧路由判据 RL-2.3/RL-7.3） | RL |
| `ledger` 列 | `contract_version` **新行必填、存量不回填**（EA-5.3；缺戳行按「切换前」档读；与 ADJ D5-c 的张力 = I-6）；`authority_basis` 既有 | EA/RL |
| 保留前缀 | `FM-`/`FR-`/`NSR-`（`RPT-` 既有）→ 全集语义归 **G1-LINK-01** | D-21/FM/RL |
| 领域侧 reason_code 封闭四值（科研词表，**不进**机制 RefusalCode） | `WITHHELD_REFERENCE / CHECKER_UNAVAILABLE / DEPENDENCY_MISSING / RULE_UNREGISTERED`（SCR-11 条件式，ADJ D4-a 采认） | 4 |
| 乐观并发过渡形 | X-3：`expected_head_revision` 缺省/失配在接口层临时按 `TOOL_INPUT + detail.serviceCode` 回显（A-01 blob 原文码；**不自造** `F-*` 名） | ADJ X-3 |

## 3. Schema 与迁移设计（交付物 3；逻辑形状 + 索引建议 + 打开期判据；物理 DDL 归 G2，D5-b）

**3.0 总纪律**：本组全部表形为**契约形状**；「形状/判据 G1 冻结、列布局与索引物理形态 G2 落地」
（FM-6 语义下限句、RL §2 表头句同型）。append-only 支点 = 触发器拒 UPDATE/DELETE +
`PRAGMA recursive_triggers=ON`（N9 包 4：`INSERT OR REPLACE` 走隐式删除，不开该 PRAGMA 即静默整行替换）
+ `guard()` 禁写法登记（§16.2 包 4）。存储层信号文本词形统一（`*_FROZEN`/`*_REQUIRED` 同族，P-03 区分）。

**3.1 六账形状**（逻辑列；逐字形状以出处条文为准）：

| 账 | 主键 | 关键列（逻辑） | 冻结触发器 / 判据 | 索引建议（G2 落） | 出处 |
| --- | --- | --- | --- | --- | --- |
| `object_directory` | `oid` | `space, kind, owner_capability（常量列——无合法写者）, ns（出生事实）, created_seq` | `directory_no_update / no_delete / birth_audited`（账本非空空间新行须带同 seq 的 `object-registered` 行）；**重定位对它零行写入**（RL-1.2） | PK 点查即路由热路径，无额外索引主张 | §16.2 包 5 / RL-1.2 |
| `capability_route` | `capability` | `plugin_id, ns（当前物理位置）, enabled, contract_version, changed_seq` | `route_no_delete / route_change_guarded / route_insert_guarded`；白名单四元化 `+ns-relocated`；子句③拆单（enabled 翻转发↔enabled/disabled 事件；plugin_id/contract_version 变↔transferred；**ns 变↔ns-relocated 且 payload.fromNs/toNs 字面相符**；ns+其他混合语句 ⇒ 拒 `ROUTE_RELOC_SPLIT_REQUIRED`） | `(ns)` 反查 = `capabilityOfNs` 唯一性判据点（gate 4） | P-01/P-07 / RL-5.2 |
| `ledger`（H） | `seq` | `event_type, object_id, actor, authority_basis（机制独占写列）, contract_version（新行必填）, recorded_at, payload_json` | `ledger_no_update / no_delete`；**「存在对 `event_type/actor/authority_basis` 的 UPDATE 路径即违宪」**（EA-5.1）；`meta.ledger_seq` 上界 + `max(seq) ≤ meta.ledger_seq` 打开判据（包 6） | `(object_id, seq)`（对象史）、`(event_type, seq)`（名单审计复算/链重建） | EA-5 / §16 |
| EventOwnership 归属账 | `eventType` | `ownerCapability, requiresAuthority, truthSource, interpretationRuleSetVersion, contractVersion, approval, retired?` | **运行期注册表**（装配期构建，无物理写面，`snapshot()` 供复算）；唯一正源锚文件 `g1/EVENT-CONTRACT-LEDGER.json`（形状冻结 EA-6.1；CI 只读锚文件；R1–R4 异源对账） | 内存 `Map<eventType>`；无索引问题 | EA-3/EA-6 |
| `facet_mount` | `(mount_id, gen)` | `op, facet_capability, target_oid（逻辑身份，无 ns 列）, binding, snapshot_revision, witness_seq` | 只 INSERT；UPDATE/DELETE ⇒ `MOUNT_ROW_FROZEN`；`facet_mount_insert_guarded`（须有 `ledger.seq=witness_seq`、事件名合 op、全形信封、echo 相符，否则 `MOUNT_AUDIT_REQUIRED`）；「当前态 = 最大 gen 行」 | `(target_oid)`、`(facet_capability, target_oid)`（写判据热路径）、`(witness_seq)`（对账） | FM-2.5 |
| `namespace_relocation` | `(relocation_id, step_seq)` | `capability, fromNs, toNs, provenance, state, proposalDigest, approvalDigest, checklistDigest, contentDigest, auditLedgerSeq, repairEvidence, proposedBy, approvedBy, createdAtMs` | UPDATE/DELETE ⇒ `RELOCATION_LEDGER_FROZEN`；**信任方向写死**：工作流账**不是**读归属链源，链源唯一 = H 内 `ns-relocated` 行（RL-2.1）；账被改写改变不了任何读判定 | `(capability, step_seq)`；「同 capability 无非终态在途」= gate 8 判据查询 | RL-2.1/RL-4 |

辅助载体：`meta`（`ledger_seq`、`ns_epoch`）；`domain_state` PK=`(ns,oid,revision)`（ns=物理位置键，
RL-6.1 列语义表：身份/内容/时刻/版本四类列重定位逐字节不变）；`RELOCATABLE_NS_KEYS` = 构建期封闭清单
（现形 `{domain_state}`；构建判据「列名=ns 的表 ⊆ 清单 ∪ 逐表论证的显式豁免集」）——RL 把「挂载登记/
扩展记录表」预列入清单，而构建判据按「有 ns 列」扫描、`facet_mount` 无 ns 列：登记 §7 I-3，两源待对齐。

**3.2 打开期判据序（顺序即判据；D5-a 唯一责任者 = 我方；任两步交换的变异必红）**：

「1. 物理形态：`storage_schema_version` 墙 + 水位（`max(ledger.seq) ≤ meta.ledger_seq`）——fail-loud 拒开。
 2. 触发器集：名字 + SQL 体摘要比对（期望外置 = G1-STORAGE-02 义务；缺名优先于改体）。
 3. 激活核对：逐 capability 路由/版本（(space×capability) 粒度，D3-c；失败零残留，§16.2 先例同型）。
 4. 漂移检出：`dir.ns` vs `route.ns` 全表比对 + 无前链背书计数（`relocationGapCount>0` ⇒ QUARANTINED
    拒开，不降级不带病运行，RL-8.1/8.3）；挂载表在位/触发器在位/链终态合法/目标∈目录/见证可解析（FM-2.5）。
 5. 名单↔归属账装配核对（EA-3.2 装配期判据 + 锚文件三方逐等）。」

**3.3 四层版本对应表**（交付物 3 的版本轴；完整五层口径见 D3-a——host 代码版本与对象 Revision 亦为
独立轴，勿与本表四层混压；「各层推进权独立、禁互相冒充；水位≠版本、展示墙钟≠提交序」为冻结句）：

| 层 | 我方名 | 管辖对象 | 推进权与形态 | 与新命名的说明 |
| --- | --- | --- | --- | --- |
| 物理层 | **`storage_schema_version`** | G2 正式库打开期物理形态（DDL/触发器集/水位） | **per (space×capability)** 登记，Kernel 迁移协调器读写（D3-c）；领域插件禁自改核心表；**允许版本墙**（fail-loud 拒开、不销毁原字节） | **我方契约层新命名**（#44 原语「每 Space 每插件存储 Schema 版本」，ADJ §2.0；三 ref 零命中）；重定位**不改**它（表形不变，RL-9.1） |
| 记录层 | `schema_version`（记录自钉） | 单条记录/工件的结构版本 | 记录写入时自钉；读者按钉住版本解释 | HSR 工件层同名轴为 #47 SCR-03（条件式）；与物理层**禁混用**（D3-a 负例两类变异必红） |
| 契约层 | `contract_version` | Capability 契约版本；`ledger` 新行必填（EA-5.2）；`capability_route.contract_version` 既有 | 移交可改（路由三元组之一）；重定位**一字不动**（RL-5.1 步 5）；存量缺戳行不回填（EA-5.3） | PoC 全局 `SCHEMA_VERSION` 常数 = D-18 单插件假设，G2 由 per-space 登记取代 |
| 规则层 | `rule_set_version` / `interpretationRuleSetVersion` | 历史科研语义与校验规则的解释集 | 规则集变更一律 bump；历史报告/历史行按其钉住版本重放（C-12 条件式 SCR-74 同族）；旧解释器不可用 ⇒ 保留原记录 + 显式能力缺失（C-06） | 读表 `hasOwnProperty` + 缺项 `UNINTERPRETED_FAIL_CLOSED`（EA-5.1a） |

**3.4 迁移设计**：旧库重开 `SCHEMA_UPGRADE_REQUIRED` fail-loud + detail 点名（包 3/5/6 先例：不携迁移债）；
D3-b 并存三规则（① 墙只拒「不可安全读」不毁原字节；② 可解释性 = 版本钉 + 旧解释器/显式缺失；③ 墙与
可解释冲突 ⇒ 墙让位为「可旧读+标注」，**永不**以改写历史记录实现）；迁移器不承担三件事——不回填版本戳、
不补造「当时合法迁移」证据（RL-8.4 默认禁止自动补造，唯一合法入账 = proposeRepair 来源验证流）、
不代盖章 `contract_version`（RL-4 gate 6「重定位不是洗白通道」）。

## 4. 状态与故障矩阵（交付物 4）

**4.1 事务边界与提交截点**：机制内唯一事务边界 = `Kernel.uow → port.tx` 的
`begin immediate → fn → commit / catch → rollback`（`port.raw` autocommit = 已登记运维后门界外，§16.1）；
提交期失败全形态**零残留、序号不留 ghost**（D27-5 [实测]）；「审计先行必须与变更同事务原子，否则先审计
反而制造幽灵审计」（P-01/F-20——三契约共同支点：路由、挂载、重定位同文同判）。

**4.2 时间截点六情形（D2-a…D2-f 逐格；三概念分离：提交序 / 登记墙钟 / 所述对象时间互不替换）**：

| 情形 | 判据 | 出处 |
| --- | --- | --- |
| 同一毫秒多提交 | 毫秒界闭合，该毫秒全部提交可见：cutoff(t) = 该毫秒最后一个提交 | D2-b |
| 该毫秒无提交 | 落此前最后一个提交；无 ⇒ c=0 空视图；echo 三键必填 | D2-b |
| 墙钟回拨 | 截点比较只走 commit_sequence；历史视图/游标/分页不变；`recorded_at` 禁排序/去重/判等；前缀界天然吸收 | D2-c |
| 晚到登记 | 晚截点视图携「补录」标注（推导 = 行提交序晚于按对象时间提问可见的提交序）；早截点不得出现为已知 | D2-d |
| 分页重放 | 游标自包含截点+查询指纹+授权类标识；晚到登记不致重复/漏项；跨授权类提交游标拒 | D2-e |
| 异步缓存 | 正式业务视图只许三形态（截点一致即时算/同步物化/带可核验水位物化）；**无水位的异步缓存一律禁**；每次读回显截点+投影+版本 | D2-f |

**4.3 校验器降级（D4；对外契约矛盾 C5 已裁：SI-23 采，抛错不落报告让位）**：

- **必须落报告（进 INDETERMINATE）**：一切**能产出合法输出**的降级——校验器/依赖资源不可用、规则未注册、
  引用被扣发 ⇒ 落 `INDETERMINATE(reason_code ∈ 四值封闭集)` 报告 + 响应成功 + 旧 PASS 不动 + `findings`
  如实（§7 [实测] 既有形态延伸）；「伪装成功」= 不落报告就返回成功、或把降级呈为 ACHIEVED——禁止；
  降级报告本身是 fail-closed 事实（RD-25 三线独立）。归约 `FAIL > INDETERMINATE > ACHIEVED` 在领域，机制不归约（§7）。
- **不得伪装成功（三形态禁）**：① 不落报告返回成功（上句）；② **库损坏 / 提交完整性无法保证** —— 报告是
  提交事实，触发器 abort / 事务提交失败 ⇒ 全回滚 + fail-loud（`TX_CLOSED`/触发器信号），**不产**任何
  「成功的 INDETERMINATE」回执——写不进 H 的报告不存在；③ **权限设施失效** —— 取证通道本身抛错 ⇒ 原样
  拒绝 + 事务回滚；事件类型无登记授权轴 ⇒ `AUTHORITY_REQUIRED`（§16.2 取证两形 fail-closed）。
  注意与 B-3 的分界：「取证**结论**为未授权」不是设施失效——行照常落账、`authorized:false`、永不进投影。
- 形态闸缺件（钉住集缺任一版本字段等）⇒ 拒收报告（存在性形态闸，ADJ D4-b）；对外响应码未命名 = §7 M-3。

**4.4 重定位崩溃/重试/陈旧窗（判据全文在 RL-7 与 RL-10.2 F-01…F-18 十八条矩阵，此处只钉骨架不复述）**：
提案/批准/precheck 阶段崩溃 = 零写面（precheck 全程零写）；切换事务中崩溃 = `begin immediate` 全回滚、
`ledger_seq`/`ns_epoch` 均不前进（无 ghost）；提交后 ack 前崩溃 = WAL 恢复全成、幂等重放回首次结果
（RL-7.2：幂等键 = `proposalDigest` 逐字节等 ∧ 账终态 COMMITTED，改参重试必走新提案+新批准）；
陈旧路由读 = `ns_epoch` 失配 ⇒ `SCHEMA_INCOMPATIBLE` **拒答不假答**，恢复条件 = 重启（重启式边界，
#44 §6.1 原句）；既有漂移上叠加重定位 = `CHAIN_INTACT` 拒（先修复/隔离）；「事务保证一切」句式被 RL-7
标题句明文禁止，十八条每条带夹具 id，实施批逐条承接（G1-DONE-03 验收：迁移中断回滚零残留、单 Space
失败不阻断他库）。

**4.5 投影与读面故障（承接 §9）**：滞后 ⇒ 可用但标 `STALE`；缺口 ⇒ `FULL_REBUILD_REQUIRED` 拒增量；
不可判定 ⇒ 不得当空结果；缺口检测以 `ledger` 为对照基准（Journal 非历史真源 [实测]）。扫描面遮蔽行
**计入复算/审计面**（D1-d 方向）还是**照旧进 echo 键**（EA-7.4 冻结面）——两判据并存待裁，见 §7 I-1。

## 5. 历史解释（交付物内「历史怎么读」）

**5.1 版本钉住是读义务不是可选项**：每条记录/报告按其自钉 `contract_version / rule_set_version /
schema_version` 查**冻结判据表**解释（C-06/C-12/C-18 承接，SCR-21 重放三前提条件式）；缺戳存量行按
「切换前」缺省档读且读者必须能报告「此版本来自缺省档」（EA-5.3）；禁止按当前配置对历史行做静默重解释、
禁止按当前配置回算历史授权结论（§16.2 投影信任模型 + C-18）。

**5.2 解释器责任表（EA-5.1a 三面一条）**：「认定预留只约束新写入」∧「历史读取解释逐字不变」∧
「禁止为归类重写 History Ledger」= 同一条判据的三面，任一违反夹具 T-P6 当场红。解释器按名入冻结表：
`object-revised` → 机制 revise 解释器（r0=切换前形状/r1=切换后同判据，由锚文件
`interpretationRuleSetVersion` 指名）；`record-backfilled` → 迁移器解释器（**永久携带「回填事实」字段**，
事后修复与当时发生之别不得抹，B.7 写死句）；查表 `hasOwnProperty`，缺项 `UNINTERPRETED_FAIL_CLOSED`。

**5.3 旧事件名 vs 新写入规则**：`object-revised`/`record-backfilled` 就地升格机制名单**不改名**——
历史行保留原名、原版次、原签发证据；「名字难看与名字违法的处置都在读侧映射，不在写侧改写」；
**别名映射被否证留痕**（映射层 = 再造解释分支 + 第二套命名真源，EA-5.4）；旧形 `declareRecord` 行的
`event_type` 值为历史名字数据，读者不得据其推断现行类别。跨平面：V3 侧车历史与 V1 事件面**不合一、
不互推**，连接仅 HSR 侧 `external_citations[]` 显式登记（ADJ X-8，条件式锚）。

**5.4 物理重定位不产生新科研事实（RL-6.3 冻结判据承接）**：一次重定位的机制外可见净效应 = 路由行
ns/changed_seq、状态行位置键、**一条机制事件**、一次 ns_epoch 推进；领域事件、`object-revised`、
`record-backfilled`、新 revision、新对象、新记录、投影输入变化**恒为零**——科研史不因搬家多一页；
`ns-relocated` 是机制运行事实，永不进业务投影。四类列（身份/内容/时刻/版本）逐字节不变 = **版本钉穿
得过搬家**（RL-6.1）；历史快照逐截点逐字节同切换前（RL-1.3-5/6.5）；`AFTER-THE-FACT-REPAIR` hop 读面
**接受**（它背书「这段漂移有来源验证过的修复记录」）但审计面永久点名（RL-8.4）。⚠ 「存量无戳行不回填」
（EA-5.3）与「历史行补 `contract_version` = 显式修补事件语义」（ADJ D5-c → G1-VER-01）之间的张力
登记 §7 I-6——两者不互斥的读法（缺省档读 vs 未来修补以**新事件**登记而非改旧行）由 G1-VER-01 落地批裁定。

## 6. 与三份上层 Draft 的关系（单节；#47 一律条件式）

| 上层 | 平面与角色 | 本组契约的关系 | 条件与边界 |
| --- | --- | --- | --- |
| #44（`5ec38974fc`）V3 机制架构 | 机制侧权威（Q11–Q45 裁定、职责表、Directory/Ledger/Port 形状） | **承接 + 机制化**：三契约逐格落点（RL §14.3、FM §11.2、EA C-01…C-10）；Q1–Q45 全部**未重开**（ADJ §5 未重开清单）；本文件零新增机制主张 | 无条件式——条文在当前分支可读且被逐字引用（blob 已核） |
| #42（`0369c3196c`）HSR 领域基础 | 领域权威（SP-09 两分、RD-01/05/15/25/37、RF-05/06、DF-01 三分类、T-02、C11） | **一致 + 直落**：写权/授权两分贯穿 P1–P9；「登记≠使用≠接纳≠为真」由 B-3 未生效声明 + 投影闸承载；PINNED/NAVIGATION = RD-05 的挂载面直落 | 无条件式引用；**前提**：本组契约不解释科研真值（Kernel 业务无知） |
| #47（`37de107ed5`）HSR Schema 层 | 形态层草案（SI/SF/SCR/OBJ/SD/CAT 规则） | **一律条件式**（条件：#42 合并且条文文本不变；RECON §0 固定注记）。RECON 38 行 = 条件一致 14 / 需澄清 8 / 冲突 8 / 未覆盖 8；**无条件一致恒为 0**；C1–C8 的让位/采认处置**全部以 ADJ 对应行为准**（D1-c、D1-a、D2-a/b、D4-a、D3-b 撤 C6、D5-a/b）；SS-15a 溯源已闭合（ADJ §3：`8f2795b` 为 #47 祖先、**非** main/HEAD 祖先，主线文档零登记已入账） | #47 自认不收口之面**不借道**：事件族（SF-72/SD-07）、迁移/DDL/索引（SF §12/T-GAP-09/10）、V1 历史合一（SD-07）；凡此类面本组契约自立条文且**禁止**写「属 #47 决策面」（附三纪律） |

**未覆盖清单（如实）**：① Facet/挂载——#47 七文件全库检索**零命中**（FM F-14 实测；「未覆盖」≠「未取得」，
EA/FM 各注「未取得项：无」）；② 机制事件命名——#47 无辖域主张（EA §0.1）；③ 打开判据/迁移校验清单/
文法（space_id/record_id）——T-GAP-09/10 + SF §12 自认交 B（= 本 PoC 线），裁定期文法权在我方（D5-a），
四契约与 ADJ 均只裁「权在我方」未落文法本体（§7 M-4）；④ 工具面（`hsr_*` 注册与响应形态）——本 PoC 不接
宿主，D6-a/b 是 G2 工具层裁定，侧车内**未覆盖**；⑤ 幂等账本/规范字节/分页游标实现——责任侧为接口/宿主
工具面（X-1/X-2/D2-e），侧车内只有义务句无实现；⑥ 报告部分可见读形态（T-GAP-15）——关系无法判定，留待
报告面两视图落地（RECON §9-5）。

## 7. 冲突登记（文末强制项）

**本文件是汇编层；若与四份分契约条文冲突，以分契约为准，并在此登记冲突。**

### 7.1 注册表 A——汇编层 vs 分契约

**无。** 本文件未新增任何与分契约相抵触的条文；所有「⚠」标注均为对分契约间既有冲突的**转述登记**，
不构成新的裁决。

### 7.2 注册表 B——分契约 vs 分契约（硬不一致；**不抹平**，两侧原文位置并列，待父席/下一轮裁决）

| # | 冲突 | 两侧位置 | 影响 | 建议去向 |
| --- | --- | --- | --- | --- |
| I-1 | 遮蔽计数的呈现面：ADJ D1-d/C4（后裁，「裁决已定」）判「`hiddenBy*` 计数**退出调用方 echo**、只进内部审计」；EA §7.2/7.4 判「echo 键集是已冻结面、**计数照旧进读回执**、审计事件不新增键不改取值来源」 | ADJ D1-d/C4 行 vs EA-7.2 末句/EA-7.4 第二条 | 实现批只能满足其一；夹具（读回执键集 vs 审计行数）互相矛盾 | 需一次 EA §7 修订或 ADJ 补裁；§16.3「echo 形状不加字段」冻结裁决与 §16 重登记流程谁让位须点名 |
| I-2 | `gateFullShape` 类别式覆盖：EA-4.5 两类别式（正式类 axis∉MECHANISM_RESOURCES；路由类 axis='capability-admin'）；FM-7 把 `'facet-mount'` **扩入 MECHANISM_RESOURCES** ⇒ 挂载审计行两类别式皆不满足（既非路由类、又因在 MECHANISM_RESOURCES 内被排除出正式类） | EA-4.5 vs FM-7 轴值段 + FM-9 见证列 | 挂载见证行的全形闸判据无式可依；FM 未把「EA-4.5 需三类化」登记为依赖 | EA-4.5 三类化（机制自有操作轴）或 FM-7 撤销扩名；须补一条 EA↔FM 联裁 |
| I-3 | `RELOCATABLE_NS_KEYS` 集合来源：RL-6.4 构建判据 = 扫描「列名=ns 的表」；同条把「挂载登记/扩展记录表」预列入清单，而 `facet_mount` **无 ns 列**（FM-2.1 逻辑身份设计）——该表既扫描不到、又无 ns 位置键可搬 | RL-6.4 vs FM-2.1/FM-2.5 | 「挂载行随重定位搬家」的联动接口（RL-3.4 声称的唯一接口）在现形状下是空操作或定义缺失 | RL-6.4 与 FM-6 对齐：明确扩展记录表（A2 物理形）是否有 ns 位置键；挂载登记表本身应显式列豁免集（「位置无关」论证逐表封闭） |
| I-4 | `failedGate` 枚举封闭性：RL-4 判「清单名即 detail.failedGate 取值、**不得旁加**（封闭十门）」；RL-3.3② 用 `failedGate='APPROVAL'`、RL-8.4/8.5 用 `'REPAIR_PROVENANCE'`——两个值在十门之外 | RL-4 清单块 vs RL-3.3/RL-8.4 | detail 封闭面的夹具 S 组逐等会红；「不得旁加」句与自家取值矛盾 | RL-4 清单扩两门并把旁加句改为「扩充 = 本合同冻结面变更」，或 approval/repair 拒绝换载体（不走 failedGate） |
| I-5 | 新机制事件名的**批准主体**：EA-2.4 步骤 2 =「用户（或用户指名代表）批准」；EA-7.1 =「批准由 G1 冻结评审=本条裁定承担，落地时补记 Approved-By」；RL-2.2 =「本契约即批准文书」；FM-9 =「planned 块不得被引用为已入账、入账走 EA-2.4 六步」——同一流程四种自我授权表述，且 G1 冻结评审**尚未发生**（G0-R-CLOSURE：NO-GO） | EA-2.4 vs EA-7.1 vs RL-2.2 vs FM-9 | 「名单唯一正源 + 异源人工批准」的锚可能空转（批准人=文书自身） | 三处统一指回 EA-2.4 六步为唯一流程；已落文书的「即批准」句降级为「提案文书」；`Approved-By` 只能由用户/指名代表事后追加 |
| I-6 | 历史行版本戳：EA-5.3「存量无戳行**不回填**（补戳=系统替历史补语义）」；ADJ D5-c「历史行补 `contract_version` = **显式修补事件**语义（G1-VER-01）」 | EA-5.3 vs ADJ D5-c | 若不区分「改旧行」与「新增修补事件」，两文互斥；G1-VER-01 落地时先撞 | 在 G1-VER-01 条文里写死：修补 = 追加事件行（如既有 `record-backfilled` 语义族），零 UPDATE 旧行；与 EA-5.1 违宪句相容 |

### 7.3 注册表 C——观察项（非冲突，如实登记）

| # | 观察 | 位置 |
| --- | --- | --- |
| M-1 | `ACTIVATION_IMPOSSIBLE` 被 FM-7 用于「挂载名未入封闭名单时装配挂载 Port」——原语义（必需依赖缺失/成环）的用途扩展，复用理由属「名册缺项=装配红」同族，但 §11 表未登记此用途扩展 | FM-7 vs CONTRACTS §5 CP-2 |
| M-2 | PluginFace 新增具名成员（`FacetMountPort`）触碰「插件可见成员名集零增删」面锚——`arch-independence.test.ts` 重锚义务在 FM 只隐含、未登记为显式重锚条目（RL/FM 各自对拍旧/新面锚的口径需一张统一的重锚清单） | FM-6 vs RL §3 首段/§16.3 重锚纪律 |
| M-3 | 报告钉住集**形态闸拒绝**的对外响应码未命名（域侧 `F-*` 表不在本层；临时 `TOOL_INPUT+detail.serviceCode` 是 X-3 同族过渡形） | ADJ D4-b 落点缺码位 |
| M-4 | `space_id`/`record_id` 取值文法：ADJ D1-a/D5-a 裁「文法权在我方契约层」，四契约与 ADJ 均未落文法本体（RL 只给了 ns 文法 `^[a-z0-9][a-z0-9._-]{0,63}$` 的同族先例） | 全部输入文件的共同空白面 |
| M-5 | 宿主「目标→挂载方列表」导航读面：FM-2.4 默认不提供、确需暴露走呈现裁定通道；该暴露形态 = G1-READ-02 复核范围，四契约均未写该面本身 | FM-2.4 → 既有去向 |

