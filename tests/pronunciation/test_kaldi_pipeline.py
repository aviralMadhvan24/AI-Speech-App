import os
from pathlib import Path

import pytest

from app.pronunciation.acoustic.kaldi_gop_pipeline import KaldiGopFeaturePipeline, KaldiGopNotReady, GoptFeaturePaths


def test_ensure_features_raises_when_command_not_configured(tmp_path):
    # Arrange: create a fake audio file and an unconfigured pipeline
    audio = tmp_path / "processed_test.wav"
    audio.write_text("FAKE-WAV")

    pipeline = KaldiGopFeaturePipeline(
        work_root=tmp_path / "kaldi_work",
        feature_dir=tmp_path / "gopt_features",
        command=None,
    )

    # Act + Assert: when KALDI_GOP_COMMAND is not configured, ensure_features
    # raises KaldiGopNotReady. This is the expected behavior for the
    # local_acoustic provider when Kaldi is not installed.
    with pytest.raises(KaldiGopNotReady):
        pipeline.ensure_features(str(audio), "Test sentence")

    # The Kaldi input files should have been written before the raise so an
    # operator can manually run Kaldi on them.
    work_dir = (tmp_path / "kaldi_work" / "processed_test")
    assert (work_dir / "wav.scp").exists()
    assert (work_dir / "text").exists()
    assert (work_dir / "text-phone").exists()


def test_run_helper_script_requires_env(monkeypatch, tmp_path):
    # Test that the run_kaldi_gop helper exits with code when GOP_WORK_DIR missing
    script = Path("scripts/run_kaldi_gop.py")
    assert script.exists()

    # Run as subprocess with missing env to check exit code
    res = os.system(f"python {script.as_posix()}")
    # exit code 2 expected per script when GOP_WORK_DIR missing
    assert res != 0
