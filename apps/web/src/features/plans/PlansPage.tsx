import { useState } from 'react'
import { useResource, type Call, type Role } from '../../lib/api'
import { Empty, ErrorNote, Loading, displayName } from '../../ui'
import type { Internship } from '../internships/Internships'
import type { Task } from '../internships/TaskDetail'
import { Plans } from './Plans'

/** The Plans page: choose an intern and work on their plan here, without leaving for the internship page. */
export function PlansPage({ call, orgId, role, openTask, taskHref }: {
  call: Call; orgId: string; role: Role
  openTask: (internshipId: string, taskId: string) => void
  taskHref: (internshipId: string, taskId: string, version?: number | null) => string
}) {
  const base = '/api/organizations/' + orgId
  const list = useResource<Internship[]>(call, base + '/internships')
  const open = list.data?.filter(item => !item.closed_at) ?? []
  const [chosen, setChosen] = useState<string>()
  const internship = open.find(item => item.id === chosen) ?? open[0]
  const tasks = useResource<Task[]>(call, internship ? `${base}/internships/${internship.id}/tasks` : null)
  const label = (item: Internship) => role === 'intern'
    ? `${item.program_name} · mentor ${displayName(item.mentor_name, item.mentor_email)}`
    : `${displayName(item.intern_name, item.intern_email)} · ${item.program_name}`

  if (list.error) return <ErrorNote message={list.error} onRetry={list.reload} />
  if (!list.data) return <section className="panel"><Loading rows={3} /></section>
  if (!internship) return <Empty icon="layers" title="No active internships">Plans belong to an internship. They appear here once one is assigned.</Empty>
  return <div className="stack">
    {open.length > 1 && <label className="plan-switch">Plan for
      <select value={internship.id} onChange={event => setChosen(event.target.value)}>
        {open.map(item => <option key={item.id} value={item.id}>{label(item)}</option>)}
      </select></label>}
    <Plans key={internship.id} intern={role === 'intern'} call={call} orgId={orgId} path={`${base}/internships/${internship.id}/plans`}
      internLabel={displayName(internship.intern_name, internship.intern_email)}
      starts={internship.starts_on} ends={internship.ends_on} mentor={role === 'mentor'} admin={role === 'admin'}
      tasks={tasks.data ?? []} refreshTasks={tasks.reload} openTask={taskId => openTask(internship.id, taskId)}
      taskHref={(taskId, version) => taskHref(internship.id, taskId, version)} />
  </div>
}
