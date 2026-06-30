# Kaldi GOP worker scaffold
# This image outlines the packages needed to build and run Kaldi-based GOP extraction.
# Building Kaldi from source is environment-dependent and can be slow; use this as a starting point.

FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
WORKDIR /opt/kaldi

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential git wget sox subversion python3 python3-pip python3-venv \
    automake autoconf libtool g++ zlib1g-dev libatlas-base-dev libfftw3-dev libopenblas-dev \
    liblapack-dev libsndfile1 ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy helper build script
COPY scripts/build_kaldi.sh /opt/kaldi/build_kaldi.sh
RUN chmod +x /opt/kaldi/build_kaldi.sh
COPY scripts/kaldi_gop_wrapper.py /opt/kaldi/kaldi_gop_wrapper.py
COPY scripts/kaldi_to_npy.py /opt/kaldi/kaldi_to_npy.py
COPY scripts/kaldi_to_npy_kaldiio.py /opt/kaldi/kaldi_to_npy_kaldiio.py
RUN chmod +x /opt/kaldi/kaldi_gop_wrapper.py /opt/kaldi/kaldi_to_npy.py /opt/kaldi/kaldi_to_npy_kaldiio.py

# Install kaldiio for ark/scp support
RUN python3 -m pip install --no-cache-dir kaldiio

# Do not auto-run the build during image build; building Kaldi can be time-consuming
# To build, run: docker build --target build -t kaldi-worker . && docker run --rm -v ...

CMD ["/bin/bash"]
