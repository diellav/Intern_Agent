import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useResource, type Call, type Role } from '../../lib/api'
import { Empty, ErrorNote, Icon, Loading, Modal, Progress, confirmAction, formatDate } from '../../ui'

export type Project = {
  id: string; name: string; description: string; status: 'active' | 'paused' | 'done'
  tech_stack: string; current_focus: string; intern_areas: string; repo_url: string | null; jira_key: string | null
  revision: number; active_interns?: number
}
type Brief = {
  state: string
  modules: { name: string; status: 'done' | 'in_progress' | 'not_started'; note: string }[]
  recent_changes: string[]
  intern_opportunities: { issue_key: string; why: string }[]
  suggested_fields: { description: string; current_focus: string; intern_areas: string }
}
type JiraStatus = {
  configured: boolean; jira_key: string | null; browse_url: string | null; synced_at: string | null
  counts: { total: number; done: number; in_progress: number; to_do: number; unassigned: number }
  modules: { key: string; name: string; total: number; done: number; in_progress: number }[]
  events: { key: string; kind: 'created' | 'status' | 'removed'; summary: string; from_status: string | null; to_status: string | null; occurred_at: string }[]
  brief: Brief | null; brief_at: string | null; brief_outdated: boolean
}
type Fields = Pick<Project, 'description' | 'current_focus' | 'intern_areas'>

const statusLabel: Record<Project['status'], [string, string]> = { active: ['Active', 'pill success'], paused: ['Paused', 'pill warn'], done: ['Done', 'pill'] }
const moduleLabel: Record<Brief['modules'][number]['status'], [string, string]> = {
  done: ['Done', 'pill success'], in_progress: ['In progress', 'pill warn'], not_started: ['Not started', 'pill muted-pill'],
}
const STALE_MS = 15 * 60 * 1000

function ProjectForm({ open, call, path, project, admin, suggested, onClose, onSaved }: {
  open: boolean; call: Call; path: string; project: Project | null; admin: boolean; suggested?: Fields
  onClose: () => void; onSaved: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [filled, setFilled] = useState<Fields | null>(null)
  const values = { ...project, ...filled }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const body = Object.fromEntries(new FormData(event.currentTarget))
    setBusy(true); setError('')
    try {
      await call(project ? `${path}/${project.id}` : path, {
        method: project ? 'PUT' : 'POST',
        body: JSON.stringify(project ? { ...body, revision: project.revision } : body),
      })
      setFilled(null); onSaved(); onClose()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save the project.')
    } finally { setBusy(false) }
  }
  async function remove() {
    if (!project || !await confirmAction(`Delete “${project.name}”? This can’t be undone.`, 'Delete project', true)) return
    setBusy(true); setError('')
    try { await call(`${path}/${project.id}`, { method: 'DELETE' }); onSaved(); onClose() }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not delete the project.') }
    finally { setBusy(false) }
  }
  return <Modal open={open} onClose={() => { setFilled(null); onClose() }} wide title={project ? 'Edit project' : 'Add a project'}
    description="Describe real company work. With a Jira key, the agent keeps this up to date from the board.">
    {/* Remount when suggested text is applied, so the fields show it. */}
    <form key={(project?.id ?? 'new') + (filled ? '-filled' : '')} onSubmit={save} className="grid gap-3">
      {suggested && <div className="notice">
        The latest Jira analysis suggests text for the three description fields.
        <button type="button" className="link-btn" onClick={() => setFilled(suggested)}>Use suggested text</button>
      </div>}
      <div className="form-grid two">
        <label>Project name<input name="name" required maxLength={120} defaultValue={values.name} autoFocus placeholder="PeopleHub" /></label>
        <label>Status<select name="status" defaultValue={values.status ?? 'active'}>
          <option value="active">Active</option><option value="paused">Paused</option><option value="done">Done</option></select></label>
      </div>
      <label>What the project is<textarea name="description" rows={4} maxLength={6000} defaultValue={values.description}
        placeholder="Who uses it, what it does, its modules and how far along each is." /></label>
      <label>Tech stack<input name="tech_stack" maxLength={500} defaultValue={values.tech_stack} placeholder="React, TypeScript, FastAPI, PostgreSQL" /></label>
      <label>What the team is working on now<textarea name="current_focus" rows={3} maxLength={3000} defaultValue={values.current_focus}
        placeholder="Current milestone, upcoming release, known problems." /></label>
      <label>Where interns can help<textarea name="intern_areas" rows={3} maxLength={3000} defaultValue={values.intern_areas}
        placeholder="Low-risk, real work: tests, accessibility fixes, small bugs labelled good-first-issue, docs." /></label>
      <div className="form-grid two">
        <label>Repository <span>(optional)</span><input name="repo_url" type="url" maxLength={2000} defaultValue={values.repo_url ?? ''} placeholder="https://github.com/…" /></label>
        <label>Jira project key <span>(optional)</span><input name="jira_key" maxLength={10} pattern="[A-Z][A-Z0-9_]{1,9}" defaultValue={values.jira_key ?? ''}
          placeholder="FLEET" title="Capital letters and digits, e.g. FLEET" /></label>
      </div>
      <p className="fine">Repository and Jira links are never sent to the AI.</p>
      {error && <ErrorNote message={error} />}
      <div className="modal-actions">
        {project && admin && <button type="button" className="ghost danger-btn" disabled={busy} onClick={remove}>Delete</button>}
        <button type="button" className="ghost" onClick={() => { setFilled(null); onClose() }}>Cancel</button>
        <button disabled={busy}>{busy ? <span className="btn-spinner" aria-hidden="true" /> : <Icon name="check" size={16} />}{busy ? 'Saving…' : 'Save project'}</button>
      </div>
    </form>
  </Modal>
}

/** Where the project stands on its Jira board, kept current by syncing and the agent's running brief. */
function JiraPanel({ call, path, project, onBrief, analyse }: { call: Call; path: string; project: Project; onBrief: (brief: Brief | null) => void; analyse: boolean }) {
  const jira = useResource<JiraStatus>(call, `${path}/${project.id}/jira`)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const auto = useRef(false)
  const data = jira.data
  useEffect(() => { onBrief(data?.brief ?? null) }, [data, onBrief])

  async function run(label: string, url: string) {
    if (busy) return
    setBusy(label); setError('')
    try { jira.setData(await call<JiraStatus>(url, { method: 'POST' })) }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not update from Jira.') }
    finally { setBusy('') }
  }
  // Opening the project refreshes a stale copy once, so what you see follows the board.
  useEffect(() => {
    if (!data || auto.current || !data.configured || !data.jira_key) return
    const age = data.synced_at ? Date.now() - new Date(data.synced_at).getTime() : Infinity
    if (age > STALE_MS) { auto.current = true; void run('Syncing with Jira…', `${path}/${project.id}/jira/sync`) }
  })  // eslint-disable-line react-hooks/exhaustive-deps

  if (jira.error) return <ErrorNote message={jira.error} onRetry={jira.reload} />
  if (!data) return <section className="panel"><Loading rows={3} /></section>
  if (!data.jira_key) return <section className="panel"><Empty icon="layers" title="No Jira board linked">
    Add the Jira project key in Edit, and the agent will follow the board: modules, progress and where interns can step in.</Empty></section>
  if (!data.configured) return <section className="panel"><p className="fine">Jira is not configured on the server. Ask an admin to add the Jira settings.</p></section>
  const link = (key: string) => data.browse_url ? <a href={data.browse_url + key} target="_blank" rel="noreferrer">{key}</a> : <b>{key}</b>
  const { counts, brief } = data

  return <section className="panel stack jira-panel">
    <header className="panel-head">
      <div><h2>Jira board · {data.jira_key}</h2>
        <p>{data.synced_at ? `Synced ${new Date(data.synced_at).toLocaleString()}` : 'Not synced yet'}
          {data.brief_at && ` · analysed ${new Date(data.brief_at).toLocaleString()}`}</p></div>
      <div className="actions">
        <button className="secondary sm" disabled={Boolean(busy)} onClick={() => run('Syncing with Jira…', `${path}/${project.id}/jira/sync`)}>
          {busy === 'Syncing with Jira…' ? <span className="btn-spinner" aria-hidden="true" /> : <Icon name="refresh" size={15} />}{busy === 'Syncing with Jira…' ? 'Syncing…' : 'Sync now'}</button>
        {analyse && counts.total > 0 && <button className="ghost sm" disabled={Boolean(busy)} onClick={() => run('Analysing…', `${path}/${project.id}/brief`)}>
          {busy === 'Analysing…' ? <span className="btn-spinner" aria-hidden="true" /> : <Icon name="sparkle" size={15} />}{busy === 'Analysing…' ? 'Analysing…' : 'Analyse again'}</button>}
      </div>
    </header>
    {error && <ErrorNote message={error} />}
    {counts.total > 0 && <div className="stat-strip">
      <div><b>{counts.done}</b><span>done</span></div>
      <div><b>{counts.in_progress}</b><span>in progress</span></div>
      <div><b>{counts.to_do}</b><span>to do</span></div>
      <div><b>{counts.unassigned}</b><span>open, unassigned</span></div>
    </div>}
    {brief && <>
      <p className="brief-state">{brief.state}</p>
      {data.brief_outdated && <p className="fine">The board changed since this analysis. Sync to update it.</p>}
    </>}
    {!!data.modules.length && <div className="assist-block"><h4>Modules</h4>
      <ul className="module-list">{data.modules.map(module => {
        const note = brief?.modules.find(item => item.name === module.name)
        return <li key={module.key}>
          <span className="fit-head"><b>{module.name}</b>{note && <span className={moduleLabel[note.status][1]}>{moduleLabel[note.status][0]}</span>}</span>
          <span className="module-progress"><Progress done={module.done} total={module.total} /><span className="fine">{module.done}/{module.total}</span></span>
          {note?.note && <p className="fine">{note.note}</p>}
        </li>
      })}</ul></div>}
    {!!brief?.intern_opportunities.length && <div className="assist-block"><h4>Where an intern can start</h4>
      <ul className="opportunities">{brief.intern_opportunities.map(item => <li key={item.issue_key}>{link(item.issue_key)} {item.why}</li>)}</ul></div>}
    {!!brief?.recent_changes.length && <div className="assist-block"><h4>Recent changes</h4>
      <ul>{brief.recent_changes.map((change, index) => <li key={index}>{change}</li>)}</ul></div>}
    {!!data.events.length && <details className="events"><summary>Board history ({data.events.length})</summary>
      <ul>{data.events.map((event, index) => <li key={index} className="fine">
        {formatDate(event.occurred_at.slice(0, 10))} · {link(event.key)} {event.summary}: {event.kind === 'created' ? 'created' : event.kind === 'removed' ? 'removed' : `${event.from_status} → ${event.to_status}`}
      </li>)}</ul></details>}
  </section>
}

function ProjectDetail({ call, path, project, role, back, onChanged }: {
  call: Call; path: string; project: Project; role: Role; back: () => void; onChanged: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [brief, setBrief] = useState<Brief | null>(null)
  const staff = role === 'admin' || role === 'mentor'
  return <div className="stack">
    <header className="profile-head">
      <button className="back-link" onClick={back}><Icon name="back" size={16} />All projects</button>
      <div className="profile-row">
        <div><h1 className="page-title">{project.name} <span className={statusLabel[project.status][1]}>{statusLabel[project.status][0]}</span></h1>
          {project.tech_stack && <p className="fine">{project.tech_stack}</p>}</div>
        {staff && <button className="secondary sm head-action" onClick={() => setEditing(true)}><Icon name="file" size={15} />Edit</button>}
      </div>
    </header>
    {staff && <ProjectForm open={editing} call={call} path={path} project={project} admin={role === 'admin'}
      suggested={brief?.suggested_fields} onClose={() => setEditing(false)} onSaved={onChanged} />}
    <section className="panel project-text">
      {project.description && <p>{project.description}</p>}
      {project.current_focus && <p><b>Now:</b> {project.current_focus}</p>}
      {project.intern_areas && <p><b>Interns can help with:</b> {project.intern_areas}</p>}
      {!project.description && !project.current_focus && <p className="fine">No description yet.</p>}
    </section>
    {role !== 'intern' && <JiraPanel call={call} path={path} project={project} onBrief={setBrief} analyse={staff} />}
  </div>
}

export function Projects({ call, orgId, role }: { call: Call; orgId: string; role: Role }) {
  const path = `/api/organizations/${orgId}/projects`
  const projects = useResource<Project[]>(call, path)
  const [creating, setCreating] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const staff = role !== 'intern'
  const open = projects.data?.find(project => project.id === openId)
  if (open) return <ProjectDetail call={call} path={path} project={open} role={role} back={() => setOpenId(null)} onChanged={projects.reload} />

  return <div className="stack">
    <div className="toolbar">
      <p className="grow muted">{staff
        ? 'The company work interns join. Link a Jira board and the agent follows it: modules, progress and where interns can help.'
        : 'The project you are working on.'}</p>
      {(role === 'admin' || role === 'mentor') && <button onClick={() => setCreating(true)}><Icon name="plus" size={16} />Add project</button>}
    </div>
    {(role === 'admin' || role === 'mentor') && <ProjectForm open={creating} call={call} path={path} project={null} admin={role === 'admin'}
      onClose={() => setCreating(false)} onSaved={projects.reload} />}
    {projects.error && <ErrorNote message={projects.error} onRetry={projects.reload} />}
    {!projects.data && !projects.error && <div className="card-grid">{[0, 1].map(i => <div key={i} className="skeleton" style={{ height: '10rem', borderRadius: 'var(--r-lg)' }} />)}</div>}
    {projects.data?.length === 0 && <Empty icon="briefcase" title="No projects yet">
      {staff ? 'Add the projects your team is building, so interns get real work.' : 'Your mentor hasn’t linked a project to your internship yet.'}</Empty>}
    <ul className="card-grid">{projects.data?.map(project => <li key={project.id}>
      <button className="program-card project-card" onClick={() => setOpenId(project.id)}>
        <span className="project-card-head"><h3>{project.name}</h3><span className={statusLabel[project.status][1]}>{statusLabel[project.status][0]}</span></span>
        {project.tech_stack && <span className="fine">{project.tech_stack}</span>}
        <span className="program-desc">{project.description || 'No description yet.'}</span>
        <span className="project-card-foot">
          {staff && <span className={project.active_interns ? 'pill' : 'pill muted-pill'}>{project.active_interns ?? 0} intern{project.active_interns === 1 ? '' : 's'}</span>}
          {project.jira_key && <span className="pill muted-pill">Jira {project.jira_key}</span>}
          <Icon name="arrow" size={15} />
        </span>
      </button>
    </li>)}</ul>
  </div>
}
