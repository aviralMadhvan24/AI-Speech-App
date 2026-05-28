import os
import subprocess

from app.core.logger import logger
from app.core.exceptions import AudioProcessingException
from app.utils.ffmpeg_utils import get_ffmpeg_command


def preprocess_audio(input_path: str):

    output_filename = f"processed_{os.path.basename(input_path)}"
    output_path = os.path.join("temp", output_filename)

    command = [
        get_ffmpeg_command(),
        "-y",
        "-i",
        input_path,
        "-ar",
        "16000",
        "-ac",
        "1",
        "-af",
        "loudnorm",
        output_path
    ]

    try:
        logger.info(f"Processing audio: {input_path}")

        subprocess.run(
            command,
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )

        logger.info(f"Processed audio saved: {output_path}")

        return output_path

    except FileNotFoundError:
        logger.error("ffmpeg executable not found")
        raise AudioProcessingException(
            detail="ffmpeg executable not found"
        )

    except subprocess.CalledProcessError as e:
        logger.error(e.stderr.decode())
        raise AudioProcessingException()
