import { useState, type FormEvent } from 'react'
import { useResource, type Call, type Role } from '../../lib/api'
import { Empty, ErrorNote, Icon, Loading, confirmAction } from '../../ui'

type Issue = { key: string; summary: string; type: string; status: string; status_category?: string; module: string | null }
export type JiraWork = {
  configured: boolean; browse_url: string | null; linked: boolean
  project: { id: string; name: string; jira_key: string | null; jira_synced_at: string | null } | null
  issues: Issue[]; suggestions: (Issue & { why: string; source: string })[]
  counts: { done: number; in_progress: number; to_do: number }
}

const tone = (category?: string) => category === 'done' ? 'pill success' : category === 'indeterminate' ? 'pill warn' : 'pill muted-pill'

/** One intern's work, as it lives in Jira: what they have, where they can start, and assigning it there. */
export function InternJira({ call, base, internshipId, role, mentor, closed, onProjectNeeded }: {
  call: Call; base: string; internshipId: string; role: Role; mentor: boolean; closed: boolean; onProjectNeeded?: () => void
}) {
  const path = `${base}/internships/${internshipId}`
  const work = useResource<JiraWork>(call, path + '/jira-work')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const data = work.data
  const link = (key: string) => data?.browse_url ? <a href={data.browse_url + key} target="_blank" rel="noreferrer">{key}</a> : <b>{key}</b>

  async function send(label: string, url: string, init: RequestInit) {
    if (busy) return
    setBusy(label); setError('')
    try { work.setData(await call<JiraWork>(url, init)) }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Jira did not accept the change.') }
    finally { setBusy('') }
  }
  async function assign(key: string) {
    if (!await confirmAction(`Assign ${key} to the intern in Jira? They will see it on the board right away.`, 'Assign in Jira')) return
    await send(key, path + '/jira-work/assign', { method: 'POST', body: JSON.stringify({ issue_key: key }) })
  }
  function linkAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const email = String(new FormData(event.currentTarget).get('email') || '').trim()
    void send('link', path + '/jira-account', { method: 'PUT', body: JSON.stringify({ email: email || null }) })
  }

  if (work.error) return <ErrorNote message={work.error} onRetry={work.reload} />
  if (!data) return <section className="panel"><Loading rows={4} /></section>
  if (!data.configured) return <section className="panel"><p className="fine">Jira is not configured on the server. Ask an admin to add the Jira settings.</p></section>
  if (!data.project || !data.project.jira_key) return <section className="panel"><Empty icon="layers" title="Link a project with a Jira board">
    Choose the intern’s project above. The project needs a Jira key so the assistant can read its board.
    {onProjectNeeded && <button className="link-btn" onClick={onProjectNeeded}>Open projects</button>}</Empty></section>

  const total = data.counts.done + data.counts.in_progress + data.counts.to_do
  return <div className="stack">
    {error && <ErrorNote message={error} />}
    {!data.linked && !mentor ? <section className="panel"><p className="fine">The intern’s Jira account isn’t linked yet. Their mentor links it here.</p></section>
    : !data.linked ? <section className="panel">
      <header className="panel-head"><div><h2>Link the intern’s Jira account</h2>
        <p>Enter the email the intern uses in Jira. Only their Jira account ID is kept.</p></div></header>
      <form className="inline-form" onSubmit={linkAccount}>
        <input name="email" type="email" required placeholder="intern@company.com" aria-label="Intern’s Jira email" />
        <button disabled={busy === 'link'}>{busy === 'link' ? <span className="btn-spinner" aria-hidden="true" /> : <Icon name="check" size={16} />}Link account</button>
      </form>
    </section> : <section className="panel">
      <header className="panel-head">
        <div><h2>Work in Jira · {data.project.name}</h2>
          <p>{total ? `${data.counts.done} done · ${data.counts.in_progress} in progress · ${data.counts.to_do} to do` : 'Nothing assigned to the intern in Jira yet.'}
            {data.project.jira_synced_at && ` · synced ${new Date(data.project.jira_synced_at).toLocaleTimeString()}`}</p></div>
        <div className="actions">
          <button className="ghost sm" disabled={Boolean(busy)} onClick={work.reload}><Icon name="refresh" size={15} />Refresh</button>
          {mentor && <button className="ghost sm" disabled={Boolean(busy)} onClick={async () => {
            if (await confirmAction('Unlink the intern’s Jira account? Their Jira issues stay in Jira.', 'Unlink'))
              void send('link', path + '/jira-account', { method: 'PUT', body: JSON.stringify({ email: null }) })
          }}>Unlink</button>}
        </div>
      </header>
      {total > 0 && <ul className="rows">{data.issues.map(issue => <li key={issue.key} className="issue-row">
        <span className="row-primary"><span className="row-title">{link(issue.key)} {issue.summary}</span>
          <span className="row-sub">{issue.type}{issue.module ? ` · ${issue.module}` : ''}</span></span>
        <span className={tone(issue.status_category)}>{issue.status}</span>
      </li>)}</ul>}
    </section>}

    <section className="panel">
      <header className="panel-head"><div><h2>Where the intern can start</h2>
        <p>Open, unassigned issues from the board analysis. Assigning happens in Jira.</p></div></header>
      {data.suggestions.length === 0 ? <p className="fine">No suggestions right now. Sync the project in Projects to analyse the board again.</p>
        : <ul className="rows">{data.suggestions.map(issue => <li key={issue.key} className="issue-row">
          <span className="row-primary"><span className="row-title">{link(issue.key)} {issue.summary}</span>
            <span className="row-sub">{issue.why} <span className="fine">· {issue.source}</span></span></span>
          {mentor && data.linked && !closed && <button className="secondary sm" disabled={Boolean(busy)} onClick={() => assign(issue.key)}>
            {busy === issue.key ? <span className="btn-spinner" aria-hidden="true" /> : <Icon name="plus" size={15} />}Assign in Jira</button>}
        </li>)}</ul>}
      {mentor && !data.linked && data.suggestions.length > 0 && <p className="fine">Link the intern’s Jira account to assign these.</p>}
    </section>

  </div>
}
