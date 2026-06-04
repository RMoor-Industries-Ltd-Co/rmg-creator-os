import { useRef, useState } from 'react';
import { BRANDS } from '@rmg-creator-os/types';
import { productions, type Production } from './api';

const BRAND_OPTIONS = BRANDS.filter((b) => b.contentFolder).map((b) => ({ value: b.key, label: b.code }));

export function Produce() {
  const [brand, setBrand] = useState<string>(BRAND_OPTIONS[0]?.value ?? '');
  const [persona, setPersona] = useState('');
  const [topic, setTopic] = useState('');
  const [context, setContext] = useState('');
  const [fileName, setFileName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [production, setProduction] = useState<Production | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    if (f.type.startsWith('text/') || /\.(txt|md|csv|json)$/i.test(f.name)) {
      setContext(await f.text());
    } else {
      setContext(`[Attached reference: ${f.name} — non-text; describe its relevance in the request above.]`);
    }
  }

  async function submit() {
    setError(null);
    if (!brand || !topic.trim()) {
      setError('Pick a brand and enter your request.');
      return;
    }
    setSubmitting(true);
    setProduction(null);
    setAudioUrl(null);
    try {
      const p = await productions.create({
        brand,
        topic: topic.trim(),
        persona: persona.trim() || undefined,
        context: context.trim() || undefined
      });
      setProduction(p);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  }

  async function hear() {
    if (!production) return;
    setSpeaking(true);
    setError(null);
    try {
      setAudioUrl(await productions.speak(production.id));
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setSpeaking(false);
    }
  }

  return (
    <div className="produce">
      <section className="panel">
        <h2>New production — ask ALLEN</h2>
        <p className="muted">Describe what you want. ALLEN writes it in the brand voice and saves a draft to Drive.</p>

        <div className="intake-meta">
          <label>
            Brand
            <select value={brand} onChange={(e) => setBrand(e.target.value)}>
              {BRAND_OPTIONS.map((b) => (
                <option key={b.value} value={b.value}>{b.label}</option>
              ))}
            </select>
          </label>
          <label>
            Persona (optional)
            <input type="text" placeholder="e.g. Coach Rahm" value={persona} onChange={(e) => setPersona(e.target.value)} />
          </label>
        </div>

        <textarea
          className="intake-box"
          rows={7}
          placeholder="What should we create? A topic, an angle, a brief…"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
        />

        <div className="intake-actions">
          <button className="attach" onClick={() => fileRef.current?.click()} type="button">
            📎 {fileName || 'Add reference file'}
          </button>
          <input ref={fileRef} type="file" hidden onChange={onFile} />
          <button className="btn" onClick={submit} disabled={submitting}>
            {submitting ? 'ALLEN is writing…' : 'Submit'}
          </button>
        </div>
        {error && <p className="err">{error}</p>}
      </section>

      {production && (
        <section className="panel">
          <div className="video-head">
            <strong>{production.title}</strong>
            <span className="badge">{production.brand} · {production.scriptStatus}</span>
          </div>
          <textarea className="script-view" rows={14} readOnly value={production.scriptText ?? ''} />
          <div className="intake-actions">
            <button className="btn" onClick={hear} disabled={speaking}>
              {speaking ? 'Synthesizing…' : '▶ Hear it'}
            </button>
            {production.scriptDocUrl && (
              <a className="drive-link" href={production.scriptDocUrl} target="_blank" rel="noreferrer">
                Open Drive draft ↗
              </a>
            )}
            <span className="muted">model: {production.model}</span>
          </div>
          {audioUrl && <audio controls src={audioUrl} style={{ width: '100%', marginTop: 10 }} />}
        </section>
      )}
    </div>
  );
}
