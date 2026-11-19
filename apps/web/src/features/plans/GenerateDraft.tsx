import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useResource, type Call } from '../../lib/api'
import { ErrorNote, Icon } from '../../ui'
import { offset, type Draft, type DraftNotes, type Workload } from './PlanEditor'

export type Generated = { ai_usage_id?: string; draft: Draft; notes: DraftNotes; workload: Workload; warnings: string[]; model: string }
export type GenerateRequest = {
  starts_on: string; ends_on: string; goal: string; total_hours: string
  project: string; schedule_notes: string; instructions: string
}
type Suggestion = { focus: string; source: string; task_id: string; version: number | null }

function longDate(value: string) {
  return new Date(value + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}

function periodSummary(start: string, end: string) {
  if (!start || !end || end < start) return 'Choose a start and an end date.'
  const days = Math.round((new Date(end + 'T12:00:00').getTime() - new Date(start + 'T12:00:00').getTime()) / 86400000) + 1
  return `${longDate(start)} – ${longDate(end)} · ${days} day${days === 1 ? '' : 's'}`
}

/** Waiting status for a single provider call. Only elapsed time is shown, because there are no real steps to report. */
function Waiting({ onStop }: { onStop: () => void }) {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setSeconds(value => value + 1), 1000)
    return () => clearInterval(timer)
  }, [])
  return <div className="waiting" role="status" aria-live="polite">
    <span className="btn-spinner dark" aria-hidden="true" />
    <span>Waiting for the AI draft · {seconds}s{seconds >= 20 ? '. Longer periods can take up to a minute.' : ''}</span>
    <button type="button" className="ghost sm" onClick={onStop}>Stop waiting</button>
    <p className="fine waiting-note">Stop waiting only stops this browser from waiting. The server may still finish the request, but nothing is saved until you save the plan.</p>
  </div>
}

/** Collects the mentor's intent and asks the server for an AI draft. The result opens in the plan editor. */
export function GenerateDraft({ call, path, starts, ends, defaultStart, initial, onDraft, onManual, onCancel }: {
  call: Call; path: string; starts: string; ends: string; defaultStart: string; initial?: GenerateRequest
  onDraft: (result: Generated, request: GenerateRequest) => void; onManual: (request: GenerateRequest) => void; onCancel: () => void
}) {
  const initialEnd = offset(defaultStart, 6)
  const [request, setRequest] = useState<GenerateRequest>(initial ?? {
    starts_on: defaultStart, ends_on: initialEnd > ends ? ends : initialEnd, goal: '', total_hours: '',
    project: '', schedule_notes: '', instructions: '',
  })
  const suggestions = useResource<Suggestion[]>(call, path + '/suggestions')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const active = useRef<AbortController | null>(null)
  useEffect(() => () => active.current?.abort(), [])
  const set = (fields: Partial<GenerateRequest>) => setRequest(current => ({ ...current, ...fields }))

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (active.current) return  // one request at a time
    const controller = new AbortController()
    active.current = controller
    setPending(true)
    setError('')
    try {
      const result = await call<Generated>(path + '/generate', {
        method: 'POST', signal: controller.signal,
        body: JSON.stringify({ ...request, total_hours: request.total_hours ? Number(request.total_hours) : null }),
      })
      if (!controller.signal.aborted) onDraft(result, request)
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Could not generate a draft.')
    } finally {
      if (active.current === controller) {
        active.current = null
        setPending(false)
      }
    }
  }

  function stopWaiting() {
    active.current?.abort()
    active.current = null
    setPending(false)
    setError('Stopped waiting. Your entries are kept. Generate again when you are ready.')
  }

  const presets = ([[7, '1 week'], [14, '2 weeks'], [30, '30 days']] as const).map(([days, label]) => {
    const proposed = offset(request.starts_on, days - 1)
    return { label, end: proposed > ends ? ends : proposed }
  })
  return <form onSubmit={submit} className="ai-form" aria-busy={pending}>
    <fieldset disabled={pending} className="ai-form-body">
      <section className="form-section">
        <h3>Period</h3>
        <div className="chip-row" role="group" aria-label="Period length">
          {presets.map(preset => <button key={preset.label} type="button" className="chip" aria-pressed={request.ends_on === preset.end}
            onClick={() => set({ ends_on: preset.end })}>{preset.label}</button>)}
        </div>
        <div className="date-pair">
          <label>Start<input type="date" min={starts} max={ends} required value={request.starts_on} onChange={e => set({ starts_on: e.target.value })} /></label>
          <label>End<input type="date" min={request.starts_on || starts} max={ends} required value={request.ends_on} onChange={e => set({ ends_on: e.target.value })} /></label>
        </div>
        <p className="period-summary"><Icon name="calendar" size={14} />{periodSummary(request.starts_on, request.ends_on)}</p>
      </section>

      <section className="form-section">
        <h3>Focus</h3>
        <label className="sr-only" htmlFor="draft-focus">Focus for this period</label>
        <textarea id="draft-focus" data-autofocus required maxLength={1000} rows={3} value={request.goal} onChange={e => set({ goal: e.target.value })}
          placeholder="What should this period achieve? e.g. Finish form validation and cover it with tests" />
        {!!suggestions.data?.length && <div className="suggestions">
          <p className="label">Suggested from open work · pick one to fill the focus, then edit it</p>
          <ul>{suggestions.data.map(item => <li key={item.task_id + item.source}>
            <button type="button" className="suggestion" aria-pressed={request.goal === item.focus} onClick={() => set({ goal: item.focus })}>
              <span>{item.focus}</span><span className="suggestion-source"><Icon name="file" size={13} />{item.source}</span>
            </button>
          </li>)}</ul>
        </div>}
      </section>

      <section className="form-section">
        <h3>Workload</h3>
        <label className="hours-field">Total hours for the period <span>(optional)</span>
          <input type="number" inputMode="decimal" min="0.5" max="1000" step="0.5" value={request.total_hours}
            onChange={e => set({ total_hours: e.target.value })} placeholder="e.g. 20" /></label>
        <details className="more-options">
          <summary>Project, schedule and instructions</summary>
          <div className="grid gap-3" style={{ marginTop: '.75rem' }}>
            <label>Project<input maxLength={120} value={request.project} onChange={e => set({ project: e.target.value })} placeholder="Contact form sandbox" /></label>
            <label>Schedule constraints<input maxLength={300} value={request.schedule_notes} onChange={e => set({ schedule_notes: e.target.value })} placeholder="No work on Friday" /></label>
            <label>Instructions for the draft<textarea maxLength={500} rows={2} value={request.instructions} onChange={e => set({ instructions: e.target.value })}
              placeholder="Keep tasks small. Include one task about documentation." /></label>
          </div>
        </details>
      </section>
    </fieldset>

    <footer className="ai-form-foot">
      {error && <ErrorNote message={error} />}
      {pending && <Waiting onStop={stopWaiting} />}
      <div className="actions actions-end">
        <button type="button" className="ghost" onClick={onCancel}>Cancel</button>
        <button type="button" className="secondary" disabled={pending} onClick={() => onManual(request)}>Write it myself</button>
        <button aria-disabled={pending} className={pending ? 'is-busy' : undefined}>
          {pending ? <span className="btn-spinner" aria-hidden="true" /> : <Icon name="sparkle" size={16} />}
          {pending ? 'Preparing draft…' : error ? 'Try again' : 'Generate draft'}
        </button>
      </div>
    </footer>
  </form>
}
