import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { useRef, useState } from 'react';
import { AiVote } from '../ai/AiUsage';
import { useResource } from '../../lib/api';
import { Badge, ErrorNote, Icon, Loading, displayName, formatDate, confirmAction } from '../../ui';
const labels = { completed: 'Completed', changes_requested: 'Changes requested', overdue: 'Overdue' };
const day = (value) => new Date(value.getTime() - value.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const span = (start, end) => `${formatDate(start)} – ${formatDate(end)}`;
function thisWeek() {
    const monday = new Date();
    monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7);
    const sunday = new Date(monday);
    sunday.setDate(sunday.getDate() + 6);
    return { start: day(monday), end: day(sunday) };
}
function periodError(start, end) {
    if (!start || !end)
        return 'Choose a start and an end date.';
    if (end < start)
        return 'The end date must be on or after the start date.';
    if ((new Date(end).getTime() - new Date(start).getTime()) / 86400000 > 365)
        return 'Choose a period of up to 366 days.';
    return '';
}
function EvidenceLink({ item, internship, openTask }) {
    return _jsxs("button", { className: "row-link compact", type: "button", onClick: () => openTask(internship, item.task_id, item.version ?? undefined), children: [_jsxs("span", { className: "row-primary", children: [_jsxs("span", { className: "row-title", children: [item.title, item.version ? ` · version ${item.version}` : ''] }), _jsxs("span", { className: "row-sub", children: [labels[item.kind], " \u00B7 due ", formatDate(item.due_on)] })] }), _jsx(Icon, { name: "arrow", size: 15 })] });
}
function MetricsStrip({ metrics, frozen }) {
    return _jsxs("div", { className: "stack", style: { gap: 'var(--s-2)' }, children: [_jsxs("div", { className: "stat-strip", children: [_jsxs("div", { className: "stat-cell", children: [_jsx("strong", { children: metrics.completed_tasks }), _jsx("span", { children: "Tasks completed" })] }), _jsxs("div", { className: "stat-cell", children: [_jsx("strong", { children: metrics.versions_returned }), _jsx("span", { children: "Versions returned for changes" })] }), _jsxs("div", { className: "stat-cell", children: [_jsx("strong", { children: metrics.overdue_tasks }), _jsx("span", { children: "Open tasks past their deadline" })] })] }), _jsx("p", { className: "fine", children: frozen ? `Numbers frozen when the report was shared (deadlines checked ${formatDate(metrics.as_of)}).` : `Live numbers, deadlines checked ${formatDate(metrics.as_of)}. Saving the draft stores them with the report.` })] });
}
function Findings({ findings, internship, openTask, stale }) {
    if (!findings.length)
        return null;
    return _jsxs("div", { className: "stack", style: { gap: 'var(--s-3)' }, children: [_jsxs("p", { className: "label", children: ["Sources for the summary", stale ? ' · the text was edited after these were generated' : ''] }), findings.map((finding, index) => _jsxs("article", { className: "assist-block", children: [_jsx("p", { children: finding.statement }), _jsx("div", { className: "grid gap-2", children: finding.sources.map((item, i) => _jsx(EvidenceLink, { item: item, internship: internship, openTask: openTask }, i)) })] }, index))] });
}
/** A shared report, exactly as it was when shared: summary, sources and frozen numbers. */
function SharedReport({ report, openTask }) {
    return _jsxs("details", { className: "plan-card report-card", children: [_jsxs("summary", { className: "plan-card-head", children: [_jsxs("div", { children: [_jsx("h3", { children: span(report.starts_on, report.ends_on) }), _jsxs("p", { className: "row-sub", children: ["Shared ", formatDate(report.shared_at)] })] }), _jsx(Badge, { tone: "success", children: "Shared" })] }), _jsxs("div", { className: "stack", style: { marginTop: 'var(--s-4)' }, children: [_jsx(MetricsStrip, { metrics: report.snapshot, frozen: true }), _jsx("p", { className: "prose-text", children: report.summary }), _jsx(Findings, { findings: report.findings ?? [], internship: report.internship_id, openTask: openTask }), !report.findings?.length && report.snapshot.evidence.length > 0 && _jsxs("div", { className: "grid gap-2", children: [_jsx("p", { className: "label", children: "Evidence" }), report.snapshot.evidence.map((item, i) => _jsx(EvidenceLink, { item: item, internship: report.internship_id, openTask: openTask }, i))] })] })] });
}
function Editor({ call, base, internship, period, existing, openTask, refresh }) {
    const query = '?' + new URLSearchParams(period);
    const live = useResource(call, existing?.shared_at ? null : `${base}/${internship}/progress${query}`);
    const [findings, setFindings] = useState(existing?.findings ?? []);
    const [generatedText, setGeneratedText] = useState(existing?.findings?.length ? existing.summary : null);
    const [text, setText] = useState(existing?.summary ?? '');
    const [usage, setUsage] = useState();
    const [busy, setBusy] = useState('');
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const running = useRef(false);
    if (existing?.shared_at)
        return _jsxs("section", { className: "panel", children: [_jsxs("div", { className: "notice", children: [_jsx(Icon, { name: "check" }), _jsxs("span", { children: ["This period was shared with the intern on ", formatDate(existing.shared_at), " and can\u2019t be changed. Choose another period for a new report."] })] }), _jsx(SharedReport, { report: existing, openTask: openTask })] });
    if (live.error)
        return _jsx(ErrorNote, { message: live.error, onRetry: live.reload });
    if (!live.data)
        return _jsx("section", { className: "panel", children: _jsx(Loading, { rows: 3 }) });
    const metrics = live.data;
    const edited = generatedText !== null && text !== generatedText;
    async function run(kind, action) {
        if (running.current)
            return;
        running.current = true;
        setBusy(kind);
        setError('');
        setMessage('');
        try {
            await action();
        }
        catch (failure) {
            setError(failure instanceof Error ? failure.message : 'Something went wrong. Your text is kept.');
        }
        finally {
            running.current = false;
            setBusy('');
        }
    }
    const generate = async () => {
        if (text.trim() && text !== generatedText && !await confirmAction('Replace your current summary with a new AI draft?'))
            return;
        void run('generating', async () => {
            const result = await call(`${base}/${internship}/progress/summary${query}`, { method: 'POST' });
            const joined = result.findings.map(finding => finding.statement).join('\n\n');
            setFindings(result.findings);
            setGeneratedText(joined);
            setText(joined);
            setUsage(result.ai_usage_id);
            if (!result.findings.length)
                setMessage('No findings for this period. You can still write the summary yourself.');
        });
    };
    const save = async (share) => {
        if (share && !await confirmAction('Share this report with the intern? It can’t be edited afterwards.', 'Share report'))
            return;
        void run(share ? 'sharing' : 'saving', async () => {
            await call(`${base}/${internship}/progress/report${query}`, { method: 'PUT', body: JSON.stringify({
                    summary: text, share,
                    findings: findings.map(finding => ({ statement: finding.statement, sources: finding.sources.map(s => ({ task_id: s.task_id, version: s.version, kind: s.kind })) })),
                }) });
            setMessage(share ? 'Shared with the intern. It now appears in their reports.' : 'Draft saved with today’s numbers and sources.');
            refresh();
            live.reload();
        });
    };
    return _jsxs("div", { className: "stack", children: [_jsxs("section", { className: "panel", children: [_jsx("header", { className: "panel-head", children: _jsxs("div", { children: [_jsxs("h2", { children: ["Numbers for ", span(period.start, period.end)] }), existing && _jsx("p", { children: "Draft saved earlier for this period." })] }) }), _jsx(MetricsStrip, { metrics: metrics, frozen: false }), _jsxs("details", { className: "more-options", children: [_jsxs("summary", { children: ["Evidence (", metrics.evidence.length, ")"] }), _jsx("div", { className: "grid gap-2", style: { marginTop: 'var(--s-3)' }, children: metrics.evidence.length === 0 ? _jsx("p", { className: "empty-line", children: "No completed, returned or overdue work in this period." })
                                    : metrics.evidence.map((item, i) => _jsx(EvidenceLink, { item: item, internship: internship, openTask: openTask }, i)) })] })] }), _jsxs("section", { className: "panel", children: [_jsxs("header", { className: "panel-head", children: [_jsxs("div", { children: [_jsx("h2", { children: "Summary" }), _jsx("p", { children: "Write it yourself or start from an AI draft built only from the evidence above." })] }), _jsxs("button", { type: "button", className: "secondary", "aria-disabled": !!busy || !metrics.evidence.length, disabled: !metrics.evidence.length, onClick: generate, children: [busy === 'generating' ? _jsx("span", { className: "btn-spinner dark", "aria-hidden": "true" }) : _jsx(Icon, { name: "sparkle", size: 16 }), busy === 'generating' ? 'Generating summary…' : findings.length ? 'Generate again' : 'Generate summary'] })] }), _jsx("label", { className: "sr-only", htmlFor: "report-summary", children: "Report summary" }), _jsx("textarea", { id: "report-summary", rows: 7, maxLength: 6000, value: text, disabled: busy === 'generating', onChange: event => setText(event.target.value), placeholder: "What went well, what was returned, and what comes next." }), _jsx(Findings, { findings: findings, internship: internship, openTask: openTask, stale: edited }), _jsx(AiVote, { call: call, org: base.split('/')[3], id: usage }, usage), error && _jsx(ErrorNote, { message: error }), message && _jsxs("p", { className: "notice success-note", role: "status", children: [_jsx(Icon, { name: "check" }), message] }), _jsxs("div", { className: "actions actions-end", children: [_jsxs("button", { type: "button", className: "secondary", disabled: !!busy, onClick: () => save(false), children: [busy === 'saving' && _jsx("span", { className: "btn-spinner dark", "aria-hidden": "true" }), busy === 'saving' ? 'Saving draft…' : 'Save draft'] }), _jsxs("button", { type: "button", disabled: !!busy || !text.trim(), onClick: () => save(true), children: [busy === 'sharing' && _jsx("span", { className: "btn-spinner", "aria-hidden": "true" }), busy === 'sharing' ? 'Sharing…' : 'Share with intern'] })] })] })] });
}
export function ProgressReports({ call, orgId, openTask, canEdit }) {
    const base = '/api/organizations/' + orgId + '/internships';
    const list = useResource(call, base);
    const [id, setId] = useState('');
    const [period, setPeriod] = useState(thisWeek);
    const selected = list.data?.find(item => item.id === id)?.id ?? list.data?.[0]?.id;
    const saved = useResource(call, selected ? `${base}/${selected}/progress/reports` : null);
    const reports = saved.data?.filter(report => report.internship_id === selected) ?? [];
    const invalid = periodError(period.start, period.end);
    const existing = reports.find(report => report.starts_on === period.start && report.ends_on === period.end);
    const visible = canEdit ? reports : reports.filter(report => report.shared_at);
    if (list.error)
        return _jsx(ErrorNote, { message: list.error, onRetry: list.reload });
    if (!list.data)
        return _jsx("section", { className: "panel", children: _jsx(Loading, { rows: 3 }) });
    if (list.data.length === 0)
        return _jsx("p", { className: "empty-line", children: "No internships available." });
    return _jsxs("div", { className: "stack", children: [_jsxs("section", { className: "panel", children: [_jsxs("div", { className: "form-grid two", children: [_jsxs("label", { children: ["Internship", _jsx("select", { value: selected, onChange: event => setId(event.target.value), children: list.data.map(item => _jsxs("option", { value: item.id, children: [displayName(item.intern_name, item.intern_email), " \u00B7 ", item.program_name] }, item.id)) })] }), canEdit && _jsxs("div", { className: "date-pair", children: [_jsxs("label", { children: ["Start", _jsx("input", { type: "date", value: period.start, onChange: event => setPeriod({ ...period, start: event.target.value }) })] }), _jsxs("label", { children: ["End", _jsx("input", { type: "date", value: period.end, onChange: event => setPeriod({ ...period, end: event.target.value }) })] })] })] }), canEdit && _jsxs("div", { className: "chip-row", children: [_jsx("button", { type: "button", className: "chip", onClick: () => setPeriod(thisWeek()), children: "This week" }), _jsx("button", { type: "button", className: "chip", onClick: () => { const end = new Date(); const start = new Date(); start.setDate(end.getDate() - 13); setPeriod({ start: day(start), end: day(end) }); }, children: "Last 14 days" })] }), canEdit && invalid && _jsx("p", { className: "field-error", children: invalid })] }), canEdit && selected && !invalid && _jsx(Editor, { call: call, base: base, internship: selected, period: period, existing: existing, openTask: openTask, refresh: saved.reload }, `${selected}:${period.start}:${period.end}:${existing?.id ?? 'new'}:${existing?.shared_at ?? ''}`), _jsxs("section", { className: "panel", children: [_jsx("header", { className: "panel-head", children: _jsxs("div", { children: [_jsx("h2", { children: canEdit ? 'Reports for this internship' : 'Reports shared with you' }), canEdit && _jsx("p", { children: "Drafts are visible only to mentors and admins. Open one to continue it." })] }) }), saved.error && _jsx(ErrorNote, { message: saved.error, onRetry: saved.reload }), !saved.data && !saved.error && _jsx(Loading, { rows: 2 }), saved.data && visible.length === 0 && _jsx("p", { className: "empty-line", children: canEdit ? 'No reports yet.' : 'Your mentor hasn’t shared a report yet.' }), _jsx("div", { className: "grid gap-3", children: visible.map(report => report.shared_at
                            ? _jsx(SharedReport, { report: report, openTask: openTask }, report.id)
                            : _jsxs("button", { type: "button", className: "row-link compact", onClick: () => setPeriod({ start: report.starts_on, end: report.ends_on }), children: [_jsxs("span", { className: "row-primary", children: [_jsx("span", { className: "row-title", children: span(report.starts_on, report.ends_on) }), _jsx("span", { className: "row-sub", children: report.summary ? report.summary.slice(0, 90) + (report.summary.length > 90 ? '…' : '') : 'No summary yet' })] }), _jsx(Badge, { children: "Draft" })] }, report.id)) })] })] });
}
