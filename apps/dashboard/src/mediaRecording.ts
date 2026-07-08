// Shared helper for browser voice-dictation features (chat mic, script dictate, etc).
// Different browsers record different containers via MediaRecorder — Chrome/Firefox/
// Android typically produce audio/webm (Opus); Safari/iOS doesn't support webm at all
// and produces audio/mp4 (AAC) instead. Whisper accepts both, but only if the filename
// extension sent with the upload actually matches what was recorded — a mismatched
// label (e.g. calling an mp4 recording "speech.webm") can fail to transcribe.

const CANDIDATE_MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/mpeg'];

// Ask the browser which of our candidate formats it can actually record, best first.
// Returns undefined if MediaRecorder can't report support (falls back to browser default).
export function pickRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return undefined;
  }
  return CANDIDATE_MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
}

// Map a recorded mimeType back to a filename extension Whisper recognizes.
export function extensionForMimeType(mimeType: string | undefined): string {
  const t = (mimeType || '').toLowerCase();
  if (t.includes('mp4') || t.includes('m4a')) return 'mp4';
  if (t.includes('mpeg') || t.includes('mp3')) return 'mp3';
  if (t.includes('wav')) return 'wav';
  return 'webm';
}
