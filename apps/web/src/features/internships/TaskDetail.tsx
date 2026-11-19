import { TaskQuestions } from './TaskQuestions'
import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useResource, type Call, type Role } from '../../lib/api'
import { Due, ErrorNote, Icon, Loading, StatusBadge, formatDate } from '../../ui'
import { SubmissionForm, fileSize } from './SubmissionForm'
import { ReviewAssist, type Assist } from './ReviewAssist'

export type Task = { id: string; title: string; criteria: string; due_on: string; status: 'planned' | 'submitted' | 'changes_requested' | 'completed'; estimated_hours?: number | null }
type SubmissionFile = { id: string; file_name: string; size_bytes: number; content_type: string }
type Submission = {
  id: string; version: number; evidence: string; feedback: string | null; decision: string | null; submitted_at: string
  reviewed_at: string | null; files: SubmissionFile[]; links: { url: string; title: string }[]
}

/** Posts the form fields (plus `extra`) and reports errors inline. */
export function ActionForm({ call, path, onSaved, children, label, busyLabel = 'Saving…', extra = {}, icon = 'check' }: {
  call: Call; path: string; onSaved: () => void; children: ReactNode; label: string; busyLabel?: string; extra?: Record<string, string>; icon?: 'check' | 'plus' | 'arrow'
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const form = event.currentTarget
    setPending(true)
    setError('')
    try {
      await call(path, { method: 'POST', body: JSON.stringify({ ...Object.fromEntries([...new FormData(form)].filter(([, value]) => value !== '')), ...extra }) })
      form.reset()
      onSaved()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save changes.')
    } finally {
      setPending(false)
    }
  }
  return <form onSubmit={submit}>
    {children}
    {error && <ErrorNote message={error} />}
    <div className="actions"><button disabled={pending}>{pending ? <span className="btn-spinner" aria-hidden="true" /> : <Icon name={icon} size={16} />}{pending ? busyLabel : label}</button></div>
  </form>
}

function safeHost(url: string) {
  try { return new URL(url).host } catch { return url }
}

function Attachments({ call, base, item }: { call: Call; base: string; item: Submission }) {
  const [opening, setOpening] = useState('')
  const [error, setError] = useState('')
  async function open(file: SubmissionFile) {
    // Open the tab during the click so pop-up blockers allow it, then point it at the short-lived link.
    const tab = window.open('', '_blank')
    if (tab) tab.opener = null
    setOpening(file.id)
    setError('')
    try {
      const { url } = await call<{ url: string }>(`${base}/files/${file.id}/url`)
      if (tab) tab.location.href = url
      else window.location.assign(url)
    } catch (failure) {
      tab?.close()
      setError(failure instanceof Error ? failure.message : 'Could not open the file.')
    } finally {
      setOpening('')
    }
  }
  if (!item.files.length && !item.links.length) return null
  return <div className="attachments">
    {item.links.map(link => <a key={link.url + link.title} className="attachment" href={link.url} target="_blank" rel="noopener noreferrer nofollow">
      <Icon name="arrow" size={14} /><span className="grow"><b>{link.title || safeHost(link.url)}</b><span className="fine">{safeHost(link.url)}</span></span>
    </a>)}
    {item.files.map(file => <button key={file.id} type="button" className="attachment" onClick={() => void open(file)} disabled={opening === file.id}>
      <Icon name="file" size={14} /><span className="grow"><b>{file.file_name}</b><span className="fine">{fileSize(file.size_bytes)}</span></span>
      {opening === file.id ? <span className="btn-spinner dark" aria-label="Opening" /> : <span className="fine">Open</span>}
    </button>)}
    {error && <ErrorNote message={error} />}
  </div>
}

/** Criteria written as lines or sentences become a short checklist. */
function criteriaList(text: string) {
  const lines = text.split(/\n+/).map(line => line.replace(/^[-*•\d.)\s]+/, '').trim()).filter(Boolean)
  const items = lines.length > 1 ? lines : text.split(/(?<=\.)\s+(?=[A-Z])/).map(line => line.trim()).filter(Boolean)
  return items.length ? items : [text]
}

function Criteria({ text }: { text: string }) {
  return <ul className="criteria">{criteriaList(text).map((line, i) => <li key={i}><Icon name="check" size={14} />{line}</li>)}</ul>
}

function VersionEvidence({ call, base, item }: { call: Call; base: string; item: Submission }) {
  return <div className="evidence">
    {item.evidence ? <p className="prose-text">{item.evidence}</p> : <p className="muted">No written description in this version.</p>}
    <Attachments call={call} base={base} item={item} />
  </div>
}

function ReviewForm({ call, base, path, latest, criteria, onSaved }: { call: Call; base: string; path: string; latest: Submission; criteria: string; onSaved: () => void }) {
  const [decision, setDecision] = useState<'completed' | 'changes_requested'>('completed')
  const [feedback, setFeedback] = useState('')
  const [fromAssist, setFromAssist] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const editor = useRef<HTMLTextAreaElement>(null)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    setPending(true)
    setError('')
    try {
      await call(path + '/review', { method: 'POST', body: JSON.stringify({ submission_id: latest.id, decision, feedback }) })
      onSaved()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save the review.')
    } finally {
      setPending(false)
    }
  }
  const useAssist = (assist: Assist) => {
    setFeedback(assist.suggested_feedback)
    if (assist.suggested_decision) setDecision(assist.suggested_decision)
    setFromAssist(true)
    setTimeout(() => { editor.current?.focus(); editor.current?.setSelectionRange(0, 0) }, 0)
  }
  return <form onSubmit={submit} className="review">
    <header className="review-head"><h3>Reviewing version {latest.version}</h3><span className="muted">Sent {formatDate(latest.submitted_at)}</span></header>
    <div className="review-grid">
      <section><p className="label">What the intern sent</p><VersionEvidence call={call} base={base} item={latest} /></section>
      <section><p className="label">Acceptance criteria</p><Criteria text={criteria} /></section>
    </div>
    <ReviewAssist call={call} path={path} submissionId={latest.id} version={latest.version}
      sent={{ description: !!latest.evidence, links: latest.links.length, files: latest.files.length }} criteria={criteria} onUse={useAssist} />
    <section className="decision">
      <p className="label">Your decision</p>
      <div className="choice-group" role="radiogroup" aria-label="Decision">
        <label className="choice approve"><input type="radio" name="decision" checked={decision === 'completed'} onChange={() => setDecision('completed')} /><Icon name="check" />Approve</label>
        <label className="choice changes"><input type="radio" name="decision" checked={decision === 'changes_requested'} onChange={() => setDecision('changes_requested')} /><Icon name="refresh" />Request changes</label>
      </div>
      <label>Feedback for the intern<textarea ref={editor} rows={5} maxLength={3000} required value={feedback}
        onChange={e => { setFeedback(e.target.value); if (!e.target.value) setFromAssist(false) }} placeholder="What worked well, and what should change?" /></label>
      {fromAssist && <p className="notice" role="status"><Icon name="sparkle" />Suggested text added. Edit it and check the decision. Nothing is sent until you save.</p>}
      {error && <ErrorNote message={error} />}
      <div className="actions"><button disabled={pending || !feedback.trim()}>
        {pending ? <span className="btn-spinner" aria-hidden="true" /> : <Icon name="check" size={16} />}
        {pending ? 'Saving review…' : decision === 'completed' ? `Approve version ${latest.version}` : 'Request changes'}</button></div>
    </section>
  </form>
}

export function TaskDetail({ call, base, task, role, highlight, onSaved, neighbors, openTask }: {
  call: Call; base: string; task: Task; role: Role; highlight?: number; onSaved: () => void; neighbors: Task[]; openTask: (id: string) => void
}) {
  const path = base + '/tasks/' + task.id
  const submissions = useResource<Submission[]>(call, path + '/submissions')
  const latest = submissions.data?.[0]
  const reload = () => { submissions.reload(); onSaved() }
  const canSubmit = role === 'intern' && (task.status === 'planned' || task.status === 'changes_requested')
  const canReview = role === 'mentor' && task.status === 'submitted' && latest && !latest.decision
  const history = canReview ? submissions.data?.slice(1) : submissions.data

  return <div className="task-page">
    <div className="stack">
      <section className="panel task-main" aria-label={`Task ${task.title}`}>
        <header>
          <h2 className="task-title">{task.title}</h2>
          <div className="meta-line"><StatusBadge status={task.status} />{task.status === 'completed' ? <span>Due {formatDate(task.due_on)}</span> : <Due date={task.due_on} />}
            {task.estimated_hours ? <span>{Number(task.estimated_hours)} h estimated</span> : null}</div>
        </header>
        {!canReview && <div><p className="label">Acceptance criteria</p><Criteria text={task.criteria} /></div>}
        {canSubmit && <div className="action-box">
          <SubmissionForm call={call} base={base} taskId={task.id} resubmit={task.status === 'changes_requested'} onSent={reload} />
        </div>}
        {canReview && <ReviewForm call={call} base={base} path={path} latest={latest} criteria={task.criteria} onSaved={reload} />}
        {role === 'mentor' && task.status === 'planned' && <p className="empty-line">Waiting for the intern to submit.</p>}
        {role === 'mentor' && task.status === 'changes_requested' && <p className="empty-line">Waiting for the intern’s next version.</p>}
        {role === 'intern' && task.status === 'submitted' && <p className="empty-line">Sent. Waiting for your mentor’s review.</p>}
      </section>

      <TaskQuestions key={path} call={call} base={base} taskId={task.id} role={role} />

      <section className="panel">
        <header className="panel-head"><h2>{canReview ? 'Earlier versions' : 'Versions'}{history && <span className="count">{history.length}</span>}</h2></header>
        {submissions.error && <ErrorNote message={submissions.error} onRetry={submissions.reload} />}
        {!submissions.data && !submissions.error && <Loading rows={2} />}
        {history?.length === 0 && <p className="empty-line">{canReview ? 'This is the first version.' : 'No submissions yet.'}</p>}
        <ol className="versions">{history?.map(item => <li key={item.id} className={highlight === item.version ? 'highlight' : undefined}
          aria-current={highlight === item.version ? 'true' : undefined}>
          <div className="version-head">
            <span className={`dot ${item.decision === 'completed' ? 'ok' : item.decision === 'changes_requested' ? 'no' : ''}`} aria-hidden="true" />
            <strong>Version {item.version}</strong>
            <span className="muted">{formatDate(item.submitted_at)}</span>
            <StatusBadge status={item.decision ?? 'submitted'} />
          </div>
          <VersionEvidence call={call} base={base} item={item} />
          {item.feedback && <div className={`feedback-box ${item.decision === 'completed' ? 'ok' : ''}`}>
            <p className="label">Mentor feedback on version {item.version}{item.reviewed_at ? ` · ${formatDate(item.reviewed_at)}` : ''}</p>
            <p className="prose-text">{item.feedback}</p>
          </div>}
        </li>)}</ol>
      </section>
    </div>
    <aside className="panel side-panel task-side">
      <dl className="facts vertical">
        <div><dt>Status</dt><dd><StatusBadge status={task.status} /></dd></div>
        <div><dt>Deadline</dt><dd>{formatDate(task.due_on)}</dd></div>
        <div><dt>Estimate</dt><dd>{task.estimated_hours ? `${Number(task.estimated_hours)} h` : '—'}</dd></div>
        <div><dt>Versions</dt><dd>{submissions.data?.length ?? '–'}</dd></div>
      </dl>
      {neighbors.length > 0 && <nav className="neighbors" aria-label="Other tasks">
        <p className="label">Other tasks</p>
        {neighbors.map(item => <button key={item.id} className="row-link compact" onClick={() => openTask(item.id)}>
          <span className="row-primary"><span className="row-title">{item.title}</span><span className="row-sub">Due {formatDate(item.due_on)}</span></span>
          <Icon name="arrow" size={15} /></button>)}
      </nav>}
    </aside>
  </div>
}
