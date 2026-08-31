/**
 * Workstream Records face (V2-UI-0.4 UI-7, D §13.5/§13.6).
 *
 * The second workstream workspace behind the page-body
 * `[Workspace] [Records]` toggle (B §24/§25, wireframe §13.2 — the
 * Records face never leaves the Workstream context):
 *
 *  - the record LIST + DETAIL (wireframe §24.1: filters / list / detail /
 *    Add Record) — the list is the `records:<ws>` slice (queryRecords —
 *    R-13: the Records list has ZERO queryHistory dependency);
 *  - the 7 filter dimensions as one row (Search / Type / Status / Time
 *    from–to / Related-to) — each change re-issues
 *    `store.loadRecords` with the active args (the store re-fetches the
 *    same key; only in-flight fetches dedupe);
 *  - the Add Record flow (wireframe §25: choose the type first —
 *    [Fact] / [Claim] / [Artifact] — then the minimal fields);
 *  - the detail actions (D §13.8 gate: Add relation / Retract claim /
 *    Mark artifact missing / Remove relation) — the arbitrary-UPDATE
 *    faces are deliberately absent (D §13.3: no edit face in the DTOs);
 *  - the ADJ-5 / §13.6 by-reference notice — shown CONTINUOUSLY while
 *    the Records face is open.
 *
 * All mutations run the three-line store idiom (okValue → registry
 * refetch — zero optimistic updates); the in-flight/fault faces are
 * local UI state only. The component owns its view state (filters,
 * selection, forms) — the deep link IS the view state (the related-to
 * filter carries the B §26 context entry, e.g. `TASK:T-12`).
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactElement,
} from 'react'
import type {
  QueryRecordsArgs,
  RegisterArtifactArgs,
  SemanticEndpointRef,
  SemanticRecordDto,
} from '../../../shared/rpc-contracts.js'
import { t } from '../../i18n/copy.js'
import type { ResearchStore } from '../../stores/index.js'
import { splitLines } from './plan-item-utils.js'
import { useRecordsSlice } from './useWorkstreamSlice.js'
import styles from './workstream.module.css'

/** The frozen 3 record types (the wire `type` filter + the Add menu). */
const RECORD_TYPES = ['FACT', 'CLAIM', 'ARTIFACT'] as const

/** The 4 derived status values (the wire `status` filter — any string
 *  is legal on the wire; these are the only values the writes emit). */
const RECORD_STATUSES = ['ACTIVE', 'RETRACTED', 'REGISTERED', 'MISSING'] as const

/** The frozen 7 artifact types. */
const ARTIFACT_TYPES = ['DATASET', 'FIGURE', 'MODEL', 'CODE', 'REPORT', 'NOTE', 'OTHER'] as const

/** The frozen 10 relation types. */
const RELATION_TYPES = [
  'DEPENDS_ON',
  'SUPPORTED_BY',
  'CONTRADICTED_BY',
  'DERIVED_FROM',
  'PRODUCED_BY',
  'VALIDATED_BY',
  'CONSUMES',
  'CONTRIBUTES_TO',
  'IMPLEMENTS',
  'RELATED_TO',
] as const

/** The 7 semantic endpoint kinds (the relation target selector). */
const ENDPOINT_KINDS = ['WORKSTREAM', 'TASK', 'GATE', 'MILESTONE', 'CLAIM', 'FACT', 'ARTIFACT'] as const

/** The relation-form kind the target selector defaults to. */
type RecordKind = (typeof RECORD_TYPES)[number]

/** The filter state (view state — the deep link `Records?related=…`
 *  lands here, B §26). */
interface FilterState {
  readonly search: string
  readonly type: string
  readonly status: string
  readonly timeFrom: string
  readonly timeTo: string
  /** The related-to text (`KIND:ID` or a bare id — bare ⇒ FACT). */
  readonly related: string
}

const EMPTY_FILTERS: FilterState = {
  search: '',
  type: '',
  status: '',
  timeFrom: '',
  timeTo: '',
  related: '',
}

/** `KIND:ID` (split on the FIRST colon) or a bare id (⇒ FACT). */
function parseRelated(text: string): SemanticEndpointRef | null {
  const v = text.trim()
  if (v === '') return null
  const at = v.indexOf(':')
  if (at > 0) {
    const kind = v.slice(0, at).trim()
    const id = v.slice(at + 1).trim()
    // The wire kind is the frozen endpoint-kind union; a mistyped text is
    // rejected host-side (OBJECT_NOT_FOUND after id reservation, §1.1 gap).
    if (kind !== '' && id !== '') return { kind: kind as SemanticEndpointRef['kind'], id }
    return null
  }
  return { kind: 'FACT', id: v }
}

/** The QueryRecords args from one filter state (empty fields omitted —
 *  the host applies a dimension only when the arg is present). */
function buildArgs(
  workstreamId: string,
  f: FilterState,
): QueryRecordsArgs & { workstreamId: string } {
  const keyword = f.search.trim()
  const timeFrom = f.timeFrom === '' ? null : new Date(f.timeFrom).getTime()
  const timeTo = f.timeTo === '' ? null : new Date(f.timeTo).getTime()
  const related = parseRelated(f.related)
  return {
    workstreamId,
    ...(keyword !== '' ? { keyword } : {}),
    ...(f.type !== '' ? { type: f.type as QueryRecordsArgs['type'] } : {}),
    ...(f.status !== '' ? { status: f.status } : {}),
    ...(timeFrom !== null && !Number.isNaN(timeFrom) ? { timeFrom } : {}),
    ...(timeTo !== null && !Number.isNaN(timeTo) ? { timeTo } : {}),
    ...(related !== null ? { relatedObject: related } : {}),
  }
}

/** The ISO display form for the provenance line (local, zero deps). */
function formatTs(ms: number): string {
  return new Date(ms).toISOString()
}

/** The selected record's endpoint ref (the Add-relation source). */
function refOf(r: SemanticRecordDto): SemanticEndpointRef {
  return { kind: r.type, id: r.id }
}

export interface RecordsSectionProps {
  readonly store: ResearchStore
  readonly workstreamId: string
  /** UI-7 (B §26): deep link — the related-to filter pre-set on mount
   *  (`KIND:ID`, e.g. from the History timeline's 「Related Records (n)」
   *  entry). The Records tab lands already filtered to that object. */
  readonly initialRelated?: string
}

/**
 * Render the Records face (filters + list + detail + Add Record).
 * @param props - store + the page workstream (the slice local key + the
 *   write scope).
 * @returns the Records section element.
 */
export function RecordsSection({ store, workstreamId, initialRelated }: RecordsSectionProps): ReactElement {
  // UI-7 (B §26): deep link — the LAZY first load carries the pre-set
  // related filter (a separate filtered issue after the bare lazy load
  // would join its in-flight fetch and be swallowed by the dedupe).
  const initialArgs = useMemo<QueryRecordsArgs | undefined>(() => {
    if (initialRelated === undefined || initialRelated === '') return undefined
    return buildArgs(workstreamId, { ...EMPTY_FILTERS, related: initialRelated })
  }, [workstreamId, initialRelated])
  const slice = useRecordsSlice(store, workstreamId, initialArgs)

  /* -- filter view state (every change re-issues the same slice key) -- */
  const [filters, setFilters] = useState<FilterState>(() =>
    initialRelated !== undefined && initialRelated !== ''
      ? { ...EMPTY_FILTERS, related: initialRelated }
      : EMPTY_FILTERS,
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)

  function issue(f: FilterState): void {
    void store.loadRecords(buildArgs(workstreamId, f))
  }

  // UI-7 (B §26): deep-link landing on an ALREADY-LOADED slice (the
  // History page's related-entry lazy-loaded the BARE slice before the
  // navigation) — the hook's idle-guard won't re-issue, so re-query with
  // the related filter ONCE on mount. The idle/loading cases are owned
  // by the hook's initialArgs; the StrictMode double-run is guarded.
  const didDeepLinkIssue = useRef(false)
  useEffect(() => {
    if (didDeepLinkIssue.current) return
    didDeepLinkIssue.current = true
    if (filters.related.trim() === '') return
    if (slice === undefined || slice.status === 'idle' || slice.status === 'loading') return
    issue(filters)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function onFilterChange(patch: Partial<FilterState>): void {
    const next = { ...filters, ...patch }
    setFilters(next)
    issue(next)
  }

  /* -- Add Record (wireframe §25: choose the type first) -- */
  const [addKind, setAddKind] = useState<RecordKind | null>(null)
  const [addStatement, setAddStatement] = useState('')
  const [addReferences, setAddReferences] = useState('')
  const [addTitle, setAddTitle] = useState('')
  const [addArtifactType, setAddArtifactType] = useState<string>(ARTIFACT_TYPES[0]!)
  const [addUri, setAddUri] = useState('')
  const [addContentHash, setAddContentHash] = useState('')
  const [addRelatedTaskId, setAddRelatedTaskId] = useState('')
  const [addSupersedes, setAddSupersedes] = useState('')
  const [addPending, setAddPending] = useState(false)
  const [addFault, setAddFault] = useState<string | null>(null)

  function resetAddForm(): void {
    setAddKind(null)
    setAddStatement('')
    setAddReferences('')
    setAddTitle('')
    setAddArtifactType(ARTIFACT_TYPES[0]!)
    setAddUri('')
    setAddContentHash('')
    setAddRelatedTaskId('')
    setAddSupersedes('')
    setAddPending(false)
  }

  function openAdd(kind: RecordKind): void {
    setAddFault(null)
    setAddKind(kind)
  }

  function handleAddSubmit(): void {
    if (addKind === null) return
    setAddFault(null)
    const references = splitLines(addReferences)
    if (addKind === 'ARTIFACT') {
      if (addTitle.trim() === '') {
        setAddFault(t('ws.records.add.titleRequired'))
        return
      }
      if (addUri.trim() === '') {
        setAddFault(t('ws.records.add.uriRequired'))
        return
      }
      setAddPending(true)
      const hash = addContentHash.trim()
      const task = addRelatedTaskId.trim()
      const supersedes = addSupersedes.trim()
      const args: RegisterArtifactArgs = {
        workstreamId,
        type: addArtifactType as RegisterArtifactArgs['type'],
        title: addTitle.trim(),
        uri: addUri.trim(),
        ...(hash !== '' ? { contentHash: hash } : {}),
        ...(task !== '' ? { relatedTaskId: task } : {}),
        ...(supersedes !== '' ? { supersedes } : {}),
      }
      void store
        .registerArtifact(args)
        .then(() => resetAddForm())
        .catch((err: unknown) => {
          setAddPending(false)
          setAddFault(err instanceof Error ? err.message : String(err))
        })
      return
    }
    if (addStatement.trim() === '') {
      setAddFault(t('ws.records.add.statementRequired'))
      return
    }
    setAddPending(true)
    const args = {
      workstreamId,
      statement: addStatement.trim(),
      ...(references.length > 0 ? { references } : {}),
    }
    const run = addKind === 'FACT' ? store.recordFact(args) : store.recordClaim(args)
    void run
      .then(() => resetAddForm())
      .catch((err: unknown) => {
        setAddPending(false)
        setAddFault(err instanceof Error ? err.message : String(err))
      })
  }

  /* -- detail actions (D §13.8) -- */
  const [actionReason, setActionReason] = useState('')
  const [actionPending, setActionPending] = useState(false)
  const [actionFault, setActionFault] = useState<string | null>(null)
  const [relType, setRelType] = useState<string>(RELATION_TYPES[0]!)
  const [relTargetKind, setRelTargetKind] = useState<string>(ENDPOINT_KINDS[4]!)
  const [relTargetId, setRelTargetId] = useState('')

  function runAction(promise: Promise<unknown>, clearTargetId: boolean): void {
    setActionFault(null)
    setActionPending(true)
    setActionReason('')
    if (clearTargetId) setRelTargetId('')
    void promise
      .then(() => undefined)
      .catch((err: unknown) => {
        setActionFault(err instanceof Error ? err.message : String(err))
      })
      .finally(() => setActionPending(false))
  }

  const records: SemanticRecordDto[] = slice.data?.records ?? []
  const selected = selectedId === null ? null : records.find((r) => r.id === selectedId) ?? null

  /* -- the slice face (R-13: queryRecords ONLY — never queryHistory) -- */
  if (slice.data === null) {
    if (slice.status === 'error') {
      return (
        <section className={styles.recordsSection} data-records-section>
          <p className={styles.faultNote} data-records-error>
            {t('ws.records.list.error')}：{slice.error ?? 'unknown'}
          </p>
          <button
            type="button"
            className={styles.recordsRetry}
            aria-label="retry"
            onClick={() => issue(filters)}
          >
            重试
          </button>
        </section>
      )
    }
    return (
      <section className={styles.recordsSection} data-records-section>
        <p className={styles.recordsLoading} data-records-loading>
          {t('ws.records.list.loading')}
        </p>
      </section>
    )
  }

  return (
    <section className={styles.recordsSection} data-records-section>
      <div className={styles.recordsHeader}>
        <h2 className={styles.zoneTitle}>{t('ws.records.title')}</h2>
        <button
          type="button"
          className={styles.recordsAdd}
          data-records-add
          aria-label={t('ws.records.add')}
          onClick={() => openAdd('FACT')}
        >
          {t('ws.records.add')}
        </button>
      </div>

      {/* ADJ-5 / §13.6 — the by-reference notice, continuous. */}
      <p className={styles.recordsNotice} data-records-artifact-notice>
        {t('ws.records.artifact.referenceNotice')}
      </p>

      {/* -- Add Record (wireframe §25: type first, then the fields) -- */}
      {addKind !== null && (
        <div className={styles.addForm} data-records-add-form data-records-add-kind={addKind}>
          <p className={styles.sectionTitle}>{t('ws.records.add.title')}</p>
          <div className={styles.addKinds}>
            {RECORD_TYPES.map((kind) => (
              <button
                key={kind}
                type="button"
                className={styles.addKindButton}
                data-records-add-select={kind}
                aria-pressed={addKind === kind}
                onClick={() => openAdd(kind)}
              >
                {kind === 'FACT'
                  ? t('ws.records.add.kind.fact')
                  : kind === 'CLAIM'
                    ? t('ws.records.add.kind.claim')
                    : t('ws.records.add.kind.artifact')}
              </button>
            ))}
          </div>
          {addKind !== 'ARTIFACT' ? (
            <label className={styles.addField}>
              {t('ws.records.add.statement')}
              <textarea
                className={styles.addInput}
                data-records-statement
                value={addStatement}
                rows={2}
                onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setAddStatement(e.target.value)}
              />
            </label>
          ) : (
            <>
              <label className={styles.addField}>
                {t('ws.records.add.titleField')}
                <input
                  className={styles.addInput}
                  data-records-artifact-title
                  value={addTitle}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setAddTitle(e.target.value)}
                />
              </label>
              <label className={styles.addField}>
                {t('ws.records.add.artifactType')}
                <select
                  className={styles.addInput}
                  data-records-artifact-type
                  value={addArtifactType}
                  onChange={(e: ChangeEvent<HTMLSelectElement>) => setAddArtifactType(e.target.value)}
                >
                  {ARTIFACT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.addField}>
                {t('ws.records.add.uri')}
                <input
                  className={styles.addInput}
                  data-records-artifact-uri
                  value={addUri}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setAddUri(e.target.value)}
                />
              </label>
              <label className={styles.addField}>
                {t('ws.records.add.contentHash')}
                <input
                  className={styles.addInput}
                  data-records-artifact-hash
                  value={addContentHash}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setAddContentHash(e.target.value)}
                />
              </label>
              <label className={styles.addField}>
                {t('ws.records.add.relatedTask')}
                <input
                  className={styles.addInput}
                  data-records-artifact-task
                  value={addRelatedTaskId}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setAddRelatedTaskId(e.target.value)}
                />
              </label>
              <label className={styles.addField}>
                {t('ws.records.add.supersedes')}
                <input
                  className={styles.addInput}
                  data-records-artifact-supersedes
                  value={addSupersedes}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setAddSupersedes(e.target.value)}
                />
              </label>
            </>
          )}
          {addKind !== 'ARTIFACT' && (
            <label className={styles.addField}>
              {t('ws.records.add.references')}
              <textarea
                className={styles.addInput}
                data-records-references
                value={addReferences}
                rows={2}
                onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setAddReferences(e.target.value)}
              />
            </label>
          )}
          {addFault !== null && (
            <p className={styles.faultNote} data-records-add-fault>
              {t('ws.records.add.fault')}：{addFault}
            </p>
          )}
          <div className={styles.addActions}>
            <button
              type="button"
              className={styles.addSave}
              data-records-add-save
              disabled={addPending}
              onClick={handleAddSubmit}
            >
              {t('ws.records.add.save')}
            </button>
            <button
              type="button"
              className={styles.addCancel}
              data-records-add-cancel
              disabled={addPending}
              onClick={resetAddForm}
            >
              {t('ws.records.add.cancel')}
            </button>
          </div>
        </div>
      )}

      {/* -- the filter row (B §24.1: Search / Type / Status / Time) -- */}
      <div className={styles.recordsFilters} data-records-filters>
        <label className={styles.filterField}>
          {t('ws.records.filter.search')}
          <input
            className={styles.filterInput}
            data-records-search
            value={filters.search}
            onChange={(e: ChangeEvent<HTMLInputElement>) => onFilterChange({ search: e.target.value })}
          />
        </label>
        <label className={styles.filterField}>
          {t('ws.records.filter.type')}
          <select
            className={styles.filterInput}
            data-records-filter-type
            value={filters.type}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => onFilterChange({ type: e.target.value })}
          >
            <option value="">{t('ws.records.filter.all')}</option>
            {RECORD_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.filterField}>
          {t('ws.records.filter.status')}
          <select
            className={styles.filterInput}
            data-records-filter-status
            value={filters.status}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => onFilterChange({ status: e.target.value })}
          >
            <option value="">{t('ws.records.filter.all')}</option>
            {RECORD_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.filterField}>
          {t('ws.records.filter.timeFrom')}
          <input
            className={styles.filterInput}
            type="datetime-local"
            data-records-filter-time-from
            value={filters.timeFrom}
            onChange={(e: ChangeEvent<HTMLInputElement>) => onFilterChange({ timeFrom: e.target.value })}
          />
        </label>
        <label className={styles.filterField}>
          {t('ws.records.filter.timeTo')}
          <input
            className={styles.filterInput}
            type="datetime-local"
            data-records-filter-time-to
            value={filters.timeTo}
            onChange={(e: ChangeEvent<HTMLInputElement>) => onFilterChange({ timeTo: e.target.value })}
          />
        </label>
        <label className={styles.filterField}>
          {t('ws.records.filter.related')}
          <input
            className={styles.filterInput}
            data-records-filter-related
            placeholder="KIND:ID"
            value={filters.related}
            onChange={(e: ChangeEvent<HTMLInputElement>) => onFilterChange({ related: e.target.value })}
          />
        </label>
      </div>

      {/* -- list | detail (wireframe §24.1) -- */}
      <div className={styles.recordsGrid}>
        <div className={styles.zone} data-records-list-panel>
          <h3 className={styles.sectionTitle}>
            {t('ws.records.title')} · {slice.data.total}
          </h3>
          {records.length === 0 ? (
            <p className={styles.recordsEmpty} data-records-empty>
              {t('ws.records.list.empty')}
            </p>
          ) : (
            <ul className={styles.list} data-records-list>
              {records.map((r) => (
                <li key={r.id} className={styles.recordItem} data-records-item data-record-id={r.id}>
                  <button
                    type="button"
                    className={styles.recordItemButton}
                    data-record-select={r.id}
                    aria-pressed={selectedId === r.id}
                    onClick={() => setSelectedId(selectedId === r.id ? null : r.id)}
                  >
                    <span className={styles.badge}>{r.type}</span>
                    <span className={styles.taskId}>{r.id}</span>
                    <span className={styles.recordStatus} data-record-status={r.status}>
                      {r.status}
                    </span>
                    <span className={styles.taskTitle}>{r.statement ?? r.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className={styles.zone} data-records-detail>
          {selected === null ? (
            <p className={styles.recordsEmpty} data-records-detail-empty>
              {t('ws.records.detail.select')}
            </p>
          ) : (
            <>
              <h3 className={styles.sectionTitle}>
                {selected.type} {selected.id} · {selected.status}
              </h3>
              {selected.statement !== undefined && (
                <p className={styles.recordStatement} data-records-statement>
                  {selected.statement}
                </p>
              )}
              {selected.title !== undefined && (
                <p className={styles.recordStatement} data-records-title>
                  {selected.title}
                  {selected.artifactType !== undefined ? ` · ${selected.artifactType}` : ''}
                </p>
              )}
              {selected.uri !== undefined && (
                <p className={styles.recordMeta} data-records-uri>
                  {selected.uri}
                </p>
              )}
              {selected.conflictFlag !== undefined && (
                <p className={styles.recordConflict} data-records-conflict>
                  {t('ws.records.conflict')}：{selected.conflictFlag.relationIds.join(', ')}
                </p>
              )}
              <div className={styles.detailBlock}>
                <h4 className={styles.sectionTitle}>{t('ws.records.detail.createdBy')}</h4>
                <p className={styles.recordMeta} data-records-provenance>
                  {selected.createdBy !== undefined
                    ? `${selected.createdBy.label ?? selected.createdBy.kind}`
                    : selected.createdBy === undefined
                      ? t('ws.records.detail.byReference')
                      : ''}
                  {' · '}
                  {formatTs(selected.recordedAt)}
                </p>
              </div>
              <div className={styles.detailBlock}>
                <h4 className={styles.sectionTitle}>{t('ws.records.detail.references')}</h4>
                {selected.references.length === 0 ? (
                  <p className={styles.recordMeta}>—</p>
                ) : (
                  <ul className={styles.list} data-records-references>
                    {selected.references.map((ref) => (
                      <li key={ref} className={styles.recordMeta}>
                        {ref}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className={styles.detailBlock}>
                <h4 className={styles.sectionTitle}>{t('ws.records.detail.relations')}</h4>
                {selected.relations.length === 0 ? (
                  <p className={styles.recordMeta}>—</p>
                ) : (
                  <ul className={styles.list} data-records-relations>
                    {selected.relations.map((edge) => (
                      <li key={edge.relationId} className={styles.recordMeta} data-records-edge={edge.relationId}>
                        {edge.direction === 'out' ? '→' : '←'} {edge.relationType} {edge.other.kind}:
                        {edge.other.id} ({edge.relationId})
                        <button
                          type="button"
                          className={styles.recordEdgeRemove}
                          data-records-remove-relation={edge.relationId}
                          disabled={actionPending}
                          onClick={() =>
                            runAction(
                              store.removeRelation({
                                relationId: edge.relationId,
                                ...(actionReason.trim() !== '' ? { reason: actionReason.trim() } : {}),
                              }),
                              false,
                            )
                          }
                        >
                          {t('ws.records.action.removeRelation')}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* -- the detail actions (D §13.8 gate) -- */}
              {(selected.type === 'CLAIM' || selected.type === 'ARTIFACT') && (
                <div className={styles.detailBlock} data-records-actions>
                  <label className={styles.addField}>
                    {selected.type === 'CLAIM'
                      ? t('ws.records.action.retract.reason')
                      : t('ws.records.action.markMissing.reason')}
                    <input
                      className={styles.addInput}
                      data-records-action-reason
                      value={actionReason}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => setActionReason(e.target.value)}
                    />
                  </label>
                  {selected.type === 'CLAIM' && selected.status === 'ACTIVE' && (
                    <button
                      type="button"
                      className={styles.recordAction}
                      data-records-retract
                      disabled={actionPending}
                      onClick={() =>
                        runAction(
                          store.retractClaim({
                            claimId: selected.id,
                            ...(actionReason.trim() !== '' ? { reason: actionReason.trim() } : {}),
                          }),
                          false,
                        )
                      }
                    >
                      {t('ws.records.action.retract')}
                    </button>
                  )}
                  {selected.type === 'ARTIFACT' && selected.status === 'REGISTERED' && (
                    <button
                      type="button"
                      className={styles.recordAction}
                      data-records-mark-missing
                      disabled={actionPending}
                      onClick={() =>
                        runAction(
                          store.markArtifactMissing({
                            artifactId: selected.id,
                            ...(actionReason.trim() !== '' ? { reason: actionReason.trim() } : {}),
                          }),
                          false,
                        )
                      }
                    >
                      {t('ws.records.action.markMissing')}
                    </button>
                  )}
                </div>
              )}
              <div className={styles.detailBlock} data-records-add-relation>
                <h4 className={styles.sectionTitle}>
                  {t('ws.records.action.addRelation')} · {t('ws.records.relation.source')}:{' '}
                  {refOf(selected).kind}:{selected.id}
                </h4>
                <div className={styles.addKinds}>
                  <label className={styles.filterField}>
                    {t('ws.records.relation.type')}
                    <select
                      className={styles.filterInput}
                      data-records-relation-type
                      value={relType}
                      onChange={(e: ChangeEvent<HTMLSelectElement>) => setRelType(e.target.value)}
                    >
                      {RELATION_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={styles.filterField}>
                    {t('ws.records.relation.targetKind')}
                    <select
                      className={styles.filterInput}
                      data-records-relation-target-kind
                      value={relTargetKind}
                      onChange={(e: ChangeEvent<HTMLSelectElement>) => setRelTargetKind(e.target.value)}
                    >
                      {ENDPOINT_KINDS.map((kind) => (
                        <option key={kind} value={kind}>
                          {kind}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={styles.filterField}>
                    {t('ws.records.relation.targetId')}
                    <input
                      className={styles.filterInput}
                      data-records-relation-target-id
                      value={relTargetId}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => setRelTargetId(e.target.value)}
                    />
                  </label>
                </div>
                <button
                  type="button"
                  className={styles.recordAction}
                  data-records-add-relation-submit
                  disabled={actionPending || relTargetId.trim() === ''}
                  onClick={() => {
                    const targetId = relTargetId.trim()
                    if (targetId === '') {
                      setActionFault(t('ws.records.relation.targetIdRequired'))
                      return
                    }
                    runAction(
                      store.addRelation({
                        source: refOf(selected),
                        relationType: relType as (typeof RELATION_TYPES)[number],
                        target: { kind: relTargetKind as SemanticEndpointRef['kind'], id: targetId },
                      }),
                      true,
                    )
                  }}
                >
                  {t('ws.records.action.addRelation')}
                </button>
              </div>
              {actionFault !== null && (
                <p className={styles.faultNote} data-records-action-fault>
                  {t('ws.records.action.fault')}：{actionFault}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  )
}
