import { AiVote } from '../ai/AiUsage'
import { useState, type FormEvent } from 'react'
import { useResource, type Call, type Role } from '../../lib/api'
import { ErrorNote } from '../../ui'

type Question = { id: string; title: string; body: string }
type Answer = { id: string; body: string; verified_at: string | null }
type Part = { body: string; sources: { kind: "answer" | "note"; id: string; title: string; body: string }[] }

export function TaskQuestions({ call, base, taskId, role }: {
  call: Call; base: string; taskId: string; role: Role
}) {
  const path = base + '/tasks/' + taskId + '/questions'
  const list = useResource<Question[]>(call, path)
  const [selected, select] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const fields = new FormData(form)
    setSaving(true)
    setError('')
    try {
      const question = await call<{ id: string }>(path, {
        method: 'POST', body: JSON.stringify({ title: fields.get('title'), body: fields.get('body') }),
      })
      form.reset()
      select(question.id)
      list.reload()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not post question.')
    } finally { setSaving(false) }
  }
  return <section className="feature-panel feature-stack task-discussion">
    <h2>Task questions</h2>
    <details className="feature-disclosure">
      <summary>Ask about this task</summary>
      <form className="stack" onSubmit={ask}>
        <label>Title<input name="title" required maxLength={180} /></label>
        <label>Question<textarea name="body" required maxLength={6000} /></label>
        <button disabled={saving}>{saving ? 'Posting…' : 'Post question'}</button>
        {error && <p role="alert">{error}</p>}
      </form>
    </details>
    {list.error ? <ErrorNote message={list.error} onRetry={list.reload} /> : !list.data
      ? <p role="status">Loading questions…</p> : !list.data.length ? <p>No questions yet.</p>
        : list.data.map(question => <article key={question.id} className="feature-thread">
          <button className="feature-thread-toggle" type="button" aria-expanded={selected === question.id}
            onClick={() => select(selected === question.id ? '' : question.id)}>{question.title}</button>
          {selected === question.id && <Thread call={call} base={base} path={path} role={role} question={question} />}
        </article>)}
  </section>
}

function Thread({ call, base, path, role, question }: {
  call: Call; base: string; path: string; role: Role; question: Question
}) {
  const answersPath = base + '/questions/' + question.id + '/answers'
  const answers = useResource<Answer[]>(call, answersPath)
  const [draft, setDraft] = useState('')
  const [usage, setUsage] = useState<string>()
  const [parts, setParts] = useState<Part[] | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  async function run(action: string, operation: () => Promise<void>) {
    setBusy(action)
    setError('')
    try { await operation() } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not complete this action.')
    } finally { setBusy('') }
  }
  return <div className="stack">
    <p>{question.body}</p>
    {answers.error ? <ErrorNote message={answers.error} onRetry={answers.reload} /> : answers.data?.map(answer =>
      <div key={answer.id} className="feature-result">
        <p>{answer.body}</p>
        {answer.verified_at ? <span>Verified answer</span> : role !== 'intern' && !answers.data?.some(item => item.verified_at) &&
          <button disabled={Boolean(busy)} type="button" onClick={() => run('Verifying…', async () => {
            await call(answersPath + '/' + answer.id + '/verify', { method: 'POST' })
            answers.reload()
          })}>Verify answer</button>}
      </div>)}
    {role === 'mentor' && <button className="secondary sm" type="button" disabled={Boolean(busy)}
      onClick={() => run('Finding sources…', async () => {
        const result = await call<{ parts: Part[]; ai_usage_id?: string }>(path + '/' + question.id + '/suggest', { method: 'POST' })
        setParts(result.parts)
        setUsage(result.ai_usage_id)
      })}>Suggest an answer</button>}
    {parts && (parts.length ? <div className="feature-result feature-stack">
      {parts.map((part, index) => <div key={index}><p>{part.body}</p>
        {part.sources.map(source => <details className="feature-disclosure" key={source.id}><summary>{source.title}</summary><p>{source.body}</p><a href={"#/questions?source=" + encodeURIComponent(path.split("/").at(-2) + "/" + source.kind + "/" + source.id)}>Open source</a></details>)}
      </div>)}
      <button className="secondary sm" type="button" onClick={() => setDraft(parts.map(part => part.body).join('\n\n'))}>Use in draft</button>
    </div> : <p>No verified sources answered this question.</p>)}
    <AiVote key={usage} call={call} org={base.split("/")[3]} id={usage} />
    <label>Your answer<textarea value={draft} maxLength={6000} onChange={event => setDraft(event.target.value)} /></label>
    <button type="button" disabled={Boolean(busy) || !draft.trim()} onClick={() => run('Posting answer…', async () => {
      await call(answersPath, { method: 'POST', body: JSON.stringify({ body: draft }) })
      setDraft('')
      answers.reload()
    })}>Post answer</button>
    {busy && <p role="status">{busy}</p>}
    {error && <p role="alert">{error}</p>}
  </div>
}
