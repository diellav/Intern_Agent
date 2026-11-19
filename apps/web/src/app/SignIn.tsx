import { useRef, useState, type FormEvent } from 'react'
import { supabase } from '../lib/api'
import { ErrorNote, Icon } from '../ui'
import { Brand } from './Brand'

type Step = { kind: 'email' } | { kind: 'code'; email: string }

/** Two short steps: the invited email, then the code sent to it. */
export function SignIn() {
  const [step, setStep] = useState<Step>({ kind: 'email' })
  const [busy, setBusy] = useState<'' | 'sending' | 'verifying' | 'resending'>('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const lastEmail = useRef('')
  const redirectError = new URLSearchParams(window.location.hash.slice(1)).has('error')
    || new URLSearchParams(window.location.search).has('error')

  async function send(email: string, resend = false) {
    if (!supabase || busy) return
    setBusy(resend ? 'resending' : 'sending')
    setError('')
    setNotice('')
    try {
      const { error: failure } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } })
      if (failure) throw failure
      lastEmail.current = email
      setStep({ kind: 'code', email })
      if (resend) setNotice('A new code is on its way.')
    } catch {
      setError('We couldn’t send a code. Check that this email was invited, then try again.')
    } finally {
      setBusy('')
    }
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || step.kind !== 'code' || busy) return
    const token = String(new FormData(event.currentTarget).get('code')).replace(/\s/g, '')
    setBusy('verifying')
    setError('')
    setNotice('')
    try {
      const { error: failure } = await supabase.auth.verifyOtp({ email: step.email, token, type: 'email' })
      if (failure) throw failure
      // The app switches to "Opening workspace…" as soon as Supabase reports the new session.
    } catch {
      setError('That code didn’t work. Use the latest email we sent, or request a new code.')
      setBusy('')
    }
  }

  return <section className="auth-card" aria-labelledby="sign-in-title">
    <Brand size="lg" />
    {step.kind === 'email' ? <>
      <div>
        <h1 id="sign-in-title">Sign in</h1>
        <p>We’ll email a one-time code to your invited address.</p>
      </div>
      {redirectError && <div className="notice" role="status"><Icon name="alert" /><span>That sign-in link has expired. Request a new code.</span></div>}
      {error && <ErrorNote message={error} />}
      <form onSubmit={event => { event.preventDefault(); void send(String(new FormData(event.currentTarget).get('email')).trim()) }}>
        <label>Work email
          <input name="email" type="email" autoComplete="email" autoFocus required defaultValue={lastEmail.current} placeholder="name@company.com" /></label>
        <button className="lg block-btn" disabled={!!busy}>
          {busy ? <span className="btn-spinner" aria-hidden="true" /> : null}{busy ? 'Sending code…' : 'Send code'}</button>
      </form>
      <p className="fine">Access is by invitation. Ask your admin if you haven’t been invited.</p>
    </> : <>
      <div>
        <h1 id="sign-in-title">Enter your code</h1>
        <p>Sent to <strong>{step.email}</strong></p>
      </div>
      {error && <ErrorNote message={error} />}
      {notice && <p className="notice" role="status">{notice}</p>}
      <form onSubmit={verify}>
        <label>Verification code
          <input name="code" className="code-input" inputMode="numeric" autoComplete="one-time-code" autoFocus
            pattern="[0-9 ]{6,12}" maxLength={12} required placeholder="000000" /></label>
        <button className="lg block-btn" disabled={!!busy}>
          {busy === 'verifying' ? <span className="btn-spinner" aria-hidden="true" /> : null}{busy === 'verifying' ? 'Verifying…' : 'Verify and continue'}</button>
      </form>
      <div className="auth-links">
        <button type="button" className="ghost sm" disabled={!!busy} onClick={() => { setStep({ kind: 'email' }); setError(''); setNotice('') }}>
          <Icon name="back" size={15} />Change email</button>
        <button type="button" className="ghost sm" disabled={!!busy} onClick={() => void send(step.email, true)}>
          {busy === 'resending' ? 'Sending…' : 'Resend code'}</button>
      </div>
    </>}
  </section>
}
