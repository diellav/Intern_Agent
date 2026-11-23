import { AiUsage } from '../features/ai/AiUsage'
import { ProgressReports } from '../features/progress/ProgressReports'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, useResource, type Call, type Membership, type Role } from '../lib/api'
import { Avatar, ErrorNote, Icon, Modal, displayName, type IconName, ConfirmHost } from '../ui'
import { JiraOverview } from '../features/jira/JiraOverview'
import { Internships } from '../features/internships/Internships'
import { InternshipPicker } from '../features/internships/InternshipPicker'
import { Members } from '../features/members/Members'
import { Programs } from '../features/programs/Programs'
import { Projects } from '../features/projects/Projects'
import { Notifications } from '../features/notifications/Notifications'
import { Calendar } from '../features/calendar/Calendar'
import { TaskQueue } from '../features/overview/TaskQueue'
import { formatView, parseView, type Tab, type View } from './routes'
import { Brand, PRODUCT } from './Brand'

export type { Tab, View } from './routes'
export type Navigate = (view: View, options?: { replace?: boolean }) => void
export type Me = { full_name: string | null; email: string }

type NavItem = { id: Tab; label: string; icon: IconName; title: string; blurb: string }
type NavGroup = { label: string; items: NavItem[] }

function navigation(role: Role): NavGroup[] {
  const item = (id: Tab, label: string, icon: IconName, blurb: string, title = label): NavItem => ({ id, label, icon, title, blurb })
  // Jira assistant: projects and interns. Plans, in-app tasks and reviews, notes, Q&A, calendar, progress reports
  // and notifications are frozen (code and data kept, hidden from navigation) while the concept is validated.
  const groups: NavGroup[] = [
    { label: 'Workspace', items: [
      item('overview', 'Overview', 'home', role === 'intern' ? 'Your project and where your work lives.' : 'Your interns and how their Jira work is moving.'),
      ...(role !== 'intern' ? [item('internships', 'Interns', 'user', role === 'admin' ? 'Every intern, their project and Jira work.' : 'Your interns: assign work in Jira and see its progress.')] : []),
      item('projects', 'Projects', 'briefcase', role === 'intern' ? 'The company project you are working on.' : 'Company projects, their Jira boards and where interns can help.'),
    ] },
  ]
  if (role === 'admin') groups.push({ label: 'Management', items: [
    item('assignments', 'Assignments', 'plus', 'Pair interns with mentors and a project.'),
    item('members', 'Members', 'user', 'Invite people and manage organization access.'),
    item('programs', 'Programs', 'grid', 'Intern cohorts.'),
    item('ai-usage', 'AI usage', 'layers', 'Review AI requests and feedback.'),
  ] })
  return groups
}

const mobileTabs: Tab[] = ['overview', 'internships', 'projects']
const SHOW_NOTIFICATIONS = false  // frozen with in-app tasks; Slack will carry Jira updates

/** Counts requests in flight so the top bar can show that something is happening. */
function useActivity(call: Call) {
  const [active, setActive] = useState(0)
  const tracked = useCallback(<T,>(path: string, init?: RequestInit) => {
    setActive(n => n + 1)
    return call<T>(path, init).finally(() => setActive(n => n - 1))
  }, [call]) as Call
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (!active) { setVisible(false); return }
    const timer = setTimeout(() => setVisible(true), 150)  // no flicker for quick requests
    return () => clearTimeout(timer)
  }, [active])
  return { call: tracked, busy: visible }
}

function NameDialog({ open, me, call, onClose, onSaved }: { open: boolean; me: Me; call: Call; onClose: () => void; onSaved: (name: string) => void }) {
  const [name, setName] = useState(me.full_name ?? '')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending || !name.trim()) return
    setPending(true)
    setError('')
    try {
      const saved = await call<{ full_name: string }>('/api/me/profile', { method: 'PUT', body: JSON.stringify({ full_name: name.trim() }) })
      onSaved(saved.full_name)
      onClose()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save your name.')
    } finally {
      setPending(false)
    }
  }
  return <Modal open={open} onClose={onClose} title="Your display name" description="Shown to people who already work with you. Your email stays the same.">
    <form id="name-form" onSubmit={save} className="grid gap-3">
      <label>Full name<input autoFocus maxLength={120} value={name} onChange={e => setName(e.target.value)} placeholder="First and last name" /></label>
      {error && <ErrorNote message={error} />}
      <div className="modal-actions">
        <button type="button" className="ghost" onClick={onClose}>Cancel</button>
        <button disabled={pending || !name.trim()}>{pending && <span className="btn-spinner" aria-hidden="true" />}{pending ? 'Saving…' : 'Save name'}</button>
      </div>
    </form>
  </Modal>
}

export function Workspace({ session, call: rawCall, memberships, me: initialMe }: { session: Session; call: Call; memberships: Membership[]; me: Me }) {
  const { call, busy } = useActivity(rawCall)
  const [selected, setSelected] = useState(memberships[0].organization_id)
  const membership = memberships.find(item => item.organization_id === selected) ?? memberships[0]
  const org = membership.organization_id
  const role = membership.role
  const [me, setMe] = useState(initialMe)
  const [view, setView] = useState<View>(() => parseView(location.hash))
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const notificationArea = useRef<HTMLDivElement>(null)
  const bell = useRef<HTMLButtonElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [nameOpen, setNameOpen] = useState(false)
  const [signOutError, setSignOutError] = useState('')
  const unread = useResource<{ unread: number }>(call, `/api/organizations/${org}/notifications/unread-count`)
  const reloadUnread = unread.reload
  const lastTab = useRef(view.tab)
  const groups = navigation(role)
  const items = groups.flatMap(group => group.items)

  const navigate = useCallback<Navigate>((next, options) => {
    const hash = formatView(next)
    if (hash !== location.hash) history[options?.replace ? 'replaceState' : 'pushState'](null, '', hash)
    setNotificationsOpen(false)
    setView(next)
    setMoreOpen(false)
    setMenuOpen(false)
  }, [])

  useEffect(() => {
    // Back/Forward fire popstate; a hash typed or pasted into the address bar fires hashchange.
    const sync = () => { setNotificationsOpen(false); setView(parseView(location.hash)) }
    window.addEventListener('popstate', sync)
    window.addEventListener('hashchange', sync)
    return () => { window.removeEventListener('popstate', sync); window.removeEventListener('hashchange', sync) }
  }, [])
  useEffect(() => { window.scrollTo({ top: 0 }) }, [view])
  useEffect(() => {
    if (lastTab.current !== view.tab) reloadUnread()
    lastTab.current = view.tab
  }, [view.tab, reloadUnread])
  useEffect(() => {
    if (!menuOpen) return
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !(event.target as Element).closest('.user-menu')) setMenuOpen(false)
    }
    document.addEventListener('click', close)
    document.addEventListener('keydown', close)
    return () => { document.removeEventListener('click', close); document.removeEventListener('keydown', close) }
  }, [menuOpen])

  useEffect(() => {
    if (!notificationsOpen) return
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !notificationArea.current?.contains(event.target)) setNotificationsOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setNotificationsOpen(false); bell.current?.focus() }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [notificationsOpen])
  const current = items.find(item => item.id === view.tab)
    ?? { id: view.tab, label: 'Notifications', icon: 'bell' as IconName, title: 'Notifications', blurb: 'Everything addressed to you, newest first.' }
  useEffect(() => { document.title = `${current.title} · ${PRODUCT}` }, [current.title])
  const openTask = (internshipId: string, taskId: string, version?: number) => navigate({ tab: 'internships', internshipId, section: 'tasks', taskId, version })
  const openSection = useCallback((internshipId: string, section: 'plan' | 'notes' | 'tasks', replace = false) =>
    navigate({ tab: 'internships', internshipId, section }, { replace }), [navigate])
  const count = unread.data?.unread ?? 0
  const countLabel = count > 99 ? '99+' : String(count)
  const showHeading = !(view.tab === 'internships' && view.internshipId)
  const switcher = memberships.length > 1 && <select aria-label="Organization" value={org} onChange={event => {
    setSelected(event.target.value)
    navigate({ tab: 'overview' })
  }}>{memberships.map(item => <option key={item.organization_id} value={item.organization_id}>{item.organization_name} · {item.role}</option>)}</select>
  const navButton = (item: NavItem) => <button key={item.id + item.label} className="nav-item" aria-current={view.tab === item.id ? 'page' : undefined}
    onClick={() => navigate({ tab: item.id })}><Icon name={item.icon} /><span>{item.label}</span></button>

  async function signOut() {
    const result = await supabase?.auth.signOut()
    setSignOutError(result?.error ? 'Could not sign out. Try again.' : '')
    if (!result?.error) history.replaceState(null, '', location.pathname)
  }

  return <div className="shell">
    <header className="topbar">
      <a className="brand-link" href="#/overview" onClick={event => { event.preventDefault(); navigate({ tab: 'overview' }) }} aria-label="Overview">
        <Brand />
      </a>
      <div className="topbar-actions">
        {signOutError && <span className="fine" role="alert">{signOutError}</span>}
        {SHOW_NOTIFICATIONS && <div className="notification-anchor" ref={notificationArea}>
          <button ref={bell} className="icon-btn bell" aria-label={count ? `Notifications, ${count} unread` : 'Notifications'}
            aria-expanded={notificationsOpen} aria-controls={notificationsOpen ? 'notification-preview' : undefined}
            onClick={() => { setMenuOpen(false); setNotificationsOpen(open => !open); reloadUnread() }}>
            <Icon name="bell" size={20} />{count > 0 && <span className="bell-count" aria-hidden="true">{countLabel}</span>}
          </button>
          {notificationsOpen && <section id="notification-preview" className="notification-preview" aria-label="Recent notifications">
            <header><h2>Notifications</h2><span className="fine">{count} unread</span></header>
            <div className="notification-preview-list">
              <Notifications compact call={call} orgId={org} openTask={openTask} openPlan={id => openSection(id, 'plan')} onRead={reloadUnread} />
            </div>
            <footer><button className="link-btn" onClick={() => {
              navigate({ tab: 'notifications' })
              document.getElementById('main')?.focus()
            }}>See all notifications <Icon name="arrow" size={15} /></button></footer>
          </section>}
        </div>}
        <div className="user-menu">
          <button className="user-button" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(open => !open)}>
            <Avatar name={me.full_name} email={me.email} />
            <span className="user-text"><b>{displayName(me.full_name, me.email)}</b><span>{role}</span></span>
          </button>
          {menuOpen && <div className="menu" role="menu">
            <div className="menu-head"><b>{displayName(me.full_name, me.email)}</b><span>{me.email}</span></div>
            <button role="menuitem" onClick={() => { setMenuOpen(false); setNameOpen(true) }}><Icon name="user" size={16} />{me.full_name ? 'Change display name' : 'Add your name'}</button>
            <button role="menuitem" onClick={() => void signOut()}><Icon name="logout" size={16} />Sign out</button>
          </div>}
        </div>
      </div>
      <div className={`activity ${busy ? 'on' : ''}`} role="progressbar" aria-hidden={!busy} aria-label="Loading" />
    </header>

    <aside className="sidebar" aria-label="Main navigation">
      <nav>{groups.map(group => <div key={group.label} className="nav-group">
        <p className="nav-group-label">{group.label}</p>
        {group.items.map(navButton)}
      </div>)}</nav>
      <div className="org-card">
        <span className="fine">Organization</span>
        <strong>{membership.organization_name}</strong>
        <span className="fine">Your role here: <b style={{ textTransform: 'capitalize' }}>{role}</b>{role !== 'admin' ? ' · Management is for admins' : ''}</span>
        {switcher}
      </div>
    </aside>

    <nav className="bottom-nav" aria-label="Main navigation">
      {mobileTabs.map(id => items.find(item => item.id === id)).filter(Boolean).map(item => <button key={item!.id}
        aria-current={view.tab === item!.id ? 'page' : undefined} onClick={() => navigate({ tab: item!.id })}>
        <Icon name={item!.icon} /><span>{item!.label}</span></button>)}
      <button aria-expanded={moreOpen} onClick={() => setMoreOpen(true)}><Icon name="menu" /><span>More</span></button>
    </nav>
    <Modal open={moreOpen} onClose={() => setMoreOpen(false)} title="Menu">
      <nav className="sheet-nav">{groups.map(group => <div key={group.label} className="nav-group">
        <p className="nav-group-label">{group.label}</p>{group.items.map(navButton)}
      </div>)}{switcher && <label className="grid gap-1">Organization{switcher}</label>}</nav>
    </Modal>
    <NameDialog open={nameOpen} me={me} call={call} onClose={() => setNameOpen(false)} onSaved={full_name => setMe({ ...me, full_name })} />

    <ConfirmHost />
    <main className={"workspace workspace-" + view.tab} id="main" tabIndex={-1}>
      {showHeading && <header className="page-head">
                <div className="page-heading-copy">
          <div className="page-context"><span>{membership.organization_name}</span><Icon name="arrow" size={12} /><span>{groups.find(group => group.items.some(item => item.id === view.tab))?.label ?? 'Workspace'}</span></div>
          <h1>{current.title}</h1>
        </div>
        <p className="page-purpose">{current.blurb}</p>
      </header>}
      {unread.error && view.tab === 'notifications' && <ErrorNote message="Could not load the unread count." onRetry={reloadUnread} />}
      <div className="page" key={view.tab + org}>
        {view.tab === 'overview' ? <JiraOverview call={call} orgId={org} role={role} me={me}
          openInternship={id => openSection(id, 'tasks')} go={tab => navigate({ tab })} />
          : view.tab === 'internships' || view.tab === 'assignments'
            ? <Internships call={call} orgId={org} role={role} view={view.tab === 'assignments' ? { tab: 'internships' } : view} navigate={navigate} manage={view.tab === 'assignments'} />
          : view.tab === 'progress' ? <ProgressReports canEdit={role !== 'intern'} key={org} call={call} orgId={org} openTask={openTask} />
          : view.tab === 'calendar' ? <Calendar call={call} orgId={org} role={role} openTask={openTask} />
          : view.tab === 'plans' ? <InternshipPicker call={call} orgId={org} role={role} purpose="plan" open={(id, replace) => openSection(id, 'plan', replace)} />
          : view.tab === 'notes' ? <InternshipPicker call={call} orgId={org} role={role} purpose="notes" open={(id, replace) => openSection(id, 'notes', replace)} />
          : view.tab === 'reviews' ? <TaskQueue call={call} orgId={org} role={role} openTask={openTask} />
          : view.tab === 'projects' ? <Projects call={call} orgId={org} role={role} />
          : view.tab === 'programs' ? <Programs call={call} orgId={org} role={role} openProgram={programId => navigate({ tab: 'internships', programId })} />
          : view.tab === 'ai-usage' && role === 'admin' ? <AiUsage call={call} org={org} />
          : view.tab === 'members' ? (role === 'admin' ? <Members call={call} orgId={org} userId={session.user.id} /> : <ErrorNote message="Only admins can manage members." />)
          : view.tab === 'notifications' ? <Notifications call={call} orgId={org} openTask={openTask} onRead={reloadUnread}
            openPlan={id => openSection(id, 'plan')} />
          : null}
      </div>
    </main>
  </div>
}


