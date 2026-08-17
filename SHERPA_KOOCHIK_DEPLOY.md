# Koochik v27 deployment

Architecture: microphone -> hybrid Silero + energy hysteresis -> full captured utterance -> attenuation-only offline PCM conditioner -> Koochik non-streaming INT8.

The ASR model, tokens, sherpa version, and VAD model are unchanged from v26.

The conditioner targets only unusually hot frames. It never boosts quiet speech and never deletes the beginning of an utterance.

Energy-only capture is capped at 6 seconds when Silero never confirms speech; the ordinary hard limit remains 12 seconds.

Verify console markers after deploy:

- `adapter build=v27-offline-conditioner`
- worker ready with `build=v27-offline-conditioner`
- final log includes `rawRms`, `conditionedRms`, `rawPeak`, `conditionedPeak`, `minGain`, and `limitedFrames`.
