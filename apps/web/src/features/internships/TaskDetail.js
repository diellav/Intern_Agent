import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { TaskQuestions } from './TaskQuestions';
import { useRef, useState } from 'react';
import { useResource } from '../../lib/api';
import { Due, ErrorNote, Icon, Loading, StatusBadge, formatDate } from '../../ui';
import { SubmissionForm, fileSize } from './SubmissionForm';
import { ReviewAssist } from './ReviewAssist';
/** Posts the form fields (plus `extra`) and reports errors inline. */
export function ActionForm({ call, path, onSaved, children, label, busyLabel = 'Saving…', extra = {}, icon = 'check' }) {
    const [pending, setPending] = useState(false);
    const [error, setError] = useState('');
    async function submit(event) {
        event.preventDefault();
        if (pending)
            return;
        const form = event.currentTarget;
        setPending(true);
        setError('');
        try {
            await call(path, { method: 'POST', body: JSON.stringify({ ...Object.fromEntries([...new FormData(form)].filter(([, value]) => value !== '')), ...extra }) });
            form.reset();
            onSaved();
        }
        catch (failure) {
            setError(failure instanceof Error ? failure.message : 'Could not save changes.');
        }
        finally {
            setPending(false);
        }
    }
    return _jsxs("form", { onSubmit: submit, children: [children, error && _jsx(ErrorNote, { message: error }), _jsx("div", { className: "actions", children: _jsxs("button", { disabled: pending, children: [pending ? _jsx("span", { className: "btn-spinner", "aria-hidden": "true" }) : _jsx(Icon, { name: icon, size: 16 }), pending ? busyLabel : label] }) })] });
}
function safeHost(url) {
    try {
        return new URL(url).host;
    }
    catch {
        return url;
    }
}
function Attachments({ call, base, item }) {
    const [opening, setOpening] = useState('');
    const [error, setError] = useState('');
    async function open(file) {
        // Open the tab during the click so pop-up blockers allow it, then point it at the short-lived link.
        const tab = window.open('', '_blank');
        if (tab)
            tab.opener = null;
        setOpening(file.id);
        setError('');
        try {
            const { url } = await call(`${base}/files/${file.id}/url`);
            if (tab)
                tab.location.href = url;
            else
                window.location.assign(url);
        }
        catch (failure) {
            tab?.close();
            setError(failure instanceof Error ? failure.message : 'Could not open the file.');
        }
        finally {
            setOpening('');
        }
    }
    if (!item.files.length && !item.links.length)
        return null;
    return _jsxs("div", { className: "attachments", children: [item.links.map(link => _jsxs("a", { className: "attachment", href: link.url, target: "_blank", rel: "noopener noreferrer nofollow", children: [_jsx(Icon, { name: "arrow", size: 14 }), _jsxs("span", { className: "grow", children: [_jsx("b", { children: link.title || safeHost(link.url) }), _jsx("span", { className: "fine", children: safeHost(link.url) })] })] }, link.url + link.title)), item.files.map(file => _jsxs("button", { type: "button", className: "attachment", onClick: () => void open(file), disabled: opening === file.id, children: [_jsx(Icon, { name: "file", size: 14 }), _jsxs("span", { className: "grow", children: [_jsx("b", { children: file.file_name }), _jsx("span", { className: "fine", children: fileSize(file.size_bytes) })] }), opening === file.id ? _jsx("span", { className: "btn-spinner dark", "aria-label": "Opening" }) : _jsx("span", { className: "fine", children: "Open" })] }, file.id)), error && _jsx(ErrorNote, { message: error })] });
}
/** Criteria written as lines or sentences become a short checklist. */
function criteriaList(text) {
    const lines = text.split(/\n+/).map(line => line.replace(/^[-*•\d.)\s]+/, '').trim()).filter(Boolean);
    const items = lines.length > 1 ? lines : text.split(/(?<=\.)\s+(?=[A-Z])/).map(line => line.trim()).filter(Boolean);
    return items.length ? items : [text];
}
function Criteria({ text }) {
    return _jsx("ul", { className: "criteria", children: criteriaList(text).map((line, i) => _jsxs("li", { children: [_jsx(Icon, { name: "check", size: 14 }), line] }, i)) });
}
function VersionEvidence({ call, base, item }) {
    return _jsxs("div", { className: "evidence", children: [item.evidence ? _jsx("p", { className: "prose-text", children: item.evidence }) : _jsx("p", { className: "muted", children: "No written description in this version." }), _jsx(Attachments, { call: call, base: base, item: item })] });
}
function ReviewForm({ call, base, path, latest, criteria, onSaved }) {
    const [decision, setDecision] = useState('completed');
    const [feedback, setFeedback] = useState('');
    const [fromAssist, setFromAssist] = useState(false);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState('');
    const editor = useRef(null);
    async function submit(event) {
        event.preventDefault();
        if (pending)
            return;
        setPending(true);
        setError('');
        try {
            await call(path + '/review', { method: 'POST', body: JSON.stringify({ submission_id: latest.id, decision, feedback }) });
            onSaved();
        }
        catch (failure) {
            setError(failure instanceof Error ? failure.message : 'Could not save the review.');
        }
        finally {
            setPending(false);
        }
    }
    const useAssist = (assist) => {
        setFeedback(assist.suggested_feedback);
        if (assist.suggested_decision)
            setDecision(assist.suggested_decision);
        setFromAssist(true);
        setTimeout(() => { editor.current?.focus(); editor.current?.setSelectionRange(0, 0); }, 0);
    };
    return _jsxs("form", { onSubmit: submit, className: "review", children: [_jsxs("header", { className: "review-head", children: [_jsxs("h3", { children: ["Reviewing version ", latest.version] }), _jsxs("span", { className: "muted", children: ["Sent ", formatDate(latest.submitted_at)] })] }), _jsxs("div", { className: "review-grid", children: [_jsxs("section", { children: [_jsx("p", { className: "label", children: "What the intern sent" }), _jsx(VersionEvidence, { call: call, base: base, item: latest })] }), _jsxs("section", { children: [_jsx("p", { className: "label", children: "Acceptance criteria" }), _jsx(Criteria, { text: criteria })] })] }), _jsx(ReviewAssist, { call: call, path: path, submissionId: latest.id, version: latest.version, sent: { description: !!latest.evidence, links: latest.links.length, files: latest.files.length }, criteria: criteria, onUse: useAssist }), _jsxs("section", { className: "decision", children: [_jsx("p", { className: "label", children: "Your decision" }), _jsxs("div", { className: "choice-group", role: "radiogroup", "aria-label": "Decision", children: [_jsxs("label", { className: "choice approve", children: [_jsx("input", { type: "radio", name: "decision", checked: decision === 'completed', onChange: () => setDecision('completed') }), _jsx(Icon, { name: "check" }), "Approve"] }), _jsxs("label", { className: "choice changes", children: [_jsx("input", { type: "radio", name: "decision", checked: decision === 'changes_requested', onChange: () => setDecision('changes_requested') }), _jsx(Icon, { name: "refresh" }), "Request changes"] })] }), _jsxs("label", { children: ["Feedback for the intern", _jsx("textarea", { ref: editor, rows: 5, maxLength: 3000, required: true, value: feedback, onChange: e => { setFeedback(e.target.value); if (!e.target.value)
                                    setFromAssist(false); }, placeholder: "What worked well, and what should change?" })] }), fromAssist && _jsxs("p", { className: "notice", role: "status", children: [_jsx(Icon, { name: "sparkle" }), "Suggested text added. Edit it and check the decision. Nothing is sent until you save."] }), error && _jsx(ErrorNote, { message: error }), _jsx("div", { className: "actions", children: _jsxs("button", { disabled: pending || !feedback.trim(), children: [pending ? _jsx("span", { className: "btn-spinner", "aria-hidden": "true" }) : _jsx(Icon, { name: "check", size: 16 }), pending ? 'Saving review…' : decision === 'completed' ? `Approve version ${latest.version}` : 'Request changes'] }) })] })] });
}
export function TaskDetail({ call, base, task, role, highlight, onSaved, neighbors, openTask }) {
    const path = base + '/tasks/' + task.id;
    const submissions = useResource(call, path + '/submissions');
    const latest = submissions.data?.[0];
    const reload = () => { submissions.reload(); onSaved(); };
    const canSubmit = role === 'intern' && (task.status === 'planned' || task.status === 'changes_requested');
    const canReview = role === 'mentor' && task.status === 'submitted' && latest && !latest.decision;
    const history = canReview ? submissions.data?.slice(1) : submissions.data;
    return _jsxs("div", { className: "task-page", children: [_jsxs("div", { className: "stack", children: [_jsxs("section", { className: "panel task-main", "aria-label": `Task ${task.title}`, children: [_jsxs("header", { children: [_jsx("h2", { className: "task-title", children: task.title }), _jsxs("div", { className: "meta-line", children: [_jsx(StatusBadge, { status: task.status }), task.status === 'completed' ? _jsxs("span", { children: ["Due ", formatDate(task.due_on)] }) : _jsx(Due, { date: task.due_on }), task.estimated_hours ? _jsxs("span", { children: [Number(task.estimated_hours), " h estimated"] }) : null] })] }), !canReview && _jsxs("div", { children: [_jsx("p", { className: "label", children: "Acceptance criteria" }), _jsx(Criteria, { text: task.criteria })] }), canSubmit && _jsx("div", { className: "action-box", children: _jsx(SubmissionForm, { call: call, base: base, taskId: task.id, resubmit: task.status === 'changes_requested', onSent: reload }) }), canReview && _jsx(ReviewForm, { call: call, base: base, path: path, latest: latest, criteria: task.criteria, onSaved: reload }), role === 'mentor' && task.status === 'planned' && _jsx("p", { className: "empty-line", children: "Waiting for the intern to submit." }), role === 'mentor' && task.status === 'changes_requested' && _jsx("p", { className: "empty-line", children: "Waiting for the intern\u2019s next version." }), role === 'intern' && task.status === 'submitted' && _jsx("p", { className: "empty-line", children: "Sent. Waiting for your mentor\u2019s review." })] }), _jsx(TaskQuestions, { call: call, base: base, taskId: task.id, role: role }, path), _jsxs("section", { className: "panel", children: [_jsx("header", { className: "panel-head", children: _jsxs("h2", { children: [canReview ? 'Earlier versions' : 'Versions', history && _jsx("span", { className: "count", children: history.length })] }) }), submissions.error && _jsx(ErrorNote, { message: submissions.error, onRetry: submissions.reload }), !submissions.data && !submissions.error && _jsx(Loading, { rows: 2 }), history?.length === 0 && _jsx("p", { className: "empty-line", children: canReview ? 'This is the first version.' : 'No submissions yet.' }), _jsx("ol", { className: "versions", children: history?.map(item => _jsxs("li", { className: highlight === item.version ? 'highlight' : undefined, "aria-current": highlight === item.version ? 'true' : undefined, children: [_jsxs("div", { className: "version-head", children: [_jsx("span", { className: `dot ${item.decision === 'completed' ? 'ok' : item.decision === 'changes_requested' ? 'no' : ''}`, "aria-hidden": "true" }), _jsxs("strong", { children: ["Version ", item.version] }), _jsx("span", { className: "muted", children: formatDate(item.submitted_at) }), _jsx(StatusBadge, { status: item.decision ?? 'submitted' })] }), _jsx(VersionEvidence, { call: call, base: base, item: item }), item.feedback && _jsxs("div", { className: `feedback-box ${item.decision === 'completed' ? 'ok' : ''}`, children: [_jsxs("p", { className: "label", children: ["Mentor feedback on version ", item.version, item.reviewed_at ? ` · ${formatDate(item.reviewed_at)}` : ''] }), _jsx("p", { className: "prose-text", children: item.feedback })] })] }, item.id)) })] })] }), _jsxs("aside", { className: "panel side-panel task-side", children: [_jsxs("dl", { className: "facts vertical", children: [_jsxs("div", { children: [_jsx("dt", { children: "Status" }), _jsx("dd", { children: _jsx(StatusBadge, { status: task.status }) })] }), _jsxs("div", { children: [_jsx("dt", { children: "Deadline" }), _jsx("dd", { children: formatDate(task.due_on) })] }), _jsxs("div", { children: [_jsx("dt", { children: "Estimate" }), _jsx("dd", { children: task.estimated_hours ? `${Number(task.estimated_hours)} h` : '—' })] }), _jsxs("div", { children: [_jsx("dt", { children: "Versions" }), _jsx("dd", { children: submissions.data?.length ?? '–' })] })] }), neighbors.length > 0 && _jsxs("nav", { className: "neighbors", "aria-label": "Other tasks", children: [_jsx("p", { className: "label", children: "Other tasks" }), neighbors.map(item => _jsxs("button", { className: "row-link compact", onClick: () => openTask(item.id), children: [_jsxs("span", { className: "row-primary", children: [_jsx("span", { className: "row-title", children: item.title }), _jsxs("span", { className: "row-sub", children: ["Due ", formatDate(item.due_on)] })] }), _jsx(Icon, { name: "arrow", size: 15 })] }, item.id))] })] })] });
}
