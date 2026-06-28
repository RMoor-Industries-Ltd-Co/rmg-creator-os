import { useEffect, useState } from 'react';
import { assets, poster, type Post as PostRow, type PostizIntegration, type Production } from './api';

const PLATFORMS = [
  { key: 'tiktok', label: 'TikTok' },
  { key: 'youtube', label: 'YouTube' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'facebook', label: 'Facebook' },
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'x', label: 'X' }
] as const;

// Platform-specific checks/switches (the "required checks and configuration switches").
const SWITCHES: Record<string, Array<{ key: string; label: string; type: 'bool' | 'select'; options?: string[] }>> = {
  tiktok: [
    { key: 'privacy', label: 'Privacy', type: 'select', options: ['PUBLIC_TO_EVERYONE', 'FOLLOWER_OF_CREATOR', 'MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY'] },
    { key: 'disableComment', label: 'Disable comments', type: 'bool' },
    { key: 'disableDuet', label: 'Disable duet', type: 'bool' },
    { key: 'disableStitch', label: 'Disable stitch', type: 'bool' },
    { key: 'addMusic', label: 'Add music (photo)', type: 'bool' }
  ],
  youtube: [
    { key: 'visibility', label: 'Visibility', type: 'select', options: ['public', 'unlisted', 'private'] },
    { key: 'category', label: 'Category', type: 'select', options: ['Education', 'Entertainment', 'People & Blogs', 'Howto & Style', 'Science & Tech'] },
    { key: 'madeForKids', label: 'Made for kids', type: 'bool' }
  ],
  instagram: [
    { key: 'type', label: 'Type', type: 'select', options: ['reel', 'feed', 'story'] },
    { key: 'shareToFacebook', label: 'Also share to Facebook', type: 'bool' }
  ],
  facebook: [{ key: 'visibility', label: 'Visibility', type: 'select', options: ['public', 'friends', 'only_me'] }],
  linkedin: [{ key: 'visibility', label: 'Visibility', type: 'select', options: ['PUBLIC', 'CONNECTIONS'] }],
  x: [{ key: 'replySettings', label: 'Who can reply', type: 'select', options: ['everyone', 'following', 'mentioned'] }]
};

interface Draft {
  title: string;
  caption: string;
  hashtags: string;
  firstComment: string;
  switches: Record<string, unknown>;
  scheduleAt: string;
  status: string;
  postUrl: string | null;
}
const emptyDraft = (): Draft => ({ title: '', caption: '', hashtags: '', firstComment: '', switches: {}, scheduleAt: '', status: 'draft', postUrl: null });
const fromRow = (r: PostRow): Draft => ({
  title: r.title ?? '',
  caption: r.caption ?? '',
  hashtags: (r.hashtags ?? []).join(' '),
  firstComment: r.firstComment ?? '',
  switches: r.switches ?? {},
  scheduleAt: r.scheduleAt ? r.scheduleAt.slice(0, 16) : '',
  status: r.status,
  postUrl: r.postUrl
});

/** My Poster — the publishing cockpit. Compose per-platform metadata + schedule. */
export function Post({ p }: { p: Production }) {
  const [active, setActive] = useState<string[]>([]);
  const [tab, setTab] = useState('tiktok');
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [audience, setAudience] = useState('');
  const [postiz, setPostiz] = useState<{ configured: boolean; integrations: PostizIntegration[] } | null>(null);
  const [publishMsg, setPublishMsg] = useState<string | null>(null);
  const [coverDriveId, setCoverDriveId] = useState<string | null>(p.thumbnailDriveId ?? null);
  const [approvals, setApprovals] = useState<Record<string, string>>(p.deliveryApprovals ?? {});

  useEffect(() => {
    poster.postizStatus().then(setPostiz).catch(() => setPostiz({ configured: false, integrations: [] }));
  }, []);

  const brandApproved = approvals[p.brand] === 'approved';

  async function setApproval(brand: string, state: 'approved' | 'rejected' | 'pending') {
    try {
      const updated = await poster.setApproval(p.id, brand, state);
      setApprovals(updated);
    } catch (e: unknown) {
      setError(String(e));
    }
  }

  async function publish(type: 'draft' | 'now') {
    if (!brandApproved) return;
    setBusy('publish');
    setError(null);
    setPublishMsg(null);
    try {
      const res = await poster.publish(p.id, { platforms: active, type });
      const ok = res.channels.filter((c) => c.ok).map((c) => `${c.platform}→${c.channel}`);
      const skipped = res.channels.filter((c) => !c.ok).map((c) => `${c.platform} (${c.reason})`);
      setPublishMsg(
        `${type === 'now' ? 'Published' : 'Sent as drafts'}: ${ok.join(', ') || 'none'}` +
          (skipped.length ? ` · skipped: ${skipped.join(', ')}` : '')
      );
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    poster.posts(p.id).then((rows) => {
      const d: Record<string, Draft> = {};
      rows.forEach((r) => (d[r.platform] = fromRow(r)));
      setDrafts(d);
      if (rows.length) {
        setActive(rows.map((r) => r.platform));
        setTab(rows[0].platform);
      }
    });
    poster.defaults(p.brand).then((def) => {
      if (def.platforms?.length) {
        setActive((cur) => (cur.length ? cur : def.platforms));
      }
      if (def.audience) setAudience(def.audience);
    }).catch(() => undefined);
  }, [p.id, p.brand]);

  const d = drafts[tab] ?? emptyDraft();
  const setD = (patch: Partial<Draft>) => setDrafts((cur) => ({ ...cur, [tab]: { ...(cur[tab] ?? emptyDraft()), ...patch } }));
  const setSwitch = (k: string, v: unknown) => setD({ switches: { ...(drafts[tab]?.switches ?? {}), [k]: v } });

  function togglePlatform(k: string) {
    setActive((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));
    setTab(k);
    if (!drafts[k]) setDrafts((cur) => ({ ...cur, [k]: emptyDraft() }));
  }

  async function suggest() {
    setBusy('suggest');
    setError(null);
    try {
      const s = await poster.suggest(p.id, tab);
      setD({
        title: s.title || d.title,
        caption: s.caption || d.caption,
        hashtags: s.hashtags?.length ? s.hashtags.join(' ') : d.hashtags,
        firstComment: s.first_comment || d.firstComment
      });
      if (s.audience) setAudience(s.audience);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function save(platform: string) {
    const dr = drafts[platform] ?? emptyDraft();
    setBusy(platform);
    setError(null);
    try {
      const saved = await poster.savePost(p.id, platform, {
        title: dr.title || undefined,
        caption: dr.caption,
        hashtags: dr.hashtags.split(/[\s,]+/).map((h) => h.replace(/^#/, '')).filter(Boolean),
        firstComment: dr.firstComment || undefined,
        switches: dr.switches,
        scheduleAt: dr.scheduleAt ? new Date(dr.scheduleAt).toISOString() : null,
        status: dr.scheduleAt ? 'scheduled' : 'draft'
      });
      setDrafts((cur) => ({ ...cur, [platform]: fromRow(saved) }));
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function saveDefaults() {
    try {
      await poster.saveDefaults(p.brand, { platforms: active, audience: audience || undefined });
    } catch (e: unknown) {
      setError(String(e));
    }
  }

  const approvalState = approvals[p.brand];

  return (
    <div className="poster">
      <div className="video-head">
        <strong>My Poster — schedule the post</strong>
        <span className="badge">{p.brand}</span>
      </div>
      <p className="muted">Pick platforms, compose the metadata (AI-suggested), set the schedule. Publishing engine (Postiz) lights up once your platform apps are connected.</p>

      {/* Cover thumbnail */}
      <div className="cover-preview">
        <label className="vd-label">Cover image</label>
        {coverDriveId ? (
          <div className="cover-thumb-wrap">
            <img
              src={assets.driveThumbUrl(coverDriveId)}
              alt="Production cover"
              className="cover-thumb"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
            <span className="badge live">★ cover set</span>
          </div>
        ) : (
          <p className="muted cover-empty">No cover selected — go to the Scenes step to set one via "☆ Set as cover" on a completed image take.</p>
        )}
      </div>

      {/* Per-brand approval gate */}
      <div className="approval-gate">
        <label className="vd-label">Brand approval</label>
        <div className="approval-row">
          <span className="approval-brand">{p.brand}</span>
          <button
            type="button"
            className={`btn sm ${approvalState === 'approved' ? 'live' : 'ghost'}`}
            onClick={() => setApproval(p.brand, approvalState === 'approved' ? 'pending' : 'approved')}
          >
            ✓ Approve
          </button>
          <button
            type="button"
            className={`btn sm ${approvalState === 'rejected' ? 'danger' : 'ghost'}`}
            onClick={() => setApproval(p.brand, approvalState === 'rejected' ? 'pending' : 'rejected')}
          >
            ✕ Reject
          </button>
          {approvalState && (
            <span className={`badge ${approvalState === 'approved' ? 'live' : approvalState === 'rejected' ? 'err' : ''}`}>
              {approvalState}
            </span>
          )}
        </div>
        {!brandApproved && (
          <p className="muted hint">Approve this brand to enable publishing.</p>
        )}
      </div>

      <label className="vd-label">Platforms for {p.brand}</label>
      <ul className="checks vd-brands">
        {PLATFORMS.map((pl) => {
          const on = active.includes(pl.key);
          return (
            <li key={pl.key}>
              <button type="button" className={`vd-check ${on ? 'on' : ''}`} onClick={() => togglePlatform(pl.key)}>
                <span className="vd-box">{on ? '✓' : ''}</span>
                <span>{pl.label}</span>
                {drafts[pl.key]?.scheduleAt && <span className="badge live">scheduled</span>}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="gen-row">
        <input className="hf-select" style={{ flex: 1, minWidth: 200 }} type="text" placeholder="Target audience…" value={audience} onChange={(e) => setAudience(e.target.value)} />
        <button className="attach sm" onClick={saveDefaults}>Save brand defaults</button>
      </div>

      {active.length > 0 && (
        <>
          <div className="tabs" style={{ marginTop: 14 }}>
            {active.map((k) => (
              <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
                {PLATFORMS.find((x) => x.key === k)?.label ?? k}
              </button>
            ))}
          </div>

          <div className="gen-row">
            <button className="btn ghost" onClick={suggest} disabled={busy === 'suggest'}>
              {busy === 'suggest' ? 'Suggesting…' : '✨ Suggest metadata'}
            </button>
            <span className="muted">researched caption · hashtags · first comment</span>
          </div>

          {tab === 'youtube' && (
            <>
              <label className="vd-label">Title</label>
              <input className="hf-select" style={{ width: '100%' }} type="text" value={d.title} onChange={(e) => setD({ title: e.target.value })} />
            </>
          )}

          <label className="vd-label">Caption / description</label>
          <textarea className="intake-box" rows={4} value={d.caption} onChange={(e) => setD({ caption: e.target.value })} />

          <label className="vd-label">Hashtags</label>
          <input className="hf-select" style={{ width: '100%' }} type="text" placeholder="#brand #topic…" value={d.hashtags} onChange={(e) => setD({ hashtags: e.target.value })} />

          <label className="vd-label">First comment</label>
          <textarea className="intake-box" rows={2} placeholder="extra hashtags / link…" value={d.firstComment} onChange={(e) => setD({ firstComment: e.target.value })} />

          <label className="vd-label">Checks &amp; switches — {tab}</label>
          <div className="switch-grid">
            {(SWITCHES[tab] ?? []).map((s) =>
              s.type === 'bool' ? (
                <label key={s.key} className="toggle">
                  <input type="checkbox" checked={Boolean(d.switches[s.key])} onChange={(e) => setSwitch(s.key, e.target.checked)} />
                  <span>{s.label}</span>
                </label>
              ) : (
                <label key={s.key} className="switch-sel">
                  <span className="muted">{s.label}</span>
                  <select value={String(d.switches[s.key] ?? '')} onChange={(e) => setSwitch(s.key, e.target.value)}>
                    <option value="">—</option>
                    {s.options?.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                </label>
              )
            )}
          </div>

          <label className="vd-label">Schedule</label>
          <div className="gen-row">
            <input className="hf-select" type="datetime-local" value={d.scheduleAt} onChange={(e) => setD({ scheduleAt: e.target.value })} />
            <button className="btn" onClick={() => save(tab)} disabled={busy === tab}>
              {busy === tab ? 'Saving…' : d.scheduleAt ? '🗓 Save & schedule' : '💾 Save draft'}
            </button>
            {d.status === 'scheduled' && <span className="badge live">scheduled</span>}
            {d.postUrl && <a className="drive-link" href={d.postUrl} target="_blank" rel="noreferrer">live ↗</a>}
          </div>
          <p className="muted hint">Saved as a draft post package. Use "Send to Social Manager" below to push the finished video + metadata into Postiz.</p>
        </>
      )}

      <div className="publish-panel">
        <div className="publish-head">
          <strong>🚀 Send to Social Manager</strong>
          {postiz?.configured ? (
            postiz.integrations.length ? (
              <span className="muted">
                Connected: {postiz.integrations.map((i) => i.name).join(', ')}
              </span>
            ) : (
              <span className="muted">No channels connected yet — add one in Postiz.</span>
            )
          ) : (
            <span className="muted">Not connected — add a Postiz API key to enable.</span>
          )}
        </div>
        {!brandApproved && (
          <p className="muted hint">⚠️ Approve the brand above before publishing.</p>
        )}
        {postiz?.configured && (
          <div className="gen-row">
            <button className="btn" onClick={() => publish('draft')} disabled={busy === 'publish' || !active.length || !brandApproved}>
              {busy === 'publish' ? 'Sending…' : '📤 Push drafts to Postiz'}
            </button>
            <button className="btn ghost" onClick={() => publish('now')} disabled={busy === 'publish' || !active.length || !brandApproved}>
              ⚡ Publish now
            </button>
            <a className="drive-link" href="https://social.rmasters.group/launches" target="_blank" rel="noreferrer">
              open Postiz ↗
            </a>
          </div>
        )}
        {publishMsg && <p className="muted hint">{publishMsg}</p>}
      </div>

      {error && <p className="err">{error}</p>}
    </div>
  );
}
