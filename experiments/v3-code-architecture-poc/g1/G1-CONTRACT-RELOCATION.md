# G1 契约正文 — 物理命名空间重定位（G1-NS-01）

> 状态：**规范性契约正文（可实施、可写测试）**，2026-11-01 起草于分支 `g1/contracts-20261031`。
> 本文件把 `G1-CONTRACT-DESIGNS.md` 节 B（B.1–B.7）与 `G1-ADJUDICATION-TABLE.md` 的 D3-b / D5-a /
> D5-b / D5-c / C6 / C7 / C8 行裁定升为正文；DESIGN 节 B 与其附三**原文保留不删**（附三纪律：更正
> 以追加留痕，不静默覆盖）。本文件不是机制代码：所有 TS 与表形状是「先契约后机制」的「先」
> （§16 先例）；**生产 DDL 不在本文**——表/索引的设计判据与迁移协议属契约，写在本文，落码归实施批。
> 夹具（与本合同同批、互相对账）：
> 「node experiments/v3-code-architecture-poc/g1/G1-CONTRACT-RELOCATION.fixtures.mjs
> 退出码 0 = 契约结构自洽 + 正反例全命中 + 五条「架空判据必红」变异自验全部捕获；1 = 有 FAIL；
> 2 = 夹具无法运行。」
> 平面声明：本合同只裁 **V3 机制侧车（本 PoC）** 的物理 ns 重定位面。V1 冻结面与 #47 HSR 层各有其文；
> 按 DESIGN 附三教训（「跨草案的归属必须引用条文原文，不能引用我的预期」），凡本文写「归 X 裁定」
> 都给条文锚，给不出的写「未决 + 指名裁定人」（§14.4）。**本文不写「属 #47 决策面」**——该措辞
> 所指的两处旧归属已被 #47 实际条文否证（附三 F-1；`G1-RECON-PR47.md` C7/C8；裁决表 C7/C8/D5-a）。
> 禁改清单沿用席位任务书：本文件与同目录夹具之外的任何文件本席不改。

---

## 0. 引用与平面纪律

### 0.1 平面与自立声明

| 平面 | 对物理 ns 重定位的立场 | 本契约的关系 |
| --- | --- | --- |
| V1 冻结面（根文档 + `schema/**`） | 不涉 PoC 侧车 DDL（§16.2「PoC DDL 不在冻结 `schema/**`，零引用关系」句） | 不触碰 |
| #47 HSR Schema 层 | SF §12「数据库迁移与运维……不属于本层职责，也不得被误当作已裁决」（R-15）；T-GAP-09/10「须与 B（底层架构）连同 V1 命名空间一并定，本层不自行发明」（R-16）；**SF §8 全节（L110-118）对「打开期检出 ns 漂移」零提及、零承接**（R-18，本席对 blob 实测：SF 文件内「ns/物理命名空间/打开期一致性」零命中，仅 SF-71/72 谈工件命名空间分离） | 其条文**未裁且明写不裁**本面 ⇒ 打开期漂移检测、迁移前置判据、重定位账形状的责任**由本契约自立**（C7/C8 收回裁定，D5-a「此后禁止再写『属 #47 决策面』」） |
| V3 机制侧车（本 PoC `src/**`） | 现状：ns 无任何合法写通道（D-31 止血，P-06）；存量漂移无检出无救济（F-G6A-4，P-08） | 本文即该面的冻结文本 |

### 0.2 引用格式

每条引用给「文件 + 规则号/行号 + 原文短句 + SHA」；外部 blob 一律经 `git show <sha>:<path>` 本席
实取（#44 `5ec38974fc`、#42 `0369c3196c`、#47 `37de107ed5`），行号 = blob `cat -n` 实测。#47 引用
条件式口径照 `G1-RECON-PR47.md` §0（「#42 合并且条文文本不变」）。仓内引用以提交 `d2f19cc` 的工作树
行号为准；`G1-ADJUDICATION-TABLE.md` 行号按本席 2026-11-01 工作树实读（该文件工作树另有并行席位
改动，本文只引 §2.1 表内 D3-b/D5-a/D5-b/D5-c 与 C6/C7/C8 行原文，如并发改动触及所引行，以 blob
化后的同一规则号文字为准）。**未取得项：无**。

### 0.3 上层引用清单（正文以 R-xx 指代）

| # | SHA | 文件（行号） | 规则号 | 原文短句 |
| --- | --- | --- | --- | --- |
| R-01 | `5ec38974fc` | `docs/architecture/V3_CODE_ARCHITECTURE_DRAFT.md`（L198，#44） | §6.1 Q44 | 「`ObjectID`、`CapabilityID`、`PluginID` 分离；`ObjectID` 生命周期不跟随源码重构……所有权转移需要受控、可审计、原子切换……首版只承诺重启式升级，不做在线热迁移」 |
| R-02 | `5ec38974fc` | 同上（L174） | §5.2 Q44 | 「允许对象所有者能力从旧 Plugin 显式迁移至新 Plugin……对象和所有历史精确引用保持不变，**迁移记录与数据/路由更新原子一致**（Q44）」 |
| R-03 | `5ec38974fc` | 同上（L141） | §5 职责表 | 「Capability Registry、Plugin/Product Profile 生命周期、**按空间 Schema 迁移协调**｜（不做）插件私有数据库直接修改、具体校验器算法、长期热交换框架」 |
| R-04 | `5ec38974fc` | 同上（L139） | §5 职责表 | 「**Object Directory**：ObjectID、固定 Space/Kind、逻辑 Capability 路由及唯一权威标识」 |
| R-05 | `5ec38974fc` | 同上（L171） | §5.2 Q38/Q44 | 「`ObjectID → {space, object_kind, owner CapabilityID}` 等**最小身份路由信息**。对象 `kind` 和 `space` 创建即不可变（PR #42 RD-01）」 |
| R-06 | `5ec38974fc` | 同上（L242） | §7 Q40 | 「一次原子提交：领域权威状态/事件、Directory、H Ledger、Change Journal 全成或全回滚。未提交的 ID 对其他事务不可见」 |
| R-07 | `5ec38974fc` | 同上（L325） | §11 版本轴 | 「至少分开：Host 代码版本、Capability 契约版本、每 Space 每插件存储 Schema 版本、历史科研语义/校验规则版本，以及各对象 Revision……派生索引水位不是科学历史版本」 |
| R-08 | `5ec38974fc` | 同上（L327-328） | §11 | 「单个 Space 迁移失败不阻断其他 Space」「**结构迁移与科学语义迁移分离**，普通加载不能静默改写历史语义；旧解释器不可用时保留原始记录与版本身份并如实标注能力缺失，不套用新规则冒充旧解释」 |
| R-09 | `0369c3196c` | `H_S_R_DECISIONS_AND_GAPS_DRAFT.md`（L39，#42） | RD-01 | 「`object_kind` 与 `space_id` 创建即固定且不可变；不存在 kind 迁移或跨空间迁移」 |
| R-10 | `0369c3196c` | `H_S_R_DOMAIN_FOUNDATIONS_DRAFT.md`（L41，#42） | ID-02 | 「每个对象归属唯一 `space_id`（ResearchSpace），创建时固定且不可变。不存在跨空间迁移，也不存在『共享实体副本』」 |
| R-11 | `0369c3196c` | `H_S_R_COMPOSITION_SEMANTICS_DRAFT.md`（L103，#42） | C11 | 「新版本可以提示当前复审，但**不得自动改写旧结论、旧 PASS 或旧使用记录**」 |
| R-12 | `37de107ed5` | `H_S_R_SCHEMA_FOUNDATIONS_DRAFT.md`（L114，#47） | SF-60 | 「每条记录自带其写入时的版本。读侧**必须**能读取所有历史版本，禁止『新版Schema 使旧记录不可读』」 |
| R-13 | `37de107ed5` | 同上（L116） | SF-62 | 「破坏性变更**绝不回溯**……历史记录以原版本永远可读，新登记用新版本」 |
| R-14 | `37de107ed5` | 同上（L110-118 全节） | SF §8 | 「版本与兼容纪律」全节对物理命名空间、打开期一致性**零提及**（本席 grep 实测：该节及全文件无「物理命名空间」；「命名空间」仅命中 SF-71/SF-72 的工件前缀与文件族分离语义）⇒ D-31 历史面检测要求**零承接** |
| R-15 | `37de107ed5` | 同上（L154-156） | SF §12 | 「具体存储引擎、索引与查询计划；序列化后端选型；**数据库迁移与运维**……这些不属于本层职责，也不得被误当作已裁决」 |
| R-16 | `37de107ed5` | `H_S_R_SCHEMA_DECISIONS_DRAFT.md`（L122-123，#47） | T-GAP-09/10 | 「须与 B（底层架构）连同 V1 命名空间一并定，**本层不自行发明**」 |
| R-17 | `37de107ed5` | 同上（L152-154） | SD §6 | 「本层完成后才可继续的事（不排期）……以上均**不属于本层职责**」 |

### 0.4 仓内锚点清单（正文以 P-xx 指代；SHA 统一 `d2f19cc`，行号=工作树实测）

| # | 文件（位置） | 内容短句 |
| --- | --- | --- |
| P-01 | `CONTRACTS.md` §16.2 包 5（L487-516） | `route_change_guarded` 三判据与 `ROUTE_AUDIT_REQUIRED`；「审计先行必须与变更同事务原子」；「先写 ledger 审计、后改路由」 |
| P-02 | `CONTRACTS.md` §16.2 包 5（L517-526） | D-28：`directory_no_update`/`directory_no_delete`/`directory_birth_audited`；「**owner 一经登记不可变更**」；移交「不触碰也不得触碰目录行」 |
| P-03 | `CONTRACTS.md` §16.2 包 5（L487-490） | abort 消息词「是**存储层信号文本，不是 `RefusalCode` 封闭集成员**——封闭集不因此扩张」 |
| P-04 | `CONTRACTS.md` §16.3 D-27 真修（L641-663） | 五机制名预留 + 路由守闸核机制落账见证（`actor is not null` + `axis='capability-admin'` + `authorized=1`）；「只做 ① 不做 ②……仍过闸」半形点名 |
| P-05 | `CONTRACTS.md` §16.3 D-31（L665-676） | 「`reassignRouteInternal` **删除 ns 参数**」「ns 迁移另立显式迁移通道（机制没有，也不拿移交面凑数）」；`TRANSFER_NS_DRIFT` detail 只回显调用方输入 |
| P-06 | `src/kernel/kernel.ts`（L267-275） | `routeNs(registry, dir)` 现判据：`cap.storageNamespace !== dir.ns` ⇒ `SCHEMA_INCOMPATIBLE`（读写共用单点） |
| P-07 | `src/storage-sqlite/sqlite-port.ts`（L53-58, L86-141, L150-157） | `object_directory.ns`（出生 ns）、`capability_route.ns`、`route_change_guarded` 子句③「三元组（含 ns）变化必配 `capability-transferred`」、`domain_state` PK=(ns,oid,revision) 且**无不可变性触发器** |
| P-08 | `READINESS.md`（L247） | F-G6A-4：「v6 漂移库……**是被版本墙顺住，不是被检出**……救济无门」「打开期 `dir.ns` vs `route.ns` 全表比对，不一致 ⇒ 拒开并点名；受审计的 ns 迁移通道与 `dir.ns` 冻结**冲突** ⇒ **G1 设计题**」 |
| P-09 | `G1-CONTRACT-DESIGNS.md` B.2-B1 / B.4 / B.7（L174, L195-201, L231-260） | B1 案形状；「互斥的真正化解点：……B1 把迁移改为『route 改写 + append-only 账』，互斥消失」；B.7 五项技术不变量 + backfill 三句写死 |
| P-10 | `G1-CONTRACT-DESIGNS.md` 附三 F-1（L463-467） | 「**`SF §8` 全节对『打开期检出 ns 漂移』零要求、零承接 ⇒ D-31 历史面（F-G6A-4）的检测责任只能本 PoC 侧自立**」 |
| P-11 | `G1-ADJUDICATION-TABLE.md` §2.1 D3-b（L59）/ C6（L75） | 「**明写不矛盾，撤二选一**：SF-60 约束 HSR 领域工件的可读性……版本墙是 G2 正式库打开期物理形态 fail-loud……墙与可解释冲突时墙让位为『可旧读+标注』，**永不**以改写历史记录实现」；C6「撤案」 |
| P-12 | `G1-ADJUDICATION-TABLE.md` §2.1 D5-a（L65）/ D5-b（L66）/ D5-c（L67） | 「唯一责任者 = **我方 G1 契约**（打开判据次序 + 迁移前校验清单）」；「唯一责任者 = **G2 实施席位**：DDL、重定位账、版本推进全是物理实现；本 G1 只裁契约形状（追加式账本、无物理删、重定位链作为 routeNs 输入）」；「迁移/backfill 以机制事件封闭名单落账……显式登记迁移事实、不回写历史行」 |
| P-13 | `g1/G1-CONTRACT-EVENT-AUTHORITY.md` §2.4（L226-228）/ EA-4.2/4.5（L310-356） | 「`ns-relocated`（DESIGN B.5-5）在 G1-NS-01 裁定前不入名单（锚文件以 `planned:true, gated_by:'G1-NS-01'` 占位……**B 面名称仍须其契约自裁**）」；`AuthorizationContext` 九字段全形 + `gateFullShape` |
| P-14 | `g1/G1-CONTRACT-EVENT-AUTHORITY.md` §7.2（L492） | `integrity-audit-recorded` 载荷 `drift: { routeDirMismatchCount, relocationGapCount } | null // G1-NS-01 落地后加维` |
| P-15 | `attacks/review/RE-REVIEW-G6-A.md` §① 3a 行（L21）+ 附录 C | 打开期扫描 SQL 族建议；「显式迁移通道需带 `capability-transferred` 三元组见证的 ns 改写——但 `dir.ns` 冻结与它正面冲突……**这是 G1 设计题不是修法题**」（该建议的 transferred 形态被本文 RL-5.3 **否证**，理由见彼处） |
| P-16 | `READINESS.md`（L159, L208） | D-28 行（身份行不可改不可删的修法与裁定原话）；D-31 行（「一次完全合法、全走机制通道的操作 = 永久毒化全库双时间读面」与包 6 止血） |
| P-17 | `CONTRACTS.md` §16.2 包 6（L717-722）/ `G1-RECONCILIATION-CHECKLIST.yaml` G1-STORAGE-02 | 触发器体摘要判据与「与 SCHEMA 同源 ⇒『删定义』形态是设计外真空」⇒ 本文 RL-5.2 的名单/体改造引用同一批外置纪律 |

---

## 1. RL-1 裁定：append-only 重定位记录（B1，唯一合法形态）

### 1.1 层界句（本文第一判据，冻结）

**不可迁移的是逻辑身份**——`ObjectID`、`kind`、`space`、owner `CapabilityID`、逻辑 Capability 所有权
与单 Space 唯一写者（R-01/R-05/R-09/R-10）；**可迁移的是物理存储命名空间**——capability 的持久
状态行所在的物理位置标签（`capability_route.ns` 及其下 `domain_state` 行的位置键）。物理 ns **不是**
科研身份：RD-01/ID-02 的不可变清单是 kind 与 space，不含物理 ns（R-09/R-10）；#44 把 Directory 定义
为「最小身份路由信息」且允许「迁移记录与数据/路由更新原子一致」（R-02/R-05）——路由的信息**可随
受控迁移更新**，身份的出生事实不可。

### 1.2 Directory 出生事实不可改写；互斥的化解点

- `dir.ns` 是 Directory 创建时固定登记的**出生事实**，`directory_no_update`/`directory_no_delete`
  在位（P-02），D-28 裁定「owner 一经登记不可变更」**一字不重开**。
- **重定位对 `object_directory` 零行写入**——既无 UPDATE 亦无 INSERT。这正是 G6-A 3a 行宣告的
  「迁移通道与 `dir.ns` 冻结互斥」（P-15/P-08）的化解点：该互斥的前提是「迁移必须改写身份行」，
  本合同把迁移定义为「route 改写 + 物理数据重映射 + append-only 账 + 机制事件」（P-09 B.4(iii)），
  前提不成立，互斥消失。**判据 RL-1.2**：任何重定位事务前后 `object_directory` 行集逐字节等，
  且任何声称「重定位」的通道若写 directory 行即为契约违例（夹具 T-P6 钉行集等式；T-N6/T-N7 钉
  伪造面走不了合法通道）。
- 出生 ns 永久可审计：对象的 `dir.ns` 与 capability 的重定位链共同构成「物理位置历史」的完整
  可解释来源（§6.5）。

### 1.3 重定位的定义（五要素缺一不可）

「重定位（Relocation）」= 在**同一条原子提交**内完成下列五件事；任何只完成子集的操作**不是**
重定位，机制面也不给它通道：

1. **实际数据搬迁**：该 capability 名下全部机制状态行（现形 = `domain_state` 中 `ns = fromNs` 的
   全量行）从旧物理位置映射到新物理位置（RL-6.1 的列语义与 digest 判据）；
2. **物理位置映射**：位置键（`ns` 列）改写；行的身份列（oid、revision）、内容列（payload_json）、
   时刻列（recorded_seq）与契约版本列（contract_version）**逐字节不变**；
3. **审计见证**：一条 `ns-relocated` 机制事件先于路由变更落账、同事务（P-01 写序纪律），带
   RL-5.4 的全形信封；
4. **原子切换**：`capability_route.ns` 改写与 (1)(3) 及 `meta.ns_epoch` 推进在**同一事务**提交，
   不存在可观察的中间态（RL-5.1）；
5. **历史读取**：切换后全部历史截点可读，读归属判据按「出生 ns + 重定位链」两源解析（RL-6.5），
   历史快照逐字节同切换前（同一物理行，只是位置键变了）。

**「只改 `route.ns`」被本契约明文禁止**：那正是 D-31 毒化形态的机制化翻版（P-16），本契约的
存在就是为了让「改路由 + 搬数据 + 落账 + 可历史读」成为一个不可拆分的原子动作。

### 1.4 B2（解冻 `dir.ns`）弃案维持

带审计见证的 UPDATE 直改身份行 = 重开 D-28 已裁定面 + 抹掉出生 ns 历史取证字段 + 守卫面加宽
（P-09 B.3 代价清单原样维持）。**本合同不解冻任何身份行**。

---

## 2. RL-2 重定位账与事件形状（TS；表设计为契约形状，生产 DDL 归实施批）

### 2.1 `namespace_relocation` 账（append-only 工作流账）

```ts
/** 一次重定位的全生命周期账。每步追加一条新 step 行；(relocationId, stepSeq) 为主键。
 *  判据（表设计，落码归实施批）：任何 UPDATE/DELETE 由触发器拒（复用 P-03 存储层信号文本
 *  同族词形 RELOCATION_LEDGER_FROZEN）；「当前态」= 该 relocationId 下 stepSeq 最大行。 */
interface NamespaceRelocationRecord {
  readonly relocationId: string;              // 机制发号，保留前缀 NSR-（§11.4）
  readonly stepSeq: number;                   // 严格单调（同 capability_route.changed_seq 纪律同型）
  readonly capability: CapabilityId;
  readonly fromNs: string;                    // 提案时的当前路由 ns（execute 时复核）
  readonly toNs: string;
  readonly provenance: 'AT-TIME' | 'AFTER-THE-FACT-REPAIR';  // RL-8.4 永久来源字段
  readonly state: RelocationState;            // §10.1 状态机
  readonly proposalDigest: string;            // 'sha256:<hex>'：规范提案字节摘要（不透明，X-2 同型不重算）
  readonly approvalDigest: string | null;     // 批准记录摘要
  readonly checklistDigest: string | null;    // RL-4 校验清单通过凭据摘要
  readonly contentDigest: string | null;      // RL-6.1 源行内容摘要（execute 事务内前后各算一次，必须相等）
  readonly auditLedgerSeq: number | null;     // COMMITTED 时 = ns-relocated 事件行的 ledger seq
  readonly repairEvidence: RepairEvidence | null;  // AFTER-THE-FACT-REPAIR 必填，AT-TIME 必 null
  readonly proposedBy: string;                // 主体标识（运维/装配根面）
  readonly approvedBy: string | null;         // ≠ proposedBy（RL-3.3 判据）
  readonly createdAtMs: number;
}
```

账的**信任方向**写死：`namespace_relocation` 是运维/机制工作流账（记录「谁提案、谁批准、清单跑没跑」），
**不是**读归属判据的链源；链源唯一 = `ledger` 内的 `ns-relocated` 行（append-only、触发器保护、
不可删改，P-01/P-04 同面）。工作流账被改写改变不了任何读判定——伪造读合法性必须去伪造 H 行
（痕迹不可删，处置归运维/审计，与 P-04 裸面边界同条同词）。

### 2.2 `ns-relocated` 事件载荷（机制封闭名单成员；本合同即 B 侧自裁文书）

```ts
/** ns-relocated 的 ledger.payload_json。行本身由机制实现内部直写（EA-2.2 通道矩阵），
 *  通用通道 mint ⇒ EVENT_AUTHORITY_REQUIRED（P-04/EA-2）。信封 = EA-4.2 AuthorizationContext
 *  全形九字段，axis 固定 'capability-admin'（路由审计类，EA-4.5）。 */
interface NsRelocationEventPayload {
  readonly capability: CapabilityId;
  readonly fromNs: string;
  readonly toNs: string;
  readonly oidScope: 'ALL';                   // RL-3.4：唯一合法值，全量原子（见 §14.1-3）
  readonly contentDigest: string;
  readonly checklistDigest: string;
  readonly proposalDigest: string;
  readonly approvalDigest: string;
  readonly provenance: 'AT-TIME' | 'AFTER-THE-FACT-REPAIR';
  readonly repairEvidence: RepairEvidence | null;
  readonly relocationId: string;
}

interface RepairEvidence {                    // RL-8.4；provenance=AFTER-THE-FACT-REPAIR 时必填
  readonly sourceRefs: readonly string[];     // 原始库/备份/来源引用（字符串引用，机制不解释其真伪）
  readonly observedDriftDigest: string;       // 机制复算的「当时观测漂移集」摘要，与账/事件互检
  readonly operationGrant: string;            // 运维授权凭据引用
  readonly repairedBy: string;                // 修复执行主体（capability-admin 取证的 actor 同源）
}
```

事件名裁定：`ns-relocated` 入机制封闭名单，**本契约即 EA-2.4 流程的「机制新增可观察运行事实」提案
与批准文书**（B 面名称由其契约自裁，P-13）；锚文件 `planned:true→false` 的翻转为**独立提交**，
受 EA-6.2 **R4 EVENT_RECON_COUPLING**（名单语义行与写码模块禁同提交）。本合同**不新增第二个机制
事件名**——重定位的每个工作流步进是账行，不是事件（§12 对应表的第一行）。

### 2.3 `meta.ns_epoch`（新计数键）

`meta` 新键 `ns_epoch`：每次重定位/修复提交时 +1；受既有 `meta_counter_monotonic` 触发器保护
（下调/删除拒，P-07 邻面 D-29 同族）。作用 = 陈旧路由缓存的 fail-loud 判据（RL-7.3）。

---

## 3. RL-3 Port 签名（提案 / 批准 / 校验 / 执行 / 回退 / 修复）

平面：全部成员在**机制运维面**（装配根/运维授权的 Kernel 侧方法，与 `setRouteEnabled`、
`transferRoute`、`auditRequiredIntegrity` 同面，P-04/§16.1「插件可见面零巡检能力」句）；
**插件可见面（face/tx/writer）零增删**，`arch-independence.test.ts` 运行时面对拍照旧。

「interface RelocationPorts {   // 机制运维面成员（示意签名；VerifiedPrincipal 沿用现状注入）

  // ① 提案：只记账（PROPOSED step），零数据动作、零 H 事件。
  proposeRelocation(a: {
    readonly capability: CapabilityId;
    readonly expectedFromNs: string;          // 提案人对「当前路由 ns」的预期值，execute 时复核
    readonly toNs: string;
    readonly requestedBy: VerifiedPrincipal;
    readonly note?: string;
  }, by: VerifiedPrincipal): RelocationHandle;

  // ② 批准：capability-admin 断言（入口即拒形同 transferRoute 的 'capability-admin' 轴）；
  //    RL-3.3 批准判据；零数据动作、零 H 事件。
  approveRelocation(relocationId: string, by: VerifiedPrincipal): void;

  // ③ 校验（只读，零写）：跑 RL-4 封闭清单，产 checklistDigest；digest 绑定清单时观测的
  //    ns_epoch 与 contentDigest，任何后续状态变化使其失效（RL-3.5）。
  precheckRelocation(relocationId: string, by: VerifiedPrincipal):
    { ok: true; checklistDigest: string; contentDigest: string; rowCount: number } |
    { ok: false; failedGate: RelocationGate; detail: Record<string, unknown> };

  // ④ 执行：唯一原子切换通道（RL-5）。要求批准在场且新鲜（对同一 proposalDigest）、
  //    校验新鲜（同 ns_epoch/contentDigest）。返回 committed（首次结果）或 committed 的
  //    首次结果（幂等重放，RL-7.2）。
  executeRelocation(relocationId: string, by: VerifiedPrincipal):
    { status: 'COMMITTED'; auditLedgerSeq: number; contentDigest: string } |
    { refusal: RefusalCode; detail: Record<string, unknown> };

  // ⑤ 校验（事后/审计）：只读复算。账 ↔ 事件 ↔ 路由 ↔ 行集四方对账 + 链完备性。
  //    不一致 ⇒ 点名并计入审计面 drift 计数（RL-8.2）；不阻塞任何读写（C2/EA-7 只报不阻同族）。
  verifyRelocation(relocationId: string): RelocationVerification;

  // ⑥ 回退：**不是撤销**——构造一次反向重定位（toNs↔fromNs 互换）的新提案，走 ①–④ 全流程，
  //    需要**新的独立批准**；原 ns-relocated 事件与账步一字不动（append-only，H 不可删改）。
  proposeRollback(sourceRelocationId: string, requestedBy: VerifiedPrincipal): RelocationHandle;

  // ⑦ 存量漂移修复：RL-8.4/8.5 唯一合法入账通道（AFTER-THE-FACT-REPAIR）。
  proposeRepair(a: {
    readonly capability: CapabilityId;
    readonly fromNs: string; readonly toNs: string;   // 与观测漂移逐字相符
    readonly evidence: { readonly sourceRefs: readonly string[]; readonly operationGrant: string };
    readonly requestedBy: VerifiedPrincipal;
  }): RelocationHandle;   // 批准+执行复用 ②④；执行走 RL-8.5 修复事务形（路由行零改）
}」

### 3.3 批准判据（RL-3.3）

① 批准人持 `capability-admin`（`assertAuthority`，缺轴 ⇒ `AUTHORITY_REQUIRED`，先于任何写）；
② 批准人 ≠ 提案人（自批 ⇒ `RELOCATION_PRECONDITION`，gate='APPROVAL'；「非作者批准」的同族纪律，
EA-2.4 步骤 2）；③ 批准绑定 `proposalDigest`（批准后再改提案参数 ⇒ 旧批准失效）；④ 修复提案的
批准**额外**要求 `evidence.operationGrant` 在场（运维授权，RL-8.4）。

### 3.4 覆盖范围（RL-3.4）

`oidScope` 封闭单值 `'ALL'`：**一个 capability 的全部机制状态行原子迁移，不允许分批**——分批
会产生「半旧半新」可观察窗口（每行各自选边 = 每次读都可能读到不同物理世代），与 D-31 的「同一
对象同一时刻两个答案」同族（§16.3 D-24 读侧后果句）。挂载登记/Facet 扩展记录等**其它以 ns 为
位置键的表**随 RL-6.4 的 `RELOCATABLE_NS_KEYS` 封闭清单并入同一事务；A 节（G1-FACET-01）挂载
表落地时以「加入该清单」为迁移联动的唯一接口（B.5-3 的裁定形态）。

### 3.5 新鲜性（RL-3.5）

checklistDigest 绑定的失效条件（任一发生 ⇒ execute 需重跑 precheck）：`meta.ns_epoch` 变化、
源行集 contentDigest 变化、路由行 changed_seq 变化。这把「校验时所见」与「切换时所有」做成
可核事实，堵住「校验通过后并发变更再切换」的 TOCTOU（RL-4.3）。

---

## 4. RL-4 迁移前校验与目标准备清单（封闭清单；唯一责任者 = 本契约，P-12 D5-a）

`RelocationGate` 封闭集（清单名即 detail.failedGate 取值，**不得旁加**；扩充 = 本合同冻结面变更，
夹具 S 组逐等）：

「1. AUTHORITY        入口主体与批准主体各过 capability-admin 断言（RL-3.3①）。
 2. ROUTE_STATE      路由行在位、enabled=1、持久行 ns = expectedFromNs；提案的 toNs ≠ fromNs。
 3. NS_SHAPE         toNs 匹配「^[a-z0-9][a-z0-9._-]{0,63}$」（非 ASCII、空白、控制符、超长即拒；
                     传输层形状卫生，同型 EA-1.3a），且非空白/非引号等字面量歧义形。
 4. TARGET_UNCLAIMED 全路由表（含停用行）无任何 capability 的 ns = toNs——capabilityOfNs 反向
                     映射唯一性（kernel.ts L245-249 现状函数即判据点）；跨 capability 抢位即拒。
 5. TARGET_EMPTY     全部 RELOCATABLE_NS_KEYS 表内 ns = toNs **零行**。不合并、不覆盖、不「清理后
                     继续」——目标残留是漂移或他人资产，两种都不允许被重定位碾过。
 6. SOURCE_PARSEABLE 源行集逐行：payload_json 可解析（JSON.parse 过）、oid/revision/recorded_seq
                     非空且类型对。contract_version 为 ''（迁移器回填前形态，READINESS D-6）的
                     行**不因此阻断**重定位——它照原样整体搬迁，读者面版本判据（assertContractVersion）
                     在新位置继续拒读；重定位不是洗白通道，也不越权代迁移器盖章。
 7. CONTENT_DIGEST   对源行集算 sha256(按 (oid, revision) 排序的 [(oid, revision, payload_json,
                     recorded_seq, contract_version)] )；行数同时入账。
 8. NO_INFLIGHT      同 capability 无非终态重定位账（capability 级单在途；并发双提案后者即拒）。
 9. CHAIN_INTACT     该 capability 既有重定位链**前缀完备**且末点 = 当前路由 ns——存在未修复
                     漂移（链断/无链）时禁止「叠加重定位」把漂移盖成新的事实（先走 RL-8 修复/隔离）。
10. EPOCH_STABLE     清单首尾各读一次 meta.ns_epoch 相等（并发重定位探测）；execute 事务内
                     复核 1/2/5/7/10（RL-4.3）」

- **RL-4.1 顺序**：GATE 1–3 是纯输入判据（先于任何读库，拒绝零残留）；4–9 只读复算；precheck
  全程零写（含 ns_epoch 只读；不落 ledger、不动 domain_state）。
- **RL-4.2 校验不过 ⇒ 零切换**：任何 gate 失败 = `RELOCATION_PRECONDITION`（detail 见 §11.2），
  账记 REJECTED 终态，路由/数据/事件零动。
- **RL-4.3 TOCTOU 复核**：execute 事务体内重跑 gate 1/2/5/7/10；任一不符 ⇒ 事务回滚，全态
  回切换前（SQLite `begin immediate` 原子形，P-01/#44 L242 R-06 同型），重试从新 precheck 起。

---

## 5. RL-5 活跃路由切换的原子性与触发器判据相容

### 5.1 单事务内容（唯一合法切换事务；写序即判据）

「begin immediate
   1. 复核 gate 1/2/5/7/10（RL-4.3）
   2. 重算 contentDigest，与 precheck 值逐字等（不等 ⇒ 回滚）
   3. 物理重映射：对每个 RELOCATABLE_NS_KEYS 表，ns=fromNs 的行位置键改为 toNs
      （UPDATE 位置键列；身份/内容/时刻/版本列零触碰；RL-6.1/6.2）
   4. 落审计：INSERT ns-relocated 事件行（机制内部直写，全形信封 RL-5.4；seq = 新 changed_seq）
   5. UPDATE capability_route SET ns=toNs, changed_seq=第 4 步 seq WHERE capability=…
      ——enabled/plugin_id/contract_version 一字不动（RL-5.2 拆单判据）
   6. UPDATE meta SET value=value+1 WHERE key='ns_epoch'
   commit」

- **不存在可观察中间态**：路由已切/账未落、账已落/数据未搬、数据已搬/路由未切——三形态在
  提交边界上均不可见（同事务原子；P-01「审计先行必须与变更同事务原子，否则『先审计』反而制造
  幽灵审计」句原样延伸：**唯一一条事务边界**，不经 `tx()` 回调的写只有已登记的运维裸面）。
- 回滚（含提交期失败）⇒ 全态回切换前，**序号也不留 ghost**（P-01 D27-5 同判据：`meta.ledger_seq`
  与 ns_epoch 都不前进）。

### 5.2 `route_change_guarded` / `ROUTE_AUDIT_REQUIRED` 相容改造（P-01/P-07 现文的两处不相容点名 + 修法）

现触发器与重定位**不可同真**的两点，本契约逐点裁定（触发器体改造落实施批，随 `SCHEMA_VERSION`
推进 + `REQUIRED_TRIGGERS` 摘要重登 + 打开判据同批，P-17 外置锚纪律随批适用）：

1. **子句②事件名白名单**（现文 `in ('capability-enabled','capability-disabled','capability-transferred')`）
   ⇒ 改为**四元集合**，加 `'ns-relocated'`。不相容点：现白名单下 `ns-relocated` 审计行过不了
   `ROUTE_AUDIT_REQUIRED`；改后见证判据一字不减（actor 非空 + `axis='capability-admin'` +
   `authorized=1` + payload.capability 字面相符，P-04）。
2. **子句③方向判据**（现文「改路由三元组（含 ns）必须配 `capability-transferred`」）⇒ 拆为三条：
   - `enabled` 翻转 ⇒ 仍须 `capability-enabled/disabled` 对应方向事件（一字不动）；
   - `plugin_id`/`contract_version` 变化 ⇒ 仍须 `capability-transferred`（一字不动）；
   - **`ns` 变化 ⇒ 必须配 `ns-relocated` 且 payload.fromNs = old.ns ∧ payload.toNs = new.ns
     字面相符**；ns 变化 ∩（enabled 翻转 ∨ plugin_id/contract_version 变化）同语句发生 ⇒ 拒，
     abort 信号文本 `ROUTE_RELOC_SPLIT_REQUIRED`（存储层信号文本，**不入** `RefusalCode`
     封闭集——P-03 的区分原样沿用）。

**变异验收（父席 2026-11-01 通信裁定，按其要求记入；任何新/改判据都要有「架空它必红」的实证）**：
本节改造的三条判据各配一条**常驻夹具架空形**（不是删除）——子句②名单/事件名判据 ↔ `routeGuardMUT2`
（去掉事件名核对，任意在册结构齐全的审计行即过）；fromNs/toNs 字面相符判据 ↔ `routeGuardMUT4`
（保留事件名、去掉 payload 位置字面核对）；拆单判据 ↔ `routeGuardMUT5`（去掉混合语句拒绝）。
每条自验断言的方向固定：**真实判据必须拦住对应负例，架空判据必须放过同一负例**（否则正反例表
对「架空」没有判别力，见夹具 T-M2/T-M4/T-M5）。**还原方式如实写明**：MUT 函数从不替换真实函数——
真实判据 `routeGuard` 恒为 `run_*` 主路径唯一调用者，MUT 仅在自验断言分支中旁路调用、结果只进
断言不进世界状态；「架空」不需要还原，因为真实判据从未被改动（照 EVT 夹具「变异常驻不删除」先例）。

**拆单判据的理由（单一事实 = 单一 changed_seq = 单一事件名）**：一条 `capability-transferred`
行声称的是「所有权/实现移交」这一机制事实；重定位没有发生移交，写 transferred 行 = **伪造一条
未发生的机制事实**（这正是子句②要防的「把谎言写进删不掉的表」的镜像形态）。G6-A 3a 行「显式
迁移通道需带 `capability-transferred` 三元组见证的 ns 改写」的建议形态因此被**本合同否证**——
该建议与其同行的「这是 G1 设计题」自注一致地指向：设计题的答案不是复用移交名，而是 RL-2.2 的
自裁新名 + 拆单。一次「移交并迁 ns」的运维需求 = 两笔事务（transferRoute 一笔、relocate 一笔，
先后序不敏感），各自审计、各自可归因。混合语句被拒时路由行一字不动（夹具 T-N11）。

### 5.3 `TRANSFER_NS_DRIFT` 永久保留（防旁路申明）

本契约**不撤销、不放宽** `TRANSFER_NS_DRIFT`（P-05）：移交通道永远不携 ns；「反正有重定位了，
把移交改回携 ns」被明文禁止——两通道各有事实语义（移交=实现归属变更；重定位=物理位置变更），
合并 = 回到 D-31。回归钉：`transferRoute` 携异 ns ⇒ 入口即拒、零半成品（既有 4 例语义不变，
夹具 T-N1 复钉模型判据）。

### 5.4 见证 = EA-4.5 全形（复用，不减不增）

`ns-relocated` 行的信封 = `AuthorizationContext` 全形九字段（P-13/EA-4.2），`axis='capability-admin'`、
`authorized =` 入口 `principalCan` 结论、`envelope.actor = row.actor` 同源（EA-4.4/4.5）。触发器
核形 + 审计复算 `replayAuthorityEvidence` 三态（EA-4.6）全适用；**禁止**按当前配置回算历史行的
授权（C-18 同句）。

---

## 6. RL-6 物理搬迁：搬什么、不碰什么、历史怎么读

### 6.1 列语义与 digest 判据

`domain_state` PK=(ns, oid, revision)：

| 列类 | 列 | 重定位时的处理 |
| --- | --- | --- |
| **物理位置键** | `ns` | 唯一被改写的列（fromNs→toNs）——它就是「物理位置」本身 |
| 身份列 | `oid`, `revision` | 逐字节不变（修订身份不因搬家而变，B.7-2/P-09） |
| 内容列 | `payload_json` | 逐字节不变（内容 digest 进事件载荷与账，前后两算必等） |
| 时刻列 | `recorded_seq` | 逐字节不变（登记时刻是历史事实，不是位置属性） |
| 版本列 | `contract_version` | 逐字节不变（读者的契约版本判据 `assertContractVersion` 照常运行；迁移不代盖章，gate 6 句） |

**位置键不是行内容**是本节的裁定句：改 `ns` 列 = 行从位置 A 出现在位置 B；B.7-2 的「行内容……
逐字节不变」以 (身份, 内容, 时刻, 版本) 四类列为度量，`contentDigest` 是其可机验形态（RL-4 门 7）。

### 6.2 零写面清单（RL-6.2）

重定位事务对下列表**零写入**：`object_directory`（RL-1.2）、`records`（record_id 全局键、不随 ns
搬家）、`journal`（重定位不是领域权威变更，不产技术性变更通知——状态内容逐字节不变，投影无需
被惊动；§5.1 无第 7 步）、`projection_state`/`projection_cursor`（派生面，读侧按新位置解析即可）、
`ledger` **除那条 `ns-relocated` 审计行外**零增删改。`meta` 仅 `ns_epoch` +1 与既有的 ledger_seq
发号。

### 6.3 物理搬迁不产生新科研事实、不产生新科研修订（冻结判据 RL-6.3）

「一次重定位的机制外可见净效应 = 路由行 ns/changed_seq、状态行位置键、一条**机制事件**、一次
ns_epoch 推进。它**不**产生：领域事件（零条）、`object-revised`/`record-backfilled`（零条）、新
revision、新对象、新记录、投影输入变化。科研史不因搬家多一页（B.7-5/P-09）；`ns-relocated` 是
**机制自身的运行事实**（EA-1.1 机制事件定义），不是科研事实，与「机制事件不进业务投影」的既有
边界同条。」

机验形态（夹具 T-P6）：切换前后对全部表做行集差分——`ledger` 差集恰为一条 ns-relocated；
`domain_state` 按 (oid, revision) 聚合后行集与内容逐字节等（只有 ns 列变）；`object_directory`/
`records`/`journal` 差集为空；任何 revision 号不新增。

### 6.4 `RELOCATABLE_NS_KEYS` 封闭清单（防「只搬一半表」）

「每张以 ns 为位置键的机制表必须**显式登记**于 RELOCATABLE_NS_KEYS：{domain_state}（现形全集）
+ {挂载登记/扩展记录表（G1-FACET-01 落地时）}。构建期判据：对存储 SCHEMA 扫描『列名 = ns 的
表』，结果集 ⊆ 清单 ∪ 显式豁免集（豁免须逐表给『位置无关』论证，封闭列出、只减不增）——新增
ns-keyed 表而未入清单 = 构建红。此判据同时是 RL-3.4 全量原子性的实现前提。」

### 6.5 历史读取与重定位链（读归属判据升维）

`routeNs`（P-06 现状单点，读写共用）升级为 `routeNs(registry, dir, chain)`：

「effectiveNs ⇐
   route.ns = 当前路由行 ns；chain = 该 capability 的 ns-relocated 行按 seq 升序的 [(fromNs,toNs)]
   （链源 = ledger 行，异源于任何可改工作流账，RL-2.1 信任方向句）
 ① route.ns = dir.ns ⇒ 返回 dir.ns（现状快路径，历史与现网零成本不变）
 ② 否则当且仅当【前缀完备】：chain 存在起点 = dir.ns 的连续 hop 序列（hop_i.toNs = hop_{i+1}.fromNs）
    且末点 = route.ns，且每个 hop 的行过 gateFullShape（P-13/EA-4.5）⇒ 返回 route.ns
 ③ 其余（无链 / 断链 / 起点非出生 ns / 信封不全形）⇒ SCHEMA_INCOMPATIBLE（现状同码同形，
    快照面 fail-loud 语义一字不改——一行归属不符不得炸整页的 §14.5 分界与 D-24 读侧遮蔽计数
    在扫描面照旧）」

- **前缀完备是反洗白判据**：一条尾点正确的孤立行解释不了起点在别处的出生（例如 dir.ns=A、
  route.ns=C、账里只有 B→C ⇒ 拒）。往返（A→B 再 B→A）天然可判：链覆盖 birth 点即可
  （夹具 T-P3/T-P9）。
- 历史快照逐字节同切换前：同一个物理行（身份/内容/时刻/版本列未动）换了位置键，按新位置键
  读到的是同一份字节——「历史读取」要素（RL-1.3-5）的度量 = 逐截点快照对比（夹具 T-P1）。

**6.5a 链的诚实分层（界内判据 vs 界外边界；父席 2026-11-01 通信裁定，按其要求记入）**

链源 = `ledger` 的 `ns-relocated` 行，而异源性要说实话到最后一层：`ledger` 只有
`ledger_no_update`/`ledger_no_delete` 两触发器（P-07 同文件实测），**不禁 INSERT** ⇒ 界外裸面
（`port.raw` DML / 裸文件）可以向 H 插入一条形态齐全、甚至带伪造全形信封的 `ns-relocated`，
拼出一条「完备」链。本契约据此分层，**不把检测悄悄升级成『保证』**（G6-A 已定过这个调门）：

| 层 | 判据 | 强度 |
| --- | --- | --- |
| **界内（插件可达）** | 通用通道 mint ⇒ `EVENT_AUTHORITY_REQUIRED`（机制名预留，EA-2）；入参无见证字段可填（EA-4.3）；写入点全形闸 + actor 同源（EA-4.4/4.5）；路由通道无 ns 参数（P-05） | **防御**（可达面归零的先例 = P-04 五名预留） |
| **界外（裸 SQL/裸文件）** | 可伪造链行与信封 ⇒ RL-6.5② 与 §8.1 步 4 在判据层**无法区分伪造与真账**（信封是形状+字段的机验，机验判不了裸面自签） | **登记为边界，不承诺检出**；唯一恒真是痕迹：H append-only ⇒ 伪造行**不可删**（`ledger_no_delete`），处置归运维/审计取证（P-04 裸面边界逐字同族） |

**`relocationGapCount` 是检测，不是防御**：它报告「无前链背书的漂移」（结构漂移、丢账、断链），
对伪造链**不可检出**（伪造行本身构成背书）。它的产品价值 = 把 F-G6A-4 的「零声纳」变成「每次
审计/打开都有可回看的计数与点名」，把伪造成本从「改一行路由无人知」抬到「必须在删不掉的 H 上
连事件带信封伪造并留永久痕迹」——**抬成本 + 留痕迹 + 可回看，三者是它能说的话的全部**；夹具
T-N16 把「伪造链过闸 = 已登记界」与「界内 mint 仍零」钉成并列断言，防止实现或文档日后把检测
写成防御。

---

## 7. RL-7 恢复条件（崩溃 / 重试 / 数据不完整 / 陈旧缓存）——逐条判据，不许「事务保证一切」一句带过

- **RL-7.1 切换事务前崩溃**（提案/批准/校验阶段任何中断）：precheck 只读 ⇒ 库态零变化；账的
  非终态步留在 PROPOSED/APPROVED/PRECHECKED，可继续可 ABANDONED；路由、数据、事件不动。
- **RL-7.2 事务中崩溃 / 重试幂等**：SQLite 原子提交 ⇒ 崩溃后必为「旧态照常」或「新态全成」两态
  之一（F-02/F-03）；重放同 proposal 到已 COMMITTED ⇒ **返回首次结果，不产生第二笔账、第二条
  H 事件**（B.7-4「同参数重放不产生第二笔账」的机制落点：幂等键 = proposalDigest + COMMITTED
  账步在场）。改参重试 = 新提案新批准（RL-3.3③）。
- **RL-7.3 旧进程陈旧路由缓存**：进程启动时载入的内存路由视图不随重定位失效（D-25 同族实话：
  「进程内即时、跨进程最终一致」）。判据：**任何按位置键解析状态的读写，解析前核对内存 ns_epoch
  与持久 meta.ns_epoch；失配 ⇒ `SCHEMA_INCOMPATIBLE` fail-loud**——陈旧窗口内旧进程**禁止**按旧
  ns 静默读到空集或错答（D-31/F-03「换实现不迁 ns 曾静默返回空」的教训反读：宁可拒答，不可
  假答）。恢复条件 = 重启后按持久路由 + 链重载（Q44「首版只承诺重启式升级」R-01 的边界原样
  承载）。跨进程主动失效机制 = G1 余项（与 D-25/EVT §9.2-⑤ 同一余项，不新立项）。
  **信息面纪律并入 RL-8.1 的单一判据（见 RL-INFO）——本条的 fail-loud 与拒开点名是同一条
  「普通调用者响应面零差分」判据的两个触发点，实现不得拆成两处各做各的**。
- **RL-7.4 数据不完整**（源行不可解析/缺列）：gate 6 失败 ⇒ `RELOCATION_PRECONDITION`
  (failedGate='SOURCE_PARSEABLE')，零切换；单行修复归独立运维审计动作，修完重跑 precheck。
  机制**不得**「跳过坏行继续搬」——部分搬迁 = 新漂移制造机（T-N5）。
- **RL-7.5 目标残留 / 并发变更**：gate 5/9/10 + 事务内复核（RL-4.3）；冲突即回滚零残留，
  重试从新 precheck 起（F-08/F-09）。
- **RL-7.6 崩溃窗口的跨版本读取**：事务提交前的读取按「旧路由 + 旧位置」自洽；提交后的读取按
  「新路由 + 链 + 新位置」自洽；两态之间没有第三种可观察态（RL-5.1）。读到哪一态都可归因
  （changed_seq/auditLedgerSeq 可查）。
- **RL-7.7 裸面残余（诚实边界，登记不承诺）**：持 `port.raw`/裸文件者可在 H 写一条形态齐全的
  `ns-relocated`（连全形信封一起伪造）再过闸——预留与全形闸把伪造成本从「随便改一行路由」抬到
  「必须在删不掉的 H 上连机制事件带信封一起伪造」，**痕迹不可删、处置归运维/审计**（与 P-04
  D-27 裸面边界逐字同族；夹具 T-N7 把「真判据拦什么、拦不住什么」钉成断言，不夸大）。

---

## 8. RL-8 D-31 历史面：打开期漂移检测、隔离与事后修复（自立条款）

**自立依据**：#47 SF §8 对该要求零承接（R-14，blob 实测）+ SF §12/SD §6 明写不裁（R-15/R-17）+
附三 F-1「检测责任只能本 PoC 侧自立」（P-10）+ D5-a「唯一责任者 = 我方 G1 契约」（P-12）。
本节即该自立责任的正文；「等 #47 定了我们再对齐」被本契约永久废止（P-10 句）。

### 8.1 打开判据次序（新增项加粗；任一步 fail-loud，禁静默修复）

「1. storage_schema_version 版本墙（§16.2 既有，不改；先跑——读者假设不成立时后续判据无意义）
 2. 触发器名 + 体摘要在位（REQUIRED_TRIGGERS，含本契约 RL-5.2 改造后的新体；P-17 外置锚随批）
 3. max(ledger.seq) ≤ meta.ledger_seq 水位判据（既有，§16.3）
 4. **ns 链完备性全表比对**：对每条 `object_directory` 行 join 启用路由，route.ns ≠ dir.ns 的行
    必须过 RL-6.5 前缀完备判据；violations（无链/断链/信封不全形）⇒ **拒开**：
    `SCHEMA_UPGRADE_REQUIRED`（复用打开路径码——§16.3 水位归零判据复用先例同型；detail 给
    counts 与 oid 集的摘要），并把 violation oid 集**点名到运维/审计面**
 5. 其余既有打开判据照旧」

- **报告面裁定（B.5-2）**：拒开细节（点名 oid 集、计数、断裂 hop）只进**运维/审计面**；插件/
  调用方面只拿到 `SCHEMA_UPGRADE_REQUIRED` 统一形（与 `TRANSFER_NS_DRIFT`「只回显调用方自己的
  输入」先例同型延伸，P-05；E-01 家族的「拒读即 oracle」教训在此的反用：打开失败形态对一切
  调用者同形，信息面收缩在运维侧）。
  - **RL-INFO（单一信息面判据；父席 2026-11-01 通信裁定，把两处绑成一条，实现不得分开做）**：
    「漂移相关的**一切**对普通调用者的可观察响应——① 打开期拒开（§8.1 步 4）、② 陈旧 ns_epoch
    fail-loud（RL-7.3）、③ 无链快照 fail-loud（RL-6.5③）——**响应面零差分**：同一 `(code, 键集)`
    形态，不含 oid 集 / 计数 / hop / ns_epoch 值 / 是否被点名 的任何差分；点名与全部细节**只进
    运维/审计面**（`auditRequiredIntegrity` 返回 + 打开报告的运维侧结构）。**判据**：同一漂移库上，
    任意两个不同 `ReadContext`/不同主体的普通调用者拿到的拒答体逐字节等（夹具 T-N8 钉「拒开点名
    不进 caller 体」、T-P7 钉「陈旧 fail-loud 的 caller 体与 RL-6.5③ 无链体同 (code,键集)」、
    T-N13 钉「无链快照 caller 体不含 oid」——三条共用同一个 `callerBodyFor(caller)` 构造函数，
    构造面单一 ⇒ 实现无法拆成两处各写各的）」。
    **本条与 E-01/D-12 的存在性 oracle 教训同族**：漂移检测本身不得成为「探测哪些对象存在/漂移」
    的 oracle；检测越强，普通面越要无差分。
- **顺序即判据**：交换步 1/4 的变异必须红（GT 系列「判据次序变异必红」验收形，D5-a 验收列）。

### 8.2 运行期检出（auditRequiredIntegrity 加维；只报不阻）

`auditRequiredIntegrity()` 新增 `drift: { routeDirMismatchCount, relocationGapCount }`——即
EA-7.2 预留的载荷两维（P-14）正式激活：`routeDirMismatchCount` = enabled 路由 ns ≠ dir.ns 的
目录行数；`relocationGapCount` = 其中无前缀完备链背书者。每次审计运行照 EA-7.1 落一条
`integrity-audit-recorded`（把 F-G6A-4 的「零声纳」翻成「每次运行落一条可回看的持久行」，
F-G6A-5 解法同族）；**不阻塞任何读写**。重开照常开的 v7 形态（P-08）自此 = 打开期第 4 步检出。

### 8.3 隔离（QUARANTINE）

打开期第 4 步检出 `relocationGapCount > 0` ⇒ 该库进入 `QUARANTINED` 姿态：**拒开**（不降级、
不带病运行——「带病运行」正是 F-G6A-4 里版本墙顺住≠检出的教训正面处置）；运维面报告点名 +
`provenance` 未定标注。`QUARANTINED` 的唯一出路 = RL-8.4/8.5 修复流，或运维确认**无法证实
来源**时转 `PERMANENTLY_QUARANTINED`（终态；再启需用户级重新评审记录，机制不自决）。

### 8.4 存量漂移入账（backfill 裁定写死；覆盖 B.5-1 的开放点）

- **默认禁止自动补造「当时合法迁移」的证据**——没有任何自动机制、打开期扫描或迁移器可以为
  先例漂移生成重定位账（B.7/P-09 原句全文效力；`migrateLegacyRecords` 不承担此责，P-08 (2) 段
  「救济面为空是裁定不是指控」的裁定在此转正为义务：**它今后也无权补造**）。
- **唯一合法入账** = RL-3⑦ 修复通道：具备运维授权（`operationGrant` 在场 + capability-admin
  取证）的主体，在**验证原始库/备份/来源**（`sourceRefs` 引用登记）之后做的**一次显式修复**。
  机制的验证责任如实限定：复算「观测漂移集 digest」（对当前 dir/route 差集按 oid 排序计算）与
  证据申报的 `observedDriftDigest` **互检**（不等 ⇒ `RELOCATION_PRECONDITION`
  (failedGate='REPAIR_PROVENANCE')）；「证据所引的备份是否真为事实来源」仍是**人认边界**（与
  EVT §6.1「批准者是否真读了 diff 仍是人认」同界，不假装机器能审意图）。
- 账与事件**永久保留「事后修复」与「当时发生的合法迁移」之别**：`provenance:'AFTER-THE-FACT-REPAIR'`
  + `repairEvidence` 必填，随 `ns-relocated` 行进 H（不可删）+ 账行（不可改）；读面链判据
  **接受** AFTER-THE-FACT-REPAIR hop（它背书的是「这段漂移有来源验证过的修复记录」），但审计面
  永久点名这些 hop（来源字段事后不得抹）。
- **无法证实来源 ⇒ 隔离并明确报告**：机制拒签修复账（T-N9），库保持 `PERMANENTLY_QUARANTINED`；
  **不得用一条新 relocation 事件把未知漂移洗成合法历史**（B.7 最后一句原文效力：签发者若能在
  无来源时落账，「检出-救济同源」退化为「伪造救济同源」，F-G6A-2 伪证族的镜像必须在此切断）。

### 8.5 修复事务形（与 §5.1 的差异逐项）

「1. 复核 gate 1/3/4/6/7/8/10 + REPAIR_PROVENANCE（gate 2 的 expectedFromNs=dir 侧 ns、gate 9 的
     「既有链末点 = fromNs」按漂移事实核）；
 2. 重映射**残留在 fromNs 的行**到 toNs（= 当前路由 ns；D-31 历史形态 = 包 5 合法移交后行留旧
     ns——修复补做当年未做的物理搬迁）；contentDigest 前后等；
 3. INSERT ns-relocated（provenance='AFTER-THE-FACT-REPAIR'，repairEvidence 齐）；
 4. **capability_route 零改**（路由已在 toNs——修复不动路由 ⇒ changed_seq 不动，不伪造任何
     路由变更戳）；ns_epoch +1；同事务原子、同写序纪律。」

---

## 9. RL-9 版本层界（D3 落点）与 C6 撤销

### 9.1 两层版本职责表（层界声明成文；「禁止互相冒充」句按 D3-a 原样延伸）

| 轴 | 名称 | 管辖 | 推进权与形态 |
| --- | --- | --- | --- |
| 物理层 | **`storage_schema_version`**（本仓新命名，R-07 三层对表见 ADJUDICATION §2.0） | G2 正式库**打开期物理形态**（DDL/触发器集/水位/§8.1 判据序）；重定位**不改**它（重定位不改表形） | **允许版本墙**（fail-loud 拒开，F-27 实测形态保留）+ 显式、可审计、可恢复迁移（迁移器属 G2；「墙只拒『不可安全读』且不得销毁原字节」= D3-b 并存规则①） |
| 科研层 | `schema_version` / `contract_version` / `rule_set_version`（历史记录自钉） | 历史记录的**可解释性**：每条记录/报告按其钉住版本读；旧解释器保留或显式能力缺失 | **禁止静默改写**旧事实/旧报告/旧授权结论（R-11 C11「不得自动改写旧结论、旧 PASS 或旧使用记录」；R-13 SF-62「绝不回溯」；P-04/§16.2 投影信任模型「禁止按当前配置对历史事件做静默重解释」；重定位对 `domain_state.contract_version` 列逐字节不变 = RL-6.1，版本钉穿得过搬家） |

### 9.2 明写：两者不矛盾；C6 的二选一撤销

**不矛盾判据（冻结句）**：`storage_schema_version` 的墙判「这批物理字节能不能交给当前读者」，
科研版本轴判「这条记录按哪个版本的规则解释」——**判据对象不同层**，一条记录完全可以「物理上
当前读者读得了（库开着）+ 语义上按钉住的旧版本解释（版本钉 + 旧解释器）」，两条纪律同时成立。
**C6 撤销的一句话依据**：SF-60 约束的是**领域工件按钉住版本可读**（R-12 与其 L151「版本兼容：
新版本读取旧版本记录不产生字段注入」同节语域），版本墙约束的是**打开期物理形态的 fail-loud**，
两层判据对象不同、可同真，故「SF-60 vs 版本墙」不是冲突，二选一撤销（P-11 D3-b/C6 裁定原文；
B5 的建议裁定人条目随之关闭——该题已按层界裁定，无需用户再选路线）。
并存三条规则原样承接 D3-b：① 墙只拒「不可安全读」且不得销毁原字节；② 可解释性由版本钉住 +
旧解释器保留或显式能力缺失承载（R-08 后半句）；③ **墙与可解释冲突时墙让位为「可旧读+标注」，
永不以改写历史记录实现**。对重定位的直接推论：重定位既不动 storage_schema_version（表形不变）
也不动记录自钉版本（RL-6.1），它与两条轴均正交——搬家不产生版本事件。

---

## 10. RL-10 状态机与故障矩阵

### 10.1 状态机（每条 relocationId 的账步链；终态加粗）

「PROPOSED ─approve→ APPROVED ─precheck→ PRECHECKED ─execute(commit)→ **COMMITTED**
   │            │              │（任一 gate 失败）
   │            │              ▼
   │            └──────────→ **REJECTED**（retry = 新提案，幂等面见 RL-7.2）
   └──abandon（提案人，未批准前）──→ **ABANDONED**
 APPROVED/PRECHECKED 后撤销：需 capability-admin 非提案人 counter-sign → ABANDONED

修复流：QUARANTINED ─proposeRepair→ REPAIR_PROPOSED ─approve→ REPAIR_APPROVED
        ─execute(修复事务)→ **REPAIRED**（链 hop 永久带 AFTER-THE-FACT-REPAIR）
QUARANTINED ─运维确认来源不可证实→ **PERMANENTLY_QUARANTINED**（终态；再启需用户级重新评审记录）

非法迁移（如 PROPOSED→COMMITTED 无批准步、REPAIRED 无 repairEvidence、终态再步进）⇒
RELOCATION_PRECONDITION + 账零污染；回退（proposeRollback）不新增状态——它产新 relocationId，
原链一字不动。」

### 10.2 故障矩阵（18 条；「判据锚」= 夹具用例 id）

| # | 故障点/形态 | 机制行为 | 事后态 | 恢复条件 | 夹具 |
| --- | --- | --- | --- | --- | --- |
| F-01 | 提案/批准/校验阶段崩溃 | precheck 只读 | 库态零变化；账停非终态步 | 重启续用或 ABANDONED | T-P1 前置面 + T-N12 |
| F-02 | 切换事务中崩溃（重映射后/提交前） | `begin immediate` 原子回滚 | 全态 = 切换前（四物齐旧） | 新 precheck → execute | T-N15（并发注入同形） |
| F-03 | 提交后、ack 前崩溃 | WAL 恢复 = 全成 | 新态全成（路由+数据+事件+epoch） | 幂等重放回首次结果 | T-P2 |
| F-04 | 崩溃留半写文件（WAL 截断/水位落后） | 打开判据 §8.1 步 1–3 拒开（水位/版本墙） | 拒开 | 显式恢复流程（G2 迁移器面） | —（G2 故障注入验收，P-12 D5-b） |
| F-05 | 同参数重试（已 COMMITTED） | 幂等返回首次结果 | 账/H 零新增 | — | T-P2 |
| F-06 | 改参重试（toNs 变） | ROUTE_STATE 复核拒（expectedFromNs 失配） | 零动 | 新提案 + 新批准 | T-N12 变体面 |
| F-07 | 源行不可解析/缺列 | SOURCE_PARSEABLE 拒，禁跳行 | 零切换 | 单行独立运维审计修复后重跑 | T-N5 |
| F-08 | 目标 ns 有残留行 | TARGET_EMPTY 拒；不合并不清理 | 零切换 | 残留定性（漂移→RL-8；他人→改 toNs） | T-N4 |
| F-09 | precheck 后路由被并发改（停用/移交/另一重定位） | 事务内复核失配 ⇒ 回滚 | 全态回切换前，零 ghost 序号 | 新 precheck | T-N15 |
| F-10 | 旧进程按陈旧路由读 | ns_epoch 失配 ⇒ SCHEMA_INCOMPATIBLE（拒答不假答） | 无静默空/错答 | 重启（重启式边界 R-01） | T-P7 / T-N13 邻形 |
| F-11 | 无链漂移库重开 | 打开判据步 4 拒开 + 运维面点名 | QUARANTINED 姿态 | RL-8.4 修复流 或 隔离终态 | T-N8 |
| F-12 | 在既有漂移上直接重定位 | CHAIN_INTACT 拒（不叠漂移） | 零切换 | 先修复/隔离 | T-N14 |
| F-13 | 修复证据与观测漂移互检不符 | REPAIR_PROVENANCE 拒；**零伪造链** | PERMANENTLY_QUARANTINED | 无（用户级重评） | T-N9 |
| F-14 | 通用通道 mint `ns-relocated` | EVENT_AUTHORITY_REQUIRED（机制名预留，EA-2） | 零行 | 不存在合法 mint | T-N6 |
| F-15 | 裸面 route UPDATE 改 ns：无审计行 / 只配 transferred 行 | 触发器拒（ROUTE_AUDIT_REQUIRED / RL-5.2 子句③拆分）；连全形信封伪造 ns-relocated 者可过闸 = **已登记界**（T-N7 钉两侧） | 无痕变更被拒；有痕伪造痕迹不可删，处置归运维/审计 | 运维/审计处置 | T-N7 / T-N16 |
| F-16 | ns+enabled 同语句混合改 | ROUTE_RELOC_SPLIT_REQUIRED 拒 | 路由一字不动 | 拆两笔事务 | T-N11 |
| F-17 | 同 capability 双提案并发 | NO_INFLIGHT 拒后者 | 单在途保持 | 前者终态后新提案 | T-N12 |
| F-18 | 零对象能力重定位 | 全 gate 平凡过，链照常记 | 空 ns 搬家成功 | —（空 ≠ 错 ≠ oracle 面） | T-P8 |

---

## 11. RL-11 错误码（复用封闭集；新增一枚，论证如下）

### 11.1 复用表

| 码（现状在集） | 本契约的适用位 |
| --- | --- |
| `AUTHORITY_REQUIRED` | 提案/批准/执行入口缺 capability-admin（现状 `assertAuthority` 同码） |
| `CAPABILITY_INACTIVE` | 路由行缺失/停用（routeNs 现状同码同形，P-06） |
| `SCHEMA_INCOMPATIBLE` | 会话内无链漂移快照读（RL-6.5③）、陈旧 ns_epoch 读（RL-7.3）——**同码同形于 D-31 现状**，读面 fail-loud 语义一字不改 |
| `SCHEMA_UPGRADE_REQUIRED` | 打开期判据失败（§8.1；复用先例 = §16.3 水位判据同码） |
| `TRANSFER_NS_DRIFT` | 移交携 ns（永久保留，RL-5.3） |
| `EVENT_AUTHORITY_REQUIRED` | 通用通道 mint `ns-relocated` / 入参带见证字段（EA-2/EA-4.3 原样） |
| `TX_CLOSED` / `TX_CONTENTION` / `LEDGER_SEQ_CONFLICT` | 执行事务命中原语义，不另立 |

### 11.2 新增（恰一枚，§14.2 同规登记）

`RELOCATION_PRECONDITION`——语义：「重定位/修复的**门判据**不过 ⇒ 零切换」，detail 封闭为
`{ capability, fromNs, toNs, failedGate, observed }`：只回显调用方自己的输入与机制本地可判事实
（行数、digest、门名），**不含任何他空间存在性判定**；每码钉「不得泄漏跨空间存在性」负例
（空空间与有对象空间同形，包 6 三码同规，P-05 先例）。
**为什么不能复用**：`SCHEMA_INCOMPATIBLE` 判「读者读不了」（读面调用方，修法=换读者/迁移库），
本码判「迁移不允许开始」（运维调用方，修法=补门/清障/改参重提案）——**不同调用方、不同修法**，
正是 `HARD_REF_NOT_PINNED` 与 `REQUIRED_REF_MISSING` 分码的既有论证形（「二者对调用方是不同的
修法」）；折叠进读面码会把迁移失败伪装成读者故障，破坏 §14.5 的失败形态分界。

### 11.3 存储层信号文本（不进封闭集，P-03 区分原样）

`ROUTE_AUDIT_REQUIRED`（既有）、`ROUTE_CHANGED_SEQ_MONOTONICITY`（既有）、
`RELOCATION_LEDGER_FROZEN`（账表 UPDATE/DELETE 拒，新文本）、`ROUTE_RELOC_SPLIT_REQUIRED`
（混合语句拒，新文本）。abort 词是存储层信号文本，`RefusalCode` 封闭集不因此扩张。

### 11.4 保留前缀与键名登记（防「顺手新面」）

`NSR-` = `namespace_relocation.relocationId` 机制保留前缀（完整前缀语义归 `G1-LINK-01`，登记
义务同 D-21 先例）；`meta.ns_epoch` 新键受 `meta_counter_monotonic` 保护；`RELOCATABLE_NS_KEYS`
为构建期名单（非运行时码）。

---

## 12. RL-12 事件对应与见证来源（哪个动作落哪个机制）

| 动作 | H（ledger）事件 | 重定位账 | 数据/路由 | 见证来源 |
| --- | --- | --- | --- | --- |
| 提案 / 批准 / precheck / abandon | **零** | PROPOSED/APPROVED/PRECHECKED/ABANDONED step | 零动 | 无（工作流记账；H 见证只属于「发生过的运行事实」） |
| execute 提交（合法重定位） | **恰一条 `ns-relocated`（provenance='AT-TIME'）**，先于路由 UPDATE、同事务（P-01 写序） | COMMITTED step + auditLedgerSeq | RL-5.1 步 3/5/6 | 机制内部直写（EA-2.2 唯一合法作者）+ EA-4.2 全形信封（axis=capability-admin，authorized=入口 principalCan，actor 同源）；触发器核形回退位（EA-4.5 全形 + `authorized=1`，P-04） |
| 回退（反向重定位提交） | 再一条 `ns-relocated`（AT-TIME，方向相反）；**原事件一字不动、不删不改** | 新 relocationId 全链 | 同 execute | 同上（独立提案独立批准独立见证） |
| 修复提交（存量漂移） | 恰一条 `ns-relocated`（**AFTER-THE-FACT-REPAIR** + repairEvidence） | REPAIRED step | 仅残留行 remap + epoch；路由零改 | 同上 + RL-8.4 来源互检记录（人认边界如实标注） |
| verify / 打开扫描 / 审计运行 | `integrity-audit-recorded`（EA-7.1 既有名；drift 两维激活，RL-8.2）；`ns-relocated` 零 | 无 | 零动 | 机制审计通道（只报不阻；不进插件读面，EA-7.4 非 oracle 三条原样） |
| 打开期拒开 / 隔离转态 | 零（库未打开） | QUARANTINED/PERMANENTLY_QUARANTINED（运维面账） | 零动 | 运维/审计面报告（§8.1 报告面裁定：插件面同形） |

**领域事件、`object-revised`、`record-backfilled` 在任何重定位动作下均为零条**（RL-6.3）；
`ns-relocated` 行永不进业务投影（机制事件定义 + EA-7.4 通道封闭同族）。

---

## 13. RL-13 正反例表（可执行判据；与夹具逐一对账，id 双向一致）

| id | 正/负 | 场景 | 期望判定 | 夹具 |
| --- | --- | --- | --- | --- |
| T-P1 | 正 | 合法端到端：N 行对象、gate 全过、execute 提交；逐截点历史快照对比切换前 | 成功；`contentDigest` 前后等；历史快照逐字节等；账 COMMITTED；epoch+1 | run_T_P1 |
| T-P2 | 正 | 同参重放（已 COMMITTED） | 返回首次结果；H 仍恰一条；账 COMMITTED 步不增 | run_T_P2 |
| T-P3 | 正 | 回退 = 反向提案走完；迁出期出生的对象（dir.ns=B）在回到 A 后读 | 成功；dir.ns=B 的对象经 B→A hop 可读；dir.ns=A 经 A→B→A 前缀完备可读；两条 AT-TIME 事件俱在 | run_T_P3 |
| T-P4 | 正 | 重定位后重开：打开判据序 1–5 | routeDirMismatch>0 且 relocationGap=0 ⇒ 开库成功；审计行落 drift 两计数 | run_T_P4 |
| T-P5 | 正 | 存量漂移修复：造无链漂移库 → 拒开 → proposeRepair（证据 digest 互检过）→ 执行 | REPAIRED；链 hop 永久 AFTER-THE-FACT-REPAIR；残留行 remap；路由行零改；重开成功且审计点名 repair hop | run_T_P5 |
| T-P6 | 正 | 零科研事实差分：execute 前后全表行集/seq 对比 | `object_directory`/`records`/`journal` 差集空；`ledger` 差集恰 1 条 ns-relocated；domain_state 仅 ns 列变、(oid,revision) 集与内容逐字节等；无新 revision | run_T_P6 |
| T-P7 | 正 | 陈旧窗口 fail-loud：持旧 ns_epoch 视图的读者在提交后读 | `SCHEMA_INCOMPATIBLE`（非空集、非旧数据）；重启视图后读成功 | run_T_P7 |
| T-P8 | 正 | 零对象能力重定位 | 成功；链记；读面同形无 oracle | run_T_P8 |
| T-P9 | 正 | 链前缀完备正例：A→B→C 三级链，birth=A/B/C 的对象各按自己 birth 点链段可读 | 三类对象全部 effectiveNs=C 可读；逐字节 = 搬迁前 | run_T_P9 |
| T-N1 | 负 | `transferRoute` 携 ns | `TRANSFER_NS_DRIFT`，零半成品（行为零变化钉） | run_T_N1 |
| T-N2 | 负 | 未批准 / 批准人=提案人 即执行 | `RELOCATION_PRECONDITION`（failedGate='APPROVAL'），零写 | run_T_N2 |
| T-N3 | 负 | 提案人无 capability-admin | `AUTHORITY_REQUIRED`，零账步零写 | run_T_N3 |
| T-N4 | 负 | 目标 ns 残留行 | failedGate='TARGET_EMPTY'，零切换、不合并 | run_T_N4 |
| T-N5 | 负 | 源行 payload 不可解析 | failedGate='SOURCE_PARSEABLE'；禁「跳行继续」 | run_T_N5 |
| T-N6 | 负 | 通用通道 mint `ns-relocated` | `EVENT_AUTHORITY_REQUIRED`（classification='mechanism' 同形） | run_T_N6 |
| T-N7 | 负 | 裸面形：route UPDATE 改 ns 无审计 / 只配 transferred 行 / 连全形信封伪造 ns-relocated | 前两形触发器拒（ROUTE_AUDIT_REQUIRED；transferred 名实不符按 RL-5.2③拒）；第三形**过闸=已登记界**，断言钉「边界如实、痕迹在 H 不可删」 | run_T_N7 |
| T-N8 | 负 | 无链漂移库重开 | 打开判据步 4 拒开 `SCHEMA_UPGRADE_REQUIRED`；点名仅运维面、插件面同形；QUARANTINED | run_T_N8 |
| T-N9 | 负 | 修复证据 observedDriftDigest ≠ 机制复算 | failedGate='REPAIR_PROVENANCE'；**零伪造链**（H 差集空）；转 PERMANENTLY_QUARANTINED | run_T_N9 |
| T-N10 | 负 | no-op 重定位（toNs=当前 ns） | 拒（NS_SHAPE/TARGET_EMPTY 覆盖）；零切换 | run_T_N10 |
| T-N11 | 负 | ns+enabled 同语句混合改 | `ROUTE_RELOC_SPLIT_REQUIRED`；路由一字不动 | run_T_N11 |
| T-N12 | 负 | 双提案并发（第二提案） | failedGate='NO_INFLIGHT'；单在途 | run_T_N12 |
| T-N13 | 负 | 会话内无链漂移的快照读（D-31 现状形复钉） | `SCHEMA_INCOMPATIBLE`，非整页毒化（扫描面遮蔽计数照旧） | run_T_N13 |
| T-N14 | 负 | 在断链 capability 上直接重定位 | failedGate='CHAIN_INTACT'；不叠漂移 | run_T_N14 |
| T-N15 | 负 | precheck 后并发路由变更再 execute | 事务内复核失配 ⇒ 回滚零残留（含 ghost 序号零留）；重试成功 | run_T_N15 |
| T-N16 | 负 | **界外裸面伪造链（登记边界的正断言）**：裸 SQL 直插一条形态齐全带信封的 `ns-relocated` 造「完备链」，随后打开 + 读 + 界内 mint 对照 | 伪造链在判据层过闸（**已登记界**，T-N16 断言「过」而非「拦」）；但伪造行 `ledger_no_delete` 不可删（痕迹恒在）；**同一夹具态下界内通道 mint `ns-relocated` 仍零**（`EVENT_AUTHORITY_REQUIRED`）——两条并列，防「检测」被读成「防御」；`relocationGapCount` 对伪造链报 0（不可检出）如实断言 | run_T_N16 |

---

## 14. RL-14 裁定记录、关系表与未决项

### 14.1 DESIGN B.5 六题逐条回答

1. **存量漂移入账**（B.5-1，开放点「授权主体名单与证据形状」）：授权 = capability-admin 断言 +
   `operationGrant` 引用在场（「运维授权的主体」的机制可判形——**名单本身**沿用宿主注入的
   authority 账本，机制不新立名单面，与全部 VerifiedPrincipal 面同界）；证据形状 =
   `RepairEvidence` 封闭四字段（RL-2.2）；防伪 = 观测漂移 digest 互检 + 全形信封 + actor 同源
   （正面回应「守卫必须核信封且核到 actor 同源」的点名，P-04/EA-4.5）。
2. **打开流程次序**：§8.1 全序 + 报告面裁定（点名只运维面、插件面同形，B.5-2 的
   「#44 §5.2 Directory 不得泄漏」约束在打开失败形态的延伸）。
3. **覆盖范围**：`oidScope:'ALL'` 全量原子，禁分批（RL-3.4）；与 Facet 挂载表联动 =
   `RELOCATABLE_NS_KEYS` 登记制（RL-6.4），G1-FACET-01 表落地即入清单（A.6-6 的接口）。
4. **跨进程陈旧**：ns_epoch fail-loud（RL-7.3）——陈旧从「错答/静默空」降级为「可用性角」；
   主动失效机制仍属 G1 余项（D-25/EVT §9.2-⑤ 同项不重复立项）。
5. **重定位事件名**：`ns-relocated`（RL-2.2 自裁；EA-2.4 六步 + R4 异提交纪律；不复用
   `capability-transferred`，否定理由 RL-5.2）。
6. **`SCHEMA_VERSION` 推进与打开判据新增项**：RL-5.2 触发器改造 + `namespace_relocation` 表在位性
   + `ns-relocation` 名进机制名单 + §8.1 步 4，同批随 `SCHEMA_VERSION` 推进与
   `REQUIRED_TRIGGERS` 摘要重登；G1-STORAGE-02 的「期望摘要外置」纪律逐字适用（P-17），防
   「只护新库」与「删定义洗白」两形态。

### 14.2 B.7 五项技术不变量 → 本文落点（映射表，缺一即未冻结）

| B.7 项 | 不变量 | 正文落点 | 机验 |
| --- | --- | --- | --- |
| 1 | 迁移前数据校验与目标准备 | RL-4 封闭清单 + RL-4.2 零切换（归属收回我方，P-12 D5-a；B.7-1 括注「属 #47 决策面」作废句随附三 F-1） | T-N4/T-N5 |
| 2 | 唯一权威 + 历史修订身份不变性 | RL-3④ 唯一执行通道 + RL-6.1 列语义/contentDigest | T-P1/T-P6 |
| 3 | 活跃路由切换原子性 | RL-5.1 单事务 + RL-5.2 触发器相容 | T-N7/T-N11/T-N15 |
| 4 | 失败/崩溃/重试/跨版本读取恢复条件 | RL-7 全节 + §10.2 矩阵 18 条（「不许以『事务保证一切』一句带过」按原句执行） | F 表夹具列 |
| 5 | 物理复制不得当成新科研历史事件 | RL-6.3 冻结判据 + 零写面清单 RL-6.2 | T-P6 |

### 14.3 与 #42 / #44 / #47 已裁定语义的关系（#47 行按条件式纪律）

| 已裁定语义 | 关系 | 依据 |
| --- | --- | --- |
| #44 §6.1 Q44（R-01）实现可迁包、移交受控原子、重启式边界 | **一致 + 补全物理半边** | 本文 RL-1/RL-5 是其「迁移记录与数据/路由更新原子一致」（R-02）的落地；RL-7.3 采其重启式原句为界 |
| #44 §5.2 Directory（R-04/R-05）最小身份路由、kind/space 不可变 | **一致** | RL-1.2 零 directory 写入；路由信息按定义可随受控迁移更新 |
| #44 §7 Q40（R-06）单事务全成全回滚 | **一致** | RL-5.1 复用同一条事务边界纪律 |
| #44 §11（R-07/R-08）版本轴分离、结构/语义迁移分离、旧解释器句 | **一致** | RL-9 层界表；重定位不触任何版本轴（RL-9.2 推论） |
| #42 RD-01/ID-02（R-09/R-10）身份不可变清单不含物理 ns | **一致** | RL-1.1；出生 ns 永久保留，历史引用恒可解析（RL-6.5） |
| #42 C11（R-11）不得自动改写旧结论/旧 PASS/旧使用记录 | **一致** | RL-6.2/6.3 零写面；搬家不动任何记录（夹具 T-P6 差分） |
| #47 SF-60/62（R-12/R-13）历史版本可读、不回溯 | **一致（条件：#42 合并且条文文本不变）** | C6 按层界撤销（RL-9.2）；SF-62 不回溯与 RL-8.4 禁止补造同立场（本契约更严：多了隔离分支，更严不是冲突——RECON-PR47 5.6 口径） |
| #47 SF §12/SD §6/T-GAP-09/10（R-15/R-16/R-17）明写不裁本面 | **无冲突 + 自立** | §8 自立条款；不声称任何跨平面合一；不写「属 X 决策面」 |
| PoC 内部 D-28 / D-31 止血 / 包 5 写序 | **承接不推翻** | RL-1.2（D-28 一字不动）、RL-5.3（TRANSFER_NS_DRIFT 永久）、RL-5.1（审计先行同事务原子原样） |
| EVT 契约（名单/信封/对账） | **承接** | `ns-relocated` 自裁（P-13 预留位翻转）；EA-4.5 全形；EA-6 R1–R4 适用；drift 两维激活（P-14） |

### 14.4 未决与真·用户决策（诚实清单）

- **真·用户决策：无新增项。** D5-a/D5-b 已把归属收回我方（P-12）、D3-b 已撤 C6 二选一（P-11）、
  B6 的问题句（P-15 对账账本 B6，`G1-RECON-PR47.md` §7）由本契约 + 实施批承接闭合。
- **沿用既有登记、不新立项**：机制名单锚文件与归属账在**正式仓**的最终承载 = EVT 契约 **U-1**
  既登记的用户决策面——本契约的 `namespace_relocation` 表与 `ns-relocated` 名单条目**随 U-1 一并
  承载**（G2 前以本侧车为工作正源）；跨进程主动失效 = 既有 G1 余项；`NSR-` 前缀全集语义 →
  `G1-LINK-01`；触发器摘要外置 → `G1-STORAGE-02`；真实 DDL + 故障注入验收 → `G1-DONE-03` 行
  （D5-b 验收要求逐条：迁移中断回滚零残留、单 Space 失败不阻断——R-08）。
- **本契约自身的变更纪律**：§2 TS 形状、§4 门清单、§5.2 触发器子句、§10.2 矩阵、§11 码表任一
  变动 = 本合同冻结面变更，夹具必须当场红或经三方逐等更新后绿，且需人工批准标记（EA-2.4/
  Frozen-Face-Review 同型惯例）。

---

## 15. 夹具对账声明

本文件与 `G1-CONTRACT-RELOCATION.fixtures.mjs` 互认的机验面（S 编号 = 夹具实际检查行）：
引用表四要素逐行核（S1）、三份上层实取引用下限（S2）、错误码 token 封闭性 + 新增恰一枚（S3/S3b）、
正反例 id 双向逐等（S4）、故障矩阵双向逐等（S5）、门清单封闭集三方逐等（S6）、五要素与 B.7 映射 +
「只改 `route.ns`」禁止句（S7）、冻结关键句在位（S8）、**五条**变异常驻不删除（S9）、6.5a 界内/界外
分层与 RL-INFO 单一判据在位且未把检测写成防御（S10）、不写「属 #47 决策面」+ EVT 锚文 planned/gated_by
承袭（S11）。
判据模型拦截力自验（每条：真实判据拦下负例 ∧ 架空判据放过同一负例，缺一即该负例对「架空」无
判别力）——**MUT-1** `chainCheckMUT1`（链前缀完备架空：起点不符也放行）、**MUT-2**
`routeGuardMUT2`（触发器事件名核对架空：任意审计行即过）、**MUT-3** `repairMUT3`（修复证据互检
架空：observedDriftDigest 不符仍入账）、**MUT-4** `routeGuardMUT4`（fromNs/toNs 字面相符架空：
名对但位置不符仍过）、**MUT-5** `routeGuardMUT5`（拆单判据架空：ns+enabled 混合语句仍过）。
MUT-2/4/5 即 RL-5.2 三条触发器改造的架空形。退出码 0 = 全部通过。
