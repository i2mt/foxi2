# FoxiMed Voice — Rizeh offline Persian ASR

FoxiMed uses the 32M Shenava Rizeh INT8 model through sherpa-onnx WebAssembly.
It provides one consistent offline Persian voice path across desktop, Android,
and iOS browsers without depending on WebGPU or a browser speech service.

## What changed

- The experimental on-device Whisper Tiny/Base paths are no longer shipped or
  exposed in Settings because real Persian mobile tests favored tuned Rizeh.
- Rizeh receives microphone audio locally and keeps the captured recording on
  the device; only the initial model download needs internet.
- Silero's completed speech segment is retained and decoded. The previous worker
  discarded this clean segment and decoded the entire microphone session.
- The energy fallback now evaluates fixed 20 ms frames, so speech start/stop
  behavior is independent of browser audio callback size.
- Energy-only recognition decodes a conservative speech crop; it no longer
  applies the custom frame-by-frame gain conditioner.
- The sherpa-onnx build starts with 256 MB of WebAssembly memory instead of
  512 MB, reducing the initial pressure that caused iOS PWA termination.
- Once loaded, the model remains warm while switching app tabs.
- If offline startup fails and the browser supports Persian Web Speech, the UI
  offers a disclosed one-time online retry instead of sending speech silently.
- Microphone AGC and echo cancellation are disabled; noise suppression stays on.
- Broad command words such as “time”, “volume”, “to”, and “unit” no longer route
  clinical actions by themselves.
- Persian/Arabic letter variants and diacritics are normalized before routing.
- Ambiguous command scores are rejected instead of silently choosing one.
- Drug, dose, calculator, assessment, and clinical-value commands require a
  visible confirm/cancel tap before execution.
- The service worker removes the obsolete Koochik model cache after activation,
  and the Pages bundle excludes the old 51 MB Vosk archive.

Rizeh's expected first-download size is roughly 50–60 MB including its WASM
runtime.

## Deploy

Push the complete repository contents, including
`.github/workflows/pages-sherpa-koochik.yml`, to the default branch. The GitHub
Actions workflow downloads the official model and builds the sherpa-onnx v1.13.5
VAD + offline-ASR runtime for GitHub Pages. Generated `.data` and `.wasm`
files are deployment artifacts and do not need to be committed.

See [SHERPA_KOOCHIK_DEPLOY.md](SHERPA_KOOCHIK_DEPLOY.md) for the deployment and
device verification checklist.

## Verify locally

```bash
node tests/voice-pipeline-smoke.test.js
node --check koochik-worker.js
node --check koochik-asr.js
node --check voice-recognition.js
node --check voice-commands.js
node --check voice-ui.js
```

Expected console marker after deployment:

```text
adapter build=v34-rizeh-offline
```

## Model and safety notes

Rizeh is published under CC BY-NC 4.0. Review every dependency and model license
before commercial distribution. Voice recognition is an input aid, not a
clinical authority: nurses must verify the interpreted command and all
patient-specific values before using a result.
