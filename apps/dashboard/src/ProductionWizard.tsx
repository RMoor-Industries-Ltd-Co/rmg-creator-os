import { useEffect, useState } from 'react';
import { productions, type Production } from './api';
import { navigate } from './router';
import { VoiceDirection } from './VoiceDirection';
import { Assets } from './Assets';
import { HiggsfieldPanel } from './HiggsfieldPanel';
import { ARoll } from './ARoll';
import { StockBroll } from './StockBroll';
import { FinalCut } from './FinalCut';
import { Post } from './Post';

// One visible progression from topic to publish. The four "build" steps
// (scenes → a-roll → b-roll → final cut) were previously hidden inside a
// single "Generate" page; the backend still tracks them under one coarse
// `generate` stage (see ProductionList.resumeStep).
export const STEPS = [
  { key: 'script', label: 'Script' },
  { key: 'voice', label: 'Voice' },
  { key: 'assets', label: 'Assets' },
  { key: 'scenes', label: 'Scenes' },
  { key: 'aroll', label: 'A-roll' },
  { key: 'broll', label: 'B-roll' },
  { key: 'finalcut', label: 'Final cut' },
  { key: 'post', label: 'Publish' }
] as const;

export function ProductionWizard({ id, step }: { id: string; step: string }) {
  const [p, setP] = useState<Production | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [version, setVersion] = useState(0);
  const [scriptDraft, setScriptDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [enhancing, setEnhancing] = useState(false);

  useEffect(() => {
    productions.get(id).then((prod) => { setP(prod); setScriptDraft(null); }).catch((e: unknown) => setError(String(e)));
  }, [id]);

  const idx = Math.max(0, STEPS.findIndex((s) => s.key === step));
  const go = (i: number) => {
    if (i >= 0 && i < STEPS.length) navigate(`/produce/${id}/${STEPS[i].key}`);
  };

  async function saveScript() {
    if (!p || scriptDraft === null) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await productions.saveScript(p.id, scriptDraft);
      setP(updated);
      setScriptDraft(null);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function enhance() {
    if (!p) return;
    setEnhancing(true);
    setError(null);
    try {
      const updated = await productions.direct(p.id, { voiceBrand: p.brand });
      setP(updated);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setEnhancing(false);
    }
  }

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
        <section className="panel" key={version}>
          {step === 'script' ? (
            <>
              <div className="video-head">
                <strong>{p.title}</strong>
                <span className="badge">
                  {p.brand}
                  {p.persona ? ` · ${p.persona}` : ''} · {p.scriptStatus}
                </span>
              </div>
              <textarea
                className="script-view"
                rows={14}
                value={scriptDraft ?? p.scriptText ?? ''}
                onChange={(e) => setScriptDraft(e.target.value)}
              />
              {scriptDraft !== null && (
                <div className="intake-actions">
                  <button className="btn" onClick={() => void saveScript()} disabled={saving}>
                    {saving ? 'Saving…' : '✓ Save edits'}
                  </button>
                  <button className="attach" onClick={() => setScriptDraft(null)} disabled={saving}>
                    Discard
                  </button>
                </div>
              )}
              <div className="intake-actions">
                <button className="btn" onClick={hear} disabled={speaking || enhancing}>
                  {speaking ? 'Synthesizing…' : '▶ Hear it'}
                </button>
                <button className="btn ghost" onClick={() => void enhance()} disabled={enhancing || speaking}>
                  {enhancing ? 'Enhancing…' : '✨ Enhance for voice'}
                </button>
                {p.scriptDocUrl && (
                  <a className="drive-link" href={p.scriptDocUrl} target="_blank" rel="noreferrer">
                    Open Drive draft ↗
                  </a>
                )}
                <span className="muted">model: {p.model}</span>
              </div>
              {audioUrl && <audio controls src={audioUrl} style={{ width: '100%', marginTop: 10 }} />}
              {p.taggedScript && (
                <>
                  <label className="vd-label" style={{ marginTop: 16 }}>
                    ✨ Enhanced for ElevenLabs v3 — emotion tags applied
                  </label>
                  <textarea className="script-view tagged" rows={10} readOnly value={p.taggedScript} />
                  <div className="intake-actions">
                    <button className="btn" onClick={() => go(idx + 1)}>
                      Next → Voice direction
                    </button>
                    <span className="muted">Fine-tune stability &amp; intensity in the next step.</span>
                  </div>
                </>
              )}
            </>
          ) : step === 'voice' ? (
            <VoiceDirection p={p} onUpdate={setP} onLocked={() => go(idx + 1)} />
          ) : step === 'assets' ? (
            <Assets p={p} />
          ) : step === 'scenes' ? (
            <div className="stage-card">
              <HiggsfieldPanel p={p} />
            </div>
          ) : step === 'aroll' ? (
            <ARoll p={p} />
          ) : step === 'broll' ? (
            <StockBroll p={p} />
          ) : step === 'finalcut' ? (
            <FinalCut p={p} />
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
        <button className="attach" onClick={() => setVersion((v) => v + 1)} title="Restart this step with a fresh panel">
          ↺ New version
        </button>
        {idx < STEPS.length - 1 && (
          <button className="btn" onClick={() => go(idx + 1)}>
            Next →
          </button>
        )}
      </div>
    </div>
  );
}
