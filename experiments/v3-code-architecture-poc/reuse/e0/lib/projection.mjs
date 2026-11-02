// E0 投影——从事件流重放折叠出「断言/证据/评估/standing」读面；缺字段恒 UNKNOWN 禁补全（读侧执行点）。

export const UNKNOWN = "UNKNOWN";

// @e0-reuse own src/host/history/replay/state-map.ts:1-135 — 「replay → state-map（投影）」的形状（事件流折叠成时点态）取自生产 replay/ 的 state-map 职责；E0 的折叠规则为领域新写
export function project(events) {
  const assertions = new Map(); // assertionId -> {channel, text, basedOn, recordedSeq}
  const evidence = new Map(); // evidenceId -> {assertionId, relation, locator, quote}
  const assessments = new Map(); // assertionId -> [ {stance, rationale, ...} ] 追加不覆盖
  const standing = new Map(); // assertionId -> 折叠值（不是对象！见 assertStandingNotObject）
  const seqs = new Set();
  const assessIds = new Set();

  for (const ev of events) {
    seqs.add(ev.seq);
    switch (ev.type) {
      case "assertion.recorded": {
        assertions.set(ev.data.assertionId, {
          channel: ev.data.channel,
          // @e0-reuse own docs/architecture/V3_IMPLEMENTATION_CONTRACT-DRAFT.md:74 — 「槽位缺失恒 'UNKNOWN' 并记 uncertainties，全链无补全路径」逐字固化为读侧缺省
          text: orUnknown(ev.data.text),
          basedOn: orUnknownList(ev.data.basedOn),
          recordedSeq: ev.seq,
        });
        break;
      }
      case "evidence.linked": {
        evidence.set(ev.data.evidenceId, {
          assertionId: ev.data.assertionId,
          relation: ev.data.relation,
          // locator/quote 允许缺省——读回恒 UNKNOWN，绝不猜「应该在哪」
          locator: orUnknown(ev.data.locator),
          quote: orUnknown(ev.data.quote),
          viaSeq: ev.seq,
        });
        break;
      }
      case "assessment.appended": {
        const list = assessments.get(ev.data.subjectRef.assertionId) ?? [];
        list.push({
          assessmentId: ev.data.assessmentId,
          stance: orUnknown(ev.data.stance), // 缺 stance = UNKNOWN；给任何默认立场 = 补全 = 事故
          rationale: orUnknown(ev.data.rationale),
          seq: ev.seq,
        });
        assessments.set(ev.data.subjectRef.assertionId, list);
        assessIds.add(ev.data.assessmentId);
        break;
      }
      case "standing.changed": {
        // @e0-reuse host tests/deepseek-harness/packages/core/session/src/index.ts:663 — 「时点 = 前缀折叠」的截点语义同 fork：standing@t 只由前缀事件决定
        if (standing.has(ev.data.subjectRef.assertionId) !== (ev.data.from !== UNKNOWN)) {
          throw new Error(`E0_PROJECTION_INVARIANT from≠折叠态 @${ev.seq}`);
        }
        standing.set(ev.data.subjectRef.assertionId, ev.data.to);
        break;
      }
    }
  }
  // @e0-reuse own experiments/v3-code-architecture-poc/src/kernel/read-context.ts:1-146 — 时点读两步形状（先截点过滤再折叠，顺序不交换）取 V3 read-context 的先例；E0 简化为前缀折叠
  const proj = {
    assertions,
    evidence,
    assessments,
    standingOf: (id) => standing.get(id) ?? UNKNOWN,
    hasSeq: (s) => seqs.has(s),
    hasAssertion: (id) => assertions.has(id),
    assessmentIds: assessIds,
    eventCount: events.length,
    viewAt: (uptoSeq) => project(events.filter((e) => e.seq < uptoSeq)),
    // 序列化投影核（等值比较用）
    snapshot: () =>
      stable({
        assertions: [...assertions.entries()].sort(),
        evidence: [...evidence.entries()].sort(),
        assessments: [...assessments.entries()].sort(),
        standing: [...standing.entries()].sort(),
      }),
  };
  return proj;
}

function orUnknown(v) {
  return v === undefined || v === null ? UNKNOWN : v;
}
function orUnknownList(v) {
  return Array.isArray(v) && v.length ? v : UNKNOWN;
}
function stable(v) {
  return JSON.parse(stableStringify(v));
}
function stableStringify(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + stableStringify(v[k])).join(",") + "}";
}

// ——变异锚点（负例用）：故意写一个「会补全」的投影，证明 UNKNOWN 纪律断言不是空转——
// 它必须被 run.mjs 的纪律探针抓红；若抓不住，纪律探针无效。
export function naiveProject(events) {
  const p = project(events);
  const orig = p.assessments;
  for (const list of orig.values()) for (const a of list) if (a.stance === UNKNOWN) a.stance = "MIXED"; // ←补全！
  return p;
}

// @e0-reuse new — 「混存通道也能进」的弱化政策（变异锚点）：去掉通道单值/混存键检查，必须被负例探针抓住（否则拒绝码是空转）
export function naivePolicy(basePolicy) {
  return (event) => {
    if (event.type === "assertion.recorded") {
      const d = event.data;
      if (typeof d.channel === "string" && d.channel.includes("+")) event = { ...event, data: { ...d, channel: d.channel.split("+")[0] } };
    }
    return basePolicy(event);
  };
}
