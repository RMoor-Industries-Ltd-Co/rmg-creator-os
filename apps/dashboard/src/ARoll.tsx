import { useEffect, useRef, useState } from 'react';
import { api, assets, productions, type Asset, type Production, type VideoRow } from './api';

const PROCESSING = new Set(['processing', 'pending', 'waiting', 'unknown']);
type Src = { kind: 'video' | 'asset'; id: string; url: string };

/**
 * ② A-Roll — lip-sync your APPROVED cleaned still (or an uploaded photo) into a
 * talking head (HeyGen Avatar IV) in your voice, guided by a motion prompt.
 */
export function ARoll({ p }: { p: Production }) {
  const [stills, setStills] = useState<Src[]>([]); // cleaned stills + uploaded photos
  const [audioAssets, setAudioAssets] = useState<Asset[]>([]);
  const [src, setSrc] = useState<Src | null>(null);
  const [voice, setVoice] = useState<'elevenlabs' | string>('elevenlabs');
  const [portrait, setPortrait] = useState(true);
  const [prompts, setPrompts] = useState<Array<{ name: string; text: string }>>([]);
  const [promptName, setPromptName] = useState('');
  const [motion, setMotion] = useState('');
  const [takes, setTakes] = useState<VideoRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const voiceFileRef = useRef<HTMLInputElement>(null);
  const polls = useRef<Record<string, number>>({});

  function load() {
    assets.list(p.id).then((a) => setAudioAssets(a.filter((x) => x.kind === 'audio')));
    Promise.all([assets.list(p.id), productions.videos(p.id)]).then(([a, vs]) => {
      // Cleaned stills = Higgsfield image outputs; plus raw uploaded photos.
      const cleaned: Src[] = vs
        .filter((v) => v.source === 'higgsfield' && v.status === 'completed' && /\.(png|jpe?g|webp)(\?|$)/i.test(v.videoUrl ?? ''))
        .sort((x, y) => (y.approved ? 1 : 0) - (x.approved ? 1 : 0))
        .map((v) => ({ kind: 'video' as const, id: v.id, url: v.videoUrl! }));
      const uploaded: Src[] = a.filter((x) => x.kind === 'image').map((x) => ({ kind: 'asset' as const, id: x.id, url: assets.rawUrl(x.id) }));
      const all = [...cleaned, ...uploaded];
      setStills(all);
      setSrc((cur) => cur ?? all[0] ?? null);
      const ar = vs.filter((v) => v.source === 'heygen' && (v.config as { aroll?: boolean })?.aroll);
      setTakes(ar);
      ar.filter((v) => PROCESSING.has(v.status)).forEach((v) => watch(v.id));
    });
  }

  useEffect(() => {
    load();
    productions.arollPrompts().then(setPrompts).catch(() => setPrompts([]));
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

  function pickPrompt(name: string) {
    setPromptName(name);
    setMotion(prompts.find((p) => p.name === name)?.text ?? '');
  }

  async function uploadVoiceover(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy('upload');
    try {
      const [a] = await assets.upload(p.id, [files[0]]);
      load();
      if (a) setVoice(a.id);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function generate() {
    if (!src) return;
    setBusy('gen');
    setError(null);
    try {
      const v = await productions.aroll(p.id, {
        imageAssetId: src.kind === 'asset' ? src.id : undefined,
        sourceVideoId: src.kind === 'video' ? src.id : undefined,
        audioAssetId: voice === 'elevenlabs' ? undefined : voice,
        orientation: portrait ? 'portrait' : 'landscape',
        motionPrompt: motion.trim() || undefined
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
    <div className="stage-card">
      <div className="video-head">
        <strong>② A-Roll — lip-synced you</strong>
        <span className="badge live">HeyGen Avatar IV</span>
      </div>
      <p className="muted">Pick an approved clean still, choose a motion prompt + voice, and render your standalone talking head.</p>

      <label className="vd-label">Source still (cleaned images first)</label>
      {stills.length === 0 ? (
        <p className="notice">No stills yet — make a clean image in ① above, or upload a photo in Assets.</p>
      ) : (
        <div className="hf-sources">
          {stills.map((s) => (
            <button key={`${s.kind}:${s.id}`} type="button" className={`hf-src ${src?.id === s.id ? 'on' : ''}`} onClick={() => setSrc(s)}>
              <img src={s.url} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}

      <label className="vd-label">Motion prompt</label>
      <div className="vd-segment" style={{ flexWrap: 'wrap' }}>
        <button type="button" className={promptName === '' ? 'on' : ''} onClick={() => { setPromptName(''); setMotion(''); }}>None</button>
        {prompts.map((pr) => (
          <button key={pr.name} type="button" className={promptName === pr.name ? 'on' : ''} onClick={() => pickPrompt(pr.name)}>{pr.name}</button>
        ))}
      </div>
      <textarea className="intake-box" rows={2} placeholder="Motion / expression cues (editable)…" value={motion} onChange={(e) => setMotion(e.target.value)} />

      <label className="vd-label">Voice</label>
      <div className="vd-segment" style={{ flexWrap: 'wrap' }}>
        <button type="button" className={voice === 'elevenlabs' ? 'on' : ''} onClick={() => setVoice('elevenlabs')}>Brand voice (ElevenLabs)</button>
        {audioAssets.map((a) => (
          <button key={a.id} type="button" className={voice === a.id ? 'on' : ''} onClick={() => setVoice(a.id)} title={a.fileName}>🎙 {a.fileName.slice(0, 16)}</button>
        ))}
        <button type="button" className="attach sm" onClick={() => voiceFileRef.current?.click()} disabled={busy === 'upload'}>
          {busy === 'upload' ? 'Uploading…' : '＋ Upload voiceover'}
        </button>
        <input ref={voiceFileRef} type="file" hidden accept="audio/*,.wav,.mp3,.aac,.m4a" onChange={(e) => uploadVoiceover(e.target.files)} />
      </div>

      <label className="vd-label">Orientation</label>
      <div className="vd-segment" style={{ maxWidth: 280 }}>
        <button type="button" className={portrait ? 'on' : ''} onClick={() => setPortrait(true)}>Portrait 9:16</button>
        <button type="button" className={!portrait ? 'on' : ''} onClick={() => setPortrait(false)}>Landscape 16:9</button>
      </div>

      <div className="gen-row">
        <button className="btn" onClick={generate} disabled={busy === 'gen' || !src}>
          {busy === 'gen' ? 'Sending…' : '🎬 Generate A-Roll'}
        </button>
        <span className="muted">Avatar IV lip-sync · spends credits · ~2 min</span>
      </div>

      {error && <p className="err">{error}</p>}

      {takes.length > 0 && (
        <div className="gen-videos">
          {takes.map((v) => {
            const done = v.status === 'completed';
            return (
              <div key={v.id} className={`gen-video ${v.approved ? 'approved' : ''}`}>
                {v.videoUrl && done ? (
                  <video src={v.videoUrl} controls poster={v.thumbnailUrl ?? undefined} />
                ) : (
                  <div className={`video-ph ${v.status === 'failed' ? 'err' : ''}`}>
                    {v.status === 'failed' ? 'Render failed' : <><span className="spinner" /> {v.status}…</>}
                  </div>
                )}
                <div className="gen-video-meta">
                  <span className={`badge ${v.approved ? 'live' : ''}`}>{v.approved ? 'approved ✓ (A-Roll)' : v.status}</span>
                  {v.driveLink && <a className="drive-link" href={v.driveLink} target="_blank" rel="noreferrer">Drive ↗</a>}
                </div>
                <div className="take-actions">
                  {done && !v.approved && <button className="btn ghost sm" onClick={() => approve(v.id)} disabled={busy === v.id}>✓ Approve</button>}
                  {done && <button className="attach sm" onClick={generate} disabled={busy === 'gen'}>↻ Regenerate</button>}
                  {!v.approved && <button className="attach sm danger" onClick={() => discard(v.id)} disabled={busy === v.id}>✕ Discard</button>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
