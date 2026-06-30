#!/usr/bin/env python3
"""
Kaldi (ark/scp) to numpy converter using kaldiio.

This script reads Kaldi feature archives (ark/scp) and a phone text file
and writes the numpy files expected by the GOPT adapter.

Usage:
  python scripts/kaldi_to_npy_kaldiio.py --feats-scp work/feats.scp --phones work/phones.txt --analysis-id <id> \
    --feat-out temp/gopt_features/<id>_feat.npy --phone-out temp/gopt_features/<id>_phn.npy

Notes:
- Requires `kaldiio` and `numpy`.
- The phones file should contain lines like: <uttid> PH1 PH2 PH3 ...
- The features scp/ark must include the utterance id used by the app (utterance_id or utterance_id.index)
"""
import argparse
from pathlib import Path
import numpy as np
import sys

try:
    import kaldiio
except Exception as e:
    print("kaldiio import failed. Install kaldiio in your environment.")
    raise


def load_feat_for_utt(scp_path: Path, uttid: str):
    # kaldiio.load_scp returns an iterator of (uttid, array)
    try:
        for uid, arr in kaldiio.load_scp(scp_path.as_posix()):
            if uid == uttid or uid.startswith(uttid + "."):
                return arr
    except Exception:
        # try load_ark on the file directly
        try:
            for uid, arr in kaldiio.load_ark(scp_path.as_posix()):
                if uid == uttid or uid.startswith(uttid + "."):
                    return arr
        except Exception as e:
            raise

    raise FileNotFoundError(f"Utterance {uttid} not found in {scp_path}")


def load_phones(phone_path: Path, uttid: str):
    phones = []
    with phone_path.open('r', encoding='utf-8') as fh:
        for line in fh:
            parts = line.strip().split()
            if not parts:
                continue
            uid = parts[0]
            toks = parts[1:]
            if uid == uttid or uid.startswith(uttid + "."):
                phones.append(toks)
    if not phones:
        raise FileNotFoundError(f"No phone line for {uttid} in {phone_path}")

    # Convert phones to a simple numeric array per phone (placeholder)
    max_len = max(len(p) for p in phones)
    arr = np.zeros((len(phones), max_len), dtype=np.int32)
    for i, p in enumerate(phones):
        for j, tok in enumerate(p):
            arr[i, j] = j + 1
    return arr


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--feats-scp', required=True)
    parser.add_argument('--phones', required=True)
    parser.add_argument('--analysis-id', required=True)
    parser.add_argument('--feat-out', required=True)
    parser.add_argument('--phone-out', required=True)
    args = parser.parse_args()

    scp = Path(args.feats_scp)
    phones = Path(args.phones)
    utt = args.analysis_id
    feat_out = Path(args.feat_out)
    phone_out = Path(args.phone_out)

    # Load features
    feat_arr = load_feat_for_utt(scp, utt)
    feat_out.parent.mkdir(parents=True, exist_ok=True)
    np.save(feat_out, feat_arr)
    print(f"Wrote features to {feat_out}")

    # Load phones
    phn_arr = load_phones(phones, utt)
    phone_out.parent.mkdir(parents=True, exist_ok=True)
    np.save(phone_out, phn_arr)
    print(f"Wrote phones to {phone_out}")


if __name__ == '__main__':
    main()
