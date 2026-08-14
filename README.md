FoxiMed Koochik v21 — stable microphone input

Changes in this build:
- Keeps Koochik v1.0 streaming INT8 + sherpa-onnx in a dedicated Web Worker.
- Requests raw microphone capture for Koochik: echo cancellation, noise suppression, and browser automatic gain control are disabled.
- Adds an attenuation-only input stabilizer in the worker. Hot chunks are reduced immediately; quiet/normal chunks are never boosted.
- Logs rawPeak/rawRms, levelGain, targetGain, modelPeak/modelRms for diagnosis.
- Keeps the stable model/runtime CacheStorage cache and normalizes the cache key for .data/.wasm assets so query-string changes do not invalidate the large model payload.
- App-shell service-worker cache: FoxiMed_v5.0.18.
- No Vosk assets or runtime.
