import { Attention } from './Attention'
import { Guide } from './Guide'
import type { ReactNode } from 'react'
import { useResource, type Call, type Role } from '../../lib/api'
import type { Me, Tab } from '../../app/Workspace'
import { Due, ErrorNote, Icon, Person, Progress, StatusBadge, displayName, formatDate } from '../../ui'

export type QueueItem = {
  internship_id: string; task_id: string; title: string; status: string; due_on: string
  program: string; project: string | null; intern_email: string | null; mentor_email: string | null
  intern_name?: string | null; mentor_name?: string | null
  waiting_on: 'mentor' | 'intern'; submitted_at: string | null
}
type Counts = { open: number; submitted: number; changes_requested: number; planned: number; overdue: number }
export type Queue = { role: Role; items: QueueItem[]; counts: Counts; limit: number }
type Program = { id: string; name: string; description: string; internship_count: number }
type Internship = { id: string; program_id: string; program_name: string; intern_email: string | null; mentor_email: string | null
  intern_name?: string | null; mentor_name?: string | null; task_count: number; completed_count: number; submitted_count: number }

type Actions = {
  openTask: (internshipId: string, taskId: string, version?: number) => void
  openPlan: (internshipId: string) => void
  openInternship: (internshipId: string) => void
  openProgram: (programId: string) => void
  go: (tab: Tab) => void
}

/** One task per row: what, who, when, state. */
export function TaskRow({ item, showIntern, onOpen, action }: { item: QueueItem; showIntern: boolean; onOpen: () => void; action?: string }) {
  return <li>
    <button className="row-link" onClick={onOpen}>
      <span className="row-primary">
        <span className="row-title">{item.title}</span>
        <span className="row-sub">{[showIntern && displayName(item.intern_name, item.intern_email), item.project || item.program].filter(Boolean).join(' · ')}</span>
      </span>
      <span className="row-when">{item.status === 'submitted' && item.submitted_at ? <span>Sent {formatDate(item.submitted_at)}</span> : <Due date={item.due_on} />}</span>
      <span className="row-state"><StatusBadge status={item.status} />{action && <span className="row-action">{action}</span>}</span>
      <Icon name="arrow" size={16} />
    </button>
  </li>
}

function Panel({ title, count, hint, action, children }: { title: string; count?: number; hint?: string; action?: ReactNode; children: ReactNode }) {
  return <section className="panel">
    <header className="panel-head">
      <div><h2>{title}{count !== undefined && <span className="count">{count}</span>}</h2>{hint && <p>{hint}</p>}</div>
      {action}
    </header>
    {children}
  </section>
}

function Truncated({ data }: { data: Queue }) {
  return data.counts.open > data.items.length
    ? <p className="fine">Showing the {data.items.length} most urgent of {data.counts.open} open tasks. Totals count all of them.</p> : null
}

function greeting(me: Me) {
  const hour = new Date().getHours()
  const part = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const first = me.full_name?.trim().split(/\s+/)[0]
  return first ? `${part}, ${first}` : part
}

function Hero({ me, summary, children }: { me: Me; summary: ReactNode; children?: ReactNode }) {
  return <header className="hero workspace-greeting">
    <div className="greeting-copy"><span className="greeting-date">{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</span><h2>{greeting(me)}</h2><p>{summary}</p></div>
    {children}
  </header>
}

export function OverviewSkeleton() {
  return <div className="dashboard">
    <div className="skeleton" style={{ height: '6.5rem', borderRadius: 'var(--r-lg)' }} />
    <div className="dashboard-grid">
      <div className="stack">{[0, 1].map(card => <section key={card} className="panel">
        <div className="skeleton skeleton-line" style={{ width: '12rem' }} />
        <div className="rows">{[0, 1, 2].map(row => <div key={row} className="skeleton-row">
          <span><span className="skeleton skeleton-line" style={{ width: '60%' }} /><span className="skeleton skeleton-line short" style={{ width: '35%' }} /></span>
          <span className="skeleton skeleton-pill" />
        </div>)}</div>
      </section>)}</div>
      <div className="skeleton" style={{ height: '14rem', borderRadius: 'var(--r-lg)' }} />
    </div>
  </div>
}

function Roster({ call, orgId, actions, role }: { call: Call; orgId: string; actions: Actions; role: Role }) {
  const roster = useResource<Internship[]>(call, `/api/organizations/${orgId}/internships`)
  return <aside className="panel side-panel" aria-label={role === 'mentor' ? 'Your interns' : 'Your internship'}>
    <header className="panel-head"><h2>{role === 'mentor' ? 'Your interns' : 'Your internship'}</h2></header>
    {roster.error && <ErrorNote message={roster.error} onRetry={roster.reload} />}
    {!roster.data && !roster.error && <div className="skeleton" style={{ height: '8rem' }} />}
    {roster.data?.length === 0 && <p className="fine">No internships assigned yet.</p>}
    <ul className="people-list">{roster.data?.map(item => <li key={item.id}>
      <button className="person-link" onClick={() => actions.openInternship(item.id)}>
        <Person name={role === 'mentor' ? item.intern_name : item.mentor_name} email={role === 'mentor' ? item.intern_email : item.mentor_email}
          detail={role === 'mentor' ? item.program_name : `Mentor · ${item.program_name}`} />
      </button>
      <div className="person-progress">
        <Progress done={item.completed_count} total={item.task_count} label={`${item.completed_count} of ${item.task_count} tasks done`} />
        <span>{item.completed_count}/{item.task_count} done{item.submitted_count ? ` · ${item.submitted_count} to review` : ''}</span>
      </div>
      {role === 'mentor' && <button className="secondary sm" onClick={() => actions.openPlan(item.id)}><Icon name="sparkle" size={14} />Plan next period</button>}
    </li>)}</ul>
  </aside>
}

function weekRange() {
  const day = new Intl.DateTimeFormat('sv-SE')
  const start = new Date()
  const end = new Date(); end.setDate(end.getDate() + 6)
  return [day.format(start), day.format(end)] as const
}

function MentorOverview({ data, me, actions, call, orgId }: { data: Queue; me: Me; actions: Actions; call: Call; orgId: string }) {
  const [first, last] = weekRange()
  const review = data.items.filter(item => item.status === 'submitted')
  const upcoming = data.items.filter(item => item.status !== 'submitted' && item.due_on >= first && item.due_on <= last)
  return <div className="dashboard">
    <Hero me={me} summary={data.counts.submitted
      ? `${data.counts.submitted} submission${data.counts.submitted === 1 ? '' : 's'} waiting for your review${data.counts.overdue ? ` · ${data.counts.overdue} past due` : ''}.`
      : 'Nothing is waiting for your review.'}>
      {review[0] && <button onClick={() => actions.openTask(review[0].internship_id, review[0].task_id)}>Review oldest</button>}
    </Hero>
    <div className="dashboard-grid">
      <div className="stack">
        <Panel title="Review queue" count={review.length} hint={review.length ? 'Oldest submission first.' : undefined}>
          {review.length === 0 ? <p className="empty-line"><Icon name="check" size={16} />You’re up to date.</p>
            : <ul className="rows">{review.map(item => <TaskRow key={item.task_id} item={item} showIntern action="Review"
              onOpen={() => actions.openTask(item.internship_id, item.task_id)} />)}</ul>}
        </Panel>
        <Panel title="Due this week" count={upcoming.length} 
          action={<button className="ghost sm" onClick={() => actions.go('calendar')}><Icon name="calendar" size={15} />Calendar</button>}>
          {upcoming.length === 0 ? <p className="empty-line">No deadlines in the next 7 days.</p>
            : <ul className="rows">{upcoming.map(item => <TaskRow key={item.task_id} item={item} showIntern
              onOpen={() => actions.openTask(item.internship_id, item.task_id)} />)}</ul>}
        </Panel>
        <Truncated data={data} />
      </div>
      <Roster call={call} orgId={orgId} actions={actions} role="mentor" />
    </div>
  </div>
}

function InternOverview({ data, me, actions, call, orgId }: { data: Queue; me: Me; actions: Actions; call: Call; orgId: string }) {
  const changes = data.items.filter(item => item.status === 'changes_requested')
  const todo = data.items.filter(item => item.status === 'planned')
  const waiting = data.items.filter(item => item.status === 'submitted')
  const next = changes[0] ?? todo[0]
  // The next task is featured above, so the lists below leave it out.
  const rest = (items: QueueItem[]) => items.filter(item => item.task_id !== next?.task_id)
  return <div className="dashboard">
    <Hero me={me} summary={data.counts.open ? `${data.counts.open} open task${data.counts.open === 1 ? '' : 's'}${changes.length ? ` · ${changes.length} with requested changes` : ''}.` : 'You’re all caught up.'} />
    <div className="dashboard-grid">
      <div className="stack">
        {next && <section className="next-up">
          <p className="eyebrow">{next.status === 'changes_requested' ? 'Next up · changes requested' : 'Next up'}</p>
          <h3>{next.title}</h3>
          <p className="row-sub">{next.project || next.program} · <Due date={next.due_on} /></p>
          <button onClick={() => actions.openTask(next.internship_id, next.task_id)}>{next.status === 'changes_requested' ? 'Update your work' : 'Start task'}<Icon name="arrow" size={16} /></button>
        </section>}
        {rest(changes).length > 0 && <Panel title="Needs changes" count={rest(changes).length} >
          <ul className="rows">{rest(changes).map(item => <TaskRow key={item.task_id} item={item} showIntern={false} action="Resubmit"
            onOpen={() => actions.openTask(item.internship_id, item.task_id)} />)}</ul>
        </Panel>}
        <Panel title="To do" count={rest(todo).length} hint={rest(todo).length ? 'Sorted by deadline.' : undefined}>
          {rest(todo).length === 0 ? <p className="empty-line">Nothing else to start.</p>
            : <ul className="rows">{rest(todo).map(item => <TaskRow key={item.task_id} item={item} showIntern={false}
              onOpen={() => actions.openTask(item.internship_id, item.task_id)} />)}</ul>}
        </Panel>
        {waiting.length > 0 && <Panel title="Waiting for review" count={waiting.length} >
          <ul className="rows">{waiting.map(item => <TaskRow key={item.task_id} item={item} showIntern={false}
            onOpen={() => actions.openTask(item.internship_id, item.task_id)} />)}</ul>
        </Panel>}
        <Truncated data={data} />
      </div>
      <Roster call={call} orgId={orgId} actions={actions} role="intern" />
    </div>
  </div>
}

function AdminOverview({ call, orgId, me, data, actions, hr = false }: { call: Call; orgId: string; me: Me; data: Queue; actions: Actions; hr?: boolean }) {
  const programs = useResource<Program[]>(call, `/api/organizations/${orgId}/programs`)
  const internships = useResource<Internship[]>(call, `/api/organizations/${orgId}/internships`)
  const attention = internships.data?.filter(item => item.submitted_count > 0 || item.task_count === 0) ?? []
  return <div className="dashboard">
    <Hero me={me} summary={hr ? 'Every intern, what they work on and who may need help.' : 'Your organization’s programs and assignments.'}>
      {!hr && <div className="hero-actions">
        <button className="secondary" onClick={() => actions.go('programs')}><Icon name="plus" size={16} />Program</button>
        <button onClick={() => actions.go('assignments')}><Icon name="plus" size={16} />Assignment</button>
      </div>}
    </Hero>
    <div className="stat-strip">
      {([['Internships', internships.data?.length ?? '–'], ['Open tasks', data.counts.open], ['Waiting for review', data.counts.submitted],
        ['Past due', data.counts.overdue]] as const).map(([label, value]) => <div key={label} className="stat-cell"><strong>{value}</strong><span>{label}</span></div>)}
    </div>
    <div className="dashboard-grid">
      <Panel title="Programs"  action={<button className="ghost sm" onClick={() => actions.go('programs')}>All programs</button>}>
        {programs.error && <ErrorNote message={programs.error} onRetry={programs.reload} />}
        {!programs.data && !programs.error && <div className="skeleton" style={{ height: '6rem' }} />}
        {programs.data?.length === 0 && <p className="empty-line">No programs yet.</p>}
        <ul className="rows">{programs.data?.map(program => {
          const review = internships.data?.filter(item => item.program_id === program.id).reduce((sum, item) => sum + item.submitted_count, 0) ?? 0
          return <li key={program.id}><button className="row-link" onClick={() => actions.openProgram(program.id)}>
            <span className="row-primary"><span className="row-title">{program.name}</span><span className="row-sub">{program.description || 'No description'}</span></span>
            <span className="row-when">{program.internship_count} internship{program.internship_count === 1 ? '' : 's'}</span>
            <span className="row-state">{review > 0 && <span className="pill warn">{review} to review</span>}</span>
            <Icon name="arrow" size={16} />
          </button></li>
        })}</ul>
      </Panel>
      <aside className="panel side-panel">
        <header className="panel-head"><h2>Needs attention</h2></header>
        {!internships.data && <div className="skeleton" style={{ height: '8rem' }} />}
        {internships.data && attention.length === 0 && <p className="empty-line">Every assignment is on track.</p>}
        <ul className="people-list">{attention.slice(0, 8).map(item => <li key={item.id}>
          <button className="person-link" onClick={() => actions.openInternship(item.id)}>
            <Person name={item.intern_name} email={item.intern_email} detail={item.program_name} />
          </button>
          <span className="pill warn">{item.task_count === 0 ? 'No tasks yet' : `${item.submitted_count} to review`}</span>
        </li>)}</ul>
      </aside>
    </div>
  </div>
}

export function Overview({ call, orgId, role, me, actions }: { call: Call; orgId: string; role: Role; me: Me; actions: Actions }) {
  const queue = useResource<Queue>(call, `/api/organizations/${orgId}/overview`)
  const data = queue.data
  if (queue.error) return <ErrorNote message="Could not load your overview." onRetry={queue.reload} />
  if (!data) return <OverviewSkeleton />
  // Main work first; risk signals below and only when there are any.
  if (role !== 'intern') return <div className="stack">
    <Guide role={role} go={actions.go} />
    {role === 'admin' || role === 'hr' ? <AdminOverview call={call} orgId={orgId} me={me} data={data} actions={actions} hr={role === 'hr'} />
      : <MentorOverview data={data} me={me} actions={actions} call={call} orgId={orgId} />}
    <Attention key={orgId} call={call} orgId={orgId} openTask={actions.openTask} />
  </div>

  return <div className="stack"><Guide role={role} go={actions.go} /><InternOverview data={data} me={me} actions={actions} call={call} orgId={orgId} /></div>
}
