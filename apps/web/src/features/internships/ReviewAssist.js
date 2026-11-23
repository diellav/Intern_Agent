import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { AiVote } from '../ai/AiUsage';
import { useEffect, useState } from 'react';
import { useResource } from '../../lib/api';
import { ErrorNote, Icon } from '../../ui';
const statusText = { met: 'Looks met', not_met: 'Not met', unclear: 'Check yourself' };
function Elapsed() {
    const [seconds, setSeconds] = useState(0);
    useEffect(() => { const timer = setInterval(() => setSeconds(n => n + 1), 1000); return () => clearInterval(timer); }, []);
    return _jsxs("span", { className: "muted", children: [seconds, "s"] });
}
/** Optional AI reading of the version under review. It never decides: the mentor chooses what to use. */
export function ReviewAssist({ call, path, submissionId, version, sent, onUse }) {
    const ai = useResource(call, path.split('/tasks/')[0] + '/ai/status');
    const [assist, setAssist] = useState(null);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState('');
    if (!ai.data?.configured)
        return null;
    const read = [sent.description ? 'the description' : null, sent.links ? `${sent.links} link title${sent.links === 1 ? '' : 's'}` : null,
        sent.files ? `${sent.files} file name${sent.files === 1 ? '' : 's'}` : null].filter(Boolean).join(', ') || 'nothing written';
    async function run() {
        if (pending)
            return;
        setPending(true);
        setError('');
        try {
            setAssist(await call(path + '/review-assist', { method: 'POST', body: JSON.stringify({ submission_id: submissionId }) }));
        }
        catch (failure) {
            setError(failure instanceof Error ? failure.message : 'Could not prepare suggestions.');
        }
        finally {
            setPending(false);
        }
    }
    if (!assist)
        return _jsxs("div", { className: "assist-start", children: [_jsxs("button", { type: "button", className: "secondary", onClick: () => void run(), "aria-disabled": pending, children: [pending ? _jsx("span", { className: "btn-spinner dark", "aria-hidden": "true" }) : _jsx(Icon, { name: "sparkle", size: 15 }), pending ? `Reading version ${version}…` : error ? 'Try again' : 'Get AI suggestions'] }), pending && _jsx(Elapsed, {}), _jsxs("span", { className: "muted", children: ["Reads ", read, ". File contents and linked pages are not opened."] }), error && _jsx(ErrorNote, { message: error })] });
    return _jsxs("section", { className: "assist", "aria-label": "AI suggestions", "aria-live": "polite", children: [_jsx(AiVote, { call: call, org: path.split("/")[3], id: assist.ai_usage_id }, assist.ai_usage_id), _jsxs("header", { className: "assist-head", children: [_jsxs("p", { className: "label", children: [_jsx(Icon, { name: "sparkle", size: 14 }), "AI suggestions for version ", version] }), _jsxs("span", { className: "muted", children: ["Read: ", read, " \u00B7 ", assist.model] })] }), _jsxs("div", { className: "assist-block", children: [_jsx("h4", { children: "Findings" }), _jsx("p", { children: assist.summary }), assist.criteria.length > 0 && _jsx("ul", { className: "assist-criteria", children: assist.criteria.map(item => _jsxs("li", { children: [_jsx("span", { className: `assist-status ${item.status}`, children: statusText[item.status] }), _jsxs("span", { className: "grow", children: [_jsx("b", { children: item.criterion }), _jsx("span", { className: "muted", children: item.evidence })] })] }, item.criterion)) })] }), assist.check.length > 0 && _jsxs("div", { className: "assist-block checks", children: [_jsx("h4", { children: "Check before deciding" }), _jsx("ul", { children: assist.check.map(text => _jsx("li", { children: text }, text)) })] }), _jsxs("div", { className: "assist-block", children: [_jsxs("h4", { children: ["Suggested feedback", assist.suggested_decision ? ` · suggests “${assist.suggested_decision === 'completed' ? 'Approve' : 'Request changes'}”` : ''] }), _jsx("p", { className: "prose-text", children: assist.suggested_feedback })] }), _jsxs("div", { className: "actions", children: [_jsxs("button", { type: "button", className: "secondary sm", onClick: () => onUse(assist), children: [_jsx(Icon, { name: "arrow", size: 14 }), "Use this feedback"] }), _jsx("button", { type: "button", className: "ghost sm", onClick: () => setAssist(null), children: "Dismiss" }), _jsx("span", { className: "muted", children: "You review and send it yourself." })] })] });
}
