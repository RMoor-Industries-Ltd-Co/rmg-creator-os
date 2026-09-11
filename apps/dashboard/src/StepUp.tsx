import { useEffect, useRef, useState } from 'react';
import { setStepUpRequiredHandler } from './authClient';

const API = import.meta.env.VITE_API_BASE_URL ?? '/api';

// Deliberately fresh re-authentication for a founder approval
// (docs/atelier/phase-b-governance-primitives-design.md §7.1). Distinct from Login.tsx's ordinary
// 30-day sign-in: Google Identity Services' One Tap/button library has no way to force
// re-authentication or request the `auth_time` claim's freshness — it will happily mint a token
// from an existing browser session with zero user interaction, which is exactly what step-up must
// NOT accept. So this uses Google's OAuth 2.0 authorization endpoint directly, in a popup, with
// `prompt=login` + `max_age=900` — the shape §7.1 names.
export function StepUpPrompt({ clientId }: { clientId: string }) {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolverRef = useRef<{ resolve: () => void; reject: (e: Error) => void } | null>(null);

  // Registers the prompt with authClient's requestStepUp() — req() in api.ts awaits the promise
  // this returns, then retries the original write exactly once.
  useEffect(() => {
    setStepUpRequiredHandler(
      () =>
        new Promise<void>((resolve, reject) => {
          resolverRef.current = { resolve, reject };
          setError(null);
          setBusy(false);
          setVisible(true);
        })
    );
    return () => setStepUpRequiredHandler(null);
  }, []);

  // The popup navigates to stepup-callback.html (public/), which has no React/app state of its
  // own — it only parses the id_token out of the redirect fragment and posts it back here.
  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      if (ev.origin !== window.location.origin) return;
      const data = ev.data as { source?: string; idToken?: string | null; error?: string | null } | null;
      if (!data || data.source !== 'rmg-stepup') return;
      if (!data.idToken) {
        setError(data.error ?? 'Re-authentication was cancelled.');
        setBusy(false);
        return;
      }
      setBusy(true);
      fetch(`${API}/auth/google/step-up`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: data.idToken })
      })
        .then(async (r) => {
          if (!r.ok) {
            const body = (await r.json().catch(() => ({}))) as { error?: string };
            throw new Error(body.error ?? 'Re-authentication was rejected.');
          }
          setVisible(false);
          setBusy(false);
          resolverRef.current?.resolve();
          resolverRef.current = null;
        })
        .catch((e: Error) => {
          setBusy(false);
          setError(e.message);
        });
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  if (!visible) return null;

  function reauthenticate() {
    if (!clientId) {
      setError('Sign-in is not configured.');
      return;
    }
    setError(null);
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: `${window.location.origin}/stepup-callback.html`,
      response_type: 'id_token',
      scope: 'openid email',
      nonce: crypto.randomUUID(),
      // The two claims §7.1 requires: force a real re-authentication (prompt=login) and ask the
      // issuer to stamp auth_time recent enough to prove it (max_age=900, matching
      // STEP_UP_MAX_AGE_SECONDS's default — the gateway is the actual source of truth and
      // re-checks auth_time itself regardless of what's requested here).
      prompt: 'login',
      max_age: '900'
    });
    const popup = window.open(
      `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
      'rmg-stepup',
      'width=480,height=640'
    );
    if (!popup) setError('Enable popups for this site to re-authenticate.');
  }

  function cancel() {
    setVisible(false);
    resolverRef.current?.reject(new Error('Re-authentication was cancelled.'));
    resolverRef.current = null;
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="stepup-title">
      <div className="modal-card">
        <h2 id="stepup-title">Confirm it&rsquo;s you</h2>
        <p className="muted">This approval needs a fresh sign-in. Please re-authenticate with Google to continue.</p>
        {error && <p className="err">{error}</p>}
        <div className="modal-actions">
          <button className="btn ghost" onClick={cancel} disabled={busy}>
            Cancel
          </button>
          <button className="btn" onClick={reauthenticate} disabled={busy}>
            {busy ? 'Confirming…' : 'Re-authenticate'}
          </button>
        </div>
      </div>
    </div>
  );
}
