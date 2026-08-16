# FoxiMed Koochik v26

Persian voice input uses the existing full-context Koochik non-streaming INT8 recognizer with a revised hybrid Silero + energy utterance controller.

- Koochik model/runtime is unchanged from v25.
- Silero remains the primary speech detector.
- Energy-assisted start catches short commands that Silero sometimes misses.
- Silero endpoints are now treated as candidates: they cannot cut the utterance while energy still looks voice-like.
- Energy tail detection uses utterance-relative hysteresis instead of v25's fixed low threshold, so steady room noise around RMS 0.027-0.030 does not keep the microphone open.
- ~0.8 s trailing low-energy ends an utterance when Silero does not.
- 4.5 s no-speech timeout and 12 s hard safety cap prevent long open-mic sessions.
- Final ASR receives the complete short captured utterance; v25's start/end trimming was removed.
- The first 350 ms is never discarded.
- Voice-path files use explicit `?v=26` cache-busting URLs.
- Console build marker: `build=v26-noise-hysteresis`.

The sherpa runtime/model are built by `.github/workflows/pages-sherpa-koochik.yml`; generated large model assets are not included in this ZIP.

Deploy the whole repository, including the hidden `.github/workflows` directory.
