#!/usr/bin/env bash
set -euo pipefail

# Helper script to build Kaldi in container or host. This script follows Kaldi's standard build steps.
# VERY IMPORTANT: Building Kaldi takes time and requires ~10-30 GB disk and several cores.
# Run this on a Linux host or in a CI runner with appropriate resources.

KALDI_ROOT=${KALDI_ROOT:-/opt/kaldi}
cd "${KALDI_ROOT}"

if [ -d tools ]; then
  echo "Kaldi tools directory exists. Skipping clone."
else
  git clone https://github.com/kaldi-asr/kaldi.git .
fi

# Build tools
cd tools
extras/install_mkl.sh || true || true
make -j "$(nproc)" || true

# Build src
cd ../src
./configure --shared
make depend -j "$(nproc)"
make -j "$(nproc)"

echo "Kaldi build finished."

echo "Next: install any recipe-specific dependencies and test with a small dataset."
