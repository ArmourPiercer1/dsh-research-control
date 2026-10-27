# H/S/R 系统设计合同：功能、对象关系、约束与反例

> **Draft，不是冻结 Schema/API/Implementation Contract。** 以[五类与三系统核心](H_S_R_FIVE_OBJECT_ARCHITECTURE_DRAFT.md)为主；[对象对账](H_S_R_OBJECT_MAPPING_DRAFT.md)列举既有设计位置。本稿专门整理各系统需要回答的问题、最低能力与不负责的内容。

## H — 历史与来源

### H1 面对的问题
同一个命题可能经历不同的声明与修订，同一研究主体可以补录先前发生的活动，文件可能失去访问能力；回放必须区分**当时已经登记的内容**和**现在补充的、声称当时发生的内容**。多主体主观态度的变化不能覆盖原评价。

### H2 最低对象及关系
| 机制 | 输入→输出/关联 | 限定 |
|---|---|---|
| HistoryEvent、登记序及 SourceRef | 记录→精确 ObjectID/Revision | append-only，不因迟到记录反写旧事件 |
| AssertionChain | 历史链修订序→不同 PropositionRevision | 不含另一份可变的“真命题”内容 |
| PROV Activity、Entity、Agent | used、wasGeneratedBy、wasDerivedFrom、wasAssociatedWith | 描述实际生产和来源，不能当作逻辑证明 |
| SOSA Observation→Result | hasResult / hasSimpleResult | 只在语义适用时映射；采集失败允许无 Result |
| ResourceRef/Availability Check | 对 URI/哈希/快照的一次状态检查 | 数据失踪不消除过去的观察/文件登记 |
| DecisionBasis | 某主体自述的决策笔记→精确引用集合 | 不证明决策真实心理因果或推理依赖 |
| V1 Crosswalk | Legacy ID/Event→有来源的候选投影及 lossReport | FACT_RECORDED 不等于正式科研接纳 |

H 保留**occurred_at**（声称的发生时间）与 **recorded_at**（系统登记时间），还需稳定的登记因果顺序/序列。对同一历史截点应有可复现投影；不同来源不能无证据推定绝对先后。晚到材料若声称 T1 发生，但 T3 才录入，则 T2 “as-recorded” 查询不能把它算作 T2 已知。

### H3 必须保证/不保证
必须保证：源引用、修订和登记人可追溯；导入损失/断链/未知显式；外部源文件删除不使整套查询崩溃；历史回放不静默改变旧文字或旧命题含义；不同 ResearchSpace 不互读。

不保证：实际研究活动一定按日志所述发生；材料永久可访问；哈希相同便是具有相同语义或相同授权的对象；从时间先后还原科研因果；自动重建丢失的数据。

### H4 实施前负例
T1 科研决定、T3 补录 T0 数据；同一输入经历两版 Analysis；失败 Observation 无结果；外部 GDF 数据删失；V1 一事件多 Run；未映射旧关系；Assertion 链 100 fs→120 fs 但两个命题各自有独立身份；事后 DecisionBasis 不覆盖 T1 的历史记录。

## S — 语义与命题

### S1 面对的问题
命题即使使用相同词汇、数字，也可能指向不同模型、指标和工况；研究对象可能跨数学、模拟和物理场景。系统需允许未明事项和多主体不同解释，同时确保**已登记的精确语义不随最新词典更新发生隐式改变**。

### S2 最低对象及关系
| 机制 | 所在对象及关系 | 限定 |
|---|---|---|
| Entity 个体身份 | ObjectID 指向物理/数字/数学个体 | 世界与来源须明确或显式 UNKNOWN |
| ConceptRevision、术语和别名 | usesConceptRevision；SKOS 词汇映射 | 名称同义不自动证明科学内涵等价 |
| PropositionID、PropositionRevision | 精确命题内容及各种表示 | 同 ID 保持真值条件，变化实质内容则新 Proposition |
| H AssertionChain | r1→P100，r2→P120 | 历史链由 H 拥有，不在 S 造第二套陈述真源 |
| WorldContext/Scope/Representation | 命题→确切世界、范围和定义版本 | 世界类别不封闭；跨 World 不隐式转换 |
| Association | typed link with source/roles/direction | 可被 Proposition 讨论，但关系本身不成为推理证明 |
| ResearchFrame/Dimensions/Options | 框架定义→具体选择 ContextProfile | 维度及选项为方向共识，具体 Schema/覆盖门未冻结 |
| FormalRepresentation | 命题→自然语言/FOL/Lean 表示 | 公式仅是表示，可靠翻译和科学真值须额外审查 |

### S3 L0/L1 的统一机器门禁
**S-L0（Parseable）**：对象提交符合声明类型的最小输入文法，原内容和来源清晰可保存；语义缺口可以显式 UNKNOWN。H 仍可保留连 S-L0 都未达标的原始记录。

**S-L1（Well-formed）**：按五类对象自己的契约检查必要字段角色、身份、版本引用、ResearchSpace、已声明的 Concept/World/Scope、明确 Unknown 状态；不自动担保 LLM 提取忠于原意，不默认要做完整术语消歧。

**独立 SemanticConfirmation** 不再是机器 S-L1 的同义词。后续 FOL 形式化可作为候选 S-L2（登记标准个体/函数/谓词签名及版本），但无形式化、不完全形式化、FOL 难以忠实表达的命题均可继续获得 S-L0/L1；S-L2 的具体自动去重能力待证。

### S4 高阶命题与对象定位
Proposition 可针对任一对象提出命题，亦可讨论其他命题、关于论证 A 的评价、正式接纳行为或它自身。**自指引用可登记，但不能自动引入无约束的 True(P) 消解规则**。普通“乙说甲接受 P”的命题不得改变甲的正式接纳状态。Association 只表达相关关系；如果要对其科学真实性提出质疑，独立创建 Proposition 并可由 Argumentation 支持。

### S5 必须保证/不保证及反例
保证：旧 Concept/World/命题版本保留；同名/同数值不自动融合；明确区分 UNKNOWN 与错误缺字段；变更后的声明须新版本或新对象；语义注册是开放类型集合而非 Theory/Simulation/Engineering 三值信任阶梯。

不保证：完全可靠的自然语言等价、模型在现实中成立、FOL 公式忠实对应原文、全局概念自动去重。

反例：波形 W1/W2 数值相同但工况不同；100 fs 改为 120 fs；几何/归一化发射度误用；新 Frame 加扫描波形但旧命题不能改写；同一术语定义版本更新；两个不同 ResearchSpace 不允许借公共 Concept 暴露私有实验。

## R — 论证、检验与接纳

### R1 面对的问题
如何在不同科学方法下明确一条论证的结构，保存有条件和可撤回的支持；当依赖 C 失效，如何只标记依赖 C 的论证路径，而不无端撤销独立支持的结论？如何区分检查器通过与有主体的科学接受？

### R2 对象和基本关系
| 概念 | 归属 | 责任 |
|---|---|---|
| EvidenceRelation | Argumentation 子型 | 一项证据在明示背景下对一个精确 Proposition 的局部支持/反对/未决，不要求有无依据数值概率 |
| Argument/ArgumentRevision | Argumentation | 多项前提 AND；多条不同论证 OR；输入角色和条件由 Scheme 定义 |
| Rebuttal/Undercut | Argumentation | 针对命题内容或特定论证条件的攻击；后者可先形成高阶 Proposition |
| InferenceSchemeDefinition | Concept | 开放、版本化方法注册与必要对象角色 |
| ProofObligation | 关于条件的 Proposition / 义务记录 | 有已登记规则来源；OPEN 允许条件性探索；ReviewSuggestion 不自动升级 |
| Assessment | 特殊 Proposition | 评价主体、目标、Scope、结论；允许冲突并存 |
| FactDesignation | 特殊 Proposition | 有权主体的正式接纳/撤销记录；须校验授权来源 |
| FactStanding | 派生状态 | 按命题精确版本、Scope、主体和时间恢复，无全局事实布尔值 |
| FormalProofCertificate | Entity 证书工件 | 明确公式、定理、依赖、公理、版本、环境和可信计算基 |

### R3 R-L0/L1 及多轴推理分类
**R-L0（Parseable）**：正式 Argumentation 必须声明合法的推理 Scheme 类型与版本，机器可解析；“合法登记为归纳”不等于科学分类正确。尚未明晰分类的推理想法可以作为 H 原始记录或 S 的 ResearchFinding 保存。

**R-L1（Well-formed）**：该 Scheme 的必需输入、条件、目标 PropositionRevision、角色类型及引用完整且合法；不保证归纳样本代表性、统计模型适用、类比有效、严密演绎已经证明。

必须保持四轴独立：推理方法（Deduction/Induction/Statistical/Abduction/Analogy/Causal/Default/Practical）、逻辑强度（Strict/Defeasible/Heuristic）、实际验证状态、证据倾向（Support/Rebut/Undercut/Neutral/Unresolved）。单一枚举或“科学正确性总评分”无法替代这四维。

| Scheme | R-L1 最小角色候选 | 更高层科学检查问题（Critical Questions） |
|---|---|---|
| Deduction | 前提命题、结论、规则版本 | 规则是否合法、前提闭合、严格证明的公理/定义 |
| Induction | 观测/样本集合、推广目标和范围 | 代表性、选择偏差、外推条件 |
| Statistical | 数据、方法/统计模型、目标 | 噪声/似然/先验、独立性、检验假设 |
| Abduction | 待解释命题、候选解释 | 竞争解释、区分实验 |
| Analogy | 来源对象、目标对象、声称相似特征 | 重要差异、适用范围 |
| Causal | 因果模型/条件、证据、目标 | 混杂、识别、干预与时序 |
| Default | 默认规则、前提、目标 | 例外条件是否成立 |
| Practical | 目标、备选方案/行动、约束 | 风险、权限、成本及价值取向 |
| Evidential | 证据来源、目标命题、背景 | 数据质量、来源共享与解释依赖 |

### R4 更高检验、义务与严格证明
已登记的规则要求出现的条件可创建 ProofObligation；记录它的状态、来源、依赖。科学探索允许 OPEN，严格认证不得因 OPEN 而冒充完全证明。Lean 核心通过只担保**在明确依赖、公理、形式公式与版本之下的内核证明**；公式是否忠于自然语言、物理模型/测量的现实适用性需单独审查。证明证书、公式对应、规则版本、数据依赖均需精确引用。形式层级 L2 之后尚未冻结，科学充分性不应被结构检查替代。

### R5 非单调和多主体实例
原论证 A1：模型 M + 校准条件 C → 性能 P；独立实验 E1→P。当 C 被质疑，R 可定位 A1 对 C 的精确依赖并提示复审，**不能自动把 E1 相关结论删除**；若 E1 实际使用 C 做数据反演，则它也有依赖，必须显示。甲接受 P、乙质疑 P 作为不同 Assessment 同时存在，项目正式接纳必须由有权主体提交，并由 H 保留原记录。

### R6 不负责
R-L1 不验证 Scheme 选得正确、证据充分、统计真实；普通 Association 不经审查成为 Argumentation；机器的 verification PASS 不自动变成 FactDesignation；R 不负责运行 Agent/实验设备、改变 V1 计划或凭图谱联想生成正式证明义务。

## 交叉核验

- **同一事件真源**：H 保存全部对象生命周期，S/R 是受领域约束的视图与关系；不得在三处重复“当前有效事实”。
- **对象版本固定**：Argumentation 的结论和被引用前提均锚定精确 PropositionRevision；Concept/World/Scope 版本不可使用“latest”隐式替换。
- **ResearchSpace 隔离**：全路径读写/导出及图遍历都必须做授权过滤，公共 Concept 共享不能成为跨 Space 数据泄漏。
- **W3C 精确对齐**：实际 Activity 的 PROV 语义、SOSA Observation/Result、SKOS Concept、PROV 资源来源和领域论证严格分离。
- **PoC 边界**：173/173 是旧 PoC 机械测试数、7/7 是机器植入缺口可达率；真实 V1 历史、人工 A/B、live Gate 无样本或未批准。最新五类对象架构尚无相应独立 PoC，**不可沿用旧测试宣布新方案已通过**。
