# Contracts — moved

All system contracts have moved to [`rmg-piaar-system/contracts/`](https://github.com/RMoor-Industries-Ltd-Co/rmg-piaar-system/tree/main/contracts),
which is now the sole source of truth for contracts across the whole PIAAR ecosystem, not
just RMG Creator OS. This directory is **frozen and unmaintained** — the numbered files
still here (00-19) are historical snapshots that already predate rmg-piaar-system's
current set (through contract 22 and counting). Do not read them as current, and do not
add new contracts here — add them in `rmg-piaar-system/contracts/` instead.

---

**Pointer — Word Art (contract 29).** The Master Atelier Word Art / cinematic-caption engine
is specified in [`rmg-piaar-system/contracts/29-word-art.md`](https://github.com/RMoor-Industries-Ltd-Co/rmg-piaar-system/blob/main/contracts/29-word-art.md)
with per-concern child schemas under
[`contracts/word-art/`](https://github.com/RMoor-Industries-Ltd-Co/rmg-piaar-system/tree/main/contracts/word-art).
Its creator-os implementation architecture and the domain-vs-renderer decision live in this
repo at [`../architecture/01-word-art.md`](../architecture/01-word-art.md) and
[`../adr/0002-word-art-domain-vs-renderer.md`](../adr/0002-word-art-domain-vs-renderer.md).

**Reminder (Sprint 1 PR 5):** this directory's frozen status is a standing rule, not a one-time
note — see [`../atelier/release-boundary-checklist.md`](../atelier/release-boundary-checklist.md)
for the release-time check. Any new contract, canonical or otherwise, belongs in
`rmg-piaar-system/contracts/`.
