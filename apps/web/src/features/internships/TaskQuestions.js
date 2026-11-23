import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { AiVote } from '../ai/AiUsage';
import { useState } from 'react';
import { useResource } from '../../lib/api';
import { ErrorNote } from '../../ui';
export function TaskQuestions({ call, base, taskId, role }) {
    const path = base + '/tasks/' + taskId + '/questions';
    const list = useResource(call, path);
    const [selected, select] = useState('');
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    async function ask(event) {
        event.preventDefault();
        const form = event.currentTarget;
        const fields = new FormData(form);
        setSaving(true);
        setError('');
        try {
            const question = await call(path, {
                method: 'POST', body: JSON.stringify({ title: fields.get('title'), body: fields.get('body') }),
            });
            form.reset();
            select(question.id);
            list.reload();
        }
        catch (failure) {
            setError(failure instanceof Error ? failure.message : 'Could not post question.');
        }
        finally {
            setSaving(false);
        }
    }
    return _jsxs("section", { className: "feature-panel feature-stack task-discussion", children: [_jsx("h2", { children: "Task questions" }), _jsxs("details", { className: "feature-disclosure", children: [_jsx("summary", { children: "Ask about this task" }), _jsxs("form", { className: "stack", onSubmit: ask, children: [_jsxs("label", { children: ["Title", _jsx("input", { name: "title", required: true, maxLength: 180 })] }), _jsxs("label", { children: ["Question", _jsx("textarea", { name: "body", required: true, maxLength: 6000 })] }), _jsx("button", { disabled: saving, children: saving ? 'Posting…' : 'Post question' }), error && _jsx("p", { role: "alert", children: error })] })] }), list.error ? _jsx(ErrorNote, { message: list.error, onRetry: list.reload }) : !list.data
                ? _jsx("p", { role: "status", children: "Loading questions\u2026" }) : !list.data.length ? _jsx("p", { children: "No questions yet." })
                : list.data.map(question => _jsxs("article", { className: "feature-thread", children: [_jsx("button", { className: "feature-thread-toggle", type: "button", "aria-expanded": selected === question.id, onClick: () => select(selected === question.id ? '' : question.id), children: question.title }), selected === question.id && _jsx(Thread, { call: call, base: base, path: path, role: role, question: question })] }, question.id))] });
}
function Thread({ call, base, path, role, question }) {
    const answersPath = base + '/questions/' + question.id + '/answers';
    const answers = useResource(call, answersPath);
    const [draft, setDraft] = useState('');
    const [usage, setUsage] = useState();
    const [parts, setParts] = useState(null);
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    async function run(action, operation) {
        setBusy(action);
        setError('');
        try {
            await operation();
        }
        catch (failure) {
            setError(failure instanceof Error ? failure.message : 'Could not complete this action.');
        }
        finally {
            setBusy('');
        }
    }
    return _jsxs("div", { className: "stack", children: [_jsx("p", { children: question.body }), answers.error ? _jsx(ErrorNote, { message: answers.error, onRetry: answers.reload }) : answers.data?.map(answer => _jsxs("div", { className: "feature-result", children: [_jsx("p", { children: answer.body }), answer.verified_at ? _jsx("span", { children: "Verified answer" }) : role !== 'intern' && !answers.data?.some(item => item.verified_at) &&
                        _jsx("button", { disabled: Boolean(busy), type: "button", onClick: () => run('Verifying…', async () => {
                                await call(answersPath + '/' + answer.id + '/verify', { method: 'POST' });
                                answers.reload();
                            }), children: "Verify answer" })] }, answer.id)), role === 'mentor' && _jsx("button", { className: "secondary sm", type: "button", disabled: Boolean(busy), onClick: () => run('Finding sources…', async () => {
                    const result = await call(path + '/' + question.id + '/suggest', { method: 'POST' });
                    setParts(result.parts);
                    setUsage(result.ai_usage_id);
                }), children: "Suggest an answer" }), parts && (parts.length ? _jsxs("div", { className: "feature-result feature-stack", children: [parts.map((part, index) => _jsxs("div", { children: [_jsx("p", { children: part.body }), part.sources.map(source => _jsxs("details", { className: "feature-disclosure", children: [_jsx("summary", { children: source.title }), _jsx("p", { children: source.body }), _jsx("a", { href: "#/questions?source=" + encodeURIComponent(path.split("/").at(-2) + "/" + source.kind + "/" + source.id), children: "Open source" })] }, source.id))] }, index)), _jsx("button", { className: "secondary sm", type: "button", onClick: () => setDraft(parts.map(part => part.body).join('\n\n')), children: "Use in draft" })] }) : _jsx("p", { children: "No verified sources answered this question." })), _jsx(AiVote, { call: call, org: base.split("/")[3], id: usage }, usage), _jsxs("label", { children: ["Your answer", _jsx("textarea", { value: draft, maxLength: 6000, onChange: event => setDraft(event.target.value) })] }), _jsx("button", { type: "button", disabled: Boolean(busy) || !draft.trim(), onClick: () => run('Posting answer…', async () => {
                    await call(answersPath, { method: 'POST', body: JSON.stringify({ body: draft }) });
                    setDraft('');
                    answers.reload();
                }), children: "Post answer" }), busy && _jsx("p", { role: "status", children: busy }), error && _jsx("p", { role: "alert", children: error })] });
}
