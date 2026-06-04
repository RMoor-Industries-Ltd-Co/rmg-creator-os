import { type Production } from './api';
import { ARoll } from './ARoll';
import { HiggsfieldPanel } from './HiggsfieldPanel';
import { StockBroll } from './StockBroll';
import { FinalCut } from './FinalCut';

/**
 * Generate — the production assembly line, in order:
 *   ① A-Roll      — lip-synced talking head from YOUR photo + voice (HeyGen). Hero.
 *   ② Scenes      — extra cinematic shots about the subject (Higgsfield, no lip-sync).
 *   ③ Stock B-Roll — free clips from Pexels + Pixabay via transcript keywords.
 *   →  Asset bin   — everything produced, collected.
 */
export function Generate({ p }: { p: Production }) {
  const directed = Boolean(p.taggedScript);
  return (
    <div className="generate">
      <div className="video-head">
        <strong>Generate</strong>
        <span className="badge">{directed ? 'voice: emotion-directed' : 'voice: brand default'}</span>
      </div>
      <p className="muted">
        ① Clean your photo into a still, ② animate it into the A-Roll (your face + voice — it stands
        alone), ③ pull stock b-roll. Then line everything up in the final cut.
      </p>

      <div className="stage-card">
        <HiggsfieldPanel p={p} />
      </div>
      <ARoll p={p} />
      <StockBroll p={p} />
      <FinalCut p={p} />
    </div>
  );
}
