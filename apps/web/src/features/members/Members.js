import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useRef, useState } from 'react';
import { useResource } from '../../lib/api';
import { ErrorNote, Loading, Modal } from '../../ui';
/** Keyed by organization so switching workspaces never shows another org's rows or notices. */
export function Members(props) {
    return _jsx(MembersPanel, { ...props }, props.orgId);
}
function MembersPanel({ call, orgId, userId }) {
    const path = `/api/organizations/${orgId}/members`;
    const members = useResource(call, path);
    const [open, setOpen] = useState(false);
    const [removing, setRemoving] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    // Synchronous guard: state updates are async, so a fast double click could otherwise submit twice.
    const pending = useRef(false);
    async function act(url, success, body, method = 'POST') {
        if (pending.current)
            return;
        pending.current = true;
        setBusy(true);
        setError('');
        setNotice('');
        try {
            const result = await call(url, { method, body });
            setOpen(false);
            setRemoving(null);
            setNotice(typeof success === 'function' ? success(result) : success);
            members.reload();
        }
        catch (failure) {
            setError(failure instanceof Error ? failure.message : 'Could not update membership.');
        }
        finally {
            pending.current = false;
            setBusy(false);
        }
    }
    function invite(event) {
        event.preventDefault();
        const form = Object.fromEntries(new FormData(event.currentTarget));
        const email = (form.email ?? '').trim();
        void act(path, result => result.invited
            ? `Invitation sent to ${email}.`
            : `Added existing account ${email}. No invitation email was needed.`, JSON.stringify(form));
    }
    function changeRole(member, role) {
        if (role === member.role)
            return;
        void act(`${path}/${member.id}/role`, `${member.full_name || member.email} is now ${role === 'admin' ? 'an admin' : `a ${role}`}.`, JSON.stringify({ role }), 'PUT');
    }
    return _jsxs("section", { className: "card", children: [_jsxs("div", { className: "section-head", children: [_jsx("h2", { children: "Organization members" }), _jsx("button", { onClick: () => { setError(''); setOpen(true); }, children: "Invite member" })] }), notice && _jsx("p", { className: "notice", role: "status", children: notice }), members.error && _jsx(ErrorNote, { message: members.error, onRetry: members.reload }), error && !open && !removing && _jsx(ErrorNote, { message: error }), !members.data && !members.error && _jsx(Loading, {}), _jsx("ul", { className: "rows", children: members.data?.map(member => _jsxs("li", { className: "row flex flex-wrap gap-3", children: [_jsxs("div", { className: "row-main", children: [_jsx("strong", { children: member.full_name || member.email }), member.full_name && _jsx("span", { className: "fine break-all", children: member.email }), _jsxs("span", { className: "capitalize", children: [member.role, " \u00B7 ", member.status] })] }), member.status !== 'inactive' && _jsxs("label", { className: "fine", children: ["Role", _jsxs("select", { "aria-label": `Role for ${member.full_name || member.email}`, value: member.role, disabled: busy || member.id === userId, title: member.id === userId ? 'You cannot change your own role.' : undefined, onChange: event => changeRole(member, event.target.value), children: [_jsx("option", { value: "intern", children: "Intern" }), _jsx("option", { value: "mentor", children: "Mentor" }), _jsx("option", { value: "admin", children: "Admin" })] })] }), member.status === 'pending' && _jsx("button", { className: "secondary sm", disabled: busy, onClick: () => void act(path + '/' + member.id + '/resend', 'Invitation resent.'), children: "Resend" }), member.id !== userId && member.status !== 'inactive' && _jsx("button", { className: "ghost sm", disabled: busy, onClick: () => { setError(''); setRemoving(member); }, children: "Remove" })] }, member.id)) }), _jsx(Modal, { open: open, onClose: () => { if (!busy)
                    setOpen(false); }, title: "Invite member", children: open && _jsxs("form", { onSubmit: invite, children: [_jsxs("label", { children: ["Full name", _jsx("input", { name: "full_name", required: true, maxLength: 120 })] }), _jsxs("label", { children: ["Email", _jsx("input", { name: "email", type: "email", required: true, maxLength: 254 })] }), _jsxs("label", { children: ["Role", _jsxs("select", { name: "role", defaultValue: "intern", children: [_jsx("option", { value: "intern", children: "Intern" }), _jsx("option", { value: "mentor", children: "Mentor" }), _jsx("option", { value: "admin", children: "Admin" })] })] }), error && _jsx(ErrorNote, { message: error }), _jsx("div", { className: "modal-actions", children: _jsx("button", { disabled: busy, children: busy ? 'Adding…' : 'Invite member' }) })] }) }), _jsx(Modal, { open: !!removing, onClose: () => { if (!busy)
                    setRemoving(null); }, title: "Remove member", children: removing && _jsxs(_Fragment, { children: [_jsxs("p", { children: [removing.full_name || removing.email, " will lose access to this organization."] }), error && _jsx(ErrorNote, { message: error }), _jsx("div", { className: "modal-actions", children: _jsx("button", { disabled: busy, onClick: () => void act(path + '/' + removing.id + '/remove', 'Membership deactivated.'), children: busy ? 'Removing…' : 'Remove member' }) })] }) })] });
}
