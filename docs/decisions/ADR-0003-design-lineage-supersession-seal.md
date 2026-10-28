---
id: ADR-0003
status: implemented
title: 设计文档代次谱系：supersedes 机验边 + design_lines 登记 + 哈希封存归档（B+）
date: 2026-10-27
evidence: [scripts/seal-superseded.mjs, tests/engineering/seal-superseded.test.ts, tests/engineering/eb2-docs.test.ts, docs/development.md]
---

## 背景（为什么现有机制不够）

需要清晰表达两层语义：①设计文档实现前多轮迭代，一版进实现、其余留档；
②按第一代实施，执行到某节点后转按第二代实施。既有机制能**记**但只有一半能
**查**：ADR `supersedes` 字段有约定、零机验（kernel 不读）；被取代的旧文档没有
"不得冒充现行"的机器约束；"留档"只有 git 历史与两个互不相同的先例
（`e2e/v1-archived/`、本地 `archive/` 分支），没有可验证形态。真实病因已发生过：
BASELINE_READY 证书硬编码 "V3=Draft"，#9/#10 合并后该行失真运转多日（审查
P1#4 逮获）——**设计代次的当前态没有登记面，叙述就会腐烂**。

## 决策

采纳 DSH Agent Notes 已验证的三条规则，按本仓量级裁剪（不做双语三元组、
不建封闭类别树、不建索引）：

1. **取代机验边**（`scripts/docs/kernel.mjs`）：`supersedes` 值中 `ADR-\d+`/`D\d+`
   形态 token 建机验边——目标必须存在（`SUPERSEDE_DANGLING`）；取代者 accepted+
   时被取代者必须 `superseded`（`SUPERSEDE_STALE_AUTHORITY`）且正文回链
   （`SUPERSEDE_BACKLINK`）；proposed 边未生效，旧代合法现行。散文化仓外引用
   （SI-001）不建边。状态词汇新增终态 `superseded`。
2. **切换界标登记**：`registry.design_lines`（人工节）= 现行文档 + 首代原件 +
   切换裁定锚（本仓提交，git 上下文可解析）+ 封存策略；`DESIGN_*` 码机验路径
   与锚。语义边界诚实声明：**"哪代生效"仍是人工事实**，机器只保证登记的
   路径与锚不撒谎。
3. **哈希封存归档**：`docs/architecture/superseded/` + `SEAL.yaml`（单行条目
   路径|sha256|日期|origin），`scripts/seal-superseded.mjs` 校验：原件不可改
   （append-only）、未登记件红、origin 必填、清单只指树内。封存树非现行权威。

## 后果

- V3 是当前唯一登记线：现行 = V3 契约草案（DRAFT-PROPOSAL），首代 =
  `docs/poc/V3_POC_EXECUTION_PLAN.md`，切换锚 `80e546e`（§8 ITERATE 裁定）；
  V3 批准的同 PR 执行首代封存。
- 门禁成本 +1 脚本 + 若干 kernel 检查（全在既有 docs:check/测试内跑，无 CI
  新步骤）；红/绿证据见测试文件（`SUPERSEDE_*`/`DESIGN_*`/`SEALED_*` 逐码负例）。
- 被拒备选：维持纯叙事（已证实会腐烂，见背景）；照搬 DSH 全套生命周期目录树
  （量级不匹配，审查结论"不再加治理系统"）。
