-- Script page: dictate + dual-version ElevenLabs enhancement
-- (v2: caps + punctuation only; v3: bracket tags + caps), plus a persistent
-- one-take-per-version voice render, overwritten (pointer swap) on regenerate.
ALTER TABLE productions
  ADD COLUMN IF NOT EXISTS tagged_script_v2 text,
  ADD COLUMN IF NOT EXISTS voice_take_asset_id_v2 text,
  ADD COLUMN IF NOT EXISTS voice_take_asset_id_v3 text;
