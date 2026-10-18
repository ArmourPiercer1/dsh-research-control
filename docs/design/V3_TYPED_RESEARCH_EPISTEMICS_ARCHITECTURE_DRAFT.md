# dsh-research-control V3：Typed Research State & Epistemic Reasoning Architecture

> **Status: DRAFT / Discussion Baseline v0.3 — D13–D19 的上层原则已获认可，形式化具体分层与检索策略未冻结**
>
> 初稿日期：2026-10-18；修订：2026-10-19（渐进语义契约、可靠性三分法与双图谱）  
> 目标仓库：ArmourPiercer1/dsh-research-control  
> 起始代码基线：main @ 8b910513e188db5aac08b8840756f2f25b8028d4  
> 变更性质：仅设计文档；不修改运行时、V1 冻结契约、Schema、RPC、工具定义或现有数据库。
>
> **重要**：本文是讨论基线，而非已批准的实施 ADR 或 V3 API 契约。D13–D19 的方向性原则及推理多轴分类已获认可。**形式化 L0/L1 的科研协作边界已明确，但 L2–L5 是讨论性能力分类，不是已冻结的线性真理等级。**具体 Schema、类型、检索接口/策略、科研审查标准、权限和实施顺序均未裁决；本 PR 只变更文档。

## 0. 摘要与设计动机

当前 dsh-research-control 已经具有 Project / Topic / Workstream、Future Plan、Run、Fact / Claim / Artifact / Relation、ResearchHistory、PlanFork、Intervention、Git / SQLite、11 个研究工具等基础设施。但当前 Fact / Claim 主要是 Workstream-local 的语义标签，不是完整的科研论证或可验证知识结构：Fact 在现行 V1 中恒为 ACTIVE；Relation 只保存直接的二元关联；系统刻意不检验科研推理的内容。这些设计对于工作流原型合理，却不足以支撑跨越许多轮 Agent 会话的科研认知演化。

Euler 的严格事实依赖、验证接纳、Research Graph、Frontier 和 Context Compiler 值得继承。然而 **V3 目标是增强 Euler，而非将其形式化证明机制泛化、降格为宽松的观点记录器**：

1. 所有正式 Assertion 必须显式绑定可注册、可版本化的语义世界及具体上下文。**Theory / Simulation / Engineering 是起始视角，而非封闭枚举或天然可信度等级**；这是底层类型系统，不是特殊 BridgeArgument 的附加字段。
2. 所有正式 Argument 都使用统一的 **类型化谓词/推理表示**，记录前提、量词/变量绑定、规则、结论、Scope 与待证义务，并执行确定性风险检查。
3. **Theory → Theory** 等可形式化子图应继承 Euler 的严格依赖机制；在条件允许时，Lean 内核检查及其证书应作为极强的演绎有效性证据，不能与一般 LLM 审阅等同。
4. **Theory / Simulation / Engineering** 之间不允许隐式语义强制转换；跨世界推理必须生成适用性、实现一致性、数值误差、校准或现实验证等对应义务。这里的“模型—现实桥接”是统一类型系统中的基本检查规则，**不是特设的 BridgeArgument 类**。
5. 工程 Fact 表示项目在特定范围内基于现有证据和责任主体评价所正式接纳的高可信论点，不代表客观真理保证；新证据可以加强、质疑、暂停、替换原有支持路径。
6. **严格推理的依赖失效**与**科研结论的认知退化**必须区别处理。理论解释错误不能自动抹除独立实验证据所支持的工程性能事实。
7. 保留科研工作控制面与执行编排的边界：本项目管理科研认知和研究状态；DSH / dsh-agent-team 负责 Agent 生命周期、权限、资源与执行。验证器提供证据和证书，不接管项目认知治理。
8. **D14：规范化概念/术语注册**是正式类型化推理的基础：ConceptID@Revision 具有定义、谓词签名与形式化对应；语义身份和引用完整性不可关闭，命名/审查/警告政策经可插拔 Discipline Port 治理。
9. **D15：验证义务强制生成、显式传播，但不阻碍有标注的科研探索**。OPEN 义务不自动变为 SATISFIED；研究继续不等于获得认证、正式验收或现实执行权限。
10. **D16：Observation 与 Hypothesis 可以独立积累**；维护可回溯 Anomaly Registry，执行确定性异常检测并允许可审计的独立 LLM 交互检查，驱动新的 ResearchQuestion / Route。
11. **推理分类采用正交多轴结构**：方法、逻辑强度、实际验证状态和证据关系分别表示。演绎、归纳、统计、溯因、类比、因果、默认/可废止、实践决策可以注册扩展；“经验支持”“暂无反例”不自动等于归纳证明。
12. **D17：渐进式语义契约**：规范化自然语言提交即可作为提交者继续科研的基础；语义稳定之后全局可引用，但仍可能危险；更深入的推理结构化和证书验证不默认阻碍探索。
13. **D18：三类科研可靠性分开维护**：Semantic Validity、Inferential Validity、Evidential Adequacy 相互相关但不构成单一真值等级；第三者主要依靠科研判断，基础设施只提供有限辅助。
14. **D19：双图谱与可组合召回**：Inference Graph 记录科研推理，Research Association Graph 记录值得联想的物理、统计和工程关联；关联不自动变成因果或逻辑支持。外部 LLM 可自主选择检索哪张图、跳数及剪枝方式，具体检索方案不预先冻结。

**一句话定位**：科研语义与论证基础设施（Research Semantics & Argumentation Infrastructure，RSAI，暂定名称）。提供语义稳定、论证溯源、有限机械检查、科研关联召回及可修正状态；不宣称普适科学正确性，也不承担 Agent 编排。

### 0.1 本稿中的确认程度

| 分类 | 内容 |
| --- | --- |
| 讨论中已明确的目标 | 以 Euler 为增强基线；显式 World / Concept；严格数学保证与工程认知分离；**已认可 D13–D19 的方向性原则与推理多轴分类**，其中仅 L0/L1 协作语义已确立、L2–L5 仍待讨论 |
| **本文的设计建议，尚待裁决** | L2–L5 的命名与能力边界；WorldType、Concept、TypedFormula 的具体 Schema；关联边及其来源模型；检索接口、跳数/剪枝与资源上限；Fact 接纳与迁移 |
| **明确未决** | L2–L5 是否为偏序能力而非线性等级；不同推理规则的检查边界；科研关联图谱基础边型；动态联合检索及审计接口；Lean 语义对应、Fact 接纳与跨项目知识复用 |

## 1. 设计目标、约束与非目标

### 1.1 系统必须能够可靠回答

- **What is asserted?** 我们讨论的具体命题、量词、条件和作用对象究竟是什么？
- **In which world?** 命题在某数学模型、数值实现，还是某个现实工程配置中成立？
- **By what inference?** 哪些前提以什么规则、变量绑定和解释支持结论？
- **How was it checked?** 哪些演绎步骤有严格证书，哪些仅为经验支持，哪些仍有缺口？
- **What is accepted now?** 项目当前把哪些 Assertion 作为可用 Fact，其接纳决定和限制是什么？
- **What changed?** 新数据、反例、模型修正或程序升级具体影响了哪些依赖、论证和结论？
- **What is next?** 当前尚未解决的问题、风险义务、替代研究路线及 Agent 可复用上下文是什么？

### 1.2 不变量候选（INV-V3-*；新增已同意的设计原则，ID 未冻结）

1. **INV-V3-WORLD**：正式 AssertionRevision 绑定具体、版本化 WorldContext；不得省略世界并默认现实。
2. **INV-V3-WORLD-EXTENSIBLE（D13）**：WorldTypeRegistry 开放注册、版本化、带受控继承/特征和转换规则；Theory/Simulation/Engineering 不得作为唯一可选枚举。
3. **INV-V3-NO-IMPLICIT-CAST**：不同语义世界或同世界不同上下文之间无隐式转换；相关义务必须可追溯。
4. **INV-V3-TERMS（D14）**：正式类型化表达使用已注册 ConceptID@Revision 或同一事务登记的新概念。语义身份与引用完整性属于不可关闭内核；额外命名与质量审查通过可插拔 Discipline Port 管理。
5. **INV-V3-TERM-IMPACT（D14）**：词法变更、语义变更、形式化对应变更不同级处理；语义变更生成新修订并精确检查所有依赖对象，不篡改旧版本。
6. **INV-V3-EXACT**：自然语言 statement、typed AST、World/Scope、术语修订、模型版本和证书一同参与不可变语义修订身份。
7. **INV-V3-ARGUMENT**：正式 Argument 含前提、结论、规则、绑定和义务；逻辑保证与科研支持、形式化检查结果分离。
8. **INV-V3-INFERENCE-MULTIAXIS（已同意的分类原则）**：推理方法、逻辑强度、验证状态、证据关系正交表示；单项“经验支持”或“无已知反例”不伪装为归纳证明。
9. **INV-V3-OBLIGATION（D15）**：缺失前提与跨世界验证义务必须生成、持久化、沿实际被依赖的路径传播；探索性继续不使其自动消除，不可误报已完成的严格证明。
10. **INV-V3-FORMAL**：Lean 证书认证精确形式命题及其声明的公理/依赖，不自动认证翻译正确或工程适用。
11. **INV-V3-OBSERVATION（D16）**：允许不附着任何假设的观测记录，保留原始/暂定/审查状态和来源；不可将未核实观察当成证伪。
12. **INV-V3-ANOMALY（D16）**：矛盾、证据失配、推理断裂、未解释现象等有明确可回溯 Anomaly 身份；异常产生新研究候选而非直接删除相邻 Fact。
13. **INV-V3-FACT**：FactStanding 表示特定主体在特定 Scope 下的可修正接纳，而非客观真理保证。
14. **INV-V3-IMPACT**：依赖变化只自动处理可机械判定的版本/证书/引用状态；论点的科学身份由评估机制决定。
15. **INV-V3-PLAN**：ResearchRoute 与 canonical Future Plan 分离，研究知识写权限不得绕过 PlanFork 与用户治理。
16. **INV-V3-REPLAY**：认知事件、术语修订、异常与研究义务可确定性回放，索引/Frontier 都是投影。
17. **INV-V3-UNKNOWN**：不完整定义、未解决的假设/适用性和未审查形式化片段以 OPEN/UNKNOWN 表达，不得默认为满足。
18. **INV-V3-NO-FAKE-PROOF**：逻辑结构化、LLM 评价、规则模板通过均不能等同于可信内核完整证明。

### 1.3 本轮非目标

- 取代 Lean/数学证明器、数值求解器、实验测量设备或人为科研判断。
- 构建可自动发现现实世界全部隐含变量的万能因果推理器。
- 将术语检索命中、RAG 相似度、LLM 交互审查或无反例记录冒充语义等价、逻辑证明或科学证伪。
- 由于某项跨世界义务未闭合而全面冻结探索性研究；同时也不允许以“探索继续”为由自动授予工程上线、安全操作或正式验收权限。
- 把所有证据压缩到一条可加总的概率或“真实性分数”。
- 在本 PR 中修改数据库、迁移生产数据、注册新工具、变更权限或接入真实验证器。
- 直接搬运 Euler 中受限制许可约束的实现代码；需逐文件核对许可证与来源。

## 2. 总体职责分层

~~~text
Human / Research Agents / dsh-agent-team
      │  propose / investigate / review / execute
      ▼
┌─────────────────────────────────────────────────────────────┐
│ dsh-research-control                                       │
│  A. Semantic Foundation                                    │
│     WorldType Registry + Context / Concept Registry        │
│     TypedFormula / Scope / Versioned Rule Registry         │
│  B. Typed Argument & Verification                          │
│     Inference Schemes + Lean / Proof Obligations           │
│     Assumption Debt / Type Hazards / Domain Checkers        │
│  C. Knowledge & Discovery                                  │
│     Assertion / Observation / Evidence / Argument          │
│     Assessment / FactStanding / Anomaly Registry           │
│  D. Research Continuity                                    │
│     ResearchQuestion / ResearchRoute / Frontier            │
│     Context Compiler / Failure Memory                      │
│  E. Existing Workflow Governance                           │
│     Project / Topic / Workstream / Task / Gate / PlanFork   │
│     Run / Intervention / Brief                              │
│  F. Shared Infrastructure                                  │
│     Events + Replay / Git + SQLite / Provenance / Revision  │
└─────────────────────────────────────────────────────────────┘
      │                      │
      ▼                      ▼
  optional Discipline     Domain Verification Adapters
  & Discovery Ports       Lean / numerical / measurement
~~~

**权威边界**：
- 语义内核必须保持启用：对象身份、ConceptID@Revision 绑定、TypedFormula 的可解释性和引用完整性不能由插件开关取消。
- 可插拔 Discipline Port 检查命名、歧义、定义质量、危险推理和团队工程纪律；可配置 OFF / OBSERVE / WARN / ENFORCE，但无论如何不能伪造合法证明或改变已有事实历史。
- 可插拔 Discovery Port 进行异常比较、LLM 科研交互审查与新路线候选生成；不能直接裁定科学真理或替代正式 Fact 接纳。
- Verification Adapters 提交受限定证书及检查回执；DSH/dsh-agent-team 负责 Agent 生命周期与运行时调度。
- 上述均为**逻辑分层**，不要求独立进程或额外数据库。

### 2.1 D18：三类可靠性不能合并为一个通过/不通过状态

| 可靠性 | 能提供的机械保障 | 主要未保证的内容 | 双图谱的帮助 |
| --- | --- | --- | --- |
| **Semantic Validity** | ID、World/Concept/Scope、定义修订与引用稳定性 | 自然语言是否忠实表达原研究意图，是否遗漏关键条件 | 召回相近概念、装置、上下文，帮助发现歧义 |
| **Inferential Validity** | 已登记规则、类型、前提依赖及 Lean/证书的限定检查 | 所有经验推理是否有效、未被记录的假设 | 检索现有论证及相关但尚未被采用的条件 |
| **Evidential Adequacy** | 已登记证据的溯源、版本和特定可执行检验 | 实验设计是否真正充分、数据选择或混杂因素是否遗漏 | 关联设备/仪器/变量/数据来源，给外部评审提供可能的检查线索 |

三者是独立维度，不对应统一真值评分。**尤其不建立具有过强保证语义的 EvidenceAdequacyChecker 或 InvestigationDesign 已验证状态**：证据充分性首先是科研问题，缺少数据/知识时服务不能凭空保证发现关键因素。

### 2.2 D19：两张语义不同、共享科研身份的图谱

- **Inference Graph（推理图谱）**：保存 Assertion、Argument、Evidence、ProofObligation 以及已登记支持、反驳、削弱推理等科研论证；严格的证明路径可有局部强保证。
- **Research Association Graph（科研关联图谱）**：包含物理设施上下游、设备/测量/数据来源、物理量相关、统计关联与经验联想。Physical Association 可为子图。关联只回答“研究此对象时可能值得想到什么”，**不授予逻辑蕴涵或因果关系**。
- 两者引用相同对象 ID、World/Scope、Concept/Revision 和 Provenance，不复制为互相独立的科学真源。
- UPSTREAM_OF 表示设施或流程拓扑，不说明因果传播方向或禁止反向搜索；CORRELATED_WITH 也不隐含因果性或数学上的多跳传递。
- 关联边可有确定的来源事实（设备拓扑）或未经确认的研究关联；即使关联边属实，也不因此证明一项物理因果命题。
- Joint Recall 仅返回相关线索、证据来源和路径；不自动生成科学 Fact、ProofObligation 或 Agent 任务。

**召回策略暂不冻结**：倾向提供可组合读接口，由外部 LLM 选择检索推理图/关联图、路径方向、hop、过滤、剪枝、交替查询和进一步扩展。系统负责来源、版本、查询范围和资源/权限边界，不主动调度 LLM 审查。

### 2.3 基础设施不承担 Agent 编排

服务可以提供待语义确认事项、开放科研义务、异常、检索路径及 ContextPacket，但不能自己决定 Formalizer 分配、启动会话、设定周期性 LLM 审查、处理 Agent 消息队列或执行现场操作。任何快速语义确认的时效目标由外部 Agent 执行系统承担。

## 3. 世界类型与规范化语义基础（D13、D14 已同意原则）

### 3.1 D13：开放 WorldTypeRegistry，拒绝固定三项枚举

Theory / Simulation / Engineering 是方便交流的原型标签，但混合了知识对象、表示方式和证据来源，不宜固化为封闭枚举，也不构成可信度从高到低的梯度。

**正式 AssertionRevision 必须引用版本化的语义世界**；世界类别开放注册，而不以三个枚举穷尽科研。

WorldTypeDefinition 候选结构：

~~~typescript
interface WorldTypeDefinition {
  typeId: string;            // e.g. "world.physical_model"
  revisionHash: string;
  parentTypeRefs: string[];  // taxonomic inheritance is NOT proof-transfer permission
  semanticTraits: string[];
  contractSchemaRef: string;
  rulePackRefs: string[];    // explicit registered transfers and checks
}
interface WorldBinding {
  worldTypeRef: string;      // versioned type identity
  contextId: string;
  contextRevision: string;
  referentRef: string;       // object being described
  representationRef?: string;
  scopeRef: string;
}
~~~

**建议的多轴正交结构**：
1. **Referent / World**：指向数学体系、理想物理模型、计算模型、实际设备或被测对象等；
2. **Representation**：如何表达或求得这个对象，例如连续方程、离散网格、程序、测量反演模型；
3. **Scope**：参数、单位、正则/非正则坐标、容差、时间、环境、已知未知条件；
4. **EvidenceOrigin**：证明、计算、测量、文献、专家判断等产出来源（独立于 World 分类）。

用于讨论的种子类型（**非封闭注册表**）可以含 FORMAL_SYSTEM、PHYSICAL_MODEL、COMPUTATIONAL_MODEL、IMPLEMENTED_SOFTWARE、PHYSICAL_SYSTEM、MEASUREMENT_PROCESS 等；Domain Packages 可添加 DIGITAL_TWIN、STATISTICAL_MODEL、NORMATIVE_REQUIREMENT 或新的科研类型。最终最小类型集合仍需 PoC 裁决。

**世界类型继承不表示知识自动强制转换**。例如 DIGITAL_TWIN 即使引用了 COMPUTER_MODEL 和 PHYSICAL_SYSTEM，也不能自动宣称仿真结果在现实成立。任何跨语境迁移必须由 RuleRegistry 注册具体规则与验证义务。

### 3.2 关键语义鸿沟（gap）检查

风险不只有 THEORY→ENGINEERING；还应覆盖：

| 源语义 → 目标语义 | 可能缺失的关键保证 |
| --- | --- |
| 形式数学 → 物理模型 | 形式定义与目标物理机制是否对应，假设能否适用 |
| 连续模型 → 离散算法 | 一致性、稳定性、守恒、误差界 |
| 算法规范 → 软件实现 | 实现正确性、编译/依赖版本、数值精度 |
| 数值预测 → 真实装置 | 模型适用性、参数不确定度、实验对照 |
| 原始仪器信号 → 观测结论 | 被测量定义、标定、噪声与反演方法 |
| 相关关系 → 因果解释 | 混杂/识别条件、干预机制 |
| 局部样本 → 普遍规律 | 样本代表性、选择偏差、参数外推 |
| 已检验工况 → 新工况 | Scope、尺度与条件变化 |
| 性能达到指标 → 工程可部署 | 安全、可靠性、约束与审批 |

同 WorldKind 的不同具体模型版本/测量协议之间也可能存在这些鸿沟。任何默认允许的迁移都必须明确列为受控规则，且记录使用的规则版本。

### 3.3 ResearchScope 与部分形式化

每份正式命题包含量词、对象、单位/量纲、参数域、模型/校准条件、误差定义、未知条件和明确的引用。Scope 可以部分未知，但 UNKNOWN 不能被空白/默认值伪装成已满足。

命题保留人类可读原始陈述和机器可检查的有限 TypedFormula AST。AST 可以拥有不透明谓词，但其签名和所需概念仍必须有明确定义，且不能将不透明谓词视为已证明。

~~~typescript
interface AssertionRevision {
  assertionId: string;
  revisionHash: string;
  statement: string;
  proposition: TypedFormula;
  worlds: WorldBinding[];
  scope: ResearchScope;
  semanticKind: string;
  conceptRevisionRefs: string[];
  formalizationCoverage: "STRUCTURED" | "RULE_CHECKABLE" | "FORMALIZABLE" | "KERNEL_CHECKED";
}
~~~

### 3.4 D14：规范化概念注册表（Semantic / Concept Registry）

**正式 Argument 的可检查性依赖共享术语定义**。术语不是仅供搜索的关键词：形式化谓词、变量类型、世界绑定、单位和逻辑规则应明确引用 ConceptID@Revision，不能直接根据自然语言相似度判断两个术语相同。

建议三层范围：
- **System 级词汇**：定义、假设、证明、支持、反驳、证否、未支持、量词、规则、命题等论证元概念，跨项目稳定；
- **Domain 级词汇包**：数理逻辑、计量、加速器、数值求解、设备工程等可版本化可复用包；
- **Project 级词汇**：运行中逐步建立的新物理量、设备身份、符号、过程和临时假设。术语作用域不再使用 L0/L1/L2，以免与形式化能力分级混淆。

概念最低建议携带：

~~~typescript
interface ConceptRevision {
  conceptId: string;
  revisionHash: string;
  preferredLabels: Record<string, string>;
  aliases: string[];
  humanDefinition: string;
  structuredMeaning: {
    kind: "TYPE" | "PREDICATE" | "QUANTITY" | "RELATION" | "PROCEDURE" | "OTHER";
    signature?: TypedSignature;
    scopeConstraints?: string[];
    worldConstraints?: string[];
    unitOrDimensionRef?: string;
  };
  provenanceRefs: string[];
  formalLinks: Array<{
    backend: string;               // e.g. Lean
    declarationRef: string;
    correspondenceStatus: "UNREVIEWED" | "REVIEWED" | "DISPUTED";
  }>;
  lifecycle: "PROVISIONAL" | "REGISTERED" | "DEPRECATED";
}
~~~

**创建与检索**：
1. 正式 Assertion / Argument 写入时，只能引用现有注册概念，或在**同一原子提交**中注册新概念；保证无悬挂语义引用。
2. 为科研探索允许 PROVISIONAL 新术语，但正式已认证的严格推理不得假装其未审查定义已被形式化证明。
3. 检索包括字面/别名/关键词、类型/单位/Scope 约束、RAG 语义候选、Lean 声明与证明关联召回；**检索排名仅帮助查找，不自动构成概念等价或证明**。
4. 术语语义变更产生新的 revision，审查引用了该精确版本的 Assertion/Argument/Certificate；旧版本永久可回放。
5. 新别名与文档补充不应默认使所有证明失效；重定义谓词含义、类型、单位或量词才触发定向重检查。

**概念变更必须是重要的、可回放的科研事件**：建议 CONCEPT_CREATED、CONCEPT_REVISED、CONCEPT_DEPRECATED、CONCEPT_MAPPING_REVIEWED、FORMAL_LINK_REVIEWED。变化按影响图定向传播，不全局粗暴撤销。

### 3.5 必需 Semantic Kernel 与可插拔 Terminology Discipline Port

用户已同意“术语纪律可插拔”，但须明确开关边界：

- **不可关闭**：概念 identity/revision、谓词签名引用、最低形状约束、旧语义解析、事件可回放。
- **可插拔**：歧义/重名分析、定义质量审查、未批准术语警示、RAG 辅助查重、术语变更风险预审、治理责任升级、对外集成 dsh-agent-team 纪律系统。
- 建议政策：OFF / OBSERVE / WARN / ENFORCE。OFF 不会取消最低语义一致性门；ENFORCE 也不能将某个审查 LLM 的意见当作形式化逻辑真理。
- 审查端口可以返回 diagnostics、recommendedActions、targetRefs、severity、policyVersion；变更与用户/Agent 审批链另由治理系统处理。

~~~typescript
interface TerminologyDisciplinePort {
  inspectProposal(proposal: SemanticProposal): Promise<Diagnostic[]>;
  inspectConceptRevision(change: ConceptChange): Promise<ImpactReport>;
  auditProject(projectId: string): Promise<Diagnostic[]>;
}
~~~

对应架构借鉴：W3C SKOS 的概念和语言标签分离、形式定义与谓词契约、以及面向科学单位的领域字典。**不要求因此迁移到 RDF/OWL 数据库**。

### 3.6 D17：渐进式语义契约与形式化 L0–L5（工作分类）

此前的 L0/L1/L2 被用在不同含义上。本稿现在仅以 L0–L5 表示**形式化能力**，术语表作用域改用 System / Domain / Project。

**两条已明确的科研协作原则：**

- **L0：Normalized Submission（规范化提交）**。主科研 Agent 使用结构化自然语言，定位涉及的对象、引用来源、关系角色与结果；当提出推理时须声明推理方法（统计、类比等），并记录不确定信息。服务执行低成本身份/格式/引用/声明检查。L0 通过后提交者可用该结果继续探索，不要求此刻有完整 TypedFormula/Lean 代码。L0 可被检索，但不应被他人无标注地当作全局语义稳定前提。
- **L1：Semantically Stable（语义稳定）**。对必要的术语、对象身份、World、Scope 和原意完成规范化对应与语义确认。该结果对项目内其他 Agent 全局可引用、可供研究推进，**但不保证推理正确、证据充分或事实真实**。需要澄清时，外部形式化 Agent 应优先快速回访原作者，不得擅自将新假设写入原意。

**L2–L5 只作为进一步研究的候选能力分层：**

| 等级 | 候选能力 | 能说明什么 | 讨论状态 |
| --- | --- | --- | --- |
| L0 | 规范化自然语言提交 | 身份、来源和论证角色可追踪 | 协作原则已同意 |
| L1 | 稳定语义与术语、World/Scope 对应 | 团队能稳定引用同一意义 | 协作原则已同意 |
| L2 | 明确的推理结构（前提、规则模式、结论、条件） | 已登记的推理结构可追踪、部分缺口可检查 | 方向明确、定义未冻结 |
| L3 | 类型/规则/Scope/单位及跨 World 义务的静态检查 | 对**声明过的规则**具有局部机器保证 | 待讨论 |
| L4 | 受指定契约约束的机器可检查材料 | 可以交由领域检查器、证明器执行验证 | 待讨论 |
| L5 | 在明确可信计算基中完成检查的严格证书 | 例如 Lean 内核验证精确形式命题 | 待讨论 |

**不是单线“真理等级”**：L2–L5 最终可能采用偏序能力向量；有些经验研究没有合理的 L5。语义稳定、推理检查、证据充分性、研究者信心与正式 Fact 接纳仍为独立属性。高等级证明不能自动保证其物理现实适用性。

原始 ResearchFinding 需保存不可变版本，后续 SemanticCandidate、正式 AssertionRevision、推理与证书分别引用原始版本；未完成确认应能查询并在下游引用中保留。**形式化请求列表是持久化状态视图，不是本项目的 Agent 调度器。**

示例：主 Agent 提交“Simulation Run A 与分析 Artifact B；推理模式 STATISTICAL；结论数值收敛”，L0 检查身份、格式与方法已声明；L1 需澄清迭代收敛、网格收敛或统计收敛及具体指标；更深入形式化可异步进行。若声明 STATISTICAL 不适用，L1 给出可审查的修订建议，不能静默改写作者原意。

## 4. 科研知识对象及身份

| 对象 | 定义 | 关键限制与关系 |
| --- | --- | --- |
| ResearchFinding | L0 规范化提交的原文与关联引用 | 提交者可继续研究，不自动得到团队语义稳定保证 |
| Assertion + Revision | 经过语义确认的稳定科研命题与修订 | L1 后绑定 World、Scope、Concept Revisions；不因此证明正确 |
| ObservationRecord（D16） | 实际观测到的实验/数值/运行现象及其获取条件 | **可独立于任何已有 Hypothesis**；需记录 PROVISIONAL/审查状态 |
| Artifact | 数据、代码、报告或证明证书的载体 | 内容哈希、引用、生成/使用 Run |
| Evidence | 某 Observation 或 Artifact 对特定论点的证据性解释 | 指明方法、适用性和局限；不等于原始文件 |
| Argument | 规则化的多前提、证据及义务 → 结论推理 | 支持 strict / defeasible 以及 rebuttal/undercut |
| Assessment | 有主体、理由与范围的认识评价 | 允许不同研究者给出不同结果 |
| FactDesignation / FactStanding | 项目正式接纳特定 AssertionRevision 的决策与现状 | 可维持、暂停、撤销或重新接纳，不等于客观真理 |
| AnomalyRecord（D16） | 矛盾、解释失配、未解释观察、意外成功等异常 | 不自动作为证伪；可以持续产生研究问题 |
| ResearchQuestion / ResearchRoute | 需要弄清的问题及候选研究方法 | 保持与 Task / PlanFork 分离 |
| SemanticCandidate / FormalizationRequest | 指向原始 Finding 修订的结构化候选与待确认事项 | 不是独立的真理实体，也不负责 Agent 调度 |

### 4.1 Assertion 与 Fact 关系

同一科学命题可以先为候选观点，后经评估升为项目 Fact，又因新证据而被质疑，再恢复。论点逻辑身份与具体 Revision 分离；FactStanding 为带历史的接纳决定，不应永久写死在 Assertion 本体。

旧版 Fact 登记是历史科研判断记录，不因此自动获得新的类型检查、Lean 证书或审查状态。

### 4.2 四个认知评价维度

| 维度 | 示例 | 判定范围 |
| --- | --- | --- |
| DeductiveValidity | UNCHECKED / RULE_CHECKED / KERNEL_PROVED / INVALID / STALE | 仅针对形式命题与其严格证明 |
| ScientificSupport | UNASSESSED / SUPPORTED / MIXED / UNDERMINED / INCONCLUSIVE | 证据独立性、实验与数值适用性等 |
| FactStanding | NONE / ACTIVE / SUSPENDED / WITHDRAWN | 项目级正式接纳 |
| ReviewState | CLEAR / REVIEW_REQUIRED / UNDER_REVIEW | 复审状态 |

例如工程 Assertion 可以 MIXED + ACTIVE + REVIEW_REQUIRED：原理论解释受挑战，独立实验证据仍提供支持，项目接纳尚未撤销。

### 4.3 Observation、Evidence、Hypothesis 必须能够独立存在

**D16 明确强化**：ObservationRecord 是关于实际结果与观察条件的持久记录；它在首次提交时可以不属于任何 Hypothesis 或 Argument。Evidence 是使用该观察对某一论点进行的证据性分析，两者不可混淆。

- Hypothesis Space 是 Assertion 中候选解释、机制与可检验预测的视图。
- Observation Space 独立索引未经解释和已解释的记录；支持主动搜索未覆盖区域。
- 某个观测即使尚未获得可靠解释，也不应被丢弃；若数据质量未验证，应标 PROVISIONAL。
- “无现有理论解释”可触发 Anomaly 和 ResearchQuestion，但不自动意味着现有理论被证伪。

## 5. Typed Argument Kernel：推理模式、强制义务和危险检查

### 5.1 统一 Argument 超边与多轴推理分类（分类原则已同意）

完成深入结构化后的 Argument 不是仅含二元 SUPPORTED_BY 边的静态知识图。它应持有**多项前提 AND / 多种替代论证 OR**、证据引用、目标精确修订、规则版本、量词变量绑定、未满足义务以及评价和形式证明引用。L0 允许只登记结构化自然语言关系及其方法声明；L1 允许在完整 AST 尚未具备时达到语义稳定。

~~~typescript
interface Argument {
  id: string;
  revisionHash: string;
  premises: AssertionRevisionRef[]; // AND prerequisites
  evidenceRefs: EvidenceRef[];
  conclusion: AssertionRevisionRef;
  inferenceSchemeRef: string;       // versioned and extensible
  logicalForce: "STRICT" | "DEFEASIBLE" | "HEURISTIC";
  evidenceRelation: "SUPPORTS" | "REBUTS" | "UNDERCUTS" | "NEUTRAL" | "UNRESOLVED";
  bindings: TypedVariableBinding[];
  assumptions: TypedFormula[];
  obligationRefs: string[];
  verificationReportRefs: string[];
  justificationRefs: string[];
}
~~~

**推理类别不得混成一个大枚举**。至少区分四个独立维度：

| 维度 | 建议形式 | 问题 |
| --- | --- | --- |
| InferenceMethod / Scheme | DEDUCTION、INDUCTION、STATISTICAL、ABDUCTION、ANALOGY、CAUSAL、DEFAULT、PRACTICAL（可注册） | 是什么推理方法/模式？ |
| LogicalForce | STRICT / DEFEASIBLE / HEURISTIC | 若前提成立，结论受何种逻辑约束？ |
| VerificationStatus | UNCHECKED / RULE_CHECKED / KERNEL_CHECKED / EMPIRICALLY_REVIEWED 等 | 实际检查到了哪一步？ |
| EvidenceRelation | SUPPORTS / REBUTS / UNDERCUTS / NEUTRAL / UNRESOLVED | 本论证怎样影响目标论点或另一条论证？ |

一项实际论证可以混合方法或拆成多个 Argument，以保证每条重要推理步骤可追溯。类型名称和具体 Scheme 接口需要后续 PoC；**正交分类原则本身已同意**。

### 5.2 推理方法的适用边界与 Critical Questions

| 方法 | 使用含义 | 最低危险检查/关键问题 |
| --- | --- | --- |
| Deduction 演绎 | 从明确前提按有效规则推出结论 | 规则是否合法？前提闭合？Lean/证书覆盖精确命题？ |
| Induction 归纳 | 由有限样本/观察推广到更大对象范围 | 代表性、选择偏差、覆盖范围、外推条件？ |
| Statistical inference 统计 | 在统计模型下推断参数或预测分布 | 假设、似然/噪声模型、不确定度、选择偏差？ |
| Abduction 溯因 | 为观察提出解释性假设 | 是否存在竞争解释？什么实验可以区分？ |
| Analogy 类比 | 从其他对象/模型迁移关系 | 关键相似点及不可忽视差异？ |
| Causal inference 因果 | 从因果模型与识别条件判断干预效果 | 混杂因素、识别、时间先后与干预设计？ |
| Default / defeasible 默认 | 有例外和可撤回条件的常规判断 | 例外触发？默认前提是否仍适用？ |
| Practical reasoning 实践决策 | 依据目标、约束和风险提出行动 | 是否比较替代方案、安全/成本/权限与价值取向？ |

**“未发现反例”不是归纳证明**：它可作为反例搜索覆盖情况或知识状态记录，但若没有充分的正向观察，不能据此声称具有统计或归纳支持。**“经验支持”通常属于 Evidence/Assessment 支持态势**，不是和 Deduction/Induction 并列的普适推理规则。

使用 SchemeRegistry（可扩展、版本化）注册每类推理的参数、必要义务和 Critical Questions。可审计地输出规则/义务，而不假装所有科学质疑可由静态检查一次性解决。

### 5.3 Strict 与 Defeasible 保持明确区分

~~~text
Γ ⊢[World, Scope, FormalRules] φ      // 严格推理；要求实际闭合的证明义务
(Γ, Evidence) ~>[World, Scope] φ      // 可修正的科研支持；非必然蕴涵
~~~

形式化证明内核通过可以是极强的 STRICT 证据，但并不自动证明自然语言翻译正确，也不自动许可跨世界迁移。

**Argument 的结构合法性、ProofObligation 的满足情况、科学支持与 FactStanding 四者必须分离。**

### 5.4 D15：强制生成，但不阻碍科研探索的 ProofObligation

危险推理规则必须生成有身份、有来源、有依赖关系的**义务记录**。但“当前未验证 C”不等于禁止研究人员研究条件性后果：

~~~typescript
interface ResearchObligation {
  id: string;
  originArgumentId: string;
  condition: TypedFormula;
  kind: string;                 // MODEL_ADEQUACY / CALIBRATION / NUMERIC_BOUND / ...
  status: "OPEN" | "IN_PROGRESS" | "SATISFIED" | "CHALLENGED" | "UNRESOLVED" | "CLOSED_WITH_EXCEPTION";
  evidenceRefs: string[];
  dependentArgumentRefs: string[];
  acceptedExceptionRef?: string;
}
~~~

**双门设计**：
1. **Record & Explore Gate**：允许明确标注 conditional、PROVISIONAL 或未充分验证的研究记录，允许后续条件性推理和仿真；不允许把错误 AST、非法身份或类型不一致伪装为通过静态检查。
2. **Certified Use / Acceptance Gate**：未满足所需义务不能认证完整严格证明，也不能自动满足特定工程验收、安全部署或高风险现实操作所要求的策略。继续科研不意味着义务已消失或风险已获批准。

义务债务沿**真实依赖的 Argument 路径**向后传播，报告传播源和条件。对某个结论 B 出现新的独立支持论证时，系统保留两条路径，不得将旧路径对 C 的债务错误加到所有新路径上。

**CLOSED_WITH_EXCEPTION** 仅代表某位有权主体决定允许特定使用情境继续，不能转义成 C 已得到证明或校准已通过。状态可能需要审查/版本化，以上字段未冻结。

### 5.5 Typed Inference Kernel 的检查步骤

1. Shape / identity：具体对象版本、术语身份、规则引用、权限与来源检查；
2. Formula / binding：谓词签名、量词绑定、变量类型、量纲/单位/坐标检查；
3. World / Scope：语义世界具体身份、模型版本、参数域与适用性检查；
4. Inference scheme：检查 SchemeRegistry 的必要前提、侧条件、Critical Questions 并生成义务；
5. Formal backend：在可形式化场景下调用 Lean / 证书检查并绑定精确命题；
6. Scientific evaluation：按 Evidence 的质量、独立性和范围形成可审计评价；
7. Acceptance governance：按项目策略决定 FactStanding，而不是由 Argument 自己宣布事实。

检查报告必须分别记录 structural/type/rule/formal/applicability 的结果，**允许带 OPEN 义务的条件性论证留存**。ILL_TYPED 的正式机器可执行表达不能被认证为类型正确，但可以保留来源草案用于后续修订。

### 5.6 危险推理规则：推荐起始集合

| Rule ID（草案） | 触发 | 响应 |
| --- | --- | --- |
| H-WORLD-001 | THEORY 直接跳到 ENGINEERING，无明确中介条件 | 自动生成模型适用/物理证据义务；可条件性探索，禁止伪证书 |
| H-WORLD-002 | SIMULATION 被默认为真实工程效果 | 要求数值/模型适用性及现实校准义务 |
| H-WORLD-003 | 同类不同版本 Context 混用 | 要求兼容规则与版本检查 |
| H-LOGIC-001 | 变量未绑定、非法量词、错误谓词类型 | 结构拒绝认证，保留可修正草稿 |
| H-LOGIC-002 | 有限实例被直接推广为全称命题 | 附加归纳/严格证明/代表性义务 |
| H-SCOPE-001 | 参数外推、Scope 扩大或测量阈值变化 | 范围不匹配警报与义务 |
| H-UNITS-001 | 单位、量纲、坐标系不兼容 | 机械拒绝或显式转换规则 |
| H-DEPEND-001 | 同源证据伪装独立、循环论证 | 记录独立性与循环风险 |
| H-INFERENCE-001 | Abduction 的唯一解释被误标为 Deduction | 保留竞争假设及可区分性义务 |
| H-INFERENCE-002 | 无反例被误等同于充分归纳支持 | 保留检索覆盖状态并生成正向证据义务 |
| H-FORMAL-001 | Lean 命题与自然语言 statement 缺审查对应 | 仅承认证书对应的精确公式 |
| H-VALIDITY-001 | 术语/规则/证书/来源的使用版本已变 | 精确传播失效及复审义务 |

**不存在“同一个 World 中推理天然安全”的默认规则。** 连续动力学理论推出工程测量“保辛”的结论，需要坐标、映射、测量和物理条件，而非仅判断所有对象都属于 ENGINEERING。

### 5.7 Model-to-Reality 是通用类型检查，不是特殊 Argument 类

World / Rule Registry 负责不同语义上下文之间的转换：Theory→Theory、Theory→Simulation、Simulation→Engineering、Theory→Engineering、Engineering→Theory 以及同世界不同配置。

必须显式生成相应义务，如 MODEL_ADEQUACY、IMPLEMENTATION_CONFORMANCE、NUMERICAL_ERROR_BOUND、CALIBRATION、PHYSICAL_VALIDATION、SCOPE_COMPATIBILITY、UNCERTAINTY_PROPAGATION。它们可以在科研探索期间 OPEN；提交严格验证/工程验收时按对应契约处理。

**典型异常（重要）**：若 Argument 原为 A + Calibration(C) → Engineering(B)，后来存在对 B 的独立实验支持而 C 的校准检查不通过：
- 不自动否定 A，也不抹除 B 的独立证据；
- 旧解释路径的验证义务受挑战；
- 新建可追踪的 WORLD_TRANSFER_FAILURE 或 INFERENCE_GAP Anomaly；
- 触发后续研究：校准模型是否错误？C 是否真的必要？是否另有物理机制 H2？
- 若“C 不通过”仅为基础设施失败或证据不足，则 C=UNKNOWN，而不是自动得出 ¬C。

## 6. Lean 与严格演绎子图：保留并增强 Euler

### 6.1 强验证属性

对可形式化的 THEORY → THEORY 推理，系统应优先允许 Lean 检查精确公式与证书，形成一种远强于 LLM 审查的论证依据。

**FormalProofCertificate** 候选字段：

- 目标 AssertionRevision 与精确 Lean proposition；
- Lean 版本、Mathlib / Lake 依赖的固定身份与构建环境；
- 源文件/证明项哈希、证明依赖/公理信息、检查输出；
- 内核检查结果与校验时间；声明的可信计算基边界；
- 禁止将 sorry / 非预期额外公理 / 未受信任占位当成已证明；
- 自然语言陈述与形式化命题的 **FormalizationCorrespondence** 审查记录。

Lean 内核通过仅能保证：**在给定形式化定义、依赖与公理体系下，精确形式化命题获得了受信任的证明**。它不自动证明自然语言翻译忠实、物理模型真实或实验装置满足假设。

### 6.1a 与术语/类型版本的严格绑定

Lean 证明证书应记录所使用的 ConceptID@Revision、Predicate Signature、WorldContext、FormalizationCorrespondence 的版本。若改写了形式化定义，需对受影响证明执行定向重检；仅变更术语显示别名不能改变已检查的定理语义。术语检索召回的 Lean 声明，仅在对应关系经过审查后才能作为目标 Assertion 的准确形式表示。

### 6.2 保留可验证数学 DAG

统一 Argument Network 中专门保留一个严格演绎子图：

- 明确前提/依赖版本与证明证书；
- 检查前提闭包与信任前提；
- 证书/依赖失效时，不再允许作为针对**当前版本**的完备证明；
- 保留历史上某版本已获证明的事实记录；不能凭现实实验冲突篡改其数学证明历史；
- 支持内容寻址、依赖查询、重新检查、证明复用和反向影响分析。

**验收目标：对严格数学研究场景，不低于 Euler 在精确陈述、受控接纳、事实依赖和验证证据方面的语义强度。** 是否真正达到目标需要后续逐项 PoC 与回归测试证明，不能在本设计稿中声称已经实现。

### 6.3 一个理论→现实例子

Theory 命题：在模型 M 与相应正则坐标中，Hamiltonian 流映射 Φ_M 保辛。

Simulation 命题：配置 S 计算的映射 Φ_S 与 Φ_M 满足指定误差条件。

Engineering 命题：装置 E 在工况 C 下，**按指定测量定义**得到的映射具有阈值 ε 内的近似保辛性质。

其中可单独形式化的数学子问题是：若 Φ_M 保辛，且在适当区域有 Jacobian 范数界 ||DΦ_E - DΦ_M|| ≤ δ、||DΦ_M|| ≤ L，可推出近似保辛误差的条件性上界（在相容矩阵范数及 J 的定义下，例如 ||J||(2Lδ+δ²)）。

但真实装置是否满足上述 Jacobian 差异界属于 ENGINEERING 证据义务。粒子轨迹位置误差小也**不自动**保证 Jacobian 误差小。Lean 验证此条件性不等式，不能绕过这一现实义务。

另一个关键负例：“真空足够高”“仅经过一个四极铁”“没有粒子损失”即使都被接纳，也**不足以直接推出**某测量定义下的保辛性；缺失动力学、坐标映射、测量重建和模型适用前提时，应产生危险推理报告。

## 7. Observation、Evidence、Assessment、Fact 与异常发现

### 7.1 Observation ≠ Artifact ≠ Evidence ≠ Argument

- **Artifact**：程序、文件、实验原始数据、图像、计算输出及证明证书等载体。
- **ObservationRecord（D16）**：在具体 World/Scope、测量/计算协议下记录了什么，附质量与暂定状态；**允许不属于任何现有假设**。
- **Evidence**：观察或其他 Artifact 对某个 Assertion 的证据意义，包括不确定性、样本、校准和解释路径。
- **Argument**：使用哪些前提及规则支持、攻击或解释什么结论。
- **Assessment**：研究者/检查器在何种能力范围内对上述对象做出了什么评价。

同一观测数据可以支持“装置呈现性能 P”，同时削弱“现象由 H1 导致”；同一文件也可能存在系统误差或依赖 H1 的反演模型。这些路径应分别记录。

### 7.2 Assessment 和 Fact 的接纳

保留 DeductiveValidity、ScientificSupport、FactStanding、ReviewState 正交投影。FactDesignation 包括接纳主体/授权策略、目标 AssertionRevision 与 Scope、证据路径、审查时间及理由。

不以统一 LLM 分数替代科研判断，也不把“检查器 PASS”直接当成现实真值。新证据可触发复审；不同研究者的 Assessment 可以共存。

### 7.3 Nonmonotonic Impact：论证路径失效，不是结论自动删除

1. 新 Evidence、Observation、ConceptRevision 或 ArgumentCheckReport 入库；
2. 检查精确版本依赖、证书和术语变更；
3. 查询受影响的 support / rebuttal / undercut / explains 路径；
4. 严格数学 DAG 对受影响的证明依赖执行重检查；
5. 经验与工程结论的科学支持更新为待评价或冲突状态；
6. 保留其他独立证据路径，生成必要的 Assessment 和 Anomaly 候选；
7. 仅根据明确授权策略调整 FactStanding，并更新 Frontier / Context。

例如 H1 被推翻，不等于物理性能 P 被推翻；若 P 由独立实验 E1 证实，可保留为 ACTIVE（可能同时 REVIEW_REQUIRED）。若 E1 的数据反演依赖 H1，则需单独检查 E1 的有效性，不允许“实验一律真实”。

### 7.4 D16：Anomaly & Discovery Registry

**不只维护逻辑矛盾，更维护“值得解释的失配”。**

建议 AnomalyKind（候选，可扩展）：

| Kind | 定义 |
| --- | --- |
| DIRECT_CONTRADICTION | 相同/明确相容 Scope 下直接冲突的命题 |
| EVIDENCE_CONFLICT | 来源证据之间存在难以协调的结果 |
| INFERENCE_GAP | 旧推理不足以推出结论，但结论可能仍成立 |
| UNEXPLAINED_OBSERVATION | 已知观察尚无合理解释 |
| PREDICTION_MISMATCH | 模型预测与实际/数值观测残差异常 |
| WORLD_TRANSFER_FAILURE | 跨世界适用/校准/一致性义务失配 |
| SEMANTIC_MISMATCH | 术语、单位、定义或 Scope 版本冲突 |
| UNEXPECTED_SUCCESS | 理论机制错误或不完整，但目标工程结果有独立支持 |

每项 Anomaly 保存 ID、type、sourceRefs、World/Scope 及修订、首次检测来源、review/triage、候选解释、影响对象、历史复开条件、时间、去重 fingerprint。

建议生命周期：DETECTED → TRIAGED → INVESTIGATING → EXPLAINED / UNRESOLVED / DISMISSED；新证据或旧解释失效可重新开放。EXPLAINED 不等于删除原异常。

### 7.5 交互检查：确定性触发 + 可插拔 LLM 科研分析

**第一层（确定性、事件触发）**：
- Concept/Scope 更改使旧推理失效；
- 两项可比较 Observation / Prediction 出现超容差残差；
- 同一世界和作用域存在可机械定位的冲突；
- 旧 Argument 的校准义务受挑战，但其 conclusion 仍有独立支持；
- 某项 Observation 尚未关联任何现有 Hypothesis。

这些只能生成候选异常或确定性的类型/版本冲突，不能直接宣布已有理论被证伪。

**第二层（可插拔、可配置周期/事件驱动）**：
独立科研 Agent/LLM 分析失配及可能隐藏的模型假设、竞争机制、测量问题，并提出：
- AnomalyAssessment（包括不是科学矛盾的可能解释）；
- 新 Assertion / Hypothesis；
- 可区分性实验或 ResearchQuestion / ResearchRoute；
- 对现有证据的复审建议。

该端口不拥有项目 FactStanding 权限；其结果必须有独立身份、来源、输入上下文版本和策略，不能原地覆盖科研历史。对同一异常无新事实/新工具/新假设环境时，去重并冷却，防止持续消耗预算生成重复“新发现”。

### 7.6 SHELDON：观察空间与假设空间的双向搜索

[SHELDON: Reasoning through Dual Search over Hypothesis and Observation Spaces](https://arxiv.org/abs/2610.18025)（Joshi、Shethia、Lam，2026 年 10 月预印本）提出分离假设与观察搜索，以未解释的观察激发新的候选假设；[参考代码](https://github.com/stanford-oval/sheldon)。

V3 借鉴其思想而不将论文实验当作系统可靠性的证明：
- **Hypothesis Space**：候选 Assertion/机制/预测；
- **Observation Space**：独立 ObservationRecords，含 PROVISIONAL 状态和未覆盖观察区域；
- **Interaction Analysis**：比较假设与观察，保留 SUPPORT / CONTRADICTION / NEUTRAL / UNRESOLVED；
- **Anomaly Registry**：将解释缺口变成可持久追踪、可复开的研究对象；
- **New Research Route**：提出能区分竞争假设的观测/实验，而非只继续寻找原假设的支持证据。

重要边界：未经复核的 PROVISIONAL 观察能引导探索，但不能直接作为已获验证的反证并自动撤销 Fact。

### 7.7 标准验收案例：A / C → B，但 C 失败、B 独立成立

原理论 A 在条件 C（校准、适用性）下预测工程性质 B。后续独立实验支持 B，但 C 校准不通过：
- A 的模型内严格证明（如有）保持其原有数学效力；
- A+C→B 的现实适用论证受到挑战；
- B 的独立证据路径不受无关 C 失败的无条件级联影响；
- Anomaly 记录解释失配，生成“为什么 B 仍然成立？”研究问题；
- 可提出 H2 新机制、C 非必要、测量方法有缺陷等竞争解释；
- 若后来找到新证据，Anomaly 与相关 Assessment 追加修订，不覆盖原历史。

## 8. ResearchQuestion / ResearchRoute / Frontier

这部分借鉴 Euler 的 Obligation / Route / Frontier，但不把研究问题等同于数学证明义务。

| 实体 | 作用 |
| --- | --- |
| ResearchQuestion | 要调查/解释/证实/否定/优化/比较的研究问题 |
| ResearchRoute | 可能的研究方法、必要子问题、证据要求与失败条件 |
| ProofObligation | Argument 规则和跨世界转换产生的明确待验证条件 |
| Frontier | 由当前研究状态投影出的开放问题、证据缺口、未解释 Observation、Anomaly、争议与复查需求 |

- 单条 Route 所要求的若干子义务可以 AND 组合，替代 Routes 可以 OR 并存。
- Route 的前提满足最多产生 READY_FOR_REVIEW，不应自行认定最终研究问题已解决。
- 完成 Task 不是完成研究问题；问题可能在新的证据出现后重新开放。
- 对失败分类必须区分 INFERENCE_INVALID、COUNTEREXAMPLE、MODEL_MISMATCH、NUMERICAL_INCONCLUSIVE、INFRA_FAILURE、BUDGET_EXHAUSTED、MISSING_EVIDENCE 等；计算失败不能误报科学反例。

### 8.0a Frontier 还需直接消费异常与假设债务

Frontier 不仅是未解决的证明义务列表，还应包含：（a）目前无法解释的观察与预测残差；（b）Argument 的 OPEN/CHALLENGED 校准或适用性义务；（c）依赖新术语定义的研究缺口；（d）错误机制与仍被观察支持的工程性能之间的解释失配；（e）为区分竞争假设而建议进行的新实验。

AnomalyRegistry 的候选新问题应进入明确的研究建议流程，而不是自动修改用户 canonical plan 或立即启动高风险实验。注意：这里的术语 CHALLENGED 在实际编码时应规范化为 CHALLENGED，避免由显示字符造成枚举污染。

### 8.1 Context Compiler 与长程 Agent

Context Compiler 产生带来源和版本的最小充分上下文：目标问题、精确命题、具体 World/Scope、ConceptID@Revision、必要前提与证明证书、推理方法/规则版本、支持/反驳、PROVISIONAL 观察、Anomaly、失败记录、未闭合假设债务以及当前 FactStanding。

- 必需的逻辑前提、量词/Scope、world IDs、版本和证明引用**不可静默截断**。
- 次要历史、可展开的长证明和大文件使用引用与省略清单。
- 若必需上下文缺失、过期或超出预算，显式返回缺口或推迟任务，不编造完备上下文。
- 保留 Euler 的结构化 failure recall、frontier-driven work 和跨轮可复现上下文。
- **Research Control 输出 candidate work + context；DSH/dsh-agent-team 决定谁执行、权限、预算、何时运行**。
- 条件性研究上下文必须携带 OPEN obligation 的来源及继承路径；不能靠摘要压缩把“假设未验证”转述成“已完成证明”。

## 9. 与现有 V1/V2 代码和治理的映射

本稿拟利用已有工作，而不是插入平行的 Euler 数据库：

| 当前对象或模块 | V3 处理建议 | 理由 |
| --- | --- | --- |
| Project / Topic / Workstream | 保留组织归属 | 与科学论点所属世界不同 |
| Claim / Fact（semantics） | 迁移为 Assertion / Revision / Assessment / FactDesignation | 当前 Fact 永久 ACTIVE，无法表达认知退化 |
| Artifact / Run | 保留并强化 Provenance；新增 ObservationRecord 与 Evidence | 产物、观察和论点的证据意义不能混淆 |
| Relation | 执行/组织关系保留；科学推理关系迁入 Argument 超边 | 二元关系不能表达规则、条件、AND / OR、undercut |
| Objective / Task / Gate / Milestone | 保留独立工作流语义 | Task 完成不等于科学定理证明 |
| PlanFork | 保留用户控制的 canonical plan 提案 | Agent 新建 ResearchRoute 不得变更 canonical plan |
| ResearchHistory | 扩展项目级科研事件 + 现有 Workstream 运行事件 | 跨 Workstream 共享科研知识、追踪多来源 |
| Derived Blocker / Intervention / Brief | 扩展为知识影响、术语变更影响、Anomaly/复审与科学状态投影 | 不等同于直接科学真值 |
| src/host/domain/semantics | 重构或新增 world/concept/typed-formula/inference-scheme/assertion/argument/assessment 纯领域层 | 语义内核不可因纪律插件关闭而失效；保持无 DSH 直接依赖 |
| src/host/service/semantics | 扩展科研知识读写/验收服务 | 复用现有审计与事件追加习惯 |
| src/host/history / persistence | 增加 WorldType/Concept Revision、Observation、Anomaly、Obligation 等事件、replay/projection、完整性检查 | 同一历史真源，精确变更影响索引 |
| src/host/tools / dsh-adapter | 后续添加概念检索/注册、Argument 验证、Observation/Anomaly 查询和候选提交工具 | 不在本 PR 修改冻结 11-tool 面 |
| src/client/graph | 后续加 Research Argument 图/Frontier | 不与 PlanGraph/TopologyGraph 混为一图 |

### 9.1 需要正式修改的既有 V1 不变量

V1 的 INV-SCI-1..4 明确限定 Fact/Claim 为非形式化标签、不做科学推理检查；INV-REL-4 禁止沿科研 Relation 图推理。V3 **有意改变**这些产品边界，因此必须在 V3 ADR 和新契约中显式替换，而不是偷偷在冻结 V1 Schema 上加字段。

现有 V1 文档、发布快照与工具面在本 PR 中保持原状，避免“写了设计就已经改了运行时”的误解。

### 9.2 历史数据迁移

迁移前需证明：
- 旧 C-/F- ID、statement、run、时间、工作线、直接关系仍可追溯；
- 旧 F 仅代表旧系统当时的“Fact 被登记”事件，**不自动进入 V3 的高等级形式化或科研接纳状态**；
- 旧无法解析的 Scope / 证明字段显式 UNKNOWN；
- 不改变、删除、伪造原有 HistoryEvent；
- 新世界身份和项目级 event owner 不与 Workstream 的旧单流事件约束混淆；
- 存储/事件迁移通过独立双轨回放和一致性对账检查。

## 10. 权限、持久化与服务边界

### 10.1 权限草案

- Research Agent 可以提出 Assertion、ResearchQuestion、ResearchRoute、候选 Argument、独立 Observation、Evidence、Anomaly、概念注册提案与 Assessment 建议。对新术语可创建 PROVISIONAL 项并由纪律端口审查。
- 类型/规则检查服务只登记其**实际检查结论**，不能凭 Agent 自述写入 KERNEL_PROVED。
- 指定的验证服务经身份/结果校验提交证书、可复查结果和错误码。
- FactStanding 的项目级接纳/暂停/撤回按照显式授权与审查策略进行；**第一版默认不设置全局自动升格器**。OPEN ProofObligation 不阻碍探索，但不得当成已完成的科学验证、安全许可或正式验收。
- Agent 不能凭知识写口改写 canonical plan、用户决定、其他 Agent 权限或原始审计历史。
- 后续与 dsh-agent-team 的 externalHard / approval 等治理机制对接需要专门接口设计，不在本设计稿中假定已实现。

### 10.2 持久化原则

- **Git**：低频、可读的项目政策、研究语义定义、治理契约和正式声明式配置。
- **SQLite event store**：科研对象、WorldType/Concept 修订、Observation、Anomaly、Argument 检查、验证回执、Assessment、FactDesignation、AssumptionDebt 与研究义务的演化历史。
- **SQLite projections/indexes**：当前认知、术语/类型反向依赖、Hypothesis/Observation 空间、Anomaly、Frontier、关键词/RAG/Lean 检索等可重建索引；召回排序不构成语义正确性证明。
- **External artifacts**：大体量实验和仿真数据仅存版本化引用、哈希、校准/生成元数据，不复制 DSH 会话 raw log。
- **Object identity**：稳定逻辑 ID 与内容寻址的 Revision/证书哈希分离；同一命题可接受多条证据路径和多位评价者。
- **时间**：至少区分研究现象发生时间、记录时间、评价与接纳时间；支持审计重放。
- **故障**：验证器失联、schema 错误、计算超时等不能自动转成“科研结论为假”。

## 11. 建议最小 PoC 与验收矩阵（非实施承诺）

| PoC | 验证内容 | 必须体现的负例 / 成功条件 |
| --- | --- | --- |
| P0a — Open World Registry（D13） | 注册新 WorldType、特征、上下文和显式迁移规则；同类跨版本 | 新增类型不修改核心封闭枚举；继承关系不自动赋予跨世界推理许可 |
| P0b — Concept Registry（D14） | L0/L1/L2 概念、PROVISIONAL 创建、ConceptID@Revision、词法/语义变更 | 词法改动不导致全图失效；语义改动精确重查引用；关闭 Discipline 不破坏引用完整性 |
| P0c — Typed Predicate / Scheme | AST、量词、单位、推理 Scheme、独立四轴分类 | 无反例不等于归纳支持；溯因不等于演绎；命名相近不等于概念相同 |
| P1 — Strict Theory | Theory→Theory Lean 证明、精确证书、形式化对应关系 | sorry、非预期额外公理、错误形式化映射不得声称完整证明 |
| P2 — Nonblocking Obligations（D15） | 跨世界强制生成义务，研究继续携带假设债务；独立支持路径 | C=OPEN 时探索不被阻断，但不能认证；后续独立支持 B 不无条件继承 C 的债务 |
| P3 — Nonmonotonic Knowledge | 多条 Argument 支持、rebuttal/undercut、FactStanding 复审 | H1 失效不自动撤销独立实验支持的 P；若实验依赖 H1 则列入影响 |
| P4 — Anomaly & Discovery（D16） | Observation 不依附 Hypothesis、失配识别、LLM 可插拔审查和候选研究路线 | 未复核 observation 不自动证伪；无新信息的重复审查去重/限预算 |
| P5 — Impact / Replay | Concept Revision、Argument、Observation、Anomaly、债务均可 replay | 旧证明历史不消失；新术语定义变化触发定向影响 |
| P6 — Context / Frontier | 已接纳 Fact、证明证书、未解释 Observation、矛盾和未闭合债务编译 | 缺少必需 Scope / 术语版本时 fail-loud，不能静默丢掉义务 |
| P7 — Legacy | C-/F-/REL- 历史迁移、11 tool 权限/GUI 基线 | 旧 Fact 不自动升级为新事实认证，计划治理不被知识写口绕过 |

**首个综合用例（建议）**：电子光学近壁场和束流传输。在 Theory 模型中的理想 Hamiltonian 论点、Simulation 层 BEM/AMReX 数据、Engineering 实验/校准中明确绑定术语、数值误差和应用 Scope。补充 **A+C→B；C 校准失配；B 独立实验成立** 的异常/替代机制 H2 场景，以及一条 Lean 的严格 Theory→Theory 证明路径。

## 12. 分阶段升级构想（仅讨论）

1. **S0：语义基础与 PoC**：先确定开放 WorldType/Concept Registry、有限 TypedFormula、Inference Schemes、四轴分类和强制但非阻碍义务；以 P0a/P0b/P0c/P1/P2 为重点。
2. **S1：Strict Formal Core**：Euler 式精确内容身份、Lean/证书、形式化术语对应、前提闭包和定向重检。
3. **S2：Epistemic & Observation Core**：独立 Observation、Evidence、Assessment、FactDesignation、多支持路径与 Assumption Debt。
4. **S3：Anomaly & Continuity**：Anomaly Registry、双空间探索、Frontier、Failure Memory、Context Compiler、可插拔交互检查。
5. **S4：DSH Governance Integration**：版本化 tools/RPC、术语纪律端口、UI、dsh-agent-team 纪律/权限接管与计划治理。
6. **S5：Domain Profiles & Long-run Recovery**：数值收敛、实验校准、模型有效性、数字孪生、长程科研会话与快照恢复。

上述顺序是讨论建议，S0 后仍需裁决。严格数学验收应独立达到可证明的强度，不能以“已有宽松论证图”替代 Euler 式可靠证明机制。

## 13. 决策登记与待裁决问题

### 13.1 已同意的原则性决策（2026-10-18；尚未转成冻结 ADR）

| ID | 已同意内容 | **尚未**批准的细节 |
| --- | --- | --- |
| **D13** | 不以 Theory/Simulation/Engineering 封闭枚举世界；应支持未来增加类型、注册规则，处理多种重要语义鸿沟 | 种子类型集、继承算法、类型/表示/Scope 的最小接口 |
| **D14** | 维护 L0 基础、L1 领域、L2 Project 概念表；正式对象引用词汇表或登记新术语；保留自然语言+规范含义+检索/Lean 链接；术语变更视作科研事件；纪律检查可插拔 | 审批角色、语义修改权限、检索索引方案、插件执行模式 |
| **D15** | 跨世界义务必须生成且可追溯，但不因此全面阻断带明确假设的科研探索 | 哪些义务阻止哪种正式验收或现实操作、债务传播与例外治理 |
| **D16** | 自动/定期检查失效证据、前后结论成立但原推理失败、理论解释不了的观察；维护持久化异常与矛盾库，借鉴双空间探索 | LLM 审查周期、异常质量门槛、去重、误报复核及成本控制 |
| **Inference Classification** | 采用正交维度：推理方法 × 逻辑强度 × 验证状态 × 证据关系；支持演绎、归纳、统计、溯因、类比、因果、默认/可废止、实践决策；经验支持和无已知反例不混同为归纳证明 | 最小 Scheme 接口、组合关系、Critical Questions、领域规则包 |

**合意范围**：是对架构方向的裁决，不构成生产接口、字段、风险动作表或集成里程碑的批准。Draft PR 保持 Draft，旧 V1 冻结契约不受本文件更改影响。

### 13.2 原有 D1–D12（待裁决的实施语义）

| ID | 尚需裁决的细项 | 建议 / 约束 |
| --- | --- | --- |
| D1 | WorldKind 的最小类型和上下文注册方式（以 D13 的开放注册原则为前提） | 参考 §3 多轴类型，禁止三值枚举写死 |
| D2 | TypedFormula 最小 AST 与不透明谓词、词汇覆盖范围 | 先有限谓词语言 + Concept 版本；不透明内容产生义务 |
| D3 | 严格与可修正 Argument 的共同数据契约（分类采用已同意的正交轴） | 两类推理共用结构，但不能互相冒充 |
| D4 | 哪些 Theory→Theory 场景必须尝试 Lean | 证明证书是强保证；允许条件性研究 |
| D5 | 自然语言—Lean 精确命题的对应关系及审查主体 | 记录对应版本，防止编译成功被当作物理真理 |
| D6 | 类型错误与未闭合义务的不同策略 | 结构认证不可绕过；带明示债务允许探索 |
| D7 | Fact 接纳/暂停/撤回主体及授权策略 | 默认显式项目接纳，不能由 LLM 自述自动产生 |
| D8 | Project 级知识、Workstream 级行为与跨域引用 | 需设计双维事件归属及历史迁移 |
| D9 | 冲突评价、证据独立性和是否采用数值概率推理 | 不引入未经校准的通用真理分数 |
| D10 | dsh-agent-team、Discipline/Discovery、审批与快照边界 | 控制面出具候选、执行面承担运行 |
| D11 | V3 破坏性迁移与 Legacy Replay | 旧事件保留，旧 Fact 不无条件升格 |
| D12 | Euler 实现复用的代码来源与许可 | 逐文件审查，优先独立 TS 重写算法思想 |

### 13.3 从 D13–D16 导出的新增开放问题

| ID | 待研究问题 |
| --- | --- |
| O1 | 类型继承是否只服务概念组织？若引入规则继承，如何防止自动 World cast？ |
| O2 | Concept Registry 与 TypedFormula 的最小事务边界是什么？如何定义概念合并、拆分和弃用？ |
| O3 | Discipline OFF 模式下保留哪些强制语义完整性门？与 dsh-agent-team 的治理等级怎样对应？ |
| O4 | 一个 Argument 具有多个替代证据路径时，Assumption Debt 以何种 DAG/ATMS 形式表达？ |
| O5 | “义务未满足但允许继续”分别适用于探索、论文表述、正式科研验收、工程操作的哪些边界？ |
| O6 | 异常的假阳性、重复审查与长期激活怎样限频？观察质量未审查时如何防止错误升级为反例？ |
| O7 | Hypothesis / Observation 双空间和现有 Assertion / Evidence 的引用关系如何高效索引？ |
| O8 | 多轴推理方法的可扩展类型规则、Critical Questions 与实际验证器如何对接？ |

## 14. 参考与代码定位

**当前项目：**
- [ARCHITECTURE.md](../../ARCHITECTURE.md)：V1 架构、不变量、控制边界。
- [DOMAIN_SCHEMA.md](../../DOMAIN_SCHEMA.md)：现有 Claim/Fact/Artifact/Relation、Task/Gate/Run 等定义。
- [HISTORY_EVENT_CATALOG.md](../../HISTORY_EVENT_CATALOG.md)：20 类冻结科研事件。
- [PLAN_FORK_SPEC.md](../../PLAN_FORK_SPEC.md)：Agent 提案与用户 canonical plan 控制。
- [src/host/domain/semantics](../../src/host/domain/semantics)：当前语义 reducer、状态机与关系合法性。
- [docs/TOOLS_TRACEABILITY.md](../TOOLS_TRACEABILITY.md)：11 个研究工具及 G5 验收记录。

**扩展参考资料（借鉴思想，不表示论文的 benchmark 等于我们的科研正确性验证）：**
- [SHELDON: Reasoning through Dual Search over Hypothesis and Observation Spaces](https://arxiv.org/abs/2610.18025) · [Stanford OVAL 实现](https://github.com/stanford-oval/sheldon)：假设与观察独立搜索、未解释现象与新路线。
- [W3C SKOS Reference](https://www.w3.org/TR/skos-reference/)：概念 ID、标签、同义词与词汇管理。
- [QUDT](https://qudt.org/)：量、单位、量纲与科学本体词汇的参考。
- [Assumption-based Truth Maintenance System (ATMS)](https://en.wikipedia.org/wiki/Assumption-based_truth_maintenance_system)：支持路径、假设环境及非单调变更的理论来源；具体实现需另行研究。
- Toulmin argument model、Walton argumentation schemes/critical questions：支持、限定、反驳与按推理方法生成审查问题的启发。

**Euler 公开设计与实现（参考思想，不声明直接复用代码）：**
- [Euler ARCHITECTURE](https://github.com/canghaimeng/Euler/blob/main/ARCHITECTURE.md)
- [Euler core DATA_MODEL](https://github.com/canghaimeng/Euler/blob/main/euler/core/DATA_MODEL.md)
- [Euler factgraph.py](https://github.com/canghaimeng/Euler/blob/main/euler/core/factgraph.py)
- [Euler control contracts.py](https://github.com/canghaimeng/Euler/blob/main/euler/control/contracts.py)
- [Euler control obligations.py](https://github.com/canghaimeng/Euler/blob/main/euler/control/obligations.py)
- [Euler control context.py](https://github.com/canghaimeng/Euler/blob/main/euler/control/context.py)
- [Euler licensing](https://github.com/canghaimeng/Euler/blob/main/LICENSING.md)：Euler 原创部分为 PolyForm Noncommercial；不同来源文件需逐项核对，本文未复制其实现。

---

**讨论稿边界声明**：本文只建立“可审查的候选总体架构”。已认可 D13–D16 及推理分类原则，但没有冻结实现。未来若决定实施，应先拆分为已裁决 ADR、数据模型与形式化规则规范、PoC 验收计划和阶段 PR。未经批准不得将本文冒充已冻结 V3 规范，也不得直接改变现有运行时语义。
