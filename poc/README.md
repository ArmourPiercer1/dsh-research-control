# HSR Schema PoC（A 段，刻意最小）

回答一个问题：**PR #42 / #47 的形态与校验规则能否同时成立**。不是产品代码，
不接正式研究数据，不碰 V1 冻结接口，不含持久化与服务层，不上 S-L2/L3。

```sh
node --test poc/hsr-form/*.poc.mjs        # 53 项，node:test，不进 vitest 收集面
```

| 单元 | 覆盖 | 结果 |
| --- | --- | --- |
| `poc1-form.poc.mjs` | 最小形态（SF-22 文法 + 整数版本 + 无回显键）、**五态逐态键集正反例矩阵**、空集合正负（含严重度）、`NOT_APPLICABLE_*` 两码、稀疏展开、拒写封闭五项、**引用位类型域**（object / record / either）、候选载荷、判据表变异分辨力 | 12/12 |
| `poc2-identity.poc.mjs` | 根世界单例（**按不同 ObjectID 计数**）与受控豁免、§4.1 四行与首次登记/生命周期正反例对、身份变化分流、退役码边界、摘要重放、三个变异断言 | 25/25 |
| `poc3-check.poc.mjs` | RPT-02 归约 + `SCR-77` 零覆盖、三个排除集分离、`S` 常量逐键穷举（两页长）、**XC-25 两世界逐字节同形**、隐藏条数不泄漏、过滤/分页顺序、分页真相、写入幂等跨重启 | 16/16 |

**两轮独立审查的处置记录**（反查表：`hsr-form/FINDINGS-review.md`）：

- 第一轮（基线 `da113bcd`）判 ITERATE：七条缺陷全部复现成立并修好，`core.mjs` 按规则原文重写。
- 第二轮判 ITERATE（四项）：P0 部分可见报告的 verdict 泄漏、P1 合法 `rec:` 来源被拒、
  P1 空集合严重度、P1 单例按修订记录计数——四条**全部复现成立**并已修复，每项配"错误实现必红"负例。
  修复过程中又发现两个自己引入的缺陷（嵌套引用位从未被检查、类型域缺失），一并记录。

判据实现集中在 `hsr-form/core.mjs`，**每条注明对应的文档规则号**，便于反查忠实度；
`FINDINGS-pocN.md` 是产出本体——PoC 的价值在发现，不在绿灯数。

## 夹具不是合法对象（范围声明，第二轮审查要求明确）

**这三组用例验证的是"简化形态机制"，不是完整 S-L1 合法性。** 夹具里的最小实例与正式
Object Schema 的偏离是**已知且刻意保留**的（本轮的指令是"只定向修四项，不扩大 PoC 范围"）：

| # | 夹具写法 | 正式 Schema 的写法（`H_S_R_OBJECT_SCHEMA_DRAFT.md` 槽位表） |
| --- | --- | --- |
| 1 | `world_membership.kind_ref` / `.individual_ref`、`conclusion.proposition_rev` 写成裸引用字符串 | 类型是 `ref?` = **五态包裹的引用**（`{"@st":"DECLARED","v":"HCON-wt@r1"}`） |
| 2 | `aliases` 取 `['x']`、`['e:root','p:1@1']` | 元素是 `{alias: text, source: ref? \| rec:, claimed_interval: time?}` |
| 3 | `alt_labels` 取 `['x']` | 元素是 `{text, language}` |
| 4 | `participants` 取裸引用字符串数组 | 元素是 `{role_ref, endpoint_ref: ref, is_standard_subject?}`，且基数 ≥ 2 |
| 5 | 槽名 `description` / `statement` / `definition` | **这三个槽名在契约与 Schema 文档里都不存在**，是夹具自造的占位名（`grep` 实测命中 0） |
| 6 | poc1 的信封构造缺 `recorded_at`、`identity_slot_set_digest`、`revision_id` | 三者属 SS-15a 第①类结构常量；桩件只把 `object_id`/`space_id`/`schema_version`/`subtype_code` 当必填 |
| 7 | `carrier_refs` / `availability_checks` 的**元素其它键**不做形态核验 | 未知键判定只作用于载荷**顶层**键，不递归进元素 |
| 8 | 子型条目 `PHYSICAL_OBJECT` / `CONCEPT_PLAIN` / `ASS_REL` / `ARG_SCHEME` / `PROP_PLAIN` 是自造的 | 只有 `WORLD_ROOT` 的条目内容有契约原文（`EN-W-7`）；正式子型注册与退役流程不在本 PoC 面内 |

由此得到两条读法约束：

- 绿灯的含义是"**这几条判据自洽、且错误实现必红**"，不是"这些对象在正式 Object Schema 下合法"。
- 反过来，凡是本轮**改到**的判据（引用位类型域、空集合严重度、单例计数、脱敏同形），
  其正反例都已换成文档里真实存在的槽位与真实取值形态，不受上面第 1–5 条偏离的影响。

## 命名说明

文件名用 `.poc.mjs` 而非 `.test.mjs`：vitest 的默认 include 会匹配 `**/*.test.mjs`，
用后者会把这些 `node:test` 用例收进 `pnpm test` 并以 vitest 语义执行。已实测
`poc/**` 不被 vitest 收集（见 FINDINGS 附注），因此本目录不改变仓内测试面。
