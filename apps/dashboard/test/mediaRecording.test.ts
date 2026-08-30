import { describe, it, expect } from 'vitest';
import { extensionForMimeType } from '../src/mediaRecording';

// `extensionForMimeType` is pure (string in → extension out) and drives the filename
// Whisper receives, so a wrong mapping silently breaks transcription on some browsers.
// `pickRecorderMimeType` depends on the browser `MediaRecorder` global and is covered
// separately once a jsdom test project exists (see testing-conventions.md).

describe('extensionForMimeType', () => {
  it('maps mp4 / m4a containers to mp4', () => {
    expect(extensionForMimeType('audio/mp4')).toBe('mp4');
    expect(extensionForMimeType('video/mp4')).toBe('mp4');
    expect(extensionForMimeType('audio/m4a')).toBe('mp4');
  });

  it('maps mpeg / mp3 to mp3', () => {
    expect(extensionForMimeType('audio/mpeg')).toBe('mp3');
    expect(extensionForMimeType('audio/mp3')).toBe('mp3');
  });

  it('maps wav to wav', () => {
    expect(extensionForMimeType('audio/wav')).toBe('wav');
  });

  it('defaults to webm for webm, unknown, empty, and undefined', () => {
    expect(extensionForMimeType('audio/webm;codecs=opus')).toBe('webm');
    expect(extensionForMimeType('audio/ogg')).toBe('webm');
    expect(extensionForMimeType('')).toBe('webm');
    expect(extensionForMimeType(undefined)).toBe('webm');
  });

  it('is case-insensitive', () => {
    expect(extensionForMimeType('AUDIO/MP4')).toBe('mp4');
    expect(extensionForMimeType('Audio/MPEG')).toBe('mp3');
  });
});
