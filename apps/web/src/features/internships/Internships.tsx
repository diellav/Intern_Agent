import { useEffect, useState, type ReactNode } from 'react'
import { useResource, type Call, type Role } from '../../lib/api'
import type { Navigate, View } from '../../app/Workspace'
import { formatView } from '../../app/routes'
import { Due, Empty, ErrorNote, Icon, Loading, Modal, Person, Progress, StatusBadge, displayName, formatDate } from '../../ui'
import { Plans } from '../plans/Plans'
import { Notes } from '../notes/Notes'
import { Activity } from './Activity'
import { ActionForm, TaskDetail, type Task } from './TaskDetail'

type Program = { id: string; name: string }
type Member = { id: string; email: string; full_name?: string | null; role: 'mentor' | 'intern' }
export type Internship = {
  id: string; program_id: string; program_name: string; starts_on: string; ends_on: string
  mentor_id: string; intern_id: string; mentor_email: string | null; intern_email: string | null
  mentor_name?: string | null; intern_name?: string | null
  task_count: number; completed_count: number; submitted_count: number; changes_count: number; planned_count: number
}
type StatusFilter = 'all' | Task['status']

function periodText(starts: string, ends: string) {
  const day = 86400000
  const start = new Date(starts + 'T12:00:00').getTime()
  const end = new Date(ends + 'T12:00:00').getTime()
  const now = new Date(); now.setHours(12, 0, 0, 0)
  const total = Math.round((end - start) / day) + 1
  const elapsed = Math.round((now.getTime() - start) / day) + 1
  if (elapsed < 1) return `Starts ${formatDate(starts)}`
  if (elapsed > total) return 'Ended'
  return `Day ${elapsed} of ${total}`
}

function AssignDialog({ open, call, base, onClose, onSaved }: { open: boolean; call: Call; base: string; onClose: () => void; onSaved: () => void }) {
  const programs = useResource<Program[]>(call, open ? base + '/programs' : null)
  const people = useResource<Member[]>(call, open ? base + '/assignment-members' : null)
  const mentors = people.data?.filter(person => person.role === 'mentor')
  const interns = people.data?.filter(person => person.role === 'intern')
  const failure = programs.error || people.error
  const label = (person: Member) => person.full_name ? `${person.full_name} (${person.email})` : person.email
  return <Modal open={open} onClose={onClose} title="New assignment" description="Pair an intern with a mentor for a program.">
    {failure && <ErrorNote message={failure} onRetry={() => { programs.reload(); people.reload() }} />}
    {(!programs.data || !people.data) && !failure && <Loading rows={2} />}
    {programs.data?.length === 0 && <Empty icon="layers" title="Create a program first">Assignments belong to a program.</Empty>}
    {!!programs.data?.length && people.data && (!mentors?.length || !interns?.length) && <Empty icon="shield" title="Mentor and intern needed">
      Add an invited mentor and intern to this organization first.</Empty>}
    {!!programs.data?.length && !!mentors?.length && !!interns?.length && <ActionForm call={call} path={base + '/internships'}
      onSaved={() => { onSaved(); onClose() }} label="Create assignment" busyLabel="Creating assignment…" icon="plus">
      <label>Program<select name="program_id" required autoFocus>{programs.data.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <div className="form-grid two">
        <label>Mentor<select name="mentor_id" required>{mentors.map(item => <option key={item.id} value={item.id}>{label(item)}</option>)}</select></label>
        <label>Intern<select name="intern_id" required>{interns.map(item => <option key={item.id} value={item.id}>{label(item)}</option>)}</select></label>
        <label>Start date<input name="starts_on" type="date" required /></label>
        <label>End date<input name="ends_on" type="date" required /></label>
      </div>
    </ActionForm>}
  </Modal>
}

function AddTaskDialog({ open, call, base, internship, onClose, onSaved }: { open: boolean; call: Call; base: string; internship: Internship; onClose: () => void; onSaved: () => void }) {
  return <Modal open={open} onClose={onClose} title="Add task" description={`For ${displayName(internship.intern_name, internship.intern_email)} · ${internship.program_name}`}>
    <ActionForm call={call} path={`${base}/internships/${internship.id}/tasks`} onSaved={() => { onSaved(); onClose() }} label="Assign task" busyLabel="Assigning task…" icon="plus">
      <label>Task title<input name="title" required maxLength={120} autoFocus placeholder="Build the login screen" /></label>
      <label>Acceptance criteria<textarea name="criteria" rows={4} required maxLength={3000} placeholder="What does done look like?" /></label>
      <div className="form-grid two">
        <label>Deadline<input name="due_on" type="date" min={internship.starts_on} max={internship.ends_on} required /></label>
        <label>Estimated hours <span>(optional)</span><input name="estimated_hours" type="number" min="0.5" max="200" step="0.5" /></label>
      </div>
    </ActionForm>
  </Modal>
}

/** The internship's identity: the person, the program, the period and how far along it is. */
function InternshipHeader({ internship, role, back, children }: {
  internship: Internship; role: Role; back: { label: string; go: () => void } | null; children?: ReactNode
}) {
  const showIntern = role !== 'intern'
  return <header className="profile-head">
    <h1 className="sr-only">{displayName(showIntern ? internship.intern_name : internship.mentor_name, showIntern ? internship.intern_email : internship.mentor_email)} · {internship.program_name}</h1>
    {back && <button className="back-link" onClick={back.go}><Icon name="back" size={16} />{back.label}</button>}
    <div className="profile-row">
      <Person size="lg" name={showIntern ? internship.intern_name : internship.mentor_name} email={showIntern ? internship.intern_email : internship.mentor_email}
        detail={showIntern ? (internship.intern_name ? internship.intern_email : 'Intern') : `Your mentor${internship.mentor_name ? ` · ${internship.mentor_email ?? ''}` : ''}`} />
      {children}
    </div>
    <dl className="facts">
      <div><dt>Program</dt><dd>{internship.program_name}</dd></div>
      {showIntern && role === 'admin' && <div><dt>Mentor</dt><dd>{displayName(internship.mentor_name, internship.mentor_email)}</dd></div>}
      <div><dt>Period</dt><dd>{formatDate(internship.starts_on)} – {formatDate(internship.ends_on)}</dd></div>
      <div><dt>Progress</dt><dd>{periodText(internship.starts_on, internship.ends_on)}</dd></div>
    </dl>
  </header>
}

function TaskList({ call, base, internship, role, tasks, reload, openTask }: {
  call: Call; base: string; internship: Internship; role: Role; tasks: ReturnType<typeof useResource<Task[]>>
  reload: () => void; openTask: (id: string) => void
}) {
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [adding, setAdding] = useState(false)
  const records = tasks.data
  const count = (status: StatusFilter) => status === 'all' ? records?.length ?? 0 : records?.filter(task => task.status === status).length ?? 0
  const filters: [StatusFilter, string][] = [['all', 'All'], ['submitted', 'In review'], ['changes_requested', 'Changes'], ['planned', 'To do'], ['completed', 'Done']]
  const visible = records?.filter(task => filter === 'all' || task.status === filter)

  return <section className="panel">
    <header className="panel-head">
      <div className="segmented" role="group" aria-label="Filter tasks">
        {filters.filter(([key]) => key === 'all' || count(key) > 0).map(([key, label]) =>
          <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}<span className="seg-count">{count(key)}</span></button>)}
      </div>
      {role === 'mentor' && <button className="secondary sm" onClick={() => setAdding(true)}><Icon name="plus" size={15} />Add task</button>}
    </header>
    {role === 'mentor' && <AddTaskDialog open={adding} call={call} base={base} internship={internship} onClose={() => setAdding(false)} onSaved={reload} />}
    {tasks.error && <ErrorNote message={tasks.error} onRetry={tasks.reload} />}
    {!records && !tasks.error && <Loading />}
    {records?.length === 0 && <Empty icon="file" title="No tasks yet">
      {role === 'mentor' ? 'Draft the next period in the Plan tab, or add a single task.' : 'Your mentor will assign tasks here.'}</Empty>}
    <ul className="rows">{visible?.map(item => <li key={item.id}>
      <button className="row-link" onClick={() => openTask(item.id)}>
        <span className="row-primary"><span className="row-title">{item.title}</span>
          {item.estimated_hours ? <span className="row-sub">{Number(item.estimated_hours)} h estimated</span> : null}</span>
        <span className="row-when">{item.status === 'completed' ? <span>Due {formatDate(item.due_on)}</span> : <Due date={item.due_on} />}</span>
        <span className="row-state"><StatusBadge status={item.status} /></span>
        <Icon name="arrow" size={16} />
      </button>
    </li>)}</ul>
  </section>
}

function InternshipPage({ call, orgId, base, internship, role, view, navigate, showBack, onChanged }: {
  call: Call; orgId: string; base: string; internship: Internship; role: Role; view: View; navigate: Navigate; showBack: boolean; onChanged: () => void
}) {
  const tasks = useResource<Task[]>(call, `${base}/internships/${internship.id}/tasks`)
  const reload = () => { tasks.reload(); onChanged() }
  const go = (patch: Partial<View>) => navigate({ tab: 'internships', internshipId: internship.id, ...patch })
  const task = view.taskId ? tasks.data?.find(item => item.id === view.taskId) : undefined
  const done = tasks.data?.filter(item => item.status === 'completed').length ?? 0
  const total = tasks.data?.length ?? 0

  if (view.taskId) {
    return <div className="stack">
      <InternshipHeader internship={internship} role={role} back={{ label: 'Back to tasks', go: () => go({ section: 'tasks' }) }} />
      {tasks.error && <ErrorNote message={tasks.error} onRetry={tasks.reload} />}
      {!tasks.data && !tasks.error && <section className="panel"><Loading rows={4} /></section>}
      {tasks.data && !task && <Empty icon="file" title="Task not found">It may have been removed, or you may not have access to it.</Empty>}
      {task && <TaskDetail key={task.id} call={call} base={base} task={task} role={role} highlight={view.version} onSaved={reload}
        neighbors={tasks.data!.slice(Math.max(0, tasks.data!.indexOf(task) - 1), tasks.data!.indexOf(task) + 2).filter(item => item.id !== task.id)}
        openTask={taskId => go({ section: 'tasks', taskId })} />}
    </div>
  }

  const tabs: [NonNullable<View['section']>, string][] = [['tasks', `Tasks${total ? ` · ${total}` : ''}`], ['plan', 'Plan'], ['notes', 'Notes'], ['activity', 'Activity']]
  const section = view.section ?? 'tasks'
  return <div className="stack">
    <InternshipHeader internship={internship} role={role} back={showBack ? { label: 'All internships', go: () => navigate({ tab: 'internships' }) } : null}>
      {total > 0 && <div className="head-progress">
        <span><b>{done}</b> of {total} tasks done</span>
        <Progress done={done} total={total} />
      </div>}
    </InternshipHeader>
    <nav className="tabs" aria-label="Internship sections">
      {tabs.map(([key, label]) => <button key={key} aria-current={section === key ? 'page' : undefined} onClick={() => go({ section: key })}>{label}</button>)}
    </nav>
    {section === 'activity' ? <Activity call={call} path={`${base}/internships/${internship.id}/activity`}
      open={event => event.task_id ? go({ section: 'tasks', taskId: event.task_id, version: event.version ?? undefined }) : go({ section: 'plan' })} />
      : section === 'notes' ? <Notes call={call} base={base} internshipId={internship.id} role={role} />
      : section === 'plan' ? <Plans intern={role === "intern"} call={call} orgId={orgId} path={`${base}/internships/${internship.id}/plans`}
        internLabel={displayName(internship.intern_name, internship.intern_email)}
        starts={internship.starts_on} ends={internship.ends_on} mentor={role === 'mentor'}
        tasks={tasks.data ?? []} refreshTasks={reload} openTask={taskId => go({ section: 'tasks', taskId })}
        taskHref={(taskId, version) => formatView({ tab: 'internships', internshipId: internship.id, section: 'tasks', taskId, version: version ?? undefined })} />
      : <TaskList call={call} base={base} internship={internship} role={role} tasks={tasks} reload={reload} openTask={taskId => go({ section: 'tasks', taskId })} />}
  </div>
}

export function Internships({ call, orgId, role, view, navigate, manage = false }: {
  call: Call; orgId: string; role: Role; view: View; navigate: Navigate; manage?: boolean
}) {
  const base = '/api/organizations/' + orgId
  const list = useResource<Internship[]>(call, base + '/internships' + (view.programId ? `?program_id=${view.programId}` : ''))
  const [assigning, setAssigning] = useState(false)
  const records = list.data
  const single = role !== 'admin' && records?.length === 1 && !view.programId
  // Mentors and interns with one internship go straight to it.
  useEffect(() => {
    if (single && !view.internshipId) navigate({ tab: 'internships', internshipId: records[0].id, section: 'tasks' }, { replace: true })
  }, [single, records, view.internshipId, navigate])

  if (view.internshipId) {
    const internship = records?.find(item => item.id === view.internshipId)
    if (list.error) return <ErrorNote message={list.error} onRetry={list.reload} />
    if (!records) return <section className="panel"><Loading rows={4} /></section>
    if (!internship) return <Empty icon="briefcase" title="Internship not found">It may not exist, or you may not have access to it.</Empty>
    return <InternshipPage call={call} orgId={orgId} base={base} internship={internship} role={role} view={view} navigate={navigate}
      showBack={!single} onChanged={list.reload} />
  }

  const programName = view.programId && records?.[0]?.program_name
  return <section className="panel">
    <header className="panel-head">
      <div><h2>{manage ? 'Assignments' : role === 'intern' ? 'Your internship' : role === 'mentor' ? 'Your interns' : 'All internships'}
        {records && <span className="count">{records.length}</span>}</h2>
        {view.programId && <p>Program: <b>{programName || 'Selected program'}</b> · <button className="link-btn" onClick={() => navigate({ tab: 'internships' })}>Show all programs</button></p>}
      </div>
      {role === 'admin' && <button onClick={() => setAssigning(true)}><Icon name="plus" size={16} />New assignment</button>}
    </header>
    {role === 'admin' && <AssignDialog open={assigning} call={call} base={base} onClose={() => setAssigning(false)} onSaved={list.reload} />}
    {list.error && <ErrorNote message={list.error} onRetry={list.reload} />}
    {!records && !list.error && <Loading />}
    {records?.length === 0 && <Empty icon="briefcase" title="No internships here">
      {role === 'admin' ? 'Create an assignment to get started.' : 'You’ll see an internship here once an admin assigns you.'}</Empty>}
    {!!records?.length && <div className="table-head" aria-hidden="true"><span>{role === 'intern' ? 'Mentor' : 'Intern'}</span><span>Program</span><span>Period</span><span>Progress</span><span /></div>}
    <ul className="rows">{records?.map(item => <li key={item.id}>
      <button className="row-link internship-row" onClick={() => navigate({ tab: 'internships', internshipId: item.id, section: 'tasks' })}>
        <Person name={role === 'intern' ? item.mentor_name : item.intern_name} email={role === 'intern' ? item.mentor_email : item.intern_email}
          detail={role === 'admin' ? `Mentor: ${displayName(item.mentor_name, item.mentor_email)}` : undefined} />
        <span className="cell">{item.program_name}</span>
        <span className="cell muted">{formatDate(item.starts_on)} – {formatDate(item.ends_on)}</span>
        <span className="cell progress-cell">{item.task_count > 0
          ? <><Progress done={item.completed_count} total={item.task_count} /><span className="muted">{item.completed_count}/{item.task_count}</span></>
          : <span className="muted">No tasks yet</span>}</span>
        <span className="row-state">{item.submitted_count > 0 && <span className="pill warn">{item.submitted_count} to review</span>}</span>
      </button>
    </li>)}</ul>
  </section>
}
