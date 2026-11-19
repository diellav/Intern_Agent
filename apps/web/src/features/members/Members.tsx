import { useRef, useState, type FormEvent } from 'react'
import { useResource, type Call } from '../../lib/api'
import { ErrorNote, Loading, Modal } from '../../ui'

type Member = { id: string; email: string; full_name: string | null; role: string; status: 'active' | 'inactive' | 'pending' }

type Props = { call: Call; orgId: string; userId: string }
type Role = 'admin' | 'mentor' | 'intern'

/** Keyed by organization so switching workspaces never shows another org's rows or notices. */
export function Members(props: Props) {
  return <MembersPanel key={props.orgId} {...props} />
}

function MembersPanel({ call, orgId, userId }: Props) {
  const path = `/api/organizations/${orgId}/members`
  const members = useResource<Member[]>(call, path)
  const [open, setOpen] = useState(false)
  const [removing, setRemoving] = useState<Member | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  // Synchronous guard: state updates are async, so a fast double click could otherwise submit twice.
  const pending = useRef(false)

  async function act<T>(url: string, success: string | ((result: T) => string), body?: string, method = 'POST') {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await call<T>(url, { method, body })
      setOpen(false)
      setRemoving(null)
      setNotice(typeof success === 'function' ? success(result) : success)
      members.reload()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not update membership.')
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>
    const email = (form.email ?? '').trim()
    void act<{ invited: boolean }>(path, result => result.invited
      ? `Invitation sent to ${email}.`
      : `Added existing account ${email}. No invitation email was needed.`, JSON.stringify(form))
  }

  function changeRole(member: Member, role: Role) {
    if (role === member.role) return
    void act(`${path}/${member.id}/role`, `${member.full_name || member.email} is now ${role === 'admin' ? 'an admin' : `a ${role}`}.`,
      JSON.stringify({ role }), 'PUT')
  }

  return <section className="card">
    <div className="section-head"><h2>Organization members</h2>
      <button onClick={() => { setError(''); setOpen(true) }}>Invite member</button>
    </div>
    {notice && <p className="notice" role="status">{notice}</p>}
    {members.error && <ErrorNote message={members.error} onRetry={members.reload} />}
    {error && !open && !removing && <ErrorNote message={error} />}
    {!members.data && !members.error && <Loading />}
    <ul className="rows">{members.data?.map(member => <li className="row flex flex-wrap gap-3" key={member.id}>
      <div className="row-main"><strong>{member.full_name || member.email}</strong>
        {member.full_name && <span className="fine break-all">{member.email}</span>}
        <span className="capitalize">{member.role} · {member.status}</span>
      </div>
      {member.status !== 'inactive' && <label className="fine">Role
        <select aria-label={`Role for ${member.full_name || member.email}`} value={member.role}
          disabled={busy || member.id === userId} title={member.id === userId ? 'You cannot change your own role.' : undefined}
          onChange={event => changeRole(member, event.target.value as Role)}>
          <option value="intern">Intern</option><option value="mentor">Mentor</option><option value="admin">Admin</option>
        </select></label>}
      {member.status === 'pending' && <button className="secondary sm" disabled={busy} onClick={() => void act(path + '/' + member.id + '/resend', 'Invitation resent.')}>Resend</button>}
      {member.id !== userId && member.status !== 'inactive' && <button className="ghost sm" disabled={busy} onClick={() => { setError(''); setRemoving(member) }}>Remove</button>}
    </li>)}</ul>
    <Modal open={open} onClose={() => { if (!busy) setOpen(false) }} title="Invite member">
      {open && <form onSubmit={invite}>
        <label>Full name<input name="full_name" required maxLength={120} /></label>
        <label>Email<input name="email" type="email" required maxLength={254} /></label>
        <label>Role<select name="role" defaultValue="intern"><option value="intern">Intern</option><option value="mentor">Mentor</option><option value="admin">Admin</option></select></label>
        {error && <ErrorNote message={error} />}
        <div className="modal-actions"><button disabled={busy}>{busy ? 'Adding…' : 'Invite member'}</button></div>
      </form>}
    </Modal>
    <Modal open={!!removing} onClose={() => { if (!busy) setRemoving(null) }} title="Remove member">
      {removing && <><p>{removing.full_name || removing.email} will lose access to this organization.</p>
        {error && <ErrorNote message={error} />}
        <div className="modal-actions"><button disabled={busy} onClick={() => void act(path + '/' + removing.id + '/remove', 'Membership deactivated.')}>{busy ? 'Removing…' : 'Remove member'}</button></div>
      </>}
    </Modal>
  </section>
}
