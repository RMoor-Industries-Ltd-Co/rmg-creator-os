// Thin client for the isolated ALLEN service (PIAAR/rmg-ai), reached at ALLEN_URL.

const ALLEN_URL = process.env.ALLEN_URL ?? '';

export const allenConfigured = (): boolean => Boolean(ALLEN_URL);

export interface AllenDraft {
  title: string;
  script: string;
  doc_url?: string;
  doc_id?: string;
  model: string;
}

export async function allenDraft(body: {
  brand: string;
  topic: string;
  persona?: string;
  output_kind?: string;
  allie_context?: string;
  write_doc?: boolean;
}): Promise<AllenDraft> {
  const res = await fetch(`${ALLEN_URL}/draft`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const json = (await res.json().catch(() => ({}))) as AllenDraft & { detail?: string };
  if (!res.ok) throw new Error(json.detail ?? `ALLEN draft failed (${res.status})`);
  return json;
}

export async function allenSpeak(text: string, voiceId?: string): Promise<Buffer> {
  const res = await fetch(`${ALLEN_URL}/speak`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice_id: voiceId })
  });
  if (!res.ok) throw new Error(`ALLEN speak failed (${res.status}): ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}
