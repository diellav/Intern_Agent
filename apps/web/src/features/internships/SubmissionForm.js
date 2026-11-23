import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useRef, useState } from 'react';
import { useResource } from '../../lib/api';
import { ErrorNote, Icon } from '../../ui';
export function fileSize(bytes) {
    if (bytes < 1024)
        return `${bytes} B`;
    if (bytes < 1024 * 1024)
        return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
const httpUrl = (value) => { try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
}
catch {
    return false;
} };
/** Description, structured links and files for one submission. Files are staged on the server as soon as they are picked. */
export function SubmissionForm({ call, base, taskId, resubmit, onSent }) {
    const status = useResource(call, `${base}/uploads/status`);
    const [description, setDescription] = useState('');
    const [links, setLinks] = useState([]);
    const [items, setItems] = useState([]);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState('');
    const counter = useRef(0);
    const picker = useRef(null);
    const tasks = `${base}/tasks/${taskId}`;
    const uploading = items.some(item => item.state === 'uploading');
    const badLink = links.find(link => link.url && !httpUrl(link.url));
    const filledLinks = links.filter(link => link.url.trim());
    const ready = items.filter(item => item.state === 'done');
    const empty = !description.trim() && !filledLinks.length && !ready.length;
    function update(key, fields) {
        setItems(current => current.map(item => item.key === key ? { ...item, ...fields } : item));
    }
    async function send(item) {
        update(item.key, { state: 'uploading', error: undefined });
        try {
            const staged = await call(`${tasks}/files?name=${encodeURIComponent(item.file.name)}`, { method: 'POST', body: item.file });
            update(item.key, { state: 'done', staged });
        }
        catch (failure) {
            update(item.key, { state: 'error', error: failure instanceof Error ? failure.message : 'Upload failed.' });
        }
    }
    function add(files) {
        const limits = status.data;
        for (const file of Array.from(files ?? [])) {
            const key = ++counter.current;
            const ext = file.name.includes('.') ? '.' + file.name.split('.').pop().toLowerCase() : '';
            const problem = !limits ? '' : !limits.extensions.includes(ext) ? 'This file type is not allowed.'
                : file.size > limits.max_bytes ? `Larger than ${fileSize(limits.max_bytes)}.` : file.size === 0 ? 'The file is empty.' : '';
            const item = { key, file, state: problem ? 'error' : 'uploading', error: problem || undefined };
            setItems(current => [...current, item]);
            if (!problem)
                void send(item);
        }
        if (picker.current)
            picker.current.value = '';
    }
    async function remove(item) {
        setItems(current => current.filter(other => other.key !== item.key));
        if (item.staged)
            await call(`${tasks}/files/${item.staged.id}`, { method: 'DELETE' }).catch(() => undefined);
    }
    async function submit(event) {
        event.preventDefault();
        if (sending || uploading || badLink || empty)
            return;
        setSending(true);
        setError('');
        try {
            await call(`${tasks}/submissions`, { method: 'POST', body: JSON.stringify({
                    evidence: description.trim(), links: filledLinks.map(link => ({ url: link.url.trim(), title: link.title.trim() })),
                    file_ids: ready.map(item => item.staged.id),
                }) });
            setDescription('');
            setLinks([]);
            setItems([]);
            onSent();
        }
        catch (failure) {
            setError((failure instanceof Error ? failure.message : 'Could not send your work.') + ' Everything you entered is still here.');
        }
        finally {
            setSending(false);
        }
    }
    return _jsxs("form", { onSubmit: submit, className: "submission-form", "aria-busy": sending, children: [_jsx("h3", { className: "label", children: resubmit ? 'Send an updated version' : 'Submit your work' }), _jsxs("label", { children: ["Description", _jsx("textarea", { rows: 4, maxLength: 6000, value: description, onChange: e => setDescription(e.target.value), placeholder: "What did you do, and how can your mentor check it?" })] }), _jsxs("fieldset", { className: "grid gap-2", children: [_jsx("legend", { className: "label", children: "Links" }), links.map((link, index) => _jsxs("div", { className: "link-input", children: [_jsx("input", { type: "url", inputMode: "url", placeholder: "https://\u2026", "aria-label": `Link ${index + 1} address`, value: link.url, "aria-invalid": !!link.url && !httpUrl(link.url), onChange: e => setLinks(links.map((item, i) => i === index ? { ...item, url: e.target.value } : item)) }), _jsx("input", { placeholder: "Title (optional)", "aria-label": `Link ${index + 1} title`, maxLength: 120, value: link.title, onChange: e => setLinks(links.map((item, i) => i === index ? { ...item, title: e.target.value } : item)) }), _jsx("button", { type: "button", className: "ghost sm", "aria-label": `Remove link ${index + 1}`, onClick: () => setLinks(links.filter((_, i) => i !== index)), children: "Remove" })] }, index)), badLink && _jsx("p", { className: "field-error", children: "Links must start with http:// or https://" }), links.length < 10 && _jsxs("button", { type: "button", className: "secondary sm", style: { justifySelf: 'start' }, onClick: () => setLinks([...links, { url: '', title: '' }]), children: [_jsx(Icon, { name: "plus", size: 15 }), "Add link"] })] }), _jsxs("fieldset", { className: "grid gap-2", children: [_jsx("legend", { className: "label", children: "Files" }), status.data && !status.data.configured && _jsx("p", { className: "fine", children: "File uploads are not set up on this server yet. Add links or a description instead." }), items.length > 0 && _jsx("ul", { className: "file-list", children: items.map(item => _jsxs("li", { className: `file-item ${item.state}`, children: [_jsx(Icon, { name: "file", size: 16 }), _jsxs("span", { className: "grow", children: [_jsx("b", { children: item.file.name }), _jsxs("span", { className: "fine", children: [fileSize(item.file.size), " \u00B7 ", item.state === 'uploading' ? 'Uploading…' : item.state === 'done' ? 'Ready' : item.error] })] }), item.state === 'uploading' && _jsx("span", { className: "btn-spinner dark", "aria-label": "Uploading" }), item.state === 'error' && status.data?.extensions.includes('.' + item.file.name.split('.').pop().toLowerCase()) && item.file.size <= (status.data?.max_bytes ?? 0) &&
                                    _jsx("button", { type: "button", className: "ghost sm", onClick: () => void send(item), children: "Retry" }), _jsx("button", { type: "button", className: "ghost sm", disabled: item.state === 'uploading', onClick: () => void remove(item), "aria-label": `Remove ${item.file.name}`, children: "Remove" })] }, item.key)) }), status.data?.configured && _jsxs("div", { children: [_jsx("input", { ref: picker, type: "file", multiple: true, className: "sr-only", id: `files-${taskId}`, accept: status.data.extensions.join(','), onChange: e => add(e.target.files) }), _jsxs("label", { htmlFor: `files-${taskId}`, className: "file-drop", tabIndex: 0, onKeyDown: e => { if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    picker.current?.click();
                                } }, children: [_jsx(Icon, { name: "plus", size: 15 }), "Add files ", _jsxs("span", { className: "fine", children: ["PDF, images, text, Office or ZIP \u00B7 up to ", fileSize(status.data.max_bytes), " each"] })] })] })] }), error && _jsx(ErrorNote, { message: error }), _jsxs("div", { className: "actions", children: [_jsxs("button", { disabled: sending || uploading || !!badLink || empty, children: [sending ? _jsx("span", { className: "btn-spinner", "aria-hidden": "true" }) : _jsx(Icon, { name: "arrow", size: 16 }), sending ? 'Sending…' : uploading ? 'Waiting for uploads…' : resubmit ? 'Send new version' : 'Submit work'] }), empty && _jsx("span", { className: "fine", children: "Add a description, a link or a file." })] })] });
}
