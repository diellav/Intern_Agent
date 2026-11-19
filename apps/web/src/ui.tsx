import { useEffect, useRef, useState, type ReactNode } from 'react'

const paths = {
  close: 'M6 6l12 12M18 6 6 18',
  menu: 'M4 7h16M4 12h16M4 17h16',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8m-7 8a7 7 0 0 1 14 0',
  book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zm0 0v16M8 7h7',
  grid: 'M4 4h7v7H4zm9 0h7v7h-7zM4 13h7v7H4zm9 0h7v7h-7z',
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  briefcase: 'M9 6V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V6m-12 1h18v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zm0 5h18',
  layers: 'm12 3 9 5-9 5-9-5zm-9 9 9 5 9-5m-18 4 9 5 9-5',
  bell: 'M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8m4.3 12a2 2 0 0 0 3.4 0',
  chat: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12',
  logout: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5m5 5H3',
  arrow: 'm9 6 6 6-6 6',
  back: 'm15 6-6 6 6 6',
  plus: 'M12 5v14M5 12h14',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  clock: 'M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  alert: 'M12 8v5m0 3.5v.5M10.3 3.9 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0',
  search: 'm20 20-4.5-4.5M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0',
  refresh: 'M20 11a8 8 0 0 0-14.9-3M4 4v4h4m-4 5a8 8 0 0 0 14.9 3M20 20v-4h-4',
  mail: 'M3 6.5A1.5 1.5 0 0 1 4.5 5h15A1.5 1.5 0 0 1 21 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5zm0 .5 9 6 9-6',
  calendar: 'M7 3v3m10-3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1',
  sparkle: 'M12 3v4m0 10v4M3 12h4m10 0h4M6 6l2.5 2.5m7 7L18 18M6 18l2.5-2.5m7-7L18 6',
  file: 'M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zm0 0v5h5M9 13h6m-6 4h4',
  shield: 'M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6zm-3.5 9 2.5 2.5 4.5-5',
} as const

export type IconName = keyof typeof paths

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return <svg aria-hidden="true" className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>
}

export type Tone = 'neutral' | 'brand' | 'warn' | 'danger' | 'success'

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}

const statusMeta: Record<string, { label: string; tone: Tone }> = {
  planned: { label: 'To do', tone: 'brand' },
  submitted: { label: 'Awaiting review', tone: 'warn' },
  changes_requested: { label: 'Changes requested', tone: 'danger' },
  completed: { label: 'Completed', tone: 'success' },
}

export function StatusBadge({ status }: { status: string }) {
  const meta = statusMeta[status] ?? { label: status, tone: 'neutral' as Tone }
  return <Badge tone={meta.tone}>{meta.label}</Badge>
}

export function formatDate(value: string) {
  const date = value.length === 10 ? new Date(value + 'T12:00:00') : new Date(value)
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })
}

export function relativeDue(value: string) {
  const today = new Date(); today.setHours(12, 0, 0, 0)
  const days = Math.round((new Date(value + 'T12:00:00').getTime() - today.getTime()) / 86400000)
  if (days === 0) return { text: 'Due today', late: false, soon: true }
  if (days === 1) return { text: 'Due tomorrow', late: false, soon: true }
  if (days < 0) return { text: `${-days} day${days === -1 ? '' : 's'} overdue`, late: true, soon: false }
  if (days <= 7) return { text: `Due in ${days} days`, late: false, soon: true }
  return { text: `Due ${formatDate(value)}`, late: false, soon: false }
}

export function Due({ date }: { date: string }) {
  const due = relativeDue(date)
  return <span className={`due ${due.late ? 'due-late' : due.soon ? 'due-soon' : ''}`}><Icon name="clock" size={14} />{due.text}</span>
}

export function Empty({ icon, title, children }: { icon: IconName; title: string; children?: ReactNode }) {
  return <div className="empty">
    <span className="empty-icon"><Icon name={icon} size={22} /></span>
    <strong>{title}</strong>
    {children && <p>{children}</p>}
  </div>
}

export function Loading({ label = 'Loading…', rows = 3 }: { label?: string; rows?: number }) {
  return <div role="status" aria-label={label} className="skeleton-list">
    {Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton" />)}
  </div>
}

export function ErrorNote({ message, onRetry, retryLabel = 'Try again' }: { message: string; onRetry?: () => void; retryLabel?: string }) {
  return <div role="alert" className="notice error">
    <Icon name="alert" />
    <span>{message}</span>
    {onRetry && <button type="button" className="ghost sm" onClick={onRetry}><Icon name="refresh" size={15} />{retryLabel}</button>}
  </div>
}

export function SectionHead({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return <div className="section-head">
    <div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
    {action}
  </div>
}

/** A person's display name: their profile name, or their email when no name is set. */
export function displayName(name?: string | null, email?: string | null) {
  return name?.trim() || email || 'Unknown'
}

export function initials(name?: string | null, email?: string | null) {
  const source = name?.trim()
  if (source) return source.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase()
  return (email ?? '?').slice(0, 1).toUpperCase()
}

export function Avatar({ name, email, size = 'md' }: { name?: string | null; email?: string | null; size?: 'sm' | 'md' | 'lg' }) {
  return <span className={`avatar avatar-${size}`} aria-hidden="true">{initials(name, email)}</span>
}

/** Name first, email as secondary identification. */
export function Person({ name, email, detail, size = 'md' }: { name?: string | null; email?: string | null; detail?: ReactNode; size?: 'sm' | 'md' | 'lg' }) {
  return <span className="person">
    <Avatar name={name} email={email} size={size} />
    <span className="person-text">
      <span className="person-name">{displayName(name, email)}</span>
      {(detail ?? (name ? email : null)) && <span className="person-detail">{detail ?? email}</span>}
    </span>
  </span>
}

export function Progress({ done, total, label }: { done: number; total: number; label?: string }) {
  const percent = total ? Math.round((done / total) * 100) : 0
  return <span className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}
    aria-label={label ?? `${done} of ${total} done`}>
    <span className="meter-fill" style={{ width: `${percent}%` }} />
  </span>
}

/** Accessible dialog on top of the native <dialog>: focus stays inside, Escape closes, focus returns to the opener. */
export function Modal({ open, title, description, onClose, children, footer, wide = false }: {
  open: boolean; title: string; description?: ReactNode; onClose: () => void
  children: ReactNode; footer?: ReactNode; wide?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const opener = useRef<Element | null>(null)
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) {
      opener.current = document.activeElement
      dialog.showModal()
      // Prefer an explicitly marked field, then the first form field, then any button except Close.
      const first = dialog.querySelector<HTMLElement>('[data-autofocus]') ?? dialog.querySelector<HTMLElement>('input, textarea, select')
        ?? dialog.querySelector<HTMLElement>('button:not(.modal-close)')
      first?.focus()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])
  useEffect(() => () => { if (opener.current instanceof HTMLElement) opener.current.focus() }, [])
  return <dialog ref={ref} className={`modal ${wide ? 'modal-wide' : ''}`} aria-labelledby="modal-title"
    onCancel={event => { event.preventDefault(); onClose() }}
    onClose={() => { if (opener.current instanceof HTMLElement) opener.current.focus() }}
    onClick={event => { if (event.target === ref.current) onClose() }}>
    {open && <div className="modal-body">
      <header className="modal-head">
        <div><h2 id="modal-title">{title}</h2>{description && <p>{description}</p>}</div>
        <button type="button" className="ghost sm modal-close" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
      </header>
      <div className="modal-content">{children}</div>
      {footer && <footer className="modal-foot">{footer}</footer>}
    </div>}
  </dialog>
}


type ConfirmRequest = { message: string; confirmLabel: string; danger: boolean; resolve: (ok: boolean) => void }
let showConfirm: ((request: ConfirmRequest) => void) | null = null

/** In-app confirmation. Browser confirm() dialogs can be blocked silently, which made buttons look broken. */
export function confirmAction(message: string, confirmLabel = 'Confirm', danger = false): Promise<boolean> {
  return new Promise(resolve => showConfirm ? showConfirm({ message, confirmLabel, danger, resolve }) : resolve(true))
}

/** Mount once near the root. */
export function ConfirmHost() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null)
  useEffect(() => { showConfirm = setRequest; return () => { showConfirm = null } }, [])
  const finish = (ok: boolean) => { request?.resolve(ok); setRequest(null) }
  return <Modal open={!!request} onClose={() => finish(false)} title="Please confirm">
    <div className="grid gap-4">
      <p className="prose-text">{request?.message}</p>
      <div className="modal-actions">
        <button type="button" className="ghost" onClick={() => finish(false)}>Cancel</button>
        <button type="button" className={request?.danger ? 'danger-btn' : undefined} data-autofocus onClick={() => finish(true)}>{request?.confirmLabel}</button>
      </div>
    </div>
  </Modal>
}
