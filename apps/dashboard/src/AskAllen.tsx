import { useEffect, useRef, useState } from 'react';
import { BRANDS } from '@rmg-creator-os/types';
import { allen, type ChatTurn, type Memory } from './api';

const BRAND_OPTIONS = [{ value: '', label: 'No brand voice' }].concat(
  BRANDS.filter((b) => b.contentFolder).map((b) => ({ value: b.key, label: b.code }))
);

const STARTERS = [
  'What should we make this week?',
  "Give me a hook for an ORR cruise review.",
  'What is BU$Y_MF supposed to feel like?',
  'Help me plan a Rahm Council episode.'
];

// Voice gate — passphrases (case/punctuation tolerant; profanity may be mis-transcribed,
// so the halt match keys on "i know you …" + "lying" rather than the exact words).
const WAKE_RE = /\b(hey,?\s*allen|reddington|what it be like)\b/i;
const HALT_RE = /\bi\s+know\s+you\b[\s\S]*\blying\b/i;
const stripWake = (t: string): string => t.replace(WAKE_RE, '').replace(/^[\s,.!?–—-]+/, '').trim();

export function AskAllen() {
  const [brand, setBrand] = useState('');
  const [input, setInput] = useState('');
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState<number | null>(null);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [memInput, setMemInput] = useState('');
  const [showMem, setShowMem] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [copied, setCopied] = useState<number | null>(null);
  const [dormant, setDormant] = useState(() => localStorage.getItem('allen_dormant') === '1');

  function setGate(d: boolean) {
    setDormant(d);
    localStorage.setItem('allen_dormant', d ? '1' : '0');
    if (!d) setError(null);
  }

  // Route a spoken/transcribed line through the passphrase gate before it becomes a message.
  function routeVoiceText(text: string) {
    const t = text.trim();
    if (!t) return;
    if (HALT_RE.test(t)) {
      setGate(true);
      if (recording) recRef.current?.stop();
      return;
    }
    if (dormant) {
      if (WAKE_RE.test(t)) {
        setGate(false);
        const rest = stripWake(t);
        if (rest) setInput((c) => (c.trim() ? c.trim() + ' ' : '') + rest);
      }
      return; // dormant: ignore everything except the wake phrase
    }
    const body = WAKE_RE.test(t) ? stripWake(t) : t;
    if (body) setInput((c) => (c.trim() ? c.trim() + ' ' : '') + body);
  }

  async function copyReply(text: string, idx: number) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(idx);
      setTimeout(() => setCopied((c) => (c === idx ? null : c)), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, busy]);

  useEffect(() => {
    allen.memories(brand || undefined).then((r) => setMemories(r.memories)).catch(() => undefined);
  }, [brand]);

  async function toggleMic() {
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
          // Gate first (wake/halt), otherwise land the transcript in the input to edit before sending.
          routeVoiceText(text);
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

  async function addMemory() {
    const content = memInput.trim();
    if (!content) return;
    try {
      const m = await allen.addMemory(content, brand || undefined);
      setMemories((cur) => [m, ...cur]);
      setMemInput('');
    } catch (e: unknown) {
      setError(String(e));
    }
  }

  async function removeMemory(id: string) {
    try {
      await allen.deleteMemory(id);
      setMemories((cur) => cur.filter((m) => m.id !== id));
    } catch {
      /* ignore */
    }
  }

  async function saveEdit(m: Memory) {
    const content = editText.trim();
    if (!content) return;
    try {
      const updated = await allen.updateMemory(m.id, content, m.brand);
      setMemories((cur) => cur.map((x) => (x.id === m.id ? updated : x)));
      setEditId(null);
    } catch (e: unknown) {
      setError(String(e));
    }
  }

  async function remember(text: string) {
    try {
      const m = await allen.addMemory(text, brand || undefined);
      setMemories((cur) => [m, ...cur]);
      setShowMem(true);
    } catch (e: unknown) {
      setError(String(e));
    }
  }

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
    if (dormant) {
      // Dormant: only the wake phrase gets through.
      if (WAKE_RE.test(message)) {
        setGate(false);
        const rest = stripWake(message);
        setInput(rest);
      }
      return;
    }
    setError(null);
    setInput('');
    const history = turns.slice(-8);
    const next = [...turns, { role: 'user', content: message } as ChatTurn];
    setTurns(next);
    setBusy(true);
    try {
      const { reply, memoryChanged } = await allen.chat({ message, brand: brand || undefined, history });
      const idx = next.length; // index of the assistant turn we're about to add
      setTurns([...next, { role: 'assistant', content: reply }]);
      if (memoryChanged) {
        allen.memories(brand || undefined).then((r) => setMemories(r.memories)).catch(() => undefined);
        setShowMem(true);
      }
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
          <button type="button" className="attach sm" onClick={() => setShowMem((s) => !s)}>
            🧠 Memory ({memories.length})
          </button>
          <button
            type="button"
            className={`gate-chip ${dormant ? 'dormant' : 'active'}`}
            onClick={() => setGate(!dormant)}
            title={dormant ? "Tap to wake (or say 'Hey ALLEN')" : 'Tap to make ALLEN dormant'}
          >
            {dormant ? '🔴 Dormant' : '🟢 Active'}
          </button>
          <select value={brand} onChange={(e) => setBrand(e.target.value)}>
            {BRAND_OPTIONS.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {showMem && (
        <div className="memory-panel">
          <div className="mem-add">
            <input
              type="text"
              placeholder={`Teach ALLEN something${brand ? ` about ${brand}` : ''}… (e.g. "We post ORR on Tuesdays")`}
              value={memInput}
              onChange={(e) => setMemInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addMemory()}
            />
            <button type="button" className="btn sm" onClick={addMemory} disabled={!memInput.trim()}>
              Commit
            </button>
          </div>
          {memories.length === 0 ? (
            <p className="muted hint">No memories yet. Anything you commit here, ALLEN recalls in every chat.</p>
          ) : (
            <ul className="mem-list">
              {memories.map((m) => (
                <li key={m.id}>
                  {editId === m.id ? (
                    <input
                      className="mem-edit"
                      autoFocus
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveEdit(m);
                        if (e.key === 'Escape') setEditId(null);
                      }}
                      onBlur={() => saveEdit(m)}
                    />
                  ) : (
                    <span>
                      {m.brand && <span className="mem-tag">{m.brand}</span>} {m.content}
                      {m.source === 'allen' && <span className="mem-tag allen">via ALLEN</span>}
                    </span>
                  )}
                  <span className="mem-actions">
                    <button
                      type="button"
                      className="mem-del"
                      onClick={() => {
                        setEditId(m.id);
                        setEditText(m.content);
                      }}
                      title="Edit / overwrite"
                    >
                      ✎
                    </button>
                    <button type="button" className="mem-del" onClick={() => removeMemory(m.id)} title="Forget">
                      ✕
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

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
              <div className="bubble-actions">
                <button
                  type="button"
                  className="speak-btn"
                  onClick={() => speak(t.content, i)}
                  disabled={speaking === i}
                >
                  {speaking === i ? '🔊 Speaking…' : '🔊 Replay'}
                </button>
                <button type="button" className="speak-btn" onClick={() => copyReply(t.content, i)} title="Copy to clipboard">
                  {copied === i ? '✓ Copied' : '📋 Copy'}
                </button>
                <button type="button" className="speak-btn" onClick={() => remember(t.content)} title="Save to ALLEN's memory">
                  🧠 Remember
                </button>
              </div>
            )}
          </div>
        ))}
        {busy && <div className="bubble assistant"><div className="bubble-role">ALLEN</div><div className="bubble-text muted">thinking…</div></div>}
        <div ref={endRef} />
      </div>

      {error && <p className="error">{error}</p>}

      {dormant && (
        <div className="dormant-banner">
          🔴 ALLEN is dormant — he won’t respond to anyone. Say <strong>“Hey ALLEN”</strong> (🎙️) to wake him.
          <button type="button" className="btn sm" onClick={() => setGate(false)}>
            Wake
          </button>
        </div>
      )}

      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <button
          type="button"
          className={`mic-btn ${recording ? 'rec' : ''}`}
          onClick={toggleMic}
          disabled={transcribing || busy}
          title={recording ? 'Stop' : dormant ? "Say 'Hey ALLEN' to wake him" : 'Tap to talk'}
        >
          {recording ? '⏺ Stop' : transcribing ? '…' : '🎙️'}
        </button>
        <input
          type="text"
          placeholder={
            dormant ? 'Dormant — say “Hey ALLEN”' : recording ? 'Listening…' : transcribing ? 'Transcribing…' : 'Ask ALLEN…'
          }
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy || recording || dormant}
        />
        <button type="submit" className="btn" disabled={busy || !input.trim() || dormant}>
          Send
        </button>
      </form>
      <audio ref={audioRef} hidden />
    </section>
  );
}
