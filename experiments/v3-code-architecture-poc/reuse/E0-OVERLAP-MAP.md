# E0-OVERLAP-MAP —— 「插件自家已有」×「V3 新写」职责重叠实测图

> 席位：复用 PoC 证据席 E0（2026-11-01，分支 `g1/contracts-20261031`，工作树开工时 `git status --porcelain` 空、exit 0）。
> 性质：只读实测 + 本文件一份新建；未改任何既有文件、零 git 写操作、未触碰 `references/**`。
> 本文所有行数 = `wc -l` 原样输出；所有引用行号 = `grep -n` 输出；每条命令附退出码（当场重跑一致）。

---

## 1. 插件生产侧既有模块盘点（自家资产）

### 1.1 `src/host/history/` —— 事件账本（append + replay + projection），**3521 行**

```
$ find src/host/history -type f | xargs wc -l | sort -n   # exit 0
    56 replay/errors.ts        135 replay/state-map.ts
    58 replay/index.ts         169 replay/wrapper.ts
    61 replay/replay.ts        220 replay/query.ts
    81 registry/relations.ts   234 registry/emitters.ts
    83 registry/late-registration.ts  350 replay/rebuild.ts
    87 registry/aggregate.ts   423 registry/registry.ts
   100 registry/transitions.ts 630 registry/validate.ts
   136 registry/index.ts       698 registry/types.ts
  3521 total
```

- **职责**：`registry/` = 事件注册表 + 校验 + 发射器（append 侧）；`replay/` = 重放、重建（rebuild/state-map = projection）、时点查询（query）。append 物理写面在生产 store：`src/host/persistence/store/store.ts:282 appendEventsImpl`（`grep -n appendEvents src/host/persistence/store/store.ts`，exit 0）。
- **事件类型 = 20 个（冻结）**：`src/host/history/registry/types.ts:387 「The 20 registered event type names」`（:388 `HistoryEventType = keyof HistoryEventMap`），接口 `HistoryEventMap`（:363-384）。机读镜像同数：`schema/history/history-events.schema.json` 内 `"const"` 判别支提取 = **20**（python3 提取，exit 0；枚举含 RUN_STARTED…TOPOLOGY_MERGE_REALIZED）。
- **双时序 = 信封双字段**：`types.ts:110 occurredAt`（事件实际发生）+ `:112 recordedAt`（插件记账时刻，「never caller-specified」）；迟到注册语义句：`src/host/history/registry/late-registration.ts:15 「双时序的意义正在于此」`。
- **append-only 由存储层触发器强制**：`schema.ts:131-138` `history_event_no_update/no_delete`（「history_event is append-only (INV-HIST-1)」）。

### 1.2 `src/host/service/{dependency,stale,topology,semantics}` —— **合计 4419 行**

| 模块 | 行数 | 职责（index.ts 头注释原文要点） |
|---|---|---|
| `service/dependency/` | **620**（service 313 / projection 101 / types 145 / errors 35 / index 26） | 「the dependency service… addDependency / removeDependency, the pure ADJ-7 projection (`projectDependencyEdges`)」——依赖边命令 + 事件流投影 |
| `service/stale/` | **1157**（service 422 / git-capture 278 / types 230 / closure 163 / index 64） | 「closure blob-OID basis + stale detection」——git blob 闭包上的陈旧检测 |
| `service/topology/` | **978**（service 611 / types 243 / errors 92 / index 32） | 「public surface of the Topology Service」——运行/任务拓扑（fork/merge 落 `TOPOLOGY_*` 事件） |
| `service/semantics/` | **1664**（service 896 / types 338 / protocol 199 / query 153 / index 41 / errors 37） | 「seven-write semantic records service… the ADJ-2 canonical semantic write protocol」——七类语义记录的规范写协议 |

### 1.3 `src/**/persistence/` —— 唯一落点 `src/host/persistence/`，**4179 行**

```
$ find src -type d -name persistence        # exit 0 → 仅 src/host/persistence
```

- **启动四检查**：`hardening/startup.ts:5 「runStartupIntegrityChecks runs the four checks」`——①`checkDatabase`（quick_check + user_version）②tree ③`checkGitWorkspace` ④「dual-真源 consistency SPOT check」（:8-15，聚合不短路）。文件：startup 347 / migrations 337 / types 346 / git-check 222 / consistency 178 / tree-check 139 / db-check 145 / index 91 / errors 46 / README 76。
- **迁移**：`hardening/migrations.ts:125 「The PRE-RELEASE migration registry: deliberately EMPTY」`（`:128 「pre-release 不做迁移」`）+ user_version 单调禁降级（:204）。
- **store**（事件物理面 + 派生态）：store.ts 998 / types 229 / connection-guard 265 / errors 162 / schema.ts 205（表仅 3 张：`history_event` :99、`derived_state` :144、`meta` :153，`grep -n CREATE TABLE`，exit 0）；meta/ 三件 188。
- **要点**：生产对象**不在** sqlite——对象态是 git 工作区文件（tree/git 检查的存在即证），DB 只有「事件 + 派生态 + meta」。

### 1.4 `src/shared/ids/` —— **636 行**（顶层无 `shared/ids/`，实测落点如此）

allocator 222（「Project 内单调递增计数器，持久化于 operational DB meta 表」）/ registry 144（「All 25 prefixes… FROZEN」，含 `H` HISTORY_EVENT、`OBJ`=Objective、`RPT`=ReportingItem）/ parse 102（「最长前缀优先」）/ file-name 72 / types 47 / construct 30 / index 19。

### 1.5 `dsh-adapter/` —— **合计 12951 行**

- `src/host/dsh-adapter/` **10373**：host/ 9386 + launcher/ 707 + session.ts 280。
- `src/client/dsh-adapter/` **2578**：remote/ 1506 + settings-card.tsx 586 + ui.ts 486。
- 与 V3 关系：宿主接入面（工具/服务挂载），V3 PoC 零接触（§2 复核实测零跨边界 import）。

**生产侧本次相关面小计**：history 3521 + 四 service 4419 + persistence 4179 + shared/ids 636 = **12755 行**（`wc -l` 相加，exit 0）。

---

## 2. PoC 侧盘点（V3 新写）

### 2.1 `src/**` —— **3781 行**（`find … | xargs wc -l`，exit 0）

| 文件 | 行数 | 职责（头注释原文要点） |
|---|---|---|
| `kernel/kernel.ts` | **1450** | 「Kernel 只做四件事：Capability 注册与激活、Object Directory、History Ledger 登记序、单空间 Unit-of-Work（含 Change Journal）」（:2-7） |
| `storage-sqlite/sqlite-port.ts` | **670** | V3 全部 DDL：`ledger`(:32)/`object_directory`(:55)/`capability_route`(:86)/`domain_state`(:150)/`records`(:160)/`journal`(:166)/`projection_state\|cursor`(:172,:176)/`ref_edge`(:181)/`check_report`(:188) + `ledger_no_update/no_delete` 触发器 |
| `contracts/index.ts` | **274** | 机制词汇表（Refusal/ObjectOid/PluginManifest/ownsKinds:234…），`ObjectKindLabel = string`(:18) |
| `kernel/read-context.ts` | **146** | 「先按知识截点过滤可见性，再按对象时间过滤，两步顺序不得交换或合并」 |
| `kernel/projection.ts` | **104** | 「派生投影（读面）：游标 + 基线 + 缺口检测…滞后/缺口/不可判定三态」；`indexQuery` 回 FRESH/STALE(:99) |
| `kernel/internal.ts` | 19 | KERNEL_PORT 内部面门闩 |
| `domains/test-*`（4 件） | 645 | test-records 467 / test-validation 93 / test-object-model 30 / test-facet 45 —— 全为合成占位（§4 复核） |
| `domains/{validation-contract,report-presentation}` | 102 | 校验契约领域侧 + 呈现层脱敏（「本文件**不在** src/kernel/」） |
| `app/{intake-use-case,delegation,standing-use-case}` | 198 | Application 用例 + 写面委派 |
| `harness/{world,paths}` | 183 | 测试世界 + 侧车写入红线「PoC 的一切写入只允许落在 .poc-data/**」（paths.ts:2-3） |

机制层（kernel×4 + contracts + storage-sqlite）= **2644 行**；领域/app/harness = 1137 行。

### 2.2 `g1/*.md` —— **6945 行**（`wc -l $P/g1/*.md`，exit 0）

最大三件：G1-CONTRACT-RELOCATION.md **971**、G1-CONTRACT-EVENT-AUTHORITY.md **769**、G2-DEV-PLAN.md **744**；另 UNIFIED-CONTRACTS 594、COMMIT-SEQUENCE 585、FACET 522、**RECONCILIATION 521**、IDENTITY-GRAMMAR 457、DOMAIN-COMMAND 428、ACCEPTANCE-MATRIX 374、ADJUDICATION-TABLE 355、IDEMPOTENCY 250、FREEZE-CRITERIA 222、REMAINING-USER-DECISIONS 153。

### 2.3 零复用实证：PoC **没有任何一行 import 生产模块**

```
$ grep -rhn "import .*from" $P/src | sed "s/.*from *//" | sort -u   # exit 0
'../app/delegation.ts'; '../contracts/index.ts'; …（全部相对路径）
'node:crypto'; 'node:fs'; 'node:path'; 'node:sqlite'; 'node:url';
```
（`grep -rn "\.\./\.\./\.\./src" $P/src` → 无输出，exit 1。）

---

## 3. 逐模块重叠表

| V3 新写（行数） | 自家既有（行数） | 判定 | 差在哪 / 证据 |
|---|---|---|---|
| **H-Ledger**：kernel.ts 的 ledger 登记序 + sqlite-port `ledger` DDL/触发器（15 行 DDL + 内核内多路 insert :475/:903/:997/:1185/:1229） | `history/`（3521）+ store.appendEvents（store.ts:282 起）+ `history_event` DDL/触发器（schema.ts:99-138） | **部分重叠（append 机制格 = 完全重叠）** | 同：append-only 触发器、seq 单调、双时序（V3 `described_at/recorded_at` ↔ 生产 `occurredAt/recordedAt`）、事件为唯一真源。差：生产 20 个**冻结具名**事件 + 九字段信封强校验（validate.ts 630 行）；V3 `event_type text not null` 不透明名 + `authority_basis` 授权见证列 + `space` 维度。**V3 无 occurredAt 迟到注册的校验经验可白捡** |
| **Object Directory**（kernel object_directory/capability_route + 归属校验） | **无对应物** | **真新增** | 生产对象 = git 工作区文件 + DB 三表（§1.3），无 kind→owner_capability→ns 路由表；最接近的仅 shared/ids 冻结前缀表（25 前缀，静态）。V3 的 AMBIGUOUS_AUTHORITY/CAPABILITY_INACTIVE 装配裁决生产不存在 |
| **Impact Index / 派生投影**：projection.ts（104）+ `ref_edge` 表 + kernel.impactCandidates（kernel.ts:522） | `service/dependency/`（620，其中 projection.ts 101）+ `service/stale/`（1157，closure 163）+ replay rebuild/query（570） | **部分重叠** | 同：「事件流→派生索引」「陈旧可标注不可当空」思想与游标机制。差：生产 dependency=显式 add/remove 命令边、stale=git blob-OID 闭包；V3=修订级 ref_edge + 水位/缺口/不可判定三态 + FRESH/STALE 谓词。生产的闭包算法与事件投影逻辑**可抽为 V3 投影的领域插件**，索引机制本体各留各家 |
| **ID 文法**：`OBJ-${space}-${idn}`（kernel.ts:1179）+ `RPT-${seq}`（:61）+ 契约 IG 文档（g1 457 行） | `shared/ids/`（636：分配 222/解析 102/注册表 144） | **部分重叠（能力面同，文法面另立）** | 生产 25 前缀 FROZEN（registry.ts:46-94），其中 `OBJ` 已 = **Objective**、`RPT` 已 = ReportingItem——V3 用 `OBJ-<space>-<n>` 作通用对象号 = **同前缀异语义**，V3 自己知情：G1-CONTRACT-IDENTITY-GRAMMAR.md:29「V1 前缀注册表…与本面无继承、无映射、不互推（X-8 首版分离承接）」、:64（G-22 现状锚点照录 kernel 发号形）。分配器（meta 计数器、最长前缀解析）**能力可直接搬** |
| **迁移** | `persistence/hardening/`（1706）：migrations.ts 337 + 启动四检查 347 + 四检查件 | **完全缺失（PoC 侧真空）** | PoC src 零迁移器、零启动检查（§2.1 文件清单即证）；READINESS.md:18 自认。自家有现成 seam（migrations.ts:71 「The reserved migration seam」，虽 :125 空注册表）与四检查框架——**这项是 V3 该「抄自家作业」而非新写的最明确一格** |
| **UnitOfWork / Journal**：kernel UoW + `journal` 表 | store.ts 事务 fold（998 行内）+ derived_state | **部分重叠** | 同：单库事务 + 提交序。差：V3 跨 ns 单提交 + journal 供投影增量；生产 fold 面向 derived_state 单形 |
| **ReadContext**（read-context.ts 146：知识截点→对象时间两步过滤） | 无对应（replay/query 220 只查事件历史时点） | **真新增** | 生产无「知识截点（你当时知道什么）」维度 |
| **Capability 激活/装配**（kernel 激活 + manifest 校验） | dsh-adapter（12951）是宿主接入层，非同一职责 | **真新增** | 生产插件模型 = DSH Cordis 插件，无 capability/ownsKinds/requiresAuthority 概念 |

### 复用占比粗算（只算机制层 2644 行，粗粒度、供决策不作账）

- **完全重叠**（append 机制、触发器、发号计数器、sqlite 连接/守卫——生产有同件）≈ **250–350 行（≈10–13%）**。
- **部分重叠**（ledger 校验面、投影/游标、时点读、ID 解析——生产逻辑经「业务无知化」改造后可承载）≈ **850–1000 行（≈32–38%）**，其中估可吸收 40% ≈ 350–400 行。
- **真新增**（capability 激活、授权见证、space/截点、UoW journal、facet、重定位、装配红）≈ **50–60%**。
- **结论**：「V3 新写里可直接/改造复用自家既有」的合计上限粗估 **22–28%**；且可复用集中度最高的是**已被生产实战检验的 append/触发器/校验/迁移 seam**，恰恰不是 V3 的核心创新面——**复用不伤 V3 立论，纯粹是省重造**。

---

## 4. 复审两条事实断言的复核

### (a)「V3 是 1450 行 kernel.ts 从零重做」——**行数成立，「从零」成立于 import 面，表述有半程夸大**

```
$ wc -l experiments/v3-code-architecture-poc/src/kernel/kernel.ts   # exit 0
1450 experiments/v3-code-architecture-poc/src/kernel/kernel.ts
```
- 行数**精确成立**：恰 1450。
- 「从零」在复用意义上成立：PoC src **零 import 生产模块**（§2.3 两条 grep，exit 0 / exit 1）。
- 夸大处：1450 ≠ PoC 全体——src 共 **3781 行**（机制层 2644），另 g1 契约 **6945 行**；且「从零重做」漏报了自家已有同件可复用面（§3 表前三行）。**判定：数字成立；「从零」属实但引用面偏窄。**

### (b)「五类对象一律用 test.* 占位 kind、domains/ 自述测试专用」——**成立（逐字命中）**

- README.md:34：「`src/domains/` | **测试专用合成策略**（五类对象一律用 `test.*` 占位 kind；文件头声明不得当作科研政策）」。
- domains 文件头原文：test-object-model.ts:2-4「**合成领域插件（测试专用）**…**不实现** PR #42 五类对象的字段、状态机或校验政策；这里的 kind 标签与规则一律是占位物，不得被引用为科研语义政策的实现」；test-records.ts:4-5「判据是**合成占位规则**…**不构成** PR #42 任何科研语义政策的实现」；test-validation.ts:5「这里的判据是**合成占位规则**，不是 PR #42 的科研语义政策」；test-facet.ts:2-3。
- 五类对象实名（Proposition/Association/Argumentation/Entity/Concept）只以**禁用词表**形态存在：`grep -n FORBIDDEN` 命中 tests/arch-independence.test.ts:20-24（扫描 Kernel/契约代码，出现即红）。

### 真实科研领域实例数 = **0**（PoC 运行时/夹具内）

```
$ grep -rn "kind:" $P/src $P/tests | wc -l                          # exit 0 → 307
$ grep -rn "kind:" $P/src $P/tests | grep -vc "test\."              # exit 0 → 38 行
（38 行中带字面量者仅 10 行，值全为机制判别标签：）
   7 kind: 'revision-ref' / 2 kind: 'record-ref' / 1 kind: 'object-ref'
$ grep -rhoE "kind: *'[^']+'" $P --include='*.ts' --include='*.mjs' | sort | uniq -c | sort -rn | head
  271 test.claim | 100 revision-ref | 28 record-ref | 16 object-ref | 15 test.artifact
   12 test.subject | 3 uncaught-or-run-level | 3 test.artifact2 | 2 record-declared | 1 unparseable | …
```
- 全部领域 kind 值均 `test.*`；非 `test.` 值全是引用判别/审计分类，**零**科研对象 kind 实例。
- 唯一近例外：`kind: 'ENTITY'` **1 处**，在契约夹具 g1/G1-CONTRACT-RELOCATION.fixtures.mjs:146（`grep -rn`，exit 0）——夹具造 object_directory 行的字符串，非运行实例，且恰在 Kernel 禁词扫描面（`src/**`）之外。
- 佐证句：IMPLEMENTATION-PLAN-DRAFT.md:76「禁止用真实五类对象替换 `test.*` 占位」、:96「`test.*` 占位 kind 与合成策略全部退役」归 G3；READINESS.md:18、EVIDENCE.md:100「仍未测：…真实五类对象字段与状态机」。**判定：断言 (b) 完全成立；真实领域实例数为 0（夹具字符串 1 处除外）。**

---

## 5. 事件真源会不会出现第二套 —— **现状：物理上已是两套并行存储；是否会「第二真源」是两项未决用户决策的后果**

### 5.1 同一存储/同一 schema？——**都不是**（实测两套 sqlite，两张不同表）

| | 生产 V1 | V3 PoC |
|---|---|---|
| 库 | 运营 DB `research.sqlite`（DSH_HOME 内） | 侧车 `.poc-data/**` 独立 sqlite（paths.ts:2-3 红线「绝不碰 V1 `.research/**` / 生产 DB」） |
| 表 | `history_event`（schema.ts:99） | `ledger`（sqlite-port.ts:32）：`seq/space/event_type/actor/authority_basis/object_id/revision/record_id/payload_json/described_at/recorded_at` |
| 事件名 | **20 个冻结具名**（§1.1） | `event_type text not null` 不透明名 + 封闭名单**契约**（EA 名单，锚文件 `EVENT-CONTRACT-LEDGER.json` 未物化） |
| 防改写 | `history_event_no_update/no_delete`（schema.ts:131-138） | `ledger_no_update/no_delete`（sqlite-port.ts:48-51，'HISTORY_IMMUTABLE'） |

### 5.2 `schema/**` 与 V3 契约的关系——**V3 明文不触碰冻结面，承载面悬而未决**

- 冻结面：8 根文档 + `schema/**`（AGENTS.md §5）；`schema/history/history-events.schema.json` 347 行即 V1 事件载荷正源。
- V3 侧逐契声明「不触碰」：G1-CONTRACT-EVENT-AUTHORITY.md:23、G1-CONTRACT-FACET.md:29「本 PoC DDL 在侧车、不在冻结 `schema/**`」、G1-CONTRACT-COMMIT-SEQUENCE.md:30「V1 冻结面…**零接触**。本席未读未改」。
- **U-1 悬置原文**（EVENT-AUTHORITY.md:719-725）：「机制名单锚文件与 EventOwnership 持久表在**正式仓**的最终承载——进 8 份根文档冻结面、进 `schema/**`、还是留 #44 侧文档层？」→ 现行暂定「本侧车…以 `g1/EVENT-CONTRACT-LEDGER.json` + 本文为**工作正源**（G2 前有效）」；REMAINING-USER-DECISIONS.md 项 4（:77 起）补「届时按你的指名迁移，不留双正源」。

### 5.3 复审引用的「R1/R11 待裁原文」——**在 `G1-CONTRACT-RECONCILIATION.md` 中不存在，引用不成立**

```
$ grep -nE '\bR1\b|\bR11\b' g1/G1-CONTRACT-RECONCILIATION.md    # exit 1（无匹配）
$ grep -n "R-11" g1/G1-CONTRACT-RECONCILIATION.md               # exit 1（无匹配）
```
- 该文件实有 **R-1…R-10**，§0 收口表（:15-22）六项全「**已修**」（:17-22），R-7/R-8/R-9/R-10 为后补条目（:336/:400/:449/:493 节题）——**没有任何 R 处于「待裁」**；R-1 是「遮蔽计数的呈现面」（:40），与事件真源无关。
- 真正的「待裁」在别处，事件真源风险的确切载体是：
  - **项 2**（G1-REMAINING-USER-DECISIONS.md:45-60）：「**V3 是否接管 / 替换 V1 历史事件面，接管到什么范围（只新建？只读旧？迁移旧数据？还是永不合一）？**」（:50）；背景句 :49「『与 V1 历史事件面的合一』明文写为**暂不裁决**（自引 `G1-ADJUDICATION-TABLE.md:85`，X-8 行现实际落点 **:86**，行号漂移 1）」。
  - **X-8**（G1-ADJUDICATION-TABLE.md:86）：「首版分离定为规范条款：V3 侧车历史与 V1 事件面**不合一、不互推**；连接仅 HSR 侧 `external_citations[]` 显式登记」+ 尾列「**是**——V1 历史接管/切换范围属用户决策」。
  - **项 4**（:77 起）：机制名单唯一正源承载面未定（否决态后果原文：「机制事件判据的**正源缺失**是结构性缺口」）。
- 语义层依据（说明「不合一」有实据非拖延）：EVENT-AUTHORITY.md:51（C-14/SD-07）「五类对象的追加语义与既有 20 个事件词汇并非一一对应，硬塞会迫使领域语义迁就事件名」；:65（C-28）「不允许为统一命名重写既有 History Ledger」；ADJUDICATION-TABLE.md:346（SD-07）「在裁决前不得声称 HSR 记录已进入单一事件真源」。
- **风险确切形态**：不是「已写出第二套真源」，而是「**两套 append-only 存储已物理并存**（20 冻结名 vs 名单未物化的不透明名）+ 合一/接管范围（项 2）与名单唯一正源承载面（项 4）两题未裁」。最坏路径 = 项 4 否决致名单正源缺失、或项 2 要求接管致「跨平面迁移与双写」新增契约面（:57-59 原文：「直接触碰 EA-5『禁止为统一命名重写既有 History Ledger』…且必须重排 G2 排期」），该文档自评「代价不对称，建议保持不接管」（:59）。ID 文法面同型风险已在 §3（`OBJ-` 前缀双语义，靠「无继承、无映射、不互推」隔离）。

---

## 6. 本席命令与退出码总账（全部只读）

| 命令（代表式） | 退出码 | 关键输出 |
|---|---|---|
| `git status --porcelain`（开工/收工） | 0 | 开工空；收工仅 `?? …/reuse/E0-OVERLAP-MAP.md` 一行 |
| `find src/host/history -type f \| xargs wc -l` | 0 | 3521 total |
| `wc -l src/host/service/{dependency,stale,topology,semantics}/*` | 0 | 620/1157/978/1664 |
| `find src -type d -name persistence -exec find {} -type f \; \| xargs wc -l` | 0 | 4179 total |
| `find src/shared/ids -type f \| xargs wc -l` | 0 | 636 total |
| `wc -l src/{host,client}/dsh-adapter/**` | 0 | 10373 / 2578 |
| `find $P/src -type f \| xargs wc -l` | 0 | 3781 total（kernel.ts 1450） |
| `wc -l $P/g1/*.md` | 0 | 6945 total |
| `grep -rhn "import .*from" $P/src \| …` / `grep -rn "\.\./\.\./\.\./src" $P/src` | 0 / 1 | 无生产 import |
| `grep -rn "kind:" $P/src $P/tests \| wc -l` / `\| grep -vc "test\."` | 0 / 0 | 307 / 38（非机制字面量 0） |
| `grep -rn "kind: 'ENTITY'" $P --include='*.ts' --include='*.mjs'` | 0 | 仅 RELOCATION.fixtures.mjs:146 |
| `grep -nE '\bR1\b\|\bR11\b' g1/G1-CONTRACT-RECONCILIATION.md` / `grep -n "R-11" 同文件` | 1 / 1 | 无匹配（断言引文不存在） |
| `grep -n "^| X-8 " g1/G1-ADJUDICATION-TABLE.md` | 0 | :86 |
| `python3` 提 schema/history const 枚举 | 0 | 20 个事件类型 |
