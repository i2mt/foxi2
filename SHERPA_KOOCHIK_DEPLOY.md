# Koochik v26 deployment

Deploy the whole repository, including the hidden `.github/workflows/pages-sherpa-koochik.yml` file.

The workflow builds the same sherpa-onnx v1.13.5 VAD + offline-ASR runtime used by v25 and downloads:

- Koochik v1.0 non-streaming INT8 (`nemo-ctc.onnx`)
- matching `tokens.txt`
- Silero VAD

v26 changes browser-side utterance control only; it does not change the Koochik ASR model.

Expected console markers:

1. `adapter build=v26-noise-hysteresis`
2. `VAD=Silero+energy-hysteresis`
3. capture lines with `sileroNow`, `energyNow`, and `holdRms`
4. `endpoint=true reason=energy-silence` or `reason=silero`
5. `sherpa worker final ... text=...`

Endpoint policy:

- about 0.8 s trailing low energy after detected speech
- about 4.5 s timeout when no speech is detected
- 12 s absolute worker safety cap

The final offline decode receives the complete captured short utterance rather than a trimmed subrange.

Voice-path JavaScript and the worker use explicit `?v=26` URLs. The service worker is registered with `updateViaCache: "none"` so stale workers do not get mixed with a new page build.
