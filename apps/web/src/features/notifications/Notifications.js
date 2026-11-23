import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { useResource } from '../../lib/api';
import { ErrorNote, Icon, Loading, formatDate } from '../../ui';
const meta = {
    assigned: { label: 'New task assigned', icon: 'plus', tone: 'tone-brand' },
    submitted: { label: 'Work submitted for review', icon: 'file', tone: 'tone-warn' },
    completed: { label: 'Submission approved', icon: 'check', tone: 'tone-success' },
    changes_requested: { label: 'Changes requested', icon: 'refresh', tone: 'tone-danger' },
    plan_published: { label: 'New plan published', icon: 'calendar', tone: 'tone-brand' },
};
function when(value) {
    const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
    if (minutes < 1)
        return 'Just now';
    if (minutes < 60)
        return `${minutes} min ago`;
    if (minutes < 1440)
        return `${Math.round(minutes / 60)} h ago`;
    return formatDate(value);
}
export function Notifications({ call, orgId, openTask, openPlan, onRead, compact = false }) {
    const [unreadOnly, setUnreadOnly] = useState(false);
    const path = `/api/organizations/${orgId}/notifications`;
    const inbox = useResource(call, unreadOnly ? path + '?unread=true' : path);
    const [pending, setPending] = useState(null);
    const [error, setError] = useState('');
    async function open(item) {
        setPending(item.id);
        setError('');
        try {
            if (!item.read_at) {
                const { read_at } = await call(`${path}/${item.id}/read`, { method: 'POST' });
                inbox.setData(items => items?.map(notice => notice.id === item.id ? { ...notice, read_at } : notice) ?? null);
                onRead();
            }
            if (item.task_id)
                openTask(item.internship_id, item.task_id, item.version ?? undefined);
            else
                openPlan(item.internship_id);
        }
        catch {
            setError('Could not open the notification. Try again.');
            setPending(null);
        }
    }
    const items = compact ? inbox.data?.slice(0, 5) : inbox.data;
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const buckets = new Map();
    for (const item of items ?? []) {
        const day = new Date(item.created_at).toDateString();
        const group = day === today.toDateString() ? 'Today' : day === yesterday.toDateString() ? 'Yesterday' : 'Earlier';
        buckets.set(group, [...(buckets.get(group) ?? []), item]);
    }
    const unreadCount = items?.filter(item => !item.read_at).length ?? 0;
    return _jsxs("section", { className: "panel inbox", children: [!compact && _jsxs("header", { className: "panel-head", children: [_jsxs("div", { className: "segmented", role: "group", "aria-label": "Inbox view", children: [_jsx("button", { type: "button", "aria-pressed": !unreadOnly, onClick: () => setUnreadOnly(false), children: "All" }), _jsxs("button", { type: "button", "aria-pressed": unreadOnly, onClick: () => setUnreadOnly(true), children: ["Unread", !unreadOnly && unreadCount ? _jsx("span", { className: "seg-count", children: unreadCount }) : null] })] }), _jsxs("button", { className: "ghost sm", disabled: pending !== null, onClick: inbox.reload, children: [_jsx(Icon, { name: "refresh", size: 15 }), "Refresh"] })] }), (error || inbox.error) && _jsx(ErrorNote, { message: error || 'Could not load notifications.', onRetry: error ? undefined : inbox.reload }), !items && !inbox.error && _jsx(Loading, { rows: compact ? 2 : 4 }), items?.length === 0 && _jsxs("p", { className: "empty-line", children: [_jsx(Icon, { name: "bell", size: 16 }), unreadOnly ? 'No unread notifications.' : 'You’re all caught up.'] }), [...buckets].map(([label, group]) => _jsxs("section", { className: "inbox-day", children: [_jsx("h3", { children: label }), _jsx("ul", { children: group.map(item => {
                            const kind = meta[item.event];
                            return _jsx("li", { children: _jsxs("button", { className: `inbox-row ${item.read_at ? 'read' : 'unread'}`, "aria-disabled": pending !== null, onClick: () => { if (pending === null)
                                        void open(item); }, children: [_jsx("span", { className: `inbox-icon ${kind.tone}`, "aria-hidden": "true", children: _jsx(Icon, { name: kind.icon, size: 16 }) }), _jsxs("span", { className: "row-primary", children: [_jsxs("span", { className: "row-title", children: [item.title, item.version ? _jsxs("span", { className: "version-tag", children: ["v", item.version] }) : null] }), _jsxs("span", { className: "row-sub", children: [kind.label, item.version ? ` · version ${item.version}` : ''] })] }), _jsx("time", { className: "muted", dateTime: item.created_at, children: when(item.created_at) }), item.read_at ? _jsx("span", { className: "sr-only", children: "Read" }) : _jsx("span", { className: "unread-dot", "aria-label": "Unread" })] }) }, item.id);
                        }) })] }, label)), !compact && !!items?.length && _jsx("p", { className: "fine", children: "The 50 most recent are listed. Opening one marks it read." })] });
}
