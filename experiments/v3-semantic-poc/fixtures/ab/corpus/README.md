# AB 合成任务包（机械植入答案键）——P4 召回对照替代面

**合成声明**：本目录全部为**合成**信封事件（`access_boundary=synthetic`；sha256 为
`'d1'*32` 式的合成假 hex，不对应任何真实工件）。范围裁定（2026-10-26）：#10 P4 的
「脱敏真实任务四组人工标注 A/B」素材不存在 → **N/A（范围裁定）≠ PASS**。本包是
**机器植入缺口 + 机器可达性测量**的替代面：测量的是「机器从该读法可达的植入缺口」，
**不是人类问题发现质量**。

## 结构

| 文件 | run | 植入缺口（答案键 `planted.json`） |
|---|---|---|
| env-ab-a.jsonl | RUN-AB-A | 无（健康对照；含 actor 确认记录 → w3c 状态门 asserted 例） |
| env-ab-b.jsonl | RUN-AB-B | GAP-01 claim based_on 断链（引用不存在的 seq 99：P0 记 dangling_based_on 问题，推理视图 broken_references 列账） |
| env-ab-c.jsonl | RUN-AB-C | GAP-02 无锚经验联想（第二条 experience_association 无 source）；GAP-04 artifact sha=null 且 unknowns 空（seq2 为「null+unknowns 指路」对照，非缺口） |
| env-ab-d.jsonl / env-ab-e.jsonl | RUN-AB-D / RUN-AB-E | GAP-03 共享 deck sha 但两 run 间无 REGISTERED_FINDING（机制未登记） |
| env-ab-e.jsonl | RUN-AB-E | GAP-05 REGISTERED_FINDING 指向不存在的 RUN-AB-A#99 |
| env-ab-f.jsonl | RUN-AB-F | GAP-06 claim 显式关系仅 CONTEXTUALIZES（无 SUPPORTS 支持关系） |
| env-ab-g.jsonl | RUN-AB-G | GAP-07 claim 依据的事件位于 run.failed 的失败运行 |

`planted.json` = 机器植入答案键：每个缺口有 ground-truth 边/事件定位（run_id#seq）
与预期检出属性。四读法（rawScan / inferenceOnly / associationOnly / bothAlternating）
的 hits 一律回锚到答案键定位；不可回锚的检出列入 extras，不冒充缺口。
