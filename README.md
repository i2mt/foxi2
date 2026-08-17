# FoxiMed Koochik v27

Koochik v27 keeps the v26 hybrid Silero + energy-hysteresis endpoint controller and the same non-streaming INT8 Koochik model.

Changes in v27:

- Adds an attenuation-only offline PCM conditioner before the final Koochik decode.
- Preserves the complete utterance; no leading audio is discarded.
- Only over-hot 20 ms frames are reduced; normal/quiet speech is never boosted.
- Adds a 6-second cap for energy-only sessions when Silero never confirms speech.
- Logs raw/conditioned RMS, peak, minimum gain, and number of limited frames.
- Keeps explicit cache-busting/version markers.

Expected console marker: `build=v27-offline-conditioner`.
