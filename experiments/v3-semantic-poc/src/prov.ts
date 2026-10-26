/**
 * V3 PoC · P1 —— 纯函数投影层：EnvelopeEvent 流 → {activities, entities, agents,
 * usage, generation, derivation} 记录（#11 §4-P1 工作项 1；执行计划 #10 §4-P1）。
 *
 * 纯 TypeScript、零运行时依赖；不读文件、不写文件、不接线 src/host；同一输入
 * 两次投影 → 逐字段相同（所有集合输出前确定性排序，无随机、无时钟）。
 *
 * 映射基线（docs/architecture/W3C_ALIGNMENT.md §二 + CORE_SEMANTICS.md §1）：
 *  - `prov:Activity` ← run.*（Run 是 V1 的执行记录，映射保留来源与活动角色，
 *    不假装二者一对一等价——#10 §2.2）；deck.executed / analysis.performed /
 *    observation.recorded 各成子活动。
 *  - `prov:Entity` ← artifact / observation 数据物 / deck 输入 / 分析结果 /
 *    claim 与 note 的记录实体（「具有固定身份的物体或信息」，CORE_SEMANTICS §1）。
 *  - `prov:used` / `prov:wasGeneratedBy` / `prov:wasDerivedFrom` 分别落
 *    usage / generation / derivation 三类边。
 *  - `prov:Agent` ← 事件的可归因执行者（v1 元数据 actor 或 payload.tool/solver）；
 *    不可归因 → 显式 `UNKNOWN` Agent 记录，**不是省略**（#10 §2.1 保留未知项）。
 *
 * ── SOSA 例外纪律（本文件最重要的注释块；负例测试见 prov.test.ts）────────
 * `sosa:Observation` / `sosa:Result` **只**给「deck 执行（deck.executed 的仿真
 * 运行）所产生的数值观测」——真实机时仿真是测量类比（仿真器≈测量装置），且
 * 观测是单一数值（payload.value 为有限数）时才有确定的 ObservedProperty 与
 * hasSimpleResult。以下情形一律**不**配 SOSA，只做 prov 投影并显式记 unknown：
 *  1. `analysis.performed`（纯分析脚本 / 后处理）——W3C 没有 prov:Analysis，
 *     分析数据处理是 `prov:Activity` + 领域 `dsh:Analysis`（W3C_ALIGNMENT §二
 *     「Analysis」行 + §一「普通文件搬运仍用 prov:Activity」的同类纪律）；
 *     即使产出数值（two-analyses fixture 的 emittance 两版结果）也**绝不**造
 *     sosa:Observation/sosa:Result——「不得为了让验证通过凭空制造
 *     sosa:Observation / sosa:Result」（#10 §6 零容忍项）。
 *     → 测试：任何 analysis.performed 事件出 sosa:Observation = 测试红。
 *  2. 复合观测（如 strk-04 的 quantities 数组跨 run 对比）：被观测对象身份
 *     不确定（一次 Observation 只有一个 observedSubject），只产
 *     observation_record 实体 + unknown 注记，不强行拆成伪单值 Result。
 *  3. 非数值 observation.recorded：同上。
 *  4. 失败 Run：允许「有 Activity 与错误记录但无可用 sosa:Result」
 *     （CORE_SEMANTICS §1.1；W3C_ALIGNMENT §四「强制失败 Experiment 有结果」
 *     冲突行）。
 *
 * ── 派生 ≠ 证明 ──────────────────────────────────────────────────────────
 * derivation 只承载**数据派生**（分析输出 wasDerivedFrom 分析输入，
 * W3C_ALIGNMENT §三 DERIVED_FROM 拆分行的「数据派生」侧）。
 * 推测/建议通道 claim.candidate 的 `payload.based_on` 是**逻辑推理依据**，
 * 属于 dsh:Argument（P3）范畴，**绝不**投影成 prov:wasDerivedFrom——「不能把
 * prov:wasDerivedFrom 当科学结论蕴涵」（W3C_ALIGNMENT §四冲突表）。based_on
 * 原样保留在实体记录的 based_on_refs 字段上供 P3 使用。
 */

import type { EnvelopeEvent } from './envelope.ts'

export const PROV_PROJECTION_VERSION = 'poc/prov-projection/v0.1'

/** 显式未知标记：字段存在但取值未知时一律写这个字面量，而不是省略字段。 */
export const UNKNOWN = 'UNKNOWN'

const PROV_ACTIVITY = 'prov:Activity'
const PROV_ENTITY = 'prov:Entity'
const PROV_AGENT = 'prov:Agent'
const SOSA_OBSERVATION = 'sosa:Observation'
const SOSA_RESULT = 'sosa:Result'
const SHA256_HEX_RE = /^[0-9a-f]{64}$/

// ── 记录类型 ─────────────────────────────────────────────────────────────

/** 回指源事件三元组（SPEC v0.1 定位器：文件 + run_id + event_seq）。 */
export interface SourceRef {
  file: string
  run_id: string
  event_seq: number
}

export interface ActivityRecord {
  id: string
  activity_kind: 'run' | 'deck_execution' | 'analysis' | 'observation'
  prov_type: string
  /** 领域子类型（CORE_SEMANTICS §1.1）：分析 = dsh:Analysis；其余 null。 */
  dsh_subtype: string | null
  /** SOSA 例外纪律：仅数值观测非 null（见文件头注释块）。 */
  sosa: string | null
  run_id: string
  file: string
  source_ref: SourceRef
  /** prov:wasAssociatedWith 的折叠表示：agent 记录 id 或 'UNKNOWN'。 */
  agent: string
  started_at: string
  ended_at: string
  /** run：RUNNING/FINISHED/FAILED；其余活动无生命周期事件 = NOT_RECORDED。 */
  status: string
  exit_code: number | string
  /** 仅 sosa 观测：其 Result 实体定位。 */
  sosa_result: { entity_id: string; observed_property: string; has_simple_result: unknown; unit: unknown } | null
  observed_entity_id: string
  /** analysis 的重分析指认（payload.reanalysis_of_event_seq，同 run 内 seq）。 */
  derived_from_event_seq: number | string
  unknowns: string[]
}

export interface EntityRecord {
  id: string
  /** 恒为 prov:Entity；sosa 结果在 entity.sosa_role 标注，见 sosa_role 字段。 */
  entity_type: string
  /** 观测 Result 时为 'sosa:Result'，其余 null（不滥发 SOSA 类）。 */
  sosa_role: string | null
  /** 记录角色（多来源合并后为并集，排序去重）。 */
  roles: string[]
  name: string
  sha256: string | null
  content_sha256_claimed: string | null
  channel: string | null
  metric: unknown
  unit: unknown
  value: unknown
  statement: string | null
  /** 仅 claim/note 实体：payload.based_on 原样保留（推理依据，非 prov 派生）。 */
  based_on_refs: { run_id: string; seq: number }[]
  run_id: string
  source_ref: SourceRef
  /** 同一数据身份在不同文件出现时的全部来源（主 source_ref 之外的定位）。 */
  also_seen_in: SourceRef[]
  unknowns: string[]
}

export interface AgentRecord {
  id: string
  agent_type: string
  /** SOFTWARE（tool/solver）| USER | AGENT | PLUGIN（V1 actor.kind）| UNKNOWN。 */
  agent_kind: string
  name: string
  source_ref: SourceRef
}

export interface UsageRecord {
  /** prov:used：活动使用实体（只限真正执行时使用了资源，W3C_ALIGNMENT §三）。 */
  activity_id: string
  entity_id: string
  source_ref: SourceRef
}

export interface GenerationRecord {
  /** prov:wasGeneratedBy：实体由活动生成。 */
  entity_id: string
  activity_id: string
  source_ref: SourceRef
}

export interface DerivationRecord {
  /** prov:wasDerivedFrom：数据实体来源于另一数据实体（仅数据派生，非证明）。 */
  derived_entity_id: string
  from_entity_id: string
  source_ref: SourceRef
}

export interface ProjectionInput {
  file: string
  events: readonly EnvelopeEvent[]
}

export interface Projection {
  projection_version: string
  files: string[]
  activities: ActivityRecord[]
  entities: EntityRecord[]
  agents: AgentRecord[]
  usage: UsageRecord[]
  generation: GenerationRecord[]
  derivation: DerivationRecord[]
  /** 信封 kind 不在投影映射表内的事件（不静默丢弃；P0 校验器下通常为空）。 */
  unmapped_events: { file: string; run_id: string; event_seq: number; kind: string }[]
}

// ── 小工具（全部确定性，无时钟/随机）─────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function strOf(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function hexOf(value: unknown): string | null {
  return typeof value === 'string' && SHA256_HEX_RE.test(value) ? value : null
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function cmpStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function sortUnique(values: string[]): string[] {
  return Array.from(new Set(values)).sort(cmpStrings)
}

/** 把 payload.based_on（整数=同 run seq；{run_id,seq}=跨 run）规范成定位列表。 */
function basedOnRefsOf(payload: Record<string, unknown>, ownRunId: string): { run_id: string; seq: number }[] {
  const raw = payload['based_on']
  if (!Array.isArray(raw)) return []
  const refs: { run_id: string; seq: number }[] = []
  for (const item of raw) {
    if (typeof item === 'number' && Number.isInteger(item)) refs.push({ run_id: ownRunId, seq: item })
    else if (isPlainObject(item) && typeof item['run_id'] === 'string' && typeof item['seq'] === 'number') {
      refs.push({ run_id: item['run_id'], seq: item['seq'] })
    }
  }
  return refs.sort((a, b) => cmpStrings(`${a.run_id}#${a.seq}`, `${b.run_id}#${b.seq}`))
}

/** 从事件提取可归因执行者；不可归因 → UNKNOWN（显式保留而非省略）。 */
function agentOf(event: EnvelopeEvent): { id: string; kind: string } {
  const v1 = event['v1']
  if (isPlainObject(v1) && isPlainObject(v1['actor'])) {
    const actor = v1['actor'] as Record<string, unknown>
    const kind = strOf(actor['kind']) ?? UNKNOWN
    const who = strOf(actor['agent_id']) ?? strOf(actor['id']) ?? strOf(actor['run_id']) ?? UNKNOWN
    return { id: `v1:${kind}:${who}`, kind }
  }
  const tool = strOf(event.payload['tool']) ?? strOf(event.payload['solver'])
  if (tool !== null) return { id: `software:${tool}`, kind: 'SOFTWARE' }
  return { id: UNKNOWN, kind: 'UNKNOWN' }
}

// ── 投影内部状态（深私有：一次性 build，返回纯数据）─────────────────────

interface MutableActivity extends ActivityRecord {}

interface EntitySeed {
  kind: 'deck' | 'artifact' | 'analysis_input' | 'analysis_output' | 'observation_record' | 'claim_record' | 'note_record' | 'sosa_result'
  name: string | null
  sha256: string | null
  event: EnvelopeEvent
  file: string
  runId: string
  seq: number
  claimed?: string | null
  metric?: unknown
  unit?: unknown
  value?: unknown
  statement?: string | null
  basedOn?: { run_id: string; seq: number }[]
  unknown?: string[]
}

class ProjectionBuilder {
  private readonly activities = new Map<string, MutableActivity>()
  private readonly entities = new Map<string, EntityRecord>()
  private readonly entityAliases = new Map<string, string>()
  private readonly agents = new Map<string, AgentRecord>()
  private readonly usage = new Map<string, UsageRecord>()
  private readonly generation = new Map<string, GenerationRecord>()
  private readonly derivation = new Map<string, DerivationRecord>()
  private readonly unmapped: Projection['unmapped_events'] = []
  /** 每个 run 最近一次登记的 artifact 实体别名（观测默认作用于它，可解析才连边）。 */
  private readonly lastArtifactByRun = new Map<string, string>()
  /** 定位用文件列表（写入 source_ref；不用参数属性——须保持可擦除 TS 语法）。 */
  private readonly fileNames: string[]

  constructor(files: string[]) {
    this.fileNames = files
  }

  // —— 索引辅助 ————————————————————————————————————————————————

  private sourceRefOf(file: string, runId: string, seq: number): SourceRef {
    return { file, run_id: runId, event_seq: seq }
  }

  private touchAgent(event: EnvelopeEvent, file: string, runId: string, seq: number): string {
    const { id, kind } = agentOf(event)
    if (!this.agents.has(id)) {
      this.agents.set(id, {
        id,
        agent_type: PROV_AGENT,
        agent_kind: kind,
        name: id,
        source_ref: this.sourceRefOf(file, runId, seq),
      })
    }
    return id
  }

  private upsertRunActivity(event: EnvelopeEvent, file: string, runId: string, seq: number): MutableActivity {
    let act = this.activities.get(`act:run:${runId}`)
    if (!act) {
      act = {
        id: `act:run:${runId}`,
        activity_kind: 'run',
        prov_type: PROV_ACTIVITY,
        dsh_subtype: null,
        sosa: null,
        run_id: runId,
        file,
        source_ref: this.sourceRefOf(file, runId, seq),
        agent: UNKNOWN,
        started_at: UNKNOWN,
        ended_at: UNKNOWN,
        status: 'RUNNING',
        exit_code: UNKNOWN,
        sosa_result: null,
        observed_entity_id: UNKNOWN,
        derived_from_event_seq: UNKNOWN,
        unknowns: [],
      }
      this.activities.set(act.id, act)
    } else if (act.file !== file) {
      // SPEC 硬规则 0：一个文件一个 run。跨文件同 run_id 不静默合并掉来源。
      act.unknowns.push(`run_id ${runId} 在多个文件出现（${act.file} 与 ${file}），SPEC 硬规则 0 违例，记录合并保留双方事件`)
    }
    const agentId = this.touchAgent(event, file, runId, seq)
    if (act.agent === UNKNOWN && agentId !== UNKNOWN) act.agent = agentId
    return act
  }

  private registerEntity(seed: EntitySeed): EntityRecord {
    const role =
      seed.kind === 'sosa_result' ? 'sosa_result' :
      seed.kind === 'analysis_input' ? 'analysis_input' :
      seed.kind === 'analysis_output' ? 'analysis_output' :
      seed.kind === 'observation_record' ? 'observation_record' :
      seed.kind === 'claim_record' ? 'claim_record' :
      seed.kind === 'note_record' ? 'note_record' :
      seed.kind === 'deck' ? 'deck' : 'artifact'
    const shaAlias = seed.sha256 !== null ? `sha256:${seed.sha256}` : null
    const pathAlias = seed.name !== null && seed.kind !== 'sosa_result' && seed.kind !== 'claim_record' && seed.kind !== 'note_record'
      ? `path:${seed.name}` : null
    const seqId = `ent:seq:${seed.file}#${seed.seq}`
    let id: string | null = null
    if (shaAlias !== null) id = this.entityAliases.get(shaAlias) ?? null
    if (id === null && pathAlias !== null) id = this.entityAliases.get(pathAlias) ?? null
    if (id === null) {
      if (seed.kind === 'sosa_result') id = `${seqId}:result`
      else if (seed.kind === 'claim_record' || seed.kind === 'note_record') id = `ent:${seed.kind}:${seed.file}#${seed.seq}`
      else if (shaAlias !== null) id = `ent:${shaAlias}`
      else if (pathAlias !== null) id = `ent:${pathAlias}`
      // 名称与哈希都不可解析 → 身份退到 (file, seq, kind)：kind 后缀保证同一事件
      // 的输入实体与输出实体不撞 id；未知身份仍是显式可定位的记录，不是伪造。
      else id = `${seqId}:${seed.kind}`
    }
    let entity = this.entities.get(id)
    if (!entity) {
      entity = {
        id,
        entity_type: PROV_ENTITY,
        sosa_role: seed.kind === 'sosa_result' ? SOSA_RESULT : null,
        roles: [role],
        name: seed.name ?? UNKNOWN,
        sha256: seed.sha256,
        content_sha256_claimed: seed.claimed ?? null,
        channel: strOf(seed.event.channel),
        metric: seed.metric ?? null,
        unit: seed.unit ?? null,
        value: seed.value ?? null,
        statement: seed.statement ?? null,
        based_on_refs: seed.basedOn ?? [],
        run_id: seed.runId,
        source_ref: this.sourceRefOf(seed.file, seed.runId, seed.seq),
        also_seen_in: [],
        unknowns: sortUnique(seed.unknown ?? []),
      }
      this.entities.set(id, entity)
    } else {
      if (!entity.roles.includes(role)) entity.roles = sortUnique([...entity.roles, role])
      if (entity.name === UNKNOWN && seed.name !== null) entity.name = seed.name
      if (entity.sha256 === null) entity.sha256 = seed.sha256
      if (entity.content_sha256_claimed === null) entity.content_sha256_claimed = seed.claimed ?? null
      if (entity.metric === null && seed.metric !== undefined) entity.metric = seed.metric
      if (entity.unit === null && seed.unit !== undefined) entity.unit = seed.unit
      if (entity.value === null && seed.value !== undefined) entity.value = seed.value
      if (entity.statement === null && seed.statement != null) entity.statement = seed.statement
      if (entity.based_on_refs.length === 0 && (seed.basedOn ?? []).length > 0) entity.based_on_refs = seed.basedOn ?? []
      if (entity.run_id !== seed.runId) {
        const ref = this.sourceRefOf(seed.file, seed.runId, seed.seq)
        if (!entity.also_seen_in.some((r) => r.file === ref.file && r.run_id === ref.run_id && r.event_seq === ref.event_seq)) {
          entity.also_seen_in.push(ref)
        }
      }
      if (seed.unknown) entity.unknowns = sortUnique([...entity.unknowns, ...seed.unknown])
    }
    if (seed.kind === 'sosa_result') entity.sosa_role = SOSA_RESULT
    if (shaAlias !== null) this.entityAliases.set(shaAlias, id)
    if (pathAlias !== null) this.entityAliases.set(pathAlias, id)
    return entity
  }

  private lookupEntity(sha: string | null, path: string | null): string | null {
    if (sha !== null) {
      const hit = this.entityAliases.get(`sha256:${sha}`)
      if (hit !== undefined) return hit
    }
    if (path !== null) {
      const hit = this.entityAliases.get(`path:${path}`)
      if (hit !== undefined) return hit
    }
    return null
  }

  private addUsage(activityId: string, entityId: string, ref: SourceRef): void {
    const key = `u|${activityId}|${entityId}`
    if (!this.usage.has(key)) this.usage.set(key, { activity_id: activityId, entity_id: entityId, source_ref: ref })
  }

  private addGeneration(entityId: string, activityId: string, ref: SourceRef): void {
    const key = `g|${entityId}|${activityId}`
    if (!this.generation.has(key)) this.generation.set(key, { entity_id: entityId, activity_id: activityId, source_ref: ref })
  }

  /**
   * 仅数据派生（derivation）。from_entity_id 不可解析时写显式 UNKNOWN 记录而不是
   * 省略——「未知项保留为显式 UNKNOWN 字段而非省略」。
   */
  private addDerivation(derivedEntityId: string, fromEntityId: string | null, ref: SourceRef): void {
    const key = `d|${derivedEntityId}|${fromEntityId ?? UNKNOWN}`
    if (!this.derivation.has(key)) {
      this.derivation.set(key, { derived_entity_id: derivedEntityId, from_entity_id: fromEntityId ?? UNKNOWN, source_ref: ref })
    }
  }

  private deckOf(event: EnvelopeEvent): { name: string | null; sha: string | null } | null {
    const payload = event.payload
    const snap = event.snapshot_ref
    const snapIsDeck = isPlainObject(snap) && snap['kind'] === 'deck'
    const name = strOf(payload['deck']) ?? strOf(payload['deck_path']) ?? (snapIsDeck ? strOf(snap['id']) : null)
    const deckSha = hexOf(payload['deck_content_sha256_claimed'])
    const snapSha = snapIsDeck ? hexOf(snap['content_sha256']) : null
    const sha = deckSha ?? snapSha
    if (name === null && sha === null) return null
    return { name: name ?? UNKNOWN, sha }
  }

  // —— 事件分派（按 (file, seq) 序调用）——————————————————————————————

  handle(event: EnvelopeEvent, file: string): void {
    const runId = strOf(event.run_id) ?? UNKNOWN
    const seq = Number.isInteger(event.event_seq) ? event.event_seq : -1
    const ref = this.sourceRefOf(file, runId, seq)
    const payload = isPlainObject(event.payload) ? event.payload : {}
    const runAct = this.upsertRunActivity(event, file, runId, seq)
    const unknowns = event.unknowns.map((u) => String(u))

    switch (event.kind) {
      case 'run.started': {
        runAct.started_at = strOf(event.occurred_at) ?? UNKNOWN
        const deck = this.deckOf(event)
        if (deck !== null) {
          const deckEntity = this.registerEntity({ kind: 'deck', name: deck.name, sha256: deck.sha, event, file, runId, seq })
          this.addUsage(runAct.id, deckEntity.id, ref)
        }
        return
      }
      case 'run.finished': {
        runAct.status = 'FINISHED'
        runAct.ended_at = strOf(event.occurred_at) ?? UNKNOWN
        runAct.exit_code = isFiniteNumber(payload['exit_code']) ? payload['exit_code'] : UNKNOWN
        return
      }
      case 'run.failed': {
        // 失败 Run 保留而不伪造正常结果（Gate P1 文字项；W3C_ALIGNMENT §四
        // 「强制失败 Experiment 有结果 = 必须伪造 Observation/Result」冲突行）。
        runAct.status = 'FAILED'
        runAct.ended_at = strOf(event.occurred_at) ?? UNKNOWN
        runAct.exit_code = isFiniteNumber(payload['exit_code']) ? payload['exit_code'] : UNKNOWN
        return
      }
      case 'deck.executed': {
        // 仿真执行本身是 prov:Activity；wall_seconds/steps 等遥测是活动属性而非
        // sosa:Result——不给纯软件执行臆造传感语义（文件头 SOSA 例外纪律）。
        const agentId = this.touchAgent(event, file, runId, seq)
        const act: MutableActivity = {
          id: `act:deck_exec:${file}#${seq}`,
          activity_kind: 'deck_execution',
          prov_type: PROV_ACTIVITY,
          dsh_subtype: null,
          sosa: null,
          run_id: runId,
          file,
          source_ref: ref,
          agent: agentId,
          started_at: strOf(event.occurred_at) ?? UNKNOWN,
          ended_at: UNKNOWN,
          status: 'NOT_RECORDED',
          exit_code: isFiniteNumber(payload['exit_code']) ? payload['exit_code'] : UNKNOWN,
          sosa_result: null,
          observed_entity_id: UNKNOWN,
          derived_from_event_seq: UNKNOWN,
          unknowns: [...unknowns],
        }
        this.activities.set(act.id, act)
        const deck = this.deckOf(event)
        if (deck !== null) {
          const deckEntity = this.registerEntity({ kind: 'deck', name: deck.name, sha256: deck.sha, event, file, runId, seq })
          this.addUsage(act.id, deckEntity.id, ref)
        } else {
          act.unknowns.push('deck 输入不可从 snapshot_ref/payload 解析，deck 实体记 UNKNOWN（不伪造）')
        }
        return
      }
      case 'artifact.registered': {
        const name = strOf(payload['path']) ?? strOf(payload['file']) ?? strOf(payload['uri']) ?? strOf(payload['artifact_id'])
        const sha = hexOf(payload['sha256']) ?? hexOf(payload['content_hash'])
        const claimed = typeof payload['sha256'] === 'string' && sha === null ? String(payload['sha256']) : null
        const entity = this.registerEntity({
          kind: 'artifact',
          name,
          sha256: sha,
          event,
          file,
          runId,
          seq,
          claimed,
          unknown: name === null ? ['artifact 名称不可解析，name 记 UNKNOWN（不伪造）'] : [],
        })
        if (payload['partial'] === true) entity.unknowns = sortUnique([...entity.unknowns, '登记时声明 partial=true：部分产物，有效性未核验'])
        if (claimed !== null) entity.unknowns = sortUnique([...entity.unknowns, 'payload 携带 sha256 声明但非 64 位小写 hex，仅保留为 content_sha256_claimed，不当作内容哈希'])
        this.addGeneration(entity.id, runAct.id, ref)
        this.lastArtifactByRun.set(runId, entity.id)
        return
      }
      case 'analysis.performed': {
        // ── SOSA 例外纪律第 1 条：纯分析脚本只产 prov 派生，绝不配 SOSA ──
        const agentId = this.touchAgent(event, file, runId, seq)
        const act: MutableActivity = {
          id: `act:analysis:${file}#${seq}`,
          activity_kind: 'analysis',
          prov_type: PROV_ACTIVITY,
          dsh_subtype: 'dsh:Analysis',
          sosa: null, // ← 若此行被改成非 null，prov.test.ts 的 SOSA 负例立即红
          run_id: runId,
          file,
          source_ref: ref,
          agent: agentId,
          started_at: strOf(event.occurred_at) ?? UNKNOWN,
          ended_at: UNKNOWN,
          status: 'NOT_RECORDED',
          exit_code: UNKNOWN,
          sosa_result: null,
          observed_entity_id: UNKNOWN,
          derived_from_event_seq: Number.isInteger(payload['reanalysis_of_event_seq']) ? (payload['reanalysis_of_event_seq'] as number) : UNKNOWN,
          unknowns: [...unknowns],
        }
        this.activities.set(act.id, act)

        const inputName = strOf(payload['input']) ?? strOf(payload['input_path']) ?? strOf(payload['input_file'])
        const inputSha = hexOf(payload['input_content_sha256']) ?? hexOf(payload['input_sha256'])
        const resolvedInput = this.lookupEntity(inputSha, inputName)
        const inputEntity = this.registerEntity({
          kind: 'analysis_input',
          // 输入不可解析时不给名字臆造身份：registerEntity 会退到 (file,seq) 确定性 id。
          name: inputName,
          sha256: inputSha,
          event,
          file,
          runId,
          seq,
          unknown: inputName === null && inputSha === null ? ['分析输入数据不可解析，输入实体记 UNKNOWN（不伪造）'] : [],
        })
        if (resolvedInput !== null && resolvedInput !== inputEntity.id) {
          act.unknowns.push(`分析输入别名解析冲突（${resolvedInput} vs ${inputEntity.id}），保留两条不静默合并`)
        }
        this.addUsage(act.id, resolvedInput ?? inputEntity.id, ref)

        const snap = event.snapshot_ref
        const snapIsFile = isPlainObject(snap) && snap['kind'] === 'file'
        const outputName = strOf(payload['output']) ?? strOf(payload['output_path']) ?? (snapIsFile ? strOf(snap['id']) : null)
        const outputSha = hexOf(payload['output_content_sha256']) ?? (snapIsFile && outputName !== null ? hexOf(snap['content_sha256']) : null)
        const outputEntity = this.registerEntity({
          kind: 'analysis_output',
          name: outputName,
          sha256: outputSha,
          event,
          file,
          runId,
          seq,
          metric: payload['metric'] ?? null,
          unit: payload['unit'] ?? null,
          value: isFiniteNumber(payload['value']) ? payload['value'] : null,
          unknown: outputName === null
            ? ['分析结果为数值量，未落独立文件实体（CORE_SEMANTICS §1.1「简单数值不必强制先变成独立的文件 Artifact」），身份由 (file, event_seq) 确定性给出']
            : [],
        })
        this.addGeneration(outputEntity.id, act.id, ref)
        // 数据派生边：输出 wasDerivedFrom 输入（W3C_ALIGNMENT §三「DERIVED_FROM
        // 分拆」的数据侧；逻辑推理依据 based_on 绝不走这条边）。
        this.addDerivation(outputEntity.id, resolvedInput ?? inputEntity.id, ref)
        return
      }
      case 'observation.recorded': {
        const agentId = this.touchAgent(event, file, runId, seq)
        const value = payload['value']
        const metric = strOf(payload['metric']) ?? UNKNOWN
        const subjectFromPayload = strOf(payload['input']) ?? strOf(payload['path']) ?? strOf(payload['artifact_path'])
        const subjectId = this.lookupEntity(hexOf(payload['input_content_sha256']) ?? hexOf(payload['sha256']), subjectFromPayload)
          ?? this.lastArtifactByRun.get(runId) ?? null
        const act: MutableActivity = {
          id: `act:obs:${file}#${seq}`,
          activity_kind: 'observation',
          prov_type: PROV_ACTIVITY,
          dsh_subtype: null,
          sosa: null,
          run_id: runId,
          file,
          source_ref: ref,
          agent: agentId,
          started_at: strOf(event.occurred_at) ?? UNKNOWN,
          ended_at: UNKNOWN,
          status: 'NOT_RECORDED',
          exit_code: UNKNOWN,
          sosa_result: null,
          observed_entity_id: subjectId ?? UNKNOWN,
          derived_from_event_seq: UNKNOWN,
          unknowns: [...unknowns],
        }
        this.activities.set(act.id, act)
        if (isFiniteNumber(value)) {
          // ── SOSA 唯一允许分支：deck 执行（仿真=测量类比）的单一数值观测 ──
          act.sosa = SOSA_OBSERVATION
          if (subjectId === null) act.unknowns.push('被观测数据不可解析，observed_entity_id 记 UNKNOWN（sosa:observedSubject 缺失显式保留）')
          const resultEntity = this.registerEntity({
            kind: 'sosa_result',
            name: null,
            sha256: null,
            event,
            file,
            runId,
            seq,
            metric,
            unit: payload['unit'] ?? UNKNOWN,
            value,
            unknown: metric === UNKNOWN ? ['sosa:observedProperty（metric）未知，显式保留'] : [],
          })
          act.sosa_result = {
            entity_id: resultEntity.id,
            observed_property: metric,
            has_simple_result: value,
            unit: payload['unit'] ?? UNKNOWN,
          }
          this.addGeneration(resultEntity.id, act.id, ref)
          if (subjectId !== null) this.addUsage(act.id, subjectId, ref)
        } else {
          // 非数值 / 复合观测（如 strk-04 跨 run quantities）：不配 SOSA，
          // 只登记为记录实体 + 显式 unknown（例外纪律第 2/3 条）。
          act.unknowns.push('观测记录非单一数值（复合/跨 run 或非数值载荷）：按 SOSA 例外纪律不建 sosa:Observation/sosa:Result，只作 prov 记录实体')
          const recordEntity = this.registerEntity({
            kind: 'observation_record',
            name: null,
            sha256: hexOf(event.snapshot_ref?.['content_sha256'] as unknown),
            event,
            file,
            runId,
            seq,
            metric: payload['metric'] ?? payload['quantities'] ?? null,
            unit: payload['unit'] ?? null,
            value: null,
          })
          this.addGeneration(recordEntity.id, act.id, ref)
          if (subjectId !== null) this.addUsage(act.id, subjectId, ref)
        }
        return
      }
      case 'claim.candidate':
      case 'note.unknown': {
        // claim/note 是「被提出的对象」的记录实体（W3C_ALIGNMENT：dsh:Assertion
        // 作为被提出对象保存，不自动成为事实三元组）；based_on 保留在记录上，
        // 不进 derivation（文件头「派生 ≠ 证明」注释块）。
        const isClaim = event.kind === 'claim.candidate'
        const entity = this.registerEntity({
          kind: isClaim ? 'claim_record' : 'note_record',
          name: null,
          sha256: null,
          event,
          file,
          runId,
          seq,
          statement: strOf(payload['statement']) ?? strOf(payload['claim']) ?? strOf(payload['topic']) ?? strOf(payload['challenge']) ?? null,
          basedOn: basedOnRefsOf(payload, runId),
          unknown: [
            isClaim
              ? 'claim.candidate 是被提出的命题记录，不是已确认事实（epistemic 状态由 P3 Argument/Assessment 处理）'
              : 'note.unknown 是缺口/质疑登记记录实体',
            ...(Array.isArray(payload['based_on']) && payload['based_on'].length > 0
              ? ['payload.based_on 为逻辑推理依据，保留在 based_on_refs，不投影为 prov:wasDerivedFrom（数据派生≠科学证明）']
              : []),
          ],
        })
        this.addGeneration(entity.id, runAct.id, ref)
        return
      }
      default: {
        this.unmapped.push({ file, run_id: runId, event_seq: seq, kind: String(event.kind) })
        return
      }
    }
  }

  // —— 收尾：run 生命周期缺口 + 输出装配（供 projectEvents 调用）———————————
  finish(): Projection {
    for (const act of this.activities.values()) {
      if (act.activity_kind !== 'run') continue
      if (act.started_at === UNKNOWN) act.unknowns.push('run_started_missing：源里没有 run.started 事件，started_at 记 UNKNOWN（不补全）')
      if (act.status === 'RUNNING') act.unknowns.push('无 run.finished/run.failed 事件：执行状态停留在 RUNNING（不伪造终态）')
      act.unknowns = sortUnique(act.unknowns)
    }
    for (const entity of this.entities.values()) {
      entity.also_seen_in.sort((a, b) => cmpStrings(`${a.file}#${a.event_seq}`, `${b.file}#${b.event_seq}`))
    }
    return {
      projection_version: PROV_PROJECTION_VERSION,
      files: [...this.fileNames].sort(cmpStrings),
      activities: Array.from(this.activities.values()).sort((a, b) => cmpStrings(a.id, b.id)),
      entities: Array.from(this.entities.values()).sort((a, b) => cmpStrings(a.id, b.id)),
      agents: Array.from(this.agents.values()).sort((a, b) => cmpStrings(a.id, b.id)),
      usage: Array.from(this.usage.values()).sort((a, b) => cmpStrings(`${a.activity_id}|${a.entity_id}`, `${b.activity_id}|${b.entity_id}`)),
      generation: Array.from(this.generation.values()).sort((a, b) => cmpStrings(`${a.entity_id}|${a.activity_id}`, `${b.entity_id}|${b.activity_id}`)),
      derivation: Array.from(this.derivation.values()).sort((a, b) => cmpStrings(`${a.derived_entity_id}|${a.from_entity_id}`, `${b.derived_entity_id}|${b.from_entity_id}`)),
      unmapped_events: this.unmapped.sort((a, b) => cmpStrings(`${a.file}#${a.event_seq}`, `${b.file}#${b.event_seq}`)),
    }
  }
}

/**
 * 纯函数投影入口。inputs = 每个信封文件（file 为定位用路径字符串，写进所有
 * source_ref）+ 其事件序列。文件顺序无关（内部排序），事件按 event_seq 排。
 * 同一输入两次调用 → JSON.stringify 逐字节相同。
 */
export function projectEvents(inputs: readonly ProjectionInput[]): Projection {
  const sorted = [...inputs].sort((a, b) => cmpStrings(a.file, b.file))
  const builder = new ProjectionBuilder(sorted.map((i) => i.file))
  for (const input of sorted) {
    const ordered = [...input.events].sort((a, b) => (Number.isInteger(a.event_seq) ? a.event_seq : -1) - (Number.isInteger(b.event_seq) ? b.event_seq : -1))
    for (const event of ordered) builder.handle(event, input.file)
  }
  return builder.finish()
}

/** 便捷计数：poc-run --project 与测试共用，避免各处重复 filter。 */
export function countSosaObservations(projection: Projection): number {
  return projection.activities.filter((a) => a.sosa === SOSA_OBSERVATION).length
}

export function countSosaResults(projection: Projection): number {
  return projection.entities.filter((e) => e.sosa_role === SOSA_RESULT).length
}
