// Custom video assembly with ffmpeg — the operator's own images + their own voice
// (no generic avatar). Builds a slideshow timed to the audio track.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const pexec = promisify(execFile);

/** Audio length in seconds (ffprobe). */
export async function audioDuration(audioPath: string): Promise<number> {
  const { stdout } = await pexec('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=nw=1:nk=1',
    audioPath
  ]);
  const d = parseFloat(stdout.trim());
  return Number.isFinite(d) && d > 0 ? d : 0;
}

export interface Segment {
  type: 'image' | 'video';
  path: string;
}

/**
 * Render a sequence of segments (image slides and/or video b-roll clips), each
 * scaled/cropped to WxH for an equal slice of the audio duration, muxed with the
 * voice track. Output is a web-ready mp4.
 */
export async function composeSequence(opts: {
  segments: Segment[];
  audioPath: string;
  outPath: string;
  width: number;
  height: number;
}): Promise<void> {
  const { segments, audioPath, outPath, width, height } = opts;
  if (segments.length === 0) throw new Error('compose: at least one segment is required');

  const dur = (await audioDuration(audioPath)) || segments.length * 4;
  const per = Math.max(2, dur / segments.length);

  const inputs: string[] = [];
  for (const s of segments) {
    if (s.type === 'image') {
      inputs.push('-loop', '1', '-t', per.toFixed(3), '-i', s.path);
    } else {
      // Loop short clips so each fills its slot; trim to the slot length.
      inputs.push('-stream_loop', '-1', '-t', per.toFixed(3), '-i', s.path);
    }
  }
  inputs.push('-i', audioPath);
  const audioIndex = segments.length;

  // Per-segment: cover-fit to WxH, square pixels, constant fps, normalized PTS.
  const chain = (i: number) =>
    `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,` +
    `crop=${width}:${height},setsar=1,fps=30,format=yuv420p,setpts=PTS-STARTPTS[v${i}]`;
  const chains = segments.map((_, i) => chain(i));
  let filter: string;
  if (segments.length === 1) {
    filter = chains[0];
  } else {
    const labels = segments.map((_, i) => `[v${i}]`).join('');
    filter = `${chains.join(';')};${labels}concat=n=${segments.length}:v=1:a=0[v]`;
  }
  const vlabel = segments.length === 1 ? '[v0]' : '[v]';

  const args = [
    '-y',
    ...inputs,
    '-filter_complex',
    filter,
    '-map',
    vlabel,
    '-map',
    `${audioIndex}:a`,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-shortest',
    '-movflags',
    '+faststart',
    outPath
  ];
  await pexec('ffmpeg', args, { maxBuffer: 16 * 1024 * 1024, timeout: 300_000 });
}

/** Convenience: all-image slideshow. */
export async function composeSlideshow(opts: {
  imagePaths: string[];
  audioPath: string;
  outPath: string;
  width: number;
  height: number;
}): Promise<void> {
  await composeSequence({
    segments: opts.imagePaths.map((path) => ({ type: 'image', path })),
    audioPath: opts.audioPath,
    outPath: opts.outPath,
    width: opts.width,
    height: opts.height
  });
}
