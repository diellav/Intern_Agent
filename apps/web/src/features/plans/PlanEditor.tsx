import type { FormEvent, ReactNode } from 'react'
import { formatDate, Icon } from '../../ui'

export type PlanTask = { id: string; title: string; due_on: string; status: string; estimated_hours?: number | null }
export type NewTask = { title: string; criteria: string; due_on: string; estimated_hours?: number | null }
export type Draft = { title: string; goal: string; project: string; starts_on: string; ends_on: string; carry: string[]; new_tasks: NewTask[] }
export type Evidence = { task_id: string; title: string; version: number | null; review: string | null }
export type ItemNote = { reason: string; hours: number | null; evidence: Evidence[]; confirm: string[] }
/** Explanations from an AI proposal, shown next to items. Never saved with the plan. */
export type DraftNotes = { carry: Record<string, ItemNote>; new_tasks: (ItemNote | undefined)[] }
export type Workload = { budget: number | null; known_hours: number; unknown_count: number; over_budget: boolean }

export function offset(date: string, days: number) {
  const value = new Date(date + 'T12:00:00Z')
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

const reviewLabel: Record<string, string> = { changes_requested: 'changes requested', completed: 'approved' }

function Why({ note, taskHref }: { note?: ItemNote; taskHref: (taskId: string, version?: number | null) => string }) {
  if (!note) return null
  return <div className="why">
    <p><Icon name="sparkle" size={13} /><span><b>Why:</b> {note.reason}</span></p>
    {note.evidence.length > 0 && <p className="fine">Evidence:{' '}
      {note.evidence.map((item, index) => <span key={item.task_id}>{index > 0 && ', '}
        <a href={taskHref(item.task_id, item.version)} target="_blank" rel="noopener noreferrer">
          {item.title}{item.version ? ` · version ${item.version}` : ''}{item.review ? ` (${reviewLabel[item.review] ?? item.review})` : ''}
        </a></span>)}</p>}
    {note.confirm.map(text => <p key={text} className="confirm"><Icon name="alert" size={13} />{text}</p>)}
  </div>
}

function WorkloadBar({ workload, draft, notes }: { workload: Workload; draft: Draft; notes: DraftNotes | null }) {
  // Recompute from the current draft so edits and removals are reflected.
  const hours = [...draft.carry.map(id => notes?.carry[id]?.hours ?? null), ...draft.new_tasks.map(task => task.estimated_hours ?? null)]
  const known = hours.reduce<number>((sum, value) => sum + (value ?? 0), 0)
  const unknown = hours.filter(value => value === null || value === undefined).length
  const budget = workload.budget
  const over = budget !== null && known > budget
  return <div className={`workload ${over ? 'over' : ''}`}>
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <strong>{known.toLocaleString()} h estimated{budget !== null ? ` of ${budget.toLocaleString()} h available` : ''}</strong>
      <span className="fine">{unknown ? `${unknown} task${unknown === 1 ? '' : 's'} without an estimate` : 'Every task has an estimate'}</span>
    </div>
    {budget !== null && <div className="progress"><span style={{ width: `${Math.min(100, budget ? (known / budget) * 100 : 0)}%` }} /></div>}
    {over && <p className="confirm"><Icon name="alert" size={13} />Over the available hours. Remove or shorten tasks, or confirm the extra time.</p>}
  </div>
}

export function PlanEditor({ draft, setDraft, notes, setNotes, workload, warnings, starts, ends, tasks, heading, banner, pending, phase, taskHref, onSave, onCancel }: {
  draft: Draft; setDraft: (draft: Draft) => void
  notes: DraftNotes | null; setNotes: (notes: DraftNotes | null) => void
  workload?: Workload | null; warnings?: string[]
  starts: string; ends: string; tasks: PlanTask[]
  heading: string; banner?: ReactNode; pending: boolean; phase: 'saving' | 'publishing'
  taskHref: (taskId: string, version?: number | null) => string
  onSave: (event: FormEvent<HTMLFormElement>) => void; onCancel: () => void
}) {
  const open = tasks.filter(task => task.status !== 'completed' || draft.carry.includes(task.id))
  const carried = open.filter(task => draft.carry.includes(task.id))
  const available = open.filter(task => !draft.carry.includes(task.id))
  const attention = [
    ...(warnings ?? []),
    ...carried.flatMap(task => (notes?.carry[task.id]?.confirm ?? []).map(text => `${task.title}: ${text}`)),
    ...draft.new_tasks.flatMap((task, index) => (notes?.new_tasks[index]?.confirm ?? []).map(text => `${task.title || 'New task'}: ${text}`)),
  ]
  const removeTask = (index: number) => {
    setDraft({ ...draft, new_tasks: draft.new_tasks.filter((_, position) => position !== index) })
    if (notes) setNotes({ ...notes, new_tasks: notes.new_tasks.filter((_, position) => position !== index) })
  }
  const toggle = (id: string, on: boolean) => setDraft({ ...draft, carry: on ? [...draft.carry, id] : draft.carry.filter(item => item !== id) })
  const empty = !draft.carry.length && !draft.new_tasks.length

  return <form onSubmit={onSave} className="plan-editor">
    <fieldset disabled={pending} className="grid gap-5">
      <div className="section-head"><h3>{heading}</h3></div>
      {banner}
      {workload && <WorkloadBar workload={workload} draft={draft} notes={notes} />}
      {attention.length > 0 && <div className="attention">
        <p className="label">Needs your attention ({attention.length})</p>
        <ul>{attention.map(text => <li key={text}>{text}</li>)}</ul>
      </div>}

      <div className="grid gap-3">
        <label>Title<input required maxLength={120} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} placeholder="Week 3: authentication" /></label>
        <label>Goal<textarea required maxLength={3000} rows={3} value={draft.goal} onChange={e => setDraft({ ...draft, goal: e.target.value })} /></label>
        <div className="plan-dates">
          <label>Start<input type="date" min={starts} max={ends} required value={draft.starts_on} onChange={e => setDraft({ ...draft, starts_on: e.target.value })} /></label>
          <label>End<input type="date" min={draft.starts_on || starts} max={ends} required value={draft.ends_on} onChange={e => setDraft({ ...draft, ends_on: e.target.value })} /></label>
          <label>Project <span>(optional)</span><input maxLength={120} value={draft.project} onChange={e => setDraft({ ...draft, project: e.target.value })} /></label>
        </div>
      </div>

      <section className="editor-section">
        <h4>Carried work <span className="fine">({carried.length})</span></h4>
        {carried.length === 0 && <p className="fine">No open tasks carried into this plan.</p>}
        {carried.map(task => <div key={task.id} className="plan-task carried">
          <label className="check-line"><input type="checkbox" checked onChange={() => toggle(task.id, false)} />
            <span className="grow"><b>{task.title}</b><span className="fine">Due {formatDate(task.due_on)}{task.status !== 'completed' && draft.ends_on && task.due_on < draft.starts_on ? ` → moves to ${formatDate(draft.ends_on)} when approved` : ''}{notes?.carry[task.id]?.hours ? ` · ${notes.carry[task.id].hours} h left` : ''}</span></span></label>
          <Why note={notes?.carry[task.id]} taskHref={taskHref} />
        </div>)}
        {available.length > 0 && <details className="more-options">
          <summary>Add other open tasks ({available.length})</summary>
          <div className="grid gap-2" style={{ marginTop: '.5rem' }}>{available.map(task => <label key={task.id} className="check-row">
            <input type="checkbox" checked={false} onChange={() => toggle(task.id, true)} />
            <span className="grow">{task.title}</span><span className="fine">{formatDate(task.due_on)}</span>
          </label>)}</div>
        </details>}
      </section>

      <section className="editor-section">
        <h4>New tasks <span className="fine">({draft.new_tasks.length})</span></h4>
        {draft.new_tasks.map((task, index) => {
          const update = (fields: Partial<NewTask>) => setDraft({ ...draft, new_tasks: draft.new_tasks.map((item, position) => position === index ? { ...item, ...fields } : item) })
          return <div className="plan-task" key={index}>
            <Why note={notes?.new_tasks[index]} taskHref={taskHref} />
            <label>Task title<input required maxLength={120} value={task.title} onChange={e => update({ title: e.target.value })} /></label>
            <label>Acceptance criteria<textarea required maxLength={3000} rows={3} value={task.criteria} onChange={e => update({ criteria: e.target.value })} /></label>
            <div className="plan-dates">
              <label>Due date<input type="date" required min={draft.starts_on} max={draft.ends_on} value={task.due_on} onChange={e => update({ due_on: e.target.value })} /></label>
              <label>Estimated hours <span>(optional)</span><input type="number" inputMode="decimal" min="0.5" max="200" step="0.5"
                value={task.estimated_hours ?? ''} onChange={e => update({ estimated_hours: e.target.value ? Number(e.target.value) : null })} /></label>
            </div>
            <button type="button" className="ghost sm danger-text" style={{ justifySelf: 'start' }} onClick={() => removeTask(index)}>Remove task</button>
          </div>
        })}
        <button type="button" className="secondary sm" style={{ justifySelf: 'start' }} disabled={draft.new_tasks.length >= 30} onClick={() => {
          setDraft({ ...draft, new_tasks: [...draft.new_tasks, { title: '', criteria: '', due_on: draft.ends_on, estimated_hours: null }] })
          if (notes) setNotes({ ...notes, new_tasks: [...notes.new_tasks, undefined] })
        }}><Icon name="plus" size={15} />Add task</button>
      </section>

      <div className="divider" />
      <div className="actions actions-end">
        <button type="button" className="ghost" onClick={onCancel}>Cancel</button>
        <button className="secondary" value="save" disabled={empty}>
          {pending && phase === 'saving' && <span className="btn-spinner" aria-hidden="true" />}{pending && phase === 'saving' ? 'Saving draft…' : 'Save for later'}</button>
        <button value="publish" disabled={empty}>
          {pending && phase === 'publishing' && <span className="btn-spinner" aria-hidden="true" />}{pending && phase === 'publishing' ? 'Assigning tasks…' : 'Approve and assign'}</button>
      </div>
      <p className="fine" style={{ textAlign: 'right' }}>{empty ? 'Add or carry at least one task.' : 'Approving saves the plan, assigns new tasks and notifies the intern.'}</p>
    </fieldset>
  </form>
}
