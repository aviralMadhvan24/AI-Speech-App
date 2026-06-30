#!/usr/bin/env python3
"""
Kaldi GOP wrapper orchestration script.

This script is intended to be used as the `KALDI_GOP_COMMAND` invoked by
`KaldiGopFeaturePipeline` (or as a container entrypoint inside the
`kaldi_worker` container). It orchestrates running Kaldi/GOP commands and
converting outputs to numpy feature files.

Behavior:
- Reads required environment variables set by `KaldiGopFeaturePipeline`.
- If `KALDI_GOP_RUN_CMD` is provided, runs it (it should perform Kaldi
  feature extraction and forced-alignment for the prepared workspace).
- If `KALDI_TO_NPY_CMD` is provided, runs it to convert Kaldi outputs to
  the expected `.npy` files.
- Otherwise it will fail with an instructional message.

Environment variables used:
- GOP_WORK_DIR, GOP_ANALYSIS_ID, GOP_AUDIO_PATH
- GOP_FEATURE_PATH, GOP_PHONE_PATH
- KALDI_GOP_RUN_CMD (optional): shell command to run Kaldi steps
- KALDI_TO_NPY_CMD (optional): shell command to convert Kaldi outputs to numpy files

Commands can include Python-style format placeholders, e.g.:
  KALDI_GOP_RUN_CMD="bash run_my_recipe.sh {GOP_WORK_DIR} {GOP_ANALYSIS_ID}"
"""
import os
import shlex
import subprocess
import sys
from pathlib import Path


def run_command(cmd: str, env: dict) -> None:
    try:
        print(f"Running command: {cmd}")
        subprocess.run(shlex.split(cmd), check=True, env=env)
    except FileNotFoundError as error:
        print(f"Command executable not found: {error}")
        raise
    except subprocess.CalledProcessError as error:
        print("Command failed.")
        print("stdout:", error.stdout)
        print("stderr:", error.stderr)
        raise


def main():
    env = os.environ.copy()
    work_dir = Path(env.get("GOP_WORK_DIR", ""))
    analysis_id = env.get("GOP_ANALYSIS_ID")
    feature_path = Path(env.get("GOP_FEATURE_PATH", ""))
    phone_path = Path(env.get("GOP_PHONE_PATH", ""))

    if not analysis_id:
        print("ERROR: GOP_ANALYSIS_ID is not set.")
        sys.exit(2)

    if not work_dir.exists():
        print(f"ERROR: GOP_WORK_DIR does not exist: {work_dir}")
        sys.exit(2)

    print(f"Kaldi GOP wrapper running for analysis_id={analysis_id}")

    # If outputs already exist, exit successfully
    if feature_path.exists() and phone_path.exists():
        print("Feature files already present; nothing to do.")
        print(feature_path, phone_path)
        sys.exit(0)

    # Run user-provided Kaldi command if present
    run_cmd_template = env.get("KALDI_GOP_RUN_CMD")
    if run_cmd_template:
        run_cmd = run_cmd_template.format(**env)
        try:
            run_command(run_cmd, env)
        except Exception as e:
            print(f"Kaldi run command failed: {e}")
            sys.exit(3)

    # If outputs now exist, succeed
    if feature_path.exists() and phone_path.exists():
        print("Feature files created by KALDI_GOP_RUN_CMD.")
        sys.exit(0)

    # Otherwise, run converter if provided
    to_npy_template = env.get("KALDI_TO_NPY_CMD")
    if to_npy_template:
        to_npy_cmd = to_npy_template.format(**env)
        try:
            run_command(to_npy_cmd, env)
        except Exception as e:
            print(f"Conversion to numpy failed: {e}")
            sys.exit(4)

        if feature_path.exists() and phone_path.exists():
            print("Conversion to numpy succeeded.")
            sys.exit(0)

    # If we reach here, nothing produced the expected files
    print("ERROR: Kaldi/GOP wrapper did not produce expected feature files.")
    print(f"Expected: {feature_path} and {phone_path}")
    print("Set KALDI_GOP_RUN_CMD to run your Kaldi recipe and/or KALDI_TO_NPY_CMD to convert outputs to numpy.")
    sys.exit(5)


if __name__ == "__main__":
    main()
