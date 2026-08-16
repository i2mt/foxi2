# FoxiMed Koochik v24

Persian voice input now uses a hybrid utterance controller with the existing full-context Koochik non-streaming INT8 recognizer.

- Silero VAD remains enabled.
- Energy-assisted speech start catches short commands that Silero sometimes misses.
- ~0.95 s trailing low-energy ends the utterance when Silero does not.
- 5 s no-speech timeout and 15 s hard safety cap prevent long open-mic sessions.
- Final ASR decodes a trimmed utterance with pre/post-roll instead of tens of seconds of silence.
- The first 350 ms is never discarded.
- Console capture logging is reduced to transitions/periodic checkpoints.
- Missing local Mitra font requests were removed; service-worker precache is best-effort.

The sherpa runtime/model are still built by `.github/workflows/pages-sherpa-koochik.yml`; generated large model assets are not included in this ZIP.
