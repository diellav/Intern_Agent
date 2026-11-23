import { AiVote } from '../ai/AiUsage'
import { CvPanel, type Analysis } from '../ai/CvPanel'
import { useRef, useState, type FormEvent } from 'react'
import { useResource, type Call } from '../../lib/api'
import { Badge, Empty, ErrorNote, Icon, Loading, Modal, formatDate, type Tone, confirmAction } from '../../ui'
import { PlanEditor, offset, type Draft, type DraftNotes, type NewTask, type PlanTask } from './PlanEditor'
import { GenerateDraft, type Generated, type GenerateRequest } from './GenerateDraft'

type Plan = Omit<Draft, 'carry' | 'new_tasks'> & {
  id: string; revision: number; published_at: string | null; task_ids: string[]
  draft: { carry: PlanTask[]; new_tasks: NewTask[] }
}

export function Plans({ call, orgId, path, starts, ends, mentor, tasks, openTask, refreshTasks, taskHref, internLabel, intern }: {
  intern?: boolean; call: Call; orgId: string; path: string; starts: string; ends: string; mentor: boolean; tasks: PlanTask[]; internLabel: string
  openTask: (id: string) => void; refreshTasks: () => void; taskHref: (taskId: string, version?: number | null) => string
}) {
  const plans = useResource<Plan[]>(call, path)
  const ai = useResource<{ configured: boolean; model: string | null }>(call, mentor ? `/api/organizations/${orgId}/ai/status` : null)
  const [generating, setGenerating] = useState(false)
  const [generated, setGenerated] = useState<Generated | null>(null)
  const [lastRequest, setLastRequest] = useState<GenerateRequest | undefined>()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [notes, setNotes] = useState<DraftNotes | null>(null)
  const [editing, setEditing] = useState<Plan | null>(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [phase, setPhase] = useState<'saving' | 'publishing'>('saving')
  const [receipt, setReceipt] = useState<Plan | null>(null)
  const running = useRef(false)
  const saved = useRef<{ draft: Draft; plan: Plan } | null>(null)
  const today = new Intl.DateTimeFormat('sv-SE').format(new Date())
  const startDate = today < starts ? starts : today > ends ? ends : today

  function open(next: Draft, plan: Plan | null = null, nextNotes: DraftNotes | null = null) {
    saved.current = null
    setGenerating(false)
    setEditing(plan)
    setNotes(nextNotes)
    setError('')
    setDraft(next)
  }

  function edit(plan: Plan) {
    open({
      title: plan.title, goal: plan.goal, project: plan.project, starts_on: plan.starts_on, ends_on: plan.ends_on,
      carry: plan.draft.carry.map(task => task.id), new_tasks: plan.draft.new_tasks,
    }, plan)
  }

  function blank(seed?: Partial<Draft>) {
    const end = offset(startDate, 6)
    setGenerated(null)
    open({ title: '', goal: '', project: '', starts_on: startDate, ends_on: end > ends ? ends : end, carry: [], new_tasks: [], ...seed })
  }

  function startFromCv(analysis: Analysis) {
    const newTasks = (analysis.starter_tasks ?? []).map(task => {
      const due = offset(startDate, task.day - 1)
      return { title: task.title, criteria: task.criteria, due_on: due > ends ? ends : due, jira_key: task.jira_key ?? null }
    })
    blank({ title: analysis.title, goal: analysis.goal, new_tasks: newTasks })
  }

  function close() {
    setDraft(null)
    setNotes(null)
    setGenerated(null)
  }

  async function run(action: () => Promise<void>) {
    if (running.current) return
    running.current = true
    setPending(true)
    setError('')
    try { await action() }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not save plan.') }
    finally { running.current = false; setPending(false) }
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draft) return
    const publishNow = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'publish'
    void run(async () => {
      setPhase(publishNow ? 'publishing' : 'saving')
      const cached = saved.current
      let plan: Plan
      if (cached && cached.draft === draft) {
        plan = cached.plan
      } else {
        plan = await call<Plan>(editing ? path + '/' + editing.id : path, {
          method: editing ? 'PUT' : 'POST',
          body: JSON.stringify({ ...draft, ...(editing ? { revision: editing.revision } : {}) }),
        })
        saved.current = { draft, plan }
        setEditing(plan)
      }
      if (publishNow) await publishSaved(plan)
      close()
      plans.reload()
    })
  }

  async function publishSaved(plan: Plan) {
    setPhase('publishing')
    const published = await call<Plan>(path + '/' + plan.id + '/publish', {
      method: 'POST', body: JSON.stringify({ revision: plan.revision }),
    })
    setReceipt(published)
    refreshTasks()
  }

  function publish(plan: Plan) {
    void run(async () => {
      await publishSaved(plan)
      plans.reload()
    })
  }

  const status = (plan: Plan): [string, Tone] => !plan.published_at ? ['Draft', 'neutral']
    : today < plan.starts_on ? ['Upcoming', 'brand'] : today > plan.ends_on ? ['Past', 'neutral'] : ['Active', 'success']
  const groups: [string, Plan[]][] = (['Draft', 'Active', 'Upcoming', 'Past'] as const)
    .map(label => [label === 'Draft' ? 'Drafts' : label, (plans.data ?? []).filter(plan => status(plan)[0] === label)] as [string, Plan[]])
    .filter(([, list]) => list.length > 0)
  const taskOf = (id: string) => tasks.find(task => task.id === id)

  function byDay(ids: string[]) {
    const days = new Map<string, string[]>()
    for (const id of ids) {
      const due = taskOf(id)?.due_on ?? ''
      days.set(due, [...(days.get(due) ?? []), id])
    }
    return [...days.entries()].sort(([a], [b]) => (a || '9999').localeCompare(b || '9999'))
  }

  return <section className="panel plans" aria-label="Plans">
    <header className="panel-head">
      
      <div><h2>Plans</h2><p>{mentor ? 'Draft the next period with AI or by hand, review it, then approve to assign the tasks.' : 'Plans your mentor has published.'}</p></div>
      {mentor && !draft && <div className="actions">
        <button className="secondary" disabled={pending} onClick={() => blank()}><Icon name="plus" size={16} />Write plan</button>
        <button disabled={pending || !ai.data?.configured} onClick={() => { setError(''); setGenerating(true) }}
          title={ai.data && !ai.data.configured ? 'AI drafting is not configured on the server' : undefined}><Icon name="sparkle" size={16} />Generate draft</button>
      </div>}
    </header>
    {mentor && <CvPanel call={call} org={orgId} path={path.replace(/\/plans$/, "/cv")} startPlan={startFromCv} />}
    {mentor && !draft && ai.data && !ai.data.configured && <p className="fine">AI drafting is off on this server. You can still write plans manually.</p>}
    {mentor && ai.error && !draft && <p className="fine">Could not check whether AI drafting is available.</p>}
    <Modal open={generating} wide onClose={() => setGenerating(false)} title={`Draft the next period for ${internLabel}`}
      description="Based on this internship’s open tasks, reviews and shared notes. Files are not sent. Nothing is saved or assigned until you approve.">
      <GenerateDraft call={call} path={path} starts={starts} ends={ends} defaultStart={startDate} initial={lastRequest}
        onCancel={() => setGenerating(false)}
        onManual={request => { setLastRequest(request); blank({ starts_on: request.starts_on, ends_on: request.ends_on, goal: request.goal, project: request.project }) }}
        onDraft={(result, request) => { setReceipt(null); setLastRequest(request); setGenerated(result); open(result.draft, null, result.notes) }} />
    </Modal>
    {error && <ErrorNote message={error} retryLabel="Reload plans" onRetry={() => { setError(''); plans.reload() }} />}
    {plans.error && <ErrorNote message={plans.error} onRetry={plans.reload} />}
    {!plans.data && !plans.error && <Loading rows={2} />}
    {draft && <PlanEditor draft={draft} setDraft={setDraft} notes={notes} setNotes={setNotes} starts={starts} ends={ends} tasks={tasks}
      heading={editing ? 'Edit draft' : generated ? 'Review the AI draft' : 'New plan'} pending={pending} phase={phase} onSave={save} onCancel={close}
      workload={generated?.workload} warnings={generated?.warnings} taskHref={taskHref}
      banner={generated && <div className="notice ai-banner" role="status">
        <Icon name="sparkle" />
        <AiVote key={generated.ai_usage_id} call={call} org={orgId} id={generated.ai_usage_id} />
        <span>Drafted by {generated.model}. Check each task and edit what you need. Nothing is assigned until you approve.
          {' '}<button type="button" className="link-btn" onClick={() => { close(); setGenerating(true) }}>Change inputs and generate again</button></span>
      </div>} />}
    {plans.data?.length === 0 && !draft && <Empty icon="calendar" title="No plans yet">
      {mentor ? 'Generate a draft for the next week or two, or write one yourself.' : 'Your mentor hasn’t shared a plan yet.'}</Empty>}
    {receipt && <div role="status" className="notice success-note">
      <Icon name="check" />
      <span><b>“{receipt.title}” is published.</b> {receipt.draft.new_tasks.length} new task{receipt.draft.new_tasks.length === 1 ? '' : 's'} assigned,
        {' '}{receipt.draft.carry.length} carried. The intern has been notified.</span>
      <button type="button" className="ghost sm" onClick={() => setReceipt(null)}>Dismiss</button>
    </div>}
    {groups.map(([label, list]) => <details key={label} className="plan-group" open={label !== 'Past'}>
      <summary><span>{label}</span><span className="count">{list.length}</span></summary>
      <ul className="plan-list">{list.map(plan => {
        const [state, tone] = status(plan)
        return <li key={plan.id} id={'plan-' + plan.id} className="plan-card">
          <header className="plan-card-head">
            <div>
              <h3>{plan.title}</h3>
              <p className="row-sub"><Icon name="calendar" size={14} />{formatDate(plan.starts_on)} – {formatDate(plan.ends_on)}{plan.project && ' · ' + plan.project}</p>
            </div>
            <Badge tone={tone}>{state}</Badge>
          </header>
          <p className="plan-goal">{plan.goal}</p>
          {plan.published_at ? <ol className="plan-days">{byDay(plan.task_ids).map(([due, ids]) => <li key={due || 'none'}>
            <time className="plan-day">{due ? new Date(due + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) : 'No date'}</time>
            <div className="plan-day-tasks">{ids.map(id => <button key={id} className="plan-task-link" onClick={() => openTask(id)}>
              <span>{taskOf(id)?.title ?? 'Open task'}</span><Icon name="arrow" size={15} /></button>)}</div>
          </li>)}</ol> : <>
            <ul className="draft-items">
              {plan.draft.carry.map(task => <li key={task.id}><Badge>Carried</Badge><span className="grow">{task.title}</span><span className="muted">{formatDate(task.due_on)}</span></li>)}
              {plan.draft.new_tasks.map((task, i) => <li key={i}><Badge tone="brand">New</Badge>
                <span className="grow"><b>{task.title}</b><span className="row-sub">{task.criteria}</span></span><span className="muted">{formatDate(task.due_on)}</span></li>)}
            </ul>
            {mentor && <div className="actions actions-end">
              <button className="ghost danger-text" disabled={pending || !!draft} onClick={async () => {
                if (!await confirmAction(`Delete the draft “${plan.title}”? Nothing was assigned yet, so no tasks are removed.`, 'Delete draft', true)) return
                void run(async () => { await call(path + '/' + plan.id, { method: 'DELETE' }); plans.reload() })
              }}>Delete draft</button>
              <button className="secondary" disabled={pending || !!draft} onClick={() => edit(plan)}>Edit draft</button>
              <button disabled={pending || !!draft} onClick={() => publish(plan)}>
                {pending && phase === 'publishing' ? <span className="btn-spinner" aria-hidden="true" /> : <Icon name="check" size={16} />}
                {pending && phase === 'publishing' ? 'Assigning tasks…' : 'Approve and assign'}</button>
            </div>}
          </>}
        </li>
      })}</ul>
    </details>)}
  </section>
}
