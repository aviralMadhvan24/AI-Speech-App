End-to-end: HF phoneme fallback (developer steps)

Goal: run the app using the Hugging Face phoneme fallback provider when GOPT/Kaldi not available.

1) Install dependencies

```bash
python -m venv venv
. venv/bin/activate    # or venv\Scripts\Activate.ps1 on Windows PowerShell
pip install -r requirements.txt
```

2) Set environment variables (example using a phoneme-aware HF model if you have one):

```bash
export PRONUNCIATION_PROVIDER=hf_phoneme
export HF_PHONEME_MODEL_NAME=your-phoneme-model-name
```

If you don't have a phoneme-specific HF model, you can still set `PRONUNCIATION_PROVIDER=hf_phoneme` and the system will use the provided transcription (from Whisper) to map observed phonemes via `cmudict`.

3) Run the app

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

4) Send an analyze request using `curl` (example):

```bash
curl -X POST "http://localhost:8000/analyze" -F "file=@/path/to/audio.wav" -F "expected_text=The design is subtle"
```

Response will include `pronunciation` field with `available`, `provider`, `overall_score`, and `words` array.

Notes:
- For production accuracy, prefer the Kaldi GOP + GOPT stack; HF fallback is useful for quick CPU-based checks.
- If using a large HF model, prefer GPU for reasonable latency.
