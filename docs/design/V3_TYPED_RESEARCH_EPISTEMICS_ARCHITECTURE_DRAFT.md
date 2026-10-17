# dsh-research-control V3：Typed Research State & Epistemic Reasoning Architecture

> **Status: DRAFT / Discussion Baseline — 非规范性、尚未裁决、不得据此直接实施**
>
> 日期：2026-10-18  
> 目标仓库：ArmourPiercer1/dsh-research-control  
> 起始代码基线：main @ 8b910513e188db5aac08b8840756f2f25b8028d4  
> 变更性质：仅设计文档；不修改运行时、V1 冻结契约、Schema、RPC、工具定义或现有数据库。
>
> **重要**：本文是下一轮架构评审的整体讨论基线，而不是已经批准的 ADR、实施方案或 V3 API 契约。所有类型名、字段、规则 ID、状态名、迁移顺序均为候选；除“设计目标与约束”外，其余内容需要进一步裁决。请勿把本文的草案性状态机当作生产事实。

## 0. 摘要与设计动机

当前 dsh-research-control 已经具有 Project / Topic / Workstream、Future Plan、Run、Fact / Claim / Artifact / Relation、ResearchHistory、PlanFork、Intervention、Git / SQLite、11 个研究工具等基础设施。但当前 Fact / Claim 主要是 Workstream-local 的语义标签，不是完整的科研论证或可验证知识结构：Fact 在现行 V1 中恒为 ACTIVE；Relation 只保存直接的二元关联；系统刻意不检验科研推理的内容。这些设计对于工作流原型合理，却不足以支撑跨越许多轮 Agent 会话的科研认知演化。

Euler 的严格事实依赖、验证接纳、Research Graph、Frontier 和 Context Compiler 值得继承。然而 **V3 目标是增强 Euler，而非将其形式化证明机制泛化、降格为宽松的观点记录器**：

1. 所有正式 Assertion 必须显式标识所处的 **Theory / Simulation / Engineering** 等语义世界及其具体上下文；这是底层类型系统，不是少数特殊 Argument 的附加字段。
2. 所有正式 Argument 都使用统一的 **类型化谓词/推理表示**，记录前提、量词/变量绑定、规则、结论、Scope 与待证义务，并执行确定性风险检查。
3. **Theory → Theory** 等可形式化子图应继承 Euler 的严格依赖机制；在条件允许时，Lean 内核检查及其证书应作为极强的演绎有效性证据，不能与一般 LLM 审阅等同。
4. **Theory / Simulation / Engineering** 之间不允许隐式语义强制转换；跨世界推理必须生成适用性、实现一致性、数值误差、校准或现实验证等对应义务。这里的“模型—现实桥接”是统一类型系统中的基本检查规则，**不是特设的 BridgeArgument 类**。
5. 工程 Fact 表示项目在特定范围内基于现有证据和责任主体评价所正式接纳的高可信论点，不代表客观真理保证；新证据可以加强、质疑、暂停、替换原有支持路径。
6. **严格推理的依赖失效**与**科研结论的认知退化**必须区别处理。理论解释错误不能自动抹除独立实验证据所支持的工程性能事实。
7. 保留科研工作控制面与执行编排的边界：本项目管理科研认知和研究状态；DSH / dsh-agent-team 负责 Agent 生命周期、权限、资源与执行。验证器提供证据和证书，不接管项目认知治理。

**一句话定位**：一个保留严格形式化数学能力、在统一语义类型约束下延伸到仿真与现实工程的、可修正的科研状态与推理控制面。

### 0.1 本稿中的确认程度

| 分类 | 内容 |
| --- | --- |
| 讨论中已明确的目标 | 以 Euler 为增强基线；所有 Assertion 显式 Theory / Simulation / Engineering 上下文；Argument 谓词逻辑化与危险推理自动检查；Lean 对可形式化理论证明的重要性；工程 Fact 的可修正性 |
| **本文的设计建议，尚待裁决** | 稳定 Assertion 与 Revision 分离；Argument/Assessment 一等实体；三维 Fact 投影；规则化 Proof Obligation；知识项目级共享；旧数据迁移策略；验证网关与调度接口 |
| **明确未决** | 本体类型最小集合、谓词语言复杂度、何时强制 Lean、Lean 形式化对应审查权、跨域风险的阻断阈值、Fact 接纳授权、自动复审算法、跨项目知识复用 |

## 1. 设计目标、约束与非目标

### 1.1 系统必须能够可靠回答

- **What is asserted?** 我们讨论的具体命题、量词、条件和作用对象究竟是什么？
- **In which world?** 命题在某数学模型、数值实现，还是某个现实工程配置中成立？
- **By what inference?** 哪些前提以什么规则、变量绑定和解释支持结论？
- **How was it checked?** 哪些演绎步骤有严格证书，哪些仅为经验支持，哪些仍有缺口？
- **What is accepted now?** 项目当前把哪些 Assertion 作为可用 Fact，其接纳决定和限制是什么？
- **What changed?** 新数据、反例、模型修正或程序升级具体影响了哪些依赖、论证和结论？
- **What is next?** 当前尚未解决的问题、风险义务、替代研究路线及 Agent 可复用上下文是什么？

### 1.2 不变量候选（INV-V3-*，命名待批准）

1. **INV-V3-WORLD**：任何正式 AssertionRevision 都有至少一个具体 WorldBinding；不能省略世界并默认为现实。
2. **INV-V3-NO-IMPLICIT-CAST**：理论、仿真、工程语义世界间没有隐式转换；跨世界结论必须列出具体规则与未闭合义务。
3. **INV-V3-EXACT**：命题的自然语言陈述、逻辑表达、Scope、对象版本均可追溯；语义修改生成新 Revision，不原地覆写。
4. **INV-V3-ARGUMENT**：正式 Argument 明确引用前提、规则、结论和变量绑定；类型检查结果与科研判断结果分离。
5. **INV-V3-FORMAL**：形式化证明只认证精确形式化命题及已声明的定义、公理/依赖；不得自动提升为现实适用性证据。
6. **INV-V3-EVIDENCE**：Artifact、Evidence、Argument、Assessment 语义独立；不存在“文件存在即结论成立”的推理捷径。
7. **INV-V3-FACT**：FactStanding 是有来源和策略的认知接纳，不是命题永久属性；接纳与撤销历史不删除。
8. **INV-V3-IMPACT**：依赖变化触发可审计的影响分析；只有确定性的证书/版本/引用状态可以自动失效，科学结论不能无条件级联撤销。
9. **INV-V3-PLAN**：ResearchRoute 不等于 canonical Future Plan；Agent 可提出科研路线，不能通过知识图绕过用户的 PlanFork 约束。
10. **INV-V3-REPLAY**：科研认知与研究义务的运行状态能够从不可变事件流确定性重建；派生索引不是第二套真源。
11. **INV-V3-UNKNOWN**：未审查条件、不可解析形式化片段、未校准不确定度等必须显式表示为未知，不能静默视作已满足。
12. **INV-V3-NO-FAKE-PROOF**：类型化谓词外壳不意味着定理已被证明；只有经相应可信验证器验收的完整证明才能标记为 FORMALLY_PROVED。

### 1.3 本轮非目标

- 取代 Lean/数学证明器、数值求解器、实验测量设备或人为科研判断。
- 构建可自动发现现实世界全部隐含变量的万能因果推理器。
- 把所有证据压缩到一条可加总的概率或“真实性分数”。
- 在本 PR 中修改数据库、迁移生产数据、注册新工具、变更权限或接入真实验证器。
- 直接搬运 Euler 中受限制许可约束的实现代码；需逐文件核对许可证与来源。

## 2. 总体职责分层

~~~text
Human / Research Agents / dsh-agent-team
       │ propose / query / review / execute
       ▼
┌─────────────────────────────────────────────────────────────┐
│ dsh-research-control                                       │
│  A. Typed Research Knowledge                               │
│     World Registry / Assertion / Evidence / Argument       │
│     Assessment / FactStanding / Impact Graph               │
│  B. Research Reasoning & Planning State                     │
│     ResearchQuestion / ResearchRoute / Frontier            │
│     Context Compiler / Failure Memory                      │
│  C. Existing Workflow Governance                           │
│     Project / Topic / Workstream / Task / Gate / PlanFork   │
│     Run / Intervention / Brief                              │
│  D. Shared Infrastructure                                  │
│     IDs + Revision / Events + Replay / Git + SQLite         │
│     Provenance / Versioned Query / Permissions             │
└───────────────────────────┬─────────────────────────────────┘
                            │ typed verification requests / receipts
                 ┌──────────┼──────────┐
                 ▼          ▼          ▼
                Lean    Numerical   Experimental
              / kernel   checkers     / reviews
~~~

- **Knowledge Plane** 持有科学论点、证据与认知接纳记录，但不宣称自身掌握物理真理。
- **Reasoning Plane** 持有开放研究问题、候选路线、依赖义务和下一步科研上下文，不必启动 Agent。
- **Workflow Plane** 保留人类对正式计划与项目治理的控制；科学推理与执行计划严格分离。
- **Verification Adapters** 返回限定范围内的可审查证书、计算结果或报告，不直接写入项目 FactStanding。
- **DSH / dsh-agent-team** 仍负责 Agent 运行、工具可见性、审批、资源、隔离与实际任务调度。

以上是逻辑分层，**不规定必须实现为独立进程或独立数据库**。

## 3. 世界类型系统：底层抽象，而非特例 Bridge

### 3.1 World 与 Context

所有正式 AssertionRevision 均应绑定一个或多个明确语义世界：

| WorldKind | 表示对象 | 最低必要上下文 | 常见验证来源 |
| --- | --- | --- | --- |
| THEORY | 数学体系、理论物理模型、理想化动力学 | 模型/定义版本、公理与假设、参数域、坐标/单位约定 | 逻辑推导、Lean、解析推导、数学证书 |
| SIMULATION | 求解某模型的特定数值实现与结果 | 模型目标、代码/求解器版本、输入哈希、离散化、计算条件 | 收敛分析、测试、独立求解器、误差界 |
| ENGINEERING | 现实物理装置、物理过程或实际工程行为 | 装置/配置/工况、测量协议、时间、误差/校准定义 | 实验、现场监测、标定、经验模型检查 |

**WorldKind 不是置信度阶梯**。SIMULATION 不天然介于 THEORY 与 ENGINEERING 之间；同一世界类型内部的不同 Context 也不得默认等同。

例如，Theory(M0：忽略空间电荷) ≠ Theory(M1：含空间电荷)；Simulation(S1：某算法/网格) ≠ Simulation(S2：另一次运行)；Engineering(E1：实际机器配置 A) ≠ Engineering(E2：配置 B)。

WorldBinding 推荐包含：world_kind、context_id、context_revision、subject_ref、definitions_ref、assumptions、parameter_domain、unit/coordinate conventions、known_unknowns。具体最小必填字段仍待决定。

**多世界 Assertion** 合法，例如“Simulation S 与 Engineering E 在量 X 上的一致性误差不超过 ε”。但这类命题必须在逻辑 AST 中引用具体两个世界，不能用模糊的 CROSS_DOMAIN 标签掩盖差异。

### 3.2 Scope 与开放世界假设

ResearchScope 是精确命题版本的一部分，至少允许声明：量词、对象、单位、参数域、运行与测量条件、模型假设、观测窗口、不确定度/容差、未知条件。

- Scope 可以不完整，特别是在探索初期。
- **未知必须显式记录**；没有写下限制 ≠ 已证明不存在限制。
- 推理不能静默扩大 Scope、扩大参数区间、混淆点态与总体性质。
- Scope 相容性判断应报告 EXACT / COMPATIBLE_UNDER_ASSUMPTIONS / UNKNOWN / INCOMPATIBLE 及依据；不能只用字符串相等判定科学等价。

### 3.3 Typed Proposition：双重可读性

每个 AssertionRevision 保存：
1. 研究人员可读的原始 statement；
2. 机器可检查的逻辑表达（可能部分形式化）；
3. 绑定的 World 与 Scope；
4. 明确的形式化覆盖程度与不可解析片段。

草案类型，仅作为语义示意，不构成 TS API：

~~~typescript
type WorldKind = "THEORY" | "SIMULATION" | "ENGINEERING";
type FormalizationCoverage = "STRUCTURED" | "RULE_CHECKABLE" | "FORMALIZABLE" | "KERNEL_CHECKED";

interface WorldRef {
  kind: WorldKind;
  contextId: string;
  contextRevision: string;
}

interface AssertionRevision {
  assertionId: string;            // stable logical identity
  revisionHash: string;           // immutable semantic content identity
  statement: string;              // exact human-readable assertion
  proposition: TypedFormula;      // AST; may carry explicit opaque predicates
  worlds: WorldRef[];             // nonempty; explicit
  scope: ResearchScope;
  semanticKind: string;          // observation / mechanism / theorem / engineering claim ...
  formalizationCoverage: FormalizationCoverage;
}
~~~

TypedFormula 至少需要可表示：Atom / Predicate、类型化变量和常量、相等及比较、合取/析取/否定、量词、蕴涵、数值关系和显式不透明谓词。

初期不要开发完整交互式定理证明器：建议最小 typed AST + **可扩展规则注册表** + Lean 外部证明端口。类型系统至少应能识别实体种类、物理量维度/单位、坐标约定、世界身份和变量绑定。没有完整形式化时，机器保证仅限已经实际检查到的部分。

## 4. 科研知识对象及身份

| 对象 | 含义 | 关键关系与生命周期 |
| --- | --- | --- |
| Assertion + immutable Revision | 被提出的精确科研论点 | 稳定逻辑 ID / 修订哈希；归属 World + Scope |
| Artifact | 数据、代码、图表、报告等外部产物的载体 | URI、内容哈希、生产 Run、版本 |
| Evidence | 对观测/计算/证书结果的科研记录 | 引用 Artifact；含方法、条件、结果、局限与来源 |
| Argument | 类型化前提 → 结论的论证单元 | 引用 AssertionRevision 与 Evidence；声明规则、绑定、义务 |
| Assessment | 对 Assertion、Evidence 或 Argument 的一次有主体评价 | 追加记录，允许不一致的意见和后续修正 |
| FactDesignation / FactStanding | 指定项目/Scope 下正式接纳某 Assertion 的决定与现态 | ACTIVE / SUSPENDED / WITHDRAWN 等；不等于客观真值 |
| ResearchQuestion | 研究中试图回答的问题 | 可以产生多条 ResearchRoute、多个子问题与结果 |
| ResearchRoute | 针对问题的候选方法和条件依赖 | 开放、阻断、暂停、已检查等，不是执行 Task |

### 4.1 为什么 Assertion 与 Fact 不能是两种互斥实体

“最初为 Claim、后被接纳为 Fact、再受到挑战、随后恢复”是**同一科学命题的认知变化**，不应因此无限复制 statement。

- Assertion ID 表示持续存在的研究论点。
- AssertionRevision 的哈希表示精确命题（包括 World/Scope/定义版本）。
- FactDesignation 是有明确评价主体、接纳依据和时间的决策记录。
- 旧版 Claim/Fact 可迁移为历史来源记录；**旧 Fact 登记不能自动取得 V3 证据门下的已接纳身份**。

### 4.2 认知状态不是单一线性状态机

建议至少区分以下正交投影：

| 维度 | 建议示例 | 约束 |
| --- | --- | --- |
| DeductiveValidity | NOT_APPLICABLE / UNCHECKED / RULE_CHECKED / KERNEL_PROVED / INVALID / STALE | 必须附带精确命题与证书版本；KERNEL_PROVED 仅限其检查范围 |
| ScientificSupport | UNASSESSED / SUPPORTED / MIXED / UNDERMINED / INCONCLUSIVE | 由证据和评价构成，不是假定可计算的客观概率 |
| FactStanding | NONE / ACTIVE / SUSPENDED / WITHDRAWN | 项目接纳，允许从争议中恢复 |
| ReviewState | CLEAR / REVIEW_REQUIRED / UNDER_REVIEW | 可以与 ACTIVE FactStanding 并存 |

例：某工程性能 Assertion 可以当前 MIXED + ACTIVE + REVIEW_REQUIRED：新证据挑战原有解释，但独立性能实测仍有效，尚未撤销项目接纳。

**防止误解**：FORMALLY_PROVED 不自动导致 ENGINEERING Fact ACTIVE；一次工程反例不自动否定某精确定义下的 Lean 定理。自然语言—形式化命题对应关系仍可能出错。

## 5. Typed Argument Kernel（建议的 V3 核心创新）

### 5.1 统一 Argument 结构

Argument 是引用具体 AssertionRevision 的**有向超边**，而不是简单的 SUPPORTED_BY 二元关系：

~~~typescript
interface Argument {
  id: string;
  revisionHash: string;
  premises: AssertionRevisionRef[];  // jointly required premises (AND)
  evidenceRefs: EvidenceRef[];
  conclusion: AssertionRevisionRef;
  inferenceMode: "DEDUCTIVE" | "DEFEASIBLE";
  ruleId: string;                     // registered inference / transfer rule
  bindings: TypedVariableBinding[];   // quantifiers, substitutions, world object binding
  assumptions: TypedFormula[];
  proofObligations: ProofObligation[];
  justificationRefs: string[];
}
~~~

- 一条 Argument 内多个必需前提采用 AND 语义；同一个结论可被多个替代 Argument 支持（OR 支持路径）。
- Argument 可以支持或攻击结论，也可以**攻击另一条 Argument 的规则/适用性（undercut）**。
- 区分“反对结论本身的证据（rebuttal）”与“破坏当前解释路径的证据（undercut）”。
- 科学论证网络允许候选循环关系，但规则检查应识别循环证据、自我支持和虚假独立性；严格演绎证明子图需要遵守证明环境的相应依赖条件。
- 不把所有 Evidence 自动视作证明前提：例如数值输出属于观测证据，使用它证明一般性数学命题需要额外合法推理。

### 5.2 两种推理判断必须区分

在给定世界 W 与证明环境 Γ 中的严格推导：

~~~text
Γ ⊢[W] φ        // proof obligation with explicit rule and conditions
~~~

在给定世界、证据和已知限制下的经验支持：

~~~text
(Γ, Evidence) ~>[W] φ    // defeasible support, not logical entailment
~~~

两者共享 Assertion、World、Scope、Provenance 和 Argument 框架，但验证和传播语义不同。**统一 API 不等于统一真理强度**。

### 5.3 类型检查与验证流水线

每条正式 Argument 建议走以下阶段：

1. **Shape & identity**：对象/修订引用、角色、事件来源、规则 ID、哈希合法。
2. **Symbol & formula**：变量绑定、量词作用域、谓词签名、实体类型、单位/量纲/坐标兼容。
3. **World & scope**：前提及结论的具体 World 一致性、参数域包含关系、跨世界引用。
4. **Rule obligations**：检查是否有对应推理规则、前提完备性、缺失的侧条件；**Theory → Engineering 必须默认高风险**。
5. **Formal verification**：符合条件时调用 Lean / 符号证明 / 受信任证书；精确记录检查范围。
6. **Scientific evaluation**：证据适用性、独立性、模型与现实一致性、经验支持等——允许产生 OPEN / UNKNOWN。
7. **Admission decision**：按照治理策略接受其某项结果作为项目当前 Fact 的支持，不绕过人工授权。

返回值不采用单一 safe / unsafe，而是结构化报告：

~~~typescript
interface ArgumentCheckReport {
  structuralCheck: "PASS" | "FAIL";
  typeCheck: "PASS" | "FAIL" | "UNKNOWN";
  ruleCheck: "PASS" | "FAIL" | "OPEN";
  formalProof: "NOT_APPLICABLE" | "UNVERIFIED" | "KERNEL_PROVED" | "FAILED";
  domainApplicability: "CONFIRMED" | "UNASSESSED" | "CONTESTED" | "INCOMPATIBLE";
  hazards: InferenceHazard[];
  obligations: ProofObligation[];
  checkedAgainst: string[];  // rule versions, world revisions, certificate hashes
}
~~~

实际字段与枚举暂不冻结；关键是把**机械检查、形式证明和科研评价**保持独立。

### 5.4 危险推理检查：建议初始规则

| Rule ID（草案） | 检测内容 | 默认响应 |
| --- | --- | --- |
| H-WORLD-001 | 从 THEORY 前提直接断言 ENGINEERING 事实且无明确跨世界义务 | 高风险；不可标记已完成的严格论证 |
| H-WORLD-002 | SIMULATION 输出被默认为真实装置表现 | 要求模型适用、数值误差与现实验证义务 |
| H-WORLD-003 | 不同版本 THEORY / SIMULATION / ENGINEERING 混用 | 要求等价/兼容或相应转换义务 |
| H-LOGIC-001 | 前提缺失、未绑定变量、量词/作用域非法 | 机械拒绝 |
| H-LOGIC-002 | 有限数值实例被直接泛化为全称理论定理 | 拒绝严格证明标记；产生一般化义务 |
| H-SCOPE-001 | 推理扩大参数域或改变测量/误差定义 | 要求显式范围论证 |
| H-UNITS-001 | 单位、量纲、坐标或参考系不兼容 | 机械拒绝或要求显式转换 |
| H-DEPEND-001 | 以循环论证或重复证据冒充独立支持 | 提示审查，不自动累计支持强度 |
| H-FORMAL-001 | Lean 证明的形式化命题与目标 Assertion 无对应性审查 | 不能宣称原自然语言论点已由 Lean 保证 |
| H-VALIDITY-001 | 已失效的 Artifact、规则、证书或前提修订仍被使用 | 标记失效并阻止复用为当前严格证据 |

**注意：即使所有前提和结论都在 ENGINEERING 世界，系统也不保证推理安全**。跨世界检测是必要但不充分的检查。静态规则无法识别所有现实世界中未被发现的隐含变量，不能将“没有已知 hazard”解释成“科学正确”。

### 5.5 Model-to-Reality 是通用规则层问题

不定义 BridgeArgument 子类。跨世界推理是统一 Rule Registry 处理的世界关系：

- THEORY(M) → THEORY(M')：模型、定义、公理与参数映射；
- THEORY(M) → SIMULATION(S)：目标方程、离散化、数值实现和误差/一致性；
- SIMULATION(S) → ENGINEERING(E)：模型适用、装置配置、测量协议、数值和实验验证；
- THEORY(M) → ENGINEERING(E)：上述必要链条与现实有效性义务的组合；
- ENGINEERING(E) → THEORY(M)：有限观察不能直接推出模型普适定理；
- 同世界跨配置/版本：仍须证明适用范围相容。

**跨世界义务是可版本化的 ProofObligation**：例如 MODEL_ADEQUACY、IMPLEMENTATION_CONFORMANCE、NUMERICAL_ERROR_BOUND、PHYSICAL_VALIDATION、SCOPE_COMPATIBILITY、UNCERTAINTY_PROPAGATION。满足条件的证据通过它们连接不同世界，但没有一个通用单按钮可以证明“理论对应现实”。

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

## 7. Evidence、Assessment 与可修正 Fact

### 7.1 Artifact ≠ Evidence ≠ Argument

- **Artifact** 是文件、数据集、程序、报告或证书的持久引用。
- **Evidence** 记录从若干 Artifact / 观测 / 计算中得到的结果、协议、Scope、误差和局限。
- **Argument** 说明 Evidence 如何在规则和条件下支持、反驳或解释特定 Assertion。
- **Assessment** 记录某个审查主体如何评价 Evidence / Argument / Assertion。

同一实验数据可以支持一种性能现象，同时攻击某个解释模型。数据正确保存、可复现、能够支持特定结论，是三件不同的事。

### 7.2 Assessment 与 Fact 接纳

项目可正式接纳某个 AssertionRevision 为 Fact（附 Scope / 评估依据 / 接纳主体 / 决定时间），但此状态是可修正的。推荐当前认知投影独立保留：

- **DeductiveValidity**：形式化推理的证书与依赖状态；
- **ScientificSupport**：实验、计算、经验评价对论点的支持态势；
- **FactStanding**：项目是否正式将其作为可用科研前提；
- **ReviewState**：是否有新证据促使重新审查。

不强制把所有证据映射为单个置信度分数；非独立重复观测不能简单叠加概率。未来可在特定领域注册贝叶斯、统计或误差模型，但必须声明条件和校准依据。

### 7.3 非单调变化与影响传播

新证据/新模型可能加强或削弱 Argument，不直接删除 Assertion。

**通用流程**：

1. 创建新 Evidence / AssertionRevision / Argument 或审查记录；
2. 检测版本、规则、证书和引用的确定性变化；
3. 追踪受影响的 Argument（包括 support、rebuttal、undercut、explains）；
4. 对严格证明路径重新检查其前提与证书有效性；
5. 对科研解释或工程结论提出 Assessment / Review obligation；
6. 由有权主体决定是否维持、暂停或撤销 FactStanding；
7. 全程保留历史，更新 Frontier 与后续上下文。

**绝不可将某理论解释的失败，等价为所有受其解释的独立实验结论被证伪。**

示例：实验 E1 直接支持工程性能 P；机制 H1 被新结果推翻；H1→P 这条解释路径退化，但若 E1 的处理和校准并不依赖 H1，P 仍可能保留 FactStanding=ACTIVE。随后 H2 可成为新的解释路径。反过来，若 E1 的数据反演实际依赖 H1，则 E1 也必须进入影响分析，而不能机械标记“实验永远有效”。

## 8. ResearchQuestion / ResearchRoute / Frontier

这部分借鉴 Euler 的 Obligation / Route / Frontier，但不把研究问题等同于数学证明义务。

| 实体 | 作用 |
| --- | --- |
| ResearchQuestion | 要调查/解释/证实/否定/优化/比较的研究问题 |
| ResearchRoute | 可能的研究方法、必要子问题、证据要求与失败条件 |
| ProofObligation | Argument 规则和跨世界转换产生的明确待验证条件 |
| Frontier | 由当前研究状态投影出的开放问题、证据缺口、争议与复查需求 |

- 单条 Route 所要求的若干子义务可以 AND 组合，替代 Routes 可以 OR 并存。
- Route 的前提满足最多产生 READY_FOR_REVIEW，不应自行认定最终研究问题已解决。
- 完成 Task 不是完成研究问题；问题可能在新的证据出现后重新开放。
- 对失败分类必须区分 INFERENCE_INVALID、COUNTEREXAMPLE、MODEL_MISMATCH、NUMERICAL_INCONCLUSIVE、INFRA_FAILURE、BUDGET_EXHAUSTED、MISSING_EVIDENCE 等；计算失败不能误报科学反例。

### 8.1 Context Compiler 与长程 Agent

Context Compiler 产生带来源和版本的最小充分上下文：目标问题、精确命题、相关 World / Scope、必要前提与证明证书、支持/反驳、已知失败、开放义务、当前 FactStanding。

- 必需的逻辑前提、量词/Scope、world IDs、版本和证明引用**不可静默截断**。
- 次要历史、可展开的长证明和大文件使用引用与省略清单。
- 若必需上下文缺失、过期或超出预算，显式返回缺口或推迟任务，不编造完备上下文。
- 保留 Euler 的结构化 failure recall、frontier-driven work 和跨轮可复现上下文。
- **Research Control 输出 candidate work + context；DSH/dsh-agent-team 决定谁执行、权限、预算、何时运行**。

## 9. 与现有 V1/V2 代码和治理的映射

本稿拟利用已有工作，而不是插入平行的 Euler 数据库：

| 当前对象或模块 | V3 处理建议 | 理由 |
| --- | --- | --- |
| Project / Topic / Workstream | 保留组织归属 | 与科学论点所属世界不同 |
| Claim / Fact（semantics） | 迁移为 Assertion / Revision / Assessment / FactDesignation | 当前 Fact 永久 ACTIVE，无法表达认知退化 |
| Artifact / Run | 保留并强化 Provenance；新增 Evidence | 产物不同于科学证据 |
| Relation | 执行/组织关系保留；科学推理关系迁入 Argument 超边 | 二元关系不能表达规则、条件、AND / OR、undercut |
| Objective / Task / Gate / Milestone | 保留独立工作流语义 | Task 完成不等于科学定理证明 |
| PlanFork | 保留用户控制的 canonical plan 提案 | Agent 新建 ResearchRoute 不得变更 canonical plan |
| ResearchHistory | 扩展项目级科研事件 + 现有 Workstream 运行事件 | 跨 Workstream 共享科研知识、追踪多来源 |
| Derived Blocker / Intervention / Brief | 扩展为知识影响、复审与科学状态投影 | 不等同于直接科学真值 |
| src/host/domain/semantics | 重构或新增 world/assertion/argument/assessment 纯领域层 | 保持无 DSH 直接依赖 |
| src/host/service/semantics | 扩展科研知识读写/验收服务 | 复用现有审计与事件追加习惯 |
| src/host/history / persistence | 增加 typed event schema、replay/projection、完整性检查 | 同一历史真源 |
| src/host/tools / dsh-adapter | 后续添加版本化查询和候选提交工具 | 不在本 PR 修改冻结 11-tool 面 |
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

- Research Agent 可以提出 Assertion、ResearchQuestion、ResearchRoute、候选 Argument、Evidence 和 Assessment 建议。
- 类型/规则检查服务只登记其**实际检查结论**，不能凭 Agent 自述写入 KERNEL_PROVED。
- 指定的验证服务经身份/结果校验提交证书、可复查结果和错误码。
- FactStanding 的项目级接纳/暂停/撤回按照显式授权与审查策略进行；**第一版默认不设置全局自动升格器**。
- Agent 不能凭知识写口改写 canonical plan、用户决定、其他 Agent 权限或原始审计历史。
- 后续与 dsh-agent-team 的 externalHard / approval 等治理机制对接需要专门接口设计，不在本设计稿中假定已实现。

### 10.2 持久化原则

- **Git**：低频、可读的项目政策、研究语义定义、治理契约和正式声明式配置。
- **SQLite event store**：科研对象提交、修订、Argument 检查、验证回执、Assessment、FactDesignation 与研究义务的演化历史。
- **SQLite projections/indexes**：当前认知、前沿、反向依赖、全文搜索等可重建视图，不作为第二真源。
- **External artifacts**：大体量实验和仿真数据仅存版本化引用、哈希、校准/生成元数据，不复制 DSH 会话 raw log。
- **Object identity**：稳定逻辑 ID 与内容寻址的 Revision/证书哈希分离；同一命题可接受多条证据路径和多位评价者。
- **时间**：至少区分研究现象发生时间、记录时间、评价与接纳时间；支持审计重放。
- **故障**：验证器失联、schema 错误、计算超时等不能自动转成“科研结论为假”。

## 11. 建议最小 PoC 与验收矩阵（非实施承诺）

| PoC | 验证内容 | 必须体现的负例 |
| --- | --- | --- |
| P0 — Typed Proposition | Theory / Simulation / Engineering World；typed AST；Scope、变量、单位 | 不同坐标/单位、缺失绑定、版本混用被发现 |
| P1 — Strict Theory | Theory→Theory Lean 证明、证书、形式化对应关系 | sorry/额外公理/错误命题对应不能虚称已证明 |
| P2 — Cross-world | Theory→Simulation→Engineering 规则、风险、义务生成 | Theory 直接推出 Engineering 不能获得已验证状态 |
| P3 — Nonmonotonic Knowledge | 多条支持路径、反驳与 undercut、FactStanding 复审 | 机制 H1 失效，独立实验支持的性能 P 不被自动撤销 |
| P4 — Impact / Replay | immutable events、精确版本、依赖失效与重放 | 旧证明的当前依赖失效但历史证明记录仍保留 |
| P5 — Context / Frontier | 当前 Fact、争议、证明证书、失败记录、开放义务的确定性上下文 | 缺少必要 Scope 时 fail-loud，不能无声省略 |
| P6 — Legacy Compatibility | 旧 Claim/Fact/Relation 迁移映射、11 工具权限矩阵和旧 GUI 基线 | 旧 Fact 不应自动获得新 FactStanding 认证 |

**首个端到端研究案例（建议）**：电子光学近壁场与束流传输模拟。Theory 层的理想 Hamiltonian 结论、Simulation 层 BEM/AMReX 网格与算法证据、Engineering 层测量或校准证据分别建立；测试跨域义务、数值误差、模型适用性和错误机制解释的独立失效。

## 12. 分阶段升级构想（仅讨论）

1. **S0 语义契约与 PoC**：先确定 World/TypedFormula/Argument/ProofObligation 的最小规范，验证 Lean 路径与三个跨域负例。
2. **S1 Strict Formal Core**：复用 Euler 的内容身份、精确引用、受控证书和严格演绎依赖思想；接入 Lean 适配端口。
3. **S2 Epistemic Core**：Evidence、Assessment、FactDesignation、rebuttal/undercut、非单调影响传播。
4. **S3 Research Continuity**：ResearchQuestion/Route、Frontier、Failure Memory、Context Compiler 和持久状态回放。
5. **S4 DSH Integration**：版本化 tools/RPC、UI、PlanFork/Intervention、运行上下文和 agent-team 任务契约。
6. **S5 Domain Profiles**：数值收敛、求解器对照、实验校准、可复现性和长程科研恢复。

阶段顺序需在 S0 后重新评估；严格内核与经验评价路径可以并行开发。**不应以实现了宽松 Argument 图来冒充“增强 Euler”**：Theory 严格证明能力必须有单独的验收指标。

## 13. 待裁决问题（下轮设计会议清单）

| ID | 待裁决项 | 推荐默认与讨论风险 |
| --- | --- | --- |
| D1 | WorldKind 是否只从三个基础类型起步，如何注册扩展类型？ | 从 THEORY/SIMULATION/ENGINEERING 起步；具体 Context 必须版本化 |
| D2 | LogicalExpression 最小 AST 和不透明谓词策略？ | 先有限谓词语言 + 未知义务；禁止“结构化=已证明”的伪保证 |
| D3 | Argument 的严格演绎/经验支持接口如何共用？ | 共用结构、区分 inferenceMode 和审查证书，不互相升格 |
| D4 | 哪些 Theory→Theory 任务必须请求 Lean，何时允许仅登记未验证论证？ | Proof certificate 强证据、非所有 Theory 工作强制 Lean |
| D5 | 严格 Lean proof 与自然语言 Assertion 对应关系由谁审查？ | 单独留痕；绝不将 kernel pass 当作语义翻译保证 |
| D6 | 跨域危险规则的阻断、警告、要求复审阈值？ | 硬类型错误拒绝；科学适用性未知保留候选但禁止无条件完成 |
| D7 | Fact 接纳与撤销的审查主体及自动授权策略？ | 初期显式接纳；机器审查可提交建议，不直接篡改项目 FactStanding |
| D8 | 项目级知识流与原 Workstream-local 历史如何迁移？ | 双视角：项目级知识身份，工作线保留行为/来源历史 |
| D9 | 如何处理冲突 Assessment、独立证据、概率更新？ | 不引入未经校准的统一置信度；先有来源的定性评估 |
| D10 | 与 dsh-agent-team 的任务/权限/快照边界？ | 科研状态建议和执行调度分离，专门设计版本化工作单 |
| D11 | 兼容还是破坏性 V3 Schema 迁移？ | 允许破坏性新契约，但保留旧事件的完整可追溯性 |
| D12 | Euler 实现是否复用/重写、许可怎么处理？ | 优先独立 TypeScript 重写思想与算法，逐文件审查许可证 |

## 14. 参考与代码定位

**当前项目：**
- [ARCHITECTURE.md](../../ARCHITECTURE.md)：V1 架构、不变量、控制边界。
- [DOMAIN_SCHEMA.md](../../DOMAIN_SCHEMA.md)：现有 Claim/Fact/Artifact/Relation、Task/Gate/Run 等定义。
- [HISTORY_EVENT_CATALOG.md](../../HISTORY_EVENT_CATALOG.md)：20 类冻结科研事件。
- [PLAN_FORK_SPEC.md](../../PLAN_FORK_SPEC.md)：Agent 提案与用户 canonical plan 控制。
- [src/host/domain/semantics](../../src/host/domain/semantics)：当前语义 reducer、状态机与关系合法性。
- [docs/TOOLS_TRACEABILITY.md](../TOOLS_TRACEABILITY.md)：11 个研究工具及 G5 验收记录。

**Euler 公开设计与实现（参考思想，不声明直接复用代码）：**
- [Euler ARCHITECTURE](https://github.com/canghaimeng/Euler/blob/main/ARCHITECTURE.md)
- [Euler core DATA_MODEL](https://github.com/canghaimeng/Euler/blob/main/euler/core/DATA_MODEL.md)
- [Euler factgraph.py](https://github.com/canghaimeng/Euler/blob/main/euler/core/factgraph.py)
- [Euler control contracts.py](https://github.com/canghaimeng/Euler/blob/main/euler/control/contracts.py)
- [Euler control obligations.py](https://github.com/canghaimeng/Euler/blob/main/euler/control/obligations.py)
- [Euler control context.py](https://github.com/canghaimeng/Euler/blob/main/euler/control/context.py)
- [Euler licensing](https://github.com/canghaimeng/Euler/blob/main/LICENSING.md)：Euler 原创部分为 PolyForm Noncommercial；不同来源文件需逐项核对，本文未复制其实现。

---

**讨论稿边界声明**：本文只建立“可审查的候选总体架构”。未来若决定实施，应先拆分为已裁决 ADR、数据模型与形式化规则规范、PoC 验收计划和阶段 PR。未经批准不得将本文冒充已冻结 V3 规范，也不得直接改变现有运行时语义。
