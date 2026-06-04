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

/**
 * Render a slideshow: each image scaled/cropped to WxH, shown for an equal slice
 * of the audio duration, muxed with the audio. Output is a web-ready mp4.
 */
export async function composeSlideshow(opts: {
  imagePaths: string[];
  audioPath: string;
  outPath: string;
  width: number;
  height: number;
}): Promise<void> {
  const { imagePaths, audioPath, outPath, width, height } = opts;
  if (imagePaths.length === 0) throw new Error('compose: at least one image is required');

  const dur = (await audioDuration(audioPath)) || imagePaths.length * 4;
  const per = Math.max(2, dur / imagePaths.length);

  const inputs: string[] = [];
  for (const p of imagePaths) inputs.push('-loop', '1', '-t', per.toFixed(3), '-i', p);
  inputs.push('-i', audioPath);
  const audioIndex = imagePaths.length;

  // Per-image: cover-fit to WxH, square pixels, constant fps.
  const vf = (i: number) =>
    `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,` +
    `crop=${width}:${height},setsar=1,fps=30,format=yuv420p[v${i}]`;
  const chains = imagePaths.map((_, i) => vf(i));
  let filter: string;
  if (imagePaths.length === 1) {
    filter = `${chains[0]}`;
  } else {
    const labels = imagePaths.map((_, i) => `[v${i}]`).join('');
    filter = `${chains.join(';')};${labels}concat=n=${imagePaths.length}:v=1:a=0[v]`;
  }
  const vlabel = imagePaths.length === 1 ? '[v0]' : '[v]';

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
