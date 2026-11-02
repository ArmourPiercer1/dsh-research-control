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

## 2. 本仓补充约定（`anchor` 的 `#<eventType>` 片段）

EA-6.1 的 `approved[]` 形状只有 `{approvedBy, approvedOn, anchor}` 三个字段，**不含**事件名字段。
为了让「哪条批准记录覆盖哪个名字」可机验，本仓约定：

> **`anchor` 字符串必须以其覆盖的 `eventType` 的 `#<eventType>` 片段结尾。**
> 例：`g1/EVENT-NAME-APPROVALS-20261103.md#integrity-audit-recorded`。

对账脚本据此判定「机制条目缺批准 = 红」：每个 `class:'mechanism'` 条目都必须有**至少一条** `anchor`
以 `#<eventType>` 结尾的批准记录。这是一条**落在既有形状内的编码约定**，不新增字段、不改 §6.1 形状。

## 3. 变更纪律（EA-2.4 步骤 3 + EA-6.2 R4）

| 变更 | 提交要求 |
| --- | --- |
| 新增/删除机制名、改 `owner`/`class`/`writeSites`/`gated_by` | **语义行变更**：与写点代码**必须分居两个提交**（R4 `EVENT_RECON_COUPLING`）；新增名还需批准记录先落（独立提交 + trailer） |
| `planned: true → false` 翻转（代码落地） | R4 **豁免**，可与写点同 PR，但仍建议独立提交便于评审 |
| `approved[]` 追加 | R4 **豁免**，但必须独立于写点提交（EA-2.4 步骤 3） |
| 注释/排序/格式化 | 豁免（不含语义） |

## 4. 本地复现

```sh
node scripts/events-recon.mjs                          # R1–R4（默认扫 src/**，生产根）
node scripts/events-recon.mjs --impl-root experiments/v3-code-architecture-poc  # 迁移前的证据跑（PoC 根）
node scripts/events-recon.mjs --commit <sha>            # R4：单提交耦合检查
node scripts/events-recon.mjs --self-test               # 四条判据各配一条架空形（应各自非 0）
```
