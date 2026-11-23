import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
const { VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, VITE_API_BASE_URL } = import.meta.env;
export const supabase = VITE_SUPABASE_URL && VITE_SUPABASE_PUBLISHABLE_KEY
    ? createClient(VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY)
    : null;
/** An API error that keeps the HTTP status, so callers can tell an expired session from other failures. */
export class ApiError extends Error {
    status;
    constructor(message, status) {
        super(message);
        this.status = status;
    }
}
/** The freshest access token. getSession() refreshes an expired token, e.g. after a laptop slept,
 * so requests never go out with the stale token held in React state. */
async function currentToken(session) {
    const fresh = supabase ? (await supabase.auth.getSession()).data.session : null;
    return fresh?.user.id === session.user.id ? fresh.access_token : session.access_token;
}
export async function api(session, path, init) {
    const body = init?.body;
    // Files go up as their raw bytes; everything else is JSON.
    const type = body instanceof Blob ? (body.type || 'application/octet-stream') : body ? 'application/json' : null;
    const response = await fetch(`${VITE_API_BASE_URL}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${await currentToken(session)}`, ...(type ? { 'Content-Type': type } : {}) },
    });
    if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new ApiError(typeof body?.detail === 'string' ? body.detail : 'The request could not be completed.', response.status);
    }
    const data = await response.json();
    const usage = response.headers.get('X-AI-Usage-ID');
    return usage && data && typeof data === 'object' && !Array.isArray(data)
        ? { ...data, ai_usage_id: usage } : data;
}
/** Loads a resource and reloads it on demand. A null path skips loading. */
export function useResource(call, path) {
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [version, setVersion] = useState(0);
    const reload = useCallback(() => setVersion(n => n + 1), []);
    useEffect(() => {
        if (!path)
            return;
        const controller = new AbortController();
        setError('');
        call(path, { signal: controller.signal })
            .then(result => { if (!controller.signal.aborted)
            setData(result); })
            .catch((failure) => { if (!controller.signal.aborted)
            setError(failure.message); });
        return () => controller.abort();
    }, [call, path, version]);
    return { data, setData, error, reload };
}
