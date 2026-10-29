# `attacks/**` —— 独立复验与裁决席位的产物（非作者产出）

本目录下的文件由**独立审查席位**（不同会话、不同上下文的子代理）产出，作者只负责搬运入库，
**未改动其中任何内容**。单列此说明，是为了让这些材料与作者的实现成果（`src/**`、`tests/**`、
根目录交付文档）在归属上不被混淆。

## 席位 → 文件对照

| 文件 | 产出方 | 说明 |
| --- | --- | --- |
| `review/RE-REVIEW-R3.md` | 第 3 轮审查席位群（**多模型交叉**） | 本项目迄今唯一一次跨模型交叉复验；P0（R3-A，`PluginFace.revisionOf` 跨能力越界读）由此次发现 |
| `review/RE-REVIEW-R5-R8.md`、`review/r5r8-sql-guard-attack.test.ts`、`review/r5r8-semantics-attack.test.ts` | 席位 `1faae161`（`qiyuan-self/qwen3.8-27b`，第 28–29 轮） | 第 5–8 轮修复的独立复验；**新 P1（D-15）由此产生**；24 例中 7 红的性质见席位自述与 `EVIDENCE.md` |
| `review/RE-REVIEW-R9-R12.md` | 席位 `69cae4e2`（`qiyuan-self/qwen3.8-flash-next`，第 28 轮） | 第 9–12 轮修复的独立复验。**与父代理同模型、不同上下文**，报告开头自带"证明力低于跨模型交叉"声明 |
| `review/RE-REVIEW-R12-FOREGROUND.md` | 前台席位（`qiyuan-self/qwen3.8-27b`，第 27 轮） | 扫描面失败形态裁决 + `eventsOf` 出口核查 |
| `review/RE-REVIEW-R12-NARROW.md` | 席位 `e4c2b36f`（`qwen3.8-27b`） | **仅有进度日志，无结论**；该席位后被作者中止——中止决策的错误已在 `REVIEW.md` §22 记录 |
| `review/ADJUDICATION-scan-face.md`、`review/ADJUDICATION-scan-face.oracle-probe.test.ts` | 席位 `68578d2e`（`qiyuan-self/qwen3.8-27b`） | 单问题独立裁决（选 B）+ 遮蔽计数可枚举性的实测探针 |
| `review/CANARY.md` | 席位（`qwen3.8-27b`） | **通道自检桩**，三行，无技术内容；保留仅为佐证"后台委派通道当时可用"这一诊断 |
| `review/r5-contention-repro.test.ts`、`review/r5-with-dml.test.ts` | 第 5 轮事务/历史席位（具体模型未在本会话日志中确证） | 多进程争用与 DML 守卫复现 |
| `compliance/compliance-findings.md`、`compliance/SNAPSHOT-*.txt` | 合规席位（模型未确证） | 8 条 P2 合规发现（C1/C2/C5–C9/C11）与快照证据 |
| `review/RE-REVIEW-G0-B.md`、`review/re-review-g0b-attacks.test.ts` | 席位 `260b99c7`（`qiyuan-self/qwen3.8-27b`） | G0 首批修复的独立复验（D-15 轴 + 门禁完整性）。**结论：无新 P0/P1；4 条新 P2**（N-1 恒空视图残留、N-2 主张强于实现、N-3 视图异常无降级、N-4 登记缺口）。实测在独立 worktree 完成后已移除 |
| `review/RE-REVIEW-G0-A.md`（待落盘） | 席位 `570abdf5`（`qiyuan-self/qwen3.8-27b`） | G0 逃逸面复验（D-7/D-16/D-17 + `.constructor` 逃逸 + `g0-gate.mjs` 可绕过性）。**已产出真 P1：`tx.constructor` 取回类引用后静态回读方法可达**，作者已按 WeakMap 修法修复 |
| `evolution/*.test.ts` | 长期演化席位 | 契约版本偏差、生命周期时序、旧 schema 计数器等 |
| `semantics/*.test.ts` | 语义组合与安全边界席位 | 停线词汇、报告身份、覆盖度归约、浮动引用等 |

## 三条阅读须知

1. **作者未改动本目录任何文件**。若发现某处断言与产品现状不符，那是席位的断言原貌，
   不要假定是作者写的或作者改过的。
2. 其中**部分已跟踪文件在席位侧被后续修改过、且可能仍是中间态**（作者未验证是否为最终稿），
   本仓库照原样搬运。
3. `attacks/**` **不在 `tsconfig.json` 的 include 内**，所以"类型门干净"不覆盖这里；
   `vitest` 会收集它们，因此全量计数里包含审查方的红条——逐文件性质见 `../EVIDENCE.md`。
