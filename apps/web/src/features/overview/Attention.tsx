import { AiVote } from '../ai/AiUsage'
import { useState } from 'react'
import { useResource, type Call } from '../../lib/api'
import { ErrorNote, Icon, formatDate } from '../../ui'

type Signal = {
  kind: 'overdue' | 'returns' | 'inactivity'; internship_id: string; program: string; checked_on: string; count: number
  intern_name?: string | null; intern_email?: string | null; has_submission?: boolean
  evidence: { task_id: string; title: string; due_on: string; version?: number }[]
}
type Guidance = {
  summary: string
  causes: { cause: string; evidence: string }[]
  actions: { action: string; why: string }[]
  message_to_intern: string
  ai_usage_id?: string
}
type Open = (internship: string, task: string, version?: number) => void

export function Attention({ call, orgId, openTask }: { call: Call; orgId: string; openTask: Open }) {
  const path = '/api/organizations/' + orgId + '/attention'
  const result = useResource<Signal[]>(call, path)
  // Quiet when everything is on track: nothing to explain, nothing to show.
  if (result.data && result.data.length === 0) return null
  // One card per intern: their signals together, and one guidance for the whole picture.
  const interns = new Map<string, Signal[]>()
  for (const signal of result.data ?? []) interns.set(signal.internship_id, [...(interns.get(signal.internship_id) ?? []), signal])
  return <section className="feature-panel feature-stack">
    <header className="panel-head"><div><h2>Needs attention{result.data ? <span className="count">{interns.size}</span> : null}</h2>
      <p>Interns whose recorded work shows a reason to check in. Ask the AI for what is going on and what to do.</p></div></header>
    {result.error ? <ErrorNote message={result.error} onRetry={result.reload} /> : !result.data
      ? <p role="status" className="muted">Checking internship activity…</p>
      : [...interns.values()].map(list => <InternCard key={list[0].internship_id} signals={list} call={call} path={path} openTask={openTask} />)}
  </section>
}

const plural = (count: number, word: string) => count + ' ' + word + (count === 1 ? '' : 's')
const labels = { overdue: 'Overdue tasks', returns: 'Repeated changes requested', inactivity: 'No recent submissions' }
const icons = { overdue: 'clock', returns: 'refresh', inactivity: 'calendar' } as const

function describe(signal: Signal) {
  if (signal.kind === 'overdue') return plural(signal.count, 'open task') + ' past their due date'
  if (signal.kind === 'returns') return plural(signal.count, 'task') + ' had ' + (signal.count === 1 ? 'its' : 'their')
    + ' last 2 versions returned for changes'
  return signal.has_submission ? 'No submissions in the last ' + plural(signal.count, 'day')
    : 'No submissions since the internship started ' + plural(signal.count, 'day') + ' ago'
}

function InternCard({ signals, call, path, openTask }: { signals: Signal[]; call: Call; path: string; openTask: Open }) {
  const first = signals[0]
  const [busy, setBusy] = useState(false)
  const [guidance, setGuidance] = useState<Guidance>()
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  async function explain() {
    setBusy(true); setError('')
    try {
      setGuidance(await call<Guidance>(path + '/' + first.internship_id + '/' + first.kind + '/explain', { method: 'POST' }))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not get guidance.')
    } finally { setBusy(false) }
  }
  async function copy() {
    if (!guidance?.message_to_intern) return
    try { await navigator.clipboard.writeText(guidance.message_to_intern); setCopied(true); setTimeout(() => setCopied(false), 2000) }
    catch { setError('Could not copy. Select the text and copy it instead.') }
  }
  return <article className="feature-result signal-card">
    <header className="signal-heading">
      <span className="signal-symbol"><Icon name="alert" size={20} /></span>
      <div><h3>{first.intern_name || first.intern_email || 'Unnamed intern'}</h3>
        <span className="signal-person">{first.program}</span></div>
    </header>
    <ul className="signal-list">{signals.map(signal => <li key={signal.kind}>
      <span className="signal-line"><Icon name={icons[signal.kind]} size={15} /><b>{labels[signal.kind]}</b> · {describe(signal)}</span>
      {signal.evidence.length > 0 && <details className="signal-evidence"><summary>Show tasks<Icon name="arrow" size={14} /></summary><ul>{signal.evidence.map(item =>
        <li key={item.task_id + item.version}><button className="link-btn" type="button" onClick={() => openTask(signal.internship_id, item.task_id, item.version)}>
          {item.title}{item.version ? ' · Version ' + item.version : ' · Due ' + formatDate(item.due_on)}</button></li>)}</ul></details>}
    </li>)}</ul>
    <footer className="signal-footer"><span className="fine">Checked {formatDate(first.checked_on)}</span>
      <button className="secondary sm" type="button" disabled={busy} onClick={explain}>{busy
        ? <><span className="btn-spinner dark" />Looking at the work…</> : <><Icon name="sparkle" size={14} />{guidance ? 'Ask again' : 'What is going on?'}</>}</button></footer>
    {error && <p role="alert">{error}</p>}
    {guidance && <div className="signal-guidance guidance" role="status">
      <p className="guidance-summary">{guidance.summary}</p>
      {guidance.causes.length > 0 && <><span className="label">Likely causes</span>
        <ul className="guidance-list">{guidance.causes.map((item, index) => <li key={index}><b>{item.cause}</b><span className="fine">{item.evidence}</span></li>)}</ul></>}
      <span className="label">What to do this week</span>
      <ol className="guidance-list">{guidance.actions.map((item, index) => <li key={index}><b>{item.action}</b><span className="fine">{item.why}</span></li>)}</ol>
      {guidance.message_to_intern && <><span className="label">Message you could send</span>
        <blockquote className="guidance-message">{guidance.message_to_intern}</blockquote>
        <button className="ghost sm" type="button" onClick={copy}><Icon name={copied ? 'check' : 'file'} size={14} />{copied ? 'Copied' : 'Copy message'}</button></>}
      <AiVote key={guidance.ai_usage_id} call={call} org={path.split('/')[3]} id={guidance.ai_usage_id} />
    </div>}
  </article>
}
