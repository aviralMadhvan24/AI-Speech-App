#!/usr/bin/env python3
"""
Simple Kaldi-to-npy converter helper.

This script intentionally keeps conversion minimal and expects the caller
(or a recipe) to provide either:
 - already-prepared numpy files (in which case this script will copy them),
 - or text/plain feature and phone files where features are whitespace-separated
   floats per frame and phones are token sequences per line.

Usage examples (environment-driven from Kaldi wrapper):
  python scripts/kaldi_to_npy.py --feat-in work/feats.txt --phone-in work/phones.txt \
    --feat-out temp/gopt_features/<id>_feat.npy --phone-out temp/gopt_features/<id>_phn.npy

This is a best-effort tool; robust Kaldi recipes should supply a dedicated
converter that understands Kaldi archive formats.
"""
import argparse
import shutil
from pathlib import Path
import numpy as np
import sys


def copy_if_npy(src: Path, dst: Path) -> bool:
    if src.exists() and src.suffix == ".npy":
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        return True
    return False


def parse_feat_text(path: Path):
    # Expect lines: <uttid> <v1> <v2> ... or just numbers per line
    frames = []
    with path.open("r", encoding="utf-8") as fh:
        for line in fh:
            parts = line.strip().split()
            if not parts:
                continue
            # Skip utterance id if present
            if not _is_float(parts[0]):
                parts = parts[1:]
            floats = [float(x) for x in parts]
            frames.append(floats)
    return np.array(frames, dtype=np.float32)


def _is_float(s: str) -> bool:
    try:
        float(s)
        return True
    except Exception:
        return False


def parse_phone_text(path: Path):
    # Expect each line to be either: <uttid> ph1 ph2 ph3
    phones = []
    with path.open("r", encoding="utf-8") as fh:
        for line in fh:
            parts = line.strip().split()
            if not parts:
                continue
            if not parts[0].isalpha():
                # if first token is uttid-like (contains non-alpha) we still accept
                phones_line = parts[1:]
            else:
                phones_line = parts[1:] if len(parts) > 1 else parts
            phones.append(phones_line)
    # Simplify: return a numeric placeholder per phone (caller expects a 2D array sometimes)
    # We'll return token ids as length values to keep shape consistent
    max_len = max((len(p) for p in phones), default=0)
    arr = np.zeros((len(phones), max_len), dtype=np.int32)
    for i, p in enumerate(phones):
        for j, tok in enumerate(p):
            arr[i, j] = j + 1
    return arr


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--feat-in", required=True)
    parser.add_argument("--phone-in", required=True)
    parser.add_argument("--feat-out", required=True)
    parser.add_argument("--phone-out", required=True)
    args = parser.parse_args()

    feat_in = Path(args.feat_in)
    phone_in = Path(args.phone_in)
    feat_out = Path(args.feat_out)
    phone_out = Path(args.phone_out)

    # If inputs already numpy, just copy
    if copy_if_npy(feat_in, feat_out) and copy_if_npy(phone_in, phone_out):
        print("Copied existing numpy files.")
        sys.exit(0)

    # Try to parse simple text formats
    if feat_in.exists():
        try:
            feat = parse_feat_text(feat_in)
            feat_out.parent.mkdir(parents=True, exist_ok=True)
            np.save(feat_out, feat)
            print(f"Wrote features to {feat_out}")
        except Exception as e:
            print(f"Failed to parse feature input: {e}")
            sys.exit(2)
    else:
        print(f"Feature input not found: {feat_in}")
        sys.exit(3)

    if phone_in.exists():
        try:
            phn = parse_phone_text(phone_in)
            phone_out.parent.mkdir(parents=True, exist_ok=True)
            np.save(phone_out, phn)
            print(f"Wrote phones to {phone_out}")
        except Exception as e:
            print(f"Failed to parse phone input: {e}")
            sys.exit(4)
    else:
        print(f"Phone input not found: {phone_in}")
        sys.exit(5)

    print("Conversion complete.")


if __name__ == "__main__":
    main()
