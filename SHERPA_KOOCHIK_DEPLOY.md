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


## v21 live worker behavior

v21 contains no same-PCM replay diagnostics in the live sherpa worker. The v18 controlled test already proved identical PCM decodes deterministically. Keeping replay work in the same worker caused later microphone utterances to queue for several seconds.

The worker now only accepts live PCM, performs streaming decode, finalizes the utterance, and immediately becomes available for the next microphone session.

## Persistent Koochik download cache

The large `sherpa-onnx-wasm-main-asr.data` and `.wasm` files use a separate stable CacheStorage cache named for the Koochik model + sherpa runtime. Normal FoxiMed app-shell version bumps do not delete this cache. A user upgrading from v17 can need one last full model download because earlier releases intentionally bypassed CacheStorage for the large files. Subsequent app-only updates should reuse the cached model unless site data is cleared/evicted or the model/runtime cache version is intentionally changed.


## v21 microphone-level stabilization

Koochik capture requests echoCancellation=false, noiseSuppression=false, and autoGainControl=false. The worker also applies attenuation-only protection with peak ceiling 0.12 and RMS ceiling 0.05; it never amplifies quiet audio. Console logs include rawPeak/rawRms, levelGain, targetGain, and modelPeak/modelRms.
