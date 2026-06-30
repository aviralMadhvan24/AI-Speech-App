Calibration & Testing — Pronunciation Scoring

Purpose

This document describes how to run calibration experiments and add labeled cases for tuning GOPT/Kaldi thresholds.

Fixtures

- `tests/pronunciation/sample_cases.json` contains canonical cases and known pronunciation errors. Add real recordings under `tests/pronunciation/audio/` and reference them by path.

Calibration steps

1. Collect dataset
   - Aim for 200+ labeled recordings across accents and devices.
   - For each recording, capture: `expected_text`, `speaker_id`, `device`, `noise_level`, and `labels` (word_scores, phoneme_errors).

2. Run the pipeline end-to-end for your dataset
   - Ensure Kaldi GOP features exist for each audio (use Kaldi worker or manual conversion).
   - Run GOPT scoring to generate `PronunciationResult`.

3. Evaluate thresholds
   - For each phoneme and word, compute ROC/precision-recall against human labels.
   - Select thresholds that balance false positives (over-flagging) and false negatives (missing mistakes).

4. Store calibration mapping
   - Persist mapping of `phoneme -> threshold` and `word -> threshold` in a calibration file (JSON) and load in production.

Local test commands

Run pytest for the pronunciation tests:

```bash
python -m venv venv
. venv/bin/activate
pip install -r requirements.txt
pytest tests/pronunciation -q
```

Notes

- Kaldi steps require Linux and suitable resources. Use WSL for development but run production on Linux.
- If Kaldi is not available, use the Hugging Face phoneme-recognizer fallback for approximate calibration.
