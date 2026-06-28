import { useEffect, useState } from 'react';
import { allen } from './api';

function daypart(): 'morning' | 'afternoon' | 'evening' {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 18) return 'afternoon';
  return 'evening';
}

// ALLIE & ALLEN greet you with the day's talking points — the first thing on the Overview.
export function MorningBrief() {
  const [brief, setBrief] = useState('');
  const [loading, setLoading] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const dp = daypart();

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const r = await allen.brief(undefined, dp);
      setBrief(r.brief);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function hear() {
    if (!brief) return;
    try {
      setSpeaking(true);
      const url = await allen.speak(brief);
      const a = new Audio(url);
      a.onended = () => setSpeaking(false);
      await a.play();
    } catch {
      setSpeaking(false);
    }
  }

  return (
    <section className="panel brief-card">
      <div className="brief-head">
        <span className="brief-emoji">🤝</span>
        <div className="brief-title">
          <h2>ALLIE &amp; ALLEN</h2>
          <p className="muted">Your briefing for the {dp}.</p>
        </div>
        <div className="brief-actions">
          <button type="button" className="btn sm" onClick={() => void hear()} disabled={speaking || loading || !brief || !!err}>
            {speaking ? '🔊 …' : '🔊 Hear it'}
          </button>
          <button type="button" className="attach sm" onClick={() => void load()} disabled={loading}>
            ↻ Refresh
          </button>
        </div>
      </div>
      {loading ? (
        <p className="muted">ALLIE is prepping ALLEN’s notes…</p>
      ) : err ? (
        <p className="err">Briefing failed: {err}</p>
      ) : (
        <p className="brief-text">{brief}</p>
      )}
    </section>
  );
}
