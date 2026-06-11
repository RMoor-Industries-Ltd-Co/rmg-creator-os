import { useEffect, useState } from 'react';
import type { HealthResponse } from '@rmg-creator-os/types';
import { Produce } from './Produce';
import { AskAllen } from './AskAllen';
import { ProductionWizard } from './ProductionWizard';
import { navigate, usePath } from './router';
import { Studio } from './Studio';
import { Login } from './Login';

const API = import.meta.env.VITE_API_BASE_URL ?? '/api';

const SERVICES = [
  { id: 'story-director', name: 'Story Director', desc: 'Raw recording → branded, captioned video', status: 'In build' },
  { id: 'social-manager', name: 'Social Manager', desc: 'Scheduling & publishing across platforms', status: 'Planned' },
  { id: 'allen', name: 'A.L.L.E.N', desc: 'Speech-enabled company LLM interface', status: 'Planned' },
  { id: 'allie', name: 'A.L.L.I.E', desc: 'Investigator agent — RSS, research, library', status: 'Planned' },
  { id: 'my-poster', name: 'My Poster', desc: 'Image enhancement & Shopify product content', status: 'Planned' }
] as const;

function Dot({ ok }: { ok: boolean }) {
  return <span className={`dot ${ok ? 'ok' : 'fail'}`} aria-hidden />;
}

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [auth, setAuth] = useState<'loading' | 'ok' | 'login'>('loading');
  const [clientId, setClientId] = useState('');
  const path = usePath();

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
  const isAllen = path === '/allen';
  const isOverview = !wizard && !isProduce && !isStudio && !isAllen;

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
        <img src="/mark.png" alt="Master Atelier" className="brand-mark" />
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
          Produce
        </button>
        <button className={isStudio ? 'active' : ''} onClick={() => navigate('/studio')}>
          Studio
        </button>
        <button className={isAllen ? 'active' : ''} onClick={() => navigate('/allen')}>
          Ask ALLEN
        </button>
      </nav>

      {wizard && <ProductionWizard id={wizard[1]} step={wizard[2]} />}
      {isProduce && <Produce />}
      {isStudio && <Studio />}
      {isAllen && <AskAllen />}

      {isOverview && (
      <>
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

      <section className="panel">
        <h2>Suite</h2>
        <div className="grid">
          {SERVICES.map((s) => (
            <article key={s.id} className="card">
              <div className="card-head">
                <h3>{s.name}</h3>
                <span className={`badge ${s.status === 'In build' ? 'live' : ''}`}>{s.status}</span>
              </div>
              <p>{s.desc}</p>
            </article>
          ))}
        </div>
      </section>
      </>
      )}

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
