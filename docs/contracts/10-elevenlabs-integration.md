# Contract — ElevenLabs Integration (Voice)

- **Integration id:** `elevenlabs`
- **Status:** Planned
- **Phase:** Creative (avatars & voice)
- **Owner:** Rahm Moore
- **Home:** `packages/integrations` (ElevenLabs client)

## Mission
Create and manage a **cloned voice profile per character**, and synthesize scripts to
**audio** in that voice — the audio track HeyGen lip-syncs the avatar to.

## Inputs
- Voice sample audio for a character (to create/clone the voice).
- A text script + a character's `elevenVoiceId` (to synthesize speech).

## Outputs
- A persistent **voice id** per character (`elevenVoiceId`).
- Synthesized **audio** (file/URL) of a given script in that voice.

## Responsibilities (in scope)
- Create/clone a voice from samples; list/manage voices.
- Text-to-speech: script → audio in the character's voice.
- Provide the audio to the Character Pipeline for HeyGen's `voice.type: "audio"` input.

## Out of scope (for now)
- Avatar/visual (Higgsfield/HeyGen).
- Scriptwriting (A.L.L.E.N).
- Long-term audio storage (Drive).

## Dependencies
- **External:** ElevenLabs API + account/key.
- **Consumers:** Character Pipeline (gateway), A.L.L.E.N (future: speech I/O may share voices).
- **Data:** Postgres (`characters.elevenVoiceId`, `voiceSource`); Drive (samples + rendered audio).

## Interface (high-level, proposed)
- `createVoice({ name, samples })` → `{ voiceId }`
- `listVoices()` → `Voice[]`
- `synthesize({ voiceId, text, modelId?, format? })` → `{ audioUrl | audioBytes }`

## Brands / characters touched
One voice per Character; Characters are brand-scoped.

## Success criteria
A few voice clips yield a stable voice id, and any script can be synthesized to natural
audio that HeyGen accepts as the talking track.

## Open questions / risks
- Cloning tier/permissions on the ElevenLabs plan (instant vs. professional cloning).
- Best hand-off to HeyGen: hosted `audio_url` vs. uploading an audio asset to HeyGen.
- Cost per minute of synthesis; caching synthesized audio to avoid re-spend.
- Consent/likeness record for each cloned voice.
