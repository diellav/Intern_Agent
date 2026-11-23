import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useRef, useState } from 'react';
import { useResource } from '../../lib/api';
import { ErrorNote, Icon, Loading, confirmAction } from '../../ui';
import { AiVote } from './AiUsage';
/** The assigned mentor uploads the intern's CV, analyses it and turns it into a starting plan. Interns don't see this panel. */
export function CvPanel({ call, org, path, startPlan }) {
    const cv = useResource(call, path);
    const [file, setFile] = useState(null);
    const [consent, setConsent] = useState(false);
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const [usage, setUsage] = useState();
    const running = useRef(false);
    async function run(label, action) {
        if (running.current)
            return;
        running.current = true;
        setBusy(label);
        setError('');
        try {
            await action();
            cv.reload();
        }
        catch (failure) {
            setError(failure instanceof Error ? failure.message : 'Could not complete this action.');
        }
        finally {
            running.current = false;
            setBusy('');
        }
    }
    if (cv.error)
        return _jsx(ErrorNote, { message: cv.error, onRetry: cv.reload });
    if (!cv.data)
        return _jsx("section", { className: "panel", children: _jsx(Loading, { rows: 2 }) });
    const analysis = cv.data.analysis;
    return _jsxs("section", { className: "panel learning-profile", children: [_jsx("header", { className: "panel-head", children: _jsxs("div", { children: [_jsx("h2", { children: "Plan from the intern\u2019s CV" }), _jsx("p", { children: "Upload the intern\u2019s CV to get a starting plan based on their skills. Contact details are removed before the text is sent to AI. Only you, the assigned mentor, can see it." })] }) }), !cv.data.consented_at && _jsxs("div", { className: "stack", style: { gap: 'var(--s-3)' }, children: [_jsx("input", { className: "feature-upload", type: "file", "aria-label": "Choose the intern\u2019s CV", accept: ".pdf,.docx", onChange: event => {
                            const picked = event.target.files?.[0] ?? null;
                            const supported = !picked || /\.(pdf|docx)$/i.test(picked.name);
                            setError(supported ? '' : 'Choose a PDF (.pdf) or Word (.docx) file. Other formats, including .doc, are not supported.');
                            setFile(supported ? picked : null);
                        } }), _jsxs("label", { className: "feature-consent", children: [_jsx("input", { type: "checkbox", checked: consent, onChange: event => setConsent(event.target.checked) }), "The intern agreed that their CV may be analysed with AI to prepare their plan."] }), _jsx("div", { className: "actions", children: _jsxs("button", { type: "button", disabled: !file || !consent || Boolean(busy), onClick: () => run('Uploading CV…', async () => {
                                if (!file)
                                    return;
                                const name = file.name.toLowerCase();
                                const mime = name.endsWith('.pdf') ? 'application/pdf'
                                    : name.endsWith('.docx') ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : '';
                                if (!mime)
                                    throw new Error('Choose a PDF (.pdf) or Word (.docx) file.');
                                await call(path + '?consent=true', { method: 'PUT', body: new Blob([file], { type: mime }) });
                                setFile(null);
                            }), children: [busy === 'Uploading CV…' && _jsx("span", { className: "btn-spinner", "aria-hidden": "true" }), busy === 'Uploading CV…' ? 'Uploading CV…' : 'Upload CV'] }) })] }), cv.data.consented_at && _jsxs("div", { className: "actions", children: [_jsxs("span", { className: "muted", children: ["CV uploaded ", new Date(cv.data.consented_at).toLocaleDateString(), "."] }), _jsxs("button", { type: "button", disabled: Boolean(busy), onClick: () => run('Analyzing CV…', async () => {
                            const result = await call(path + '/analyze', { method: 'POST' });
                            setUsage(result.ai_usage_id);
                        }), children: [busy === 'Analyzing CV…' ? _jsx("span", { className: "btn-spinner", "aria-hidden": "true" }) : _jsx(Icon, { name: "sparkle", size: 16 }), busy === 'Analyzing CV…' ? 'Analyzing CV…' : analysis ? 'Analyze again' : 'Analyze CV'] }), _jsx("button", { className: "ghost danger-text", type: "button", disabled: Boolean(busy), onClick: async () => {
                            if (!await confirmAction('Delete the intern’s CV and its analysis? This cannot be undone.', 'Delete CV', true))
                                return;
                            void run('Deleting CV…', async () => { await call(path, { method: 'DELETE' }); setUsage(undefined); setConsent(false); });
                        }, children: "Delete CV" })] }), analysis && _jsxs("div", { className: "assist", children: [_jsx("h3", { children: analysis.title }), _jsx("p", { children: analysis.goal }), _jsxs("p", { children: [_jsx("b", { children: "Skills in the CV:" }), " ", analysis.skills.join(', ') || 'None identified'] }), _jsxs("p", { children: [_jsx("b", { children: "Fitting programs:" }), " ", analysis.program_names.join(', ') || 'None identified'] }), analysis.mentor_questions.length > 0 && _jsxs("div", { className: "assist-block checks", children: [_jsx("h4", { children: "Ask the intern" }), _jsx("ul", { children: analysis.mentor_questions.map((question, i) => _jsx("li", { children: question }, i)) })] }), startPlan && _jsx("div", { className: "actions", children: _jsxs("button", { type: "button", onClick: () => startPlan(analysis), children: [_jsx(Icon, { name: "arrow", size: 16 }), "Open in plan editor"] }) }), _jsx(AiVote, { call: call, org: org, id: usage }, usage)] }), error && _jsx(ErrorNote, { message: error })] });
}
