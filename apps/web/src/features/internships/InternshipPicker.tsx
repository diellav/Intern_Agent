import { useEffect } from 'react'
import { useResource, type Call, type Role } from '../../lib/api'
import { Empty, ErrorNote, Icon, Person, Progress } from '../../ui'

type Internship = { id: string; program_name: string; intern_name?: string | null; intern_email: string | null
  mentor_name?: string | null; mentor_email: string | null; task_count: number; completed_count: number }

/** Plans and notes belong to one internship. With a single internship the picker steps aside. */
export function InternshipPicker({ call, orgId, role, purpose, open }: {
  call: Call; orgId: string; role: Role; purpose: 'plan' | 'notes'; open: (internshipId: string, replace?: boolean) => void
}) {
  const list = useResource<Internship[]>(call, `/api/organizations/${orgId}/internships`)
  const only = list.data?.length === 1 ? list.data[0].id : null
  // Replace the history entry so Back does not bounce into this forward again.
  useEffect(() => { if (only) open(only, true) }, [only, open])

  if (list.error) return <ErrorNote message={list.error} onRetry={list.reload} />
  if (!list.data || only) return <div className="picker-grid">{[0, 1, 2].map(i => <div key={i} className="skeleton" style={{ height: '7.5rem', borderRadius: 'var(--r-lg)' }} />)}</div>
  if (list.data.length === 0) return <Empty icon="briefcase" title="No internships yet">{role === 'intern' ? 'You’ll see your internship once an admin assigns it.' : 'Internships appear here once they are assigned.'}</Empty>
  return <div className="stack">
    <p className="lead">Choose an internship to open its {purpose === 'plan' ? 'plan' : 'notes'}.</p>
    <ul className="picker-grid">{list.data.map(item => <li key={item.id}>
      <button className="pick-card" onClick={() => open(item.id)}>
        <Person name={role === 'intern' ? item.mentor_name : item.intern_name} email={role === 'intern' ? item.mentor_email : item.intern_email}
          detail={item.program_name} size="lg" />
        <span className="pick-progress"><Progress done={item.completed_count} total={item.task_count} /><span>{item.completed_count}/{item.task_count} tasks done</span></span>
        <span className="pick-action">{purpose === 'plan' ? 'Open plan' : 'Open notes'}<Icon name="arrow" size={16} /></span>
      </button>
    </li>)}</ul>
  </div>
}
