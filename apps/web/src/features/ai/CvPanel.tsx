import { useRef, useState } from 'react'
import { useResource, type Call } from '../../lib/api'
import { ErrorNote, Icon, Loading, confirmAction } from '../../ui'
import { AiVote } from './AiUsage'

export type Analysis = {
  starter_tasks?: { title: string; criteria: string; day: number; jira_key?: string | null; why?: string }[]
  project_fit?: { project_id: string; project_name: string; fit: 'strong' | 'partial' | 'weak'; why?: string; reason?: string }[]
  learn_first?: string[]; title: string; goal: string
}
type CvStatus = { consented_at: string | null; analysis: Analysis | null }

/** The assigned mentor uploads the intern's CV, analyses it and turns it into a starting plan. Interns don't see this panel. */
export function CvPanel({ call, org, path, startPlan, onAnalyzed }: {
  call: Call; org: string; path: string; startPlan?: (draft: Analysis) => void; onAnalyzed?: () => void
}) {
  const cv = useResource<CvStatus>(call, path)
  const [file, setFile] = useState<File | null>(null)
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [usage, setUsage] = useState<string>()
  const running = useRef(false)
  async function run(label: string, action: () => Promise<void>) {
    if (running.current) return
    running.current = true
    setBusy(label)
    setError('')
    try { await action(); cv.reload() } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not complete this action.')
    } finally { running.current = false; setBusy('') }
  }
  if (cv.error) return <ErrorNote message={cv.error} onRetry={cv.reload} />
  if (!cv.data) return <section className="panel"><Loading rows={2} /></section>
  const analysis = cv.data.analysis
  return <section className="panel learning-profile">
    <header className="panel-head"><div><h2>Fit from the intern’s CV</h2>
      <p>How the intern fits the project, and which Jira issues suit them. Matching issues appear under “Where the intern can start”. Contact details are removed before AI; only you see this.</p></div></header>
    {!cv.data.consented_at && <div className="stack" style={{ gap: 'var(--s-3)' }}>
      <input className="feature-upload" type="file" aria-label="Choose the intern’s CV" accept=".pdf,.docx" onChange={event => {
        const picked = event.target.files?.[0] ?? null
        const supported = !picked || /\.(pdf|docx)$/i.test(picked.name)
        setError(supported ? '' : 'Choose a PDF (.pdf) or Word (.docx) file. Other formats, including .doc, are not supported.')
        setFile(supported ? picked : null)
      }} />
      <label className="feature-consent"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} />
        The intern agreed that their CV may be analysed with AI to prepare their plan.</label>
      <div className="actions"><button type="button" disabled={!file || !consent || Boolean(busy)} onClick={() => run('Uploading CV…', async () => {
        if (!file) return
        const name = file.name.toLowerCase()
        const mime = name.endsWith('.pdf') ? 'application/pdf'
          : name.endsWith('.docx') ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : ''
        if (!mime) throw new Error('Choose a PDF (.pdf) or Word (.docx) file.')
        await call(path + '?consent=true', { method: 'PUT', body: new Blob([file], { type: mime }) })
        setFile(null)
      })}>{busy === 'Uploading CV…' && <span className="btn-spinner" aria-hidden="true" />}{busy === 'Uploading CV…' ? 'Uploading CV…' : 'Upload CV'}</button></div>
    </div>}
    {cv.data.consented_at && <div className="actions">
      <span className="muted">CV uploaded {new Date(cv.data.consented_at).toLocaleDateString()}.</span>
      <button type="button" disabled={Boolean(busy)} onClick={() => run('Analyzing CV…', async () => {
        const result = await call<Analysis & { ai_usage_id?: string }>(path + '/analyze', { method: 'POST' })
        setUsage(result.ai_usage_id)
        onAnalyzed?.()
      })}>{busy === 'Analyzing CV…' ? <span className="btn-spinner" aria-hidden="true" /> : <Icon name="sparkle" size={16} />}
        {busy === 'Analyzing CV…' ? 'Analyzing CV…' : analysis ? 'Analyze again' : 'Analyze CV'}</button>
      <button className="ghost danger-text" type="button" disabled={Boolean(busy)} onClick={async () => {
        if (!await confirmAction('Delete the intern’s CV and its analysis? This cannot be undone.', 'Delete CV', true)) return
        void run('Deleting CV…', async () => { await call(path, { method: 'DELETE' }); setUsage(undefined); setConsent(false) })
      }}>Delete CV</button>
    </div>}
    {analysis && <div className="assist cv-result">
      {analysis.project_fit?.length ? <ul className="fit-list">{analysis.project_fit.map(fit => <li key={fit.project_id}>
        <span className="fit-head"><b>{fit.project_name}</b><span className={fit.fit === 'strong' ? 'pill success' : fit.fit === 'partial' ? 'pill warn' : 'pill'}>{fit.fit} fit</span></span>
        <p>{fit.why ?? fit.reason}</p>
      </li>)}</ul> : <p className="fine">Add company projects to see how this CV fits them.</p>}
      {!!analysis.learn_first?.length && <p className="fine"><b>Learn first:</b> {analysis.learn_first.join(' · ')}</p>}
      {!!analysis.starter_tasks?.length && <div className="assist-block">
        <h4>Proposed tasks</h4>
        <ol className="proposed-tasks">{analysis.starter_tasks.map((task, index) => <li key={index}>
          <span className="fit-head"><b>{task.title}</b>{task.jira_key && <span className="pill muted-pill">{task.jira_key}</span>}</span>
          {task.why && <p className="fine">{task.why}</p>}
        </li>)}</ol>
      </div>}
      {startPlan && <div className="actions"><button type="button" onClick={() => startPlan(analysis)}><Icon name="arrow" size={16} />Open in plan editor</button></div>}
      <AiVote key={usage} call={call} org={org} id={usage} />
    </div>}
    {error && <ErrorNote message={error} />}
  </section>
}
