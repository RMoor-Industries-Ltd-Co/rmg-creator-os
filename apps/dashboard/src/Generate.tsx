import { useEffect, useRef, useState } from 'react';
import { api, productions, type GenerateConfig, type HeyGenAvatar, type Production, type VideoRow } from './api';

const PROCESSING = new Set(['processing', 'pending', 'waiting', 'unknown']);
const STYLES = [
  { key: 'normal', label: 'Normal' },
  { key: 'closeUp', label: 'Close-up' },
  { key: 'circle', label: 'Circle' }
] as const;
const STABILITIES = [
  { key: '', label: 'From Voice step' },
  { key: 'creative', label: 'Creative' },
  { key: 'natural', label: 'Natural' },
  { key: 'robust', label: 'Robust' }
] as const;
const BG_PRESETS = ['', '#000000', '#ffffff', '#0b0d10', '#1a2230', '#f5f0e6'];

/**
 * Generate step — renders ALLEN's emotion-directed voice, lip-syncs a HeyGen
 * avatar to it, then returns each take to you to APPROVE or REGENERATE. Tweak the
 * settings below before each render; nothing locks until you approve.
 */
export function Generate({ p }: { p: Production }) {
  const [avatars, setAvatars] = useState<HeyGenAvatar[] | null>(null);
  const [avatarId, setAvatarId] = useState('');
  const [avatarStyle, setAvatarStyle] = useState('normal');
  const [portrait, setPortrait] = useState(true);
  const [bg, setBg] = useState('');
  const [stabilityMode, setStabilityMode] = useState('');
  const [videos, setVideos] = useState<VideoRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const polls = useRef<Record<string, number>>({});

  useEffect(() => {
    api
      .avatars()
      .then((a) => {
        setAvatars(a);
        setAvatarId((cur) => cur || a[0]?.avatar_id || '');
      })
      .catch((e: unknown) => setError(String(e)));
    productions
      .videos(p.id)
      .then((vs) => {
        setVideos(vs);
        vs.filter((v) => PROCESSING.has(v.status)).forEach((v) => watch(v.id));
      })
      .catch(() => undefined);
    const map = polls.current;
    return () => Object.values(map).forEach((t) => window.clearInterval(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.id]);

  function watch(id: string) {
    if (polls.current[id]) return;
    polls.current[id] = window.setInterval(async () => {
      try {
        const v = await api.getVideo(id);
        setVideos((rows) => rows.map((r) => (r.id === id ? { ...v } : r)));
        if (!PROCESSING.has(v.status)) {
          window.clearInterval(polls.current[id]);
          delete polls.current[id];
        }
      } catch {
        /* keep polling */
      }
    }, 5000);
  }

  function currentConfig(): GenerateConfig {
    return {
      avatarId,
      avatarStyle,
      dimension: portrait ? { width: 720, height: 1280 } : { width: 1280, height: 720 },
      stabilityMode: stabilityMode || undefined,
      background: bg ? { type: 'color', value: bg } : undefined
    };
  }

  async function generate() {
    if (!avatarId) return;
    setBusy('generate');
    setError(null);
    try {
      const v = await productions.generate(p.id, currentConfig());
      setVideos((rows) => [v, ...rows]);
      watch(v.id);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function approve(id: string) {
    setBusy(id);
    setError(null);
    try {
      const v = await productions.approveVideo(id);
      setVideos((rows) => rows.map((r) => (r.id === id ? v : { ...r, approved: false })));
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function discard(id: string) {
    setBusy(id);
    setError(null);
    try {
      await productions.discardVideo(id);
      setVideos((rows) => rows.filter((r) => r.id !== id));
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  const directed = Boolean(p.taggedScript);
  const approved = videos.find((v) => v.approved && v.status === 'completed');

  return (
    <div className="generate">
      <div className="video-head">
        <strong>Generate</strong>
        <span className="badge">{directed ? 'voice: emotion-directed' : 'voice: brand default'}</span>
        {approved && <span className="badge live">approved ✓</span>}
      </div>
      <p className="muted">
        Tweak the settings, render a take, then <strong>approve</strong> it or{' '}
        <strong>regenerate</strong>. Nothing locks until you approve.
      </p>

      {/* ---- tweakable config ---- */}
      <label className="vd-label">Avatar</label>
      {!avatars && !error && <p className="muted">Loading avatars…</p>}
      {avatars && avatars.length > 0 && (
        <div className="avatar-grid">
          {avatars.slice(0, 24).map((a) => (
            <button
              key={a.avatar_id}
              type="button"
              className={`avatar-card ${a.avatar_id === avatarId ? 'on' : ''}`}
              onClick={() => setAvatarId(a.avatar_id)}
              title={a.avatar_name || a.avatar_id}
            >
              {a.preview_image_url ? (
                <img src={a.preview_image_url} alt={a.avatar_name || ''} loading="lazy" />
              ) : (
                <div className="avatar-ph">🧑</div>
              )}
              <span>{a.avatar_name || a.avatar_id}</span>
            </button>
          ))}
        </div>
      )}

      <label className="vd-label">Framing</label>
      <div className="vd-segment">
        {STYLES.map((s) => (
          <button key={s.key} type="button" className={avatarStyle === s.key ? 'on' : ''} onClick={() => setAvatarStyle(s.key)}>
            {s.label}
          </button>
        ))}
      </div>

      <label className="vd-label">Orientation</label>
      <div className="vd-segment" style={{ maxWidth: 280 }}>
        <button type="button" className={portrait ? 'on' : ''} onClick={() => setPortrait(true)}>
          Portrait 9:16
        </button>
        <button type="button" className={!portrait ? 'on' : ''} onClick={() => setPortrait(false)}>
          Landscape 16:9
        </button>
      </div>

      <label className="vd-label">Background</label>
      <div className="bg-row">
        {BG_PRESETS.map((c) => (
          <button
            key={c || 'none'}
            type="button"
            className={`bg-swatch ${bg === c ? 'on' : ''} ${c ? '' : 'none'}`}
            style={c ? { background: c } : undefined}
            onClick={() => setBg(c)}
            title={c || 'Avatar default'}
          >
            {c ? '' : '∅'}
          </button>
        ))}
        <input type="color" value={bg || '#000000'} onChange={(e) => setBg(e.target.value)} title="Custom color" />
      </div>

      <label className="vd-label">Voice stability (overrides the Voice step for this render)</label>
      <div className="vd-segment">
        {STABILITIES.map((s) => (
          <button key={s.key || 'inherit'} type="button" className={stabilityMode === s.key ? 'on' : ''} onClick={() => setStabilityMode(s.key)}>
            {s.label}
          </button>
        ))}
      </div>

      <div className="gen-row">
        <button className="btn" onClick={generate} disabled={busy === 'generate' || !avatarId}>
          {busy === 'generate' ? 'Sending…' : '🎬 Render a take'}
        </button>
        <span className="muted">Spends ElevenLabs + HeyGen credits · ~2 min</span>
      </div>

      {error && <p className="err">{error}</p>}

      {/* ---- takes: approve / regenerate / discard ---- */}
      {videos.length > 0 && (
        <>
          <label className="vd-label">Takes</label>
          <div className="gen-videos">
            {videos.map((v) => {
              const done = v.status === 'completed';
              return (
                <div key={v.id} className={`gen-video ${v.approved ? 'approved' : ''}`}>
                  {v.videoUrl ? (
                    <video src={v.videoUrl} controls poster={v.thumbnailUrl ?? undefined} />
                  ) : (
                    <div className={`video-ph ${v.status === 'failed' ? 'err' : ''}`}>
                      {v.status === 'failed' ? 'Render failed' : (
                        <>
                          <span className="spinner" /> {v.status}…
                        </>
                      )}
                    </div>
                  )}
                  <div className="gen-video-meta">
                    <span className={`badge ${v.approved ? 'live' : ''}`}>
                      {v.approved ? 'approved ✓' : v.status}
                    </span>
                    {v.driveLink && (
                      <a className="drive-link" href={v.driveLink} target="_blank" rel="noreferrer">
                        Drive ↗
                      </a>
                    )}
                  </div>
                  <div className="take-actions">
                    {done && !v.approved && (
                      <button className="btn ghost sm" onClick={() => approve(v.id)} disabled={busy === v.id}>
                        ✓ Approve
                      </button>
                    )}
                    {done && (
                      <button className="attach sm" onClick={generate} disabled={busy === 'generate'} title="Render another take with the current settings">
                        ↻ Regenerate
                      </button>
                    )}
                    {!v.approved && (
                      <button className="attach sm danger" onClick={() => discard(v.id)} disabled={busy === v.id}>
                        ✕ Discard
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ---- Higgsfield b-roll (pending render-node connection) ---- */}
      <div className="higgs-card">
        <div className="video-head">
          <strong>B-roll imagery — Higgsfield</strong>
          <span className="badge">not connected</span>
        </div>
        <p className="muted">
          Turn your uploaded Assets into motion b-roll. The same approve / regenerate loop applies.
          Planned tweaks: <em>source image · Soul / motion preset · duration · aspect · motion strength</em>.
          Needs the render node + Higgsfield credentials wired before it can run.
        </p>
      </div>
    </div>
  );
}
