import { useRef, useState } from 'react'
import { AiVote } from '../ai/AiUsage'
import { useResource, type Call } from '../../lib/api'
import { Badge, ErrorNote, Icon, Loading, displayName, formatDate, confirmAction } from '../../ui'

type Internship = { id: string; program_name: string; intern_name?: string | null; intern_email?: string | null }
type Evidence = { task_id: string; title: string; due_on: string; version: number | null; kind: keyof typeof labels }
type Metrics = { start: string; end: string; as_of: string; completed_tasks: number; versions_returned: number; overdue_tasks: number; evidence: Evidence[] }
type Finding = { statement: string; sources: Evidence[] }
type SavedReport = { id: string; internship_id: string; starts_on: string; ends_on: string; snapshot: Metrics; summary: string; findings?: Finding[]; shared_at: string | null }
type OpenTask = (internship: string, task: string, version?: number) => void

const labels = { completed: 'Completed', changes_requested: 'Changes requested', overdue: 'Overdue' }
const day = (value: Date) => new Date(value.getTime() - value.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
const span = (start: string, end: string) => `${formatDate(start)} – ${formatDate(end)}`

function thisWeek() {
  const monday = new Date()
  monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7)
  const sunday = new Date(monday)
  sunday.setDate(sunday.getDate() + 6)
  return { start: day(monday), end: day(sunday) }
}

function periodError(start: string, end: string) {
  if (!start || !end) return 'Choose a start and an end date.'
  if (end < start) return 'The end date must be on or after the start date.'
  if ((new Date(end).getTime() - new Date(start).getTime()) / 86400000 > 365) return 'Choose a period of up to 366 days.'
  return ''
}

function EvidenceLink({ item, internship, openTask }: { item: Evidence; internship: string; openTask: OpenTask }) {
  return <button className="row-link compact" type="button" onClick={() => openTask(internship, item.task_id, item.version ?? undefined)}>
    <span className="row-primary">
      <span className="row-title">{item.title}{item.version ? ` · version ${item.version}` : ''}</span>
      <span className="row-sub">{labels[item.kind]} · due {formatDate(item.due_on)}</span>
    </span>
    <Icon name="arrow" size={15} />
  </button>
}

function MetricsStrip({ metrics, frozen }: { metrics: Metrics; frozen: boolean }) {
  return <div className="stack" style={{ gap: 'var(--s-2)' }}>
    <div className="stat-strip">
      <div className="stat-cell"><strong>{metrics.completed_tasks}</strong><span>Tasks completed</span></div>
      <div className="stat-cell"><strong>{metrics.versions_returned}</strong><span>Versions returned for changes</span></div>
      <div className="stat-cell"><strong>{metrics.overdue_tasks}</strong><span>Open tasks past their deadline</span></div>
    </div>
    <p className="fine">{frozen ? `Numbers frozen when the report was shared (deadlines checked ${formatDate(metrics.as_of)}).` : `Live numbers, deadlines checked ${formatDate(metrics.as_of)}. Saving the draft stores them with the report.`}</p>
  </div>
}

function Findings({ findings, internship, openTask, stale }: { findings: Finding[]; internship: string; openTask: OpenTask; stale?: boolean }) {
  if (!findings.length) return null
  return <div className="stack" style={{ gap: 'var(--s-3)' }}>
    <p className="label">Sources for the summary{stale ? ' · the text was edited after these were generated' : ''}</p>
    {findings.map((finding, index) => <article key={index} className="assist-block">
      <p>{finding.statement}</p>
      <div className="grid gap-2">{finding.sources.map((item, i) => <EvidenceLink key={i} item={item} internship={internship} openTask={openTask} />)}</div>
    </article>)}
  </div>
}

/** A shared report, exactly as it was when shared: summary, sources and frozen numbers. */
function SharedReport({ report, openTask }: { report: SavedReport; openTask: OpenTask }) {
  return <details className="plan-card report-card">
    <summary className="plan-card-head">
      <div><h3>{span(report.starts_on, report.ends_on)}</h3><p className="row-sub">Shared {formatDate(report.shared_at!)}</p></div>
      <Badge tone="success">Shared</Badge>
    </summary>
    <div className="stack" style={{ marginTop: 'var(--s-4)' }}>
      <MetricsStrip metrics={report.snapshot} frozen />
      <p className="prose-text">{report.summary}</p>
      <Findings findings={report.findings ?? []} internship={report.internship_id} openTask={openTask} />
      {!report.findings?.length && report.snapshot.evidence.length > 0 && <div className="grid gap-2">
        <p className="label">Evidence</p>
        {report.snapshot.evidence.map((item, i) => <EvidenceLink key={i} item={item} internship={report.internship_id} openTask={openTask} />)}
      </div>}
    </div>
  </details>
}

function Editor({ call, base, internship, period, existing, openTask, refresh }: {
  call: Call; base: string; internship: string; period: { start: string; end: string }; existing?: SavedReport
  openTask: OpenTask; refresh: () => void
}) {
  const query = '?' + new URLSearchParams(period)
  const live = useResource<Metrics>(call, existing?.shared_at ? null : `${base}/${internship}/progress${query}`)
  const [findings, setFindings] = useState<Finding[]>(existing?.findings ?? [])
  const [generatedText, setGeneratedText] = useState<string | null>(existing?.findings?.length ? existing.summary : null)
  const [text, setText] = useState(existing?.summary ?? '')
  const [usage, setUsage] = useState<string>()
  const [busy, setBusy] = useState<'' | 'generating' | 'saving' | 'sharing'>('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const running = useRef(false)

  if (existing?.shared_at) return <section className="panel">
    <div className="notice"><Icon name="check" /><span>This period was shared with the intern on {formatDate(existing.shared_at)} and can’t be changed. Choose another period for a new report.</span></div>
    <SharedReport report={existing} openTask={openTask} />
  </section>
  if (live.error) return <ErrorNote message={live.error} onRetry={live.reload} />
  if (!live.data) return <section className="panel"><Loading rows={3} /></section>
  const metrics = live.data
  const edited = generatedText !== null && text !== generatedText

  async function run(kind: 'generating' | 'saving' | 'sharing', action: () => Promise<void>) {
    if (running.current) return
    running.current = true
    setBusy(kind)
    setError('')
    setMessage('')
    try { await action() }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Something went wrong. Your text is kept.') }
    finally { running.current = false; setBusy('') }
  }

  const generate = async () => {
    if (text.trim() && text !== generatedText && !await confirmAction('Replace your current summary with a new AI draft?')) return
    void run('generating', async () => {
      const result = await call<{ findings: Finding[]; ai_usage_id?: string }>(`${base}/${internship}/progress/summary${query}`, { method: 'POST' })
      const joined = result.findings.map(finding => finding.statement).join('\n\n')
      setFindings(result.findings)
      setGeneratedText(joined)
      setText(joined)
      setUsage(result.ai_usage_id)
      if (!result.findings.length) setMessage('No findings for this period. You can still write the summary yourself.')
    })
  }

  const save = async (share: boolean) => {
    if (share && !await confirmAction('Share this report with the intern? It can’t be edited afterwards.', 'Share report')) return
    void run(share ? 'sharing' : 'saving', async () => {
      await call(`${base}/${internship}/progress/report${query}`, { method: 'PUT', body: JSON.stringify({
        summary: text, share,
        findings: findings.map(finding => ({ statement: finding.statement, sources: finding.sources.map(s => ({ task_id: s.task_id, version: s.version, kind: s.kind })) })),
      }) })
      setMessage(share ? 'Shared with the intern. It now appears in their reports.' : 'Draft saved with today’s numbers and sources.')
      refresh()
      live.reload()
    })
  }

  return <div className="stack">
    <section className="panel">
      <header className="panel-head"><div><h2>Numbers for {span(period.start, period.end)}</h2>
        {existing && <p>Draft saved earlier for this period.</p>}</div></header>
      <MetricsStrip metrics={metrics} frozen={false} />
      <details className="more-options">
        <summary>Evidence ({metrics.evidence.length})</summary>
        <div className="grid gap-2" style={{ marginTop: 'var(--s-3)' }}>
          {metrics.evidence.length === 0 ? <p className="empty-line">No completed, returned or overdue work in this period.</p>
            : metrics.evidence.map((item, i) => <EvidenceLink key={i} item={item} internship={internship} openTask={openTask} />)}
        </div>
      </details>
    </section>

    <section className="panel">
      <header className="panel-head">
        <div><h2>Summary</h2><p>Write it yourself or start from an AI draft built only from the evidence above.</p></div>
        <button type="button" className="secondary" aria-disabled={!!busy || !metrics.evidence.length} disabled={!metrics.evidence.length}
          onClick={generate}>{busy === 'generating' ? <span className="btn-spinner dark" aria-hidden="true" /> : <Icon name="sparkle" size={16} />}
          {busy === 'generating' ? 'Generating summary…' : findings.length ? 'Generate again' : 'Generate summary'}</button>
      </header>
      <label className="sr-only" htmlFor="report-summary">Report summary</label>
      <textarea id="report-summary" rows={7} maxLength={6000} value={text} disabled={busy === 'generating'}
        onChange={event => setText(event.target.value)} placeholder="What went well, what was returned, and what comes next." />
      <Findings findings={findings} internship={internship} openTask={openTask} stale={edited} />
      <AiVote key={usage} call={call} org={base.split('/')[3]} id={usage} />
      {error && <ErrorNote message={error} />}
      {message && <p className="notice success-note" role="status"><Icon name="check" />{message}</p>}
      <div className="actions actions-end">
        <button type="button" className="secondary" disabled={!!busy} onClick={() => save(false)}>
          {busy === 'saving' && <span className="btn-spinner dark" aria-hidden="true" />}{busy === 'saving' ? 'Saving draft…' : 'Save draft'}</button>
        <button type="button" disabled={!!busy || !text.trim()} onClick={() => save(true)}>
          {busy === 'sharing' && <span className="btn-spinner" aria-hidden="true" />}{busy === 'sharing' ? 'Sharing…' : 'Share with intern'}</button>
      </div>
    </section>
  </div>
}

export function ProgressReports({ call, orgId, openTask, canEdit }: { call: Call; orgId: string; canEdit: boolean; openTask: OpenTask }) {
  const base = '/api/organizations/' + orgId + '/internships'
  const list = useResource<Internship[]>(call, base)
  const [id, setId] = useState('')
  const [period, setPeriod] = useState(thisWeek)
  const selected = list.data?.find(item => item.id === id)?.id ?? list.data?.[0]?.id
  const saved = useResource<SavedReport[]>(call, selected ? `${base}/${selected}/progress/reports` : null)
  const reports = saved.data?.filter(report => report.internship_id === selected) ?? []
  const invalid = periodError(period.start, period.end)
  const existing = reports.find(report => report.starts_on === period.start && report.ends_on === period.end)
  const visible = canEdit ? reports : reports.filter(report => report.shared_at)

  if (list.error) return <ErrorNote message={list.error} onRetry={list.reload} />
  if (!list.data) return <section className="panel"><Loading rows={3} /></section>
  if (list.data.length === 0) return <p className="empty-line">No internships available.</p>

  return <div className="stack">
    <section className="panel">
      <div className="form-grid two">
        <label>Internship<select value={selected} onChange={event => setId(event.target.value)}>
          {list.data.map(item => <option key={item.id} value={item.id}>{displayName(item.intern_name, item.intern_email)} · {item.program_name}</option>)}
        </select></label>
        {canEdit && <div className="date-pair">
          <label>Start<input type="date" value={period.start} onChange={event => setPeriod({ ...period, start: event.target.value })} /></label>
          <label>End<input type="date" value={period.end} onChange={event => setPeriod({ ...period, end: event.target.value })} /></label>
        </div>}
      </div>
      {canEdit && <div className="chip-row">
        <button type="button" className="chip" onClick={() => setPeriod(thisWeek())}>This week</button>
        <button type="button" className="chip" onClick={() => { const end = new Date(); const start = new Date(); start.setDate(end.getDate() - 13); setPeriod({ start: day(start), end: day(end) }) }}>Last 14 days</button>
      </div>}
      {canEdit && invalid && <p className="field-error">{invalid}</p>}
    </section>

    {canEdit && selected && !invalid && <Editor key={`${selected}:${period.start}:${period.end}:${existing?.id ?? 'new'}:${existing?.shared_at ?? ''}`}
      call={call} base={base} internship={selected} period={period} existing={existing} openTask={openTask} refresh={saved.reload} />}

    <section className="panel">
      <header className="panel-head"><div><h2>{canEdit ? 'Reports for this internship' : 'Reports shared with you'}</h2>
        {canEdit && <p>Drafts are visible only to mentors and admins. Open one to continue it.</p>}</div></header>
      {saved.error && <ErrorNote message={saved.error} onRetry={saved.reload} />}
      {!saved.data && !saved.error && <Loading rows={2} />}
      {saved.data && visible.length === 0 && <p className="empty-line">{canEdit ? 'No reports yet.' : 'Your mentor hasn’t shared a report yet.'}</p>}
      <div className="grid gap-3">{visible.map(report => report.shared_at
        ? <SharedReport key={report.id} report={report} openTask={openTask} />
        : <button key={report.id} type="button" className="row-link compact" onClick={() => setPeriod({ start: report.starts_on, end: report.ends_on })}>
          <span className="row-primary"><span className="row-title">{span(report.starts_on, report.ends_on)}</span>
            <span className="row-sub">{report.summary ? report.summary.slice(0, 90) + (report.summary.length > 90 ? '…' : '') : 'No summary yet'}</span></span>
          <Badge>Draft</Badge>
        </button>)}</div>
    </section>
  </div>
}
