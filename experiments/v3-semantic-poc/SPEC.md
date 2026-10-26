# PoC 样本契约 v0（provenance envelope · channel discipline）

> 权威上游：`docs/poc/V3_POC_EXECUTION_PLAN.md` §2（安全约束）与 §4-P0（工作项）。
> 本文件只是其 P0 落地形状；两者冲突时以计划为准并回改本文件。

## 信封（每条导入记录一个 JSON 对象，JSONL 逐行）

```jsonc
{
  "schema": "poc/prov-envelope/v0",
  "source_project": "<项目/Workstream 名>",
  "run_id": "RUN-<scope>-<n>",
  "event_seq": 0,                       // 每 run 内严格 +1、无空洞、不可回退
  "occurred_at": "RFC3339",             // 原始发生时间
  "recorded_at": "RFC3339",             // 登记时间（双时序，可不同，不可互相顶替）
  "snapshot_ref": { "kind": "deck|file|git|none", "id": "<路径/sha>", "content_sha256": "<hex>|null" },
  "access_boundary": "synthetic|sanitized-snapshot|live-mirror",
  "channel": "SOURCE_RECORD|RESEARCHER_INFERENCE|LLM_SUGGESTION",
  "kind": "run.started|run.finished|run.failed|deck.executed|artifact.registered|analysis.performed|observation.recorded|claim.candidate|note.unknown",
  "payload": { },
  "unknowns": [ "<该记录里明确缺失/未知的东西，显式保留，禁止补全>" ]
}
```

**硬规则（校验器 + 测试强制）**
0. **一个文件一个 run**（v0.1 裁定，P0 双代理分歧暴露）：多 run 叙事分文件；
   `event_seq` 文件内从 0 连续。跨 run 全局叙事顺序不属于信封层（由投影层
   时间维度承担）。
1. `channel` 三通道**不混存**：同一文件内允许不同通道的事件行，但
   `SOURCE_RECORD` 的 payload 不得含推测/建议字段（`inference|suggestion|llm_*`
   出现在 SOURCE_RECORD payload = 校验失败）；反之推测/建议通道必须引用
   `based_on: [event_seq...]`（指向其依据的源记录）。
2. 缺失就是缺失：`content_sha256` 可为 `null` + `unknowns` 指路；禁止编造。
3. `event_seq` 断号/重号 = 文件级拒绝；重复导入同一快照必须幂等
   （相同输入 → 逐字节相同的规范化导出）。
4. 旁路级别词只用 `LIVE_PASSIVE / LIVE_REVIEW / CONTROLLED_ADVISORY`；
   `L0/L1`、`L2–L5` 恒指科研形式化等级（M2 决议）。
5. `FACT_RECORDED` 类历史标签只能以 `kind: claim.candidate` +
   `channel: SOURCE_RECORD`（“当时登记过”）出现——不产生科学确认语义。

## Golden annotation（`golden/*.json`）

```jsonc
{ "fixture": "<file.jsonl>", "annotator": "<谁>", "basis": "<依据文本/定位>",
  "assertions": [ { "assertion": "<哪句结论>", "supported_by": [event_seq...],
                    "truly_supported": true, "unrecorded": ["<哪些信息其实没有>"] } ] }
```

标注是**人工裁定的独立文件**，与被标注事件分通道存放；分歧保留在
`disagreements` 数组里（可空），不删除任何一方的原始说法。

## 写入边界（测试强制）
- 允许写：`experiments/v3-semantic-poc/.poc-data/v3/**`。
- 拒绝写：`src/**`、`schema/**`、`.research/**`、任何生产 DB 路径、仓根
  `lib/**`；拒绝即 FATAL（不是静默跳过）。

## 目录
```
experiments/v3-semantic-poc/
  SPEC.md  README.md  vitest.config.ts
  src/               # 信封校验器 / 重放投影（纯逻辑，零 src/host 依赖）
  poc-run.mjs        # 入口：--fixture <f> [--export] （argv-only，无 shell）
  fixtures/          # P0 合成样本（五个最小案例，见 #10 §4-P0）
  golden/            # golden annotations
  samples/gpt-streak/# 真实 GPT 案例：deck(.in) + 观测规格（另一子代理产出）
  **/*.test.ts       # 仅由 pnpm run test:poc 收集（根门禁不收集）
```

## v0.1 裁定（samples 暴露：跨 run 推理）
- 推测/建议通道的 `payload.based_on` 数组元素二选一：**整数**（同文件 seq）
  或 **`{"run_id": "...", "seq": n}`**（跨文件）。跨文件引用必须由调用方提供
  已知 run 解析表（同目录信封文件的 run_id → 该文件 seq 集）；解析表里没有的
  run 或越界 seq = `dangling_external_ref` 拒绝。孤立推理层（只有推测、依据
  全在别处）是合法形态——通道隔离的本意。

## v0 落地裁定（P0 实现暴露的 SPEC 歧义，integrator 2026-10-27 裁定）
1. `based_on` 位于 **`payload.based_on`**；`SOURCE_RECORD` 可选携带，若出现则
   形状与悬空规则同样适用。
2. `event_seq` **从 0 起**严格 +1。
3. `normalizeExport` 保持行序（=文件行序=seq 序），递归排键；空输入=空串。
4. 禁止键名正则 `/inference|suggestion|llm_/` **只作用于键名**、大小写敏感；
   值中出现不触发（通道语义由 channel 字段承担）。
5. `content_sha256` 的 hex = 64 位小写。
6. 硬规则 4（LIVE_* 词汇）是**行文纪律**不作校验器规则；硬规则 5 由 kind
   枚举排除 `FACT_RECORDED` 机械达成。
