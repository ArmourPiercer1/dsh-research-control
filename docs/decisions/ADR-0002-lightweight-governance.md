---
id: ADR-0002
status: accepted
title: 轻量工程治理，不建 Authority Snapshot 系统（AD-EB-02）
date: 2026-10-26
---

# ADR-0002 — 轻量工程治理

- **决策**：治理面 = Git 单正源 + ADR + `doc-ownership.yaml` 归属映射 + 短
  `AGENTS.md`（≤~200 行）+ `docs:probe/check/sync` 三薄入口（共享内核）+ GitHub CI。
  不建 Authority Snapshot / 协调服务 / 第二真相系统；派生信息一律生成物 +
  标记块，人写文档与派生索引物理分离。
- **状态语义**：gate verdict 与 adr status 独立词汇、互不推导；实证声称必须
  携带可存在的 evidence 路径，`docs:check` 只裁静态一致性。
- **后果**：规则演进集中在 `scripts/docs/kernel.mjs`（改规则=改规则本身，PR 需
  红/绿 PoC）；高风险面 blocking 逐步升级，普通模块 UNOWNED 保持 advisory。
