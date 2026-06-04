import { useEffect, useRef, useState } from 'react';
import { api, productions, type HeyGenAvatar, type Production, type VideoRow } from './api';

const PROCESSING = new Set(['processing', 'pending', 'waiting', 'unknown']);

/**
 * Generate step — renders ALLEN's emotion-directed voice and lip-syncs a HeyGen
 * avatar to it. The finished video links back to the production (and shows in Studio).
 */
export function Generate({ p }: { p: Production }) {
  const [avatars, setAvatars] = useState<HeyGenAvatar[] | null>(null);
  const [avatarId, setAvatarId] = useState('');
  const [portrait, setPortrait] = useState(true);
  const [videos, setVideos] = useState<VideoRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const poll = useRef<number | null>(null);

  useEffect(() => {
    api
      .avatars()
      .then((a) => {
        setAvatars(a);
        setAvatarId((cur) => cur || a[0]?.avatar_id || '');
      })
      .catch((e: unknown) => setError(String(e)));
    productions.videos(p.id).then(setVideos).catch(() => undefined);
    return () => {
      if (poll.current) window.clearInterval(poll.current);
    };
  }, [p.id]);

  function watch(id: string) {
    if (poll.current) window.clearInterval(poll.current);
    poll.current = window.setInterval(async () => {
      try {
        const v = await api.getVideo(id);
        setVideos((rows) => rows.map((r) => (r.id === id ? v : r)));
        if (!PROCESSING.has(v.status) && poll.current) {
          window.clearInterval(poll.current);
          poll.current = null;
        }
      } catch {
        /* keep polling */
      }
    }, 5000);
  }

  async function generate() {
    if (!avatarId) return;
    setBusy(true);
    setError(null);
    try {
      const v = await productions.generate(p.id, {
        avatarId,
        dimension: portrait ? { width: 720, height: 1280 } : { width: 1280, height: 720 }
      });
      setVideos((rows) => [v, ...rows]);
      watch(v.id);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const directed = Boolean(p.taggedScript);

  return (
    <div className="generate">
      <div className="video-head">
        <strong>Generate</strong>
        <span className="badge">{directed ? 'voice: emotion-directed' : 'voice: brand default'}</span>
      </div>
      <p className="muted">
        Renders {directed ? "the directed script in ALLEN's v3 voice" : "the script in the brand voice"} and
        lip-syncs your chosen avatar to it.
      </p>

      <label className="vd-label">Avatar</label>
      {!avatars && !error && <p className="muted">Loading avatars…</p>}
      {avatars && avatars.length === 0 && <p className="muted">No HeyGen avatars on the account.</p>}
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

      <div className="gen-row">
        <div className="vd-segment" style={{ maxWidth: 260 }}>
          <button type="button" className={portrait ? 'on' : ''} onClick={() => setPortrait(true)}>
            Portrait 9:16
          </button>
          <button type="button" className={!portrait ? 'on' : ''} onClick={() => setPortrait(false)}>
            Landscape 16:9
          </button>
        </div>
        <button className="btn" onClick={generate} disabled={busy || !avatarId}>
          {busy ? 'Sending…' : '🎬 Generate video'}
        </button>
      </div>

      {error && <p className="err">{error}</p>}

      {videos.length > 0 && (
        <>
          <label className="vd-label">Renders</label>
          <div className="gen-videos">
            {videos.map((v) => (
              <div key={v.id} className="gen-video">
                {v.videoUrl ? (
                  <video src={v.videoUrl} controls poster={v.thumbnailUrl ?? undefined} />
                ) : (
                  <div className={`video-ph ${v.status === 'failed' ? 'err' : ''}`}>
                    {v.status === 'failed' ? 'Render failed' : <><span className="spinner" /> {v.status}…</>}
                  </div>
                )}
                <div className="gen-video-meta">
                  <span className="badge">{v.status}</span>
                  {v.driveLink && (
                    <a className="drive-link" href={v.driveLink} target="_blank" rel="noreferrer">
                      Drive ↗
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
