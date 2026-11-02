// E0 事件政策——四类事件 + 两条真价值纪律（三通道不混存 / 缺字段恒 UNKNOWN 禁补全）的写侧执行点。
// 拒绝一律抛 `E0_REFUSED <CODE>`；run.mjs 的负例把「必拒」当绿，任何「本应拒却被接纳」让整个薄片红。

// @e0-reuse new — 四类事件名封闭集：宿主 SessionEventMap 可扩（declare module，见 hostprobe.mjs 锚），生产 20 冻结名不含此四名（src/host/history/registry/types.ts:363-388）；名单本身确需新写
export const E0_EVENT_TYPES = Object.freeze([
  "assertion.recorded",
  "evidence.linked",
  "assessment.appended",
  "standing.changed",
]);

// @e0-reuse own docs/architecture/V3_IMPLEMENTATION_CONTRACT-DRAFT.md:55 — 三通道封闭词汇与「SOURCE_RECORD payload 键名命中 /inference|suggestion|llm_/ 即拒（仅作用于键名、大小写敏感）」照 V3 信封契约草案固化
const CHANNELS = Object.freeze(["SOURCE", "INFERENCE", "SUGGESTION"]);
const SOURCE_LEAK_KEY = /inference|suggestion|llm_/;

// @e0-reuse own docs/architecture/V3_IMPLEMENTATION_CONTRACT-DRAFT.md:91 — standing 词汇（CANDIDATE 默认、显式确认可推 STANDING、可撤回）取 V3 合同 M3 层的 CANDIDATE/STANDING 语义，落成封闭转移集
const STANDING_TRANSITIONS = new Set([
  "UNKNOWN>CANDIDATE",
  "CANDIDATE>ACCEPTED",
  "CANDIDATE>RETRACTED",
  "ACCEPTED>RETRACTED",
  "ACCEPTED>CONTESTED",
  "CONTESTED>CANDIDATE",
  "CONTESTED>ACCEPTED",
  "RETRACTED>CANDIDATE",
  "RETRACTED>ACCEPTED",
]);

const RELATIONS = new Set(["supports", "contradicts", "context"]);

function refuse(code) {
  throw new Error(`E0_REFUSED ${code}`);
}

function keysDeep(obj, acc = []) {
  if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      acc.push(k);
      keysDeep(v, acc);
    }
  }
  return acc;
}

export function makePolicy({ getStanding, hasSeq, hasAssertion, assessmentIds }) {
  return function validate(event) {
    // @e0-reuse own src/host/history/registry/validate.ts:1-630 — 「校验在 append 内联、不过即拒」（生产 630 行强校验的经验位；本片取其fail-closed 形状，规则为新写）
    const { type, seq, sourceEventSeqs, data } = event;
    if (!E0_EVENT_TYPES.includes(type)) refuse(`UNKNOWN_EVENT_TYPE:${type}`);
    if (!Array.isArray(sourceEventSeqs)) refuse("CAUSAL_NOT_ARRAY");
    for (const s of sourceEventSeqs) {
      // @e0-reuse host tests/deepseek-harness/packages/core/session/src/types.ts:470 — 因果引用必须可解析（宿主 SurfaceIntent.sourceEventSeqs 的「必携且有效」语义）
      if (!Number.isInteger(s) || s < 0 || s >= seq || !hasSeq(s)) refuse(`DANGLING_CAUSAL_REF:${s}`);
    }
    if (data === null || typeof data !== "object" || Array.isArray(data)) refuse("PAYLOAD_NOT_OBJECT");
    // 纪律一（写侧）：三通道不混存——channel 必须单值枚举；数组/组合串/缺失一律拒
    if ("channel" in data) {
      if (typeof data.channel !== "string" || !CHANNELS.includes(data.channel)) refuse(`MIXED_OR_UNKNOWN_CHANNEL:${JSON.stringify(data.channel)}`);
      if (type === "assertion.recorded" && data.channel === "SOURCE") {
        // @e0-reuse own docs/architecture/V3_IMPLEMENTATION_CONTRACT-DRAFT.md:55 — SOURCE 通道键名混存判据逐字复用（仅键名、大小写敏感）
        for (const k of keysDeep(data)) if (SOURCE_LEAK_KEY.test(k)) refuse(`MIXED_CHANNEL_KEY:${k}`);
      }
      if (data.channel !== "SOURCE") {
        // @e0-reuse own docs/architecture/V3_IMPLEMENTATION_CONTRACT-DRAFT.md:55 — 推测/建议通道 based_on 强制（整数同文件 seq）、悬空即拒（dangling_*）
        if (!Array.isArray(data.basedOn) || data.basedOn.length === 0) refuse("BASED_ON_REQUIRED");
        for (const b of data.basedOn) if (!Number.isInteger(b) || !hasSeq(b)) refuse(`BASED_ON_DANGLING:${b}`);
      }
    }
    switch (type) {
      case "assertion.recorded": {
        if (typeof data.assertionId !== "string" || !data.assertionId) refuse("ASSERTION_ID_REQUIRED");
        if (!CHANNELS.includes(data.channel)) refuse("CHANNEL_REQUIRED"); // 缺通道不默认——默认=混存洗白
        break;
      }
      case "evidence.linked": {
        if (!hasAssertion(data.assertionId)) refuse(`DANGLING_ASSERTION:${data.assertionId}`);
        if (!RELATIONS.has(data.relation)) refuse(`BAD_RELATION:${data.relation}`);
        break;
      }
      case "assessment.appended": {
        if (typeof data.assessmentId !== "string" || assessmentIds.has(data.assessmentId)) refuse(`DUP_ASSESSMENT:${data.assessmentId}`);
        if (!hasAssertion(data.subjectRef?.assertionId ?? "")) refuse("ASSESS_TARGET_UNKNOWN");
        if ("stance" in data && data.stance === null) refuse("NULL_DISGUISED_AS_MISSING"); // null≠缺省：缺=UNKNOWN，null=伪装
        if ("stance" in data && data.stance !== undefined && !["POSITIVE", "NEGATIVE", "MIXED"].includes(data.stance)) refuse(`BAD_STANCE:${data.stance}`);
        // @e0-reuse own docs/architecture/V3_IMPLEMENTATION_CONTRACT-DRAFT.md:74 — 「全链无补全路径」：写侧禁 caller 自带默认位——禁带「_defaulted」族键，禁 null 伪装缺省
        if (keysDeep(data).some((k) => k.endsWith("_defaulted") || k === "fill")) refuse("DEFAULT_FILL_FORBIDDEN");
        assessmentIds.add(data.assessmentId); // 全部规则通过才登记（拒绝不留痕，防被拒 id 污染幂等集）
        break;
      }
      case "standing.changed": {
        // @e0-reuse new — standing 折叠转移门：from 必须等于当前折叠值（无锁防丢更新）；此机制宿主与自家均无对应物（standing 不是对象，无对象状态可 compare-and-set，只能折事件）
        if (!hasAssertion(data.subjectRef?.assertionId ?? "")) refuse("STANDING_SUBJECT_UNKNOWN");
        const cur = getStanding(data.subjectRef.assertionId);
        if (data.from !== cur) refuse(`STALE_STANDING:expected=${cur}:got=${data.from}`);
        if (!STANDING_TRANSITIONS.has(`${data.from}>${data.to}`)) refuse(`ILLEGAL_TRANSITION:${data.from}>${data.to}`);
        break;
      }
      default:
        refuse("UNREACHABLE");
    }
    return event;
  };
}
