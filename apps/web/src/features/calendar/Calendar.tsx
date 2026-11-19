import { useMemo, useState } from 'react'
import { useResource, type Call, type Role } from '../../lib/api'
import { ErrorNote, Icon, StatusBadge, displayName } from '../../ui'

type Deadline = {
  task_id: string; title: string; status: string; due_on: string; estimated_hours: number | null
  internship_id: string; program: string; intern_name: string | null; intern_email: string | null
}

const day = new Intl.DateTimeFormat('sv-SE')
const shift = (date: Date, days: number) => { const next = new Date(date); next.setDate(next.getDate() + days); return next }
function startOfWeek(date: Date) { const d = new Date(date); d.setHours(12, 0, 0, 0); return shift(d, -((d.getDay() + 6) % 7)) }

/** An agenda of deadlines, two weeks at a time, grouped by day. It reads well on any width. */
export function Calendar({ call, orgId, role, openTask }: { call: Call; orgId: string; role: Role; openTask: (internshipId: string, taskId: string) => void }) {
  const [anchor, setAnchor] = useState(() => startOfWeek(new Date()))
  const [hideDone, setHideDone] = useState(true)
  const end = shift(anchor, 13)
  const range = useResource<Deadline[]>(call, `/api/organizations/${orgId}/calendar?start=${day.format(anchor)}&end=${day.format(end)}`)
  const today = day.format(new Date())
  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => day.format(shift(anchor, i))), [anchor])
  const byDay = new Map<string, Deadline[]>()
  for (const item of range.data ?? []) if (!hideDone || item.status !== 'completed') byDay.set(item.due_on, [...(byDay.get(item.due_on) ?? []), item])
  const label = (value: string) => new Date(value + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
  const span = `${new Date(days[0] + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${new Date(days[13] + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`
  const visibleDays = days.filter(value => byDay.has(value) || value === today)

  return <div className="stack">
    <div className="toolbar">
      <div className="toolbar-group">
        <button className="secondary sm" onClick={() => setAnchor(shift(anchor, -14))} aria-label="Previous two weeks"><Icon name="back" size={15} /></button>
        <button className="secondary sm" onClick={() => setAnchor(startOfWeek(new Date()))}>Today</button>
        <button className="secondary sm" onClick={() => setAnchor(shift(anchor, 14))} aria-label="Next two weeks"><Icon name="arrow" size={15} /></button>
        <strong className="toolbar-title">{span}</strong>
      </div>
      <label className="check-inline"><input type="checkbox" checked={hideDone} onChange={e => setHideDone(e.target.checked)} />Hide completed</label>
    </div>
    {range.error && <ErrorNote message={range.error} onRetry={range.reload} />}
    {!range.data && !range.error && <div className="agenda">{[0, 1, 2].map(i => <div key={i} className="skeleton" style={{ height: '5rem' }} />)}</div>}
    {range.data && <ol className="agenda">
      {visibleDays.length === 0 && <li className="empty-line">No deadlines in these two weeks.</li>}
      {visibleDays.map(value => <li key={value} className={`agenda-day ${value === today ? 'today' : ''} ${value < today ? 'past' : ''}`}>
        <div className="agenda-date">
          <span className="agenda-dow">{new Date(value + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short' })}</span>
          <span className="agenda-num">{Number(value.slice(8))}</span>
        </div>
        <div className="agenda-items">
          <p className="agenda-label">{value === today ? 'Today · ' : ''}{label(value)}</p>
          {(byDay.get(value) ?? []).length === 0 && <p className="fine">Nothing due today.</p>}
          {(byDay.get(value) ?? []).map(item => <button key={item.task_id} className="agenda-item" onClick={() => openTask(item.internship_id, item.task_id)}>
            <span className="row-primary"><span className="row-title">{item.title}</span>
              <span className="row-sub">{[role !== 'intern' && displayName(item.intern_name, item.intern_email), item.program, item.estimated_hours ? `${Number(item.estimated_hours)} h` : null].filter(Boolean).join(' · ')}</span></span>
            <StatusBadge status={item.status} />
          </button>)}
        </div>
      </li>)}
    </ol>}
  </div>
}
