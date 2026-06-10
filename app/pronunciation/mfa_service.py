import os
import subprocess

from app.core.logger import logger

MFA_OUTPUT_DIR = "outputs/mfa"

DICTIONARY_PATH = "app/mfa_models/dictionary/cmudict.dict"

ACOUSTIC_MODEL_PATH = "app/mfa_models/acoustic/english_us_arpa.zip"
CONDA_EXECUTABLE = (
    r"C:\Users\avira\miniconda3\Scripts\conda.exe"
)
MFA_EXECUTABLE = (
    r"C:\Users\avira\miniconda3\envs\mfa\Scripts\mfa.exe"
)
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
    CONDA_EXECUTABLE,
    "run",
    "-n",
    "mfa",
    "mfa",
    "align",
    temp_input_dir,
    "english_us_arpa",
    "english_us_arpa",
    MFA_OUTPUT_DIR,
    "--clean"
]

    print("Running MFA command:")
    print(command)
    import shutil
    print("CONDA EXISTS =", os.path.exists(CONDA_EXECUTABLE))
    print("CONDA =", shutil.which("conda"))
    print("MFA =", shutil.which("mfa"))
    print("COMMAND =", command)
    result = subprocess.run(
        command,
        capture_output=True,
        text=True
    )

    if result.returncode != 0:
        print(result.stdout)
        print(result.stderr)
        raise Exception(result.stderr)

    logger.info("MFA alignment completed")

    textgrid_path = os.path.join(
        MFA_OUTPUT_DIR,
        f"{base_name}.TextGrid"
    )

    return textgrid_path
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
                    "phoneme": phoneme,
                    "start": interval.minTime,
                    "end": interval.maxTime
                })

    # map phones to words
    for phone in phones:

        phone_midpoint = (
            phone["start"] + phone["end"]
        ) / 2

        for word in words:

            if (
                word["start"]
                <= phone_midpoint
                <= word["end"]
            ):

                word["phonemes"].append(
                    phone["phoneme"].rstrip("012")
                )
                word["phoneme_timings"].append({
                    "phoneme": phone["phoneme"].rstrip("012"),
                    "start": phone["start"],
                    "end": phone["end"],
                    "duration": phone["end"] - phone["start"]
                })

                break

    return {
        "words": words,
        "phones": phones
    }
