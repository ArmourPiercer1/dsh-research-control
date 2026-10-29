/**
 * PoC-1 对象形态与五态。
 * 独立审查（基线 da113bcd）判本单元"最小合法对象尚未被真正验证"，三条纠正全部成立并已复现：
 *   夹具用了 `o1`/`e:root` 这类不合 SF-22 文法的标识、字符串 `schema_version:"1.0"`（文档两处写**整数**）、
 *   以及把只属于读响应的 `boundary` 放进入写信封。
 * 因此本文件重写为三件事：
 *   ① 真实最小合法形态（SF-22 文法 + 整数版本 + 无回显键）
 *   ② **完整五态正反例矩阵**（审查指出原稿缺这张表）
 *   ③ **错误实现必红**：桩件的判据表若被削弱，矩阵必须立刻变红
 * **第二轮审查（P1）两条判据缺陷，均成立并已复现**（`.scratch/probe-review2.mjs` R2/R3）：
 *   ④ 桩件只有一条"引用文法"（SF-22 对象引用），于是合法的 `rec:` 来源被拒（SF-24/SS-34），
 *      而"端点位不得放 `rec:`"这条真正该拒的判据反而没有独立的类型域可依据 —— 已改为引用位**类型域**；
 *   ⑤ `EMPTY_NOT_PERMITTED` 的严重度我写成 DEFICIENCY，契约登记的是 **VIOLATION**（SF-14）。
 *      严重度与码名都是判据的一部分：顺带把两个 `NOT_APPLICABLE_*` 码名对齐 SCR-76 的注册形态。
 * 第三轮审查（联合审查内联的读码反例）判本单元一项 P1，成立并已复现（`.scratch/probe-review3.mjs` R2）：
 *   SF-17 的封闭键集只接在**载荷**侧，信封第②类槽位只查"有没有 @st"，于是
 *   `{@st:'UNKNOWN', reason, v}` 在载荷被拒写、在信封被放行且零 finding。**机制实现正确 ≠ 所有使用
 *   该机制的位置都接入了检查**；P1-8c 现在要求同一非法形态在两个位置得到同一个码。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ingest, expand, checkTagged, isTagged, keysOutOfRange, STATES, KEYS, refAt, isObjectRef, isRecordRef } from './core.mjs';

// ---- 夹具：槽位契约写成数据（§5.2 机器可读表） -----------------------------------
export const envelopeKeys = ['object_id', 'object_kind', 'space_id', 'revision_id', 'schema_version',
  'recorded_at', 'identity_slot_set_digest', 'subtype_code', 'registrant_ref', 'source_refs'];
export const reg = {
  kinds: ['ENTITY', 'CONCEPT', 'ASSOCIATION', 'ARGUMENTATION', 'PROPOSITION'],
  envelopeKeys,
  nameAlias: { entity_subtype: 'subtype_code', concept_subtype: 'subtype_code', proposition_subtype: 'subtype_code' },
  identitySlots: { ENTITY: ['world_membership.individual_ref', 'subtype_code'], CONCEPT: ['subtype_code'] },
  contractRulings: { 'world_membership.individual_ref': ['EN-W-7'] },
  // SF-04 ④ 的适用面：**声明为引用的槽位**才校验文法；aliases 等自由文本不在其内。
  // 引用位带**类型域**（第二轮 P1-④）：端点/参与者 = object；来源类 = either；记录集合 = record。
  refPaths: { world_membership: ['v.kind_ref', 'v.individual_ref'], relation_type_ref: ['v'],
    participants: ['v[*]'], scheme_ref: ['v'], engagement_target: ['v'], conclusion: ['v.proposition_rev'],
    // 两条 Entity 真实槽位（Object Schema 表逐字类型域）：carrier_ref 允许 rec:、其 source 是 ref?
    carrier_refs: [refAt('v[*].carrier_ref', 'either'), refAt('v[*].source.v', 'object')],
    availability_checks: [refAt('v[*]', 'record')] },
  subtypes: {},
};
const S = (code, kind, slots, over = {}) => reg.subtypes[code] = {
  subtype_code: code, kind, slot_set: slots, identity_slots: over.identity_slots ?? [],
  identity_slot_exemptions: over.exempt ?? [], status: over.status ?? 'ACTIVE', singleton: !!over.singleton,
};
export const contracts = {
  aliases: { na_allowed: true, na_reasons: ['CATEGORY_MISMATCH'], empty_allowed: true },
  description: { na_allowed: true, na_reasons: ['CATEGORY_MISMATCH'], empty_allowed: false },
  world_membership: { na_allowed: false, na_reasons: [], empty_allowed: false },
  construction_state: { na_allowed: false, na_reasons: [], empty_allowed: false },
  conclusion: { na_allowed: false, na_reasons: [], empty_allowed: false },
  _default: { na_allowed: true, na_reasons: ['CATEGORY_MISMATCH'], empty_allowed: false },
};
const C = s => contracts[s] || contracts._default;
// **夹具范围声明（第二轮审查要求明确）**：下面这些最小实例验证的是**简化形态机制**
// （五态键集封闭、拒写五项、引用位类型域、稀疏展开、子型注册一致性），**不是完整 S-L1 合法性**。
// 与正式 Object Schema 的已知偏离全部列在 poc/README.md「夹具不是合法对象」一节，其中最重要的是：
// `world_membership.kind_ref/individual_ref` 与 `conclusion.proposition_rev` 的正式类型是 `ref?`
// （五态包裹的引用），夹具里写成裸字符串；`description` / `statement` / `definition` 三个槽名
// 在契约与 Schema 文档里**根本不存在**，是夹具自造的占位名。这些偏离不改动本轮要验的判据，
// 但任何人把"绿"读成"这些对象在正式 Schema 下合法"都是误读。
S('PHYSICAL_OBJECT', 'ENTITY', ['world_membership', 'aliases', 'description', 'carrier_refs', 'availability_checks'],
  { identity_slots: ['world_membership.individual_ref', 'subtype_code'] });
S('CONCEPT_PLAIN', 'CONCEPT', ['alt_labels', 'definition'], { identity_slots: ['subtype_code'] });
S('ASS_REL', 'ASSOCIATION', ['relation_type_ref', 'participants']);
S('ARG_SCHEME', 'ARGUMENTATION', ['scheme_ref', 'conclusion', 'construction_state', 'local_outcome']);
S('PROP_PLAIN', 'PROPOSITION', ['statement']);

export const mkOut = () => ({ findings: [], refused: null, candidate: false,
  fail(code, msg, sev = 'VIOLATION') { this.findings.push({ code, msg, sev }); },
  badEntry(code, c) { (this.badEntries ??= []).push(c); } });
/** 写信封：SF-22 文法标识 + **整数** schema_version + 无响应回显键（SS-15a 第③类仅响应侧） */
const OBJ = { ENTITY: 'HENT-e1', CONCEPT: 'HCON-c1', ASSOCIATION: 'HASS-a1', ARGUMENTATION: 'HARG-g1', PROPOSITION: 'HPRO-p1' };
export const env = (kind, sub, extra = {}) => ({ object_id: OBJ[kind], object_kind: kind,
  schema_version: 1, space_id: 'sp-root', subtype_code: sub,
  source_refs: { '@st': 'DECLARED', v: ['HENT-src@r1'] },
  registrant_ref: { '@st': 'DECLARED', v: 'agt:me' }, ...extra });   // registrant_ref 是 V1 主体，不适用 SF-22
export const ok = (kind, sub, payload, extra) => {
  const o = mkOut();
  const r = ingest(env(kind, sub, extra), payload, reg, o);
  const entry = reg.subtypes[sub];
  const norm = entry ? expand(entry, payload) : payload;
  if (entry && !r.refused) for (const s of entry.slot_set) checkTagged(s, norm[s], C(s), o);   // SF-11/SF-14/SF-16
  return { r, o, norm };
};

// ---- ① 真实最小合法形态 ----------------------------------------------------------
test('P1-1 五类最小合法实例：合 SF-22 文法 + 整数版本 + 无回显键，不拒写且规范形态槽位穷尽带标签', () => {
  const cases = [
    ['ENTITY', 'PHYSICAL_OBJECT', { world_membership: { '@st': 'DECLARED', v: { kind_ref: 'HCON-wt@r1', individual_ref: 'HENT-e1@r1' } }, aliases: { '@st': 'DECLARED', v: [] } }],
    ['CONCEPT', 'CONCEPT_PLAIN', { alt_labels: { '@st': 'DECLARED', v: ['x'] } }],
    ['ASSOCIATION', 'ASS_REL', { relation_type_ref: { '@st': 'DECLARED', v: 'HCON-rel@r1' }, participants: { '@st': 'DECLARED', v: ['HENT-a@r1', 'HENT-b@r1'] } }],
    ['ARGUMENTATION', 'ARG_SCHEME', { scheme_ref: { '@st': 'DECLARED', v: 'HCON-s@r1' } }],
    ['PROPOSITION', 'PROP_PLAIN', { statement: { '@st': 'DECLARED', v: 'p' } }],
  ];
  for (const [kind, sub, payload] of cases) {
    const { r, norm } = ok(kind, sub, payload);
    assert.equal(r.refused, false, `${sub} 不应被拒写（实际 ${r.code}）`);
    assert.deepEqual(Object.keys(norm).sort(), [...reg.subtypes[sub].slot_set].sort(), `${sub} 槽位穷尽（SF-03）`);
    assert.ok(Object.values(norm).every(isTagged), `${sub} 每槽位都是带标签值`);
  }
});

// ---- ② 完整五态正反例矩阵（SF-17 逐态键集**封闭**） -------------------------------
const MATRIX = [
  ['DECLARED', { '@st': 'DECLARED', v: 'HENT-x@r1' }, null],
  ['DECLARED', { '@st': 'DECLARED', v: 'x', reason: 'r' }, 'STATE_KEYS_OUT_OF_RANGE'],        // 多键
  ['UNKNOWN', { '@st': 'UNKNOWN', reason: 'r' }, null],
  ['UNKNOWN', { '@st': 'UNKNOWN', reason: 'r', v: 'HENT-7@r1' }, 'STATE_KEYS_OUT_OF_RANGE'],  // 审查纠正 #2
  ['UNKNOWN', { '@st': 'UNKNOWN' }, 'STATE_KEYS_OUT_OF_RANGE'],                                // 缺 reason
  ['NOT_APPLICABLE', { '@st': 'NOT_APPLICABLE', reason: 'CATEGORY_MISMATCH' }, null],
  ['NOT_APPLICABLE', { '@st': 'NOT_APPLICABLE' }, 'STATE_KEYS_OUT_OF_RANGE'],
  ['UNRESOLVED', { '@st': 'UNRESOLVED', ref: 'HENT-1@r1' }, null],                             // 审查纠正 #1：是 ref
  ['UNRESOLVED', { '@st': 'UNRESOLVED', reason: 'wrong' }, 'STATE_KEYS_OUT_OF_RANGE'],         // 不是 reason
  ['ABSENT', { '@st': 'ABSENT' }, null],
  ['ABSENT', { '@st': 'ABSENT', reason: 'x' }, 'STATE_KEYS_OUT_OF_RANGE'],                     // 只有标签
  ['DECLARED', { '@st': 'PENDING', v: 'x' }, 'STATE_TAG_OUT_OF_RANGE'],                        // 标签越界
];
test('P1-2 五态逐态键集矩阵：合法编码过关、集合外键拒写（SF-17；五个状态都有正反例）', () => {
  assert.deepEqual([...new Set(MATRIX.map(m => m[0]))].sort(), [...STATES].sort(), '矩阵必须覆盖全部五态');
  for (const [st, val, expect] of MATRIX) {
    const { r } = ok('ENTITY', 'PHYSICAL_OBJECT', { aliases: val });
    if (expect === null) assert.equal(r.refused, false, `${st} 的合法编码被误拒：${r.code}`);
    else assert.equal(r.code, expect, `${st} 的非法编码应拒为 ${expect}，实际 ${r.code}`);
  }
});

// ---- 空集合 / 缺标签 / 稀疏展开 ---------------------------------------------------
test('P1-3 空集合正反成对：empty_allowed=true 合法；=false 产 finding 且记录仍保存（SF-11/SF-14）', () => {
  const yes = ok('ENTITY', 'PHYSICAL_OBJECT', { aliases: { '@st': 'DECLARED', v: [] } });
  assert.equal(yes.r.refused, false); assert.deepEqual(yes.o.findings, [], 'DECLARED([]) 在 aliases 上必须完全合法');
  const no = ok('ENTITY', 'PHYSICAL_OBJECT', { description: { '@st': 'DECLARED', v: '' } });
  assert.equal(no.r.refused, false, '空集合非法是缺陷，不是拒写');
  assert.deepEqual(no.o.findings.map(f => f.code), ['EMPTY_NOT_PERMITTED']);
  // 码名与严重度逐字对照文档登记表（第二轮 P1-⑤：严重度也是判据，我原先写成 DEFICIENCY）
  const DOC_SEVERITY = {
    EMPTY_NOT_PERMITTED: 'VIOLATION',                 // SF-14「FAIL(EMPTY_NOT_PERMITTED, VIOLATION)，但记录照常保存」
    NOT_APPLICABLE_UNDECLARED: 'DEFICIENCY',          // SCR-76
    NOT_APPLICABLE_SCOPE_MISMATCH: 'DEFICIENCY',      // SCR-76
    SUBTYPE_UNREGISTERED: 'DEFICIENCY',               // SS-13 / SRG-21
  };
  assert.equal(no.o.findings[0].sev, DOC_SEVERITY.EMPTY_NOT_PERMITTED,
    `桩件严重度 ${no.o.findings[0].sev} 与文档登记的 ${DOC_SEVERITY.EMPTY_NOT_PERMITTED} 不符 ⇒ 桩件回归即红`);
});
test('P1-3b NOT_APPLICABLE 的两个失败是两个码（SCR-76）：规则未允许 vs 理由不在集内，都是 DEFICIENCY 且不拒写', () => {
  const notAllowed = ok('ENTITY', 'PHYSICAL_OBJECT', { world_membership: { '@st': 'NOT_APPLICABLE', reason: 'CATEGORY_MISMATCH' } });
  assert.equal(notAllowed.r.refused, false, '语义后门走 finding，不走拒写');
  assert.deepEqual(notAllowed.o.findings.map(f => [f.code, f.sev]), [['NOT_APPLICABLE_UNDECLARED', 'DEFICIENCY']]);
  const badReason = ok('ENTITY', 'PHYSICAL_OBJECT', { aliases: { '@st': 'NOT_APPLICABLE', reason: 'NOT_LISTED_ANYWHERE' } });
  assert.deepEqual(badReason.o.findings.map(f => [f.code, f.sev]), [['NOT_APPLICABLE_SCOPE_MISMATCH', 'DEFICIENCY']]);
  const good = ok('ENTITY', 'PHYSICAL_OBJECT', { aliases: { '@st': 'NOT_APPLICABLE', reason: 'CATEGORY_MISMATCH' } });
  assert.deepEqual(good.o.findings, [], '同一对象换成注册内的合法理由后必须 0 finding（SCR-76 的成对断言）');
});
test('P1-4 缺 @st 的空容器 = 用空代替未知 → STATE_UNDECLARED，保存不阻断，且原样保留不静默改写（SF-11）', () => {
  const { o, norm } = ok('ENTITY', 'PHYSICAL_OBJECT', { aliases: [] });
  assert.deepEqual(o.findings.map(f => f.code), ['STATE_UNDECLARED']);
  assert.equal(o.refused, null); assert.equal(norm.aliases['@st'], undefined);
});
test('P1-5 三态互不代替：DECLARED([]) / ABSENT / UNKNOWN(reason) 是三个不同事实', () => {
  const c = v => JSON.stringify(v, (k, x) => x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).sort()) : x);
  const a = c({ '@st': 'DECLARED', v: [] }), b = c({ '@st': 'ABSENT' }), d = c({ '@st': 'UNKNOWN', reason: 'r' });
  assert.notEqual(a, b); assert.notEqual(b, d); assert.notEqual(a, d);
});
test('P1-6 语义必填但未提交 → 展开 ABSENT 并保存；只有形态五项才拒写（SF-04）', () => {
  const { r, norm } = ok('ENTITY', 'PHYSICAL_OBJECT', {});
  assert.equal(r.refused, false, '缺语义必填槽位不是形态错误');
  assert.deepEqual(norm.world_membership, { '@st': 'ABSENT' });
});

// ---- 拒写封闭五项（每项正反成对） -------------------------------------------------
test('P1-7 拒写封闭五项各有正反例；五项之外一律保存（SF-04）', () => {
  assert.equal(ok('ENTITY', 'PHYSICAL_OBJECT', {}, { object_kind: 'NOPE' }).r.code, 'OBJECT_KIND_UNRESOLVABLE');        // ①
  assert.equal(ok('ENTITY', 'PHYSICAL_OBJECT', {}).r.refused, false);                                                      // ① 正例
  assert.equal(ok('ENTITY', 'PHYSICAL_OBJECT', {}, { schema_version: '1.0' }).r.code, 'ENVELOPE_SCHEMA_VERSION_TYPE');     // ② 字符串版本
  assert.equal(ok('ENTITY', 'PHYSICAL_OBJECT', {}, { schema_version: 0 }).r.code, 'ENVELOPE_SCHEMA_VERSION_TYPE');
  assert.equal(ok('ENTITY', 'PHYSICAL_OBJECT', {}, { object_id: undefined }).r.code, 'ENVELOPE_REQUIRED_MISSING');
  assert.equal(ok('ENTITY', 'PHYSICAL_OBJECT', {}, { space_id: undefined }).r.code, 'ENVELOPE_REQUIRED_MISSING');
  assert.equal(ok('ENTITY', 'PHYSICAL_OBJECT', { confidence: { '@st': 'DECLARED', v: 0.9 } }).r.code, 'UNKNOWN_KEY_IN_PAYLOAD');   // ③
  assert.equal(ok('ENTITY', 'PHYSICAL_OBJECT', { entity_subtype: { '@st': 'DECLARED', v: 'X' } }).r.code,
    'ENVELOPE_KEY_DUPLICATE_IN_PAYLOAD', '异名归一命中信封键落同一项（SS-09a）');
  assert.equal(ok('ASSOCIATION', 'ASS_REL', { relation_type_ref: { '@st': 'DECLARED', v: 'HCON-rel' } }).r.code,
    'REF_PATTERN_MISMATCH', '引用位缺 @revision 段必须拒（SF-04 ④）');
  assert.equal(ok('ASSOCIATION', 'ASS_REL', { relation_type_ref: { '@st': 'DECLARED', v: 'HCON-rel@r1' } }).r.refused, false, '正例');
  assert.equal(ok('ENTITY', 'PHYSICAL_OBJECT', { aliases: { '@st': 'MISSING', reason: 'x' } }).r.code, 'STATE_TAG_OUT_OF_RANGE');  // ⑤
  assert.equal(ok('ENTITY', 'PHYSICAL_OBJECT', { aliases: { '@st': 'DECLARED', v: [] } }).r.refused, false);               // 正例
});
test('P1-8 标识文法与响应回显键：`o1` / 写入带 boundary 都必须拒；自由文本不得被误判为引用', () => {
  assert.equal(ok('ENTITY', 'PHYSICAL_OBJECT', {}, { object_id: 'o1' }).r.code, 'ENVELOPE_OBJECT_ID_GRAMMAR');
  assert.equal(ok('ENTITY', 'PHYSICAL_OBJECT', {}, { boundary: { coverage: 'COMPLETE', truncated: false, limit_applied: 50 } }).r.code,
    'ENVELOPE_ECHO_KEY_ON_WRITE', 'SS-15a 第③类只出现在读响应');
  assert.equal(ok('ENTITY', 'PHYSICAL_OBJECT', { aliases: { '@st': 'DECLARED', v: ['e:root', 'p:1@1'] } }).r.refused, false,
    '不含 @ 或不像引用的自由文本不得被误判');
  assert.equal(ok('ENTITY', 'PHYSICAL_OBJECT', {}, { registrant_ref: { '@st': 'DECLARED', v: 'agt:me' } }).r.refused, false,
    'registrant_ref 是宿主注入的 V1 主体，不适用 SF-22 对象文法');
});
test('P1-8b 引用位**类型域**三类各有正反例：来源允许 rec:、端点只允许对象引用、记录集合只允许 rec:（SF-24/SS-34/SS-05）', () => {
  // 来源类 = `(ref | rec:)`：两种都合法（第二轮 P1-④：桩件原先只有一条对象引用文法，把合法来源判死）
  assert.equal(ok('ENTITY', 'PHYSICAL_OBJECT', {}, { source_refs: { '@st': 'DECLARED', v: ['rec:HREC-7'] } }).r.refused, false,
    'SF-24：rec: 是合法引用形态；SS-34：来源允许 rec:');
  assert.equal(ok('ENTITY', 'PHYSICAL_OBJECT', {}, { source_refs: { '@st': 'DECLARED', v: ['HENT-src@r1', 'rec:HREC-7'] } }).r.refused, false,
    '同一集合内混用两种类型域内的形态合法');
  assert.equal(ok('ENTITY', 'PHYSICAL_OBJECT', {}, { source_refs: { '@st': 'DECLARED', v: ['rec:'] } }).r.code, 'REF_PATTERN_MISMATCH',
    'SF-24 的语法是 "rec:${record_id}"，空前缀不算引用');
  assert.equal(ok('ENTITY', 'PHYSICAL_OBJECT', { carrier_refs: { '@st': 'DECLARED', v: [{ carrier_ref: 'rec:HREC-1' }, { carrier_ref: 'HENT-c@r1' }] } }).r.refused, false,
    'carrier_ref 的类型域逐字是 `ref | rec:`（Object Schema 槽位表）');
  assert.equal(ok('ENTITY', 'PHYSICAL_OBJECT', { carrier_refs: { '@st': 'DECLARED', v: [{ carrier_ref: 'HENT-c@r1', source: { '@st': 'DECLARED', v: 'HCON-c@r1' } }] } }).r.refused, false,
    '嵌套的 source 是 ref?（五态包裹的对象引用）');
  assert.equal(ok('ENTITY', 'PHYSICAL_OBJECT', { carrier_refs: { '@st': 'DECLARED', v: [{ carrier_ref: 'HENT-c@r1', source: { '@st': 'DECLARED', v: 'rec:HREC-1' } }] } }).r.code,
    'REF_PATTERN_MISMATCH', '`source: ref?` 不是 `ref | rec:` —— 类型域逐位取原文，不得就近放宽');
  assert.equal(ok('ENTITY', 'PHYSICAL_OBJECT', { availability_checks: { '@st': 'DECLARED', v: ['rec:HREC-9'] } }).r.refused, false,
    'availability_checks 逐字是 rec: 集合');
  assert.equal(ok('ENTITY', 'PHYSICAL_OBJECT', { availability_checks: { '@st': 'DECLARED', v: ['HENT-e1@r1'] } }).r.code, 'REF_PATTERN_MISMATCH',
    '纯记录位放对象引用同样非法（类型域是双向判据）');
  assert.equal(ok('ENTITY', 'PHYSICAL_OBJECT', { world_membership: { '@st': 'DECLARED', v: { kind_ref: 'rec:HREC-1', individual_ref: 'HENT-e1@r1' } } }).r.code,
    'REF_PATTERN_MISMATCH', '端点/分类位只接受对象引用（SS-05：rec: 不得赋给对象引用槽位）');
  // 反向锚点：**一条共享文法**必在两个方向同时出错，这正是本轮 P1-④ 的根因
  assert.equal(isObjectRef('rec:HREC-7'), false, '方向一：全用对象文法 ⇒ 合法来源被判死');
  assert.equal(isRecordRef('rec:HREC-7'), true, '方向二：全用"对象|记录"并集 ⇒ 端点位该拒的 rec: 被放开');
  assert.equal(refAt('v').as, 'object', '默认类型域是 object：收紧是默认，放宽必须逐位显式声明');
  assert.throws(() => refAt('v', 'whatever'), /未知类型域/, '类型域是封闭集，写错不得静默放行');
  // 反向锚点：本轮修 P1-④ 时**新发现的第二个缺陷**——旧的下钻只在末段处理数组，
  // `v[*].carrier_ref` 取到的是**元素对象**，被"只检查字符串"的过滤器静默跳过 ⇒ 嵌套引用位从未被检查。
  const naiveWalk = (val, p) => {
    let cur = val;
    for (const s of p.split('.')) {
      if (cur == null) break;
      if (s.endsWith('[*]')) { cur = cur[s.slice(0, -3)]; cur = Array.isArray(cur) ? cur : [cur]; } else cur = cur[s];
    }
    return Array.isArray(cur) ? cur : [cur];
  };
  const nodes = naiveWalk({ '@st': 'DECLARED', v: [{ carrier_ref: 'rec:X' }] }, 'v[*].carrier_ref');
  assert.deepEqual(nodes, [undefined], '旧实现把 `[*]` 展开出的**数组**当成当前节点，下一段直接取到 undefined');
  assert.equal(nodes.filter(x => typeof x === 'string').length, 0, '于是这条判据一条都没跑过——"没有 finding"不等于"检查通过"');
});
test('P1-8c 信封第②类状态槽位与载荷**同一判据**：封闭键集只接了一半 = 机制漏位置（SF-17 / SF-04 ⑤；第三轮审查 P1）', () => {
  // 审查原夹具，一字未改：SF-17 下 UNKNOWN 只允许 {@st, reason}，带 `v` 即集合外键。
  const bad = { '@st': 'UNKNOWN', reason: 'NOT_SURVEYED', v: ['secret'] };
  const inEnvelope = ok('ENTITY', 'PHYSICAL_OBJECT', { description: { '@st': 'ABSENT' } }, { source_refs: bad });
  assert.equal(inEnvelope.r.refused, true, '信封里的 UNKNOWN+v 必须拒写（旧实现放行了）');
  assert.equal(inEnvelope.r.code, 'STATE_KEYS_OUT_OF_RANGE');
  // **位置完备性**：同一非法形态落在载荷侧必须得到同一个码——判据不许只在一侧生效。
  const inPayload = ok('ENTITY', 'PHYSICAL_OBJECT', { description: bad });
  assert.equal(inPayload.r.code, inEnvelope.r.code, '同一形态两位置判据不同 ⇒ 有一侧根本没接入检查');
  // 另外四种漏法（都是我第一版会写的形态）各自钉住
  const variants = [
    ['ABSENT 带 reason', { source_refs: { '@st': 'ABSENT', reason: 'x' } }, 'STATE_KEYS_OUT_OF_RANGE'],
    ['标签越界', { source_refs: { '@st': 'PENDING', v: [] } }, 'STATE_TAG_OUT_OF_RANGE'],
    ['UNKNOWN 缺 reason', { completion_basis: { '@st': 'UNKNOWN' } }, 'STATE_KEYS_OUT_OF_RANGE'],
    ['UNRESOLVED 用 reason 不用 ref', { completion_basis: { '@st': 'UNRESOLVED', reason: 'x' } }, 'STATE_KEYS_OUT_OF_RANGE'],
    ['缺 @st', { source_refs: { v: ['HENT-src@r1'] } }, 'ENVELOPE_DOMAIN_SLOT_UNTAGGED'],
    ['DECLARED 的 registrant_ref 空串', { registrant_ref: { '@st': 'DECLARED', v: '' } }, 'ENVELOPE_DOMAIN_SLOT_UNTAGGED'],
  ];
  for (const [name, extra, code] of variants) {
    const t = ok('ENTITY', 'PHYSICAL_OBJECT', { description: { '@st': 'ABSENT' } }, extra);
    assert.equal(t.r.code, code, `"${name}"应落 ${code}，实际 ${t.r.code || '未拒写'}`);
  }
  // 反向：合法形态一律不得被误杀（把合法来源判死是第二轮 P1 的同族错误）
  for (const good of [{ source_refs: { '@st': 'DECLARED', v: ['rec:HREC-7'] } },
    { source_refs: { '@st': 'NOT_APPLICABLE', reason: 'CATEGORY_MISMATCH' } },
    { source_refs: { '@st': 'ABSENT' } }, { source_refs: { '@st': 'UNRESOLVED', ref: 'HENT-src@r1' } },
    { completion_basis: { '@st': 'UNKNOWN', reason: 'NOT_SURVEYED' } }]) {
    const t = ok('ENTITY', 'PHYSICAL_OBJECT', { description: { '@st': 'ABSENT' } }, good);
    assert.equal(t.r.refused, false, `合法形态被误杀：${JSON.stringify(good)} → ${t.r.code}`);
  }
  // 反向锚点：第一版只查"有没有 @st"。它必须放过审查的夹具，否则这条用例没在验新代码。
  const onlyHasTag = v => (v !== undefined && !isTagged(v) ? 'ENVELOPE_DOMAIN_SLOT_UNTAGGED' : null);
  assert.equal(onlyHasTag(bad), null, '锚点失效检查：只查 @st 在场的实现会放过 UNKNOWN+v');
  assert.equal(keysOutOfRange(bad), true, '判据本身成立：`v` 不在 UNKNOWN 的合法键集内');
});
test('P1-9 未注册子型 → 候选载荷，不拒写、不冒充规范形态（SS-13/SS-56）', () => {
  const { r, o } = ok('ENTITY', 'WORLD_MID', { whatever: { '@st': 'ABSENT' } });
  assert.equal(r.refused, false); assert.equal(o.candidate, true);
  assert.deepEqual(o.findings.map(f => f.code), ['SUBTYPE_UNREGISTERED']);
});

// ---- ③ 错误实现必红 ---------------------------------------------------------------
test('P1-10 判据表必须与 SF-17 原文逐字一致；四种我犯过的削弱都必须被抓住', () => {
  const DOC_KEYS = {   // 逐字抄自 SF-17：DECLARED{@st,v} UNKNOWN{@st,reason} NOT_APPLICABLE{@st,reason} UNRESOLVED{@st,ref} ABSENT{@st}
    DECLARED: ['@st', 'v'], UNKNOWN: ['@st', 'reason'], NOT_APPLICABLE: ['@st', 'reason'],
    UNRESOLVED: ['@st', 'ref'], ABSENT: ['@st'],
  };
  for (const st of STATES) assert.deepEqual([...KEYS[st]].sort(), [...DOC_KEYS[st]].sort(), `桩件的 ${st} 键集与原文不符`);
  const mutants = {
    'UNRESOLVED 写成 reason（我犯过）': { UNRESOLVED: ['@st', 'reason'] },
    'UNKNOWN 允许附带 v（SF-17 反例）': { UNKNOWN: ['@st', 'reason', 'v'] },
    'ABSENT 允许附带 reason': { ABSENT: ['@st', 'reason'] },
    'DECLARED 允许附带 reason': { DECLARED: ['@st', 'v', 'reason'] },
  };
  for (const [name, mut] of Object.entries(mutants)) {
    const caught = MATRIX.some(([st, val, expect]) => {
      const want = mut[st] ?? DOC_KEYS[st];
      const got = Object.keys(val).sort();
      const mutantRejects = got.length !== want.length || got.some((k, i) => k !== want[i]) || !STATES.includes(val['@st']);
      return mutantRejects !== (expect !== null);       // 变异实现与文档判据在矩阵某行分歧
    });
    assert.equal(caught, true, `变异体"${name}"未被矩阵抓住 ⇒ 矩阵分辨力不足`);
  }
});
