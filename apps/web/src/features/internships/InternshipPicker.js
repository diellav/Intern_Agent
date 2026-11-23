import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect } from 'react';
import { useResource } from '../../lib/api';
import { Empty, ErrorNote, Icon, Person, Progress } from '../../ui';
/** Plans and notes belong to one internship. With a single internship the picker steps aside. */
export function InternshipPicker({ call, orgId, role, purpose, open }) {
    const list = useResource(call, `/api/organizations/${orgId}/internships`);
    const only = list.data?.length === 1 ? list.data[0].id : null;
    // Replace the history entry so Back does not bounce into this forward again.
    useEffect(() => { if (only)
        open(only, true); }, [only, open]);
    if (list.error)
        return _jsx(ErrorNote, { message: list.error, onRetry: list.reload });
    if (!list.data || only)
        return _jsx("div", { className: "picker-grid", children: [0, 1, 2].map(i => _jsx("div", { className: "skeleton", style: { height: '7.5rem', borderRadius: 'var(--r-lg)' } }, i)) });
    if (list.data.length === 0)
        return _jsx(Empty, { icon: "briefcase", title: "No internships yet", children: role === 'intern' ? 'You’ll see your internship once an admin assigns it.' : 'Internships appear here once they are assigned.' });
    return _jsxs("div", { className: "stack", children: [_jsxs("p", { className: "lead", children: ["Choose an internship to open its ", purpose === 'plan' ? 'plan' : 'notes', "."] }), _jsx("ul", { className: "picker-grid", children: list.data.map(item => _jsx("li", { children: _jsxs("button", { className: "pick-card", onClick: () => open(item.id), children: [_jsx(Person, { name: role === 'intern' ? item.mentor_name : item.intern_name, email: role === 'intern' ? item.mentor_email : item.intern_email, detail: item.program_name, size: "lg" }), _jsxs("span", { className: "pick-progress", children: [_jsx(Progress, { done: item.completed_count, total: item.task_count }), _jsxs("span", { children: [item.completed_count, "/", item.task_count, " tasks done"] })] }), _jsxs("span", { className: "pick-action", children: [purpose === 'plan' ? 'Open plan' : 'Open notes', _jsx(Icon, { name: "arrow", size: 16 })] })] }) }, item.id)) })] });
}
