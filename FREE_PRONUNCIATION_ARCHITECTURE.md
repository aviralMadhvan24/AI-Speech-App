# Free Pronunciation Assessment Architecture

Goal:

Build the strongest possible pronunciation assessment path without paid APIs.

## Chosen Approach

Use a local acoustic pronunciation pipeline:

```text
audio
  -> preprocessing
  -> ASR transcript for helper context
  -> expected text to canonical phonemes
  -> acoustic pronunciation model / GOP features
  -> word and phoneme scores
  -> student feedback
```

Whisper must not be the pronunciation judge. Whisper can still help with:

- transcript display
- wrong sentence detection
- missing or extra words
- fallback feedback

## Best Free Stack

### 1. Current fallback: local transcript and rules provider

Provider:

```text
PRONUNCIATION_PROVIDER=local
```

Use this for demos and early testing. It catches:

- wrong words
- missing words
- visibly different transcript variants
- known cases like `design -> degien`, `specific -> pacific`, `world -> word`
- silent-letter coaching for `subtle`, `debt`, `doubt`, etc.

Limitation:

If Whisper autocorrects a bad pronunciation into the expected word, this provider may miss it.

### 2. Target free provider: local acoustic provider

Provider:

```text
PRONUNCIATION_PROVIDER=local_acoustic
```

This provider should use one of these free research-grade paths:

1. GOPT-style pronunciation assessment model.
2. GOP scoring using acoustic model logits.
3. Wav2Vec2/HuBERT phoneme recognizer plus phoneme alignment.

Preferred target:

```text
GOPT + SpeechOcean762-style scoring
```

Reason:

- It is built specifically for pronunciation assessment.
- It supports multiple granularities such as phoneme, word, and utterance scores.
- It has pretrained/research code available.
- SpeechOcean762 is a free pronunciation assessment dataset with human labels.

## Implementation Stages

### Stage A: Keep reliable fallback

- Keep `local` provider active by default.
- Keep all feedback clearly labeled as local/free assessment.
- Never claim full acoustic assessment unless `local_acoustic` is active.

### Stage B: Add offline acoustic model wrapper

Create:

```text
app/pronunciation/providers/local_acoustic.py
app/pronunciation/acoustic/
```

The wrapper should:

- load the model once
- accept processed WAV at 16 kHz mono
- accept expected text
- return `PronunciationResult`
- fail gracefully if model files are missing

Current adapter expects GOPT files here:

```text
models/pronunciation/gopt/
```

Setup helper:

```powershell
.\scripts\setup_gopt.ps1
```

For each processed WAV, GOPT feature extraction must create:

```text
temp/gopt_features/<processed_audio_stem>_feat.npy
temp/gopt_features/<processed_audio_stem>_phn.npy
```

Example:

```text
temp/processed_abc.wav
temp/gopt_features/processed_abc_feat.npy
temp/gopt_features/processed_abc_phn.npy
```

The GOPT adapter can then load:

```text
models/pronunciation/gopt/pretrained_models/gopt_librispeech/best_audio_model.pth
```

and return acoustic utterance, word, and phone scores.

### Stage C: Add model assets outside git

Model files should not be committed to git.

Use:

```text
models/pronunciation/
```

Expected files can be downloaded manually or by a setup script later.

### Stage D: Calibrate on local dataset

Use:

```text
tests/pronunciation/sample_cases.json
```

Then expand it with real recordings:

- correct pronunciation
- known wrong pronunciation
- Indian English accent variations
- noisy recordings
- phone/laptop microphone recordings

## Result Policy

The app may show:

- `available: true`
- provider name
- model/version
- word scores
- phoneme errors
- feedback

Only when the active provider has real acoustic evidence.

If only transcript/rules are available, feedback must say that clearly.

## Best Free Accuracy Rule

Free accuracy improves through calibration, not just code.

Minimum useful dataset:

```text
30-50 labeled recordings
```

Better dataset:

```text
200+ labeled recordings across speakers, microphones, and accents
```

## References

- GOPT official implementation: https://github.com/YuanGongND/gopt
- SpeechOcean762 dataset: https://www.openslr.org/101/
- Montreal Forced Aligner: https://montreal-forced-aligner.readthedocs.io/
- Wav2Vec2Phoneme docs: https://huggingface.co/docs/transformers/model_doc/wav2vec2_phoneme

### Stage E: API contract & minimal spec

- Provider entrypoint: `app.pronunciation.providers.local_acoustic.assess(audio_path, expected_text)`
- Input: 16 kHz mono WAV file path (processed) and expected text string.
- Output: `PronunciationResult` (JSON-serializable) with these fields:

```json
{
  "available": true,
  "provider": "local_acoustic",
  "model": "gopt_librispeech/best_audio_model.pth",
  "utterance_score": 0.87,
  "words": [
    {"word":"design","score":0.95,"phonemes":[{"phn":"d","score":0.98}, ...]},
    ...
  ],
  "phoneme_errors": [
    {"word_index":2,"phn_index":1,"expected":"t","observed":"d","confidence":0.2}
  ],
  "diagnostics": {"gopt_feature_path":"temp/gopt_features/processed_abc_feat.npy"}
}
```

- If model files are missing or provider unavailable: return `available: false` and `provider: local` or `provider: local_acoustic` with `model: null` and clear message in `diagnostics`.

### Minimal file layout and integration points

- Doc and adapter: `app/pronunciation/providers/local_acoustic.py` (wrapper, graceful failure)
- Model assets: `models/pronunciation/gopt/` (gitignored)
- Feature cache: `temp/gopt_features/`
- Tests: `tests/pronunciation/` (sample_cases.json, unit tests)

### Quick setup & run (developer notes)

1. Run the setup helper to fetch or prepare GOPT assets:

```powershell
.\scripts\setup_gopt.ps1
```

2. Process audio into a 16 kHz mono WAV using existing preprocessing pipeline (`app/audio/preprocessing.py`).

3. Extract features (GOPT) or compute phoneme alignments; place outputs in `temp/gopt_features/`.

4. Call the provider from the app layer using expected text.

### Testing and calibration

- Unit tests should assert that the provider returns the `PronunciationResult` shape and handles missing models.
- Integration tests in `tests/pronunciation/` should include: one correct, one common-mispronunciation, and one noisy case.
- Use `tests/pronunciation/sample_cases.json` as ground truth for scoring calibration.

### Ops playbook (summary)

- See `docs/ops_playbook.md` for a complete deployment and runbook for Kaldi GOP + GOPT.
- Dev helper scripts: `scripts/run_kaldi_gop.py` (prints expected inputs) and `scripts/build_kaldi.sh` (Kaldi build helper).
- Docker scaffolding: `docker/gopt_scoring/Dockerfile`, `docker/kaldi_worker/Dockerfile`, and `docker/compose.kaldi.yml`.

---

Appendix: keep all feedback explicitly labeled as "local/free" unless validated acoustic evidence is present.
