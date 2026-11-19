import { useRef, useState } from 'react'
import { useResource, type Call } from '../../lib/api'
import { Badge, ErrorNote, Loading, Person, type Tone } from '../../ui'

/** 👍/👎 on one AI result. The vote can be changed; only the latest one counts. */
export function AiVote({ call, org, id }: { call: Call; org: string; id?: string }) {
  const [vote, setVote] = useState<number>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const sending = useRef(false)
  if (!id) return null
  async function send(value: number) {
    if (sending.current || vote === value) return
    sending.current = true
    setBusy(true)
    setError('')
    try {
      await call('/api/organizations/' + org + '/ai/usage/' + id + '/vote', { method: 'PUT', body: JSON.stringify({ value }) })
      setVote(value)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save feedback.')
    } finally { sending.current = false; setBusy(false) }
  }
  return <div className="vote" role="group" aria-label="Was this AI suggestion helpful?">
    <span className="muted">Was this helpful?</span>
    <button type="button" className="chip" disabled={busy} aria-pressed={vote === 1} onClick={() => send(1)}>👍 Yes</button>
    <button type="button" className="chip" disabled={busy} aria-pressed={vote === -1} onClick={() => send(-1)}>👎 No</button>
    {vote !== undefined && <span className="muted" role="status">Thanks, saved.</span>}
    {error && <span className="field-error" role="alert">{error}</span>}
  </div>
}

type Entry = { id: string; actor_id: string; actor_name: string | null; actor_email: string | null; action: string; model: string; started_at: string
  elapsed_ms: number | null; outcome: string; input_tokens: number | null; output_tokens: number | null; vote: number | null; estimated_cost_usd: number | null }

const outcomes: Record<string, [string, Tone]> = {
  provider_success: ['Success', 'success'],
  validation_error: ['Invalid output', 'warn'],
  provider_error: ['Provider error', 'danger'],
  started: ['Did not finish', 'neutral'],
}
const actions: Record<string, string> = {
  generate_plan: 'Plan draft', review_assist: 'Review suggestions', summarize: 'Progress summary',
  suggest: 'Answer suggestion', explain: 'Next-step suggestion', analyze: 'CV analysis',
}

export function AiUsage({ call, org }: { call: Call; org: string }) {
  const data = useResource<Entry[]>(call, '/api/organizations/' + org + '/ai/usage')
  if (data.error) return <ErrorNote message={data.error} onRetry={data.reload} />
  if (!data.data) return <section className="panel"><Loading rows={4} /></section>
  const entries = data.data
  const succeeded = entries.filter(entry => entry.outcome === 'provider_success').length
  const votes = entries.filter(entry => entry.vote !== null)
  const helpful = votes.filter(entry => entry.vote === 1).length
  const cost = entries.reduce((sum, entry) => sum + (entry.estimated_cost_usd ?? 0), 0)
  return <div className="stack">
    <div className="stat-strip">
      <div className="stat-cell"><strong>{entries.length}</strong><span>Recent requests</span></div>
      <div className="stat-cell"><strong>{entries.length ? Math.round((succeeded / entries.length) * 100) : 0}%</strong><span>Valid results</span></div>
      <div className="stat-cell"><strong>{votes.length ? `${helpful}/${votes.length}` : '—'}</strong><span>Rated helpful</span></div>
      <div className="stat-cell"><strong>{entries.some(e => e.estimated_cost_usd != null) ? `$${cost.toFixed(4)}` : '—'}</strong><span>Estimated cost</span></div>
    </div>
    <section className="panel">
      <header className="panel-head">
        <div><h2>Recent AI requests<span className="count">{entries.length}</span></h2>
          <p>“Invalid output” means the provider answered but the result failed validation and was not shown. Cost appears only when model prices are configured.</p></div>
        <button className="ghost sm" type="button" onClick={data.reload}>Refresh</button>
      </header>
      {entries.length === 0 ? <p className="empty-line">No AI requests recorded yet.</p> : <ul className="rows">{entries.map(entry => {
        const [label, tone] = outcomes[entry.outcome] ?? [entry.outcome.replaceAll('_', ' '), 'neutral' as Tone]
        return <li key={entry.id} className="usage-row">
          <Person name={entry.actor_name} email={entry.actor_email ?? 'Former member'} size="sm"
            detail={`${actions[entry.action] ?? entry.action.replaceAll('_', ' ')} · ${new Date(entry.started_at).toLocaleString()}`} />
          <span className="muted">{entry.model}<br />{entry.elapsed_ms != null ? `${(entry.elapsed_ms / 1000).toFixed(1)} s` : '—'}
            {entry.input_tokens != null ? ` · ${entry.input_tokens + (entry.output_tokens ?? 0)} tokens` : ''}</span>
          <span className="row-state"><Badge tone={tone}>{label}</Badge>
            <span className="muted">{entry.vote === 1 ? '👍 Helpful' : entry.vote === -1 ? '👎 Not helpful' : 'No rating'}</span></span>
        </li>
      })}</ul>}
    </section>
  </div>
}
