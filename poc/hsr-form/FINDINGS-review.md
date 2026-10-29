# 独立审查（基线 `da113bcd`）的复现与处置

审查判 PoC 作为实现放行证据 = **ITERATE**。我逐条自己复现（`.scratch/probe-review.mjs`，夹具逐字取自当时的测试文件），**七条全部成立**，其中两条比审查描述更严重。核心已按规则原文重写；本文件是"哪条规则、原文怎么说、桩件当时怎么做、现在怎么钉住"的反查表。

| # | 审查条目 | 复现 | 规则原文依据 | 修法与钉住方式 |
| --- | --- | --- | --- | --- |
| 1 | `UNRESOLVED` 键集写成 `{@st, reason}` | ✅ 两种编码都被接受 | `SF-17`：`UNRESOLVED → {@st, ref}` | `core.KEYS` 改正；**P1-2 矩阵**对每个状态各有正反例；**P1-10** 断言 `core.KEYS` 与逐字抄自 `SF-17` 的表完全相等 |
| 2 | `UNKNOWN` 带多余 `v` 被接受 | ✅ 接受且无 finding | `SF-17`：**出现集合外的键即形态非法（写入被拒）**；`SF-04` ⑤ 引用 `SF-17` | 新增 `keysOutOfRange()`，在 `ingest` 里作为拒写项（不只是 finding）；矩阵行 `UNKNOWN+reason+v → STATE_KEYS_OUT_OF_RANGE` |
| 3 | 摘要排除集混用（我把 `SCR-54` 的两项当成摘要排除集） | ✅ | `SCR-06`：摘要排除集 = **恰 `{report_digest}` 一项**；`SCR-54`：同形判定排除集 = **恰 `{report_id, checked_at}`** | 拆成 `DIGEST_EXCLUSION` / `SHAPE_EXCLUSION` 两个常量并各断言其**封闭长度**（P3-4/P3-5）；第三个面 `SCR-57` 比较面另计 |
| 4 | `reduceLevel([])` → `ACHIEVED` | ✅ | `SCR-77`：该层无规则适用 → `INDETERMINATE(RULE_UNREGISTERED)`，**不得**为 PASS | 改为 `INDETERMINATE`；P3-2 保留 naive 版作反向锚点 |
| 5 | 父槽位可冒充子路径 | ✅ | `SS-15a`：三处必须**同一形态**（引用位粒度） | 删除前缀容忍 `samePos`，改**精确同名**；`reg.identitySlots` 全部改用契约点名的 `world_membership.individual_ref` |
| 6 | 首次登记 `NONE_DECLARED + CLOSED_DRAFT` 不产 finding | ✅ findings=`[]` | `AR-ID-6`/§4.1：该声明**产生时**须 `SUBMITTED`；`AR-ID-4` 只豁免后续生命周期修订 | 豁免条件收紧为"上一版已声明 `NONE_DECLARED`"；正反例一对（首次登记必违规 / 撤回修订不新增） |
| 7 | PoC-1 夹具不是合法对象：`o1`、`schema_version:"1.0"`、写入信封带 `boundary` | ✅ 整数 `1` 被拒、字符串 `"1.0"` 被接受；缺 `object_id`/`space_id` 被接受 | `SF-04` ②（信封必填结构，`schema_version` 整数见文档两处）+ ④（**引用 pattern 不匹配**，`SF-22` 文法）；`SS-15a` 第③类仅响应 | 夹具全换 `HENT-…` 文法标识 + 整数版本 + 无回显键；新增 `ENVELOPE_REQUIRED_MISSING`/`_SCHEMA_VERSION_TYPE`/`_OBJECT_ID_GRAMMAR`/`_ECHO_KEY_ON_WRITE` 四个拒写码（P1-7/P1-8） |

## 比审查描述更严重的地方

**P3 的分页 `exhausted` 不只是"返回反了"，而是测试跟着断言了错误语义**。文档给的锚点是"可见 200 条、页长 100 ⇒ 第 1 页 `exhausted=false`、第 2 页 `true`"，而当时的 `page()` 返回 `offset + requested < items.length`（这是"还有下一页"，不是"已耗尽"），P3-6 就照着断言了 `p1.exhausted === true` 并注释"最后一页必须报告无后续"。**一条绿的测试在锁死错误行为**——这比漏测更糟，因为它会说服后来者。现 P3-8 用文档原锚点数字，P3-9 把反向实现作为变异锚点断言其必分歧。

## 我自己在这轮新引入的两个错误（审查没抓到，是我复现时撞上的）

1. **给 `registrant_ref` 套了对象引用文法** → 所有写入被 `REF_PATTERN_MISMATCH` 拒。`registrant_ref` 是宿主注入的 V1 主体（`SD-19`/`RD-35`），不适用 `SF-22`。教训：修一条判据时新写的校验同样需要正反例，否则"修好一个 bug"会伪装成"另一个 bug 消失了"。
2. **引用文法全局扫字符串** → `aliases` 里的 `p:1@1`、邮箱都会被当非法引用。`SF-04` ④ 只作用于**契约声明为引用的槽位**（`SF-26/SF-28` 是引用位的规则）。现由 `reg.refPaths` 声明引用位，并在 P1-8 用自由文本正例反向钉住。

## 新暴露的文档缺口（已回文档）

- **`T-GAP-09`**：`space_id` 全层无文法，而 `SF-04` ② 要求"不可解析即拒写"——validator 判不了。留给 B 与 V1 命名空间一并定。
- **`SS-15a` 补**：第③类回显键**只出现在读响应**；出现在写入信封 = `SF-04` ② 非法。
- **`T-GAP-07` / `T-GAP-08` 已裁决**（PR #47 `e1488910`）：其中 T-GAP-08 我原先写"无合法字段可写"是**没查既有机制**——`CO-V-5` 早已规定后继关系由带来源的 Association 记录承载，不是字段。

## 仍未覆盖（承认，不假装）

审查指出 PoC-3 未覆盖缓存 / 日志 / Agent 上下文的泄漏出口，以及完整 CheckReport 脱敏结构——**属实**。这些需要真实呈现层与宿主上下文，属 B（底层架构）会合后的范围；本 PoC 只覆盖纯函数层的呈现等价。幂等部分现已用 `Idempotency` 覆盖跨"重启"（序列化/恢复）、请求体摘要冲突、前置不匹配不占键，但**没有**真实持久化与事务。PoC 分支也没有 GitHub check run：38→42 项通过只是本地报告，不是 CI 证据。

## 结论

审查的判断我接受：**发现了问题，但还没验证规则可同时成立**——因为当时的一部分绿灯是桩件与测试一起错在同一个方向上。现在的差别是每条判据都有正反例 + 变异锚点，错误实现会红，而不是"看起来对"。
