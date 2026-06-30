Kaldi GOP Feature Extraction - Guidance

This project expects GOPT-compatible feature files to live under `temp/gopt_features/`:

  <analysis_id>_feat.npy
  <analysis_id>_phn.npy

The repository provides `app.pronunciation.acoustic.KaldiGopFeaturePipeline` which prepares a Kaldi-style workspace for each processed WAV and expects a configured `KALDI_GOP_COMMAND` to generate the numpy feature files.

Recommended workflows:

1) Local/manual (recommended for experimentation):
   - Prepare the Kaldi workspace created at `temp/kaldi_gop/<analysis_id>/`.
   - Run your Kaldi/GOP recipe to produce per-utterance features and phone arrays.
   - Convert outputs to numpy and place them at `temp/gopt_features/<analysis_id>_feat.npy` and `temp/gopt_features/<analysis_id>_phn.npy`.

2) Automated wrapper (when Kaldi is installed):
   - Implement a shell script or Python script that reads the environment variables set by `KaldiGopFeaturePipeline` (e.g. `GOP_WORK_DIR`, `GOP_ANALYSIS_ID`, `GOP_FEATURE_PATH`, `GOP_PHONE_PATH`) and runs Kaldi commands.
   - Set `KALDI_GOP_COMMAND` (env or settings) to point to that wrapper.

Quick example (pseudo-steps inside your wrapper):

  # compute features
  compute-mfcc-feats --config=conf/mfcc.conf scp:${GOP_WORK_DIR}/wav.scp ark:- | \
      copy-feats ark:- ark,scp:${GOP_WORK_DIR}/feats.ark,${GOP_WORK_DIR}/feats.scp

  # run forced alignment / decode to get phones
  # (depends on your Kaldi recipe)

  # export features and phones to numpy using a small Python converter
  python tools/kaldi_to_npy.py --feats ${GOP_WORK_DIR}/feats.ark --phones ${GOP_WORK_DIR}/phones.txt \
      --out-feat ${GOP_FEATURE_PATH} --out-phone ${GOP_PHONE_PATH}

Notes:
- Kaldi is a native Linux project. On Windows prefer WSL or a Linux host.
- Implementing a robust Kaldi pipeline is environment-specific; this repository provides orchestration and validation hooks but does not bundle Kaldi itself.
- See `scripts/run_kaldi_gop.py` for a helper scaffold that prints the expected inputs and outputs for a given analysis.
