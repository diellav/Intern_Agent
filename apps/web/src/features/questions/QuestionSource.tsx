import { type Call, useResource } from '../../lib/api'
import { ErrorNote } from '../../ui'

export function QuestionSource({ call, org, source }: {
  call: Call; org: string; source?: string
}) {
  const allowed = source && /^[\da-f-]{36}\/(answer|note)\/[\da-f-]{36}$/i.test(source)
  const [task, kind, id] = allowed ? source.split('/') : []
  const result = useResource<{ title: string; body: string }>(call, allowed
    ? '/api/organizations/' + org + '/tasks/' + task + '/questions/sources/' + kind + '/' + id : null)
  if (!allowed) return <p>Source not found.</p>
  if (result.error) return <ErrorNote message={result.error} onRetry={result.reload} />
  if (!result.data) return <p role="status">Loading source…</p>
  return <article className="feature-panel feature-stack source-reading">
    <h2>{result.data.title}</h2>
    <p className="prose-text">{result.data.body}</p>
    <a className="feature-text-link" href="#/questions">Open Q&A</a>
  </article>
}
