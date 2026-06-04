import { type Production } from './api';
import { ARoll } from './ARoll';
import { HiggsfieldPanel } from './HiggsfieldPanel';
import { StockBroll } from './StockBroll';
import { AssetBin } from './AssetBin';
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
        Build the A-Roll first (your face, your voice — it stands alone), then multiply it with extra
        scenes and stock b-roll. Everything collects in your asset bin at the bottom.
      </p>

      <ARoll p={p} />
      <div className="stage-card">
        <HiggsfieldPanel p={p} />
      </div>
      <StockBroll p={p} />
      <AssetBin p={p} />
      <FinalCut p={p} />
    </div>
  );
}
