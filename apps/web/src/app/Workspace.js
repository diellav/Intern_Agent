import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { QuestionSource } from '../features/questions/QuestionSource';
import { AiUsage } from '../features/ai/AiUsage';
import { ProgressReports } from '../features/progress/ProgressReports';
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, useResource } from '../lib/api';
import { Avatar, ErrorNote, Icon, Modal, displayName, ConfirmHost } from '../ui';
import { Overview } from '../features/overview/Overview';
import { Internships } from '../features/internships/Internships';
import { InternshipPicker } from '../features/internships/InternshipPicker';
import { Members } from '../features/members/Members';
import { Programs } from '../features/programs/Programs';
import { Notifications } from '../features/notifications/Notifications';
import { Questions } from '../features/questions/Questions';
import { Calendar } from '../features/calendar/Calendar';
import { TaskQueue } from '../features/overview/TaskQueue';
import { formatView, parseView } from './routes';
import { Brand, PRODUCT } from './Brand';
function navigation(role) {
    const item = (id, label, icon, blurb, title = label) => ({ id, label, icon, title, blurb });
    const groups = [
        { label: 'Workspace', items: [
                item('overview', 'Overview', 'home', role === 'mentor' ? 'Reviews waiting for you, then your interns.'
                    : role === 'intern' ? 'What to work on next.' : 'Your organization at a glance.'),
                item('internships', 'Internships', 'briefcase', role === 'admin' ? 'Every internship in your organization.'
                    : role === 'mentor' ? 'The interns you mentor.' : 'Your internship, plan and history.'),
                item('progress', 'Progress reports', 'layers', 'Review progress and open the supporting work.'),
                item('calendar', 'Calendar', 'calendar', 'Task deadlines you can see, day by day.'),
            ] },
        { label: 'Planning', items: [
                item('plans', 'Plans', 'layers', role === 'mentor' ? 'Choose an intern to draft or review a plan.' : 'Plans for the internships you can see.'),
                role === 'mentor'
                    ? item('reviews', 'Reviews', 'check', 'Submissions waiting for your decision.')
                    : item('reviews', 'Tasks', 'file', role === 'intern' ? 'All your open tasks.' : 'Open tasks across the organization.'),
            ] },
        { label: 'Updates', items: [item('notifications', 'Notifications', 'bell', 'Everything addressed to you, newest first.')] },
        { label: 'Knowledge', items: [
                item('questions', 'Q&A', 'chat', 'Search answers or ask your own question.', 'Questions & answers'),
                ...(role !== 'admin' ? [item('notes', 'Notes', 'book', role === 'mentor' ? 'Private and shared notes per intern.' : 'Notes your mentor shared with you.')] : []),
                ...(role !== 'admin' ? [item('programs', 'Programs', 'grid', 'Programs and the internships you can open.')] : []),
            ] },
    ];
    if (role === 'admin')
        groups.push({ label: 'Management', items: [
                item('programs', 'Programs', 'grid', 'Programs, their descriptions and internships.'),
                item('ai-usage', 'AI usage', 'layers', 'Review AI requests and feedback.'),
                item('members', 'Members', 'user', 'Invite people and manage organization access.'),
                item('assignments', 'Assignments', 'user', 'Pair interns with mentors for a program.'),
            ] });
    return groups;
}
const mobileTabs = ['overview', 'internships', 'calendar', 'reviews'];
/** Counts requests in flight so the top bar can show that something is happening. */
function useActivity(call) {
    const [active, setActive] = useState(0);
    const tracked = useCallback((path, init) => {
        setActive(n => n + 1);
        return call(path, init).finally(() => setActive(n => n - 1));
    }, [call]);
    const [visible, setVisible] = useState(false);
    useEffect(() => {
        if (!active) {
            setVisible(false);
            return;
        }
        const timer = setTimeout(() => setVisible(true), 150); // no flicker for quick requests
        return () => clearTimeout(timer);
    }, [active]);
    return { call: tracked, busy: visible };
}
function NameDialog({ open, me, call, onClose, onSaved }) {
    const [name, setName] = useState(me.full_name ?? '');
    const [pending, setPending] = useState(false);
    const [error, setError] = useState('');
    async function save(event) {
        event.preventDefault();
        if (pending || !name.trim())
            return;
        setPending(true);
        setError('');
        try {
            const saved = await call('/api/me/profile', { method: 'PUT', body: JSON.stringify({ full_name: name.trim() }) });
            onSaved(saved.full_name);
            onClose();
        }
        catch (failure) {
            setError(failure instanceof Error ? failure.message : 'Could not save your name.');
        }
        finally {
            setPending(false);
        }
    }
    return _jsx(Modal, { open: open, onClose: onClose, title: "Your display name", description: "Shown to people who already work with you. Your email stays the same.", children: _jsxs("form", { id: "name-form", onSubmit: save, className: "grid gap-3", children: [_jsxs("label", { children: ["Full name", _jsx("input", { autoFocus: true, maxLength: 120, value: name, onChange: e => setName(e.target.value), placeholder: "First and last name" })] }), error && _jsx(ErrorNote, { message: error }), _jsxs("div", { className: "modal-actions", children: [_jsx("button", { type: "button", className: "ghost", onClick: onClose, children: "Cancel" }), _jsxs("button", { disabled: pending || !name.trim(), children: [pending && _jsx("span", { className: "btn-spinner", "aria-hidden": "true" }), pending ? 'Saving…' : 'Save name'] })] })] }) });
}
export function Workspace({ session, call: rawCall, memberships, me: initialMe }) {
    const { call, busy } = useActivity(rawCall);
    const [selected, setSelected] = useState(memberships[0].organization_id);
    const membership = memberships.find(item => item.organization_id === selected) ?? memberships[0];
    const org = membership.organization_id;
    const role = membership.role;
    const [me, setMe] = useState(initialMe);
    const [view, setView] = useState(() => parseView(location.hash));
    const [notificationsOpen, setNotificationsOpen] = useState(false);
    const notificationArea = useRef(null);
    const bell = useRef(null);
    const [menuOpen, setMenuOpen] = useState(false);
    const [moreOpen, setMoreOpen] = useState(false);
    const [nameOpen, setNameOpen] = useState(false);
    const [signOutError, setSignOutError] = useState('');
    const unread = useResource(call, `/api/organizations/${org}/notifications/unread-count`);
    const reloadUnread = unread.reload;
    const lastTab = useRef(view.tab);
    const groups = navigation(role);
    const items = groups.flatMap(group => group.items);
    const navigate = useCallback((next, options) => {
        const hash = formatView(next);
        if (hash !== location.hash)
            history[options?.replace ? 'replaceState' : 'pushState'](null, '', hash);
        setNotificationsOpen(false);
        setView(next);
        setMoreOpen(false);
        setMenuOpen(false);
    }, []);
    useEffect(() => {
        // Back/Forward fire popstate; a hash typed or pasted into the address bar fires hashchange.
        const sync = () => { setNotificationsOpen(false); setView(parseView(location.hash)); };
        window.addEventListener('popstate', sync);
        window.addEventListener('hashchange', sync);
        return () => { window.removeEventListener('popstate', sync); window.removeEventListener('hashchange', sync); };
    }, []);
    useEffect(() => { window.scrollTo({ top: 0 }); }, [view]);
    useEffect(() => {
        if (lastTab.current !== view.tab)
            reloadUnread();
        lastTab.current = view.tab;
    }, [view.tab, reloadUnread]);
    useEffect(() => {
        if (!menuOpen)
            return;
        const close = (event) => {
            if (event instanceof KeyboardEvent ? event.key === 'Escape' : !event.target.closest('.user-menu'))
                setMenuOpen(false);
        };
        document.addEventListener('click', close);
        document.addEventListener('keydown', close);
        return () => { document.removeEventListener('click', close); document.removeEventListener('keydown', close); };
    }, [menuOpen]);
    useEffect(() => {
        if (!notificationsOpen)
            return;
        const outside = (event) => {
            if (event.target instanceof Node && !notificationArea.current?.contains(event.target))
                setNotificationsOpen(false);
        };
        const escape = (event) => {
            if (event.key === 'Escape') {
                setNotificationsOpen(false);
                bell.current?.focus();
            }
        };
        document.addEventListener('pointerdown', outside);
        document.addEventListener('keydown', escape);
        return () => {
            document.removeEventListener('pointerdown', outside);
            document.removeEventListener('keydown', escape);
        };
    }, [notificationsOpen]);
    const current = items.find(item => item.id === view.tab)
        ?? { id: view.tab, label: 'Notifications', icon: 'bell', title: 'Notifications', blurb: 'Everything addressed to you, newest first.' };
    useEffect(() => { document.title = `${current.title} · ${PRODUCT}`; }, [current.title]);
    const openTask = (internshipId, taskId, version) => navigate({ tab: 'internships', internshipId, section: 'tasks', taskId, version });
    const openSection = useCallback((internshipId, section, replace = false) => navigate({ tab: 'internships', internshipId, section }, { replace }), [navigate]);
    const count = unread.data?.unread ?? 0;
    const countLabel = count > 99 ? '99+' : String(count);
    const showHeading = !(view.tab === 'internships' && view.internshipId);
    const switcher = memberships.length > 1 && _jsx("select", { "aria-label": "Organization", value: org, onChange: event => {
            setSelected(event.target.value);
            navigate({ tab: 'overview' });
        }, children: memberships.map(item => _jsxs("option", { value: item.organization_id, children: [item.organization_name, " \u00B7 ", item.role] }, item.organization_id)) });
    const navButton = (item) => _jsxs("button", { className: "nav-item", "aria-current": view.tab === item.id ? 'page' : undefined, onClick: () => navigate({ tab: item.id }), children: [_jsx(Icon, { name: item.icon }), _jsx("span", { children: item.label })] }, item.id + item.label);
    async function signOut() {
        const result = await supabase?.auth.signOut();
        setSignOutError(result?.error ? 'Could not sign out. Try again.' : '');
        if (!result?.error)
            history.replaceState(null, '', location.pathname);
    }
    return _jsxs("div", { className: "shell", children: [_jsxs("header", { className: "topbar", children: [_jsx("a", { className: "brand-link", href: "#/overview", onClick: event => { event.preventDefault(); navigate({ tab: 'overview' }); }, "aria-label": "Overview", children: _jsx(Brand, {}) }), _jsxs("div", { className: "topbar-actions", children: [signOutError && _jsx("span", { className: "fine", role: "alert", children: signOutError }), _jsxs("div", { className: "notification-anchor", ref: notificationArea, children: [_jsxs("button", { ref: bell, className: "icon-btn bell", "aria-label": count ? `Notifications, ${count} unread` : 'Notifications', "aria-expanded": notificationsOpen, "aria-controls": notificationsOpen ? 'notification-preview' : undefined, onClick: () => { setMenuOpen(false); setNotificationsOpen(open => !open); reloadUnread(); }, children: [_jsx(Icon, { name: "bell", size: 20 }), count > 0 && _jsx("span", { className: "bell-count", "aria-hidden": "true", children: countLabel })] }), notificationsOpen && _jsxs("section", { id: "notification-preview", className: "notification-preview", "aria-label": "Recent notifications", children: [_jsxs("header", { children: [_jsx("h2", { children: "Notifications" }), _jsxs("span", { className: "fine", children: [count, " unread"] })] }), _jsx("div", { className: "notification-preview-list", children: _jsx(Notifications, { compact: true, call: call, orgId: org, openTask: openTask, openPlan: id => openSection(id, 'plan'), onRead: reloadUnread }) }), _jsx("footer", { children: _jsxs("button", { className: "link-btn", onClick: () => {
                                                        navigate({ tab: 'notifications' });
                                                        document.getElementById('main')?.focus();
                                                    }, children: ["See all notifications ", _jsx(Icon, { name: "arrow", size: 15 })] }) })] })] }), _jsxs("div", { className: "user-menu", children: [_jsxs("button", { className: "user-button", "aria-haspopup": "menu", "aria-expanded": menuOpen, onClick: () => setMenuOpen(open => !open), children: [_jsx(Avatar, { name: me.full_name, email: me.email }), _jsxs("span", { className: "user-text", children: [_jsx("b", { children: displayName(me.full_name, me.email) }), _jsx("span", { children: role })] })] }), menuOpen && _jsxs("div", { className: "menu", role: "menu", children: [_jsxs("div", { className: "menu-head", children: [_jsx("b", { children: displayName(me.full_name, me.email) }), _jsx("span", { children: me.email })] }), _jsxs("button", { role: "menuitem", onClick: () => { setMenuOpen(false); setNameOpen(true); }, children: [_jsx(Icon, { name: "user", size: 16 }), me.full_name ? 'Change display name' : 'Add your name'] }), _jsxs("button", { role: "menuitem", onClick: () => void signOut(), children: [_jsx(Icon, { name: "logout", size: 16 }), "Sign out"] })] })] })] }), _jsx("div", { className: `activity ${busy ? 'on' : ''}`, role: "progressbar", "aria-hidden": !busy, "aria-label": "Loading" })] }), _jsxs("aside", { className: "sidebar", "aria-label": "Main navigation", children: [_jsx("nav", { children: groups.map(group => _jsxs("div", { className: "nav-group", children: [_jsx("p", { className: "nav-group-label", children: group.label }), group.items.map(navButton)] }, group.label)) }), _jsxs("div", { className: "org-card", children: [_jsx("span", { className: "fine", children: "Organization" }), _jsx("strong", { children: membership.organization_name }), _jsxs("span", { className: "fine", children: ["Your role here: ", _jsx("b", { style: { textTransform: 'capitalize' }, children: role }), role !== 'admin' ? ' · Management is for admins' : ''] }), switcher] })] }), _jsxs("nav", { className: "bottom-nav", "aria-label": "Main navigation", children: [mobileTabs.map(id => items.find(item => item.id === id)).filter(Boolean).map(item => _jsxs("button", { "aria-current": view.tab === item.id ? 'page' : undefined, onClick: () => navigate({ tab: item.id }), children: [_jsx(Icon, { name: item.icon }), _jsx("span", { children: item.label })] }, item.id)), _jsxs("button", { "aria-expanded": moreOpen, onClick: () => setMoreOpen(true), children: [_jsx(Icon, { name: "menu" }), _jsx("span", { children: "More" })] })] }), _jsx(Modal, { open: moreOpen, onClose: () => setMoreOpen(false), title: "Menu", children: _jsxs("nav", { className: "sheet-nav", children: [groups.map(group => _jsxs("div", { className: "nav-group", children: [_jsx("p", { className: "nav-group-label", children: group.label }), group.items.map(navButton)] }, group.label)), switcher && _jsxs("label", { className: "grid gap-1", children: ["Organization", switcher] })] }) }), _jsx(NameDialog, { open: nameOpen, me: me, call: call, onClose: () => setNameOpen(false), onSaved: full_name => setMe({ ...me, full_name }) }), _jsx(ConfirmHost, {}), _jsxs("main", { className: "workspace", id: "main", tabIndex: -1, children: [showHeading && _jsx("header", { className: "page-head", children: _jsxs("div", { children: [_jsx("h1", { children: current.title }), _jsx("p", { children: current.blurb })] }) }), unread.error && view.tab === 'notifications' && _jsx(ErrorNote, { message: "Could not load the unread count.", onRetry: reloadUnread }), _jsx("div", { className: "page", children: view.tab === 'overview' ? _jsx(Overview, { call: call, orgId: org, role: role, me: me, actions: {
                                openTask, openPlan: id => openSection(id, 'plan'), openInternship: id => openSection(id, 'tasks'),
                                openProgram: programId => navigate({ tab: 'internships', programId }), go: tab => navigate({ tab }),
                            } })
                            : view.tab === 'internships' || view.tab === 'assignments'
                                ? _jsx(Internships, { call: call, orgId: org, role: role, view: view.tab === 'assignments' ? { tab: 'internships' } : view, navigate: navigate, manage: view.tab === 'assignments' })
                                : view.tab === 'progress' ? _jsx(ProgressReports, { canEdit: role !== 'intern', call: call, orgId: org, openTask: openTask }, org)
                                    : view.tab === 'calendar' ? _jsx(Calendar, { call: call, orgId: org, role: role, openTask: openTask })
                                        : view.tab === 'plans' ? _jsx(InternshipPicker, { call: call, orgId: org, role: role, purpose: "plan", open: (id, replace) => openSection(id, 'plan', replace) })
                                            : view.tab === 'notes' ? _jsx(InternshipPicker, { call: call, orgId: org, role: role, purpose: "notes", open: (id, replace) => openSection(id, 'notes', replace) })
                                                : view.tab === 'reviews' ? _jsx(TaskQueue, { call: call, orgId: org, role: role, openTask: openTask })
                                                    : view.tab === 'programs' ? _jsx(Programs, { call: call, orgId: org, role: role, openProgram: programId => navigate({ tab: 'internships', programId }) })
                                                        : view.tab === 'ai-usage' && role === 'admin' ? _jsx(AiUsage, { call: call, org: org })
                                                            : view.tab === 'members' ? (role === 'admin' ? _jsx(Members, { call: call, orgId: org, userId: session.user.id }) : _jsx(ErrorNote, { message: "Only admins can manage members." }))
                                                                : view.tab === 'notifications' ? _jsx(Notifications, { call: call, orgId: org, openTask: openTask, onRead: reloadUnread, openPlan: id => openSection(id, 'plan') })
                                                                    : (view.source ? _jsx(QuestionSource, { call: call, org: org, source: view.source }, view.source) : _jsx(Questions, { call: call, orgId: org, role: role, openTask: openTask })) }, view.tab + org)] })] });
}
