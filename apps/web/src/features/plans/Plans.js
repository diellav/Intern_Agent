import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { AiVote } from '../ai/AiUsage';
import { CvPanel } from '../ai/CvPanel';
import { useRef, useState } from 'react';
import { useResource } from '../../lib/api';
import { Badge, Empty, ErrorNote, Icon, Loading, Modal, formatDate, confirmAction } from '../../ui';
import { PlanEditor, offset } from './PlanEditor';
import { GenerateDraft } from './GenerateDraft';
export function Plans({ call, orgId, path, starts, ends, mentor, tasks, openTask, refreshTasks, taskHref, internLabel, intern }) {
    const plans = useResource(call, path);
    const ai = useResource(call, mentor ? `/api/organizations/${orgId}/ai/status` : null);
    const [generating, setGenerating] = useState(false);
    const [generated, setGenerated] = useState(null);
    const [lastRequest, setLastRequest] = useState();
    const [draft, setDraft] = useState(null);
    const [notes, setNotes] = useState(null);
    const [editing, setEditing] = useState(null);
    const [error, setError] = useState('');
    const [pending, setPending] = useState(false);
    const [phase, setPhase] = useState('saving');
    const [receipt, setReceipt] = useState(null);
    const running = useRef(false);
    const saved = useRef(null);
    const today = new Intl.DateTimeFormat('sv-SE').format(new Date());
    const startDate = today < starts ? starts : today > ends ? ends : today;
    function open(next, plan = null, nextNotes = null) {
        saved.current = null;
        setGenerating(false);
        setEditing(plan);
        setNotes(nextNotes);
        setError('');
        setDraft(next);
    }
    function edit(plan) {
        open({
            title: plan.title, goal: plan.goal, project: plan.project, starts_on: plan.starts_on, ends_on: plan.ends_on,
            carry: plan.draft.carry.map(task => task.id), new_tasks: plan.draft.new_tasks,
        }, plan);
    }
    function blank(seed) {
        const end = offset(startDate, 6);
        setGenerated(null);
        open({ title: '', goal: '', project: '', starts_on: startDate, ends_on: end > ends ? ends : end, carry: [], new_tasks: [], ...seed });
    }
    function startFromCv(analysis) {
        const newTasks = (analysis.starter_tasks ?? []).map(task => {
            const due = offset(startDate, task.day - 1);
            return { title: task.title, criteria: task.criteria, due_on: due > ends ? ends : due };
        });
        blank({ title: analysis.title, goal: analysis.goal, new_tasks: newTasks });
    }
    function close() {
        setDraft(null);
        setNotes(null);
        setGenerated(null);
    }
    async function run(action) {
        if (running.current)
            return;
        running.current = true;
        setPending(true);
        setError('');
        try {
            await action();
        }
        catch (failure) {
            setError(failure instanceof Error ? failure.message : 'Could not save plan.');
        }
        finally {
            running.current = false;
            setPending(false);
        }
    }
    function save(event) {
        event.preventDefault();
        if (!draft)
            return;
        const publishNow = event.nativeEvent.submitter?.getAttribute('value') === 'publish';
        void run(async () => {
            setPhase(publishNow ? 'publishing' : 'saving');
            const cached = saved.current;
            let plan;
            if (cached && cached.draft === draft) {
                plan = cached.plan;
            }
            else {
                plan = await call(editing ? path + '/' + editing.id : path, {
                    method: editing ? 'PUT' : 'POST',
                    body: JSON.stringify({ ...draft, ...(editing ? { revision: editing.revision } : {}) }),
                });
                saved.current = { draft, plan };
                setEditing(plan);
            }
            if (publishNow)
                await publishSaved(plan);
            close();
            plans.reload();
        });
    }
    async function publishSaved(plan) {
        setPhase('publishing');
        const published = await call(path + '/' + plan.id + '/publish', {
            method: 'POST', body: JSON.stringify({ revision: plan.revision }),
        });
        setReceipt(published);
        refreshTasks();
    }
    function publish(plan) {
        void run(async () => {
            await publishSaved(plan);
            plans.reload();
        });
    }
    const status = (plan) => !plan.published_at ? ['Draft', 'neutral']
        : today < plan.starts_on ? ['Upcoming', 'brand'] : today > plan.ends_on ? ['Past', 'neutral'] : ['Active', 'success'];
    const groups = ['Draft', 'Active', 'Upcoming', 'Past']
        .map(label => [label === 'Draft' ? 'Drafts' : label, (plans.data ?? []).filter(plan => status(plan)[0] === label)])
        .filter(([, list]) => list.length > 0);
    const taskOf = (id) => tasks.find(task => task.id === id);
    function byDay(ids) {
        const days = new Map();
        for (const id of ids) {
            const due = taskOf(id)?.due_on ?? '';
            days.set(due, [...(days.get(due) ?? []), id]);
        }
        return [...days.entries()].sort(([a], [b]) => (a || '9999').localeCompare(b || '9999'));
    }
    return _jsxs("section", { className: "panel plans", "aria-label": "Plans", children: [_jsxs("header", { className: "panel-head", children: [_jsxs("div", { children: [_jsx("h2", { children: "Plans" }), _jsx("p", { children: mentor ? 'Draft the next period with AI or by hand, review it, then approve to assign the tasks.' : 'Plans your mentor has published.' })] }), mentor && !draft && _jsxs("div", { className: "actions", children: [_jsxs("button", { className: "secondary", disabled: pending, onClick: () => blank(), children: [_jsx(Icon, { name: "plus", size: 16 }), "Write plan"] }), _jsxs("button", { disabled: pending || !ai.data?.configured, onClick: () => { setError(''); setGenerating(true); }, title: ai.data && !ai.data.configured ? 'AI drafting is not configured on the server' : undefined, children: [_jsx(Icon, { name: "sparkle", size: 16 }), "Generate draft"] })] })] }), mentor && _jsx(CvPanel, { call: call, org: orgId, path: path.replace(/\/plans$/, "/cv"), startPlan: startFromCv }), mentor && !draft && ai.data && !ai.data.configured && _jsx("p", { className: "fine", children: "AI drafting is off on this server. You can still write plans manually." }), mentor && ai.error && !draft && _jsx("p", { className: "fine", children: "Could not check whether AI drafting is available." }), _jsx(Modal, { open: generating, wide: true, onClose: () => setGenerating(false), title: `Draft the next period for ${internLabel}`, description: "Based on this internship\u2019s open tasks, reviews and shared notes. Files are not sent. Nothing is saved or assigned until you approve.", children: _jsx(GenerateDraft, { call: call, path: path, starts: starts, ends: ends, defaultStart: startDate, initial: lastRequest, onCancel: () => setGenerating(false), onManual: request => { setLastRequest(request); blank({ starts_on: request.starts_on, ends_on: request.ends_on, goal: request.goal, project: request.project }); }, onDraft: (result, request) => { setReceipt(null); setLastRequest(request); setGenerated(result); open(result.draft, null, result.notes); } }) }), error && _jsx(ErrorNote, { message: error, retryLabel: "Reload plans", onRetry: () => { setError(''); plans.reload(); } }), plans.error && _jsx(ErrorNote, { message: plans.error, onRetry: plans.reload }), !plans.data && !plans.error && _jsx(Loading, { rows: 2 }), draft && _jsx(PlanEditor, { draft: draft, setDraft: setDraft, notes: notes, setNotes: setNotes, starts: starts, ends: ends, tasks: tasks, heading: editing ? 'Edit draft' : generated ? 'Review the AI draft' : 'New plan', pending: pending, phase: phase, onSave: save, onCancel: close, workload: generated?.workload, warnings: generated?.warnings, taskHref: taskHref, banner: generated && _jsxs("div", { className: "notice ai-banner", role: "status", children: [_jsx(Icon, { name: "sparkle" }), _jsx(AiVote, { call: call, org: orgId, id: generated.ai_usage_id }, generated.ai_usage_id), _jsxs("span", { children: ["Drafted by ", generated.model, ". Check each task and edit what you need. Nothing is assigned until you approve.", ' ', _jsx("button", { type: "button", className: "link-btn", onClick: () => { close(); setGenerating(true); }, children: "Change inputs and generate again" })] })] }) }), plans.data?.length === 0 && !draft && _jsx(Empty, { icon: "calendar", title: "No plans yet", children: mentor ? 'Generate a draft for the next week or two, or write one yourself.' : 'Your mentor hasn’t shared a plan yet.' }), receipt && _jsxs("div", { role: "status", className: "notice success-note", children: [_jsx(Icon, { name: "check" }), _jsxs("span", { children: [_jsxs("b", { children: ["\u201C", receipt.title, "\u201D is published."] }), " ", receipt.draft.new_tasks.length, " new task", receipt.draft.new_tasks.length === 1 ? '' : 's', " assigned,", ' ', receipt.draft.carry.length, " carried. The intern has been notified."] }), _jsx("button", { type: "button", className: "ghost sm", onClick: () => setReceipt(null), children: "Dismiss" })] }), groups.map(([label, list]) => _jsxs("details", { className: "plan-group", open: label !== 'Past', children: [_jsxs("summary", { children: [_jsx("span", { children: label }), _jsx("span", { className: "count", children: list.length })] }), _jsx("ul", { className: "plan-list", children: list.map(plan => {
                            const [state, tone] = status(plan);
                            return _jsxs("li", { id: 'plan-' + plan.id, className: "plan-card", children: [_jsxs("header", { className: "plan-card-head", children: [_jsxs("div", { children: [_jsx("h3", { children: plan.title }), _jsxs("p", { className: "row-sub", children: [_jsx(Icon, { name: "calendar", size: 14 }), formatDate(plan.starts_on), " \u2013 ", formatDate(plan.ends_on), plan.project && ' · ' + plan.project] })] }), _jsx(Badge, { tone: tone, children: state })] }), _jsx("p", { className: "plan-goal", children: plan.goal }), plan.published_at ? _jsx("ol", { className: "plan-days", children: byDay(plan.task_ids).map(([due, ids]) => _jsxs("li", { children: [_jsx("time", { className: "plan-day", children: due ? new Date(due + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) : 'No date' }), _jsx("div", { className: "plan-day-tasks", children: ids.map(id => _jsxs("button", { className: "plan-task-link", onClick: () => openTask(id), children: [_jsx("span", { children: taskOf(id)?.title ?? 'Open task' }), _jsx(Icon, { name: "arrow", size: 15 })] }, id)) })] }, due || 'none')) }) : _jsxs(_Fragment, { children: [_jsxs("ul", { className: "draft-items", children: [plan.draft.carry.map(task => _jsxs("li", { children: [_jsx(Badge, { children: "Carried" }), _jsx("span", { className: "grow", children: task.title }), _jsx("span", { className: "muted", children: formatDate(task.due_on) })] }, task.id)), plan.draft.new_tasks.map((task, i) => _jsxs("li", { children: [_jsx(Badge, { tone: "brand", children: "New" }), _jsxs("span", { className: "grow", children: [_jsx("b", { children: task.title }), _jsx("span", { className: "row-sub", children: task.criteria })] }), _jsx("span", { className: "muted", children: formatDate(task.due_on) })] }, i))] }), mentor && _jsxs("div", { className: "actions actions-end", children: [_jsx("button", { className: "ghost danger-text", disabled: pending || !!draft, onClick: async () => {
                                                            if (!await confirmAction(`Delete the draft “${plan.title}”? Nothing was assigned yet, so no tasks are removed.`, 'Delete draft', true))
                                                                return;
                                                            void run(async () => { await call(path + '/' + plan.id, { method: 'DELETE' }); plans.reload(); });
                                                        }, children: "Delete draft" }), _jsx("button", { className: "secondary", disabled: pending || !!draft, onClick: () => edit(plan), children: "Edit draft" }), _jsxs("button", { disabled: pending || !!draft, onClick: () => publish(plan), children: [pending && phase === 'publishing' ? _jsx("span", { className: "btn-spinner", "aria-hidden": "true" }) : _jsx(Icon, { name: "check", size: 16 }), pending && phase === 'publishing' ? 'Assigning tasks…' : 'Approve and assign'] })] })] })] }, plan.id);
                        }) })] }, label))] });
}
