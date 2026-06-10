import { useEffect, useRef, useState } from 'react';
import { BRANDS } from '@rmg-creator-os/types';
import { allen, type ChatTurn } from './api';

const BRAND_OPTIONS = [{ value: '', label: 'No brand voice' }].concat(
  BRANDS.filter((b) => b.contentFolder).map((b) => ({ value: b.key, label: b.code }))
);

const STARTERS = [
  'What should we make this week?',
  "Give me a hook for an ORR cruise review.",
  'What is BU$Y_MF supposed to feel like?',
  'Help me plan a Rahm Council episode.'
];

export function AskAllen() {
  const [brand, setBrand] = useState('');
  const [input, setInput] = useState('');
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState<number | null>(null);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, busy]);

  async function speak(text: string, idx: number) {
    try {
      setSpeaking(idx);
      const url = await allen.speak(text, undefined);
      if (audioRef.current) {
        audioRef.current.src = url;
        audioRef.current.onended = () => setSpeaking(null);
        await audioRef.current.play();
      }
    } catch {
      setSpeaking(null);
    }
  }

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setError(null);
    setInput('');
    const history = turns.slice(-8);
    const next = [...turns, { role: 'user', content: message } as ChatTurn];
    setTurns(next);
    setBusy(true);
    try {
      const { reply } = await allen.chat({ message, brand: brand || undefined, history });
      const idx = next.length; // index of the assistant turn we're about to add
      setTurns([...next, { role: 'assistant', content: reply }]);
      if (autoSpeak) void speak(reply, idx);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ask-allen">
      <div className="ask-head">
        <div>
          <h2>Ask ALLEN</h2>
          <p className="muted">Talk to the brain. ALLEN answers out loud in the ElevenLabs voice.</p>
        </div>
        <div className="ask-controls">
          <label className="trend-toggle" title="Auto-play ALLEN's voice">
            <input type="checkbox" checked={autoSpeak} onChange={(e) => setAutoSpeak(e.target.checked)} />
            🔊 Speak replies
          </label>
          <select value={brand} onChange={(e) => setBrand(e.target.value)}>
            {BRAND_OPTIONS.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="chat-log">
        {turns.length === 0 && (
          <div className="chat-empty">
            <p className="muted">Ask ALLEN anything about your brands, topics, or the pipeline.</p>
            <div className="starters">
              {STARTERS.map((s) => (
                <button key={s} type="button" className="starter" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={`bubble ${t.role}`}>
            <div className="bubble-role">{t.role === 'user' ? 'You' : 'ALLEN'}</div>
            <div className="bubble-text">{t.content}</div>
            {t.role === 'assistant' && (
              <button
                type="button"
                className="speak-btn"
                onClick={() => speak(t.content, i)}
                disabled={speaking === i}
              >
                {speaking === i ? '🔊 Speaking…' : '🔊 Replay'}
              </button>
            )}
          </div>
        ))}
        {busy && <div className="bubble assistant"><div className="bubble-role">ALLEN</div><div className="bubble-text muted">thinking…</div></div>}
        <div ref={endRef} />
      </div>

      {error && <p className="error">{error}</p>}

      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input
          type="text"
          placeholder="Ask ALLEN…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
        />
        <button type="submit" className="btn" disabled={busy || !input.trim()}>
          Send
        </button>
      </form>
      <audio ref={audioRef} hidden />
    </section>
  );
}
