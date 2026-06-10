import { useRef, useState } from 'react';
import { BRANDS } from '@rmg-creator-os/types';
import { productions, type TopicSuggestion } from './api';
import { ProductionList } from './ProductionList';
import { navigate } from './router';

const BRAND_OPTIONS = BRANDS.filter((b) => b.contentFolder).map((b) => ({ value: b.key, label: b.code }));

export function Produce() {
  const [brand, setBrand] = useState<string>(BRAND_OPTIONS[0]?.value ?? '');
  const [persona, setPersona] = useState('');
  const [topic, setTopic] = useState('');
  const [context, setContext] = useState('');
  const [fileName, setFileName] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<TopicSuggestion[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function suggestTopics() {
    setSuggesting(true);
    setError(null);
    try {
      const r = await productions.topics(brand, 6);
      setSuggestions(r.topics);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setSuggesting(false);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setNotice(null);
    const isText = f.type.startsWith('text/') || /\.(txt|md|csv|json|rtf)$/i.test(f.name);
    if (isText) {
      setFileName(f.name);
      setContext(await f.text());
    } else {
      // Images/video don't write the script — they're visual inputs for Assets.
      setFileName('');
      e.target.value = '';
      setNotice(
        `“${f.name}” looks like an image/video. ALLEN writes the script from text only — ` +
          `add visuals later in the Assets step (they route to Higgsfield / My Poster).`
      );
    }
  }

  async function submit() {
    setError(null);
    if (!brand || !topic.trim()) {
      setError('Pick a brand and enter your request.');
      return;
    }
    setSubmitting(true);
    try {
      const p = await productions.create({
        brand,
        topic: topic.trim(),
        persona: persona.trim() || undefined,
        context: context.trim() || undefined
      });
      navigate(`/produce/${p.id}/script`);
    } catch (e: unknown) {
      setError(String(e));
      setSubmitting(false);
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
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
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

        <div className="allie-suggest">
          <button type="button" className="attach" onClick={suggestTopics} disabled={suggesting}>
            {suggesting ? 'ALLIE is thinking…' : `✨ Ask ALLIE for ${BRAND_OPTIONS.find((b) => b.value === brand)?.label ?? ''} topics`}
          </button>
          {suggestions.length > 0 && (
            <ul className="topic-cards">
              {suggestions.map((t, i) => (
                <li key={i} className="topic-card">
                  <div className="topic-main">
                    <strong>{t.title}</strong>
                    {t.hook && <span className="topic-hook">“{t.hook}”</span>}
                    {t.angle && <span className="muted topic-angle">{t.angle}</span>}
                  </div>
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => {
                      setTopic(t.title);
                      if (t.hook || t.angle) setContext([t.hook, t.angle].filter(Boolean).join(' — '));
                    }}
                  >
                    Use →
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="intake-actions">
          <button className="attach" onClick={() => fileRef.current?.click()} type="button">
            📎 {fileName || 'Add reference notes (text)'}
          </button>
          <input
            ref={fileRef}
            type="file"
            hidden
            accept=".txt,.md,.csv,.json,.rtf,text/*"
            onChange={onFile}
          />
          <button className="btn" onClick={submit} disabled={submitting}>
            {submitting ? 'ALLEN is writing…' : 'Submit'}
          </button>
        </div>
        <p className="muted hint">
          Reference notes are briefs/transcripts that inform the script. Images &amp; video are
          added later in the Assets step.
        </p>
        {notice && <p className="notice">{notice}</p>}
        {error && <p className="err">{error}</p>}
      </section>

      <ProductionList />
    </div>
  );
}
