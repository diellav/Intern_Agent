import { useState } from 'react'
import type { Role } from '../../lib/api'
import type { Tab } from '../../app/Workspace'
import { Icon } from '../../ui'

type Step = { title: string; detail: string; tab: Tab; action: string }

const steps: Record<Role, Step[]> = {
  admin: [
    { title: 'Add programs and projects', detail: 'A program is the intern cohort; a project is the company work they join. Add the project’s Jira key so the assistant can read its board.', tab: 'projects', action: 'Projects' },
    { title: 'Invite people', detail: 'Invite mentors and interns by email and give each a role. They sign in with a code.', tab: 'members', action: 'Members' },
    { title: 'Pair them', detail: 'Create an assignment: intern, mentor, program, project and dates. The mentor takes it from there.', tab: 'assignments', action: 'Assignments' },
    { title: 'Follow progress', detail: 'Overview shows open work, each intern’s Jira progress and who may need help.', tab: 'overview', action: 'Overview' },
  ],
  mentor: [
    { title: 'Plan the first period', detail: 'Open Plans, choose your intern and Generate draft from their program and project. Approve to assign the tasks.', tab: 'plans', action: 'Plans' },
    { title: 'Use the Jira board', detail: 'In the intern’s Jira tab, link their Jira account and assign suggested issues in Jira with one click.', tab: 'internships', action: 'Internships' },
    { title: 'Review submissions', detail: 'Submissions appear in Reviews and your notifications. Use AI suggestions if you like, then approve or request changes.', tab: 'reviews', action: 'Reviews' },
    { title: 'Share a progress report', detail: 'In Progress reports, generate a summary from real evidence, edit it and share it with the intern.', tab: 'progress', action: 'Progress reports' },
  ],
  hr: [
    { title: 'See every intern', detail: 'Overview shows open work, each intern’s Jira progress and who may need help, with the reasons.', tab: 'overview', action: 'Overview' },
    { title: 'Open an internship', detail: 'Tasks, submissions, reviews, shared notes and Jira work, read-only.', tab: 'internships', action: 'Internships' },
    { title: 'Read progress', detail: 'Progress reports show recorded work for any period, and the reports mentors wrote.', tab: 'progress', action: 'Progress reports' },
    { title: 'Know the projects', detail: 'Projects shows each board, its modules and where interns work.', tab: 'projects', action: 'Projects' },
  ],
  intern: [
    { title: 'Start with your next task', detail: 'Overview shows what to do next. Open a task to read what “done” means.', tab: 'overview', action: 'Overview' },
    { title: 'Submit your work', detail: 'On the task, add a description, links or files and click Submit work. Your mentor gets notified.', tab: 'reviews', action: 'Tasks' },
    { title: 'Follow feedback', detail: 'Notifications tell you when work is approved or needs changes. Send a new version from the same task.', tab: 'notifications', action: 'Notifications' },
    { title: 'Know your project', detail: 'Projects shows what the team builds and what it works on now.', tab: 'projects', action: 'Projects' },
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
  return <details className="workflow-help"><summary><Icon name="book" size={16} />How InternAgent works<Icon name="arrow" size={14} /></summary><section className="panel guide" aria-label="How InternAgent works">
    <header className="panel-head">
      <div><h2>How InternAgent works</h2><p>{role === 'admin' ? 'Set up the organization, then mentors run the internships.' : role === 'mentor' ? 'Your loop each week: plan → review → report.' : role === 'hr' ? 'See what every intern is doing, without asking.' : 'Your loop: do the task → submit → follow feedback.'}</p></div>
      <button className="ghost sm" onClick={() => toggle(true)}>Hide</button>
    </header>
    <ol className="guide-steps">{steps[role].map((step, index) => <li key={step.title}>
      <span className="guide-num">{index + 1}</span>
      <div><b>{step.title}</b><p>{step.detail}</p></div>
      <button className="secondary sm" onClick={() => go(step.tab)}>{step.action}<Icon name="arrow" size={14} /></button>
    </li>)}</ol>
  </section></details>
}