# testing.md — 测试世界纪律

> 完整四件套语义见 README「开发」节；这里只记**环境的坑**（每条都有过现场代价）。

- **实例来源**：需要真实 DSH 的一切测试用 `tests/deepseek-harness/`（train 对齐
  `dev/engineering/registry.yaml` host_pins；切 train 必先 `pnpm run clean`）。
  `references/` 只读参考，**不是**测试实例。
- **状态隔离**：`DSH_HOME`、`HOME`（pnpm 11 sqlite 落 `$HOME`）、pnpm storeDir 三者
  全落 `tests/dsh-homes/` 内；起服/探测/关停写进**同一个** bash 调用（会话回收后台进程）。
- **git identity**：部分 fixture（如 `tests/store/tc-db-002`）在测试世界内 `git commit`
  依赖 ambient git 身份——干净环境须注入 `GIT_AUTHOR_*/GIT_COMMITTER_*`（CI 已注入；
  新 fixture 请自带 `-c user.name=...`，别再依赖环境）。
- **临时文件**：`/tmp` 跨调用不保证存在，长链探针用 `.scratch/` 或 `tests/dsh-homes/`。
- **perf**：`test:perf` 全量套跑后紧跟执行可能因负载 flake（TC-PERF-006 已登记）——
  单独重跑为准，不改阈值。
- **tsc 债务**：基线 21 错是**已知失败的身份**（`docs/BASELINE_TSC_BASELINE.md`，
  归一化身份比对），任何报告里不得显示为全绿。
- **构建路径噪声**：build 后 `lib/client.js` 的 `rcm-css:<abs>` 注释差异 = 构建机噪声
  （`check:freshness` 归一化该模式），验证后 `git checkout -- lib/`，不提交。
