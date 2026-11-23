import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useResource } from '../../lib/api';
import { ErrorNote, Icon } from '../../ui';
import { OverviewSkeleton, TaskRow } from './Overview';
/** Mentor: submissions to review, then work with interns. Intern and admin: open tasks by state. */
export function TaskQueue({ call, orgId, role, openTask }) {
    const queue = useResource(call, `/api/organizations/${orgId}/overview`);
    if (queue.error)
        return _jsx(ErrorNote, { message: "Could not load tasks.", onRetry: queue.reload });
    if (!queue.data)
        return _jsx(OverviewSkeleton, {});
    const items = queue.data.items;
    const groups = role === 'mentor'
        ? [['Waiting for your review', 'Oldest first', items.filter(i => i.status === 'submitted')],
            ['Sent back to interns', 'Changes requested', items.filter(i => i.status === 'changes_requested')],
            ['Not started', 'Planned work', items.filter(i => i.status === 'planned')]]
        : [['Needs changes', 'Your mentor asked for changes', items.filter(i => i.status === 'changes_requested')],
            ['To do', 'By deadline', items.filter(i => i.status === 'planned')],
            ['Waiting for review', 'With the mentor', items.filter(i => i.status === 'submitted')]];
    return _jsxs("div", { className: "stack", children: [queue.data.counts.open > items.length && _jsxs("p", { className: "fine", children: ["Showing the ", items.length, " most urgent of ", queue.data.counts.open, " open tasks."] }), groups.map(([title, hint, list]) => _jsxs("section", { className: "panel", children: [_jsx("header", { className: "panel-head", children: _jsxs("div", { children: [_jsxs("h2", { children: [title, _jsx("span", { className: "count", children: list.length })] }), _jsx("p", { children: hint })] }) }), list.length === 0 ? _jsxs("p", { className: "empty-line", children: [_jsx(Icon, { name: "check", size: 16 }), "Nothing here."] })
                        : _jsx("ul", { className: "rows", children: list.map(item => _jsx(TaskRow, { item: item, showIntern: role !== 'intern', action: role === 'mentor' && item.status === 'submitted' ? 'Review' : undefined, onOpen: () => openTask(item.internship_id, item.task_id) }, item.task_id)) })] }, title))] });
}
