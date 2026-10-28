# 跨对象组合约束与反例矩阵

> **PR #42 · DRAFT-PROPOSAL · 2026-10-28。** 把[组合合同 C01–C12](H_S_R_COMPOSITION_SEMANTICS_DRAFT.md) 与 24 类走查场景转成**可直接引用到字段、操作与检查规则**的约束（`CC-*`），并补充本轮细化中新发现的字段级反例（`XC-*`）。共享约定见[共同底座](H_S_R_DOMAIN_FOUNDATIONS_DRAFT.md)。
>
> **本文件不新增对象类别、系统或状态轴**；`CC-*` 与 `XC-*` 只是既有语义的落点编号。**24 类场景是设计走查与未来测试预期，不是已运行测试。**

## 1. C01–C12 → 领域落点

| 约束 | 上游 | 承载字段/记录 | 相关操作 | 检查规则 |
| --- | --- | --- | --- | --- |
| **CC-01** 三时分离且并存；无系统全局真值；现状视图带来源与截点 | C01 | `described_interval`、`recorded_via`、采用记录 `adoption_*`；禁止 `is_current` | IC-A1/A2/A3、IC-H6/H7 | `SL1-ASS-04/06/08`、`SL1-COM-06`、AS-T1 |
| **CC-02** 目标 / 实际结论 / 局部结局三分离 | C02 | `engagement_target`、`engagement_role`、`conclusion`、`conclusion_vs_target`、`local_outcome` | IC-R1/R2/R5 | `SL1-ARG-S1`、`RL1-03/04/05` |
| **CC-03** 构造 / 规范化 / 结局 / 适用 / 验证 / 接纳六轴互不推导 | C03 | `construction_state`、CheckReport、`local_outcome`、`applicability_records`、`verification_records`、接纳投影 | IC-R2/R4/R9/R10 | `SL1-ARG-S3`、AX-01/02、RPT-02 |
| **CC-04** 输入角色、命题范围、论证假设、本次采用四者分立 | C04 | `input_bindings.role_name`、`alignment_claims`、命题 `world_ref/scope_refs`、采用记录 `adoption_scope` | IC-R3、IC-A3、IC-S8 | `RL1-02`、`SL1-PRO-05` |
| **CC-05** 精确对齐不等于同名同值同版本 | C05 | `alignment_claim.relation ∈ {EXACT_MAP, DECLARED_MAP, ASSUMED, UNKNOWN}`、`dimension_binding`、`variable_bindings` | IC-S7、IC-R3 | `RL1-10`、`SL1-CON-04` |
| **CC-06** 图可追踪 ≠ 可组合；无默认支持传递 | C06 | `composition_records`（须引用规则版本与输入集合） | IC-R2/R7 | R-L1 不含“路径即组合”；NEV-02 |
| **CC-07** 路径内 AND、路径间 OR，条件按路径作用域保留 | C07 | `support_paths[].premise_refs`、`path_conditions[].path_scope` | IC-R4 | `RL1-07`、IC-R4 不变量 |
| **CC-08** 并存意见不构成共同公理；不投票不平均 | C08 | 多条 ASSESSMENT 并存；接纳投影按主体/范围分开 | IC-R8/R10 | `SL1-PRO-09`、PR-A2/A4 |
| **CC-09** 共享来源不制造独立证据 | C09 | `shared_dependency_refs` | IC-R3 | `RL1-11`（只查声明，不判独立性） |
| **CC-10** 引用环可记录，不自动获得证明力 | C10 | 对象引用图与证明依赖图可区分；Scheme 专用规则 | IC-R2 | `RL1-12`（只标注，不 FAIL、不授证） |
| **CC-11** 版本、历史检查与重检不混写 | C11 | 全部 `@rev` 精确引用；`verification_records` 追加；`lossReport` | IC-S2/S5/S6、IC-R6 | RPT-01、`SL1-COM-01`、PR-ID-6 |
| **CC-12** 缺失/未知/截断/超时/权限与科学否定分离 | C12 | 五态字段；`F-*` 失败码；边界标注 | IC-H7、IC-R7/R11、IC-P2/P5 | `PENDING_SEMANTICS`/`UNKNOWN` 语义、`SL1-COM-02/03` |

## 2. CS-01–CS-24 映射（预期行为 + 落点）

| 场景 | 涉及对象/字段 | 语义操作序列 | 必须可观察到的结果 | 落点约束 |
| --- | --- | --- | --- | --- |
| CS-01 上游/下游并存 | Association `described_interval=UNKNOWN`、冲突主张 | IC-A1×2 → IC-H6 | 两条并列；切换时刻 `UNKNOWN`；无“T1 被反证” | CC-01 |
| CS-02 今天分析一年前数据 | 采用记录 `basis_ref` 指向当时政策 | IC-A3 → IC-H6(as-recorded) | 使用当时采用配置；不要求今天仍真 | CC-01/CC-11 |
| CS-03 旧布局用于今天 | 新采用记录 + `applicability_context` 明示假设 | IC-A3 | 假设或核验依据可见；无伪造核验 | CC-01/CC-04 |
| CS-04 关联被命题讨论并被质疑 | Association@rev + 元命题 + ASSESSMENT | IC-S8 → IC-R8 | 关联历史不变；无第二套真假状态 | CC-01/CC-08 |
| CS-05 无区分力实验 | `conclusion=NONE_DECLARED`、`local_outcome=INCONCLUSIVE` | IC-R1/R2 | 完整保存；不产出 ¬P；非草稿标签 | CC-02/CC-03 |
| CS-06 数据未补齐 | 路径 `UNBOUND(PENDING_INPUT)`、`construction_state=DRAFT` | IC-R1/R2 | 可保存；R-L1 FAIL 入账；无空占位伪装 | CC-03、`RL1-01` |
| CS-07 归纳完整但样本偏倚 | `R-L1` 达成 + 代表性 Assessment | IC-R2 → IC-R8 | 结构合规与科学质疑并存互不覆盖 | CC-03、NEV-02 |
| CS-08 条件不可核实 vs 已证不满足 | `path_conditions.status=UNKNOWN` 与 `CONTESTED`+元命题 | IC-R4 / IC-R5 | 二者呈现不同；前者不转 ¬C | CC-12、`F-CHECK-UNAVAILABLE` |
| CS-09 适用性检验失败 | META_APPLICABILITY 论证 + `applicability_records` | IC-R1/R5 | A1 与其结论保留；仅本次用途受限 | CC-02/CC-03 |
| CS-10 无尺度程度值 | `degree_value` 缺 `scale_ref` | IC-R2 | `RL1-08` FAIL；禁止比较/平均/相乘；仍保存 | CC-02/CC-06 |
| CS-11 P 与 ¬P 来自不同主体/假设 | 两条 ASSESSMENT + 两条论证 + 分支假设 | IC-R1/R8 | 并存；不合并公理、不平均 | CC-08 |
| CS-12 跨 World 相接 | `alignment_claim=UNKNOWN` | IC-R3 | 阻止被认证组合，允许条件性连接 | CC-05、`RL1-10` |
| CS-13 量词/指标定义不同 | `variable_bindings`、`dimension_binding` | IC-S7 | 差异显式；不因文句相似互换 | CC-05 |
| CS-14 严格条件链 | `composition_records` 保留未解除假设 | IC-R2/R6 | 组合结论带 Γ1∪Γ2；无无条件 Q | CC-06 |
| CS-15 归纳→类比拼接 | 无注册组合规则 | IC-R7 | 仅可追踪；不认证传递 | CC-06 |
| CS-16 替代路径 C1/C2 | `path_scope` 分别绑定 | IC-R4/R7 | 逐路径呈现；不合成 C1∧C2 | CC-07 |
| CS-17 同源双份/证书复制 | `shared_dependency_refs` | IC-R3 | 不提升支持度；共享来源可定位 | CC-09 |
| CS-18 P↔Q 互相引用 | 引用环标注 | IC-R2 | 无自发证；允许存为候选 | CC-10 |
| CS-19 合法递归/共归纳 | 专用 Scheme 声明良基性/基础情形 | IC-R1/R2 | 不因“有环”拒绝；按专用规则检查 | CC-10 |
| CS-20 局部假设导出矛盾 | 论证内假设与解除记录 | IC-R1/R4 | 结论带假设解除过程；不等于全库冲突 | CC-08/CC-10 |
| CS-21 规则/文件变化 | 新 CheckReport + 新可用性记录 | IC-S2、IC-H5 | 旧 PASS 不改写；重现能力单列 | CC-11 |
| CS-22 形式化新增假设 | 表示 `APPROXIMATE` + `added_assumptions`；必要时新命题 | IC-S1/S4 | 不静默改原意 | CC-11、`SL1-PRO-04` |
| CS-23 转述“甲接受 P” | 普通命题/ASSESSMENT；接纳需授权 | IC-R8 vs IC-R9 | 主体/World 限定不丢失；未授权不生效 | CC-04、PR-A1/A2 |
| CS-24 截断/超时/跨空间过滤 | `F-PARTIAL`/`F-CHECK-UNAVAILABLE`/`WITHHELED` | IC-H7/R11/P5 | 边界标注；不报“无反证”；不泄漏 | CC-12 |

## 3. 本轮细化新发现的字段级反例（XC）

这些不是顶层架构反例——均可用五类对象 + 显式关系 + 既有约束表达——但字段设计若疏忽就会破坏不变量，因此登记为可测试负例。

| 编号 | 反例 | 破坏的不变量 | 已落入的字段/检查 |
| --- | --- | --- | --- |
| XC-01 | 把“本次采用”写成关联对象上的反向字段（`adopted_by`） | 多真源；采用行为被写回被采用对象 | AD 系列 + `SL1-ASS-08` |
| XC-02 | 论证内 `path_id`/`condition_id` 随修订重排 | 历史攻击与依赖分析失准（RV-03） | AR-ID-5 |
| XC-03 | 用 `NULL`/空串/空数组表达“未知” | UN-03（未说明 ≠ 说明了不知道） | `SL1-COM-03` |
| XC-04 | 概念词法修订（新增别名）触发把旧 PASS 判为失效 | C11（新别名不改变已检查语义） | IC-S5 不变量 + RPT-01 |
| XC-05 | 把评价目标写成“该命题的最新版本” | ID-05/RF-02；评价随修订漂移 | `SL1-PRO-09` |
| XC-06 | 活动个体导出为 `prov:Entity`；失败观测补造 `sosa:Result` | 不变量 6/D20；W3C 冲突表 | `SL1-ENT-01/02` |
| XC-07 | 把资源可用性写成 Entity 上的布尔字段，并用最新检查覆盖 | A8 是投影；历史可用性丢失 | `SL1-ENT-04`、IC-H5 |
| XC-08 | 表示集合就地增删而不产生新 revision | RP-01；已发布快照被改写 | RP-01、`SL1-PRO-02` |
| XC-09 | 以“关联端点”身份引用另一空间的私有个体（借公共概念入口） | SP-01/SP-02 | `SL1-COM-02`、`F-WITHHELD` |
| XC-10 | 把机器 R-L1 PASS 呈现为“论证已验证”，进而被当作接纳依据 | DF-01/DF-04 | RPT-04、PR-A3 |
| XC-11 | 摘要视图只保留结局、丢掉未解除条件 | AX-02、IC-P2 | `F-PARTIAL` 标注要求 |
| XC-12 | 用同义搜索相似度自动合并两个 Proposition | ID-07、PR-ID-5 | NEV-01、IC-S4 不变量 |
| XC-13 | 证明义务被有权主体豁免后，界面呈现为“已证明” | GAP-03、DF-01（豁免只允许特定使用继续） | 义务状态与检查报告分离 |
| XC-14 | 从“数值预测”直接得到“真实装置成立”，未声明跨越与依据 | GAP-01/GAP-04、C05 | `RL1-13`、`RL1-10` |
| XC-15 | 把 H 检查记录当作论证的输入角色端点 | RF-05（记录不是语义端点） | `RL1-02` |
| XC-16 | 跨空间导入后仍显示源空间对象链接，读者可点进不可见对象 | SP-05/SP-02 | 导入即新建对象；`F-WITHHELD` |
| XC-17 | 把贝叶斯后验直接填成论证支持度 | RD-17、C02（尺度含义不同） | `RL1-08`、Argumentation §8 |

## 4. 一致性自查结论

本轮走查未发现**需要**新增基础对象、第四系统、全局真值源、隐式接纳机制或跨空间穿透访问的场景。两处既有含糊在细化中被消解（见[决策与遗留清单](H_S_R_DECISIONS_AND_GAPS_DRAFT.md) RD 表）：①“关联可被命题讨论”与“论证命题端必须是 PropositionRevision”的表面冲突，由 `engagement_target`（可为关联/论证）与 `conclusion`（必须命题端）分离消解；②PROV 来源关系与 Association 的潜在双写，由“关系只登记一次、来源视图与导出为派生”消解。

**未验证**：本节全部为设计走查，未运行任何 validator、Schema、PoC 或真实科研任务；不构成“24 场景已实现”的声明。
