# Koochik v24 deployment

Deploy the whole repository, including the hidden `.github/workflows/pages-sherpa-koochik.yml` file.

The workflow builds the same sherpa-onnx v1.13.5 VAD + offline-ASR runtime used by v23 and downloads:

- Koochik v1.0 non-streaming INT8 (`nemo-ctc.onnx`)
- matching `tokens.txt`
- Silero VAD

v24 changes only browser-side utterance control; it does not change the Koochik model.

Expected console behavior for a short phrase:

1. `capture ... energy=true` or `silero=true`
2. `endpoint=true reason=energy-silence` or `reason=silero`
3. `sherpa worker final ... text=...`

If no speech is detected, capture ends after about 5 seconds instead of staying open indefinitely. The outer session safety cap is 15 seconds.
