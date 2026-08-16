# Koochik v25 deployment

Deploy the whole repository, including the hidden `.github/workflows/pages-sherpa-koochik.yml` file.

The workflow builds the same sherpa-onnx v1.13.5 VAD + offline-ASR runtime used by v23 and downloads:

- Koochik v1.0 non-streaming INT8 (`nemo-ctc.onnx`)
- matching `tokens.txt`
- Silero VAD

v25 changes only browser-side utterance control; it does not change the Koochik model.

Expected console behavior for a short phrase:

1. `capture ... energy=true` or `silero=true`
2. `endpoint=true reason=energy-silence` or `reason=silero`
3. `sherpa worker final ... text=...`

If no speech is detected, capture ends after about 5 seconds instead of staying open indefinitely. The outer session safety cap is 15 seconds.


## v25 cache-consistency note

Voice-path JavaScript and the worker are loaded with explicit `?v=25` cache-busting URLs, and the service worker is registered with `updateViaCache: "none"`. The console prints `build=v25-hybrid-cachebust` so mixed/stale deployments are immediately visible. The large Koochik/VAD model cache remains unchanged and is not intentionally re-downloaded by this app-shell revision.
