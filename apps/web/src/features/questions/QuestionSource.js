import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useResource } from '../../lib/api';
import { ErrorNote } from '../../ui';
export function QuestionSource({ call, org, source }) {
    const allowed = source && /^[\da-f-]{36}\/(answer|note)\/[\da-f-]{36}$/i.test(source);
    const [task, kind, id] = allowed ? source.split('/') : [];
    const result = useResource(call, allowed
        ? '/api/organizations/' + org + '/tasks/' + task + '/questions/sources/' + kind + '/' + id : null);
    if (!allowed)
        return _jsx("p", { children: "Source not found." });
    if (result.error)
        return _jsx(ErrorNote, { message: result.error, onRetry: result.reload });
    if (!result.data)
        return _jsx("p", { role: "status", children: "Loading source\u2026" });
    return _jsxs("article", { className: "feature-panel feature-stack source-reading", children: [_jsx("h2", { children: result.data.title }), _jsx("p", { className: "prose-text", children: result.data.body }), _jsx("a", { className: "feature-text-link", href: "#/questions", children: "Open Q&A" })] });
}
