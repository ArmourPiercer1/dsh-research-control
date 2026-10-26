# V3 语义 PoC（PR #10 计划 · P0 起步）

> **状态：PoC 沙盒（计划 `docs/poc/V3_POC_EXECUTION_PLAN.md`，P0 阶段进行中）。**
> 本目录是侧车：不接线 `src/host`、不触碰 V1 `.research/**` / 生产 DB / 11-tool 面 /
> Git checkpoint。侧车错误绝不成为主任务或主门禁的依赖（#10 §2.1 失败隔离）。

- 运行器：`pnpm run test:poc`（独立于根门禁，主 `pnpm test` 不收集本目录）。
- 输出区：`.poc-data/v3/`（gitignored；临时 SQLite/JSONL 只落这里）。
- 样本契约与来源信封：见 [SPEC.md](SPEC.md)。
- 三通道（源记录 / 研究者推测 / LLM 补充建议）永不混存——信封 `channel` 字段
  强制，测试捕获混存。
- 真实 GPT 样本案例（`.in` deck 与观测规格）：`samples/gpt-streak/`。
