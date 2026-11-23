import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api, supabase } from '../lib/api';
import { ErrorNote, Icon } from '../ui';
import { Brand } from './Brand';
import { SignIn } from './SignIn';
import { Workspace } from './Workspace';
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
/** Loads memberships for a session. A freshly issued session can be rejected for a moment while it settles,
 * so 401s are retried briefly before the user sees an error. */
async function loadMemberships(session, signal) {
    for (const delay of [0, 800, 1600, 3000]) {
        if (delay)
            await wait(delay);
        if (signal.aborted)
            throw new DOMException('Aborted', 'AbortError');
        try {
            return await api(session, '/api/me', { signal });
        }
        catch (failure) {
            if (!(failure instanceof ApiError) || failure.status !== 401 || delay === 3000)
                throw failure;
        }
    }
    return { memberships: [], full_name: null };
}
export function App() {
    const [session, setSession] = useState();
    const [memberships, setMemberships] = useState(null);
    const [me, setMe] = useState(null);
    const [error, setError] = useState(null);
    const [retry, setRetry] = useState(0);
    const call = useCallback((path, init) => api(session, path, init), [session]);
    useEffect(() => {
        if (!supabase)
            return;
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, next) => {
            // Token refreshes keep the same user; only reset the workspace when the user changes.
            // Keep the same object for the same user: the API reads the fresh token itself, so a token refresh
            // does not reload every screen. A different user (or sign-out) clears the previous workspace.
            setSession(current => {
                if (current && next && current.user.id === next.user.id)
                    return current;
                if (current?.user.id !== next?.user.id) {
                    setMemberships(null);
                    setError(null);
                }
                return next;
            });
        });
        return () => subscription.unsubscribe();
    }, []);
    const userId = session?.user.id;
    useEffect(() => {
        if (!session)
            return;
        const controller = new AbortController();
        setError(null);
        loadMemberships(session, controller.signal)
            .then(result => { setMemberships(result.memberships); setMe({ full_name: result.full_name, email: session.user.email ?? '' }); })
            .catch((failure) => {
            if (controller.signal.aborted)
                return;
            setError({ message: failure.message, session: failure instanceof ApiError && failure.status === 401 });
        });
        return () => controller.abort();
        // Re-run for a different user or an explicit retry, not for every token refresh.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId, retry]);
    if (session && memberships?.length && me)
        return _jsx(Workspace, { session: session, call: call, memberships: memberships, me: me });
    return _jsx("main", { className: "entry", children: !supabase ? _jsxs("section", { className: "auth-card state", children: [_jsx(Brand, {}), _jsx("h1", { children: "Sign-in is not configured" }), _jsx("p", { children: "Add the Supabase URL and publishable key to the frontend environment." })] })
            : session === undefined ? _jsxs("section", { className: "auth-card state", role: "status", children: [_jsx(Brand, {}), _jsx("span", { className: "spinner" }), _jsx("p", { children: "Checking your session\u2026" })] })
                : !session ? _jsx(SignIn, {})
                    : _jsxs("section", { className: "auth-card state", children: [_jsx(Brand, {}), memberships?.length === 0 ? _jsxs(_Fragment, { children: [_jsx("h1", { children: "Almost there" }), _jsxs("p", { children: ["You\u2019re signed in as ", _jsx("strong", { children: session.user.email }), ". Ask your organization admin to activate your membership."] }), _jsxs("div", { className: "actions", children: [_jsxs("button", { className: "secondary", onClick: () => setRetry(n => n + 1), children: [_jsx(Icon, { name: "refresh", size: 16 }), "Check again"] }), _jsx("button", { className: "ghost", onClick: () => void supabase?.auth.signOut(), children: "Use another email" })] })] }) : error ? _jsxs(_Fragment, { children: [_jsx("h1", { children: error.session ? 'We couldn’t confirm your sign-in' : 'The workspace didn’t load' }), _jsx(ErrorNote, { message: error.session ? 'Your session was not accepted. Sign in again to get a new code.' : error.message }), _jsx("div", { className: "actions", children: error.session
                                            ? _jsxs("button", { onClick: () => void supabase?.auth.signOut(), children: [_jsx(Icon, { name: "back", size: 16 }), "Back to sign in"] })
                                            : _jsxs("button", { onClick: () => setRetry(n => n + 1), children: [_jsx(Icon, { name: "refresh", size: 16 }), "Try again"] }) })] }) : _jsxs("div", { role: "status", className: "opening", children: [_jsx("span", { className: "spinner" }), _jsx("p", { children: "Opening workspace\u2026" })] })] }) });
}
