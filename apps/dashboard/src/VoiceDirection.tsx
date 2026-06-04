import { useEffect, useState } from 'react';
import { productions, type EmotionProfile, type Production } from './api';

const STABILITY_MODES = [
  { key: 'creative', label: 'Creative', hint: 'Most expressive · 0.0' },
  { key: 'natural', label: 'Natural', hint: 'Balanced · 0.5' },
  { key: 'robust', label: 'Robust', hint: 'Most consistent · 1.0' }
] as const;

const INTENSITIES = [
  { key: '', label: 'Default' },
  { key: 'soft', label: 'Soft' },
  { key: 'strong', label: 'Strong' }
] as const;

/**
 * Voice Direction (Emotion Director) — the wizard step after script approval.
 * Pick the brand's inflection & energy, tweak stability/intensity, listen to a
 * v3 render, then lock the brand tone in.
 */
export function VoiceDirection({
  p,
  onUpdate,
  onLocked
}: {
  p: Production;
  onUpdate: (p: Production) => void;
  onLocked: () => void;
}) {
  const [profiles, setProfiles] = useState<EmotionProfile[]>([]);
  const [voiceBrand, setVoiceBrand] = useState(p.voiceBrand ?? p.brand);
  const [intensity, setIntensity] = useState(p.intensity ?? '');
  const [stabilityMode, setStabilityMode] = useState(p.stabilityMode ?? '');
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<'' | 'direct' | 'render' | 'lock'>('');
  const [error, setError] = useState<string | null>(null);
  const [showRules, setShowRules] = useState(true);

  useEffect(() => {
    productions
      .emotionProfiles()
      .then((r) => setProfiles(r.profiles))
      .catch((e: unknown) => setError(String(e)));
  }, []);

  const selected = profiles.find((pr) => pr.brand === voiceBrand);
  const speaker = p.persona || 'ALLEN (default voice)';
  const hasDirection = Boolean(p.taggedScript);
  const effMode = stabilityMode || p.stabilityMode || selected?.stability_mode || 'natural';

  async function applyDirection() {
    setBusy('direct');
    setError(null);
    try {
      const updated = await productions.direct(p.id, {
        voiceBrand,
        intensity: intensity || undefined,
        stabilityMode: stabilityMode || undefined
      });
      onUpdate(updated);
      setStabilityMode(updated.stabilityMode ?? '');
      setAudioUrl(null);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setBusy('');
    }
  }

  async function preview() {
    setBusy('render');
    setError(null);
    try {
      setAudioUrl(await productions.speak(p.id, { directed: true, stabilityMode: effMode }));
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setBusy('');
    }
  }

  async function lockIn() {
    setBusy('lock');
    setError(null);
    try {
      const updated = await productions.direct(p.id, {
        voiceBrand,
        intensity: intensity || undefined,
        stabilityMode: effMode,
        lock: true
      });
      onUpdate(updated);
      onLocked();
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="voice">
      <div className="video-head">
        <strong>Voice Direction</strong>
        <span className="badge">
          🎙 {speaker}
          {p.emotionLocked ? ' · locked' : ''}
        </span>
      </div>

      {/* The approved script stays visible. */}
      <label className="vd-label">Approved script</label>
      <textarea className="script-view" rows={7} readOnly value={p.scriptText ?? ''} />

      {/* Brand inflection & energy — checkmarks. */}
      <label className="vd-label">Inflection &amp; energy — which brand?</label>
      <ul className="checks vd-brands">
        {profiles.map((pr) => {
          const on = pr.brand === voiceBrand;
          return (
            <li key={pr.brand}>
              <button
                type="button"
                className={`vd-check ${on ? 'on' : ''}`}
                onClick={() => {
                  setVoiceBrand(pr.brand);
                  setStabilityMode('');
                  setAudioUrl(null);
                }}
              >
                <span className="vd-box">{on ? '✓' : ''}</span>
                <span>{pr.label}</span>
                {pr.brand === p.brand && <span className="badge">content brand</span>}
              </button>
            </li>
          );
        })}
      </ul>

      {/* Tag rules for the selected brand. */}
      {selected && (
        <div className="vd-rules">
          <button type="button" className="vd-rules-toggle" onClick={() => setShowRules((s) => !s)}>
            {showRules ? '▾' : '▸'} Tag rules — {selected.label}
          </button>
          {showRules && (
            <dl>
              <dt>Audio tags</dt>
              <dd>{selected.tags}</dd>
              <dt>Emphasis</dt>
              <dd>{selected.emphasis}</dd>
              <dt>Pacing</dt>
              <dd>{selected.pacing}</dd>
              <dt>Recommended stability</dt>
              <dd>
                {selected.stability_mode} ({selected.stability})
              </dd>
            </dl>
          )}
        </div>
      )}

      {/* Intensity. */}
      <label className="vd-label">Intensity</label>
      <div className="vd-segment">
        {INTENSITIES.map((it) => (
          <button
            key={it.key || 'default'}
            type="button"
            className={intensity === it.key ? 'on' : ''}
            onClick={() => setIntensity(it.key)}
          >
            {it.label}
          </button>
        ))}
      </div>

      <div className="intake-actions">
        <button className="btn" onClick={applyDirection} disabled={busy !== ''}>
          {busy === 'direct' ? 'Directing…' : hasDirection ? 'Re-apply direction' : 'Apply direction'}
        </button>
        <span className="muted">Annotates the script with v3 audio tags — words unchanged.</span>
      </div>

      {/* Tagged result + stability + render — appears once directed. */}
      {hasDirection && (
        <>
          <label className="vd-label">Directed script (v3 audio tags)</label>
          <textarea className="script-view tagged" rows={7} readOnly value={p.taggedScript ?? ''} />

          <label className="vd-label">Stability — voice consistency vs. expression</label>
          <div className="vd-segment three">
            {STABILITY_MODES.map((m) => (
              <button
                key={m.key}
                type="button"
                className={effMode === m.key ? 'on' : ''}
                onClick={() => {
                  setStabilityMode(m.key);
                  setAudioUrl(null);
                }}
              >
                <strong>{m.label}</strong>
                <small>{m.hint}</small>
              </button>
            ))}
          </div>

          <div className="intake-actions">
            <button className="btn ghost" onClick={preview} disabled={busy !== ''}>
              {busy === 'render' ? 'Synthesizing…' : '▶ Preview render'}
            </button>
            <button className="btn" onClick={lockIn} disabled={busy !== ''}>
              {busy === 'lock' ? 'Locking…' : '✓ Generate & lock'}
            </button>
          </div>
          {audioUrl && <audio controls src={audioUrl} style={{ width: '100%', marginTop: 10 }} />}
        </>
      )}

      {error && <p className="err">{error}</p>}
    </div>
  );
}
