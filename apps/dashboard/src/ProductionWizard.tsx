import { useEffect, useState } from 'react';
import { productions, type Production } from './api';
import { navigate } from './router';
import { VoiceDirection } from './VoiceDirection';
import { Assets } from './Assets';
import { Generate } from './Generate';
import { Post } from './Post';

export const STEPS = [
  { key: 'script', label: 'Script' },
  { key: 'voice', label: 'Voice' },
  { key: 'assets', label: 'Assets' },
  { key: 'generate', label: 'Generate' },
  { key: 'post', label: 'Post' }
] as const;

export function ProductionWizard({ id, step }: { id: string; step: string }) {
  const [p, setP] = useState<Production | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    productions.get(id).then(setP).catch((e: unknown) => setError(String(e)));
  }, [id]);

  const idx = Math.max(0, STEPS.findIndex((s) => s.key === step));
  const go = (i: number) => {
    if (i >= 0 && i < STEPS.length) navigate(`/produce/${id}/${STEPS[i].key}`);
  };

  async function hear() {
    if (!p) return;
    setSpeaking(true);
    setError(null);
    try {
      setAudioUrl(await productions.speak(p.id));
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setSpeaking(false);
    }
  }

  return (
    <div className="wizard">
      <ol className="stepper">
        {STEPS.map((s, i) => (
          <li key={s.key} className={i === idx ? 'active' : i < idx ? 'done' : ''}>
            <button onClick={() => go(i)}>
              <span className="step-num">{i + 1}</span> {s.label}
            </button>
          </li>
        ))}
      </ol>

      {error && <p className="err">{error}</p>}
      {!p && !error && <p className="muted">Loading production…</p>}

      {p && (
        <section className="panel">
          {step === 'script' ? (
            <>
              <div className="video-head">
                <strong>{p.title}</strong>
                <span className="badge">
                  {p.brand}
                  {p.persona ? ` · ${p.persona}` : ''} · {p.scriptStatus}
                </span>
              </div>
              <textarea className="script-view" rows={14} readOnly value={p.scriptText ?? ''} />
              <div className="intake-actions">
                <button className="btn" onClick={hear} disabled={speaking}>
                  {speaking ? 'Synthesizing…' : '▶ Hear it'}
                </button>
                {p.scriptDocUrl && (
                  <a className="drive-link" href={p.scriptDocUrl} target="_blank" rel="noreferrer">
                    Open Drive draft ↗
                  </a>
                )}
                <span className="muted">model: {p.model}</span>
              </div>
              {audioUrl && <audio controls src={audioUrl} style={{ width: '100%', marginTop: 10 }} />}
            </>
          ) : step === 'voice' ? (
            <VoiceDirection p={p} onUpdate={setP} onLocked={() => go(idx + 1)} />
          ) : step === 'assets' ? (
            <Assets p={p} />
          ) : step === 'generate' ? (
            <Generate p={p} />
          ) : step === 'post' ? (
            <Post p={p} />
          ) : (
            <div className="stage-ph">
              <h2>{STEPS[idx].label}</h2>
              <p className="muted">
                This stage is coming soon (see contract 13 — Production Wizard). The route is live so
                we can build straight into it.
              </p>
            </div>
          )}
        </section>
      )}

      <div className="wizard-nav">
        <button className="attach" onClick={() => go(idx - 1)} disabled={idx === 0}>
          ← Back
        </button>
        {idx < STEPS.length - 1 ? (
          <button className="btn" onClick={() => go(idx + 1)}>
            Next →
          </button>
        ) : (
          <button className="btn" disabled>
            Post
          </button>
        )}
      </div>
    </div>
  );
}
