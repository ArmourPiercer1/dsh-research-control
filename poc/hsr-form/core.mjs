/**
 * HSR Schema PoC —— 极小内存桩件，只为回答"这些规则能否同时成立"。
 * 边界（审查指定）：不接正式研究数据、不碰 V1 冻结接口、不作为正式架构、不上 S-L2/L3。
 * 每条判据后注明它编码的是哪条文档规则，便于反查忠实度；发现判据与文档不符 = 本 PoC 的产出。
 */

// ---- 五态（SF-17 封闭逐态键集） -------------------------------------------------
export const STATES = ['DECLARED', 'UNKNOWN', 'NOT_APPLICABLE', 'UNRESOLVED', 'ABSENT'];
const KEYS = {
  DECLARED: ['@st', 'v'],                      // SF-17
  UNKNOWN: ['@st', 'reason'],                  // SF-17：UNKNOWN 不得带 v
  NOT_APPLICABLE: ['@st', 'reason'],
  UNRESOLVED: ['@st', 'reason'],
  ABSENT: ['@st'],                             // SF-17：ABSENT 只有标签
};
export function isTagged(x) { return x !== null && typeof x === 'object' && '@st' in x; }

/** SF-17 逐态键集 + SF-11 缺标签 + SF-16 na_allowed/na_reasons */
export function checkTagged(slot, val, contract, out) {
  if (!isTagged(val)) {
    // SF-11：缺 @st（或为 null）而只给空容器/空串/false/0 → 用空容器代替状态标签
    const emptyish = val === undefined || val === null || val === '' || val === false || val === 0
      || (Array.isArray(val) && val.length === 0);
    if (emptyish) out.fail('STATE_UNDECLARED', `${slot} 缺 @st`);
    else out.fail('STATE_TAG_MALFORMED', `${slot} 不是带状态标记的值`);   // SF-03
    return;
  }
  const st = val['@st'];
  if (!STATES.includes(st)) { out.tagOutOfRange = true; out.fail('STATE_TAG_OUT_OF_RANGE', `${slot} 的 @st=${String(st)}`); return; } // SF-17
  const want = KEYS[st], got = Object.keys(val).sort();
  if (JSON.stringify(want) !== JSON.stringify(got.slice().sort()))
    out.fail('STATE_KEYS_MISMATCH', `${slot}@${st} 键集 ${got.join(',')} ≠ ${want.join(',')}`);      // SF-17
  if (st === 'NOT_APPLICABLE') {
    if (!contract.na_allowed) out.fail('NA_NOT_PERMITTED', `${slot} 不允许 NOT_APPLICABLE`);          // SF-16
    else if (!contract.na_reasons.includes(val.reason)) out.fail('NA_REASON_UNREGISTERED', `${slot}`); // SF-16
  }
  if (st === 'DECLARED' && isEmpty(val.v)) {
    // SF-14：空集合合法性由槽位 empty_allowed 决定；不合法 = 缺陷但记录仍保存
    if (!contract.empty_allowed) out.fail('EMPTY_NOT_PERMITTED', `${slot} 空集合但 empty_allowed=false`, 'DEFICIENCY');
  }
}
const isEmpty = v => (Array.isArray(v) && v.length === 0) || v === '';

// ---- 拒写封闭五项（SF-04；范围=输入编码形态） -----------------------------------
/** 返回 {refused:boolean}；refused ⇒ 不落规范形态。其余一切问题都是 findings。 */
export function ingest(env, payload, reg, out) {
  const kind = env.object_kind;
  if (!kind || !reg.kinds.includes(kind)) return refuse(out, 'OBJECT_KIND_UNRESOLVABLE');      // ①
  if (env.subtype_code === undefined) return refuse(out, 'ENVELOPE_STRUCTURE_INVALID');          // ②
  if (env.schema_version === undefined || !/^1\.(0|[1-9][0-9]*)$/.test(String(env.schema_version)))
    return refuse(out, 'ENVELOPE_STRUCTURE_INVALID');                                            // ② SF-21/SF-22
  // SS-15a：回显类与结构常量类都不是五态值，不得要求标签
  if (env.boundary !== undefined && (typeof env.boundary.truncated !== 'boolean'
      || Object.keys(env.boundary).sort().join(',') !== 'coverage,limit_applied,truncated'))
    return refuse(out, 'ENVELOPE_STRUCTURE_INVALID');                                     // ② SI-14 封闭三键
  for (const k of ['registrant_ref', 'source_refs'])
    if (env[k] !== undefined && !isTagged(env[k])) return refuse(out, 'ENVELOPE_STRUCTURE_INVALID');  // SS-15a 第②类
  const entry = reg.subtypes[env.subtype_code];
  if (!entry) { out.candidate = true; out.fail('SUBTYPE_UNREGISTERED', `子型 ${env.subtype_code} 未注册`, 'DEFICIENCY'); return { refused: false, code: null }; } // SS-13/SS-56
  const alias = reg.nameAlias || {};
  for (const k of Object.keys(payload)) {
    const norm = alias[k] || k;
    if (reg.envelopeKeys.includes(norm)) return refuse(out, 'ENVELOPE_KEY_DUPLICATE_IN_PAYLOAD'); // SS-09a 异名归一命中信封键
    if (!entry.slot_set.includes(k)) return refuse(out, 'UNKNOWN_KEY_IN_PAYLOAD');                  // ③ SS-01
  }
  // SF-04 拒写项⑤：@st 在场但取值越界属形态错误（与 SF-11 的"缺 @st"不同向：后者是缺陷、保存）
  for (const [k, v] of Object.entries(payload))
    if (isTagged(v) && !STATES.includes(v['@st'])) return refuse(out, 'STATE_TAG_OUT_OF_RANGE');   // ⑤
  if (entry.status === 'DEPRECATED') out.fail('CODE_DEPRECATED', `${env.subtype_code} 已退役`, 'DEFICIENCY'); // SRG-13
  return { refused: false, code: null };
}
const refuse = (out, code) => { out.refused = code; return { refused: true, code }; };

/** SF-04：稀疏入口 → 规范形态，唯一扩展 = 未提交槽位一律 ABSENT（含语义必填项） */
export function expand(entry, payload) {
  const norm = {};
  for (const s of entry.slot_set) norm[s] = s in payload ? payload[s] : { '@st': 'ABSENT' };
  return norm;                                   // 不填任何值/默认词表项/推断候选（UN-02、DF-08）
}

// ---- 子型注册一致性（SS-54 + 受控豁免 + EN-W-7） ---------------------------------
export function checkSubtypeEntry(entry, reg, out) {
  const base = reg.identitySlots[entry.kind] || [];
  // SS-15a 末段（裁决后）：身份判定单位是"契约点名的引用位"，槽名与其子路径同域可比
  const samePos = (x, y) => x === y || x.startsWith(y + '.') || y.startsWith(x + '.');
  const inBase = s => base.some(b => samePos(b, s));
  const rulingsFor = s => Object.entries(reg.contractRulings)
    .filter(([slot]) => samePos(slot, s)).flatMap(([, r]) => r);
  const exempt = (entry.identity_slot_exemptions || []).map(e => {
    if (!rulingsFor(e.slot).includes(e.cited_rule)) { out.badEntry(entry.subtype_code, 'EXEMPTION_NOT_ADJUDICATED'); return null; }
    if (!inBase(e.slot)) { out.badEntry(entry.subtype_code, 'EXEMPTION_OUTSIDE_BASE'); return null; }
    return e.slot;
  }).filter(Boolean);
  if (entry.identity_slots.length === 0 && base.length > 0 && exempt.length < base.length)
    out.badEntry(entry.subtype_code, 'IDENTITY_SLOTS_EMPTIED');            // SS-54 禁止整体置空
  for (const s of base) if (!exempt.some(x => samePos(x, s)) && !entry.identity_slots.some(x => samePos(x, s)))
    out.badEntry(entry.subtype_code, 'IDENTITY_SLOT_DROPPED');             // SS-54 超集（按引用位）
  // PoC 发现 #2（文档未定）：subtype 改为信封承载后仍是身份构成槽位，
  // 故 identity_slots 必须允许引用**信封键**（subtype_code），否则 Entity/Concept/Proposition
  // 的身份构成会失去 subtype 这一项。此处按"允许"编码，待文档裁决。
  const carriers = [...entry.slot_set, ...reg.envelopeKeys];
  for (const s of entry.identity_slots)
    if (!base.some(b => samePos(b, s)) && !exempt.some(x => samePos(x, s)) && !carriers.some(k => samePos(k, s)))
    out.badEntry(entry.subtype_code, 'IDENTITY_SLOT_NOT_DECLARED');
}

/** EN-W-7：根世界 singleton 唯一性——保存不阻断 + VIOLATION */
export function checkSingleton(store, env, reg, out) {
  const e = reg.subtypes[env.subtype_code];
  if (!e || !e.singleton) return;
  const n = store.filter(r => r.env.space_id === env.space_id && r.env.subtype_code === env.subtype_code).length;
  if (n >= 1) out.fail('SINGLETON_SUBTYPE_DUPLICATE', `${env.subtype_code} 已存在`, 'VIOLATION');
}

// ---- AR-ID-6 / §4.1 结论 × 构造状态 ---------------------------------------------
export function checkConclusion(norm, out, prevNorm) {
  const c = norm.conclusion, cs = norm.construction_state;
  const st = c && c['@st'], mode = st === 'DECLARED' ? c.v?.mode : null;
  const declaredCs = cs?.['@st'] === 'DECLARED' ? cs.v : null;
  if (st === 'ABSENT' && declaredCs === 'CLOSED_DRAFT') return;           // 放弃未完成构造：合法
  if (st === 'ABSENT' && declaredCs === 'DRAFT') return;                  // 尚在构造：合法
  if (st === 'ABSENT' && declaredCs !== null) out.fail('DRAFT_STATE_CONCLUSION_MISMATCH', `ABSENT + ${declaredCs}`, 'DEFICIENCY');
  if (mode === 'NONE_DECLARED') {
    const lo = norm.local_outcome?.['@st'] === 'DECLARED' ? norm.local_outcome.v : null;
    if (lo !== 'INCONCLUSIVE') out.fail('NONE_DECLARED_WITHOUT_INCONCLUSIVE', '必须配 INCONCLUSIVE', 'VIOLATION');
    // §4.1（裁决后）：SUBMITTED 配对只在"该声明产生那一刻"校验；生命周期修订不改其它状态轴（AR-ID-4）
    const LIFECYCLE_ONLY = ['WITHDRAWN', 'TERMINATED_BY_SCOPE', 'CLOSED_DRAFT'];   // 不可能是"产生该声明"的那次修订
    const alreadyDeclared = (prevNorm?.conclusion?.['@st'] === 'DECLARED' && prevNorm.conclusion.v?.mode === 'NONE_DECLARED')
      || LIFECYCLE_ONLY.includes(declaredCs);
    if (!alreadyDeclared && declaredCs !== 'SUBMITTED') out.fail('NONE_DECLARED_NOT_SUBMITTED', `construction_state=${declaredCs}`, 'VIOLATION');
  }
  if (c?.['@st'] === 'DECLARED' && 'reason' in c) out.fail('STATE_KEYS_MISMATCH', 'DECLARED 不得带 reason');
}
/** AR-ID-6 转移：返回 'COMPLETION'（同 id 追加修订）或 'NEW_ARGUMENTATION'（身份变化） */
export function conclusionTransition(prevNorm, nextNorm) {
  const p = prevNorm?.conclusion, n = nextNorm?.conclusion;
  const ps = p?.['@st'], ns = n?.['@st'];
  // 兼容 PoC-2 的单参调用（只给 head 时按声明形态分流；正确实现应传 next，见 F-1）
  if (nextNorm === undefined) return ps !== 'DECLARED' ? 'COMPLETION' : (p.v?.mode === 'NONE_DECLARED' ? 'NEW_ARGUMENTATION' : 'COMPLETION');  // 无 head/未声明 → 首次登记按补全
  // AR-ID-6：从未声明到声明 = 补全（AR-ID-2 改的是"已声明值"，草稿从未声明）
  if (prevNorm === undefined || ps === undefined) return 'COMPLETION';   // 无 head = 首次登记
  if (ps === 'ABSENT') return 'COMPLETION';
  // AR-ID-2：已声明的结论内容改变 → 新论证。比较的是引用位本体，不是声明形态（PoC-2 F-1 修正）
  if (ps === 'DECLARED' && ns === 'DECLARED') {
    if (p.v.mode !== n.v.mode) return 'NEW_ARGUMENTATION';
    if (p.v.proposition_rev !== n.v.proposition_rev) return 'NEW_ARGUMENTATION';
    return 'NO_CHANGE';
  }
  if (ps === 'DECLARED' && ns === 'ABSENT') return 'ILLEGAL_WITHDRAWAL';   // 已声明结论不得退回未声明
  return 'NO_CHANGE';
}

// ---- 摘要域（SF-52 / SF-52a） ---------------------------------------------------
import { createHash } from 'node:crypto';
export const canonical = v => JSON.stringify(v, (k, x) =>
  x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x);
export function digest(obj, exclusion, alg = 'sha256') {
  const cut = Object.fromEntries(Object.entries(obj).filter(([k]) => !exclusion.includes(k))); // SF-52a 排除集
  return { alg, hex: createHash(alg).update(canonical(cut)).digest('hex') };
}

/** SS-12（裁决后）：identity_slot_set_digest 的输入是去重并排序后的引用位名序列 */
export const slotSetDigest = entry => digest({ refs: [...new Set(entry.identity_slots)].sort() }, []);

// ---- 检查归约（RPT-02）与脱敏恒定面（SI-14 / SCR-57） ------------------------------
export function reduceLevel(verdicts) {
  if (verdicts.includes('FAIL')) return 'NOT_ACHIEVED';        // RPT-02：FAIL 优先
  if (verdicts.includes('INDETERMINATE')) return 'INDETERMINATE';
  return 'ACHIEVED';
}
export const BLIND = { coverage: 'NOT_DISCLOSED', truncated: false };   // SI-14：披露量取常量
/** sanitize：比较面 = 呈现对象 + boundary；分页回显不在面内（SCR-57） */
export function sanitize(report, authClass, page) {
  const visible = report.items.filter(i => !authClass.hidden(i));
  const out = { items: visible, boundary: { ...BLIND, limit_applied: page.effectiveLimit } }; // limit_applied 如实于请求
  return out;
}
