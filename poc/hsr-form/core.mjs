/**
 * HSR Schema PoC —— 极小内存桩件，只为回答"这些规则能否同时成立"。
 * 边界（审查指定）：不接正式研究数据、不碰 V1 冻结接口、不作为正式架构、不上 S-L2/L3。
 *
 * 每条判据后注明它编码的文档规则号。**独立审查（da113bcd 基线）纠正了本桩件的七处不忠实**，
 * 修正记录见 FINDINGS-review.md；本文件现在的实现以规则原文为准，不以测试绿为准。
 */

// ---- 五态（SF-17 逐态键集**封闭**：集合外的键即形态非法，写入被拒） ----------------
export const STATES = ['DECLARED', 'UNKNOWN', 'NOT_APPLICABLE', 'UNRESOLVED', 'ABSENT'];
export const KEYS = {
  DECLARED: ['@st', 'v'],          // SF-17
  UNKNOWN: ['@st', 'reason'],      // SF-17
  NOT_APPLICABLE: ['@st', 'reason'],
  UNRESOLVED: ['@st', 'ref'],      // SF-17：**ref**，不是 reason（审查纠正 #1）
  ABSENT: ['@st'],
};
export function isTagged(x) { return x !== null && typeof x === 'object' && !Array.isArray(x) && '@st' in x; }
/** SF-17 封闭键集判定：缺键或多键都算越界 */
export function keysOutOfRange(val) {
  const want = KEYS[val['@st']]; if (!want) return false;
  const got = Object.keys(val).sort();
  return got.length !== want.length || got.some((k, i) => k !== want[i]);
}

// ---- 引用文法（SF-22；SF-04 第④项"引用 pattern 不匹配"） --------------------------
const ID_RE = /^(HENT|HCON|HASS|HARG|HPRO)-[A-Za-z0-9_-]{1,58}$/;
const REV_RE = /^r[1-9][0-9]{0,8}$/;
const REF_RE = /^(HENT|HCON|HASS|HARG|HPRO)-[A-Za-z0-9_-]{1,58}@r[1-9][0-9]{0,8}(#[A-Za-z0-9_-]{1,32})?$/;
export const isObjectRef = s => REF_RE.test(String(s));
/**
 * SF-04 ④"引用 pattern 不匹配"只作用于**契约声明为引用的位置**（SF-26/SF-28 是引用位的规则）。
 * 全局扫描字符串是错的：`aliases` 里的 `p:1@1`、邮箱、"page 3@night" 都是合法自由文本，
 * 对它们套引用文法会产生假阳性（本桩件第一版就犯过这个错）。
 * 引用位由契约表声明：ref_paths = ['v'] | ['v[*]'] | ['v.kind_ref','v.individual_ref'] …
 */
export function refViolations(val, paths) {
  const bad = [];
  for (const p of paths || []) {
    const segs = p.split('.');
    let cur = val;
    for (const s of segs) {
      if (cur == null) break;
      if (s.endsWith('[*]')) { cur = cur[s.slice(0, -3)]; cur = Array.isArray(cur) ? cur : [cur]; }
      else cur = cur[s];
    }
    for (const x of Array.isArray(cur) ? cur : [cur])
      if (typeof x === 'string' && !REF_RE.test(x)) bad.push(`${p}="${x}"`);
  }
  return bad;
}

// ---- 信封三类键（SS-15a） --------------------------------------------------------
const CLASS1 = ['object_id', 'object_kind', 'space_id', 'revision_id', 'schema_version',
  'recorded_at', 'identity_slot_set_digest', 'subtype_code'];
const CLASS2 = ['registrant_ref', 'source_refs', 'completion_basis', 'external_citations'];   // 领域槽位：带五态标签
const CLASS3 = ['limit', 'next_cursor', 'exhausted', 'boundary'];                              // 响应回显：仅响应侧
export const ENVELOPE_CLASSES = { structural: CLASS1, domain: CLASS2, echo: CLASS3 };

/**
 * 拒写封闭五项（SF-04，范围=输入编码形态）：
 *   ① object_kind 缺失或不可解析
 *   ② 信封必填结构缺失或不可解析（schema_version、@st 标签）
 *   ③ 载荷含未知键（SS-01 同名重复 / SS-09a 异名归一命中信封键集 → 落同一项）
 *   ④ 引用 pattern 不匹配（SF-26/SF-28/SF-22）
 *   ⑤ 五态标签取值越界（SF-17，含逐态键集越界）
 * 五项之外一律保存，问题以 findings 表达。
 */
export function ingest(env, payload, reg, out) {
  // ① object_kind
  if (!env.object_kind || !reg.kinds.includes(env.object_kind)) return refuse(out, 'OBJECT_KIND_UNRESOLVABLE');
  // ② 信封必填结构（含类型：schema_version 是**整数**，文档两处明文）
  for (const k of ['object_id', 'space_id', 'schema_version', 'subtype_code'])
    if (env[k] === undefined || env[k] === null || env[k] === '') return refuse(out, 'ENVELOPE_REQUIRED_MISSING');
  if (!Number.isInteger(env.schema_version) || env.schema_version < 1) return refuse(out, 'ENVELOPE_SCHEMA_VERSION_TYPE');
  if (!ID_RE.test(String(env.object_id))) return refuse(out, 'ENVELOPE_OBJECT_ID_GRAMMAR');            // ④
  if (env.revision_id !== undefined && !REV_RE.test(String(env.revision_id))) return refuse(out, 'ENVELOPE_REVISION_GRAMMAR');
  if (typeof env.space_id !== 'string' || env.space_id === '') return refuse(out, 'ENVELOPE_SPACE_ID_TYPE');
  for (const k of CLASS3) if (k in env) return refuse(out, 'ENVELOPE_ECHO_KEY_ON_WRITE');   // 第③类仅响应侧（见 FINDINGS）
  for (const k of CLASS2) if (env[k] !== undefined && !isTagged(env[k])) return refuse(out, 'ENVELOPE_DOMAIN_SLOT_UNTAGGED');
  if (env.source_refs?.['@st'] === 'DECLARED' && refViolations(env.source_refs, ['v[*]']).length)
    return refuse(out, 'REF_PATTERN_MISMATCH');                                            // ④ 信封引用位
  // registrant_ref 的值是宿主注入的 V1 主体标识（SD-19/RD-35），**不适用** SF-22 对象引用文法；
  // 只要求它是非空字符串——把它当对象引用校验会产生假阳性（本桩件第一版就犯过）。
  if (env.registrant_ref?.['@st'] === 'DECLARED' && (typeof env.registrant_ref.v !== 'string' || !env.registrant_ref.v))
    return refuse(out, 'ENVELOPE_DOMAIN_SLOT_UNTAGGED');
  // 子型不可解析 ⇒ 候选载荷（SS-13/SS-56），**不是**拒写，也不产生任何层级结果
  const entry = reg.subtypes[env.subtype_code];
  if (!entry) { out.candidate = true; out.fail('SUBTYPE_UNREGISTERED', `子型 ${env.subtype_code} 未注册`, 'DEFICIENCY'); return { refused: false, code: null }; }
  const alias = reg.nameAlias || {};
  for (const k of Object.keys(payload)) {                                                  // ③
    if ((alias[k] || k) !== k && reg.envelopeKeys.includes(alias[k])) return refuse(out, 'ENVELOPE_KEY_DUPLICATE_IN_PAYLOAD');
    if (reg.envelopeKeys.includes(k)) return refuse(out, 'ENVELOPE_KEY_DUPLICATE_IN_PAYLOAD');
    if (!entry.slot_set.includes(k)) return refuse(out, 'UNKNOWN_KEY_IN_PAYLOAD');
  }
  for (const [k, v] of Object.entries(payload)) {
    if (isTagged(v)) {
      if (!STATES.includes(v['@st'])) return refuse(out, 'STATE_TAG_OUT_OF_RANGE');         // ⑤
      if (keysOutOfRange(v)) return refuse(out, 'STATE_KEYS_OUT_OF_RANGE');                 // ⑤ SF-17 封闭键集
    } else if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) {
      // （不拒写）缺 @st 的空容器是缺陷而非形态错误，见 SF-11；由 checkTagged 产 finding
    }
    const paths = reg.refPaths?.[k];                                                      // ④ 仅声明的引用位
    if (paths && v?.['@st'] === 'DECLARED' && refViolations(v, paths).length) return refuse(out, 'REF_PATTERN_MISMATCH');
  }
  if (entry.status === 'DEPRECATED') out.fail('CODE_DEPRECATED', `${env.subtype_code} 已退役`, 'DEFICIENCY'); // SRG-13
  return { refused: false, code: null };
}
const refuse = (out, code) => { out.refused = code; return { refused: true, code }; };

/** SF-04：稀疏入口 → 规范形态，唯一扩展 = 未提交槽位一律 ABSENT（含语义必填项） */
export function expand(entry, payload) {
  const norm = {};
  for (const s of entry.slot_set) norm[s] = s in payload ? payload[s] : { '@st': 'ABSENT' };
  return norm;
}

/** SF-17 键集越界已在 ingest 拒写；这里管语义侧：SF-11 缺标签 / SF-16 NA / SF-14 空集合 */
export function checkTagged(slot, val, contract, out) {
  if (!isTagged(val)) {
    const emptyish = val === undefined || val === null || val === '' || val === false || val === 0
      || (Array.isArray(val) && val.length === 0);
    if (emptyish) out.fail('STATE_UNDECLARED', `${slot} 缺 @st`);                            // SF-11
    else out.fail('STATE_TAG_MALFORMED', `${slot} 不是带状态标记的值`);                        // SF-03
    return;
  }
  const st = val['@st'];
  if (!STATES.includes(st)) { out.tagOutOfRange = true; out.fail('STATE_TAG_OUT_OF_RANGE', `${slot}@${st}`); return; }
  if (keysOutOfRange(val)) out.fail('STATE_KEYS_OUT_OF_RANGE', `${slot}@${st} 键集越界`);      // SF-17
  if (st === 'NOT_APPLICABLE') {
    if (!contract.na_allowed) out.fail('NA_NOT_PERMITTED', `${slot} 不允许 NOT_APPLICABLE`);   // SF-16
    else if (!contract.na_reasons.includes(val.reason)) out.fail('NA_REASON_UNREGISTERED', slot);
  }
  if (st === 'DECLARED' && ((Array.isArray(val.v) && val.v.length === 0) || val.v === '')) {
    if (!contract.empty_allowed) out.fail('EMPTY_NOT_PERMITTED', `${slot} 空集合但 empty_allowed=false`, 'DEFICIENCY');
  }
}

// ---- 子型注册一致性（SS-54 + 受控豁免 + EN-W-7） ---------------------------------
/**
 * 身份判定单位 = **契约点名的引用位**（SS-15a）。审查纠正 #5：父槽位**不得**代替子路径，
 * 故此处只做**精确同名**匹配，不做前缀容忍——否则 `world_membership` 会冒充
 * `world_membership.individual_ref`，把"只改分类位也算身份变化"的错误判据洗白。
 */
export function checkSubtypeEntry(entry, reg, out) {
  const base = reg.identitySlots[entry.kind] || [];
  const bad = c => out.badEntry(entry.subtype_code, c);
  const exempt = (entry.identity_slot_exemptions || []).map(e => {
    if (!(reg.contractRulings[e.slot] || []).includes(e.cited_rule)) { bad('EXEMPTION_NOT_ADJUDICATED'); return null; }
    if (!base.includes(e.slot)) { bad('EXEMPTION_OUTSIDE_BASE'); return null; }
    return e.slot;
  }).filter(Boolean);
  if (entry.identity_slots.length === 0 && base.length > exempt.length) bad('IDENTITY_SLOTS_EMPTIED');
  for (const s of base) if (!exempt.includes(s) && !entry.identity_slots.includes(s)) bad('IDENTITY_SLOT_DROPPED');
  for (const s of entry.identity_slots)
    if (!base.includes(s) && !exempt.includes(s)
      && ![...entry.slot_set, ...reg.envelopeKeys].includes(s)) bad('IDENTITY_SLOT_NOT_DECLARED');
}

/** EN-W-7：根世界 singleton 唯一性——保存不阻断 + VIOLATION */
export function checkSingleton(store, env, reg, out) {
  const e = reg.subtypes[env.subtype_code];
  if (!e || !e.singleton) return;
  if (store.some(r => r.env.space_id === env.space_id && r.env.subtype_code === env.subtype_code))
    out.fail('SINGLETON_SUBTYPE_DUPLICATE', `${env.subtype_code} 已存在`, 'VIOLATION');
}

// ---- AR-ID-6 / §4.1 结论 × 构造状态 ---------------------------------------------
/** 审查纠正 #6：`prevNorm` 缺省即"首次登记"，此时**必须**校验产生时配对；
 *  只有"上一版已声明 NONE_DECLARED 的生命周期修订"才豁免（AR-ID-4）。 */
export function checkConclusion(norm, out, prevNorm) {
  const c = norm.conclusion, cs = norm.construction_state;
  const st = c && c['@st'], mode = st === 'DECLARED' ? c.v?.mode : null;
  const csAt = cs?.['@st'] === 'DECLARED' ? cs.v : null;
  if (st === 'ABSENT' && csAt !== null && !['DRAFT', 'CLOSED_DRAFT'].includes(csAt))
    out.fail('DRAFT_STATE_CONCLUSION_MISMATCH', `ABSENT + ${csAt}`, 'DEFICIENCY');
  if (mode === 'NONE_DECLARED') {
    const lo = norm.local_outcome?.['@st'] === 'DECLARED' ? norm.local_outcome.v : null;
    if (lo !== 'INCONCLUSIVE') out.fail('NONE_DECLARED_WITHOUT_INCONCLUSIVE', '必须配 INCONCLUSIVE', 'VIOLATION');
    const retained = prevNorm?.conclusion?.['@st'] === 'DECLARED' && prevNorm.conclusion.v?.mode === 'NONE_DECLARED';
    if (!retained && csAt !== 'SUBMITTED') out.fail('NONE_DECLARED_NOT_SUBMITTED', `construction_state=${csAt}`, 'VIOLATION');
  }
}

/** AR-ID-6 / AR-ID-2 转移。审查纠正：单参调用不再返回"看似合法"的判断，改为显式 ILLEGAL_INPUT。 */
export function conclusionTransition(prevNorm, nextNorm) {
  if (nextNorm === undefined) return 'ILLEGAL_INPUT';        // 转移判定必须有前后两版（AR-ID-2 比较的是内容）
  const p = prevNorm?.conclusion, n = nextNorm.conclusion;
  const ps = p?.['@st'], ns = n?.['@st'];
  if (prevNorm === undefined || ps === undefined) return 'COMPLETION';        // 无 head = 首次登记
  if (ps === 'ABSENT' && ns === 'ABSENT') return 'NO_CHANGE';                   // 仍未声明 ≠ 补全
  if (ps === 'ABSENT') return 'COMPLETION';                                     // 从未声明到声明 → 补全（同 id）
  if (ps === 'DECLARED' && ns === 'DECLARED') {
    if (p.v.mode !== n.v.mode) return 'NEW_ARGUMENTATION';                                   // AR-ID-2
    if (p.v.proposition_rev !== n.v.proposition_rev) return 'NEW_ARGUMENTATION';
    return 'NO_CHANGE';
  }
  if (ps === 'DECLARED' && ns === 'ABSENT') return 'ILLEGAL_WITHDRAWAL';
  return 'NO_CHANGE';
}

// ---- 摘要域（SF-50 / SF-52 / SF-52a / SCR-06 / SCR-54） ---------------------------
import { createHash } from 'node:crypto';
export const canonical = v => JSON.stringify(v, (k, x) =>
  x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x);
/** **三个互不相同的排除集**（审查纠正 #3：我原先把 SCR-54 的两项误当成摘要排除集）
 *   ① SCR-06/SF-52a 摘要排除集 = 恰 `{report_digest}` 一项，实现不得自行增减
 *   ② SCR-54 同形判定排除集 = 恰 `{report_id, checked_at}` 两项
 *   ③ SCR-57 比较面 = sanitize() 的返回值本身（分页回显不在面内）
 */
export const DIGEST_EXCLUSION = ['report_digest'];                    // SCR-06
export const SHAPE_EXCLUSION = ['report_id', 'checked_at'];           // SCR-54
export function digest(obj, exclusion = DIGEST_EXCLUSION, alg = 'sha256') {
  const cut = Object.fromEntries(Object.entries(obj).filter(([k]) => !exclusion.includes(k)));
  return { alg, hex: createHash(alg).update(canonical(cut)).digest('hex') };
}
/** SS-12：identity_slot_set_digest 输入 = 去重并排序后的引用位名序列 */
export const slotSetDigest = refs => digest({ refs: [...new Set(refs)].sort() }, []);

// ---- 检查归约（RPT-02 + SCR-77） --------------------------------------------------
/** 审查纠正 #4：零适用规则**不得**归约为 PASS。SCR-77：该层无规则适用 → INDETERMINATE(RULE_UNREGISTERED) */
export function reduceLevel(verdicts) {
  if (verdicts.length === 0) return 'INDETERMINATE';        // SCR-77：沉默不等于通过
  if (verdicts.includes('FAIL')) return 'NOT_ACHIEVED';     // RPT-02：FAIL 优先
  if (verdicts.includes('INDETERMINATE')) return 'INDETERMINATE';
  return 'ACHIEVED';
}

// ---- 恒定面与两世界（SI-14 / SI-33 / SCR-57） -------------------------------------
export const BLIND = { coverage: 'NOT_DISCLOSED', truncated: false };
/** SCR-57 的 `S` 常量：**逐键穷举**，粒度 = (操作, 生效页长) */
export const S_constant = (operation, effectiveLimit) => ({
  operation, level_results: [], findings: [], verdict: 'UNVERIFIABLE_TO_YOU',
  boundary: { coverage: 'NOT_DISCLOSED', truncated: false, limit_applied: effectiveLimit },
});
/** 检查报告脱敏：呈现对象 = 呈现项 + 规则 findings 的隐藏 + boundary；分页回显不在面内（SCR-57） */
export function sanitize(report, authClass, page) {
  const visible = report.items.filter(i => !authClass.hidden(i));
  const findings = (report.findings || []).filter(f => !authClass.hiddenFinding?.(f));
  return { operation: report.operation, level_results: visible.length ? report.level_results : [],
    findings, verdict: visible.length ? report.verdict : 'UNVERIFIABLE_TO_YOU',
    boundary: { ...BLIND, limit_applied: page.effectiveLimit } };
}
/** 分页回显（SI-14/SI-50）。审查纠正 #2：`exhausted` 语义我原先写反了——
 *  文档锚点：可见 200 条、页长 100 ⇒ 第 1 页 exhausted=false、第 2 页 exhausted=true。 */
export function paginate(items, requested, offset, maxLimit, defaultLimit) {
  if (!Number.isInteger(requested) || requested <= 0) return { refused: 'F-LIMIT-INVALID' };
  if (requested > maxLimit) return { refused: 'F-LIMIT-TOO-LARGE' };      // SI-50：拒绝而非静默夹取
  const eff = requested;
  const slice = items.slice(offset, offset + eff);
  return { slice, limit_applied: eff, exhausted: offset + slice.length >= items.length,
    next_cursor: offset + slice.length >= items.length ? null : String(offset + eff) };
}

// ---- 写入幂等（SI-41） -------------------------------------------------------------
/** 键 = 四元组；首次请求体的规范字节摘要随键保存；键同体不同 → 拒绝且不留记录。 */
export class Idempotency {
  constructor(store = new Map()) { this.store = store; }
  static keyOf(req) { return `${req.actor_ref}|${req.space_id}|${req.operation}|${req.client_request_id}`; }
  run(req, write) {
    const k = Idempotency.keyOf(req), body = digest(req, []).hex;      // 请求体摘要（SF-50）
    const hit = this.store.get(k);
    if (hit) {
      if (hit.body !== body) return { refused: 'IDEMPOTENCY_KEY_REUSED' };   // 键同体不同 → 拒绝，不产生记录
      return { replayed: true, result: hit.result };
    }
    const r = write();
    if (!r.refused) this.store.set(k, { body, result: r });
    return { replayed: false, result: r };
  }
  serialize() { return JSON.stringify([...this.store.entries()]); }
  static restore(s) { return new Idempotency(new Map(JSON.parse(s))); }   // 跨"重启"的键与首次结果绑定
}
