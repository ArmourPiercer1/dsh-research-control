/**
 * @vitest-environment jsdom
 *
 * UI-7 D4 — the Records face (D §13.5/§13.6, wireframe §13.2/§24/§25):
 * the page-body `[Workspace]` / `[Records]` toggle, the 7-dimension
 * filter row, the record LIST + DETAIL, the Add Record flow (type
 * first, then the minimal fields), and the detail actions (Add
 * relation / Retract claim / Mark artifact missing / Remove relation)
 * — the REAL `WorkstreamView` mounted against the REAL store
 * (`createResearchStore`) with the stub RPC facade.
 *
 * R-13 is pinned here: the Records face issues `queryRecords` ONLY —
 * ZERO `queryHistory` calls anywhere in the face (the History timeline
 * is forbidden as a Records source, D §13.4: the list reads the
 * operational `derived_state` projection, never the timeline).
 *
 * Refetch accounting (UI-7 registry rules): an OK workstream-scoped
 * write (recordFact / recordClaim / registerArtifact — the result
 * carries the workstreamId) invalidates `workstreams:<ws>` +
 * `records:<ws>`; an OK object-scoped write (retractClaim /
 * markArtifactMissing / addRelation / removeRelation — the owner is
 * derived server-side) invalidates the CACHED `workstreams:*` +
 * `records:*` listing. In this single-workstream test bench both
 * resolve to getWorkstream +1 and queryRecords +1. A business fault
 * (ok:false) rejects before the invalidation pass — ZERO refetch.
 *
 * The React Flow canvas is mocked at the component layer (the page
 * mounts the PlanGraphContainer — the mock registers `@xyflow/react`
 * before the module graph loads it).
 */

import '../graph/xyflow-mock.js'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { PlaneIntegrityDto, QueryRecordsResult } from '../../src/shared/rpc-contracts.js'
import { QueryRecordsResultSchema } from '../../src/shared/rpc-contracts.js'
import { createResearchStore, type ResearchStore } from '../../src/client/stores/index.js'
import {
  INTEGRITY_CODE_TREE_PARTIAL,
  ProjectReadonlyProvider,
} from '../../src/client/components/readonly-context.js'
import { WorkstreamView } from '../../src/client/views/workstream/index.js'
import { makeStubRpc, type StubRpc } from '../stores/stub-rpc.js'
import { makeSnapshot } from './view-fixtures.js'

afterEach(cleanup)

/** One fixed epoch (the provenance line renders its ISO form). */
const T = 1_700_000_000_000

/** The Records fixture — one of each type, the C-1 claim carrying the
 *  mechanical conflict flag (CONTRADICTED_BY edge REL-2 exists) and
 *  both edge directions (REL-1 in for F-1, out for C-1). */
const RECORDS: QueryRecordsResult = {
  total: 3,
  records: [
    {
      id: 'F-1',
      type: 'FACT',
      workstreamId: 'WS-1',
      statement: 'Alpha: model converged at epoch 12',
      status: 'ACTIVE',
      recordedAt: T,
      createdBy: { kind: 'USER', label: 'seed' },
      references: ['T-1'],
      relations: [
        {
          relationId: 'REL-1',
          relationType: 'SUPPORTED_BY',
          direction: 'in',
          other: { kind: 'CLAIM', id: 'C-1' },
        },
      ],
    },
    {
      id: 'C-1',
      type: 'CLAIM',
      workstreamId: 'WS-1',
      statement: 'Alpha is better than beta',
      status: 'ACTIVE',
      recordedAt: T,
      createdBy: { kind: 'AGENT', label: 'seed' },
      references: [],
      relations: [
        {
          relationId: 'REL-1',
          relationType: 'SUPPORTED_BY',
          direction: 'out',
          other: { kind: 'FACT', id: 'F-1' },
        },
        {
          relationId: 'REL-2',
          relationType: 'CONTRADICTED_BY',
          direction: 'out',
          other: { kind: 'CLAIM', id: 'C-2' },
        },
      ],
      conflictFlag: { kind: 'PENDING_REVIEW', relationIds: ['REL-2'] },
    },
    {
      id: 'A-1',
      type: 'ARTIFACT',
      workstreamId: 'WS-1',
      title: 'Alpha model v1',
      artifactType: 'MODEL',
      uri: 'file:///alpha/model.bin',
      status: 'REGISTERED',
      recordedAt: T,
      references: [],
      relations: [],
    },
  ],
}

interface Page {
  readonly stub: StubRpc
  readonly store: ResearchStore
  readonly container: HTMLElement
}

/** Cold-mount the page (the production shape — no preload): the page's
 *  lazy hooks fire on mount; the test settles until every slice the
 *  workspace tab needs is ready. `records` configures the queryRecords
 *  outcome (default stub: an empty list). `integrity` wraps the view in
 *  a `ProjectReadonlyProvider` (ADJ-11 readonly gating — the review F1
 *  pin); default `undefined` = no provider = the writable bench. */
async function mountPage(records?: unknown, integrity?: PlaneIntegrityDto): Promise<Page> {
  const stub = makeStubRpc()
  stub.set('getWorkstream', { ok: true, value: makeSnapshot() })
  if (records !== undefined) {
    stub.set('queryRecords', records)
  }
  const store = createResearchStore({ rpc: stub.rpc })
  const view = <WorkstreamView store={store} workstreamId="WS-1" />
  const { container } =
    integrity === undefined
      ? render(view)
      : render(
          <ProjectReadonlyProvider integrity={integrity}>{view}</ProjectReadonlyProvider>,
        )
  await waitFor(() => {
    expect(store.getState().workstreams.get('WS-1')?.status).toBe('ready')
    expect(store.getState().current.get('WS-1')?.status).toBe('ready')
    expect(store.getState().currentFocus.get('WS-1')?.status).toBe('ready')
  })
  return { stub, store, container }
}

function query(page: Page, selector: string): HTMLElement {
  const el = page.container.querySelector(selector)
  if (el === null) throw new Error(`missing ${selector}`)
  return el as HTMLElement
}

function queryAll(page: Page, selector: string): HTMLElement[] {
  return [...page.container.querySelectorAll(selector)] as HTMLElement[]
}

/** Flip to the Records tab and settle on the slice ready. */
async function openRecords(page: Page): Promise<void> {
  fireEvent.click(query(page, '[data-ws-tab="records"]'))
  await waitFor(() => {
    expect(page.store.getState().records.get('WS-1')?.status).toBe('ready')
  })
}

describe('UI-7 Records face — the page-body toggle (B §13.2/§24)', () => {
  it('视图夹具 wire-valid：RECORDS 通过严格 QueryRecordsResultSchema 解码', () => {
    expect(() => QueryRecordsResultSchema.parse(RECORDS)).not.toThrow()
    expect(RECORDS.total).toBe(3)
  })

  it('默认 [Workspace] tab：两个 tab 可见，Records 面未挂载', async () => {
    const page = await mountPage()
    const wsTab = query(page, '[data-ws-tab="workspace"]')
    const recTab = query(page, '[data-ws-tab="records"]')
    expect(wsTab.getAttribute('aria-selected')).toBe('true')
    expect(recTab.getAttribute('aria-selected')).toBe('false')
    expect(wsTab.textContent).toBe('[Workspace]')
    expect(recTab.textContent).toBe('[Records]')
    // the Records face is absent until the tab is flipped
    expect(page.container.querySelector('[data-records-section]')).toBeNull()
    // R-13 baseline: the workspace tab never touches the Records read
    expect(page.stub.countOf('queryRecords')).toBe(0)
    expect(page.stub.countOf('queryHistory')).toBe(0)
  })

  it('[Records] tab：ADJ-5 通知 + 列表 + 状态 + 空详情（R-13：只 queryRecords）', async () => {
    const page = await mountPage({ ok: true, value: RECORDS })
    await openRecords(page)

    // the face is mounted with the continuous ADJ-5 by-reference notice
    expect(query(page, '[data-records-section]')).not.toBeNull()
    expect(query(page, '[data-records-artifact-notice]').textContent).toBe(
      'Artifact is registered by reference; Research Control does not copy/store the file.',
    )

    // the list: one item per record, type/id/status + statement|title
    expect(query(page, '[data-records-list-panel] h3').textContent).toBe('Records · 3')
    const items = queryAll(page, '[data-records-item]')
    expect(items).toHaveLength(3)
    expect(queryAll(page, '[data-record-id="F-1"]')).toHaveLength(1)
    expect(queryAll(page, '[data-record-id="C-1"]')).toHaveLength(1)
    expect(queryAll(page, '[data-record-id="A-1"]')).toHaveLength(1)
    expect(query(page, '[data-record-id="F-1"] [data-record-status]').textContent).toBe('ACTIVE')
    expect(query(page, '[data-record-id="A-1"] [data-record-status]').textContent).toBe('REGISTERED')
    expect(query(page, '[data-record-id="F-1"]').textContent).toContain(
      'Alpha: model converged at epoch 12',
    )
    expect(query(page, '[data-record-id="A-1"]').textContent).toContain('Alpha model v1')

    // nothing selected → the detail empty state
    expect(query(page, '[data-records-detail-empty]').textContent).toBe(
      'Select a record to inspect it.',
    )

    // R-13: the whole face ran queryRecords ONCE (the lazy load) and
    // ZERO queryHistory — the timeline is not a Records source.
    expect(page.stub.countOf('queryRecords')).toBe(1)
    expect(page.stub.countOf('queryHistory')).toBe(0)
  })

  it('空列表：total=0 → 冻结空态（B §33.2）+ 3 个 create CTA', async () => {
    const page = await mountPage({ ok: true, value: { records: [], total: 0 } })
    await openRecords(page)
    expect(query(page, '[data-records-list-panel] h3').textContent).toBe('Records · 0')
    const empty = query(page, '[data-records-empty]')
    expect(empty.textContent).toContain('No research records yet.')
    expect(query(page, '[data-records-add-fact]')).not.toBeNull()
    expect(query(page, '[data-records-add-claim]')).not.toBeNull()
    expect(query(page, '[data-records-add-artifact]')).not.toBeNull()
  })

  it('空列表：total>0 过滤空态保留旧文案（D4 偏差 i）', async () => {
    const page = await mountPage({ ok: true, value: { records: [], total: 2 } })
    await openRecords(page)
    expect(query(page, '[data-records-empty]').textContent).toBe(
      'No records match the current filters',
    )
  })

  it('冻结空态 CTA：点击 Add Fact → add 表单以 FACT 打开', async () => {
    const page = await mountPage({ ok: true, value: { records: [], total: 0 } })
    await openRecords(page)
    fireEvent.click(query(page, '[data-records-add-fact]'))
    expect(query(page, '[data-records-add-form][data-records-add-kind="FACT"]')).not.toBeNull()
  })

  it('load 失败：error 态 + 重试按钮（无列表渲染）', async () => {
    const page = await mountPage({
      ok: false,
      error: { code: 'WS_NOT_FOUND', message: 'no such workstream' },
    })
    fireEvent.click(query(page, '[data-ws-tab="records"]'))
    await waitFor(() => {
      expect(page.store.getState().records.get('WS-1')?.status).toBe('error')
    })
    expect(query(page, '[data-records-error]').textContent).toContain('Records failed to load')
    expect(query(page, '[data-records-error]').textContent).toContain('no such workstream')
    expect(query(page, '[aria-label="retry"]')).not.toBeNull()
    expect(page.container.querySelector('[data-records-list]')).toBeNull()
  })
})

describe('UI-7 Records face — the detail (wireframe §24.1)', () => {
  it('选择 CLAIM：statement + 冲突标记 + provenance + 双向关系 + 动作门控', async () => {
    const page = await mountPage({ ok: true, value: RECORDS })
    await openRecords(page)
    fireEvent.click(query(page, '[data-record-select="C-1"]'))

    const detail = query(page, '[data-records-detail]')
    expect(detail.querySelector('h3')?.textContent).toBe('CLAIM C-1 · ACTIVE')
    expect(query(page, '[data-records-statement]').textContent).toBe('Alpha is better than beta')

    // the mechanical conflict flag (REL-2 = the ACTIVE CONTRADICTED_BY edge)
    const conflict = query(page, '[data-records-conflict]')
    expect(conflict.textContent).toContain('Conflict: pending review')
    expect(conflict.textContent).toContain('REL-2')

    // provenance: the actor label + the ISO recordedAt
    const provenance = query(page, '[data-records-provenance]')
    expect(provenance.textContent).toContain('seed')
    expect(provenance.textContent).toContain(new Date(T).toISOString())

    // relations: both edges, direction-prefixed, each with a Remove button
    const rels = query(page, '[data-records-relations]').textContent
    expect(rels).toContain('→ SUPPORTED_BY FACT:F-1 (REL-1)')
    expect(rels).toContain('→ CONTRADICTED_BY CLAIM:C-2 (REL-2)')
    expect(queryAll(page, '[data-records-remove-relation]')).toHaveLength(2)

    // action gating: an ACTIVE claim offers Retract, never Mark missing
    expect(query(page, '[data-records-retract]')).not.toBeNull()
    expect(page.container.querySelector('[data-records-mark-missing]')).toBeNull()

    // the selection is pinned on the list item
    expect(query(page, '[data-record-select="C-1"]').getAttribute('aria-pressed')).toBe('true')
  })

  it('选择 FACT：IN 方向的反向边（←）+ 无动作区', async () => {
    const page = await mountPage({ ok: true, value: RECORDS })
    await openRecords(page)
    fireEvent.click(query(page, '[data-record-select="F-1"]'))

    const rels = query(page, '[data-records-relations]').textContent
    expect(rels).toContain('← SUPPORTED_BY CLAIM:C-1 (REL-1)')
    // a fact has no retract / mark-missing actions
    expect(page.container.querySelector('[data-records-retract]')).toBeNull()
    expect(page.container.querySelector('[data-records-mark-missing]')).toBeNull()
    expect(page.container.querySelector('[data-records-actions]')).toBeNull()
    // the Add-relation block is always present (source = the record)
    expect(query(page, '[data-records-add-relation]')).not.toBeNull()
  })

  it('选择 ARTIFACT：title/type + uri + by-reference provenance + Mark missing', async () => {
    const page = await mountPage({ ok: true, value: RECORDS })
    await openRecords(page)
    fireEvent.click(query(page, '[data-record-select="A-1"]'))

    expect(query(page, '[data-records-title]').textContent).toBe('Alpha model v1 · MODEL')
    expect(query(page, '[data-records-uri]').textContent).toBe('file:///alpha/model.bin')
    // the frozen ArtifactRow has no created_by — the provenance says so
    expect(query(page, '[data-records-provenance]').textContent).toContain(
      'registered by reference',
    )
    expect(query(page, '[data-records-mark-missing]')).not.toBeNull()
    expect(page.container.querySelector('[data-records-retract]')).toBeNull()
  })
})

describe('UI-7 Records face — the Add Record flow (wireframe §25)', () => {
  it('Fact：空 statement 本地 fault（零 RPC）；OK 写入 → wire args + refetch + 表单收起', async () => {
    const after = {
      total: 4,
      records: [
        {
          id: 'F-2',
          type: 'FACT',
          workstreamId: 'WS-1',
          statement: 'The ablation confirms the metric gain',
          status: 'ACTIVE',
          recordedAt: T + 1000,
          createdBy: { kind: 'USER' },
          references: ['T-1', 'note:baseline'],
          relations: [],
        },
        ...RECORDS.records,
      ],
    }
    const page = await mountPage([
      { ok: true, value: RECORDS },
      { ok: true, value: after },
    ])
    await openRecords(page)

    fireEvent.click(query(page, '[data-records-add]'))
    const form = query(page, '[data-records-add-form]')
    expect(form.getAttribute('data-records-add-kind')).toBe('FACT')

    // empty statement → the local validation fault, ZERO RPC
    fireEvent.click(query(page, '[data-records-add-save]'))
    expect(query(page, '[data-records-add-fault]').textContent).toContain(
      'The statement cannot be empty',
    )
    expect(page.stub.countOf('recordFact')).toBe(0)

    fireEvent.change(query(page, '[data-records-statement]'), {
      target: { value: 'The ablation confirms the metric gain' },
    })
    fireEvent.change(query(page, '[data-records-references]'), {
      target: { value: 'T-1\nnote:baseline' },
    })
    fireEvent.click(query(page, '[data-records-add-save]'))

    await waitFor(() => expect(page.stub.countOf('recordFact')).toBe(1))
    expect(page.stub.callsTo('recordFact')[0].args).toEqual({
      workstreamId: 'WS-1',
      statement: 'The ablation confirms the metric gain',
      references: ['T-1', 'note:baseline'],
    })

    // OK → the registry refetches workstreams:WS-1 + records:WS-1; the
    // refetched list shows the new record and the form is closed.
    await waitFor(() => expect(page.stub.countOf('queryRecords')).toBe(2))
    expect(page.stub.countOf('getWorkstream')).toBe(2)
    expect(page.container.querySelector('[data-records-add-form]')).toBeNull()
    expect(query(page, '[data-records-list]').textContent).toContain(
      'The ablation confirms the metric gain',
    )
  })

  it('Artifact：类型切换 + 必填校验 + wire args（可选字段空则省略；id/createdByRun 不在契约内）', async () => {
    const page = await mountPage({ ok: true, value: RECORDS })
    await openRecords(page)

    fireEvent.click(query(page, '[data-records-add]'))
    fireEvent.click(query(page, '[data-records-add-select="ARTIFACT"]'))
    const form = query(page, '[data-records-add-form]')
    expect(form.getAttribute('data-records-add-kind')).toBe('ARTIFACT')
    expect(query(page, '[data-records-artifact-title]')).not.toBeNull()
    // the references field is fact/claim-only
    expect(form.querySelector('[data-records-references]')).toBeNull()

    // empty title → the local validation fault, ZERO RPC
    fireEvent.click(query(page, '[data-records-add-save]'))
    expect(query(page, '[data-records-add-fault]').textContent).toContain(
      'The title cannot be empty',
    )
    expect(page.stub.countOf('registerArtifact')).toBe(0)

    fireEvent.change(query(page, '[data-records-artifact-title]'), {
      target: { value: 'Alpha model v2' },
    })
    fireEvent.change(query(page, '[data-records-artifact-type]'), {
      target: { value: 'MODEL' },
    })
    fireEvent.change(query(page, '[data-records-artifact-uri]'), {
      target: { value: 'file:///alpha/model-v2.bin' },
    })
    fireEvent.click(query(page, '[data-records-add-save]'))

    await waitFor(() => expect(page.stub.countOf('registerArtifact')).toBe(1))
    const args = page.stub.callsTo('registerArtifact')[0].args as Record<string, unknown>
    expect(args).toEqual({
      workstreamId: 'WS-1',
      type: 'MODEL',
      title: 'Alpha model v2',
      uri: 'file:///alpha/model-v2.bin',
    })
    // ADJ-12: id / created_by_run are NOT wire parameters
    expect('id' in args).toBe(false)
    expect('createdByRun' in args).toBe(false)
    expect('contentHash' in args).toBe(false)

    // OK → refetch (the form closed)
    await waitFor(() => expect(page.stub.countOf('queryRecords')).toBe(2))
    expect(page.container.querySelector('[data-records-add-form]')).toBeNull()
  })
})

describe('UI-7 Records face — the filter row (B §24.1: one re-issue per change)', () => {
  it('Search / Type / Related-to / Time 各自重发 queryRecords（wire args 逐项）', async () => {
    const page = await mountPage({ ok: true, value: RECORDS })
    await openRecords(page)
    expect(page.stub.countOf('queryRecords')).toBe(1)

    // search → keyword (case preserved — the host lowercases)
    fireEvent.change(query(page, '[data-records-search]'), { target: { value: 'alpha' } })
    await waitFor(() => expect(page.stub.countOf('queryRecords')).toBe(2))
    expect(page.stub.callsTo('queryRecords').at(-1)?.args).toEqual({
      workstreamId: 'WS-1',
      keyword: 'alpha',
    })

    // type → the enum value
    fireEvent.change(query(page, '[data-records-filter-type]'), { target: { value: 'FACT' } })
    await waitFor(() => expect(page.stub.countOf('queryRecords')).toBe(3))
    expect(page.stub.callsTo('queryRecords').at(-1)?.args).toEqual({
      workstreamId: 'WS-1',
      keyword: 'alpha',
      type: 'FACT',
    })

    // related-to: `KIND:ID` deep-link carrier (B §26)
    fireEvent.change(query(page, '[data-records-filter-related]'), {
      target: { value: 'TASK:T-1' },
    })
    await waitFor(() => expect(page.stub.countOf('queryRecords')).toBe(4))
    expect(page.stub.callsTo('queryRecords').at(-1)?.args).toEqual({
      workstreamId: 'WS-1',
      keyword: 'alpha',
      type: 'FACT',
      relatedObject: { kind: 'TASK', id: 'T-1' },
    })

    // time-from → the datetime-local value as an epoch (local time)
    fireEvent.change(query(page, '[data-records-filter-time-from]'), {
      target: { value: '2023-11-14T22:13' },
    })
    await waitFor(() => expect(page.stub.countOf('queryRecords')).toBe(5))
    expect(page.stub.callsTo('queryRecords').at(-1)?.args).toEqual({
      workstreamId: 'WS-1',
      keyword: 'alpha',
      type: 'FACT',
      relatedObject: { kind: 'TASK', id: 'T-1' },
      timeFrom: new Date('2023-11-14T22:13').getTime(),
    })
  })
})

describe('UI-7 Records face — the detail actions (D §13.8 gate)', () => {
  it('Retract claim：reason 可选 + OK → wire args + refetch', async () => {
    const page = await mountPage({ ok: true, value: RECORDS })
    await openRecords(page)
    fireEvent.click(query(page, '[data-record-select="C-1"]'))

    fireEvent.change(query(page, '[data-records-action-reason]'), {
      target: { value: 'overclaimed' },
    })
    fireEvent.click(query(page, '[data-records-retract]'))

    await waitFor(() => expect(page.stub.countOf('retractClaim')).toBe(1))
    expect(page.stub.callsTo('retractClaim')[0].args).toEqual({
      claimId: 'C-1',
      reason: 'overclaimed',
    })
    // OK (object-scoped) → the cached workstreams:* + records:* refetch
    await waitFor(() => expect(page.stub.countOf('queryRecords')).toBe(2))
    expect(page.stub.countOf('getWorkstream')).toBe(2)
  })

  it('Retract 业务 fault：Action failed 注记 + 零 refetch', async () => {
    const page = await mountPage({ ok: true, value: RECORDS })
    page.stub.set('retractClaim', {
      ok: false,
      error: { code: 'WRONG_STATE', message: 'the claim is not ACTIVE' },
    })
    await openRecords(page)
    fireEvent.click(query(page, '[data-record-select="C-1"]'))
    fireEvent.click(query(page, '[data-records-retract]'))

    await waitFor(() => expect(page.stub.countOf('retractClaim')).toBe(1))
    expect(query(page, '[data-records-action-fault]').textContent).toBe(
      'Action failed：the claim is not ACTIVE',
    )
    // ok:false rejects before the invalidation pass — nothing refetches
    expect(page.stub.countOf('queryRecords')).toBe(1)
    expect(page.stub.countOf('getWorkstream')).toBe(1)
  })

  it('Mark artifact missing：无 reason → 省略字段', async () => {
    const page = await mountPage({ ok: true, value: RECORDS })
    await openRecords(page)
    fireEvent.click(query(page, '[data-record-select="A-1"]'))
    fireEvent.click(query(page, '[data-records-mark-missing]'))

    await waitFor(() => expect(page.stub.countOf('markArtifactMissing')).toBe(1))
    expect(page.stub.callsTo('markArtifactMissing')[0].args).toEqual({ artifactId: 'A-1' })
    await waitFor(() => expect(page.stub.countOf('queryRecords')).toBe(2))
  })

  it('Add relation：target 空 → submit 禁用；OK → wire args + refetch', async () => {
    const page = await mountPage({ ok: true, value: RECORDS })
    await openRecords(page)
    fireEvent.click(query(page, '[data-record-select="F-1"]'))

    const submit = query(page, '[data-records-add-relation-submit]') as HTMLButtonElement
    expect(submit.disabled).toBe(true)

    fireEvent.change(query(page, '[data-records-relation-type]'), {
      target: { value: 'SUPPORTED_BY' },
    })
    fireEvent.change(query(page, '[data-records-relation-target-id]'), {
      target: { value: 'C-1' },
    })
    expect((query(page, '[data-records-add-relation-submit]') as HTMLButtonElement).disabled).toBe(
      false,
    )
    fireEvent.click(query(page, '[data-records-add-relation-submit]'))

    await waitFor(() => expect(page.stub.countOf('addRelation')).toBe(1))
    expect(page.stub.callsTo('addRelation')[0].args).toEqual({
      source: { kind: 'FACT', id: 'F-1' },
      relationType: 'SUPPORTED_BY',
      target: { kind: 'CLAIM', id: 'C-1' },
    })
    await waitFor(() => expect(page.stub.countOf('queryRecords')).toBe(2))
    expect(page.stub.countOf('getWorkstream')).toBe(2)
  })

  it('Remove relation：per-edge 按钮 → wire args（reason 省略）', async () => {
    const page = await mountPage({ ok: true, value: RECORDS })
    await openRecords(page)
    fireEvent.click(query(page, '[data-record-select="F-1"]'))
    fireEvent.click(query(page, '[data-records-remove-relation="REL-1"]'))

    await waitFor(() => expect(page.stub.countOf('removeRelation')).toBe(1))
    expect(page.stub.callsTo('removeRelation')[0].args).toEqual({ relationId: 'REL-1' })
    await waitFor(() => expect(page.stub.countOf('queryRecords')).toBe(2))
  })
})

describe('UI-7 Records face — B §26 deep link (the related pre-filter from the History entry)', () => {
  it('lands on the Records tab with the related input pre-filled and the FIRST query carrying relatedObject', async () => {
    // The HOST is the filtering authority — the stub serves what the
    // filtered query would return (C-1, the only record related to F-1).
    const filtered: QueryRecordsResult = {
      total: 1,
      records: [RECORDS.records.find(r => r.id === 'C-1')!],
    }
    const stub = makeStubRpc()
    stub.set('getWorkstream', { ok: true, value: makeSnapshot() })
    stub.set('queryRecords', { ok: true, value: filtered })
    const store = createResearchStore({ rpc: stub.rpc })
    const { container } = render(
      <WorkstreamView store={store} workstreamId="WS-1" initialRecordsRelated="FACT:F-1" />,
    )

    // The page body (tabs included) renders once the workstream slice is ready.
    await waitFor(() => {
      expect(store.getState().workstreams.get('WS-1')?.status).toBe('ready')
    })

    // The deep link IS the view state: the Records tab is selected at
    // arrival (the Workspace tab is not).
    expect((container.querySelector('[data-ws-tab="records"]') as HTMLElement).getAttribute('aria-selected')).toBe('true')
    expect((container.querySelector('[data-ws-tab="workspace"]') as HTMLElement).getAttribute('aria-selected')).toBe(
      'false',
    )

    // The LAZY first load itself carries the filter — exactly ONE call
    // (a separate bare load + filtered re-issue would race through the
    // store's in-flight dedupe and one of the arg sets would be lost).
    await waitFor(() => {
      expect(stub.countOf('queryRecords')).toBe(1)
    })
    expect(stub.callsTo('queryRecords')[0].args).toEqual({
      workstreamId: 'WS-1',
      relatedObject: { kind: 'FACT', id: 'F-1' },
    })

    // The filter row shows the deep-linked value.
    expect((container.querySelector('[data-records-filter-related]') as HTMLInputElement).value).toBe(
      'FACT:F-1',
    )

    // The list reflects the filtered projection (the host's authority).
    await waitFor(() => {
      expect(store.getState().records.get('WS-1')?.status).toBe('ready')
    })
    const items = [...container.querySelectorAll('[data-record-id]')]
    expect(items).toHaveLength(1)
    expect((items[0] as HTMLElement).dataset.recordId).toBe('C-1')
  })

  it('no deep link: the legacy first load stays bare (no related dimension)', async () => {
    const page = await mountPage({ ok: true, value: RECORDS })
    await openRecords(page)
    expect((query(page, '[data-records-filter-related]') as HTMLInputElement).value).toBe('')
    const calls = page.stub.callsTo('queryRecords')
    expect(calls.length).toBeGreaterThanOrEqual(1)
    expect(calls[0].args).toEqual({ workstreamId: 'WS-1' })
  })
})

/**
 * ADJ-11 (UI-9, review F1 pin): the Records face readonly gating. The
 * D4 empty-face suite above pins the FROZEN face (writable bench); this
 * suite pins the gating itself — under a `ProjectReadonlyProvider`
 * with a readonly integrity (TREE_PARTIAL), every mutation entry point
 * is disabled with the composed reason title while browsing (filter
 * row + row selection → detail) stays fully enabled.
 */
describe('ADJ-11 readonly gating (review F1 pin — Records face)', () => {
  const REASON = 'the research tree is partially broken'
  const READONLY: PlaneIntegrityDto = {
    readOnly: true,
    checkCodes: [INTEGRITY_CODE_TREE_PARTIAL],
  }

  it('readonly: the add trigger is disabled with the reason title; filters and selection stay enabled', async () => {
    const page = await mountPage({ ok: true, value: RECORDS }, READONLY)
    await openRecords(page)
    const trigger = query(page, '[data-records-add]') as HTMLButtonElement
    expect(trigger.disabled).toBe(true)
    expect(trigger.title).toBe(REASON)
    // the browse row is NOT gated (ADJ-11: browsing remains available)
    for (const sel of ['[data-records-search]', '[data-records-filter-type]', '[data-records-filter-status]']) {
      expect((query(page, sel) as HTMLInputElement).disabled).toBe(false)
    }
    // selection stays enabled: clicking a row populates the detail zone
    expect(page.container.querySelector('[data-records-add-form]')).toBeNull()
    fireEvent.click(query(page, '[data-record-select="F-1"]'))
    expect(query(page, '[data-records-detail] [data-records-statement]').textContent).toBe(
      'Alpha: model converged at epoch 12',
    )
    expect(page.container.querySelector('[data-records-detail-empty]')).toBeNull()
  })

  it('readonly: the frozen empty-face CTAs are disabled with the reason title (the form is unreachable)', async () => {
    const page = await mountPage(undefined, READONLY)
    await openRecords(page)
    expect(query(page, '[data-records-empty]')).not.toBeNull()
    for (const sel of ['[data-records-add-fact]', '[data-records-add-claim]', '[data-records-add-artifact]']) {
      const cta = query(page, sel) as HTMLButtonElement
      expect(cta.disabled).toBe(true)
      expect(cta.title).toBe(REASON)
    }
    // every mutation entry point is gated → the add form cannot open
    expect(page.container.querySelector('[data-records-add-form]')).toBeNull()
  })

  it('writable default (no provider): trigger, kind selects, statement and save are enabled without titles', async () => {
    const page = await mountPage({ ok: true, value: RECORDS })
    await openRecords(page)
    const trigger = query(page, '[data-records-add]') as HTMLButtonElement
    expect(trigger.disabled).toBe(false)
    expect(trigger.hasAttribute('title')).toBe(false)
    fireEvent.click(trigger)
    expect(query(page, '[data-records-add-form][data-records-add-kind="FACT"]')).not.toBeNull()
    for (const sel of [
      '[data-records-add-select="FACT"]',
      '[data-records-add-select="CLAIM"]',
      '[data-records-add-select="ARTIFACT"]',
    ]) {
      const btn = query(page, sel) as HTMLButtonElement
      expect(btn.disabled).toBe(false)
      expect(btn.hasAttribute('title')).toBe(false)
    }
    const statement = query(page, '[data-records-add-form] [data-records-statement]') as HTMLTextAreaElement
    expect(statement.disabled).toBe(false)
    expect(statement.hasAttribute('title')).toBe(false)
    const save = query(page, '[data-records-add-save]') as HTMLButtonElement
    expect(save.disabled).toBe(false)
    expect(save.hasAttribute('title')).toBe(false)
  })
})
