import { AiVote } from '../ai/AiUsage'
import { useEffect, useState } from 'react'
import { useResource, type Call } from '../../lib/api'
import { ErrorNote, Icon } from '../../ui'

export type Assist = { ai_usage_id?: string;
  summary: string
  previous_feedback?: { point: string; status: 'addressed' | 'partly' | 'not_addressed' | 'unclear'; evidence: string }[]
  criteria: { criterion: string; status: 'met' | 'not_met' | 'unclear'; evidence: string }[]
  suggested_feedback: string
  check: string[]
  suggested_decision: 'completed' | 'changes_requested' | null
  sources?: { source: string; kind: string; status: string; detail: string }[]
  model: string
}

const statusText = { met: 'Looks met', not_met: 'Not met', unclear: 'Check yourself' }

function Elapsed() {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => { const timer = setInterval(() => setSeconds(n => n + 1), 1000); return () => clearInterval(timer) }, [])
  return <span className="muted">{seconds}s</span>
}

/** Optional AI reading of the version under review. It never decides: the mentor chooses what to use. */
export function ReviewAssist({ call, path, submissionId, version, sent, onUse }: {
  call: Call; path: string; submissionId: string; version: number; criteria: string
  sent: { description: boolean; links: number; files: number }; onUse: (assist: Assist) => void
}) {
  const ai = useResource<{ configured: boolean }>(call, path.split('/tasks/')[0] + '/ai/status')
  const [assist, setAssist] = useState<Assist | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  if (!ai.data?.configured) return null
  const read = [sent.description ? 'the description' : null, sent.links ? `${sent.links} linked page${sent.links === 1 ? '' : 's'}` : null,
    sent.files ? `${sent.files} attachment${sent.files === 1 ? '' : 's'}` : null].filter(Boolean).join(', ') || 'nothing written'

  async function run() {
    if (pending) return
    setPending(true)
    setError('')
    try {
      setAssist(await call<Assist>(path + '/review-assist', { method: 'POST', body: JSON.stringify({ submission_id: submissionId }) }))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not prepare suggestions.')
    } finally {
      setPending(false)
    }
  }

  if (!assist) return <div className="assist-start">
    <button type="button" className="secondary" onClick={() => void run()} aria-disabled={pending}>
      {pending ? <span className="btn-spinner dark" aria-hidden="true" /> : <Icon name="sparkle" size={15} />}
      {pending ? `Reading version ${version}…` : error ? 'Try again' : 'Get AI suggestions'}</button>
    {pending && <Elapsed />}
    <span className="muted">Reads {read}. Opens supported attachments and public links. Sources requiring sign-in are flagged for manual review.</span>
    {error && <ErrorNote message={error} />}
  </div>

  return <section className="assist" aria-label="AI suggestions" aria-live="polite">
    <AiVote key={assist.ai_usage_id} call={call} org={path.split("/")[3]} id={assist.ai_usage_id} />
    <header className="assist-head">
      <p className="label"><Icon name="sparkle" size={14} />AI suggestions for version {version}</p>
      <span className="muted">Submission: {read} · {assist.model}</span>
    </header>
    <div className="assist-block">
      {!!assist.sources?.length && <details className="feature-disclosure">
        <summary>Sources inspected · {assist.sources.filter(source => source.status !== 'unread').length}/{assist.sources.length}</summary>
        <ul className="review-source-list">{assist.sources.map((source, index) => <li key={index}>
          <span><strong>{source.source}</strong><span className="fine">{source.detail}</span></span>
          <span className={source.status === 'unread' ? 'badge badge-warn' : 'badge badge-success'}>{source.status === 'unread' ? 'Manual check' : source.status === 'image' ? 'Image analyzed' : 'Text read'}</span>
        </li>)}</ul>
      </details>}
      <h4>Findings</h4>
      <p>{assist.summary}</p>
      {!!assist.previous_feedback?.length && <>
        <h4>Earlier feedback</h4>
        <ul className="assist-criteria">{assist.previous_feedback.map(item => <li key={item.point}>
          <span className={`assist-status ${item.status === 'addressed' ? 'met' : item.status === 'not_addressed' ? 'not_met' : 'unclear'}`}>
            {item.status === 'addressed' ? 'Addressed' : item.status === 'partly' ? 'Partly' : item.status === 'not_addressed' ? 'Not addressed' : 'Unclear'}</span>
          <span className="grow"><b>{item.point}</b><span className="muted">{item.evidence}</span></span>
        </li>)}</ul>
        <h4>Acceptance criteria</h4>
      </>}
      {assist.criteria.length > 0 && <ul className="assist-criteria">{assist.criteria.map(item => <li key={item.criterion}>
        <span className={`assist-status ${item.status}`}>{statusText[item.status]}</span>
        <span className="grow"><b>{item.criterion}</b><span className="muted">{item.evidence}</span></span>
      </li>)}</ul>}
    </div>
    {assist.check.length > 0 && <div className="assist-block checks">
      <h4>Check before deciding</h4>
      <ul>{assist.check.map(text => <li key={text}>{text}</li>)}</ul>
    </div>}
    <div className="assist-block">
      <h4>Suggested feedback{assist.suggested_decision ? ` · suggests “${assist.suggested_decision === 'completed' ? 'Approve' : 'Request changes'}”` : ''}</h4>
      <p className="prose-text">{assist.suggested_feedback}</p>
    </div>
    <div className="actions">
      <button type="button" className="secondary sm" onClick={() => onUse(assist)}><Icon name="arrow" size={14} />Use this feedback</button>
      <button type="button" className="ghost sm" onClick={() => setAssist(null)}>Dismiss</button>
      <span className="muted">You review and send it yourself.</span>
    </div>
  </section>
}
