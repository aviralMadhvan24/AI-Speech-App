import os
import shutil
import subprocess

from app.core.config import project_path
from app.core.config import settings
from app.core.logger import logger


def run_mfa_alignment(audio_path: str, transcript: str):
    logger.info("Starting MFA alignment")

    mfa_executable = shutil.which(settings.MFA_EXECUTABLE)
    if not mfa_executable:
        raise RuntimeError(
            "Montreal Forced Aligner is not installed or MFA_EXECUTABLE "
            "does not point to its executable"
        )

    audio_filename = os.path.basename(audio_path)
    base_name = os.path.splitext(audio_filename)[0]
    mfa_output_dir = project_path(settings.OUTPUT_DIR) / "mfa"
    temp_input_dir = project_path(settings.TEMP_DIR) / "mfa" / base_name

    os.makedirs(mfa_output_dir, exist_ok=True)
    os.makedirs(temp_input_dir, exist_ok=True)

    transcript_file = temp_input_dir / f"{base_name}.txt"
    transcript_file.write_text(transcript, encoding="utf-8")

    copied_audio_path = temp_input_dir / f"{base_name}.wav"
    shutil.copyfile(audio_path, copied_audio_path)

    command = [
        mfa_executable,
        "align",
        str(temp_input_dir),
        "english_us_arpa",
        "english_us_arpa",
        str(mfa_output_dir),
        "--clean"
    ]

    result = subprocess.run(
        command,
        capture_output=True,
        text=True
    )

    if result.returncode != 0:
        logger.warning("MFA alignment failed: %s", result.stderr.strip())
        raise RuntimeError(result.stderr.strip() or "MFA alignment failed")

    textgrid_path = mfa_output_dir / f"{base_name}.TextGrid"
    if not textgrid_path.exists():
        raise RuntimeError("MFA completed without producing a TextGrid file")

    logger.info("MFA alignment completed")
    return str(textgrid_path)


def parse_textgrid(textgrid_path: str):
    from textgrid import TextGrid

    logger.info(f"Parsing TextGrid: {textgrid_path}")

    tg = TextGrid()
    tg.read(textgrid_path)

    words = []
    phones = []

    for tier in tg.tiers:
        tier_name = tier.name.lower()

        if tier_name == "words":
            for interval in tier.intervals:
                word = interval.mark.strip()

                if not word:
                    continue

                words.append({
                    "word": word,
                    "start": interval.minTime,
                    "end": interval.maxTime,
                    "phonemes": [],
                    "phoneme_timings": []
                })

        elif tier_name == "phones":
            for interval in tier.intervals:
                phoneme = interval.mark.strip()

                if not phoneme:
                    continue

                phones.append({
                    "phoneme": phoneme.rstrip("012"),
                    "start": interval.minTime,
                    "end": interval.maxTime
                })

    for phone in phones:
        phone_midpoint = (phone["start"] + phone["end"]) / 2

        for word in words:
            if word["start"] <= phone_midpoint <= word["end"]:
                word["phonemes"].append(phone["phoneme"])
                word["phoneme_timings"].append({
                    "phoneme": phone["phoneme"],
                    "start": phone["start"],
                    "end": phone["end"],
                    "duration": phone["end"] - phone["start"]
                })
                break

    return {
        "words": words,
        "phones": phones
    }
