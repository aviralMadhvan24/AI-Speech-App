import os
import subprocess
from textgrid import TextGrid

from app.core.logger import logger

MFA_OUTPUT_DIR = "outputs/mfa"

DICTIONARY_PATH = "mfa_models/dictionary/cmudict.dict"

ACOUSTIC_MODEL_PATH = "mfa_models/acoustic/english_us_arpa.zip"


def run_mfa_alignment(
    audio_path: str,
    transcript: str
):

    logger.info("Starting MFA alignment")

    os.makedirs(MFA_OUTPUT_DIR, exist_ok=True)

    audio_filename = os.path.basename(audio_path)

    base_name = os.path.splitext(audio_filename)[0]

    temp_input_dir = f"temp/mfa/{base_name}"

    os.makedirs(temp_input_dir, exist_ok=True)

    transcript_file = os.path.join(
        temp_input_dir,
        f"{base_name}.txt"
    )

    with open(
        transcript_file,
        "w",
        encoding="utf-8"
    ) as f:
        f.write(transcript)

    copied_audio_path = os.path.join(
        temp_input_dir,
        f"{base_name}.wav"
    )

    with open(audio_path, "rb") as src:
        with open(copied_audio_path, "wb") as dst:
            dst.write(src.read())

    command = [
        "mfa",
        "align",
        temp_input_dir,
        DICTIONARY_PATH,
        ACOUSTIC_MODEL_PATH,
        MFA_OUTPUT_DIR,
        "--clean"
    ]

    subprocess.run(
        command,
        check=True
    )

    logger.info("MFA alignment completed")

    textgrid_path = os.path.join(
        MFA_OUTPUT_DIR,
        f"{base_name}.TextGrid"
    )

    return textgrid_path


def parse_textgrid(
    textgrid_path: str
):

    logger.info(f"Parsing TextGrid: {textgrid_path}")

    tg = TextGrid()

    tg.read(textgrid_path)

    phoneme_data = []

    for tier in tg.tiers:

        if tier.name.lower() == "phones":

            for interval in tier.intervals:

                phoneme = interval.mark.strip()

                if phoneme == "":
                    continue

                phoneme_data.append({
                    "phoneme": phoneme,
                    "start": interval.minTime,
                    "end": interval.maxTime
                })

    return phoneme_data