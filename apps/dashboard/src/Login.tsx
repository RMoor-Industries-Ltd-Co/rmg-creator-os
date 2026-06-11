import { useEffect, useRef } from 'react';

const API = import.meta.env.VITE_API_BASE_URL ?? '/api';

// Minimal Google Identity Services sign-in (single authorized user).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare global {
  interface Window {
    google?: any;
  }
}

export function Login({ clientId }: { clientId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const errRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const SCRIPT_ID = 'gis-client';
    function init() {
      if (!window.google?.accounts?.id || !ref.current) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: async (resp: { credential: string }) => {
          const r = await fetch(`${API}/auth/google`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ credential: resp.credential })
          });
          if (r.ok) window.location.reload();
          else if (errRef.current) errRef.current.textContent = 'That account is not authorized.';
        }
      });
      window.google.accounts.id.renderButton(ref.current, {
        theme: 'filled_blue',
        size: 'large',
        text: 'continue_with',
        shape: 'pill'
      });
    }
    if (document.getElementById(SCRIPT_ID)) {
      init();
      return;
    }
    const s = document.createElement('script');
    s.id = SCRIPT_ID;
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = init;
    document.body.appendChild(s);
  }, [clientId]);

  return (
    <main className="wrap login-gate">
      <img src="/logo-full.png" alt="Master Atelier" className="login-logo" />
      <div className="login-card">
        <div ref={ref} />
        <p ref={errRef} className="err" />
        <p className="muted">Authorized accounts only · proprietary in-house ecosystem</p>
        <p className="muted" style={{ fontSize: 12 }}>
          <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a>
        </p>
      </div>
    </main>
  );
}
