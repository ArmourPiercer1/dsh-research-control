# dsh-research-control V3 — 完整代码架构草案

> **状态：DRAFT-PROPOSAL / 待架构审查，不是冻结实施契约** · 2026-10-27  
> **讨论来源：** 用户逐项裁定 Q1–Q45；与 [H/S/R 三正交系统讨论稿（PR #42）](https://github.com/ArmourPiercer1/dsh-research-control/pull/42) 对照；此前 [V3 实施契约草案 PR #33](V3_IMPLEMENTATION_CONTRACT-DRAFT.md)、[V3 架构基线](ARCHITECTURE_BASELINE.md) 和 PoC 为历史设计输入，而非本方案自动承接的实现命令。  
> **起草基线：** `main@3d5bd184d9d65ae5a2c87155a87678834484218e`。本文仅涉及未来 V3 的代码结构；**不改变当前 V1 冻结契约、生产数据、Host 接线或权限，不批准开发、不解锁任何 LIVE_* 等级，不设实施阶段或排期**。  
> **2026-10-29 对账更新：** 对照 [PR #42 五类对象 × H/S/R 主基线及细化合同](https://github.com/ArmourPiercer1/dsh-research-control/pull/42)（核对 head `ab6ffafb79b1c928f708d3b9720f631e5546a907`）、Q36–Q45；保留本文件 Draft 地位。本次只修订代码架构讨论稿，不变更 V1 Current、Schema、程序、Gate 或正式设计代次登记。
> **决策标记：** [已裁定] 为 Q1–Q35 已确认的原则；[工程建议] 是本文提出、需在架构审查时批准的具体结构；[上层待定] 留给 H/S/R 科研语义、形式化与校验体系，不由代码架构代为裁决。

## 1. 目标、边界和反目标

### 1.1 产品定位

[已裁定，Q1/Q2/Q3/Q4] V3 是**一体化科研管理产品**：组织计划、任务、Run、Gate，并记录科研活动、来源、知识对象、论证与认识变化。它有一个**宿主无关**的 TypeScript 领域核心，正式产品必须提供 DSH Adapter，并考虑与独立的 `dsh-agent-team` 集成。

**控制权边界不可突破：**

- **Research Control** 是科研计划、Task、科研 Run/Gate、科研资料、命题/论证/正式接纳记录的状态权威。
- **Agent Team** 是 Team、Member、消息、唤醒、执行权限和 Agent 生命周期的状态权威。
- **DSH Host** 继续拥有其自身的 Session 事实；Research Control 仅通过公共接口引用、读取或接收有来源的事实。
- 研究管理产品不直接调度或唤醒 Agent；Agent 执行成功既不自动完成科研 Gate，也不自动证成科研命题。
- 允许彻底重新设计 V3 API、ID、存储及内部语义；**不承诺 V1 兼容或自动迁移**。旧版留作归档参考，不因本提案即时退役。

### 1.2 成功标准

[已裁定] 在新增科研领域、替换领域校验或升级语义解释时，变更应主要局限于相应插件、公开契约与必要的适配贡献，不要求修改机制内核、其他插件私有实现或一个不断增长的 Host 中心文件。能从权威数据可靠重建派生视图，保留已登记历史与不确定性，并在明确 ResearchSpace 边界内访问数据。

[工程建议] 成功的结构性证明不以文件行数或 package 数量为唯一指标，而以依赖方向、可复用测试世界、跨插件原子性、故障隔离和新增能力的变更面为准。

### 1.3 非目标与反目标

- 不让 Kernel 理解 Assertion、FactStanding、物理模型、形式证明或科学真值；不强行设计上层语义修订/Fork 准入规则。
- 不构造通用 RDF 三元组数据库、完整 SHACL/OWL 引擎、通用 Agent 编排器或微服务网络来替代明确的领域代码。
- 不引入可在生产进程中任意热替换的第三方不可信代码；首版采用经过审查的同进程可信插件。
- 不要求科研文件永久存在、内容哈希一致或可成功重建；不因外部资源缺失而使整个研究服务停止。
- 不用 Git 作为科研计划/工作流/认识状态的权威数据库。
- 不把出站预留端口实现成跨系统任务委派/可靠消息分发平台；不复制 TeamDomain。
- 不把已有 PoC 测试全部通过等同于 H/S/R 科研语义已被正式批准。

## 2. 路线比较与所选架构

| 选项 | 优点 | 不采用的原因或限制 |
|---|---|---|
| 延续 V1，逐层叠加语义与兼容层 | 迁移成本较小 | V1 的固定 Project/Topic/Workstream、Git/SQLite 双真源和 Host 结构与目标不同；会固化历史耦合 |
| **重新实现有限多 package 的模块化单体** | 领域与基础机制可分包约束，单进程、可事务化、DSH 可作为独立 Adapter | **采用**；仍须用机械测试约束跨包依赖，不能仅依赖目录约定 |
| 全局 RDF/对象引擎或全面微服务化 | 表达扩展自由度或进程独立性更强 | 复杂状态不变量、事务、运行治理与成本不匹配；也不能凭图结构保证科学语义正确 |

**[已裁定，Q11–Q20] 目标形态：Mechanism Kernel + Versioned Domain Plugins + Typed Capability Ports + Application Use-cases + Product Profiles + Host Adapters。** 插件可演化，但其历史解释契约不可被静默覆盖。


## 3. 总体逻辑架构

\`\`\`mermaid
flowchart TB
    A["DSH / CLI / 外部研究者或 Agent"] --> B["Adapters + Application Use-cases"]
    B --> C["SpaceContext / ReadContext + Capability Ports"]
    C --> W["Workflow 能力"]
    C --> O["五类对象的逻辑 Capability"]
    C --> V["Validation / Provenance / Facet 贡献"]
    W --> T["ResearchSpace Unit-of-Work"]
    O --> T
    V --> T
    T --> D[("单 Space 数据库：领域状态 / Object Directory / History Ledger / Change Journal")]
    D -.-> P["Search / Impact / Graph 派生投影"]
    O -. "公开查询与领域解释" .-> P
\`\`\`

> [已裁定] 图表示**职责与访问路径**而不是运行时调用顺序；可以在一个 package 中实现多个 Capability。Kernel 不能基于图结构推断科研因果；不同 ResearchSpace 使用各自独立的权威数据库，没有互读或业务事务。

### 3.1 H/S/R、五类对象与 Workflow 的正交关系

[已裁定，Q1/Q11/Q36–Q45] 五类对象是**领域认知角色**；H/S/R 是**横切的责任与保证**；二者都不要求与 npm package 一一对应，不产生万能 \`ResearchObject\` 类。

| 语义角色或系统 | 代码层的权威能力与边界 |
|---|---|
| Entity | 稳定指称个体的身份、资源/活动/Agent 等子型；对外 W3C 语义逐类精确映射，不能把活动强转成 \`prov:Entity\` |
| Concept | 定义、术语、研究维度、方法和 Scheme 定义的版本化语义 |
| Association | **非论证性关系的唯一权威记录**，有来源、角色及所描述的时间；不拥有全局真值 |
| Argumentation | Scheme 实例、角色输入、条件、局部结局和可追溯论证；R-L0/R-L1 只适用于此类 |
| Proposition | 独立、真值条件稳定的命题及其 Revision；Assessment、FactDesignation 是其子型 |
| H — History | 统一的不可变 **History Ledger**、原始材料记录及历史查询机制，贯穿全部持久对象；领域解释由对象所属 Capability 负责 |
| S — Semantics | 五类对象各自的结构化含义和分布式 S-L0/S-L1 校验；World/Scope 与表示规则由对应领域定义 |
| R — Reasoning | Argumentation 的 R 校验与科学方法扩展；FactStanding 是由有授权的 FactDesignation **计算**出的业务视图，不另存第二权威 |
| Workflow | 计划、Task、Run、Gate 等科研管理状态；与 H/S/R 通过显式引用组合，不等于 Agent 编排 |
| 高级检索 | Search/Graph/Impact Index 仅由权威数据形成可重建派生读面，不自成权威科研状态 |

[关键限制] PROV 来源关系与 Association 记录**只能有一个权威登记位置**；其他模块可引用、索引或导出，但不得并行维护另一条可变、含义相同的来源关系。引述/评价一项 Association 应产生独立的 Proposition，而不是给原关系添 \`is_true\` 字段。

### 3.2 典型组合（不是创建顺序）

一次未能解析的科研提交可以仅保留在 H；正式对象出现后获得唯一 \`object_kind\` 和 \`space_id\`；一次论证可以引用以前的 PropositionRevision，也可以引用同事务内合法创建的对象；Concept 实质修订不覆盖旧论证；同一个 Entity 可由其他 Capability 维护独立扩展记录。任何一步均不自动变为科学接纳。


## 4. 源码与 package 边界

[已裁定，Q19/Q29/Q44/Q45] **TypeScript + pnpm 的有限多 package 模块化单体**。下面是按责任而非按五类强制拆包的**工程建议**，不冻结路径或包数：

\`\`\`text
packages/
  contracts/           # 薄的 Space/Principal/Ref/错误等跨域协议
  kernel/              # SpaceContext、ReadContext、Directory、Ledger、Tx、Capability 运行机制
  storage-sqlite/      # 可替换的单空间存储驱动
  domains/
    workflow/          # 科研工作流
    object-model/      # 可集中实现 Entity/Concept/Association/Argumentation/Proposition
    history/           # H 查询/原始材料与 AssertionChain 的领域解释
    provenance/        # 来源语义/导入导出；不得复制 Association 权威记录
    validation/        # S/R 校验器贡献与领域 CheckReport
  projections/
    search/            # 可重建的跨域查询索引
    impact/            # 可重建的反向依赖索引
    graph/             # 可选高阶图读面
  application/         # 跨域 Use-case 及事务协调，非中心业务规则
adapters/
  dsh/                 # DSH 专用 Tool/RPC/UI 声明式贡献，正式产品必需
  cli/                 # 可选离线/测试入口
product/               # Product Profile 与组合根
tests/architecture/    # 包边界、隔离与增量变更面检查
\`\`\`

\`object-model/\` 是**首版归组建议**，不表示五类共用一个业务 Schema 或拥有统一状态机；也可随需求演化拆为多个 package。一个 package 可以提供若干稳定 Capability；反过来一个 Capability 的实现也可以迁到另一个 package（Q44）。

**依赖方向：**

1. Kernel 只依赖薄公共协议，不 import 具体领域实现、科研类型判断规则或 DSH。全局 \`contracts\` 禁止膨胀成包含五类全部 DTO 的 God Package；领域契约由拥有者公开导出。
2. 领域插件只使用其他能力的**版本化公开 Ports**，禁止 import 其他插件的 private SQL/schema/implementation；Application Use-case 通过注册的 Port 协调。
3. DSH Contribution 位于 Adapter 侧；领域插件不接触 DSH 工具/RPC/UI API。
4. 对象引用图可以有环，**模块和 Capability 必需初始化依赖图**不能有无法装配的环；引用解析允许路由到未激活/暂缺的能力并明确降级。
5. \`Facet\` 是另一 Capability 对同一对象的**独立拥有扩展记录**，不是给基础五类对象塞任意插件字段；对语义上应独立存在的对象，仍创建正式五类对象并登记其来源关系。
6. 不硬性限制 package 数量，也不让每个 Use-case 单独建一个运行时插件；要求新增领域能力不迫使修改 Kernel 和通用 DSH Host 中心文件。


## 5. Kernel 的最小职责与禁止越界

| Kernel 机制 | 不由 Kernel 执行 |
|---|---|
| Principal、ResearchSpace 访问验证、SpaceContext、统一业务授权入口 | 哪个主体科学上接受 P、哪种研究结论可信 |
| 单 Space 原子 Unit-of-Work 与受约束的 Storage Port | 领域对象私有规则、任意跨空间事务或外部 Agent 执行副作用 |
| **History Ledger**：不可变登记序、记录提交和历史截点元信息 | 领域事件解释、科学时间/因果、对象修订/Fork 的实质规则 |
| **Object Directory**：ObjectID、固定 Space/Kind、逻辑 Capability 路由及唯一权威标识 | 各类型完整 Schema、最新 Revision 语义、五类本体推理 |
| **Change Journal**：与权威写入同事务的技术性变更通知 | H 历史权威、科研事件内容或推理证据 |
| Capability Registry、Plugin/Product Profile 生命周期、按空间 Schema 迁移协调 | 插件私有数据库直接修改、具体校验器算法、长期热交换框架 |
| Versioned Validation 的注册/调用接口与最小报告持久化通道 | 具体 S/R 检查规则、方法有效性或科学判真 |
| ReadContext、受控引用解析、读取完整性/水位报告的通用载体 | 把 \`UNKNOWN\` / \`WITHHELD\` / 缺文件自动翻译成科学否定 |

### 5.1 ResearchSpace 操作与读取上下文

[已裁定，Q23/Q24/Q30/Q31/Q32/Q33/Q41] **任何业务读写都有明确的 SpaceContext/ReadContext**，且空间内全部持久数据只由该空间的数据库承载。全局注册表只保留必要管理元信息，禁止跨空间科研内容索引。权限校验先于对象解析，不能借猜测对象 ID 获知其他空间对象存在与否。

\`\`\`ts
// 示意类型，非冻结接口
interface SpaceContext {
  readonly space: OpaqueSpaceHandle;
  readonly principal: VerifiedPrincipal;
  readonly capabilities: ScopedCapabilities;
  transaction<T>(fn: (tx: SpaceTransaction) => T): T;
}
interface ReadContext {
  readonly space: OpaqueSpaceHandle;
  readonly principal: VerifiedPrincipal;
  readonly mode: "current-snapshot" | "as-recorded" | "derived";
  readonly recordedAsOf?: CommitSequence; // H 登记知识截点
  readonly describedAtOrDuring?: TimePredicate; // 对象所描述的时间，独立于知识截点
  readonly consistency: "required" | "stale-ok";
}
\`\`\`

读取同一事务状态须提供一致提交快照；历史读取须**先按 \`recorded_as_of\` 过滤可见登记，再按 \`described_at/during\` 过滤所描述时间**，并报告实际选择的时间条件及采用政策。迟到登记不可追溯变成过去已登记。异步派生读面以消费者水位报告一致性，不能冒充权威最新状态。过去的读取截点不授权今天的访问。

### 5.2 Object Directory 与引用安全

[已裁定，Q38/Q44] 在每 Space 中唯一保存 \`ObjectID → {space, object_kind, owner CapabilityID}\` 等**最小身份路由信息**。对象 \`kind\` 和 \`space\` 创建即不可变（PR #42 RD-01）；Kernel 将 kind 当作受注册约束的标签，**不解释五类语义**。最新 Revision 的语义与解释器版本由领域所有者负责。

- \`ObjectRef\` 仅用于导航、非规范性“跟随当前”选择；**正式声明、论证输入/结论、评价/接纳目标、检查对象引用精确 \`RevisionRef\`**（RD-05）。
- 允许对象所有者能力从旧 Plugin 显式迁移至新 Plugin；\`CapabilityID\` 稳定且单空间同一时刻只有一个权威写入者。对象和所有历史精确引用保持不变，迁移记录与数据/路由更新原子一致（Q44）。
- Directory 不索引私有对象详情，也不得泄漏跨空间空间 ID、存在性、计数或路由错误差异。引用解析先做空间/可见性控制，再提供审计与呈现结果（RD-26、RD-34）。
- 对象的暂存 ID 可供**同一事务内部**相互引用，未提交前不得向其他事务显示为已登记。正式领域对象种类不因 Facet 或来源记录而增加。

### 5.3 最小 Kernel 与领域扩展的停线

H/S/R 是职责，不是在 Kernel 新增三个科研规则子系统。Kernel 可提供通用 Ledger、Directory、Tx、Registry 和校验调用入口，但不能为了统一而强迫五类对象遵循相同字段生命周期或存储表。业务授权规则由对应插件声明；可信同进程模块边界不宣称对恶意插件提供操作系统级沙箱。


## 6. 插件契约、依赖与装配

[已裁定，Q11–Q20、Q29/Q31/Q32/Q39/Q44/Q45] 稳定的是**能力契约与生命周期机制**，不是冻结科研本体内容。

| 贡献 | 责任 |
|---|---|
| \`PluginManifest\` | 实现代码版本、提供/需要的 Capability 契约版本、持久命名空间、兼容性/迁移描述 |
| \`Capability Port\` | 特定领域的命令、读取、历史解释；独立于物理 package |
| \`Validation Contribution\` | 校验器的规则/版本、输入目标、保证范围及结果记录形式；各领域拥有 S/R 规则 |
| \`Projection/Dependency Contribution\` | 可重建读面、精确引用及反向依赖；不自成数据权威 |
| \`Facet Contribution\` | 独立 Capability 拥有的扩展记录，明确所挂接对象与相应修订/解释契约 |
| \`Dsh Contribution\` | Adapter 内的 Tool/RPC/UI 注册；业务插件完全不依赖 DSH |

### 6.1 逻辑所有权与物理实现（Q44）

\`ObjectID\`、\`CapabilityID\`、\`PluginID\` 分离；\`ObjectID\` 生命周期不跟随源码重构。Capability 指定对象的**唯一权威修改接口**，Plugin 只是其实现；跨包拆分/合并不改变对象 ID。所有权转移需要受控、可审计、原子切换，并在激活前验证新实现支持所承诺的历史查询与解释版本。首版只承诺重启式升级，不做在线热迁移。

### 6.2 Facet 边界（Q45）

**Facet 是面向一个已存在对象的独立领域扩展记录，不是五类以外的新基础对象类别。**

- 基础对象的身份、\`object_kind\`、核心修订及其身份构成字段只有**主 Capability** 写；Facet 只有自己的数据、记录标识、版本与生命周期权威。
- 记录可按 \`ObjectRef\` 挂载并用于 UI 导航；当扩展信息属于正式科研主张、检查或历史引用时，**必须精确绑定 \`RevisionRef\` 或其合法记录引用**，不能隐式 latest。
- **禁止平行复制**：例如 Entity 的设备使用关系仍由 Association 或活动来源记录唯一拥有，Entity/Instrument Facet 不得成为另一份 \`operating_context\` / \`used_in\` 关系真源（RD-15、RD-37、XC-28）。Facet 可保存自己拥有的校准/仪器专有信息，但不能由私有字段重新定义 Proposition 的真值条件。
- 当一份校准、验证证书、分析结果有独立科研指称身份或要进入 Association/Argumentation 端点，须通过正常 Domain Admission 创建五类之内的**独立正式对象**，并显式关联；不能把 Facet 记录 ID 冒充科研对象 ID（RF-05/RF-06）。
- Facet 缺席/升级失败只让依赖该扩展的能力降级，不能使基础对象消失或被改写。Facet 自己需要 H 追溯和权限保护，其缓存仍不是权威数据。

### 6.3 装配

Host 先装载可信 Plugin 与 Product Profile、解析公开 Capability 依赖及版本；Space 分别检查已启用能力与存储 Schema/解释器兼容性。循环的**必需代码依赖**不得装配，科研对象间的循环**引用**可以保存和检查。单个 Space 迁移失败不得拖垮其他空间；必需 Product Profile 能力缺席时如实报告 Profile 不完整，而不是隐式选择他空间实例。


## 7. 持久化、权威数据与事务

[已裁定，Q7/Q8/Q12/Q13/Q24/Q35–Q37/Q40] 一个 ResearchSpace 使用一个业务 SQLite 数据库（可通过 Storage Port 更换驱动）；Git 仅提供外部文件/代码版本，不是科研业务数据库。

### 7.1 四种互不替代的持久内容

| 机制 | 唯一权威与职责 |
|---|---|
| **Domain State / Event** | 由所属领域 Capability 拥有实体与版本、当前工作流状态或领域事件内容；需要事件溯源的领域事件**直接以 Ledger 的领域事件载荷为权威**，或以 Ledger 中不可变引用绑定所属存储，不能并行创建第二套事件真源 |
| **History Ledger (H)** | **同一 Space 统一不可变登记顺序/提交截点**，承载已登记原始记录、事件/修订、主体与来源归因；领域解释器决定其科学/业务含义 |
| **Object Directory** | 正式对象身份、kind、所属空间与逻辑 Capability 路由的唯一注册权威；不保存对象真值或最新领域状态 |
| **Change Journal** | 同一事务写入的技术性变化通知，供索引/缓存/投影恢复游标；**不等于 H，也不能据以重建全部科研历史** |

H Ledger 与领域事件存储可以采用**同一不可变记录实体及不同读取索引**，禁止“领域事件表一份、Ledger 另一份，两者均声明为真实事件历史”。事务化领域状态须同步留下足以满足其承诺 H 历史查询的不可变版本或变更记录；**不必**强制所有 Workflow 状态全面事件溯源。Ledger 的全局登记序是“何时被系统记录”，不是物理发生时间或真实因果。

### 7.2 Raw Intake 与 Domain Admission（Q37）

两个独立的事务**语义边界**，不是必须异步执行的固定工作流：

- **Raw Intake**：在核验 Space 访问与基本写权限、大小限制后，H 登记原文、可信登记主体、来源和时间；即使 S-L0 无法解析仍保存为原始记录，**不冒充正式五类对象**。
- **Domain Admission**：从原始记录解析/登记正式对象，通过拥有者检查其最低可解析条件、固定 kind/space、注册 Directory 与领域内容，并原子写 H；必要时追加 S/R 校验报告。**对象可在 S-L1 未达成但已可解析时登记**：结构缺陷留报告，不能将未达成说成 PASS（PR #42 IC-S1/RPT-00）。
- 原始材料可以重复尝试解释，但每次尝试的输入/解释器版本/结局都新增记录；用来源/幂等策略避免意外重复创建同一领域对象，**不**做基于文本相似度的自动语义合并。
- 已结构化且合法的直接领域写入可以在**单事务**完成，Raw Intake 并非所有科研业务的强制前置阶段。
- 有空间写权、缺少正式科研接纳授权的主体可保存**未生效声明**，但不能使 FactStanding 改变；**无空间写权则完全拒绝写入**（RD-27、PR-A1）。

### 7.3 单空间跨插件 Unit-of-Work（Q40）

允许在一个事务中预分配 ID、暂存多个拥有者各自的数据，并通过拥有者的 Port 进行完整性检查，再**一次原子提交**：领域权威状态/事件、Directory、H Ledger、Change Journal 全成或全回滚。未提交的 ID 对其他事务不可见。

- **对象引用图可有环**，不要求五类对象全局拓扑排序；这不授予循环推理科学证明力（C10）。
- 区分**硬业务完整性引用**（要求事务内确实存在）与**开放科研引用**（允许暂未解析并保留报告）。按领域 Schema 决定是否允许保存，不能把所有 \`UNRESOLVED\` 一律回滚；未解析必需结构角色可能导致 S/R-L1 FAIL，但不等于拒绝原始材料（Q27、RD-02）。
- 外部网络调用、形式化证明、长时间科学计算及 Agent 调度不得位于有界 DB 写事务中；事务外运行的校验结果在提交时核对输入版本或标注过期，不能虚称跨系统原子性。
- 不要求所有写操作同时涉及 H、Directory、Journal 和所有五类；仅修改对应权威记录并完成必需的共同机制登记。

### 7.4 Journal 与投影恢复（Q35）

与权威提交同事务记录技术变化；每个派生消费者持有消费游标，允许重复处理/重启追赶。日志压缩产生缺口时改为从权威数据全量重建或明确报告不可用；过期索引不得伪装成权威当前视图。Journal 的粒度和留存策略是存储实现问题，不承担 Domain Event 或 H 历史语义。


## 8. 对象身份、引用与外部工件

### 8.1 身份及精确引用

[已裁定，Q9/Q10/Q21/Q27/Q28/Q38/Q44] ObjectID 全局唯一且不复用；正式对象固定属于单一 ResearchSpace 和五类之一（PR #42 RD-01）。\`ObjectRef\` 是导航身份，\`RevisionRef\` 为正式科研陈述、论证输入/结论、评价、接纳和检查对象所需的精确引用（RD-05）。

**Proposition 与 AssertionChain 必须分开：**

- \`PropositionID\` 代表真值条件稳定的命题；改变真值条件须建立新的 Proposition，而非仅改变 revision（PR #42 RD-06/RD-29）。
- \`PropositionRevision\` 承载同一命题可更新的**表示集合**；Representation 附着于精确 PropositionRevision，不能变成另一个独立命题修订真源（RD-07）。
- \`AssertionChain\` 仅由 H 登记某主体维护的历史连续性，可按顺序连接不同 PropositionID 的精确 Revision；**不是第六类科学对象，也不是等价声明**。

实体类型、World/Scope、Concept 定义、Scheme 版本由所属领域 Capability 验证。通用 Directory 不负责判断 \`UNKNOWN → DECLARED\` 是否改变原意；机器校验只能检查声明是否具备合法结构，不自动验证科学语义等价（RD-33）。

### 8.2 引用、关系与来源

四类引用 \`SEMANTIC / PROVENANCE / INFERENTIAL / EVALUATIVE\` 的领域区别不得被内核压成一个“相关”边。核心对象及其正式精确版本可以相互引用，包括循环；**H 检查记录、采用记录与普通事件不直接充当 Association/Argumentation 的正式五类端点**。确需将原始材料或报告作为论证证据的，按上层 RF-06 先把其**承载个体**登记为 Entity 再引用，不改变原始 H 记录。

PROV 生产、使用、派生关系只登记一次；来源视图、Relation Facet、W3C 导出不能再维护重复可写的关联状态。Association 表达有来源的关系陈述，不自动拥有 \`is_true\` 或 \`is_current\`；采用记录独立于被采用关系且不得修改其 Revision（RD-10/RD-11/RD-15/RD-31）。

### 8.3 外部 Artifact 与科研文件缺失

[已裁定，Q25/Q26] \`Run\` 是工作流管理对象，真实发生的 \`Activity\` 是科研活动个体：可一对多、无 Run 或无实际 Activity。只有真正的观测行为/结果才映射为 \`sosa:Observation/sosa:Result\`；对外 W3C PROV 导出不因为内部 Entity 分类改写标准定义。

科研工件先记录 URI/路径、可选内容哈希、采集方式、时间与恢复线索；允许文件删除、不可访问、哈希不符，且不担保重建。每次可用性检查是新的 H 记录；**Entity 本体上不得再维护会覆盖历史的布尔可用状态或可反写的使用关系**（RD-04、XC-07、XC-28）。需要独立的科研数据/结果/证书对象时创建正式 Entity，而不是把它当作一个没有来源的 Facet 字段。

### 8.4 分语境可信与适用性摘要

[已裁定，Q22] 快速筛选摘要是可重算、带 Scope/主体/解释器/水位的派生输出；不得压缩八条状态轴为全局真值或可靠性分数。缺失、未知、声明未达成、权限过滤和科学反证分别保留，且本视图省略状态轴时应标注省略边界（PR #42 RD-04/RD-16）。


## 9. 领域协作、校验与查询

### 9.1 Application Use-case 与领域组合

[已裁定，Q16/Q17/Q40] 单领域规则留在其对象 Capability，跨领域 Use-case 通过 Port 和共享事务协调。例如登记一次计算：Workflow 更新 Run 管理结果；Entity/Association/Provenance 领域登记真实 Activity/产出与有来源的连接；需要时再形成独立 Proposition。**Run 完成、产出已记录与科研命题获接纳三者不得自动合并**。

### 9.2 版本化 Validation Capability（Q39）

各对象拥有者贡献 S-L0/S-L1 检查，Argumentation/Scheme 贡献 R-L0/R-L1 和未来更深的检查；Kernel 只提供校验器注册、调用及 CheckReport 的通用持久化机制。检查报告绑定精确 Revision/Representation、规则/Schema/Scheme 及校验器版本、输入环境、执行时间、实际保证范围；重检产生新报告，旧 PASS 不改写（C11）。

- 报告结构合法性、\`declared_gaps\`（语义完备性）和 \`INDETERMINATE\`（无法判定）三条线相互独立（RD-25）。
- 只有声明为必需而未绑定的角色才按规则 FAIL；允许 \`UNKNOWN\` 的字段如实声明 UNKNOWN 可以满足结构门禁；S/R-L1 不验证科研语义真实或科学充分性（RD-33）。
- 规则可用性/资源缺失不等于 FAIL 或科学否定；混合检查项的领域层 verdict 遵循已裁定的“FAIL 优先，否则 INDETERMINATE”归约规则（RD-14/RD-38）。
- **审计真源与调用者呈现分离**：权限不足的调用者不得通过 \`REF_UNRESOLVED\` 与 \`WITHHELD_REFERENCE\`、verdict 差异、精确计数或响应差异探测跨空间对象；对外使用 \`UNVERIFIABLE_REFERENCE\` / \`UNVERIFIABLE_TO_YOU\` 等脱敏表达（RD-26/RD-34）。

### 9.3 ReadContext、权威派生状态和高级索引（Q41/Q42）

同一跨领域查询共享 Space、Principal 与一致读取截点；历史查询明确 \`recorded_as_of\` × \`described_at/during\` 与视角/版本选择，任何使用政策或主体评价均需保留来源。**FactStanding 等具有正式业务含义的视图必须对 ReadContext 截点一致**：可以按来源记录即时计算，或读取已验证与截点一致的同步物化结果，不能用无水位的异步缓存替代。

Search、Graph、快速摘要与其他加速投影允许异步，但须披露完整性/截断、水位和缺失范围。若无法满足要求“完整且一致”的查询，则回源、重建或明确失败。普通空结果不构成科学反证；不能通过权限过滤或未展开的分支宣称“已检查全部”。

### 9.4 依赖归属与 Impact Index（Q43）

由每个领域拥有者登记精确版本、角色、AND/OR 路径及未解除的条件；跨领域 Dependency/Impact Index 仅建立可重建的反向检索，**不是科学影响判定引擎**。Concept 定义/Schema 变化、依赖受质疑等触发的候选复查，不自动修改旧论证、旧 PASS 或 FactDesignation；是否有效影响某路径由相应 Scheme/领域规则判断。

当用户请求“完整受影响集”用于权威写操作，必须校验索引处理范围/水位并必要时回源，不可拿过期索引中的空命中作为无依赖证明。循环对象引用可登记，图遍历不提供自动的严格证明；统计/归纳/类比/演绎的合法组合仅由其 Scheme 和显式规则控制。

## 10. DSH Adapter 与 Agent Team 集成

[已裁定，Q2/Q4/Q5/Q6/Q29] DSH Adapter 属正式 Product Profile 的**必需装配**，但业务插件不得 import DSH 或 Team 私有实现。

- **Host/Client Adapter** 对外提供 Tool、RPC、UI 贡献入口，通过声明式能力清单装配；具体 Adapter Contributor 可以是显式代码模块，并非所有能力都自动反射成通用 Tool。
- **Agent Team 仍是执行控制权威**：Research Control 的 Task/Gate 状态不由 Team 直接写入；Team 事件可作为外部有来源输入，再由 Research Control 的业务操作决定科研状态变化。
- **暂只预留 OutboundPort**：一个单向输出接口及有界、持久化的缓冲区；不验证有无消费者，不登记 ACK、不唤醒或选择 Agent、不规定投递渠道。没有实际生产者时不为该机制建立额外业务框架。外部系统如何读取、接入会话或封装工具，由外部决定。
- Agent 不可因拥有执行权限而自动获得科研接受、语义确认或其他科研写入权限；以 Research Control 经校验的 Principal/授权上下文为准。
- DSH 不可用时，领域核心和独立离线入口仍可运行；但正式 DSH Product Profile 应如实报告其 Adapter 不就绪，不隐式冒充完整产品就绪。


## 11. 版本演化、所有权移交和独立 Space 激活

[已裁定，Q14/Q15/Q18/Q31/Q32/Q44/Q45] 至少分开：Host 代码版本、Capability 契约版本、每 Space 每插件存储 Schema 版本、**历史科研语义/校验规则版本**，以及各对象 Revision；Facet 也有自己的 Schema/记录版本，不能覆盖对象核心 Revision。派生索引水位不是科学历史版本。

- 同一代码版本可以由 Host 管理，启用能力及可变运行状态由 ResearchSpace 独立管理；单个 Space 迁移失败不阻断其他 Space。
- 结构迁移与科学语义迁移分离，普通加载不能静默改写历史语义；旧解释器不可用时保留原始记录与版本身份并如实标注能力缺失，不套用新规则冒充旧解释。
- 拆包或迁移插件只改变 \`PluginID\` 对某 \`CapabilityID\` 的实现映射，不改变 ObjectID/RevisionRef；如涉及域数据转换，必须显式、原子、可验证地完成空间内**唯一写入所有者**移交。
- Facet 可独立迁移、失效和恢复；缺少 Instrument Facet 不能导致 Entity 的存在、历史 Revision 或 Provenance 被隐式删除。
- 可信同进程插件和重启式代码升级是首版边界；不实施在线热切换或沙箱多版本并行运行。


## 12. 故障语义与可观测性

| 场景 | 不可破坏的行为 |
|---|---|
| Raw Intake 可保存但领域解析失败 | H 原始材料仍可见，正式对象不伪造，失败尝试可追溯（Q37） |
| 跨插件暂存后失败 | Domain State、Directory、Ledger、Journal 均回滚，预留 ObjectID 不冒充已存在对象（Q40） |
| 迟到登记与回溯 | 按知识截点与对象时间双条件查询；后来的补录不能进入旧知识截点（Q36/Q41，RD-32） |
| 依赖未解析或引用循环 | 允许按领域规则保存，明确校验 FAIL/不可判定；循环不自动产生证明力（RD-02/C10） |
| 资源/检查器不可用 | 保留源资料与旧报告，新检查 \`INDETERMINATE\`，不改写 PASS 或判科研结论假 |
| 权限不足或他空间引用 | 先过滤、再解析；对外不区分目标不存在还是不可见，不给个数/空间 ID/时延提示（RD-26/RD-34） |
| FactDesignation 无业务授权但有本空间写权 | 如领域允许保存为**未生效**声明，不参与 FactStanding；无本空间写权则拒绝任何写入（RD-27） |
| Search/Impact 索引滞后或 Journal 缺口 | 明示水位/截断并回源或重建，不能冒充权威一致读取 |
| Facet 插件缺失或换实现 | 基础对象仍由稳定 Capability 拥有；扩展能力降级，迁移失败不出现双写 |
| 某 Space 插件迁移失败 | 仅相关空间/能力降级；其他空间与 Host 有各自独立健康报告 |
| Kernel 权威 SQLite 损坏 | 权威数据操作 fail-loud，不拿“宽容科研外部文件缺失”掩盖 DB 损坏 |
| Agent Team、DSH 会话不可用 | 科研事实/业务权威仍由本系统拥有；离线入口可运行但正式 DSH Product Profile 如实标记降级 |

这些保证仍属于**可信同进程插件模型**，不构成对恶意插件的 OS 级沙箱，也不提供远端副作用与 DB 的分布式原子提交。


## 13. 架构可执行检验（不是实施计划）

[工程建议] 未来需有能打破错误架构的负例，**目前均未作为新架构程序测试执行**：

1. **跨包依赖**：新增一个独立领域 Capability + DSH 贡献，不改 Kernel 和公共 Host 装配；领域只依赖公开 Port，必需代码依赖图无环。
2. **五类对象与 Q44 拆包**：单包提供五类、拆成不同包后 ObjectID/RevisionRef 保持；Directory 路由及旧解释有效，原属 Capability 只有一个写入者。
3. **Q45 Facet 可拆卸**：新增校准或检查 Facet，主 Entity/Proposition 无私有 Schema 变更；关系、\`world_membership\` 与对象表示不得因 Facet 产生第二权威（RD-07/RD-15/XC-28）。
4. **H/Journal 区分**：断电注入测试事务原子性；仅凭 Journal 无法伪称历史重放；领域事件的不可变权威在 Ledger 或其引用的唯一存储。
5. **Raw 与 Admission**：S-L0 不可解析内容仅入 H；能解析但 S-L1 不达成可保存正式对象和 FAIL 报告；无权限 Raw 不能写入；重试不重复创建对象。
6. **事务内循环引用**：P/A 相互精确引用可在同事务合法写入；未完成硬业务引用 rollback；开放科研引用不被一律拒绝；循环不自动成为证明（C10）。
7. **时间与读取一致性**：T3 补录声称 T1 发生的事件，T2 as-recorded 不能看见；跨插件共享快照，\`recorded_as_of\` 与 \`described_at\` 可独立选取（RD-32）。
8. **规范化负例**：允许 UNKNOWN 不降低结构层级；原始字段缺失按领域规则 FAIL；校验器缺失 INDETERMINATE；旧 PASS 留存；权限视图脱敏（RD-25/26/34/38）。
9. **FactStanding**：已提交撤回记录后正式一致查询不使用滞后旧状态；普通“乙说甲接纳”的命题不触发授权投影（Q42）。
10. **Impact 检索**：C1 受质疑只定位引用 C1 的路径；OR 替代路径不自动同败；同源分析不自动增强独立证据；过期索引不宣称完整（C07/C09、Q43）。
11. **ResearchSpace 硬隔离**：跨空间已知 ID、公共词汇、导入、Facet、Search、Graph、报告、错误消息、缓存与计数均无法穿透；仅允许显式导出/目标空间新建独立对象（RD-18）。
12. **标准语义**：Activity 不导出 \`prov:Entity\`；不存在的观测结果不被补造为 \`sosa:Result\`；PROV 关系无双写，来源不是科学证明。

PR #42 CS-01–CS-24、XC-01–XC-28 属于**设计反例/未来可执行预期**，不是这份 PR 的实测 PASS。


## 14. 架构风险与未冻结边界

### 14.1 优先关注的结构性风险

- **中心膨胀**：统一 Ledger、Directory、Validation、ReadContext 被实现成单个无界 Kernel Service；各公共接口必须保持业务无知、按用途分离，不能通过共享 DTO 恢复中央科研对象模型。
- **Facet 越权**：某扩展记录实际上修改核心对象身份、关系或 Provenance；应迁回正确唯一所有者，不能用“可插拔”掩盖语义双真源。
- **历史双写**：History Ledger 与领域事件表彼此复制且都声称权威；必须保留唯一不可变事件事实，其他为投影或同一记录不同索引。
- **校验反馈的权限侧信道**：在 audit/presented 两条路径泄漏他空间对象存在性；在未能核验时错误报 PASS/FAIL 或科学否定。
- **ReadContext 假一致**：跨域混合不同提交截点，或用单个 \`as_of\` 混合对象时间与登记时间。
- **广义依赖自动化**：用图路径传递支持度、合并 AND/OR、把自指循环自动认证、以过期影响索引判“无受影响项”。
- **边界外副作用**：把远端 Agent 调度、文件写入或科研计算包装为 SQLite 原子事务。
- **过早插件框架化**：为了未来未知的运行时多版本、热切换、不可信插件隔离，先行设计无界通用对象/安全系统。

### 14.2 留给领域契约或后续实现选择

PR #42 当前已明确 Proposition 真值条件身份、S/R-L0/L1 基础规则、引用精度、时间与报告边界（RD-01–RD-38）：**本草案不再把它们写成全部未决**。仍由上层领域契约或 PoC 细化的是具体 Schema/字段编码、Scheme 与 World/Scope 的实例规则、审核政策、表现/统计/形式化后端、具体数据库 DDL、索引算法、插件 Manifest TS 签名、历史解释器兼容/迁移策略及性能上界。

出站 OutboundPort、真正的 Agent 运行联动、V1 数据迁移、LIVE_* 授权、实施排期仍不属于本代码架构冻结。

### 14.3 文档代次与裁定状态

- 最新科研语义讨论依据：PR #42 的五类/H/S/R 主基线 + C01–C12 + 新的细化层。它**没有自动授权**运行时开发或修改 V1 冻结契约。
- 本文 PR #44 是 Q1–Q45 的**候选代码架构基线**，不是当前运行时代替合同。旧 PR #33 的 M1–M6/R1–R11 仍应重新对账，不自动沿用。
- 文档代次、Current/Proposed/Historical、用户批准与任何 LIVE_* 的状态不得相互推导；不凭合入 Draft 文档宣称设计被验证。


## 15. Q36–Q45 与 PR #42 的正式对账

| 决策 | 代码架构落点 | 上层合同校验 |
|---|---|---|
| Q36 统一 History Ledger | §5/§7：全空间登记序，领域事件唯一真源，独立 Journal | H 系统、C01/C11、T-02/T-05 |
| Q37 Raw/Admission 分离 | §7.2：H 可保存未解析原文；正式对象接纳与报告不强求 S-L1 PASS | IC-H3/IC-S1、RD-25/RPT-00 |
| Q38 最小 Object Directory | §5.2：唯一 ID、固定 kind/space、受空间限制的 Capability 路由 | RD-01、ID-01…ID-08、SP-01… |
| Q39 分布式 Validation | §6/§9.2：独立贡献、版本化报告、分离授权呈现 | RPT-01…RPT-11、RD-34/38 |
| Q40 跨插件 Unit-of-Work | §7.3：暂存/预分配、硬软引用区分、同事务提交 | C10、RF-02/04、ID-04 |
| Q41 ReadContext | §5.1/§9.3：current/as-recorded/derived、知识时间×对象时间 | RD-03/32、IC-H6、C12 |
| Q42 正式派生业务视图 | §9.3：FactStanding 回源或核验物化水位 | PR-A1…A4、C03、RD-04 |
| Q43 统一影响检索 | §9.4：领域依赖权威 + 可重建 Impact Index | C06–C11、CC-06/07/09/10 |
| Q44 稳定 Capability 所有权 | §5.2/§6.1/§11：包可拆、单 Space 唯一写者、显式移交 | ID-01…04、历史精确引用 |
| Q45 独立 Facet | §6.2/§8：扩展记录有独立权威，不能复制核心字段或关系 | RD-07/15/20/37、RF-05/06、XC-28 |

### 15.1 审查结论（设计兼容性，不是实测证书）

**条件性兼容：** 该结构可以承载 PR #42 已闭合的五类对象 × H/S/R 组合，而不在 Kernel 硬编码科研判真或新增第六类/第四套科研系统。Q36–Q45 对 H、身份、校验、事务、查询和长期扩展补齐了必要基础机制。当前不存在需要推翻 Q1–Q35 的已确认根本冲突。

**实施前必须以 PoC/契约验证的四处边界**（不要求继续进行新的顶层逐题讨论）：

1. History Ledger、领域事件与 Journal 能否在一个 SQLite 事务中实现**唯一事件真源**，且长时历史查询有可验证最低保证。
2. 逻辑 Capability 拆包与 Facet 贡献后，仍满足唯一所有者、无代码循环依赖、跨空间不泄漏及**无复制关系真源**。
3. 未解析/权限不可见的引用既能被如实保存，又能在报告和查询对外保持**不可区分与无侧信道**。
4. 版本化校验器、正式 FactStanding 与 Impact Index 能否依照各自一致性要求提供可核验水位、降级和历史留痕。

这四项是**执行设计/PoC 的验证责任**，不是在当前仍未批准实现时声称已经通过。将来某项实现无法满足，应缩小机制实现或修改相应 Port，而不是预先重构顶层五类/H/S/R 组合。

> **状态：DRAFT-PROPOSAL，待人工审查；无产品代码、V1 Current、Schema 或 Gate 的改动。**

