import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Attention } from './Attention';
import { Guide } from './Guide';
import { useResource } from '../../lib/api';
import { Due, ErrorNote, Icon, Person, Progress, StatusBadge, displayName, formatDate } from '../../ui';
/** One task per row: what, who, when, state. */
export function TaskRow({ item, showIntern, onOpen, action }) {
    return _jsx("li", { children: _jsxs("button", { className: "row-link", onClick: onOpen, children: [_jsxs("span", { className: "row-primary", children: [_jsx("span", { className: "row-title", children: item.title }), _jsx("span", { className: "row-sub", children: [showIntern && displayName(item.intern_name, item.intern_email), item.project || item.program].filter(Boolean).join(' · ') })] }), _jsx("span", { className: "row-when", children: item.status === 'submitted' && item.submitted_at ? _jsxs("span", { children: ["Sent ", formatDate(item.submitted_at)] }) : _jsx(Due, { date: item.due_on }) }), _jsxs("span", { className: "row-state", children: [_jsx(StatusBadge, { status: item.status }), action && _jsx("span", { className: "row-action", children: action })] }), _jsx(Icon, { name: "arrow", size: 16 })] }) });
}
function Panel({ title, count, hint, action, children }) {
    return _jsxs("section", { className: "panel", children: [_jsxs("header", { className: "panel-head", children: [_jsxs("div", { children: [_jsxs("h2", { children: [title, count !== undefined && _jsx("span", { className: "count", children: count })] }), hint && _jsx("p", { children: hint })] }), action] }), children] });
}
function Truncated({ data }) {
    return data.counts.open > data.items.length
        ? _jsxs("p", { className: "fine", children: ["Showing the ", data.items.length, " most urgent of ", data.counts.open, " open tasks. Totals count all of them."] }) : null;
}
function greeting(me) {
    const hour = new Date().getHours();
    const part = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    const first = me.full_name?.trim().split(/\s+/)[0];
    return first ? `${part}, ${first}` : part;
}
function Hero({ me, summary, children }) {
    return _jsxs("header", { className: "hero", children: [_jsxs("div", { children: [_jsx("h2", { children: greeting(me) }), _jsx("p", { children: summary })] }), children] });
}
export function OverviewSkeleton() {
    return _jsxs("div", { className: "dashboard", children: [_jsx("div", { className: "skeleton", style: { height: '6.5rem', borderRadius: 'var(--r-lg)' } }), _jsxs("div", { className: "dashboard-grid", children: [_jsx("div", { className: "stack", children: [0, 1].map(card => _jsxs("section", { className: "panel", children: [_jsx("div", { className: "skeleton skeleton-line", style: { width: '12rem' } }), _jsx("div", { className: "rows", children: [0, 1, 2].map(row => _jsxs("div", { className: "skeleton-row", children: [_jsxs("span", { children: [_jsx("span", { className: "skeleton skeleton-line", style: { width: '60%' } }), _jsx("span", { className: "skeleton skeleton-line short", style: { width: '35%' } })] }), _jsx("span", { className: "skeleton skeleton-pill" })] }, row)) })] }, card)) }), _jsx("div", { className: "skeleton", style: { height: '14rem', borderRadius: 'var(--r-lg)' } })] })] });
}
function Roster({ call, orgId, actions, role }) {
    const roster = useResource(call, `/api/organizations/${orgId}/internships`);
    return _jsxs("aside", { className: "panel side-panel", "aria-label": role === 'mentor' ? 'Your interns' : 'Your internship', children: [_jsx("header", { className: "panel-head", children: _jsx("h2", { children: role === 'mentor' ? 'Your interns' : 'Your internship' }) }), roster.error && _jsx(ErrorNote, { message: roster.error, onRetry: roster.reload }), !roster.data && !roster.error && _jsx("div", { className: "skeleton", style: { height: '8rem' } }), roster.data?.length === 0 && _jsx("p", { className: "fine", children: "No internships assigned yet." }), _jsx("ul", { className: "people-list", children: roster.data?.map(item => _jsxs("li", { children: [_jsx("button", { className: "person-link", onClick: () => actions.openInternship(item.id), children: _jsx(Person, { name: role === 'mentor' ? item.intern_name : item.mentor_name, email: role === 'mentor' ? item.intern_email : item.mentor_email, detail: role === 'mentor' ? item.program_name : `Mentor · ${item.program_name}` }) }), _jsxs("div", { className: "person-progress", children: [_jsx(Progress, { done: item.completed_count, total: item.task_count, label: `${item.completed_count} of ${item.task_count} tasks done` }), _jsxs("span", { children: [item.completed_count, "/", item.task_count, " done", item.submitted_count ? ` · ${item.submitted_count} to review` : ''] })] }), role === 'mentor' && _jsxs("button", { className: "secondary sm", onClick: () => actions.openPlan(item.id), children: [_jsx(Icon, { name: "sparkle", size: 14 }), "Plan next period"] })] }, item.id)) })] });
}
function weekRange() {
    const day = new Intl.DateTimeFormat('sv-SE');
    const start = new Date();
    const end = new Date();
    end.setDate(end.getDate() + 6);
    return [day.format(start), day.format(end)];
}
function MentorOverview({ data, me, actions, call, orgId }) {
    const [first, last] = weekRange();
    const review = data.items.filter(item => item.status === 'submitted');
    const upcoming = data.items.filter(item => item.status !== 'submitted' && item.due_on >= first && item.due_on <= last);
    return _jsxs("div", { className: "dashboard", children: [_jsx(Hero, { me: me, summary: data.counts.submitted
                    ? `${data.counts.submitted} submission${data.counts.submitted === 1 ? '' : 's'} waiting for your review${data.counts.overdue ? ` · ${data.counts.overdue} past due` : ''}.`
                    : 'Nothing is waiting for your review.', children: review[0] && _jsx("button", { onClick: () => actions.openTask(review[0].internship_id, review[0].task_id), children: "Review oldest" }) }), _jsxs("div", { className: "dashboard-grid", children: [_jsxs("div", { className: "stack", children: [_jsx(Panel, { title: "Review queue", count: review.length, hint: review.length ? 'Oldest submission first.' : undefined, children: review.length === 0 ? _jsxs("p", { className: "empty-line", children: [_jsx(Icon, { name: "check", size: 16 }), "You\u2019re up to date."] })
                                    : _jsx("ul", { className: "rows", children: review.map(item => _jsx(TaskRow, { item: item, showIntern: true, action: "Review", onOpen: () => actions.openTask(item.internship_id, item.task_id) }, item.task_id)) }) }), _jsx(Panel, { title: "Due this week", count: upcoming.length, hint: "Work your interns are doing now.", action: _jsxs("button", { className: "ghost sm", onClick: () => actions.go('calendar'), children: [_jsx(Icon, { name: "calendar", size: 15 }), "Calendar"] }), children: upcoming.length === 0 ? _jsx("p", { className: "empty-line", children: "No deadlines in the next 7 days." })
                                    : _jsx("ul", { className: "rows", children: upcoming.map(item => _jsx(TaskRow, { item: item, showIntern: true, onOpen: () => actions.openTask(item.internship_id, item.task_id) }, item.task_id)) }) }), _jsx(Truncated, { data: data })] }), _jsx(Roster, { call: call, orgId: orgId, actions: actions, role: "mentor" })] })] });
}
function InternOverview({ data, me, actions, call, orgId }) {
    const changes = data.items.filter(item => item.status === 'changes_requested');
    const todo = data.items.filter(item => item.status === 'planned');
    const waiting = data.items.filter(item => item.status === 'submitted');
    const next = changes[0] ?? todo[0];
    // The next task is featured above, so the lists below leave it out.
    const rest = (items) => items.filter(item => item.task_id !== next?.task_id);
    return _jsxs("div", { className: "dashboard", children: [_jsx(Hero, { me: me, summary: data.counts.open ? `${data.counts.open} open task${data.counts.open === 1 ? '' : 's'}${changes.length ? ` · ${changes.length} with requested changes` : ''}.` : 'You’re all caught up.' }), _jsxs("div", { className: "dashboard-grid", children: [_jsxs("div", { className: "stack", children: [next && _jsxs("section", { className: "next-up", children: [_jsx("p", { className: "eyebrow", children: next.status === 'changes_requested' ? 'Next up · changes requested' : 'Next up' }), _jsx("h3", { children: next.title }), _jsxs("p", { className: "row-sub", children: [next.project || next.program, " \u00B7 ", _jsx(Due, { date: next.due_on })] }), _jsxs("button", { onClick: () => actions.openTask(next.internship_id, next.task_id), children: [next.status === 'changes_requested' ? 'Update your work' : 'Start task', _jsx(Icon, { name: "arrow", size: 16 })] })] }), rest(changes).length > 0 && _jsx(Panel, { title: "Needs changes", count: rest(changes).length, hint: "Your mentor asked for changes.", children: _jsx("ul", { className: "rows", children: rest(changes).map(item => _jsx(TaskRow, { item: item, showIntern: false, action: "Resubmit", onOpen: () => actions.openTask(item.internship_id, item.task_id) }, item.task_id)) }) }), _jsx(Panel, { title: "To do", count: rest(todo).length, hint: rest(todo).length ? 'Sorted by deadline.' : undefined, children: rest(todo).length === 0 ? _jsx("p", { className: "empty-line", children: "Nothing else to start." })
                                    : _jsx("ul", { className: "rows", children: rest(todo).map(item => _jsx(TaskRow, { item: item, showIntern: false, onOpen: () => actions.openTask(item.internship_id, item.task_id) }, item.task_id)) }) }), waiting.length > 0 && _jsx(Panel, { title: "Waiting for review", count: waiting.length, hint: "Your mentor has these.", children: _jsx("ul", { className: "rows", children: waiting.map(item => _jsx(TaskRow, { item: item, showIntern: false, onOpen: () => actions.openTask(item.internship_id, item.task_id) }, item.task_id)) }) }), _jsx(Truncated, { data: data })] }), _jsx(Roster, { call: call, orgId: orgId, actions: actions, role: "intern" })] })] });
}
function AdminOverview({ call, orgId, me, data, actions }) {
    const programs = useResource(call, `/api/organizations/${orgId}/programs`);
    const internships = useResource(call, `/api/organizations/${orgId}/internships`);
    const attention = internships.data?.filter(item => item.submitted_count > 0 || item.task_count === 0) ?? [];
    return _jsxs("div", { className: "dashboard", children: [_jsx(Hero, { me: me, summary: "Your organization\u2019s programs and assignments.", children: _jsxs("div", { className: "hero-actions", children: [_jsxs("button", { className: "secondary", onClick: () => actions.go('programs'), children: [_jsx(Icon, { name: "plus", size: 16 }), "Program"] }), _jsxs("button", { onClick: () => actions.go('assignments'), children: [_jsx(Icon, { name: "plus", size: 16 }), "Assignment"] })] }) }), _jsx("div", { className: "stat-strip", children: [['Internships', internships.data?.length ?? '–'], ['Open tasks', data.counts.open], ['Waiting for review', data.counts.submitted],
                    ['Past due', data.counts.overdue]].map(([label, value]) => _jsxs("div", { className: "stat-cell", children: [_jsx("strong", { children: value }), _jsx("span", { children: label })] }, label)) }), _jsxs("div", { className: "dashboard-grid", children: [_jsxs(Panel, { title: "Programs", hint: "Open a program to see its internships.", action: _jsx("button", { className: "ghost sm", onClick: () => actions.go('programs'), children: "All programs" }), children: [programs.error && _jsx(ErrorNote, { message: programs.error, onRetry: programs.reload }), !programs.data && !programs.error && _jsx("div", { className: "skeleton", style: { height: '6rem' } }), programs.data?.length === 0 && _jsx("p", { className: "empty-line", children: "No programs yet." }), _jsx("ul", { className: "rows", children: programs.data?.map(program => {
                                    const review = internships.data?.filter(item => item.program_id === program.id).reduce((sum, item) => sum + item.submitted_count, 0) ?? 0;
                                    return _jsx("li", { children: _jsxs("button", { className: "row-link", onClick: () => actions.openProgram(program.id), children: [_jsxs("span", { className: "row-primary", children: [_jsx("span", { className: "row-title", children: program.name }), _jsx("span", { className: "row-sub", children: program.description || 'No description' })] }), _jsxs("span", { className: "row-when", children: [program.internship_count, " internship", program.internship_count === 1 ? '' : 's'] }), _jsx("span", { className: "row-state", children: review > 0 && _jsxs("span", { className: "pill warn", children: [review, " to review"] }) }), _jsx(Icon, { name: "arrow", size: 16 })] }) }, program.id);
                                }) })] }), _jsxs("aside", { className: "panel side-panel", children: [_jsx("header", { className: "panel-head", children: _jsx("h2", { children: "Needs attention" }) }), !internships.data && _jsx("div", { className: "skeleton", style: { height: '8rem' } }), internships.data && attention.length === 0 && _jsx("p", { className: "empty-line", children: "Every assignment is on track." }), _jsx("ul", { className: "people-list", children: attention.slice(0, 8).map(item => _jsxs("li", { children: [_jsx("button", { className: "person-link", onClick: () => actions.openInternship(item.id), children: _jsx(Person, { name: item.intern_name, email: item.intern_email, detail: item.program_name }) }), _jsx("span", { className: "pill warn", children: item.task_count === 0 ? 'No tasks yet' : `${item.submitted_count} to review` })] }, item.id)) })] })] })] });
}
export function Overview({ call, orgId, role, me, actions }) {
    const queue = useResource(call, `/api/organizations/${orgId}/overview`);
    const data = queue.data;
    if (queue.error)
        return _jsx(ErrorNote, { message: "Could not load your overview.", onRetry: queue.reload });
    if (!data)
        return _jsx(OverviewSkeleton, {});
    // Main work first; risk signals below and only when there are any.
    if (role === 'admin' || role === 'mentor')
        return _jsxs("div", { className: "stack", children: [_jsx(Guide, { role: role, go: actions.go }), role === 'admin' ? _jsx(AdminOverview, { call: call, orgId: orgId, me: me, data: data, actions: actions })
                    : _jsx(MentorOverview, { data: data, me: me, actions: actions, call: call, orgId: orgId }), _jsx(Attention, { call: call, orgId: orgId, openTask: actions.openTask }, orgId)] });
    return _jsxs("div", { className: "stack", children: [_jsx(Guide, { role: role, go: actions.go }), _jsx(InternOverview, { data: data, me: me, actions: actions, call: call, orgId: orgId })] });
}
