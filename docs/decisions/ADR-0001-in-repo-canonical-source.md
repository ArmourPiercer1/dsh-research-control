---
id: ADR-0001
status: implemented
title: 契约正源迁入 Git（AD-EB-01）
date: 2026-10-26
supersedes: SI-001（工作区根正本 + 发布期复制；裁决书原件不可访问 = UNKNOWN 缺口）
evidence: [docs/engineering-baseline/gates/G1.md, docs/engineering-baseline/gates/G0-inventory.yaml]
---

# ADR-0001 — 契约正源迁入 Git

- **背景**：SI-001 把「开发期正源」放在插件仓库的父目录，构建时复制/只读化进包根。
  该正源在本机不可访问（G0 三态判定），且复制机制在部分污染父目录下会静默清空
  包内 schema（G1 PoC 取证）。双源位置使「谁是权威」不可机器判定。
- **决策**（用户 2026-10-26 显式批准，批准基准 `main@1d64d9e9`）：本仓根
  `schema/**` + 8 份根文档为唯一可编辑正源；`SNAPSHOT.md` 降为确定性发布清单；
  构建零仓外读写；`DSH_SNAPSHOT_SOURCE_ROOT` 退役。原字节迁移，域语义零修改。
- **后果**：冻结修订统一走 `snapshot:update` 流程；git 安装/干净 clone 与开发态
  完全同构；回退 = revert PR #14（批准哈希在 G0-inventory）。
