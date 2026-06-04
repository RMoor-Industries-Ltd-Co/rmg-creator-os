import { useEffect, useRef, useState } from 'react';
import { api, productions, type VideoRow, type Production } from './api';

const PROCESSING = new Set(['processing', 'pending', 'waiting', 'unknown']);
const isVideoUrl = (u: string | null) => !!u && /\.(mp4|mov|webm)(\?|$)/i.test(u);
const LABEL: Record<string, string> = { heygen: 'A-Roll', higgsfield: 'Scene', stock: 'Stock', custom: 'Custom' };

interface Shot {
  id: string;
  source: string;
  videoUrl: string | null;
  approved: boolean;
}

/**
 * Final cut — line up your shots on a grid (drag to reorder), then render one video
 * with your narration over the top. Download it for CapCut.
 */
export function FinalCut({ p }: { p: Production }) {
  const [order, setOrder] = useState<Shot[]>([]);
  const [portrait, setPortrait] = useState(true);
  const [final, setFinal] = useState<VideoRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const drag = useRef<number | null>(null);
  const poll = useRef<number | null>(null);

  useEffect(() => {
    productions.videos(p.id).then((vs) => {
      // Suggested order: approved A-Roll first, then scenes, then stock.
      const shots = vs.filter((v) => v.status === 'completed' && v.source !== 'final');
      const rank = (s: string) => (s === 'heygen' ? 0 : s === 'higgsfield' ? 1 : s === 'custom' ? 2 : 3);
      shots.sort((a, b) => rank(a.source) - rank(b.source) || (b.approved ? 1 : 0) - (a.approved ? 1 : 0));
      setOrder(shots.map((v) => ({ id: v.id, source: v.source, videoUrl: v.videoUrl, approved: v.approved })));
      const existing = vs.find((v) => v.source === 'final');
      if (existing) {
        setFinal(existing);
        if (PROCESSING.has(existing.status)) watch(existing.id);
      }
    });
    return () => {
      if (poll.current) window.clearInterval(poll.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.id]);

  function watch(id: string) {
    if (poll.current) window.clearInterval(poll.current);
    poll.current = window.setInterval(async () => {
      try {
        const v = await api.getVideo(id);
        setFinal(v);
        if (!PROCESSING.has(v.status) && poll.current) {
          window.clearInterval(poll.current);
          poll.current = null;
        }
      } catch {
        /* keep polling */
      }
    }, 5000);
  }

  function reorder(from: number, to: number) {
    if (from === to) return;
    setOrder((cur) => {
      const next = [...cur];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }
  const remove = (id: string) => setOrder((cur) => cur.filter((s) => s.id !== id));

  async function assemble() {
    if (order.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const v = await productions.assemble(p.id, {
        items: order.map((s) => ({ type: 'video' as const, id: s.id })),
        orientation: portrait ? 'portrait' : 'landscape'
      });
      setFinal(v);
      watch(v.id);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stage-card">
      <div className="video-head">
        <strong>Final cut — assemble &amp; download</strong>
        {final?.status === 'completed' && <span className="badge live">rendered</span>}
      </div>
      <p className="muted">Drag shots to set the order. Your narration runs over the top. Render, then download into CapCut for captions.</p>

      {order.length === 0 ? (
        <p className="muted">No shots yet — make an A-Roll, scenes, or pull stock b-roll above.</p>
      ) : (
        <ol className="seq-grid">
          {order.map((s, i) => (
            <li
              key={s.id}
              className={`seq-item ${s.source === 'heygen' ? 'aroll' : ''}`}
              draggable
              onDragStart={() => (drag.current = i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (drag.current !== null) reorder(drag.current, i);
                drag.current = null;
              }}
              title="Drag to reorder"
            >
              <span className="seq-num">{i + 1}</span>
              {isVideoUrl(s.videoUrl) || s.source === 'heygen' || s.source === 'custom' ? (
                <video src={s.videoUrl ?? undefined} muted preload="metadata" />
              ) : (
                <img src={s.videoUrl ?? undefined} alt="" loading="lazy" />
              )}
              <span className="seq-tag">{s.source === 'heygen' ? '★ A-ROLL' : LABEL[s.source] ?? s.source}{s.approved ? ' ✓' : ''}</span>
              <button className="seq-x" onClick={() => remove(s.id)} title="Remove from cut">✕</button>
            </li>
          ))}
        </ol>
      )}

      <div className="gen-row">
        <div className="vd-segment" style={{ maxWidth: 260 }}>
          <button type="button" className={portrait ? 'on' : ''} onClick={() => setPortrait(true)}>Portrait 9:16</button>
          <button type="button" className={!portrait ? 'on' : ''} onClick={() => setPortrait(false)}>Landscape 16:9</button>
        </div>
        <button className="btn" onClick={assemble} disabled={busy || order.length === 0}>
          {busy ? 'Assembling…' : '🎬 Generate final video'}
        </button>
      </div>

      {error && <p className="err">{error}</p>}

      {final && (
        <div className="final-out">
          {final.status === 'completed' && final.videoUrl ? (
            <>
              <video src={final.videoUrl} controls />
              <div className="gen-row">
                <a className="btn" href={final.videoUrl} download={`final_${p.id.slice(0, 8)}.mp4`}>⬇ Download for CapCut</a>
                {final.driveLink && (
                  <a className="drive-link" href={final.driveLink} target="_blank" rel="noreferrer">Drive ↗</a>
                )}
              </div>
            </>
          ) : (
            <div className={`video-ph ${final.status === 'failed' ? 'err' : ''}`}>
              {final.status === 'failed' ? 'Assembly failed' : <><span className="spinner" /> assembling…</>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
