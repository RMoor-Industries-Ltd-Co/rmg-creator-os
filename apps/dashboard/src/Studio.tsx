import { useEffect, useMemo, useRef, useState } from 'react';
import { BRANDS } from '@rmg-creator-os/types';
import { api, TERMINAL, type HeyGenAvatar, type HeyGenVoice, type VideoRow } from './api';

const BRAND_OPTIONS = [
  { value: '', label: '— none —' },
  ...BRANDS.filter((b) => b.contentFolder).map((b) => ({ value: b.key, label: b.code }))
];

export function Studio() {
  const [avatars, setAvatars] = useState<HeyGenAvatar[]>([]);
  const [voices, setVoices] = useState<HeyGenVoice[]>([]);
  const [videos, setVideos] = useState<VideoRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [avatarFilter, setAvatarFilter] = useState('');
  const [avatarId, setAvatarId] = useState('');
  const [voiceId, setVoiceId] = useState('');
  const [script, setScript] = useState('');
  const [title, setTitle] = useState('');
  const [brand, setBrand] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.avatars(), api.voices(), api.listVideos()])
      .then(([a, v, vids]) => {
        setAvatars(a);
        setVoices(v);
        setVideos(vids);
      })
      .catch((e: unknown) => setLoadError(String(e)));
  }, []);

  // Poll any non-terminal videos until they finish.
  const pending = videos.some((v) => !TERMINAL.has(v.status));
  const videosRef = useRef(videos);
  videosRef.current = videos;
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => {
      videosRef.current
        .filter((v) => !TERMINAL.has(v.status))
        .forEach((v) => {
          api
            .getVideo(v.id)
            .then((updated) =>
              setVideos((cur) => cur.map((x) => (x.id === updated.id ? updated : x)))
            )
            .catch(() => {});
        });
    }, 6000);
    return () => clearInterval(t);
  }, [pending]);

  const filteredAvatars = useMemo(() => {
    const f = avatarFilter.trim().toLowerCase();
    const list = f
      ? avatars.filter((a) => (a.avatar_name ?? a.avatar_id).toLowerCase().includes(f))
      : avatars;
    return list.slice(0, 300);
  }, [avatars, avatarFilter]);

  async function generate() {
    setFormError(null);
    if (!avatarId || !voiceId || !script.trim()) {
      setFormError('Pick an avatar, a voice, and enter a script.');
      return;
    }
    setSubmitting(true);
    try {
      const row = await api.generate({
        avatarId,
        voiceId,
        text: script.trim(),
        title: title.trim() || undefined,
        brand: brand || undefined
      });
      setVideos((cur) => [row, ...cur]);
      setScript('');
      setTitle('');
    } catch (e: unknown) {
      setFormError(String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="studio">
      <section className="panel">
        <h2>Generate avatar video</h2>
        {loadError && <p className="err">Couldn't load HeyGen: {loadError}</p>}

        <div className="form-grid">
          <label>
            Avatar <span className="muted">({avatars.length})</span>
            <input
              type="text"
              placeholder="filter avatars…"
              value={avatarFilter}
              onChange={(e) => setAvatarFilter(e.target.value)}
            />
            <select value={avatarId} onChange={(e) => setAvatarId(e.target.value)}>
              <option value="">— choose avatar —</option>
              {filteredAvatars.map((a) => (
                <option key={a.avatar_id} value={a.avatar_id}>
                  {a.avatar_name ?? a.avatar_id}
                </option>
              ))}
            </select>
          </label>

          <label>
            Voice <span className="muted">({voices.length})</span>
            <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>
              <option value="">— choose voice —</option>
              {voices.map((v) => (
                <option key={v.voice_id} value={v.voice_id}>
                  {(v.name ?? v.voice_id) + (v.language ? ` · ${v.language}` : '')}
                </option>
              ))}
            </select>
          </label>

          <label>
            Brand
            <select value={brand} onChange={(e) => setBrand(e.target.value)}>
              {BRAND_OPTIONS.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
          </label>

          <label className="full">
            Title (optional)
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>

          <label className="full">
            Script
            <textarea
              rows={3}
              placeholder="What should the avatar say?"
              value={script}
              onChange={(e) => setScript(e.target.value)}
            />
          </label>
        </div>

        {formError && <p className="err">{formError}</p>}
        <button className="btn" onClick={generate} disabled={submitting}>
          {submitting ? 'Generating…' : 'Generate video'}
        </button>
      </section>

      <section className="panel">
        <h2>Your videos</h2>
        {videos.length === 0 && <p className="muted">No videos yet — generate your first above.</p>}
        <div className="video-grid">
          {videos.map((v) => (
            <article key={v.id} className="video-card">
              <div className="video-head">
                <strong>{v.title || v.inputText.slice(0, 40)}</strong>
                <span className={`badge ${v.status === 'completed' ? 'live' : ''}`}>{v.status}</span>
              </div>
              {v.status === 'completed' && v.videoUrl ? (
                <video controls poster={v.thumbnailUrl ?? undefined} src={v.videoUrl} />
              ) : v.status === 'failed' ? (
                <div className="video-ph err">generation failed</div>
              ) : (
                <div className="video-ph">
                  <span className="spinner" /> rendering…
                </div>
              )}
              <p className="muted clip">{v.inputText}</p>
              <div className="video-meta">
                {v.driveLink ? (
                  <a className="drive-link" href={v.driveLink} target="_blank" rel="noreferrer">
                    ✓ Saved to Drive ↗
                  </a>
                ) : v.status === 'completed' ? (
                  <span className="muted">saving to Drive…</span>
                ) : null}
                {v.brand && <span className="badge">{v.brand}</span>}
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
