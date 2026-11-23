import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
const paths = {
    close: 'M6 6l12 12M18 6 6 18',
    menu: 'M4 7h16M4 12h16M4 17h16',
    user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8m-7 8a7 7 0 0 1 14 0',
    book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zm0 0v16M8 7h7',
    grid: 'M4 4h7v7H4zm9 0h7v7h-7zM4 13h7v7H4zm9 0h7v7h-7z',
    home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
    briefcase: 'M9 6V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V6m-12 1h18v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zm0 5h18',
    layers: 'm12 3 9 5-9 5-9-5zm-9 9 9 5 9-5m-18 4 9 5 9-5',
    bell: 'M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8m4.3 12a2 2 0 0 0 3.4 0',
    chat: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12',
    logout: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5m5 5H3',
    arrow: 'm9 6 6 6-6 6',
    back: 'm15 6-6 6 6 6',
    plus: 'M12 5v14M5 12h14',
    check: 'm5 12.5 4.5 4.5L19 7.5',
    clock: 'M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
    alert: 'M12 8v5m0 3.5v.5M10.3 3.9 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0',
    search: 'm20 20-4.5-4.5M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0',
    refresh: 'M20 11a8 8 0 0 0-14.9-3M4 4v4h4m-4 5a8 8 0 0 0 14.9 3M20 20v-4h-4',
    mail: 'M3 6.5A1.5 1.5 0 0 1 4.5 5h15A1.5 1.5 0 0 1 21 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5zm0 .5 9 6 9-6',
    calendar: 'M7 3v3m10-3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1',
    sparkle: 'M12 3v4m0 10v4M3 12h4m10 0h4M6 6l2.5 2.5m7 7L18 18M6 18l2.5-2.5m7-7L18 6',
    file: 'M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zm0 0v5h5M9 13h6m-6 4h4',
    shield: 'M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6zm-3.5 9 2.5 2.5 4.5-5',
};
export function Icon({ name, size = 18 }) {
    return _jsx("svg", { "aria-hidden": "true", className: "icon", width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round", children: _jsx("path", { d: paths[name] }) });
}
export function Badge({ tone = 'neutral', children }) {
    return _jsx("span", { className: `badge badge-${tone}`, children: children });
}
const statusMeta = {
    planned: { label: 'To do', tone: 'brand' },
    submitted: { label: 'Awaiting review', tone: 'warn' },
    changes_requested: { label: 'Changes requested', tone: 'danger' },
    completed: { label: 'Completed', tone: 'success' },
};
export function StatusBadge({ status }) {
    const meta = statusMeta[status] ?? { label: status, tone: 'neutral' };
    return _jsx(Badge, { tone: meta.tone, children: meta.label });
}
export function formatDate(value) {
    const date = value.length === 10 ? new Date(value + 'T12:00:00') : new Date(value);
    return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}
export function relativeDue(value) {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const days = Math.round((new Date(value + 'T12:00:00').getTime() - today.getTime()) / 86400000);
    if (days === 0)
        return { text: 'Due today', late: false, soon: true };
    if (days === 1)
        return { text: 'Due tomorrow', late: false, soon: true };
    if (days < 0)
        return { text: `${-days} day${days === -1 ? '' : 's'} overdue`, late: true, soon: false };
    if (days <= 7)
        return { text: `Due in ${days} days`, late: false, soon: true };
    return { text: `Due ${formatDate(value)}`, late: false, soon: false };
}
export function Due({ date }) {
    const due = relativeDue(date);
    return _jsxs("span", { className: `due ${due.late ? 'due-late' : due.soon ? 'due-soon' : ''}`, children: [_jsx(Icon, { name: "clock", size: 14 }), due.text] });
}
export function Empty({ icon, title, children }) {
    return _jsxs("div", { className: "empty", children: [_jsx("span", { className: "empty-icon", children: _jsx(Icon, { name: icon, size: 22 }) }), _jsx("strong", { children: title }), children && _jsx("p", { children: children })] });
}
export function Loading({ label = 'Loading…', rows = 3 }) {
    return _jsx("div", { role: "status", "aria-label": label, className: "skeleton-list", children: Array.from({ length: rows }, (_, i) => _jsx("div", { className: "skeleton" }, i)) });
}
export function ErrorNote({ message, onRetry, retryLabel = 'Try again' }) {
    return _jsxs("div", { role: "alert", className: "notice error", children: [_jsx(Icon, { name: "alert" }), _jsx("span", { children: message }), onRetry && _jsxs("button", { type: "button", className: "ghost sm", onClick: onRetry, children: [_jsx(Icon, { name: "refresh", size: 15 }), retryLabel] })] });
}
export function SectionHead({ title, subtitle, action }) {
    return _jsxs("div", { className: "section-head", children: [_jsxs("div", { children: [_jsx("h2", { children: title }), subtitle && _jsx("p", { children: subtitle })] }), action] });
}
/** A person's display name: their profile name, or their email when no name is set. */
export function displayName(name, email) {
    return name?.trim() || email || 'Unknown';
}
export function initials(name, email) {
    const source = name?.trim();
    if (source)
        return source.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
    return (email ?? '?').slice(0, 1).toUpperCase();
}
export function Avatar({ name, email, size = 'md' }) {
    return _jsx("span", { className: `avatar avatar-${size}`, "aria-hidden": "true", children: initials(name, email) });
}
/** Name first, email as secondary identification. */
export function Person({ name, email, detail, size = 'md' }) {
    return _jsxs("span", { className: "person", children: [_jsx(Avatar, { name: name, email: email, size: size }), _jsxs("span", { className: "person-text", children: [_jsx("span", { className: "person-name", children: displayName(name, email) }), (detail ?? (name ? email : null)) && _jsx("span", { className: "person-detail", children: detail ?? email })] })] });
}
export function Progress({ done, total, label }) {
    const percent = total ? Math.round((done / total) * 100) : 0;
    return _jsx("span", { className: "meter", role: "progressbar", "aria-valuemin": 0, "aria-valuemax": total, "aria-valuenow": done, "aria-label": label ?? `${done} of ${total} done`, children: _jsx("span", { className: "meter-fill", style: { width: `${percent}%` } }) });
}
/** Accessible dialog on top of the native <dialog>: focus stays inside, Escape closes, focus returns to the opener. */
export function Modal({ open, title, description, onClose, children, footer, wide = false }) {
    const ref = useRef(null);
    const opener = useRef(null);
    useEffect(() => {
        const dialog = ref.current;
        if (!dialog)
            return;
        if (open && !dialog.open) {
            opener.current = document.activeElement;
            dialog.showModal();
            // Prefer an explicitly marked field, then the first form field, then any button except Close.
            const first = dialog.querySelector('[data-autofocus]') ?? dialog.querySelector('input, textarea, select')
                ?? dialog.querySelector('button:not(.modal-close)');
            first?.focus();
        }
        else if (!open && dialog.open) {
            dialog.close();
        }
    }, [open]);
    useEffect(() => () => { if (opener.current instanceof HTMLElement)
        opener.current.focus(); }, []);
    return _jsx("dialog", { ref: ref, className: `modal ${wide ? 'modal-wide' : ''}`, "aria-labelledby": "modal-title", onCancel: event => { event.preventDefault(); onClose(); }, onClose: () => { if (opener.current instanceof HTMLElement)
            opener.current.focus(); }, onClick: event => { if (event.target === ref.current)
            onClose(); }, children: open && _jsxs("div", { className: "modal-body", children: [_jsxs("header", { className: "modal-head", children: [_jsxs("div", { children: [_jsx("h2", { id: "modal-title", children: title }), description && _jsx("p", { children: description })] }), _jsx("button", { type: "button", className: "ghost sm modal-close", onClick: onClose, "aria-label": "Close", children: _jsx(Icon, { name: "close", size: 18 }) })] }), _jsx("div", { className: "modal-content", children: children }), footer && _jsx("footer", { className: "modal-foot", children: footer })] }) });
}
let showConfirm = null;
/** In-app confirmation. Browser confirm() dialogs can be blocked silently, which made buttons look broken. */
export function confirmAction(message, confirmLabel = 'Confirm', danger = false) {
    return new Promise(resolve => showConfirm ? showConfirm({ message, confirmLabel, danger, resolve }) : resolve(true));
}
/** Mount once near the root. */
export function ConfirmHost() {
    const [request, setRequest] = useState(null);
    useEffect(() => { showConfirm = setRequest; return () => { showConfirm = null; }; }, []);
    const finish = (ok) => { request?.resolve(ok); setRequest(null); };
    return _jsx(Modal, { open: !!request, onClose: () => finish(false), title: "Please confirm", children: _jsxs("div", { className: "grid gap-4", children: [_jsx("p", { className: "prose-text", children: request?.message }), _jsxs("div", { className: "modal-actions", children: [_jsx("button", { type: "button", className: "ghost", onClick: () => finish(false), children: "Cancel" }), _jsx("button", { type: "button", className: request?.danger ? 'danger-btn' : undefined, "data-autofocus": true, onClick: () => finish(true), children: request?.confirmLabel })] })] }) });
}
