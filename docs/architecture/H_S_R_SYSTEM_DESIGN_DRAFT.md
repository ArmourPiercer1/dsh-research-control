# H/S/R 系统级设计审查稿：问题、功能边界与对象—关系架构

> **DRAFT-PROPOSAL · 2026-10-27 · PR #42 讨论稿（非实现/Schema 契约）**  
> 本文是 [H/S/R 顶层架构基线](H_S_R_TOP_LEVEL_ARCHITECTURE_DRAFT.md) 的系统级展开，而**非另一份顶层架构**。按“历史 H／语义 S／论证与验证 R”重新安置先前 PR #9、#10、D13–D20、旧版 V3 长稿和 PoC 的既有设计，目的在于检查对象、关系与功能覆盖缺陷。**不通过文档重组默示批准原稿中的未决设计。**
>
> **地位与范围：** V1 根目录正式契约与代码仍为 Current；本稿仅属 Proposed。PoC 结项为 ITERATE，P0 合成范围 PASS；P1–P4 机制完成但未申请/通过正式 Gate。不得据本文改动 V1、启动 V3 M1–M6 或解锁 LIVE_*。
>
> **代次位置（状态标注，不改动正文语义）：** 本文为本 PR 较早一轮的系统级审查稿，未按最新五类对象完全改写，已被 [H/S/R × 五类对象：统一架构设计（最新主基线）](H_S_R_FIVE_OBJECT_ARCHITECTURE_DRAFT.md) **部分取代**；保留作对象—关系视图与缺口矩阵的历史位置，术语冲突时以最新主基线为准。

## 0. 阅读方法与归属规则

### 0.1 讨论状态与实证状态必须分开

| 记号 | 含义 |
| --- | --- |
| **A（共识）** | 已在此前讨论/方向性 ADR 中达成原则同意；**不等于**冻结 Schema |
| **C（候选）** | 本文从既有设计抽出的结构或对缺口的建议；须进一步裁决 |
| **M（机械验证）** | PoC 的合成/有限真实运行验证了特定机制；**不等于**产品、科学语义或真实历史接入已验证 |
| **U（未解决）** | 尚缺精确语义、反例、授权或真实任务证据 |
| **X（高级）** | 可以依赖 H/S/R 发展，但不是三个基础系统成立的必要条件 |

一个对象可以被多个系统引用，但**一个领域语义职责只能有一个主责系统**：H 负责记录及可回放事实，S 负责对象/陈述是什么意思，R 负责已声明的论证、检查和主体评价。横切的 ResearchSpace 隔离、主体认证/授权由公共基础设施执行，不被计算为第四个科研认识系统。

### 0.2 既有设计的重归类总览

| 原设计或术语 | 主要归属 | 保留的职责 | 状态 |
| --- | --- | --- | --- |
| ResearchHistory、Event、双时序、快照、Version/Replay、Provenance | **H** | 历史连续性、来源与变更回放 | A / 部分 M |
| PROV Activity/Entity/Agent、SOSA Observation/Result、Run/Artifact 来源 | **H** | 生产、测量、数据派生的登记来源 | A / 窄适配 M |
| 决策及 `DecisionBasis` | **H**（语义经 S） | 仅记录研究者自述的决策笔记，不作为 R 的推理依据 | A / U |
| `ResearchFinding`（L0）、`Assertion`/`AssertionRevision`（L1） | **S** | 陈述身份、准确版本、稳定含义与历史修订连续性 | A / 部分 M |
| D13 WorldContext、ResearchScope、Representation | **S** | 语境和适用边界，不隐式跨 World 转换 | A / U |
| D14 Concept/SKOS、PredicateSignature、术语修订 | **S** | 概念身份/定义版本与表达签名 | A / U |
| ResearchFrame/Dimension/Option/ContextProfile | **S** | 研究维度及其可选项、局部语境覆盖/比较 | “维度及选项”A；对象形状 C |
| `EvidenceRelation`、`ArgumentRevision` 与 Evidence/Inference Graph 的语义关系 | **R** | 局部证据、组合论证、精确依赖和攻击/削弱 | A / 最小 M |
| 推理方法×逻辑强度×验证状态×证据倾向的多轴分类 | **R** | 明确“怎么推”“何种保证”“怎样评价” | 方向 A；规则 C/U |
| D15 ProofObligation、规则检查、非阻断条件研究 | **R** | 已登记规则需要的条件与状态 | A / 部分 M |
| Strict Theory/Lean、FormalizationCorrespondence、证书 | **R**（引用 S） | 只证明**精确形式命题**，现实适用性另行评价 | 方向 A；完整 PoC U |
| Assessment、FactStanding / FactDesignation、不同主体意见 | **R**（事件由 H 存） | 有主体/范围的评价及可撤回接纳 | A / 最小 M |
| D18 Semantic/Inferential/Evidential 三种可靠性 | **S/R + 外部审查** | S 保语义，R 保局部论证检查；证据充分性不是自动全知判定 | A |
| D16 Anomaly / ResearchQuestion / ResearchRoute / Frontier | **X**（基础登记可引用 H/S/R） | 人工/可选发现与研究路线建议；不等于强制基础内核 | 方向讨论既存，产品化 X |
| D19 Association Graph、联合召回、Context Compiler、可视化 | **X**（R 的基础推理关系除外） | 辅助探索和上下文检索；关联不得变科学证明 | A / 部分 M，收益 U |
| V1 Plan/Task/Gate/PlanFork/Workstream 业务治理 | **外部业务控制面** | 与研究认识交互但不被 H/S/R 重新定义为科研论证 | V1 Current，V3 迁移 U |

> 本节特别纠正两个易混淆之处：**“已有论证关系”是 R 的基础，不等于需要先落地图数据库**；“研究问题/异常可被记录”也不意味着基础层必须配备自动异常发现和 Agent 调度。

---

## 1. H — 历史记录与可追溯来源系统

### H-1. 面对的问题、目标与最小能力

| 问题 | H 应回答的询问 | 保证边界 |
| --- | --- | --- |
| 事件与认识会改变 | 截至某次**登记**，哪些事件和声明存在？各版本由何事件引入？ | 可回放登记历史，**不声称重建未记录的现实** |
| 声称时间与登记时间可能不同 | 当时发生了什么记录？何时**才被系统登记**？ | 不以晚到事件倒填“当时已经知晓” |
| 相同文件被反复分析/失效/删除 | 哪次 Activity 使用/产生哪个 Entity 或 Result？外部文件还在吗？ | 记录关系与可访问状态，不担保科学解释正确或工件永不丢失 |
| 决策复盘 | 该主体当时提交了什么 DecisionBasis？后来何时补录？ | 仅有主观自述；不伪造实际的心理因果链 |
| 旧 V1 历史/外部资料映射 | 哪些条目已映射、哪些未映射、哪些字段 UNKNOWN？ | 不将旧 `FACT_RECORDED` 自动升成 V3 FactStanding |

**最低读面（职责契约，非 API 签名）：** 按记录序号/登记时刻的 replay-as-recorded；明确的 occurred-time 查询；精确事件/对象版本 diff、SourceRef 回源；某次 DecisionBasis 与后来评价并列展示；来源和外部资源缺失报告。对“什么是当时已知”只能陈述系统记录的可见集合与研究主体的自述，不能认定真实知情范围。

**最低写面：** 有归属 ResearchSpace 和主体的追加事件/来源记录；包含必要的身份、时间语义、来源/引用与已知未知项。由 S/R 产生的语义确认、论证修订、评价及接纳事件同样由 H 留痕，H 不因此接管其含义判断。

### H-2. 对象架构（主责与精确位置）

| 对象/概念 | 角色 | 主要状态 |
| --- | --- | --- |
| RecordedEvent / HistoryEvent | 追加的事件信封与稳定序列、主责空间、来源主体、发生/登记时间 | V1 A / PoC M；V3 扩展 U |
| EventSourceRef / ImportBatch / MappingRevision | 事件回源定位；外部 V1 事件到新投影的版本化映射及损失记录 | P1 adapter M；真实 V1 U |
| `prov:Activity` | 已登记的真实执行、实验、分析、推导等活动；`dsh:Experiment/Analysis/DerivationActivity` 可专门化 | A；子类型细节 U |
| `prov:Entity` / Resource | 数据、文件、模型文件/版本、实验物体或信息资源本体 | A；物理设备与数据身份边界 U |
| `prov:Agent` | 被登记活动的来源/责任主体，不等于运行时 Agent 权限 | A；认证治理 U |
| `sosa:Observation` / `sosa:Result` | 符合 SOSA 语义时的观测活动/结果；非 SOSA 输出仍可作为 `prov:Entity` | A；复杂数据映射 U |
| ResourceRegistration / AvailabilityReport | 指向原资源的登记、URI、哈希、访问情况与检查记录，**与资源本体分离** | Q01/U |
| RecordRevision / ProvenanceSnapshot / ReplayProjection | 不可变历史版本、按指定截点重放的视图；快照/投影不是独立事实源 | A / 最小 M |
| DecisionBasis / DecisionReference | 关于某次决定的 L1 稳定“决策依据自述笔记”；允许迟到补写和不完整 | A；正式事件及引用接口 U |
| Missing/Unknown/LossRecord（语义角色） | 外部资料缺失、断链、数据不可访问、部分迁移有损等客观记录；具体类型未定 | A / 部分 M |

这里的 `Revision` 首先是 H 的**历史留痕机制**；`AssertionRevision`、`ArgumentRevision` 的精确内容与不变量分别由 S/R 定义，避免三个系统重复定义相互冲突的 Revision 语义。

### H-3. 关系架构（关系的方向 ≠ 因果或推理）

| 关系或投影 | 方向（概念性） | 系统承诺 |
| --- | --- | --- |
| `prov:used` | Activity → Entity | **登记**某活动实际使用了资源；不同于“计划使用” |
| `prov:wasGeneratedBy` | Entity → Activity | 登记由何活动生成；实验失败可以没有有效 Result |
| `prov:wasDerivedFrom` | Entity → Entity | 数据/资源派生链，**不表示逻辑蕴涵** |
| `prov:wasAssociatedWith` | Activity → Agent | 活动参与/责任关联，不是宽松设备关联 |
| `sosa:hasResult` | Observation → Result | 观测结果与活动绑定；一般计算值不必强行 SOSA 化 |
| revision-of / supersedes（历史声明，名称待定） | 后提交的记录 → 既有记录版本 | **谁声明**修订及目标是谁；不表明修订“更科学正确” |
| source-anchor / available-at / lost-at（候选） | 记录/登记 → 来源；可用性检查 → 资源 | 保留检查时间与缺失；URI/哈希并非永久重建保证 |
| decision-note-for / considered-ref（候选） | DecisionBasis → Decision / 被自述考虑的精确引用 | 仅保存**研究者说自己考虑过**的对象，不产生 Argument |
| crosswalk-mapped-from（候选） | 新投影条目 → 原 V1/外部条目 | 可逐条回源，未映射与有损转换显式列账 |

`SourceRef` 的合法性只保证引用定位，不保证其指向事件的科学描述真实。S/R 可以从 H 取得来源和历史，不得让 H 的 `wasDerivedFrom` 承担 S/R 的语义或科学推理职责。

### H-4. 不变量、非目标与边界案例

- **H-I1**：事件追加、历史版本不可静默覆盖；修订/撤回/补记是**新事件**。
- **H-I2**：回放可幂等/确定性；要能按**登记截点**复现相同状态，但不必捏造跨源全局绝对时间顺序。
- **H-I3**：发生时间、登记时间、来源事实与主观断言不得相互替代；记录发生先于 T 不表示研究者在 T 知道它。
- **H-I4**：原文件缺失不导致既有来源记录消失，不自动拒绝所有后续研究；未知、哈希失配、不足以重建等应如实返回。
- **H-I5**：ResearchSpace 隔离应用于写入、重放、检索、跨对象引用和导出；不能因为哈希/URI 相同就跨空间泄漏。

**必须覆盖的最小反例：** 迟到登记；同源文件两版 Analysis；失败 Observation 无 Result；`gdfa position` 末态被错称屏面数据但原读取活动存在；DecisionBasis 在事后补记；原始 GDF 删除而有哈希/重算配方；`RUNS_STARTED` 单事件多 Run 旧格式；重复导入与断链。

**不负责：** 复现真实研究者的完整心理认知；判断 Result 被科学地正确解释；对缺失数据作重建担保；自动决定研究工作计划或科研结论。

### H-5. 已有覆盖与待解决缺口

| 主题 | 已有机制/证据 | 缺陷或未裁 |
| --- | --- | --- |
| 重放与来源 | V1 ResearchHistory；PoC 确定性 replay、重复/乱序导入和 PROV 投影 | 真实 V1 快照与多 Workstream 共享知识（Q05/Q15）、跨源事件归属仍 U |
| 来源/结果分离 | 失败实验和同源不同分析负例；GPT 真跑信封 | `Run` 与 Activity 生命周期对应、SOSA 复杂非数值观测/仿真与普通分析映射 Q01–Q03 仍 U |
| 不可用资源 | URI/哈希/unknown 记录、被删除 GDF 的来源示例 | 缺失、哈希不一致、资源真正不可恢复时对消费者的统一可见契约 U |
| 决策历史 | DecisionBasis 已有明确“决策笔记”语义原则 | 事件/时间锚、事后补记及其 L1 稳定引用尚缺实现与反例 |
| V1 兼容 | `v1crosswalk/0.1` 有 unmapped/UNKNOWN 账和 `FACT_RECORDED` 限制 | 真实数据未验证，`RUNS_STARTED` 一对多、撤回及关系语义映射 R10/U |

---

## 2. S — 语义与科研对象身份系统

### S-1. 面对的问题、目标与最小能力

| 问题 | S 应回答的询问 | 保证边界 |
| --- | --- | --- |
| 同词不同义 | “发射度”“时间分辨率”在哪个定义/版本下使用？ | 稳定**被登记的含义**；不保证陈述与现实相符 |
| L0 不完整、L1 需要共享 | 原文如何保留？哪些对象引用、World、Scope 已足以可靠地协作？ | L1 意味可解释/可引用，**非科研事实接纳** |
| 陈述会修订 | 两个 Revision 的历史关系与含义有什么变化？ | AssertionID 表示**历史链**，不代表语义等价 |
| 多研究配置/模型 | 陈述约束在哪个模型、范围和研究选择？ | 不隐式跨 World/Scope 推导 |
| 核心对象增补 | 新的扫描波形、模型或测量维度加入后旧陈述如何处理？ | 可做结构覆盖提醒，不修改过去、不把缺维度等同于反证 |
| 多主体陈述重叠 | 两人说的是同一个命题吗？ | 相似/等价建议需有显式对齐与来源，不自动合并 |

**最低读面：** 获取指定版本的 Concept/World/Scope/ResearchFinding/Assertion；解释某次 Revision 使用的确切定义；比较两条语义引用（同一/已声明等价/差异/UNKNOWN）；列出概念或框架修订的结构性影响。**最低写面：** 提交 L0 原文、候选解释/澄清请求、L1 显式语义确认、版本化概念/语境/陈述修订，均由 H 留痕。

### S-2. 对象架构

| 对象/概念 | 角色 | 当前设计地位 |
| --- | --- | --- |
| `dsh:ResearchFinding`（L0） | 保留原文、主体自述、来源锚及未澄清条件，允许研究继续 | A / PoC 最小 M |
| SemanticCandidate / SemanticConfirmation | 对 L0 的候选解释、澄清与由可归因主体确认的语义状态 | A；载体是 event kind 还是 payload：R2/U |
| `dsh:Assertion` | 稳定的**陈述历史修订链身份** | 本轮 A |
| `AssertionRevision` | 可被精确引用的陈述版本；绑定原文、World/Scope、概念修订及来源 | A；精确修改准入规则 U |
| `skos:Concept` / ConceptRevision | 词汇定义、prefLabel、altLabel、definition 等；词法与语义修订分离 | A；同义命名 W3C-first |
| PredicateSignature / TypedFormula（可选） | 在更深入形式化时为谓词、变量、单位/量纲/类型提供精确含义 | 设计接口 C；完整 AST 非 L1 前置 |
| `dsh:WorldContext` / Representation / `ResearchScope` | 数学、仿真、物理世界及模型/实验配置、适用条件 | A；模型细节与等价规则 U |
| CoreObject / ResearchDimension / Option | 已登记的模型、设备、理论、指标等对象，在**局部研究维度**内被选择或排除 | “维度及选项”A；具体类型 C |
| ResearchFrameRevision / ContextProfileRevision | 规定某研究范围应声明哪些维度，以及一次具体研究如何选项、排除或保留未知 | 候选 C；非通用 L1 强制 |
| SemanticAlignment / ContextMapping（候选） | 两语义修订/World/Scope 的显式比较、映射及其审查记录 | 候选 C；等价算法 U |

**不新设“科学真值”字段**：某个 Revision 语义稳定，不代表正确。可以有不同主体针对同一精确 Revision 作互相矛盾的 Assessment（在 R），不要求复制其语义内容。

### S-3. 关系架构

| 关系（概念名称，非冻结谓词） | 方向/域 | 不变量与边界 |
| --- | --- | --- |
| `normalized-from` / `expresses` | AssertionRevision / SemanticCandidate → ResearchFinding Revision | L0 原意不被 L1 自动改写 |
| `revision-of` | 新 AssertionRevision → 所属 Assertion 的旧 Revision | 精确旧引用不漂移；**历史连续性 ≠ 逻辑等价** |
| `uses-concept-revision` | AssertionRevision / PredicateSignature → ConceptRevision | 概念定义变更不会倒灌改变旧命题 |
| `in-world` / `has-scope` | AssertionRevision → WorldContextRevision / ResearchScope | 未知条件显式 UNKNOWN；无隐式跨 World cast |
| `chooses-option` / `excludes-option` / `undetermined` | ContextProfileRevision → ResearchDimension/Option | 选择是**研究配置**，不是模型科学真值或全局否定 |
| `conforms-to-frame` / `coverage-under` | ContextProfileRevision / AssertionRevision → ResearchFrameRevision | 完备性**相对于某框架版本**；不相容仅表示结构差异 |
| `semantically-aligned-with`（候选） | 精确 Revision/World 版本 ↔ 已声明映射 | 映射有声明者、证据与状态；不靠文本相似推理 `owl:sameAs` |
| `refers-to-resource` | 语义陈述 → H 的 Entity/Result/Activity | 保证引用角色清楚，但引用本身不构成证据证明 |

### S-4. L0/L1 与更高形式化的边界

| 层面 | 必须做到 | 不能自动升级为 |
| --- | --- | --- |
| **L0** | 保留来源、自然语言原意与已知不确定性；格式/引用最小检查后允许继续 | L1 语义确认、科研可信度 |
| **L1** | 身份、相关概念、World/Scope、原意达到可共享解释的稳定程度；必要缺项允许**明示** UNKNOWN | FactStanding ACTIVE、完整科学论证 |
| **更深入类型/结构化检查（候选）** | PredicateSignature、单位、变量/量词、Scope 类型检查；记录检查能力范围 | Lean 证明、现实模型适用性 |
| **严格形式化（由 R 执行验证）** | S 给出精确命题/定义/版本引用；R 的形式化对应与证书单独审查 | 全部科研结论真实 |

**不冻结 L2–L5 为线性层级**。核心对象/ResearchFrame 的局部完备性和 WorldContext 的已声明映射是独立的**语义检查维度**，不宜提前包装成“更高真值等级”。

### S-5. 关键设计不变量与反例

- **S-I1**：`AssertionID` 是研究者显式维护的**陈述历史连续性**；其跨 Revision 不必逻辑等价，R 依赖必须锁定目标精确 Revision。
- **S-I2**：语义变更产生新修订/显式映射；历史 Concept/World/Scope/Assertion 的精确含义不能被“最新定义”静默替换。
- **S-I3**：L1 允许明确未知，不把不确定性自动补成普遍适用；若原意不可辨，则允许 NEEDS_CLARIFICATION 而不是强行确认。
- **S-I4**：ResearchFrame 新增维度不会自动回填过去 Profile；“旧记录相对新 Frame 覆盖不全”≠“旧记录当时语义非法/科学错误”。
- **S-I5**：模型选择、使用和将某理论作为研究对象，与主体**相信该理论为真**不是同义关系；研究维度中的“未选”不天然等于科学否定。
- **S-I6**：仅凭同名、相同结果数值、相同设备、概念同义候选，不能自动合并两个命题或 World。

**反例：** “几何发射度”与“归一化发射度”同名误用；同一 100 fs 对应不同波形；同 Assertion 修订 100→120 fs；两不同作者写出同义/近似命题；新的扫描波形维度导致待复核但旧事件仍可回放；GPT 的 5.225 mm 原称屏面而后被标明为末态。最后一例属于研究者后来**修正解释**，不是 S 自动判定哪项物理解释正确。

### S-6. 已有覆盖与待解决缺口

| 主题 | 已有依据 | 缺陷或未裁 |
| --- | --- | --- |
| L0/L1 | D17；PoC L0 不可变、L1 actor 确认/UNKNOWN 防补全 | PoC World/Scope 只是字符串；自然语言真正规范化和授权确认质量 U |
| Concept | D14/W3C SKOS | 概念合并/拆分、词法 vs 意义修订、谓词签名与定理版本绑定 U |
| 世界语境 | D13 开放类型、无隐式跨 World | 具体模型/版本、Scope 局部未知、World 关联与比较的最小语义 U |
| Assertion 身份 | AssertionID 历史链方向已确认 | 新建 Revision 与新建 Assertion 的准入、同义对齐、替代分支关系尚 U |
| ResearchFrame | 维度/选项组织原则已确认 | 核心维度覆盖触发条件、选项互斥/可并存、ContextProfile 形状与版本迁移 C/U |
| 跨主体共享 | 同一精确命题可多人评价 | “同义是否共享一个 Revision”与多作者来源分离、语义确认权限 U |

---

## 3. R — 论证、校验与可选形式化系统

### R-1. 面对的问题、目标与最小能力

| 问题 | R 应回答的询问 | 保证边界 |
| --- | --- | --- |
| 证据与论证混淆 | R 对 P 的局部证据意义是什么？多个前提如何组成对 P 的论证？ | 保存**研究主体登记的**解释与论证，不代替科学结论 |
| 方法不同 | 一条论证是演绎、统计、归纳还是溯因？前提→结论有多强？ | 方法和 LogicalForce 分离，不把启发式当严格证明 |
| 研究依据发生变化 | 哪条具体论证路径引用受质疑前提？独立支持是否存在？ | 选择性影响分析，**不自动撤销 FactStanding** |
| 证据和审查意见冲突 | 哪个主体、什么范围下如何评价/接纳一项精确命题？ | 允许分歧并存，机器的 verification PASS 不是科研接受 |
| 复杂推理与数学证明 | 哪些已登记规则条件未满足？形式证明精确证明了什么？ | 严格的局部证书信任边界，非全局科学真理 |
| 证据充分性 | 是否缺校准、统计模型或独立性支持？ | 提供来源、条件和结构审查接口；充分性主要是**科研评价** |

**最低读面：** 指定 AssertionRevision 的 EvidenceRelation、ArgumentRevision、前提/规则版本、验证/义务状态、主体 Assessment/FactStanding（指定历史截点）；已登记依赖的选择性影响报告；精确形式证书（如有）的信任范围。

**最低写面：** 结构化证据关系、论证、评价、接纳声明、已登记规则触发的义务/检查报告。Agent 或科研主体提交，系统负责持久化及有界机械检查；校验器/形式化工具由外部执行面调用。

### R-2. 对象架构

| 对象/概念 | 角色 | 当前地位 |
| --- | --- | --- |
| `dsh:EvidenceRelation` | 一个 Result/资源在条件 C 下对某精确目标的局部证据意义；记录方法、倾向和来源 | A / PoC 最小 M |
| `dsh:Argument` / `ArgumentRevision` | 若干前提、联合/替代证据、推理方法及适用条件通向精确目标的**有身份论证** | A / AND/OR 与 Revision M |
| InferenceScheme / RuleRevision（注册表） | 规定一类推理的参数、检查条件、必要前提与 Critical Questions | 多轴原则 A；具体规则体系 C/U |
| ArgumentCheckReport / VerificationReport | 区分 shape、semantic/type、rule、formal、applicability 等实际检查结果及 UNKNOWN | 方向 A；联合报告契约 U |
| `dsh:ProofObligation` | **已登记**规则要求满足的条件、受约束的论证路径、完成/例外审查状态 | D15 A；正式来源和传播 U |
| `dsh:Assessment` | 主体对命题、局部证据、论证或适用性作出的具体评价，允许互相不一致 | A / append-only M |
| `dsh:FactStanding` / FactDesignation | 主体/项目在特定 Scope 接纳或暂停**精确 Revision** 的历史声明及可重建状态 | A / 最小 actor 门 M；授权 U |
| FormalizedProposition / FormalizationCorrespondence（可选） | 精确公式及其与自然语言陈述的对应记录；对应本身需审查 | C / U |
| FormalProofCertificate（可选） | Lean/其他内核对指定命题、定义、公理、版本的形式验证工件及结果 | A（边界）/ 实际验证 U |
| ReviewSuggestion（高阶接入） | 非规则要求的审查建议，例如关联图召回遗漏因素 | X；**不自动转义务** |

**EvidenceRelation 不是 PROV 文件本体；Argument 不是 EvidenceRelation 集合的自动概率求和；Assessment 不是机器客观判真；FactStanding 不是 Assertion 的内置布尔属性。**

### R-3. 关系架构（严格区分五种关系）

| 关系 | 方向/含义 | 不得误用为 |
| --- | --- | --- |
| `evidence-for`（SUPPORTS / CONTRADICTS / CONTEXTUALIZES / UNRESOLVED 等候选词汇） | EvidenceRelation → Result/来源 与精确 AssertionRevision/ArgumentRevision | PROV 派生、普适的后验概率、Fact ACTIVE |
| `premise-of` / `concludes` | ArgumentRevision → 前提集合/目标 AssertionRevision | 仅因共同文件/时间相邻就认为存在依赖 |
| `requires` / `uses-scheme` | ArgumentRevision → 推理规则版本及其已登记必要条件 | 所有科研中可能遗漏因素的穷尽清单 |
| `rebuts` | 某论证/评价 → 精确目标命题的反对性论证 | 自动抹除历史命题 |
| `undercuts` | 某论证/评价 → 特定论证的适用前提、规则运用或支持路径 | 必然否定结论本体 |
| `assesses` | Assessment → 明确类型和精确 Revision 的目标 | 自动证明评估本身正确 |
| `designates` / `withdraws-designation` | 有权主体的 FactDesignation → 精确 Revision、Scope、项目接纳记录 | 无声写入其他主体的意见 |
| `discharges-obligation` / `verifies` | 审查/验证记录 → 指定 ProofObligation/精确形式命题 | 实验或现实世界自动获证 |
| `depends-on-proof` | 形式论证 → pinned 公理/定义、证书、环境 | 自然语言或工程现实自动获证 |

关系名仅为设计时的阅读别名，**不是现在就要冻结的 RDF predicate/TypeScript Enum**。在 W3C 中 `prov:wasDerivedFrom` 表示资源来源，不得被这里的 Argument 依赖替代。

### R-4. 推理分类：保留旧设计的四个正交维度

| 轴 | 候选值或含义 | 作用与边界 |
| --- | --- | --- |
| **InferenceMethod / Scheme** | DEDUCTION、INDUCTION、STATISTICAL、ABDUCTION、ANALOGY、CAUSAL、DEFAULT、PRACTICAL（开放扩展） | “采用何种研究者声明的推理方法？” |
| **LogicalForce** | STRICT、DEFEASIBLE、HEURISTIC | 前提成立时究竟声称什么类型的逻辑约束？ |
| **VerificationStatus** | UNCHECKED、结构已查、规则已查、形式内核已查、实证已审等（**不能随意压成单一等级**） | 验证了哪个精确对象、何种能力/版本下的哪一部分？ |
| **EvidencePolarity / TargetRelation** | SUPPORTS、REBUTS、UNDERCUTS、NEUTRAL/UNRESOLVED 等 | “该证据/论证针对什么目标起什么作用？”不是推理方法本身 |

各轴不可互相替代：**统计方法不自动说明逻辑强度，Lean 检查通过不说明现实适用性，证据 SUPPORTS 不表示它能严格蕴涵目标。** PoC 的 P3 `EvidenceStrength` 定性/NOT_QUANTIFIED 是一种**记录约束**，不应扩展为任意科学概率推断引擎。

### R-5. 方法相关的 Critical Questions（候选方法档案，不是自动科学判真）

| 方法 | 最低应当能**记录/提出**的关键问题 |
| --- | --- |
| 演绎 Deduction | 精确前提和谓词绑定？规则/公理版本？证明是否真的覆盖目标公式？ |
| 归纳 Induction | 从哪些样本到哪个范围？选择偏差与外推条件是什么？ |
| 统计 Statistical | 噪声/似然/先验（若用）、不确定度和检验假设有何来源？ |
| 溯因 Abduction | 是否保存竞争解释及可能区分的实验？不是把“最佳解释”伪装唯一证明 |
| 类比 Analogy | 相似与不相似条件是什么？映射适用范围？ |
| 因果 Causal | 有什么因果模型与识别假设？混杂和干预语义是什么？时间先后不能代替因果 |
| 默认/可废止 Default | 例外及撤销条件如何登记？ |
| 实践决策 Practical | 目标、成本、风险、授权和替代方案有哪些？若仅是历史决策自述，仍是 H 的 DecisionBasis 而非自动 Argument |

按规则显式登记的必要条件可以形成 ProofObligation；**只是“值得再看看”的 Critical Question/关联检索建议不自动形成证明义务**。具体 Rule Registry、阻断政策和算法仍 U。

### R-6. 严格证明与可修正科研支持的保证边界

| 子路径 | 可提供的保证 | 不能声称 |
| --- | --- | --- |
| `Γ ⊢ φ`（STRICT） | 在 pinned 定义、公理、形式化命题、证书和可信计算基下，验证某严格子问题 | 研究主体的自然语言原意准确、模型符合现实 |
| `(Γ,Evidence) ↝ φ`（DEFEASIBLE/HEURISTIC） | 保留已声明的支持与攻击路径、适用条件、评审记录 | 从少量证据自动推出无法被推翻的科学真理 |
| 形式化对应 | 记录“该 Lean 命题声称表达自然语言 P”的主体/审查版本 | 内核验证会自动检验自然语言翻译忠实 |
| World/Scope 迁移 | 通过 S 的版本化语义关系标明两个世界的对应；R 在已注册规则下登记转换条件 | 同类模型/同名物理量就等价；已检查公式适用于另一装置 |

严格数学证明是 R 的**可选增强能力**，不是所有科研结果的 L1 准入门槛。自然语言↔公式映射也可为部分、不完全形式化。L2–L5 不在本轮定阶。

### R-7. 非单调维护与评价/接纳的分离

用两条独立路径支持性能 P：`A(H1,C) → P` 与 `E1 → P`。当 C 被某主体质疑：
1. **H** 留存质疑/新结果/检查记录，原版不改写；
2. **S** 解析其针对的精确概念、条件和 ArgumentRevision；
3. **R** 只沿**已登记依赖**生成“受影响路径”的检查结果；保留 E1 的独立路径（除非它也有明确依赖）；
4. 不因检查器产生“受影响”便自动宣告 P 为假、抹除旧 Assessment 或更改其他主体的 FactStanding；
5. 各主体的科学解释、复审及接纳决定作为新 Assessment/FactDesignation 另行登记。

PoC 中 undercut/rebut 最小算子、AND/OR 支持树和 Assessment append-only 得到 M；它们**没有**验证现实项目的全部隐含前提，也未验证自动仲裁相反意见。相反，“跨 Workstream 共识”“科学证据充分性”均属于 U。

### R-8. 已有覆盖与待解决缺口

| 主题 | 已有依据 | 缺陷或未裁 |
| --- | --- | --- |
| 局部证据/组合论证 | PR #9 模型，PoC P3 定性证据、AND/OR、Revision（138→173 总集） | 联合证据统计、同源/隐含依赖、方法组合语义、概率/强度证书 U |
| 推理方法 | 旧版 V3 长稿已有四正交轴及八种方法，原则同意 | SchemeRegistry、Critical Questions、可插拔规则接口/阻断边界尚 U |
| ProofObligation | D15 非阻断方向，PoC 验证 unknown/缺前提的提示边界 | 规则确权、义务产生/满足/例外/复开、范围传播 U |
| 严格数学与 Lean | 明确限定信任边界及自然语言对应 | 真正 Lean 证书及定义/公理锁定、复核/失效正反例 U |
| 评价与 FactStanding | PoC 最小 actor 确认门、append-only 评价和风险措辞自查 | 主体认证、授权策略、意见冲突、撤回/恢复、持久化 U |
| 选择性影响 | 旧机制失效但独立证据保持的 PoC 负例 | 隐含依赖、共同误差、真实复杂论证、人工实际审查影响 U |
| 科学充分性 | D18 三维可靠性分离 | 主要由外部科研审查判断；不纳入通用通过/不通过判真器 |

---

## 4. 跨系统合同：对象生命线与禁止隐式提升

### 4.1 一次可能的研究记录流（**不是必须依次完成的流水线**）

~~~text
来源、实验/仿真/分析登记（H，PROV/SOSA 条件满足时）
     ├── 原始 Result/Entity、失败记录、缺失信息仍可独立存在
     └── ResearchFinding L0（S） —— 可继续探索 / 可为 UNKNOWN
              └── 显式语义确认 → AssertionRevision L1（S）
                       ├── EvidenceRelation / ArgumentRevision（R，可选）
                       ├── Assessment（R，多主体、多版本）
                       ├── FactDesignation → FactStanding（R，外部授权）
                       └── DecisionBasis（H，L1 自述；**非** R 依赖）
所有“提交、确认、修订、接受、拒绝”均由 H 登记历史；
S/R 的当前态是由同一事件真源重建的视图。
~~~

允许只有 Observation 而没有假设、只有 L0 而暂未 L1、只有 Argument 草稿而有 OPEN 义务，也允许没有完整 Argument 的科研判断记录。**缺少下游层级不是自动错误**。

### 4.2 关系跨界守卫

| 从何而来 | 不能隐式变成 | 明确变更需要什么 |
| --- | --- | --- |
| H 的 `wasDerivedFrom` 数据派生 | R 的有效论证/演绎证明 | 新增并归因的 ArgumentRevision，指明前提和推理规则 |
| H 的 `wasGeneratedBy` 或 `sosa:hasResult` | Result 的科学解释/真实性 | S 的解释/命题及研究者确认，或后续评价 |
| S 的 L1 语义稳定 | R 的科学支持或 FactStanding ACTIVE | 独立 Evidence/Argument/Assessment/接纳事件 |
| S 的 WorldContext 已声明相似/等价 | R 的跨世界可靠推导 | 具版本和适用条件的规则/论证（需要时证书） |
| R 的已查规则 / Lean 核验证书 | 外部物理现实成立 | 对现实假设、测量适用性等的独立科研评价 |
| R 的规则未闭合/路径受影响 | 自动撤销全部结论或历史 | 相应主体的显式后续评价/正式接纳变更 |
| H 的 DecisionBasis 自述 | 严格论证或实际因果决策模型 | 如果要用于推理，另行创建显式 Argument |
| X 的 Association / ReviewSuggestion | ProofObligation / 物理因果 / 科学 Fact | 由已登记规则与主体审查明确建立新关系 |
| V1 `FACT_RECORDED` 历史标签 | V3 FactStanding ACTIVE | 明确的正式接纳和兼容性审查 |

### 4.3 横切边界与 V1 业务系统

- **ResearchSpace** 是共同访问和对象归属边界；各 H/S/R 查询及导出均不得跨空间读取其他空间记录。Project/Topic/Workstream 可作为组织筛选维度，但不能提供跨空间访问通行证。
- **主体来源 `prov:Agent` ≠ 授权能力**。L1 谁能确认、FactStanding 谁能接纳以及外部任务谁能启动，分别受明确权限策略约束；不能因 actor 非空就声称已有生产级授权。
- 既有 V1 的 Project/Topic/Workstream、Plan/Task/Gate/PlanFork、Run/Intervention/权限仍是其业务控制面。H 记录其历史，S 可解释其名称和对象，R 可以引用其中的已登记科研论证，但**工作流完成不自动证明科学事实**。
- W3C-first 仅精确复用：PROV 负责来源、SOSA 负责观测及结果、SKOS 负责词汇；`JSON-LD/RDF/SHACL` 可用于交换与结构校验，不能代替推理有效性或证据充分性评价。旧式宽泛 `DERIVED_FROM`、`RELATED_TO` 等按语义逐条分流，禁止在迁移中“全都变成同一种边”。
- 正式存储/事件、权限及 V1 迁移的改动须另案审查；本稿对对象关系的描述**不预先确定**表结构、API、图数据库或全量转 RDF。

---

## 5. 功能覆盖与缺陷检查清单（供逐系统评审）

### 5.1 覆盖级别的判定规则

- **已定义原则**：目标/边界可被清楚说明，但**不能替代**对象字段、规则和反例。
- **最小 PoC 可行**：仅证明当时测试条件下的机械行为；不代表实际科研语义已充分覆盖。
- **设计缺口**：缺少最小对象/关系角色、时间/范围语义、状态转换，或与其他系统职责冲突。
- **真实任务缺口**：机制可能存在，但没有合格素材证明真实历史回放、真实多主体审查或 Agent 使用收益。

### 5.2 缺口矩阵（建议下一轮优先审查，不是自动 Task/Gate）

| ID | 系统 | 缺口/歧义 | 为什么重要 | 建议的最小反例或验收 |
| --- | --- | --- | --- | --- |
| H-01 | H | 记录时间 vs 声称发生时间 vs 决策自述时间的 as-of 语义 | 避免事后补录被推定为当时已知 | T1 决策、T3 迟到登记，历史和当前查询应不同 |
| H-02 | H | Resource/RegistryEntry/Availability、失效与外部缺失 | 防止错误地删历史或保证不可达文件重建 | .gdf 删除、哈希失配，历史保留且缺失透明 |
| H-03 | H | V1 Run/Relation/Fact 事件迁移、真实多 Workstream 归属 | 防止旧记录误升格或丢失 | 一事件多 Run、Fact 标签、关系撤回、真实历史导入 |
| H-04 | H/S | DecisionBasis 的笔记类型、补录、精确引用和 L1 确认 | 防止决策依据自述冒充逻辑依赖 | 事后笔记与当时可见记录冲突，均保留 |
| S-01 | S | Assertion 同链修订与另建 Assertion 的准入 | 防止不同波形下“120 fs”被误合并 | 同 M/W1 网格修正 vs M/W2 新方案 |
| S-02 | S | World/Scope/ConceptRevision 的身份、UNKNOWN 与局部对齐 | 防止隐式跨模型或“新定义改写旧语义” | 理想模型与真实装置、定义版本改变 |
| S-03 | S | ResearchFrame/ContextProfile 版本化维度覆盖 | 防止新增核心维度强制改写所有历史 Assertion | Frame v1 无扫描波形、v2 新增；旧版仍可回放 |
| S-04 | S | L0→L1 原意审查、同义候选和多主体来源 | 防止模型自认为同义即合并错误科研命题 | 发射度几何/归一化、两个作者相同词不同义 |
| R-01 | R | 不同推理方法/LogicalForce/证据倾向的类型合同 | 防止统计/溯因被标为演绎定理 | 相同结论由归纳、演绎和类比分别提交 |
| R-02 | R | EvidenceRelation 联合统计、独立性与前提嵌套 | 防止三份共享同一模型的数据被视为三份独立证据 | 共同误差源/共同反演模型的两条支持路径 |
| R-03 | R | rebut、undercut、开放义务和选择性传播的范围 | 防止删除独立支持或自动终止科研 | C 受质疑、E1 独立支持 P 的反例 |
| R-04 | R | Assessment/FactStanding 主体、权限、并存与接纳治理 | 防止单一自动分数强制覆盖多主体观点 | A/B 同时相反评价，项目接纳独立存在 |
| R-05 | R/S | Lean 证书、准确公式、翻译对应与 World 迁移 | 防止已核验形式命题洗白物理模型 | Lean 精确证明成立但现实标定条件未知 |
| X-01 | X | 双图与 Context Compiler 的真实增益/成本 | 防止用合成 7/7 推出必须上图数据库 | 真实历史、人工标注、同预算文本 vs 图检索 |
| X-02 | X | Anomaly/Question/Route/Frontier 的自动发现与升级 | 防止假阳性、循环唤醒、计划被偷偷改写 | 候选异常只进隔离审查，不成为 Fact/Task |

### 5.3 建议的评审顺序与暂停条件

1. **先核 H 的历史截点与精确引用**（H-01/H-02/H-03），否则 S/R 的修订与评价无法可靠复盘。
2. **再核 S 的精确语义边界**（S-01～S-04），同时保留已确定的“AssertionID = 历史链、研究维度/选项组织、L0/L1”原则。
3. **然后核 R 的方法分类、局部论证和评价/接纳**（R-01～R-05），坚持“结构影响≠科学真值/自动接纳”。
4. 最后以真实授权素材验证 X 能否产生净收益。这个顺序只是讨论建议，**不是 V3 开发启动授权**。

若后续需要将“候选”升级为冻结契约，应先逐条审查与 [现有 PR #33 实施草案](V3_IMPLEMENTATION_CONTRACT-DRAFT.md) R1–R11 的冲突或遗漏，再为相应组件制定独立 Schema/接口/正反例；不能以本系统分类稿替代设计裁决。

---

## 6. 依据、PoC 口径与遗留原稿的关系

- **顶层优先**：[H/S/R 顶层架构基线](H_S_R_TOP_LEVEL_ARCHITECTURE_DRAFT.md)（本 PR #42 的讨论原点）；本文负责细化系统归属、对象关系、功能覆盖。
- **既有设计**：[架构基线](ARCHITECTURE_BASELINE.md)、[核心语义](CORE_SEMANTICS.md)、[W3C 对齐](W3C_ALIGNMENT.md)、[D13–D20 决策索引](adr/README.md)、[开放问题 Q01–Q18](OPEN_DESIGN_QUESTIONS.md)。存在命名冲突时以新讨论的 W3C-first 与精确语义边界为准，**不能静默修改旧文档**。
- **旧版多推理方式与 Lean 原始候选**：[历史 V3 长稿](../design/V3_TYPED_RESEARCH_EPISTEMICS_ARCHITECTURE_DRAFT.md) `3–`8。该稿为 Historical，不作为 L2–L5 或任何 Schema 的当前批准来源。
- **PoC 证据**：[执行计划](../poc/V3_POC_EXECUTION_PLAN.md)、[结项素材](../poc/gates/POC-COMPLETION-REVIEW.md)、[P3 记录](../poc/gates/P3.md)、[P4 记录](../poc/gates/P4.md)、[P4 原始报告](../../experiments/v3-semantic-poc/REPORT-P4.md)。173/173 是当时机械测试数；真实 V1 历史、人工 A/B、live 侧车均为 N/A，PoC 最终 ITERATE。
- **后续判别实验**：GPT 真跑后发现对 `gdfa position` 末行的科学解释错误，后来通过新观察修正；见 [gpt-streak README](../../experiments/v3-semantic-poc/samples/gpt-streak/README.md)。这是“历史真实登记≠科学解释永远正确”的反例，并非系统已经实现自动观测解释正确性检查的证据。
- **本稿非目标：** 不覆盖 PR #33 的 M1–M6 代码施工合同，不声称完成真实多主体治理/真实历史接入，不授予任何自动科研认证或 Agent 调度能力。
