import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useResource } from '../../lib/api';
import { ErrorNote, Icon, Loading, formatDate } from '../../ui';
const meta = {
    plan: { label: 'Plan published', icon: 'calendar' },
    submission: { label: 'Work submitted', icon: 'file' },
    review: { label: 'Mentor review', icon: 'check' },
};
export function Activity({ call, path, open }) {
    const activity = useResource(call, path);
    return _jsxs("section", { className: "panel", children: [_jsx("header", { className: "panel-head", children: _jsxs("div", { children: [_jsx("h2", { children: "Activity" }), _jsx("p", { children: "Plans, submissions and reviews, newest first." })] }) }), activity.error && _jsx(ErrorNote, { message: activity.error, onRetry: activity.reload }), !activity.data && !activity.error && _jsx(Loading, {}), activity.data?.length === 0 && _jsxs("p", { className: "empty-line", children: [_jsx(Icon, { name: "clock", size: 16 }), "No activity yet."] }), _jsx("ol", { className: "activity-list", children: activity.data?.map((event, index) => _jsx("li", { children: _jsxs("button", { className: "activity-row", onClick: () => open(event), children: [_jsx("span", { className: `activity-dot ${event.kind}`, "aria-hidden": "true", children: _jsx(Icon, { name: meta[event.kind].icon, size: 14 }) }), _jsxs("span", { className: "row-primary", children: [_jsx("span", { className: "row-title", children: event.title }), _jsxs("span", { className: "row-sub", children: [meta[event.kind].label, event.version ? ` · Version ${event.version}` : ''] })] }), _jsx("time", { className: "muted", dateTime: event.occurred_at, children: formatDate(event.occurred_at) })] }) }, index)) })] });
}
