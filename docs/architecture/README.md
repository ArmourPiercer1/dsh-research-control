# V3 科研语义架构｜文档索引

> **上层讨论基线，非运行时规范** · PR #9 形成既有架构方向，2026-10-27 增补 H/S/R 顶层讨论稿。仓库根目录现有 `ARCHITECTURE.md` / `DOMAIN_SCHEMA.md` 仍为 V1 实现的正式契约；本目录**尚未实现**。

| 文档 | 职责 | 裁决状态 |
| --- | --- | --- |
| [H/S/R 系统级设计审查稿](H_S_R_SYSTEM_DESIGN_DRAFT.md) | 逐系统问题、功能边界、对象—关系架构、推理方法、多系统合同与缺口矩阵 | Draft 候选／逐项待裁 |
| [H/S/R 顶层架构讨论基线](H_S_R_TOP_LEVEL_ARCHITECTURE_DRAFT.md) | 使命、问题边界、三正交系统、共用不变量与后续讨论项 | Draft 提案，非实施契约 |
| [ARCHITECTURE_BASELINE](ARCHITECTURE_BASELINE.md) | 使命、边界、顶层分层、图谱、可靠性 | 原则性基线 |
| [CORE_SEMANTICS](CORE_SEMANTICS.md) | Activity / Entity / Result 到 Assertion / Evidence / Argument | 语义候选 |
| [W3C_ALIGNMENT](W3C_ALIGNMENT.md) | 完整 crosswalk、标准术语、冲突和迁移 | D20 对齐基线 |
| [ADR D13–D20](adr/README.md) | 决策原因、已确定事项、禁止误读 | 原则已同意，细节未冻结 |
| [OPEN_DESIGN_QUESTIONS](OPEN_DESIGN_QUESTIONS.md) | 仍需讨论的概念、规则和技术接口 | 未裁决 |
| [POC_IMPLEMENTATION_PLAN](POC_IMPLEMENTATION_PLAN.md) | PoC 负例、迁移提案和验收准则 | 建议而非排期 |

[旧版 V3 架构长稿](../design/V3_TYPED_RESEARCH_EPISTEMICS_ARCHITECTURE_DRAFT.md) 仅保留讨论历史；不再作为最新基线或当前 W3C 命名依据。

## 语义与权威优先顺序

1. **V1 当前运行**：根目录规范与代码为当前实现真源，新的术语不自动改变 API、事件、数据库或权限。
2. **V3 讨论**：本文目录的主干基线、核心语义和 W3C crosswalk 说明当前建议；D13–D20 的原则性 ADR 记录共识，尚不代表实施合同。
3. **标准优先命名**：含义与 W3C 完全等价的术语直接采用 W3C 正式名称，旧自定义名称可以废弃。仅当含义不同或需扩展时使用 `dsh:` 类型。
4. **科研认知不等于标准蕴涵**：RDF/OWL/SHACL 不能替代非单调科研 FactStanding、科学推理或证据充分性评价。

## 操作边界

`dsh-research-control` 是基础设施：登记、查验、索引、溯源和返回上下文。**不编排 Agent**：形式化、LLM 审查、运行时权限、唤醒、执行由外部 `dsh-agent-team` / DSH / 用户控制。
