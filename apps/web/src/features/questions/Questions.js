import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
import { ErrorNote, Icon, Loading, Modal } from '../../ui';
export function Questions({ call, orgId, role, openTask }) {
    const base = `/api/organizations/${orgId}/questions`;
    const [search, setSearch] = useState('');
    const [query, setQuery] = useState('');
    const [list, setList] = useState(null);
    const [selected, setSelected] = useState(null);
    const [answers, setAnswers] = useState(null);
    const [revision, setRevision] = useState(0);
    const [pending, setPending] = useState(false);
    const [asking, setAsking] = useState(false);
    const [error, setError] = useState('');
    const detail = useRef(null);
    useEffect(() => {
        const controller = new AbortController();
        call(`${base}?q=${encodeURIComponent(query)}`, { signal: controller.signal })
            .then(data => { if (!controller.signal.aborted)
            setList(data); })
            .catch(() => { if (!controller.signal.aborted)
            setError('Could not load questions.'); });
        return () => controller.abort();
    }, [base, call, query, revision]);
    const questionId = selected?.id;
    useEffect(() => {
        if (!questionId)
            return;
        const controller = new AbortController();
        call(`${base}/${questionId}/answers`, { signal: controller.signal })
            .then(data => { if (!controller.signal.aborted)
            setAnswers(data); })
            .catch(() => { if (!controller.signal.aborted)
            setError('Could not load answers.'); });
        return () => controller.abort();
    }, [base, call, questionId, revision]);
    async function save(path, form, after) {
        setPending(true);
        setError('');
        try {
            await call(path, { method: 'POST', body: form ? JSON.stringify(Object.fromEntries(new FormData(form))) : undefined });
            form?.reset();
            after?.();
            setRevision(n => n + 1);
        }
        catch (failure) {
            setError(failure instanceof Error ? failure.message : 'Could not save.');
        }
        finally {
            setPending(false);
        }
    }
    function publish(event) {
        event.preventDefault();
        void save(base, event.currentTarget, () => { setSearch(''); setQuery(''); setAsking(false); });
    }
    function choose(item) {
        if (item.id !== questionId) {
            setAnswers(null);
            setSelected(item);
        }
    }
    return _jsxs("div", { className: `forum ${selected ? 'has-thread' : ''}`, children: [error && _jsx(ErrorNote, { message: error, retryLabel: "Refresh", onRetry: () => { setError(''); setRevision(n => n + 1); } }), _jsx(Modal, { open: asking, onClose: () => setAsking(false), title: "Ask a question", description: "Share what you tried so others can help faster.", children: _jsxs("form", { onSubmit: publish, className: "grid gap-3", children: [_jsxs("label", { children: ["Title", _jsx("input", { name: "title", required: true, maxLength: 180, autoFocus: true, placeholder: "How do I rebase my branch onto main?" })] }), _jsxs("label", { children: ["What have you tried?", _jsx("textarea", { name: "body", rows: 6, required: true, maxLength: 6000 })] }), _jsxs("div", { className: "modal-actions", children: [_jsx("button", { type: "button", className: "ghost", onClick: () => setAsking(false), children: "Cancel" }), _jsxs("button", { disabled: pending, children: [pending ? _jsx("span", { className: "btn-spinner", "aria-hidden": "true" }) : _jsx(Icon, { name: "arrow", size: 16 }), pending ? 'Publishing…' : 'Publish question'] })] })] }) }), _jsxs("section", { className: "panel forum-list", "aria-label": "Questions", children: [_jsxs("header", { className: "panel-head", children: [_jsxs("h2", { children: [query ? `Results for “${query}”` : 'Questions', list && _jsx("span", { className: "count", children: list.length })] }), _jsxs("button", { className: "sm", onClick: () => setAsking(true), children: [_jsx(Icon, { name: "plus", size: 15 }), "Ask"] })] }), _jsxs("form", { className: "search", role: "search", onSubmit: event => { event.preventDefault(); setQuery(search.trim()); }, children: [_jsx(Icon, { name: "search", size: 17 }), _jsx("input", { type: "search", "aria-label": "Search questions", value: search, onChange: event => { setSearch(event.target.value); if (!event.target.value)
                                    setQuery(''); }, maxLength: 200, placeholder: "Search Git, CORS, onboarding\u2026" })] }), !list && !error && _jsx(Loading, { rows: 4 }), list?.length === 0 && _jsx("p", { className: "empty-line", children: query ? 'No matching questions.' : 'No questions yet. Be the first to ask.' }), _jsx("ul", { className: "forum-items", children: list?.map(item => _jsx("li", { children: _jsxs("button", { className: "forum-item", "aria-current": item.id === questionId ? 'true' : undefined, onClick: () => choose(item), children: [_jsx("span", { className: "row-title", children: item.title }), item.task_title && _jsxs("span", { className: "row-sub", children: [_jsx(Icon, { name: "file", size: 13 }), "Task: ", item.task_title] }), _jsx("span", { className: "forum-meta", children: item.verified ? _jsx("span", { className: "pill ok", children: "Verified answer" }) : item.answers ? _jsxs("span", { className: "muted", children: [item.answers, " answer", item.answers === 1 ? '' : 's'] }) : _jsx("span", { className: "pill warn", children: "Unanswered" }) })] }) }, item.id)) })] }), _jsx("section", { className: "panel forum-thread", ref: detail, "aria-label": "Question thread", children: selected ? _jsxs("div", { className: "stack", children: [_jsxs("button", { className: "back-link forum-back", onClick: () => setSelected(null), children: [_jsx(Icon, { name: "back", size: 16 }), "Back to questions"] }), _jsxs("header", { children: [_jsx("h2", { className: "thread-title", children: selected.title }), selected.task_id && selected.internship_id && openTask && _jsxs("p", { className: "row-sub", style: { marginBottom: 'var(--s-2)' }, children: ["Asked about the task ", _jsx("button", { className: "link-btn", onClick: () => openTask(selected.internship_id, selected.task_id), children: selected.task_title })] }), _jsx("p", { className: "prose-text", children: selected.body })] }), _jsxs("div", { children: [_jsx("p", { className: "label", children: answers ? `${answers.length} answer${answers.length === 1 ? '' : 's'}` : 'Answers' }), !answers && !error && _jsx(Loading, { rows: 2 }), answers?.length === 0 && _jsx("p", { className: "empty-line", children: "No answers yet. Know the answer? Share it below." }), _jsx("ul", { className: "answers", children: answers?.map(answer => _jsxs("li", { className: answer.verified_at ? 'answer verified' : 'answer', children: [answer.verified_at && _jsxs("span", { className: "pill ok", children: [_jsx(Icon, { name: "check", size: 13 }), "Verified solution"] }), _jsx("p", { className: "prose-text", children: answer.body }), (role === 'mentor' || role === 'admin') && !answers.some(item => item.verified_at) &&
                                                _jsxs("button", { className: "ghost sm", disabled: pending, onClick: () => void save(`${base}/${selected.id}/answers/${answer.id}/verify`), children: [_jsx(Icon, { name: "check", size: 15 }), "Mark as verified"] })] }, answer.id)) })] }), _jsxs("form", { className: "grid gap-2", onSubmit: event => { event.preventDefault(); void save(`${base}/${selected.id}/answers`, event.currentTarget); }, children: [_jsxs("label", { children: ["Your answer", _jsx("textarea", { name: "body", rows: 4, required: true, maxLength: 6000, placeholder: "Explain the fix or point to a resource\u2026" })] }), _jsx("div", { className: "actions", children: _jsxs("button", { disabled: pending, children: [pending ? _jsx("span", { className: "btn-spinner", "aria-hidden": "true" }) : _jsx(Icon, { name: "arrow", size: 16 }), pending ? 'Posting…' : 'Post answer'] }) })] })] }, selected.id) : _jsxs("div", { className: "thread-empty", children: [_jsx(Icon, { name: "chat", size: 22 }), _jsx("p", { children: "Choose a question to read the answers or add your own." })] }) })] });
}
