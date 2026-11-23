import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
import { useResource } from '../../lib/api';
import { ErrorNote, Icon } from '../../ui';
import { offset } from './PlanEditor';
function longDate(value) {
    return new Date(value + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}
function periodSummary(start, end) {
    if (!start || !end || end < start)
        return 'Choose a start and an end date.';
    const days = Math.round((new Date(end + 'T12:00:00').getTime() - new Date(start + 'T12:00:00').getTime()) / 86400000) + 1;
    return `${longDate(start)} – ${longDate(end)} · ${days} day${days === 1 ? '' : 's'}`;
}
/** Waiting status for a single provider call. Only elapsed time is shown, because there are no real steps to report. */
function Waiting({ onStop }) {
    const [seconds, setSeconds] = useState(0);
    useEffect(() => {
        const timer = setInterval(() => setSeconds(value => value + 1), 1000);
        return () => clearInterval(timer);
    }, []);
    return _jsxs("div", { className: "waiting", role: "status", "aria-live": "polite", children: [_jsx("span", { className: "btn-spinner dark", "aria-hidden": "true" }), _jsxs("span", { children: ["Waiting for the AI draft \u00B7 ", seconds, "s", seconds >= 20 ? '. Longer periods can take up to a minute.' : ''] }), _jsx("button", { type: "button", className: "ghost sm", onClick: onStop, children: "Stop waiting" }), _jsx("p", { className: "fine waiting-note", children: "Stop waiting only stops this browser from waiting. The server may still finish the request, but nothing is saved until you save the plan." })] });
}
/** Collects the mentor's intent and asks the server for an AI draft. The result opens in the plan editor. */
export function GenerateDraft({ call, path, starts, ends, defaultStart, initial, onDraft, onManual, onCancel }) {
    const initialEnd = offset(defaultStart, 6);
    const [request, setRequest] = useState(initial ?? {
        starts_on: defaultStart, ends_on: initialEnd > ends ? ends : initialEnd, goal: '', total_hours: '',
        project: '', schedule_notes: '', instructions: '',
    });
    const suggestions = useResource(call, path + '/suggestions');
    const [pending, setPending] = useState(false);
    const [error, setError] = useState('');
    const active = useRef(null);
    useEffect(() => () => active.current?.abort(), []);
    const set = (fields) => setRequest(current => ({ ...current, ...fields }));
    async function submit(event) {
        event.preventDefault();
        if (active.current)
            return; // one request at a time
        const controller = new AbortController();
        active.current = controller;
        setPending(true);
        setError('');
        try {
            const result = await call(path + '/generate', {
                method: 'POST', signal: controller.signal,
                body: JSON.stringify({ ...request, total_hours: request.total_hours ? Number(request.total_hours) : null }),
            });
            if (!controller.signal.aborted)
                onDraft(result, request);
        }
        catch (failure) {
            if (!controller.signal.aborted)
                setError(failure instanceof Error ? failure.message : 'Could not generate a draft.');
        }
        finally {
            if (active.current === controller) {
                active.current = null;
                setPending(false);
            }
        }
    }
    function stopWaiting() {
        active.current?.abort();
        active.current = null;
        setPending(false);
        setError('Stopped waiting. Your entries are kept. Generate again when you are ready.');
    }
    const presets = [[7, '1 week'], [14, '2 weeks'], [30, '30 days']].map(([days, label]) => {
        const proposed = offset(request.starts_on, days - 1);
        return { label, end: proposed > ends ? ends : proposed };
    });
    return _jsxs("form", { onSubmit: submit, className: "ai-form", "aria-busy": pending, children: [_jsxs("fieldset", { disabled: pending, className: "ai-form-body", children: [_jsxs("section", { className: "form-section", children: [_jsx("h3", { children: "Period" }), _jsx("div", { className: "chip-row", role: "group", "aria-label": "Period length", children: presets.map(preset => _jsx("button", { type: "button", className: "chip", "aria-pressed": request.ends_on === preset.end, onClick: () => set({ ends_on: preset.end }), children: preset.label }, preset.label)) }), _jsxs("div", { className: "date-pair", children: [_jsxs("label", { children: ["Start", _jsx("input", { type: "date", min: starts, max: ends, required: true, value: request.starts_on, onChange: e => set({ starts_on: e.target.value }) })] }), _jsxs("label", { children: ["End", _jsx("input", { type: "date", min: request.starts_on || starts, max: ends, required: true, value: request.ends_on, onChange: e => set({ ends_on: e.target.value }) })] })] }), _jsxs("p", { className: "period-summary", children: [_jsx(Icon, { name: "calendar", size: 14 }), periodSummary(request.starts_on, request.ends_on)] })] }), _jsxs("section", { className: "form-section", children: [_jsx("h3", { children: "Focus" }), _jsx("label", { className: "sr-only", htmlFor: "draft-focus", children: "Focus for this period" }), _jsx("textarea", { id: "draft-focus", "data-autofocus": true, required: true, maxLength: 1000, rows: 3, value: request.goal, onChange: e => set({ goal: e.target.value }), placeholder: "What should this period achieve? e.g. Finish form validation and cover it with tests" }), !!suggestions.data?.length && _jsxs("div", { className: "suggestions", children: [_jsx("p", { className: "label", children: "Suggested from open work \u00B7 pick one to fill the focus, then edit it" }), _jsx("ul", { children: suggestions.data.map(item => _jsx("li", { children: _jsxs("button", { type: "button", className: "suggestion", "aria-pressed": request.goal === item.focus, onClick: () => set({ goal: item.focus }), children: [_jsx("span", { children: item.focus }), _jsxs("span", { className: "suggestion-source", children: [_jsx(Icon, { name: "file", size: 13 }), item.source] })] }) }, item.task_id + item.source)) })] })] }), _jsxs("section", { className: "form-section", children: [_jsx("h3", { children: "Workload" }), _jsxs("label", { className: "hours-field", children: ["Total hours for the period ", _jsx("span", { children: "(optional)" }), _jsx("input", { type: "number", inputMode: "decimal", min: "0.5", max: "1000", step: "0.5", value: request.total_hours, onChange: e => set({ total_hours: e.target.value }), placeholder: "e.g. 20" })] }), _jsxs("details", { className: "more-options", children: [_jsx("summary", { children: "Project, schedule and instructions" }), _jsxs("div", { className: "grid gap-3", style: { marginTop: '.75rem' }, children: [_jsxs("label", { children: ["Project", _jsx("input", { maxLength: 120, value: request.project, onChange: e => set({ project: e.target.value }), placeholder: "Contact form sandbox" })] }), _jsxs("label", { children: ["Schedule constraints", _jsx("input", { maxLength: 300, value: request.schedule_notes, onChange: e => set({ schedule_notes: e.target.value }), placeholder: "No work on Friday" })] }), _jsxs("label", { children: ["Instructions for the draft", _jsx("textarea", { maxLength: 500, rows: 2, value: request.instructions, onChange: e => set({ instructions: e.target.value }), placeholder: "Keep tasks small. Include one task about documentation." })] })] })] })] })] }), _jsxs("footer", { className: "ai-form-foot", children: [error && _jsx(ErrorNote, { message: error }), pending && _jsx(Waiting, { onStop: stopWaiting }), _jsxs("div", { className: "actions actions-end", children: [_jsx("button", { type: "button", className: "ghost", onClick: onCancel, children: "Cancel" }), _jsx("button", { type: "button", className: "secondary", disabled: pending, onClick: () => onManual(request), children: "Write it myself" }), _jsxs("button", { "aria-disabled": pending, className: pending ? 'is-busy' : undefined, children: [pending ? _jsx("span", { className: "btn-spinner", "aria-hidden": "true" }) : _jsx(Icon, { name: "sparkle", size: 16 }), pending ? 'Preparing draft…' : error ? 'Try again' : 'Generate draft'] })] })] })] });
}
