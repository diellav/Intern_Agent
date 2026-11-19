import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ErrorNote, Icon, Loading, Modal } from '../../ui'

import type { Call } from '../../lib/api'
type Question = { id: string; title: string; body: string; answers: number; verified: boolean
  task_id?: string | null; task_title?: string | null; internship_id?: string | null }
type Answer = { id: string; body: string; verified_at: string | null }

export function Questions({ call, orgId, role, openTask }: { call: Call; orgId: string; role: string; openTask?: (internshipId: string, taskId: string) => void }) {
  const base = `/api/organizations/${orgId}/questions`
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [list, setList] = useState<Question[] | null>(null)
  const [selected, setSelected] = useState<Question | null>(null)
  const [answers, setAnswers] = useState<Answer[] | null>(null)
  const [revision, setRevision] = useState(0)
  const [pending, setPending] = useState(false)
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState('')
  const detail = useRef<HTMLElement>(null)

  useEffect(() => {
    const controller = new AbortController()
    call<Question[]>(`${base}?q=${encodeURIComponent(query)}`, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setList(data) })
      .catch(() => { if (!controller.signal.aborted) setError('Could not load questions.') })
    return () => controller.abort()
  }, [base, call, query, revision])

  const questionId = selected?.id
  useEffect(() => {
    if (!questionId) return
    const controller = new AbortController()
    call<Answer[]>(`${base}/${questionId}/answers`, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setAnswers(data) })
      .catch(() => { if (!controller.signal.aborted) setError('Could not load answers.') })
    return () => controller.abort()
  }, [base, call, questionId, revision])

  async function save(path: string, form?: HTMLFormElement, after?: () => void) {
    setPending(true)
    setError('')
    try {
      await call(path, { method: 'POST', body: form ? JSON.stringify(Object.fromEntries(new FormData(form))) : undefined })
      form?.reset()
      after?.()
      setRevision(n => n + 1)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save.')
    } finally {
      setPending(false)
    }
  }

  function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void save(base, event.currentTarget, () => { setSearch(''); setQuery(''); setAsking(false) })
  }

  function choose(item: Question) {
    if (item.id !== questionId) { setAnswers(null); setSelected(item) }
  }

  return <div className={`forum ${selected ? 'has-thread' : ''}`}>
    {error && <ErrorNote message={error} retryLabel="Refresh" onRetry={() => { setError(''); setRevision(n => n + 1) }} />}
    <Modal open={asking} onClose={() => setAsking(false)} title="Ask a question" description="Share what you tried so others can help faster.">
      <form onSubmit={publish} className="grid gap-3">
        <label>Title<input name="title" required maxLength={180} autoFocus placeholder="How do I rebase my branch onto main?" /></label>
        <label>What have you tried?<textarea name="body" rows={6} required maxLength={6000} /></label>
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={() => setAsking(false)}>Cancel</button>
          <button disabled={pending}>{pending ? <span className="btn-spinner" aria-hidden="true" /> : <Icon name="arrow" size={16} />}{pending ? 'Publishing…' : 'Publish question'}</button>
        </div>
      </form>
    </Modal>
    <section className="panel forum-list" aria-label="Questions">
      <header className="panel-head">
        <h2>{query ? `Results for “${query}”` : 'Questions'}{list && <span className="count">{list.length}</span>}</h2>
        <button className="sm" onClick={() => setAsking(true)}><Icon name="plus" size={15} />Ask</button>
      </header>
      <form className="search" role="search" onSubmit={event => { event.preventDefault(); setQuery(search.trim()) }}>
        <Icon name="search" size={17} />
        <input type="search" aria-label="Search questions" value={search} onChange={event => { setSearch(event.target.value); if (!event.target.value) setQuery('') }}
          maxLength={200} placeholder="Search Git, CORS, onboarding…" />
      </form>
      {!list && !error && <Loading rows={4} />}
      {list?.length === 0 && <p className="empty-line">{query ? 'No matching questions.' : 'No questions yet. Be the first to ask.'}</p>}
      <ul className="forum-items">{list?.map(item => <li key={item.id}>
        <button className="forum-item" aria-current={item.id === questionId ? 'true' : undefined} onClick={() => choose(item)}>
          <span className="row-title">{item.title}</span>
          {item.task_title && <span className="row-sub"><Icon name="file" size={13} />Task: {item.task_title}</span>}
          <span className="forum-meta">
            {item.verified ? <span className="pill ok">Verified answer</span> : item.answers ? <span className="muted">{item.answers} answer{item.answers === 1 ? '' : 's'}</span> : <span className="pill warn">Unanswered</span>}
          </span>
        </button>
      </li>)}</ul>
    </section>

    <section className="panel forum-thread" ref={detail} aria-label="Question thread">
      {selected ? <div className="stack" key={selected.id}>
        <button className="back-link forum-back" onClick={() => setSelected(null)}><Icon name="back" size={16} />Back to questions</button>
        <header>
          <h2 className="thread-title">{selected.title}</h2>
          {selected.task_id && selected.internship_id && openTask && <p className="row-sub" style={{ marginBottom: 'var(--s-2)' }}>
            Asked about the task <button className="link-btn" onClick={() => openTask(selected.internship_id!, selected.task_id!)}>{selected.task_title}</button></p>}
          <p className="prose-text">{selected.body}</p>
        </header>
        <div>
          <p className="label">{answers ? `${answers.length} answer${answers.length === 1 ? '' : 's'}` : 'Answers'}</p>
          {!answers && !error && <Loading rows={2} />}
          {answers?.length === 0 && <p className="empty-line">No answers yet. Know the answer? Share it below.</p>}
          <ul className="answers">{answers?.map(answer => <li key={answer.id} className={answer.verified_at ? 'answer verified' : 'answer'}>
            {answer.verified_at && <span className="pill ok"><Icon name="check" size={13} />Verified solution</span>}
            <p className="prose-text">{answer.body}</p>
            {(role === 'mentor' || role === 'admin') && !answers.some(item => item.verified_at) &&
              <button className="ghost sm" disabled={pending} onClick={() => void save(`${base}/${selected.id}/answers/${answer.id}/verify`)}><Icon name="check" size={15} />Mark as verified</button>}
          </li>)}</ul>
        </div>
        <form className="grid gap-2" onSubmit={event => { event.preventDefault(); void save(`${base}/${selected.id}/answers`, event.currentTarget) }}>
          <label>Your answer<textarea name="body" rows={4} required maxLength={6000} placeholder="Explain the fix or point to a resource…" /></label>
          <div className="actions"><button disabled={pending}>{pending ? <span className="btn-spinner" aria-hidden="true" /> : <Icon name="arrow" size={16} />}{pending ? 'Posting…' : 'Post answer'}</button></div>
        </form>
      </div> : <div className="thread-empty"><Icon name="chat" size={22} /><p>Choose a question to read the answers or add your own.</p></div>}
    </section>
  </div>
}
