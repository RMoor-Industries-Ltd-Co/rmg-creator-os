import { useEffect, useRef, useState } from 'react';
import { productions, allen, type Production } from './api';
import { navigate } from './router';
import { VoiceDirection } from './VoiceDirection';
import { Assets } from './Assets';
import { HiggsfieldPanel } from './HiggsfieldPanel';
import { ARoll } from './ARoll';
import { StockBroll } from './StockBroll';
import { AtelierBroll } from './AtelierBroll';
import { FinalCut } from './FinalCut';
import { Post } from './Post';

// One visible progression from topic to publish. The four "build" steps
// (scenes → a-roll → b-roll → final cut) were previously hidden inside a
// single "Generate" page; the backend still tracks them under one coarse
// `generate` stage (see ProductionList.resumeStep).
export const STEPS = [
  { key: 'script', label: 'Script' },
  { key: 'voice', label: 'Voice' },
  { key: 'assets', label: 'Assets' },
  { key: 'scenes', label: 'Scenes' },
  { key: 'aroll', label: 'A-roll' },
  { key: 'broll', label: 'B-roll' },
  { key: 'finalcut', label: 'Final cut' },
  { key: 'post', label: 'Publish' }
] as const;

export function ProductionWizard({ id, step }: { id: string; step: string }) {
  const [p, setP] = useState<Production | null>(null);
  const [brollTab, setBrollTab] = useState<'stock' | 'atelier'>('stock');
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [version, setVersion] = useState(0);
  const [scriptDraft, setScriptDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [enhancing, setEnhancing] = useState<'' | 'v2' | 'v3' | 'both'>('');

  // Script tabs: plain script + the two ElevenLabs enhancement versions.
  const [scriptTab, setScriptTab] = useState<'original' | 'v2' | 'v3'>('original');
  const [taggedDraftV2, setTaggedDraftV2] = useState<string | null>(null);
  const [taggedDraftV3, setTaggedDraftV3] = useState<string | null>(null);
  const [savingTagged, setSavingTagged] = useState<'' | 'v2' | 'v3'>('');
  const [speakingVersion, setSpeakingVersion] = useState<'' | 'v2' | 'v3'>('');
  const [audioUrlV2, setAudioUrlV2] = useState<string | null>(null);
  const [audioUrlV3, setAudioUrlV3] = useState<string | null>(null);

  // Dictation — record, transcribe via Whisper, drop the result into the plain script.
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    productions.get(id).then((prod) => {
      setP(prod);
      setScriptDraft(null);
      setTaggedDraftV2(null);
      setTaggedDraftV3(null);
      setAudioUrlV2(null);
      setAudioUrlV3(null);
    }).catch((e: unknown) => setError(String(e)));
  }, [id]);

  const idx = Math.max(0, STEPS.findIndex((s) => s.key === step));
  const go = (i: number) => {
    if (i >= 0 && i < STEPS.length) navigate(`/produce/${id}/${STEPS[i].key}`);
  };

  async function saveScript() {
    if (!p || scriptDraft === null) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await productions.saveScript(p.id, scriptDraft);
      setP(updated);
      setScriptDraft(null);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function hear() {
    if (!p) return;
    setSpeaking(true);
    setError(null);
    try {
      const { url } = await productions.speak(p.id);
      setAudioUrl(url);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setSpeaking(false);
    }
  }

  // Enhance processes the CURRENT plain script once — if there are unsaved edits
  // (typed or dictated), save them first so tagging works off exactly what's shown.
  async function enhanceVersion(target: 'v2' | 'v3' | 'both') {
    if (!p) return;
    setEnhancing(target);
    setError(null);
    try {
      let current = p;
      if (scriptDraft !== null) {
        current = await productions.saveScript(p.id, scriptDraft);
        setP(current);
        setScriptDraft(null);
      }
      if (target === 'v2' || target === 'both') {
        current = await productions.direct(current.id, { voiceBrand: current.brand, version: 'v2' });
        setP(current);
        setTaggedDraftV2(null);
      }
      if (target === 'v3' || target === 'both') {
        current = await productions.direct(current.id, { voiceBrand: current.brand, version: 'v3' });
        setP(current);
        setTaggedDraftV3(null);
      }
      setScriptTab(target === 'v2' ? 'v2' : 'v3');
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setEnhancing('');
    }
  }

  async function saveTagged(v: 'v2' | 'v3') {
    if (!p) return;
    const draft = v === 'v2' ? taggedDraftV2 : taggedDraftV3;
    if (draft === null) return;
    setSavingTagged(v);
    setError(null);
    try {
      const updated = await productions.saveTaggedScript(p.id, v, draft);
      setP(updated);
      if (v === 'v2') setTaggedDraftV2(null);
      else setTaggedDraftV3(null);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setSavingTagged('');
    }
  }

  // Generate re-processes whatever's currently in that version's editor — saved or not.
  async function generateVersion(v: 'v2' | 'v3') {
    if (!p) return;
    const draft = v === 'v2' ? taggedDraftV2 : taggedDraftV3;
    const text = draft ?? (v === 'v2' ? p.taggedScriptV2 : p.taggedScript) ?? undefined;
    if (!text) return;
    setSpeakingVersion(v);
    setError(null);
    try {
      const { url } = await productions.speak(p.id, { directed: true, version: v, text });
      if (v === 'v2') setAudioUrlV2(url);
      else setAudioUrlV3(url);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setSpeakingVersion('');
    }
  }

  async function toggleDictate() {
    if (recording) {
      recRef.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        if (blob.size < 1200) return;
        setTranscribing(true);
        try {
          const { text } = await allen.listen(blob);
          if (text.trim()) setScriptDraft(text);
        } catch (e: unknown) {
          setError(String(e));
        } finally {
          setTranscribing(false);
        }
      };
      recRef.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      setError('Microphone access denied or unavailable.');
    }
  }

  return (
    <div className="wizard">
      <ol className="stepper">
        {STEPS.map((s, i) => (
          <li key={s.key} className={i === idx ? 'active' : i < idx ? 'done' : ''}>
            <button onClick={() => go(i)}>
              <span className="step-num">{i + 1}</span> {s.label}
            </button>
          </li>
        ))}
      </ol>

      {error && <p className="err">{error}</p>}
      {!p && !error && <p className="muted">Loading production…</p>}

      {p && (
        <section className="panel" key={version}>
          {step === 'script' ? (
            <>
              <div className="video-head">
                <strong>{p.title}</strong>
                <span className="badge">
                  {p.brand}
                  {p.persona ? ` · ${p.persona}` : ''} · {p.scriptStatus}
                </span>
              </div>

              <div className="tab-bar">
                <button
                  className={`tab ${scriptTab === 'original' ? 'active' : ''}`}
                  onClick={() => setScriptTab('original')}
                >
                  Original
                </button>
                <button className={`tab ${scriptTab === 'v2' ? 'active' : ''}`} onClick={() => setScriptTab('v2')}>
                  v2{p.taggedScriptV2 ? '' : ' (not yet)'}
                </button>
                <button className={`tab ${scriptTab === 'v3' ? 'active' : ''}`} onClick={() => setScriptTab('v3')}>
                  v3{p.taggedScript ? '' : ' (not yet)'}
                </button>
              </div>

              {scriptTab === 'original' && (
                <>
                  <textarea
                    className="script-view"
                    rows={14}
                    value={scriptDraft ?? p.scriptText ?? ''}
                    onChange={(e) => setScriptDraft(e.target.value)}
                  />
                  {scriptDraft !== null && (
                    <div className="intake-actions">
                      <button className="btn" onClick={() => void saveScript()} disabled={saving}>
                        {saving ? 'Saving…' : '✓ Save edits'}
                      </button>
                      <button className="attach" onClick={() => setScriptDraft(null)} disabled={saving}>
                        Discard
                      </button>
                    </div>
                  )}
                  <div className="intake-actions">
                    <button className="btn" onClick={hear} disabled={speaking || Boolean(enhancing)}>
                      {speaking ? 'Synthesizing…' : '▶ Hear it'}
                    </button>
                    <button
                      className={`mic-btn ${recording ? 'rec' : ''}`}
                      onClick={() => void toggleDictate()}
                      disabled={transcribing}
                      title={recording ? 'Stop dictating' : 'Dictate the script'}
                    >
                      {recording ? '⏺ Stop' : transcribing ? '…' : '🎙 Dictate'}
                    </button>
                    {p.scriptDocUrl && (
                      <a className="drive-link" href={p.scriptDocUrl} target="_blank" rel="noreferrer">
                        Open Drive draft ↗
                      </a>
                    )}
                    <span className="muted">model: {p.model}</span>
                  </div>
                  {audioUrl && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
                      <audio controls src={audioUrl} style={{ flex: 1 }} />
                      <a className="btn ghost" href={audioUrl} download={`${p.id.slice(0, 8)}_plain.mp3`}>
                        ⬇ Download
                      </a>
                    </div>
                  )}
                  <div className="intake-actions" style={{ marginTop: 16 }}>
                    <button className="btn ghost" onClick={() => void enhanceVersion('v2')} disabled={Boolean(enhancing) || speaking}>
                      {enhancing === 'v2' ? 'Enhancing…' : '✨ Enhance v2'}
                    </button>
                    <button className="btn ghost" onClick={() => void enhanceVersion('v3')} disabled={Boolean(enhancing) || speaking}>
                      {enhancing === 'v3' ? 'Enhancing…' : '✨ Enhance v3'}
                    </button>
                    <button className="btn" onClick={() => void enhanceVersion('both')} disabled={Boolean(enhancing) || speaking}>
                      {enhancing === 'both' ? 'Enhancing…' : '✨ Enhance v2/v3'}
                    </button>
                  </div>
                  <p className="muted" style={{ marginTop: 6 }}>
                    Enhance processes the script above once it's ready — dictate or type first, then enhance.
                  </p>
                </>
              )}

              {(scriptTab === 'v2' || scriptTab === 'v3') && (() => {
                const v = scriptTab as 'v2' | 'v3';
                const stored = v === 'v2' ? p.taggedScriptV2 : p.taggedScript;
                const draft = v === 'v2' ? taggedDraftV2 : taggedDraftV3;
                const setDraft = v === 'v2' ? setTaggedDraftV2 : setTaggedDraftV3;
                const audio = v === 'v2' ? audioUrlV2 : audioUrlV3;
                const label = v === 'v2' ? 'ElevenLabs v2 — caps + punctuation only' : 'ElevenLabs v3 — bracket tags + caps';
                if (stored === null && draft === null) {
                  return (
                    <p className="muted" style={{ marginTop: 12 }}>
                      Not yet enhanced. Go to the Original tab and click "Enhance {v}".
                    </p>
                  );
                }
                return (
                  <>
                    <label className="vd-label" style={{ marginTop: 16 }}>
                      ✨ Enhanced for {label}
                    </label>
                    <textarea
                      className="script-view tagged"
                      rows={10}
                      value={draft ?? stored ?? ''}
                      onChange={(e) => setDraft(e.target.value)}
                    />
                    <div className="intake-actions">
                      {draft !== null && (
                        <button className="btn" onClick={() => void saveTagged(v)} disabled={savingTagged === v}>
                          {savingTagged === v ? 'Saving…' : '✓ Save edits'}
                        </button>
                      )}
                      <button
                        className="btn ghost"
                        onClick={() => void generateVersion(v)}
                        disabled={speakingVersion === v}
                      >
                        {speakingVersion === v ? 'Synthesizing…' : '▶ Generate'}
                      </button>
                      <button className="btn" onClick={() => go(idx + 1)}>
                        Next → Voice direction
                      </button>
                    </div>
                    {audio && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
                        <audio controls src={audio} style={{ flex: 1 }} />
                        <a className="btn ghost" href={audio} download={`${p.id.slice(0, 8)}_${v}.mp3`}>
                          ⬇ Download
                        </a>
                      </div>
                    )}
                  </>
                );
              })()}
            </>
          ) : step === 'voice' ? (
            <VoiceDirection p={p} onUpdate={setP} onLocked={() => go(idx + 1)} />
          ) : step === 'assets' ? (
            <Assets p={p} />
          ) : step === 'scenes' ? (
            <div className="stage-card">
              <HiggsfieldPanel p={p} />
            </div>
          ) : step === 'aroll' ? (
            <ARoll p={p} />
          ) : step === 'broll' ? (
            <>
              <div className="tab-bar">
                <button
                  className={`tab ${brollTab === 'stock' ? 'active' : ''}`}
                  onClick={() => setBrollTab('stock')}
                >
                  Stock (Pexels / Pixabay)
                </button>
                <button
                  className={`tab ${brollTab === 'atelier' ? 'active' : ''}`}
                  onClick={() => setBrollTab('atelier')}
                >
                  Atelier (AI-generated)
                </button>
              </div>
              {brollTab === 'stock' ? (
                <StockBroll p={p} />
              ) : (
                <AtelierBroll productionId={p.id} />
              )}
            </>
          ) : step === 'finalcut' ? (
            <FinalCut p={p} />
          ) : step === 'post' ? (
            <Post p={p} />
          ) : (
            <div className="stage-ph">
              <h2>{STEPS[idx].label}</h2>
              <p className="muted">
                This stage is coming soon (see contract 13 — Production Wizard). The route is live so
                we can build straight into it.
              </p>
            </div>
          )}
        </section>
      )}

      <div className="wizard-nav">
        <button className="attach" onClick={() => go(idx - 1)} disabled={idx === 0}>
          ← Back
        </button>
        <button className="attach" onClick={() => setVersion((v) => v + 1)} title="Restart this step with a fresh panel">
          ↺ New version
        </button>
        {idx < STEPS.length - 1 && (
          <button className="btn" onClick={() => go(idx + 1)}>
            Next →
          </button>
        )}
      </div>
    </div>
  );
}
