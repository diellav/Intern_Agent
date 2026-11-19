import { useState } from 'react'
import { useResource, type Call } from '../../lib/api'
import { ErrorNote, Icon, Loading, formatDate, type IconName } from '../../ui'

type Notice = {
  id: string
  event: 'assigned' | 'submitted' | 'completed' | 'changes_requested' | 'plan_published'
  title: string
  internship_id: string
  task_id: string | null
  plan_id: string | null
  created_at: string
  read_at: string | null
  version?: number | null
}

const meta: Record<Notice['event'], { label: string; icon: IconName; tone: string }> = {
  assigned: { label: 'New task assigned', icon: 'plus', tone: 'tone-brand' },
  submitted: { label: 'Work submitted for review', icon: 'file', tone: 'tone-warn' },
  completed: { label: 'Submission approved', icon: 'check', tone: 'tone-success' },
  changes_requested: { label: 'Changes requested', icon: 'refresh', tone: 'tone-danger' },
  plan_published: { label: 'New plan published', icon: 'calendar', tone: 'tone-brand' },
}

function when(value: string) {
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} min ago`
  if (minutes < 1440) return `${Math.round(minutes / 60)} h ago`
  return formatDate(value)
}

export function Notifications({ call, orgId, openTask, openPlan, onRead, compact = false }: {
  call: Call; orgId: string; openTask: (internshipId: string, taskId: string, version?: number) => void
  openPlan: (internshipId: string) => void; onRead: () => void; compact?: boolean
}) {
  const [unreadOnly, setUnreadOnly] = useState(false)
  const path = `/api/organizations/${orgId}/notifications`
  const inbox = useResource<Notice[]>(call, unreadOnly ? path + '?unread=true' : path)
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState('')

  async function open(item: Notice) {
    setPending(item.id)
    setError('')
    try {
      if (!item.read_at) {
        const { read_at } = await call<{ read_at: string }>(`${path}/${item.id}/read`, { method: 'POST' })
        inbox.setData(items => items?.map(notice => notice.id === item.id ? { ...notice, read_at } : notice) ?? null)
        onRead()
      }
      if (item.task_id) openTask(item.internship_id, item.task_id, item.version ?? undefined)
      else openPlan(item.internship_id)
    } catch {
      setError('Could not open the notification. Try again.')
      setPending(null)
    }
  }

  const items = compact ? inbox.data?.slice(0, 5) : inbox.data
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  const buckets = new Map<string, Notice[]>()
  for (const item of items ?? []) {
    const day = new Date(item.created_at).toDateString()
    const group = day === today.toDateString() ? 'Today' : day === yesterday.toDateString() ? 'Yesterday' : 'Earlier'
    buckets.set(group, [...(buckets.get(group) ?? []), item])
  }
  const unreadCount = items?.filter(item => !item.read_at).length ?? 0
  return <section className="panel inbox">
    {!compact && <header className="panel-head">
      <div className="segmented" role="group" aria-label="Inbox view">
        <button type="button" aria-pressed={!unreadOnly} onClick={() => setUnreadOnly(false)}>All</button>
        <button type="button" aria-pressed={unreadOnly} onClick={() => setUnreadOnly(true)}>Unread{!unreadOnly && unreadCount ? <span className="seg-count">{unreadCount}</span> : null}</button>
      </div>
      <button className="ghost sm" disabled={pending !== null} onClick={inbox.reload}><Icon name="refresh" size={15} />Refresh</button>
    </header>}
    {(error || inbox.error) && <ErrorNote message={error || 'Could not load notifications.'} onRetry={error ? undefined : inbox.reload} />}
    {!items && !inbox.error && <Loading rows={compact ? 2 : 4} />}
    {items?.length === 0 && <p className="empty-line"><Icon name="bell" size={16} />{unreadOnly ? 'No unread notifications.' : 'You’re all caught up.'}</p>}
    {[...buckets].map(([label, group]) => <section className="inbox-day" key={label}>
      <h3>{label}</h3>
      <ul>{group.map(item => {
        const kind = meta[item.event]
        return <li key={item.id}>
          <button className={`inbox-row ${item.read_at ? 'read' : 'unread'}`} aria-disabled={pending !== null} onClick={() => { if (pending === null) void open(item) }}>
            <span className={`inbox-icon ${kind.tone}`} aria-hidden="true"><Icon name={kind.icon} size={16} /></span>
            <span className="row-primary">
              <span className="row-title">{item.title}{item.version ? <span className="version-tag">v{item.version}</span> : null}</span>
              <span className="row-sub">{kind.label}{item.version ? ` · version ${item.version}` : ''}</span>
            </span>
            <time className="muted" dateTime={item.created_at}>{when(item.created_at)}</time>
            {item.read_at ? <span className="sr-only">Read</span> : <span className="unread-dot" aria-label="Unread" />}
          </button>
        </li>
      })}</ul>
    </section>)}
    {!compact && !!items?.length && <p className="fine">The 50 most recent are listed. Opening one marks it read.</p>}
  </section>
}

