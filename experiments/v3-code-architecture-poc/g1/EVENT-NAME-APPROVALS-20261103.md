# 机制事件名批准记录（EA-2.4 步骤 2 落地，2026-11-03）

> 批准对象：首版 5 个待消费机制事件名。批准者 = **独立复核席**（`independent-review-seat`，非作者、
> 未参与提案与实现；用户 2026-11-03 指派）。裁定依据 = 逐名实读契约原文，不采信作者摘要。
> **落地状态**：批准已生效；锚文件 `approved[]` 的机械写入待 **PR-1** 物化
> `contracts/event-registry/EVENT-CONTRACT-LEDGER.json` 后，以**独立提交**同批写入（EA-2.4 步骤 3）。

## 1. 签署原文（批准三要素之一：提交 trailer + 锚文件条目）

```
Event-Name-Review: 2026-11-03 independent-review-seat

Approved-By: 2026-11-03 independent-review-seat
  integrity-audit-recorded   —— 机制自身完整性审计每次运行的落账事实，载荷仅计数/digest，不涉领域判断
  read-shadow-recorded       —— 机制读侧遮蔽计数的窗口聚合，R-1 撤键后唯一合法落点
  facet-mounted              —— 机制挂载登记行的全形见证，facet_mount 触发器按名要求，非领域动作语义
  facet-unlinked             —— UNLINK 终标记的对称机制见证，guard 按名与 op 相配，不能由 facet-mounted 代签
  raw-record-declared        —— 原始材料进入台账的机制声明事实，declaredType 仅为数据，尚未成为对象
```

## 2. 逐名裁定与依据（原文摘录；行号以 `148e832` 为准）

| 名 | 判定 | 依据（条款原文） | 消费 PR |
| --- | --- | --- | --- |
| `integrity-audit-recorded` | 批准 | 「`auditRequiredIntegrity()` **每次运行必落一条**机制事件（机制内部直写、预留名）」「两名的 `class:'mechanism'`、`writeSites` 限定在审计/读上下文模块」（EA `:557,559`）；载荷 `{runId, trigger, counts, violationsDigest, …}` 无 oid/revision（`:580-586`） | PR-2 |
| `read-shadow-recorded` | 批准 | 「读侧遮蔽计数（`hiddenByContractSkew`/`hiddenByInactiveCapability`）的聚合落账事件」（`:558`）；「其唯一合法落点是本节的 `read-shadow-recorded` 行（内部审计通道，EA-7.4 通道封闭）」（`:602`） | PR-2 |
| `facet-mounted` | 批准 | 「FM-2 挂载登记（**机制事实**，A1 形态）」（FACET `:106`）；触发器「事件名与 op 相配（MOUNT⇒`facet-mounted`）否则 ⇒ `MOUNT_AUDIT_REQUIRED`」（`:173-174`）；内核词汇只增 {挂载登记, 双身份, facet-mount 轴}「**无科研词**」（`:363`） | PR-7 |
| `facet-unlinked` | 批准 | 「解除挂载（unlink）…`facet-unlinked`…追加 UNLINK 终标记行；**历史代永久可读**」（FACET `:275`）；由 `:173` 的按名判据，UNLINK 不可能由 `facet-mounted` 代签 | PR-7 |
| `raw-record-declared` | 批准 | 「Raw 信封的台账行固定名 = 「raw-record-declared」（机制封闭名单成员，机制内部直写）」（EA `:104`）；`declaredType` 「机制**不解释、不登记、不据以命名**」（`:109`） | PR-10 |

**共同核查**：五名均在已入账 7 名之外（EA `:222-226` vs `:239-241`）；全部 `class:'mechanism'`，
OA-2（`:302`）使 owner 只能是机制，不存在归某 Capability 所有的问题。

## 3. 批准者如实指出的两处措辞偏差（不影响判定，记录备查）

1. `read-shadow-recorded` 记录的是**窗口聚合**（载荷含 `windowStartSeq/windowEndSeq`，EA `:589-591`），
   不是单次读取；「recorded」应读作「一次落账」而非「一次读」。⇒ 本记录与后续实现描述统一为「窗口聚合落账」。
2. 材料包 `EVENT-NAME-APPROVAL-SHEET.md` 的锚文件路径用 `contracts/event-registry/…`，而 EA §6.1 `:485`
   仍写 `g1/EVENT-CONTRACT-LEDGER.json`。按专题⑤（`G2-DEV-PLAN.md:252`、`G1-ACCEPTANCE-MATRIX.md:234`）
   正式承载面**已裁**为 `contracts/event-registry/`；§6.1 那句为旧路径，落地按前者。材料包正确。

## 4. 落地义务（PR-1 执行，非作者复核已知悉）

1. 锚文件物化时，5 名的 `planned:true` → `false`（属 §6.2 R4 豁免行，可在名单侧独立提交），
   `approved[]` 追加 5 条 `{approvedBy:"independent-review-seat", approvedOn:"2026-11-03", anchor:<本文件>}`。
2. 该提交信息带 `Event-Name-Review: 2026-11-03 independent-review-seat` trailer，且**独立于**任何写点实现提交。
3. `ns-relocated` 不入本批（PR-8 DEFERRED），保持 `planned:true, gated_by:'G1-NS-01'`。
4. 批准**不改变**任何判据：五名的形状、写点、通道与 fail-closed 语义仍按各自条款；本记录只兑现「谁批准」。
