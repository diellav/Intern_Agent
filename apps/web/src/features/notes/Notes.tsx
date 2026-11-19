import { useEffect, useState, type FormEvent } from 'react'
import { useResource, type Call, type Role } from '../../lib/api'
import { ErrorNote, Icon, displayName, formatDate, confirmAction } from '../../ui'

type Visibility = 'private' | 'shared'
type Note = { id: string; body: string; visibility: Visibility; created_at: string; updated_at: string; mine: boolean; author_email?: string | null; author_name?: string | null }

const visibilityText: Record<Visibility, string> = { private: 'Private · only you', shared: 'Shared with the intern' }

function NoteForm({ initial, busyLabel, label, onSubmit, onCancel }: {
  initial?: Note; label: string; busyLabel: string; onSubmit: (body: string, visibility: Visibility) => Promise<void>; onCancel?: () => void
}) {
  const [body, setBody] = useState(initial?.body ?? '')
  const [visibility, setVisibility] = useState<Visibility>(initial?.visibility ?? 'private')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending || !body.trim()) return
    setPending(true)
    setError('')
    try {
      await onSubmit(body.trim(), visibility)
      if (!initial) setBody('')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save the note.')
    } finally {
      setPending(false)
    }
  }
  return <form onSubmit={submit} className="note-form">
    <label className="sr-only" htmlFor={`note-${initial?.id ?? 'new'}`}>Note</label>
    <textarea id={`note-${initial?.id ?? 'new'}`} rows={3} maxLength={4000} value={body} onChange={e => setBody(e.target.value)}
      placeholder="Observations, agreements, things to follow up…" />
    <div className="note-form-row">
      <div className="segmented" role="radiogroup" aria-label="Who can see this note">
        <button type="button" role="radio" aria-checked={visibility === 'private'} aria-pressed={visibility === 'private'} onClick={() => setVisibility('private')}>Private</button>
        <button type="button" role="radio" aria-checked={visibility === 'shared'} aria-pressed={visibility === 'shared'} onClick={() => setVisibility('shared')}>Shared with intern</button>
      </div>
      <div className="actions">
        {onCancel && <button type="button" className="ghost sm" onClick={onCancel}>Cancel</button>}
        <button className="sm" disabled={pending || !body.trim()}>{pending && <span className="btn-spinner" aria-hidden="true" />}{pending ? busyLabel : label}</button>
      </div>
    </div>
    <p className="fine">{visibility === 'private' ? 'Only you can see this note. It is never sent to AI.' : 'The intern and organization admins can see this note. Shared notes can inform AI plan drafts.'}</p>
    {error && <ErrorNote message={error} />}
  </form>
}

export function Notes({ call, base, internshipId, role }: { call: Call; base: string; internshipId: string; role: Role }) {
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const path = `${base}/internships/${internshipId}/notes`
  const notes = useResource<Note[]>(call, path + (query ? `?q=${encodeURIComponent(query)}` : ''))
  const [editing, setEditing] = useState<string | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { const timer = setTimeout(() => setQuery(search.trim()), 300); return () => clearTimeout(timer) }, [search])
  const mentor = role === 'mentor'

  async function remove(note: Note) {
    if (!await confirmAction('Delete this note? This cannot be undone.', 'Delete note', true)) return
    setError('')
    try {
      await call(`${path}/${note.id}`, { method: 'DELETE' })
      notes.reload()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not delete the note.')
    }
  }

  return <section className="panel notes" aria-label="Notes">
    <header className="panel-head">
      <div><h2>Notes{notes.data ? <span className="count">{notes.data.length}</span> : null}</h2>
        <p>{mentor ? 'Separate from criteria, submissions and reviews. Private by default.' : 'Notes your mentor has shared with you.'}</p></div>
    </header>
    {mentor && <NoteForm label="Add note" busyLabel="Saving note…" onSubmit={async (body, visibility) => {
      await call(path, { method: 'POST', body: JSON.stringify({ body, visibility }) })
      notes.reload()
    }} />}
    <div className="search">
      <Icon name="search" size={17} />
      <input type="search" aria-label="Search notes" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search notes" />
    </div>
    {(error || notes.error) && <ErrorNote message={error || notes.error} onRetry={notes.error ? notes.reload : undefined} />}
    {!notes.data && !notes.error && <div className="grid gap-2">{[0, 1].map(i => <div key={i} className="skeleton" style={{ height: '4.5rem' }} />)}</div>}
    {notes.data?.length === 0 && (query
      ? <p className="fine">No notes match “{query}”.</p>
      : <p className="empty-line"><Icon name="book" size={16} />{mentor ? 'No notes yet. Write the first one above.' : 'Your mentor hasn’t shared any notes yet.'}</p>)}
    <ul className="note-list">{notes.data?.map(note => <li key={note.id} className={`note ${note.visibility}`}>
      {editing === note.id
        ? <NoteForm initial={note} label="Save" busyLabel="Saving…" onCancel={() => setEditing(null)} onSubmit={async (body, visibility) => {
          await call(`${path}/${note.id}`, { method: 'PUT', body: JSON.stringify({ body, visibility }) })
          setEditing(null)
          notes.reload()
        }} />
        : <>
          <div className="note-meta">
            <span className={`badge ${note.visibility === 'private' ? 'badge-neutral' : 'badge-brand'}`}>{note.mine ? visibilityText[note.visibility] : 'Shared by your mentor'}</span>
            <span className="fine">{note.mine ? 'You' : displayName(note.author_name, note.author_email ?? 'Mentor')} · {formatDate(note.created_at)}{note.updated_at !== note.created_at ? ' · edited' : ''}</span>
          </div>
          <p className="prose-text">{note.body}</p>
          {note.mine && <div className="actions">
            <button className="ghost sm" onClick={() => setEditing(note.id)}>Edit</button>
            <button className="ghost sm danger-text" onClick={() => void remove(note)}>Delete</button>
          </div>}
        </>}
    </li>)}</ul>
  </section>
}
