import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo, useState } from 'react';
import { useResource } from '../../lib/api';
import { ErrorNote, Icon, StatusBadge, displayName } from '../../ui';
const day = new Intl.DateTimeFormat('sv-SE');
const shift = (date, days) => { const next = new Date(date); next.setDate(next.getDate() + days); return next; };
function startOfWeek(date) { const d = new Date(date); d.setHours(12, 0, 0, 0); return shift(d, -((d.getDay() + 6) % 7)); }
/** An agenda of deadlines, two weeks at a time, grouped by day. It reads well on any width. */
export function Calendar({ call, orgId, role, openTask }) {
    const [anchor, setAnchor] = useState(() => startOfWeek(new Date()));
    const [hideDone, setHideDone] = useState(true);
    const end = shift(anchor, 13);
    const range = useResource(call, `/api/organizations/${orgId}/calendar?start=${day.format(anchor)}&end=${day.format(end)}`);
    const today = day.format(new Date());
    const days = useMemo(() => Array.from({ length: 14 }, (_, i) => day.format(shift(anchor, i))), [anchor]);
    const byDay = new Map();
    for (const item of range.data ?? [])
        if (!hideDone || item.status !== 'completed')
            byDay.set(item.due_on, [...(byDay.get(item.due_on) ?? []), item]);
    const label = (value) => new Date(value + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
    const span = `${new Date(days[0] + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${new Date(days[13] + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;
    const visibleDays = days.filter(value => byDay.has(value) || value === today);
    return _jsxs("div", { className: "stack", children: [_jsxs("div", { className: "toolbar", children: [_jsxs("div", { className: "toolbar-group", children: [_jsx("button", { className: "secondary sm", onClick: () => setAnchor(shift(anchor, -14)), "aria-label": "Previous two weeks", children: _jsx(Icon, { name: "back", size: 15 }) }), _jsx("button", { className: "secondary sm", onClick: () => setAnchor(startOfWeek(new Date())), children: "Today" }), _jsx("button", { className: "secondary sm", onClick: () => setAnchor(shift(anchor, 14)), "aria-label": "Next two weeks", children: _jsx(Icon, { name: "arrow", size: 15 }) }), _jsx("strong", { className: "toolbar-title", children: span })] }), _jsxs("label", { className: "check-inline", children: [_jsx("input", { type: "checkbox", checked: hideDone, onChange: e => setHideDone(e.target.checked) }), "Hide completed"] })] }), range.error && _jsx(ErrorNote, { message: range.error, onRetry: range.reload }), !range.data && !range.error && _jsx("div", { className: "agenda", children: [0, 1, 2].map(i => _jsx("div", { className: "skeleton", style: { height: '5rem' } }, i)) }), range.data && _jsxs("ol", { className: "agenda", children: [visibleDays.length === 0 && _jsx("li", { className: "empty-line", children: "No deadlines in these two weeks." }), visibleDays.map(value => _jsxs("li", { className: `agenda-day ${value === today ? 'today' : ''} ${value < today ? 'past' : ''}`, children: [_jsxs("div", { className: "agenda-date", children: [_jsx("span", { className: "agenda-dow", children: new Date(value + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short' }) }), _jsx("span", { className: "agenda-num", children: Number(value.slice(8)) })] }), _jsxs("div", { className: "agenda-items", children: [_jsxs("p", { className: "agenda-label", children: [value === today ? 'Today · ' : '', label(value)] }), (byDay.get(value) ?? []).length === 0 && _jsx("p", { className: "fine", children: "Nothing due today." }), (byDay.get(value) ?? []).map(item => _jsxs("button", { className: "agenda-item", onClick: () => openTask(item.internship_id, item.task_id), children: [_jsxs("span", { className: "row-primary", children: [_jsx("span", { className: "row-title", children: item.title }), _jsx("span", { className: "row-sub", children: [role !== 'intern' && displayName(item.intern_name, item.intern_email), item.program, item.estimated_hours ? `${Number(item.estimated_hours)} h` : null].filter(Boolean).join(' · ') })] }), _jsx(StatusBadge, { status: item.status })] }, item.task_id))] })] }, value))] })] });
}
