import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { ApiError, api, supabase, type Membership } from '../lib/api'
import { ErrorNote, Icon } from '../ui'
import { Brand } from './Brand'
import { SignIn } from './SignIn'
import { Workspace, type Me } from './Workspace'

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** Loads memberships for a session. A freshly issued session can be rejected for a moment while it settles,
 * so 401s are retried briefly before the user sees an error. */
async function loadMemberships(session: Session, signal: AbortSignal) {
  for (const delay of [0, 800, 1600, 3000]) {
    if (delay) await wait(delay)
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    try {
      return await api<{ memberships: Membership[]; full_name: string | null }>(session, '/api/me', { signal })
    } catch (failure) {
      if (!(failure instanceof ApiError) || failure.status !== 401 || delay === 3000) throw failure
    }
  }
  return { memberships: [], full_name: null }
}

export function App() {
  const [session, setSession] = useState<Session | null | undefined>()
  const [memberships, setMemberships] = useState<Membership[] | null>(null)
  const [me, setMe] = useState<Me | null>(null)
  const [error, setError] = useState<{ message: string; session: boolean } | null>(null)
  const [retry, setRetry] = useState(0)
  const call = useCallback(<T,>(path: string, init?: RequestInit) => api<T>(session!, path, init), [session])

  useEffect(() => {
    if (!supabase) return
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, next) => {
      // Token refreshes keep the same user; only reset the workspace when the user changes.
      // Keep the same object for the same user: the API reads the fresh token itself, so a token refresh
      // does not reload every screen. A different user (or sign-out) clears the previous workspace.
      setSession(current => {
        if (current && next && current.user.id === next.user.id) return current
        if (current?.user.id !== next?.user.id) { setMemberships(null); setError(null) }
        return next
      })
    })
    return () => subscription.unsubscribe()
  }, [])

  const userId = session?.user.id
  useEffect(() => {
    if (!session) return
    const controller = new AbortController()
    setError(null)
    loadMemberships(session, controller.signal)
      .then(result => { setMemberships(result.memberships); setMe({ full_name: result.full_name, email: session.user.email ?? '' }) })
      .catch((failure: Error) => {
        if (controller.signal.aborted) return
        setError({ message: failure.message, session: failure instanceof ApiError && failure.status === 401 })
      })
    return () => controller.abort()
    // Re-run for a different user or an explicit retry, not for every token refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, retry])

  if (session && memberships?.length && me) return <Workspace session={session} call={call} memberships={memberships} me={me} />

  return <main className="entry">
    {!supabase ? <section className="auth-card state">
      <Brand />
      <h1>Sign-in is not configured</h1>
      <p>Add the Supabase URL and publishable key to the frontend environment.</p>
    </section>
      : session === undefined ? <section className="auth-card state" role="status"><Brand /><span className="spinner" /><p>Checking your session…</p></section>
      : !session ? <SignIn />
      : <section className="auth-card state">
        <Brand />
        {memberships?.length === 0 ? <>
          <h1>Almost there</h1>
          <p>You’re signed in as <strong>{session.user.email}</strong>. Ask your organization admin to activate your membership.</p>
          <div className="actions">
            <button className="secondary" onClick={() => setRetry(n => n + 1)}><Icon name="refresh" size={16} />Check again</button>
            <button className="ghost" onClick={() => void supabase?.auth.signOut()}>Use another email</button>
          </div>
        </> : error ? <>
          <h1>{error.session ? 'We couldn’t confirm your sign-in' : 'The workspace didn’t load'}</h1>
          <ErrorNote message={error.session ? 'Your session was not accepted. Sign in again to get a new code.' : error.message} />
          <div className="actions">
            {error.session
              ? <button onClick={() => void supabase?.auth.signOut()}><Icon name="back" size={16} />Back to sign in</button>
              : <button onClick={() => setRetry(n => n + 1)}><Icon name="refresh" size={16} />Try again</button>}
          </div>
        </> : <div role="status" className="opening"><span className="spinner" /><p>Opening workspace…</p></div>}
      </section>}
  </main>
}
