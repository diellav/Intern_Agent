import { useResource, type Call, type Role } from '../../lib/api'
import type { Me, Tab } from '../../app/Workspace'
import { Guide } from '../overview/Guide'
import { Empty, ErrorNote, Icon, Loading, Person, Progress, displayName } from '../../ui'
import type { Project } from '../projects/Projects'

type Row = {
  internship_id: string; intern_name: string | null; intern_email: string | null; mentor_name: string | null; mentor_email: string | null
  project: string | null; jira_key: string | null; linked: boolean; done: number; in_progress: number; to_do: number; last_update: string | null
}

function nextStep(row: Row) {
  if (!row.project) return 'Choose a project'
  if (!row.jira_key) return 'Add the project’s Jira key'
  if (!row.linked) return 'Link the intern’s Jira account'
  if (!row.done && !row.in_progress && !row.to_do) return 'Assign a first issue'
  return null
}

/** Staff: every intern, their project and how their Jira work is moving. Interns: their project. */
export function JiraOverview({ call, orgId, role, me, openInternship, go }: {
  call: Call; orgId: string; role: Role; me: Me; openInternship: (id: string) => void; go: (tab: Tab) => void
}) {
  const staff = role !== 'intern'
  const rows = useResource<Row[]>(call, staff ? `/api/organizations/${orgId}/jira-overview` : null)
  const projects = useResource<Project[]>(call, staff ? null : `/api/organizations/${orgId}/projects`)
  const first = displayName(me.full_name, me.email).split(' ')[0]

  if (!staff) return <div className="stack">
    <Guide role={role} go={go} />
    <section className="panel"><h2>Hi {first}</h2>
      <p>Your tasks live in Jira, on your team’s board. Your mentor assigns them there, and you work on them like everyone else on the team.</p></section>
    {projects.error && <ErrorNote message={projects.error} onRetry={projects.reload} />}
    {!projects.data && !projects.error && <Loading rows={2} />}
    {projects.data?.map(project => <section key={project.id} className="panel project-text">
      <h2>{project.name}</h2>
      {project.tech_stack && <p className="fine">{project.tech_stack}</p>}
      {project.description && <p>{project.description}</p>}
      {project.current_focus && <p><b>What the team works on now:</b> {project.current_focus}</p>}
    </section>)}
    {projects.data?.length === 0 && <Empty icon="briefcase" title="No project yet">Your mentor will link you to a project.</Empty>}
  </div>

  const data = rows.data
  return <div className="stack">
    <Guide role={role} go={go} />
    <section className="panel">
      <header className="panel-head">
        <div><h2>Interns and their Jira work</h2><p>Each intern’s issues on their project’s board, by status. Open an intern to assign work in Jira.</p></div>
        <div className="actions">
          <button className="ghost sm" onClick={() => go('projects')}><Icon name="briefcase" size={15} />Projects</button>
          {role === 'admin' && <button className="ghost sm" onClick={() => go('assignments')}><Icon name="plus" size={15} />New assignment</button>}
        </div>
      </header>
      {rows.error && <ErrorNote message={rows.error} onRetry={rows.reload} />}
      {!data && !rows.error && <Loading rows={3} />}
      {data?.length === 0 && <Empty icon="user" title="No active interns">
        {role === 'admin' ? 'Create an assignment and link it to a project.' : 'You’ll see your interns here once an admin assigns them.'}</Empty>}
      <ul className="rows">{data?.map(row => {
        const total = row.done + row.in_progress + row.to_do
        const step = nextStep(row)
        return <li key={row.internship_id}>
          <button className="row-link overview-row" onClick={() => openInternship(row.internship_id)}>
            <Person name={row.intern_name} email={row.intern_email}
              detail={[row.project ?? 'No project', role === 'admin' ? `Mentor: ${displayName(row.mentor_name, row.mentor_email)}` : null].filter(Boolean).join(' · ')} />
            <span className="cell progress-cell">{total > 0
              ? <><Progress done={row.done} total={total} /><span className="muted">{row.done} done · {row.in_progress} in progress · {row.to_do} to do</span></>
              : <span className="muted">No Jira issues yet</span>}</span>
            <span className="row-state">{step ? <span className="pill warn">{step}</span>
              : row.last_update && <span className="fine">Updated {new Date(row.last_update).toLocaleDateString()}</span>}</span>
            <Icon name="arrow" size={16} />
          </button>
        </li>
      })}</ul>
    </section>
  </div>
}
