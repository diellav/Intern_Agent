import { useState, type FormEvent } from 'react'
import { useResource, type Call, type Role } from '../../lib/api'
import { Empty, ErrorNote, Icon, Modal } from '../../ui'

type Program = { id: string; name: string; description: string; internship_count: number }

function CreateProgram({ open, path, call, onClose, onCreated }: { open: boolean; path: string; call: Call; onClose: () => void; onCreated: (program: Program) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const fields = new FormData(event.currentTarget)
    setBusy(true)
    setError('')
    try {
      onCreated(await call<Program>(path, { method: 'POST', body: JSON.stringify({ name: fields.get('name'), description: fields.get('description') }) }))
      onClose()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not create the program.')  // the form keeps what was typed
    } finally {
      setBusy(false)
    }
  }
  return <Modal open={open} onClose={onClose} title="Create a program" description="Group internships under a shared curriculum.">
    <form onSubmit={create} className="grid gap-3">
      <label>Program name<input name="name" autoFocus placeholder="Frontend internship" required maxLength={120} /></label>
      <label>Description <span>(optional)</span><textarea name="description" rows={4} maxLength={1000} placeholder="What will interns learn?" /></label>
      {error && <ErrorNote message={error} />}
      <div className="modal-actions">
        <button type="button" className="ghost" onClick={onClose}>Cancel</button>
        <button disabled={busy}>{busy ? <span className="btn-spinner" aria-hidden="true" /> : <Icon name="plus" size={16} />}{busy ? 'Creating program…' : 'Create program'}</button>
      </div>
    </form>
  </Modal>
}

export function Programs({ call, orgId, role, openProgram }: { call: Call; orgId: string; role: Role; openProgram: (programId: string) => void }) {
  const path = `/api/organizations/${orgId}/programs`
  const programs = useResource<Program[]>(call, path)
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const query = search.trim().toLowerCase()
  const visible = programs.data?.filter(program => (program.name + ' ' + program.description).toLowerCase().includes(query))

  return <div className="stack">
    <div className="toolbar">
      {!!programs.data?.length && <div className="search grow">
        <Icon name="search" size={17} />
        <input type="search" aria-label="Search programs" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search programs" />
      </div>}
      {role === 'admin' && <button onClick={() => setCreating(true)}><Icon name="plus" size={16} />Create program</button>}
    </div>
    {role === 'admin' && <CreateProgram open={creating} path={path} call={call} onClose={() => setCreating(false)}
      onCreated={program => programs.setData(current => [...(current ?? []), program].sort((a, b) => a.name.localeCompare(b.name)))} />}
    {programs.error && <ErrorNote message={programs.error} onRetry={programs.reload} />}
    {!programs.data && !programs.error && <div className="card-grid">{[0, 1, 2].map(i => <div key={i} className="skeleton" style={{ height: '10rem', borderRadius: 'var(--r-lg)' }} />)}</div>}
    {programs.data?.length === 0 && <Empty icon="grid" title="No programs yet">
      {role === 'admin' ? 'Create the first program to get started.' : 'Your admin hasn’t created any programs yet.'}</Empty>}
    {!!programs.data?.length && visible?.length === 0 && <p className="empty-line">No programs match “{search.trim()}”.</p>}
    <ul className="card-grid">{visible?.map(program => <li key={program.id}>
      <article className="program-card"><div className="program-card-symbol"><Icon name="layers" size={23} /></div>
        <h3>{program.name}</h3>
        {program.description && <p className="program-desc">{program.description}</p>}
        <footer>
          <span className={program.internship_count ? 'pill' : 'pill muted-pill'}>{program.internship_count} internship{program.internship_count === 1 ? '' : 's'}</span>
          {program.internship_count > 0
            ? <button className="ghost sm" onClick={() => openProgram(program.id)}>Open<Icon name="arrow" size={15} /></button>
            : <span className="muted">{role === 'admin' ? 'No assignments yet' : 'None you can open'}</span>}
        </footer>
      </article>
    </li>)}</ul>
    {role !== 'admin' && !!programs.data?.length && <p className="fine">Counts include only internships you have access to.</p>}
  </div>
}
