import os
import shlex
import subprocess
from dataclasses import dataclass
from pathlib import Path

from app.core.config import settings
from app.pronunciation.phoneme_service import get_expected_word_phonemes
from app.pronunciation.transcript_cleaner import normalize_transcript


class KaldiGopNotReady(RuntimeError):
    pass


@dataclass
class GoptFeaturePaths:

    analysis_id: str

    feature_path: Path

    phone_path: Path

    work_dir: Path


class KaldiGopFeaturePipeline:

    def __init__(
        self,
        work_root: Path | None = None,
        feature_dir: Path | None = None,
        command: str | None = None
    ):
        self.work_root = work_root or Path(settings.KALDI_GOP_WORK_DIR)
        self.feature_dir = feature_dir or Path(settings.GOPT_FEATURE_DIR)
        self.command = command or settings.KALDI_GOP_COMMAND

    def ensure_features(
        self,
        audio_path: str,
        expected_text: str
    ) -> GoptFeaturePaths:
        analysis_id = Path(audio_path).stem
        feature_path = self.feature_dir / f"{analysis_id}_feat.npy"
        phone_path = self.feature_dir / f"{analysis_id}_phn.npy"
        work_dir = self.work_root / analysis_id

        paths = GoptFeaturePaths(
            analysis_id=analysis_id,
            feature_path=feature_path,
            phone_path=phone_path,
            work_dir=work_dir
        )

        if feature_path.exists() and phone_path.exists():
            return paths

        self._prepare_work_dir(
            paths=paths,
            audio_path=audio_path,
            expected_text=expected_text
        )

        if not self.command:
            raise KaldiGopNotReady(
                "Kaldi GOP command is not configured. Prepared Kaldi input at "
                f"{work_dir.as_posix()}. Set KALDI_GOP_COMMAND to generate "
                f"{feature_path.as_posix()} and {phone_path.as_posix()}."
            )

        self._run_command(
            paths=paths,
            audio_path=audio_path,
            expected_text=expected_text
        )

        if not feature_path.exists() or not phone_path.exists():
            raise KaldiGopNotReady(
                "Kaldi GOP command finished, but expected GOPT feature files "
                f"were not created: {feature_path.as_posix()} and "
                f"{phone_path.as_posix()}."
            )

        return paths

    def _prepare_work_dir(
        self,
        paths: GoptFeaturePaths,
        audio_path: str,
        expected_text: str
    ):
        paths.work_dir.mkdir(
            parents=True,
            exist_ok=True
        )
        self.feature_dir.mkdir(
            parents=True,
            exist_ok=True
        )

        absolute_audio_path = Path(audio_path).resolve()
        utterance_id = paths.analysis_id
        speaker_id = "speaker0001"
        normalized_text = normalize_transcript(expected_text).upper()

        self._write_text(
            paths.work_dir / "wav.scp",
            f"{utterance_id} {absolute_audio_path}\n"
        )
        self._write_text(
            paths.work_dir / "utt2spk",
            f"{utterance_id} {speaker_id}\n"
        )
        self._write_text(
            paths.work_dir / "spk2utt",
            f"{speaker_id} {utterance_id}\n"
        )
        self._write_text(
            paths.work_dir / "text",
            f"{utterance_id} {normalized_text}\n"
        )
        self._write_text(
            paths.work_dir / "text-phone",
            self._build_text_phone(
                utterance_id=utterance_id,
                expected_text=expected_text
            )
        )
        self._write_text(
            paths.work_dir / "README.txt",
            self._build_readme(paths)
        )

    def _run_command(
        self,
        paths: GoptFeaturePaths,
        audio_path: str,
        expected_text: str
    ):
        env = os.environ.copy()
        env.update({
            "GOP_ANALYSIS_ID": paths.analysis_id,
            "GOP_AUDIO_PATH": str(Path(audio_path).resolve()),
            "GOP_EXPECTED_TEXT": expected_text,
            "GOP_WORK_DIR": str(paths.work_dir.resolve()),
            "GOP_FEATURE_PATH": str(paths.feature_path.resolve()),
            "GOP_PHONE_PATH": str(paths.phone_path.resolve()),
            "GOPT_FEATURE_DIR": str(self.feature_dir.resolve())
        })

        try:
            subprocess.run(
                shlex.split(self.command),
                check=True,
                capture_output=True,
                text=True,
                env=env
            )
        except FileNotFoundError as error:
            raise KaldiGopNotReady(
                f"Kaldi GOP command executable was not found: {error}"
            ) from error
        except subprocess.CalledProcessError as error:
            raise KaldiGopNotReady(
                "Kaldi GOP command failed. "
                f"stdout: {error.stdout} stderr: {error.stderr}"
            ) from error

    def _build_text_phone(self, utterance_id: str, expected_text: str):
        rows = []

        for index, item in enumerate(get_expected_word_phonemes(expected_text)):
            phonemes = self._tag_word_phonemes(item["phonemes"])

            if not phonemes:
                continue

            rows.append(
                f"{utterance_id}.{index} {' '.join(phonemes)}"
            )

        return "\n".join(rows) + ("\n" if rows else "")

    def _tag_word_phonemes(self, phonemes: list[str]):
        if not phonemes:
            return []

        if len(phonemes) == 1:
            return [f"{phonemes[0]}_S"]

        tagged = []

        for index, phoneme in enumerate(phonemes):
            if index == 0:
                suffix = "B"
            elif index == len(phonemes) - 1:
                suffix = "E"
            else:
                suffix = "I"

            tagged.append(f"{phoneme}_{suffix}")

        return tagged

    def _build_readme(self, paths: GoptFeaturePaths):
        return (
            "This directory was prepared by the app for Kaldi GOP extraction.\n"
            "The configured KALDI_GOP_COMMAND must read these files and write:\n"
            f"- {paths.feature_path.as_posix()}\n"
            f"- {paths.phone_path.as_posix()}\n"
        )

    def _write_text(self, path: Path, content: str):
        path.write_text(
            content,
            encoding="utf-8"
        )
