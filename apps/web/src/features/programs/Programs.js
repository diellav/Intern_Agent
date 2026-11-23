import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { useResource } from '../../lib/api';
import { Empty, ErrorNote, Icon, Modal } from '../../ui';
function CreateProgram({ open, path, call, onClose, onCreated }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    async function create(event) {
        event.preventDefault();
        if (busy)
            return;
        const fields = new FormData(event.currentTarget);
        setBusy(true);
        setError('');
        try {
            onCreated(await call(path, { method: 'POST', body: JSON.stringify({ name: fields.get('name'), description: fields.get('description') }) }));
            onClose();
        }
        catch (failure) {
            setError(failure instanceof Error ? failure.message : 'Could not create the program.'); // the form keeps what was typed
        }
        finally {
            setBusy(false);
        }
    }
    return _jsx(Modal, { open: open, onClose: onClose, title: "Create a program", description: "Group internships under a shared curriculum.", children: _jsxs("form", { onSubmit: create, className: "grid gap-3", children: [_jsxs("label", { children: ["Program name", _jsx("input", { name: "name", autoFocus: true, placeholder: "Frontend internship", required: true, maxLength: 120 })] }), _jsxs("label", { children: ["Description ", _jsx("span", { children: "(optional)" }), _jsx("textarea", { name: "description", rows: 4, maxLength: 1000, placeholder: "What will interns learn?" })] }), error && _jsx(ErrorNote, { message: error }), _jsxs("div", { className: "modal-actions", children: [_jsx("button", { type: "button", className: "ghost", onClick: onClose, children: "Cancel" }), _jsxs("button", { disabled: busy, children: [busy ? _jsx("span", { className: "btn-spinner", "aria-hidden": "true" }) : _jsx(Icon, { name: "plus", size: 16 }), busy ? 'Creating program…' : 'Create program'] })] })] }) });
}
export function Programs({ call, orgId, role, openProgram }) {
    const path = `/api/organizations/${orgId}/programs`;
    const programs = useResource(call, path);
    const [search, setSearch] = useState('');
    const [creating, setCreating] = useState(false);
    const query = search.trim().toLowerCase();
    const visible = programs.data?.filter(program => (program.name + ' ' + program.description).toLowerCase().includes(query));
    return _jsxs("div", { className: "stack", children: [_jsxs("div", { className: "toolbar", children: [!!programs.data?.length && _jsxs("div", { className: "search grow", children: [_jsx(Icon, { name: "search", size: 17 }), _jsx("input", { type: "search", "aria-label": "Search programs", value: search, onChange: event => setSearch(event.target.value), placeholder: "Search programs" })] }), role === 'admin' && _jsxs("button", { onClick: () => setCreating(true), children: [_jsx(Icon, { name: "plus", size: 16 }), "Create program"] })] }), role === 'admin' && _jsx(CreateProgram, { open: creating, path: path, call: call, onClose: () => setCreating(false), onCreated: program => programs.setData(current => [...(current ?? []), program].sort((a, b) => a.name.localeCompare(b.name))) }), programs.error && _jsx(ErrorNote, { message: programs.error, onRetry: programs.reload }), !programs.data && !programs.error && _jsx("div", { className: "card-grid", children: [0, 1, 2].map(i => _jsx("div", { className: "skeleton", style: { height: '10rem', borderRadius: 'var(--r-lg)' } }, i)) }), programs.data?.length === 0 && _jsx(Empty, { icon: "grid", title: "No programs yet", children: role === 'admin' ? 'Create the first program to get started.' : 'Your admin hasn’t created any programs yet.' }), !!programs.data?.length && visible?.length === 0 && _jsxs("p", { className: "empty-line", children: ["No programs match \u201C", search.trim(), "\u201D."] }), _jsx("ul", { className: "card-grid", children: visible?.map(program => _jsx("li", { children: _jsxs("article", { className: "program-card", children: [_jsx("h3", { children: program.name }), _jsx("p", { className: "program-desc", children: program.description || 'No description yet.' }), _jsxs("footer", { children: [_jsxs("span", { className: program.internship_count ? 'pill' : 'pill muted-pill', children: [program.internship_count, " internship", program.internship_count === 1 ? '' : 's'] }), program.internship_count > 0
                                        ? _jsxs("button", { className: "ghost sm", onClick: () => openProgram(program.id), children: ["Open", _jsx(Icon, { name: "arrow", size: 15 })] })
                                        : _jsx("span", { className: "muted", children: role === 'admin' ? 'No assignments yet' : 'None you can open' })] })] }) }, program.id)) }), role !== 'admin' && !!programs.data?.length && _jsx("p", { className: "fine", children: "Counts include only internships you have access to." })] });
}
