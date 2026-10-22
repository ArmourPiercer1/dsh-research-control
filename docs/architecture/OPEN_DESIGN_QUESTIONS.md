# V3 开放问题（未批准的设计细节）

> 这是**未决事项清单**，不是待执行 Task。详见 [基线](ARCHITECTURE_BASELINE.md) 和 [D13–D20](adr/README.md)。

| ID | 问题 | 不得突破的原则 |
| --- | --- | --- |
| Q01 | `prov:Entity` 的物理设备/数据/RegistryEntry 如何区分？ | W3C 同义直接用标准名；资源与登记状态分离 |
| Q02 | `sosa:Observation` 与 `sosa:Result` 在仿真估计、复杂分析结果中如何精确映射？ | 观测行为≠观测结果；不能强行 SOSA 化所有理论产出 |
| Q03 | Experiment、Analysis、Run 的 Activity 生命周期如何映射？ | 失败实验保留、不得伪造结果 |
| Q04 | WorldContext、Scope、谓词签名和外部本体的最小注册模型？ | 开放可扩展，跨 World 不隐式换用 |
| Q05 | W3C 术语 URI、版本与旧 V1 ID 怎么保持长期一致？ | 旧科研 History 和来源不能丢失 |
| Q06 | EvidenceRelation 一对一结构何时不能表达联合证据？ | 组合统计与推理不能被单点概率相加替代 |
| Q07 | Argument 规则 / 背景 / rebuttal / undercut / 非单调传播如何兼容 ASPIC+、Carneades、ATMS？ | 不自动从形式系统推出 FactStanding |
| Q08 | L2–L5 形式化能力最终是等级还是偏序向量？ | L0/L1 协作原则稳定，科学真理不等于形式化深度 |
| Q09 | Lean 与自然语言陈述的对应由谁审查，是否允许不完全形式化？ | 核验证不自动保证自然语言或现实含义 |
| Q10 | Fact 接纳及多评审冲突如何决策？ | 接纳有责任主体、时间和证据，不是单 LLM 分数 |
| Q11 | 双图谱关联边类型、统计依据、方向、时间和 Scope 如何保存？ | 只供召回，不作为因果蕴涵 |
| Q12 | 外部 LLM 怎样自由选择图、hop、过滤和剪枝；查询如何审计/限资源？ | 不由 dsh-research-control 决定查询策略或执行 Agent |
| Q13 | ReviewSuggestion 何时由研究审查升级为 ProofObligation / ResearchQuestion？ | 检索结果不会自动生成正式义务 |
| Q14 | Anomaly 的来源、定向影响、去重和重新开放如何维护？ | 不把异常自动当成物理反例 |
| Q15 | Project 级共享知识与 V1 Workstream 历史的事件 owner 如何重构？ | 不形成多真源；不抹除 V1 事件 |
| Q16 | JSON-LD、SHACL、图数据库/SPARQL 的实际成本与收益？ | W3C 不意味着要强制 RDF 原生存储 |
| Q17 | 何时把用户/Agent 的 L1 结果导出为可由外部 OWL 推理器消费的事实？ | **候选科研论点不得自动变成实证真理** |
| Q18 | 采用 W3C 标准草案或最新版本时如何兼容旧数据？ | Crosswalk 有版本、重映射有测试 |

**推荐讨论顺序**：Q01–Q05 → Q06–Q10 → Q11–Q14 → Q15–Q18。先把标准映射及科研论证语义确定，再谈 Schema、API、图数据库选型与交互细节。
