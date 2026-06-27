import { useEffect, useState } from 'react';
import type { HealthResponse } from '@rmg-creator-os/types';
import { Produce } from './Produce';
import { MorningBrief } from './MorningBrief';
import { ProductionWizard } from './ProductionWizard';
import { navigate, usePath } from './router';
import { Studio } from './Studio';
import { Login } from './Login';
import { useLoadingBar } from './loading';
import { QueueWidget } from './QueueWidget';

const API = import.meta.env.VITE_API_BASE_URL ?? '/api';

function Dot({ ok }: { ok: boolean }) {
  return <span className={`dot ${ok ? 'ok' : 'fail'}`} aria-hidden />;
}

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [auth, setAuth] = useState<'loading' | 'ok' | 'login'>('loading');
  const [clientId, setClientId] = useState('');
  const path = usePath();
  const loading = useLoadingBar();

  // Gate the app behind Google sign-in when the gateway has auth enabled.
  useEffect(() => {
    fetch(`${API}/auth/config`)
      .then((r) => r.json() as Promise<{ enabled: boolean; clientId: string }>)
      .then((cfg) => {
        if (!cfg.enabled) return setAuth('ok');
        setClientId(cfg.clientId);
        return fetch(`${API}/auth/me`).then((r) => setAuth(r.ok ? 'ok' : 'login'));
      })
      .catch(() => setAuth('ok')); // never lock the UI if the gateway is unreachable
  }, []);
  const wizard = path.match(/^\/produce\/([^/]+)\/([^/]+)/);
  const isProduce = path === '/produce';
  const isStudio = path === '/studio';
  const isOverview = !wizard && !isProduce && !isStudio;

  useEffect(() => {
    fetch(`${API}/health`)
      .then((r) => r.json() as Promise<HealthResponse>)
      .then(setHealth)
      .catch((e: unknown) => setError(String(e)));
  }, []);

  if (auth === 'loading') return <main className="wrap"><p className="muted">Loading…</p></main>;
  if (auth === 'login') return <Login clientId={clientId} />;

  return (
    <main className="wrap">
      <header className="brand-header">
        <img src="/mark.svg" alt="Master Atelier" className="brand-mark" />
        <div>
          <h1>Master Atelier</h1>
          <p className="tagline">Content production &amp; publishing, crafted.</p>
        </div>
      </header>

      <nav className="tabs">
        <button className={isOverview ? 'active' : ''} onClick={() => navigate('/')}>
          Overview
        </button>
        <button className={path.startsWith('/produce') ? 'active' : ''} onClick={() => navigate('/produce')}>
          Production
        </button>
        <button className={isStudio ? 'active' : ''} onClick={() => navigate('/studio')}>
          Studio
        </button>
      </nav>
      <div className={`loading-bar ${loading ? 'active' : ''}`} />

      {wizard && <ProductionWizard id={wizard[1]} step={wizard[2]} />}
      {isProduce && <Produce />}
      {isStudio && <Studio />}

      {isOverview && (
      <>
      <MorningBrief />
      <section className="panel">
        <h2>Control plane</h2>
        {error && <p className="err">Gateway unreachable: {error}</p>}
        {!error && !health && <p className="muted">Checking gateway…</p>}
        {health && (
          <ul className="checks">
            <li>
              <Dot ok={health.status === 'ok'} /> gateway: <strong>{health.status}</strong>
            </li>
            {Object.entries(health.checks).map(([k, v]) => (
              <li key={k}>
                <Dot ok={v === 'ok'} /> {k}: <strong>{v}</strong>
              </li>
            ))}
          </ul>
        )}
      </section>

</>
      )}

      <QueueWidget />

      <footer className="muted">
        <a href="/extra">Extra / Personal</a> ·{' '}
        <a href="/terms">Terms of Service</a> · <a href="/privacy">Privacy Policy</a> ·{' '}
        proprietary in-house ecosystem
        {clientId && (
          <>
            {' '}·{' '}
            <a
              href="#"
              onClick={async (e) => {
                e.preventDefault();
                await fetch(`${API}/auth/logout`, { method: 'POST' });
                window.location.reload();
              }}
            >
              Sign out
            </a>
          </>
        )}
      </footer>
    </main>
  );
}
