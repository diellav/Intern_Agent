import { useRef, useState, type FormEvent } from 'react'
import { useResource, type Call } from '../../lib/api'
import { ErrorNote, Icon } from '../../ui'

type UploadStatus = { configured: boolean; max_bytes: number; extensions: string[] }
type Staged = { id: string; file_name: string; size_bytes: number }
type Item = { key: number; file: File; state: 'uploading' | 'done' | 'error'; staged?: Staged; error?: string }
type Link = { url: string; title: string }

export function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const httpUrl = (value: string) => { try { return ['http:', 'https:'].includes(new URL(value).protocol) } catch { return false } }

/** Description, structured links and files for one submission. Files are staged on the server as soon as they are picked. */
export function SubmissionForm({ call, base, taskId, resubmit, onSent }: {
  call: Call; base: string; taskId: string; resubmit: boolean; onSent: () => void
}) {
  const status = useResource<UploadStatus>(call, `${base}/uploads/status`)
  const [description, setDescription] = useState('')
  const [links, setLinks] = useState<Link[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const counter = useRef(0)
  const picker = useRef<HTMLInputElement>(null)
  const tasks = `${base}/tasks/${taskId}`
  const uploading = items.some(item => item.state === 'uploading')
  const badLink = links.find(link => link.url && !httpUrl(link.url))
  const filledLinks = links.filter(link => link.url.trim())
  const ready = items.filter(item => item.state === 'done')
  const empty = !description.trim() && !filledLinks.length && !ready.length

  function update(key: number, fields: Partial<Item>) {
    setItems(current => current.map(item => item.key === key ? { ...item, ...fields } : item))
  }

  async function send(item: Item) {
    update(item.key, { state: 'uploading', error: undefined })
    try {
      const staged = await call<Staged>(`${tasks}/files?name=${encodeURIComponent(item.file.name)}`, { method: 'POST', body: item.file })
      update(item.key, { state: 'done', staged })
    } catch (failure) {
      update(item.key, { state: 'error', error: failure instanceof Error ? failure.message : 'Upload failed.' })
    }
  }

  function add(files: FileList | null) {
    const limits = status.data
    for (const file of Array.from(files ?? [])) {
      const key = ++counter.current
      const ext = file.name.includes('.') ? '.' + file.name.split('.').pop()!.toLowerCase() : ''
      const problem = !limits ? '' : !limits.extensions.includes(ext) ? 'This file type is not allowed.'
        : file.size > limits.max_bytes ? `Larger than ${fileSize(limits.max_bytes)}.` : file.size === 0 ? 'The file is empty.' : ''
      const item: Item = { key, file, state: problem ? 'error' : 'uploading', error: problem || undefined }
      setItems(current => [...current, item])
      if (!problem) void send(item)
    }
    if (picker.current) picker.current.value = ''
  }

  async function remove(item: Item) {
    setItems(current => current.filter(other => other.key !== item.key))
    if (item.staged) await call(`${tasks}/files/${item.staged.id}`, { method: 'DELETE' }).catch(() => undefined)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (sending || uploading || badLink || empty) return
    setSending(true)
    setError('')
    try {
      await call(`${tasks}/submissions`, { method: 'POST', body: JSON.stringify({
        evidence: description.trim(), links: filledLinks.map(link => ({ url: link.url.trim(), title: link.title.trim() })),
        file_ids: ready.map(item => item.staged!.id),
      }) })
      setDescription(''); setLinks([]); setItems([])
      onSent()
    } catch (failure) {
      setError((failure instanceof Error ? failure.message : 'Could not send your work.') + ' Everything you entered is still here.')
    } finally {
      setSending(false)
    }
  }

  return <form onSubmit={submit} className="submission-form" aria-busy={sending}>
    <h3 className="label">{resubmit ? 'Send an updated version' : 'Submit your work'}</h3>
    <label>Description
      <textarea rows={4} maxLength={6000} value={description} onChange={e => setDescription(e.target.value)}
        placeholder="What did you do, and how can your mentor check it?" /></label>

    <fieldset className="grid gap-2">
      <legend className="label">Links</legend>
      {links.map((link, index) => <div key={index} className="link-input">
        <input type="url" inputMode="url" placeholder="https://…" aria-label={`Link ${index + 1} address`} value={link.url}
          aria-invalid={!!link.url && !httpUrl(link.url)}
          onChange={e => setLinks(links.map((item, i) => i === index ? { ...item, url: e.target.value } : item))} />
        <input placeholder="Title (optional)" aria-label={`Link ${index + 1} title`} maxLength={120} value={link.title}
          onChange={e => setLinks(links.map((item, i) => i === index ? { ...item, title: e.target.value } : item))} />
        <button type="button" className="ghost sm" aria-label={`Remove link ${index + 1}`} onClick={() => setLinks(links.filter((_, i) => i !== index))}>Remove</button>
      </div>)}
      {badLink && <p className="field-error">Links must start with http:// or https://</p>}
      {links.length < 10 && <button type="button" className="secondary sm" style={{ justifySelf: 'start' }} onClick={() => setLinks([...links, { url: '', title: '' }])}>
        <Icon name="plus" size={15} />Add link</button>}
    </fieldset>

    <fieldset className="grid gap-2">
      <legend className="label">Files</legend>
      {status.data && !status.data.configured && <p className="fine">File uploads are not set up on this server yet. Add links or a description instead.</p>}
      {items.length > 0 && <ul className="file-list">{items.map(item => <li key={item.key} className={`file-item ${item.state}`}>
        <Icon name="file" size={16} />
        <span className="grow"><b>{item.file.name}</b><span className="fine">{fileSize(item.file.size)} · {item.state === 'uploading' ? 'Uploading…' : item.state === 'done' ? 'Ready' : item.error}</span></span>
        {item.state === 'uploading' && <span className="btn-spinner dark" aria-label="Uploading" />}
        {item.state === 'error' && status.data?.extensions.includes('.' + item.file.name.split('.').pop()!.toLowerCase()) && item.file.size <= (status.data?.max_bytes ?? 0) &&
          <button type="button" className="ghost sm" onClick={() => void send(item)}>Retry</button>}
        <button type="button" className="ghost sm" disabled={item.state === 'uploading'} onClick={() => void remove(item)} aria-label={`Remove ${item.file.name}`}>Remove</button>
      </li>)}</ul>}
      {status.data?.configured && <div>
        <input ref={picker} type="file" multiple className="sr-only" id={`files-${taskId}`} accept={status.data.extensions.join(',')}
          onChange={e => add(e.target.files)} />
        <label htmlFor={`files-${taskId}`} className="file-drop" tabIndex={0}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); picker.current?.click() } }}>
          <Icon name="plus" size={15} />Add files <span className="fine">PDF, images, text, Office or ZIP · up to {fileSize(status.data.max_bytes)} each</span>
        </label>
      </div>}
    </fieldset>

    {error && <ErrorNote message={error} />}
    <div className="actions">
      <button disabled={sending || uploading || !!badLink || empty}>
        {sending ? <span className="btn-spinner" aria-hidden="true" /> : <Icon name="arrow" size={16} />}
        {sending ? 'Sending…' : uploading ? 'Waiting for uploads…' : resubmit ? 'Send new version' : 'Submit work'}</button>
      {empty && <span className="fine">Add a description, a link or a file.</span>}
    </div>
  </form>
}
