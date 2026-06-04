import { useEffect, useRef, useState } from 'react';
import { api, assets, productions, type Asset, type Production, type VideoRow } from './api';

const PROCESSING = new Set(['processing', 'pending', 'waiting', 'unknown']);

/**
 * Custom video — YOUR images + YOUR voice (ElevenLabs brand voice or an uploaded
 * voiceover). No generic avatar. Approve / regenerate / discard like the rest.
 */
export function CustomVideo({ p }: { p: Production }) {
  const [imgs, setImgs] = useState<Asset[]>([]);
  const [audioAssets, setAudioAssets] = useState<Asset[]>([]);
  const [voice, setVoice] = useState<'elevenlabs' | string>('elevenlabs'); // 'elevenlabs' or an audio asset id
  const [portrait, setPortrait] = useState(true);
  const [broll, setBroll] = useState(false);
  const [takes, setTakes] = useState<VideoRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const voiceFileRef = useRef<HTMLInputElement>(null);
  const polls = useRef<Record<string, number>>({});

  function loadAssets() {
    assets.list(p.id).then((a) => {
      setImgs(a.filter((x) => x.kind === 'image'));
      setAudioAssets(a.filter((x) => x.kind === 'audio'));
    });
  }

  useEffect(() => {
    loadAssets();
    productions.videos(p.id).then((vs) => {
      const cs = vs.filter((v) => v.source === 'custom');
      setTakes(cs);
      cs.filter((v) => PROCESSING.has(v.status)).forEach((v) => watch(v.id));
    });
    const map = polls.current;
    return () => Object.values(map).forEach((t) => window.clearInterval(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.id]);

  function watch(id: string) {
    if (polls.current[id]) return;
    polls.current[id] = window.setInterval(async () => {
      try {
        const v = await api.getVideo(id);
        setTakes((rows) => rows.map((r) => (r.id === id ? v : r)));
        if (!PROCESSING.has(v.status)) {
          window.clearInterval(polls.current[id]);
          delete polls.current[id];
        }
      } catch {
        /* keep polling */
      }
    }, 5000);
  }

  async function uploadVoiceover(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy('upload');
    setError(null);
    try {
      const [a] = await assets.upload(p.id, [files[0]]);
      loadAssets();
      if (a) setVoice(a.id);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function render() {
    setBusy('render');
    setError(null);
    try {
      const v = await productions.compose(p.id, {
        voice: voice === 'elevenlabs' ? 'elevenlabs' : undefined,
        audioAssetId: voice === 'elevenlabs' ? undefined : voice,
        orientation: portrait ? 'portrait' : 'landscape'
      });
      setTakes((rows) => [v, ...rows]);
      watch(v.id);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function approve(id: string) {
    setBusy(id);
    try {
      const v = await productions.approveVideo(id);
      setTakes((rows) => rows.map((r) => (r.id === id ? v : { ...r, approved: false })));
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }
  async function discard(id: string) {
    setBusy(id);
    try {
      await productions.discardVideo(id);
      setTakes((rows) => rows.filter((r) => r.id !== id));
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="custom">
      <p className="muted">
        Build the video from <strong>your</strong> images + <strong>your</strong> voice — no generic avatar.
      </p>

      {/* Images */}
      <label className="vd-label">Your images ({imgs.length})</label>
      {imgs.length === 0 ? (
        <p className="notice">No images yet — add them in the Assets step; they become the slideshow.</p>
      ) : (
        <div className="hf-sources">
          {imgs.map((a) => (
            <span key={a.id} className="hf-src" title={a.fileName}>
              <img src={assets.rawUrl(a.id)} alt={a.fileName} loading="lazy" />
            </span>
          ))}
        </div>
      )}

      {/* Voice */}
      <label className="vd-label">Voice</label>
      <div className="vd-segment" style={{ flexWrap: 'wrap' }}>
        <button type="button" className={voice === 'elevenlabs' ? 'on' : ''} onClick={() => setVoice('elevenlabs')}>
          Brand voice (ElevenLabs)
        </button>
        {audioAssets.map((a) => (
          <button key={a.id} type="button" className={voice === a.id ? 'on' : ''} onClick={() => setVoice(a.id)} title={a.fileName}>
            🎙 {a.fileName.slice(0, 18)}
          </button>
        ))}
        <button type="button" className="attach sm" onClick={() => voiceFileRef.current?.click()} disabled={busy === 'upload'}>
          {busy === 'upload' ? 'Uploading…' : '＋ Upload voiceover'}
        </button>
        <input ref={voiceFileRef} type="file" hidden accept="audio/*,.wav,.mp3,.aac,.m4a" onChange={(e) => uploadVoiceover(e.target.files)} />
      </div>

      {/* Orientation + B-roll */}
      <label className="vd-label">Orientation</label>
      <div className="vd-segment" style={{ maxWidth: 280 }}>
        <button type="button" className={portrait ? 'on' : ''} onClick={() => setPortrait(true)}>
          Portrait 9:16
        </button>
        <button type="button" className={!portrait ? 'on' : ''} onClick={() => setPortrait(false)}>
          Landscape 16:9
        </button>
      </div>

      <label className="vd-label">Stock B-roll</label>
      <label className="toggle">
        <input type="checkbox" checked={broll} disabled onChange={(e) => setBroll(e.target.checked)} />
        <span>Mix in free stock b-roll <em className="muted">(needs a stock provider key — coming next)</em></span>
      </label>

      <div className="gen-row">
        <button className="btn" onClick={render} disabled={busy === 'render' || imgs.length === 0}>
          {busy === 'render' ? 'Rendering…' : '🎬 Render my video'}
        </button>
        <span className="muted">Your assets only · renders server-side</span>
      </div>

      {error && <p className="err">{error}</p>}

      {takes.length > 0 && (
        <>
          <label className="vd-label">Takes</label>
          <div className="gen-videos">
            {takes.map((v) => {
              const done = v.status === 'completed';
              return (
                <div key={v.id} className={`gen-video ${v.approved ? 'approved' : ''}`}>
                  {v.videoUrl && done ? (
                    <video src={v.videoUrl} controls />
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
                    <span className={`badge ${v.approved ? 'live' : ''}`}>{v.approved ? 'approved ✓' : v.status}</span>
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
                      <button className="attach sm" onClick={render} disabled={busy === 'render'}>
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
    </div>
  );
}
