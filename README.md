# FoxiMed Voice v28 — Rizeh

This release replaces the 114M Koochik speech model with the 32M Shenava Rizeh
non-streaming INT8 model. It is intended for lower-memory phones and iOS PWAs
while preserving much better Persian accuracy than the tiny Pizeh model.

## What changed

- Silero's completed speech segment is retained and decoded. The previous worker
  discarded this clean segment and decoded the entire microphone session.
- The energy fallback now evaluates fixed 20 ms frames, so speech start/stop
  behavior is independent of browser audio callback size.
- Energy-only recognition decodes a conservative speech crop; it no longer
  applies the custom frame-by-frame gain conditioner.
- Releasing the model terminates the worker and resets all ready/loading state,
  allowing a clean reload without stale WASM objects.
- Microphone AGC and echo cancellation are disabled; noise suppression stays on.
- Broad command words such as “time”, “volume”, “to”, and “unit” no longer route
  clinical actions by themselves.
- Persian/Arabic letter variants and diacritics are normalized before routing.
- Ambiguous command scores are rejected instead of silently choosing one.
- Drug, dose, calculator, assessment, and clinical-value commands require a
  visible confirm/cancel tap before execution.
- The service worker removes the obsolete Koochik model cache after activation.

Expected first-download size is about 65 MB including the WASM runtime. The
exact browser memory footprint varies by browser and OS.

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
adapter build=v28-rizeh-segmented
```

## Model and safety notes

The Rizeh model is published under CC BY-NC 4.0. Confirm that this non-commercial
license fits the way FoxiMed is distributed. Voice recognition is an input aid,
not a clinical authority: nurses must verify the displayed transcript and all
patient-specific values before using a result.
