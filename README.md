FoxiMed Koochik v22 — stable microphone input

Changes in this build:
- Uses Koochik v1.0 non-streaming INT8 + Silero VAD through sherpa-onnx in a dedicated Web Worker.
- Requests raw microphone capture for Koochik: echo cancellation, noise suppression, and browser automatic gain control are disabled.
- Adds an attenuation-only input stabilizer in the worker. Hot chunks are reduced immediately; quiet/normal chunks are never boosted.
- Logs rawPeak/rawRms, levelGain, targetGain, modelPeak/modelRms for diagnosis.
- Keeps the stable model/runtime CacheStorage cache and normalizes the cache key for .data/.wasm assets so query-string changes do not invalidate the large model payload.
- App-shell service-worker cache: FoxiMed_v5.0.19.


## Koochik ASR architecture (v23)

Voice recognition now uses Silero VAD plus the full-context non-streaming Koochik v1.0 INT8 sherpa-onnx export. Live streaming CTC is no longer used for the final transcript. The first 350 ms of microphone audio is no longer discarded.
