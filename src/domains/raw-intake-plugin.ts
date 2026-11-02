import type { PluginManifest } from '../contracts';
import { RAW_RECORD_DECLARED } from '../kernel/kernel';

/**
 * 记录域插件的归属账（EA-3.1 全形）：`raw-record-declared` 是**记录域拥有的正式事件**。
 *
 * 这份清单是 R-9 的「登记」一半。另一半是 deny-by-default 翻转（锚文件 `planned:false`）。
 * 两者必须同一提交——只登记不翻面，名字仍算「待落库」，对账看不出它已经可用；
 * 只翻面不登记，装配期就会因「写入者不存在」而 `ACTIVATION_IMPOSSIBLE`。
 *
 * `truthSource: 'ledger-payload'`：这条事件的真相就在自己的载荷里（原文 + 来源引用），
 * 不指向某个投影表——原始记录是**源头**，不是派生。
 */
export const RAW_INTAKE_PLUGIN: PluginManifest = {
  pluginId: 'synth:raw-intake',
  ownsEventTypes: [
    {
      eventType: RAW_RECORD_DECLARED,
      capability: 'raw-intake' as never,
      requiresAuthority: 'space-write',
      truthSource: 'ledger-payload',
      interpretationRuleSetVersion: 'g1/fa3b892',
      contractVersion: 'ferry/v1',
      approval: {
        approvedBy: 'independent-review-seat',
        approvedOn: '2026-11-01',
        anchor: 'experiments/v3-code-architecture-poc/g1/G1-CONTRACT-DOMAIN-COMMAND.md#raw-record-declared',
      },
    },
  ],
} as PluginManifest;
