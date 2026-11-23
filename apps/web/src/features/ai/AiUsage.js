import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useRef, useState } from 'react';
import { useResource } from '../../lib/api';
import { Badge, ErrorNote, Loading, Person } from '../../ui';
/** 👍/👎 on one AI result. The vote can be changed; only the latest one counts. */
export function AiVote({ call, org, id }) {
    const [vote, setVote] = useState();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const sending = useRef(false);
    if (!id)
        return null;
    async function send(value) {
        if (sending.current || vote === value)
            return;
        sending.current = true;
        setBusy(true);
        setError('');
        try {
            await call('/api/organizations/' + org + '/ai/usage/' + id + '/vote', { method: 'PUT', body: JSON.stringify({ value }) });
            setVote(value);
        }
        catch (failure) {
            setError(failure instanceof Error ? failure.message : 'Could not save feedback.');
        }
        finally {
            sending.current = false;
            setBusy(false);
        }
    }
    return _jsxs("div", { className: "vote", role: "group", "aria-label": "Was this AI suggestion helpful?", children: [_jsx("span", { className: "muted", children: "Was this helpful?" }), _jsx("button", { type: "button", className: "chip", disabled: busy, "aria-pressed": vote === 1, onClick: () => send(1), children: "\uD83D\uDC4D Yes" }), _jsx("button", { type: "button", className: "chip", disabled: busy, "aria-pressed": vote === -1, onClick: () => send(-1), children: "\uD83D\uDC4E No" }), vote !== undefined && _jsx("span", { className: "muted", role: "status", children: "Thanks, saved." }), error && _jsx("span", { className: "field-error", role: "alert", children: error })] });
}
const outcomes = {
    provider_success: ['Success', 'success'],
    validation_error: ['Invalid output', 'warn'],
    provider_error: ['Provider error', 'danger'],
    started: ['Did not finish', 'neutral'],
};
const actions = {
    generate_plan: 'Plan draft', review_assist: 'Review suggestions', summarize: 'Progress summary',
    suggest: 'Answer suggestion', explain: 'Next-step suggestion', analyze: 'CV analysis',
};
export function AiUsage({ call, org }) {
    const data = useResource(call, '/api/organizations/' + org + '/ai/usage');
    if (data.error)
        return _jsx(ErrorNote, { message: data.error, onRetry: data.reload });
    if (!data.data)
        return _jsx("section", { className: "panel", children: _jsx(Loading, { rows: 4 }) });
    const entries = data.data;
    const succeeded = entries.filter(entry => entry.outcome === 'provider_success').length;
    const votes = entries.filter(entry => entry.vote !== null);
    const helpful = votes.filter(entry => entry.vote === 1).length;
    const cost = entries.reduce((sum, entry) => sum + (entry.estimated_cost_usd ?? 0), 0);
    return _jsxs("div", { className: "stack", children: [_jsxs("div", { className: "stat-strip", children: [_jsxs("div", { className: "stat-cell", children: [_jsx("strong", { children: entries.length }), _jsx("span", { children: "Recent requests" })] }), _jsxs("div", { className: "stat-cell", children: [_jsxs("strong", { children: [entries.length ? Math.round((succeeded / entries.length) * 100) : 0, "%"] }), _jsx("span", { children: "Valid results" })] }), _jsxs("div", { className: "stat-cell", children: [_jsx("strong", { children: votes.length ? `${helpful}/${votes.length}` : '—' }), _jsx("span", { children: "Rated helpful" })] }), _jsxs("div", { className: "stat-cell", children: [_jsx("strong", { children: entries.some(e => e.estimated_cost_usd != null) ? `$${cost.toFixed(4)}` : '—' }), _jsx("span", { children: "Estimated cost" })] })] }), _jsxs("section", { className: "panel", children: [_jsxs("header", { className: "panel-head", children: [_jsxs("div", { children: [_jsxs("h2", { children: ["Recent AI requests", _jsx("span", { className: "count", children: entries.length })] }), _jsx("p", { children: "\u201CInvalid output\u201D means the provider answered but the result failed validation and was not shown. Cost appears only when model prices are configured." })] }), _jsx("button", { className: "ghost sm", type: "button", onClick: data.reload, children: "Refresh" })] }), entries.length === 0 ? _jsx("p", { className: "empty-line", children: "No AI requests recorded yet." }) : _jsx("ul", { className: "rows", children: entries.map(entry => {
                            const [label, tone] = outcomes[entry.outcome] ?? [entry.outcome.replaceAll('_', ' '), 'neutral'];
                            return _jsxs("li", { className: "usage-row", children: [_jsx(Person, { name: entry.actor_name, email: entry.actor_email ?? 'Former member', size: "sm", detail: `${actions[entry.action] ?? entry.action.replaceAll('_', ' ')} · ${new Date(entry.started_at).toLocaleString()}` }), _jsxs("span", { className: "muted", children: [entry.model, _jsx("br", {}), entry.elapsed_ms != null ? `${(entry.elapsed_ms / 1000).toFixed(1)} s` : '—', entry.input_tokens != null ? ` · ${entry.input_tokens + (entry.output_tokens ?? 0)} tokens` : ''] }), _jsxs("span", { className: "row-state", children: [_jsx(Badge, { tone: tone, children: label }), _jsx("span", { className: "muted", children: entry.vote === 1 ? '👍 Helpful' : entry.vote === -1 ? '👎 Not helpful' : 'No rating' })] })] }, entry.id);
                        }) })] })] });
}
