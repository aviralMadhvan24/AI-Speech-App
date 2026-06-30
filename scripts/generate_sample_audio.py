"""Generate the canonical short audio fixture used by the test suite.

This is a one-time generator. It writes ``tests/fixtures/short_sample.wav`` as a
1.5-second 440 Hz sine wave (A4), 16 kHz mono, 16-bit PCM.

The output file is small (~48 KB) and is committed to the repository so the
audio preprocessing tests can run without an external download step.

Usage (from the repository root)::

    python scripts/generate_sample_audio.py

Re-running the script regenerates the file byte-for-byte (the sine wave is
deterministic), so it is safe to invoke at any time.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import soundfile as sf

# Fixture parameters. Keep these in sync with the docstring above and with
# ``tests/fixtures/README.md``.
SAMPLE_RATE_HZ = 16_000
DURATION_SECONDS = 1.5
FREQUENCY_HZ = 440.0  # A4
AMPLITUDE = 0.5  # Leave headroom so the 16-bit PCM conversion does not clip.

# Repository-root-relative output path. The script resolves it against the
# location of this file so it works regardless of the caller's working dir.
REPO_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_PATH = REPO_ROOT / "tests" / "fixtures" / "short_sample.wav"


def generate_sine_wave(
    duration_seconds: float,
    frequency_hz: float,
    sample_rate_hz: int,
    amplitude: float,
) -> np.ndarray:
    """Return a mono float32 sine wave with the given parameters."""
    sample_count = int(round(duration_seconds * sample_rate_hz))
    t = np.arange(sample_count, dtype=np.float32) / np.float32(sample_rate_hz)
    return (amplitude * np.sin(2.0 * np.pi * frequency_hz * t)).astype(np.float32)


def main() -> None:
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)

    samples = generate_sine_wave(
        duration_seconds=DURATION_SECONDS,
        frequency_hz=FREQUENCY_HZ,
        sample_rate_hz=SAMPLE_RATE_HZ,
        amplitude=AMPLITUDE,
    )

    sf.write(
        str(OUTPUT_PATH),
        samples,
        samplerate=SAMPLE_RATE_HZ,
        subtype="PCM_16",
    )

    info = sf.info(str(OUTPUT_PATH))
    size_bytes = OUTPUT_PATH.stat().st_size
    print(
        f"Wrote {OUTPUT_PATH.relative_to(REPO_ROOT)} "
        f"({size_bytes} bytes, {info.samplerate} Hz, "
        f"{info.channels} channel(s), {info.duration:.3f} s)"
    )


if __name__ == "__main__":
    main()
