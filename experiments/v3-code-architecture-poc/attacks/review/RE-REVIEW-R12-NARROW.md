# RE-REVIEW R12 (NARROW)

进行中，尚无结论。

## 进度日志（逐步追加）

- [x] 建立本文件（标题 + 进行中）。
- [x] 确认基线：分支 `poc/v3-code-arch-20261030`，HEAD `32ceef0`（≥ 44e854e）。
- [x] 通读 `src/kernel/read-context.ts`（130 行）、`src/kernel/kernel.ts`（807 行）。
  初步定位到读面：`readRevision`（kernel.ts:303，判据已装）、`readAsOf`（read-context.ts:42，剔除+计数）、
  `readSnapshot`→`UnitOfWorkImpl.readLatest`（kernel.ts:721，判据已装）、
  `PluginFace.readOwn`→`NamespaceWriterImpl.readLatest`（kernel.ts:552，判据已装）、
  `eventsFor/eventsOf`（kernel.ts:407/417，读 ledger，ledger 无 contract_version 列）。
- [ ] 读 projection.ts / sqlite-port.ts / harness/world.ts / contracts。
- [ ] 找 readRecord / migrateLegacyRecords / raw 裸读 / 第四处写 domain_state 路径。
- [ ] 跑既有夹具 contract-version-skew.test.ts 验证构造法可用。
- [ ] 逐出口写攻击测试并实测。
- [ ] 任务二：hiddenByContractSkew 二分枚举实验 + 裁决。
