# Contract — A.L.L.E.N

- **Service id:** `allen`
- **Status:** Planned
- **Phase:** Intelligence
- **Owner:** Rahm Moore

## Mission
The speech-enabled interface to the company LLM — the "brain" of the suite. Over time,
ALLEN owns **scriptwriting and brand-voice generation**, producing copy that matches
each brand's tone from topics, briefs, or conversation.

## Inputs
- Voice or text prompts from the operator (speech-enabled).
- Topic/brief + target brand voice.
- Knowledge/context supplied by **A.L.L.I.E** (RSS, deep research, personal library).

## Outputs
- Brand-voiced scripts, captions, hooks, CTAs, post copy, ad copy.
- Conversational responses (speech in / speech + text out).
- Structured creative briefs the gateway can route into a Recipe.

## Responsibilities (in scope)
- Speech I/O (STT in, TTS out) over the company LLM.
- Brand-voice modeling per brand (VLOG, COM, The Rahm Council, Royal Reservations, BU$Y_MF).
- Drafting + revising scripts/copy on request.

## Out of scope (for now)
- Knowledge gathering/research (that is ALLIE's job — ALLEN consumes its context).
- Final model selection (deferred — choose the best fit for the intended brain later).
- Video/graphic production (Story Director / My Poster).

## Dependencies
- **Services:** ALLIE (knowledge/context), gateway (briefs/jobs), Story Director + My Poster (consumers of scripts/copy).
- **Integrations / external:** STT + TTS providers; LLM inference host (TBD).
- **Models / AI:** company LLM (TBD); voice models.
- **Data:** Postgres (voice profiles, prompt history); Drive/Docs (drafts).

## Interface (high-level)
- **Exposes:** `POST /draft` (brief → brand-voiced copy), speech session endpoints.
- **Consumes:** ALLIE knowledge context; brand-voice profiles.

## Brands / stores touched
All brand voices.

## Success criteria
Speak a topic and a brand → receive a script that reads authentically in that brand's
voice and is ready to route into a video or graphic.

## Open questions
- Which LLM / hosting for the brain (cost, privacy, on-prem vs. API)?
- STT/TTS providers and latency targets for live speech.
- How brand voice is encoded (fine-tune, system prompts, retrieval, or hybrid)?
