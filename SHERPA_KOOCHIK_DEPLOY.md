# Koochik streaming ASR deployment

FoxiMed now uses **Shenava Koochik v1.0 (114M), streaming CTC, INT8** through the official **sherpa-onnx WebAssembly** runtime.

## Why GitHub Actions is required

The model is about 132 MB, so it should not be committed as a normal Git file. sherpa-onnx's browser ASR build uses Emscripten `--preload-file`, which packages the model and `tokens.txt` into `sherpa-onnx-wasm-main-asr.data`.

The included workflow:

`.github/workflows/pages-sherpa-koochik.yml`

builds that runtime on GitHub's runner and deploys the generated site to GitHub Pages. The large generated `.data` file never enters your Git history.

## One-time GitHub setting

In the repository, open **Settings → Pages → Build and deployment → Source** and select **GitHub Actions**.

Then push to the `main` branch (or run the workflow manually from the Actions tab).

## Expected deployed runtime files

The workflow generates:

- `sherpa-koochik/sherpa-onnx-asr.js`
- `sherpa-koochik/sherpa-onnx-wasm-main-asr.js`
- `sherpa-koochik/sherpa-onnx-wasm-main-asr.wasm`
- `sherpa-koochik/sherpa-onnx-wasm-main-asr.data` (contains Koochik + tokens)

## Expected console sequence

On first Voice-tab preload:

```
[KoochikASR] sherpa status: Downloading data... (.../...)
[KoochikASR] sherpa WASM runtime initialized
[KoochikASR] sherpa recognizer ready: model=Koochik-v1.0-streaming-int8 ...
```

During speech, FoxiMed feeds microphone Float32 PCM directly into sherpa. sherpa handles resampling, fbank features, FastConformer streaming caches, CTC decoding, and endpoint detection.

## Model/license

Model source:
`mah92/sherpa-onnx-nemo-ctc-fa-shenava-koochik-v1.0-streaming-int8-2026-06-26`

The model card declares CC-BY-NC-4.0. Check that license against your intended deployment/use before production distribution.


## v16 microphone contract

The browser adapter now requests a 16 kHz AudioContext and defensively converts any 44.1/48 kHz PCM to 16 kHz before calling sherpa `acceptWaveform()`. This matches sherpa-onnx's browser ASR example and the Shenava model author's test path. Decode logs include input/model peak and RMS values for validation.
