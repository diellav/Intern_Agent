import { useResource, type Call, type Role } from '../../lib/api'
import { ErrorNote, Icon } from '../../ui'
import { OverviewSkeleton, TaskRow, type Queue } from './Overview'

/** Mentor: submissions to review, then work with interns. Intern and admin: open tasks by state. */
export function TaskQueue({ call, orgId, role, openTask }: { call: Call; orgId: string; role: Role; openTask: (internshipId: string, taskId: string) => void }) {
  const queue = useResource<Queue>(call, `/api/organizations/${orgId}/overview`)
  if (queue.error) return <ErrorNote message="Could not load tasks." onRetry={queue.reload} />
  if (!queue.data) return <OverviewSkeleton />
  const items = queue.data.items
  const groups: [string, string, typeof items][] = role === 'mentor'
    ? [['Waiting for your review', 'Oldest first', items.filter(i => i.status === 'submitted')],
       ['Sent back to interns', 'Changes requested', items.filter(i => i.status === 'changes_requested')],
       ['Not started', 'Planned work', items.filter(i => i.status === 'planned')]]
    : [['Needs changes', 'Your mentor asked for changes', items.filter(i => i.status === 'changes_requested')],
       ['To do', 'By deadline', items.filter(i => i.status === 'planned')],
       ['Waiting for review', 'With the mentor', items.filter(i => i.status === 'submitted')]]
  return <div className="stack">
    {queue.data.counts.open > items.length && <p className="fine">Showing the {items.length} most urgent of {queue.data.counts.open} open tasks.</p>}
    {groups.map(([title, hint, list]) => <section key={title} className="panel">
      <header className="panel-head"><div><h2>{title}<span className="count">{list.length}</span></h2><p>{hint}</p></div></header>
      {list.length === 0 ? <p className="empty-line"><Icon name="check" size={16} />Nothing here.</p>
        : <ul className="rows">{list.map(item => <TaskRow key={item.task_id} item={item} showIntern={role !== 'intern'}
          action={role === 'mentor' && item.status === 'submitted' ? 'Review' : undefined}
          onOpen={() => openTask(item.internship_id, item.task_id)} />)}</ul>}
    </section>)}
  </div>
}
