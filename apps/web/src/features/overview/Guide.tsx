import { useState } from 'react'
import type { Role } from '../../lib/api'
import type { Tab } from '../../app/Workspace'
import { Icon } from '../../ui'

type Step = { title: string; detail: string; tab: Tab; action: string }

const steps: Record<Role, Step[]> = {
  admin: [
    { title: 'Add projects with their Jira key', detail: 'The assistant reads each board: modules, progress and issues interns can take.', tab: 'projects', action: 'Projects' },
    { title: 'Invite people', detail: 'Invite mentors and interns by email and give each a role.', tab: 'members', action: 'Members' },
    { title: 'Pair them', detail: 'Create an assignment: intern, mentor, project and dates.', tab: 'assignments', action: 'Assignments' },
    { title: 'Follow progress', detail: 'Overview shows each intern’s Jira work by status.', tab: 'overview', action: 'Overview' },
  ],
  mentor: [
    { title: 'Check the project', detail: 'In Projects, sync the Jira board and read where interns can start.', tab: 'projects', action: 'Projects' },
    { title: 'Link your intern', detail: 'Open the intern and link their Jira account.', tab: 'internships', action: 'Interns' },
    { title: 'Assign in Jira', detail: 'Pick from the suggested issues (and the CV fit, if you analyse a CV) and assign them in Jira with one click.', tab: 'internships', action: 'Interns' },
    { title: 'Follow progress', detail: 'Overview shows how each intern’s issues move on the board.', tab: 'overview', action: 'Overview' },
  ],
  intern: [
    { title: 'Read your project', detail: 'See what the team builds and what it works on now.', tab: 'projects', action: 'Projects' },
    { title: 'Work in Jira', detail: 'Your mentor assigns your issues on the team’s Jira board.', tab: 'overview', action: 'Overview' },
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
      <div><h2>How InternAgent works</h2><p>{role === 'admin' ? 'Set up the organization, then mentors run the internships.' : role === 'mentor' ? 'Your loop each week: plan → review → report.' : 'Your loop: do the task → submit → follow feedback.'}</p></div>
      <button className="ghost sm" onClick={() => toggle(true)}>Hide</button>
    </header>
    <ol className="guide-steps">{steps[role].map((step, index) => <li key={step.title}>
      <span className="guide-num">{index + 1}</span>
      <div><b>{step.title}</b><p>{step.detail}</p></div>
      <button className="secondary sm" onClick={() => go(step.tab)}>{step.action}<Icon name="arrow" size={14} /></button>
    </li>)}</ol>
  </section></details>
}