#!/usr/bin/env python3
"""
Small orchestration helper for Kaldi GOP feature extraction.

This script is a lightweight wrapper that validates environment
variables produced by `KaldiGopFeaturePipeline` and emits a helpful
message describing the commands that should be run to produce the
expected GOPT feature files.

It intentionally does not try to run Kaldi itself because Kaldi is an
external, platform-dependent dependency. Instead this script is useful
as the `KALDI_GOP_COMMAND` placeholder: point `KALDI_GOP_COMMAND` to
invoke this script (it will print the next steps) or replace it with
your full Kaldi extraction command.
"""
import os
import sys
from pathlib import Path


def main():
    work_dir = Path(os.environ.get("GOP_WORK_DIR", ""))
    analysis_id = os.environ.get("GOP_ANALYSIS_ID")
    feature_path = Path(os.environ.get("GOP_FEATURE_PATH", ""))
    phone_path = Path(os.environ.get("GOP_PHONE_PATH", ""))

    if not analysis_id or not work_dir.exists():
        print("ERROR: GOP_WORK_DIR or GOP_ANALYSIS_ID not set or work dir missing.")
        print("This script is a helper. Prepare Kaldi inputs under GOP_WORK_DIR and run Kaldi.")
        sys.exit(2)

    print("Prepared Kaldi GOP workspace:")
    print(f"  work_dir: {work_dir}")
    print(f"  analysis_id: {analysis_id}")
    print("")

    print("Expected inputs in the work dir:")
    for fname in ("wav.scp", "utt2spk", "spk2utt", "text", "text-phone"):
        print(f"  - {work_dir / fname}")

    print("")
    print("Goal: produce two files:")
    print(f"  - {feature_path}")
    print(f"  - {phone_path}")
    print("")

    print("Suggested next steps:")
    print("  1) Run Kaldi feature extraction and alignment using your Kaldi/GOP recipe (Linux/WSL):")
    print("     - compute MFCC/FBANK features for the utterance(s)")
    print("     - run forced alignment / lexicon steps to obtain phone timings")
    print("     - run the GOP extraction script (project-specific) to compute features and phone arrays")
    print("")
    print("  2) Convert the produced Kaldi artifacts to numpy arrays as:\n")
    print("     np.save('<analysis>_feat.npy', feature_array)")
    print("     np.save('<analysis>_phn.npy', phone_array)")
    print("")
    print("If you want this script to run your Kaldi commands automatically, replace its body with the exact shell commands and ensure Kaldi is installed and on PATH.")

    print("")
    print("You can instead set the environment variable KALDI_GOP_RUN_CMD to a recipe command and/or KALDI_TO_NPY_CMD to a converter.")
    print("Example:\n  export KALDI_GOP_RUN_CMD=\"bash /work/run_recipe.sh {GOP_WORK_DIR} {GOP_ANALYSIS_ID}\"\n  export KALDI_TO_NPY_CMD=\"python /opt/kaldi/kaldi_to_npy.py --feat-in /work/feats.txt --phone-in /work/phones.txt --feat-out {GOP_FEATURE_PATH} --phone-out {GOP_PHONE_PATH}\"")


if __name__ == "__main__":
    main()
