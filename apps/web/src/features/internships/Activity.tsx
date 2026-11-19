import { useResource, type Call } from '../../lib/api'
import { ErrorNote, Icon, Loading, formatDate, type IconName } from '../../ui'

type Event = { kind: 'plan' | 'submission' | 'review'; title: string; occurred_at: string; task_id: string | null; version: number | null }
const meta: Record<Event['kind'], { label: string; icon: IconName }> = {
  plan: { label: 'Plan published', icon: 'calendar' },
  submission: { label: 'Work submitted', icon: 'file' },
  review: { label: 'Mentor review', icon: 'check' },
}

export function Activity({ call, path, open }: { call: Call; path: string; open: (event: Event) => void }) {
  const activity = useResource<Event[]>(call, path)
  return <section className="panel">
    <header className="panel-head"><div><h2>Activity</h2><p>Plans, submissions and reviews, newest first.</p></div></header>
    {activity.error && <ErrorNote message={activity.error} onRetry={activity.reload} />}
    {!activity.data && !activity.error && <Loading />}
    {activity.data?.length === 0 && <p className="empty-line"><Icon name="clock" size={16} />No activity yet.</p>}
    <ol className="activity-list">{activity.data?.map((event, index) => <li key={index}>
      <button className="activity-row" onClick={() => open(event)}>
        <span className={`activity-dot ${event.kind}`} aria-hidden="true"><Icon name={meta[event.kind].icon} size={14} /></span>
        <span className="row-primary">
          <span className="row-title">{event.title}</span>
          <span className="row-sub">{meta[event.kind].label}{event.version ? ` · Version ${event.version}` : ''}</span>
        </span>
        <time className="muted" dateTime={event.occurred_at}>{formatDate(event.occurred_at)}</time>
      </button>
    </li>)}</ol>
  </section>
}
