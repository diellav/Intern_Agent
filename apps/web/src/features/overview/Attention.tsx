import { AiVote } from '../ai/AiUsage'
import { useState } from 'react'
import { useResource, type Call } from '../../lib/api'
import { ErrorNote } from '../../ui'

type Signal = {
  kind: 'overdue' | 'returns' | 'inactivity'; internship_id: string; program: string; checked_on: string; count: number
  intern_name?: string | null; intern_email?: string | null; has_submission?: boolean
  evidence: { task_id: string; title: string; due_on: string; version?: number }[]
}
type Open = (internship: string, task: string, version?: number) => void

export function Attention({ call, orgId, openTask }: { call: Call; orgId: string; openTask: Open }) {
  const path = '/api/organizations/' + orgId + '/attention'
  const result = useResource<Signal[]>(call, path)
  // Quiet when everything is on track: nothing to explain, nothing to show.
  if (result.data && result.data.length === 0) return null
  return <section className="feature-panel feature-stack">
    <header className="panel-head"><div><h2>Interns who may need help{result.data ? <span className="count">{result.data.length}</span> : null}</h2>
      <p>Shown for: 2+ open tasks past their deadline, a task returned for changes twice in a row, or 5+ days without a submission.</p></div></header>
    {result.error ? <ErrorNote message={result.error} onRetry={result.reload} /> : !result.data
      ? <p role="status" className="muted">Checking internship activity…</p>
      : result.data.map(signal => <SignalRow key={signal.internship_id + signal.kind}
          signal={signal} call={call} path={path} openTask={openTask} />)}
  </section>
}

const plural = (count: number, word: string) => count + ' ' + word + (count === 1 ? '' : 's')

function describe(signal: Signal) {
  if (signal.kind === 'overdue') return plural(signal.count, 'open task') + ' past their due date'
  if (signal.kind === 'returns') return plural(signal.count, 'task') + ' had ' + (signal.count === 1 ? 'its' : 'their')
    + ' last 2 versions returned for changes'
  return signal.has_submission ? 'No submissions in the last ' + plural(signal.count, 'day')
    : 'No submissions since the internship started ' + plural(signal.count, 'day') + ' ago'
}

function SignalRow({ signal, call, path, openTask }: { signal: Signal; call: Call; path: string; openTask: Open }) {
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState<{ next_step: string; ai_usage_id?: string }>()
  const [error, setError] = useState('')
  async function explain() {
    setBusy(true)
    setError('')
    try {
      const result = await call<NonNullable<typeof step>>(
        path + '/' + signal.internship_id + '/' + signal.kind + '/explain', { method: 'POST' })
      setStep(result)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not get a suggestion.')
    } finally {
      setBusy(false)
    }
  }
  return <article className="feature-result signal-card" data-kind={signal.kind}>
    <h3>{(signal.intern_name || signal.intern_email || 'Unnamed intern') + ' · ' + signal.program}</h3>
    <p>{describe(signal)} · Checked {signal.checked_on}</p>
    {signal.evidence.length > 0 && <ul>{signal.evidence.map(item =>
      <li key={item.task_id + item.version}><button className="link-btn" type="button"
        onClick={() => openTask(signal.internship_id, item.task_id, item.version)}>
        {item.title}{item.version ? ' · Version ' + item.version : ' · Due ' + item.due_on}
      </button></li>)}</ul>}
    <div><button className="secondary sm" type="button" disabled={busy} onClick={explain}>{busy ? 'Preparing suggestion…' : 'Suggest next step'}</button></div>
    {error && <p role="alert">{error}</p>}
    {step && <><p role="status">{step.next_step}</p><AiVote key={step.ai_usage_id} call={call} org={path.split("/")[3]} id={step.ai_usage_id} /></>}
  </article>
}
