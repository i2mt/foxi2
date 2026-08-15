# Koochik deployment (v23)

FoxiMed now uses sherpa-onnx v1.13.5 WebAssembly in **VAD + non-streaming ASR** mode.

Runtime flow:

1. Browser microphone audio is captured from the first callback (no fixed 350 ms discard).
2. Audio is converted to 16 kHz mono and sent to a Dedicated Worker.
3. Silero VAD detects speech and trailing silence.
4. When the utterance ends, the worker runs one full-context Koochik v1.0 INT8 decode over the captured utterance.
5. The final Persian transcript is returned to the existing VoiceEngine/UI API.

The GitHub Actions workflow downloads:

- `mah92/sherpa-onnx-nemo-ctc-fa-shenava-koochik-v1.0-non-streaming-int8-2026-06-26`
- sherpa-onnx `silero_vad.onnx`

and builds them into sherpa-onnx's official `wasm/vad-asr` bundle.

Generated Pages assets are placed under `sherpa-koochik/`:

- `sherpa-onnx-asr.js`
- `sherpa-onnx-vad.js`
- `sherpa-onnx-wasm-main-vad-asr.js`
- `sherpa-onnx-wasm-main-vad-asr.wasm`
- `sherpa-onnx-wasm-main-vad-asr.data`

The large `.data/.wasm` files use a model cache name independent of the normal FoxiMed app-shell version.
