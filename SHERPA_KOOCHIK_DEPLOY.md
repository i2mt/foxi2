# Rizeh v29 deployment and verification

## Runtime architecture

```text
microphone
  -> 16 kHz resampling in a Dedicated Worker
  -> Silero VAD + fixed 20 ms energy fallback
  -> retained Silero segment (or conservative energy crop)
  -> one Rizeh 32M INT8 offline decode
  -> safer command scoring
  -> explicit confirmation for clinical actions
```

The source path remains `sherpa-koochik/` for backward-compatible URLs and
service-worker behavior. The model inside that runtime is now Shenava Rizeh.

## GitHub Pages deployment

1. Replace the repository contents with this package while preserving the
   `.github` directory.
2. Commit and push to `main` or `master`.
3. In GitHub repository settings, set Pages source to **GitHub Actions**.
4. Open the **Build FoxiMed + Rizeh sherpa-onnx** workflow and wait for both the
   build and deploy jobs to finish.
5. Reload the PWA. Accept the update banner if an older service worker is active.

The workflow pins:

- sherpa-onnx: `v1.13.5`
- Emscripten: `4.0.23`
- ASR: Shenava Rizeh v1.0 non-streaming INT8
- Rizeh revision and SHA-256 checksums
- VAD: Silero VAD
- initial WebAssembly memory: 256 MB with growth enabled

The workflow must generate these files in the deployed
`sherpa-koochik/` directory:

- `sherpa-onnx-asr.js`
- `sherpa-onnx-vad.js`
- `sherpa-onnx-wasm-main-vad-asr.js`
- `sherpa-onnx-wasm-main-vad-asr.wasm`
- `sherpa-onnx-wasm-main-vad-asr.data`

## Browser verification

Open the browser console and confirm:

- `adapter build=v30-rizeh-adaptive`
- worker ready reports `Rizeh-v1.0-non-streaming-int8`
- final logs report `decodeSource=silero-segments` for ordinary speech
- model download is roughly 50–60 MB, not the old ~145 MB payload
- leaving and returning to Voice keeps the ready worker warm
- a simulated offline-engine failure offers a disclosed online retry only when
  the browser is online and supports Web Speech

The first activation deletes obsolete `FoxiMed_Model_*` caches, including the
old cache whose Rizeh-looking name actually contained the Koochik build. The
new cache name includes the pinned Rizeh revision; JavaScript-only releases do
not redownload it.

## Ward test checklist

Test with the actual iPhone SE 2020 PWA and at least one newer Android device.
Use real ward noise at safe, representative levels.

1. Say a short navigation command such as “دارو”.
2. Say “BMI وزن ۷۰ قد ۱۷۰”; verify that no calculation runs before confirmation.
3. Say “قطره ۵۰۰ میلی‌لیتر در ۸ ساعت”; compare every displayed value before
   confirming.
4. Say a drug-dose command using two easily confused drug names.
5. Say only “ساعت ۸” and only “به ۲۰”; neither phrase should launch a clinical
   calculator.
6. Cancel a clinical confirmation and verify that no result or form value changes.
7. Enable low-power mode, leave Voice, return, and confirm recognition resumes
   without another model initialization.
8. Test denial of microphone permission, offline reload after one successful
   download, and a manual stop during speech.
9. Simulate an offline-engine load failure; confirm that online retry requires a
   tap and clearly states that speech is sent to the browser service.

Automated smoke coverage is in `tests/voice-pipeline-smoke.test.js`. It checks
fixed-frame endpoint behavior, retained-segment selection, worker destroy/reload,
normalization, broad-trigger rejection, ambiguity handling, and clinical
confirmation routing.

## Important limitation

Passing automated checks proves the JavaScript paths behave as intended; it does
not prove clinical speech accuracy in every ward. Before production use, build a
de-identified validation set of the exact commands, drug names, accents, devices,
and ward-noise conditions you support. Do not record patient identifiers.
