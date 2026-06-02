import { useEffect, useState } from 'react';
import type { HealthResponse } from '@rmg-creator-os/types';

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

  useEffect(() => {
    fetch(`${API}/health`)
      .then((r) => r.json() as Promise<HealthResponse>)
      .then(setHealth)
      .catch((e: unknown) => setError(String(e)));
  }, []);

  return (
    <main className="wrap">
      <header>
        <h1>RMG Creator OS</h1>
        <p className="tagline">Minimal input → maximum social-ready output.</p>
      </header>

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

      <footer className="muted">
        <a href="/extra">Extra / Personal</a> · proprietary in-house ecosystem
      </footer>
    </main>
  );
}
