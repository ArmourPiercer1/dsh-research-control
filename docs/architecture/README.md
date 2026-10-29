# V3 科研语义架构｜文档索引

> **上层讨论基线，非运行时规范** · PR #42 最新主基线为五类对象 × H/S/R。旧稿保留但以最新主基线裁决为先。仓库根目录现有 `ARCHITECTURE.md` / `DOMAIN_SCHEMA.md` 仍为 V1 实现的正式契约；本目录**尚未实现**。

| 文档 | 职责 | 裁决状态 |
| --- | --- | --- |
| [H/S/R × 五类对象：统一架构设计](H_S_R_FIVE_OBJECT_ARCHITECTURE_DRAFT.md) | **本轮最新主基线**：五类对象、三正交系统、级别、身份、共同不变量 | Draft · 优先阅读 |
| [组合语义合同与收口审查](H_S_R_COMPOSITION_SEMANTICS_DRAFT.md) | 关联时间/使用、局部结局、Draft、条件/冲突/循环/版本组合；24 类设计反例 | Draft · 顶层基本运行语义 |
| [五类对象与旧设计归属对账](H_S_R_OBJECT_MAPPING_DRAFT.md) | PROV/SOSA、Concept、World/Scope、Evidence/Argument、Assessment/Fact、V1 对象逐项归类 | Draft · 含候选映射 |
| [H/S/R 系统级详细合同](H_S_R_SYSTEM_CONTRACTS_DRAFT.md) | 逐系统问题、对象关系、L0/L1、案例、跨界约束 | Draft · 非 Schema |
| [领域契约共同底座](H_S_R_DOMAIN_FOUNDATIONS_DRAFT.md) | 身份/修订/精确引用、字段五态、四类时间、八条正交状态轴、四类引用、隔离与通用不变量 DF-01–DF-10 | Draft · 细化层入口 |
| [Entity 领域对象契约](H_S_R_ENTITY_CONTRACT_DRAFT.md) | 指称个体子型、字段、身份判据、资源缺失与版本变化 | Draft · 非 Schema |
| [Concept 领域对象契约](H_S_R_CONCEPT_CONTRACT_DRAFT.md) | 术语/定义/World 类型/维度/谓词签名/**Scheme 定义**与概念修订规则 | Draft · 非 Schema |
| [Association 领域对象契约](H_S_R_ASSOCIATION_CONTRACT_DRAFT.md) | 关系记录字段、三种时间落点、冲突与替代主张、采用记录 | Draft · 非 Schema |
| [Argumentation 领域对象契约](H_S_R_ARGUMENTATION_CONTRACT_DRAFT.md) | Scheme 绑定、输入角色与对齐、路径/条件、结局、攻击与验证记录 | Draft · 非 Schema |
| [Proposition 领域对象契约](H_S_R_PROPOSITION_CONTRACT_DRAFT.md) | 命题身份与表示边界、World/Scope、评价/接纳/义务子型 | Draft · 非 Schema |
| [H/S/R 领域交互契约](H_S_R_INTERACTION_CONTRACT_DRAFT.md) | 领域操作 IC-*：语义/输入/前置/结果/不变量/失败语义；非服务接口 | Draft · 非 API |
| [S-L0/S-L1 与 R-L0/R-L1 规范化契约](H_S_R_NORMALIZATION_CONTRACT_DRAFT.md) | 三线判定（结构/待补/不可判定）、分对象规则、R-L0/R-L1、八种记录形态与负面清单 | Draft · 供后续 validator |
| [跨对象组合约束与反例矩阵](H_S_R_COMPOSITION_MATRIX_DRAFT.md) | C01–C12 与 CS-01–CS-24 落到字段/操作/检查；新增 XC-01…XC-24 字段级反例 | Draft · 设计走查 |
| **Schema 层** · [编码基座](H_S_R_SCHEMA_FOUNDATIONS_DRAFT.md) | 规范形态、五态/引用/时间/数量编码、摘要与版本纪律（PR #47） | Draft · 依赖未合并的 #42 |
| **Schema 层** · [对象 Schema](H_S_R_OBJECT_SCHEMA_DRAFT.md) | 信封、五类载荷槽位表、子型注册表（PR #47） | Draft · 非 Schema 文件 |
| **Schema 层** · [检查 Schema](H_S_R_CHECK_SCHEMA_DRAFT.md) | 报告/finding/level_result 编码、两视图脱敏形态、规则注册表（PR #47） | Draft · 非 Schema 文件 |
| **Schema 层** · [注册表 Schema](H_S_R_REGISTRY_SCHEMA_DRAFT.md) | 编码层词表条目与退役、名称映射双射（PR #47） | Draft · 非 Schema 文件 |
| **接口层** · [接口基座](H_S_R_INTERFACE_FOUNDATIONS_DRAFT.md) | 调用包络、错误与授权呈现、侧信道防护、幂等、分页、双时相（PR #47） | Draft · 非服务设计 |
| **接口层** · [接口目录](H_S_R_INTERFACE_CATALOG_DRAFT.md) | IC-* 逐操作的请求/响应形态与失败码（PR #47） | Draft · 落地属冻结面变更 |
| **接口层** · [Schema 决策与遗留](H_S_R_SCHEMA_DECISIONS_DRAFT.md) | SD-* 取舍登记、需回写 #42 的修订请求 A-*、风险与验证边界（PR #47） | Draft |
| [与 V1 冻结词汇的接入对照](H_S_R_V1_LEXICON_RECONCILIATION_DRAFT.md) | V1 关系/事件词汇的新落点、禁止事项与有损报告要求 | Draft · 不改 V1 |
| [方向裁决与待决设计缺口](H_S_R_DECISIONS_AND_GAPS_DRAFT.md) | 既定共识、组合收口、细化裁决 RD-*、F-01–F-09 实施准备分类、旧设计冲突 | Draft · 审查索引 |
| [H/S/R 早期系统级审查稿](H_S_R_SYSTEM_DESIGN_DRAFT.md) | 保留上一轮对象关系/缺口视图；未按最新五类完全改写 | 较早 Draft |
| [H/S/R 早期三系统顶层基线](H_S_R_TOP_LEVEL_ARCHITECTURE_DRAFT.md) | 保留本 PR 首轮 H/S/R 讨论历史；旧 Assertion/L1 术语需以最新主基线为准 | 较早 Draft |
| [ARCHITECTURE_BASELINE](ARCHITECTURE_BASELINE.md) | 使命、边界、顶层分层、图谱、可靠性 | 原则性基线 |
| [CORE_SEMANTICS](CORE_SEMANTICS.md) | Activity / Entity / Result 到 Assertion / Evidence / Argument | 语义候选 |
| [W3C_ALIGNMENT](W3C_ALIGNMENT.md) | 完整 crosswalk、标准术语、冲突和迁移 | D20 对齐基线 |
| [ADR D13–D20](adr/README.md) | 决策原因、已确定事项、禁止误读 | 原则已同意，细节未冻结 |
| [OPEN_DESIGN_QUESTIONS](OPEN_DESIGN_QUESTIONS.md) | 仍需讨论的概念、规则和技术接口 | 未裁决 |
| [POC_IMPLEMENTATION_PLAN](POC_IMPLEMENTATION_PLAN.md) | PoC 负例、迁移提案和验收准则 | 建议而非排期 |

**读序**：主基线 → 组合合同 → [共同底座](H_S_R_DOMAIN_FOUNDATIONS_DRAFT.md) → 所需对象契约 → [交互契约](H_S_R_INTERACTION_CONTRACT_DRAFT.md) → [规范化契约](H_S_R_NORMALIZATION_CONTRACT_DRAFT.md) → [反例矩阵](H_S_R_COMPOSITION_MATRIX_DRAFT.md)。细化层只下沉细节，不改变主基线与 C01–C12 的裁决；同一字段定义只在其对象契约中出现一次。

[旧版 V3 架构长稿](../design/V3_TYPED_RESEARCH_EPISTEMICS_ARCHITECTURE_DRAFT.md) 仅保留讨论历史；不再作为最新基线或当前 W3C 命名依据。

## 语义与权威优先顺序

1. **V1 当前运行**：根目录规范与代码为当前实现真源，新的术语不自动改变 API、事件、数据库或权限。
2. **V3 讨论**：本文目录的主干基线、核心语义和 W3C crosswalk 说明当前建议；D13–D20 的原则性 ADR 记录共识，尚不代表实施合同。
3. **标准优先命名**：含义与 W3C 完全等价的术语直接采用 W3C 正式名称，旧自定义名称可以废弃。仅当含义不同或需扩展时使用 `dsh:` 类型。
4. **科研认知不等于标准蕴涵**：RDF/OWL/SHACL 不能替代非单调科研 FactStanding、科学推理或证据充分性评价。

## 操作边界

`dsh-research-control` 是基础设施：登记、查验、索引、溯源和返回上下文。**不编排 Agent**：形式化、LLM 审查、运行时权限、唤醒、执行由外部 `dsh-agent-team` / DSH / 用户控制。
