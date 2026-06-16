import { useEffect, useState } from 'react';
import { productions, type Production } from './api';
import { STEPS } from './ProductionWizard';
import { navigate } from './router';

function ago(iso: string): string {
  const then = new Date(iso).getTime();
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

const stepLabel = (key: string) => STEPS.find((s) => s.key === key)?.label ?? key;
// Where to drop the user back in. A locked emotion means Voice is done.
// The backend tracks the four build steps under one coarse `generate` stage,
// so resume there at the first of them (Scenes).
function resumeStep(p: Production): string {
  if (STEPS.some((s) => s.key === p.stage)) return p.stage;
  if (p.stage === 'generate') return 'scenes';
  return 'script';
}

/** Your saved productions — return to anything you've worked on. */
export function ProductionList() {
  const [rows, setRows] = useState<Production[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    productions
      .list()
      .then(setRows)
      .catch((e: unknown) => setError(String(e)));
  }, []);

  return (
    <section className="panel">
      <div className="video-head">
        <strong>Your productions</strong>
        {rows && <span className="badge">{rows.length}</span>}
      </div>
      <p className="muted">Pick up any script where you left off.</p>

      {error && <p className="err">{error}</p>}
      {!rows && !error && <p className="muted">Loading…</p>}
      {rows && rows.length === 0 && (
        <p className="muted">Nothing yet — create one above and it'll show up here.</p>
      )}

      {rows && rows.length > 0 && (
        <ul className="prod-list">
          {rows.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="prod-row"
                onClick={() => navigate(`/produce/${p.id}/${resumeStep(p)}`)}
              >
                <span className="prod-main">
                  <span className="prod-title">{p.title || p.topic}</span>
                  <span className="prod-sub muted">
                    {p.brand}
                    {p.persona ? ` · ${p.persona}` : ''} · updated {ago(p.updatedAt)}
                  </span>
                </span>
                <span className="prod-meta">
                  <span className="badge">{stepLabel(p.stage)}</span>
                  {p.emotionLocked && <span className="badge live">voice ✓</span>}
                  <span className="prod-go">Resume →</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
