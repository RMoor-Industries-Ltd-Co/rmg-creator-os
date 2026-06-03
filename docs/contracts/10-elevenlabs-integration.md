# Contract — ElevenLabs Integration (Voice)

- **Integration id:** `elevenlabs`
- **Status:** Planned — **access confirmed** (Creator plan, instant cloning enabled,
  `ELEVENLABS_API_KEY` stored on the control server)
- **Phase:** Creative (avatars & voice)
- **Owner:** Rahm Moore
- **Home:** `packages/integrations` (ElevenLabs client). Auth: `xi-api-key` header.
  Plan: Creator, 300k chars/mo.

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

## Interface (actual ElevenLabs API v1)
Auth header `xi-api-key`. Wrapped in a typed client; exposed via the gateway.

    POST /v1/voices/add            # multipart: name + sample files → { voice_id }  (instant clone)
    GET  /v1/voices                # list voices (premade + cloned)
    POST /v1/text-to-speech/{voice_id}   # { text, model_id, voice_settings } → audio (mp3)
    GET  /v1/user                  # subscription tier + character_count/limit (quota)

Client methods: `createVoice({name, samples})`, `listVoices()`,
`synthesize({voiceId, text, modelId?})`, `usage()`.

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
