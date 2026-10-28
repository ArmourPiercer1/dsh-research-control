# 注册表与词表的 Schema（编码层词表，不是领域定义）

> **PR #47 · DRAFT-PROPOSAL · 2026-10-29。** 规定**编码层自身**的开放/封闭词表条目形态、注册与退役纪律、名称映射表形态。编码基线见[Schema 基座](H_S_R_SCHEMA_FOUNDATIONS_DRAFT.md)。**Proposed，不表示已实施。**

## 1. 本文只管一类东西：编码层词表

| 编号 | 规则 |
| --- | --- |
| SRG-01 | **领域定义不是词表项**。关系类型、推理 Scheme、程度尺度、WorldType、量纲/单位、采用政策在领域层是 **Concept 对象**（有自己的身份、修订、来源与论证引用，见[对象 Schema](H_S_R_OBJECT_SCHEMA_DRAFT.md)），**不得**被降级注册为本层的字符串词表项。 |
| SRG-02 | 判据（可机验）：某取值若需要 **来源、声明者、修订历史、被论证引用、被评价** 中任一项，它就必须是 Concept 对象；只有"形态标签/枚举代码"这类**无主体、无来源、无修订**的取值才是词表项。把领域定义塞进词表 = 制造第二真源并使其脱离规范化检查（DF-02、DF-08）。 |
| SRG-03 | 本层词表的**取值内容**不在本文列举，只定义条目形态与出处要求；每个词表的取值以 `contract_ref` 指向契约层原文（EB1 单正源）。 |

## 2. 两个注册表面

| 表面 | 内容 | 开放性依据 |
| --- | --- | --- |
| **形态枚举**（closed） | 存在状态标签 `@st`、`outcome`、`severity`、`coverage`、时间 `precision`、层级名 `level`、`role`/`stance` 中契约标注封闭者 | N-02："除明确标注封闭者外均为开放注册"；封闭者变更 = 契约层变更 |
| **注册词表**（open） | `FAIL` 理由码、`NOT_APPLICABLE` 理由、关系角色名的**形态约束枚举**、`role_kind`、投影类型、视图授权类、导出 Profile 名 | N-02 开放注册；每项必须有契约出处（SRG-20） |

| 编号 | 规则 |
| --- | --- |
| SRG-10 | 词表头：`{vocabulary_id, openness ∈ {CLOSED, OPEN}, contract_ref, version, entries[]}`。`CLOSED` 词表出现未注册条目 → **形态非法**（写入被拒，`TOOL_INPUT`）；`OPEN` 词表见 SRG-21。 |
| SRG-11 | 词表版本 = 该版本条目集合的 `record_digest`（SF-52）；条目集合变化即新版本。词表本身是非对象记录，可被 `rec:` 引用（ID-08）。 |
| SRG-12 | 词表条目**只增不改不删**：`{entry_code, status ∈ {ACTIVE, DEPRECATED}, introduced_in, deprecated_in?, contract_ref, note?}`。已被历史记录使用的码**永不退役**（SF-64），使其永远可解析。 |
| SRG-13 | 退役条目仍参与解析与展示（附 `DEPRECATED` 标注），但新登记使用它时产生 `FAIL(CODE_DEPRECATED, DEFICIENCY)` 型 finding——提示而非阻断（DF-07）。 |

## 3. 未注册取值的处置（不许一刀切）

| 编号 | 规则 | 依据 |
| --- | --- | --- |
| SRG-20 | 每个 `OPEN` 词表条目必须有 `contract_ref`（文件 + 规则号或小节）。无出处的码**不得**注册；Schema 一致性检查对无出处条目报错。 | SF-02、EB1 |
| SRG-21 | 提交记录里出现 `OPEN` 词表中的**未注册码**：记录**仍然保存**（保存不受阻），产生 `FAIL(VOCABULARY_CODE_UNREGISTERED, DEFICIENCY)`；不得当作"未知取值即未知状态"，也不得静默归一化为近似码。 | DF-07、RPT-08 |
| SRG-22 | 若未注册的原因是**该词表版本所在空间不可见**（授权过滤），呈现为 `INDETERMINATE(WITHHELD_REFERENCE)` 而非 `FAIL`；判定次序先过滤后判定（SP-02、SF-15）。 | RPT-08 |
| SRG-23 | 未注册码**不得**被自动补注册、自动映射到近似码或"最接近项"。相似度不是登记行为（ID-07、DF-08）。 | UN-02 |
| SRG-24 | **注册是受权写操作，且 `contract_ref` 必须可机验**：注册表写入需要调用者持有该词表的**注册权**（与普通记录写权限分离的独立授权类；无注册权 → `F-DENIED-WRITE`，目标空间不产生条目）。`contract_ref` 不是自由字符串——注册一致性检查必须能解析到落点并确认该处确有此码或其语义定义；解析不到或所指处无此码 → 条目非法（不得启用），若已启用则整表标记 `INCONSISTENT` 且相关码**按未注册处置**（保守取 `FAIL(VOCABULARY_CODE_UNREGISTERED)`）。理由：`SRG-20` 只要求"有出处"，若出处由登记者自填且不核验，任何人都能注册一个引用空位的码，从此使用它的记录不再被判未注册——**注册行为本身就成了洗掉检查的通道**，这与子型 `identity_slots` 无锚是同一类漏洞（注册表在记录之上）。注册动作自身是非对象记录（`rec:` 可引用），带声明者与时间，永不删除（SF-64），且**不回溯**：历史记录按其 `vocabulary_version` 重放（SF-62）。 | UN-02, SF-64, SF-62 |

## 4. 名称映射表（SF-02 的落点）

```
name_map_entry = { canonical_key, contract_reading_name, kind_scope[], direction ∈ {IDENTITY, RENAMED_FROM},
                   since_schema_version, note? }
```

| 编号 | 规则 |
| --- | --- |
| SRG-30 | 默认状态是**同名**：`canonical_key == contract_reading_name`，此时**不必**登记条目（避免千余条噪音）。只有真正改名时才登记，且 `direction` 必须显式。 |
| SRG-31 | 映射必须**双射**：一个规范键名只能对应一个阅读名，反之亦然。同义词表、"也称作"列表、多对一压缩一律禁止——它们会静默改变规则与字段的对应关系（SF-02）。 |
| SRG-32 | 改名是新 `schema_version` 的变更；旧记录按其 `schema_version` 解释，**不回填改写**（SF-62）。 |
| SRG-33 | 与 W3C 标准词的关系**不写进名称映射表**：精确等价只在导出 Profile 中声明（DF-10、CO-SKOS-*），内部键名不因标准名而自动改名，标准名也不改变内部五类分类。 |

## 5. 与检查层的分工

| 编号 | 规则 |
| --- | --- |
| SRG-40 | 检查层的理由码注册表与规则注册表条目形态在[检查 Schema](H_S_R_CHECK_SCHEMA_DRAFT.md) §6–§7 定义；本文只规定**它们共用的生命周期字段**（`status/introduced_in/deprecated_in/contract_ref`），不重复其内容。 |
| SRG-41 | 呈现层专用取值（`UNVERIFIABLE_REFERENCE`、`UNVERIFIABLE_TO_YOU`、`NOT_DISCLOSED` 的呈现语义）在注册表中标 `storage_forbidden: true`，供写入前校验器拒绝落库（SCR-52、SCR-33）。 |

## 6. 负面清单

不做：把领域定义（关系类型/Scheme/尺度/WorldType）注册为词表项（SRG-01）；删除或改写已用码；无出处注册；相似度自动注册或自动映射；同义词名称表；把 W3C 名当作内部改名理由；用词表项承载"当前有效/已验证"语义（SF-N-02）；让词表成为绕过 Concept 修订链的旁路（CO-REV-*、DF-02）。

## 7. 落地的最小验证预期（供后续测试设计，非已运行）

1. `CLOSED` 词表出现新码 → 写入被拒；`OPEN` 词表出现新码 → 保存成功 + `FAIL(VOCABULARY_CODE_UNREGISTERED)`。
2. `DEPRECATED` 码：历史记录仍可解析；新登记使用它产生 DEFICIENCY 而不阻断。
3. 出处检查：无 `contract_ref` 的条目被一致性检查拒绝。
4. 名称映射双射检查：构造两条互相冲突的映射 → 检查报错。
5. 跨层泄漏检查：`storage_forbidden` 码写入 CheckReport → 写入前校验拒绝。
6. 领域定义旁路检查：试图以词表项形式提交一个"关系类型"（带来源与声明者）→ 被识别为需要 Concept 对象（SRG-02 判据）并拒收。

## 8. 本层尚未裁决的内容

具体词表的完整取值清单（各契约文档为其正源）；跨空间共享词表的发布流程（契约层已列为未裁决）；W3C 导出 Profile 的注册表内容（属导出层设计）；词表变更的评审流程（属治理，非本层）。
