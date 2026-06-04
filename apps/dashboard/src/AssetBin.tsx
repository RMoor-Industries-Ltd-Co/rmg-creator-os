import { useEffect, useState } from 'react';
import { productions, type Production, type VideoRow } from './api';

const isVideoUrl = (u: string | null) => !!u && /\.(mp4|mov|webm)(\?|$)/i.test(u);
const LABEL: Record<string, string> = {
  heygen: 'A-Roll',
  higgsfield: 'Scene',
  stock: 'Stock',
  custom: 'Custom'
};

/** The multiplied assets — every video produced for this production, in one bin. */
export function AssetBin({ p }: { p: Production }) {
  const [vids, setVids] = useState<VideoRow[]>([]);

  function load() {
    productions.videos(p.id).then(setVids).catch(() => undefined);
  }
  useEffect(load, [p.id]);

  const done = vids.filter((v) => v.status === 'completed');
  const hero = done.find((v) => v.approved && v.source === 'heygen');

  return (
    <div className="stage-card bin">
      <div className="video-head">
        <strong>Your assets ({done.length})</strong>
        <button className="attach sm" onClick={load}>↻ Refresh</button>
      </div>
      {hero ? (
        <p className="muted">Hero A-Roll approved ✓ — stands alone. Everything below can layer on top in editing.</p>
      ) : (
        <p className="muted">Approve an A-Roll above to set your standalone hero video.</p>
      )}

      {done.length === 0 ? (
        <p className="muted">Nothing rendered yet.</p>
      ) : (
        <div className="bin-grid">
          {done.map((v) => (
            <figure key={v.id} className={`bin-item ${v.approved ? 'approved' : ''}`}>
              {isVideoUrl(v.videoUrl) || v.source === 'heygen' || v.source === 'custom' ? (
                <video src={v.videoUrl ?? undefined} controls preload="metadata" />
              ) : (
                <img src={v.videoUrl ?? undefined} alt="" loading="lazy" />
              )}
              <figcaption>
                <span className="badge">{LABEL[v.source] ?? v.source}</span>
                {v.approved && <span className="badge live">hero</span>}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}
