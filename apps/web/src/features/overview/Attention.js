import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { AiVote } from '../ai/AiUsage';
import { useState } from 'react';
import { useResource } from '../../lib/api';
import { ErrorNote } from '../../ui';
export function Attention({ call, orgId, openTask }) {
    const path = '/api/organizations/' + orgId + '/attention';
    const result = useResource(call, path);
    // Quiet when everything is on track: nothing to explain, nothing to show.
    if (result.data && result.data.length === 0)
        return null;
    return _jsxs("section", { className: "feature-panel feature-stack", children: [_jsx("header", { className: "panel-head", children: _jsxs("div", { children: [_jsxs("h2", { children: ["Interns who may need help", result.data ? _jsx("span", { className: "count", children: result.data.length }) : null] }), _jsx("p", { children: "Shown for: 2+ open tasks past their deadline, a task returned for changes twice in a row, or 5+ days without a submission." })] }) }), result.error ? _jsx(ErrorNote, { message: result.error, onRetry: result.reload }) : !result.data
                ? _jsx("p", { role: "status", className: "muted", children: "Checking internship activity\u2026" })
                : result.data.map(signal => _jsx(SignalRow, { signal: signal, call: call, path: path, openTask: openTask }, signal.internship_id + signal.kind))] });
}
const plural = (count, word) => count + ' ' + word + (count === 1 ? '' : 's');
function describe(signal) {
    if (signal.kind === 'overdue')
        return plural(signal.count, 'open task') + ' past their due date';
    if (signal.kind === 'returns')
        return plural(signal.count, 'task') + ' had ' + (signal.count === 1 ? 'its' : 'their')
            + ' last 2 versions returned for changes';
    return signal.has_submission ? 'No submissions in the last ' + plural(signal.count, 'day')
        : 'No submissions since the internship started ' + plural(signal.count, 'day') + ' ago';
}
function SignalRow({ signal, call, path, openTask }) {
    const [busy, setBusy] = useState(false);
    const [step, setStep] = useState();
    const [error, setError] = useState('');
    async function explain() {
        setBusy(true);
        setError('');
        try {
            const result = await call(path + '/' + signal.internship_id + '/' + signal.kind + '/explain', { method: 'POST' });
            setStep(result);
        }
        catch (failure) {
            setError(failure instanceof Error ? failure.message : 'Could not get a suggestion.');
        }
        finally {
            setBusy(false);
        }
    }
    return _jsxs("article", { className: "feature-result signal-card", "data-kind": signal.kind, children: [_jsx("h3", { children: (signal.intern_name || signal.intern_email || 'Unnamed intern') + ' · ' + signal.program }), _jsxs("p", { children: [describe(signal), " \u00B7 Checked ", signal.checked_on] }), signal.evidence.length > 0 && _jsx("ul", { children: signal.evidence.map(item => _jsx("li", { children: _jsxs("button", { className: "link-btn", type: "button", onClick: () => openTask(signal.internship_id, item.task_id, item.version), children: [item.title, item.version ? ' · Version ' + item.version : ' · Due ' + item.due_on] }) }, item.task_id + item.version)) }), _jsx("div", { children: _jsx("button", { className: "secondary sm", type: "button", disabled: busy, onClick: explain, children: busy ? 'Preparing suggestion…' : 'Suggest next step' }) }), error && _jsx("p", { role: "alert", children: error }), step && _jsxs(_Fragment, { children: [_jsx("p", { role: "status", children: step.next_step }), _jsx(AiVote, { call: call, org: path.split("/")[3], id: step.ai_usage_id }, step.ai_usage_id)] })] });
}
