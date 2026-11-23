import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useRef, useState } from 'react';
import { supabase } from '../lib/api';
import { ErrorNote, Icon } from '../ui';
import { Brand } from './Brand';
/** Two short steps: the invited email, then the code sent to it. */
export function SignIn() {
    const [step, setStep] = useState({ kind: 'email' });
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const lastEmail = useRef('');
    const redirectError = new URLSearchParams(window.location.hash.slice(1)).has('error')
        || new URLSearchParams(window.location.search).has('error');
    async function send(email, resend = false) {
        if (!supabase || busy)
            return;
        setBusy(resend ? 'resending' : 'sending');
        setError('');
        setNotice('');
        try {
            const { error: failure } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
            if (failure)
                throw failure;
            lastEmail.current = email;
            setStep({ kind: 'code', email });
            if (resend)
                setNotice('A new code is on its way.');
        }
        catch {
            setError('We couldn’t send a code. Check that this email was invited, then try again.');
        }
        finally {
            setBusy('');
        }
    }
    async function verify(event) {
        event.preventDefault();
        if (!supabase || step.kind !== 'code' || busy)
            return;
        const token = String(new FormData(event.currentTarget).get('code')).replace(/\s/g, '');
        setBusy('verifying');
        setError('');
        setNotice('');
        try {
            const { error: failure } = await supabase.auth.verifyOtp({ email: step.email, token, type: 'email' });
            if (failure)
                throw failure;
            // The app switches to "Opening workspace…" as soon as Supabase reports the new session.
        }
        catch {
            setError('That code didn’t work. Use the latest email we sent, or request a new code.');
            setBusy('');
        }
    }
    return _jsxs("section", { className: "auth-card", "aria-labelledby": "sign-in-title", children: [_jsx(Brand, { size: "lg" }), step.kind === 'email' ? _jsxs(_Fragment, { children: [_jsxs("div", { children: [_jsx("h1", { id: "sign-in-title", children: "Sign in" }), _jsx("p", { children: "We\u2019ll email a one-time code to your invited address." })] }), redirectError && _jsxs("div", { className: "notice", role: "status", children: [_jsx(Icon, { name: "alert" }), _jsx("span", { children: "That sign-in link has expired. Request a new code." })] }), error && _jsx(ErrorNote, { message: error }), _jsxs("form", { onSubmit: event => { event.preventDefault(); void send(String(new FormData(event.currentTarget).get('email')).trim()); }, children: [_jsxs("label", { children: ["Work email", _jsx("input", { name: "email", type: "email", autoComplete: "email", autoFocus: true, required: true, defaultValue: lastEmail.current, placeholder: "name@company.com" })] }), _jsxs("button", { className: "lg block-btn", disabled: !!busy, children: [busy ? _jsx("span", { className: "btn-spinner", "aria-hidden": "true" }) : null, busy ? 'Sending code…' : 'Send code'] })] }), _jsx("p", { className: "fine", children: "Access is by invitation. Ask your admin if you haven\u2019t been invited." })] }) : _jsxs(_Fragment, { children: [_jsxs("div", { children: [_jsx("h1", { id: "sign-in-title", children: "Enter your code" }), _jsxs("p", { children: ["Sent to ", _jsx("strong", { children: step.email })] })] }), error && _jsx(ErrorNote, { message: error }), notice && _jsx("p", { className: "notice", role: "status", children: notice }), _jsxs("form", { onSubmit: verify, children: [_jsxs("label", { children: ["Verification code", _jsx("input", { name: "code", className: "code-input", inputMode: "numeric", autoComplete: "one-time-code", autoFocus: true, pattern: "[0-9 ]{6,12}", maxLength: 12, required: true, placeholder: "000000" })] }), _jsxs("button", { className: "lg block-btn", disabled: !!busy, children: [busy === 'verifying' ? _jsx("span", { className: "btn-spinner", "aria-hidden": "true" }) : null, busy === 'verifying' ? 'Verifying…' : 'Verify and continue'] })] }), _jsxs("div", { className: "auth-links", children: [_jsxs("button", { type: "button", className: "ghost sm", disabled: !!busy, onClick: () => { setStep({ kind: 'email' }); setError(''); setNotice(''); }, children: [_jsx(Icon, { name: "back", size: 15 }), "Change email"] }), _jsx("button", { type: "button", className: "ghost sm", disabled: !!busy, onClick: () => void send(step.email, true), children: busy === 'resending' ? 'Sending…' : 'Resend code' })] })] })] });
}
