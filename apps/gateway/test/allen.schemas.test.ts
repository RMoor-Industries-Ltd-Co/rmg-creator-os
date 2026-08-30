import { describe, it, expect } from 'vitest';
import {
  AllenDraftSchema,
  AllenDirectSchema,
  AllenMetadataSchema,
  parseAllen
} from '../src/allen.schemas.js';

describe('AllenDraftSchema', () => {
  it('accepts a full valid draft', () => {
    const out = AllenDraftSchema.parse({
      title: 'T',
      script: 'Hello world',
      model: 'claude-x',
      doc_url: 'https://d',
      doc_id: 'id'
    });
    expect(out.script).toBe('Hello world');
    expect(out.title).toBe('T');
  });

  it('accepts a valid-but-loose draft (only script) and defaults the rest', () => {
    const out = AllenDraftSchema.parse({ script: 'just a script' });
    expect(out).toMatchObject({ script: 'just a script', title: '', model: '' });
  });

  it('keeps unknown/extra keys (passthrough — new ALLEN fields never break)', () => {
    const out = AllenDraftSchema.parse({ script: 's', experimental_field: 42 }) as Record<string, unknown>;
    expect(out.experimental_field).toBe(42);
  });

  it('rejects a draft with no script (genuinely malformed)', () => {
    expect(AllenDraftSchema.safeParse({ title: 'T' }).success).toBe(false);
    expect(AllenDraftSchema.safeParse({ script: null }).success).toBe(false);
  });
});

describe('AllenDirectSchema', () => {
  it('accepts a full valid direct response', () => {
    const out = AllenDirectSchema.parse({
      tagged_script: '[warm] Hi',
      stability_mode: 'natural',
      stability: 0.7,
      audio_tag_palette: 'v3',
      version: 'v3'
    });
    expect(out.tagged_script).toBe('[warm] Hi');
    expect(out.stability).toBe(0.7);
  });

  it('coerces a numeric-string stability and defaults it when absent', () => {
    expect(AllenDirectSchema.parse({ tagged_script: 'x', stability: '0.4' }).stability).toBe(0.4);
    expect(AllenDirectSchema.parse({ tagged_script: 'x' }).stability).toBe(0.5);
  });

  it('rejects a missing tagged_script or a non-numeric stability', () => {
    expect(AllenDirectSchema.safeParse({ stability: 0.5 }).success).toBe(false);
    expect(AllenDirectSchema.safeParse({ tagged_script: 'x', stability: 'loud' }).success).toBe(false);
  });
});

describe('AllenMetadataSchema', () => {
  it('accepts full metadata and defaults hashtags to an empty array', () => {
    expect(AllenMetadataSchema.parse({ title: 'T', hashtags: ['#a', '#b'] }).hashtags).toEqual(['#a', '#b']);
    expect(AllenMetadataSchema.parse({}).hashtags).toEqual([]);
  });

  it('rejects hashtags that are not an array of strings (would crash downstream map/join)', () => {
    expect(AllenMetadataSchema.safeParse({ hashtags: '#a,#b' }).success).toBe(false);
    expect(AllenMetadataSchema.safeParse({ hashtags: [1, 2] }).success).toBe(false);
  });
});

describe('parseAllen', () => {
  it('returns typed data on success', () => {
    const out = parseAllen(AllenDraftSchema, { script: 's' }, 'draft');
    expect(out.script).toBe('s');
  });

  it('throws a clean, labeled error on malformed data (no raw payload dumped)', () => {
    expect(() => parseAllen(AllenDraftSchema, {}, 'draft')).toThrow(/ALLEN draft returned malformed data/);
    expect(() => parseAllen(AllenMetadataSchema, { hashtags: 'x' }, 'metadata')).toThrow(
      /ALLEN metadata returned malformed data/
    );
  });
});
