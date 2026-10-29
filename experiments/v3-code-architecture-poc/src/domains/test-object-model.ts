/**
 * **合成领域插件（测试专用）**：只用于证明"领域语义由插件声明、Kernel 按注册表路由"
 * （#44 §5.3、§6）。它**不实现** PR #42 五类对象的字段、状态机或校验政策；
 * 这里的 kind 标签与规则一律是占位物，不得被引用为科研语义政策的实现。
 */
import type { PluginManifest } from '../contracts/index.ts';

export const CAP_OBJECT_MODEL = 'cap.test.object-model';

export const TEST_OBJECT_MODEL: PluginManifest = {
  pluginId: 'test.object-model',
  codeVersion: '0.0.1',
  provides: [{ capability: CAP_OBJECT_MODEL, contractVersion: 'v1' }],
  requires: [],
  storageNamespace: 'dom_test_om',
  // 领域事件以 Ledger 载荷为唯一权威，不另建事件表（#44 §7.1「历史双写」）。
  eventAuthority: 'ledger-payload',
  ownsKinds: [
    { kind: 'test.subject', capability: CAP_OBJECT_MODEL },
    { kind: 'test.claim', capability: CAP_OBJECT_MODEL },
    { kind: 'test.relation', capability: CAP_OBJECT_MODEL },
  ],
};

/** 拆包后的同一能力实现：pluginId 变、capability 不变（#44 §6.1 / Q44 的验证材料）。 */
export const TEST_OBJECT_MODEL_SPLIT: PluginManifest = {
  ...TEST_OBJECT_MODEL,
  pluginId: 'test.object-model.split',
  codeVersion: '0.0.2',
};
