# V3 PoC 与渐进迁移提案

> **讨论性提案，尚未批准开发、时间表或技术选型。** 目标是测试语义边界，不是一次性建成大型知识图引擎。

## PoC 验收

| 验收组 | 正例 | 反例/禁止行为 |
| --- | --- | --- |
| P0 标准 Crosswalk | `prov:Activity/Entity/Agent`、`sosa:Observation/Result`、`skos:Concept` 映射准确 | 旧“Observation 结果”不能直接等于 SOSA 观测活动 |
| P1 来源与失败 | 失败的 Experiment/Detection 保存活动与故障数据；同一 CCD 数据经两版 Analysis 产生两个不同 Result | 不能为了满足约束伪造结果；分析错误不自动删除原始文件 |
| P2 术语与 L0/L1 | 结构化自然语言 L0 后提交者可继续；L1 统一词汇、World/Scope 并保留回访 | L1 语义明确不自动成为科学事实 |
| P3 Evidence/Argument | 同一数据对不同论点产生不同证据关系；联合结果经统计 Argument 形成结论 | 不强制单点后验概率；`prov:wasDerivedFrom` 不当逻辑演绎 |
| P4 非单调 Fact | H1 错误、独立 E1 仍支持工程 P；旧版本依赖精确可回放 | 不级联自动撤销独立证据支持的 P |
| P5 严格数学 | Lean 内核证明精确 Theory 命题，保存定义、Scope 和证书 | 错误自然语言映射、`sorry` 或未授权公理不能冒充严格证明 |
| P6 双图谱 | 从发射度论证→四极扫描数据→CCD/电子枪/电荷量→现有物理推理，返回完整路径 | 上游或统计相关多跳不能自动得出因果、ProofObligation 或 Fact |
| P7 RDF 导出 | JSON-LD 往返保存 ID、版本、来源、科研论证、评价、UNKNOWN 条件 | Named Graph `unverified` 不自动证明数据已隔离 |
| P8 历史兼容 | 旧 C/F/A/REL/Run 完整溯源；V1 工具面稳定 | 旧 `FACT_RECORDED` 不自动升级到新接纳认证 |
| P9 质量边界 | DQV 登记数据质量、SHACL 校验形状 | 通过 DQV/SHACL 不等于 Evidence Adequacy 已得到科学认证 |

## 推荐实施顺序（非正式计划）

| 阶段 | 目标 | 冻结前要求 |
| --- | --- | --- |
| M0 语义对齐 | W3C 名称、方向、等价 vs 扩展 Crosswalk、IRI 方案 | P0 与冲突负例经过审查 |
| M1 Activity/Entity/Result | PROV/SOSA 的基础来源链及 Lifecycle | P1，失败和多次分析均可重放 |
| M2 Concept 与 L0/L1 | SKOS、版本化术语、渐进式提交/确认 | P2，不再混淆 L0/L1 词表层级 |
| M3 Argument & Assessment | EvidenceRelation、组合论证、FactStanding、Lean 局部证明 | P3/P4/P5 |
| M4 两图与召回 | 关联边、只读可组合查询、完整路径输出 | P6，LM 不因关联自动制造科学论证 |
| M5 互操作与 V1 迁移 | JSON-LD Profile、SHACL、双轨回放及权限回归 | P7/P8/P9 |

> **编号对账（#9 ready 前置，EB3 入库复核 M1）**：本文 `P0–P9` 是**验收组编号**、
> `M0–M5` 是推荐实施顺序；与 V3 PoC 分阶段实施计划（PR #10，`docs/poc/V3_POC_EXECUTION_PLAN.md`，合入后即可点链）的阶段门编号 `P0–P4` **互相独立**——裸写「P4」在两个文档中含义不同，
> 引用时必须带文档来源。对照如下：

| #10 阶段门 | 本文验收组 | 本文实施顺序 |
| --- | --- | --- |
| P0 隔离与样本契约 | （环境前提，不映射验收组） | M0 前置 |
| P1 PROV/SOSA 来源与事件重放 | P0、P1 | M1 |
| P2 L0/L1 与历史语义整理 | P2 | M2 |
| P3 Evidence/Argument 与非单调认识 | P3、P4（P5 严格对照可选） | M3 |
| P4 双图谱、召回与互操作 | P6、P7、P9（P8 为横向不变条件） | M4、M5 |

**不变条件**：当前 `main` 的 V1 根目录契约仍有效；迁移属于未来明确批准的实施 PR。`dsh-research-control` 不启动 LLM、分派 Agent 或运行工作队列；PoC 的执行在外部测试工具/Agent 系统完成。
