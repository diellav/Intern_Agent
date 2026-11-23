import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { useResource } from '../../lib/api';
import { formatView } from '../../app/routes';
import { Due, Empty, ErrorNote, Icon, Loading, Modal, Person, Progress, StatusBadge, confirmAction, displayName, formatDate } from '../../ui';
import { Plans } from '../plans/Plans';
import { Notes } from '../notes/Notes';
import { Activity } from './Activity';
import { ActionForm, TaskDetail } from './TaskDetail';
function periodText(starts, ends) {
    const day = 86400000;
    const start = new Date(starts + 'T12:00:00').getTime();
    const end = new Date(ends + 'T12:00:00').getTime();
    const now = new Date();
    now.setHours(12, 0, 0, 0);
    const total = Math.round((end - start) / day) + 1;
    const elapsed = Math.round((now.getTime() - start) / day) + 1;
    if (elapsed < 1)
        return `Starts ${formatDate(starts)}`;
    if (elapsed > total)
        return 'Ended';
    return `Day ${elapsed} of ${total}`;
}
function AssignDialog({ open, call, base, onClose, onSaved }) {
    const programs = useResource(call, open ? base + '/programs' : null);
    const people = useResource(call, open ? base + '/assignment-members' : null);
    const mentors = people.data?.filter(person => person.role === 'mentor');
    const interns = people.data?.filter(person => person.role === 'intern');
    const failure = programs.error || people.error;
    const label = (person) => person.full_name ? `${person.full_name} (${person.email})` : person.email;
    return _jsxs(Modal, { open: open, onClose: onClose, title: "New assignment", description: "Pair an intern with a mentor for a program.", children: [failure && _jsx(ErrorNote, { message: failure, onRetry: () => { programs.reload(); people.reload(); } }), (!programs.data || !people.data) && !failure && _jsx(Loading, { rows: 2 }), programs.data?.length === 0 && _jsx(Empty, { icon: "layers", title: "Create a program first", children: "Assignments belong to a program." }), !!programs.data?.length && people.data && (!mentors?.length || !interns?.length) && _jsx(Empty, { icon: "shield", title: "Mentor and intern needed", children: "Add an invited mentor and intern to this organization first." }), !!programs.data?.length && !!mentors?.length && !!interns?.length && _jsxs(ActionForm, { call: call, path: base + '/internships', onSaved: () => { onSaved(); onClose(); }, label: "Create assignment", busyLabel: "Creating assignment\u2026", icon: "plus", children: [_jsxs("label", { children: ["Program", _jsx("select", { name: "program_id", required: true, autoFocus: true, children: programs.data.map(item => _jsx("option", { value: item.id, children: item.name }, item.id)) })] }), _jsxs("div", { className: "form-grid two", children: [_jsxs("label", { children: ["Mentor", _jsx("select", { name: "mentor_id", required: true, children: mentors.map(item => _jsx("option", { value: item.id, children: label(item) }, item.id)) })] }), _jsxs("label", { children: ["Intern", _jsx("select", { name: "intern_id", required: true, children: interns.map(item => _jsx("option", { value: item.id, children: label(item) }, item.id)) })] }), _jsxs("label", { children: ["Start date", _jsx("input", { name: "starts_on", type: "date", required: true })] }), _jsxs("label", { children: ["End date", _jsx("input", { name: "ends_on", type: "date", required: true })] })] })] })] });
}
function AddTaskDialog({ open, call, base, internship, onClose, onSaved }) {
    return _jsx(Modal, { open: open, onClose: onClose, title: "Add task", description: `For ${displayName(internship.intern_name, internship.intern_email)} · ${internship.program_name}. It joins the published plan that covers its deadline.`, children: _jsxs(ActionForm, { call: call, path: `${base}/internships/${internship.id}/tasks`, onSaved: () => { onSaved(); onClose(); }, label: "Assign task", busyLabel: "Assigning task\u2026", icon: "plus", children: [_jsxs("label", { children: ["Task title", _jsx("input", { name: "title", required: true, maxLength: 120, autoFocus: true, placeholder: "Build the login screen" })] }), _jsxs("label", { children: ["Acceptance criteria", _jsx("textarea", { name: "criteria", rows: 4, required: true, maxLength: 3000, placeholder: "What does done look like?" })] }), _jsxs("div", { className: "form-grid two", children: [_jsxs("label", { children: ["Deadline", _jsx("input", { name: "due_on", type: "date", min: internship.starts_on, max: internship.ends_on, required: true })] }), _jsxs("label", { children: ["Estimated hours ", _jsx("span", { children: "(optional)" }), _jsx("input", { name: "estimated_hours", type: "number", min: "0.5", max: "200", step: "0.5" })] })] })] }) });
}
/** The internship's identity: the person, the program, the period and how far along it is. */
function InternshipHeader({ internship, role, back, children }) {
    const showIntern = role !== 'intern';
    return _jsxs("header", { className: "profile-head", children: [_jsxs("h1", { className: "sr-only", children: [displayName(showIntern ? internship.intern_name : internship.mentor_name, showIntern ? internship.intern_email : internship.mentor_email), " \u00B7 ", internship.program_name] }), back && _jsxs("button", { className: "back-link", onClick: back.go, children: [_jsx(Icon, { name: "back", size: 16 }), back.label] }), _jsxs("div", { className: "profile-row", children: [_jsx(Person, { size: "lg", name: showIntern ? internship.intern_name : internship.mentor_name, email: showIntern ? internship.intern_email : internship.mentor_email, detail: showIntern ? (internship.intern_name ? internship.intern_email : 'Intern') : `Your mentor${internship.mentor_name ? ` · ${internship.mentor_email ?? ''}` : ''}` }), children] }), _jsxs("dl", { className: "facts", children: [_jsxs("div", { children: [_jsx("dt", { children: "Program" }), _jsx("dd", { children: internship.program_name })] }), showIntern && role === 'admin' && _jsxs("div", { children: [_jsx("dt", { children: "Mentor" }), _jsx("dd", { children: displayName(internship.mentor_name, internship.mentor_email) })] }), _jsxs("div", { children: [_jsx("dt", { children: "Period" }), _jsxs("dd", { children: [formatDate(internship.starts_on), " \u2013 ", formatDate(internship.ends_on)] })] }), _jsxs("div", { children: [_jsx("dt", { children: "Progress" }), _jsx("dd", { children: internship.closed_at ? `Closed ${formatDate(internship.closed_at.slice(0, 10))}` : periodText(internship.starts_on, internship.ends_on) })] })] })] });
}
function TaskList({ call, base, internship, role, tasks, reload, openTask }) {
    const [filter, setFilter] = useState('all');
    const [adding, setAdding] = useState(false);
    const records = tasks.data;
    const count = (status) => status === 'all' ? records?.length ?? 0 : records?.filter(task => task.status === status).length ?? 0;
    const filters = [['all', 'All'], ['submitted', 'In review'], ['changes_requested', 'Changes'], ['planned', 'To do'], ['completed', 'Done']];
    const visible = records?.filter(task => filter === 'all' || task.status === filter);
    return _jsxs("section", { className: "panel", children: [_jsxs("header", { className: "panel-head", children: [_jsx("div", { className: "segmented", role: "group", "aria-label": "Filter tasks", children: filters.filter(([key]) => key === 'all' || count(key) > 0).map(([key, label]) => _jsxs("button", { type: "button", "aria-pressed": filter === key, onClick: () => setFilter(key), children: [label, _jsx("span", { className: "seg-count", children: count(key) })] }, key)) }), role === 'mentor' && !internship.closed_at && _jsxs("button", { className: "secondary sm", onClick: () => setAdding(true), children: [_jsx(Icon, { name: "plus", size: 15 }), "Add task"] })] }), internship.closed_at && _jsx("p", { className: "notice", children: "This internship is closed. Tasks and submissions are read-only." }), role === 'mentor' && _jsx(AddTaskDialog, { open: adding, call: call, base: base, internship: internship, onClose: () => setAdding(false), onSaved: reload }), tasks.error && _jsx(ErrorNote, { message: tasks.error, onRetry: tasks.reload }), !records && !tasks.error && _jsx(Loading, {}), records?.length === 0 && _jsx(Empty, { icon: "file", title: "No tasks yet", children: role === 'mentor' ? 'Draft the next period in the Plan tab, or add a single task.' : 'Your mentor will assign tasks here.' }), _jsx("ul", { className: "rows", children: visible?.map(item => _jsx("li", { children: _jsxs("button", { className: "row-link", onClick: () => openTask(item.id), children: [_jsxs("span", { className: "row-primary", children: [_jsx("span", { className: "row-title", children: item.title }), item.estimated_hours ? _jsxs("span", { className: "row-sub", children: [Number(item.estimated_hours), " h estimated"] }) : null] }), _jsx("span", { className: "row-when", children: item.status === 'completed' ? _jsxs("span", { children: ["Due ", formatDate(item.due_on)] }) : _jsx(Due, { date: item.due_on }) }), _jsx("span", { className: "row-state", children: _jsx(StatusBadge, { status: item.status }) }), _jsx(Icon, { name: "arrow", size: 16 })] }) }, item.id)) })] });
}
/** Admins and the assigned mentor close an internship when it ends; it then leaves the active lists. */
function CloseButton({ call, base, internship, onChanged }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const closed = !!internship.closed_at;
    async function toggle() {
        const ok = await confirmAction(closed
            ? 'Reopen this internship? The intern can submit work and you can plan again.'
            : 'Close this internship? No new tasks, plans or submissions, and it leaves the overview, calendar and attention lists. You can reopen it later.', closed ? 'Reopen' : 'Close internship', !closed);
        if (!ok)
            return;
        setBusy(true);
        setError('');
        try {
            await call(`${base}/internships/${internship.id}/closed`, { method: 'PUT', body: JSON.stringify({ closed: !closed }) });
            onChanged();
        }
        catch (failure) {
            setError(failure instanceof Error ? failure.message : 'Could not change the internship.');
        }
        finally {
            setBusy(false);
        }
    }
    return _jsxs("div", { className: "close-control", children: [_jsxs("button", { className: closed ? 'secondary sm' : 'secondary sm danger-btn', disabled: busy, onClick: toggle, children: [_jsx(Icon, { name: closed ? 'arrow' : 'check', size: 15 }), busy ? 'Saving…' : closed ? 'Reopen internship' : 'Close internship'] }), error && _jsx("span", { role: "alert", className: "fine error-text", children: error })] });
}
function InternshipPage({ call, orgId, base, internship, role, view, navigate, showBack, onChanged }) {
    const tasks = useResource(call, `${base}/internships/${internship.id}/tasks`);
    const reload = () => { tasks.reload(); onChanged(); };
    const go = (patch) => navigate({ tab: 'internships', internshipId: internship.id, ...patch });
    const task = view.taskId ? tasks.data?.find(item => item.id === view.taskId) : undefined;
    const done = tasks.data?.filter(item => item.status === 'completed').length ?? 0;
    const total = tasks.data?.length ?? 0;
    if (view.taskId) {
        return _jsxs("div", { className: "stack", children: [_jsx(InternshipHeader, { internship: internship, role: role, back: { label: 'Back to tasks', go: () => go({ section: 'tasks' }) } }), tasks.error && _jsx(ErrorNote, { message: tasks.error, onRetry: tasks.reload }), !tasks.data && !tasks.error && _jsx("section", { className: "panel", children: _jsx(Loading, { rows: 4 }) }), tasks.data && !task && _jsx(Empty, { icon: "file", title: "Task not found", children: "It may have been removed, or you may not have access to it." }), task && _jsx(TaskDetail, { call: call, base: base, task: task, role: role, highlight: view.version, onSaved: reload, neighbors: tasks.data.slice(Math.max(0, tasks.data.indexOf(task) - 1), tasks.data.indexOf(task) + 2).filter(item => item.id !== task.id), openTask: taskId => go({ section: 'tasks', taskId }) }, task.id)] });
    }
    const tabs = [['tasks', `Tasks${total ? ` · ${total}` : ''}`], ['plan', 'Plan'], ['notes', 'Notes'], ['activity', 'Activity']];
    const section = view.section ?? 'tasks';
    return _jsxs("div", { className: "stack", children: [_jsxs(InternshipHeader, { internship: internship, role: role, back: showBack ? { label: 'All internships', go: () => navigate({ tab: 'internships' }) } : null, children: [total > 0 && _jsxs("div", { className: "head-progress", children: [_jsxs("span", { children: [_jsx("b", { children: done }), " of ", total, " tasks done"] }), _jsx(Progress, { done: done, total: total })] }), role !== 'intern' && _jsx(CloseButton, { call: call, base: base, internship: internship, onChanged: onChanged })] }), _jsx("nav", { className: "tabs", "aria-label": "Internship sections", children: tabs.map(([key, label]) => _jsx("button", { "aria-current": section === key ? 'page' : undefined, onClick: () => go({ section: key }), children: label }, key)) }), section === 'activity' ? _jsx(Activity, { call: call, path: `${base}/internships/${internship.id}/activity`, open: event => event.task_id ? go({ section: 'tasks', taskId: event.task_id, version: event.version ?? undefined }) : go({ section: 'plan' }) })
                : section === 'notes' ? _jsx(Notes, { call: call, base: base, internshipId: internship.id, role: role })
                    : section === 'plan' ? _jsx(Plans, { intern: role === "intern", call: call, orgId: orgId, path: `${base}/internships/${internship.id}/plans`, internLabel: displayName(internship.intern_name, internship.intern_email), starts: internship.starts_on, ends: internship.ends_on, mentor: role === 'mentor' && !internship.closed_at, tasks: tasks.data ?? [], refreshTasks: reload, openTask: taskId => go({ section: 'tasks', taskId }), taskHref: (taskId, version) => formatView({ tab: 'internships', internshipId: internship.id, section: 'tasks', taskId, version: version ?? undefined }) })
                        : _jsx(TaskList, { call: call, base: base, internship: internship, role: role, tasks: tasks, reload: reload, openTask: taskId => go({ section: 'tasks', taskId }) })] });
}
export function Internships({ call, orgId, role, view, navigate, manage = false }) {
    const base = '/api/organizations/' + orgId;
    const list = useResource(call, base + '/internships' + (view.programId ? `?program_id=${view.programId}` : ''));
    const [assigning, setAssigning] = useState(false);
    const records = list.data;
    const single = role !== 'admin' && records?.length === 1 && !view.programId;
    // Mentors and interns with one internship go straight to it.
    useEffect(() => {
        if (single && !view.internshipId)
            navigate({ tab: 'internships', internshipId: records[0].id, section: 'tasks' }, { replace: true });
    }, [single, records, view.internshipId, navigate]);
    if (view.internshipId) {
        const internship = records?.find(item => item.id === view.internshipId);
        if (list.error)
            return _jsx(ErrorNote, { message: list.error, onRetry: list.reload });
        if (!records)
            return _jsx("section", { className: "panel", children: _jsx(Loading, { rows: 4 }) });
        if (!internship)
            return _jsx(Empty, { icon: "briefcase", title: "Internship not found", children: "It may not exist, or you may not have access to it." });
        return _jsx(InternshipPage, { call: call, orgId: orgId, base: base, internship: internship, role: role, view: view, navigate: navigate, showBack: !single, onChanged: list.reload });
    }
    const programName = view.programId && records?.[0]?.program_name;
    return _jsxs("section", { className: "panel", children: [_jsxs("header", { className: "panel-head", children: [_jsxs("div", { children: [_jsxs("h2", { children: [manage ? 'Assignments' : role === 'intern' ? 'Your internship' : role === 'mentor' ? 'Your interns' : 'All internships', records && _jsx("span", { className: "count", children: records.length })] }), view.programId && _jsxs("p", { children: ["Program: ", _jsx("b", { children: programName || 'Selected program' }), " \u00B7 ", _jsx("button", { className: "link-btn", onClick: () => navigate({ tab: 'internships' }), children: "Show all programs" })] })] }), role === 'admin' && _jsxs("button", { onClick: () => setAssigning(true), children: [_jsx(Icon, { name: "plus", size: 16 }), "New assignment"] })] }), role === 'admin' && _jsx(AssignDialog, { open: assigning, call: call, base: base, onClose: () => setAssigning(false), onSaved: list.reload }), list.error && _jsx(ErrorNote, { message: list.error, onRetry: list.reload }), !records && !list.error && _jsx(Loading, {}), records?.length === 0 && _jsx(Empty, { icon: "briefcase", title: "No internships here", children: role === 'admin' ? 'Create an assignment to get started.' : 'You’ll see an internship here once an admin assigns you.' }), !!records?.length && _jsxs("div", { className: "table-head", "aria-hidden": "true", children: [_jsx("span", { children: role === 'intern' ? 'Mentor' : 'Intern' }), _jsx("span", { children: "Program" }), _jsx("span", { children: "Period" }), _jsx("span", { children: "Progress" }), _jsx("span", {})] }), _jsx("ul", { className: "rows", children: records?.map(item => _jsx("li", { children: _jsxs("button", { className: "row-link internship-row", onClick: () => navigate({ tab: 'internships', internshipId: item.id, section: 'tasks' }), children: [_jsx(Person, { name: role === 'intern' ? item.mentor_name : item.intern_name, email: role === 'intern' ? item.mentor_email : item.intern_email, detail: role === 'admin' ? `Mentor: ${displayName(item.mentor_name, item.mentor_email)}` : undefined }), _jsx("span", { className: "cell", children: item.program_name }), _jsxs("span", { className: "cell muted", children: [formatDate(item.starts_on), " \u2013 ", formatDate(item.ends_on)] }), _jsx("span", { className: "cell progress-cell", children: item.task_count > 0
                                    ? _jsxs(_Fragment, { children: [_jsx(Progress, { done: item.completed_count, total: item.task_count }), _jsxs("span", { className: "muted", children: [item.completed_count, "/", item.task_count] })] })
                                    : _jsx("span", { className: "muted", children: "No tasks yet" }) }), _jsx("span", { className: "row-state", children: item.closed_at ? _jsx("span", { className: "pill", children: "Closed" })
                                    : item.submitted_count > 0 && _jsxs("span", { className: "pill warn", children: [item.submitted_count, " to review"] }) })] }) }, item.id)) })] });
}
