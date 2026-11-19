import { useState } from 'react'
import type { Role } from '../../lib/api'
import type { Tab } from '../../app/Workspace'
import { Icon } from '../../ui'

type Step = { title: string; detail: string; tab: Tab; action: string }

const steps: Record<Role, Step[]> = {
  admin: [
    { title: 'Create a program', detail: 'A program groups internships with the same goal, e.g. “Frontend Engineering”.', tab: 'programs', action: 'Programs' },
    { title: 'Invite people', detail: 'Invite mentors and interns by email and give each a role. They sign in with a code.', tab: 'members', action: 'Members' },
    { title: 'Pair them', detail: 'Create an assignment: one intern, one mentor, a program and dates. The mentor takes it from there.', tab: 'assignments', action: 'Assignments' },
    { title: 'Follow progress', detail: 'Overview shows open work and who may need help. AI usage shows what the AI was used for.', tab: 'overview', action: 'Overview' },
  ],
  mentor: [
    { title: 'Plan the first period', detail: 'Open Plans, choose your intern, upload their CV or describe the focus, then Generate draft. Edit it and click Approve and assign: the intern gets the tasks and a notification.', tab: 'plans', action: 'Plans' },
    { title: 'Review submissions', detail: 'When the intern submits, it appears in Reviews and in your notifications. Open it, use AI suggestions if you like, then approve or request changes.', tab: 'reviews', action: 'Reviews' },
    { title: 'Answer questions', detail: 'Interns ask on the task page. You can draft an answer with AI from verified answers and shared notes.', tab: 'questions', action: 'Q&A' },
    { title: 'Share a progress report', detail: 'In Progress reports, pick a period, generate a summary from real evidence, edit it and share it with the intern.', tab: 'progress', action: 'Progress reports' },
  ],
  intern: [
    { title: 'Start with your next task', detail: 'Overview shows what to do next. Open a task to read what “done” means.', tab: 'overview', action: 'Overview' },
    { title: 'Submit your work', detail: 'On the task, add a description, links or files and click Submit work. Your mentor gets notified.', tab: 'reviews', action: 'Tasks' },
    { title: 'Follow feedback', detail: 'Notifications tell you when work is approved or needs changes. Send a new version from the same task.', tab: 'notifications', action: 'Notifications' },
    { title: 'Ask when stuck', detail: 'Ask about a task from the task page, or search Q&A for answers others already got.', tab: 'questions', action: 'Q&A' },
  ],
}

function stored(role: Role) {
  try { return localStorage.getItem('guide-hidden-' + role) === '1' } catch { return false }
}

/** A short, role-specific map of the workflow, with a link to where each step happens. */
export function Guide({ role, go }: { role: Role; go: (tab: Tab) => void }) {
  const [hidden, setHidden] = useState(() => stored(role))
  const toggle = (value: boolean) => { setHidden(value); try { localStorage.setItem('guide-hidden-' + role, value ? '1' : '0') } catch { /* private mode */ } }
  if (hidden) return <button className="ghost sm" style={{ justifySelf: 'start' }} onClick={() => toggle(false)}><Icon name="book" size={15} />How InternAgent works</button>
  return <section className="panel guide" aria-label="How InternAgent works">
    <header className="panel-head">
      <div><h2>How InternAgent works</h2><p>{role === 'admin' ? 'Set up the organization, then mentors run the internships.' : role === 'mentor' ? 'Your loop each week: plan → review → report.' : 'Your loop: do the task → submit → follow feedback.'}</p></div>
      <button className="ghost sm" onClick={() => toggle(true)}>Hide</button>
    </header>
    <ol className="guide-steps">{steps[role].map((step, index) => <li key={step.title}>
      <span className="guide-num">{index + 1}</span>
      <div><b>{step.title}</b><p>{step.detail}</p></div>
      <button className="secondary sm" onClick={() => go(step.tab)}>{step.action}<Icon name="arrow" size={14} /></button>
    </li>)}</ol>
  </section>
}
