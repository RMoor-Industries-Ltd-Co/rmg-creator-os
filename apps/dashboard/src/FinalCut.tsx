import { useEffect, useRef, useState } from 'react';
import { api, productions, type Clip, type VideoRow, type Production } from './api';

const PROCESSING = new Set(['processing', 'pending', 'waiting', 'unknown']);
const isVideoUrl = (u: string | null) => !!u && /\.(mp4|mov|webm)(\?|$)/i.test(u);
const LABEL: Record<string, string> = { heygen: 'A-Roll', higgsfield: 'Scene', stock: 'Stock', custom: 'Custom', supercool: 'SuperCool', external: 'External' };

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
  const [gathering, setGathering] = useState(false);
  const [gathered, setGathered] = useState<Awaited<ReturnType<typeof productions.archive>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const drag = useRef<number | null>(null);
  const poll = useRef<number | null>(null);
  const [clips, setClips] = useState<Clip[] | null>(null);
  const [uploadingFinal, setUploadingFinal] = useState(false);
  const finalFileRef = useRef<HTMLInputElement>(null);
  const [importUrl, setImportUrl] = useState('');
  const [importLabel, setImportLabel] = useState('');
  const [importing, setImporting] = useState(false);

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
    productions.clips(p.id).then(setClips).catch(() => { /* clips optional */ });
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

  async function gather() {
    setGathering(true);
    setError(null);
    try {
      setGathered(await productions.archive(p.id));
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setGathering(false);
    }
  }

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

  function setLabel(id: string, label: string) {
    setClips((cs) => (cs ? cs.map((c) => (c.id === id ? { ...c, label } : c)) : cs));
  }
  async function saveLabel(id: string, label: string) {
    try {
      await productions.setVideoLabel(id, label);
    } catch {
      /* label save is best-effort */
    }
  }
  function downloadAll() {
    (clips ?? []).forEach((c, i) => {
      window.setTimeout(() => {
        const a = document.createElement('a');
        a.href = productions.videoRawUrl(c.id);
        a.download = '';
        document.body.appendChild(a);
        a.click();
        a.remove();
      }, i * 400);
    });
  }
  async function uploadFinal(file: File) {
    setUploadingFinal(true);
    setError(null);
    try {
      await productions.uploadFinalCut(p.id, file);
      const vs = await productions.videos(p.id);
      const f = vs.find((v) => v.source === 'final');
      if (f) setFinal(f);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setUploadingFinal(false);
    }
  }
  async function importClip() {
    if (!importUrl.trim()) return;
    setImporting(true);
    setError(null);
    try {
      const v = await productions.importClip(p.id, { url: importUrl.trim(), source: 'supercool', label: importLabel.trim() || undefined });
      setOrder((cur) => [...cur, { id: v.id, source: v.source, videoUrl: v.videoUrl, approved: v.approved }]);
      productions.clips(p.id).then(setClips).catch(() => { /* optional */ });
      setImportUrl('');
      setImportLabel('');
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setImporting(false);
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

      {/* Gather all assets into Drive (named + foldered) for CapCut. */}
      <div className="gen-row" style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
        <button className="btn ghost" onClick={gather} disabled={gathering}>
          {gathering ? 'Gathering…' : '📁 Gather for CapCut'}
        </button>
        <span className="muted">Names + archives A-Roll · Final · Voice into a titled folder; saves b-roll to the library.</span>
      </div>
      {gathered && (
        <div className="gather-out">
          <a className="drive-link" href={gathered.folder} target="_blank" rel="noreferrer">📂 Open production folder ↗</a>
          <ul className="gather-list">
            {gathered.aroll?.link && <li><span className="badge live">A-ROLL</span> <a className="drive-link" href={gathered.aroll.link} target="_blank" rel="noreferrer">{gathered.aroll.name}</a></li>}
            {gathered.final?.link && <li><span className="badge">FINAL</span> <a className="drive-link" href={gathered.final.link} target="_blank" rel="noreferrer">{gathered.final.name}</a></li>}
            {gathered.voice?.link && <li><span className="badge">VOICE</span> <a className="drive-link" href={gathered.voice.link} target="_blank" rel="noreferrer">{gathered.voice.name}</a></li>}
            {gathered.broll.map((b) => (
              <li key={b.id}>
                <span className="badge">B-ROLL</span>{' '}
                {b.link ? <a className="drive-link" href={b.link} target="_blank" rel="noreferrer">{b.name ?? 'clip'}</a> : <span className="muted">{b.name ?? 'clip'} (not saved)</span>}
                {b.tags.length > 0 && <span className="muted"> · {b.tags.join(', ')}</span>}
              </li>
            ))}
          </ul>
          <p className="muted">Everything's in Drive — pull the folder + b-roll into CapCut.</p>
        </div>
      )}

      <div className="gen-row" style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 14, flexWrap: 'wrap' }}>
        <input
          className="clip-label"
          style={{ minWidth: 220 }}
          placeholder="SuperCool / external clip URL…"
          value={importUrl}
          onChange={(e) => setImportUrl(e.target.value)}
        />
        <input
          className="clip-label"
          style={{ maxWidth: 160 }}
          placeholder="Label (optional)"
          value={importLabel}
          onChange={(e) => setImportLabel(e.target.value)}
        />
        <button className="btn ghost" onClick={importClip} disabled={importing || !importUrl.trim()}>
          {importing ? 'Importing…' : '＋ Import clip'}
        </button>
        <span className="muted">Bring a SuperCool (or any external) render into this production — it becomes a downloadable, assemblable clip.</span>
      </div>

      {clips && clips.length > 0 && (
        <div className="clips-panel" style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
          <div className="video-head">
            <strong>Download clips</strong>
            <span className="badge">{clips.length}</span>
          </div>
          <p className="muted">
            Label each segment, then download for CapCut/Descript. Filenames use your labels.
          </p>
          <ul className="clip-list">
            {clips.map((c) => (
              <li key={c.id} className="clip-row">
                <span className="seq-tag">{c.kind}</span>
                <input
                  className="clip-label"
                  placeholder="Label this segment…"
                  value={c.label ?? ''}
                  onChange={(e) => setLabel(c.id, e.target.value)}
                  onBlur={(e) => saveLabel(c.id, e.target.value)}
                />
                <a className="btn ghost" href={productions.videoRawUrl(c.id)} download title="Download clip">
                  ⬇
                </a>
                {c.driveLink && (
                  <a className="drive-link" href={c.driveLink} target="_blank" rel="noreferrer">Drive ↗</a>
                )}
              </li>
            ))}
          </ul>
          <button className="btn ghost" onClick={downloadAll}>⬇ Download all</button>
        </div>
      )}

      <div className="gen-row" style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
        <input
          ref={finalFileRef}
          type="file"
          hidden
          accept="video/*"
          onChange={(e) => e.target.files?.[0] && uploadFinal(e.target.files[0])}
        />
        <button className="btn" onClick={() => finalFileRef.current?.click()} disabled={uploadingFinal}>
          {uploadingFinal ? 'Uploading…' : '⬆ Upload edited final cut'}
        </button>
        <span className="muted">
          Cut in CapCut/Descript, then upload here — it becomes the verified Final Cut.
        </span>
      </div>

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
