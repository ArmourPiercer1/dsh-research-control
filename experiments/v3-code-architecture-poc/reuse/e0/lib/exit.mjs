// E0 出口实测——「只读 Investigator 式出口」能否**不建 Principal/Space/权轴**就做出来。
// 档位声明：本文件是宿主 API 的**模型形**（形状逐点对齐 0.2.0-rc.2 源码，锚见标注）；
// defineTool/ToolRuntime 实测需 Cordis Scoped ctx 上下文（直接 import 构建产物调用即抛，
// 实测记录：packages/core/tools/lib 直调 defineTool → TypeError），故无法在裸 node 里起真
// 注册面——「止于模型形」是实测结论，不是回避。起真宿主要什么：见 README §4。

// @e0-reuse host tests/deepseek-harness/packages/core/tools/src/index.ts:607 — PreToolDecision 判别联合照宿主封闭形状：allow | deny{reason} | cancel | ask{reason?}
export const decision = {
  allow: () => ({ kind: "allow" }),
  deny: (reason) => ({ kind: "deny", reason }),
  ask: (reason) => ({ kind: "ask", reason }),
};

// @e0-reuse host tests/deepseek-harness/packages/core/tools/src/schema.ts:554 — defineTool 形状（name/description/parameters/execute）；真物需 Scoped ctx，此为其数据形
export function defineTool({ name, description, parameters, readOnly, execute }) {
  return Object.freeze({ name, description, parameters, readOnly, execute });
}

// @e0-reuse host tests/deepseek-harness/packages/core/tools/src/index.ts:1063 — register 的「全局或 per-agent scope 注册、scoped shadow globals」形状；
// 可见性 = per-scope 工具集（这就是「scope 工具可见性」本身，不是自造替身）
export class ToolScope {
  constructor(name) {
    this.name = name;
    this.tools = new Map();
  }
  register(tool) {
    this.tools.set(tool.name, tool);
    return () => this.tools.delete(tool.name);
  }
  visible() {
    return [...this.tools.keys()];
  }
}

// @e0-reuse host tests/deepseek-harness/packages/core/tools/src/index.ts:153 — 'tools/pre-execute' waterfall 的决策形状：exec{tool,scope} → PreToolDecision；
// 只读出口的全部闸门 = 这条 deny 规则 + 上面的 scope 可见性——没有 Principal/Space/权轴参与
export function preExecuteGate(readScopes, { allowlist = null } = {}) {
  const readOnly = new Set(readScopes);
  return function gate(exec) {
    const { scope, tool } = exec;
    if (readOnly.has(scope.name)) {
      if (!tool.readOnly) return decision.deny(`scope "${scope.name}" is read-only: tool "${tool.name}" is not readOnly`);
      if (allowlist && !allowlist.has(tool.name)) return decision.deny(`tool "${tool.name}" not in read-only allowlist`);
    }
    return decision.allow();
  };
}

// @e0-reuse host tests/deepseek-harness/packages/core/system-prompt/src/index.ts:454 — section(name/order/content) 注册返回 disposer 的形状
export class PromptSections {
  constructor() {
    this.items = [];
  }
  section(sec) {
    if (!Number.isFinite(sec.order)) throw new TypeError(`prompt section "${sec.name}" order must be a finite number`);
    this.items.push(sec);
    return () => {
      this.items = this.items.filter((s) => s !== sec);
    };
  }
  render() {
    return [...this.items].sort((a, b) => a.order - b.order).map((s) => s.content);
  }
}

// @e0-reuse host tests/deepseek-harness/packages/client/ui-renderer/src/client/registry.ts:120 — slots 是 **client 面** SlotRegistry 形状（host 插件 ctx 无 slots）；
// 只读面板 = 往 'settings.section' 槽挂数据形状，与写能力完全无关
export class SlotsClientSide {
  constructor() {
    this.bySlot = new Map();
  }
  register(slotName, panel) {
    const list = this.bySlot.get(slotName) ?? [];
    list.push(panel);
    this.bySlot.set(slotName, list);
    return () => this.bySlot.set(slotName, list.filter((p) => p !== panel));
  }
  observe(slotName) {
    return Object.freeze([...(this.bySlot.get(slotName) ?? [])]);
  }
}

// @e0-reuse new — 「无 Principal/Space/权轴」的机验：闸门决策的输入只有 (scope名, tool.readOnly)，源码面扫不到身份/租户/权轴构造；
// 这条断言把「只读出口不需要新身份体系」钉成可机验事实（若日后有人往 gate 里塞 principal，扫描即红）
export function assertNoIdentityMachinery(...modules) {
  const banned = /\bPrincipal\b|\bTenant\b|authorityAxis|createSpace\(|\bAclEntry\b/;
  for (const src of modules) {
    const hits = src.split("\n").filter((l) => banned.test(l) && !l.includes("assertNoIdentityMachinery") && !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.includes("banned"));
    if (hits.length) throw new Error(`E0_INVARIANT 出口面混入身份/权轴机械: ${hits[0].trim()}`);
  }
  return true;
}
