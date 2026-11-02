# 机制事件契约锚文件（`EVENT-CONTRACT-LEDGER.json`）

> 依据：`experiments/v3-code-architecture-poc/g1/G1-CONTRACT-EVENT-AUTHORITY.md` **EA-6.1**（形状与唯一正源）、
> **EA-6.2**（R1–R4 判据）、**EA-2.4**（新增机制事件名的批准流程）。
> 本 README 只是**使用约定说明**，不是契约条文；判据文本以 EA 合同为准。

## 1. 这个文件是什么

机制事件名的**唯一正源**（单一、版本化、机器可读）。生产代码与对账脚本**只许**读这个路径
（`contracts/event-registry/EVENT-CONTRACT-LEDGER.json`）；`experiments/**` 下的同名文件即使存在也**永久不是**
生产名单来源（专题⑤ P2-③ 裁决）。

两个字段族：

- `entries[]`：机制事件名的清单。`planned:false` = 已入账（运行时预留 + 写点必须存在）；
  `planned:true` = 已批准/已定形但**尚未落码**，带 `gated_by` 指向挂起裁决。
- `approved[]`：EA-2.4 步骤 2 的**人工批准记录**（批准三要素的锚文件一侧，另一侧是提交 trailer
  `Event-Name-Review: <日期> <批准人>`）。

## 2. 本仓补充约定（`anchor` 的 `#<eventType>` 片段 + 可解析路径）

EA-6.1 的 `approved[]` 形状只有 `{approvedBy, approvedOn, anchor}` 三个字段，**不含**事件名字段。
为了让「哪条批准记录覆盖哪个名字」可机验，本仓约定：

> **`anchor` 字符串必须以其覆盖的 `eventType` 的 `#<eventType>` 片段结尾。**
> 例：`experiments/v3-code-architecture-poc/g1/EVENT-NAME-APPROVALS-20261103.md#integrity-audit-recorded`。

对账脚本据此判定「机制条目缺批准 = 红」：每个 `class:'mechanism'` 条目都必须有**至少一条** `anchor`
以 `#<eventType>` 结尾的批准记录。这是一条**落在既有形状内的编码约定**，不新增字段、不改 §6.1 形状。

**光有后缀不算批准**（PR-1 独立审查 P1-3 的修法）。对账脚本对每条记录做四件事：

1. `anchor` 的路径部分必须是**仓内已存在文件**（`legacy:<id>` 见下条）；
2. 该文件必须含**逐字** `Approved-By: <approvedOn> <approvedBy>` 行（锚与签字同源，日期/人逐字对齐）；
3. 该文件必须**提到**被批准的名字（覆盖关系不是凭空后缀）；
4. `approvedBy` 不得是实现者形态（`implementer`/`author`/`self` 等）——这是**形态拦截**，
   真身份属人工面；缺失时不得当作已批准。

`legacy:<id>` 锚（本仓无 `CONTRACTS.md`，既有评审事实只能以事实标识表达）走**显式白名单**：
`legacy:C-19`（C-19 既有评审事实，CONTRACTS.md §16.3 / D-27，只覆盖它的 5 个名）、
`legacy:EA-5.2`（EA-5.2 存量升格就地，只覆盖它的 2 个名）。白名单以外的 `legacy:` 锚一律红，
**且 legacy 锚还绑定它历史上覆盖的名字集**——`legacy:C-19#某个新名` 不算批准（否则白名单就是签新名的后门）。

提交侧：任何**新增批准记录**的提交必须带 `Event-Name-Review: <日期> <批准人>` trailer
（`EVENT_RECON_UNSIGNED`），且该提交**独立于**写点实现提交。

## 3. 变更纪律（EA-2.4 步骤 3 + EA-6.2 R4）

| 变更 | 提交要求 |
| --- | --- |
| 新增/删除机制名、改 `owner`/`class`/`writeSites`/`gated_by` | **语义行变更**：与写点代码**必须分居两个提交**（R4 `EVENT_RECON_COUPLING`）；新增名还需批准记录先落（独立提交 + trailer） |
| `planned: true → false` 翻转（代码落地） | R4 **豁免**，可与写点同 PR，但仍建议独立提交便于评审 |
| `approved[]` 追加 | R4 **豁免**，但必须独立于写点提交（EA-2.4 步骤 3），且提交信息带 `Event-Name-Review:` trailer |
| `planned:true` 条目 | 必须带 `contractRef: "<仓内路径>#<gate-id>"`：路径须存在（只查存在性，不解析正文——recon 不得有第二个读取源），gate-id 须与 `gated_by` 一致且 ∈ 闭集 |
| 批准锚路径变更 | 仅**已登记搬迁根**（`experiments/v3-code-architecture-poc/`）与 `legacy:<id>` 规范化放行，其余须 `Event-Name-Review:` trailer。**已知残余（未闭合，登记在案）**：①「前缀嵌套」——先提交 `docs/mine/docs/a.md`（该步不受闸门管辖），再把锚改成它，`endsWith('/'+旧路径)` 会放行；②「legacy → 自撰文书」——旧锚不可解析时任意父提交已存在路径被当作「规范化」。两条均需先埋一份文书，修法已由复核席给出（收紧 `legitReanchor` 两处），**尚未落地** |
| 自验名单 | `EXPECTED_MUTANT_NAMES` 是架空间标题的**集合等值**断言（不是计数下界）：删一条、改名一条、两条合并成一条都会红。**仍不防有意弱化**（把某条断言改成 `true \|\| …`，名字不变、闸门仍绿）——那一层最终只能靠评审看 diff |
| 注释/排序/格式化 | 豁免（**按解析后的 JSON 判定**：`sha^` 与 `sha` 两份文档逐 entry 深度相等即视为纯格式变化） |

> R4 的判定**不按 diff 行文子串**（把名单压成单行 JSON 就能让整段豁免——那是已修掉的绕过形）：
> 它解析两个版本的 JSON，逐 entry 比字段。转发写点（`a.eventType`）的归属核对也按 **AST 调用**判定，
> 注释或字符串里出现 `formalEventOwner` 字样不算核对。`planned` 只豁免 `true→false` 一个方向；
> 新增/删除条目、任何其它字段变化、批准记录的删除或改写，一律算语义行。

## 4. 本地复现

```sh
node scripts/events-recon.mjs                          # R1–R4（默认扫 src/**，生产根）
node scripts/events-recon.mjs --impl-root experiments/v3-code-architecture-poc  # 迁移前的证据跑（PoC 根）
node scripts/events-recon.mjs --anchor <file>           # 换一份锚文件（自验/演练用；默认读本仓正式路径）
node scripts/events-recon.mjs --commit <sha>            # R4 + 批准 trailer：单提交检查
node scripts/events-recon.mjs --self-test               # 十八条架空形（R1–R4、批准三要素、转发写点）
```

关于「写点事实集」的三类写法（都算写点，判据不同）：

| 写法 | 归类 | 判据 |
| --- | --- | --- |
| `eventType: 'name'` / `insert into ledger(...) values(..., 'name', ...)` | 名字事实 | R1：必须在名单内 |
| 同文件 `const EVT = 'name'` 再传入 | 名字事实（常量解析） | 同上；解析不到（函数返回/import/拼接）⇒ 按违规处理 |
| `a.eventType` / `e.eventType` 这类转发形 | **转发写点**（无名字本体） | 同文件必须有归属/名单核对（`formalEventOwner` / `registry.*` / `MECHANISM_AUDIT_EVENT_TYPES`），否则红 |

## 5. 与本仓批准文书的偏离登记（如实登记，不静默）

`experiments/v3-code-architecture-poc/g1/EVENT-NAME-APPROVALS-20261103.md` §4.1 的落地义务写的是
「物化锚文件时把 5 名从 `planned:true` 翻成 `planned:false`」。本 PR **没有翻**，理由与依据：

- EA-2.4 步骤 3 的语义是「新名**先入账**、独立提交」，而 `planned` 的语义（EA-6.1 行内注）是
  **代码是否已落**；PR-1 明文「任何域名不得进账」，五名的写点代码要到 PR-2/PR-7/PR-10 才落。
- 若此刻翻成 `false`，`R2`（入账名必须有写点）会立刻对五个名字报红——那不是更强的判据，
  而是把「未落地」谎报成「已落地」。
- 因此本文件保持 `planned:true` + `gated_by`；**翻面动作与写点代码同批**（PR-2/PR-7/PR-10），
  届时按 EA-2.4 步骤 5「护栏同批」一并落地。此偏离已在本行登记，供复核席位判断是否接受。
