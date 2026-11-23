import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { useResource } from '../../lib/api';
import { ErrorNote, Icon, displayName, formatDate, confirmAction } from '../../ui';
const visibilityText = { private: 'Private · only you', shared: 'Shared with the intern' };
function NoteForm({ initial, busyLabel, label, onSubmit, onCancel }) {
    const [body, setBody] = useState(initial?.body ?? '');
    const [visibility, setVisibility] = useState(initial?.visibility ?? 'private');
    const [pending, setPending] = useState(false);
    const [error, setError] = useState('');
    async function submit(event) {
        event.preventDefault();
        if (pending || !body.trim())
            return;
        setPending(true);
        setError('');
        try {
            await onSubmit(body.trim(), visibility);
            if (!initial)
                setBody('');
        }
        catch (failure) {
            setError(failure instanceof Error ? failure.message : 'Could not save the note.');
        }
        finally {
            setPending(false);
        }
    }
    return _jsxs("form", { onSubmit: submit, className: "note-form", children: [_jsx("label", { className: "sr-only", htmlFor: `note-${initial?.id ?? 'new'}`, children: "Note" }), _jsx("textarea", { id: `note-${initial?.id ?? 'new'}`, rows: 3, maxLength: 4000, value: body, onChange: e => setBody(e.target.value), placeholder: "Observations, agreements, things to follow up\u2026" }), _jsxs("div", { className: "note-form-row", children: [_jsxs("div", { className: "segmented", role: "radiogroup", "aria-label": "Who can see this note", children: [_jsx("button", { type: "button", role: "radio", "aria-checked": visibility === 'private', "aria-pressed": visibility === 'private', onClick: () => setVisibility('private'), children: "Private" }), _jsx("button", { type: "button", role: "radio", "aria-checked": visibility === 'shared', "aria-pressed": visibility === 'shared', onClick: () => setVisibility('shared'), children: "Shared with intern" })] }), _jsxs("div", { className: "actions", children: [onCancel && _jsx("button", { type: "button", className: "ghost sm", onClick: onCancel, children: "Cancel" }), _jsxs("button", { className: "sm", disabled: pending || !body.trim(), children: [pending && _jsx("span", { className: "btn-spinner", "aria-hidden": "true" }), pending ? busyLabel : label] })] })] }), _jsx("p", { className: "fine", children: visibility === 'private' ? 'Only you can see this note. It is never sent to AI.' : 'The intern and organization admins can see this note. Shared notes can inform AI plan drafts.' }), error && _jsx(ErrorNote, { message: error })] });
}
export function Notes({ call, base, internshipId, role }) {
    const [search, setSearch] = useState('');
    const [query, setQuery] = useState('');
    const path = `${base}/internships/${internshipId}/notes`;
    const notes = useResource(call, path + (query ? `?q=${encodeURIComponent(query)}` : ''));
    const [editing, setEditing] = useState(null);
    const [error, setError] = useState('');
    useEffect(() => { const timer = setTimeout(() => setQuery(search.trim()), 300); return () => clearTimeout(timer); }, [search]);
    const mentor = role === 'mentor';
    async function remove(note) {
        if (!await confirmAction('Delete this note? This cannot be undone.', 'Delete note', true))
            return;
        setError('');
        try {
            await call(`${path}/${note.id}`, { method: 'DELETE' });
            notes.reload();
        }
        catch (failure) {
            setError(failure instanceof Error ? failure.message : 'Could not delete the note.');
        }
    }
    return _jsxs("section", { className: "panel notes", "aria-label": "Notes", children: [_jsx("header", { className: "panel-head", children: _jsxs("div", { children: [_jsxs("h2", { children: ["Notes", notes.data ? _jsx("span", { className: "count", children: notes.data.length }) : null] }), _jsx("p", { children: mentor ? 'Separate from criteria, submissions and reviews. Private by default.' : 'Notes your mentor has shared with you.' })] }) }), mentor && _jsx(NoteForm, { label: "Add note", busyLabel: "Saving note\u2026", onSubmit: async (body, visibility) => {
                    await call(path, { method: 'POST', body: JSON.stringify({ body, visibility }) });
                    notes.reload();
                } }), _jsxs("div", { className: "search", children: [_jsx(Icon, { name: "search", size: 17 }), _jsx("input", { type: "search", "aria-label": "Search notes", value: search, onChange: e => setSearch(e.target.value), placeholder: "Search notes" })] }), (error || notes.error) && _jsx(ErrorNote, { message: error || notes.error, onRetry: notes.error ? notes.reload : undefined }), !notes.data && !notes.error && _jsx("div", { className: "grid gap-2", children: [0, 1].map(i => _jsx("div", { className: "skeleton", style: { height: '4.5rem' } }, i)) }), notes.data?.length === 0 && (query
                ? _jsxs("p", { className: "fine", children: ["No notes match \u201C", query, "\u201D."] })
                : _jsxs("p", { className: "empty-line", children: [_jsx(Icon, { name: "book", size: 16 }), mentor ? 'No notes yet. Write the first one above.' : 'Your mentor hasn’t shared any notes yet.'] })), _jsx("ul", { className: "note-list", children: notes.data?.map(note => _jsx("li", { className: `note ${note.visibility}`, children: editing === note.id
                        ? _jsx(NoteForm, { initial: note, label: "Save", busyLabel: "Saving\u2026", onCancel: () => setEditing(null), onSubmit: async (body, visibility) => {
                                await call(`${path}/${note.id}`, { method: 'PUT', body: JSON.stringify({ body, visibility }) });
                                setEditing(null);
                                notes.reload();
                            } })
                        : _jsxs(_Fragment, { children: [_jsxs("div", { className: "note-meta", children: [_jsx("span", { className: `badge ${note.visibility === 'private' ? 'badge-neutral' : 'badge-brand'}`, children: note.mine ? visibilityText[note.visibility] : 'Shared by your mentor' }), _jsxs("span", { className: "fine", children: [note.mine ? 'You' : displayName(note.author_name, note.author_email ?? 'Mentor'), " \u00B7 ", formatDate(note.created_at), note.updated_at !== note.created_at ? ' · edited' : ''] })] }), _jsx("p", { className: "prose-text", children: note.body }), note.mine && _jsxs("div", { className: "actions", children: [_jsx("button", { className: "ghost sm", onClick: () => setEditing(note.id), children: "Edit" }), _jsx("button", { className: "ghost sm danger-text", onClick: () => void remove(note), children: "Delete" })] })] }) }, note.id)) })] });
}
