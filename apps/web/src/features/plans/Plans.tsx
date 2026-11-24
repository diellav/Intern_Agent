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

export function Plans({ call, orgId, path, starts, ends, mentor, admin = false, tasks, openTask, refreshTasks, taskHref, internLabel, intern }: {
  admin?: boolean; intern?: boolean; call: Call; orgId: string; path: string; starts: string; ends: string; mentor: boolean; tasks: PlanTask[]; internLabel: string
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
  const [cardError, setCardError] = useState<{ id: string; message: string } | null>(null)
  const [phase, setPhase] = useState<'saving' | 'publishing'>('saving')
  const [receipt, setReceipt] = useState<Plan | null>(null)
  const running = useRef(false)
  const saved = useRef<{ draft: Draft; plan: Plan } | null>(null)
  const today = new Intl.DateTimeFormat('sv-SE').format(new Date())
  const publishedPlans = (plans.data ?? []).filter(plan => plan.published_at)
  const continuing = publishedPlans.length > 0
  const lastEnd = publishedPlans.reduce((latest, plan) => plan.ends_on > latest ? plan.ends_on : latest, '')
  const nextDay = lastEnd ? offset(lastEnd, 1) : today
  const suggestedStart = continuing && nextDay > today && nextDay <= ends ? nextDay : today
  const startDate = suggestedStart < starts ? starts : suggestedStart > ends ? ends : suggestedStart
  const counts = {
    completed: tasks.filter(task => task.status === 'completed').length,
    remaining: tasks.filter(task => task.status === 'planned' || task.status === 'changes_requested').length,
    review: tasks.filter(task => task.status === 'submitted').length,
  }

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
        <button className="secondary" disabled={pending || !plans.data} onClick={() => blank()}><Icon name="plus" size={16} />Write plan</button>
        <button disabled={pending || !plans.data || !ai.data?.configured} onClick={() => { setError(''); setGenerating(true) }}
          title={ai.data && !ai.data.configured ? 'AI drafting is not configured on the server' : undefined}><Icon name="sparkle" size={16} />{continuing ? "Plan next period" : "Create first plan"}</button>
      </div>}
    </header>
    {mentor && plans.data && <details className="starting-profile" open={!continuing}>
      <summary><Icon name="user" size={16} /><span>Starting profile</span><span className="fine">{continuing ? 'CV and initial recommendations' : 'Optional context for the first plan'}</span><Icon name="arrow" size={14} /></summary>
      <CvPanel call={call} org={orgId} path={path.replace(/\/plans$/, "/cv")} startPlan={continuing ? undefined : startFromCv} />
    </details>}
    {mentor && continuing && !draft && <div className="planning-context">
      <div><h3>Build on the last period</h3><p>The next plan uses recorded work, feedback and current project priorities.</p></div>
      <div className="planning-counts">
        <span><b>{counts.completed}</b> completed</span><span><b>{counts.remaining}</b> unfinished</span><span><b>{counts.review}</b> awaiting review</span>
      </div>
      {counts.review > 0 && <p className="planning-review"><Icon name="clock" size={15} />Review pending submissions before assigning dependent work.</p>}
    </div>}
    {mentor && !draft && ai.data && !ai.data.configured && <p className="fine">AI drafting is off on this server. You can still write plans manually.</p>}
    {mentor && ai.error && !draft && <p className="fine">Could not check whether AI drafting is available.</p>}
    <Modal open={generating} wide onClose={() => setGenerating(false)} title={`${continuing ? "Plan the next period" : "Create the first plan"} for ${internLabel}`}
      description={continuing ? "Uses recorded progress, feedback and unfinished work. Review the draft before assigning it." : "Uses the saved starting profile when available, the project and your goals."}>
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
            {cardError?.id === plan.id && <ErrorNote message={cardError.message} />}
            {(mentor || admin) && <div className="actions actions-end">
              <button className="ghost danger-text" disabled={pending} onClick={async () => {
                if (!await confirmAction(`Delete the draft “${plan.title}”? Nothing was assigned yet, so no tasks are removed.`, 'Delete draft', true)) return
                setCardError(null)
                setPending(true)
                try {
                  await call(path + '/' + plan.id, { method: 'DELETE' })
                  plans.setData(current => current?.filter(item => item.id !== plan.id) ?? current)
                } catch (failure) {
                  setCardError({ id: plan.id, message: failure instanceof Error ? failure.message : 'Could not delete the draft.' })
                } finally { setPending(false) }
              }}>Delete draft</button>
              {mentor && <button className="secondary" disabled={pending || !!draft} onClick={() => edit(plan)}>Edit draft</button>}
              {mentor && <button disabled={pending || !!draft} onClick={() => publish(plan)}>
                {pending && phase === 'publishing' ? <span className="btn-spinner" aria-hidden="true" /> : <Icon name="check" size={16} />}
                {pending && phase === 'publishing' ? 'Assigning tasks…' : 'Approve and assign'}</button>}
            </div>}
          </>}
        </li>
      })}</ul>
    </details>)}
  </section>
}
