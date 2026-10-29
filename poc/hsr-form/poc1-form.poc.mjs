/**
 * PoC-1 对象形态与五态。
 * 独立审查（基线 da113bcd）判本单元"最小合法对象尚未被真正验证"，三条纠正全部成立并已复现：
 *   夹具用了 `o1`/`e:root` 这类不合 SF-22 文法的标识、字符串 `schema_version:"1.0"`（文档两处写**整数**）、
 *   以及把只属于读响应的 `boundary` 放进入写信封。
 * 因此本文件重写为三件事：
 *   ① 真实最小合法形态（SF-22 文法 + 整数版本 + 无回显键）
 *   ② **完整五态正反例矩阵**（审查指出原稿缺这张表）
 *   ③ **错误实现必红**：桩件的判据表若被削弱，矩阵必须立刻变红
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ingest, expand, checkTagged, isTagged, keysOutOfRange, STATES, KEYS } from './core.mjs';

// ---- 夹具：槽位契约写成数据（§5.2 机器可读表） -----------------------------------
export const envelopeKeys = ['object_id', 'object_kind', 'space_id', 'revision_id', 'schema_version',
  'recorded_at', 'identity_slot_set_digest', 'subtype_code', 'registrant_ref', 'source_refs'];
export const reg = {
  kinds: ['ENTITY', 'CONCEPT', 'ASSOCIATION', 'ARGUMENTATION', 'PROPOSITION'],
  envelopeKeys,
  nameAlias: { entity_subtype: 'subtype_code', concept_subtype: 'subtype_code', proposition_subtype: 'subtype_code' },
  identitySlots: { ENTITY: ['world_membership.individual_ref', 'subtype_code'], CONCEPT: ['subtype_code'] },
  contractRulings: { 'world_membership.individual_ref': ['EN-W-7'] },
  // SF-04 ④ 的适用面：**声明为引用的槽位**才校验文法；aliases 等自由文本不在其内
  refPaths: { world_membership: ['v.kind_ref', 'v.individual_ref'], relation_type_ref: ['v'],
    participants: ['v[*]'], scheme_ref: ['v'], engagement_target: ['v'], conclusion: ['v.proposition_rev'] },
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
S('PHYSICAL_OBJECT', 'ENTITY', ['world_membership', 'aliases', 'description'], { identity_slots: ['world_membership.individual_ref', 'subtype_code'] });
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
  assert.equal(no.o.findings[0].sev, 'DEFICIENCY');
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
